/**
 * File: stylewraps.tsx
 * Description: A personal style recap built from saved reactions and clothing tags.
 * Author: Kai Markley & Gabriel Min
 * Date: 2026-04-01
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useFocusEffect, useHeaderHeight } from 'expo-router/react-navigation';
import { Image } from 'expo-image';
import * as WebBrowser from 'expo-web-browser';
import { ImageLookupModal } from '../../components/ai/ImageLookupModal';

import { useAppTheme } from '../../hooks/useAppTheme';
import type { AppTheme } from '../../constants/theme';
import type { Item } from '../../models/Items';
import {
  lookupPurchasableItem,
  toAiLookupError,
  type AiLookupErrorCode,
  type ImageLookupResult,
} from '../../services/ai';
import { getStyleWrap } from '../../services/styleWrapService';
import { buildStyleWrap, COLOR_SWATCHES, selectRandomKeepers, tagLabel, type WrapData, type WrapItem } from '../../utils/styleWrap';
import { styleWrapDetailIcon } from '../../utils/styleWrapIcons';

const BUTTON_TEXT = '#0F1418';

export default function StyleWraps() {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const headerHeight = useHeaderHeight();
  const [data, setData] = useState<WrapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const lookupAbortController = useRef<AbortController | null>(null);
  const lookupRequestId = useRef(0);
  const [lookupItem, setLookupItem] = useState<Item | null>(null);
  const [lookupResult, setLookupResult] = useState<ImageLookupResult | null>(null);
  const [lookupError, setLookupError] = useState<{ code: AiLookupErrorCode; message: string } | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);

  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError(null);
    setPurchaseError(null);
    try {
      const next = await getStyleWrap(controller.signal);
      if (!controller.signal.aborted) setData(next);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Your recap could not be loaded. Please try again.');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    void load();
    return () => {
      request.current?.abort();
    };
  }, [load]));

  useEffect(() => () => lookupAbortController.current?.abort(), []);

  const wrap = useMemo(() => data ? buildStyleWrap(data) : null, [data]);
  const featuredKeepers = useMemo(() => wrap ? selectRandomKeepers(wrap.likes, 3) : [], [wrap]);
  const surface = { backgroundColor: theme.surface, borderColor: theme.border };
  const topGarment = wrap?.garments[0];
  const topFit = wrap?.fits[0];

  async function openStorePage(itemUrl: string) {
    setPurchaseError(null);
    try {
      const url = new URL(itemUrl);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Unsupported store link');
      await WebBrowser.openBrowserAsync(url.toString());
    } catch {
      setPurchaseError('This item’s store page is unavailable right now.');
    }
  }

  async function startLookup(item: WrapItem) {
    lookupAbortController.current?.abort();
    const controller = new AbortController();
    const requestId = lookupRequestId.current + 1;
    const target: Item = {
      id: item.id,
      name: item.name ?? 'Liked item',
      imageUrl: item.imageUrl ?? '',
      itemUrl: item.itemUrl ?? '',
      price: '',
      gender: '',
      liked: true,
    };

    lookupAbortController.current = controller;
    lookupRequestId.current = requestId;
    setLookupItem(target);
    setLookupResult(null);
    setLookupError(null);
    setLookupLoading(true);

    try {
      const result = await lookupPurchasableItem({
        imageUrl: target.imageUrl,
        itemHint: target.name,
        maxResults: 5,
        signal: controller.signal,
      });
      if (!controller.signal.aborted && lookupRequestId.current === requestId) setLookupResult(result);
    } catch (cause) {
      const safeError = toAiLookupError(cause);
      if (safeError.code !== 'cancelled' && lookupRequestId.current === requestId) {
        setLookupError({ code: safeError.code, message: safeError.message });
      }
    } finally {
      if (lookupRequestId.current === requestId) {
        setLookupLoading(false);
        lookupAbortController.current = null;
      }
    }
  }

  function closeLookup() {
    lookupRequestId.current += 1;
    lookupAbortController.current?.abort();
    lookupAbortController.current = null;
    setLookupItem(null);
    setLookupLoading(false);
    setLookupResult(null);
    setLookupError(null);
  }

  function openSettings() {
    closeLookup();
    router.push('/settings');
  }

  if (loading && !data) {
    return (
      <View style={[styles.loadingState, { backgroundColor: theme.background }]} accessibilityRole="progressbar" accessibilityLabel="Loading your style recap">
        <ActivityIndicator size="large" color={theme.text} />
        <Text style={styles.loadingText}>Loading your style recap...</Text>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: headerHeight + 24 }]}
        // Refresh feedback is shown in the keepers card once data is available.
        refreshControl={<RefreshControl refreshing={false} onRefresh={() => void load()} tintColor={theme.text} progressViewOffset={headerHeight} />}
      >
        {error && (
          <View style={[styles.card, surface]}>
            <Ionicons name="cloud-offline-outline" size={32} color={theme.text} />
            <Text style={[styles.sectionTitle, { color: theme.text }]}>Your wrap is taking a moment.</Text>
            <Text accessibilityRole="alert" style={[styles.body, { color: theme.text }]}>{error}</Text>
            <Pressable accessibilityRole="button" onPress={() => void load()} style={styles.darkButton}><Text style={styles.lightButtonText}>Try again</Text></Pressable>
          </View>
        )}
        {wrap && wrap.total === 0 ? (
          <View style={[styles.hero, { backgroundColor: theme.surface }]}>
            <Ionicons name="sparkles-outline" size={48} color={theme.text} />
            <Text style={styles.heroTitle}>Great style starts with a swipe.</Text>
            <Text style={styles.heroBody}>Find a few keepers and we’ll turn your likes, passes, and favorite looks into your personal style recap.</Text>
            <Pressable accessibilityRole="button" onPress={() => router.navigate('/swiper')} style={styles.darkButton}><Text style={styles.lightButtonText}>Find my first keeper</Text><Ionicons name="arrow-forward" size={18} color={BUTTON_TEXT} /></Pressable>
          </View>
        ) : wrap && data ? (
          <>
            <View style={styles.sectionHeader}><Text style={[styles.sectionTitle, { color: theme.text }]}>Your Reactions</Text><Ionicons name="stats-chart-outline" size={20} color={theme.text} /></View>
            <View style={styles.statRow}>
              {[
                { label: 'Saved reactions', value: wrap.total.toLocaleString(), color: surface.backgroundColor },
                { label: 'Like rate', value: `${wrap.likeRate}%`, color: theme.surface },
                { label: 'Dislike rate', value: `${wrap.dislikeRate}%`, color: theme.surface },
              ].map((stat) => <View key={stat.label} style={[styles.statCard, { backgroundColor: stat.color, borderColor: theme.border }]}><Text style={styles.statValue}>{stat.value}</Text><Text style={styles.statLabel}>{stat.label}</Text></View>)}
            </View>
            <View style={[styles.card, surface]}>
              <View style={styles.headingRow}><Text style={[styles.body, { color: theme.text }]}>{wrap.likes.length} liked</Text><Text style={[styles.body, { color: theme.text }]}>{wrap.dislikeCount} passed</Text></View>
              <View style={styles.verdictTrack} accessible accessibilityLabel={`${wrap.likeRate} percent liked, ${wrap.dislikeRate} percent passed`}>
                <View style={{ flex: wrap.likes.length, backgroundColor: theme.text }} /><View style={{ flex: wrap.dislikeCount, backgroundColor: theme.accentBrown }} />
              </View>
            </View>

            {data.tagsUnavailable && <View style={[styles.card, surface]}><Text style={[styles.body, { color: theme.text }]}>Your reaction stats are ready. Style tags couldn’t load yet.</Text><Pressable accessibilityRole="button" onPress={() => void load()} style={styles.textButton}><Text style={[styles.linkText, { color: theme.text }]}>Retry style insights</Text><Ionicons name="refresh" size={18} color={theme.text} /></Pressable></View>}

            <View style={styles.sectionDivider} />
            <View style={styles.sectionHeader}><Text style={[styles.sectionTitle, { color: theme.text }]}>Your Style</Text><Ionicons name="pricetag-outline" size={22} color={theme.text} accessibilityLabel="Top tags" /></View>
            <View style={[styles.card, surface]}>
              {wrap.styles.length ? <>
                {wrap.styles.slice(0, 3).map((tag, index) => <View key={tag.name} style={styles.rankRow}>
                  <Text style={[styles.rankNumber, { color: theme.text }]}>{String(wrap.styles.findIndex((entry) => entry.count === tag.count) + 1).padStart(2, '0')}</Text>
                  <View style={styles.flex}><View style={styles.headingRow}><Text style={[styles.tagName, { color: theme.text }]}>{tagLabel(tag.name)}</Text><Text style={[styles.small, { color: theme.text }]}>{tag.percent}%</Text></View><View style={[styles.rankTrack, { backgroundColor: theme.background }]}><View style={[styles.rankFill, { width: `${tag.percent}%`, backgroundColor: [theme.text, theme.primary, theme.accentGold][index] }]} /></View></View>
                </View>)}
              </> : <><Text style={[styles.tagName, { color: theme.text }]}>Your signature is still taking shape.</Text><Text style={[styles.body, { color: theme.text }]}>{data.tagsUnavailable ? 'Retry the style insights to reveal your favorites.' : 'As you like tagged pieces, your favorite styles will appear here.'}</Text></>}
            </View>

            <View style={styles.sectionDivider} />
            <View style={styles.sectionHeader}><Text style={[styles.sectionTitle, { color: theme.text }]}>Favorite Details</Text><Ionicons name="color-palette-outline" size={22} color={theme.text} /></View>
            <View style={[styles.card, surface]}>
              <Text style={[styles.tagName, { color: theme.text }]}>Your Color Palette</Text>
              {wrap.colors.length ? <View style={styles.palette}>{wrap.colors.slice(0, 8).map((tag) => <View key={tag.name} style={styles.colorItem}><View style={[styles.swatch, { backgroundColor: COLOR_SWATCHES[tag.name] ?? theme.background, borderColor: theme.border }]}>{!COLOR_SWATCHES[tag.name] && <Ionicons name="color-palette-outline" size={22} color={theme.text} />}</View><Text style={[styles.small, styles.centerText, { color: theme.text }]}>{tagLabel(tag.name)}</Text><Text style={[styles.small, { color: theme.text }]}>{tag.count} liked</Text></View>)}</View> : <Text style={[styles.body, { color: theme.text }]}>Color tags on your liked pieces will build your palette here.</Text>}
              <View style={[styles.divider, { backgroundColor: theme.border }]} />
              <View style={styles.detailRow}><Image source={{ uri: styleWrapDetailIcon('garment-type', topGarment?.name, theme.text) }} style={styles.detailIcon} contentFit="contain" /><View style={styles.flex}><Text style={[styles.small, { color: theme.text }]}>Go-To Piece{topGarment && wrap.garments[1]?.count === topGarment.count ? ' · TIED FAVORITE' : ''}</Text><Text style={[styles.tagName, { color: theme.text }]}>{topGarment ? tagLabel(topGarment.name) : 'Still discovering'}</Text></View>{topGarment && <Text style={[styles.small, { color: theme.text }]}>{topGarment.count} liked</Text>}</View>
              <View style={[styles.divider, { backgroundColor: theme.border }]} />
              <View style={styles.detailRow}><Image source={{ uri: styleWrapDetailIcon('fit', topFit?.name, theme.text) }} style={styles.detailIcon} contentFit="contain" /><View style={styles.flex}><Text style={[styles.small, { color: theme.text }]}>Signature Fit{topFit && wrap.fits[1]?.count === topFit.count ? ' · TIED FAVORITE' : ''}</Text><Text style={[styles.tagName, { color: theme.text }]}>{topFit ? tagLabel(topFit.name).replace(/ Fit$/, '') : 'Still discovering'}</Text></View>{topFit && <Text style={[styles.small, { color: theme.text }]}>{topFit.count} liked</Text>}</View>
            </View>

            {(featuredKeepers.length > 0 || loading) && <>
              <View style={styles.sectionDivider} />
              <View style={styles.sectionHeader}>
                <Text style={[styles.sectionTitle, { color: theme.text }]}>A few of your Keepers</Text>
                {loading ? (
                  <ActivityIndicator color={theme.text} size="small" accessibilityLabel="Refreshing your Keepers" />
                ) : (
                  <Ionicons name="heart" size={20} color={theme.text} />
                )}
              </View>
              <View style={[styles.card, surface]}>
              <View style={styles.gallery}>{featuredKeepers.map((item) => <View key={item.id} style={styles.galleryItem}>
                <Pressable accessibilityRole="link" accessibilityLabel={`Open the store page for ${item.name ?? 'this liked item'}`} onPress={() => void openStorePage(item.itemUrl!)} style={({ pressed }) => pressed && styles.galleryItemPressed}>
                  <Image source={{ uri: item.imageUrl! }} style={[styles.itemImage, { backgroundColor: theme.background }]} contentFit="cover" accessibilityLabel={item.name ?? 'Liked clothing item'} />
                  <Text numberOfLines={2} style={[styles.small, styles.galleryItemName, { color: theme.text }]}>{item.name ?? 'A keeper'}</Text>
                  <View style={styles.shopLink}><Text style={[styles.small, { color: theme.text }]}>Shop item</Text><Ionicons name="open-outline" size={14} color={theme.text} /></View>
                </Pressable>
                <Pressable accessibilityHint="Uses your selected AI provider to search for purchase listings" accessibilityLabel={`Find ${item.name ?? 'this liked item'} with AI`} accessibilityRole="button" onPress={() => void startLookup(item)} style={({ pressed }) => [styles.lookupButton, { backgroundColor: theme.primary }, pressed && styles.galleryItemPressed]}>
                  <Ionicons name="search" size={15} color={BUTTON_TEXT} />
                  <Text style={[styles.lookupButtonText, { color: BUTTON_TEXT }]}>Find it</Text>
                </Pressable>
              </View>)}</View>
              {purchaseError && <Text accessibilityRole="alert" style={[styles.small, { color: theme.accentBrown }]}>{purchaseError}</Text>}
              <Pressable accessibilityRole="button" onPress={() => router.navigate('/likelist')} style={styles.textButton}><Text style={[styles.linkText, { color: theme.text }]}>Revisit your likes</Text><Ionicons name="arrow-forward" size={18} color={theme.text} /></Pressable>
              </View>
            </>}

            <View style={styles.sectionDivider} />
            <View style={[styles.card, surface]}>
              <View style={styles.detailRow}><Ionicons name="ribbon-outline" size={32} color={theme.text} /><View style={styles.flex}><Text style={[styles.tagName, { color: theme.text }]}>Next Chapter: {wrap.milestone} Keepers</Text><Text style={[styles.body, { color: theme.text }]}>{wrap.milestone - wrap.likes.length} more likes until your next milestone.</Text></View></View>
              <View style={[styles.rankTrack, { backgroundColor: theme.background }]} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: wrap.milestone, now: wrap.likes.length }} accessibilityLabel="Keepers milestone"><View style={[styles.rankFill, { width: `${wrap.likes.length / wrap.milestone * 100}%`, backgroundColor: theme.text }]} /></View>
              <Pressable accessibilityRole="button" onPress={() => router.navigate('/swiper')} style={styles.darkButton}><Text style={styles.lightButtonText}>Find your next keeper</Text><Ionicons name="arrow-forward" size={18} color={BUTTON_TEXT} /></Pressable>
            </View>
          </>
        ) : null}
      </ScrollView>

      <ImageLookupModal
        errorCode={lookupError?.code ?? null}
        errorMessage={lookupError?.message ?? null}
        item={lookupItem}
        loading={lookupLoading}
        onClose={closeLookup}
        onOpenSettings={openSettings}
        onRetry={() => {
          const item = featuredKeepers.find((keeper) => keeper.id === lookupItem?.id);
          if (item) void startLookup(item);
        }}
        result={lookupResult}
      />
    </View>
  );
}

const createStyles = (theme: AppTheme) => StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1, minWidth: 0 },
  content: { paddingHorizontal: 20, paddingBottom: 32, gap: 16, maxWidth: 760, width: '100%', alignSelf: 'center' },
  headingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  eyebrow: { fontSize: 11, fontWeight: '800', letterSpacing: 1, color: theme.text, flexShrink: 1 },
  pageTitle: { fontFamily: 'GeorgiaProBold', fontSize: 32, marginTop: 7 },
  periodPill: { borderWidth: 1, borderRadius: 20, paddingVertical: 7, paddingHorizontal: 11 },
  intro: { fontSize: 15, lineHeight: 23, marginTop: -6, marginBottom: 6 },
  loadingState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, gap: 16 },
  loadingText: { fontFamily: 'PublicSans_600SemiBold', fontSize: 16, color: theme.text, textAlign: 'center' },
  card: { borderWidth: 1, borderRadius: 12, padding: 20, gap: 16 },
  hero: { borderRadius: 12, padding: 24, gap: 22, overflow: 'hidden' },
  heroTitle: { fontFamily: 'GeorgiaProBold', fontSize: 30, lineHeight: 38, color: theme.text },
  heroBody: { fontSize: 15, lineHeight: 23, color: theme.text },
  darkButton: { minHeight: 48, paddingHorizontal: 20, paddingVertical: 14, borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: theme.primary },
  lightButtonText: { fontWeight: '700', fontSize: 14, color: BUTTON_TEXT, flexShrink: 1 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  sectionTitle: { fontFamily: 'GeorgiaProSemiBold', fontSize: 21, flexShrink: 1 },
  statRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statCard: { flex: 1, minWidth: 90, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 20, gap: 8 },
  statValue: { color: theme.text, fontSize: 28, fontWeight: '800' },
  statLabel: { color: theme.text, fontSize: 11, lineHeight: 16 },
  body: { fontSize: 14, lineHeight: 22 },
  small: { color: theme.text, fontSize: 11, lineHeight: 17 },
  verdictTrack: { height: 14, borderRadius: 7, flexDirection: 'row', overflow: 'hidden' },
  rankRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  rankNumber: { fontFamily: 'GeorgiaProItalic', fontSize: 26 },
  tagName: { fontSize: 16, fontWeight: '700', flexShrink: 1 },
  rankTrack: { height: 7, borderRadius: 4, overflow: 'hidden', marginTop: 9 },
  rankFill: { height: '100%', borderRadius: 4 },
  personaTitle: { fontFamily: 'GeorgiaProBold', fontSize: 30, lineHeight: 38, color: theme.text },
  palette: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  colorItem: { width: 66, alignItems: 'center', gap: 5 },
  swatch: { width: 52, height: 52, borderRadius: 26, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginBottom: 3 },
  centerText: { textAlign: 'center' },
  divider: { height: 1 },
  sectionDivider: { height: 2, backgroundColor: theme.primary, marginVertical: 8 },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  detailIcon: { width: 25, height: 25, flexShrink: 0 },
  gallery: { flexDirection: 'row', gap: 12 },
  galleryItem: { flex: 1, gap: 8 },
  galleryItemPressed: { opacity: 0.65 },
  itemImage: { width: '100%', aspectRatio: 0.8, borderRadius: 12 },
  galleryItemName: { marginTop: 8 },
  shopLink: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  lookupButton: { alignItems: 'center', borderRadius: 10, flexDirection: 'row', gap: 5, justifyContent: 'center', paddingHorizontal: 8, paddingVertical: 10 },
  lookupButtonText: { fontSize: 12, fontWeight: '700' },
  textButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44, gap: 10 },
  linkText: { fontWeight: '700', fontSize: 14 },
  footer: { textAlign: 'center', fontSize: 12, lineHeight: 20, marginTop: 8 },
});
