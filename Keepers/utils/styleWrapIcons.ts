// Shared silhouettes keep related garment subtypes visually consistent.
const ICON_PATHS = {
  shirt: 'M8 3 3 6 1 11l4 2 2-3v11h10V10l2 3 4-2-2-5-5-3c0 4-8 4-8 0Z',
  tank: 'M8 3H5v18h14V3h-3c0 5-8 5-8 0Z',
  sweater: 'M8 3 4 6 1 19l4 1 2-10v11h10V10l2 10 4-1-3-13-4-3c0 4-8 4-8 0ZM7 18h10',
  hoodie: 'M8 7C6 0 18 0 16 7l4 2 3 11-4 1-2-8v8H7v-8l-2 8-4-1L4 9l4-2Zm0 0 4 3 4-3M9 10v4m6-4v4m-6 7v-4h6v4',
  jacket: 'M8 3 4 6 1 19l4 1 2-10v11h10V10l2 10 4-1-3-13-4-3-4 5-4-5Zm4 5v13M8 3l-1 6 5-1 5 1-1-6',
  coat: 'M8 2 4 5 1 16l4 1 2-8-1 13h12L17 9l2 8 4-1-3-11-4-3-4 6-4-6Zm4 6v14M8 2 7 8l5-1 5 1-1-6M7 16h10',
  vest: 'M8 3H5v6l2 3v9h10v-9l2-3V3h-3l-4 5-4-5Zm4 5v13',
  pants: 'M6 3h12l2 18h-6l-2-11-2 11H4L6 3Zm0 4h12m-6-4v7',
  shorts: 'M5 4h14l2 15h-7l-2-8-2 8H3L5 4Zm0 4h14m-7-4v7',
  skirt: 'M8 3h8l5 18H3L8 3Zm-1 4h10m-7 0L8 21m6-14 2 14',
  dress: 'M8 2H6l1 7 3 3-7 10h18l-7-10 3-3 1-7h-2c0 4-8 4-8 0Zm2 10h4',
  jumpsuit: 'M8 2H6v6l3 4-4 10h6l1-8 1 8h6l-4-10 3-4V2h-2c0 4-8 4-8 0Zm1 10h6',
  bra: 'M5 9V3m14 6V3M3 15l2-6h4l3 5 3-5h4l2 6c0 5-7 5-9 0-2 5-9 5-9 0Zm0 0H1v5h22v-5h-2',
  socks: 'M4 3h6v9l-4 4c-5 5-8-1-4-4l2-2V3Zm0 4h6m5-4h6v9l-4 4c-5 5-8-1-4-4l2-2V3Zm0 4h6',
  sleepwear: 'M4 3h6v8H2L1 6l3-3Zm3 0v8m-4 3h7l1 8H7l-1-5-1 5H1l2-8ZM15 3h7l-7 7h7',
  activewear: 'M6 3H3v8h10V3h-3c0 4-4 4-4 0Zm10 7h5l2 12h-4l-1-7-1 7h-4l3-12Z',
  package: 'M3 7 12 2l9 5v10l-9 5-9-5V7Zm0 0 9 5 9-5m-9 5v10M7 5l10 5',
  hanger: 'M10 5a2 2 0 1 1 4 0c0 2-2 2-2 4v2L2 18v2h20v-2l-10-7',
  fitted: 'M2 12h7m-3-3 3 3-3 3m16-3h-7m3-3-3 3 3 3M11 3v18m2-18v18',
  relaxed: 'M10 12H2m3-3-3 3 3 3m9-3h8m-3-3 3 3-3 3M9 3v5m0 8v5m6-18v5m0 8v5',
  oversized: 'M9 3H3v6m0-6 7 7m5-7h6v6m0-6-7 7M3 15v6h6m-6 0 7-7m11 1v6h-6m6 0-7-7',
  straight: 'M8 3v18m8-18v18M5 6l3-3 3 3m2 12 3 3 3-3',
  flared: 'M9 3 4 21m11-18 5 18M4 21h16M9 3h6',
  tapered: 'M4 3 9 21m11-18-5 18M4 3h16M9 21h6',
  boxy: 'M4 4h16v16H4V4Zm0 8h16m-8-8v16',
  curved: 'M6 3c7 6-7 12 0 18M18 3c-7 6 7 12 0 18',
  fitAndFlare: 'M8 3c0 4 2 5 2 8L4 21h16l-6-10c0-3 2-4 2-8M10 11h4',
  barrel: 'M8 3C2 9 2 15 8 21m8-18c6 6 6 12 0 18M8 3h8M8 21h8',
  tailored: 'M8 3 4 6v15h16V6l-4-3-4 5-4-5Zm4 5v13M8 3l-1 6 5-1 5 1-1-6',
  fit: 'M4 9V4h5m6 0h5v5m0 6v5h-5m-6 0H4v-5M8 12h8',
};

type IconName = keyof typeof ICON_PATHS;

export const GARMENT_ICONS: Record<string, IconName> = {
  'activewear-set': 'activewear',
  blazer: 'jacket', blouse: 'shirt', bodysuit: 'jumpsuit', 'bomber-jacket': 'jacket',
  bra: 'bra', 'button-up-shirt': 'shirt', cardigan: 'jacket', coat: 'coat',
  'crop-top': 'tank', dress: 'dress', 'flannel-shirt': 'shirt', hoodie: 'hoodie',
  jacket: 'jacket', jeans: 'pants', joggers: 'pants', jumpsuit: 'jumpsuit', leggings: 'pants',
  'long-sleeve-top': 'sweater', 'non-apparel': 'package', 'pajama-pants': 'pants',
  pajamas: 'sleepwear', 'pajama-set': 'sleepwear', pants: 'pants', polo: 'shirt',
  'puffer-jacket': 'jacket', 'quarter-zip-pullover': 'sweater', shirt: 'shirt', shorts: 'shorts',
  singlet: 'tank', skirt: 'skirt', socks: 'socks', 'sports-bra': 'bra', sweater: 'sweater',
  sweatpants: 'pants', sweatshirt: 'sweater', 'tank-top': 'tank', top: 'shirt',
  'trench-coat': 'coat', 't-shirt': 'shirt', tunic: 'shirt', turtleneck: 'sweater', vest: 'vest',
};

export const FIT_ICONS: Record<string, IconName> = {
  'a-line': 'flared', baggy: 'relaxed', 'barrel-leg': 'barrel', bodycon: 'fitted',
  bootcut: 'flared', boxy: 'boxy', 'curvy-fit': 'curved', 'fit-and-flare': 'fitAndFlare',
  fitted: 'fitted', flared: 'flared', 'loose-fit': 'relaxed', oversized: 'oversized',
  'regular-fit': 'straight', 'relaxed-fit': 'relaxed', 'skinny-leg': 'fitted',
  'slim-fit': 'fitted', 'straight-leg': 'straight', tailored: 'tailored',
  'tapered-leg': 'tapered', 'wide-leg': 'relaxed',
};

export function styleWrapDetailIcon(category: 'garment-type' | 'fit', tag: string | undefined, color: string): string {
  const icons = category === 'garment-type' ? GARMENT_ICONS : FIT_ICONS;
  const fallback = category === 'garment-type' ? 'hanger' : 'fit';
  const icon = tag && Object.hasOwn(icons, tag) ? icons[tag] : fallback;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="${ICON_PATHS[icon]}"/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
