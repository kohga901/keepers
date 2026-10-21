/**
 * File: GraphDemos.tsx
 * Description: Looping animations for the Graph tab tutorial, acted out on a miniature style map:
 *              what the dots mean, moving around, focus vs whole graph, picking a piece, and how likes move your taste.
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

// Same blue the real graph uses for the taste marker.
const TASTE_BLUE = '#24a7ff';
const MAP_WIDTH = 280;
const MAP_HEIGHT = 200;
const DOT_SIZE = 5;

type Point = { x: number; y: number; cluster: number };

// Fixed pseudo-random points so the mock map looks the same every time it's shown.
function buildPoints(): Point[] {
  let seed = 7;
  const random = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  const centers = [
    { x: 70, y: 60 },
    { x: 200, y: 55 },
    { x: 150, y: 120 },
    { x: 60, y: 150 },
    { x: 225, y: 155 },
  ];
  return centers.flatMap((center, cluster) =>
    Array.from({ length: 14 }, () => ({
      x: center.x + (random() - 0.5) * 70,
      y: center.y + (random() - 0.5) * 50,
      cluster,
    })),
  );
}

const POINTS = buildPoints();
const TASTE = { x: 140, y: 112 };
// The piece the "tap a piece" and "like" demos pick, close to the taste marker.
const PICKED = { x: 196, y: 70 };
// Where the taste marker ends up after liking the picked piece: part of the way toward it.
const TASTE_AFTER_LIKE = { x: 162, y: 96 };
const PREVIEW_SPOTS = [
  { x: 72, y: 58 },
  { x: 205, y: 52 },
  { x: 150, y: 128 },
  { x: 58, y: 150 },
];

function MapDots({ clusterOpacity }: { clusterOpacity?: (cluster: number) => Animated.AnimatedInterpolation<number> }) {
  const { theme } = useAppTheme();
  return (
    <>
      {POINTS.map((point, index) => (
        <Animated.View
          key={index}
          style={[
            styles.dot,
            {
              left: point.x - DOT_SIZE / 2,
              top: point.y - DOT_SIZE / 2,
              backgroundColor: theme.primary,
              opacity: clusterOpacity ? clusterOpacity(point.cluster) : 0.75,
            },
          ]}
        />
      ))}
    </>
  );
}

function TasteMarker({ x, y }: { x: number | Animated.AnimatedInterpolation<number>; y: number | Animated.AnimatedInterpolation<number> }) {
  const { theme } = useAppTheme();
  return (
    <Animated.View style={[styles.tasteWrap, { transform: [{ translateX: x }, { translateY: y }] }]}>
      <View style={styles.tasteHalo} />
      <View style={[styles.tasteDot, { borderColor: theme.surface }]} />
    </Animated.View>
  );
}

function MapFrame({ children }: { children: React.ReactNode }) {
  const { theme } = useAppTheme();
  return (
    <View style={[styles.map, { backgroundColor: theme.background, borderColor: theme.border }]}>
      {[1, 2, 3, 4, 5, 6].map((line) => (
        <View key={`v${line}`} style={[styles.gridV, { left: (MAP_WIDTH / 7) * line, backgroundColor: theme.border }]} />
      ))}
      {[1, 2, 3, 4].map((line) => (
        <View key={`h${line}`} style={[styles.gridH, { top: (MAP_HEIGHT / 5) * line, backgroundColor: theme.border }]} />
      ))}
      {children}
    </View>
  );
}

function Finger({ style }: { style: object }) {
  const { theme } = useAppTheme();
  return (
    <Animated.View pointerEvents="none" style={[styles.finger, style]}>
      <MaterialCommunityIcons name="hand-pointing-up" size={36} color={theme.text} />
    </Animated.View>
  );
}

export function GraphMapDemo() {
  const { theme } = useAppTheme();
  const progress = useLoop(2000, 900);

  // Each group of similar pieces appears together, then the taste marker drops in among them.
  const clusterOpacity = (cluster: number) =>
    progress.interpolate({
      inputRange: [cluster * 0.12, cluster * 0.12 + 0.2],
      outputRange: [0, 0.75],
      extrapolate: 'clamp',
    });
  const tasteIn = progress.interpolate({ inputRange: [0, 0.7, 0.85, 1], outputRange: [0, 0, 1, 1] });

  return (
    <View style={styles.stage}>
      <MapFrame>
        <MapDots clusterOpacity={clusterOpacity} />
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: tasteIn }]}>
          <TasteMarker x={TASTE.x} y={TASTE.y} />
          <View style={[styles.tasteLabel, { left: TASTE.x + 13, top: TASTE.y - 12, backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Text style={[styles.small, { color: theme.text }]}>Your taste</Text>
          </View>
        </Animated.View>
      </MapFrame>
    </View>
  );
}

export function GraphPanZoomDemo() {
  const { theme } = useAppTheme();
  const progress = useLoop(3200, 500);

  // First half: one finger drags the map. Second half: the + button zooms in. Then it eases back.
  const panX = progress.interpolate({ inputRange: [0, 0.35, 0.85, 1], outputRange: [0, -45, -45, 0] });
  const panY = progress.interpolate({ inputRange: [0, 0.35, 0.85, 1], outputRange: [0, 20, 20, 0] });
  const zoom = progress.interpolate({ inputRange: [0, 0.45, 0.7, 0.85, 1], outputRange: [1, 1, 1.6, 1.6, 1] });
  const fingerOpacity = progress.interpolate({ inputRange: [0, 0.05, 0.35, 0.4], outputRange: [0, 1, 1, 0] });
  const fingerX = progress.interpolate({ inputRange: [0, 0.35, 1], outputRange: [0, -45, -45] });
  const fingerY = progress.interpolate({ inputRange: [0, 0.35, 1], outputRange: [0, 20, 20] });
  const plusPress = progress.interpolate({ inputRange: [0, 0.45, 0.5, 0.55, 1], outputRange: [1, 1, 0.85, 1, 1] });
  const plusHighlight = progress.interpolate({ inputRange: [0, 0.42, 0.47, 0.6, 0.65], outputRange: [0, 0, 1, 1, 0], extrapolate: 'clamp' });

  return (
    <View style={styles.stage}>
      <MapFrame>
        <Animated.View
          style={[StyleSheet.absoluteFill, { transform: [{ translateX: panX }, { translateY: panY }, { scale: zoom }] }]}
        >
          <MapDots />
          <TasteMarker x={TASTE.x} y={TASTE.y} />
        </Animated.View>
        <View style={styles.zoomControls}>
          <Animated.View style={[styles.zoomButton, { backgroundColor: theme.surface, borderColor: theme.border, transform: [{ scale: plusPress }] }]}>
            <Animated.View style={[StyleSheet.absoluteFill, styles.zoomHighlight, { backgroundColor: theme.accentGold, opacity: plusHighlight }]} />
            <Ionicons name="add" size={18} color={theme.text} />
          </Animated.View>
          <View style={[styles.zoomButton, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Ionicons name="remove" size={18} color={theme.text} />
          </View>
        </View>
        <Finger style={{ left: 150, top: 110, opacity: fingerOpacity, transform: [{ translateX: fingerX }, { translateY: fingerY }] }} />
      </MapFrame>
    </View>
  );
}

const MODE_OPTION_WIDTH = 104;

export function GraphModesDemo() {
  const { theme } = useAppTheme();
  const [focus, setFocus] = useState(true);
  const [zoom] = useState(() => new Animated.Value(1));

  useEffect(() => {
    const timer = setInterval(() => setFocus((value) => !value), 2000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    Animated.timing(zoom, {
      toValue: focus ? 1 : 0,
      duration: 500,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: NATIVE,
    }).start();
  }, [focus, zoom]);

  // Focus area zooms in around your taste and circles the pieces it's counting.
  const scale = zoom.interpolate({ inputRange: [0, 1], outputRange: [1, 2] });
  const shiftX = zoom.interpolate({ inputRange: [0, 1], outputRange: [0, MAP_WIDTH / 2 - TASTE.x] });
  const shiftY = zoom.interpolate({ inputRange: [0, 1], outputRange: [0, MAP_HEIGHT / 2 - TASTE.y] });

  return (
    <View style={styles.stage}>
      <View style={[styles.modes, { backgroundColor: theme.tabBg, borderColor: theme.border }]}>
        {(['Focus area', 'Whole graph'] as const).map((label, index) => {
          const isOn = (index === 0) === focus;
          return (
            <View key={label} style={[styles.mode, isOn && { backgroundColor: theme.primary }]}>
              <Text style={[styles.modeText, { color: isOn ? theme.headerText : theme.tabInactive }]}>{label}</Text>
            </View>
          );
        })}
      </View>
      <MapFrame>
        <Animated.View
          style={[StyleSheet.absoluteFill, { transform: [{ scale }, { translateX: shiftX }, { translateY: shiftY }] }]}
        >
          <MapDots />
          <TasteMarker x={TASTE.x} y={TASTE.y} />
        </Animated.View>
        <Animated.View
          pointerEvents="none"
          style={[styles.focusRing, { borderColor: theme.primary, backgroundColor: 'rgba(109,151,115,0.1)', opacity: zoom }]}
        />
        <Text style={[styles.countText, { color: theme.text }]}>
          {focus ? 'Around your taste · 24 pieces' : 'All clothing · 70 pieces'}
        </Text>
      </MapFrame>
    </View>
  );
}

function MockDock({ likeProgress }: { likeProgress?: Animated.Value }) {
  const { theme } = useAppTheme();
  // Before the tap the outline heart shows; after it, the filled one fades in and the label reads Liked.
  const liked = likeProgress?.interpolate({ inputRange: [0, 0.3, 0.35, 1], outputRange: [0, 0, 1, 1] });
  const unliked = likeProgress?.interpolate({ inputRange: [0, 0.3, 0.35, 1], outputRange: [1, 1, 0, 0] });
  const press = likeProgress?.interpolate({ inputRange: [0, 0.25, 0.3, 0.35, 1], outputRange: [1, 1, 0.9, 1, 1] }) ?? 1;

  return (
    <View style={[styles.dock, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <View style={styles.dockRow}>
        <View style={[styles.dockPhoto, { backgroundColor: theme.border }]}>
          <Ionicons name="shirt" size={18} color={theme.primary} />
        </View>
        <View style={styles.dockInfo}>
          <Text numberOfLines={1} style={[styles.dockName, { color: theme.text }]}>Linen Overshirt</Text>
          <View style={styles.dockPrice}>
            <Text style={[styles.small, { color: theme.accentBrown }]}>$$</Text>
            <Ionicons name="open-outline" size={10} color={theme.accentBrown} />
          </View>
        </View>
        <Ionicons name="close" size={16} color={theme.text} />
      </View>
      <View style={styles.dockActions}>
        <Animated.View style={[styles.dockAction, styles.dockActionWide, { backgroundColor: theme.primary, transform: [{ scale: press }] }]}>
          <View>
            <Animated.View style={{ opacity: unliked ?? 1 }}>
              <Ionicons name="heart-outline" size={13} color={theme.text} />
            </Animated.View>
            {liked && (
              <Animated.View style={[StyleSheet.absoluteFill, { opacity: liked }]}>
                <Ionicons name="heart" size={13} color={theme.text} />
              </Animated.View>
            )}
          </View>
          <Text style={[styles.dockActionText, { color: theme.text }]}>Like</Text>
        </Animated.View>
        <View style={[styles.dockAction, styles.dockActionWide, { backgroundColor: theme.accentGold }]}>
          <Ionicons name="search" size={13} color={theme.text} />
          <Text style={[styles.dockActionText, { color: theme.text }]}>Find it</Text>
        </View>
        <View style={[styles.dockAction, { backgroundColor: theme.background }]}>
          <Ionicons name="chevron-forward" size={14} color={theme.text} />
        </View>
      </View>
    </View>
  );
}

export function GraphSelectDemo() {
  const { theme } = useAppTheme();
  const progress = useLoop(1800, 800);

  const fingerOpacity = progress.interpolate({ inputRange: [0, 0.1, 0.35, 0.45], outputRange: [0, 1, 1, 0] });
  const fingerY = progress.interpolate({ inputRange: [0, 0.25, 1], outputRange: [40, 0, 0] });
  const picked = progress.interpolate({ inputRange: [0, 0.28, 0.33, 1], outputRange: [0, 0, 1, 1] });
  const dockY = progress.interpolate({ inputRange: [0, 0.35, 0.55, 1], outputRange: [120, 120, 0, 0] });

  return (
    <View style={styles.stage}>
      <MapFrame>
        <MapDots />
        <TasteMarker x={TASTE.x} y={TASTE.y} />
        <Animated.View
          style={[
            styles.pickedDot,
            { left: PICKED.x - 7, top: PICKED.y - 7, backgroundColor: theme.accentGold, borderColor: theme.text, opacity: picked, transform: [{ scale: picked }] },
          ]}
        />
        <Finger style={{ left: PICKED.x - 14, top: PICKED.y + 2, opacity: fingerOpacity, transform: [{ translateY: fingerY }] }} />
        <Animated.View style={[styles.dockWrap, { transform: [{ translateY: dockY }] }]}>
          <MockDock />
        </Animated.View>
      </MapFrame>
    </View>
  );
}

export function GraphTasteDemo() {
  const { theme } = useAppTheme();
  const [progress] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(600),
        Animated.timing(progress, { toValue: 1, duration: 2200, easing: Easing.inOut(Easing.cubic), useNativeDriver: NATIVE }),
        Animated.delay(900),
        Animated.timing(progress, { toValue: 0, duration: 0, useNativeDriver: NATIVE }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [progress]);

  // After Like is tapped, the taste marker glides part of the way toward the liked piece.
  const tasteX = progress.interpolate({ inputRange: [0, 0.4, 0.9, 1], outputRange: [TASTE.x, TASTE.x, TASTE_AFTER_LIKE.x, TASTE_AFTER_LIKE.x] });
  const tasteY = progress.interpolate({ inputRange: [0, 0.4, 0.9, 1], outputRange: [TASTE.y, TASTE.y, TASTE_AFTER_LIKE.y, TASTE_AFTER_LIKE.y] });
  const fingerOpacity = progress.interpolate({ inputRange: [0, 0.08, 0.3, 0.38], outputRange: [0, 1, 1, 0] });

  return (
    <View style={styles.stage}>
      <MapFrame>
        <MapDots />
        <View style={[styles.pickedDot, { left: PICKED.x - 7, top: PICKED.y - 7, backgroundColor: theme.accentGold, borderColor: theme.text }]} />
        <TasteMarker x={tasteX} y={tasteY} />
        <View style={styles.dockWrap}>
          <MockDock likeProgress={progress} />
        </View>
        <Finger style={{ left: 50, bottom: -14, opacity: fingerOpacity }} />
      </MapFrame>
    </View>
  );
}

export function GraphPreviewsDemo() {
  const { theme } = useAppTheme();
  const [on, setOn] = useState(false);
  const [reveal] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const timer = setInterval(() => setOn((value) => !value), 1800);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    Animated.spring(reveal, { toValue: on ? 1 : 0, useNativeDriver: NATIVE, speed: 14, bounciness: 8 }).start();
  }, [on, reveal]);

  return (
    <View style={styles.stage}>
      <View style={styles.previewHeader}>
        <Text style={[styles.previewLabel, { color: theme.text }]}>Image previews</Text>
        <View style={[styles.switchTrack, { backgroundColor: on ? theme.primary : theme.border }]}>
          <View style={[styles.switchThumb, { backgroundColor: theme.surface }, on && styles.switchThumbOn]} />
        </View>
      </View>
      <MapFrame>
        <MapDots />
        <TasteMarker x={TASTE.x} y={TASTE.y} />
        {PREVIEW_SPOTS.map((spot) => (
          <Animated.View
            key={`${spot.x}-${spot.y}`}
            style={[
              styles.preview,
              { left: spot.x - 15, top: spot.y - 17, backgroundColor: theme.background, borderColor: theme.surface, opacity: reveal, transform: [{ scale: reveal }] },
            ]}
          >
            <Ionicons name="shirt" size={14} color={theme.primary} />
          </Animated.View>
        ))}
        <View style={[styles.myTaste, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Ionicons name="locate-outline" size={12} color={theme.text} />
          <Text style={[styles.small, { color: theme.text }]}>My taste</Text>
        </View>
      </MapFrame>
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
    gap: 8,
  },
  map: {
    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
  },
  gridV: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: StyleSheet.hairlineWidth,
    opacity: 0.6,
  },
  gridH: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    opacity: 0.6,
  },
  dot: {
    position: 'absolute',
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
  },
  tasteWrap: {
    position: 'absolute',
    left: -15,
    top: -15,
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tasteHalo: {
    position: 'absolute',
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: TASTE_BLUE,
    opacity: 0.16,
  },
  tasteDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2.5,
    backgroundColor: TASTE_BLUE,
  },
  tasteLabel: {
    position: 'absolute',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  small: {
    fontSize: 10,
    lineHeight: 14,
  },
  finger: {
    position: 'absolute',
  },
  zoomControls: {
    position: 'absolute',
    right: 8,
    top: 8,
    gap: 5,
  },
  zoomButton: {
    width: 30,
    height: 30,
    borderRadius: 7,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  zoomHighlight: {
    borderRadius: 7,
  },
  modes: {
    flexDirection: 'row',
    borderRadius: 20,
    borderWidth: 1,
    padding: 3,
  },
  mode: {
    width: MODE_OPTION_WIDTH,
    paddingVertical: 5,
    borderRadius: 17,
    alignItems: 'center',
  },
  modeText: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  focusRing: {
    position: 'absolute',
    left: MAP_WIDTH / 2 - 60,
    top: MAP_HEIGHT / 2 - 60,
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 1.5,
  },
  countText: {
    position: 'absolute',
    top: 8,
    left: 10,
    fontSize: 10,
    fontWeight: '600',
  },
  pickedDot: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1,
  },
  dockWrap: {
    position: 'absolute',
    left: 8,
    right: 8,
    bottom: 8,
  },
  dock: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 8,
    gap: 6,
  },
  dockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  dockPhoto: {
    width: 28,
    height: 32,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dockInfo: {
    flex: 1,
  },
  dockName: {
    fontSize: 11,
    fontWeight: '500',
  },
  dockPrice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  dockActions: {
    flexDirection: 'row',
    gap: 5,
  },
  dockAction: {
    height: 26,
    minWidth: 26,
    paddingHorizontal: 6,
    borderRadius: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  dockActionWide: {
    flex: 1,
  },
  dockActionText: {
    fontSize: 10,
    fontWeight: '500',
  },
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  previewLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  switchTrack: {
    width: 38,
    height: 22,
    borderRadius: 11,
    padding: 2,
  },
  switchThumb: {
    width: 18,
    height: 18,
    borderRadius: 9,
  },
  switchThumbOn: {
    marginLeft: 16,
  },
  preview: {
    position: 'absolute',
    width: 30,
    height: 34,
    borderRadius: 7,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0c3b2e',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
    elevation: 2,
  },
  myTaste: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 5,
    borderRadius: 7,
    borderWidth: 1,
  },
});
