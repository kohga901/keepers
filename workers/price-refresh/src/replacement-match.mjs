const stop = new Set(['the', 'a', 'an', 'and', 'for', 'with', 'women', 'woman', 'men', 'man', 'womens', 'mens', 'womenswear', 'menswear', 'buy', 'shop', 'online', 'sale']);
import { variantParams, sameMerchant as equalMerchant, fragmentSelection } from './extract.mjs';
export const nameTokens = value => [...new Set(String(value ?? '').normalize('NFKD').replace(/[’']/g, '').toLowerCase().match(/[a-z0-9]+/g) ?? [])]
  .filter(token => token.length > 1 && !stop.has(token)).map(token => token.length > 3 ? token.replace(/s$/, '') : token);

export function productIdentifiers(value) {
  const url = new URL(value), ids = new Set();
  for (const match of decodeURIComponent(url.pathname).matchAll(/(?:^|[^a-z0-9])((?:\d{2,}(?:[_-]\d{2,})+)|(?:[a-z]{1,5}\d{3,}[a-z0-9]*)|\d{6,})(?=[^a-z0-9]|$)/gi)) ids.add(match[1].toLowerCase());
  if (/^(?:www\.)?brooksbrothers\.com$/.test(url.hostname)) {
    const fullSku = url.pathname.match(/\/([A-Z]{2}\d{5}_[A-Z0-9_]+)\.html$/i)?.[1];
    if (fullSku) { ids.clear(); ids.add(fullSku.toLowerCase()); }
  }
  for (const [key, value] of url.searchParams) if (/^(sku[-_]?id|sku|skuCode|pid|ID|productId|itemId|selectedSKUId|skid)$/i.test(key) && value.length > 3) ids.add(value.toLowerCase());
  if (fragmentSelection(url)?.sku) ids.add(fragmentSelection(url).sku);
  return [...ids];
}

export function searchHits(text) {
  if (typeof text !== 'string') return [];
  const hits = [];
  for (const block of text.split(/\n-{8,}\n/)) {
    const match = block.match(/(?:^|\n)([^\n]+) \((https?:\/\/[^\n]+)\)\n/);
    if (!match) continue;
    try {
      const url = new URL(match[2].replaceAll('&amp;', '&'));
      if (url.protocol !== 'https:' || url.username || url.password || /(^|\.)(google|bing|youtube|facebook|instagram|pinterest|reddit)\.(com|co\.uk)$/.test(url.hostname)) continue;
      hits.push({ title: match[1], url: url.href, reference: block.match(/cite([^]+)/)?.[1] ?? null,
        snippet: block.slice(block.indexOf('\n') + 1).replace(/[^]+|\[wordlim: \d+\]/g, '').slice(0,600) });
    } catch { /* Search results may contain malformed URLs. */ }
  }
  return hits;
}

export function rankReplacement(row, hit) {
  const wanted = nameTokens(row.item_name ?? row.name), found = new Set(nameTokens(hit.title));
  const coverage = wanted.length ? wanted.filter(token => found.has(token)).length / wanted.length : 0;
  const original = new URL(row.url), candidate = new URL(hit.url);
  const merchant = equalMerchant(original,candidate);
  const identifiers = productIdentifiers(row.url), candidateIds = productIdentifiers(hit.url);
  const shared = identifiers.filter(id => candidateIds.includes(id));
  const exactVariant = original.searchParams.has('variant') && original.searchParams.get('variant') === candidate.searchParams.get('variant');
  if (coverage < 0.5 && !shared.length && !exactVariant) return null;
  if (!merchant && !/\/(products?|p|ip|listing|shop|itm|items?|dp)\//i.test(candidate.pathname) && !/\.html$/i.test(candidate.pathname)) return null;
  return { ...hit, name_coverage: Number(coverage.toFixed(3)), same_merchant: merchant,
    shared_identifiers: shared, preserved_variant_id: exactVariant,
    score: Number((coverage * 5 + (merchant ? 1 : 0) + (merchant && shared.length ? 5 : 0) + (exactVariant ? 10 : 0)).toFixed(3)) };
}

export function assessReplacement(row, candidate, observation) {
  if (!observation) return { status: 'not_checked', exact_match: false };
  if (!observation.verified) return { status: /merchant_http_(401|403|405|406|429)|merchant_challenge/.test(observation.reason ?? '') ? 'access_blocked' : 'not_verified', exact_match: false, reason: observation.reason };
  const source = new URL(row.url), destination = new URL(observation.fetched_url ?? candidate.url);
  const sameMerchant = equalMerchant(source,destination);
  const ids = productIdentifiers(row.url), identity = observation.identity ?? {};
  const candidateIds = [...productIdentifiers(destination.href), identity.sku, identity.product_id, identity.parent_product_id].filter(Boolean).map(value => String(value).toLowerCase());
  const shared = ids.filter(id => candidateIds.includes(id));
  const gtin = String(identity.gtin ?? '').padStart(14, '0');
  const originalGtin=String(row.original_check?.identity?.gtin??'').padStart(14,'0');
  const checksum=/^\d{14}$/.test(gtin)&&gtin.split('').reduce((sum,digit,index)=>sum+Number(digit)*(index%2?1:3),0)%10===0;
  const sameGtin = checksum && /[1-9]/.test(gtin) && gtin === originalGtin;
  const selected = variantParams(source), missing = [];
  for (const key of selected) {
    if (key === '__fragment__') {
      const selection = fragmentSelection(source);
      if (selection.ambiguous) { missing.push(key); continue; }
      if (selection.signature === fragmentSelection(destination)?.signature || (selection.sku && selection.sku === String(identity.sku ?? ''))) continue;
      missing.push(key); continue;
    }
    if (source.searchParams.getAll(key).length !== 1) { missing.push(key); continue; }
    const expected = source.searchParams.get(key);
    if (destination.searchParams.getAll(key).length === 1 && destination.searchParams.get(key) === expected) continue;
    if (key === 'variant' && observation.variant_id === expected) continue;
    if (/^(sku|sku[-_]?id|selectedSKUId)$/i.test(key) && String(identity.sku ?? '') === expected) continue;
    if (/^(color|colour|color_name)$/i.test(key) && String(identity.color ?? '').toLowerCase() === expected.toLowerCase()) continue;
    if (/^(size|sz)$/i.test(key) && String(identity.size ?? '').toLowerCase() === expected.toLowerCase()) continue;
    if (/^dwvar_/.test(key) && identity.sku) {
      const suffix = key.match(/^dwvar_[^_]+_(.+)$/)?.[1];
      if (suffix && destination.searchParams.get(`dwvar_${identity.sku}_${suffix}`) === expected) continue;
    }
    missing.push(key);
  }
  const queryIdentified = /(?:product|detail)\.(?:do|aspx)$|\/product\/detail\/?$/i.test(source.pathname);
  const samePath = sameMerchant && source.pathname.replace(/\/$/,'') === destination.pathname.replace(/\/$/,'') && (!queryIdentified || shared.length > 0);
  const variantId = source.searchParams.get('variant');
  const provenVariant = sameMerchant && variantId && observation.variant_id === variantId;
  const provenProduct = sameGtin || provenVariant || (sameMerchant && shared.length > 0) || samePath;
  // Cross-merchant URL digits alone cannot prove GTIN, condition or equivalent sizing.
  const exact = sameMerchant && !!provenProduct && !missing.length;
  return { status: exact ? 'verified_exact_listing' : provenProduct ? 'product_match_variant_review' : 'live_candidate_identity_review', exact_match: exact,
    shared_identifiers: shared, matched_gtin: sameGtin, unverified_selectors: missing,
    price: observation.extracted_price, currency: observation.currency, availability: observation.availability,
    reason: exact ? 'Product identity and all saved selectors verified.' : provenProduct ? 'Product identity matches; saved selectors need review.' : 'A live price was found, but the exact original product identity is not proven.' };
}
