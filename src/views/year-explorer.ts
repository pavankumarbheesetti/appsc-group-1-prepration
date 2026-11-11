/**
 * Year explorer (`#/timeline/year?y=1784`): pick one year and see every event,
 * who held which post, which dynasties ruled, and which people were active.
 * People open a profile card; a year's pairs feed a match-the-following check.
 */
import { getGlossary, getOffices, getPeople, getTimeline } from '../content/loader';
import { activeSpan, type Person } from '../content/chronicle-types';
import type { Pair, TimelineEvent, TimelineImage } from '../content/timeline-types';
import { resolveImage } from '../content/assets';
import { ERA_META, KIND_META, LANE_META, formatYear, mulberry32 } from '../lib/timeline';
import {
  nearestYear,
  parseYear,
  splitPeople,
  searchChronicleEvents,
  searchPeople,
  stepYear,
  yearSnapshot,
  yearsWithEntries,
  type ChronicleData,
  type YearSnapshot,
} from '../lib/year-snapshot';
import { navigate, routeQuery } from '../router/router';
import { el, mount, renderMarkdown, type Child } from './dom';
import { openDialog } from './dialog';
import { icon } from './components/icon';
import { chip } from './components/chip';
import { eventStructure, wordsToKnow } from './event-parts';
import { eventText, termMatcher, type TermMatcher } from '../lib/glossary';

let matcher: TermMatcher | null = null;
const terms = (): TermMatcher => (matcher ??= termMatcher(getGlossary()));

export const YEAR_PATH = '/timeline/year';

/** Quick-jump anchors across the history syllabus. */
const ANCHORS: readonly { label: string; year: number }[] = [
  { label: 'Harappa', year: -2600 },
  { label: 'Rig Veda', year: -1500 },
  { label: 'Buddha', year: -563 },
  { label: 'Alexander', year: -326 },
  { label: 'Maurya', year: -322 },
  { label: 'Ashoka', year: -268 },
  { label: 'Kanishka', year: 78 },
  { label: 'Gupta', year: 320 },
  { label: 'Harsha', year: 606 },
  { label: 'Tarain', year: 1192 },
  { label: 'Sultanate', year: 1206 },
  { label: 'Vijayanagara', year: 1336 },
  { label: 'Panipat I', year: 1526 },
  { label: 'Akbar', year: 1556 },
  { label: 'Plassey', year: 1757 },
  { label: 'Buxar', year: 1764 },
  { label: 'Revolt', year: 1857 },
  { label: 'INC', year: 1885 },
  { label: 'Partition', year: 1905 },
  { label: 'Non-Coop', year: 1920 },
  { label: 'Quit India', year: 1942 },
  { label: 'Freedom', year: 1947 },
  { label: 'Andhra State', year: 1953 },
];

export const CATEGORY_LABEL: Record<Person['category'], string> = {
  ruler: 'Ruler',
  administrator: 'Administrator',
  general: 'General',
  reformer: 'Reformer',
  'freedom-fighter': 'Freedom fighter',
  politician: 'Politician',
  religious: 'Religious figure',
  writer: 'Writer / poet',
  scholar: 'Scholar',
  traveller: 'Traveller',
  scientist: 'Scientist',
  artist: 'Artist',
  other: 'Person',
};

export function chronicleData(): ChronicleData {
  const tl = getTimeline();
  return { events: tl.events, periods: tl.periods, people: getPeople(), offices: getOffices() };
}

export const yearLabel = (y: number): string => formatYear({ year: y });

export function lifeLabel(p: Person): string {
  const c = p.approx ? 'c. ' : '';
  if (p.born !== undefined && p.died !== undefined) return `${c}${yearLabel(p.born)} – ${yearLabel(p.died)}`;
  if (p.born !== undefined) return `b. ${c}${yearLabel(p.born)}`;
  if (p.died !== undefined) return `d. ${c}${yearLabel(p.died)}`;
  const s = activeSpan(p);
  return `active ${yearLabel(s.from)} – ${yearLabel(s.to)}`;
}

export function list(cls: string, items: readonly Child[]): HTMLElement {
  return el('ul', { class: cls, attrs: { role: 'list' } }, items.map((c) => el('li', {}, [c])));
}

export function labelled(label: string, body: Child): HTMLElement {
  return el('div', { class: 'yx-field' }, [el('span', { class: 'yx-field-label', text: label }), body]);
}

/** Figures that resolve to an inlined asset; unknown keys are skipped. */
export function figures(images: readonly TimelineImage[] | undefined, cls = 'yx-figs'): HTMLElement | null {
  const shown = (images ?? []).flatMap((img) => {
    const url = resolveImage(img.src);
    return url ? [{ img, url }] : [];
  });
  if (shown.length === 0) return null;
  return el('div', { class: cls }, shown.map(({ img, url }) => {
    const credit = [img.credit, img.license].filter(Boolean).join(' · ');
    return el('figure', { class: 'yx-fig' }, [
      el('img', { attrs: { src: url, alt: img.alt, loading: 'lazy', decoding: 'async' } }),
      img.caption || credit
        ? el('figcaption', {}, [
            img.caption ? el('span', { text: img.caption }) : null,
            credit ? el('span', { class: 'yx-credit', text: credit }) : null,
          ])
        : null,
    ]);
  }));
}

/** Small round portrait for a person, or null when no image resolves. */
export function avatar(person: Person | undefined, size = 'sm'): HTMLElement | null {
  const img = person?.images?.[0];
  const url = img ? resolveImage(img.src) : undefined;
  if (!person || !img || !url) return null;
  return el('img', { class: `yx-avatar yx-avatar-${size}`, attrs: { src: url, alt: '', loading: 'lazy', decoding: 'async', title: person.name } });
}

export function pairsTable(pairs: readonly Pair[]): HTMLElement {
  return el('table', { class: 'yx-pairs' }, [
    el('tbody', {}, pairs.map((p) => el('tr', {}, [el('td', { text: p.left }), el('td', { text: p.right })]))),
  ]);
}

/* -------------------------------------------------------------------------- */
/* Person card                                                                 */
/* -------------------------------------------------------------------------- */

/** Full person profile; `close` runs before jumping to another year (dialog use). */
function personBody(person: Person, data: ChronicleData, onYear: (y: number) => void, close: () => void, head: { titleId?: string; tail?: Child; level?: 'h2' | 'h3' }): Child[] {
  const body: Child[] = [
    el('div', { class: 'yx-card-head' }, [
      el('div', {}, [
        el(head.level ?? 'h2', { class: 'yx-card-title', text: person.name, attrs: head.titleId ? { id: head.titleId } : {} }),
        el('p', { class: 'yx-card-sub', text: `${CATEGORY_LABEL[person.category]} · ${lifeLabel(person)}` }),
      ]),
      head.tail ?? null,
    ]),
    el('div', { class: 'yx-chips' }, [
      chip({ text: ERA_META[person.era].label, tone: 'default' }),
      chip({ text: LANE_META[person.lane].label, tone: 'default' }),
      ...(person.apSpecific ? [chip({ text: 'AP-specific', tone: 'accent', iconName: 'target' })] : []),
    ]),
    figures(person.images, 'yx-figs yx-figs-person'),
    el('p', { class: 'yx-summary', text: person.summary }),
  ];
  if (person.aka?.length) body.push(labelled('Also known as', el('span', { text: person.aka.join(', ') })));
  if (person.titles?.length) body.push(labelled('Titles', el('span', { text: person.titles.join(', ') })));
  if (person.roles?.length) {
    body.push(
      labelled(
        'Posts held',
        list('yx-roles', person.roles.map((r) =>
          el('button', { class: 'yx-linkish', type: 'button', onClick: () => { close(); onYear(r.from); } }, [
            el('span', { class: 'tnum', text: `${yearLabel(r.from)} – ${yearLabel(r.to)}` }),
            el('span', { text: [r.title, r.howGained, r.appointedBy ? `appointed by ${r.appointedBy}` : '', r.predecessor ? `succeeded ${r.predecessor}` : '', r.howEnded ? `ended: ${r.howEnded}` : ''].filter(Boolean).join(' — ') }),
          ]),
        )),
      ),
    );
  }
  if (person.works?.length) {
    body.push(labelled('Works', list('yx-bullets', person.works.map((w) => (w.note ? `${w.title} — ${w.note}` : w.title)))));
  }
  body.push(labelled('Must-know facts', list('yx-bullets', person.facts)));
  if (person.alsoOn?.length) {
    body.push(labelled('Dates to know', list('yx-roles', [...person.alsoOn].sort((a, b) => a.year - b.year).map((f) =>
      el('button', { class: 'yx-linkish', type: 'button', onClick: () => { close(); onYear(f.year); } }, [
        el('span', { class: 'tnum', text: yearLabel(f.year) }),
        el('span', { text: f.text }),
      ]),
    ))));
  }
  if (person.pairs?.length) body.push(labelled('Pairs', pairsTable(person.pairs)));
  const evs = (person.eventIds ?? [])
    .map((id) => data.events.find((e) => e.id === id))
    .filter((e): e is TimelineEvent => e !== undefined)
    .sort((a, b) => a.date.year - b.date.year);
  const linked = data.events.filter((e) => e.personIds?.includes(person.id) && !evs.includes(e));
  const allEvents = [...evs, ...linked].sort((a, b) => a.date.year - b.date.year);
  if (allEvents.length) {
    body.push(
      labelled(
        'Events',
        list('yx-roles', allEvents.map((e) =>
          el('button', { class: 'yx-linkish', type: 'button', onClick: () => { close(); onYear(e.date.year); } }, [
            el('span', { class: 'tnum', text: formatYear(e.date) }),
            el('span', { text: e.title }),
          ]),
        )),
      ),
    );
  }
  body.push(el('p', { class: 'yx-source', text: person.source }));
  return body;
}

export function personProfile(person: Person, data: ChronicleData, onYear: (y: number) => void): HTMLElement {
  return el('article', { class: 'card yx-profile' }, personBody(person, data, onYear, () => undefined, { level: 'h3' }));
}

export function openPersonCard(person: Person, data: ChronicleData, onYear: (y: number) => void): void {
  const titleId = `yx-person-${person.id}`;
  const closeBtn = el('button', { class: 'icon-btn', type: 'button', ariaLabel: 'Close' }, [icon('x', 18)]);
  const body = personBody(person, data, onYear, () => close(), { titleId, tail: closeBtn });
  const panel = el('div', { class: 'yx-card', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId } }, body);
  const scrim = el('div', { class: 'yx-scrim' }, [panel]);
  document.body.append(scrim);
  const ctl = openDialog({ panel, scrim, onClose: () => scrim.remove() });
  const close = (): void => ctl.close();
  closeBtn.addEventListener('click', close);
}

/* -------------------------------------------------------------------------- */
/* Match-the-following self-check                                              */
/* -------------------------------------------------------------------------- */

/** Up to 5 pairs with distinct sides, shuffled with a year-seeded RNG. */
export function pickMatchPairs(snap: YearSnapshot, max = 5): Pair[] {
  const all: Pair[] = [];
  for (const e of [...snap.events, ...snap.ongoing]) all.push(...(e.pairs ?? []));
  for (const p of snap.people) all.push(...(p.pairs ?? []));
  const seenL = new Set<string>();
  const seenR = new Set<string>();
  const uniq = all.filter((p) => {
    if (seenL.has(p.left) || seenR.has(p.right)) return false;
    seenL.add(p.left);
    seenR.add(p.right);
    return true;
  });
  const rand = mulberry32(Math.abs(snap.year) + 7);
  for (let i = uniq.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [uniq[i], uniq[j]] = [uniq[j]!, uniq[i]!];
  }
  return uniq.slice(0, max);
}

export function matchQuiz(pairs: Pair[], year: number): HTMLElement {
  const rand = mulberry32(Math.abs(year) + 11);
  const rights = pairs.map((p) => p.right);
  for (let i = rights.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [rights[i], rights[j]] = [rights[j]!, rights[i]!];
  }
  const letters = 'ABCDEFGH';
  const selects = pairs.map((p, i) => {
    const sel = el('select', { class: 'yx-select', ariaLabel: `Match for ${p.left}` }, [
      el('option', { value: '', text: '—' }),
      ...rights.map((r, k) => el('option', { value: r, text: `${letters[k]}. ${r}` })),
    ]);
    sel.dataset.idx = String(i);
    return sel;
  });
  const result = el('p', { class: 'yx-result', attrs: { 'aria-live': 'polite' } });
  const check = el('button', {
    class: 'btn btn-primary',
    type: 'button',
    text: 'Check',
    onClick: () => {
      let ok = 0;
      selects.forEach((s, i) => {
        const right = s.value === pairs[i]!.right;
        if (right) ok += 1;
        s.closest('tr')?.classList.toggle('is-right', right);
        s.closest('tr')?.classList.toggle('is-wrong', !right);
      });
      result.textContent = `${ok} / ${pairs.length} correct`;
    },
  });
  return el('div', { class: 'yx-quiz' }, [
    el('table', { class: 'yx-pairs yx-quiz-table' }, [
      el('tbody', {}, pairs.map((p, i) => el('tr', {}, [el('td', { text: `${i + 1}. ${p.left}` }), el('td', {}, [selects[i]!])]))),
    ]),
    el('div', { class: 'yx-quiz-actions' }, [check, result]),
  ]);
}

/* -------------------------------------------------------------------------- */
/* Event card                                                                  */
/* -------------------------------------------------------------------------- */

function eventCard(ev: TimelineEvent, data: ChronicleData, onPerson: (p: Person) => void): HTMLElement {
  const kids: Child[] = [
    el('div', { class: 'yx-ev-head' }, [
      el('span', { class: `yx-kind yx-kind-${ev.kind}`, text: KIND_META[ev.kind].label }),
      el('span', { class: 'yx-ev-date tnum', text: formatYear(ev.date) }),
      ...(ev.importance === 3 ? [chip({ text: 'Must know', tone: 'warn' })] : []),
      ...(ev.apSpecific ? [chip({ text: 'AP', tone: 'accent' })] : []),
    ]),
    el('h3', { class: 'yx-ev-title', text: ev.title }),
    figures(ev.images),
    el('p', { class: 'yx-summary', text: ev.summary }),
    wordsToKnow(terms().find(eventText(ev))),
    el('div', { class: 'yx-detail md' }, renderMarkdown(ev.detail)),
  ];
  if (ev.place) kids.push(labelled('Place', el('span', { text: ev.place })));
  if (ev.parties?.length) kids.push(labelled('Between', el('span', { text: ev.parties.join(' vs ') })));
  if (ev.signatories?.length) kids.push(labelled(ev.kind === 'battle' ? 'Led by' : 'Signed / led by', el('span', { text: ev.signatories.join('; ') })));
  kids.push(...eventStructure(ev));
  if (ev.outcomes?.length) kids.push(labelled('Outcome', list('yx-bullets', ev.outcomes)));
  if (ev.facts?.length) kids.push(labelled('Facts', list('yx-bullets', ev.facts)));
  if (ev.pairs?.length) kids.push(labelled('Pairs', pairsTable(ev.pairs)));
  const people = (ev.personIds ?? [])
    .map((id) => data.people.find((p) => p.id === id))
    .filter((p): p is Person => p !== undefined);
  if (people.length) {
    kids.push(
      labelled(
        'People',
        el('div', { class: 'yx-chips' }, people.map((p) =>
          el('button', { class: 'yx-person-chip yx-person-chip-row', type: 'button', onClick: () => onPerson(p) }, [avatar(p), el('span', { text: p.name })]),
        )),
      ),
    );
  }
  if (ev.alsoOn?.length) {
    kids.push(labelled('Dates to know', list('yx-bullets', [...ev.alsoOn].sort((a, b) => a.year - b.year).map((f) => `${yearLabel(f.year)}: ${f.text}`))));
  }
  return el('article', { class: 'card yx-ev' }, kids);
}

/* -------------------------------------------------------------------------- */
/* Page                                                                        */
/* -------------------------------------------------------------------------- */

export function render(root: HTMLElement): void {
  const data = chronicleData();
  const years = yearsWithEntries(data);
  const fromQuery = parseYear(routeQuery('y') ?? '');
  let year = nearestYear(years, fromQuery ?? 1757) ?? 1757;

  const yearInput = el('input', {
    class: 'yx-year-input',
    type: 'text',
    ariaLabel: 'Year (e.g. 1784, 326 BCE, -326)',
    attrs: { inputmode: 'text', autocomplete: 'off', spellcheck: 'false' },
  });
  const slider = el('input', {
    class: 'yx-slider',
    type: 'range',
    ariaLabel: 'Move through years that have entries',
    attrs: { min: '0', max: String(Math.max(0, years.length - 1)), step: '1' },
  });
  const heading = el('h2', { class: 'yx-year', attrs: { tabindex: '-1' } });
  const counts = el('p', { class: 'yx-counts', attrs: { 'aria-live': 'polite' } });
  const body = el('div', { class: 'yx-body' });
  const searchInput = el('input', {
    class: 'yx-search-input',
    type: 'search',
    ariaLabel: 'Search people or events',
    attrs: { placeholder: 'Search a person, treaty, battle…', autocomplete: 'off' },
  });
  const searchResults = el('div', { class: 'yx-search-results' });

  const showPerson = (p: Person): void => openPersonCard(p, data, goTo);

  const nearestIndex = (y: number): number => {
    let best = 0;
    for (let i = 0; i < years.length; i++) if (Math.abs(years[i]! - y) < Math.abs(years[best]! - y)) best = i;
    return best;
  };

  /** Only years with entries are shown; any other year snaps to the nearest one. */
  function goTo(y: number): void {
    year = nearestYear(years, y) ?? y;
    draw();
  }

  function section(title: string, n: number, content: Child): HTMLElement {
    return el('section', { class: 'yx-section' }, [
      el('h3', { class: 'yx-section-title' }, [el('span', { text: title }), el('span', { class: 'yx-count tnum', text: String(n) })]),
      content,
    ]);
  }

  function draw(): void {
    const snap = yearSnapshot(year, data);
    yearInput.value = yearLabel(year);
    heading.textContent = yearLabel(year);
    if (years.length) slider.value = String(nearestIndex(year));
    const holderCount = [...snap.holders.values()].reduce((n, l) => n + l.length, 0);
    counts.textContent = `${snap.events.length} events · ${snap.ongoing.length} ongoing · ${holderCount} posts · ${snap.people.length} people`;

    const parts: Child[] = [];
    if (snap.periods.length) {
      parts.push(section('Ruling / ongoing periods', snap.periods.length, el('div', { class: 'yx-chips' }, snap.periods.map((p) =>
        chip({ text: `${p.label} (${yearLabel(p.startYear)} – ${yearLabel(p.endYear)})`, tone: 'default', iconName: 'history' }),
      ))));
    }
    if (snap.holders.size) {
      const groups = [...snap.holders.entries()].map(([group, rows]) =>
        el('div', { class: 'yx-holder-group' }, [
          el('h4', { class: 'yx-holder-title', text: group }),
          el('table', { class: 'yx-holders' }, [
            el('tbody', {}, rows.map(({ office, holder }) => {
              const person = holder.personId ? data.people.find((p) => p.id === holder.personId) : undefined;
              const name: Child = person
                ? el('button', { class: 'yx-linkish', type: 'button', onClick: () => showPerson(person) }, [avatar(person), el('span', { text: holder.name })])
                : holder.name;
              return el('tr', {}, [
                el('th', { attrs: { scope: 'row' }, text: office.label }),
                el('td', {}, [name, holder.note ? el('span', { class: 'yx-note', text: ` — ${holder.note}` }) : null]),
                el('td', { class: 'tnum yx-term', text: `${holder.approx ? 'c. ' : ''}${yearLabel(holder.from)} – ${yearLabel(holder.to)}` }),
              ]);
            })),
          ]),
        ]),
      );
      parts.push(section('Who held which post', holderCount, el('div', { class: 'yx-holder-wrap' }, groups)));
    }
    parts.push(
      section(
        `Events in ${yearLabel(year)}`,
        snap.events.length,
        snap.events.length
          ? el('div', { class: 'yx-ev-list' }, snap.events.map((e) => eventCard(e, data, showPerson)))
          : el('p', { class: 'yx-empty', text: 'No event starts this year; see the other sections below.' }),
      ),
    );
    if (snap.echoes.length) {
      parts.push(section(`Also in ${yearLabel(year)}`, snap.echoes.length, list('yx-ongoing', snap.echoes.map((f) => {
        const ev = f.event;
        const person = f.person;
        return el('div', { class: 'yx-echo' }, [
          el('span', { text: f.text }),
          ev
            ? el('button', { class: 'yx-linkish yx-echo-link', type: 'button', onClick: () => goTo(ev.date.year) }, [
                el('span', { class: 'tnum', text: formatYear(ev.date) }), el('span', { text: ev.title }),
              ])
            : person
              ? el('button', { class: 'yx-linkish yx-echo-link', type: 'button', text: person.name, onClick: () => showPerson(person) })
              : null,
        ]);
      }))));
    }
    if (snap.ongoing.length) {
      parts.push(section('Still going on', snap.ongoing.length, list('yx-ongoing', snap.ongoing.map((e) =>
        el('button', { class: 'yx-linkish', type: 'button', onClick: () => goTo(e.date.year) }, [
          el('span', { class: 'tnum', text: formatYear(e.date) }),
          el('span', { text: e.title }),
        ]),
      ))));
    }
    const { focus, others } = splitPeople(snap, data.people);
    if (focus.length) {
      parts.push(section(`People of ${yearLabel(year)}`, focus.length, el('div', { class: 'yx-profile-list' }, focus.map((p) => personProfile(p, data, goTo)))));
    }
    if (others.length) {
      parts.push(section('Also alive / active', others.length, list('yx-others', others.map((p) =>
        el('div', { class: 'yx-other' }, [
          el('strong', { text: p.name }),
          el('span', { class: 'yx-person-role', text: ` ${CATEGORY_LABEL[p.category]} · ${lifeLabel(p)}` }),
          el('p', { class: 'yx-summary', text: p.summary }),
        ]),
      ))));
    }
    const pairs = pickMatchPairs(snap);
    if (pairs.length >= 3) parts.push(section('Match the following', pairs.length, matchQuiz(pairs, year)));
    mount(body, ...parts);
  }

  const step = (dir: 1 | -1): void => {
    const y = stepYear(years, year, dir);
    if (y !== null) goTo(y);
  };
  const jumpBtn = (label: string, aria: string, fn: () => void): HTMLElement =>
    el('button', { class: 'btn btn-secondary yx-step', type: 'button', text: label, ariaLabel: aria, onClick: fn });

  yearInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const y = parseYear(yearInput.value);
      if (y !== null) goTo(y);
      else counts.textContent = 'Type a year like 1784, 326 BCE or -326.';
    }
  });
  slider.addEventListener('input', () => {
    const y = years[Number(slider.value)];
    if (y !== undefined) goTo(y);
  });
  searchInput.addEventListener('input', () => {
    const q = searchInput.value;
    const ps = searchPeople(data.people, q).slice(0, 8);
    const es = searchChronicleEvents(data.events, q).slice(0, 8);
    const rows: Child[] = [
      ...ps.map((p) => el('button', { class: 'yx-search-row', type: 'button', onClick: () => showPerson(p) }, [
        el('span', { class: 'yx-search-kind', text: 'Person' }), el('span', { text: `${p.name} (${lifeLabel(p)})` }),
      ])),
      ...es.map((e) => el('button', { class: 'yx-search-row', type: 'button', onClick: () => { searchInput.value = ''; mount(searchResults); goTo(e.date.year); } }, [
        el('span', { class: 'yx-search-kind', text: KIND_META[e.kind].label }), el('span', { text: `${formatYear(e.date)} — ${e.title}` }),
      ])),
    ];
    if (q.trim() && rows.length === 0) rows.push(el('p', { class: 'yx-empty', text: 'No match.' }));
    mount(searchResults, ...rows);
  });

  const toolbar = el('div', { class: 'yx-toolbar card' }, [
    el('div', { class: 'yx-row' }, [
      jumpBtn('‹ Previous year', 'Previous year with events', () => step(-1)),
      yearInput,
      jumpBtn('Next year ›', 'Next year with events', () => step(1)),
    ]),
    slider,
    el('div', { class: 'yx-anchors', attrs: { role: 'group', 'aria-label': 'Jump to' } }, ANCHORS.map((a) =>
      el('button', { class: 'yx-anchor', type: 'button', onClick: () => goTo(a.year) }, [
        el('span', { text: a.label }), el('span', { class: 'tnum', text: yearLabel(a.year) }),
      ]),
    )),
    el('div', { class: 'yx-search' }, [searchInput, searchResults]),
  ]);

  mount(
    root,
    el('div', { class: 'yx' }, [
      el('div', { class: 'yx-top' }, [
        el('h1', { class: 'page-title', text: 'Year explorer' }),
        el('button', { class: 'btn btn-ghost', type: 'button', onClick: () => navigate('/timeline') }, [el('span', { text: 'Timeline map' }), icon('arrow-right', 14)]),
      ]),
      toolbar,
      heading,
      counts,
      body,
    ]),
  );
  draw();
}
