import { describe, it, expect } from 'vitest';
import {
  buildPaperMock,
  mockSeriesLength,
  scorePaperMock,
  type SectionPools,
} from '../mock';
import { PAPER_I, PAPER_II, type ExamPattern } from '../../lib/exam-pattern';
import type { MCQItem } from '../../content/types';

/** Build `n` fixture MCQs for a subject, ids `${code}-1..n`. @internal */
function pool(code: MCQItem['subjectCode'], n: number): MCQItem[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${code}-${i + 1}`,
    subjectCode: code,
    question: `${code} Q${i + 1}`,
    options: ['a', 'b', 'c', 'd'],
    answerIndex: i % 4,
    verified: true,
  }));
}

/** Generous pools so Paper-I / Paper-II have a multi-mock non-repeating series. */
function fullPools(): SectionPools {
  return {
    HIST: pool('HIST', 200),
    POL: pool('POL', 200),
    ECON: pool('ECON', 200),
    GEO: pool('GEO', 200),
    MENT: pool('MENT', 200),
    SCI: pool('SCI', 200),
    CA: pool('CA', 200),
  };
}

describe('buildPaperMock — draws a full paper by section weight', () => {
  it('assembles exactly the pattern total, split by section counts', () => {
    for (const pattern of [PAPER_I, PAPER_II] as ExamPattern[]) {
      const mock = buildPaperMock(pattern, fullPools(), 1);
      expect(mock.items).toHaveLength(pattern.totalQuestions);
      expect(mock.sections).toHaveLength(pattern.sections.length);
      // Each section drew exactly its weighted count.
      pattern.sections.forEach((spec, i) => {
        expect(mock.sections[i]!.items).toHaveLength(spec.count);
        expect(mock.sections[i]!.items.every((it) => it.subjectCode === spec.subjectCode)).toBe(true);
      });
      // sectionByIndex maps every flattened question to its section.
      expect(mock.sectionByIndex).toHaveLength(pattern.totalQuestions);
    }
  });

  it('never repeats a question WITHIN a single built mock', () => {
    const mock = buildPaperMock(PAPER_I, fullPools(), 1);
    const ids = mock.items.map((it) => it.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('is deterministic — identical inputs yield an identical paper', () => {
    const a = buildPaperMock(PAPER_I, fullPools(), 3);
    const b = buildPaperMock(PAPER_I, fullPools(), 3);
    expect(a.items.map((x) => x.id)).toEqual(b.items.map((x) => x.id));
  });

  it('draws NON-REPEATING questions across a series (Mock 1..N disjoint)', () => {
    const pools = fullPools();
    const seriesLen = mockSeriesLength(PAPER_I, pools); // min(200/30)=6
    const seen = new Set<string>();
    for (let n = 1; n <= seriesLen; n += 1) {
      for (const it of buildPaperMock(PAPER_I, pools, n).items) {
        expect(seen.has(it.id)).toBe(false); // no reuse across the series
        seen.add(it.id);
      }
    }
  });

  it('wraps (flags reuse) only once the series is exhausted', () => {
    const pools = fullPools();
    const seriesLen = mockSeriesLength(PAPER_I, pools);
    // Within the series, no section wraps.
    for (let n = 1; n <= seriesLen; n += 1) {
      expect(buildPaperMock(PAPER_I, pools, n).sections.every((s) => !s.wrapped)).toBe(true);
    }
    // Beyond the series, at least one section wraps.
    const beyond = buildPaperMock(PAPER_I, pools, seriesLen + 1);
    expect(beyond.sections.some((s) => s.wrapped)).toBe(true);
  });

  it('handles a section with too small a pool honestly (wrap-flagged)', () => {
    const pools: SectionPools = { ...fullPools(), GEO: pool('GEO', 10) };
    const mock = buildPaperMock(PAPER_I, pools, 1);
    const geo = mock.sections.find((s) => s.section.subjectCode === 'GEO')!;
    // Still fills the section count (30) but flags the reuse.
    expect(geo.items).toHaveLength(30);
    expect(geo.wrapped).toBe(true);
  });

  it('an empty section pool contributes zero questions (total shrinks honestly)', () => {
    const pools: SectionPools = { ...fullPools(), CA: [] };
    const mock = buildPaperMock(PAPER_II, pools, 1);
    const ca = mock.sections.find((s) => s.section.subjectCode === 'CA')!;
    expect(ca.items).toHaveLength(0);
    expect(mock.items).toHaveLength(PAPER_II.totalQuestions - 30);
  });
});

describe('mockSeriesLength — how many non-repeating mocks the pools support', () => {
  it('is the min over sections of floor(pool / sectionCount)', () => {
    const pools: SectionPools = {
      HIST: pool('HIST', 200), // 200/30 = 6
      POL: pool('POL', 90), // 90/30 = 3
      ECON: pool('ECON', 200),
      GEO: pool('GEO', 200),
    };
    expect(mockSeriesLength(PAPER_I, pools)).toBe(3);
  });

  it('ignores empty pools and floors at 1', () => {
    const pools: SectionPools = { HIST: pool('HIST', 5) }; // others absent/empty
    expect(mockSeriesLength(PAPER_I, pools)).toBeGreaterThanOrEqual(1);
    expect(mockSeriesLength(PAPER_I, {})).toBe(1);
  });
});

describe('scorePaperMock — per-section + overall net marks', () => {
  it('scores each section and the overall with 1/3 negative marking', () => {
    const mock = buildPaperMock(PAPER_I, fullPools(), 1);
    // Answer every question correctly except deliberately wrong the first 3.
    const selected = mock.items.map((it, i) => (i < 3 ? (it.answerIndex + 1) % 4 : it.answerIndex));
    const result = scorePaperMock(mock, selected);

    // Overall: 120 attempted, 117 correct, 3 wrong → net = 117 − 3/3 = 116.
    expect(result.overall.total).toBe(120);
    expect(result.overall.correct).toBe(117);
    expect(result.overall.wrong).toBe(3);
    expect(result.overall.net).toBeCloseTo(116, 6);

    // Per-section nets sum to the overall net.
    const sectionNetSum = result.sections.reduce((a, s) => a + s.net, 0);
    expect(sectionNetSum).toBeCloseTo(result.overall.net, 6);
    // One section per pattern section, each carrying its marks cap.
    expect(result.sections).toHaveLength(PAPER_I.sections.length);
    for (const s of result.sections) expect(s.section.marks).toBe(30);
  });

  it('does not penalise blanks (skips are neutral)', () => {
    const mock = buildPaperMock(PAPER_II, fullPools(), 1);
    const selected = mock.items.map(() => null); // all blank
    const result = scorePaperMock(mock, selected);
    expect(result.overall.net).toBe(0);
    expect(result.overall.skipped).toBe(120);
  });
});
