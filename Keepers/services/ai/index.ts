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

    const apiKey = await getProviderApiKeyForRequest(providerName);
    const provider = createProvider(providerName, apiKey);
    const result = await provider.lookup(normalizedInput);
    cacheLookup(cacheKey, result);
    return result;
  } catch (error) {
    throw toAiLookupError(error);
  }
}
