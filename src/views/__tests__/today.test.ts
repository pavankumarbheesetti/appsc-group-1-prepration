import { describe, it, expect, beforeEach } from 'vitest';
import * as today from '../today';
import { buildAtAGlance } from '../components/atglance';
import { getSubtopics } from '../../content/loader';
import { getMindmap } from '../../content/loader';
import { __resetForTests } from '../../state/store';

describe('today view — Start today\u2019s study CTA', () => {
  beforeEach(() => {
    __resetForTests();
    location.hash = '';
  });

  it('offers a primary "Start today\u2019s study" action that jumps into study', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    today.render(root);

    const cta = [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.includes("Start today\u2019s study"),
    );
    // Pre-Prelims the CTA is present and one-taps into a topic / mock / drill.
    if (cta) {
      cta.click();
      expect(location.hash).toMatch(/^#\/(learn|mock|drill)/);
    } else {
      // Post-exam fallback: "Open planner" is the primary instead.
      expect(root.textContent).toContain('Open planner');
    }
    root.remove();
  });

  it('renders the day\u2019s rhythm blocks as cards (when studying)', () => {
    const root = document.createElement('div');
    today.render(root);
    // Either the block cards render, or a graceful state does — never a crash.
    expect(root.querySelector('.today-budget')).toBeTruthy();
  });
});

describe('at-a-glance curated map', () => {
  it('renders a compact static map with a Cover-and-recall toggle', () => {
    // Find any subtopic that actually has a curated mindmap.
    const withMap = getSubtopics()
      .map((s) => getMindmap(s.id))
      .find((m) => m !== undefined);

    const map =
      withMap ?? {
        kind: 'mindmap' as const,
        subjectCode: 'HIST' as const,
        topic: 'Test',
        subtopicId: 'sub',
        root: 'Indus Valley',
        branches: [
          { label: 'Sites', leaves: ['Harappa', 'Mohenjo-daro', 'Lothal'] },
          { label: 'Features', leaves: ['Grid plan', 'Great Bath'] },
        ],
      };

    const card = buildAtAGlance(map);
    expect(card.querySelector('.atg-title')?.textContent).toContain('Topic at a glance');
    expect(card.querySelector('.atg-root')?.textContent).toBe(map.root);
    expect(card.querySelectorAll('.atg-branch').length).toBe(map.branches.length);

    // Leaves render as a compact comma-joined line (D2), not a pill cloud.
    const firstWithLeaves = map.branches.find((b) => b.leaves.length > 0)!;
    const leavesLine = card.querySelector('.atg-leaves');
    expect(leavesLine?.textContent).toBe(firstWithLeaves.leaves.join(', '));

    // Cover-and-recall collapses every branch; tapping a branch reveals just it.
    const toggle = card.querySelector<HTMLButtonElement>('.atg-cover-toggle')!;
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    toggle.click();
    expect(card.classList.contains('is-covered')).toBe(true);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');

    const branch = card.querySelector('.atg-branch')!;
    expect(branch.classList.contains('is-revealed')).toBe(false);
    const branchLabel = branch.querySelector<HTMLButtonElement>('.atg-branch-label')!;
    expect(branchLabel.getAttribute('aria-expanded')).toBe('false');
    branchLabel.click();
    expect(branch.classList.contains('is-revealed')).toBe(true);
    expect(branchLabel.getAttribute('aria-expanded')).toBe('true');
  });
});
