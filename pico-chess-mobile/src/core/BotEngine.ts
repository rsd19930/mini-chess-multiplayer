import { GameEngine } from "./GameEngine";
import { GameAction, PlayerColor, GameState, PieceType } from "../types";
import { gameConfig } from "../config/gameConfig";

const PIECE_VALUES: Record<PieceType, number> = {
    P: 100,
    N: 300,
    B: 300,
    R: 500,
    K: 9000,
};

// Piece-Square Tables (PST) for positional evaluation (from White's perspective)
// 6x6 board evaluations keeping pieces central and kings safe
const PST_MIDGAME: Record<PieceType, number[][]> = {
    P: [
        [0, 0, 0, 0, 0, 0],
        [50, 50, 50, 50, 50, 50],
        [10, 20, 30, 30, 20, 10],
        [5, 10, 20, 20, 10, 5],
        [0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0],
    ],
    N: [
        [-50, -40, -30, -30, -40, -50],
        [-40, -20, 0, 0, -20, -40],
        [-30, 0, 20, 20, 0, -30],
        [-30, 0, 20, 20, 0, -30],
        [-40, -20, 0, 0, -20, -40],
        [-50, -40, -30, -30, -40, -50],
    ],
    B: [
        [-20, -10, -10, -10, -10, -20],
        [-10, 10, 10, 10, 10, -10],
        [-10, 10, 20, 20, 10, -10],
        [-10, 10, 20, 20, 10, -10],
        [-10, 10, 10, 10, 10, -10],
        [-20, -10, -10, -10, -10, -20],
    ],
    R: [
        [0, 0, 10, 10, 0, 0],
        [-10, 0, 0, 0, 0, -10],
        [-10, 0, 0, 0, 0, -10],
        [-10, 0, 0, 0, 0, -10],
        [-10, 0, 0, 0, 0, -10],
        [0, 0, 10, 10, 0, 0],
    ],
    K: [
        [-30, -30, -30, -30, -30, -30],
        [-30, -30, -30, -30, -30, -30],
        [-30, -30, -30, -30, -30, -30],
        [-30, -30, -30, -30, -30, -30],
        [-10, -10, -10, -10, -10, -10],
        [20, 30, 10, 10, 30, 20], // Keep king safe in corners
    ],
};

// Evaluate the board from the perspective of the maximizingColor
function evaluateBoard(
    gameState: GameState,
    maximizingColor: PlayerColor,
): number {
    let maximizingScore = 0;
    let opponentScore = 0;
    const opponentColor = maximizingColor === "white" ? "black" : "white";

    // 1. Evaluate Pieces on Board with Positional Bonus
    for (let r = 0; r < 6; r++) {
        for (let c = 0; c < 6; c++) {
            const piece = gameState.board[r][c];
            if (piece) {
                let value = PIECE_VALUES[piece.type];

                // Add positional bonus from White's perspective. If Black, flip the row.
                const isWhite = piece.color === "white";
                const rank = isWhite ? r : 5 - r;
                const pstValue = PST_MIDGAME[piece.type][rank][c];
                value += pstValue;

                if (piece.color === maximizingColor) {
                    maximizingScore += value;
                } else {
                    opponentScore += value;
                }
            }
        }
    }

    // 2. Evaluate Pieces in Pocket (Slightly boosted to encourage hoarding and dynamic dropping!)
    for (const pieceType of gameState.pocket[maximizingColor]) {
        maximizingScore += PIECE_VALUES[pieceType] * 1.1; // Hand pieces have immense tactical value in crazyhouse variants
    }
    for (const pieceType of gameState.pocket[opponentColor]) {
        opponentScore += PIECE_VALUES[pieceType] * 1.1;
    }

    // 3. Anti-Repetition Penalty (Break "Perpetual Check" Loops)
    // If a player just reversed their immediate previous move, heavily penalize their score natively
    const history = gameState.moveHistory;
    if (history.length >= 4) {
        const lastAction = history[history.length - 1]; // Move just played by 'lastPlayer'
        const prevAction = history[history.length - 3]; // The same player's move before that

        // Check if the last move mathematically reversed the previous positional vector
        if (
            lastAction.type === "move" &&
            prevAction.type === "move" &&
            lastAction.from?.row === prevAction.to.row &&
            lastAction.from?.col === prevAction.to.col &&
            lastAction.to.row === prevAction.from?.row &&
            lastAction.to.col === prevAction.from?.col
        ) {
            // The player who played `lastAction` is the one whose turn it is NOT right now
            const lastPlayer = gameState.turn === "white" ? "black" : "white";

            if (lastPlayer === maximizingColor) {
                maximizingScore -= 800; // -800 points forces the Bot to seek creative alternate attacks natively
            } else {
                opponentScore -= 800;
            }
        }
    }

    return maximizingScore - opponentScore;
}

// Helper: Move Ordering to optimize Alpha-Beta Pruning (MVV-LVA and Heuristics)
function orderMoves(actions: GameAction[], gameState: GameState): GameAction[] {
    const scoredActions = actions.map((action) => {
        let score = 0;

        if (action.type === "move") {
            const attacker = gameState.board[action.from!.row][action.from!.col];
            const victim = gameState.board[action.to.row][action.to.col];

            if (victim) {
                // Capture: MVV-LVA (Most Valuable Victim - Least Valuable Attacker)
                score +=
                    10000 +
                    PIECE_VALUES[victim.type] * 10 -
                    (attacker ? PIECE_VALUES[attacker.type] : 0);
            }

            if (action.promotion) {
                score += 8000 + PIECE_VALUES[action.promotion];
            }

            // Positional Bonus for quiet moves
            if (!victim && !action.promotion && attacker) {
                const isWhite = attacker.color === "white";
                const fromRank = isWhite ? action.from!.row : 5 - action.from!.row;
                const toRank = isWhite ? action.to.row : 5 - action.to.row;
                const pstDiff =
                    PST_MIDGAME[attacker.type][toRank][action.to.col] -
                    PST_MIDGAME[attacker.type][fromRank][action.from!.col];
                score += pstDiff;
            }
        } else if (action.type === "drop") {
            // Drops are highly dynamic threats
            score += 5000 + PIECE_VALUES[action.pieceType!];
        }

        return { action, score };
    });

    // Sort descending by score
    scoredActions.sort((a, b) => b.score - a.score);

    return scoredActions.map((sa) => sa.action);
}

// Recursive Minimax with Alpha-Beta Pruning
function minimax(
    engine: GameEngine,
    depth: number,
    alpha: number,
    beta: number,
    isMaximizingPlayer: boolean,
    maximizingColor: PlayerColor,
    endTime: number,
): number {
    if (Date.now() > endTime) return 0; // Fallback if out of time

    const currentState = engine.getState();

    // Base Case: Win/Loss
    if (currentState.isGameOver) {
        if (currentState.winner === "draw") return 0;
        return currentState.winner === maximizingColor ? 9999 : -9999;
    }

    // Base Case: Depth limit reached
    if (depth === 0) {
        return evaluateBoard(currentState, maximizingColor);
    }

    const currentColor = currentState.turn;
    const legalActions = orderMoves(
        engine.getAllLegalActions(currentState),
        currentState,
    );

    // If no legal moves but game not over (e.g. stalemate edge cases), evaluate
    if (legalActions.length === 0) {
        return evaluateBoard(currentState, maximizingColor);
    }

    if (isMaximizingPlayer) {
        let maxEval = -Infinity;
        for (const action of legalActions) {
            // INSTANTLY abort sibling tree execution if time has expired, saving hundreds of thousands of clone-engine cycles
            if (Date.now() > endTime) return 0;

            // Deep clone engine safely via states
            const clonedEngine = new GameEngine(engine.getState());
            clonedEngine.applyAction(action);

            const evaluate = minimax(
                clonedEngine,
                depth - 1,
                alpha,
                beta,
                false,
                maximizingColor,
                endTime,
            );
            maxEval = Math.max(maxEval, evaluate);
            alpha = Math.max(alpha, evaluate);
            if (beta <= alpha) break; // Prune
        }
        return maxEval;
    } else {
        let minEval = Infinity;
        for (const action of legalActions) {
            if (Date.now() > endTime) return 0;

            const clonedEngine = new GameEngine(engine.getState());
            clonedEngine.applyAction(action);

            const evaluate = minimax(
                clonedEngine,
                depth - 1,
                alpha,
                beta,
                true,
                maximizingColor,
                endTime,
            );
            minEval = Math.min(minEval, evaluate);
            beta = Math.min(beta, evaluate);
            if (beta <= alpha) break; // Prune
        }
        return minEval;
    }
}

export async function calculateBotAction(
    currentEngine: GameEngine,
    botColor: PlayerColor,
    customDepth?: number,
): Promise<GameAction | null> {
    const depth = customDepth ?? gameConfig.botParams.botDifficultyDepth;
    const legalActions = orderMoves(
        currentEngine.getAllLegalActions(currentEngine.getState()),
        currentEngine.getState(),
    );

    if (legalActions.length === 0) {
        return null;
    }

    // Track all evaluated actions to inject human error
    interface ScoredAction {
        action: GameAction;
        score: number;
    }
    const evaluatedActions: ScoredAction[] = [];

    const endTime = Date.now() + (gameConfig.botParams.botMaxThinkTimeMs || 5000);

    let loopCounter = 0;
    // Simulate each action to find the best immediate branch
    for (const action of legalActions) {
        if (Date.now() > endTime) break;

        // Yield to the React Native JS event loop every 4th top-level branch to prevent
        // the UI thread (including the game timer) from freezing while calculating 10,000+ nodes
        if (loopCounter++ % 4 === 0) {
            await new Promise((resolve) => setTimeout(resolve, 0));
        }

        const clonedEngine = new GameEngine(currentEngine.getState());
        clonedEngine.applyAction(action);

        // After bot's move, it is the opponent's turn, so isMaximizingPlayer is false for the next depth
        const score = minimax(
            clonedEngine,
            depth - 1,
            -Infinity,
            Infinity,
            false,
            botColor,
            endTime,
        );

        // Terminate evaluation immediately tracking strictly completed paths!
        // We MUST NOT dynamically map corrupt `0` abort-states back onto execution trees.
        if (Date.now() > endTime) break;

        evaluatedActions.push({ action, score });
    }

    // Sort descending by score to rank the best moves
    evaluatedActions.sort((a, b) => b.score - a.score);

    let bestAction: GameAction | null = null;

    if (evaluatedActions.length > 0) {
        if (evaluatedActions.length >= 2) {
            // All Depths (Easy, Medium, Hard): 75% Chance 1st Best, 25% Chance 2nd Best
            let probabilityBest = 0.75;

            const roll = Math.random();
            if (roll < probabilityBest) {
                bestAction = evaluatedActions[0].action; // Selected 1st Best
            } else {
                bestAction = evaluatedActions[1].action; // Selected 2nd Best
            }
        } else {
            // Only 1 strictly legal move fully evaluated before timeout
            bestAction = evaluatedActions[0].action;
        }
    } else if (legalActions.length > 0) {
        // CRITICAL FALLBACK: If time expired before evaluating EVEN ONE FULL branch,
        // evaluatedActions remains empty. We MUST NOT return null and abandon the turn.
        // We fall back to the naturally heuristics-ordered absolute best first legal action.
        bestAction = legalActions[0];
    }

    if (bestAction) {
        // Intercept Pawn Promotion for Bot (No Queens)
        if (bestAction.type === "move") {
            const piece =
                currentEngine.getState().board[bestAction.from.row][
                bestAction.from.col
                ];
            if (piece && piece.type === "P") {
                const promotionRank = piece.color === "white" ? 0 : 5;
                if (bestAction.to.row === promotionRank) {
                    const promotionChoices: PieceType[] = ["R", "B", "N"];
                    bestAction.promotion =
                        promotionChoices[
                        Math.floor(Math.random() * promotionChoices.length)
                        ];
                }
            }
        }

        return bestAction;
    }

    return null;
}
