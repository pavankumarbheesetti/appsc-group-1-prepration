import { describe, it, expect } from 'vitest';
import {
  addDaysISO,
  daysUntilExam,
  diffDaysISO,
  inclusiveDaysISO,
  isValidISODate,
  isoToUTC,
  todayISO,
  utcToISO,
} from '../dates';

describe('isValidISODate', () => {
  it('accepts real ISO calendar dates', () => {
    expect(isValidISODate('2026-11-15')).toBe(true);
    expect(isValidISODate('2000-02-29')).toBe(true); // leap year
  });

  it('rejects malformed or impossible dates', () => {
    expect(isValidISODate('2026-02-31')).toBe(false); // rolls forward → rejected
    expect(isValidISODate('2026-13-01')).toBe(false);
    expect(isValidISODate('15/11/2026')).toBe(false);
    expect(isValidISODate('2026-1-1')).toBe(false); // not zero-padded
    expect(isValidISODate('garbage')).toBe(false);
  });
});

describe('addDaysISO / diffDaysISO', () => {
  it('adds and subtracts whole days across month boundaries', () => {
    expect(addDaysISO('2026-11-15', 1)).toBe('2026-11-16');
    expect(addDaysISO('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDaysISO('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('diffs signed whole days', () => {
    expect(diffDaysISO('2026-01-01', '2026-01-11')).toBe(10);
    expect(diffDaysISO('2026-01-11', '2026-01-01')).toBe(-10);
    expect(diffDaysISO('2026-01-01', '2026-01-01')).toBe(0);
  });
});

describe('inclusiveDaysISO', () => {
  it('counts both ends and clamps to 0 when b precedes a', () => {
    expect(inclusiveDaysISO('2026-01-01', '2026-01-01')).toBe(1);
    expect(inclusiveDaysISO('2026-01-01', '2026-01-10')).toBe(10);
    expect(inclusiveDaysISO('2026-01-10', '2026-01-01')).toBe(0);
  });
});

describe('daysUntilExam — single source for the exam countdown', () => {
  it('counts today THROUGH the exam day inclusively, and 0 once past', () => {
    // Exam day itself counts as 1.
    expect(daysUntilExam('2026-11-15', '2026-11-15')).toBe(1);
    // Day before the exam → 2 (today + exam day).
    expect(daysUntilExam('2026-11-15', '2026-11-14')).toBe(2);
    // Once the exam date has passed → 0.
    expect(daysUntilExam('2026-11-15', '2026-11-16')).toBe(0);
    // The reported case: 27 Sep → 15 Nov ⇒ 50 (matches PlanSummary.daysLeft).
    expect(daysUntilExam('2026-11-15', '2026-09-27')).toBe(50);
  });

  it('equals inclusiveDaysISO(today, exam) with args in exam-first order', () => {
    expect(daysUntilExam('2026-11-15', '2026-09-27')).toBe(
      inclusiveDaysISO('2026-09-27', '2026-11-15'),
    );
  });
});

describe('isoToUTC / utcToISO round-trip', () => {
  it('round-trips a date through UTC ms', () => {
    expect(utcToISO(isoToUTC('2026-11-15'))).toBe('2026-11-15');
  });

  it('throws on invalid input to isoToUTC', () => {
    expect(() => isoToUTC('nope')).toThrow(/Invalid ISO date/);
  });
});

describe('todayISO', () => {
  it('formats a supplied date as zero-padded ISO', () => {
    expect(todayISO(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(todayISO(new Date(2026, 10, 15))).toBe('2026-11-15');
  });
});
