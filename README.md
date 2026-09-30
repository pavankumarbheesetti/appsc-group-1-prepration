# APPSC Group-1 Preparation

A fresh, offline-first rebuild of an APPSC Group-1 exam preparation app.

The predecessor was a single 428 KB vanilla-JS HTML file (~395 inline `<script>`
tags, no build, no tests, no version control). This successor keeps the same
**offline-first / portable** promise — the production build is a **single
self-contained HTML file** that opens by double-clicking on `file://` with no
server and no network — while being **modular, typed, linted, and tested**.

## Stack

- **Node + npm**
- **Vite 5** — dev server + production bundler
- **TypeScript 5** (strict mode, `moduleResolution: bundler`, target ES2022)
- **vite-plugin-singlefile** — inlines all JS/CSS into one offline HTML file
- **ESLint 9** (flat config) + **typescript-eslint 8**
- **Prettier 3**
- **Vitest 2** (+ jsdom) for unit tests

Vanilla TypeScript with web-component-style modules. **No React/Vue.**

## npm scripts

| Script              | What it does                                                        |
| ------------------- | ------------------------------------------------------------------- |
| `npm run dev`       | Start the Vite dev server with HMR.                                 |
| `npm run build`     | Type-check then produce the single-file offline HTML in `dist/`.    |
| `npm run preview`   | Serve the production build locally to sanity-check it.              |
| `npm run lint`      | Run ESLint over the project.                                        |
| `npm run format`    | Format the codebase with Prettier.                                  |
| `npm test`          | Run the Vitest unit suite once.                                     |
| `npm run typecheck` | Type-check with `tsc --noEmit` (no output emitted).                 |
| `npm run validate:content` | Validate every content bank against the Zod schemas + cross-file integrity checks (the CI content gate). |
| `npm run gen:schema` | Regenerate the JSON Schemas under `schema/` from the Zod schemas. |
| `npm run gen:manifest` | Regenerate `content/manifest.json` from the banks on disk (auto-runs on `prebuild`). |
| `npm run check`     | Run the full gate: `typecheck` → `lint` → `validate:content` → `test`. |

## Offline build

`npm run build` emits a single `dist/index.html` with all JavaScript and CSS
inlined. Double-click it (or open via `file://`) — no server required.

## Adding content

Content lives as validated JSON banks under `content/`. To add a bank:

1. Create the file at `content/<subject>/<topic>/<kind>-<slug>.json`, where
   `<kind>` is one of `mcq`, `notes`, or `mains` (the syllabus bank is
   `kind: "syllabus"`). Its shape must match the Zod schemas in
   [`src/content/types.ts`](src/content/types.ts) — every item needs a unique
   `id`, an optional `syllabusRef` pointing at a syllabus node id, and an
   optional `subtopicId` pointing at a subtopic in
   [`content/taxonomy.json`](content/taxonomy.json). Setting `subtopicId` is what
   files the bank under the Syllabus tracker and Learn workspace.
2. Run `npm run gen:manifest` to regenerate
   [`content/manifest.json`](content/manifest.json). **The manifest is a DERIVED
   artifact** — you no longer edit it by hand. `gen:manifest` scans every bank
   under `content/**` (excluding `manifest.json` and `taxonomy.json`) and records
   each bank's kind/subject/topic/subtopicId + item count. It also runs
   automatically as a `prebuild` step, so a production build always registers new
   content. `npm run validate:content` then verifies the manifest matches disk.

The content taxonomy (subject → chapter → subtopic) lives in
[`content/taxonomy.json`](content/taxonomy.json), validated by the Zod schema in
[`src/content/taxonomy.ts`](src/content/taxonomy.ts). Add a subtopic there, then
author banks whose items carry the matching `subtopicId`.

Run `npm run validate:content` to check your work. The gate validates every bank
against the schemas and enforces cross-file integrity: manifest `count`s must
match the real item counts, every bank on disk must be registered (no orphans),
item `id`s must be globally unique, and MCQ `answerIndex` values must be in
range. It exits non-zero on any failure, so it doubles as a CI gate and also
runs inside `npm test` via `src/content/__tests__/content-integrity.test.ts`.

## Images & retention

Notes can carry images and must-remember material. All of these `NoteItem`
fields are **optional and backward-compatible**:

- `figure` / `figures` — `{ src, alt, caption? }`. `src` is an image **KEY**
  (not a URL), e.g. `"great-bath"`. Keys are resolved to **inlined** asset URLs
  by [`src/content/assets.ts`](src/content/assets.ts) via Vite `import.meta.glob`,
  so images are baked into the single-file build as `data:` URIs — **no network,
  no external files**. An unknown key resolves to nothing (the note renders
  without a broken image).
- `keyPoints` — `string[]` shown as a **"Must remember"** block, and the source
  of the **Revision** flashcards.
- `mnemonic` — a short memory aid shown as a callout.

**Revision (`#/revise`)** derives spaced-repetition flashcards from note
`keyPoints` using the shared Leitner engine (`src/engine/spaced-repetition.ts`),
scheduled in a dedicated `flashcards` state map (separate from the MCQ `sr`
map). Rate each card **Again** / **Good** to reschedule it.

### Available image keys

Drop new images into `src/assets/ivc/` (`.png/.jpg/.jpeg/.svg`); the KEY is the
filename without its extension. Currently available keys for `figure.src`:

- **Curated photos:** `great-bath`, `priest-king`, `dancing-girl`,
  `pashupati-seal`, `seal-script`, `mohenjodaro-grid`, `drainage`,
  `painted-pottery`, `beads-jewelry`, `burial`
- **Original SVG diagrams:** `ivc-extent-map`, `ivc-town-plan`, `ivc-granary`,
  `ivc-timeline`

## Architecture (intended layout)

Stage 1 (this commit) is toolchain-only: a minimal placeholder app that proves
the build/lint/test toolchain is green. Later stages fill in the following:

```
content/            # JSON content banks (MCQ / notes / mains / syllabus) — future
src/
  config.ts         # single source of truth for app-wide config
  main.ts           # entry: mounts the app, imports global styles
  app.ts            # composition root (placeholder render for now)
  styles.css        # global styles
  content/          # content manifest + loader (validates JSON banks)
  engine/           # drill / spaced-repetition / notebook engine
  state/            # persisted app state (localStorage / IndexedDB)
  views/            # web-component-style view modules
  router/           # hash-based client router
  __tests__/        # unit tests
docs/
  ROADMAP.md        # planned stages
```

See [docs/ROADMAP.md](docs/ROADMAP.md) for the staged plan.
