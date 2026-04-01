/**
 * File: stylewraps.tsx
 * Description: Currently a placeholder for the style wrap for the profile of the user4rc   .
 * Author: Kai Markley
 * Date: 2026-04-01
 */

import { StyleSheet, Text, View } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';

export default function stylewraps() {
  const { theme } = useAppTheme();

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <Text style={[styles.text, { color: theme.text }]}>Style Wrapped</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
  },
});
