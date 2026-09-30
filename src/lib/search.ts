/**
 * Global-search matching — PURE functions only (no DOM, no loader access).
 *
 * The Cmd-K overlay builds a flat list of {@link SearchDoc}s from the loader
 * (subtopics, notes, MCQs) and hands them to {@link searchDocs}, which does the
 * ranking + grouping here so the logic is trivially unit-tested. Matching is
 * case-insensitive and term-based (every whitespace-separated term must appear),
 * ranked by earliest match position then shortest title.
 */

/** Which kind of thing a search document points at. */
export type SearchKind = 'subtopic' | 'note' | 'mcq';

/** One searchable document. */
export interface SearchDoc {
  kind: SearchKind;
  /** Stable id: subtopic id, note id, or MCQ id. */
  id: string;
  /** The text matched against and shown as the result's primary line. */
  title: string;
  /** Owning subtopic id — used to navigate notes/MCQs into the Learn workspace. */
  subtopicId?: string;
  /** Optional secondary line (e.g. the owning subtopic's name). */
  subtitle?: string;
}

/** Search results grouped by kind, each already ranked + capped. */
export interface GroupedResults {
  subtopics: SearchDoc[];
  notes: SearchDoc[];
  mcqs: SearchDoc[];
}

/** A doc paired with its computed relevance score (lower = better). @internal */
interface Scored {
  doc: SearchDoc;
  score: number;
}

/**
 * Score `title` against the query `terms` (all lowercased). Returns `null` when
 * any term is absent (no match). Lower scores rank higher: the earliest term
 * position dominates, with a title-length tiebreaker and a small bonus when the
 * title starts with the first term. @internal
 */
function scoreTitle(title: string, terms: readonly string[]): number | null {
  const hay = title.toLowerCase();
  let positional = 0;
  for (const term of terms) {
    const at = hay.indexOf(term);
    if (at === -1) return null;
    positional += at;
  }
  const startsBonus = terms[0] && hay.startsWith(terms[0]) ? -50 : 0;
  // Length tiebreaker keeps it well below the positional scale.
  return positional + startsBonus + title.length / 1000;
}

/**
 * Rank + group `docs` for `query`. A blank query yields empty groups. Each group
 * is sorted best-first and capped at `limitPerGroup` (default 8).
 */
export function searchDocs(
  query: string,
  docs: readonly SearchDoc[],
  limitPerGroup = 8,
): GroupedResults {
  const empty: GroupedResults = { subtopics: [], notes: [], mcqs: [] };
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return empty;

  const buckets: Record<SearchKind, Scored[]> = { subtopic: [], note: [], mcq: [] };
  for (const doc of docs) {
    const score = scoreTitle(doc.title, terms);
    if (score !== null) buckets[doc.kind].push({ doc, score });
  }

  const rank = (arr: Scored[]): SearchDoc[] =>
    arr
      .sort((a, b) => a.score - b.score)
      .slice(0, limitPerGroup)
      .map((s) => s.doc);

  return {
    subtopics: rank(buckets.subtopic),
    notes: rank(buckets.note),
    mcqs: rank(buckets.mcq),
  };
}

/** Total number of matches across all groups — handy for empty-state checks. */
export function totalResults(results: GroupedResults): number {
  return results.subtopics.length + results.notes.length + results.mcqs.length;
}
