import { test } from 'node:test';import assert from 'node:assert/strict';
import { searchHits, rankReplacement, productIdentifiers, assessReplacement } from '../src/replacement-match.mjs';
test('search evidence parsing retains merchant links without interpreting snippets as verified prices', () => {
  const hits=searchHits('Cargo Pants (https://www.retailer.com/products/cargo)\nciteturn0search0 [wordlim: 200] Price $19.99\n--------------------------------------------------------------------------------\nOther (https://www.google.com/shopping/product/123)\nciteturn0search1');
  assert.equal(hits.length,1);assert.equal(hits[0].url,'https://www.retailer.com/products/cargo');assert.equal(hits[0].price,undefined);
});

test('replacement checks preserve Gap fit selectors and full Brooks size/color SKUs', () => {
  const row = {url:'https://www.gap.com/browse/product.do?pid=873122002&vid=2'};
  const changed = {verified:true,fetched_url:row.url.replace('vid=2','vid=1'),extracted_price:'$54.97',currency:'USD'};
  assert.equal(assessReplacement(row,{url:changed.fetched_url},changed).exact_match,false);
  const brooks={url:'https://www.brooksbrothers.com/shirt/ME04490_____LPK3_21___30__.html'};
  const wrong={...changed,fetched_url:brooks.url.replace('_21___30__','_18___32__')};
  assert.equal(assessReplacement(brooks,{url:wrong.fetched_url},wrong).exact_match,false);
});
test('replacement approval requires a live verified product and every original selector, never a title match alone',()=>{
  const row={url:'https://shop.retailer.com/products/shirt?variant=39405164298343'};
  const candidate={url:row.url};const observation={verified:true,fetched_url:row.url,variant_id:'39405164298343',extracted_price:'$12.00',currency:'USD',availability:'OutOfStock'};
  assert.equal(assessReplacement(row,candidate,observation).exact_match,true);
  assert.equal(assessReplacement(row,candidate,{verified:false,reason:'merchant_http_403'}).status,'access_blocked');
  assert.equal(assessReplacement(row,{url:'https://other.retailer.com/products/shirt'},{...observation,fetched_url:'https://other.retailer.com/products/shirt',variant_id:undefined}).exact_match,false);
  assert.equal(assessReplacement({...row,url:row.url+'&size=L'},candidate,observation).exact_match,false);
  assert.equal(assessReplacement(row,candidate,null).status,'not_checked');
});
test('replacement ranking uses names and identifiers while leaving price/variant verification to live checks', () => {
  const row={item_name:'Brand Womens Cargo Pants',url:'https://www.retailer.com/products/pants/123456?variant=39405164298343&utm_campaign=987654'};
  assert.deepEqual(productIdentifiers(row.url),['123456']);
  assert.ok(productIdentifiers('https://www.ae.com/us/en/p/pants/0461_5519_182').includes('0461_5519_182'));
  assert.ok(productIdentifiers('https://www.boden.com/women/eva-cardigan-k0862org').includes('k0862org'));
  const hit={title:'Brand Cargo Pants',url:'https://www.retailer.com/products/new-pants/123456?variant=39405164298343'};
  const result=rankReplacement(row,hit);assert.equal(result.preserved_variant_id,true);assert.equal(result.same_merchant,true);assert.equal(result.verified,undefined);
  assert.equal(rankReplacement(row,{title:'Unrelated winter jacket',url:'https://www.other.com/products/jacket'}),null);
});

test('URL digits alone never prove a GTIN or an exact cross-merchant replacement',()=>{
  const row={url:'https://merchant.com/products/shirt/4006381333931'};
  const observation={verified:true,fetched_url:'https://another.com/products/shirt',identity:{gtin:'4006381333931'},currency:'USD',extracted_price:'$19.99'};
  assert.equal(assessReplacement(row,{url:observation.fetched_url},observation).matched_gtin,false);
  const result=assessReplacement({...row,original_check:{identity:{gtin:'4006381333931'}}},{url:observation.fetched_url},observation);
  assert.equal(result.matched_gtin,true);assert.equal(result.exact_match,false);
});
