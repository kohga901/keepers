const test = require('node:test');
const assert = require('node:assert/strict');
const { createLoader, plain } = require('./helpers/load.cjs');

function render(platform) {
  let gesture;
  const { HistorySwipeable } = createLoader({
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }) },
    'react-native': { Platform: { OS: platform }, View: 'View' },
    'react-native-gesture-handler': {
      GestureDetector: 'GestureDetector',
      usePanGesture: config => (gesture = config),
    },
    'react-native-gesture-handler/ReanimatedSwipeable': { default: 'Swipeable', __esModule: true },
  })('components/HistorySwipeable.tsx');
  const onSwipeableOpen = () => {};
  return { tree: HistorySwipeable({ onSwipeableOpen, children: 'item' }), gesture, onSwipeableOpen };
}

test('web history lets vertical drags win before swipe-to-delete can activate', () => {
  const { tree, gesture, onSwipeableOpen } = render('web');
  assert.equal(tree.props.touchAction, 'pan-y');
  assert.equal(tree.props.gesture, gesture);
  const swipe = tree.props.children.props.children;
  assert.equal(swipe.props.requireToFail, gesture);
  const { activeOffsetY, failOffsetX } = plain(gesture);
  // A typical scrolling drag (12px sideways, 30px down) activates the guard;
  // a deliberate horizontal swipe (30px sideways, 4px down) fails it.
  assert.ok(30 > activeOffsetY[1] && 12 < failOffsetX[1]);
  assert.ok(-30 < activeOffsetY[0] && -12 > failOffsetX[0]);
  assert.ok(30 > failOffsetX[1] && 4 < activeOffsetY[1]);
  assert.ok(swipe.props.dragOffsetFromLeft >= failOffsetX[1]);
  assert.ok(swipe.props.dragOffsetFromRight <= failOffsetX[0]);
  assert.equal(swipe.props.onSwipeableOpen, onSwipeableOpen);
  assert.equal(swipe.props.children, 'item');
});

test('native history keeps the existing swipe behavior', () => {
  for (const platform of ['ios', 'android']) {
    const { tree, onSwipeableOpen } = render(platform);
    assert.equal(tree.type, 'Swipeable');
    assert.equal(tree.props.requireToFail, undefined);
    assert.equal(tree.props.dragOffsetFromRight, undefined);
    assert.equal(tree.props.onSwipeableOpen, onSwipeableOpen);
  }
});
