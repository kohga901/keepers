const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Buffer } = require('node:buffer');
const { preparePagesAssets } = require('../scripts/prepare-pages-assets.cjs');

test('Pages export retains binary assets and resolves rewritten bundle URLs without node_modules directories', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'keepers-pages-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const fonts = path.join(root, 'assets/node_modules/fonts');
  fs.mkdirSync(fonts, { recursive: true });
  const bytes = Buffer.from([0, 1, 0, 0, 255]);
  fs.writeFileSync(path.join(fonts, 'test.ttf'), bytes);
  fs.writeFileSync(path.join(root, 'index.html'), '<script src="app.js"></script>');
  fs.writeFileSync(path.join(root, 'app.js'), 'const font="/assets/node_modules/fonts/test.ttf";');
  preparePagesAssets(root);
  assert.equal(fs.existsSync(path.join(root, 'assets/node_modules')), false);
  assert.deepEqual(fs.readFileSync(path.join(root, 'assets/vendor/fonts/test.ttf')), bytes);
  assert.equal(fs.existsSync(path.join(root, 'app.js')), false);
  assert.equal(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), '<script src="app.pages.js"></script>');
  const bundle = fs.readFileSync(path.join(root, 'app.pages.js'), 'utf8');
  assert.equal(bundle, 'const font="/assets/vendor/fonts/test.ttf";');
  preparePagesAssets(root);
  assert.equal(fs.readFileSync(path.join(root, 'app.pages.js'), 'utf8'), bundle);
});

test('Pages preparation rejects an unexported directory before changing it', () => {
  assert.throws(() => preparePagesAssets(path.join(os.tmpdir(), 'keepers-no-export-here')), /Expected an exported web directory/);
});
