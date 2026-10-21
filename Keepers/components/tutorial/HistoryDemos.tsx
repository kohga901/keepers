/**
 * File: HistoryDemos.tsx
 * Description: Looping animations for the History tab tutorial, acted out on miniature copies of the
 *              liked list's rows: the Liked/Disliked toggle, opening an item, removing it, and the hiding header.
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

const ROW_WIDTH = 280;
const ROW_HEIGHT = 64;
const ROW_GAP = 10;
const TOGGLE_OPTION_WIDTH = 96;

type RowItem = { name: string; price: string; gender: string; icon: React.ComponentProps<typeof Ionicons>['name'] };

const LIKED_ROWS: RowItem[] = [
  { name: 'Linen Overshirt', price: '$$', gender: 'MEN', icon: 'shirt' },
  { name: 'Wool Cardigan', price: '$$$', gender: 'WOMEN', icon: 'shirt-outline' },
  { name: 'Canvas Tote', price: '$', gender: 'UNISEX', icon: 'bag-handle' },
];

const DISLIKED_ROWS: RowItem[] = [
  { name: 'Neon Windbreaker', price: '$$', gender: 'MEN', icon: 'shirt-outline' },
  { name: 'Sequin Top', price: '$$$', gender: 'WOMEN', icon: 'shirt' },
  { name: 'Bucket Hat', price: '$', gender: 'UNISEX', icon: 'bag-handle' },
];

// A small copy of one row in the liked list: bordered image, then name with price and gender underneath.
function MockRow({ item }: { item: RowItem }) {
  const { theme } = useAppTheme();
  return (
    <View style={[styles.row, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <View style={[styles.rowImage, { borderColor: theme.primary, backgroundColor: theme.border }]}>
        <Ionicons name={item.icon} size={24} color={theme.primary} />
      </View>
      <View style={styles.rowInfo}>
        <Text numberOfLines={1} style={[styles.rowName, { color: theme.text }]}>{item.name}</Text>
        <View style={styles.rowMeta}>
          <Text style={[styles.rowPrice, { color: theme.accentBrown }]}>{item.price}</Text>
          <Text style={[styles.rowGender, { color: theme.mutedText }]}>{item.gender}</Text>
        </View>
      </View>
    </View>
  );
}

function MockToggle({ disliked, indicator }: { disliked: boolean; indicator: Animated.Value }) {
  const { theme } = useAppTheme();
  return (
    <View style={[styles.toggle, { backgroundColor: theme.tabBg, borderColor: theme.border }]}>
      <Animated.View
        style={[styles.toggleIndicator, { backgroundColor: theme.primary, transform: [{ translateX: indicator }] }]}
      />
      {['Liked', 'Disliked'].map((label, index) => {
        const isOn = (index === 1) === disliked;
        return (
          <View key={label} style={styles.toggleOption}>
            <Text style={[styles.toggleText, { color: isOn ? '#FFFFFF' : theme.tabInactive }]}>{label}</Text>
          </View>
        );
      })}
    </View>
  );
}

export function HistoryListDemo() {
  const progress = useLoop(1400, 900);

  return (
    <View style={styles.stage}>
      <View style={styles.column}>
        {LIKED_ROWS.map((item, index) => {
          // Rows land one after another, the way new likes stack up.
          const start = index * 0.25;
          const appear = progress.interpolate({
            inputRange: [start, start + 0.45],
            outputRange: [0, 1],
            extrapolate: 'clamp',
          });
          return (
            <Animated.View
              key={item.name}
              style={{
                opacity: appear,
                transform: [{ translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }],
              }}
            >
              <MockRow item={item} />
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
      <View style={styles.column}>
        <View style={styles.toggleRow}>
          <MockToggle disliked={disliked} indicator={indicator} />
        </View>
        <Animated.View style={{ opacity: listFade, gap: ROW_GAP }}>
          {(disliked ? DISLIKED_ROWS : LIKED_ROWS).slice(0, 2).map((item) => (
            <MockRow key={item.name} item={item} />
          ))}
        </Animated.View>
      </View>
    </View>
  );
}

export function HistoryDetailDemo() {
  const { theme } = useAppTheme();
  const progress = useLoop(1800, 800);
  const item = LIKED_ROWS[0];

  const fingerOpacity = progress.interpolate({ inputRange: [0, 0.1, 0.3, 0.4], outputRange: [0, 1, 1, 0] });
  const fingerY = progress.interpolate({ inputRange: [0, 0.2, 1], outputRange: [40, 0, 0] });
  const rowScale = progress.interpolate({ inputRange: [0, 0.2, 0.25, 0.3, 1], outputRange: [1, 1, 0.96, 1, 1] });
  const popup = progress.interpolate({ inputRange: [0, 0.35, 0.55, 1], outputRange: [0, 0, 1, 1] });
  // Once the popup is up, the store button pulses to show where to tap next.
  const buttonScale = progress.interpolate({ inputRange: [0, 0.7, 0.8, 0.9, 1], outputRange: [1, 1, 1.08, 1, 1] });

  return (
    <View style={styles.stage}>
      <Animated.View style={{ transform: [{ scale: rowScale }] }}>
        <MockRow item={item} />
        <Animated.View style={[styles.tapFinger, { opacity: fingerOpacity, transform: [{ translateY: fingerY }] }]}>
          <MaterialCommunityIcons name="hand-pointing-up" size={38} color={theme.text} />
        </Animated.View>
      </Animated.View>
      <Animated.View
        style={[
          styles.popupBackdrop,
          { opacity: popup },
        ]}
      >
        <Animated.View
          style={[
            styles.popup,
            { transform: [{ scale: popup.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }] },
          ]}
        >
          <View style={[styles.popupImage, { backgroundColor: theme.border }]}>
            <Ionicons name={item.icon} size={48} color={theme.primary} />
          </View>
          <View style={[styles.popupInfo, { backgroundColor: theme.primary }]}>
            <Text style={styles.popupName}>{item.name}</Text>
            <View style={styles.popupMeta}>
              <Text style={[styles.rowPrice, { color: theme.accentBrown }]}>{item.price}</Text>
              <Text style={styles.popupGender}>{item.gender}</Text>
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
  const progress = useLoop(1600, 700);

  // The top row is dragged left over the red trash action, then the rows below slide up to fill the gap.
  const rowX = progress.interpolate({ inputRange: [0, 0.5, 0.65, 1], outputRange: [0, -ROW_WIDTH * 0.6, -ROW_WIDTH, -ROW_WIDTH] });
  const removedOpacity = progress.interpolate({ inputRange: [0, 0.6, 0.75, 1], outputRange: [1, 1, 0, 0] });
  const fingerOpacity = progress.interpolate({ inputRange: [0, 0.08, 0.5, 0.6], outputRange: [0, 1, 1, 0] });
  const fingerX = progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: [60, -110, -110] });
  const shiftUp = progress.interpolate({
    inputRange: [0, 0.7, 0.95, 1],
    outputRange: [0, 0, -(ROW_HEIGHT + ROW_GAP), -(ROW_HEIGHT + ROW_GAP)],
  });

  return (
    <View style={styles.stage}>
      <View style={styles.column}>
        <Animated.View style={{ opacity: removedOpacity }}>
          <View style={styles.deleteAction}>
            <Ionicons name="trash" size={22} color="white" />
          </View>
          <Animated.View style={{ transform: [{ translateX: rowX }] }}>
            <MockRow item={DISLIKED_ROWS[0]} />
          </Animated.View>
          <Animated.View style={[styles.dragFinger, { opacity: fingerOpacity, transform: [{ translateX: fingerX }] }]}>
            <MaterialCommunityIcons name="hand-pointing-up" size={38} color={theme.text} />
          </Animated.View>
        </Animated.View>
        {LIKED_ROWS.slice(0, 2).map((item) => (
          <Animated.View key={item.name} style={{ transform: [{ translateY: shiftUp }] }}>
            <MockRow item={item} />
          </Animated.View>
        ))}
      </View>
    </View>
  );
}

export function HistoryScrollDemo() {
  const { theme } = useAppTheme();
  const progress = useLoop(2400, 500);
  const [indicator] = useState(() => new Animated.Value(0));

  // Scroll down hides the header, scroll back up brings it back.
  const listY = progress.interpolate({ inputRange: [0, 0.4, 0.6, 1], outputRange: [0, -70, -70, 0] });
  const headerY = progress.interpolate({ inputRange: [0, 0.15, 0.35, 0.65, 0.85, 1], outputRange: [0, 0, -52, -52, 0, 0] });

  return (
    <View style={styles.stage}>
      <View style={[styles.phone, { backgroundColor: theme.background, borderColor: theme.border }]}>
        <Animated.View style={{ gap: ROW_GAP, paddingTop: 60, transform: [{ translateY: listY }] }}>
          {[...LIKED_ROWS, ...DISLIKED_ROWS].slice(0, 4).map((item) => (
            <MockRow key={item.name} item={item} />
          ))}
        </Animated.View>
        <Animated.View
          style={[styles.phoneHeader, { backgroundColor: theme.primary, transform: [{ translateY: headerY }] }]}
        >
          <MockToggle disliked={false} indicator={indicator} />
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
  column: {
    gap: ROW_GAP,
  },
  row: {
    width: ROW_WIDTH,
    height: ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 2,
    paddingHorizontal: 8,
    gap: 10,
  },
  rowImage: {
    width: 44,
    height: 44,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowInfo: {
    flex: 1,
    gap: 2,
  },
  rowName: {
    fontSize: 14,
    fontWeight: '600',
  },
  rowMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  rowPrice: {
    fontSize: 12,
    fontWeight: '600',
  },
  rowGender: {
    fontSize: 10,
    fontWeight: '600',
  },
  toggleRow: {
    alignItems: 'center',
    marginBottom: 6,
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
    width: TOGGLE_OPTION_WIDTH,
    borderRadius: 17,
  },
  toggleOption: {
    width: TOGGLE_OPTION_WIDTH,
    paddingVertical: 5,
    alignItems: 'center',
  },
  toggleText: {
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  tapFinger: {
    position: 'absolute',
    right: 40,
    bottom: -34,
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
    backgroundColor: 'white',
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
    color: '#FFFFFF',
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
    color: '#FFFFFF',
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
  deleteAction: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'red',
    borderRadius: 10,
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingRight: 20,
  },
  dragFinger: {
    position: 'absolute',
    right: 30,
    bottom: -30,
  },
  phone: {
    width: ROW_WIDTH + 24,
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
