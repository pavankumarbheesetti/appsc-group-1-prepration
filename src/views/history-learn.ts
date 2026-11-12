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
import { getChapters, getGlossary, getNoteById } from '../content/loader';
import type { NoteItem } from '../content/types';
import { buildNoteArticle } from './notes';
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
import {
  askedPapers,
  meanwhile,
  meanwhileWindow,
  nearestPeg,
  neighbours,
  relLabel,
  resolvePegs,
  seededShuffle,
  splitPaperTag,
  spread,
  type Peg,
} from '../lib/chronology';
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
    return s.events.some((e) => inSpan(c, from, to, e)) || echoesFor(c, s.echoes).length > 0 || officeStarts(s.holders, y, c).length > 0;
  });
}

export function chapterYears(c: Chapter, data: ChronicleData): number[] {
  return lessonYears(c, c.from, c.to, data);
}

/** New holders this year; an Andhra-only chapter shows only Andhra thrones and posts. */
function officeStarts(holders: Map<string, HolderInYear[]>, year: number, c: Chapter): HolderInYear[] {
  return [...holders.values()].flat().filter((r) =>
    r.holder.from === year && (!c.lanes || c.lanes.includes(r.office.lane)) && (!c.apOnly || r.office.apSpecific === true));
}

/** "Also in this year" facts; an Andhra-only chapter keeps only those of Andhra events. */
function echoesFor<T extends { event?: TimelineEvent }>(c: Chapter, echoes: readonly T[]): T[] {
  return c.apOnly ? echoes.filter((f) => f.event?.apSpecific === true) : [...echoes];
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
  const pegs = resolvePegs(c.pegs ?? [], data.events);
  const all = data.events.filter((e) => inChapter(c, e)).sort((a, b) => a.date.year - b.date.year);
  mount(
    root,
    el('div', { class: 'hl' }, [
      el('button', { class: 'btn btn-ghost hl-back', type: 'button', onClick: () => navigate(HISTORY_PATH) }, [el('span', { text: '‹ All chapters' })]),
      el('p', { class: 'hl-kicker', text: `${PART_LABEL[c.part]} · ${yearLabel(c.from)} – ${yearLabel(c.to)}` }),
      el('h1', { class: 'page-title', text: c.title }),
      el('div', { class: 'hl-prose md' }, renderMarkdown(c.intro)),
      pegs.length
        ? el('section', { class: 'hl-section hl-pegs' }, [
            el('h2', { text: `Learn these ${pegs.length} year pegs first` }),
            el('p', { class: 'hl-muted', text: 'Every other event in this chapter is shown as "peg + years". Fix the pegs once, and the rest hangs on them.' }),
            el('ol', { class: 'hl-peg-list' }, pegs.map((p, i) => el('li', {}, [
              el('span', { class: 'hl-chain-year tnum', text: yearLabel(p.year) }),
              el('span', { class: 'hl-chain-body' }, [
                el('strong', { text: p.title }),
                i > 0 ? el('span', { class: 'hl-muted tnum', text: ` (${relLabel(pegs[i - 1]!.year, p.year)} after the last peg)` }) : null,
                el('span', { class: 'hl-chain-next', text: p.hook }),
              ]),
            ]))),
          ])
        : null,
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
      all.length
        ? el('details', { class: 'hl-section hl-glance' }, [
            el('summary', { text: `All ${all.length} events at a glance` }),
            el('div', { class: 'hl-table-wrap' }, [
              el('table', { class: 'hl-recap' }, [
                el('thead', {}, [el('tr', {}, ['Year', 'Event', 'Peg + years', 'Asked'].map((h) => el('th', { attrs: { scope: 'col' }, text: h })))]),
                el('tbody', {}, all.map((e) => {
                  const p = nearestPeg(e.date.year, pegs);
                  const asked = askedPapers(e).length;
                  return el('tr', {}, [
                    el('td', { class: 'tnum', text: formatYear(e.date) }),
                    el('td', { text: e.title }),
                    el('td', { class: 'tnum', text: p ? (p.eventId === e.id ? 'peg' : `${p.title.split(/[:—–(]/)[0]!.trim()} ${relLabel(p.year, e.date.year)}`) : '' }),
                    el('td', { class: 'tnum', text: asked ? String(asked) : '' }),
                  ]);
                })),
              ]),
            ]),
          ])
        : null,
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

/** What an event slide needs to know about the lesson around it. */
interface SlideCtx {
  /** This lesson's events, in time order. */
  lesson: TimelineEvent[];
  pegs: Peg[];
  /** Events outside this chapter, for "meanwhile elsewhere". */
  pool: TimelineEvent[];
  jump: (eventId: string) => void;
  matcher: ReturnType<typeof termMatcher>;
}

/** Small "G-II 2018" tags for the papers that asked a point. */
const paperChips = (papers: readonly string[]): HTMLElement | null =>
  papers.length ? el('span', { class: 'hl-papers' }, papers.map((p) => el('span', { class: 'hl-paper', text: p }))) : null;

/** The story in time: the peg it hangs on and the events just before and after it. */
function timeStrip(ev: TimelineEvent, ctx: SlideCtx): HTMLElement {
  const i = ctx.lesson.findIndex((e) => e.id === ev.id);
  const { before, after } = neighbours(ctx.lesson, i < 0 ? 0 : i, 2);
  const row = (e: TimelineEvent, cls: string, label: string): HTMLElement =>
    el('li', { class: `hl-strip-row ${cls}` }, [
      el('span', { class: 'hl-strip-rel tnum', text: label }),
      el('span', { class: 'hl-strip-year tnum', text: yearLabel(e.date.year) }),
      cls === 'is-now'
        ? el('strong', { class: 'hl-strip-title', text: e.title })
        : el('button', { class: 'hl-strip-title hl-linkish', type: 'button', text: e.title, onClick: () => ctx.jump(e.id) }),
    ]);
  return el('section', { class: 'hl-strip', attrs: { 'aria-label': 'Where this sits in time' } }, [
    el('p', { class: 'hl-hook-label', text: 'Where this sits' }),
    el('ol', { class: 'hl-strip-list' }, [
      ...before.map((e) => row(e, 'is-before', relLabel(ev.date.year, e.date.year))),
      row(ev, 'is-now', 'now'),
      ...after.map((e) => row(e, 'is-after', relLabel(ev.date.year, e.date.year))),
    ]),
  ]);
}

/** "Peg: Satavahanas begin (230 BCE) + 30 years" — every year hung on a year already learnt. */
function pegLine(ev: TimelineEvent, pegs: readonly Peg[]): HTMLElement | null {
  const p = nearestPeg(ev.date.year, pegs);
  if (!p) return null;
  if (p.eventId === ev.id) {
    return el('p', { class: 'hl-peg is-peg' }, [
      el('span', { class: 'hl-hook-label', text: 'Year peg — learn this one by heart' }),
      el('span', { text: p.hook }),
    ]);
  }
  return el('p', { class: 'hl-peg' }, [
    el('span', { class: 'hl-hook-label', text: 'Hang it on a peg' }),
    el('span', {}, [el('strong', { class: 'tnum', text: `${yearLabel(p.year)} ${p.title}` }), el('span', { class: 'tnum', text: `  ${relLabel(p.year, ev.date.year)}` })]),
  ]);
}

function eventSlide(ev: TimelineEvent, notes: Child[], data: ChronicleData, show: (p: Person) => void, ctx: SlideCtx): HTMLElement {
  const byId = new Map(data.people.map((p) => [p.id, p]));
  const pts = new Map((ev.participants ?? []).map((p) => [p.personId, p]));
  const people = peopleOf(ev).map((id) => byId.get(id)).filter((p): p is Person => p !== undefined);
  const papers = askedPapers(ev);

  const main: Child[] = [el('p', { class: 'hl-lead', text: ev.summary })];
  if (ev.before) main.push(part('The story so far', el('div', { class: 'hl-prose md' }, renderMarkdown(ev.before))));
  main.push(el('div', { class: 'hl-prose md' }, renderMarkdown(ev.detail)));
  if (ev.causes?.length) main.push(part('Why it happened', ul(ev.causes)));
  if (ev.course?.length) main.push(part('What happened', el('ol', { class: 'hl-list hl-steps' }, ev.course.map((t) => el('li', { text: t })))));
  const result: Child[] = [];
  if (ev.outcomes?.length) result.push(ul(ev.outcomes));
  if (ev.losses?.length) result.push(el('p', { class: 'hl-sub', text: 'Losses' }), ul(ev.losses));
  if (ev.gains?.length) result.push(el('p', { class: 'hl-sub', text: 'Who gained' }), ul(ev.gains));
  if (result.length) main.push(part('Result', el('div', {}, result)));
  if (ev.after) main.push(part('What it led to', el('div', { class: 'hl-prose md' }, renderMarkdown(ev.after))));
  if (ev.today) main.push(part('Still with us today', el('div', { class: 'hl-prose md' }, renderMarkdown(ev.today))));
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
  if (ev.examAngle?.length) {
    main.push(el('section', { class: 'hl-exam' }, [
      el('h3', { class: 'hl-h', text: 'How APPSC asks this' }),
      el('ol', { class: 'hl-exam-list' }, ev.examAngle.map((x) => el('li', {}, [
        el('p', { class: 'hl-exam-point' }, [el('strong', { text: x.point }), paperChips(x.asked ?? [])]),
        el('div', { class: 'hl-prose md hl-exam-context' }, renderMarkdown(x.context)),
      ]))),
    ]));
  }
  const facts = (ev.facts ?? []).map(splitPaperTag);
  const remember: Child[] = [
    ...facts.map((f) => el('span', {}, [el('span', { text: f.text }), paperChips(f.paper ? [f.paper] : [])])),
    ...(ev.pairs ?? []).map((p) => `${p.left} — ${p.right}`),
  ];
  if (ev.alsoOn?.length) remember.push(...[...ev.alsoOn].sort((a, b) => a.year - b.year).map((f) => `${yearLabel(f.year)}: ${f.text}`));
  if (remember.length) main.push(el('section', { class: 'hl-remember' }, [el('h3', { class: 'hl-h', text: ev.examAngle?.length ? 'Quick facts' : 'Remember' }), ul(remember)]));
  const others = meanwhile(ev, ctx.pool, meanwhileWindow(ev.date.year));
  if (others.length) {
    main.push(part('Meanwhile, elsewhere', ul(others.map((e) => el('span', {}, [
      el('strong', { class: 'tnum', text: `${yearLabel(e.date.year)} (${relLabel(ev.date.year, e.date.year)}): ` }),
      el('span', { text: `${e.title} — ${e.summary}` }),
    ])))));
  }
  const linked = (ev.noteIds ?? []).map((id) => getNoteById(id)).filter((n): n is NoteItem => n !== undefined);
  if (linked.length) {
    main.push(el('section', { class: 'hl-fullnotes' }, [
      el('h3', { class: 'hl-h', text: `Full notes for this event (${linked.length})` }),
      el('p', { class: 'hl-muted', text: 'Everything the topic notes teach about this event. Open each one; nothing here is left for later.' }),
      ...linked.map((n, i) => el('details', { class: 'hl-fullnote', attrs: i === 0 ? { open: '' } : {} }, [
        el('summary', { text: n.title.replace(/\*\*/g, '') }),
        buildNoteArticle(n, `${ev.id}-n${i}`, { titleTag: 'h4' }),
      ])),
    ]));
  }
  const terms = ctx.matcher.find(eventText(ev));
  if (terms.length) {
    main.push(el('details', { class: 'hl-words' }, [
      el('summary', { text: `Words on this page (${terms.length})` }),
      wordsToKnow(terms),
    ]));
  }
  if (notes.length) main.push(el('section', { class: 'hl-notes' }, [el('h3', { class: 'hl-h', text: `Also in ${yearLabel(ev.date.year)}` }), ul(notes)]));

  return el('article', { class: 'hl-slide' }, [
    el('header', { class: 'hl-slide-head' }, [
      el('p', { class: 'hl-kicker' }, [
        el('span', { class: `hl-kind hl-kind-${ev.kind}`, text: KIND_META[ev.kind].label }),
        el('span', { class: 'tnum', text: ` ${formatYear(ev.date)}` }),
        ev.importance === 3 ? el('span', { class: 'hl-must', text: ' · Must know' }) : null,
        ev.apSpecific ? el('span', { class: 'hl-must', text: ' · AP' }) : null,
        papers.length ? el('span', { class: 'hl-must', text: papers.length >= 2 ? ` · Repeat topic: asked in ${papers.length} papers` : ' · Asked in 1 paper' }) : null,
      ]),
      el('h2', { class: 'hl-slide-title', text: ev.title }),
    ]),
    el('div', { class: 'hl-slide-grid' }, [
      el('aside', { class: 'hl-slide-aside' }, [
        el('p', { class: 'hl-big-year tnum', text: yearLabel(ev.date.year) }),
        ev.yearHook ? el('p', { class: 'hl-hook' }, [el('span', { class: 'hl-hook-label', text: 'Remember the year' }), el('span', { text: ev.yearHook })]) : null,
        ev.mnemonic ? el('p', { class: 'hl-hook hl-mnemonic' }, [el('span', { class: 'hl-hook-label', text: 'Memory trick' }), el('span', { text: ev.mnemonic })]) : null,
        pegLine(ev, ctx.pegs),
        timeStrip(ev, ctx),
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
  for (const f of echoesFor(c, s.echoes)) notes.push(f.text);
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

/** The lesson as one chain: each event, then what it led to. Read top to bottom like a story. */
function storyChain(events: readonly TimelineEvent[], pegs: readonly Peg[]): HTMLElement {
  return el('ol', { class: 'hl-chain' }, events.map((e, i) => {
    const prev = events[i - 1];
    const lead = (e.after ?? e.outcomes?.[0] ?? '').replace(/\s+/g, ' ');
    const short = lead.length > 180 ? `${lead.slice(0, 177).replace(/\s\S*$/, '')}…` : lead;
    const peg = pegs.find((p) => p.eventId === e.id);
    return el('li', { class: `hl-chain-item${peg ? ' is-peg' : ''}` }, [
      el('span', { class: 'hl-chain-year tnum', text: yearLabel(e.date.year) }),
      el('span', { class: 'hl-chain-body' }, [
        el('strong', { text: e.title }),
        prev ? el('span', { class: 'hl-muted tnum', text: ` (${relLabel(prev.date.year, e.date.year)} after the last)` }) : null,
        short ? el('span', { class: 'hl-chain-next', text: `→ ${short}` }) : null,
      ]),
    ]);
  }));
}

/** Tap the events from oldest to newest. Teaches order without asking for exact years. */
export function orderGame(events: readonly TimelineEvent[], seed: number): HTMLElement {
  const picks = spread(events, 6);
  const right = [...picks].sort((a, b) => a.date.year - b.date.year);
  const shown = seededShuffle(picks, seed);
  let next = 0;
  const status = el('p', { class: 'hl-muted', attrs: { 'aria-live': 'polite' }, text: 'Tap the oldest first.' });
  const buttons = shown.map((e) => {
    const b = el('button', { class: 'hl-order-btn', type: 'button', text: e.title, onClick: () => {
      if (b.classList.contains('is-done')) return;
      if (right[next]?.id === e.id) {
        next += 1;
        b.classList.add('is-done');
        b.textContent = `${next}. ${e.title} — ${yearLabel(e.date.year)}`;
        status.textContent = next === right.length ? 'All in order. Read the chain above once more.' : 'Right. Next?';
      } else {
        b.classList.add('is-wrong');
        setTimeout(() => b.classList.remove('is-wrong'), 600);
        const want = right[next]!;
        status.textContent = `Not yet: ${e.title} is ${relLabel(want.date.year, e.date.year)} from the one that comes next.`;
      }
    } });
    return b;
  });
  return el('div', { class: 'hl-order' }, [status, el('div', { class: 'hl-order-grid' }, buttons)]);
}

function recapSlide(c: Chapter, f: Fragment, events: TimelineEvent[], data: ChronicleData, isLast: boolean, pegs: readonly Peg[]): HTMLElement {
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
    part('The story in order', storyChain(events, pegs)),
    events.length >= 3 ? part('Put them in order', orderGame(events, Math.abs(f.from) + events.length)) : null,
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
  const pegs = resolvePegs(c.pegs ?? [], data.events);
  const ctx: SlideCtx = {
    lesson: events,
    pegs,
    pool: data.events.filter((e) => !e.timeless && !inChapter(c, e)),
    jump: (id) => {
      const k = slides.findIndex((s) => s.kind === 'event' && s.event.id === id);
      if (k >= 0) go(k);
    },
    matcher: termMatcher(getGlossary()),
  };
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

  function draw(): void {
    const s = slides[at]!;
    const node =
      s.kind === 'start' ? startSlide(c, f, events, data, show)
        : s.kind === 'recap' ? recapSlide(c, f, events, data, n === frags.length, pegs)
          : s.kind === 'event' ? eventSlide(s.event, s.notes, data, show, ctx)
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
