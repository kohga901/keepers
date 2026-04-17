import { useMemo, useState } from 'react';
import {
	ActivityIndicator,
	LayoutChangeEvent,
	Modal,
	Pressable,
	StyleSheet,
	Text,
	View,
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useHeaderHeight } from '@react-navigation/elements';

import { GraphPoint, useEmbeddingGraph } from '../../contexts/EmbeddingGraphContext';
import { useAppTheme } from '../../hooks/useAppTheme';

const AnimatedView = Animated.createAnimatedComponent(View);

const GRAPH_PADDING = 18;
const MIN_SCALE = 1;
const MAX_SCALE = 7;
const MAX_RENDERED_POINTS = 1800;
const INTERACTIVE_NEARBY_LIMIT = 220;

type Coordinates2D = {
	x: number;
	y: number;
};

type PointBounds = {
	minX: number;
	maxX: number;
	minY: number;
	maxY: number;
};

type PositionedPoint = {
	point: GraphPoint;
	x: number;
	y: number;
};

function downsamplePoints(points: GraphPoint[], maxPoints: number): GraphPoint[] {
	if (points.length <= maxPoints) {
		return points;
	}

	const stride = Math.ceil(points.length / maxPoints);
	const sampled: GraphPoint[] = [];

	for (let index = 0; index < points.length; index += stride) {
		sampled.push(points[index]);
	}

	return sampled;
}

function computeBounds(points: GraphPoint[], userPosition: Coordinates2D | null): PointBounds {
	if (points.length === 0 && !userPosition) {
		return {
			minX: -1,
			maxX: 1,
			minY: -1,
			maxY: 1,
		};
	}

	let minX = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;

	for (const point of points) {
		minX = Math.min(minX, point.x);
		maxX = Math.max(maxX, point.x);
		minY = Math.min(minY, point.y);
		maxY = Math.max(maxY, point.y);
	}

	if (userPosition) {
		minX = Math.min(minX, userPosition.x);
		maxX = Math.max(maxX, userPosition.x);
		minY = Math.min(minY, userPosition.y);
		maxY = Math.max(maxY, userPosition.y);
	}

	if (!Number.isFinite(minX) || !Number.isFinite(maxX)) {
		minX = -1;
		maxX = 1;
	}

	if (!Number.isFinite(minY) || !Number.isFinite(maxY)) {
		minY = -1;
		maxY = 1;
	}

	if (Math.abs(maxX - minX) < 1e-6) {
		maxX += 1;
		minX -= 1;
	}

	if (Math.abs(maxY - minY) < 1e-6) {
		maxY += 1;
		minY -= 1;
	}

	return {
		minX,
		maxX,
		minY,
		maxY,
	};
}

function worldToScreen(
	coordinates: Coordinates2D,
	bounds: PointBounds,
	width: number,
	height: number,
	padding: number,
): Coordinates2D {
	const usableWidth = Math.max(width - padding * 2, 1);
	const usableHeight = Math.max(height - padding * 2, 1);
	const xSpan = bounds.maxX - bounds.minX;
	const ySpan = bounds.maxY - bounds.minY;

	const xRatio = (coordinates.x - bounds.minX) / xSpan;
	const yRatio = (coordinates.y - bounds.minY) / ySpan;

	return {
		x: padding + xRatio * usableWidth,
		y: padding + (1 - yRatio) * usableHeight,
	};
}

function selectNearbyPoints(
	points: GraphPoint[],
	userPosition: Coordinates2D | null,
	limit: number,
): GraphPoint[] {
	if (points.length <= limit) {
		return points;
	}

	if (!userPosition) {
		return points.slice(0, limit);
	}

	const ranked = points
		.map((point) => {
			const dx = point.x - userPosition.x;
			const dy = point.y - userPosition.y;
			return {
				point,
				distanceSquared: dx * dx + dy * dy,
			};
		})
		.sort((first, second) => first.distanceSquared - second.distanceSquared)
		.slice(0, limit)
		.map((entry) => entry.point);

	return ranked;
}

function clampTranslation(value: number, scale: number, size: number): number {
	'worklet';
	const maxOffset = ((scale - 1) * size) / 2;

	if (maxOffset <= 0) {
		return 0;
	}

	return Math.max(-maxOffset, Math.min(maxOffset, value));
}

export default function Graph() {
	const { theme } = useAppTheme();
	const headerHeight = useHeaderHeight();
	const router = useRouter();
	const {
		graphPoints,
		userPosition,
		projectionVersion,
		pendingSyncCount,
		isGraphLoading,
		graphError,
		refreshGraphData,
	} = useEmbeddingGraph();

	const [selectedPoint, setSelectedPoint] = useState<GraphPoint | null>(null);
	const [viewport, setViewport] = useState({ width: 0, height: 0 });

	const scale = useSharedValue(1);
	const pinchStartScale = useSharedValue(1);
	const translateX = useSharedValue(0);
	const translateY = useSharedValue(0);
	const panStartX = useSharedValue(0);
	const panStartY = useSharedValue(0);
	const viewportWidth = useSharedValue(1);
	const viewportHeight = useSharedValue(1);

	const sampledPoints = useMemo(() => {
		return downsamplePoints(graphPoints, MAX_RENDERED_POINTS);
	}, [graphPoints]);

	const nearbyInteractivePoints = useMemo(() => {
		return selectNearbyPoints(graphPoints, userPosition, INTERACTIVE_NEARBY_LIMIT);
	}, [graphPoints, userPosition]);

	const nearbyPointIds = useMemo(() => {
		return new Set(nearbyInteractivePoints.map((point) => point.id));
	}, [nearbyInteractivePoints]);

	const graphBounds = useMemo(() => {
		return computeBounds(graphPoints, userPosition);
	}, [graphPoints, userPosition]);

	const positionedSampledPoints = useMemo<PositionedPoint[]>(() => {
		if (viewport.width === 0 || viewport.height === 0) {
			return [];
		}

		return sampledPoints.map((point) => {
			const screenPoint = worldToScreen(point, graphBounds, viewport.width, viewport.height, GRAPH_PADDING);
			return {
				point,
				x: screenPoint.x,
				y: screenPoint.y,
			};
		});
	}, [graphBounds, sampledPoints, viewport.height, viewport.width]);

	const positionedInteractivePoints = useMemo<PositionedPoint[]>(() => {
		if (viewport.width === 0 || viewport.height === 0) {
			return [];
		}

		return nearbyInteractivePoints.map((point) => {
			const screenPoint = worldToScreen(point, graphBounds, viewport.width, viewport.height, GRAPH_PADDING);
			return {
				point,
				x: screenPoint.x,
				y: screenPoint.y,
			};
		});
	}, [graphBounds, nearbyInteractivePoints, viewport.height, viewport.width]);

	const positionedUserPoint = useMemo(() => {
		if (!userPosition || viewport.width === 0 || viewport.height === 0) {
			return null;
		}

		return worldToScreen(userPosition, graphBounds, viewport.width, viewport.height, GRAPH_PADDING);
	}, [graphBounds, userPosition, viewport.height, viewport.width]);

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

	const resetGesture = Gesture.Tap()
		.numberOfTaps(2)
		.onEnd(() => {
			scale.value = 1;
			translateX.value = 0;
			translateY.value = 0;
		});

	const combinedGesture = Gesture.Simultaneous(resetGesture, panGesture, pinchGesture);

	const onViewportLayout = (event: LayoutChangeEvent) => {
		const { width, height } = event.nativeEvent.layout;
		setViewport({ width, height });
		viewportWidth.value = Math.max(width, 1);
		viewportHeight.value = Math.max(height, 1);
	};

	const openSelectedUrl = async () => {
		if (!selectedPoint?.itemUrl) {
			return;
		}

		await WebBrowser.openBrowserAsync(selectedPoint.itemUrl);
	};

	const goToSwiperTab = () => {
		const focusedItemId = selectedPoint?.id;
		setSelectedPoint(null);

		if (focusedItemId) {
			router.push({
				pathname: '/(tabs)/swiper',
				params: { focusItemId: focusedItemId },
			});
			return;
		}

		router.push('/(tabs)/swiper');
	};

	const isLoadingInitialState = isGraphLoading && graphPoints.length === 0;

	return (
		<View
			style={[
				styles.container,
				{ backgroundColor: theme.background, paddingTop: headerHeight + 8 },
			]}
		>
			<View style={styles.headerRow}>
				<Text style={[styles.title, { color: theme.text }]}>Embedding Graph</Text>
				<Pressable style={styles.refreshButton} onPress={() => void refreshGraphData()}>
					<Text style={styles.refreshButtonText}>Refresh</Text>
				</Pressable>
			</View>

			<Text style={[styles.metaText, { color: theme.text }]}>
				{graphPoints.length} nodes · projection {projectionVersion} · pending sync {pendingSyncCount}
			</Text>

			{graphError ? <Text style={styles.errorText}>{graphError}</Text> : null}

			<GestureDetector gesture={combinedGesture}>
				<View style={styles.graphViewport} onLayout={onViewportLayout}>
					<AnimatedView style={[styles.graphLayer, transformStyle]}>
						{positionedSampledPoints.map(({ point, x, y }) => {
							const nearby = nearbyPointIds.has(point.id);

							return (
								<View
									key={`sample-${point.id}`}
									pointerEvents="none"
									style={[
										styles.samplePoint,
										{
											left: x - 1.5,
											top: y - 1.5,
											backgroundColor: nearby ? '#2563EB' : '#2D3E50',
										},
									]}
								/>
							);
						})}

						{positionedInteractivePoints.map(({ point, x, y }) => {
							return (
								<Pressable
									key={`hit-${point.id}`}
									style={[
										styles.interactivePoint,
										{
											left: x - 6,
											top: y - 6,
										},
									]}
									onPress={() => setSelectedPoint(point)}
								/>
							);
						})}

						{positionedUserPoint ? (
							<View
								pointerEvents="none"
								style={[
									styles.userPoint,
									{
										left: positionedUserPoint.x - 7,
										top: positionedUserPoint.y - 7,
									},
								]}
							/>
						) : null}
					</AnimatedView>

					{isLoadingInitialState ? (
						<View style={styles.loadingOverlay}>
							<ActivityIndicator size="large" color={theme.primary} />
							<Text style={[styles.metaText, { color: theme.text }]}>Loading graph nodes...</Text>
						</View>
					) : null}

					{!isLoadingInitialState && graphPoints.length === 0 ? (
						<View style={styles.loadingOverlay}>
							<Text style={[styles.metaText, { color: theme.text }]}>No graph nodes available yet.</Text>
						</View>
					) : null}
				</View>
			</GestureDetector>

			<Text style={[styles.helpText, { color: theme.text }]}>Pinch to zoom, drag to pan, double tap to reset.</Text>

			<Modal
				visible={selectedPoint !== null}
				animationType="slide"
				transparent
				onRequestClose={() => setSelectedPoint(null)}
			>
				<View style={styles.modalRoot}>
					<Pressable style={styles.backdrop} onPress={() => setSelectedPoint(null)} />
					<View style={[styles.sheet, { backgroundColor: '#FFFFFF', borderColor: theme.border }]}>
						{selectedPoint?.imageUrl ? (
							<Image
								style={styles.sheetImage}
								source={{ uri: selectedPoint.imageUrl }}
								contentFit="cover"
								transition={200}
							/>
						) : (
							<View style={[styles.sheetImage, styles.sheetImageFallback]}>
								<Text style={styles.sheetImageFallbackText}>No Image</Text>
							</View>
						)}

						<Text style={styles.sheetTitle}>{selectedPoint?.name ?? 'Item'}</Text>
						<Text style={styles.sheetPrice}>{selectedPoint?.price ?? 'Price unavailable'}</Text>

						<View style={styles.sheetButtonsRow}>
							<Pressable style={styles.sheetButtonPrimary} onPress={() => void openSelectedUrl()}>
								<Text style={styles.sheetButtonPrimaryText}>Open Listing</Text>
							</Pressable>
							<Pressable style={styles.sheetButtonSecondary} onPress={goToSwiperTab}>
								<Text style={styles.sheetButtonSecondaryText}>Go To Swiper</Text>
							</Pressable>
						</View>
					</View>
				</View>
			</Modal>
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
	refreshButton: {
		backgroundColor: '#101519',
		borderRadius: 8,
		paddingHorizontal: 12,
		paddingVertical: 8,
	},
	refreshButtonText: {
		color: '#F7F2EC',
		fontSize: 13,
		fontWeight: '700',
	},
	metaText: {
		fontSize: 13,
		fontWeight: '500',
		marginTop: 8,
	},
	errorText: {
		color: '#B91C1C',
		fontSize: 12,
		marginTop: 8,
	},
	graphViewport: {
		backgroundColor: '#EEF2F5',
		borderColor: '#C8D5E0',
		borderRadius: 12,
		borderWidth: 1,
		flex: 1,
		marginTop: 12,
		overflow: 'hidden',
	},
	graphLayer: {
		...StyleSheet.absoluteFillObject,
	},
	samplePoint: {
		borderRadius: 2,
		height: 3,
		position: 'absolute',
		width: 3,
	},
	interactivePoint: {
		backgroundColor: 'rgba(59,130,246,0.15)',
		borderColor: '#1D4ED8',
		borderRadius: 6,
		borderWidth: 1,
		height: 12,
		position: 'absolute',
		width: 12,
	},
	userPoint: {
		backgroundColor: '#DC2626',
		borderColor: '#FFFFFF',
		borderRadius: 7,
		borderWidth: 2,
		height: 14,
		position: 'absolute',
		width: 14,
	},
	loadingOverlay: {
		alignItems: 'center',
		bottom: 0,
		justifyContent: 'center',
		left: 0,
		position: 'absolute',
		right: 0,
		top: 0,
	},
	helpText: {
		fontSize: 12,
		fontWeight: '500',
		marginTop: 10,
	},
	modalRoot: {
		flex: 1,
		justifyContent: 'flex-end',
	},
	backdrop: {
		...StyleSheet.absoluteFillObject,
		backgroundColor: 'rgba(0,0,0,0.35)',
	},
	sheet: {
		borderTopLeftRadius: 20,
		borderTopRightRadius: 20,
		borderWidth: 1,
		paddingBottom: 28,
		paddingHorizontal: 16,
		paddingTop: 14,
	},
	sheetImage: {
		backgroundColor: '#E5E7EB',
		borderRadius: 14,
		height: 220,
		width: '100%',
	},
	sheetImageFallback: {
		alignItems: 'center',
		justifyContent: 'center',
	},
	sheetImageFallbackText: {
		color: '#4B5563',
		fontSize: 16,
		fontWeight: '600',
	},
	sheetTitle: {
		color: '#0F172A',
		fontSize: 20,
		fontWeight: '700',
		marginTop: 14,
	},
	sheetPrice: {
		color: '#0369A1',
		fontSize: 18,
		fontWeight: '700',
		marginTop: 8,
	},
	sheetButtonsRow: {
		flexDirection: 'row',
		gap: 10,
		marginTop: 16,
	},
	sheetButtonPrimary: {
		alignItems: 'center',
		backgroundColor: '#111827',
		borderRadius: 10,
		flex: 1,
		paddingVertical: 12,
	},
	sheetButtonPrimaryText: {
		color: '#FFFFFF',
		fontSize: 14,
		fontWeight: '700',
	},
	sheetButtonSecondary: {
		alignItems: 'center',
		backgroundColor: '#E5E7EB',
		borderRadius: 10,
		flex: 1,
		paddingVertical: 12,
	},
	sheetButtonSecondaryText: {
		color: '#111827',
		fontSize: 14,
		fontWeight: '700',
	},
});
