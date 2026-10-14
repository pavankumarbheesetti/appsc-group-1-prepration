import { describe, it, expect, beforeEach } from 'vitest';
import {
  DRILL_SESSION_CAP,
  DRILL_SESSION_KEY,
  DRILL_SESSION_TTL_DAYS,
  clearAllDrillSessions,
  clearDrillSession,
  drillProgress,
  loadDrillSession,
  loadDrillSessions,
  pruneSessions,
  resumeIndex,
  resumeText,
  saveDrillSession,
  scopeHash,
  withResume,
  type DrillSession,
} from '../drill-session';

const NOW = Date.parse('2026-10-14T10:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

function session(key: string, opts: Partial<DrillSession> = {}, at = NOW): DrillSession {
  return {
    key,
    label: `${key} label`,
    itemIds: ['a', 'b', 'c', 'd'],
    index: 1,
    answers: { a: { chosen: 0 } },
    startedAtISO: new Date(at).toISOString(),
    updatedAtISO: new Date(at).toISOString(),
    route: `/x?resume=${key}`,
    ...opts,
  };
}

describe('drill-session — storage', () => {
  beforeEach(() => {
    localStorage.clear();
    clearAllDrillSessions();
  });

  it('saves and loads a session by key (under one storage key)', () => {
    saveDrillSession(session('learn:x'), NOW);
    const s = loadDrillSession('learn:x', undefined, NOW);
    expect(s?.label).toBe('learn:x label');
    expect(s?.answers).toEqual({ a: { chosen: 0 } });
    expect(JSON.parse(localStorage.getItem(DRILL_SESSION_KEY)!)).toHaveLength(1);
    expect(loadDrillSession('other', undefined, NOW)).toBeNull();
  });

  it('replaces a session with the same key (never two per key)', () => {
    saveDrillSession(session('k', { index: 1 }), NOW);
    saveDrillSession(session('k', { index: 2 }), NOW + 1000);
    const all = loadDrillSessions(undefined, NOW + 2000);
    expect(all).toHaveLength(1);
    expect(all[0]!.index).toBe(2);
  });

  it(`keeps at most ${DRILL_SESSION_CAP} sessions, most recent first`, () => {
    for (let i = 0; i < 5; i += 1) saveDrillSession(session(`k${i}`, {}, NOW + i * 1000), NOW + i * 1000);
    const keys = loadDrillSessions(undefined, NOW + 10_000).map((s) => s.key);
    expect(keys).toEqual(['k4', 'k3', 'k2']);
  });

  it(`expires sessions older than ${DRILL_SESSION_TTL_DAYS} days (and drops them from storage)`, () => {
    saveDrillSession(session('old', {}, NOW - (DRILL_SESSION_TTL_DAYS + 0.1) * DAY), NOW - 3 * DAY);
    saveDrillSession(session('new', {}, NOW - DAY), NOW - DAY);
    expect(loadDrillSessions(undefined, NOW).map((s) => s.key)).toEqual(['new']);
    expect(JSON.parse(localStorage.getItem(DRILL_SESSION_KEY)!)).toHaveLength(1);
  });

  it('drops sessions naming a question that no longer exists', () => {
    saveDrillSession(session('gone', { itemIds: ['a', 'zzz'] , answers: {} }), NOW);
    saveDrillSession(session('ok', { itemIds: ['a', 'b'], answers: {} }), NOW);
    const exists = (id: string): boolean => id !== 'zzz';
    expect(loadDrillSessions(exists, NOW).map((s) => s.key)).toEqual(['ok']);
    expect(loadDrillSession('gone', exists, NOW)).toBeNull();
  });

  it('ignores corrupt storage and invalid entries', () => {
    localStorage.setItem(DRILL_SESSION_KEY, '{not json');
    expect(loadDrillSessions(undefined, NOW)).toEqual([]);
    localStorage.setItem(DRILL_SESSION_KEY, JSON.stringify([{ key: 'x' }, session('fine')]));
    expect(loadDrillSessions(undefined, NOW).map((s) => s.key)).toEqual(['fine']);
  });

  it('never keeps a finished run (every question answered)', () => {
    saveDrillSession(session('done', { itemIds: ['a'], index: 0, answers: { a: { chosen: 1 } } }), NOW);
    expect(loadDrillSession('done', undefined, NOW)).toBeNull();
  });

  it('clears one session by key', () => {
    saveDrillSession(session('a1'), NOW);
    saveDrillSession(session('a2'), NOW);
    clearDrillSession('a1');
    expect(loadDrillSessions(undefined, NOW).map((s) => s.key)).toEqual(['a2']);
  });
});

describe('drill-session — pure helpers', () => {
  it('resumes on the next unanswered question after the saved one', () => {
    // On Q3 (index 2) having answered Q1–Q3 → resume at Q4.
    const s = { itemIds: ['a', 'b', 'c', 'd', 'e'], index: 2, answers: { a: { chosen: 0 }, b: { chosen: 0 }, c: { chosen: 1 } } };
    expect(resumeIndex(s)).toBe(3);
    expect(drillProgress(s)).toEqual({ answered: 3, total: 5, question: 4 });
    expect(resumeText(s)).toBe('Resume practice \u00b7 question 4 of 5');
    // Saved on an unanswered question → that one.
    expect(resumeIndex({ ...s, index: 4 })).toBe(4);
    // Wraps to an earlier unanswered one.
    expect(resumeIndex({ itemIds: ['a', 'b', 'c'], index: 2, answers: { b: { chosen: 0 }, c: { chosen: 0 } } })).toBe(0);
  });

  it('prune keeps the newest per key and clamps the index', () => {
    const a = session('k', { index: 9 }, NOW - 1000);
    const b = session('k', { index: 0 }, NOW);
    const out = pruneSessions([a, b], NOW);
    expect(out).toHaveLength(1);
    expect(out[0]!.index).toBe(0);
    expect(pruneSessions([session('z', { index: 99 })], NOW)[0]!.index).toBe(3);
  });

  it('builds resume routes and stable scope hashes', () => {
    expect(withResume('/learn/x/practice?from=today', 'learn:x')).toBe('/learn/x/practice?from=today&resume=learn%3Ax');
    expect(withResume('/practice', 'drill:q')).toBe('/practice?resume=drill%3Aq');
    expect(scopeHash(['a', 'b'])).toBe(scopeHash(['a', 'b']));
    expect(scopeHash(['a', 'b'])).not.toBe(scopeHash(['b', 'a']));
  });
});
