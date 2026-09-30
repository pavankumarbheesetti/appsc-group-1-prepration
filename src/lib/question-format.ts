/**
 * Pure, DOM-free parsers that turn a run-on MCQ *stem* into a STRUCTURED shape
 * the quiz renderer can lay out readably — a statement list or a match-the-
 * following table — while leaving ordinary single-line questions untouched.
 *
 * Two exam-style stems are recognised (everything else is `plain`):
 *
 *  1. STATEMENT-BASED — an intro, an ordered run of numbered statements, and an
 *     optional trailing prompt, e.g.
 *
 *         Consider the following statements …:
 *         1. X   2. Y   3. Z
 *         Which of the statements are correct?
 *
 *     Split into `{ intro, statements[], prompt }`. Robust to `1.` / `1)` /
 *     `(1)` and small roman `i.` / `(i)` markers, and to statements separated by
 *     spaces (no newlines). The trailing prompt is detected by a newline or a
 *     known cue phrase ("Which of the …", "How many …", …).
 *
 *  2. MATCH-THE-FOLLOWING — a `List-I … List-II …` stem with two columns of
 *     items, e.g.
 *
 *         Match the site (List-I) with its find (List-II) …:
 *         List-I: (1) Mohenjo-daro (2) Lothal …
 *         List-II: (i) Great Bath (ii) Dockyard …
 *
 *     or the interleaved form `List-I (Site) List-II (Find) A. Lothal 1. Dock …`.
 *     Split into `{ intro, leftLabel, rightLabel, rows[] }`. When the two lists
 *     cannot be paired confidently the parser degrades to `rows: []` plus the
 *     raw `leftRaw` / `rightRaw` list text so the caller can still show the two
 *     lists on SEPARATE lines rather than a run-on blob.
 *
 * Nothing here touches the DOM; rendering is the caller's job, which keeps the
 * parsers trivially unit-testable.
 */

/** A statement-based stem split into its readable parts. */
export interface StatementQuestion {
  kind: 'statements';
  /** The lead sentence before the first numbered statement. */
  intro: string;
  /** The numbered statements, in order, marker stripped. */
  statements: string[];
  /** The trailing prompt line (e.g. "Which of the statements are correct?"), or null. */
  prompt: string | null;
}

/** One aligned row of a match-the-following table. */
export interface MatchRow {
  /** Left-column cell (List-I item, marker included, e.g. "1. Mohenjo-daro"). */
  left: string;
  /** Right-column cell (List-II item, marker included, e.g. "i. Great Bath"). */
  right: string;
}

/** A match-the-following stem split into two aligned columns. */
export interface MatchQuestion {
  kind: 'match';
  /** The lead sentence before the lists. */
  intro: string;
  /** Header for the left column (e.g. "Site"), defaulting to "List I". */
  leftLabel: string;
  /** Header for the right column (e.g. "Find"), defaulting to "List II". */
  rightLabel: string;
  /** Aligned pairs; empty when the lists could not be paired confidently. */
  rows: MatchRow[];
  /** Raw List-I text used for the degraded (separate-line) fallback. */
  leftRaw: string;
  /** Raw List-II text used for the degraded (separate-line) fallback. */
  rightRaw: string;
}

/** An ordinary single-line question — rendered exactly as today. */
export interface PlainQuestion {
  kind: 'plain';
}

/** The parsed shape of an MCQ stem. */
export type ParsedQuestion = StatementQuestion | MatchQuestion | PlainQuestion;

/* -------------------------------------------------------------------------- */
/* Statement-based parsing                                                     */
/* -------------------------------------------------------------------------- */

/** Small canonical roman numerals (1–10) — the range list markers ever use. */
const SMALL_ROMAN: Record<string, number> = {
  i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10,
};

/**
 * The numeric value of a list marker body: a 1–2 digit number, or a small
 * canonical roman numeral (1–10). Returns null for anything else so ordinary
 * words that happen to precede a `.`/`)` never register as markers. @internal
 */
function markerValue(body: string): number | null {
  if (/^\d{1,2}$/.test(body)) return Number(body);
  return SMALL_ROMAN[body.toLowerCase()] ?? null;
}

/**
 * A list marker: an optional `(`, a digit/roman body, and a `.`/`)` — bounded by
 * whitespace (or string ends) so it never fires mid-word. Group 1 is the
 * leading boundary char, 2 the optional `(`, 3 the body, 4 the closing `.`/`)`.
 * @internal
 */
const STMT_MARKER_RE = /(^|\s)(\(?)(\d{1,2}|[ivxIVX]{1,6})([.)])(?=\s|$)/g;

/** A recognised trailing "prompt" cue that follows the statements. @internal */
const PROMPT_CUE_RE =
  /\b(?:which of the|which one of the|which of these|which (?:is|are)\b|how many of the|select the correct|choose the correct|the correct (?:statements?|option|answer)|of the (?:above|following) statements|are the above)/i;

/** A located, validated marker within a stem. @internal */
interface StmtMarker {
  value: number;
  /** Index of the marker glyph (after any leading whitespace). */
  start: number;
  /** Index just after the marker (where the statement text begins). */
  textStart: number;
}

/**
 * Locate every well-formed list marker in `stem`, in order. A parenthesised
 * marker must close with `)`; a bare marker may close with `.` or `)`. Markers
 * whose body is not a number/small-roman are skipped. @internal
 */
function findStatementMarkers(stem: string): StmtMarker[] {
  const out: StmtMarker[] = [];
  STMT_MARKER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = STMT_MARKER_RE.exec(stem)) !== null) {
    const [full, lead = '', open = '', body = '', close = ''] = m;
    // A `(1)`-style marker must be closed by `)`, not `.`.
    if (open === '(' && close !== ')') continue;
    const value = markerValue(body);
    if (value === null) continue;
    const start = m.index + lead.length;
    out.push({ value, start, textStart: m.index + full.length });
  }
  return out;
}

/**
 * The longest ascending run of markers starting at value 1 (1, 2, 3, …). This
 * is what a genuine statement/enumeration list looks like; a stray marker that
 * breaks the sequence ends the run. @internal
 */
function ascendingRun(markers: readonly StmtMarker[]): StmtMarker[] {
  const first = markers.findIndex((mk) => mk.value === 1);
  if (first === -1) return [];
  const run = [markers[first]!];
  let expect = 2;
  for (let k = first + 1; k < markers.length; k += 1) {
    if (markers[k]!.value === expect) {
      run.push(markers[k]!);
      expect += 1;
    } else {
      break;
    }
  }
  return run;
}

/**
 * Split the last statement's raw text into the statement itself and an optional
 * trailing prompt — preferring a newline break, then a known cue phrase. Returns
 * the trailing prompt as null when neither is present. @internal
 */
function splitLastStatement(raw: string): { statement: string; prompt: string | null } {
  const nl = raw.indexOf('\n');
  if (nl !== -1) {
    const prompt = raw.slice(nl + 1).trim();
    return { statement: raw.slice(0, nl).trim(), prompt: prompt || null };
  }
  const cue = PROMPT_CUE_RE.exec(raw);
  if (cue && cue.index > 0) {
    return { statement: raw.slice(0, cue.index).trim(), prompt: raw.slice(cue.index).trim() || null };
  }
  return { statement: raw.trim(), prompt: null };
}

/**
 * Parse a STATEMENT-BASED stem into `{ intro, statements[], prompt }`, or return
 * null when `stem` is not a numbered statement/enumeration question (fewer than
 * two consecutive markers starting at 1, no lead-in text, or any empty item).
 * Handles 2–5+ statements, `1.`/`1)`/`(1)`/roman markers, and space-separated
 * (no-newline) stems.
 */
export function parseStatementQuestion(stem: string): StatementQuestion | null {
  const text = (stem ?? '').trim();
  if (text === '') return null;

  const run = ascendingRun(findStatementMarkers(text));
  if (run.length < 2) return null;

  const intro = text.slice(0, run[0]!.start).trim();
  if (intro === '') return null; // a genuine statement stem always has a lead-in

  const statements: string[] = [];
  for (let k = 0; k < run.length - 1; k += 1) {
    const seg = text.slice(run[k]!.textStart, run[k + 1]!.start).trim();
    if (seg === '') return null; // an empty item means we mis-parsed
    statements.push(seg);
  }

  const { statement: last, prompt } = splitLastStatement(text.slice(run[run.length - 1]!.textStart));
  if (last === '') return null;
  statements.push(last);

  return { kind: 'statements', intro, statements, prompt };
}

/* -------------------------------------------------------------------------- */
/* Match-the-following parsing                                                 */
/* -------------------------------------------------------------------------- */

/**
 * A genuine `List-I` / `List-II` section HEADER: the label, an optional
 * parenthetical caption, an optional `:`/`.`/`-`, and then — via lookahead — an
 * item marker OR another `List` header. The lookahead is what distinguishes a
 * real header (which introduces items) from an in-sentence mention like
 * "the site (List-I)". Group 1 is the roman numeral (I/II), group 2 the caption.
 * @internal
 */
const LIST_HEADER_RE =
  /List[\s-]*(I{1,2})\b\s*(?:\(([^)]*)\))?\s*[:.-]?\s*(?=\(?[A-Za-z0-9]{1,4}[.)]|List[\s-]*I)/gi;

/** A located List header. @internal */
interface ListHeader {
  numeral: 'I' | 'II';
  caption: string;
  /** Index where the header begins (start of the intro cut for the first one). */
  start: number;
  /** Index where the header's list content begins. */
  contentStart: number;
}

/** An item marker at the START of a list item: optional `(`, body, `.`/`)`. @internal */
const ITEM_MARKER_RE = /(^|\s)(\(?)([A-Za-z0-9]{1,4})([.)])/g;

/** One parsed list item: its marker label and text. @internal */
interface ListItem {
  label: string;
  text: string;
}

/**
 * Extract `{ label, text }` items from a list segment. Each item runs from its
 * marker to the next marker (or the segment end). @internal
 */
function extractItems(seg: string): ListItem[] {
  const marks: { label: string; start: number; textStart: number }[] = [];
  ITEM_MARKER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ITEM_MARKER_RE.exec(seg)) !== null) {
    const [full, lead = '', open = '', body = '', close = ''] = m;
    if (open === '(' && close !== ')') continue;
    marks.push({ label: body, start: m.index + lead.length, textStart: m.index + full.length });
  }
  const items: ListItem[] = [];
  for (let i = 0; i < marks.length; i += 1) {
    const end = i + 1 < marks.length ? marks[i + 1]!.start : seg.length;
    const text = seg.slice(marks[i]!.textStart, end).trim();
    if (text !== '') items.push({ label: marks[i]!.label, text });
  }
  return items;
}

/** Compose a display cell from an item, keeping its marker (e.g. "1. Lothal"). @internal */
function cell(item: ListItem): string {
  return `${item.label}. ${item.text}`;
}

/** Words that are never useful as a column caption. @internal */
const CAPTION_STOPWORDS = new Set([
  'match', 'consider', 'the', 'a', 'an', 'its', 'their', 'his', 'her',
  'with', 'and', 'of', 'to', 'choose', 'correct', 'answer', 'following',
]);

/**
 * Derive a column caption from an in-sentence `… foo (List-I)` mention: take up
 * to the last two meaningful (non-stopword) words before the parenthetical, and
 * capitalise. Returns null when nothing meaningful precedes it. @internal
 */
function captionFromIntro(intro: string, numeral: 'I' | 'II'): string | null {
  const re =
    numeral === 'I'
      ? /([A-Za-z][A-Za-z /-]*?)\s*\(\s*List[\s-]*I\s*\)/i
      : /([A-Za-z][A-Za-z /-]*?)\s*\(\s*List[\s-]*II\s*\)/i;
  const m = re.exec(intro);
  if (!m || !m[1]) return null;
  const words = m[1]
    .trim()
    .split(/\s+/)
    .filter((w) => !CAPTION_STOPWORDS.has(w.toLowerCase()));
  if (words.length === 0) return null;
  const phrase = words.slice(-2).join(' ');
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

/** Resolve a column header: explicit caption → intro caption → default. @internal */
function resolveLabel(explicit: string, intro: string, numeral: 'I' | 'II'): string {
  const cap = explicit.trim() || captionFromIntro(intro, numeral);
  if (cap && cap.trim() !== '') {
    return cap.trim().charAt(0).toUpperCase() + cap.trim().slice(1);
  }
  return numeral === 'I' ? 'List I' : 'List II';
}

/**
 * Parse a MATCH-THE-FOLLOWING stem into `{ intro, leftLabel, rightLabel, rows }`,
 * or return null when `stem` is not a `List-I`/`List-II` question. Handles both
 * the separated form (List-I items on one line, List-II on the next) and the
 * interleaved form (`A. x 1. y B. …`). When the columns cannot be paired
 * confidently it still returns a MatchQuestion with `rows: []` and the raw list
 * text in `leftRaw`/`rightRaw`, so the caller can render the two lists on
 * separate lines (never a run-on blob).
 */
export function parseMatchQuestion(stem: string): MatchQuestion | null {
  const text = (stem ?? '').trim();
  if (!/list[\s-]*i/i.test(text)) return null;

  LIST_HEADER_RE.lastIndex = 0;
  const heads: ListHeader[] = [];
  let m: RegExpExecArray | null;
  while ((m = LIST_HEADER_RE.exec(text)) !== null) {
    heads.push({
      numeral: (m[1] ?? '').toUpperCase() === 'II' ? 'II' : 'I',
      caption: (m[2] ?? '').trim(),
      start: m.index,
      contentStart: LIST_HEADER_RE.lastIndex,
    });
  }

  const headI = heads.find((h) => h.numeral === 'I');
  const headII = heads.find((h) => h.numeral === 'II');
  if (!headI || !headII) return null;

  // Order the two headers as they appear so the segments slice cleanly.
  const [first, second] = headI.start <= headII.start ? [headI, headII] : [headII, headI];
  const firstSeg = text.slice(first.contentStart, second.start).trim();
  const secondSeg = text.slice(second.contentStart).trim();

  const intro = text.slice(0, first.start).trim();
  const leftLabel = resolveLabel(headI.caption, intro, 'I');
  const rightLabel = resolveLabel(headII.caption, intro, 'II');

  // Map segments back to List-I / List-II regardless of appearance order.
  const leftRaw = (first === headI ? firstSeg : secondSeg).trim();
  const rightRaw = (first === headI ? secondSeg : firstSeg).trim();

  const base = { kind: 'match' as const, intro, leftLabel, rightLabel, leftRaw, rightRaw };

  const firstItems = extractItems(firstSeg);
  const secondItems = extractItems(secondSeg);

  let leftItems: ListItem[];
  let rightItems: ListItem[];
  if (firstItems.length >= 2 && secondItems.length >= 2) {
    // Separated form: each segment already holds one whole list.
    leftItems = first === headI ? firstItems : secondItems;
    rightItems = first === headI ? secondItems : firstItems;
  } else {
    // Interleaved form: all items live in the trailing segment, alternating
    // left, right, left, right …
    const flat = secondItems.length >= firstItems.length ? secondItems : firstItems;
    leftItems = flat.filter((_, i) => i % 2 === 0);
    rightItems = flat.filter((_, i) => i % 2 === 1);
  }

  const n = Math.min(leftItems.length, rightItems.length);
  const rows: MatchRow[] = [];
  for (let i = 0; i < n; i += 1) {
    rows.push({ left: cell(leftItems[i]!), right: cell(rightItems[i]!) });
  }

  // Confident only when we paired at least two rows; otherwise degrade to the
  // separate-line fallback (rows: []).
  return rows.length >= 2 ? { ...base, rows } : { ...base, rows: [] };
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Classify an MCQ stem. Match-the-following is tried FIRST (its `(1)`/`(i)` list
 * markers would otherwise look like statement markers); then statement-based;
 * otherwise the stem is `plain` and rendered exactly as today.
 */
export function parseQuestion(stem: string): ParsedQuestion {
  const match = parseMatchQuestion(stem);
  if (match) return match;
  const statements = parseStatementQuestion(stem);
  if (statements) return statements;
  return { kind: 'plain' };
}
