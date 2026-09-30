import type { AiProvider } from './types';

export function getDevelopmentProviderApiKey(provider: AiProvider): string | null {
  if (!__DEV__) return null;

  // Expo requires direct dot-notation references to inline client environment values.
  // Keep them behind the __DEV__ guard so release builds can eliminate this branch.
  let configuredApiKey: string | undefined;
  switch (provider) {
    case 'google':
      configuredApiKey = process.env.EXPO_PUBLIC_KEEPERS_GOOGLE_AI_API_KEY;
      break;
    case 'openai':
      configuredApiKey = process.env.EXPO_PUBLIC_KEEPERS_OPENAI_API_KEY;
      break;
    case 'anthropic':
      configuredApiKey = process.env.EXPO_PUBLIC_KEEPERS_ANTHROPIC_API_KEY;
      break;
  }

  const apiKey = configuredApiKey?.trim();
  return apiKey && apiKey.length >= 8 && apiKey.length <= 2_048 ? apiKey : null;
}

export function getDevelopmentCredentialStatus(): Record<AiProvider, boolean> {
  return {
    google: getDevelopmentProviderApiKey('google') !== null,
    openai: getDevelopmentProviderApiKey('openai') !== null,
    anthropic: getDevelopmentProviderApiKey('anthropic') !== null,
  };
}
