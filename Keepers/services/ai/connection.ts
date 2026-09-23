import { getProviderApiKeyForRequest } from './credentials';
import { AiLookupError } from './errors';
import type { AiProvider } from './types';

const CONNECTION_TIMEOUT_MS = 15_000;

export type ConnectionTestResult =
  | { ok: true }
  | { ok: false; message: string };

export async function testProviderConnection(provider: AiProvider): Promise<ConnectionTestResult> {
  const apiKey = await getProviderApiKeyForRequest(provider);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONNECTION_TIMEOUT_MS);

  try {
    const response = await fetch(
      provider === 'google'
        ? 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1'
        : 'https://api.openai.com/v1/models',
      {
        method: 'GET',
        headers:
          provider === 'google'
            ? { 'x-goog-api-key': apiKey }
            : { Authorization: `Bearer ${apiKey}` },
        redirect: 'error',
        signal: controller.signal,
      },
    );

    if (response.ok) return { ok: true };
    if (response.status === 401 || response.status === 403) {
      return { ok: false, message: 'The provider rejected this API key.' };
    }
    if (response.status === 429) {
      return { ok: false, message: 'The key was recognized, but its project is rate-limited or out of quota.' };
    }

    return { ok: false, message: `The provider returned status ${response.status}.` };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { ok: false, message: 'The connection test timed out.' };
    }
    if (error instanceof AiLookupError) throw error;
    return { ok: false, message: 'The provider could not be reached.' };
  } finally {
    clearTimeout(timer);
  }
}
