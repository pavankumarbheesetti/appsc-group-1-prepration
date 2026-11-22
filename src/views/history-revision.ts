/** Quick-revision tables for a history chapter (`#/topics/history/:id/revision`). */
import { getRevision } from '../content/loader';
import type { Chapter } from '../content/chronicle-types';
import type { RevisionCard, RevisionSection } from '../content/revision-types';
import { contemporaries, groupsOf, previousInGroup, spanLabel } from '../lib/revision';
import { navigate } from '../router/router';
import { el, mount } from './dom';

const HISTORY_PATH = '/topics/history';

function facetBoxes(c: RevisionCard): HTMLElement {
  return el('div', { class: 'rv-facets' }, c.facets.map((f) => el('div', { class: 'rv-facet' }, [
    el('p', { class: 'rv-facet-label', text: f.label }),
    el('ul', {}, f.points.map((p) => el('li', { text: p }))),
  ])));
}

function boxesCard(c: RevisionCard): HTMLElement {
  return el('article', { class: 'rv-card', attrs: { id: c.id } }, [
    el('div', { class: 'rv-key' }, [
      el('h3', { text: c.key }),
      c.span ? el('p', { class: 'rv-span tnum', text: spanLabel(c) }) : null,
      c.hook ? el('p', { class: 'rv-hook', text: c.hook }) : null,
    ]),
    facetBoxes(c),
  ]);
}

function timelineSection(s: RevisionSection): HTMLElement {
  const cards = [...s.cards].sort((a, b) => a.span!.from - b.span!.from);
  const min = Math.min(...cards.map((c) => c.span!.from));
  const max = Math.max(...cards.map((c) => c.span!.to));
  const width = Math.max(max - min, 1);
  const rows = groupsOf(cards);
  const bar = el('div', { class: 'rv-line' }, rows.map((g) => el('div', { class: 'rv-lane' }, [
    el('span', { class: 'rv-lane-name', text: g || 'All' }),
    el('div', { class: 'rv-track' }, cards.filter((c) => (c.group ?? '') === g).map((c) => {
      const left = ((c.span!.from - min) / width) * 100;
      const w = Math.max(((c.span!.to - c.span!.from) / width) * 100, 1.5);
      return el('button', {
        class: 'rv-bar', type: 'button',
        attrs: { style: `left:${left}%;width:${w}%`, title: `${c.key}: ${spanLabel(c)}` },
        onClick: () => document.getElementById(c.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      }, [el('span', { text: c.key })]);
    })),
  ])));
  const scale = el('p', { class: 'rv-scale tnum', text: `${spanLabel({ id: '', key: '', facets: [], span: { from: min, to: max } })}` });
  return el('div', {}, [
    el('div', { class: 'rv-scroll' }, [bar]),
    scale,
    ...cards.map((c) => {
      const prev = previousInGroup(c, cards);
      const mates = contemporaries(c, cards);
      return el('article', { class: 'rv-card', attrs: { id: c.id } }, [
        el('div', { class: 'rv-key' }, [
          el('h3', { text: c.key }),
          el('p', { class: 'rv-span tnum', text: `${spanLabel(c)}${c.group ? ` · ${c.group}` : ''}` }),
          c.hook ? el('p', { class: 'rv-hook', text: c.hook }) : null,
          el('p', { class: 'rv-rel' }, [el('strong', { text: 'Before: ' }), el('span', { text: prev ? `${prev.key} (${spanLabel(prev)})` : 'none in this row' })]),
          el('p', { class: 'rv-rel' }, [el('strong', { text: 'Same time: ' }), el('span', { text: mates.length ? mates.map((m) => m.key).join(', ') : 'none' })]),
        ]),
        facetBoxes(c),
      ]);
    }),
  ]);
}

function tableSection(s: RevisionSection): HTMLElement {
  const cols = s.columns ?? [];
  const rows: HTMLElement[] = [];
  let last: string | undefined;
  for (const c of s.cards) {
    if (c.group && c.group !== last) {
      last = c.group;
      rows.push(el('tr', { class: 'rv-t-group' }, [el('th', { attrs: { colspan: String(cols.length + 1), scope: 'colgroup' }, text: c.group })]));
    }
    rows.push(el('tr', { attrs: { id: c.id } }, [
      el('th', { class: 'rv-t-key', attrs: { scope: 'row' } }, [
        el('strong', { text: c.key }),
        c.span ? el('span', { class: 'rv-t-span tnum', text: spanLabel(c) }) : null,
        c.hook ? el('span', { class: 'rv-t-hook', text: c.hook }) : null,
      ]),
      ...cols.map((col) => {
        const f = c.facets.find((x) => x.label === col);
        return el('td', {}, f ? [el('ul', {}, f.points.map((p) => el('li', { text: p })))] : [el('span', { class: 'hl-muted', text: '—' })]);
      }),
    ]));
  }
  return el('div', { class: 'rv-t-wrap' }, [
    el('table', { class: 'rv-t' }, [
      el('thead', {}, [el('tr', {}, [el('th', { attrs: { scope: 'col' }, text: 'Ruler' }), ...cols.map((h) => el('th', { attrs: { scope: 'col' }, text: h }))])]),
      el('tbody', {}, rows),
    ]),
  ]);
}

export function renderRevision(root: HTMLElement, c: Chapter): void {
  const sections = getRevision(c.id);
  mount(
    root,
    el('div', { class: 'hl rv' }, [
      el('button', { class: 'btn btn-ghost hl-back', type: 'button', onClick: () => navigate(`${HISTORY_PATH}/${c.id}`) }, [el('span', { text: `‹ ${c.title}` })]),
      el('h1', { class: 'page-title', text: 'Quick revision tables' }),
      el('nav', { class: 'rv-nav' }, sections.map((s) => el('a', { class: 'rv-nav-link', attrs: { href: `#rv-${s.id}` }, text: s.title, onClick: (e: Event) => { e.preventDefault(); document.getElementById(`rv-${s.id}`)?.scrollIntoView({ behavior: 'smooth' }); } }))),
      ...sections.map((s) => el('section', { class: 'rv-section', attrs: { id: `rv-${s.id}` } }, [
        el('h2', { class: 'hl-part-title', text: s.title }),
        s.intro ? el('p', { class: 'hl-muted', text: s.intro }) : null,
        s.style === 'timeline' ? timelineSection(s) : s.style === 'table' ? tableSection(s) : el('div', {}, s.cards.map(boxesCard)),
      ])),
    ]),
  );
}
