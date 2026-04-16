import React from 'react';
import { StyleSheet, Text, View, Pressable, FlatList } from 'react-native';
import { Image } from 'expo-image';
import { useAppTheme } from '../../hooks/useAppTheme';
import { Item } from '../../models/Items';

export const fakeItems: Item[] = [
  {
    id: "1",
    name: "Black Hoodie",
    price: "$45",
    imageUrl: "data:image/webp;base64,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",
    itemUrl: "https://example.com/hoodie",
    gender: "men",
    liked: false,
  },
  {
    id: "2",
    name: "White Sneakers",
    price: "$80",
    imageUrl: "data:image/webp;base64,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",
    itemUrl: "https://example.com/sneakers",
    gender: "unisex",
    liked: false,
  },
  {
    id: "3",
    name: "Blue Jeans",
    price: "$60",
    imageUrl: "data:image/webp;base64,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",
    itemUrl: "https://example.com/jeans",
    gender: "women",
    liked: false,
  },
];
export default function LikeList() {
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
            data={fakeItems} 
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
    // backgroundColor: '#1a2329',
    // borderRadius: 12,
    // marginBottom: 16,
    // overflow: 'hidden',
    // shadowColor: '#000',
    // shadowOffset: { width: 0, height: 2 },
    // shadowOpacity: 0.1,
    // shadowRadius: 4,
    // elevation: 3,
    // minHeight: 140,

    backgroundColor: '#1a2329',
    borderRadius: 12,
    marginBottom: 16,
    overflow: 'hidden',
    minHeight: 140,
    width: '100%',
  },
  image: {
    width: 120,
    height: 120,
    borderRadius: 8,
  },
  itemInfo: {
    flex: 1,
    padding: 12,
    justifyContent: 'center',
    marginLeft: 10,
  },
  itemName: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  itemPrice: {
    fontSize: 14,
    fontWeight: '500',
  },
  text: {
    fontSize: 18,
    fontWeight: '600',
  },
  imageContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderWidth: 1,
  },
});