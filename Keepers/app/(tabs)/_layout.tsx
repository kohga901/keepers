/**
 * File: _layout.tsx
 * Description: Defines the layout for the tab navigator in the app,
 *  including the header and theme. Also creates the tab naviagator with icons and styling.  
 * Author: Kai Markley & Gabriel Min
 * Date: 2026-04-01
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';

import { useAppTheme } from '../../hooks/useAppTheme';

export default function TabLayout() {
  const { theme } = useAppTheme();

  return (
    <Tabs
        screenOptions={{
          headerShown: false,   // 👈 ADD THIS
          tabBarActiveTintColor: theme.tabActive,
          tabBarInactiveTintColor: theme.tabInactive,
          headerStyle: {
            backgroundColor: theme.headerBg,
          },
          headerShadowVisible: false,
          headerTintColor: theme.headerText,
          sceneStyle: {
            backgroundColor: theme.background,
          },
          tabBarStyle: {
            backgroundColor: theme.tabBg,
            borderTopColor: theme.border,
          },
        }}
      >
    
      <Tabs.Screen
        name="index"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="likelist"
        options={{
          title: 'Liked History',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'heart' : 'heart-outline'}
              color={color}
              size={24}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="swiper"
        options={{
          title: 'Swiper',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'shirt' : 'shirt-outline'}
              color={color}
              size={24}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="stylewraps"
        options={{
          title: 'Style Wraps',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'receipt' : 'receipt-outline'}
              color={color}
              size={24}
            />
          ),
        }}
      />

      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'settings' : 'settings-outline'}
              color={color}
              size={24}
            />
          ),
        }}
      />
    </Tabs>
  );
}
