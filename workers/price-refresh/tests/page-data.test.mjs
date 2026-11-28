import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractPrice, createPriceExtractor } from '../src/extract.mjs';

const url = 'https://merchant.com/products/shirt';
const product = { '@type': 'Product', url, name: 'Shirt', offers: {
  '@type': 'Offer', url, price: '20.00', priceCurrency: 'USD', availability: 'InStock',
} };
const next = value => `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(value)}</script>`;
const metadata = (extra = '', identity = url) => `<meta property="og:type" content="product">
  <link rel="canonical" href="${identity}"><meta property="og:url" content="${identity}">
  <meta property="og:product:price:amount" content="20.00">
  <meta property="og:product:price:currency" content="USD">
  <meta property="og:availability" content="in stock">${extra}`;

test('primary Next product JSON supports the existing product/offer checks without executing code', () => {
  for (const props of [{ product }, { data: { product } }, { pageData: { product } }]) {
    const result = extractPrice(next({ props: { pageProps: props } }), url);
    assert.equal(result.verified, true);
    assert.equal(result.extracted_price, '$20.00');
    assert.equal(result.source, 'next_product_json');
  }
  assert.equal(extractPrice(next({ props: { pageProps: { recommendations: [product] } } }), url).verified, false);
  assert.equal(extractPrice(next({ props: { pageProps: { product: { ...product, url: `${url}-other` } } } }), url).verified, false);
  assert.equal(extractPrice(next({ props: { pageProps: { product } } }), url + '?size=M').verified, false);
  const expired = { ...product, offers: { ...product.offers, priceValidUntil: '2000-01-01' } };
  assert.equal(extractPrice(next({ props: { pageProps: { product: expired } } }), url).verified, false);
});

test('oversized or malformed hydration data cannot hide a valid JSON-LD offer', () => {
  const ld = `<script type="application/ld+json">${JSON.stringify(product)}</script>`;
  for (const state of ['{broken', JSON.stringify({ irrelevant: 'x'.repeat(2 * 1024 * 1024) })]) {
    assert.equal(extractPrice(`<script id="__NEXT_DATA__" type="application/json">${state}</script>${ld}`, url).verified, true);
  }
  const foreign = { ...product, offers: { ...product.offers, priceCurrency: 'CAD' } };
  assert.equal(extractPrice(next({ props: { pageProps: { product: foreign } } }), url).verified, false);
  const conflict = { ...product, offers: { ...product.offers, price: '1.00' } };
  assert.equal(extractPrice(ld + next({ props: { pageProps: { product: conflict } } }), url).reason, 'ambiguous_offers');
});

test('metadata aliases require matching identity and reject currency/price conflicts and sale windows', () => {
  assert.equal(extractPrice(metadata(), url).verified, true);
  for (const html of [metadata('<meta property="product:price:amount" content="1.00">'),
    metadata('<meta property="product:price:currency" content="CAD">'),
    metadata('<meta property="product:sale_price:amount" content="10.00">'),
    metadata('<meta property="og:availability" content="out of stock">'),
    metadata('', url + '-other'), metadata().replace('content="USD"', 'content="CAD"'),
  ]) assert.equal(extractPrice(html, url).verified, false);
  assert.equal(extractPrice(metadata(), url + '?size=M').verified, false);
});

test('complete matching metadata can supply missing stock but cannot override rejected structured offers', () => {
  const ld = offers => `<script type="application/ld+json">${JSON.stringify({ ...product, offers })}</script>`;
  const unknown = { ...product.offers, availability: undefined };
  const result = extractPrice(ld(unknown) + metadata(), url);
  assert.equal(result.verified, true);
  assert.equal(result.source, 'json_ld+product_meta');
  for (const offers of [{ ...unknown, price: '5.00' }, { ...unknown, priceCurrency: 'EUR' },
    { ...unknown, priceValidUntil: '2000-01-01' }, { ...unknown, validForMemberTier: 'members' },
  ]) assert.equal(extractPrice(ld(offers) + metadata(), url).verified, false);
});

test('named Shopify product JSON scripts prove variants and uniform parent prices without reading recommendations', () => {
  const value = { id: 123, handle: 'shirt', title: 'Shirt', price_min: 1200, price_max: 1200,
    variants: [{ id: 39405164298343, price: 1200, available: true }, { id: 39405164298344, price: 1200, available: false }] };
  const page = (data = value, id = 'ProductJson-template--123__main') =>
    `<meta property="product:price:currency" content="USD"><script id="${id}" type="application/json">${JSON.stringify(data)}</script>`;
  for (const id of ['ProductJson-template--123__main', 'product-json', 'cc-product-json-123']) {
    const extractor = createPriceExtractor(url + '?variant=39405164298343');
    const html = page(value, id);
    for (let start = 0; start < html.length; start += 7) extractor.write(html.slice(start, start + 7));
    assert.equal(extractor.finish().extracted_price, '$12.00');
  }
  assert.equal(extractPrice(page(), url).availability, 'Mixed');
  for (const data of [{ ...value, handle: 'other' }, { ...value, price_max: 1400 },
    { ...value, variants: [...value.variants, { id: 4, price: 1200 }] },
    { ...value, variants: [...value.variants, { id: 4, price: 1200, available: true, requires_selling_plan: true }] },
  ]) assert.equal(extractPrice(page(data), url).verified, false);
  assert.equal(extractPrice(page(value, 'recommendations'), url).verified, false);
  assert.equal(extractPrice(page().replace('content="USD"', 'content="CAD"'), url).verified, false);
  assert.equal(extractPrice(page(), url + '?size=M').verified, false);
});
