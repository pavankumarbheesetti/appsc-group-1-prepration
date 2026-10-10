/**
 * Content-validation gate (CLI).
 *
 * Validates EVERY content bank under `content/` against the Zod schemas plus the
 * cross-file integrity checks in `src/content/validate.ts`, prints a per-file
 * PASS/FAIL report and a final tally, and exits non-zero if anything FAILS so it
 * works as a CI gate.
 *
 * On top of the hard schema/integrity gate it ALSO runs the advisory
 * content-formatting LINT (`lintAllContent`) and the explanation-STRUCTURE lint
 * (`auditAllStructure`) — textbook jargon, bare carets, broken tables, obvious
 * typos, missing beginner-note structure — and prints each hit as a WARNING,
 * counted in the final tally. Finalizers can require that count to reach 0.
 * Passing `--strict` promotes BOTH the formatting and structure hits to hard
 * failures (non-zero exit); `npm run check` runs with `--strict` so any
 * formatting or structure regression fails the gate now that content is clean.
 *
 * The validation logic lives in `src/content/validate.ts` and is shared with the
 * Vitest suite (`content-integrity.test.ts`) — this file is only the reporter.
 *
 * Run via `npm run validate:content` (executed with vite-node, matching gen:schema).
 */
import {
  auditAllStructure,
  lintAllContent,
  validateAllContent,
  type LintRule,
  type StructureFlag,
} from '../src/content/validate';

const strict = process.argv.includes('--strict');

const results = validateAllContent();

let failed = 0;
let warned = 0;

for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.file}`);
  for (const e of r.errors) {
    console.log(`        ✗ ${e}`);
  }
  for (const w of r.warnings) {
    console.log(`        ⚠ ${w}`);
    warned += 1;
  }
  if (!r.ok) failed += 1;
}

/* ----- Content-formatting lint (advisory, or hard under --strict) ---------- */

const lint = lintAllContent();
const byRule = new Map<LintRule, number>();
if (lint.length > 0) {
  console.log('');
  console.log(`content formatting lint: ${lint.length} issue(s)${strict ? ' (STRICT — treated as errors)' : ' (warnings)'}`);
  let currentFile = '';
  for (const f of lint) {
    if (f.file !== currentFile) {
      currentFile = f.file;
      console.log(`  ${f.file}`);
    }
    const mark = strict ? '✗' : '⚠';
    console.log(`        ${mark} [${f.rule}] ${f.itemId} ${f.field}: ${f.snippet}`);
    byRule.set(f.rule, (byRule.get(f.rule) ?? 0) + 1);
  }
  const rules = [...byRule.entries()].map(([r, n]) => `${r}=${n}`).join(', ');
  console.log(`  lint by rule: ${rules}`);
  if (strict) failed += lint.length;
  else warned += lint.length;
}

/* ----- Explanation-structure lint (advisory warnings; NOT strict in check) - */

const structure = auditAllStructure();
const byStructureFlag = new Map<StructureFlag, number>();
if (structure.length > 0) {
  console.log('');
  console.log(`explanation-structure lint: ${structure.length} issue(s) (warnings)`);
  let currentFile = '';
  const perFile = new Map<string, number>();
  for (const f of structure) {
    if (f.file !== currentFile) {
      currentFile = f.file;
      console.log(`  ${f.file}`);
    }
    console.log(`        ⚠ [${f.flag}] ${f.itemId} (${f.subjectCode}): ${f.detail}`);
    byStructureFlag.set(f.flag, (byStructureFlag.get(f.flag) ?? 0) + 1);
    perFile.set(f.file, (perFile.get(f.file) ?? 0) + 1);
  }
  const flags = [...byStructureFlag.entries()].map(([r, n]) => `${r}=${n}`).join(', ');
  console.log(`  structure by flag: ${flags}`);
  // Under --strict, structure findings are promoted to hard failures alongside
  // the formatting lint so `npm run check` fails on any formatting OR structure
  // regression once content is clean. Without --strict they remain advisory
  // warnings.
  if (strict) failed += structure.length;
  else warned += structure.length;
}

const passed = results.length - results.filter((r) => !r.ok).length;
console.log('');
console.log(
  `content validation: ${passed}/${results.length} files OK` +
    (failed ? `, ${failed} FAILED` : '') +
    (warned ? ` (${warned} warning${warned === 1 ? '' : 's'})` : ''),
);

if (failed > 0) {
  console.error(`\n✗ content validation FAILED: ${failed} issue(s)`);
  process.exit(1);
}

console.log('\n✓ all content banks valid');
