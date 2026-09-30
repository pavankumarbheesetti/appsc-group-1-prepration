import { describe, it, expect } from 'vitest';
import { computeNavCells } from '../navigator';

/**
 * The navigator state mapping is pure: given a session length, the current
 * index, and the answered map (index → correct?), it returns one chip per
 * question describing colour + "current" emphasis. Answered chips always show
 * their correct/wrong colour; the current UNANSWERED chip is `current`; an
 * answered chip that is also on screen keeps its colour AND the current flag.
 */
describe('computeNavCells', () => {
  it('labels chips 1..N and marks the current unanswered question', () => {
    const cells = computeNavCells(3, 0, new Map());
    expect(cells.map((c) => c.label)).toEqual(['1', '2', '3']);
    expect(cells[0]).toMatchObject({ index: 0, state: 'current', current: true });
    expect(cells[1]).toMatchObject({ state: 'unanswered', current: false });
    expect(cells[2]).toMatchObject({ state: 'unanswered', current: false });
  });

  it('colours answered chips green (correct) / red (wrong)', () => {
    const results = new Map<number, boolean>([
      [0, true],
      [1, false],
    ]);
    const cells = computeNavCells(3, 2, results);
    expect(cells[0]!.state).toBe('correct');
    expect(cells[1]!.state).toBe('wrong');
    expect(cells[2]!.state).toBe('current');
  });

  it('keeps result state while flagging an answered chip as current', () => {
    const results = new Map<number, boolean>([[1, false]]);
    const cells = computeNavCells(3, 1, results);
    // The on-screen (current) question was answered wrong: colour is preserved,
    // and it is still flagged current so the view can add a ring.
    expect(cells[1]).toMatchObject({ state: 'wrong', current: true });
  });

  it('handles large N (returns exactly N cells)', () => {
    const cells = computeNavCells(120, 59, new Map([[59, true]]));
    expect(cells).toHaveLength(120);
    expect(cells[59]).toMatchObject({ state: 'correct', current: true });
    expect(cells[119]!.label).toBe('120');
  });
});
