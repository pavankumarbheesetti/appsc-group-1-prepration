/**
 * Persistent app state — the ONE place that touches localStorage.
 *
 * The state shape is fully typed and persisted on every mutation. Persistence
 * is best-effort: on `file://` (double-clicked single-file build) or in a
 * privacy-locked browser, `localStorage` can be unavailable or throw. We detect
 * that once and transparently fall back to an in-memory string so the app never
 * crashes — it just won't survive a reload in that environment.
 *
 * `exportStateJSON` / `importStateJSON` exist so a learner can move progress
 * between laptop and phone by copy-pasting a JSON blob (a preserved strength of
 * the old app).
 *
 * This module is intentionally the only non-pure part of the state/engine layer.
 */
import type { NotebookEntry } from '../engine/notebook';
import type { SrCard } from '../engine/spaced-repetition';
import { DEFAULT_EXAM_DATE, DEFAULT_STUDY_MINUTES, DEFAULT_SUNDAY_STUDY_MINUTES, OLD_DEFAULT_EXAM_DATE } from '../config';
import { isValidISODate, todayISO } from '../lib/dates';
import { z } from 'zod';

/** Per-question progress counters. */
export interface ProgressEntry {
  seen: number;
  correct: number;
  wrong: number;
  lastResult?: 'correct' | 'wrong';
}

/**
 * A learner's saved work for ONE Mains practice question, keyed by the question
 * id in {@link AppState.mains}. Holds the free-text answer `draft`, the per-
 * criterion self-eval `rubric` scores (0–2 each, in RUBRIC criterion order),
 * and the `updatedAt` epoch-ms of the last save.
 */
export interface MainsDraft {
  /** The learner's written answer text (may be empty). */
  draft: string;
  /** Per-criterion self-eval scores (0–2), in rubric-criterion order. */
  rubric: number[];
  /** Epoch-ms timestamp of the last save. */
  updatedAt: number;
}

/**
 * A learner's saved work for ONE English writing task, keyed by the writing
 * FORMAT key in {@link AppState.english} (e.g. `'letter'`, `'precis'`). Holds
 * the free-text `draft`, the self-evaluation `checks` (one boolean per checklist
 * criterion, in criterion order), and the `updatedAt` epoch-ms of the last save.
 */
export interface EnglishDraft {
  /** The learner's written practice text (may be empty). */
  draft: string;
  /** Per-criterion self-eval ticks, in checklist-criterion order. */
  checks: boolean[];
  /** Epoch-ms timestamp of the last save. */
  updatedAt: number;
}

/** User-facing display settings. */
export interface Settings {
  theme: 'light' | 'dark';
  /** Root font scale multiplier (e.g. 1 = 100%, 1.2 = 120%). */
  fontScale: number;
  /**
   * Target EXAM DATE as an ISO `YYYY-MM-DD` string — the single date the whole
   * planner (countdown, day-by-day plan, feasibility) is anchored on. Editable
   * by the learner; defaults to {@link DEFAULT_EXAM_DATE} on first run.
   */
  examDate: string;
  /**
   * The date the study plan STARTED (ISO `YYYY-MM-DD`), captured once on first
   * run (defaults to today). Anchors "expected progress by today" so falling
   * behind is measured from when the learner actually began, not the exam.
   */
  planStartDate: string;
  /**
   * The learner's DAILY study-time budget in MINUTES — the planner never
   * schedules a weekday beyond this. Defaults to {@link DEFAULT_STUDY_MINUTES}
   * (4 h) for a working professional; editable in Settings.
   */
  dailyStudyMinutes: number;
  /**
   * The SUNDAY study-time budget in MINUTES. Sunday is the one day the learner
   * asked for extra time; the planner spends the extra Sunday minutes on Polity
   * and Modern History (see the planner's Sunday shape). Defaults to
   * {@link DEFAULT_SUNDAY_STUDY_MINUTES} (6 h). Saturday is a mock day and
   * simply follows {@link dailyStudyMinutes}, so it has no separate budget.
   *
   * Migrated from the retired optional `weekendStudyMinutes` (see
   * {@link normalize}): a stored weekend budget greater than the daily budget is
   * carried over; otherwise the Sunday default applies.
   */
  sundayStudyMinutes: number;
  /**
   * One-time Today notice flag: set `true` by the load-time migration when a
   * stored exam date equal to the retired old default ({@link
   * OLD_DEFAULT_EXAM_DATE}, 15 Nov 2026) was auto-moved to the detailed-
   * notification Prelims date ({@link DEFAULT_EXAM_DATE}, 24 Jan 2027). Today
   * shows the banner once, then {@link dismissPrelimsDateNotice} clears it.
   * Absent/false means no notice is pending.
   */
  prelimsDateMigrationNotice?: boolean;
}

/** The complete persisted application state. */
export interface AppState {
  /** Schema version, for future migrations. */
  version: number;
  settings: Settings;
  progress: Record<string, ProgressEntry>;
  sr: Record<string, SrCard>;
  notebook: Record<string, NotebookEntry>;
  /**
   * Spaced-repetition cards for the Revision FLASHCARDS, keyed by flashcard id.
   * Deliberately SEPARATE from `sr` (which tracks MCQ drills) so the two decks
   * never collide even if an id were ever shared.
   */
  flashcards: Record<string, SrCard>;
  /**
   * Mains WRITING practice, keyed by Mains question id. Each entry persists the
   * learner's answer draft and self-eval rubric scores. OPTIONAL on disk /
   * import — an older blob without this key normalises to `{}` (see
   * {@link normalize}), so it is fully backward-compatible.
   */
  mains: Record<string, MainsDraft>;
  /**
   * Telugu SCRIPT-course progress: a flat map of `glyphId → true` for every
   * vowel / consonant / syllable / word / sentence the learner has marked
   * "learned" in the `#/telugu` course. OPTIONAL on disk / import — an older
   * blob without this key normalises to `{}` (see {@link normalize}), so it is
   * fully backward-compatible. A missing/false entry means "not yet learned".
   */
  telugu: Record<string, boolean>;
  /**
   * English WRITING practice, keyed by writing-format key (e.g. `'letter'`,
   * `'essay'`). Each entry persists the learner's draft plus a self-eval
   * checklist. OPTIONAL on disk / import — an older blob without this key
   * normalises to `{}` (see {@link normalize}), so it is fully
   * backward-compatible.
   */
  english: Record<string, EnglishDraft>;
}

/** A mutator receives a mutable draft and edits it in place. */
export type Mutator = (draft: AppState) => void;

/** A subscriber invoked with the new state after each persist. */
export type Listener = (state: AppState) => void;

/* -------------------------------------------------------------------------- */
/* Runtime schemas for imported state (per-entry validation)                   */
/* -------------------------------------------------------------------------- */

/**
 * Zod schemas mirroring the persisted record-value types. They exist so that
 * {@link importStateJSON} can validate every entry of an untrusted blob (not
 * just the top-level shape) and reject a malformed import outright. Each schema
 * is annotated with its `z.ZodType<T>` so it can never silently drift from the
 * TypeScript interface it guards.
 * @internal
 */
const ProgressEntrySchema: z.ZodType<ProgressEntry> = z.object({
  seen: z.number(),
  correct: z.number(),
  wrong: z.number(),
  lastResult: z.enum(['correct', 'wrong']).optional(),
});

const SrCardSchema: z.ZodType<SrCard> = z.object({
  id: z.string(),
  box: z.number(),
  due: z.number(),
  lapses: z.number(),
});

const NotebookEntrySchema: z.ZodType<NotebookEntry> = z.object({
  id: z.string(),
  addedAt: z.number(),
  consecutiveCorrect: z.number(),
  graduated: z.boolean(),
});

const MainsDraftSchema: z.ZodType<MainsDraft> = z.object({
  draft: z.string(),
  rubric: z.array(z.number()),
  updatedAt: z.number(),
});

/** Each Telugu progress entry is simply a boolean "learned" flag. @internal */
const TeluguFlagSchema: z.ZodType<boolean> = z.boolean();

const EnglishDraftSchema: z.ZodType<EnglishDraft> = z.object({
  draft: z.string(),
  checks: z.array(z.boolean()),
  updatedAt: z.number(),
});

/** Current state schema version. */
export const STATE_VERSION = 1;

/** localStorage key the whole state blob is stored under. */
const STORAGE_KEY = 'appsc-g1-state';

/* -------------------------------------------------------------------------- */
/* Storage backend (localStorage with in-memory fallback)                      */
/* -------------------------------------------------------------------------- */

/** Once any localStorage op throws, we permanently use the memory fallback. */
let useMemory = false;
/** The in-memory fallback value when localStorage is unavailable. */
let memoryValue: string | null = null;

/** Read the raw stored string, transparently falling back to memory. */
function readRaw(): string | null {
  if (useMemory) return memoryValue;
  try {
    return globalThis.localStorage.getItem(STORAGE_KEY);
  } catch {
    // localStorage unavailable (e.g. file://) — switch to memory for good.
    useMemory = true;
    return memoryValue;
  }
}

/** Write the raw stored string, transparently falling back to memory. */
function writeRaw(value: string): void {
  if (!useMemory) {
    try {
      globalThis.localStorage.setItem(STORAGE_KEY, value);
      return;
    } catch {
      // setItem can throw (quota, disabled) — fall back to memory for good.
      useMemory = true;
    }
  }
  memoryValue = value;
}

/* -------------------------------------------------------------------------- */
/* Defaults + normalization                                                    */
/* -------------------------------------------------------------------------- */

/** A pristine default state. */
export function defaultState(): AppState {
  return {
    version: STATE_VERSION,
    settings: {
      theme: 'light',
      fontScale: 1,
      examDate: DEFAULT_EXAM_DATE,
      // Captured once, on first run: the plan starts "today".
      planStartDate: todayISO(),
      dailyStudyMinutes: DEFAULT_STUDY_MINUTES,
      sundayStudyMinutes: DEFAULT_SUNDAY_STUDY_MINUTES,
    },
    progress: {},
    sr: {},
    notebook: {},
    flashcards: {},
    mains: {},
    telugu: {},
    english: {},
  };
}

/**
 * Coerce an arbitrary parsed value into a valid {@link AppState}, filling any
 * missing/typo'd fields from defaults. Keeps a corrupt or partial blob from
 * ever crashing the app, and is the merge used by both load and import.
 * @internal
 */
function normalize(input: unknown): AppState {
  const base = defaultState();
  if (typeof input !== 'object' || input === null) return base;
  const obj = input as Partial<AppState>;
  const settings = (obj.settings ?? {}) as Partial<Settings>;
  return {
    version: typeof obj.version === 'number' ? obj.version : STATE_VERSION,
    settings: {
      theme: settings.theme === 'dark' ? 'dark' : 'light',
      fontScale:
        typeof settings.fontScale === 'number' && settings.fontScale > 0
          ? settings.fontScale
          : 1,
      // Backward-compatible + Notification 07/2026 MIGRATION: a stored exam
      // date equal to the retired OLD default (15 Nov 2026) is auto-moved to the
      // new detailed-notification Prelims date (24 Jan 2027) and a one-time Today
      // notice is flagged. Any OTHER stored date is a learner choice and is left
      // untouched (a malformed date falls back to the new default).
      examDate: migrateExamDate(settings),
      planStartDate:
        typeof settings.planStartDate === 'string' &&
        isValidISODate(settings.planStartDate)
          ? settings.planStartDate
          : base.settings.planStartDate,
      // A positive whole-minute budget, else the sensible working-pro default.
      dailyStudyMinutes:
        typeof settings.dailyStudyMinutes === 'number' && settings.dailyStudyMinutes > 0
          ? Math.round(settings.dailyStudyMinutes)
          : base.settings.dailyStudyMinutes,
      // SUNDAY budget, migrated from the retired optional `weekendStudyMinutes`:
      //  - a valid stored `sundayStudyMinutes` wins;
      //  - else a legacy `weekendStudyMinutes` GREATER THAN the daily budget is
      //    carried over (it was a genuine "extra weekend time" the learner set);
      //  - else the sensible Sunday default (extra time for Polity + Modern
      //    History).
      sundayStudyMinutes: migrateSundayMinutes(settings),
      prelimsDateMigrationNotice: migratePrelimsNotice(settings),
    },
    progress: isRecord(obj.progress) ? (obj.progress as AppState['progress']) : {},
    sr: isRecord(obj.sr) ? (obj.sr as AppState['sr']) : {},
    notebook: isRecord(obj.notebook) ? (obj.notebook as AppState['notebook']) : {},
    flashcards: isRecord(obj.flashcards) ? (obj.flashcards as AppState['flashcards']) : {},
    mains: isRecord(obj.mains) ? (obj.mains as AppState['mains']) : {},
    telugu: isRecord(obj.telugu) ? (obj.telugu as AppState['telugu']) : {},
    english: isRecord(obj.english) ? (obj.english as AppState['english']) : {},
  };
}

/** True for a plain, non-null, non-array object. @internal */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Resolve the persisted exam date, applying the Notification 07/2026 migration:
 * a stored date equal to the retired OLD default ({@link OLD_DEFAULT_EXAM_DATE},
 * 15 Nov 2026) is moved to the new default ({@link DEFAULT_EXAM_DATE}, 24 Jan
 * 2027); any other valid date is kept; a malformed/absent date falls back to the
 * new default. @internal
 */
function migrateExamDate(settings: Partial<Settings>): string {
  const stored = settings.examDate;
  if (stored === OLD_DEFAULT_EXAM_DATE) return DEFAULT_EXAM_DATE;
  if (typeof stored === 'string' && isValidISODate(stored)) return stored;
  return DEFAULT_EXAM_DATE;
}

/**
 * Whether the one-time "Prelims moved to 24 Jan 2027" Today notice is pending:
 * `true` when the stored exam date is the retired old default (so this load
 * migrates it), else the stored flag (so a dismissed notice stays dismissed).
 * A fresh install (new default) never shows it. @internal
 */
function migratePrelimsNotice(settings: Partial<Settings>): boolean {
  if (settings.examDate === OLD_DEFAULT_EXAM_DATE) return true;
  return (settings as { prelimsDateMigrationNotice?: unknown }).prelimsDateMigrationNotice === true;
}

/**
 * Resolve the persisted SUNDAY study budget, migrating the retired optional
 * `weekendStudyMinutes` field. Order of preference:
 *  1. a valid stored `sundayStudyMinutes` (positive whole minutes);
 *  2. a legacy `weekendStudyMinutes` GREATER THAN the resolved daily budget
 *     (the learner had genuinely set extra weekend time — carry it to Sunday);
 *  3. the {@link DEFAULT_SUNDAY_STUDY_MINUTES} default.
 * @internal
 */
function migrateSundayMinutes(settings: Partial<Settings>): number {
  const sunday = (settings as { sundayStudyMinutes?: unknown }).sundayStudyMinutes;
  if (typeof sunday === 'number' && sunday > 0) return Math.round(sunday);
  const daily =
    typeof settings.dailyStudyMinutes === 'number' && settings.dailyStudyMinutes > 0
      ? Math.round(settings.dailyStudyMinutes)
      : DEFAULT_STUDY_MINUTES;
  const legacyWeekend = (settings as { weekendStudyMinutes?: unknown }).weekendStudyMinutes;
  if (typeof legacyWeekend === 'number' && legacyWeekend > daily) return Math.round(legacyWeekend);
  return DEFAULT_SUNDAY_STUDY_MINUTES;
}

/**
 * Validate every value of a record map against `schema`, throwing on the first
 * malformed entry with a message that names the map, key, and Zod issues. Used
 * by {@link importStateJSON} so an untrusted blob can never inject entries that
 * violate the persisted types. @internal
 */
function validateEntries<T>(
  name: string,
  schema: z.ZodType<T>,
  map: Readonly<Record<string, unknown>>,
): void {
  for (const [key, value] of Object.entries(map)) {
    const result = schema.safeParse(value);
    if (!result.success) {
      const detail = result.error.issues
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ');
      throw new Error(`Invalid ${name} entry '${key}': ${detail}`);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                  */
/* -------------------------------------------------------------------------- */

/** In-process cache of the current state; the single source of truth at runtime. */
let current: AppState | null = null;
/** Registered change listeners. */
const listeners = new Set<Listener>();

/** Load state (cached after first read), normalizing whatever was persisted. */
export function loadState(): AppState {
  if (current) return current;
  const raw = readRaw();
  if (raw === null) {
    current = defaultState();
    return current;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    current = normalize(parsed);
    // Persist the Notification 07/2026 exam-date migration ONCE so it does not
    // re-fire on every load. Write directly (no listener churn at load time).
    const storedExam = (parsed as { settings?: { examDate?: unknown } })?.settings?.examDate;
    if (storedExam === OLD_DEFAULT_EXAM_DATE && current.settings.examDate === DEFAULT_EXAM_DATE) {
      writeRaw(JSON.stringify(current));
    }
  } catch {
    // Corrupt JSON — start fresh rather than crash.
    current = defaultState();
  }
  return current;
}

/** Persist `state`, update the cache, and notify subscribers. */
export function saveState(state: AppState): void {
  current = state;
  writeRaw(JSON.stringify(state));
  for (const listener of listeners) listener(state);
}

/**
 * Apply `mutator` to a clone of the current state and persist the result.
 * Cloning keeps the previous cached object referentially unchanged, which is
 * friendly to listeners that diff by identity. Returns the new state.
 */
export function updateState(mutator: Mutator): AppState {
  const draft = structuredClone(loadState());
  mutator(draft);
  saveState(draft);
  return draft;
}

/** Subscribe to state changes; returns an unsubscribe function. */
export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/* -------------------------------------------------------------------------- */
/* Planner settings accessors (exam date / plan start)                         */
/* -------------------------------------------------------------------------- */

/** The target exam date (ISO `YYYY-MM-DD`) the planner is anchored on. */
export function getExamDate(): string {
  return loadState().settings.examDate;
}

/**
 * Persist a new target exam date and return the updated state. Invalid input
 * (not a real ISO calendar date) is IGNORED so the setting can never be
 * corrupted from the UI; the caller can re-read {@link getExamDate} to confirm.
 */
export function setExamDate(iso: string): AppState {
  if (!isValidISODate(iso)) return loadState();
  return updateState((s) => {
    s.settings.examDate = iso;
  });
}

/** The date the plan started (ISO `YYYY-MM-DD`). */
export function getPlanStartDate(): string {
  return loadState().settings.planStartDate;
}

/**
 * Whether the one-time "Prelims moved to 24 Jan 2027" notice is pending on
 * Today — set by the load-time Notification 07/2026 exam-date migration.
 */
export function getPrelimsDateMigrationNotice(): boolean {
  return loadState().settings.prelimsDateMigrationNotice === true;
}

/** Dismiss the one-time Prelims-date-moved notice (persists so it stays gone). */
export function dismissPrelimsDateNotice(): AppState {
  return updateState((s) => {
    s.settings.prelimsDateMigrationNotice = false;
  });
}

/** The learner's DAILY study-time budget in minutes. */
export function getDailyStudyMinutes(): number {
  return loadState().settings.dailyStudyMinutes;
}

/**
 * The SUNDAY study-time budget in minutes (defaults to
 * {@link DEFAULT_SUNDAY_STUDY_MINUTES} on first run). Saturday is a mock day and
 * follows the daily budget, so it has no separate accessor.
 */
export function getSundayStudyMinutes(): number {
  return loadState().settings.sundayStudyMinutes;
}

/** The Sunday budget the planner uses — the same value {@link getSundayStudyMinutes} returns. */
export function getEffectiveSundayStudyMinutes(): number {
  return loadState().settings.sundayStudyMinutes;
}

/**
 * Persist a new DAILY study-time budget (minutes). A non-positive/invalid value
 * is IGNORED so the setting can never be corrupted from the UI. Returns state.
 */
export function setDailyStudyMinutes(minutes: number): AppState {
  if (!Number.isFinite(minutes) || minutes <= 0) return loadState();
  return updateState((s) => {
    s.settings.dailyStudyMinutes = Math.round(minutes);
  });
}

/**
 * Persist the SUNDAY study-time budget (minutes). A non-positive/invalid value
 * is IGNORED so the setting can never be corrupted from the UI. Returns state.
 */
export function setSundayStudyMinutes(minutes: number): AppState {
  if (!Number.isFinite(minutes) || minutes <= 0) return loadState();
  return updateState((s) => {
    s.settings.sundayStudyMinutes = Math.round(minutes);
  });
}

/* -------------------------------------------------------------------------- */
/* Mains writing-practice accessors (draft + self-eval rubric)                 */
/* -------------------------------------------------------------------------- */

/** The saved Mains work for `id`, or `undefined` if nothing is stored yet. */
export function getMainsEntry(id: string): MainsDraft | undefined {
  return loadState().mains[id];
}

/**
 * Persist the answer `draft` for Mains question `id`, preserving any existing
 * rubric scores and stamping `updatedAt`. Returns the updated state.
 */
export function saveMainsDraft(id: string, draft: string): AppState {
  return updateState((s) => {
    const prev = s.mains[id];
    s.mains[id] = { draft, rubric: prev?.rubric ?? [], updatedAt: Date.now() };
  });
}

/**
 * Persist the self-eval `rubric` scores for Mains question `id`, preserving any
 * existing draft and stamping `updatedAt`. Returns the updated state.
 */
export function saveMainsRubric(id: string, rubric: number[]): AppState {
  return updateState((s) => {
    const prev = s.mains[id];
    s.mains[id] = { draft: prev?.draft ?? '', rubric: [...rubric], updatedAt: Date.now() };
  });
}

/** Remove all saved work (draft + rubric) for Mains question `id`. */
export function clearMains(id: string): AppState {
  return updateState((s) => {
    delete s.mains[id];
  });
}

/* -------------------------------------------------------------------------- */
/* Telugu course accessors (per-glyph learned flags)                           */
/* -------------------------------------------------------------------------- */

/** The whole Telugu progress map (`glyphId → true`). */
export function getTeluguProgress(): Readonly<Record<string, boolean>> {
  return loadState().telugu;
}

/** Whether the learner has marked glyph `id` as learned. */
export function isTeluguLearned(id: string): boolean {
  return loadState().telugu[id] === true;
}

/**
 * Set (or clear) the learned flag for Telugu glyph `id`. Setting `false` DELETES
 * the key rather than storing `false`, keeping the persisted map compact.
 * Returns the updated state.
 */
export function setTeluguLearned(id: string, learned: boolean): AppState {
  return updateState((s) => {
    if (learned) s.telugu[id] = true;
    else delete s.telugu[id];
  });
}

/**
 * Toggle the learned flag for Telugu glyph `id` and return the NEW flag value.
 * A convenience for the course's "Mark learned" control.
 */
export function toggleTeluguLearned(id: string): boolean {
  const next = !isTeluguLearned(id);
  setTeluguLearned(id, next);
  return next;
}

/* -------------------------------------------------------------------------- */
/* English writing-practice accessors (draft + self-eval checklist)            */
/* -------------------------------------------------------------------------- */

/** The saved English work for writing-format `key`, or `undefined` if none. */
export function getEnglishEntry(key: string): EnglishDraft | undefined {
  return loadState().english[key];
}

/**
 * Persist the practice `draft` for writing-format `key`, preserving any existing
 * checklist ticks and stamping `updatedAt`. Returns the updated state.
 */
export function saveEnglishDraft(key: string, draft: string): AppState {
  return updateState((s) => {
    const prev = s.english[key];
    s.english[key] = { draft, checks: prev?.checks ?? [], updatedAt: Date.now() };
  });
}

/**
 * Persist the self-eval `checks` for writing-format `key`, preserving any
 * existing draft and stamping `updatedAt`. Returns the updated state.
 */
export function saveEnglishChecks(key: string, checks: boolean[]): AppState {
  return updateState((s) => {
    const prev = s.english[key];
    s.english[key] = { draft: prev?.draft ?? '', checks: [...checks], updatedAt: Date.now() };
  });
}

/** Remove all saved work (draft + checks) for writing-format `key`. */
export function clearEnglish(key: string): AppState {
  return updateState((s) => {
    delete s.english[key];
  });
}

/** Serialize the current state as pretty JSON (for laptop↔phone transfer). */
export function exportStateJSON(): string {
  return JSON.stringify(loadState(), null, 2);
}

/**
 * Import state from a JSON string (validated, normalized + persisted). Returns
 * the applied state.
 *
 * The top-level shape is coerced by {@link normalize}; on top of that, EVERY
 * entry of the `progress`, `sr`, and `notebook` maps is validated per-entry
 * against its Zod schema. A single malformed entry rejects the whole import
 * (nothing is persisted) — the simplest, safest behavior for untrusted blobs.
 *
 * @throws SyntaxError if `str` is not valid JSON.
 * @throws Error if any progress/sr/notebook entry is malformed.
 */
export function importStateJSON(str: string): AppState {
  const parsed: unknown = JSON.parse(str);
  const next = normalize(parsed);
  // Reject the whole import if any record entry violates its type.
  validateEntries('progress', ProgressEntrySchema, next.progress);
  validateEntries('sr', SrCardSchema, next.sr);
  validateEntries('notebook', NotebookEntrySchema, next.notebook);
  // The flashcards SR map reuses the same per-entry card schema as `sr`.
  validateEntries('flashcards', SrCardSchema, next.flashcards);
  // The Mains writing map: validate every draft/rubric entry.
  validateEntries('mains', MainsDraftSchema, next.mains);
  // The Telugu course map: every entry must be a boolean learned-flag.
  validateEntries('telugu', TeluguFlagSchema, next.telugu);
  // The English writing map: validate every draft/checks entry.
  validateEntries('english', EnglishDraftSchema, next.english);
  saveState(next);
  return next;
}

/**
 * Reset ALL learner PROGRESS while PRESERVING display settings (theme, font
 * scale, exam date, plan start). Clears every progress-bearing map — drills,
 * spaced-repetition, notebook, flashcards, and the Mains / Telugu / English
 * practice stores — then persists. Returns the new state. This is the
 * destructive "reset all progress" the Settings view guards behind a confirm.
 */
export function resetProgress(): AppState {
  return updateState((s) => {
    s.progress = {};
    s.sr = {};
    s.notebook = {};
    s.flashcards = {};
    s.mains = {};
    s.telugu = {};
    s.english = {};
  });
}

/**
 * Reset the in-process cache and storage-backend flags. Test-only helper so
 * suites don't leak state into one another; not used by the app itself.
 * @internal
 */
export function __resetForTests(): void {
  current = null;
  listeners.clear();
  useMemory = false;
  memoryValue = null;
}
