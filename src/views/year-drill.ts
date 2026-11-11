/**
 * "In which year?" drill. Used at the end of every history lesson and on its
 * own page (`#/topics/history/years`) for the years that are due today.
 * Wrong answers come back at the end of the round and are scheduled sooner.
 */
import { getChapters } from '../content/loader';
import type { TimelineEvent } from '../content/timeline-types';
import { newCard, review } from '../engine/spaced-repetition';
import { formatYear, mulberry32 } from '../lib/timeline';
import { dueYearEvents, maskYears, yearCardId, yearOptions } from '../lib/year-drill';
import { navigate } from '../router/router';
import { loadState, updateState } from '../state/store';
import { el, mount } from './dom';
import { chronicleData, yearLabel } from './year-explorer';

export const YEARS_PATH = '/topics/history/years';

function record(eventId: string, correct: boolean): void {
  const now = Date.now();
  const id = yearCardId(eventId);
  updateState((s) => {
    s.flashcards[id] = review(s.flashcards[id] ?? newCard(id, now), correct ? 'correct' : 'wrong', now);
  });
}

/** A self-contained drill over `events`. `seed` keeps option order stable for one render. */
export function yearDrill(events: readonly TimelineEvent[], seed = 1): HTMLElement {
  const wrap = el('div', { class: 'yd' });
  if (events.length === 0) {
    mount(wrap, el('p', { class: 'hl-muted', text: 'Nothing to drill here yet.' }));
    return wrap;
  }
  const rand = mulberry32(seed);
  const pool = events.map((e) => e.date.year);
  const queue: TimelineEvent[] = [...events];
  const missed = new Set<string>();
  let asked = 0;
  let firstTry = 0;

  const ask = (): void => {
    const ev = queue.shift();
    if (!ev) {
      finish();
      return;
    }
    const retry = missed.has(ev.id);
    if (!retry) asked += 1;
    const options = yearOptions(ev.date.year, pool, rand);
    const feedback = el('div', { class: 'yd-feedback', attrs: { 'aria-live': 'polite' } });
    const next = el('button', { class: 'btn btn-primary', type: 'button', text: queue.length ? 'Next year ›' : 'See score ›', attrs: { hidden: 'true' }, onClick: ask });
    const buttons = options.map((y) =>
      el('button', {
        class: 'yd-option tnum',
        type: 'button',
        text: yearLabel(y).replace(' CE', ''),
        onClick: () => {
          const right = y === ev.date.year;
          for (const b of buttons) {
            b.setAttribute('disabled', 'true');
            if (b.textContent === yearLabel(ev.date.year).replace(' CE', '')) b.classList.add('is-right');
          }
          if (!right) {
            const mine = buttons.find((b) => b.textContent === yearLabel(y).replace(' CE', ''));
            mine?.classList.add('is-wrong');
          }
          if (right && !retry) firstTry += 1;
          if (!right && !missed.has(ev.id)) {
            missed.add(ev.id);
            queue.push(ev);
          }
          if (!retry) record(ev.id, right);
          mount(feedback,
            el('p', { class: right ? 'yd-ok' : 'yd-no', text: right ? `Yes — ${formatYear(ev.date)}.` : `No — it was ${formatYear(ev.date)}. It will come back at the end.` }),
            ev.yearHook ? el('p', { class: 'yd-hook' }, [el('strong', { text: 'Remember the year: ' }), el('span', { text: ev.yearHook })]) : null,
          );
          next.removeAttribute('hidden');
          next.focus();
        },
      }),
    );
    mount(wrap,
      el('p', { class: 'hl-kicker tnum', text: retry ? 'Try again' : `Year ${asked} of ${events.length}` }),
      el('p', { class: 'yd-q', text: `In which year? ${maskYears(ev.title)}` }),
      el('p', { class: 'hl-muted', text: maskYears(ev.summary) }),
      el('div', { class: 'yd-options', attrs: { role: 'group', 'aria-label': 'Choose the year' } }, buttons),
      feedback,
      next,
    );
  };

  const finish = (): void => {
    const wrong = events.filter((e) => missed.has(e.id));
    mount(wrap,
      el('p', { class: 'yd-score tnum', text: `${firstTry} / ${events.length} right first time` }),
      wrong.length
        ? el('div', {}, [
            el('p', { class: 'hl-sub', text: 'Years to work on' }),
            el('ul', { class: 'hl-list' }, wrong.map((e) => el('li', {}, [
              el('strong', { class: 'tnum', text: `${formatYear(e.date)} ` }),
              el('span', { text: e.title }),
              e.yearHook ? el('span', { class: 'hl-muted', text: ` — ${e.yearHook}` }) : null,
            ]))),
          ])
        : el('p', { class: 'yd-ok', text: 'Every year right. These come back for review in a few days.' }),
      el('button', { class: 'btn btn-secondary', type: 'button', text: 'Drill these years again', onClick: () => mount(wrap, yearDrill(events, seed + 1)) }),
    );
  };

  ask();
  return wrap;
}

/** Events taught in any chapter. */
export function taughtEvents(): TimelineEvent[] {
  const chapters = getChapters();
  return chronicleData().events
    .filter((e) => chapters.some((c) => e.date.year >= c.from && e.date.year <= c.to && (!c.lanes || c.lanes.includes(e.lane))))
    .sort((a, b) => a.date.year - b.date.year);
}

/** Counts for the index card. */
export function yearDrillCounts(now = Date.now()): { due: number; fresh: number } {
  const { due, fresh } = dueYearEvents(taughtEvents(), loadState().flashcards, now);
  return { due: due.length, fresh: fresh.length };
}

const ROUND = 15;

export function render(root: HTMLElement): void {
  const all = taughtEvents();
  const { due, fresh } = dueYearEvents(all, loadState().flashcards, Date.now());
  const round = [...due, ...fresh].slice(0, ROUND);
  const body = el('div', { class: 'yd-body' });
  const start = (events: TimelineEvent[], label: string): void => {
    mount(body, el('p', { class: 'hl-muted', text: label }), yearDrill(events, Date.now() % 100000));
  };
  mount(root, el('div', { class: 'hl' }, [
    el('button', { class: 'btn btn-ghost hl-back', type: 'button', onClick: () => navigate('/topics/history') }, [el('span', { text: '‹ History' })]),
    el('h1', { class: 'page-title', text: 'Year drill' }),
    el('p', { class: 'page-lead', text: 'Pick the year for each event. Years you miss come back sooner; years you know come back after 1, 3, 7, 16 and 35 days.' }),
    el('div', { class: 'yd-actions' }, [
      el('button', { class: 'btn btn-primary', type: 'button', text: `Start (${round.length} years: ${due.length} due, ${Math.min(fresh.length, ROUND - Math.min(due.length, ROUND))} new)`, onClick: () => start(round, 'Due years first, then new ones.') }),
      el('button', { class: 'btn btn-secondary', type: 'button', text: `Drill all ${all.length} years in order`, onClick: () => start(all, 'Every taught event, oldest first.') }),
    ]),
    body,
  ]));
  if (round.length === 0) mount(body, el('p', { class: 'hl-muted', text: 'Nothing due today. Use "Drill all years" to practise anyway.' }));
}
