import { NavigatorScreenParams } from '@react-navigation/native';

export type RootStackParamList = {
    Home: undefined;
    Game: { mode: 'local' | 'online', matchId?: string, localColor?: 'white' | 'black', botDepth?: number };
};
