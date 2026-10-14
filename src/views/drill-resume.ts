/**
 * Resume helpers shared by every untimed-drill entry point (Today rows, the
 * topic's Practice tab, the Practice hub's "Paused runs", weak areas, sets,
 * the notebook). All of them derive their text and behaviour from the SAME
 * functions here, over {@link ../lib/drill-session}.
 */
import { getBanks } from '../content/loader';
import type { MCQItem } from '../content/types';
import {
  answeredText,
  clearDrillSession,
  loadDrillSession,
  loadDrillSessions,
  resumeText,
  sameItemSet,
  type DrillSession,
} from '../lib/drill-session';
import { navigate, routeQuery } from '../router/router';
import { el } from './dom';
import { button } from './components/button';
import { icon } from './components/icon';
import { showToast } from './components/toast';

/** Toast when a saved run's questions changed underneath it. */
export const SET_CHANGED_TOAST = 'This practice set changed \u2014 starting fresh';

/** id → MCQ across every bank (rebuilt per call; banks are in memory). @internal */
function mcqIndex(): Map<string, MCQItem> {
  const map = new Map<string, MCQItem>();
  for (const { bank } of getBanks('mcq')) {
    if (bank.kind !== 'mcq') continue;
    for (const item of bank.items) map.set(item.id, item);
  }
  return map;
}

/** Whether an MCQ id exists in the current banks. */
function existsFn(): (id: string) => boolean {
  const idx = mcqIndex();
  return (id) => idx.has(id);
}

/** Every live paused run (most recent first). */
export function pausedDrills(): DrillSession[] {
  return loadDrillSessions(existsFn());
}

/** The live paused run for `key` (null when none / expired / bank changed). */
export function pausedDrill(key: string): DrillSession | null {
  return loadDrillSession(key, existsFn());
}

/** The resume button text for `key`, or null when there is nothing to resume. */
export function resumeLabelFor(key: string): string | null {
  const s = pausedDrill(key);
  return s ? resumeText(s) : null;
}

/** Whether the current URL asks to resume `key` (`?resume=<key>`). */
export function resumeRequested(key: string): boolean {
  return routeQuery('resume') === key;
}

/** Reopen a paused run at its saved route. */
export function resumeDrill(s: DrillSession): void {
  navigate(s.route);
}

/** Discard the paused run for `key`. */
export function discardDrill(key: string): void {
  clearDrillSession(key);
}

/**
 * The questions to resume `key` with, in the saved order, or null when there
 * is no session. When the saved questions no longer exist — or, with
 * `expected`, are no longer the run's question set — the session is discarded
 * with a "set changed" toast and null is returned (start fresh).
 */
export function resumeItems(key: string, expected?: readonly string[]): MCQItem[] | null {
  const idx = mcqIndex();
  // Load WITHOUT the exists filter first so a changed bank is noticed (and toasted).
  const saved = loadDrillSession(key);
  if (!saved) return null;
  const items = saved.itemIds.map((id) => idx.get(id));
  const changed = items.some((x) => x === undefined) || (expected !== undefined && !sameItemSet(saved.itemIds, expected));
  if (changed) {
    clearDrillSession(key);
    showToast(SET_CHANGED_TOAST, { tone: 'info' });
    return null;
  }
  return items as MCQItem[];
}

/**
 * The Practice hub's "Paused runs" card: each paused run with its label,
 * progress, Resume and Discard. Null when nothing is paused.
 */
export function pausedRunsCard(onChange: () => void): HTMLElement | null {
  const runs = pausedDrills();
  if (runs.length === 0) return null;
  return el('section', { class: 'card resume-test-card paused-runs', attrs: { 'aria-label': 'Paused runs' } }, [
    el('h2', { class: 'card-title', text: 'Paused runs' }),
    el('ul', { class: 'paused-runs-list' }, runs.map((s) =>
      el('li', { class: 'resume-test paused-run', attrs: { 'data-key': s.key } }, [
        el('span', { class: 'empty-icon' }, [icon('drill', 20)]),
        el('div', { class: 'resume-test-text' }, [
          el('strong', { text: s.label }),
          el('span', { class: 'section-lead', text: `${answeredText(s)} \u00b7 ${resumeText(s).replace(/^Resume practice \u00b7 /, 'next: ')}` }),
        ]),
        el('div', { class: 'resume-test-actions' }, [
          button({ label: 'Resume', variant: 'primary', iconName: 'arrow-right', ariaLabel: `Resume ${s.label} \u2014 ${resumeText(s)}`, onClick: () => resumeDrill(s) }),
          button({
            label: 'Discard',
            variant: 'ghost',
            ariaLabel: `Discard paused run ${s.label}`,
            onClick: () => {
              discardDrill(s.key);
              onChange();
            },
          }),
        ]),
      ]),
    )),
  ]);
}
