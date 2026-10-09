import { describe, it, expect } from 'vitest';
import {
  answerQuestion,
  buildSession,
  dueQuestionIds,
  refresherFirstSort,
  scoreSession,
  weakQuestionIds,
} from '../drill';
import type { ProgressLike } from '../drill';
import type { MCQItem } from '../../content/types';
import type { SrCard } from '../spaced-repetition';
import { getBanks } from '../../content/loader';

/**
 * The size of the whole MCQ drill pool, COMPUTED from the loaded content (every
 * mcq bank's items) rather than hard-coded, so adding/removing questions keeps
 * these full-scope assertions correct without a manual edit. buildSession with
 * no filter draws from exactly this pool.
 */
const TOTAL_MCQS = getBanks('mcq').reduce((n, b) => n + b.bank.items.length, 0);

// Exercises the drill builder/scorer against the real content pool. The HIST
// pool now spans twenty-three Ancient-India subtopics (IVC + Stone Age, Early/Later
// Vedic, Mahajanapadas, Rise of Magadha, Magadha Dynasties, Jainism,
// Buddhism I & II, Invasion of Alexander, Indo-Greek Invasion, Mauryan Empire,
// the post-Mauryan set: Sungas/Kanvas/Chedis, Satavahanas, Sakas & Parthians,
// Kushanas; the Batch-5 set: Sangam Age, Guptas, Harsha, Post-Gupta
// Pallavas & Chalukyas; and the Batch-6 reference set: Books & Authors,
// Travelers in Ancient India):
// plus the Batch-3 Medieval set (South Indian Dynasties, Delhi Sultanate,
// Vijayanagara & Bahmani, Mughal Empire) and Modern (1857 Revolt):
// 519 MCQs total, ALL tier-LESS (the Batch-6 reference migrations — Books &
// Authors and Travelers — retired the last remaining tiered items, so tier
// 1/2/3 now select none).
// IVC is the coverage-driven EXEMPLAR: a lean 17-MCQ, tier-LESS bank
// (3 refreshers + 14 exam-level), still asserted via subtopicId below.

describe('drill.buildSession', () => {
  it('filters by tier', () => {
    // Content is now fully coverage-driven (tier retired), so no item carries a
    // tier and every tier filter yields an empty pool.
    expect(buildSession({ tier: 1 }).items.every((i) => i.tier === 1)).toBe(true);
    expect(buildSession({ tier: 1 }).items).toHaveLength(0);
    expect(buildSession({ tier: 2 }).items).toHaveLength(0);
    expect(buildSession({ tier: 3 }).items).toHaveLength(0);
  });

  it('filters by subject', () => {
    expect(buildSession({ subjectCode: 'HIST' }).items).toHaveLength(946);
    expect(buildSession({ subjectCode: 'ECON' }).items).toHaveLength(370);
  });

  it('filters by subtopicId', () => {
    // Every IVC MCQ carries subtopicId 'hist-ancient-ivc' (lean exemplar bank).
    expect(buildSession({ subtopicId: 'hist-ancient-ivc' }).items).toHaveLength(19);
    // An unknown subtopic yields nothing.
    expect(buildSession({ subtopicId: 'hist-ancient-does-not-exist' }).items).toHaveLength(0);
    // The IVC exemplar is tier-LESS, so a tier filter selects none of its items.
    expect(buildSession({ subtopicId: 'hist-ancient-ivc', tier: 3 }).items).toHaveLength(0);
  });

  it('treats limit as optional — undefined/0/negative means the whole scope', () => {
    // No limit → every question in scope (full cross-subject pool).
    expect(buildSession({}).items).toHaveLength(TOTAL_MCQS);
    expect(buildSession({ limit: 0 }).items).toHaveLength(TOTAL_MCQS);
    expect(buildSession({ limit: -5 }).items).toHaveLength(TOTAL_MCQS);
    // A positive limit caps the pool.
    expect(buildSession({ limit: 2 }).items).toHaveLength(2);
    expect(buildSession({ limit: 1000 }).items).toHaveLength(1000);
  });

  it("order 'ladder' (the default) is a STABLE order that preserves the pool", () => {
    // Refresher-flagged items (the IVC exemplar plus the Batch-1 coverage banks)
    // float to the top under refresher-first ordering, which is otherwise stable —
    // deterministic and complete over the whole pool.
    const items = buildSession({}).items;
    expect(items).toHaveLength(TOTAL_MCQS);
    // Still a permutation of the whole pool (compare to a shuffled full build).
    const shuffled = buildSession({ seed: 3 }).items;
    expect([...items.map((i) => i.id)].sort()).toEqual([...shuffled.map((i) => i.id)].sort());
  });

  it("ladder is stable and deterministic across calls", () => {
    const a = buildSession({}).items.map((i) => i.id);
    const b = buildSession({}).items.map((i) => i.id);
    expect(a).toEqual(b);
  });

  it('shuffles deterministically for a given seed', () => {
    // A bare seed implies shuffle order even without an explicit `order`.
    const a = buildSession({ seed: 42 }).items.map((i) => i.id);
    const b = buildSession({ seed: 42 }).items.map((i) => i.id);
    const c = buildSession({ seed: 7 }).items.map((i) => i.id);
    expect(a).toEqual(b); // same seed → same order
    expect(a).toHaveLength(TOTAL_MCQS);
    // A different seed still returns the same SET of questions (a permutation).
    expect([...c].sort()).toEqual([...a].sort());
  });

  it('restrictToIds intersects the pool with an explicit allowlist', () => {
    const ids = buildSession({}).items.slice(0, 3).map((i) => i.id);
    const built = buildSession({ restrictToIds: ids }).items.map((i) => i.id);
    // Only the allowed ids survive (order follows the ladder over the pool).
    expect([...built].sort()).toEqual([...ids].sort());
    // Unknown ids simply contribute nothing.
    expect(buildSession({ restrictToIds: ['does-not-exist'] }).items).toHaveLength(0);
    // An empty allowlist yields an empty session.
    expect(buildSession({ restrictToIds: [] }).items).toHaveLength(0);
  });

  it('dueOnly keeps never-seen questions and drops not-yet-due ones', () => {
    const now = 1_000_000;
    // Mark ivc-mcq-1 as far-future due; everything else has no card (=> due).
    const srCards: Record<string, SrCard> = {
      'ivc-mcq-1': { id: 'ivc-mcq-1', box: 3, due: now + 10 * 86_400_000, lapses: 0 },
    };
    const ids = buildSession({ dueOnly: true, srCards, now }).items.map((i) => i.id);
    expect(ids).not.toContain('ivc-mcq-1');
    expect(ids).toHaveLength(TOTAL_MCQS - 1);
  });
});

describe('drill.refresherFirstSort', () => {
  const mk = (id: string, refresher?: boolean): MCQItem =>
    ({
      id,
      subjectCode: 'HIST',
      question: id,
      options: ['a', 'b'],
      answerIndex: 0,
      ...(refresher ? { refresher: true } : {}),
    }) as MCQItem;

  it('puts refreshers first, then exam-level, preserving order within each group', () => {
    const items = [mk('e1'), mk('r1', true), mk('e2'), mk('r2', true), mk('e3')];
    expect(refresherFirstSort(items).map((i) => i.id)).toEqual(['r1', 'r2', 'e1', 'e2', 'e3']);
  });

  it('is a no-op (stable) when nothing is a refresher', () => {
    const items = [mk('a'), mk('b'), mk('c')];
    expect(refresherFirstSort(items).map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate its input', () => {
    const items = [mk('e1'), mk('r1', true)];
    const before = items.map((i) => i.id);
    refresherFirstSort(items);
    expect(items.map((i) => i.id)).toEqual(before);
  });
});

describe('drill.weakQuestionIds', () => {
  const mcqIds = ['q1', 'q2', 'q3', 'q4', 'q5'];

  it('selects seen-but-not-mastered questions, in mcqIds order', () => {
    const progress: Record<string, ProgressLike> = {
      q1: { seen: 2, correct: 1, wrong: 1 }, // wrong>0 → weak
      q2: { seen: 3, correct: 3, wrong: 0 }, // mastered → excluded
      q3: { seen: 2, correct: 1, wrong: 0 }, // correct<seen → weak (e.g. skipped)
      q4: { seen: 0, correct: 0, wrong: 0 }, // never seen → excluded
      // q5 absent from progress → excluded
    };
    expect(weakQuestionIds(progress, mcqIds)).toEqual(['q1', 'q3']);
  });

  it('returns nothing for empty progress', () => {
    expect(weakQuestionIds({}, mcqIds)).toEqual([]);
  });

  it('excludes fully-mastered questions (wrong==0 and correct>=seen)', () => {
    const progress: Record<string, ProgressLike> = {
      q1: { seen: 1, correct: 1, wrong: 0 },
      q2: { seen: 5, correct: 5, wrong: 0 },
    };
    expect(weakQuestionIds(progress, ['q1', 'q2'])).toEqual([]);
  });

  it('only returns ids present in mcqIds', () => {
    const progress: Record<string, ProgressLike> = {
      other: { seen: 1, correct: 0, wrong: 1 },
    };
    expect(weakQuestionIds(progress, mcqIds)).toEqual([]);
  });
});

describe('drill.dueQuestionIds', () => {
  const mcqIds = ['q1', 'q2', 'q3'];
  const now = 1_000_000;

  it('returns only ids whose SR card is due now, in mcqIds order', () => {
    const sr: Record<string, SrCard> = {
      q1: { id: 'q1', box: 1, due: now - 1000, lapses: 0 }, // due
      q2: { id: 'q2', box: 2, due: now + 1000, lapses: 0 }, // not yet due
      // q3 has no card → excluded (never-seen is not "review")
    };
    expect(dueQuestionIds(sr, mcqIds, now)).toEqual(['q1']);
  });

  it('excludes never-seen (no card) questions', () => {
    expect(dueQuestionIds({}, mcqIds, now)).toEqual([]);
  });
});

describe('drill.answerQuestion', () => {
  it('grades the chosen option against the answer', () => {
    const [first] = buildSession({ subjectCode: 'HIST', seed: 1 }).items;
    expect(first).toBeDefined();
    if (!first) return;
    const right = answerQuestion(first, first.answerIndex);
    expect(right.correct).toBe(true);
    expect(right.answerIndex).toBe(first.answerIndex);
    const wrongIndex = (first.answerIndex + 1) % first.options.length;
    expect(answerQuestion(first, wrongIndex).correct).toBe(false);
  });
});

describe('drill.scoreSession', () => {
  it('computes totals and accuracy', () => {
    expect(scoreSession([])).toEqual({ total: 0, correct: 0, wrong: 0, accuracy: 0 });
    expect(scoreSession([{ correct: true }, { correct: false }, { correct: true }, { correct: true }])).toEqual({
      total: 4,
      correct: 3,
      wrong: 1,
      accuracy: 0.75,
    });
  });
});
