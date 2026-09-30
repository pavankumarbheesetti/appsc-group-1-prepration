import { describe, it, expect } from 'vitest';
import { detectDirective, buildFramework, scoreRubric, countWords } from '../mains';
import type { MainsItem } from '../../content/types';

/** Minimal MainsItem factory for building test inputs. */
function item(partial: Partial<MainsItem> & { question: string }): MainsItem {
  return {
    id: 't1',
    subjectCode: 'HIST',
    paper: 'mains-2',
    ...partial,
  };
}

describe('detectDirective', () => {
  it('detects simple directives case-insensitively', () => {
    expect(detectDirective('Discuss the causes of the 1857 revolt.')).toBe('Discuss');
    expect(detectDirective('DESCRIBE the Harappan town planning.')).toBe('Describe');
    expect(detectDirective('Explain the doctrine of basic structure.')).toBe('Explain');
  });

  it('prefers the most specific compound directive over its bare form', () => {
    expect(detectDirective('Critically examine the NITI Aayog approach.')).toBe(
      'Critically examine / analyse',
    );
    // bare "examine" still resolves to the plain directive
    expect(detectDirective('Examine the survival of Harappan culture.')).toBe('Examine');
  });

  it('detects "to what extent" and "evaluate/assess" families', () => {
    expect(detectDirective('To what extent did planning achieve its goals?')).toBe(
      'To what extent',
    );
    expect(detectDirective('Assess the impact of the Green Revolution.')).toBe(
      'Evaluate / Assess',
    );
  });

  it('returns undefined when no directive is present', () => {
    expect(detectDirective('The Gupta age and its achievements.')).toBeUndefined();
  });
});

describe('buildFramework', () => {
  const keyPoints = ['Grid-pattern streets', 'Networked drainage', 'Great Bath'];

  it('builds an intro/body/conclusion skeleton from key points', () => {
    const fw = buildFramework(
      item({ question: 'Examine the town planning of the IVC.', keyPoints }),
    );
    expect(fw.body).toEqual([
      'Develop: Grid-pattern streets',
      'Develop: Networked drainage',
      'Develop: Great Bath',
    ]);
    expect(fw.intro.length).toBe(2);
    expect(fw.conclusion.length).toBe(2);
  });

  it('references the detected directive in the intro', () => {
    const fw = buildFramework(item({ question: 'Discuss the IVC economy.', keyPoints }));
    expect(fw.intro[1]).toContain('Discuss');
  });

  it('falls back to multidimensional prompts when there are no key points', () => {
    const fw = buildFramework(item({ question: 'The Mauryan administration.' }));
    expect(fw.body.length).toBeGreaterThan(0);
    expect(fw.body[0]).toMatch(/Develop the/);
  });

  it('is deterministic — same item yields the same skeleton', () => {
    const q = item({ question: 'Analyse the causes of X.', keyPoints });
    expect(buildFramework(q)).toEqual(buildFramework(q));
  });
});

describe('scoreRubric', () => {
  it('sums scores and bands them', () => {
    expect(scoreRubric([2, 2, 2, 2, 2])).toEqual({ total: 10, band: 'Strong' });
    expect(scoreRubric([2, 2, 1, 1, 0])).toEqual({ total: 6, band: 'Developing' });
    expect(scoreRubric([1, 1, 0, 0, 0])).toEqual({ total: 2, band: 'Needs work' });
  });

  it('respects the band boundaries (8 strong, 5 developing)', () => {
    expect(scoreRubric([2, 2, 2, 2, 0]).band).toBe('Strong'); // 8
    expect(scoreRubric([2, 1, 1, 1, 0]).band).toBe('Developing'); // 5
    expect(scoreRubric([1, 1, 1, 1, 0]).band).toBe('Needs work'); // 4
  });

  it('clamps out-of-range and non-finite scores', () => {
    expect(scoreRubric([5, 5, 5, 5, 5]).total).toBe(10); // each clamped to 2
    expect(scoreRubric([-3, 2, 2, 2, 2]).total).toBe(8); // negative → 0
    expect(scoreRubric([Number.NaN, 2, 2, 2, 2]).total).toBe(8); // NaN → 0
  });

  it('handles an empty score list', () => {
    expect(scoreRubric([])).toEqual({ total: 0, band: 'Needs work' });
  });
});

describe('countWords', () => {
  it('counts whitespace-delimited words', () => {
    expect(countWords('one two three')).toBe(3);
    expect(countWords('a single-hyphenated word')).toBe(3);
  });

  it('treats empty or blank input as zero', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('   \n\t  ')).toBe(0);
  });

  it('ignores leading/trailing and repeated whitespace', () => {
    expect(countWords('  hello   world  ')).toBe(2);
    expect(countWords('line one\nline two\n\nline three')).toBe(6);
  });
});
