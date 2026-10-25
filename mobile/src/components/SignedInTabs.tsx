import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../lib/theme';

const Tab = createBottomTabNavigator();

export function SignedInTabs({ chat, quotes, account }: { chat: React.ReactNode; quotes: React.ReactNode; account: React.ReactNode }) {
  const theme = useTheme();
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarHideOnKeyboard: true,
        tabBarActiveTintColor: theme.red,
        tabBarInactiveTintColor: theme.muted,
        tabBarStyle: { backgroundColor: theme.panel, borderTopColor: theme.line },
        tabBarIcon: ({ color, size }) => {
          const name = route.name === 'Chat' ? 'chatbubble-ellipses-outline' : route.name === 'Quotes' ? 'document-text-outline' : 'person-outline';
          return <Ionicons name={name as any} size={size} color={color} />;
        },
      })}>
      <Tab.Screen name="Chat">{() => chat}</Tab.Screen>
      <Tab.Screen name="Quotes">{() => quotes}</Tab.Screen>
      <Tab.Screen name="Account">{() => account}</Tab.Screen>
    </Tab.Navigator>
  );
}
