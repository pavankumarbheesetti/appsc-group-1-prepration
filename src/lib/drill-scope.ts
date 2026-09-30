/**
 * Drill scope helpers — PURE derivation (no DOM, no loader, no store).
 *
 * The Drill page's "Refine" controls narrow the preset pools by Subject →
 * Subtopic → Tier. This module builds the SUBTOPIC option list for a chosen
 * subject: only the subtopics that actually have MCQs are offered (drilling an
 * empty subtopic is meaningless), each labelled `Name (N)` where `N` is that
 * subtopic's authored MCQ count.
 *
 * Kept pure so it is trivially unit-tested: callers pass the subject's
 * subtopics (already ordered by the taxonomy) plus a function that reports each
 * subtopic's MCQ count; the view layer wires those to the content loader.
 */

/** The minimal subtopic shape {@link subtopicDrillOptions} needs. */
export interface SubtopicLike {
  id: string;
  name: string;
}

/** A drillable subtopic option: metadata + its MCQ count + a display label. */
export interface SubtopicDrillOption {
  /** Taxonomy subtopic id (the `subtopicId` passed to `buildSession`). */
  id: string;
  /** Human-readable subtopic name. */
  name: string;
  /** Number of authored MCQs in this subtopic (always `> 0` in the result). */
  mcqCount: number;
  /** Option label, e.g. `Mauryan Empire (48)`. */
  label: string;
}

/**
 * Build the drillable subtopic options for a subject.
 *
 * Only subtopics with `mcqCount > 0` are returned (in input order, which is the
 * taxonomy `order`), each carrying its count and a `Name (N)` label. A subject
 * with no MCQ-bearing subtopics yields `[]`, so the caller can disable the
 * selector gracefully.
 *
 * PURE: inputs are never mutated.
 */
export function subtopicDrillOptions(
  subtopics: readonly SubtopicLike[],
  mcqCountOf: (id: string) => number,
): SubtopicDrillOption[] {
  const out: SubtopicDrillOption[] = [];
  for (const s of subtopics) {
    const mcqCount = mcqCountOf(s.id);
    if (mcqCount > 0) {
      out.push({ id: s.id, name: s.name, mcqCount, label: `${s.name} (${mcqCount})` });
    }
  }
  return out;
}
