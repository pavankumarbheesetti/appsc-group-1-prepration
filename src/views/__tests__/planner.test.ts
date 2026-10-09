import { describe, it, expect, beforeEach } from 'vitest';
import * as planner from '../planner';
import { __resetForTests, setExamDate, setPlanStartDate } from '../../state/store';
import { addDaysISO, todayISO } from '../../lib/dates';

/**
 * Planner declutter tests: the default view leads with THIS WEEK (a 7-row
 * table + the current unit header), the editable exam date is gone (it lives in
 * Settings), and the dense 15-week grid + plan stats are tucked behind
 * disclosures ("See all weeks" / "Plan details"). A collapsible "Road to …"
 * strip lists the weekly subject units.
 */
describe('planner view — this-week default', () => {
  beforeEach(() => {
    __resetForTests();
    location.hash = '';
    // A running coverage plan regardless of the test runner's wall clock.
    setExamDate(addDaysISO(todayISO(), 120));
    setPlanStartDate(todayISO());
  });

  it('leads with a 7-row THIS WEEK table and no editable exam date', () => {
    const root = document.createElement('div');
    planner.render(root);
    const week = root.querySelector('.planner-week');
    expect(week).not.toBeNull();
    const rows = root.querySelectorAll('.planner-week-table tbody tr');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(7);
    // The editable exam-date input was removed (it duplicated Settings).
    expect(root.querySelector('input[type="date"]')).toBeNull();
    expect(root.textContent).toContain('Change in Settings');
  });

  it('shows the current weekly subject unit header', () => {
    const root = document.createElement('div');
    planner.render(root);
    const head = root.querySelector('.unit-head');
    expect(head).not.toBeNull();
    expect(head!.querySelector('.unit-head-eyebrow')?.textContent).toBe('This week');
    expect(head!.querySelector('.unit-head-progress')?.textContent).toMatch(/^Day \d+ of \d+$/);
  });

  it('tucks the full grid behind "See all weeks" and renders it lazily', () => {
    const root = document.createElement('div');
    planner.render(root);
    const disc = root.querySelector<HTMLDetailsElement>('details.all-weeks');
    expect(disc).not.toBeNull();
    // The dense week-by-week grid is NOT in the DOM until the disclosure opens.
    expect(root.querySelector('.planner-grid-wrap')).toBeNull();
    disc!.open = true;
    disc!.dispatchEvent(new Event('toggle'));
    expect(root.querySelector('.planner-grid-wrap')).not.toBeNull();
  });

  it('folds coverage/fit/subject cards into one collapsed "Plan details"', () => {
    const root = document.createElement('div');
    planner.render(root);
    const details = root.querySelector<HTMLDetailsElement>('details.plan-details');
    expect(details).not.toBeNull();
    expect(details!.open).toBe(false);
    expect(details!.textContent).toContain('Plan details');
  });

  it('offers a collapsible "Road to …" strip listing the weekly units', () => {
    const root = document.createElement('div');
    planner.render(root);
    const road = root.querySelector('.road-strip');
    expect(road).not.toBeNull();
    expect(road!.textContent).toContain('Road to');
    expect(road!.querySelectorAll('.road-units .road-unit').length).toBeGreaterThan(0);
  });
});
