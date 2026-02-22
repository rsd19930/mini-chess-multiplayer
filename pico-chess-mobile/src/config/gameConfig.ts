export const gameConfig = {
    boardParams: {
        rows: 6,
        cols: 6,
    },
    timers: {
        turnTimeMs: 30000,
        matchmakingTimeoutMs: 30000,
    },
    initialSetup: {
        white: {
            K: { row: 0, col: 0 }, // a1
            R: { row: 0, col: 1 }, // b1
            N: { row: 0, col: 2 }, // c1
            B: { row: 0, col: 3 }, // d1
            P: { row: 1, col: 0 }, // a2
        },
        black: {
            K: { row: 5, col: 5 }, // f6
            R: { row: 5, col: 4 }, // e6
            N: { row: 5, col: 3 }, // d6
            B: { row: 5, col: 2 }, // c6
            P: { row: 4, col: 5 }, // f5
        }
    },
    botParams: {
        name: 'Picobot',
        botDifficultyDepth: 2,
        botMaxThinkTimeMs: 5000,
    }
};
