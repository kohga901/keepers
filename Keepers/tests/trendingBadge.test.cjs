const test = require('node:test');
const assert = require('node:assert/strict');
const { createLoader, plain } = require('./helpers/load.cjs');

// Renders the badge as a plain element tree. Native views and the icon font are boundaries.
function render(props = {}) {
  const jsx = (type, props) => ({ type, props: props ?? {} });
  const load = createLoader({
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { View: 'View', StyleSheet: { create: (s) => s } },
    '@expo/vector-icons/Ionicons': 'Icon',
    './Text': { Text: 'Text' },
  });
  const { TrendingBadge } = load('components/TrendingBadge.tsx');
  return TrendingBadge(props);
}

const children = (node) => [node.props.children].flat(Infinity).filter(Boolean);
const flat = (style) => Object.assign({}, ...[style].flat(Infinity).filter(Boolean));

test('badge is the same rounded bubble as the Why this? button', () => {
  const badge = render();
  assert.equal(badge.type, 'View');
  assert.deepEqual(plain(flat(badge.props.style)), {
    flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 999,
    paddingHorizontal: 10, paddingVertical: 6, backgroundColor: 'rgba(26, 26, 26, 0.72)',
  });
});

test('badge shows a pink filled heart, then white "Most liked" text, and nothing else', () => {
  const layers = children(render());
  assert.deepEqual(layers.map((n) => n.type), ['Icon', 'Text']);
  const [icon, label] = layers;
  assert.deepEqual(plain(icon.props), { name: 'heart', size: 16, color: '#FF7A93' });
  assert.equal(label.props.children, 'Most liked');
  assert.deepEqual(plain(label.props.style), { color: '#FFFFFF', fontSize: 13, fontWeight: '700' });
});

test('badge never takes touches, is read as "Most liked", and accepts a position', () => {
  const badge = render({ style: { position: 'absolute', top: 14, left: 14 } });
  assert.equal(badge.props.pointerEvents, 'none');
  assert.equal(badge.props.accessible, true);
  assert.equal(badge.props.accessibilityLabel, 'Most liked');
  const style = flat(badge.props.style);
  assert.deepEqual([style.position, style.top, style.left], ['absolute', 14, 14]);
});
