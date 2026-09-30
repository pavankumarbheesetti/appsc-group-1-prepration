/**
 * Planner — the exam-date-driven weekly RHYTHM schedule (route `#/planner`).
 *
 * The header carries an EDITABLE exam-date input (default 15 Nov 2026) that
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
import { feasibilityLine, type Plan, type PlanBlock, type PlanDay, type PlanSummary, type PlanTopic, type SubjectFit } from '../engine/planner';
import { getLearningSequence, getSubtopic, getSubtopics } from '../content/loader';
import { SUBJECTS, type SubjectCode } from '../content/types';
import { getExamDate, setExamDate } from '../state/store';
import { currentPlan } from '../lib/plan';
import { loadState } from '../state/store';
import { subtopicMasteryPct } from '../lib/metrics';
import { daysUntilExam, todayISO } from '../lib/dates';
import { el, mount, type Child } from './dom';
import { card } from './components/card';
import { chip } from './components/chip';
import { progressBar } from './components/progress';
import { icon } from './components/icon';
import { openLearn } from './learn';
import { openPaperMock } from './mock';
import { prettyDate, fmtDuration, startPracticeDrill } from './today';

/** Render the Planner view into `root`. */
export function render(root: HTMLElement): void {
  const draw = (): void => {
    const now = new Date();
    const plan = currentPlan(now);
    if (plan.summary.postPrelims) {
      mount(root, buildHeader(plan.summary, draw), buildPostPrelims());
      return;
    }
    mount(
      root,
      buildHeader(plan.summary, draw),
      buildCoverage(plan.summary),
      buildFitSummary(plan.summary),
      buildSubjectProgress(plan.summary),
      buildGrid(plan),
    );
  };
  draw();
}

/* -------------------------------------------------------------------------- */
/* Header: editable exam date + countdown + feasibility                        */
/* -------------------------------------------------------------------------- */

/** Header with the editable exam date, countdown and feasibility line. @internal */
function buildHeader(summary: PlanSummary, rerender: () => void): HTMLElement {
  const today = todayISO();
  const daysToExam = daysUntilExam(summary.examDateISO, today);

  const dateInput = el('input', {
    class: 'exam-date-input',
    type: 'date',
    value: getExamDate(),
    ariaLabel: 'Target exam date',
  }) as HTMLInputElement;
  dateInput.value = getExamDate();
  dateInput.addEventListener('change', () => {
    const before = getExamDate();
    setExamDate(dateInput.value);
    if (getExamDate() === before) dateInput.value = before;
    rerender();
  });

  const field = el('label', { class: 'field exam-date-field' }, [
    el('span', { class: 'field-label', text: 'Exam date' }),
    dateInput,
  ]);

  const feasibility = el('p', {
    class: summary.onTrack ? 'feasibility is-ok' : 'feasibility is-warn',
    attrs: { role: 'status' },
  }, [
    icon(summary.onTrack ? 'check' : 'flame', 16),
    el('span', { text: feasibilityLine(summary) }),
  ]);

  const countdownCard = el('div', { class: 'countdown countdown-sm' }, [
    el('div', { class: 'countdown-days tnum', text: String(daysToExam) }),
    el('div', { class: 'countdown-unit', text: daysToExam === 1 ? 'day to Prelims' : 'days to Prelims' }),
    el('div', { class: 'countdown-label', text: `Prelims · ${prettyDate(summary.examDateISO)}` }),
  ]);

  const left = el('div', { class: 'hero-body' }, [
    el('h2', { class: 'hero-title', text: 'Study planner' }),
    field,
    feasibility,
  ]);

  return el('section', { class: 'hero planner-hero' }, [left, countdownCard]);
}

/** Post-prelims placeholder. @internal */
function buildPostPrelims(): HTMLElement {
  return card({ title: 'Mains kick-start' }, [
    el('p', { class: 'section-lead', text: 'Prelims is behind you — the plan now runs descriptive Mains practice, the weekly General Essay, and the qualifying Telugu / English blocks.' }),
  ]);
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
    stat('New topics until', prettyDate(summary.coverageEndISO)),
    stat('Exam', prettyDate(summary.examDateISO)),
  ];

  const fitRows = summary.subjectFit.map((f) => subjectFitRow(f));

  const spillNote = summary.spills.length > 0
    ? el('p', { class: 'section-lead', attrs: { role: 'note' }, text: `Running tight: ${summary.spills.map((s) => `${subjectName(s.subject)} finishes ${prettyDate(s.lastDateISO)}`).join('; ')}.` })
    : el('p', { class: 'section-lead', attrs: { role: 'note' }, text: 'Every subject fits its slots before new topics stop — no overflow.' });

  return card({ title: 'Plan fit', subtitle: 'How the whole prelims scope fits your time' }, [
    el('div', { class: 'plan-stat-grid' }, stats),
    el('div', { class: 'plan-fit-subjects' }, fitRows),
    spillNote,
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

  const head = el('div', { class: 'plan-cell-head' }, [
    el('span', { class: 'plan-cell-dow', text: dowLabel(day.dateISO) }),
    el('span', { class: 'plan-cell-date tnum', text: prettyDate(day.dateISO).replace(/ \d{4}$/, '') }),
    day.status === 'today' ? chip({ text: 'Today', tone: 'ok' }) : null,
  ]);

  const body: Child[] = day.blocks.length > 0
    ? day.blocks.map(cellBlock)
    : [el('span', { class: 'plan-day-idle', text: day.light ? 'Light day' : 'Rest' })];

  return el('div', { class: cls.join(' ') }, [head, el('div', { class: 'plan-cell-body' }, body)]);
}

/** One block row inside a day cell. @internal */
function cellBlock(block: PlanBlock): HTMLElement {
  if (block.kind === 'mock' && block.mockPaper) {
    const paper = block.mockPaper;
    return el('button', {
      class: 'plan-cell-mock',
      type: 'button',
      ariaLabel: `Sit ${paper === 'paper1' ? 'Paper-I' : 'Paper-II'} full mock`,
      onClick: () => openPaperMock(paper),
    }, [icon('timer', 13), el('span', { text: `${paper === 'paper1' ? 'Paper-I' : 'Paper-II'} mock` })]);
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
