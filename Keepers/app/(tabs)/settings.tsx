/**
 * File: settings.tsx
 * Description: Currently a placeholder for the settings.
 * Author: Kai Markley
 * Date: 2026-04-01
 */

import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import type { User } from '@supabase/supabase-js';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppTheme } from '../../hooks/useAppTheme';
import { supabase } from '../../utils/supabase';

export default function Settings() {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(false);

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
    <View
      style={[
        styles.container,
        {
          backgroundColor: theme.background,
          paddingTop: insets.top + 72,
        },
      ]}
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 20,
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
});
