/**
 * Progress — a genuine learner-analytics dashboard (route `#/progress`).
 *
 * Every number here is REAL, derived from `state.progress` / `state.flashcards`
 * / `state.notebook` joined with the loaded content — never a decorative or
 * fabricated figure (0s are shown honestly on a fresh profile). It surfaces:
 *   - an overall MASTERY ring (share of all MCQs answered correctly ≥ once) plus
 *     honest counts (questions attempted, accuracy, subtopics started/mastered,
 *     flashcards due);
 *   - a "Mistakes to review" card linking to the wrong-answer Notebook;
 *   - a per-subject → per-subtopic breakdown (progress bar + status chip),
 *     sorted chronologically by default with a "weakest first" toggle, each row
 *     opening the subtopic's Learn workspace to drill it.
 * A friendly empty state invites the first drill when nothing is attempted yet.
 */
import { getSubjects, getSubtopic, getSubtopicCoverage, getSubtopics } from '../content/loader';
import type { TaxonomySubtopic } from '../content/taxonomy';
import { activeEntries } from '../engine/notebook';
import { navigate } from '../router/router';
import { loadState, getTestAttempts, type TestAttemptRecord } from '../state/store';
import {
  dueCount,
  pct,
  formatNet,
  statusFromMastery,
  subtopicMasteryPct,
  type SubtopicStatus,
} from '../lib/metrics';
import { el, mount } from './dom';
import { card } from './components/card';
import { button } from './components/button';
import { icon } from './components/icon';
import { ring } from './components/ring';
import { progressBar } from './components/progress';
import { bandBadge, statusChip } from './components/badges';
import { openLearn } from './learn';

/** How the breakdown rows are ordered. */
type BreakdownSort = 'order' | 'weakest';

/** Preserved across re-renders within a session. */
let breakdownSort: BreakdownSort = 'order';

/** Per-subtopic analytics joined from progress + content. @internal */
interface SubRow {
  meta: TaxonomySubtopic;
  /** Authored MCQ count. */
  total: number;
  /** Distinct MCQs attempted at least once. */
  answered: number;
  /** Total attempts (sum of `seen`). */
  attempts: number;
  /** Total correct attempts. */
  correct: number;
  /** correct / attempts in [0, 1]. */
  accuracy: number;
  /** Learner-progress percent (mastery), 0–100. */
  mastery: number;
  status: SubtopicStatus;
  /** Exam-point coverage (present only when the subtopic declares examPoints). */
  examCoverage?: { pct: number; covered: number; total: number };
}

/** Build the analytics row for a subtopic. @internal */
function subRowFor(meta: TaxonomySubtopic): SubRow {
  const view = getSubtopic(meta.id);
  const ids = view?.mcqs.map((m) => m.id) ?? [];
  const progress = loadState().progress;
  let answered = 0;
  let attempts = 0;
  let correct = 0;
  for (const id of ids) {
    const p = progress[id];
    if (p && p.seen > 0) {
      answered += 1;
      attempts += p.seen;
      correct += p.correct;
    }
  }
  const mastery = subtopicMasteryPct(progress, ids);
  const cov = getSubtopicCoverage(meta.id)?.examPoints;
  return {
    meta,
    total: ids.length,
    answered,
    attempts,
    correct,
    accuracy: attempts > 0 ? correct / attempts : 0,
    mastery,
    status: statusFromMastery(mastery),
    examCoverage: cov ? { pct: cov.pct, covered: cov.covered.length, total: cov.total } : undefined,
  };
}

/** Status → weakness rank (weakest first). @internal */
const STATUS_RANK: Record<SubtopicStatus, number> = {
  'not-started': 0,
  learning: 1,
  revised: 2,
  mastered: 3,
};

/** Overall roll-up across every subtopic row. @internal */
interface Overall {
  totalMcq: number;
  masteredOnce: number;
  answered: number;
  attempts: number;
  correct: number;
  subtopicsTotal: number;
  subtopicsWithMaterial: number;
  subtopicsStarted: number;
  subtopicsMastered: number;
  masteryPct: number;
  accuracy: number;
}

/** Fold all rows into the overall summary. @internal */
function rollUp(rows: SubRow[]): Overall {
  let totalMcq = 0;
  let masteredOnce = 0;
  let answered = 0;
  let attempts = 0;
  let correct = 0;
  let subtopicsWithMaterial = 0;
  let subtopicsStarted = 0;
  let subtopicsMastered = 0;
  for (const r of rows) {
    totalMcq += r.total;
    // # distinct MCQs answered correctly at least once = mastery% * total.
    masteredOnce += Math.round((r.mastery / 100) * r.total);
    answered += r.answered;
    attempts += r.attempts;
    correct += r.correct;
    if (r.total > 0) subtopicsWithMaterial += 1;
    if (r.answered > 0) subtopicsStarted += 1;
    if (r.status === 'mastered') subtopicsMastered += 1;
  }
  return {
    totalMcq,
    masteredOnce,
    answered,
    attempts,
    correct,
    subtopicsTotal: rows.length,
    subtopicsWithMaterial,
    subtopicsStarted,
    subtopicsMastered,
    masteryPct: totalMcq > 0 ? Math.round((masteredOnce / totalMcq) * 100) : 0,
    accuracy: attempts > 0 ? correct / attempts : 0,
  };
}

/** Render the Progress dashboard into `root`. */
export function render(root: HTMLElement): void {
  const draw = (): void => {
    const state = loadState();
    const rows = getSubjects().flatMap((s) => getSubtopics(s.code).map(subRowFor));
    const overall = rollUp(rows);

    // Nothing attempted yet → a single friendly, honest empty state.
    if (overall.attempts === 0) {
      mount(root, emptyState());
      return;
    }

    const due = dueCount(state.flashcards, Date.now());
    const mistakes = activeEntries(state.notebook).length;

    mount(
      root,
      buildOverview(overall, due),
      buildMistakes(mistakes),
      buildNegMarkingHabit(getTestAttempts()),
      buildBreakdown(rows, draw),
    );
  };
  draw();
}

/** Friendly empty state shown before any question is attempted. @internal */
function emptyState(): HTMLElement {
  return card({ title: 'Progress' }, [
    el('div', { class: 'empty-state' }, [
      el('span', { class: 'empty-icon' }, [icon('target', 26)]),
      el('h3', { text: 'No progress yet' }),
      el('p', { text: 'Answer a few questions in a drill and your mastery, accuracy and per-topic breakdown will appear here.' }),
      button({ label: 'Start a drill', variant: 'primary', iconName: 'arrow-right', onClick: () => navigate('/drill') }),
    ]),
  ]);
}

/** The overall mastery ring + honest stat tiles. @internal */
function buildOverview(o: Overall, due: number): HTMLElement {
  const ringCard = el('div', { class: 'card ring-card pv-ring' }, [
    ring({ value: o.masteryPct / 100, centerText: `${o.masteryPct}%`, centerLabel: 'mastery' }),
    el('span', { class: 'ring-caption', text: 'Overall mastery' }),
    el('span', { class: 'ring-sub', text: `${o.masteredOnce}/${o.totalMcq} questions answered correctly` }),
  ]);

  const stats = el('div', { class: 'pv-stats' }, [
    statTile(String(o.answered), 'Questions attempted', `${o.attempts} total attempts`),
    statTile(pct(o.accuracy), 'Accuracy', `${o.correct}/${o.attempts} correct`),
    statTile(`${o.subtopicsStarted}/${o.subtopicsTotal}`, 'Subtopics started', `${o.subtopicsMastered} mastered · ${o.subtopicsWithMaterial} with material`),
    statTile(String(due), 'Flashcards due', due > 0 ? 'ready for review' : 'all caught up'),
  ]);

  return el('section', { class: 'pv-overview' }, [ringCard, stats]);
}

/** A single stat tile (value + label + sub-line). @internal */
function statTile(value: string, label: string, sub: string): HTMLElement {
  return el('div', { class: 'card pv-stat' }, [
    el('span', { class: 'pv-stat-value tnum', text: value }),
    el('span', { class: 'pv-stat-label', text: label }),
    el('span', { class: 'pv-stat-sub', text: sub }),
  ]);
}

/** "Mistakes to review" card linking to the Notebook. @internal */
function buildMistakes(count: number): HTMLElement {
  const body = count > 0
    ? `${count} question${count === 1 ? '' : 's'} waiting in your wrong-answer notebook.`
    : 'Your notebook is clear — missed questions will collect here to review.';
  return card({ title: 'Mistakes to review' }, [
    el('div', { class: 'pv-mistakes' }, [
      el('div', { class: 'pv-mistakes-lead' }, [
        el('span', { class: 'pv-stat-value tnum', text: String(count) }),
        el('span', { class: 'section-lead', text: body }),
      ]),
      button({ label: 'Open notebook', variant: count > 0 ? 'primary' : 'ghost', iconName: 'arrow-right', onClick: () => navigate('/notebook') }),
    ]),
  ]);
}

/**
 * The "Negative-marking habit" card: a compact trend over recent tests of
 * guess accuracy and marks lost to wrong answers, so the learner can see
 * whether their guessing is costing or paying. Returns `null` when no test has
 * been taken yet (nothing to trend). @internal
 */
function buildNegMarkingHabit(attempts: readonly TestAttemptRecord[]): HTMLElement | null {
  if (attempts.length === 0) return null;
  const recent = attempts.slice(-8);

  // Aggregate guess accuracy + marks lost across the recent window.
  let guessAttempted = 0;
  let guessCorrect = 0;
  let marksLost = 0;
  for (const a of recent) {
    guessAttempted += a.guessAttempted;
    guessCorrect += a.guessCorrect;
    marksLost += a.marksLostToWrong;
  }
  const guessAcc = guessAttempted > 0 ? guessCorrect / guessAttempted : 0;

  const lead = el('p', { class: 'section-lead' }, [
    guessAttempted > 0
      ? `Over your last ${recent.length} test${recent.length === 1 ? '' : 's'} you got ${pct(guessAcc)} of your Guess answers right and shed ${formatNet(marksLost)} marks to wrong answers.`
      : `Over your last ${recent.length} test${recent.length === 1 ? '' : 's'} you shed ${formatNet(marksLost)} marks to wrong answers. Tag answers Sure / 50-50 / Guess during a test to track guess accuracy.`,
  ]);

  // A tiny per-test trend row (most recent last): marks lost + guess accuracy.
  const trendRows = recent.map((a) => {
    const ga = a.guessAttempted > 0 ? a.guessCorrect / a.guessAttempted : null;
    return el('tr', {}, [
      el('td', { text: new Date(a.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) }),
      el('td', { text: a.kind.replace(/-/g, ' ') }),
      el('td', { class: 'tnum', text: formatNet(a.net) }),
      el('td', { class: 'tnum', text: `−${formatNet(a.marksLostToWrong)}` }),
      el('td', { class: 'tnum', text: ga === null ? '—' : pct(ga) }),
    ]);
  });

  const table = el('table', { class: 'mock-section-table' }, [
    el('caption', { class: 'field-label', text: 'Recent tests' }),
    el('thead', {}, [
      el('tr', {}, [
        el('th', { attrs: { scope: 'col' }, text: 'Date' }),
        el('th', { attrs: { scope: 'col' }, text: 'Test' }),
        el('th', { attrs: { scope: 'col' }, text: 'Net' }),
        el('th', { attrs: { scope: 'col' }, text: 'Marks lost' }),
        el('th', { attrs: { scope: 'col' }, text: 'Guess acc' }),
      ]),
    ]),
    el('tbody', {}, trendRows),
  ]);

  const rule = el('p', { class: 'neg-rule', attrs: { role: 'note' } }, [
    el('strong', { text: 'Rule of thumb: ' }),
    el('span', { text: 'answer when you can eliminate 2 options; skip pure guesses.' }),
  ]);

  return card({ title: 'Negative-marking habit' }, [lead, table, rule]);
}

/** Per-subject → per-subtopic breakdown with a sort toggle. @internal */
function buildBreakdown(rows: SubRow[], rerender: () => void): HTMLElement {
  const sorted = (list: SubRow[]): SubRow[] => {
    if (breakdownSort === 'weakest') {
      return [...list].sort((a, b) => {
        const st = STATUS_RANK[a.status] - STATUS_RANK[b.status];
        if (st !== 0) return st;
        if (a.mastery !== b.mastery) return a.mastery - b.mastery;
        return a.meta.order - b.meta.order;
      });
    }
    return [...list].sort((a, b) => a.meta.order - b.meta.order);
  };

  const subjectSections = getSubjects().map((s) => {
    const subjectRows = sorted(rows.filter((r) => r.meta.subjectCode === s.code));
    return card({ title: s.name, subtitle: `${subjectRows.length} subtopic(s)` }, [
      el('div', { class: 'pv-breakdown' }, subjectRows.map(breakdownRow)),
    ]);
  });

  return el('section', {}, [
    el('div', { class: 'filter-bar' }, [
      el('span', { class: 'filter-label', text: 'Sort:' }),
      sortChip('Chronological', 'order', rerender),
      sortChip('Weakest first', 'weakest', rerender),
    ]),
    ...subjectSections,
  ]);
}

/** A sort toggle chip for the breakdown. @internal */
function sortChip(label: string, value: BreakdownSort, rerender: () => void): HTMLElement {
  const c = el('span', {
    class: breakdownSort === value ? 'chip chip-accent' : 'chip',
    attrs: { role: 'button', tabindex: '0' },
  }, [document.createTextNode(label)]);
  c.style.cursor = 'pointer';
  const activate = (): void => {
    breakdownSort = value;
    rerender();
  };
  c.addEventListener('click', activate);
  c.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') {
      e.preventDefault();
      activate();
    }
  });
  return c;
}

/** One breakdown row — opens the subtopic's Learn workspace to drill it. @internal */
function breakdownRow(row: SubRow): HTMLElement {
  return el('button', {
    class: 'track-row',
    type: 'button',
    ariaLabel: `${row.meta.name} — Progress ${row.mastery}%, ${row.answered} attempted, accuracy ${pct(row.accuracy)}`,
    onClick: () => openLearn(row.meta.id),
  }, [
    el('div', { class: 'track-row-main' }, [
      el('span', { class: 'track-row-name', text: row.meta.name }),
      el('div', { class: 'track-row-badges' }, [
        row.meta.band ? bandBadge(row.meta.band) : null,
        statusChip(row.status),
      ]),
    ]),
    el('div', { class: 'track-row-cov' }, [progressBar({ value: row.mastery / 100, label: 'Progress', caption: `${row.mastery}%`, success: row.mastery >= 100 })]),
    el('div', { class: 'track-row-counts' }, [
      statPill('drill', `${row.answered} tried`),
      statPill('target', row.attempts > 0 ? `${pct(row.accuracy)} acc` : '—'),
      row.examCoverage ? statPill('target', `${row.examCoverage.pct}% cov`) : null,
    ]),
    el('span', { class: 'track-row-go' }, [icon('chevron', 16)]),
  ]);
}

/** A small icon + text stat pill. @internal */
function statPill(iconName: Parameters<typeof icon>[0], text: string): HTMLElement {
  return el('span', { class: 'track-pill' }, [icon(iconName, 14), el('span', { class: 'tnum', text })]);
}
