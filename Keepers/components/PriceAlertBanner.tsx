import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, PanResponder, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePriceAlerts } from '../contexts/PriceAlertsContext';
import { useAppTheme } from '../hooks/useAppTheme';
import type { PriceNotification } from '../services/priceAlertsService';
import { formatAlertPrice } from '../utils/priceAlerts';
import { Text } from './Text';

const NATIVE_DRIVER = Platform.OS !== 'web';

export function PriceAlertBanner() {
  const { banner, dismissBanner } = usePriceAlerts();
  const router = useRouter();
  if (!banner) return null;
  return <Banner key={banner.id} notification={banner} onDismiss={dismissBanner} onOpen={() => {
    dismissBanner(banner.id);
    router.navigate({ pathname: '/(tabs)/likelist', params: { itemId: String(banner.clothes_id) } });
  }} />;
}

function Banner({ notification, onDismiss, onOpen }: {
  notification: PriceNotification; onDismiss: (id: string) => void; onOpen: () => void;
}) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [offset] = useState(() => new Animated.Value(-120));
  const [imageFailed, setImageFailed] = useState(false);
  const closing = useRef(false);
  const reducedMotion = useRef(false);
  const dismiss = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    if (reducedMotion.current) { onDismiss(notification.id); return; }
    Animated.timing(offset, { toValue: -120, duration: 160, useNativeDriver: NATIVE_DRIVER }).start(({ finished }) => {
      if (finished) onDismiss(notification.id);
    });
  }, [offset, onDismiss, notification.id]);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void Promise.all([AccessibilityInfo.isReduceMotionEnabled(), AccessibilityInfo.isScreenReaderEnabled()])
      .catch(() => [true, true])
      .then(([reduce, screenReader]) => {
        if (!active) return;
        reducedMotion.current = reduce;
        if (reduce) offset.setValue(0);
        else Animated.timing(offset, { toValue: 0, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: NATIVE_DRIVER }).start();
        if (!screenReader) timer = setTimeout(dismiss, 7000);
      });
    return () => { active = false; clearTimeout(timer); offset.stopAnimation(); };
  }, [offset, dismiss]);

  // PanResponder stores these handlers; it reads their refs only when a gesture occurs.
  // eslint-disable-next-line react-hooks/refs
  const pan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => gesture.dy < -8 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
    onPanResponderMove: (_, gesture) => offset.setValue(Math.min(0, gesture.dy)),
    onPanResponderRelease: (_, gesture) => {
      if (gesture.dy < -24 || gesture.vy < -0.5) dismiss();
      else Animated.spring(offset, { toValue: 0, useNativeDriver: NATIVE_DRIVER }).start();
    },
    onPanResponderTerminate: () => offset.setValue(0),
  }), [offset, dismiss]);

  const title = `${notification.direction === 'decrease' ? 'Price dropped to' : notification.direction === 'increase' ? 'Price went up to' : 'Target reached at'} ${formatAlertPrice(notification.price)}`;
  const imageUrl = !imageFailed && notification.item_img && /^https?:\/\//i.test(notification.item_img) ? notification.item_img : null;
  return <View pointerEvents="box-none" style={[styles.position, { top: insets.top + 8 }]}>
    <Animated.View {...pan.panHandlers} style={[styles.banner, { backgroundColor: theme.surface, borderColor: theme.border,
      opacity: offset.interpolate({ inputRange: [-120, 0], outputRange: [0, 1], extrapolate: 'clamp' }), transform: [{ translateY: offset }] }]}>
      <Pressable onPress={onOpen} accessibilityRole="button" accessibilityLabel={`${title}. ${notification.item_name}`}
        accessibilityHint="Opens this item in your history" style={({ pressed }) => [styles.open, { opacity: pressed ? 0.7 : 1 }]}>
        <View style={[styles.photo, { backgroundColor: theme.background }]}>
          <Ionicons name="shirt-outline" size={24} color={theme.text} />
          {imageUrl && <Image source={{ uri: imageUrl }} contentFit="cover" style={StyleSheet.absoluteFill} onError={() => setImageFailed(true)} accessible={false} />}
        </View>
        <View style={styles.copy} accessibilityLiveRegion="polite">
          <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
          <Text numberOfLines={2} style={[styles.item, { color: theme.text }]}>{notification.item_name}</Text>
        </View>
      </Pressable>
      <Pressable onPress={dismiss} accessibilityRole="button" accessibilityLabel="Dismiss price alert banner" style={styles.close}>
        <Ionicons name="close" size={18} color={theme.text} />
      </Pressable>
    </Animated.View>
  </View>;
}

const styles = StyleSheet.create({
  position: { position: 'absolute', left: 12, right: 12, zIndex: 1000, alignItems: 'center' },
  banner: { width: '100%', maxWidth: 480, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 18,
    elevation: 12, shadowColor: '#0c3b2e', shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.18, shadowRadius: 16 },
  open: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingLeft: 12 },
  photo: { width: 52, height: 52, borderRadius: 12, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, minWidth: 0, gap: 3 },
  title: { fontSize: 14, lineHeight: 20, fontWeight: '700' },
  item: { fontSize: 13, lineHeight: 18 },
  close: { width: 44, minHeight: 52, alignItems: 'center', justifyContent: 'center', alignSelf: 'stretch' },
});
