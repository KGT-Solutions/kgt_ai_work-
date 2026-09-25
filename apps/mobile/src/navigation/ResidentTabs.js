import React from 'react';
import { Platform, StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import HomeScreen from '../screens/HomeScreen';
import BillsScreen from '../screens/BillsScreen';
import ComplaintsScreen from '../screens/ComplaintsScreen';
import DirectoryScreen from '../screens/DirectoryScreen';
import ProfileScreen from '../screens/ProfileScreen';

const Tab = createBottomTabNavigator();

/** outline (inactive) / filled (active) — matches Figma footer */
const ICONS = {
  Home: { outline: 'home-outline', filled: 'home' },
  Bills: { outline: 'receipt-outline', filled: 'receipt' },
  Complaints: { outline: 'chatbubble-ellipses-outline', filled: 'chatbubble-ellipses' },
  Directory: { outline: 'book-outline', filled: 'book' },
  Profile: { outline: 'person-outline', filled: 'person' }
};

const ACTIVE = '#059669';
const INACTIVE = '#7ba392';

export default function ResidentTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: ACTIVE,
        tabBarInactiveTintColor: INACTIVE,
        tabBarHideOnKeyboard: true,
        tabBarStyle: styles.tabBar,
        tabBarItemStyle: styles.tabItem,
        tabBarLabelStyle: styles.tabLabel,
        sceneContainerStyle: { backgroundColor: 'transparent' },
        tabBarIcon: ({ color, focused, size }) => {
          const icons = ICONS[route.name];
          return (
            <Ionicons
              name={focused ? icons.filled : icons.outline}
              size={size ?? 22}
              color={color}
            />
          );
        }
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Bills" component={BillsScreen} />
      <Tab.Screen name="Complaints" component={ComplaintsScreen} />
      <Tab.Screen name="Directory" component={DirectoryScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: Platform.OS === 'ios' ? 24 : 14,
    height: 64,
    paddingTop: 6,
    paddingBottom: 6,
    backgroundColor: '#ffffff',
    borderTopWidth: 0,
    borderRadius: 24,
    overflow: 'hidden',
    elevation: 14,
    shadowColor: '#063c28',
    shadowOpacity: 0.22,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 }
  },
  tabItem: {
    paddingTop: 2
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2
  }
});
