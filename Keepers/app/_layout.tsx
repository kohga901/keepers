/**
 * File: _layout.tsx
 * Description: Defines the layout for the tab navigator in the Keepers app, including the header and theme.
 * Author: Kai Markley & Gabriel Min
 * Date: 2026-04-01
 */

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { lightTheme } from '../constants/theme';
import { View, ActivityIndicator } from 'react-native';

import { useFonts } from 'expo-font';


export function useAppTheme() {
  return {
    isDark: false,
    theme: lightTheme,
  };
}


export default function RootLayout() {
  const [loaded] = useFonts({
    GeorgiaProBlack: require('../assets/fonts/GeorgiaPro-Black.ttf'),
  });
  const { theme } = useAppTheme();

  if (!loaded) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        
      </View>
    );
  }
  return (
    <View style={{ flex: 1, backgroundColor: lightTheme.background }}>
      <Stack>
        <Stack.Screen
          name="(tabs)"
          options={{
            headerShown: true,
            headerTransparent: true,
            title: 'K E E P E R S',
            headerTintColor: lightTheme.headerText,
            headerShadowVisible: true,
            headerStyle: {
              backgroundColor: lightTheme.headerBg,
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