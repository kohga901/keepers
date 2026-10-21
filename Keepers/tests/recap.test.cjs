const test = require('node:test');
const assert = require('node:assert/strict');
const { createLoader, plain } = require('./helpers/load.cjs');
const { buildStyleWrap, selectRandomKeepers } = createLoader()('utils/styleWrap.ts');

test('recap counts unique saved reactions and ranks tags only on liked items', () => {
  const result = buildStyleWrap({ likes: [{ id: '1' }, { id: '1' }, { id: '2' }, { id: '3' }],
    dislikeIds: ['3', '4', '4'], tagsUnavailable: false,
    tags: [{ itemId: '1', category: 'style', name: 'casual' }, { itemId: '1', category: 'style', name: 'casual' },
      { itemId: '2', category: 'style', name: 'casual' }, { itemId: '2', category: 'style', name: 'minimal' },
      { itemId: '4', category: 'style', name: 'formal' }, { itemId: '3', category: 'color', name: 'black' }] });
  assert.equal(result.total, 5);
  assert.equal(result.likeRate, 60);
  assert.equal(result.dislikeRate, 40);
  assert.deepEqual(plain(result.styles), [{ name: 'casual', count: 2, percent: 100 }, { name: 'minimal', count: 1, percent: 50 }]);
  assert.equal(result.taggedLikeCount, 3);
  assert.equal(result.styleTaggedCount, 2);
});

test('recap uses the five-like threshold, handles tied styles and advances completed milestones', () => {
  function recap(count, tags = []) {
    return buildStyleWrap({ likes: Array.from({ length: count }, (_, i) => ({ id: String(i) })), dislikeIds: [], tags, tagsUnavailable: false });
  }
  const tied = [{ itemId: '0', name: 'y2k', category: 'style' }, { itemId: '1', name: 'casual', category: 'style' }];
  assert.equal(recap(4, tied).personality.title, 'Style in the making');
  assert.equal(recap(5, tied).personality.title, 'The Style Mixer');
  assert.equal(recap(5, tied.slice(0, 1)).personality.title, 'The Y2K Edit');
  assert.equal(recap(10).milestone, 25);
  assert.equal(recap(1000).milestone, 1500);
  assert.equal(recap(0).likeRate, 0);
  assert.equal(recap(0).dislikeRate, 0);
});

test('featured keepers only include usable photos and shopping links without mutating history', () => {
  const items = [{ id: '1', imageUrl: 'a', itemUrl: 'a' }, { id: '2', imageUrl: null, itemUrl: 'b' },
    { id: '3', imageUrl: 'c', itemUrl: null }, { id: '4', imageUrl: 'd', itemUrl: 'd' }];
  const before = structuredClone(items);
  assert.deepEqual(plain(selectRandomKeepers(items, 5, () => 0)), [items[3], items[0]]);
  assert.deepEqual(items, before);
});

// Simulate range and IN at the service boundary, including a final empty page.
function serviceFixture({ failure, cancel = false, signedIn = true, count = 501 } = {}) {
  const controller = new AbortController(), queries = [];
  const tables = {
    Likes: Array.from({ length: count }, (_, i) => ({ clothes_id: i + 1, Clothing: i === 0 ? null : { item_name: `Piece ${i + 1}` } })),
    Dislikes: Array.from({ length: 500 }, (_, i) => ({ clothes_id: 2000 + i, Clothing: null })),
    Tags: Array.from({ length: 501 }, (_, i) => ({ Tag: `tag-${i}`, Category: 'style' })),
    Tagged_Clothing: Array.from({ length: 501 }, (_, i) => ({ clothes_id: '1', Tag: `tag-${i}` })),
  };
  const supabase = { auth: { getUser: async () => ({ data: { user: signedIn ? { id: 'alice' } : null }, error: null }) },
    from(table) {
      let start = 0, end = Infinity, ids;
      return { select() { return this; }, eq(column, user) { assert.equal(column, 'user_id'); assert.equal(user, 'alice'); return this; },
        order() { return this; }, range(a, b) { start = a; end = b; return this; },
        in(column, values) { assert.equal(column, 'clothes_id'); ids = values; assert.ok(ids.length <= 100); return this; },
        async abortSignal(signal) {
          assert.equal(signal, controller.signal); queries.push([table, start]);
          if (table === failure) { if (cancel) controller.abort(); return { data: null, error: new Error('unavailable') }; }
          const rows = tables[table].filter((row) => !ids || ids.includes(String(row.clothes_id)));
          return { data: rows.slice(start, end + 1), error: null };
        } };
    } };
  return { service: createLoader({ '../utils/supabase': { supabase } })('services/styleWrapService.ts'), controller, queries };
}

test('recap service reads all reaction/tag pages and chunks liked IDs without dropping relationships', async () => {
  const app = serviceFixture();
  const data = await app.service.getStyleWrap(app.controller.signal);
  assert.equal(data.likes.length, 501);
  assert.equal(data.dislikeIds.length, 500);
  assert.equal(data.likes[0].id, '1');
  assert.equal(data.likes[0].name, null);
  assert.equal(data.tags.length, 501);
  assert.equal(data.tags.at(-1).category, 'style');
  assert.equal(data.tagsUnavailable, false);
  for (const table of ['Likes', 'Dislikes', 'Tags', 'Tagged_Clothing']) {
    assert.ok(app.queries.some(([name, offset]) => name === table && offset === 500), table);
  }
});

test('missing tag data preserves reaction counts but missing reactions fail the recap', async () => {
  for (const failure of ['Tags', 'Tagged_Clothing']) {
    const app = serviceFixture({ failure });
    const data = await app.service.getStyleWrap(app.controller.signal);
    assert.equal(data.likes.length, 501);
    assert.equal(data.dislikeIds.length, 500);
    assert.equal(data.tagsUnavailable, true);
    assert.equal(data.tags.length, 0);
  }
  for (const failure of ['Likes', 'Dislikes']) {
    const app = serviceFixture({ failure });
    await assert.rejects(app.service.getStyleWrap(app.controller.signal), /could not be loaded/);
  }
});

test('cancelled recap never masquerades as unavailable tags and signed-out users cannot query history', async () => {
  const cancelled = serviceFixture({ failure: 'Tags', cancel: true });
  await assert.rejects(cancelled.service.getStyleWrap(cancelled.controller.signal), /cancelled/);
  const signedOut = serviceFixture({ signedIn: false });
  await assert.rejects(signedOut.service.getStyleWrap(signedOut.controller.signal), /sign in again/);
  assert.equal(signedOut.queries.length, 0);
  const empty = serviceFixture({ count: 0 });
  assert.equal((await empty.service.getStyleWrap(empty.controller.signal)).likes.length, 0);
  assert.ok(empty.queries.every(([table]) => table === 'Likes' || table === 'Dislikes'));
});
