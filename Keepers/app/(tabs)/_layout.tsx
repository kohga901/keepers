/**
 * File: _layout.tsx
 * Description: Defines the layout for the tab navigator in the app,
 *  including the header and theme. Also creates the tab naviagator with icons and styling.  
 * Author: Kai Markley & Gabriel Min
 * Date: 2026-04-01
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';

import { StackHeaderHeightProvider } from '../../contexts/StackHeaderHeightContext';
import { useAppTheme } from '../../hooks/useAppTheme';

const TAB_ICON_SIZE = 30;

export default function TabLayout() {
  const { theme } = useAppTheme();

  return (
    <StackHeaderHeightProvider>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarShowLabel: false,
          tabBarActiveTintColor: theme.tabBarActive,
          tabBarInactiveTintColor: theme.tabBarInactive,
          headerStyle: {
            backgroundColor: theme.headerBg,
          },
          headerShadowVisible: false,
          headerTintColor: theme.headerText,
          sceneStyle: {
            backgroundColor: theme.background,
          },
          tabBarStyle: {
            backgroundColor: theme.tabBarBg,
            borderTopColor: theme.tabBarBg,
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
                size={TAB_ICON_SIZE}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="graph"
          options={{
            title: 'Graph',
            tabBarIcon: ({ color, focused }) => (
              <Ionicons
                name={focused ? 'stats-chart' : 'stats-chart-outline'}
                color={color}
                size={TAB_ICON_SIZE}
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
                size={TAB_ICON_SIZE}
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
                size={TAB_ICON_SIZE}
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
                size={TAB_ICON_SIZE}
              />
            ),
          }}
        />
      </Tabs>
    </StackHeaderHeightProvider>
  );
}
