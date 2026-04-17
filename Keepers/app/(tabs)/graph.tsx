import { useMemo, useState } from 'react';
import { LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useHeaderHeight } from '@react-navigation/elements';

import { useAppTheme } from '../../hooks/useAppTheme';

type GraphNode = {
  clothesId: number;
  x: number;
  y: number;
};

type Bounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

type ScreenNode = {
  node: GraphNode;
  x: number;
  y: number;
};

const AnimatedView = Animated.createAnimatedComponent(View);

const GRAPH_PADDING = 16;
const MIN_SCALE = 1;
const MAX_SCALE = 7;

const nodeData: GraphNode[] = [
  { clothesId: 1, x: -0.92, y: 0.71 },
  { clothesId: 2, x: -0.85, y: 0.66 },
  { clothesId: 3, x: -0.77, y: 0.59 },
  { clothesId: 4, x: -0.63, y: 0.52 },
  { clothesId: 5, x: -0.54, y: 0.44 },
  { clothesId: 6, x: -0.38, y: 0.33 },
  { clothesId: 7, x: -0.22, y: 0.25 },
  { clothesId: 8, x: -0.11, y: 0.14 },
  { clothesId: 9, x: 0.02, y: 0.05 },
  { clothesId: 10, x: 0.18, y: -0.04 },
  { clothesId: 11, x: 0.31, y: -0.11 },
  { clothesId: 12, x: 0.47, y: -0.22 },
  { clothesId: 13, x: 0.59, y: -0.33 },
  { clothesId: 14, x: 0.68, y: -0.41 },
  { clothesId: 15, x: 0.74, y: -0.52 },
  { clothesId: 16, x: 0.82, y: -0.61 },
  { clothesId: 17, x: 0.89, y: -0.7 },
  { clothesId: 18, x: -0.73, y: -0.66 },
  { clothesId: 19, x: -0.61, y: -0.58 },
  { clothesId: 20, x: -0.49, y: -0.51 },
  { clothesId: 21, x: -0.36, y: -0.46 },
  { clothesId: 22, x: -0.24, y: -0.39 },
  { clothesId: 23, x: -0.12, y: -0.3 },
  { clothesId: 24, x: 0.04, y: -0.2 },
  { clothesId: 25, x: 0.14, y: -0.14 },
  { clothesId: 26, x: 0.23, y: 0.18 },
  { clothesId: 27, x: 0.34, y: 0.27 },
  { clothesId: 28, x: 0.44, y: 0.36 },
  { clothesId: 29, x: 0.52, y: 0.45 },
  { clothesId: 30, x: 0.61, y: 0.55 },
  { clothesId: 31, x: 0.72, y: 0.62 },
  { clothesId: 32, x: 0.83, y: 0.71 },
];

function clampTranslation(value: number, scale: number, size: number): number {
  'worklet';
  const maxOffset = ((scale - 1) * size) / 2;

  if (maxOffset <= 0) {
    return 0;
  }

  return Math.max(-maxOffset, Math.min(maxOffset, value));
}

function sanitizeNodes(nodes: GraphNode[]): GraphNode[] {
  return nodes.filter((node) => {
    return (
      Number.isInteger(node.clothesId) &&
      Number.isFinite(node.x) &&
      Number.isFinite(node.y)
    );
  });
}

function getBounds(nodes: GraphNode[]): Bounds {
  if (nodes.length === 0) {
    return { minX: -1, maxX: 1, minY: -1, maxY: 1 };
  }

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const node of nodes) {
    minX = Math.min(minX, node.x);
    maxX = Math.max(maxX, node.x);
    minY = Math.min(minY, node.y);
    maxY = Math.max(maxY, node.y);
  }

  if (Math.abs(maxX - minX) < 1e-6) {
    maxX += 1;
    minX -= 1;
  }

  if (Math.abs(maxY - minY) < 1e-6) {
    maxY += 1;
    minY -= 1;
  }

  return { minX, maxX, minY, maxY };
}

function worldToScreen(
  node: GraphNode,
  bounds: Bounds,
  width: number,
  height: number,
  padding: number,
): { x: number; y: number } {
  const usableWidth = Math.max(width - padding * 2, 1);
  const usableHeight = Math.max(height - padding * 2, 1);
  const xRatio = (node.x - bounds.minX) / (bounds.maxX - bounds.minX);
  const yRatio = (node.y - bounds.minY) / (bounds.maxY - bounds.minY);

  return {
    x: padding + xRatio * usableWidth,
    y: padding + (1 - yRatio) * usableHeight,
  };
}

export default function Graph() {
  const { theme } = useAppTheme();
  const headerHeight = useHeaderHeight();
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);

  const scale = useSharedValue(1);
  const pinchStartScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const panStartX = useSharedValue(0);
  const panStartY = useSharedValue(0);
  const viewportWidth = useSharedValue(1);
  const viewportHeight = useSharedValue(1);

  const nodes = useMemo(() => sanitizeNodes(nodeData), []);

  const bounds = useMemo(() => {
    return getBounds(nodes);
  }, [nodes]);

  const screenNodes = useMemo<ScreenNode[]>(() => {
    if (viewport.width === 0 || viewport.height === 0) {
      return [];
    }

    return nodes.map((node) => {
      const position = worldToScreen(node, bounds, viewport.width, viewport.height, GRAPH_PADDING);
      return {
        node,
        x: position.x,
        y: position.y,
      };
    });
  }, [bounds, nodes, viewport.height, viewport.width]);

  const transformStyle = useAnimatedStyle(() => {
    return {
      transform: [
        { translateX: translateX.value },
        { translateY: translateY.value },
        { scale: scale.value },
      ],
    };
  });

  const panGesture = Gesture.Pan()
    .onBegin(() => {
      panStartX.value = translateX.value;
      panStartY.value = translateY.value;
    })
    .onUpdate((event) => {
      translateX.value = clampTranslation(
        panStartX.value + event.translationX,
        scale.value,
        viewportWidth.value,
      );
      translateY.value = clampTranslation(
        panStartY.value + event.translationY,
        scale.value,
        viewportHeight.value,
      );
    });

  const pinchGesture = Gesture.Pinch()
    .onBegin(() => {
      pinchStartScale.value = scale.value;
    })
    .onUpdate((event) => {
      const nextScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, pinchStartScale.value * event.scale));
      scale.value = nextScale;
      translateX.value = clampTranslation(translateX.value, nextScale, viewportWidth.value);
      translateY.value = clampTranslation(translateY.value, nextScale, viewportHeight.value);
    });

  const combinedGesture = Gesture.Simultaneous(panGesture, pinchGesture);

  const onViewportLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setViewport({ width, height });
    viewportWidth.value = Math.max(width, 1);
    viewportHeight.value = Math.max(height, 1);
  };

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: theme.background, paddingTop: headerHeight + 8 },
      ]}
    >
      <View style={styles.headerRow}>
        <Text style={[styles.title, { color: theme.text }]}>Embedding Graph</Text>
        <Text style={[styles.metaText, { color: theme.text }]}>{nodes.length} nodes</Text>
      </View>

      <Text style={[styles.helpText, { color: theme.text }]}>Source: local JSON file</Text>

      <GestureDetector gesture={combinedGesture}>
        <View style={styles.graphViewport} onLayout={onViewportLayout}>
          <AnimatedView style={[styles.graphLayer, transformStyle]}>
            {screenNodes.map(({ node, x, y }) => (
              <Pressable
                key={node.clothesId}
                style={[
                  styles.nodeDot,
                  {
                    left: x - 4,
                    top: y - 4,
                  },
                ]}
                onPress={() => setSelectedNode(node)}
              />
            ))}
          </AnimatedView>
        </View>
      </GestureDetector>

      <View style={styles.footerRow}>
        <Text style={[styles.footerText, { color: theme.text }]}>Pinch to zoom • Drag to pan</Text>
        {selectedNode ? (
          <Text style={styles.selectedText}>
            Selected ID: {selectedNode.clothesId} (x: {selectedNode.x.toFixed(3)}, y: {selectedNode.y.toFixed(3)})
          </Text>
        ) : (
          <Text style={styles.footerText}>Tap a node to view clothes ID</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
  },
  metaText: {
    fontSize: 13,
    fontWeight: '600',
  },
  helpText: {
    fontSize: 12,
    fontWeight: '500',
    marginTop: 8,
  },
  graphViewport: {
    backgroundColor: '#EEF2F5',
    borderColor: '#C8D5E0',
    borderRadius: 12,
    borderWidth: 1,
    flex: 1,
    marginTop: 10,
    overflow: 'hidden',
  },
  graphLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  nodeDot: {
    backgroundColor: '#1D4ED8',
    borderRadius: 4,
    height: 8,
    position: 'absolute',
    width: 8,
  },
  footerRow: {
    marginTop: 10,
  },
  footerText: {
    color: '#1F2937',
    fontSize: 12,
    fontWeight: '500',
  },
  selectedText: {
    color: '#0F172A',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 6,
  },
});
