/**
 * Drill view — pick a session with ONE TAP, then run it in focus mode.
 *
 * The setup screen is a set of PRESET CARDS (Due review / Quick 10 / Weak areas
 * / Full practice), each showing a LIVE COUNT computed from the current scope —
 * there is NO number input, because session size = scope (the old app's
 * pedagogy). The smart default (Due review when anything is due, else Quick 10)
 * is visually recommended and also launched by the primary "Begin" button so
 * keyboard/Enter works. An optional, collapsed "Refine" disclosure narrows the
 * pools by subject and tier (defaults: all subjects, all tiers = ladder order).
 *
 * Each preset builds a session with the pure {@link buildSession} (see the
 * per-preset `order`/`restrictToIds`/`limit` choices below), hands the ordered
 * questions to the shared {@link mountQuiz} focus runner — which now exposes an
 * "End session" control so the learner can stop anytime — and shows a RESULTS
 * screen (score ring + breakdown + "review wrong answers") when done. All
 * answer recording still flows through the quiz runner's store/engine calls.
 */
import { getBanks, getSubtopic, getSubtopics } from '../content/loader';
import { SUBJECTS, type MCQItem, type SubjectCode } from '../content/types';
import { buildSession, dueQuestionIds, weakQuestionIds } from '../engine/drill';
import { subtopicDrillOptions, type SubtopicDrillOption } from '../lib/drill-scope';
import type { SessionScore } from '../engine/drill';
import { navigate, routeParam } from '../router/router';
import { loadState } from '../state/store';
import { el, mount, type Child } from './dom';
import { mountQuiz, renderExplanation, renderQuestionStem } from './quiz';
import { card } from './components/card';
import { button } from './components/button';
import { ring } from './components/ring';
import { icon, type IconName } from './components/icon';
import { pct, avgTimeMs, formatDuration, confidenceBreakdown, examPointsPracticed, type SessionAnswerDetail } from '../lib/metrics';

/** Which preset is the current smart default. */
type Recommended = 'due' | 'quick';

/** Refine-disclosure state, preserved across re-renders when filters change. */
interface RefineState {
  /** Whether the "Refine" disclosure is expanded. */
  open: boolean;
  /** Selected subject code, or '' for all subjects. */
  subject: SubjectCode | '';
  /**
   * Selected taxonomy subtopic id, or '' for all subtopics. Only meaningful
   * when a subject is chosen; reset to '' whenever the subject changes.
   */
  subtopic: string;
}

/** Subject codes that actually have MCQ banks (so we don't offer empty picks). */
function mcqSubjects(): SubjectCode[] {
  const set = new Set<SubjectCode>();
  for (const { bank } of getBanks('mcq')) set.add(bank.subjectCode);
  return [...set];
}

/**
 * The drillable subtopic options for a subject: its taxonomy subtopics that
 * actually have MCQs, each labelled `Name (N)` with its MCQ count. Wires the
 * pure {@link subtopicDrillOptions} to the content loader (taxonomy order +
 * per-subtopic MCQ counts). @internal
 */
function subtopicOptionsFor(subjectCode: SubjectCode): SubtopicDrillOption[] {
  return subtopicDrillOptions(getSubtopics(subjectCode), (id) => getSubtopic(id)?.mcqs.length ?? 0);
}

/** Render the drill setup screen; a preset tap swaps in the focus runner. */
export function render(root: HTMLElement): void {
  drawSetup(root, { open: false, subject: '', subtopic: '' });
}

/**
 * Render a FOCUSED single-question drill for the MCQ named by the `#/q/:id`
 * route — used by the global search "jump to question" action so a learner can
 * solve one specific question. Falls back to a friendly not-found card.
 */
export function renderSingleQuestion(root: HTMLElement): void {
  const id = routeParam('/q/:id', 'id');
  const item = id === undefined ? undefined : findMCQById(id);
  if (!item) {
    mount(
      root,
      el('div', { class: 'drill-setup' }, [
        card({ title: 'Question not found' }, [
          el('p', { class: 'section-lead', text: 'That question is no longer available.' }),
          button({ label: 'Back to drill', variant: 'primary', onClick: () => render(root) }),
        ]),
      ]),
    );
    return;
  }
  // A one-question focus session; when done, offer to open its subtopic.
  mountQuiz(root, [item], (score) => {
    const actions: HTMLElement[] = [];
    if (item.subtopicId) {
      const sub = item.subtopicId;
      actions.push(button({ label: 'Open subtopic', variant: 'primary', iconName: 'arrow-right', onClick: () => navigate(`/learn/${sub}`) }));
    }
    actions.push(button({ label: 'New drill', variant: item.subtopicId ? 'secondary' : 'primary', onClick: () => render(root) }));
    actions.push(button({ label: 'Today', variant: 'ghost', onClick: () => navigate('/') }));
    mount(
      root,
      el('div', { class: 'results' }, [
        card({}, [
          el('h2', { class: 'card-title', text: score.correct === 1 ? 'Correct!' : 'Reviewed' }),
          el('p', { class: 'section-lead', text: 'One question, done. Keep the momentum going.' }),
          el('div', { class: 'focus-advance', attrs: { style: 'justify-content:center;flex-wrap:wrap' } }, actions),
        ]),
      ]),
    );
  });
}

/** Find an MCQ by id across every MCQ bank. @internal */
function findMCQById(id: string): MCQItem | undefined {
  for (const { bank } of getBanks('mcq')) {
    if (bank.kind !== 'mcq') continue;
    const found = bank.items.find((i) => i.id === id);
    if (found) return found;
  }
  return undefined;
}

/**
 * Draw the one-tap preset setup. `refine` carries the (optional) subject/tier
 * scope; changing a Refine control re-invokes this with the disclosure kept
 * open so the live counts update in place. @internal
 */
function drawSetup(root: HTMLElement, refine: RefineState): void {
  const now = Date.now();
  const state = loadState();
  const subjectCode = refine.subject === '' ? undefined : refine.subject;
  // Subtopic only applies within a chosen subject; ignore any stale value when
  // "All subjects" is selected so scope stays coherent.
  const subtopicId = subjectCode !== undefined && refine.subtopic !== '' ? refine.subtopic : undefined;

  // The scoped pool (refresher-first order, NO cap) is the source of truth for counts.
  const pool = buildSession({ subjectCode, subtopicId, order: 'ladder' }).items;
  const total = pool.length;
  const mcqIds = pool.map((i) => i.id);
  const dueIds = dueQuestionIds(state.sr, mcqIds, now);
  const weakIds = weakQuestionIds(state.progress, mcqIds);
  const quickSize = Math.min(10, total);
  const recommended: Recommended = dueIds.length > 0 ? 'due' : 'quick';

  // Per-preset session builders. Due/Weak restrict to the pre-computed ids;
  // Quick takes a short shuffled slice; Full is the whole scope, refresher-first.
  const startDue = (): void =>
    runSession(root, buildSession({ subjectCode, subtopicId, restrictToIds: dueIds, order: 'ladder' }).items);
  const startQuick = (): void =>
    runSession(root, buildSession({ subjectCode, subtopicId, limit: 10, order: 'shuffle' }).items);
  const startWeak = (): void =>
    runSession(root, buildSession({ subjectCode, subtopicId, restrictToIds: weakIds, order: 'ladder' }).items);
  const startFull = (): void =>
    runSession(root, buildSession({ subjectCode, subtopicId, order: 'ladder' }).items);

  const grid = el('div', { class: 'preset-grid' }, [
    presetCard({
      iconName: 'revise',
      title: 'Due review',
      countLabel: `${dueIds.length} due`,
      desc: 'Spaced-repetition cards ready for review.',
      recommended: recommended === 'due',
      disabled: dueIds.length === 0,
      hint: "Nothing due right now — you're all caught up.",
      onStart: startDue,
    }),
    presetCard({
      iconName: 'flame',
      title: 'Quick 10',
      countLabel: `${quickSize} question${quickSize === 1 ? '' : 's'}`,
      desc: 'A short mixed set to warm up.',
      recommended: recommended === 'quick',
      disabled: total === 0,
      hint: 'No questions in this scope yet.',
      onStart: startQuick,
    }),
    presetCard({
      iconName: 'target',
      title: 'Weak areas',
      countLabel: `${weakIds.length} weak`,
      desc: "Questions you've missed or not mastered.",
      disabled: weakIds.length === 0,
      hint: 'No weak spots yet — drill to find them.',
      onStart: startWeak,
    }),
    presetCard({
      iconName: 'drill',
      title: 'Full practice',
      countLabel: `${total} total`,
      desc: 'Every question in scope — stop anytime.',
      disabled: total === 0,
      hint: 'No questions in this scope yet.',
      onStart: startFull,
    }),
  ]);

  // Primary CTA: launches the recommended default so Enter/keyboard works.
  const beginBtn = el('button', {
    class: 'btn btn-primary btn-lg btn-block',
    type: 'button',
    ariaLabel: `Begin focus session — ${recommended === 'due' ? 'Due review' : 'Quick 10'}`,
    onClick: total === 0 ? undefined : recommended === 'due' ? startDue : startQuick,
  }, ['Begin focus session']);
  if (total === 0) beginBtn.setAttribute('disabled', 'true');
  beginBtn.appendChild(icon('arrow-right', 18));

  const body: Child[] = [grid];
  if (total === 0) {
    body.push(el('p', { class: 'section-lead', attrs: { style: 'margin-top:var(--space-4)' }, text: 'No questions match this scope. Widen the Refine filters below.' }));
  }
  body.push(beginBtn, refinePanel(root, refine));

  const setup = el('div', { class: 'drill-setup' }, [
    card(
      { title: 'New focus drill', subtitle: 'Pick a session — or just hit Begin. Keyboard A–D or 1–4 to answer.' },
      body,
    ),
  ]);

  mount(root, setup);
  // Focus the primary CTA so a keyboard user can start immediately with Enter.
  if (total > 0) beginBtn.focus();
}

/** Options for one preset card. @internal */
interface PresetConfig {
  iconName: IconName;
  title: string;
  /** Live count text, e.g. '12 due' / '10 questions'. */
  countLabel: string;
  /** One-line description shown when enabled. */
  desc: string;
  /** Visually highlight as the smart default. */
  recommended?: boolean;
  /** Disable (no pool) and show `hint` instead of `desc`. */
  disabled?: boolean;
  /** Friendly line shown in place of `desc` when disabled. */
  hint?: string;
  /** Start the session for this preset (one tap). */
  onStart: () => void;
}

/**
 * A single one-tap preset card. It is a real `<button>` (native focus + Enter/
 * Space activation); the recommended default gets a badge + highlight, and a
 * disabled card announces itself via `aria-disabled` and shows a hint. @internal
 */
function presetCard(cfg: PresetConfig): HTMLButtonElement {
  const line = cfg.disabled && cfg.hint ? cfg.hint : cfg.desc;
  const kids: Child[] = [
    el('span', { class: 'preset-icon' }, [icon(cfg.iconName, 22)]),
    el('span', { class: 'preset-title', text: cfg.title }),
    el('span', { class: 'preset-count tnum', text: cfg.countLabel }),
    el('span', { class: 'preset-desc', text: line }),
  ];
  if (cfg.recommended) {
    kids.splice(1, 0, el('span', { class: 'preset-badge', text: 'Recommended' }));
  }
  const cls = ['preset-card'];
  if (cfg.recommended) cls.push('is-recommended');
  const btn = el('button', {
    class: cls.join(' '),
    type: 'button',
    ariaLabel: `${cfg.title}, ${cfg.countLabel}. ${line}`,
    onClick: cfg.disabled ? undefined : cfg.onStart,
  }, kids);
  if (cfg.disabled) {
    btn.setAttribute('disabled', 'true');
    btn.setAttribute('aria-disabled', 'true');
  }
  return btn;
}

/**
 * The optional, collapsed "Refine" disclosure: Subject + Subtopic filters that
 * narrow the preset pools. Changing either re-renders the setup (counts update)
 * with the disclosure kept open. Defaults are All subjects / All subtopics, so
 * refining is never required. (The old Tier filter is gone — the app is now
 * single exam-level, so there is no difficulty selector.) @internal
 */
function refinePanel(root: HTMLElement, refine: RefineState): HTMLElement {
  const subjectSelect = el('select', { ariaLabel: 'Subject filter', value: refine.subject }, [
    el('option', { value: '', text: 'All subjects' }),
    ...mcqSubjects().map((code) => el('option', { value: code, text: `${SUBJECTS[code]} (${code})` })),
  ]) as HTMLSelectElement;
  subjectSelect.value = refine.subject;
  subjectSelect.addEventListener('change', () => {
    // Changing subject always resets the subtopic to "All" (its options depend
    // on the subject, and a stale subtopic would no longer be in scope).
    drawSetup(root, { open: true, subject: subjectSelect.value as SubjectCode | '', subtopic: '' });
  });

  // Subtopic: only meaningful within a chosen subject. When "All subjects" is
  // selected it is disabled and shows just "All subtopics"; when a subject is
  // chosen it lists that subject's MCQ-bearing subtopics with their counts.
  const hasSubject = refine.subject !== '';
  const subtopicOpts = hasSubject ? subtopicOptionsFor(refine.subject as SubjectCode) : [];
  const subtopicSelect = el('select', { ariaLabel: 'Subtopic filter', value: refine.subtopic }, [
    el('option', { value: '', text: 'All subtopics' }),
    ...subtopicOpts.map((o) => el('option', { value: o.id, text: o.label })),
  ]) as HTMLSelectElement;
  subtopicSelect.value = refine.subtopic;
  if (!hasSubject || subtopicOpts.length === 0) {
    subtopicSelect.setAttribute('disabled', 'true');
    subtopicSelect.setAttribute('aria-disabled', 'true');
  }
  subtopicSelect.addEventListener('change', () => {
    drawSetup(root, { open: true, subject: refine.subject, subtopic: subtopicSelect.value });
  });

  const details = el('details', { class: 'refine' }, [
    el('summary', { class: 'refine-summary' }, [el('span', { text: 'Refine' }), icon('chevron', 16)]),
    el('div', { class: 'refine-body' }, [field('Subject', subjectSelect), field('Subtopic', subtopicSelect)]),
  ]) as HTMLDetailsElement;
  if (refine.open) details.setAttribute('open', 'true');
  // Remember expanded/collapsed so a subsequent re-render preserves it.
  details.addEventListener('toggle', () => {
    refine.open = details.open;
  });
  return details;
}

/** Run the quiz over the built items and show results when done. @internal */
function runSession(root: HTMLElement, items: readonly MCQItem[]): void {
  if (items.length === 0) {
    mount(
      root,
      el('div', { class: 'drill-setup' }, [
        card({ title: 'No questions match' }, [
          el('p', { class: 'section-lead', text: 'Try a different preset, or widen the Refine filters.' }),
          button({ label: 'Back to setup', variant: 'primary', onClick: () => render(root) }),
        ]),
      ]),
    );
    return;
  }
  // allowEndSession lets the learner stop anytime — no length is pre-committed.
  mountQuiz(root, items, (score, wrongItems, details) => drawResults(root, score, wrongItems, details), { allowEndSession: true });
}

/** End-of-session results screen: score ring + rich, real-valued breakdown. */
function drawResults(root: HTMLElement, score: SessionScore, wrongItems: MCQItem[], details: SessionAnswerDetail[]): void {
  const variant = score.accuracy >= 0.8 ? 'success' : score.accuracy >= 0.5 ? 'accent' : 'warning';

  // Primary next-step actions.
  const actions: HTMLElement[] = [];
  if (wrongItems.length > 0) {
    actions.push(
      button({
        label: `Revise ${wrongItems.length} wrong`,
        variant: 'primary',
        iconName: 'revise',
        onClick: () => runSession(root, wrongItems),
      }),
    );
  }
  actions.push(button({ label: 'New drill', variant: wrongItems.length > 0 ? 'secondary' : 'primary', iconName: 'drill', onClick: () => render(root) }));
  actions.push(button({ label: 'Syllabus', variant: 'ghost', onClick: () => navigate('/syllabus') }));
  actions.push(button({ label: 'Today', variant: 'ghost', onClick: () => navigate('/') }));

  const cardKids: (HTMLElement | null)[] = [
    el('h2', { class: 'card-title', text: score.correct === score.total && score.total > 0 ? 'Flawless session!' : 'Session complete' }),
    ring({
      value: score.accuracy,
      centerText: pct(score.accuracy),
      centerLabel: 'accuracy',
      size: 150,
      variant,
    }),
    el('div', { class: 'results-breakdown' }, [
      metric(String(score.correct), 'correct', 'ok'),
      metric(String(score.wrong), 'to revisit', 'bad'),
      metric(String(score.total), 'answered', null),
      metric(formatDuration(avgTimeMs(details)), 'avg / question', null),
    ]),
  ];

  // Optional "exam points practiced" line — distinct exam-points this session
  // touched (via each answered item's covers[]). Shown only when present, so
  // un-migrated banks (no covers) simply omit it.
  const points = examPointsPracticed(details);
  if (points > 0) {
    cardKids.push(
      el('p', { class: 'results-points' }, [
        icon('target', 15),
        el('span', { text: `${points} exam point${points === 1 ? '' : 's'} practiced` }),
      ]),
    );
  }

  // Optional confidence-vs-correctness calibration line.
  const conf = confidenceBreakdown(details);
  if (conf.hasRatings) {
    cardKids.push(el('p', { class: 'results-confidence' }, [confidenceLine(conf)]));
  }

  cardKids.push(el('div', { class: 'focus-advance results-actions' }, actions));

  const blocks: HTMLElement[] = [card({}, cardKids)];

  // "Review wrong answers" — each missed question is revisitable via #/q/<id>.
  if (wrongItems.length > 0) {
    blocks.push(reviewWrongCard(wrongItems));
  }

  mount(root, el('div', { class: 'results' }, blocks));
}

/** Build the tiny "confidence vs correctness" calibration sentence. @internal */
function confidenceLine(conf: ReturnType<typeof confidenceBreakdown>): HTMLElement {
  const parts: string[] = [];
  if (conf.sure.total > 0) {
    parts.push(`right on ${conf.sure.correct}/${conf.sure.total} of your “Sure” answers`);
  }
  if (conf.guess.total > 0) {
    parts.push(`${conf.guess.correct}/${conf.guess.total} of your “Guess” answers`);
  }
  return el('span', { text: `Confidence: ${parts.join(' · ')}.` });
}

/**
 * A card listing each missed question WITH its full rich solution — the
 * markdown rationale + "Key facts" callout (shared {@link renderExplanation}) —
 * plus a "Re-solve" link that opens the focused single-question view
 * (#/q/<id>). Values are the real wrong items from this session. @internal
 */
function reviewWrongCard(wrongItems: readonly MCQItem[]): HTMLElement {
  const rows = wrongItems.map((item) => {
    const kids: Child[] = [
      el('div', { class: 'wrong-row-head' }, [
        el('div', { class: 'wrong-row-q' }, renderQuestionStem(item.question)),
      ]),
    ];
    const exp = renderExplanation(item);
    if (exp) kids.push(exp);
    kids.push(
      el('div', { class: 'wrong-row-actions' }, [
        el('button', {
          class: 'btn btn-ghost',
          type: 'button',
          ariaLabel: `Re-solve: ${item.question}`,
          onClick: () => navigate(`/q/${item.id}`),
        }, [el('span', { text: 'Re-solve' }), icon('arrow-right', 16)]),
      ]),
    );
    return el('article', { class: 'wrong-item card' }, kids);
  });
  return card({ title: 'Review wrong answers', subtitle: `${wrongItems.length} to revisit — read the solution, then tap Re-solve` }, [
    el('div', { class: 'wrong-list' }, rows),
  ]);
}

/** A single results metric column. @internal */
function metric(value: string, label: string, tone: 'ok' | 'bad' | null): HTMLElement {
  const numClass = tone === 'ok' ? 'num ok' : tone === 'bad' ? 'num bad' : 'num';
  return el('div', { class: 'results-metric' }, [
    el('span', { class: `${numClass} tnum`, text: value }),
    el('span', { class: 'lbl', text: label }),
  ]);
}

/** A labelled form field wrapper. @internal */
function field(label: string, control: HTMLElement): HTMLElement {
  return el('label', { class: 'field' }, [el('span', { class: 'field-label', text: label }), control]);
}
