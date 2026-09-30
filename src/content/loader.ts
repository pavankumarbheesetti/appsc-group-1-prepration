/// <reference types="vite/client" />
/**
 * Content loader — discovers, validates, and indexes all content banks.
 *
 * OFFLINE-FIRST: content is discovered with Vite's `import.meta.glob(..., {
 * eager: true })`, which statically inlines every matching JSON file into the
 * bundle at build time. This is deliberate — the production build is a single
 * `file://`-openable HTML, where `fetch()`/XHR are blocked, so nothing may be
 * loaded over the network. Every bank is therefore present in memory as soon as
 * the module evaluates.
 *
 * Each bank is validated with the Zod schemas at load; malformed content fails
 * fast with a clear error rather than corrupting the in-memory index.
 */
import {
  parseBank,
  parseCards,
  parseManifest,
  parseMindmap,
  parseSyllabus,
  type BankKind,
  type CardItem,
  type ContentBank,
  type MainsItem,
  type Manifest,
  type MCQItem,
  type MindmapBank,
  type NoteItem,
  type SubjectCode,
  type SyllabusBank,
} from './types';
import {
  parseTaxonomy,
  type Band,
  type Taxonomy,
  type TaxonomySubject,
  type TaxonomySubtopic,
} from './taxonomy';
import {
  parsePyqMap,
  parsePyqWeights,
  parseSyllabusMap,
  type PyqMap,
  type PyqWeights,
  type SyllabusMap,
} from './audit-types';
import { parseTimeline, type TimelineBank } from './timeline-types';
import { parseLearningSequence, type LearningSequence } from './plan-types';
import {
  coveragePct,
  examPointCoverage,
  targetForBand,
  type ExamPointCoverage,
} from '../lib/metrics';
import {
  computeAudit,
  mainsEvidenceText,
  mcqEvidenceText,
  noteEvidenceText,
  type AuditReport,
  type EvidenceIndex,
  type SubtopicEvidence,
} from '../lib/audit';

/** A parsed content bank paired with the glob path it came from. */
export interface LoadedBank {
  /** Absolute glob path, e.g. `/content/history-ancient/mcq-indus-valley.json`. */
  path: string;
  bank: ContentBank;
}

/** The content items belonging to one subtopic, grouped by kind. */
export interface SubtopicContent {
  notes: NoteItem[];
  mcqs: MCQItem[];
  mains: MainsItem[];
}

/** A subtopic's taxonomy metadata merged with its discovered content. */
export interface SubtopicView extends SubtopicContent {
  /** Taxonomy metadata (labels, order, band, syllabusRef). */
  meta: TaxonomySubtopic;
}

/** The fully-validated, in-memory content index. */
export interface ContentIndex {
  manifest: Manifest;
  syllabus: SyllabusBank;
  /** The subject→chapter→subtopic taxonomy tree. */
  taxonomy: Taxonomy;
  /** All content banks (mcq/notes/mains) in discovery order. */
  banks: LoadedBank[];
  /** Lookup a bank by its glob path. */
  byPath: ReadonlyMap<string, LoadedBank>;
  /** Content banks grouped by subject code. */
  bySubject: ReadonlyMap<SubjectCode, LoadedBank[]>;
  /** Content items grouped by their `subtopicId`. */
  bySubtopic: ReadonlyMap<string, SubtopicContent>;
  /**
   * Curated flashcards grouped by `subtopicId` (the memory layer authored during
   * the per-subtopic review pipeline). Independent of the mcq/notes/mains banks.
   */
  cards: ReadonlyMap<string, CardItem[]>;
  /** Curated one-screen mind maps keyed by `subtopicId`. */
  mindmaps: ReadonlyMap<string, MindmapBank>;
  /** The authored syllabus-clause → coverage map (independent audit input). */
  auditSyllabusMap: SyllabusMap;
  /** The authored PYQ topic-gist map (independent audit input). */
  auditPyqMap: PyqMap;
  /**
   * The authored per-subtopic PYQ FREQUENCY WEIGHTS (question counts summed per
   * subtopic across the 3-cycle corpus). Drives the planner's FAST-pass ordering
   * and the top-25% "never fast" protection.
   */
  auditPyqWeights: PyqWeights;
  /** The interactive-timeline dataset (events + dynasty/era period bars). */
  timeline: TimelineBank;
  /**
   * The pedagogical LEARNING SEQUENCE — the per-subject study ORDER for every
   * Prelims subject (chronology for History, concept prerequisites elsewhere).
   * Pure ordering + dependency metadata over taxonomy ids; NOT a content bank.
   */
  learningSequence: LearningSequence;
}

/**
 * Eagerly-inlined content modules. The glob is a literal so Vite can analyse it
 * at build time; `{ eager: true }` turns each match into a synchronous import
 * whose `default` export is the parsed JSON.
 */
const CONTENT_MODULES = import.meta.glob<{ default: unknown }>(
  '/content/**/*.json',
  { eager: true },
);

/** Cached singleton index; built once on first access. */
let cached: ContentIndex | null = null;

/**
 * Build the content index from the inlined modules, validating every file.
 * @internal
 */
function buildIndex(): ContentIndex {
  let manifest: Manifest | null = null;
  let syllabus: SyllabusBank | null = null;
  let taxonomy: Taxonomy | null = null;
  let auditSyllabusMap: SyllabusMap | null = null;
  let auditPyqMap: PyqMap | null = null;
  let auditPyqWeights: PyqWeights | null = null;
  let timeline: TimelineBank | null = null;
  let learningSequence: LearningSequence | null = null;
  const banks: LoadedBank[] = [];
  /** Curated memory-layer banks, indexed by subtopicId as they are discovered. */
  const cards = new Map<string, CardItem[]>();
  const mindmaps = new Map<string, MindmapBank>();

  for (const [path, mod] of Object.entries(CONTENT_MODULES)) {
    const data = mod.default;

    // The manifest is identified by filename.
    if (path.endsWith('/manifest.json')) {
      manifest = parseManifest(data);
      continue;
    }

    // The taxonomy tree is identified by filename (not a content bank).
    if (path.endsWith('/taxonomy.json')) {
      taxonomy = parseTaxonomy(data);
      continue;
    }

    // The audit maps live under /content/audit/ and are NOT content banks —
    // they are the independent-audit inputs, validated by their own schemas.
    if (path.startsWith('/content/audit/')) {
      if (path.endsWith('/syllabus-map.json')) auditSyllabusMap = parseSyllabusMap(data);
      else if (path.endsWith('/pyq-map.json')) auditPyqMap = parsePyqMap(data);
      else if (path.endsWith('/pyq-weights.json')) auditPyqWeights = parsePyqWeights(data);
      // Any other file under content/audit/ is ignored by the loader.
      continue;
    }

    // The timeline dataset lives under /content/timeline/ and is NOT a content
    // bank — it is validated by its own schema (kind:"timeline").
    if (path.startsWith('/content/timeline/')) {
      if (path.endsWith('/events.json')) timeline = parseTimeline(data);
      // Any other file under content/timeline/ is ignored by the loader.
      continue;
    }

    // The learning sequence lives under /content/plan/ and is NOT a content
    // bank — it is a pure per-subject study ORDER over taxonomy ids, validated
    // by its own schema (see plan-types.ts).
    if (path.startsWith('/content/plan/')) {
      if (path.endsWith('/learning-sequence.json')) {
        learningSequence = parseLearningSequence(data);
      }
      // Any other file under content/plan/ is ignored by the loader.
      continue;
    }

    // Peek at the discriminator to route to the right schema.
    const kind = (data as { kind?: unknown } | null)?.kind;
    if (kind === 'syllabus') {
      syllabus = parseSyllabus(data);
      continue;
    }

    // Curated memory-layer banks (cards / mindmap). These are ADDITIVE and do
    // NOT belong to the mcq/notes/mains discriminated union: index them into
    // their own subtopic-keyed maps and skip the content-bank push below.
    if (kind === 'cards') {
      const bank = parseCards(data);
      for (const item of bank.items) {
        const arr = cards.get(item.subtopicId) ?? [];
        arr.push(item);
        cards.set(item.subtopicId, arr);
      }
      continue;
    }
    if (kind === 'mindmap') {
      const bank = parseMindmap(data);
      mindmaps.set(bank.subtopicId, bank);
      continue;
    }

    // Forward-compatibility: the loader only owns the three CONTENT-BANK kinds
    // (mcq/notes/mains). Any other `kind` under /content (e.g. a `timeline`
    // dataset authored by a sibling feature) is not a bank this module indexes,
    // so skip it rather than throwing — one unrecognized file must never crash
    // the whole in-memory index. Malformed banks of a KNOWN kind still fail
    // fast below via parseBank; the separate content-validation gate flags any
    // truly stray file.
    if (kind !== 'mcq' && kind !== 'notes' && kind !== 'mains') {
      continue;
    }

    banks.push({ path, bank: parseBank(data) });
  }

  if (!manifest) {
    throw new Error('content: manifest.json not found under /content');
  }
  if (!syllabus) {
    throw new Error(
      'content: no syllabus bank (kind:"syllabus") found under /content',
    );
  }
  if (!taxonomy) {
    throw new Error('content: taxonomy.json not found under /content');
  }
  if (!auditSyllabusMap) {
    throw new Error('content: audit/syllabus-map.json not found under /content');
  }
  if (!auditPyqMap) {
    throw new Error('content: audit/pyq-map.json not found under /content');
  }
  if (!auditPyqWeights) {
    throw new Error('content: audit/pyq-weights.json not found under /content');
  }
  if (!timeline) {
    throw new Error('content: timeline/events.json not found under /content');
  }
  if (!learningSequence) {
    throw new Error(
      'content: plan/learning-sequence.json not found under /content',
    );
  }

  const byPath = new Map<string, LoadedBank>();
  const bySubject = new Map<SubjectCode, LoadedBank[]>();
  const bySubtopic = new Map<string, SubtopicContent>();
  const subtopicBucket = (id: string): SubtopicContent => {
    let bucket = bySubtopic.get(id);
    if (!bucket) {
      bucket = { notes: [], mcqs: [], mains: [] };
      bySubtopic.set(id, bucket);
    }
    return bucket;
  };

  for (const loaded of banks) {
    byPath.set(loaded.path, loaded);
    const group = bySubject.get(loaded.bank.subjectCode) ?? [];
    group.push(loaded);
    bySubject.set(loaded.bank.subjectCode, group);

    // Group items under their subtopicId (items without one are simply skipped
    // here — they still exist in the banks, just not in the subtopic index).
    const { bank } = loaded;
    if (bank.kind === 'mcq') {
      for (const item of bank.items) {
        if (item.subtopicId) subtopicBucket(item.subtopicId).mcqs.push(item);
      }
    } else if (bank.kind === 'notes') {
      for (const item of bank.items) {
        if (item.subtopicId) subtopicBucket(item.subtopicId).notes.push(item);
      }
    } else {
      for (const item of bank.items) {
        if (item.subtopicId) subtopicBucket(item.subtopicId).mains.push(item);
      }
    }
  }

  return {
    manifest,
    syllabus,
    taxonomy,
    banks,
    byPath,
    bySubject,
    bySubtopic,
    cards,
    mindmaps,
    auditSyllabusMap,
    auditPyqMap,
    auditPyqWeights,
    timeline,
    learningSequence,
  };
}

/**
 * Return the validated content index, building it once and caching thereafter.
 * @throws Error if the manifest or syllabus is missing, or any bank is invalid.
 */
export function getContentIndex(): ContentIndex {
  if (!cached) {
    cached = buildIndex();
  }
  return cached;
}

/** The verified syllabus bank. */
export function getSyllabus(): SyllabusBank {
  return getContentIndex().syllabus;
}

/** The interactive-timeline dataset (events + dynasty/era period bars). */
export function getTimeline(): TimelineBank {
  return getContentIndex().timeline;
}

/**
 * The pedagogical LEARNING SEQUENCE — per-subject study order (chronology for
 * History, concept prerequisites elsewhere) over the Prelims taxonomy ids.
 */
export function getLearningSequence(): LearningSequence {
  return getContentIndex().learningSequence;
}

/**
 * Return content banks, optionally filtered by kind and/or subject.
 * @param kind Restrict to `'mcq' | 'notes' | 'mains'` when provided.
 * @param subjectCode Restrict to a single subject when provided.
 */
export function getBanks(
  kind?: BankKind,
  subjectCode?: SubjectCode,
): LoadedBank[] {
  return getContentIndex().banks.filter(
    (loaded) =>
      (kind === undefined || loaded.bank.kind === kind) &&
      (subjectCode === undefined || loaded.bank.subjectCode === subjectCode),
  );
}

/** Look up a single bank by its glob path. */
export function getBankByPath(path: string): LoadedBank | undefined {
  return getContentIndex().byPath.get(path);
}

/* -------------------------------------------------------------------------- */
/* Taxonomy accessors                                                          */
/* -------------------------------------------------------------------------- */

/** The full subject→chapter→subtopic taxonomy tree. */
export function getTaxonomy(): Taxonomy {
  return getContentIndex().taxonomy;
}

/** Taxonomy subjects, sorted by their `order`. */
export function getSubjects(): TaxonomySubject[] {
  return [...getTaxonomy().subjects].sort((a, b) => a.order - b.order);
}

/**
 * Taxonomy subtopics, optionally filtered to one subject, sorted by `order`.
 * @param subjectCode Restrict to a single subject when provided.
 */
export function getSubtopics(subjectCode?: SubjectCode): TaxonomySubtopic[] {
  return getTaxonomy()
    .subtopics.filter((s) => subjectCode === undefined || s.subjectCode === subjectCode)
    .sort((a, b) => a.order - b.order);
}

/**
 * Resolve one subtopic: its taxonomy metadata MERGED with the discovered
 * content (notes/mcqs/mains grouped by `subtopicId`). Returns `undefined` when
 * the id is not in the taxonomy.
 */
export function getSubtopic(id: string): SubtopicView | undefined {
  const meta = getTaxonomy().subtopics.find((s) => s.id === id);
  if (!meta) return undefined;
  const content = getContentIndex().bySubtopic.get(id) ?? {
    notes: [],
    mcqs: [],
    mains: [],
  };
  return { meta, notes: content.notes, mcqs: content.mcqs, mains: content.mains };
}

/**
 * Curated flashcards for a subtopic, in authoring order. Returns `[]` when the
 * subtopic has no curated cards bank yet (the Flashcards view falls back to its
 * derived cards when this is empty). Pure over the loaded content.
 */
export function getCards(subtopicId: string): CardItem[] {
  return getContentIndex().cards.get(subtopicId) ?? [];
}

/**
 * The curated one-screen mind map for a subtopic, or `undefined` when none has
 * been authored (the Mind map view falls back to its derived map). Pure over
 * the loaded content.
 */
export function getMindmap(subtopicId: string): MindmapBank | undefined {
  return getContentIndex().mindmaps.get(subtopicId);
}

/**
 * A subtopic's coverage readout. When the subtopic declares an `examPoints`
 * checklist, `pct` is EXAM-POINT coverage and `examPoints` carries the
 * covered/missing detail for display. When it does NOT, the model falls back
 * gracefully to the legacy band-target estimate (`min(100, mcqs/target)`), and
 * `examPoints` is `undefined` so callers can tell the two apart.
 */
export interface SubtopicCoverage {
  /** Coverage percent — exam-point when authored, else the band-target estimate. */
  pct: number;
  /** Per-point covered/missing detail; present only when `examPoints` is authored. */
  examPoints?: ExamPointCoverage;
}

/**
 * Compute a subtopic's coverage with a graceful fallback (see {@link
 * SubtopicCoverage}). Returns `undefined` only when the id is not in the
 * taxonomy. Pure over the loaded content.
 */
export function getSubtopicCoverage(id: string): SubtopicCoverage | undefined {
  const view = getSubtopic(id);
  if (!view) return undefined;
  const points = view.meta.examPoints;
  if (points && points.length > 0) {
    const ep = examPointCoverage(points, view.mcqs);
    return { pct: ep.pct, examPoints: ep };
  }
  return { pct: coveragePct(view.mcqs.length, targetForBand(view.meta.band)) };
}

/** Re-export the priority band type for view/metric consumers. */
export type { Band };

/* -------------------------------------------------------------------------- */
/* Independent coverage audit                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Build the {@link EvidenceIndex} the auditor consumes from the loaded content:
 * for every subtopic, the searchable text of each MCQ / note / mains item plus
 * the subject it belongs to. Uses the SAME text builders as the CLI so the
 * in-app audit and the `audit:coverage` gate can never disagree. Pure over the
 * loaded content.
 */
export function buildAuditEvidence(): EvidenceIndex {
  const index = getContentIndex();
  const evidence = new Map<string, SubtopicEvidence>();
  for (const [id, content] of index.bySubtopic) {
    const subject =
      content.mcqs[0]?.subjectCode ??
      content.notes[0]?.subjectCode ??
      content.mains[0]?.subjectCode ??
      index.taxonomy.subtopics.find((s) => s.id === id)?.subjectCode;
    if (!subject) continue; // an id with no content and no taxonomy row: skip
    evidence.set(id, {
      subject,
      mcqTexts: content.mcqs.map(mcqEvidenceText),
      noteTexts: content.notes.map(noteEvidenceText),
      mainsTexts: content.mains.map(mainsEvidenceText),
    });
  }
  return evidence;
}

/** Cached audit report; built once on first access (offline, pure). */
let cachedAudit: AuditReport | null = null;

/**
 * Run the independent coverage audit over the bundled content and authored maps.
 * Cached after first use. Same computation as the `audit:coverage` CLI.
 */
export function getAudit(): AuditReport {
  if (!cachedAudit) {
    const index = getContentIndex();
    cachedAudit = computeAudit(
      index.auditSyllabusMap,
      index.auditPyqMap,
      buildAuditEvidence(),
    );
  }
  return cachedAudit;
}
