/**
 * History, taught in short fragments (`#/topics/history`).
 *
 *   /topics/history            parts → chapters, plus the A–Z of terms
 *   /topics/history/:id        chapter overview: the story so far + its fragments
 *   /topics/history/:id/:n     fragment n, one slide at a time
 *
 * A fragment follows three learning-design rules: learn names and terms
 * first (pre-training), then one event per slide at your own pace
 * (segmenting), then a recap table and a match-the-following check.
 */
import { getChapters, getGlossary } from '../content/loader';
import { HISTORY_PARTS, type Chapter, type GlossaryTerm, type HistoryPart, type Person } from '../content/chronicle-types';
import type { Pair, TimelineEvent } from '../content/timeline-types';
import { eventText, termMatcher } from '../lib/glossary';
import { KIND_META, formatYear } from '../lib/timeline';
import { yearSnapshot, yearsWithEntries, type ChronicleData, type HolderInYear } from '../lib/year-snapshot';
import { navigate, routeParam } from '../router/router';
import { el, mount, renderMarkdown, type Child } from './dom';
import { icon } from './components/icon';
import { postLine, roleAt, wordsToKnow } from './event-parts';
import { YEARS_PATH, yearDrill, yearDrillCounts } from './year-drill';
import { gapPhrase } from '../lib/year-drill';
import {
  CATEGORY_LABEL,
  YEAR_PATH,
  avatar,
  chronicleData,
  figures,
  lifeLabel,
  matchQuiz,
  openPersonCard,
  yearLabel,
} from './year-explorer';

export const HISTORY_PATH = '/topics/history';

const PART_LABEL: Record<HistoryPart, string> = {
  ancient: 'Ancient India',
  medieval: 'Medieval India',
  modern: 'Modern India',
  culture: 'Art & Culture',
  andhra: 'Andhra Pradesh history',
  polity: 'Polity & Constitution',
};

/* -------------------------------------------------------------------------- */
/* Pure helpers                                                                */
/* -------------------------------------------------------------------------- */

const inSpan = (c: Chapter, from: number, to: number, ev: TimelineEvent): boolean =>
  !ev.timeless && ev.date.year >= from && ev.date.year <= to && (!c.lanes || c.lanes.includes(ev.lane)) && (!c.apOnly || ev.apSpecific);

const inChapter = (c: Chapter, ev: TimelineEvent): boolean => inSpan(c, c.from, c.to, ev);

export interface Fragment {
  title: string;
  from: number;
  to: number;
  intro?: string;
}

/** The chapter's fragments; one fragment covering the whole chapter when none are authored. */
export function fragmentsOf(c: Chapter): Fragment[] {
  return c.fragments?.length ? c.fragments : [{ title: c.title, from: c.from, to: c.to }];
}

/** Years inside [from, to] that have an event, a dated fact or a new office holder. */
export function lessonYears(c: Chapter, from: number, to: number, data: ChronicleData): number[] {
  return yearsWithEntries(data).filter((y) => {
    if (y < from || y > to) return false;
    const s = yearSnapshot(y, data);
    return s.events.some((e) => inSpan(c, from, to, e)) || s.echoes.length > 0 || officeStarts(s.holders, y, c).length > 0;
  });
}

export function chapterYears(c: Chapter, data: ChronicleData): number[] {
  return lessonYears(c, c.from, c.to, data);
}

function officeStarts(holders: Map<string, HolderInYear[]>, year: number, c: Chapter): HolderInYear[] {
  return [...holders.values()].flat().filter((r) => r.holder.from === year && (!c.lanes || c.lanes.includes(r.office.lane)));
}

/** Events no chapter teaches yet — shown on the index so gaps are visible. */
export function untaughtEvents(chapters: readonly Chapter[], data: ChronicleData): TimelineEvent[] {
  return data.events.filter((e) => !chapters.some((c) => inChapter(c, e)));
}

/** One step of a fragment. */
export type Slide =
  | { kind: 'start' }
  | { kind: 'event'; year: number; event: TimelineEvent; notes: Child[] }
  | { kind: 'notes'; year: number; notes: Child[] }
  | { kind: 'recap' };

/* -------------------------------------------------------------------------- */
/* Index + chapter overview                                                    */
/* -------------------------------------------------------------------------- */

const sortedChapters = (): Chapter[] => [...getChapters()].sort((a, b) => a.from - b.from);

export function renderIndex(root: HTMLElement): void {
  const data = chronicleData();
  const chapters = sortedChapters();
  const parts = HISTORY_PARTS.map((part) => {
    const mine = chapters.filter((c) => c.part === part);
    return el('section', { class: 'hl-part' }, [
      el('h2', { class: 'hl-part-title', text: PART_LABEL[part] }),
      mine.length
        ? el('ol', { class: 'hl-chapters' }, mine.map((c) =>
            el('li', {}, [
              el('button', { class: 'hl-chapter-btn', type: 'button', onClick: () => navigate(`${HISTORY_PATH}/${c.id}`) }, [
                el('span', { class: 'hl-chapter-years tnum', text: `${yearLabel(c.from)} – ${yearLabel(c.to)}` }),
                el('span', { class: 'hl-chapter-title', text: c.title }),
                el('span', { class: 'hl-chapter-meta', text: `${fragmentsOf(c).length} lessons · ${data.events.filter((e) => inChapter(c, e)).length} events` }),
                icon('arrow-right', 16),
              ]),
            ]),
          ))
        : el('p', { class: 'hl-muted', text: 'Coming soon.' }),
    ]);
  });
  const gaps = untaughtEvents(chapters, data).length;
  const glossary = [...getGlossary()].sort((a, b) => a.term.localeCompare(b.term));
  mount(
    root,
    el('div', { class: 'hl' }, [
      el('div', { class: 'hl-top' }, [
        el('h1', { class: 'page-title', text: 'History, year by year' }),
        el('button', { class: 'btn btn-secondary', type: 'button', onClick: () => navigate(YEAR_PATH) }, [el('span', { text: 'Look up a year' }), icon('search', 14)]),
      ]),
      el('p', { class: 'page-lead', text: 'Each chapter is split into short lessons. A lesson starts with the people and words you need, then goes one event at a time, and ends with a recap.' }),
      gaps > 0 ? el('p', { class: 'hl-muted', text: `${gaps} timeline events are not in a chapter yet.` }) : null,
      (() => {
        const n = yearDrillCounts();
        return el('button', { class: 'hl-banner', type: 'button', onClick: () => navigate(YEARS_PATH) }, [
          icon('calendar', 22),
          el('span', { class: 'hl-banner-text' }, [
            el('strong', { text: 'Year drill' }),
            el('span', { text: `${n.due} years due for review · ${n.fresh} not yet drilled. Fix the year to each event.` }),
          ]),
          icon('arrow-right', 16),
        ]);
      })(),
      ...parts,
      glossary.length
        ? el('section', { class: 'hl-part', attrs: { id: 'glossary' } }, [el('h2', { class: 'hl-part-title', text: `Words to know (${glossary.length})` }), wordsToKnow(glossary)])
        : null,
    ]),
  );
}

function renderOverview(root: HTMLElement, c: Chapter, data: ChronicleData): void {
  const frags = fragmentsOf(c);
  mount(
    root,
    el('div', { class: 'hl' }, [
      el('button', { class: 'btn btn-ghost hl-back', type: 'button', onClick: () => navigate(HISTORY_PATH) }, [el('span', { text: '‹ All chapters' })]),
      el('p', { class: 'hl-kicker', text: `${PART_LABEL[c.part]} · ${yearLabel(c.from)} – ${yearLabel(c.to)}` }),
      el('h1', { class: 'page-title', text: c.title }),
      el('div', { class: 'hl-prose md' }, renderMarkdown(c.intro)),
      el('ol', { class: 'hl-frags' }, frags.map((f, i) => {
        const events = data.events.filter((e) => inSpan(c, f.from, f.to, e)).length;
        return el('li', {}, [
          el('button', { class: 'hl-frag-btn', type: 'button', onClick: () => navigate(`${HISTORY_PATH}/${c.id}/${i + 1}`) }, [
            el('span', { class: 'hl-frag-no tnum', text: String(i + 1) }),
            el('span', { class: 'hl-frag-body' }, [
              el('strong', { text: f.title }),
              el('span', { class: 'hl-muted tnum', text: `${yearLabel(f.from)} – ${yearLabel(f.to)} · ${events} events` }),
              f.intro ? el('span', { class: 'hl-frag-intro', text: f.intro }) : null,
            ]),
            icon('arrow-right', 16),
          ]),
        ]);
      })),
      c.takeaways?.length ? el('section', { class: 'hl-section' }, [el('h2', { text: 'Key takeaways' }), el('ul', { class: 'hl-list' }, c.takeaways.map((t) => el('li', { text: t })))]) : null,
      el('p', { class: 'hl-source', text: `Source: ${c.source}` }),
    ]),
  );
}

/* -------------------------------------------------------------------------- */
/* Fragment player                                                             */
/* -------------------------------------------------------------------------- */

const peopleOf = (ev: TimelineEvent): string[] =>
  [...new Set([...(ev.participants ?? []).map((p) => p.personId), ...(ev.personIds ?? [])])];

const ul = (items: readonly Child[], cls = 'hl-list'): HTMLElement => el('ul', { class: cls }, items.map((t) => el('li', {}, [t])));

function part(title: string, body: Child): HTMLElement {
  return el('section', { class: 'hl-part-block' }, [el('h3', { class: 'hl-h', text: title }), body]);
}

export function sidesAside(ev: TimelineEvent): HTMLElement | null {
  const fight = ev.kind === 'battle';
  if (!ev.sides?.length) {
    if (!ev.parties?.length && !ev.signatories?.length) return null;
    return el('div', { class: 'hl-sides' }, [
      ev.parties?.length ? el('div', { class: 'hl-side-card' }, [el('p', { class: 'hl-side-name', text: fight ? 'Who fought' : 'Between' }), ...ev.parties.map((x) => el('p', { text: x }))]) : null,
      ev.signatories?.length ? el('div', { class: 'hl-side-card' }, [el('p', { class: 'hl-side-name', text: fight ? 'Led by' : 'Signed by' }), ...ev.signatories.map((x) => el('p', { text: x }))]) : null,
    ]);
  }
  return el('div', { class: 'hl-sides' }, ev.sides.map((s, i) =>
    el('div', { class: 'hl-side-card' }, [
      el('p', { class: 'hl-side-name', text: `${i === 0 ? '' : fight ? 'vs ' : '& '}${s.name}` }),
      s.ruler ? el('p', {}, [el('span', { class: 'hl-muted', text: 'Ruler: ' }), el('span', { text: s.ruler })]) : null,
      s.commanders?.length ? el('p', {}, [el('span', { class: 'hl-muted', text: fight ? 'Led by: ' : 'Signed / negotiated by: ' }), el('span', { text: s.commanders.join(', ') })]) : null,
      s.allies?.length ? el('p', {}, [el('span', { class: 'hl-muted', text: 'Allies: ' }), el('span', { text: s.allies.join(', ') })]) : null,
    ]),
  ));
}

function eventSlide(ev: TimelineEvent, notes: Child[], data: ChronicleData, show: (p: Person) => void, prev?: TimelineEvent): HTMLElement {
  const byId = new Map(data.people.map((p) => [p.id, p]));
  const pts = new Map((ev.participants ?? []).map((p) => [p.personId, p]));
  const people = peopleOf(ev).map((id) => byId.get(id)).filter((p): p is Person => p !== undefined);

  const main: Child[] = [el('p', { class: 'hl-lead', text: ev.summary }), el('div', { class: 'hl-prose md' }, renderMarkdown(ev.detail))];
  if (ev.causes?.length) main.push(part('Why it happened', ul(ev.causes)));
  if (ev.course?.length) main.push(part('What happened', el('ol', { class: 'hl-list hl-steps' }, ev.course.map((t) => el('li', { text: t })))));
  const result: Child[] = [];
  if (ev.outcomes?.length) result.push(ul(ev.outcomes));
  if (ev.losses?.length) result.push(el('p', { class: 'hl-sub', text: 'Losses' }), ul(ev.losses));
  if (ev.gains?.length) result.push(el('p', { class: 'hl-sub', text: 'Who gained' }), ul(ev.gains));
  if (result.length) main.push(part('Result', el('div', {}, result)));
  if (ev.treaties?.length) {
    main.push(part('Treaty', el('div', {}, ev.treaties.map((t) => el('div', { class: 'hl-treaty' }, [
      el('strong', { text: t.year ? `${t.name} (${yearLabel(t.year)})` : t.name }),
      t.between?.length ? el('p', { class: 'hl-muted', text: `Between ${t.between.join(' and ')}` }) : null,
      t.terms?.length ? ul(t.terms) : null,
    ])))));
  }
  if (people.length) {
    main.push(part('Who did what', el('div', { class: 'hl-people' }, people.map((p) => {
      const pt = pts.get(p.id);
      return el('div', { class: 'hl-person' }, [
        avatar(p, 'md'),
        el('div', { class: 'hl-person-body' }, [
          el('button', { class: 'hl-person-name', type: 'button', text: p.name, onClick: () => show(p) }),
          postLine(p, ev.date.year, pt?.post),
          pt?.role ? el('p', { class: 'hl-role', text: pt.role }) : el('p', { class: 'hl-role hl-muted', text: p.summary }),
        ]),
      ]);
    }))));
  }
  const remember = [...(ev.facts ?? []), ...(ev.pairs ?? []).map((p) => `${p.left} — ${p.right}`)];
  if (ev.alsoOn?.length) remember.push(...[...ev.alsoOn].sort((a, b) => a.year - b.year).map((f) => `${yearLabel(f.year)}: ${f.text}`));
  if (remember.length) main.push(el('section', { class: 'hl-remember' }, [el('h3', { class: 'hl-h', text: 'Remember' }), ul(remember)]));
  if (notes.length) main.push(el('section', { class: 'hl-notes' }, [el('h3', { class: 'hl-h', text: `Also in ${yearLabel(ev.date.year)}` }), ul(notes)]));

  return el('article', { class: 'hl-slide' }, [
    el('header', { class: 'hl-slide-head' }, [
      el('p', { class: 'hl-kicker' }, [
        el('span', { class: `hl-kind hl-kind-${ev.kind}`, text: KIND_META[ev.kind].label }),
        el('span', { class: 'tnum', text: ` ${formatYear(ev.date)}` }),
        ev.importance === 3 ? el('span', { class: 'hl-must', text: ' · Must know' }) : null,
        ev.apSpecific ? el('span', { class: 'hl-must', text: ' · AP' }) : null,
      ]),
      el('h2', { class: 'hl-slide-title', text: ev.title }),
    ]),
    el('div', { class: 'hl-slide-grid' }, [
      el('aside', { class: 'hl-slide-aside' }, [
        el('p', { class: 'hl-big-year tnum', text: yearLabel(ev.date.year) }),
        ev.yearHook ? el('p', { class: 'hl-hook' }, [el('span', { class: 'hl-hook-label', text: 'Remember the year' }), el('span', { text: ev.yearHook })]) : null,
        prev ? el('p', { class: 'hl-gap tnum', text: `${gapPhrase(prev.date.year, ev.date.year)} ${prev.title} (${yearLabel(prev.date.year)})` }) : null,
        figures(ev.images, 'hl-figs'),
        ev.place ? el('p', { class: 'hl-place' }, [el('span', { class: 'hl-muted', text: 'Where: ' }), el('span', { text: ev.place })]) : null,
        sidesAside(ev),
      ]),
      el('div', { class: 'hl-slide-main' }, main),
    ]),
  ]);
}

/** "Also in this year" lines: new office holders and dated facts. */
function yearNotes(year: number, c: Chapter, data: ChronicleData, show: (p: Person) => void): Child[] {
  const s = yearSnapshot(year, data);
  const byId = new Map(data.people.map((p) => [p.id, p]));
  const notes: Child[] = officeStarts(s.holders, year, c).map(({ office, holder }) => {
    const p = holder.personId ? byId.get(holder.personId) : undefined;
    return el('span', { class: 'hl-note' }, [
      avatar(p),
      p ? el('button', { class: 'hl-person-name', type: 'button', text: holder.name, onClick: () => show(p) }) : el('strong', { text: holder.name }),
      el('span', { text: ` becomes ${office.label} (${yearLabel(holder.from)} – ${yearLabel(holder.to)})${holder.note ? ` — ${holder.note}` : ''}` }),
    ]);
  });
  for (const f of s.echoes) notes.push(f.text);
  return notes;
}

export function buildSlides(c: Chapter, f: Fragment, data: ChronicleData, show: (p: Person) => void): Slide[] {
  const slides: Slide[] = [{ kind: 'start' }];
  for (const year of lessonYears(c, f.from, f.to, data)) {
    const events = yearSnapshot(year, data).events.filter((e) => inSpan(c, f.from, f.to, e));
    const notes = yearNotes(year, c, data, show);
    if (events.length === 0) slides.push({ kind: 'notes', year, notes });
    events.forEach((event, i) => slides.push({ kind: 'event', year, event, notes: i === events.length - 1 ? notes : [] }));
  }
  slides.push({ kind: 'recap' });
  return slides;
}

function startSlide(c: Chapter, f: Fragment, events: TimelineEvent[], data: ChronicleData, show: (p: Person) => void): HTMLElement {
  const byId = new Map(data.people.map((p) => [p.id, p]));
  const cast = [...new Set(events.flatMap(peopleOf))].map((id) => byId.get(id)).filter((p): p is Person => p !== undefined)
    .sort((a, b) => b.importance - a.importance || (a.born ?? 0) - (b.born ?? 0));
  const matcher = termMatcher(getGlossary());
  const castText = cast.map((p) => roleAt(p, f.from)?.title ?? p.roles?.[0]?.title ?? '').join('\n');
  const terms: GlossaryTerm[] = matcher.find([f.intro ?? '', ...events.map(eventText), castText].join('\n'));
  return el('article', { class: 'hl-slide' }, [
    el('header', { class: 'hl-slide-head' }, [
      el('p', { class: 'hl-kicker', text: `${c.title} · ${yearLabel(f.from)} – ${yearLabel(f.to)}` }),
      el('h2', { class: 'hl-slide-title', text: f.title }),
    ]),
    f.intro ? el('p', { class: 'hl-lead', text: f.intro }) : null,
    el('p', { class: 'hl-muted', text: `${events.length} events in this lesson. First meet the people and the words; then go event by event.` }),
    cast.length
      ? part(`People you will meet (${cast.length})`, el('div', { class: 'hl-cast' }, cast.map((p) =>
          el('button', { class: 'hl-cast-card', type: 'button', onClick: () => show(p) }, [
            avatar(p, 'lg'),
            el('span', { class: 'hl-cast-text' }, [
              el('strong', { text: p.name }),
              el('span', { class: 'hl-muted', text: `${CATEGORY_LABEL[p.category]} · ${lifeLabel(p)}` }),
              el('span', { text: p.summary }),
            ]),
          ]),
        )))
      : null,
    terms.length ? part(`Words to know (${terms.length})`, wordsToKnow(terms)) : null,
  ]);
}

function recapSlide(c: Chapter, f: Fragment, events: TimelineEvent[], data: ChronicleData, isLast: boolean): HTMLElement {
  const byId = new Map(data.people.map((p) => [p.id, p]));
  const pairs: Pair[] = [];
  const seen = new Set<string>();
  for (const e of events) for (const p of e.pairs ?? []) {
    if (!seen.has(p.left) && ![...pairs].some((x) => x.right === p.right)) {
      seen.add(p.left);
      pairs.push(p);
    }
  }
  return el('article', { class: 'hl-slide' }, [
    el('header', { class: 'hl-slide-head' }, [el('p', { class: 'hl-kicker', text: 'Recap' }), el('h2', { class: 'hl-slide-title', text: f.title })]),
    el('div', { class: 'hl-table-wrap' }, [
      el('table', { class: 'hl-recap' }, [
        el('thead', {}, [el('tr', {}, ['Year', 'Event', 'Key people', 'Result'].map((h) => el('th', { attrs: { scope: 'col' }, text: h })))]),
        el('tbody', {}, events.map((e) => el('tr', {}, [
          el('td', { class: 'tnum', text: formatYear(e.date) }),
          el('td', { text: e.title }),
          el('td', { text: peopleOf(e).map((id) => byId.get(id)?.name).filter(Boolean).slice(0, 3).join(', ') }),
          el('td', { text: e.outcomes?.[0] ?? e.summary }),
        ]))),
      ]),
    ]),
    isLast && c.takeaways?.length ? part('Chapter takeaways', ul(c.takeaways)) : null,
    part('Year drill: pick the year for each event', yearDrill(events, f.from)),
    pairs.length >= 3 ? part('Check yourself: match the following', matchQuiz(pairs.slice(0, 8), f.from)) : null,
    el('p', { class: 'hl-source', text: `Source: ${c.source}` }),
  ]);
}

function renderFragment(root: HTMLElement, c: Chapter, n: number, data: ChronicleData): void {
  const frags = fragmentsOf(c);
  const f = frags[n - 1]!;
  const show = (p: Person): void => openPersonCard(p, data, (y) => navigate(`${YEAR_PATH}?y=${y}`));
  const slides = buildSlides(c, f, data, show);
  const events = slides.flatMap((s) => (s.kind === 'event' ? [s.event] : []));
  let at = 0;

  const stage = el('div', { class: 'hl-stage', attrs: { 'aria-live': 'polite' } });
  const dots = el('nav', { class: 'hl-dots', attrs: { 'aria-label': 'Steps in this lesson' } });
  const counter = el('span', { class: 'hl-counter tnum' });
  const prev = el('button', { class: 'btn btn-secondary', type: 'button', text: '‹ Back', onClick: () => go(at - 1) });
  const next = el('button', { class: 'btn btn-primary', type: 'button', onClick: () => go(at + 1) });

  // Several events in one year are numbered: 1765 ·1, 1765 ·2.
  const perYear = new Map<number, number>();
  for (const s of slides) if (s.kind === 'event' || s.kind === 'notes') perYear.set(s.year, (perYear.get(s.year) ?? 0) + 1);
  const seenYear = new Map<number, number>();
  const labels = slides.map((s) => {
    if (s.kind === 'start') return 'Start';
    if (s.kind === 'recap') return 'Recap';
    const base = yearLabel(s.year).replace(' CE', '');
    if ((perYear.get(s.year) ?? 0) < 2) return base;
    const k = (seenYear.get(s.year) ?? 0) + 1;
    seenYear.set(s.year, k);
    return `${base} ·${k}`;
  });
  const dotLabel = (s: Slide): string => labels[slides.indexOf(s)]!;
  /** The nearest earlier event in this lesson from a different year — used for "7 years after Plassey". */
  const previousEvent = (i: number): TimelineEvent | undefined => {
    const cur = slides[i];
    if (cur?.kind !== 'event') return undefined;
    for (let k = i - 1; k >= 0; k--) {
      const s = slides[k]!;
      if (s.kind === 'event' && s.event.date.year !== cur.event.date.year) return s.event;
    }
    return undefined;
  };

  function draw(): void {
    const s = slides[at]!;
    const node =
      s.kind === 'start' ? startSlide(c, f, events, data, show)
        : s.kind === 'recap' ? recapSlide(c, f, events, data, n === frags.length)
          : s.kind === 'event' ? eventSlide(s.event, s.notes, data, show, previousEvent(at))
            : el('article', { class: 'hl-slide' }, [
                el('header', { class: 'hl-slide-head' }, [el('p', { class: 'hl-kicker', text: 'Year notes' }), el('h2', { class: 'hl-slide-title tnum', text: yearLabel(s.year) })]),
                ul(s.notes),
              ]);
    mount(stage, node);
    counter.textContent = `${at + 1} / ${slides.length}`;
    mount(dots, ...slides.map((sl, i) =>
      el('button', {
        class: `hl-dot${i === at ? ' is-current' : ''}${i < at ? ' is-done' : ''}`,
        type: 'button',
        text: dotLabel(sl),
        ariaLabel: `Step ${i + 1}: ${sl.kind === 'event' ? sl.event.title : dotLabel(sl)}`,
        attrs: i === at ? { 'aria-current': 'step' } : {},
        onClick: () => go(i),
      }),
    ));
    prev.toggleAttribute('disabled', at === 0);
    const last = at === slides.length - 1;
    const nextFrag = frags[n];
    next.textContent = last ? (nextFrag ? `Next lesson: ${nextFrag.title} ›` : 'Back to chapter ›') : 'Next ›';
    dots.querySelector('.is-current')?.scrollIntoView?.({ block: 'nearest', inline: 'center' });
  }

  function go(i: number): void {
    if (i >= slides.length) {
      navigate(n < frags.length ? `${HISTORY_PATH}/${c.id}/${n + 1}` : `${HISTORY_PATH}/${c.id}`);
      return;
    }
    at = Math.max(0, i);
    draw();
    if (typeof window.scrollTo === 'function' && !navigator.userAgent.includes('jsdom')) window.scrollTo({ top: 0 });
  }

  const onKey = (e: KeyboardEvent): void => {
    if (!root.isConnected) {
      document.removeEventListener('keydown', onKey);
      return;
    }
    const t = e.target as HTMLElement | null;
    if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
    if (e.key === 'ArrowRight') go(at + 1);
    else if (e.key === 'ArrowLeft' && at > 0) go(at - 1);
  };
  document.addEventListener('keydown', onKey);

  mount(
    root,
    el('div', { class: 'hl hl-player' }, [
      el('div', { class: 'hl-player-top' }, [
        el('button', { class: 'btn btn-ghost hl-back', type: 'button', onClick: () => navigate(`${HISTORY_PATH}/${c.id}`) }, [el('span', { text: `‹ ${c.title}` })]),
        el('span', { class: 'hl-muted', text: `Lesson ${n} of ${frags.length}` }),
      ]),
      dots,
      stage,
      el('div', { class: 'hl-pager' }, [prev, counter, next]),
    ]),
  );
  draw();
}

/** `/topics/history/:id` (overview) and `/topics/history/:id/:n` (lesson). */
export function renderChapter(root: HTMLElement): void {
  const id = routeParam(`${HISTORY_PATH}/:id/:n`, 'id') ?? routeParam(`${HISTORY_PATH}/:id`, 'id');
  const nRaw = routeParam(`${HISTORY_PATH}/:id/:n`, 'n');
  const c = sortedChapters().find((x) => x.id === id);
  if (!c) {
    renderIndex(root);
    return;
  }
  const data = chronicleData();
  const n = Number(nRaw);
  if (nRaw !== undefined && Number.isInteger(n) && n >= 1 && n <= fragmentsOf(c).length) renderFragment(root, c, n, data);
  else renderOverview(root, c, data);
}
