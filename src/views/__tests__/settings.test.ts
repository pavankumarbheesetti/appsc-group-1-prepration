import { describe, it, expect, beforeEach } from 'vitest';
import * as settings from '../settings';
import { __resetForTests, getExamDate, getPlanStartDate } from '../../state/store';
import { addDaysISO, todayISO } from '../../lib/dates';

/** Find the Plan-start date input by its aria-label. */
function planStartInput(root: HTMLElement): HTMLInputElement | undefined {
  return [...root.querySelectorAll<HTMLInputElement>('input[type="date"]')].find(
    (i) => i.getAttribute('aria-label') === 'Plan start date',
  );
}

describe('settings view — plan start date control', () => {
  beforeEach(() => {
    __resetForTests();
  });

  it('renders a bounded plan-start date input (min today, max exam − 14 days)', () => {
    const root = document.createElement('div');
    settings.render(root);
    const input = planStartInput(root);
    expect(input).toBeTruthy();
    expect(input!.getAttribute('min')).toBe(todayISO());
    expect(input!.getAttribute('max')).toBe(addDaysISO(getExamDate(), -14));
    // The helper text promises progress is kept and pre-start days are free.
    expect(root.textContent).toContain('Your progress is kept. Days before the start date are free.');
  });

  it('"Start my plan tomorrow" sets the plan start to tomorrow and re-plans', () => {
    const root = document.createElement('div');
    settings.render(root);
    const btn = [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.includes('Start my plan tomorrow'),
    );
    expect(btn).toBeTruthy();
    btn!.click();
    expect(getPlanStartDate()).toBe(addDaysISO(todayISO(), 1));
  });

  it('persists a chosen start date on the date input change', () => {
    const root = document.createElement('div');
    settings.render(root);
    const input = planStartInput(root)!;
    const chosen = addDaysISO(todayISO(), 3);
    input.value = chosen;
    input.dispatchEvent(new Event('change'));
    expect(getPlanStartDate()).toBe(chosen);
  });
});
