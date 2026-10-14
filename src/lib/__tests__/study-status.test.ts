/**
 * Per-subtopic STUDY STATUS — transitions (manual mark / unmark, notes opened,
 * automatic "studied" at 10 answered), backward compatibility with older
 * progress, and the planner wiring (days behind uses the status, restart from
 * today keeps progress).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  AUTO_STUDIED_ANSWERS,
  autoStudiedThreshold,
  deriveStudyStatus,
  isRevisable,
  markTopicStudied,
  REVISABLE_MIN_ANSWERS,
  studiedTopicIds,
  weekTestPoolIds,
  syncAutoStudied,
  topicStatus,
  topicStudy,
} from '../study-status';
import { currentPlan, plannerProgress } from '../plan';
import { getSubtopic } from '../../content/loader';
import {
  __resetForTests,
  importStateJSON,
  loadState,
  noteTopicOpened,
  setPlanStartDate,
  updateState,
} from '../../state/store';

const STONE = 'hist-ancient-stone-age';

/** Record `n` answered questions of subtopic `id` (one attempt each). */
function answer(id: string, n: number): void {
  const ids = getSubtopic(id)!.mcqs.slice(0, n).map((m) => m.id);
  updateState((s) => {
    for (const q of ids) s.progress[q] = { seen: 1, correct: 1, wrong: 0, lastResult: 'correct' };
  });
}

describe('deriveStudyStatus (pure)', () => {
  it('not-started → in-progress (notes / answers) → studied (mark or 10 answered)', () => {
    expect(deriveStudyStatus(undefined, 0, 20)).toBe('not-started');
    expect(deriveStudyStatus({ notesOpened: true }, 0, 20)).toBe('in-progress');
    expect(deriveStudyStatus(undefined, 3, 20)).toBe('in-progress');
    expect(deriveStudyStatus(undefined, AUTO_STUDIED_ANSWERS - 1, 20)).toBe('in-progress');
    expect(deriveStudyStatus(undefined, AUTO_STUDIED_ANSWERS, 20)).toBe('studied');
    expect(deriveStudyStatus({ mark: 'studied' }, 0, 20)).toBe('studied');
  });

  it('a bank smaller than 10 is studied once the whole bank is answered', () => {
    expect(autoStudiedThreshold(6)).toBe(6);
    expect(deriveStudyStatus(undefined, 5, 6)).toBe('in-progress');
    expect(deriveStudyStatus(undefined, 6, 6)).toBe('studied');
    // No questions at all → only a manual mark can make it studied.
    expect(deriveStudyStatus({ notesOpened: true }, 0, 0)).toBe('in-progress');
  });

  it('"Mark as not studied" overrides the automatic rule', () => {
    expect(deriveStudyStatus({ mark: 'not-studied' }, 15, 20)).toBe('in-progress');
    expect(deriveStudyStatus({ mark: 'not-studied' }, 0, 20)).toBe('not-started');
  });
});

describe('study status in the store', () => {
  beforeEach(() => {
    localStorage.clear();
    __resetForTests();
  });

  it('manual mark / unmark round-trips and stamps the date', () => {
    expect(topicStatus(STONE)).toBe('not-started');
    noteTopicOpened(STONE);
    expect(topicStatus(STONE)).toBe('in-progress');
    markTopicStudied(STONE, true, '2026-10-13');
    expect(topicStudy(STONE)).toMatchObject({ status: 'studied', studiedOn: '2026-10-13', manual: true });
    markTopicStudied(STONE, false, '2026-10-13');
    expect(topicStatus(STONE)).toBe('in-progress'); // notes were opened
    expect(topicStudy(STONE).studiedOn).toBeUndefined();
  });

  it('auto-studied at 10 answered, with the date stamped by syncAutoStudied', () => {
    answer(STONE, 9);
    expect(topicStatus(STONE)).toBe('in-progress');
    answer(STONE, 10);
    syncAutoStudied([STONE], '2026-10-13');
    expect(topicStudy(STONE)).toMatchObject({ status: 'studied', studiedOn: '2026-10-13', manual: false });
  });

  it('BACKWARD COMPAT — an old blob with seen>0 progress is in progress, not studied', () => {
    const q = getSubtopic(STONE)!.mcqs[0]!.id;
    importStateJSON(JSON.stringify({ progress: { [q]: { seen: 2, correct: 1, wrong: 1 } } }));
    expect(loadState().study).toEqual({});
    expect(topicStatus(STONE)).toBe('in-progress');
    expect(plannerProgress()[STONE]).toMatchObject({ seen: 1, studied: false });
    // …and NOT revisable (H3): a stray answer without the topic's Learn notes
    // being opened never puts its cards into Revise / the test pools.
    expect(isRevisable(STONE)).toBe(false);
  });

  it('cards of an untouched / notes-only topic are not revisable', () => {
    expect(isRevisable(STONE)).toBe(false);
    noteTopicOpened(STONE);
    expect(isRevisable(STONE)).toBe(false);
    markTopicStudied(STONE, true);
    expect(isRevisable(STONE)).toBe(true);
  });
});

describe('isRevisable + test pools (H3 / M2 / M3)', () => {
  beforeEach(() => {
    localStorage.clear();
    __resetForTests();
  });

  it('1 stray mock answer never makes a topic revisable; studied or Learn practice (notes + ≥3) does', () => {
    answer(STONE, 1); // e.g. one all-subject mock answer
    expect(isRevisable(STONE)).toBe(false);
    answer(STONE, REVISABLE_MIN_ANSWERS);
    expect(isRevisable(STONE)).toBe(false); // answers without opening the Learn notes
    noteTopicOpened(STONE);
    expect(isRevisable(STONE)).toBe(true); // notes opened + ≥ 3 answered in practice
    markTopicStudied(STONE, false);
    expect(isRevisable(STONE)).toBe(false); // explicit "not studied" always wins
    markTopicStudied(STONE, true);
    expect(isRevisable(STONE)).toBe(true);
  });

  it('week-test pool is built from ACTUAL studiedOn dates (this week vs earlier)', () => {
    const IVC = 'hist-ancient-ivc';
    const VEDIC = 'hist-ancient-early-vedic';
    const LATE = 'hist-ancient-later-vedic';
    markTopicStudied(STONE, true, '2026-10-01'); // earlier
    markTopicStudied(IVC, true, '2026-10-12'); // this week (Sun 11 … Sat 17)
    markTopicStudied(VEDIC, true, '2026-10-17'); // the test day itself
    markTopicStudied(LATE, true, '2026-10-18'); // AFTER the test → excluded
    const pool = weekTestPoolIds('2026-10-17', [STONE, IVC, VEDIC, LATE, 'hist-ancient-mahajanapadas']);
    expect(pool.thisWeek).toEqual([IVC, VEDIC]);
    expect(pool.earlier).toEqual([STONE]);
  });

  it('unit-test pool keeps only the unit topics actually studied', () => {
    markTopicStudied('hist-ancient-ivc', true, '2026-10-12');
    expect(studiedTopicIds([STONE, 'hist-ancient-ivc'])).toEqual(['hist-ancient-ivc']);
  });
});

describe('planner uses the study status (days behind, restart from today)', () => {
  beforeEach(() => {
    localStorage.clear();
    __resetForTests();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-13T10:00:00'));
  });
  afterEach(() => vi.useRealTimers());

  const NOW = new Date('2026-10-13T10:00:00');

  /** The canonical first-pass topics scheduled on `dateISO` (plan anchored at its start). */
  function firstPassOn(dateISO: string): string[] {
    const start = loadState().settings.planStartDate;
    const d = currentPlan(new Date(`${start}T00:00:00`)).days.find((x) => x.dateISO === dateISO);
    return d ? [...d.theorySubtopicIds, ...d.aptitudeSubtopicIds] : [];
  }

  it('one answered question per topic no longer counts as studied (still behind)', () => {
    setPlanStartDate('2026-10-10');
    for (const d of ['2026-10-10', '2026-10-11', '2026-10-12']) for (const id of firstPassOn(d)) answer(id, 1);
    expect(currentPlan(NOW).summary.daysBehind).toBe(3);
  });

  it('marking the missed days\u2019 topics studied clears "behind"', () => {
    setPlanStartDate('2026-10-10');
    expect(currentPlan(NOW).summary.daysBehind).toBe(3);
    for (const d of ['2026-10-10', '2026-10-11', '2026-10-12']) for (const id of firstPassOn(d)) markTopicStudied(id, true, '2026-10-13');
    expect(currentPlan(NOW).summary.daysBehind).toBe(0);
  });

  it('a fresh learner who marked Stone Age studied today is not behind', () => {
    setPlanStartDate('2026-10-13');
    markTopicStudied(STONE, true, '2026-10-13');
    const plan = currentPlan(NOW);
    expect(plan.summary.daysBehind).toBe(0);
    expect(plan.summary.prelimsStudied).toBe(1);
  });

  it('restart from today (planStartDate = today) keeps all progress and clears "behind"', () => {
    setPlanStartDate('2026-10-10');
    answer(STONE, 3);
    markTopicStudied('ment-number-system', true, '2026-10-12');
    const before = structuredClone({ progress: loadState().progress, study: loadState().study });
    expect(currentPlan(NOW).summary.daysBehind).toBe(3);
    setPlanStartDate('2026-10-13');
    expect(loadState().progress).toEqual(before.progress);
    expect(loadState().study).toEqual(before.study);
    expect(currentPlan(NOW).summary.daysBehind).toBe(0);
  });
});
