import { useCallback, useMemo, useRef, useState } from 'react';
import { LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useHeaderHeight } from '@react-navigation/elements';
import { Image } from 'expo-image';
import * as WebBrowser from 'expo-web-browser';

import { useAppTheme } from '../../hooks/useAppTheme';
import nodeDataJson from '../../data/nodeData.json';
import { getClothingById } from '../../services/dataServices';

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

type ClothingRecord = Record<string, unknown>;

const AnimatedView = Animated.createAnimatedComponent(View);

const GRAPH_PADDING = 16;
const MIN_SCALE = 1;
const MAX_SCALE = 15;
const NODE_TAP_RADIUS = 24;

const nodeData: GraphNode[] = nodeDataJson;

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

function getStringField(record: ClothingRecord | null, keys: string[]): string {
  if (!record) {
    return '';
  }

  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }

  return '';
}

export default function Graph() {
  const { theme } = useAppTheme();
  const headerHeight = useHeaderHeight();
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [selectedItem, setSelectedItem] = useState<ClothingRecord | null>(null);
  const [isLoadingItem, setIsLoadingItem] = useState(false);
  const [itemError, setItemError] = useState<string | null>(null);
  const activeRequestId = useRef(0);
  const graphViewportRef = useRef<View>(null);
  const viewportPageOffset = useRef({ x: 0, y: 0 });

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
    .minDistance(10)
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

  const onViewportLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setViewport({ width, height });
    viewportWidth.value = Math.max(width, 1);
    viewportHeight.value = Math.max(height, 1);

    graphViewportRef.current?.measureInWindow((x, y) => {
      viewportPageOffset.current = { x, y };
    });
  };

  const handleNodePress = async (node: GraphNode) => {
    setSelectedNode(node);
    setItemError(null);
    setIsLoadingItem(true);

    const requestId = activeRequestId.current + 1;
    activeRequestId.current = requestId;

    try {
      const clothing = await getClothingById(String(node.clothesId));
      if (activeRequestId.current !== requestId) {
        return;
      }

      if (!clothing) {
        setSelectedItem(null);
        setItemError(`No clothing item found for ID ${node.clothesId}.`);
        return;
      }

      setSelectedItem(clothing as ClothingRecord);
    } catch {
      if (activeRequestId.current !== requestId) {
        return;
      }

      setSelectedItem(null);
      setItemError('Failed to load clothing item details.');
    } finally {
      if (activeRequestId.current === requestId) {
        setIsLoadingItem(false);
      }
    }
  };

  const handleGraphTap = useCallback(
    (tapX: number, tapY: number, absoluteX: number, absoluteY: number) => {
      if (viewport.width === 0 || viewport.height === 0 || screenNodes.length === 0) {
        return;
      }

      const currentScale = scale.value;
      const currentTranslateX = translateX.value;
      const currentTranslateY = translateY.value;
      const centerX = viewport.width / 2;
      const centerY = viewport.height / 2;
      const tapCandidates = [
        { x: tapX, y: tapY },
        {
          x: absoluteX - viewportPageOffset.current.x,
          y: absoluteY - viewportPageOffset.current.y,
        },
      ];

      let closestNode: GraphNode | null = null;
      let closestDistanceSquared = Number.POSITIVE_INFINITY;

      for (const candidate of tapCandidates) {
        for (const { node, x, y } of screenNodes) {
          const transformedXTranslateThenScale =
            (x - centerX) * currentScale + centerX + currentTranslateX * currentScale;
          const transformedYTranslateThenScale =
            (y - centerY) * currentScale + centerY + currentTranslateY * currentScale;

          const transformedXScaleThenTranslate =
            (x - centerX) * currentScale + centerX + currentTranslateX;
          const transformedYScaleThenTranslate =
            (y - centerY) * currentScale + centerY + currentTranslateY;

          const distanceTranslateThenScale =
            (candidate.x - transformedXTranslateThenScale) *
              (candidate.x - transformedXTranslateThenScale) +
            (candidate.y - transformedYTranslateThenScale) *
              (candidate.y - transformedYTranslateThenScale);

          const distanceScaleThenTranslate =
            (candidate.x - transformedXScaleThenTranslate) *
              (candidate.x - transformedXScaleThenTranslate) +
            (candidate.y - transformedYScaleThenTranslate) *
              (candidate.y - transformedYScaleThenTranslate);

          const distanceSquared = Math.min(distanceTranslateThenScale, distanceScaleThenTranslate);

          if (distanceSquared < closestDistanceSquared) {
            closestDistanceSquared = distanceSquared;
            closestNode = node;
          }
        }
      }

      if (!closestNode || closestDistanceSquared > NODE_TAP_RADIUS * NODE_TAP_RADIUS) {
        return;
      }

      handleNodePress(closestNode).catch(() => {
        // Errors are already handled in handleNodePress state.
      });
    },
    [handleNodePress, scale, screenNodes, translateX, translateY, viewport.height, viewport.width],
  );

  const tapGesture = Gesture.Tap()
    .maxDistance(20)
    .onEnd((event, success) => {
      if (!success) {
        return;
      }

      runOnJS(handleGraphTap)(event.x, event.y, event.absoluteX, event.absoluteY);
    });

  const combinedGesture = Gesture.Simultaneous(panGesture, pinchGesture, tapGesture);

  const selectedItemName = useMemo(() => {
    return getStringField(selectedItem, ['item_name', 'name']);
  }, [selectedItem]);

  const selectedItemPrice = useMemo(() => {
    return getStringField(selectedItem, ['item_price', 'price']);
  }, [selectedItem]);

  const selectedItemImage = useMemo(() => {
    return getStringField(selectedItem, ['item_img', 'imageUrl', 'image_url']);
  }, [selectedItem]);

  const selectedItemUrl = useMemo(() => {
    return getStringField(selectedItem, ['item_web_listing', 'itemUrl', 'item_url', 'url']);
  }, [selectedItem]);

  const onPricePress = async () => {
    if (!selectedItemUrl) {
      return;
    }

    try {
      await WebBrowser.openBrowserAsync(selectedItemUrl);
    } catch {
      setItemError('Unable to open product link.');
    }
  };

  const onDismissItemPopup = () => {
    setSelectedItem(null);
    setItemError(null);
    setIsLoadingItem(false);
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

      <View ref={graphViewportRef} style={styles.graphViewport} onLayout={onViewportLayout}>
        <GestureDetector gesture={combinedGesture}>
          <AnimatedView style={[styles.graphLayer, transformStyle]}>
            {screenNodes.map(({ node, x, y }) => (
              <View
                key={node.clothesId}
                style={[
                  styles.nodeDot,
                  selectedNode?.clothesId === node.clothesId ? styles.nodeDotSelected : null,
                  {
                    left: x - 1,
                    top: y - 1,
                  },
                ]}
              />
            ))}
          </AnimatedView>
        </GestureDetector>

          {isLoadingItem ? (
            <View style={styles.popupContainer} pointerEvents="box-none">
              <Text style={styles.loadingText}>Loading item details...</Text>
            </View>
          ) : null}

          {itemError ? (
            <View style={styles.popupContainer} pointerEvents="box-none">
              <Text style={styles.errorText}>{itemError}</Text>
            </View>
          ) : null}

          {selectedItem ? (
            <View style={styles.popupContainer} pointerEvents="box-none">
              <View style={styles.itemCard}>
                <Pressable style={styles.closeButton} onPress={onDismissItemPopup} hitSlop={8}>
                  <Text style={styles.closeButtonText}>X</Text>
                </Pressable>
                <View style={styles.imageContainer}>
                  {selectedItemImage ? (
                    <Image
                      style={styles.itemImage}
                      source={{ uri: selectedItemImage }}
                      contentFit="cover"
                      transition={300}
                    />
                  ) : (
                    <View style={styles.imageFallback}>
                      <Text style={styles.imageFallbackText}>No image</Text>
                    </View>
                  )}
                </View>

                <View style={styles.itemInfo}>
                  <Text style={styles.itemName} numberOfLines={2}>
                    {selectedItemName || 'Unnamed item'}
                  </Text>
                  <Pressable
                    onPress={() => {
                      onPricePress().catch(() => {
                        setItemError('Unable to open product link.');
                      });
                    }}
                    disabled={!selectedItemUrl}
                    hitSlop={8}
                  >
                    <Text style={[styles.itemPrice, !selectedItemUrl ? styles.itemPriceDisabled : null]}>
                      {selectedItemPrice || 'Price unavailable'}
                    </Text>
                  </Pressable>
                </View>
              </View>
            </View>
          ) : null}
      </View>

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
    backgroundColor: '#4caf85',
    borderRadius: 1,
    height: 2,
    position: 'absolute',
    width: 2,
  },
  nodeDotSelected: {
    backgroundColor: '#FF6B35',
    borderColor: '#FFE9DF',
    borderWidth: 0.5,
  },
  popupContainer: {
    left: 8,
    position: 'absolute',
    right: 8,
    top: 8,
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
  loadingText: {
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 8,
    color: '#0B5FFF',
    fontSize: 12,
    fontWeight: '600',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  errorText: {
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 8,
    color: '#B3261E',
    fontSize: 12,
    fontWeight: '600',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  itemCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.97)',
    borderColor: '#E8E8E8',
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    minHeight: 120,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
  },
  closeButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.08)',
    borderRadius: 10,
    height: 20,
    justifyContent: 'center',
    position: 'absolute',
    right: 8,
    top: 8,
    width: 20,
    zIndex: 1,
  },
  closeButtonText: {
    color: '#0F172A',
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 12,
  },
  imageContainer: {
    borderTopLeftRadius: 10,
    borderBottomLeftRadius: 10,
    overflow: 'hidden',
    width: 110,
  },
  itemImage: {
    backgroundColor: '#F1F5F9',
    height: 120,
    width: 110,
  },
  imageFallback: {
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    height: 120,
    justifyContent: 'center',
    width: 110,
  },
  imageFallbackText: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '600',
  },
  itemInfo: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  itemName: {
    color: '#0F172A',
    fontSize: 15,
    fontWeight: '600',
  },
  itemPrice: {
    color: '#007AFF',
    fontSize: 16,
    fontWeight: '600',
    marginTop: 6,
    textDecorationLine: 'underline',
  },
  itemPriceDisabled: {
    color: '#64748B',
    textDecorationLine: 'none',
  },
});
