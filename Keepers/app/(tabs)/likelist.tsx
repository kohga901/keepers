/**
 * File: likelist.tsx
 * Description: Shows the items the user has liked or disliked as a two-column photo grid, with a toggle
 *              (with counts) to switch lists and a corner button on each card to remove it.
 * Author: Kai Markley
 * Date: 2026-04-18
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, StyleSheet, View, Pressable, FlatList, Modal, ScrollView, KeyboardAvoidingView, Platform, useWindowDimensions } from 'react-native';
import { Text } from '../../components/Text';
import { TAB_CONTENT_MAX_WIDTH } from '../../constants/layout';
import { PriceAlertEditor } from '../../components/PriceAlertEditor';
import { PriceAlertsBell } from '../../components/PriceAlertsBell';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { useSafeAreaFrame, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { usePriceDisplay } from '../../contexts/PriceDisplayContext';
import { useTutorial } from '../../contexts/TutorialContext';
import { useStackHeaderHeight } from '../../contexts/StackHeaderHeightContext';
import { useAppTheme } from '../../hooks/useAppTheme';
import { Item } from '../../models/Items';
import { getPriceTierSymbol } from '../../utils/price';
import { deleteLikedItem, getLikedItems, deleteDislikedItem as deleteDislikedItemRemote, getDislikedItems, getClothingById } from '@/services/dataServices';
import { getDefaultHeaderHeight, useFocusEffect } from "expo-router/react-navigation";
import * as WebBrowser from 'expo-web-browser';

const LIST_PADDING = 16;
const GRID_GAP = 12;
const TOGGLE_INSET = 4;

// Counts above 99 would crowd the toggle.
const formatCount = (count: number) => (count > 99 ? '99+' : String(count));

const App: React.FC = () => {
  const router = useRouter();
  const { itemId } = useLocalSearchParams<{ itemId?: string | string[] }>();
  const requestedItemId = Array.isArray(itemId) ? itemId[0] : itemId;
  const safeFrame = useSafeAreaFrame();
  const viewport = useWindowDimensions();
  // Expo Router supplies a zero safe-area frame on web; size from the live viewport there.
  const frame = Platform.OS === 'web' ? { ...safeFrame, width: viewport.width, height: viewport.height } : safeFrame;
  const layoutWidth = Platform.OS === 'web' ? Math.min(frame.width, TAB_CONTENT_MAX_WIDTH) : frame.width;
  // Drop the balancing spacer on small phones so both labels and counts fit beside the bell.
  const headerSpacerWidth = layoutWidth < 360 ? 0 : 44;
  const toggleOptionWidth = Math.min(150, (layoutWidth - LIST_PADDING * 2 - headerSpacerWidth - 44 - TOGGLE_INSET * 2) / 2);
  // Two cards per row inside the same max width the web layout uses.
  const contentWidth = Math.min(frame.width, TAB_CONTENT_MAX_WIDTH) - LIST_PADDING * 2;
  const cardWidth = Math.floor((contentWidth - GRID_GAP) / 2);
  const [allLikedItems, setAllLikedItems] = useState<Item[]>([]);
  const [allDislikedItems, setAllDislikedItems] = useState<Item[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [selectedItem, setSelectedItem] = useState<Item | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [imageExpanded, setImageExpanded] = useState(false);
  const [itemError, setItemError] = useState<string | null>(null);
  const { showTutorialOnce } = useTutorial();

  // First visit to History walks through the grid, the toggle, item details, and the remove button.
  useFocusEffect(
    useCallback(() => {
      showTutorialOnce('history');
    }, [showTutorialOnce])
  );

  const deleteItem = (id: string) => {
    setAllLikedItems(prev => prev.filter(item => item.id !== id));
    deleteLikedItem(id);
  };

  const deleteDislikedItem = (id: string) => {
    setAllDislikedItems(prev => prev.filter(item => item.id !== id));
    deleteDislikedItemRemote(id);
  };


  useFocusEffect(
    useCallback(() => {
      let active = true;
      setIsLoadingHistory(true);

      const aquireLikedItems = async () => {
        const data = await getLikedItems();

        if (!data) return;

        const parsedCards = (data as any[])
          .filter((row) => row.Clothing)
          .map((row) => ({
            id: String(row.Clothing.item_id),
            name: row.Clothing.item_name,
            price: row.Clothing.item_price,
            imageUrl: row.Clothing.item_img,
            liked: true,
            itemUrl: row.Clothing.item_web_listing,
            gender: row.Clothing.item_gender ?? '',
          }));

        if (active) setAllLikedItems(parsedCards);
      };

      const aquireDislikedItems = async () => {
        const data = await getDislikedItems();

        if (!data) return;

        const parsedCards = (data as any[])
          .filter((row) => row.Clothing)
          .map((row) => ({
            id: String(row.Clothing.item_id),
            name: row.Clothing.item_name,
            price: row.Clothing.item_price,
            imageUrl: row.Clothing.item_img,
            liked: false,
            itemUrl: row.Clothing.item_web_listing,
            gender: row.Clothing.item_gender ?? '',
          }));

        if (active) setAllDislikedItems(parsedCards);
      };

      void Promise.allSettled([aquireLikedItems(), aquireDislikedItems()]).then((results) => {
        if (!active) return;
        results.forEach((result) => {
          if (result.status === 'rejected') console.error('Failed to load history', result.reason);
        });
        setIsLoadingHistory(false);
      });

      return () => { active = false; };
    }, [])
  );
  const { theme } = useAppTheme();
  const { showPriceAsTier } = usePriceDisplay();

  const [activeTab, setActiveTab] = React.useState('liked');
  const [toggleAnim] = useState(() => new Animated.Value(0));

  useEffect(() => {
    Animated.timing(toggleAnim, {
      toValue: activeTab === 'liked' ? 0 : 1,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [activeTab, toggleAnim]);

  const indicatorTranslate = toggleAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, toggleOptionWidth],
  });

  // Collapsing header: slides up as the list scrolls down, and back in on scroll up.
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList<Item>>(null);
  const [scrollY] = useState(() => new Animated.Value(0));
  const onListScroll = useMemo(
    () => Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true }),
    [scrollY],
  );
  // Match the real height of the "KEEPERS" header shown on the other tabs (e.g. Swiper).
  const stackHeaderHeight = useStackHeaderHeight();
  const headerHeight = stackHeaderHeight > 0 ? stackHeaderHeight : getDefaultHeaderHeight(frame, false, insets.top);
  const headerBarHeight = headerHeight - insets.top;

  const headerTranslate = useMemo(() => {
    // Ignore iOS overscroll bounce so the header doesn't jitter at the top.
    const clampedScroll = scrollY.interpolate({
      inputRange: [0, 1],
      outputRange: [0, 1],
      extrapolateLeft: 'clamp',
    });
    return Animated.diffClamp(clampedScroll, 0, headerHeight).interpolate({
      inputRange: [0, headerHeight],
      outputRange: [0, -headerHeight],
    });
  }, [scrollY, headerHeight]);

  const switchTab = (tab: string) => {
    setActiveTab(tab);
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  };

  useEffect(() => {
    if (!requestedItemId || isLoadingHistory) return;
    let active = true;
    void (async () => {
      try {
        const row = await getClothingById(requestedItemId);
        if (!active) return;
        setItemError(null);
        if (!row) throw new Error('This item could not be loaded. Please try again from your notifications.');
        setSelectedItem({
          id: String(row.item_id), name: row.item_name, price: row.item_price ?? '',
          imageUrl: row.item_img, itemUrl: row.item_web_listing, gender: row.item_gender ?? '',
          liked: allLikedItems.some(item => item.id === requestedItemId),
        });
        setModalVisible(true);
      } catch (failure) {
        if (active) setItemError(failure instanceof Error ? failure.message : 'This item could not be loaded. Please try again.');
      } finally {
        if (active) {
          setActiveTab('liked');
          setImageExpanded(false);
          listRef.current?.scrollToOffset({ offset: 0, animated: false });
          router.setParams({ itemId: undefined });
        }
      }
    })();
    return () => { active = false; };
  }, [requestedItemId, isLoadingHistory, allLikedItems, router]);

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <Animated.View
        style={[
          styles.headerContainer,
          { backgroundColor: theme.primary, height: headerHeight, transform: [{ translateY: headerTranslate }] },
        ]}
      >
        <View style={[styles.headerRow, Platform.OS === 'web' && styles.webContent, { height: headerBarHeight }]}>
          {/* Balance the bell where there is room to keep the toggle centred. */}
          <View style={{ width: headerSpacerWidth }} />
          <View style={styles.toggleWrapper}>
            <View style={[styles.toggleContainer, { width: toggleOptionWidth * 2 + TOGGLE_INSET * 2, backgroundColor: theme.tabBg, borderColor: theme.border }]}>
              <Animated.View
                style={[
                  styles.toggleIndicator,
                  { width: toggleOptionWidth, backgroundColor: theme.primary, transform: [{ translateX: indicatorTranslate }] },
                ]}
              />
              {([
                { tab: 'liked', label: 'Liked', icon: 'heart', count: allLikedItems.length },
                { tab: 'disliked', label: 'Disliked', icon: 'close', count: allDislikedItems.length },
              ] as const).map(({ tab, label, icon, count }) => {
                const isOn = activeTab === tab;
                return (
                  <Pressable
                    key={tab}
                    style={[styles.toggleOption, { width: toggleOptionWidth }]}
                    onPress={() => switchTab(tab)}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: isOn }}
                    accessibilityLabel={isLoadingHistory ? label : `${label}, ${count} ${count === 1 ? 'item' : 'items'}`}
                  >
                    <Ionicons name={icon} size={15} color={isOn ? theme.headerText : theme.tabInactive} />
                    <Text style={[styles.toggleText, { color: isOn ? theme.headerText : theme.tabInactive }]}>{label}</Text>
                    {!isLoadingHistory && (
                      <View style={[styles.countPill, { backgroundColor: isOn ? theme.accentGold : theme.border }]}>
                        <Text style={[styles.countText, { color: isOn ? theme.text : theme.tabInactive }]}>{formatCount(count)}</Text>
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </View>
          </View>

          <PriceAlertsBell color={theme.tabActive} />
        </View>
      </Animated.View>

      <View style={[styles.content, Platform.OS === 'web' && styles.webContent]}>
        {isLoadingHistory ? (
          <View style={[styles.loadingState, { paddingTop: headerHeight }]} accessibilityRole="progressbar" accessibilityLabel="Loading your history">
            <ActivityIndicator size="large" color={theme.text} />
            <Text style={[styles.loadingText, { color: theme.text }]}>Loading your history...</Text>
          </View>
        ) : <Animated.FlatList
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
          ref={listRef}
          data={activeTab === 'liked' ? allLikedItems : allDislikedItems}
          keyExtractor={(item) => item.id}
          numColumns={2}
          columnWrapperStyle={styles.gridRow}
          contentContainerStyle={[styles.list, { paddingTop: headerHeight + 16 }]}
          scrollIndicatorInsets={{ top: headerHeight }}
          onScroll={onListScroll}
          scrollEventThrottle={16}
          ListHeaderComponent={itemError ? <Text accessibilityRole="alert" style={{ color: theme.text, paddingBottom: 16 }}>{itemError}</Text> : undefined}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <View style={[styles.emptyIcon, { backgroundColor: theme.primary }]}>
                <Ionicons name={activeTab === 'liked' ? 'heart' : 'close'} size={40} color={theme.headerText} />
              </View>
              <Text style={[styles.emptyTitle, { color: theme.text }]}>
                {activeTab === 'liked' ? 'No liked items yet' : 'No disliked items yet'}
              </Text>
              <Text style={[styles.emptyText, { color: theme.mutedText }]}>
                {activeTab === 'liked'
                  ? 'Swipe right on pieces you love and they’ll show up here.'
                  : 'Swipe left on pieces that aren’t for you and they’ll show up here.'}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.navigate('/swiper')}
                style={[styles.emptyButton, { backgroundColor: theme.primary }]}
              >
                <Text style={[styles.emptyButtonText, { color: theme.headerText }]}>Start swiping</Text>
                <Ionicons name="arrow-forward" size={18} color={theme.headerText} />
              </Pressable>
            </View>
          }
          renderItem={({ item }) => {
            const liked = activeTab === 'liked';
            return (
              <Pressable
                style={[styles.card, { width: cardWidth, backgroundColor: theme.surface }]}
                accessibilityRole="button"
                accessibilityLabel={`View ${item.name} details`}
                onPress={() => {
                  setSelectedItem(item);
                  setModalVisible(true);
                }}
              >
                <View style={[styles.cardImageWrap, { height: cardWidth * 4 / 3, backgroundColor: theme.border }]}>
                  <Image
                    style={styles.cardImage}
                    source={{ uri: item.imageUrl }}
                    contentFit="cover"
                    transition={250}
                  />
                  <Pressable
                    style={[styles.removeButton, { backgroundColor: theme.surface }]}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${item.name} from ${liked ? 'liked' : 'disliked'} items`}
                    onPress={() => (liked ? deleteItem(item.id) : deleteDislikedItem(item.id))}
                  >
                    <Ionicons
                      name={liked ? 'heart' : 'close'}
                      size={liked ? 18 : 20}
                      color={liked ? theme.accentBrown : theme.text}
                    />
                  </Pressable>
                </View>
                <View style={styles.cardInfo}>
                  <Text numberOfLines={2} style={[styles.itemName, { color: theme.text }]}>
                    {item.name}
                  </Text>
                  <View style={styles.priceGenderRow}>
                    <Text style={[styles.itemPrice, { color: theme.accentBrown }]}>
                      {showPriceAsTier ? getPriceTierSymbol(item.price) : item.price}
                    </Text>
                    {!!item.gender && (
                      <Text style={[styles.itemGender, { color: theme.mutedText }]}>
                        {item.gender.toUpperCase()}
                      </Text>
                    )}
                  </View>
                </View>
              </Pressable>
            );
          }}
        />}

        <Modal
          visible={modalVisible}
          transparent={true}
          animationType="slide"
          onRequestClose={() => imageExpanded ? setImageExpanded(false) : setModalVisible(false)}
        >
          {imageExpanded ? (
            <View style={{ flex: 1, backgroundColor: '#000000', paddingTop: insets.top, paddingBottom: insets.bottom }}>
              <Image source={{ uri: selectedItem?.imageUrl }} style={{ flex: 1, width: '100%' }} contentFit="contain"
                accessibilityLabel={selectedItem?.name} />
              <Pressable onPress={() => setImageExpanded(false)} accessibilityRole="button" accessibilityLabel="Close full-size image"
                style={[styles.modalClose, { top: insets.top + 12, backgroundColor: theme.surface }]}>
                <Ionicons name="close" size={24} color={theme.text} />
              </Pressable>
            </View>
          ) : (
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Pressable style={styles.modalBackground} onPress={() => setModalVisible(false)}>
            <Pressable style={[styles.modalContainer, { maxHeight: '90%', backgroundColor: theme.surface }]} onPress={event => event.stopPropagation()}>
              <ScrollView style={{ width: '100%' }} keyboardShouldPersistTaps="handled">
              {selectedItem && (
                <>
                  <Pressable onPress={() => setImageExpanded(true)} accessibilityRole="button" accessibilityLabel="View full-size image">
                  <Image
                    style={styles.modalImage}
                    source={{ uri: selectedItem.imageUrl }}
                  />
                  </Pressable>
                  <View style={[styles.textAndButtonContainer, { backgroundColor: theme.primary }]}>
                    <Text style={{ color: '#FFFFFF', fontSize: 18, fontWeight: '600', fontFamily: 'PublicSans_600SemiBold' }}>
                      {selectedItem.name}
                    </Text>
                    <View style={{ height: 1, backgroundColor: '#FFFFFF', opacity: 0.4, width: '100%', marginVertical: 10 }} />

                    <View style={styles.modalPriceGenderRow}>
                    <Text style={{ color: theme.accentGold, fontFamily: 'PublicSans_600SemiBold' }}>
                      {showPriceAsTier ? getPriceTierSymbol(selectedItem.price) : selectedItem.price}
                    </Text>
                    <Text style={{ color: '#FFFFFF', fontFamily: 'PublicSans_600SemiBold' }}>
                      {selectedItem.gender.toUpperCase()}
                    </Text>
                    </View>

                    <Pressable style={[styles.closeButton, { backgroundColor: theme.surface }]} onPress={() => {
                      if (selectedItem.itemUrl) {
                        WebBrowser.openBrowserAsync(selectedItem.itemUrl);
                      }

                    }}>
                      <Text style={[styles.closeButtonText, { color: theme.text }]}>Go to Store Page</Text>
                    </Pressable>
                    {selectedItem.liked && <PriceAlertEditor key={selectedItem.id} itemId={selectedItem.id} price={selectedItem.price} />}
                  </View>
                </>
              )}
              </ScrollView>
              <Pressable onPress={() => setModalVisible(false)} accessibilityRole="button" accessibilityLabel="Close item details"
                style={[styles.modalClose, { backgroundColor: theme.surface }]}>
                <Ionicons name="close" size={24} color={theme.text} />
              </Pressable>
            </Pressable>
          </Pressable>
          </KeyboardAvoidingView>
          )}
        </Modal>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  webContent: { maxWidth: TAB_CONTENT_MAX_WIDTH, width: '100%', alignSelf: 'center' },
  container: {
    flex: 1,
  },
  headerContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 20,
    justifyContent: 'flex-end',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  toggleWrapper: {
    flex: 1,
    alignItems: 'center',
  },
  toggleContainer: {
    flexDirection: 'row',
    flexShrink: 0,
    borderRadius: 24,
    borderWidth: 1,
    padding: 3,
    position: 'relative',
  },
  toggleIndicator: {
    position: 'absolute',
    left: 3,
    top: 3,
    bottom: 3,
    borderRadius: 20,
  },
  toggleOption: {
    flexDirection: 'row',
    flexShrink: 0,
    gap: 5,
    paddingVertical: 7,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
  },
  toggleText: {
    fontSize: 15,
    fontWeight: '700',
  },
  countPill: {
    minWidth: 22,
    paddingHorizontal: 6,
    borderRadius: 10,
    alignItems: 'center',
  },
  countText: {
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 18,
  },
  content: {
    flex: 1,
  },
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  loadingText: {
    fontSize: 16,
    fontWeight: '600',
  },
  list: {
    paddingHorizontal: LIST_PADDING,
    paddingBottom: 24,
  },
  gridRow: {
    gap: GRID_GAP,
  },
  emptyState: {
    alignItems: 'center',
    paddingTop: 72,
    paddingHorizontal: 24,
    gap: 10,
  },
  emptyIcon: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  emptyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
    paddingVertical: 12,
    paddingHorizontal: 22,
    borderRadius: 24,
  },
  emptyButtonText: {
    fontSize: 16,
    fontWeight: '700',
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700',
    fontFamily: 'PublicSans_700Bold',
    textAlign: 'center',
  },
  emptyText: {
    fontSize: 15,
    fontWeight: '500',
    fontFamily: 'PublicSans_500Medium',
    textAlign: 'center',
    lineHeight: 21,
  },
  card: {
    borderRadius: 16,
    marginBottom: GRID_GAP,
    elevation: 2,
    shadowColor: '#0c3b2e',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
  },
  cardImageWrap: {
    width: '100%',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: 'hidden',
  },
  cardImage: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  removeButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 2,
    shadowColor: '#0c3b2e',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
  },
  cardInfo: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 12,
    flexGrow: 1,
    justifyContent: 'space-between',
  },
  itemName: {
    minHeight: 38,
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 19,
  },
  itemPrice: {
    fontSize: 15,
    fontWeight: '700',
  },
  itemGender: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.6,
  },
  priceGenderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  modalBackground: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },

  modalContainer: {
    width: '94%',
    maxWidth: 600,
    padding: 20,
    borderRadius: 20,
    alignItems: 'center',
  },

  modalImage: {
    width: '100%',
    height: 300,
    marginBottom: 10,
    borderRadius: 15,
  },
  modalClose: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 3,
    zIndex: 1,
  },
  textAndButtonContainer: {
    padding: 10,
    borderRadius: 10,
    width: '100%',
    alignItems: 'center',
  },
  modalPriceGenderRow: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  closeButton: {
    width: '100%',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 10,
    marginTop: 20,
  },
  closeButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    fontFamily: 'PublicSans_600SemiBold',
  },
});
export default App;
