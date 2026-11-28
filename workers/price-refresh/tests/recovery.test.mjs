import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recoveryFor } from '../src/recovery.mjs';
import { boundedRenderer, createCloudflareRenderer } from '../src/browser.mjs';
import { observeProduct, fetchProduct, runBatch, validateDestination, listingUrl } from '../src/catalog.mjs';
import { extractPrice } from '../src/extract.mjs';

const url = 'https://shop.retailer.com/products/shirt?variant=123456789';
const html = (pageUrl = url, price = '12') => `<script type="application/ld+json">${JSON.stringify({ '@type': 'Product', url: pageUrl,
  offers: { '@type': 'Offer', url: pageUrl, price, priceCurrency: 'USD', availability: 'OutOfStock' } })}</script>`;
const response = (body = html(), status = 200) => new Response(body, { status, headers: { 'Content-Type': 'text/html' } });

test('all observed failure families get a concrete recovery action, including a safe unknown fallback', () => {
  const families = { merchant_http_403: 'merchant_access', merchant_challenge: 'merchant_access', merchant_http_429: 'retry',
    merchant_request_failed: 'retry', merchant_http_503: 'retry', merchant_http_404: 'repair_listing', merchant_http_410: 'repair_listing',
    redirect_changed_product: 'repair_listing', invalid_redirect: 'repair_listing', no_supported_product_data: 'browser',
    page_too_large: 'browser', requires_browser_rendering: 'browser', variant_not_verified: 'verify_variant',
    ambiguous_offers: 'select_offer', price_range: 'select_offer', unsafe_product_url: 'fix_url',
    missing_product_url: 'fix_url', currency_not_usd: 'usd_listing', expired_offer: 'refresh_offer',
    conditional_offer: 'refresh_offer', missing_or_invalid_price: 'review_price', unknown: 'review_price' };
  for (const [reason, action] of Object.entries(families)) {
    const result = recoveryFor({ reason }); assert.equal(result.action, action); assert.ok(result.next_step.length > 30);
  }
  assert.equal(recoveryFor({ reason: 'no_supported_product_data', browser_recovery: { attempted: true, outcome: 'merchant_http_403' } }).action, 'merchant_access');
  assert.equal(recoveryFor({ reason: 'no_supported_product_data', browser_recovery: { attempted: true, outcome: 'no_supported_product_data' } }).action, 'adapter');
});

test('browser budgets are shared across concurrent calls and blocked hosts stop consuming the budget', async () => {
  let calls = 0;
  const render = boundedRenderer(async () => { calls++; return {}; }, 2);
  await Promise.all([render(url), render(url)]);
  await assert.rejects(render(url), /budget_exhausted/); assert.equal(calls, 2);
  render.block(url); await assert.rejects(render(url), /host_paused/);
  assert.deepEqual(render.stats, { limit: 2, attempted: 2, blocked_hosts: 1 });
});

test('Cloudflare rendering is opt-in, capped, authenticated only to Cloudflare and requires final navigation evidence', async () => {
  assert.equal(createCloudflareRenderer({}), null);
  assert.throws(() => createCloudflareRenderer({ BROWSER_FALLBACK_LIMIT: '6' }), /invalid_browser_limit/);
  assert.throws(() => createCloudflareRenderer({ BROWSER_FALLBACK_LIMIT: '1' }), /missing_browser_credentials/);
  const env = { BROWSER_FALLBACK_LIMIT: '1', CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), CLOUDFLARE_BROWSER_TOKEN: 'cloud-secret' };
  const renderer = createCloudflareRenderer(env, async (target, init) => {
    assert.equal(new URL(target).hostname, 'api.cloudflare.com'); assert.equal(init.redirect, 'manual');
    assert.equal(init.headers.Authorization, 'Bearer cloud-secret'); assert.equal(init.headers.apikey, undefined);
    const body = JSON.parse(init.body); assert.equal(body.url, url); assert.equal(body.gotoOptions.waitUntil, 'networkidle2');
    assert.ok(!JSON.stringify(body).includes('cloud-secret'));
    return Response.json({ success: true, result: html(), meta: { finalUrl: url, status: 200 } });
  });
  assert.equal((await renderer(url)).url, url);
  const missing = createCloudflareRenderer(env, async () => Response.json({ success: true, result: html() }));
  await assert.rejects(missing(url), /browser_invalid_response/);
  const redirected = createCloudflareRenderer(env, async () => new Response('', { status: 302, headers: { location: 'https://evil.retailer.com/' } }));
  await assert.rejects(redirected(url), /browser_http_302/);
});

test('rendering verifies the exact variant, includes OOS prices, and never accepts an unrelated or oversized rendered page', async () => {
  const noData = async () => response('<title>Loading</title>');
  const render = async () => ({ html: html(), url, status: 200 });
  const recovered = await observeProduct(url, noData, render);
  assert.equal(recovered.verified, true); assert.equal(recovered.availability, 'OutOfStock');
  assert.equal(recovered.transport, 'browser'); assert.equal(recovered.browser_recovery.outcome, 'recovered');
  for (const final of ['https://shop.retailer.com/', url.replace('123456789', '987654321'), 'http://localhost/']) {
    const result = await observeProduct(url, noData, async () => ({ html: html(final), url: final, status: 200 }));
    assert.equal(result.verified, false); assert.notEqual(result.browser_recovery.outcome, 'recovered');
  }
  const wrong = await observeProduct(url, noData, async () => ({ html: html(url.replace('123456789', '987654321')), url, status: 200 }));
  assert.equal(wrong.verified, false);
  const large = await observeProduct(url, noData, async () => ({ html: html() + ' '.repeat(16 * 1024 * 1024), url, status: 200 }));
  assert.equal(large.verified, false); assert.equal(large.browser_recovery.outcome, 'page_too_large');
});

test('a rendered challenge pauses that merchant, while known deleted listings never consume browser calls', async () => {
  let calls = 0;
  const render = boundedRenderer(async () => { calls++; return { html: '<title>Robot or human?</title>', url, status: 200 }; }, 4);
  const first = await observeProduct(url, async () => response(''), render);
  assert.equal(first.reason, 'merchant_challenge');
  const next = await observeProduct(url, async () => response(''), render);
  assert.equal(next.browser_recovery.attempted, false); assert.equal(next.browser_recovery.outcome, 'browser_host_paused');
  const gone = await observeProduct(url, async () => response('', 404), render);
  assert.equal(gone.reason, 'merchant_http_404'); assert.equal(calls, 1);
  calls = 0;
  const concurrent = boundedRenderer(async () => { calls++; return { html: '<title>Access Denied</title>', url, status: 200 }; }, 4);
  await Promise.all(Array.from({ length: 3 }, () => observeProduct(url, async () => response(''), concurrent)));
  assert.equal(calls, 1);
});

test('transient failures retry once, respect Retry-After and expose a later cooldown without retrying permanent failures', async () => {
  let calls = 0; const sleeps = [];
  const result = await fetchProduct(url, async () => ++calls === 1 ? new Response('', { status: 429, headers: { 'Retry-After': '2' } }) : response(), { sleep: async ms => sleeps.push(ms) });
  assert.equal(result.verified, true); assert.equal(calls, 2); assert.deepEqual(sleeps, [2000]);
  calls = 0;
  await assert.rejects(fetchProduct(url, async () => { calls++; return new Response('', { status: 429, headers: { 'Retry-After': '120' } }); }, { sleep: async () => assert.fail('must not wait') }), error => error.message === 'merchant_http_429' && !!error.retry_at);
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(fetchProduct(url, async () => { calls++; return response('', 403); }), /merchant_http_403/);
  assert.equal(calls, 1);
});

test('Express renamed product IDs preserve path selections and reject other products, colors, sizes or generic prices', () => {
  const original = 'https://www.express.com/clothing/women/old-slug/pro/07483080/';
  const final = 'https://www.express.com/clothing/women/new-slug/pro/07483080/color/Chianti/e/regular/';
  assert.doesNotThrow(() => validateDestination(new URL(original), new URL(final)));
  const variant = final + 'size/2/';
  assert.equal(extractPrice(html(variant), final).verified, true);
  assert.equal(extractPrice(html(final.replace('Chianti', 'Black')), final).verified, false);
  assert.equal(extractPrice(html(original), final).verified, false);
  for (const changed of [final.replace('Chianti', 'Black'), original, final.replace('07483080', '07483081')]) {
    assert.throws(() => validateDestination(new URL(final), new URL(changed)), /redirect_changed_product/);
  }
});

test('Uniqlo color/size and marketplace seller selectors cannot silently select another offer', () => {
  const selected = 'https://www.uniqlo.com/us/en/products/E482245-000/00?colorDisplayCode=03&sizeDisplayCode=005';
  assert.equal(extractPrice(html(selected), selected).verified, true);
  assert.equal(extractPrice(html(selected.replace('Code=03', 'Code=09')), selected).verified, false);
  assert.equal(extractPrice(html(selected.split('?')[0]), selected).verified, false);
  const seller = 'https://www.walmart.com/ip/Shirt/1234567?selectedSellerId=0';
  assert.equal(extractPrice(html(seller.replace('Id=0', 'Id=1')), seller).verified, false);
});

test('legacy HTTP links upgrade to HTTPS without fetching HTTP, preserving the catalog URL and selected variant', async () => {
  const legacy = url.replace('https:', 'http:'); const calls = [];
  const observation = await observeProduct(legacy, async target => { calls.push(target); return response(); });
  assert.equal(observation.verified, true); assert.deepEqual(calls, [url]);
  assert.deepEqual(observation.url_upgrade, { from: legacy, to: url });
  for (const unsafe of ['http://127.0.0.1/p', 'http://user:pass@shop.retailer.com/p', 'http://shop.retailer.com:8080/p', 'http://project.supabase.co/p']) {
    assert.throws(() => listingUrl(unsafe), /unsafe_product_url/);
  }
});

test('known Schema.org stock statuses retain their meaning, unknown stock stays rejected and foreign amounts retain their currency', () => {
  for (const stock of ['OnlineOnly', 'LimitedAvailability', 'PreOrder', 'BackOrder', 'Discontinued']) {
    const result = extractPrice(html().replace('OutOfStock', stock), url);
    assert.equal(result.verified, true); assert.equal(result.availability, stock);
  }
  assert.equal(extractPrice(html().replace('OutOfStock', 'UnknownStatus'), url).verified, false);
  const foreign = extractPrice(html().replace('USD', 'GBP'), url);
  assert.equal(foreign.verified, false); assert.equal(foreign.extracted_price, 'GBP 12.00');
});

test('recovered prices remain proposals even with live configuration and database headers never reach merchants', async () => {
  const env = { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_KEY: 'secret', DRY_RUN: 'false' }, calls = [];
  const report = await runBatch(env, { dryRun: true }, async (target, init) => {
    calls.push(init.method);
    if (new URL(target).hostname === 'project.supabase.co') return Response.json([{ item_id: 1, item_price: '$20.00', item_web_listing: url }]);
    assert.equal(init.headers.apikey, undefined); assert.equal(init.headers.Authorization, undefined); return response('');
  }, async () => ({ html: html(), url, status: 200 }));
  assert.equal(report.summary.would_update, 1); assert.equal(report.summary.updated, 0); assert.ok(calls.every(method => method === 'GET'));
});

test('recovery CLI plans every failure offline and cannot enable writes through environment configuration', () => {
  const dir = mkdtempSync(join(tmpdir(), 'price-recovery-'));
  try {
    const input = join(dir, 'input.json'), output = join(dir, 'output.json');
    writeFileSync(input, JSON.stringify({ results: [{ item_id: '1', status: 'error', reason: 'merchant_http_403', url }, { item_id: '2', status: 'skipped', reason: 'variant_not_verified', url }] }));
    execFileSync(process.execPath, ['scripts/recover.mjs', '--input', input, '--output', output], { env: { ...process.env, DRY_RUN: 'false' } });
    const report = JSON.parse(readFileSync(output)); assert.equal(report.original_failures, 2); assert.equal(report.database_writes, 0);
    assert.equal(report.price_updates_enabled, false); assert.equal(report.rechecked, 0); assert.equal(report.remaining, 2);
    assert.ok(report.results.every(row => row.recovery.next_step));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
