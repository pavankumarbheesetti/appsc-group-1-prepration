/**
 * Emit JSON Schema files from the Zod schemas.
 *
 * The Zod schemas in `src/content/types.ts` are the single source of truth;
 * this script derives JSON Schema (for editor tooling / external authoring /
 * CI checks) so the two representations never drift. Output lands in `schema/`
 * and is committed to the repo.
 *
 * Run via `npm run gen:schema`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  MainsBankSchema,
  ManifestSchema,
  MCQBankSchema,
  NotesBankSchema,
  CardsBankSchema,
  MindmapBankSchema,
  SyllabusBankSchema,
} from '../src/content/types';
import { PyqMapSchema, PyqWeightsSchema, SyllabusMapSchema } from '../src/content/audit-types';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '../schema');
mkdirSync(outDir, { recursive: true });

// Bank-level schemas: each generated file validates a whole content JSON file.
const targets = [
  ['mcq', MCQBankSchema],
  ['notes', NotesBankSchema],
  ['mains', MainsBankSchema],
  ['cards', CardsBankSchema],
  ['mindmap', MindmapBankSchema],
  ['syllabus', SyllabusBankSchema],
  ['manifest', ManifestSchema],
  ['audit-syllabus-map', SyllabusMapSchema],
  ['audit-pyq-map', PyqMapSchema],
  ['audit-pyq-weights', PyqWeightsSchema],
] as const;

for (const [name, schema] of targets) {
  const jsonSchema = zodToJsonSchema(schema, { name });
  const file = resolve(outDir, `${name}.schema.json`);
  writeFileSync(file, `${JSON.stringify(jsonSchema, null, 2)}\n`);
  console.log(`wrote ${file}`);
}
