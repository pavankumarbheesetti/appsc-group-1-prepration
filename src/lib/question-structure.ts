/**
 * Pure, DOM-free EXTRACTION of structured MCQ stem fields — the shared engine
 * behind the one-off migration (`scripts/migrate-question-format.ts`), the
 * alignment validator (`src/content/validate.ts`, VALIDATE_ALIGN=1) and the DOM
 * render audit test.
 *
 * Unlike the lenient display-time parser in `./question-format.ts` (which only
 * has the stem string), these extractors also read the OPTIONS: a match
 * question's option codes (`A-3, B-1, …`) tell us exactly which List-I / List-II
 * keys must exist, so the stem is scanned for those keys IN SEQUENCE. That is
 * what makes "C. P. Radhakrishnan" or "ECLGS 5.0" safe — `C.`/`P.`/`5.` are never
 * accepted as markers because they are not the next expected key.
 *
 * Every extractor returns either a confident result or a `reason` string so the
 * migration can report what it refused to touch. Nothing here mutates input.
 */

/** One keyed list entry of a match question. */
export interface MatchEntry {
  key: string;
  text: string;
}

/** The structured `match` field stored on an MCQ item. */
export interface MatchField {
  leftTitle: string;
  rightTitle: string;
  left: MatchEntry[];
  right: MatchEntry[];
}

/** The stem kinds this module can structure. */
export type StructuredKind = 'match' | 'statements' | 'ar';

/** Canonical left keys (List-I) and right keys (List-II). */
export const LEFT_KEYS = ['A', 'B', 'C', 'D', 'E', 'F'] as const;
export const RIGHT_KEYS = ['1', '2', '3', '4', '5', '6'] as const;

const ROMAN = ['i', 'ii', 'iii', 'iv', 'v', 'vi'];

/* -------------------------------------------------------------------------- */
/* Classification                                                             */
/* -------------------------------------------------------------------------- */

/** A stem line that is a List-I / List-II header (optionally with inline items). */
const LIST_HEADER_LINE_RE = /^\s*List[\s-]*(I{1,2}|1|2)\b\s*(?:\(([^)]*)\))?\s*[:.\-–]?\s*/i;

/** Does the stem look like a match-the-following question? */
export function looksLikeMatch(stem: string): boolean {
  return /\bList[\s-]*I\b/i.test(stem) && /\bList[\s-]*(II|2)\b/i.test(stem);
}

/** Does the stem look like an Assertion–Reason question? */
export function looksLikeAR(stem: string): boolean {
  return /Assertion\s*\(A\)/i.test(stem) && /Reason\s*\(R\)/i.test(stem);
}

/** A line-start arabic statement marker: `1.`, `1)` or `(1)` followed by a space. */
const STMT_LINE_RE = /^\s*\(?(\d{1,2})[.)]\s+/;

/**
 * Does the stem look like a numbered statement/list question (a line-start
 * `1.` followed later by a line-start `2.`)? Match / A-R stems are excluded.
 */
export function looksLikeStatements(stem: string): boolean {
  if (looksLikeMatch(stem) || looksLikeAR(stem)) return false;
  const lines = stem.split('\n');
  let saw1 = false;
  for (const line of lines.slice(1)) {
    const m = STMT_LINE_RE.exec(line);
    if (!m) continue;
    if (m[1] === '1') saw1 = true;
    else if (m[1] === '2' && saw1) return true;
  }
  return false;
}

/** Which structured kind (if any) a stem appears to be. */
export function classifyStem(stem: string): StructuredKind | null {
  if (looksLikeAR(stem)) return 'ar';
  if (looksLikeMatch(stem)) return 'match';
  if (looksLikeStatements(stem)) return 'statements';
  return null;
}

/* -------------------------------------------------------------------------- */
/* Option-code parsing                                                        */
/* -------------------------------------------------------------------------- */

/** One `left-right` pair parsed from a match option, e.g. `A-3`. */
export interface OptionPair {
  left: string;
  right: string;
}

const PAIR_RE = /(?:^|[\s,;(])([A-Fa-f]|\d{1,2})\s*[-–—→:]\s*(\d{1,2}|[ivx]{1,4}|[A-Fa-f])(?=$|[\s,;)])/g;

/**
 * Parse every option of a match question into `left-right` pairs. Returns null
 * when ANY option is not a code list of at least two pairs (e.g. the options
 * spell out the matches in words).
 */
export function parseMatchOptions(options: readonly string[]): OptionPair[][] | null {
  const out: OptionPair[][] = [];
  for (const opt of options) {
    const pairs: OptionPair[] = [];
    PAIR_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = PAIR_RE.exec(opt)) !== null) pairs.push({ left: m[1]!, right: m[2]! });
    // Every character of the option must be accounted for by the pairs.
    const residue = opt.replace(PAIR_RE, '').replace(/[\s,;()]/g, '');
    if (pairs.length < 2 || residue !== '') return null;
    out.push(pairs);
  }
  return out;
}

/** Key style of one list column. */
type KeyStyle = 'letter' | 'digit' | 'roman';

function styleOf(keys: readonly string[]): KeyStyle | null {
  if (keys.every((k) => /^[A-Fa-f]$/.test(k))) return 'letter';
  if (keys.every((k) => /^\d{1,2}$/.test(k))) return 'digit';
  if (keys.every((k) => ROMAN.includes(k.toLowerCase()))) return 'roman';
  return null;
}

/** The ordinal (0-based) of a key in its style's sequence. */
function ordinal(key: string, style: KeyStyle): number {
  if (style === 'letter') return key.toUpperCase().charCodeAt(0) - 65;
  if (style === 'digit') return Number(key) - 1;
  return ROMAN.indexOf(key.toLowerCase());
}

/** The key at `ordinal` in a style's sequence. */
function keyAt(n: number, style: KeyStyle): string {
  if (style === 'letter') return String.fromCharCode(65 + n);
  if (style === 'digit') return String(n + 1);
  return ROMAN[n] ?? '';
}

/* -------------------------------------------------------------------------- */
/* Statement-number references in options                                     */
/* -------------------------------------------------------------------------- */

const CODE_WORDS_RE =
  /\b(?:only|both|neither|nor|and|all|none|of|the|above|statements?|pairs?|are|is|correct|incorrect|given)\b/gi;

/**
 * Is `opt` a pure statement CODE (e.g. "1 and 3 only", "Both 1 and 2",
 * "2-1-3-4")? Only such options reference statement numbers.
 */
export function isStatementCode(opt: string): boolean {
  const rest = opt.replace(CODE_WORDS_RE, '').replace(/[\s,\-–—→&()]/g, '');
  return /^\d+$/.test(rest);
}

/** Statement numbers referenced by a single code option ([] when not a code). */
export function statementNumbersIn(opt: string): number[] {
  if (!isStatementCode(opt)) return [];
  return (opt.match(/\d{1,2}/g) ?? []).map(Number);
}

/** The highest statement number referenced by any code option (0 when none). */
export function maxStatementRef(options: readonly string[]): number {
  let max = 0;
  for (const o of options) for (const n of statementNumbersIn(o)) max = Math.max(max, n);
  return max;
}

/* -------------------------------------------------------------------------- */
/* Lead-in helpers                                                            */
/* -------------------------------------------------------------------------- */

/** Generic trailing prompts that add nothing to a match lead-in already asking for the answer. */
const GENERIC_PROMPT_RE = /^(?:select|choose|pick|mark)\s+the\s+correct\s+(?:answer|code|option|match(?:ing)?)(?:\s+(?:using|from)\s+the\s+codes?\s+given\s+below)?\s*[:.]?$|^codes?\s*:?$/i;

/** Join a lead-in and an optional closing prompt as `lead\nprompt` (dedup generic prompts). */
function composeQuestion(lead: string, prompt: string): string {
  const l = lead.trim();
  const p = prompt.trim();
  if (p === '') return l;
  if (GENERIC_PROMPT_RE.test(p) && /\b(?:select|choose)\b.*\bcorrect\b/i.test(l)) return l;
  return l === '' ? p : `${l}\n${p}`;
}

/* -------------------------------------------------------------------------- */
/* Match extraction                                                           */
/* -------------------------------------------------------------------------- */

/** Outcome of a structured extraction. */
export type Extraction<T> =
  | { ok: true; value: T; question: string; options?: string[]; notes: string[] }
  | { ok: false; reason: string };

/** Derive a column title: header caption → intro caption → bare `List-I`. */
function columnTitle(numeral: 'I' | 'II', headerCaption: string, intro: string): string {
  const base = numeral === 'I' ? 'List-I' : 'List-II';
  const cap = headerCaption.trim() || introCaption(intro, numeral);
  return cap ? `${base} (${cap})` : base;
}

const CAPTION_STOP = new Set([
  'match', 'consider', 'the', 'a', 'an', 'its', 'their', 'his', 'her', 'with', 'and', 'of', 'to',
  'choose', 'correct', 'answer', 'following', 'given', 'in', 'from',
]);

/** Caption from the intro: `List-I (X)`, `the X (List-I)` or `the X in List-I`. */
function introCaption(intro: string, numeral: 'I' | 'II'): string {
  const n = numeral === 'I' ? 'I(?!I)' : 'II';
  const direct = new RegExp(`List[\\s-]*${n}\\s*\\(([^)]+)\\)`, 'i').exec(intro);
  if (direct?.[1]) return direct[1].trim();
  const before = new RegExp(`([A-Za-z][A-Za-z /'-]*?)\\s*(?:\\(\\s*List[\\s-]*${n}\\s*\\)|\\bin\\s+List[\\s-]*${n}\\b)`, 'i').exec(intro);
  if (!before?.[1]) return '';
  // Keep the noun phrase after the last determiner/clause word ("the", "its", "with" …).
  const words = before[1].trim().split(/\s+/);
  let cut = -1;
  words.forEach((w, i) => {
    if (CAPTION_STOP.has(w.toLowerCase())) cut = i;
  });
  const phrase = words.slice(cut + 1).join(' ');
  return phrase ? phrase.charAt(0).toUpperCase() + phrase.slice(1) : '';
}

/** Escape a string for a RegExp. */
function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Find the next marker for `key` in `line` at or after `from`: `K.`, `K)` or
 * `(K)` at line start or after whitespace, followed by whitespace. Returns the
 * marker start and the index where its text begins.
 */
function findMarker(line: string, key: string, from: number): { start: number; textStart: number } | null {
  const re = new RegExp(`(^|\\s)(\\(${esc(key)}\\)|${esc(key)}[.)])(?=\\s)`, 'g');
  re.lastIndex = from;
  const m = re.exec(line);
  if (!m) return null;
  const start = m.index + (m[1] ?? '').length;
  return { start, textStart: start + (m[2] ?? '').length };
}

/**
 * Rewrite a two-column GFM pipe table embedded in a match stem
 * (`| List I (X) | List II (Y) |`, `|---|---|`, `| A. a | 1. b |` …) into the
 * plain header + one-item-per-line form the line scanner understands. Stems
 * without such a table are returned unchanged.
 */
function unpipeMatchTable(stem: string): string {
  const lines = stem.split('\n');
  const rowIdx = lines.findIndex((l) => /^\s*\|.*\|\s*$/.test(l));
  if (rowIdx < 0) return stem;
  const cells = (l: string): string[] =>
    l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
  const left: string[] = [];
  const right: string[] = [];
  let header: string[] | null = null;
  const before = lines.slice(0, rowIdx);
  const after: string[] = [];
  for (const l of lines.slice(rowIdx)) {
    if (!/^\s*\|.*\|\s*$/.test(l)) {
      after.push(l);
      continue;
    }
    if (/^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(l)) continue;
    const c = cells(l);
    if (c.length !== 2) return stem;
    if (!header) header = c;
    else {
      if (c[0]) left.push(c[0]);
      if (c[1]) right.push(c[1]);
    }
  }
  if (!header) return stem;
  return [...before, header[0]!, ...left, header[1]!, ...right, ...after].join('\n');
}

/**
 * Extract a structured `match` field from a List-I / List-II stem. Keys are
 * normalised to `A..F` (left) and `1..6` (right); when the stem used `1..4` /
 * `i..iv` the options are rewritten accordingly (meaning preserved).
 */
export function extractMatch(stem: string, options: readonly string[]): Extraction<MatchField> {
  const parsedOpts = parseMatchOptions(options);
  if (!parsedOpts) {
    // Options like "A-Irish, B-Soviet …" carry the List-II answers as words:
    // the stem's List-II is missing, so the item is incomplete, not just odd.
    const wordy = options.every((o) => /^[A-F]\s*[-–]\s*[A-Za-z]{2,}/.test(o.trim()));
    if (wordy && !/\bList[\s-]*(II|2)\b\s*(\([^)]*\))?\s*[:\n]/i.test(stem.split('\n').slice(1).join('\n'))) {
      return { ok: false, reason: 'INCOMPLETE: no List-II in the stem; options spell the matches in words (rewrite as A-1 codes)' };
    }
    return { ok: false, reason: 'options are not A-1 style match codes' };
  }
  const leftRef = [...new Set(parsedOpts.flat().map((p) => p.left))];
  const rightRef = [...new Set(parsedOpts.flat().map((p) => p.right))];
  const lStyle = styleOf(leftRef);
  const rStyle = styleOf(rightRef);
  if (!lStyle || !rStyle) return { ok: false, reason: 'mixed key styles in options' };
  if (lStyle === rStyle) return { ok: false, reason: `left and right keys share one style (${lStyle})` };

  const lines = unpipeMatchTable(stem).split('\n');
  const intro = (lines[0] ?? '').trim();
  if (lines.length < 2) return { ok: false, reason: 'single-line match stem (no list lines)' };
  // The intro line must not itself hold list items.
  if (findMarker(intro, keyAt(0, lStyle), 0) && findMarker(intro, keyAt(0, rStyle), 0)) {
    return { ok: false, reason: 'list items on the intro line' };
  }

  type Col = { style: KeyStyle; items: MatchEntry[]; caption: string };
  const L: Col = { style: lStyle, items: [], caption: '' };
  const R: Col = { style: rStyle, items: [], caption: '' };
  const trailing: string[] = [];
  const notes: string[] = [];
  let current: MatchEntry | null = null;

  for (const raw of lines.slice(1)) {
    let line = raw;
    const h = LIST_HEADER_LINE_RE.exec(line);
    if (h) {
      const numeral = /^(II|2)$/i.test(h[1] ?? '') ? 'II' : 'I';
      const cap = (h[2] ?? '').trim();
      if (numeral === 'I') L.caption = L.caption || cap;
      else R.caption = R.caption || cap;
      line = line.slice(h[0].length);
      current = null;
    }
    // Scan the line for markers, accepting only the NEXT expected key of each column.
    let pos = 0;
    let lineHadMarker = false;
    let pendingTextStart = -1;
    for (;;) {
      const nextL = findMarker(line, keyAt(L.items.length, L.style), pos);
      const nextR = findMarker(line, keyAt(R.items.length, R.style), pos);
      // Under a List-I header prefer left markers; under List-II prefer right.
      // Take whichever expected marker comes first on the line.
      const cands = [nextL ? { col: L, mk: nextL } : null, nextR ? { col: R, mk: nextR } : null]
        .filter((c): c is { col: Col; mk: { start: number; textStart: number } } => c !== null)
        .sort((a, b) => a.mk.start - b.mk.start);
      const pick = cands[0];
      if (!pick) break;
      // Text before this marker closes the previous item on this line.
      if (pendingTextStart >= 0 && current) {
        current.text = `${current.text} ${line.slice(pendingTextStart, pick.mk.start)}`.trim();
      } else if (!lineHadMarker) {
        const pre = line.slice(0, pick.mk.start).trim();
        if (pre !== '') {
          if (current) current.text = `${current.text} ${pre}`.trim();
          else return { ok: false, reason: `unexpected text before list item: "${pre.slice(0, 40)}"` };
        }
      }
      current = { key: keyAt(pick.col.items.length, pick.col.style), text: '' };
      pick.col.items.push(current);
      pendingTextStart = pick.mk.textStart;
      pos = pick.mk.textStart;
      lineHadMarker = true;
      if (L.items.length > 6 || R.items.length > 6) return { ok: false, reason: 'more than 6 items in a list' };
    }
    if (lineHadMarker && current) {
      current.text = `${current.text} ${line.slice(pendingTextStart)}`.trim();
      continue;
    }
    const rest = line.trim();
    if (rest === '') continue;
    if (L.items.length === 0 && R.items.length === 0) {
      return { ok: false, reason: `unrecognised line before the lists: "${rest.slice(0, 40)}"` };
    }
    // A non-marker line once items exist: after both lists it is the trailing prompt.
    trailing.push(rest);
    current = null;
  }

  if (L.items.length < 2 || R.items.length < 2) {
    return { ok: false, reason: `could not find both lists (List-I ${L.items.length}, List-II ${R.items.length})` };
  }
  for (const it of [...L.items, ...R.items]) {
    if (it.text === '') return { ok: false, reason: `empty item ${it.key}` };
  }
  // A trailing line before the last expected key means an item spilled over a line.
  if (trailing.length > 1) notes.push(`multi-line trailing text: ${trailing.join(' / ').slice(0, 60)}`);

  // Every key referenced in the options must exist in the stem lists.
  const lMax = Math.max(...leftRef.map((k) => ordinal(k, lStyle)));
  const rMax = Math.max(...rightRef.map((k) => ordinal(k, rStyle)));
  if (lMax >= L.items.length || rMax >= R.items.length) {
    return {
      ok: false,
      reason: `INCOMPLETE: options reference ${keyAt(lMax, lStyle)}/${keyAt(rMax, rStyle)} but lists have ${L.items.length}/${R.items.length} items`,
    };
  }

  // Normalise keys to A.. / 1.. and rewrite options when the stem used other styles.
  const left = L.items.map((it, i) => ({ key: LEFT_KEYS[i]!, text: it.text }));
  const right = R.items.map((it, i) => ({ key: RIGHT_KEYS[i]!, text: it.text }));
  const needsRewrite = lStyle !== 'letter' || rStyle !== 'digit';
  const newOptions = needsRewrite
    ? parsedOpts.map((pairs) =>
        pairs.map((p) => `${LEFT_KEYS[ordinal(p.left, lStyle)]}-${RIGHT_KEYS[ordinal(p.right, rStyle)]}`).join(', '),
      )
    : undefined;
  if (needsRewrite) notes.push(`keys normalised from ${lStyle}/${rStyle} to letter/digit (check explanation wording)`);

  const value: MatchField = {
    leftTitle: columnTitle('I', L.caption, intro),
    rightTitle: columnTitle('II', R.caption, intro),
    left,
    right,
  };
  return { ok: true, value, question: composeQuestion(intro, trailing.join(' ')), options: newOptions, notes };
}

/* -------------------------------------------------------------------------- */
/* Statements extraction                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Extract `statements` from a numbered statement/list stem. Markers must sit at
 * LINE START (`1.`, `1)`, `(1)`) and run 1..n consecutively; lines before the
 * first marker form the lead-in, lines after the last form the closing prompt.
 */
export function extractStatements(stem: string, options: readonly string[]): Extraction<string[]> {
  const lines = stem.split('\n');
  const leadLines: string[] = [];
  const statements: string[] = [];
  const promptLines: string[] = [];
  const notes: string[] = [];
  let phase: 'lead' | 'list' | 'prompt' = 'lead';
  for (const raw of lines) {
    const line = raw.trim();
    if (line === '') continue;
    const m = STMT_LINE_RE.exec(raw);
    if (m && phase !== 'prompt' && Number(m[1]) === statements.length + 1) {
      statements.push(raw.slice(m[0].length).trim());
      phase = 'list';
      continue;
    }
    if (m && phase === 'list') return { ok: false, reason: `out-of-sequence statement marker ${m[1]}` };
    if (phase === 'lead') leadLines.push(line);
    else {
      phase = 'prompt';
      promptLines.push(line);
    }
  }
  if (statements.length < 2) return { ok: false, reason: 'fewer than 2 line-start statements' };
  if (statements.length > 6) return { ok: false, reason: `${statements.length} statements (schema max 6)` };
  if (leadLines.length === 0) return { ok: false, reason: 'no lead-in before the statements' };
  if (statements.some((s) => s === '')) return { ok: false, reason: 'empty statement' };
  if (leadLines.length > 1) notes.push('multi-line lead-in');
  if (promptLines.length > 1) notes.push('multi-line closing prompt');
  const maxRef = maxStatementRef(options);
  if (maxRef > statements.length) {
    return { ok: false, reason: `INCOMPLETE: options reference statement ${maxRef} but only ${statements.length} exist` };
  }
  const question = [leadLines.join(' '), promptLines.join(' ')].filter((s) => s !== '').join('\n');
  return { ok: true, value: statements, question, notes };
}

/* -------------------------------------------------------------------------- */
/* Assertion–Reason extraction                                                */
/* -------------------------------------------------------------------------- */

/** Default lead-in for an A-R item that had none. */
export const AR_DEFAULT_LEAD = 'Consider the following Assertion (A) and Reason (R):';

/** Extract `assertion` / `reason` from an `Assertion (A): … Reason (R): …` stem. */
export function extractAR(stem: string): Extraction<{ assertion: string; reason: string }> {
  const m = /^([\s\S]*?)Assertion\s*\(A\)\s*[:.\-–]?\s*([\s\S]+?)\s*Reason\s*\(R\)\s*[:.\-–]?\s*([^\n]+)(?:\n([\s\S]*))?$/i.exec(
    stem.trim(),
  );
  if (!m) return { ok: false, reason: 'Assertion/Reason markers not in A-then-R order' };
  const pre = (m[1] ?? '').trim();
  const assertion = (m[2] ?? '').replace(/\s*\n\s*/g, ' ').trim();
  const reason = (m[3] ?? '').trim();
  const prompt = (m[4] ?? '').replace(/\s*\n\s*/g, ' ').trim();
  if (assertion === '' || reason === '') return { ok: false, reason: 'empty assertion or reason' };
  const lead = pre === '' ? AR_DEFAULT_LEAD : pre.replace(/\s*\n\s*/g, ' ');
  return { ok: true, value: { assertion, reason }, question: prompt ? `${lead}\n${prompt}` : lead, notes: [] };
}

/* -------------------------------------------------------------------------- */
/* Structured-item helpers shared by validator + audit                        */
/* -------------------------------------------------------------------------- */

/** The minimal item shape these helpers read. */
export interface StructuredLike {
  question: string;
  options: readonly string[];
  match?: MatchField;
  statements?: readonly string[];
  assertion?: string;
  reason?: string;
}

/** Does the item carry any structured stem field? */
export function hasStructured(item: StructuredLike): boolean {
  return item.match !== undefined || item.statements !== undefined || item.assertion !== undefined;
}

/**
 * Integrity problems of an item's structured fields against its options:
 * match keys must run A.. / 1.. without gaps and cover every key the options
 * reference; statements must cover the highest statement number referenced.
 */
export function structuredProblems(item: StructuredLike): string[] {
  const out: string[] = [];
  if (item.match) {
    const m = item.match;
    m.left.forEach((e, i) => {
      if (e.key !== LEFT_KEYS[i]) out.push(`match.left[${i}] key ${e.key} (expected ${LEFT_KEYS[i]})`);
      if (e.text.trim() === '') out.push(`match.left ${e.key} empty`);
    });
    m.right.forEach((e, i) => {
      if (e.key !== RIGHT_KEYS[i]) out.push(`match.right[${i}] key ${e.key} (expected ${RIGHT_KEYS[i]})`);
      if (e.text.trim() === '') out.push(`match.right ${e.key} empty`);
    });
    const parsed = parseMatchOptions(item.options);
    if (!parsed) out.push('options are not A-1 style codes');
    else {
      const lk = new Set(m.left.map((e) => e.key));
      const rk = new Set(m.right.map((e) => e.key));
      for (const p of parsed.flat()) {
        if (!lk.has(p.left)) out.push(`option references missing List-I key ${p.left}`);
        if (!rk.has(p.right)) out.push(`option references missing List-II key ${p.right}`);
      }
    }
  }
  if (item.statements) {
    const max = maxStatementRef(item.options);
    if (max > item.statements.length) out.push(`options reference statement ${max} but only ${item.statements.length} exist`);
  }
  if ((item.assertion === undefined) !== (item.reason === undefined)) out.push('assertion and reason must both be set');
  return [...new Set(out)];
}

/**
 * The FULL stem as plain text — lead-in, then the structured lists/statements/
 * A-R lines, then any closing prompt — for consumers that need searchable or
 * card text (coverage audit evidence, flashcard fronts). Items without
 * structured fields return `question` unchanged.
 */
export function stemPlainText(item: StructuredLike): string {
  if (!hasStructured(item)) return item.question;
  const [lead = '', ...prompt] = item.question.split('\n');
  const body: string[] = [];
  if (item.match) {
    body.push(item.match.leftTitle, ...item.match.left.map((e) => `${e.key}. ${e.text}`));
    body.push(item.match.rightTitle, ...item.match.right.map((e) => `${e.key}. ${e.text}`));
  }
  if (item.statements) body.push(...item.statements.map((s, i) => `${i + 1}. ${s}`));
  if (item.assertion !== undefined) body.push(`Assertion (A): ${item.assertion}`);
  if (item.reason !== undefined) body.push(`Reason (R): ${item.reason}`);
  return [lead, ...body, ...prompt].filter((l) => l.trim() !== '').join('\n');
}
