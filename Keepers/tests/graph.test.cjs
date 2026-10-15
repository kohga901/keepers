/* global __dirname */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
function load(relative, stubs = {}, discardFunctionSource = false) {
  const filename = path.join(root, relative);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    fileName: filename,
  }).outputText;
  const module = { exports: {} };
  const context = vm.createContext({ module, exports: module.exports, require(name) {
    if (Object.hasOwn(stubs, name)) return stubs[name];
    if (name.endsWith('utils/styleMap')) return load('utils/styleMap.ts', {}, discardFunctionSource);
    if (name.endsWith('utils/graphLikes')) return load('utils/graphLikes.ts', {}, discardFunctionSource);
    if (name.endsWith('utils/price')) return load('utils/price.ts', {}, discardFunctionSource);
    if (name.endsWith('data/nodeData.json')) return require(path.join(root, 'data/nodeData.json'));
    if (name === 'react-native') return { StyleSheet: { create: (styles) => styles, absoluteFill: {} } };
    return {};
  }, console, URL, AbortController, setTimeout, clearTimeout });
  if (discardFunctionSource) vm.runInContext('Function.prototype.toString = function () { return "function () { [bytecode] }"; };', context);
  vm.runInContext(code, context, { filename });
  return module.exports;
}
const { MAP_GEOMETRY_SOURCE, validMapPosition, normalizeMapPoints, parseMapFrame } = load('utils/styleMap.ts');
const { GraphLikes } = load('utils/graphLikes.ts');
const { buildPlotHtml } = load('app/(tabs)/graph.tsx');
const g = vm.runInNewContext('(' + MAP_GEOMETRY_SOURCE + ')()');
const layout = { width: 390, height: 660, top: 180, bottom: 174 };
const catalog = [];
for (let y = -6; y <= 6; y += .5) for (let x = -6; x <= 6; x += .5) catalog.push({ clothesId: catalog.length + 1, x, y });
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test('positions reject missing coordinates and malformed/duplicate nodes', () => {
  assert.equal(g.validPosition({ x: null, y: 0 }), false);
  assert.equal(g.validPosition({ x: 0, y: Infinity }), false);
  assert.equal(g.validPosition({ x: '0', y: 1 }), false);
  assert.equal(g.validPosition({ x: 0, y: 0 }), true);
  assert.equal(normalizeMapPoints([null, {}, { clothesId: 1, x: 2, y: 3 }, { clothesId: 1, x: 4, y: 5 }]).length, 1);
  for (const p of [null, {}, { x: null, y: 0 }, { x: '0', y: 1 }, { x: 0, y: 0 }]) assert.equal(validMapPosition(p), g.validPosition(p));
});
test('camera projection round-trips and zoom preserves the pinch anchor', () => {
  for (const mode of ['focus', 'whole']) {
    const camera = { x: -1.2, y: 3.1, scale: 31 }, p = { x: 2.3, y: -4.1 };
    const projected = g.project(p, camera, layout, mode), restored = g.unproject(projected, camera, layout, mode);
    close(restored.x, p.x); close(restored.y, p.y);
    const next = g.zoom(camera, layout, mode, 1.7, projected, 1, 1000);
    const anchored = g.project(p, next, layout, mode);
    close(anchored.x, projected.x); close(anchored.y, projected.y);
  }
});
test('whole-catalog fit respects header/dock insets on narrow screens', () => {
  for (const width of [273, 320, 390]) {
    const bounds = { ...layout, width }, camera = g.fit(catalog, bounds);
    for (const p of catalog) {
      const q = g.project(p, camera, bounds, 'whole');
      assert.ok(q.x >= 27 && q.x <= width - 27);
      assert.ok(q.y >= bounds.top + 19 && q.y <= bounds.height - bounds.bottom - 19);
    }
  }
  assert.ok(Number.isFinite(g.fit([], layout).scale));
  assert.ok(Number.isFinite(g.fit([{ clothesId: 1, x: 0, y: 0 }], layout).scale));
});
test('lens boundary and representative thumbnails exclude controls, dock and taste label', () => {
  const camera = { x: 0, y: 0, scale: 40 }, r = g.radius(layout) / camera.scale;
  assert.equal(g.inFocus({ x: r, y: 0 }, camera, layout, 'focus'), true);
  assert.equal(g.inFocus({ x: r + .1, y: 0 }, camera, layout, 'focus'), false);
  for (const mode of ['focus', 'whole']) {
    const taste = g.tasteAnchor({ x: 0, y: 0 }, camera, layout, mode);
    const previews = g.previews(catalog, camera, layout, mode, null, { x: 0, y: 0 });
    assert.ok(previews.length > 2 && previews.length <= (mode === 'focus' ? 7 : 11));
    for (const p of previews) {
      assert.ok(g.safePreview(p, layout, taste));
      assert.ok(g.inFocus(catalog[p.clothesId - 1], camera, layout, mode));
      for (const other of previews) if (p !== other) assert.ok(Math.hypot(p.x - other.x, p.y - other.y) >= 60);
    }
  }
});
test('native bridge rejects invented IDs, malformed positions, duplicate previews and invalid counts', () => {
  const ids = new Set(catalog.map((p) => p.clothesId));
  const valid = { type: 'frame', mode: 'focus', count: 3, nearTaste: false, previews: [{ clothesId: 1, x: 50, y: 240 }], taste: null };
  assert.ok(parseMapFrame(valid, ids, layout));
  for (const bad of [{ ...valid, count: ids.size + 1 }, { ...valid, taste: { x: NaN, y: 10 } },
    { ...valid, previews: [{ clothesId: -1, x: 50, y: 250 }] }, { ...valid, previews: [...valid.previews, ...valid.previews] },
    { ...valid, previews: [{ clothesId: 1, x: 999, y: 20 }] }]) assert.equal(parseMapFrame(bad, ids, layout), null);
});
test('likes require loaded history, preserve passed/liked states and serialize training requests', () => {
  const likes = new GraphLikes();
  assert.equal(likes.begin(1), false);
  likes.history = { liked: new Set([1]), passed: new Set([2]) };
  assert.equal(likes.status(1), 'liked'); assert.equal(likes.status(2), 'passed');
  assert.equal(likes.begin(1), false); assert.equal(likes.begin(2), false);
  assert.equal(likes.begin(3), true); assert.equal(likes.begin(3), false); assert.equal(likes.begin(4), false);
  likes.finish(99, true); assert.equal(likes.pending, 3);
  likes.finish(3, true); assert.equal(likes.status(3), 'liked'); assert.equal(likes.begin(3), false);
});
test('uncertain like response blocks further training until history reconciliation', () => {
  const likes = new GraphLikes(); likes.history = { liked: new Set(), passed: new Set() };
  assert.ok(likes.begin(1)); likes.finish(1, false);
  assert.equal(likes.status(1), 'unknown'); assert.equal(likes.begin(1), false); assert.equal(likes.begin(2), false);
  likes.history = { liked: new Set([1]), passed: new Set() };
  assert.equal(likes.begin(1), false); assert.equal(likes.begin(2), true);
});

function renderer(preference = null, positions = catalog, builder = buildPlotHtml) {
  const html = builder(positions), script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const messages = [], callbacks = [], listeners = new Map(), arcs = [];
  let now = 1000;
  const ctx = new Proxy({}, { get: (_, name) => name === 'arc' ? (...args) => arcs.push(args) : () => {} });
  const canvas = { getContext: () => ctx, addEventListener: (name, fn) => listeners.set(name, fn),
    setPointerCapture() {}, getBoundingClientRect: () => ({ left: 0, top: 0 }) };
  const window = { devicePixelRatio: 1, ReactNativeWebView: { postMessage: (message) => messages.push(JSON.parse(message)) } };
  vm.runInNewContext(script, { window, document: { getElementById: () => canvas },
    requestAnimationFrame: (fn) => callbacks.push(fn), setTimeout: (fn) => callbacks.push(fn), Date: { now: () => now } });
  const config = { type: 'configure', initialize: true, layout, preference,
    colors: { background: '#f2ebdd', grid: '#d9e2dc', point: '#6d9773', selected: '#ffba00', preference: '#24a7ff', text: '#1e6b4c', surface: '#fff' } };
  function flush() { for (let i = 0; callbacks.length && i < 20; i++) { now += 50; callbacks.shift()(); } }
  function command(message) { window.keepersMap(message); flush(); }
  command(config);
  return { messages, config, arcs, command, flush,
    frame: () => messages.filter((m) => m.type === 'frame').at(-1),
    event: (name, props) => { listeners.get(name)({ preventDefault() {}, ...props }); flush(); } };
}
test('actual WebView script starts without a fabricated taste marker', () => {
  const app = renderer(); assert.equal(app.messages[0].type, 'ready');
  assert.equal(app.frame().mode, 'whole'); assert.equal(app.frame().taste, null); assert.equal(app.frame().count, catalog.length);
});
test('WebView still renders when Hermes discards function source', () => {
  const builder = load('app/(tabs)/graph.tsx', {}, true).buildPlotHtml;
  const app = renderer({ x: 0, y: 0 }, catalog, builder);
  assert.equal(app.frame().mode, 'focus'); assert.ok(app.frame().count > 0);
});
test('actual WebView script widens the lens and preserves panning across selection/config updates', () => {
  const app = renderer({ x: 0, y: 0 }), initial = app.frame();
  assert.equal(initial.mode, 'focus');
  app.command({ type: 'zoom', factor: 1 / 1.4 }); assert.ok(app.frame().count > initial.count);
  const before = app.frame().taste;
  app.event('pointerdown', { pointerId: 1, clientX: 100, clientY: 300 });
  app.event('pointermove', { pointerId: 1, clientX: 110, clientY: 310 });
  app.event('pointerup', { pointerId: 1, clientX: 110, clientY: 310 });
  close(app.frame().taste.x, before.x + 10); close(app.frame().taste.y, before.y + 10);
  const panned = app.frame().taste;
  app.command({ type: 'select', id: app.frame().previews[0].clothesId });
  app.command({ ...app.config, colors: { ...app.config.colors, point: '#777' } });
  app.command({ type: 'clear' });
  close(app.frame().taste.x, panned.x); close(app.frame().taste.y, panned.y);
  app.command({ type: 'taste' }); close(app.frame().taste.x, initial.taste.x); close(app.frame().taste.y, initial.taste.y);
});
test('actual WebView next selection and pinch do not reset the camera or accidentally tap a piece', () => {
  const app = renderer({ x: 0, y: 0 });
  app.command({ type: 'next' }); const first = app.messages.filter((m) => m.type === 'select').at(-1);
  assert.ok(first && catalog.some((p) => p.clothesId === first.id));
  app.command({ type: 'next' }); assert.notEqual(app.messages.filter((m) => m.type === 'select').at(-1).id, first.id);
  const before = app.messages.filter((m) => m.type === 'select').length;
  app.event('pointerdown', { pointerId: 1, clientX: 100, clientY: 300 });
  app.event('pointerdown', { pointerId: 2, clientX: 180, clientY: 300 });
  app.event('pointermove', { pointerId: 2, clientX: 200, clientY: 300 });
  app.event('pointerup', { pointerId: 2, clientX: 200, clientY: 300 });
  app.event('pointerup', { pointerId: 1, clientX: 100, clientY: 300 });
  assert.equal(app.messages.filter((m) => m.type === 'select').length, before);
  app.command({ type: 'mode', mode: 'whole' }); assert.equal(app.frame().count, catalog.length);
});

test('Show a piece remains keyboard-usable when the taste badge excludes every thumbnail', () => {
  const app = renderer({ x: 0, y: 0 }, [{ clothesId: 1, x: 0, y: 0 }]);
  assert.equal(app.frame().previews.length, 0);
  app.command({ type: 'next' }); assert.equal(app.messages.filter((m) => m.type === 'select').at(-1).id, 1);
});

test('Whole graph refits the catalog even when already in overview mode', () => {
  const app = renderer({ x: 0, y: 0 });
  app.command({ type: 'mode', mode: 'whole' }); const original = app.frame().taste;
  app.event('pointerdown', { pointerId: 1, clientX: 100, clientY: 300 });
  app.event('pointermove', { pointerId: 1, clientX: 120, clientY: 310 });
  app.event('pointerup', { pointerId: 1, clientX: 120, clientY: 310 });
  app.command({ type: 'mode', mode: 'whole' }); close(app.frame().taste.x, original.x); close(app.frame().taste.y, original.y);
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// Execute the screen's real callbacks with deterministic hooks and native component stubs.
function nativeScreen(overrides = {}) {
  let slots = [], cursor = 0, effects = [], dirty = true, focused = true, tree, renderComponent;
  const calls = { metadata: [], likes: [], lookup: [], scripts: [] };
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const hooks = {
    useState(initial) {
      const i = cursor++;
      if (!slots[i]) slots[i] = { value: typeof initial === 'function' ? initial() : initial,
        set(next) { slots[i].value = typeof next === 'function' ? next(slots[i].value) : next; dirty = true; } };
      return [slots[i].value, slots[i].set];
    },
    useRef(initial) { const i = cursor++; if (!slots[i]) slots[i] = { current: initial }; return slots[i]; },
    useMemo(fn, deps) { const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { deps, value: fn() }; return slots[i].value; },
    useCallback(fn, deps) { return hooks.useMemo(() => fn, deps); },
    useEffect(fn, deps) { const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) {
      const old = slots[i]; slots[i] = { deps, cleanup: old?.cleanup };
      effects.push(() => { slots[i].cleanup?.(); slots[i].cleanup = fn(); });
    } },
  };
  const jsx = (type, props) => {
    if (type === 'WebView' && props.ref) props.ref.current = { injectJavaScript: (script) => calls.scripts.push(script) };
    return { type, props: props || {} };
  };
  const theme = load('constants/theme.ts').lightTheme;
  const stubs = {
    react: hooks, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    'react-native': { View: 'View', Pressable: 'Pressable', ActivityIndicator: 'Spinner', Alert: { alert() {} }, StyleSheet: { create: (x) => x, absoluteFill: {} } },
    '@expo/vector-icons/Ionicons': 'Icon', 'expo-image': { Image: 'Image' },
    'expo-router': { router: { push() {} } }, 'expo-web-browser': { openBrowserAsync: async () => {} },
    'react-native-webview': { WebView: 'WebView' },
    'expo-router/react-navigation': { useHeaderHeight: () => 80, useIsFocused: () => focused,
      useFocusEffect: (fn) => hooks.useEffect(() => focused ? fn() : undefined, [focused, fn]) },
    '../../components/Text': { Text: 'Text' }, '../../components/ai/ImageLookupModal': { ImageLookupModal: 'LookupModal' },
    '../../hooks/useAppTheme': { useAppTheme: () => ({ theme }) },
    '../../contexts/PriceDisplayContext': { usePriceDisplay: () => ({ showPriceAsTier: false }) },
    '../../utils/supabase': { supabase: { auth: { getUser: async () => ({ data: { user: { id: 'test-user' } }, error: null }) } } },
    '../../services/dataServices': {
      getUserCoordinates: async () => null,
      getGraphHistory: (...args) => overrides.history ? overrides.history(...args) : Promise.resolve({ liked: new Set(), passed: new Set() }),
      getGraphItems: (...args) => { calls.metadata.push(args); return overrides.metadata ? overrides.metadata(...args) : Promise.resolve(args[0].map((id) => ({ item_id: id, item_name: `Piece ${id}`, item_img: `https://example.com/${id}.jpg`, item_price: '$35', item_gender: '', item_web_listing: 'https://example.com/shop' }))); },
    },
    '../../services/serverApi': { sendSwipeToServer: (...args) => { calls.likes.push(args); return overrides.like ? overrides.like(...args) : Promise.resolve(true); } },
    '../../services/ai': { lookupPurchasableItem: (...args) => { calls.lookup.push(args); return overrides.lookup ? overrides.lookup(...args) : Promise.resolve({}); },
      toAiLookupError: (error) => ({ code: error.name === 'AbortError' ? 'cancelled' : 'network', message: error.message }) },
  };
  const component = load('app/(tabs)/graph.tsx', stubs).default;
  renderComponent = () => component();
  function render() { cursor = 0; dirty = false; tree = renderComponent(); }
  function nodes() {
    const all = [];
    function visit(node) { if (!node || typeof node !== 'object') return; if (Array.isArray(node)) { node.forEach(visit); return; } all.push(node); visit(node.props?.children); }
    visit(tree); return all;
  }
  function find(predicate) { const match = nodes().find(predicate); assert.ok(match, 'Expected native node'); return match; }
  async function flush() { for (let i = 0; i < 25; i++) {
    if (dirty) render(); const pending = effects; effects = []; pending.forEach((fn) => fn());
    await new Promise((done) => require('node:timers').setImmediate(done));
    if (!dirty && !effects.length) return;
  } throw new Error('Screen did not settle'); }
  return { calls, flush, find, nodes,
    text: () => nodes().filter((n) => n.type === 'Text').map((n) => n.props.children).flat().join(' '),
    async select(id) { find((n) => n.type === 'WebView').props.onMessage({ nativeEvent: { data: JSON.stringify({ type: 'select', id }) } }); await flush(); },
    async press(label) { find((n) => n.type === 'Pressable' && n.props.accessibilityLabel === label).props.onPress(); await flush(); },
    async focus(value) { focused = value; dirty = true; await flush(); },
    async isolatePhoto() {
      const photo = find((n) => typeof n.type === 'function' && n.type.name === 'ClothingPhoto');
      slots = []; effects = []; renderComponent = () => photo.type(photo.props); dirty = true; await flush();
    },
  };
}

test('screen batches metadata, ignores stale selection results and reuses cached pieces', async () => {
  const first = deferred(), second = deferred();
  const app = nativeScreen({ metadata: (ids) => ids[0] === 1 ? first.promise : second.promise });
  await app.flush(); await app.select(1); await app.select(2);
  second.resolve([{ item_id: 2, item_name: 'Current piece', item_img: '' }]); await app.flush();
  first.resolve([{ item_id: 1, item_name: 'Previous piece', item_img: '' }]); await app.flush();
  assert.ok(app.text().includes('Current piece')); assert.ok(!app.text().includes('Previous piece'));
  await app.select(1); assert.ok(app.text().includes('Previous piece')); assert.equal(app.calls.metadata.length, 2);
});
test('screen cancels old metadata on blur and retries it when revisited', async () => {
  const first = deferred(); let attempt = 0;
  const app = nativeScreen({ metadata: () => ++attempt === 1 ? first.promise : Promise.resolve([{ item_id: 1, item_name: 'Fresh piece' }]) });
  await app.flush(); await app.select(1); const signal = app.calls.metadata[0][1];
  await app.focus(false); assert.ok(signal.aborted);
  first.resolve([{ item_id: 1, item_name: 'Stale piece' }]); await app.flush();
  assert.ok(!app.text().includes('Stale piece'));
  await app.focus(true); assert.ok(app.text().includes('Fresh piece')); assert.equal(app.calls.metadata.length, 2);
});
test('screen presents failed metadata and failed images with usable fallbacks', async () => {
  const failure = nativeScreen({ metadata: async () => { throw new Error('offline'); } });
  await failure.flush(); await failure.select(1); assert.ok(failure.text().includes('This piece could not be loaded.'));
  const app = nativeScreen(); await app.flush(); await app.select(1); await app.isolatePhoto();
  app.find((n) => n.type === 'Image').props.onError(); await app.flush();
  assert.ok(!app.nodes().some((n) => n.type === 'Image')); assert.ok(!app.nodes().some((n) => n.type === 'Spinner'));
  assert.ok(app.nodes().some((n) => n.type === 'Icon' && n.props.name === 'shirt-outline'));
});
test('screen blocks double taps and trains through the existing swipe service exactly once', async () => {
  const response = deferred(), app = nativeScreen({ like: () => response.promise });
  await app.flush(); await app.select(1);
  const button = app.find((n) => n.type === 'Pressable' && n.props.accessibilityLabel === 'Like this piece and update your taste');
  button.props.onPress(); button.props.onPress(); await app.flush();
  assert.equal(app.calls.likes.length, 1); assert.equal(app.calls.likes[0][0], '1'); assert.equal(app.calls.likes[0][1], true);
  response.resolve(true); await app.flush(); assert.ok(app.text().includes('Liked'));
});
test('screen preserves passed reactions and requires verification after an uncertain save', async () => {
  let histories = 0; const check = deferred();
  const app = nativeScreen({ history: () => ++histories === 1 ? Promise.resolve({ liked: new Set(), passed: new Set([2]) }) : check.promise, like: async () => false });
  await app.flush(); await app.select(2);
  assert.equal(app.find((n) => n.type === 'Pressable' && n.props.accessibilityLabel === 'Previously passed').props.disabled, true);
  await app.select(1); await app.press('Like this piece and update your taste');
  assert.ok(app.text().includes('Checking…'));
  check.resolve({ liked: new Set([1]), passed: new Set([2]) }); await app.flush();
  assert.ok(app.text().includes('Liked')); assert.equal(app.calls.likes.length, 1);
});
test('screen only starts AI lookup on Find it and ignores results after dismissal', async () => {
  const result = deferred(), app = nativeScreen({ lookup: () => result.promise });
  await app.flush(); await app.select(1); assert.equal(app.calls.lookup.length, 0);
  await app.press('Find this piece with AI'); assert.equal(app.calls.lookup.length, 1);
  const signal = app.calls.lookup[0][0].signal;
  app.find((n) => n.type === 'LookupModal').props.onClose(); await app.flush(); assert.ok(signal.aborted);
  result.resolve({ summary: 'Late result' }); await app.flush();
  const modal = app.find((n) => n.type === 'LookupModal'); assert.equal(modal.props.item, null); assert.equal(modal.props.result, null);
});

test('catalog service fetches one deduplicated batch and propagates cancellation/errors', async () => {
  let queries = 0, selectedIds, passedSignal, fail = false;
  const service = load('services/dataServices.ts', { '../utils/supabase': { supabase: { from(table) {
    assert.equal(table, 'Clothing'); queries++;
    return { select() { return this; }, in(column, ids) { assert.equal(column, 'item_id'); selectedIds = ids; return this; },
      async abortSignal(signal) { passedSignal = signal; return { data: [{ item_id: 2 }], error: fail ? new Error('offline') : null }; } };
  } } } });
  const signal = new AbortController().signal;
  await service.getGraphItems([], signal); assert.equal(queries, 0);
  const rows = await service.getGraphItems([2, 2, 3, -1, NaN], signal);
  assert.equal(queries, 1); assert.deepEqual(Array.from(selectedIds), [2, 3]); assert.equal(passedSignal, signal); assert.equal(rows[0].item_id, 2);
  fail = true; await assert.rejects(service.getGraphItems([2], signal), /could not be loaded/);
});
test('reaction service pages both histories past the default row limit', async () => {
  const requests = [];
  const service = load('services/dataServices.ts', { '../utils/supabase': { supabase: { from(table) {
    let offset;
    return { select() { return this; }, eq(column, id) { assert.equal(column, 'user_id'); assert.equal(id, 'owner'); return this; },
      order() { return this; }, range(start) { offset = start; return this; }, async abortSignal() {
        requests.push([table, offset]);
        return { data: Array.from({ length: offset === 0 ? 500 : 1 }, (_, i) => ({ clothes_id: offset + i + 1 })), error: null };
      } };
  } } } });
  const history = await service.getGraphHistory('owner', new AbortController().signal);
  assert.equal(history.liked.size, 501); assert.equal(history.passed.size, 501);
  assert.equal(requests.length, 4); assert.ok(requests.some(([table, offset]) => table === 'Likes' && offset === 500));
});
test('coordinate service never converts absent or blank coordinates to a personal origin', async () => {
  for (const data of [null, { x: null, y: 3 }, { x: ' ', y: '0' }, { x: 'NaN', y: 0 }]) {
    const service = load('services/dataServices.ts', { '../utils/supabase': { supabase: { from() {
      return { select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data, error: null }) };
    } } } });
    assert.equal(await service.getUserCoordinates('owner'), null);
  }
});
