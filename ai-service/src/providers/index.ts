import { config } from '../config.ts';
import type { ProviderName } from '../domain/lookup.ts';
import { createGoogleProvider } from './google.ts';
import { createOpenAIProvider } from './openai.ts';
import {
  ProviderConfigurationError,
  type ImageLookupProvider,
} from './types.ts';

export function getProvider(name: ProviderName): ImageLookupProvider {
  if (name === 'google') {
    if (!config.google.apiKey) {
      throw new ProviderConfigurationError(
        'Google is not configured. Set GOOGLE_GENERATIVE_AI_API_KEY in ai-service/.env.',
      );
    }

    return createGoogleProvider(config.google.apiKey, config.google.model);
  }

  if (!config.openai.apiKey) {
    throw new ProviderConfigurationError(
      'OpenAI is not configured. Set OPENAI_API_KEY in ai-service/.env.',
    );
  }

  return createOpenAIProvider(config.openai.apiKey, config.openai.model);
}

export function getProviderStatus() {
  return {
    google: {
      configured: Boolean(config.google.apiKey),
      model: config.google.model,
    },
    openai: {
      configured: Boolean(config.openai.apiKey),
      model: config.openai.model,
    },
  };
}
