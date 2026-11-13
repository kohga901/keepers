import React, { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Text, TextInput } from './Text';

import { useAppTheme } from '../hooks/useAppTheme';
import { TAB_CONTENT_MAX_WIDTH } from '../constants/layout';
import { Fonts } from '../constants/fonts';
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
          contentContainerStyle={[styles.scrollContent, Platform.OS === 'web' && styles.webContent]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.headerBlock}>
            <Ionicons name="shirt-outline" size={46} color={theme.primary} accessible={false} />
            <Text style={[styles.title, { color: theme.text }]}>K E E P E R S</Text>
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
                  opacity: pressed ? 0.92 : 1,
                },
              ]}
              disabled={loading}
              onPress={signUpWithEmail}
            >
              <Text style={[styles.secondaryButtonText, { color: theme.text }]}>Create account</Text>
            </Pressable>

          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  webContent: { maxWidth: TAB_CONTENT_MAX_WIDTH, width: '100%', alignSelf: 'center' },
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
    paddingVertical: 24,
    gap: 16,
  },
  headerBlock: {
    alignItems: 'center',
    gap: 4,
  },
  title: {
    fontFamily: Fonts.black,
    fontSize: 24,
    lineHeight: 32,
    textAlign: 'center',
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
    minHeight: 44,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
});
