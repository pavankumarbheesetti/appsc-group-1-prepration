import { describe, it, expect } from 'vitest';
import {
  TRACKED_STAGES,
  stageIds,
  learnedCount,
  stageTally,
  courseTally,
  type TeluguProgress,
} from '../telugu';
import {
  VOWELS,
  CONSONANTS,
  GUNINTALU,
  VATTULU,
  NUMBERS,
  STARTER_WORDS,
  STARTER_SENTENCES,
} from '../../content/telugu';

/** Mark every id in `ids` as learned. */
function learnAll(ids: readonly string[]): TeluguProgress {
  const p: Record<string, boolean> = {};
  for (const id of ids) p[id] = true;
  return p;
}

describe('telugu dataset shape', () => {
  it('has the documented canonical counts', () => {
    expect(VOWELS.length).toBe(15);
    expect(CONSONANTS.length).toBe(36);
    expect(GUNINTALU.length).toBe(15);
    expect(VATTULU.length).toBe(6);
    expect(NUMBERS.length).toBe(10);
    expect(STARTER_WORDS.length).toBe(15);
    expect(STARTER_SENTENCES.length).toBe(6);
  });

  it('uses unique, stable ids across every stage', () => {
    const all = TRACKED_STAGES.flatMap((s) => stageIds(s));
    expect(new Set(all).size).toBe(all.length);
  });

  it('maps the gunintam cells 1:1 onto the vowel order', () => {
    expect(GUNINTALU.map((g) => g.vowel)).toEqual(VOWELS.map((v) => v.translit));
  });
});

describe('stageIds', () => {
  it('returns the ids of a stage in order', () => {
    expect(stageIds('vowels')).toEqual(VOWELS.map((v) => v.id));
    expect(stageIds('numbers')).toEqual(NUMBERS.map((n) => n.id));
  });

  it('returns an empty list for the intro stage (nothing to track)', () => {
    expect(stageIds('intro')).toEqual([]);
  });
});

describe('learnedCount', () => {
  it('counts only entries flagged true', () => {
    const p: TeluguProgress = { a: true, b: false, c: true };
    expect(learnedCount(p, ['a', 'b', 'c', 'd'])).toBe(2);
  });

  it('is zero for an empty progress map', () => {
    expect(learnedCount({}, stageIds('vowels'))).toBe(0);
  });
});

describe('stageTally', () => {
  it('reports learned/total and completion for a fully-learned stage', () => {
    const p = learnAll(stageIds('numbers'));
    const t = stageTally(p, 'numbers');
    expect(t).toEqual({ learned: 10, total: 10, complete: true });
  });

  it('is incomplete when some glyphs remain', () => {
    const firstVowel = VOWELS[0]!.id;
    const t = stageTally({ [firstVowel]: true }, 'vowels');
    expect(t.learned).toBe(1);
    expect(t.total).toBe(15);
    expect(t.complete).toBe(false);
  });

  it('never marks the intro stage complete (0/0)', () => {
    expect(stageTally({}, 'intro')).toEqual({ learned: 0, total: 0, complete: false });
  });
});

describe('courseTally', () => {
  it('is 0% for a fresh learner', () => {
    const c = courseTally({});
    expect(c.learned).toBe(0);
    expect(c.pct).toBe(0);
    expect(c.stagesComplete).toBe(0);
    // total = sum of all tracked stages
    expect(c.total).toBe(15 + 36 + 15 + 6 + 10 + 15 + 6);
  });

  it('is 100% and counts every tracked stage when all glyphs are learned', () => {
    const everything = learnAll(TRACKED_STAGES.flatMap((s) => stageIds(s)));
    const c = courseTally(everything);
    expect(c.learned).toBe(c.total);
    expect(c.pct).toBe(100);
    expect(c.stagesComplete).toBe(TRACKED_STAGES.length);
  });

  it('rounds partial progress to a whole percentage', () => {
    // Learn exactly the 10 numbers out of 103 total glyphs → ~10%.
    const c = courseTally(learnAll(stageIds('numbers')));
    expect(c.learned).toBe(10);
    expect(c.stagesComplete).toBe(1);
    expect(c.pct).toBe(Math.round((10 / c.total) * 100));
  });
});
