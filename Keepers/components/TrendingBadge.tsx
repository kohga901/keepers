/**
 * File: TrendingBadge.tsx
 * Description: "Most liked" pill shown on feed cards the server marks as trending (is_trending,
 *   see server/services/trending_service.py). Styled like the card's "Why this?" button. The server
 *   also sends how many likes the item has, but the badge deliberately doesn't show it.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Text } from './Text';

type Props = {
  // Where to put the badge, e.g. absolute top/left on a card.
  style?: StyleProp<ViewStyle>;
};

export function TrendingBadge({ style }: Props) {
  return (
    // Never blocks a swipe or a tap on the card underneath.
    <View pointerEvents="none" accessible accessibilityLabel="Most liked" style={[styles.badge, style]}>
      <Ionicons name="heart" size={16} color="#FF7A93" />
      <Text style={styles.label}>Most liked</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // Same bubble as the "Why this?" button (reasonButton in app/(tabs)/swiper.tsx).
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: 'rgba(26, 26, 26, 0.72)',
  },
  label: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
});
