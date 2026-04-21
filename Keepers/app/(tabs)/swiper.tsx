/**
 * File: swiper.tsx
 * Description: Displays swipeable clothing cards for users to like or dislike.
 * Author: Kai Markley & Gabriel Min
 * Date: 2026-04-01
 */

import React, { useCallback, useRef, useState, useEffect } from "react";
import { View, Text, StyleSheet, Dimensions } from "react-native";
import Swiper from "react-native-deck-swiper";
import { useFocusEffect } from '@react-navigation/native';

import { Image } from 'expo-image';
import * as WebBrowser from 'expo-web-browser';
import { supabase } from '../../utils/supabase';
import { Item } from '../../models/Items';
import { getClothing, saveLikedItem } from '../../services/dataServices';

const { height } = Dimensions.get("window");
const CARD_HEIGHT_RATIO = 0.7;
const CARD_VERTICAL_MARGIN = (height * (1 - CARD_HEIGHT_RATIO)) / 2;

const App: React.FC = () => {
  const swiper = useRef<any>(null);
  const [cards, setCards] = useState<Item[]>([]);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
    useEffect(() => {

    const checkSessionAndLoad = async () => {
      const { data, error } = await supabase.auth.getSession();
      if (error) {
        console.error('Failed to read session', error.message);
        setIsAuthReady(true);
        return;
      }

      const hasSession = !!data.session;
      setIsAuthenticated(hasSession);

      if (hasSession) {
        await initialDataFeed();
      } else {
        setCards([]);
      }

      setIsAuthReady(true);
    };

    const initialDataFeed = async () => {
      const data = await getClothing()
      if (!data) return

      const parsedCards = data.map((row) => {
        return {
          id: String(row.item_id),
          name: row.item_name,
          price: row.item_price,
          imageUrl: row.item_img,
          liked: false,
          itemUrl: row.item_web_listing,
        }
      })

      setCards((prev) => [...prev, ...parsedCards])
    }

    checkSessionAndLoad();

    const { data: listener } = supabase.auth.onAuthStateChange(async (_, session) => {
      const hasSession = !!session;
      setIsAuthenticated(hasSession);

      if (!hasSession) {
        setCards([]);
      } else {
        setCards([]);
        await initialDataFeed();
      }

      setIsAuthReady(true);
    });

    return () => {
      listener.subscription.unsubscribe();
    };
  }, [])

  if (!isAuthReady) {
    return (
      <View style={styles.messageContainer}>
        <Text style={styles.messageText}>Loading your feed...</Text>
      </View>
    );
  }

  if (!isAuthenticated) {
    return (
      <View style={styles.messageContainer}>
        <Text style={styles.messageText}>Please sign in to view your style feed.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Swiper<Item>
        ref={swiper}
        cards={cards}
        renderCard={(card: Item) => {
          if (!card) return null;
          return (
           <View style={styles.card}>
            <View style={styles.imagePlaceholder}>
              <Image
                style={styles.image}
                source={{ uri: card.imageUrl }}
                placeholder={{ blurhash }}
                contentFit="cover"
                transition={1000}
              />
            </View>
            <View style={styles.cardInfo}>
              <Text style={styles.cardName}>{card.name}</Text>
              <Text style={styles.cardPrice}>{card.price}</Text>
            </View>
          </View>
          );
        }}
        onSwiped={async (index: number) => {
          //console.log('Swiped index:', index);
          if (!isAuthenticated) {
            return;
          }

          if (index % 10 === 0) {
            const data = await getClothing();
            if (!data) return;

            const parsedCards = data.map((row) => {
              return {
                id: String(row.item_id),
                name: row.item_name,
                price: row.item_price,
                imageUrl: row.item_img,
                liked: false,
                itemUrl: row.item_web_listing,
              };
            });

            setCards((prev) => [...prev, ...parsedCards]);
          }
        }}
        onSwipedTop={(cardIndex) => {
          // Swiper updates to next card after this callback. Scheduled after React-Native-Deck-Swiper update.
          setTimeout(() => {
            swiper.current?.jumpToCardIndex(cardIndex);
          }, 0);
          const item = cards[cardIndex];
          if (item.itemUrl) {
            WebBrowser.openBrowserAsync(item.itemUrl);
          }
        }}
        onSwipedRight ={async (cardIndex: number) => {
          await saveLikedItem(cards[cardIndex].id);
          
        }}
        disableBottomSwipe={true}
        overlayLabels={overlayLabels}
        stackSize={3}
        stackSeparation={15}
        cardVerticalMargin={CARD_VERTICAL_MARGIN}
        backgroundColor="transparent"
      />
      
    </View>
  );
};

export default App;

const blurhash =
  '|rF?hV%2WCj[ayj[a|j[az_NaeWBj@ayfRayfQfQM{M|azj[azf6fQfQfQIpWXofj[ayj[j[fQayWCoeoeaya}j[ayfQa{oLj?j[WVj[ayayj[fQoff7azayj[ayj[j[ayofayayayj[fQj[ayayj[ayfjj[j[ayjuayj[';

const overlayLabels = {
  left: {
    title: "NOPE",
    style: {
      label: { color: "red", fontSize: 28, fontWeight: "bold", borderColor: "red", borderWidth: 2, padding: 8 },
      wrapper: { flexDirection: "column", alignItems: "flex-end", justifyContent: "flex-start", marginTop: 20, marginLeft: -20 },
    },
  },
  right: {
    title: "LIKE",
    style: {
      label: { color: "green", fontSize: 28, fontWeight: "bold", borderColor: "green", borderWidth: 2, padding: 8 },
      wrapper: { flexDirection: "column", alignItems: "flex-start", justifyContent: "flex-start", marginTop: 20, marginLeft: 20 },
    },
  },
  top: {
    title: "GO TO ITEM",
    style: {
      label: { color: "#007AFF", fontSize: 28, fontWeight: "bold", borderColor: "#007AFF", borderWidth: 2, padding: 8 },
      wrapper: { flexDirection: "column", alignItems: "center", justifyContent: "flex-center", marginTop: 570},
    },
  },
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  messageContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  messageText: {
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
    color: '#1A1A1A',
  },
  buttonContainer: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 28,
    zIndex: 20,
    backgroundColor: "rgba(255,255,255,0.95)",
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  card: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E8E8E8",
    backgroundColor: "white",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
  },
  text: {
    fontSize: 24,
  },
   image: {
    flex: 1,
    width: '100%',
    backgroundColor: '#0553',
  },
  imagePlaceholder: {
    flex: 1,
    width: "100%",
    backgroundColor: "#F0F0F0",
    alignItems: "center",
    justifyContent: "center",
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    overflow: "hidden",
  },
  imagePlaceholderText: {
    fontSize: 80,
  },
  cardInfo: {
    padding: 16,
    marginBottom: 20,
    gap: 6,
  },
  cardName: {
    fontSize: 20,
    fontWeight: "600",
    color: "#1A1A1A",
  },
  cardPrice: {
    fontSize: 18,
    fontWeight: "500",
    color: "#007AFF",
  },
});