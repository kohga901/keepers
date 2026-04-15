import React from 'react';
import { StyleSheet, Text, View, Pressable } from 'react-native';
import { useAppTheme } from '../../hooks/useAppTheme';

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
          <Text style={[styles.text, { color: theme.text }]}>Liked items go here</Text>
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
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    fontSize: 18,
    fontWeight: '600',
  },
});