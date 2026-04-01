import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { lightTheme } from '../constants/theme';
import { View } from 'react-native';

export function useAppTheme() {
  return {
    isDark: false,
    theme: lightTheme,
  };
}

export default function RootLayout() {
  const { theme } = useAppTheme();

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Stack>
        <Stack.Screen
          name="(tabs)"
          options={{
            headerShown: true,
            title: 'K E E P E R S',
            headerTintColor: theme.headerText,
            
          }}
        />
      </Stack>
      <StatusBar style="dark" />
    </View>
  );
}