import { describe, it, expect, beforeEach } from 'vitest';
import * as settings from '../settings';
import {
  __resetForTests,
  getDailyStudyMinutes,
  getDaysOff,
  getExamDate,
  getPlanStartDate,
  getSundayStudyMinutes,
  setDailyStudyMinutes,
  studyMinutesError,
} from '../../state/store';
import { DEFAULT_DAYS_OFF } from '../../config';
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

/** Find the "Add a day off" date input. */
function addDayOffInput(root: HTMLElement): HTMLInputElement | undefined {
  return [...root.querySelectorAll<HTMLInputElement>('input[type="date"]')].find(
    (i) => i.getAttribute('aria-label') === 'Add a day off',
  );
}

describe('settings view — days off control', () => {
  beforeEach(() => {
    __resetForTests();
  });

  it('renders the default days off as removable chips, an add-date input and a reset button', () => {
    const root = document.createElement('div');
    settings.render(root);
    expect(root.textContent).toContain('Days off');
    // One chip per current day off (defaults on a fresh profile).
    expect(getDaysOff().length).toBe(DEFAULT_DAYS_OFF.length);
    expect(root.querySelectorAll('.dayoff-chip').length).toBe(DEFAULT_DAYS_OFF.length);
    expect(addDayOffInput(root)).toBeTruthy();
    expect(
      [...root.querySelectorAll<HTMLButtonElement>('button')].some((b) =>
        b.textContent?.includes('Reset to defaults'),
      ),
    ).toBe(true);
  });

  it('adds a new day off from the date input', () => {
    const root = document.createElement('div');
    settings.render(root);
    const add = addDayOffInput(root)!;
    add.value = '2026-12-25';
    add.dispatchEvent(new Event('change'));
    expect(getDaysOff()).toContain('2026-12-25');
  });

  it('removes a day off from its chip remove button', () => {
    const root = document.createElement('div');
    settings.render(root);
    const before = getDaysOff().length;
    const remove = root.querySelector<HTMLButtonElement>('.dayoff-chip-remove');
    expect(remove).toBeTruthy();
    remove!.click();
    expect(getDaysOff().length).toBe(before - 1);
  });

  it('restores the festival defaults with "Reset to defaults"', () => {
    const root = document.createElement('div');
    settings.render(root);
    // Mutate then reset.
    const add = addDayOffInput(root)!;
    add.value = '2026-12-25';
    add.dispatchEvent(new Event('change'));
    const reset = [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.includes('Reset to defaults'),
    )!;
    reset.click();
    expect(getDaysOff()).toEqual([...DEFAULT_DAYS_OFF]);
  });
});

describe('settings view — study-time bounds (D21)', () => {
  beforeEach(() => {
    localStorage.clear();
    __resetForTests();
  });

  const customInput = (root: HTMLElement, label: string): HTMLInputElement =>
    [...root.querySelectorAll<HTMLInputElement>('input[type="number"]')].find((i) => i.getAttribute('aria-label') === label)!;

  it('daily 60–600: out-of-range values are rejected with a message, in-range saved', () => {
    const root = document.createElement('div');
    settings.render(root);
    let input = customInput(root, 'Custom daily study minutes');
    expect(input.getAttribute('min')).toBe('60');
    expect(input.getAttribute('max')).toBe('600');
    input.value = '25';
    input.dispatchEvent(new Event('change'));
    expect(getDailyStudyMinutes()).toBe(240);
    expect(root.textContent).toContain('at least 60 minutes');
    input.value = '5000';
    input.dispatchEvent(new Event('change'));
    expect(getDailyStudyMinutes()).toBe(240);
    expect(root.textContent).toContain('at most 600 minutes');
    input = customInput(root, 'Custom daily study minutes');
    input.value = '300';
    input.dispatchEvent(new Event('change'));
    expect(getDailyStudyMinutes()).toBe(300);
  });

  it('Sunday 60–720: out-of-range rejected, in-range saved; setters + load clamp too', () => {
    const root = document.createElement('div');
    settings.render(root);
    const input = customInput(root, 'Custom Sunday study minutes');
    expect(input.getAttribute('max')).toBe('720');
    input.value = '800';
    input.dispatchEvent(new Event('change'));
    expect(getSundayStudyMinutes()).toBe(360);
    expect(root.textContent).toContain('at most 720 minutes');
    // Direct setter calls are bounded as well.
    setDailyStudyMinutes(5000);
    expect(getDailyStudyMinutes()).toBe(240);
    expect(studyMinutesError('sunday', 720)).toBeNull();
    expect(studyMinutesError('daily', 59)).not.toBeNull();
  });
});

describe('exam date warning (D38)', () => {
  beforeEach(() => {
    __resetForTests();
    document.body.innerHTML = '';
  });

  it('warns when the date is < 30 days away or in the past', () => {
    expect(settings.examDateWarning('2026-10-25', '2026-10-19')).toBe(
      '25 Oct 2026 is only 6 days away. Prelims is officially 24 Jan 2027 \u2014 are you sure?',
    );
    expect(settings.examDateWarning('2026-10-01', '2026-10-19')).toContain('is in the past');
    expect(settings.examDateWarning('2027-01-24', '2026-10-19')).toBeNull();
    expect(settings.examDateWarning('2026-11-18', '2026-10-19')).toBeNull(); // exactly 30 days
  });

  it('choosing a close date asks first; cancel keeps the old date, confirm applies it', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    settings.render(root);
    const before = getExamDate();
    const input = root.querySelector<HTMLInputElement>('.exam-date-input')!;
    input.value = addDaysISO(todayISO(), 5);
    input.dispatchEvent(new Event('change'));
    const dialog = document.querySelector('.confirm-panel')!;
    expect(dialog.textContent).toContain('Prelims is officially 24 Jan 2027');
    [...dialog.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Keep the current date')!.click();
    expect(getExamDate()).toBe(before);
    input.value = addDaysISO(todayISO(), 5);
    input.dispatchEvent(new Event('change'));
    [...document.querySelectorAll<HTMLButtonElement>('.confirm-panel button')].find((b) => b.textContent === 'Yes, use this date')!.click();
    expect(getExamDate()).toBe(addDaysISO(todayISO(), 5));
  });
});
