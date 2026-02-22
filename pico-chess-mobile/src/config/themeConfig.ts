export interface ThemeConfig {
    background: string;
    board: {
        lightSquare: string;
        darkSquare: string;
        highlight: string;
        shadow: string; // 2.5D board depth
    };
    piece: {
        whiteFill: string;
        whiteStroke: string;
        blackFill: string;
        blackStroke: string;
        shadow: string; // 2.5D piece depth
    };
    ui: {
        textDark: string;
        textLight: string;
        pocketBackground: string;
    }
}

export const defaultTheme: ThemeConfig = {
    background: '#588b77', // Clean green from the screenshot
    board: {
        lightSquare: '#f3e3ad', // Bright tan
        darkSquare: '#c8aa62',  // Darker tan
        highlight: 'rgba(255, 255, 255, 0.4)', // Legal move dot color
        shadow: '#314e41',      // Board edge shadow
    },
    piece: {
        whiteFill: '#f8f8f8',
        whiteStroke: '#555555',
        blackFill: '#383b42',
        blackStroke: '#1a1b1f',
        shadow: 'rgba(0, 0, 0, 0.5)',
    },
    ui: {
        textDark: '#222222',
        textLight: '#ffffff',
        pocketBackground: 'rgba(0, 0, 0, 0.15)',
    }
};
