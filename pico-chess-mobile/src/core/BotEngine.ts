import { GameEngine } from './GameEngine';
import { GameAction, PlayerColor, GameState, PieceType } from '../types';
import { gameConfig } from '../config/gameConfig';

const PIECE_VALUES: Record<PieceType, number> = {
    'P': 10,
    'N': 30,
    'B': 30,
    'R': 50,
    'K': 900
};

// Evaluate the board from the perspective of the maximizingColor
function evaluateBoard(gameState: GameState, maximizingColor: PlayerColor): number {
    let maximizingScore = 0;
    let opponentScore = 0;
    const opponentColor = maximizingColor === 'white' ? 'black' : 'white';

    // 1. Evaluate Pieces on Board
    for (let r = 0; r < 6; r++) {
        for (let c = 0; c < 6; c++) {
            const piece = gameState.board[r][c];
            if (piece) {
                const value = PIECE_VALUES[piece.type];
                if (piece.color === maximizingColor) {
                    maximizingScore += value;
                } else {
                    opponentScore += value;
                }
            }
        }
    }

    // 2. Evaluate Pieces in Pocket
    for (const pieceType of gameState.pocket[maximizingColor]) {
        maximizingScore += PIECE_VALUES[pieceType];
    }
    for (const pieceType of gameState.pocket[opponentColor]) {
        opponentScore += PIECE_VALUES[pieceType];
    }

    return maximizingScore - opponentScore;
}

// Recursive Minimax with Alpha-Beta Pruning
function minimax(
    engine: GameEngine,
    depth: number,
    alpha: number,
    beta: number,
    isMaximizingPlayer: boolean,
    maximizingColor: PlayerColor,
    endTime: number
): number {
    if (Date.now() > endTime) return 0; // Fallback if out of time

    const currentState = engine.getState();

    // Base Case: Win/Loss
    if (currentState.isGameOver) {
        if (currentState.winner === 'draw') return 0;
        return currentState.winner === maximizingColor ? 9999 : -9999;
    }

    // Base Case: Depth limit reached
    if (depth === 0) {
        return evaluateBoard(currentState, maximizingColor);
    }

    const currentColor = currentState.turn;
    const legalActions = engine.getAllLegalActions(currentState);

    // If no legal moves but game not over (e.g. stalemate edge cases), evaluate
    if (legalActions.length === 0) {
        return evaluateBoard(currentState, maximizingColor);
    }

    if (isMaximizingPlayer) {
        let maxEval = -Infinity;
        for (const action of legalActions) {
            // Deep clone engine safely via states
            const clonedEngine = new GameEngine(engine.getState());
            clonedEngine.applyAction(action);

            const evaluate = minimax(clonedEngine, depth - 1, alpha, beta, false, maximizingColor, endTime);
            maxEval = Math.max(maxEval, evaluate);
            alpha = Math.max(alpha, evaluate);
            if (beta <= alpha) break; // Prune
        }
        return maxEval;
    } else {
        let minEval = Infinity;
        for (const action of legalActions) {
            const clonedEngine = new GameEngine(engine.getState());
            clonedEngine.applyAction(action);

            const evaluate = minimax(clonedEngine, depth - 1, alpha, beta, true, maximizingColor, endTime);
            minEval = Math.min(minEval, evaluate);
            beta = Math.min(beta, evaluate);
            if (beta <= alpha) break; // Prune
        }
        return minEval;
    }
}

export async function calculateBotAction(currentEngine: GameEngine, botColor: PlayerColor): Promise<GameAction | null> {
    const depth = gameConfig.botParams.botDifficultyDepth;
    const legalActions = currentEngine.getAllLegalActions(currentEngine.getState());

    if (legalActions.length === 0) {
        return null;
    }

    let bestScore = -Infinity;
    let bestActions: GameAction[] = [];
    const endTime = Date.now() + (gameConfig.botParams.botMaxThinkTimeMs || 5000);

    // Simulate each action to find the best immediate branch
    for (const action of legalActions) {
        if (Date.now() > endTime) break;

        const clonedEngine = new GameEngine(currentEngine.getState());
        clonedEngine.applyAction(action);

        // After bot's move, it is the opponent's turn, so isMaximizingPlayer is false for the next depth
        const score = minimax(clonedEngine, depth - 1, -Infinity, Infinity, false, botColor, endTime);

        if (score > bestScore) {
            bestScore = score;
            bestActions = [action];
        } else if (score === bestScore) {
            bestActions.push(action);
        }
    }

    // Return a random action from the best ones to add slight variance
    if (bestActions.length > 0) {
        const randomIndex = Math.floor(Math.random() * bestActions.length);
        return bestActions[randomIndex];
    }

    return null;
}
