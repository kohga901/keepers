import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchShopifyVariant } from '../src/shopify.mjs';
import { observeProduct } from '../src/catalog.mjs';
const url = 'https://shop.retailer.com/en-us/products/shirt?variant=39405164298343&currency=USD&country=US';
const product = { id: 12345678, handle: 'shirt', title: 'Shirt', price_min: 1200, price_max: 1500,
  variants: [{ id: 39405164298343, price: 1200, available: false }] };
function network(p = product, cart = { currency: 'USD' }) {
  return async (target, init) => { assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'manual');
    assert.equal(init.headers.Authorization, undefined); assert.equal(init.headers.apikey, undefined);
    assert.equal(new URL(target).searchParams.get('currency'), 'USD'); assert.equal(new URL(target).searchParams.get('country'), 'US');
    return Response.json(new URL(target).pathname.endsWith('cart.js') ? cart : p); };
}
test('Shopify public JSON requires exact handle, variant, integer cents and independently verified presentment currency', async () => {
  const result = await fetchShopifyVariant(url, network()); assert.equal(result.verified, true); assert.equal(result.extracted_price, '$12.00');
  assert.equal(result.availability, 'OutOfStock'); assert.equal(result.variant_id, '39405164298343');
  assert.ok(result.evidence_urls.every(value => value.startsWith('https://shop.retailer.com/en-us/')));
  for (const p of [{ ...product, handle: 'other' }, { ...product, price_min: 1300 }, { ...product, currency: 'CAD' },
    { ...product, requires_selling_plan: true }, { ...product, variants: [{ id: 39405164298343, price: '12', available: true }] },
    { ...product, variants: [{ id: 39405164298343, price: 1200 }] }]) assert.equal(await fetchShopifyVariant(url, network(p)), null);
  assert.equal(await fetchShopifyVariant(url, network(product, { currency: 'CAD' })), null);
  const missing=await fetchShopifyVariant(url,network({...product,variants:[{id:39405164298344,price:1200,available:true}]}));
  assert.equal(missing.verified,false);assert.equal(missing.reason,'variant_not_listed');
  assert.equal(await fetchShopifyVariant(url,network({...product,variants:Array.from({length:250},(_,i)=>({id:i+1,price:1200,available:true}))})),null);
  assert.equal(await fetchShopifyVariant(url + '&size=M', async () => assert.fail('unverified selection must not fetch')), null);
  assert.equal(await fetchShopifyVariant(url + '&selling_plan=123', async () => assert.fail('conditional offer must not fetch')), null);
  assert.equal(await fetchShopifyVariant(url.replace('currency=USD', 'currency=GBP'), async () => assert.fail('foreign market must not fetch')), null);
});
test('Shopify JSON redirects, HTML bodies, malformed data and oversized responses cannot yield a price', async () => {
  for (const response of [() => new Response('', { status: 302, headers: { location: 'https://other.retailer.com/' } }),
    () => new Response('<html>not JSON</html>', { headers: { 'Content-Type': 'text/html' } }),
    () => new Response('{', { headers: { 'Content-Type': 'application/json' } }),
    () => new Response(' '.repeat(2 * 1024 * 1024 + 1), { headers: { 'Content-Type': 'application/json' } })]) {
    assert.equal(await fetchShopifyVariant(url, async () => response()), null);
  }
  const typed=async target=>new Response(JSON.stringify(new URL(target).pathname.endsWith('cart.js')?{currency:'USD'}:product),{headers:{'Content-Type':'text/javascript; charset=utf-8'}});
  assert.equal((await fetchShopifyVariant(url,typed)).extracted_price,'$12.00');
  assert.equal(await fetchShopifyVariant(url,async()=>new Response('window.product = {};',{headers:{'Content-Type':'text/javascript'}})),null);
});

test('a blocked storefront can recover an exact public variant price without retaining a request failure or using credentials',async()=>{
  const api=network();
  const observation=await observeProduct(url,async(target,init)=>new URL(target).pathname.endsWith('.js')?api(target,init):new Response('',{status:403}));
  assert.equal(observation.verified,true);assert.equal(observation.extracted_price,'$12.00');
  assert.equal(observation.recovered_from,'merchant_http_403');assert.equal(observation.request_failed,undefined);
});

test('Shopify parent URLs recover one uniform price across a complete list of variants', async () => {
  const parent = url.replace('variant=39405164298343&', '');
  const uniform = { ...product, price_max: 1200, variants: [
    ...product.variants, { id: 39405164298344, price: 1200, available: true },
  ] };
  const result = await fetchShopifyVariant(parent, network(uniform));
  assert.equal(result.verified, true);
  assert.equal(result.extracted_price, '$12.00');
  assert.equal(result.availability, 'Mixed');
  assert.equal(result.variant_id, undefined);
  assert.equal(result.published_variants, 2);
  for (const p of [product, { ...uniform, variants: [] },
    { ...uniform, variants: [...uniform.variants, uniform.variants[0]] },
    { ...uniform, variants: [...uniform.variants, { id: 3, price: 1300, available: true }] },
    { ...uniform, variants: [...uniform.variants, { id: 3, price: 1200 }] },
    { ...uniform, variants: [...uniform.variants, { id: 3, price: 1200, available: true, requires_selling_plan: true }] },
    { ...uniform, variants: Array.from({ length: 250 }, (_, id) => ({ id, price: 1200, available: true })) },
  ]) assert.equal(await fetchShopifyVariant(parent, network(p)), null);
  for (const query of ['&size=M', '&option=red', '&variant=', '&variant=bad', '&currency=USD']) {
    assert.equal(await fetchShopifyVariant(parent + query, () => assert.fail('unproven selection must not fetch')), null);
  }
});

test('a parent listing exceeding the Free HTML budget can recover from small public JSON', async () => {
  const { freeTierFetcher } = await import('../src/free-tier.mjs');
  const parent = url.replace('variant=39405164298343&', '');
  const api = network({ ...product, price_max: 1200 });
  const result = await observeProduct(parent, freeTierFetcher(async (target, init) =>
    new URL(target).pathname.endsWith('.js') ? api(target, init) : new Response('large page', {
      headers: { 'Content-Type': 'text/html', 'Content-Length': '300000' },
    })));
  assert.equal(result.verified, true);
  assert.equal(result.recovered_from, 'free_tier_page_limit');
  assert.equal(result.extracted_price, '$12.00');
});
