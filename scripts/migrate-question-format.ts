/**
 * One-off, IDEMPOTENT migration: lift match / statement / Assertion-Reason MCQ
 * stems into the structured `match` / `statements` / `assertion`+`reason`
 * fields (see `.research/plan/QUESTION-FORMAT.md`) and reduce `question` to the
 * clean lead-in (plus an optional closing prompt on its own line).
 *
 * - Items that already carry a structured field are left untouched, so a rerun
 *   is a no-op.
 * - An item is rewritten ONLY when the shared extractor
 *   (`src/lib/question-structure.ts`) is confident; everything else is listed
 *   in `.research/question-align/MIGRATION-REPORT.md` with the reason, together
 *   with every INCOMPLETE list (options reference a key the stem lacks).
 * - Files are rewritten only when something changed, keeping 2-space JSON and
 *   each file's trailing-newline convention.
 *
 * Run: `npx vite-node scripts/migrate-question-format.ts` (add `--dry` to only
 * write the report).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  classifyStem,
  extractAR,
  extractMatch,
  extractStatements,
  hasStructured,
  type StructuredKind,
} from '../src/lib/question-structure';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// MIGRATE_CONTENT_DIR lets the report be regenerated against a pristine copy.
const CONTENT = process.env.MIGRATE_CONTENT_DIR ? resolve(process.env.MIGRATE_CONTENT_DIR) : join(ROOT, 'content');
const REPORT = join(ROOT, '.research/question-align/MIGRATION-REPORT.md');
const dry = process.argv.includes('--dry');

type Item = Record<string, unknown> & { id: string; question: string; options: string[] };

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/^mcq-.*\.json$/.test(f)) out.push(p);
  }
  return out;
}

/** Rebuild `item` with `fields` inserted right after `question` (stable key order). */
function withFields(item: Item, question: string, fields: Record<string, unknown>): Item {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(item)) {
    if (k === 'question') {
      out.question = question;
      Object.assign(out, fields);
    } else if (!(k in fields)) out[k] = v;
  }
  return out as Item;
}

const migrated: Record<StructuredKind, number> = { match: 0, statements: 0, ar: 0 };
const already: Record<StructuredKind, number> = { match: 0, statements: 0, ar: 0 };
const unparsed: { id: string; file: string; kind: StructuredKind; reason: string }[] = [];
const incomplete: { id: string; file: string; kind: StructuredKind; reason: string }[] = [];
const notes: { id: string; note: string }[] = [];
let filesChanged = 0;

for (const file of walk(CONTENT).sort()) {
  const raw = readFileSync(file, 'utf8');
  const bank = JSON.parse(raw) as { items: Item[] };
  const rel = `content/${relative(CONTENT, file)}`;
  let changed = false;

  bank.items = bank.items.map((item) => {
    if (hasStructured(item as never)) {
      const k: StructuredKind = item.match ? 'match' : item.assertion ? 'ar' : 'statements';
      already[k] += 1;
      return item;
    }
    const kind = classifyStem(item.question);
    if (!kind) {
      // Roman-numbered statement lists (I., II.) are deliberately not migrated:
      // their options cite the roman numerals, which `statements` would renumber.
      if (/(^|\n)\s*\(?I[.)]\s/.test(item.question) && /(^|\n)\s*\(?II[.)]\s/.test(item.question)) {
        unparsed.push({ id: item.id, file: rel, kind: 'statements', reason: 'roman-numbered (I/II) statements cited by options; left as plain stem' });
      }
      return item;
    }
    const res =
      kind === 'match'
        ? extractMatch(item.question, item.options)
        : kind === 'statements'
          ? extractStatements(item.question, item.options)
          : extractAR(item.question);
    if (!res.ok) {
      const rec = { id: item.id, file: rel, kind, reason: res.reason };
      if (res.reason.startsWith('INCOMPLETE')) incomplete.push(rec);
      else unparsed.push(rec);
      return item;
    }
    for (const n of res.notes) notes.push({ id: item.id, note: n });
    migrated[kind] += 1;
    changed = true;
    let fields: Record<string, unknown>;
    if (kind === 'match') fields = { match: res.value };
    else if (kind === 'statements') fields = { statements: res.value };
    else {
      const v = res.value as { assertion: string; reason: string };
      fields = { assertion: v.assertion, reason: v.reason };
    }
    const next = withFields(item, res.question, fields);
    if (res.options) {
      // Keep the explanation's quoted option codes (e.g. "Why not the others"
      // rows) in step with the renormalised option strings.
      if (typeof next.explanation === 'string') {
        let exp = next.explanation;
        item.options.forEach((old, i) => {
          exp = exp.split(old).join(res.options![i]!);
        });
        next.explanation = exp;
      }
      next.options = res.options;
    }
    return next;
  });

  if (changed && !dry) {
    const trailingNl = raw.endsWith('\n') ? '\n' : '';
    writeFileSync(file, `${JSON.stringify(bank, null, 2)}${trailingNl}`);
    filesChanged += 1;
  }
}

/* ---- Report -------------------------------------------------------------- */

const lines: string[] = [
  '# Question-format migration report',
  '',
  `Generated by \`scripts/migrate-question-format.ts\`${dry ? ' (dry run: items listed as "migrated" are what the run rewrites)' : ''}.`,
  '',
  ...(process.env.MIGRATE_CONTENT_DIR
    ? ['Regenerated against a pristine pre-migration copy of `content/` (the real run rewrote exactly these items).', '']
    : []),
  '## Totals',
  '',
  '| Type | Migrated this run | Already structured |',
  '|---|---|---|',
  `| match | ${migrated.match} | ${already.match} |`,
  `| statements | ${migrated.statements} | ${already.statements} |`,
  `| assertion-reason | ${migrated.ar} | ${already.ar} |`,
  '',
  `Files rewritten: ${filesChanged}. Not parsed confidently: ${unparsed.length}. Incomplete lists: ${incomplete.length}.`,
  '',
  '## Incomplete lists (options reference keys/statements the stem lacks) — FIX CONTENT',
  '',
  ...(incomplete.length === 0 ? ['None.'] : incomplete.map((u) => `- \`${u.id}\` (${u.kind}, ${u.file}): ${u.reason}`)),
  '',
  '## Not parsed confidently (left unchanged; renderer falls back to stem parsing)',
  '',
  ...(unparsed.length === 0 ? ['None.'] : unparsed.map((u) => `- \`${u.id}\` (${u.kind}, ${u.file}): ${u.reason}`)),
  '',
  '## Migrated with notes (review wording)',
  '',
  ...(notes.length === 0 ? ['None.'] : notes.map((n) => `- \`${n.id}\`: ${n.note}`)),
  '',
];
// An idempotent rerun that migrates nothing keeps the original report (which
// carries the per-item migration notes) unless --report forces a rewrite.
const migratedTotal = migrated.match + migrated.statements + migrated.ar;
if (migratedTotal > 0 || dry || process.argv.includes('--report') || !existsSync(REPORT)) {
  mkdirSync(dirname(REPORT), { recursive: true });
  writeFileSync(REPORT, lines.join('\n'));
} else {
  console.log('nothing to migrate — existing report kept (pass --report to rewrite)');
}
console.log(
  `migrated match=${migrated.match} statements=${migrated.statements} ar=${migrated.ar}; ` +
    `already match=${already.match} statements=${already.statements} ar=${already.ar}; ` +
    `unparsed=${unparsed.length} incomplete=${incomplete.length}; files=${filesChanged}${dry ? ' (dry)' : ''}`,
);
console.log(`report: ${relative(ROOT, REPORT)}`);
