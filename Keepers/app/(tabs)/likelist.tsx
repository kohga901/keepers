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
import { useAppTheme } from '../../hooks/useAppTheme';
import { Item } from '../../models/Items';
import { deleteLikedItem, getLikedItems } from '@/services/dataServices';
import { useFocusEffect } from '@react-navigation/native';


const App: React.FC = () => {
  const [allLikedItems, setAllLikedItems] = useState<Item[]>([]);
  const [selectedItem, setSelectedItem] = useState<Item | null>(null);
  const [modalVisible, setModalVisible] = useState(false);

  const deleteItem = (id: string) => {
    setAllLikedItems(prev => prev.filter(item => item.id !== id));
    deleteLikedItem(id);
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
          }));

        setAllLikedItems(parsedCards);
      };

      aquireLikedItems();

    }, [])
  );
  const { theme } = useAppTheme();

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
        {activeTab === 'liked' ? (
          <>
            <FlatList
              data={allLikedItems}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.list}
              renderItem={({ item }) => (
                <Swipeable
                  renderRightActions={() => (
                    <View style={styles.deleteAction}>
                      <Ionicons name="trash" size={24} color="white" />
                    </View>
                  )}
                  onSwipeableOpen={() => deleteItem(item.id)}
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
                        <Text style={[styles.itemName, { color: theme.text }]}>
                          {item.name}
                        </Text>
                        <Text style={[styles.itemPrice, { color: theme.text }]}>
                          {item.price}
                        </Text>
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
                        <View style={{ height: 1, backgroundColor: theme.background, width: '100%', marginVertical: 10 }} />
                        <Text style={{ color: theme.headerBg, fontSize: 18, fontWeight: '600', fontFamily: 'GeorgiaProSemiBold' }}>
                          {selectedItem.name}
                        </Text>
                        <Text style={{ color: theme.headerBg, fontFamily: 'GeorgiaProSemiBold' }}>
                          {selectedItem.price}
                        </Text>

                        <Pressable style={styles.closeButton} onPress={() => setModalVisible(false)}>
                          <Text style={styles.closeButtonText}>Close</Text>
                        </Pressable>
                      </View>
                    </>
                  )}
                </View>
              </Pressable>
            </Modal>
          </>
        ) : (
          <Text style={[styles.text, { color: theme.text }]}>
            Disliked items go here
          </Text>
        )}
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
    width: 200,
    height: 200,
    marginBottom: 10,
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
    color: 'red',
    fontSize: 16,
    fontWeight: 'bold',
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