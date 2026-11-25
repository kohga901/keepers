const productFields = new Set(['name', 'url', 'sku', 'productID', 'gtin', 'gtin8', 'gtin12', 'gtin13', 'gtin14', 'color', 'size']);
const offerFields = new Set(['price', 'priceCurrency', 'availability', 'url', 'priceValidUntil', 'eligibleCustomerType', 'validForMemberTier']);

export function createMicrodataReader() {
  const stack = [], products = [], capturing = []; let overflow = false;
  function assign(target, field, value) {
    value = String(value ?? '').trim(); if (!value) return;
    if (!Object.hasOwn(target, field)) target[field] = value;
    else if (target[field] !== value) target[field] = null;
  }
  return {
    open(tag, attributes) {
      if (overflow) return;
      if (stack.length >= 512) { overflow = true; return; }
      const parent = stack.at(-1), frame = { tag, product: parent?.product, offer: parent?.offer, conditional: parent?.conditional };
      const type = String(attributes.itemtype ?? '').split(/[\s/#]/).filter(Boolean).at(-1);
      frame.blocked = parent?.blocked || (Object.hasOwn(attributes, 'itemscope') && !['Product', 'ProductGroup', 'Offer'].includes(type) && attributes.itemprop !== 'offers');
      frame.recommendation = parent?.recommendation || ['ItemList', 'Review'].includes(type);
      if (frame.recommendation) { frame.product = null; frame.offer = null; }
      if (!frame.recommendation && Object.hasOwn(attributes, 'itemscope') && ['Product', 'ProductGroup'].includes(type)) {
        frame.product = { '@type': 'Product', _source: 'microdata', offers: [] }; frame.offer = null; frame.conditional = false;
        frame.blocked = false;
        if (attributes.itemid && !attributes.itemid.startsWith('#')) frame.product.url = attributes.itemid;
        products.push(frame.product); if (products.length > 100) overflow = true;
      } else if (Object.hasOwn(attributes, 'itemscope') && (type === 'Offer' || attributes.itemprop === 'offers') && frame.product) {
        frame.offer = { '@type': 'Offer' }; frame.product.offers.push(frame.offer);
        if (frame.product.offers.length > 250) overflow = true;
      } else if (Object.hasOwn(attributes, 'itemscope') && /PriceSpecification|QuantitativeValue/.test(type ?? '')) frame.conditional = true;
      const fields = String(attributes.itemprop ?? '').split(/\s+/);
      if (!frame.conditional && !frame.blocked) for (const field of fields) {
        const target = frame.offer ? offerFields.has(field) ? frame.offer : null : frame.product && productFields.has(field) ? frame.product : null;
        if (!target) continue;
        const value = attributes.content ?? (field === 'url' || field === 'availability' ? attributes.href : undefined);
        if (value !== undefined) assign(target, field, value);
        else { frame.target = target; frame.field = field; frame.text = ''; }
      }
      if (frame.target) capturing.push(frame);
      stack.push(frame);
    },
    text(value) {
      if (overflow) return;
      for (const frame of capturing) if (frame.text.length < 1000) frame.text += value.slice(0, 1000 - frame.text.length);
    },
    close() {
      if (overflow) return;
      const frame = stack.pop(); if (frame?.target) { capturing.pop(); assign(frame.target, frame.field, frame.text); }
    },
    finish() { return overflow ? [] : products; },
  };
}
