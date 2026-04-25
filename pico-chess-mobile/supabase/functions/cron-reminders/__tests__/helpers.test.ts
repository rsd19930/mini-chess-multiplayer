import {
  getLocalParts,
  isWithinQuietHours,
  isActiveWindow,
  isBeforeTodayLocal,
  isInDailyCoinWindow,
} from '../helpers';

// Helper to build a UTC date for a specific tz local time.
// We can't directly construct "9pm in LA" without a tz library, so we instead
// pick UTC instants and assert what the local clock looks like in target tz.
//
// Reference UTC anchors used below:
//   2026-04-25T15:00:00Z  → America/Los_Angeles 08:00 (DST), Asia/Kolkata 20:30, Australia/Sydney 01:00 (next day)
//   2026-04-25T11:00:00Z  → America/Los_Angeles 04:00, Asia/Kolkata 16:30, Australia/Sydney 21:00
//   2026-04-26T04:00:00Z  → America/Los_Angeles 21:00 (4/25), Asia/Kolkata 09:30 (4/26), Australia/Sydney 14:00 (4/26)

describe('cron-reminders helpers', () => {
  describe('getLocalParts', () => {
    it('returns local date/hour/minute in target timezone', () => {
      const when = new Date('2026-04-26T04:00:00Z');
      const la = getLocalParts('America/Los_Angeles', when);
      expect(la.date).toBe('2026-04-25');
      expect(la.hour).toBe(21);
      expect(la.minute).toBe(0);

      const kol = getLocalParts('Asia/Kolkata', when);
      expect(kol.date).toBe('2026-04-26');
      expect(kol.hour).toBe(9);
      expect(kol.minute).toBe(30);
    });
  });

  describe('isWithinQuietHours', () => {
    it('returns true at 4am LA local (within 2–8am)', () => {
      const when = new Date('2026-04-25T11:00:00Z'); // 4am LA
      expect(isWithinQuietHours('America/Los_Angeles', when)).toBe(true);
    });

    it('returns false at 8am LA local (boundary — exclusive)', () => {
      const when = new Date('2026-04-25T15:00:00Z'); // 8am LA
      expect(isWithinQuietHours('America/Los_Angeles', when)).toBe(false);
    });

    it('returns false at 9pm LA local', () => {
      const when = new Date('2026-04-26T04:00:00Z'); // 9pm LA on 4/25
      expect(isWithinQuietHours('America/Los_Angeles', when)).toBe(false);
    });

    it('correctly evaluates Asia/Kolkata simultaneously', () => {
      const when = new Date('2026-04-25T22:30:00Z'); // 4am IST next day
      expect(isWithinQuietHours('Asia/Kolkata', when)).toBe(true);
    });

    it('correctly evaluates Australia/Sydney simultaneously', () => {
      const when = new Date('2026-04-25T18:00:00Z'); // 4am Sydney next day
      expect(isWithinQuietHours('Australia/Sydney', when)).toBe(true);
    });
  });

  describe('isActiveWindow', () => {
    it('is the inverse of isWithinQuietHours', () => {
      const when = new Date('2026-04-26T04:00:00Z');
      expect(isActiveWindow('America/Los_Angeles', when)).toBe(true);
      expect(isWithinQuietHours('America/Los_Angeles', when)).toBe(false);

      const quiet = new Date('2026-04-25T11:00:00Z'); // 4am LA
      expect(isActiveWindow('America/Los_Angeles', quiet)).toBe(false);
    });
  });

  describe('isBeforeTodayLocal', () => {
    it('returns true for null/undefined (never sent)', () => {
      const when = new Date('2026-04-26T04:00:00Z');
      expect(isBeforeTodayLocal(null, 'America/Los_Angeles', when)).toBe(true);
      expect(isBeforeTodayLocal(undefined, 'America/Los_Angeles', when)).toBe(true);
    });

    it('returns true when ts resolves to yesterday local in tz', () => {
      // "now" = 9pm LA on 4/25; yesterday's send = some time on 4/24 LA.
      const now = new Date('2026-04-26T04:00:00Z');
      const yesterdayLA = new Date('2026-04-25T03:00:00Z'); // 8pm LA on 4/24
      expect(isBeforeTodayLocal(yesterdayLA.toISOString(), 'America/Los_Angeles', now)).toBe(true);
    });

    it('returns false when ts resolves to today local in tz', () => {
      const now = new Date('2026-04-26T04:00:00Z'); // 9pm LA 4/25
      const todayLA = new Date('2026-04-25T18:00:00Z'); // 11am LA 4/25
      expect(isBeforeTodayLocal(todayLA.toISOString(), 'America/Los_Angeles', now)).toBe(false);
    });

    it('handles date-line-adjacent timezones — same UTC moment is "today" in one tz, "yesterday" in another', () => {
      // 2026-04-25T18:00:00Z → 4/25 11am LA, 4/26 04:00 Sydney
      const ts = new Date('2026-04-25T18:00:00Z');
      // "now" anchor: 4/25 21:00 LA → 4/26 14:00 Sydney
      const now = new Date('2026-04-26T04:00:00Z');
      // In LA, ts is on the same local day as now → not before today.
      expect(isBeforeTodayLocal(ts.toISOString(), 'America/Los_Angeles', now)).toBe(false);
      // In Sydney, ts is on the same local day as now (both 4/26) → not before today.
      expect(isBeforeTodayLocal(ts.toISOString(), 'Australia/Sydney', now)).toBe(false);
    });
  });

  describe('isInDailyCoinWindow', () => {
    it('returns true at 21:00 LA local', () => {
      const when = new Date('2026-04-26T04:00:00Z'); // 9pm LA
      expect(isInDailyCoinWindow('America/Los_Angeles', when)).toBe(true);
    });

    it('returns false at 22:00 LA local (just after window)', () => {
      const when = new Date('2026-04-26T05:00:00Z'); // 10pm LA
      expect(isInDailyCoinWindow('America/Los_Angeles', when)).toBe(false);
    });

    it('returns false at 20:00 LA local (just before window)', () => {
      const when = new Date('2026-04-26T03:00:00Z'); // 8pm LA
      expect(isInDailyCoinWindow('America/Los_Angeles', when)).toBe(false);
    });

    it('returns true at 20:30 LA (lower boundary, inclusive)', () => {
      const when = new Date('2026-04-26T03:30:00Z'); // 8:30pm LA
      expect(isInDailyCoinWindow('America/Los_Angeles', when)).toBe(true);
    });

    it('returns false at 21:30 LA (upper boundary, exclusive)', () => {
      const when = new Date('2026-04-26T04:30:00Z'); // 9:30pm LA
      expect(isInDailyCoinWindow('America/Los_Angeles', when)).toBe(false);
    });
  });

  describe('per-type throttle scenarios', () => {
    // These mirror the gates Block C and Block D apply in cron-reminders/index.ts.
    const tz = 'America/Los_Angeles';
    const now = new Date('2026-04-26T04:00:00Z'); // 9pm LA on 4/25

    it('block C eligible: last_daily_coin_pn_at = yesterday local', () => {
      const yesterday = new Date('2026-04-25T03:00:00Z').toISOString(); // 8pm LA 4/24
      expect(isBeforeTodayLocal(yesterday, tz, now)).toBe(true);
    });

    it('block C skipped: last_daily_coin_pn_at = today local', () => {
      const today = new Date('2026-04-25T18:00:00Z').toISOString(); // 11am LA 4/25
      expect(isBeforeTodayLocal(today, tz, now)).toBe(false);
    });

    it('block D eligible: last_elo_nudge_pn_at = yesterday local', () => {
      const yesterday = new Date('2026-04-25T03:00:00Z').toISOString();
      expect(isBeforeTodayLocal(yesterday, tz, now)).toBe(true);
    });

    it('block D skipped: last_elo_nudge_pn_at = today local', () => {
      const today = new Date('2026-04-25T18:00:00Z').toISOString();
      expect(isBeforeTodayLocal(today, tz, now)).toBe(false);
    });
  });
});
