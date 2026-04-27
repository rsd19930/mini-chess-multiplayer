jest.mock("react-native", () => ({ Platform: { OS: "android" } }));
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);
jest.mock("expo-store-review", () => ({
  isAvailableAsync: jest.fn().mockResolvedValue(false),
  requestReview: jest.fn().mockResolvedValue(undefined),
}));

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  recordWin,
  recordLossOrDraw,
  markPromptShown,
} from "../reviewPrompt";

const STREAK_KEY = "consecutive_wins";
const LAST_PROMPT_KEY = "last_review_prompt_date";
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe("reviewPrompt", () => {
  describe("recordWin streak math", () => {
    it("only the 3rd win returns shouldTrigger:true on a fresh state", async () => {
      const r1 = await recordWin();
      expect(r1.shouldTrigger).toBe(false);
      const r2 = await recordWin();
      expect(r2.shouldTrigger).toBe(false);
      const r3 = await recordWin();
      expect(r3.shouldTrigger).toBe(true);
      expect(await AsyncStorage.getItem(STREAK_KEY)).toBe("3");
    });

    it("4th consecutive win still triggers if cooldown allows (no markPromptShown was called)", async () => {
      await recordWin();
      await recordWin();
      await recordWin();
      const r4 = await recordWin();
      expect(r4.shouldTrigger).toBe(true);
    });
  });

  describe("recordLossOrDraw", () => {
    it("resets streak to 0", async () => {
      await recordWin();
      await recordWin();
      await recordLossOrDraw();
      expect(await AsyncStorage.getItem(STREAK_KEY)).toBe("0");
      const next = await recordWin();
      expect(next.shouldTrigger).toBe(false);
    });
  });

  describe("cooldown gate", () => {
    it("89 days ago — 3rd win does NOT trigger", async () => {
      const eightyNineDaysAgo = Date.now() - (NINETY_DAYS_MS - 24 * 60 * 60 * 1000);
      await AsyncStorage.setItem(LAST_PROMPT_KEY, String(eightyNineDaysAgo));
      await recordWin();
      await recordWin();
      const r3 = await recordWin();
      expect(r3.shouldTrigger).toBe(false);
    });

    it("exactly 90 days ago — 3rd win triggers", async () => {
      const ninetyDaysAgo = Date.now() - NINETY_DAYS_MS;
      await AsyncStorage.setItem(LAST_PROMPT_KEY, String(ninetyDaysAgo));
      await recordWin();
      await recordWin();
      const r3 = await recordWin();
      expect(r3.shouldTrigger).toBe(true);
    });
  });

  describe("malformed values", () => {
    it("garbage streak value falls back to 0", async () => {
      await AsyncStorage.setItem(STREAK_KEY, "not-a-number");
      const r1 = await recordWin();
      expect(r1.shouldTrigger).toBe(false);
      expect(await AsyncStorage.getItem(STREAK_KEY)).toBe("1");
    });

    it("garbage last-prompt value treats cooldown as elapsed", async () => {
      await AsyncStorage.setItem(LAST_PROMPT_KEY, "garbage");
      await recordWin();
      await recordWin();
      const r3 = await recordWin();
      expect(r3.shouldTrigger).toBe(true);
    });
  });

  describe("markPromptShown", () => {
    it("stamps date AND resets streak", async () => {
      await recordWin();
      await recordWin();
      await recordWin();
      await markPromptShown();
      expect(await AsyncStorage.getItem(STREAK_KEY)).toBe("0");
      const stamp = await AsyncStorage.getItem(LAST_PROMPT_KEY);
      expect(stamp).not.toBeNull();
      const ts = parseInt(stamp!, 10);
      expect(Math.abs(Date.now() - ts)).toBeLessThan(5000);
    });
  });
});
