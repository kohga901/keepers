const test = require('node:test');
const assert = require('node:assert/strict');
const { createLoader, deferred, plain } = require('./helpers/load.cjs');

const row = (id, url = `https://shop.test/${id}`) => ({ item_id: id, item_name: `Piece ${id}`, item_price: '$35',
  item_img: `https://images.test/${id}`, item_gender: null, item_web_listing: url });

// Match the existing graph tests: execute real screen callbacks with deterministic
// hook scheduling. Native rendering and the third-party gesture engine are boundaries.
function screen({ recommend = async () => [row(1), row(2)], session = { user: { id: 'alice' } }, platform = 'ios', viewportWidth = 390, viewportHeight = 844, browserWindow } = {}) {
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
      useWindowDimensions: () => ({ width: viewportWidth, height: viewportHeight }),
      Alert: { alert: (...args) => calls.alerts.push(args) }, Dimensions: { get: () => ({ width: viewportWidth, height: 844 }) },
      Platform: { OS: platform, select: (options) => options[platform] }, StyleSheet: { create: (styles) => styles } },
    'expo-router': { useRouter: () => ({ push() {} }), useNavigation: () => navigation,
      useFocusEffect: (fn) => hooks.useEffect(fn, [fn]) },
    'react-native-deck-swiper': 'Swiper', '@expo/vector-icons/Ionicons': 'Icon', 'expo-image': { Image: 'Image' },
    'expo-web-browser': { openBrowserAsync: async (url) => calls.opened.push(url) },
    '../../components/Text': { Text: 'Text' }, '../../components/TagFilter': { TagFilter: 'TagFilter' },
    '../../components/ai/ImageLookupModal': { ImageLookupModal: 'LookupModal' },
    '../../components/ReasonSheet': { ReasonSheet: 'ReasonSheet' },
    '../../components/TrendingBadge': { TrendingBadge: 'TrendingBadge' },
    '../../contexts/PriceDisplayContext': { usePriceDisplay: () => ({ showPriceAsTier: false }) },
    '../../contexts/StackHeaderHeightContext': { useStackHeaderHeight: () => 80 },
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
  }, { window: browserWindow, setTimeout(fn) { timers.push(fn); return timers.length; } });
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
    header: () => header(),
    resize: async (width, height) => { viewportWidth = width; viewportHeight = height; dirty = true; await flush(); },
    filter: (tags) => header().props.children.props.onChange(tags),
    auth: (value) => authChanged('TOKEN_REFRESHED', value),
    refresh: () => nodes().find((n) => n.props.accessibilityLabel === 'Load more items').props.onPress(),
  };
}

test('web deck lets mouse gestures reach the swiper and scales thresholds to the content width', async () => {
  for (const width of [390, 760, 761, 1920]) {
    const app = screen({ platform: 'web', viewportWidth: width }); await app.flush();
    const deck = app.deck();
    assert.equal(app.header().props.style.marginRight, 16 + Math.max(0, (width - 760) / 2));
    assert.equal(deck.horizontalThreshold, Math.min(width, 760) / 6);
    assert.equal(deck.cardStyle.userSelect, 'none');
    assert.equal(deck.cardStyle.cursor, 'grab');
    const card = deck.renderCard(deck.cards[0], 0);
    assert.equal(card.props.children[0].props.children.props.draggable, false);
    assert.equal(card.props.children[0].props.children.props.contentFit, width > 760 ? 'contain' : 'cover');
    await deck.onSwipedRight(0); await deck.onSwipedLeft(1);
    assert.deepEqual(app.calls.swipes, [['1', true], ['2', false]]);
  }
});

test('signed-in feed maps real item IDs and sends left/right reactions for the displayed cards', async () => {
  const app = screen(); await app.flush();
  assert.equal(app.deck().cardStyle, undefined);
  assert.equal(app.deck().containerStyle, undefined);
  assert.deepEqual(plain(app.deck().cards.map((item) => item.id)), ['1', '2']);
  await app.deck().onSwipedRight(0); await app.deck().onSwipedLeft(1);
  assert.deepEqual(app.calls.swipes, [['1', true], ['2', false]]);
  await app.auth({ user: { id: 'alice' } }); await app.flush();
  assert.equal(app.calls.feed.length, 1);
  assert.deepEqual(plain(app.deck().cards.map((item) => item.id)), ['1', '2']);
});

test('mobile web keeps cards between the bars and updates gestures when the viewport resizes', async () => {
  const app = screen({ platform: 'web' }); await app.flush();
  for (const [width, height] of [[390, 844], [390, 500], [844, 390]]) {
    await app.resize(width, height);
    const deck = app.deck();
    assert.equal(deck.cardStyle.height, 'auto');
    assert.equal(deck.cardStyle.top, 92);
    assert.equal(deck.cardStyle.bottom, 24);
    assert.equal(deck.containerStyle.overflow, 'hidden');
    assert.equal(deck.containerStyle.touchAction, 'none');
    assert.equal(deck.horizontalThreshold, Math.min(width, 760) / 6);
    assert.equal(deck.verticalThreshold, height / 5);
    assert.deepEqual(plain(deck.cards.map(item => item.id)), ['1', '2']);
  }
  assert.equal(app.calls.feed.length, 1);
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

test('web swipe-up opens a new tab and only navigates the current tab when blocked', async () => {
  for (const blocked of [false, true]) {
    const attempted = [], currentTab = [], newTab = [];
    const tab = { opener: 'Keepers', location: { replace: url => newTab.push(url) } };
    const browserWindow = { open(url, target) { attempted.push([url, target]); return blocked ? null : tab; },
      location: { assign: url => currentTab.push(url) } };
    const app = screen({ platform: 'web', recommend: async () => [row(1)], browserWindow });
    await app.flush();
    app.deck().onSwipedTop(0); app.deck().onSwipedAll(); await app.flush();
    assert.deepEqual(attempted, [['about:blank', '_blank']]);
    assert.deepEqual(currentTab, blocked ? ['https://shop.test/1'] : []);
    assert.deepEqual(newTab, blocked ? [] : ['https://shop.test/1']);
    if (!blocked) assert.equal(tab.opener, null);
    assert.equal(app.deck().cards[0].id, '1');
    assert.deepEqual(app.calls.jumps, [0]);
    assert.equal(app.calls.swipes.length, 0);
  }
});

test('only cards with a reason show the Why button, which opens and closes the reason sheet', async () => {
  const reason = { kind: 'similar_to_like', text: 'Because you liked Piece 9', liked_item_id: 9,
    liked_item_name: 'Piece 9', liked_item_img: 'https://images.test/9', tags: [] };
  const app = screen({ recommend: async () => [row(1), { ...row(2), reason }, { ...row(3), reason: { kind: 'explore', text: '  ' } }] });
  await app.flush();
  const whyButton = (index) => app.nodes(app.deck().renderCard(app.deck().cards[index], index))
    .find((node) => node.props.accessibilityLabel === 'Why am I seeing this?');
  const sheet = () => app.nodes().find((node) => node.type === 'ReasonSheet').props;

  assert.equal(whyButton(0), undefined);
  // A reason with no text to show gets no button.
  assert.equal(whyButton(2), undefined);
  assert.equal(sheet().item, null);

  whyButton(1).props.onPress(); await app.flush();
  assert.equal(sheet().item.id, '2');
  assert.deepEqual(plain(sheet().item.reason), { kind: 'similar_to_like', text: 'Because you liked Piece 9',
    likedItemName: 'Piece 9', likedItemImageUrl: 'https://images.test/9', tags: [] });

  // Closing puts the deck back on the explained card, and opening it never sent a swipe.
  sheet().onClose(); await app.flush();
  assert.equal(sheet().item, null);
  assert.deepEqual(app.calls.jumps, [1]);
  assert.equal(app.calls.swipes.length, 0);
});

test('only the trending card shows the Most liked badge, top left, without its like count', async () => {
  const app = screen({ recommend: async () => [row(1), { ...row(2), is_trending: true, like_count: 9 },
    { ...row(3), is_trending: false, like_count: null }, { ...row(4), is_trending: 'yes' }] });
  await app.flush();
  const cardNodes = (index) => app.nodes(app.deck().renderCard(app.deck().cards[index], index));
  const badge = (index) => cardNodes(index).find((node) => node.type === 'TrendingBadge');

  // Only a real `true` counts, so a malformed flag shows nothing.
  assert.deepEqual(plain(app.deck().cards.map((item) => item.trending)), [false, true, false, false]);
  assert.deepEqual([0, 1, 2, 3].map((i) => Boolean(badge(i))), [false, true, false, false]);
  assert.deepEqual(plain(badge(1).props.style), { position: 'absolute', top: 12, left: 12 });
  // The badge and the Why this? button mirror each other: same height from the top, same inset.
  const styles = app.nodes(app.deck().renderCard({ ...app.deck().cards[1], reason: { kind: 'x', text: 'y', tags: [] } }, 1))
    .find((node) => node.props.accessibilityLabel === 'Why am I seeing this?').props.style({ pressed: false })[0];
  assert.deepEqual([styles.top, styles.right], [12, 12]);

  // The like count reaches the app but is never put on the card.
  assert.equal('likeCount' in app.deck().cards[1] || 'like_count' in app.deck().cards[1], false);
  const shown = cardNodes(1).flatMap((node) => [node.props.children, node.props.accessibilityLabel]).flat().join(' ');
  assert.doesNotMatch(shown, /\b9\b/);

  // The rest of the card is unchanged, and the badge doesn't swallow swipes.
  await app.deck().onSwipedRight(1);
  assert.deepEqual(app.calls.swipes, [['2', true]]);
});

test('trending badge edge cases: odd flags and counts, several flags, other badges, later batches, web', async () => {
  const reason = { kind: 'explore', text: 'Something new to try' };
  let request = 0;
  const batches = [
    // Malformed or missing flags never show the badge; odd like counts never matter.
    [{ ...row(1), is_trending: null }, { ...row(2), is_trending: 1 }, { ...row(3), is_trending: 'true' },
      { ...row(4), is_trending: true, like_count: -5 }, { ...row(5), is_trending: true, like_count: 'many' },
      { ...row(6), is_trending: true }],
    // A later (prefetched) batch: trending alongside a reason and a request, and an old server with no field.
    [{ ...row(7), is_trending: true, reason }, { ...row(8), is_trending: true, requested_by_you: true }, row(9)],
  ];
  for (const platform of ['ios', 'android', 'web']) {
    request = 0;
    const app = screen({ platform, recommend: async () => batches[request++] ?? [] });
    await app.flush();
    const card = (index) => app.nodes(app.deck().renderCard(app.deck().cards[index], index));
    const has = (index, test) => card(index).some(test);
    const badge = (node) => node.type === 'TrendingBadge';

    assert.deepEqual([0, 1, 2, 3, 4, 5].map((i) => has(i, badge)), [false, false, false, true, true, true], platform);

    // Swiping near the end fetches the next batch, and its trending cards get the badge too.
    app.deck().onSwiped(1); await app.flush();
    const ids = app.deck().cards.map((item) => item.id);
    assert.deepEqual(plain(ids), ['1', '2', '3', '4', '5', '6', '7', '8', '9'], platform);
    // Each badge still renders next to the Why button and the requested badge, which keep working.
    assert.ok(has(6, badge) && has(6, (n) => n.props.accessibilityLabel === 'Why am I seeing this?'), platform);
    assert.ok(has(7, badge) && has(7, (n) => n.props.style === undefined ? false : JSON.stringify(n.props.children).includes('You requested this')), platform);
    assert.equal(has(8, badge), false, platform);

    // A card the deck has already removed renders nothing, as before.
    assert.equal(app.deck().renderCard(undefined, 99), null);
  }
});
