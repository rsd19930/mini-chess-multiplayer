// Pure tz/date helpers for cron-reminders. No Deno or Supabase imports — safe to unit-test from Jest.

export type LocalParts = {
  date: string; // YYYY-MM-DD in target tz
  hour: number; // 0–23
  minute: number; // 0–59
};

export function getLocalParts(tz: string, when: Date = new Date()): LocalParts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(when);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  // Some Intl implementations return '24' at midnight; normalize to '00'.
  const hour = parseInt(map.hour, 10) % 24;
  return {
    date: `${map.year}-${map.month}-${map.day}`,
    hour,
    minute: parseInt(map.minute, 10),
  };
}

export function isWithinQuietHours(tz: string, when: Date = new Date()): boolean {
  // Quiet hours: 2am (inclusive) to 8am (exclusive) local — no sends.
  const { hour } = getLocalParts(tz, when);
  return hour >= 2 && hour < 8;
}

export function isActiveWindow(tz: string, when: Date = new Date()): boolean {
  return !isWithinQuietHours(tz, when);
}

export function isBeforeTodayLocal(ts: string | null | undefined, tz: string, when: Date = new Date()): boolean {
  // True if `ts` resolves to a local-date strictly earlier than today's local-date in `tz`.
  // Null/undefined means "never sent" → eligible.
  if (!ts) return true;
  const todayLocal = getLocalParts(tz, when).date;
  const tsLocal = getLocalParts(tz, new Date(ts)).date;
  return tsLocal < todayLocal;
}

export function isInDailyCoinWindow(tz: string, when: Date = new Date()): boolean {
  // 20:30–21:30 local: a 1h window so each user is caught exactly once per 30-min cron cadence.
  const { hour, minute } = getLocalParts(tz, when);
  const totalMin = hour * 60 + minute;
  return totalMin >= 20 * 60 + 30 && totalMin < 21 * 60 + 30;
}
