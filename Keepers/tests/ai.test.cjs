const test = require('node:test');
const assert = require('node:assert/strict');
const { createLoader, deferred, plain } = require('./helpers/load.cjs');

const result = {
  identifiedItem: { name: 'Shirt', brand: 'unknown', category: 'tops', colors: ['blue'], identifiers: [] },
  searchSummary: 'A blue shirt', provider: 'google', model: 'server-model', listings: [], sources: [],
  searchLinks: [{ marketplace: 'eBay', query: 'blue shirt', title: 'Search eBay', url: 'https://www.ebay.com/sch/i.html?_nkw=blue' }],
};
const response = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
function fixture({ fetch: request, sessionError = null, token = 'session-token', globals = {}, serverUrl = 'https://keepers.test/' } = {}) {
  const calls = [];
  let currentToken = token;
  const load = createLoader({
    '../../utils/supabase': { supabase: { auth: { getSession: async () => ({
      data: { session: currentToken ? { access_token: currentToken } : null }, error: sessionError,
    }) } } },
    '../serverApi': { SERVER_BASE_URL: serverUrl },
    'react-native': new Proxy({}, { get() { throw new Error('AI lookup must work without native APIs'); } }),
  }, { fetch: async (...args) => { calls.push(args); return request ? request(...args) : response(200, result); }, ...globals });
  return { api: load('services/ai/index.ts'), calls, setToken(value) { currentToken = value; } };
}

test('mobile and web lookup use the server with the current session and only a catalog item ID', async () => {
  const app = fixture();
  assert.deepEqual(plain(await app.api.lookupPurchasableItem({ itemId: '12', maxResults: 3 })), result);
  const [url, options] = app.calls[0];
  assert.equal(url, 'https://keepers.test/ai/lookup');
  assert.equal(options.headers.Authorization, 'Bearer session-token');
  assert.deepEqual(JSON.parse(options.body), { item_id: 12, max_results: 3 });
  assert.equal(options.method, 'POST');
  assert.equal(options.redirect, 'error');
  app.setToken('another-session');
  await app.api.lookupPurchasableItem({ itemId: '12' });
  assert.equal(app.calls[1][1].headers.Authorization, 'Bearer another-session');
  assert.equal(JSON.parse(app.calls[1][1].body).max_results, 5);
});

test('lookup refuses unsafe backend destinations before sending a bearer token', async () => {
  for (const serverUrl of ['', 'http://keepers.test', 'https://user:pass@keepers.test',
    'https://keepers.test?forward=elsewhere', 'https://keepers.test#fragment']) {
    const app = fixture({ serverUrl });
    await assert.rejects(app.api.lookupPurchasableItem({ itemId: '1' }), { code: 'unavailable' });
    assert.equal(app.calls.length, 0);
  }
  const dev = fixture({ serverUrl: 'http://localhost:8000', globals: { __DEV__: true } });
  await dev.api.lookupPurchasableItem({ itemId: '1' });
  assert.equal(dev.calls[0][0], 'http://localhost:8000/ai/lookup');
});

test('non-finite result limits never produce an invalid JSON request', async () => {
  const app = fixture();
  for (const maxResults of [NaN, Infinity, -Infinity]) {
    await assert.rejects(app.api.lookupPurchasableItem({ itemId: '1', maxResults }), { code: 'invalid_image' });
  }
  assert.equal(app.calls.length, 0);
});

test('invalid catalog IDs, signed-out sessions and pre-cancelled requests never send a lookup', async () => {
  const app = fixture();
  for (const itemId of ['', '0', '-1', '1.5', 'not-an-id', '9007199254740992']) {
    await assert.rejects(app.api.lookupPurchasableItem({ itemId }), { code: 'invalid_image' });
  }
  const controller = new AbortController(); controller.abort();
  await assert.rejects(app.api.lookupPurchasableItem({ itemId: '1', signal: controller.signal }), { code: 'cancelled' });
  assert.equal(app.calls.length, 0);
  const signedOut = fixture({ token: null });
  await assert.rejects(signedOut.api.lookupPurchasableItem({ itemId: '1' }), { code: 'unauthorized' });
  assert.equal(signedOut.calls.length, 0);
  const expired = fixture({ sessionError: new Error('expired') });
  await assert.rejects(expired.api.lookupPurchasableItem({ itemId: '1' }), { code: 'unauthorized' });
  assert.equal(expired.calls.length, 0);
});

test('server errors are sanitized and do not direct users to enter API keys', async () => {
  for (const [status, code] of [[401, 'unauthorized'], [422, 'invalid_image'], [503, 'unavailable'],
    [429, 'quota'], [429, 'busy'], [504, 'timeout'], [502, 'network']]) {
    const app = fixture({ fetch: async () => response(status, { detail: { code, message: 'server-secret' } }) });
    await assert.rejects(app.api.lookupPurchasableItem({ itemId: '1' }), (error) => {
      assert.equal(error.code, code);
      assert.doesNotMatch(error.message, /server-secret|Settings|API key/);
      return true;
    });
  }
  const unsafe = fixture({ fetch: async () => response(500, { detail: 'server-secret' }) });
  await assert.rejects(unsafe.api.lookupPurchasableItem({ itemId: '1' }), { code: 'unknown' });
});

test('malformed responses and unsafe result links cannot become UI results', async () => {
  for (const body of [null, {}, { ...result, provider: 'unsupported' }, { ...result, searchLinks: [{ ...result.searchLinks[0], url: 'javascript:alert(1)' }] }]) {
    const app = fixture({ fetch: async () => response(200, body) });
    await assert.rejects(app.api.lookupPurchasableItem({ itemId: '1' }), { code: 'unknown' });
  }
  const offline = fixture({ fetch: async () => { throw new TypeError('connection failed'); } });
  await assert.rejects(offline.api.lookupPurchasableItem({ itemId: '1' }), { code: 'network' });
});

test('result links reject embedded credentials, controls, backslashes and custom ports', async () => {
  for (const url of ['https://user:pass@shop.test/item', 'https://shop.test:8443/item',
    'https://shop.test/\\evil', 'https://shop.test/\nitem', 'https://@shop.test/item']) {
    for (const field of ['listings', 'sources', 'searchLinks']) {
      const entry = field === 'listings' ? { title: 'Shirt', seller: 'Shop', displayedPrice: 'unknown',
        condition: 'new', matchType: 'similar', confidence: .5, evidence: 'Cut', sourceBacked: false } : result.searchLinks[0];
      const app = fixture({ fetch: async () => response(200, { ...result, [field]: [{ ...entry, url }] }) });
      await assert.rejects(app.api.lookupPurchasableItem({ itemId: '1' }), { code: 'unknown' });
    }
  }
});

test('dismissing a lookup cancels the HTTP request and a later retry can succeed', async () => {
  const started = deferred();
  const app = fixture({ fetch: async (url, options) => {
    if (app.calls.length > 1) return response(200, result);
    started.resolve();
    return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => {
      const error = new Error('aborted'); error.name = 'AbortError'; reject(error);
    }, { once: true }));
  } });
  const controller = new AbortController();
  const lookup = app.api.lookupPurchasableItem({ itemId: '1', signal: controller.signal });
  await started.promise;
  controller.abort();
  await assert.rejects(lookup, { code: 'cancelled' });
  assert.equal(app.calls[0][1].signal.aborted, true);
  assert.equal((await app.api.lookupPurchasableItem({ itemId: '1' })).provider, 'google');
});

test('lookup timeout aborts the request and clears the timer', async () => {
  let timeout, cleared = 0;
  const started = deferred();
  const app = fixture({ globals: {
    setTimeout(fn, ms) { assert.equal(ms, 110000); timeout = fn; return 1; },
    clearTimeout() { cleared++; },
  }, fetch: async (url, options) => {
    started.resolve();
    return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => {
      const error = new Error('aborted'); error.name = 'AbortError'; reject(error);
    }, { once: true }));
  } });
  const lookup = app.api.lookupPurchasableItem({ itemId: '1' });
  await started.promise;
  timeout();
  await assert.rejects(lookup, { code: 'timeout' });
  assert.equal(cleared, 1);
});
