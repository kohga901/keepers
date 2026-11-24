import { Parser } from 'htmlparser2';
import { inlineProductData, retailerProducts } from './retailer-data.mjs';

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

const merchantHost = url => url.hostname === 'ads.midwayusa.com' ? 'midwayusa.com' : url.hostname.replace(/^www\./, '');
export const sameMerchant = (a, b) => merchantHost(a) === merchantHost(b);

export function sameProduct(left, right) {
  try {
    const a = new URL(left, right), b = new URL(right);
    return sameMerchant(a, b) && path(a) === path(b);
  } catch { return false; }
}

function exactVariant(candidate, pageUrl) {
  try {
    const page = new URL(pageUrl), other = new URL(candidate, page);
    // Long Shopify variant IDs identify the offer even when the page's canonical slug differs.
    const id = page.searchParams.get('variant');
    const variantAlias = /^\d{8,20}$/.test(id ?? '') && other.searchParams.get('variant') === id &&
      /\/products\/[^/]+\/?$/.test(page.pathname) && /\/products\/[^/]+\/?$/.test(other.pathname) && sameMerchant(page, other);
    return (sameProduct(other.href, page.href) || variantAlias) && variantParams(page).every(key =>
      page.searchParams.getAll(key).length === 1 && other.searchParams.getAll(key).length === 1 &&
      page.searchParams.get(key) === other.searchParams.get(key));
  } catch { return false; }
}

function parseProductJson(text) {
  try { return JSON.parse(text); } catch {
    // Some Shopify themes emit GTIN identifiers as illegal leading-zero numbers.
    // Quote only those identifier fields; never repair or alter malformed prices.
    return JSON.parse(text.replace(/("gtin(?:8|12|13|14)?"\s*:\s*)(0\d+)(?=\s*[,}])/g, '$1"$2"'));
  }
}

function createPageReader() {
  const scripts = [], embeddedProducts = [], meta = new Map();
  const inline = { shopifyViews: [], asosStock: [] };
  let script = null, canonical = null;
  let scriptKind = null, retained = 0, title = '', inTitle = false, shell = false;
  const parser = new Parser({
    onopentag(name, attributes) {
      if (name === 'script') {
        const type = attributes.type?.toLowerCase().split(';')[0].trim();
        scriptKind = type === 'application/ld+json' ? 'json_ld' : type === 'application/json' &&
          (Object.hasOwn(attributes, 'data-product-json') || Object.hasOwn(attributes, 'data-product')) ? 'product_json' :
          !attributes.src && (!type || type === 'text/javascript' || type === 'application/javascript') ? 'inline' : null;
        if (scriptKind) script = '';
      }
      if (name === 'title') inTitle = true;
      if (attributes.class?.split(/\s+/).includes('skel__price')) shell = true;
      if (name === 'meta') {
        const key = (attributes.property ?? attributes.name ?? '').toLowerCase();
        if (!meta.has(key)) meta.set(key, attributes.content ?? '');
        else if (meta.get(key) !== attributes.content) meta.set(key, '');
      }
      if (name === 'link' && attributes.rel?.toLowerCase().split(/\s+/).includes('canonical')) canonical = attributes.href;
    },
    ontext(text) {
      if (inTitle && title.length < 500) title += text.slice(0, 500 - title.length);
      if (script === null) return;
      if (script.length + text.length > 2 * 1024 * 1024) {
        if (scriptKind === 'inline') { script = null; scriptKind = null; return; }
        throw new Error('product_data_too_large');
      }
      script += text;
    },
    onclosetag(name) {
      if (name === 'title') inTitle = false;
      if (name === 'script' && script !== null) {
        try {
          if (scriptKind === 'inline') {
            const data = inlineProductData(script);
            if (data.shopifyViews.length || data.asosStock.length) {
              retained += script.length;
              inline.shopifyViews.push(...data.shopifyViews); inline.asosStock.push(...data.asosStock);
            }
          } else {
            retained += script.length;
            (scriptKind === 'json_ld' ? scripts : embeddedProducts).push(parseProductJson(script));
          }
        }
        catch { /* Other valid product blocks may remain. */ }
        if (retained > 4 * 1024 * 1024) throw new Error('product_data_too_large');
        script = null;
        scriptKind = null;
      }
    },
  }, { decodeEntities: true });
  return { write: text => parser.write(text), finish() {
    parser.end(); return { scripts, embeddedProducts, meta, canonical, inline, title, shell };
  } };
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
    const low = priceCents(offer.lowPrice), high = priceCents(offer.highPrice), explicit = priceCents(offer.price);
    if ((low !== null && high !== null && low !== high) ||
        (explicit !== null && ((low !== null && low !== explicit) || (high !== null && high !== explicit))) ||
        (explicit === null && (low === null || high === null))) {
      return { reason: 'price_range' };
    }
  }
  // Conditional PriceSpecifications can represent member, unit, or installment prices.
  // shortcut: only plain Offer.price is supported; add a verified adapter when needed.
  const cents = priceCents(offer.price ?? (types(offer).includes('AggregateOffer') ? offer.lowPrice : null));
  if (cents === null) return { reason: 'missing_or_invalid_price' };
  const currency = String(offer.priceCurrency ?? '').toUpperCase();
  const rawAvailability = String(offer.availability ?? '').split('/').pop().trim();
  const availability = ({ instock: 'InStock', outofstock: 'OutOfStock', soldout: 'SoldOut' })[
    rawAvailability.toLowerCase().replace(/[ _-]/g, '')] ?? rawAvailability;
  const expires = offer.priceValidUntil && Date.parse(offer.priceValidUntil.length === 10
    ? `${offer.priceValidUntil}T23:59:59.999Z` : offer.priceValidUntil);
  return { cents, currency, availability, url: offer.url,
    reason: currency !== 'USD' ? 'currency_not_usd' :
      offer.validForMemberTier || offer.eligibleCustomerType ? 'conditional_offer' :
      expires && expires < Date.now() ? 'expired_offer' :
      !['InStock', 'OutOfStock', 'SoldOut'].includes(availability) ?
        (availability ? 'unsupported_availability' : 'availability_unknown') : null };
}

export function extractPrice(html, pageUrl) {
  const extractor = createPriceExtractor(pageUrl);
  extractor.write(html);
  return extractor.finish();
}

export function createPriceExtractor(pageUrl) {
  const reader = createPageReader();
  return { write: reader.write, finish: () => extractPage(reader.finish(), pageUrl) };
}

function matchesOffer(offer, pageUrl) {
  if (!offer.url) return false;
  if (exactVariant(offer.url, pageUrl)) return true;
  // Gap-family short style/color pids omit the four size digits in each full offer SKU.
  try {
    const page = new URL(pageUrl), candidate = new URL(offer.url, page);
    const pid = page.searchParams.get('pid'), full = candidate.searchParams.get('pid');
    return /^(athleta|bananarepublic|oldnavy|www)\.gap\.com$/.test(page.hostname) &&
      page.pathname === '/browse/product.do' && sameProduct(candidate.href, pageUrl) &&
      /^\d{9,10}$/.test(pid ?? '') && /^\d+$/.test(full ?? '') && full.length === pid.length + 4 &&
      full.startsWith(pid) && String(offer.sku) === full && variantParams(page).every(key => key === 'pid') &&
      page.searchParams.getAll('pid').length === 1 && ['1', null].includes(page.searchParams.get('vid'));
  } catch { return false; }
}

function extractPage({ scripts, embeddedProducts, meta, canonical, inline, title, shell }, pageUrl) {
  const { products, resolve } = productsFrom(scripts);
  products.push(...retailerProducts(inline, pageUrl, canonical, sameProduct));
  const selectedVariant = variantParams(new URL(pageUrl)).length > 0;
  const offersOf = product => [product.offers].flat().map(resolve).filter(Boolean);
  // Some ProductGroup children omit Product.url but identify themselves through Offer.url.
  const exactOffers = products.filter(product => offersOf(product).some(offer => matchesOffer(offer, pageUrl)));
  const identified = products.filter(product => (product.url && sameProduct(product.url, pageUrl)) ||
    offersOf(product).some(offer => offer.url && sameProduct(offer.url, pageUrl)));
  const exactProducts = selectedVariant ? identified.filter(product => product.url && exactVariant(product.url, pageUrl)) : [];
  const primary = selectedVariant && exactOffers.length ? exactOffers : exactProducts.length ? exactProducts : identified.length ? identified :
    products.length === 1 && !products[0].url ? products : [];
  const values = [];
  for (const product of primary) {
    let offers = offersOf(product);
    const matches = offers.filter(offer => matchesOffer(offer, pageUrl));
    if (selectedVariant) {
      const productMatches = product.url && exactVariant(product.url, pageUrl);
      if (matches.length) offers = matches;
      else if (!productMatches || offers.some(offer => {
        try { return offer.url && variantParams(new URL(offer.url, pageUrl)).length > 0; } catch { return true; }
      })) { values.push({ reason: 'variant_not_verified' }); continue; }
    } else if (matches.length) offers = matches;
    values.push(...offers.map(offer => ({ ...offerValue(offer, resolve), product_name: product.name, source: product._source ?? 'json_ld',
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
  if (!values.length) return { verified: false, reason: /client challenge|access denied|just a moment|verify you are human/i.test(title)
    ? 'merchant_challenge' : shell ? 'requires_browser_rendering' : products.length ? 'product_or_offer_not_verified' : 'no_supported_product_data' };
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
    availability: new Set(priced.map(value => value.availability)).size > 1 ? 'Mixed' : first.availability ?? null,
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
