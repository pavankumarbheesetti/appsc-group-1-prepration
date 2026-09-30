/**
 * Content-validation gate (CLI).
 *
 * Validates EVERY content bank under `content/` against the Zod schemas plus the
 * cross-file integrity checks in `src/content/validate.ts`, prints a per-file
 * PASS/FAIL report and a final tally, and exits non-zero if anything FAILS so it
 * works as a CI gate.
 *
 * The validation logic lives in `src/content/validate.ts` and is shared with the
 * Vitest suite (`content-integrity.test.ts`) — this file is only the reporter.
 *
 * Run via `npm run validate:content` (executed with vite-node, matching gen:schema).
 */
import { validateAllContent } from '../src/content/validate';

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

const passed = results.length - failed;
console.log('');
console.log(
  `content validation: ${passed}/${results.length} files OK` +
    (failed ? `, ${failed} FAILED` : '') +
    (warned ? ` (${warned} warning${warned === 1 ? '' : 's'})` : ''),
);

if (failed > 0) {
  console.error(`\n✗ content validation FAILED: ${failed} file(s) with errors`);
  process.exit(1);
}

console.log('\n✓ all content banks valid');
