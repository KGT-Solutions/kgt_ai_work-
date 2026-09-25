import React from 'react';
import { Platform, StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import VisitorScreen from '../screens/VisitorScreen';
import NotificationsScreen from '../screens/NotificationsScreen';
import DirectoryScreen from '../screens/DirectoryScreen';
import ProfileScreen from '../screens/ProfileScreen';
import withGuardBrand from './withGuardBrand';

const Tab = createBottomTabNavigator();
const GuardVisitors = withGuardBrand(VisitorScreen);
const GuardNotifications = withGuardBrand(NotificationsScreen);
const GuardDirectory = withGuardBrand(DirectoryScreen);
const GuardProfile = withGuardBrand(ProfileScreen);

/** outline (inactive) / filled (active) — matches resident footer */
const ICONS = {
  Visitors: { outline: 'people-outline', filled: 'people' },
  Notifications: { outline: 'notifications-outline', filled: 'notifications' },
  Directory: { outline: 'call-outline', filled: 'call' },
  Profile: { outline: 'person-outline', filled: 'person' }
};

const ACTIVE = '#059669';
const INACTIVE = '#7ba392';

export default function GuardTabs() {
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
      <Tab.Screen name="Visitors" component={GuardVisitors} options={{ title: 'Gate log' }} />
      <Tab.Screen name="Notifications" component={GuardNotifications} />
      <Tab.Screen name="Directory" component={GuardDirectory} options={{ title: 'Directory' }} />
      <Tab.Screen name="Profile" component={GuardProfile} />
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
