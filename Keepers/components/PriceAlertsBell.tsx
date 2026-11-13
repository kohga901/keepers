import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Text } from './Text';
import { usePriceAlerts } from '../contexts/PriceAlertsContext';

export function PriceAlertsBell({ color }: { color: string }) {
  const { unreadCount, error } = usePriceAlerts();
  return (
    <Pressable onPress={() => router.push('/price-alerts')} style={styles.button}
      accessibilityRole="button" accessibilityLabel={`Price alerts, ${unreadCount} unread${error ? ', could not refresh' : ''}`}>
      <Ionicons name="notifications-outline" size={24} color={color} />
      {(unreadCount > 0 || error) && <View style={styles.badge}>
        <Text style={styles.count}>{unreadCount > 0 ? (unreadCount > 99 ? '99+' : unreadCount) : '!'}</Text>
      </View>}
    </Pressable>
  );
}
const styles = StyleSheet.create({
  button: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: 1, right: 0, backgroundColor: '#9B341C', borderRadius: 12, minWidth: 19, paddingHorizontal: 4, alignItems: 'center' },
  count: { color: '#FFFFFF', fontSize: 11, fontWeight: '700', lineHeight: 19 },
});
