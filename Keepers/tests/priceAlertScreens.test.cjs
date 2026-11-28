const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createLoader, deferred, plain } = require('./helpers/load.cjs');

function harness() {
  const slots = [], effects = [];
  let cursor = 0, dirty = true, tree;
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const hooks = {
    useState(initial) {
      const i = cursor++;
      slots[i] ??= { value: typeof initial === 'function' ? initial() : initial,
        set(next) { slots[i].value = typeof next === 'function' ? next(slots[i].value) : next; dirty = true; } };
      return [slots[i].value, slots[i].set];
    },
    useRef(value) { const i = cursor++; return slots[i] ??= { current: value }; },
    useMemo(fn, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) slots[i] = { value: fn(), deps }; return slots[i].value; },
    useCallback(fn, deps) { return hooks.useMemo(() => fn, deps); },
    useEffect(fn, deps) {
      const i = cursor++;
      if (!same(slots[i]?.deps, deps)) {
        const previous = slots[i]; slots[i] = { deps };
        effects.push(() => { previous?.cleanup?.(); slots[i].cleanup = fn(); });
      }
    },
  };
  const jsx = (type, props) => ({ type, props: props ?? {} });
  function nodes(node = tree) {
    if (!node || typeof node !== 'object') return [];
    if (Array.isArray(node)) return node.flatMap(n => nodes(n));
    return [node, ...nodes(node.props?.children ?? null)];
  }
  return { hooks, jsx, nodes, invalidate() { dirty = true; },
    async flush(Component) {
      for (let i = 0; i < 30; i++) {
        if (dirty) { dirty = false; cursor = 0; tree = Component(); }
        effects.splice(0).forEach(fn => fn());
        await new Promise(setImmediate);
        if (!dirty && !effects.length) return;
      }
      throw new Error('Screen did not settle');
    },
  };
}

const native = { View: 'View', Pressable: 'Pressable', ScrollView: 'ScrollView', RefreshControl: 'RefreshControl',
  ActivityIndicator: 'Spinner', StyleSheet: { create: s => s } };
const notice = { id: 'notice', clothes_id: 7, item_name: 'Linen shirt', price: 50, target_price: 45,
  direction: 'increase', read_at: null, created_at: '2026-11-12T12:00:00Z' };

test('notification opens Like List and clearing one/all refreshes; failed clearing keeps the inbox', async () => {
  const h = harness(), calls = [], pending = deferred();
  let fail = false;
  const state = { userId: 'alice', alerts: [], notifications: [notice], unreadCount: 1, loading: false,
    refresh: async () => calls.push('refresh') };
  const router = { navigate: path => calls.push(plain(path)) };
  const Screen = createLoader({
    react: h.hooks, 'react/jsx-runtime': { jsx: h.jsx, jsxs: h.jsx }, 'react-native': native,
    'expo-router': { useRouter: () => router }, '@expo/vector-icons': { Ionicons: 'Icon' },
    '../components/Text': { Text: 'Text' },
    '../hooks/useAppTheme': { useAppTheme: () => ({ theme: {} }) },
    '../contexts/PriceAlertsContext': { usePriceAlerts: () => state },
    '../services/priceAlertsService': { clearPriceNotifications: async (...args) => {
      calls.push(args); if (fail) throw new Error('Clear failed'); await pending.promise;
    } },
  })('app/price-alerts.tsx').default;
  const button = label => h.nodes().find(n => n.props.accessibilityLabel === label);
  await h.flush(Screen);
  button('View Linen shirt in Like List').props.onPress();
  assert.deepEqual(calls.pop(), { pathname: '/(tabs)/likelist', params: { itemId: '7' } });
  button('Clear notification for Linen shirt').props.onPress(); await h.flush(Screen);
  assert.equal(button('Clear all notifications').props.disabled, true);
  assert.deepEqual(calls, [['alice', 'notice']]);
  pending.resolve(); await h.flush(Screen);
  assert.equal(calls.at(-1), 'refresh');
  button('Clear all notifications').props.onPress(); await h.flush(Screen);
  assert.deepEqual(calls.at(-2), ['alice']);
  assert.equal(calls.at(-1), 'refresh');
  fail = true;
  button('Clear all notifications').props.onPress(); await h.flush(Screen);
  assert.ok(h.nodes().some(n => n.props.accessibilityRole === 'alert' && n.props.children === 'Clear failed'));
  assert.ok(button('View Linen shirt in Like List'));
  assert.deepEqual(calls.at(-1), ['alice']);
});

function historyScreen(getItem = async id => ({ item_id: id, item_name: `Piece ${id}`, item_price: '$50', item_gender: null }), services = {}) {
  const h = harness(), calls = [], navigations = [];
  const params = { itemId: '7' };
  const router = { setParams(next) { Object.assign(params, next); h.invalidate(); }, navigate: path => navigations.push(path) };
  const animation = { interpolate() { return animation; } };
  const focusEffect = fn => h.hooks.useEffect(fn, [fn]);
  const Screen = createLoader({
    react: h.hooks, 'react/jsx-runtime': { jsx: h.jsx, jsxs: h.jsx },
    'react-native': { ...native, FlatList: 'FlatList', Modal: 'Modal', KeyboardAvoidingView: 'KeyboardAvoidingView',
      Platform: { OS: 'ios' }, Animated: { View: 'AnimatedView', FlatList: 'FlatList', Value: function () { return animation; },
        timing: () => ({ start() {} }), event: () => () => {}, diffClamp: () => animation }, Easing: { cubic() {}, out() {} } },
    'expo-router': { useRouter: () => router, useLocalSearchParams: () => params },
    'expo-router/react-navigation': { useFocusEffect: focusEffect, getDefaultHeaderHeight: () => 80 },
    'expo-image': { Image: 'Image' }, 'expo-web-browser': {}, '@expo/vector-icons': { Ionicons: 'Icon' },
    'react-native-safe-area-context': { useSafeAreaFrame: () => ({ width: 390 }), useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    '../../components/Text': { Text: 'Text' }, '../../components/PriceAlertEditor': { PriceAlertEditor: 'PriceAlertEditor' },
    '../../components/PriceAlertsBell': { PriceAlertsBell: 'Bell' },
    '../../contexts/PriceDisplayContext': { usePriceDisplay: () => ({ showPriceAsTier: false }) },
    '../../contexts/TutorialContext': { useTutorial: () => ({ showTutorialOnce: tutorial }) },
    '../../contexts/StackHeaderHeightContext': { useStackHeaderHeight: () => 80 },
    '../../hooks/useAppTheme': { useAppTheme: () => ({ theme: {} }) },
    '@/services/dataServices': { getLikedItems: async () => [{ Clothing: { item_id: 7, item_name: 'Old name', item_price: '$40' } }],
      getDislikedItems: async () => [], getClothingById: id => { calls.push(id); return getItem(id); }, ...services },
  })('app/(tabs)/likelist.tsx').default;
  function tutorial() {}
  return { ...h, calls, params, navigations, flush: () => h.flush(Screen),
    route(id) { params.itemId = id; h.invalidate(); } };
}

test('notification route opens the existing popup with fresh item details and consumes its parameter', async () => {
  const app = historyScreen(); await app.flush();
  assert.deepEqual(app.calls, ['7']);
  assert.equal(app.nodes().find(n => n.type === 'Modal').props.visible, true);
  assert.ok(app.nodes().some(n => n.type === 'Text' && n.props.children === 'Piece 7'));
  assert.equal(app.nodes().find(n => n.type === 'PriceAlertEditor').props.price, '$50');
  assert.equal(app.params.itemId, undefined);
  app.nodes().find(n => n.props.accessibilityLabel === 'Close item details').props.onPress(); await app.flush();
  assert.equal(app.nodes().find(n => n.type === 'Modal').props.visible, false);
  assert.deepEqual(app.calls, ['7']);
  app.route('7'); await app.flush();
  assert.equal(app.nodes().find(n => n.type === 'Modal').props.visible, true);
});

test('removed likes still open details without an alert editor; unavailable items show a recoverable message', async () => {
  const app = historyScreen(); app.route('8'); await app.flush();
  assert.equal(app.nodes().find(n => n.type === 'Modal').props.visible, true);
  assert.ok(!app.nodes().some(n => n.type === 'PriceAlertEditor'));
  const missing = historyScreen(async () => null); await missing.flush();
  assert.equal(missing.nodes().find(n => n.type === 'Modal').props.visible, false);
  assert.match(missing.nodes().find(n => n.type === 'FlatList').props.ListHeaderComponent.props.children, /could not be loaded/);
});

test('a slow item response cannot replace a later notification selection', async () => {
  const old = deferred();
  const app = historyScreen(id => id === '7' ? old.promise : Promise.resolve({ item_id: id, item_name: 'New selection' }));
  await app.flush(); app.route('8'); await app.flush();
  old.resolve({ item_id: 7, item_name: 'Stale selection' }); await app.flush();
  assert.ok(app.nodes().some(n => n.type === 'Text' && n.props.children === 'New selection'));
  assert.ok(!app.nodes().some(n => n.type === 'Text' && n.props.children === 'Stale selection'));
});

const clothing = (id, name) => ({ Clothing: { item_id: id, item_name: name, item_price: '$40', item_img: `${id}.jpg`, item_gender: 'men' } });

test('history grid removes liked and disliked items with the corner button and keeps the toggle counts current', async () => {
  const deleted = [];
  const app = historyScreen(undefined, {
    getLikedItems: async () => [clothing(7, 'Old name'), clothing(9, 'Wool cardigan')],
    getDislikedItems: async () => [clothing(3, 'Neon windbreaker')],
    deleteLikedItem: id => deleted.push(['liked', id]),
    deleteDislikedItem: id => deleted.push(['disliked', id]),
  });
  await app.flush();
  const list = () => app.nodes().find(n => n.type === 'FlatList');
  const byLabel = (label, tree = app.nodes()) => tree.find(n => n.props.accessibilityLabel === label);
  const card = item => app.nodes(list().props.renderItem({ item }));

  assert.equal(list().props.numColumns, 2);
  assert.ok(byLabel('Liked, 2 items'));
  assert.ok(byLabel('Disliked, 1 item'));

  byLabel('Remove Old name from liked items', card(list().props.data[0])).props.onPress(); await app.flush();
  assert.deepEqual(deleted, [['liked', '7']]);
  assert.deepEqual(list().props.data.map(item => item.name), ['Wool cardigan']);
  assert.ok(byLabel('Liked, 1 item'));

  byLabel('Disliked, 1 item').props.onPress(); await app.flush();
  const disliked = card(list().props.data[0]);
  assert.ok(!byLabel('Remove Neon windbreaker from liked items', disliked));
  byLabel('Remove Neon windbreaker from disliked items', disliked).props.onPress(); await app.flush();
  assert.deepEqual(deleted, [['liked', '7'], ['disliked', '3']]);
  assert.ok(byLabel('Disliked, 0 items'));
});

test('empty history offers a Start swiping button that opens the swiper', async () => {
  const app = historyScreen(undefined, { getLikedItems: async () => [] });
  await app.flush();
  const empty = app.nodes(app.nodes().find(n => n.type === 'FlatList').props.ListEmptyComponent);
  assert.ok(empty.some(n => n.type === 'Text' && n.props.children === 'No liked items yet'));
  const start = empty.find(n => n.type === 'Pressable' && app.nodes(n.props.children).some(c => c.props.children === 'Start swiping'));
  start.props.onPress();
  assert.deepEqual(app.navigations, ['/swiper']);
});
