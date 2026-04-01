import React from "react";
import { View, Text, StyleSheet, Dimensions } from "react-native";
import Swiper from "react-native-deck-swiper";
import { Image } from 'expo-image';
import { useAppTheme } from '../../hooks/useAppTheme';



const { height } = Dimensions.get("window");

const cards = [
  { name: "Floral Summer Dress", price: "$49.99", url: "https://encrypted-tbn3.gstatic.com/shopping?q=tbn:ANd9GcTYc1bSnxvvXQRFp_QzSHXai1CfuYWe6Qw_nk-Jsju0roFCzN2NiFGS5_wTVMLSAqkMjlZkF1mufpbcjpxAOB-EV6t_mOsh" },
  { name: "Classic Denim Jacket", price: "$89.00", url: "https://encrypted-tbn2.gstatic.com/shopping?q=tbn:ANd9GcQHm0M_4d7xaJh6yuZYe2e64mLVAwfPC-6BnSqEf6CwW0TcMLUT0onY6yUD4NHg6idh_fHQz9my1fKuMr1ZjGj1RUYzYnZl" },
  { name: "Slim Fit Chinos", price: "$34.99", url: "https://www.kuhl.com/_next/image/?url=https%3A%2F%2Fwww.kuhl.com%2Fmedia%2Fuploads%2Fpdp%2F5109%2Fbutcha_overlanding_053.jpg&w=1080&q=100" },
  { name: "Oversized Hoodie", price: "$59.99", url: "https://ricoma.com/cdn/shop/files/maker-apparel-beige-hoodie-ricoma-embroidery-machines.webp?v=1749140249&width=900" },
  { name: "Striped Button-Up Shirt", price: "$42.00", url: "https://aurelien-online.com/cdn/shop/files/aurelien_linen_shirt_overhemd_linnen_heren_light_blue_stripe1.jpg?v=1741952773&width=600" },
];

export default function App() {
    const { theme } = useAppTheme();

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <Swiper
        cards={cards}
        renderCard={(card) => {
          if (!card) return null;
          return (
            <View style={styles.card}>
              <View style={styles.imagePlaceholder}>
                 <Image
                    style={styles.image}
                    source={{ uri: card.url }}
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
        overlayLabels={overlayLabels}
        onSwiped={(cardIndex) => { console.log(cardIndex); }}
        onSwipedAll={() => { console.log("onSwipedAll"); }}
        cardIndex={0}
        backgroundColor={theme.background}
        stackSize={3}
        cardVerticalMargin={height * 0.04}
        cardHorizontalMargin={20}
        animateCardOpacity
      />
    </View>
  );
}

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
    title: "SAVE",
    style: {
      label: { color: "#007AFF", fontSize: 28, fontWeight: "bold", borderColor: "#007AFF", borderWidth: 2, padding: 8 },
      wrapper: { flexDirection: "column", alignItems: "center", justifyContent: "flex-end", marginBottom: 20 },
    },
  },
};
const blurhash =
  '|rF?hV%2WCj[ayj[a|j[az_NaeWBj@ayfRayfQfQM{M|azj[azf6fQfQfQIpWXofj[ayj[j[fQayWCoeoeaya}j[ayfQa{oLj?j[WVj[ayayj[fQoff7azayj[ayj[j[ayofayayayj[fQj[ayayj[ayfjj[j[ayjuayj[';


const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  image: {
    flex: 1,
    width: '100%',
    backgroundColor: '#0553',
  },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E8E8E8",
    backgroundColor: "white",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 4,
    overflow: "hidden",
  },
  imagePlaceholder: {
    height: 460,
    backgroundColor: "#F0F0F0",
    alignItems: "center",
    justifyContent: "center",
  },
  imagePlaceholderText: {
    fontSize: 80,
  },
  cardInfo: {
    padding: 16,
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