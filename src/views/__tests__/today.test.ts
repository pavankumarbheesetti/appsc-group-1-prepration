import { describe, it, expect, beforeEach } from 'vitest';
import * as today from '../today';
import { prettyDowDate } from '../today';
import { buildAtAGlance } from '../components/atglance';
import { getSubtopics } from '../../content/loader';
import { getMindmap } from '../../content/loader';
import { __resetForTests, setPlanStartDate, setExamDate, isAdminDone, setAdminDone } from '../../state/store';
import { addDaysISO, dayOfWeekISO, todayISO } from '../../lib/dates';

describe('today view — "Now" hero + Start CTA', () => {
  beforeEach(() => {
    __resetForTests();
    location.hash = '';
  });

  it('offers a primary "Start" action that jumps into study', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    today.render(root);

    const cta = [...root.querySelectorAll<HTMLButtonElement>('.hero-actions button')].find((b) =>
      b.textContent?.trim() === 'Start',
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

  it('shows a single focal "Up now" block in the hero (not a wall of rings)', () => {
    const root = document.createElement('div');
    today.render(root);
    // The empty-gauge rings are gone from Today; the hero carries the focus.
    expect(root.querySelector('.rings')).toBeFalsy();
    expect(root.querySelector('.hero-now')).toBeTruthy();
  });

  it('places today in its weekly subject unit via the hero unit line', () => {
    const root = document.createElement('div');
    today.render(root);
    const unitLine = root.querySelector('.hero-unit-line');
    // When the current day teaches a unit, the line reads "This week: … · day X of Y".
    if (unitLine) {
      expect(unitLine.textContent).toMatch(/^This week: .+ · day \d+ of \d+$/);
    }
  });

  it('renders the day\u2019s rhythm as a slim ordered checklist (when studying)', () => {
    const root = document.createElement('div');
    today.render(root);
    // Either the checklist renders, or a graceful state does — never a crash.
    // The duplicate "Today's plan" budget card is gone.
    expect(root.querySelector('.today-budget')).toBeFalsy();
    const checklist = root.querySelector('.today-checklist');
    if (checklist) {
      expect(checklist.querySelectorAll('.today-check').length).toBeGreaterThan(0);
    }
  });
});

describe('today view — plan has not started yet (free pre-start days)', () => {
  beforeEach(() => {
    __resetForTests();
    location.hash = '';
  });

  it('shows a "starts tomorrow" card instead of today\u2019s blocks', () => {
    const start = addDaysISO(todayISO(), 1);
    setPlanStartDate(start);
    const root = document.createElement('div');
    today.render(root);
    expect(root.textContent).toContain('Tomorrow is Day 1');
    expect(root.textContent).toContain(prettyDowDate(start));
    expect(root.textContent).toContain('Days before the start date are free');
    // The day's rhythm checklist is NOT rendered before the plan starts.
    expect(root.querySelector('.today-checklist')).toBeFalsy();
  });

  it('describes day 1 as an ORIENTATION day when it is a Saturday (no baseline mock)', () => {
    // The first Saturday on/after tomorrow is the plan's day-1 orientation day.
    let start = addDaysISO(todayISO(), 1);
    while (dayOfWeekISO(start) !== 6) start = addDaysISO(start, 1);
    setPlanStartDate(start);
    const root = document.createElement('div');
    today.render(root);
    expect(root.textContent).toContain('Day 1');
    expect(root.textContent).toContain('Start here');
    expect(root.textContent).not.toContain('baseline');
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

/**
 * Today-view ADMIN TASK cards (eligibility gates, STANDARDS §8a). Driven through
 * the real render, which reads the wall clock, so the tests pin the plan to
 * "running now" (start = today, exam far in the future) so the happy-path (not
 * the pre-start / post-exam graceful states) renders.
 */
describe('today view — admin task cards', () => {
  beforeEach(() => {
    __resetForTests();
    location.hash = '';
    setExamDate(addDaysISO(todayISO(), 120));
    setPlanStartDate(todayISO());
  });

  it('shows the compact "Apply online" card (deadline, checklist, portal link) from plan start', () => {
    const root = document.createElement('div');
    today.render(root);
    expect(root.textContent).toContain('Apply online — deadline 27 Oct 2026, 11:59 PM');
    expect(root.textContent).toContain('OTPR registration / login');
    expect(root.textContent).toContain('Photo & signature specs');
    expect(root.textContent).toContain('Fee payment');
    expect(root.textContent).toContain('Choose exam centre');
    expect(root.textContent).toContain('Download application PDF');
    expect(
      [...root.querySelectorAll<HTMLAnchorElement>('a')].some(
        (a) => a.getAttribute('href') === 'https://psc.ap.gov.in',
      ),
    ).toBe(true);
  });

  it('hides the "Apply online" card once it is marked done', () => {
    const root = document.createElement('div');
    today.render(root);
    const markDone = [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.includes('Mark done'),
    );
    expect(markDone).toBeTruthy();
    markDone!.click();
    expect(isAdminDone('apply-online')).toBe(true);
    const root2 = document.createElement('div');
    today.render(root2);
    expect(root2.textContent).not.toContain('Apply online — deadline');
  });

  it('does NOT show the hall-ticket or exam-day cards before their dates', () => {
    const root = document.createElement('div');
    today.render(root);
    expect(root.textContent).not.toContain('Hall ticket — download when released');
    expect(root.textContent).not.toContain('Exam-day checklist');
  });

  it('respects a pre-set done flag (hidden when already done)', () => {
    setAdminDone('apply-online', true);
    const root = document.createElement('div');
    today.render(root);
    expect(root.textContent).not.toContain('Apply online — deadline');
  });
});
