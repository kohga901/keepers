import { useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../components/Text';
import { usePriceAlerts } from '../contexts/PriceAlertsContext';
import { useAppTheme } from '../hooks/useAppTheme';
import { deletePriceAlert, markPriceNotificationsRead } from '../services/priceAlertsService';
import { formatAlertPrice } from '../utils/priceAlerts';

export default function PriceAlertsScreen() {
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
    <View style={styles.row}>
      <Text style={[styles.section, { color: theme.text }]}>Notifications ({unreadCount} unread)</Text>
      {unreadCount > 0 && <Pressable disabled={busy} onPress={() => void act(() => markPriceNotificationsRead(userId))}
        accessibilityRole="button" style={styles.action}>
        <Text style={{ color: theme.text }}>Mark all read</Text>
      </Pressable>}
    </View>
    {loading && !notifications.length && <ActivityIndicator color={theme.text} />}
    {!loading && !error && !notifications.length && <Text style={{ color: theme.text }}>No price alerts yet. Open a liked item in History to set your first target.</Text>}
    {notifications.map(notification => <View key={notification.id}
      style={[styles.card, { backgroundColor: theme.surface, borderColor: notification.read_at ? theme.border : theme.text }]}>
      <Text style={[styles.itemName, { color: theme.text }]}>{!notification.read_at ? 'New · ' : ''}{notification.item_name}</Text>
      <Text style={{ color: theme.text }}>Reached {formatAlertPrice(notification.price)} — your target was {formatAlertPrice(notification.target_price)}.</Text>
      <Text style={{ color: theme.text, fontSize: 12 }}>{new Date(notification.created_at).toLocaleString()}</Text>
      {!notification.read_at && <Pressable disabled={busy} onPress={() => void act(() => markPriceNotificationsRead(userId, notification.id))}
        accessibilityRole="button" style={styles.action}><Text style={{ color: theme.text }}>Mark read</Text></Pressable>}
    </View>)}
    {notifications.length === 50 && <Text style={{ color: theme.text }}>Showing your latest 50 notifications. “Mark all read” includes older notifications.</Text>}
    <Text style={[styles.section, { color: theme.text }]}>Watching ({alerts.length})</Text>
    {alerts.map(alert => <View key={alert.clothes_id} style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <Text style={[styles.itemName, { color: theme.text }]}>{alert.Clothing?.item_name ?? 'Clothing item'}</Text>
      <Text style={{ color: theme.text }}>Notify at {formatAlertPrice(alert.target_price)} or less.</Text>
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
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', marginTop: 12 },
  card: { padding: 16, gap: 10, borderRadius: 12, borderWidth: 1 },
  itemName: { fontSize: 17, fontWeight: '600' },
  action: { minHeight: 44, paddingVertical: 12, alignSelf: 'flex-start' },
});
