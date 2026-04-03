/**
 * File: likelist.tsx
 * Description: Currently a placeholder for the liked and disliked history of the user.
 * Author: Kai Markley
 * Date: 2026-04-01
 */

import React, { useState} from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';

export default function LikeList() {
  const { theme } = useAppTheme();
  const [activeTab, setActiveTab] = React.useState('liked');
  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>   
      <View style={styles.topTabs}>
        
        <Text
          style={[
            styles.tabText,
            activeTab === 'liked' && {     color: theme.text,
 },
          ]}
          onPress={() => setActiveTab('liked')}
        >
          Liked
        </Text>
        <Text
          style={[
            styles.tabText,
            activeTab === 'disliked' && {     color: theme.text,
 },
          ]}
          onPress={() => setActiveTab('disliked')}
        >
          Disliked
        </Text>
      </View>
    </View>

  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 20,
    color: '#4caf85',
  },
  text: {
    fontSize: 18,
    fontWeight: '600',
    color: '#4caf85',
  },
  topTabs: {
    flexDirection: 'row',
    marginBottom: 20,
    color: '#4caf85',
  },
  tabText: {
    fontSize: 16,
    fontWeight: '600',
    marginRight: 20,
    color: '#474747',
  },

});
