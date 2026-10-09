/**
 * Start here — the beginner orientation guide (route `#/start`).
 *
 * A plain-language, scannable "read me first" for a complete beginner. It is
 * linked from Today on day 1, from Settings, and from the nav "More" sheet, and
 * is opened by the day-1 orientation "Start here" block.
 *
 * Five sections, in beginner order:
 *   (a) the exam in 1 minute — the two Prelims papers, their parts, marks,
 *       negative marking, the 1:50 shortlist, and the key dates;
 *   (b) how your plan works — the weekday / Saturday / Sunday shape and the
 *       phases (first pass → revision → final weeks), with dates DERIVED from
 *       the live plan;
 *   (c) how to study one topic in this app — Topic at a glance → Notes →
 *       Practice → Flashcards, and what Full / Standard / Quick pass mean;
 *   (d) how to handle negative marking — the simple expected-value rule;
 *   (e) what to do if you miss a day — Sunday catch-up, don't double up.
 *
 * Exam facts come from {@link PAPER_I}/{@link PAPER_II} + {@link NEGATIVE_MARK}
 * (the single source of truth, verified against the detailed Notification
 * 07/2026); phase dates are derived from {@link computePlanAnchors}. DOM-only,
 * accessible headings, works down to a 390px viewport.
 */
import { NEGATIVE_MARK, PAPER_I, PAPER_II } from '../lib/exam-pattern';
import { computePlanAnchors } from '../engine/planner';
import { currentPlan } from '../lib/plan';
import { getExamDate, getPlanStartDate } from '../state/store';
import { el, mount, type Child } from './dom';
import { card } from './components/card';
import { button } from './components/button';
import { chip } from './components/chip';
import { icon } from './components/icon';
import { navigate } from '../router/router';
import { prettyDate } from './today';

/**
 * The application deadline, verbatim from the detailed Notification 07/2026
 * ("06/10/2026 → 27/10/2026 up to 11:59 P.M"). A notification FACT, not a
 * plan-derived date, so it is a constant here.
 */
const APPLY_BY = '27 Oct 2026, 11:59 PM';

/** Render the Start-here guide into `root`. */
export function render(root: HTMLElement): void {
  const plan = currentPlan(new Date());
  const examISO = getExamDate();
  const anchors = computePlanAnchors(examISO, getPlanStartDate());

  mount(
    root,
    hero(),
    examInOneMinute(examISO),
    howYourPlanWorks(plan.summary.coverageEndISO, anchors),
    howToStudyOneTopic(),
    howToHandleNegativeMarking(),
    whatIfYouMissADay(),
    footerNav(),
  );
}

/* -------------------------------------------------------------------------- */
/* Hero                                                                        */
/* -------------------------------------------------------------------------- */

/** A warm, plain-language intro. @internal */
function hero(): HTMLElement {
  return el('section', { class: 'hero' }, [
    el('div', { class: 'hero-body' }, [
      el('p', { class: 'hero-greeting', text: 'New here? Start with this.' }),
      el('h2', { class: 'hero-title', text: 'Start here' }),
      el('p', {
        class: 'section-lead',
        text: 'A five-minute read that explains the exam, how your daily plan works, and how to study a topic in this app. You can come back any time from Settings or the More menu.',
      }),
    ]),
  ]);
}

/* -------------------------------------------------------------------------- */
/* (a) The exam in 1 minute                                                    */
/* -------------------------------------------------------------------------- */

/** Section (a): the two Prelims papers, marks, negative marking, dates. @internal */
function examInOneMinute(examISO: string): HTMLElement {
  const negPct = Math.round(NEGATIVE_MARK * 100) / 100; // 0.33

  const paperTable = (p: typeof PAPER_I): HTMLElement => {
    const rows = p.sections.map((s) =>
      el('tr', {}, [
        el('td', { text: `${s.part} · ${s.label}` }),
        el('td', { class: 'tnum', text: String(s.marks) }),
      ]),
    );
    return el('div', { class: 'md-table-wrap' }, [
      el('table', { class: 'md-table' }, [
        el('thead', {}, [el('tr', {}, [el('th', { text: p.title }), el('th', { text: 'Marks' })])]),
        el('tbody', {}, [
          ...rows,
          el('tr', {}, [
            el('td', {}, [el('strong', { text: 'Total' })]),
            el('td', { class: 'tnum' }, [el('strong', { text: `${p.totalMarks}` })]),
          ]),
        ]),
      ]),
    ]);
  };

  const dateRows: Array<[string, string]> = [
    ['Apply by', APPLY_BY],
    ['Prelims (Screening Test)', prettyDate(examISO)],
    ['Mains', 'announced later'],
  ];

  return card({ title: 'The exam in 1 minute', subtitle: 'APPSC Group-1 Screening (Prelims)' }, [
    el('p', { class: 'section-lead' }, [
      el('span', { text: 'Prelims is ' }),
      el('strong', { text: 'two papers' }),
      el('span', { text: ', each ' }),
      el('strong', { text: '120 questions · 120 minutes · 120 marks' }),
      el('span', { text: '. Both are objective (OMR).' }),
    ]),
    el('div', { class: 'start-two-col' }, [paperTable(PAPER_I), paperTable(PAPER_II)]),
    el('ul', {}, [
      el('li', {}, [
        el('strong', { text: `Negative marking: −${negPct} (a third of a mark)` }),
        el('span', { text: ' for every wrong answer. Blanks cost nothing.' }),
      ]),
      el('li', {}, [
        el('strong', { text: 'Prelims only shortlists' }),
        el('span', { text: ' candidates for Mains (about 1:50 of the vacancies). Your Prelims marks do ' }),
        el('strong', { text: 'not' }),
        el('span', { text: ' count in the final merit — it is a gateway, not a score that follows you.' }),
      ]),
    ]),
    el('div', { class: 'md-table-wrap' }, [
      el('table', { class: 'md-table' }, [
        el('thead', {}, [el('tr', {}, [el('th', { text: 'Key date' }), el('th', { text: 'When' })])]),
        el('tbody', {}, dateRows.map(([k, v]) =>
          el('tr', {}, [el('td', { text: k }), el('td', { text: v })]),
        )),
      ]),
    ]),
  ]);
}

/* -------------------------------------------------------------------------- */
/* (b) How your plan works                                                     */
/* -------------------------------------------------------------------------- */

/** Section (b): the weekly shape + the three phases, dates from the plan. @internal */
function howYourPlanWorks(
  coverageEndISO: string,
  anchors: ReturnType<typeof computePlanAnchors>,
): HTMLElement {
  const phaseRows: Array<[string, string, string]> = [
    [
      'First pass',
      `until ${prettyDate(coverageEndISO)}`,
      'Learn every topic once, subject by subject, in the right order.',
    ],
  ];
  if (anchors.revisionStartISO) {
    phaseRows.push([
      'Revision cycle',
      `${prettyDate(anchors.revisionStartISO)} – ${prettyDate(anchors.finalStartISO)}`,
      'Go back over everything, weakest topics first, with full mocks.',
    ]);
  }
  phaseRows.push([
    'Final weeks',
    `${prettyDate(anchors.finalStartISO)} – ${prettyDate(anchors.examISO)}`,
    'Three full mocks a week, quick revision, then a light day before the exam.',
  ]);

  return card({ title: 'How your plan works', subtitle: 'A steady weekly rhythm' }, [
    el('ul', {}, [
      el('li', {}, [el('strong', { text: 'Weekdays (Mon–Fri): ' }), el('span', { text: 'Mental Ability + one Paper-I subject + revision + current affairs — about 4 hours.' })]),
      el('li', {}, [el('strong', { text: 'Saturday: ' }), el('span', { text: 'a test day — day 1 is your orientation instead.' })]),
      el('li', {}, [el('strong', { text: 'Sunday: ' }), el('span', { text: 'a longer day (about 6 hours) for Modern History, Polity and a weekly catch-up.' })]),
    ]),
    el('p', { class: 'section-lead', text: 'The plan moves through three phases, all timed to your exam date:' }),
    el('div', { class: 'md-table-wrap' }, [
      el('table', { class: 'md-table' }, [
        el('thead', {}, [el('tr', {}, [el('th', { text: 'Phase' }), el('th', { text: 'When' }), el('th', { text: 'What you do' })])]),
        el('tbody', {}, phaseRows.map(([a, b, c]) =>
          el('tr', {}, [el('td', {}, [el('strong', { text: a })]), el('td', { text: b }), el('td', { text: c })]),
        )),
      ]),
    ]),
  ]);
}

/* -------------------------------------------------------------------------- */
/* (c) How to study one topic                                                  */
/* -------------------------------------------------------------------------- */

/** Section (c): the four-step study loop + what the passes mean. @internal */
function howToStudyOneTopic(): HTMLElement {
  const step = (n: number, title: string, body: string): HTMLElement =>
    el('li', { class: 'start-step' }, [
      el('span', { class: 'start-step-num', text: String(n) }),
      el('div', {}, [el('strong', { text: title }), el('span', { text: ` — ${body}` })]),
    ]);

  return card({ title: 'How to study one topic', subtitle: 'The same four steps every time' }, [
    el('ol', { class: 'start-steps' }, [
      step(1, 'Topic at a glance', 'a one-screen map of the whole topic — read it first to see the shape.'),
      step(2, 'Notes', 'the actual content, with key facts and tables.'),
      step(3, 'Practice', 'exam-style questions to test what you just read.'),
      step(4, 'Flashcards', 'quick recall cards that come back on a spaced schedule.'),
    ]),
    el('p', { class: 'section-lead', text: 'Each topic is scheduled at one of three depths, so your time goes where it matters:' }),
    el('div', { class: 'md-table-wrap' }, [
      el('table', { class: 'md-table' }, [
        el('thead', {}, [el('tr', {}, [el('th', { text: 'Pass' }), el('th', { text: 'What it means' })])]),
        el('tbody', {}, [
          el('tr', {}, [el('td', {}, [el('strong', { text: 'Full' })]), el('td', { text: 'Notes + about 20 questions + review — for the highest-yield topics.' })]),
          el('tr', {}, [el('td', {}, [el('strong', { text: 'Standard' })]), el('td', { text: 'Notes + about 12 questions.' })]),
          el('tr', {}, [el('td', {}, [el('strong', { text: 'Quick pass' })]), el('td', { text: 'Key facts + cards + about 8 questions — a light first look.' })]),
        ]),
      ]),
    ]),
  ]);
}

/* -------------------------------------------------------------------------- */
/* (d) Negative marking                                                        */
/* -------------------------------------------------------------------------- */

/** Section (d): the simple expected-value rule for guessing. @internal */
function howToHandleNegativeMarking(): HTMLElement {
  return card({ title: 'How to handle negative marking', subtitle: 'When to answer, when to skip' }, [
    el('p', { class: 'section-lead' }, [
      el('span', { text: 'A wrong answer costs you ' }),
      el('strong', { text: 'a third of a mark' }),
      el('span', { text: '; a blank costs nothing. So the question is simple: is a guess worth it?' }),
    ]),
    el('ul', {}, [
      el('li', {}, [el('strong', { text: 'All four options look possible → skip.' }), el('span', { text: ' A blind guess breaks even at best, and usually loses.' })]),
      el('li', {}, [el('strong', { text: 'You can rule out one or two options → answer.' }), el('span', { text: ' Now the odds are in your favour and the guess pays off on average.' })]),
    ]),
    el('p', { class: 'section-lead' }, [
      el('span', { text: 'The maths, kept simple: with 4 options a random guess averages ' }),
      el('strong', { text: '0 marks' }),
      el('span', { text: ' (one right ' }),
      el('strong', { text: '+1' }),
      el('span', { text: ', three wrong at ' }),
      el('strong', { text: '−⅓' }),
      el('span', { text: ' cancel out). Eliminate even one wrong option and the average turns positive. Eliminate two and it is clearly worth answering.' }),
    ]),
  ]);
}

/* -------------------------------------------------------------------------- */
/* (e) Missing a day                                                           */
/* -------------------------------------------------------------------------- */

/** Section (e): what to do when a day slips. @internal */
function whatIfYouMissADay(): HTMLElement {
  return card({ title: 'If you miss a day', subtitle: 'Don’t panic, don’t double up' }, [
    el('ul', {}, [
      el('li', {}, [el('strong', { text: 'Use Sunday to catch up.' }), el('span', { text: ' Sunday has spare time built in for exactly this.' })]),
      el('li', {}, [el('strong', { text: 'Don’t cram two days into one.' }), el('span', { text: ' Doubling up tires you out and teaches nothing — just pick up where you left off.' })]),
      el('li', {}, [el('strong', { text: 'Keep the streak of showing up,' }), el('span', { text: ' not the streak of perfection. Consistency over months is what passes this exam.' })]),
    ]),
  ]);
}

/* -------------------------------------------------------------------------- */
/* Footer                                                                      */
/* -------------------------------------------------------------------------- */

/** A one-tap way back into the plan. @internal */
function footerNav(): HTMLElement {
  const actions: Child[] = [
    button({ label: 'Go to Today', onClick: () => navigate('/'), variant: 'primary', iconName: 'arrow-right' }),
    button({ label: 'Open the planner', onClick: () => navigate('/planner'), variant: 'ghost' }),
  ];
  return el('section', { class: 'start-footer', attrs: { role: 'note' } }, [
    el('span', { class: 'empty-icon' }, [icon('sparkles', 22)]),
    el('p', { class: 'section-lead', text: 'That’s everything you need to begin. Your first day is an orientation — no mock, just a gentle start.' }),
    el('div', { class: 'hero-actions' }, actions),
    chip({ text: 'You can reopen this from Settings any time', tone: 'muted' }),
  ]);
}
