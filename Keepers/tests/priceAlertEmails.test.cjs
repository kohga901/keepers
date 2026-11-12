const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createLoader } = require('./helpers/load.cjs');
const { createHandler } = createLoader({}, { Request, Response, AbortSignal })(
  '../supabase/functions/price-alert-emails/handler.ts');
const secretKey = 'sb_secret_test-only';
const config = { SUPABASE_SECRET_KEYS: JSON.stringify({ default: secretKey }), SUPABASE_URL: 'https://example.supabase.co',
  RESEND_API_KEY: 'provider-secret', PRICE_ALERT_EMAIL_FROM: 'Keepers <alerts@example.com>' };
const incoming = (key = secretKey) => new Request('https://example.com', {
  method: 'POST', headers: { apikey: key } });
const job = { notification_id: 'notice-1', lease_id: 'lease-1', recipient: 'alice@example.com',
  item_name: 'Linen shirt', price: '25.00', target_price: '30.00' };

test('email endpoint rejects public/user calls and leaves queue untouched without provider secrets', async () => {
  let calls = 0;
  const handler = createHandler(name => config[name], async () => { calls++; });
  assert.equal((await handler(incoming('user-jwt'))).status, 401);
  assert.equal((await handler(incoming('sb_publishable_public'))).status, 401);
  assert.equal((await handler(incoming('sb_secret_wrong'))).status, 401);
  assert.equal((await handler(new Request('https://example.com', {
    method: 'POST', headers: { Authorization: `Bearer ${secretKey}` },
  }))).status, 401);
  assert.equal((await handler(new Request('https://example.com'))).status, 401);
  const missing = createHandler(name => name === 'RESEND_API_KEY' ? undefined : config[name], async () => { calls++; });
  assert.equal((await missing(incoming())).status, 503);
  assert.equal(calls, 0);
});

test('missing or malformed runtime secret keys fail closed without queue access', async () => {
  for (const value of [undefined, '{bad json', 'null', '{}', '{"default":123}', '{"default":"eyJlegacy"}']) {
    let calls = 0;
    const handler = createHandler(name => name === 'SUPABASE_SECRET_KEYS' ? value : config[name], async () => { calls++; });
    assert.equal((await handler(incoming())).status, 503);
    assert.equal(calls, 0);
  }
});

test('email delivery uses persisted recipient, stable idempotency key and acknowledges only success', async () => {
  const calls = [];
  const handler = createHandler(name => config[name], async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    if (url.endsWith('claim_price_alert_emails')) return Response.json([job]);
    if (url === 'https://api.resend.com/emails') return Response.json({ id: 'provider-id' });
    return new Response('null');
  });
  assert.deepEqual(await (await handler(incoming())).json(), { processed: 1, sent: 1 });
  assert.equal(calls[0].options.headers.apikey, secretKey);
  assert.equal(calls[0].options.headers.Authorization, undefined);
  assert.equal(calls[1].options.headers['Idempotency-Key'], 'price-alert/notice-1');
  assert.deepEqual(calls[1].body.to, ['alice@example.com']);
  assert.match(calls[1].body.text, /Linen shirt is now \$25.00/);
  assert.deepEqual(calls[2].body, { p_notification_id: 'notice-1', p_lease_id: 'lease-1', p_error: null });
});

test('provider rejection/timeouts leave retryable jobs and do not report a successful send', async () => {
  for (const mode of ['reject', 'timeout', 'invalid']) {
    let finished;
    const handler = createHandler(name => config[name], async (url, options) => {
      if (url.endsWith('claim_price_alert_emails')) return Response.json([job]);
      if (url === 'https://api.resend.com/emails') {
        if (mode === 'timeout') throw new Error('timeout');
        return mode === 'invalid' ? Response.json({}) : new Response('private error', { status: 429 });
      }
      finished = JSON.parse(options.body);
      return new Response('null');
    });
    const response = await handler(incoming());
    assert.deepEqual(await response.json(), { processed: 1, sent: 0 });
    assert.equal(finished.p_error, mode === 'reject' ? 'provider_http_429' :
      mode === 'timeout' ? 'provider_request_failed' : 'provider_invalid_response');
  }
});

test('queue failures stop processing so the lease can expire safely', async () => {
  let providerCalls = 0;
  const handler = createHandler(name => config[name], async url => {
    if (url === 'https://api.resend.com/emails') { providerCalls++; return Response.json({ id: 'sent' }); }
    if (url.endsWith('claim_price_alert_emails')) return Response.json([job, job]);
    return new Response('database unavailable', { status: 500 });
  });
  assert.equal((await handler(incoming())).status, 500);
  assert.equal(providerCalls, 1);
});
