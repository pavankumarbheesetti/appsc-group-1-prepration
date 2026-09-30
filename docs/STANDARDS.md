# APPSC Group‑1 Prep — Project Standards (LOCKED)

> Single source of truth for content, design, and process rules. Preserved so the standard
> survives context compaction. When authoring/editing, FOLLOW THIS FILE + the Indus Valley
> exemplar (`content/history-ancient/mcq-indus-valley.json`).

---

## 1. Product goal
One offline‑first, single‑file study app that gets a candidate to **comfortably clear APPSC
Group‑1 Prelims** (Papers I & II), plus learn to **write Mains** and clear the **qualifying
languages (English + Telugu from scratch)**. Everything serves that goal: study material →
practice (sub‑topic + full mocks, exam‑standard) → memory (active recall) → planner to the exam.

Exam date lives in Settings (default **15 Nov 2026**, treated as the **Prelims** date; Mains is a
lighter parallel track after Prelims). NOTE: the exact prelims date is by convention, not an
officially fetched date (verified: notification 15 Sep 2026; applications 6–27 Oct 2026).

---

## 2. Content strategy — COVERAGE‑DRIVEN, EXAM‑LEVEL (the big rule)
- **Coverage over volume.** Do NOT pad banks with near‑duplicates. Size each subtopic's MCQ bank
  to **cover 100% of that subtopic's examinable points**, not a fixed count.
- **Sizing method:**
  1. **Enumerate the subtopic's `examPoints`** — the distinct examinable facts/concepts a prelims
     question could target (from the official syllabus + PYQ patterns + the source). Store as
     `examPoints: string[]` on the subtopic in `content/taxonomy.json`.
  2. Author **exam‑level MCQs** so that **every exam point is covered** by ≥1 question. Each MCQ
     maps the points it tests via `covers: string[]` (labels matching `examPoints`).
  3. **Coverage% = distinct exam‑points covered ÷ total exam points.** Target **100%**.
  4. Typical result: **~12–18 exam‑level MCQs per subtopic**, plus **2–3 "refresher" recall
     questions** (`refresher: true`) shown first. (IVC exemplar = 17 MCQs, 19/19 points.)
- **Single difficulty = EXAM LEVEL.** The old 3‑tier (T1/T2/T3) system is retired: no tier
  selector, no tier ladder, no tier results‑breakdown. (The `tier` field may remain in old data
  for back‑compat but is NOT a user‑facing system.) Use `refresher` for the few warm‑ups only.

## 3. MCQ authoring rules
- **Exam‑crafted, not copied.** Write real APPSC‑standard question shapes — **statement‑based**
  ("which of the statements is/are correct"), **match‑the‑following** (List I/List II), **
  assertion‑reason**, **application/discrimination** — NOT verbatim/paraphrase of the PDF, NOT
  trivial "the PDF says X" recall.
- **All 4 options are genuine examinable facts** (no throwaway distractors), so each question + its
  options + the Why‑not explanation teaches a **cluster** of facts.
- **Grounded + correct.** Every answer/fact must be supported by the topic's extracted source
  (`/Users/ipavankb/Downloads/APPSC Group 1/General Knowledge/Ancient History/_extracted/text/<Topic>.txt`)
  or a standard uncontested fact; cite verified sources (NCERT/ASI/UNESCO/APPSC). Never invent.
- **Vary `answerIndex`** across 0–3 (never cluster on A). **Unique ids** per bank.
- Each item: `subjectCode`, `subtopicId`, `verified: true`, `covers: [...]`, and the explanation
  in the locked format below.

## 4. Explanation format (LOCKED)
Order in the `explanation` markdown string:
1. **Rationale** — 1–2 sentences on why the correct answer is right.
2. `**Why not the others**` — one `- <option text> — <one‑line grounded reason>` per WRONG option
   (teach each option's key fact).
3. `**Key facts**` (or `**Key facts — <caption>**`) — a compact grounded cluster: a bullet list OR
   a GFM pipe table (use tabular figures for dates/numbers).
4. A **single** `*Source: …*` line (de‑duplicated; URL becomes a linked footnote).

Rules: **bold‑only headings, NO colon inside the bold** (`**Key facts**`, not `**Key facts:**`).
The parser (`src/lib/explanation.ts`) is **placement‑independent** and accepts **inline headings**
(marker at line start with trailing same‑line text). It renders WHY → WHY NOT THE OTHERS → KEY
FACTS → SOURCE as separate premium blocks; never let Why‑not rows leak into Key facts. When editing
explanations, **never change** `question` / `options` / `answerIndex` / `id`.

## 5. Data model quick‑ref
- `MCQItem`: id, subjectCode, subtopicId, question, options[], answerIndex, explanation,
  `covers?: string[]`, `refresher?: boolean`, verified, tags?, source?. (`tier?` legacy/optional.)
- `NoteItem`: …, keyPoints[] (Must‑remember), mnemonic? (optional "Memory hook"), figure?/figures?
  ({src, alt, caption}). Notes carry the study material + images.
- Taxonomy (`content/taxonomy.json`): subjects[] (with `track: paper1|paper2|mains`), chapters[],
  subtopics[] (id, subjectCode, chapterId, name, order, band A–D, syllabusRef?, `examPoints?[]`).
- Content banks are validated JSON discovered by `import.meta.glob` (eager) and INLINED into the
  single‑file build. Manifest is auto‑generated (`npm run gen:manifest`). Images inlined from
  `src/assets/**` via the stem‑keyed resolver; Telugu webfont (Noto Sans Telugu) bundled offline.

## 6. Memory strategy — ACTIVE RECALL (not mnemonics)
- Primary = retrieval practice: **cloze** cards auto‑generated from note keyPoints + per‑note
  **"Test yourself"** + spaced repetition (Leitner). Mnemonics are demoted to an optional
  collapsed "Memory hook".

## 7. UI / presentation standards ("urban", premium)
- Calm premium palette (warm off‑white / near‑black, ONE indigo accent, muted semantics), generous
  whitespace, hairline dividers, tabular figures, soft consistent radius/shadow; light + dark.
- **Statement questions render as a numbered list**; **match questions render as a two‑column
  table** (never a run‑on blob). Numbered question navigator in drills. Elegant Key‑facts card +
  Why‑not block + quiet linked Source footnote.
- **Layout uses the screen**: content max‑width ~1180px; notes reading measure ~80ch; tables/
  figures/question+explanation cards use fuller width; mobile single‑column.
- Nav: grouped sidebar (Plan/Learn/Practice/Revise/Skills/Track + Settings), mobile 5‑tab bottom
  bar + "More" sheet, medium‑width icon **rail** (~600–1024px).
- **Accessibility (must hold):** body/caption contrast ≥ 4.5:1; no text < 12px; interactive touch
  targets ≥ 44px and **rem‑based** (grow with font‑scale); dialogs (Search Cmd‑K, More sheet) =
  focus‑trap + global ESC + return‑focus + aria‑modal; tabs = ARIA + arrow‑key roving; note images
  have `aspect-ratio` (no CLS); status = icon+label (not color alone); honor prefers‑reduced‑motion;
  transient feedback via aria‑live toast.

## 8. App features (map of what exists)
Today (planner‑driven: theory + aptitude paired daily + 2–4 mains + refresh, exam countdown,
on‑track) · Planner (day‑by‑day to exam, feasibility, editable date) · Syllabus tracker (subject→
chapter→subtopic, coverage%/band, chronological) · Learn workspace (Notes/Flashcards/Drill/Mains
per subtopic) · Drill (presets + Refine Subject→Subtopic, numbered navigator, per‑Q pace timer,
confidence) · Mock (timed, −1/3 net, full review; full & sub‑topic) · Revise (recall/cloze +
notebook + weak areas) · Progress (real analytics) · Mains (writing‑skill trainer) · Languages
(Telugu from scratch + English qualifying) · Timeline · Settings/Data (export/import/reset).

## 8a. Planner rules — FIXED WEEKLY RHYTHM, PRELIMS‑FIRST (LOCKED)
The planner (`src/engine/planner.ts`, pure/deterministic) runs a FIXED WEEKLY RHYTHM to Prelims
(default 15 Nov 2026), scaling every block to the daily budget (Settings, default 240) and the Sunday budget
(Settings "Sunday study time", default 360). Each day's minutes are ≤ that day's budget.
- **Weekdays Mon–Fri (to Wed 4 Nov):** 60 Mental Ability (next MENT sequence topic; after all MENT
  first‑passed → mixed practice weighted to mistakes) · 135 SUBJECT (Mon History, Tue Polity, Wed Economy,
  Thu Geography, Fri Science&Tech; Tue/Thu = 120 + 15 Telugu) · 20 Revise (due cards + mistakes + topics
  first‑passed ~3/~10 days ago; AP/band‑A also ~21) · 25 Current Affairs (Mon/Wed/Fri AP, Tue national,
  Thu international; ~15 new Qs + next notes).
- **Saturday:** full mock 120 (3 Oct P2, 10 Oct P1, 17 Oct P2, 24 Oct P1, 31 Oct P2, 7 Nov P1;
  non‑repeating series #) + review wrong 60 + weakest‑area 60.
- **Sunday (SETTINGS "Sunday study time", default 360 = 6 h; presets 4/5/6/7 h + custom):** TWO study
  blocks — **Modern History** (the H‑modern stream, 120–240 min) + **Polity** (Polity's SECOND weekly slot,
  next Polity topics in sequence, 60–120 min) — then 60 weekly revision + 45 CA round‑up + 15 Telugu. The two
  study blocks scale with the Sunday budget: **Polity is cut FIRST below 360** (at a 240 Sunday budget →
  Modern History only, the previous shape) and is capped at 120 (its own weekday base); ABOVE 360 the
  **SURPLUS goes to Modern History** (H‑modern is NOT hard‑capped at 120 — that cap was the bug that made a
  larger Sunday budget buy no History depth). **Saturday is a mock day and follows the daily budget.** Runtime
  catch‑up of the week's missed items still takes precedence.
  (Stored `weekendStudyMinutes` migrates to `sundayStudyMinutes`: kept if greater than the daily budget, else
  360.)
- **THREE depth tiers (single time model, `planner.ts`):** `FULL = min(60, subtopicMinutes)` (read notes
  + ~20 Qs + review), `STANDARD = 40` (notes + ~12 Qs), `QUICK = 25` (key facts + cards + ~8 Qs). The
  per‑topic FULL cap is **60** (the old 90 was unrealistic and is what made the floor infeasible). Views
  badge topics **Full / Standard / Quick pass**.
- **Depth priority (within each subject):** AP‑specific → band A → PYQ weight desc → examPoints desc. A
  subject spends its budget giving FULL down that list, then STANDARD, then QUICK. Topics run strictly in
  learning‑sequence order (never before a prereq); a topic never spans days.
- **DEPTH FLOOR — "no weak areas" (LOCKED):** nothing examinable is left at QUICK depth if it can be avoided.
  The MINIMUM pass per topic is: **AP topics FULL** and **every band‑A topic FULL** (in every subject);
  **every POL / ECON / GEO / SCI topic ≥ STANDARD**; **History topics with any PYQ weight (> 0) ≥ STANDARD**;
  **only topics with PYQ weight 0 AND band C/D may stay QUICK.** The floor is a hard MINIMUM — the depth
  target seeds each topic at its floor and downgrade‑to‑fit never takes a topic below it — but it YIELDS to
  AP/band‑A placement: History (47 of 88 Paper‑I subtopics) cannot all reach STANDARD within its slot budget,
  so its lowest‑priority floor topics are relaxed to QUICK (in‑window first, then the buffer) and REPORTED in
  `summary.infeasibleFloorTopicIds`. **Polity's second Sunday slot lifts every Polity topic to ≥ STANDARD
  (band A FULL) at 240 weekday + 360 Sunday.**
- **History = TWO parallel chronological streams (fixes priority inversion):** History is split by a
  `stream` tag in `content/plan/learning-sequence.json` — **H‑early** = ancient + medieval + AP early
  dynasties (Satavahanas‑Ikshvakus, Kakatiyas, Reddi, Qutb Shahis); **H‑modern** = modern + AP
  freedom/statehood + art & culture. **Monday advances H‑early, Sunday advances H‑modern** (each strictly in
  its OWN order; cross‑stream prereqs not required); a donated/pooled slot feeds whichever stream has the
  larger remaining backlog. This keeps the high‑yield Modern + AP topics from landing last.
- **Depth allocation — OWN CAPACITY, then a shared POOL (deterministic):**
  1. **Own capacity `C_s`** = the sum of a subject's OWN weekday subject‑block minutes from 30 Sep → 4 Nov
     (HIST Mon, POL Tue, ECON Wed, GEO Thu, SCI Fri). Sunday adds two dedicated study blocks — **Modern
     History (H‑modern)** and **Polity** — on top of those weekday slots.
  2. **Own fill:** start every topic at QUICK, then upgrade WITHIN the subject in depth priority
     (AP → band A → PYQ desc → examPoints desc) — AP to FULL (always), then every floor topic to STANDARD,
     then floor to FULL, then non‑floor to STANDARD, then to FULL — each step only while the subject's own
     total stays `≤ C_s`. So a small subject spends its OWN slots on its OWN depth: **Geography's 8 topics
     are all FULL from its own ~600 min of Thursdays** (the old water‑fill bug starved GEO to 1 FULL and made
     it donate its Thursdays to History — fixed).
  3. **Spare + pool:** a subject that is ALL FULL with `total < C_s` has `SPARE = C_s − total`. **A subject
     NEVER donates while any of its topics is below FULL.** `POOL = P + Σ SPARE`, where **`P` = ALL of the
     Sunday STUDY minutes over the coverage window** = `(sundayBudget − 120 fixed) × #coverage‑Sundays` — so
     `P` SCALES with the Sunday budget (it was previously frozen at 600, which is why a bigger Sunday budget
     bought no depth). The pool funds the single best remaining upgrade across all below‑FULL subjects —
     ranked AP first, floor before non‑floor, a STANDARD target before a FULL target, then PYQ desc, then the
     subject with the lowest Paper‑I minute share — while the calendar can still place the added depth. The
     pool **never takes a non‑protected topic to FULL in a subject that still overflows its own placement**
     (extra FULL there just burns block capacity), and **Polity never reaches FULL on a non‑band‑A topic
     while any History PYQ>0 topic is still below STANDARD** — the shared pool lifts History to its floor
     before it over‑deepens Polity, so at 240 weekday + 360 Sunday Polity settles at **band A FULL + the rest
     STANDARD** (not all‑FULL).
- **Block size:** no block teaches **more than 3 new topics — 4 only if they are all QUICK.**
- **Integer‑packing fit + budget‑scaled capacity (deterministic):** the fit SIMULATES real placement (block
  minutes, ≤ 3 new topics — 4 if all QUICK, no splitting), not just a minute sum. Packing CAPACITY scales
  with the budget — **weekday blocks with the daily budget, the two Sunday study blocks (Modern History +
  Polity) with the Sunday budget** (Saturday stays a mock day on the daily budget). When the real packing
  leaves a tail: (a) **downgrade‑to‑floor (OWN‑CAPACITY‑FIRST)** — shed depth ONLY in a subject that is
  genuinely OVER its own packable capacity, one tier at a time (never below its floor), and stop once its own
  topics pack (so Economy keeps ~10+ FULL on its own six Wednesdays instead of being collapsed to its floor
  because History overflows); (b) **densify‑to‑fit** — relax the lowest‑priority non‑AP/non‑band‑A topic to
  QUICK IN‑WINDOW (a QUICK block holds 4 vs 3) ONLY when that actually seats more topics (so spare Sunday
  capacity is spent on depth, not needlessly flattened to QUICK); then (c) **defer‑to‑fit** — move the
  lowest‑priority non‑AP/non‑band‑A QUICK topic into the **Thu 5 / Fri 6 buffer** (AP/band‑A are always
  placed IN‑WINDOW). The buffer is **QUICK‑only AND block‑legal**: a spill block never claims fewer minutes
  than the topics it teaches (≤ 3 new topics, 4 if all QUICK), and a buffer day never plans past its budget —
  the old buffer crammed the whole reported tail into one day with 60‑min blocks holding 75 min of QUICK.
- **Feasibility + options:** the plan is **FEASIBLE** when the whole DEPTH FLOOR is met — every AP/band‑A
  topic FULL and every POL/ECON/GEO/SCI + History‑PYQ topic ≥ STANDARD (counting a scheduled **deepen** as
  meeting its floor) — with no AP/band‑A spill. The coverage window alone does NOT fully seat the floor at
  240 min/day (History's 47 topics cannot all reach STANDARD within its slot budget); the **final‑window
  deepen passes** then lift that below‑floor tail to its floor. At **240 weekday + 360 Sunday** the deepen
  window is large enough to close the whole 17‑topic tail, so the plan is **feasible** and
  `summary.infeasibleFloorTopicIds` is empty; at the tighter **240/240** the window cannot deepen every
  below‑floor topic, so the plan reports **not feasible** with the exact remaining shortfall
  (`summary.infeasibleFloorTopicIds`) — by design, not a bug. `summary.feasibilityOptions` is emitted ONLY
  when the floor is still short AFTER deepening (empty once feasible — no "move the exam date" noise); it is
  computed by RE‑RUNNING the fit over **Sunday budgets 360 → 600 in 30‑min steps** and reporting the MINIMUM
  extra Sunday time that meets the floor, else falling back to moving the exam date. A short QUICK‑only tail
  in the Thu 5 / Fri 6 buffer is by design.
- **Report (per subject):** total, FULL/STANDARD/QUICK counts, minutes, last first‑pass date; the
  DEPTH‑FLOOR topics forced **below STANDARD** (`summary.infeasibleFloorTopicIds` — few, and never AP;
  History carries the bulk as it holds 47 of the 88 Paper‑I subtopics); and per‑subject Paper‑I
  minutes/shares (`summary.paperOne{Minutes,SharePct}BySubject`). A genuine tail may spill to Thu 5 – Fri 6
  Nov only (reported, ≤ 3 new topics per spill block), never later.
- **Final window Thu 5–Sat 14 Nov:** no new topics; daily 60 MENT practice + 120 targeted revision
  (weakest by accuracy; AP + band A first) + 45 CA/AP refresh + 15 Telugu (Tue/Thu/Sun); mocks Tue 10 Nov
  P2 & Thu 12 Nov P1 (120/60/60). Sat 14 Nov LIGHT (≤90, AP + CA key facts + formula sheet, no mock).
  Sun 15 Nov EXAM: no tasks.
- **DEEPEN passes — close the weak areas (LOCKED):** every topic left BELOW its floor after coverage
  (`summary.infeasibleFloorTopicIds`, all QUICK, never AP/band‑A) gets ONE **deepen** top‑up scheduled into a
  final‑window `targeted-revision` block that brings it UP to its floor tier. A deepen is the EXTRA time only:
  **QUICK→STANDARD = 15 min** (read the remaining notes sections + ~10 more questions), **STANDARD→FULL =
  20 min**. It is a `PlanTopic` with a fourth `pass` value **`deepen`** living inside the targeted‑revision
  block — NOT a first pass, so each topic is still first‑passed exactly once (deepen items are excluded from
  the day's theory/aptitude first‑pass lists). Scheduling (deterministic): fill the targeted‑revision blocks
  **from the first final‑window day onward** (after the Thu 5 / Fri 6 QUICK spill first‑passes — a topic's
  deepen must come AFTER its own first pass), priority **AP → band A → PYQ desc → examPoints desc**; each
  block still obeys **Σ deepen minutes ≤ block minutes, ≤ 4 deepen topics per block, day ≤ budget**, and the
  remaining targeted‑revision time stays generic weakest‑first revision. A deepened topic counts as **MEETING
  its floor** (its EFFECTIVE tier), so it drops out of `infeasibleFloorTopicIds` and is listed instead in
  **`summary.deepenTopicIds`** (`id`, `fromTier`→`toTier`, `dateISO`). At **240 weekday + 360 Sunday** the
  whole 17‑topic STANDARD‑floor tail is deepened, so `infeasibleFloorTopicIds` is empty and the plan is
  FEASIBLE; at the tighter 240/240 the window cannot deepen them all and the remainder stays REPORTED.
  Views (Today + Planner) show a deepen item in plain language: **"Deepen · &lt;topic&gt; · 15 min"** (no tier
  jargon), alongside the block's generic revision entry.
- **No Mains before Prelims** (English + essay deferred; post‑prelims Mains kick‑start unchanged).
- **Views:** Today = the day's blocks in order (minutes, exact topics, one‑tap start, "builds on: …");
  Planner = weekly grid with Full/Standard/Quick‑pass badges, per‑subject progress (`History 12/47 · next: …`), mock
  dates, and a fit summary (FULL/STANDARD/QUICK counts, coverage end, spills). Re‑plans live on budget/date
  change. Accessible; mobile OK.


## 9. Exam‑relevance decisions (researched — apply when choosing what to author)
- **History/Culture (Art & Culture):** examinable; prioritize AP‑weighted (Architecture, Religions,
  Telugu literature, Music/Dance=Kuchipudi, Kalamkari/Lepakshi). Schools of Philosophy = low.
- **Science:** APPSC is APPLIED — author biotech/genetic‑engineering, health/diseases, vaccines,
  environment/pollution, S&T developments/space; SKIP academic biology (cell/tissue/physiology).
- **Current Affairs:** dynamic, ~mid‑2025 → exam month, heavy **AP schemes/policies**; static GK
  (capitals/currency/superlatives/first‑in‑world) is low‑ROI.
- **Paper‑II weighting (from PYQs):** Mental Ability ~48% of Paper‑II; Paper‑I balanced across
  History/Polity/Economy/Geography (~28–30 each/exam).

## 10. Process rules (non‑negotiable)
- After ANY change, **run `npm run check` YOURSELF** (typecheck + lint + validate:content + tests).
  A subagent reporting "build green" is NOT enough — its unit tests can pass while the rendered
  output is broken. **Always browser‑verify** UI/rendering on the `file://` build.
- Keep it **offline single‑file** (no CDN/fetch; everything inlined). Verify dist is one HTML with
  no external asset refs.
- **Never change** engine/routes/content semantics during a presentation pass; never alter
  `options/answerIndex/id` during explanation enrichment.
- Scratch dirs `.smoke/` and `.research/` are gitignored + eslint‑ignored (verification artifacts).
- No git commits unless the user explicitly asks. (Internal npm registry needs `mwinit`; builds
  currently use the public registry.)
- Research handoffs live in `.research/` (studyapp‑ux, ui‑spec, ui‑patterns, appsc‑*, oldapp‑*).
