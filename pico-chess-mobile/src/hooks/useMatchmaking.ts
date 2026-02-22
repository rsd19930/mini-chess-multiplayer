import { useState, useEffect, useRef } from 'react';
import { supabase } from '../services/supabase';
import { AnalyticsService } from '../services/AnalyticsService';
import { gameConfig } from '../config/gameConfig';

export interface MatchState {
    id: string;
    status: 'waiting' | 'active' | 'completed' | 'aborted';
    player_white: string;
    player_black: string;
}

export function useMatchmaking(userId?: string) {
    const [isSearching, setIsSearching] = useState(false);
    const [match, setMatch] = useState<MatchState | null>(null);
    const botTimerRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        // If we have an active match, stop searching
        if (match && match.status === 'active') {
            setIsSearching(false);
            clearTimeout(botTimerRef.current!);
            AnalyticsService.trackGameStarted(match.id, match.player_white, match.player_black);
        }
    }, [match]);

    const findMatch = async () => {
        if (!userId) return;
        setIsSearching(true);
        AnalyticsService.trackMatchRequested(userId);

        try {
            // 1. Call the Deno Matchmaker Edge Function to either join a waiting match or create a new one
            const { data, error } = await supabase.functions.invoke('matchmaking', {
                body: { userId }
            });

            if (error || !data) throw error;
            setMatch(data);

            if (data.status === 'waiting') {
                // 2. We created a new match and are waiting. Subscribe to Realtime for an opponent joining!
                const channel = supabase
                    .channel(`match_${data.id}`)
                    .on(
                        'postgres_changes',
                        { event: 'UPDATE', schema: 'public', table: 'matches', filter: `id=eq.${data.id}` },
                        (payload) => {
                            setMatch(payload.new as MatchState);
                        }
                    )
                    .subscribe();

                // 3. Start the 30-second Bot Matchmaking Timer
                botTimerRef.current = setTimeout(async () => {
                    // Trigger the 'assign_bot' fallback Edge function
                    const { data: updatedMatch } = await supabase.functions.invoke('assign_bot', {
                        body: { matchId: data.id }
                    });

                    if (updatedMatch) {
                        setMatch(updatedMatch);
                    }
                }, gameConfig.timers.matchmakingTimeoutMs);
            }
        } catch (err: any) {
            console.error('Matchmaking error:', err);
            setIsSearching(false);
        }
    };

    const cancelSearch = async () => {
        setIsSearching(false);
        if (botTimerRef.current) clearTimeout(botTimerRef.current);

        if (match && match.status === 'waiting') {
            await supabase.from('matches').update({ status: 'aborted' }).eq('id', match.id);
            setMatch(null);
        }
    };

    return { isSearching, match, findMatch, cancelSearch };
}
