import { describe, expect, it } from 'vitest';
import type { GlossaryTerm } from '../../content/chronicle-types';
import { eventText, termMatcher } from '../glossary';

const t = (id: string, term: string, aka?: string[]): GlossaryTerm => ({ id, term, aka, meaning: 'm', source: 's' });
const terms = [t('mb', 'Mir Bakhshi'), t('b', 'Bakhshi'), t('d', 'Diwan'), t('di', 'Diwani'), t('s', 'Subadar', ['Subahdar'])];

describe('termMatcher', () => {
  const m = termMatcher(terms);

  it('prefers the longer form and matches whole words in any case', () => {
    expect(m.find('Najib was MIR BAKHSHI at Delhi').map((x) => x.id)).toEqual(['mb']);
    expect(m.find('the diwani of Bengal').map((x) => x.id)).toEqual(['di']);
    expect(m.find('a diwan collected revenue').map((x) => x.id)).toEqual(['d']);
  });

  it('matches aka forms and plurals, once each, in reading order', () => {
    expect(m.find('subahdars and the Diwan, then another subadar').map((x) => x.id)).toEqual(['s', 'd']);
  });

  it('ignores partial words and handles an empty glossary', () => {
    expect(m.find('Diwanpur is a place')).toEqual([]);
    expect(termMatcher([]).find('anything')).toEqual([]);
  });
});

describe('eventText', () => {
  it('collects every teachable field', () => {
    const text = eventText({
      id: 'e', title: 'T', date: { year: 1 }, era: 'mughal', lane: 'north-india', kind: 'battle', summary: 'S', detail: 'D',
      subtopicIds: [], relatedMcqIds: [], apSpecific: false, importance: 1, source: 'x', place: 'P',
      sides: [{ name: 'A', ruler: 'R', commanders: ['C'], allies: ['L'] }, { name: 'B' }],
      causes: ['ca'], course: ['co'], losses: ['lo'], gains: ['ga'],
      treaties: [{ name: 'TN', terms: ['te'] }, { name: 'T2' }], outcomes: ['ou'],
      participants: [{ personId: 'p', role: 'ro', post: 'po' }, { personId: 'q', role: 'r2' }], facts: ['fa'],
    });
    for (const part of ['T', 'S', 'D', 'P', 'A', 'R', 'C', 'L', 'ca', 'co', 'lo', 'ga', 'TN', 'te', 'ou', 'ro', 'po', 'fa']) {
      expect(text).toContain(part);
    }
  });
});
