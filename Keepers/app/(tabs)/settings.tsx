/**
 * File: settings.tsx
 * Description: Currently a placeholder for the settings.
 * Author: Kai Markley
 * Date: 2026-04-01
 */

import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import type { User } from '@supabase/supabase-js';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { usePriceDisplay } from '../../contexts/PriceDisplayContext';
import { AiKeySettings } from '../../components/ai/AiKeySettings';
import { useAppTheme } from '../../hooks/useAppTheme';
import { supabase } from '../../utils/supabase';
import { PRICE_TIERS } from '../../utils/price';

export default function Settings() {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(false);
  const { showPriceAsTier, setShowPriceAsTier } = usePriceDisplay();
  const [showRangeGuide, setShowRangeGuide] = useState(false);

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
});
