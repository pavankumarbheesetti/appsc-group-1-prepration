/**
 * Mock exam view — a TIMED, exam-pace practice paper with negative marking.
 *
 * Route: `#/mock`. Unlike the Drill/Quiz runner (which gives immediate
 * per-question feedback), a MOCK mirrors the real APPSC screening: an overall
 * COUNTDOWN (not per-question), no correctness feedback while the paper is
 * running, `-1/3` negative marking on wrong answers (blanks are never
 * penalised), AUTO-SUBMIT when the clock hits zero, and a NET score plus a full
 * review only AFTER submitting.
 *
 * Three phases live here:
 *   - SETUP    — choose a SCOPE (full available / by subject / by single
 *                subtopic) and a LENGTH (25 / 50 / all), which sets the timer at
 *                ~1 minute per question. A clear "timed · -1/3 · no compensatory
 *                time" banner is always shown.
 *   - RUNNING  — question navigation (Prev/Next + a jump/flag grid), selectable
 *                options with NO right/wrong feedback, a live countdown, and a
 *                Submit button. Answers are recorded to state on submit.
 *   - RESULTS  — the NET score prominently, attempted/correct/wrong/skipped,
 *                accuracy, time used, and a full per-question review (your answer
 *                vs the correct one + explanation + source). Retake / Back.
 *
 * The question set is assembled with the pure {@link buildSession} (scope opts +
 * a random shuffle + length cap); scoring uses the pure {@link mockScore} /
 * {@link netScore}. This module is DOM-only.
 */
import { getBanks, getSubtopics, getSubtopic } from '../content/loader';
import { SUBJECTS, type MCQItem, type SubjectCode } from '../content/types';
import { buildSession } from '../engine/drill';
import { recordAnswer } from '../engine/notebook';
import { newCard, review } from '../engine/spaced-repetition';
import { navigate, pushUrl, routeParam } from '../router/router';
import { updateState, loadState, recordTestAttempt } from '../state/store';
import { syncAutoStudied, isRevisable } from '../lib/study-status';
import { mockScore, formatNet, formatDuration, pct, type MockAnswer } from '../lib/metrics';
import {
  EXAM_PATTERNS,
  patternFor,
  type ExamPattern,
  type PaperId,
} from '../lib/exam-pattern';
import {
  buildPaperMock,
  mockSeriesLength,
  scorePaperMock,
  buildWeekTest,
  buildWeekTestSeries,
  scoreWeekTest,
  negativeMarkingSummary,
  avgTimeToBubbleMs,
  omrBookletNotBubbled,
  shouldWarnUnbubbled,
  MOCK_CONFIDENCES,
  MOCK_CONFIDENCE_LABEL,
  type MockConfidence,
  type NegativeMarkingSummary,
  type BuiltMock,
  type BuiltWeekTest,
  type WeekTestInput,
  type WeekTestOptions,
  type WeekTestResult,
} from '../engine/mock';
import { mockSectionPools, planSubtopics, currentPlan } from '../lib/plan';
import type { PlanBlock } from '../engine/planner';
import { el, mount, renderInline, type Child } from './dom';
import { confirmDialog } from './confirm';
import { openScopedReview } from './notebook';
import {
  clearTestSession,
  loadTestSession,
  resumeSummary,
  saveTestSession,
  type ResultsSpec,
  type TestSession,
} from '../lib/test-session';
import { reviewIdsOf, localISO, type ReviewableAttempt } from '../lib/review-scope';
import { weekTestNumber } from '../lib/test-number';
import { displayMatch, optionKeyFor, renderExplanation, renderQuestionStem } from './quiz';
import { card } from './components/card';
import { button } from './components/button';
import { chip } from './components/chip';
import { ring } from './components/ring';
import { icon } from './components/icon';
import { nextUpFooter, practiceSegments, PATHS } from './shell';
import { openLearn } from './learn';

/** The exam-pace banner text — shown on setup and (compactly) while running. */
const MOCK_BANNER = 'This is a timed mock — -1/3 negative marking · no compensatory time';

/** Length presets offered when the scope pool is large enough. */
const LENGTH_PRESETS = [25, 50] as const;

/** How the mock question pool is scoped. */
type ScopeKind = 'full' | 'subject' | 'subtopic';

/** Which setup mode is showing: a full official paper, or a custom scope. */
type MockMode = 'paper' | 'scope';

/** The setup selections, preserved across re-renders as the user refines them. */
interface MockSetup {
  scopeKind: ScopeKind;
  /** Selected subject when `scopeKind==='subject'` (else ''). */
  subject: SubjectCode | '';
  /** Selected subtopic id when `scopeKind==='subtopic'` (else ''). */
  subtopicId: string;
  /** Chosen question count (also the timer minutes). 0 until a pool is known. */
  length: number;
}

/** The Full-paper setup selections. @internal */
interface PaperSetup {
  /** Which official paper to sit. */
  paper: PaperId;
  /** 1-based mock number within the paper's non-repeating series. */
  mockNumber: number;
  /** Sit only ONE section of the paper (sectional mock), or `null` for full. */
  sectionId: string | null;
  /**
   * Practise with a separate OMR answer sheet: questions are shown WITHOUT
   * inline selection and the learner darkens bubbles on a 1–120 / A–D grid,
   * after a roll-number + booklet-series bubbling drill. Full-paper only.
   */
  omrMode: boolean;
}

/**
 * A deep-link scope request set by {@link openMock} (e.g. the Learn workspace's
 * "Mock this subtopic" button) and consumed once by {@link render}.
 */
interface PendingScope {
  scopeKind: ScopeKind;
  subject?: SubjectCode;
  subtopicId?: string;
}
let pendingScope: PendingScope | null = null;

/**
 * A deep-link full-paper request set by {@link openPaperMock} (e.g. the Planner
 * mock schedule) and consumed once by {@link render}.
 */
let pendingPaper: PaperId | null = null;

/**
 * Navigate to the Mock setup pre-scoped to a subtopic (or subject). Used by the
 * Learn workspace so a learner can sit a mock for just the subtopic they study.
 */
export function openMock(scope: PendingScope): void {
  pendingScope = scope;
  navigate(PATHS.mock);
}

/**
 * Navigate to the Mock setup pre-selected to a FULL official paper. Used by the
 * Planner's final-phase mock schedule so a learner can sit the exact paper the
 * plan calls for.
 */
export function openPaperMock(paper: PaperId): void {
  pendingPaper = paper;
  navigate(PATHS.mock);
}

/**
 * A one-shot WEEK-TEST request set by {@link openWeekTest} (the Today / Planner
 * first-pass Saturday launcher) and consumed once by {@link render}.
 */
let pendingWeekTest: WeekTestInput | null = null;

/**
 * Optional tunables + repeat-avoidance for the pending scoped test. A week test
 * uses the defaults (45 Q / 55 min, ~2/3 this-week); a UNIT TEST overrides the
 * count + time and excludes the questions already spent in week tests. Consumed
 * with {@link pendingWeekTest} by {@link render}. @internal
 */
let pendingWeekTestOpts: WeekTestOptions | null = null;
let pendingWeekTestExclude: ReadonlySet<string> | null = null;
/** Which kind of scoped test is pending (`week-test` / `unit-test`). @internal */
let pendingWeekTestKind: string | null = null;

/**
 * Launch the first-pass WEEK TEST for a `week-test` {@link PlanBlock}: a short
 * (45-Q / 55-min, −1/3) timed test drawn ONLY from the topics the plan has
 * first-passed on or before that Saturday — reusing the mock runner with a
 * scoped pool, a custom count and a custom time. Deterministic in the Saturday
 * date (see {@link buildWeekTest}).
 */
export function openWeekTest(block: PlanBlock): void {
  const input = weekTestInputFromBlock(block);
  if (input === null) {
    navigate(PATHS.mock);
    return;
  }
  pendingWeekTest = input;
  pendingWeekTestOpts = null;
  pendingWeekTestExclude = null;
  pendingWeekTestKind = 'week-test';
  navigate(PATHS.mock);
}

/**
 * Build a {@link WeekTestInput} for a `week-test` plan block. The pool is the
 * set of topics first-passed on or before the block's Saturday, split into
 * THIS-week vs earlier and into Paper-I / Paper-II (by each subtopic's exam
 * track). The first-pass dates are read from a CANONICAL plan anchored at the
 * plan START date — the live plan starts at *today*, so a Saturday viewed on
 * that same day would otherwise see almost no prior first-passes. Returns `null`
 * when the block carries no date. @internal
 */
function weekTestInputFromBlock(block: PlanBlock): WeekTestInput | null {
  const dateISO = block.weekTestDateISO;
  if (dateISO === undefined || dateISO === '') return null;
  const startISO = loadState().settings.planStartDate;
  const canonical = currentPlan(new Date(`${startISO}T00:00:00`));
  // First first-pass date per subtopic (days are in ascending date order).
  const firstPass = new Map<string, string>();
  for (const d of canonical.days) {
    for (const id of [...d.theorySubtopicIds, ...d.aptitudeSubtopicIds]) {
      if (!firstPass.has(id)) firstPass.set(id, d.dateISO);
    }
  }
  const weekStartISO = isoShift(dateISO, -6);
  const trackById = new Map(planSubtopics().map((s) => [s.id, s.track] as const));
  const paperOf = (id: string): PaperId => (trackById.get(id) === 'paper2' ? 'paper2' : 'paper1');
  const mcqsOf = (id: string): MCQItem[] => getSubtopic(id)?.mcqs ?? [];
  const pools: WeekTestInput = {
    dateISO,
    thisWeek: { paper1: [], paper2: [] },
    earlier: { paper1: [], paper2: [] },
  };
  const state = loadState();
  for (const [id, fp] of firstPass) {
    if (fp > dateISO) continue;
    // Only topics the learner has actually studied (status), never plan-only ones.
    if (!isRevisable(id, state)) continue;
    const tier = fp >= weekStartISO ? pools.thisWeek : pools.earlier;
    (tier[paperOf(id)] as MCQItem[]).push(...mcqsOf(id));
  }
  return pools;
}

/** Shift an ISO `YYYY-MM-DD` date by `days`. @internal */
function isoShift(dateISO: string, days: number): string {
  const d = new Date(`${dateISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Launch the UNIT TEST of a `unit-wrapup` {@link PlanBlock} (STANDARDS §8a): the
 * timed middle slice of a unit's wrap-up — a `block.unitTestCount`-question
 * test (1 Q/min, −1/3) drawn ONLY from that unit's own topics' MCQs, preferring
 * questions not already spent in the week tests. Reuses the week-test / scoped
 * mock runner (scoped pool + custom count + time + per-paper net results),
 * deterministic in `block.unitTestDateISO`.
 */
export function openUnitTest(block: PlanBlock): void {
  const ids = block.unitTestSubtopicIds ?? [];
  const dateISO = block.unitTestDateISO ?? '';
  const count = block.unitTestCount ?? 0;
  if (ids.length === 0 || dateISO === '' || count <= 0) {
    navigate(PATHS.mock);
    return;
  }
  const trackById = new Map(planSubtopics().map((s) => [s.id, s.track] as const));
  const paperOf = (id: string): PaperId => (trackById.get(id) === 'paper2' ? 'paper2' : 'paper1');
  const mcqsOf = (id: string): MCQItem[] => getSubtopic(id)?.mcqs ?? [];
  // The pool is ONLY this unit's topics (all in the "this week" bucket, so the
  // draw ratio is irrelevant); Paper-I / Paper-II split by each topic's track.
  const input: WeekTestInput = {
    dateISO,
    thisWeek: { paper1: [], paper2: [] },
    earlier: { paper1: [], paper2: [] },
  };
  for (const id of ids) (input.thisWeek[paperOf(id)] as MCQItem[]).push(...mcqsOf(id));
  pendingWeekTest = input;
  pendingWeekTestOpts = {
    count,
    durationMin: block.unitTestMinutes ?? count,
    thisWeekRatio: 1,
  };
  pendingWeekTestExclude = weekTestUsedIds(); // prefer questions not used in week tests
  pendingWeekTestKind = 'unit-test';
  navigate(PATHS.mock);
}

/**
 * Every question id already spent across the first-pass WEEK TESTS, from the
 * CANONICAL plan (anchored at the plan start date so the whole schedule is
 * present). A unit test prefers questions NOT in this set. @internal
 */
function weekTestUsedIds(): Set<string> {
  const startISO = loadState().settings.planStartDate;
  const canonical = currentPlan(new Date(`${startISO}T00:00:00`));
  const inputs: WeekTestInput[] = [];
  for (const d of canonical.days) {
    const wt = d.blocks.find((b) => b.kind === 'week-test');
    if (!wt) continue;
    const input = weekTestInputFromBlock(wt);
    if (input) inputs.push(input);
  }
  const used = new Set<string>();
  if (inputs.length === 0) return used;
  const series = buildWeekTestSeries(inputs);
  for (const test of series.values()) for (const it of test.items) used.add(it.id);
  return used;
}

/* -------------------------------------------------------------------------- */
/* Scope helpers                                                               */
/* -------------------------------------------------------------------------- */

/** Subject codes that actually have MCQ banks (so we don't offer empty picks). */
function mcqSubjects(): SubjectCode[] {
  const set = new Set<SubjectCode>();
  for (const { bank } of getBanks('mcq')) set.add(bank.subjectCode);
  return [...set];
}

/** Subtopics (id + label + count) that have at least one MCQ, in taxonomy order. */
function mcqSubtopics(): Array<{ id: string; name: string; count: number }> {
  const out: Array<{ id: string; name: string; count: number }> = [];
  for (const meta of getSubtopics()) {
    const sub = getSubtopic(meta.id);
    const count = sub?.mcqs.length ?? 0;
    if (count > 0) out.push({ id: meta.id, name: meta.name, count });
  }
  return out;
}

/** Translate a setup's scope into {@link buildSession} filter options. @internal */
function scopeOpts(setup: MockSetup): { subjectCode?: SubjectCode; subtopicId?: string } {
  if (setup.scopeKind === 'subject' && setup.subject !== '') return { subjectCode: setup.subject };
  if (setup.scopeKind === 'subtopic' && setup.subtopicId !== '') return { subtopicId: setup.subtopicId };
  return {};
}

/** The full ordered pool for the current scope (source of truth for counts). @internal */
function scopePool(setup: MockSetup): MCQItem[] {
  return buildSession({ ...scopeOpts(setup), order: 'ladder' }).items;
}

/**
 * Length presets valid for a pool: each standard preset that fits, plus "all"
 * (the whole pool). Deduped + ascending, so a 40-question scope offers 25 & 40.
 * @internal
 */
function lengthOptions(poolSize: number): number[] {
  const set = new Set<number>();
  for (const p of LENGTH_PRESETS) if (p <= poolSize) set.add(p);
  if (poolSize > 0) set.add(poolSize); // "all"
  return [...set].sort((a, b) => a - b);
}

/** The sensible default length for a pool: 50 → 25 → all, capped to the pool. @internal */
function defaultLength(poolSize: number): number {
  if (poolSize >= 50) return 50;
  if (poolSize >= 25) return 25;
  return poolSize;
}

/* -------------------------------------------------------------------------- */
/* SETUP                                                                       */
/* -------------------------------------------------------------------------- */

/** Render the Mock view (setup phase) into `root`. */
export function render(root: HTMLElement): void {
  // Consume any deep-link requests (one-shot).
  const focusScope = pendingScope;
  const focusPaper = pendingPaper;
  const focusWeekTest = pendingWeekTest;
  const focusWeekTestOpts = pendingWeekTestOpts;
  const focusWeekTestExclude = pendingWeekTestExclude;
  const focusWeekTestKind = pendingWeekTestKind;
  pendingScope = null;
  pendingPaper = null;
  pendingWeekTest = null;
  pendingWeekTestOpts = null;
  pendingWeekTestExclude = null;
  pendingWeekTestKind = null;
  const focusResume = pendingResume;
  pendingResume = false;

  if (focusResume && resumeSavedTest(root)) return;

  // A deep-linked WEEK TEST / UNIT TEST runs straight into the scoped, timed test.
  if (focusWeekTest) {
    // An unfinished test of the same kind is resumed, never silently replaced.
    const saved = loadTestSession();
    if (saved && saved.kind === (focusWeekTestKind ?? 'week-test') && resumeSavedTest(root)) return;
    beginWeekTest(
      root,
      focusWeekTest,
      focusWeekTestOpts ?? undefined,
      focusWeekTestExclude ?? undefined,
      focusWeekTestKind ?? 'week-test',
    );
    return;
  }

  // A deep-linked scope forces custom-scope mode; a deep-linked paper forces
  // full-paper mode; otherwise default to the full official paper (the primary
  // exam-condition experience), with custom scope one tap away.
  const mode: MockMode = focusScope ? 'scope' : focusPaper ? 'paper' : 'paper';

  const setup: MockSetup = {
    scopeKind: focusScope?.scopeKind ?? 'full',
    subject: focusScope?.subject ?? '',
    subtopicId: focusScope?.subtopicId ?? '',
    length: 0,
  };
  setup.length = defaultLength(scopePool(setup).length);

  const paperSetup: PaperSetup = {
    paper: focusPaper ?? 'paper1',
    mockNumber: 1,
    sectionId: null,
    omrMode: false,
  };

  drawShell(root, mode, setup, paperSetup);
}

/** The setup shell — a mode switcher (Full paper / Custom scope) + body. @internal */
function drawShell(
  root: HTMLElement,
  mode: MockMode,
  setup: MockSetup,
  paperSetup: PaperSetup,
): void {
  const modeBtn = (m: MockMode, label: string): HTMLButtonElement => {
    const active = mode === m;
    return el('button', {
      class: active ? 'mock-mode-btn is-active' : 'mock-mode-btn',
      type: 'button',
      attrs: { role: 'tab', 'aria-selected': String(active) },
      onClick: active ? undefined : () => drawShell(root, m, setup, paperSetup),
    }, [label]) as HTMLButtonElement;
  };
  const modeRow = el('div', {
    class: 'mock-mode',
    attrs: { role: 'tablist', 'aria-label': 'Mock type' },
  }, [modeBtn('paper', 'Full paper'), modeBtn('scope', 'Custom scope')]);

  const body =
    mode === 'paper'
      ? paperBody(root, setup, paperSetup)
      : scopeBody(root, setup, paperSetup);

  const resumeCard = resumeTestCard(
    () => {
      if (!resumeSavedTest(root)) drawShell(root, mode, setup, paperSetup);
    },
    () => drawShell(root, mode, setup, paperSetup),
  );
  mount(root, el('div', { class: 'mock-setup' }, [
    practiceSegments('mock'),
    resumeCard,
    card(
      { title: 'Timed mock', subtitle: 'Simulate the real screening — timed, with negative marking.' },
      [modeRow, ...body],
    ),
  ]));
}

/* -------------------------------------------------------------------------- */
/* SETUP · Full official paper                                                 */
/* -------------------------------------------------------------------------- */

/** Build the Full-paper setup body (Paper-I/II · mock number · sectional). @internal */
function paperBody(root: HTMLElement, setup: MockSetup, paperSetup: PaperSetup): Child[] {
  const redraw = (): void => drawShell(root, 'paper', setup, paperSetup);
  const pattern = patternFor(paperSetup.paper);
  const pools = mockSectionPools(pattern);
  const series = mockSeriesLength(pattern, pools);

  const banner = el('div', { class: 'mock-banner', attrs: { role: 'note' } }, [
    icon('timer', 18),
    el('span', { text: MOCK_BANNER }),
  ]);

  // Paper chooser (Paper-I / Paper-II).
  const paperBtn = (p: ExamPattern): HTMLButtonElement => {
    const active = paperSetup.paper === p.id;
    return el('button', {
      class: active ? 'mock-scope-btn is-active' : 'mock-scope-btn',
      type: 'button',
      attrs: { role: 'radio', 'aria-checked': String(active) },
      onClick: () => {
        paperSetup.paper = p.id;
        paperSetup.sectionId = null; // reset sectional choice on paper switch
        redraw();
      },
    }, [p.label]) as HTMLButtonElement;
  };
  const paperRow = el('div', {
    class: 'mock-scope',
    attrs: { role: 'radiogroup', 'aria-label': 'Which paper' },
  }, EXAM_PATTERNS.map(paperBtn));

  // Sectional chooser: full paper, or any one weighted section.
  const secBtn = (id: string | null, label: string): HTMLButtonElement => {
    const active = paperSetup.sectionId === id;
    return el('button', {
      class: active ? 'mock-len-btn is-active' : 'mock-len-btn',
      type: 'button',
      attrs: { role: 'radio', 'aria-checked': String(active), 'aria-label': label },
      onClick: () => {
        paperSetup.sectionId = id;
        redraw();
      },
    }, [el('span', { class: 'mock-len-n', text: label })]) as HTMLButtonElement;
  };
  const sectionRow = el('div', {
    class: 'mock-lengths',
    attrs: { role: 'radiogroup', 'aria-label': 'Full paper or a single section' },
  }, [
    secBtn(null, `Full paper (${pattern.totalQuestions} Q)`),
    ...pattern.sections.map((s) => secBtn(s.id, `${s.part} · ${s.label} (${s.count} Q)`)),
  ]);

  // Mock-number stepper (deterministic, non-repeating series).
  const numberLabel = el('span', { class: 'mock-len-n tnum', text: `Mock ${paperSetup.mockNumber}` });
  const step = (delta: number): void => {
    paperSetup.mockNumber = Math.max(1, paperSetup.mockNumber + delta);
    redraw();
  };
  const stepper = el('div', { class: 'mock-scope', attrs: { role: 'group', 'aria-label': 'Mock number in the series' } }, [
    (() => {
      const b = el('button', { class: 'mock-scope-btn', type: 'button', ariaLabel: 'Previous mock', onClick: () => step(-1) }, ['−']) as HTMLButtonElement;
      if (paperSetup.mockNumber <= 1) b.setAttribute('disabled', 'true');
      return b;
    })(),
    numberLabel,
    el('button', { class: 'mock-scope-btn', type: 'button', ariaLabel: 'Next mock', onClick: () => step(1) }, ['+']) as HTMLButtonElement,
  ]);

  // Section-weight summary line + non-repeating series note.
  const weights = pattern.sections.map((s) => `${s.part} ${s.count}`).join(' · ');
  const patternNote = el('p', { class: 'section-lead' }, [
    `${pattern.title} · ${pattern.totalQuestions} Q · ${pattern.durationMin} min · −1/3 · sections: ${weights}.`,
  ]);
  const seriesNote = el('p', { class: 'section-lead', attrs: { role: 'note' } }, [
    paperSetup.mockNumber <= series
      ? `Non-repeating series: about ${series} full ${pattern.label} mock${series === 1 ? '' : 's'} without reused questions.`
      : `Mock ${paperSetup.mockNumber} exceeds the ~${series}-mock non-repeating series, so some questions will repeat.`,
  ]);

  // Start.
  const sectional = paperSetup.sectionId
    ? pattern.sections.find((s) => s.id === paperSetup.sectionId)
    : null;
  const startCount = sectional ? sectional.count : pattern.totalQuestions;
  const startLabel = sectional
    ? `Start section · ${sectional.count} Q · ${sectional.count} min`
    : `Start ${pattern.label} · ${startCount} Q · ${pattern.durationMin} min`;
  const startBtn = el('button', {
    class: 'btn btn-primary btn-lg btn-block',
    type: 'button',
    ariaLabel: startLabel,
    onClick: () =>
      paperSetup.omrMode
        ? beginOmrMock(root, paperSetup, () => drawShell(root, 'paper', setup, paperSetup))
        : beginPaperMock(root, paperSetup, () => drawShell(root, 'paper', setup, paperSetup)),
  }, [startLabel]);
  startBtn.appendChild(icon('arrow-right', 18));

  // OMR practice toggle — a keyboard-accessible switch (full-paper realism).
  const omrToggle = el('button', {
    class: paperSetup.omrMode ? 'mock-omr-toggle is-on' : 'mock-omr-toggle',
    type: 'button',
    attrs: { role: 'switch', 'aria-checked': String(paperSetup.omrMode) },
    onClick: () => {
      paperSetup.omrMode = !paperSetup.omrMode;
      redraw();
    },
  }, [
    el('span', { class: 'mock-omr-track' }, [el('span', { class: 'mock-omr-thumb' })]),
    el('span', { text: 'Practise with an OMR sheet' }),
  ]);
  const omrNote = el('p', { class: 'section-lead', attrs: { role: 'note' } }, [
    paperSetup.omrMode
      ? 'OMR mode: a 2-minute roll-number + booklet-series drill first, then answer by darkening bubbles on a separate 1–120 (A–D) sheet. Transfer in batches of 10–15 and keep a 10-minute buffer.'
      : 'Turn this on to rehearse the real answer-sheet: bubble roll number + series, then transcribe answers to a separate OMR grid.',
  ]);
  const omrExtra: Child[] = [];
  if (paperSetup.omrMode) {
    const printBtn = button({
      label: 'Print OMR sheet',
      variant: 'secondary',
      iconName: 'arrow-right',
      onClick: () => printOmrSheet(),
    });
    omrExtra.push(printBtn, printableOmrSheet(startCount));
  }

  return [
    banner,
    el('p', { class: 'field-label', text: 'Paper' }),
    paperRow,
    el('p', { class: 'field-label', attrs: { style: 'margin-top:var(--space-4)' }, text: 'Scope' }),
    sectionRow,
    el('p', { class: 'field-label', attrs: { style: 'margin-top:var(--space-4)' }, text: 'Mock number' }),
    stepper,
    patternNote,
    seriesNote,
    el('div', { class: 'mock-omr-row', attrs: { style: 'margin-top:var(--space-4)' } }, [omrToggle]),
    omrNote,
    ...omrExtra,
    startBtn,
  ];
}

/* -------------------------------------------------------------------------- */
/* SETUP · Custom scope (subject / subtopic / full available)                  */
/* -------------------------------------------------------------------------- */

/** Build the custom-scope setup body; refining re-invokes the shell. @internal */
function scopeBody(root: HTMLElement, setup: MockSetup, paperSetup: PaperSetup): Child[] {
  const pool = scopePool(setup);
  const poolSize = pool.length;
  const lengths = lengthOptions(poolSize);
  // Keep the chosen length valid for the current pool.
  if (!lengths.includes(setup.length)) setup.length = defaultLength(poolSize);

  const redraw = (): void => drawShell(root, 'scope', setup, paperSetup);

  const banner = el('div', { class: 'mock-banner', attrs: { role: 'note' } }, [
    icon('timer', 18),
    el('span', { text: MOCK_BANNER }),
  ]);

  // ---- Scope chooser (radio-style buttons) ------------------------------- //
  const scopeBtn = (kind: ScopeKind, label: string): HTMLButtonElement => {
    const active = setup.scopeKind === kind;
    const b = el('button', {
      class: active ? 'mock-scope-btn is-active' : 'mock-scope-btn',
      type: 'button',
      attrs: { role: 'radio', 'aria-checked': String(active) },
      onClick: () => {
        setup.scopeKind = kind;
        redraw();
      },
    }, [label]) as HTMLButtonElement;
    return b;
  };
  const scopeRow = el('div', { class: 'mock-scope', attrs: { role: 'radiogroup', 'aria-label': 'Mock scope' } }, [
    scopeBtn('full', 'Full available'),
    scopeBtn('subject', 'By subject'),
    scopeBtn('subtopic', 'By subtopic'),
  ]);

  const scopeExtra: Child[] = [];
  if (setup.scopeKind === 'subject') {
    const subjects = mcqSubjects();
    const select = el('select', { ariaLabel: 'Subject', value: setup.subject }, [
      el('option', { value: '', text: 'Choose a subject…' }),
      ...subjects.map((code) => el('option', { value: code, text: SUBJECTS[code] })),
    ]) as HTMLSelectElement;
    select.value = setup.subject;
    select.addEventListener('change', () => {
      setup.subject = select.value as SubjectCode | '';
      redraw();
    });
    scopeExtra.push(field('Subject', select));
  } else if (setup.scopeKind === 'subtopic') {
    const subs = mcqSubtopics();
    const select = el('select', { ariaLabel: 'Subtopic', value: setup.subtopicId }, [
      el('option', { value: '', text: 'Choose a subtopic…' }),
      ...subs.map((s) => el('option', { value: s.id, text: `${s.name} (${s.count})` })),
    ]) as HTMLSelectElement;
    select.value = setup.subtopicId;
    select.addEventListener('change', () => {
      setup.subtopicId = select.value;
      redraw();
    });
    scopeExtra.push(field('Subtopic', select));
  }

  // ---- Length chooser ---------------------------------------------------- //
  const lengthRow = el('div', { class: 'mock-lengths', attrs: { role: 'radiogroup', 'aria-label': 'Number of questions' } },
    lengths.map((n) => {
      const isAll = n === poolSize && !LENGTH_PRESETS.includes(n as (typeof LENGTH_PRESETS)[number]);
      const active = setup.length === n;
      const label = isAll ? `All (${n})` : String(n);
      return el('button', {
        class: active ? 'mock-len-btn is-active' : 'mock-len-btn',
        type: 'button',
        attrs: { role: 'radio', 'aria-checked': String(active), 'aria-label': `${n} questions, ${n} minute timer` },
        onClick: () => {
          setup.length = n;
          redraw();
        },
      }, [
        el('span', { class: 'mock-len-n tnum', text: label }),
        el('span', { class: 'mock-len-min tnum', text: `${n} min` }),
      ]);
    }),
  );

  // ---- Start ------------------------------------------------------------- //
  const canStart = poolSize > 0 && setup.length > 0 &&
    !(setup.scopeKind === 'subject' && setup.subject === '') &&
    !(setup.scopeKind === 'subtopic' && setup.subtopicId === '');

  const startBtn = el('button', {
    class: 'btn btn-primary btn-lg btn-block',
    type: 'button',
    ariaLabel: `Start timed mock — ${setup.length} questions, ${setup.length} minutes`,
    onClick: canStart ? () => beginMock(root, setup, () => drawShell(root, 'scope', setup, paperSetup)) : undefined,
  }, [`Start mock · ${setup.length} Q · ${setup.length} min`]);
  if (!canStart) startBtn.setAttribute('disabled', 'true');
  startBtn.appendChild(icon('arrow-right', 18));

  const body: Child[] = [banner, el('p', { class: 'field-label', text: 'Scope' }), scopeRow, ...scopeExtra];
  if (poolSize === 0) {
    body.push(el('p', { class: 'section-lead', text: 'No questions available for this scope yet — pick another.' }));
  } else {
    body.push(
      el('p', { class: 'field-label', attrs: { style: 'margin-top:var(--space-4)' }, text: 'Length' }),
      lengthRow,
      el('p', { class: 'section-lead', attrs: { style: 'margin-top:var(--space-2)' }, text: `${poolSize} question${poolSize === 1 ? '' : 's'} in scope · timer runs at ~1 minute per question.` }),
    );
  }
  body.push(startBtn);
  return body;
}

/* -------------------------------------------------------------------------- */
/* RUNNING                                                                     */
/* -------------------------------------------------------------------------- */

/** Assemble the shuffled, length-capped paper and run it. @internal */
function beginMock(root: HTMLElement, setup: MockSetup, onBack: () => void): void {
  const seed = Date.now() >>> 0; // random-per-sitting shuffle
  const items = buildSession({ ...scopeOpts(setup), order: 'shuffle', seed, limit: setup.length }).items;
  if (items.length === 0) {
    onBack();
    return;
  }
  runMock(root, items, setup.length, () => beginMock(root, setup, onBack), onBack, drawResults, 'scoped-mock', {
    title: `Custom mock \u00b7 ${items.length} Q`,
    results: { type: 'generic' },
  });
}

/**
 * Assemble a FULL official paper (or one section of it) for the chosen paper +
 * mock number and run it, with section-aware results. Uses the deterministic
 * {@link buildPaperMock} so the drawn questions match the pattern's section
 * weights and do not repeat across the series. @internal
 */
function beginPaperMock(root: HTMLElement, setup: PaperSetup, onBack: () => void): void {
  const pattern = patternFor(setup.paper);
  const pools = mockSectionPools(pattern);
  const full = buildPaperMock(pattern, pools, setup.mockNumber);

  // A sectional mock keeps only the chosen section's slice of the built paper.
  const mock: BuiltMock = setup.sectionId
    ? sliceToSection(full, setup.sectionId)
    : full;

  if (mock.items.length === 0) {
    onBack();
    return;
  }
  // Timer honours the pattern's real per-question minute (1 min/question).
  const minutes = mock.items.length;
  runMock(
    root,
    mock.items,
    minutes,
    () => beginPaperMock(root, setup, onBack),
    onBack,
    (r, _items, selected, confidences, elapsed, onRetake, back) =>
      drawPaperResults(r, mock, selected, confidences, elapsed, onRetake, back),
    setup.sectionId ? 'sectional-mock' : 'full-mock',
    { title: paperTitle(mock), results: paperSpec(mock) },
  );
}

/** Reduce a built mock to a single section (a sectional mock). @internal */
function sliceToSection(mock: BuiltMock, sectionId: string): BuiltMock {
  const section = mock.sections.find((s) => s.section.id === sectionId);
  if (!section) return mock;
  return {
    pattern: mock.pattern,
    mockNumber: mock.mockNumber,
    sections: [section],
    items: section.items.slice(),
    sectionByIndex: section.items.map(() => sectionId),
  };
}

/** A paper mock's human title ("Paper-I · Mock 2"). @internal */
function paperTitle(mock: BuiltMock): string {
  const sectional = mock.sections.length === 1 && mock.pattern.sections.length > 1;
  return `${mock.pattern.title} \u00b7 ${sectional ? `${mock.sections[0]!.section.label} section` : `Mock ${mock.mockNumber}`}`;
}

/** The serialisable results spec of a paper mock. @internal */
function paperSpec(mock: BuiltMock): ResultsSpec {
  return {
    type: 'paper',
    paper: mock.pattern.id,
    mockNumber: mock.mockNumber,
    sections: mock.sections.map((s) => ({ id: s.section.id, wrapped: s.wrapped })),
    sectionByIndex: [...mock.sectionByIndex],
  };
}

/** The serialisable results spec of a week / unit test. @internal */
function weekSpec(test: BuiltWeekTest): ResultsSpec {
  return {
    type: 'week',
    dateISO: test.dateISO,
    count: test.count,
    requested: test.requested,
    durationMin: test.durationMin,
    sectionByIndex: [...test.sectionByIndex],
    short: test.short,
  };
}

/** id → MCQItem across every bank. @internal */
function mcqIndex(): Map<string, MCQItem> {
  const map = new Map<string, MCQItem>();
  for (const { bank } of getBanks('mcq')) {
    if (bank.kind !== 'mcq') continue;
    for (const item of bank.items) map.set(item.id, item);
  }
  return map;
}

/**
 * Re-open the autosaved in-flight test into `root` (answers, confidence, flags,
 * question and time left restored). Returns false when the saved test can no
 * longer be rebuilt (content changed) — the snapshot is then discarded.
 */
export function resumeSavedTest(root: HTMLElement): boolean {
  const saved = loadTestSession();
  if (!saved) return false;
  const index = mcqIndex();
  const items = saved.itemIds.map((id) => index.get(id));
  if (items.some((it) => it === undefined)) {
    clearTestSession();
    return false;
  }
  const list = items as MCQItem[];
  const back = (): void => render(root);
  const retake = (): void => render(root);
  const spec = saved.results;
  let onResults: Parameters<typeof runMock>[5] = drawResults;
  if (spec.type === 'week') {
    const test: BuiltWeekTest = {
      dateISO: spec.dateISO,
      count: spec.count,
      requested: spec.requested,
      durationMin: spec.durationMin,
      items: list,
      sectionByIndex: spec.sectionByIndex,
      short: spec.short,
    };
    onResults = (r, _i, sel, conf, elapsed, onRetake, onBack) =>
      drawWeekTestResults(r, test, sel, conf, elapsed, onRetake, onBack);
  } else if (spec.type === 'paper') {
    const pattern = patternFor(spec.paper);
    const sections = spec.sections.flatMap((s) => {
      const section = pattern.sections.find((x) => x.id === s.id);
      if (!section) return [];
      return [{ section, wrapped: s.wrapped, items: list.filter((_, i) => spec.sectionByIndex[i] === s.id) }];
    });
    if (sections.length === spec.sections.length) {
      const mock: BuiltMock = { pattern, mockNumber: spec.mockNumber, sections, items: list, sectionByIndex: spec.sectionByIndex };
      onResults = (r, _i, sel, conf, elapsed, onRetake, onBack) =>
        drawPaperResults(r, mock, sel, conf, elapsed, onRetake, onBack);
    }
  }
  runMock(root, list, Math.ceil(saved.durationMs / 60_000), retake, back, onResults, saved.kind, {
    title: saved.title,
    results: spec,
  }, saved);
  return true;
}

/** One-shot "resume the saved test" request from Today ({@link openResumeTest}). */
let pendingResume = false;

/** Navigate to the Mock page and resume the autosaved test. */
export function openResumeTest(): void {
  pendingResume = true;
  navigate(PATHS.mock);
}

/**
 * The "Resume test" card for Today / the Mock page, or `null` when no test is
 * in flight. `onResume` opens it; "Discard" forgets it after a confirm.
 */
export function resumeTestCard(onResume: () => void, onDiscarded: () => void): HTMLElement | null {
  const saved = loadTestSession();
  if (!saved) return null;
  return el('section', { class: 'card resume-test-card', attrs: { 'aria-label': 'Unfinished test' } }, [
    el('div', { class: 'resume-test' }, [
      el('span', { class: 'empty-icon' }, [icon('timer', 22)]),
      el('div', { class: 'resume-test-text' }, [
        el('strong', { text: `Unfinished: ${saved.title}` }),
        el('span', { class: 'section-lead', text: `${resumeSummary(saved)} \u2014 saved automatically. The clock is paused.` }),
      ]),
      el('div', { class: 'resume-test-actions' }, [
        button({ label: 'Resume test', variant: 'primary', iconName: 'arrow-right', onClick: onResume }),
        button({
          label: 'Discard',
          variant: 'ghost',
          onClick: () =>
            confirmDialog({
              title: 'Discard this unfinished test?',
              lines: ['Your answers will be lost and nothing is recorded.'],
              confirmLabel: 'Discard',
              cancelLabel: 'Keep it',
              onConfirm: () => {
                clearTestSession();
                onDiscarded();
              },
            }),
        }),
      ]),
    ]),
  ]);
}

/* -------------------------------------------------------------------------- */
/* WEEK TEST — scoped, studied-topics-only timed test                          */
/* -------------------------------------------------------------------------- */

/**
 * Assemble and run the first-pass WEEK TEST for `input` (one Saturday's scoped
 * pools): a 45-question / 55-minute timed test drawn only from first-passed
 * topics, scored with per-paper net marks. Reuses the shared {@link runMock}
 * runner with the week test's custom count + time. @internal
 */
function beginWeekTest(
  root: HTMLElement,
  input: WeekTestInput,
  opts?: WeekTestOptions,
  exclude?: ReadonlySet<string>,
  kind = 'week-test',
): void {
  const test = buildWeekTest(input, opts, exclude);
  if (test.items.length === 0) {
    // Nothing studied yet — fall back to the normal setup instead of a blank run.
    pendingWeekTest = null;
    render(root);
    return;
  }
  runMock(
    root,
    test.items,
    test.durationMin,
    () => beginWeekTest(root, input, opts, exclude, kind),
    () => navigate('/'),
    (r, _items, selected, confidences, elapsed, onRetake, back) =>
      drawWeekTestResults(r, test, selected, confidences, elapsed, onRetake, back),
    kind,
    {
      title: kind === 'unit-test'
        ? `Unit test \u00b7 ${test.count} Q`
        : `Week test ${weekTestNumber(test.dateISO, loadState().testAttempts as ReviewableAttempt[], loadState().settings.planStartDate)} \u00b7 ${test.count} Q`,
      results: weekSpec(test),
    },
  );
}

/** The learner-facing "Week test N" heading of a built week test. @internal */
function weekTestHeading(test: BuiltWeekTest): string {
  const st = loadState();
  // Results are drawn AFTER the attempt is recorded, so exclude this sitting's day.
  return `Week test ${weekTestNumber(test.dateISO, st.testAttempts as ReviewableAttempt[], st.settings.planStartDate)}`;
}

/**
 * Draw a WEEK TEST's results: the overall NET score plus a PER-PAPER table
 * (Paper-I / Paper-II net marks), mirroring the full-mock results surface. Uses
 * the pure {@link scoreWeekTest} so section and overall figures always agree.
 * @internal
 */
function drawWeekTestResults(
  root: HTMLElement,
  test: BuiltWeekTest,
  selected: ReadonlyArray<number | null>,
  confidences: ReadonlyArray<MockConfidence | null>,
  elapsedMs: number,
  onRetake: () => void,
  onBack: () => void,
): void {
  const result: WeekTestResult = scoreWeekTest(test, selected);
  const score = result.overall;
  const variant = score.accuracy >= 0.8 ? 'success' : score.accuracy >= 0.5 ? 'accent' : 'warning';

  const hero = el('div', { class: 'mock-result-hero' }, [
    el('div', { class: 'mock-net' }, [
      el('span', { class: 'mock-net-value tnum', text: formatNet(score.net) }),
      el('span', { class: 'mock-net-label', text: `net marks · out of ${score.total}` }),
    ]),
    ring({ value: score.accuracy, centerText: pct(score.accuracy), centerLabel: 'accuracy', size: 132, variant }),
  ]);

  const breakdown = el('div', { class: 'results-breakdown' }, [
    metric(String(score.attempted), 'attempted', null),
    metric(String(score.correct), 'correct', 'ok'),
    metric(String(score.wrong), 'wrong', 'bad'),
    metric(String(score.skipped), 'skipped', null),
    metric(formatDuration(elapsedMs), 'time used', null),
  ]);

  const rows = result.sections.map((s) =>
    el('tr', {}, [
      el('th', { attrs: { scope: 'row' }, text: s.label }),
      el('td', { class: 'tnum', text: `${s.score.correct}/${s.score.total}` }),
      el('td', { class: 'tnum', text: String(s.score.wrong) }),
      el('td', { class: 'tnum', text: String(s.score.skipped) }),
      el('td', { class: 'tnum', text: formatNet(s.net) }),
    ]),
  );
  const sectionTable = el('table', { class: 'mock-section-table' }, [
    el('caption', { class: 'field-label', text: 'Per-paper score' }),
    el('thead', {}, [
      el('tr', {}, [
        el('th', { attrs: { scope: 'col' }, text: 'Paper' }),
        el('th', { attrs: { scope: 'col' }, text: 'Correct' }),
        el('th', { attrs: { scope: 'col' }, text: 'Wrong' }),
        el('th', { attrs: { scope: 'col' }, text: 'Skipped' }),
        el('th', { attrs: { scope: 'col' }, text: 'Net' }),
      ]),
    ]),
    el('tbody', {}, rows),
  ]);

  const scoreNote = el('p', { class: 'section-lead', attrs: { style: 'text-align:center' } }, [
    `Net = correct − wrong ÷ 3 = ${score.correct} − ${score.wrong}÷3 = ${formatNet(score.net)}. Blanks are not penalised. This week test only covers topics you have studied so far.`,
  ]);

  const actions = el('div', { class: 'focus-advance results-actions', attrs: { style: 'justify-content:center;flex-wrap:wrap' } }, [
    button({ label: 'Retake', variant: 'secondary', iconName: 'timer', onClick: onRetake }),
    reviewAnswersButton(),
    button({ label: 'Back', variant: 'ghost', onClick: onBack }),
    button({ label: 'Today', variant: 'ghost', onClick: () => navigate('/') }),
  ]);

  const summaryCard = card({}, [
    el('h2', { class: 'card-title', attrs: { style: 'text-align:center' }, text: `${weekTestHeading(test)} · ${test.count} questions` }),
    hero,
    breakdown,
    sectionTable,
    scoreNote,
    actions,
  ]);

  const reviewCard = card({ title: 'Full review', subtitle: `${score.total} question${score.total === 1 ? '' : 's'} — your answer vs the correct one` }, [
    el('ol', { class: 'mock-review' }, test.items.map((item, i) => reviewItem(item, selected[i] ?? null, i + 1))),
  ]);

  mount(root, el('div', { class: 'results mock-results' }, [summaryCard, negMarkingCard(test.items, selected, confidences), reviewCard]));
}

/** Format a remaining-ms countdown as `M:SS` (minutes uncapped, e.g. `120:00`). @internal */
function formatCountdown(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${String(sec).padStart(2, '0')}`;
}

/** Amber/red thresholds (seconds remaining) for the countdown chip. */
const COUNTDOWN_AMBER_S = 300; // 5 min
const COUNTDOWN_RED_S = 60; // 1 min

/**
 * Run the timed mock over `items` into `root`. `minutes` sets the overall
 * countdown (1 min/question). `onRetake` re-assembles a fresh sitting of the
 * same scope; `onBack` returns to setup. `onResults` renders the results screen
 * on submit — defaults to the generic {@link drawResults}; full-paper mocks
 * pass a section-aware renderer. @internal
 */
function runMock(
  root: HTMLElement,
  items: readonly MCQItem[],
  minutes: number,
  onRetake: () => void,
  onBack: () => void,
  onResults: ResultsRenderer = drawResults,
  kind = 'mock',
  meta: RunMeta = { title: 'Mock', results: { type: 'generic' } },
  resume?: TestSession,
): void {
  // A RESUMED test goes straight back to the paper (the learner already saw
  // the instructions); every fresh sitting gets the instructions screen first,
  // and the clock only starts on its Start button.
  if (resume) {
    runMockTimed(root, items, minutes, onRetake, onBack, onResults, kind, meta, resume);
    return;
  }
  drawTestInstructions(root, {
    title: meta.title,
    questions: items.length,
    minutes,
    onStart: () => runMockTimed(root, items, minutes, onRetake, onBack, onResults, kind, meta),
    onBack,
  });
}

/** The results-screen renderer signature shared by every runner. @internal */
type ResultsRenderer = (
  root: HTMLElement,
  items: readonly MCQItem[],
  selected: ReadonlyArray<number | null>,
  confidences: ReadonlyArray<MockConfidence | null>,
  elapsedMs: number,
  onRetake: () => void,
  onBack: () => void,
) => void;

/** Inputs of {@link drawTestInstructions}. @internal */
interface InstructionsOpts {
  title: string;
  questions: number;
  minutes: number;
  onStart: () => void;
  onBack: () => void;
  /** OMR mode: answers go on a separate bubble sheet. */
  omr?: boolean;
}

/** Accessible label of the instructions screen's Start button. */
export const START_TIMER_LABEL = 'Start the test';

/**
 * The INSTRUCTIONS screen shown before every timed test (week / unit test,
 * custom mock, full paper, OMR): how many questions, how long, the −1/3 rule,
 * and how to use the Sure / 50-50 / Guess tags. The timer starts only when the
 * learner presses Start. @internal
 */
function drawTestInstructions(root: HTMLElement, o: InstructionsOpts): void {
  const neg = (1 / 3).toFixed(2);
  const list = el('ul', { class: 'test-instructions-list' }, [
    el('li', { text: `${o.questions} question${o.questions === 1 ? '' : 's'} \u00b7 ${o.minutes} minute${o.minutes === 1 ? '' : 's'} on one overall clock. When time runs out the test submits itself.` }),
    el('li', { text: `Marking: +1 for a correct answer, \u22121/3 (about \u2212${neg}) for a wrong one, 0 for a blank. Skip a question when you can\u2019t narrow it down.` }),
    o.omr
      ? el('li', { text: 'OMR mode: first bubble your roll number and booklet series, then darken each answer on the bubble sheet \u2014 a booklet mark alone is not scored.' })
      : el('li', { text: 'Tag each answer with how sure you are: Sure (you know it), 50-50 (down to two options) or Guess. The results show how your guesses scored, and every 50-50 / Guess answer goes into your review list \u2014 even the lucky correct ones.' }),
    el('li', { text: 'Flag a question to come back to it. Your answers are saved as you go \u2014 if you leave, you can resume with the clock paused.' }),
    el('li', { text: 'Answers are not shown until you submit.' }),
  ]);
  const startBtn = button({
    label: START_TIMER_LABEL,
    variant: 'primary',
    iconName: 'timer',
    ariaLabel: `${START_TIMER_LABEL} \u2014 ${o.questions} questions, ${o.minutes} minutes`,
    onClick: o.onStart,
  });
  mount(root, el('div', { class: 'mock-setup test-instructions' }, [
    card({ title: o.title, subtitle: 'Read this before you start \u2014 the clock starts when you press Start.' }, [
      el('div', { class: 'results-breakdown' }, [
        metric(String(o.questions), 'questions', null),
        metric(`${o.minutes} min`, 'time', null),
        metric('\u22121/3', 'per wrong answer', null),
      ]),
      list,
      el('div', { class: 'focus-advance results-actions', attrs: { style: 'justify-content:center;flex-wrap:wrap' } }, [
        startBtn,
        button({ label: 'Not now', variant: 'ghost', onClick: o.onBack }),
      ]),
    ]),
  ]));
  root.querySelector<HTMLElement>('h2')?.setAttribute('tabindex', '-1');
  root.querySelector<HTMLElement>('h2')?.focus();
}

/** The timed runner proper (called by {@link runMock} after the instructions). @internal */
function runMockTimed(
  root: HTMLElement,
  items: readonly MCQItem[],
  minutes: number,
  onRetake: () => void,
  onBack: () => void,
  onResults: ResultsRenderer,
  kind: string,
  meta: RunMeta,
  resume?: TestSession,
): void {
  const selected: Array<number | null> = resume ? [...resume.selected] : items.map(() => null);
  const confidences: Array<MockConfidence | null> = resume ? [...resume.confidences] : items.map(() => null);
  const flagged: boolean[] = resume ? [...resume.flagged] : items.map(() => false);
  let idx = resume ? Math.min(resume.idx, items.length - 1) : 0;

  const durationMs = resume ? resume.durationMs : minutes * 60_000;
  // A resumed test continues from the time left when it was saved (the clock
  // is paused while the learner is away).
  const deadline = Date.now() + (resume ? Math.max(0, resume.remainingMs) : durationMs);

  let countdownEl: HTMLElement | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let submitted = false;
  let closeConfirm: (() => void) | null = null;
  let lastSaved = 0;

  const remainingNow = (): number => Math.max(0, deadline - Date.now());

  /** Autosave the attempt (answers, confidence, flags, position, time left). */
  const persist = (): void => {
    if (submitted) return;
    lastSaved = Date.now();
    saveTestSession({
      v: 1,
      kind,
      title: meta.title,
      itemIds: items.map((it) => it.id),
      selected: [...selected],
      confidences: [...confidences],
      flagged: [...flagged],
      idx,
      remainingMs: remainingNow(),
      durationMs,
      savedAt: lastSaved,
      results: meta.results,
    });
  };

  const onPageHide = (): void => persist();

  const stopTimer = (): void => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('beforeunload', onPageHide);
  };

  const submit = (): void => {
    if (submitted) return;
    submitted = true;
    stopTimer();
    closeConfirm?.();
    clearTestSession();
    const elapsed = Math.min(durationMs, durationMs - remainingNow());
    recordMock(items, selected, confidences, kind);
    onResults(root, items, selected, confidences, elapsed, onRetake, onBack);
    afterResults(root, items, selected);
  };

  const tick = (): void => {
    // The learner navigated away from the mock route: AUTOSAVE the attempt
    // (with the time left) and pause — "Resume test" picks it up later. Never
    // auto-submits or fires on another view.
    if (!onMockSetupRoute()) {
      persist();
      stopTimer();
      closeConfirm?.();
      return;
    }
    if (Date.now() - lastSaved >= 1000) persist();
    const remaining = deadline - Date.now();
    const remainingS = Math.max(0, Math.ceil(remaining / 1000));
    if (countdownEl) {
      countdownEl.textContent = formatCountdown(remaining);
      countdownEl.classList.toggle('is-amber', remainingS <= COUNTDOWN_AMBER_S && remainingS > COUNTDOWN_RED_S);
      countdownEl.classList.toggle('is-red', remainingS <= COUNTDOWN_RED_S);
    }
    if (remaining <= 0) submit(); // time up → auto-submit (no confirm)
  };
  timer = setInterval(tick, 250);
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('beforeunload', onPageHide);

  const answeredCount = (): number =>
    selected.reduce<number>((n, s) => n + (s === null ? 0 : 1), 0);

  /** Submit only after the learner confirms (shows unanswered / flagged counts). */
  const confirmSubmit = (): void => {
    if (submitted) return;
    const blank = items.length - answeredCount();
    const flags = flagged.filter(Boolean).length;
    const lines: string[] = [
      blank > 0
        ? `${blank} of ${items.length} question${items.length === 1 ? '' : 's'} unanswered.`
        : `All ${items.length} questions answered.`,
    ];
    if (flags > 0) lines.push(`${flags} flagged for review.`);
    lines.push(`Time left: ${formatCountdown(remainingNow())}. You cannot change answers after submitting.`);
    closeConfirm = confirmDialog({
      title: 'Submit this test?',
      lines,
      warn: blank > 0 || flags > 0,
      confirmLabel: 'Submit test',
      cancelLabel: 'Keep working',
      onConfirm: () => {
        closeConfirm = null;
        submit();
      },
      onCancel: () => {
        closeConfirm = null;
      },
    });
  };

  const draw = (): void => {
    const item = items[idx];
    if (!item) return;

    // Countdown chip (kept in sync by the interval tick).
    const remaining = deadline - Date.now();
    countdownEl = el('span', { class: 'mock-countdown tnum', text: formatCountdown(remaining) });
    const timerChip = el('div', {
      class: 'mock-timer',
      attrs: { role: 'timer', 'aria-live': 'off', 'aria-label': 'Time remaining' },
    }, [icon('timer', 16), countdownEl]);

    const topline = el('div', { class: 'mock-topline' }, [
      timerChip,
      el('span', { class: 'focus-count tnum', text: `Question ${idx + 1} of ${items.length}` }),
      el('span', { class: 'mock-answered tnum', text: `${answeredCount()} answered` }),
    ]);

    // Flag toggle for the current question.
    const flagBtn = el('button', {
      class: flagged[idx] ? 'mock-flag is-flagged' : 'mock-flag',
      type: 'button',
      attrs: { 'aria-pressed': String(flagged[idx]) },
      onClick: () => {
        flagged[idx] = !flagged[idx];
        draw();
      },
    }, [icon('target', 15), el('span', { text: flagged[idx] ? 'Flagged' : 'Flag for review' })]);

    // Confidence segmented control — optional per-answer tag (default none).
    // Keyboard accessible (real buttons; clicking the active tag clears it).
    const confSeg = el('div', {
      class: 'mock-confidence',
      attrs: { role: 'group', 'aria-label': 'How confident are you? (optional)' },
    }, [
      el('span', { class: 'mock-confidence-label', text: 'Confidence:' }),
      ...MOCK_CONFIDENCES.map((c) => {
        const active = confidences[idx] === c;
        return el('button', {
          class: active ? 'mock-conf-btn is-active' : 'mock-conf-btn',
          type: 'button',
          // D26: toggle buttons, like the drill's — aria-pressed true/false.
          attrs: { 'aria-pressed': String(active) },
          onClick: () => {
            confidences[idx] = confidences[idx] === c ? null : c;
            draw();
          },
        }, [MOCK_CONFIDENCE_LABEL[c]]);
      }),
    ]);

    // Options — selectable, NO correctness feedback while running.
    const optionList = el('div', { class: 'option-list' }, displayMatch(item).options.map((opt, i) => {
      const isSel = selected[idx] === i;
      return el('button', {
        class: isSel ? 'option-card is-selected' : 'option-card',
        type: 'button',
        attrs: { 'aria-pressed': String(isSel) },
        onClick: () => {
          selected[idx] = selected[idx] === i ? null : i; // click again to clear
          draw();
        },
      }, [
        el('span', { class: 'option-key', text: optionKeyFor(item, i) }),
        el('span', { class: 'option-body' }, renderInline(opt)),
      ]);
    }));

    // Jump/flag grid.
    const grid = el('div', { class: 'mock-grid', attrs: { role: 'group', 'aria-label': 'Question navigator' } },
      items.map((_, i) => {
        const cls = ['mock-grid-cell'];
        if (i === idx) cls.push('is-current');
        if (selected[i] !== null) cls.push('is-answered');
        if (flagged[i]) cls.push('is-flagged');
        return el('button', {
          class: cls.join(' '),
          type: 'button',
          attrs: {
            'aria-label': `Question ${i + 1}${selected[i] !== null ? ', answered' : ''}${flagged[i] ? ', flagged' : ''}`,
            'aria-current': i === idx ? 'true' : 'false',
          },
          onClick: () => {
            idx = i;
            draw();
          },
        }, [el('span', { class: 'tnum', text: String(i + 1) })]);
      }),
    );

    // Prev / Next.
    const prevBtn = el('button', {
      class: 'btn btn-secondary',
      type: 'button',
      onClick: idx > 0 ? () => { idx -= 1; draw(); } : undefined,
    }, ['Prev']);
    if (idx === 0) prevBtn.setAttribute('disabled', 'true');
    const nextBtn = el('button', {
      class: 'btn btn-secondary',
      type: 'button',
      onClick: idx < items.length - 1 ? () => { idx += 1; draw(); } : undefined,
    }, ['Next']);
    if (idx === items.length - 1) nextBtn.setAttribute('disabled', 'true');

    const submitBtn = el('button', {
      class: 'btn btn-primary',
      type: 'button',
      ariaLabel: 'Submit test and see results',
      onClick: () => confirmSubmit(),
    }, ['Submit test']);

    // Keyboard: A–F / 1–6 select, ←/→ navigate, F flag, Enter next.
    const onKey = (e: KeyboardEvent): void => {
      const k = e.key.toLowerCase();
      if (k === 'arrowleft' && idx > 0) { e.preventDefault(); idx -= 1; draw(); return; }
      if ((k === 'arrowright' || k === 'enter') && idx < items.length - 1) { e.preventDefault(); idx += 1; draw(); return; }
      if (k === 'f') { e.preventDefault(); flagged[idx] = !flagged[idx]; draw(); return; }
      let choice = -1;
      if (k >= 'a' && k <= 'f') choice = k.charCodeAt(0) - 'a'.charCodeAt(0);
      else if (k >= '1' && k <= '6') choice = Number(k) - 1;
      if (choice >= 0 && choice < item.options.length) {
        e.preventDefault();
        selected[idx] = selected[idx] === choice ? null : choice;
        draw();
      }
    };

    const stage = el('section', { class: 'focus-stage mock-running', attrs: { tabindex: '-1', 'aria-live': 'polite' } });
    stage.addEventListener('keydown', onKey);
    stage.append(
      el('div', { class: 'mock-banner mock-banner-slim', attrs: { role: 'note' } }, [icon('timer', 14), el('span', { text: `${meta.title} \u2014 \u22121/3 for a wrong answer \u00b7 no compensatory time` })]),
      topline,
      el('div', { class: 'card question-card' }, [
        ...renderQuestionStem(item),
        optionList,
        el('div', { class: 'mock-flag-row' }, [confSeg, flagBtn]),
      ]),
      grid,
      el('div', { class: 'mock-nav' }, [prevBtn, nextBtn, submitBtn]),
    );
    mount(root, stage);
    stage.focus();
    persist();
  };

  draw();
  // A resumed test whose time already ran out submits straight away.
  if (resume && remainingNow() <= 0) submit();
}

/** What the runner needs to autosave + rebuild results on resume. @internal */
interface RunMeta {
  title: string;
  results: ResultsSpec;
}

/**
 * Persist a submitted mock: for every ATTEMPTED question, bump progress,
 * reschedule the SR card, update the wrong-answer notebook, and record the
 * learner's optional confidence tag. Skipped/blank questions are left untouched
 * (they were never "seen"). Also appends a {@link TestAttemptRecord} roll-up so
 * the Progress "Negative-marking habit" trend can grow. Mirrors the drill
 * recorder so a mock feeds the same subsystems. @internal
 */
function recordMock(
  items: readonly MCQItem[],
  selected: ReadonlyArray<number | null>,
  confidences: ReadonlyArray<MockConfidence | null> = [],
  kind = 'mock',
): void {
  const now = Date.now();
  updateState((s) => {
    items.forEach((item, i) => {
      const sel = selected[i];
      if (sel === null || sel === undefined) return; // blank → not recorded
      const correct = sel === item.answerIndex;
      const result: 'correct' | 'wrong' = correct ? 'correct' : 'wrong';
      const prev = s.progress[item.id] ?? { seen: 0, correct: 0, wrong: 0 };
      const conf = confidences[i] ?? undefined;
      s.progress[item.id] = {
        seen: prev.seen + 1,
        correct: prev.correct + (correct ? 1 : 0),
        wrong: prev.wrong + (correct ? 0 : 1),
        lastResult: result,
        ...(conf ? { lastConfidence: conf } : {}),
      };
      const cardSr = s.sr[item.id] ?? newCard(item.id, now);
      s.sr[item.id] = review(cardSr, result, now);
      const entry = recordAnswer(item.id, s.notebook[item.id], result, now);
      if (entry) s.notebook[item.id] = entry;
    });
  });

  // Auto-studied at 10 answered: stamp topics that just crossed the line.
  syncAutoStudied(items.flatMap((it) => (it.subtopicId ? [it.subtopicId] : [])));

  // Append the finished-test roll-up (guess accuracy + marks lost → trend).
  const summary = negativeMarkingSummary(
    items.map((item, i) => {
      const sel = selected[i];
      const attempted = sel !== null && sel !== undefined;
      return {
        attempted,
        correct: attempted && sel === item.answerIndex,
        confidence: confidences[i] ?? null,
      };
    }),
  );
  const record: ReviewableAttempt = {
    at: now,
    dateISO: localISO(now),
    // Wrong ∪ Guess/50-50 (correct guesses kept) → the scoped review block.
    reviewIds: reviewIdsOf(items, selected, confidences),
    // The full sitting, so a submitted test can be reopened as RESULTS later
    // (Today's finished test row, a reload of the results URL).
    itemIds: items.map((it) => it.id),
    answers: items.map((_, i) => selected[i] ?? null),
    confidences: items.map((_, i) => confidences[i] ?? null),
    kind,
    total: items.length,
    attempted: summary.attempted,
    correct: summary.correct,
    wrong: summary.wrong,
    skipped: summary.skipped,
    net: summary.net,
    guessAttempted: summary.byConfidence.guess.attempted,
    guessCorrect: summary.byConfidence.guess.correct,
    marksLostToWrong: summary.marksLostToWrong,
  };
  recordTestAttempt(record);
}

/* -------------------------------------------------------------------------- */
/* RESULTS                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * "Review answers" on every results screen: opens the just-submitted test's
 * wrong + guessed answers (the record's `reviewIds`) as a scoped review list.
 * @internal
 */
function reviewAnswersButton(): HTMLElement {
  return button({
    label: 'Review answers',
    variant: 'secondary',
    iconName: 'arrow-right',
    onClick: () => {
      const last = loadState().testAttempts.at(-1) as ReviewableAttempt | undefined;
      openScopedReview(
        last?.reviewIds ?? [],
        'Review answers',
        'Every wrong answer plus every Guess / 50-50 answer from this test \u2014 even the lucky correct ones.',
      );
    },
  });
}

/** Build the per-question mock answers for scoring. @internal */
function toAnswers(items: readonly MCQItem[], selected: ReadonlyArray<number | null>): MockAnswer[] {
  return items.map((item, i) => {
    const sel = selected[i];
    const attempted = sel !== null && sel !== undefined;
    return { attempted, correct: attempted && sel === item.answerIndex };
  });
}

/** Draw the results screen: net score, breakdown, and a full review. @internal */
function drawResults(
  root: HTMLElement,
  items: readonly MCQItem[],
  selected: ReadonlyArray<number | null>,
  confidences: ReadonlyArray<MockConfidence | null>,
  elapsedMs: number,
  onRetake: () => void,
  onBack: () => void,
): void {
  const answers = toAnswers(items, selected);
  const score = mockScore(answers);
  const variant = score.accuracy >= 0.8 ? 'success' : score.accuracy >= 0.5 ? 'accent' : 'warning';

  // Hero: NET score prominently, with the accuracy ring alongside.
  const hero = el('div', { class: 'mock-result-hero' }, [
    el('div', { class: 'mock-net' }, [
      el('span', { class: 'mock-net-value tnum', text: formatNet(score.net) }),
      el('span', { class: 'mock-net-label', text: `net score · out of ${score.total}` }),
    ]),
    ring({ value: score.accuracy, centerText: pct(score.accuracy), centerLabel: 'accuracy', size: 132, variant }),
  ]);

  const breakdown = el('div', { class: 'results-breakdown' }, [
    metric(String(score.attempted), 'attempted', null),
    metric(String(score.correct), 'correct', 'ok'),
    metric(String(score.wrong), 'wrong', 'bad'),
    metric(String(score.skipped), 'skipped', null),
    metric(formatDuration(elapsedMs), 'time used', null),
  ]);

  const scoreNote = el('p', { class: 'section-lead', attrs: { style: 'text-align:center' } }, [
    `Net = correct − wrong ÷ 3 = ${score.correct} − ${score.wrong}÷3 = ${formatNet(score.net)}. Blanks are not penalised.`,
  ]);

  const actions = el('div', { class: 'focus-advance results-actions', attrs: { style: 'justify-content:center;flex-wrap:wrap' } }, [
    button({ label: 'Retake', variant: 'secondary', iconName: 'timer', onClick: onRetake }),
    reviewAnswersButton(),
    button({ label: 'Back', variant: 'ghost', onClick: onBack }),
    button({ label: 'Today', variant: 'ghost', onClick: () => navigate('/') }),
  ]);

  const summaryCard = card({}, [
    el('h2', { class: 'card-title', attrs: { style: 'text-align:center' }, text: score.total > 0 && score.wrong === 0 && score.skipped === 0 ? 'Perfect paper!' : 'Mock submitted' }),
    hero,
    breakdown,
    scoreNote,
    actions,
  ]);

  const reviewCard = card({ title: 'Full review', subtitle: `${score.total} question${score.total === 1 ? '' : 's'} — your answer vs the correct one` }, [
    el('ol', { class: 'mock-review' }, items.map((item, i) => reviewItem(item, selected[i] ?? null, i + 1))),
  ]);

  mount(root, el('div', { class: 'results mock-results' }, [summaryCard, negMarkingCard(items, selected, confidences), reviewCard]));
}

/**
 * Draw the results for a FULL official paper (or a sectional mock): the overall
 * NET score, a PER-SECTION table (attempted / correct / wrong / net marks per
 * section), and the full per-question review grouped in section order. Uses the
 * pure {@link scorePaperMock} so section and overall figures always agree.
 * @internal
 */
function drawPaperResults(
  root: HTMLElement,
  mock: BuiltMock,
  selected: ReadonlyArray<number | null>,
  confidences: ReadonlyArray<MockConfidence | null>,
  elapsedMs: number,
  onRetake: () => void,
  onBack: () => void,
): void {
  const result = scorePaperMock(mock, selected);
  const score = result.overall;
  const variant = score.accuracy >= 0.8 ? 'success' : score.accuracy >= 0.5 ? 'accent' : 'warning';

  const hero = el('div', { class: 'mock-result-hero' }, [
    el('div', { class: 'mock-net' }, [
      el('span', { class: 'mock-net-value tnum', text: formatNet(score.net) }),
      el('span', { class: 'mock-net-label', text: `net marks · out of ${score.total}` }),
    ]),
    ring({ value: score.accuracy, centerText: pct(score.accuracy), centerLabel: 'accuracy', size: 132, variant }),
  ]);

  const breakdown = el('div', { class: 'results-breakdown' }, [
    metric(String(score.attempted), 'attempted', null),
    metric(String(score.correct), 'correct', 'ok'),
    metric(String(score.wrong), 'wrong', 'bad'),
    metric(String(score.skipped), 'skipped', null),
    metric(formatDuration(elapsedMs), 'time used', null),
  ]);

  // Per-section score table — the exam's real section split, with net marks.
  const rows = result.sections.map((s) =>
    el('tr', {}, [
      el('th', { attrs: { scope: 'row' }, text: `${s.section.part} · ${s.section.label}` }),
      el('td', { class: 'tnum', text: `${s.score.correct}/${s.score.total}` }),
      el('td', { class: 'tnum', text: String(s.score.wrong) }),
      el('td', { class: 'tnum', text: String(s.score.skipped) }),
      el('td', { class: 'tnum', text: `${formatNet(s.net)} / ${s.section.marks}` }),
    ]),
  );
  const sectionTable = el('table', { class: 'mock-section-table' }, [
    el('caption', { class: 'field-label', text: 'Per-section score' }),
    el('thead', {}, [
      el('tr', {}, [
        el('th', { attrs: { scope: 'col' }, text: 'Section' }),
        el('th', { attrs: { scope: 'col' }, text: 'Correct' }),
        el('th', { attrs: { scope: 'col' }, text: 'Wrong' }),
        el('th', { attrs: { scope: 'col' }, text: 'Skipped' }),
        el('th', { attrs: { scope: 'col' }, text: 'Net / Max' }),
      ]),
    ]),
    el('tbody', {}, rows),
  ]);

  const scoreNote = el('p', { class: 'section-lead', attrs: { style: 'text-align:center' } }, [
    `Net = correct − wrong ÷ 3 = ${score.correct} − ${score.wrong}÷3 = ${formatNet(score.net)}. Blanks are not penalised.`,
  ]);

  const actions = el('div', { class: 'focus-advance results-actions', attrs: { style: 'justify-content:center;flex-wrap:wrap' } }, [
    button({ label: 'Retake', variant: 'secondary', iconName: 'timer', onClick: onRetake }),
    reviewAnswersButton(),
    button({ label: 'Back', variant: 'ghost', onClick: onBack }),
    button({ label: 'Today', variant: 'ghost', onClick: () => navigate('/') }),
  ]);

  const title = `${mock.pattern.title} · Mock ${mock.mockNumber}`;
  const summaryCard = card({}, [
    el('h2', { class: 'card-title', attrs: { style: 'text-align:center' }, text: title }),
    hero,
    breakdown,
    sectionTable,
    scoreNote,
    actions,
  ]);

  const reviewCard = card({ title: 'Full review', subtitle: `${score.total} question${score.total === 1 ? '' : 's'} — your answer vs the correct one` }, [
    el('ol', { class: 'mock-review' }, mock.items.map((item, i) => reviewItem(item, selected[i] ?? null, i + 1))),
  ]);

  mount(root, el('div', { class: 'results mock-results' }, [summaryCard, negMarkingCard(mock.items, selected, confidences), reviewCard]));
}
function reviewItem(item: MCQItem, chosen: number | null, num: number): HTMLElement {
  const attempted = chosen !== null;
  const correct = attempted && chosen === item.answerIndex;
  const verdictChip = !attempted
    ? chip({ text: 'Skipped', tone: 'muted' })
    : correct
      ? chip({ text: 'Correct', tone: 'ok', iconName: 'check' })
      : chip({ text: 'Incorrect', tone: 'danger', iconName: 'x' });

  const opts = el('div', { class: 'option-list mock-review-options' }, displayMatch(item).options.map((opt, i) => {
    const cls = ['option-card', 'is-static'];
    if (i === item.answerIndex) cls.push('is-correct');
    else if (i === chosen) cls.push('is-wrong');
    return el('div', { class: cls.join(' ') }, [
      el('span', { class: 'option-key', text: optionKeyFor(item, i) }),
      el('span', { class: 'option-body' }, renderInline(opt)),
      i === item.answerIndex
        ? el('span', { class: 'option-mark', attrs: { 'aria-hidden': 'true' } }, [icon('check', 16)])
        : i === chosen
          ? el('span', { class: 'option-mark', attrs: { 'aria-hidden': 'true' } }, [icon('x', 16)])
          : null,
    ]);
  }));

  const kids: Child[] = [
    el('div', { class: 'mock-review-head' }, [
      el('span', { class: 'mock-review-num tnum', text: `Q${num}` }),
      verdictChip,
    ]),
    el('div', { class: 'mock-review-q' }, renderQuestionStem(item)),
    opts,
  ];

  const exp = renderExplanation(item);
  if (exp) kids.push(exp);

  return el('li', { class: 'mock-review-item' }, [el('article', { class: 'card' }, kids)]);
}

/* -------------------------------------------------------------------------- */
/* Small shared bits                                                           */
/* -------------------------------------------------------------------------- */

/** A single results metric column (mirrors the drill results styling). @internal */
function metric(value: string, label: string, tone: 'ok' | 'bad' | null): HTMLElement {
  const numClass = tone === 'ok' ? 'num ok' : tone === 'bad' ? 'num bad' : 'num';
  return el('div', { class: 'results-metric' }, [
    el('span', { class: `${numClass} tnum`, text: value }),
    el('span', { class: 'lbl', text: label }),
  ]);
}

/** A labelled form field wrapper (matches the Drill refine fields). @internal */
function field(label: string, control: HTMLElement): HTMLElement {
  return el('label', { class: 'field' }, [el('span', { class: 'field-label', text: label }), control]);
}


/* -------------------------------------------------------------------------- */
/* NEGATIVE-MARKING HABIT card (every test runner's results)                   */
/* -------------------------------------------------------------------------- */

/**
 * The "Negative-marking habit" results card: net with −1/3, attempts vs
 * accuracy, the "if you had skipped your Guess answers" net, accuracy by
 * confidence (Sure / 50-50 / Guess), and the one-line eliminate-2 rule reminder.
 * Shown on every test's results. @internal
 */
function negMarkingCard(
  items: readonly MCQItem[],
  selected: ReadonlyArray<number | null>,
  confidences: ReadonlyArray<MockConfidence | null>,
): HTMLElement {
  const sum: NegativeMarkingSummary = negativeMarkingSummary(
    items.map((item, i) => {
      const sel = selected[i];
      const attempted = sel !== null && sel !== undefined;
      return {
        attempted,
        correct: attempted && sel === item.answerIndex,
        confidence: confidences[i] ?? null,
      };
    }),
  );

  const guessN = sum.byConfidence.guess.attempted;
  const kids: Child[] = [
    el('p', { class: 'section-lead' }, [
      `You attempted ${sum.attempted} of ${items.length} · accuracy ${pct(sum.accuracy)} · net ${formatNet(sum.net)} · marks lost to wrong answers ${formatNet(sum.marksLostToWrong)}.`,
    ]),
    el('p', { class: 'section-lead neg-skip-guesses' }, [
      guessN > 0
        ? `If you had skipped your ${guessN} Guess answer${guessN === 1 ? '' : 's'}: net ${formatNet(sum.netSkippingGuesses)} (vs ${formatNet(sum.net)} now).`
        : `If you had skipped your Guess answers: net ${formatNet(sum.netSkippingGuesses)} — you tagged none as a pure guess.`,
    ]),
  ];

  if (sum.hasRatings) {
    const confRows = MOCK_CONFIDENCES.map((c) => {
      const b = sum.byConfidence[c];
      return el('tr', {}, [
        el('th', { attrs: { scope: 'row' }, text: MOCK_CONFIDENCE_LABEL[c] }),
        el('td', { class: 'tnum', text: String(b.attempted) }),
        el('td', { class: 'tnum', text: String(b.correct) }),
        el('td', { class: 'tnum', text: b.attempted > 0 ? pct(b.accuracy) : '—' }),
      ]);
    });
    kids.push(
      el('table', { class: 'mock-section-table mock-conf-table' }, [
        el('caption', { class: 'field-label', text: 'Accuracy by confidence' }),
        el('thead', {}, [
          el('tr', {}, [
            el('th', { attrs: { scope: 'col' }, text: 'Tag' }),
            el('th', { attrs: { scope: 'col' }, text: 'Attempted' }),
            el('th', { attrs: { scope: 'col' }, text: 'Correct' }),
            el('th', { attrs: { scope: 'col' }, text: 'Accuracy' }),
          ]),
        ]),
        el('tbody', {}, confRows),
      ]),
    );
  } else {
    kids.push(
      el('p', { class: 'section-lead', attrs: { role: 'note' } }, [
        'Tip: tag each answer Sure / 50-50 / Guess while you take the test to see your accuracy by confidence and how many marks your guesses cost.',
      ]),
    );
  }

  kids.push(
    el('p', { class: 'neg-rule', attrs: { role: 'note' } }, [
      el('strong', { text: 'Rule of thumb: ' }),
      el('span', { text: 'answer when you can eliminate 2 options; skip pure guesses.' }),
    ]),
  );

  return card({ title: 'Negative-marking habit' }, kids);
}

/* -------------------------------------------------------------------------- */
/* OMR MODE — bubble-sheet realism for full-paper mocks                        */
/* -------------------------------------------------------------------------- */

/** Letters A–D for the OMR bubble columns. @internal */
const OMR_LETTERS = ['A', 'B', 'C', 'D'] as const;

/**
 * Assemble a FULL official paper for OMR practice and run it through the
 * bubble-sheet flow (identity drill → bubble-grid answering → results). Uses the
 * same deterministic {@link buildPaperMock} as {@link beginPaperMock}. @internal
 */
function beginOmrMock(root: HTMLElement, setup: PaperSetup, onBack: () => void): void {
  const pattern = patternFor(setup.paper);
  const pools = mockSectionPools(pattern);
  const full = buildPaperMock(pattern, pools, setup.mockNumber);
  const mock: BuiltMock = setup.sectionId ? sliceToSection(full, setup.sectionId) : full;
  if (mock.items.length === 0) {
    onBack();
    return;
  }
  drawTestInstructions(root, {
    title: `${paperTitle(mock)} \u00b7 OMR`,
    questions: mock.items.length,
    minutes: mock.items.length,
    omr: true,
    onStart: () => runOmrMock(root, mock, () => beginOmrMock(root, setup, onBack), onBack),
    onBack,
  });
}

/**
 * Run an OMR-mode mock: a 2-minute roll-number + booklet-series bubbling drill,
 * then a running phase where questions carry NO inline selection — the learner
 * darkens bubbles on a separate 1–N (A–D) sheet and may make a tentative
 * "booklet" scratch mark per question. Live countdown + a 10-minute warning when
 * booklet-marked answers remain un-bubbled; time-to-bubble is measured.
 * @internal
 */
function runOmrMock(
  root: HTMLElement,
  mock: BuiltMock,
  onRetake: () => void,
  onBack: () => void,
): void {
  const items = mock.items;
  const bubbles: Array<number | null> = items.map(() => null); // the OMR sheet
  const scratch: Array<number | null> = items.map(() => null); // booklet marks
  const fillTimes: number[] = [];
  const roll: Array<number | null> = [null, null, null, null, null, null];
  let series: number | null = null;

  let idx = 0;
  const identityStart = Date.now();
  let identityMs = 0;
  /** The learner pressed Start with an incomplete identity (show the nudge). */
  let identityNudge = false;
  /** The learner explicitly skipped the identity step. */
  let identitySkipped = false;
  const identityComplete = (): boolean => roll.every((d) => d !== null) && series !== null;
  let closeConfirm: (() => void) | null = null;

  const minutes = items.length;
  const durationMs = minutes * 60_000;
  let startedAt = 0;
  let deadline = 0;
  let countdownEl: HTMLElement | null = null;
  let warnEl: HTMLElement | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let submitted = false;

  const stopTimer = (): void => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };

  const submit = (): void => {
    if (submitted) return;
    submitted = true;
    stopTimer();
    const elapsed = startedAt > 0 ? Math.min(durationMs, Date.now() - startedAt) : 0;
    closeConfirm?.();
    recordMock(items, bubbles, [], 'full-mock-omr');
    drawOmrResults(root, mock, bubbles, scratch, {
      elapsedMs: elapsed,
      identityMs,
      identityOk: identityComplete(),
      identitySkipped,
      avgBubbleMs: avgTimeToBubbleMs(fillTimes),
      onRetake,
      onBack,
    });
    afterResults(root, items, bubbles);
  };

  const tick = (): void => {
    if (!onMockSetupRoute()) {
      stopTimer();
      closeConfirm?.();
      return;
    }
    const remaining = deadline - Date.now();
    const remainingS = Math.max(0, Math.ceil(remaining / 1000));
    if (countdownEl) {
      countdownEl.textContent = formatCountdown(remaining);
      countdownEl.classList.toggle('is-amber', remainingS <= COUNTDOWN_AMBER_S && remainingS > COUNTDOWN_RED_S);
      countdownEl.classList.toggle('is-red', remainingS <= COUNTDOWN_RED_S);
    }
    if (warnEl) {
      warnEl.classList.toggle('is-shown', shouldWarnUnbubbled(remaining, scratch, bubbles));
    }
    if (remaining <= 0) submit();
  };

  /* ---- Identity drill -------------------------------------------------- */
  const drawIdentity = (): void => {
    const rollGrid = el('div', { class: 'omr-roll', attrs: { role: 'group', 'aria-label': 'Roll number' } },
      roll.map((val, col) =>
        el('div', { class: 'omr-roll-col' },
          Array.from({ length: 10 }, (_, d) =>
            el('button', {
              class: val === d ? 'omr-bubble is-filled' : 'omr-bubble',
              type: 'button',
              attrs: { 'aria-label': `Roll digit ${col + 1} = ${d}`, 'aria-pressed': String(val === d) },
              onClick: () => {
                roll[col] = roll[col] === d ? null : d;
                drawIdentity();
              },
            }, [String(d)]),
          ),
        ),
      ),
    );
    const seriesRow = el('div', { class: 'omr-series', attrs: { role: 'radiogroup', 'aria-label': 'Booklet series' } },
      OMR_LETTERS.map((L, i) =>
        el('button', {
          class: series === i ? 'omr-bubble is-filled' : 'omr-bubble',
          type: 'button',
          attrs: { role: 'radio', 'aria-checked': String(series === i), 'aria-label': `Booklet series ${L}` },
          onClick: () => {
            series = series === i ? null : i;
            drawIdentity();
          },
        }, [L]),
      ),
    );

    const begin = (skipped: boolean): void => {
      identitySkipped = skipped;
      identityMs = Date.now() - identityStart;
      startedAt = Date.now();
      deadline = startedAt + durationMs;
      timer = setInterval(tick, 250);
      draw();
    };
    const complete = identityComplete();
    const filledDigits = roll.filter((d) => d !== null).length;
    const startBtn = button({
      label: 'Start paper',
      variant: 'primary',
      iconName: 'arrow-right',
      onClick: () => {
        if (identityComplete()) {
          begin(false);
          return;
        }
        identityNudge = true;
        drawIdentity();
        root.querySelector<HTMLElement>('.omr-identity-alert')?.focus();
      },
    });
    const missing: string[] = [];
    if (filledDigits < roll.length) missing.push(`${roll.length - filledDigits} roll-number digit${roll.length - filledDigits === 1 ? '' : 's'}`);
    if (series === null) missing.push('the booklet series');
    const nudge = identityNudge && !complete
      ? el('div', { class: 'omr-identity-alert mock-banner', attrs: { role: 'alert', tabindex: '-1' } }, [
          icon('target', 16),
          el('span', { text: `Still to bubble: ${missing.join(' and ')}. Complete your identity — or skip it for this practice run.` }),
        ])
      : null;
    const skipBtn = identityNudge && !complete
      ? button({ label: 'Skip identity and start', variant: 'ghost', onClick: () => begin(true) })
      : null;

    mount(root, el('div', { class: 'mock-setup omr-identity' }, [
      card({ title: 'OMR drill · fill your identity first', subtitle: 'About 2 minutes — the #1 cause of a rejected sheet is a wrong roll number or booklet series.' }, [
        el('div', { class: 'mock-banner', attrs: { role: 'note' } }, [icon('timer', 16), el('span', { text: 'Darken fully with a black/blue ballpoint. One bubble per column. No overwriting.' })]),
        el('p', { class: 'field-label', text: 'Roll number' }),
        rollGrid,
        el('p', { class: 'field-label', attrs: { style: 'margin-top:var(--space-3)' }, text: 'Booklet series' }),
        seriesRow,
        el('p', { class: 'section-lead', attrs: { style: 'margin-top:var(--space-3)' }, text: 'Then transcribe answers to the OMR sheet in batches of 10–15 and keep a 10-minute transfer buffer.' }),
        nudge,
        el('div', { class: 'focus-advance', attrs: { style: 'flex-wrap:wrap' } }, [startBtn, skipBtn]),
      ]),
    ]));
  };

  /* ---- Running (booklet question + separate bubble sheet) -------------- */
  const draw = (): void => {
    const item = items[idx];
    if (!item) return;

    const remaining = deadline - Date.now();
    countdownEl = el('span', { class: 'mock-countdown tnum', text: formatCountdown(remaining) });
    const timerChip = el('div', { class: 'mock-timer', attrs: { role: 'timer', 'aria-live': 'off', 'aria-label': 'Time remaining' } }, [icon('timer', 16), countdownEl]);

    const bubbledCount = bubbles.reduce<number>((n, b) => n + (b === null ? 0 : 1), 0);
    const topline = el('div', { class: 'mock-topline' }, [
      timerChip,
      el('span', { class: 'focus-count tnum', text: `Question ${idx + 1} of ${items.length}` }),
      el('span', { class: 'mock-answered tnum', text: `${bubbledCount} bubbled` }),
    ]);

    warnEl = el('div', {
      class: shouldWarnUnbubbled(remaining, scratch, bubbles) ? 'omr-warning is-shown' : 'omr-warning',
      attrs: { role: 'alert' },
    }, [icon('timer', 15), el('span', { text: 'Under 10 minutes left — transfer your booklet answers to the OMR sheet now.' })]);

    // Read-only options (NO inline selection in OMR mode).
    const optionList = el('div', { class: 'option-list omr-booklet-options' }, item.options.map((opt, i) =>
      el('div', { class: 'option-card is-static' }, [
        el('span', { class: 'option-key', text: OMR_LETTERS[i] ?? String(i + 1) }),
        el('span', { class: 'option-body' }, renderInline(opt)),
      ]),
    ));

    // Booklet scratch mark (tentative) — segmented A–D.
    const scratchSeg = el('div', { class: 'omr-scratch', attrs: { role: 'radiogroup', 'aria-label': 'Booklet scratch mark' } }, [
      el('span', { class: 'mock-confidence-label', text: 'Booklet mark:' }),
      ...OMR_LETTERS.map((L, i) => {
        const active = scratch[idx] === i;
        return el('button', {
          class: active ? 'omr-scratch-btn is-active' : 'omr-scratch-btn',
          type: 'button',
          // D26: toggle buttons, like the drill's — aria-pressed true/false.
          attrs: { 'aria-pressed': String(active) },
          onClick: () => {
            scratch[idx] = scratch[idx] === i ? null : i;
            draw();
          },
        }, [L]);
      }),
    ]);

    // The separate OMR bubble sheet — one row per question (sticky on mobile).
    const sheetRows = items.map((_, qi) =>
      el('div', { class: qi === idx ? 'omr-row is-current' : 'omr-row' }, [
        el('span', { class: 'omr-row-num tnum', text: String(qi + 1) }),
        ...OMR_LETTERS.map((L, i) =>
          el('button', {
            class: bubbles[qi] === i ? 'omr-bubble is-filled' : 'omr-bubble',
            type: 'button',
            attrs: { 'aria-label': `Question ${qi + 1} option ${L}`, 'aria-pressed': String(bubbles[qi] === i) },
            onClick: () => {
              const was = bubbles[qi];
              bubbles[qi] = bubbles[qi] === i ? null : i;
              if (bubbles[qi] !== null && was !== bubbles[qi]) fillTimes.push(Date.now());
              draw();
            },
          }, [L]),
        ),
      ]),
    );
    const sheetPanel = el('aside', { class: 'omr-sheet-panel', attrs: { 'aria-label': 'OMR answer sheet' } }, [
      el('div', { class: 'omr-sheet-head' }, [
        el('span', { class: 'field-label', text: 'OMR answer sheet' }),
        el('span', { class: 'section-lead', text: 'Darken one bubble per question.' }),
      ]),
      el('div', { class: 'omr-sheet-grid' }, sheetRows),
    ]);

    const prevBtn = el('button', { class: 'btn btn-secondary', type: 'button', onClick: idx > 0 ? () => { idx -= 1; draw(); } : undefined }, ['Prev']);
    if (idx === 0) prevBtn.setAttribute('disabled', 'true');
    const nextBtn = el('button', { class: 'btn btn-secondary', type: 'button', onClick: idx < items.length - 1 ? () => { idx += 1; draw(); } : undefined }, ['Next']);
    if (idx === items.length - 1) nextBtn.setAttribute('disabled', 'true');
    const submitBtn = el('button', {
      class: 'btn btn-primary',
      type: 'button',
      ariaLabel: 'Submit OMR sheet and see results',
      onClick: () => {
        const blank = bubbles.filter((b) => b === null).length;
        const pending = omrBookletNotBubbled(scratch, bubbles);
        const lines = [
          blank > 0 ? `${blank} of ${items.length} bubbles left blank.` : `All ${items.length} questions bubbled.`,
        ];
        if (pending > 0) lines.push(`${pending} booklet mark${pending === 1 ? ' is' : 's are'} not yet on the OMR sheet.`);
        if (!identityComplete()) lines.push('Roll number / booklet series not bubbled.');
        lines.push('You cannot change the sheet after submitting.');
        closeConfirm = confirmDialog({
          title: 'Submit your OMR sheet?',
          lines,
          warn: blank > 0 || pending > 0 || !identityComplete(),
          confirmLabel: 'Submit sheet',
          cancelLabel: 'Keep working',
          onConfirm: () => {
            closeConfirm = null;
            submit();
          },
          onCancel: () => {
            closeConfirm = null;
          },
        });
      },
    }, ['Submit sheet']);

    const stage = el('section', { class: 'focus-stage mock-running omr-running', attrs: { tabindex: '-1' } });
    stage.append(
      el('div', { class: 'mock-banner mock-banner-slim', attrs: { role: 'note' } }, [icon('timer', 14), el('span', { text: 'OMR mode · transfer answers in batches of 10–15 · −1/3' })]),
      topline,
      warnEl,
      el('div', { class: 'omr-layout' }, [
        el('div', { class: 'omr-question-col' }, [
          el('div', { class: 'card question-card' }, [
            ...renderQuestionStem(item),
            optionList,
            el('div', { class: 'mock-flag-row' }, [scratchSeg]),
          ]),
          el('div', { class: 'mock-nav' }, [prevBtn, nextBtn, submitBtn]),
        ]),
        sheetPanel,
      ]),
    );
    mount(root, stage);
    stage.focus();
  };

  drawIdentity();
}

/** Options for {@link drawOmrResults}. @internal */
interface OmrResultOpts {
  elapsedMs: number;
  identityMs: number;
  /** All roll-number digits + the booklet series were bubbled. */
  identityOk: boolean;
  /** The learner explicitly skipped the identity step. */
  identitySkipped: boolean;
  avgBubbleMs: number;
  onRetake: () => void;
  onBack: () => void;
}

/**
 * Draw an OMR mock's results: the overall NET score, per-section table, the
 * transcription-gap flag ("marked in booklet but not bubbled"), the
 * time-to-bubble + identity-drill metrics, a printable-sheet button, and the
 * shared negative-marking card + full review. @internal
 */
function drawOmrResults(
  root: HTMLElement,
  mock: BuiltMock,
  bubbles: ReadonlyArray<number | null>,
  scratch: ReadonlyArray<number | null>,
  opts: OmrResultOpts,
): void {
  const result = scorePaperMock(mock, bubbles);
  const score = result.overall;
  const variant = score.accuracy >= 0.8 ? 'success' : score.accuracy >= 0.5 ? 'accent' : 'warning';
  const notBubbled = omrBookletNotBubbled(scratch, bubbles);

  const hero = el('div', { class: 'mock-result-hero' }, [
    el('div', { class: 'mock-net' }, [
      el('span', { class: 'mock-net-value tnum', text: formatNet(score.net) }),
      el('span', { class: 'mock-net-label', text: `net marks · out of ${score.total}` }),
    ]),
    ring({ value: score.accuracy, centerText: pct(score.accuracy), centerLabel: 'accuracy', size: 132, variant }),
  ]);

  const breakdown = el('div', { class: 'results-breakdown' }, [
    metric(String(score.attempted), 'bubbled', null),
    metric(String(score.correct), 'correct', 'ok'),
    metric(String(score.wrong), 'wrong', 'bad'),
    metric(String(score.skipped), 'blank', null),
    metric(formatDuration(opts.elapsedMs), 'time used', null),
  ]);

  const omrMetrics = el('div', { class: 'results-breakdown' }, [
    metric(notBubbled > 0 ? String(notBubbled) : '0', 'booklet, not bubbled', notBubbled > 0 ? 'bad' : null),
    metric(opts.avgBubbleMs > 0 ? formatDuration(opts.avgBubbleMs) : '—', 'avg time to bubble', null),
    metric(opts.identityOk ? formatDuration(opts.identityMs) : opts.identitySkipped ? 'Skipped' : 'Incomplete', 'identity drill', opts.identityOk ? null : 'bad'),
  ]);

  const bookletMarks = scratch.filter((m) => m !== null).length;
  const flagNote = el('p', { class: 'section-lead', attrs: { role: notBubbled > 0 ? 'alert' : 'note', style: 'text-align:center' } }, [
    notBubbled > 0
      ? `⚠ ${notBubbled} answer${notBubbled === 1 ? '' : 's'} marked in your booklet but NOT bubbled on the OMR sheet — in the real exam those score zero. Always transfer every booklet mark.`
      : bookletMarks > 0
        ? 'Every booklet mark made it onto the OMR sheet — clean transcription.'
        : 'No booklet marks were made, so there was nothing to transcribe.',
  ]);
  const identityFlag = opts.identityOk
    ? null
    : el('p', { class: 'omr-identity-flag', attrs: { role: 'alert' } }, [
        el('strong', { text: '⚠ Roll number/series not bubbled — in the real exam this can invalidate your sheet.' }),
        el('span', { text: opts.identitySkipped ? ' You skipped the identity step this time.' : ' Bubble every roll-number digit and the booklet series first.' }),
      ]);

  const rows = result.sections.map((s) =>
    el('tr', {}, [
      el('th', { attrs: { scope: 'row' }, text: `${s.section.part} · ${s.section.label}` }),
      el('td', { class: 'tnum', text: `${s.score.correct}/${s.score.total}` }),
      el('td', { class: 'tnum', text: String(s.score.wrong) }),
      el('td', { class: 'tnum', text: String(s.score.skipped) }),
      el('td', { class: 'tnum', text: `${formatNet(s.net)} / ${s.section.marks}` }),
    ]),
  );
  const sectionTable = el('table', { class: 'mock-section-table' }, [
    el('caption', { class: 'field-label', text: 'Per-section score' }),
    el('thead', {}, [
      el('tr', {}, [
        el('th', { attrs: { scope: 'col' }, text: 'Section' }),
        el('th', { attrs: { scope: 'col' }, text: 'Correct' }),
        el('th', { attrs: { scope: 'col' }, text: 'Wrong' }),
        el('th', { attrs: { scope: 'col' }, text: 'Blank' }),
        el('th', { attrs: { scope: 'col' }, text: 'Net / Max' }),
      ]),
    ]),
    el('tbody', {}, rows),
  ]);

  const actions = el('div', { class: 'focus-advance results-actions', attrs: { style: 'justify-content:center;flex-wrap:wrap' } }, [
    button({ label: 'Retake', variant: 'secondary', iconName: 'timer', onClick: opts.onRetake }),
    reviewAnswersButton(),
    button({ label: 'Print OMR sheet', variant: 'secondary', iconName: 'arrow-right', onClick: () => printOmrSheet() }),
    button({ label: 'Back', variant: 'ghost', onClick: opts.onBack }),
    button({ label: 'Today', variant: 'ghost', onClick: () => navigate('/') }),
  ]);

  const summaryCard = card({}, [
    el('h2', { class: 'card-title', attrs: { style: 'text-align:center' }, text: `${mock.pattern.title} · OMR Mock ${mock.mockNumber}` }),
    hero,
    breakdown,
    omrMetrics,
    identityFlag,
    flagNote,
    sectionTable,
    actions,
  ]);

  const reviewCard = card({ title: 'Full review', subtitle: `${score.total} question${score.total === 1 ? '' : 's'} — your bubble vs the correct one` }, [
    el('ol', { class: 'mock-review' }, mock.items.map((item, i) => reviewItem(item, bubbles[i] ?? null, i + 1))),
  ]);

  mount(root, el('div', { class: 'results mock-results' }, [
    summaryCard,
    negMarkingCard(mock.items, bubbles, []),
    printableOmrSheet(mock.items.length),
    reviewCard,
  ]));
}

/**
 * A printable A4 OMR answer sheet: an identity header (roll number + booklet
 * series) plus a 1..`count` grid of empty A–D bubbles. Hidden on screen; the
 * print stylesheet (`src/styles/print.css`) reveals ONLY this element on an A4
 * page. @internal
 */
function printableOmrSheet(count: number): HTMLElement {
  const rollHeader = el('div', { class: 'omr-print-id' }, [
    el('div', { class: 'omr-print-id-field' }, [
      el('span', { class: 'omr-print-id-label', text: 'Roll No.' }),
      el('div', { class: 'omr-print-id-boxes' }, Array.from({ length: 10 }, () => el('span', { class: 'omr-print-box' }))),
    ]),
    el('div', { class: 'omr-print-id-field' }, [
      el('span', { class: 'omr-print-id-label', text: 'Booklet series' }),
      el('div', { class: 'omr-print-series' }, OMR_LETTERS.map((L) => el('span', { class: 'omr-print-bubble', text: L }))),
    ]),
  ]);

  const rows = Array.from({ length: count }, (_, i) =>
    el('div', { class: 'omr-print-row' }, [
      el('span', { class: 'omr-print-num', text: String(i + 1) }),
      ...OMR_LETTERS.map((L) => el('span', { class: 'omr-print-bubble', text: L })),
    ]),
  );

  return el('section', { class: 'omr-print-sheet', attrs: { 'aria-label': 'Printable OMR answer sheet' } }, [
    el('h2', { class: 'omr-print-title', text: 'APPSC Group-1 — OMR Practice Answer Sheet' }),
    rollHeader,
    el('div', { class: 'omr-print-grid' }, rows),
    el('p', { class: 'omr-print-foot', text: 'Use a black/blue ballpoint. Darken one bubble fully per question. No overwriting or stray marks.' }),
  ]);
}

/** Trigger the browser print dialog for the printable OMR sheet. @internal */
function printOmrSheet(): void {
  if (typeof window !== 'undefined' && typeof window.print === 'function') {
    window.print();
  }
}

/* -------------------------------------------------------------------------- */
/* RESULTS URL + "Next up" footer (NAV spec §3.4 / §3.5)                       */
/* -------------------------------------------------------------------------- */

/** Whether the live hash is the mock SETUP/RUN route (old `#/mock` included). @internal */
function onMockSetupRoute(): boolean {
  const h = (location.hash || '').split('?')[0];
  return h === `#${PATHS.mock}` || h === '#/mock' || h === '#mock';
}

/** Rendered results per attempt id, so Back → Forward shows them again. @internal */
const resultsDom = new Map<string, Node[]>();

/** The subtopic with the most wrong answers in a sitting (ties: first seen). @internal */
function weakestSubtopic(items: readonly MCQItem[], selected: ReadonlyArray<number | null>): string | undefined {
  const wrong = new Map<string, number>();
  items.forEach((it, i) => {
    const sel = selected[i];
    if (sel === null || sel === undefined || sel === it.answerIndex || !it.subtopicId) return;
    wrong.set(it.subtopicId, (wrong.get(it.subtopicId) ?? 0) + 1);
  });
  let best: string | undefined;
  let n = 0;
  for (const [id, c] of wrong) if (c > n && getSubtopic(id)) [best, n] = [id, c];
  return best;
}

/** The mock results "Next up" footer. @internal */
function mockNextUp(net: number, total: number, wrong: number, weakest: string | undefined, reviewIds: readonly string[]): HTMLElement {
  const neg = wrong / 3;
  const review = {
    label: 'Review answers',
    onClick: () =>
      openScopedReview(reviewIds, 'Review answers', 'Every wrong answer plus every Guess / 50-50 answer from this test \u2014 even the lucky correct ones.'),
  };
  const name = weakest ? getSubtopic(weakest)?.meta.name : undefined;
  return nextUpFooter({
    eyebrow: `Score ${formatNet(net)}/${total} \u00b7 \u2212${neg.toFixed(1)} negative`,
    primary: weakest && name
      ? { label: `Fix weakest: ${name}`, onClick: () => openLearn(weakest, { tab: 'practice', from: 'practice' }) }
      : { label: 'Back to Today', onClick: () => navigate(PATHS.today) },
    secondary: weakest && name
      ? [review, { label: 'Today', onClick: () => navigate(PATHS.today) }]
      : [review, { label: 'New mock', onClick: () => navigate(PATHS.mock) }],
  });
}

/**
 * After a results screen is drawn: add the Next-up footer under the summary
 * and give the results their own URL (`#/practice/mock/results/<attempt>`), so
 * browser Back returns to the mock setup, not Today. @internal
 */
function afterResults(root: HTMLElement, items: readonly MCQItem[], selected: ReadonlyArray<number | null>): void {
  const last = loadState().testAttempts.at(-1) as ReviewableAttempt | undefined;
  const score = mockScore(toAnswers(items, selected));
  const footer = mockNextUp(score.net, score.total, score.wrong, weakestSubtopic(items, selected), last?.reviewIds ?? []);
  const container = root.querySelector('.mock-results');
  const first = container?.firstElementChild;
  if (first) first.after(footer);
  else root.append(footer);
  dedupeResultActions(root, footer);
  if (!last) return;
  const id = String(last.at);
  resultsDom.set(id, [...root.childNodes]);
  pushUrl(`${PATHS.mock}/results/${id}`);
  root.querySelector<HTMLElement>('h2')?.setAttribute('tabindex', '-1');
}

/**
 * N12: the Next-up footer already offers "Review answers" / "Today": drop the
 * same actions from the summary's action row so each appears ONCE. @internal
 */
function dedupeResultActions(root: ParentNode, footer: HTMLElement): void {
  const labels = new Set<string>();
  for (const b of footer.querySelectorAll('button, a')) {
    const t = (b.textContent ?? '').trim();
    labels.add(t);
    if (t === 'Back to Today') labels.add('Today');
  }
  for (const b of root.querySelectorAll<HTMLElement>('.results-actions button, .results-actions a')) {
    if (labels.has((b.textContent ?? '').trim())) b.remove();
  }
}

/**
 * Retake launchers registered by {@link openTestResults}, keyed by attempt id,
 * so a stored attempt's results page can offer "Retake" as a SEPARATE,
 * secondary action (never the row's default). @internal
 */
const retakeByAttempt = new Map<string, () => void>();

/**
 * Open the RESULTS of a submitted attempt (`at` = its record id). Today's
 * finished test rows call this so tapping a "Submitted ✓" row reviews the
 * test instead of starting a new one; `retake`, when given, is offered as a
 * secondary "Retake" button on that page.
 */
export function openTestResults(at: number, retake?: () => void): void {
  const id = String(at);
  if (retake) retakeByAttempt.set(id, retake);
  else retakeByAttempt.delete(id);
  navigate(`${PATHS.mock}/results/${id}`);
}

/** Human title of a stored attempt's kind. @internal */
function attemptTitle(kind: string): string {
  switch (kind) {
    case 'week-test': return 'Week test results';
    case 'unit-test': return 'Unit test results';
    case 'full-mock': return 'Full mock results';
    case 'sectional-mock': return 'Sectional mock results';
    case 'full-mock-omr': return 'OMR mock results';
    default: return 'Mock results';
  }
}

/**
 * `#/practice/mock/results/<attempt>`: the results drawn in this session, or —
 * after a reload / from Today's finished test row — the stored attempt redrawn
 * from its record: score, the Sure / 50-50 / Guess table and the FULL
 * question-by-question review (when the record carries the sitting).
 */
export function renderResultsRoute(root: HTMLElement): void {
  const id = routeParam('/practice/mock/results/:attemptId', 'attemptId') ?? '';
  const retake = retakeByAttempt.get(id);
  const nodes = resultsDom.get(id);
  if (nodes && !retake) {
    mount(root, ...nodes);
    return;
  }
  const attempt = (loadState().testAttempts as ReviewableAttempt[]).find((a) => String(a.at) === id);
  if (!attempt) {
    mount(root, card({ title: 'Results not found' }, [
      el('p', { class: 'section-lead', text: 'That attempt is not on this device.' }),
      button({ label: 'New mock', variant: 'primary', onClick: () => navigate(PATHS.mock) }),
    ]));
    return;
  }
  const index = mcqIndex();
  const items = (attempt.itemIds ?? []).map((q) => index.get(q));
  const full = items.length > 0 && items.every((it) => it !== undefined);
  const list = full ? (items as MCQItem[]) : [];
  const answers = list.map((_, i) => attempt.answers?.[i] ?? null);
  const confs = list.map((_, i) => (attempt.confidences?.[i] ?? null) as MockConfidence | null);
  const when = attempt.dateISO ? ` \u00b7 ${attempt.dateISO}` : '';
  const actions = el('div', { class: 'focus-advance results-actions', attrs: { style: 'justify-content:center;flex-wrap:wrap' } }, [
    retake ? button({ label: 'Retake', variant: 'secondary', iconName: 'timer', onClick: retake }) : null,
    button({ label: 'Today', variant: 'ghost', onClick: () => navigate(PATHS.today) }),
  ]);
  const footer = mockNextUp(attempt.net, attempt.total, attempt.wrong, full ? weakestSubtopic(list, answers) : undefined, attempt.reviewIds ?? []);
  const kids: Child[] = [
    card({ title: `${attemptTitle(attempt.kind)}${when}`, subtitle: 'Submitted \u2713 \u2014 your answers are saved; nothing here changes your score.' }, [
      el('div', { class: 'results-breakdown' }, [
        metric(formatNet(attempt.net), 'net score', null),
        metric(`${attempt.correct}/${attempt.total}`, 'correct', 'ok'),
        metric(String(attempt.wrong), 'wrong', 'bad'),
        metric(String(attempt.skipped), 'skipped', null),
      ]),
      actions,
    ]),
    footer,
  ];
  dedupeResultActions(actions.parentElement ?? actions, footer);
  if (full) {
    kids.push(negMarkingCard(list, answers, confs));
    kids.push(card({ title: 'Full review', subtitle: `${list.length} question${list.length === 1 ? '' : 's'} \u2014 your answer vs the correct one` }, [
      el('ol', { class: 'mock-review' }, list.map((item, i) => reviewItem(item, answers[i] ?? null, i + 1))),
    ]));
  }
  mount(root, el('div', { class: 'results mock-results' }, kids));
}
