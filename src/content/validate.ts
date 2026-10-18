/**
 * Content-integrity validation — the machine-checked gate for every content bank.
 *
 * This module is the single source of validation truth shared by BOTH:
 *   - the `validate:content` CLI (`scripts/validate-content.ts`), and
 *   - the Vitest suite (`src/content/__tests__/content-integrity.test.ts`).
 *
 * Unlike `loader.ts` (which uses Vite's `import.meta.glob` to inline banks into
 * the browser bundle), this runs in a Node context: it reads every JSON file
 * under `content/` from disk with `node:fs`, validates each against the Zod
 * schemas exported from `./types`, and layers cross-file integrity checks on top
 * (manifest ↔ disk agreement, orphan detection, unique ids, syllabusRef resolution).
 *
 * It never throws for content problems — every issue is collected into a
 * per-file result so callers can print a full report and decide the exit code.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  ContentBankSchema,
  CardsBankSchema,
  CaMetaSchema,
  ManifestSchema,
  MindmapBankSchema,
  SyllabusBankSchema,
  type ContentBank,
  type MCQItem,
  type Manifest,
  type SyllabusBank,
} from './types';
import { TaxonomySchema, type Taxonomy } from './taxonomy';
import {
  AlignExceptionsSchema,
  PyqMapSchema,
  PyqWeightsSchema,
  QUALITY_RULES,
  QualityWaiversSchema,
  SyllabusMapSchema,
} from './audit-types';
import { TimelineBankSchema } from './timeline-types';
import {
  classifyStem,
  hasStructured,
  isStatementCode,
  maxStatementRef,
  parseMatchOptions,
  statementNumbersIn,
  structuredProblems,
} from '../lib/question-structure';
import { LearningSequenceSchema, UnitsSchema, type LearningSequence, type Units } from './plan-types';
import { FactsFileSchema, type Fact, type FactsFile } from './facts-types';

/* -------------------------------------------------------------------------- */
/* Paths                                                                       */
/* -------------------------------------------------------------------------- */

/** Absolute path to the repo's `content/` directory (this file is `src/content/`). */
const CONTENT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../content');
/** Repo root — manifest bank paths are expressed relative to this, with a leading `/`. */
const PROJECT_ROOT = resolve(CONTENT_DIR, '..');

/**
 * Convert an absolute disk path into the glob-style path used in the manifest
 * and by the loader, e.g. `/content/history-ancient/hist-ancient-ivc/mcq-hist-ancient-ivc.json`.
 */
function toGlobPath(absPath: string): string {
  return `/${relative(PROJECT_ROOT, absPath).split(sep).join('/')}`;
}

/** Resolve a manifest glob-style path (`/content/...`) back to an absolute disk path. */
function toDiskPath(globPath: string): string {
  return join(PROJECT_ROOT, globPath);
}

/* -------------------------------------------------------------------------- */
/* Result model                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The outcome of validating a single file (or the manifest).
 * `ok` is derived: a file passes only when it has zero hard `errors`.
 * `warnings` are advisory (e.g. a dangling `syllabusRef`) and never fail the gate.
 */
export interface FileValidationResult {
  /** Glob-style path, e.g. `/content/history-ancient/hist-ancient-ivc/mcq-hist-ancient-ivc.json`. */
  file: string;
  /** True when there are no hard errors. */
  ok: boolean;
  /** Hard failures — any non-empty list fails the gate. */
  errors: string[];
  /** Advisory issues that do not fail the gate. */
  warnings: string[];
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/** Format a Zod error into compact, per-issue messages. */
function formatIssues(error: z.ZodError): string[] {
  return error.issues.map(
    (i) => `${i.path.join('.') || '(root)'}: ${i.message}`,
  );
}

/** Recursively collect every `*.json` file under `dir` as absolute paths. */
function walkJsonFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) {
      out.push(...walkJsonFiles(abs));
    } else if (entry.endsWith('.json')) {
      out.push(abs);
    }
  }
  return out;
}

/** A parsed content bank paired with its glob path, used for cross-file checks. */
interface ParsedBank {
  file: string;
  bank: ContentBank;
}

/* -------------------------------------------------------------------------- */
/* Core validation                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Validate every content bank on disk and return a per-file result list.
 *
 * Pure with respect to its inputs — it only reads the filesystem — and never
 * throws for content problems, so both the CLI and the test can consume the
 * same structured results. Callers decide the exit code / assertions.
 */
export function validateAllContent(): FileValidationResult[] {
  const results: FileValidationResult[] = [];
  /** Index results by glob path so cross-checks can append to the right file. */
  const byFile = new Map<string, FileValidationResult>();

  const resultFor = (file: string): FileValidationResult => {
    let r = byFile.get(file);
    if (!r) {
      r = { file, ok: true, errors: [], warnings: [] };
      byFile.set(file, r);
      results.push(r);
    }
    return r;
  };

  const manifestGlob = toGlobPath(join(CONTENT_DIR, 'manifest.json'));

  // Read + JSON.parse a file, recording a parse error on its result. Returns
  // `undefined` when the file is missing or is not valid JSON.
  const readJson = (abs: string): unknown => {
    const file = toGlobPath(abs);
    try {
      return JSON.parse(readFileSync(abs, 'utf8')) as unknown;
    } catch (err) {
      resultFor(file).errors.push(
        `not readable/parseable JSON: ${(err as Error).message}`,
      );
      return undefined;
    }
  };

  /* ----- 1. Manifest -------------------------------------------------------- */

  let manifest: Manifest | undefined;
  const manifestAbs = join(CONTENT_DIR, 'manifest.json');
  if (!existsSync(manifestAbs)) {
    resultFor(manifestGlob).errors.push('manifest.json not found under content/');
  } else {
    const raw = readJson(manifestAbs);
    if (raw !== undefined) {
      const parsed = ManifestSchema.safeParse(raw);
      if (parsed.success) {
        manifest = parsed.data;
        resultFor(manifestGlob); // ensure it shows as PASS
      } else {
        resultFor(manifestGlob).errors.push(...formatIssues(parsed.error));
      }
    }
  }

  /* ----- 2. Per-file schema validation ------------------------------------- */

  const parsedBanks: ParsedBank[] = [];
  let syllabus: SyllabusBank | undefined;
  let syllabusFile: string | undefined;
  /**
   * Curated memory-layer banks (cards/mindmap) validated against their OWN
   * schemas. They are content files (registered in the manifest, orphan-checked)
   * but are NOT part of the mcq/notes/mains discriminated union, so their
   * manifest `count` is reconciled from here: cards → items.length, mindmap →
   * branches.length. Size-cap violations surface as hard schema errors.
   */
  const curatedCount = new Map<string, number>();

  const jsonFiles = walkJsonFiles(CONTENT_DIR);
  const contentGlobs = new Set<string>();
  const taxonomyGlob = toGlobPath(join(CONTENT_DIR, 'taxonomy.json'));
  const syllabusMapGlob = toGlobPath(join(CONTENT_DIR, 'audit', 'syllabus-map.json'));
  const pyqMapGlob = toGlobPath(join(CONTENT_DIR, 'audit', 'pyq-map.json'));
  const pyqWeightsGlob = toGlobPath(join(CONTENT_DIR, 'audit', 'pyq-weights.json'));
  const alignExceptionsGlob = toGlobPath(join(CONTENT_DIR, 'audit', 'align-exceptions.json'));
  const qualityWaiversGlob = toGlobPath(join(CONTENT_DIR, 'audit', 'quality-waivers.json'));
  const timelineGlob = toGlobPath(join(CONTENT_DIR, 'timeline', 'events.json'));
  const planGlob = toGlobPath(join(CONTENT_DIR, 'plan', 'learning-sequence.json'));
  const unitsGlob = toGlobPath(join(CONTENT_DIR, 'plan', 'units.json'));
  const caMetaGlob = toGlobPath(join(CONTENT_DIR, 'current-affairs', 'meta.json'));

  /** Taxonomy subtopic ids, captured for the timeline cross-check. */
  const taxonomySubtopicIds = new Set<string>();
  /** The parsed taxonomy (for the pyq-weights prelims-completeness cross-check). */
  let taxonomyParsed: Taxonomy | undefined;
  /** The parsed timeline bank (for cross-checks after banks are parsed). */
  let timeline: import('./timeline-types').TimelineBank | undefined;
  /** The parsed pyq-weights doc (for cross-checks after the taxonomy is parsed). */
  let pyqWeights: import('./audit-types').PyqWeights | undefined;
  /** The parsed learning sequence (for the completeness/ordering cross-check). */
  let learningSequence: LearningSequence | undefined;
  /** The parsed units file (for the unit completeness/contiguity cross-check). */
  let units: Units | undefined;
  /** Parsed fact universes (content/facts/*.json) for the subtopic cross-check. */
  const factsFiles: { file: string; abs: string; data: FactsFile }[] = [];

  for (const abs of jsonFiles) {
    const file = toGlobPath(abs);
    if (file === manifestGlob) continue; // handled above

    // The taxonomy tree is not a content bank: validate it against its own
    // schema and EXCLUDE it from the orphan check (it is never in the manifest).
    if (file === taxonomyGlob) {
      const raw = readJson(abs);
      if (raw === undefined) continue;
      const parsed = TaxonomySchema.safeParse(raw);
      if (parsed.success) {
        taxonomyParsed = parsed.data;
        for (const s of parsed.data.subtopics) taxonomySubtopicIds.add(s.id);
        resultFor(file); // show as PASS
      } else {
        resultFor(file).errors.push(...formatIssues(parsed.error));
      }
      continue;
    }

    // The pyq-weights doc under content/audit/ is validated against its OWN
    // schema and EXCLUDED from the bank/orphan/manifest checks. Its cross-file
    // integrity (every key a taxonomy id; every prelims subtopic present) is
    // checked after the taxonomy is parsed.
    if (file === pyqWeightsGlob) {
      const raw = readJson(abs);
      if (raw === undefined) continue;
      const parsed = PyqWeightsSchema.safeParse(raw);
      if (parsed.success) {
        pyqWeights = parsed.data;
        resultFor(file); // show as PASS unless a cross-check fails below
      } else {
        resultFor(file).errors.push(...formatIssues(parsed.error));
      }
      continue;
    }

    // The audit maps under content/audit/ are validated against their OWN
    // schemas and EXCLUDED from the bank/orphan/manifest checks (they are the
    // independent-audit inputs, not content banks and not manifest entries).
    if (file === syllabusMapGlob || file === pyqMapGlob || file === alignExceptionsGlob || file === qualityWaiversGlob) {
      const raw = readJson(abs);
      if (raw === undefined) continue;
      const schema =
        file === syllabusMapGlob
          ? SyllabusMapSchema
          : file === pyqMapGlob
            ? PyqMapSchema
            : file === qualityWaiversGlob
              ? QualityWaiversSchema
              : AlignExceptionsSchema;
      const parsed = schema.safeParse(raw);
      if (parsed.success) {
        resultFor(file); // show as PASS
      } else {
        resultFor(file).errors.push(...formatIssues(parsed.error));
      }
      continue;
    }

    // Any other (unexpected) file under content/audit/ is advisory-only: it is
    // neither a bank nor a manifest entry, so don't fail the gate on it.
    if (file.startsWith('/content/audit/')) {
      resultFor(file).warnings.push(
        'unrecognised file under content/audit/ (not the syllabus-map, pyq-map, pyq-weights, align-exceptions or quality-waivers) — ignored by the audit',
      );
      continue;
    }

    // The timeline dataset under content/timeline/ is validated against its OWN
    // schema (kind:"timeline") and EXCLUDED from the bank/orphan/manifest checks
    // (it is not a content bank and not a manifest entry). Cross-file integrity
    // (subtopicIds, relatedMcqIds, unique ids) is checked after banks are parsed.
    if (file === timelineGlob) {
      const raw = readJson(abs);
      if (raw === undefined) continue;
      const parsed = TimelineBankSchema.safeParse(raw);
      if (parsed.success) {
        timeline = parsed.data;
        resultFor(file); // show as PASS unless a cross-check fails below
      } else {
        resultFor(file).errors.push(...formatIssues(parsed.error));
      }
      continue;
    }
    if (file.startsWith('/content/timeline/')) {
      resultFor(file).warnings.push(
        'unrecognised file under content/timeline/ (not events.json) — ignored',
      );
      continue;
    }

    // The learning sequence under content/plan/ is validated against its OWN
    // schema and EXCLUDED from the bank/orphan/manifest checks (it is a pure
    // per-subject study ORDER over taxonomy ids, not a content bank and not a
    // manifest entry). Cross-file integrity (every Prelims subtopic present
    // exactly once, prereqs earlier + resolvable, ids in taxonomy) is checked
    // after the taxonomy is parsed.
    if (file === planGlob) {
      const raw = readJson(abs);
      if (raw === undefined) continue;
      const parsed = LearningSequenceSchema.safeParse(raw);
      if (parsed.success) {
        learningSequence = parsed.data;
        resultFor(file); // show as PASS unless a cross-check fails below
      } else {
        resultFor(file).errors.push(...formatIssues(parsed.error));
      }
      continue;
    }
    // The units file under content/plan/ is validated against its OWN schema
    // and EXCLUDED from the bank/orphan/manifest checks. Cross-file integrity
    // (every non-MENT/CA Prelims subtopic present exactly once; each unit a
    // contiguous run of its subject's learning sequence; subject-unit order and
    // History chronology respected) is checked after the taxonomy + sequence.
    if (file === unitsGlob) {
      const raw = readJson(abs);
      if (raw === undefined) continue;
      const parsed = UnitsSchema.safeParse(raw);
      if (parsed.success) {
        units = parsed.data;
        resultFor(file); // show as PASS unless a cross-check fails below
      } else {
        resultFor(file).errors.push(...formatIssues(parsed.error));
      }
      continue;
    }
    if (file.startsWith('/content/plan/')) {
      resultFor(file).warnings.push(
        'unrecognised file under content/plan/ (not learning-sequence.json or units.json) \u2014 ignored',
      );
      continue;
    }

    // The per-subtopic FACT UNIVERSES under content/facts/ are validated against
    // their OWN schema and EXCLUDED from the bank/orphan/manifest checks (they
    // are the completeness contract, not content banks). The filename and the
    // taxonomy membership of `subtopicId` are cross-checked after the loop; the
    // taught/drilled mappings are the advisory `completeness` rule
    // (auditAllCompleteness), reported separately.
    if (file.startsWith('/content/facts/')) {
      const raw = readJson(abs);
      if (raw === undefined) continue;
      const parsed = FactsFileSchema.safeParse(raw);
      if (parsed.success) {
        factsFiles.push({ file, abs, data: parsed.data });
        resultFor(file); // show as PASS unless a cross-check fails below
      } else {
        resultFor(file).errors.push(...formatIssues(parsed.error));
      }
      continue;
    }

    // The CA freshness marker at content/current-affairs/meta.json is validated
    // against its OWN schema and EXCLUDED from the bank/orphan/manifest checks
    // (it is not a content bank and not a manifest entry).
    if (file === caMetaGlob) {
      const raw = readJson(abs);
      if (raw === undefined) continue;
      const parsed = CaMetaSchema.safeParse(raw);
      if (parsed.success) {
        resultFor(file); // show as PASS
      } else {
        resultFor(file).errors.push(...formatIssues(parsed.error));
      }
      continue;
    }

    contentGlobs.add(file);

    const raw = readJson(abs);
    if (raw === undefined) continue;

    const kind = (raw as { kind?: unknown } | null)?.kind;
    const result = resultFor(file);

    if (kind === 'syllabus') {
      const parsed = SyllabusBankSchema.safeParse(raw);
      if (parsed.success) {
        syllabus = parsed.data;
        syllabusFile = file;
      } else {
        result.errors.push(...formatIssues(parsed.error));
      }
    } else if (kind === 'mcq' || kind === 'notes' || kind === 'mains') {
      const parsed = ContentBankSchema.safeParse(raw);
      if (parsed.success) {
        parsedBanks.push({ file, bank: parsed.data });
      } else {
        result.errors.push(...formatIssues(parsed.error));
      }
    } else if (kind === 'cards') {
      // Curated flashcards — the size caps (front ≤160, back ≤200) are enforced
      // here as HARD errors via the schema's `.max` constraints.
      const parsed = CardsBankSchema.safeParse(raw);
      if (parsed.success) {
        curatedCount.set(file, parsed.data.items.length);
      } else {
        result.errors.push(...formatIssues(parsed.error));
      }
    } else if (kind === 'mindmap') {
      // Curated one-screen map — the size caps (root ≤40, ≤7 branches, label
      // ≤40, ≤4 leaves ≤60) are enforced here as HARD errors via the schema.
      const parsed = MindmapBankSchema.safeParse(raw);
      if (parsed.success) {
        curatedCount.set(file, parsed.data.branches.length);
      } else {
        result.errors.push(...formatIssues(parsed.error));
      }
    } else {
      result.errors.push(
        `unknown or missing 'kind' (expected mcq/notes/mains/syllabus, got ${JSON.stringify(kind)})`,
      );
    }
  }

  /* ----- 3. Cross-check (a): manifest ↔ disk (existence + counts) ---------- */

  // Actual item/node counts keyed by glob path, for count reconciliation.
  const actualCount = new Map<string, number>();
  for (const { file, bank } of parsedBanks) {
    actualCount.set(file, bank.items.length);
  }
  if (syllabus && syllabusFile) {
    actualCount.set(syllabusFile, syllabus.nodes.length);
  }
  // Curated cards/mindmap banks reconcile their manifest count from here.
  for (const [file, count] of curatedCount) {
    actualCount.set(file, count);
  }

  if (manifest) {
    for (const entry of manifest.banks) {
      const disk = toDiskPath(entry.path);
      if (!existsSync(disk)) {
        resultFor(manifestGlob).errors.push(
          `bank path listed in manifest does not exist on disk: ${entry.path}`,
        );
        continue;
      }
      const actual = actualCount.get(entry.path);
      if (actual === undefined) {
        // File exists but failed to parse above; the parse error already reported.
        continue;
      }
      if (actual !== entry.count) {
        resultFor(manifestGlob).errors.push(
          `count mismatch for ${entry.path}: manifest says ${entry.count}, actual ${actual}`,
        );
      }
    }

    /* ----- 4. Cross-check (b): orphans (on disk but not in manifest) ------- */

    const manifestPaths = new Set(manifest.banks.map((b) => b.path));
    for (const file of contentGlobs) {
      if (!manifestPaths.has(file)) {
        resultFor(file).errors.push(
          'orphan: file exists on disk but is not registered in content/manifest.json',
        );
      }
    }
  }

  /* ----- 5. Cross-check (c): MCQ answerIndex within options bounds --------- */

  // The schema already enforces this via .refine; we assert it explicitly so a
  // future schema regression cannot silently let a bad answerIndex through.
  for (const { file, bank } of parsedBanks) {
    if (bank.kind !== 'mcq') continue;
    for (const item of bank.items) {
      if (item.answerIndex >= item.options.length) {
        resultFor(file).errors.push(
          `item ${item.id}: answerIndex ${item.answerIndex} is out of range (options length ${item.options.length})`,
        );
      }
    }
  }

  /* ----- 6. Cross-check (d): unique item ids across all banks -------------- */

  const idOwners = new Map<string, string[]>();
  for (const { file, bank } of parsedBanks) {
    for (const item of bank.items) {
      const owners = idOwners.get(item.id) ?? [];
      owners.push(file);
      idOwners.set(item.id, owners);
    }
  }
  for (const [id, owners] of idOwners) {
    if (owners.length > 1) {
      for (const file of owners) {
        const others = owners.filter((o) => o !== file);
        resultFor(file).errors.push(
          `duplicate item id '${id}' also present in: ${[...new Set(others)].join(', ')}`,
        );
      }
    }
  }

  /* ----- 7. Cross-check (e): syllabusRef resolution (warning) -------------- */

  const syllabusNodeIds = new Set<string>();
  if (syllabus && syllabusFile) {
    const seen = new Set<string>();
    for (const node of syllabus.nodes) {
      if (seen.has(node.id)) {
        resultFor(syllabusFile).errors.push(
          `duplicate syllabus node id '${node.id}'`,
        );
      }
      seen.add(node.id);
      syllabusNodeIds.add(node.id);
    }
  }
  for (const { file, bank } of parsedBanks) {
    for (const item of bank.items) {
      const ref = item.syllabusRef;
      if (ref !== undefined && !syllabusNodeIds.has(ref)) {
        resultFor(file).warnings.push(
          `item ${item.id}: syllabusRef '${ref}' does not match any syllabus node id`,
        );
      }
    }
  }

  /* ----- 8. Cross-check (f): timeline integrity --------------------------- */

  // The timeline links to taxonomy subtopics and to real MCQ ids; verify both
  // resolve, and that event/period ids are unique and periods are well-ordered.
  if (timeline) {
    const mcqIds = new Set<string>();
    for (const { bank } of parsedBanks) {
      if (bank.kind === 'mcq') for (const item of bank.items) mcqIds.add(item.id);
    }
    const tl = resultFor(timelineGlob);
    const evIds = new Set<string>();
    for (const ev of timeline.events) {
      if (evIds.has(ev.id)) tl.errors.push(`duplicate timeline event id '${ev.id}'`);
      evIds.add(ev.id);
      for (const sid of ev.subtopicIds) {
        if (!taxonomySubtopicIds.has(sid)) {
          tl.errors.push(`event ${ev.id}: subtopicId '${sid}' is not in the taxonomy`);
        }
      }
      for (const mid of ev.relatedMcqIds) {
        if (!mcqIds.has(mid)) {
          tl.errors.push(`event ${ev.id}: relatedMcqId '${mid}' matches no MCQ item id`);
        }
      }
    }
    const pIds = new Set<string>();
    for (const p of timeline.periods) {
      if (pIds.has(p.id)) tl.errors.push(`duplicate timeline period id '${p.id}'`);
      pIds.add(p.id);
      if (p.endYear < p.startYear) {
        tl.errors.push(`period ${p.id}: endYear ${p.endYear} < startYear ${p.startYear}`);
      }
      for (const sid of p.subtopicIds) {
        if (!taxonomySubtopicIds.has(sid)) {
          tl.errors.push(`period ${p.id}: subtopicId '${sid}' is not in the taxonomy`);
        }
      }
    }
  } else if (existsSync(join(CONTENT_DIR, 'timeline', 'events.json'))) {
    // File exists but failed to parse above; the parse error is already reported.
  }

  /* ----- 9. Cross-check (g): pyq-weights integrity ------------------------ */

  // The pyq-weights doc drives the planner's FAST-pass ordering + top-25%
  // protection, so it must (a) key only real taxonomy subtopic ids, and (b)
  // carry a weight for EVERY Prelims-track subtopic (0 allowed) so no in-scope
  // topic silently defaults to weight 0 through a missing entry.
  if (pyqWeights) {
    const pw = resultFor(pyqWeightsGlob);
    for (const id of Object.keys(pyqWeights.weights)) {
      if (!taxonomySubtopicIds.has(id)) {
        pw.errors.push(`pyq-weights key '${id}' is not a taxonomy subtopic id`);
      }
    }
    if (taxonomyParsed) {
      const subjectTrack = new Map(
        taxonomyParsed.subjects.map((s) => [s.code, s.track] as const),
      );
      for (const s of taxonomyParsed.subtopics) {
        const track = s.track ?? subjectTrack.get(s.subjectCode);
        if (
          (track === 'paper1' || track === 'paper2') &&
          !(s.id in pyqWeights.weights)
        ) {
          pw.errors.push(`prelims subtopic '${s.id}' has no pyq-weights entry`);
        }
      }
    }
  } else if (existsSync(join(CONTENT_DIR, 'audit', 'pyq-weights.json'))) {
    // File exists but failed to parse above; the parse error is already reported.
  }

  /* ----- 10. Cross-check (h): learning-sequence integrity ----------------- */

  // The learning sequence must (a) key only real taxonomy subtopic ids, (b) list
  // EVERY Prelims-track subtopic of each subject EXACTLY ONCE, and (c) reference
  // prereqs that appear EARLIER in the same subject's list (so it is a valid
  // topological study order — no forward or cyclic dependency).
  if (learningSequence && taxonomyParsed) {
    const ls = resultFor(planGlob);
    const subjectTrack = new Map(
      taxonomyParsed.subjects.map((s) => [s.code, s.track] as const),
    );
    const isPrelims = (s: (typeof taxonomyParsed.subtopics)[number]): boolean => {
      const track = s.track ?? subjectTrack.get(s.subjectCode);
      return track === 'paper1' || track === 'paper2';
    };
    // Expected Prelims subtopic ids per subject, from the taxonomy.
    const expectedBySubject = new Map<string, Set<string>>();
    for (const s of taxonomyParsed.subtopics) {
      if (!isPrelims(s)) continue;
      const set = expectedBySubject.get(s.subjectCode) ?? new Set<string>();
      set.add(s.id);
      expectedBySubject.set(s.subjectCode, set);
    }

    for (const [subject, steps] of Object.entries(learningSequence.subjects)) {
      const expected = expectedBySubject.get(subject) ?? new Set<string>();
      const seen = new Set<string>();
      const seenAt = new Map<string, number>();

      steps.forEach((step, idx) => {
        // (a) id resolves to a taxonomy subtopic in THIS subject and is Prelims.
        const meta = taxonomyParsed!.subtopics.find((s) => s.id === step.id);
        if (!meta) {
          ls.errors.push(`${subject}: id '${step.id}' is not in the taxonomy`);
        } else if (meta.subjectCode !== subject) {
          ls.errors.push(
            `${subject}: id '${step.id}' belongs to subject ${meta.subjectCode}, not ${subject}`,
          );
        } else if (!isPrelims(meta)) {
          ls.errors.push(
            `${subject}: id '${step.id}' is a Mains-track subtopic (excluded from the Prelims sequence)`,
          );
        }
        // (b) no duplicates.
        if (seen.has(step.id)) {
          ls.errors.push(`${subject}: id '${step.id}' listed more than once`);
        }
        seen.add(step.id);
        seenAt.set(step.id, idx);
        // (c) every prereq appears EARLIER in this same list.
        for (const p of step.prereqs) {
          const at = seenAt.get(p);
          if (at === undefined) {
            ls.errors.push(
              `${subject}: '${step.id}' prereq '${p}' does not appear earlier in the list`,
            );
          } else if (at >= idx) {
            ls.errors.push(
              `${subject}: '${step.id}' prereq '${p}' is not strictly earlier`,
            );
          }
        }
      });

      // (b) completeness: every expected Prelims subtopic present exactly once.
      for (const id of expected) {
        if (!seen.has(id)) {
          ls.errors.push(`${subject}: missing Prelims subtopic '${id}'`);
        }
      }
      // (a) no extra ids beyond the subject's Prelims set (dupes/foreign already
      // reported above; this catches an in-taxonomy id from the wrong track).
      for (const id of seen) {
        if (!expected.has(id)) {
          // Only add when it wasn't already flagged as unknown/foreign/mains.
          const meta = taxonomyParsed.subtopics.find((s) => s.id === id);
          if (meta && meta.subjectCode === subject && isPrelims(meta)) {
            // expected should contain it — defensive; unreachable in practice.
            ls.errors.push(`${subject}: unexpected extra id '${id}'`);
          }
        }
      }
    }
  } else if (existsSync(join(CONTENT_DIR, 'plan', 'learning-sequence.json'))) {
    // File exists but failed to parse (or taxonomy failed) above; already reported.
  }

  /* ----- 11. Cross-check (i): weekly-units integrity ---------------------- */

  // The units file must (a) key only real taxonomy Prelims subtopic ids of the
  // declared subject, (b) cover EVERY non-MENT/CA Prelims subtopic EXACTLY ONCE
  // across all units, (c) list each unit's topicIds as a CONTIGUOUS run of that
  // subject's learning sequence, (d) keep each subject's units in sequence order
  // and the HISTORY units in chronological (sequence) order relative to one
  // another, and (e) begin with a History unit (day-1 orientation is History).
  if (units && taxonomyParsed) {
    const us = resultFor(unitsGlob);
    const subjectTrack = new Map(
      taxonomyParsed.subjects.map((s) => [s.code, s.track] as const),
    );
    const metaById = new Map(taxonomyParsed.subtopics.map((s) => [s.id, s] as const));
    const isPrelims = (s: (typeof taxonomyParsed.subtopics)[number]): boolean => {
      const track = s.track ?? subjectTrack.get(s.subjectCode);
      return track === 'paper1' || track === 'paper2';
    };
    // Expected = every Prelims subtopic whose subject is one the units carry
    // (HIST/POL/ECON/GEO/SCI — MENT + CA are their own lanes, excluded).
    const UNIT_SUBJECTS = new Set(['HIST', 'POL', 'ECON', 'GEO', 'SCI']);
    const expected = new Set<string>();
    for (const s of taxonomyParsed.subtopics) {
      if (isPrelims(s) && UNIT_SUBJECTS.has(s.subjectCode)) expected.add(s.id);
    }

    // (a) + id/subject validity, and build the seen multiset.
    const seenCount = new Map<string, number>();
    for (const unit of units.units) {
      for (const id of unit.topicIds) {
        seenCount.set(id, (seenCount.get(id) ?? 0) + 1);
        const meta = metaById.get(id);
        if (!meta) {
          us.errors.push(`${unit.id}: topic '${id}' is not in the taxonomy`);
        } else if (meta.subjectCode !== unit.subjectCode) {
          us.errors.push(
            `${unit.id}: topic '${id}' belongs to ${meta.subjectCode}, not the unit's subject ${unit.subjectCode}`,
          );
        } else if (!isPrelims(meta)) {
          us.errors.push(`${unit.id}: topic '${id}' is not a Prelims subtopic`);
        }
      }
    }
    // (b) exactly-once completeness over the expected set.
    for (const [id, n] of seenCount) {
      if (n > 1) us.errors.push(`units: subtopic '${id}' appears ${n} times across units (must be once)`);
      if (!expected.has(id) && metaById.has(id)) {
        us.errors.push(`units: subtopic '${id}' is MENT/CA or out of scope and must not be unitised`);
      }
    }
    for (const id of expected) {
      if (!seenCount.has(id)) us.errors.push(`units: missing Prelims subtopic '${id}' (every non-MENT/CA topic must be in a unit)`);
    }

    // (c) contiguity: each unit is a contiguous slice of its subject's sequence.
    if (learningSequence) {
      const seqOf = (code: string): string[] =>
        (learningSequence!.subjects as Record<string, { id: string }[]>)[code]?.map((st) => st.id) ?? [];
      for (const unit of units.units) {
        const seq = seqOf(unit.subjectCode);
        const start = seq.indexOf(unit.topicIds[0] ?? '');
        if (start < 0) {
          // first id not in sequence — already reported as a bad id above.
          continue;
        }
        for (let i = 0; i < unit.topicIds.length; i += 1) {
          if (seq[start + i] !== unit.topicIds[i]) {
            us.errors.push(
              `${unit.id}: topicIds are not a contiguous run of the ${unit.subjectCode} learning sequence (at '${unit.topicIds[i]}')`,
            );
            break;
          }
        }
      }
      // (d) subject units in sequence order; HISTORY units chronological too.
      const lastSeqIdxBySubject = new Map<string, number>();
      const histOrder: number[] = [];
      for (const unit of units.units) {
        const seq = seqOf(unit.subjectCode);
        const idx = seq.indexOf(unit.topicIds[0] ?? '');
        if (idx < 0) continue;
        const prev = lastSeqIdxBySubject.get(unit.subjectCode);
        if (prev !== undefined && idx <= prev) {
          us.errors.push(`units: ${unit.subjectCode} unit '${unit.id}' is out of learning-sequence order`);
        }
        lastSeqIdxBySubject.set(unit.subjectCode, idx);
        if (unit.subjectCode === 'HIST') histOrder.push(idx);
      }
      for (let i = 1; i < histOrder.length; i += 1) {
        if (histOrder[i]! <= histOrder[i - 1]!) {
          us.errors.push('units: History units are not in chronological (learning-sequence) order');
          break;
        }
      }
    }
    // (e) the first unit is History (day-1 orientation studies History).
    if (units.units[0]?.subjectCode !== 'HIST') {
      us.errors.push(`units: the first unit must be History (got ${units.units[0]?.subjectCode ?? 'none'})`);
    }
  } else if (existsSync(join(CONTENT_DIR, 'plan', 'units.json'))) {
    // File exists but failed to parse (or taxonomy failed) above; already reported.
  }

  /* ----- 12. Cross-check (j): fact-universe files ------------------------- */

  // Each facts file must be named after its subtopicId and key a real taxonomy
  // subtopic, so the completeness audit can never silently measure nothing.
  for (const { file, abs, data } of factsFiles) {
    const r = resultFor(file);
    const base = abs.split(sep).pop() ?? '';
    if (base !== `${data.subtopicId}.json`) {
      r.errors.push(`facts file must be named '${data.subtopicId}.json' (its subtopicId), got '${base}'`);
    }
    if (taxonomyParsed && !taxonomySubtopicIds.has(data.subtopicId)) {
      r.errors.push(`facts subtopicId '${data.subtopicId}' is not a taxonomy subtopic id`);
    }
  }

  /* ----- Finalise ---------------------------------------------------------- */

  for (const r of results) {
    r.ok = r.errors.length === 0;
  }
  // Stable, readable ordering: manifest first, then banks by path.
  results.sort((a, b) => {
    if (a.file === manifestGlob) return -1;
    if (b.file === manifestGlob) return 1;
    return a.file.localeCompare(b.file);
  });
  return results;
}

/* ========================================================================== */
/* Content-formatting LINT                                                     */
/*                                                                             */
/* A readability lint over authored PROSE (note bodies + keyPoints, MCQ        */
/* question/options/explanation, curated card front/back, and mind-map leaves).*/
/* It is advisory: `validate:content` prints each hit as a WARNING and counts  */
/* it, so finalizers can require the count to reach 0, and a `--strict` run     */
/* promotes the hits to a non-zero exit. The rules deliberately mirror the      */
/* reader's pain points: textbook JARGON tokens, BARE carets (exponents written */
/* without braces), broken markdown TABLES, and a short OBVIOUS-TYPO list.      */
/* ========================================================================== */

/** The four lint rule families. */
export type LintRule = 'jargon' | 'bare-caret' | 'table-shape' | 'typo';

/** One lint hit, carrying enough context for a content agent to fix it. */
export interface LintFinding {
  /** Glob-style bank path, e.g. `/content/mental-ability/.../notes-....json`. */
  file: string;
  /** The item id (or mind-map branch label) the text belongs to. */
  itemId: string;
  /** Which field held the offending text, e.g. `body`, `options[2]`, `front`. */
  field: string;
  /** The rule that fired. */
  rule: LintRule;
  /** A short, single-line excerpt around the match. */
  snippet: string;
}

/**
 * JARGON tokens that read as textbook shorthand in running prose. Each is a
 * global regex so every occurrence is reported. The dotted abbreviations use a
 * LEADING `\b` only (they already end in a period, where a trailing `\b` would
 * fail against a following space), with a negative word-char lookahead so they
 * are not matched mid-token. @internal
 */
const JARGON_RULES: readonly RegExp[] = [
  /\biff\b/g,
  /⇔/g,
  /⇒/g,
  /∴/g,
  /∵/g,
  /≡/g,
  /\bw\.r\.t\.(?!\w)/g,
  /\bs\.t\.(?!\w)/g,
];

/** A BARE caret: an exponent written without braces, e.g. `2^80`, `10^-4`. @internal */
const BARE_CARET_RE = /\w\^(?!\{)/g;

/** The short OBVIOUS-TYPO allow… denylist (case-insensitive, whole words). @internal */
const TYPO_RE = /\b(?:teh|recieve|seperate|occured|acheive|untill|wich)\b/gi;

/** A GFM table separator row, e.g. `|---|:--:|` (must contain a dash). @internal */
function isLintTableSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{1,}:?\s*(?:\|\s*:?-{1,}:?\s*)*\|?\s*$/.test(line) && line.includes('-');
}

/** Split a pipe-table row into trimmed cells, tolerating optional edge pipes. @internal */
function lintTableCells(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}

/** A short, single-line excerpt around `[index, index+length)`. @internal */
function snippetAt(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 24);
  const end = Math.min(text.length, index + length + 24);
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Scan one text value for every lint rule and return the hits (rule + snippet).
 * Pure and side-effect-free, so each rule is unit-testable in isolation.
 */
export function lintText(text: string): { rule: LintRule; snippet: string }[] {
  const found: { rule: LintRule; snippet: string }[] = [];

  for (const re of JARGON_RULES) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      found.push({ rule: 'jargon', snippet: snippetAt(text, m.index, m[0].length) });
      if (m[0].length === 0) re.lastIndex += 1; // defensive (never for these)
    }
  }

  BARE_CARET_RE.lastIndex = 0;
  for (let m = BARE_CARET_RE.exec(text); m !== null; m = BARE_CARET_RE.exec(text)) {
    found.push({ rule: 'bare-caret', snippet: snippetAt(text, m.index, m[0].length) });
  }

  TYPO_RE.lastIndex = 0;
  for (let m = TYPO_RE.exec(text); m !== null; m = TYPO_RE.exec(text)) {
    found.push({ rule: 'typo', snippet: snippetAt(text, m.index, m[0].length) });
  }

  // TABLE-SHAPE: for each markdown table, flag a separator whose column count
  // differs from the header, and any body row whose cell count differs from it.
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const header = lines[i];
    const sep = lines[i + 1];
    if (
      header === undefined ||
      !header.includes('|') ||
      sep === undefined ||
      !isLintTableSeparator(sep)
    ) {
      continue;
    }
    const cols = lintTableCells(header).length;
    const sepCols = lintTableCells(sep).length;
    if (sepCols !== cols) {
      found.push({
        rule: 'table-shape',
        snippet: `header ${cols} cols vs separator ${sepCols} cols: ${header.trim()}`,
      });
    }
    let j = i + 2;
    for (; j < lines.length; j += 1) {
      const row = lines[j];
      if (row === undefined || row.trim() === '' || !row.includes('|')) break;
      const n = lintTableCells(row).length;
      if (n !== cols) {
        found.push({
          rule: 'table-shape',
          snippet: `row ${n} cells, expected ${cols}: ${row.trim()}`,
        });
      }
    }
    i = j - 1;
  }

  return found;
}

/**
 * The prose fields of a single bank, as `(itemId, field, text)` tuples, per the
 * lint scope: note `body` + `keyPoints`, MCQ `question`/`options`/`explanation`,
 * curated card `front`/`back`, and mind-map leaves. @internal
 */
function lintTargets(bank: unknown): { itemId: string; field: string; text: string }[] {
  const out: { itemId: string; field: string; text: string }[] = [];
  const b = bank as { kind?: string; items?: unknown[]; branches?: unknown[]; root?: string };

  if (b.kind === 'notes' && Array.isArray(b.items)) {
    for (const it of b.items as Array<{ id?: string; body?: string; keyPoints?: string[] }>) {
      const id = it.id ?? '(no id)';
      if (typeof it.body === 'string') out.push({ itemId: id, field: 'body', text: it.body });
      if (Array.isArray(it.keyPoints)) {
        it.keyPoints.forEach((kp, k) => {
          if (typeof kp === 'string') out.push({ itemId: id, field: `keyPoints[${k}]`, text: kp });
        });
      }
    }
  } else if (b.kind === 'mcq' && Array.isArray(b.items)) {
    for (const it of b.items as Array<{
      id?: string;
      question?: string;
      options?: string[];
      explanation?: string;
      statements?: string[];
      assertion?: string;
      reason?: string;
      match?: { left?: { text?: string }[]; right?: { text?: string }[] };
    }>) {
      const id = it.id ?? '(no id)';
      if (typeof it.question === 'string') out.push({ itemId: id, field: 'question', text: it.question });
      // Structured stem fields are learner-facing text too — lint them.
      it.statements?.forEach((st, k) => out.push({ itemId: id, field: `statements[${k}]`, text: st }));
      if (typeof it.assertion === 'string') out.push({ itemId: id, field: 'assertion', text: it.assertion });
      if (typeof it.reason === 'string') out.push({ itemId: id, field: 'reason', text: it.reason });
      for (const side of ['left', 'right'] as const) {
        it.match?.[side]?.forEach((e, k) => {
          if (typeof e.text === 'string') out.push({ itemId: id, field: `match.${side}[${k}]`, text: e.text });
        });
      }
      if (Array.isArray(it.options)) {
        it.options.forEach((opt, k) => {
          if (typeof opt === 'string') out.push({ itemId: id, field: `options[${k}]`, text: opt });
        });
      }
      if (typeof it.explanation === 'string') {
        out.push({ itemId: id, field: 'explanation', text: it.explanation });
      }
    }
  } else if (b.kind === 'cards' && Array.isArray(b.items)) {
    for (const it of b.items as Array<{ id?: string; front?: string; back?: string }>) {
      const id = it.id ?? '(no id)';
      if (typeof it.front === 'string') out.push({ itemId: id, field: 'front', text: it.front });
      if (typeof it.back === 'string') out.push({ itemId: id, field: 'back', text: it.back });
    }
  } else if (b.kind === 'mindmap' && Array.isArray(b.branches)) {
    (b.branches as Array<{ label?: string; leaves?: string[] }>).forEach((br, bi) => {
      const label = br.label ?? `branch[${bi}]`;
      if (Array.isArray(br.leaves)) {
        br.leaves.forEach((leaf, li) => {
          if (typeof leaf === 'string') {
            out.push({ itemId: label, field: `branches[${bi}].leaves[${li}]`, text: leaf });
          }
        });
      }
    });
  }
  return out;
}

/**
 * Run the content-formatting lint over every bank on disk and return a flat list
 * of findings. Shared by the `validate:content` reporter (as warnings) and by
 * the Vitest suite. Never throws for content problems — unparseable JSON is
 * simply skipped (the schema gate reports it separately).
 */
export function lintAllContent(): LintFinding[] {
  const findings: LintFinding[] = [];
  for (const abs of walkJsonFiles(CONTENT_DIR)) {
    const file = toGlobPath(abs);
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(abs, 'utf8')) as unknown;
    } catch {
      continue; // the schema gate reports unparseable JSON
    }
    for (const { itemId, field, text } of lintTargets(raw)) {
      for (const { rule, snippet } of lintText(text)) {
        findings.push({ file, itemId, field, rule, snippet });
      }
    }
  }
  findings.sort((a, b) => a.file.localeCompare(b.file) || a.itemId.localeCompare(b.itemId));
  return findings;
}

/* ========================================================================== */
/* EXPLANATION-STRUCTURE lint                                                  */
/*                                                                             */
/* An OBJECTIVE lint over authored NOTE bodies, checking that explanations are */
/* organised the way the GOLD-EXEMPLAR requires (idea → slow way → formula),   */
/* rather than left as a bare rule. Like the formatting lint it is advisory:   */
/* `validate:content` prints each hit as a WARNING and counts it per file, and */
/* it is deliberately NOT wired into `npm run check` as a hard gate yet.       */
/*                                                                             */
/* Three rule families (see the task spec / GOLD-EXEMPLAR.md):                 */
/*   1. MENT notes (subjectCode MENT, excluding items tagged `mains`): every   */
/*      body must be organised into `### ` sections; each section must carry   */
/*      the seven bold sub-headings and be >= 220 words. A note with NO `### `  */
/*      section but > 0 formula characters is THIN_RULE (a rule dumped with no  */
/*      explanation around it).                                                */
/*   2. Theory notes (HIST/POL/ECON/GEO/SCI/CA, excluding `mains`): each note   */
/*      must contain 'In one line' + 'TL;DR' + >= 1 of 'The story' /            */
/*      'Terms explained' → else MISSING_STRUCTURE.                            */
/*   3. Any note using a hard symbol (⌊ ⌈ ∑ ∏ ≡ or the word `mod`) must         */
/*      explain it with the phrase 'means' inside the SAME `### ` section →     */
/*      else UNEXPLAINED_SYMBOL.                                               */
/* ========================================================================== */

/** The structure-lint flags. @see auditAllStructure */
export type StructureFlag =
  | 'THIN_RULE'
  | 'MISSING_SUBHEADING'
  | 'SHORT_SECTION'
  | 'MISSING_STRUCTURE'
  | 'UNEXPLAINED_SYMBOL';

/** One structure-lint hit against a single note item. */
export interface StructureFinding {
  /** Glob-style bank path. */
  file: string;
  /** The note item id. */
  itemId: string;
  /** The owning subject code (MENT / HIST / …). */
  subjectCode: string;
  /** Which structural rule fired. */
  flag: StructureFlag;
  /** Human-readable detail (which section / sub-heading / word count). */
  detail: string;
}

/** The seven required bold sub-headings for a MENT `### ` section (case-insensitive, substring). @internal */
const MENT_SUBHEADINGS: readonly string[] = [
  'The idea in one sentence',
  'Do it the slow way first',
  'What the symbols mean',
  'The formula',
  'Exam-level example',
  'Common traps',
  'TL;DR',
];

/** Minimum words per MENT `### ` section. @internal */
const MENT_MIN_SECTION_WORDS = 220;

/** The theory subject codes rule 2 applies to. @internal */
const THEORY_SUBJECTS: ReadonlySet<string> = new Set([
  'HIST',
  'POL',
  'ECON',
  'GEO',
  'SCI',
  'CA',
]);

/** A note-like value — the only fields the structure lint reads. */
export interface StructureNoteLike {
  subjectCode: string;
  body: string;
  tags?: string[];
}

/** Count the formula characters/tokens (⌊ ⌈ = ÷ × ^{ mod) in `text`. @internal */
function formulaCharCount(text: string): number {
  let n = 0;
  for (const ch of ['⌊', '⌈', '=', '÷', '×']) {
    n += text.split(ch).length - 1;
  }
  n += text.split('^{').length - 1;
  n += (text.match(/\bmod\b/g) ?? []).length;
  return n;
}

/** Count whitespace-delimited words in `text`. @internal */
function wordCount(text: string): number {
  return (text.trim().match(/\S+/g) ?? []).length;
}

/** True when any `**bold**` span in `text` contains `phrase` (case-insensitive). @internal */
function hasBoldSubheading(text: string, phrase: string): boolean {
  const needle = phrase.toLowerCase();
  const re = /\*\*([^*]+)\*\*/g;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    if ((m[1] ?? '').toLowerCase().includes(needle)) return true;
  }
  return false;
}

/**
 * Split a note body into `### ` segments. The text BEFORE the first `### ` is
 * returned as a `(preamble)` segment so the symbol check (rule 3) can still
 * reason about "the same section" even when a note has no headings at all.
 * @internal
 */
function noteSegments(body: string): { heading: string; text: string }[] {
  const out: { heading: string; text: string }[] = [];
  const lines = body.split('\n');
  let heading = '(preamble)';
  let buf: string[] = [];
  const flush = (): void => {
    if (buf.length > 0) out.push({ heading, text: buf.join('\n') });
    buf = [];
  };
  for (const line of lines) {
    if (/^### /.test(line)) {
      flush();
      heading = line.replace(/^###\s+/, '').trim();
      buf = [line];
    } else {
      buf.push(line);
    }
  }
  flush();
  return out;
}

/** The `### ` sections of a body (excludes any leading preamble). @internal */
function noteSections(body: string): { heading: string; text: string }[] {
  return noteSegments(body).filter((s) => s.heading !== '(preamble)');
}

/**
 * Audit ONE note item against the three structure rules and return its hits.
 * Pure and side-effect-free, so every rule is unit-testable with a fixture.
 */
export function lintNoteStructure(
  note: StructureNoteLike,
): { flag: StructureFlag; detail: string }[] {
  const findings: { flag: StructureFlag; detail: string }[] = [];
  const isMains = note.tags?.includes('mains') ?? false;
  const body = note.body ?? '';

  /* ----- Rule 1: MENT notes ------------------------------------------------ */
  if (note.subjectCode === 'MENT' && !isMains) {
    const sections = noteSections(body);
    if (sections.length === 0) {
      if (formulaCharCount(body) > 0) {
        findings.push({
          flag: 'THIN_RULE',
          detail: 'no `### ` section but contains formula characters (bare rule, no explanation)',
        });
      }
    } else {
      for (const sec of sections) {
        const missing = MENT_SUBHEADINGS.filter((h) => !hasBoldSubheading(sec.text, h));
        if (missing.length > 0) {
          findings.push({
            flag: 'MISSING_SUBHEADING',
            detail: `### ${sec.heading}: missing bold sub-heading(s) ${missing.map((m) => `'${m}'`).join(', ')}`,
          });
        }
        const words = wordCount(sec.text);
        if (words < MENT_MIN_SECTION_WORDS) {
          findings.push({
            flag: 'SHORT_SECTION',
            detail: `### ${sec.heading}: ${words} words (< ${MENT_MIN_SECTION_WORDS})`,
          });
        }
      }
    }
  }

  /* ----- Rule 2: theory notes --------------------------------------------- */
  if (THEORY_SUBJECTS.has(note.subjectCode) && !isMains) {
    const hasInOneLine = /in one line/i.test(body);
    const hasTldr = /tl;dr/i.test(body);
    const hasStoryOrTerms = /the story/i.test(body) || /terms explained/i.test(body);
    if (!(hasInOneLine && hasTldr && hasStoryOrTerms)) {
      const missing: string[] = [];
      if (!hasInOneLine) missing.push("'In one line'");
      if (!hasTldr) missing.push("'TL;DR'");
      if (!hasStoryOrTerms) missing.push("one of 'The story' / 'Terms explained'");
      findings.push({
        flag: 'MISSING_STRUCTURE',
        detail: `missing ${missing.join(', ')}`,
      });
    }
  }

  /* ----- Rule 3: unexplained symbols (all notes) -------------------------- */
  for (const seg of noteSegments(body)) {
    const usesSymbol = /[⌊⌈∑∏≡]/.test(seg.text) || /\bmod\b/.test(seg.text);
    if (usesSymbol && !/means/i.test(seg.text)) {
      findings.push({
        flag: 'UNEXPLAINED_SYMBOL',
        detail: `${seg.heading === '(preamble)' ? '(preamble)' : `### ${seg.heading}`}: uses ⌊/⌈/∑/∏/≡/'mod' without the word 'means' in the same section`,
      });
    }
  }

  return findings;
}

/**
 * Run the structure lint over every note bank on disk and return a flat list of
 * findings. Shared by the `validate:content` reporter (as warnings) and by the
 * Vitest suite. Never throws — unparseable JSON is skipped (the schema gate
 * reports it separately). Only `kind:"notes"` banks are scanned.
 */
export function auditAllStructure(): StructureFinding[] {
  const findings: StructureFinding[] = [];
  for (const abs of walkJsonFiles(CONTENT_DIR)) {
    const file = toGlobPath(abs);
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(abs, 'utf8')) as unknown;
    } catch {
      continue; // the schema gate reports unparseable JSON
    }
    const bank = raw as { kind?: unknown; subjectCode?: unknown; items?: unknown };
    if (bank.kind !== 'notes' || !Array.isArray(bank.items)) continue;
    for (const rawItem of bank.items) {
      const it = rawItem as {
        id?: unknown;
        subjectCode?: unknown;
        body?: unknown;
        tags?: unknown;
      };
      if (typeof it.body !== 'string') continue;
      const subjectCode =
        typeof it.subjectCode === 'string'
          ? it.subjectCode
          : typeof bank.subjectCode === 'string'
            ? bank.subjectCode
            : '(unknown)';
      const tags = Array.isArray(it.tags)
        ? it.tags.filter((t): t is string => typeof t === 'string')
        : undefined;
      const itemId = typeof it.id === 'string' ? it.id : '(no id)';
      for (const { flag, detail } of lintNoteStructure({ subjectCode, body: it.body, tags })) {
        findings.push({ file, itemId, subjectCode, flag, detail });
      }
    }
  }
  findings.sort(
    (a, b) =>
      a.file.localeCompare(b.file) ||
      a.itemId.localeCompare(b.itemId) ||
      a.flag.localeCompare(b.flag),
  );
  return findings;
}

/* -------------------------------------------------------------------------- */
/* Question-format + taught-before-tested ALIGNMENT audit (VALIDATE_ALIGN=1)   */
/* -------------------------------------------------------------------------- */

/**
 * Alignment rule ids:
 * - `structure-missing`  (a) stem reads like match / statements / A-R but the
 *                        structured field is absent;
 * - `structure-integrity`(b) structured lists incomplete / option keys or
 *                        statement numbers that do not exist;
 * - `noteref-missing`    (c) no `noteRef`;
 * - `noteref-invalid`    (c) `noteRef` is not a note of the same subtopic or of
 *                        an earlier subtopic in `content/plan/learning-sequence.json`;
 * - `not-taught`         (d) ANSWER-TAUGHT heuristic: significant tokens of the
 *                        correct answer are absent from the teaching note(s) —
 *                        reported as "possibly not taught". Justified false
 *                        positives are listed in `content/audit/align-exceptions.json`;
 * - `exception-stale`    an exceptions entry names an unknown MCQ or no longer
 *                        suppresses a `not-taught` finding (remove it).
 */
export type AlignRule =
  | 'structure-missing'
  | 'structure-integrity'
  | 'noteref-missing'
  | 'noteref-invalid'
  | 'not-taught'
  | 'exception-stale';

/** One alignment finding. */
export interface AlignFinding {
  file: string;
  itemId: string;
  subjectCode: string;
  rule: AlignRule;
  detail: string;
}

/**
 * Is the alignment audit switched on? Always under `--strict` (so `npm run check`
 * gates it permanently); otherwise only with `VALIDATE_ALIGN=1`.
 */
export function alignEnabled(env: Record<string, string | undefined> = process.env, strict = false): boolean {
  return strict || env.VALIDATE_ALIGN === '1';
}

/**
 * Read the justified `not-taught` exceptions (itemId → why) from
 * `content/audit/align-exceptions.json`. Missing or schema-invalid file → empty
 * map (the schema error itself is reported by `validateAllContent`).
 */
export function loadAlignExceptions(): Map<string, string> {
  const out = new Map<string, string>();
  const path = join(CONTENT_DIR, 'audit', 'align-exceptions.json');
  if (!existsSync(path)) return out;
  try {
    const parsed = AlignExceptionsSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')) as unknown);
    if (parsed.success) for (const e of parsed.data.exceptions) out.set(e.itemId, e.why);
  } catch {
    /* unreadable JSON is reported by validateAllContent */
  }
  return out;
}

/** Words never counted as "significant" by the answer-taught heuristic. */
const ALIGN_STOPWORDS = new Set(
  (
    'the a an and or of to in on at by for from with as is are was were be been being this that these those ' +
    'its it their his her which who whom whose what when where why how not no nor only both neither either ' +
    'all any each other than then into over under about after before between during also more most less ' +
    'such same very can could may might must shall should will would has have had does did done first second ' +
    'third fourth one two three four five correct statement statements above following given true false ' +
    'reason assertion explanation india indian state states government national scheme ' +
    'there they them were what while upon within without whereas being made make known called'
  ).split(/\s+/),
);

/** Normalise text for token matching: lower-case, unify dashes/quotes, collapse space. */
function alignNormalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‐-―−]/g, '-')
    .replace(/[‘’`]/g, "'")
    .replace(/\*\*|__|[*_#>|]/g, ' ')
    .replace(/\s+/g, ' ');
}

/**
 * Significant tokens of a fact string: words of 4+ letters (light plural /
 * possessive stripping) and numbers of 2+ digits (years, sizes, ranks), minus
 * stopwords.
 */
export function significantTokens(text: string): string[] {
  const out = new Set<string>();
  for (const raw of alignNormalise(text).split(/[^\p{L}\p{N}.]+/u)) {
    const t = raw.replace(/^\.+|\.+$/g, '');
    if (t === '') continue;
    if (/^\d[\d.,]*$/.test(t)) {
      if (t.replace(/\D/g, '').length >= 2) out.add(t);
      continue;
    }
    if (t.length < 4 || ALIGN_STOPWORDS.has(t)) continue;
    out.add(t.replace(/'s$/, '').replace(/(?<=\p{L}{4})(es|s)$/u, ''));
  }
  return [...out];
}

/** Share of `tokens` present in `haystack` (1 when there are no tokens). */
function tokenCoverage(tokens: readonly string[], haystack: string): number {
  if (tokens.length === 0) return 1;
  let hit = 0;
  for (const t of tokens) if (haystack.includes(t)) hit += 1;
  return hit / tokens.length;
}

/** A unit counts as taught when at least this share of its tokens is in the note. */
const TAUGHT_THRESHOLD = 0.5;

/** Subjects whose MCQs test computation/skills rather than a taught fact. */
const ALIGN_SKIP_TAUGHT: ReadonlySet<string> = new Set(['MENT', 'ENG', 'TEL']);

/**
 * The FACT UNITS the answer-taught heuristic checks for an item: for a match,
 * each correct pair's List-II text (paired with its List-I text for context);
 * for statements, the statements named by the correct option code; for A-R, the
 * assertion and the reason; otherwise the correct option text. @internal
 */
function factUnits(item: {
  options: string[];
  answerIndex: number;
  match?: { left: { key: string; text: string }[]; right: { key: string; text: string }[] };
  statements?: string[];
  assertion?: string;
  reason?: string;
}): string[] {
  const correct = item.options[item.answerIndex] ?? '';
  if (item.match) {
    const pairs = parseMatchOptions([correct])?.[0] ?? [];
    return pairs
      .map((p) => item.match!.right.find((e) => e.key === p.right)?.text ?? '')
      .filter((t) => t !== '');
  }
  if (item.statements) {
    if (!isStatementCode(correct)) return [];
    return statementNumbersIn(correct)
      .map((n) => item.statements![n - 1] ?? '')
      .filter((t) => t !== '');
  }
  if (item.assertion !== undefined) return [item.assertion, item.reason ?? ''].filter((t) => t !== '');
  return [correct];
}

/**
 * Run the alignment audit over every MCQ bank on disk. Pure w.r.t. the
 * filesystem; never throws for content problems. The CLI only calls this under
 * `VALIDATE_ALIGN=1` (the content finalizer's gate), so `npm run check` stays
 * green until the content round lands.
 */
export function auditAlignment(): AlignFinding[] {
  type Note = { id: string; subtopicId?: string; text: string };
  type Mcq = MCQItem & { file: string; bankSubject: string };
  const notesById = new Map<string, Note>();
  const notesBySubtopic = new Map<string, Note[]>();
  const mcqs: Mcq[] = [];

  for (const abs of walkJsonFiles(CONTENT_DIR)) {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(abs, 'utf8')) as unknown;
    } catch {
      continue;
    }
    const parsed = ContentBankSchema.safeParse(raw);
    if (!parsed.success) continue;
    const bank = parsed.data;
    if (bank.kind === 'notes') {
      for (const n of bank.items) {
        const note: Note = {
          id: n.id,
          subtopicId: n.subtopicId,
          text: alignNormalise([n.title, n.body, ...(n.keyPoints ?? []), n.mnemonic ?? ''].join(' \n ')),
        };
        notesById.set(n.id, note);
        if (n.subtopicId) {
          const list = notesBySubtopic.get(n.subtopicId) ?? [];
          list.push(note);
          notesBySubtopic.set(n.subtopicId, list);
        }
      }
    } else if (bank.kind === 'mcq') {
      for (const q of bank.items) mcqs.push({ ...q, file: toGlobPath(abs), bankSubject: bank.subjectCode });
    }
  }

  // Learning-sequence order: subtopic id → (subject, position).
  const seqPos = new Map<string, { subject: string; index: number }>();
  const seqPath = join(CONTENT_DIR, 'plan', 'learning-sequence.json');
  if (existsSync(seqPath)) {
    const seq = LearningSequenceSchema.safeParse(JSON.parse(readFileSync(seqPath, 'utf8')) as unknown);
    if (seq.success) {
      for (const [subject, steps] of Object.entries(seq.data.subjects)) {
        (steps ?? []).forEach((step, index) => seqPos.set(step.id, { subject, index }));
      }
    }
  }
  /** May a note of subtopic `noteSub` teach a question of subtopic `qSub`? */
  const teachable = (qSub: string | undefined, noteSub: string | undefined): boolean => {
    if (!qSub || !noteSub) return false;
    if (qSub === noteSub) return true;
    const a = seqPos.get(qSub);
    const b = seqPos.get(noteSub);
    return a !== undefined && b !== undefined && a.subject === b.subject && b.index < a.index;
  };

  const exceptions = loadAlignExceptions();
  /** Exceptions that actually suppressed a `not-taught` finding. */
  const usedExceptions = new Set<string>();
  const findings: AlignFinding[] = [];
  for (const q of mcqs) {
    const base = { file: q.file, itemId: q.id, subjectCode: q.subjectCode ?? q.bankSubject };
    const push = (rule: AlignRule, detail: string): void => {
      findings.push({ ...base, rule, detail });
    };

    // (a) looks structured but is not.
    if (!hasStructured(q)) {
      const kind = classifyStem(q.question);
      if (kind) push('structure-missing', `stem reads as ${kind} but has no structured field`);
    }
    // (b) structured-field integrity.
    for (const p of structuredProblems(q)) push('structure-integrity', p);

    // (c) noteRef.
    let teachingNotes: Note[] = [];
    let viaRef = false;
    if (!q.noteRef) {
      push('noteref-missing', 'no noteRef');
    } else {
      const note = notesById.get(q.noteRef);
      if (!note) push('noteref-invalid', `noteRef ${q.noteRef} is not a note id`);
      else if (!teachable(q.subtopicId, note.subtopicId)) {
        push('noteref-invalid', `noteRef ${q.noteRef} (${note.subtopicId ?? 'no subtopic'}) is not this or an earlier subtopic`);
      } else {
        teachingNotes = [note];
        viaRef = true;
      }
    }
    // Without a valid noteRef the heuristic falls back to every note of the
    // item's own subtopic, so it is informative before noteRefs are authored.
    if (!viaRef) teachingNotes = q.subtopicId ? (notesBySubtopic.get(q.subtopicId) ?? []) : [];

    // (d) answer-taught heuristic.
    if (ALIGN_SKIP_TAUGHT.has(base.subjectCode)) continue;
    const haystack = teachingNotes.map((n) => n.text).join(' \n ');
    if (haystack === '') {
      push('not-taught', 'possibly not taught: no teaching note found for this subtopic');
      continue;
    }
    const missed = factUnits(q).filter((u) => tokenCoverage(significantTokens(u), haystack) < TAUGHT_THRESHOLD);
    if (missed.length > 0) {
      // A justified false positive (listed with a reason) is suppressed.
      if (exceptions.has(q.id)) {
        usedExceptions.add(q.id);
        continue;
      }
      const where = viaRef ? `note ${q.noteRef}` : `${q.subtopicId} notes (no valid noteRef)`;
      push('not-taught', `possibly not taught in ${where}: ${missed.map((m) => `"${m.slice(0, 60)}"`).join('; ')}`);
    }
  }
  // Stale exceptions: unknown id, or the item no longer trips the heuristic.
  const mcqIds = new Set(mcqs.map((q) => q.id));
  for (const id of exceptions.keys()) {
    if (usedExceptions.has(id)) continue;
    findings.push({
      file: '/content/audit/align-exceptions.json',
      itemId: id,
      subjectCode: '-',
      rule: 'exception-stale',
      detail: mcqIds.has(id) ? 'exception no longer needed (item is taught) — remove it' : 'exception names an unknown MCQ id',
    });
  }
  findings.sort((a, b) => a.file.localeCompare(b.file) || a.itemId.localeCompare(b.itemId) || a.rule.localeCompare(b.rule));
  return findings;
}

/* ========================================================================== */
/* COMPLETENESS rule — is a subtopic's fact universe 100% taught and drilled?  */
/*                                                                             */
/* For every subtopic that HAS a `content/facts/<id>.json` (the closed fact    */
/* universe — see .research/plan/COMPLETENESS-BRIEF.md) it checks:             */
/*   (a) TAUGHT  — the fact's `taughtIn` note item exists in the subtopic and  */
/*       the fact's key tokens appear in that item's body/keyPoints;           */
/*   (b) DRILLED — >= 1 `drilledBy` id exists in the subtopic's MCQ/cards      */
/*       banks AND that item's text contains the fact's key tokens;            */
/*   (c) HIGH-YIELD — every `yield:"high"` fact has >= 1 valid MCQ drill (a     */
/*       flashcard alone is not enough);                                       */
/* and reports facts / taught% / drilled% / high-yield-MCQ% per subtopic.      */
/* For subtopics WITHOUT a facts file it reports an ESTIMATED fact count       */
/* (distinct bolded terms + keyPoints in the notes) and the retrieval ratio    */
/* (mcq + cards) / estimate, so the backlog stays visible.                     */
/*                                                                             */
/* `validate:content` prints the findings as WARNINGS (never strict yet); the  */
/* `audit:completeness` gate fails only when a subtopic that HAS a facts file  */
/* drops below 100% taught or 100% drilled, so closed subtopics cannot regress.*/
/* ========================================================================== */

/** Completeness rule ids (one finding per fact per failed check). */
export type CompletenessRule =
  | 'taught-missing' // (a) no taughtIn
  | 'taught-unknown-note' // (a) taughtIn is not a note item of this subtopic
  | 'taught-tokens' // (a) key tokens absent from the note body/keyPoints
  | 'drilled-missing' // (b) no drilledBy
  | 'drilled-unknown-item' // (b) a drilledBy id is not an MCQ/card of this subtopic
  | 'drilled-tokens' // (b) a drilledBy item's text lacks the key tokens
  | 'high-yield-card-only'; // (c) a high-yield fact has no valid MCQ drill

/** One completeness finding. */
export interface CompletenessFinding {
  subtopicId: string;
  factId: string;
  rule: CompletenessRule;
  detail: string;
}

/** The note fields the TAUGHT check reads. */
export interface CompletenessNote {
  id: string;
  body: string;
  keyPoints?: string[];
}

/** The MCQ fields the DRILLED check reads (the explanation is deliberately NOT read — the item must ASK for the fact). */
export interface CompletenessMcq {
  id: string;
  question: string;
  options: string[];
  statements?: string[];
  assertion?: string;
  reason?: string;
  match?: { left: { text: string }[]; right: { text: string }[] };
}

/** The flashcard fields the DRILLED check reads. */
export interface CompletenessCard {
  id: string;
  front: string;
  back: string;
}

/** The authored content of one subtopic, as the completeness rule sees it. */
export interface CompletenessContent {
  notes: CompletenessNote[];
  mcqs: CompletenessMcq[];
  cards: CompletenessCard[];
}

/** Per-subtopic result for a subtopic that HAS a facts file. */
export interface FactsCompleteness {
  facts: number;
  taught: number;
  drilled: number;
  highYield: number;
  highYieldMcq: number;
  /** Percentages, rounded down to an integer (100 only when nothing is missing). */
  taughtPct: number;
  drilledPct: number;
  /** 100 when there are no high-yield facts. */
  highYieldMcqPct: number;
  findings: CompletenessFinding[];
}

/** Normalise text for key-token matching: alignment normalisation + diacritics folded. */
function completenessNormalise(text: string): string {
  return alignNormalise(text.normalize('NFD').replace(/\p{M}/gu, ''));
}

/** Escape a string for use inside a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Does `haystack` (already normalised) carry the fact's key tokens?
 * Explicit `keys`: EVERY key must appear, anchored at a word start (so
 * `microlith` matches `microliths` but `eran` does not match `veteran`).
 * Derived (no `keys`): at least half of `significantTokens(fact)` must appear.
 * Returns the missing tokens (empty = present).
 */
export function missingKeyTokens(fact: Pick<Fact, 'fact' | 'keys'>, haystack: string): string[] {
  if (fact.keys && fact.keys.length > 0) {
    return fact.keys.filter((k) => {
      const key = completenessNormalise(k).trim();
      return !new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(key)}`, 'u').test(haystack);
    });
  }
  const tokens = significantTokens(completenessNormalise(fact.fact));
  if (tokenCoverage(tokens, haystack) >= TAUGHT_THRESHOLD) return [];
  return tokens.filter((t) => !haystack.includes(t));
}

/** The text of a note item the TAUGHT check searches (body + keyPoints). */
export function noteTaughtText(n: CompletenessNote): string {
  return completenessNormalise([n.body, ...(n.keyPoints ?? [])].join(' \n '));
}

/** The text of an MCQ the DRILLED check searches (stem, structured fields, options — not the explanation). */
export function mcqDrillText(q: CompletenessMcq): string {
  return completenessNormalise(
    [
      q.question,
      ...(q.statements ?? []),
      q.assertion ?? '',
      q.reason ?? '',
      ...(q.match?.left.map((e) => e.text) ?? []),
      ...(q.match?.right.map((e) => e.text) ?? []),
      ...q.options,
    ].join(' \n '),
  );
}

/** The text of a flashcard the DRILLED check searches (front + back). */
export function cardDrillText(c: CompletenessCard): string {
  return completenessNormalise(`${c.front} \n ${c.back}`);
}

/** Integer percentage, rounded DOWN so 99.6% never displays as a passing 100%. */
function pctFloor(n: number, d: number): number {
  return d === 0 ? 100 : Math.floor((n / d) * 100);
}

/**
 * Check ONE subtopic's fact universe against its authored content — the three
 * completeness checks (a) taught, (b) drilled, (c) high-yield MCQ. Pure, so
 * every check is unit-testable on fixtures.
 */
export function checkFactsCompleteness(facts: FactsFile, content: CompletenessContent): FactsCompleteness {
  const notes = new Map(content.notes.map((n) => [n.id, noteTaughtText(n)] as const));
  const drills = new Map<string, { kind: 'mcq' | 'card'; text: string }>();
  for (const q of content.mcqs) drills.set(q.id, { kind: 'mcq', text: mcqDrillText(q) });
  for (const c of content.cards) drills.set(c.id, { kind: 'card', text: cardDrillText(c) });

  const findings: CompletenessFinding[] = [];
  let taught = 0;
  let drilled = 0;
  let highYield = 0;
  let highYieldMcq = 0;
  const sid = facts.subtopicId;

  for (const f of facts.facts) {
    const push = (rule: CompletenessRule, detail: string): void => {
      findings.push({ subtopicId: sid, factId: f.id, rule, detail });
    };

    // (a) TAUGHT
    if (!f.taughtIn) {
      push('taught-missing', 'no taughtIn note item');
    } else {
      const text = notes.get(f.taughtIn);
      if (text === undefined) push('taught-unknown-note', `taughtIn '${f.taughtIn}' is not a note item of ${sid}`);
      else {
        const miss = missingKeyTokens(f, text);
        if (miss.length > 0) push('taught-tokens', `note ${f.taughtIn} lacks key token(s): ${miss.join(', ')}`);
        else taught += 1;
      }
    }

    // (b) DRILLED + (c) HIGH-YIELD MCQ
    let validDrills = 0;
    let validMcqDrills = 0;
    if (!f.drilledBy || f.drilledBy.length === 0) {
      push('drilled-missing', 'no drilledBy MCQ/card ids');
    } else {
      for (const id of f.drilledBy) {
        const d = drills.get(id);
        if (!d) {
          push('drilled-unknown-item', `drilledBy '${id}' is not an MCQ/card of ${sid}`);
          continue;
        }
        const miss = missingKeyTokens(f, d.text);
        if (miss.length > 0) {
          push('drilled-tokens', `${d.kind} ${id} lacks key token(s): ${miss.join(', ')}`);
          continue;
        }
        validDrills += 1;
        if (d.kind === 'mcq') validMcqDrills += 1;
      }
    }
    if (validDrills > 0) drilled += 1;
    if (f.yield === 'high') {
      highYield += 1;
      if (validMcqDrills > 0) highYieldMcq += 1;
      else if (validDrills > 0) push('high-yield-card-only', 'high-yield fact is drilled only by flashcard(s) — add an MCQ');
      else push('high-yield-card-only', 'high-yield fact has no valid MCQ drill');
    }
  }

  const n = facts.facts.length;
  return {
    facts: n,
    taught,
    drilled,
    highYield,
    highYieldMcq,
    taughtPct: pctFloor(taught, n),
    drilledPct: pctFloor(drilled, n),
    highYieldMcqPct: pctFloor(highYieldMcq, highYield),
    findings,
  };
}

/** Bold spans that are structural labels, not facts (case-insensitive). */
const STRUCTURAL_BOLD = /^(in one line|tl;dr|the story|terms explained|don'?t confuse|remember|note|example|why it matters|key points?|exam tip|trap|mnemonic)\b/i;

/**
 * ESTIMATED fact count for a subtopic that has no facts file yet: distinct
 * bolded terms in its note bodies/keyPoints (excluding structural labels such
 * as `**In one line:**`) plus the number of keyPoints. Deliberately rough — it
 * only sizes the backlog.
 */
export function estimateFactCount(notes: readonly CompletenessNote[]): number {
  const bold = new Set<string>();
  let keyPoints = 0;
  for (const n of notes) {
    keyPoints += n.keyPoints?.length ?? 0;
    for (const text of [n.body, ...(n.keyPoints ?? [])]) {
      const re = /\*\*([^*\n]+)\*\*/g;
      for (let m = re.exec(text); m !== null; m = re.exec(text)) {
        const term = (m[1] ?? '').trim();
        if (term === '' || term.endsWith(':') || STRUCTURAL_BOLD.test(term)) continue;
        bold.add(term.toLowerCase());
      }
    }
  }
  return bold.size + keyPoints;
}

/** Status of a subtopic in the completeness report. */
export type CompletenessStatus = 'COMPLETE' | 'GAPS' | 'NO-FACTS';

/** One row of the app-wide completeness report. */
export interface CompletenessRow {
  subtopicId: string;
  subjectCode: string;
  /** Position in the study order (units.json, then learning-sequence.json, then the rest). */
  order: number;
  hasFacts: boolean;
  mcqs: number;
  cards: number;
  /** Present when `hasFacts`. */
  result?: FactsCompleteness;
  /** Present when NOT `hasFacts`: the estimated fact count of the notes. */
  estimate?: number;
  /** Present when NOT `hasFacts`: (mcqs + cards) / estimate, or undefined when estimate is 0. */
  retrievalRatio?: number;
  status: CompletenessStatus;
}

/** The full completeness audit. */
export interface CompletenessReport {
  rows: CompletenessRow[];
  findings: CompletenessFinding[];
  /** Facts files whose subtopic has no content at all (reported, never silently ignored). */
  orphanFacts: string[];
}

/** Status of one facts-backed subtopic: complete only at 100/100/100. */
export function completenessStatus(r: FactsCompleteness): CompletenessStatus {
  return r.taughtPct === 100 && r.drilledPct === 100 && r.highYieldMcqPct === 100 ? 'COMPLETE' : 'GAPS';
}

/**
 * The regression gate: 1 when any subtopic WITH a facts file is below 100%
 * taught, 100% drilled, or 100% high-yield-with-MCQ (a high-yield fact drilled
 * only by flashcards, or not at all, FAILS — tightened once the Ancient India I
 * unit closed), or a facts file names a subtopic with no content; else 0.
 * Subtopics without a facts file never fail the gate — they are backlog.
 */
export function completenessExitCode(report: Pick<CompletenessReport, 'rows' | 'orphanFacts'>): 0 | 1 {
  if (report.orphanFacts.length > 0) return 1;
  for (const row of report.rows) {
    if (!row.hasFacts || !row.result) continue;
    const r = row.result;
    if (r.taughtPct < 100 || r.drilledPct < 100 || r.highYieldMcqPct < 100) return 1;
  }
  return 0;
}

/**
 * Study order over subtopic ids: every unit's topicIds in units.json order,
 * then any learning-sequence.json ids not yet listed (subject by subject),
 * so the backlog queue reads in the order a learner meets the topics. Missing
 * or invalid plan files simply contribute nothing.
 */
export function studyOrder(contentDir: string = CONTENT_DIR): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (id: string): void => {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  };
  const read = (path: string): unknown => {
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as unknown;
    } catch {
      return undefined;
    }
  };
  const unitsRaw = read(join(contentDir, 'plan', 'units.json'));
  const u = unitsRaw === undefined ? undefined : UnitsSchema.safeParse(unitsRaw);
  if (u?.success) for (const unit of u.data.units) unit.topicIds.forEach(add);
  const seqRaw = read(join(contentDir, 'plan', 'learning-sequence.json'));
  const seq = seqRaw === undefined ? undefined : LearningSequenceSchema.safeParse(seqRaw);
  if (seq?.success) {
    for (const steps of Object.values(seq.data.subjects)) for (const st of steps ?? []) add(st.id);
  }
  return out;
}

/**
 * Run the completeness audit over a content directory on disk (defaults to the
 * repo's `content/`). Discovers subtopics from the notes/MCQ/cards banks and
 * the facts files; never throws for content problems (unparseable files are
 * skipped — the schema gate reports them).
 */
export function auditAllCompleteness(contentDir: string = CONTENT_DIR): CompletenessReport {
  type Bucket = CompletenessContent & { subjectCode: string };
  const buckets = new Map<string, Bucket>();
  const bucket = (id: string, subjectCode: string): Bucket => {
    let b = buckets.get(id);
    if (!b) {
      b = { subjectCode, notes: [], mcqs: [], cards: [] };
      buckets.set(id, b);
    }
    return b;
  };
  const factsBySubtopic = new Map<string, FactsFile>();

  for (const abs of walkJsonFiles(contentDir)) {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(abs, 'utf8')) as unknown;
    } catch {
      continue;
    }
    const rel = relative(contentDir, abs).split(sep).join('/');
    if (rel.startsWith('facts/')) {
      const parsed = FactsFileSchema.safeParse(raw);
      if (parsed.success) factsBySubtopic.set(parsed.data.subtopicId, parsed.data);
      continue;
    }
    const kind = (raw as { kind?: unknown } | null)?.kind;
    if (kind === 'cards') {
      const parsed = CardsBankSchema.safeParse(raw);
      if (!parsed.success) continue;
      for (const c of parsed.data.items) bucket(c.subtopicId, c.subjectCode).cards.push(c);
      continue;
    }
    if (kind !== 'notes' && kind !== 'mcq') continue;
    const parsed = ContentBankSchema.safeParse(raw);
    if (!parsed.success) continue;
    const bank = parsed.data;
    if (bank.kind === 'notes') {
      // Mains-angle notes are not Prelims fact carriers, but they still teach —
      // keep them so a fact may be taughtIn any note of the subtopic.
      for (const n of bank.items) if (n.subtopicId) bucket(n.subtopicId, n.subjectCode).notes.push(n);
    } else if (bank.kind === 'mcq') {
      for (const q of bank.items) if (q.subtopicId) bucket(q.subtopicId, q.subjectCode).mcqs.push(q);
    }
  }

  const order = studyOrder(contentDir);
  const orderIdx = new Map(order.map((id, i) => [id, i] as const));
  const orphanFacts = [...factsBySubtopic.keys()].filter((id) => !buckets.has(id)).sort();

  const rows: CompletenessRow[] = [];
  const findings: CompletenessFinding[] = [];
  for (const [id, b] of buckets) {
    const base = {
      subtopicId: id,
      subjectCode: b.subjectCode,
      order: orderIdx.get(id) ?? Number.MAX_SAFE_INTEGER,
      mcqs: b.mcqs.length,
      cards: b.cards.length,
    };
    const facts = factsBySubtopic.get(id);
    if (facts) {
      const result = checkFactsCompleteness(facts, b);
      findings.push(...result.findings);
      rows.push({ ...base, hasFacts: true, result, status: completenessStatus(result) });
    } else {
      const estimate = estimateFactCount(b.notes);
      rows.push({
        ...base,
        hasFacts: false,
        estimate,
        ...(estimate > 0 ? { retrievalRatio: (b.mcqs.length + b.cards.length) / estimate } : {}),
        status: 'NO-FACTS',
      });
    }
  }
  rows.sort((a, c) => a.order - c.order || a.subjectCode.localeCompare(c.subjectCode) || a.subtopicId.localeCompare(c.subtopicId));
  return { rows, findings, orphanFacts };
}

/* ========================================================================== */
/* QUESTION-QUALITY rule — are the MCQs at exam standard?                      */
/*                                                                             */
/* The machine-checkable part of `.research/plan/QUESTION-QUALITY.md`:         */
/*   ITEM rules (one finding per item per rule)                                */
/*     stem-short        (a) rendered stem (lead-in + statements / lists /     */
/*                           A-R) under QUALITY_MIN_STEM chars;                */
/*     stem-prompt       (a) a statement item's lead-in never asks the         */
/*                           question ("Which of the above …?");               */
/*     option-length     (b) longest option > QUALITY_MAX_LEN_RATIO × the      */
/*                           shortest (prose options only — code, numeric and  */
/*                           short (< 20 char) option sets are exempt);        */
/*     option-duplicate  (b) two options identical after normalising;          */
/*     option-filler     (b) "None of the above" / "All of the above" option;  */
/*     option-absolute   (b) give-away absolutes: >= 2 distractors say         */
/*                           always/never/solely/… while the key does not;     */
/*   BANK rules (one finding per bank per rule)                                */
/*     all-correct-share (c) > 20% of a bank's statement items keyed "all      */
/*                           statements correct" (1, 2 and 3 / Both / All …);  */
/*     answer-spread     (d) an option index outside 20–30% of keys            */
/*                           (18–32% for banks under 30 items);                */
/*     key-variety       (e) statement-item keys too uniform (see below);      */
/*   META                                                                      */
/*     waiver-stale      a quality-waivers entry names an unknown bank or no   */
/*                       longer suppresses any finding (remove it).            */
/*                                                                             */
/* NOT strict yet: `validate:content` runs it only under VALIDATE_QUALITY=1,   */
/* and `npm run audit:quality` prints the per-bank table + BASELINE.md. Both   */
/* fail only on findings in banks NOT listed in                                */
/* `content/audit/quality-waivers.json`, so the fix can land bank by bank.     */
/* ========================================================================== */

/** Question-quality rule ids (the waivable ones plus `waiver-stale`). */
export type QualityRule = (typeof QUALITY_RULES)[number] | 'waiver-stale';

/** Minimum rendered-stem length (characters) of an exam stem. */
export const QUALITY_MIN_STEM = 45;
/** Max longest/shortest option length ratio for prose options. */
export const QUALITY_MAX_LEN_RATIO = 2.2;
/** Option sets whose longest option is shorter than this are exempt from the ratio (names, places, years). */
export const QUALITY_LEN_RATIO_MIN_LONGEST = 20;
/** Max share of a bank's statement items that may be keyed "all statements correct". */
export const QUALITY_MAX_ALL_CORRECT = 0.2;
/** Per-option key-share band, and the wider band for banks under {@link QUALITY_SMALL_BANK} items. */
export const QUALITY_SPREAD_BAND: readonly [number, number] = [0.2, 0.3];
export const QUALITY_SPREAD_BAND_SMALL: readonly [number, number] = [0.18, 0.32];
export const QUALITY_SMALL_BANK = 30;
/** key-variety: the most common statement key may hold at most this share (banks with >= 6 statement items). */
export const QUALITY_MAX_TOP_KEY = 0.4;

/** The fields of an MCQ the quality rules read. */
export interface QualityItem {
  id: string;
  question: string;
  options: readonly string[];
  answerIndex: number;
  statements?: readonly string[];
  assertion?: string;
  reason?: string;
  match?: { left: readonly { text: string }[]; right: readonly { text: string }[] };
}

/** One question-quality finding. `itemId` is `-` for a bank-level rule. */
export interface QualityFinding {
  file: string;
  itemId: string;
  rule: QualityRule;
  detail: string;
  /** True when the bank's waiver covers this rule (reported, not failed). */
  waived: boolean;
}

/** Per-bank quality metrics + findings. */
export interface BankQuality {
  file: string;
  subjectCode: string;
  items: number;
  /** Keys per option index A/B/C/D (4-option items only). */
  spread: [number, number, number, number];
  /** Items with exactly four options (the spread denominator). */
  fourOptionItems: number;
  statementItems: number;
  /** Items keyed "all correct" (statement all-covering codes, Both, All of the above …). */
  allCorrect: number;
  /** …of which statement items (the all-correct-share numerator). */
  allCorrectStatements: number;
  shortStems: number;
  /** Item findings of the option-* rules. */
  homogeneity: number;
  violations: Partial<Record<QualityRule, number>>;
  findings: QualityFinding[];
  /** Waiver status: false, true (all rules) or the waived rule list. */
  waived: boolean | QualityRule[];
  /** Worst-first sort key (see {@link qualityScore}). */
  score: number;
}

/** The whole question-quality audit. */
export interface QualityReport {
  banks: BankQuality[];
  /** Every finding, including `waiver-stale` and waiver-file schema problems. */
  findings: QualityFinding[];
  /** Schema / JSON errors in the waivers file (reported as non-waived failures). */
  waiverErrors: string[];
}

/** Is the question-quality report switched on in `validate:content`? Only with `VALIDATE_QUALITY=1` (never by `--strict` yet). */
export function qualityEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.VALIDATE_QUALITY === '1';
}

/** A sequence/ordering code option such as `2 - 4 - 3 - 1` or `1 → 2 → 3`. */
function isOrderingCode(opt: string): boolean {
  return /\d\s*[-–—→]\s*\d/.test(opt) && /^[\d\s\-–—→,]+$/.test(opt.trim());
}

/** "All of the above"-family key text. */
const ALL_KEY_RE = /^(?:all\s+(?:of\s+(?:the\s+)?(?:above|these|them)|the\s+above|three|four|five|six|statements?|are\s+correct|the\s+statements)|both\b)/i;
/** "None"-family key text (none of the statements is correct). */
const NONE_KEY_RE = /^(?:none\b|neither\b)/i;
/** "How many" count keys: "Only one", "Only two", "Exactly three" … */
const COUNT_KEY_RE = /^(?:only|exactly)\s+(one|two|three|four|five)\b/i;
/** Filler options. */
const FILLER_RE = /^(?:none|all)\s+of\s+(?:the\s+)?(?:above|these|them)\.?$/i;
/** Give-away absolutes (distractor-only absolutes are a cue). */
const ABSOLUTE_RE =
  /\b(?:always|never|entirely|completely|solely|exclusively|invariably|absolutely|without\s+exception|under\s+no\s+circumstances|in\s+all\s+cases)\b/i;

/**
 * Is this a STATEMENT item (numbered statements answered by a code such as
 * "1 and 3 only")? True when it has a structured `statements` field, or when the
 * stem reads as statements/pairs and at least three options are statement
 * codes. Ordering items (`2 - 4 - 3 - 1`) and match items never are.
 */
export function isStatementItem(item: QualityItem): boolean {
  if (item.match || item.options.some(isOrderingCode)) return false;
  if (item.statements && item.statements.length > 0) return true;
  // Unstructured: the stem must itself read as numbered statements / pairs —
  // bare numbers ("2050", "17 and 119") are numericals, not statement codes.
  const statementStem = classifyStem(item.question) === 'statements' || /\b(?:statements?|pairs?)\b/i.test(item.question);
  return statementStem && item.options.filter((o) => isStatementCode(o)).length >= 3;
}

/** Number of statements of a statement item (structured length, else the highest number any option references). */
function statementCount(item: QualityItem): number {
  return item.statements?.length ?? maxStatementRef(item.options);
}

/**
 * Normalised key of a statement item: `all`, `none`, `count-N`, or the sorted
 * statement numbers (`1,3`). `null` when the key is not a recognisable code.
 */
export function statementKeyCode(item: QualityItem): string | null {
  const key = (item.options[item.answerIndex] ?? '').trim();
  const n = statementCount(item);
  if (/^both\s+\d+\s+and\s+\d+(?:\s+only)?$/i.test(key)) return n <= 2 ? 'all' : (key.match(/\d+/g) ?? []).sort().join(',');
  if (ALL_KEY_RE.test(key)) return 'all';
  if (NONE_KEY_RE.test(key)) return 'none';
  const count = COUNT_KEY_RE.exec(key);
  if (count) {
    const words = ['one', 'two', 'three', 'four', 'five'];
    const k = words.indexOf(count[1]!.toLowerCase()) + 1;
    return k === n ? 'all' : `count-${k}`;
  }
  if (!isStatementCode(key) || isOrderingCode(key)) return null;
  const nums = [...new Set(statementNumbersIn(key))].sort((a, b) => a - b);
  if (n > 0 && nums.length === n && nums.every((v, i) => v === i + 1)) return 'all';
  return nums.join(',');
}

/**
 * Is the item keyed "all correct" — a statement code naming every statement,
 * "Both 1 and 2" on a two-statement item, or an "All of the above" key?
 */
export function isAllCorrectKey(item: QualityItem): boolean {
  if (isStatementItem(item)) return statementKeyCode(item) === 'all';
  const key = (item.options[item.answerIndex] ?? '').trim();
  return FILLER_RE.test(key) && /^all/i.test(key);
}

/** The rendered stem: lead-in plus structured statements / A-R / match lists. */
export function renderedStem(item: QualityItem): string {
  return [
    item.question,
    ...(item.statements ?? []),
    item.assertion ?? '',
    item.reason ?? '',
    ...(item.match ? [...item.match.left, ...item.match.right].map((e) => e.text) : []),
  ]
    .filter((s) => s !== '')
    .join('\n')
    .trim();
}

/** Normalise an option for duplicate detection. */
function normaliseOption(o: string): string {
  return o
    .toLowerCase()
    .replace(/[‘’`]/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/[\s.;,]+$/, '')
    .trim();
}

/** A code / numeric option (exempt from the length ratio). */
function isCodeOrNumeric(o: string): boolean {
  const t = o.trim();
  return isStatementCode(t) || isOrderingCode(t) || /^[\d\s.,:/%₹$+\-−×()]+[a-zA-Z%°²³]{0,6}\.?$/.test(t);
}

/** The ITEM-level quality problems of one MCQ (pure). */
export function checkItemQuality(item: QualityItem): { rule: QualityRule; detail: string }[] {
  const out: { rule: QualityRule; detail: string }[] = [];
  const stem = renderedStem(item);
  if (stem.length < QUALITY_MIN_STEM) out.push({ rule: 'stem-short', detail: `stem is ${stem.length} chars (< ${QUALITY_MIN_STEM}): "${stem.slice(0, 60)}"` });

  const statement = isStatementItem(item);
  if (statement && !/\b(?:which|how\s+many|select|choose|identify)\b/i.test(item.question)) {
    out.push({ rule: 'stem-prompt', detail: 'statement item never asks "Which of the above … correct?" / "How many …?"' });
  }

  const opts = item.options.map((o) => o.trim());
  // (b1) length ratio — prose options only.
  const coded = item.match !== undefined || statement || opts.some(isOrderingCode) || opts.every(isCodeOrNumeric);
  if (!coded && opts.length > 0) {
    const lens = opts.map((o) => o.length);
    const longest = Math.max(...lens);
    const shortest = Math.max(1, Math.min(...lens));
    if (longest >= QUALITY_LEN_RATIO_MIN_LONGEST && longest / shortest > QUALITY_MAX_LEN_RATIO) {
      out.push({
        rule: 'option-length',
        detail: `longest option ${longest} chars is ${(longest / shortest).toFixed(1)}× the shortest (${shortest}) — max ${QUALITY_MAX_LEN_RATIO}×`,
      });
    }
  }
  // (b2) duplicates.
  const seen = new Map<string, number>();
  opts.forEach((o, i) => {
    const k = normaliseOption(o);
    if (seen.has(k)) out.push({ rule: 'option-duplicate', detail: `options ${'ABCDEF'[seen.get(k)!]} and ${'ABCDEF'[i]} are identical: "${o.slice(0, 40)}"` });
    else seen.set(k, i);
  });
  // (b3) filler.
  opts.forEach((o, i) => {
    if (FILLER_RE.test(o)) out.push({ rule: 'option-filler', detail: `option ${'ABCDEF'[i]} is filler: "${o}"` });
  });
  // (b4) give-away absolutes.
  if (!coded) {
    const key = opts[item.answerIndex] ?? '';
    const absDistractors = opts.filter((o, i) => i !== item.answerIndex && ABSOLUTE_RE.test(o)).length;
    if (absDistractors >= 2 && !ABSOLUTE_RE.test(key)) {
      out.push({ rule: 'option-absolute', detail: `${absDistractors} distractors use absolutes (always/never/solely…) and the key does not — a give-away` });
    }
  }
  return out;
}

/**
 * Worst-first score: pct-points outside the spread band + pct-points over the
 * all-correct cap (only when that rule fires) + 10 when key-variety fails + % of
 * items with any item-level finding.
 */
function qualityScore(b: Omit<BankQuality, 'score' | 'waived'>, itemsWithFindings: number): number {
  const [lo, hi] = b.items < QUALITY_SMALL_BANK ? QUALITY_SPREAD_BAND_SMALL : QUALITY_SPREAD_BAND;
  let s = 0;
  if (b.fourOptionItems > 0) {
    for (const c of b.spread) {
      const p = c / b.fourOptionItems;
      if (p < lo) s += (lo - p) * 100;
      else if (p > hi) s += (p - hi) * 100;
    }
  }
  if (b.violations['all-correct-share'] && b.statementItems > 0) {
    s += Math.max(0, (b.allCorrectStatements / b.statementItems - QUALITY_MAX_ALL_CORRECT) * 100);
  }
  if (b.violations['key-variety']) s += 10;
  if (b.items > 0) s += (itemsWithFindings / b.items) * 100;
  return Math.round(s * 10) / 10;
}

/** Percent with no decimals. */
function pct0(n: number, d: number): string {
  return d === 0 ? '—' : `${Math.round((n / d) * 100)}%`;
}

/**
 * Check ONE bank (pure): every item rule, then the bank rules (all-correct
 * share, answer spread, key variety). Waivers are applied by
 * {@link auditAllQuality}; here every finding has `waived: false`.
 */
export function checkBankQuality(file: string, subjectCode: string, items: readonly QualityItem[]): BankQuality {
  const findings: QualityFinding[] = [];
  const push = (itemId: string, rule: QualityRule, detail: string): void => {
    findings.push({ file, itemId, rule, detail, waived: false });
  };
  const spread: [number, number, number, number] = [0, 0, 0, 0];
  let four = 0;
  let statementItems = 0;
  let allCorrect = 0;
  let allCorrectStatements = 0;
  let shortStems = 0;
  let homogeneity = 0;
  const itemsWithFindings = new Set<string>();
  const keyCodes = new Map<string, number>();

  for (const q of items) {
    if (q.options.length === 4) {
      four += 1;
      spread[q.answerIndex as 0 | 1 | 2 | 3] += 1;
    }
    const statement = isStatementItem(q);
    const all = isAllCorrectKey(q);
    if (all) allCorrect += 1;
    if (statement) {
      statementItems += 1;
      if (all) allCorrectStatements += 1;
      const code = statementKeyCode(q) ?? `raw:${normaliseOption(q.options[q.answerIndex] ?? '')}`;
      keyCodes.set(code, (keyCodes.get(code) ?? 0) + 1);
    }
    for (const f of checkItemQuality(q)) {
      push(q.id, f.rule, f.detail);
      itemsWithFindings.add(q.id);
      if (f.rule === 'stem-short') shortStems += 1;
      if (f.rule.startsWith('option-')) homogeneity += 1;
    }
  }

  // (c) all-correct share of statement items. Small statement sets (< 5) may hold one.
  if (statementItems > 0) {
    const share = allCorrectStatements / statementItems;
    const over = statementItems >= 5 ? share > QUALITY_MAX_ALL_CORRECT : allCorrectStatements > 1;
    if (over) {
      push('-', 'all-correct-share', `${allCorrectStatements}/${statementItems} statement items (${pct0(allCorrectStatements, statementItems)}) keyed "all correct" — max ${QUALITY_MAX_ALL_CORRECT * 100}%`);
    }
  }
  // (d) answer-index spread.
  if (four > 0) {
    const [lo, hi] = items.length < QUALITY_SMALL_BANK ? QUALITY_SPREAD_BAND_SMALL : QUALITY_SPREAD_BAND;
    const bad = spread
      .map((c, i) => ({ letter: 'ABCD'[i]!, p: c / four }))
      .filter(({ p }) => p < lo - 1e-9 || p > hi + 1e-9);
    if (bad.length > 0) {
      push(
        '-',
        'answer-spread',
        `A/B/C/D = ${spread.map((c) => pct0(c, four)).join('/')}; ${bad.map((b) => `${b.letter} ${pct0(b.p * four, four)}`).join(', ')} outside ${lo * 100}–${hi * 100}%`,
      );
    }
  }
  // (e) key-phrase variety of statement items.
  if (statementItems >= 3) {
    const distinct = keyCodes.size;
    const top = Math.max(...keyCodes.values());
    const problems: string[] = [];
    if (statementItems >= 6) {
      if (distinct < 3) problems.push(`only ${distinct} distinct key(s)`);
      if (top / statementItems > QUALITY_MAX_TOP_KEY) {
        const [code] = [...keyCodes.entries()].find(([, n]) => n === top)!;
        problems.push(`"${code}" keys ${pct0(top, statementItems)} (max ${QUALITY_MAX_TOP_KEY * 100}%)`);
      }
      if (statementItems >= 10) {
        const single = [...keyCodes.keys()].some((c) => c === 'none' || /^\d+$/.test(c) || c === 'count-1');
        if (!single) problems.push('no "N only" / "none" key');
      }
    } else if (distinct < 2) problems.push('every statement item has the same key');
    if (problems.length > 0) push('-', 'key-variety', `${statementItems} statement items: ${problems.join('; ')}`);
  }

  const violations: Partial<Record<QualityRule, number>> = {};
  for (const f of findings) violations[f.rule] = (violations[f.rule] ?? 0) + 1;
  const base = {
    file,
    subjectCode,
    items: items.length,
    spread,
    fourOptionItems: four,
    statementItems,
    allCorrect,
    allCorrectStatements,
    shortStems,
    homogeneity,
    violations,
    findings,
  };
  return { ...base, waived: false, score: qualityScore(base, itemsWithFindings.size) };
}

/** Read `<contentDir>/audit/quality-waivers.json` → bank → waived rules (`null` = all). */
export function loadQualityWaivers(contentDir: string = CONTENT_DIR): { waivers: Map<string, QualityRule[] | null>; errors: string[] } {
  const waivers = new Map<string, QualityRule[] | null>();
  const path = join(contentDir, 'audit', 'quality-waivers.json');
  if (!existsSync(path)) return { waivers, errors: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch (e) {
    return { waivers, errors: [`quality-waivers.json is not valid JSON: ${(e as Error).message}`] };
  }
  const parsed = QualityWaiversSchema.safeParse(raw);
  if (!parsed.success) return { waivers, errors: formatIssues(parsed.error) };
  for (const w of parsed.data.waivers) waivers.set(w.bank, w.rules ? [...w.rules] : null);
  return { waivers, errors: [] };
}

/**
 * Run the question-quality audit over every MCQ bank under `contentDir`, apply
 * the waivers, and flag stale waivers. Never throws for content problems.
 */
export function auditAllQuality(contentDir: string = CONTENT_DIR): QualityReport {
  const { waivers, errors } = loadQualityWaivers(contentDir);
  const banks: BankQuality[] = [];
  for (const abs of walkJsonFiles(contentDir)) {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(abs, 'utf8')) as unknown;
    } catch {
      continue;
    }
    if ((raw as { kind?: unknown } | null)?.kind !== 'mcq') continue;
    const parsed = ContentBankSchema.safeParse(raw);
    if (!parsed.success || parsed.data.kind !== 'mcq') continue;
    const file = `/content/${relative(contentDir, abs).split(sep).join('/')}`;
    const b = checkBankQuality(file, parsed.data.subjectCode, parsed.data.items);
    if (waivers.has(file)) {
      const rules = waivers.get(file)!;
      b.waived = rules ?? true;
      for (const f of b.findings) f.waived = rules === null || rules.includes(f.rule);
    }
    banks.push(b);
  }
  banks.sort((a, c) => c.score - a.score || a.file.localeCompare(c.file));

  const findings: QualityFinding[] = banks.flatMap((b) => b.findings);
  const WAIVERS_FILE = '/content/audit/quality-waivers.json';
  for (const e of errors) findings.push({ file: WAIVERS_FILE, itemId: '-', rule: 'waiver-stale', detail: `invalid waivers file: ${e}`, waived: false });
  const byFile = new Map(banks.map((b) => [b.file, b] as const));
  for (const [bank, rules] of waivers) {
    const b = byFile.get(bank);
    if (!b) {
      findings.push({ file: WAIVERS_FILE, itemId: bank, rule: 'waiver-stale', detail: 'waiver names an unknown MCQ bank — remove it', waived: false });
    } else if (!b.findings.some((f) => f.waived)) {
      findings.push({
        file: WAIVERS_FILE,
        itemId: bank,
        rule: 'waiver-stale',
        detail: `bank is clean for ${rules ? rules.join(', ') : 'every rule'} — remove the waiver`,
        waived: false,
      });
    }
  }
  return { banks, findings, waiverErrors: errors };
}

/** Gate exit code: 1 when any finding is NOT waived (incl. stale waivers / a bad waivers file). */
export function qualityExitCode(report: Pick<QualityReport, 'findings'>): 0 | 1 {
  return report.findings.some((f) => !f.waived) ? 1 : 0;
}
