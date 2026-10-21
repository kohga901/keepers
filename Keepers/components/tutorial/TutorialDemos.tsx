/**
 * File: TutorialDemos.tsx
 * Description: Looping animations for the first-run tutorial. Each demo acts out one part of the app
 *              (swiping, Find it, filters, the tab bar) on a miniature mock so new users see the gesture before trying it.
 * Author: Kai Markley
 * Date: 2026-10-20
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, { useEffect, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import { Text } from '../Text';

// The web build has no native animated module, so transforms run on the JS thread there.
const NATIVE = Platform.OS !== 'web';

const CARD_WIDTH = 150;
const CARD_HEIGHT = 200;

// Drives a 0 → 1 value over and over, with a pause at each end so the motion reads as a deliberate gesture.
function useLoop(duration: number, pause = 500) {
  const [progress] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(pause),
        Animated.timing(progress, {
          toValue: 1,
          duration,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: NATIVE,
        }),
        Animated.delay(pause),
        Animated.timing(progress, { toValue: 0, duration: 0, useNativeDriver: NATIVE }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [progress, duration, pause]);

  return progress;
}

function MockCard({ label = 'Linen Overshirt', price = '$$' }: { label?: string; price?: string }) {
  const { theme } = useAppTheme();
  return (
    <View style={styles.card}>
      <View style={[styles.cardImage, { backgroundColor: theme.border }]}>
        <Ionicons name="shirt" size={56} color={theme.primary} />
      </View>
      <View style={styles.cardInfo}>
        <Text numberOfLines={1} style={[styles.cardName, { color: theme.text }]}>{label}</Text>
        <Text style={[styles.cardPrice, { color: theme.accentBrown }]}>{price}</Text>
      </View>
    </View>
  );
}

function Stamp({ text, color, style }: { text: string; color: string; style?: Animated.WithAnimatedValue<StyleProp<ViewStyle>> }) {
  return (
    <Animated.View style={[styles.stamp, { backgroundColor: color }, style]}>
      <Text style={styles.stampText}>{text}</Text>
    </Animated.View>
  );
}

export function WelcomeDemo() {
  const { theme } = useAppTheme();
  const progress = useLoop(1400, 300);
  // Cards fan out from a single stack, then fold back together.
  const fan = progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 1, 0] });

  return (
    <View style={styles.stage}>
      {[-1, 1, 0].map((side) => (
        <Animated.View
          key={side}
          style={[
            styles.absolute,
            {
              transform: [
                { translateX: fan.interpolate({ inputRange: [0, 1], outputRange: [0, side * 46] }) },
                {
                  rotate: fan.interpolate({
                    inputRange: [0, 1],
                    outputRange: ['0deg', `${side * 12}deg`],
                  }),
                },
              ],
            },
          ]}
        >
          <MockCard label={side === 0 ? 'Your next keeper' : 'Something new'} />
        </Animated.View>
      ))}
      <Animated.View
        style={[
          styles.heartBadge,
          { backgroundColor: theme.accentGold, transform: [{ scale: fan.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1.15] }) }] },
        ]}
      >
        <Ionicons name="heart" size={22} color="#FFFFFF" />
      </Animated.View>
    </View>
  );
}

type SwipeDirection = 'right' | 'left' | 'up';

const SWIPE_CONFIG: Record<SwipeDirection, { x: number; y: number; rotate: string; stamp: string; color: string; icon: 'gesture-swipe-right' | 'gesture-swipe-left' | 'gesture-swipe-up' }> = {
  right: { x: 170, y: 10, rotate: '18deg', stamp: 'LIKE', color: 'green', icon: 'gesture-swipe-right' },
  left: { x: -170, y: 10, rotate: '-18deg', stamp: 'NOPE', color: 'red', icon: 'gesture-swipe-left' },
  up: { x: 0, y: -150, rotate: '0deg', stamp: 'GO TO ITEM', color: '#007AFF', icon: 'gesture-swipe-up' },
};

export function SwipeDemo({ direction }: { direction: SwipeDirection }) {
  const { theme } = useAppTheme();
  const config = SWIPE_CONFIG[direction];
  const progress = useLoop(1100);

  // The card follows the finger for most of the gesture, then flies off and fades.
  const translateX = progress.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0, config.x * 0.4, config.x] });
  const translateY = progress.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0, config.y * 0.4, config.y] });
  const rotate = progress.interpolate({ inputRange: [0, 1], outputRange: ['0deg', config.rotate] });
  const cardOpacity = progress.interpolate({ inputRange: [0, 0.75, 1], outputRange: [1, 1, 0] });
  const stampOpacity = progress.interpolate({ inputRange: [0, 0.15, 0.45], outputRange: [0, 0, 1] });
  const fingerOpacity = progress.interpolate({ inputRange: [0, 0.1, 0.7, 0.85], outputRange: [0, 1, 1, 0] });
  // The next card waiting underneath grows into place as the top one leaves.
  const nextScale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] });

  const stampPosition =
    direction === 'right' ? styles.stampLeft : direction === 'left' ? styles.stampRight : styles.stampBottom;

  return (
    <View style={styles.stage}>
      <Animated.View style={[styles.absolute, { transform: [{ scale: nextScale }] }]}>
        <MockCard label="Wool Cardigan" price="$$$" />
      </Animated.View>
      <Animated.View
        style={[
          styles.absolute,
          { opacity: cardOpacity, transform: [{ translateX }, { translateY }, { rotate }] },
        ]}
      >
        <MockCard />
        <Stamp text={config.stamp} color={config.color} style={[stampPosition, { opacity: stampOpacity }]} />
        <Animated.View style={[styles.finger, { opacity: fingerOpacity }]}>
          <MaterialCommunityIcons name="hand-pointing-up" size={44} color={theme.text} />
        </Animated.View>
      </Animated.View>
      <View style={[styles.gestureHint, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <MaterialCommunityIcons name={config.icon} size={22} color={theme.primary} />
      </View>
    </View>
  );
}

export function FindItDemo() {
  const { theme } = useAppTheme();
  const progress = useLoop(1800, 700);

  const fingerY = progress.interpolate({ inputRange: [0, 0.25, 0.35, 1], outputRange: [60, 0, 0, 0] });
  const fingerOpacity = progress.interpolate({ inputRange: [0, 0.1, 0.4, 0.5], outputRange: [0, 1, 1, 0] });
  const buttonScale = progress.interpolate({ inputRange: [0, 0.27, 0.32, 0.38, 1], outputRange: [1, 1, 0.88, 1, 1] });
  const sheetY = progress.interpolate({ inputRange: [0, 0.4, 0.6, 1], outputRange: [140, 140, 0, 0] });
  const sheetOpacity = progress.interpolate({ inputRange: [0, 0.4, 0.5, 1], outputRange: [0, 0, 1, 1] });

  return (
    <View style={styles.stage}>
      <View style={styles.absolute}>
        {/* Short name so the Find it button doesn't cover it on the small card. */}
        <MockCard label="Overshirt" />
        <Animated.View
          style={[styles.findButton, { backgroundColor: theme.text, transform: [{ scale: buttonScale }] }]}
        >
          <Ionicons name="search" color="#FFFFFF" size={13} />
          <Text style={styles.findButtonText}>Find it</Text>
        </Animated.View>
        <Animated.View
          style={[styles.findFinger, { opacity: fingerOpacity, transform: [{ translateY: fingerY }] }]}
        >
          <MaterialCommunityIcons name="hand-pointing-up" size={40} color={theme.text} />
        </Animated.View>
      </View>
      <Animated.View
        style={[
          styles.sheet,
          { backgroundColor: theme.surface, borderColor: theme.border, opacity: sheetOpacity, transform: [{ translateY: sheetY }] },
        ]}
      >
        <Text style={[styles.sheetTitle, { color: theme.text }]}>Where to buy</Text>
        {['Shop A', 'Shop B'].map((shop) => (
          <View key={shop} style={[styles.sheetRow, { borderColor: theme.border }]}>
            <Ionicons name="bag-handle" size={14} color={theme.primary} />
            <Text style={[styles.sheetRowText, { color: theme.text }]}>{shop}</Text>
            <Ionicons name="open-outline" size={13} color={theme.mutedText} />
          </View>
        ))}
      </Animated.View>
    </View>
  );
}

const DEMO_TAGS = ['Casual', 'Denim', 'Earth tones', 'Outerwear', 'Vintage', 'Minimal'];
const TAGS_TO_SELECT = [1, 4, 2];

export function FilterDemo() {
  const { theme } = useAppTheme();
  const [selectedCount, setSelectedCount] = useState(0);

  // Chips switch on one by one, then the selection clears and starts over.
  useEffect(() => {
    const timer = setInterval(() => {
      setSelectedCount((count) => (count >= TAGS_TO_SELECT.length + 1 ? 0 : count + 1));
    }, 800);
    return () => clearInterval(timer);
  }, []);

  const selected = new Set(TAGS_TO_SELECT.slice(0, selectedCount));

  return (
    <View style={styles.stage}>
      <View style={[styles.filterSheet, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <View style={styles.filterHeader}>
          <View style={[styles.filterButton, { backgroundColor: theme.tabBg, borderColor: theme.border }]}>
            <Ionicons name="filter" size={16} color={theme.tabActive} />
            {selected.size > 0 && (
              <View style={[styles.badge, { backgroundColor: theme.primary }]}>
                <Text style={styles.badgeText}>{selected.size}</Text>
              </View>
            )}
          </View>
          <Text style={[styles.sheetTitle, { color: theme.text }]}>Filter items</Text>
        </View>
        <View style={styles.chips}>
          {DEMO_TAGS.map((tag, index) => {
            const isOn = selected.has(index);
            return (
              <View
                key={tag}
                style={[styles.chip, { borderColor: theme.primary }, isOn && { backgroundColor: theme.primary }]}
              >
                <Text style={[styles.chipText, { color: isOn ? '#FFFFFF' : theme.primary }]}>{tag}</Text>
              </View>
            );
          })}
        </View>
      </View>
    </View>
  );
}

type TabIcon = React.ComponentProps<typeof Ionicons>['name'];

const TABS: { icon: TabIcon; activeIcon: TabIcon; name: string; blurb: string }[] = [
  { icon: 'heart-outline', activeIcon: 'heart', name: 'History', blurb: 'Every like and pass, in one list' },
  { icon: 'stats-chart-outline', activeIcon: 'stats-chart', name: 'Graph', blurb: 'A map of where your taste lives' },
  { icon: 'shirt-outline', activeIcon: 'shirt', name: 'Swiper', blurb: 'Where you discover new pieces' },
  { icon: 'receipt-outline', activeIcon: 'receipt', name: 'Style Wraps', blurb: 'A recap of your personal style' },
  { icon: 'settings-outline', activeIcon: 'settings', name: 'Settings', blurb: 'Prices, AI keys, and your account' },
];

const TAB_SLOT = 52;

export function TabsDemo() {
  const { theme } = useAppTheme();
  const [active, setActive] = useState(0);
  const [highlight] = useState(() => new Animated.Value(0));
  const [caption] = useState(() => new Animated.Value(1));

  useEffect(() => {
    const timer = setInterval(() => setActive((index) => (index + 1) % TABS.length), 1600);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    Animated.spring(highlight, { toValue: active * TAB_SLOT, useNativeDriver: NATIVE, speed: 18, bounciness: 6 }).start();
    caption.setValue(0);
    Animated.timing(caption, { toValue: 1, duration: 350, useNativeDriver: NATIVE }).start();
  }, [active, highlight, caption]);

  return (
    <View style={styles.stage}>
      <Animated.View
        style={[
          styles.tabCaption,
          {
            opacity: caption,
            transform: [{ translateY: caption.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }],
          },
        ]}
      >
        <Ionicons name={TABS[active].activeIcon} size={40} color={theme.primary} />
        <Text style={[styles.tabName, { color: theme.text }]}>{TABS[active].name}</Text>
        <Text style={[styles.tabBlurb, { color: theme.mutedText }]}>{TABS[active].blurb}</Text>
      </Animated.View>
      <View style={[styles.tabBar, { backgroundColor: theme.tabBarBg }]}>
        <Animated.View style={[styles.tabHighlight, { transform: [{ translateX: highlight }] }]} />
        {TABS.map((tab, index) => (
          <View key={tab.name} style={styles.tabSlot}>
            <Ionicons
              name={index === active ? tab.activeIcon : tab.icon}
              size={24}
              color={index === active ? theme.tabBarActive : theme.tabBarInactive}
            />
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stage: {
    height: 260,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  absolute: {
    position: 'absolute',
  },
  card: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E8E8E8',
    backgroundColor: 'white',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 3,
  },
  cardImage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardInfo: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2,
  },
  cardName: {
    fontSize: 13,
    fontWeight: '700',
  },
  cardPrice: {
    fontSize: 12,
    fontWeight: '700',
  },
  stamp: {
    position: 'absolute',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  stampLeft: {
    top: 14,
    left: 10,
    transform: [{ rotate: '-12deg' }],
  },
  stampRight: {
    top: 14,
    right: 10,
    transform: [{ rotate: '12deg' }],
  },
  stampBottom: {
    bottom: 56,
    alignSelf: 'center',
  },
  stampText: {
    color: 'white',
    fontSize: 15,
    fontWeight: '800',
  },
  finger: {
    position: 'absolute',
    bottom: 40,
    alignSelf: 'center',
  },
  gestureHint: {
    position: 'absolute',
    bottom: 4,
    right: 16,
    borderWidth: 1,
    borderRadius: 18,
    padding: 6,
  },
  heartBadge: {
    position: 'absolute',
    top: 18,
    right: '28%',
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  findButton: {
    position: 'absolute',
    right: 8,
    bottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 14,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  findButtonText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  findFinger: {
    position: 'absolute',
    right: 10,
    bottom: -30,
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 24,
    right: 24,
    borderWidth: 1,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 12,
    gap: 6,
  },
  sheetTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderTopWidth: 1,
    paddingTop: 6,
  },
  sheetRowText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
  },
  filterSheet: {
    width: '88%',
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 12,
  },
  filterHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  filterButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
  },
  tabCaption: {
    alignItems: 'center',
    gap: 4,
    marginBottom: 28,
    paddingHorizontal: 16,
  },
  tabName: {
    fontSize: 20,
    fontWeight: '800',
  },
  tabBlurb: {
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'center',
  },
  tabBar: {
    flexDirection: 'row',
    borderRadius: 26,
    padding: 4,
  },
  tabSlot: {
    width: TAB_SLOT,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabHighlight: {
    position: 'absolute',
    top: 4,
    left: 4,
    width: TAB_SLOT,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
});
