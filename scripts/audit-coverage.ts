/**
 * Independent coverage-audit gate (CLI).
 *
 * Measures how well the authored content covers the OFFICIAL SYLLABUS and the
 * PYQs — NOT the authors' own examPoints. It reads every content bank from disk
 * (`node:fs`, like `validate-content.ts`), builds the SAME evidence index the
 * in-app panel builds, runs the SHARED pure auditor (`src/lib/audit.ts`), prints
 * a per-paper / PYQ / AP-share table, and writes a Markdown snapshot to
 * `.research/audit/latest.md`.
 *
 * It EXITS NON-ZERO when any Prelims clause is MISSING or any Prelims-track
 * subtopic is orphaned (unmapped), so `npm run check` (which chains
 * `audit:coverage`) gates CI on those two honest failures only — THIN clauses
 * are reported but never block, so genuine gaps stay visible.
 *
 * Run via `npm run audit:coverage` (executed with vite-node, matching the other
 * content scripts so it can import the TS schemas/auditor directly).
 */
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePyqMap, parseSyllabusMap } from '../src/content/audit-types';
import { ContentBankSchema } from '../src/content/types';
import { TaxonomySchema } from '../src/content/taxonomy';
import {
  computeAudit,
  mainsEvidenceText,
  mcqEvidenceText,
  noteEvidenceText,
  type EvidenceIndex,
  type SubtopicEvidence,
} from '../src/lib/audit';
import type { SubjectCode } from '../src/content/types';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..');
const CONTENT_DIR = resolve(ROOT, 'content');

/** Recursively collect every `*.json` file under `dir`. */
function walkJsonFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) out.push(...walkJsonFiles(abs));
    else if (entry.endsWith('.json')) out.push(abs);
  }
  return out;
}

/** Read + parse a JSON file. */
function readJson(abs: string): unknown {
  return JSON.parse(readFileSync(abs, 'utf8')) as unknown;
}

/* -------------------------------------------------------------------------- */
/* Build the evidence index from disk                                          */
/* -------------------------------------------------------------------------- */

const taxonomy = TaxonomySchema.parse(readJson(join(CONTENT_DIR, 'taxonomy.json')));
const subjectOf = new Map<string, SubjectCode>();
for (const s of taxonomy.subtopics) subjectOf.set(s.id, s.subjectCode);

/** Mutable evidence accumulator (frozen into the read-only index below). */
interface MutableEvidence {
  subject: SubjectCode;
  mcqTexts: string[];
  noteTexts: string[];
  mainsTexts: string[];
}
const acc = new Map<string, MutableEvidence>();
const bucket = (id: string, subject: SubjectCode): MutableEvidence => {
  let b = acc.get(id);
  if (!b) {
    b = { subject, mcqTexts: [], noteTexts: [], mainsTexts: [] };
    acc.set(id, b);
  }
  return b;
};

for (const abs of walkJsonFiles(CONTENT_DIR)) {
  const file = abs.slice(ROOT.length).split('\\').join('/');
  if (file.endsWith('/manifest.json') || file.endsWith('/taxonomy.json')) continue;
  if (file.startsWith('/content/audit/')) continue;
  const raw = readJson(abs) as { kind?: unknown } | null;
  if (!raw || (raw.kind !== 'mcq' && raw.kind !== 'notes' && raw.kind !== 'mains')) continue;
  const bank = ContentBankSchema.parse(raw);
  for (const item of bank.items) {
    const id = item.subtopicId;
    if (!id) continue;
    const subject = subjectOf.get(id) ?? item.subjectCode;
    const b = bucket(id, subject);
    if (bank.kind === 'mcq') b.mcqTexts.push(mcqEvidenceText(item));
    else if (bank.kind === 'notes') b.noteTexts.push(noteEvidenceText(item));
    else b.mainsTexts.push(mainsEvidenceText(item));
  }
}

const evidence: EvidenceIndex = new Map<string, SubtopicEvidence>(acc);

/* -------------------------------------------------------------------------- */
/* Run the audit                                                               */
/* -------------------------------------------------------------------------- */

const syllabusMap = parseSyllabusMap(readJson(join(CONTENT_DIR, 'audit', 'syllabus-map.json')));
const pyqMap = parsePyqMap(readJson(join(CONTENT_DIR, 'audit', 'pyq-map.json')));
const report = computeAudit(syllabusMap, pyqMap, evidence);

/* -------------------------------------------------------------------------- */
/* Gate inputs: Prelims MISSING clauses + orphan Prelims-track subtopics        */
/* -------------------------------------------------------------------------- */

/** Effective exam track of a subject (used to find Prelims-track subtopics). */
const subjectTrackOf = new Map<string, string | undefined>();
for (const s of taxonomy.subjects) subjectTrackOf.set(s.code, s.track);

/** Every subtopic id referenced by at least one syllabus-map clause. */
const referencedSubtopics = new Set<string>();
for (const c of syllabusMap) for (const id of c.subtopicIds) referencedSubtopics.add(id);

/**
 * Prelims-track taxonomy subtopics NOT referenced by any clause — invisible to
 * the audit, so the gate rejects them (the effective track is the subtopic
 * override, else its subject's track).
 */
const orphanPrelimsSubtopics = taxonomy.subtopics
  .filter((s) => {
    const track = s.track ?? subjectTrackOf.get(s.subjectCode);
    return track === 'paper1' || track === 'paper2';
  })
  .filter((s) => !referencedSubtopics.has(s.id))
  .map((s) => s.id)
  .sort();

/** Prelims clauses classified MISSING — the hard gate (THIN is reported, not gated). */
const prelimsMissing = report.clauses.filter(
  (c) => (c.paper === 'prelims-1' || c.paper === 'prelims-2') && c.status === 'MISSING',
);

/* -------------------------------------------------------------------------- */
/* Print + persist                                                             */
/* -------------------------------------------------------------------------- */

/** Human label per audit paper, for the table + Markdown. */
const PAPER_LABEL: Record<string, string> = {
  'prelims-1': 'Prelims Paper-I',
  'prelims-2': 'Prelims Paper-II',
  'mains-telugu': 'Mains Telugu (Q)',
  'mains-english': 'Mains English (Q)',
  'mains-1': 'Mains Paper-I (Essay)',
  'mains-2': 'Mains Paper-II',
  'mains-3': 'Mains Paper-III',
  'mains-4': 'Mains Paper-IV',
  'mains-5': 'Mains Paper-V',
};

console.log('\n=== APPSC Group-1 — Independent Coverage Audit ===\n');
console.log('Per-paper traceability (COVERED / total):');
for (const p of report.papers) {
  const label = (PAPER_LABEL[p.paper] ?? p.paper).padEnd(22);
  console.log(
    `  ${label} ${String(p.pct).padStart(3)}%  ` +
      `(${p.covered}/${p.total} covered · ${p.thin} thin · ${p.missing} missing)`,
  );
}

console.log(
  `\nPrelims: ${report.prelimsTraceabilityPct}% COVERED · ` +
    `${prelimsMissing.length} MISSING · ${orphanPrelimsSubtopics.length} orphan subtopic(s)  ` +
    `(gate = no Prelims MISSING + no orphan; THIN is reported, not gated)`,
);
console.log(
  `\nPYQ evidence: ${report.pyq.hitPct}% HIT  ` +
    `(${report.pyq.hit} hit · ${report.pyq.near} near · ${report.pyq.miss} miss of ${report.pyq.total})`,
);

console.log('\nAP share per subject (actual / target · AP-specific items / total):');
for (const a of report.apShareBySubject) {
  const tgt = a.target === null ? '  —' : `${String(a.target).padStart(3)}%`;
  const flag = a.target === null ? 'exempt' : a.meetsTarget ? '✓' : '✗ BELOW FLOOR';
  console.log(
    `  ${a.subject.padEnd(5)} ${String(a.pct).padStart(3)}% / ${tgt}  ` +
      `(${a.apItems}/${a.totalItems})  ${flag}`,
  );
}

if (report.thinMissing.length > 0) {
  console.log(`\nTHIN / MISSING clauses (${report.thinMissing.length}):`);
  for (const c of report.thinMissing) {
    const lacking = c.specificKeywords.filter((k) => !c.matchedKeywords.includes(k));
    console.log(
      `  [${c.status.padEnd(7)}] ${c.ref.padEnd(8)} ${PAPER_LABEL[c.paper] ?? c.paper} — ${c.clause}`,
    );
    console.log(
      `             evidence: ${c.mcqEvidence} mcq · ${c.noteEvidence} notes · ` +
        `${c.mainsEvidence} mains · keywords ${c.keywordCoveragePct}% ` +
        `(matched [${c.matchedKeywords.join(', ')}] · lacking [${lacking.join(', ')}])`,
    );
  }
} else {
  console.log('\nNo THIN/MISSING clauses — every clause is COVERED.');
}

if (orphanPrelimsSubtopics.length > 0) {
  console.log(
    `\nOrphan Prelims-track subtopics (${orphanPrelimsSubtopics.length}): ` +
      orphanPrelimsSubtopics.join(', '),
  );
} else {
  console.log('\nNo orphan Prelims-track subtopics — every one is mapped by ≥1 clause.');
}

/* ----- Markdown snapshot -------------------------------------------------- */

const lines: string[] = [];
lines.push('# APPSC Group-1 — Independent Coverage Audit');
lines.push('');
lines.push(`_Generated ${new Date().toISOString()} by \`npm run audit:coverage\`._`);
lines.push('');
lines.push(
  'Coverage is measured against the **official syllabus** (Notification 07/2026) ' +
    'and **PYQs**, via keyword evidence in the mapped subtopics — not the authors\u2019 examPoints.',
);
lines.push('');
lines.push('## Per-paper traceability');
lines.push('');
lines.push('| Paper | Traceability | Covered | Thin | Missing |');
lines.push('| --- | ---: | ---: | ---: | ---: |');
for (const p of report.papers) {
  lines.push(
    `| ${PAPER_LABEL[p.paper] ?? p.paper} | ${p.pct}% | ${p.covered}/${p.total} | ${p.thin} | ${p.missing} |`,
  );
}
lines.push('');
lines.push(
  `**Prelims: ${report.prelimsTraceabilityPct}% COVERED**, ${prelimsMissing.length} MISSING, ` +
    `${orphanPrelimsSubtopics.length} orphan subtopic(s). ` +
    'CI gate = **no Prelims clause MISSING** and **no orphan Prelims subtopic** ' +
    '(THIN is reported, not gated).',
);
lines.push('');
lines.push('## PYQ evidence');
lines.push('');
lines.push(
  `**${report.pyq.hitPct}% HIT** — ${report.pyq.hit} hit · ${report.pyq.near} near · ` +
    `${report.pyq.miss} miss of ${report.pyq.total} tracked PYQ topics.`,
);
lines.push('');
lines.push('## AP share per subject');
lines.push('');
lines.push('| Subject | AP share | Target (floor) | Meets? | AP items | Total items |');
lines.push('| --- | ---: | ---: | :---: | ---: | ---: |');
for (const a of report.apShareBySubject) {
  const tgt = a.target === null ? '—' : `${a.target}%`;
  const meets = a.target === null ? 'exempt' : a.meetsTarget ? '✓' : '✗';
  lines.push(`| ${a.subject} | ${a.pct}% | ${tgt} | ${meets} | ${a.apItems} | ${a.totalItems} |`);
}
lines.push('');
lines.push(
  'AP-share **floors** (`AP_TARGETS`) ratchet at `max(PYQ-based target, achieved level)`; ' +
    'the gate FAILS if any subject falls below its floor. MENT/TEL/ENG are AP-neutral (no floor).',
);
lines.push('');
lines.push('## THIN / MISSING clauses');
lines.push('');
if (report.thinMissing.length === 0) {
  lines.push('_None — every clause is COVERED._');
} else {
  lines.push('| Status | Ref | Paper | Clause | Keywords | MCQ ev. | Note ev. | Mains ev. | Lacking keywords |');
  lines.push('| --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- |');
  for (const c of report.thinMissing) {
    const clause = c.clause.replace(/\|/g, '\\|');
    const lacking = c.specificKeywords
      .filter((k) => !c.matchedKeywords.includes(k))
      .join(', ')
      .replace(/\|/g, '\\|');
    lines.push(
      `| ${c.status} | ${c.ref} | ${PAPER_LABEL[c.paper] ?? c.paper} | ${clause} | ` +
        `${c.keywordCoveragePct}% | ${c.mcqEvidence} | ${c.noteEvidence} | ${c.mainsEvidence} | ${lacking || '—'} |`,
    );
  }
}
lines.push('');
lines.push('## Orphan Prelims-track subtopics');
lines.push('');
if (orphanPrelimsSubtopics.length === 0) {
  lines.push('_None — every Prelims-track subtopic is referenced by ≥1 clause._');
} else {
  for (const id of orphanPrelimsSubtopics) lines.push(`- \`${id}\``);
}
lines.push('');

const outMd = resolve(ROOT, '.research/audit/latest.md');
mkdirSync(dirname(outMd), { recursive: true });
writeFileSync(outMd, `${lines.join('\n')}\n`);
console.log(`\nWrote ${outMd}`);

/* ----- Gate --------------------------------------------------------------- */

const gateFailures: string[] = [];
if (prelimsMissing.length > 0) {
  gateFailures.push(
    `${prelimsMissing.length} Prelims clause(s) MISSING: ${prelimsMissing.map((c) => c.ref).join(', ')}`,
  );
}
if (orphanPrelimsSubtopics.length > 0) {
  gateFailures.push(
    `${orphanPrelimsSubtopics.length} orphan Prelims-track subtopic(s): ${orphanPrelimsSubtopics.join(', ')}`,
  );
}
if (report.apTargetFailures.length > 0) {
  gateFailures.push(
    `${report.apTargetFailures.length} subject(s) below AP-share floor: ` +
      report.apTargetFailures
        .map((a) => `${a.subject} ${a.pct}% < ${a.target}%`)
        .join(', '),
  );
}

if (gateFailures.length > 0) {
  console.error(
    '\n\u2717 audit FAILED (gate = no Prelims clause MISSING + no orphan Prelims subtopic + every AP-share floor met):',
  );
  for (const f of gateFailures) console.error(`   - ${f}`);
  process.exit(1);
}
console.log(
  '\n\u2713 audit passed: no Prelims clause MISSING, no orphan Prelims-track subtopic, ' +
    'and every AP-share floor met (THIN is reported, not gated).',
);
