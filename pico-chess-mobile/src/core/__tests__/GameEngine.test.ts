import { GameEngine } from '../GameEngine';
import { GameState } from '../../types';

describe('GameEngine - Pico Chess', () => {
    const createEmptyBoard = () => Array(6).fill(null).map(() => Array(6).fill(null));

    it('White Pawn moves forward (decreases row) and promotes at row 0', () => {
        const board = createEmptyBoard();
        board[5][0] = { type: 'K', color: 'white' };
        board[0][5] = { type: 'K', color: 'black' };
        board[1][0] = { type: 'P', color: 'white' }; // a2 equivalent

        const engine = new GameEngine({
            board,
            turn: 'white',
            pocket: { white: [], black: [] },
            moveHistory: [],
            isGameOver: false,
            winner: null,
            winReason: null,
            inCheck: false,
            pendingPromotion: false
        });

        const newState = engine.applyAction({
            type: 'move',
            from: { row: 1, col: 0 },
            to: { row: 0, col: 0 }
        });

        expect(newState.board[0][0]).toEqual({
            type: 'P',
            color: 'white'
        });
        expect(newState.board[1][0]).toBeNull();
        expect(newState.pendingPromotion).toBe(true);
    });

    it('Black Pawn moves forward (increases row) and promotes at row 5', () => {
        const board = createEmptyBoard();
        board[5][5] = { type: 'K', color: 'white' }; // Move White King out of the way
        board[0][5] = { type: 'K', color: 'black' };
        board[4][0] = { type: 'P', color: 'black' }; // a5 equivalent

        const engine = new GameEngine({
            board,
            turn: 'black',
            pocket: { white: [], black: [] },
            moveHistory: [],
            isGameOver: false,
            winner: null,
            inCheck: false
        });

        const newState = engine.applyAction({
            type: 'move',
            from: { row: 4, col: 0 },
            to: { row: 5, col: 0 }
        });

        expect(newState.board[5][0]).toEqual({
            type: 'P',
            color: 'black'
        });
        expect(newState.board[4][0]).toBeNull();
        expect(newState.pendingPromotion).toBe(true);
    });

    it('Executes Crazyhouse drop for a checkmate', () => {
        const board = createEmptyBoard();
        // Trap the Black King in the corner using its own pieces
        board[0][5] = { type: 'K', color: 'black' };
        board[0][4] = { type: 'R', color: 'black' }; // Blocks escape to 0,4
        board[1][5] = { type: 'P', color: 'black' }; // Blocks escape to 1,5
        board[1][4] = { type: 'B', color: 'black' }; // Blocks escape to 1,4

        board[5][5] = { type: 'K', color: 'white' }; // White King safely away from Black Bishop's diagonal

        const engine = new GameEngine({
            board,
            turn: 'white',
            pocket: { white: ['N'], black: [] },
            moveHistory: [],
            isGameOver: false,
            winner: null,
            inCheck: false
        });

        // Drop Knight at 1,3 -> attacks 0,5 (Knight jump: row -1, col +2)
        // Black King goes into Checkmate, no escapes, no pieces to capture the Knight
        const newState = engine.applyAction({
            type: 'drop',
            pieceType: 'N',
            to: { row: 1, col: 3 }
        });

        expect(newState.board[1][3]).toEqual({ type: 'N', color: 'white', isPromoted: false });
        expect(newState.isGameOver).toBe(true);
        expect(newState.winner).toBe('white');
    });

    it('Detects stalemate as a loss for the stalemated player', () => {
        const board = createEmptyBoard();
        board[0][0] = { type: 'K', color: 'black' };
        board[2][1] = { type: 'R', color: 'white' }; // Covers col 1
        board[1][2] = { type: 'R', color: 'white' }; // Covers row 1
        board[5][5] = { type: 'K', color: 'white' };

        const engine = new GameEngine({
            board,
            turn: 'white',
            pocket: { white: [], black: [] },
            moveHistory: [],
            isGameOver: false,
            winner: null,
            inCheck: false
        });

        // Move White King to pass the turn back to Black.
        // The previous state does not place Black in check.
        const newState = engine.applyAction({
            type: 'move',
            from: { row: 5, col: 5 },
            to: { row: 5, col: 4 }
        });

        // Black is now to move. Black King is on 0,0.
        // Is it in check? No.
        // Attacked escapes?
        // 0,1 -> attacked by R at 2,1
        // 1,0 -> attacked by R at 1,2
        // 1,1 -> attacked by R at 1,2 and R at 2,1
        expect(newState.isGameOver).toBe(true);

        // According to Pico Chess rule: Stalemated player loses
        // Because it is Black's turn and Black has no legal moves, Black loses.
        // Therefore White is the winner.
        expect(newState.winner).toBe('white');
    });
});
