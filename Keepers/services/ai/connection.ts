import { getProviderApiKeyForRequest } from './credentials';
import { AiLookupError } from './errors';
import { PROVIDER_DETAILS, type AiProvider } from './types';

const CONNECTION_TIMEOUT_MS = 15_000;

export type ConnectionTestResult =
  | { ok: true }
  | { ok: false; message: string };

function getConnectionRequest(provider: AiProvider, apiKey: string): {
  headers: Record<string, string>;
  url: string;
} {
  switch (provider) {
    case 'google':
      return {
        url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(PROVIDER_DETAILS.google.model)}`,
        headers: { 'x-goog-api-key': apiKey },
      };
    case 'openai':
      return {
        url: 'https://api.openai.com/v1/models',
        headers: { Authorization: `Bearer ${apiKey}` },
      };
    case 'anthropic':
      return {
        url: `https://api.anthropic.com/v1/models/${encodeURIComponent(PROVIDER_DETAILS.anthropic.model)}`,
        headers: {
          'anthropic-version': '2023-06-01',
          'x-api-key': apiKey,
        },
      };
  }
}

export async function testProviderConnection(provider: AiProvider): Promise<ConnectionTestResult> {
  const apiKey = await getProviderApiKeyForRequest(provider);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONNECTION_TIMEOUT_MS);

  try {
    const request = getConnectionRequest(provider, apiKey);
    const response = await fetch(request.url, {
      method: 'GET',
      headers: request.headers,
      redirect: 'error',
      signal: controller.signal,
    });

    if (response.ok) return { ok: true };
    if (response.status === 401 || response.status === 403) {
      return { ok: false, message: 'The provider rejected this API key.' };
    }
    if (response.status === 429) {
      return { ok: false, message: 'The key was recognized, but its project is rate-limited or out of quota.' };
    }
    if (response.status === 404) {
      return { ok: false, message: 'The selected model is not available for this API key.' };
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
