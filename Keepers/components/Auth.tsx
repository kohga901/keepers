import React, { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useAppTheme } from '../hooks/useAppTheme';
import { supabase } from '../utils/supabase';

export default function Auth() {
  const { theme } = useAppTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function signInWithEmail() {
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      Alert.alert('Sign in failed', error.message);
    }
    setLoading(false);
  }

  async function signUpWithEmail() {
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
    });

    if (error) {
      Alert.alert('Sign up failed', error.message);
    } else {
      //Alert.alert('Check your inbox', 'Confirm your email to complete sign up.');
    }
    setLoading(false);
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
      <KeyboardAvoidingView
        style={styles.keyboardAvoidingView}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.headerBlock, { borderColor: theme.border }]}> 
            <Text style={[styles.title, { color: theme.text }]}>Welcome Back</Text>
            <Text style={[styles.subtitle, { color: theme.mutedText }]}>Sign in to keep swiping your style picks.</Text>
          </View>

          <View
            style={[
              styles.card,
              {
                backgroundColor: theme.surface,
                borderColor: theme.border,
              },
            ]}
          >
            <View style={styles.fieldBlock}>
              <Text style={[styles.fieldLabel, { color: theme.text }]}>Email</Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: theme.tabBg,
                    borderColor: theme.border,
                    color: theme.text,
                  },
                ]}
                onChangeText={setEmail}
                value={email}
                placeholder="email@address.com"
                placeholderTextColor={theme.mutedText}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                textContentType="emailAddress"
              />
            </View>

            <View style={styles.fieldBlock}>
              <Text style={[styles.fieldLabel, { color: theme.text }]}>Password</Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: theme.tabBg,
                    borderColor: theme.border,
                    color: theme.text,
                  },
                ]}
                onChangeText={setPassword}
                value={password}
                secureTextEntry
                placeholder="Password"
                placeholderTextColor={theme.mutedText}
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="password"
              />
            </View>

            <Pressable
              style={({ pressed }) => [
                styles.primaryButton,
                {
                  backgroundColor: loading ? theme.tabInactive : theme.primary,
                  opacity: pressed ? 0.92 : 1,
                },
              ]}
              disabled={loading}
              onPress={signInWithEmail}
            >
              <Text style={styles.primaryButtonText}>{loading ? 'Signing in...' : 'Sign in'}</Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [
                styles.secondaryButton,
                {
                  borderColor: theme.border,
                  opacity: pressed ? 0.92 : 1,
                },
              ]}
              disabled={loading}
              onPress={signUpWithEmail}
            >
              <Text style={[styles.secondaryButtonText, { color: theme.mutedText }]}>Create account</Text>
            </Pressable>

            <Text style={[styles.helperText, { color: theme.mutedText }]}>Use the same credentials you registered with in Supabase.</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  keyboardAvoidingView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 28,
    gap: 18,
  },
  headerBlock: {
    gap: 8,
  },
  title: {
    fontSize: 34,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
  },
  card: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 18,
    gap: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 2,
  },
  fieldBlock: {
    gap: 6,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 15,
  },
  primaryButton: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 6,
  },
  primaryButtonText: {
    color: '#0F1418',
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryButton: {
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
  helperText: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
});