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
    const itemId = Number(input.itemId);
    if (!Number.isSafeInteger(itemId) || itemId <= 0) throw new AiLookupError('invalid_image');
    const maxResults = input.maxResults ?? 5;
    if (!Number.isFinite(maxResults)) throw new AiLookupError('invalid_image');
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
    if (controller.signal.aborted) throw new AiLookupError(timedOut ? 'timeout' : 'cancelled');
    throw toAiLookupError(error);
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener('abort', abort);
  }
}
