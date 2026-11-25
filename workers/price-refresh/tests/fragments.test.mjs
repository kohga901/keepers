import {test} from 'node:test';import assert from 'node:assert/strict';
import {extractPrice}from'../src/extract.mjs';import{listingUrl,fetchProduct,observeProduct,validateDestination}from'../src/catalog.mjs';
const base='https://shop.retailer.com/product/shirt';
const html=(sku='33113788',offerUrl=base)=>`<script type="application/ld+json">${JSON.stringify({'@type':'Product',url:base,sku,offers:{'@type':'Offer',url:offerUrl,price:'19.99',priceCurrency:'USD',availability:'InStock'}})}</script>`;
test('SKU fragments are preserved and require proof of the selected SKU rather than the default product',()=>{
  const url=base+'#skuId/33113788?camp=PLA';
  assert.equal(listingUrl(url).hash,'#skuId/33113788?camp=PLA');
  assert.equal(extractPrice(html(),url).verified,true);
  assert.equal(extractPrice(html('other'),url).verified,false);
  assert.equal(extractPrice(html(),base+'#reviews').verified,true);
});
test('attribute fragments must be matched in full, regardless of ordering, and duplicate selectors fail',()=>{
  const url=base+'#93=17573&354=8669';
  assert.equal(extractPrice(html('sku',base+'#354=8669&93=17573'),url).verified,true);
  assert.equal(extractPrice(html('sku',base),url).verified,false);
  assert.equal(extractPrice(html('sku',base+'#93=17573&354=9999'),url).verified,false);
  assert.equal(extractPrice(html('sku',base+'#93=17573&93=17573'),base+'#93=17573&93=17573').verified,false);
});
test('HTTP redirects inherit fragments and browser navigation receives the original selected SKU',async()=>{
  const url=base+'#skuId/33113788';let calls=0;
  const result=await fetchProduct(url,async()=>++calls===1?new Response('',{status:301,headers:{location:base+'?utm_source=clean'}}):new Response(html(),{headers:{'Content-Type':'text/html'}}));
  assert.equal(result.verified,true);assert.ok(result.fetched_url.endsWith('#skuId/33113788'));
  assert.throws(()=>validateDestination(new URL(url),new URL(base)),/redirect_changed_product/);
  const observation=await observeProduct(url,async()=>new Response('<html></html>',{headers:{'Content-Type':'text/html'}}),async target=>{assert.equal(target,url);return{html:html(),url,status:200}});
  assert.equal(observation.verified,true);assert.equal(observation.transport,'browser');
});
