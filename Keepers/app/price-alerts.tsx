import { useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../components/Text';
import { usePriceAlerts } from '../contexts/PriceAlertsContext';
import { useAppTheme } from '../hooks/useAppTheme';
import { clearPriceNotifications, deletePriceAlert, markPriceNotificationsRead } from '../services/priceAlertsService';
import { formatAlertPrice, notificationTime } from '../utils/priceAlerts';

export default function PriceAlertsScreen() {
  const router = useRouter();
  const { theme } = useAppTheme();
  const { userId, alerts, notifications, unreadCount, loading, error, refresh } = usePriceAlerts();
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [section, setSection] = useState<'notifications' | 'watching'>('notifications');
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const visibleNotifications = filter === 'unread' ? notifications.filter(notification => !notification.read_at) : notifications;
  const ink = { color: theme.text };
  const secondary = { color: '#526B5C' };

  async function refreshManually() {
    setRefreshing(true);
    try { await refresh(); }
    finally { setRefreshing(false); }
  }

  async function act(action: () => Promise<void>) {
    setBusy(true);
    setActionError(null);
    try { await action(); await refresh(); }
    catch (failure) { setActionError(failure instanceof Error ? failure.message : 'Please try again.'); }
    finally { setBusy(false); }
  }

  return <View style={[styles.screen, { backgroundColor: theme.background }]}>
    <View accessibilityRole="tablist" accessibilityLabel="Price alert sections" style={[styles.tabs, { borderBottomColor: theme.border }]}>
      {(['notifications', 'watching'] as const).map(value => <Pressable key={value}
        accessibilityRole="tab" accessibilityState={{ selected: section === value }}
        onPress={() => setSection(value)}
        style={({ pressed }) => [styles.tab, { borderBottomColor: section === value ? theme.text : 'transparent', opacity: pressed ? 0.6 : 1 }]}>
        <Text style={[styles.tabText, section === value ? ink : secondary]}>{value === 'notifications' ? 'Notifications' : 'Watching'}</Text>
      </Pressable>)}
    </View>
    <ScrollView key={section} contentContainerStyle={styles.page}
    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refreshManually()} tintColor={theme.text} />}>
    {(error || actionError) && <View style={[styles.error, { borderColor: theme.border, backgroundColor: theme.surface }]}>
      <Text accessibilityRole="alert" style={styles.errorText}>{actionError || error}</Text>
      <Pressable onPress={() => void refresh()} accessibilityRole="button" style={styles.action}>
        <Text style={[styles.actionText, ink]}>Try again</Text>
      </Pressable>
    </View>}
    {section === 'notifications' ? <>
    {unreadCount > 0 && <View style={styles.sectionHeader}>
      <View style={[styles.count, { backgroundColor: theme.text }]}>
        <Text accessibilityLabel={`${unreadCount} unread notifications`} style={styles.countText}>{unreadCount}</Text>
      </View>
      <Pressable disabled={busy} onPress={() => void act(() => markPriceNotificationsRead(userId))}
        accessibilityRole="button" accessibilityLabel="Mark all notifications read" style={({ pressed }) => [styles.action, { opacity: busy || pressed ? 0.45 : 1 }]}>
        <Ionicons name="checkmark-done-outline" size={18} color={theme.text} />
        <Text style={[styles.actionText, ink]}>Read all</Text>
      </Pressable>
    </View>}
    <View style={[styles.feed, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <View style={[styles.toolbar, { borderBottomColor: theme.border }]}>
        <View accessibilityRole="tablist" style={styles.filters}>
          {(['all', 'unread'] as const).map(value => <Pressable key={value} accessibilityRole="tab"
            accessibilityState={{ selected: filter === value }} onPress={() => setFilter(value)}
            style={({ pressed }) => [styles.filter, filter === value && { backgroundColor: theme.text }, { opacity: pressed ? 0.7 : 1 }]}>
            <Text style={[styles.filterText, { color: filter === value ? '#FFFFFF' : theme.text }]}>{value === 'all' ? 'All' : 'Unread'}</Text>
          </Pressable>)}
        </View>
        {notifications.length > 0 && <Pressable disabled={busy} onPress={() => void act(() => clearPriceNotifications(userId))}
          accessibilityRole="button" accessibilityLabel="Clear all notifications" style={({ pressed }) => [styles.action, { opacity: busy || pressed ? 0.45 : 1 }]}>
          <Text style={[styles.actionText, secondary]}>Clear all</Text>
        </Pressable>}
      </View>
      {loading && !notifications.length && <View style={styles.empty}>
        <ActivityIndicator color={theme.text} accessibilityLabel="Loading notifications" />
        <Text style={[styles.emptyBody, secondary]}>Checking your price alerts…</Text>
      </View>}
      {!loading && !error && !visibleNotifications.length && <View style={styles.empty}>
        <View style={styles.emptyIcon}><Ionicons name={filter === 'unread' ? 'checkmark-done-outline' : 'notifications-outline'} size={30} color={theme.text} /></View>
        <Text style={[styles.emptyTitle, ink]}>{filter === 'unread'
          ? (unreadCount > 0 ? 'No unread updates in this view' : 'You’re all caught up')
          : 'Your next find starts here'}</Text>
        <Text style={[styles.emptyBody, secondary]}>{filter === 'unread'
          ? (unreadCount > 0 ? 'Older unread updates are outside your latest 50 notifications. Use Read all to mark them as read.' : 'New price updates will appear here.')
          : 'Set a target price on a liked item. We’ll let you know when it’s reached.'}</Text>
        {filter === 'all' && <Pressable accessibilityRole="button" onPress={() => router.navigate('/(tabs)/likelist')}
          style={({ pressed }) => [styles.emptyButton, { backgroundColor: theme.text, opacity: pressed ? 0.7 : 1 }]}>
          <Text style={styles.emptyButtonText}>Explore your likes</Text>
          <Ionicons name="arrow-forward" size={16} color="#FFFFFF" />
        </Pressable>}
      </View>}
      {visibleNotifications.map((notification, index) => {
        const unread = !notification.read_at;
        const increase = notification.direction === 'increase';
        const label = increase ? 'Price went up' : notification.direction === 'decrease' ? 'Price dropped' : 'Target reached';
        const accent = increase ? '#925014' : theme.text;
        return <View key={notification.id} style={[styles.notification, {
          backgroundColor: unread ? '#F0F6EF' : theme.surface,
          borderTopColor: theme.border, borderTopWidth: index > 0 ? StyleSheet.hairlineWidth : 0,
        }]}>
          <Pressable disabled={busy} accessibilityRole="button" accessibilityLabel={`View ${notification.item_name} in Like List`}
            accessibilityHint="Opens the item details popup"
            onPress={() => router.navigate({ pathname: '/(tabs)/likelist', params: { itemId: String(notification.clothes_id) } })}
            style={({ pressed }) => [styles.notificationLink, { opacity: busy || pressed ? 0.55 : 1 }]}>
            <View style={[styles.avatar, { backgroundColor: increase ? '#FAEBD9' : '#DFEBDE' }]}>
              <Ionicons name={increase ? 'trending-up' : notification.direction === 'decrease' ? 'trending-down' : 'pricetag-outline'} size={24} color={accent} />
              {unread && <View accessibilityLabel="Unread" style={[styles.unreadDot, { backgroundColor: theme.text }]} />}
            </View>
            <View style={styles.notificationContent}>
              <Text style={[styles.eventLabel, { color: accent }]}>{label}</Text>
              <Text numberOfLines={2} style={[styles.itemName, ink]}>{notification.item_name}</Text>
              <View style={styles.priceLine}>
                <Text style={[styles.price, ink]}>{formatAlertPrice(notification.price)}</Text>
                <Text style={[styles.target, secondary]}>Target {formatAlertPrice(notification.target_price)}</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={17} color="#526B5C" />
          </Pressable>
          <View style={styles.rowFooter}>
            <Text accessibilityLabel={new Date(notification.created_at).toLocaleString()} style={[styles.timestamp, secondary]}>{notificationTime(notification.created_at)}</Text>
            <View style={styles.rowActions}>
              {unread && <Pressable disabled={busy} onPress={() => void act(() => markPriceNotificationsRead(userId, notification.id))}
                accessibilityRole="button" accessibilityLabel={`Mark notification for ${notification.item_name} as read`}
                style={({ pressed }) => [styles.iconButton, { opacity: busy || pressed ? 0.4 : 1 }]}>
                <Ionicons name="checkmark-done-outline" size={19} color={theme.text} />
              </Pressable>}
              <Pressable disabled={busy} onPress={() => void act(() => clearPriceNotifications(userId, notification.id))}
                accessibilityRole="button" accessibilityLabel={`Clear notification for ${notification.item_name}`}
                style={({ pressed }) => [styles.iconButton, { opacity: busy || pressed ? 0.4 : 1 }]}>
                <Ionicons name="close-outline" size={20} color="#526B5C" />
              </Pressable>
            </View>
          </View>
        </View>;
      })}
    </View>
    {notifications.length === 50 && <Text style={[styles.footnote, secondary]}>Showing your latest 50 notifications. “Read all” and “Clear all” include older notifications.</Text>}
    </> : <>
    <View style={[styles.feed, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      {loading && !alerts.length && <View style={styles.empty}>
        <ActivityIndicator color={theme.text} accessibilityLabel="Loading watched items" />
      </View>}
      {!loading && !error && alerts.length === 0 && <View style={styles.watchingEmpty}>
        <Ionicons name="eye-outline" size={21} color="#526B5C" />
        <Text style={[styles.watchingEmptyText, secondary]}>Your active price alerts will live here.</Text>
      </View>}
      {alerts.map((alert, index) => <View key={alert.clothes_id} style={[styles.watchRow, { borderTopColor: theme.border, borderTopWidth: index > 0 ? StyleSheet.hairlineWidth : 0 }]}>
        <View style={styles.watchContent}>
          <Text style={[styles.itemName, ink]}>{alert.Clothing?.item_name ?? 'Clothing item'}</Text>
          <Text style={[styles.watchTarget, ink]}>{formatAlertPrice(alert.target_price)} <Text style={[styles.target, secondary]}>or {alert.direction === 'increase' ? 'more' : 'less'}</Text></Text>
          <Text style={[styles.target, secondary]}>Current price · {alert.Clothing?.item_price ?? 'Unavailable'}</Text>
        </View>
        <Pressable disabled={busy} accessibilityRole="button" accessibilityLabel={`Remove alert for ${alert.Clothing?.item_name ?? 'Clothing item'}`}
          style={({ pressed }) => [styles.iconButton, { opacity: busy || pressed ? 0.4 : 1 }]}
          onPress={() => void act(() => deletePriceAlert(userId, String(alert.clothes_id)))}>
          <Ionicons name="close-outline" size={21} color="#526B5C" />
        </Pressable>
      </View>)}
    </View>
    </>}
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  tabs: { flexDirection: 'row', marginTop: 8, maxWidth: 648, width: '100%', alignSelf: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
  tab: { flex: 1, minHeight: 52, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, borderBottomWidth: 3 },
  tabText: { fontSize: 14, fontWeight: '700' },
  page: { padding: 16, paddingBottom: 48, maxWidth: 680, width: '100%', alignSelf: 'center' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10, minHeight: 44 },
  count: { minWidth: 24, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 12, alignItems: 'center' },
  countText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  feed: { borderRadius: 20, borderWidth: 1, overflow: 'hidden' },
  toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, padding: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  filters: { flexDirection: 'row', gap: 4 },
  filter: { minHeight: 44, paddingHorizontal: 18, justifyContent: 'center', borderRadius: 24 },
  filterText: { fontSize: 13, fontWeight: '700' },
  action: { minHeight: 44, paddingHorizontal: 4, flexDirection: 'row', gap: 5, alignItems: 'center' },
  actionText: { fontSize: 12, fontWeight: '600' },
  notification: { paddingHorizontal: 16, paddingTop: 18, paddingBottom: 2 },
  notificationLink: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  avatar: { height: 46, width: 46, borderRadius: 23, justifyContent: 'center', alignItems: 'center', alignSelf: 'flex-start', marginTop: 2 },
  unreadDot: { position: 'absolute', top: -1, right: -1, width: 11, height: 11, borderRadius: 6, borderWidth: 2, borderColor: '#F0F6EF' },
  notificationContent: { flex: 1, minWidth: 0, gap: 4 },
  eventLabel: { fontSize: 12, lineHeight: 17, fontWeight: '600' },
  itemName: { fontSize: 15, lineHeight: 21, fontWeight: '700' },
  priceLine: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 10, rowGap: 2, marginTop: 2 },
  price: { fontSize: 21, lineHeight: 28, fontWeight: '700', fontVariant: ['tabular-nums'] },
  target: { fontSize: 12, lineHeight: 18 },
  rowFooter: { marginLeft: 58, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 44 },
  timestamp: { fontSize: 11, lineHeight: 16, flexShrink: 1 },
  rowActions: { flexDirection: 'row' },
  iconButton: { minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center', borderRadius: 22 },
  empty: { paddingHorizontal: 24, paddingVertical: 36, gap: 12, alignItems: 'center' },
  emptyIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#F0F6EF', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  emptyTitle: { fontSize: 18, lineHeight: 25, fontWeight: '700', textAlign: 'center' },
  emptyBody: { fontSize: 14, lineHeight: 22, maxWidth: 300, textAlign: 'center' },
  emptyButton: { minHeight: 44, paddingHorizontal: 18, borderRadius: 24, flexDirection: 'row', gap: 10, alignItems: 'center', marginTop: 6 },
  emptyButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  watchingCount: { fontSize: 12, fontWeight: '600' },
  watchRow: { padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  watchContent: { flex: 1, minWidth: 0, gap: 5 },
  watchTarget: { fontSize: 17, lineHeight: 24, fontWeight: '700', fontVariant: ['tabular-nums'] },
  watchingEmpty: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 20 },
  watchingEmptyText: { flex: 1, fontSize: 13, lineHeight: 20 },
  error: { padding: 16, borderWidth: 1, borderRadius: 16, marginBottom: 16 },
  errorText: { color: '#9B341C', fontSize: 14, lineHeight: 21 },
  footnote: { fontSize: 12, lineHeight: 18, marginTop: 12 },
});
