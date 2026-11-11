/** Structured parts of an event (sides, causes, course, losses, gains, treaties) and a person's post at a given year. */
import type { GlossaryTerm, Person, PersonRole } from '../content/chronicle-types';
import type { TimelineEvent } from '../content/timeline-types';
import { formatYear } from '../lib/timeline';
import { el, type Child } from './dom';

const yl = (y: number): string => formatYear({ year: y });

function block(title: string, body: Child, cls = ''): HTMLElement {
  return el('div', { class: `ep-block ${cls}`.trim() }, [el('p', { class: 'hl-sub', text: title }), body]);
}

const bullets = (items: readonly string[], ordered = false): HTMLElement =>
  el(ordered ? 'ol' : 'ul', { class: 'yx-bullets' }, items.map((t) => el('li', { text: t })));

export function sidesTable(ev: TimelineEvent): HTMLElement | null {
  if (!ev.sides?.length) return null;
  const rows: [string, (s: NonNullable<TimelineEvent['sides']>[number]) => string | undefined][] = [
    ['Ruler', (s) => s.ruler],
    ['Commanders', (s) => s.commanders?.join(', ')],
    ['Allies', (s) => s.allies?.join(', ')],
    ['Strength', (s) => s.strength],
  ];
  const used = rows.filter(([, get]) => ev.sides!.some((s) => get(s)));
  return block(
    ev.kind === 'treaty' ? 'The two sides' : 'Who fought whom',
    el('div', { class: 'ep-table-wrap' }, [
      el('table', { class: 'ep-sides' }, [
        el('thead', {}, [el('tr', {}, [el('th', { text: '' }), ...ev.sides.map((s) => el('th', { attrs: { scope: 'col' }, text: s.name }))])]),
        el('tbody', {}, used.map(([label, get]) =>
          el('tr', {}, [el('th', { attrs: { scope: 'row' }, text: label }), ...ev.sides!.map((s) => el('td', { text: get(s) ?? '—' }))]),
        )),
      ]),
    ]),
  );
}

/** Causes → course → losses → gains → treaties, in teaching order. */
export function eventStructure(ev: TimelineEvent): Child[] {
  const out: Child[] = [sidesTable(ev)];
  if (ev.causes?.length) out.push(block('What led to it', bullets(ev.causes)));
  if (ev.course?.length) out.push(block('What happened', bullets(ev.course, true)));
  if (ev.losses?.length) out.push(block('Losses', bullets(ev.losses), 'ep-losses'));
  if (ev.gains?.length) out.push(block('Who gained what', bullets(ev.gains), 'ep-gains'));
  if (ev.treaties?.length) {
    out.push(block('Treaties', el('div', { class: 'ep-treaties' }, ev.treaties.map((t) =>
      el('div', { class: 'ep-treaty' }, [
        el('strong', { text: t.year ? `${t.name} (${yl(t.year)})` : t.name }),
        t.between?.length ? el('p', { class: 'ep-between', text: `Between: ${t.between.join(' and ')}` }) : null,
        t.terms?.length ? bullets(t.terms) : null,
      ]),
    ))));
  }
  return out;
}

/** "Words to know": each term with its meaning, period and an example. */
export function wordsToKnow(terms: readonly GlossaryTerm[]): HTMLElement | null {
  if (terms.length === 0) return null;
  return block('Words to know', el('dl', { class: 'ep-terms' }, terms.flatMap((t) => [
    el('dt', { text: t.term }),
    el('dd', {}, [
      el('span', { text: t.meaning }),
      t.period ? el('span', { class: 'ep-term-period', text: ` (${t.period})` }) : null,
      t.example ? el('span', { class: 'ep-term-example', text: ` Example: ${t.example}` }) : null,
    ]),
  ])), 'ep-words');
}

/** The person's role covering `year`, if any. */
export function roleAt(person: Person, year: number): PersonRole | undefined {
  return person.roles?.find((r) => r.from <= year && r.to >= year);
}

/** "Post at the time" plus how they got it, appointed by whom, and whom they succeeded. */
export function postLine(person: Person, year: number, post?: string): HTMLElement | null {
  const current = roleAt(person, year);
  // Not in post this year: show the latest post they had already left (e.g. "Former Nawab of Bengal").
  const former = current ? undefined : [...(person.roles ?? [])].filter((r) => r.to < year).sort((a, b) => b.to - a.to)[0];
  const role = current ?? former;
  const title = post ?? (role ? `${former ? 'Former ' : ''}${role.title} (${yl(role.from)} – ${yl(role.to)})` : undefined);
  if (!title) return null;
  const how = role
    ? [
        role.howGained,
        role.appointedBy ? `appointed by ${role.appointedBy}` : undefined,
        role.predecessor ? `succeeded ${role.predecessor}` : undefined,
        role.howEnded ? `ended: ${role.howEnded}` : undefined,
      ].filter((x): x is string => Boolean(x))
    : [];
  return el('p', { class: 'ep-post' }, [
    el('span', { class: 'ep-post-label', text: 'Post: ' }),
    el('span', { text: title }),
    how.length ? el('span', { class: 'ep-post-how', text: ` — ${how.join('; ')}` }) : null,
  ]);
}
