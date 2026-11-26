/**
 * File: ReasonSheet.tsx
 * Description: Bottom sheet opened by a feed card's "Why this?" button, explaining why the item was picked.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { Text } from './Text';
import { useAppTheme } from '../hooks/useAppTheme';
import type { Item } from '../models/Items';
import { reasonIcon } from '../utils/reason';

type ReasonSheetProps = {
  // The card being explained, or null when the sheet is closed.
  item: Item | null;
  onClose: () => void;
};

export function ReasonSheet({ item, onClose }: ReasonSheetProps) {
  const { theme } = useAppTheme();
  const reason = item?.reason;

  return (
    <Modal animationType="slide" transparent visible={!!reason} onRequestClose={onClose}>
      <Pressable accessibilityLabel="Close" onPress={onClose} style={styles.backdrop}>
        {/* Presses inside the sheet must not reach the backdrop and close it. */}
        <View onStartShouldSetResponder={() => true} style={[styles.sheet, { backgroundColor: theme.tabBg }]}>
          <View style={styles.header}>
            <Text style={[styles.title, { color: theme.text }]}>Why you&apos;re seeing this</Text>
            <Pressable accessibilityLabel="Close explanation" accessibilityRole="button" hitSlop={10} onPress={onClose}>
              <Ionicons name="close" size={24} color={theme.text} />
            </Pressable>
          </View>

          {reason && (
            <View style={styles.reasonRow}>
              <View style={[styles.iconCircle, { backgroundColor: theme.primary }]}>
                <Ionicons name={reasonIcon(reason.kind) as never} size={20} color="#FFFFFF" />
              </View>
              <Text style={[styles.reasonText, { color: theme.text }]}>{reason.text}</Text>
            </View>
          )}

          {reason?.likedItemImageUrl && (
            <View style={[styles.liked, { borderColor: theme.border }]}>
              <Image source={{ uri: reason.likedItemImageUrl }} style={styles.likedImage} contentFit="cover" />
              <View style={styles.likedText}>
                <Text style={[styles.likedLabel, { color: theme.mutedText }]}>YOU LIKED</Text>
                <Text numberOfLines={2} style={[styles.likedName, { color: theme.text }]}>
                  {reason.likedItemName}
                </Text>
              </View>
            </View>
          )}

          <Text style={[styles.footnote, { color: theme.mutedText }]}>
            Your likes and passes shape your feed. We also mix in a few new styles so it doesn&apos;t get repetitive.
          </Text>

          <Pressable accessibilityRole="button" onPress={onClose} style={[styles.done, { backgroundColor: theme.primary }]}>
            <Text style={styles.doneText}>Got it</Text>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { width: '100%', maxWidth: 560, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20, paddingBottom: 32, gap: 16 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 20, fontWeight: '700' },
  reasonRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconCircle: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  reasonText: { flex: 1, fontSize: 17, fontWeight: '600' },
  liked: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 12, padding: 10 },
  likedImage: { width: 56, height: 56, borderRadius: 8, backgroundColor: '#F0F0F0' },
  likedText: { flex: 1, gap: 2 },
  likedLabel: { fontSize: 12, fontWeight: '700' },
  likedName: { fontSize: 15, fontWeight: '600' },
  footnote: { fontSize: 13, lineHeight: 18 },
  done: { borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  doneText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
});
