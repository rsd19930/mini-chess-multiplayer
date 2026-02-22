import React, { useState } from 'react';
import { View, StyleSheet, Text, Button, Modal, TouchableOpacity, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChessBoard } from '../components/board/ChessBoard';
import { defaultTheme } from '../config/themeConfig';
import { GameEngine } from '../core/GameEngine';
import { GameState } from '../types';
import { AudioService } from '../services/AudioService';
import { calculateBotAction } from '../core/BotEngine';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types/navigation';
import { supabase } from '../services/supabase';
import { gameConfig } from '../config/gameConfig';
import { MatchmakingService } from '../services/MatchmakingService';

type GameScreenProps = NativeStackScreenProps<RootStackParamList, 'Game'>;

export const GameScreen: React.FC<GameScreenProps> = ({ route, navigation }) => {
    const insets = useSafeAreaInsets();

    // Retrieve the passed gamemode (local vs online)
    const { mode, matchId, localColor } = route.params;

    // In a real Match flow, we'd pass the local socket/realtime connection 
    // and the mapped color down. For testing our UI, we'll assume we are White locally.
    const [engine] = useState(() => new GameEngine());
    const [gameState, setGameState] = useState<GameState>(engine.getState());
    const [matchStatus, setMatchStatus] = useState('active');
    const [opponentId, setOpponentId] = useState<string | null>(null);
    const [isRematching, setIsRematching] = useState(false);

    // Effect to subscribe to the remote Match state
    React.useEffect(() => {
        if (mode !== 'online' || !matchId) return;

        // Fetch initial status
        supabase
            .from('matches')
            .select('status, player_white, player_black')
            .eq('id', matchId)
            .single()
            .then(({ data }) => {
                if (data) {
                    setMatchStatus(data.status);
                    const oppId = localColor === 'white' ? data.player_black : data.player_white;
                    setOpponentId(oppId);
                }
            });

        const channel = supabase
            .channel(`match_${matchId}`)
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'matches',
                    filter: `id=eq.${matchId}`,
                },
                (payload) => {
                    if (payload.new && payload.new.status) {
                        setMatchStatus(payload.new.status);
                    }
                    if (payload.new && (payload.new.player_white || payload.new.player_black)) {
                        const oppId = localColor === 'white' ? payload.new.player_black : payload.new.player_white;
                        if (oppId) setOpponentId(oppId);
                    }
                    if (payload.new && payload.new.game_state) {
                        const remoteState = payload.new.game_state as GameState;
                        engine.setState(remoteState);
                        setGameState(remoteState);
                    }
                }
            )
            .subscribe((status) => {
                console.log('Realtime Subscription Status:', status);
            });

        return () => {
            supabase.removeChannel(channel);
        };
    }, [mode, matchId, engine]);

    // Bot Fallback Timer
    React.useEffect(() => {
        if (mode !== 'online' || matchStatus !== 'waiting' || !matchId) return;

        const timer = setTimeout(async () => {
            const botUuid = '00000000-0000-0000-0000-000000000000';
            setOpponentId(botUuid);
            setMatchStatus('active');
            await supabase
                .from('matches')
                .update({
                    player_black: botUuid,
                    status: 'active',
                    started_at: new Date().toISOString()
                })
                .eq('id', matchId);
        }, gameConfig.timers.matchmakingTimeoutMs);

        return () => clearTimeout(timer);
    }, [mode, matchStatus, matchId]);

    // Bot Turn Logic
    React.useEffect(() => {
        console.log('🤖 Bot Check -> status:', matchStatus, '| opponent:', opponentId, '| turn:', gameState.turn);
        if (
            mode === 'online' &&
            matchStatus === 'active' &&
            opponentId === '00000000-0000-0000-0000-000000000000' &&
            gameState.turn !== localColor &&
            !gameState.isGameOver
        ) {
            const timer = setTimeout(async () => {
                const action = await calculateBotAction(engine, gameState.turn);
                if (action) {
                    engine.applyAction(action);
                    setGameState({ ...engine.getState() });
                    await supabase
                        .from('matches')
                        .update({ game_state: engine.getState() })
                        .eq('id', matchId);
                }
            }, 1000);

            return () => clearTimeout(timer);
        }
    }, [mode, matchStatus, opponentId, gameState.turn, gameState.isGameOver, localColor, matchId]);

    // Override setGameState to ALSO push to Supabase if local player moved
    const handleSetGameState = async (newState: GameState) => {
        setGameState(newState);
        if (mode === 'online' && matchId) {
            await supabase
                .from('matches')
                .update({ game_state: newState })
                .eq('id', matchId);
        }
    };

    // Game Over DB Sync
    React.useEffect(() => {
        const syncGameOver = async () => {
            if (gameState.isGameOver && mode === 'online' && matchId) {
                const status = gameState.winReason === 'Resignation' ? 'aborted' : 'completed';
                await supabase
                    .from('matches')
                    .update({
                        status,
                        game_state: engine.getState()
                    })
                    .eq('id', matchId);
            }
        };
        syncGameOver();
    }, [gameState.isGameOver, mode, matchId, gameState.winReason, engine]);

    const [resignModalVisible, setResignModalVisible] = useState(false);

    const handleResign = () => {
        setResignModalVisible(true);
    };

    const confirmResign = () => {
        setGameState(engine.resign('white')); // Assuming hardcoded white for local test
        setResignModalVisible(false);
        AudioService.playGameEnd();
    };

    const handleRestart = async () => {
        if (mode === 'local') {
            setGameState(engine.resetState());
            AudioService.playGameStart();
        } else {
            setIsRematching(true);
            const { data: { session } } = await supabase.auth.getSession();
            if (session) {
                try {
                    const result = await MatchmakingService.findOrCreateMatch(session.user.id);
                    setIsRematching(false);
                    navigation.replace('Game', {
                        mode: 'online',
                        matchId: result.matchId,
                        localColor: result.color
                    });
                } catch (error: any) {
                    setIsRematching(false);
                    Alert.alert('Matchmaking Error', error.message || 'Failed to find a match.');
                    navigation.navigate('Home');
                }
            } else {
                setIsRematching(false);
                navigation.navigate('Home');
            }
        }
    };

    const handleBackToHome = () => {
        navigation.navigate('Home');
    };

    return (
        <View style={styles.container}>
            <View style={styles.contentWrapper}>
                <View style={[styles.header, { paddingTop: Math.max(insets.top, 10) }]}>
                    <Text style={styles.headerText}>
                        Pico Chess ({mode === 'local' ? 'Local Test' : 'Online Match'})
                    </Text>
                </View>

                {/* Waiting Overlay */}
                {mode === 'online' && matchStatus === 'waiting' && (
                    <View style={styles.waitingOverlay} pointerEvents="none">
                        <View style={styles.waitingContent}>
                            <Text style={styles.waitingText}>Waiting for opponent to join...</Text>
                        </View>
                    </View>
                )}

                {/* The Star of the Show: The 2.5D Board */}
                <ChessBoard
                    localColor={mode === 'online' ? (localColor || 'white') : 'white'}
                    engine={engine}
                    gameState={gameState}
                    setGameState={handleSetGameState}
                    isInputDisabled={mode === 'online' && (gameState.turn !== localColor || matchStatus === 'waiting')}
                />

                <View style={styles.footer}>
                    <Button title="RESIGN" color="red" onPress={handleResign} disabled={gameState.isGameOver} />
                </View>

                {/* Resign Confirmation Modal */}
                <Modal visible={resignModalVisible} transparent={true} animationType="fade">
                    <View style={styles.modalOverlay}>
                        <View style={styles.modalContent}>
                            <Text style={styles.modalTitle}>Resign Game</Text>
                            <Text style={styles.modalText}>Are you sure you want to resign?</Text>
                            <View style={styles.modalButtons}>
                                <Button title="Cancel" onPress={() => setResignModalVisible(false)} />
                                <Button title="Confirm!" color="red" onPress={confirmResign} />
                            </View>
                        </View>
                    </View>
                </Modal>

                {/* Game Over Modal */}
                <Modal visible={gameState.isGameOver} transparent={true} animationType="fade">
                    <View style={styles.gameOverOverlay}>
                        <View style={[styles.modalContent, styles.gameOverContent]}>
                            <Text style={styles.gameOverTitle}>
                                {gameState.winner === 'draw' ? 'Draw!' : `${gameState.winner === 'white' ? 'White' : 'Black'} Wins!`}
                            </Text>
                            {gameState.winReason && (
                                <Text style={styles.gameOverReason}>by {gameState.winReason}</Text>
                            )}

                            <View style={styles.gameOverButtons}>
                                <TouchableOpacity style={styles.playAgainButton} onPress={handleRestart} disabled={isRematching}>
                                    <Text style={styles.playAgainText}>
                                        {isRematching ? 'Searching...' : 'Play Again'}
                                    </Text>
                                </TouchableOpacity>

                                <TouchableOpacity style={styles.homeButton} onPress={handleBackToHome}>
                                    <Text style={styles.homeButtonText}>Home</Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                    </View>
                </Modal>
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: defaultTheme.background, // Clean Green Background
    },
    contentWrapper: {
        flex: 1,
        paddingHorizontal: 20,
        paddingBottom: 20,
        justifyContent: 'space-between',
    },
    header: {
        alignItems: 'center',
        marginVertical: 10,
    },
    headerText: {
        fontSize: 24,
        color: defaultTheme.ui.textLight,
        fontWeight: 'bold',
        textShadowColor: 'rgba(0, 0, 0, 0.3)',
        textShadowOffset: { width: 0, height: 2 },
        textShadowRadius: 4,
    },
    waitingOverlay: {
        position: 'absolute',
        top: 120,
        left: 0,
        width: '100%',
        alignItems: 'center',
        zIndex: 50,
    },
    waitingContent: {
        backgroundColor: 'rgba(0,0,0,0.7)',
        paddingHorizontal: 20,
        paddingVertical: 10,
        borderRadius: 20,
    },
    waitingText: {
        color: 'white',
        fontWeight: 'bold',
        fontSize: 16,
    },
    footer: {
        alignItems: 'center',
        marginVertical: 20,
    },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    gameOverOverlay: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 50,
    },
    modalContent: {
        backgroundColor: defaultTheme.ui.pocketBackground,
        padding: 24,
        borderRadius: 12,
        alignItems: 'center',
        width: '80%',
        maxWidth: 300,
        elevation: 10,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 5 },
        shadowOpacity: 0.5,
        shadowRadius: 10,
    },
    gameOverContent: {
        backgroundColor: '#2A343A',
        minHeight: 200,
        justifyContent: 'center',
    },
    modalTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        color: 'white',
        marginBottom: 10,
    },
    modalText: {
        fontSize: 16,
        color: '#ccc',
        marginBottom: 20,
        textAlign: 'center',
    },
    modalButtons: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        width: '100%',
    },
    gameOverTitle: {
        fontSize: 32,
        fontWeight: 'bold',
        color: '#FFFFFF',
        marginBottom: 10,
        textAlign: 'center',
    },
    gameOverReason: {
        fontSize: 18,
        color: '#D0D0D0',
        marginBottom: 30,
        textAlign: 'center',
        fontWeight: '600',
    },
    playAgainButton: {
        backgroundColor: '#27ae60', // A nice green color
        paddingVertical: 12,
        paddingHorizontal: 20,
        borderRadius: 8,
        marginRight: 10,
    },
    playAgainText: {
        color: 'white',
        fontWeight: 'bold',
        fontSize: 16,
    },
    homeButton: {
        backgroundColor: '#607D8B', // Muted slate color for going back
        paddingVertical: 12,
        paddingHorizontal: 20,
        borderRadius: 8,
    },
    homeButtonText: {
        color: 'white',
        fontWeight: 'bold',
        fontSize: 16,
    },
    gameOverButtons: {
        flexDirection: 'row',
        marginTop: 10,
    }
});
