import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
	ActivityIndicator,
	LayoutChangeEvent,
	Pressable,
	StyleSheet,
	Text,
	View,
} from 'react-native';
import { Image } from 'expo-image';
import { useIsFocused } from '@react-navigation/native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';

import { useAppTheme } from '../../hooks/useAppTheme';
import { getClothingById, getUserCoordinates } from '../../services/dataServices';
import { supabase } from '../../utils/supabase';
import * as WebBrowser from 'expo-web-browser';

type NodePoint = {
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

type SelectedItem = {
	id: string;
	name: string;
	price: string;
	imageUrl: string;
	itemUrl: string;
};

type SelectedAnchor = {
	x: number;
	y: number;
};

type PlotSize = {
	width: number;
	height: number;
};

type PreferencePoint = {
	x: number;
	y: number;
};

// Raw graph data loaded from the generated node dataset.
const RAW_NODE_DATA: unknown = require('../../data/nodeData.json');

// Utility helpers used by both the WebView graph and the React overlay.
function clamp(value: number, min: number, max: number): number {
	if (min > max) {
		return min;
	}

	return Math.max(min, Math.min(max, value));
}

// Convert the JSON payload into a predictable list of graph points.
function normalizeNodeData(raw: unknown): NodePoint[] {
	const source = (raw as { default?: unknown })?.default ?? raw;
	if (!Array.isArray(source)) {
		return [];
	}

	return source
		.map((entry) => {
			const row = entry as { clothesId?: unknown; x?: unknown; y?: unknown };

			return {
				clothesId: Number(row.clothesId),
				x: Number(row.x),
				y: Number(row.y),
			};
		})
		.filter(
			(point) =>
				Number.isFinite(point.clothesId) &&
				Number.isFinite(point.x) &&
				Number.isFinite(point.y)
		);
}

// Find the outer world-space bounds so the graph can be framed on load.
function calculateBounds(points: NodePoint[]): Bounds | null {
	if (points.length === 0) {
		return null;
	}

	let minX = points[0].x;
	let maxX = points[0].x;
	let minY = points[0].y;
	let maxY = points[0].y;

	for (const point of points) {
		if (point.x < minX) minX = point.x;
		if (point.x > maxX) maxX = point.x;
		if (point.y < minY) minY = point.y;
		if (point.y > maxY) maxY = point.y;
	}

	return { minX, maxX, minY, maxY };
}

// Build the HTML and canvas renderer that run inside the WebView.
function buildPlotHtml(points: NodePoint[], bounds: Bounds, colors: {
	background: string;
	grid: string;
	axis: string;
	point: string;
	pointSelected: string;
	pointPreference: string;
	text: string;
}, preferencePoint: PreferencePoint | null) {
	const pointsJson = JSON.stringify(points);
	const boundsJson = JSON.stringify(bounds);
	const colorsJson = JSON.stringify(colors);
	const preferenceJson = preferencePoint ? JSON.stringify(preferencePoint) : 'null';

	return `
<!doctype html>
<html>
<head>
	<!-- WebView page setup and full-screen canvas styling. -->
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
	<style>
		html, body {
			margin: 0;
			padding: 0;
			width: 100%;
			height: 100%;
			overflow: hidden;
			background: ${colors.background};
			touch-action: none;
			overscroll-behavior: none;
		}
		#plot {
			display: block;
			width: 100%;
			height: 100%;
			background: ${colors.background};
		}
	</style>
</head>
<body>
	<canvas id="plot"></canvas>
	<script>
		(function () {
			const POINTS = ${pointsJson};
			const BOUNDS = ${boundsJson};
			const COLORS = ${colorsJson};
			const PREFERENCE_POINT = ${preferenceJson};

			const MIN_ZOOM_EXP = -120;
			const MAX_ZOOM_EXP = 120;
			const TAP_DISTANCE_PX = 12;
			const ANCHOR_EPSILON = 0.7;

			const canvas = document.getElementById('plot');
			const ctx = canvas.getContext('2d');

			// Camera state tracks pan, zoom, and which node is selected.
			const camera = {
				centerX: (BOUNDS.minX + BOUNDS.maxX) * 0.5,
				centerY: (BOUNDS.minY + BOUNDS.maxY) * 0.5,
				zoomExp: 0,
				selectedId: null,
			};

			// Touch bookkeeping keeps pan, pinch, and tap behavior separated.
			const touchState = {
				points: new Map(),
				mode: 'none',
				lastSingle: null,
				lastMid: null,
				lastDistance: 0,
				maxMovement: 0,
				hadMultiTouchGesture: false,
			};

			// Mouse bookkeeping mirrors the touch tap/pan behavior on desktop.
			const mouseState = {
				down: false,
				moved: 0,
				lastX: 0,
				lastY: 0,
			};

			// Canvas size and draw scheduling state.
			let width = 1;
			let height = 1;
			let dpr = Math.max(1, window.devicePixelRatio || 1);
			let rafPending = false;
			let lastAnchorSent = null;

			// Bridge messages go back to React Native when selection changes.
			function postMessage(payload) {
				if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
					window.ReactNativeWebView.postMessage(JSON.stringify(payload));
				}
			}

			function scale() {
				return Math.pow(2, camera.zoomExp);
			}

			function sanitizeCamera() {
				if (!Number.isFinite(camera.centerX)) camera.centerX = 0;
				if (!Number.isFinite(camera.centerY)) camera.centerY = 0;
				if (!Number.isFinite(camera.zoomExp)) camera.zoomExp = 0;
				if (camera.zoomExp < MIN_ZOOM_EXP) camera.zoomExp = MIN_ZOOM_EXP;
				if (camera.zoomExp > MAX_ZOOM_EXP) camera.zoomExp = MAX_ZOOM_EXP;
			}

			function worldToScreen(x, y) {
				const s = scale();
				return {
					x: (x - camera.centerX) * s + width * 0.5,
					y: (camera.centerY - y) * s + height * 0.5,
				};
			}

			function screenToWorld(sx, sy, customScale) {
				const s = customScale || scale();
				return {
					x: (sx - width * 0.5) / s + camera.centerX,
					y: camera.centerY - (sy - height * 0.5) / s,
				};
			}

			function niceStep(target) {
				const safe = Math.max(target, 1e-18);
				const exponent = Math.floor(Math.log10(safe));
				const magnitude = Math.pow(10, exponent);
				const residual = safe / magnitude;
				let base = 1;

				if (residual > 5) {
					base = 10;
				} else if (residual > 2) {
					base = 5;
				} else if (residual > 1) {
					base = 2;
				}

				return base * magnitude;
			}

			// Keep the canvas resolution aligned with the visible viewport.
			function configureCanvas() {
				dpr = Math.max(1, window.devicePixelRatio || 1);
				width = Math.max(1, window.innerWidth);
				height = Math.max(1, window.innerHeight);
				canvas.width = Math.round(width * dpr);
				canvas.height = Math.round(height * dpr);
				canvas.style.width = width + 'px';
				canvas.style.height = height + 'px';
				ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
			}

			// Batch redraws so drag and pinch updates stay smooth.
			function scheduleDraw() {
				if (rafPending) return;
				rafPending = true;
				requestAnimationFrame(function () {
					rafPending = false;
					draw();
				});
			}

			// Draw the background grid and axis lines behind the points.
			function drawGrid() {
				const s = scale();
				const worldStep = niceStep(90 / s);

				const minWorld = screenToWorld(0, height);
				const maxWorld = screenToWorld(width, 0);

				const startX = Math.floor(minWorld.x / worldStep) * worldStep;
				const endX = Math.ceil(maxWorld.x / worldStep) * worldStep;
				const startY = Math.floor(minWorld.y / worldStep) * worldStep;
				const endY = Math.ceil(maxWorld.y / worldStep) * worldStep;

				ctx.lineWidth = 1;
				ctx.strokeStyle = COLORS.grid;
				ctx.beginPath();

				for (let x = startX; x <= endX; x += worldStep) {
					const sx = worldToScreen(x, 0).x;
					ctx.moveTo(sx, 0);
					ctx.lineTo(sx, height);
				}

				for (let y = startY; y <= endY; y += worldStep) {
					const sy = worldToScreen(0, y).y;
					ctx.moveTo(0, sy);
					ctx.lineTo(width, sy);
				}

				ctx.stroke();

				ctx.strokeStyle = COLORS.axis;
				ctx.lineWidth = 1.5;
				ctx.beginPath();

				const xAxisY = worldToScreen(0, 0).y;
				const yAxisX = worldToScreen(0, 0).x;

				ctx.moveTo(0, xAxisY);
				ctx.lineTo(width, xAxisY);
				ctx.moveTo(yAxisX, 0);
				ctx.lineTo(yAxisX, height);
				ctx.stroke();
			}

			// Send the current anchor position for the selected node back to React.
			function sendSelectedAnchor(clothesId, x, y) {
				if (!Number.isFinite(clothesId) || !Number.isFinite(x) || !Number.isFinite(y)) {
					return;
				}

				if (
					lastAnchorSent &&
					lastAnchorSent.clothesId === clothesId &&
					Math.abs(lastAnchorSent.x - x) < ANCHOR_EPSILON &&
					Math.abs(lastAnchorSent.y - y) < ANCHOR_EPSILON
				) {
					return;
				}

				lastAnchorSent = { clothesId, x, y };
				postMessage({ type: 'selectedAnchor', clothesId, screenX: x, screenY: y });
			}

			// Render all visible points and remember the selected point's screen position.
			function drawPoints() {
				let selectedScreen = null;

				for (let i = 0; i < POINTS.length; i += 1) {
					const point = POINTS[i];
					const screen = worldToScreen(point.x, point.y);
					if (screen.x < -20 || screen.x > width + 20 || screen.y < -20 || screen.y > height + 20) {
						continue;
					}

					const selected = camera.selectedId === point.clothesId;
					if (selected) {
						selectedScreen = screen;
					}
					ctx.fillStyle = selected ? COLORS.pointSelected : COLORS.point;
					ctx.beginPath();
					ctx.arc(screen.x, screen.y, selected ? 4.8 : 2.9, 0, Math.PI * 2);
					ctx.fill();
				}

				return selectedScreen;
			}

			function drawPreferencePoint() {
				if (!PREFERENCE_POINT) {
					return;
				}

				const screen = worldToScreen(PREFERENCE_POINT.x, PREFERENCE_POINT.y);
				if (screen.x < -24 || screen.x > width + 24 || screen.y < -24 || screen.y > height + 24) {
					return;
				}

				ctx.fillStyle = COLORS.pointPreference;
				ctx.beginPath();
				ctx.arc(screen.x, screen.y, 6.5, 0, Math.PI * 2);
				ctx.fill();

				ctx.strokeStyle = '#ffffff';
				ctx.lineWidth = 1.8;
				ctx.beginPath();
				ctx.arc(screen.x, screen.y, 9, 0, Math.PI * 2);
				ctx.stroke();
			}

			// Clear, redraw, and notify React when the selected anchor moves or disappears.
			function draw() {
				sanitizeCamera();
				ctx.clearRect(0, 0, width, height);
				drawGrid();
				const selectedScreen = drawPoints();
				drawPreferencePoint();

				if (camera.selectedId !== null) {
					if (selectedScreen) {
						sendSelectedAnchor(camera.selectedId, selectedScreen.x, selectedScreen.y);
					} else if (lastAnchorSent !== null) {
						lastAnchorSent = null;
						postMessage({ type: 'selectedAnchorHidden', clothesId: camera.selectedId });
					}
				}
			}

			// Find the closest point to a tap location in screen space.
			function findNearestPoint(sx, sy) {
				let winnerPoint = null;
				let winnerScreenX = 0;
				let winnerScreenY = 0;
				let bestSq = Number.POSITIVE_INFINITY;
				const maxSq = TAP_DISTANCE_PX * TAP_DISTANCE_PX;

				for (let i = 0; i < POINTS.length; i += 1) {
					const point = POINTS[i];
					const screen = worldToScreen(point.x, point.y);
					const dx = screen.x - sx;
					const dy = screen.y - sy;
					const sq = dx * dx + dy * dy;

					if (sq < bestSq) {
						bestSq = sq;
						winnerPoint = point;
						winnerScreenX = screen.x;
						winnerScreenY = screen.y;
					}
				}

				if (!winnerPoint || bestSq > maxSq) {
					return null;
				}

				return {
					point: winnerPoint,
					screenX: winnerScreenX,
					screenY: winnerScreenY,
				};
			}

			// Handle a tap by selecting the nearest node or clearing the selection.
			function selectPointFromTap(sx, sy) {
				const nearest = findNearestPoint(sx, sy);
				if (!nearest) {
					camera.selectedId = null;
					lastAnchorSent = null;
					postMessage({ type: 'clearSelection' });
					scheduleDraw();
					return;
				}

				camera.selectedId = nearest.point.clothesId;
				lastAnchorSent = null;
				postMessage({
					type: 'pointSelected',
					clothesId: nearest.point.clothesId,
					screenX: nearest.screenX,
					screenY: nearest.screenY,
				});
				scheduleDraw();
			}

			// Touch helpers for pan and pinch gesture tracking.
			function getTwoActiveTouches() {
				const values = Array.from(touchState.points.values());
				if (values.length < 2) return null;
				return [values[0], values[1]];
			}

			function touchDistance(a, b) {
				const dx = a.x - b.x;
				const dy = a.y - b.y;
				return Math.hypot(dx, dy);
			}

			function touchMid(a, b) {
				return {
					x: (a.x + b.x) * 0.5,
					y: (a.y + b.y) * 0.5,
				};
			}

			function beginPan(singleTouch) {
				touchState.mode = 'pan';
				touchState.lastSingle = singleTouch;
				touchState.maxMovement = 0;
			}

			function beginPinch() {
				const touches = getTwoActiveTouches();
				if (!touches) return;
				const mid = touchMid(touches[0], touches[1]);
				const dist = touchDistance(touches[0], touches[1]);
				touchState.mode = 'pinch';
				touchState.lastMid = mid;
				touchState.lastDistance = dist;
				touchState.maxMovement = 0;
				touchState.hadMultiTouchGesture = true;
			}

			function activeTouchesCount() {
				return touchState.points.size;
			}

			// Touch listeners support pan, pinch zoom, and tap selection.
			canvas.addEventListener('touchstart', function (event) {
				event.preventDefault();
				for (let i = 0; i < event.changedTouches.length; i += 1) {
					const t = event.changedTouches[i];
					touchState.points.set(t.identifier, { x: t.clientX, y: t.clientY });
				}

				const count = activeTouchesCount();
				if (count === 1) {
					touchState.hadMultiTouchGesture = false;
					const single = Array.from(touchState.points.values())[0];
					beginPan(single);
				} else if (count >= 2) {
					touchState.hadMultiTouchGesture = true;
					beginPinch();
				}
			}, { passive: false });

			canvas.addEventListener('touchmove', function (event) {
				event.preventDefault();

				for (let i = 0; i < event.changedTouches.length; i += 1) {
					const t = event.changedTouches[i];
					if (touchState.points.has(t.identifier)) {
						touchState.points.set(t.identifier, { x: t.clientX, y: t.clientY });
					}
				}

				const count = activeTouchesCount();

				if (count === 1 && touchState.mode === 'pan') {
					const current = Array.from(touchState.points.values())[0];
					const prev = touchState.lastSingle;
					if (!prev) {
						touchState.lastSingle = current;
						return;
					}

					const dx = current.x - prev.x;
					const dy = current.y - prev.y;
					touchState.maxMovement = Math.max(touchState.maxMovement, Math.hypot(dx, dy));

					const s = scale();
					camera.centerX -= dx / s;
					camera.centerY += dy / s;

					touchState.lastSingle = current;
					scheduleDraw();
					return;
				}

				if (count >= 2) {
					touchState.hadMultiTouchGesture = true;
					const touches = getTwoActiveTouches();
					if (!touches) return;

					const mid = touchMid(touches[0], touches[1]);
					const dist = touchDistance(touches[0], touches[1]);

					if (touchState.mode !== 'pinch') {
						beginPinch();
						return;
					}

					const prevMid = touchState.lastMid;
					const prevDist = touchState.lastDistance;
					if (!prevMid || !Number.isFinite(prevDist) || prevDist <= 0 || dist <= 0) {
						touchState.lastMid = mid;
						touchState.lastDistance = dist;
						return;
					}

					const oldScale = scale();
					const moveDx = mid.x - prevMid.x;
					const moveDy = mid.y - prevMid.y;
					touchState.maxMovement = Math.max(touchState.maxMovement, Math.hypot(moveDx, moveDy));

					camera.centerX -= moveDx / oldScale;
					camera.centerY += moveDy / oldScale;

					const worldAtMid = {
						x: (mid.x - width * 0.5) / oldScale + camera.centerX,
						y: camera.centerY - (mid.y - height * 0.5) / oldScale,
					};

					const zoomDelta = Math.log2(dist / prevDist);
					if (Number.isFinite(zoomDelta)) {
						camera.zoomExp += zoomDelta;
						sanitizeCamera();

						const newScale = scale();
						camera.centerX = worldAtMid.x - (mid.x - width * 0.5) / newScale;
						camera.centerY = worldAtMid.y + (mid.y - height * 0.5) / newScale;
					}

					touchState.lastMid = mid;
					touchState.lastDistance = dist;
					scheduleDraw();
				}
			}, { passive: false });

			function handleTouchEnd(event) {
				event.preventDefault();

				const priorMode = touchState.mode;
				const priorMovement = touchState.maxMovement;

				for (let i = 0; i < event.changedTouches.length; i += 1) {
					const t = event.changedTouches[i];
					touchState.points.delete(t.identifier);
				}

				const count = activeTouchesCount();

				if (count === 0) {
					if (!touchState.hadMultiTouchGesture && priorMode === 'pan' && priorMovement < 7 && event.changedTouches.length > 0) {
						const tap = event.changedTouches[0];
						selectPointFromTap(tap.clientX, tap.clientY);
					}
					touchState.mode = 'none';
					touchState.lastSingle = null;
					touchState.lastMid = null;
					touchState.lastDistance = 0;
					touchState.maxMovement = 0;
					touchState.hadMultiTouchGesture = false;
					return;
				}

				if (count === 1) {
					const single = Array.from(touchState.points.values())[0];
					beginPan(single);
					return;
				}

				beginPinch();
			}

			canvas.addEventListener('touchend', handleTouchEnd, { passive: false });
			canvas.addEventListener('touchcancel', handleTouchEnd, { passive: false });

			// Wheel zoom keeps the pointer location anchored while scaling.
			canvas.addEventListener('wheel', function (event) {
				event.preventDefault();
				const oldScale = scale();
				const worldAtPointer = screenToWorld(event.clientX, event.clientY, oldScale);

				camera.zoomExp += -event.deltaY * 0.0025;
				sanitizeCamera();

				const newScale = scale();
				camera.centerX = worldAtPointer.x - (event.clientX - width * 0.5) / newScale;
				camera.centerY = worldAtPointer.y + (event.clientY - height * 0.5) / newScale;
				scheduleDraw();
			}, { passive: false });

			// Desktop mouse support mirrors the touch interactions above.
			canvas.addEventListener('mousedown', function (event) {
				mouseState.down = true;
				mouseState.moved = 0;
				mouseState.lastX = event.clientX;
				mouseState.lastY = event.clientY;
			});

			window.addEventListener('mousemove', function (event) {
				if (!mouseState.down) return;

				const dx = event.clientX - mouseState.lastX;
				const dy = event.clientY - mouseState.lastY;
				mouseState.moved = Math.max(mouseState.moved, Math.hypot(dx, dy));

				const s = scale();
				camera.centerX -= dx / s;
				camera.centerY += dy / s;

				mouseState.lastX = event.clientX;
				mouseState.lastY = event.clientY;
				scheduleDraw();
			});

			window.addEventListener('mouseup', function (event) {
				if (!mouseState.down) return;
				mouseState.down = false;
				if (mouseState.moved < 5) {
					selectPointFromTap(event.clientX, event.clientY);
				}
			});

			// Recompute the canvas size whenever the viewport changes.
			window.addEventListener('resize', function () {
				configureCanvas();
				scheduleDraw();
			});

			// Start with the graph framed to the available viewport.
			(function initZoom() {
				const rangeX = Math.max(1e-9, BOUNDS.maxX - BOUNDS.minX);
				const rangeY = Math.max(1e-9, BOUNDS.maxY - BOUNDS.minY);
				const paddedX = rangeX * 1.2;
				const paddedY = rangeY * 1.2;

				configureCanvas();

				const scaleFromX = width / paddedX;
				const scaleFromY = height / paddedY;
				const initialScale = Math.max(1e-9, Math.min(scaleFromX, scaleFromY));
				camera.zoomExp = Math.log2(initialScale);
				sanitizeCamera();
			})();

			// React Native can call this to clear the current selection.
			window.__keepersClearSelection = function () {
				camera.selectedId = null;
				lastAnchorSent = null;
				scheduleDraw();
			};

			scheduleDraw();
		})();
	</script>
</body>
</html>
	`;
}

export default function GraphTab() {
	const { theme } = useAppTheme();
	const isFocused = useIsFocused();

	// Local UI state for the selected point and the item details popup.
	const [selectedPointId, setSelectedPointId] = useState<number | null>(null);
	const [selectedAnchor, setSelectedAnchor] = useState<SelectedAnchor | null>(null);
	const [plotSize, setPlotSize] = useState<PlotSize>({ width: 0, height: 0 });
	const [selectedItem, setSelectedItem] = useState<SelectedItem | null>(null);
	const [preferencePoint, setPreferencePoint] = useState<PreferencePoint | null>(null);
	const [isLoadingItem, setIsLoadingItem] = useState(false);
	const [loadError, setLoadError] = useState<string | null>(null);

	const webViewRef = useRef<WebView>(null);
	const itemCacheRef = useRef<Map<number, SelectedItem>>(new Map());

	// Normalize the dataset once and derive the graph bounds from it.
	const points = useMemo(() => normalizeNodeData(RAW_NODE_DATA), []);
	const bounds = useMemo(() => calculateBounds(points), [points]);

	useEffect(() => {
		if (!isFocused) {
			return;
		}

		let cancelled = false;

		const fetchPreferencePoint = async () => {
			if (!bounds) {
				if (!cancelled) {
					setPreferencePoint(null);
				}
				return;
			}

			const { data: userData, error: userError } = await supabase.auth.getUser();
			if (userError || !userData.user) {
				if (!cancelled) {
					setPreferencePoint(null);
				}
				return;
			}

			const coords = await getUserCoordinates(userData.user.id);
			if (!cancelled) {
				setPreferencePoint(coords ?? { x: 0, y: 0 });
			}
		};

		fetchPreferencePoint();

		return () => {
			cancelled = true;
		};
	}, [bounds, isFocused]);

	// Rebuild the WebView HTML whenever the theme colors or bounds change.
	const webContent = useMemo(() => {
		if (!bounds) {
			return '';
		}

		return buildPlotHtml(points, bounds, {
			background: theme.background,
			grid: '#d6cbc1',
			axis: '#6f6154',
			point: theme.primary,
			pointSelected: '#cf3c2f',
			pointPreference: '#24a7ff',
			text: '#5d5146',
		}, preferencePoint);
	}, [bounds, points, preferencePoint, theme.background, theme.primary]);

	// Load the selected item's metadata and cache it for repeat taps.
	useEffect(() => {
		if (selectedPointId == null) {
			setSelectedItem(null);
			setLoadError(null);
			setIsLoadingItem(false);
			return;
		}

		const cached = itemCacheRef.current.get(selectedPointId);
		if (cached) {
			setSelectedItem(cached);
			setLoadError(null);
			setIsLoadingItem(false);
			return;
		}

		let cancelled = false;

		const fetchItem = async () => {
			setIsLoadingItem(true);
			setLoadError(null);

			try {
				const data = await getClothingById(String(selectedPointId));

				if (cancelled) {
					return;
				}

				if (!data) {
					setSelectedItem(null);
					setLoadError('No clothing item found for this point.');
					return;
				}

				const mapped: SelectedItem = {
					id: String(data.item_id ?? selectedPointId),
					name: String(data.item_name ?? 'Unnamed item'),
					price: String(data.item_price ?? 'N/A'),
					imageUrl: String(data.item_img ?? ''),
					itemUrl: String(data.item_web_listing ?? ''),
				};

				itemCacheRef.current.set(selectedPointId, mapped);
				setSelectedItem(mapped);
			} catch {
				if (!cancelled) {
					setSelectedItem(null);
					setLoadError('Unable to load item details right now.');
				}
			} finally {
				if (!cancelled) {
					setIsLoadingItem(false);
				}
			}
		};

		fetchItem();

		return () => {
			cancelled = true;
		};
	}, [selectedPointId]);

	// Convert the graph anchor into an on-screen popup position.
	const popupPosition = useMemo(() => {
		if (!selectedAnchor || plotSize.width <= 0 || plotSize.height <= 0) {
			return null;
		}

		const cardWidth = 250;
		const cardHeight = selectedItem ? 168 : 126;
		const margin = 8;
		const topMin = 84;
		const aboveTop = selectedAnchor.y - cardHeight - 20;
		const showAbove = aboveTop >= topMin;
		const targetTop = showAbove ? aboveTop : selectedAnchor.y + 18;

		const left = clamp(
			selectedAnchor.x - cardWidth * 0.5,
			margin,
			plotSize.width - cardWidth - margin
		);

		const top = clamp(
			targetTop,
			topMin,
			plotSize.height - cardHeight - margin
		);

		const arrowLeft = clamp(selectedAnchor.x - left - 8, 12, cardWidth - 24);

		return {
			left,
			top,
			width: cardWidth,
			showAbove,
			arrowLeft,
		};
	}, [plotSize.height, plotSize.width, selectedAnchor, selectedItem]);

	// Clear the React selection and tell the WebView to do the same.
	const clearSelection = () => {
		setSelectedPointId(null);
		setSelectedAnchor(null);
		setSelectedItem(null);
		setLoadError(null);
		setIsLoadingItem(false);
		webViewRef.current?.injectJavaScript('window.__keepersClearSelection && window.__keepersClearSelection(); true;');
	};

	// Track the rendered size of the plot area so the popup can be clamped.
	const onPlotLayout = (event: LayoutChangeEvent) => {
		const { width, height } = event.nativeEvent.layout;
		setPlotSize({ width, height });
	};

	// Receive selection and anchor updates from the WebView renderer.
	const handleWebMessage = (event: WebViewMessageEvent) => {
		try {
			const payload = JSON.parse(event.nativeEvent.data) as {
				type?: string;
				clothesId?: number;
				screenX?: number;
				screenY?: number;
			};

			if (payload.type === 'clearSelection') {
				setSelectedPointId(null);
				setSelectedAnchor(null);
				return;
			}

			if (payload.type === 'selectedAnchorHidden') {
				setSelectedAnchor(null);
				return;
			}

			if (
				payload.type === 'selectedAnchor' &&
				Number.isFinite(payload.screenX) &&
				Number.isFinite(payload.screenY)
			) {
				setSelectedAnchor({
					x: Number(payload.screenX),
					y: Number(payload.screenY),
				});
				return;
			}

			if (
				payload.type === 'pointSelected' &&
				Number.isFinite(payload.clothesId)
			) {
				setSelectedPointId(Number(payload.clothesId));
				if (
					Number.isFinite(payload.screenX) &&
					Number.isFinite(payload.screenY)
				) {
					setSelectedAnchor({
						x: Number(payload.screenX),
						y: Number(payload.screenY),
					});
				}
			}
		} catch {
			// Ignore malformed bridge messages from the WebView.
		}
	};

	// Empty-state view when there is no usable graph data.
	if (!bounds || points.length === 0) {
		return (
			<View style={[styles.centered, { backgroundColor: theme.background }]}>
				<Text style={[styles.messageText, { color: theme.text }]}>No plot data found.</Text>
			</View>
		);
	}

	// Main graph screen: WebView plot plus floating details popup and title bar.
	return (
		<View style={[styles.container, { backgroundColor: theme.background }]}>
			{/* Plot canvas lives inside the WebView so rendering stays smooth. */}
			<View style={styles.plotWrap} onLayout={onPlotLayout}>
				<WebView
					ref={webViewRef}
					originWhitelist={['*']}
					source={{ html: webContent }}
					onMessage={handleWebMessage}
					javaScriptEnabled
					domStorageEnabled
					style={styles.webView}
				/>

				{/* Floating popup shows the selected node's item metadata. */}
				{selectedPointId != null && popupPosition ? (
					<View pointerEvents="box-none" style={styles.popupLayer}>
						<View
							style={[
								styles.popupCard,
								{
									left: popupPosition.left,
									top: popupPosition.top,
									width: popupPosition.width,
									backgroundColor: theme.surface,
									borderColor: theme.border,
								},
							]}
						>
							<View style={styles.popupHeader}>
								<Text style={styles.popupTitle}>Point #{selectedPointId}</Text>
								<Pressable onPress={clearSelection} style={styles.closeButton}>
									<Text style={styles.closeButtonText}>Close</Text>
								</Pressable>
							</View>

							{isLoadingItem ? (
								<View style={styles.loadingRow}>
									<ActivityIndicator size="small" color="#4caf85" />
									<Text style={styles.loadingText}>Loading item...</Text>
								</View>
							) : loadError ? (
								<Text style={styles.errorText}>{loadError}</Text>
							) : selectedItem ? (
								<View style={styles.itemRow}>
									<View style={styles.imageFrame}>
										{selectedItem.imageUrl ? (
											<Image
												style={styles.itemImage}
												source={{ uri: selectedItem.imageUrl }}
												contentFit="cover"
												transition={300}
											/>
										) : (
											<View style={styles.noImageWrap}>
												<Text style={styles.noImageText}>No Image</Text>
											</View>
										)}
									</View>
									<View style={styles.itemInfo}>
										<Text style={styles.itemName}>{selectedItem.name}</Text>
										<Pressable onPress={() => WebBrowser.openBrowserAsync(selectedItem.itemUrl)}>
											<Text style={styles.itemPrice}>
												{selectedItem.price}
											</Text>
										</Pressable>
									</View>
								</View>
							) : (
								<Text style={styles.sheetHint}>No details available.</Text>
							)}

							{popupPosition.showAbove ? (
								<View
									style={[
										styles.popupArrowDown,
										{ left: popupPosition.arrowLeft, borderTopColor: theme.surface },
									]}
								/>
							) : (
								<View
									style={[
										styles.popupArrowUp,
										{ left: popupPosition.arrowLeft, borderBottomColor: theme.surface },
									]}
								/>
							)}
						</View>
					</View>
				) : null}
			</View>

			{/* Small overlay explains how to use the graph. */}
			<View style={[styles.overlayTop, { borderColor: theme.border }]}> 
				<Text style={styles.overlayTitle}>Interactive Style Map</Text>
				<Text style={styles.overlaySubtitle}>Pinch to zoom, drag to pan, tap a node for item details. Blue ring = your coordinates.</Text>
			</View>

		</View>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
	},
	centered: {
		flex: 1,
		alignItems: 'center',
		justifyContent: 'center',
		paddingHorizontal: 24,
	},
	messageText: {
		fontFamily: 'GeorgiaProSemiBold',
		fontSize: 16,
	},
	plotWrap: {
		flex: 1,
	},
	popupLayer: {
		...StyleSheet.absoluteFillObject,
	},
	popupCard: {
		position: 'absolute',
		borderWidth: 1,
		borderRadius: 12,
		paddingHorizontal: 10,
		paddingVertical: 10,
		minHeight: 120,
	},
	popupHeader: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
	},
	popupTitle: {
		color: '#f5f7f8',
		fontFamily: 'GeorgiaProSemiBold',
		fontSize: 15,
	},
	popupArrowDown: {
		position: 'absolute',
		bottom: -10,
		width: 0,
		height: 0,
		borderLeftWidth: 8,
		borderRightWidth: 8,
		borderTopWidth: 10,
		borderLeftColor: 'transparent',
		borderRightColor: 'transparent',
	},
	popupArrowUp: {
		position: 'absolute',
		top: -10,
		width: 0,
		height: 0,
		borderLeftWidth: 8,
		borderRightWidth: 8,
		borderBottomWidth: 10,
		borderLeftColor: 'transparent',
		borderRightColor: 'transparent',
	},
	webView: {
		flex: 1,
		backgroundColor: 'transparent',
	},
	overlayTop: {
		position: 'absolute',
		top: 14,
		left: 14,
		right: 14,
		borderWidth: 1,
		borderRadius: 12,
		paddingVertical: 10,
		paddingHorizontal: 12,
		backgroundColor: 'rgba(247, 242, 236, 0.92)',
	},
	overlayTitle: {
		fontFamily: 'GeorgiaProBlack',
		fontSize: 16,
		color: '#102026',
	},
	overlaySubtitle: {
		marginTop: 2,
		fontFamily: 'GeorgiaProRegular',
		fontSize: 13,
		color: '#384046',
	},
	closeButton: {
		backgroundColor: '#4caf85',
		borderRadius: 8,
		paddingVertical: 6,
		paddingHorizontal: 10,
	},
	closeButtonText: {
		color: '#0c191f',
		fontFamily: 'GeorgiaProSemiBold',
		fontSize: 12,
	},
	sheetHint: {
		marginTop: 12,
		color: '#d6e3ea',
		fontFamily: 'GeorgiaProRegular',
		fontSize: 14,
	},
	loadingRow: {
		marginTop: 12,
		flexDirection: 'row',
		alignItems: 'center',
		gap: 10,
	},
	loadingText: {
		color: '#d6e3ea',
		fontFamily: 'GeorgiaProRegular',
		fontSize: 14,
	},
	errorText: {
		marginTop: 12,
		color: '#f39aa0',
		fontFamily: 'GeorgiaProRegular',
		fontSize: 14,
	},
	itemRow: {
		marginTop: 12,
		flexDirection: 'row',
		alignItems: 'center',
	},
	imageFrame: {
		width: 90,
		height: 90,
		borderRadius: 10,
		borderWidth: 1,
		borderColor: '#3f4e57',
		overflow: 'hidden',
		backgroundColor: '#0e161b',
	},
	itemImage: {
		width: '100%',
		height: '100%',
	},
	noImageWrap: {
		flex: 1,
		alignItems: 'center',
		justifyContent: 'center',
	},
	noImageText: {
		color: '#c5d4dc',
		fontFamily: 'GeorgiaProRegular',
		fontSize: 12,
	},
	itemInfo: {
		flex: 1,
		marginLeft: 12,
	},
	itemName: {
		color: '#f0f5f8',
		fontFamily: 'GeorgiaProSemiBold',
		fontSize: 15,
		marginBottom: 6,
	},
	itemPrice: {
		color: '#8de4b7',
		fontFamily: 'GeorgiaProBold',
		fontSize: 15,
		textDecorationLine: 'underline',
	},
});
