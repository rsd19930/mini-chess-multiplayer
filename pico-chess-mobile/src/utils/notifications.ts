import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { Platform } from "react-native";

export async function registerForPushNotificationsAsync(): Promise<
  string | undefined
> {
  let token;

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "default",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#FF231F7C",
    });
  }

  if (Device.isDevice) {
    const { status: existingStatus } =
      await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== "granted") {
      console.log("Failed to get push token for push notification!");
      return;
    }

    try {
      const projectId =
        Constants?.expoConfig?.extra?.eas?.projectId ??
        Constants?.easConfig?.projectId;

      if (!projectId) {
        throw new Error("Project ID not found");
      }

      token = (
        await Notifications.getExpoPushTokenAsync({
          projectId,
        })
      ).data;
      console.log("Expo Push Token:", token);
    } catch (e: any) {
      console.error("Error getting push token", e);
    }
  } else {
    console.log("Must use physical device for Push Notifications");
  }

  return token;
}

import AsyncStorage from "@react-native-async-storage/async-storage";

export async function scheduleDailyReminders(
  isLoggedIn: boolean,
  economyConfig: any,
  lastLoginBonusIsoString?: string | null,
) {
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();

    const hasSignedInBeforeString =
      await AsyncStorage.getItem("hasSignedInBefore");
    const hasSignedInBefore = hasSignedInBeforeString === "true";

    if (isLoggedIn && !hasSignedInBefore) {
      await AsyncStorage.setItem("hasSignedInBefore", "true");
    }

    let title = "";
    let body = "";
    let isBrandNewUser = !isLoggedIn && !hasSignedInBefore;

    if (isBrandNewUser) {
      title = `Claim your ${economyConfig?.new_user_bonus || 1000} Coin Bonus! 🎁`;
      body = "Sign up today to get your new user bonus and start playing.";
    } else {
      title = "Your Daily Coins are Ready! 🪙";
      body = `Claim your daily login bonus of ${economyConfig?.daily_login_bonus || 500} coins now.`;
    }

    if (isBrandNewUser) {
      // Scenario A: Brand new user, just repeat daily at 9 PM
      await Notifications.scheduleNotificationAsync({
        content: { title, body },
        trigger: {
          hour: 21,
          minute: 0,
          repeats: true,
        } as any,
      });
    } else {
      // Scenario B: Existing user, 14-day rolling schedule to skip days already claimed
      const now = new Date();
      const lastClaimed = lastLoginBonusIsoString
        ? new Date(lastLoginBonusIsoString)
        : new Date(0);
      const hasClaimedToday = lastClaimed.toDateString() === now.toDateString();

      for (let i = 0; i < 14; i++) {
        const triggerDate = new Date();
        triggerDate.setDate(triggerDate.getDate() + i);
        triggerDate.setHours(21, 0, 0, 0);

        // Skip scheduling if it's already past 9 PM for this specific day
        if (triggerDate.getTime() <= now.getTime()) {
          continue;
        }

        // If it's today and they already claimed, skip it
        if (i === 0 && hasClaimedToday) {
          continue;
        }

        try {
          await Notifications.scheduleNotificationAsync({
            content: { title, body },
            trigger: {
              year: triggerDate.getFullYear(),
              month: triggerDate.getMonth() + 1, // Expo months are 1-12
              day: triggerDate.getDate(),
              hour: 21,
              minute: 0,
              repeats: false,
            } as any,
          });
        } catch (e) {
          console.warn("Failed to schedule day", i, e);
        }
      }
    }
  } catch (e: any) {
    console.error("Error scheduling daily reminders:", e);
  }
}
