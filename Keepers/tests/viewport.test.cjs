/* global __dirname */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const script = fs.readFileSync(path.join(__dirname, '../public/viewport.js'), 'utf8');

test('web shell follows the visible height as browser bars and keyboard change', () => {
  const listeners = {}, styles = {};
  const viewport = { height: 700, scale: 1, addEventListener: (name, fn) => { listeners[name] = fn; } };
  vm.runInNewContext(script, {
    window: { visualViewport: viewport, innerHeight: 844, addEventListener() {} },
    document: { documentElement: { style: { setProperty: (name, value) => { styles[name] = value; } } } },
  });
  assert.equal(styles['--app-height'], '700px');
  for (const height of [780, 450, 700]) {
    viewport.height = height; listeners.resize();
    assert.equal(styles['--app-height'], `${height}px`);
  }
  viewport.height = 350; viewport.scale = 2; listeners.resize();
  assert.equal(styles['--app-height'], '700px');
});

test('web shell falls back to window height when VisualViewport is unavailable', () => {
  let listener, height;
  const window = { innerHeight: 640, addEventListener: (_, fn) => { listener = fn; } };
  vm.runInNewContext(script, { window, document: { documentElement: { style: { setProperty: (_, value) => { height = value; } } } } });
  assert.equal(height, '640px');
  window.innerHeight = 480; listener();
  assert.equal(height, '480px');
});
