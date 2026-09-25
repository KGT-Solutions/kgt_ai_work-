import React from 'react';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '../context/AuthContext';
import { colors } from '../theme';

import SplashScreen from '../screens/SplashScreen';
import LoginScreen from '../screens/LoginScreen';
import OtpScreen from '../screens/OtpScreen';
import BuildingCodeScreen from '../screens/BuildingCodeScreen';
import SelectSocietyScreen from '../screens/SelectSocietyScreen';
import ResidentTabs from './ResidentTabs';
import GuardTabs from './GuardTabs';
import RaiseComplaintScreen from '../screens/RaiseComplaintScreen';
import AnnouncementsScreen from '../screens/AnnouncementsScreen';
import VotingScreen from '../screens/VotingScreen';
import FacilityBookingScreen from '../screens/FacilityBookingScreen';
import MarketplaceScreen from '../screens/MarketplaceScreen';
import MyAdsScreen from '../screens/MyAdsScreen';
import VisitorScreen from '../screens/VisitorScreen';
import EmergencyScreen from '../screens/EmergencyScreen';
import FamilyMembersScreen from '../screens/FamilyMembersScreen';
import PersonalDetailsScreen from '../screens/PersonalDetailsScreen';
import VehiclesScreen from '../screens/VehiclesScreen';
import VendorServicesScreen from '../screens/VendorServicesScreen';
import PastVotesScreen from '../screens/PastVotesScreen';
import GuardLoginScreen from '../screens/GuardLoginScreen';
import GuardSignupScreen from '../screens/GuardSignupScreen';
import NotificationsScreen from '../screens/NotificationsScreen';
import GuardResidentsScreen from '../screens/GuardResidentsScreen';
import ReportBugScreen from '../screens/ReportBugScreen';
import SupportChatScreen from '../screens/SupportChatScreen';

const Stack = createNativeStackNavigator();

const NESTED_SHELLS = new Set(['ResidentTabs', 'GuardTabs']);

function formatDocumentTitle(options, route) {
  const page = options?.title || route?.name;
  if (!page || NESTED_SHELLS.has(page)) return 'FLATBRIZ';
  return `${page} · FLATBRIZ`;
}

/** Let App.js root gradient show through (default theme paints cream/white) */
const navTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: 'transparent',
    card: 'transparent'
  }
};

export default function RootNavigator() {
  const { user, activeMembership, loading } = useAuth();

  if (loading) return <SplashScreen />;

  return (
    <NavigationContainer
      theme={navTheme}
      documentTitle={{ formatter: formatDocumentTitle }}
    >
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          headerTintColor: colors.primary,
          headerStyle: { backgroundColor: 'transparent' },
          contentStyle: { backgroundColor: 'transparent' }
        }}
      >
        {!user ? (
          <>
            <Stack.Screen name="Login" component={LoginScreen} />
            <Stack.Screen name="GuardLogin" component={GuardLoginScreen} />
            <Stack.Screen name="GuardSignup" component={GuardSignupScreen} />
            <Stack.Screen name="Otp" component={OtpScreen} />
            <Stack.Screen name="BuildingCode" component={BuildingCodeScreen} />
          </>
        ) : !activeMembership ? (
          <Stack.Screen name="SelectSociety" component={SelectSocietyScreen} />
        ) : activeMembership?.role === 'guard' ? (
          <>
            <Stack.Screen name="GuardTabs" component={GuardTabs} />
            <Stack.Screen
              name="GuardResidents"
              component={GuardResidentsScreen}
              options={{ headerShown: true, title: 'Residents' }}
            />
            <Stack.Screen
              name="ReportBug"
              component={ReportBugScreen}
              options={{ headerShown: true, title: 'Report a bug' }}
            />
            <Stack.Screen name="SupportChat" component={SupportChatScreen} options={{ headerShown: false }} />
          </>
        ) : (
          <>
            <Stack.Screen name="ResidentTabs" component={ResidentTabs} />
            <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ headerShown: true, title: 'Notifications' }} />
            <Stack.Screen name="RaiseComplaint" component={RaiseComplaintScreen} options={{ headerShown: false }} />
            <Stack.Screen name="Announcements" component={AnnouncementsScreen} options={{ headerShown: false }} />
            <Stack.Screen name="Voting" component={VotingScreen} options={{ headerShown: false }} />
            <Stack.Screen name="FacilityBooking" component={FacilityBookingScreen} options={{ headerShown: false }} />
            <Stack.Screen name="Marketplace" component={MarketplaceScreen} options={{ headerShown: false }} />
            <Stack.Screen name="MyAds" component={MyAdsScreen} options={{ headerShown: true, title: 'My ads' }} />
            <Stack.Screen name="Visitors" component={VisitorScreen} options={{ headerShown: false }} />
            <Stack.Screen name="Emergency" component={EmergencyScreen} options={{ headerShown: false }} />
            <Stack.Screen name="FamilyMembers" component={FamilyMembersScreen} options={{ headerShown: true, title: 'Family members' }} />
            <Stack.Screen name="PersonalDetails" component={PersonalDetailsScreen} options={{ headerShown: true, title: 'Personal details' }} />
            <Stack.Screen name="Vehicles" component={VehiclesScreen} options={{ headerShown: true, title: 'Vehicles' }} />
            <Stack.Screen name="VendorServices" component={VendorServicesScreen} options={{ headerShown: true, title: 'Vendor services' }} />
            <Stack.Screen name="PastVotes" component={PastVotesScreen} options={{ headerShown: true, title: 'Past votes' }} />
            <Stack.Screen name="ReportBug" component={ReportBugScreen} options={{ headerShown: true, title: 'Report a bug' }} />
            <Stack.Screen name="SupportChat" component={SupportChatScreen} options={{ headerShown: false }} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
