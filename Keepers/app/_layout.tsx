/**
 * File: _layout.tsx
 * Description: Defines the layout for the tab navigator in the Keepers app, including the header and theme.
 * Author: Kai Markley & Gabriel Min
 * Date: 2026-04-01
 */

import { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View, ActivityIndicator } from 'react-native';
import type { Session } from '@supabase/supabase-js';

import { useFonts } from 'expo-font';
import Auth from '../components/Auth';
import { useAppTheme } from '../hooks/useAppTheme';
import { supabase } from '../utils/supabase';


export default function RootLayout() {
  const [loaded] = useFonts({
    GeorgiaProBlack: require('../assets/fonts/GeorgiaPro-Black.ttf'),
    GeorgiaProBlackItalic: require('../assets/fonts/GeorgiaPro-BlackItalic.ttf'),
    GeorgiaProBold: require('../assets/fonts/GeorgiaPro-Bold.ttf'),
    GeorgiaProBoldItalic: require('../assets/fonts/GeorgiaPro-BoldItalic.ttf'),
    GeorgiaProItalic: require('../assets/fonts/GeorgiaPro-Italic.ttf'),
    GeorgiaProLight: require('../assets/fonts/GeorgiaPro-Light.ttf'),
    GeorgiaProLightItalic: require('../assets/fonts/GeorgiaPro-LightItalic.ttf'),
    GeorgiaProRegular: require('../assets/fonts/GeorgiaPro-Regular.ttf'),
    GeorgiaProSemiBold: require('../assets/fonts/GeorgiaPro-SemiBold.ttf'),
    GeorgiaProSemiBoldItalic: require('../assets/fonts/GeorgiaPro-SemiBoldItalic.ttf'),
  });
  const [session, setSession] = useState<Session | null>(null);
  const [isSessionLoading, setIsSessionLoading] = useState(true);
  const { theme } = useAppTheme();

  useEffect(() => {
    let isMounted = true;

    const fetchSession = async () => {
      const { data, error } = await supabase.auth.getSession();
      if (error) {
        console.error('Failed to restore auth session', error.message);
      }

      if (isMounted) {
        setSession(data.session ?? null);
        setIsSessionLoading(false);
      }
    };

    fetchSession();

    const { data: authListener } = supabase.auth.onAuthStateChange((_, nextSession) => {
      setSession(nextSession);
      setIsSessionLoading(false);
    });

    return () => {
      isMounted = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  if (!loaded || isSessionLoading) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: theme.background,
        }}
      >
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    );
  }

  if (!session) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background }}>
        <Auth />
        <StatusBar style="dark" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Stack>
        <Stack.Screen
          name="(tabs)"
          options={{
            headerShown: true,
            headerTransparent: true,
            title: 'K E E P E R S',
            headerTintColor: theme.headerText,
            headerShadowVisible: true,
            headerStyle: {
              backgroundColor: theme.headerBg,
            },
            headerTitleStyle: {
              fontFamily: 'GeorgiaProBlack', // Font is now global
              fontSize: 24,            
            },
          }}
        />
      </Stack>
      <StatusBar style="dark" />
    </View>
  );
}