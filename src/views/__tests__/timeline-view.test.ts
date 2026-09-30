import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '../timeline';
import { getTimeline } from '../../content/loader';
import { __resetForTests } from '../../state/store';

/**
 * Timeline VIEW tests (jsdom). matchMedia is undefined in jsdom, so `render`
 * takes the DESKTOP path. Canvas geometry uses a fallback width (getBoundingClientRect
 * is 0 in jsdom) so markers still position and render. We assert on the mirror
 * structures that don't depend on real layout: markers, filters, list view,
 * keyboard focus/open of the side panel, and the drill link wiring.
 */
function mountTimeline(): HTMLElement {
  const root = document.createElement('div');
  document.body.appendChild(root);
  render(root);
  return root;
}

describe('timeline view', () => {
  beforeEach(() => {
    __resetForTests();
    location.hash = '';
    document.body.replaceChildren();
  });

  it('renders one canvas marker per event (default filter shows all)', () => {
    const root = mountTimeline();
    const total = getTimeline().events.length;
    expect(root.querySelectorAll('.tl-marker').length).toBe(total);
  });

  it('renders the eight swim-lane labels in the gutter', () => {
    const root = mountTimeline();
    expect(root.querySelectorAll('.tl-gutter-lane').length).toBe(8);
  });

  it('AP-only filter narrows the markers to AP-specific events', () => {
    const root = mountTimeline();
    const all = root.querySelectorAll('.tl-marker').length;
    const apCount = getTimeline().events.filter((e) => e.apSpecific).length;
    const apToggle = root.querySelector<HTMLButtonElement>('.tl-ap-toggle')!;
    expect(apToggle).not.toBeNull();
    apToggle.click();
    const shown = root.querySelectorAll('.tl-marker').length;
    expect(shown).toBe(apCount);
    expect(shown).toBeLessThan(all);
    expect(apToggle.getAttribute('aria-pressed')).toBe('true');
  });

  it('toggles to the accessible list view (role=list grouped by era)', () => {
    const root = mountTimeline();
    // The list wrapper starts hidden.
    expect(root.querySelector('.tl-list-wrap')?.hasAttribute('hidden')).toBe(true);
    const viewBtn = [...root.querySelectorAll<HTMLButtonElement>('.tl-tool-text')].find(
      (b) => b.textContent?.includes('List view'),
    )!;
    viewBtn.click();
    const listWrap = root.querySelector('.tl-list-wrap')!;
    expect(listWrap.hasAttribute('hidden')).toBe(false);
    expect(listWrap.querySelectorAll('.tl-list-event').length).toBe(getTimeline().events.length);
    // Grouped under era sections with role=list.
    expect(listWrap.querySelectorAll('.tl-list-era').length).toBeGreaterThan(0);
    expect(listWrap.querySelector('[role="list"]')).not.toBeNull();
  });

  it('opening an event marker via keyboard shows the detail side panel', () => {
    const root = mountTimeline();
    const marker = root.querySelector<SVGGElement>('.tl-marker')!;
    marker.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const panel = root.querySelector('.tl-panel')!;
    expect(panel.hasAttribute('hidden')).toBe(false);
    expect(panel.querySelector('.tl-panel-title')?.textContent?.length).toBeGreaterThan(0);
    // The panel offers a drill action.
    expect(panel.textContent).toMatch(/Drill/);
  });

  it('opening an event from the list view links to its subtopic (Learn)', () => {
    const root = mountTimeline();
    // Find an event that actually links to a subtopic so a Learn link renders.
    const linked = getTimeline().events.find((e) => e.subtopicIds.length > 0)!;
    // Switch to list view for a deterministic, layout-free click target.
    const viewBtn = [...root.querySelectorAll<HTMLButtonElement>('.tl-tool-text')].find(
      (b) => b.textContent?.includes('List view'),
    )!;
    viewBtn.click();
    const btn = [...root.querySelectorAll<HTMLButtonElement>('.tl-list-event')].find(
      (b) => b.textContent?.includes(linked.title),
    )!;
    expect(btn).toBeDefined();
    btn.click();
    const panel = root.querySelector('.tl-panel')!;
    expect(panel.hasAttribute('hidden')).toBe(false);
    // A linked-topic button is present and navigates into Learn.
    const link = panel.querySelector<HTMLButtonElement>('.tl-link-btn');
    expect(link).not.toBeNull();
    link!.click();
    expect(location.hash.startsWith('#/learn/')).toBe(true);
  });

  it('lane filter chip hides that lane\'s markers', () => {
    const root = mountTimeline();
    const before = root.querySelectorAll('.tl-marker').length;
    // Turn off the first lane chip (North).
    const laneChip = root.querySelector<HTMLButtonElement>('.tl-fgroup .tl-fchip')!;
    laneChip.click();
    const after = root.querySelectorAll('.tl-marker').length;
    expect(after).toBeLessThan(before);
  });

  it('starts a chronology challenge from the current events', () => {
    const root = mountTimeline();
    const btn = [...root.querySelectorAll<HTMLButtonElement>('.tl-games-btns .btn')].find(
      (b) => b.textContent?.includes('Chronology'),
    )!;
    btn.click();
    const panel = root.querySelector('.tl-panel')!;
    expect(panel.hasAttribute('hidden')).toBe(false);
    // 4–5 reorderable items are offered.
    const items = panel.querySelectorAll('.tl-chrono-item');
    expect(items.length).toBeGreaterThanOrEqual(4);
    expect(items.length).toBeLessThanOrEqual(5);
    // Checking the order reveals the correct chronological order.
    const check = [...panel.querySelectorAll<HTMLButtonElement>('.btn')].find((b) => b.textContent?.includes('Check order'))!;
    check.click();
    expect(root.querySelector('.tl-chrono-correct')).not.toBeNull();
  });
});
