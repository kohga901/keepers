import { useRef, type ReactNode } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import Swipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import { Ionicons } from '@expo/vector-icons';
import { Text } from './Text';

export function SwipeToDeleteNotification({ children, disabled, onDelete, itemName }: {
  children: ReactNode;
  disabled: boolean;
  onDelete: () => Promise<void>;
  itemName: string;
}) {
  const swipeable = useRef<SwipeableMethods>(null);
  const deleting = useRef(false);

  async function remove() {
    if (disabled || deleting.current) return;
    deleting.current = true;
    try { await onDelete(); }
    finally {
      swipeable.current?.close();
      deleting.current = false;
    }
  }

  return <Swipeable ref={swipeable} enabled={!disabled} enableTrackpadTwoFingerGesture
    rightThreshold={72} dragOffsetFromRight={-24} dragOffsetFromLeft={24}
    overshootLeft={false} overshootRight={false}
    onSwipeableOpen={direction => { if (direction === 'left') void remove(); }}
    renderRightActions={() => <Pressable disabled={disabled} accessibilityRole="button"
      accessibilityLabel={`Delete notification for ${itemName}`} onPress={() => void remove()}
      style={({ pressed }) => [styles.deleteAction, { opacity: disabled || pressed ? 0.6 : 1 }]}>
      <Ionicons name="trash-outline" size={23} color="#FFFFFF" />
      <Text style={styles.deleteText}>Delete</Text>
    </Pressable>}>
    {children}
  </Swipeable>;
}

const styles = StyleSheet.create({
  deleteAction: { width: 96, minHeight: 44, backgroundColor: '#B33630', justifyContent: 'center', alignItems: 'center', gap: 6 },
  deleteText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
});
