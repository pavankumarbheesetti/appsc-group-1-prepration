/**
 * Audit engine — the PURE, DOM-free, storage-free computation behind the
 * independent coverage audit.
 *
 * This is the single shared brain used by BOTH surfaces:
 *   - the `audit:coverage` CLI (`scripts/audit-coverage.ts`), which builds the
 *     evidence index from disk with `node:fs` and gates CI; and
 *   - the in-app "Syllabus audit" panel (`src/views/syllabus.ts`), which builds
 *     the SAME evidence index from the offline-bundled content loader.
 *
 * It takes plain inputs — the two authored maps plus an EVIDENCE INDEX (per
 * subtopic: the searchable text of every MCQ / note / mains item, and the
 * subject the subtopic belongs to) — and returns a fully-derived report. It
 * reaches into no globals, so it is trivially unit-tested with fixtures.
 *
 * Coverage is measured against the OFFICIAL SYLLABUS and PYQs, never against the
 * authors' own `examPoints`: a clause/topic only counts as covered when its
 * declared KEYWORDS are actually EVIDENCED in the mapped content.
 */
import type { SubjectCode } from '../content/types';
import {
  isPrelimsPaper,
  type AuditPaper,
  type PyqMap,
  type PyqMapEntry,
  type SyllabusMap,
  type SyllabusMapClause,
} from '../content/audit-types';

/* -------------------------------------------------------------------------- */
/* Evidence model                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The searchable content of ONE subtopic: one string per item, split by kind so
 * the auditor can apply the "≥2 MCQs" rule (Prelims) vs the "≥1 mains + note"
 * rule (Mains) precisely. `subject` lets the auditor roll AP share up per subject.
 */
export interface SubtopicEvidence {
  /** The subject this subtopic belongs to (for AP-share aggregation). */
  subject: SubjectCode;
  /** One lower-cased searchable string per MCQ (question + options + explanation …). */
  mcqTexts: string[];
  /** One searchable string per note. */
  noteTexts: string[];
  /** One searchable string per mains item. */
  mainsTexts: string[];
}

/** Evidence for every subtopic, keyed by subtopic id. */
export type EvidenceIndex = ReadonlyMap<string, SubtopicEvidence>;

/* -------------------------------------------------------------------------- */
/* Text builders (shared by the CLI and the loader so extraction never drifts) */
/* -------------------------------------------------------------------------- */

/** A permissive item shape — only the text-bearing fields the auditor reads. */
export interface EvidenceItemLike {
  question?: string;
  title?: string;
  body?: string;
  explanation?: string;
  modelAnswer?: string;
  options?: string[];
  keyPoints?: string[];
  covers?: string[];
  tags?: string[];
}

/** Join defined string parts into one lower-cased blob for substring matching. */
function joinLower(parts: Array<string | undefined>, arrays: Array<string[] | undefined>): string {
  const bits: string[] = [];
  for (const p of parts) if (p) bits.push(p);
  for (const a of arrays) if (a) bits.push(a.join(' '));
  return bits.join(' \n ').toLowerCase();
}

/** Searchable text of an MCQ item (question, options, explanation, covers, tags). */
export function mcqEvidenceText(item: EvidenceItemLike): string {
  return joinLower(
    [item.question, item.explanation],
    [item.options, item.covers, item.tags],
  );
}

/** Searchable text of a note item (title, body, keyPoints, tags). */
export function noteEvidenceText(item: EvidenceItemLike): string {
  return joinLower([item.title, item.body], [item.keyPoints, item.tags]);
}

/** Searchable text of a mains item (question, modelAnswer, keyPoints, tags). */
export function mainsEvidenceText(item: EvidenceItemLike): string {
  return joinLower([item.question, item.modelAnswer], [item.keyPoints, item.tags]);
}

/* -------------------------------------------------------------------------- */
/* AP-specificity detection (ported from the read-only research scan, B-ap)    */
/* -------------------------------------------------------------------------- */

/**
 * Strong, unambiguous Andhra-Pradesh terms: places, AP dynasties/personalities,
 * bifurcation vocabulary, state PSUs. Mirrors the research scanner that produced
 * `B-ap.json` so the in-app AP share matches the offline analysis.
 */
const AP_STRONG_TERMS = [
  'Andhra', 'Andhradesa', 'Telugu', 'Rayalaseema', 'Amaravati', 'Amaravathi',
  'Visakhapatnam', 'Vizag', 'Vijayawada', 'Guntur', 'Tirupati', 'Tirumala',
  'Polavaram', 'Srisailam', 'Sriharikota', 'SHAR', 'Nagarjunasagar',
  'Nagarjunakonda', 'Kurnool', 'Srikakulam', 'Nellore', 'Kadapa', 'Cuddapah',
  'Anantapur', 'Chittoor', 'Kakinada', 'Rajahmundry', 'Rajamahendravaram',
  'Ongole', 'Prakasam', 'Vizianagaram', 'Eluru', 'Machilipatnam', 'Bapatla',
  'Nandyal', 'Anakapalli', 'Annamayya', 'Konaseema', 'Palnadu', 'Parvathipuram',
  'Satavahana', 'Ikshvaku', 'Vishnukundin', 'Salankayana', 'Kakatiya',
  'Qutb Shah', 'Qutubshahi', 'Qutb Shahi', 'Golconda', 'Reddi', 'Renati',
  'Vemana', 'Veeresalingam', 'Gurajada', 'Gidugu', 'Alluri', 'Potti Sreeramulu',
  'Potti Sriramulu', 'Tripuraneni', 'Garimella', 'Jashuva', 'Boyi Bheemanna',
  'Rayaprolu', 'Unnava', 'Duggirala', 'Konda Venkatappayya', 'Pattabhi',
  'Lepakshi', 'Undavalli', 'Bhairavakona', 'Borra', 'Araku', 'Papikondalu',
  'Kolleru', 'Pulicat', 'Coringa', 'Nallamala', 'Seshachalam', 'Tummalapalle',
  'Dugarajapatnam', 'Bhogapuram', 'Krishnapatnam', 'Gangavaram', 'Simhachalam',
  'Mangalagiri', 'Kanaka Durga', 'Ahobilam', 'Reorganisation Act',
  'Reorganization Act', 'bifurcation', 'APSRTC', 'APGENCO', 'APTRANSCO',
  'Chandrababu', 'Jagan', 'Aarogyasri', 'Rythu Bharosa', 'Navaratnalu',
  'e-Pragati', 'RTGS', 'Meeseva', 'eSeva',
];

/** Escape a literal for safe inclusion in a RegExp. @internal */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** \b-anchored alternation over the strong AP terms (case-insensitive). */
const AP_STRONG_RE = new RegExp(`\\b(${AP_STRONG_TERMS.map(escapeRe).join('|')})\\b`, 'i');
/** Standalone "AP" token (word-boundaried, not part of another word). */
const AP_TOKEN_RE = /(^|[^a-z])ap([^a-z]|$)/i;
/** Krishna/Godavari only in a river/water context (kills the deity "Krishna"). */
const AP_RIVER_RE =
  /\b(krishna|godavari)\b[^.]{0,60}\b(river|rivers|basin|delta|barrage|dam|water|tributary|canal|reservoir|project|valley|district)\b|\b(river|delta|basin|barrage|dam|water|tributary|canal|reservoir|project)\b[^.]{0,60}\b(krishna|godavari)\b/i;

/**
 * True when a text is Andhra-Pradesh-specific. Citation noise ("*Source: …*",
 * "APPSC …") is stripped first so it does not inflate the AP share.
 */
export function isApText(text: string): boolean {
  const t = text.replace(/\*source:[^*]*\*/gi, ' ').replace(/appsc[^\n]*/gi, ' ');
  return AP_STRONG_RE.test(t) || AP_TOKEN_RE.test(t) || AP_RIVER_RE.test(t);
}

/* -------------------------------------------------------------------------- */
/* Classification thresholds                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A Prelims clause is COVERED only when its specific keywords are evidenced in
 * ≥ this many distinct MCQs (raised from the old near-zero `≥2` bar).
 */
export const PRELIMS_MCQ_EVIDENCE_MIN = 3;
/** A Mains clause is COVERED only when it maps to ≥ this many mains items. */
export const MAINS_MAINS_MIN = 2;
/** A Mains clause is COVERED only when it maps to ≥ this many note items. */
export const MAINS_NOTE_MIN = 1;
/**
 * Fraction of a clause's SPECIFIC keywords that must EACH be evidenced (in the
 * pool that counts for its paper) before the clause can be COVERED. 0.60 = 60%.
 */
export const KEYWORD_COVERAGE_MIN = 0.6;
/** A PYQ topic is a HIT once its specific keywords are evidenced in ≥ this many MCQs. */
export const PYQ_HIT_MCQ_MIN = 2;

/* -------------------------------------------------------------------------- */
/* Generic stoplist + word-boundary keyword matching                          */
/* -------------------------------------------------------------------------- */

/**
 * GENERIC stoplist — words so broad they match almost any content, and for the
 * ethics clauses circular with the subtopic name itself (`ethics`, `values`,
 * `attitude`). They prove nothing, so they are STRIPPED from a clause's / PYQ
 * topic's keywords before any evidence is counted: coverage is only ever earned
 * by SPECIFIC terms. (See `.research/audit/E-review.md`, "Methodology flaws #2".)
 */
export const GENERIC_STOPLIST: ReadonlySet<string> = new Set([
  'india', 'state', 'states', 'features', 'powers', 'governance', 'ethics',
  'values', 'attitude', 'court', 'security', 'policy', 'development', 'history',
  'culture', 'economy', 'geography', 'science', 'technology', 'andhra',
  'pradesh', 'system', 'role', 'issues', 'concept', 'nature', 'scope',
]);

/** True when a keyword is a generic stopword (case-insensitive, trimmed). */
export function isGenericKeyword(keyword: string): boolean {
  return GENERIC_STOPLIST.has(keyword.trim().toLowerCase());
}

/** A clause/topic's SPECIFIC keywords — its keywords minus the generic stoplist. */
export function specificKeywords(keywords: string[]): string[] {
  return keywords.filter((k) => !isGenericKeyword(k));
}

/** Cache of compiled word-boundary matchers, keyed by lower-cased keyword. @internal */
const keywordReCache = new Map<string, RegExp>();

/**
 * A word-boundary, case-insensitive matcher for one keyword. Boundaries are any
 * non-alphanumeric char (or a string edge), so multi-word / hyphenated / numeric
 * keywords ("finance commission", "e-governance", "73rd", "anti-defection")
 * match as whole tokens and never as a substring of a larger word. @internal
 */
function keywordMatcher(keyword: string): RegExp {
  const key = keyword.trim().toLowerCase();
  let re = keywordReCache.get(key);
  if (!re) {
    const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    re = new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`, 'i');
    keywordReCache.set(key, re);
  }
  return re;
}

/** A specific keyword paired with its compiled word-boundary matcher. @internal */
interface CompiledKeyword {
  original: string;
  re: RegExp;
}

/** Compile a clause/topic's SPECIFIC keywords (generic ones dropped) into matchers. @internal */
function compileSpecific(keywords: string[]): CompiledKeyword[] {
  return specificKeywords(keywords).map((k) => ({ original: k, re: keywordMatcher(k) }));
}

/* -------------------------------------------------------------------------- */
/* Report model                                                                */
/* -------------------------------------------------------------------------- */

/** Coverage verdict for one clause. */
export type ClauseStatus = 'COVERED' | 'THIN' | 'MISSING';
/** Evidence verdict for one PYQ topic. */
export type PyqStatus = 'HIT' | 'NEAR' | 'MISS';

/** Per-clause audit result. */
export interface ClauseResult {
  ref: string;
  paper: AuditPaper;
  clause: string;
  apSpecific: boolean;
  subtopicIds: string[];
  keywords: string[];
  status: ClauseStatus;
  /** # of MCQs (across mapped subtopics) whose text matched ≥1 keyword. */
  mcqEvidence: number;
  /** # of notes whose text matched ≥1 keyword. */
  noteEvidence: number;
  /** # of mains whose text matched ≥1 keyword. */
  mainsEvidence: number;
  /** Total authored items across the mapped subtopics (mcq + note + mains). */
  itemCount: number;
  /** The clause's SPECIFIC keywords (generic stopwords removed). */
  specificKeywords: string[];
  /** The specific keywords evidenced (word-boundary) in the pool that counts for this paper. */
  matchedKeywords: string[];
  /** Evidenced specific keywords / total specific keywords, 0–100 integer percent. */
  keywordCoveragePct: number;
}

/** Per-paper traceability roll-up. */
export interface PaperTraceability {
  paper: AuditPaper;
  total: number;
  covered: number;
  thin: number;
  missing: number;
  /** covered / total, as a 0–100 integer percent (100 when there are no clauses). */
  pct: number;
}

/** Per-PYQ-topic audit result. */
export interface PyqResult extends PyqMapEntry {
  status: PyqStatus;
  /** # of the mapped subtopic's MCQs whose text matched ≥1 keyword. */
  mcqEvidence: number;
}

/** PYQ roll-up across all topics. */
export interface PyqSummary {
  total: number;
  hit: number;
  near: number;
  miss: number;
  /** hit / total, as a 0–100 integer percent. */
  hitPct: number;
}

/**
 * Per-subject AP-share FLOORS (0–100 percent of items). A subject's authored AP
 * share must never fall below its floor, so the coverage gate fails if it does.
 *
 * Each floor is `max(the PYQ-based target in .research/ap/targets.json, the AP
 * share already achieved)` — i.e. it ratchets: we lock in at least the current
 * level so future edits can never regress AP coverage below where it stands.
 * MENT, TEL and ENG are AP-neutral by exam design and carry NO floor (absent →
 * exempt). See `.research/ap/targets.json` and the AP top-up brief.
 */
export const AP_TARGETS: Partial<Record<SubjectCode, number>> = {
  CA: 42,
  ECON: 28,
  GEO: 35,
  HIST: 25,
  POL: 20,
  SCI: 24,
};

/** Per-subject AP-share roll-up. */
export interface ApShare {
  subject: SubjectCode;
  /** Items (mcq + note + mains) whose text is AP-specific. */
  apItems: number;
  /** Total authored items in the subject. */
  totalItems: number;
  /** apItems / totalItems, 0–100 integer percent. */
  pct: number;
  /** AP-share floor for this subject (percent), or `null` when exempt (MENT/TEL/ENG). */
  target: number | null;
  /** True when `pct >= target`, or when the subject is exempt (`target === null`). */
  meetsTarget: boolean;
}

/** The complete audit report. */
export interface AuditReport {
  clauses: ClauseResult[];
  papers: PaperTraceability[];
  pyqResults: PyqResult[];
  pyq: PyqSummary;
  apShareBySubject: ApShare[];
  /** Subjects whose AP share fell BELOW their {@link AP_TARGETS} floor — the gate list. */
  apTargetFailures: ApShare[];
  /** Prelims-only traceability (both Screening papers pooled), 0–100 percent. */
  prelimsTraceabilityPct: number;
  /** The THIN + MISSING clauses — the actionable gap list. */
  thinMissing: ClauseResult[];
}

/* -------------------------------------------------------------------------- */
/* Core computation                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Count how many of `texts` match ≥1 specific keyword (word-boundary), and
 * record which specific keywords were evidenced anywhere in `texts`.
 */
function countKeywordHits(
  compiled: CompiledKeyword[],
  texts: string[],
  matched: Set<string>,
): number {
  let hits = 0;
  for (const text of texts) {
    let itemMatched = false;
    for (const { original, re } of compiled) {
      if (re.test(text)) {
        matched.add(original);
        itemMatched = true;
      }
    }
    if (itemMatched) hits += 1;
  }
  return hits;
}

/**
 * Classify a single syllabus clause against the evidence index. @internal
 *
 * The bar is deliberately strict and honest (see `.research/audit/E-review.md`):
 *   - only SPECIFIC keywords (generic stoplist removed) count as evidence, and
 *     each is matched on a WORD BOUNDARY (case-insensitive), never as a substring;
 *   - a Prelims clause is COVERED only when ≥60% of its specific keywords are
 *     each evidenced in the mapped MCQ text AND ≥3 distinct MCQs carry evidence;
 *   - a Mains clause is COVERED only when ≥60% of its specific keywords are
 *     evidenced across mains + notes AND it maps to ≥2 mains + ≥1 note;
 *   - otherwise the clause is THIN (some specific evidence) or MISSING (none, or
 *     no mapped content at all).
 */
function classifyClause(clause: SyllabusMapClause, evidence: EvidenceIndex): ClauseResult {
  const mcqTexts: string[] = [];
  const noteTexts: string[] = [];
  const mainsTexts: string[] = [];
  for (const id of clause.subtopicIds) {
    const ev = evidence.get(id);
    if (!ev) continue;
    mcqTexts.push(...ev.mcqTexts);
    noteTexts.push(...ev.noteTexts);
    mainsTexts.push(...ev.mainsTexts);
  }

  const compiled = compileSpecific(clause.keywords);
  const specifics = compiled.map((c) => c.original);

  // Per-kind evidence: # items matching ≥1 specific keyword, plus which matched.
  const mcqMatched = new Set<string>();
  const noteMatched = new Set<string>();
  const mainsMatched = new Set<string>();
  const mcqEvidence = countKeywordHits(compiled, mcqTexts, mcqMatched);
  const noteEvidence = countKeywordHits(compiled, noteTexts, noteMatched);
  const mainsEvidence = countKeywordHits(compiled, mainsTexts, mainsMatched);
  const itemCount = mcqTexts.length + noteTexts.length + mainsTexts.length;

  const prelims = isPrelimsPaper(clause.paper);
  // The pool of evidenced specific keywords that COUNTS for this paper: MCQ text
  // for Prelims, mains + notes for Mains/qualifying.
  const poolMatched = prelims
    ? mcqMatched
    : new Set<string>([...mainsMatched, ...noteMatched]);
  const keywordCoverage = specifics.length === 0 ? 0 : poolMatched.size / specifics.length;
  const keywordBarMet = specifics.length > 0 && keywordCoverage >= KEYWORD_COVERAGE_MIN;

  let status: ClauseStatus;
  if (itemCount === 0) {
    // No mapped subtopics, or mapped subtopics carry no content → true gap.
    status = 'MISSING';
  } else if (prelims) {
    // Objective papers: ≥60% of specific keywords evidenced AND ≥3 MCQs carry it.
    if (keywordBarMet && mcqEvidence >= PRELIMS_MCQ_EVIDENCE_MIN) status = 'COVERED';
    else if (poolMatched.size === 0) status = 'MISSING';
    else status = 'THIN';
  } else {
    // Mains / qualifying: ≥60% specific keywords across mains+notes AND ≥2 mains + ≥1 note.
    const hasItems = mainsTexts.length >= MAINS_MAINS_MIN && noteTexts.length >= MAINS_NOTE_MIN;
    if (keywordBarMet && hasItems) status = 'COVERED';
    else if (poolMatched.size === 0) status = 'MISSING';
    else status = 'THIN';
  }

  return {
    ref: clause.ref,
    paper: clause.paper,
    clause: clause.clause,
    apSpecific: clause.apSpecific,
    subtopicIds: clause.subtopicIds,
    keywords: clause.keywords,
    status,
    mcqEvidence,
    noteEvidence,
    mainsEvidence,
    itemCount,
    specificKeywords: specifics,
    matchedKeywords: [...poolMatched],
    keywordCoveragePct: Math.round(keywordCoverage * 100),
  };
}

/**
 * Classify a single PYQ topic against the evidence index. @internal
 *
 * Deterministic and specific-keyword-gated: generic stopwords are stripped and
 * matching is word-boundary, so HIT (≥2 MCQs), NEAR (exactly 1) and MISS (0, or
 * a topic with no specific keywords) are reproducible from the inputs alone.
 */
function classifyPyq(entry: PyqMapEntry, evidence: EvidenceIndex): PyqResult {
  const ev = evidence.get(entry.subtopicId);
  const compiled = compileSpecific(entry.keywords);
  const matched = new Set<string>();
  const mcqEvidence = ev ? countKeywordHits(compiled, ev.mcqTexts, matched) : 0;
  let status: PyqStatus;
  if (compiled.length > 0 && mcqEvidence >= PYQ_HIT_MCQ_MIN) status = 'HIT';
  else if (compiled.length > 0 && mcqEvidence === 1) status = 'NEAR';
  else status = 'MISS';
  return { ...entry, status, mcqEvidence };
}

/** Fold clause results into per-paper traceability, in AUDIT_PAPERS order. */
function rollUpPapers(clauses: ClauseResult[]): PaperTraceability[] {
  const order: AuditPaper[] = [];
  const byPaper = new Map<AuditPaper, ClauseResult[]>();
  for (const c of clauses) {
    let bucket = byPaper.get(c.paper);
    if (!bucket) {
      bucket = [];
      byPaper.set(c.paper, bucket);
      order.push(c.paper);
    }
    bucket.push(c);
  }
  return order.map((paper) => {
    const list = byPaper.get(paper) ?? [];
    const covered = list.filter((c) => c.status === 'COVERED').length;
    const thin = list.filter((c) => c.status === 'THIN').length;
    const missing = list.filter((c) => c.status === 'MISSING').length;
    return {
      paper,
      total: list.length,
      covered,
      thin,
      missing,
      pct: list.length === 0 ? 100 : Math.round((covered / list.length) * 100),
    };
  });
}

/** Compute AP share per subject from the evidence index. @internal */
function rollUpApShare(evidence: EvidenceIndex): ApShare[] {
  const bySubject = new Map<SubjectCode, { ap: number; total: number }>();
  for (const ev of evidence.values()) {
    const acc = bySubject.get(ev.subject) ?? { ap: 0, total: 0 };
    for (const text of [...ev.mcqTexts, ...ev.noteTexts, ...ev.mainsTexts]) {
      acc.total += 1;
      if (isApText(text)) acc.ap += 1;
    }
    bySubject.set(ev.subject, acc);
  }
  return [...bySubject.entries()]
    .map(([subject, { ap, total }]) => {
      const pct = total === 0 ? 0 : Math.round((ap / total) * 100);
      const target = AP_TARGETS[subject] ?? null;
      return {
        subject,
        apItems: ap,
        totalItems: total,
        pct,
        target,
        meetsTarget: target === null || pct >= target,
      };
    })
    .sort((a, b) => a.subject.localeCompare(b.subject));
}

/**
 * Run the full audit. Pure: identical inputs always yield an identical report.
 *
 * @param syllabusMap Every official-syllabus clause + its expected coverage.
 * @param pyqMap      De-duplicated PYQ topic gists + their expected subtopic.
 * @param evidence    Per-subtopic searchable content, keyed by subtopic id.
 */
export function computeAudit(
  syllabusMap: SyllabusMap,
  pyqMap: PyqMap,
  evidence: EvidenceIndex,
): AuditReport {
  const clauses = syllabusMap.map((c) => classifyClause(c, evidence));
  const papers = rollUpPapers(clauses);
  const pyqResults = pyqMap.map((p) => classifyPyq(p, evidence));

  const hit = pyqResults.filter((p) => p.status === 'HIT').length;
  const near = pyqResults.filter((p) => p.status === 'NEAR').length;
  const miss = pyqResults.filter((p) => p.status === 'MISS').length;
  const pyq: PyqSummary = {
    total: pyqResults.length,
    hit,
    near,
    miss,
    hitPct: pyqResults.length === 0 ? 0 : Math.round((hit / pyqResults.length) * 100),
  };

  // Prelims traceability pools BOTH Screening papers (the CI gate reads this).
  const prelimsClauses = clauses.filter((c) => isPrelimsPaper(c.paper));
  const prelimsCovered = prelimsClauses.filter((c) => c.status === 'COVERED').length;
  const prelimsTraceabilityPct =
    prelimsClauses.length === 0 ? 100 : Math.round((prelimsCovered / prelimsClauses.length) * 100);

  const thinMissing = clauses.filter((c) => c.status !== 'COVERED');

  const apShareBySubject = rollUpApShare(evidence);
  const apTargetFailures = apShareBySubject.filter((a) => !a.meetsTarget);

  return {
    clauses,
    papers,
    pyqResults,
    pyq,
    apShareBySubject,
    apTargetFailures,
    prelimsTraceabilityPct,
    thinMissing,
  };
}
