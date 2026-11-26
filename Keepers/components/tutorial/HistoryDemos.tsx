/**
 * File: HistoryDemos.tsx
 * Description: Looping animations for the History tab tutorial, acted out on miniature copies of the
 *              liked grid's cards: the Liked/Disliked toggle with counts, opening an item, removing it
 *              with the corner button, and the hiding header.
 * Author: Kai Markley
 * Date: 2026-10-20
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import { Text } from '../Text';
import { NATIVE, useLoop } from './TutorialDemos';

const CARD_WIDTH = 104;
const CARD_IMAGE_HEIGHT = 80;
const CARD_HEIGHT = 118;
const GRID_GAP = 10;
const GRID_WIDTH = CARD_WIDTH * 2 + GRID_GAP;
const TOGGLE_OPTION_WIDTH = 104;
const LIKED_COUNT = 12;
const DISLIKED_COUNT = 4;

type CardItem = { name: string; price: string; gender: string; icon: React.ComponentProps<typeof Ionicons>['name'] };

const LIKED_CARDS: CardItem[] = [
  { name: 'Linen Overshirt', price: '$$', gender: 'MEN', icon: 'shirt' },
  { name: 'Wool Cardigan', price: '$$$', gender: 'WOMEN', icon: 'shirt-outline' },
  { name: 'Canvas Tote', price: '$', gender: 'UNISEX', icon: 'bag-handle' },
  { name: 'Denim Jacket', price: '$$', gender: 'MEN', icon: 'shirt' },
];

const DISLIKED_CARDS: CardItem[] = [
  { name: 'Neon Windbreaker', price: '$$', gender: 'MEN', icon: 'shirt-outline' },
  { name: 'Sequin Top', price: '$$$', gender: 'WOMEN', icon: 'shirt' },
];

// A small copy of one card in the liked grid: photo with the remove button in its corner, then name, price and gender.
function MockCard({ item, disliked = false }: { item: CardItem; disliked?: boolean }) {
  const { theme } = useAppTheme();
  return (
    <View style={[styles.card, { backgroundColor: theme.surface }]}>
      <View style={[styles.cardImage, { backgroundColor: theme.border }]}>
        <Ionicons name={item.icon} size={30} color={theme.primary} />
        <View style={[styles.removeButton, { backgroundColor: theme.surface }]}>
          <Ionicons name={disliked ? 'close' : 'heart'} size={12} color={disliked ? theme.text : theme.accentBrown} />
        </View>
      </View>
      <View style={styles.cardInfo}>
        <Text numberOfLines={1} style={[styles.cardName, { color: theme.text }]}>{item.name}</Text>
        <View style={styles.cardMeta}>
          <Text style={[styles.cardPrice, { color: theme.accentBrown }]}>{item.price}</Text>
          <Text style={[styles.cardGender, { color: theme.mutedText }]}>{item.gender}</Text>
        </View>
      </View>
    </View>
  );
}

function MockGrid({ items, disliked = false }: { items: CardItem[]; disliked?: boolean }) {
  return (
    <View style={styles.grid}>
      {items.map((item) => <MockCard key={item.name} item={item} disliked={disliked} />)}
    </View>
  );
}

function MockToggle({ disliked, indicator, optionWidth = TOGGLE_OPTION_WIDTH }: {
  disliked: boolean; indicator: Animated.Value | Animated.AnimatedInterpolation<number>; optionWidth?: number;
}) {
  const { theme } = useAppTheme();
  const options = [
    { label: 'Liked', icon: 'heart', count: LIKED_COUNT },
    { label: 'Disliked', icon: 'close', count: DISLIKED_COUNT },
  ] as const;
  return (
    <View style={[styles.toggle, { backgroundColor: theme.tabBg, borderColor: theme.border }]}>
      <Animated.View
        style={[
          styles.toggleIndicator,
          { width: optionWidth, backgroundColor: theme.primary, transform: [{ translateX: indicator }] },
        ]}
      />
      {options.map(({ label, icon, count }, index) => {
        const isOn = (index === 1) === disliked;
        const color = isOn ? theme.headerText : theme.tabInactive;
        return (
          <View key={label} style={[styles.toggleOption, { width: optionWidth }]}>
            <Ionicons name={icon} size={11} color={color} />
            <Text style={[styles.toggleText, { color }]}>{label}</Text>
            <View style={[styles.countPill, { backgroundColor: isOn ? theme.accentGold : theme.border }]}>
              <Text style={[styles.countText, { color: isOn ? theme.text : theme.tabInactive }]}>{count}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

export function HistoryListDemo() {
  const progress = useLoop(1600, 900);

  return (
    <View style={styles.stage}>
      <View style={styles.grid}>
        {LIKED_CARDS.map((item, index) => {
          // Cards land one after another, the way new likes fill the grid.
          const start = index * 0.2;
          const appear = progress.interpolate({
            inputRange: [start, start + 0.4],
            outputRange: [0, 1],
            extrapolate: 'clamp',
          });
          return (
            <Animated.View
              key={item.name}
              style={{
                opacity: appear,
                transform: [{ translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }],
              }}
            >
              <MockCard item={item} />
            </Animated.View>
          );
        })}
      </View>
    </View>
  );
}

export function HistoryToggleDemo() {
  const [disliked, setDisliked] = useState(false);
  const [indicator] = useState(() => new Animated.Value(0));
  const [listFade] = useState(() => new Animated.Value(1));

  useEffect(() => {
    const timer = setInterval(() => setDisliked((value) => !value), 1800);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    Animated.timing(indicator, {
      toValue: disliked ? TOGGLE_OPTION_WIDTH : 0,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: NATIVE,
    }).start();
    listFade.setValue(0);
    Animated.timing(listFade, { toValue: 1, duration: 300, useNativeDriver: NATIVE }).start();
  }, [disliked, indicator, listFade]);

  return (
    <View style={styles.stage}>
      <View style={styles.toggleRow}>
        <MockToggle disliked={disliked} indicator={indicator} />
      </View>
      <Animated.View style={{ opacity: listFade }}>
        <MockGrid items={(disliked ? DISLIKED_CARDS : LIKED_CARDS).slice(0, 2)} disliked={disliked} />
      </Animated.View>
    </View>
  );
}

export function HistoryDetailDemo() {
  const { theme } = useAppTheme();
  const progress = useLoop(1800, 800);
  const item = LIKED_CARDS[0];

  const fingerOpacity = progress.interpolate({ inputRange: [0, 0.1, 0.3, 0.4], outputRange: [0, 1, 1, 0] });
  const fingerY = progress.interpolate({ inputRange: [0, 0.2, 1], outputRange: [40, 0, 0] });
  const cardScale = progress.interpolate({ inputRange: [0, 0.2, 0.25, 0.3, 1], outputRange: [1, 1, 0.95, 1, 1] });
  const popup = progress.interpolate({ inputRange: [0, 0.35, 0.55, 1], outputRange: [0, 0, 1, 1] });
  // Once the popup is up, the store button pulses to show where to tap next.
  const buttonScale = progress.interpolate({ inputRange: [0, 0.7, 0.8, 0.9, 1], outputRange: [1, 1, 1.08, 1, 1] });

  return (
    <View style={styles.stage}>
      <View style={styles.grid}>
        <Animated.View style={{ transform: [{ scale: cardScale }] }}>
          <MockCard item={item} />
          <Animated.View style={[styles.tapFinger, { opacity: fingerOpacity, transform: [{ translateY: fingerY }] }]}>
            <MaterialCommunityIcons name="hand-pointing-up" size={38} color={theme.text} />
          </Animated.View>
        </Animated.View>
        <MockCard item={LIKED_CARDS[1]} />
      </View>
      <Animated.View style={[styles.popupBackdrop, { opacity: popup }]}>
        <Animated.View
          style={[
            styles.popup,
            { backgroundColor: theme.surface, transform: [{ scale: popup.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }] },
          ]}
        >
          <View style={[styles.popupImage, { backgroundColor: theme.border }]}>
            <Ionicons name={item.icon} size={48} color={theme.primary} />
          </View>
          <View style={[styles.popupInfo, { backgroundColor: theme.primary }]}>
            <Text style={[styles.popupName, { color: theme.headerText }]}>{item.name}</Text>
            <View style={styles.popupMeta}>
              <Text style={[styles.cardPrice, { color: theme.accentGold }]}>{item.price}</Text>
              <Text style={[styles.popupGender, { color: theme.headerText }]}>{item.gender}</Text>
            </View>
            <Animated.View
              style={[styles.storeButton, { backgroundColor: theme.surface, transform: [{ scale: buttonScale }] }]}
            >
              <Text style={[styles.storeButtonText, { color: theme.text }]}>Go to Store Page</Text>
            </Animated.View>
          </View>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

export function HistoryRemoveDemo() {
  const { theme } = useAppTheme();
  const progress = useLoop(1800, 700);
  const step = CARD_WIDTH + GRID_GAP;
  const rowStep = CARD_HEIGHT + GRID_GAP;

  // A finger taps the heart on the first card, the card shrinks away, and the rest of the grid moves up one slot.
  const fingerOpacity = progress.interpolate({ inputRange: [0, 0.1, 0.35, 0.45], outputRange: [0, 1, 1, 0] });
  const fingerY = progress.interpolate({ inputRange: [0, 0.25, 1], outputRange: [36, 0, 0] });
  const buttonScale = progress.interpolate({ inputRange: [0, 0.25, 0.3, 0.35, 1], outputRange: [1, 1, 0.8, 1, 1] });
  const removed = progress.interpolate({ inputRange: [0, 0.38, 0.55, 1], outputRange: [1, 1, 0, 0] });
  const shift = progress.interpolate({ inputRange: [0, 0.55, 0.85, 1], outputRange: [0, 0, 1, 1] });
  const left = shift.interpolate({ inputRange: [0, 1], outputRange: [0, -step] });
  const wrapX = shift.interpolate({ inputRange: [0, 1], outputRange: [0, step] });
  const wrapY = shift.interpolate({ inputRange: [0, 1], outputRange: [0, -rowStep] });

  return (
    <View style={styles.stage}>
      <View style={styles.grid}>
        <Animated.View style={{ opacity: removed, transform: [{ scale: removed.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] }) }] }}>
          <MockCard item={LIKED_CARDS[0]} />
          <Animated.View style={[styles.removeHighlight, { borderColor: theme.accentGold, transform: [{ scale: buttonScale }] }]} />
          <Animated.View style={[styles.removeFinger, { opacity: fingerOpacity, transform: [{ translateY: fingerY }] }]}>
            <MaterialCommunityIcons name="hand-pointing-up" size={34} color={theme.text} />
          </Animated.View>
        </Animated.View>
        <Animated.View style={{ transform: [{ translateX: left }] }}>
          <MockCard item={LIKED_CARDS[1]} />
        </Animated.View>
        <Animated.View style={{ transform: [{ translateX: wrapX }, { translateY: wrapY }] }}>
          <MockCard item={LIKED_CARDS[2]} />
        </Animated.View>
        <Animated.View style={{ transform: [{ translateX: left }] }}>
          <MockCard item={LIKED_CARDS[3]} />
        </Animated.View>
      </View>
    </View>
  );
}

export function HistoryScrollDemo() {
  const { theme } = useAppTheme();
  const progress = useLoop(2400, 500);
  const [indicator] = useState(() => new Animated.Value(0));

  // Scroll down hides the header, scroll back up brings it back.
  const listY = progress.interpolate({ inputRange: [0, 0.4, 0.6, 1], outputRange: [0, -90, -90, 0] });
  const headerY = progress.interpolate({ inputRange: [0, 0.15, 0.35, 0.65, 0.85, 1], outputRange: [0, 0, -52, -52, 0, 0] });

  return (
    <View style={styles.stage}>
      <View style={[styles.phone, { backgroundColor: theme.background, borderColor: theme.border }]}>
        <Animated.View style={{ paddingTop: 60, transform: [{ translateY: listY }] }}>
          <MockGrid items={[...LIKED_CARDS, ...LIKED_CARDS.slice(0, 2)]} />
        </Animated.View>
        <Animated.View
          style={[styles.phoneHeader, { backgroundColor: theme.primary, transform: [{ translateY: headerY }] }]}
        >
          <MockToggle disliked={false} indicator={indicator} optionWidth={100} />
        </Animated.View>
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
  grid: {
    width: GRID_WIDTH,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID_GAP,
  },
  card: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: 12,
    elevation: 2,
    shadowColor: '#0c3b2e',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
  },
  cardImage: {
    height: CARD_IMAGE_HEIGHT,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeButton: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardInfo: {
    flex: 1,
    paddingHorizontal: 8,
    justifyContent: 'center',
    gap: 2,
  },
  cardName: {
    fontSize: 11,
    fontWeight: '600',
  },
  cardMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardPrice: {
    fontSize: 11,
    fontWeight: '700',
  },
  cardGender: {
    fontSize: 8,
    fontWeight: '600',
    letterSpacing: 0.4,
  },
  toggleRow: {
    alignItems: 'center',
    marginBottom: 12,
  },
  toggle: {
    flexDirection: 'row',
    borderRadius: 20,
    borderWidth: 1,
    padding: 3,
  },
  toggleIndicator: {
    position: 'absolute',
    left: 3,
    top: 3,
    bottom: 3,
    borderRadius: 17,
  },
  toggleOption: {
    flexDirection: 'row',
    gap: 3,
    paddingVertical: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleText: {
    fontSize: 11,
    fontWeight: '700',
  },
  countPill: {
    minWidth: 16,
    paddingHorizontal: 4,
    borderRadius: 8,
    alignItems: 'center',
  },
  countText: {
    fontSize: 9,
    fontWeight: '700',
    lineHeight: 14,
  },
  tapFinger: {
    position: 'absolute',
    right: 30,
    bottom: -30,
  },
  removeHighlight: {
    position: 'absolute',
    top: 3,
    right: 3,
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
  },
  removeFinger: {
    position: 'absolute',
    top: 24,
    right: -6,
  },
  popupBackdrop: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 16,
  },
  popup: {
    width: 190,
    borderRadius: 14,
    padding: 10,
    gap: 8,
  },
  popupImage: {
    height: 100,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  popupInfo: {
    borderRadius: 8,
    padding: 8,
    alignItems: 'center',
  },
  popupName: {
    fontSize: 13,
    fontWeight: '600',
  },
  popupMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignSelf: 'stretch',
    marginTop: 4,
  },
  popupGender: {
    fontSize: 10,
    fontWeight: '600',
  },
  storeButton: {
    marginTop: 8,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  storeButtonText: {
    fontSize: 11,
    fontWeight: '700',
  },
  phone: {
    width: GRID_WIDTH + 24,
    height: 240,
    borderRadius: 18,
    borderWidth: 2,
    overflow: 'hidden',
    alignItems: 'center',
  },
  phoneHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
