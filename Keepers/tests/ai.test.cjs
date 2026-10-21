const test = require('node:test');
const assert = require('node:assert/strict');
const { createLoader, deferred, plain } = require('./helpers/load.cjs');

function lookupFixture({ lookup, platform = 'ios' } = {}) {
  const calls = [];
  let selected = 'google';
  const provider = (name) => (key) => ({ lookup: async (input) => {
    calls.push({ name, key, input });
    return lookup ? lookup(input) : { provider: name, listings: [{ url: 'https://shop.test/piece' }] };
  } });
  const load = createLoader({
    'react-native': { Platform: { OS: platform } },
    './credentials': { getSelectedAiProvider: async () => selected, getProviderApiKeyForRequest: async () => 'test-key' },
    './connection': {}, './developmentCredentials': {},
    './providers/google': { createGoogleLookupProvider: provider('google') },
    './providers/openai': { createOpenAiLookupProvider: provider('openai') },
    './providers/anthropic': { createAnthropicLookupProvider: provider('anthropic') },
  });
  return { api: load('services/ai/index.ts'), calls, select(name) { selected = name; } };
}
const input = { imageUrl: 'https://images.test/shirt.jpg', itemHint: 'Shirt' };

test('AI lookup shares simultaneous work and caches normalized inputs separately by provider', async () => {
  const pending = deferred();
  const app = lookupFixture({ lookup: () => pending.promise });
  const first = app.api.lookupPurchasableItem(input);
  const second = app.api.lookupPurchasableItem({ ...input, itemHint: ' Shirt ', maxResults: 5 });
  pending.resolve({ listings: [{ url: 'https://shop.test/1' }] });
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a, b);
  assert.equal(app.calls.length, 1);
  assert.equal(await app.api.lookupPurchasableItem(input), a);
  app.select('anthropic');
  await app.api.lookupPurchasableItem(input);
  await app.api.lookupPurchasableItem({ ...input, maxResults: 2 });
  await app.api.lookupPurchasableItem({ ...input, imageUrl: 'https://images.test/pants.jpg' });
  assert.equal(app.calls.length, 4);
  assert.equal(app.calls[1].name, 'anthropic');
  assert.equal(app.calls[2].input.maxResults, 2);
});

test('dismissing one lookup cancels that caller while another caller still receives the result', async () => {
  const pending = deferred(), app = lookupFixture({ lookup: () => pending.promise });
  const controller = new AbortController();
  const first = app.api.lookupPurchasableItem({ ...input, signal: controller.signal });
  const second = app.api.lookupPurchasableItem(input);
  const rejected = assert.rejects(first, { code: 'cancelled' });
  // Let the service select credentials and attach the caller's cancellation listener.
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  await rejected;
  pending.resolve({ listings: [{ url: 'https://shop.test/1' }] });
  assert.equal((await second).listings.length, 1);
  assert.equal(app.calls.length, 1);
  assert.equal(app.calls[0].input.signal, undefined);
  assert.equal((await app.api.lookupPurchasableItem(input)).listings.length, 1);
});

test('failed AI lookups expose safe errors and can be retried instead of poisoning the cache', async () => {
  let attempts = 0;
  const app = lookupFixture({ lookup: async () => {
    if (++attempts === 1) throw { statusCode: 429, message: 'secret-key-must-not-leak' };
    return { listings: [] };
  } });
  await assert.rejects(app.api.lookupPurchasableItem(input), (error) => error.code === 'quota' && !error.message.includes('secret-key'));
  assert.equal((await app.api.lookupPurchasableItem(input)).listings.length, 0);
  assert.equal(app.calls.length, 2);
});

test('invalid images, pre-cancelled requests and web lookup do not spend provider requests', async () => {
  const app = lookupFixture();
  for (const imageUrl of ['http://images.test/a', 'javascript:alert(1)', 'bad url', 'https://images.test/' + 'x'.repeat(2048)]) {
    await assert.rejects(app.api.lookupPurchasableItem({ imageUrl }), { code: 'invalid_image' });
  }
  const controller = new AbortController(); controller.abort();
  await assert.rejects(app.api.lookupPurchasableItem({ ...input, signal: controller.signal }), { code: 'cancelled' });
  assert.equal(app.calls.length, 0);
  const web = lookupFixture({ platform: 'web' });
  await assert.rejects(web.api.lookupPurchasableItem(input), { code: 'not_supported' });
  assert.equal(web.calls.length, 0);
});

test('purchase results remove unsafe and duplicate URLs and distinguish cited hosts from lookalikes', () => {
  const { buildLookupResult } = createLoader()('services/ai/providers/shared.ts');
  const listing = (url) => ({ title: 'Shirt', url, seller: 'Shop', displayedPrice: '$35', condition: 'new',
    matchType: 'similar', confidence: .6, evidence: 'Same cut' });
  const result = buildLookupResult('openai', 'test-model', { identifiedItem: { name: 'Shirt' }, searchSummary: 'Found shirts',
    listings: [listing('javascript:alert(1)'), listing('http://shop.test/unsafe'), listing('https://shop.test/1'),
      listing('https://shop.test/1'), listing('https://www.shop.test/2'), listing('https://shop.test.evil.test/3'), listing('https://other.test/4')] },
  [{ url: 'https://shop.test/source', title: 'Source' }, { url: 'http://unsafe.test' }, null, { url: 'https://shop.test/source' }], 3);
  assert.deepEqual(plain(result.listings.map(({ url, sourceBacked }) => ({ url, sourceBacked }))), [
    { url: 'https://shop.test/1', sourceBacked: true }, { url: 'https://www.shop.test/2', sourceBacked: true },
    { url: 'https://shop.test.evil.test/3', sourceBacked: false }]);
  assert.equal(result.sources.length, 1);
});

test('lookup abort deadline, external cancellation and cleanup are deterministic', () => {
  let timeout, cleared = 0;
  const { createLookupAbortSignal } = createLoader({}, {
    setTimeout(fn, ms) { assert.equal(ms, 90000); timeout = fn; return 1; },
    clearTimeout() { cleared++; },
  })('services/ai/providers/shared.ts');
  const caller = new AbortController();
  const first = createLookupAbortSignal(caller.signal); caller.abort();
  assert.equal(first.signal.aborted, true); first.cleanup();
  const second = createLookupAbortSignal(); timeout();
  assert.equal(second.signal.aborted, true); second.cleanup();
  const fresh = new AbortController(), cleaned = createLookupAbortSignal(fresh.signal);
  cleaned.cleanup(); fresh.abort();
  assert.equal(cleaned.signal.aborted, false);
  assert.equal(cleared, 3);
});

function credentialFixture({ development = false, platform = 'ios', available = true } = {}) {
  const values = new Map();
  const secureStore = { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only', isAvailableAsync: async () => available,
    getItemAsync: async (key) => values.get(key) ?? null,
    setItemAsync: async (key, value, options) => { assert.equal(options.keychainAccessible, 'device-only'); values.set(key, value); },
    deleteItemAsync: async (key) => values.delete(key) };
  const load = createLoader({ 'react-native': { Platform: { OS: platform } }, 'expo-secure-store': secureStore }, {
    __DEV__: development, process: { env: { EXPO_PUBLIC_KEEPERS_GOOGLE_AI_API_KEY: '  development-key  ' } },
  });
  return { api: load('services/ai/credentials.ts'), values };
}

test('credential storage trims keys, isolates providers and removes only the selected key', async () => {
  const { api } = credentialFixture();
  await api.saveProviderApiKey('google', '  google-key  ');
  await api.saveProviderApiKey('anthropic', 'anthropic-key');
  assert.equal(await api.getProviderApiKeyForRequest('google'), 'google-key');
  await assert.rejects(api.getProviderApiKeyForRequest('openai'), { code: 'missing_key' });
  await api.deleteProviderApiKey('google');
  await assert.rejects(api.getProviderApiKeyForRequest('google'), { code: 'missing_key' });
  assert.equal(await api.getProviderApiKeyForRequest('anthropic'), 'anthropic-key');
  await assert.rejects(api.saveProviderApiKey('google', ' short '), /between 8 and 2048/);
  await assert.rejects(api.saveProviderApiKey('google', 'x'.repeat(2049)), /between 8 and 2048/);
});

test('production credentials ignore development environment keys and reject unsupported storage', async () => {
  const production = credentialFixture();
  await assert.rejects(production.api.getProviderApiKeyForRequest('google'), { code: 'missing_key' });
  const development = credentialFixture({ development: true });
  assert.equal(await development.api.getProviderApiKeyForRequest('google'), 'development-key');
  for (const options of [{ platform: 'web' }, { available: false }]) {
    const app = credentialFixture(options);
    await assert.rejects(app.api.saveProviderApiKey('google', 'sample-key'), { code: 'not_supported' });
    assert.equal(app.values.size, 0);
  }
});

test('Google identification builds encoded shopping searches without inventing verified listings', async () => {
  const output = { identifiedItem: { name: 'Shirt & jacket', brand: 'unknown', category: 'tops', colors: ['blue'], identifiers: ['A/B'] },
    searchSummary: 'A blue shirt', isPurchasableFashionItem: true };
  const load = createLoader({ '@ai-sdk/google': { createGoogleGenerativeAI: () => () => ({}) },
    ai: { generateText: async () => ({ output }), Output: { object: (options) => options } } });
  const provider = load('services/ai/providers/google.ts').createGoogleLookupProvider('fake-key');
  const result = await provider.lookup({ ...input, maxResults: 2 });
  assert.equal(result.listings.length, 0);
  assert.equal(result.sources.length, 0);
  assert.equal(result.searchLinks.length, 2);
  const shopping = new URL(result.searchLinks[0].url);
  assert.equal(shopping.searchParams.get('q'), 'Shirt & jacket A/B blue');
  assert.equal(shopping.searchParams.get('tbm'), 'shop');
  output.isPurchasableFashionItem = false;
  assert.equal((await provider.lookup(input)).searchLinks.length, 0);
});
