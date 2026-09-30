/**
 * "Topic at a glance" — a compact, STATIC, one-screen render of a curated
 * mind map (content kind `mindmap`: a root + ≤7 branches × ≤4 keyword leaves).
 *
 * Unlike the old interactive graph, this is a plain CSS grid — readable without
 * zoom at 390px and 1440px, no pan/zoom. It sits at the TOP of the Learn Notes
 * tab and is hidden entirely when a subtopic has no curated map.
 *
 * Layout (D2): branches render as a 2-column grid of compact chips even on a
 * narrow phone, and each branch's leaves are a single comma-joined line rather
 * than a cloud of wrapping pills — this keeps the whole card to roughly one
 * screen at 390px while the wider 2/3-column grid still reads well at 1440px.
 *
 * A "Cover and recall" toggle collapses every branch's leaves for active
 * recall; you then tap a branch to reveal just that branch's leaves. The
 * branch label is a real `<button aria-expanded>` so the collapse is keyboard-
 * and screen-reader-accessible. DOM-only; the map data is pure content.
 */
import type { MindmapBank } from '../../content/types';
import { el } from '../dom';
import { icon } from './icon';

/**
 * Build the "Topic at a glance" card for a curated {@link MindmapBank}. The
 * caller only renders this when a map exists, so this never has to degrade.
 */
export function buildAtAGlance(map: MindmapBank): HTMLElement {
  const section = el('section', { class: 'atg card', attrs: { 'aria-label': 'Topic at a glance' } });

  // Every branch's label button, so the cover toggle can collapse them at once.
  const branchButtons: HTMLButtonElement[] = [];

  let covered = false;
  const toggle = el('button', {
    class: 'atg-cover-toggle',
    type: 'button',
    attrs: { 'aria-pressed': 'false' },
    onClick: () => {
      covered = !covered;
      section.classList.toggle('is-covered', covered);
      toggle.setAttribute('aria-pressed', String(covered));
      // Covering collapses every branch; showing all re-expands them.
      for (const btn of branchButtons) {
        const li = btn.closest('.atg-branch');
        li?.classList.toggle('is-revealed', !covered);
        btn.setAttribute('aria-expanded', String(!covered));
      }
      toggle.replaceChildren(icon('revise', 15), el('span', { text: covered ? 'Show all' : 'Cover and recall' }));
    },
  }, [icon('revise', 15), el('span', { text: 'Cover and recall' })]);

  const head = el('div', { class: 'atg-head' }, [
    el('h3', { class: 'atg-title' }, [icon('sparkles', 16), el('span', { text: 'Topic at a glance' })]),
    toggle,
  ]);

  const branches = el('ul', { class: 'atg-branches', attrs: { role: 'list' } },
    map.branches.map((b, i) => {
      const leavesId = `atg-leaves-${i}`;
      const hasLeaves = b.leaves.length > 0;
      const label = el('button', {
        class: 'atg-branch-label',
        type: 'button',
        attrs: hasLeaves
          ? { 'aria-expanded': 'true', 'aria-controls': leavesId }
          : {},
        onClick: (ev) => {
          // Only meaningful in cover mode; reveals just this branch's leaves.
          if (!covered || !hasLeaves) return;
          const li = (ev.currentTarget as HTMLElement).closest('.atg-branch');
          if (!li) return;
          const nowRevealed = li.classList.toggle('is-revealed');
          (ev.currentTarget as HTMLElement).setAttribute('aria-expanded', String(nowRevealed));
        },
      }, [el('span', { class: 'atg-branch-label-text', text: b.label })]);
      if (hasLeaves) branchButtons.push(label as HTMLButtonElement);

      return el('li', { class: 'atg-branch is-revealed' }, [
        label,
        hasLeaves
          ? el('p', { class: 'atg-leaves', attrs: { id: leavesId }, text: b.leaves.join(', ') })
          : null,
      ]);
    }),
  );

  const grid = el('div', { class: 'atg-map' }, [
    el('div', { class: 'atg-root' }, [el('span', { text: map.root })]),
    branches,
  ]);

  section.append(head, grid);
  return section;
}
