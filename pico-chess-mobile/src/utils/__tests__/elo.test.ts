import { getTierForElo, getTierProgress, TIER_THRESHOLDS } from '../elo';

describe('elo - tier classification', () => {
    describe('getTierForElo boundaries', () => {
        it.each([
            [0, 'Novice'],
            [799, 'Novice'],
            [800, 'Bronze'],
            [1199, 'Bronze'],
            [1200, 'Silver'],
            [1599, 'Silver'],
            [1600, 'Gold'],
            [1999, 'Gold'],
            [2000, 'Platinum'],
            [2399, 'Platinum'],
            [2400, 'Grandmaster'],
            [9999, 'Grandmaster'],
            [100000, 'Grandmaster'],
        ])('elo %i resolves to %s', (elo, expectedTierName) => {
            expect(getTierForElo(elo).name).toBe(expectedTierName);
        });

        it('Grandmaster tier has no upper bound (max is null)', () => {
            const gm = TIER_THRESHOLDS.find(t => t.name === 'Grandmaster');
            expect(gm).toBeDefined();
            expect(gm!.max).toBeNull();
        });

        it('negative elo falls back to Novice (via default)', () => {
            // getTierForElo returns TIER_THRESHOLDS[0] as fallback — Novice.
            expect(getTierForElo(-100).name).toBe('Novice');
        });
    });

    describe('getTierProgress', () => {
        it('returns 0% at tier floor', () => {
            const p = getTierProgress(800); // Bronze floor
            expect(p.currentElo).toBe(800);
            expect(p.nextTierThreshold).toBe(1200);
            // (800 - 800) / (1199 - 800 + 1) = 0
            expect(p.progressPercent).toBeCloseTo(0, 5);
        });

        it('returns ~100% at tier ceiling', () => {
            const p = getTierProgress(1199); // Bronze ceiling
            expect(p.nextTierThreshold).toBe(1200);
            // (1199 - 800) / 400 = 99.75
            expect(p.progressPercent).toBeGreaterThan(99);
            expect(p.progressPercent).toBeLessThanOrEqual(100);
        });

        it('mid-tier returns a progress percent between 0 and 100', () => {
            const p = getTierProgress(1000); // mid-Bronze
            expect(p.progressPercent).toBeGreaterThan(0);
            expect(p.progressPercent).toBeLessThan(100);
        });

        it('Grandmaster reports 100% progress and no next threshold', () => {
            const p = getTierProgress(2500);
            expect(p.nextTierThreshold).toBeNull();
            expect(p.progressPercent).toBe(100);
        });

        it('clamps progressPercent to [0, 100]', () => {
            // Within a valid tier, range math keeps it in range. Sanity check:
            const p = getTierProgress(1600); // Gold floor
            expect(p.progressPercent).toBeGreaterThanOrEqual(0);
            expect(p.progressPercent).toBeLessThanOrEqual(100);
        });
    });
});
