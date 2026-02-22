import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ImageBackground, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../services/supabase';
import { MatchmakingService } from '../services/MatchmakingService';
import * as WebBrowser from 'expo-web-browser';
import { makeRedirectUri } from 'expo-auth-session';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types/navigation';
import { defaultTheme } from '../config/themeConfig';

type HomeScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'Home'>;

interface HomeScreenProps {
    navigation: HomeScreenNavigationProp;
}

const extractTokens = (url: string) => {
    const queryParams: Record<string, string> = {};
    const [, queryString] = url.split("#");
    if (queryString) {
        queryString.split("&").forEach((pair) => {
            const [key, value] = pair.split("=");
            queryParams[key] = decodeURIComponent(value || "");
        });
    }
    return queryParams;
};

WebBrowser.maybeCompleteAuthSession();

export const HomeScreen: React.FC<HomeScreenProps> = ({ navigation }) => {
    const insets = useSafeAreaInsets();
    const [session, setSession] = useState<any>(null);
    const [isSearching, setIsSearching] = useState(false);

    useEffect(() => {
        supabase.auth.getSession().then(({ data: { session } }) => {
            setSession(session);
        });

        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            setSession(session);
        });

        return () => subscription.unsubscribe();
    }, []);

    // Stubs for future user state
    const userName = session ? (session.user.user_metadata?.full_name || session.user.email?.split('@')[0] || 'Player') : 'Guest Player';
    const coinBalance = '🪙 1000';

    const handlePlayLocal = () => {
        navigation.navigate('Game', { mode: 'local' });
    };

    const handlePlayOnline = async () => {
        if (!session) {
            Alert.alert('Sign In Required', 'You must be signed in to play online!');
            return;
        }

        try {
            setIsSearching(true);
            const result = await MatchmakingService.findOrCreateMatch(session.user.id);
            setIsSearching(false);

            navigation.navigate('Game', {
                mode: 'online',
                matchId: result.matchId,
                localColor: result.color
            });
        } catch (error: any) {
            setIsSearching(false);
            Alert.alert('Matchmaking Error', error.message || 'Failed to find a match.');
        }
    };

    const handleGoogleSignIn = async () => {
        const redirectUrl = makeRedirectUri({
            scheme: 'picochess'
        });
        console.log('👉 EXPO REDIRECT URL:', redirectUrl);
        const { data, error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: redirectUrl,
                queryParams: {
                    prompt: 'consent'
                }
            },
        });

        if (error) {
            Alert.alert('Sign In Error', error.message);
        } else if (data?.url) {
            const result = await WebBrowser.openAuthSessionAsync(data.url, redirectUrl);

            if (result?.type === 'success' && result.url) {
                const { access_token, refresh_token } = extractTokens(result.url);
                if (access_token && refresh_token) {
                    await supabase.auth.setSession({ access_token, refresh_token });
                }
            }
        }
    };

    return (
        <View style={styles.container}>
            {/* Fallback dark green background color, acts as placeholder for future image asset */}
            <ImageBackground style={styles.background} resizeMode="cover" source={{ uri: '' }}>

                {/* Header Section (Player Profile / Coins) */}
                <View style={[styles.header, { paddingTop: Math.max(insets.top, 20) }]}>
                    <View style={styles.profileRow}>
                        <View style={styles.avatarStub}></View>
                        <View style={styles.userInfo}>
                            <Text style={styles.userNameText}>{userName}</Text>
                            <Text style={styles.coinText}>{coinBalance}</Text>
                        </View>
                    </View>
                </View>

                {/* Main Content (Title and Menu Buttons) */}
                <View style={styles.centerContent}>
                    <Text style={styles.gameTitle}>pico chess</Text>

                    <TouchableOpacity style={[styles.menuButton, styles.buttonLocal]} onPress={handlePlayLocal} disabled={isSearching}>
                        <Text style={styles.menuButtonText}>Play Local (Test)</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={[styles.menuButton, styles.buttonOnline, isSearching && { opacity: 0.7 }]}
                        onPress={handlePlayOnline}
                        disabled={isSearching}
                    >
                        <Text style={styles.menuButtonText}>
                            {isSearching ? 'Searching...' : 'Play Online (100 🪙)'}
                        </Text>
                    </TouchableOpacity>

                    {!session && (
                        <TouchableOpacity style={[styles.menuButton, styles.buttonAuth]} onPress={handleGoogleSignIn} disabled={isSearching}>
                            <Text style={styles.menuButtonText}>Sign In with Google</Text>
                        </TouchableOpacity>
                    )}
                </View>

            </ImageBackground>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#1E3126', // A dark green fallback color
    },
    background: {
        flex: 1,
        backgroundColor: '#1E3126', // Solid dark green until art is provided
    },
    header: {
        padding: 20,
        flexDirection: 'row',
        justifyContent: 'flex-start',
        alignItems: 'center',
    },
    profileRow: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.4)',
        padding: 10,
        borderRadius: 25,
    },
    avatarStub: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: '#aaa',
        marginRight: 10,
    },
    userInfo: {
        flexDirection: 'column',
    },
    userNameText: {
        color: 'white',
        fontWeight: 'bold',
        fontSize: 14,
    },
    coinText: {
        color: '#FFD700',
        fontWeight: 'bold',
        fontSize: 16,
    },
    centerContent: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingBottom: 50,
    },
    gameTitle: {
        fontSize: 48,
        fontWeight: '900',
        color: 'white',
        letterSpacing: 2,
        marginBottom: 60,
        textShadowColor: 'rgba(0,0,0,0.5)',
        textShadowOffset: { width: 0, height: 4 },
        textShadowRadius: 6,
    },
    menuButton: {
        width: '80%',
        maxWidth: 300,
        paddingVertical: 16,
        borderRadius: 30,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 15,
        elevation: 5,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.3,
        shadowRadius: 5,
    },
    buttonLocal: {
        backgroundColor: '#27ae60', // Prominent Green
    },
    buttonOnline: {
        backgroundColor: '#2A343A', // Darker gray for premium matching
        borderWidth: 2,
        borderColor: '#FFD700', // Gold border for premium vibe
    },
    buttonAuth: {
        backgroundColor: 'transparent',
        borderWidth: 2,
        borderColor: 'rgba(255, 255, 255, 0.5)',
    },
    menuButtonText: {
        color: 'white',
        fontSize: 18,
        fontWeight: 'bold',
    },
});
