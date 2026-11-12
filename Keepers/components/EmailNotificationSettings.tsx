import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, View } from 'react-native';
import { Text } from './Text';
import { useAppTheme } from '../hooks/useAppTheme';
import { getEmailNotificationsEnabled, setEmailNotificationsEnabled } from '../services/emailNotificationsService';

// Settings mounts this with the account ID as its key to isolate account changes.
export function EmailNotificationSettings() {
  const { theme } = useAppTheme();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState(false);
  const [saved, setSaved] = useState(false);
  const mounted = useRef(false);
  const pending = useRef(false);

  const load = () => getEmailNotificationsEnabled()
    .then(value => {
      if (mounted.current) setEnabled(value);
    })
    .catch(() => { if (mounted.current) setError(true); })
    .finally(() => { if (mounted.current) setBusy(false); });
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => { mounted.current = false; };
  }, []);

  const toggle = async (value: boolean) => {
    if (pending.current || enabled === null) return;
    pending.current = true;
    setBusy(true);
    setError(false);
    setSaved(false);
    try {
      await setEmailNotificationsEnabled(value);
      if (mounted.current) { setEnabled(value); setSaved(true); }
    } catch { if (mounted.current) setError(true); }
    finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  return <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
    <Text style={[styles.title, { color: theme.text }]}>Notifications</Text>
    <View style={styles.row}>
      <View style={styles.copy}>
        <Text style={[styles.label, { color: theme.text }]}>Price alert emails</Text>
        <Text style={[styles.hint, { color: theme.text }]}>Email me when an item reaches my target price. In-app alerts stay on.</Text>
      </View>
      {busy && <ActivityIndicator color={theme.text} accessibilityLabel="Updating email notification settings" />}
      <Switch value={enabled ?? false} disabled={busy || enabled === null}
        accessibilityLabel="Price alert emails" accessibilityState={{ busy }}
        onValueChange={value => void toggle(value)} />
    </View>
    {error && <Text accessibilityRole="alert" style={[styles.hint, { color: '#9B341C' }]}>
      {enabled === null ? 'Could not load your email preference.' : 'Could not confirm your email preference was saved.'} Check your connection and try again.
    </Text>}
    {error && enabled === null && <Pressable accessibilityRole="button" onPress={() => { setBusy(true); setError(false); void load(); }} style={styles.retry}>
      <Text style={{ color: theme.text }}>Try again</Text>
    </Pressable>}
    {saved && <Text accessibilityLiveRegion="polite" style={[styles.hint, { color: theme.text }]}>
      {enabled ? 'Price alert emails are on.' : 'Price alert emails are off.'}
    </Text>}
  </View>;
}
const styles = StyleSheet.create({
  card: { marginTop: 16, padding: 18, borderRadius: 16, borderWidth: 1, gap: 8 },
  title: { fontSize: 24, fontWeight: '700', marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 },
  copy: { flex: 1, gap: 4 },
  label: { fontSize: 13, fontWeight: '500' },
  hint: { fontSize: 12, lineHeight: 18 },
  retry: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
});
