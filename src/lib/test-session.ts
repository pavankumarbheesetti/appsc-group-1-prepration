/**
 * RUNNING-TEST autosave — so a timed mock / week test / unit test is never lost
 * to a Back press, a nav tap or a reload.
 *
 * The runner writes a {@link TestSession} snapshot (answers, confidence tags,
 * flags, current question and TIME LEFT) on every change and once a second;
 * leaving the test pauses the clock at the saved time. Today and the Mock page
 * read {@link loadTestSession} to offer "Resume test". Submitting (or
 * discarding) clears it.
 *
 * Stored under its own key (not inside the main app-state blob) because it is
 * transient working memory, not learner history: export/import and the state
 * schema are untouched. Falls back to in-memory storage when localStorage is
 * unavailable (privacy mode), matching the store's behaviour.
 */
import { z } from 'zod';

/** localStorage key for the in-flight test. */
export const TEST_SESSION_KEY = 'appsc-g1-test-session';

/** How results are rebuilt on resume (the runner's results renderer). */
export type ResultsSpec =
  | { type: 'generic' }
  | {
      type: 'week';
      dateISO: string;
      count: number;
      requested: number;
      durationMin: number;
      sectionByIndex: Array<'paper1' | 'paper2'>;
      short: boolean;
    }
  | {
      type: 'paper';
      paper: 'paper1' | 'paper2';
      mockNumber: number;
      sections: Array<{ id: string; wrapped: boolean }>;
      sectionByIndex: string[];
    };

/** One in-flight timed test. */
export interface TestSession {
  v: 1;
  /** Runner kind (`week-test`, `unit-test`, `full-mock`, `sectional-mock`, `scoped-mock`). */
  kind: string;
  /** Human title for the Resume card. */
  title: string;
  itemIds: string[];
  selected: Array<number | null>;
  confidences: Array<'sure' | 'fifty' | 'guess' | null>;
  flagged: boolean[];
  idx: number;
  /** Time left on the clock when last saved (the clock is paused while away). */
  remainingMs: number;
  durationMs: number;
  savedAt: number;
  results: ResultsSpec;
}

const ResultsSpecSchema = z.union([
  z.object({ type: z.literal('generic') }),
  z.object({
    type: z.literal('week'),
    dateISO: z.string(),
    count: z.number(),
    requested: z.number(),
    durationMin: z.number(),
    sectionByIndex: z.array(z.enum(['paper1', 'paper2'])),
    short: z.boolean(),
  }),
  z.object({
    type: z.literal('paper'),
    paper: z.enum(['paper1', 'paper2']),
    mockNumber: z.number(),
    sections: z.array(z.object({ id: z.string(), wrapped: z.boolean() })),
    sectionByIndex: z.array(z.string()),
  }),
]);

const TestSessionSchema = z.object({
  v: z.literal(1),
  kind: z.string(),
  title: z.string(),
  itemIds: z.array(z.string()).min(1),
  selected: z.array(z.number().int().nullable()),
  confidences: z.array(z.enum(['sure', 'fifty', 'guess']).nullable()),
  flagged: z.array(z.boolean()),
  idx: z.number().int().min(0),
  remainingMs: z.number(),
  durationMs: z.number().positive(),
  savedAt: z.number(),
  results: ResultsSpecSchema,
});

let memory: string | null = null;
let useMemory = false;

function read(): string | null {
  if (useMemory) return memory;
  try {
    return globalThis.localStorage.getItem(TEST_SESSION_KEY);
  } catch {
    useMemory = true;
    return memory;
  }
}

function write(value: string | null): void {
  if (!useMemory) {
    try {
      if (value === null) globalThis.localStorage.removeItem(TEST_SESSION_KEY);
      else globalThis.localStorage.setItem(TEST_SESSION_KEY, value);
      return;
    } catch {
      useMemory = true;
    }
  }
  memory = value;
}

/** Persist the in-flight test. */
export function saveTestSession(session: TestSession): void {
  write(JSON.stringify(session));
}

/**
 * The saved in-flight test, or `null` when none / corrupt (a corrupt snapshot
 * is dropped). Array lengths are checked against the question list.
 */
export function loadTestSession(): TestSession | null {
  const raw = read();
  if (raw === null) return null;
  try {
    const parsed = TestSessionSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      write(null);
      return null;
    }
    const s = parsed.data as TestSession;
    const n = s.itemIds.length;
    if (s.selected.length !== n || s.confidences.length !== n || s.flagged.length !== n) {
      write(null);
      return null;
    }
    if (s.idx >= n) s.idx = 0;
    return s;
  } catch {
    write(null);
    return null;
  }
}

/** Forget the in-flight test (after submit / discard). */
export function clearTestSession(): void {
  write(null);
}

/** "12 of 45 answered · 31:20 left" for the Resume card. PURE. */
export function resumeSummary(s: Pick<TestSession, 'selected' | 'remainingMs'>): string {
  const answered = s.selected.filter((x) => x !== null).length;
  const totalSec = Math.max(0, Math.ceil(s.remainingMs / 1000));
  const left = `${Math.floor(totalSec / 60)}:${String(totalSec % 60).padStart(2, '0')}`;
  return `${answered} of ${s.selected.length} answered \u00b7 ${left} left`;
}
