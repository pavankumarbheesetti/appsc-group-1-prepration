/**
 * PAUSED-DRILL autosave — so an UNTIMED practice run (topic practice, a Quick
 * 10, a weakest-area drill, a Today CA / Mental Ability set, a notebook review)
 * survives a Pause, a nav tap or a reload. The untimed sibling of
 * {@link ./test-session} (timed tests), kept separate so the timed flow is
 * untouched.
 *
 * The quiz runner writes a {@link DrillSession} after every answer and on every
 * question change; Today, the topic's Practice tab and the Practice hub read it
 * to offer "Resume practice · question 12 of 85". Finishing the run (results)
 * clears it. Answers were already RECORDED (progress / SR / notebook) when they
 * were given — a session only restores the runner's view of them, so resuming
 * never re-records.
 *
 * Up to {@link DRILL_SESSION_CAP} sessions (most recent first, one per key) are
 * stored under ONE localStorage key (not inside the main app-state blob:
 * transient working memory, so export/import and the state schema are
 * untouched). Sessions older than {@link DRILL_SESSION_TTL_DAYS} or naming a
 * question that no longer exists are dropped on load. Falls back to in-memory
 * storage when localStorage is unavailable (privacy mode).
 */
import { z } from 'zod';

/** localStorage key for the paused untimed drills. */
export const DRILL_SESSION_KEY = 'appsc-g1-drill-sessions';
/** Paused drills older than this (by last update) are dropped. */
export const DRILL_SESSION_TTL_DAYS = 2;
/** At most this many paused drills are kept (most recent first). */
export const DRILL_SESSION_CAP = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

/** One saved answer of a paused drill. */
export interface DrillAnswer {
  chosen: number;
  confidence?: 'sure' | 'fifty' | 'guess';
  /** Time spent on the question (for the results breakdown). */
  timeMs?: number;
}

/** One paused untimed practice run. */
export interface DrillSession {
  /** Stable id of the run (`learn:<subtopicId>`, `set:<row>:<date>`, `weak:<id>`, `drill:<scope>`, `notebook`). */
  key: string;
  /** Human label (`Stone Age · Practice`). */
  label: string;
  /** The run's questions, in order. */
  itemIds: string[];
  /** The question the learner was on. */
  index: number;
  /** Answers given so far, by item id (in answered order). */
  answers: Record<string, DrillAnswer>;
  startedAtISO: string;
  updatedAtISO: string;
  /** Hash path that reopens AND resumes the run. */
  route: string;
}

const AnswerSchema = z.object({
  chosen: z.number().int().min(0),
  confidence: z.enum(['sure', 'fifty', 'guess']).optional(),
  timeMs: z.number().min(0).optional(),
});

const SessionSchema = z.object({
  key: z.string().min(1),
  label: z.string(),
  itemIds: z.array(z.string()).min(1),
  index: z.number().int().min(0),
  answers: z.record(AnswerSchema),
  startedAtISO: z.string(),
  updatedAtISO: z.string(),
  route: z.string(),
});

/* -------------------------------------------------------------------------- */
/* Pure helpers                                                                */
/* -------------------------------------------------------------------------- */

/** Whether two item lists are the same questions in the same order. PURE. */
export function sameItems(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/** Whether two item lists hold the same questions (any order). PURE. */
export function sameItemSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return set.size === new Set(b).size && b.every((id) => set.has(id));
}

/** Whether a session is still live at `now` (younger than the TTL). PURE. */
export function isFresh(s: Pick<DrillSession, 'updatedAtISO'>, now: number, ttlDays = DRILL_SESSION_TTL_DAYS): boolean {
  const t = Date.parse(s.updatedAtISO);
  return Number.isFinite(t) && now - t <= ttlDays * DAY_MS;
}

/** Whether every answered question has been answered (a finished run). PURE. */
export function isComplete(s: Pick<DrillSession, 'itemIds' | 'answers'>): boolean {
  return s.itemIds.every((id) => s.answers[id] !== undefined);
}

/**
 * Clean a session list: drop expired, finished, out-of-range and (with
 * `exists`) sessions naming a question that no longer exists; keep ONE per key
 * (the most recently updated); most recent first; capped. PURE.
 */
export function pruneSessions(
  list: readonly DrillSession[],
  now: number,
  exists?: (id: string) => boolean,
): DrillSession[] {
  const byKey = new Map<string, DrillSession>();
  for (const s of list) {
    if (!isFresh(s, now) || isComplete(s)) continue;
    if (exists && !s.itemIds.every(exists)) continue;
    if (Object.keys(s.answers).some((id) => !s.itemIds.includes(id))) continue;
    const prev = byKey.get(s.key);
    if (!prev || Date.parse(s.updatedAtISO) > Date.parse(prev.updatedAtISO)) byKey.set(s.key, s);
  }
  return [...byKey.values()]
    .sort((a, b) => Date.parse(b.updatedAtISO) - Date.parse(a.updatedAtISO))
    .slice(0, DRILL_SESSION_CAP)
    .map((s) => ({ ...s, index: Math.min(s.index, s.itemIds.length - 1) }));
}

/** Insert/replace `s` (same key → replaced) at the front, then prune. PURE. */
export function upsertSession(list: readonly DrillSession[], s: DrillSession, now: number): DrillSession[] {
  return pruneSessions([s, ...list.filter((x) => x.key !== s.key)], now);
}

/**
 * The question a resumed run opens on: the saved one when it is unanswered,
 * else the next unanswered one after it (wrapping), else the saved one. PURE.
 */
export function resumeIndex(s: Pick<DrillSession, 'itemIds' | 'answers' | 'index'>): number {
  const n = s.itemIds.length;
  const start = Math.min(Math.max(0, s.index), n - 1);
  for (let k = 0; k < n; k += 1) {
    const i = (start + k) % n;
    if (s.answers[s.itemIds[i]!] === undefined) return i;
  }
  return start;
}

/** `{ answered, total, question }` (question is 1-based) for a resume entry. PURE. */
export function drillProgress(s: Pick<DrillSession, 'itemIds' | 'answers' | 'index'>): { answered: number; total: number; question: number } {
  return {
    answered: s.itemIds.filter((id) => s.answers[id] !== undefined).length,
    total: s.itemIds.length,
    question: resumeIndex(s) + 1,
  };
}

/** "Resume practice · question 12 of 85". PURE. */
export function resumeText(s: Pick<DrillSession, 'itemIds' | 'answers' | 'index'>): string {
  const p = drillProgress(s);
  return `Resume practice \u00b7 question ${p.question} of ${p.total}`;
}

/** "11 of 85 answered" for a paused-run row. PURE. */
export function answeredText(s: Pick<DrillSession, 'itemIds' | 'answers' | 'index'>): string {
  const p = drillProgress(s);
  return `${p.answered} of ${p.total} answered`;
}

/** A short, stable hash of an id list (for `drill:<scopeHash>` keys). PURE. */
export function scopeHash(parts: readonly string[]): string {
  let h = 5381;
  for (const ch of parts.join('|')) h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0;
  return h.toString(36);
}

/** `path` with `resume=<key>` added to its query. PURE. */
export function withResume(path: string, key: string): string {
  const q = path.indexOf('?');
  const base = q >= 0 ? path.slice(0, q) : path;
  const params = new URLSearchParams(q >= 0 ? path.slice(q + 1) : '');
  params.set('resume', key);
  return `${base}?${params.toString()}`;
}

/* -------------------------------------------------------------------------- */
/* Storage                                                                     */
/* -------------------------------------------------------------------------- */

let memory: string | null = null;
let useMemory = false;

function read(): string | null {
  if (useMemory) return memory;
  try {
    return globalThis.localStorage.getItem(DRILL_SESSION_KEY);
  } catch {
    useMemory = true;
    return memory;
  }
}

function write(value: string | null): void {
  if (!useMemory) {
    try {
      if (value === null) globalThis.localStorage.removeItem(DRILL_SESSION_KEY);
      else globalThis.localStorage.setItem(DRILL_SESSION_KEY, value);
      return;
    } catch {
      useMemory = true;
    }
  }
  memory = value;
}

/** Parse the stored list (corrupt entries are skipped). @internal */
function readAll(): DrillSession[] {
  const raw = read();
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((x) => {
      const r = SessionSchema.safeParse(x);
      return r.success ? [r.data as DrillSession] : [];
    });
  } catch {
    return [];
  }
}

function writeAll(list: readonly DrillSession[]): void {
  write(list.length === 0 ? null : JSON.stringify(list));
}

/**
 * Every live paused drill, most recent first. Expired / finished / invalid
 * sessions (and, with `exists`, those naming a removed question) are dropped
 * from storage too.
 */
export function loadDrillSessions(exists?: (id: string) => boolean, now: number = Date.now()): DrillSession[] {
  const all = readAll();
  const live = pruneSessions(all, now, exists);
  if (live.length !== all.length) writeAll(live);
  return live;
}

/** The live paused drill for `key`, or null. */
export function loadDrillSession(key: string, exists?: (id: string) => boolean, now: number = Date.now()): DrillSession | null {
  return loadDrillSessions(exists, now).find((s) => s.key === key) ?? null;
}

/** Save (insert or replace by key) a paused drill. */
export function saveDrillSession(s: DrillSession, now: number = Date.now()): void {
  writeAll(upsertSession(readAll(), s, now));
}

/** Forget the paused drill for `key` (finished / discarded / changed). */
export function clearDrillSession(key: string): void {
  const all = readAll();
  const next = all.filter((s) => s.key !== key);
  if (next.length !== all.length) writeAll(next);
}

/** Forget every paused drill (tests / reset). */
export function clearAllDrillSessions(): void {
  write(null);
}
