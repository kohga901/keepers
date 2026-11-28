const test = require('node:test');
const assert = require('node:assert/strict');
const { createLoader, plain } = require('./helpers/load.cjs');
const { toReason, reasonIcon } = createLoader()('utils/reason.ts');

test('a server reason maps to what the card shows', () => {
  assert.deepEqual(plain(toReason({ kind: 'similar_to_like', text: ' Because you liked Piece 3 ', liked_item_id: 3,
    liked_item_name: 'Piece 3', liked_item_img: 'https://images.test/3', tags: [] })), {
    kind: 'similar_to_like', text: 'Because you liked Piece 3', likedItemName: 'Piece 3',
    likedItemImageUrl: 'https://images.test/3', tags: [] });
  assert.deepEqual(plain(toReason({ kind: 'liked_tags', text: 'You often like Black items', tags: ['black', '', null] })).tags, ['black']);
});

test('missing or empty reasons show nothing', () => {
  for (const row of [undefined, null, { kind: 'explore', text: '' }, { kind: 'explore', text: '   ' }, { kind: 'explore' }]) {
    assert.equal(toReason(row), undefined);
  }
});

test('liked item images are only used from secure links', () => {
  for (const url of ['http://images.test/3', 'javascript:alert(1)', 'not a url', '', null]) {
    assert.equal(toReason({ kind: 'similar_to_like', text: 'x', liked_item_img: url }).likedItemImageUrl, undefined);
  }
});

test('each reason kind has an icon and unknown kinds fall back to help', () => {
  assert.equal(reasonIcon('similar_to_like'), 'heart');
  assert.equal(reasonIcon('filter'), 'funnel');
  assert.equal(reasonIcon('something_new'), 'help-circle');
  assert.equal(toReason({ kind: '', text: 'x' }).kind, 'unknown');
});
