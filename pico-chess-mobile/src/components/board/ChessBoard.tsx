import React, { useState, useEffect, useMemo } from "react";
import {
    View,
    StyleSheet,
    TouchableWithoutFeedback,
    Dimensions,
    Text,
    Image,
} from "react-native";
import { GameEngine } from "../../core/GameEngine";
import {
    GameAction,
    GameState,
    Position,
    PieceType,
    PlayerColor,
} from "../../types";
import { ChessPiece2D } from "./ChessPiece2D";
import { Pocket } from "./Pocket";
import { BoardBackground } from "../pieces/BoardBackground";
import { AudioService } from "../../services/AudioService";
import { defaultTheme } from "../../config/themeConfig";
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    withSpring,
} from "react-native-reanimated";
import AsyncStorage from "@react-native-async-storage/async-storage";

const DROP_TUTORIAL_KEY = "drop_tutorial_games_seen";
const DROP_TUTORIAL_LIMIT = 2;

const { width } = Dimensions.get("window");
const BOARD_SIZE = width * 0.9;

interface ChessBoardProps {
    localColor: PlayerColor;
    engine: GameEngine;
    gameState: GameState;
    setGameState: (state: GameState) => void | Promise<void>;
    isInputDisabled?: boolean;
    timeLeft?: number;
    matchStatus?: string;
    opponentName?: string;
    opponentAvatarUrl?: string | null;
}

export const ChessBoard: React.FC<ChessBoardProps> = ({
    localColor,
    engine,
    gameState,
    setGameState,
    isInputDisabled = false,
    timeLeft,
    matchStatus,
    opponentName,
    opponentAvatarUrl,
}) => {
    // Init audio
    useEffect(() => {
        AudioService.playGameStart();
    }, []);

    // Selection states
    const [selectedPos, setSelectedPos] = useState<Position | null>(null);
    const [selectedPocketPiece, setSelectedPocketPiece] =
        useState<PieceType | null>(null);

    // Transient "Dropped from hand" tooltip shown when the opponent drops a piece.
    const [dropToast, setDropToast] = useState<{ row: number; col: number } | null>(null);

    // First-2-games "drop captured pieces" tutorial callout.
    // Shows ONCE per game, only when (a) under the lifetime games-seen cap, (b) it's the
    // user's turn, and (c) they have ≥1 captured piece in hand — so the prompt actually
    // makes sense given the board state.
    const [tutorialEligible, setTutorialEligible] = useState(false);
    const [showDropTutorial, setShowDropTutorial] = useState(false);
    const tutorialShownThisGameRef = React.useRef(false);
    const tutorialShownAtMoveCountRef = React.useRef<number | null>(null);
    const tutorialIncrementedRef = React.useRef(false);

    // Read AsyncStorage once on mount to determine eligibility for this game.
    useEffect(() => {
        let cancelled = false;
        AsyncStorage.getItem(DROP_TUTORIAL_KEY).then((raw) => {
            if (cancelled) return;
            const seen = raw ? parseInt(raw, 10) : 0;
            if (Number.isFinite(seen) && seen < DROP_TUTORIAL_LIMIT) {
                setTutorialEligible(true);
            }
        });
        return () => {
            cancelled = true;
        };
    }, []);

    // Show the tutorial the first time all conditions line up in this game.
    useEffect(() => {
        if (!tutorialEligible) return;
        if (tutorialShownThisGameRef.current) return;
        if (gameState.isGameOver) return;
        if (gameState.turn !== localColor) return;
        if ((gameState.pocket[localColor]?.length ?? 0) < 1) return;
        tutorialShownThisGameRef.current = true;
        tutorialShownAtMoveCountRef.current = gameState.moveHistory.length;
        setShowDropTutorial(true);
    }, [
        tutorialEligible,
        gameState.turn,
        gameState.pocket,
        gameState.isGameOver,
        gameState.moveHistory.length,
        localColor,
    ]);

    // Auto-dismiss the tutorial after 8 seconds (its own effect so cleanup is reliable).
    useEffect(() => {
        if (!showDropTutorial) return;
        const t = setTimeout(() => setShowDropTutorial(false), 8000);
        return () => clearTimeout(t);
    }, [showDropTutorial]);

    // Dismiss as soon as the local player makes any move AFTER the tutorial appeared.
    useEffect(() => {
        if (!showDropTutorial) return;
        if (tutorialShownAtMoveCountRef.current === null) return;
        if (gameState.moveHistory.length > tutorialShownAtMoveCountRef.current) {
            setShowDropTutorial(false);
        }
    }, [gameState.moveHistory.length, showDropTutorial]);

    // On game-end, increment the tutorial counter — but only if (1) the game actually
    // played out (≥2 moves, avoids burning a slot on misclick resigns) and (2) we're
    // still under the limit (prevents pointless writes once permanently dismissed).
    useEffect(() => {
        if (!gameState.isGameOver) return;
        if (tutorialIncrementedRef.current) return;
        if (gameState.moveHistory.length < 2) return;
        tutorialIncrementedRef.current = true;
        setShowDropTutorial(false);
        AsyncStorage.getItem(DROP_TUTORIAL_KEY).then((raw) => {
            const seen = raw ? parseInt(raw, 10) : 0;
            const safe = Number.isFinite(seen) ? seen : 0;
            if (safe >= DROP_TUTORIAL_LIMIT) return;
            AsyncStorage.setItem(DROP_TUTORIAL_KEY, String(safe + 1)).catch((e) =>
                console.warn("Failed to persist drop tutorial counter:", e),
            );
        });
    }, [gameState.isGameOver, gameState.moveHistory.length]);

    // Detect opponent drops via the last entry in moveHistory. Immediately after a move,
    // gameState.turn is the OPPONENT of the actor — so when a drop just happened AND the
    // turn is now back to localColor, the opponent is the one who dropped.
    useEffect(() => {
        const last =
            gameState.moveHistory.length > 0
                ? gameState.moveHistory[gameState.moveHistory.length - 1]
                : null;
        if (!last || last.type !== "drop") return;
        if (gameState.turn !== localColor) return; // not opponent's drop
        setDropToast({ row: last.to.row, col: last.to.col });
        const t = setTimeout(() => setDropToast(null), 1500);
        return () => clearTimeout(t);
    }, [gameState.moveHistory.length, gameState.turn, localColor]);

    // When a square or piece is selected, figure out what actions are legal
    const legalActions = useMemo(
        () => engine.getAllLegalActions(gameState),
        [gameState, engine],
    );

    // Derived highlights
    const highlightedSquares = useMemo(() => {
        const highlights: Position[] = [];
        if (selectedPos) {
            legalActions.forEach((a) => {
                if (
                    a.type === "move" &&
                    a.from.row === selectedPos.row &&
                    a.from.col === selectedPos.col
                ) {
                    highlights.push(a.to);
                }
            });
        } else if (selectedPocketPiece) {
            legalActions.forEach((a) => {
                if (a.type === "drop" && a.pieceType === selectedPocketPiece) {
                    highlights.push(a.to);
                }
            });
        }
        return highlights;
    }, [legalActions, selectedPos, selectedPocketPiece]);

    const handleSquarePress = (row: number, col: number) => {
        if (isInputDisabled) return;

        // Is this a legal move or drop to this square?
        const actionToApply = legalActions.find((a) => {
            if (a.type === "move" && selectedPos) {
                return (
                    a.from.row === selectedPos.row &&
                    a.from.col === selectedPos.col &&
                    a.to.row === row &&
                    a.to.col === col
                );
            }
            if (a.type === "drop" && selectedPocketPiece) {
                return (
                    a.pieceType === selectedPocketPiece &&
                    a.to.row === row &&
                    a.to.col === col
                );
            }
            return false;
        });

        if (actionToApply) {
            // Execute the move locally
            const isCapture =
                actionToApply.type === "move" &&
                gameState.board[actionToApply.to.row][actionToApply.to.col] !== null;

            const newState = engine.applyAction(actionToApply);
            setGameState(newState);
            setSelectedPos(null);
            setSelectedPocketPiece(null);

            // (In Phase 6, we would send this move to Supabase Realtime here)
            // Auto-play Bot if playing against bot? For now it's just local engine test.
            return;
        }

        // Otherwise, try selecting the piece on this square
        const piece = gameState.board[row][col];
        if (piece && piece.color === gameState.turn) {
            setSelectedPos({ row, col });
            setSelectedPocketPiece(null);
        } else {
            setSelectedPos(null);
            setSelectedPocketPiece(null);
        }
    };

    const handlePocketSelect = (
        pieceColor: PlayerColor,
        pieceType: PieceType,
    ) => {
        if (
            isInputDisabled ||
            gameState.turn !== pieceColor ||
            gameState.pendingPromotion
        )
            return;
        setSelectedPocketPiece(pieceType);
        setSelectedPos(null);
    };

    const handlePromotionChoice = (pieceType: PieceType) => {
        if (isInputDisabled) return;
        try {
            const newState = engine.executePromotion(pieceType);
            setGameState(newState);
        } catch (e) {
            console.error(e);
        }
    };

    // 180 Degree rotation logic if local player is Black
    const isRotated = localColor === "black";

    const renderSquares = () => {
        const lastAction =
            gameState.moveHistory.length > 0
                ? gameState.moveHistory[gameState.moveHistory.length - 1]
                : null;

        const squares = [];
        for (let r = 0; r < 6; r++) {
            for (let c = 0; c < 6; c++) {
                const visualRow = isRotated ? 5 - r : r;
                const visualCol = isRotated ? 5 - c : c;

                const isLight = (visualRow + visualCol) % 2 === 0;
                const bgColor = "transparent"; // Let the SVG board under it show through

                const piece = gameState.board[visualRow][visualCol];
                const isHighlighted = highlightedSquares.some(
                    (h) => h.row === visualRow && h.col === visualCol,
                );
                const isSelectedSquare =
                    selectedPos?.row === visualRow && selectedPos?.col === visualCol;

                const isCapture =
                    isHighlighted && piece && piece.color !== gameState.turn;
                const isThreatenedKing =
                    gameState.inCheck &&
                    piece?.type === "K" &&
                    piece?.color === gameState.turn;

                const isLastMoveHighlight = lastAction
                    ? lastAction.type === "move"
                        ? (visualRow === lastAction.from.row &&
                            visualCol === lastAction.from.col) ||
                        (visualRow === lastAction.to.row &&
                            visualCol === lastAction.to.col)
                        : lastAction.type === "drop" &&
                        visualRow === lastAction.to.row &&
                        visualCol === lastAction.to.col
                    : false;

                const finalBgColor = isThreatenedKing
                    ? "rgba(255, 0, 0, 0.5)"
                    : isLastMoveHighlight
                        ? "rgba(249, 212, 6, 0.4)"
                        : bgColor;

                squares.push(
                    <TouchableWithoutFeedback
                        key={`${visualRow}-${visualCol}`}
                        onPress={() => handleSquarePress(visualRow, visualCol)}
                    >
                        <View
                            style={[
                                styles.square,
                                { backgroundColor: finalBgColor },
                                isSelectedSquare && styles.selectedSquare,
                            ]}
                        >
                            {isHighlighted && !isCapture && (
                                <View style={styles.highlightDot} />
                            )}
                            {isCapture && <View style={styles.captureRing} />}
                            {piece && (
                                <Animated.View style={styles.pieceAnimatedContainer}>
                                    <ChessPiece2D
                                        type={piece.type}
                                        color={piece.color}
                                        size={(BOARD_SIZE / 6) * 0.8}
                                    />
                                </Animated.View>
                            )}
                        </View>
                    </TouchableWithoutFeedback>,
                );
            }
        }
        return squares;
    };

    const renderPlayerContainer = (
        color: PlayerColor,
        children: React.ReactNode,
        name: string,
        avatarUrl?: string | null,
    ) => {
        const isActive =
            gameState.turn === color &&
            matchStatus === "active" &&
            !gameState.isGameOver;
        return (
            <View
                style={[
                    styles.playerContainer,
                    isActive && styles.activePlayerContainer,
                ]}
            >
                <View style={styles.playerHeader}>
                    <View style={styles.playerNameRow}>
                        {avatarUrl ? (
                            <Image source={{ uri: avatarUrl }} style={styles.playerAvatar} />
                        ) : null}
                        <Text
                            style={[styles.playerName, isActive && styles.activePlayerText]}
                            numberOfLines={1}
                        >
                            {name}
                        </Text>
                    </View>
                    <View style={[styles.timerPill, { opacity: isActive ? 1 : 0 }]}>
                        <Text
                            style={[
                                styles.playerTimer,
                                (timeLeft ?? 0) <= 10 && styles.lowTime,
                            ]}
                        >
                            ⏱ 00:
                            {(timeLeft ?? 0) < 10 ? `0${timeLeft ?? 0}` : (timeLeft ?? 0)}
                        </Text>
                    </View>
                </View>
                {children}
            </View>
        );
    };

    return (
        <View style={styles.container}>
            {/* Opponent Pocket (Top) */}
            {renderPlayerContainer(
                localColor === "white" ? "black" : "white",
                <Pocket
                    color={localColor === "white" ? "black" : "white"}
                    pieces={gameState.pocket[localColor === "white" ? "black" : "white"]}
                    onSelectPiece={(type) =>
                        handlePocketSelect(localColor === "white" ? "black" : "white", type)
                    }
                    selectedPiece={
                        gameState.turn !== localColor ? selectedPocketPiece : null
                    }
                    size={40}
                />,
                opponentName || "Opponent",
                opponentAvatarUrl,
            )}

            {/* The 2.5D Board Container */}
            <View style={styles.board25DWrapper}>
                <View style={StyleSheet.absoluteFill}>
                    <BoardBackground />
                </View>

                <View style={styles.boardGridOverlay}>{renderSquares()}</View>

                {dropToast && (() => {
                    const visualRow = isRotated ? 5 - dropToast.row : dropToast.row;
                    const visualCol = isRotated ? 5 - dropToast.col : dropToast.col;
                    const sqPx = BOARD_SIZE / 6;
                    const bubbleHeight = 28;
                    const tailHeight = 7;
                    const gap = 4;
                    const tipWidth = 130;
                    // For row 0 (visual top), flip the bubble below the square so it
                    // doesn't render above the board edge into the opponent area.
                    const showAbove = visualRow > 0;
                    const top = showAbove
                        ? visualRow * sqPx - bubbleHeight - tailHeight - gap
                        : (visualRow + 1) * sqPx + tailHeight + gap;
                    const left = visualCol * sqPx + sqPx / 2 - tipWidth / 2;
                    return (
                        <View
                            pointerEvents="none"
                            style={[styles.dropToastContainer, { top, left, width: tipWidth }]}
                        >
                            {!showAbove && <View style={styles.dropToastTailUp} />}
                            <View style={styles.dropToastBubble}>
                                <Text style={styles.dropToastText}>Dropped from hand</Text>
                            </View>
                            {showAbove && <View style={styles.dropToastTailDown} />}
                        </View>
                    );
                })()}

                {gameState.pendingPromotion && gameState.turn === localColor && (
                    <View style={styles.promotionModal}>
                        <View style={styles.promotionBox}>
                            <Text style={styles.promotionText}>Choose Promotion</Text>
                            <View style={styles.promotionChoices}>
                                {(["R", "B", "N"] as PieceType[]).map((pt) => (
                                    <TouchableWithoutFeedback
                                        key={pt}
                                        onPress={() => handlePromotionChoice(pt)}
                                    >
                                        <View style={styles.promotionOption}>
                                            <ChessPiece2D
                                                type={pt}
                                                color={gameState.turn}
                                                size={50}
                                            />
                                        </View>
                                    </TouchableWithoutFeedback>
                                ))}
                            </View>
                        </View>
                    </View>
                )}
            </View>

            {showDropTutorial && (
                <View pointerEvents="none" style={styles.dropTutorialContainer}>
                    <View style={styles.dropTutorialBubble}>
                        <Text style={styles.dropTutorialText}>
                            👇 Tap a captured piece to drop it on the board
                        </Text>
                    </View>
                    <View style={styles.dropTutorialTail} />
                </View>
            )}

            {/* Local Player Pocket (Bottom) */}
            {renderPlayerContainer(
                localColor,
                <Pocket
                    color={localColor}
                    pieces={gameState.pocket[localColor]}
                    onSelectPiece={(type) => handlePocketSelect(localColor, type)}
                    selectedPiece={
                        gameState.turn === localColor ? selectedPocketPiece : null
                    }
                    size={50}
                />,
                "You",
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
        flex: 1,
    },
    board25DWrapper: {
        width: "100%",
        aspectRatio: 1,
        position: "relative",
        backgroundColor: "transparent",
        borderRadius: 8,
        // Add Isometric depth using standard shadows
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.5,
        shadowRadius: 15,
        elevation: 10,
    },
    boardGridOverlay: {
        width: "100%",
        height: "100%",
        flexDirection: "row",
        flexWrap: "wrap",
        borderRadius: 8,
        overflow: "hidden",
    },
    square: {
        width: "16.666%",
        height: "16.666%",
        justifyContent: "center",
        alignItems: "center",
    },
    selectedSquare: {
        backgroundColor: "rgba(255, 255, 0, 0.3)",
    },
    highlightDot: {
        position: "absolute",
        width: "30%",
        height: "30%",
        borderRadius: 100,
        backgroundColor: "rgba(0, 0, 0, 0.3)",
        zIndex: 1, // Draw under the piece
    },
    captureRing: {
        position: "absolute",
        width: "90%",
        height: "90%",
        borderRadius: 100,
        borderWidth: 4,
        borderColor: "rgba(235, 64, 52, 0.8)",
        zIndex: 1,
    },
    pieceAnimatedContainer: {
        zIndex: 2,
        position: "absolute",
    },
    dropToastContainer: {
        position: "absolute",
        zIndex: 30,
        alignItems: "center",
    },
    dropToastBubble: {
        backgroundColor: "rgba(0, 0, 0, 0.85)",
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 8,
    },
    dropToastText: {
        color: "#fff",
        fontSize: 12,
        fontWeight: "600",
        textAlign: "center",
    },
    dropToastTailDown: {
        width: 0,
        height: 0,
        borderLeftWidth: 6,
        borderRightWidth: 6,
        borderTopWidth: 7,
        borderLeftColor: "transparent",
        borderRightColor: "transparent",
        borderTopColor: "rgba(0, 0, 0, 0.85)",
    },
    dropToastTailUp: {
        width: 0,
        height: 0,
        borderLeftWidth: 6,
        borderRightWidth: 6,
        borderBottomWidth: 7,
        borderLeftColor: "transparent",
        borderRightColor: "transparent",
        borderBottomColor: "rgba(0, 0, 0, 0.85)",
    },
    dropTutorialContainer: {
        alignItems: "center",
        marginTop: 6,
        marginBottom: 2,
    },
    dropTutorialBubble: {
        backgroundColor: "rgba(0, 0, 0, 0.85)",
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 14,
        maxWidth: "90%",
    },
    dropTutorialText: {
        color: "#fff",
        fontSize: 13,
        fontWeight: "600",
        textAlign: "center",
    },
    dropTutorialTail: {
        width: 0,
        height: 0,
        borderLeftWidth: 7,
        borderRightWidth: 7,
        borderTopWidth: 7,
        borderLeftColor: "transparent",
        borderRightColor: "transparent",
        borderTopColor: "rgba(0, 0, 0, 0.85)",
    },
    promotionModal: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: "rgba(0, 0, 0, 0.7)",
        zIndex: 20, // Sit above the grid
        justifyContent: "center",
        alignItems: "center",
        borderRadius: 8,
    },
    promotionBox: {
        backgroundColor: defaultTheme.ui.pocketBackground,
        padding: 20,
        borderRadius: 12,
        alignItems: "center",
        elevation: 5,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 5,
    },
    promotionText: {
        color: "white",
        fontSize: 18,
        fontFamily: "PublicSans_700Bold",
        marginBottom: 15,
    },
    promotionChoices: {
        flexDirection: "row",
        justifyContent: "space-between",
        width: 200,
    },
    promotionOption: {
        width: 60,
        height: 60,
        backgroundColor: "rgba(255, 255, 255, 0.2)",
        borderRadius: 8,
        justifyContent: "center",
        alignItems: "center",
    },
    playerContainer: {
        width: "100%",
        padding: 12,
        borderRadius: 20,
        marginVertical: 4,
        backgroundColor: "rgba(255, 255, 255, 0.7)",
        borderWidth: 5,
        borderColor: "transparent",
    },
    activePlayerContainer: {
        backgroundColor: "rgba(255, 255, 255, 0.95)",
        borderColor: "#4ade80", // Can be overridden dynamically later if needed
        borderWidth: 5,
    },
    playerHeader: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "flex-end",
        paddingHorizontal: 8,
        marginTop: 4,
        marginBottom: -4,
    },
    playerNameRow: {
        flexDirection: "row",
        alignItems: "center",
        flexShrink: 1,
        gap: 8,
    },
    playerAvatar: {
        width: 22,
        height: 22,
        borderRadius: 11,
        backgroundColor: "#ddd",
    },
    playerName: {
        color: "#2A343A",
        fontSize: 14,
        fontFamily: "PublicSans_700Bold",
        textTransform: "uppercase",
        flexShrink: 1,
    },
    activePlayerText: {
        color: "#2A343A",
    },
    timerPill: {
        backgroundColor: "rgba(255, 165, 0, 0.2)",
        borderRadius: 12,
        paddingHorizontal: 10,
        paddingVertical: 4,
    },
    playerTimer: {
        color: "#d35400", // Dark orange
        fontSize: 16,
        fontFamily: "PublicSans_700Bold",
        fontVariant: ["tabular-nums"],
    },
    lowTime: {
        color: "#ef4444", // Keep red for low time
    },
});
