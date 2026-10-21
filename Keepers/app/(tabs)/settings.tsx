/**
 * File: settings.tsx
 * Description: Currently a placeholder for the settings.
 * Author: Kai Markley
 * Date: 2026-04-01
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { Text } from '../../components/Text';
import type { User } from '@supabase/supabase-js';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { usePriceDisplay } from '../../contexts/PriceDisplayContext';
import { useTutorial } from '../../contexts/TutorialContext';
import { clearHistoryOnServer, type ClearHistoryScope } from '../../services/serverApi';
import { AiKeySettings } from '../../components/ai/AiKeySettings';
import { useAppTheme } from '../../hooks/useAppTheme';
import { supabase } from '../../utils/supabase';
import { PRICE_TIERS } from '../../utils/price';

const DANGER = '#C0392B';

const CLEAR_ACTIONS: Record<ClearHistoryScope, { title: string; message: string; confirm: string; done: string }> = {
  all: {
    title: 'Reset account?',
    message: 'This erases all your likes, dislikes, and your taste on the graph, so Keepers starts learning your style from scratch. Your account and settings stay. This can’t be undone.',
    confirm: 'Reset',
    done: 'Your account has been reset.',
  },
  liked: {
    title: 'Clear liked items?',
    message: 'This removes every item from your liked list and your taste on the graph. This can’t be undone.',
    confirm: 'Clear likes',
    done: 'Your liked items have been cleared.',
  },
  disliked: {
    title: 'Clear disliked items?',
    message: 'This removes every item from your disliked list. This can’t be undone.',
    confirm: 'Clear dislikes',
    done: 'Your disliked items have been cleared.',
  },
};

// Alert.alert does nothing on web, so the browser's own confirm dialog stands in there.
function confirmDestructive(title: string, message: string, confirm: string): Promise<boolean> {
  if (Platform.OS === 'web') {
    return Promise.resolve(window.confirm(`${title}

${message}`));
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: confirm, style: 'destructive', onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });
}

export default function Settings() {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(false);
  const { showPriceAsTier, setShowPriceAsTier } = usePriceDisplay();
  const [showRangeGuide, setShowRangeGuide] = useState(false);
  const { showTutorial } = useTutorial();
  const [showClearOptions, setShowClearOptions] = useState(false);
  const [clearing, setClearing] = useState<ClearHistoryScope | null>(null);
  const [clearStatus, setClearStatus] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    const loadUser = async () => {
      const { data, error } = await supabase.auth.getUser();
      if (error) {
        console.error('Failed to load user profile', error.message);
        return;
      }

      setUser(data.user ?? null);
    };

    loadUser();

    const { data: listener } = supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user ?? null);
    });

    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);

  const handleSignOut = async () => {
    setLoading(true);
    const { error } = await supabase.auth.signOut();
    if (error) {
      Alert.alert('Sign out failed', error.message);
    }
    setLoading(false);
  };

  const handleClear = async (scope: ClearHistoryScope) => {
    const action = CLEAR_ACTIONS[scope];
    if (!(await confirmDestructive(action.title, action.message, action.confirm))) return;

    setClearing(scope);
    setClearStatus(null);
    const error = await clearHistoryOnServer(scope);
    setClearing(null);
    setClearStatus(error ? { ok: false, message: error } : { ok: true, message: action.done });
  };

  return (
    <ScrollView
      contentContainerStyle={[
        styles.content,
        { paddingBottom: insets.bottom + 32, paddingTop: insets.top + 72 },
      ]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      style={[styles.container, { backgroundColor: theme.background }]}
    >
      <View
        style={[
          styles.card,
          {
            backgroundColor: theme.surface,
            borderColor: theme.border,
          },
        ]}
      >
        <Text style={[styles.title, { color: theme.text }]}>Account</Text>
        <Text style={[styles.label, { color: theme.mutedText }]}>Signed in as</Text>
        <Text style={[styles.value, { color: theme.text }]}>{user?.email ?? 'Unknown user'}</Text>

        <Pressable
          style={({ pressed }) => [
            styles.signOutButton,
            {
              backgroundColor: theme.primary,
              opacity: pressed || loading ? 0.9 : 1,
            },
          ]}
          onPress={handleSignOut}
          disabled={loading}
        >
          <Text style={styles.signOutText}>{loading ? 'Signing out...' : 'Sign out'}</Text>
        </Pressable>
      </View>

      <View
        style={[
          styles.card,
          {
            backgroundColor: theme.surface,
            borderColor: theme.border,
            marginTop: 16,
          },
        ]}
      >
        <Text style={[styles.title, { color: theme.text }]}>Pricing</Text>

        <View style={styles.settingRow}>
          <View style={styles.settingText}>
            <Text style={[styles.label, { color: theme.text }]}>Show prices as $ symbols</Text>
            <Text style={[styles.hint, { color: theme.mutedText }]}>
              Turn off to see exact prices instead.
            </Text>
          </View>
          <Switch value={showPriceAsTier} onValueChange={setShowPriceAsTier} />
        </View>

        <Pressable onPress={() => setShowRangeGuide((prev) => !prev)}>
          <Text style={[styles.guideToggle, { color: theme.primary }]}>
            {showRangeGuide ? 'Hide price range guide' : 'What do the $ symbols mean?'}
          </Text>
        </Pressable>

        {showRangeGuide && (
          <View style={styles.guideList}>
            {PRICE_TIERS.map((tier) => (
              <View key={tier.symbol} style={styles.guideRow}>
                <Text style={[styles.guideSymbol, { color: theme.primary }]}>{tier.symbol}</Text>
                <Text style={[styles.guideLabel, { color: theme.mutedText }]}>{tier.label}</Text>
              </View>
            ))}
          </View>
        )}
      </View>

      <View style={styles.section}>
        <AiKeySettings />
      </View>

      <View
        style={[
          styles.card,
          {
            backgroundColor: theme.surface,
            borderColor: theme.border,
            marginTop: 16,
          },
        ]}
      >
        <Text style={[styles.title, { color: theme.text }]}>Help</Text>
        <Text style={[styles.hint, { color: theme.mutedText }]}>
          Watch the walkthroughs again any time.
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => showTutorial('welcome')}
          style={({ pressed }) => [
            styles.signOutButton,
            { backgroundColor: theme.primary, opacity: pressed ? 0.9 : 1 },
          ]}
        >
          <Text style={styles.signOutText}>Replay app tutorial</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => showTutorial('history')}
          style={({ pressed }) => [
            styles.signOutButton,
            { backgroundColor: theme.primary, opacity: pressed ? 0.9 : 1 },
          ]}
        >
          <Text style={styles.signOutText}>Replay History tutorial</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => showTutorial('graph')}
          style={({ pressed }) => [
            styles.signOutButton,
            { backgroundColor: theme.primary, opacity: pressed ? 0.9 : 1 },
          ]}
        >
          <Text style={styles.signOutText}>Replay Graph tutorial</Text>
        </Pressable>
      </View>

      <View
        style={[
          styles.card,
          {
            backgroundColor: theme.surface,
            borderColor: theme.border,
            marginTop: 16,
          },
        ]}
      >
        <Text style={[styles.title, { color: theme.text }]}>History</Text>
        <Text style={[styles.hint, { color: theme.mutedText }]}>
          Start over by erasing your likes, dislikes, and your taste on the graph.
        </Text>
        <Pressable
          accessibilityRole="button"
          disabled={clearing !== null}
          onPress={() => void handleClear('all')}
          style={({ pressed }) => [
            styles.signOutButton,
            styles.dangerButton,
            { backgroundColor: DANGER, opacity: pressed || clearing !== null ? 0.8 : 1 },
          ]}
        >
          {clearing === 'all' ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.dangerText}>Reset account</Text>
          )}
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: showClearOptions }}
          onPress={() => setShowClearOptions((prev) => !prev)}
          style={styles.dropdownToggle}
        >
          <Text style={[styles.guideToggle, styles.dropdownLabel, { color: theme.primary }]}>
            Clear likes or dislikes only
          </Text>
          <Ionicons name={showClearOptions ? 'chevron-up' : 'chevron-down'} size={18} color={theme.primary} />
        </Pressable>

        {showClearOptions && (
          <View style={styles.dropdown}>
            {(['liked', 'disliked'] as const).map((scope) => (
              <Pressable
                key={scope}
                accessibilityRole="button"
                disabled={clearing !== null}
                onPress={() => void handleClear(scope)}
                style={({ pressed }) => [
                  styles.dropdownButton,
                  { borderColor: DANGER, opacity: pressed || clearing !== null ? 0.7 : 1 },
                ]}
              >
                {clearing === scope ? (
                  <ActivityIndicator color={DANGER} />
                ) : (
                  <Text style={[styles.dropdownButtonText, { color: DANGER }]}>
                    {scope === 'liked' ? 'Clear liked items' : 'Clear disliked items'}
                  </Text>
                )}
              </Pressable>
            ))}
          </View>
        )}

        {clearStatus && (
          <Text accessibilityLiveRegion="polite" style={[styles.hint, { color: clearStatus.ok ? theme.primary : DANGER }]}>
            {clearStatus.message}
          </Text>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 20,
  },
  section: {
    marginTop: 16,
  },
  card: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 18,
    gap: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 6,
  },
  label: {
    fontSize: 13,
    fontWeight: '500',
  },
  value: {
    fontSize: 16,
    fontWeight: '600',
  },
  signOutButton: {
    marginTop: 12,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
  },
  signOutText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F1418',
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
    gap: 12,
  },
  settingText: {
    flex: 1,
    gap: 2,
  },
  hint: {
    fontSize: 12,
    fontWeight: '400',
  },
  guideToggle: {
    marginTop: 14,
    fontSize: 14,
    fontWeight: '600',
  },
  guideList: {
    marginTop: 10,
    gap: 8,
  },
  guideRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 10,
  },
  guideSymbol: {
    fontSize: 15,
    fontWeight: '700',
    minWidth: 60,
  },
  guideLabel: {
    fontSize: 13,
    fontWeight: '500',
  },
  dangerButton: {
    minHeight: 46,
    justifyContent: 'center',
  },
  dangerText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  dropdownToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dropdownLabel: {
    marginTop: 0,
  },
  dropdown: {
    gap: 10,
  },
  dropdownButton: {
    borderWidth: 1.5,
    borderRadius: 12,
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dropdownButtonText: {
    fontSize: 15,
    fontWeight: '700',
  },
});
