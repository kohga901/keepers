/**
 * File: likelist.tsx
 * Description: Displays a list of items the user has liked, with tabs for liked and disliked items.
 * Author: Kai Markley
 * Date: 2026-04-18
 */

import React, {useCallback, useEffect, useState} from 'react';
import { StyleSheet, Text, View, Pressable, FlatList } from 'react-native';
import { Image } from 'expo-image';
import { useAppTheme } from '../../hooks/useAppTheme';
import { Item } from '../../models/Items';
import { getClothing, getLikedItems } from '@/services/dataServices';
import { useFocusEffect } from '@react-navigation/native';

const App: React.FC = () => {
  const [allLikedItems, setAllLikedItems] = useState<Item[]>([]);
    const addLikedItem = (item: Item) => {
      setAllLikedItems((prev) => [...prev, { ...item, liked: true }]);
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
            <FlatList
              data={allLikedItems} 
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.list}
              renderItem={({ item }) => (
                <Pressable style={styles.card}>
                  <View style={styles.imageContainer}>
                    <Image
                      style={styles.image}
                      source={{ uri: item.imageUrl }}
                      contentFit="cover"
                     transition={1000}
                    />
                   <View style={styles.itemInfo}>
                      <Text style={[styles.itemName, { color: theme.text }]}>{item.name}</Text>
                      <Text style={[styles.itemPrice, { color: theme.text }]}>{item.price}</Text>
                   </View>
                  </View>
               </Pressable>
              )}
            />
          ) : (            
          <Text style={[styles.text, { color: theme.text }]}>Disliked items go here</Text>
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
      // alignItems: 'center',
      // justifyContent: 'center',
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
  });
export default App;