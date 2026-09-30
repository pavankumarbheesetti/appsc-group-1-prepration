/**
 * Pure splitter that separates an MCQ explanation into its premium parts:
 *
 *  - a free-text **rationale** (why the answer is right);
 *  - an optional muted **distractor** discrimination line (why the other
 *    options are wrong — e.g. `Others: Lothal — dockyard · Harappa — first
 *    excavated`), lifted so it can be rendered quietly under the rationale;
 *  - an optional per-distractor **whyNot** section (headed `**Why not the
 *    others**`, then `- <option> — <reason>` list rows), extracted as
 *    `{option, reason}` pairs and rendered as an elegant block between the
 *    rationale and the key facts;
 *  - an optional structured **key-facts** block, classified as a `table`,
 *    a `kv` (label → value definition list) or a plain `list`, so the caller
 *    can render each as an elegant panel; and
 *  - any trailing inline **source** citation, extracted ONCE so it is never
 *    duplicated when the item also carries a structured `source` field.
 *
 * Nothing here touches the DOM; rendering the parts (via the vetted markdown
 * renderer) is the caller's job. This keeps the parser trivially unit-testable.
 *
 * The key-facts split point is chosen by the first convention that matches:
 *  1. an explicit `**Key facts …**` / `## Key facts …` marker line (its trailing
 *     caption, e.g. `— Dholavira`, is preserved as {@link KeyFacts.caption});
 *  2. a `---` / `***` horizontal-rule line;
 *  3. the first GFM pipe TABLE (a lone bold/heading line immediately above the
 *     table is adopted as the panel caption rather than left orphaned).
 * If none match, the whole (source-stripped) text is the rationale.
 */

/** A single `label → value` fact pair (raw markdown; may contain `**bold**`). */
export interface KeyFactPair {
  label: string;
  value: string;
}

/**
 * A single "why not the others" row: a distractor `option` paired with a
 * one-line `reason` it is wrong. Both are raw markdown (may contain `**bold**`)
 * so the caller renders them with the vetted inline renderer. `reason` may be
 * an empty string when an authored row carries no explicit reason.
 */
export interface WhyNotRow {
  option: string;
  reason: string;
}

/** How the key-facts block should be rendered. */
export type KeyFactsKind = 'table' | 'kv' | 'list';

/** The structured key-facts block lifted out of an explanation. */
export interface KeyFacts {
  /** Chosen rendering: refined table, label→value grid, or tidy list. */
  kind: KeyFactsKind;
  /** The raw markdown of the block (used to render `table` and `list`). */
  markdown: string;
  /** Parsed pairs, populated only when `kind === 'kv'`. */
  pairs: readonly KeyFactPair[];
  /** Optional caption from the marker / preceding heading (e.g. `Dholavira`). */
  caption: string | null;
}

/** The parsed parts of an MCQ explanation. */
export interface SplitExplanation {
  /** The free-text rationale (may be empty). */
  rationale: string;
  /** The optional distractor-discrimination line (label stripped), else null. */
  distractor: string | null;
  /**
   * Per-distractor "why not the others" rows lifted from an optional
   * `**Why not the others**` section. Empty when the section is absent.
   */
  whyNot: readonly WhyNotRow[];
  /** The optional structured key-facts block, or null. */
  keyFacts: KeyFacts | null;
  /** A trailing inline source citation, extracted for de-duplication, or null. */
  source: string | null;
}

/**
 * A `**Key facts …**` bold marker at the START of a line. Group 1 is the text
 * INSIDE the bold after "key facts" (an optional `— caption` and/or a trailing
 * colon); group 2 is any same-line trailing text AFTER the closing `**` (with
 * an optional colon), which authors sometimes use as an inline heading, e.g.
 * `**Key facts** Chandragupta founded…` or `**Key facts — Ashokan edicts:** …`.
 * Anchored to line start (after trim) to avoid matching mid-sentence bold.
 */
const KEY_FACTS_BOLD = /^\s*\*\*\s*key facts\b([^*]*)\*\*\s*:?\s*(.*)$/i;

/** A `## Key facts …` heading line; group 1 is the trailing caption text. */
const KEY_FACTS_HEADING = /^\s*#{2,6}\s+key facts\b(.*)$/i;

/**
 * A `**Why not the others**` bold marker at the START of a line; group 1 is any
 * same-line trailing text after the closing `**` (with an optional colon), so
 * `**Why not the others** - X — y` and `**Why not the others:** …` both match.
 * Anchored to line start (after trim) to avoid matching mid-sentence bold.
 */
const WHY_NOT_BOLD = /^\s*\*\*\s*why not the others\b[^*]*\*\*\s*:?\s*(.*)$/i;

/** A `## Why not the others …` heading line; group 1 is any trailing text. */
const WHY_NOT_HEADING = /^\s*#{2,6}\s+why not the others\b(.*)$/i;

/** A parsed "Key facts" marker: an optional caption + any same-line trailing text. */
interface KeyFactsMarker {
  caption: string | null;
  trailing: string;
}

/**
 * Normalise the raw text captured after "Key facts" into a panel caption:
 * drop a single leading separator (`—`/`–`/`-`/`:`/`·`) and any trailing colon,
 * then trim. Returns null when nothing meaningful remains. @internal
 */
function normalizeCaption(raw: string): string | null {
  const cap = raw
    .replace(/^\s*[—–\-:·]?\s*/, '')
    .replace(/\s*:\s*$/, '')
    .trim();
  return cap === '' ? null : cap;
}

/**
 * Recognise a "Key facts" section marker at the START of `line` — either the
 * `**Key facts …**` bold form or a `## Key facts …` heading — tolerating an
 * inline heading with same-line trailing text and an optional colon. Returns
 * the caption and the trailing text (empty when none), or null if not a
 * marker. @internal
 */
function matchKeyFactsMarker(line: string): KeyFactsMarker | null {
  const bold = KEY_FACTS_BOLD.exec(line);
  if (bold) {
    return { caption: normalizeCaption(bold[1] ?? ''), trailing: (bold[2] ?? '').trim() };
  }
  const heading = KEY_FACTS_HEADING.exec(line);
  if (heading) {
    return { caption: normalizeCaption(heading[1] ?? ''), trailing: '' };
  }
  return null;
}

/**
 * Recognise a "Why not the others" section marker at the START of `line` —
 * either the `**Why not the others**` bold form or a `## Why not the others`
 * heading — tolerating an inline heading with same-line trailing text and an
 * optional colon. Returns the trailing text (empty when none), or null if the
 * line is not a marker. @internal
 */
function matchWhyNotMarker(line: string): string | null {
  const bold = WHY_NOT_BOLD.exec(line);
  if (bold) return (bold[1] ?? '').trim();
  const heading = WHY_NOT_HEADING.exec(line);
  if (heading) return (heading[1] ?? '').trim();
  return null;
}

/** A horizontal-rule line (`---`, `***`, or longer). */
const HR_LINE = /^\s*(?:-{3,}|\*{3,})\s*$/;

/** A trailing inline "Source: …" citation line (optionally italic/bold). */
const SOURCE_LINE = /^\s*[*_]{0,2}\s*sources?\s*[:\-—]\s*(.+?)\s*[*_]{0,2}\s*$/i;

/** A distractor-discrimination line: `Others: …` / `Distractors: …`. */
const DISTRACTOR_LINE =
  /^\s*\*{0,2}\s*(?:others?|other options|distractors?)\s*\*{0,2}\s*[:\-—]\s*(.+)$/i;

/** A line that is entirely one `**bold**` run (a candidate panel caption). */
const BOLD_ONLY_LINE = /^\s*\*\*(.+?)\*\*\s*$/;

/** A markdown heading line, capturing its text (a candidate panel caption). */
const HEADING_LINE = /^\s*#{2,6}\s+(.+?)\s*$/;

/** A GFM table separator row, e.g. `|---|:--:|` (must contain a dash). */
function isTableSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{1,}:?\s*(?:\|\s*:?-{1,}:?\s*)*\|?\s*$/.test(line) && line.includes('-');
}

/** Index of the header row of the first GFM pipe table, or -1 if none. */
function findTableStart(lines: readonly string[]): number {
  for (let i = 0; i + 1 < lines.length; i += 1) {
    const header = lines[i];
    const sep = lines[i + 1];
    if (header !== undefined && sep !== undefined && header.includes('|') && isTableSeparator(sep)) {
      return i;
    }
  }
  return -1;
}

/** Strip surrounding `**`/`*` emphasis markers from a short label. @internal */
function stripEmphasis(s: string): string {
  return s.replace(/^\s*\*{1,2}/, '').replace(/\*{1,2}\s*$/, '').trim();
}

/**
 * Pull a trailing inline "Source: …" line off the END of `md`, returning the
 * remaining body and the extracted citation (label stripped). Trailing blank
 * lines and a dangling horizontal rule left behind are also trimmed so the
 * rendered block never ends on an orphaned divider. @internal
 */
function extractSource(md: string): { body: string; source: string | null } {
  const lines = md.split('\n');
  // Walk back over trailing blank lines to the last content line.
  let end = lines.length;
  while (end > 0 && (lines[end - 1] ?? '').trim() === '') end -= 1;
  if (end === 0) return { body: md, source: null };
  const last = lines[end - 1] ?? '';
  const m = SOURCE_LINE.exec(last);
  if (!m) return { body: md, source: null };
  let cut = end - 1;
  // Also drop a divider that immediately precedes the source line.
  while (cut > 0 && (lines[cut - 1] ?? '').trim() === '') cut -= 1;
  if (cut > 0 && HR_LINE.test(lines[cut - 1] ?? '')) cut -= 1;
  const body = lines.slice(0, cut).join('\n').trim();
  return { body, source: (m[1] ?? '').trim() || null };
}

/**
 * Lift a single distractor-discrimination line out of `md`, returning the
 * remaining text and the line's content (its `Others:`/`Distractors:` label
 * stripped). Only the first such line is lifted. @internal
 */
function extractDistractor(md: string): { body: string; distractor: string | null } {
  const lines = md.split('\n');
  const idx = lines.findIndex((l) => DISTRACTOR_LINE.test(l));
  if (idx === -1) return { body: md, distractor: null };
  const m = DISTRACTOR_LINE.exec(lines[idx] ?? '');
  // A `**Distractors:**` label leaves a stray leading `**` on the content.
  const distractor = (m?.[1] ?? '').replace(/^\s*\*{1,2}\s*/, '').trim() || null;
  lines.splice(idx, 1);
  return { body: lines.join('\n').trim(), distractor };
}

/**
 * The row separator between a distractor option and its reason: an em/en dash
 * (with optional surrounding space) or a SPACE-padded hyphen. Requiring spaces
 * around the plain hyphen means hyphenated option text (e.g. `Indo-Greek`) is
 * never split. @internal
 */
const WHY_NOT_SEP = /\s*[—–]\s*|\s+-\s+/;

/**
 * Parse one `- <option> — <reason>` list item into a {@link WhyNotRow}. The
 * option is everything before the first separator; the reason is the rest (may
 * be empty when the row carries no separator). Returns null for an empty
 * option. @internal
 */
function parseWhyNotItem(text: string): WhyNotRow | null {
  const m = WHY_NOT_SEP.exec(text);
  if (m) {
    const option = text.slice(0, m.index).trim();
    const reason = text.slice(m.index + m[0].length).trim();
    return option === '' ? null : { option, reason };
  }
  const option = text.trim();
  return option === '' ? null : { option, reason: '' };
}

/**
 * Lift the optional `**Why not the others**` section out of `md`, returning the
 * remaining text and the parsed option→reason rows. The section is the marker
 * line followed by consecutive markdown list items (`- …` / `* …`); the marker
 * and consumed list are removed from the body so they never duplicate the
 * rationale. Only the first such section is lifted. @internal
 */
function extractWhyNot(md: string): { body: string; whyNot: WhyNotRow[] } {
  const lines = md.split('\n');
  let idx = -1;
  let trailing = '';
  for (let i = 0; i < lines.length; i += 1) {
    const t = matchWhyNotMarker(lines[i] ?? '');
    if (t !== null) {
      idx = i;
      trailing = t;
      break;
    }
  }
  if (idx === -1) return { body: md, whyNot: [] };

  const rows: WhyNotRow[] = [];
  // Fold same-line trailing text (inline-heading form) in as the FIRST row, but
  // only when it actually looks like a row — a `- `/`* ` bullet or an
  // option→reason separator. A decorative aside (e.g. a parenthetical note with
  // no separator) is not a row and is dropped rather than polluting the list.
  if (trailing !== '') {
    const hadBullet = /^\s*[-*]\s+/.test(trailing);
    const rowText = trailing.replace(/^\s*[-*]\s+/, '');
    if (hadBullet || WHY_NOT_SEP.test(rowText)) {
      const row = parseWhyNotItem(rowText);
      if (row) rows.push(row);
    }
  }

  let end = idx + 1;
  // Tolerate blank lines between the marker and the list.
  while (end < lines.length && (lines[end] ?? '').trim() === '') end += 1;
  while (end < lines.length && /^\s*[-*]\s+/.test(lines[end] ?? '')) {
    const row = parseWhyNotItem((lines[end] ?? '').replace(/^\s*[-*]\s+/, ''));
    if (row) rows.push(row);
    end += 1;
  }

  lines.splice(idx, end - idx);
  return { body: lines.join('\n').trim(), whyNot: rows };
}

/**
 * Classify a key-facts markdown block and, for `kv` blocks, parse its pairs.
 *
 * A block is `table` when it contains a GFM pipe table; `kv` when EVERY list
 * item is a `- Label: value` pair with a short label; otherwise `list`.
 * @internal
 */
function classifyKeyFacts(markdown: string, caption: string | null): KeyFacts {
  const lines = markdown.split('\n');

  if (findTableStart(lines) !== -1) {
    return { kind: 'table', markdown, pairs: [], caption };
  }

  const itemLines = lines.filter((l) => /^\s*[-*]\s+/.test(l));
  if (itemLines.length > 0) {
    const pairs: KeyFactPair[] = [];
    let allKv = true;
    for (const raw of itemLines) {
      const text = raw.replace(/^\s*[-*]\s+/, '');
      const colon = text.indexOf(':');
      if (colon <= 0) {
        allKv = false;
        break;
      }
      const label = stripEmphasis(text.slice(0, colon));
      const value = text.slice(colon + 1).trim();
      // A key→value pair needs a short, single-line label and a non-empty value.
      if (label === '' || value === '' || label.length > 40 || label.includes('|')) {
        allKv = false;
        break;
      }
      pairs.push({ label, value });
    }
    if (allKv && pairs.length === itemLines.length) {
      return { kind: 'kv', markdown, pairs, caption };
    }
  }

  return { kind: 'list', markdown, pairs: [], caption };
}

/**
 * Choose the key-facts split point in `md` (already source-stripped) and return
 * the rationale region plus the classified key-facts block. @internal
 */
function splitKeyFacts(md: string): { rationale: string; keyFacts: KeyFacts | null } {
  const lines = md.split('\n');
  const clean = (from: number, to?: number): string => lines.slice(from, to).join('\n').trim();

  // 1) explicit "Key facts" marker (the marker line itself is dropped). Any
  //    same-line trailing text (inline-heading form) is folded into the block
  //    as its first line; a `— caption` inside the bold is kept as the caption.
  let markerIdx = -1;
  let marker: KeyFactsMarker | null = null;
  for (let i = 0; i < lines.length; i += 1) {
    const m = matchKeyFactsMarker(lines[i] ?? '');
    if (m) {
      markerIdx = i;
      marker = m;
      break;
    }
  }
  if (markerIdx !== -1 && marker) {
    const rest = clean(markerIdx + 1);
    const block =
      marker.trailing !== '' ? (rest !== '' ? `${marker.trailing}\n${rest}` : marker.trailing) : rest;
    return {
      rationale: clean(0, markerIdx),
      keyFacts: block === '' ? null : classifyKeyFacts(block, marker.caption),
    };
  }

  // 2) horizontal-rule marker (the rule line itself is dropped).
  const hrIdx = lines.findIndex((l) => HR_LINE.test(l));
  if (hrIdx !== -1) {
    const block = clean(hrIdx + 1);
    return {
      rationale: clean(0, hrIdx),
      keyFacts: block === '' ? null : classifyKeyFacts(block, null),
    };
  }

  // 3) first GFM table → the table onward is the key-facts block. A lone
  //    bold/heading line just above the table becomes the panel caption.
  const tableIdx = findTableStart(lines);
  if (tableIdx !== -1) {
    let start = tableIdx;
    let caption: string | null = null;
    let capIdx = tableIdx - 1;
    while (capIdx >= 0 && (lines[capIdx] ?? '').trim() === '') capIdx -= 1;
    const capLine = lines[capIdx] ?? '';
    const capMatch = BOLD_ONLY_LINE.exec(capLine) ?? HEADING_LINE.exec(capLine);
    if (capMatch) {
      caption = (capMatch[1] ?? '').trim() || null;
      start = capIdx; // drop the adopted caption line from the rationale
    }
    const block = clean(tableIdx);
    return {
      rationale: clean(0, start),
      keyFacts: block === '' ? null : classifyKeyFacts(block, caption),
    };
  }

  return { rationale: md, keyFacts: null };
}

/**
 * Split `raw` into rationale + optional distractor + optional key-facts, and
 * extract a trailing inline source citation for de-duplication (see module
 * docs). The extracted `source` lets the caller show a citation ONCE, preferring
 * a structured `source` field and falling back to this inline one.
 */
export function splitExplanation(raw: string): SplitExplanation {
  const md = (raw ?? '').trim();
  if (md === '') {
    return { rationale: '', distractor: null, whyNot: [], keyFacts: null, source: null };
  }

  // 1) Strip a trailing inline source citation from the end of the body.
  const { body, source } = extractSource(md);
  // 2) Lift the `**Why not the others**` section from ANYWHERE in the body
  //    (before OR after the key-facts block) so it can never be swallowed by a
  //    later key-facts split. The marker and its list rows are removed here.
  const { body: afterWhyNot, whyNot } = extractWhyNot(body);
  // 3) Only now split key-facts off the remaining body, so its block can no
  //    longer contain the why-not rows.
  const { rationale: region, keyFacts } = splitKeyFacts(afterWhyNot);
  // 4) The remaining leading prose is the rationale (an optional distractor
  //    discrimination line is lifted out of it).
  const { body: rationale, distractor } = extractDistractor(region);

  return { rationale: rationale.trim(), distractor, whyNot, keyFacts, source };
}
