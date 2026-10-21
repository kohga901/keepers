const test = require('node:test');
const assert = require('node:assert/strict');
const { createLoader, deferred, plain } = require('./helpers/load.cjs');

const row = (id, url = `https://shop.test/${id}`) => ({ item_id: id, item_name: `Piece ${id}`, item_price: '$35',
  item_img: `https://images.test/${id}`, item_gender: null, item_web_listing: url });

// Match the existing graph tests: execute real screen callbacks with deterministic
// hook scheduling. Native rendering and the third-party gesture engine are boundaries.
function screen({ recommend = async () => [row(1), row(2)], session = { user: { id: 'alice' } } } = {}) {
  const slots = [], effects = [], timers = [], calls = { feed: [], swipes: [], opened: [], alerts: [], jumps: [] };
  let cursor = 0, dirty = true, tree, header, authChanged;
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const hooks = {
    useState(initial) { const i = cursor++; slots[i] ??= { value: initial,
      set(value) { slots[i].value = typeof value === 'function' ? value(slots[i].value) : value; dirty = true; } };
      return [slots[i].value, slots[i].set]; },
    useRef(value) { const i = cursor++; return slots[i] ??= { current: value }; },
    useCallback(fn, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) slots[i] = { value: fn, deps }; return slots[i].value; },
    useEffect(fn, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) {
      const previous = slots[i]; slots[i] = { deps }; effects.push(() => { previous?.cleanup?.(); slots[i].cleanup = fn(); });
    } },
  };
  const jsx = (type, props) => {
    if (type === 'Swiper' && props.ref) props.ref.current = { jumpToCardIndex: (i) => calls.jumps.push(i) };
    return { type, props: props ?? {} };
  };
  const stack = { setOptions(options) { header = options.headerRight; } };
  const navigation = { getParent: () => stack };
  const load = createLoader({
    react: hooks, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { View: 'View', Pressable: 'Pressable', ActivityIndicator: 'Spinner',
      Alert: { alert: (...args) => calls.alerts.push(args) }, Dimensions: { get: () => ({ width: 390, height: 844 }) },
      StyleSheet: { create: (styles) => styles } },
    'expo-router': { useRouter: () => ({ push() {} }), useNavigation: () => navigation,
      useFocusEffect: (fn) => hooks.useEffect(fn, [fn]) },
    'react-native-deck-swiper': 'Swiper', '@expo/vector-icons/Ionicons': 'Icon', 'expo-image': { Image: 'Image' },
    'expo-web-browser': { openBrowserAsync: async (url) => calls.opened.push(url) },
    '../../components/Text': { Text: 'Text' }, '../../components/TagFilter': { TagFilter: 'TagFilter' },
    '../../components/ai/ImageLookupModal': { ImageLookupModal: 'LookupModal' },
    '../../contexts/PriceDisplayContext': { usePriceDisplay: () => ({ showPriceAsTier: false }) },
    '../../hooks/useAppTheme': { useAppTheme: () => ({ theme: {} }) },
    '../../services/ai': { lookupPurchasableItem: async () => ({}), toAiLookupError: (e) => e },
    '../../services/serverApi': {
      getRecommendationsFromServer: (...args) => { calls.feed.push(args); return recommend(...args); },
      getTagsFromServer: async () => [{ Tag: 'black', Category: 'color' }],
      sendSwipeToServer: async (...args) => { calls.swipes.push(args); return true; },
    },
    '../../utils/supabase': { supabase: { auth: {
      getSession: async () => ({ data: { session }, error: null }),
      onAuthStateChange(fn) { authChanged = fn; return { data: { subscription: { unsubscribe() {} } } }; },
    } } },
  }, { setTimeout(fn) { timers.push(fn); return timers.length; } });
  const App = load('app/(tabs)/swiper.tsx').default;
  function nodes(node = tree) {
    if (!node || typeof node !== 'object') return [];
    if (Array.isArray(node)) return node.flatMap((n) => nodes(n ?? null));
    return [node, ...nodes(node.props?.children ?? null)];
  }
  async function flush() {
    for (let i = 0; i < 30; i++) {
      if (dirty) { cursor = 0; dirty = false; tree = App(); }
      effects.splice(0).forEach((fn) => fn());
      timers.splice(0).forEach((fn) => fn());
      await new Promise((resolve) => setImmediate(resolve));
      if (!dirty && !effects.length) return;
    }
    throw new Error('Swiper screen did not settle');
  }
  return { calls, flush, nodes,
    deck: () => { const node = nodes().find((n) => n.type === 'Swiper'); assert.ok(node, 'Expected an active swipe deck'); return node.props; },
    text: () => nodes().filter((n) => n.type === 'Text').flatMap((n) => n.props.children).join(' '),
    filter: (tags) => header().props.onChange(tags),
    auth: (value) => authChanged('TOKEN_REFRESHED', value),
    refresh: () => nodes().find((n) => n.props.accessibilityLabel === 'Load more items').props.onPress(),
  };
}

test('signed-in feed maps real item IDs and sends left/right reactions for the displayed cards', async () => {
  const app = screen(); await app.flush();
  assert.deepEqual(plain(app.deck().cards.map((item) => item.id)), ['1', '2']);
  await app.deck().onSwipedRight(0); await app.deck().onSwipedLeft(1);
  assert.deepEqual(app.calls.swipes, [['1', true], ['2', false]]);
  await app.auth({ user: { id: 'alice' } }); await app.flush();
  assert.equal(app.calls.feed.length, 1);
  assert.deepEqual(plain(app.deck().cards.map((item) => item.id)), ['1', '2']);
});

test('signed-out feed never fetches recommendations and removes cards on sign-out', async () => {
  const signedOut = screen({ session: null }); await signedOut.flush();
  assert.match(signedOut.text(), /Please sign in/);
  assert.equal(signedOut.calls.feed.length, 0);
  const app = screen(); await app.flush(); await app.auth(null); await app.flush();
  assert.match(app.text(), /Please sign in/);
  assert.ok(!app.nodes().some((node) => node.type === 'Swiper'));
});

test('rapid swipes share one prefetch and an exhausted deck restarts with the returned batch', async () => {
  const next = deferred(); let request = 0;
  const app = screen({ recommend: () => ++request === 1 ? Promise.resolve([row(1), row(2)]) : next.promise });
  await app.flush();
  app.deck().onSwiped(0); app.deck().onSwiped(1); app.deck().onSwipedAll(); await app.flush();
  assert.equal(app.calls.feed.length, 2);
  next.resolve([row(3), row(4)]); await app.flush();
  assert.deepEqual(plain(app.deck().cards.map((item) => item.id)), ['3', '4']);
});

test('a late response for an old tag filter cannot overwrite or unlock the current deck request', async () => {
  const old = deferred(), current = deferred(); let request = 0;
  const app = screen({ recommend: () => [Promise.resolve([row(1)]), old.promise, current.promise][request++] });
  await app.flush(); app.filter(['shirt']); await app.flush(); app.filter(['black']); await app.flush();
  old.resolve([row(2)]); await app.flush();
  assert.ok(!app.nodes().some((node) => node.type === 'Swiper'));
  assert.equal(app.calls.feed.length, 3);
  current.resolve([row(3)]); await app.flush();
  assert.deepEqual(plain(app.deck().cards.map((item) => item.id)), ['3']);
  assert.deepEqual(plain(app.calls.feed[2]), [10, ['black']]);
  app.filter(['black']); await app.flush();
  assert.equal(app.calls.feed.length, 3);
});

test('an exhausted filtered feed can recover matching cards on refresh', async () => {
  let request = 0;
  const app = screen({ recommend: async () => [[row(1)], [], [row(3)]][request++] });
  await app.flush(); app.filter(['black']); await app.flush();
  assert.ok(!app.nodes().some((node) => node.type === 'Swiper'));
  app.refresh(); await app.flush();
  assert.deepEqual(plain(app.deck().cards.map((item) => item.id)), ['3']);
  assert.deepEqual(plain(app.calls.feed[2]), [10, ['black']]);
});

test('regression: filtered exhaustion is not presented as a connection failure', {
  todo: 'BUG-4: refreshDeck treats an empty successful response as a failed load',
}, async () => {
  let request = 0;
  const app = screen({ recommend: async () => ++request === 1 ? [row(1)] : [] });
  await app.flush(); app.filter(['black']); await app.flush();
  assert.match(app.text(), /No more items match these filters/);
});

test('opening a listing keeps the final card and blocks insecure or malformed shopping URLs', async () => {
  for (const url of ['https://shop.test/item', 'http://shop.test/item', 'javascript:alert(1)', 'not a URL']) {
    const app = screen({ recommend: async () => [row(1, url)] }); await app.flush();
    app.deck().onSwipedTop(0); app.deck().onSwipedAll(); await app.flush();
    assert.equal(app.deck().cards[0].id, '1');
    assert.deepEqual(app.calls.jumps, [0]);
    if (url.startsWith('https:')) assert.deepEqual(app.calls.opened, [url]);
    else { assert.equal(app.calls.opened.length, 0); assert.equal(app.calls.alerts.length, 1); }
    assert.equal(app.calls.swipes.length, 0);
  }
});
