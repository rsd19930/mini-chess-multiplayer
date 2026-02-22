import React from 'react';
import { View, StyleSheet, TouchableWithoutFeedback, Text } from 'react-native';
import { PieceType, PlayerColor } from '../../types';
import { ChessPiece2D } from './ChessPiece2D';
import { defaultTheme } from '../../config/themeConfig';

interface PocketProps {
    color: PlayerColor;
    pieces: PieceType[];
    onSelectPiece: (pieceType: PieceType) => void;
    selectedPiece: PieceType | null;
    size: number;
}

export const Pocket: React.FC<PocketProps> = ({ color, pieces, onSelectPiece, selectedPiece, size }) => {
    // Deduplicate for display, we just show one of each type we have
    const uniquePieces = Array.from(new Set(pieces));

    return (
        <View style={[styles.pocketContainer, { height: size + 20 }]}>
            {uniquePieces.map((pt, idx) => {
                const count = pieces.filter((p) => p === pt).length;
                const isSelected = selectedPiece === pt;

                return (
                    <TouchableWithoutFeedback key={`${pt}-${idx}`} onPress={() => onSelectPiece(pt)}>
                        <View style={[
                            styles.pocketSlot,
                            { width: size, height: size },
                            isSelected && styles.selectedSlot
                        ]}>
                            <ChessPiece2D type={pt} color={color} size={size * 0.8} />
                            {count > 1 && (
                                <View style={styles.badge}>
                                    <Text style={styles.badgeText}>{count}</Text>
                                </View>
                            )}
                        </View>
                    </TouchableWithoutFeedback>
                );
            })}
        </View>
    );
};

const styles = StyleSheet.create({
    pocketContainer: {
        flexDirection: 'row',
        backgroundColor: defaultTheme.ui.pocketBackground,
        borderRadius: 12,
        padding: 10,
        marginVertical: 10,
        justifyContent: 'center',
        alignItems: 'center',
        width: '100%',
        minHeight: 60,
    },
    pocketSlot: {
        justifyContent: 'center',
        alignItems: 'center',
        marginHorizontal: 5,
        borderRadius: 8,
    },
    selectedSlot: {
        backgroundColor: 'rgba(255, 255, 255, 0.3)',
        borderWidth: 2,
        borderColor: 'white',
    },
    badge: {
        position: 'absolute',
        top: -5,
        right: -5,
        backgroundColor: '#e74c3c',
        borderRadius: 10,
        width: 20,
        height: 20,
        justifyContent: 'center',
        alignItems: 'center',
        elevation: 3,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.3,
        shadowRadius: 1,
    },
    badgeText: {
        color: 'white',
        fontSize: 12,
        fontWeight: 'bold',
    }
});
