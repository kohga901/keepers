// Read literal JSON only. No retailer JavaScript is evaluated.
export function jsonAt(text, start) {
  while (/\s/.test(text[start] ?? '') && start < text.length) start++;
  if (!['{', '['].includes(text[start])) return null;
  const stack = []; let quoted = false, escaped = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === '{' || char === '[') stack.push(char);
    else if (char === '}' || char === ']') {
      if (stack.pop() !== (char === '}' ? '{' : '[')) return null;
      if (!stack.length) { try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; } }
    }
  }
  return null;
}

function stringAt(text, start) {
  const quote = text[start];
  if (quote !== "'" && quote !== '"') return null;
  let result = '';
  for (let i = start + 1; i < text.length; i++) {
    const char = text[i];
    if (char === quote) return { value: result, end: i + 1 };
    if (char !== '\\') { result += char; continue; }
    const escape = text[++i];
    const simple = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '\\': '\\', "'": "'", '"': '"', '/': '/' };
    if (Object.hasOwn(simple, escape)) result += simple[escape];
    else if (escape === 'u' || escape === 'x') {
      const length = escape === 'u' ? 4 : 2, digits = text.slice(i + 1, i + 1 + length);
      if (!new RegExp(`^[0-9a-f]{${length}}$`, 'i').test(digits)) return null;
      result += String.fromCharCode(parseInt(digits, 16)); i += length;
    } else return null;
  }
  return null;
}

export function inlineProductData(text) {
  const result = { shopifyViews: [], asosStock: [] };
  const viewed = /(?:window\.)?ShopifyAnalytics\.lib\.track\(\s*["']Viewed Product["']\s*,\s*/g;
  for (const match of text.matchAll(viewed)) {
    const data = jsonAt(text, match.index + match[0].length);
    if (data) result.shopifyViews.push(data);
  }
  const asos = /window\.asos\.pdp\.config\.stockPriceResponse\s*=\s*/g;
  for (const match of text.matchAll(asos)) {
    const literal = stringAt(text, match.index + match[0].length);
    if (!literal || !/^\s*(;|$)/.test(text.slice(literal.end))) continue;
    try { const data = JSON.parse(literal.value); if (Array.isArray(data)) result.asosStock.push(...data); } catch { /* Not a literal stock response. */ }
  }
  return result;
}

export function retailerProducts(data, pageUrl, canonical, sameProduct, variantParams) {
  const page = new URL(pageUrl), products = [];
  const selectorKeys = variantParams(page);
  const selected = page.searchParams.get('variant');
  if (canonical && sameProduct(canonical, pageUrl) && selectorKeys.every(key => key === 'variant') &&
      (!selected || page.searchParams.getAll('variant').length === 1)) {
    for (const view of data.shopifyViews) {
      if (selected && String(view.variantId) !== selected) continue;
      if (typeof view.available !== 'boolean') continue;
      products.push({ '@type': 'Product', url: pageUrl, name: view.name, _source: 'shopify_viewed_product',
        offers: { '@type': 'Offer', url: pageUrl, price: view.price, priceCurrency: view.currency,
          availability: view.available ? 'InStock' : 'OutOfStock' } });
    }
  }
  const asosId = page.hostname === 'www.asos.com' && page.pathname.match(/\/prd\/(\d+)\/?$/)?.[1];
  if (asosId && selectorKeys.every(key => key === 'variant') && (!selected || page.searchParams.getAll('variant').length === 1)) {
    for (const stock of data.asosStock.filter(row => String(row.productId) === asosId)) {
      const variant = selected ? stock.variants?.find(row => String(row.id) === selected) : null;
      if (selected && !variant) continue;
      if (!selected && stock.hasMultiplePricesInStock !== false) continue;
      const price = selected ? variant.price : stock.productPrice, available = selected ? variant.isInStock : stock.isInStock;
      if (typeof available !== 'boolean' || price?.context || price?.additionalContexts?.length) continue;
      products.push({ '@type': 'Product', url: pageUrl, _source: 'asos_stock_price',
        offers: { '@type': 'Offer', url: pageUrl, price: price?.current?.value, priceCurrency: price?.currency,
          availability: available ? 'InStock' : 'OutOfStock' } });
    }
  }
  return products;
}
