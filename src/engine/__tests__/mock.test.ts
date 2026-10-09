import { describe, it, expect } from 'vitest';
import {
  buildPaperMock,
  mockSeriesLength,
  scorePaperMock,
  buildWeekTest,
  buildWeekTestSeries,
  scoreWeekTest,
  type SectionPools,
  type WeekTestInput,
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

/* -------------------------------------------------------------------------- */
/* WEEK TEST                                                                   */
/* -------------------------------------------------------------------------- */

/** Fixture MCQs with a tag-prefixed id so a draw's provenance is checkable. */
function tagged(tag: string, code: MCQItem['subjectCode'], n: number): MCQItem[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${tag}-${i + 1}`,
    subjectCode: code,
    question: `${tag} Q${i + 1}`,
    options: ['a', 'b', 'c', 'd'],
    answerIndex: i % 4,
    verified: true,
  }));
}

/** A generous week-test input: both papers, both tiers well-stocked. */
function wtInput(dateISO: string): WeekTestInput {
  return {
    dateISO,
    thisWeek: {
      paper1: tagged('p1tw', 'HIST', 60),
      paper2: tagged('p2tw', 'MENT', 40),
    },
    earlier: {
      paper1: tagged('p1ea', 'POL', 60),
      paper2: tagged('p2ea', 'SCI', 40),
    },
  };
}

describe('buildWeekTest — a scoped, studied-topics-only mini mock', () => {
  it('draws 45 questions, 55 minutes by default', () => {
    const t = buildWeekTest(wtInput('2026-10-17'));
    expect(t.count).toBe(45);
    expect(t.items).toHaveLength(45);
    expect(t.durationMin).toBe(55);
    expect(t.sectionByIndex).toHaveLength(45);
    expect(new Set(t.items.map((i) => i.id)).size).toBe(45); // no dup within a test
  });

  it('favours THIS week ~2/3 and earlier ~1/3', () => {
    const t = buildWeekTest(wtInput('2026-10-17'));
    const thisWeek = t.items.filter((i) => i.id.includes('tw')).length;
    const earlier = t.items.filter((i) => i.id.includes('ea')).length;
    expect(thisWeek + earlier).toBe(45);
    // 2/3 of 45 = 30 this-week, 15 earlier (allowing small rounding slack).
    expect(thisWeek).toBeGreaterThanOrEqual(28);
    expect(thisWeek).toBeLessThanOrEqual(32);
    expect(earlier).toBeGreaterThanOrEqual(13);
    expect(earlier).toBeLessThanOrEqual(17);
  });

  it('keeps Paper-I / Paper-II in proportion to what was covered', () => {
    // Paper-I covered 120 (60+60), Paper-II 80 (40+40) → 60% / 40% → ~27 / ~18.
    const t = buildWeekTest(wtInput('2026-10-17'));
    const p1 = t.sectionByIndex.filter((p) => p === 'paper1').length;
    const p2 = t.sectionByIndex.filter((p) => p === 'paper2').length;
    expect(p1 + p2).toBe(45);
    expect(p1).toBeGreaterThan(p2); // Paper-I had more covered material
    expect(p1).toBeGreaterThanOrEqual(25);
    expect(p1).toBeLessThanOrEqual(29);
  });

  it('is deterministic in its date seed', () => {
    const a = buildWeekTest(wtInput('2026-10-17'));
    const b = buildWeekTest(wtInput('2026-10-17'));
    expect(a.items.map((i) => i.id)).toEqual(b.items.map((i) => i.id));
    const c = buildWeekTest(wtInput('2026-10-24'));
    expect(c.items.map((i) => i.id)).not.toEqual(a.items.map((i) => i.id));
  });

  it('respects an exclude set — avoids reused ids while the pool allows', () => {
    const first = buildWeekTest(wtInput('2026-10-17'));
    const exclude = new Set(first.items.map((i) => i.id));
    const second = buildWeekTest(wtInput('2026-10-24'), {}, exclude);
    const overlap = second.items.filter((i) => exclude.has(i.id)).length;
    expect(overlap).toBe(0); // pool (200) >> 90 drawn, so zero reuse
  });

  it('fills from the other paper/bucket when one is tiny (no silent short)', () => {
    const t = buildWeekTest({
      dateISO: '2026-10-17',
      thisWeek: { paper1: tagged('p1tw', 'HIST', 5), paper2: tagged('p2tw', 'MENT', 50) },
      earlier: { paper1: [], paper2: tagged('p2ea', 'SCI', 50) },
    });
    expect(t.count).toBe(45);
    expect(t.short).toBe(false);
  });

  it('is honestly short when the studied pool is smaller than the ask', () => {
    const t = buildWeekTest({
      dateISO: '2026-10-17',
      thisWeek: { paper1: tagged('p1tw', 'HIST', 10), paper2: tagged('p2tw', 'MENT', 5) },
      earlier: { paper1: [], paper2: [] },
    });
    expect(t.count).toBe(15);
    expect(t.short).toBe(true);
  });

  it('honours a custom count and duration', () => {
    const t = buildWeekTest(wtInput('2026-10-17'), { count: 20, durationMin: 25 });
    expect(t.items).toHaveLength(20);
    expect(t.durationMin).toBe(25);
  });
});

describe('buildWeekTestSeries — no repeats across tests where the pool allows', () => {
  it('threads a used-set so consecutive tests draw disjoint questions', () => {
    // A growing pool across three Saturdays; 200 p1 + 160 p2 total ≥ 3×45.
    const inputs: WeekTestInput[] = ['2026-10-17', '2026-10-24', '2026-10-31'].map((d) => wtInput(d));
    const series = buildWeekTestSeries(inputs);
    const all = [...series.values()].flatMap((t) => t.items.map((i) => i.id));
    expect(all.length).toBe(135);
    expect(new Set(all).size).toBe(135); // every question unique across the series
  });

  it('is deterministic as a whole', () => {
    const inputs: WeekTestInput[] = ['2026-10-17', '2026-10-24'].map((d) => wtInput(d));
    const a = buildWeekTestSeries(inputs);
    const b = buildWeekTestSeries(inputs);
    for (const d of ['2026-10-17', '2026-10-24']) {
      expect(a.get(d)!.items.map((i) => i.id)).toEqual(b.get(d)!.items.map((i) => i.id));
    }
  });
});

describe('scoreWeekTest — per-paper + overall net marks (−1/3)', () => {
  it('scores each paper and the overall, blanks neutral', () => {
    const t = buildWeekTest(wtInput('2026-10-17'));
    // Correct all but the first 3 (wrong); overall net = correct − wrong/3.
    const selected = t.items.map((it, i) => (i < 3 ? (it.answerIndex + 1) % 4 : it.answerIndex));
    const r = scoreWeekTest(t, selected);
    expect(r.overall.total).toBe(45);
    expect(r.overall.correct).toBe(42);
    expect(r.overall.wrong).toBe(3);
    expect(r.overall.net).toBeCloseTo(41, 6);
    const papers = r.sections.map((s) => s.paper);
    expect(papers).toContain('paper1');
    expect(papers).toContain('paper2');
    const netSum = r.sections.reduce((a, s) => a + s.net, 0);
    expect(netSum).toBeCloseTo(r.overall.net, 6);
  });

  it('does not penalise blanks', () => {
    const t = buildWeekTest(wtInput('2026-10-17'));
    const r = scoreWeekTest(t, t.items.map(() => null));
    expect(r.overall.net).toBe(0);
    expect(r.overall.skipped).toBe(45);
  });
});
