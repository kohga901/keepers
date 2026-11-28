const test = require('node:test');
const assert = require('node:assert/strict');
const { createLoader } = require('./helpers/load.cjs');

const listing = { title: 'Blue shirt listing', url: 'https://shop.test/shirt', seller: 'Shop',
  displayedPrice: '$35', condition: 'new', matchType: 'similar', confidence: .7,
  evidence: 'Same cut', sourceBacked: true };
const searchLink = { marketplace: 'eBay', title: 'Search eBay for blue shirt', query: 'blue shirt',
  url: 'https://www.ebay.com/sch/i.html?_nkw=blue%20shirt' };

function render(result, inspect = () => {}) {
  const jsx = (type, props) => ({ type, props: props ?? {} });
  const load = createLoader({
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    'react-native': { ActivityIndicator: 'Spinner', Modal: 'Modal', Pressable: 'Pressable',
      ScrollView: 'ScrollView', View: 'View', Platform: { OS: 'ios' },
      StyleSheet: { create: (styles) => styles, hairlineWidth: 1 }, Alert: { alert() {} } },
    '@expo/vector-icons/Ionicons': 'Icon', 'expo-image': { Image: 'Image' },
    'expo-web-browser': { openBrowserAsync: async () => {} },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '../Text': { Text: 'Text' }, '../../hooks/useAppTheme': { useAppTheme: () => ({ theme: {} }) },
    '../../services/ai': { isSafeLookupUrl: () => true },
    '../../assets/marketplaces/google-shopping.png': 101,
    '../../assets/marketplaces/ebay.jpg': 102,
    '../../assets/marketplaces/poshmark.png': 103,
    '../../assets/marketplaces/depop.png': 104,
    '../../assets/marketplaces/mercari.png': 105,
  });
  const { ImageLookupModal } = load('components/ai/ImageLookupModal.tsx');
  const tree = ImageLookupModal({ item: { name: 'Shirt', imageUrl: 'https://images.test/shirt' },
    loading: false, errorCode: null, errorMessage: null, onClose() {}, onRetry() {}, result });
  inspect(tree);
  function text(node) {
    if (node == null || typeof node === 'boolean') return '';
    if (Array.isArray(node)) return node.map(text).join(' ');
    if (typeof node !== 'object') return String(node);
    return text(node.props?.children);
  }
  return text(tree);
}

test('each marketplace displays its bundled logo and unknown markets keep a readable fallback', () => {
  const markets = ['Google Shopping', 'eBay', 'Poshmark', 'Depop', 'Mercari', 'Other market', '__proto__'];
  let tree;
  const text = render({ listings: [], searchLinks: markets.map((marketplace, i) => ({
    ...searchLink, marketplace, url: `https://shop.test/${i}`,
  })) }, (value) => { tree = value; });
  function nodes(node) {
    if (!node || typeof node !== 'object') return [];
    if (Array.isArray(node)) return node.flatMap(nodes);
    return [node, ...nodes(node.props?.children)];
  }
  const all = nodes(tree);
  const logos = all.filter((node) => node.type === 'Image' && typeof node.props.source === 'number');
  assert.deepEqual(logos.map((node) => node.props.source), [101, 102, 103, 104, 105]);
  assert.ok(logos.every((node) => node.props.contentFit === 'contain' && node.props.accessible === false));
  assert.equal(all.filter((node) => node.type === 'Icon' && node.props.name === 'storefront-outline').length, 2);
  for (const marketplace of markets) assert.ok(text.includes(marketplace));
});

test('purchase listings and generated marketplace searches appear in separate sections', () => {
  const text = render({ listings: [listing], searchLinks: [searchLink] });
  assert.match(text, /Purchase options\s+1/);
  assert.match(text, /Search other markets\s+1/);
  assert.ok(text.indexOf(listing.title) < text.indexOf('Search other markets'));
  assert.match(text, /Search\s+eBay\s+for\s+Shirt/);
  assert.ok(!text.includes(searchLink.query));
  assert.ok(text.includes(listing.seller));
  assert.ok(text.includes(listing.displayedPrice));
  assert.ok(!text.includes(listing.evidence));
  assert.doesNotMatch(text, /Gemini/);
});

test('Gemini fallback displays marketplace searches without an empty purchase section', () => {
  const text = render({ listings: [], searchLinks: [searchLink] });
  assert.match(text, /Search other markets/);
  assert.doesNotMatch(text, /Purchase options|No trustworthy purchase links/);
});

test('catalog fallback keeps search links available without claiming image identification', () => {
  const text = render({ provider: 'catalog', listings: [], searchLinks: [searchLink] });
  assert.match(text, /Search other markets/);
  assert.match(text, /Search\s+eBay\s+for\s+Shirt/);
  assert.ok(!text.includes(searchLink.query));
  assert.doesNotMatch(text, /Marketplace searches based on the identified item|AI confidence|Purchase options/);
});

test('purchase results remain visible without marketplace links and empty results stay actionable', () => {
  const purchaseText = render({ listings: [listing], searchLinks: [] });
  assert.match(purchaseText, /Purchase options/);
  assert.match(purchaseText, /Search other markets\s+0/);
  assert.doesNotMatch(purchaseText, /SEARCH LINK/);
  assert.doesNotMatch(purchaseText, /Marketplace searches based on the identified item/);
  const emptyText = render({ listings: [], searchLinks: [] });
  assert.match(emptyText, /No trustworthy purchase links/);
  assert.match(emptyText, /Search other markets\s+0/);
  assert.doesNotMatch(emptyText, /SEARCH LINK/);
});
