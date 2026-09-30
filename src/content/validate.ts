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
import { LearningSequenceSchema, type LearningSequence } from './plan-types';

/* -------------------------------------------------------------------------- */
/* Paths                                                                       */
/* -------------------------------------------------------------------------- */

/** Absolute path to the repo's `content/` directory (this file is `src/content/`). */
const CONTENT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../content');
/** Repo root — manifest bank paths are expressed relative to this, with a leading `/`. */
const PROJECT_ROOT = resolve(CONTENT_DIR, '..');

/**
 * Convert an absolute disk path into the glob-style path used in the manifest
 * and by the loader, e.g. `/content/history-ancient/mcq-indus-valley.json`.
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
  /** Glob-style path, e.g. `/content/history-ancient/mcq-indus-valley.json`. */
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
    if (file.startsWith('/content/plan/')) {
      resultFor(file).warnings.push(
        'unrecognised file under content/plan/ (not learning-sequence.json) — ignored',
      );
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
