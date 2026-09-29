/**
 * File: likelist.tsx
 * Description: Displays a list of items the user has liked, with tabs for liked and disliked items.
 * Author: Kai Markley
 * Date: 2026-04-18
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View, Pressable, FlatList, Modal } from 'react-native';
import { Image } from 'expo-image';
import { Swipeable } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { usePriceDisplay } from '../../contexts/PriceDisplayContext';
import { useAppTheme } from '../../hooks/useAppTheme';
import { Item } from '../../models/Items';
import { getPriceTierSymbol } from '../../utils/price';
import { deleteLikedItem, getLikedItems } from '@/services/dataServices';
import { useFocusEffect } from "expo-router/react-navigation";
import * as WebBrowser from 'expo-web-browser';

// Front-end-only mock data until a Dislikes table/service exists on the backend.
// Every name is prefixed "[DEMO]" so it's obvious in the UI that these aren't real items.
const MOCK_DISLIKED_ITEMS: Item[] = [
  {
    id: 'mock-d1',
    name: '[DEMO] Oversized Hoodie',
    price: '59.99',
    imageUrl: 'https://picsum.photos/seed/oversized-hoodie/300/300',
    liked: false,
    itemUrl: '',
    gender: 'unisex',
  },
  {
    id: 'mock-d2',
    name: '[DEMO] Striped Button-Up Shirt',
    price: '42.00',
    imageUrl: 'https://picsum.photos/seed/striped-shirt/300/300',
    liked: false,
    itemUrl: '',
    gender: 'mens',
  },
  {
    id: 'mock-d3',
    name: '[DEMO] Test Item (no server connection yet)',
    price: '0.00',
    imageUrl: 'https://picsum.photos/seed/test-fake-item/300/300',
    liked: false,
    itemUrl: '',
    gender: 'test',
  },
];

const TOGGLE_OPTION_WIDTH = 130;

const App: React.FC = () => {
  const [allLikedItems, setAllLikedItems] = useState<Item[]>([]);
  const [allDislikedItems, setAllDislikedItems] = useState<Item[]>(MOCK_DISLIKED_ITEMS);
  const [selectedItem, setSelectedItem] = useState<Item | null>(null);
  const [modalVisible, setModalVisible] = useState(false);

  const deleteItem = (id: string) => {
    setAllLikedItems(prev => prev.filter(item => item.id !== id));
    deleteLikedItem(id);
  };

  const deleteDislikedItem = (id: string) => {
    setAllDislikedItems(prev => prev.filter(item => item.id !== id));
  };


  useFocusEffect(
    useCallback(() => {
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
            gender: row.Clothing.item_gender,
          }));

        setAllLikedItems(parsedCards);
      };

      aquireLikedItems();

    }, [])
  );
  const { theme } = useAppTheme();
  const { showPriceAsTier } = usePriceDisplay();

  const [activeTab, setActiveTab] = React.useState('liked');
  const [filterOpen, setFilterOpen] = useState(false);
  const toggleAnim = useRef(new Animated.Value(0)).current;

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
    outputRange: [0, TOGGLE_OPTION_WIDTH],
  });

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={[styles.headerRow, { backgroundColor: theme.primary }]}>
        <View style={styles.toggleWrapper}>
          <View style={[styles.toggleContainer, { backgroundColor: theme.tabBg, borderColor: theme.border }]}>
            <Animated.View
              style={[
                styles.toggleIndicator,
                { width: TOGGLE_OPTION_WIDTH, backgroundColor: theme.primary, transform: [{ translateX: indicatorTranslate }] },
              ]}
            />
            <Pressable style={[styles.toggleOption, { width: TOGGLE_OPTION_WIDTH }]} onPress={() => setActiveTab('liked')}>
              <Text
                style={[
                  styles.toggleText,
                  { color: activeTab === 'liked' ? '#fff' : theme.tabInactive },
                ]}
              >
                Liked
              </Text>
            </Pressable>

            <Pressable style={[styles.toggleOption, { width: TOGGLE_OPTION_WIDTH }]} onPress={() => setActiveTab('disliked')}>
              <Text
                style={[
                  styles.toggleText,
                  { color: activeTab === 'disliked' ? '#fff' : theme.tabInactive },
                ]}
              >
                Disliked
              </Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.filterWrapper}>
          <Pressable
            style={[styles.filterButton, { backgroundColor: theme.tabBg, borderColor: theme.border }]}
            onPress={() => setFilterOpen((prev) => !prev)}
          >
            <Ionicons name="filter" size={20} color={theme.tabActive} />
          </Pressable>

          {filterOpen && (
            <View style={[styles.filterDropdown, { backgroundColor: theme.tabBg, borderColor: theme.border }]}>
              <Text style={[styles.filterDropdownText, { color: theme.mutedText }]}>Coming soon!</Text>
            </View>
          )}
        </View>
      </View>

      <View style={styles.content}>
        <FlatList
          data={activeTab === 'liked' ? allLikedItems : allDislikedItems}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <Swipeable
              renderRightActions={() => (
                <View style={styles.deleteAction}>
                  <Ionicons name="trash" size={24} color="white" />
                </View>
              )}
              onSwipeableOpen={() => (activeTab === 'liked' ? deleteItem(item.id) : deleteDislikedItem(item.id))}
            >
              <Pressable
                style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}
                onPress={() => {
                  setSelectedItem(item);
                  setModalVisible(true);
                }}
              >
                <View style={styles.imageContainer}>
                  <Image
                    style={[styles.image, { borderColor: theme.primary }]}
                    source={{ uri: item.imageUrl }}
                    contentFit="cover"
                    transition={1000}
                  />
                  <View style={styles.itemInfo}>
                    <Text style={[styles.itemName, { color: theme.text }, { fontFamily: 'GeorgiaProSemiBold', fontSize: 18 }]}>
                      {item.name}
                    </Text>
                    <View style={styles.priceGenderRow}>
                      <Text style={[styles.itemPrice, { color: theme.accentGold }, { fontFamily: 'GeorgiaProSemiBold' }]}>
                        {showPriceAsTier ? getPriceTierSymbol(item.price) : item.price}
                      </Text>
                      <Text style={[styles.itemGender, { color: theme.mutedText }, { fontFamily: 'GeorgiaProSemiBold' }]}>
                        {item.gender.toUpperCase()}
                      </Text>
                    </View>
                  </View>
                </View>
              </Pressable>
            </Swipeable>
          )}
        />

        <Modal
          visible={modalVisible}
          transparent={true}
          animationType="slide"
        >
          <Pressable style={styles.modalBackground} onPress={() => setModalVisible(false)}>
            <View style={styles.modalContainer}>
              {selectedItem && (
                <>
                  <Image
                    style={styles.modalImage}
                    source={{ uri: selectedItem.imageUrl }}
                  />
                  <View style={[styles.textAndButtonContainer, { backgroundColor: theme.primary }]}>
                    <Text style={{ color: '#FFFFFF', fontSize: 18, fontWeight: '600', fontFamily: 'GeorgiaProSemiBold' }}>
                      {selectedItem.name}
                    </Text>
                    <View style={{ height: 1, backgroundColor: '#FFFFFF', opacity: 0.4, width: '100%', marginVertical: 10 }} />

                    <Text style={{ color: theme.accentGold, fontFamily: 'GeorgiaProSemiBold', alignSelf: 'flex-start' }}>
                      {showPriceAsTier ? getPriceTierSymbol(selectedItem.price) : selectedItem.price}
                    </Text>
                    <Text style={{ color: '#FFFFFF', fontFamily: 'GeorgiaProSemiBold', alignSelf: 'flex-end' }}>
                      {selectedItem.gender.toUpperCase()}
                    </Text>

                    <Pressable style={[styles.closeButton, { backgroundColor: theme.surface }]} onPress={() => {
                      if (selectedItem.itemUrl) {
                        WebBrowser.openBrowserAsync(selectedItem.itemUrl);
                      }

                    }}>
                      <Text style={[styles.closeButtonText, { color: theme.text }]}>Go to Store Page</Text>
                    </Pressable>
                  </View>
                </>
              )}
            </View>
          </Pressable>
        </Modal>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 134,
    paddingBottom: 14,
    position: 'relative',
    zIndex: 20,
  },
  toggleWrapper: {
    flex: 1,
    alignItems: 'center',
  },
  toggleContainer: {
    flexDirection: 'row',
    borderRadius: 24,
    borderWidth: 1,
    padding: 4,
    position: 'relative',
  },
  toggleIndicator: {
    position: 'absolute',
    left: 4,
    top: 4,
    bottom: 4,
    borderRadius: 20,
  },
  toggleOption: {
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
  },
  toggleText: {
    fontSize: 16,
    fontWeight: '700',
    fontFamily: 'GeorgiaProSemiBold',
  },
  filterWrapper: {
    position: 'relative',
  },
  filterButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterDropdown: {
    position: 'absolute',
    top: 48,
    right: 0,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    zIndex: 10,
  },
  filterDropdownText: {
    fontSize: 14,
    fontWeight: '600',
    fontFamily: 'GeorgiaProSemiBold',
  },
  content: {
    flex: 1,
    paddingTop: 20,
  },
  list: {
    paddingHorizontal: 16,
  },
  card: {
    borderRadius: 12,
    marginBottom: 16,
    overflow: 'hidden',
    minHeight: 140,
    width: '100%',
    borderWidth: 2,
  },
  image: {
    width: 120,
    height: 120,
    borderRadius: 8,
    borderWidth: 2,
  },
  itemInfo: {
    flex: 1,
    padding: 12,
    justifyContent: 'flex-start',
    marginLeft: 10,
    
  },
  itemName: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 3,
    fontFamily: 'GeorgiaProSemiBold',
  },
  itemPrice: {
    fontSize: 14,
    fontWeight: '500',
    fontFamily: 'GeorgiaProRegular',
  },
  itemGender: {
    fontSize: 12,
    fontWeight: '400',
    fontFamily: 'GeorgiaProRegular',
  },
  priceGenderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  text: {
    fontSize: 18,
    fontWeight: '600',
    fontFamily: 'GeorgiaProRegular',
  },
  imageContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
  },
  modalBackground: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },

  modalContainer: {
    width: '80%',
    padding: 20,
    backgroundColor: 'white',
    borderRadius: 20,
    alignItems: 'center',
  },

  modalImage: {
    width: '100%',
    height: 300,
    marginBottom: 10,
    borderRadius: 15,
  },
  textAndButtonContainer: {
    padding: 10,
    borderRadius: 10,
    width: '100%',
    alignItems: 'center',
  },
  closeButton: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 10,
    marginTop: 20,
  },
  closeButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    fontFamily: 'GeorgiaProSemiBold',
  },
  deleteAction: {
    backgroundColor: 'red',
    justifyContent: 'center',
    alignItems: 'flex-end',
    width: '100%',
    height: '85%',
    borderRadius: 12,
    marginVertical: 5,
    paddingRight: 30,
  },
});
export default App;