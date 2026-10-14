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
import { getBanks, getSubtopic } from '../content/loader';
import type { MainsItem } from '../content/types';
import { behindBanner, planDayFor, type Plan, type PlanDay, type PlanSummary } from '../engine/planner';
import { navigate } from '../router/router';
import {
  loadState,
  getPrelimsDateMigrationNotice,
  dismissPrelimsDateNotice,
  isAdminDone,
  setAdminDone,
  setPlanStartDate,
} from '../state/store';
import { currentPlan } from '../lib/plan';
import { diffDaysISO, daysToGo, todayISO, addDaysISO } from '../lib/dates';
import { adminCardsFor, isExamDay, type AdminCardId } from '../lib/day-tasks';
import { continueHint, openLearn } from './learn';
import { openMainsQuestion } from './mains';
import { openResumeTest, resumeTestCard } from './mock';
import { liveFlashcardDue } from '../lib/due';
import {
  computeReviseCtx,
  dayRows,
  fmtDuration,
  languageRows,
  rowDone,
  rowManual,
  rowView,
  toggleRow,
  unitShortTitle,
  type DayRow,
  type ReviseCtx,
} from './today-tasks';
import { el, mount, type Child } from './dom';
import { card } from './components/card';
import { button } from './components/button';
import { chip } from './components/chip';
import { icon } from './components/icon';

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
    mount(root, dateNotice, buildNowHero(null, summary, today, undefined), startsSoonCard(plan, start, today));
    return;
  }
  // Exam day itself: a calm exam-day card, nothing to study (D18).
  if (isExamDay(today, summary.examDateISO)) {
    mount(root, dateNotice, buildNowHero(null, summary, today, undefined), examDayCard(summary));
    return;
  }
  // Graceful state: the exam date has passed — switch to MAINS kick-start.
  if (summary.daysLeft <= 0 || today > summary.examDateISO) {
    if (summary.postPrelims) {
      const kickstartDay = planDayFor(plan, today) ?? plan.days[0];
      mount(
        root,
        dateNotice,
        buildNowHero(null, summary, today, undefined),
        mainsKickstartCard(),
        buildMainsSection(root, kickstartDay, today),
      );
      return;
    }
    mount(root, dateNotice, buildNowHero(null, summary, today, undefined), examPassedCard());
    return;
  }

  const todayDay = planDayFor(plan, today);
  const allMastered =
    summary.prelimsTotal > 0 && summary.prelimsMastered >= summary.prelimsTotal;

  const reviseCtx = computeReviseCtx(today, todayDay);
  const rows = todayDay ? dayRows(todayDay, today) : [];
  mount(
    root,
    dateNotice,
    resumeTestCard(() => openResumeTest(), () => render(root)),
    buildRecoveryBanner(root, summary, today),
    buildNowHero(root, summary, today, todayDay, reviseCtx, rows, plan),
    ...buildAdminCards(root, today, todayDay, summary.examDateISO),
    allMastered ? masteredCard() : buildChecklist(root, todayDay, reviseCtx, rows),
    allMastered ? null : buildNextSaturdayCard(plan, today),
    buildMainsParallelNote(summary),
  );
}

/* -------------------------------------------------------------------------- */
/* Admin task cards (eligibility gates — STANDARDS §8a)                        */
/* -------------------------------------------------------------------------- */

/** Public portal for the application / hall ticket. @internal */
const PSC_URL = 'https://psc.ap.gov.in';

/**
 * The compact ADMIN-TASK cards shown on Today (eligibility gates), chosen by
 * the pure {@link adminCardsFor} (D18): "Apply online" until the 27 Oct
 * deadline (then, if still not done, "Missed the deadline?" until 31 Oct, then
 * hidden), "Hall ticket" from exam − 12 days until the day before the exam,
 * and an exam-day checklist on the light day (exam − 1). Each card has ONE
 * "Mark done" button (the card's done flag). @internal
 */
function buildAdminCards(root: HTMLElement, today: string, day: PlanDay | undefined, examISO: string): HTMLElement[] {
  const ids = adminCardsFor(today, examISO, isAdminDone, day?.light === true);
  return ids.map((id) => adminCard(root, ADMIN_SPECS[id]));
}

/** One admin card's copy. @internal */
interface AdminSpec {
  /** The done flag the card toggles. */
  id: string;
  title: string;
  lead: string;
  checklist: readonly string[];
  link?: { label: string; href: string };
}

/** The admin cards' copy, by card id. @internal */
const ADMIN_SPECS: Readonly<Record<AdminCardId, AdminSpec>> = {
  'apply-online': {
    id: 'apply-online',
    title: 'Apply online — deadline 27 Oct 2026, 11:59 PM',
    lead: 'Submit your APPSC Group-1 application before the deadline.',
    checklist: [
      'OTPR registration / login',
      'Photo & signature specs',
      'Fee payment',
      'Choose exam centre',
      'Download application PDF',
    ],
    link: { label: 'Open psc.ap.gov.in', href: PSC_URL },
  },
  'apply-missed': {
    id: 'apply-online',
    title: 'Missed the deadline? check psc.ap.gov.in for extensions',
    lead: 'The application window closed on 27 Oct. APPSC sometimes extends it \u2014 check the portal, and apply at once if it is open.',
    checklist: [],
    link: { label: 'Open psc.ap.gov.in', href: PSC_URL },
  },
  'hall-ticket': {
    id: 'hall-ticket',
    title: 'Hall ticket — download when released',
    lead: 'Watch psc.ap.gov.in from ~12 Jan and download your hall ticket as soon as it is released.',
    checklist: [],
    link: { label: 'Open psc.ap.gov.in', href: PSC_URL },
  },
  'exam-day': {
    id: 'exam-day',
    title: 'Exam-day checklist',
    lead: 'Prelims is tomorrow. Get everything ready tonight.',
    checklist: [
      'Hall ticket (printed) + photo ID',
      'Black / blue ballpoint pens',
      'Reach the centre early',
      'OMR rules: fill bubbles fully, no stray marks',
    ],
  },
};

/** One compact admin-task card with a checklist, optional link and a "Mark done". @internal */
function adminCard(
  root: HTMLElement,
  spec: { id: string; title: string; lead: string; checklist: readonly string[]; link?: { label: string; href: string } },
): HTMLElement {
  const body: Child[] = [el('p', { class: 'section-lead', text: spec.lead })];
  if (spec.checklist.length > 0) {
    body.push(
      el('ul', { class: 'admin-checklist' }, spec.checklist.map((item) => el('li', { text: item }))),
    );
  }
  const actions: Child[] = [];
  if (spec.link) {
    actions.push(
      el('a', { class: 'btn btn-ghost', href: spec.link.href, attrs: { target: '_blank', rel: 'noopener noreferrer' } }, [
        el('span', { text: spec.link.label }),
      ]),
    );
  }
  actions.push(
    button({
      label: 'Mark done',
      variant: 'secondary',
      iconName: 'check',
      onClick: () => {
        setAdminDone(spec.id, true);
        render(root);
      },
    }),
  );
  body.push(el('div', { class: 'admin-card-actions' }, actions));
  return card({ title: spec.title }, body);
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

/**
 * The honest "behind" banner (D4), copy from the pure {@link behindBanner}
 * (shared with the Planner and regenerated on every render): 1–7 days behind →
 * a calm "plan adjusted"; > 7 → "You are N days behind — here is the reduced
 * plan" plus concrete options. It never claims "finish on time" unless the
 * recovered plan is feasible. A secondary action, "I'm only starting now —
 * restart my plan from today", moves the plan start to today after an inline
 * confirm (all progress is kept) — offered only before the first-pass coverage
 * end. Returns `null` when not behind. @internal
 */
function buildRecoveryBanner(root: HTMLElement, summary: PlanSummary, today: string): HTMLElement | null {
  const copy = behindBanner(summary, today);
  if (!copy) return null;
  const actions = el('div', { class: 'today-banner-actions' });
  const idle = (): void => {
    actions.replaceChildren(
      button({
        label: 'I\u2019m only starting now \u2014 restart my plan from today',
        variant: 'ghost',
        onClick: confirm,
      }),
    );
  };
  const confirm = (): void => {
    actions.replaceChildren(
      el('span', {
        class: 'today-banner-detail',
        text: `Start the plan from today (${prettyDowDate(today)})? Everything you have done so far is kept \u2014 only the schedule moves.`,
      }),
      el('div', { class: 'today-banner-confirm' }, [
        button({
          label: 'Yes, restart from today',
          variant: 'primary',
          onClick: () => {
            setPlanStartDate(today);
            render(root);
          },
        }),
        button({ label: 'Cancel', variant: 'ghost', onClick: idle }),
      ]),
    );
  };
  if (copy.showRestart) idle();
  // The restart action is listed as a button, not repeated in the options list.
  const options = copy.options.filter((o) => !o.startsWith('Restart the plan'));
  return el('section', { class: copy.tone === 'calm' ? 'today-banner is-ok today-behind' : 'today-banner is-warn today-behind', attrs: { role: 'status' } }, [
    el('span', { class: 'today-banner-icon' }, [icon('calendar', 22)]),
    el('div', { class: 'today-banner-text' }, [
      el('span', { class: 'today-banner-title', text: copy.title }),
      el('span', { class: 'today-banner-detail', text: copy.detail }),
      options.length > 0 ? el('ul', { class: 'today-banner-options' }, options.map((o) => el('li', { text: o }))) : null,
      copy.showRestart ? actions : null,
    ]),
  ]);
}

/* -------------------------------------------------------------------------- */
/* Hero + banner                                                               */
/* -------------------------------------------------------------------------- */
/**
 * The "Now" hero — the single focal point of Today. It names the day's NEXT
 * UNFINISHED row ("Start here" first on orientation day, then the rows in day
 * order) and offers ONE primary "Start" that opens that row's destination. For
 * a topic it also offers "Mark as studied". When every row is done it says
 * "All done for today — well done" and previews tomorrow. @internal
 */
function buildNowHero(
  root: HTMLElement | null,
  summary: PlanSummary,
  today: string,
  day: PlanDay | undefined,
  reviseCtx?: ReviseCtx,
  rows: readonly DayRow[] = [],
  plan?: Plan,
): HTMLElement {
  const daysToExam = Math.max(0, daysToGo(summary.examDateISO, today));
  const focusRow = day && reviseCtx ? nextUnfinishedRow(rows, today) : undefined;
  const focus = focusRow && day && reviseCtx ? rowView(focusRow, { reviseCtx, day }) : null;
  const topicRow = focusRow && (focusRow.task === 'topic' || focusRow.task === 'missed') ? focusRow : undefined;

  const actions: Child[] = focus
    ? [
        button({
          label: topicRow || focusRow?.task === 'revisit' || focusRow?.task === 'start-here' ? 'Start reading' : 'Start now',
          onClick: focus.onClick,
          variant: 'primary',
          large: true,
          iconName: 'arrow-right',
        }),
        topicRow && root
          ? button({
              label: 'Mark as studied',
              variant: 'secondary',
              iconName: 'check',
              ariaLabel: `Mark ${focus.title} as studied`,
              onClick: () => {
                toggleRow(topicRow, today);
                render(root);
              },
            })
          : null,
        button({ label: 'Open plan', onClick: () => navigate('/plan'), variant: topicRow ? 'ghost' : 'secondary' }),
      ]
    : [button({ label: 'Open plan', onClick: () => navigate('/plan'), variant: day && rows.length > 0 ? 'secondary' : 'primary', large: !(day && rows.length > 0), iconName: 'arrow-right' })];

  const allDone = day !== undefined && rows.length > 0 && !focus;
  const greetingText = today > summary.examDateISO
    ? `${greeting(new Date())} · Prelims done`
    : daysToExam === 0
      ? `${greeting(new Date())} · Prelims today`
      : `${greeting(new Date())} · ${daysToExam} ${daysToExam === 1 ? 'day' : 'days'} to Prelims`;
  const left = el('div', { class: 'hero-body' }, [
    el('p', { class: 'hero-greeting', text: greetingText }),
    buildUnitLine(day),
    focus
      ? el('div', { class: 'hero-now' }, [
          el('span', { class: 'hero-now-eyebrow', text: 'Up now' }),
          el('span', { class: 'hero-now-title', text: focus.title }),
          el('span', { class: 'hero-now-meta' }, [
            el('span', { text: focus.context }),
            chip({ text: fmtDuration(focus.minutes), tone: 'default', iconName: 'timer' }),
          ]),
          el('span', { class: 'hero-now-hint', text: focus.hint }),
          continueLink(topicRow),
        ])
      : allDone
        ? el('div', { class: 'hero-now is-all-done', attrs: { 'data-state': 'all-done' } }, [
            el('span', { class: 'hero-now-eyebrow', text: 'All done' }),
            el('span', { class: 'hero-now-title', text: 'All done for today \u2014 well done' }),
            plan ? tomorrowPreview(plan, today) : null,
          ])
        : null,
    el('div', { class: 'hero-actions' }, actions),
  ]);

  return el('section', { class: 'hero' }, [left]);
}

/** `Continue at <section> →` for a topic already part-read (else null). @internal */
function continueLink(row: DayRow | undefined): HTMLElement | null {
  const id = row?.topic?.subtopicId;
  const sub = id ? getSubtopic(id) : undefined;
  const hint = sub ? continueHint(sub) : null;
  if (!id || !hint) return null;
  return el('button', {
    class: 'link-btn hero-continue',
    type: 'button',
    text: `Continue at ${hint.title} \u2192`,
    onClick: () => openLearn(id, { tab: 'notes', noteId: hint.noteId }),
  });
}

/** "Tomorrow: A · B · C" — a one-line preview of the next plan day. @internal */
function tomorrowPreview(plan: Plan, today: string): HTMLElement | null {
  const next = planDayFor(plan, addDaysISO(today, 1));
  if (!next) return null;
  const names: string[] = [];
  for (const b of next.blocks) {
    const real = (b.topics ?? []).filter((t) => t.kind !== 'practice');
    if (real.length > 0) names.push(...real.map((t) => t.name || getSubtopic(t.subtopicId)?.meta.name || t.subtopicId));
    else names.push(b.label);
  }
  const text = names.length > 0
    ? `Tomorrow (${prettyDowDate(next.dateISO)}): ${names.slice(0, 4).join(' \u00b7 ')}${names.length > 4 ? ` +${names.length - 4} more` : ''}`
    : `Tomorrow (${prettyDowDate(next.dateISO)}): a rest day`;
  return el('span', { class: 'hero-now-hint today-tomorrow', text });
}

/**
 * The muted "This week: <unit title> · day X of Y" line that places today in
 * its weekly subject unit. Returns `null` when the day carries no unit. @internal
 */
function buildUnitLine(day: PlanDay | undefined): HTMLElement | null {
  if (!day || !day.unitId || !day.unitTitle) return null;
  const text = `This week: ${unitShortTitle(day.unitTitle)} · day ${day.unitDay} of ${day.unitDays}`;
  return el('p', { class: 'hero-unit-line', text });
}

/* -------------------------------------------------------------------------- */
/* The day's rows (slim checklist)                                             */
/* -------------------------------------------------------------------------- */

/** Today's flashcard SESSION size (shared due model). */
export function todaysCuratedSession(): number {
  return liveFlashcardDue().today;
}

/**
 * The hero's row: the unread "Start here" guide first (orientation day), then
 * the first unfinished row in day order. `undefined` when all are done. @internal
 */
function nextUnfinishedRow(rows: readonly DayRow[], today: string): DayRow | undefined {
  const startHere = rows.find((r) => r.task === 'start-here' && !rowDone(r, today));
  if (startHere) return startHere;
  return rows.find((r) => !rowDone(r, today));
}

/**
 * The day's rows as a SLIM ORDERED CHECKLIST. Each row one-taps into its
 * destination and carries a tick: topic rows toggle "Mark as studied"; other
 * self-reported rows toggle their done flag; tests / the Telugu lesson / review
 * lists show a status box ticked by finishing them. @internal
 */
function buildChecklist(root: HTMLElement, day: PlanDay | undefined, reviseCtx: ReviseCtx, rows: readonly DayRow[]): HTMLElement {
  if (!day || rows.length === 0) {
    return card({ title: 'Today' }, [
      el('div', { class: 'empty-state is-compact' }, [
        el('span', { class: 'empty-icon' }, [icon('sparkles', 22)]),
        el('p', { text: day?.light ? 'Light day — rest and light revision before the exam.' : 'No blocks scheduled today.' }),
      ]),
    ]);
  }
  const today = day.dateISO;
  const budget = day.budgetMin ?? 0;
  const planned = day.plannedMinutes ?? 0;
  const doneCount = rows.filter((r) => rowDone(r, today)).length;
  return card(
    {
      title: 'Today\u2019s plan',
      subtitle: `${doneCount} of ${rows.length} done${budget > 0 ? ` \u00b7 ${fmtDuration(planned)} of ${fmtDuration(budget)}` : ''}`,
    },
    [el('ul', { class: 'today-checklist' }, rows.map((r) => checklistRow(root, r, { reviseCtx, day }, today)))],
  );
}

/** One slim checklist row with its tick. @internal */
function checklistRow(root: HTMLElement, row: DayRow, ctx: { reviseCtx: ReviseCtx; day: PlanDay }, today: string): HTMLElement {
  const view = rowView(row, ctx);
  const done = rowDone(row, today);
  const { label, detail, doneText } = view;

  const box = el('span', { class: 'today-check-box', attrs: { 'aria-hidden': 'true' } }, done ? [icon('check', 14)] : []);
  const isTopic = row.task === 'topic' || row.task === 'missed';
  const tickLabel = isTopic
    ? done ? `${label} is studied — mark as not studied` : `Mark ${label} as studied`
    : done ? `${label} is done — undo` : `${view.tickVerb}: ${label}`;
  const tick = rowManual(row)
    ? el('button', {
        class: done ? 'today-check-tick is-done' : 'today-check-tick',
        type: 'button',
        ariaLabel: tickLabel,
        attrs: { 'aria-pressed': String(done), title: done ? (isTopic ? 'Mark as not studied' : 'Undo') : view.tickVerb },
        onClick: () => {
          toggleRow(row, today);
          render(root);
        },
      }, [box])
    : el('span', { class: done ? 'today-check-tick is-status is-done' : 'today-check-tick is-status', attrs: { title: done ? doneText : 'Ticks itself when you finish' } }, [box]);

  const main = el('button', {
    class: 'today-check-btn',
    type: 'button',
    ariaLabel: `${label}${detail ? ` — ${detail}` : ''}, about ${fmtDuration(view.minutes)}${done ? `, ${doneText}` : ''}`,
    onClick: view.onClick,
  }, [
    el('span', { class: 'today-check-main' }, [
      el('span', { class: 'today-check-label', text: label }),
      detail ? el('span', { class: 'today-check-detail', text: detail }) : null,
    ]),
    done
      ? chip({ text: doneText, tone: 'ok' })
      : chip({ text: fmtDuration(view.minutes), tone: 'muted', iconName: 'timer' }),
    el('span', { class: 'track-row-go' }, [icon('chevron', 16)]),
  ]);
  return el('li', {
    class: done ? 'today-check is-done' : 'today-check',
    attrs: { 'data-kind': row.block.kind, 'data-task': row.task, 'data-done': String(done) },
  }, [tick, main]);
}

/**
 * The next SATURDAY event (week test or full mock) on/after today — a single
 * slim secondary card so the week's checkpoint is visible without the dense
 * grid. Returns `null` when none remain. @internal
 */
function buildNextSaturdayCard(plan: Plan, today: string): HTMLElement | null {
  const day = plan.days.find((d) => {
    if (d.dateISO < today) return false;
    if (dayOfWeek(d.dateISO) !== 6) return false;
    return d.mockPaper !== null || d.blocks.some((b) => b.kind === 'week-test');
  });
  if (!day) return null;

  const isMock = day.mockPaper !== null;
  const label = isMock
    ? day.mockPaper === 'paper1' ? 'Paper-I full mock' : 'Paper-II full mock'
    : 'Week test';
  const detail = day.dateISO === today ? 'today' : prettyDowDate(day.dateISO);
  return card({ title: 'This week\u2019s checkpoint' }, [
    el('div', { class: 'today-checkpoint' }, [
      el('span', { class: 'today-checkpoint-icon' }, [icon('timer', 20)]),
      el('div', { class: 'today-checkpoint-text' }, [
        el('span', { class: 'today-checkpoint-title', text: `${label} · ${detail}` }),
        el('span', { class: 'section-lead', text: isMock ? 'A timed full paper under exam conditions.' : 'Questions from topics you studied, mostly this week.' }),
      ]),
      button({ label: 'Open plan', variant: 'ghost', onClick: () => navigate('/plan') }),
    ]),
  ]);
}

/** Day-of-week (0=Sun … 6=Sat) for an ISO date, UTC-safe. @internal */
function dayOfWeek(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return -1;
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/* -------------------------------------------------------------------------- */
/* Post-prelims Mains section (unchanged behaviour)                            */
/* -------------------------------------------------------------------------- */

/** Full-width "Mains practice" section for the post-Prelims kick-start. @internal */
function buildMainsSection(root: HTMLElement, day: PlanDay | undefined, today: string): HTMLElement {
  const kids: Child[] = [];
  const paper = day?.mainsPaperRevision;
  if (paper) kids.push(buildMainsPaperRevision(paper));
  kids.push(buildMainsToday(day));
  // M9: the qualifying Telugu / English block and the weekly General Essay.
  const rows = languageRows(day);
  if (day && rows.length > 0) {
    const reviseCtx = computeReviseCtx(today, day);
    kids.push(card({ title: 'Languages & essay today' }, [
      el('ul', { class: 'today-checklist' }, rows.map((r) => checklistRow(root, r, { reviseCtx, day: { ...day, dateISO: today } }, today))),
    ]));
  }
  return el('div', { class: 'today-mains' }, kids);
}

/**
 * The post-prelims "Mains revision of what you studied" card for ONE paper
 * (I–V): revisit the mapped Prelims subtopics' For-Mains notes + write their
 * answers (STANDARDS §8a). Links deep into each topic's Learn → Notes (where the
 * collapsed "For Mains" section lives) and into the Mains writing trainer. @internal
 */
function buildMainsPaperRevision(paper: NonNullable<PlanDay['mainsPaperRevision']>): HTMLElement {
  const bank = mainsById();
  const noteLinks = paper.subtopicIds
    .map((id) => ({ id, view: getSubtopic(id) }))
    .filter((x) => x.view !== undefined)
    .slice(0, 6)
    .map(({ id, view }) =>
      el('button', {
        class: 'study-link',
        type: 'button',
        ariaLabel: `Revisit the For Mains note for ${view!.meta.name}`,
        onClick: () => openLearn(id, { tab: 'notes' }),
      }, [
        el('span', { class: 'study-link-name', text: view!.meta.name }),
        el('span', { class: 'track-row-go' }, [icon('chevron', 16)]),
      ]),
    );
  const answerLinks = paper.mainsQuestionIds
    .map((id) => bank.get(id))
    .filter((m): m is MainsItem => m !== undefined)
    .slice(0, 4)
    .map((item) =>
      el('button', {
        class: 'study-link',
        type: 'button',
        ariaLabel: `Write this Mains answer: ${item.question}`,
        onClick: () => openMainsQuestion(item.id),
      }, [
        el('span', { class: 'study-link-name', text: truncate(item.question, 90) }),
        el('span', { class: 'track-row-go' }, [icon('chevron', 16)]),
      ]),
    );
  const body: Child[] = [
    el('span', { class: 'empty-icon' }, [icon('notebook', 24)]),
    el('h3', { class: 'revise-hub-title', text: `${paper.title} — Mains revision of what you studied` }),
    el('p', { class: 'section-lead', text: 'Second cycle: revisit the For-Mains notes of the Prelims topics that feed this paper, then write answers. You already studied the facts for Prelims — now add the Mains angle.' }),
  ];
  if (noteLinks.length > 0) {
    body.push(el('p', { class: 'section-lead today-mains-sub', text: 'Revisit these For-Mains notes:' }));
    body.push(el('div', { class: 'study-list' }, noteLinks));
  }
  if (answerLinks.length > 0) {
    body.push(el('p', { class: 'section-lead today-mains-sub', text: 'Write these answers:' }));
    body.push(el('div', { class: 'study-list' }, answerLinks));
  }
  return el('div', { class: 'card today-mains-card today-mains-paper' }, body);
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

// Shared with the Planner and tests (moved to today-tasks.ts).
export { computeReviseCtx, fmtDuration, startPracticeDrill } from './today-tasks';

/* -------------------------------------------------------------------------- */
/* Graceful-state cards                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Shown before the plan's start date — a small card derived from the plan's
 * FIRST day, so the learner knows exactly what day 1 holds. Day 1 is an
 * ORIENTATION day ("Start here (30 min), Number System, Stone Age"); "Days
 * before the start date are free." @internal
 */
function startsSoonCard(plan: Plan, start: string, today: string): HTMLElement {
  const desc = describeFirstDay(plan, start);
  const headline =
    diffDaysISO(today, start) === 1
      ? `Tomorrow is Day 1 \u2014 ${desc}`
      : `Day 1 is ${prettyDowDate(start)} \u2014 ${desc}`;
  return card({ title: 'Your plan starts soon' }, [
    el('div', { class: 'empty-state' }, [
      el('span', { class: 'empty-icon' }, [icon('sparkles', 26)]),
      el('h3', { text: headline }),
      el('p', { text: `${prettyDowDate(start)} \u00b7 Days before the start date are free \u2014 your progress is kept.` }),
      el('div', { class: 'hero-actions' }, [
        button({ label: 'Start here', variant: 'primary', iconName: 'arrow-right', onClick: () => navigate('/start') }),
        button({ label: 'Open plan', variant: 'ghost', onClick: () => navigate('/plan') }),
      ]),
    ]),
  ]);
}

/**
 * A plain-language description of the plan's FIRST day. Day 1 is an ORIENTATION
 * day — "Start here (30 min), Number System, Stone Age" — derived from its
 * blocks; otherwise the first subject/topic (or mock) scheduled. @internal
 */
function describeFirstDay(plan: Plan, start: string): string {
  const day =
    plan.days.find((d) => d.dateISO === start) ??
    plan.days.find((d) => d.dateISO >= start && d.blocks.length > 0);
  if (!day) return 'your study plan';
  const startHere = day.blocks.find((b) => b.kind === 'start-here');
  if (startHere) {
    const parts: string[] = [`Start here (${startHere.minutes} min)`];
    const ment = day.blocks.find((b) => b.kind === 'ment')?.topics?.[0];
    if (ment) parts.push(ment.name);
    const hist = day.blocks.find((b) => b.kind === 'subject')?.topics?.[0];
    if (hist) parts.push(hist.name);
    return parts.join(', ');
  }
  if (day.mockPaper === 'paper2') return 'Full Paper-II mock';
  if (day.mockPaper === 'paper1') return 'Full Paper-I mock';
  const lead = day.blocks.find((b) => b.kind === 'subject' || b.kind === 'catchup' || b.kind === 'ment');
  if (lead) {
    const topic = lead.topics?.[0];
    return topic ? `${lead.label} · ${topic.name}` : lead.label;
  }
  return day.blocks[0]?.label ?? 'your study plan';
}

/**
 * EXAM DAY (D18): a calm card — the reporting-time reminder, a short
 * checklist and "Good luck". No study rows. @internal
 */
function examDayCard(summary: PlanSummary): HTMLElement {
  return el('section', { class: 'card today-exam-day', attrs: { 'aria-labelledby': 'exam-day-title', 'data-state': 'exam-day' } }, [
    el('div', { class: 'empty-state' }, [
      el('span', { class: 'empty-icon' }, [icon('sparkles', 26)]),
      el('h2', { class: 'card-title', attrs: { id: 'exam-day-title' }, text: `Prelims today \u2014 ${prettyDate(summary.examDateISO)}` }),
      el('p', { text: 'Check the reporting time printed on your hall ticket and reach the centre well before it \u2014 gates close on time.' }),
      el('ul', { class: 'admin-checklist' }, [
        'Hall ticket (printed) + original photo ID',
        'Black / blue ballpoint pens',
        'Water, a watch if allowed \u2014 no phone in the hall',
        'Fill your roll number and series on the OMR first',
        'Read every statement; skip, don\u2019t guess blindly (\u22121/3)',
      ].map((t) => el('li', { text: t }))),
      el('p', { class: 'today-exam-luck', text: 'No new study today. Breathe, eat well, trust your preparation. Good luck!' }),
    ]),
  ]);
}

/** Shown once the exam date has passed. @internal */
function examPassedCard(): HTMLElement {
  return card({ title: 'Prelims day has passed' }, [
    el('div', { class: 'empty-state' }, [
      el('span', { class: 'empty-icon' }, [icon('check', 26)]),
      el('h3', { text: 'Set a new exam date' }),
      el('p', { text: 'Update the target Prelims date in the planner to build a fresh study plan.' }),
      button({ label: 'Open plan', variant: 'primary', iconName: 'arrow-right', onClick: () => navigate('/plan') }),
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
      button({ label: 'Open plan', variant: 'primary', iconName: 'arrow-right', onClick: () => navigate('/plan') }),
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
