/**
 * Planner — the exam-date-driven weekly RHYTHM schedule (route `#/planner`).
 *
 * The header carries an EDITABLE exam-date input (default 24 Jan 2027) that
 * recomputes the plan live, a countdown, and a one-line FEASIBILITY read-out.
 * Below it:
 *   - Prelims coverage (material / studied / mastered);
 *   - a plain-language FIT summary — daily budget, mock count, coverage-end date
 *     and a per-subject row ("History · 47 topics · 40 full · 7 quick, done by
 *     2 Nov"), plus any spill/reallocation notes;
 *   - per-subject PROGRESS ("History 12/47 · next: Mauryan Empire");
 *   - a WEEKLY GRID (weeks × Mon–Sun): each day's subject + topics with FULL /
 *     "Quick pass" badges, mock days highlighted, revise/CA/Telugu markers.
 * On mobile the grid stacks into a single column. All numbers come from the
 * pure rhythm engine.
 */
import { type Plan, type PlanBlock, type PlanDay, type PlanSummary, type PlanTopic, type SubjectFit } from '../engine/planner';
import { getLearningSequence, getSubtopic, getSubtopics } from '../content/loader';
import { SUBJECTS, type SubjectCode } from '../content/types';
import { getPlanStartDate } from '../state/store';
import { currentPlan } from '../lib/plan';
import { mockSectionPools } from '../lib/plan';
import { mockSeriesLength } from '../engine/mock';
import { PAPER_I, PAPER_II } from '../lib/exam-pattern';
import { loadState } from '../state/store';
import { subtopicMasteryPct } from '../lib/metrics';
import { daysToGo, diffDaysISO, todayISO } from '../lib/dates';
import { el, mount, type Child } from './dom';
import { card } from './components/card';
import { chip } from './components/chip';
import { progressBar } from './components/progress';
import { icon } from './components/icon';
import { navigate } from '../router/router';
import { openLearn } from './learn';
import { openPaperMock, openWeekTest, openUnitTest } from './mock';
import { prettyDate, prettyDowDate, fmtDuration, startPracticeDrill } from './today';

/** Render the Planner view into `root`. */
export function render(root: HTMLElement): void {
  const now = new Date();
  const plan = currentPlan(now);
  const summary = plan.summary;
  if (summary.postPrelims) {
    mount(root, buildHeader(summary), buildPostPrelims(plan));
    return;
  }
  mount(
    root,
    buildHeader(summary),
    buildRecoveryBanner(summary),
    buildUnitHeader(plan),
    buildThisWeek(plan),
    buildRoadStrip(plan),
    buildAllWeeks(plan),
    buildPlanDetails(summary),
  );
}

/* -------------------------------------------------------------------------- */
/* Header: countdown + plain feasibility (exam date lives in Settings)         */
/* -------------------------------------------------------------------------- */

/**
 * Header with the countdown and a PLAIN-language fit line. The editable exam
 * date was removed (it duplicated the Settings control); a "Change in Settings"
 * link is offered instead. @internal
 */
function buildHeader(summary: PlanSummary): HTMLElement {
  const today = todayISO();
  const daysToExam = daysToGo(summary.examDateISO, today);

  const fit = summary.onTrack
    ? `On track — new topics finish by ${prettyDate(summary.coverageEndISO)}.`
    : `Behind by ${summary.behindBy} topic${summary.behindBy === 1 ? '' : 's'} — a little more each day catches up before ${prettyDate(summary.examDateISO)}.`;

  const feasibility = el('p', {
    class: summary.onTrack ? 'feasibility is-ok' : 'feasibility is-warn',
    attrs: { role: 'status' },
  }, [
    icon(summary.onTrack ? 'check' : 'flame', 16),
    el('span', { text: fit }),
  ]);

  const examLine = el('p', { class: 'planner-exam-line section-lead' }, [
    el('span', { text: `Prelims · ${prettyDate(summary.examDateISO)} · ` }),
    el('button', {
      class: 'link-btn',
      type: 'button',
      text: 'Change in Settings',
      onClick: () => navigate('/settings'),
    }),
  ]);

  const countdownCard = el('div', { class: 'countdown countdown-sm' }, [
    el('div', { class: 'countdown-days tnum', text: String(daysToExam) }),
    el('div', { class: 'countdown-unit', text: daysToExam === 1 ? 'day to Prelims' : 'days to Prelims' }),
    el('div', { class: 'countdown-label', text: `Prelims · ${prettyDate(summary.examDateISO)}` }),
  ]);

  const left = el('div', { class: 'hero-body' }, [
    el('h2', { class: 'hero-title', text: 'Study planner' }),
    feasibility,
    examLine,
  ]);

  return el('section', { class: 'hero planner-hero' }, [left, countdownCard]);
}

/**
 * RE-AUDIT 2 — the calm RECOVERY banner on the Planner (no alarm wording),
 * shown only when the learner is genuinely behind (`summary.daysBehind ≥ 1`) and
 * the plan was adjusted to stay feasible. Returns `null` otherwise. @internal
 */
function buildRecoveryBanner(summary: PlanSummary): HTMLElement | null {
  if (!summary.recovery || summary.daysBehind < 1) return null;
  const n = summary.daysBehind;
  const detail =
    summary.recoveryChanges.length > 0
      ? `${summary.recoveryChanges.join('; ')}. You can still finish on time.`
      : 'The plan has been rebalanced so you can still finish on time.';
  return el('section', { class: 'feasibility is-ok', attrs: { role: 'status' } }, [
    icon('calendar', 16),
    el('span', {
      text: `You\u2019re ${n} ${n === 1 ? 'day' : 'days'} behind \u2014 the plan has been adjusted: ${detail}`,
    }),
  ]);
}

/* -------------------------------------------------------------------------- */
/* This week — the default view (unit header + 7-row table)                    */
/* -------------------------------------------------------------------------- */

/** The 7-day week that contains today (or the first upcoming/first week). @internal */
function thisWeekDays(plan: Plan): PlanDay[] {
  if (plan.days.length === 0) return [];
  const anchor =
    plan.days.find((d) => d.status === 'today') ??
    plan.days.find((d) => d.status === 'upcoming') ??
    plan.days[0]!;
  const w = Math.floor(anchor.dayIndex / 7);
  return plan.days.filter((d) => Math.floor(d.dayIndex / 7) === w);
}

/** The short unit name — the part before the em-dash (e.g. "Ancient India I"). @internal */
function unitShortTitle(title: string): string {
  const i = title.indexOf('\u2014');
  return (i > 0 ? title.slice(0, i) : title).trim();
}

/**
 * The unit header for the current week: the unit being taught, its day index in
 * the unit run, and a muted "Next week" line. @internal
 */
function buildUnitHeader(plan: Plan): HTMLElement | null {
  const week = thisWeekDays(plan);
  const unitDay = week.find((d) => d.unitId && d.status !== 'past') ?? week.find((d) => d.unitId);
  if (!unitDay || !unitDay.unitTitle) return null;

  const title = unitShortTitle(unitDay.unitTitle);
  const subtitle = unitDay.unitTitle.includes('\u2014')
    ? unitDay.unitTitle.slice(unitDay.unitTitle.indexOf('\u2014') + 1).trim()
    : '';

  const children: Child[] = [
    el('span', { class: 'unit-head-eyebrow', text: 'This week' }),
    el('h3', { class: 'unit-head-title', text: title }),
    subtitle ? el('p', { class: 'unit-head-sub section-lead', text: subtitle }) : null,
    el('p', { class: 'unit-head-progress tnum', text: `Day ${unitDay.unitDay} of ${unitDay.unitDays}` }),
  ];
  if (unitDay.nextUnitTitle) {
    children.push(el('p', { class: 'unit-head-next section-lead', text: `Next: ${unitShortTitle(unitDay.nextUnitTitle)}` }));
  }
  return el('section', { class: 'card unit-head' }, children);
}

/** Human focus (label + topic names) for one day in the week table. @internal */
function dayFocus(day: PlanDay): { label: string; topics: string } {
  if (day.mockPaper) {
    return { label: day.mockPaper === 'paper1' ? 'Paper-I full mock' : 'Paper-II full mock', topics: '' };
  }
  if (day.blocks.some((b) => b.kind === 'week-test')) return { label: 'Week test', topics: '' };
  if (day.dayOff) return { label: 'Day off', topics: 'Current Affairs + flashcards' };
  if (day.light) return { label: 'Light day', topics: '' };
  if (day.blocks.length === 0) return { label: 'Rest', topics: '' };
  const names = day.topics.map((t) => (t.kind === 'practice' ? 'Mental Ability practice' : t.name || t.subtopicId));
  const label = day.unitTitle ? unitShortTitle(day.unitTitle) : (day.blocks[0]?.label ?? 'Study');
  // Revision cycle: flag a day whose revisit carries the +5-min For-Mains read.
  const mainsAngle = day.blocks.some((b) => (b.topics ?? []).some((t) => t.mainsAngle));
  let topics = names.join(', ');
  if (mainsAngle) topics = topics ? `${topics} · incl. For Mains note` : 'incl. For Mains note';
  return { label, topics };
}

/** Day-of-week short label from an ISO date (shared with the full grid below). */

/**
 * The default THIS-WEEK table: 7 rows of `day · focus · topics · minutes`, the
 * today-row highlighted. Replaces the dense 15-week grid as the landing view.
 * @internal
 */
function buildThisWeek(plan: Plan): HTMLElement {
  const week = thisWeekDays(plan);
  if (week.length === 0) {
    return card({ title: 'This week' }, [
      el('p', { class: 'section-lead', text: 'No days to plan — set an exam date in the future (Settings).' }),
    ]);
  }
  const start = getPlanStartDate();
  const rows = week.map((day) => {
    const preStart = diffDaysISO(day.dateISO, start) > 0;
    const focus = preStart ? { label: 'Free day', topics: 'Plan starts soon' } : dayFocus(day);
    const cls = ['pw-row', `is-${day.status}`];
    if (day.mockPaper || day.blocks.some((b) => b.kind === 'week-test')) cls.push('is-event');
    return el('tr', { class: cls.join(' ') }, [
      el('th', { attrs: { scope: 'row' }, class: 'pw-day' }, [
        el('span', { class: 'pw-dow', text: dowLabel(day.dateISO) }),
        el('span', { class: 'pw-date tnum', text: prettyDate(day.dateISO).replace(/ \d{4}$/, '') }),
        day.status === 'today' ? chip({ text: 'Today', tone: 'ok' }) : null,
      ]),
      el('td', { class: 'pw-focus' }, [
        el('span', { class: 'pw-focus-label', text: focus.label }),
        focus.topics ? el('span', { class: 'pw-focus-topics', text: focus.topics }) : null,
      ]),
      el('td', { class: 'pw-min tnum', text: preStart ? '—' : fmtDuration(day.plannedMinutes) }),
    ]);
  });

  const table = el('table', { class: 'planner-week-table' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { attrs: { scope: 'col' }, text: 'Day' }),
        el('th', { attrs: { scope: 'col' }, text: 'Focus' }),
        el('th', { attrs: { scope: 'col' }, text: 'Time' }),
      ]),
    ]),
    el('tbody', {}, rows),
  ]);
  return el('section', { class: 'card planner-week' }, [
    el('h3', { class: 'card-title', text: 'This week' }),
    table,
  ]);
}

/* -------------------------------------------------------------------------- */
/* Road to the exam — collapsible phase/unit/event strip                       */
/* -------------------------------------------------------------------------- */

/**
 * A collapsible "Road to <exam date>" strip: the study PHASES as date-ranged
 * bands, every weekly subject UNIT as a labelled segment, and the Saturday
 * checkpoints (week tests + full mocks). Collapsed by default. @internal
 */
function buildRoadStrip(plan: Plan): HTMLElement {
  const summary = plan.summary;
  const details = el('details', { class: 'road-strip' }) as HTMLDetailsElement;

  const unitSegs = summary.units.map((u) =>
    el('li', { class: 'road-unit', attrs: { title: `${u.title} · ${u.topicCount} topics` } }, [
      el('span', { class: 'road-unit-name', text: unitShortTitle(u.title) }),
      el('span', { class: 'road-unit-dates tnum', text: `${prettyDate(u.startISO).replace(/ \d{4}$/, '')}–${prettyDate(u.endISO).replace(/ \d{4}$/, '')}` }),
    ]),
  );

  const events = summary.mockList.map((m) =>
    el('li', { class: 'road-event' }, [
      icon('timer', 13),
      el('span', { text: `${prettyDate(m.dateISO).replace(/ \d{4}$/, '')} · ${m.paper === 'paper1' ? 'Paper-I' : 'Paper-II'} mock` }),
    ]),
  );
  const weekTestCount = plan.days.filter((d) => d.blocks.some((b) => b.kind === 'week-test')).length;

  details.append(
    el('summary', { class: 'road-summary' }, [
      el('span', { class: 'road-summary-title', text: `Road to ${prettyDate(summary.examDateISO)}` }),
      el('span', { class: 'section-lead', text: `${summary.units.length} units · ${weekTestCount} week tests · ${summary.mockSittings} full mocks` }),
      icon('chevron', 16),
    ]),
    el('div', { class: 'road-body' }, [
      el('p', { class: 'road-phase-line section-lead', text: phaseLine(summary) }),
      el('h4', { class: 'road-subhead', text: 'Units, in order' }),
      el('ol', { class: 'road-units' }, unitSegs),
      events.length > 0 ? el('h4', { class: 'road-subhead', text: 'Saturday checkpoints' }) : null,
      events.length > 0 ? el('ul', { class: 'road-events' }, events) : null,
    ]),
  );
  return details;
}

/** A plain-language phase line derived from the segment day counts. @internal */
function phaseLine(summary: PlanSummary): string {
  const parts: string[] = [];
  if (summary.coverageDays > 0) parts.push(`learn new topics to ${prettyDate(summary.coverageEndISO)}`);
  if (summary.revisionDays > 0) parts.push(`revise everything (${summary.revisionDays} days)`);
  if (summary.finalDays > 0) parts.push(`final mocks + polish (${summary.finalDays} days)`);
  return parts.length > 0 ? `Phases: ${parts.join(' → ')}.` : '';
}

/* -------------------------------------------------------------------------- */
/* See all weeks — the full grid, lazy behind a disclosure                     */
/* -------------------------------------------------------------------------- */

/** The full 15-week grid, rendered only when "See all weeks" is opened. @internal */
function buildAllWeeks(plan: Plan): HTMLElement {
  const details = el('details', { class: 'all-weeks' }) as HTMLDetailsElement;
  const summaryRow = el('summary', { class: 'all-weeks-summary' }, [
    el('span', { text: 'See all weeks' }),
    icon('chevron', 16),
  ]);
  details.append(summaryRow);
  let built = false;
  details.addEventListener('toggle', () => {
    if (details.open && !built) {
      details.append(buildGrid(plan));
      built = true;
    }
  });
  return details;
}

/* -------------------------------------------------------------------------- */
/* Plan details — coverage + fit + per-subject, folded into one disclosure     */
/* -------------------------------------------------------------------------- */

/** The former coverage/fit/subject cards, collapsed into one "Plan details". @internal */
function buildPlanDetails(summary: PlanSummary): HTMLElement {
  const details = el('details', { class: 'plan-details' }) as HTMLDetailsElement;
  details.append(
    el('summary', { class: 'plan-details-summary' }, [
      el('span', { text: 'Plan details' }),
      icon('chevron', 16),
    ]),
    el('div', { class: 'plan-details-body' }, [
      buildCoverage(summary),
      buildFitSummary(summary),
      buildSubjectProgress(summary),
    ]),
  );
  return details;
}

/** Post-prelims kick-start: intro + the first-4-weeks per-paper Mains revision. @internal */
function buildPostPrelims(plan: Plan): HTMLElement {
  const intro = card({ title: 'Mains kick-start' }, [
    el('p', { class: 'section-lead', text: 'Prelims is behind you \u2014 the second cycle. The first four weeks are Mains revision of what you studied: per Mains paper (I\u2013V), revisit the mapped topics\u2019 For-Mains notes and write answers. The weekly General Essay and the qualifying Telugu / English blocks run alongside.' }),
  ]);
  // The distinct papers scheduled across the first four weeks, in first-seen order.
  const seen = new Map<string, NonNullable<PlanDay['mainsPaperRevision']>>();
  for (const d of plan.days) {
    const pr = d.mainsPaperRevision;
    if (pr && !seen.has(pr.paper)) seen.set(pr.paper, pr);
  }
  if (seen.size === 0) return intro;
  const rows = [...seen.values()].map((pr) =>
    el('li', { class: 'planner-mains-paper' }, [
      el('span', { class: 'planner-mains-paper-title', text: pr.title }),
      el('span', { class: 'section-lead', text: `${pr.subtopicIds.length} topic${pr.subtopicIds.length === 1 ? '' : 's'} to revisit \u00b7 ${pr.mainsQuestionIds.length} answer${pr.mainsQuestionIds.length === 1 ? '' : 's'} to write` }),
    ]),
  );
  const papersCard = card({ title: 'Mains revision of what you studied (first 4 weeks)' }, [
    el('p', { class: 'section-lead', text: 'One paper per day, cycling through all five. Open Today to start the current paper.' }),
    el('ul', { class: 'planner-mains-papers' }, rows),
  ]);
  return el('div', {}, [intro, papersCard]);
}

/* -------------------------------------------------------------------------- */
/* Coverage overview                                                           */
/* -------------------------------------------------------------------------- */

/** Coverage overview: material + studied/total + mastered/total over PRELIMS. @internal */
function buildCoverage(summary: PlanSummary): HTMLElement {
  const total = summary.prelimsTotal;
  const materialFrac = total > 0 ? summary.prelimsWithMaterial / total : 0;
  const studiedFrac = total > 0 ? summary.prelimsStudied / total : 0;
  const masteredFrac = total > 0 ? summary.prelimsMastered / total : 0;
  return card({ title: 'Prelims coverage', subtitle: `${summary.theoryTotal} theory + ${summary.aptitudeTotal} aptitude topics in scope · ${summary.prelimsWithMaterial} with material so far` }, [
    el('div', { class: 'coverage-bars' }, [
      progressBar({ value: materialFrac, label: 'Material ready', caption: `${summary.prelimsWithMaterial}/${total}` }),
      progressBar({ value: studiedFrac, label: 'Studied', caption: `${summary.prelimsStudied}/${total}` }),
      progressBar({ value: masteredFrac, label: 'Mastered', caption: `${summary.prelimsMastered}/${total}`, success: masteredFrac >= 1 }),
    ]),
    el('p', { class: 'section-lead', attrs: { role: 'note' }, text: 'Every prelims subtopic (Papers I & II) is on the plan. Topics without notes or questions yet are marked \u201cmaterial coming\u201d and still scheduled so nothing is missed.' }),
  ]);
}

/* -------------------------------------------------------------------------- */
/* Fit summary (plain language)                                                */
/* -------------------------------------------------------------------------- */

/** Plain-language fit summary: budget, mocks, coverage end + per-subject depth. @internal */
function buildFitSummary(summary: PlanSummary): HTMLElement {
  const budgetLabel = summary.weekendBudgetMin === summary.dailyBudgetMin
    ? `${fmtDuration(summary.dailyBudgetMin)}/day`
    : `${fmtDuration(summary.dailyBudgetMin)}/weekday · ${fmtDuration(summary.weekendBudgetMin)}/Sunday`;

  const stats: Child[] = [
    stat('Time each day', budgetLabel),
    stat('Full mocks', String(summary.mockSittings)),
    summary.weekTests > 0 ? stat('Week tests', String(summary.weekTests)) : null,
    stat('New topics until', prettyDate(summary.coverageEndISO)),
    stat('Exam', prettyDate(summary.examDateISO)),
  ];

  const fitRows = summary.subjectFit.map((f) => subjectFitRow(f));

  const spillNote = summary.spills.length > 0
    ? el('p', { class: 'section-lead', attrs: { role: 'note' }, text: `Running tight: ${summary.spills.map((s) => `${subjectName(s.subject)} finishes ${prettyDate(s.lastDateISO)}`).join('; ')}.` })
    : el('p', { class: 'section-lead', attrs: { role: 'note' }, text: 'Every subject fits its slots before new topics stop — no overflow.' });

  // Full-mock sittings per paper vs the non-repeating capacity (mockSeriesLength);
  // when sittings exceed capacity, some sections WRAP (reuse questions) — flagged
  // honestly here.
  const capP1 = mockSeriesLength(PAPER_I, mockSectionPools(PAPER_I));
  const capP2 = mockSeriesLength(PAPER_II, mockSectionPools(PAPER_II));
  const sitP1 = summary.fullMockPaperCounts.paper1;
  const sitP2 = summary.fullMockPaperCounts.paper2;
  const wraps = sitP1 > capP1 || sitP2 > capP2;
  const mockCapNote = summary.mockSittings > 0
    ? el('p', { class: 'section-lead', attrs: { role: 'note' }, text:
        `Full mocks — Paper-I: ${sitP1} of ${capP1} non-repeating · Paper-II: ${sitP2} of ${capP2} non-repeating.${wraps ? ' Some later papers reuse earlier questions (pool wrap).' : ''}` })
    : null;

  return card({ title: 'Plan fit', subtitle: 'How the whole prelims scope fits your time' }, [
    el('div', { class: 'plan-stat-grid' }, stats),
    el('div', { class: 'plan-fit-subjects' }, fitRows),
    spillNote,
    mockCapNote,
  ]);
}

/** One subject's fit row: "History · 47 topics · 40 full · 7 quick, done by 2 Nov". @internal */
function subjectFitRow(f: SubjectFit): HTMLElement {
  const done = f.lastFirstPassISO ? ` · done by ${prettyDate(f.lastFirstPassISO)}` : '';
  return el('div', { class: 'plan-fit-subject' }, [
    el('span', { class: 'plan-fit-subject-name', text: subjectName(f.subject) }),
    el('span', { class: 'plan-fit-subject-meta tnum', text: `${f.total} topics · ${f.full} full · ${f.standard} standard · ${f.quick} quick${done}` }),
  ]);
}

/** A small labelled stat tile for the plan-fit grid. @internal */
function stat(label: string, value: string): HTMLElement {
  return el('div', { class: 'plan-stat' }, [
    el('span', { class: 'plan-stat-value tnum', text: value }),
    el('span', { class: 'plan-stat-label', text: label }),
  ]);
}

/* -------------------------------------------------------------------------- */
/* Per-subject progress                                                        */
/* -------------------------------------------------------------------------- */

/** Per-subject progress rows: "History 12/47 · next: Mauryan Empire". @internal */
function buildSubjectProgress(summary: PlanSummary): HTMLElement {
  const progress = loadState().progress;
  const seq = getLearningSequence();
  const rows: HTMLElement[] = [];

  for (const f of summary.subjectFit) {
    const code = f.subject as SubjectCode;
    const seqSubjects = seq.subjects as Record<string, ReadonlyArray<{ id: string }>>;
    const orderedIds = (seqSubjects[code] ?? []).map((s) => s.id);
    const fallbackIds = orderedIds.length > 0 ? orderedIds : getSubtopics(code).map((s) => s.id);
    let studied = 0;
    let nextName = '';
    for (const id of fallbackIds) {
      const view = getSubtopic(id);
      const ids = view?.mcqs.map((m) => m.id) ?? [];
      const done = ids.length > 0 && subtopicMasteryPct(progress, ids) > 0;
      const seen = ids.some((mid) => (progress[mid]?.seen ?? 0) > 0);
      if (done || seen) studied += 1;
      else if (nextName === '') nextName = view?.meta.name ?? id;
    }
    rows.push(el('div', { class: 'plan-subject-progress' }, [
      el('span', { class: 'plan-subject-name', text: subjectName(f.subject) }),
      el('span', { class: 'plan-subject-count tnum', text: `${studied}/${f.total}` }),
      nextName ? el('span', { class: 'plan-subject-next', text: `next: ${nextName}` }) : el('span', { class: 'plan-subject-next', text: 'all covered' }),
    ]));
  }

  return card({ title: 'Where each subject stands' }, [el('div', { class: 'plan-subjects' }, rows)]);
}

/* -------------------------------------------------------------------------- */
/* Weekly grid                                                                 */
/* -------------------------------------------------------------------------- */

/** Full weekly grid grouped into 7-day weeks (Mon–Sun where the data allows). @internal */
function buildGrid(plan: Plan): HTMLElement {
  if (plan.days.length === 0) {
    return card({ title: 'Schedule' }, [
      el('p', { class: 'section-lead', text: 'No days to plan — set an exam date in the future above.' }),
    ]);
  }
  const weeks: PlanDay[][] = [];
  for (const day of plan.days) {
    const w = Math.floor(day.dayIndex / 7);
    (weeks[w] ??= []).push(day);
  }
  return el('section', { class: 'planner-grid-wrap' }, [
    el('h2', { class: 'card-title schedule-title', text: 'Week-by-week' }),
    ...weeks.map((week, i) => weekSection(week, i)),
  ]);
}

/** One collapsible week of day cells. @internal */
function weekSection(week: PlanDay[], weekIndex: number): HTMLElement {
  const containsToday = week.some((d) => d.status === 'today');
  const first = week[0]!;
  const last = week[week.length - 1]!;
  const mocks = week.filter((d) => d.mockPaper).length;

  const summaryRow = el('summary', { class: 'week-summary' }, [
    el('span', { class: 'week-title', text: `Week ${weekIndex + 1}` }),
    el('span', { class: 'week-range', text: `${prettyDate(first.dateISO)} – ${prettyDate(last.dateISO)}` }),
    containsToday ? chip({ text: 'This week', tone: 'accent' }) : null,
    mocks > 0 ? chip({ text: `${mocks} mock${mocks === 1 ? '' : 's'}`, tone: 'warn' }) : null,
    icon('chevron', 16),
  ]);

  const details = el('details', { class: 'week' }, [
    summaryRow,
    el('div', { class: 'plan-week-grid' }, week.map(dayCell)),
  ]) as HTMLDetailsElement;
  if (containsToday) details.setAttribute('open', 'true');
  return details;
}

/** Day-of-week short label from an ISO date. @internal */
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function dowLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return '';
  return DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] ?? '';
}

/** One day cell in the weekly grid. @internal */
function dayCell(day: PlanDay): HTMLElement {
  const cls = ['plan-cell', `is-${day.status}`];
  if (day.mockPaper) cls.push('is-mock');
  if (day.light) cls.push('is-light');

  const start = getPlanStartDate();
  const preStart = diffDaysISO(day.dateISO, start) > 0;
  if (preStart) cls.push('is-prestart');

  const head = el('div', { class: 'plan-cell-head' }, [
    el('span', { class: 'plan-cell-dow', text: dowLabel(day.dateISO) }),
    el('span', { class: 'plan-cell-date tnum', text: prettyDate(day.dateISO).replace(/ \d{4}$/, '') }),
    day.status === 'today' ? chip({ text: 'Today', tone: 'ok' }) : null,
  ]);

  const body: Child[] = preStart
    ? [el('span', { class: 'plan-day-idle', text: `Plan starts ${prettyDowDate(start)}` })]
    : day.blocks.length > 0
      ? day.blocks.map(cellBlock)
      : [el('span', { class: 'plan-day-idle', text: day.light ? 'Light day' : 'Rest' })];

  return el('div', { class: cls.join(' ') }, [head, el('div', { class: 'plan-cell-body' }, body)]);
}

/** One block row inside a day cell. @internal */
function cellBlock(block: PlanBlock): HTMLElement {
  if (block.kind === 'mock' && block.mockPaper) {
    const paper = block.mockPaper;
    const dress = block.label.includes('Dress rehearsal');
    return el('button', {
      class: 'plan-cell-mock',
      type: 'button',
      ariaLabel: dress
        ? 'Sit the dress-rehearsal full mock'
        : `Sit ${paper === 'paper1' ? 'Paper-I' : 'Paper-II'} full mock`,
      onClick: () => openPaperMock(paper),
    }, [icon('timer', 13), el('span', { text: dress ? 'Dress rehearsal' : `${paper === 'paper1' ? 'Paper-I' : 'Paper-II'} mock` })]);
  }
  if (block.kind === 'week-test') {
    return el('button', {
      class: 'plan-cell-mock',
      type: 'button',
      ariaLabel: 'Start this week’s test — questions from topics you have studied',
      onClick: () => openWeekTest(block),
    }, [icon('timer', 13), el('span', { text: block.label })]);
  }
  if (block.kind === 'unit-wrapup') {
    const q = block.unitTestCount ?? 0;
    return el('button', {
      class: 'plan-cell-mock',
      type: 'button',
      ariaLabel: q > 0
        ? `Start the unit test — ${q} question${q === 1 ? '' : 's'} from this unit only`
        : 'Open the unit wrap-up',
      onClick: () => openUnitTest(block),
    }, [icon('timer', 13), el('span', { text: block.label })]);
  }

  const topics = block.topics ?? [];
  const head = el('span', { class: 'plan-cell-block-label', text: `${block.label} · ${fmtDuration(block.minutes)}` });
  if (topics.length === 0) {
    return el('div', { class: 'plan-cell-block' }, [head]);
  }
  return el('div', { class: 'plan-cell-block' }, [head, el('div', { class: 'plan-cell-topics' }, topics.map(topicPill))]);
}

/** A study topic pill inside the grid (FULL / Quick pass). @internal */
function topicPill(topic: PlanTopic): HTMLElement {
  if (topic.kind === 'practice') {
    const q = topic.mcqCount;
    return el('button', {
      class: 'plan-study-pill',
      type: 'button',
      ariaLabel: `Mental Ability practice · ${q} question${q === 1 ? '' : 's'}`,
      onClick: () => startPracticeDrill(topic.practiceSubtopicIds ?? [], q > 0 ? q : 20),
    }, [
      el('span', { class: 'plan-pill-fast', text: 'PRACTICE' }),
      el('span', { text: 'Mental Ability practice' }),
    ]);
  }
  const name = topic.name || topic.subtopicId;
  // A DEEPEN top-up (final window): plain language, no tier jargon —
  // "Deepen · <topic> · 15 min".
  if (topic.pass === 'deepen') {
    return el('button', {
      class: 'plan-study-pill is-deepen',
      type: 'button',
      attrs: { title: `Deepen — about ${topic.estMinutes} min to strengthen a weak area` },
      ariaLabel: `Deepen ${name}, about ${topic.estMinutes} minutes`,
      onClick: () => openLearn(topic.subtopicId),
    }, [
      el('span', { class: 'plan-pill-fast', text: 'Deepen' }),
      el('span', { text: `${name} · ${topic.estMinutes} min` }),
    ]);
  }
  // Depth tier → badge: FULL shows none (the default depth), STANDARD / QUICK are
  // marked so a lighter first pass is visible at a glance.
  const tierBadge =
    topic.pass === 'quick'
      ? { cls: 'plan-study-pill is-quick', label: 'Quick pass', title: 'Quick pass — key facts + cards + ~8 questions' }
      : topic.pass === 'standard'
        ? { cls: 'plan-study-pill is-standard', label: 'Standard', title: 'Standard pass — notes + ~12 questions' }
        : null;
  return el('button', {
    class: tierBadge ? tierBadge.cls : 'plan-study-pill',
    type: 'button',
    attrs: tierBadge ? { title: tierBadge.title } : {},
    ariaLabel: `Study ${name}${tierBadge ? `, ${tierBadge.label.toLowerCase()}` : ''}`,
    onClick: () => openLearn(topic.subtopicId),
  }, [
    el('span', { text: name }),
    tierBadge ? el('span', { class: 'plan-pill-fast', text: tierBadge.label }) : null,
  ]);
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/** Human subject name from a subject code (falls back to the code). @internal */
function subjectName(code: string): string {
  return (SUBJECTS as Record<string, string>)[code] ?? code;
}
