import { createPriceExtractor, priceCents, formatPrice, sameProduct, sameMerchant } from './extract.mjs';

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

export async function fetchProduct(value, fetcher = fetch) {
  const original = publicUrl(value);
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
      history.push({ status: response.status, from: url.href, to: next.href });
      const reject = () => { throw Object.assign(new Error('redirect_changed_product'), { redirects: history }); };
      if (!sameMerchant(next, original)) reject();
      // Slug changes need a preserved variant ID or a stable numeric product ID.
      const variant = original.searchParams.get('variant');
      const renamedVariant = variant && original.searchParams.getAll('variant').length === 1 &&
        next.searchParams.getAll('variant').length === 1 && next.searchParams.get('variant') === variant &&
        /\/products\/[^/]+\/?$/.test(original.pathname) && /\/products\/[^/]+\/?$/.test(next.pathname);
      const productId = input => input.pathname.match(/\/(\d{6,}(?:_\d+)*)(?:\.html)?\/?$/)?.[1];
      const renamedId = productId(original) && productId(original) === productId(next);
      if (!sameProduct(next.href, original.href) && !renamedVariant && !renamedId) reject();
      // Tracking/navigation parameters can disappear; variant, market and unknown parameters cannot.
      for (const [key, val] of original.searchParams) {
        if (!/^(utm_|gclid$|fbclid$|srsltid$|source$|menu$|ip$|sty_de_label$|tid$)/i.test(key)) {
          const insensitive = /^(currency|country|locale)$/i.test(key);
          const actual = next.searchParams.get(key);
          if (actual === null || (insensitive ? actual.toLowerCase() !== val.toLowerCase() : actual !== val) ||
              next.searchParams.getAll(key).length !== original.searchParams.getAll(key).length) reject();
        }
      }
      url = next;
      continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`merchant_http_${response.status}`); }
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

export async function runBatch(env, { afterId = '0', limit = 50, dryRun = true } = {}, fetcher = fetch) {
  const config = catalogConfig(env);
  afterId = cursorId(afterId);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_REPORT_ROWS) throw new Error('invalid_batch_size');
  // Neither an HTTP body nor a missing/misspelled environment variable can enable writes.
  if (!dryRun && env.DRY_RUN !== 'false') throw new Error('writes_disabled');
  const startedAt = new Date().toISOString();
  const rows = await database(config, { select: 'item_id,item_name,item_price,item_web_listing',
    item_id: `gt.${afterId}`, order: 'item_id.asc', limit: String(limit) }, fetcher);
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
        const url = publicUrl(row.item_web_listing).href;
        if (!fetched.has(url)) fetched.set(url, fetchProduct(url, fetcher));
        observation = await fetched.get(url);
      } catch (error) {
        result.status = 'error';
        result.reason = /^(unsafe_|invalid_|merchant_http_|page_too_large|product_data_too_large|unsupported_content_type|redirect_changed_product|too_many_redirects)/.test(error.message)
          ? error.message : 'merchant_request_failed';
        if (error.redirects) result.redirects = error.redirects;
        continue;
      }
      Object.assign(result, observation);
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
  const complete = rows.length < limit;
  return { id: crypto.randomUUID(), mode: dryRun ? 'dry_run' : 'live', started_at: startedAt,
    finished_at: new Date().toISOString(), after_id: afterId,
    next_after_id: complete ? '0' : rowId(rows.at(-1).item_id), cycle_complete: complete,
    summary: results.reduce((counts, result) => { counts[result.status] = (counts[result.status] ?? 0) + 1; return counts; },
      { checked: rows.length, would_update: 0, updated: 0, unchanged: 0, skipped: 0, error: 0, conflict: 0 }),
    warning: rows.length === 0 && afterId === '0' ? 'No visible Clothing rows. Verify the key has SELECT access; RLS can hide rows without an error.' : null,
    results };
}
