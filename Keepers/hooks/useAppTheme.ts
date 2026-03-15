import { useColorScheme } from 'react-native';

import { darkTheme, lightTheme } from '../constants/theme';

export function useAppTheme() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  return {
    isDark,
    theme: isDark ? darkTheme : lightTheme,
  };
}
