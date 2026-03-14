import React, { useState, useEffect, useMemo } from "react";
import {
  View,
  StyleSheet,
  TouchableWithoutFeedback,
  Dimensions,
  Text,
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
}) => {
  // Init audio
  useEffect(() => {
    AudioService.playGameStart();
  }, []);

  // Selection states
  const [selectedPos, setSelectedPos] = useState<Position | null>(null);
  const [selectedPocketPiece, setSelectedPocketPiece] =
    useState<PieceType | null>(null);

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
          <Text
            style={[styles.playerName, isActive && styles.activePlayerText]}
          >
            {name}
          </Text>
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
      )}

      {/* The 2.5D Board Container */}
      <View style={styles.board25DWrapper}>
        <View style={StyleSheet.absoluteFill}>
          <BoardBackground />
        </View>

        <View style={styles.boardGridOverlay}>{renderSquares()}</View>

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
  playerName: {
    color: "#2A343A",
    fontSize: 14,
    fontFamily: "PublicSans_700Bold",
    textTransform: "uppercase",
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
