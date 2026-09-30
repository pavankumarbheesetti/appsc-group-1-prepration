/**
 * ISO calendar-date helpers — PURE, timezone-stable date math (no DOM, no I/O).
 *
 * The planner works in whole CALENDAR DAYS anchored on ISO `YYYY-MM-DD` strings
 * (the format persisted in settings). To keep the arithmetic free of local
 * timezone/DST drift, every date is projected onto UTC midnight and compared as
 * an integer day count. These functions are the single source of truth for
 * date parsing/formatting/diffing across the store and the planner engine, so
 * they are trivially unit-tested with fixed strings.
 */

/** Milliseconds in a whole day. */
const DAY_MS = 24 * 60 * 60 * 1000;

/** Strict `YYYY-MM-DD` matcher (four-digit year, zero-padded month/day). */
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * True when `s` is a valid ISO `YYYY-MM-DD` calendar date. Rejects malformed
 * strings AND impossible dates (e.g. `2026-02-31`, which would otherwise roll
 * forward silently).
 */
export function isValidISODate(s: string): boolean {
  const m = ISO_RE.exec(s.trim());
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const ms = Date.UTC(year, month - 1, day);
  const d = new Date(ms);
  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() === month - 1 &&
    d.getUTCDate() === day
  );
}

/** Parse a valid ISO date to its UTC-midnight epoch ms. @throws on bad input. */
export function isoToUTC(iso: string): number {
  const m = ISO_RE.exec(iso.trim());
  if (!m) throw new Error(`Invalid ISO date: ${iso}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Format a UTC-midnight epoch ms back to an ISO `YYYY-MM-DD` string. */
export function utcToISO(ms: number): string {
  const d = new Date(ms);
  const y = String(d.getUTCFullYear()).padStart(4, '0');
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const da = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

/** The ISO date `n` whole days after `iso` (negative `n` goes backward). */
export function addDaysISO(iso: string, n: number): string {
  return utcToISO(isoToUTC(iso) + n * DAY_MS);
}

/**
 * Signed whole-day difference `b - a` (both ISO). Positive when `b` is later.
 * e.g. `diffDaysISO('2026-01-01','2026-01-11')` → 10.
 */
export function diffDaysISO(a: string, b: string): number {
  return Math.round((isoToUTC(b) - isoToUTC(a)) / DAY_MS);
}

/**
 * INCLUSIVE calendar-day span from `a` to `b` (both ISO), counting both ends.
 * e.g. same day → 1; a→a+1 → 2. Clamped to 0 when `b` precedes `a`.
 */
export function inclusiveDaysISO(a: string, b: string): number {
  return Math.max(0, diffDaysISO(a, b) + 1);
}

/**
 * Days remaining until the exam — the SINGLE SOURCE OF TRUTH for the
 * "days to exam" countdown shown in the Today and Planner views (and anywhere
 * else the countdown appears).
 *
 * CONVENTION: whole CALENDAR days from `todayISO` THROUGH the exam day, counting
 * BOTH ends — so the exam day itself counts as 1 ("1 day to exam" on exam day)
 * and the count is 0 only once the exam date has passed. This is defined in
 * terms of {@link inclusiveDaysISO} and matches the planner engine's
 * `PlanSummary.daysLeft` exactly, so every surface always shows the same number.
 *
 * e.g. today `2026-09-27` → exam `2026-11-15` ⇒ 50.
 */
export function daysUntilExam(examDateISO: string, todayISO: string): number {
  return inclusiveDaysISO(todayISO, examDateISO);
}

/**
 * Day-of-week for an ISO date, computed on UTC-midnight so it is timezone
 * stable: `0` = Sunday … `6` = Saturday (matching `Date.prototype.getUTCDay`).
 */
export function dayOfWeekISO(iso: string): number {
  return new Date(isoToUTC(iso)).getUTCDay();
}

/**
 * True when the ISO date falls on a WEEKEND (Saturday or Sunday). Used by the
 * planner to apply a separate weekend study-time budget. Timezone stable.
 */
export function isWeekendISO(iso: string): boolean {
  const dow = dayOfWeekISO(iso);
  return dow === 0 || dow === 6;
}

/** Today's local calendar date as an ISO `YYYY-MM-DD` string. */
export function todayISO(now: Date = new Date()): string {
  const y = String(now.getFullYear()).padStart(4, '0');
  const mo = String(now.getMonth() + 1).padStart(2, '0');
  const da = String(now.getDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}
