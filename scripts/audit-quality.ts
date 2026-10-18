/**
 * Question-quality audit (CLI) — the visible fix queue for exam-standard MCQs.
 *
 * Runs the shared `question-quality` rule (`auditAllQuality` in
 * `src/content/validate.ts`; standard: `.research/plan/QUESTION-QUALITY.md`),
 * prints one row per MCQ bank ordered WORST-FIRST (by score), and writes
 * `.research/quality/BASELINE.md` with per-subject and per-bank metrics:
 * items, answer spread A/B/C/D, all-correct %, short stems, homogeneity
 * violations, bank rules failed and waiver status.
 *
 * EXIT CODE: non-zero when any finding is NOT covered by
 * `content/audit/quality-waivers.json` — i.e. a bank without a waiver has a
 * violation, a waiver is stale (bank clean or unknown), or the waivers file is
 * invalid. Waived banks are reported, never failed, so the fix can land bank by
 * bank: fix a bank, delete its waiver, re-run. NOT chained into `npm run check`
 * yet (the quality rule is report-only for now).
 *
 * Flags (the tests use them to run against fixtures):
 *   --content-dir <dir>  content root to audit (default: ./content)
 *   --out <file>         BASELINE.md path (default: .research/quality/BASELINE.md)
 *   --verbose            print every finding, not only the per-bank table
 *   --seed-waivers       (re)write <content-dir>/audit/quality-waivers.json waiving
 *                        every bank that currently has findings, then exit 0
 *
 * Run via `npm run audit:quality`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  auditAllQuality,
  qualityExitCode,
  type BankQuality,
  type QualityRule,
} from '../src/content/validate';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Value of `--flag <value>`, or undefined. */
function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const contentDir = resolve(argValue('--content-dir') ?? resolve(ROOT, 'content'));
const outFile = resolve(argValue('--out') ?? resolve(ROOT, '.research/quality/BASELINE.md'));
const verbose = process.argv.includes('--verbose');

let report = auditAllQuality(contentDir);

/* ----- --seed-waivers: baseline every currently failing bank ---------------- */

if (process.argv.includes('--seed-waivers')) {
  const waivers = report.banks
    .filter((b) => b.findings.length > 0)
    .map((b) => ({
      bank: b.file,
      why: 'baseline — pending exam-standard quality rewrite (QUESTION-QUALITY.md)',
    }))
    .sort((a, b) => a.bank.localeCompare(b.bank));
  const path = join(contentDir, 'audit', 'quality-waivers.json');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify(
      {
        version: 1,
        source:
          'Per-bank allowlist for the question-quality rule (.research/plan/QUESTION-QUALITY.md). A listed bank is reported but not failed by VALIDATE_QUALITY=1 / npm run audit:quality. Remove a bank once it is clean; a stale entry fails the gate. Optional "rules" narrows a waiver.',
        waivers,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`wrote ${path} (${waivers.length} bank waiver(s))`);
  report = auditAllQuality(contentDir);
}

/* ----- Optional subject labels ------------------------------------------- */

const subjectName = new Map<string, string>();
const taxonomyPath = resolve(contentDir, 'taxonomy.json');
if (existsSync(taxonomyPath)) {
  try {
    const t = JSON.parse(readFileSync(taxonomyPath, 'utf8')) as {
      subjects?: { code: string; name: string }[];
    };
    for (const s of t.subjects ?? []) subjectName.set(s.code, s.name);
  } catch {
    /* labels are cosmetic */
  }
}

/* ----- Helpers ------------------------------------------------------------- */

const pct = (n: number, d: number): string => (d === 0 ? '—' : `${Math.round((n / d) * 100)}%`);
const spreadPct = (s: readonly number[], d: number): string =>
  s.map((c) => (d === 0 ? '—' : String(Math.round((c / d) * 100)))).join('/');
const BANK_RULES: QualityRule[] = ['answer-spread', 'all-correct-share', 'key-variety'];
const bankRulesFailed = (b: BankQuality): string =>
  BANK_RULES.filter((r) => b.violations[r]).join(', ') || '—';
const waiverLabel = (b: BankQuality): string =>
  b.waived === false ? 'no' : b.waived === true ? 'yes' : b.waived.join('+');
const shortName = (file: string): string =>
  file.replace(/^\/content\//, '').replace(/\/[^/]+\.json$/, '');

/* ----- Console table (worst-first) ---------------------------------------- */

const header = [
  '#',
  'bank',
  'items',
  'A/B/C/D %',
  'all-correct',
  'short',
  'homog',
  'bank rules failed',
  'waived',
  'score',
];
const rows = report.banks.map((b, i) => [
  String(i + 1),
  shortName(b.file),
  String(b.items),
  spreadPct(b.spread, b.fourOptionItems),
  `${pct(b.allCorrect, b.items)} (${b.allCorrectStatements}/${b.statementItems} stmt)`,
  String(b.shortStems),
  String(b.homogeneity),
  bankRulesFailed(b),
  waiverLabel(b),
  b.score.toFixed(1),
]);
const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
const line = (cells: string[]): string => cells.map((c, i) => c.padEnd(widths[i]!)).join(' | ');
console.log(line(header));
console.log(widths.map((w) => '-'.repeat(w)).join('-|-'));
for (const r of rows) console.log(line(r));

const exitCode = qualityExitCode(report);
for (const f of report.findings) {
  if (verbose || (!f.waived && exitCode !== 0))
    console.log(`  ${f.waived ? '⚠' : '✗'} [${f.rule}] ${f.file} ${f.itemId}: ${f.detail}`);
}

/* ----- Totals -------------------------------------------------------------- */

const total = report.banks.reduce(
  (t, b) => {
    t.items += b.items;
    t.four += b.fourOptionItems;
    b.spread.forEach((c, i) => (t.spread[i]! += c));
    t.allCorrect += b.allCorrect;
    t.stmt += b.statementItems;
    t.stmtAll += b.allCorrectStatements;
    t.short += b.shortStems;
    t.homog += b.homogeneity;
    return t;
  },
  {
    items: 0,
    four: 0,
    spread: [0, 0, 0, 0],
    allCorrect: 0,
    stmt: 0,
    stmtAll: 0,
    short: 0,
    homog: 0,
  },
);
const byRule = new Map<QualityRule, number>();
for (const f of report.findings) byRule.set(f.rule, (byRule.get(f.rule) ?? 0) + 1);
const skewed = report.banks.filter((b) =>
  b.spread.some((c) => b.fourOptionItems > 0 && c / b.fourOptionItems > 0.4),
);
const clean = report.banks.filter((b) => b.findings.length === 0);
const unwaived = report.findings.filter((f) => !f.waived);

/* ----- BASELINE.md --------------------------------------------------------- */

const md: string[] = [];
md.push('# Question-quality baseline');
md.push('');
md.push(
  'Generated by `npm run audit:quality` against the exam standard in `.research/plan/QUESTION-QUALITY.md`. ' +
    'Banks are ordered WORST-FIRST by score = pct-points outside the answer-spread band + pct-points over the 20% ' +
    'all-correct cap (when that rule fires) + 10 if key-variety fails + % of items with an item-level finding. ' +
    '"all-correct" = share of ALL items keyed all-statements-correct / Both / All of the above (the bank rule uses the ' +
    'statement-item share shown in brackets). "homog" = option-length + option-duplicate + option-filler + option-absolute findings.',
);
md.push('');
md.push(
  `Gate: **${exitCode === 0 ? 'PASS' : 'FAIL'}** — ${unwaived.length} un-waived finding(s); ` +
    `${report.banks.filter((b) => b.waived !== false).length} bank(s) waived in \`content/audit/quality-waivers.json\`, ${clean.length} clean.`,
);
md.push('');
md.push('## Totals');
md.push('');
md.push(`- Items: **${total.items}** in **${report.banks.length}** MCQ banks`);
md.push(
  `- Answer spread A/B/C/D: **${spreadPct(total.spread, total.four)}** (target 25 each; per bank 20–30)`,
);
md.push(
  `- All-correct keys: **${total.allCorrect}** (${pct(total.allCorrect, total.items)} of items); statement items keyed all-correct: ` +
    `**${total.stmtAll}/${total.stmt}** (${pct(total.stmtAll, total.stmt)}; cap 20% per bank)`,
);
md.push(`- Banks with > 40% of keys on one option: **${skewed.length}**`);
md.push(
  `- Short stems (< 45 chars rendered): **${total.short}**; homogeneity findings: **${total.homog}**`,
);
md.push(
  `- Findings by rule: ${[...byRule.entries()].map(([r, n]) => `\`${r}\`=${n}`).join(', ') || 'none'}`,
);
md.push('');
md.push('## Per subject');
md.push('');
md.push(
  '| Subject | Banks | Items | A/B/C/D % | All-correct % | Stmt all-correct | Short stems | Homog. | Banks failing a bank rule |',
);
md.push('|---|---|---|---|---|---|---|---|---|');
const subjects = [...new Set(report.banks.map((b) => b.subjectCode))].sort();
for (const code of subjects) {
  const bs = report.banks.filter((b) => b.subjectCode === code);
  const sp = [0, 0, 0, 0];
  let items = 0,
    four = 0,
    all = 0,
    st = 0,
    stAll = 0,
    short = 0,
    homog = 0;
  for (const b of bs) {
    items += b.items;
    four += b.fourOptionItems;
    b.spread.forEach((c, i) => (sp[i]! += c));
    all += b.allCorrect;
    st += b.statementItems;
    stAll += b.allCorrectStatements;
    short += b.shortStems;
    homog += b.homogeneity;
  }
  md.push(
    `| ${code}${subjectName.has(code) ? ` (${subjectName.get(code)})` : ''} | ${bs.length} | ${items} | ${spreadPct(sp, four)} | ` +
      `${pct(all, items)} | ${stAll}/${st} (${pct(stAll, st)}) | ${short} | ${homog} | ${bs.filter((b) => bankRulesFailed(b) !== '—').length} |`,
  );
}
md.push('');
md.push('## Per bank (fix queue, worst first)');
md.push('');
md.push(
  '| # | Bank | Subject | Items | A/B/C/D % | All-correct % | Stmt all-correct | Short stems | Homog. | Bank rules failed | Waived | Score |',
);
md.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
report.banks.forEach((b, i) => {
  md.push(
    `| ${i + 1} | ${shortName(b.file)} | ${b.subjectCode} | ${b.items} | ${spreadPct(b.spread, b.fourOptionItems)} | ${pct(b.allCorrect, b.items)} | ` +
      `${b.allCorrectStatements}/${b.statementItems} | ${b.shortStems} | ${b.homogeneity} | ${bankRulesFailed(b)} | ${waiverLabel(b)} | ${b.score.toFixed(1)} |`,
  );
});
const stale = report.findings.filter((f) => f.rule === 'waiver-stale');
if (stale.length > 0) {
  md.push('');
  md.push('## Stale / invalid waivers');
  md.push('');
  for (const f of stale) md.push(`- ${f.itemId}: ${f.detail}`);
}
md.push('');

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, md.join('\n'));

console.log('');
console.log(`wrote ${outFile}`);
console.log(
  `question quality: ${total.items} items / ${report.banks.length} banks; spread A/B/C/D ${spreadPct(total.spread, total.four)}; ` +
    `all-correct ${pct(total.allCorrect, total.items)}; ${skewed.length} bank(s) > 40% on one option; ${total.short} short stems; ` +
    `${unwaived.length} un-waived finding(s)`,
);
if (exitCode !== 0) {
  console.error(
    '\n✗ question-quality gate FAILED: un-waived findings (fix the bank, or the stale waiver)',
  );
  process.exit(exitCode);
}
console.log('\n✓ question-quality gate passed (waived banks reported only)');
