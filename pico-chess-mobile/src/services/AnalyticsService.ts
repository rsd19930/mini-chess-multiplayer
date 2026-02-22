export class AnalyticsService {
    static trackMatchRequested(userId: string) {
        console.log(`[Analytics] Match Requested by user: ${userId}`);
        // Stub: Integrate with Mixpanel, PostHog, or Supabase custom events here
    }

    static trackGameStarted(matchId: string, playerWhite: string, playerBlack: string) {
        console.log(`[Analytics] Game Started: ${matchId} | White: ${playerWhite} vs Black: ${playerBlack}`);
    }

    static trackMovePlayed(matchId: string, userId: string, moveNotation: string) {
        console.log(`[Analytics] Move in ${matchId} by ${userId}: ${moveNotation}`);
    }

    static trackGameEnded(matchId: string, winnerId: string | 'draw') {
        console.log(`[Analytics] Game Ended: ${matchId} | Winner: ${winnerId}`);
    }
}
