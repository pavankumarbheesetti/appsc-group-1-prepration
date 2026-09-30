/**
 * Weak Areas view (`#/weak`) — targeted remediation.
 *
 * Ranks the learner's subtopics by WEAKNESS (lowest accuracy / most wrong among
 * those attempted) via the pure {@link rankWeakAreas}, and lists not-started
 * subtopics separately as GAPS. Each weak row shows real numbers (accuracy,
 * wrong count, mastery %, status) with two one-tap actions: "Drill these" —
 * a focus drill scoped to the subtopic's wrong/low question ids (falling back
 * to the whole subtopic when there is nothing specific) — and a "Learn" link.
 * The wrong-answer NOTEBOOK is integrated at the top (active mistake count +
 * link). A friendly empty state shows before anything is attempted.
 */
import { getSubjects, getSubtopic, getSubtopics } from '../content/loader';
import { buildSession } from '../engine/drill';
import type { SessionScore } from '../engine/drill';
import { activeEntries } from '../engine/notebook';
import { navigate } from '../router/router';
import { loadState } from '../state/store';
import { pct } from '../lib/metrics';
import { rankWeakAreas, type WeakRow, type WeakSubtopicInput } from '../lib/weak';
import { el, mount } from './dom';
import { card } from './components/card';
import { button } from './components/button';
import { icon } from './components/icon';
import { progressBar } from './components/progress';
import { bandBadge, statusChip } from './components/badges';
import { mountQuiz } from './quiz';
import { openLearn } from './learn';

/** Build the per-subtopic ranking inputs from the loader. @internal */
function weakInputs(): WeakSubtopicInput[] {
  return getSubjects().flatMap((s) =>
    getSubtopics(s.code).map((meta) => ({
      subtopicId: meta.id,
      name: meta.name,
      band: meta.band,
      mcqIds: getSubtopic(meta.id)?.mcqs.map((m) => m.id) ?? [],
    })),
  );
}

/** Render the Weak Areas view into `root`. */
export function render(root: HTMLElement): void {
  const draw = (): void => {
    const state = loadState();
    const { weak, gaps } = rankWeakAreas(weakInputs(), state.progress);
    const mistakes = activeEntries(state.notebook).length;

    // Nothing attempted yet → a single friendly, honest empty state.
    if (weak.length === 0) {
      mount(root, emptyState(gaps.length));
      return;
    }

    mount(
      root,
      buildNotebookCard(mistakes),
      buildWeakList(weak, root, draw),
      gaps.length > 0 ? buildGaps(gaps) : el('span', { class: 'sr-only' }),
    );
  };
  draw();
}

/** Friendly empty state shown before any question is attempted. @internal */
function emptyState(gapCount: number): HTMLElement {
  return card({ title: 'Weak areas' }, [
    el('div', { class: 'empty-state' }, [
      el('span', { class: 'empty-icon' }, [icon('target', 26)]),
      el('h3', { text: 'Nothing to fix yet' }),
      el('p', { text: `Answer a few questions in a drill and the topics you miss most will surface here — ranked weakest-first, each with a one-tap re-drill.${gapCount > 0 ? ` You have ${gapCount} subtopic${gapCount === 1 ? '' : 's'} still to start.` : ''}` }),
      button({ label: 'Start a drill', variant: 'primary', iconName: 'arrow-right', onClick: () => navigate('/drill') }),
    ]),
  ]);
}

/** Wrong-answer notebook integration card (active mistake count + link). @internal */
function buildNotebookCard(count: number): HTMLElement {
  const body = count > 0
    ? `${count} question${count === 1 ? '' : 's'} waiting in your wrong-answer notebook — nail each twice in a row to graduate it.`
    : 'Your notebook is clear — missed questions collect here to review.';
  return card({ title: 'Wrong-answer notebook' }, [
    el('div', { class: 'weak-notebook' }, [
      el('div', { class: 'weak-notebook-lead' }, [
        el('span', { class: 'pv-stat-value tnum', text: String(count) }),
        el('span', { class: 'section-lead', text: body }),
      ]),
      button({ label: 'Open notebook', variant: count > 0 ? 'primary' : 'ghost', iconName: 'arrow-right', onClick: () => navigate('/notebook') }),
    ]),
  ]);
}

/** The ranked weak-subtopic list (weakest first). @internal */
function buildWeakList(weak: WeakRow[], root: HTMLElement, back: () => void): HTMLElement {
  return card(
    { title: 'Weakest subtopics', subtitle: `${weak.length} attempted — ranked by accuracy, weakest first` },
    [el('div', { class: 'weak-list' }, weak.map((row) => weakRow(row, root, back)))],
  );
}

/** One weak-subtopic row with "Drill these" + "Learn". @internal */
function weakRow(row: WeakRow, root: HTMLElement, back: () => void): HTMLElement {
  const drillLabel = row.wrongQuestionIds.length > 0
    ? `Drill these ${row.wrongQuestionIds.length}`
    : 'Drill topic';

  return el('div', { class: 'weak-row card' }, [
    el('div', { class: 'weak-row-head' }, [
      el('span', { class: 'weak-row-name', text: row.name }),
      el('div', { class: 'weak-row-badges' }, [
        row.band ? bandBadge(row.band) : null,
        statusChip(row.status),
      ]),
    ]),
    progressBar({ value: row.mastery / 100, label: 'Mastery', caption: `${row.mastery}%`, success: row.mastery >= 100 }),
    el('div', { class: 'weak-row-stats' }, [
      statPill('target', `${pct(row.accuracy)} accuracy`),
      statPill('x', `${row.wrong} wrong`),
      statPill('drill', `${row.attempted}/${row.total} tried`),
    ]),
    el('div', { class: 'weak-row-actions' }, [
      button({ label: drillLabel, variant: 'primary', iconName: 'drill', onClick: () => runDrill(root, row, back) }),
      button({ label: 'Learn', variant: 'ghost', iconName: 'arrow-right', onClick: () => openLearn(row.subtopicId) }),
    ]),
  ]);
}

/** A small icon + text stat pill. @internal */
function statPill(iconName: Parameters<typeof icon>[0], text: string): HTMLElement {
  return el('span', { class: 'weak-pill' }, [icon(iconName, 14), el('span', { class: 'tnum', text })]);
}

/**
 * Start a focus drill scoped to this subtopic's weak questions. When there are
 * specific wrong/low question ids, restrict to exactly those; otherwise fall
 * back to the whole subtopic. Reuses the shared {@link mountQuiz} runner and the
 * pure {@link buildSession}. @internal
 */
function runDrill(root: HTMLElement, row: WeakRow, back: () => void): void {
  const items = row.wrongQuestionIds.length > 0
    ? buildSession({ subtopicId: row.subtopicId, restrictToIds: row.wrongQuestionIds, order: 'ladder' }).items
    : buildSession({ subtopicId: row.subtopicId, order: 'ladder' }).items;

  if (items.length === 0) {
    // Nothing to drill (e.g. all graduated between render and tap) — just refresh.
    back();
    return;
  }
  mountQuiz(root, items, (score) => drillResults(root, row, score, back), { allowEndSession: true });
}

/** End-of-drill results for a weak-area drill. @internal */
function drillResults(root: HTMLElement, row: WeakRow, score: SessionScore, back: () => void): void {
  const line = score.total === 0 ? 'No questions answered.' : `${score.correct}/${score.total} correct.`;
  mount(
    root,
    el('div', { class: 'results' }, [
      card({ title: 'Drill complete' }, [
        el('p', { class: 'section-lead', text: `${row.name} — ${line} Weak areas will re-rank as your accuracy changes.` }),
        el('div', { class: 'focus-advance', attrs: { style: 'justify-content:center;flex-wrap:wrap' } }, [
          button({ label: 'Back to weak areas', variant: 'primary', onClick: () => back() }),
          button({ label: 'Learn this topic', variant: 'ghost', onClick: () => openLearn(row.subtopicId) }),
        ]),
      ]),
    ]),
  );
}

/** Not-started subtopics, shown as coverage gaps. @internal */
function buildGaps(gaps: WeakRow[]): HTMLElement {
  const rows = gaps.map((row) =>
    el('button', {
      class: 'weak-gap',
      type: 'button',
      ariaLabel: `Start ${row.name}`,
      onClick: () => openLearn(row.subtopicId),
    }, [
      row.band ? bandBadge(row.band) : null,
      el('span', { class: 'weak-gap-name', text: row.name }),
      el('span', { class: 'weak-gap-count tnum', text: `${row.total} Q` }),
      icon('chevron', 16),
    ]),
  );
  return card(
    { title: 'Not started yet', subtitle: `${gaps.length} subtopic${gaps.length === 1 ? '' : 's'} you haven\u2019t attempted — start these to close the gaps` },
    [el('div', { class: 'weak-gaps' }, rows)],
  );
}
