import { describe, expect, it } from 'vitest';
import { contemporaries, groupsOf, previousInGroup, spanLabel } from '../revision';
import type { RevisionCard } from '../../content/revision-types';

const card = (id: string, group: string, from: number, to: number): RevisionCard => ({ id, key: id, group, span: { from, to }, facets: [{ label: 'x', points: ['y'] }] });
const cards = [card('a', 'N', -300, -200), card('b', 'N', -150, -50), card('c', 'S', -250, -100), card('d', 'S', 100, 200)];

describe('revision helpers', () => {
  it('finds the previous card in the same row', () => {
    expect(previousInGroup(cards[1]!, cards)?.id).toBe('a');
    expect(previousInGroup(cards[0]!, cards)).toBeNull();
  });
  it('finds cards of other rows that ran at the same time', () => {
    expect(contemporaries(cards[0]!, cards).map((c) => c.id)).toEqual(['c']);
    expect(contemporaries(cards[3]!, cards)).toEqual([]);
  });
  it('labels years and lists rows', () => {
    expect(spanLabel(cards[0]!)).toBe('300 BCE – 200 BCE');
    expect(groupsOf(cards)).toEqual(['N', 'S']);
  });
});
