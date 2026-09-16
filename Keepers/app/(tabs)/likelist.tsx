/**
 * File: likelist.tsx
 * Description: Displays a list of items the user has liked, with tabs for liked and disliked items.
 * Author: Kai Markley
 * Date: 2026-04-18
 */

import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View, Pressable, FlatList, Modal } from 'react-native';
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
const MOCK_DISLIKED_ITEMS: Item[] = [
  {
    id: 'mock-d1',
    name: 'Oversized Hoodie',
    price: '59.99',
    imageUrl: 'https://picsum.photos/seed/oversized-hoodie/300/300',
    liked: false,
    itemUrl: '',
    gender: 'unisex',
  },
  {
    id: 'mock-d2',
    name: 'Striped Button-Up Shirt',
    price: '42.00',
    imageUrl: 'https://picsum.photos/seed/striped-shirt/300/300',
    liked: false,
    itemUrl: '',
    gender: 'mens',
  },
];

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

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={styles.topTabs}>
        <Pressable onPress={() => setActiveTab('liked')}>
          <Text
            style={[
              styles.tabText,
              { color: activeTab === 'liked' ? theme.text : theme.tabInactive },
            ]}
          >
            Liked
          </Text>
        </Pressable>

        <Pressable onPress={() => setActiveTab('disliked')}>
          <Text
            style={[
              styles.tabText,
              { color: activeTab === 'disliked' ? theme.text : theme.tabInactive },
            ]}
          >
            Disliked
          </Text>
        </Pressable>
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
                style={styles.card}
                onPress={() => {
                  setSelectedItem(item);
                  setModalVisible(true);
                }}
              >
                <View style={styles.imageContainer}>
                  <Image
                    style={styles.image}
                    source={{ uri: item.imageUrl }}
                    contentFit="cover"
                    transition={1000}
                  />
                  <View style={styles.itemInfo}>
                    <Text style={[styles.itemName, { color: 'black' }, { fontFamily: 'GeorgiaProSemiBold', fontSize: 18 }]}>
                      {item.name}
                    </Text>
                    <View style={styles.priceGenderRow}>
                      <Text style={[styles.itemPrice, { color: 'blue' }, { fontFamily: 'GeorgiaProSemiBold' }]}>
                        {showPriceAsTier ? getPriceTierSymbol(item.price) : item.price}
                      </Text>
                      <Text style={[styles.itemGender, { color: 'black' }, { fontFamily: 'GeorgiaProSemiBold' }]}>
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
                  <View style={styles.textAndButtonContainer}>
                    <Text style={{ color: theme.headerBg, fontSize: 18, fontWeight: '600', fontFamily: 'GeorgiaProSemiBold' }}>
                      {selectedItem.name}
                    </Text>
                    <View style={{ height: 1, backgroundColor: theme.background, width: '100%', marginVertical: 10 }} />

                    <Text style={{ color: theme.headerBg, fontFamily: 'GeorgiaProSemiBold', alignSelf: 'flex-start' }}>
                      {showPriceAsTier ? getPriceTierSymbol(selectedItem.price) : selectedItem.price}
                    </Text>
                    <Text style={{ color: theme.headerBg, fontFamily: 'GeorgiaProSemiBold', alignSelf: 'flex-end' }}>
                      {selectedItem.gender.toUpperCase()}
                    </Text>

                    <Pressable style={styles.closeButton} onPress={() => {
                      if (selectedItem.itemUrl) {
                        WebBrowser.openBrowserAsync(selectedItem.itemUrl);
                      }

                    }}>
                      <Text style={styles.closeButtonText}>Go to Store Page</Text>
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
    paddingTop: 120,
  },
  topTabs: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    marginBottom: 24,
  },
  tabText: {
    fontSize: 20,
    fontWeight: '700',
    marginHorizontal: 24,
    fontFamily: 'GeorgiaProSemiBold',
  },
  content: {
    flex: 1,
  },
  list: {
    paddingHorizontal: 16,
  },
  card: {
    backgroundColor: '#f6f8fa',
    borderRadius: 12,
    marginBottom: 16,
    overflow: 'hidden',
    minHeight: 140,
    width: '100%',
    borderWidth: 2,
    borderColor: '#7f909a',
  },
  image: {
    width: 120,
    height: 120,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#4caf85',
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
    backgroundColor: '#4caf85',
    padding: 10,
    borderRadius: 10,
    width: '100%',
    alignItems: 'center',
  },
  closeButton: {
    backgroundColor: '#fff',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 10,
    marginTop: 20,
  },
  closeButtonText: {
    color: 'Black',
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