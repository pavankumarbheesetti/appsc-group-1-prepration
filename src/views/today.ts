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
import type { MainsItem } from '../content/types';
import { buildSession } from '../engine/drill';
import { selectSession } from '../engine/flashcards';
import { isDue } from '../engine/spaced-repetition';
import { planDayFor, type Plan, type PlanBlock, type PlanDay, type PlanSummary, type PlanTopic } from '../engine/planner';
import { WEEK_TEST_COUNT, WEEK_TEST_MINUTES } from '../engine/mock';
import { navigate } from '../router/router';
import {
  loadState,
  getPrelimsDateMigrationNotice,
  dismissPrelimsDateNotice,
  isAdminDone,
  setAdminDone,
  setPlanStartDate,
  getTeluguLessonsDone,
} from '../state/store';
import { isTopicStudied, markTopicStudied, topicStudyFrom } from '../lib/study-status';
import { lessonForDay, lessonHeadline, lessonProgressLine, lessonTarget } from '../lib/telugu';
import { openTelugu, openTeluguLesson } from './telugu';
import { currentPlan } from '../lib/plan';
import { diffDaysISO, daysToGo, todayISO, addDaysISO } from '../lib/dates';
import { openLearn } from './learn';
import { openMainsQuestion } from './mains';
import { openPaperMock, openWeekTest, openUnitTest } from './mock';
import { collectCuratedCards, openReviseScope } from './revise';
import { mountQuiz } from './quiz';
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
  // Graceful state: the exam date has passed — switch to MAINS kick-start.
  if (summary.daysLeft <= 0) {
    if (summary.postPrelims) {
      const kickstartDay = planDayFor(plan, today) ?? plan.days[0];
      mount(
        root,
        dateNotice,
        buildNowHero(null, summary, today, undefined),
        mainsKickstartCard(),
        buildMainsSection(kickstartDay),
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
  mount(
    root,
    dateNotice,
    buildRecoveryBanner(root, summary, today),
    buildNowHero(root, summary, today, todayDay, reviseCtx),
    ...buildAdminCards(root, today, todayDay),
    allMastered ? masteredCard() : buildChecklist(root, todayDay, reviseCtx),
    allMastered ? null : buildNextSaturdayCard(plan, today),
    buildMainsParallelNote(summary),
  );
}

/* -------------------------------------------------------------------------- */
/* Admin task cards (eligibility gates — STANDARDS §8a)                        */
/* -------------------------------------------------------------------------- */

/** Public portal for the application / hall ticket. @internal */
const PSC_URL = 'https://psc.ap.gov.in';
/** Hall-ticket card appears from this date (watch the portal from ~12 Jan). @internal */
const HALL_TICKET_FROM = '2027-01-12';

/**
 * The compact ADMIN-TASK cards shown on Today (eligibility gates): "Apply
 * online" from plan start until done, "Hall ticket" from ~12 Jan until done, and
 * an exam-day checklist on the light day (exam − 1). Each is a small card with a
 * short checklist and ONE "Mark done" button (toggles `adminDone` via
 * {@link setAdminDone} and re-renders). Returns only the currently-active,
 * not-yet-done cards (possibly none). @internal
 */
function buildAdminCards(root: HTMLElement, today: string, day: PlanDay | undefined): HTMLElement[] {
  const out: HTMLElement[] = [];
  // 1) APPLY ONLINE — from plan start until marked done.
  if (!isAdminDone('apply-online')) {
    out.push(
      adminCard(root, {
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
      }),
    );
  }
  // 2) HALL TICKET — from ~12 Jan until marked done.
  if (today >= HALL_TICKET_FROM && !isAdminDone('hall-ticket')) {
    out.push(
      adminCard(root, {
        id: 'hall-ticket',
        title: 'Hall ticket — download when released',
        lead: 'Watch psc.ap.gov.in from ~12 Jan and download your hall ticket as soon as it is released.',
        checklist: [],
        link: { label: 'Open psc.ap.gov.in', href: PSC_URL },
      }),
    );
  }
  // 3) EXAM-DAY CHECKLIST — only on the light day (exam − 1), until done.
  if (day?.light && !isAdminDone('exam-day')) {
    out.push(
      adminCard(root, {
        id: 'exam-day',
        title: 'Exam-day checklist',
        lead: 'Prelims is tomorrow. Get everything ready tonight.',
        checklist: [
          'Hall ticket (printed) + photo ID',
          'Black / blue ballpoint pens',
          'Reach the centre early',
          'OMR rules: fill bubbles fully, no stray marks',
        ],
      }),
    );
  }
  return out;
}

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
 * RE-AUDIT 2 — the calm "behind" banner (no alarm wording). Shown only when the
 * learner is genuinely behind (`summary.daysBehind ≥ 1`, counted from topics
 * actually marked studied): "You're N days behind — the plan has been
 * adjusted". A secondary action, "I'm only starting now — restart my plan from
 * today", moves the plan start to today after an inline confirm (all progress is
 * kept; the plan is recomputed). Returns `null` when not behind. @internal
 */
function buildRecoveryBanner(root: HTMLElement, summary: PlanSummary, today: string): HTMLElement | null {
  if (summary.daysBehind < 1) return null;
  const n = summary.daysBehind;
  const detail =
    summary.recovery && summary.recoveryChanges.length > 0
      ? `${summary.recoveryChanges.join('; ')}. You can still finish on time.`
      : 'The plan has been rebalanced so you can still finish on time.';
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
  idle();
  return el('section', { class: 'today-banner is-ok today-behind', attrs: { role: 'status' } }, [
    el('span', { class: 'today-banner-icon' }, [icon('calendar', 22)]),
    el('div', { class: 'today-banner-text' }, [
      el('span', {
        class: 'today-banner-title',
        text: `You\u2019re ${n} ${n === 1 ? 'day' : 'days'} behind \u2014 the plan has been adjusted`,
      }),
      el('span', { class: 'today-banner-detail', text: detail }),
      actions,
    ]),
  ]);
}

/* -------------------------------------------------------------------------- */
/* Hero + banner                                                               */
/* -------------------------------------------------------------------------- */
/**
 * The "Now" hero — the single focal point of Today. It names the day's NEXT
 * UNFINISHED row (a topic not yet studied, then the mock / test / Telugu lesson,
 * then the remaining topic-less blocks) and offers ONE primary "Start" that
 * jumps straight into it. For a topic it also offers a "Mark as studied" tick
 * and the hint "Read the notes, do the practice, then tap Mark as studied"; once
 * marked, the hero moves on to the next unfinished row. A compact "N days to
 * Prelims" sits in the eyebrow and a muted "This week: <unit> · day X of Y" line
 * places today in its unit. Before the plan starts / post-exam there is no day,
 * so it falls back to "Open planner" as the primary. @internal
 */
function buildNowHero(
  root: HTMLElement | null,
  summary: PlanSummary,
  today: string,
  day: PlanDay | undefined,
  reviseCtx?: ReviseCtx,
): HTMLElement {
  const daysToExam = daysToGo(summary.examDateISO, today);
  const rows = day ? dayRows(day) : [];
  const focusRow = day && reviseCtx ? nextUnfinishedRow(rows, today) : undefined;
  const focus = focusRow && reviseCtx ? rowView(focusRow, reviseCtx, today) : null;
  const realTopic = focusRow?.topic && focusRow.topic.kind !== 'practice' ? focusRow.topic : undefined;

  const actions: Child[] = focus
    ? [
        button({ label: 'Start', onClick: focus.onClick, variant: 'primary', large: true, iconName: 'arrow-right' }),
        realTopic && root
          ? button({
              label: 'Mark as studied',
              variant: 'secondary',
              iconName: 'check',
              ariaLabel: `Mark ${focus.title} as studied`,
              onClick: () => {
                markTopicStudied(realTopic.subtopicId, true, today);
                render(root);
              },
            })
          : null,
        button({ label: 'Open planner', onClick: () => navigate('/planner'), variant: realTopic ? 'ghost' : 'secondary' }),
      ]
    : [button({ label: 'Open planner', onClick: () => navigate('/planner'), variant: 'primary', large: true, iconName: 'arrow-right' })];

  const allDone = day !== undefined && rows.length > 0 && !focus;
  const left = el('div', { class: 'hero-body' }, [
    el('p', {
      class: 'hero-greeting',
      text: `${greeting(new Date())} · ${daysToExam} ${daysToExam === 1 ? 'day' : 'days'} to Prelims`,
    }),
    el('h2', { class: 'hero-title', text: 'Today' }),
    buildUnitLine(day),
    focus
      ? el('div', { class: 'hero-now' }, [
          el('span', { class: 'hero-now-eyebrow', text: 'Up now' }),
          el('span', { class: 'hero-now-title', text: focus.title }),
          el('span', { class: 'hero-now-meta' }, [
            el('span', { text: focus.context }),
            chip({ text: fmtDuration(focus.minutes), tone: 'default', iconName: 'timer' }),
          ]),
          el('span', {
            class: 'hero-now-hint',
            text: realTopic ? 'Read the notes, do the practice, then tap Mark as studied' : focus.hint,
          }),
        ])
      : allDone
        ? el('div', { class: 'hero-now' }, [
            el('span', { class: 'hero-now-eyebrow', text: 'All done' }),
            el('span', { class: 'hero-now-title', text: 'Today\u2019s topics are studied \u2713' }),
          ])
        : null,
    el('div', { class: 'hero-actions' }, actions),
  ]);

  return el('section', { class: 'hero' }, [left]);
}

/**
 * The muted "This week: <unit title> · day X of Y" line that places today in
 * its weekly subject unit. Returns `null` when the day carries no unit (mock /
 * final / light / pre-start). @internal
 */
function buildUnitLine(day: PlanDay | undefined): HTMLElement | null {
  if (!day || !day.unitId || !day.unitTitle) return null;
  const text = `This week: ${unitShortTitle(day.unitTitle)} · day ${day.unitDay} of ${day.unitDays}`;
  return el('p', { class: 'hero-unit-line', text });
}

/**
 * The short, beginner-friendly unit name — the part before the em-dash of a
 * unit title (e.g. "Ancient India I — Stone Age …" → "Ancient India I"). Falls
 * back to the whole title when there is no dash. @internal
 */
function unitShortTitle(title: string): string {
  const i = title.indexOf('\u2014');
  return (i > 0 ? title.slice(0, i) : title).trim();
}

/* -------------------------------------------------------------------------- */
/* The day's rhythm blocks (slim checklist)                                    */
/* -------------------------------------------------------------------------- */

/** Format minutes as a compact `3 h 50 m` / `50 m` / `4 h` label. @internal */
export function fmtDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h === 0) return `${m} m`;
  return m === 0 ? `${h} h` : `${h} h ${m} m`;
}

/**
 * The REVISE context for a day. Before ~10 curated cards are due for a scheduled
 * recall, the weekday Revise block becomes an EARLY-REVISE block scoped to what
 * the learner has ACTUALLY studied (never the plan's schedule):
 *   - `previous` — cards of topics marked studied on PREVIOUS days, most recent
 *     first ("Review yesterday's flashcards" when the newest is yesterday);
 *   - `today`    — none before today, but today's topic(s) are now studied →
 *     "Flashcards for today's topic" opens their cards;
 *   - `waiting`  — nothing studied yet → "Flashcards for today's topic — after
 *     you mark it studied", with a short explanation instead of cards.
 * `none` = not early (the block opens the full studied-only Revise deck). @internal
 */
interface ReviseCtx {
  early: boolean;
  mode: 'none' | 'previous' | 'today' | 'waiting';
  /** Subtopic ids (studied, with curated cards) the early session is scoped to. */
  ids: string[];
  /** Row label for the early block. */
  label: string;
  /** Row detail (topic names, or the explanation while waiting). */
  detail: string;
  /** Today's main topic (the waiting state links to its Learn page). */
  mainTopicId?: string;
}

/**
 * How many curated cards of STUDIED topics are DUE for a SCHEDULED recall right
 * now — cards already reviewed at least once (they carry a spaced-repetition
 * entry) whose next review has come due. Never-reviewed cards and cards of
 * unstudied topics are not counted. @internal
 */
function curatedDueCount(): number {
  const sr = loadState().flashcards;
  const now = Date.now();
  let n = 0;
  for (const c of collectCuratedCards()) {
    const entry = sr[c.id];
    if (entry && isDue(entry, now)) n += 1;
  }
  return n;
}

/** Names of `ids` as "A +N more". @internal */
function namesLine(ids: readonly string[]): string {
  const names = ids.map((id) => getSubtopic(id)?.meta.name ?? id);
  if (names.length === 0) return '';
  return names.length > 1 ? `${names[0]} +${names.length - 1} more` : names[0]!;
}

/** The day's main topic: the first real topic of its subject block (else any block). @internal */
function mainTopicOf(day: PlanDay | undefined): string | undefined {
  if (!day) return undefined;
  const real = (b: PlanBlock): PlanTopic | undefined => (b.topics ?? []).find((t) => t.kind !== 'practice');
  const subject = day.blocks.find((b) => b.kind === 'subject' && real(b));
  return (subject ? real(subject) : day.blocks.map(real).find((t) => t !== undefined))?.subtopicId;
}

/**
 * Build the revise context for `today` from the learner's STUDY STATUS: topics
 * marked studied before today (most recent first), else today's studied topics,
 * else the waiting explanation. Exported for tests.
 */
export function computeReviseCtx(today: string, day?: PlanDay): ReviseCtx {
  const EARLY_THRESHOLD = 10;
  const early = curatedDueCount() < EARLY_THRESHOLD;
  const mainTopicId = mainTopicOf(day);
  if (!early) return { early, mode: 'none', ids: [], label: '', detail: '', mainTopicId };

  const state = loadState();
  const studied = getSubtopics()
    .filter((s) => getCards(s.id).length > 0)
    .map((s) => ({ id: s.id, info: topicStudyFrom(state, s.id) }))
    .filter((x) => x.info.status === 'studied');

  // Studied on PREVIOUS days (an unknown date counts as earlier), newest first.
  const previous = studied
    .filter((x) => (x.info.studiedOn ?? '') < today)
    .sort((a, b) => (b.info.studiedOn ?? '').localeCompare(a.info.studiedOn ?? ''));
  if (previous.length > 0) {
    const ids = previous.map((x) => x.id);
    const newest = previous[0]!.info.studiedOn;
    const label = newest === addDaysISO(today, -1)
      ? 'Review yesterday\u2019s flashcards'
      : 'Review flashcards of what you studied';
    return { early, mode: 'previous', ids, label, detail: namesLine(ids), mainTopicId };
  }

  // Nothing before today: today's studied topics (the main topic first).
  const todays = studied.filter((x) => x.info.studiedOn === today || x.info.studiedOn === undefined).map((x) => x.id);
  if (todays.length > 0) {
    const ids = mainTopicId && todays.includes(mainTopicId) ? [mainTopicId, ...todays.filter((id) => id !== mainTopicId)] : todays;
    return { early, mode: 'today', ids, label: 'Flashcards for today\u2019s topic', detail: namesLine(ids), mainTopicId };
  }

  const mainName = mainTopicId ? getSubtopic(mainTopicId)?.meta.name ?? mainTopicId : 'today\u2019s topic';
  return {
    early,
    mode: 'waiting',
    ids: [],
    label: 'Flashcards for today\u2019s topic \u2014 after you mark it studied',
    detail: `Cards only come from topics you have studied. Mark ${mainName} studied and its flashcards open here.`,
    mainTopicId,
  };
}

/**
 * One checklist ROW: a block, or ONE topic of a multi-topic block (so every
 * topic gets its own "Mark as studied" tick). @internal
 */
interface DayRow {
  block: PlanBlock;
  /** The topic this row teaches (absent for topic-less blocks). */
  topic?: PlanTopic;
}

/** Flatten a day's blocks into checklist rows (one per real topic). @internal */
function dayRows(day: PlanDay): DayRow[] {
  const out: DayRow[] = [];
  for (const block of day.blocks) {
    const topics = block.topics ?? [];
    const real = topics.filter((t) => t.kind !== 'practice');
    if (real.length > 0) for (const topic of real) out.push({ block, topic });
    else out.push({ block, topic: topics[0] });
  }
  return out;
}

/** Whether a row is FINISHED: its topic is studied / its Telugu lesson done today. @internal */
function rowDone(row: DayRow, today: string): boolean {
  if (row.topic) return row.topic.kind !== 'practice' && isTopicStudied(row.topic.subtopicId);
  if (row.block.kind === 'telugu') return lessonForDay(getTeluguLessonsDone(), today).doneToday;
  return false;
}

/** Kinds the hero visits first (trackable work), before the topic-less extras. @internal */
const PRIMARY_KINDS: ReadonlySet<string> = new Set(['mock', 'week-test', 'unit-wrapup', 'telugu']);

/**
 * The hero's row: the first unfinished topic / mock / test / Telugu lesson in
 * day order, else the first remaining topic-less block (revise, CA, …) after
 * the last finished row. `undefined` when everything trackable is done and no
 * extras remain. @internal
 */
function nextUnfinishedRow(rows: readonly DayRow[], today: string): DayRow | undefined {
  const primary = rows.find((r) => {
    if (r.topic && r.topic.kind !== 'practice') return !rowDone(r, today);
    if (!r.topic && PRIMARY_KINDS.has(r.block.kind)) return !rowDone(r, today);
    return false;
  });
  if (primary) return primary;
  return rows.find((r) => !rowDone(r, today) && !(r.topic && r.topic.kind !== 'practice') && !PRIMARY_KINDS.has(r.block.kind));
}

/** What a row shows + does (label, detail, minutes, start). @internal */
interface RowView {
  /** Row label (block label, or the early-revise / Telugu lesson label). */
  label: string;
  /** Hero title (topic / lesson / block name). */
  title: string;
  /** Hero context line. */
  context: string;
  detail: string;
  minutes: number;
  onClick: () => void;
  /** A one-line "what to do" hint for non-topic rows. */
  hint: string;
}

/** Resolve a row's labels and start action. @internal */
function rowView(row: DayRow, reviseCtx: ReviseCtx, today: string): RowView {
  const { block, topic } = row;
  if (topic) {
    if (topic.kind === 'practice') {
      return {
        label: block.label,
        title: 'Mental Ability practice',
        context: block.label,
        detail: topicSummary([topic]),
        minutes: topic.estMinutes || block.minutes,
        onClick: () => startPracticeDrill(topic.practiceSubtopicIds ?? [], topic.mcqCount > 0 ? topic.mcqCount : 20),
        hint: 'A mixed set from topics you have covered.',
      };
    }
    const name = topic.name || getSubtopic(topic.subtopicId)?.meta.name || topic.subtopicId;
    const id = topic.subtopicId;
    const mains = topic.mainsAngle ? ' \u00b7 incl. For Mains note (+5 min)' : '';
    return {
      // The TOPIC leads the row (it is what gets ticked); the block is context.
      label: name,
      title: name,
      context: block.label,
      detail: `${unitShortTitle(block.label)}${mains}`,
      minutes: topic.estMinutes || block.minutes,
      onClick: () => openLearn(id),
      hint: '',
    };
  }
  if (block.kind === 'telugu') {
    const { lesson } = lessonForDay(getTeluguLessonsDone(), today);
    if (lesson) {
      const id = lesson.id;
      return {
        label: lessonProgressLine(lesson),
        title: lessonHeadline(lesson),
        context: lessonProgressLine(lesson),
        detail: `${lessonHeadline(lesson)} \u00b7 ${lessonTarget(lesson)}`,
        minutes: block.minutes,
        onClick: () => openTeluguLesson(id),
        hint: `Target: ${lessonTarget(lesson)}`,
      };
    }
    return {
      label: block.label,
      title: 'Telugu practice',
      context: block.label,
      detail: 'All lessons done \u2014 trace words and sentences',
      minutes: block.minutes,
      onClick: () => openTelugu('words'),
      hint: 'Keep your hand in: trace a few words and sentences.',
    };
  }
  if (block.kind === 'revise' && reviseCtx.early) {
    const ids = reviseCtx.ids;
    const main = reviseCtx.mainTopicId;
    return {
      label: reviseCtx.label,
      title: reviseCtx.label,
      context: block.label,
      detail: reviseCtx.detail,
      minutes: block.minutes,
      onClick: reviseCtx.mode === 'waiting'
        ? () => (main ? openLearn(main) : navigate('/revise'))
        : () => openReviseScope(ids),
      hint: reviseCtx.mode === 'waiting' ? reviseCtx.detail : 'Recall each answer before you peek.',
    };
  }
  const nav = blockStart(block);
  const nowTitle =
    block.kind === 'mock' && block.mockPaper
      ? block.mockPaper === 'paper1' ? 'Full Paper-I mock' : 'Full Paper-II mock'
      : block.kind === 'week-test' ? 'This week\u2019s test' : block.label;
  return {
    label: block.label,
    title: nowTitle,
    context: block.kind === 'week-test' ? `${WEEK_TEST_COUNT} questions` : block.label,
    detail: blockDetail(block),
    minutes: block.minutes,
    onClick: nav,
    hint: blockDetail(block),
  };
}

/**
 * The day's rhythm as a SLIM ORDERED CHECKLIST — one row per block, and one row
 * per topic of a multi-topic block. Each row one-taps into its study target;
 * a topic row carries a "Mark as studied" tick and shows "Studied ✓" once done.
 * @internal
 */
function buildChecklist(root: HTMLElement, day: PlanDay | undefined, reviseCtx: ReviseCtx): HTMLElement {
  const blocks = day?.blocks ?? [];
  if (!day || blocks.length === 0) {
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
  return card(
    {
      title: 'Today\u2019s plan',
      subtitle: budget > 0 ? `${fmtDuration(planned)} of ${fmtDuration(budget)}` : undefined,
    },
    [el('ul', { class: 'today-checklist' }, dayRows(day).map((r) => checklistRow(root, r, reviseCtx, today)))],
  );
}

/** One slim checklist row (+ a "Mark as studied" tick for a topic). @internal */
function checklistRow(root: HTMLElement, row: DayRow, reviseCtx: ReviseCtx, today: string): HTMLElement {
  const view = rowView(row, reviseCtx, today);
  const done = rowDone(row, today);
  const { label, detail } = view;
  const topic = row.topic && row.topic.kind !== 'practice' ? row.topic : undefined;
  const doneText = row.block.kind === 'telugu' ? 'Done \u2713' : 'Studied \u2713';

  const kids: Child[] = [
    el('button', {
      class: 'today-check-btn',
      type: 'button',
      ariaLabel: `${label}${detail ? ` — ${detail}` : ''}, about ${fmtDuration(view.minutes)}${done ? `, ${doneText}` : ''}`,
      onClick: view.onClick,
    }, [
      topic ? null : el('span', { class: 'today-check-box', attrs: { 'aria-hidden': 'true' } }, done ? [icon('check', 14)] : []),
      el('span', { class: 'today-check-main' }, [
        el('span', { class: 'today-check-label', text: label }),
        detail ? el('span', { class: 'today-check-detail', text: detail }) : null,
      ]),
      done
        ? chip({ text: doneText, tone: 'ok' })
        : chip({ text: fmtDuration(view.minutes), tone: 'muted', iconName: 'timer' }),
      el('span', { class: 'track-row-go' }, [icon('chevron', 16)]),
    ]),
  ];
  if (topic) {
    const name = topic.name || getSubtopic(topic.subtopicId)?.meta.name || topic.subtopicId;
    const tick = el('button', {
      class: done ? 'today-check-tick is-done' : 'today-check-tick',
      type: 'button',
      ariaLabel: done ? `${name} is studied — mark as not studied` : `Mark ${name} as studied`,
      attrs: { 'aria-pressed': String(done), title: done ? 'Mark as not studied' : 'Mark as studied' },
      onClick: () => {
        markTopicStudied(topic.subtopicId, !done, today);
        render(root);
      },
    }, [el('span', { class: 'today-check-box', attrs: { 'aria-hidden': 'true' } }, done ? [icon('check', 14)] : [])]);
    kids.unshift(tick);
  }
  return el('li', { class: done ? 'today-check is-done' : 'today-check', attrs: { 'data-kind': row.block.kind } }, kids);
}

/** A compact "first topic (+N more)" detail line for a block's topics. @internal */
function topicSummary(topics: readonly PlanTopic[]): string {
  const first = topics[0]!;
  const name = first.kind === 'practice'
    ? 'Mental Ability practice'
    : first.name || getSubtopic(first.subtopicId)?.meta.name || first.subtopicId;
  const base = topics.length > 1 ? `${name} +${topics.length - 1} more` : name;
  // Revision cycle: flag when the revisit includes the +5-min For-Mains read.
  return topics.some((t) => t.mainsAngle) ? `${base} · incl. For Mains note (+5 min)` : base;
}

/** A plain-language detail line for a topic-less block. @internal */
function blockDetail(block: PlanBlock): string {
  switch (block.kind) {
    case 'ca':
    case 'ca-refresh':
    case 'ca-roundup':
      return 'Current affairs';
    case 'mock':
      return block.mockPaper === 'paper1' ? 'Full Paper-I mock' : block.mockPaper === 'paper2' ? 'Full Paper-II mock' : 'Full mock';
    case 'week-test':
      return `${WEEK_TEST_COUNT} questions · ${WEEK_TEST_MINUTES} min`;
    case 'mock-review':
    case 'week-test-review':
      return 'Review your wrong answers';
    case 'weakest-area':
    case 'catchup':
      return 'Weak areas';
    case 'telugu':
      return 'Telugu practice';
    case 'unit-wrapup':
      return block.unitTestCount && block.unitTestCount > 0
        ? `Recap + ${block.unitTestCount}-question unit test`
        : 'Recap your finished unit';
    case 'light':
      return 'Key facts — keep it light';
    case 'start-here':
      return 'Orientation guide';
    case 'revise':
      return 'Flashcards of topics you have studied';
    default:
      return '';
  }
}

/** The one-tap start handler for a topic-less block. @internal */
function blockStart(block: PlanBlock): () => void {
  switch (block.kind) {
    case 'ca':
    case 'ca-refresh':
    case 'ca-roundup': {
      const sid = block.caSubtopicId;
      return () => (sid ? openLearn(sid) : navigate('/drill'));
    }
    case 'mock': {
      const paper = block.mockPaper;
      return () => (paper ? openPaperMock(paper) : navigate('/mock'));
    }
    case 'mock-review':
    case 'week-test-review':
      return () => navigate('/notebook');
    case 'weakest-area':
    case 'catchup':
      return () => navigate('/progress');
    case 'week-test':
      return () => openWeekTest(block);
    case 'unit-wrapup':
      return () => openUnitTest(block);
    case 'revise':
    case 'targeted-revision':
    case 'weekly-revision':
      return () => navigate('/revise');
    case 'telugu':
      return () => navigate('/languages');
    case 'ment-practice':
      return () => startPracticeDrill(block.practiceSubtopicIds ?? [], 20);
    case 'start-here':
      return () => navigate('/start');
    default:
      return () => navigate('/planner');
  }
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
        el('span', { class: 'section-lead', text: isMock ? 'A timed full paper under exam conditions.' : 'Questions drawn mostly from this week\u2019s unit.' }),
      ]),
      button({ label: 'Open planner', variant: 'ghost', onClick: () => navigate('/planner') }),
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
function buildMainsSection(day: PlanDay | undefined): HTMLElement {
  const kids: Child[] = [];
  const paper = day?.mainsPaperRevision;
  if (paper) kids.push(buildMainsPaperRevision(paper));
  kids.push(buildMainsToday(day));
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
  // Only cards of topics the learner has studied are ever due.
  const deck = collectCuratedCards();
  return selectSession(deck, loadState().flashcards, Date.now()).length;
}

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
        button({ label: 'Open planner', variant: 'ghost', onClick: () => navigate('/planner') }),
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
