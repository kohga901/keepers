import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';

import { useAppTheme } from '../../hooks/useAppTheme';

export default function TabLayout() {
  const { theme } = useAppTheme();

  return (
    <Tabs
      screenOptions={{
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
          title: 'Home',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'home-sharp' : 'home-outline'} color={color} size={24} />
          ),
        }}
      />
      <Tabs.Screen
        name="about"
        options={{
          title: 'About',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'information-circle' : 'information-circle-outline'}
              color={color}
              size={24}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="likelist"
        options={{
          title: 'Like List',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'heart' : 'heart-outline'}
              color={color}
              size={24}
            />
          ),
        }}
      />
    </Tabs>
  );
}
