import { createPriceExtractor, priceCents, formatPrice, sameProduct, sameMerchant, fragmentSelection } from './extract.mjs';
import { createCloudflareRenderer } from './browser.mjs';
import { recoveryFor, browserCandidate, failureObservation } from './recovery.mjs';
import { fetchShopifyVariant } from './shopify.mjs';
import { freeTierFetcher, FREE_TIER_LIMITS } from './free-tier.mjs';

const MAX_BYTES = 16 * 1024 * 1024;
const MAX_REPORT_ROWS = 50;

export function publicUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('invalid_product_url'); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') ||
      !host.includes('.') || host.includes(':') || /^[\d.]+$/.test(host) ||
      /(^|\.)(localhost|local|internal|test|invalid|example|onion)$/.test(host) ||
      /\.(supabase\.co|supabase\.net)$/.test(host)) throw new Error('unsafe_product_url');
  url.hash = '';
  return url;
}

export function listingUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('invalid_product_url'); }
  // Upgrade legacy catalog links without making an insecure HTTP request or changing selections.
  if (url.protocol === 'http:' && (!url.port || url.port === '80')) { url.protocol = 'https:'; url.port = ''; }
  const validated = publicUrl(url.href); validated.hash = url.hash; return validated;
}

async function extractResponse(response, pageUrl) {
  if (Number(response.headers.get('content-length')) > MAX_BYTES) {
    await response.body?.cancel();
    throw new Error('page_too_large');
  }
  const extractor = createPriceExtractor(pageUrl);
  if (!response.body) return extractor.finish();
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw new Error('page_too_large');
      // Parse incrementally: large CSS/JS/page markup is never retained as one HTML string.
      for (let start = 0; start < value.length; start += 16 * 1024) {
        extractor.write(decoder.decode(value.subarray(start, start + 16 * 1024), { stream: true }));
      }
    }
    extractor.write(decoder.decode());
    return extractor.finish();
  } finally { await reader.cancel().catch(() => {}); }
}

export function validateDestination(original, next) {
  if (!sameMerchant(next, original)) throw new Error('redirect_changed_product');
  if (fragmentSelection(original) && fragmentSelection(original).signature !== fragmentSelection(next)?.signature) throw new Error('redirect_changed_product');
  if (original.hostname.replace(/^www\./, '') === 'express.com') for (const key of ['color', 'size', 'e']) {
    const selection = url => decodeURI(url.pathname).match(new RegExp(`/${key}/([^/]+)(?:/|$)`))?.[1];
    if (selection(original) && selection(next) !== selection(original)) throw new Error('redirect_changed_product');
  }
  const variant = original.searchParams.get('variant');
  const renamedVariant = variant && original.searchParams.getAll('variant').length === 1 &&
    next.searchParams.getAll('variant').length === 1 && next.searchParams.get('variant') === variant &&
    /\/products\/[^/]+\/?$/.test(original.pathname) && /\/products\/[^/]+\/?$/.test(next.pathname);
  const productId = input => input.pathname.match(/\/(\d{6,}(?:_\d+)*)(?:\.html)?\/?$/)?.[1];
  const renamedId = productId(original) && productId(original) === productId(next);
  if (!sameProduct(next.href, original.href) && !renamedVariant && !renamedId) throw new Error('redirect_changed_product');
  for (const [key, val] of original.searchParams) {
    if (/^(utm_|gclid$|fbclid$|srsltid$|source$|menu$|ip$|sty_de_label$|tid$)/i.test(key)) continue;
    const insensitive = /^(currency|country|locale)$/i.test(key), actual = next.searchParams.get(key);
    if (actual === null || (insensitive ? actual.toLowerCase() !== val.toLowerCase() : actual !== val) ||
        next.searchParams.getAll(key).length !== original.searchParams.getAll(key).length) throw new Error('redirect_changed_product');
  }
}

async function fetchProductOnce(value, fetcher) {
  const original = publicUrl(value);
  original.hash = new URL(value).hash;
  let url = original;
  const history = [];
  // One deadline includes redirects and the response body, not just response headers.
  const signal = AbortSignal.timeout(15_000);
  for (let redirects = 0; redirects <= 3; redirects++) {
    const response = await fetcher(url.href, { method: 'GET', redirect: 'manual', signal,
      headers: { Accept: 'text/html,application/xhtml+xml', 'User-Agent': 'KeepersPriceRefresh/1.0' } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get('location');
      if (!location) throw new Error('invalid_redirect');
      const next = publicUrl(new URL(location, url).href);
      next.hash = location.includes('#') ? new URL(location, url).hash : url.hash;
      history.push({ status: response.status, from: url.href, to: next.href });
      try { validateDestination(original, next); }
      catch (error) { throw Object.assign(error, { redirects: history }); }
      url = next;
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      const retryAfter = response.headers.get('retry-after');
      const delay = retryAfter === null ? 1000 : /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now();
      const retryTime = Date.now() + Math.max(0, delay);
      throw Object.assign(new Error(`merchant_http_${response.status}`),
        /^(429|5\d\d)$/.test(String(response.status)) && Number.isFinite(delay)
          ? { retry_delay: Math.max(0, delay), ...(retryTime <= 8.64e15 ? { retry_at: new Date(retryTime).toISOString() } : {}) } : {});
    }
    if (!/^(text\/html|application\/xhtml\+xml)(;|$)/i.test(response.headers.get('content-type') ?? '')) {
      await response.body?.cancel(); throw new Error('unsupported_content_type');
    }
    const observation = await extractResponse(response, url.href);
    // A renamed page must identify the exact preserved variant, not just expose a generic price.
    if (!sameProduct(original.href, url.href) && original.searchParams.has('variant') &&
        observation.variant_id !== original.searchParams.get('variant')) {
      observation.verified = false;
      observation.reason = 'variant_not_verified';
    }
    return { ...observation, fetched_url: url.href, ...(history.length ? { redirects: history } : {}) };
  }
  throw new Error('too_many_redirects');
}

export async function fetchProduct(value, fetcher = fetch, { sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try { return await fetchProductOnce(value, fetcher); }
    catch (error) {
      const transient = /^merchant_http_(429|5\d\d)$/.test(error.message) || ['TimeoutError', 'AbortError', 'TypeError'].includes(error.name);
      if (attempt || !transient || error.retry_delay > 5000) throw error;
      await sleep(Math.max(1000, error.retry_delay ?? 1000));
    }
  }
}

export async function extractRenderedProduct(value, rendered) {
  const original = listingUrl(value), final = listingUrl(rendered.url);
  if (!Number.isInteger(rendered.status) || rendered.status < 200 || rendered.status >= 300) throw new Error(`merchant_http_${rendered.status}`);
  try { validateDestination(original, final); }
  catch (error) { throw Object.assign(error, { destination: final.href }); }
  const result = await extractResponse(new Response(rendered.html), final.href);
  if (!sameProduct(original.href, final.href) && original.searchParams.has('variant') && result.variant_id !== original.searchParams.get('variant')) {
    result.verified = false; result.reason = 'variant_not_verified';
  }
  return { ...result, fetched_url: final.href, transport: 'browser' };
}

export async function observeProduct(value, fetcher = fetch, renderer = null) {
  const original = listingUrl(value);
  let observation;
  try { observation = await fetchProduct(original.href, fetcher); }
  catch (error) { observation = failureObservation(error); }
  if (!observation.verified && ['variant_not_verified', 'no_supported_product_data', 'product_or_offer_not_verified', 'missing_or_invalid_price', 'availability_unknown',
    'merchant_http_403','merchant_http_405','merchant_http_406','merchant_challenge','page_too_large','product_data_too_large','requires_browser_rendering','free_tier_page_limit'].includes(observation.reason)) {
    const product = await fetchShopifyVariant(original.href, fetcher);
    if (product) observation = { ...product, recovered_from: observation.reason };
  }
  if (String(value).startsWith('http:')) observation.url_upgrade = { from: value, to: original.href };
  if (observation.verified || !renderer || !browserCandidate(observation.reason)) return observation;
  const recovery = { attempted: false, initial_reason: observation.reason };
  try {
    recovery.attempted = true;
    const rendered = await renderer(original.href);
    const result = await extractRenderedProduct(original.href, rendered);
    recovery.outcome = result.verified ? 'recovered' : result.reason;
    if (result.reason === 'merchant_challenge') renderer.block?.(original.href);
    return { ...result, ...(observation.url_upgrade ? { url_upgrade: observation.url_upgrade } : {}), browser_recovery: recovery };
  } catch (error) {
    const safe = /^(browser_(host_paused|budget_exhausted|http_\d+|page_too_large|invalid_response)|merchant_http_\d+|redirect_changed_product|unsafe_product_url|page_too_large|product_data_too_large)$/;
    recovery.outcome = safe.test(error.message) ? error.message : 'browser_request_failed';
    if (error.destination) recovery.destination = error.destination;
    if (['browser_host_paused', 'browser_budget_exhausted'].includes(recovery.outcome)) recovery.attempted = false;
    if (recovery.outcome === 'redirect_changed_product' && /\/(?:blocked|verify|px)(?:[/?]|$)|siteclosed\.|\/captcha(?:[/?]|$)|\/PX-Show(?:[/?]|$)/i.test(String(error.destination ?? ''))) renderer.block?.(original.href);
    if (/^merchant_http_(401|402|403|405|406)$/.test(recovery.outcome)) renderer.block?.(original.href);
    return { ...observation, browser_recovery: recovery };
  }
}

export function catalogConfig(env) {
  const url = new URL(env.SUPABASE_URL);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
      !url.hostname.endsWith('.supabase.co')) throw new Error('invalid_supabase_url');
  if (!env.SUPABASE_KEY?.trim()) throw new Error('missing_supabase_key');
  const headers = { apikey: env.SUPABASE_KEY };
  if (env.SUPABASE_KEY.startsWith('eyJ')) headers.Authorization = `Bearer ${env.SUPABASE_KEY}`;
  return { url, headers };
}

async function database(config, params, fetcher, options = {}) {
  const url = new URL('/rest/v1/Clothing', config.url);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  // Workers supports manual/follow, not redirect:error. Reject 3xx without forwarding credentials.
  const response = await fetcher(url.href, { method: 'GET', redirect: 'manual', ...options,
    signal: AbortSignal.timeout(15_000), headers: { ...config.headers, ...options.headers } });
  if (!response.ok) throw new Error(`supabase_http_${response.status}`);
  const data = await response.json();
  if (!Array.isArray(data)) throw new Error('invalid_supabase_response');
  return data;
}

export function cursorId(value = '0') {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error('invalid_after_id');
  const id = String(value);
  if (!/^\d{1,19}$/.test(id) || BigInt(id) > 9223372036854775807n) throw new Error('invalid_after_id');
  return BigInt(id).toString();
}

function rowId(value) {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error('unsafe_item_id');
  return cursorId(value);
}

function storedCents(value) {
  const text = String(value ?? '').trim();
  if (!/^(\$|USD\s+)?(\d+|\d{1,3}(,\d{3})+)(\.\d{1,2})?$/.test(text)) return null;
  return priceCents(text.replace(/^(\$|USD\s+)/, '').replaceAll(',', ''));
}

export async function runBatch(env, { afterId = '0', limit = 50, dryRun = true, beforeProcess } = {}, fetcher = fetch, renderer = undefined) {
  const config = catalogConfig(env);
  const freeTier = env.FREE_TIER === 'true';
  afterId = cursorId(afterId);
  if (!Number.isInteger(limit) || limit < 1 || limit > (freeTier ? 1 : MAX_REPORT_ROWS)) throw new Error('invalid_batch_size');
  // Neither an HTTP body nor a missing/misspelled environment variable can enable writes.
  if (!dryRun && env.DRY_RUN !== 'false') throw new Error('writes_disabled');
  if (freeTier) { fetcher = freeTierFetcher(fetcher); renderer = null; }
  else renderer ??= createCloudflareRenderer(env, fetcher);
  const startedAt = new Date().toISOString();
  const rows = await database(config, { select: 'item_id,item_name,item_price,item_web_listing',
    item_id: `gt.${afterId}`, order: 'item_id.asc', limit: String(limit) }, fetcher);
  if (freeTier && rows.length > 1) throw new Error('invalid_supabase_response');
  // The Free cron reserves its single row before parsing; a CPU termination cannot pin that cursor.
  if (beforeProcess) await beforeProcess(rows.length < limit ? '0' : rowId(rows.at(-1).item_id));
  const results = [];
  // Bound concurrency and share identical URLs within a batch without removing variant parameters.
  const fetched = new Map();
  let position = 0;
  async function processRows() {
    while (position < rows.length) {
      const index = position++, row = rows[index];
      const result = { item_id: rowId(row.item_id), item_name: row.item_name,
        url: row.item_web_listing, stored_price: row.item_price, extracted_price: null,
        checked_at: new Date().toISOString(), status: 'skipped' };
      results[index] = result;
      if (!row.item_web_listing?.trim()) { result.reason = 'missing_product_url'; continue; }
      let observation;
      try {
        const url = row.item_web_listing;
        listingUrl(url);
        if (!fetched.has(url)) fetched.set(url, observeProduct(row.item_web_listing, fetcher, renderer));
        observation = await fetched.get(url);
      } catch (error) {
        result.status = 'error';
        Object.assign(result, failureObservation(error));
        continue;
      }
      Object.assign(result, observation);
      if (observation.request_failed) result.status = 'error';
      if (!observation.verified) continue;
      const cents = storedCents(observation.extracted_price);
      if (cents === storedCents(row.item_price)) { result.status = 'unchanged'; continue; }
      result.status = 'would_update';
      if (dryRun) continue;
      // Compare-and-set prevents replacing a price/URL changed since this batch read it.
      try {
        const updated = await database(config, { item_id: `eq.${result.item_id}`,
          item_price: row.item_price == null ? 'is.null' : `eq.${row.item_price}`,
          item_web_listing: `eq.${row.item_web_listing}`, select: 'item_id' }, fetcher, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
          body: JSON.stringify({ item_price: formatPrice(cents) }),
        });
        result.status = updated.length === 1 ? 'updated' : 'conflict';
      } catch (error) {
        result.status = 'error';
        result.reason = /^supabase_http_\d+$/.test(error.message) ? error.message : 'supabase_write_failed';
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, rows.length) }, processRows));
  for (const result of results) if (['error', 'skipped'].includes(result.status)) result.recovery = recoveryFor(result);
  const complete = rows.length < limit;
  return { id: crypto.randomUUID(), mode: dryRun ? 'dry_run' : 'live', started_at: startedAt,
    finished_at: new Date().toISOString(), after_id: afterId,
    next_after_id: complete ? '0' : rowId(rows.at(-1).item_id), cycle_complete: complete,
    summary: results.reduce((counts, result) => { counts[result.status] = (counts[result.status] ?? 0) + 1; return counts; },
      { checked: rows.length, would_update: 0, updated: 0, unchanged: 0, skipped: 0, error: 0, conflict: 0 }),
    warning: rows.length === 0 && afterId === '0' ? 'No visible Clothing rows. Verify the key has SELECT access; RLS can hide rows without an error.' : null,
    ...(renderer?.stats ? { browser: { ...renderer.stats } } : {}),
    ...(freeTier ? { free_tier: { ...FREE_TIER_LIMITS, fetches_used: fetcher.stats.requests } } : {}), results };
}
