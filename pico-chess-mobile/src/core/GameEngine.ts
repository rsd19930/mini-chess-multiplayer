import { GameState, GameAction, Move, Drop, Piece, Position, PieceType, PlayerColor } from '../types';

export class GameEngine {
    private state: GameState;

    constructor(initialState?: GameState) {
        if (initialState) {
            this.state = this.cloneState(initialState);
        } else {
            this.state = this.createInitialState();
        }
    }

    public getState(): GameState {
        return this.cloneState(this.state);
    }

    public setState(newState: GameState): void {
        this.state = this.cloneState(newState);
    }

    private cloneState(state: GameState): GameState {
        return JSON.parse(JSON.stringify(state));
    }

    private createInitialState(): GameState {
        const rows = 6;
        const cols = 6;
        const board: (Piece | null)[][] = Array(rows)
            .fill(null)
            .map(() => Array(cols).fill(null));

        // White Initial Setup (Bottom Rows)
        board[5][0] = { type: 'K', color: 'white' };
        board[5][1] = { type: 'R', color: 'white' };
        board[5][2] = { type: 'N', color: 'white' };
        board[5][3] = { type: 'B', color: 'white' };
        board[4][0] = { type: 'P', color: 'white' };

        // Black Initial Setup (Top Rows)
        board[0][5] = { type: 'K', color: 'black' };
        board[0][4] = { type: 'R', color: 'black' };
        board[0][3] = { type: 'N', color: 'black' };
        board[0][2] = { type: 'B', color: 'black' };
        board[1][5] = { type: 'P', color: 'black' };

        return {
            board,
            turn: 'white',
            pocket: { white: [], black: [] },
            moveHistory: [],
            isGameOver: false,
            winner: null,
            winReason: null,
            inCheck: false,
            last_move_timestamp: Date.now(),
        };
    }

    private isWithinBounds(r: number, c: number): boolean {
        return r >= 0 && r < 6 && c >= 0 && c < 6;
    }

    public getAllLegalActions(state: GameState = this.state): GameAction[] {
        if (state.pendingPromotion) return [];

        const actions: GameAction[] = [];
        const color = state.turn;

        // Generate moves
        for (let r = 0; r < 6; r++) {
            for (let c = 0; c < 6; c++) {
                const piece = state.board[r][c];
                if (piece && piece.color === color) {
                    const pseudoMoves = this.getPiecePseudoLegalMoves(state, { row: r, col: c }, piece);
                    for (const move of pseudoMoves) {
                        if (this.isActionLegalStrict(state, move)) {
                            actions.push(move);
                        }
                    }
                }
            }
        }

        // Generate drops
        const pocket = state.pocket[color];
        const uniquePieces = Array.from(new Set(pocket));
        for (const pieceType of uniquePieces) {
            for (let r = 0; r < 6; r++) {
                // Pawn Cannot drop on rank 1 or 6
                if (pieceType === 'P' && (r === 0 || r === 5)) {
                    continue;
                }
                for (let c = 0; c < 6; c++) {
                    if (state.board[r][c] === null) {
                        const drop: Drop = { type: 'drop', pieceType, to: { row: r, col: c } };
                        if (this.isActionLegalStrict(state, drop)) {
                            actions.push(drop);
                        }
                    }
                }
            }
        }

        return actions;
    }

    public isLegalAction(action: GameAction): boolean {
        if (this.state.isGameOver) return false;

        // Fast check if action is pseudo legal
        const legalActions = this.getAllLegalActions(this.state);
        return legalActions.some(a => this.actionsEqual(a, action));
    }

    private actionsEqual(a: GameAction, b: GameAction): boolean {
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
    }

    // Verifies an action doesn't leave the king in check
    private isActionLegalStrict(state: GameState, action: GameAction): boolean {
        const nextState = this.simulateAction(state, action);
        return !this.isKingInCheck(nextState, state.turn);
    }

    public applyAction(action: GameAction): GameState {
        if (!this.isLegalAction(action)) {
            throw new Error('Illegal game action.');
        }

        const nextState = this.simulateAction(this.state, action);
        nextState.moveHistory.push(action);

        let shouldToggleTurn = true;

        // Handle pending promotion strictly in the state
        nextState.pendingPromotion = false;
        if (action.type === 'move') {
            const movedPiece = nextState.board[action.to.row][action.to.col];
            if (movedPiece && movedPiece.type === 'P') {
                const promotionRank = movedPiece.color === 'white' ? 0 : 5;
                if (action.to.row === promotionRank) {
                    nextState.pendingPromotion = true;
                    shouldToggleTurn = false;
                }
            }
        }

        if (shouldToggleTurn) {
            nextState.turn = nextState.turn === 'white' ? 'black' : 'white';
            nextState.inCheck = this.isKingInCheck(nextState, nextState.turn);
            this.checkGameEndLogic(nextState);
        }

        if (!nextState.pendingPromotion) {
            nextState.last_move_timestamp = Date.now();
        }
        this.state = nextState;

        return this.getState();
    }

    public executePromotion(pieceType: PieceType): GameState {
        if (!this.state.pendingPromotion) {
            throw new Error('No pending promotion.');
        }

        const promotingColor = this.state.turn;
        const promotionRank = promotingColor === 'white' ? 0 : 5;

        // Find the pawn on the promotion rank
        let pawnPos: Position | null = null;
        for (let c = 0; c < 6; c++) {
            const p = this.state.board[promotionRank][c];
            if (p && p.type === 'P' && p.color === promotingColor) {
                pawnPos = { row: promotionRank, col: c };
                break;
            }
        }

        if (!pawnPos) {
            throw new Error('Could not find pawn to promote.');
        }

        const nextState = this.cloneState(this.state);
        nextState.board[pawnPos.row][pawnPos.col] = {
            type: pieceType,
            color: promotingColor,
            isPromoted: true
        };

        nextState.pendingPromotion = false;

        nextState.turn = nextState.turn === 'white' ? 'black' : 'white';
        nextState.inCheck = this.isKingInCheck(nextState, nextState.turn);
        this.checkGameEndLogic(nextState);

        nextState.last_move_timestamp = Date.now();
        this.state = nextState;
        return this.getState();
    }

    // Pure function to apply action without turn-toggle or game-over checking
    private simulateAction(state: GameState, action: GameAction): GameState {
        const nextState = this.cloneState(state);

        if (action.type === 'move') {
            const { from, to, promotion } = action;
            const piece = nextState.board[from.row][from.col]!;
            const target = nextState.board[to.row][to.col];

            if (target) {
                const capturedType = target.type;
                nextState.pocket[piece.color].push(capturedType);
            }

            nextState.board[from.row][from.col] = null;

            if (promotion) {
                nextState.board[to.row][to.col] = { type: promotion, color: piece.color, isPromoted: true };
            } else {
                nextState.board[to.row][to.col] = piece;
            }
        } else if (action.type === 'drop') {
            const { to, pieceType } = action;
            const pocket = nextState.pocket[nextState.turn];
            const idx = pocket.indexOf(pieceType);
            if (idx !== -1) pocket.splice(idx, 1);

            nextState.board[to.row][to.col] = {
                type: pieceType,
                color: nextState.turn,
                isPromoted: false
            };
        }

        return nextState;
    }

    private checkGameEndLogic(state: GameState) {
        const legalActions = this.getAllLegalActions(state);

        if (legalActions.length === 0) {
            state.isGameOver = true;

            if (state.inCheck) {
                // Checkmate
                state.winner = state.turn === 'white' ? 'black' : 'white';
                state.winReason = 'Checkmate';
            } else {
                // Stalemate: In Pico Chess, a stalemated player LOSES the game.
                state.winner = state.turn === 'white' ? 'black' : 'white';
                state.winReason = 'Stalemate';
            }
        }
    }

    public resign(color: PlayerColor, reason: string = 'Resignation'): GameState {
        const nextState = this.cloneState(this.state);
        nextState.isGameOver = true;
        nextState.winner = color === 'white' ? 'black' : 'white';
        nextState.winReason = reason as any;
        this.state = nextState;
        return this.getState();
    }

    public resetState(): GameState {
        this.state = this.createInitialState();
        return this.getState();
    }

    private getPiecePseudoLegalMoves(state: GameState, from: Position, piece: Piece): Move[] {
        const moves: Move[] = [];
        const color = piece.color;
        const opponent = color === 'white' ? 'black' : 'white';

        const addMove = (r: number, c: number, checkCapture: boolean = true) => {
            if (!this.isWithinBounds(r, c)) return false; // Stop sliding
            const target = state.board[r][c];

            if (target === null) {
                this.addPossiblePromotions(moves, from, { row: r, col: c }, piece);
                return true; // Can keep sliding
            } else if (target.color === opponent && checkCapture) {
                this.addPossiblePromotions(moves, from, { row: r, col: c }, piece);
                return false; // Captured, stop sliding
            }
            return false; // Blocked by own piece, stop sliding
        };

        if (piece.type === 'R') {
            const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
            for (const [dr, dc] of dirs) {
                let r = from.row + dr;
                let c = from.col + dc;
                while (addMove(r, c)) {
                    r += dr;
                    c += dc;
                }
            }
        } else if (piece.type === 'B') {
            const dirs = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
            for (const [dr, dc] of dirs) {
                let r = from.row + dr;
                let c = from.col + dc;
                while (addMove(r, c)) {
                    r += dr;
                    c += dc;
                }
            }
        } else if (piece.type === 'N') {
            const jumps = [[2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [1, -2], [-1, 2], [-1, -2]];
            for (const [dr, dc] of jumps) addMove(from.row + dr, from.col + dc);
        } else if (piece.type === 'K') {
            const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
            for (const [dr, dc] of dirs) addMove(from.row + dr, from.col + dc);
        } else if (piece.type === 'P') {
            const dir = color === 'white' ? -1 : 1;
            // Forward
            if (this.isWithinBounds(from.row + dir, from.col)) {
                if (state.board[from.row + dir][from.col] === null) {
                    this.addPossiblePromotions(moves, from, { row: from.row + dir, col: from.col }, piece);
                }
            }
            // Captures
            for (const dc of [-1, 1]) {
                if (this.isWithinBounds(from.row + dir, from.col + dc)) {
                    const target = state.board[from.row + dir][from.col + dc];
                    if (target && target.color === opponent) {
                        this.addPossiblePromotions(moves, from, { row: from.row + dir, col: from.col + dc }, piece);
                    }
                }
            }
        }

        return moves;
    }

    private addPossiblePromotions(moves: Move[], from: Position, to: Position, piece: Piece) {
        // Halt Auto-Promotion to Rooks per user request. Leave as a pawn.
        moves.push({ type: 'move', from, to });
    }

    private isKingInCheck(state: GameState, color: PlayerColor): boolean {
        // Find King
        let kingPos: Position | null = null;
        for (let r = 0; r < 6; r++) {
            for (let c = 0; c < 6; c++) {
                const p = state.board[r][c];
                if (p && p.type === 'K' && p.color === color) {
                    kingPos = { row: r, col: c };
                    break;
                }
            }
            if (kingPos) break;
        }

        if (!kingPos) return false;

        // Is Square Attacked?
        return this.isSquareAttacked(state, kingPos, color === 'white' ? 'black' : 'white');
    }

    private isSquareAttacked(state: GameState, pos: Position, byColor: PlayerColor): boolean {
        // To check if a square is attacked, we assume the opponent is generating moves
        for (let r = 0; r < 6; r++) {
            for (let c = 0; c < 6; c++) {
                const piece = state.board[r][c];
                if (piece && piece.color === byColor) {
                    const pseudoMoves = this.getPiecePseudoLegalMoves(state, { row: r, col: c }, piece);
                    if (pseudoMoves.some(m => m.to.row === pos.row && m.to.col === pos.col)) {
                        return true;
                    }
                }
            }
        }
        return false;
    }
}
