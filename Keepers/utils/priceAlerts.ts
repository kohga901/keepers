// Alert comparisons must not turn missing prices, ranges or other currencies into USD.
export function parseAlertPrice(value: string | null | undefined): number | null {
  const text = value?.trim() ?? '';
  if (text.length > 32 || !/^(\$|USD\s+)?(\d+|\d{1,3}(,\d{3})+)(\.\d{1,2})?$/.test(text)) return null;
  const price = Number(text.replace(/^(\$|USD\s+)/, '').replace(/,/g, ''));
  return Number.isFinite(price) && price < 100000000 ? price : null;
}

export function validateAlertTarget(value: string, currentPrice: string): number {
  const target = parseAlertPrice(value);
  if (target === null || target <= 0) throw new Error('Enter a positive USD price with at most two decimal places.');
  const current = parseAlertPrice(currentPrice);
  if (current === null) throw new Error('This item does not have a supported USD price.');
  if (target >= current) throw new Error('Choose a target below the current catalog price.');
  return target;
}

export const formatAlertPrice = (value: number) => `$${value.toFixed(2)}`;
