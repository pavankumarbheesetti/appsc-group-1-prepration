/**
 * Telugu course PROGRESS helpers — PURE functions (no DOM, no I/O) that tally a
 * learner's per-glyph "learned" flags into per-stage and course-level progress.
 *
 * The Telugu view keeps all canvas/audio work in the browser layer; everything
 * that can be reasoned about deterministically (which glyphs belong to a stage,
 * how many are learned, whether a stage is complete) lives here so it is
 * trivially unit-testable. Progress is a flat `Record<glyphId, boolean>` — the
 * exact shape persisted at `AppState.telugu`.
 */
import {
  CONSONANTS,
  GUNINTALU,
  NUMBERS,
  STARTER_SENTENCES,
  STARTER_WORDS,
  VATTULU,
  VOWELS,
  type TeluguStage,
} from '../content/telugu';

/** The learner's per-glyph learned flags (id → true). Missing/false = not learned. */
export type TeluguProgress = Readonly<Record<string, boolean>>;

/** The stages that contain trackable glyphs, in course order. */
export const TRACKED_STAGES: readonly TeluguStage[] = [
  'vowels',
  'consonants',
  'gunintalu',
  'vattulu',
  'numbers',
  'words',
  'sentences',
];

/**
 * The trackable glyph ids for a stage, in display order. `intro` carries no
 * trackable glyphs and returns an empty list.
 */
export function stageIds(stage: TeluguStage): readonly string[] {
  switch (stage) {
    case 'vowels':
      return VOWELS.map((v) => v.id);
    case 'consonants':
      return CONSONANTS.map((c) => c.id);
    case 'gunintalu':
      return GUNINTALU.map((g) => g.id);
    case 'vattulu':
      return VATTULU.map((x) => x.id);
    case 'numbers':
      return NUMBERS.map((n) => n.id);
    case 'words':
      return STARTER_WORDS.map((w) => w.id);
    case 'sentences':
      return STARTER_SENTENCES.map((s) => s.id);
    case 'intro':
      return [];
  }
}

/** Count how many of `ids` are marked learned in `progress`. */
export function learnedCount(progress: TeluguProgress, ids: readonly string[]): number {
  return ids.reduce((n, id) => (progress[id] === true ? n + 1 : n), 0);
}

/** A stage's learned/total tally and completion flag. */
export interface StageTally {
  learned: number;
  total: number;
  complete: boolean;
}

/**
 * Tally one stage. A stage with no trackable glyphs (e.g. `intro`) is reported
 * as `0/0` and `complete: false` so it is never counted toward the course.
 */
export function stageTally(progress: TeluguProgress, stage: TeluguStage): StageTally {
  const ids = stageIds(stage);
  const learned = learnedCount(progress, ids);
  const total = ids.length;
  return { learned, total, complete: total > 0 && learned === total };
}

/** A course-wide tally across every tracked stage. */
export interface CourseTally {
  learned: number;
  total: number;
  /** Whole-number percentage 0–100 (0 when there is nothing to learn). */
  pct: number;
  /** Count of tracked stages that are fully complete. */
  stagesComplete: number;
}

/** Tally the whole course by summing every tracked stage. */
export function courseTally(progress: TeluguProgress): CourseTally {
  let learned = 0;
  let total = 0;
  let stagesComplete = 0;
  for (const stage of TRACKED_STAGES) {
    const t = stageTally(progress, stage);
    learned += t.learned;
    total += t.total;
    if (t.complete) stagesComplete += 1;
  }
  const pct = total === 0 ? 0 : Math.round((learned / total) * 100);
  return { learned, total, pct, stagesComplete };
}
