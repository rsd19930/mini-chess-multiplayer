import AsyncStorage from "@react-native-async-storage/async-storage";
import * as StoreReview from "expo-store-review";
import { Platform } from "react-native";

const STREAK_KEY = "consecutive_wins";
const LAST_PROMPT_KEY = "last_review_prompt_date";
const STREAK_THRESHOLD = 3;
const COOLDOWN_MS = 90 * 24 * 60 * 60 * 1000;

async function readInt(key: string): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return 0;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

async function isCooldownElapsed(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(LAST_PROMPT_KEY);
    if (!raw) return true;
    const last = parseInt(raw, 10);
    if (!Number.isFinite(last)) return true;
    return Date.now() - last >= COOLDOWN_MS;
  } catch {
    return true;
  }
}

export async function recordWin(): Promise<{ shouldTrigger: boolean }> {
  try {
    const current = await readInt(STREAK_KEY);
    const next = current + 1;
    await AsyncStorage.setItem(STREAK_KEY, String(next));
    if (next < STREAK_THRESHOLD) return { shouldTrigger: false };
    const cooldownOk = await isCooldownElapsed();
    return { shouldTrigger: cooldownOk };
  } catch (e) {
    console.warn("recordWin failed:", e);
    return { shouldTrigger: false };
  }
}

export async function recordLossOrDraw(): Promise<void> {
  try {
    await AsyncStorage.setItem(STREAK_KEY, "0");
  } catch (e) {
    console.warn("recordLossOrDraw failed:", e);
  }
}

export async function markPromptShown(): Promise<void> {
  try {
    await AsyncStorage.setItem(LAST_PROMPT_KEY, String(Date.now()));
    await AsyncStorage.setItem(STREAK_KEY, "0");
  } catch (e) {
    console.warn("markPromptShown failed:", e);
  }
}

export async function requestReviewIfDue(): Promise<void> {
  await markPromptShown();
  try {
    if (Platform.OS !== "android" && Platform.OS !== "ios") return;
    const available = await StoreReview.isAvailableAsync();
    if (!available) return;
    await StoreReview.requestReview();
  } catch (e) {
    console.warn("requestReviewIfDue failed:", e);
  }
}
