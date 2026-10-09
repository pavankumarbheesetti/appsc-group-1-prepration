import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  __resetForTests,
  exportStateJSON,
  getExamDate,
  importStateJSON,
  loadState,
  saveState,
  setExamDate,
  getPlanStartDate,
  setPlanStartDate,
  subscribe,
  updateState,
  getMainsEntry,
  saveMainsDraft,
  saveMainsRubric,
  clearMains,
  getTeluguProgress,
  isTeluguLearned,
  setTeluguLearned,
  toggleTeluguLearned,
  getEnglishEntry,
  saveEnglishDraft,
  saveEnglishChecks,
  clearEnglish,
} from '../store';

beforeEach(() => {
  // Isolate each test: clear the module cache and the real localStorage.
  __resetForTests();
  try {
    globalThis.localStorage.clear();
  } catch {
    /* ignore — some tests replace localStorage entirely */
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('store', () => {
  it('returns a typed default state when nothing is persisted', () => {
    const s = loadState();
    expect(s.version).toBe(1);
    expect(s.settings.theme).toBe('light');
    expect(s.settings.fontScale).toBe(1);
    // New planner settings: examDate defaults to 24 Jan 2027; planStartDate is
    // captured as a valid ISO date ("today" on first run).
    expect(s.settings.examDate).toBe('2027-01-24');
    expect(s.settings.planStartDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(s.progress).toEqual({});
    expect(s.sr).toEqual({});
    expect(s.notebook).toEqual({});
    expect(s.flashcards).toEqual({});
    expect(s.mains).toEqual({});
    expect(s.telugu).toEqual({});
    expect(s.english).toEqual({});
  });

  it('defaults or repairs a malformed examDate, and get/set round-trip', () => {
    // A blob with a bad examDate falls back to the default.
    const repaired = importStateJSON('{"settings":{"examDate":"2026-13-40"}}');
    expect(repaired.settings.examDate).toBe('2027-01-24');
    // set/get honour a valid ISO date and ignore an invalid one.
    setExamDate('2027-01-31');
    expect(getExamDate()).toBe('2027-01-31');
    setExamDate('not-a-date');
    expect(getExamDate()).toBe('2027-01-31'); // unchanged
  });

  it('sets and persists the plan start date; ignores invalid input', () => {
    const before = getPlanStartDate();
    expect(before).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    setPlanStartDate('2026-10-10');
    expect(getPlanStartDate()).toBe('2026-10-10');
    // Invalid input is a no-op (the setting can never be corrupted from the UI).
    setPlanStartDate('nope');
    expect(getPlanStartDate()).toBe('2026-10-10');
    setPlanStartDate('2026-02-31'); // impossible calendar date → rejected
    expect(getPlanStartDate()).toBe('2026-10-10');
  });

  it('migrates the retired old-default exam date (15 Nov 2026 → 24 Jan 2027) with a one-time notice', () => {
    // A stored blob carrying the OLD default is auto-moved to the new Prelims date.
    const migrated = importStateJSON('{"settings":{"examDate":"2026-11-15"}}');
    expect(migrated.settings.examDate).toBe('2027-01-24');
    expect(migrated.settings.prelimsDateMigrationNotice).toBe(true);
  });

  it('leaves a learner-set exam date (not the old default) untouched, no notice', () => {
    const custom = importStateJSON('{"settings":{"examDate":"2027-03-01"}}');
    expect(custom.settings.examDate).toBe('2027-03-01');
    expect(custom.settings.prelimsDateMigrationNotice).not.toBe(true);
  });

  it('persists a mutation across a cache reset (round-trips localStorage)', () => {
    updateState((d) => {
      d.settings.theme = 'dark';
      d.progress['q1'] = { seen: 1, correct: 1, wrong: 0, lastResult: 'correct' };
    });
    __resetForTests(); // drop the in-process cache → force a re-read
    const reloaded = loadState();
    expect(reloaded.settings.theme).toBe('dark');
    expect(reloaded.progress['q1']).toEqual({ seen: 1, correct: 1, wrong: 0, lastResult: 'correct' });
  });

  it('export/import round-trips state', () => {
    updateState((d) => {
      d.settings.fontScale = 1.3;
      d.notebook['q9'] = { id: 'q9', addedAt: 5, consecutiveCorrect: 1, graduated: false };
    });
    const json = exportStateJSON();

    __resetForTests();
    globalThis.localStorage.clear();
    expect(loadState().settings.fontScale).toBe(1); // fresh

    const imported = importStateJSON(json);
    expect(imported.settings.fontScale).toBe(1.3);
    expect(imported.notebook['q9']?.consecutiveCorrect).toBe(1);
    expect(loadState().settings.fontScale).toBe(1.3); // cache updated too
  });

  it('normalizes a corrupt/partial imported blob', () => {
    const imported = importStateJSON('{"settings":{"theme":"banana"}}');
    expect(imported.settings.theme).toBe('light'); // invalid → default
    expect(imported.settings.fontScale).toBe(1);
    expect(imported.progress).toEqual({});
  });

  it('rejects an import with a malformed progress entry', () => {
    const bad = JSON.stringify({ version: 1, progress: { q1: { seen: 'nope', correct: 0, wrong: 0 } } });
    expect(() => importStateJSON(bad)).toThrow(/progress entry 'q1'/);
  });

  it('rejects an import with a malformed sr entry', () => {
    const bad = JSON.stringify({ sr: { q1: { id: 'q1', box: 1 } } }); // missing due/lapses
    expect(() => importStateJSON(bad)).toThrow(/sr entry 'q1'/);
  });

  it('rejects an import with a malformed notebook entry', () => {
    const bad = JSON.stringify({ notebook: { q1: { id: 'q1', addedAt: 0, consecutiveCorrect: 0 } } }); // missing graduated
    expect(() => importStateJSON(bad)).toThrow(/notebook entry 'q1'/);
  });

  it('rejects an import with a malformed flashcards SR entry', () => {
    const bad = JSON.stringify({ flashcards: { 'fc:n1#0': { id: 'fc:n1#0', box: 1 } } }); // missing due/lapses
    expect(() => importStateJSON(bad)).toThrow(/flashcards entry 'fc:n1#0'/);
  });

  it('round-trips a valid flashcards SR map, separate from the MCQ sr map', () => {
    updateState((d) => {
      d.sr['q1'] = { id: 'q1', box: 2, due: 100, lapses: 0 };
      d.flashcards['fc:n1#0'] = { id: 'fc:n1#0', box: 3, due: 200, lapses: 1 };
    });
    const json = exportStateJSON();
    __resetForTests();
    globalThis.localStorage.clear();
    const imported = importStateJSON(json);
    expect(imported.flashcards['fc:n1#0']).toEqual({ id: 'fc:n1#0', box: 3, due: 200, lapses: 1 });
    expect(imported.sr['q1']?.box).toBe(2); // MCQ map untouched by the flashcards map
    expect(loadState().flashcards['fc:n1#0']?.box).toBe(3); // cache updated too
  });

  it('does not persist anything when an import is rejected', () => {
    const bad = JSON.stringify({ progress: { q1: { seen: 'nope' } } });
    expect(() => importStateJSON(bad)).toThrow();
    expect(loadState().progress).toEqual({}); // unchanged default
  });

  it('accepts an import whose progress/sr/notebook entries are all valid (round-trip)', () => {
    const good = JSON.stringify({
      version: 1,
      progress: { q1: { seen: 1, correct: 1, wrong: 0, lastResult: 'correct' } },
      sr: { q1: { id: 'q1', box: 2, due: 100, lapses: 0 } },
      notebook: { q1: { id: 'q1', addedAt: 5, consecutiveCorrect: 1, graduated: false } },
    });
    const imported = importStateJSON(good);
    expect(imported.progress['q1']?.seen).toBe(1);
    expect(imported.sr['q1']?.box).toBe(2);
    expect(imported.notebook['q1']?.consecutiveCorrect).toBe(1);
  });

  it('notifies subscribers on save', () => {
    const spy = vi.fn();
    const unsub = subscribe(spy);
    updateState((d) => {
      d.settings.theme = 'dark';
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0].settings.theme).toBe('dark');
    unsub();
    saveState(loadState());
    expect(spy).toHaveBeenCalledTimes(1); // no more calls after unsubscribe
  });

  it('falls back to in-memory storage when localStorage throws', () => {
    // Make every localStorage access throw to simulate file:// / locked-down.
    const throwing = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      clear: () => undefined,
    };
    vi.stubGlobal('localStorage', throwing);

    // Should not throw despite storage being unavailable, and the mutation is
    // retained in the in-memory fallback (getItem/setItem both throw).
    expect(() =>
      updateState((d) => {
        d.settings.theme = 'dark';
      }),
    ).not.toThrow();
    expect(loadState().settings.theme).toBe('dark');

    vi.unstubAllGlobals();
  });
});

describe('store — Mains writing practice', () => {
  beforeEach(() => {
    __resetForTests();
    try {
      globalThis.localStorage.clear();
    } catch {
      /* ignore */
    }
  });

  it('saves and reads back a draft, preserving rubric across draft saves', () => {
    expect(getMainsEntry('q1')).toBeUndefined();
    saveMainsRubric('q1', [2, 1, 0, 1, 2]);
    saveMainsDraft('q1', 'My intro. My body. My conclusion.');
    const entry = getMainsEntry('q1');
    expect(entry?.draft).toBe('My intro. My body. My conclusion.');
    expect(entry?.rubric).toEqual([2, 1, 0, 1, 2]); // preserved by the draft save
    expect(entry?.updatedAt).toBeGreaterThan(0);
  });

  it('saves rubric scores while preserving an existing draft', () => {
    saveMainsDraft('q2', 'draft text');
    saveMainsRubric('q2', [1, 1, 1, 1, 1]);
    const entry = getMainsEntry('q2');
    expect(entry?.draft).toBe('draft text'); // preserved by the rubric save
    expect(entry?.rubric).toEqual([1, 1, 1, 1, 1]);
  });

  it('clears all saved work for a question', () => {
    saveMainsDraft('q3', 'something');
    saveMainsRubric('q3', [2, 2, 2, 2, 2]);
    expect(getMainsEntry('q3')).toBeDefined();
    clearMains('q3');
    expect(getMainsEntry('q3')).toBeUndefined();
  });

  it('round-trips the mains map through export/import + a cache reset', () => {
    saveMainsDraft('q4', 'persist me');
    saveMainsRubric('q4', [2, 0, 1, 2, 1]);
    const json = exportStateJSON();

    __resetForTests();
    globalThis.localStorage.clear();
    expect(getMainsEntry('q4')).toBeUndefined(); // fresh

    const imported = importStateJSON(json);
    expect(imported.mains['q4']?.draft).toBe('persist me');
    expect(imported.mains['q4']?.rubric).toEqual([2, 0, 1, 2, 1]);
    expect(getMainsEntry('q4')?.draft).toBe('persist me'); // cache updated too
  });

  it('normalizes a blob without a mains key (backward-compatible)', () => {
    const imported = importStateJSON('{"version":1}');
    expect(imported.mains).toEqual({});
  });

  it('rejects an import with a malformed mains entry', () => {
    const bad = JSON.stringify({ mains: { q1: { draft: 'ok', rubric: 'nope', updatedAt: 0 } } });
    expect(() => importStateJSON(bad)).toThrow(/mains entry 'q1'/);
  });

  it('does not persist anything when a mains import is rejected', () => {
    const bad = JSON.stringify({ mains: { q1: { draft: 5, rubric: [], updatedAt: 0 } } });
    expect(() => importStateJSON(bad)).toThrow(/mains entry 'q1'/);
    expect(loadState().mains).toEqual({}); // unchanged default
  });
});

describe('store — Telugu course progress', () => {
  beforeEach(() => {
    __resetForTests();
    try {
      globalThis.localStorage.clear();
    } catch {
      /* ignore */
    }
  });

  it('starts empty and sets/reads a per-glyph learned flag', () => {
    expect(getTeluguProgress()).toEqual({});
    expect(isTeluguLearned('tel-v-01')).toBe(false);
    setTeluguLearned('tel-v-01', true);
    expect(isTeluguLearned('tel-v-01')).toBe(true);
    expect(getTeluguProgress()).toEqual({ 'tel-v-01': true });
  });

  it('clearing a flag deletes the key (keeps the map compact)', () => {
    setTeluguLearned('tel-c-01', true);
    setTeluguLearned('tel-c-01', false);
    expect(isTeluguLearned('tel-c-01')).toBe(false);
    expect(getTeluguProgress()).toEqual({}); // key removed, not stored as false
  });

  it('toggles a flag and returns the new value', () => {
    expect(toggleTeluguLearned('tel-n-0')).toBe(true);
    expect(isTeluguLearned('tel-n-0')).toBe(true);
    expect(toggleTeluguLearned('tel-n-0')).toBe(false);
    expect(isTeluguLearned('tel-n-0')).toBe(false);
  });

  it('round-trips the telugu map through export/import + a cache reset', () => {
    setTeluguLearned('tel-v-01', true);
    setTeluguLearned('tel-g-05', true);
    const json = exportStateJSON();

    __resetForTests();
    globalThis.localStorage.clear();
    expect(getTeluguProgress()).toEqual({}); // fresh

    const imported = importStateJSON(json);
    expect(imported.telugu).toEqual({ 'tel-v-01': true, 'tel-g-05': true });
    expect(isTeluguLearned('tel-g-05')).toBe(true); // cache updated too
  });

  it('normalizes a blob without a telugu key (backward-compatible)', () => {
    const imported = importStateJSON('{"version":1}');
    expect(imported.telugu).toEqual({});
  });

  it('rejects an import with a non-boolean telugu entry', () => {
    const bad = JSON.stringify({ telugu: { 'tel-v-01': 'yes' } });
    expect(() => importStateJSON(bad)).toThrow(/telugu entry 'tel-v-01'/);
  });

  it('does not persist anything when a telugu import is rejected', () => {
    const bad = JSON.stringify({ telugu: { 'tel-v-01': 1 } });
    expect(() => importStateJSON(bad)).toThrow(/telugu entry 'tel-v-01'/);
    expect(loadState().telugu).toEqual({}); // unchanged default
  });
});

describe('store — English writing practice', () => {
  beforeEach(() => {
    __resetForTests();
    try {
      globalThis.localStorage.clear();
    } catch {
      /* ignore */
    }
  });

  it('saves and reads back a draft, preserving checks across draft saves', () => {
    expect(getEnglishEntry('letter')).toBeUndefined();
    saveEnglishChecks('letter', [true, false, true, false, false]);
    saveEnglishDraft('letter', 'Dear Sir, ...');
    const entry = getEnglishEntry('letter');
    expect(entry?.draft).toBe('Dear Sir, ...');
    expect(entry?.checks).toEqual([true, false, true, false, false]); // preserved by the draft save
    expect(entry?.updatedAt).toBeGreaterThan(0);
  });

  it('saves checklist ticks while preserving an existing draft', () => {
    saveEnglishDraft('essay', 'My essay text');
    saveEnglishChecks('essay', [true, true, false, false, false]);
    const entry = getEnglishEntry('essay');
    expect(entry?.draft).toBe('My essay text'); // preserved by the checks save
    expect(entry?.checks).toEqual([true, true, false, false, false]);
  });

  it('clears all saved work for a format', () => {
    saveEnglishDraft('precis', 'something');
    saveEnglishChecks('precis', [true, true, true, true, true]);
    expect(getEnglishEntry('precis')).toBeDefined();
    clearEnglish('precis');
    expect(getEnglishEntry('precis')).toBeUndefined();
  });

  it('round-trips the english map through export/import + a cache reset', () => {
    saveEnglishDraft('report', 'persist me');
    saveEnglishChecks('report', [false, true, false, true, false]);
    const json = exportStateJSON();

    __resetForTests();
    globalThis.localStorage.clear();
    expect(getEnglishEntry('report')).toBeUndefined(); // fresh

    const imported = importStateJSON(json);
    expect(imported.english['report']?.draft).toBe('persist me');
    expect(imported.english['report']?.checks).toEqual([false, true, false, true, false]);
    expect(getEnglishEntry('report')?.draft).toBe('persist me'); // cache updated too
  });

  it('normalizes a blob without an english key (backward-compatible)', () => {
    const imported = importStateJSON('{"version":1}');
    expect(imported.english).toEqual({});
  });

  it('rejects an import with a malformed english entry', () => {
    const bad = JSON.stringify({ english: { letter: { draft: 'ok', checks: 'nope', updatedAt: 0 } } });
    expect(() => importStateJSON(bad)).toThrow(/english entry 'letter'/);
  });

  it('does not persist anything when an english import is rejected', () => {
    const bad = JSON.stringify({ english: { letter: { draft: 5, checks: [], updatedAt: 0 } } });
    expect(() => importStateJSON(bad)).toThrow(/english entry 'letter'/);
    expect(loadState().english).toEqual({}); // unchanged default
  });
});
