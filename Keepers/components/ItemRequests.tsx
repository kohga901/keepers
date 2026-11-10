/**
 * File: ItemRequests.tsx
 * Description: Settings card for asking for an item to be added to the app. Shows a request form
 *              and the user's past requests with their status (pending, approved, rejected, or error).
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Text, TextInput } from './Text';
import { useAppTheme } from '../hooks/useAppTheme';
import {
  fetchMyItemRequests,
  submitItemRequest,
  type ItemRequest,
  type ItemRequestStatus,
} from '../services/serverApi';

const DANGER = '#C0392B';
const APPROVED = '#2E8B57';

const STATUS_DISPLAY: Record<ItemRequestStatus, { icon: 'checkmark-circle' | 'time-outline' | 'close-circle'; label: string }> = {
  approved: { icon: 'checkmark-circle', label: 'Added to Keepers' },
  pending: { icon: 'time-outline', label: 'Pending review' },
  rejected: { icon: 'close-circle', label: 'Not added' },
  // An approval that hit an error is still waiting on the admin, so it reads as pending to the user.
  error: { icon: 'time-outline', label: 'Pending review' },
};

const EMPTY_FORM = { name: '', image: '', listing: '', price: '', gender: '' };

export function ItemRequests() {
  const { theme } = useAppTheme();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [requests, setRequests] = useState<ItemRequest[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadRequests = useCallback(async () => {
    const result = await fetchMyItemRequests();
    setRequests(result.requests);
    setLoadError(result.error);
  }, []);

  useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

  const setField = (field: keyof typeof EMPTY_FORM) => (value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const handleSubmit = async () => {
    if (!form.name.trim() || !form.image.trim()) {
      setMessage({ ok: false, text: 'Add the item’s name and an image link.' });
      return;
    }

    setSending(true);
    setMessage(null);
    const error = await submitItemRequest({
      item_name: form.name.trim(),
      item_img: form.image.trim(),
      item_web_listing: form.listing.trim() || undefined,
      item_price: form.price.trim() || undefined,
      item_gender: form.gender.trim() || undefined,
    });
    setSending(false);

    if (error) {
      setMessage({ ok: false, text: error });
      return;
    }

    setForm(EMPTY_FORM);
    setOpen(false);
    setMessage({ ok: true, text: 'Request sent. It will show as pending until it’s reviewed.' });
    void loadRequests();
  };

  const inputStyle = [styles.input, { borderColor: theme.border, color: theme.text }];
  const statusColor = (status: ItemRequestStatus) =>
    status === 'approved' ? APPROVED : status === 'rejected' ? DANGER : theme.mutedText;

  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <Text style={[styles.title, { color: theme.text }]}>Request an Item</Text>
      <Text style={[styles.hint, { color: theme.mutedText }]}>
        Can’t find something? Send us a link and we’ll review it for the app.
      </Text>

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((prev) => !prev)}
        style={({ pressed }) => [styles.button, { backgroundColor: theme.primary, opacity: pressed ? 0.9 : 1 }]}
      >
        <Text style={styles.buttonText}>{open ? 'Cancel' : 'Request an item'}</Text>
      </Pressable>

      {open && (
        <View style={styles.form}>
          <TextInput
            autoCapitalize="words"
            maxLength={200}
            onChangeText={setField('name')}
            placeholder="Item name"
            placeholderTextColor={theme.mutedText}
            style={inputStyle}
            value={form.name}
          />
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            maxLength={2000}
            onChangeText={setField('image')}
            placeholder="Image link (https://…)"
            placeholderTextColor={theme.mutedText}
            style={inputStyle}
            value={form.image}
          />
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            maxLength={2000}
            onChangeText={setField('listing')}
            placeholder="Product page link (optional)"
            placeholderTextColor={theme.mutedText}
            style={inputStyle}
            value={form.listing}
          />
          <View style={styles.row}>
            <TextInput
              maxLength={50}
              onChangeText={setField('price')}
              placeholder="Price (optional)"
              placeholderTextColor={theme.mutedText}
              style={[inputStyle, styles.half]}
              value={form.price}
            />
            <TextInput
              autoCapitalize="none"
              maxLength={20}
              onChangeText={setField('gender')}
              placeholder="men / women / unisex"
              placeholderTextColor={theme.mutedText}
              style={[inputStyle, styles.half]}
              value={form.gender}
            />
          </View>
          <Pressable
            accessibilityRole="button"
            disabled={sending}
            onPress={() => void handleSubmit()}
            style={({ pressed }) => [styles.button, { backgroundColor: theme.primary, opacity: pressed || sending ? 0.8 : 1 }]}
          >
            {sending ? <ActivityIndicator color="#0F1418" /> : <Text style={styles.buttonText}>Send request</Text>}
          </Pressable>
        </View>
      )}

      {message && (
        <Text accessibilityLiveRegion="polite" style={[styles.hint, { color: message.ok ? APPROVED : DANGER }]}>
          {message.text}
        </Text>
      )}

      {requests.length > 0 && (
        <View style={styles.list}>
          <Text style={[styles.listTitle, { color: theme.text }]}>Your requests</Text>
          {requests.map((request) => {
            const display = STATUS_DISPLAY[request.status];
            return (
              <View key={request.id} style={[styles.requestRow, { borderColor: theme.border }]}>
                <Ionicons name={display.icon} size={24} color={statusColor(request.status)} />
                <View style={styles.requestText}>
                  <Text numberOfLines={1} style={[styles.requestName, { color: theme.text }]}>
                    {request.item_name}
                  </Text>
                  <Text style={[styles.hint, { color: statusColor(request.status) }]}>
                    {display.label}
                    {request.status === 'rejected' && request.admin_note ? ` — ${request.admin_note}` : ''}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      )}

      {loadError && <Text style={[styles.hint, { color: DANGER }]}>{loadError}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 18,
    gap: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 6,
  },
  hint: {
    fontSize: 12,
    fontWeight: '400',
  },
  button: {
    marginTop: 4,
    borderRadius: 12,
    minHeight: 46,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F1418',
  },
  form: {
    gap: 10,
    marginTop: 6,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 15,
  },
  row: {
    flexDirection: 'row',
    gap: 10,
  },
  half: {
    flex: 1,
  },
  list: {
    marginTop: 10,
    gap: 8,
  },
  listTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  requestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderTopWidth: 1,
    paddingTop: 10,
  },
  requestText: {
    flex: 1,
    gap: 2,
  },
  requestName: {
    fontSize: 15,
    fontWeight: '600',
  },
});
