import { NavigatorScreenParams } from '@react-navigation/native';

export type RootStackParamList = {
    Home: { triggerReview?: boolean } | undefined;
    Game: { mode: 'local' | 'online', matchId?: string, localColor?: 'white' | 'black', botDepth?: number };
    Profile: { playerElo: number; coinBalance: number; avatarUrl: string | null; userName: string };
};
