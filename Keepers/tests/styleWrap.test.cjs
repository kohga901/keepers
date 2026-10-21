/* global __dirname */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
function load(relative) {
  const code = ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports });
  return module.exports;
}
const { GARMENT_ICONS, FIT_ICONS, styleWrapDetailIcon } = load('utils/styleWrapIcons.ts');
const { buildStyleWrap } = load('utils/styleWrap.ts');
const icon = (category, tag) => styleWrapDetailIcon(category, tag, '#1E6B4C');

test('every catalog garment and fit tag has a valid themed SVG icon', () => {
  const catalog = fs.readFileSync(path.join(root, 'data/tag_csv/tag_list.csv'), 'utf8');
  for (const line of catalog.trim().split(/\r?\n/).slice(1)) {
    const [tag, category] = line.split(',');
    if (category !== 'garment-type' && category !== 'fit') continue;
    assert.ok(Object.hasOwn(category === 'fit' ? FIT_ICONS : GARMENT_ICONS, tag), `Missing ${tag}`);
    const svg = decodeURIComponent(icon(category, tag).split(',')[1]);
    assert.ok(svg.includes('stroke="#1E6B4C"'));
    assert.match(svg, /<path d="[ML][^"]+"/);
    assert.ok(!svg.includes('undefined'));
  }
});

test('different garment silhouettes and fit shapes are distinct', () => {
  const garments = ['t-shirt', 'pants', 'shorts', 'dress', 'skirt', 'hoodie', 'socks'];
  assert.equal(new Set(garments.map((tag) => icon('garment-type', tag))).size, garments.length);
  const fits = ['slim-fit', 'wide-leg', 'oversized', 'straight-leg', 'flared', 'tapered-leg'];
  assert.equal(new Set(fits.map((tag) => icon('fit', tag))).size, fits.length);
});

test('missing and unknown tags use their category fallback', () => {
  for (const category of ['garment-type', 'fit']) {
    for (const tag of ['', 'future-tag', 'toString', '__proto__']) {
      assert.equal(icon(category, tag), icon(category, undefined));
    }
  }
  assert.notEqual(icon('fit', undefined), icon('garment-type', undefined));
});

test('icons follow the winning favorites when likes change', () => {
  const data = {
    likes: [{ id: 'shirt' }], dislikeIds: [], tagsUnavailable: false,
    tags: [
      { itemId: 'shirt', category: 'garment-type', name: 't-shirt' },
      { itemId: 'shirt', category: 'fit', name: 'slim-fit' },
      { itemId: 'pants', category: 'garment-type', name: 'pants' },
      { itemId: 'pants', category: 'fit', name: 'wide-leg' },
    ],
  };
  const before = buildStyleWrap(data);
  const after = buildStyleWrap({ ...data, likes: [{ id: 'pants' }] });
  assert.notEqual(icon('garment-type', before.garments[0].name), icon('garment-type', after.garments[0].name));
  assert.notEqual(icon('fit', before.fits[0].name), icon('fit', after.fits[0].name));
});
