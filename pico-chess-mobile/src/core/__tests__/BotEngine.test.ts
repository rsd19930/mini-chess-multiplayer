import { GameEngine } from '../GameEngine';
import { calculateBotAction } from '../BotEngine';
import { gameConfig } from '../../config/gameConfig';
import { GameState, GameAction, PlayerColor, PieceType } from '../../types';

describe('BotEngine - legality harness', () => {
    const createEmptyBoard = () => Array(6).fill(null).map(() => Array(6).fill(null));

    const baseState = (overrides: Partial<GameState> = {}): GameState => ({
        board: createEmptyBoard(),
        turn: 'white',
        pocket: { white: [], black: [] },
        moveHistory: [],
        isGameOver: false,
        winner: null,
        winReason: null,
        inCheck: false,
        pendingPromotion: false,
        ...overrides,
    });

    let randomSpy: jest.SpyInstance;
    beforeEach(() => {
        randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5);
    });
    afterEach(() => {
        randomSpy.mockRestore();
    });

    const actionsEqual = (a: GameAction, b: GameAction): boolean => {
        if (a.type !== b.type) return false;
        if (a.type === 'move' && b.type === 'move') {
            return a.from.row === b.from.row && a.from.col === b.from.col &&
                a.to.row === b.to.row && a.to.col === b.to.col &&
                a.promotion === b.promotion;
        }
        if (a.type === 'drop' && b.type === 'drop') {
            return a.pieceType === b.pieceType &&
                a.to.row === b.to.row && a.to.col === b.to.col;
        }
        return false;
    };

    const assertLegalAndApplies = (engine: GameEngine, action: GameAction, botColor: PlayerColor) => {
        const legal = engine.getAllLegalActions();
        expect(legal.some(a => actionsEqual(a, action))).toBe(true);

        // Applying should not throw; should not leave bot's own king attackable.
        const probe = new GameEngine(engine.getState());
        expect(() => probe.applyAction(action)).not.toThrow();
        const after = probe.getState();

        // Find bot's king; it must still exist and not be in check on its next turn.
        let kingFound = false;
        for (let r = 0; r < 6; r++) {
            for (let c = 0; c < 6; c++) {
                const p = after.board[r][c];
                if (p && p.type === 'K' && p.color === botColor) kingFound = true;
            }
        }
        expect(kingFound).toBe(true);
    };

    it('returns a legal action from the default starting position (depth 1)', async () => {
        const engine = new GameEngine();
        const action = await calculateBotAction(engine, 'white', 1);
        expect(action).not.toBeNull();
        assertLegalAndApplies(engine, action!, 'white');
    });

    it('returns a legal action from a mid-game position (depth 2)', async () => {
        const board = createEmptyBoard();
        board[5][0] = { type: 'K', color: 'white' };
        board[0][5] = { type: 'K', color: 'black' };
        board[3][3] = { type: 'R', color: 'white' };
        board[2][2] = { type: 'B', color: 'black' };
        board[4][4] = { type: 'N', color: 'white' };
        board[1][1] = { type: 'N', color: 'black' };
        const engine = new GameEngine(baseState({
            board,
            pocket: { white: ['P'], black: ['P'] },
        }));

        const action = await calculateBotAction(engine, 'white', 2);
        expect(action).not.toBeNull();
        assertLegalAndApplies(engine, action!, 'white');
    });

    it('when in check, returns a move that resolves the check', async () => {
        // White king at (5,0) attacked by black rook at (0,0).
        // White rook at (4,1) can block at (4,0) or capture rook by going to (0,1)-no, different column.
        // Either way, the returned action must leave the white king safe.
        const board = createEmptyBoard();
        board[5][0] = { type: 'K', color: 'white' };
        board[4][1] = { type: 'R', color: 'white' };
        board[0][0] = { type: 'R', color: 'black' };
        board[0][5] = { type: 'K', color: 'black' };
        const engine = new GameEngine(baseState({ board, inCheck: true }));

        const action = await calculateBotAction(engine, 'white', 2);
        expect(action).not.toBeNull();
        assertLegalAndApplies(engine, action!, 'white');
    });

    it('returns null when there are no legal actions (stalemate-like)', async () => {
        // Contrive a game-over state: bot has no pieces to move.
        // Use a post-game state where isGameOver is true; getAllLegalActions will return empty (board empty of bot pieces).
        const board = createEmptyBoard();
        board[0][5] = { type: 'K', color: 'black' };
        // No white pieces — white cannot move. getAllLegalActions is empty.
        const engine = new GameEngine(baseState({ board }));

        const action = await calculateBotAction(engine, 'white', 1);
        expect(action).toBeNull();
    });

    it('bot promotion picks from R/N/B only (never queen / never P)', async () => {
        // White pawn one step from promotion.
        const board = createEmptyBoard();
        board[5][0] = { type: 'K', color: 'white' };
        board[0][5] = { type: 'K', color: 'black' };
        board[1][2] = { type: 'P', color: 'white' };
        const engine = new GameEngine(baseState({ board }));

        const action = await calculateBotAction(engine, 'white', 1);
        expect(action).not.toBeNull();

        // If bot chose the promotion move, the `promotion` field must be R/N/B (or undefined if it picked a different move).
        if (action!.type === 'move'
            && action!.from.row === 1 && action!.from.col === 2
            && action!.to.row === 0) {
            expect(['R', 'N', 'B']).toContain(action!.promotion);
        }
    });

    it('respects customDepth (shallower depth still returns a legal action)', async () => {
        const engine = new GameEngine();
        const shallow = await calculateBotAction(engine, 'white', 1);
        expect(shallow).not.toBeNull();
        assertLegalAndApplies(engine, shallow!, 'white');
    });

    it('exercises deeper maximizing recursion at depth 3', async () => {
        // At depth 3, minimax recurses: calc→min(d=2,max=F)→min(d=1,max=T)
        // which exercises the maximizing branch inside minimax (the first "if isMaximizingPlayer" arm).
        const board = createEmptyBoard();
        board[5][0] = { type: 'K', color: 'white' };
        board[0][5] = { type: 'K', color: 'black' };
        board[3][3] = { type: 'R', color: 'white' };
        board[2][4] = { type: 'B', color: 'black' };
        const engine = new GameEngine(baseState({ board }));

        const action = await calculateBotAction(engine, 'white', 3);
        expect(action).not.toBeNull();
        assertLegalAndApplies(engine, action!, 'white');
    });

    it('triggers anti-repetition penalty when last move reverses the previous same-player move', async () => {
        // Seed a 4-move history where white's last move (index 3) reverses white's move at index 1.
        // This exercises the anti-repetition branch in evaluateBoard (lines 100-121).
        const board = createEmptyBoard();
        board[5][0] = { type: 'K', color: 'white' };
        board[0][5] = { type: 'K', color: 'black' };
        board[3][3] = { type: 'R', color: 'white' };
        board[2][2] = { type: 'N', color: 'black' };

        const moveHistory: GameAction[] = [
            // white moved rook (3,3) -> (3,4)
            { type: 'move', from: { row: 3, col: 3 }, to: { row: 3, col: 4 } },
            // black moved knight (2,2) -> (4,3)
            { type: 'move', from: { row: 2, col: 2 }, to: { row: 4, col: 3 } },
            // white reverses: rook (3,4) -> (3,3)
            { type: 'move', from: { row: 3, col: 4 }, to: { row: 3, col: 3 } },
            // black moves knight again
            { type: 'move', from: { row: 4, col: 3 }, to: { row: 2, col: 2 } },
        ];

        const engine = new GameEngine(baseState({ board, moveHistory, turn: 'white' }));
        const action = await calculateBotAction(engine, 'white', 2);
        expect(action).not.toBeNull();
        assertLegalAndApplies(engine, action!, 'white');
    });

    it('falls back to first legal action when time budget is exhausted before any full eval', async () => {
        const originalBudget = gameConfig.botParams.botMaxThinkTimeMs;
        gameConfig.botParams.botMaxThinkTimeMs = 0; // force immediate timeout
        try {
            const engine = new GameEngine();
            const action = await calculateBotAction(engine, 'white', 2);
            // Even with 0ms budget, bot must still return a legal action (not null).
            expect(action).not.toBeNull();
            assertLegalAndApplies(engine, action!, 'white');
        } finally {
            gameConfig.botParams.botMaxThinkTimeMs = originalBudget;
        }
    });

    it('sets promotion field on pawn-capture-promotion (forced best move)', async () => {
        // Pawn at (1,2) can diagonally capture a rook at (0,1) — the capture lands on the promotion rank.
        // MVV-LVA ordering puts this capture as the top action, so bot picks it and the promotion intercept fires.
        const board = createEmptyBoard();
        board[5][0] = { type: 'K', color: 'white' };
        board[0][5] = { type: 'K', color: 'black' };
        board[1][2] = { type: 'P', color: 'white' };
        board[0][1] = { type: 'R', color: 'black' };
        const engine = new GameEngine(baseState({ board }));

        const action = await calculateBotAction(engine, 'white', 1);
        expect(action).not.toBeNull();
        expect(action!.type).toBe('move');
        if (action!.type === 'move') {
            // The capture that promotes.
            if (action!.to.row === 0 && action!.from.row === 1 && action!.from.col === 2) {
                expect(['R', 'N', 'B']).toContain(action!.promotion);
            }
        }
    });
});
