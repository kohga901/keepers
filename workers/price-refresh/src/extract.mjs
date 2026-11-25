import { Parser } from 'htmlparser2';
import { inlineProductData, retailerProducts } from './retailer-data.mjs';
import { createMicrodataReader } from './microdata.mjs';

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
export function fragmentSelection(url) {
  const text = url.hash.slice(1), sku = text.match(/^skuId\/(\d+)(?:[?&]|$)/i)?.[1];
  if (sku) return { signature: `sku:${sku}`, sku };
  if (/^\d+=\d+(?:&\d+=\d+)*$/.test(text) || /^(variant|sku|size|color)=/i.test(text)) {
    const entries = [...new URLSearchParams(text)];
    return { signature: entries.sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>`${key}=${value}`).join('&'), ambiguous: new Set(entries.map(([key])=>key)).size !== entries.length };
  }
  return null;
}
export const variantParams = url => [...url.searchParams.keys()].filter(key =>
  /^(variant(?:[-_]?id)?|var|objectId|sku[-_]?id|selectedSKUId|sku|skuCode|skid|pid|id|itemId|productId|genericId|choice|style_id|colou?r[-_]?(?:id|code|name)|colou?r|size\d?|sz|neck|sleeve|shirt-fit|seq|colorDisplayCode|sizeDisplayCode|selectedSellerId|selectedOfferId|conditionGroupCode|option_values|attributes)$|^(dwvar_|attrValue_)/i.test(key) ||
  (/^(?:www\.)?zara\.com$/.test(url.hostname) && /^(v1|v2)$/.test(key)) ||
  (/^(?:www\.)?lyst\.com$/.test(url.hostname) && /^(product|link_id|_country)$/.test(key)) ||
  (/^(?:www\.|factory\.)?(?:jcrew|madewell)\.com$/.test(url.hostname) && /^(N|fit|ccode)$/.test(key)))
  .concat(/(^|\.)(?:gap|gapfactory)\.com$/.test(url.hostname) && url.searchParams.has('vid') ? ['vid'] : [])
  .concat(fragmentSelection(url) ? ['__fragment__'] : []);
const path = url => decodeURI(url.pathname).normalize('NFC').replace(/\/+$/, '') || '/';

const merchantHost = url => ({ 'ads.midwayusa.com': 'midwayusa.com', 'checkout.clothingshoponline.com': 'clothingshoponline.com' })[url.hostname] ?? url.hostname.replace(/^www\./, '');
export const sameMerchant = (a, b) => merchantHost(a) === merchantHost(b);

export function sameProduct(left, right) {
  try {
    const a = new URL(left, right), b = new URL(right);
    if (!sameMerchant(a, b)) return false;
    if (path(a) === path(b)) return true;
    const host = merchantHost(a);
    if (host === 'ae.com') {
      const identity = url => url.pathname.match(/^\/([a-z]{2})\/([a-z]{2})\/p\/.*\/(\d{4}_\d{4}_\d{3})\/?$/i)?.slice(1).map(value => value.toLowerCase()).join('/');
      return !!identity(a) && identity(a) === identity(b);
    }
    if (host === 'brooksbrothers.com') {
      const sku = url => url.pathname.match(/\/([A-Z]{2}\d{5}_[A-Z0-9_]+)\.html$/i)?.[1];
      return !!sku(a) && sku(a) === sku(b);
    }
    if (['jcrew.com', 'factory.jcrew.com', 'madewell.com'].includes(host)) {
      const style = url => url.pathname.match(/\/([A-Z]{1,3}\d{3,5})\/?$/i)?.[1];
      return !!style(a) && style(a) === style(b);
    }
    // Express changes descriptive slugs and appends selections; the /pro/ ID is stable.
    if (merchantHost(a) !== 'express.com') return false;
    const productId = url => url.pathname.match(/\/pro\/(\d{8})(?:\/|$)/)?.[1];
    if (!productId(a) || productId(a) !== productId(b)) return false;
    for (const key of ['color', 'size', 'e']) {
      const selection = url => path(url).match(new RegExp(`/${key}/([^/]+)(?:/|$)`))?.[1];
      if (selection(a) && selection(b) && selection(a) !== selection(b)) return false;
    }
    return true;
  } catch { return false; }
}

function exactVariant(candidate, pageUrl) {
  try {
    const page = new URL(pageUrl), other = new URL(candidate, page);
    if (fragmentSelection(page)?.ambiguous || (fragmentSelection(page) && fragmentSelection(other)?.signature !== fragmentSelection(page).signature)) return false;
    if (merchantHost(page) === 'express.com') for (const key of ['color', 'size', 'e']) {
      const selected = path(page).match(new RegExp(`/${key}/([^/]+)(?:/|$)`))?.[1];
      if (selected && path(other).match(new RegExp(`/${key}/([^/]+)(?:/|$)`))?.[1] !== selected) return false;
    }
    // Long Shopify variant IDs identify the offer even when the page's canonical slug differs.
    const id = page.searchParams.get('variant');
    const variantAlias = /^\d{8,20}$/.test(id ?? '') && other.searchParams.get('variant') === id &&
      /\/products\/[^/]+\/?$/.test(page.pathname) && /\/products\/[^/]+\/?$/.test(other.pathname) && sameMerchant(page, other);
    return (sameProduct(other.href, page.href) || variantAlias) && variantParams(page).filter(key => key !== '__fragment__').every(key =>
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

function createPageReader(pageUrl) {
  const scripts = [], embeddedProducts = [], meta = new Map();
  const inline = { shopifyViews: [], asosStock: [], walmartProducts: [] };
  const microdata = createMicrodataReader();
  let script = null, canonical = null;
  let scriptKind = null, retained = 0, title = '', inTitle = false, shell = false, challenge = false, hidden = 0, visibleText = '';
  const parser = new Parser({
    onopentag(name, attributes) {
      microdata.open(name, attributes);
      if (['script','style','noscript'].includes(name)) hidden++;
      if (name === 'script') {
        const type = attributes.type?.toLowerCase().split(';')[0].trim();
        scriptKind = type === 'application/json' && attributes.id === '__NEXT_DATA__' && /^(www\.)?walmart\.com$/.test(new URL(pageUrl).hostname) ? 'next_data' : type === 'application/ld+json' ? 'json_ld' : type === 'application/json' &&
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
      microdata.text(text);
      if (!hidden && visibleText.length < 5000) visibleText += ' ' + text.slice(0, 5000 - visibleText.length);
      if (inTitle && title.length < 500) title += text.slice(0, 500 - title.length);
      if (script === null) return;
      if (scriptKind === 'inline' && /istlWasHere|_Incapsula_Resource|window\[['"]_px/.test(text)) challenge = true;
      if (script.length + text.length > 2 * 1024 * 1024) {
        if (scriptKind === 'inline') { script = null; scriptKind = null; return; }
        throw new Error('product_data_too_large');
      }
      script += text;
    },
    onclosetag(name) {
      microdata.close(name);
      if (['script','style','noscript'].includes(name)) hidden = Math.max(0, hidden - 1);
      if (name === 'title') inTitle = false;
      if (name === 'script' && script !== null) {
        try {
          if (scriptKind === 'inline') {
            const data = inlineProductData(script);
            if (data.shopifyViews.length || data.asosStock.length) {
              retained += script.length;
              inline.shopifyViews.push(...data.shopifyViews); inline.asosStock.push(...data.asosStock);
            }
          } else if (scriptKind === 'next_data') {
            const product = JSON.parse(script)?.props?.pageProps?.initialData?.data?.product;
            if (product) { retained += script.length; inline.walmartProducts.push(product); }
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
    parser.end(); return { scripts, embeddedProducts, meta, canonical, inline, title, shell, challenge, visibleText, microdata: microdata.finish() };
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
  function visit(node, group = null) {
    if (Array.isArray(node)) return node.forEach(value => visit(value, group));
    if (!node || typeof node !== 'object') return;
    if (types(node).includes('Product')) products.push(group ? { ...node, _group: group } : node);
    if (types(node).includes('ProductGroup') && node.offers) products.push(node);
    // Do not mistake products nested in a recommended-items ItemList for the page's product.
    for (const key of ['@graph', 'mainEntity', 'hasVariant']) if (node[key]) visit(node[key], key === 'hasVariant' && types(node).includes('ProductGroup') ? node : null);
  }
  scripts.forEach(index);
  scripts.forEach(node => visit(node));
  return { products, resolve: node => references.get(node?.['@id']) ?? node };
}

function offerDate(value, endOfDay = false) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T.*(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) return NaN;
  const day = value.slice(0,10), midnight = Date.parse(day + 'T00:00:00.000Z');
  if (!Number.isFinite(midnight) || new Date(midnight).toISOString().slice(0,10) !== day) return NaN;
  return Date.parse(endOfDay && value.length === 10 ? value + 'T23:59:59.999Z' : value);
}

function offerValue(offer, resolve) {
  offer = resolve(offer);
  if (!offer || typeof offer !== 'object') return null;
  if (offer.price == null && offer.priceSpecification) {
    const specifications = [offer.priceSpecification].flat().map(resolve).filter(specification => specification && typeof specification === 'object');
    const current = specifications.filter(specification => (!specification.priceType || String(specification.priceType).split('/').pop() === 'SalePrice') && !specification.validForMemberTier && !specification.eligibleCustomerType &&
      !['referenceQuantity', 'eligibleQuantity', 'billingDuration', 'billingIncrement', 'billingStart', 'unitCode', 'unitText'].some(key => specification[key] != null) &&
      types(specification).some(type => ['UnitPriceSpecification', 'PriceSpecification'].includes(type)));
    const values = new Set(current.map(specification => `${String(specification.priceCurrency ?? '').toUpperCase()}:${priceCents(specification.price)}`));
    if (values.size > 1) return { reason: 'ambiguous_offers' };
    if (current.length) {
      const specification = current[0], starts = specification.validFrom && offerDate(specification.validFrom), ends = specification.validThrough && offerDate(specification.validThrough, true);
      if ((specification.validFrom && !Number.isFinite(starts)) || (specification.validThrough && !Number.isFinite(ends))) return { reason: 'invalid_offer_dates' };
      if (starts && starts > Date.now()) return { reason: 'offer_not_started' };
      if (ends && ends < Date.now()) return { reason: 'expired_offer' };
      if (offer.priceCurrency && String(offer.priceCurrency).toUpperCase() !== String(specification.priceCurrency).toUpperCase()) return { reason: 'currency_not_usd' };
      offer = { ...offer, price: specification.price, priceCurrency: specification.priceCurrency };
    }
  }
  if (types(offer).includes('AggregateOffer')) {
    const low = priceCents(offer.lowPrice), high = priceCents(offer.highPrice), explicit = priceCents(offer.price);
    if ((low !== null && high !== null && low !== high) ||
        (explicit !== null && ((low !== null && low !== explicit) || (high !== null && high !== explicit))) ||
        (explicit === null && (low === null || high === null))) {
      return { reason: 'price_range' };
    }
  }
  // Member, measured-unit and installment specifications never become the active item price.
  const cents = priceCents(offer.price ?? (types(offer).includes('AggregateOffer') ? offer.lowPrice : null));
  if (cents === null) return { reason: 'missing_or_invalid_price' };
  const currency = String(offer.priceCurrency ?? '').toUpperCase();
  const rawAvailability = String(offer.availability ?? '').split('/').pop().trim();
  const availability = ({ instock: 'InStock', outofstock: 'OutOfStock', soldout: 'SoldOut' })[
    rawAvailability.toLowerCase().replace(/[ _-]/g, '')] ?? rawAvailability;
  const starts = offer.validFrom && offerDate(offer.validFrom);
  const expires = [offer.priceValidUntil, offer.validThrough].filter(Boolean).map(value => offerDate(value, true));
  return { cents, currency, availability, url: offer.url,
    reason: currency !== 'USD' ? 'currency_not_usd' :
      offer.validForMemberTier || offer.eligibleCustomerType ? 'conditional_offer' :
      ((offer.validFrom && !Number.isFinite(starts)) || expires.some(value => !Number.isFinite(value))) ? 'invalid_offer_dates' :
      starts && starts > Date.now() ? 'offer_not_started' :
      expires.some(value => value < Date.now()) ? 'expired_offer' :
      !['InStock', 'OutOfStock', 'SoldOut', 'OnlineOnly', 'InStoreOnly', 'LimitedAvailability', 'PreOrder', 'PreSale', 'BackOrder', 'Discontinued', 'Reserved'].includes(availability) ?
        (availability ? 'unsupported_availability' : 'availability_unknown') : null };
}

export function extractPrice(html, pageUrl) {
  const extractor = createPriceExtractor(pageUrl);
  extractor.write(html);
  return extractor.finish();
}

export function createPriceExtractor(pageUrl) {
  const reader = createPageReader(pageUrl);
  return { write: reader.write, finish: () => extractPage(reader.finish(), pageUrl) };
}

function matchesOffer(offer, pageUrl) {
  if (!offer.url) return false;
  if (exactVariant(offer.url, pageUrl)) return true;
  // Gap-family short style/color pids omit the four size digits in each full offer SKU.
  try {
    const page = new URL(pageUrl), candidate = new URL(offer.url, page);
    const product = offer._product, selectors = variantParams(page);
    const normalize = value => String(value ?? '').toLowerCase().replace(/[-_\s]+/g, ' ').trim();
    const groupMatches = product?._group?.url && sameProduct(product._group.url, pageUrl);
    // Buckle appends descriptive color/fit labels to a route containing the exact immutable SKU.
    const buckleSku=page.hostname==='www.buckle.com'&&page.pathname.match(/\/sku-(\d+)$/)?.[1];
    if(buckleSku&&sameProduct(candidate.href,pageUrl)&&String(product?.sku)===buckleSku&&selectors.length&&selectors.every(key=>{
      if(!['color','size'].includes(key)||page.searchParams.getAll(key).length!==1)return false;
      const expected=normalize(page.searchParams.get(key)),actual=normalize(product[key]);
      return !!actual&&(expected===actual||expected.split('/')[0].trim()===actual);
    }))return true;
    // Explicit Schema.org child attributes can prove a selection omitted from Offer.url.
    if (product && sameMerchant(page, candidate) && (sameProduct(candidate.href, pageUrl) || groupMatches) && selectors.length &&
        selectors.every(key => {
          if (key === '__fragment__') return fragmentSelection(page)?.sku && String(product.sku ?? '') === fragmentSelection(page).sku;
          if (page.searchParams.getAll(key).length !== 1) return false;
          if (candidate.searchParams.has(key)) return candidate.searchParams.getAll(key).length === 1 && candidate.searchParams.get(key) === page.searchParams.get(key);
          const expected = page.searchParams.get(key);
          if (/^(color|colour|color_name)$/i.test(key)) return normalize(product.color) === normalize(expected);
          if (/^(size|sz)$/i.test(key) || (key === 'N' && /(?:jcrew|madewell)\.com$/.test(page.hostname))) return normalize(product.size) === normalize(expected);
          if (/^(sku|sku[-_]?id|selectedSKUId)$/i.test(key)) return String(product.sku ?? '') === expected;
          return false;
        })) return true;
    // Vuori's offer objectId is the Shopify variant ID, not a different variant selector.
    if (page.hostname.replace(/^www\./, '') === 'vuoriclothing.com' && sameProduct(candidate.href, pageUrl) &&
        /^\d{8,20}$/.test(page.searchParams.get('variant') ?? '') && variantParams(page).every(key => key === 'variant') &&
        page.searchParams.getAll('variant').length === 1 && candidate.searchParams.getAll('objectId').length === 1 &&
        candidate.searchParams.get('objectId') === page.searchParams.get('variant')) return true;
    // Talbots identifies the parent style separately from each child-SKU URL.
    if (page.hostname.replace(/^www\./, '') === 'talbots.com' && sameMerchant(page, candidate) &&
        offer._group?.url && sameProduct(offer._group.url, pageUrl) &&
        page.pathname.endsWith(`/${offer._group.productGroupID}.html`) && /^\d+$/.test(String(offer.sku ?? '')) &&
        candidate.pathname.endsWith(`/${offer.sku}.html`) && variantParams(page).length) {
      const prefix = `dwvar_${offer._group.productGroupID}_`;
      if (variantParams(page).every(key => key.startsWith(prefix) && ['color', 'size', 'sizeType'].includes(key.slice(prefix.length)) &&
          page.searchParams.getAll(key).length === 1 && candidate.searchParams.getAll(`dwvar_${offer.sku}_${key.slice(prefix.length)}`).length === 1 &&
          page.searchParams.get(key) === candidate.searchParams.get(`dwvar_${offer.sku}_${key.slice(prefix.length)}`))) return true;
    }
    const pid = page.searchParams.get('pid'), full = candidate.searchParams.get('pid');
    return /^(?:(?:athleta|bananarepublic|oldnavy|www)\.gap\.com|(?:bananarepublicfactory|www)\.gapfactory\.com)$/.test(page.hostname) &&
      page.pathname === '/browse/product.do' && sameProduct(candidate.href, pageUrl) &&
      /^\d{9,10}$/.test(pid ?? '') && /^\d+$/.test(full ?? '') && full.length === pid.length + 4 &&
      full.startsWith(pid) && String(offer.sku) === full && variantParams(page).every(key => key === 'pid' ||
        (key === 'vid' && page.searchParams.getAll('vid').length === 1 && page.searchParams.get('vid') === '1')) &&
      page.searchParams.getAll('pid').length === 1 && ['1', null].includes(page.searchParams.get('vid'));
  } catch { return false; }
}

function extractPage({ scripts, embeddedProducts, meta, canonical, inline, title, shell, challenge, visibleText, microdata }, pageUrl) {
  const { products, resolve } = productsFrom(scripts);
  if (!products.length) for (const product of microdata) {
    if (!product.url && microdata.length === 1 && canonical && sameProduct(canonical, pageUrl)) product.url = canonical;
    products.push(product);
  }
  products.push(...retailerProducts(inline, pageUrl, canonical, sameProduct, variantParams));
  const selectedVariant = variantParams(new URL(pageUrl)).length > 0 ||
    (new URL(pageUrl).hostname.replace(/^www\./, '') === 'express.com' && /\/(color|size|e)\//.test(new URL(pageUrl).pathname));
  const offersOf = product => [product.offers].flat().map(resolve).filter(Boolean).map(offer => ({ ...offer, _product: product,
    ...(product._group ? { sku: offer.sku ?? product.sku, _group: product._group } : {}) }));
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
    values.push(...offers.map(offer => ({ ...offerValue(offer, resolve), product_name: product.name,
      source: product._source ?? (offer.price == null && offer.priceSpecification ? 'json_ld_price_specification' : 'json_ld'),
      identity: { sku: product.sku ?? offer.sku, gtin: product.gtin14 ?? product.gtin13 ?? product.gtin12 ?? product.gtin8 ?? product.gtin,
        product_id: product.productID, parent_product_id: product._group?.productGroupID, color: product.color, size: product.size },
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
  if (!values.length) return { verified: false, reason: challenge || /client challenge|access denied|just a moment|verify you are human|robot or human/i.test(title) ||
      /verify (?:that )?you are (?:a )?human|press (?:and|&) hold|unusual traffic|access to this page has been denied/i.test(visibleText)
    ? 'merchant_challenge' : /system maintenance is in progress|temporarily down for maintenance/i.test(visibleText) ? 'merchant_maintenance' :
      shell ? 'requires_browser_rendering' : products.length ? 'product_or_offer_not_verified' : 'no_supported_product_data' };
  const priced = values.filter(value => value.cents != null);
  const unique = new Set(priced.map(value => `${value.currency}:${value.cents}`));
  if (unique.size > 1) return { verified: false, reason: 'ambiguous_offers' };
  const first = priced[0] ?? values[0];
  const reason = values.find(value => value.reason)?.reason ??
    (priced.length !== values.length ? 'missing_or_invalid_price' : null);
  return {
    verified: !reason && priced.length === values.length,
    reason: reason ?? null,
    extracted_price: first.cents == null ? null : first.currency === 'USD' ? formatPrice(first.cents) : `${first.currency || 'UNKNOWN'} ${(first.cents / 100).toFixed(2)}`,
    currency: first.currency ?? null,
    availability: new Set(priced.map(value => value.availability)).size > 1 ? 'Mixed' : first.availability ?? null,
    source: first.source,
    product_name: first.product_name ?? null,
    ...(first.identity ? { identity: Object.fromEntries(Object.entries(first.identity).filter(([key, value]) => value != null && value !== '' && priced.every(row => row.identity?.[key] === value))) } : {}),
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
