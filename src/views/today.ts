/**
 * Today — the PRELIMS-driven landing view (route `#/` and `#/today`).
 *
 * The learner's daily cockpit. It reads the live plan from {@link currentPlan}
 * and surfaces exactly what to do TODAY as the fixed weekly RHYTHM: the day's
 * ordered {@link PlanBlock}s (Mental Ability · subject · Revise · Current
 * affairs · mock…), each with its minutes, exact topic(s) (FULL / "Quick pass"),
 * a "builds on: <previous topic>" hint, and a one-tap start (Learn / drill /
 * mock / revise). The hero's PRIMARY action is "Start today's study" (jumps to
 * the first scheduled topic); "Open planner" is demoted to a secondary link.
 * A countdown, an on-track banner and progress rings (mastery / coverage /
 * mastered — shown as "—" on a fresh install, not a hard 0) frame the day.
 * Graceful states cover before the plan starts, after the exam, and when every
 * prelims subtopic is mastered; post-Prelims the plan flips to a Mains kick-start.
 */
import { getBanks, getCards, getSubtopic, getSubtopics } from '../content/loader';
import type { Band } from '../content/taxonomy';
import type { MainsItem } from '../content/types';
import { buildSession } from '../engine/drill';
import { buildCuratedDeck, selectSession } from '../engine/flashcards';
import { planDayFor, type Plan, type PlanBlock, type PlanDay, type PlanSummary, type PlanTopic } from '../engine/planner';
import { navigate } from '../router/router';
import { loadState, getPrelimsDateMigrationNotice, dismissPrelimsDateNotice } from '../state/store';
import { currentPlan } from '../lib/plan';
import { diffDaysISO, daysToGo, todayISO } from '../lib/dates';
import { openLearn } from './learn';
import { openMainsQuestion } from './mains';
import { openPaperMock } from './mock';
import { mountQuiz } from './quiz';
import { el, mount, type Child } from './dom';
import { card } from './components/card';
import { button } from './components/button';
import { chip } from './components/chip';
import { ring } from './components/ring';
import { icon } from './components/icon';
import { bandBadge } from './components/badges';

/** Render the Today view into `root`. */
export function render(root: HTMLElement): void {
  const now = new Date();
  const today = todayISO(now);
  const plan = currentPlan(now);
  const summary = plan.summary;
  const state = loadState();
  const start = state.settings.planStartDate;
  // One-time Notification 07/2026 notice (Prelims moved 15 Nov 2026 → 24 Jan 2027).
  const dateNotice = buildPrelimsDateNotice(root, summary);

  // Graceful state: the plan has not started yet.
  if (diffDaysISO(today, start) > 0) {
    mount(root, dateNotice, buildCountdownHero(summary, today, undefined), startsSoonCard(plan, start, today));
    return;
  }
  // Graceful state: the exam date has passed — switch to MAINS kick-start.
  if (summary.daysLeft <= 0) {
    if (summary.postPrelims) {
      const kickstartDay = planDayFor(plan, today) ?? plan.days[0];
      mount(
        root,
        dateNotice,
        buildCountdownHero(summary, today, undefined),
        mainsKickstartCard(),
        buildMainsSection(kickstartDay),
      );
      return;
    }
    mount(root, dateNotice, buildCountdownHero(summary, today, undefined), examPassedCard());
    return;
  }

  const todayDay = planDayFor(plan, today);
  const allMastered =
    summary.prelimsTotal > 0 && summary.prelimsMastered >= summary.prelimsTotal;

  mount(
    root,
    dateNotice,
    buildCountdownHero(summary, today, todayDay),
    buildBanner(summary),
    buildRings(summary),
    buildBudgetToday(todayDay, summary),
    allMastered ? masteredCard() : buildBlocks(todayDay),
    buildMainsParallelNote(summary),
  );
}

/**
 * One-time banner shown after the detailed Notification 07/2026 moved the
 * Prelims date (15 Nov 2026 → 24 Jan 2027). Returns `null` when no migration is
 * pending (fresh install or already dismissed). Dismissing clears the flag and
 * re-renders. @internal
 */
function buildPrelimsDateNotice(root: HTMLElement, summary: PlanSummary): HTMLElement | null {
  if (!getPrelimsDateMigrationNotice()) return null;
  return el('section', { class: 'today-banner is-ok', attrs: { role: 'status' } }, [
    el('span', { class: 'today-banner-icon' }, [icon('calendar', 22)]),
    el('div', { class: 'today-banner-text' }, [
      el('span', {
        class: 'today-banner-title',
        text: `Prelims moved to ${prettyDate(summary.examDateISO)} — your plan has been updated`,
      }),
      el('span', {
        class: 'today-banner-detail',
        text: 'Notification 07/2026 (detailed) set the Screening Test to 24 Jan 2027. Your progress is unchanged.',
      }),
    ]),
    button({
      label: 'Got it',
      variant: 'ghost',
      onClick: () => {
        dismissPrelimsDateNotice();
        render(root);
      },
    }),
  ]);
}

/* -------------------------------------------------------------------------- */
/* Hero + banner                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Countdown hero: greeting + "Prelims on …" countdown card. The PRIMARY button
 * is "Start today's study" (→ first scheduled topic); "Open planner" is the
 * secondary link. Before the plan starts / post-exam there is no day, so it
 * falls back to "Open planner" as the primary. @internal
 */
function buildCountdownHero(summary: PlanSummary, today: string, day: PlanDay | undefined): HTMLElement {
  const daysToExam = daysToGo(summary.examDateISO, today);
  const startAction = day ? firstStart(day) : null;

  const actions: Child[] = startAction
    ? [
        button({ label: "Start today\u2019s study", onClick: startAction.onClick, variant: 'primary', large: true, iconName: 'arrow-right' }),
        button({ label: 'Open planner', onClick: () => navigate('/planner'), variant: 'ghost' }),
      ]
    : [button({ label: 'Open planner', onClick: () => navigate('/planner'), variant: 'primary', large: true, iconName: 'arrow-right' })];

  const left = el('div', { class: 'hero-body' }, [
    el('p', {
      class: 'hero-greeting',
      text: `${greeting(new Date())} · Prelims on ${prettyDate(summary.examDateISO)}`,
    }),
    el('h2', { class: 'hero-title', text: 'Today' }),
    el('div', { class: 'hero-meta' }, [
      chip({ text: `${summary.prelimsStudied}/${summary.prelimsTotal} prelims studied`, tone: 'accent' }),
      chip({ text: `${summary.prelimsMastered} mastered`, tone: summary.prelimsMastered > 0 ? 'ok' : 'default' }),
    ]),
    startAction ? el('p', { class: 'hero-start-hint section-lead', text: startAction.hint }) : null,
    el('div', { class: 'hero-actions' }, actions),
  ]);

  const countdownCard = el('div', { class: 'countdown' }, [
    el('div', { class: 'countdown-days tnum', text: String(daysToExam) }),
    el('div', { class: 'countdown-unit', text: daysToExam === 1 ? 'day to Prelims' : 'days to Prelims' }),
    el('div', { class: 'countdown-label', text: `Prelims · ${prettyDate(summary.examDateISO)}` }),
  ]);

  return el('section', { class: 'hero' }, [left, countdownCard]);
}

/** On-track / behind banner over the PRELIMS scope. @internal */
function buildBanner(summary: PlanSummary): HTMLElement {
  const ok = summary.onTrack;
  const cls = ok ? 'today-banner is-ok' : 'today-banner is-warn';
  const iconName = ok ? 'check' : 'flame';
  const headline = ok
    ? 'On track for Prelims'
    : `Behind by ${summary.behindBy} prelims topic${summary.behindBy === 1 ? '' : 's'}`;
  const pace = `${summary.theoryPerDay} theory + ${summary.aptitudePerDay} aptitude/day`;
  const detail = ok
    ? `${summary.learnDaysLeft} learn day${summary.learnDaysLeft === 1 ? '' : 's'} left · about ${pace} keeps both papers moving.`
    : `Do ${pace} to catch up before ${prettyDate(summary.examDateISO)}.`;
  return el('section', { class: cls, attrs: { role: 'status' } }, [
    el('span', { class: 'today-banner-icon' }, [icon(iconName, 22)]),
    el('div', { class: 'today-banner-text' }, [
      el('span', { class: 'today-banner-title', text: headline }),
      el('span', { class: 'today-banner-detail', text: detail }),
    ]),
  ]);
}

/* -------------------------------------------------------------------------- */
/* Rings                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Prelims mastery / coverage / mastered-count rings. On a FRESH install
 * (nothing studied yet) the centres read "—" rather than a hard 0/0% so the
 * cockpit doesn't look broken. @internal
 */
function buildRings(summary: PlanSummary): HTMLElement {
  const fresh = summary.prelimsStudied === 0;
  const ringCard = (r: HTMLElement, caption: string, sub: string): HTMLElement =>
    el('div', { class: 'card ring-card' }, [
      r,
      el('span', { class: 'ring-caption', text: caption }),
      el('span', { class: 'ring-sub', text: sub }),
    ]);

  const masteredFrac = summary.prelimsTotal > 0 ? summary.prelimsMastered / summary.prelimsTotal : 0;

  return el('div', { class: 'rings' }, [
    ringCard(
      ring({ value: summary.prelimsMasteryPct / 100, centerText: fresh ? '\u2014' : `${summary.prelimsMasteryPct}%`, centerLabel: 'mastery' }),
      'Mastery',
      fresh ? 'answer a drill to begin' : 'average across prelims',
    ),
    ringCard(
      ring({ value: summary.prelimsCoveragePct / 100, centerText: fresh ? '\u2014' : `${summary.prelimsCoveragePct}%`, centerLabel: 'studied', variant: 'accent' }),
      'Coverage',
      `${summary.prelimsStudied}/${summary.prelimsTotal} prelims topics`,
    ),
    ringCard(
      ring({
        value: masteredFrac,
        centerText: fresh ? '\u2014' : `${summary.prelimsMastered}`,
        centerLabel: 'mastered',
        variant: summary.prelimsMastered > 0 ? 'success' : 'accent',
      }),
      'Mastered',
      `of ${summary.prelimsTotal} prelims topics`,
    ),
  ]);
}

/* -------------------------------------------------------------------------- */
/* Budget + the day's rhythm blocks                                            */
/* -------------------------------------------------------------------------- */

/** Format minutes as a compact `3 h 50 m` / `50 m` / `4 h` label. @internal */
export function fmtDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h === 0) return `${m} m`;
  return m === 0 ? `${h} h` : `${h} h ${m} m`;
}

/**
 * "Today's plan" budget line — the day's total scheduled minutes vs the day's
 * time budget (e.g. "3 h 50 m of 4 h"), plus a per-block minute breakdown drawn
 * straight from the rhythm blocks. @internal
 */
function buildBudgetToday(day: PlanDay | undefined, summary: PlanSummary): HTMLElement {
  const budget = day?.budgetMin ?? summary.dailyBudgetMin;
  const planned = day?.plannedMinutes ?? 0;
  const pct = budget > 0 ? Math.min(1, planned / budget) : 0;

  const blocks: Child[] = (day?.blocks ?? []).map((b) =>
    chip({ text: `${b.label} · ${fmtDuration(b.minutes)}`, tone: 'muted' }),
  );

  return el('section', { class: 'today-budget card', attrs: { role: 'status' } }, [
    el('div', { class: 'today-budget-head' }, [
      el('span', { class: 'today-budget-title', text: "Today\u2019s plan" }),
      el('span', { class: 'today-budget-total tnum', text: `${fmtDuration(planned)} of ${fmtDuration(budget)}` }),
    ]),
    el('div', { class: 'today-budget-bar', attrs: { role: 'presentation' } }, [
      el('div', { class: 'today-budget-fill', attrs: { style: `width:${Math.round(pct * 100)}%` } }),
    ]),
    blocks.length > 0 ? el('div', { class: 'today-budget-blocks' }, blocks) : null,
  ]);
}

/** The day's rhythm blocks, in order — each a card with a one-tap start. @internal */
function buildBlocks(day: PlanDay | undefined): HTMLElement {
  const blocks = day?.blocks ?? [];
  if (blocks.length === 0) {
    return card({ title: 'Today' }, [
      el('div', { class: 'empty-state is-compact' }, [
        el('span', { class: 'empty-icon' }, [icon('sparkles', 22)]),
        el('p', { text: day?.light ? 'Light day — rest and light revision before the exam.' : 'No blocks scheduled today.' }),
      ]),
    ]);
  }
  return el('div', { class: 'today-blocks' }, blocks.map(blockCard));
}

/** Render one rhythm block as a card. @internal */
function blockCard(block: PlanBlock): HTMLElement {
  const head = el('div', { class: 'block-head' }, [
    el('div', { class: 'block-head-main' }, [
      el('h3', { class: 'block-title', text: block.label }),
      block.buildsOn ? el('span', { class: 'block-builds', text: `builds on: ${block.buildsOn}` }) : null,
    ]),
    chip({ text: fmtDuration(block.minutes), tone: 'muted', iconName: 'timer' }),
  ]);

  const body: Child[] = [];
  const topics = block.topics ?? [];
  if (topics.length > 0) {
    body.push(el('div', { class: 'study-list' }, topics.map(topicLink)));
  }
  // A targeted-revision block also carries DEEPEN top-ups; keep its generic
  // "Open Revise" action so the remaining time still points at weakest-first
  // revision. Every other topic-less block shows its one-tap start as before.
  if (topics.length === 0 || block.kind === 'targeted-revision') {
    const action = blockAction(block);
    if (action) body.push(action);
  }

  return el('div', { class: 'card block-card' }, [head, ...body]);
}

/** The one-tap start for a topic-less block (revise / ca / mock / telugu…). @internal */
function blockAction(block: PlanBlock): HTMLElement | null {
  switch (block.kind) {
    case 'ca':
    case 'ca-refresh':
    case 'ca-roundup': {
      const sid = block.caSubtopicId;
      return button({
        label: 'Current affairs',
        variant: 'primary',
        iconName: 'arrow-right',
        onClick: () => (sid ? openLearn(sid) : navigate('/drill')),
      });
    }
    case 'mock': {
      const paper = block.mockPaper;
      return button({
        label: paper ? `Start ${paper === 'paper1' ? 'Paper-I' : 'Paper-II'} mock` : 'Start mock',
        variant: 'primary',
        iconName: 'timer',
        onClick: () => (paper ? openPaperMock(paper) : navigate('/mock')),
      });
    }
    case 'mock-review':
      return button({ label: 'Review mistakes', variant: 'secondary', iconName: 'arrow-right', onClick: () => navigate('/notebook') });
    case 'weakest-area':
      return button({ label: 'Practise weak areas', variant: 'secondary', iconName: 'target', onClick: () => navigate('/progress') });
    case 'revise':
    case 'targeted-revision':
    case 'weekly-revision':
      return button({ label: 'Open Revise', variant: 'primary', iconName: 'arrow-right', onClick: () => navigate('/revise') });
    case 'telugu':
      return button({ label: 'Telugu practice', variant: 'secondary', iconName: 'arrow-right', onClick: () => navigate('/languages') });
    case 'ment-practice':
      return button({
        label: 'Mental Ability practice',
        variant: 'primary',
        iconName: 'drill',
        onClick: () => startPracticeDrill(block.practiceSubtopicIds ?? [], 20),
      });
    case 'light':
      return el('p', { class: 'section-lead', text: 'AP + current-affairs key facts and formula sheet — keep it light.' });
    default:
      return null;
  }
}

/** One study-topic row linking to the subtopic's Learn workspace. @internal */
function topicLink(topic: PlanTopic): HTMLElement {
  if (topic.kind === 'practice') return practiceLink(topic);
  if (topic.pass === 'deepen') return deepenLink(topic);
  const view = getSubtopic(topic.subtopicId);
  const name = topic.name || view?.meta.name || topic.subtopicId;
  const band = view?.meta.band as Band | undefined;
  const hasQuestions = topic.mcqCount > 0;
  const countChip = hasQuestions
    ? chip({ text: `${topic.mcqCount} Q`, tone: 'accent' })
    : chip({ text: 'material coming', tone: 'muted', iconName: 'timer' });
  const timeChip = chip({ text: fmtDuration(topic.estMinutes), tone: 'muted' });
  // Depth tier chip: FULL (the default) shows none; STANDARD / QUICK are marked.
  const passChip = topic.pass === 'quick'
    ? chip({ text: 'Quick pass', tone: 'warn', title: 'Key facts + cards + ~8 questions — a light first pass' })
    : topic.pass === 'standard'
      ? chip({ text: 'Standard', tone: 'muted', title: 'Notes + ~12 questions — a standard first pass' })
      : null;
  return el('button', {
    class: 'study-link',
    type: 'button',
    ariaLabel: hasQuestions
      ? `Study ${name} — ${topic.mcqCount} question${topic.mcqCount === 1 ? '' : 's'}, about ${fmtDuration(topic.estMinutes)}${topic.pass !== 'full' ? `, ${topic.pass} pass` : ''}`
      : `Study ${name} — material coming soon, about ${fmtDuration(topic.estMinutes)}`,
    onClick: () => openLearn(topic.subtopicId),
  }, [
    el('div', { class: 'study-link-main' }, [
      band ? bandBadge(band) : null,
      el('span', { class: 'study-link-name', text: name }),
      passChip,
      countChip,
      timeChip,
    ]),
    el('span', { class: 'track-row-go' }, [icon('chevron', 16)]),
  ]);
}

/**
 * A DEEPEN row — a final-window top-up that lifts a below-floor topic to its
 * floor depth. Plain language, no tier jargon: "Deepen · <topic> · 15 min".
 * @internal
 */
function deepenLink(topic: PlanTopic): HTMLElement {
  const view = getSubtopic(topic.subtopicId);
  const name = topic.name || view?.meta.name || topic.subtopicId;
  return el('button', {
    class: 'study-link',
    type: 'button',
    ariaLabel: `Deepen ${name} — about ${topic.estMinutes} minutes to strengthen a weak area`,
    onClick: () => openLearn(topic.subtopicId),
  }, [
    el('div', { class: 'study-link-main' }, [
      chip({ text: 'Deepen', tone: 'accent' }),
      el('span', { class: 'study-link-name', text: name }),
      chip({ text: `${topic.estMinutes} min`, tone: 'muted' }),
    ]),
    el('span', { class: 'track-row-go' }, [icon('chevron', 16)]),
  ]);
}

/**
 * A Mental Ability PRACTICE-set row — a mixed drill over the day's ALREADY-
 * covered MENT subtopics. @internal
 */
function practiceLink(topic: PlanTopic): HTMLElement {
  const q = topic.mcqCount;
  const countChip = q > 0
    ? chip({ text: `${q} Q`, tone: 'accent' })
    : chip({ text: 'material coming', tone: 'muted', iconName: 'timer' });
  return el('button', {
    class: 'study-link',
    type: 'button',
    ariaLabel: `Mental Ability practice — ${q} mixed question${q === 1 ? '' : 's'}, about ${fmtDuration(topic.estMinutes)}`,
    onClick: () => startPracticeDrill(topic.practiceSubtopicIds ?? [], q > 0 ? q : 20),
  }, [
    el('div', { class: 'study-link-main' }, [
      chip({ text: 'Practice', tone: 'accent' }),
      el('span', { class: 'study-link-name', text: 'Mental Ability practice' }),
      countChip,
      chip({ text: fmtDuration(topic.estMinutes), tone: 'muted' }),
    ]),
    el('span', { class: 'track-row-go' }, [icon('chevron', 16)]),
  ]);
}

/**
 * The PRIMARY "Start today's study" action — the first scheduled topic's Learn
 * workspace (or the first mock/practice block). Returns `null` when there is
 * nothing actionable. @internal
 */
function firstStart(day: PlanDay): { onClick: () => void; hint: string } | null {
  for (const b of day.blocks) {
    const topics = b.topics ?? [];
    const first = topics[0];
    if (first) {
      if (first.kind === 'practice') {
        return {
          onClick: () => startPracticeDrill(first.practiceSubtopicIds ?? [], first.mcqCount > 0 ? first.mcqCount : 20),
          hint: `First up: ${b.label} · Mental Ability practice`,
        };
      }
      const name = first.name || getSubtopic(first.subtopicId)?.meta.name || first.subtopicId;
      return { onClick: () => openLearn(first.subtopicId), hint: `First up: ${b.label} · ${name}` };
    }
    if (b.kind === 'mock' && b.mockPaper) {
      const paper = b.mockPaper;
      return { onClick: () => openPaperMock(paper), hint: `First up: full ${paper === 'paper1' ? 'Paper-I' : 'Paper-II'} mock` };
    }
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Post-prelims Mains section (unchanged behaviour)                            */
/* -------------------------------------------------------------------------- */

/** Full-width "Mains practice" section for the post-Prelims kick-start. @internal */
function buildMainsSection(day: PlanDay | undefined): HTMLElement {
  return el('div', { class: 'today-mains' }, [buildMainsToday(day)]);
}

/** "Mains practice" card: the kick-start's 2–4 mains questions → Mains workspace. @internal */
function buildMainsToday(day: PlanDay | undefined): HTMLElement {
  const ids = day?.mainsQuestionIds ?? [];
  const bank = mainsById();
  const rows = ids
    .map((id) => bank.get(id))
    .filter((m): m is MainsItem => m !== undefined)
    .map((item) =>
      el('button', {
        class: 'study-link',
        type: 'button',
        ariaLabel: `Practise mains question: ${item.question}`,
        onClick: () => openMainsQuestion(item.id),
      }, [
        el('span', { class: 'study-link-name', text: truncate(item.question, 90) }),
        el('span', { class: 'track-row-go' }, [icon('chevron', 16)]),
      ]),
    );

  const body: Child[] = [
    el('span', { class: 'empty-icon' }, [icon('notes', 24)]),
    el('h3', { class: 'revise-hub-title', text: 'Mains practice' }),
    el('p', {
      class: 'section-lead',
      text: rows.length > 0
        ? `Mains practice: ${rows.length} question${rows.length === 1 ? '' : 's'} for today.`
        : 'Mains practice continues here after Prelims.',
    }),
    rows.length > 0
      ? el('div', { class: 'study-list today-mains-list' }, rows)
      : button({ label: 'Open Mains', variant: 'ghost', iconName: 'arrow-right', onClick: () => navigate('/mains') }),
  ];
  return el('div', { class: 'card today-mains-card' }, body);
}

/** A small footnote clarifying the exam date = Prelims, Mains is a parallel track. @internal */
function buildMainsParallelNote(summary: PlanSummary): HTMLElement {
  return el('p', { class: 'section-lead today-track-note', attrs: { role: 'note' } }, [
    icon('calendar', 14),
    el('span', {
      text: ` ${prettyDate(summary.examDateISO)} is the PRELIMS date (Papers I & II). Mains & qualifying (Telugu, English & Essay) — ${summary.mainsSubjectsTotal} subjects, ${summary.mainsQuestionsTotal} practice questions — are a lighter parallel track continuing after Prelims.`,
    }),
  ]);
}

/** Collect MCQ ids across a set of subtopic ids. @internal */
function collectMcqIds(subtopicIds: readonly string[]): string[] {
  const out: string[] = [];
  for (const id of subtopicIds) {
    const view = getSubtopic(id);
    if (view) out.push(...view.mcqs.map((m) => m.id));
  }
  return out;
}

/** All mains questions indexed by id (for the kick-start mains card). @internal */
function mainsById(): Map<string, MainsItem> {
  const map = new Map<string, MainsItem>();
  for (const loaded of getBanks('mains')) {
    if (loaded.bank.kind !== 'mains') continue;
    for (const item of loaded.bank.items) map.set(item.id, item);
  }
  return map;
}

/** Truncate `text` to at most `max` chars with an ellipsis. @internal */
function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Launch a mixed Mental Ability practice drill over the ALREADY-covered MENT
 * subtopics `subtopicIds`, sized to `questions`. Falls back to the Drill page
 * when none of the scope has authored MCQs yet. Exported for the Planner view.
 */
export function startPracticeDrill(subtopicIds: readonly string[], questions: number): void {
  const view = document.getElementById('view');
  if (!view) return;
  const mcqIds = collectMcqIds(subtopicIds);
  if (mcqIds.length === 0) {
    navigate('/drill');
    return;
  }
  const items = buildSession({ restrictToIds: mcqIds, limit: questions, order: 'shuffle', seed: 1 }).items;
  mountQuiz(view as HTMLElement, items, () => render(view as HTMLElement), { allowEndSession: true });
}

/**
 * Today's flashcard SESSION size over the CURATED deck (used elsewhere if the
 * Revise entry ever moves onto Today). Exported to keep one source of truth.
 */
export function todaysCuratedSession(): number {
  const deck = getSubtopics().flatMap((s) => buildCuratedDeck(getCards(s.id)));
  return selectSession(deck, loadState().flashcards, Date.now()).length;
}

/* -------------------------------------------------------------------------- */
/* Graceful-state cards                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Shown before the plan's start date — a small card derived from the plan's
 * FIRST day, so the learner knows exactly what day 1 holds (e.g. a Paper-II
 * baseline mock). "Days before the start date are free." @internal
 */
function startsSoonCard(plan: Plan, start: string, today: string): HTMLElement {
  const desc = describeFirstDay(plan, start);
  const headline =
    diffDaysISO(today, start) === 1
      ? `Your plan starts tomorrow \u2014 ${prettyDowDate(start)}: ${desc}`
      : `Your plan starts ${prettyDowDate(start)}: ${desc}`;
  return card({ title: 'Your plan starts soon' }, [
    el('div', { class: 'empty-state' }, [
      el('span', { class: 'empty-icon' }, [icon('sparkles', 26)]),
      el('h3', { text: headline }),
      el('p', { text: 'Days before the start date are free \u2014 your progress is kept.' }),
      button({ label: 'Open planner', variant: 'primary', iconName: 'arrow-right', onClick: () => navigate('/planner') }),
    ]),
  ]);
}

/**
 * A plain-language description of the plan's FIRST day — the opening Paper-II
 * baseline mock when day 1 is a Saturday mock, else the first subject/topic
 * scheduled. @internal
 */
function describeFirstDay(plan: Plan, start: string): string {
  const day =
    plan.days.find((d) => d.dateISO === start) ??
    plan.days.find((d) => d.dateISO >= start && d.blocks.length > 0);
  if (!day) return 'your study plan';
  if (day.mockPaper === 'paper2') return 'Paper-II baseline mock';
  if (day.mockPaper === 'paper1') return 'Paper-I mock';
  const lead = day.blocks.find((b) => b.kind === 'subject' || b.kind === 'catchup' || b.kind === 'ment');
  if (lead) {
    const topic = lead.topics?.[0];
    return topic ? `${lead.label} · ${topic.name}` : lead.label;
  }
  return day.blocks[0]?.label ?? 'your study plan';
}

/** Shown once the exam date has passed. @internal */
function examPassedCard(): HTMLElement {
  return card({ title: 'Prelims day has passed' }, [
    el('div', { class: 'empty-state' }, [
      el('span', { class: 'empty-icon' }, [icon('check', 26)]),
      el('h3', { text: 'Set a new exam date' }),
      el('p', { text: 'Update the target Prelims date in the planner to build a fresh study plan.' }),
      button({ label: 'Open planner', variant: 'primary', iconName: 'arrow-right', onClick: () => navigate('/planner') }),
    ]),
  ]);
}

/**
 * Shown after the Prelims date, when the plan has flipped to the post-prelims
 * MAINS kick-start mode. @internal */
function mainsKickstartCard(): HTMLElement {
  return card({ title: 'Prelims done — Mains kick-start' }, [
    el('div', { class: 'empty-state' }, [
      el('span', { class: 'empty-icon' }, [icon('sparkles', 26)]),
      el('h3', { text: 'Straight into Mains' }),
      el('p', { text: 'Prelims is behind you. The plan now runs descriptive Mains practice by paper, a weekly General Essay, and the qualifying Telugu / English blocks. Today\u2019s mains practice is below.' }),
      button({ label: 'Open planner', variant: 'primary', iconName: 'arrow-right', onClick: () => navigate('/planner') }),
    ]),
  ]);
}

/** Shown when every prelims subtopic is mastered. @internal */
function masteredCard(): HTMLElement {
  return card({ title: 'Prelims scope mastered' }, [
    el('div', { class: 'empty-state' }, [
      el('span', { class: 'empty-icon' }, [icon('check', 26)]),
      el('h3', { text: 'Every prelims topic mastered 🎉' }),
      el('p', { text: 'Keep it sharp with spaced revision and mock drills, and push the parallel Mains track.' }),
      button({ label: 'Revise', variant: 'primary', iconName: 'arrow-right', onClick: () => navigate('/revise') }),
    ]),
  ]);
}

/* -------------------------------------------------------------------------- */
/* Small helpers                                                               */
/* -------------------------------------------------------------------------- */

/** A time-of-day greeting. @internal */
function greeting(now: Date): string {
  const h = now.getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

/** Format an ISO date as e.g. `15 Nov 2026`. @internal */
export function prettyDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  if (!y || !m || !d) return iso;
  return `${d} ${months[m - 1]} ${y}`;
}

/** Format an ISO date with its weekday, no year — e.g. `Sat 10 Oct`. */
export function prettyDowDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dows = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  if (!y || !m || !d) return iso;
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${dows[dow]} ${d} ${months[m - 1]}`;
}
