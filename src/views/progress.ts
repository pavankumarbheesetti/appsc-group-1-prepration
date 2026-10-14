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
import { ACCURACY_LABEL, accuracyCaption, accuracyPct, formatAccuracy } from '../lib/accuracy';
import { getSubjects, getSubtopic, getSubtopicCoverage, getSubtopics } from '../content/loader';
import type { TaxonomySubtopic } from '../content/taxonomy';
import { activeEntries } from '../engine/notebook';
import { navigate } from '../router/router';
import { loadState, getTestAttempts, type TestAttemptRecord } from '../state/store';
import {
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
import { bandBadge, studyStatusChip } from './components/badges';
import { topicStudyFrom, type StudyStatus } from '../lib/study-status';
import { caUpToDateLine, studySummary, studiedLine, anyStudyActivity, type StudySummary } from '../lib/study-summary';
import { chip } from './components/chip';
import { liveFlashcardDue, questionsDue, flashcardTodayLine, type FlashcardDue } from '../lib/due';
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
  /** The study status (ONE vocabulary shared with the plan / Today / Learn). */
  study: StudyStatus;
  /** Exam-point coverage (present only when the subtopic declares examPoints). */
  examCoverage?: { pct: number; covered: number; total: number };
}

/** Build the analytics row for a subtopic. @internal */
function subRowFor(meta: TaxonomySubtopic): SubRow {
  const view = getSubtopic(meta.id);
  const ids = view?.mcqs.map((m) => m.id) ?? [];
  const state = loadState();
  const progress = state.progress;
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
    accuracy: (accuracyPct(correct, attempts) ?? 0) / 100,
    mastery,
    status: statusFromMastery(mastery),
    study: topicStudyFrom(state, meta.id).status,
    examCoverage: cov ? { pct: cov.pct, covered: cov.covered.length, total: cov.total } : undefined,
  };
}

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

    const study = studySummary(state);
    // Empty state ONLY when nothing is studied/started AND nothing answered.
    if (overall.attempts === 0 && study.studied === 0 && study.inProgress === 0 && !anyStudyActivity(state)) {
      mount(root, emptyState());
      return;
    }

    const due = liveFlashcardDue();
    const mistakes = activeEntries(state.notebook).length;

    mount(
      root,
      buildOverview(overall, due, study, questionsDue(state).length),
      buildMistakes(mistakes),
      buildNegMarkingHabit(getTestAttempts()),
      buildBreakdown(rows, draw, study),
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
      el('p', { text: 'Study a topic (Mark as studied) or answer a few questions and your studied count, accuracy and per-topic breakdown will appear here.' }),
      button({ label: 'Start practice', variant: 'primary', iconName: 'arrow-right', onClick: () => navigate('/practice') }),
    ]),
  ]);
}

/** The overall mastery ring + honest stat tiles. @internal */
function buildOverview(o: Overall, due: FlashcardDue, study: StudySummary, questions: number): HTMLElement {
  const ringCard = el('div', { class: 'card ring-card pv-ring' }, [
    ring({ value: o.masteryPct / 100, centerText: `${o.masteryPct}%`, centerLabel: 'mastery' }),
    el('span', { class: 'ring-caption', text: 'Overall mastery' }),
    el('span', { class: 'ring-sub', text: `${o.masteredOnce}/${o.totalMcq} questions answered correctly` }),
  ]);

  const stats = el('div', { class: 'pv-stats' }, [
    statTile(`${study.studied}/${study.total}`, studiedLine(study), `${study.inProgress} in progress \u00b7 Prelims topics`),
    statTile(String(o.answered), 'Questions attempted', `${o.attempts} total attempts \u00b7 ${questions} due for review`),
    statTile(o.attempts > 0 ? pct(o.accuracy) : '\u2014', 'Accuracy', o.attempts > 0 ? `${o.correct}/${o.attempts} correct` : 'answer some questions'),
    statTile(String(due.today), 'Flashcards for today', due.today > 0 ? `${due.due} due in total` : flashcardTodayLine(due)),
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
      button({ label: 'Open my mistakes', variant: count > 0 ? 'primary' : 'ghost', iconName: 'arrow-right', onClick: () => navigate('/revise/mistakes') }),
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
function buildBreakdown(rows: SubRow[], rerender: () => void, subjectStudy?: StudySummary): HTMLElement {
  const sorted = (list: SubRow[]): SubRow[] => {
    if (breakdownSort === 'weakest') {
      // Weakest = lowest ACCURACY among answered topics (the same number the
      // rows show); topics with no answers yet follow, in syllabus order.
      return [...list].sort((a, b) => {
        const aa = a.attempts > 0 ? 0 : 1;
        const bb = b.attempts > 0 ? 0 : 1;
        if (aa !== bb) return aa - bb;
        if (a.accuracy !== b.accuracy) return a.accuracy - b.accuracy;
        return a.meta.order - b.meta.order;
      });
    }
    return [...list].sort((a, b) => a.meta.order - b.meta.order);
  };

  const subjectSections = getSubjects().map((s) => {
    const subjectRows = sorted(rows.filter((r) => r.meta.subjectCode === s.code));
    const counts = subjectStudy?.bySubject[s.code];
    const subtitle = counts
      ? `${studiedLine(counts)} \u00b7 ${subjectRows.length} subtopic(s)`
      : `${subjectRows.length} subtopic(s)`;
    return card({ title: s.name, subtitle }, [
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

/** Plain study-status words for aria labels. @internal */
const STUDY_WORD: Record<StudyStatus, string> = { 'not-started': 'Not started', 'in-progress': 'In progress', studied: 'Studied' };

/** One breakdown row — opens the subtopic's Learn workspace to drill it. @internal */
function breakdownRow(row: SubRow): HTMLElement {
  return el('button', {
    class: 'track-row',
    type: 'button',
    ariaLabel: `${row.meta.name} — ${STUDY_WORD[row.study]}, ${ACCURACY_LABEL} ${formatAccuracy({ pct: accuracyPct(row.correct, row.attempts) })}, ${row.answered} attempted`,
    onClick: () => openLearn(row.meta.id),
  }, [
    el('div', { class: 'track-row-main' }, [
      el('span', { class: 'track-row-name', text: row.meta.name }),
      el('div', { class: 'track-row-badges' }, [
        row.meta.band ? bandBadge(row.meta.band) : null,
        // N18: current affairs is a continuous stream, never "studied".
        row.meta.subjectCode === 'CA' ? chip({ text: caUpToDateLine(), tone: 'default', iconName: 'calendar' }) : studyStatusChip(row.study),
      ]),
    ]),
    el('div', { class: 'track-row-cov' }, [progressBar({ value: row.accuracy, label: ACCURACY_LABEL, caption: accuracyCaption({ correct: row.correct, answered: row.attempts, pct: accuracyPct(row.correct, row.attempts) }), success: row.attempts > 0 && row.correct === row.attempts })]),
    el('div', { class: 'track-row-counts' }, [
      statPill('drill', `${row.answered} tried`),
      row.examCoverage ? statPill('target', `${row.examCoverage.pct}% cov`) : null,
    ]),
    el('span', { class: 'track-row-go' }, [icon('chevron', 16)]),
  ]);
}

/** A small icon + text stat pill. @internal */
function statPill(iconName: Parameters<typeof icon>[0], text: string): HTMLElement {
  return el('span', { class: 'track-pill' }, [icon(iconName, 14), el('span', { class: 'tnum', text })]);
}
