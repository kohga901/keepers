const test = require('node:test');
const assert = require('node:assert/strict');
const { createLoader, plain } = require('./helpers/load.cjs');

function setup({ user = { id: 'alice' }, token = 'session-token', response, fetchError } = {}) {
  const calls = [], fallback = [{ item_id: 99 }];
  let fallbacks = 0;
  const load = createLoader({
    '../utils/supabase': { supabase: { auth: {
      getUser: async () => ({ data: { user }, error: null }),
      getSession: async () => ({ data: { session: token ? { access_token: token } : null }, error: null }),
    } } },
    './dataServices': { getClothing: async () => { fallbacks++; return fallback; } },
  }, {
    process: { env: { EXPO_PUBLIC_SERVER_URL: 'https://keepers.test' } },
    fetch: async (url, options) => {
      calls.push({ url, ...options, body: options?.body ? JSON.parse(options.body) : undefined });
      if (fetchError) throw fetchError;
      return { ok: true, json: async () => ({ recommendations: [{ item_id: 7 }] }), ...response };
    },
  });
  return { api: load('services/serverApi.ts'), calls, fallback, fallbacks: () => fallbacks };
}

test('recommendation requests preserve identity, requested count, selected tags and response order', async () => {
  const app = setup({ response: { json: async () => ({ recommendations: [{ item_id: 7 }, { item_id: 2 }] }) } });
  assert.deepEqual(await app.api.getRecommendationsFromServer(2, ['shirt', 'black']), [{ item_id: 7 }, { item_id: 2 }]);
  assert.deepEqual(plain(app.calls[0]), { url: 'https://keepers.test/clothes/recommendations', method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: { user_id: 'alice', n: 2, categories: ['shirt', 'black'] } });
  assert.equal(app.fallbacks(), 0);
});

test('filtered feed failures and exhaustion never substitute unfiltered catalog items', async () => {
  for (const options of [
    { user: null }, { response: { ok: false, status: 503 } },
    { response: { json: async () => ({ recommendations: [] }) } },
    { response: { json: async () => { throw new SyntaxError('bad JSON'); } } },
    { fetchError: new TypeError('offline') },
  ]) {
    const app = setup(options);
    assert.deepEqual(plain(await app.api.getRecommendationsFromServer(10, ['black'])), []);
    assert.equal(app.fallbacks(), 0);
  }
});

test('unfiltered feed recovers through the catalog on server failure or an empty response', async () => {
  for (const response of [{ ok: false, status: 500 }, { json: async () => ({ recommendations: [] }) }]) {
    const app = setup({ response });
    assert.equal(await app.api.getRecommendationsFromServer(10), app.fallback);
    assert.equal(app.fallbacks(), 1);
  }
});

test('swipes serialize the actual reaction and never report success for rejected or uncertain writes', async () => {
  const app = setup();
  assert.equal(await app.api.sendSwipeToServer('42', false), true);
  assert.deepEqual(app.calls[0].body, { user_id: 'alice', item_id: '42', liked: false });
  for (const options of [{ user: null }, { response: { ok: false, status: 422 } }, { fetchError: new TypeError('offline') },
    { response: { json: async () => { throw new SyntaxError('truncated response'); } } }]) {
    const failure = setup(options);
    assert.equal(await failure.api.sendSwipeToServer('42', true), false);
    if (options.user === null) assert.equal(failure.calls.length, 0);
  }
});

test('history clear sends the access token and scope without accepting a target user ID', async () => {
  const app = setup();
  assert.equal(await app.api.clearHistoryOnServer('liked'), null);
  assert.equal(app.calls[0].url, 'https://keepers.test/clothes/history/clear');
  assert.deepEqual(app.calls[0].body, { scope: 'liked' });
  assert.equal(app.calls[0].headers.Authorization, 'Bearer session-token');
  const signedOut = setup({ token: null });
  assert.match(await signedOut.api.clearHistoryOnServer('all'), /Sign in again/);
  assert.equal(signedOut.calls.length, 0);
});

test('history clear preserves server errors and handles non-JSON and unreachable servers', async () => {
  const denied = setup({ response: { ok: false, json: async () => ({ detail: 'Session expired' }) } });
  assert.equal(await denied.api.clearHistoryOnServer('all'), 'Session expired');
  const invalid = setup({ response: { ok: false, json: async () => { throw new SyntaxError(); } } });
  assert.match(await invalid.api.clearHistoryOnServer('all'), /could not be cleared/);
  const offline = setup({ fetchError: new TypeError('offline') });
  assert.match(await offline.api.clearHistoryOnServer('all'), /Could not reach/);
});
