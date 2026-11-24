import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractPrice } from '../src/extract.mjs';
import { inlineProductData, jsonAt } from '../src/retailer-data.mjs';

test('literal JSON scanning respects escaped strings, nested objects and invalid expressions', () => {
  const value = { name: 'Brace } and quote "', nested: [{ price: '2' }] };
  assert.deepEqual(jsonAt(JSON.stringify(value) + ', otherArguments)', 0), value);
  assert.equal(jsonAt('{"price": getPrice()}', 0), null);
  assert.equal(jsonAt('{"price":2]', 0), null);
});

const shopUrl = 'https://shop.retailer.com/products/shirt?variant=39525634310233';
const viewedPage = (extra = {}, canonical = shopUrl) => `<link rel="canonical" href="${canonical}">
  <script>window.ShopifyAnalytics.lib.track("Viewed Product",${JSON.stringify({
    variantId: '39525634310233', productId: 123, name: 'Linen shirt', price: '11.99', currency: 'USD', available: true, ...extra,
  })},undefined);</script>`;

test('Shopify viewed-product data supplies the selected URL price with currency and stock, without script execution', () => {
  const result = extractPrice(viewedPage(), shopUrl);
  assert.equal(result.verified, true);
  assert.equal(result.extracted_price, '$11.99');
  assert.equal(result.source, 'shopify_viewed_product');
  assert.equal(extractPrice(viewedPage({ available: false }), shopUrl).availability, 'OutOfStock');
  for (const extra of [{ variantId: '39525634310234' }, { currency: 'CAD' }, { available: undefined }, { price: '0' }]) {
    assert.equal(extractPrice(viewedPage(extra), shopUrl).verified, false);
  }
  assert.equal(extractPrice(viewedPage({}, 'https://shop.retailer.com/products/other'), shopUrl).verified, false);
  assert.equal(extractPrice(viewedPage().replace('ShopifyAnalytics.lib.track', 'unrelated.track'), shopUrl).verified, false);
  assert.equal(extractPrice(viewedPage({}, shopUrl), shopUrl + '&selectedSellerId=0').verified, false);
});

const asosUrl = 'https://www.asos.com/us/brand/shirt/prd/207588422';
const stock = (extra = {}) => ({ productId: 207588422,
  productPrice: { current: { value: 19.24 }, previous: { value: 34.99 }, currency: 'USD', additionalContexts: [] },
  hasMultiplePricesInStock: false, isInStock: true,
  variants: [{ id: 207588424, isInStock: false, price: { current: { value: 17.50 }, currency: 'USD' } }], ...extra });
const asosPage = rows => {
  const literal = JSON.stringify(rows).replaceAll('\\', '\\\\').replaceAll("'", "\\'");
  return `<script>window.asos.pdp.config.stockPriceResponse = '${literal}';</script>`;
};

test('ASOS stock-price literals select the requested product and its current price rather than previous or related prices', () => {
  const result = extractPrice(asosPage([stock({ productId: 9 }), stock()]), asosUrl);
  assert.equal(result.verified, true);
  assert.equal(result.extracted_price, '$19.24');
  assert.equal(result.source, 'asos_stock_price');
  const variant = extractPrice(asosPage([stock()]), asosUrl + '?variant=207588424');
  assert.equal(variant.verified, true);
  assert.equal(variant.extracted_price, '$17.50');
  assert.equal(variant.availability, 'OutOfStock');
  assert.equal(extractPrice(asosPage([stock()]), asosUrl + '?variant=missing').verified, false);
  assert.equal(extractPrice(asosPage([stock()]), asosUrl.replace('207588422', '207588423')).verified, false);
});

test('ASOS adapters reject conditional prices, missing variant prices, ranges, foreign currencies and computed assignments', () => {
  for (const data of [stock({ hasMultiplePricesInStock: true }),
    stock({ productPrice: { current: { value: 20 }, currency: 'CAD' } }),
    stock({ productPrice: { current: { value: 20 }, currency: 'USD', additionalContexts: ['members'] } })]) {
    assert.equal(extractPrice(asosPage([data]), asosUrl).verified, false);
  }
  assert.equal(extractPrice(asosPage([stock({ variants: [{ id: 123, isInStock: true }] })]), asosUrl + '?variant=123').verified, false);
  assert.equal(inlineProductData("window.asos.pdp.config.stockPriceResponse = '[]' + runCode();").asosStock.length, 0);
  assert.equal(extractPrice(asosPage([stock()]), asosUrl.replace('www.asos.com', 'other.retailer.com')).verified, false);
});
