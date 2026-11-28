import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractPrice, priceCents } from '../src/extract.mjs';

const url = 'https://shop.retailer.com/products/shirt';
const offer = (extra = {}) => ({ '@type': 'Offer', price: '24.99', priceCurrency: 'USD',
  availability: 'https://schema.org/InStock', ...extra });
const product = (extra = {}) => ({ '@type': 'Product', name: 'Linen shirt', url, offers: offer(), ...extra });
const html = data => `<html><head><script type="application/ld+json">${JSON.stringify(data)}</script></head>
  <body><del>$99.00</del><span>$24.99</span><p>4 installments of $6.25</p></body></html>`;

test('extracts a product offer instead of original, installment, or arbitrary dollar text', () => {
  const result = extractPrice(html(product()), url);
  assert.equal(result.verified, true);
  assert.equal(result.extracted_price, '$24.99');
  assert.equal(result.source, 'json_ld');
  assert.equal(extractPrice('<p>$1.00</p>', url).verified, false);
});

test('supports graph references, type arrays, multiple scripts, and HTML attribute quoting', () => {
  const data = { '@graph': [product({ '@type': ['Thing', 'Product'], offers: { '@id': '#offer' } }),
    { '@id': '#offer', ...offer() }] };
  const result = extractPrice('<script type="application/ld+json">invalid</script>' + html(data), url);
  assert.equal(result.verified, true);
  assert.equal(result.extracted_price, '$24.99');
});

test('ignores recommended ItemList products and uses the product at the saved URL', () => {
  const data = [product(), { '@type': 'ItemList', itemListElement: [product({ offers: offer({ price: '1' }) })] },
    product({ url: 'https://shop.retailer.com/products/other', offers: offer({ price: '2' }) })];
  assert.equal(extractPrice(html(data), url).extracted_price, '$24.99');
  const onlyRelated = { '@type': 'ItemList', itemListElement: [product()] };
  assert.equal(extractPrice(html(onlyRelated), url).verified, false);
});

test('accepts a single primary product without a URL, but rejects unrelated identified products', () => {
  assert.equal(extractPrice(html(product({ url: undefined })), url).verified, true);
  assert.equal(extractPrice(html(product({ url: 'https://shop.retailer.com/products/other' })), url).verified, false);
});

test('selects the URL variant and never falls back to a cheaper unselected variant', () => {
  const data = product({ offers: [offer({ url: `${url}?variant=red`, price: '19.99' }),
    offer({ url: `${url}?variant=blue`, price: '29.99' })] });
  assert.equal(extractPrice(html(data), `${url}?variant=blue&utm_source=app`).extracted_price, '$29.99');
  assert.equal(extractPrice(html(data), `${url}?variant=blue&utm_source=app`).verified, true);
  assert.equal(extractPrice(html(data), `${url}?variant=unknown`).reason, 'variant_not_verified');
  assert.equal(extractPrice(html(product()), `${url}?variant=blue`).verified, false);
});

test('supports ProductGroup variants and rejects differing offers without a selected variant', () => {
  const group = { '@type': 'ProductGroup', hasVariant: [product({ url: `${url}?variant=red`,
    offers: offer({ price: '19.99' }) }), product({ url: `${url}?variant=blue`, offers: offer({ price: '29.99' }) })] };
  // A specific product's URL must select it, rather than reading every variant's offers.
  assert.equal(extractPrice(html(group), url).reason, 'ambiguous_offers');
  const selected = extractPrice(html(group), `${url}?variant=blue`);
  assert.equal(selected.verified, true);
  assert.equal(selected.extracted_price, '$29.99');
});

test('currency, availability, zero, ranges, and conditional prices require review', () => {
  for (const [extra, reason] of [
    [{ priceCurrency: 'CAD' }, 'currency_not_usd'],
    [{ priceCurrency: undefined }, 'currency_not_usd'],
    [{ availability: undefined }, 'availability_unknown'],
    [{ priceValidUntil: '2000-01-01' }, 'expired_offer'],
    [{ eligibleCustomerType: 'members' }, 'conditional_offer'],
    [{ price: '0' }, 'missing_or_invalid_price'],
    [{ price: undefined, priceSpecification: { price: '10', priceCurrency: 'USD' } }, 'missing_or_invalid_price'],
    [{ '@type': 'AggregateOffer', price: undefined, lowPrice: '10', highPrice: '30' }, 'price_range'],
  ]) {
    const result = extractPrice(html(product({ offers: offer(extra) })), url);
    assert.equal(result.verified, false);
    assert.equal(result.reason, reason);
  }
});

test('consistent duplicate offers are accepted, conflicting prices or currencies are not', () => {
  assert.equal(extractPrice(html(product({ offers: [offer(), offer()] })), url).verified, true);
  assert.equal(extractPrice(html(product({ offers: [offer(), offer({ price: '5' })] })), url).reason, 'ambiguous_offers');
  assert.equal(extractPrice(html(product({ offers: [offer(), offer({ priceCurrency: 'CAD' })] })), url).verified, false);
});

test('scoped product metadata is supported; generic metadata and unverified variants are not', () => {
  const page = `<meta property='og:type' content='product'>
    <meta property='og:url' content='${url}'>
    <meta property='product:price:amount' content='35.20'>
    <meta property='product:price:currency' content='USD'>
    <meta property='product:availability' content='in stock'>`;
  assert.equal(extractPrice(page, url).extracted_price, '$35.20');
  assert.equal(extractPrice(page, url).verified, true);
  assert.equal(extractPrice(page.replace("content='product'", "content='website'"), url).verified, false);
  assert.equal(extractPrice(page, `${url}?variant=blue`).verified, false);
  const soldOut = extractPrice(page.replace("content='in stock'", "content='out of stock'"), url);
  assert.equal(soldOut.verified, true);
  assert.equal(soldOut.availability, 'OutOfStock');
});

test('price parsing is bounded decimal cents and rejects ambiguous or malformed values', () => {
  assert.equal(priceCents('19.90'), 1990);
  assert.equal(priceCents(0.01), 1);
  for (const value of [null, '', '0', '-2', '1e3', '$20', '1,000', '20-30', '19.999', '100000000', NaN]) {
    assert.equal(priceCents(value), null, String(value));
  }
});

test('selects offer-only ProductGroup children without letting sibling variants block the exact match', () => {
  const group = { '@type': 'ProductGroup', hasVariant: [
    product({ url: undefined, offers: offer({ url: `${url}?variant=red`, price: '10' }) }),
    product({ url: undefined, offers: offer({ url: `${url}?variant=blue`, price: '30' }) }),
  ] };
  const result = extractPrice(html(group), `${url}?variant=blue`);
  assert.equal(result.verified, true);
  assert.equal(result.extracted_price, '$30.00');
  assert.equal(extractPrice(html(group), `${url}?variant=missing`).verified, false);
});

test('an exact standalone offer wins over generic sibling entries on the same product page', () => {
  const data = { '@graph': [product({ offers: offer({ price: '1', availability: 'OutOfStock' }) }),
    product({ url: undefined, offers: offer({ price: '24.49', url: `${url}?variant=selected` }) })] };
  const result = extractPrice(html(data), `${url}?variant=selected`);
  assert.equal(result.verified, true);
  assert.equal(result.extracted_price, '$24.49');
});

test('a selected Product URL cannot override explicit offers for a different variant', () => {
  const data = product({ url: `${url}?variant=blue`, offers: offer({ url: `${url}?variant=red`, price: '1' }) });
  assert.equal(extractPrice(html(data), `${url}?variant=blue`).verified, false);
});

const embeddedPage = ({ handle = 'shirt', currency = 'USD', available = true, price = 2999,
  selectedId = 12345, marker = 'data-product-json', extra = {}, offerExtra = {} } = {}) =>
  html(product({ offers: offer({ price: '24.99', priceCurrency: currency, ...offerExtra }) })) +
  `<script type="application/json" ${marker}>${JSON.stringify({ product: {
    handle, title: 'Selected shirt', price_min: 1000, price_max: 5000,
    variants: [{ id: 54321, price: 1000, available: true }, { id: selectedId, price, available }], ...extra,
  }, selected_variant_id: selectedId })}</script>`;

test('reads the exact marked embedded Shopify variant using cents and per-variant stock', () => {
  const result = extractPrice(embeddedPage(), `${url}?variant=12345`);
  assert.equal(result.verified, true);
  assert.equal(result.extracted_price, '$29.99');
  assert.equal(result.source, 'embedded_product_json');
  const outOfStock = extractPrice(embeddedPage({ available: false }), `${url}?variant=12345`);
  assert.equal(outOfStock.verified, true);
  assert.equal(outOfStock.availability, 'OutOfStock');
});

test('embedded variants require product identity, known USD, explicit stock, and a trusted product-data marker', () => {
  for (const options of [{ handle: 'other' }, { currency: 'CAD' }, { currency: '' },
    { available: null }, { price: 0 }, { price: 29.99 }, { selectedId: 9 }, { marker: 'data-recommended-product' }]) {
    assert.equal(extractPrice(embeddedPage(options), `${url}?variant=12345`).verified, false, JSON.stringify(options));
  }
  assert.equal(extractPrice(embeddedPage(), `${url}?variant=12345&size=L`).verified, false);
  assert.equal(extractPrice(embeddedPage(), `${url}?variant=12345&variant=54321`).verified, false);
});

test('embedded variant fallback cannot bypass an expired or member-only offer or a required subscription', () => {
  for (const options of [{ offerExtra: { priceValidUntil: '2000-01-01' } },
    { offerExtra: { validForMemberTier: 'gold' } }, { extra: { requires_selling_plan: true } }]) {
    assert.equal(extractPrice(embeddedPage(options), `${url}?variant=12345`).verified, false);
  }
});

test('percent-escape spelling and Unicode handles do not prevent exact product identity', () => {
  const unicodeUrl = 'https://shop.retailer.com/products/generation%E2%84%A2-pants';
  const lowerUrl = unicodeUrl.replaceAll('%E2%84%A2', '%e2%84%a2');
  const data = product({ url: lowerUrl, offers: offer({ url: `${lowerUrl}?variant=123` }) });
  assert.equal(extractPrice(html(data), `${unicodeUrl}?variant=123`).verified, true);
});

test('includes out-of-stock and sold-out prices with their availability intact', () => {
  for (const availability of ['OutOfStock', 'SoldOut']) {
    const result = extractPrice(html(product({ offers: offer({ availability }) })), url);
    assert.equal(result.verified, true);
    assert.equal(result.extracted_price, '$24.99');
    assert.equal(result.availability, availability);
  }
  assert.equal(extractPrice(html(product({ offers: offer({ availability: undefined }) })), url).verified, false);
});

test('matches canonical Shopify aliases by exact long variant ID without accepting a different offer or retailer', () => {
  const actual = `${url}-canonical?variant=39297397260412`;
  const data = { '@type': 'ProductGroup', hasVariant: [product({ url: undefined, offers: offer({ url: actual }) })] };
  assert.equal(extractPrice(html(data), `${url}?variant=39297397260412`).verified, true);
  assert.equal(extractPrice(html(data), `${url}?variant=39297397260413`).verified, false);
  assert.equal(extractPrice(html(data), 'https://other.retailer.com/products/shirt?variant=39297397260412').verified, false);
  assert.equal(extractPrice(html(product({ offers: offer({ url: `${url}-canonical?variant=blue` }) })), `${url}?variant=blue`).verified, false);
});

test('normalizes only malformed leading-zero GTIN identifiers, retaining exact variant and price checks', () => {
  const raw = html(product({ gtin12: '023794104068', offers: offer({ url: `${url}?variant=12345678` }) }))
    .replace('"gtin12":"023794104068"', '"gtin12":023794104068');
  assert.equal(extractPrice(raw, `${url}?variant=12345678`).verified, true);
  assert.equal(extractPrice(raw.replace('"price":"24.99"', '"price":024.99'), `${url}?variant=12345678`).verified, false);
});

test('accepts an explicit aggregate price but never collapses a conflicting range', () => {
  assert.equal(extractPrice(html(product({ offers: offer({ '@type': 'AggregateOffer', lowPrice: '24.99' }) })), url).verified, true);
  assert.equal(extractPrice(html(product({ offers: offer({ '@type': 'AggregateOffer', lowPrice: '10' }) })), url).reason, 'price_range');
  assert.equal(extractPrice(html(product({ offers: offer({ '@type': 'AggregateOffer', lowPrice: '24.99', highPrice: '40' }) })), url).verified, false);
});

test('matches Gap style/color pids to full size SKUs only within the exact selected style/color', () => {
  const page = 'https://athleta.gap.com/browse/product.do?pid=1174194022&vid=1';
  const gapOffer = (pid, extra = {}) => offer({ url: `https://athleta.gap.com/browse/product.do?pid=${pid}`, sku: pid, ...extra });
  const data = product({ url: undefined, offers: [gapOffer('11741940222018'), gapOffer('11741940222020')] });
  assert.equal(extractPrice(html(data), page).verified, true);
  assert.equal(extractPrice(html(data), page.replace('1174194022', '1174194072')).verified, false);
  assert.equal(extractPrice(html(data), page.replace('vid=1', 'vid=2')).verified, false);
  assert.equal(extractPrice(html(data), page + '&size=XL').verified, false);
  const ranged = product({ url: undefined, offers: [gapOffer('11741940222018'), gapOffer('11741940222020', { price: '30' })] });
  assert.equal(extractPrice(html(ranged), page).reason, 'ambiguous_offers');
  const factoryPage=page.replace('athleta.gap.com','bananarepublicfactory.gapfactory.com');
  assert.equal(extractPrice(html(data).replaceAll('athleta.gap.com','bananarepublicfactory.gapfactory.com'),factoryPage).verified,true);
  assert.equal(extractPrice(html(data).replaceAll('athleta.gap.com','bananarepublicfactory.gapfactory.com'),factoryPage.replace('vid=1','vid=3')).verified,false);
});

test('Midway advertising and canonical product hosts share an identity only for matching product and pid', () => {
  const page = 'https://ads.midwayusa.com/product/1019190989?pid=872434';
  const data = product({ url: undefined, offers: offer({ url: 'https://www.midwayusa.com/product/1019190989?pid=872434' }) });
  assert.equal(extractPrice(html(data), page).verified, true);
  assert.equal(extractPrice(html(data), page.replace('872434', '872435')).verified, false);
  assert.equal(extractPrice(html(data), page.replace('ads.midwayusa.com', 'unrelated.midwayusa.com')).verified, false);
});

test('reports challenge pages and client-rendered price shells as distinct failures', () => {
  assert.equal(extractPrice('<title>Client Challenge</title><script>/* no product */</script>', url).reason, 'merchant_challenge');
  assert.equal(extractPrice('<title>Store</title><div class="skel__price"></div>', url).reason, 'requires_browser_rendering');
});
