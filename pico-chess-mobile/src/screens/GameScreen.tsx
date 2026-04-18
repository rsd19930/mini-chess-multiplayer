import React, { useState } from "react";
import {
    View,
    StyleSheet,
    Text,
    Button,
    Modal,
    TouchableOpacity,
    Alert,
    AppState,
    ImageBackground,
    Vibration,
} from "react-native";
import { useKeepAwake } from "expo-keep-awake";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { ChessBoard } from "../components/board/ChessBoard";
import { defaultTheme } from "../config/themeConfig";
import { GameEngine } from "../core/GameEngine";
import { GameState } from "../types";
import { AudioService } from "../services/AudioService";
import { calculateBotAction } from "../core/BotEngine";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RootStackParamList } from "../types/navigation";
import { supabase } from "../services/supabase";
import { gameConfig } from "../config/gameConfig";
import { MatchmakingService } from "../services/MatchmakingService";

type GameScreenProps = NativeStackScreenProps<RootStackParamList, "Game">;

export const GameScreen: React.FC<GameScreenProps> = ({
    route,
    navigation,
}) => {
    useKeepAwake(); // Prevent screen dimming during gameplay!

    const insets = useSafeAreaInsets();

    // Retrieve the passed gamemode (local vs online)
    const { mode, matchId, localColor, botDepth } = route.params;

    // In a real Match flow, we'd pass the local socket/realtime connection
    // and the mapped color down. For testing our UI, we'll assume we are White locally.
    const [engine] = useState(() => new GameEngine());
    const [gameState, setGameState] = useState<GameState>(engine.getState());
    const [matchStatus, setMatchStatus] = useState("active");
    const [isPrivateMatch, setIsPrivateMatch] = useState(false);
    const [opponentId, setOpponentId] = useState<string | null>(null);
    const [isRematching, setIsRematching] = useState(false);
    const [timeLeft, setTimeLeft] = useState(gameConfig.timers.turnTimeMs / 1000);
    const [matchStartedAt, setMatchStartedAt] = useState<string | null>(null);
    const [localMatchStartTime, setLocalMatchStartTime] = useState<number | null>(
        null,
    );
    const [customAlert, setCustomAlert] = useState<{
        title: string;
        message: string;
        buttonText?: string;
    } | null>(null);

    // New Async Reward States
    const [eloResult, setEloResult] = useState<
        { change: number; newElo: number } | "loading" | null
    >(null);
    const [coinsEarned, setCoinsEarned] = useState<number | null>(null);

    const [matchmakingCountdown, setMatchmakingCountdown] = useState(
        gameConfig.timers.matchmakingTimeoutMs / 1000,
    );
    const lastTurnRef = React.useRef<"white" | "black" | null>(null);
    const tenSecWarningPlayedRef = React.useRef(false);

    // Timer logic based on absolute last_move_timestamp
    React.useEffect(() => {
        // Evaluate condition initially before ticking
        const initialState = engine.getState();
        if (matchStatus !== "active" || initialState.isGameOver) return;

        const updateTimer = () => {
            // Actively pull the latest truth instead of relying on React render closures
            const currentState = engine.getState();
            if (matchStatus !== "active" || currentState.isGameOver) return;

            const now = Date.now();
            let lastMove = now;

            if (currentState.moveHistory.length === 0) {
                if (!localMatchStartTime && !matchStartedAt) return;
                // First turn: anchor to local time to prevent clock skew, then fallback to match started_at
                lastMove = localMatchStartTime || new Date(matchStartedAt!).getTime();
            } else if (currentState.last_move_timestamp) {
                // Subsequent turns: anchor to last physical move
                lastMove = currentState.last_move_timestamp;
            }

            const elapsed = now - lastMove;
            const remaining = Math.max(0, gameConfig.timers.turnTimeMs - elapsed);
            const remainingSeconds = Math.ceil(remaining / 1000);

            setTimeLeft(remainingSeconds);

            // Track turn changes to reset the 10-second warning flag
            if (lastTurnRef.current !== currentState.turn) {
                lastTurnRef.current = currentState.turn;
                tenSecWarningPlayedRef.current = false;
            }

            // Play the "10 Seconds Remaining" warning strictly for the local player
            if (
                currentState.turn === localColor &&
                remainingSeconds === 10 &&
                !tenSecWarningPlayedRef.current &&
                remaining > 0
            ) {
                tenSecWarningPlayedRef.current = true;
                AudioService.playTenSecsWarning();
            }

            if (remaining <= 0) {
                // Time's up!
                if (currentState.turn === localColor) {
                    // Local player timed out
                    const newState = engine.resign(localColor, "Timeout");
                    setGameState(newState);
                    if (mode === "online" && matchId) {
                        supabase
                            .from("matches")
                            .update({ game_state: newState })
                            .eq("id", matchId);
                    }
                } else if (mode === "online" && matchId) {
                    // Opponent timed out (we actively claim victory)
                    const newState = engine.resign(currentState.turn, "Timeout");
                    setGameState(newState);
                    supabase
                        .from("matches")
                        .update({ game_state: newState })
                        .eq("id", matchId);
                } else if (mode === "local") {
                    // Local mode timeout
                    const newState = engine.resign(currentState.turn, "Timeout");
                    setGameState(newState);
                }
            }
        };

        updateTimer();
        const timer = setInterval(updateTimer, 1000);

        const subscription = AppState.addEventListener("change", (nextAppState) => {
            if (nextAppState === "active") {
                updateTimer();
            }
        });

        return () => {
            clearInterval(timer);
            subscription.remove();
        };
    }, [
        matchStatus,
        localColor,
        mode,
        engine,
        matchId,
        localMatchStartTime,
        matchStartedAt,
    ]);

    // Effect to subscribe to the remote Match state
    React.useEffect(() => {
        if (mode !== "online" || !matchId) return;

        // Fetch initial status
        supabase
            .from("matches")
            .select("status, player_white, player_black, is_private, started_at")
            .eq("id", matchId)
            .single()
            .then(({ data }) => {
                if (data) {
                    setMatchStatus(data.status);
                    if (data.status === "active") setLocalMatchStartTime(Date.now());
                    setIsPrivateMatch(data.is_private);
                    setMatchStartedAt(data.started_at);
                    const oppId =
                        localColor === "white" ? data.player_black : data.player_white;
                    setOpponentId(oppId);
                }
            });

        const channel = supabase
            .channel(`match_${matchId}`)
            .on(
                "postgres_changes",
                {
                    event: "UPDATE",
                    schema: "public",
                    table: "matches",
                    filter: `id=eq.${matchId}`,
                },
                (payload) => {
                    if (payload.new && payload.new.status) {
                        setMatchStatus(payload.new.status);
                        if (payload.new.status === "active")
                            setLocalMatchStartTime(Date.now());
                    }
                    if (payload.new && payload.new.started_at) {
                        setMatchStartedAt(payload.new.started_at);
                    }
                    if (
                        payload.new &&
                        (payload.new.player_white || payload.new.player_black)
                    ) {
                        const oppId =
                            localColor === "white"
                                ? payload.new.player_black
                                : payload.new.player_white;
                        if (oppId) setOpponentId(oppId);
                    }
                    if (payload.new && payload.new.game_state) {
                        const remoteState = payload.new.game_state as GameState;
                        if (!remoteState.isGameOver) {
                            remoteState.last_move_timestamp = Date.now();
                        }

                        setGameState(remoteState);

                        engine.setState(remoteState);
                    }
                },
            )
            .subscribe((status) => {
                console.log("Realtime Subscription Status:", status);
            });

        return () => {
            supabase.removeChannel(channel);
        };
    }, [mode, matchId, engine]);

    // Bot Fallback Timer
    React.useEffect(() => {
        if (
            mode !== "online" ||
            matchStatus !== "waiting" ||
            !matchId ||
            isPrivateMatch
        )
            return;

        const timer = setTimeout(async () => {
            const botUuid = "00000000-0000-0000-0000-000000000000";
            const nowIso = new Date().toISOString();
            setOpponentId(botUuid);
            setMatchStatus("active");
            setMatchStartedAt(nowIso);
            setLocalMatchStartTime(Date.now());
            await supabase
                .from("matches")
                .update({
                    player_black: botUuid,
                    status: "active",
                    started_at: nowIso,
                })
                .eq("id", matchId);
        }, gameConfig.timers.matchmakingTimeoutMs);

        return () => clearTimeout(timer);
    }, [mode, matchStatus, matchId, isPrivateMatch]);

    // Matchmaking Active Countdown UI Timer
    React.useEffect(() => {
        if (mode !== "online" || matchStatus !== "waiting") return;

        const interval = setInterval(() => {
            setMatchmakingCountdown((prev) => Math.max(0, prev - 1));
        }, 1000);

        return () => clearInterval(interval);
    }, [mode, matchStatus]);

    // Cleanup abandoned waiting matches on unmount
    React.useEffect(() => {
        return () => {
            if (mode === "online" && matchId && !isPrivateMatch) {
                // If the user leaves the screen (unmounts) while the match is still waiting, abort it.
                // The .eq('status', 'waiting') completely guards against aborting a match that already started active play.
                supabase
                    .from("matches")
                    .update({ status: "aborted" })
                    .eq("id", matchId)
                    .eq("status", "waiting")
                    .then(({ error }) => {
                        if (error) console.error("Error aborting abandoned match:", error);
                    });
            }
        };
    }, [mode, matchId, isPrivateMatch]);

    // Bot Turn Logic
    React.useEffect(() => {
        console.log(
            "🤖 Bot Check -> status:",
            matchStatus,
            "| opponent:",
            opponentId,
            "| turn:",
            gameState.turn,
        );
        if (
            mode === "online" &&
            matchStatus === "active" &&
            opponentId === "00000000-0000-0000-0000-000000000000" &&
            gameState.turn !== localColor &&
            !gameState.isGameOver
        ) {
            const thinkTime =
                Math.floor(
                    Math.random() * (gameConfig.botParams.botMaxThinkTimeMs - 2000 + 1),
                ) + 2000;
            const timer = setTimeout(async () => {
                const action = await calculateBotAction(
                    engine,
                    gameState.turn,
                    botDepth,
                );
                if (action) {
                    engine.applyAction(action);
                    setGameState({ ...engine.getState() });
                    await supabase
                        .from("matches")
                        .update({ game_state: engine.getState() })
                        .eq("id", matchId);
                }
            }, thinkTime);

            return () => clearTimeout(timer);
        }
    }, [
        mode,
        matchStatus,
        opponentId,
        gameState.turn,
        gameState.isGameOver,
        localColor,
        matchId,
    ]);

    // Override setGameState to ALSO push to Supabase if local player moved
    const handleSetGameState = async (newState: GameState) => {
        setGameState(newState);
        if (mode === "online" && matchId) {
            await supabase
                .from("matches")
                .update({ game_state: newState })
                .eq("id", matchId);
        }
    };

    // Centralized Audio Execution Engine listening to absolute State
    const prevGameStateRef = React.useRef<GameState | null>(null);

    React.useEffect(() => {
        const prev = prevGameStateRef.current;
        if (prev && gameState.moveHistory.length > prev.moveHistory.length) {
            const lastMove = gameState.moveHistory[gameState.moveHistory.length - 1];
            const isOpponentMove = gameState.turn === localColor; // If it's NOW localColor's turn, opponent just moved

            if (isOpponentMove && !gameState.isGameOver) {
                setTimeout(() => {
                    try {
                        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                    } catch (e) {
                        console.warn("Haptic Engine Drop:", e);
                    }
                }, 50);
            }

            if (gameState.isGameOver) {
                if (gameState.winReason === "Checkmate") {
                    AudioService.playCheckmate();
                } else {
                    AudioService.playGameEnd();
                }
            } else if (gameState.inCheck) {
                AudioService.playCheck();
            } else if (lastMove.type === "drop") {
                isOpponentMove
                    ? AudioService.playOpponentDrop()
                    : AudioService.playDrop();
            } else {
                // Detect capture by checking total pocket lengths
                const prevPocketTotal =
                    prev.pocket.white.length + prev.pocket.black.length;
                const newPocketTotal =
                    gameState.pocket.white.length + gameState.pocket.black.length;

                if (newPocketTotal > prevPocketTotal) {
                    isOpponentMove
                        ? AudioService.playOpponentCapture()
                        : AudioService.playCapture();
                } else {
                    isOpponentMove
                        ? AudioService.playOpponentMove()
                        : AudioService.playMove();
                }
            }
        }
        prevGameStateRef.current = gameState;
    }, [
        gameState.moveHistory,
        gameState.turn,
        gameState.isGameOver,
        gameState.inCheck,
        gameState.pocket,
        localColor,
    ]);

    // Game Over DB Sync
    React.useEffect(() => {
        const syncGameOver = async () => {
            if (gameState.isGameOver && mode === "online" && matchId) {
                const status =
                    gameState.winReason === "Resignation" ? "aborted" : "completed";
                await supabase
                    .from("matches")
                    .update({
                        status,
                        game_state: engine.getState(),
                    })
                    .eq("id", matchId);

                if (!isPrivateMatch) {
                    // Immediately trigger UI loader
                    setEloResult("loading");

                    // 1. Identify my User ID to mathematically assign Winner UUID
                    const { data: { user } } = await supabase.auth.getUser();
                    const myId = user?.id;

                    let winnerId: string | null = null;
                    if (gameState.winner === localColor) winnerId = myId || null;
                    else if (gameState.winner !== "draw") winnerId = opponentId;

                    // 2. Fire Elo RPC Asynchronously
                    const { data: eloData, error: eloError } = await supabase.rpc(
                        "record_match_result",
                        {
                            p_match_id: matchId,
                            p_winner_id: winnerId,
                            p_bot_depth: botDepth || null,
                        }
                    );

                    if (!eloError && eloData && !eloData.already_processed) {
                        setEloResult({
                            change: eloData.elo_change,
                            newElo: eloData.new_elo,
                        });
                    } else {
                        setEloResult(null); // Fallback if race-condition caught
                    }

                    // 3. Fire Coins RPC if Victory
                    if (gameState.winner === localColor) {
                        const { data: coinData } = await supabase.rpc(
                            "claim_victory_reward",
                            { p_match_id: matchId }
                        );
                        if (coinData?.success === true) {
                            setCoinsEarned(coinData.reward);
                            setCustomAlert({
                                title: "Victory!",
                                message: `You won ${coinData.reward} coins!`,
                                buttonText: "Great!",
                            });
                        }
                    }
                } else {
                    // Private Match Native Victory Mapping
                    if (gameState.winner === localColor) {
                        setCustomAlert({
                            title: "Victory!",
                            message: "You won the game!",
                            buttonText: "Great!",
                        });
                    }
                }
            }
        };
        syncGameOver();
    }, [
        gameState.isGameOver,
        matchId,
        mode,
        gameState.winReason,
        gameState.winner,
        localColor,
        isPrivateMatch,
        botDepth,
        opponentId,
    ]);

    const [resignModalVisible, setResignModalVisible] = useState(false);

    const handleResign = () => {
        setResignModalVisible(true);
    };

    const confirmResign = () => {
        const resignColor =
            mode === "online" && localColor ? localColor : gameState.turn;
        setGameState(
            engine.resign(resignColor as "white" | "black", "Resignation"),
        );
        setResignModalVisible(false);
        AudioService.playGameEnd();
    };

    const handleRestart = async () => {
        if (mode === "local") {
            setGameState(engine.resetState());
            AudioService.playGameStart();
        } else {
            setIsRematching(true);
            const {
                data: { session },
            } = await supabase.auth.getSession();
            if (session) {
                try {
                    const result = await MatchmakingService.findOrCreateMatch(
                        session.user.id,
                    );
                    setIsRematching(false);
                    navigation.replace("Game", {
                        mode: "online",
                        matchId: result.matchId,
                        localColor: result.color,
                    });
                } catch (error: any) {
                    setIsRematching(false);
                    setCustomAlert({
                        title: "Matchmaking Error",
                        message: error.message || "Failed to find a match.",
                    });
                    navigation.navigate("Home");
                }
            } else {
                setIsRematching(false);
                navigation.navigate("Home");
            }
        }
    };

    const handleBackToHome = () => {
        navigation.navigate("Home");
    };

    return (
        <ImageBackground
            source={require("../../assets/game-bg.jpg")}
            style={styles.container}
            resizeMode="cover"
        >
            <View
                style={[
                    styles.contentWrapper,
                    {
                        paddingTop: Math.max(insets.top, 10),
                        paddingBottom: gameState.isGameOver ? 240 : 20,
                    },
                ]}
            >
                {/* Waiting Overlay */}
                {mode === "online" && matchStatus === "waiting" && (
                    <View style={styles.waitingOverlay} pointerEvents="none">
                        <View style={styles.waitingContent}>
                            <Text style={styles.waitingText}>
                                {isPrivateMatch
                                    ? "Waiting for your friend to join!"
                                    : `Matching you to an opponent in ${matchmakingCountdown}s`}
                            </Text>
                        </View>
                    </View>
                )}
                {/* The Star of the Show: The 2.5D Board */}
                <ChessBoard
                    localColor={mode === "online" ? localColor || "white" : "white"}
                    engine={engine}
                    gameState={gameState}
                    setGameState={handleSetGameState}
                    isInputDisabled={
                        mode === "online" &&
                        (gameState.turn !== localColor || matchStatus === "waiting")
                    }
                    timeLeft={timeLeft}
                    matchStatus={matchStatus}
                    opponentName={
                        mode === "local"
                            ? "Opponent"
                            : opponentId === "00000000-0000-0000-0000-000000000000"
                                ? gameConfig.botParams.name
                                : "Opponent"
                    }
                />

                {!gameState.isGameOver && (
                    <View style={styles.footer}>
                        <TouchableOpacity
                            style={styles.mainResignButton}
                            onPress={handleResign}
                            disabled={gameState.isGameOver}
                        >
                            <Text style={styles.mainResignButtonText}>RESIGN</Text>
                        </TouchableOpacity>
                    </View>
                )}

                {/* Resign Confirmation Modal */}
                <Modal
                    visible={resignModalVisible}
                    transparent={true}
                    animationType="fade"
                >
                    <View style={styles.modalOverlay}>
                        <View
                            style={[
                                styles.modalContent,
                                styles.gameOverContent,
                                { paddingBottom: Math.max(insets.bottom, 24) },
                            ]}
                        >
                            <Text style={[styles.modalTitle, { textAlign: "center" }]}>
                                Resign Game
                            </Text>
                            <Text style={styles.modalText}>
                                Are you sure you want to resign?
                            </Text>
                            <View style={styles.modalButtons}>
                                <TouchableOpacity
                                    style={styles.cancelButton}
                                    onPress={() => setResignModalVisible(false)}
                                >
                                    <Text style={styles.cancelButtonText}>Cancel</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={styles.confirmButton}
                                    onPress={confirmResign}
                                >
                                    <Text style={styles.confirmButtonText}>Confirm!</Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                    </View>
                </Modal>

                {/* Game Over Modal */}
                <Modal
                    visible={gameState.isGameOver}
                    transparent={true}
                    animationType="fade"
                >
                    <View style={styles.gameOverOverlay}>
                        <View
                            style={[
                                styles.modalContent,
                                styles.gameOverContent,
                                { paddingBottom: Math.max(insets.bottom, 24) },
                            ]}
                        >
                            {gameState.winner === localColor && (
                                <View style={styles.victoryBadge}>
                                    <Text style={{ fontSize: 30 }}>🏆</Text>
                                </View>
                            )}
                            <Text style={styles.gameOverTitle}>
                                {gameState.winner === "draw"
                                    ? "Draw!"
                                    : gameState.winner === localColor
                                        ? "You Win!"
                                        : `${gameState.winner === "white" ? "White" : "Black"} Wins!`}
                            </Text>
                            {gameState.winReason && (
                                <Text style={styles.gameOverReason}>
                                    by {gameState.winReason}
                                </Text>
                            )}

                            {/* Dynamic Post-Match Rewards Injection */}
                            {mode === "online" && !isPrivateMatch && (
                                <View style={styles.rewardsContainer}>
                                    {/* Elo Async Skeleton / Result */}
                                    {eloResult === "loading" ? (
                                        <Text style={styles.loadingRewardsText}>
                                            Calculating Ratings...
                                        </Text>
                                    ) : eloResult ? (
                                        <View style={styles.rewardsRow}>
                                            <Text style={styles.rewardTextCombo}>
                                                {eloResult.change >= 0 ? "📈 +" : "📉 "}
                                                {eloResult.change} Elo ({eloResult.newElo})
                                            </Text>

                                            {coinsEarned !== null && (
                                                <Text style={styles.rewardTextCombo}>
                                                    🪙 +{coinsEarned} Coins
                                                </Text>
                                            )}
                                        </View>
                                    ) : null}
                                </View>
                            )}

                            <View style={styles.gameOverButtons}>
                                <TouchableOpacity
                                    style={styles.playAgainButton}
                                    onPress={handleRestart}
                                    disabled={isRematching}
                                >
                                    <Text style={styles.playAgainText}>
                                        {isRematching ? "Searching..." : "Play Again"}
                                    </Text>
                                </TouchableOpacity>

                                <TouchableOpacity
                                    style={styles.homeButton}
                                    onPress={handleBackToHome}
                                >
                                    <Text style={styles.homeButtonText}>Home</Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                    </View>
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
                                    {customAlert?.buttonText || "Okay"}
                                </Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </Modal>
            </View>
        </ImageBackground>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: defaultTheme.background, // Clean Green Background
    },
    contentWrapper: {
        flex: 1,
        paddingHorizontal: 20,
        paddingBottom: 20,
        justifyContent: "space-between",
    },
    header: {
        alignItems: "center",
        marginVertical: 10,
    },
    headerText: {
        fontSize: 24,
        color: defaultTheme.ui.textLight,
        fontFamily: "PublicSans_900Black",
        textShadowColor: "rgba(0, 0, 0, 0.3)",
        textShadowOffset: { width: 0, height: 2 },
        textShadowRadius: 4,
    },
    waitingOverlay: {
        position: "absolute",
        top: 120,
        alignSelf: "center",
        zIndex: 50,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.2,
        shadowRadius: 10,
        elevation: 10,
    },
    waitingContent: {
        backgroundColor: "#ffffff",
        paddingHorizontal: 24,
        paddingVertical: 14,
        borderRadius: 24,
        borderWidth: 3,
        borderColor: "#facc15",
    },
    waitingText: {
        color: "#2A343A",
        fontFamily: "PublicSans_700Bold",
        fontSize: 16,
        textAlign: "center",
    },
    footer: {
        alignItems: "center",
        marginVertical: 20,
    },
    modalOverlay: {
        flex: 1,
        backgroundColor: "rgba(0, 0, 0, 0.6)",
        justifyContent: "flex-end",
    },
    gameOverOverlay: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: "rgba(0, 0, 0, 0.25)",
        justifyContent: "flex-end",
        zIndex: 50,
    },
    modalContent: {
        backgroundColor: defaultTheme.ui.pocketBackground,
        padding: 24,
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        borderBottomLeftRadius: 0,
        borderBottomRightRadius: 0,
        width: "100%",
        maxWidth: "100%",
        elevation: 10,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 5 },
        shadowOpacity: 0.5,
        shadowRadius: 10,
    },
    gameOverContent: {
        backgroundColor: "#ffffff",
        minHeight: 200,
        justifyContent: "center",
    },
    modalTitle: {
        fontSize: 20,
        fontFamily: "PublicSans_700Bold",
        color: "#2A343A",
        marginBottom: 10,
    },
    modalText: {
        fontSize: 16,
        fontFamily: "PublicSans_400Regular",
        color: "#2A343A",
        marginBottom: 20,
        textAlign: "center",
    },
    modalButtons: {
        flexDirection: "row",
        width: "100%",
        gap: 12,
    },
    gameOverTitle: {
        fontSize: 32,
        fontFamily: "PublicSans_900Black",
        color: "#2A343A",
        marginBottom: 10,
        textAlign: "center",
    },
    gameOverReason: {
        fontSize: 18,
        fontFamily: "PublicSans_400Regular",
        color: "#2A343A",
        marginBottom: 10,
        textAlign: "center",
    },
    rewardsContainer: {
        alignItems: "center",
        marginBottom: 20,
        paddingVertical: 12,
        backgroundColor: "rgba(0, 0, 0, 0.03)",
        borderRadius: 16,
        borderWidth: 1,
        borderColor: "rgba(0, 0, 0, 0.05)",
    },
    loadingRewardsText: {
        fontSize: 14,
        fontFamily: "PublicSans_400Regular",
        color: "#6c7a89",
        fontStyle: "italic",
        textAlign: "center",
    },
    rewardsRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
    },
    rewardTextCombo: {
        fontSize: 16,
        fontFamily: "PublicSans_700Bold",
        color: "#2A343A",
    },
    mainResignButton: {
        backgroundColor: "#ff6b6b",
        borderWidth: 2,
        borderBottomWidth: 6,
        borderColor: "#c0392b",
        paddingVertical: 12,
        paddingHorizontal: 32,
        borderRadius: 25,
        alignSelf: "center",
    },
    mainResignButtonText: {
        color: "white",
        fontFamily: "PublicSans_700Bold",
        fontSize: 16,
        textAlign: "center",
    },
    cancelButton: {
        flex: 1,
        backgroundColor: "#607D8B", // Muted slate
        paddingVertical: 14,
        borderRadius: 12,
        alignItems: "center",
    },
    cancelButtonText: {
        color: "white",
        fontFamily: "PublicSans_700Bold",
        fontSize: 16,
    },
    confirmButton: {
        flex: 1,
        backgroundColor: "#e74c3c", // Punchy red
        paddingVertical: 14,
        borderRadius: 12,
        alignItems: "center",
    },
    confirmButtonText: {
        color: "white",
        fontFamily: "PublicSans_700Bold",
        fontSize: 16,
    },

    playAgainButton: {
        flex: 1,
        backgroundColor: "#4ade80",
        borderColor: "#16a34a",
        borderWidth: 2,
        borderBottomWidth: 6,
        paddingVertical: 14,
        borderRadius: 20,
        alignItems: "center",
    },
    playAgainText: {
        color: "white",
        fontFamily: "PublicSans_700Bold",
        fontSize: 16,
    },
    homeButton: {
        flex: 1,
        backgroundColor: "#38bdf8",
        borderColor: "#0284c7",
        borderWidth: 2,
        borderBottomWidth: 6,
        paddingVertical: 14,
        borderRadius: 20,
        alignItems: "center",
    },
    homeButtonText: {
        color: "white",
        fontFamily: "PublicSans_700Bold",
        fontSize: 16,
    },
    gameOverButtons: {
        flexDirection: "row",
        width: "100%",
        gap: 12,
        marginTop: 10,
    },
    modalOverlayCenter: {
        flex: 1,
        backgroundColor: "rgba(0, 0, 0, 0.7)",
        justifyContent: "center",
        alignItems: "center",
    },
    customAlertContent: {
        backgroundColor: "#ffffff",
        borderColor: "#facc15",
        borderWidth: 4,
        padding: 30,
        borderRadius: 24,
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
        color: "#2A343A",
        marginBottom: 12,
        textAlign: "center",
    },
    customAlertMessage: {
        fontSize: 16,
        fontFamily: "PublicSans_400Regular",
        color: "#2A343A",
        textAlign: "center",
        marginBottom: 24,
        lineHeight: 22,
    },
    customAlertBtn: {
        backgroundColor: "#4ade80",
        borderColor: "#16a34a",
        borderWidth: 2,
        borderBottomWidth: 6,
        paddingVertical: 12,
        paddingHorizontal: 30,
        borderRadius: 20,
    },
    customAlertBtnText: {
        color: "white",
        fontSize: 16,
        fontFamily: "PublicSans_700Bold",
    },
    victoryBadge: {
        position: "absolute",
        top: -30,
        alignSelf: "center",
        backgroundColor: "#facc15",
        borderRadius: 30,
        width: 60,
        height: 60,
        justifyContent: "center",
        alignItems: "center",
        borderWidth: 3,
        borderColor: "white",
    },
});
