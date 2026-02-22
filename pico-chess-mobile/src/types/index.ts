export type PieceType = 'K' | 'R' | 'N' | 'B' | 'P';
export type PlayerColor = 'white' | 'black';

export interface Piece {
    type: PieceType;
    color: PlayerColor;
    isPromoted?: boolean;
}

export interface Position {
    row: number; // 0 to 5
    col: number; // 0 to 5
}

export interface Move {
    type: 'move';
    from: Position;
    to: Position;
    promotion?: PieceType; // 'R' | 'N' | 'B'
}

export interface Drop {
    type: 'drop';
    pieceType: PieceType;
    to: Position;
}

export type GameAction = Move | Drop;

export type WinReason = 'Checkmate' | 'Stalemate' | 'Resignation' | 'Turn Skipped' | null;

export interface GameState {
    board: (Piece | null)[][];
    turn: PlayerColor;
    pocket: {
        white: PieceType[];
        black: PieceType[];
    };
    moveHistory: GameAction[];
    isGameOver: boolean;
    winner: PlayerColor | 'draw' | null;
    winReason?: WinReason;
    inCheck: boolean;
    pendingPromotion?: boolean;
}
