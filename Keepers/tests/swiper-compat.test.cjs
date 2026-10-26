/* global __dirname */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createLoader } = require('./helpers/load.cjs');

test('install patch removes the old API, is repeatable, and rejects unexpected upstream code', () => {
  const script = fs.readFileSync(path.join(__dirname, '../scripts/patch-deck-swiper.cjs'), 'utf8');
  let source = "import { Animated, InteractionManager } from 'react-native'\n" +
    'InteractionManager.runAfterInteractions(this.componentWillUnmountAfterInteractions.bind(this));';
  let writes = 0;
  const requireStub = () => ({
    readFileSync: () => source,
    writeFileSync(filename, patched) { source = patched; writes++; },
  });
  requireStub.resolve = () => 'Swiper.js';
  const run = () => vm.runInNewContext(script, { require: requireStub });

  run();
  assert.ok(!source.includes('InteractionManager'));
  assert.ok(source.includes('this.componentWillUnmountAfterInteractions();'));
  run();
  assert.equal(writes, 1);

  source = 'InteractionManager.unexpectedNewUsage()';
  assert.throws(run, /review the SDK 58 unmount patch/);
  assert.equal(writes, 1);
});

test('installed swiper unmount removes all listeners without accessing InteractionManager', () => {
  const removed = [];
  class Value {
    addListener() {}
    removeAllListeners() { removed.push(this); }
  }
  const native = {
    Animated: { Value, ValueXY: class { x = new Value(); y = new Value(); } },
    Dimensions: {
      get: () => ({ width: 390, height: 844 }),
      addEventListener: () => ({ remove: () => removed.push('dimensions') }),
    },
    PanResponder: { create: () => ({}) },
    get InteractionManager() { throw new Error('InteractionManager has been removed'); },
  };
  const Swiper = createLoader({ 'react-native': native, './styles': {} })(
    'node_modules/react-native-deck-swiper/Swiper.js',
  ).default;
  const swiper = new Swiper({ ...Swiper.defaultProps, cards: [] });

  swiper.componentWillUnmount();

  assert.equal(swiper._mounted, false);
  assert.deepEqual(removed, [swiper.state.pan.x, swiper.state.pan.y, 'dimensions']);
});
