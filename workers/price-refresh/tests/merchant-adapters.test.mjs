import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractPrice } from '../src/extract.mjs';
import { recoveryFor } from '../src/recovery.mjs';
import { sameProduct, sameMerchant } from '../src/extract.mjs';
const ld = value => `<script type="application/ld+json">${JSON.stringify(value)}</script>`;
const offer = (url, extra = {}) => ({ '@type': 'Offer', url, price: '19.99', priceCurrency: 'USD', availability: 'OutOfStock', ...extra });
test('merchant aliases and stable style routes preserve exact product, color/size SKU, and market identities',()=>{
  assert.equal(sameMerchant(new URL('https://checkout.clothingshoponline.com/p'),new URL('https://www.clothingshoponline.com/p')),true);
  assert.equal(sameMerchant(new URL('https://unrelated.clothingshoponline.com/p'),new URL('https://www.clothingshoponline.com/p')),false);
  const ae='https://www.ae.com/us/en/p/women/old-route/0531_1642_839';
  assert.equal(sameProduct(ae.replace('old-route','new-route'),ae),true);
  assert.equal(sameProduct(ae.replace('839','840'),ae),false);
  assert.equal(sameProduct(ae.replace('/us/','/ca/'),ae),false);
  const brooks='https://www.brooksbrothers.com/old-slug/ME04498_____LBL3_18H__31__.html';
  assert.equal(sameProduct(brooks.replace('old-slug','new-slug'),brooks),true);
  assert.equal(sameProduct(brooks.replace('18H','19H'),brooks),false);
  assert.equal(sameProduct('https://factory.jcrew.com/p/old/CG385','https://factory.jcrew.com/p/new/CG385'),true);
  assert.equal(sameProduct('https://factory.jcrew.com/p/old/CG385','https://factory.jcrew.com/p/new/CG386'),false);
});

test('Vuori objectId matches only the exact saved variant on the same product', () => {
  const url = 'https://vuoriclothing.com/products/meta-pant-ink?variant=39405164298343';
  const page = ld({ '@type': 'ProductGroup', url: url.split('?')[0], hasVariant: [
    { '@type': 'Product', name: 'Ink 32', offers: offer(url.replace('variant=', 'objectId=')) },
    { '@type': 'Product', name: 'Ink 34', offers: offer(url.replace('variant=39405164298343', 'objectId=39405164298344'), { price: '10' }) },
  ] });
  const result = extractPrice(page, url); assert.equal(result.verified, true); assert.equal(result.extracted_price, '$19.99');
  assert.equal(result.variant_id, '39405164298343');
  for (const changed of [url.replace('39405164298343', '39405164298345'), url + '&size=34', url.replace('meta-pant-ink', 'meta-pant-black')]) assert.equal(extractPrice(page, changed).verified, false);
});

test('Talbots parent style links match child SKUs only when the parent and all selected attributes agree', () => {
  const base = 'https://www.talbots.com/pants/P261016081.html';
  const url = base + '?dwvar_P261016081_color=INDIGO&dwvar_P261016081_sizeType=MS&dwvar_P261016081_size=004';
  const child = 'https://www.talbots.com/pants/58560457.html?dwvar_58560457_color=INDIGO&dwvar_58560457_sizeType=MS&dwvar_58560457_size=004';
  const page = (group = 'P261016081', sku = '58560457', candidate = child) => ld([{ '@type': 'ProductGroup', url: base, productGroupID: group,
    hasVariant: [{ '@type': 'Product', sku, offers: offer(candidate) }] }]);
  assert.equal(extractPrice(page(), url).verified, true);
  for (const changed of [url.replace('=004', '=006'), url.replace('=INDIGO', '=BLACK'), url.replace('=MS', '=PT'), url + '&size=4', url.replace('P261016081.html', 'P261016082.html')]) assert.equal(extractPrice(page(), changed).verified, false);
  assert.equal(extractPrice(page('wrong'), url).verified, false);
  assert.equal(extractPrice(page('P261016081', '11111111'), url).verified, false);
  assert.equal(extractPrice(page('P261016081', '58560457', child.replace('www.talbots.com', 'other.retailer.com')), url).verified, false);
});

const walmartUrl = 'https://www.walmart.com/ip/Shorts/624432298?selectedSellerId=0';
const walmart = extra => ({ usItemId: '624432298', canonicalUrl: '/ip/Shorts/624432298', name: 'Cargo shorts', catalogSellerId: 0,
  offerId: 'offer123', conditionType: 'New', availabilityStatus: 'OUT_OF_STOCK',
  priceInfo: { currentPrice: { price: 22.98, currencyUnit: 'USD' }, priceDisplayCodes: { isB2BPrice: false } }, ...extra });
const nextPage = product => `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { initialData: { data: { product } } } } })}</script>`;
test('active PriceSpecifications are distinguished from struck-through, member, future, expired and unit prices', () => {
  const url='https://shop.retailer.com/products/shirt';
  const spec=extra=>({'@type':'UnitPriceSpecification',price:'19.99',priceCurrency:'USD',...extra});
  const page=specifications=>ld({'@type':'Product',url,offers:{'@type':'Offer',url,priceSpecification:specifications,availability:'InStock'}});
  assert.equal(extractPrice(page([spec({priceType:'https://schema.org/StrikethroughPrice',price:'40'}),spec()]),url).extracted_price,'$19.99');
  assert.equal(extractPrice(page([spec({priceType:'https://schema.org/SalePrice'}),spec({priceType:'https://schema.org/StrikethroughPrice',price:'40'})]),url).extracted_price,'$19.99');
  for(const specifications of [[spec({validForMemberTier:'VIP'})],[spec({referenceQuantity:{value:1,unitCode:'KGM'}})],[spec({validThrough:'2000-01-01'})],[spec({validFrom:'2999-01-01'})],[spec({priceType:'https://schema.org/StrikethroughPrice'})],[spec(),spec({price:'21.99'})],[spec({validThrough:'bad-date'})]])assert.equal(extractPrice(page(specifications),url).verified,false);
});
test('direct offer dates reject future, malformed, impossible and timezone-ambiguous windows',()=>{
  const url='https://shop.retailer.com/products/shirt';
  for(const extra of [{validFrom:'2999-01-01'},{priceValidUntil:'bad-date'},{priceValidUntil:'2026-02-30'},{validFrom:'2026-01-01T12:00:00'},{validThrough:'2000-01-01'}])assert.equal(extractPrice(ld({'@type':'Product',url,offers:offer(url,extra)}),url).verified,false);
});
test('Walmart page state requires the exact item, selected seller/offer, unconditional current USD price and stock', () => {
  const result = extractPrice(nextPage(walmart()), walmartUrl);
  assert.equal(result.verified, true); assert.equal(result.extracted_price, '$22.98'); assert.equal(result.source, 'walmart_next_data'); assert.equal(result.availability, 'OutOfStock');
  for (const extra of [{ usItemId: '624432299' }, { catalogSellerId: 123 }, { conditionType: 'Used' },
    { canonicalUrl: '/ip/Other/123456789' }, { availabilityStatus: undefined }, { priceInfo: { currentPrice: null } },
    { priceInfo: { currentPrice: { price: 9, currencyUnit: 'CAD' } } },
    { priceInfo: { currentPrice: { price: 9, currencyUnit: 'USD' }, priceDisplayCodes: { isB2BPrice: true } } }]) assert.equal(extractPrice(nextPage(walmart(extra)), walmartUrl).verified, false);
  assert.equal(extractPrice(nextPage(walmart()), walmartUrl + '&selectedOfferId=wrong').verified, false);
  assert.equal(extractPrice(nextPage(walmart()), walmartUrl + '&size=XL').verified, false);
  assert.equal(extractPrice(nextPage(walmart()), walmartUrl.replace('walmart.com', 'other.retailer.com')).verified, false);
  assert.equal(extractPrice(nextPage(walmart()), walmartUrl + '&conditionGroupCode=2').verified, false);
  assert.equal(extractPrice(nextPage(walmart({isConditionNew:true})),walmartUrl+'&conditionGroupCode=1').verified,true);
  assert.equal(extractPrice(nextPage(walmart()),walmartUrl+'&conditionGroupCode=1').verified,false);
  assert.equal(extractPrice(nextPage(walmart({isConditionNew:true})),walmartUrl+'&conditionGroupCode=1&conditionGroupCode=1').verified,false);
});

test('Buckle SKU routes verify descriptive label aliases only for the exact child SKU and matching primary dimensions',()=>{
  const base='https://www.buckle.com/short/prd-17079766BK2107/sku-3127383600';
  const page=ld({'@type':'Product',sku:'3127383600',color:'Gothic Olive',size:'36',offers:offer(base+'?size=36')});
  const url=base+'?color=gothic+olive%2Fgreen&size=36%2Fmid+4-6';
  assert.equal(extractPrice(page,url).verified,true);
  for(const changed of [url.replace('36%2Fmid','38%2Fmid'),url.replace('gothic+olive','black'),url.replace('sku-3127383600','sku-3127383800'),url+'&size=36']) assert.equal(extractPrice(page,changed).verified,false);
});
test('large unrelated Next.js state cannot hide a valid product offer on another merchant',()=>{
  const url='https://shop.retailer.com/products/shirt';
  const html=ld({'@type':'Product',url,offers:offer(url)})+'<script type="application/json" id="__NEXT_DATA__">'+JSON.stringify({unrelated:'x'.repeat(2*1024*1024+1)})+'</script>';
  assert.equal(extractPrice(html,url).verified,true);
});

test('product/choice IDs and merchant-specific offer selectors cannot silently use a generic page price',()=>{
  for(const [host,selector] of [['www.victoriassecret.com','choice=7H6H'],['www.macys.com','ID=123456'],['www.zara.com','v1=123456'],['www.lyst.com','product=ABC&link_id=123'],['www.shopcider.com','style_id=123456'],['www.llbean.com','attrValue_0=Navy']]){
    const base=`https://${host}/products/shirt`,page=ld({'@type':'Product',url:base,offers:offer(base)});
    assert.equal(extractPrice(page,base+'?'+selector).verified,false);
  }
});
test('visible challenge and maintenance messages are classified without treating script/footer text as a price',()=>{
  const url='https://shop.retailer.com/products/shirt';
  assert.equal(extractPrice('<title>Shop</title><p>Please verify you are a human.</p>',url).reason,'merchant_challenge');
  assert.equal(extractPrice('<p>System maintenance is in progress.</p>',url).reason,'merchant_maintenance');
  assert.equal(extractPrice('<script>const message="verify you are a human";</script>',url).reason,'no_supported_product_data');
  assert.equal(extractPrice(ld({'@type':'Product',url,offers:offer(url)})+'<p>Please verify you are a human.</p>',url).verified,true);
  for(const target of ['https://merchant.com/px?url=original','https://merchant.com/on/demandware.store/Sites/default/PX-Show?url=original']) {
    assert.equal(recoveryFor({reason:'redirect_changed_product',redirects:[{to:target}]}).action,'merchant_access');
  }
  assert.equal(recoveryFor({reason:'redirect_changed_product',redirects:[{to:'https://merchant.com/category/shirts'}]}).action,'repair_listing');
});
