/**
 * File: price.ts
 * Description: Maps a clothing item's numeric price into a $ - $$$$$ tier symbol.
 * Author: Kai Markley
 * Date: 2026-09-02
 */

export type PriceTier = {
  symbol: string;
  max: number;
  label: string;
};

export const PRICE_TIERS: PriceTier[] = [
  { symbol: '$', max: 30, label: '$0 - $30' },
  { symbol: '$$', max: 45, label: '$30 - $45' },
  { symbol: '$$$', max: 65, label: '$45 - $65' },
  { symbol: '$$$$', max: 85, label: '$65 - $85' },
  { symbol: '$$$$$', max: Infinity, label: '$85+' },
];

export function parsePriceValue(price: string): number {
  const value = Number(String(price).replace(/[^0-9.]/g, ''));
  return Number.isFinite(value) ? value : 0;
}

export function getPriceTierSymbol(price: string): string {
  const value = parsePriceValue(price);
  const tier = PRICE_TIERS.find((t) => value <= t.max);
  return (tier ?? PRICE_TIERS[PRICE_TIERS.length - 1]).symbol;
}
