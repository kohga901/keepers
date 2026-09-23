/**
 * File: swiper.tsx
 * Description: Displays swipeable clothing cards for users to like or dislike.
 * Author: Kai Markley & Gabriel Min
 * Date: 2026-04-21
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, Dimensions, Pressable, StyleSheet, Text, View } from 'react-native';
import Swiper from 'react-native-deck-swiper';
import {getRecommendationsFromServer, sendSwipeToServer} from '../../services/serverApi';

import { Image } from 'expo-image';
import * as WebBrowser from 'expo-web-browser';
import { ImageLookupModal } from '../../components/ai/ImageLookupModal';
import { usePriceDisplay } from '../../contexts/PriceDisplayContext';
import { supabase } from '../../utils/supabase';
import { getPriceTierSymbol } from '../../utils/price';
import { Item, ClothingRow } from '../../models/Items';
import {
  lookupPurchasableItem,
  toAiLookupError,
  type AiLookupErrorCode,
  type ImageLookupResult,
} from '../../services/ai';

const { height } = Dimensions.get('window');
const CARD_HEIGHT_RATIO = 0.7;
const CARD_VERTICAL_MARGIN = (height * (1 - CARD_HEIGHT_RATIO)) / 2;

// This controls how many new items are fetched.
const amountOfItemsToFetch = 10;

const App: React.FC = () => {
  const router = useRouter();
  const swiper = useRef<any>(null);
  const loadedUserId = useRef<string | null>(null);
  const lookupAbortController = useRef<AbortController | null>(null);
  const lookupRequestId = useRef(0);
  const [cards, setCards] = useState<Item[]>([]);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [lookupItem, setLookupItem] = useState<Item | null>(null);
  const [lookupResult, setLookupResult] = useState<ImageLookupResult | null>(null);
  const [lookupError, setLookupError] = useState<{
    code: AiLookupErrorCode;
    message: string;
  } | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const { showPriceAsTier } = usePriceDisplay();

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
        await initialDataFeed(data.session.user.id);
      } else {
        setCards([]);
      }

      setIsAuthReady(true);
    };

    const initialDataFeed = async (userId: string) => {
      if (loadedUserId.current === userId) return;
      loadedUserId.current = userId;

      const data = await getRecommendationsFromServer(amountOfItemsToFetch);
      if (!data) return

      const parsedCards: Item[] = data.map((row: ClothingRow) => {
        return {
          id: String(row.item_id),
          name: row.item_name,
          price: row.item_price,
          imageUrl: row.item_img,
          liked: false,
          itemUrl: row.item_web_listing,
          gender: row.item_gender,
        };
      });

      setCards((prev) => [...prev, ...parsedCards])
    }

    checkSessionAndLoad();

    const { data: listener } = supabase.auth.onAuthStateChange(async (_, session) => {
      const hasSession = !!session;
      setIsAuthenticated(hasSession);

      if (!hasSession) {
        loadedUserId.current = null;
        setCards([]);
      } else {
        setCards([]);
        await initialDataFeed(session.user.id);
      }

      setIsAuthReady(true);
    });

    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    return () => {
      lookupAbortController.current?.abort();
    };
  }, []);

  const startLookup = async (item: Item) => {
    lookupAbortController.current?.abort();
    const controller = new AbortController();
    const requestId = lookupRequestId.current + 1;
    lookupAbortController.current = controller;
    lookupRequestId.current = requestId;

    setLookupItem(item);
    setLookupResult(null);
    setLookupError(null);
    setLookupLoading(true);

    try {
      const result = await lookupPurchasableItem({
        imageUrl: item.imageUrl,
        itemHint: item.name,
        maxResults: 5,
        signal: controller.signal,
      });

      if (!controller.signal.aborted && lookupRequestId.current === requestId) {
        setLookupResult(result);
      }
    } catch (error) {
      const safeError = toAiLookupError(error);
      if (safeError.code !== 'cancelled' && lookupRequestId.current === requestId) {
        setLookupError({ code: safeError.code, message: safeError.message });
      }
    } finally {
      if (lookupRequestId.current === requestId) {
        setLookupLoading(false);
        lookupAbortController.current = null;
      }
    }
  };

  const closeLookup = () => {
    lookupRequestId.current += 1;
    lookupAbortController.current?.abort();
    lookupAbortController.current = null;
    setLookupItem(null);
    setLookupLoading(false);
    setLookupResult(null);
    setLookupError(null);
  };

  const openSettings = () => {
    closeLookup();
    router.push('/settings');
  };

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
              <View style={styles.cardDetails}>
                <Text numberOfLines={2} style={styles.cardName}>{card.name}</Text>
                <Text style={styles.cardPrice}>
                  {showPriceAsTier ? getPriceTierSymbol(card.price) : card.price}
                </Text>
              </View>
              <Pressable
                accessibilityHint="Uses your selected AI provider to search for purchase listings"
                accessibilityLabel={`Find ${card.name} with AI`}
                accessibilityRole="button"
                onPress={() => void startLookup(card)}
                style={({ pressed }) => [styles.lookupButton, pressed && styles.lookupButtonPressed]}
              >
                <Ionicons name="search" color="#FFFFFF" size={17} />
                <Text style={styles.lookupButtonText}>Find it</Text>
              </Pressable>
            </View>
          </View>
          );
        }}
        onSwiped={async (index: number) => {
          //console.log('Swiped index:', index);
          if (!isAuthenticated) {
            return;
          }

          if ((index+3) % amountOfItemsToFetch === 0) {
            const data = await getRecommendationsFromServer(amountOfItemsToFetch);
            if (!data) return;

            const parsedCards: Item[] = data.map((row: ClothingRow) => {
              return {
                id: String(row.item_id),
                name: row.item_name,
                price: row.item_price,
                imageUrl: row.item_img,
                liked: false,
                itemUrl: row.item_web_listing,
                gender: row.item_gender,
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
          if (item?.itemUrl) {
            try {
              const parsedUrl = new URL(item.itemUrl);
              if (parsedUrl.protocol === 'https:') {
                void WebBrowser.openBrowserAsync(parsedUrl.toString());
              } else {
                Alert.alert('Link unavailable', 'Keepers blocked an insecure listing link.');
              }
            } catch {
              Alert.alert('Link unavailable', 'This item does not have a valid listing link.');
            }
          }
        }}
        onSwipedLeft={async (cardIndex: number) => {
          await sendSwipeToServer(cards[cardIndex].id, false);
        }}
        onSwipedRight ={async (cardIndex: number) => {
          await sendSwipeToServer(cards[cardIndex].id, true);
          
        }}
        disableBottomSwipe={true}
        overlayLabels={overlayLabels}
        stackSize={3}
        stackSeparation={15}
        cardVerticalMargin={CARD_VERTICAL_MARGIN}
        backgroundColor="transparent"
      />

      <ImageLookupModal
        errorCode={lookupError?.code ?? null}
        errorMessage={lookupError?.message ?? null}
        item={lookupItem}
        loading={lookupLoading}
        onClose={closeLookup}
        onOpenSettings={openSettings}
        onRetry={() => {
          if (lookupItem) void startLookup(lookupItem);
        }}
        result={lookupResult}
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
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    padding: 16,
    marginBottom: 20,
  },
  cardDetails: {
    flex: 1,
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
  lookupButton: {
    alignItems: 'center',
    backgroundColor: '#1A6F55',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  lookupButtonPressed: {
    opacity: 0.72,
  },
  lookupButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
});
