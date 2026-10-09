/**
 * Single source of truth for app-wide configuration.
 *
 * These typed constants are imported anywhere the app needs to reference
 * exam metadata or branding. Keeping them here avoids magic strings/numbers
 * scattered across the codebase.
 */

/** Human-readable application name shown in the UI. */
export const APP_NAME = 'APPSC Group-1 Preparation';

/** Target exam notification (MM/YYYY) this prep cycle is aimed at. */
export const EXAM_NOTIFICATION = '07/2026';

/**
 * Default target EXAM DATE (ISO `YYYY-MM-DD`) the whole planner counts down to.
 * This is the single date every study plan, countdown and feasibility check is
 * anchored on; it is editable by the learner (persisted to `settings.examDate`)
 * and only used as the first-run default here.
 *
 * Updated for the DETAILED Notification 07/2026 (dated 06/10/2026): the
 * Screening (Prelims) Test is **24 Jan 2027** (the brief notification's
 * convention-date of 15 Nov 2026 is retired — see {@link OLD_DEFAULT_EXAM_DATE}).
 */
export const DEFAULT_EXAM_DATE = '2027-01-24';

/**
 * The RETIRED first-run default exam date from the brief-notification build
 * (15 Nov 2026). A stored `settings.examDate` equal to THIS exact value is the
 * old default and is auto-migrated to {@link DEFAULT_EXAM_DATE} on load (with a
 * one-time Today notice); any OTHER stored date is a learner choice and is left
 * untouched. See `src/state/store.ts` → `normalize`.
 */
export const OLD_DEFAULT_EXAM_DATE = '2026-11-15';

/**
 * Default DAILY study-time budget in MINUTES — a working professional's 4 hours
 * per day. The planner never schedules a day beyond the learner's budget; this
 * is the first-run default (persisted to `settings.dailyStudyMinutes`).
 */
export const DEFAULT_STUDY_MINUTES = 240;

/**
 * Default SUNDAY study-time budget in MINUTES — the learner asked for extra time
 * on Sundays, so the first-run default is 6 hours (vs the 4 h weekday budget).
 * The extra Sunday time is spent on Polity + Modern History (see the planner's
 * Sunday shape). Persisted to `settings.sundayStudyMinutes`; Saturday is a mock
 * day and simply follows the daily budget.
 */
export const DEFAULT_SUNDAY_STUDY_MINUTES = 360;

/** Total marks across the APPSC Group-1 exam (used by progress/analytics). */
export const TOTAL_MARKS = 825;

/**
 * Planned study-plan length in days. Placeholder for Stage 1; the real value
 * will be derived from the content model in a later stage.
 */
export const PLAN_LENGTH_DAYS = 180;

/** Frozen aggregate config object for convenient consumption. */
export const CONFIG = {
  appName: APP_NAME,
  examNotification: EXAM_NOTIFICATION,
  defaultExamDate: DEFAULT_EXAM_DATE,
  totalMarks: TOTAL_MARKS,
  planLengthDays: PLAN_LENGTH_DAYS,
} as const;

export type AppConfig = typeof CONFIG;
