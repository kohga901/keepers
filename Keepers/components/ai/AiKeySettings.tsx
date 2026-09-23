import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import {
  deleteProviderApiKey,
  getCredentialStatus,
  getSelectedAiProvider,
  PROVIDER_DETAILS,
  saveProviderApiKey,
  setSelectedAiProvider,
  testProviderConnection,
  type AiProvider,
} from '../../services/ai';

type BusyAction = 'delete' | 'save' | 'test' | null;

export function AiKeySettings() {
  const { theme } = useAppTheme();
  const [provider, setProvider] = useState<AiProvider>('google');
  const [apiKey, setApiKey] = useState('');
  const [storedKeys, setStoredKeys] = useState<Record<AiProvider, boolean>>({
    google: false,
    openai: false,
    anthropic: false,
  });
  const [busyAction, setBusyAction] = useState<BusyAction>(null);

  const refresh = useCallback(async () => {
    if (Platform.OS === 'web') return;

    try {
      const [savedProvider, keyStatus] = await Promise.all([
        getSelectedAiProvider(),
        getCredentialStatus(),
      ]);
      setProvider(savedProvider);
      setStoredKeys(keyStatus);
    } catch {
      Alert.alert('Secure storage unavailable', 'Keepers could not access encrypted key storage.');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const selectProvider = async (nextProvider: AiProvider) => {
    if (busyAction || nextProvider === provider) return;

    const previousProvider = provider;
    setProvider(nextProvider);
    setApiKey('');
    try {
      await setSelectedAiProvider(nextProvider);
    } catch {
      setProvider(previousProvider);
      Alert.alert('Selection not saved', 'Keepers could not update the AI provider.');
    }
  };

  const saveKey = async () => {
    if (busyAction) return;
    const normalizedKey = apiKey.trim();
    if (!normalizedKey) {
      Alert.alert('Enter an API key', `Paste your ${PROVIDER_DETAILS[provider].keyLabel} first.`);
      return;
    }
    if (normalizedKey.length < 8 || normalizedKey.length > 2_048) {
      Alert.alert('Invalid key length', 'API keys must be between 8 and 2,048 characters.');
      return;
    }

    setBusyAction('save');
    try {
      await saveProviderApiKey(provider, normalizedKey);
      await setSelectedAiProvider(provider);
      setApiKey('');
      setStoredKeys((current) => ({ ...current, [provider]: true }));
      Alert.alert('Key saved', 'The key is stored in this device’s encrypted credential storage.');
    } catch {
      Alert.alert('Key not saved', 'Keepers could not update encrypted storage.');
    } finally {
      setBusyAction(null);
    }
  };

  const testKey = async () => {
    if (busyAction) return;
    if (!storedKeys[provider]) {
      Alert.alert('No saved key', `Save a ${PROVIDER_DETAILS[provider].keyLabel} before testing it.`);
      return;
    }

    setBusyAction('test');
    try {
      const result = await testProviderConnection(provider);
      Alert.alert(result.ok ? 'Connection successful' : 'Connection failed', result.ok
        ? `${PROVIDER_DETAILS[provider].label} accepted the saved key.`
        : result.message);
    } catch {
      Alert.alert('Connection failed', 'Keepers could not access the saved credential.');
    } finally {
      setBusyAction(null);
    }
  };

  const deleteKey = () => {
    if (busyAction || !storedKeys[provider]) return;

    Alert.alert(
      'Delete saved key?',
      `This removes the ${PROVIDER_DETAILS[provider].label} key from this device.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            setBusyAction('delete');
            void deleteProviderApiKey(provider)
              .then(() => {
                setApiKey('');
                setStoredKeys((current) => ({ ...current, [provider]: false }));
              })
              .catch(() => {
                Alert.alert('Key not deleted', 'Keepers could not update encrypted storage.');
              })
              .finally(() => setBusyAction(null));
          },
        },
      ],
    );
  };

  if (Platform.OS === 'web') {
    return (
      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Text style={[styles.title, { color: theme.text }]}>AI item lookup</Text>
        <Text style={[styles.body, { color: theme.mutedText }]}>
          API keys are disabled on the web build because a browser cannot protect them. Use the
          native iOS or Android app.
        </Text>
      </View>
    );
  }

  const isBusy = busyAction !== null;
  const hasSavedKey = storedKeys[provider];

  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <View style={styles.titleRow}>
        <Ionicons name="sparkles-outline" size={22} color={theme.primary} />
        <Text style={[styles.title, { color: theme.text }]}>AI item lookup</Text>
      </View>
      <Text style={[styles.body, { color: theme.mutedText }]}>
        Choose a provider and store your own key for image-based shopping searches.
      </Text>

      <View accessibilityRole="radiogroup" style={styles.providerRow}>
        {(Object.keys(PROVIDER_DETAILS) as AiProvider[]).map((value) => {
          const selected = value === provider;
          return (
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ checked: selected, disabled: isBusy }}
              disabled={isBusy}
              key={value}
              onPress={() => void selectProvider(value)}
              style={({ pressed }) => [
                styles.providerButton,
                {
                  backgroundColor: selected ? theme.primary : 'transparent',
                  borderColor: selected ? theme.primary : theme.border,
                  opacity: pressed ? 0.82 : 1,
                },
              ]}
            >
              <Text style={[styles.providerText, { color: selected ? '#0F1418' : theme.text }]}>
                {PROVIDER_DETAILS[value].label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={[styles.modelHint, { color: theme.mutedText }]}>
        Model: {PROVIDER_DETAILS[provider].model}
        {provider === 'anthropic'
          ? ' · Web search must be enabled in your Anthropic Console settings.'
          : ''}
      </Text>

      <View style={styles.statusRow}>
        <Ionicons
          name={hasSavedKey ? 'shield-checkmark' : 'shield-outline'}
          size={17}
          color={hasSavedKey ? theme.primary : theme.mutedText}
        />
        <Text style={[styles.statusText, { color: theme.mutedText }]}>
          {hasSavedKey ? 'A key is saved for this provider' : 'No key saved for this provider'}
        </Text>
      </View>

      <TextInput
        accessibilityLabel={PROVIDER_DETAILS[provider].keyLabel}
        autoCapitalize="none"
        autoComplete="off"
        autoCorrect={false}
        editable={!isBusy}
        onChangeText={setApiKey}
        placeholder={hasSavedKey ? 'Paste a replacement key' : PROVIDER_DETAILS[provider].keyLabel}
        placeholderTextColor={theme.mutedText}
        secureTextEntry
        spellCheck={false}
        style={[
          styles.input,
          {
            backgroundColor: theme.background,
            borderColor: theme.border,
            color: theme.text,
          },
        ]}
        textContentType="none"
        value={apiKey}
      />

      <View style={styles.actionRow}>
        <Pressable
          accessibilityRole="button"
          disabled={isBusy}
          onPress={() => void saveKey()}
          style={({ pressed }) => [
            styles.primaryButton,
            { backgroundColor: theme.primary, opacity: isBusy || pressed ? 0.65 : 1 },
          ]}
        >
          <Text style={styles.primaryButtonText}>
            {busyAction === 'save' ? 'Saving…' : hasSavedKey ? 'Replace key' : 'Save key'}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={isBusy || !hasSavedKey}
          onPress={() => void testKey()}
          style={({ pressed }) => [
            styles.secondaryButton,
            {
              borderColor: theme.border,
              opacity: isBusy || !hasSavedKey || pressed ? 0.5 : 1,
            },
          ]}
        >
          <Text style={[styles.secondaryButtonText, { color: theme.text }]}>
            {busyAction === 'test' ? 'Testing…' : 'Test'}
          </Text>
        </Pressable>
      </View>

      {hasSavedKey && (
        <Pressable
          accessibilityRole="button"
          disabled={isBusy}
          onPress={deleteKey}
          style={({ pressed }) => [styles.deleteButton, { opacity: isBusy || pressed ? 0.55 : 1 }]}
        >
          <Text style={styles.deleteText}>
            {busyAction === 'delete' ? 'Deleting…' : 'Delete saved key'}
          </Text>
        </Pressable>
      )}

      <View style={[styles.notice, { borderColor: theme.border }]}>
        <Ionicons name="information-circle-outline" size={19} color={theme.mutedText} />
        <Text style={[styles.noticeText, { color: theme.mutedText }]}>
          Your key stays in encrypted storage on this device and is sent only to the selected AI
          provider. Item images and search prompts are also sent to that provider. Use a dedicated,
          restricted key with spending limits. Never paste a shared or production key here.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 18,
    gap: 12,
  },
  titleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
  },
  body: {
    fontSize: 13,
    lineHeight: 19,
  },
  providerRow: {
    flexDirection: 'row',
    gap: 10,
  },
  providerButton: {
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 11,
  },
  providerText: {
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  statusRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 7,
  },
  modelHint: {
    fontSize: 11,
    lineHeight: 16,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '500',
  },
  input: {
    borderRadius: 10,
    borderWidth: 1,
    fontSize: 15,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  primaryButton: {
    alignItems: 'center',
    borderRadius: 10,
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  primaryButtonText: {
    color: '#0F1418',
    fontSize: 14,
    fontWeight: '700',
  },
  secondaryButton: {
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: 'center',
    minWidth: 82,
    paddingHorizontal: 14,
  },
  secondaryButtonText: {
    fontSize: 14,
    fontWeight: '700',
  },
  deleteButton: {
    alignSelf: 'flex-start',
    paddingVertical: 4,
  },
  deleteText: {
    color: '#E36D6D',
    fontSize: 13,
    fontWeight: '600',
  },
  notice: {
    alignItems: 'flex-start',
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 8,
    marginTop: 2,
    paddingTop: 12,
  },
  noticeText: {
    flex: 1,
    fontSize: 11,
    lineHeight: 16,
  },
});
