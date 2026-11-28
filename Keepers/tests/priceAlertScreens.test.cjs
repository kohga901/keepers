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
  return { hooks, jsx, nodes, invalidate() { dirty = true; }, cleanup() { slots.forEach(slot => slot?.cleanup?.()); },
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

function bannerHarness({ reduce = false, screenReader = false, platform = 'web' } = {}) {
  const h = harness(), timers = new Map(), animations = [], navigations = [];
  const state = { banner: { ...notice, item_img: 'https://images.test/shirt.jpg' },
    dismissBanner(id) { if (state.banner?.id === id) { state.banner = null; h.invalidate(); } } };
  let gestures;
  const animate = (value, config) => ({ start(callback) {
    animations.push(config); value.setValue(config.toValue); callback?.({ finished: true });
  } });
  const Host = createLoader({
    react: h.hooks, 'react/jsx-runtime': { jsx: h.jsx, jsxs: h.jsx },
    'react-native': { ...native, Platform: { OS: platform },
      AccessibilityInfo: { isReduceMotionEnabled: async () => reduce, isScreenReaderEnabled: async () => screenReader },
      Animated: { View: 'AnimatedView', Value: function (value) { return { value, setValue(next) { this.value = next; },
        stopAnimation() {}, interpolate() { return 'opacity'; } }; }, timing: animate, spring: animate },
      Easing: { out: value => value, cubic() {} }, PanResponder: { create(config) { gestures = config; return { panHandlers: {} }; } } },
    '@expo/vector-icons/Ionicons': 'Icon', 'expo-image': { Image: 'Image' },
    'expo-router': { useRouter: () => ({ navigate: path => navigations.push(plain(path)) }) },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 24 }) },
    './Text': { Text: 'Text' }, '../contexts/PriceAlertsContext': { usePriceAlerts: () => state },
    '../hooks/useAppTheme': { useAppTheme: () => ({ theme: {} }) },
  }, { setTimeout(fn, delay) { timers.set(fn, delay); return fn; }, clearTimeout(fn) { timers.delete(fn); } })('components/PriceAlertBanner.tsx').PriceAlertBanner;
  const Component = () => { const banner = Host(); return banner ? banner.type(banner.props) : null; };
  return { ...h, state, timers, animations, navigations, gestures: () => gestures, flush: () => h.flush(Component),
    button: label => h.nodes().find(node => node.props.accessibilityLabel === label) };
}

test('price banner shows the photo and price change and opens the existing item route', async () => {
  const app = bannerHarness(); await app.flush();
  assert.equal(app.nodes().find(node => node.type === 'Image').props.source.uri, 'https://images.test/shirt.jpg');
  assert.ok(app.animations.every(animation => animation.useNativeDriver === false));
  const open = app.button('Price went up to $50.00. Linen shirt');
  assert.ok(open);
  assert.ok(!app.nodes(open.props.children).some(node => node.type === 'Pressable'));
  open.props.onPress(); await app.flush();
  assert.deepEqual(app.navigations, [{ pathname: '/(tabs)/likelist', params: { itemId: '7' } }]);
  assert.equal(app.state.banner, null);
  app.cleanup();
});

test('price banner dismisses automatically, from its close button, or with an upward swipe', async () => {
  for (const action of ['timer', 'close', 'swipe']) {
    const app = bannerHarness(); await app.flush();
    if (action === 'timer') {
      assert.deepEqual([...app.timers.values()], [7000]);
      [...app.timers.keys()][0]();
    } else if (action === 'close') app.button('Dismiss price alert banner').props.onPress();
    else {
      const pan = app.gestures();
      assert.equal(pan.onMoveShouldSetPanResponder(null, { dx: 50, dy: -10 }), false);
      assert.equal(pan.onMoveShouldSetPanResponder(null, { dx: 0, dy: -30 }), true);
      pan.onPanResponderRelease(null, { dy: -30, vy: -1 });
    }
    await app.flush(); assert.equal(app.state.banner, null); assert.equal(app.navigations.length, 0);
    app.cleanup(); assert.equal(app.timers.size, 0);
  }
});

test('price banner handles failed photos, reduced motion and screen readers', async () => {
  const app = bannerHarness({ reduce: true, screenReader: true }); await app.flush();
  assert.equal(app.animations.length, 0); assert.equal(app.timers.size, 0);
  app.nodes().find(node => node.type === 'Image').props.onError(); await app.flush();
  assert.ok(!app.nodes().some(node => node.type === 'Image'));
  assert.ok(app.nodes().some(node => node.type === 'Icon' && node.props.name === 'shirt-outline'));
  app.button('Dismiss price alert banner').props.onPress(); await app.flush();
  assert.equal(app.state.banner, null); app.cleanup();
});

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
    '../components/SwipeToDeleteNotification': { SwipeToDeleteNotification: 'SwipeToDeleteNotification' },
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
  assert.ok(!h.nodes().some(n => n.type === 'Icon' && n.props.name === 'close-outline'));
  h.nodes().find(n => n.type === 'SwipeToDeleteNotification').props.onDelete(); await h.flush(Screen);
  assert.equal(h.nodes().find(n => n.type === 'SwipeToDeleteNotification').props.disabled, true);
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
  await h.nodes().find(n => n.type === 'SwipeToDeleteNotification').props.onDelete(); await h.flush(Screen);
  assert.ok(button('View Linen shirt in Like List'));
  assert.deepEqual(calls.at(-1), ['alice', 'notice']);
  button('View Linen shirt in Like List').props.onAccessibilityAction({ nativeEvent: { actionName: 'delete' } });
  await h.flush(Screen);
  assert.deepEqual(calls.at(-1), ['alice', 'notice']);
});

function historyScreen(getItem = async id => ({ item_id: id, item_name: `Piece ${id}`, item_price: '$50', item_gender: null }), services = {}, { width = 390, height = 900, platform = 'ios' } = {}) {
  const h = harness(), calls = [], navigations = [], listings = [];
  const params = { itemId: '7' };
  const router = { setParams(next) { Object.assign(params, next); h.invalidate(); }, navigate: path => navigations.push(path) };
  const animation = { interpolate() { return animation; } };
  const focusEffect = fn => h.hooks.useEffect(fn, [fn]);
  const Screen = createLoader({
    react: h.hooks, 'react/jsx-runtime': { jsx: h.jsx, jsxs: h.jsx },
    'react-native': { ...native, FlatList: 'FlatList', Modal: 'Modal', KeyboardAvoidingView: 'KeyboardAvoidingView',
      useWindowDimensions: () => ({ width, height }),
      Platform: { OS: platform }, Animated: { View: 'AnimatedView', FlatList: 'FlatList', Value: function () { return animation; },
        timing: () => ({ start() {} }), event: () => () => {}, diffClamp: () => animation }, Easing: { cubic() {}, out() {} } },
    'expo-router': { useRouter: () => router, useLocalSearchParams: () => params },
    'expo-router/react-navigation': { useFocusEffect: focusEffect, getDefaultHeaderHeight: () => 80 },
    'expo-image': { Image: 'Image' }, 'expo-web-browser': { openBrowserAsync: async url => listings.push(url) }, '@expo/vector-icons': { Ionicons: 'Icon' },
    // Expo Router 58 deliberately supplies a zero safe-area frame on web.
    'react-native-safe-area-context': { useSafeAreaFrame: () => ({ width: platform === 'web' ? 0 : width, height: platform === 'web' ? 0 : height }), useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
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
  return { ...h, calls, params, navigations, listings, flush: () => h.flush(Screen),
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

test('history detail photo stays uncropped on phone and desktop, with working expand, store and dismiss actions', async () => {
  for (const viewport of [{ width: 320, height: 568, platform: 'web' }, { width: 1440, height: 900, platform: 'web' }, { width: 390, height: 844, platform: 'ios' }]) {
    const app = historyScreen(async id => ({ item_id: id, item_name: 'Linen shirt', item_price: '$50', item_gender: 'women',
      item_img: 'https://images.test/portrait.jpg', item_web_listing: 'https://store.test/shirt' }), {}, viewport);
    await app.flush();
    const find = label => app.nodes().find(node => node.props.accessibilityLabel === label);
    const photo = find('View full-size image');
    const image = app.nodes(photo).find(node => node.type === 'Image');
    assert.equal(image.props.contentFit, 'contain');
    assert.equal(image.props.contentPosition, 'center');
    assert.ok(photo.props.style[1].height > 0 && photo.props.style[1].height <= viewport.height / 2);
    assert.ok(!app.nodes(photo.props.children).some(node => node.type === 'Pressable'));
    find('View Linen shirt in store').props.onPress();
    assert.deepEqual(app.listings, ['https://store.test/shirt']);
    photo.props.onPress(); await app.flush();
    assert.ok(find('Close full-size image'));
    assert.equal(app.nodes().find(node => node.type === 'Image').props.contentFit, 'contain');
    app.nodes().find(node => node.type === 'Modal').props.onRequestClose(); await app.flush();
    assert.ok(find('View full-size image'));
    assert.equal(app.nodes().find(node => node.type === 'Modal').props.visible, true);
    app.nodes().find(node => node.type === 'Pressable' && node.props.accessible === false && node.props.focusable === false).props.onPress();
    await app.flush();
    assert.equal(app.nodes().find(node => node.type === 'Modal').props.visible, false);
  }
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

test('history cards and counted tabs fit phone and desktop widths on web and native', async () => {
  const flatten = style => Object.assign({}, ...[style].flat(Infinity).filter(Boolean));
  for (const platform of ['ios', 'android', 'web']) {
    for (const width of [320, 360, 390, 768, 1440]) {
      const app = historyScreen(undefined, {
        getLikedItems: async () => Array.from({ length: 100 }, (_, i) => clothing(i, i % 2 ? 'Shirt' : 'A long item name that takes two lines')),
      }, { width, platform });
      await app.flush();
      const tabs = app.nodes().filter(n => n.props.accessibilityRole === 'tab');
      const toggle = app.nodes().find(n => n.props.children?.some?.(child => Array.isArray(child) && child.includes(tabs[0])));
      const row = app.nodes().find(n => n.props.children?.some?.(child => child?.type === 'Bell'));
      const rowStyle = flatten(row.props.style);
      const available = Math.min(width, rowStyle.maxWidth ?? width) - rowStyle.paddingHorizontal * 2;
      const toggleStyle = flatten(toggle.props.style);
      const optionWidth = flatten(tabs[0].props.style).width;
      assert.ok(optionWidth >= 116, `${platform} ${width}: labels and 99+ counts need room`);
      assert.equal(toggleStyle.width, optionWidth * 2 + 2 * (toggleStyle.padding + toggleStyle.borderWidth));
      assert.ok(toggleStyle.width + flatten(row.props.children[0].props.style).width + 44 <= available);

      const list = app.nodes().find(n => n.type === 'FlatList');
      assert.equal(list.props.numColumns, 2);
      const card = list.props.renderItem({ item: list.props.data[0] });
      const cardWidth = flatten(card.props.style).width;
      assert.ok(cardWidth > 0, `${platform} ${width}: cards and photos must have a positive size`);
      assert.ok(cardWidth * 2 + list.props.columnWrapperStyle.gap <= available);
      assert.equal(flatten(card.props.children[0].props.style).height, cardWidth * 4 / 3);
      const name = app.nodes(card).find(n => n.props.numberOfLines === 2);
      assert.equal(flatten(name.props.style).minHeight, flatten(name.props.style).lineHeight * 2);
    }
  }
});

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

test('notification timestamps stay concise and handle future, invalid and older dates', () => {
  const { notificationTime } = createLoader()('utils/priceAlerts.ts');
  const now = Date.parse('2026-11-27T18:00:00Z');
  const ago = minutes => new Date(now - minutes * 60000).toISOString();
  assert.equal(notificationTime(ago(0), now), 'Just now');
  assert.equal(notificationTime(ago(-10), now), 'Just now');
  assert.equal(notificationTime(ago(59), now), '59m ago');
  assert.equal(notificationTime(ago(60), now), '1h ago');
  assert.equal(notificationTime(ago(1440), now), '1d ago');
  assert.equal(notificationTime('invalid', now), '');
  assert.match(notificationTime('2025-06-10T12:00:00Z', now), /2025/);
  assert.doesNotMatch(notificationTime(ago(8 * 1440), now), /ago/);
});

test('a completed left swipe deletes once and closes the row; disabled swipes do nothing', async () => {
  const h = harness(), pending = deferred();
  let deletes = 0, closes = 0;
  const { SwipeToDeleteNotification } = createLoader({
    react: h.hooks, 'react/jsx-runtime': { jsx: h.jsx, jsxs: h.jsx }, 'react-native': native,
    'react-native-gesture-handler/ReanimatedSwipeable': 'Swipeable',
    '@expo/vector-icons': { Ionicons: 'Icon' }, './Text': { Text: 'Text' },
  })('components/SwipeToDeleteNotification.tsx');
  const props = { itemName: 'Linen shirt', children: null, disabled: false,
    onDelete: async () => { deletes++; await pending.promise; } };
  const Component = () => SwipeToDeleteNotification(props);
  const row = () => h.nodes().find(n => n.type === 'Swipeable');
  await h.flush(Component);
  row().props.ref.current = { close: () => closes++ };
  row().props.onSwipeableOpen('right');
  assert.equal(deletes, 0);
  row().props.onSwipeableOpen('left');
  row().props.onSwipeableOpen('left');
  assert.equal(deletes, 1);
  assert.equal(closes, 0);
  pending.resolve(); await h.flush(Component);
  assert.equal(closes, 1);
  const action = row().props.renderRightActions();
  assert.equal(action.props.accessibilityLabel, 'Delete notification for Linen shirt');
  action.props.onPress(); await h.flush(Component);
  assert.equal(deletes, 2);
  assert.equal(closes, 2);
  props.disabled = true; h.invalidate(); await h.flush(Component);
  assert.equal(row().props.enabled, false);
  row().props.onSwipeableOpen('left');
  assert.equal(deletes, 2);
});

test('only pull-to-refresh activates the refresh indicator and it resets after completion', async () => {
  const h = harness(), pending = deferred();
  let refreshes = 0;
  const state = { userId: 'alice', alerts: [], notifications: [], unreadCount: 0,
    loading: false, error: null, refresh: async () => { refreshes++; await pending.promise; } };
  const Screen = createLoader({
    react: h.hooks, 'react/jsx-runtime': { jsx: h.jsx, jsxs: h.jsx }, 'react-native': native,
    'expo-router': { useRouter: () => ({}) }, '@expo/vector-icons': { Ionicons: 'Icon' },
    '../components/Text': { Text: 'Text' },
    '../components/SwipeToDeleteNotification': { SwipeToDeleteNotification: 'SwipeToDeleteNotification' },
    '../hooks/useAppTheme': { useAppTheme: () => ({ theme: {} }) },
    '../contexts/PriceAlertsContext': { usePriceAlerts: () => state },
    '../services/priceAlertsService': {},
  })('app/price-alerts.tsx').default;
  const control = () => h.nodes().find(n => n.type === 'ScrollView').props.refreshControl.props;
  await h.flush(Screen);
  assert.equal(control().refreshing, false);
  assert.ok(!h.nodes().some(n => n.type === 'Spinner'));
  control().onRefresh(); await h.flush(Screen);
  assert.equal(refreshes, 1);
  assert.equal(control().refreshing, true);
  h.nodes().find(n => n.props.accessibilityRole === 'tab' && h.nodes(n).some(c => c.props.children === 'Watching')).props.onPress();
  await h.flush(Screen);
  assert.equal(control().refreshing, true);
  pending.resolve(); await h.flush(Screen);
  assert.equal(control().refreshing, false);
  assert.ok(!h.nodes().some(n => n.type === 'Spinner'));
});

test('unread filter, read controls and watching removal preserve their behavior in the activity feed', async () => {
  const h = harness(), calls = [];
  const state = { userId: 'alice', alerts: [{ clothes_id: 8, target_price: 40, direction: 'decrease', Clothing: null }],
    notifications: [notice, { ...notice, id: 'read', item_name: 'Read item', read_at: notice.created_at }],
    unreadCount: 1, loading: false, error: null, refresh: async () => calls.push('refresh') };
  const Screen = createLoader({
    react: h.hooks, 'react/jsx-runtime': { jsx: h.jsx, jsxs: h.jsx }, 'react-native': native,
    'expo-router': { useRouter: () => ({ navigate: path => calls.push(plain(path)) }) },
    '@expo/vector-icons': { Ionicons: 'Icon' }, '../components/Text': { Text: 'Text' },
    '../components/SwipeToDeleteNotification': { SwipeToDeleteNotification: 'SwipeToDeleteNotification' },
    '../hooks/useAppTheme': { useAppTheme: () => ({ theme: {} }) },
    '../contexts/PriceAlertsContext': { usePriceAlerts: () => state },
    '../services/priceAlertsService': {
      markPriceNotificationsRead: async (...args) => {
        calls.push(args);
        state.notifications = state.notifications.map(n => !args[1] || n.id === args[1] ? { ...n, read_at: notice.created_at } : n);
        state.unreadCount = state.notifications.filter(n => !n.read_at).length;
      },
      deletePriceAlert: async (...args) => { calls.push(args); state.alerts = []; },
    },
  })('app/price-alerts.tsx').default;
  const button = label => h.nodes().find(n => n.props.accessibilityLabel === label);
  const tab = label => h.nodes().find(n => n.props.accessibilityRole === 'tab' && h.nodes(n).some(c => c.props.children === label));
  const hasText = text => h.nodes().some(n => n.type === 'Text' && n.props.children === text);
  await h.flush(Screen);
  assert.equal(tab('All').props.accessibilityLabel, 'All notifications: 2');
  assert.equal(tab('Unread').props.accessibilityLabel, 'Unread notifications: 1');
  assert.ok(h.nodes(tab('All')).some(n => n.type === 'Text' && n.props.children === 2));
  assert.ok(h.nodes(tab('Unread')).some(n => n.type === 'Text' && n.props.children === 1));
  assert.equal(tab('Notifications').props.accessibilityState.selected, true);
  assert.ok(!button('Remove alert for Clothing item'));
  assert.ok(button('View Read item in Like List'));
  tab('Unread').props.onPress(); await h.flush(Screen);
  assert.equal(tab('Unread').props.accessibilityState.selected, true);
  assert.ok(button('View Linen shirt in Like List'));
  assert.ok(!button('View Read item in Like List'));
  button('Mark notification for Linen shirt as read').props.onPress(); await h.flush(Screen);
  assert.deepEqual(calls.slice(-2), [['alice', 'notice'], 'refresh']);
  assert.ok(hasText('You’re all caught up'));
  assert.equal(tab('All').props.accessibilityLabel, 'All notifications: 2');
  assert.equal(tab('Unread').props.accessibilityLabel, 'Unread notifications: 0');
  assert.ok(!button('Mark all notifications read'));
  state.unreadCount = 2; h.invalidate(); await h.flush(Screen);
  assert.ok(hasText('No unread updates in this view'));
  assert.ok(!hasText('You’re all caught up'));
  button('Mark all notifications read').props.onPress(); await h.flush(Screen);
  assert.deepEqual(calls.slice(-2), [['alice'], 'refresh']);
  tab('Watching').props.onPress(); await h.flush(Screen);
  assert.equal(tab('Watching').props.accessibilityState.selected, true);
  assert.ok(!button('View Read item in Like List'));
  assert.ok(!button('Clear all notifications'));
  assert.ok(!tab('Unread'));
  button('Remove alert for Clothing item').props.onPress(); await h.flush(Screen);
  assert.deepEqual(calls.slice(-2), [['alice', '8'], 'refresh']);
  assert.ok(hasText('Your active price alerts will live here.'));
  state.loading = true; h.invalidate(); await h.flush(Screen);
  assert.ok(button('Loading watched items'));
  assert.ok(!hasText('Your active price alerts will live here.'));
  state.loading = false;
  tab('Notifications').props.onPress(); await h.flush(Screen);
  assert.equal(tab('Unread').props.accessibilityState.selected, true);
  tab('All').props.onPress(); await h.flush(Screen);
  assert.ok(button('View Read item in Like List'));
  state.notifications = []; h.invalidate(); await h.flush(Screen);
  assert.equal(tab('All').props.accessibilityLabel, 'All notifications: 0');
  assert.equal(tab('Unread').props.accessibilityLabel, 'Unread notifications: 0');
  assert.ok(hasText('No price updates yet'));
  const explore = h.nodes().find(n => n.type === 'Pressable' && h.nodes(n).some(c => c.props.children === 'Explore your likes'));
  explore.props.onPress();
  assert.equal(calls.at(-1), '/(tabs)/likelist');
  state.loading = true; h.invalidate(); await h.flush(Screen);
  assert.ok(button('Loading notifications'));
  assert.ok(!hasText('No price updates yet'));
  state.loading = false; state.error = 'Offline'; h.invalidate(); await h.flush(Screen);
  assert.ok(h.nodes().some(n => n.props.accessibilityRole === 'alert' && n.props.children === 'Offline'));
  assert.ok(!hasText('No price updates yet'));
});
