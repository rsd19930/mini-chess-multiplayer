import React, { useEffect, useState, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Share,
  AppState,
  Image,
  ImageBackground,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "../services/supabase";
import { MatchmakingService } from "../services/MatchmakingService";
import { GameEngine } from "../core/GameEngine";
import * as WebBrowser from "expo-web-browser";
import { makeRedirectUri } from "expo-auth-session";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { RootStackParamList } from "../types/navigation";
import { defaultTheme } from "../config/themeConfig";
import { gameConfig } from "../config/gameConfig";
import Purchases from "react-native-purchases";
import {
  registerForPushNotificationsAsync,
  scheduleDailyReminders,
} from "../utils/notifications";
import { AudioService } from "../services/AudioService";

type HomeScreenNavigationProp = NativeStackNavigationProp<
  RootStackParamList,
  "Home"
>;

interface HomeScreenProps {
  navigation: HomeScreenNavigationProp;
}

const extractTokens = (url: string) => {
  const queryParams: Record<string, string> = {};
  const [, queryString] = url.split("#");
  if (queryString) {
    queryString.split("&").forEach((pair) => {
      const [key, value] = pair.split("=");
      queryParams[key] = decodeURIComponent(value || "");
    });
  }
  return queryParams;
};

WebBrowser.maybeCompleteAuthSession();

export const HomeScreen: React.FC<HomeScreenProps> = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  const [session, setSession] = useState<any>(null);
  const [isSearchingOnline, setIsSearchingOnline] = useState(false);
  const [isCreatingPrivateMatch, setIsCreatingPrivateMatch] = useState(false);
  const [coinBalance, setCoinBalance] = useState<number>(0);
  const [referralBonus, setReferralBonus] = useState<number>(0);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const hasShownWelcome = useRef(false);

  const [customAlert, setCustomAlert] = useState<{
    title: string;
    message: string;
    buttonText?: string;
  } | null>(null);
  const [imageFailed, setImageFailed] = useState(false);

  const [showTutorialModal, setShowTutorialModal] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

  const [isFeedbackModalVisible, setFeedbackModalVisible] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);

  const [storePackage, setStorePackage] = useState<any>(null);
  const [localPushToken, setLocalPushToken] = useState<string | null>(null);

  useEffect(() => {
    const syncPushToken = async () => {
      if (session?.user?.id) {
        try {
          const token = await registerForPushNotificationsAsync();
          if (token && token !== localPushToken) {
            await supabase
              .from("players")
              .update({ expo_push_token: token })
              .eq("id", session.user.id);
            setLocalPushToken(token);
          }
        } catch (error) {
          console.error("Failed to sync push token:", error);
        }
      }
    };
    syncPushToken();
  }, [session?.user?.id]);

  useEffect(() => {
    AudioService.preloadSounds();
    // Initialize RevenueCat
    Purchases.configure({ apiKey: "goog_aCiBXqFLHSwsRjBCNpoCgARkxNr" });
    const loadOfferings = async () => {
      try {
        const offerings = await Purchases.getOfferings();
        if (
          offerings.current !== null &&
          offerings.current.availablePackages.length !== 0
        ) {
          // Grab the first available package (the 1000 coins product)
          setStorePackage(offerings.current.availablePackages[0]);
        }
      } catch (e) {
        console.error("Error fetching offerings", e);
      }
    };
    loadOfferings();
  }, []);

  useEffect(() => {
    let mounted = true;

    const processReferral = async (currentUserId: string) => {
      try {
        const storedReferral = await AsyncStorage.getItem("pending_referral");

        if (!storedReferral) return;

        const { matchId, referrerId } = JSON.parse(storedReferral);

        // Prevent self-referral
        if (currentUserId === referrerId) {
          await AsyncStorage.removeItem("pending_referral");
          await AsyncStorage.removeItem("debug_raw_url");
          navigation.navigate("Game", {
            mode: "online",
            matchId,
            localColor: "white",
          });
          return;
        }

        // Check genuine new user status
        const { data: currentUserData, error: userError } = await supabase
          .from("players")
          .select("referred_by, created_at")
          .eq("id", currentUserId)
          .single();

        if (userError) throw userError;

        const ageInMs =
          new Date().getTime() - new Date(currentUserData.created_at).getTime();
        const isUnder24Hours = ageInMs < 24 * 60 * 60 * 1000;

        if (
          referrerId &&
          currentUserData.referred_by === null &&
          isUnder24Hours
        ) {
          const { data: configData, error: configError } = await supabase
            .from("economy_config")
            .select("referral_bonus")
            .eq("id", 1)
            .single();

          if (configError) console.error("Config fetch error:", configError);
          const bonusAmount = configData?.referral_bonus || 1000;

          await supabase.rpc("reward_referrer", {
            p_referrer_id: referrerId,
            p_referred_id: currentUserId,
            p_bonus_amount: bonusAmount,
          });

          await supabase
            .from("players")
            .update({ referred_by: referrerId })
            .eq("id", currentUserId);

          if (mounted) {
            setCustomAlert({
              title: "Referral Check",
              message: `You joined your friend's game! They earned a ${bonusAmount} coin bonus.`,
            });
          }
        }

        const { data: matchData, error: matchFetchError } = await supabase
          .from("matches")
          .select("status, created_at")
          .eq("id", matchId)
          .single();

        if (matchFetchError || !matchData) {
          await AsyncStorage.multiRemove(["pending_referral", "debug_raw_url"]);
          if (mounted)
            setCustomAlert({
              title: "Room Not Found",
              message: "This match no longer exists.",
            });
          return;
        }

        const matchAgeHours =
          (new Date().getTime() - new Date(matchData.created_at).getTime()) /
          (1000 * 60 * 60);

        if (matchData.status !== "waiting" || matchAgeHours > 1) {
          await AsyncStorage.multiRemove(["pending_referral", "debug_raw_url"]);
          Alert.alert(
            "Match Expired",
            "This invite link has expired or the host cancelled the match.",
          );
          return;
        }

        const { error: matchJoinError } = await supabase
          .from("matches")
          .update({
            player_black: currentUserId,
            status: "active",
            started_at: new Date().toISOString(),
          })
          .eq("id", matchId)
          .eq("status", "waiting");

        if (matchJoinError)
          console.error("Failed to join match:", matchJoinError);

        await AsyncStorage.removeItem("pending_referral");
        await AsyncStorage.removeItem("debug_raw_url");

        navigation.navigate("Game", {
          mode: "online",
          matchId: matchId,
          localColor: "black",
        });
      } catch (error) {
        console.error("Error processing referral link:", error);
      }
    };

    const syncUserData = async (activeSession: any) => {
      const userId = activeSession?.user?.id;

      if (!userId) {
        // Guest mode fallbacks
        if (mounted) {
          try {
            const { data: configData } = await supabase
              .from("economy_config")
              .select("*")
              .eq("id", 1)
              .single();
            await scheduleDailyReminders(false, configData);
          } catch (e) {}
        }
        return;
      }

      // EXPLICIT BLOCKING COIN FETCH: The exact moment a valid ID is detected
      try {
        const { data: playerData, error } = await supabase
          .from("players")
          .select("coins, last_login_bonus")
          .eq("id", userId)
          .single();
        if (playerData && !error && mounted) {
          setCoinBalance(playerData.coins);

          const { data: configData } = await supabase
            .from("economy_config")
            .select("*")
            .eq("id", 1)
            .single();
          await scheduleDailyReminders(
            true,
            configData,
            playerData.last_login_bonus,
          );
        }
      } catch (err) {
        console.error("Coin sync error:", err);
      }

      // Set Avatar
      if (activeSession.user.user_metadata?.avatar_url && mounted) {
        setAvatarUrl(activeSession.user.user_metadata.avatar_url);
      }

      // Sync Daily Bonus explicitly waiting for RPC
      try {
        const userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const { data } = await supabase.rpc("claim_daily_bonus", {
          client_tz: userTimeZone,
        });
        if (data?.success && mounted) {
          setCoinBalance(data.coins); // Overwrite if bonus claimed
          setCustomAlert({
            title: "Daily Bonus!",
            message: `You received ${data.amount_claimed} free coins!`,
          });
        }
      } catch (err) {
        console.error("Daily bonus check failed during auth:", err);
      }

      await processReferral(userId);
    };

    // 1. Initial Session Check
    supabase.auth.getSession().then(({ data: { session: initialSession } }) => {
      if (mounted) setSession(initialSession);
      syncUserData(initialSession);
    });

    // 2. Auth State Listener
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      if (mounted) setSession(newSession);

      if (newSession?.user?.created_at && !hasShownWelcome.current) {
        const accountAgeMs =
          new Date().getTime() - new Date(newSession.user.created_at).getTime();
        if (accountAgeMs < 120000) {
          hasShownWelcome.current = true;
          if (mounted)
            setCustomAlert({
              title: "Welcome to Pico Chess!",
              message:
                "We have credited your account with 1,000 starter coins. Good luck on the board!",
            });
        }
      }

      syncUserData(newSession);
    });

    // 3. App State Foreground Deep Link Handler
    const appStateSubscription = AppState.addEventListener(
      "change",
      (nextAppState) => {
        if (nextAppState === "active") {
          supabase.auth
            .getSession()
            .then(({ data: { session: activeSession } }) => {
              if (activeSession?.user?.id) {
                setTimeout(() => {
                  if (mounted) processReferral(activeSession.user.id);
                }, 500);
              }
            });
        }
      },
    );

    // Background global variables loaded once
    const fetchReferralBonus = async () => {
      const { data, error } = await supabase
        .from("economy_config")
        .select("referral_bonus")
        .eq("id", 1)
        .single();

      if (!error && data && mounted) setReferralBonus(data.referral_bonus);
    };
    fetchReferralBonus();

    return () => {
      mounted = false;
      subscription.unsubscribe();
      appStateSubscription.remove();
    };
  }, []);

  // Stubs for future user state
  const userName = session
    ? session.user.user_metadata?.full_name ||
      session.user.email?.split("@")[0] ||
      "Player"
    : "Guest Player";
  const displayCoinBalance = session ? `🪙 ${coinBalance}` : "🪙 1000";

  const checkTutorial = async (action: () => void) => {
    try {
      const hasSeen = await AsyncStorage.getItem("@has_seen_tutorial");
      if (hasSeen === "true") {
        action();
      } else {
        setPendingAction(() => action);
        setShowTutorialModal(true);
      }
    } catch (e) {
      action();
    }
  };

  const confirmTutorial = async () => {
    await AsyncStorage.setItem("@has_seen_tutorial", "true");
    setShowTutorialModal(false);
    if (pendingAction) {
      pendingAction();
      setPendingAction(null);
    }
  };

  const handlePlayLocal = () => {
    navigation.navigate("Game", { mode: "local" });
  };

  const executePlayOnline = async () => {
    if (!session) {
      setCustomAlert({
        title: "Sign In Required",
        message: "You must be signed in to play online!",
      });
      return;
    }

    if (coinBalance < gameConfig.economyParams.matchFee) {
      setCustomAlert({
        title: "Not enough coins!",
        message: `You need ${gameConfig.economyParams.matchFee} coins to play online.`,
        buttonText: "Okay",
      });
      return;
    }

    try {
      setIsSearchingOnline(true);
      const result = await MatchmakingService.findOrCreateMatch(
        session.user.id,
      );

      await supabase.rpc("pay_entry_fee", { p_match_id: result.matchId });

      setIsSearchingOnline(false);

      navigation.navigate("Game", {
        mode: "online",
        matchId: result.matchId,
        localColor: result.color,
      });
    } catch (error: any) {
      setIsSearchingOnline(false);
      setCustomAlert({
        title: "Matchmaking Error",
        message: error.message || "Failed to find a match.",
      });
    }
  };

  const executePlayFriend = async () => {
    if (!session) {
      setCustomAlert({
        title: "Sign In Required",
        message: "You must be signed in to play a friend!",
      });
      return;
    }

    try {
      setIsCreatingPrivateMatch(true);
      const engine = new GameEngine();
      const initialState = engine.getState();

      const { data: matchData, error: matchError } = await supabase
        .from("matches")
        .insert({
          player_white: session.user.id,
          status: "waiting",
          is_private: true,
          game_state: initialState,
        })
        .select()
        .single();

      if (matchError) throw matchError;

      // Share the deep link via the GitHub Pages redirect
      const deepLink = `https://rsd19930.github.io/pico-invite/?room=${matchData.id}&ref=${session.user.id}`;
      await Share.share({
        message: `I challenge you to a game of Pico Chess! ♟️\n1. Download the game from the Play Store.\n2. Tap here to join my lobby: ${deepLink} \n(New players get a bonus!)`,
      });

      setIsCreatingPrivateMatch(false);

      navigation.navigate("Game", {
        mode: "online",
        matchId: matchData.id,
        localColor: "white",
      });
    } catch (error: any) {
      setIsCreatingPrivateMatch(false);
      setCustomAlert({
        title: "Error",
        message: error.message || "Failed to create private match.",
      });
    }
  };

  const handlePlayOnline = () => checkTutorial(executePlayOnline);
  const handlePlayFriend = () => checkTutorial(executePlayFriend);

  const handleBuyCoins = async () => {
    if (!session) {
      setCustomAlert({
        title: "Sign In Required",
        message: "You must be signed in to purchase coins!",
      });
      return;
    }

    try {
      const { customerInfo, productIdentifier } =
        await Purchases.purchasePackage(storePackage);

      // Securely parse the amount from the product identifier (e.g., 'pico_coins_1000')
      const coinsToAdd = parseInt(
        productIdentifier.split("_").pop() || "1000",
        10,
      );

      // Robustly extract the correct transaction identifier (handles both test and live environments)
      let transactionId = "test_txn_fallback";
      if (customerInfo.nonSubscriptionTransactions.length > 0) {
        // Grab the most recent transaction
        const latestTx =
          customerInfo.nonSubscriptionTransactions[
            customerInfo.nonSubscriptionTransactions.length - 1
          ];
        transactionId = latestTx.transactionIdentifier;
      }

      // Call the Supabase vault function
      const { error: rpcError } = await supabase.rpc("process_iap_purchase", {
        p_player_id: session.user.id,
        p_amount: coinsToAdd,
        p_transaction_id: transactionId,
      });

      if (rpcError) throw new Error(rpcError.message);

      // Only update local UI if the database succeeded
      setCoinBalance((prev) => prev + coinsToAdd);
      setCustomAlert({
        title: "Success!",
        message: `Thank you for your purchase! ${coinsToAdd} coins have been securely added to your vault.`,
      });
    } catch (error: any) {
      if (!error.userCancelled) {
        setCustomAlert({
          title: "Purchase Failed",
          message:
            "We could not securely verify the transaction with the database.",
        });
        console.error(error);
      }
    }
  };

  const handleGoogleSignIn = async () => {
    const redirectUrl = makeRedirectUri({
      scheme: "picochess",
    });
    console.log("👉 EXPO REDIRECT URL:", redirectUrl);
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: redirectUrl,
        queryParams: {
          prompt: "consent",
        },
      },
    });

    if (error) {
      setCustomAlert({ title: "Sign In Error", message: error.message });
    } else if (data?.url) {
      const result = await WebBrowser.openAuthSessionAsync(
        data.url,
        redirectUrl,
      );

      if (result?.type === "success" && result.url) {
        const { access_token, refresh_token } = extractTokens(result.url);
        if (access_token && refresh_token) {
          await supabase.auth.setSession({ access_token, refresh_token });
        }
      }
    }
  };

  const handleFeedbackSubmit = async () => {
    if (!feedbackText.trim()) {
      setCustomAlert({
        title: "Empty",
        message: "Please enter some feedback before submitting.",
      });
      return;
    }

    if (!session?.user?.id) {
      setCustomAlert({
        title: "Error",
        message: "You must be logged in to submit feedback.",
      });
      return;
    }

    setIsSubmittingFeedback(true);
    const { error } = await supabase
      .from("feedbacks")
      .insert({ user_id: session.user.id, feedback_text: feedbackText.trim() });
    setIsSubmittingFeedback(false);

    if (error) {
      setCustomAlert({
        title: "Error",
        message: "Failed to submit feedback. Please try again.",
      });
    } else {
      setFeedbackModalVisible(false);
      setFeedbackText("");
      setCustomAlert({
        title: "Thank You!",
        message: "Your feedback has been submitted successfully.",
      });
    }
  };

  return (
    <View style={styles.container}>
      {/* Custom High-Fidelity Background */}
      <ImageBackground
        source={require("../../assets/home-bg.jpg")}
        style={styles.background}
        resizeMode="cover"
      >
        {/* Header Section (Player Profile / Coins) */}
        <View style={[styles.header, { paddingTop: Math.max(insets.top, 20) }]}>
          <View style={styles.profileRow}>
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={styles.avatarStub} />
            ) : (
              <View style={styles.avatarStub}></View>
            )}
            <View style={styles.userInfo}>
              <Text style={styles.userNameText}>{userName}</Text>
              <Text style={styles.coinText}>{displayCoinBalance}</Text>
            </View>
          </View>

          {session && (
            <TouchableOpacity
              style={styles.feedbackIcon}
              onPress={() => setFeedbackModalVisible(true)}
            >
              <Text style={styles.feedbackIconText}>💬</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Main Content (Title and Menu Buttons) */}
        <View style={styles.centerContent}>
          {__DEV__ && (
            <TouchableOpacity
              style={[styles.menuButton, styles.buttonLocal]}
              onPress={handlePlayLocal}
              disabled={isSearchingOnline || isCreatingPrivateMatch}
            >
              <Text style={styles.menuButtonText}>Play Local (Test)</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[
              styles.menuButton,
              styles.buttonOnline,
              isSearchingOnline && { opacity: 0.7 },
            ]}
            onPress={handlePlayOnline}
            disabled={isSearchingOnline || isCreatingPrivateMatch}
          >
            <Text style={styles.menuButtonText}>
              {isSearchingOnline
                ? "Searching..."
                : `Play Online (${gameConfig.economyParams.matchFee} 🪙)`}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.menuButton,
              styles.buttonFriend,
              isCreatingPrivateMatch && { opacity: 0.7 },
            ]}
            onPress={handlePlayFriend}
            disabled={isSearchingOnline || isCreatingPrivateMatch}
          >
            <Text style={styles.menuButtonText}>
              {isCreatingPrivateMatch ? "Creating..." : "Play a Friend"}
            </Text>
            <Text style={styles.friendSubtext}>
              Invite & earn {referralBonus} coins!
            </Text>
          </TouchableOpacity>

          {storePackage && (
            <TouchableOpacity
              style={[styles.menuButton, styles.buttonCoinShop]}
              onPress={handleBuyCoins}
            >
              <View style={styles.coinShopLeft}>
                <Text style={styles.coinShopIconPlaceholder}>🪙</Text>
                <Text style={styles.coinShopTitle}>
                  {storePackage.product.title
                    ? storePackage.product.title.replace(/\(.*\)/, "").trim()
                    : "1000 Coins"}
                </Text>
              </View>
              <Text style={styles.coinShopPrice}>
                {storePackage.product.priceString}
              </Text>
            </TouchableOpacity>
          )}

          {!session && (
            <TouchableOpacity
              style={[styles.menuButton, styles.buttonAuth]}
              onPress={handleGoogleSignIn}
              disabled={isSearchingOnline || isCreatingPrivateMatch}
            >
              <Text style={styles.menuButtonText}>Sign In with Google</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Feedback Modal */}
        <Modal
          visible={isFeedbackModalVisible}
          transparent={true}
          animationType="slide"
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            style={styles.modalOverlay}
          >
            <View style={styles.feedbackModalContent}>
              <View style={styles.feedbackHeaderRow}>
                <Text style={styles.feedbackModalTitle}>Send Feedback</Text>
                <TouchableOpacity
                  onPress={() => setFeedbackModalVisible(false)}
                >
                  <Text style={styles.closeIcon}>✕</Text>
                </TouchableOpacity>
              </View>

              <TextInput
                style={styles.feedbackInput}
                placeholder="What's on your mind?"
                placeholderTextColor="#999"
                multiline={true}
                maxLength={500}
                value={feedbackText}
                onChangeText={setFeedbackText}
              />

              <TouchableOpacity
                style={[
                  styles.submitFeedbackBtn,
                  isSubmittingFeedback && { opacity: 0.7 },
                ]}
                onPress={handleFeedbackSubmit}
                disabled={isSubmittingFeedback}
              >
                <Text style={styles.submitFeedbackText}>
                  {isSubmittingFeedback ? "Submitting..." : "Submit Feedback"}
                </Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        {/* Custom Alert Modal */}
        <Modal visible={!!customAlert} transparent={true} animationType="fade">
          <View style={styles.modalOverlayCenter}>
            <View style={styles.customAlertContent}>
              <Text style={styles.customAlertTitle}>{customAlert?.title}</Text>
              <Text style={styles.customAlertMessage}>
                {customAlert?.message}
              </Text>
              <TouchableOpacity
                style={styles.customAlertBtn}
                onPress={() => setCustomAlert(null)}
              >
                <Text style={styles.customAlertBtnText}>
                  {customAlert?.buttonText || "Great!"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* Tutorial Modal */}
        <Modal
          visible={showTutorialModal}
          transparent={true}
          animationType="fade"
        >
          <View style={styles.modalOverlayCenter}>
            <View style={styles.tutorialModalContent}>
              {!imageFailed ? (
                <Image
                  source={require("../../assets/tutorial-vertical.png")}
                  style={{
                    width: "100%",
                    height: 550,
                    resizeMode: "contain",
                    marginVertical: 10,
                  }}
                  onError={() => setImageFailed(true)}
                />
              ) : (
                <>
                  <Text style={styles.tutorialTitle}>
                    How to Play Pico Chess
                  </Text>

                  <View style={styles.tutorialItem}>
                    <Text style={styles.tutorialBullet}>1.</Text>
                    <Text style={styles.tutorialText}>
                      6x6 board with 5 pieces.
                    </Text>
                  </View>

                  <View style={styles.tutorialItem}>
                    <Text style={styles.tutorialBullet}>2.</Text>
                    <Text style={styles.tutorialText}>
                      Place your opponent's captured pieces back on the board.
                    </Text>
                  </View>

                  <View style={styles.tutorialItem}>
                    <Text style={styles.tutorialBullet}>3.</Text>
                    <Text style={styles.tutorialText}>
                      You get 30 seconds per turn. Checkmate to win!
                    </Text>
                  </View>
                </>
              )}
              <TouchableOpacity
                style={styles.tutorialBtn}
                onPress={confirmTutorial}
              >
                <Text style={styles.tutorialBtnText}>Got it!</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </ImageBackground>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#1E3126", // A dark green fallback color
  },
  background: {
    flex: 1,
    backgroundColor: "#1E3126", // Solid dark green until art is provided
  },
  header: {
    padding: 20,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  profileRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.4)",
    padding: 10,
    borderRadius: 25,
  },
  avatarStub: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#aaa",
    marginRight: 10,
  },
  userInfo: {
    flexDirection: "column",
  },
  userNameText: {
    color: "white",
    fontFamily: "PublicSans_700Bold",
    fontSize: 14,
  },
  coinText: {
    color: "#FFD700",
    fontFamily: "PublicSans_700Bold",
    fontSize: 16,
  },
  centerContent: {
    flex: 1,
    justifyContent: "flex-end",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingBottom: 60,
  },
  gameTitle: {
    fontSize: 48,
    fontFamily: "PublicSans_900Black",
    color: "white",
    letterSpacing: 2,
    marginBottom: 60,
    textShadowColor: "rgba(0,0,0,0.5)",
    textShadowOffset: { width: 0, height: 4 },
    textShadowRadius: 6,
  },
  menuButton: {
    width: "80%",
    maxWidth: 300,
    paddingVertical: 16,
    borderRadius: 30,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 15,
    elevation: 5,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
  },
  buttonLocal: {
    backgroundColor: "#27ae60", // Prominent Green
  },
  buttonOnline: {
    backgroundColor: "#2A343A", // Darker gray for premium matching
    borderWidth: 2,
    borderColor: "#FFD700", // Gold border for premium vibe
  },
  buttonFriend: {
    backgroundColor: "#2980b9", // Blue color for social feature
  },
  friendSubtext: {
    color: "#FFD700",
    fontSize: 12,
    fontWeight: "bold",
    marginTop: 4,
  },
  buttonAuth: {
    backgroundColor: "transparent",
    borderWidth: 2,
    borderColor: "rgba(255, 255, 255, 0.5)",
  },
  menuButtonText: {
    color: "white",
    fontSize: 18,
    fontFamily: "PublicSans_700Bold",
  },
  feedbackIcon: {
    backgroundColor: "rgba(0, 0, 0, 0.4)",
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  feedbackIconText: {
    fontSize: 18,
  },
  buttonCoinShop: {
    backgroundColor: "transparent",
    borderWidth: 2,
    borderColor: "#4d4d4d",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 20,
  },
  coinShopLeft: {
    flexDirection: "row",
    alignItems: "center",
  },
  coinShopIconPlaceholder: {
    fontSize: 20,
    marginRight: 8,
  },
  coinShopTitle: {
    color: "white",
    fontSize: 16,
    fontFamily: "PublicSans_700Bold",
  },
  coinShopPrice: {
    color: "white",
    fontSize: 18,
    fontFamily: "PublicSans_700Bold",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    justifyContent: "flex-end",
  },
  feedbackModalContent: {
    backgroundColor: "#2A343A",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingBottom: 40,
    elevation: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -5 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
  },
  feedbackHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  feedbackModalTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "white",
  },
  closeIcon: {
    color: "#ccc",
    fontSize: 24,
    fontWeight: "bold",
    paddingHorizontal: 10,
  },
  feedbackInput: {
    backgroundColor: "rgba(0, 0, 0, 0.3)",
    color: "white",
    fontFamily: "PublicSans_400Regular",
    borderRadius: 12,
    padding: 16,
    minHeight: 120,
    textAlignVertical: "top",
    fontSize: 16,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.1)",
    marginBottom: 20,
  },
  submitFeedbackBtn: {
    backgroundColor: "#27ae60",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  submitFeedbackText: {
    color: "white",
    fontSize: 16,
    fontWeight: "bold",
  },
  modalOverlayCenter: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    justifyContent: "center",
    alignItems: "center",
  },
  tutorialModalContent: {
    backgroundColor: "#2A343A",
    padding: 30,
    borderRadius: 16,
    width: "90%",
    maxWidth: 400,
    elevation: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
  },
  tutorialTitle: {
    fontSize: 22,
    fontFamily: "PublicSans_700Bold",
    color: "#FFD700",
    marginBottom: 20,
    textAlign: "center",
  },
  tutorialItem: {
    flexDirection: "row",
    marginBottom: 16,
    paddingRight: 10,
  },
  tutorialBullet: {
    color: "#4ade80",
    fontSize: 18,
    fontFamily: "PublicSans_700Bold",
    marginRight: 12,
    width: 20,
  },
  tutorialText: {
    color: "white",
    fontSize: 16,
    fontFamily: "PublicSans_400Regular",
    lineHeight: 22,
    flex: 1,
  },
  tutorialBtn: {
    backgroundColor: "#27ae60",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 10,
  },
  tutorialBtnText: {
    color: "white",
    fontSize: 18,
    fontFamily: "PublicSans_700Bold",
  },
  customAlertContent: {
    backgroundColor: "#1E3126",
    padding: 30,
    borderRadius: 16,
    width: "85%",
    maxWidth: 340,
    elevation: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    alignItems: "center",
  },
  customAlertTitle: {
    fontSize: 22,
    fontFamily: "PublicSans_700Bold",
    color: "#FFD700",
    marginBottom: 12,
    textAlign: "center",
  },
  customAlertMessage: {
    fontSize: 16,
    fontFamily: "PublicSans_400Regular",
    color: "white",
    textAlign: "center",
    marginBottom: 24,
    lineHeight: 22,
  },
  customAlertBtn: {
    backgroundColor: "#27ae60",
    paddingVertical: 12,
    paddingHorizontal: 30,
    borderRadius: 25,
  },
  customAlertBtnText: {
    color: "white",
    fontSize: 16,
    fontFamily: "PublicSans_700Bold",
  },
});
