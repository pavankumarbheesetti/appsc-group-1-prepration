# Roadmap

Staged plan for rebuilding the offline-first APPSC Group-1 prep app.

## Stage 1 — Toolchain (current)

- Vite 5 + TypeScript 5 (strict) project scaffold.
- Offline single-file production build via `vite-plugin-singlefile`.
- ESLint (flat config) + Prettier + Vitest wired up.
- Minimal placeholder app + one smoke test.
- `git init` (no commits yet).

## Stage 2 — Content model

- Define JSON schemas for content banks: MCQ, notes, mains, syllabus.
- Validate with **Zod** (runtime) + **JSON Schema** (authoring/tooling).
- Author a **content manifest** describing available banks.
- Populate `content/` with real JSON banks.
- ✅ **Content-validation gate** — `npm run validate:content` (shared logic in
  `src/content/validate.ts`) validates every bank against the Zod schemas plus
  cross-file integrity checks (manifest ↔ disk counts, orphan detection, unique
  item ids, `syllabusRef` resolution). Wired as a CI gate, run inside
  `npm test` (`content-integrity.test.ts`), and part of the combined
  `npm run check`.

## Stage 3 — Content loader + state

- `src/content/` manifest loader that reads + validates banks at startup.
- `src/state/` persisted progress (localStorage / IndexedDB), typed.

## Stage 4 — Engine

- Drill engine (question selection, scoring).
- Spaced-repetition scheduler.
- Notebook (saved notes / flagged items).

## Stage 5 — Views + router

- `src/views/` web-component-style modules for each screen.
- `src/router/` hash-based client router (offline-safe).

## Stage 6 — Tests + hardening

- Unit tests for engine + state.
- View/DOM tests via jsdom.
- Coverage thresholds; CI-friendly scripts.
