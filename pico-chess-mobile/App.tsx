import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as Linking from 'expo-linking';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert } from 'react-native';
import { HomeScreen } from './src/screens/HomeScreen';
import { GameScreen } from './src/screens/GameScreen';
import { RootStackParamList } from './src/types/navigation';
import * as Notifications from 'expo-notifications';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

const Stack = createNativeStackNavigator<RootStackParamList>();

const prefix = Linking.createURL('/');

export default function App() {
  const linking = {
    prefixes: [prefix, 'picochess://'],
    config: {
      screens: {
        Home: '*', // Force all unrecognized (or all) deep links to land on Home
      },
    },
    async getInitialURL() {
      // Handle app opened from a cold start via a deep link
      const url = await Linking.getInitialURL();
      if (url) {
        return handleDeepLink(url);
      }
      return null;
    },
    subscribe(listener: (url: string) => void) {
      // Handle app opened from the background via a deep link
      const onReceiveURL = ({ url }: { url: string }) => {
        const parsedUrl = handleDeepLink(url);
        if (parsedUrl) listener(parsedUrl);
      };

      const subscription = Linking.addEventListener('url', onReceiveURL);
      return () => {
        subscription.remove();
      };
    },
  };

  const handleDeepLink = (url: string) => {
    try {
      // Save the raw URL immediately so we can view it on the Home Screen
      AsyncStorage.setItem('debug_raw_url', url).catch(() => { });

      if (url && url.includes('room/')) {
        // Raw string extraction to bypass any Expo parser quirks
        const pathAfterRoom = url.split('room/')[1];
        const matchId = pathAfterRoom?.split('?')[0]?.split('/')[0];
        const referrerId = url.includes('ref=') ? url.split('ref=')[1]?.split('&')[0] : null;

        if (matchId) {
          // Cache the parsed data for HomeScreen to process
          AsyncStorage.setItem('pending_referral', JSON.stringify({
            matchId,
            referrerId,
            timestamp: Date.now()
          })).catch(console.error);

          // Return null to halt React Navigation auto-routing
          return null;
        }
      }
      return url;
    } catch (e) {
      // Silently fall back to standard URL handling
      return url;
    }
  };

  return (
    <NavigationContainer linking={linking}>
      <Stack.Navigator
        initialRouteName="Home"
        screenOptions={{
          headerShown: false, // We'll manage our own headers for a cleaner game feel
        }}
      >
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="Game" component={GameScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
