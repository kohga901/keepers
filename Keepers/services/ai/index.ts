import { Platform } from 'react-native';

import { getProviderApiKeyForRequest, getSelectedAiProvider } from './credentials';
import { AiLookupError, toAiLookupError } from './errors';
import { createGoogleLookupProvider } from './providers/google';
import { createOpenAiLookupProvider } from './providers/openai';
import type { ImageLookupInput, ImageLookupProvider, ImageLookupResult } from './types';

export * from './connection';
export * from './credentials';
export * from './errors';
export * from './types';

function createProvider(provider: 'google' | 'openai', apiKey: string): ImageLookupProvider {
  return provider === 'google'
    ? createGoogleLookupProvider(apiKey)
    : createOpenAiLookupProvider(apiKey);
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
    validateImageUrl(input.imageUrl);
    const providerName = await getSelectedAiProvider();
    const apiKey = await getProviderApiKeyForRequest(providerName);
    const provider = createProvider(providerName, apiKey);
    return await provider.lookup(input);
  } catch (error) {
    throw toAiLookupError(error);
  }
}
