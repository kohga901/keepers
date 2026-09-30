import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import * as WebBrowser from 'expo-web-browser';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAppTheme } from '../../hooks/useAppTheme';
import type { Item } from '../../models/Items';
import type { AiLookupErrorCode, ImageLookupResult } from '../../services/ai';

type ImageLookupModalProps = {
  errorCode: AiLookupErrorCode | null;
  errorMessage: string | null;
  item: Item | null;
  loading: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
  onRetry: () => void;
  result: ImageLookupResult | null;
};

function isSafeExternalUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

async function openExternalUrl(url: string) {
  if (!isSafeExternalUrl(url)) {
    Alert.alert('Link unavailable', 'Keepers blocked a link that was not a secure HTTPS address.');
    return;
  }

  try {
    await WebBrowser.openBrowserAsync(url);
  } catch {
    Alert.alert('Link unavailable', 'Keepers could not open this link.');
  }
}

export function ImageLookupModal({
  errorCode,
  errorMessage,
  item,
  loading,
  onClose,
  onOpenSettings,
  onRetry,
  result,
}: ImageLookupModalProps) {
  const { theme } = useAppTheme();

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="pageSheet"
      visible={item !== null}
    >
      <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
        <View style={[styles.header, { borderBottomColor: theme.border }]}>
          <View style={styles.headerText}>
            <Text style={[styles.eyebrow, { color: theme.mutedText }]}>AI SHOPPING SEARCH</Text>
            <Text numberOfLines={1} style={[styles.headerTitle, { color: theme.text }]}>
              {item?.name ?? 'Find this item'}
            </Text>
          </View>
          <Pressable
            accessibilityLabel="Close lookup results"
            accessibilityRole="button"
            hitSlop={10}
            onPress={onClose}
            style={({ pressed }) => [styles.closeButton, { opacity: pressed ? 0.55 : 1 }]}
          >
            <Ionicons name="close" size={28} color={theme.text} />
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {item && (
            <Image
              accessibilityLabel={`Image of ${item.name}`}
              contentFit="cover"
              source={{ uri: item.imageUrl }}
              style={[styles.itemImage, { backgroundColor: theme.surface }]}
              transition={250}
            />
          )}

          {loading && (
            <View accessibilityLiveRegion="polite" style={styles.stateBlock}>
              <ActivityIndicator color={theme.primary} size="large" />
              <Text style={[styles.stateTitle, { color: theme.text }]}>Identifying this item…</Text>
              <Text style={[styles.stateBody, { color: theme.mutedText }]}>
                The AI is identifying the item and preparing shopping options. This can take up to a
                minute.
              </Text>
            </View>
          )}

          {!loading && errorMessage && (
            <View accessibilityLiveRegion="polite" style={styles.stateBlock}>
              <Ionicons name="alert-circle-outline" size={38} color="#E36D6D" />
              <Text style={[styles.stateTitle, { color: theme.text }]}>Lookup didn’t finish</Text>
              <Text style={[styles.stateBody, { color: theme.mutedText }]}>{errorMessage}</Text>
              <View style={styles.stateActions}>
                {errorCode === 'missing_key' || errorCode === 'invalid_key' ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={onOpenSettings}
                    style={({ pressed }) => [
                      styles.primaryButton,
                      { backgroundColor: theme.primary, opacity: pressed ? 0.72 : 1 },
                    ]}
                  >
                    <Text style={styles.primaryButtonText}>Open settings</Text>
                  </Pressable>
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    onPress={onRetry}
                    style={({ pressed }) => [
                      styles.primaryButton,
                      { backgroundColor: theme.primary, opacity: pressed ? 0.72 : 1 },
                    ]}
                  >
                    <Text style={styles.primaryButtonText}>Try again</Text>
                  </Pressable>
                )}
              </View>
            </View>
          )}

          {!loading && result && (
            <View style={styles.results}>
              <View style={[styles.summaryCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                <Text style={[styles.resultName, { color: theme.text }]}>
                  {result.identifiedItem.name}
                </Text>
                <Text style={[styles.metadata, { color: theme.mutedText }]}>
                  {[result.identifiedItem.brand, result.identifiedItem.category]
                    .filter((value) => value.toLowerCase() !== 'unknown')
                    .join(' · ') || 'Item details uncertain'}
                </Text>
                <Text style={[styles.summary, { color: theme.mutedText }]}>
                  {result.searchSummary}
                </Text>
              </View>

              <View style={styles.sectionHeader}>
                <Text style={[styles.sectionTitle, { color: theme.text }]}>
                  {result.searchLinks.length > 0 ? 'Marketplace searches' : 'Purchase options'}
                </Text>
                <Text style={[styles.sectionCount, { color: theme.mutedText }]}>
                  {result.listings.length + result.searchLinks.length}
                </Text>
              </View>

              {result.listings.length === 0 && result.searchLinks.length === 0 && (
                <View style={[styles.emptyCard, { borderColor: theme.border }]}>
                  <Text style={[styles.stateBody, { color: theme.mutedText }]}>
                    No trustworthy purchase links were returned for this image. Try another photo or
                    provider.
                  </Text>
                </View>
              )}

              {result.listings.map((listing) => (
                <View
                  key={listing.url}
                  style={[
                    styles.listingCard,
                    { backgroundColor: theme.surface, borderColor: theme.border },
                  ]}
                >
                  <View style={styles.badgeRow}>
                    <View style={[styles.matchBadge, { borderColor: theme.primary }]}>
                      <Text style={[styles.badgeText, { color: theme.primary }]}>
                        {listing.matchType === 'exact' ? 'POSSIBLE EXACT MATCH' : 'SIMILAR ITEM'}
                      </Text>
                    </View>
                    <Text style={[styles.confidence, { color: theme.mutedText }]}>
                      {Math.round(listing.confidence * 100)}% AI confidence
                    </Text>
                  </View>
                  <Text style={[styles.listingTitle, { color: theme.text }]}>{listing.title}</Text>
                  <Text style={[styles.listingMeta, { color: theme.mutedText }]}>
                    {listing.seller} · {listing.displayedPrice} · {listing.condition}
                  </Text>
                  <Text style={[styles.evidence, { color: theme.mutedText }]}>
                    {listing.evidence}
                  </Text>
                  {!listing.sourceBacked && (
                    <Text style={styles.unverifiedText}>
                      No matching citation was returned for this link. Verify it carefully.
                    </Text>
                  )}
                  <Pressable
                    accessibilityHint="Opens this seller link in an in-app browser"
                    accessibilityRole="link"
                    onPress={() => void openExternalUrl(listing.url)}
                    style={({ pressed }) => [
                      styles.openButton,
                      { backgroundColor: theme.primary, opacity: pressed ? 0.72 : 1 },
                    ]}
                  >
                    <Text style={styles.primaryButtonText}>View listing</Text>
                    <Ionicons name="open-outline" size={16} color="#0F1418" />
                  </Pressable>
                </View>
              ))}

              {result.searchLinks.map((searchLink) => (
                <View
                  key={searchLink.url}
                  style={[
                    styles.listingCard,
                    { backgroundColor: theme.surface, borderColor: theme.border },
                  ]}
                >
                  <View style={styles.badgeRow}>
                    <View style={[styles.matchBadge, { borderColor: theme.primary }]}>
                      <Text style={[styles.badgeText, { color: theme.primary }]}>SEARCH LINK</Text>
                    </View>
                    <Text style={[styles.confidence, { color: theme.mutedText }]}>
                      {searchLink.marketplace}
                    </Text>
                  </View>
                  <Text style={[styles.listingTitle, { color: theme.text }]}>{searchLink.title}</Text>
                  <Text style={[styles.evidence, { color: theme.mutedText }]}>
                    Search terms: {searchLink.query}
                  </Text>
                  <Pressable
                    accessibilityHint={`Searches ${searchLink.marketplace} in an in-app browser`}
                    accessibilityRole="link"
                    onPress={() => void openExternalUrl(searchLink.url)}
                    style={({ pressed }) => [
                      styles.openButton,
                      { backgroundColor: theme.primary, opacity: pressed ? 0.72 : 1 },
                    ]}
                  >
                    <Text style={styles.primaryButtonText}>Search {searchLink.marketplace}</Text>
                    <Ionicons name="search-outline" size={16} color="#0F1418" />
                  </Pressable>
                </View>
              ))}

              {result.sources.length > 0 && (
                <View style={styles.sourcesSection}>
                  <Text style={[styles.sectionTitle, { color: theme.text }]}>Search sources</Text>
                  <Text style={[styles.sourceHelp, { color: theme.mutedText }]}>
                    Sources used by the provider. Links and listing details can change.
                  </Text>
                  {result.sources.map((source, index) => (
                    <Pressable
                      accessibilityRole="link"
                      key={source.url}
                      onPress={() => void openExternalUrl(source.url)}
                      style={({ pressed }) => [styles.sourceLink, { opacity: pressed ? 0.55 : 1 }]}
                    >
                      <Text numberOfLines={2} style={[styles.sourceText, { color: theme.primary }]}>
                        {index + 1}. {source.title}
                      </Text>
                      <Ionicons name="open-outline" size={15} color={theme.primary} />
                    </Pressable>
                  ))}
                </View>
              )}

              <Text style={[styles.disclaimer, { color: theme.mutedText }]}>
                {result.searchLinks.length > 0
                  ? 'Gemini identified the item, and Keepers generated these marketplace searches locally. They are not verified listings. Check the product, seller, price, condition, and return policy before purchasing.'
                  : 'AI can misidentify products and sellers can change prices or availability. Verify the photo, seller, condition, price, and return policy before purchasing.'}
              </Text>
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  header: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  headerText: {
    flex: 1,
    marginRight: 16,
  },
  eyebrow: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.1,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginTop: 2,
  },
  closeButton: {
    alignItems: 'center',
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  content: {
    padding: 20,
    paddingBottom: 44,
  },
  itemImage: {
    borderRadius: 14,
    height: 190,
    overflow: 'hidden',
    width: '100%',
  },
  stateBlock: {
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 18,
    paddingVertical: 44,
  },
  stateTitle: {
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  stateBody: {
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
  },
  stateActions: {
    marginTop: 8,
  },
  primaryButton: {
    alignItems: 'center',
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  primaryButtonText: {
    color: '#0F1418',
    fontSize: 14,
    fontWeight: '800',
  },
  results: {
    gap: 14,
    marginTop: 16,
  },
  summaryCard: {
    borderRadius: 14,
    borderWidth: 1,
    gap: 5,
    padding: 16,
  },
  resultName: {
    fontSize: 21,
    fontWeight: '700',
  },
  metadata: {
    fontSize: 13,
    fontWeight: '600',
  },
  summary: {
    fontSize: 13,
    lineHeight: 19,
    marginTop: 4,
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  sectionCount: {
    fontSize: 13,
    fontWeight: '700',
  },
  emptyCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 18,
  },
  listingCard: {
    borderRadius: 14,
    borderWidth: 1,
    gap: 8,
    padding: 15,
  },
  badgeRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'space-between',
  },
  matchBadge: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  badgeText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  confidence: {
    fontSize: 10,
    fontWeight: '600',
  },
  listingTitle: {
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 21,
  },
  listingMeta: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  evidence: {
    fontSize: 12,
    lineHeight: 18,
  },
  unverifiedText: {
    color: '#D88955',
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 16,
  },
  openButton: {
    alignItems: 'center',
    borderRadius: 9,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    marginTop: 3,
    paddingVertical: 11,
  },
  sourcesSection: {
    gap: 8,
    marginTop: 6,
  },
  sourceHelp: {
    fontSize: 12,
    lineHeight: 17,
  },
  sourceLink: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  sourceText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    textDecorationLine: 'underline',
  },
  disclaimer: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: 8,
    textAlign: 'center',
  },
});
