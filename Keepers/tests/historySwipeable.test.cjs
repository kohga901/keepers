const test = require('node:test');
const assert = require('node:assert/strict');
const { createLoader } = require('./helpers/load.cjs');

function harness() {
  const slots = [], timers = new Map();
  let cursor = 0, tree, deleted = 0, captured = false;
  const hooks = {
    useState(value) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = value;
      return [slots[index], next => { slots[index] = next; }];
    },
    useRef(value) { const index = cursor++; return slots[index] ??= { current: value }; },
    useEffect() {},
  };
  const { HistorySwipeable } = createLoader({
    react: hooks,
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
  }, { setTimeout: fn => { timers.set(1, fn); return 1; }, clearTimeout: id => timers.delete(id) })(
    'components/HistorySwipeable.web.tsx');
  const target = { getBoundingClientRect: () => ({ width: 320 }),
    setPointerCapture() { captured = true; }, hasPointerCapture: () => captured,
    releasePointerCapture() { captured = false; } };
  function render() {
    cursor = 0;
    tree = HistorySwipeable({ children: 'item', renderRightActions: () => 'delete', onSwipeableOpen: () => deleted++ });
  }
  render();
  return {
    event(name, x, y, extra = {}) {
      let prevented = false, stopped = false;
      tree.props[name]({ pointerId: 1, isPrimary: true, button: 0, clientX: x, clientY: y,
        currentTarget: target, target, preventDefault() { prevented = true; }, stopPropagation() { stopped = true; }, ...extra });
      render();
      return { prevented, stopped };
    },
    get tree() { return tree; }, get captured() { return captured; }, get deleted() { return deleted; },
    get transform() { return tree.props.children[1].props.style.transform; },
    flush() { for (const fn of timers.values()) fn(); timers.clear(); },
  };
}

test('first drag on a web row leaves vertical scrolling to the browser, even with sideways drift', () => {
  const h = harness();
  assert.equal(h.tree.props.style.touchAction, 'pan-y pinch-zoom');
  h.event('onPointerDown', 180, 200);
  assert.equal(h.event('onPointerMove', 168, 170).prevented, false);
  assert.equal(h.event('onPointerMove', 110, 100).prevented, false);
  assert.equal(h.captured, false);
  assert.equal(h.transform, 'translateX(0px)');
  h.event('onPointerCancel'); h.flush();
  assert.equal(h.deleted, 0);
});

test('partial delete and reversal both reset capture and allow the next vertical scroll', () => {
  for (const reverse of [false, true]) {
    const h = harness();
    h.event('onPointerDown', 280, 200);
    assert.equal(h.event('onPointerMove', 180, 198).prevented, true);
    assert.equal(h.captured, true);
    if (reverse) h.event('onPointerMove', 278, 198);
    h.event('onPointerUp', reverse ? 278 : 180, 198);
    assert.equal(h.captured, false);
    assert.equal(h.transform, 'translateX(0px)');
    assert.equal(h.event('onClickCapture').stopped, true);
    h.event('onPointerDown', 160, 200);
    assert.equal(h.event('onPointerMove', 158, 100).prevented, false);
    h.event('onPointerCancel'); h.flush();
    assert.equal(h.deleted, 0);
  }
});

test('browser cancellation and lost capture never delete, including past the deletion threshold', () => {
  for (const ending of ['onPointerCancel', 'onLostPointerCapture']) {
    const h = harness();
    h.event('onPointerDown', 280, 200);
    h.event('onPointerMove', 40, 198);
    h.event(ending);
    assert.equal(h.transform, 'translateX(0px)');
    assert.equal(h.captured, false);
    h.event('onPointerDown', 160, 200);
    assert.equal(h.event('onPointerMove', 162, 80).prevented, false);
    h.event('onPointerCancel'); h.flush();
    assert.equal(h.deleted, 0);
  }
});

test('only a released left swipe past half the row deletes, exactly once', () => {
  const h = harness();
  h.event('onPointerDown', 280, 200);
  h.event('onPointerMove', 40, 198);
  h.event('onPointerUp', 40, 198);
  h.event('onLostPointerCapture');
  assert.equal(h.transform, 'translateX(-320px)');
  assert.equal(h.deleted, 0);
  assert.equal(h.event('onClickCapture').stopped, true);
  h.flush(); assert.equal(h.deleted, 1);
});

test('touch capture transferring from a card child to the row does not cancel deletion', () => {
  const h = harness();
  const child = {};
  h.event('onPointerDown', 280, 200, { pointerType: 'touch', target: child });
  h.event('onPointerMove', 240, 198, { pointerType: 'touch', target: child });
  // Touch starts with implicit capture on the child; transferring it to the row
  // emits a bubbling lostpointercapture for that child before the next move.
  h.event('onLostPointerCapture', 240, 198, { pointerType: 'touch', target: child });
  assert.equal(h.captured, true);
  assert.equal(h.transform, 'translateX(-40px)');
  h.event('onPointerMove', 40, 198, { pointerType: 'touch' });
  h.event('onPointerUp', 40, 198, { pointerType: 'touch' });
  h.flush();
  assert.equal(h.deleted, 1);
  assert.equal(h.captured, false);
});

test('tapping still opens details after a canceled swipe; right swipes do not delete', () => {
  const h = harness();
  h.event('onPointerDown', 100, 200);
  h.event('onPointerMove', 300, 200);
  h.event('onPointerUp', 300, 200); h.flush();
  assert.equal(h.deleted, 0);
  h.event('onPointerDown', 100, 200);
  h.event('onPointerUp', 100, 200);
  assert.equal(h.event('onClickCapture').stopped, false);
});

test('native row forwards its content and deletion callback to the original Swipeable', () => {
  const { HistorySwipeable } = createLoader({
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }) },
    'react-native-gesture-handler/ReanimatedSwipeable': { default: 'Swipeable', __esModule: true },
  })('components/HistorySwipeable.tsx');
  const props = { children: 'item', renderRightActions: () => 'delete', onSwipeableOpen() {} };
  const tree = HistorySwipeable(props);
  assert.equal(tree.type, 'Swipeable');
  assert.equal(tree.props.onSwipeableOpen, props.onSwipeableOpen);
  assert.equal(tree.props.children, props.children);
});
