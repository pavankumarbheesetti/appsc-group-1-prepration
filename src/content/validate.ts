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
  type Manifest,
  type SyllabusBank,
} from './types';
import { TaxonomySchema, type Taxonomy } from './taxonomy';
import { PyqMapSchema, PyqWeightsSchema, SyllabusMapSchema } from './audit-types';
import { TimelineBankSchema } from './timeline-types';
import { LearningSequenceSchema, UnitsSchema, type LearningSequence, type Units } from './plan-types';

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
    if (file === syllabusMapGlob || file === pyqMapGlob) {
      const raw = readJson(abs);
      if (raw === undefined) continue;
      const schema = file === syllabusMapGlob ? SyllabusMapSchema : PyqMapSchema;
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
        'unrecognised file under content/audit/ (not the syllabus-map or pyq-map) — ignored by the audit',
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
    }>) {
      const id = it.id ?? '(no id)';
      if (typeof it.question === 'string') out.push({ itemId: id, field: 'question', text: it.question });
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
