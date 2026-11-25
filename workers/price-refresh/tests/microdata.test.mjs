import { test } from 'node:test';import assert from 'node:assert/strict';import { extractPrice } from '../src/extract.mjs';
const url = 'https://shop.retailer.com/product/shirt';
const page = (offer = '', extra = '', identity = url) => `<link rel="canonical" href="${identity}"><div itemscope itemtype="https://schema.org/Product" itemid="${identity}"><span itemprop="name">Linen Shirt</span><span itemprop="sku">SKU123</span><div itemprop="offers" itemscope itemtype="https://schema.org/Offer"><meta itemprop="priceCurrency" content="USD"><link itemprop="availability" href="https://schema.org/OutOfStock"><span itemprop="price" content="19.99">$19.99</span>${offer}</div>${extra}</div>`;
test('scoped microdata extracts price/currency/stock and text fields without reading unrelated dollar amounts', () => {
  const result=extractPrice(page('', '<p>Previously $99.00. Three payments of $6.66.</p>'),url);
  assert.equal(result.verified,true);assert.equal(result.extracted_price,'$19.99');assert.equal(result.availability,'OutOfStock');assert.equal(result.source,'microdata');assert.equal(result.identity.sku,'SKU123');
  assert.equal(extractPrice(page().replace(' content="19.99"','').replace('$19.99','19.99'),url).verified,true);
  assert.equal(extractPrice(page('', '<span itemprop="brand" itemscope itemtype="https://schema.org/Brand"><span itemprop="name">Different Brand</span></span>'),url).product_name,'Linen Shirt');
});
test('microdata rejects conflicting prices, unknown currency, expired offers and a different selected variant', () => {
  for(const html of [page('<meta itemprop="price" content="1.99">'),page().replace('content="USD"','content="CAD"'),page('<meta itemprop="priceValidUntil" content="2000-01-01">'),page('<meta itemprop="eligibleCustomerType" content="members">')])assert.equal(extractPrice(html,url).verified,false);
  assert.equal(extractPrice(page(),url+'?variant=123456789').verified,false);
  assert.equal(extractPrice(page('','','https://shop.retailer.com/product/other'),url).verified,false);
});
test('nested unit-price specifications and recommended ItemList products cannot replace the main price', () => {
  const unit='<div itemprop="priceSpecification" itemscope itemtype="https://schema.org/UnitPriceSpecification"><meta itemprop="price" content="0.99"></div>';
  assert.equal(extractPrice(page(unit),url).extracted_price,'$19.99');
  const related=`<div itemscope itemtype="https://schema.org/ItemList">${page('','','https://shop.retailer.com/product/other')}</div>`;
  assert.equal(extractPrice(related,url).verified,false);
});
test('explicit child color and size can prove a variant omitted from the offer URL, while conflicting selectors fail', () => {
  const value={'@type':'Product',url,color:'Espresso',size:'M',sku:'SKU123',offers:{'@type':'Offer',url,price:'19.99',priceCurrency:'USD',availability:'InStock'}};
  const html=`<script type="application/ld+json">${JSON.stringify(value)}</script>`;
  assert.equal(extractPrice(html,url+'?color=Espresso&size=M').verified,true);
  for(const query of ['?color=Black&size=M','?color=Espresso&size=L','?color=Espresso&size=M&size=M','?color=Espresso&size=M&selectedSellerId=0'])assert.equal(extractPrice(html,url+query).verified,false);
});
