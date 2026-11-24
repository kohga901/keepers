import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runBatch, publicUrl, fetchProduct, cursorId } from '../src/catalog.mjs';
import { createWorker } from '../src/index.mjs';

const productUrl = 'https://shop.retailer.com/products/shirt?variant=red';
const row = { item_id: 1, item_name: 'Shirt', item_price: '$40.00', item_web_listing: productUrl };
const env = { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_KEY: 'sb_secret_test',
  ADMIN_TOKEN: 'test-admin-token-at-least-thirty-two-characters', BATCH_SIZE: '2', DRY_RUN: 'true' };
const page = (price = '25', extra = {}) => new Response(`<script type="application/ld+json">${JSON.stringify({
  '@type': 'Product', name: 'Shirt', url: productUrl,
  offers: { '@type': 'Offer', price, priceCurrency: 'USD', availability: 'https://schema.org/InStock', ...extra },
})}</script>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });

function kv() {
  const values = new Map();
  return { values, async get(key, type) { const value = values.get(key) ?? null; return type === 'json' && value ? JSON.parse(value) : value; },
    async put(key, value) { values.set(key, value); } };
}

function network(rows = [row], merchant = () => page(), updateRows = [{ item_id: 1 }]) {
  const calls = [];
  return { calls, async fetch(url, options = {}) {
    const parsed = new URL(url);
    calls.push({ url: String(url), options });
    if (parsed.hostname === 'project.supabase.co') {
      if (options.method === 'PATCH') return Response.json(updateRows);
      return Response.json(rows);
    }
    // Never expose a database key or admin token to a merchant.
    assert.equal(options.headers?.apikey, undefined);
    assert.equal(options.headers?.Authorization, undefined);
    return merchant(url, options);
  } };
}

test('dry run reports proposed changes without any Supabase mutation, regardless of live configuration', async () => {
  const n = network();
  const report = await runBatch({ ...env, DRY_RUN: 'false' }, {}, n.fetch);
  assert.equal(report.mode, 'dry_run');
  assert.equal(report.results[0].stored_price, '$40.00');
  assert.equal(report.results[0].extracted_price, '$25.00');
  assert.equal(report.summary.would_update, 1);
  assert.ok(n.calls.every(call => call.options.method === 'GET'));
  assert.ok(!JSON.stringify(report).includes(env.SUPABASE_KEY));
});

test('database reads are stable keyset pages, and unchanged formatted prices never write', async () => {
  const n = network([{ ...row, item_id: 12, item_price: 'USD 25.00' }]);
  const report = await runBatch(env, { afterId: '10', limit: 1 }, n.fetch);
  const query = new URL(n.calls[0].url).searchParams;
  assert.equal(query.get('item_id'), 'gt.10');
  assert.equal(query.get('order'), 'item_id.asc');
  assert.equal(query.get('limit'), '1');
  assert.equal(report.next_after_id, '12');
  assert.equal(report.cycle_complete, false);
  assert.equal(report.summary.unchanged, 1);
  assert.ok(n.calls.every(call => call.options.method === 'GET'));
});

test('live writes require explicit environment opt-in and compare both old price and saved URL', async () => {
  for (const DRY_RUN of [undefined, '', 'true', 'False', false]) {
    const n = network();
    await assert.rejects(runBatch({ ...env, DRY_RUN }, { dryRun: false }, n.fetch), /writes_disabled/);
    assert.equal(n.calls.length, 0);
  }
  const n = network();
  const report = await runBatch({ ...env, DRY_RUN: 'false' }, { dryRun: false }, n.fetch);
  assert.equal(report.summary.updated, 1);
  const write = n.calls.find(call => call.options.method === 'PATCH');
  const query = new URL(write.url).searchParams;
  assert.equal(query.get('item_id'), 'eq.1');
  assert.equal(query.get('item_price'), 'eq.$40.00');
  assert.equal(query.get('item_web_listing'), `eq.${productUrl}`);
  assert.deepEqual(JSON.parse(write.options.body), { item_price: '$25.00' });
  assert.equal(write.options.headers.apikey, env.SUPABASE_KEY);
  assert.equal(write.options.headers.Authorization, undefined);
});

test('live conflict, unsupported offers, and failed pages cannot be reported as updates', async () => {
  const conflict = network([row], () => page(), []);
  assert.equal((await runBatch({ ...env, DRY_RUN: 'false' }, { dryRun: false }, conflict.fetch)).summary.conflict, 1);
  for (const merchant of [() => page('0'), () => page('5', { priceCurrency: 'EUR' }),
    () => page('5', { availability: undefined }),
    () => new Response('blocked', { status: 403 }), () => { throw new Error('private credential details'); }]) {
    const n = network([row], merchant);
    const report = await runBatch({ ...env, DRY_RUN: 'false' }, { dryRun: false }, n.fetch);
    assert.equal(report.summary.updated, 0);
    assert.ok(!n.calls.some(call => call.options.method === 'PATCH'));
    assert.ok(!JSON.stringify(report).includes('private credential'));
  }
});

test('a merchant failure does not stop later rows; missing URLs and duplicate exact URLs are handled', async () => {
  const n = network([row, { ...row, item_id: 2 }, { ...row, item_id: 3, item_web_listing: null },
    { ...row, item_id: 4, item_web_listing: 'https://broken.retailer.com/shirt' }], url =>
    url.includes('broken') ? new Response('gone', { status: 404 }) : page());
  const report = await runBatch(env, { limit: 5 }, n.fetch);
  assert.equal(report.summary.checked, 4);
  assert.equal(report.summary.would_update, 2);
  assert.equal(report.summary.skipped, 1);
  assert.equal(report.summary.error, 1);
  assert.equal(n.calls.filter(call => call.url === productUrl).length, 1);
  assert.deepEqual(report.results.map(result => result.item_id), ['1', '2', '3', '4']);
});

test('empty initial page warns about permissions instead of claiming a successful catalog refresh', async () => {
  const n = network([]);
  const report = await runBatch(env, {}, n.fetch);
  assert.match(report.warning, /SELECT access/);
  assert.equal(report.next_after_id, '0');
  assert.equal(report.cycle_complete, true);
});

test('a write failure remains in the report and other rows can finish', async () => {
  const n = network([row, { ...row, item_id: 2 }]);
  const report = await runBatch({ ...env, DRY_RUN: 'false' }, { dryRun: false }, (url, options) => {
    if (options.method === 'PATCH' && new URL(url).searchParams.get('item_id') === 'eq.1') {
      return new Response('private database error', { status: 503 });
    }
    return n.fetch(url, options);
  });
  assert.equal(report.summary.error, 1);
  assert.equal(report.summary.updated, 1);
  assert.equal(report.results[0].reason, 'supabase_http_503');
  assert.ok(!JSON.stringify(report).includes('private database error'));
});

test('public URL guard rejects internal targets, IP literals, credentials and non-HTTPS URLs', () => {
  for (const url of ['http://shop.retailer.com/p', 'https://localhost/p', 'https://127.0.0.1/p',
    'https://[::1]/p', 'https://2130706433/p', 'https://user:pass@shop.retailer.com/p',
    'https://metadata.google.internal/p', 'https://project.supabase.co/rest/v1/Clothing',
    'https://shop.retailer.com:8443/p', 'file:///etc/passwd']) assert.throws(() => publicUrl(url));
  assert.equal(publicUrl(productUrl).href, productUrl);
});

test('redirect handling preserves product identity and selected variant before following', async () => {
  for (const location of ['https://127.0.0.1/p', 'https://elsewhere.retailer.com/login',
    'https://shop.retailer.com/products/other?variant=blue', 'https://shop.retailer.com/products/shirt']) {
    let calls = 0;
    await assert.rejects(fetchProduct(productUrl, async () => {
      calls++;
      return new Response(null, { status: 302, headers: { location } });
    }));
    assert.equal(calls, 1);
  }
  let calls = 0;
  const result = await fetchProduct(productUrl, async () => ++calls === 1
    ? new Response(null, { status: 301, headers: { location: productUrl.replace('shop.', 'www.shop.') } }) : page());
  assert.equal(result.verified, true);
});

test('oversized and non-HTML responses are rejected', async () => {
  await assert.rejects(fetchProduct(productUrl, async () => new Response('x', {
    headers: { 'Content-Type': 'text/html', 'Content-Length': String(17 * 1024 * 1024) },
  })), /page_too_large/);
  await assert.rejects(fetchProduct(productUrl, async () => new Response('x'.repeat(16 * 1024 * 1024 + 1), {
    headers: { 'Content-Type': 'text/html' },
  })), /page_too_large/);
  await assert.rejects(fetchProduct(productUrl, async () => Response.json({ price: 1 })), /unsupported_content_type/);
});

test('HTTP access requires a separate admin token and accepts only dry-run options', async () => {
  const n = network(), worker = createWorker(n.fetch), config = { ...env, PRICE_REFRESH: kv() };
  const request = (body, token = env.ADMIN_TOKEN) => new Request('https://worker.retailer.com/dry-run', {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body,
  });
  assert.equal((await worker.fetch(request('{}', 'wrong'), config)).status, 401);
  assert.equal((await worker.fetch(request('{}'), { ...config, ADMIN_TOKEN: undefined })).status, 401);
  assert.equal(n.calls.length, 0);
  for (const body of ['{"dryRun":false}', '{"mode":"live"}', '{"limit":51}', '{"after_id":"1&limit=1000"}', 'null', '{bad']) {
    assert.equal((await worker.fetch(request(body), config)).status, 400);
  }
  assert.equal(n.calls.length, 0);
  const response = await worker.fetch(request('{}'), { ...config, DRY_RUN: 'false' });
  assert.equal(response.status, 200);
  const report = await response.json();
  assert.equal(report.mode, 'dry_run');
  assert.ok(n.calls.every(call => call.options.method === 'GET'));
  const latest = await worker.fetch(new Request('https://worker.retailer.com/reports/latest', {
    headers: { Authorization: `Bearer ${env.ADMIN_TOKEN}` },
  }), config);
  assert.equal((await latest.json()).id, report.id);
  assert.equal(latest.headers.get('Cache-Control'), 'no-store');
  assert.equal(config.PRICE_REFRESH.values.has('cursor:dry-run'), false);
});

test('scheduled batches advance a separate dry-run cursor and persist a reviewable report', async () => {
  const n = network([row]), worker = createWorker(n.fetch), config = { ...env, BATCH_SIZE: '1', PRICE_REFRESH: kv() };
  await worker.scheduled({}, config);
  assert.equal(await config.PRICE_REFRESH.get('cursor:dry-run'), '1');
  const id = await config.PRICE_REFRESH.get('latest');
  assert.equal((await config.PRICE_REFRESH.get(`report:${id}`, 'json')).mode, 'dry_run');
  assert.ok(n.calls.every(call => call.options.method === 'GET'));
  assert.equal(config.PRICE_REFRESH.values.has('cursor:live'), false);
});

test('a failed database read never advances the scheduled cursor or exposes the response body', async () => {
  const worker = createWorker(async () => new Response('sensitive infrastructure details', { status: 503 }));
  const config = { ...env, PRICE_REFRESH: kv() };
  await assert.rejects(worker.scheduled({}, config), /supabase_http_503/);
  assert.equal(config.PRICE_REFRESH.values.size, 0);
  const response = await worker.fetch(new Request('https://worker.retailer.com/dry-run', {
    method: 'POST', headers: { Authorization: `Bearer ${env.ADMIN_TOKEN}` },
  }), config);
  assert.equal(response.status, 502);
  assert.ok(!(await response.text()).includes('sensitive'));
});

test('batch sizes and bigint cursors are validated before any network activity', async () => {
  assert.equal(cursorId('9223372036854775807'), '9223372036854775807');
  assert.throws(() => cursorId('9223372036854775808'));
  assert.throws(() => cursorId(9007199254740992));
  for (const limit of [0, 51, 1.5, NaN]) await assert.rejects(runBatch(env, { limit }), /invalid_batch_size/);
  const n = network([{ ...row, item_id: 9007199254740992 }]);
  await assert.rejects(runBatch(env, {}, n.fetch), /unsafe_item_id/);
});

test('same-merchant slug redirects are accepted only with a preserved and verified variant', async () => {
  const target = 'https://shop.retailer.com/products/new-shirt?variant=red&color=red';
  let calls = 0;
  const result = await fetchProduct(`${productUrl}&srsltid=tracking&menu=cat123`, async () => {
    if (++calls === 1) return new Response(null, { status: 301, headers: { location: target } });
    return new Response(`<script type="application/ld+json">${JSON.stringify({
      '@type': 'ProductGroup', hasVariant: [{ '@type': 'Product', name: 'Selected shirt',
        offers: { '@type': 'Offer', url: target, price: '19.50', priceCurrency: 'USD', availability: 'InStock' } }],
    })}</script>`, { headers: { 'Content-Type': 'text/html' } });
  });
  assert.equal(result.verified, true);
  assert.equal(result.extracted_price, '$19.50');
  assert.equal(result.fetched_url, target);
  assert.equal(result.redirects.length, 1);

  calls = 0;
  const generic = await fetchProduct(productUrl, async () => ++calls === 1
    ? new Response(null, { status: 301, headers: { location: target } })
    : new Response(`<script type="application/ld+json">${JSON.stringify({ '@type': 'Product', url: target,
      offers: { price: '1', priceCurrency: 'USD', availability: 'InStock' } })}</script>`,
    { headers: { 'Content-Type': 'text/html' } }));
  assert.equal(generic.verified, false);
  assert.equal(generic.reason, 'variant_not_verified');
});

test('renamed numeric product URLs preserve their ID and remain in the same merchant', async () => {
  const original = 'https://shop.retailer.com/old-name/857153.html?source=shopping';
  const target = 'https://shop.retailer.com/new-name/857153.html';
  let calls = 0;
  const result = await fetchProduct(original, async () => ++calls === 1
    ? new Response(null, { status: 301, headers: { location: target } })
    : new Response(`<script type="application/ld+json">${JSON.stringify({ '@type': 'Product', url: target,
      offers: { price: '35', priceCurrency: 'USD', availability: 'InStock' } })}</script>`,
    { headers: { 'Content-Type': 'text/html' } }));
  assert.equal(result.verified, true);
});

test('redirects to home/category pages or changed selectors stay rejected and retain diagnostic evidence', async () => {
  for (const location of ['https://shop.retailer.com/?variant=red',
    'https://shop.retailer.com/collections/pants?variant=red',
    'https://shop.retailer.com/products/new-shirt?variant=blue',
    'https://elsewhere.retailer.com/products/new-shirt?variant=red',
    'https://shop.retailer.com/products/new-shirt?variant=red&variant=blue']) {
    let calls = 0;
    await assert.rejects(fetchProduct(productUrl, async () => {
      calls++;
      return new Response(null, { status: 301, headers: { location } });
    }), error => error.message === 'redirect_changed_product' && error.redirects.length === 1);
    assert.equal(calls, 1);
  }
  const n = network([row], () => new Response(null, { status: 301, headers: { location: 'https://shop.retailer.com/' } }));
  const report = await runBatch(env, {}, n.fetch);
  assert.equal(report.results[0].redirects[0].to, 'https://shop.retailer.com/');
  assert.ok(n.calls.every(call => call.options.method === 'GET'));
});

test('same-path tracking cleanup is allowed but price, market, and unknown query changes are rejected', async () => {
  for (const suffix of ['&currency=USD', '&country=US', '&custom_selection=123']) {
    await assert.rejects(fetchProduct(productUrl + suffix, async () =>
      new Response(null, { status: 301, headers: { location: productUrl } })), /redirect_changed_product/);
  }
  let calls = 0;
  const result = await fetchProduct(`${productUrl}&srsltid=tracking&menu=cat123`, async () => ++calls === 1
    ? new Response(null, { status: 301, headers: { location: productUrl } }) : page());
  assert.equal(result.verified, true);
});

test('large HTML is streamed through the extractor, including script data near the end', async () => {
  const data = await page('19.99').text();
  const bigPage = '<html><script>' + 'x'.repeat(3 * 1024 * 1024) + '</script>' + data + '</html>';
  const result = await fetchProduct(productUrl, async () => new Response(bigPage, { headers: { 'Content-Type': 'text/html' } }));
  assert.equal(result.verified, true);
  assert.equal(result.extracted_price, '$19.99');
});

test('streamed parsing preserves split UTF-8 and JSON tokens across response chunks', async () => {
  const data = new TextEncoder().encode((await page('20').text()).replace('"Shirt"', '"Café shirt"'));
  const stream = new ReadableStream({ start(controller) {
    for (let start = 0; start < data.length; start += 3) controller.enqueue(data.subarray(start, start + 3));
    controller.close();
  } });
  const result = await fetchProduct(productUrl, async () => new Response(stream, { headers: { 'Content-Type': 'text/html' } }));
  assert.equal(result.verified, true);
  assert.equal(result.product_name, 'Café shirt');
});

test('oversized product data is rejected even inside an otherwise permitted HTML response', async () => {
  const body = `<script type="application/ld+json">${JSON.stringify({ '@type': 'Product', description: 'x'.repeat(2 * 1024 * 1024) })}</script>`;
  await assert.rejects(fetchProduct(productUrl, async () => new Response(body,
    { headers: { 'Content-Type': 'text/html' } })), /product_data_too_large/);
});

test('out-of-stock prices appear in dry-run proposals while every database call remains read-only', async () => {
  const n = network([row], () => page('15', { availability: 'https://schema.org/OutOfStock' }));
  const report = await runBatch({ ...env, DRY_RUN: 'false' }, { dryRun: true }, n.fetch);
  assert.equal(report.summary.would_update, 1);
  assert.equal(report.summary.updated, 0);
  assert.equal(report.results[0].availability, 'OutOfStock');
  assert.equal(report.results[0].extracted_price, '$15.00');
  assert.ok(n.calls.every(call => call.options.method === 'GET'));
});

test('database requests use Workers-compatible manual redirects and never forward credentials on a redirect', async () => {
  let calls = 0;
  await assert.rejects(runBatch(env, {}, async (_url, options) => {
    calls++;
    assert.equal(options.redirect, 'manual');
    return new Response(null, { status: 302, headers: { location: 'https://other.retailer.com/' } });
  }), /supabase_http_302/);
  assert.equal(calls, 1);
});
