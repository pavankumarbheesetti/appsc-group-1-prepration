import { describe, it, expect } from 'vitest';
import {
  parseDMY,
  daysUntil,
  examCountdown,
  overallMastery,
  coverageFraction,
  dueCount,
  bestStreak,
  aggregateSubjects,
  pct,
  niceMax,
  MCQ_TARGET_BY_BAND,
  targetForBand,
  coveragePct,
  subtopicStatus,
  tallySubtopicProgress,
  subtopicMasteryPct,
  statusFromMastery,
  examPointCoverage,
  examPointsPracticed,
  avgTimeMs,
  formatDuration,
  confidenceBreakdown,
  netScore,
  mockScore,
  formatNet,
  NEGATIVE_MARK,
  type SessionAnswerDetail,
  type MockAnswer,
} from '../metrics';
import type { SyllabusMeta, SubjectCode } from '../../content/types';
import type { ProgressEntry } from '../../state/store';
import type { SrCard } from '../../engine/spaced-repetition';
import type { NotebookEntry } from '../../engine/notebook';

describe('parseDMY', () => {
  it('parses a valid DD/MM/YYYY date', () => {
    const d = parseDMY('06/10/2026');
    expect(d).not.toBeNull();
    expect(d?.getFullYear()).toBe(2026);
    expect(d?.getMonth()).toBe(9); // October is month index 9
    expect(d?.getDate()).toBe(6);
  });

  it('rejects malformed or impossible dates', () => {
    expect(parseDMY('2026-10-06')).toBeNull();
    expect(parseDMY('31/02/2026')).toBeNull(); // Feb 31 rolls over → rejected
    expect(parseDMY('garbage')).toBeNull();
  });
});

describe('daysUntil', () => {
  it('counts whole calendar days to a future date', () => {
    const now = new Date(2026, 0, 1, 9, 30).getTime(); // partial day ignored
    const target = new Date(2026, 0, 11, 1, 0).getTime();
    expect(daysUntil(target, now)).toBe(10);
  });

  it('is negative once the date has passed', () => {
    const now = new Date(2026, 0, 15).getTime();
    const target = new Date(2026, 0, 10).getTime();
    expect(daysUntil(target, now)).toBe(-5);
  });
});

describe('examCountdown', () => {
  const meta = {
    applicationWindow: { from: '06/10/2026', to: '27/10/2026' },
  } as SyllabusMeta;

  it('counts down to the application window open date', () => {
    const now = new Date(2026, 8, 26).getTime(); // 26 Sep 2026
    const c = examCountdown(meta, now);
    expect(c.targetDate).toBe('06/10/2026');
    expect(c.days).toBe(10);
    expect(c.isPast).toBe(false);
    expect(c.label).toMatch(/applications open/i);
  });

  it('flags a past window and null days on bad meta', () => {
    const past = examCountdown(meta, new Date(2026, 10, 1).getTime());
    expect(past.isPast).toBe(true);
    const bad = examCountdown({ applicationWindow: { from: 'x', to: 'y' } } as SyllabusMeta, 0);
    expect(bad.days).toBeNull();
  });
});

describe('overallMastery', () => {
  it('sums attempts and computes accuracy', () => {
    const progress: Record<string, ProgressEntry> = {
      a: { seen: 4, correct: 3, wrong: 1 },
      b: { seen: 2, correct: 1, wrong: 1 },
      c: { seen: 0, correct: 0, wrong: 0 },
    };
    const m = overallMastery(progress);
    expect(m.seen).toBe(6);
    expect(m.correct).toBe(4);
    expect(m.answered).toBe(2); // c never seen
    expect(m.accuracy).toBeCloseTo(4 / 6);
  });

  it('is zero-safe on an empty map', () => {
    expect(overallMastery({}).accuracy).toBe(0);
  });
});

describe('coverageFraction', () => {
  it('divides answered by total, clamped', () => {
    expect(coverageFraction(3, 5)).toBeCloseTo(0.6);
    expect(coverageFraction(0, 0)).toBe(0);
    expect(coverageFraction(9, 5)).toBe(1);
  });
});

describe('dueCount', () => {
  it('counts cards at or before now', () => {
    const sr: Record<string, SrCard> = {
      a: { id: 'a', box: 1, due: 100, lapses: 0 },
      b: { id: 'b', box: 2, due: 500, lapses: 0 },
    };
    expect(dueCount(sr, 300)).toBe(1);
    expect(dueCount(sr, 500)).toBe(2);
  });
});

describe('bestStreak', () => {
  it('returns the max streak among active entries', () => {
    const nb: Record<string, NotebookEntry> = {
      a: { id: 'a', addedAt: 0, consecutiveCorrect: 1, graduated: false },
      b: { id: 'b', addedAt: 0, consecutiveCorrect: 0, graduated: false },
      c: { id: 'c', addedAt: 0, consecutiveCorrect: 2, graduated: true }, // graduated ignored
    };
    expect(bestStreak(nb)).toBe(1);
    expect(bestStreak({})).toBe(0);
  });
});

describe('aggregateSubjects', () => {
  const names = { HIST: 'History & Culture', POL: 'Polity/Constitution' } as Record<
    SubjectCode,
    string
  >;

  it('rolls up totals and accuracy per subject in first-seen order', () => {
    const items = [
      { id: 'h1', subjectCode: 'HIST' as SubjectCode },
      { id: 'h2', subjectCode: 'HIST' as SubjectCode },
      { id: 'p1', subjectCode: 'POL' as SubjectCode },
    ];
    const progress: Record<string, ProgressEntry> = {
      h1: { seen: 2, correct: 2, wrong: 0 },
    };
    const aggs = aggregateSubjects(items, progress, names);
    expect(aggs.map((a) => a.code)).toEqual(['HIST', 'POL']);
    const hist = aggs[0]!;
    expect(hist.total).toBe(2);
    expect(hist.answered).toBe(1);
    expect(hist.accuracy).toBe(1);
    const pol = aggs[1]!;
    expect(pol.total).toBe(1);
    expect(pol.answered).toBe(0);
    expect(pol.accuracy).toBe(0);
  });
});

describe('pct', () => {
  it('formats and clamps a fraction as whole percent', () => {
    expect(pct(0.723)).toBe('72%');
    expect(pct(2)).toBe('100%');
    expect(pct(-1)).toBe('0%');
  });
});

describe('niceMax (chart scaling)', () => {
  it('always leaves headroom so the tallest bar is never full-height', () => {
    // The key regression: a single subject / one data point must NOT scale to
    // the full plot (value / niceMax must stay comfortably below 1).
    for (const v of [1, 2, 3, 4, 5, 7, 10, 23, 100]) {
      const max = niceMax(v);
      expect(max).toBeGreaterThanOrEqual(v);
      expect(v / max).toBeLessThanOrEqual(0.85 + 1e-9);
    }
  });

  it('one-bar case: a lone value of 1 scales to half height, not full', () => {
    expect(niceMax(1)).toBe(2); // 1/2 = 50% → clearly a bar, not a block
  });

  it('zero / empty data still yields a safe ceiling ≥ 1', () => {
    expect(niceMax(0)).toBeGreaterThanOrEqual(1);
    // A zero value against the ceiling produces no height at all (0 / max = 0).
    expect(0 / niceMax(0)).toBe(0);
  });

  it('picks a 1/2/5×10ⁿ ceiling above the data max', () => {
    expect(niceMax(10)).toBe(20);
    expect(niceMax(50)).toBe(100);
    expect(niceMax(3)).toBe(5);
  });
});

describe('subtopic coverage', () => {
  it('maps bands to target MCQ counts (A deepest → D floor)', () => {
    expect(MCQ_TARGET_BY_BAND).toEqual({ A: 40, B: 25, C: 15, D: 10 });
    expect(targetForBand('A')).toBe(40);
    expect(targetForBand('C')).toBe(15);
    // An undefined band falls back to the D floor.
    expect(targetForBand(undefined)).toBe(10);
  });

  it('computes coverage percent capped at 100', () => {
    expect(coveragePct(20, 40)).toBe(50);
    expect(coveragePct(40, 40)).toBe(100);
    expect(coveragePct(60, 40)).toBe(100); // capped
    expect(coveragePct(0, 40)).toBe(0);
    // Zero target: covered iff content exists.
    expect(coveragePct(3, 0)).toBe(100);
    expect(coveragePct(0, 0)).toBe(0);
  });
});

describe('subtopic status', () => {
  it('tallies seen / correct-once over a subtopic\u2019s MCQ ids', () => {
    const progress = {
      q1: { seen: 2, correct: 1, wrong: 1 },
      q2: { seen: 1, correct: 0, wrong: 1 }, // seen but never correct
      q3: { seen: 0, correct: 0, wrong: 0 }, // not seen
    };
    const tally = tallySubtopicProgress(['q1', 'q2', 'q3', 'q4'], progress);
    expect(tally).toEqual({ total: 4, seen: 2, correctOnce: 1 });
  });

  it('derives status from the tally thresholds', () => {
    expect(subtopicStatus({ total: 0, seen: 0, correctOnce: 0 })).toBe('not-started');
    expect(subtopicStatus({ total: 10, seen: 0, correctOnce: 0 })).toBe('not-started');
    // 1/10 correct-once → learning (below the 0.4 revised bar).
    expect(subtopicStatus({ total: 10, seen: 3, correctOnce: 1 })).toBe('learning');
    // 5/10 correct-once → revised.
    expect(subtopicStatus({ total: 10, seen: 6, correctOnce: 5 })).toBe('revised');
    // 8/10 correct-once → mastered.
    expect(subtopicStatus({ total: 10, seen: 10, correctOnce: 8 })).toBe('mastered');
  });
});

describe('subtopicMasteryPct (learner progress)', () => {
  it('is 0 on a fresh profile / empty id list', () => {
    expect(subtopicMasteryPct({}, [])).toBe(0);
    expect(subtopicMasteryPct({}, ['q1', 'q2'])).toBe(0);
    // Seen but never answered correctly → still 0% mastery.
    expect(subtopicMasteryPct({ q1: { seen: 3, correct: 0, wrong: 3 } }, ['q1', 'q2'])).toBe(0);
  });

  it('counts distinct MCQs answered correctly at least once', () => {
    const progress = {
      q1: { seen: 2, correct: 1, wrong: 1 },
      q2: { seen: 5, correct: 3, wrong: 2 }, // still one distinct correct question
      q3: { seen: 1, correct: 0, wrong: 1 },
    };
    // 2 of 4 questions correct-once → 50%.
    expect(subtopicMasteryPct(progress, ['q1', 'q2', 'q3', 'q4'])).toBe(50);
  });

  it('reaches 100% only when every question is answered correctly once', () => {
    const progress = {
      q1: { seen: 1, correct: 1, wrong: 0 },
      q2: { seen: 1, correct: 1, wrong: 0 },
    };
    expect(subtopicMasteryPct(progress, ['q1', 'q2'])).toBe(100);
  });

  it('rounds to a whole percent', () => {
    const progress = {
      q1: { seen: 1, correct: 1, wrong: 0 },
    };
    // 1 of 3 → 33.33 → 33.
    expect(subtopicMasteryPct(progress, ['q1', 'q2', 'q3'])).toBe(33);
  });
});

describe('statusFromMastery', () => {
  it('maps the mastery percent onto the four statuses (0 = not-started)', () => {
    expect(statusFromMastery(0)).toBe('not-started');
    expect(statusFromMastery(1)).toBe('learning');
    expect(statusFromMastery(39)).toBe('learning');
    expect(statusFromMastery(40)).toBe('revised');
    expect(statusFromMastery(79)).toBe('revised');
    expect(statusFromMastery(80)).toBe('mastered');
    expect(statusFromMastery(100)).toBe('mastered');
  });
});

const detail = (
  tier: 1 | 2 | 3 | undefined,
  correct: boolean,
  timeMs: number,
  confidence?: 'sure' | 'guess' | null,
  covers?: string[],
): SessionAnswerDetail => ({ tier, correct, timeMs, confidence, covers });

describe('examPointCoverage', () => {
  const points = ['origins', 'town-planning', 'trade', 'decline'];

  it('is 100% when every exam-point is covered by some MCQ', () => {
    const mcqs = [
      { covers: ['origins', 'town-planning'] },
      { covers: ['trade'] },
      { covers: ['decline'] },
    ];
    const c = examPointCoverage(points, mcqs);
    expect(c.pct).toBe(100);
    expect(c.total).toBe(4);
    expect(c.covered).toEqual(points);
    expect(c.missing).toEqual([]);
  });

  it('is partial and lists covered vs missing in checklist order', () => {
    const mcqs = [{ covers: ['town-planning'] }, { covers: ['decline', 'town-planning'] }];
    const c = examPointCoverage(points, mcqs);
    // 2 of 4 distinct points covered → 50%.
    expect(c.pct).toBe(50);
    expect(c.covered).toEqual(['town-planning', 'decline']);
    expect(c.missing).toEqual(['origins', 'trade']);
  });

  it('ignores covers not in the checklist (cannot inflate the score) and MCQs with no covers', () => {
    const mcqs = [{ covers: ['origins', 'not-a-real-point'] }, {}, { covers: [] }];
    const c = examPointCoverage(points, mcqs);
    expect(c.pct).toBe(25); // only 'origins' counts
    expect(c.covered).toEqual(['origins']);
    expect(c.missing).toEqual(['town-planning', 'trade', 'decline']);
  });

  it('is 0% for an empty checklist (no division by zero)', () => {
    expect(examPointCoverage([], [{ covers: ['x'] }])).toEqual({
      total: 0,
      covered: [],
      missing: [],
      pct: 0,
    });
  });

  it('rounds to a whole percent', () => {
    const three = ['a', 'b', 'c'];
    // 1 of 3 → 33.33 → 33.
    expect(examPointCoverage(three, [{ covers: ['a'] }]).pct).toBe(33);
  });
});

describe('examPointsPracticed', () => {
  it('counts distinct covers across the answered set', () => {
    const details = [
      detail(undefined, true, 100, null, ['origins', 'trade']),
      detail(undefined, false, 100, null, ['trade']),
      detail(undefined, true, 100, null, ['decline']),
    ];
    expect(examPointsPracticed(details)).toBe(3); // origins, trade, decline
  });

  it('is 0 when no answered question carried a covers map', () => {
    expect(examPointsPracticed([detail(1, true, 100), detail(2, false, 100)])).toBe(0);
    expect(examPointsPracticed([])).toBe(0);
  });
});

describe('avgTimeMs', () => {
  it('averages the per-question times, rounded', () => {
    expect(avgTimeMs([detail(1, true, 1000), detail(1, true, 2000)])).toBe(1500);
    expect(avgTimeMs([detail(1, true, 1000), detail(1, true, 1200)])).toBe(1100);
  });

  it('is 0 for an empty session and clamps negatives', () => {
    expect(avgTimeMs([])).toBe(0);
    expect(avgTimeMs([detail(1, true, -500), detail(1, true, 500)])).toBe(250);
  });
});

describe('formatDuration', () => {
  it('formats sub-minute as seconds and minute+ as M:SS', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(45_000)).toBe('45s');
    expect(formatDuration(60_000)).toBe('1:00');
    expect(formatDuration(95_000)).toBe('1:35');
  });

  it('clamps negatives to 0s', () => {
    expect(formatDuration(-1000)).toBe('0s');
  });
});

describe('confidenceBreakdown', () => {
  it('rolls answers up by confidence and flags when ratings exist', () => {
    const b = confidenceBreakdown([
      detail(1, true, 100, 'sure'),
      detail(1, false, 100, 'sure'),
      detail(2, true, 100, 'guess'),
      detail(3, false, 100, null),
      detail(3, true, 100),
    ]);
    expect(b.sure).toEqual({ total: 2, correct: 1 });
    expect(b.guess).toEqual({ total: 1, correct: 1 });
    expect(b.unset).toBe(2);
    expect(b.hasRatings).toBe(true);
  });

  it('reports no ratings when none were set', () => {
    const b = confidenceBreakdown([detail(1, true, 100), detail(2, false, 100)]);
    expect(b.hasRatings).toBe(false);
    expect(b.unset).toBe(2);
  });
});

const mk = (attempted: boolean, correct: boolean): MockAnswer => ({ attempted, correct });

describe('netScore (mock negative marking)', () => {
  it('exposes the -1/3 negative-marking fraction', () => {
    expect(NEGATIVE_MARK).toBeCloseTo(1 / 3);
  });

  it('all-correct scores exactly the correct count (no penalty)', () => {
    const answers = [mk(true, true), mk(true, true), mk(true, true)];
    expect(netScore(answers)).toBe(3);
  });

  it('all-blank scores 0 — blanks are never penalised', () => {
    const answers = [mk(false, false), mk(false, false), mk(false, false)];
    expect(netScore(answers)).toBe(0);
    // Empty session is also 0.
    expect(netScore([])).toBe(0);
  });

  it('applies -1/3 per wrong answer on a mixed paper', () => {
    // 4 correct, 3 wrong, 2 blank → 4 - 3/3 = 3.
    const answers = [
      mk(true, true), mk(true, true), mk(true, true), mk(true, true),
      mk(true, false), mk(true, false), mk(true, false),
      mk(false, false), mk(false, false),
    ];
    expect(netScore(answers)).toBeCloseTo(3);
  });

  it('negative-marking math: 1 correct, 1 wrong → 1 - 1/3 = 0.6667', () => {
    expect(netScore([mk(true, true), mk(true, false)])).toBeCloseTo(2 / 3);
    // 0 correct, 3 wrong → -1.
    expect(netScore([mk(true, false), mk(true, false), mk(true, false)])).toBeCloseTo(-1);
  });
});

describe('mockScore (aggregate)', () => {
  it('tallies attempted / correct / wrong / skipped and accuracy over attempted', () => {
    const answers = [
      mk(true, true), mk(true, true), // 2 correct
      mk(true, false), // 1 wrong
      mk(false, false), mk(false, false), // 2 skipped
    ];
    const s = mockScore(answers);
    expect(s.total).toBe(5);
    expect(s.attempted).toBe(3);
    expect(s.correct).toBe(2);
    expect(s.wrong).toBe(1);
    expect(s.skipped).toBe(2);
    expect(s.net).toBeCloseTo(2 - 1 / 3);
    // Accuracy is over ATTEMPTED (2 of 3), not the whole paper.
    expect(s.accuracy).toBeCloseTo(2 / 3);
  });

  it('is zero-safe on an empty / all-blank paper', () => {
    expect(mockScore([])).toEqual({ total: 0, attempted: 0, correct: 0, wrong: 0, skipped: 0, net: 0, accuracy: 0 });
    const blank = mockScore([mk(false, false), mk(false, false)]);
    expect(blank).toMatchObject({ total: 2, attempted: 0, skipped: 2, net: 0, accuracy: 0 });
  });

  it('agrees with netScore for the net field', () => {
    const answers = [mk(true, true), mk(true, false), mk(true, false), mk(false, false)];
    expect(mockScore(answers).net).toBe(netScore(answers));
  });
});

describe('formatNet', () => {
  it('keeps integers integer and trims non-integers to <=2 decimals', () => {
    expect(formatNet(42)).toBe('42');
    expect(formatNet(0)).toBe('0');
    expect(formatNet(2 / 3)).toBe('0.67');
    expect(formatNet(-1 / 3)).toBe('-0.33');
  });
});
