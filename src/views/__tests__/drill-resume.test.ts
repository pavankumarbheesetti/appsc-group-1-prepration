/**
 * Resumable UNTIMED drills: mountQuiz restores a saved run for a matching key
 * (and only then), saves as the learner answers, Pause saves + goes back,
 * finishing clears it, and resuming never re-records an answer. Plus the
 * resume entry points (Today row, the topic's Practice tab, the Practice hub).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mountQuiz, PAUSED_TOAST } from '../quiz';
import { renderApp } from '../../app';
import { navigate } from '../../router/router';
import { learnPath } from '../learn';
import { getSubtopic } from '../../content/loader';
import { markRowKeyDone, START_HERE_KEY } from '../../lib/day-tasks';
import { __resetForTests, loadState, setPlanStartDate } from '../../state/store';
import {
  clearAllDrillSessions,
  loadDrillSession,
  saveDrillSession,
  type DrillSession,
} from '../../lib/drill-session';
import { SET_CHANGED_TOAST } from '../drill-resume';
import { runSet, setRoute } from '../today-tasks';
import type { MCQItem } from '../../content/types';

/** Every toast message shown (the real queue plays one at a time). */
const toasts = vi.hoisted(() => [] as string[]);
vi.mock('../components/toast', async (orig) => {
  const real = await orig<typeof import('../components/toast')>();
  return { ...real, showToast: (m: string, o?: Parameters<typeof real.showToast>[1]) => { toasts.push(m); real.showToast(m, o); } };
});

function mcq(id: string): MCQItem {
  return { id, subjectCode: 'HIST', tier: 1, question: `Question ${id}?`, options: ['Alpha', 'Beta', 'Gamma', 'Delta'], answerIndex: 0 } as MCQItem;
}
const items = (): MCQItem[] => [mcq('qa'), mcq('qb'), mcq('qc'), mcq('qd')];
const SESSION = { key: 'test:k', label: 'Test · Practice', route: '/practice?resume=test%3Ak', backPath: '/revise/weak' };

function saved(opts: Partial<DrillSession> = {}): DrillSession {
  const now = new Date().toISOString();
  return { key: 'test:k', label: 'Test', itemIds: ['qa', 'qb', 'qc', 'qd'], index: 1, answers: { qa: { chosen: 0 }, qb: { chosen: 2 } }, startedAtISO: now, updatedAtISO: now, route: SESSION.route, ...opts };
}

const optionCards = (root: ParentNode): HTMLButtonElement[] => [...root.querySelectorAll<HTMLButtonElement>('.option-card')];
const count = (root: ParentNode): string => root.querySelector('.focus-count')?.textContent ?? '';
function btn(root: ParentNode, text: string): HTMLButtonElement {
  const b = [...root.querySelectorAll<HTMLButtonElement>('button')].find((x) => x.textContent?.trim().startsWith(text));
  if (!b) throw new Error(`button not found: ${text}`);
  return b;
}
/** Answer the current question (option `i`) and go Next. */
function answerAndNext(root: ParentNode, i = 0): void {
  optionCards(root)[i]!.click();
  btn(root, 'Next question').click();
}

beforeEach(() => {
  localStorage.clear();
  __resetForTests();
  clearAllDrillSessions();
  location.hash = '';
  toasts.length = 0;
});

describe('mountQuiz — session restore / save / clear', () => {
  it('restores the question + answers for a MATCHING key and list, without re-recording', () => {
    saveDrillSession(saved());
    const root = document.createElement('div');
    mountQuiz(root, items(), () => {}, { allowEndSession: true, session: SESSION });
    // Q1 + Q2 answered → resumes on Q3.
    expect(count(root)).toBe('Question 3 of 4');
    expect(root.querySelectorAll('.q-nav-item.is-correct').length).toBe(1);
    expect(root.querySelectorAll('.q-nav-item.is-wrong').length).toBe(1);
    // Nothing was recorded by the restore.
    expect(loadState().progress.qa).toBeUndefined();
    expect(loadState().progress.qb).toBeUndefined();
  });

  it('ignores a session for another key, and replaces one over a different list', () => {
    saveDrillSession(saved({ key: 'other' }));
    const root = document.createElement('div');
    mountQuiz(root, items(), () => {}, { session: SESSION });
    expect(count(root)).toBe('Question 1 of 4');
    expect(root.querySelectorAll('.q-nav-item.is-correct, .q-nav-item.is-wrong').length).toBe(0);
    expect(loadDrillSession('other')).not.toBeNull();

    saveDrillSession(saved({ itemIds: ['qa', 'qb', 'qx', 'qd'] }));
    const root2 = document.createElement('div');
    mountQuiz(root2, items(), () => {}, { session: SESSION });
    expect(count(root2)).toBe('Question 1 of 4');
    expect(loadDrillSession('test:k')).toBeNull();
  });

  it('saves after every answer and on question change', () => {
    const root = document.createElement('div');
    mountQuiz(root, items(), () => {}, { session: SESSION });
    expect(loadDrillSession('test:k')).toBeNull(); // nothing before the first answer
    optionCards(root)[1]!.click();
    expect(loadDrillSession('test:k')?.answers).toEqual({ qa: expect.objectContaining({ chosen: 1 }) });
    btn(root, 'Next question').click();
    expect(loadDrillSession('test:k')?.index).toBe(1);
  });

  it('Pause saves the place and navigates back with a toast; End session stays distinct', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    mountQuiz(root, items(), () => {}, { allowEndSession: true, session: SESSION });
    answerAndNext(root);
    const pause = btn(root, 'Pause');
    const end = btn(root, 'End session');
    expect(pause.title).toBe('Save your place and come back later');
    expect(end.title).toBe('Finish now and see your results');
    pause.click();
    expect(location.hash).toBe('#/revise/weak');
    const s = loadDrillSession('test:k')!;
    expect(s.index).toBe(1);
    expect(Object.keys(s.answers)).toEqual(['qa']);
    expect(toasts).toContain(PAUSED_TOAST);
    root.remove();
  });

  it('completing the run (results) clears the session; End session clears it too', () => {
    let done = 0;
    const root = document.createElement('div');
    mountQuiz(root, items(), () => { done += 1; }, { session: SESSION });
    for (let i = 0; i < 3; i += 1) answerAndNext(root);
    expect(loadDrillSession('test:k')).not.toBeNull();
    optionCards(root)[0]!.click();
    expect(loadDrillSession('test:k')).toBeNull(); // every question answered → complete
    btn(root, 'See results').click();
    expect(done).toBe(1);

    const root2 = document.createElement('div');
    mountQuiz(root2, items(), () => { done += 1; }, { allowEndSession: true, session: SESSION });
    optionCards(root2)[0]!.click();
    expect(loadDrillSession('test:k')).not.toBeNull();
    btn(root2, 'End session').click();
    expect(loadDrillSession('test:k')).toBeNull();
  });

  it('never double-records answers on resume (progress counts each answer once)', () => {
    const root = document.createElement('div');
    mountQuiz(root, items(), () => {}, { session: SESSION });
    answerAndNext(root, 0);
    answerAndNext(root, 1);
    expect(loadState().progress.qa?.seen).toBe(1);
    expect(loadState().progress.qb?.seen).toBe(1);
    // Resume (a fresh mount, as after Pause / reload) and finish the run.
    let score: { total: number; correct: number } | null = null;
    const root2 = document.createElement('div');
    mountQuiz(root2, items(), (s) => { score = s; }, { allowEndSession: true, session: SESSION });
    expect(count(root2)).toBe('Question 3 of 4');
    answerAndNext(root2, 0);
    btn(root2, 'End session').click();
    const p = loadState().progress;
    expect(p.qa?.seen).toBe(1);
    expect(p.qb?.seen).toBe(1);
    expect(p.qc?.seen).toBe(1);
    // The session score still counts the restored answers.
    expect(score).toMatchObject({ total: 3, correct: 2 });
  });
});

describe('resume entry points (full app)', () => {
  const STONE = 'hist-ancient-stone-age';

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-14T10:00:00'));
    setPlanStartDate('2026-10-14');
    markRowKeyDone('2026-10-14', START_HERE_KEY);
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  function app(): HTMLElement {
    document.body.innerHTML = '';
    const root = document.createElement('div');
    document.body.appendChild(root);
    renderApp(root);
    return root.querySelector<HTMLElement>('#view')!;
  }

  it('Stone Age: answer 3 → Pause → Today row + hero say "question 4 of N" → Resume lands on Q4 with 3 answers; reload keeps it; finishing removes it', () => {
    const n = getSubtopic(STONE)!.mcqs.length;
    const view = app();
    navigate(learnPath(STONE, 'practice', { from: 'today' }));
    btn(view, 'Start practice').click();
    for (let i = 0; i < 3; i += 1) answerAndNext(view);
    expect(location.hash).toContain('resume=learn%3A');
    btn(view, 'Pause').click();
    expect(location.hash).toBe('#/');

    const text = `Resume practice \u00b7 question 4 of ${n}`;
    const row = [...view.querySelectorAll<HTMLElement>('.today-check-btn')].find((b) => b.textContent?.includes(text));
    expect(row).toBeDefined();
    expect(row!.textContent).toContain('Stone Age');
    row!.click();
    expect(count(view)).toBe(`Question 4 of ${n}`);
    expect(view.querySelectorAll('.q-nav-item.is-correct, .q-nav-item.is-wrong').length).toBe(3);

    // Reload mid-drill → the same place.
    const view2 = app();
    expect(count(view2)).toBe(`Question 4 of ${n}`);
    expect(view2.querySelectorAll('.q-nav-item.is-correct, .q-nav-item.is-wrong').length).toBe(3);

    // The topic's Practice tab offers Resume + Start again with the same text.
    navigate(learnPath(STONE, 'practice', { from: 'today' }));
    expect(btn(view2, 'Resume practice').textContent?.trim()).toBe(text);
    expect(btn(view2, 'Start again')).toBeDefined();

    // Finish: resume → End session → the entry is gone everywhere.
    btn(view2, 'Resume practice').click();
    btn(view2, 'End session').click();
    expect(loadDrillSession(`learn:${STONE}`)).toBeNull();
    navigate('/');
    expect(view2.textContent).not.toContain('Resume practice');
  });

  it('a changed question set is discarded with a toast and starts fresh', () => {
    const ids = getSubtopic(STONE)!.mcqs.map((m) => m.id);
    const now = new Date().toISOString();
    saveDrillSession({ key: `learn:${STONE}`, label: 'Stone Age · Practice', itemIds: ids.slice(0, 3), index: 1, answers: { [ids[0]!]: { chosen: 0 } }, startedAtISO: now, updatedAtISO: now, route: learnPath(STONE, 'practice') });
    const view = app();
    navigate(learnPath(STONE, 'practice', { from: 'today' }));
    btn(view, 'Resume practice').click();
    expect(toasts).toContain(SET_CHANGED_TOAST);
    expect(count(view)).toBe(`Question 1 of ${ids.length}`);
  });

  it('the Practice hub lists paused runs with Resume and Discard', () => {
    const view = app();
    navigate('/practice');
    btn(view, 'Full practice').click();
    answerAndNext(view);
    btn(view, 'Pause').click();
    expect(location.hash).toBe('#/practice');
    const card = view.querySelector<HTMLElement>('.paused-runs')!;
    expect(card).not.toBeNull();
    expect(card.textContent).toContain('Full practice');
    expect(card.textContent).toContain('1 of');
    btn(card, 'Resume').click();
    expect(count(view)).toMatch(/^Question 2 of \d+$/);
    btn(view, 'Pause').click();
    btn(view.querySelector('.paused-runs')!, 'Discard').click();
    expect(view.querySelector('.paused-runs')).toBeNull();
  });

  it('a weakest-area drill reopens from its resume route, pauses back to Weak areas, and finishing clears it', () => {
    const ids = getSubtopic(STONE)!.mcqs.map((m) => m.id).slice(0, 4);
    const key = `weak:${STONE}`;
    const now = new Date().toISOString();
    saveDrillSession({ key, label: 'Stone Age · Weak-area drill', itemIds: ids, index: 1, answers: { [ids[0]!]: { chosen: 0 }, [ids[1]!]: { chosen: 1 } }, startedAtISO: now, updatedAtISO: now, route: `/revise/weak?resume=${encodeURIComponent(key)}` });
    const before = loadState().progress[ids[0]!]?.seen ?? 0;
    const view = app();
    navigate(`/revise/weak?resume=${encodeURIComponent(key)}`);
    expect(count(view)).toBe('Question 3 of 4');
    expect(view.querySelectorAll('.q-nav-item.is-correct, .q-nav-item.is-wrong').length).toBe(2);
    expect(loadState().progress[ids[0]!]?.seen ?? 0).toBe(before); // restore never re-records
    btn(view, 'Pause').click();
    expect(location.hash).toBe('#/revise/weak');
    expect(toasts).toContain(PAUSED_TOAST);
    expect(loadDrillSession(key)?.index).toBe(2);
    navigate(`/revise/weak?resume=${encodeURIComponent(key)}`);
    btn(view, 'End session').click();
    expect(loadDrillSession(key)).toBeNull();
  });

  it('a Today set (CA) resumes on its SAVED questions after Pause and reload', () => {
    const ids = getSubtopic('ca-regional')?.mcqs.map((m) => m.id).slice(0, 6) ?? [];
    expect(ids.length).toBe(6);
    const view = app();
    const spec = { title: 'CA set', lead: 'Six questions.', ids, key: 'test-ca', dateISO: '2026-10-14' };
    runSet(spec);
    btn(view, 'Start the 6-question set').click();
    answerAndNext(view);
    answerAndNext(view);
    btn(view, 'Pause').click();
    expect(location.hash).toBe('#/');
    // The set page offers Resume + Start again (even though fresh-first would now pick other ids).
    navigate(setRoute(spec));
    expect(btn(view, 'Resume practice').textContent?.trim()).toBe('Resume practice \u00b7 question 3 of 6');
    btn(view, 'Resume practice').click();
    expect(count(view)).toBe('Question 3 of 6');
    expect(location.hash).toContain('resume=set%3Atest-ca%3A2026-10-14');
    // Reload mid-set → straight back into the run.
    const view2 = app();
    expect(count(view2)).toBe('Question 3 of 6');
  });
});
