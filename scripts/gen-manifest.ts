/**
 * Generate `content/manifest.json` from the banks on disk.
 *
 * The manifest used to be hand-maintained; this script makes it a DERIVED
 * artifact so parallel content additions register automatically — an author
 * just drops a valid bank JSON under `content/**` and re-runs the generator (it
 * also runs as a `prebuild` step). It scans every `*.json` under `content/`,
 * EXCLUDING `manifest.json` and `taxonomy.json`, reads each bank's
 * kind/subjectCode/topic/subtopicId and item (or node) count, and writes a
 * manifest in exactly the shape the loader + `validate:content` expect. The
 * shared content validator then verifies manifest == actual on every gate.
 *
 * Run via `npm run gen:manifest`.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ContentBankSchema,
  CardsBankSchema,
  ManifestSchema,
  MindmapBankSchema,
  SyllabusBankSchema,
  type ManifestBankEntry,
} from '../src/content/types';

const here = dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = resolve(here, '../content');
const PROJECT_ROOT = resolve(CONTENT_DIR, '..');

/** Convert an absolute disk path to a `/content/...` glob-style path. */
function toGlobPath(absPath: string): string {
  return `/${relative(PROJECT_ROOT, absPath).split(sep).join('/')}`;
}

/** Recursively collect every `*.json` file under `dir` as absolute paths. */
function walkJsonFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) out.push(...walkJsonFiles(abs));
    else if (entry.endsWith('.json')) out.push(abs);
  }
  return out;
}

/** Human label per bank kind, used to synthesise a title. */
const KIND_LABEL: Record<'mcq' | 'notes' | 'mains' | 'cards' | 'mindmap', string> = {
  mcq: 'MCQs',
  notes: 'Notes',
  mains: 'Mains',
  cards: 'Flashcards',
  mindmap: 'Mind map',
};

/** The single `subtopicId` shared by every item, or undefined when mixed/absent. */
function commonSubtopicId(items: ReadonlyArray<{ subtopicId?: string }>): string | undefined {
  const first = items[0]?.subtopicId;
  if (!first) return undefined;
  return items.every((i) => i.subtopicId === first) ? first : undefined;
}

const pkg = JSON.parse(readFileSync(resolve(PROJECT_ROOT, 'package.json'), 'utf8')) as {
  version: string;
};

const entries: ManifestBankEntry[] = [];

for (const abs of walkJsonFiles(CONTENT_DIR)) {
  const file = abs.split(sep).pop() ?? '';
  // The manifest is the output; the taxonomy is not a content bank.
  if (file === 'manifest.json' || file === 'taxonomy.json') continue;

  const globPath = toGlobPath(abs);
  // The audit maps under content/audit/ are independent-audit inputs, not
  // content banks — they are never registered in the manifest.
  if (globPath.startsWith('/content/audit/')) continue;
  // The interactive-timeline dataset under content/timeline/ (kind:"timeline")
  // is validated by its own schema in the loader + validate:content, not a
  // content bank — it is never registered in the manifest.
  if (globPath.startsWith('/content/timeline/')) continue;
  // The learning sequence under content/plan/ is a pure per-subject study
  // ORDER over taxonomy ids, validated by its own schema — not a content bank,
  // so it is never registered in the manifest.
  if (globPath.startsWith('/content/plan/')) continue;

  const raw: unknown = JSON.parse(readFileSync(abs, 'utf8'));
  const kind = (raw as { kind?: unknown } | null)?.kind;

  if (kind === 'syllabus') {
    const bank = SyllabusBankSchema.parse(raw);
    entries.push({
      path: globPath,
      kind: 'syllabus',
      count: bank.nodes.length,
      title: `APPSC Group-1 Official Syllabus — Notification ${bank.meta.notificationNo}`,
    });
    continue;
  }

  // Curated flashcards: an items-based bank sharing one subtopicId.
  if (kind === 'cards') {
    const bank = CardsBankSchema.parse(raw);
    entries.push({
      path: globPath,
      kind: 'cards',
      subjectCode: bank.subjectCode,
      topic: bank.topic,
      ...(commonSubtopicId(bank.items) ? { subtopicId: commonSubtopicId(bank.items) } : {}),
      count: bank.items.length,
      title: `${bank.topic} — ${KIND_LABEL.cards}`,
    });
    continue;
  }

  // Curated mind map: a single tree with a top-level subtopicId and no items[];
  // the manifest count is the number of top-level branches.
  if (kind === 'mindmap') {
    const bank = MindmapBankSchema.parse(raw);
    entries.push({
      path: globPath,
      kind: 'mindmap',
      subjectCode: bank.subjectCode,
      topic: bank.topic,
      subtopicId: bank.subtopicId,
      count: bank.branches.length,
      title: `${bank.topic} — ${KIND_LABEL.mindmap}`,
    });
    continue;
  }

  const bank = ContentBankSchema.parse(raw);
  entries.push({
    path: globPath,
    kind: bank.kind,
    subjectCode: bank.subjectCode,
    topic: bank.topic,
    ...(commonSubtopicId(bank.items) ? { subtopicId: commonSubtopicId(bank.items) } : {}),
    count: bank.items.length,
    title: `${bank.topic} — ${KIND_LABEL[bank.kind]}`,
  });
}

// Stable, deterministic order: the syllabus bank first, then banks by path.
entries.sort((a, b) => {
  if (a.kind === 'syllabus') return -1;
  if (b.kind === 'syllabus') return 1;
  return a.path.localeCompare(b.path);
});

const manifest = {
  version: pkg.version,
  generatedAt: new Date().toISOString().slice(0, 10),
  banks: entries,
};

// Validate our own output before writing so a generator bug fails loudly.
ManifestSchema.parse(manifest);

const outFile = resolve(CONTENT_DIR, 'manifest.json');
writeFileSync(outFile, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`wrote ${outFile} (${entries.length} banks)`);
