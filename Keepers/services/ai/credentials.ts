import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { getDevelopmentProviderApiKey } from './developmentCredentials';
import { AiLookupError } from './errors';
import { aiProviderSchema, type AiProvider } from './types';

const KEYCHAIN_SERVICE = 'keepers.ai.credentials.v1';
const PROVIDER_STORAGE_KEY = 'keepers.ai.provider.v1';
const API_KEY_STORAGE_KEYS: Record<AiProvider, string> = {
  google: 'keepers.ai.google.api-key.v1',
  openai: 'keepers.ai.openai.api-key.v1',
  anthropic: 'keepers.ai.anthropic.api-key.v1',
};

const STORAGE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainService: KEYCHAIN_SERVICE,
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

async function ensureSecureStorage(): Promise<void> {
  if (Platform.OS === 'web' || !(await SecureStore.isAvailableAsync())) {
    throw new AiLookupError('not_supported');
  }
}

export async function getSelectedAiProvider(): Promise<AiProvider> {
  await ensureSecureStorage();
  const stored = await SecureStore.getItemAsync(PROVIDER_STORAGE_KEY, STORAGE_OPTIONS);
  const parsed = aiProviderSchema.safeParse(stored);
  return parsed.success ? parsed.data : 'google';
}

export async function setSelectedAiProvider(provider: AiProvider): Promise<void> {
  await ensureSecureStorage();
  await SecureStore.setItemAsync(PROVIDER_STORAGE_KEY, provider, STORAGE_OPTIONS);
}

export async function saveProviderApiKey(provider: AiProvider, apiKey: string): Promise<void> {
  await ensureSecureStorage();
  const normalized = apiKey.trim();

  if (normalized.length < 8 || normalized.length > 2048) {
    throw new Error('API key must be between 8 and 2048 characters.');
  }

  await SecureStore.setItemAsync(API_KEY_STORAGE_KEYS[provider], normalized, STORAGE_OPTIONS);
}

export async function deleteProviderApiKey(provider: AiProvider): Promise<void> {
  await ensureSecureStorage();
  await SecureStore.deleteItemAsync(API_KEY_STORAGE_KEYS[provider], STORAGE_OPTIONS);
}

export async function getProviderApiKeyForRequest(provider: AiProvider): Promise<string> {
  const developmentApiKey = getDevelopmentProviderApiKey(provider);
  if (developmentApiKey) return developmentApiKey;

  await ensureSecureStorage();
  const apiKey = await SecureStore.getItemAsync(API_KEY_STORAGE_KEYS[provider], STORAGE_OPTIONS);

  if (!apiKey) {
    throw new AiLookupError('missing_key');
  }

  return apiKey;
}

export async function getCredentialStatus(): Promise<Record<AiProvider, boolean>> {
  await ensureSecureStorage();
  const [googleKey, openAiKey, anthropicKey] = await Promise.all([
    SecureStore.getItemAsync(API_KEY_STORAGE_KEYS.google, STORAGE_OPTIONS),
    SecureStore.getItemAsync(API_KEY_STORAGE_KEYS.openai, STORAGE_OPTIONS),
    SecureStore.getItemAsync(API_KEY_STORAGE_KEYS.anthropic, STORAGE_OPTIONS),
  ]);

  return {
    google: Boolean(googleKey),
    openai: Boolean(openAiKey),
    anthropic: Boolean(anthropicKey),
  };
}
