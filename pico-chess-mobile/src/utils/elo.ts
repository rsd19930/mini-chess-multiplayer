export interface TierInfo {
    name: string;
    icon: string;
    min: number;
    max: number | null;
    color: string;
}

export const TIER_THRESHOLDS: TierInfo[] = [
    { name: "Novice", icon: "🥉", min: 0, max: 799, color: "#cd7f32" },
    { name: "Bronze", icon: "🛡️", min: 800, max: 1199, color: "#b08d57" },
    { name: "Silver", icon: "⚔️", min: 1200, max: 1599, color: "#c0c0c0" },
    { name: "Gold", icon: "🥇", min: 1600, max: 1999, color: "#ffd700" },
    { name: "Platinum", icon: "🌟", min: 2000, max: 2399, color: "#e5e4e2" },
    { name: "Grandmaster", icon: "💎", min: 2400, max: null, color: "#b9f2ff" },
];

export const getTierForElo = (elo: number): TierInfo => {
    // Ensure we sort thresholds to safely evaluate linearly
    const target = TIER_THRESHOLDS.find(
        (t) => elo >= t.min && (t.max === null || elo <= t.max)
    );
    return target || TIER_THRESHOLDS[0];
};

/**
 * Returns the mathematically exact floor boundaries and deltas for the Profile Progress Bar
 */
export const getTierProgress = (
    elo: number
): { currentElo: number; nextTierThreshold: number | null; progressPercent: number } => {
    const currentTier = getTierForElo(elo);

    if (currentTier.max === null) {
        // Max tier has no progression
        return {
            currentElo: elo,
            nextTierThreshold: null,
            progressPercent: 100,
        };
    }

    const range = currentTier.max - currentTier.min + 1;
    const progress = elo - currentTier.min;
    const progressPercent = Math.min(100, Math.max(0, (progress / range) * 100));

    return {
        currentElo: elo,
        nextTierThreshold: currentTier.max + 1,
        progressPercent,
    };
};
