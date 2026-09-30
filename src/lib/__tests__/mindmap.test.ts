import { describe, it, expect } from 'vitest';
import {
  buildSubjectMindMap,
  buildSubtopicMindMap,
  defaultExpanded,
  examPointMastery,
  examPointNodes,
  flatten,
  layoutMindMap,
  PAD,
  type MindNode,
  type ProgressLike,
} from '../mindmap';
import { getSubtopic, getSubtopics } from '../../content/loader';
import type { SubtopicView } from '../../content/loader';
import type { MCQItem } from '../../content/types';

/** First subtopic that has exam points, authored notes AND MCQs. */
const richId = getSubtopics().find((s) => {
  const v = getSubtopic(s.id);
  return (
    v !== undefined &&
    (v.meta.examPoints?.length ?? 0) > 0 &&
    v.notes.length > 0 &&
    v.mcqs.length > 0
  );
})?.id;

const noProgress: Readonly<Record<string, ProgressLike>> = {};

describe('buildSubtopicMindMap — structural guarantees', () => {
  it.skipIf(!richId)('includes every exam point EXACTLY once', () => {
    const sub = getSubtopic(richId!)!;
    const tree = buildSubtopicMindMap(sub, noProgress);
    const eps = examPointNodes(tree).map((n) => n.label).sort();
    const expected = [...(sub.meta.examPoints ?? [])].sort();
    expect(eps).toEqual(expected);
    // No duplicates: node count === unique label count.
    expect(new Set(eps).size).toBe(eps.length);
  });

  it.skipIf(!richId)('computes each exam point MCQ count from covers[]', () => {
    const sub = getSubtopic(richId!)!;
    const tree = buildSubtopicMindMap(sub, noProgress);
    for (const ep of examPointNodes(tree)) {
      const expected = sub.mcqs.filter((m) => m.covers?.includes(ep.label)).length;
      expect(ep.mcqCount).toBe(expected);
      expect(ep.mcqIds?.length).toBe(expected);
    }
  });

  it.skipIf(!richId)('roots the tree at the subtopic name', () => {
    const sub = getSubtopic(richId!)!;
    const tree = buildSubtopicMindMap(sub, noProgress);
    expect(tree.kind).toBe('root');
    expect(tree.label).toBe(sub.meta.name);
  });

  it('handles a subtopic with NO notes (points hang off root, each once)', () => {
    // Synthetic view — deterministic regardless of authored content: exam points
    // but no notes. Verifies the no-notes fallback (points attach to the root).
    const mcqs: MCQItem[] = [
      { id: 'm1', subjectCode: 'HIST', question: 'q1', options: ['a', 'b'], answerIndex: 0, covers: ['P1'] },
      { id: 'm2', subjectCode: 'HIST', question: 'q2', options: ['a', 'b'], answerIndex: 1, covers: ['P1', 'P2'] },
    ];
    const sub: SubtopicView = {
      meta: { id: 'syn', subjectCode: 'HIST', chapterId: 'c', name: 'Synthetic', order: 0, examPoints: ['P1', 'P2', 'P3'] },
      notes: [],
      mcqs,
      mains: [],
    };
    const tree = buildSubtopicMindMap(sub, noProgress);
    // With no notes there are no `note` group nodes.
    expect(flatten(tree).some((n) => n.kind === 'note')).toBe(false);
    // Exam points are the root's direct children, each present exactly once.
    const eps = examPointNodes(tree).map((n) => n.label).sort();
    expect(eps).toEqual(['P1', 'P2', 'P3']);
    expect(tree.children.every((c) => c.kind === 'examPoint')).toBe(true);
    // MCQ counts come from covers[].
    const p1 = examPointNodes(tree).find((n) => n.label === 'P1')!;
    expect(p1.mcqCount).toBe(2);
    const p3 = examPointNodes(tree).find((n) => n.label === 'P3')!;
    expect(p3.mcqCount).toBe(0);
  });
});

describe('examPointMastery', () => {
  const ids = ['a', 'b', 'c', 'd', 'e'];
  it('is not-started with no progress', () => {
    expect(examPointMastery(ids, {})).toBe('not-started');
  });
  it('is weak when attempted but mostly unmastered', () => {
    const progress: Record<string, ProgressLike> = { a: { seen: 2, correct: 1, wrong: 1 } };
    expect(examPointMastery(ids, progress)).toBe('weak');
  });
  it('is strong when a strong majority are correct-once', () => {
    const progress: Record<string, ProgressLike> = {
      a: { seen: 1, correct: 1, wrong: 0 },
      b: { seen: 1, correct: 1, wrong: 0 },
      c: { seen: 1, correct: 1, wrong: 0 },
      d: { seen: 1, correct: 1, wrong: 0 },
      e: { seen: 1, correct: 1, wrong: 0 },
    };
    expect(examPointMastery(ids, progress)).toBe('strong');
  });
  it('is not-started for an empty id list', () => {
    expect(examPointMastery([], {})).toBe('not-started');
  });
});

describe('layoutMindMap', () => {
  it.skipIf(!richId)('places the root at depth 0 and yields positive dimensions', () => {
    const tree = buildSubtopicMindMap(getSubtopic(richId!)!, noProgress);
    const expanded = defaultExpanded(tree);
    const layout = layoutMindMap(tree, expanded);
    const root = layout.nodes.find((n) => n.node.id === tree.id)!;
    expect(root.depth).toBe(0);
    expect(root.x).toBe(PAD);
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
    // Every laid-out node is unique.
    expect(new Set(layout.nodes.map((n) => n.node.id)).size).toBe(layout.nodes.length);
  });

  it.skipIf(!richId)('shows fewer nodes when a branch is collapsed', () => {
    const tree = buildSubtopicMindMap(getSubtopic(richId!)!, noProgress);
    const full = layoutMindMap(tree, defaultExpanded(tree)).nodes.length;
    const collapsed = layoutMindMap(tree, new Set([tree.id])).nodes.length;
    // Collapsed-to-root shows only root + its direct children.
    expect(collapsed).toBe(1 + tree.children.length);
    expect(collapsed).toBeLessThanOrEqual(full);
  });
});

describe('buildSubjectMindMap', () => {
  it('nests subtopics with exam points under a subject root', () => {
    const subs: SubtopicView[] = getSubtopics('HIST').map((s) => getSubtopic(s.id)!);
    const tree = buildSubjectMindMap('History & Culture', subs, noProgress);
    expect(tree.kind).toBe('root');
    expect(tree.label).toBe('History & Culture');
    // Each child is a subtopic node; each of its children is an exam point.
    const subtopicNodes: MindNode[] = tree.children;
    expect(subtopicNodes.length).toBeGreaterThan(0);
    expect(subtopicNodes.every((n) => n.kind === 'subtopic')).toBe(true);
    expect(subtopicNodes.every((n) => n.children.every((c) => c.kind === 'examPoint'))).toBe(true);
  });
});
