import { describe, it, expect } from 'vitest';
import { icon } from '../icon';
import { ring } from '../ring';
import { barChart } from '../chart';
import { progressBar } from '../progress';

describe('icon', () => {
  it('returns an <svg> element for a known icon', () => {
    const svg = icon('drill');
    expect(svg.tagName.toLowerCase()).toBe('svg');
    expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg');
    // The bullseye icon composes circles + paths.
    expect(svg.querySelectorAll('circle').length).toBeGreaterThan(0);
  });

  it('respects the size argument', () => {
    const svg = icon('notes', 30);
    expect(svg.getAttribute('width')).toBe('30');
    expect(svg.getAttribute('height')).toBe('30');
  });
});

describe('ring', () => {
  it('builds a ring whose arc offset reflects the value', () => {
    const full = ring({ value: 1, centerText: '100%' });
    const empty = ring({ value: 0, centerText: '0%' });
    const fullArc = full.querySelector('.ring-arc')!;
    const emptyArc = empty.querySelector('.ring-arc')!;
    // Full ring hides none of the arc (offset 0); empty hides all of it.
    expect(Number(fullArc.getAttribute('stroke-dashoffset'))).toBeCloseTo(0);
    expect(Number(emptyArc.getAttribute('stroke-dashoffset'))).toBeGreaterThan(0);
    expect(full.querySelector('.ring-value')?.textContent).toBe('100%');
  });

  it('clamps out-of-range values', () => {
    const over = ring({ value: 5, centerText: 'x' });
    expect(Number(over.querySelector('.ring-arc')!.getAttribute('stroke-dashoffset'))).toBeCloseTo(0);
  });
});

describe('barChart', () => {
  it('renders one rect per datum plus labels', () => {
    const el = barChart({
      data: [
        { label: 'HIST', value: 3 },
        { label: 'POL', value: 0 },
      ],
      ariaLabel: 'test',
    });
    const svg = el.querySelector('svg')!;
    expect(svg.getAttribute('aria-label')).toBe('test');
    expect(svg.querySelectorAll('rect').length).toBe(2);
    // A baseline axis is always present.
    expect(svg.querySelectorAll('line').length).toBe(1);
  });

  it('a single subject does NOT fill the whole plot height (no solid block)', () => {
    const el = barChart({ data: [{ label: 'HIST', value: 5 }], ariaLabel: 'one' });
    const rect = el.querySelector('rect')!;
    const h = Number(rect.getAttribute('height'));
    // viewBox is 140 tall; a lone bar must stay well under the full plot.
    expect(h).toBeGreaterThan(0);
    expect(h).toBeLessThan(90);
  });

  it('zero values collapse to a faint baseline stub, not a full block', () => {
    const el = barChart({ data: [{ label: 'HIST', value: 0 }], ariaLabel: 'zero' });
    const rect = el.querySelector('rect')!;
    expect(Number(rect.getAttribute('height'))).toBeLessThanOrEqual(2);
  });
});

describe('progressBar', () => {
  it('sets the fill width and aria value from the fraction', () => {
    const el = progressBar({ value: 0.4, caption: '2/5' });
    const fill = el.querySelector('.progress-fill') as HTMLElement;
    expect(fill.style.width).toBe('40%');
    expect(fill.getAttribute('aria-valuenow')).toBe('40');
  });
});
