import { useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../components/Text';
import { usePriceAlerts } from '../contexts/PriceAlertsContext';
import { useAppTheme } from '../hooks/useAppTheme';
import { clearPriceNotifications, deletePriceAlert, markPriceNotificationsRead } from '../services/priceAlertsService';
import { formatAlertPrice } from '../utils/priceAlerts';

export default function PriceAlertsScreen() {
  const router = useRouter();
  const { theme } = useAppTheme();
  const { userId, alerts, notifications, unreadCount, loading, error, refresh } = usePriceAlerts();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function act(action: () => Promise<void>) {
    setBusy(true);
    setActionError(null);
    try { await action(); await refresh(); }
    catch (failure) { setActionError(failure instanceof Error ? failure.message : 'Please try again.'); }
    finally { setBusy(false); }
  }

  return <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={styles.page}
    refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void refresh()} tintColor={theme.text} />}>
    <Text style={[styles.heading, { color: theme.text }]}>Price alerts</Text>
    {(error || actionError) && <View style={styles.card}>
      <Text accessibilityRole="alert" style={{ color: '#9B341C' }}>{actionError || error}</Text>
      <Pressable onPress={() => void refresh()} accessibilityRole="button" style={styles.action}>
        <Text style={{ color: theme.text }}>Try again</Text>
      </Pressable>
    </View>}
    <View style={styles.notificationHeader}>
      <Text style={[styles.section, { color: theme.text }]}>Notifications ({unreadCount} unread)</Text>
      <View style={styles.notificationActions}>
      {unreadCount > 0 && <Pressable disabled={busy} onPress={() => void act(() => markPriceNotificationsRead(userId))}
        accessibilityRole="button" style={styles.action}>
        <Text style={{ color: theme.text }}>Mark all read</Text>
      </Pressable>}
      {notifications.length > 0 && <Pressable disabled={busy} onPress={() => void act(() => clearPriceNotifications(userId))}
        accessibilityRole="button" accessibilityLabel="Clear all notifications" style={styles.action}>
        <Text style={{ color: theme.text }}>Clear all</Text>
      </Pressable>}
      </View>
    </View>
    {loading && !notifications.length && <ActivityIndicator color={theme.text} />}
    {!loading && !error && !notifications.length && <Text style={{ color: theme.text }}>No notifications. Your active alerts will appear here when a target is reached.</Text>}
    {notifications.map(notification => <View key={notification.id}
      style={[styles.card, { backgroundColor: theme.surface, borderColor: notification.read_at ? theme.border : theme.text }]}>
      <Pressable disabled={busy} accessibilityRole="button" accessibilityLabel={`View ${notification.item_name} in Like List`}
        accessibilityHint="Opens the item details popup"
        onPress={() => router.navigate({ pathname: '/(tabs)/likelist', params: { itemId: String(notification.clothes_id) } })}
        style={styles.notificationLink}>
      <View style={styles.notificationTitle}>
        <Text style={[styles.itemName, { color: theme.text, flex: 1 }]}>{!notification.read_at ? 'New · ' : ''}{notification.item_name}</Text>
        <Ionicons name="chevron-forward" size={20} color={theme.text} />
      </View>
      <Text style={{ color: theme.text }}>{notification.direction === 'increase' ? 'Price increase' : notification.direction === 'decrease' ? 'Price decrease' : 'Price alert'}: reached {formatAlertPrice(notification.price)} — your target was {formatAlertPrice(notification.target_price)}.</Text>
      <Text style={{ color: theme.text, fontSize: 12 }}>{new Date(notification.created_at).toLocaleString()}</Text>
      </Pressable>
      <View style={styles.notificationActions}>
      {!notification.read_at && <Pressable disabled={busy} onPress={() => void act(() => markPriceNotificationsRead(userId, notification.id))}
        accessibilityRole="button" style={styles.action}><Text style={{ color: theme.text }}>Mark read</Text></Pressable>}
      <Pressable disabled={busy} onPress={() => void act(() => clearPriceNotifications(userId, notification.id))}
        accessibilityRole="button" accessibilityLabel={`Clear notification for ${notification.item_name}`} style={styles.action}>
        <Text style={{ color: theme.text }}>Clear</Text>
      </Pressable>
      </View>
    </View>)}
    {notifications.length === 50 && <Text style={{ color: theme.text }}>Showing your latest 50 notifications. “Mark all read” and “Clear all” include older notifications.</Text>}
    <Text style={[styles.section, { color: theme.text }]}>Watching ({alerts.length})</Text>
    {alerts.map(alert => <View key={alert.clothes_id} style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <Text style={[styles.itemName, { color: theme.text }]}>{alert.Clothing?.item_name ?? 'Clothing item'}</Text>
      <Text style={{ color: theme.text }}>Notify at {formatAlertPrice(alert.target_price)} or {alert.direction === 'increase' ? 'more' : 'less'}.</Text>
      <Text style={{ color: theme.text }}>Catalog price: {alert.Clothing?.item_price ?? 'Unavailable'}</Text>
      <Pressable disabled={busy} accessibilityRole="button" style={styles.action}
        onPress={() => void act(() => deletePriceAlert(userId, String(alert.clothes_id)))}>
        <Text style={{ color: theme.text }}>Remove alert</Text>
      </Pressable>
    </View>)}
  </ScrollView>;
}
const styles = StyleSheet.create({
  page: { padding: 20, paddingBottom: 48, gap: 14, maxWidth: 680, width: '100%', alignSelf: 'center' },
  heading: { fontSize: 26, fontWeight: '700' },
  section: { fontSize: 19, fontWeight: '700', flexShrink: 1 },
  notificationHeader: { marginTop: 12, gap: 4 },
  card: { padding: 16, gap: 10, borderRadius: 12, borderWidth: 1 },
  itemName: { fontSize: 17, fontWeight: '600' },
  notificationLink: { gap: 10, minHeight: 44 },
  notificationTitle: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  notificationActions: { flexDirection: 'row', gap: 24, flexWrap: 'wrap' },
  action: { minHeight: 44, paddingVertical: 12, alignSelf: 'flex-start' },
});
