import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Text, TextInput } from './Text';
import { usePriceAlerts } from '../contexts/PriceAlertsContext';
import { savePriceAlert, deletePriceAlert } from '../services/priceAlertsService';
import { formatAlertPrice, parseAlertPrice, validateAlertTarget } from '../utils/priceAlerts';
import { useAppTheme } from '../hooks/useAppTheme';

export function PriceAlertEditor({ itemId, price }: { itemId: string; price: string }) {
  const { theme } = useAppTheme();
  const { userId, alerts, loading, error: loadError, refresh } = usePriceAlerts();
  const existing = alerts.find(alert => String(alert.clothes_id) === itemId);
  const [draft, setDraft] = useState<string | null>(null);
  const target = draft ?? (existing ? String(existing.target_price) : '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = parseAlertPrice(price);

  const submit = async (remove: boolean) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (remove) await deletePriceAlert(userId, itemId);
      else await savePriceAlert(itemId, validateAlertTarget(target, price));
      setMessage(remove ? 'Price alert removed.' : 'Alert saved. Check the bell for price updates.');
      await refresh();
      setDraft(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Your price alert could not be saved.');
    } finally { setBusy(false); }
  };

  return <View style={[styles.panel, { backgroundColor: theme.surface }]}>
    <Text style={[styles.title, { color: theme.text }]}>Price alert</Text>
    {current === null && <Text style={{ color: theme.text }}>This item needs a supported USD price before you can set an alert.</Text>}
    {existing && <Text style={{ color: theme.text }}>Watching for {formatAlertPrice(existing.target_price)} or {existing.direction === 'increase' ? 'more' : 'less'}.</Text>}
    <Text style={{ color: theme.text }}>Choose a target above or below the current catalog price for an alert</Text>
    <Text style={{ color: theme.text }}>Target price (USD)</Text>
    <TextInput value={target} onChangeText={setDraft} placeholder="e.g. 25.00"
      placeholderTextColor={theme.mutedText} keyboardType="decimal-pad" maxLength={16}
      editable={!busy && current !== null} accessibilityLabel="Target price in US dollars"
      style={[styles.input, { color: theme.text, borderColor: theme.border }]} />
    <Pressable onPress={() => void submit(false)} disabled={busy || loading || !!loadError || current === null}
      accessibilityRole="button" style={[styles.button, { backgroundColor: theme.text, opacity: busy || loading || !!loadError || current === null ? 0.5 : 1 }]}>
      {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.buttonText}>{existing ? 'Update alert' : 'Set price alert'}</Text>}
    </Pressable>
    {existing && <Pressable onPress={() => void submit(true)} disabled={busy} accessibilityRole="button" style={styles.remove}>
      <Text style={{ color: theme.text }}>Remove alert</Text>
    </Pressable>}
    {(error || loadError) && <Text accessibilityRole="alert" style={{ color: '#9B341C' }}>{error || loadError}</Text>}
    {message && <Text accessibilityLiveRegion="polite" style={{ color: theme.text }}>{message}</Text>}
  </View>;
}
const styles = StyleSheet.create({
  panel: { padding: 16, gap: 10, borderRadius: 12, width: '100%', marginTop: 12 },
  title: { fontSize: 18, fontWeight: '700' },
  input: { borderWidth: 1, borderRadius: 8, padding: 12, minHeight: 44 },
  button: { padding: 12, minHeight: 44, borderRadius: 8, alignItems: 'center' },
  buttonText: { color: '#FFFFFF', fontWeight: '600' },
  remove: { padding: 10, minHeight: 44, alignItems: 'center' },
});
