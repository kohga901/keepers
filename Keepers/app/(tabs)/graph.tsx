import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { getDefaultHeaderHeight, useFocusEffect, useIsFocused } from 'expo-router/react-navigation';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, View } from 'react-native';
import { useSafeAreaFrame, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as WebBrowser from 'expo-web-browser';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { Text } from '../../components/Text';
import { ImageLookupModal } from '../../components/ai/ImageLookupModal';
import { usePriceDisplay } from '../../contexts/PriceDisplayContext';
import { useStackHeaderHeight } from '../../contexts/StackHeaderHeightContext';
import { useTutorial } from '../../contexts/TutorialContext';
import { useAppTheme } from '../../hooks/useAppTheme';
import type { Item } from '../../models/Items';
import { lookupPurchasableItem, toAiLookupError, type AiLookupErrorCode, type ImageLookupResult } from '../../services/ai';
import { getGraphHistory, getGraphItems, getUserCoordinates } from '../../services/dataServices';
import { sendSwipeToServer } from '../../services/serverApi';
import { GraphLikes, type GraphHistory } from '../../utils/graphLikes';
import { getPriceTierSymbol } from '../../utils/price';
import { MAP_GEOMETRY_SOURCE, normalizeMapPoints, validMapPosition, parseMapFrame, type MapFrame, type MapLayout, type MapPoint, type Position } from '../../utils/styleMap';
import { supabase } from '../../utils/supabase';

const POINTS = normalizeMapPoints(require('../../data/nodeData.json'));
const POINT_IDS = new Set(POINTS.map((p) => p.clothesId));
const SOURCE = { html: buildPlotHtml(POINTS) };
const EMPTY_FRAME: MapFrame = { type: 'frame', mode: 'whole', count: 0, nearTaste: false, previews: [], taste: null };
const TASTE_BLUE = '#24a7ff';

function remoteUrl(value: string) {
  try { return ['https:', 'http:'].includes(new URL(value).protocol); } catch { return false; }
}

function ClothingPhoto({ item }: { item: Item | null | undefined }) {
  const { theme } = useAppTheme();
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const usable = !!item?.imageUrl && remoteUrl(item.imageUrl) && !failed;
  return <View style={[styles.photo, { backgroundColor: theme.background }]}>
    <Ionicons name={failed || !usable ? 'shirt-outline' : 'image-outline'} size={23} color={theme.text} />
    {usable && <Image source={{ uri: item.imageUrl }} contentFit="cover" cachePolicy="memory-disk"
      recyclingKey={item.id} style={[StyleSheet.absoluteFill, { opacity: loaded ? 1 : 0 }]}
      onLoad={() => setLoaded(true)} onError={() => setFailed(true)} accessible={false} />}
    {usable && !loaded && <ActivityIndicator style={StyleSheet.absoluteFill} size="small" color={theme.text} />}
  </View>;
}

export default function GraphTab() {
  const { theme } = useAppTheme();
  const { showPriceAsTier } = usePriceDisplay();
  const insets = useSafeAreaInsets();
  const safeFrame = useSafeAreaFrame();
  const stackHeaderHeight = useStackHeaderHeight();
  const headerHeight = stackHeaderHeight || getDefaultHeaderHeight(safeFrame, false, insets.top);
  const isFocused = useIsFocused();
  const web = useRef<WebView>(null);
  const ready = useRef(false);
  const session = useRef<AbortController | null>(null);
  const userId = useRef<string | null>(null);
  const mounted = useRef(true);
  const guard = useRef(new GraphLikes());
  const cached = useRef(new Map<number, Item | null>());
  const pendingItems = useRef(new Set<number>());
  const failedItems = useRef(new Set<number>());
  const [items, setItems] = useState(new Map<number, Item | null>());
  const [itemErrors, setItemErrors] = useState(new Set<number>());
  const [reactions, setReactions] = useState<{ history: GraphHistory | null; pending: number | null }>({ history: null, pending: null });
  const [profileReady, setProfileReady] = useState(false);
  const [profileRetry, setProfileRetry] = useState(0);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [preference, setPreference] = useState<Position | null>(null);
  const [frame, setFrame] = useState<MapFrame>(EMPTY_FRAME);
  const [showPreviews, setShowPreviews] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [top, setTop] = useState(180);
  const [dockHeight, setDockHeight] = useState(100);
  const visibleDockHeight = selectedId === null ? 0 : dockHeight;
  const [mapError, setMapError] = useState(false);
  const [rendered, setRendered] = useState(false);
  const [webKey, setWebKey] = useState(0);
  const layout = useMemo<MapLayout>(() => ({ ...size, top, bottom: visibleDockHeight + 74 }), [size, top, visibleDockHeight]);
  const [lookupItem, setLookupItem] = useState<Item | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupResult, setLookupResult] = useState<ImageLookupResult | null>(null);
  const [lookupError, setLookupError] = useState<{ code: AiLookupErrorCode; message: string } | null>(null);
  const lookupRequest = useRef<AbortController | null>(null);
  const lookupId = useRef(0);
  const { showTutorialOnce } = useTutorial();

  // First visit to the Graph explains the dots, moving around, and how likes move your taste.
  useFocusEffect(useCallback(() => { showTutorialOnce('graph'); }, [showTutorialOnce]));

  const command = useCallback((payload: object) => {
    if (ready.current) web.current?.injectJavaScript(`window.keepersMap && window.keepersMap(${JSON.stringify(payload).replace(/</g, '\\u003c')}); true;`);
  }, []);
  const config = useMemo(() => ({ type: 'configure', layout, preference, initialize: profileReady, showPreviews,
    colors: { background: theme.background, grid: theme.border, point: theme.primary,
      selected: theme.accentGold, preference: TASTE_BLUE, text: theme.text, surface: theme.surface } }),
  [layout, preference, profileReady, showPreviews, theme]);
  useEffect(() => { command(config); }, [command, config]);

  const closeLookup = useCallback(() => {
    lookupId.current += 1;
    lookupRequest.current?.abort();
    lookupRequest.current = null;
    setLookupItem(null); setLookupLoading(false); setLookupResult(null); setLookupError(null);
  }, []);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  useFocusEffect(useCallback(() => {
    const controller = new AbortController();
    session.current = controller;
    pendingItems.current.clear();
    guard.current.history = null;
    if (profileRetry > 0) setProfileError(null);
    setReactions({ history: null, pending: guard.current.pending });
    void (async () => {
      try {
        const { data, error } = await supabase.auth.getUser();
        if (controller.signal.aborted) return;
        if (error || !data.user) throw new Error('Sign in again to like pieces. You can still explore the graph.');
        const id = data.user.id;
        if (userId.current !== id) {
          if (userId.current) command({ type: 'reset' });
          guard.current = new GraphLikes(); userId.current = id; setSelectedId(null);
        }
        const [coords, history] = await Promise.allSettled([getUserCoordinates(id), getGraphHistory(id, controller.signal)]);
        if (controller.signal.aborted) return;
        setPreference(coords.status === 'fulfilled' && validMapPosition(coords.value) ? coords.value : null);
        if (history.status === 'fulfilled') { guard.current.history = history.value; setProfileError(null); }
        else setProfileError('Your reactions could not be checked. Retry before liking a piece.');
        setReactions({ history: guard.current.history, pending: guard.current.pending });
      } catch (error) {
        if (!controller.signal.aborted) {
          userId.current = null; guard.current = new GraphLikes(); setPreference(null);
          setReactions({ history: null, pending: null });
          setProfileError(error instanceof Error ? error.message : 'Your profile could not be loaded.');
        }
      } finally { if (!controller.signal.aborted) setProfileReady(true); }
    })();
    return () => { controller.abort(); closeLookup(); };
  }, [closeLookup, command, profileRetry]));

  const loadItems = useCallback(async (requested: number[]) => {
    const controller = session.current;
    if (!controller || controller.signal.aborted) return;
    const ids = [...new Set(requested)].filter((id) => POINT_IDS.has(id) && !cached.current.has(id) && !pendingItems.current.has(id) && !failedItems.current.has(id));
    if (!ids.length) return;
    ids.forEach((id) => pendingItems.current.add(id));
    try {
      const rows = await getGraphItems(ids, controller.signal);
      if (controller.signal.aborted) return;
      ids.forEach((id) => cached.current.set(id, null));
      for (const row of rows) {
        const id = Number(row.item_id);
        if (!ids.includes(id)) continue;
        cached.current.set(id, { id: String(id), name: String(row.item_name ?? 'Clothing item'),
          imageUrl: String(row.item_img ?? ''), itemUrl: String(row.item_web_listing ?? ''),
          price: String(row.item_price ?? ''), gender: String(row.item_gender ?? ''), liked: false });
      }
      setItems(new Map(cached.current));
    } catch {
      if (!controller.signal.aborted) { ids.forEach((id) => failedItems.current.add(id)); setItemErrors(new Set(failedItems.current)); }
    } finally {
      if (session.current === controller) ids.forEach((id) => pendingItems.current.delete(id));
    }
  }, []);
  const candidateKey = showPreviews ? frame.previews.map((p) => p.clothesId).join(',') : '';
  useEffect(() => {
    if (!isFocused) return;
    const ids = candidateKey ? candidateKey.split(',').map(Number) : [];
    if (selectedId !== null) ids.push(selectedId);
    void loadItems(ids);
  }, [candidateKey, selectedId, loadItems, profileRetry, isFocused]);

  const select = (id: number) => { setSelectedId(id); setActionError(null); command({ type: 'select', id }); };
  const clearSelection = () => { setSelectedId(null); setActionError(null); command({ type: 'clear' }); };
  function onMessage(event: WebViewMessageEvent) {
    try {
      if (event.nativeEvent.data.length > 12000) return;
      const message = JSON.parse(event.nativeEvent.data);
      if (message.type === 'ready') { ready.current = true; command(config); return; }
      if (message.type === 'select' && POINT_IDS.has(message.id)) { setSelectedId(message.id); setActionError(null); return; }
      if (message.type === 'empty') { setActionError('No other pieces in this area. Widen the area or view the whole graph.'); return; }
      const next = parseMapFrame(message, POINT_IDS, layout);
      if (next) { setFrame(next); setRendered(true); }
    } catch { /* Ignore invalid messages at the WebView boundary. */ }
  }
  const selectedItem = selectedId === null ? null : items.get(selectedId);
  const selectedError = selectedId !== null && (itemErrors.has(selectedId) || (items.has(selectedId) && !selectedItem));
  const status = selectedId === null || !reactions.history ? 'unknown' : reactions.history.liked.has(selectedId) ? 'liked' : reactions.history.passed.has(selectedId) ? 'passed' : 'new';
  const saving = selectedId !== null && reactions.pending === selectedId;

  async function like() {
    if (selectedId === null || !selectedItem) return;
    const id = selectedId, owner = userId.current, currentGuard = guard.current;
    if (!owner || !currentGuard.begin(id)) return;
    setActionError(null); setReactions({ history: currentGuard.history, pending: currentGuard.pending });
    const success = await sendSwipeToServer(String(id), true);
    currentGuard.finish(id, success);
    if (!mounted.current || guard.current !== currentGuard || userId.current !== owner) return;
    setReactions({ history: currentGuard.history, pending: currentGuard.pending });
    const controller = session.current;
    if (!controller || controller.signal.aborted) return;
    if (!success) {
      setActionError('The like could not be confirmed. Checking your history before you retry.');
      try {
        const history = await getGraphHistory(owner, controller.signal);
        if (controller.signal.aborted || guard.current !== currentGuard) return;
        currentGuard.history = history; setReactions({ history, pending: currentGuard.pending });
        setActionError(history.liked.has(id) ? null : 'The last like was not saved. Open that piece to try again.');
      } catch { if (!controller.signal.aborted) setProfileError('Your like could not be verified. Retry checking your reactions first.'); }
      return;
    }
    const coords = await getUserCoordinates(owner);
    if (!controller.signal.aborted && userId.current === owner && validMapPosition(coords)) setPreference(coords);
  }
  async function startLookup(item: Item) {
    lookupRequest.current?.abort();
    const controller = new AbortController(), request = ++lookupId.current;
    lookupRequest.current = controller;
    setLookupItem(item); setLookupLoading(true); setLookupResult(null); setLookupError(null);
    try {
      const result = await lookupPurchasableItem({ imageUrl: item.imageUrl, itemHint: item.name, maxResults: 5, signal: controller.signal });
      if (!controller.signal.aborted && request === lookupId.current) setLookupResult(result);
    } catch (error) {
      const safe = toAiLookupError(error);
      if (safe.code !== 'cancelled' && request === lookupId.current) setLookupError({ code: safe.code, message: safe.message });
    } finally { if (request === lookupId.current) { setLookupLoading(false); lookupRequest.current = null; } }
  }
  function retryItems() {
    const ids = showPreviews ? frame.previews.map((p) => p.clothesId) : [];
    if (selectedId !== null) ids.push(selectedId);
    for (const id of ids) { failedItems.current.delete(id); if (cached.current.get(id) === null) cached.current.delete(id); }
    setItemErrors(new Set(failedItems.current)); setItems(new Map(cached.current)); void loadItems(ids);
  }
  async function openListing(item: Item) {
    if (!remoteUrl(item.itemUrl)) { setActionError('This piece has no available store listing. Try Find it instead.'); return; }
    try { await WebBrowser.openBrowserAsync(item.itemUrl); }
    catch { setActionError('The store listing could not be opened. Please try again.'); }
  }
  const surface = { backgroundColor: theme.surface, borderColor: theme.border }, textColor = { color: theme.text };
  const canLike = status === 'new' && reactions.pending === null && !!selectedItem;
  if (!POINTS.length) return <View style={[styles.empty, { backgroundColor: theme.background, paddingTop: headerHeight }]}><Text style={textColor}>No clothing positions are available yet.</Text></View>;

  return <View style={[styles.screen, { backgroundColor: theme.background }]}>
    <View style={[styles.header, { backgroundColor: theme.primary, height: headerHeight }]}>
      <View style={[styles.headerRow, { height: headerHeight - insets.top }]}>
        <View style={styles.modeWrapper}>
        <View style={[styles.modes, { backgroundColor: theme.tabBg, borderColor: theme.border }]}>{(['focus', 'whole'] as const).map((mode) => <Pressable key={mode} accessibilityRole="button" hitSlop={{ top: 6, bottom: 6 }}
          accessibilityState={{ selected: frame.mode === mode }} onPress={() => command({ type: 'mode', mode })}
          style={[styles.mode, { backgroundColor: frame.mode === mode ? theme.primary : theme.tabBg }]}>
          <Text style={[styles.modeText, { color: frame.mode === mode ? theme.headerText : theme.tabInactive }]}>{mode === 'focus' ? 'Focus area' : 'Whole graph'}</Text>
        </Pressable>)}</View>
        </View>
        <View style={styles.previewControl}>
          <Switch style={styles.previewSwitch} accessibilityLabel="Image previews" value={showPreviews} onValueChange={setShowPreviews}
            trackColor={{ false: theme.border, true: theme.tabBg }} thumbColor={showPreviews ? theme.tabActive : theme.surface} />
        </View>
      </View>
    </View>
    <View style={styles.graph} onLayout={({ nativeEvent: { layout: next } }) => setSize({ width: next.width, height: next.height })}>
      <WebView key={webKey} ref={web} source={SOURCE} originWhitelist={['*']} javaScriptEnabled
        style={styles.webview} onMessage={onMessage} scrollEnabled={false} bounces={false}
        accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
        onShouldStartLoadWithRequest={(request) => request.url === 'about:blank' || request.url.startsWith('about:srcdoc')}
        onError={() => { ready.current = false; setMapError(true); }}
        onContentProcessDidTerminate={() => { ready.current = false; setMapError(true); }}
        onRenderProcessGone={() => { ready.current = false; setMapError(true); }} />
      {/* Keep every finger on the WebView; it handles thumbnail taps as well as graph gestures. */}
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        {showPreviews && frame.previews.map((p) => {
          const item = items.get(p.clothesId);
          return <Pressable key={p.clothesId} accessibilityRole="button" accessibilityLabel={`Open ${item?.name ?? 'clothing item'}`}
            accessibilityState={{ selected: selectedId === p.clothesId }} onPress={() => select(p.clothesId)}
            style={[styles.preview, surface, { left: p.x - 23, top: p.y - 26, borderColor: selectedId === p.clothesId ? theme.accentGold : theme.surface }]}>
            <ClothingPhoto key={item?.imageUrl || String(p.clothesId)} item={item} />
          </Pressable>;
        })}
        {frame.taste && preference && <View pointerEvents="none" style={[styles.tasteLabel, surface, { left: frame.taste.x + 13, top: frame.taste.y - 12 }]}><Text style={[styles.small, textColor]}>Your taste</Text></View>}
      </View>
      <View style={styles.topPanel} onLayout={(event) => setTop(event.nativeEvent.layout.height + 24)}>
        <View style={styles.row}><Text accessibilityLiveRegion="polite" style={[styles.small, styles.flex, textColor]}>
          {frame.mode === 'whole' ? 'All clothing' : frame.nearTaste ? 'Around your taste' : 'Exploring this area'} · {frame.count.toLocaleString()} pieces
        </Text></View>
        {profileError && <View style={[styles.notice, surface]}><Text style={[styles.small, styles.flex, textColor]}>{profileError}</Text><Pressable accessibilityRole="button" onPress={() => setProfileRetry((n) => n + 1)} style={styles.retry}><Text style={[styles.buttonText, textColor]}>Retry</Text></Pressable></View>}
        {selectedId === null && actionError && <Text accessibilityRole="alert" style={[styles.hint, textColor]}>{actionError}</Text>}
        {showPreviews && itemErrors.size > 0 && selectedId === null && <Pressable accessibilityRole="button" onPress={retryItems} style={styles.retry}><Text style={[styles.small, textColor]}>Some previews could not load. Retry</Text></Pressable>}
      </View>
      <View style={[styles.zoomControls, { top: top + 10 }]}>{[{ name: 'add' as const, label: 'Zoom in', factor: 1.4 }, { name: 'remove' as const, label: 'Zoom out', factor: 1 / 1.4 }].map((button) => <Pressable key={button.label} accessibilityRole="button" accessibilityLabel={button.label}
        style={[styles.iconButton, surface]} onPress={() => command({ type: 'zoom', factor: button.factor })}><Ionicons name={button.name} size={23} color={theme.text} /></Pressable>)}</View>
      <View pointerEvents="box-none" style={[styles.legendRow, { bottom: visibleDockHeight + 25 }]}>
        <View style={styles.legend}><View style={[styles.dot, { backgroundColor: theme.primary }]} /><Text style={[styles.small, textColor]}>Clothing</Text>
          {preference && <><View style={[styles.tasteDot, { backgroundColor: TASTE_BLUE, borderColor: theme.surface }]} /><Text style={[styles.small, textColor]}>Your taste</Text></>}
        </View>
        {preference && <Pressable accessibilityRole="button" onPress={() => command({ type: 'taste' })} style={[styles.return, surface]}><Ionicons name="locate-outline" size={17} color={theme.text} /><Text style={[styles.small, textColor]}>My taste</Text></Pressable>}
      </View>
      {selectedId !== null && <View accessibilityLiveRegion="polite" style={[styles.dock, surface]} onLayout={(event) => setDockHeight(event.nativeEvent.layout.height)}>
          <View style={styles.itemRow}>
            <View style={styles.itemPhoto}><ClothingPhoto key={selectedItem?.imageUrl || String(selectedId)} item={selectedItem} /></View>
            <View style={styles.flex}>{selectedItem ? <>
              <Text numberOfLines={2} style={[styles.itemName, textColor]}>{selectedItem.name}</Text>
              <Pressable accessibilityRole="link" accessibilityLabel={`Open the store listing for ${selectedItem.name}`} onPress={() => void openListing(selectedItem)} style={styles.priceLink}>
                <Text style={[styles.price, { color: theme.accentBrown }]}>{selectedItem.price ? showPriceAsTier ? getPriceTierSymbol(selectedItem.price) : selectedItem.price : 'Price unavailable'}</Text><Ionicons name="open-outline" size={13} color={theme.accentBrown} />
              </Pressable>
            </> : selectedError ? <><Text style={[styles.small, textColor]}>This piece could not be loaded.</Text><Pressable accessibilityRole="button" onPress={retryItems} style={styles.retry}><Text style={[styles.buttonText, textColor]}>Retry details</Text></Pressable></> : <View style={styles.loadingRow}><ActivityIndicator color={theme.text} /><Text style={[styles.small, textColor]}>Loading piece…</Text></View>}</View>
            <Pressable accessibilityRole="button" accessibilityLabel="Close selected item" onPress={clearSelection} style={styles.close}><Ionicons name="close" size={20} color={theme.text} /></Pressable>
          </View>
          <View style={styles.itemActions}>
            <Pressable accessibilityRole="button" accessibilityLabel={saving ? 'Saving like' : status === 'liked' ? 'Already liked' : status === 'passed' ? 'Previously passed' : 'Like this piece and update your taste'}
              accessibilityState={{ disabled: !canLike, busy: saving }} disabled={!canLike} onPress={() => void like()}
              style={[styles.action, styles.flex, { backgroundColor: theme.primary, opacity: canLike || status === 'liked' || status === 'passed' ? 1 : .55 }]}>
              {saving ? <ActivityIndicator size="small" color={theme.text} /> : <Ionicons name={status === 'liked' ? 'heart' : status === 'passed' ? 'remove-circle-outline' : 'heart-outline'} size={16} color={theme.text} />}
              <Text style={[styles.buttonText, textColor]}>{saving ? 'Liking…' : status === 'liked' ? 'Liked' : status === 'passed' ? 'Passed' : status === 'unknown' ? 'Checking…' : 'Like'}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Find this piece with AI" accessibilityHint="Uses your selected AI provider to search for purchase listings" disabled={!selectedItem?.imageUrl}
              onPress={() => selectedItem && void startLookup(selectedItem)} style={[styles.action, styles.flex, { backgroundColor: theme.accentGold, opacity: selectedItem?.imageUrl ? 1 : .55 }]}><Ionicons name="search" size={16} color={theme.text} /><Text style={[styles.buttonText, textColor]}>Find it</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Next piece in this area" onPress={() => command({ type: 'next' })} style={[styles.action, { backgroundColor: theme.background }]}><Ionicons name="chevron-forward" size={19} color={theme.text} /></Pressable>
          </View>
        {actionError && <Text accessibilityRole="alert" style={[styles.hint, textColor]}>{actionError}</Text>}
      </View>}
      {(!profileReady || !rendered) && !mapError && <View pointerEvents="none" style={styles.loading} accessibilityRole="progressbar" accessibilityLabel="Loading your style map">
        <ActivityIndicator size="large" color={theme.text} />
        <Text style={[styles.loadingText, textColor]}>Loading your style map...</Text>
      </View>}
      {mapError && <View style={[styles.empty, StyleSheet.absoluteFill, { backgroundColor: theme.background }]}><Text style={textColor}>Your style map could not load.</Text><Pressable accessibilityRole="button" style={[styles.pick, surface]} onPress={() => { ready.current = false; setMapError(false); setRendered(false); setWebKey((key) => key + 1); }}><Text style={textColor}>Reload map</Text></Pressable></View>}
    </View>
    <ImageLookupModal item={lookupItem} loading={lookupLoading} result={lookupResult} errorCode={lookupError?.code ?? null} errorMessage={lookupError?.message ?? null}
      onClose={closeLookup} onOpenSettings={() => { closeLookup(); router.push('/settings'); }} onRetry={() => { if (lookupItem) void startLookup(lookupItem); }} />
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, graph: { flex: 1 }, webview: { flex: 1, backgroundColor: 'transparent' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  loading: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', gap: 16 },
  loadingText: { fontSize: 16, fontWeight: '600' },
  topPanel: { position: 'absolute', top: 12, left: 16, right: 16, gap: 7 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 9 },
  flex: { flex: 1, minWidth: 0 }, title: { fontSize: 19, fontWeight: '700', flex: 1 },
  subtitle: { fontSize: 12, lineHeight: 18 }, small: { fontSize: 11, lineHeight: 16 }, buttonText: { fontSize: 12, fontWeight: '500', flexShrink: 1 },
  help: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  header: { justifyContent: 'flex-end' },
  headerRow: { paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center' },
  modeWrapper: { flex: 1, minWidth: 0, alignItems: 'center' },
  previewControl: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  previewSwitch: { alignSelf: 'center', flexShrink: 0 },
  modes: { width: 268, maxWidth: '100%', padding: 3, borderWidth: 1, borderRadius: 24, flexDirection: 'row' },
  mode: { width: 130, flexShrink: 1, paddingVertical: 6, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  modeText: { fontSize: 16, fontWeight: '700', fontFamily: 'PublicSans_700Bold', textTransform: 'uppercase', textAlign: 'center' },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderWidth: 1, borderRadius: 9 },
  zoomControls: { position: 'absolute', right: 12, gap: 7 },
  iconButton: { width: 44, height: 44, borderWidth: 1, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  preview: { position: 'absolute', width: 46, height: 52, borderWidth: 2, borderRadius: 9, overflow: 'hidden', elevation: 2, shadowColor: '#0c3b2e', shadowOffset: { width: 0, height: 2 }, shadowOpacity: .15, shadowRadius: 3 },
  photo: { flex: 1, width: '100%', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  tasteLabel: { position: 'absolute', paddingHorizontal: 7, paddingVertical: 5, borderRadius: 7, borderWidth: 1 },
  legendRow: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap', flex: 1 },
  dot: { width: 7, height: 7, borderRadius: 4 }, tasteDot: { width: 10, height: 10, borderRadius: 5, borderWidth: 2, marginLeft: 5 },
  return: { minHeight: 44, paddingHorizontal: 9, borderWidth: 1, borderRadius: 9, flexDirection: 'row', alignItems: 'center', gap: 5 },
  dock: { position: 'absolute', left: 12, right: 12, bottom: 12, padding: 13, minHeight: 100, borderWidth: 1, borderRadius: 13 },
  pick: { minHeight: 44, borderRadius: 8, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  hint: { fontSize: 11, lineHeight: 17, marginTop: 7 }, itemRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  itemPhoto: { width: 49, height: 56, borderRadius: 8, overflow: 'hidden' }, itemName: { fontSize: 12, lineHeight: 17, fontWeight: '500' },
  priceLink: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 5 }, price: { fontSize: 12 },
  close: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start' },
  itemActions: { flexDirection: 'row', gap: 7, marginTop: 10 },
  action: { minHeight: 44, minWidth: 44, paddingHorizontal: 9, borderRadius: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  retry: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 5 }, loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});

export function buildPlotHtml(points: MapPoint[]) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;touch-action:none;background:transparent}canvas{display:block;width:100%;height:100%;touch-action:none}</style></head><body><canvas id="plot"></canvas><script>
  (function () {
    var G = (${MAP_GEOMETRY_SOURCE})();
    var POINTS = ${JSON.stringify(points).replace(/</g, '\\u003c')};
    var byId = new Map(POINTS.map(function(p){return [p.clothesId,p];}));
    var canvas=document.getElementById('plot'), ctx=canvas.getContext('2d');
    var layout=null, camera=null, preference=null, colors=null, mode='whole', selected=null, showPreviews=true;
    var raf=false, lastFrame='', lastPost=0, postTimer=null, seen=new Set(), pointers=new Map(), moved=0, multi=false;
    function post(message){if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(JSON.stringify(message));}
    function configureSize(){var dpr=Math.min(window.devicePixelRatio||1,2);canvas.width=Math.round(layout.width*dpr);canvas.height=Math.round(layout.height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);}
    function fit(){camera=G.fit(POINTS,layout);}
    function focus(target){var base=G.fit(POINTS,layout);camera={x:target.x,y:target.y,scale:base.scale*2.5};mode='focus';}
    function emit(frame){var json=JSON.stringify(frame);if(json===lastFrame)return;var elapsed=Date.now()-lastPost;if(elapsed<40){if(!postTimer)postTimer=setTimeout(function(){postTimer=null;schedule();},40-elapsed);return;}lastFrame=json;lastPost=Date.now();post(frame);}
    function draw(){
      if(!camera||!layout||!colors)return;
      var w=layout.width,h=layout.height,scale=camera.scale,o=G.origin(layout,mode);
      ctx.clearRect(0,0,w,h);ctx.fillStyle=colors.background;ctx.fillRect(0,0,w,h);
      var step=Math.pow(10,Math.floor(Math.log10(70/scale)));if(70/scale/step>5)step*=5;else if(70/scale/step>2)step*=2;
      var lo=G.unproject({x:0,y:h},camera,layout,mode),hi=G.unproject({x:w,y:0},camera,layout,mode);
      ctx.strokeStyle=colors.grid;ctx.lineWidth=.6;ctx.globalAlpha=.5;ctx.beginPath();
      for(var x=Math.floor(lo.x/step)*step;x<=hi.x;x+=step){var sx=G.project({x:x,y:0},camera,layout,mode).x;ctx.moveTo(sx,0);ctx.lineTo(sx,h);}
      for(var y=Math.floor(lo.y/step)*step;y<=hi.y;y+=step){var sy=G.project({x:0,y:y},camera,layout,mode).y;ctx.moveTo(0,sy);ctx.lineTo(w,sy);}ctx.stroke();ctx.globalAlpha=1;
      if(mode==='focus'){ctx.beginPath();ctx.arc(o.x,o.y,G.radius(layout),0,Math.PI*2);ctx.fillStyle=colors.point;ctx.globalAlpha=.1;ctx.fill();ctx.globalAlpha=.7;ctx.strokeStyle=colors.point;ctx.lineWidth=1.5;ctx.stroke();ctx.globalAlpha=1;}
      var count=0;
      for(var i=0;i<POINTS.length;i++){var p=POINTS[i],inside=G.inFocus(p,camera,layout,mode);if(inside)count++;var q=G.project(p,camera,layout,mode);if(q.x<0||q.x>w||q.y<layout.top||q.y>h-layout.bottom+12)continue;ctx.globalAlpha=inside?.75:.15;ctx.fillStyle=colors.point;ctx.beginPath();ctx.arc(q.x,q.y,2.3,0,Math.PI*2);ctx.fill();}ctx.globalAlpha=1;
      if(preference){var taste=G.project(preference,camera,layout,mode);ctx.fillStyle=colors.preference;ctx.globalAlpha=.16;ctx.beginPath();ctx.arc(taste.x,taste.y,15,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;ctx.beginPath();ctx.arc(taste.x,taste.y,7,0,Math.PI*2);ctx.fill();ctx.strokeStyle=colors.surface;ctx.lineWidth=2.5;ctx.stroke();}
      if(selected!==null&&byId.has(selected)){var anchor=G.project(byId.get(selected),camera,layout,mode);ctx.fillStyle=colors.selected;ctx.beginPath();ctx.arc(anchor.x,anchor.y,7,0,Math.PI*2);ctx.fill();ctx.strokeStyle=colors.text;ctx.lineWidth=1;ctx.stroke();}
      var previews=G.previews(POINTS,camera,layout,mode,selected,preference).map(function(p){return {clothesId:p.clothesId,x:Math.round(p.x*10)/10,y:Math.round(p.y*10)/10};});
      emit({type:'frame',mode:mode,count:count,nearTaste:!!preference&&Math.hypot(camera.x-preference.x,camera.y-preference.y)<.15,previews:previews,taste:G.tasteAnchor(preference,camera,layout,mode)});
    }
    function schedule(){if(raf)return;raf=true;requestAnimationFrame(function(){raf=false;draw();});}
    function zoom(factor,anchor){if(!camera)return;var base=G.fit(POINTS,layout).scale;camera=G.zoom(camera,layout,mode,factor,anchor||G.origin(layout,mode),base*.5,base*20);}
    function select(id){if(!byId.has(id))return;selected=id;seen.add(id);post({type:'select',id:id});schedule();}
    window.keepersMap=function(message){
      if(message.type==='configure'){
        var oldOrigin=camera&&layout?G.origin(layout,mode):null;
        layout=message.layout;preference=G.validPosition(message.preference)?message.preference:null;colors=message.colors;showPreviews=message.showPreviews!==false;
        if(!layout||layout.width<=0||layout.height<=0)return;configureSize();
        if(oldOrigin){var newOrigin=G.origin(layout,mode);camera.x+=(newOrigin.x-oldOrigin.x)/camera.scale;camera.y+=(oldOrigin.y-newOrigin.y)/camera.scale;}
        if(!camera&&message.initialize){if(preference)focus(preference);else{mode='whole';fit();}}
      }else if(message.type==='reset'){camera=null;selected=null;seen.clear();}
      else if(!camera)return;
      else if(message.type==='mode'){
        if(message.mode==='whole'){mode='whole';fit();}
        else if(message.mode==='focus'&&mode!=='focus'){var target=selected!==null?byId.get(selected):camera;focus(target||camera);}seen.clear();
      }else if(message.type==='taste'&&preference){focus(preference);seen.clear();}
      else if(message.type==='zoom'&&Number.isFinite(message.factor)&&message.factor>0)zoom(message.factor);
      else if(message.type==='select'&&byId.has(message.id)){selected=message.id;seen.add(selected);}
      else if(message.type==='clear')selected=null;
      else if(message.type==='next'){
        var options=G.previews(POINTS,camera,layout,mode,selected,preference),choice=null;
        for(var i=0;i<options.length;i++)if(!seen.has(options[i].clothesId)){choice=options[i];break;}
        if(!choice){seen.clear();for(var j=0;j<options.length;j++)if(options[j].clothesId!==selected){choice=options[j];break;}}
        if(!choice){for(var k=0;k<POINTS.length;k++){var candidate=POINTS[k],position=G.project(candidate,camera,layout,mode);if(candidate.clothesId!==selected&&G.inFocus(candidate,camera,layout,mode)&&G.safePreview(position,layout,null)){choice=candidate;break;}}}
        if(choice)select(choice.clothesId);else post({type:'empty'});
      }
      schedule();
    };
    function local(event){var b=canvas.getBoundingClientRect();return {x:event.clientX-b.left,y:event.clientY-b.top};}
    canvas.addEventListener('pointerdown',function(event){if(!camera)return;canvas.setPointerCapture(event.pointerId);pointers.set(event.pointerId,local(event));moved=0;multi=pointers.size>1;});
    canvas.addEventListener('pointermove',function(event){
      if(!camera||!pointers.has(event.pointerId))return;var before=Array.from(pointers.values()),last=pointers.get(event.pointerId),p=local(event);pointers.set(event.pointerId,p);moved+=Math.hypot(p.x-last.x,p.y-last.y);
      if(pointers.size===1){camera.x-=(p.x-last.x)/camera.scale;camera.y+=(p.y-last.y)/camera.scale;}
      else{var after=Array.from(pointers.values()),d0=Math.hypot(before[0].x-before[1].x,before[0].y-before[1].y),d1=Math.hypot(after[0].x-after[1].x,after[0].y-after[1].y);var oldMid={x:(before[0].x+before[1].x)/2,y:(before[0].y+before[1].y)/2},mid={x:(after[0].x+after[1].x)/2,y:(after[0].y+after[1].y)/2};camera.x-=(mid.x-oldMid.x)/camera.scale;camera.y+=(mid.y-oldMid.y)/camera.scale;if(d0>0)zoom(d1/d0,mid);multi=true;}schedule();
    });
    canvas.addEventListener('pointerup',function(event){
      if(!pointers.has(event.pointerId))return;
      if(pointers.size===1&&!multi&&moved<8){
        var tap=local(event),winner=null,best=23;
        var thumbnails=showPreviews?G.previews(POINTS,camera,layout,mode,selected,preference):[];
        for(var j=0;j<thumbnails.length;j++){var thumbnail=thumbnails[j];if(Math.abs(thumbnail.x-tap.x)<=23&&Math.abs(thumbnail.y-tap.y)<=26){winner=byId.get(thumbnail.clothesId);break;}}
        if(!winner)for(var i=0;i<POINTS.length;i++){var q=G.project(POINTS[i],camera,layout,mode),distance=Math.hypot(q.x-tap.x,q.y-tap.y);if(distance<best){winner=POINTS[i];best=distance;}}
        if(winner)select(winner.clothesId);
      }
      pointers.delete(event.pointerId);schedule();
    });
    canvas.addEventListener('pointercancel',function(event){pointers.delete(event.pointerId);});
    canvas.addEventListener('wheel',function(event){event.preventDefault();if(camera)zoom(Math.exp(-event.deltaY*.002),local(event));schedule();},{passive:false});
    post({type:'ready'});
  })();
  </script></body></html>`;
}
