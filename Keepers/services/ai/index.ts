import { Platform } from 'react-native';

import { getProviderApiKeyForRequest, getSelectedAiProvider } from './credentials';
import { AiLookupError, toAiLookupError } from './errors';
import { createAnthropicLookupProvider } from './providers/anthropic';
import { createGoogleLookupProvider } from './providers/google';
import { createOpenAiLookupProvider } from './providers/openai';
import { normalizedMaxResults } from './providers/shared';
import type {
  AiProvider,
  ImageLookupInput,
  ImageLookupProvider,
  ImageLookupResult,
} from './types';

export * from './connection';
export * from './credentials';
export * from './developmentCredentials';
export * from './errors';
export * from './types';

const lookupCache = new Map<string, ImageLookupResult>();
const inFlightLookups = new Map<string, Promise<ImageLookupResult>>();

function lookupCacheKey(provider: AiProvider, input: ImageLookupInput): string {
  return JSON.stringify([
    provider,
    input.imageUrl,
    input.itemHint?.trim().slice(0, 300) ?? '',
    input.maxResults,
  ]);
}

function readCachedLookup(key: string): ImageLookupResult | null {
  return lookupCache.get(key) ?? null;
}

function cacheLookup(key: string, result: ImageLookupResult): void {
  lookupCache.set(key, result);
}

function waitForLookup(
  lookup: Promise<ImageLookupResult>,
  signal?: AbortSignal,
): Promise<ImageLookupResult> {
  if (!signal) return lookup;
  if (signal.aborted) return Promise.reject(new AiLookupError('cancelled'));

  return new Promise((resolve, reject) => {
    const stopWaiting = () => {
      signal.removeEventListener('abort', stopWaiting);
      reject(new AiLookupError('cancelled'));
    };
    const cleanup = () => signal.removeEventListener('abort', stopWaiting);

    signal.addEventListener('abort', stopWaiting, { once: true });
    lookup.then(
      (result) => {
        cleanup();
        resolve(result);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}

function startBackgroundLookup(
  cacheKey: string,
  providerName: AiProvider,
  input: ImageLookupInput,
): Promise<ImageLookupResult> {
  const lookup = (async () => {
    try {
      const apiKey = await getProviderApiKeyForRequest(providerName);
      const provider = createProvider(providerName, apiKey);
      const result = await provider.lookup({ ...input, signal: undefined });
      cacheLookup(cacheKey, result);
      return result;
    } finally {
      inFlightLookups.delete(cacheKey);
    }
  })();

  inFlightLookups.set(cacheKey, lookup);
  return lookup;
}

function createProvider(provider: AiProvider, apiKey: string): ImageLookupProvider {
  switch (provider) {
    case 'google':
      return createGoogleLookupProvider(apiKey);
    case 'openai':
      return createOpenAiLookupProvider(apiKey);
    case 'anthropic':
      return createAnthropicLookupProvider(apiKey);
  }
}

function validateImageUrl(value: string): void {
  if (value.length > 2_048) {
    throw new AiLookupError('invalid_image');
  }

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:') {
      throw new AiLookupError('invalid_image');
    }
  } catch (error) {
    if (error instanceof AiLookupError) throw error;
    throw new AiLookupError('invalid_image');
  }
}

export async function lookupPurchasableItem(input: ImageLookupInput): Promise<ImageLookupResult> {
  if (Platform.OS === 'web') {
    throw new AiLookupError('not_supported');
  }

  try {
    if (input.signal?.aborted) throw new AiLookupError('cancelled');
    validateImageUrl(input.imageUrl);
    const providerName = await getSelectedAiProvider();
    if (input.signal?.aborted) throw new AiLookupError('cancelled');

    const normalizedInput = {
      ...input,
      maxResults: normalizedMaxResults(input),
    };
    const cacheKey = lookupCacheKey(providerName, normalizedInput);
    const cached = readCachedLookup(cacheKey);
    if (cached) {
      if (input.signal?.aborted) throw new AiLookupError('cancelled');
      return cached;
    }

    const lookup =
      inFlightLookups.get(cacheKey) ??
      startBackgroundLookup(cacheKey, providerName, normalizedInput);
    return await waitForLookup(lookup, input.signal);
  } catch (error) {
    throw toAiLookupError(error);
  }
}
