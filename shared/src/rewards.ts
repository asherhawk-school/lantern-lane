/** Calendar day (YYYY-MM-DD) in the player's own timezone. `tzOffsetMin` is JS getTimezoneOffset(). */
export function dayKey(ts: number, tzOffsetMin: number): string {
  return new Date(ts - tzOffsetMin * 60_000).toISOString().slice(0, 10);
}

export function prevDay(day: string): string {
  const d = new Date(day + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export interface StreakState {
  streak: number;
  lastDay: string | null;
}

/** Streak after finishing a session on `day`, and whether it was that day's first. */
export function applySession(state: StreakState, day: string): StreakState & { firstOfDay: boolean } {
  if (state.lastDay === day) return { streak: Math.max(1, state.streak), lastDay: day, firstOfDay: false };
  const continued = state.lastDay === prevDay(day);
  return { streak: continued ? state.streak + 1 : 1, lastDay: day, firstOfDay: true };
}

/** The streak to show today: it lapses once a whole day is missed. */
export function currentStreak(streak: number, lastDay: string | null, today: string): number {
  if (!lastDay) return 0;
  return lastDay === today || lastDay === prevDay(today) ? streak : 0;
}

/** One coin per focused minute, plus a bonus on the first session of each day that grows with the streak. */
export function sessionCoins(minutes: number, streak: number, firstOfDay: boolean): { base: number; bonus: number; total: number } {
  const bonus = firstOfDay ? Math.min(streak, 7) * 2 : 0;
  return { base: minutes, bonus, total: minutes + bonus };
}
