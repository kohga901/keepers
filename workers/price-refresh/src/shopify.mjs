import { variantParams, formatPrice } from './extract.mjs';

async function jsonGet(url, fetcher) {
  const response = await fetcher(url.href, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(10000),
    headers: { Accept: 'application/json', 'User-Agent': 'KeepersPriceRefresh/1.0' } });
  // Shopify's .js endpoints return JSON with a JavaScript MIME type; parse JSON only, never execute it.
  if (!response.ok || !/^(?:application\/(?:json|[^;]+\+json|javascript)|text\/javascript)(?:;|$)/i.test(response.headers.get('content-type') ?? '')) { await response.body?.cancel(); return null; }
  const reader = response.body?.getReader(), chunks = []; let bytes = 0;
  try {
    if (!reader) return null;
    while (true) { const { value, done } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > 2 * 1024 * 1024) return null; chunks.push(value); }
    const buffer = new Uint8Array(bytes); let offset = 0;
    for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder().decode(buffer));
  } finally { await reader?.cancel().catch(() => {}); }
}

export async function fetchShopifyVariant(pageUrl, fetcher) {
  const page = new URL(pageUrl), route = page.pathname.match(/^(.*\/)products\/([^/]+)\/?$/), id = page.searchParams.get('variant');
  if (!route || !/^\d{8,20}$/.test(id ?? '') || page.searchParams.getAll('variant').length !== 1 ||
      variantParams(page).some(key => key !== 'variant') ||
      [...page.searchParams.keys()].some(key => /selling_plan|discount|member|customer|subscription/i.test(key)) ||
      (page.searchParams.has('currency') && page.searchParams.get('currency').toUpperCase() !== 'USD')) return null;
  const productUrl = new URL(`${route[1]}products/${route[2]}.js`, page), cartUrl = new URL(`${route[1]}cart.js`, page);
  for (const key of ['currency', 'country']) if (page.searchParams.has(key)) {
    if (page.searchParams.getAll(key).length !== 1) return null;
    productUrl.searchParams.set(key, page.searchParams.get(key)); cartUrl.searchParams.set(key, page.searchParams.get(key));
  }
  try {
    const [product, cart] = await Promise.all([jsonGet(productUrl, fetcher), jsonGet(cartUrl, fetcher)]);
    if (!product || cart?.currency !== 'USD' || (product.currency && product.currency !== 'USD') ||
        product.handle !== decodeURIComponent(route[2]) || !Number.isSafeInteger(product.id) || product.requires_selling_plan === true ||
        !Number.isSafeInteger(product.price_min) || !Number.isSafeInteger(product.price_max) || !Array.isArray(product.variants)) return null;
    const matches = product.variants.filter(variant => Number.isSafeInteger(variant.id) && String(variant.id) === id);
    if (!matches.length && product.variants.length > 0 && product.variants.length < 250 &&
        product.variants.every(variant => Number.isSafeInteger(variant.id))) return { verified: false, reason: 'variant_not_listed',
      source: 'shopify_ajax', product_name: product.title ?? null, fetched_url: page.href,
      evidence_urls: [productUrl.href, cartUrl.href], published_variants: product.variants.length };
    if (matches.length !== 1) return null;
    const variant = matches[0];
    if (variant.requires_selling_plan === true || !Number.isSafeInteger(variant.price) || variant.price <= 0 || variant.price >= 10_000_000_000 ||
        variant.price < product.price_min || variant.price > product.price_max || typeof variant.available !== 'boolean') return null;
    return { verified: true, reason: null, extracted_price: formatPrice(variant.price), currency: 'USD',
      availability: variant.available ? 'InStock' : 'OutOfStock', source: 'shopify_ajax', product_name: product.title ?? null,
      variant_id: id, fetched_url: page.href, evidence_urls: [productUrl.href, cartUrl.href] };
  } catch { return null; }
}
