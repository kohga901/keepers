import React from "react";
import { View, Text, StyleSheet, Dimensions } from "react-native";
import Swiper from "react-native-deck-swiper";

const { height } = Dimensions.get("window");

const cards = [
  { name: "Floral Summer Dress", price: "$49.99" },
  { name: "Classic Denim Jacket", price: "$89.00" },
  { name: "Slim Fit Chinos", price: "$34.99" },
  { name: "Oversized Hoodie", price: "$59.99" },
  { name: "Striped Button-Up Shirt", price: "$42.00" },
];

export default function App() {
  return (
    <View style={styles.container}>
      <Swiper
        cards={cards}
        renderCard={(card) => {
          if (!card) return null;
          return (
            <View style={styles.card}>
              <View style={styles.imagePlaceholder}>
                <Text style={styles.imagePlaceholderText}>👕</Text>
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
        backgroundColor={"#F5FCFF"}
        stackSize={3}
        cardVerticalMargin={height * 0.04}
        cardHorizontalMargin={20}
        animateOverlayLabelsOpacity
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F5FCFF",
    alignItems: "center",
    justifyContent: "center",
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