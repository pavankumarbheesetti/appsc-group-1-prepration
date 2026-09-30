/**
 * Mind-map MODEL + LAYOUT — PURE functions only (no DOM, no loader, no store).
 *
 * The whole mind map is DERIVED at runtime from our own content ids (there are
 * NO hand-authored maps): a subtopic's taxonomy `examPoints`, its `notes`
 * (title + keyPoints), and the MCQs whose `covers[]` reference each exam-point.
 * Nothing new is invented — the tree only re-arranges facts the content already
 * declares.
 *
 * TREE SHAPE (subtopic map)
 *   subtopic (root)
 *   └── note group        — label = note title; groups the exam-points that
 *       │                    relate to that note (matched on title/keyPoints)
 *       ├── examPoint      — a branch; shows #MCQs covering it + a mastery
 *       │                    colour derived from progress
 *       └── keyPoint       — the note's must-remember bullets, as leaves
 *   └── "Other exam points" — a synthetic group for exam-points that match no
 *                             note (only when the subtopic HAS notes)
 *
 * When a subtopic has NO notes, its exam-points attach directly under the root
 * (still each appearing EXACTLY ONCE). A subject-level overview reuses the same
 * node model: subject (root) → subtopic → examPoint.
 *
 * Kept pure so the builder is trivially unit-tested (every exam-point appears
 * exactly once; MCQ counts are correct; a note-less subtopic still works) and
 * the layout is deterministic (positions depend only on the visible tree, never
 * on measured text or the DOM).
 */
import type { SubtopicView } from '../content/loader';
import type { MCQItem, NoteItem } from '../content/types';

/* -------------------------------------------------------------------------- */
/* Model                                                                       */
/* -------------------------------------------------------------------------- */

/** The kind of a mind-map node (drives styling + interaction). */
export type MindKind = 'root' | 'subtopic' | 'note' | 'examPoint' | 'keyPoint';

/**
 * A node's MASTERY colour, derived from progress over the MCQs that cover it:
 * - `not-started` — none of its covering MCQs have been attempted.
 * - `weak` — attempted, but not yet answered correctly often enough.
 * - `strong` — answered correctly on a strong majority of its covering MCQs.
 */
export type MindMastery = 'not-started' | 'weak' | 'strong';

/**
 * The minimal per-question progress shape {@link examPointMastery} needs — a
 * structural subset of the store's `ProgressEntry`, redeclared here so the lib
 * stays free of any state-layer import (mirrors the engine's `ProgressLike`).
 */
export interface ProgressLike {
  seen: number;
  correct: number;
  wrong: number;
}

/** One node of the derived mind map. */
export interface MindNode {
  /** Stable, DOM-safe unique id within this tree (sequential, e.g. `mm7`). */
  id: string;
  kind: MindKind;
  /** Human-readable label (the exam-point / note title / key-point text). */
  label: string;
  /** Child nodes in display order (empty for leaves). */
  children: MindNode[];
  /** examPoint only — number of MCQs whose `covers[]` include this exam-point. */
  mcqCount?: number;
  /** examPoint only — the ids of those MCQs (drives the "Drill these N" filter). */
  mcqIds?: readonly string[];
  /** examPoint / subtopic — mastery colour from progress (see {@link MindMastery}). */
  mastery?: MindMastery;
  /** The note this node relates to, when known (for the side-panel excerpt). */
  noteId?: string;
  /** The owning subtopic id (for "Open notes" / drill routing). */
  subtopicId?: string;
  /** note / subtopic — a short excerpt shown in the side panel. */
  excerpt?: string;
}

/* -------------------------------------------------------------------------- */
/* Mastery                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Fraction of an exam-point's covering MCQs that must be answered correctly at
 * least once for it to read as `strong` (mirrors the tracker's MASTERED bar).
 */
export const STRONG_THRESHOLD = 0.8;

/**
 * Derive an exam-point's {@link MindMastery} from the progress over the MCQs
 * that cover it. `not-started` when none were attempted; `strong` once the
 * correct-once share crosses {@link STRONG_THRESHOLD}; `weak` in between. Pure;
 * an empty id list is always `not-started`.
 */
export function examPointMastery(
  mcqIds: readonly string[],
  progress: Readonly<Record<string, ProgressLike>>,
): MindMastery {
  if (mcqIds.length === 0) return 'not-started';
  let seen = 0;
  let correctOnce = 0;
  for (const id of mcqIds) {
    const p = progress[id];
    if (p && p.seen > 0) {
      seen += 1;
      if (p.correct > 0) correctOnce += 1;
    }
  }
  if (seen === 0) return 'not-started';
  return correctOnce / mcqIds.length >= STRONG_THRESHOLD ? 'strong' : 'weak';
}

/* -------------------------------------------------------------------------- */
/* Builder helpers                                                             */
/* -------------------------------------------------------------------------- */

/** Significant (≥4-char) lowercase word tokens of a string. @internal */
function tokens(s: string): Set<string> {
  return new Set(s.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []);
}

/**
 * Score how strongly a note relates to an exam-point: the number of significant
 * word tokens the exam-point shares with the note's title + keyPoints, plus a
 * bonus when either fully contains the other as a substring (so short
 * proper-noun exam-points like "Lothal" still match a note that names them).
 * @internal
 */
function noteExamPointScore(note: NoteItem, examPoint: string): number {
  const hay = `${note.title} ${(note.keyPoints ?? []).join(' ')}`.toLowerCase();
  const ep = examPoint.toLowerCase();
  let score = 0;
  if (ep.length >= 3 && hay.includes(ep)) score += 3;
  const epTokens = tokens(examPoint);
  const hayTokens = tokens(hay);
  for (const t of epTokens) if (hayTokens.has(t)) score += 1;
  return score;
}

/** A monotonic id generator, so every node gets a unique DOM-safe id. @internal */
function makeIdGen(): () => string {
  let seq = 0;
  return () => `mm${seq++}`;
}

/**
 * A short plain-text excerpt for a note's side panel: the first non-heading,
 * non-empty line of its markdown body (bullet markers + bold stripped), else
 * its first keyPoint, capped to a readable length. @internal
 */
export function noteExcerpt(note: NoteItem, max = 220): string {
  const lines = note.body.split('\n');
  for (const raw of lines) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#') || /^(?:-{3,}|\*{3,})$/.test(line)) continue;
    const text = line.replace(/^[-*]\s+/, '').replace(/\*\*/g, '').trim();
    if (text !== '') return text.length > max ? `${text.slice(0, max - 1).trimEnd()}\u2026` : text;
  }
  const kp = note.keyPoints?.[0];
  if (kp) return kp.length > max ? `${kp.slice(0, max - 1).trimEnd()}\u2026` : kp;
  return '';
}

/** Build one examPoint node (with its covering MCQ ids + mastery). @internal */
function examPointNode(
  uid: () => string,
  examPoint: string,
  mcqs: readonly MCQItem[],
  subtopicId: string,
  noteId: string | undefined,
  progress: Readonly<Record<string, ProgressLike>>,
): MindNode {
  const ids = mcqs.filter((m) => m.covers?.includes(examPoint)).map((m) => m.id);
  return {
    id: uid(),
    kind: 'examPoint',
    label: examPoint,
    children: [],
    mcqCount: ids.length,
    mcqIds: ids,
    mastery: examPointMastery(ids, progress),
    noteId,
    subtopicId,
  };
}

/* -------------------------------------------------------------------------- */
/* Builders                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Build the mind-map tree for ONE subtopic from its content + progress.
 *
 * Every exam-point appears EXACTLY ONCE — assigned to the single best-matching
 * note (highest {@link noteExamPointScore}, ties broken by note order) or, when
 * it matches no note, to the synthetic "Other exam points" group (or, when the
 * subtopic has no notes at all, directly under the root). MCQ counts on each
 * exam-point are the number of the subtopic's MCQs whose `covers[]` include it.
 * PURE — inputs are never mutated.
 */
export function buildSubtopicMindMap(
  sub: SubtopicView,
  progress: Readonly<Record<string, ProgressLike>>,
): MindNode {
  const uid = makeIdGen();
  const subtopicId = sub.meta.id;
  const examPoints = sub.meta.examPoints ?? [];
  const notes = sub.notes;

  // Assign each exam-point to its best-matching note (or null → unassigned).
  const assignment = new Map<string, string | null>();
  for (const ep of examPoints) {
    let bestScore = 0;
    let bestNoteId: string | null = null;
    for (const n of notes) {
      const score = noteExamPointScore(n, ep);
      if (score > bestScore) {
        bestScore = score;
        bestNoteId = n.id;
      }
    }
    assignment.set(ep, bestNoteId);
  }

  const children: MindNode[] = [];
  const assigned = new Set<string>();

  // One group per authored note: its matched exam-points, then its key points.
  for (const n of notes) {
    const eps = examPoints.filter((ep) => assignment.get(ep) === n.id);
    for (const ep of eps) assigned.add(ep);
    const epNodes = eps.map((ep) => examPointNode(uid, ep, sub.mcqs, subtopicId, n.id, progress));
    const kpNodes = (n.keyPoints ?? []).map((kp): MindNode => ({
      id: uid(),
      kind: 'keyPoint',
      label: kp,
      children: [],
      noteId: n.id,
      subtopicId,
    }));
    children.push({
      id: uid(),
      kind: 'note',
      label: n.title,
      children: [...epNodes, ...kpNodes],
      noteId: n.id,
      subtopicId,
      excerpt: noteExcerpt(n),
    });
  }

  // Exam-points matched to no note.
  const unassigned = examPoints.filter((ep) => !assigned.has(ep));
  if (unassigned.length > 0) {
    const epNodes = unassigned.map((ep) => examPointNode(uid, ep, sub.mcqs, subtopicId, undefined, progress));
    if (notes.length === 0) {
      // No notes → exam-points hang directly off the root.
      children.push(...epNodes);
    } else {
      children.push({
        id: uid(),
        kind: 'note',
        label: 'Other exam points',
        children: epNodes,
        subtopicId,
      });
    }
  }

  return {
    id: uid(),
    kind: 'root',
    label: sub.meta.name,
    children,
    subtopicId,
  };
}

/**
 * Build a SUBJECT-level overview map: subject (root) → subtopic → examPoint.
 * Only subtopics that declare exam-points are included (an empty subtopic adds
 * nothing to map). Each subtopic node carries an aggregate mastery (over all its
 * MCQs) and each exam-point its per-point count + mastery, so the overview is a
 * heat-map of where work remains. PURE.
 */
export function buildSubjectMindMap(
  subjectName: string,
  subs: readonly SubtopicView[],
  progress: Readonly<Record<string, ProgressLike>>,
): MindNode {
  const uid = makeIdGen();
  const children: MindNode[] = [];
  for (const sub of subs) {
    const examPoints = sub.meta.examPoints ?? [];
    if (examPoints.length === 0) continue;
    const epNodes = examPoints.map((ep) =>
      examPointNode(uid, ep, sub.mcqs, sub.meta.id, undefined, progress),
    );
    children.push({
      id: uid(),
      kind: 'subtopic',
      label: sub.meta.name,
      children: epNodes,
      subtopicId: sub.meta.id,
      mastery: examPointMastery(sub.mcqs.map((m) => m.id), progress),
    });
  }
  return { id: uid(), kind: 'root', label: subjectName, children };
}

/* -------------------------------------------------------------------------- */
/* Tree walking utilities                                                      */
/* -------------------------------------------------------------------------- */

/** Depth-first pre-order flatten of a tree into a node array. */
export function flatten(root: MindNode): MindNode[] {
  const out: MindNode[] = [];
  const walk = (n: MindNode): void => {
    out.push(n);
    for (const c of n.children) walk(c);
  };
  walk(root);
  return out;
}

/** All exam-point nodes anywhere in the tree, in pre-order. */
export function examPointNodes(root: MindNode): MindNode[] {
  return flatten(root).filter((n) => n.kind === 'examPoint');
}

/** Every node id that HAS children (i.e. is expandable). */
export function expandableIds(root: MindNode): Set<string> {
  const ids = new Set<string>();
  for (const n of flatten(root)) if (n.children.length > 0) ids.add(n.id);
  return ids;
}

/**
 * The set of ids to expand by DEFAULT: the root plus every `note`/`subtopic`
 * group, so exam-points are visible on open while key-points stay tucked away.
 */
export function defaultExpanded(root: MindNode): Set<string> {
  const ids = new Set<string>([root.id]);
  for (const c of root.children) {
    if (c.children.length > 0) ids.add(c.id);
  }
  return ids;
}

/* -------------------------------------------------------------------------- */
/* Layout — a deterministic left-to-right tidy tree                            */
/* -------------------------------------------------------------------------- */

/** Horizontal distance between depth columns (px). */
export const COL_W = 250;
/** Vertical slot height per leaf row (px). */
export const ROW_H = 30;
/** Rendered node box height (px). */
export const NODE_H = 24;
/** Rendered node box width (px) — slightly less than the column gap. */
export const NODE_W = 212;
/** Outer padding around the laid-out content (px). */
export const PAD = 16;

/** A node placed at an (x, y) centre with its depth + expansion state. */
export interface PositionedNode {
  node: MindNode;
  depth: number;
  /** Left edge x of the node box. */
  x: number;
  /** Vertical centre y of the node box. */
  y: number;
  hasChildren: boolean;
  expanded: boolean;
}

/** A connector between a parent's right edge and a child's left edge. */
export interface MindEdge {
  fromId: string;
  toId: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** The result of {@link layoutMindMap}: placed nodes, edges and total size. */
export interface MindLayout {
  nodes: PositionedNode[];
  edges: MindEdge[];
  width: number;
  height: number;
}

/**
 * Lay a tree out left-to-right given the set of EXPANDED node ids. A node's
 * children are visible iff its id is in `expanded`; a node with children that is
 * NOT expanded is drawn as a collapsed leaf (occupying a single row). Leaves are
 * assigned sequential vertical slots; each parent is centred on its visible
 * children. Deterministic and DOM-free, so it is trivially unit-testable. PURE.
 */
export function layoutMindMap(root: MindNode, expanded: ReadonlySet<string>): MindLayout {
  const nodes: PositionedNode[] = [];
  const edges: MindEdge[] = [];
  let nextRow = 0;
  let maxDepth = 0;

  const walk = (node: MindNode, depth: number): PositionedNode => {
    if (depth > maxDepth) maxDepth = depth;
    const hasChildren = node.children.length > 0;
    const isExpanded = hasChildren && expanded.has(node.id);
    const x = PAD + depth * COL_W;

    let y: number;
    const placed: PositionedNode[] = [];
    if (isExpanded) {
      for (const child of node.children) placed.push(walk(child, depth + 1));
      const first = placed[0]!;
      const last = placed[placed.length - 1]!;
      y = (first.y + last.y) / 2;
    } else {
      y = PAD + nextRow * ROW_H + ROW_H / 2;
      nextRow += 1;
    }

    const self: PositionedNode = { node, depth, x, y, hasChildren, expanded: isExpanded };
    nodes.push(self);
    for (const child of placed) {
      edges.push({
        fromId: node.id,
        toId: child.node.id,
        x1: x + NODE_W,
        y1: y,
        x2: child.x,
        y2: child.y,
      });
    }
    return self;
  };

  walk(root, 0);

  const width = PAD * 2 + (maxDepth + 1) * COL_W - (COL_W - NODE_W);
  const height = PAD * 2 + Math.max(1, nextRow) * ROW_H;
  return { nodes, edges, width, height };
}
