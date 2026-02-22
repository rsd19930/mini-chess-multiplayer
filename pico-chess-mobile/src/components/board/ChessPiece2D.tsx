import React from 'react';
import { View, StyleSheet } from 'react-native';
import { PieceType, PlayerColor } from '../../types';

// Import our newly generated pure SVG components
import { KingWhite } from '../pieces/KingWhite';
import { KingBlack } from '../pieces/KingBlack';
import { RookWhite } from '../pieces/RookWhite';
import { RookBlack } from '../pieces/RookBlack';
import { BishopWhite } from '../pieces/BishopWhite';
import { BishopBlack } from '../pieces/BishopBlack';
import { KnightWhite } from '../pieces/KnightWhite';
import { KnightBlack } from '../pieces/KnightBlack';
import { PawnWhite } from '../pieces/PawnWhite';
import { PawnBlack } from '../pieces/PawnBlack';

interface PieceProps {
    type: PieceType;
    color: PlayerColor;
    size: number;
}

export const ChessPiece2D: React.FC<PieceProps> = ({ type, color, size }) => {
    const isWhite = color === 'white';

    const renderIcon = () => {
        switch (type) {
            case 'K':
                return isWhite ? <KingWhite /> : <KingBlack />;
            case 'R':
                return isWhite ? <RookWhite /> : <RookBlack />;
            case 'B':
                return isWhite ? <BishopWhite /> : <BishopBlack />;
            case 'N':
                return isWhite ? <KnightWhite /> : <KnightBlack />;
            case 'P':
                return isWhite ? <PawnWhite /> : <PawnBlack />;
            default:
                return null;
        }
    };

    return (
        <View style={[styles.container, { width: size, height: size }]}>
            {renderIcon()}
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        justifyContent: 'center',
        alignItems: 'center',
    }
});
