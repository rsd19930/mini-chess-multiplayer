import { supabase } from './supabase';
import { GameEngine } from '../core/GameEngine'; // needed for initial state if required, else we can pass empty JSONB or default from DB
import { gameConfig } from '../config/gameConfig';

export interface MatchResult {
    matchId: string;
    color: 'white' | 'black';
}

export const MatchmakingService = {
    async findOrCreateMatch(userId: string): Promise<MatchResult> {
        const timeoutLimit = new Date(Date.now() - gameConfig.timers.matchmakingTimeoutMs).toISOString();

        // Query for an open match where the user is not already player_white
        const { data: openMatches, error: fetchError } = await supabase
            .from('matches')
            .select('id, player_white')
            .eq('status', 'waiting')
            .eq('is_private', false)
            .neq('player_white', userId)
            .gte('created_at', timeoutLimit)
            .limit(1);

        if (fetchError) {
            console.error('Error fetching open matches:', fetchError);
            throw fetchError;
        }

        if (openMatches && openMatches.length > 0) {
            // Found open match! Join as black
            const matchId = openMatches[0].id;
            const { data: updateData, error: updateError } = await supabase
                .from('matches')
                .update({
                    player_black: userId,
                    status: 'active',
                    started_at: new Date().toISOString()
                })
                .eq('id', matchId)
                .select()
                .single();

            if (updateError) {
                console.error('Error joining match:', updateError);
                throw updateError;
            }

            return {
                matchId: updateData.id,
                color: 'black'
            };
        } else {
            // No open match found. Create a new one as white.
            // Generate initial state to store in JSONB
            const engine = new GameEngine();
            const initialState = engine.getState();

            const { data: insertData, error: insertError } = await supabase
                .from('matches')
                .insert({
                    player_white: userId,
                    status: 'waiting',
                    is_private: false,
                    game_state: initialState
                })
                .select()
                .single();

            if (insertError) {
                console.error('Error creating match:', insertError);
                throw insertError;
            }

            return {
                matchId: insertData.id,
                color: 'white'
            };
        }
    }
};
