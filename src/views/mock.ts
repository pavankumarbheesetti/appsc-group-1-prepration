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
import { navigate } from '../router/router';
import { updateState } from '../state/store';
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
  type BuiltMock,
} from '../engine/mock';
import { mockSectionPools } from '../lib/plan';
import { el, mount, type Child } from './dom';
import { renderExplanation, renderQuestionStem } from './quiz';
import { card } from './components/card';
import { button } from './components/button';
import { chip } from './components/chip';
import { ring } from './components/ring';
import { icon } from './components/icon';

/** The exam-pace banner text — shown on setup and (compactly) while running. */
const MOCK_BANNER = 'This is a timed mock — -1/3 negative marking · no compensatory time';

/** Length presets offered when the scope pool is large enough. */
const LENGTH_PRESETS = [25, 50] as const;

/** Letter badges for the first options; falls back to the index+1. */
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'] as const;

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
  navigate('/mock');
}

/**
 * Navigate to the Mock setup pre-selected to a FULL official paper. Used by the
 * Planner's final-phase mock schedule so a learner can sit the exact paper the
 * plan calls for.
 */
export function openPaperMock(paper: PaperId): void {
  pendingPaper = paper;
  navigate('/mock');
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
  pendingScope = null;
  pendingPaper = null;

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

  mount(root, el('div', { class: 'mock-setup' }, [
    card(
      { title: 'Mock exam', subtitle: 'Simulate the real screening — timed, with negative marking.' },
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
    onClick: () => beginPaperMock(root, paperSetup, () => drawShell(root, 'paper', setup, paperSetup)),
  }, [startLabel]);
  startBtn.appendChild(icon('arrow-right', 18));

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
  runMock(root, items, setup.length, () => beginMock(root, setup, onBack), onBack);
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
    (r, _items, selected, elapsed, onRetake, back) =>
      drawPaperResults(r, mock, selected, elapsed, onRetake, back),
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
  onResults: (
    root: HTMLElement,
    items: readonly MCQItem[],
    selected: ReadonlyArray<number | null>,
    elapsedMs: number,
    onRetake: () => void,
    onBack: () => void,
  ) => void = drawResults,
): void {
  const selected: Array<number | null> = items.map(() => null);
  const flagged: boolean[] = items.map(() => false);
  let idx = 0;

  const startedAt = Date.now();
  const durationMs = minutes * 60_000;
  const deadline = startedAt + durationMs;

  let countdownEl: HTMLElement | null = null;
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
    const elapsed = Math.min(durationMs, Date.now() - startedAt);
    recordMock(items, selected);
    onResults(root, items, selected, elapsed, onRetake, onBack);
  };

  const tick = (): void => {
    // If the learner navigated away from the mock route, abandon silently
    // (no auto-submit, no writes) so the timer can never fire on another view.
    const h = location.hash;
    if (h !== '#/mock' && h !== '#mock') {
      stopTimer();
      return;
    }
    const remaining = deadline - Date.now();
    const remainingS = Math.max(0, Math.ceil(remaining / 1000));
    if (countdownEl) {
      countdownEl.textContent = formatCountdown(remaining);
      countdownEl.classList.toggle('is-amber', remainingS <= COUNTDOWN_AMBER_S && remainingS > COUNTDOWN_RED_S);
      countdownEl.classList.toggle('is-red', remainingS <= COUNTDOWN_RED_S);
    }
    if (remaining <= 0) submit();
  };
  timer = setInterval(tick, 250);

  const answeredCount = (): number =>
    selected.reduce<number>((n, s) => n + (s === null ? 0 : 1), 0);

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

    // Options — selectable, NO correctness feedback while running.
    const optionList = el('div', { class: 'option-list' }, item.options.map((opt, i) => {
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
        el('span', { class: 'option-key', text: LETTERS[i] ?? String(i + 1) }),
        el('span', { class: 'option-body', text: opt }),
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
      ariaLabel: 'Submit mock and see results',
      onClick: () => submit(),
    }, ['Submit mock']);

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
      el('div', { class: 'mock-banner mock-banner-slim', attrs: { role: 'note' } }, [icon('timer', 14), el('span', { text: MOCK_BANNER })]),
      topline,
      el('div', { class: 'card question-card' }, [
        ...renderQuestionStem(item.question),
        optionList,
        el('div', { class: 'mock-flag-row' }, [flagBtn]),
      ]),
      grid,
      el('div', { class: 'mock-nav' }, [prevBtn, nextBtn, submitBtn]),
    );
    mount(root, stage);
    stage.focus();
  };

  draw();
}

/**
 * Persist a submitted mock: for every ATTEMPTED question, bump progress,
 * reschedule the SR card, and update the wrong-answer notebook. Skipped/blank
 * questions are left untouched (they were never "seen"). Mirrors the drill
 * recorder so a mock feeds the same subsystems. @internal
 */
function recordMock(items: readonly MCQItem[], selected: ReadonlyArray<number | null>): void {
  const now = Date.now();
  updateState((s) => {
    items.forEach((item, i) => {
      const sel = selected[i];
      if (sel === null || sel === undefined) return; // blank → not recorded
      const correct = sel === item.answerIndex;
      const result: 'correct' | 'wrong' = correct ? 'correct' : 'wrong';
      const prev = s.progress[item.id] ?? { seen: 0, correct: 0, wrong: 0 };
      s.progress[item.id] = {
        seen: prev.seen + 1,
        correct: prev.correct + (correct ? 1 : 0),
        wrong: prev.wrong + (correct ? 0 : 1),
        lastResult: result,
      };
      const cardSr = s.sr[item.id] ?? newCard(item.id, now);
      s.sr[item.id] = review(cardSr, result, now);
      const entry = recordAnswer(item.id, s.notebook[item.id], result, now);
      if (entry) s.notebook[item.id] = entry;
    });
  });
}

/* -------------------------------------------------------------------------- */
/* RESULTS                                                                     */
/* -------------------------------------------------------------------------- */

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
    button({ label: 'Retake', variant: 'primary', iconName: 'timer', onClick: onRetake }),
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

  mount(root, el('div', { class: 'results mock-results' }, [summaryCard, reviewCard]));
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
    button({ label: 'Retake', variant: 'primary', iconName: 'timer', onClick: onRetake }),
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

  mount(root, el('div', { class: 'results mock-results' }, [summaryCard, reviewCard]));
}
function reviewItem(item: MCQItem, chosen: number | null, num: number): HTMLElement {
  const attempted = chosen !== null;
  const correct = attempted && chosen === item.answerIndex;
  const verdictChip = !attempted
    ? chip({ text: 'Skipped', tone: 'muted' })
    : correct
      ? chip({ text: 'Correct', tone: 'ok', iconName: 'check' })
      : chip({ text: 'Incorrect', tone: 'danger', iconName: 'x' });

  const opts = el('div', { class: 'option-list mock-review-options' }, item.options.map((opt, i) => {
    const cls = ['option-card', 'is-static'];
    if (i === item.answerIndex) cls.push('is-correct');
    else if (i === chosen) cls.push('is-wrong');
    return el('div', { class: cls.join(' ') }, [
      el('span', { class: 'option-key', text: LETTERS[i] ?? String(i + 1) }),
      el('span', { class: 'option-body', text: opt }),
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
    el('div', { class: 'mock-review-q' }, renderQuestionStem(item.question)),
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
