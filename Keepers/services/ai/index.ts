import { supabase } from '../../utils/supabase';
import { SERVER_BASE_URL } from '../serverApi';
import { AiLookupError, toAiLookupError, type AiLookupErrorCode } from './errors';
import { imageLookupResultSchema, type ImageLookupInput, type ImageLookupResult } from './types';

export * from './errors';
export * from './types';

const SERVER_ERROR_CODES = new Set<AiLookupErrorCode>([
  'unauthorized', 'invalid_image', 'unavailable', 'network', 'quota', 'busy', 'timeout', 'unknown',
]);

export async function lookupPurchasableItem(input: ImageLookupInput): Promise<ImageLookupResult> {
  if (input.signal?.aborted) throw new AiLookupError('cancelled');
  const itemId = Number(input.itemId);
  if (!Number.isSafeInteger(itemId) || itemId <= 0) throw new AiLookupError('invalid_image');
  const maxResults = input.maxResults ?? 5;
  if (!Number.isFinite(maxResults)) throw new AiLookupError('invalid_image');
  const controller = new AbortController();
  const abort = () => controller.abort();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 110_000);
  input.signal?.addEventListener('abort', abort, { once: true });

  try {
    if (input.signal?.aborted) throw new AiLookupError('cancelled');
    let server: URL;
    try {
      server = new URL(SERVER_BASE_URL);
      if ((server.protocol !== 'https:' && !(__DEV__ && server.protocol === 'http:'))
          || server.username || server.password || server.search || server.hash
          || SERVER_BASE_URL.split('/')[2]?.includes('@')
          || [...SERVER_BASE_URL].some((character) => /\s/.test(character) || character === '\\')) {
        throw new Error('Invalid backend URL');
      }
    } catch {
      throw new AiLookupError('unavailable');
    }
    const { data, error } = await supabase.auth.getSession();
    if (controller.signal.aborted) throw new AiLookupError(timedOut ? 'timeout' : 'cancelled');
    if (error || !data.session?.access_token) throw new AiLookupError('unauthorized');
    const response = await fetch(`${server.href.replace(/\/$/, '')}/ai/lookup`, {
      method: 'POST',
      redirect: 'error',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` },
      body: JSON.stringify({ item_id: itemId, max_results: Math.min(8, Math.max(1, Math.floor(maxResults))) }),
      signal: controller.signal,
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const code = body?.detail?.code as AiLookupErrorCode | undefined;
      if (code && SERVER_ERROR_CODES.has(code)) throw new AiLookupError(code);
      throw toAiLookupError({ status: response.status });
    }
    const result = imageLookupResultSchema.safeParse(body);
    if (!result.success) throw new AiLookupError('unknown');
    return result.data;
  } catch (error) {
    if (input.signal?.aborted || (controller.signal.aborted && !timedOut)) throw new AiLookupError('cancelled');
    const failure = timedOut ? new AiLookupError('timeout') : toAiLookupError(error);
    if (failure.code !== 'unauthorized' && failure.code !== 'cancelled') {
      const fallback = catalogNameLookup(input.itemName, maxResults);
      if (fallback) return fallback;
    }
    throw failure;
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener('abort', abort);
  }
}

function catalogNameLookup(itemName: string, maxResults: number): ImageLookupResult | null {
  const name = itemName?.replace(/\s+/g, ' ').trim().slice(0, 240);
  if (!name || name.toLowerCase() === 'unknown') return null;
  const encoded = encodeURIComponent(name);
  const marketplaces = [
    ['Google Shopping', `https://www.google.com/search?tbm=shop&q=${encoded}`],
    ['eBay', `https://www.ebay.com/sch/i.html?_nkw=${encoded}`],
    ['Poshmark', `https://poshmark.com/search?query=${encoded}&type=listings&src=dir`],
    ['Depop', `https://www.depop.com/search/?q=${encoded}`],
    ['Mercari', `https://www.mercari.com/search/?keyword=${encoded}`],
  ];
  return {
    provider: 'catalog', model: 'none',
    identifiedItem: { name, brand: 'unknown', category: 'unknown', colors: [], identifiers: [] },
    searchSummary: 'Marketplace searches use only the catalog item name. No image identification or listing verification was performed.',
    listings: [], sources: [],
    searchLinks: marketplaces.slice(0, Math.min(8, Math.max(1, Math.floor(maxResults))))
      .map(([marketplace, url]) => ({ marketplace, title: `Search ${marketplace} for ${name}`, query: name, url })),
  };
}
