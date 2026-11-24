import { Parser } from 'htmlparser2';

// Currency must be established separately; a dollar sign alone is not evidence of USD.
export function priceCents(value) {
  const text = String(value ?? '').trim();
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return cents > 0 && cents < 10_000_000_000 ? cents : null;
}

export const formatPrice = cents => `$${(cents / 100).toFixed(2)}`;

const types = node => [node?.['@type']].flat().map(type => String(type).split('/').pop());
export const variantParams = url => [...url.searchParams.keys()].filter(key =>
  /^(variant|sku[-_]?id|sku|pid|colou?r[-_]?id|colou?r|size|seq)$|^dwvar_/i.test(key));
const path = url => decodeURI(url.pathname).normalize('NFC').replace(/\/+$/, '') || '/';

export const sameMerchant = (a, b) => a.hostname.replace(/^www\./, '') === b.hostname.replace(/^www\./, '');

export function sameProduct(left, right) {
  try {
    const a = new URL(left, right), b = new URL(right);
    return sameMerchant(a, b) && path(a) === path(b);
  } catch { return false; }
}

function exactVariant(candidate, pageUrl) {
  try {
    const page = new URL(pageUrl), other = new URL(candidate, page);
    return sameProduct(other.href, page.href) && variantParams(page).every(key =>
      page.searchParams.getAll(key).length === 1 && other.searchParams.getAll(key).length === 1 &&
      page.searchParams.get(key) === other.searchParams.get(key));
  } catch { return false; }
}

function readPage(html) {
  const scripts = [], embeddedProducts = [], meta = new Map();
  let script = null, canonical = null;
  let scriptKind = null;
  const parser = new Parser({
    onopentag(name, attributes) {
      if (name === 'script') {
        const type = attributes.type?.toLowerCase().split(';')[0].trim();
        scriptKind = type === 'application/ld+json' ? 'json_ld' : type === 'application/json' &&
          (Object.hasOwn(attributes, 'data-product-json') || Object.hasOwn(attributes, 'data-product')) ? 'product_json' : null;
        if (scriptKind) script = '';
      }
      if (name === 'meta') {
        const key = (attributes.property ?? attributes.name ?? '').toLowerCase();
        if (!meta.has(key)) meta.set(key, attributes.content ?? '');
        else if (meta.get(key) !== attributes.content) meta.set(key, '');
      }
      if (name === 'link' && attributes.rel?.toLowerCase().split(/\s+/).includes('canonical')) canonical = attributes.href;
    },
    ontext(text) { if (script !== null) script += text; },
    onclosetag(name) {
      if (name === 'script' && script !== null) {
        try { (scriptKind === 'json_ld' ? scripts : embeddedProducts).push(JSON.parse(script)); }
        catch { /* Other valid product blocks may remain. */ }
        script = null;
        scriptKind = null;
      }
    },
  }, { decodeEntities: true });
  parser.end(html);
  return { scripts, embeddedProducts, meta, canonical };
}

function productsFrom(scripts) {
  const products = [], references = new Map();
  function index(node) {
    if (!node || typeof node !== 'object') return;
    if (typeof node['@id'] === 'string' && Object.keys(node).length > 1) references.set(node['@id'], node);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(index);
      else if (value && typeof value === 'object') index(value);
    }
  }
  function visit(node) {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== 'object') return;
    if (types(node).includes('Product')) products.push(node);
    // Do not mistake products nested in a recommended-items ItemList for the page's product.
    for (const key of ['@graph', 'mainEntity', 'hasVariant']) if (node[key]) visit(node[key]);
  }
  scripts.forEach(index);
  scripts.forEach(visit);
  return { products, resolve: node => references.get(node?.['@id']) ?? node };
}

function offerValue(offer, resolve) {
  offer = resolve(offer);
  if (!offer || typeof offer !== 'object') return null;
  if (types(offer).includes('AggregateOffer')) {
    if (priceCents(offer.lowPrice) === null || priceCents(offer.lowPrice) !== priceCents(offer.highPrice)) {
      return { reason: 'price_range' };
    }
  }
  // Conditional PriceSpecifications can represent member, unit, or installment prices.
  // shortcut: only plain Offer.price is supported; add a verified adapter when needed.
  const cents = priceCents(offer.price ?? (types(offer).includes('AggregateOffer') ? offer.lowPrice : null));
  if (cents === null) return { reason: 'missing_or_invalid_price' };
  const currency = String(offer.priceCurrency ?? '').toUpperCase();
  const availability = String(offer.availability ?? '').split('/').pop();
  const expires = offer.priceValidUntil && Date.parse(offer.priceValidUntil.length === 10
    ? `${offer.priceValidUntil}T23:59:59.999Z` : offer.priceValidUntil);
  return { cents, currency, availability, url: offer.url,
    reason: currency !== 'USD' ? 'currency_not_usd' :
      offer.validForMemberTier || offer.eligibleCustomerType ? 'conditional_offer' :
      expires && expires < Date.now() ? 'expired_offer' :
      availability !== 'InStock' ? (availability ? 'not_in_stock' : 'availability_unknown') : null };
}

export function extractPrice(html, pageUrl) {
  const { scripts, embeddedProducts, meta, canonical } = readPage(html);
  const { products, resolve } = productsFrom(scripts);
  const selectedVariant = variantParams(new URL(pageUrl)).length > 0;
  const offersOf = product => [product.offers].flat().map(resolve).filter(Boolean);
  // Some ProductGroup children omit Product.url but identify themselves through Offer.url.
  const exactOffers = products.filter(product => offersOf(product).some(offer => offer.url && exactVariant(offer.url, pageUrl)));
  const identified = products.filter(product => (product.url && sameProduct(product.url, pageUrl)) ||
    offersOf(product).some(offer => offer.url && sameProduct(offer.url, pageUrl)));
  const exactProducts = selectedVariant ? identified.filter(product => product.url && exactVariant(product.url, pageUrl)) : [];
  const primary = selectedVariant && exactOffers.length ? exactOffers : exactProducts.length ? exactProducts : identified.length ? identified :
    products.length === 1 && !products[0].url ? products : [];
  const values = [];
  for (const product of primary) {
    let offers = offersOf(product);
    const matches = offers.filter(offer => offer.url && exactVariant(offer.url, pageUrl));
    if (selectedVariant) {
      const productMatches = product.url && exactVariant(product.url, pageUrl);
      if (matches.length) offers = matches;
      else if (!productMatches || offers.some(offer => {
        try { return offer.url && variantParams(new URL(offer.url, pageUrl)).length > 0; } catch { return true; }
      })) { values.push({ reason: 'variant_not_verified' }); continue; }
    } else if (matches.length) offers = matches;
    values.push(...offers.map(offer => ({ ...offerValue(offer, resolve), product_name: product.name, source: 'json_ld',
      ...(matches.length && new URL(pageUrl).searchParams.has('variant')
        ? { variant_id: new URL(pageUrl).searchParams.get('variant') } : {}) })));
  }
  if (selectedVariant && !exactOffers.length && !exactProducts.length) {
    const embedded = embeddedVariantOffers(embeddedProducts, products, meta, pageUrl, resolve);
    if (embedded.length) values.splice(0, values.length, ...embedded);
  }
  // Use page-level product metadata only if no structured product offers were found.
  if (!values.length && !products.length && ['product', 'product.item'].includes(meta.get('og:type')?.toLowerCase())) {
    const identity = meta.get('og:url') || canonical;
    if (identity && exactVariant(identity, pageUrl)) {
      values.push({ ...offerValue({ price: meta.get('product:price:amount'),
        priceCurrency: meta.get('product:price:currency'),
        availability: meta.get('product:availability') === 'in stock' ? 'InStock' : meta.get('product:availability') }, resolve),
      source: 'product_meta', product_name: meta.get('og:title') });
    }
  }
  if (!values.length) return { verified: false, reason: products.length ? 'product_or_offer_not_verified' : 'no_supported_product_data' };
  const priced = values.filter(value => value.cents != null);
  const unique = new Set(priced.map(value => `${value.currency}:${value.cents}`));
  if (unique.size > 1) return { verified: false, reason: 'ambiguous_offers' };
  const first = priced[0] ?? values[0];
  const reason = values.find(value => value.reason)?.reason ??
    (priced.length !== values.length ? 'missing_or_invalid_price' : null);
  return {
    verified: !reason && priced.length === values.length,
    reason: reason ?? null,
    extracted_price: first.cents == null ? null : formatPrice(first.cents),
    currency: first.currency ?? null,
    availability: first.availability ?? null,
    source: first.source,
    product_name: first.product_name ?? null,
    ...(first.variant_id ? { variant_id: first.variant_id } : {}),
  };
}

function embeddedVariantOffers(blocks, products, meta, pageUrl, resolve) {
  const page = new URL(pageUrl), selected = page.searchParams.get('variant');
  // Shopify's marked product JSON supplies integer cents and per-variant availability.
  // Other selector combinations still need an exact offer URL rather than an inferred match.
  if (!selected || variantParams(page).some(key => key !== 'variant') || page.searchParams.getAll('variant').length !== 1) return [];
  const scopedOffers = products.filter(product => product.url && sameProduct(product.url, pageUrl))
    .flatMap(product => [product.offers].flat().map(resolve)).filter(Boolean);
  if (scopedOffers.some(offer => ['conditional_offer', 'expired_offer'].includes(offerValue(offer, resolve)?.reason))) return [];
  const currencyEvidence = scopedOffers.map(offer => offer.priceCurrency).filter(Boolean);
  if (meta.get('product:price:currency')) currencyEvidence.push(meta.get('product:price:currency'));
  if (!currencyEvidence.length || currencyEvidence.some(currency => String(currency).toUpperCase() !== 'USD')) return [];
  const values = [];
  for (const block of blocks) {
    const product = block?.product ?? block;
    if (typeof product?.handle !== 'string' || !Array.isArray(product.variants) || product.requires_selling_plan === true ||
        !Number.isInteger(product.price_min) || !Number.isInteger(product.price_max)) continue;
    const route = page.pathname.match(/^(.*\/products\/)[^/]+\/?$/);
    if (!route || !sameProduct(new URL(`${route[1]}${encodeURIComponent(product.handle)}`, page).href, pageUrl)) continue;
    for (const variant of product.variants.filter(value => String(value.id) === selected)) {
      if (variant.requires_selling_plan === true || !Number.isSafeInteger(variant.price) || variant.price <= 0 || variant.price >= 10_000_000_000 ||
          variant.price < product.price_min || variant.price > product.price_max || typeof variant.available !== 'boolean') continue;
      values.push({ ...offerValue({ price: (variant.price / 100).toFixed(2), priceCurrency: 'USD',
        availability: variant.available ? 'InStock' : 'OutOfStock' }, resolve),
      product_name: product.title, source: 'embedded_product_json', variant_id: selected });
    }
  }
  return values;
}
