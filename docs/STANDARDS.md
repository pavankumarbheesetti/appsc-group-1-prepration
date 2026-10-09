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

Exam date lives in Settings (default **24 Jan 2027**, treated as the **Prelims / Screening Test**
date; Mains is a lighter parallel track after Prelims). NOTE: the Screening date is from the
**DETAILED Notification 07/2026 (dated 06/10/2026): Screening Test 24 Jan 2027, 166 vacancies**
(the brief notification's convention-date of 15 Nov 2026 is retired; a stored old-default exam date
auto-migrates on load). Applications 6–27 Oct 2026.

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

## 8a. Planner rules — FIXED WEEKLY RHYTHM, WEEKLY SUBJECT UNITS, PRELIMS‑FIRST (LOCKED)
The planner (`src/engine/planner.ts`, pure/deterministic) runs a FIXED WEEKLY RHYTHM to Prelims
(default **24 Jan 2027**), scaling every block to the daily budget (Settings, default 240) and the Sunday
budget (Settings "Sunday study time", default 360). Each day's minutes are ≤ that day's budget. The FIRST
PASS teaches **WEEKLY SUBJECT UNITS** — one coherent chapter/era run of a single subject at a time — instead
of rotating a different subject each weekday, so a beginner learns connected material (the chapters of a
story) in a sustained run rather than a slot a week apart.
- **WEEKLY SUBJECT UNITS (`content/plan/units.json`, LOCKED):** an ORDERED list of units
  `{id, subjectCode, title, topicIds, why}`. Each unit's `topicIds` is a CONTIGUOUS run of that subject's
  `learning-sequence.json` order, cut at natural chapter/era boundaries (~4–8 study days at FULL depth); EVERY
  Prelims subtopic EXCEPT Mental Ability (MENT) and Current Affairs (CA) appears EXACTLY ONCE across the units
  (validated in `validate:content`). The order ALTERNATES subjects so no Paper‑I subject waits more than ~4
  weeks between units, while each subject's units stay in sequence order and the History units stay
  chronological relative to each other; it starts with **Ancient India I** (day‑1 orientation). The 14 units:
  Ancient I → Polity I → Economy I → Ancient II → Geography → Polity II → Ancient III → Science & Tech →
  Medieval → Economy II → Modern I → Polity III → Modern II → Art & Culture. The planner teaches ONE unit at a
  time in the MAIN study block: a unit CONTINUES across days and weeks until done, the next unit begins in the
  NEXT main block (CLEAN BREAKS — a block teaches only one unit; the next unit starts on a fresh day), and no
  block ever teaches more than **3 new topics (4 only if all QUICK)**. `PlanDay` carries the current unit
  (`unitId`, `unitTitle`, `unitSubjectCode`, `unitDay` 1‑based, `unitDays`, `nextUnitTitle`); `PlanSummary.units`
  lists each unit's `{id, title, subjectCode, startISO, endISO, topicCount}`.
- **DERIVED CALENDAR — no hardcoded dates (LOCKED):** every phase anchor is computed from
  `settings.examDate` (+ plan start / today) by `computePlanAnchors`, so changing the exam date just works —
  there are NO hardcoded calendar dates in the planner. **Exam day = examDate (empty); light day = exam−1
  (≤90, no mock); FINAL WINDOW = the last 21 days before the exam (exam−21 … exam−2), no new topics;
  REVISION CYCLE = ~4 weeks immediately before the final window; COVERAGE END = final‑window start − the
  revision cycle (28 d).** With the detailed‑notification 24 Jan 2027 date, re‑planning from 10 Oct 2026
  gives: first pass **10 Oct → ~6 Dec 2026**, revision cycle **~7 Dec 2026 → ~2 Jan 2027**, final window
  **3 Jan → 22 Jan 2027**, light **23 Jan**, exam **24 Jan**. SHORT‑WINDOW FALLBACK (exam < 8 weeks away):
  no revision cycle and a compressed 10‑day final window — the old pre‑2027 behaviour.
- **Weekdays Mon–Fri (coverage window) — BLOCK ORDER main → Mental Ability → Revise → CA (LOCKED):**
  **135 MAIN BLOCK — the CURRENT UNIT** (the next topics of whichever unit is in progress; Tue/Thu = 120 + a
  15 Telugu block) FIRST, so new learning happens while the mind is fresh · 60 Mental Ability (next MENT
  sequence topic; after all MENT first‑passed → mixed practice weighted to mistakes) · 20 Revise (due cards +
  mistakes + topics first‑passed ~3/~10 days ago; AP/band‑A also ~21) · 25 Current Affairs (Mon/Wed/Fri AP,
  Tue national, Thu international; ~15 new Qs + next notes). The weekday→subject MAPPING of the old rhythm is
  RETIRED — the weekday no longer picks the subject; the current unit does. Day‑1 orientation keeps its own
  order (Start here → Mental Ability → History → CA). The revision‑cycle weekday uses the same order
  (marks‑based part revisit → Mental Ability practice → Telugu → Revise → CA).
- **BEGINNER RAMP (LOCKED):** the first **5 WEEKDAYS after day 1** run at a reduced **180‑min** budget
  (`BEGINNER_RAMP_BUDGET_MIN`) so a beginner eases in. ONLY the main block is shortened (the Mental Ability /
  Revise / CA / Telugu blocks keep their full minutes); the topics the shorter main block cannot hold flow
  into the catch‑up buffers (Saturday catch‑up + Sunday + the final consolidation Sunday) so the first pass
  still completes within the coverage window. Long window only — the compressed short‑window fallback never
  ramps.
- **DAYS OFF — festivals / holidays (LOCKED):** `settings.daysOff` (ISO dates; defaults Diwali **8 Nov 2026**
  + Bhogi/Sankranti/Kanuma **13–15 Jan 2027**, editable in Settings). Each day off is a **LIGHT day** capped at
  **≤ 60 min** (Current Affairs + flashcards only, one `light` block labelled "Day off — …"): no mock, no week
  test, no new topic. Day‑off dates are excluded from every placement lane (subject slots, MENT lane, CA
  first‑pass, revision slots); a mock or week test that would land on a day off **moves to the next suitable
  day** (`buildMockSchedule`: the nearest later date that is not a day off / light / exam and holds no other
  test — never a final‑window mock‑day collision). Displaced first‑pass work flows into the catch‑up buffers;
  every topic is still first‑passed once (within the coverage window, at most spilling into the two‑day
  post‑coverage catch‑up buffer when a whole study day is removed). `PlanDay.dayOff` marks these days
  (DISTINCT from `PlanDay.light`, the fixed exam−1 day, so the exam‑day checklist only shows on the real light
  day). Settings exposes the list as removable chips + an add‑date input + "Reset to defaults".
- **ADMIN TASKS — eligibility gates (LOCKED):** Today shows compact admin‑task cards, each with a short
  checklist and ONE "Mark done" button (toggles `adminDone` via `isAdminDone` / `setAdminDone`, which survive
  `resetProgress`). (a) **Apply online — deadline 27 Oct 2026, 11:59 PM** from plan start until done (checklist:
  OTPR registration/login · photo & signature specs · fee payment · choose exam centre · download application
  PDF; link to https://psc.ap.gov.in). (b) **Hall ticket — download when released** from **12 Jan 2027** until
  done ("watch psc.ap.gov.in from ~12 Jan"). (c) an **exam‑day checklist** on the light day **23 Jan 2027**
  (hall ticket print + photo ID · black/blue ballpoint pens · reach the centre early · OMR rules). Cards are
  hidden before their start date and once marked done.
- **DAY‑1 ORIENTATION — beginner‑friendly start (LOCKED):** the plan's FIRST day (`planStartDate` when it is
  today or in the future), **when it falls on a Saturday** (the opening‑mock case — e.g. the real
  planStartDate Sat 10 Oct 2026), is an **ORIENTATION day**, NOT a full mock: a **Start here** block (30 min,
  opens `#/start`) · **Mental Ability** — the first MENT sequence topic (Number System, 60) · **History** —
  the first H‑early topic(s) (Stone Age, then IVC if it fits, ~120) · **Current affairs** — "How current
  affairs is asked" + the first CA set (30). **No mock and no revise block on day 1.** The opening Saturday is
  dropped from the mock schedule (`buildMockSchedule(…, orientationISO)`). The orientation day records NO
  first pass — its named topics are shown as guided Learn links and are still first‑passed on their own
  scheduled days, so "every topic first‑passed exactly once" is unchanged. A weekday/Sunday day‑1 keeps the
  normal shape (the first study day already carries real topics, not a mock). The old **"Paper‑II baseline
  mock"** labelling is RETIRED — mock blocks read simply "Full Paper‑I/II mock".
- **START HERE guide (`#/start`, `src/views/start.ts`):** a plain‑language beginner orientation, linked from
  Today on day 1, from Settings, and from the nav "More" sheet. Five scannable sections: (a) the exam in 1
  minute (two 120‑mark papers + parts, −1/3 marking, 1:50 gateway that does not count in merit, key dates —
  facts from `src/lib/exam-pattern.ts` + the detailed Notification 07/2026); (b) how your plan works
  (weekday/Saturday/Sunday shape + the first‑pass → revision → final phases, dates DERIVED from the plan);
  (c) how to study one topic (Topic at a glance → Notes → Practice → Flashcards; Full/Standard/Quick pass);
  (d) negative marking (answer when you can eliminate options, skip pure guesses, with the simple EV maths);
  (e) what to do if you miss a day (Sunday catch‑up; don't double up). Accessible headings; works at 390px.
- **Saturday — FIRST PASS = "WEEK TEST"; revision cycle + final window = FULL MOCKS:**
  During the first pass (coverage window) each Saturday — EXCEPT the day‑1 orientation Saturday above and the
  single dress rehearsal below — is a **WEEK TEST**, not a full mock: a timed **45‑question / 55‑minute**
  test (−1/3 marking, per‑paper net marks like the mock results) drawn ONLY from the MCQs of topics the plan
  has first‑passed on or before that Saturday (≈ 2/3 from **that week's UNIT topics**, 1/3 from earlier;
  Paper‑I / Paper‑II in proportion to what was covered; deterministic seed per date; no question repeats across
  week tests where the pool allows — see `buildWeekTest` / `buildWeekTestSeries` in `engine/mock.ts`). The day is
  **week test 55 + "Review every wrong or guessed answer" 45 + catch‑up of missed items** (runtime, else the
  next topics of the biggest‑backlog subject). One tap from Today and the Planner launches it (reuses the mock
  runner with a scoped pool, custom count + time — `openWeekTest`).
  **DRESS REHEARSALS + WEEKLY FULL MOCKS (STANDARDS §8a item 4, LOCKED):** **TWO** full 120‑question dress
  rehearsals in the first pass, on the coverage Saturdays nearest **planStart+28 (Paper‑II)** and
  **planStart+42 (Paper‑I)** — for the real plan, **Sat 7 Nov (Paper‑II)** and **Sat 21 Nov (Paper‑I)** —
  labelled "Dress rehearsal — practise the 2‑hour format; the score doesn't matter yet".
  **WEEKLY FULL MOCKS** then run **every Saturday from the LAST coverage Saturday** (the week that ends the
  first pass — **Sat 5 Dec**) through the revision cycle, alternating **Paper‑II first**; the **final window**
  keeps **3 full mocks/week** (Tue/Thu/Sat, Paper‑I first). The OTHER first‑pass Saturdays stay **week tests**.
  Full mocks (both dress rehearsals + weekly + final) share one per‑paper non‑repeating series #; week tests
  have their own counter and do NOT consume the series. **RE‑AUDIT 2 (R2):** series numbers are assigned
  **by date AFTER any festival relocation/drop** (`renumber` in `buildMockSchedule`), so a mock displaced or
  dropped off a day off never leaves a gap (fixes Paper‑I 1,2,3,4,5,**7** → 1,2,3,4,5,6). Full‑mock sittings
  stay **within the non‑repeating per‑paper capacity (Paper‑I ≤ 9, Paper‑II ≤ 8)**. The old **"Paper‑II baseline mock"** labelling is RETIRED. (Short window < 8 weeks: the
  old shape — every Saturday a full mock, no week tests, no dress rehearsal.)
- **Sunday (SETTINGS "Sunday study time", default 360 = 6 h; presets 4/5/6/7 h + custom):** the **MAIN
  BLOCK teaching the CURRENT UNIT** (the same unit the weekdays are advancing) — then **30 Mental Ability
  practice** (STANDARDS §8a item 2 — MENT every day incl. Sunday) + 30 weekly revision + 45 CA round‑up + 15
  Telugu. The main block scales with the Sunday budget (budget − the **fixed 120** = Mental Ability 30 +
  weekly revision 30 + CA round‑up 45 + Telugu 15): at 360 → 240, at 240 → 120. The 30‑min Sunday Mental
  Ability block is carved from the weekly‑revision time (60 → 30), NOT from the teaching main block, so
  first‑pass coverage capacity and its learning‑sequence order are unaffected. **Saturday is a
  mock day and follows the daily budget.** Runtime catch‑up of the week's missed items still takes precedence.
  (Stored `weekendStudyMinutes` migrates to `sundayStudyMinutes`: kept if greater than the daily budget, else
  360.)
- **EARLY REVISE block (beginner‑friendly):** while fewer than **10 curated cards are due** across the deck
  (the first days, before spaced repetition has built up), the weekday 20‑min **Revise** block is relabelled
  **"Flashcards for what you studied yesterday"** on Today and its launcher scopes a Revise session to the
  **previous plan day's topics'** curated cards (or, if that day has none, the most recent studied topic's
  cards). It is NEVER an empty block. Implemented in the Today block label + launcher (`openReviseScope`),
  reading the plan's day topics; once ≥ 10 cards are due the block reverts to the normal whole‑deck Revise.
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
- **UNIT‑STREAM placement (replaces the old lane packer):** the first pass walks the ORDERED units and fills
  each coverage MAIN block from the front of the current unit's topics, in sequence order, **one unit per
  block (clean breaks)** — a block never mixes two units, and the next unit begins on the next main‑block day.
  Topics run strictly in sequence (never before a prereq); a topic never spans days; a block holds ≤ 3 new
  topics (4 if all QUICK). The old **two parallel History streams** and the **weekday→subject mapping** are
  RETIRED — History is now ordered chronologically across its units (Ancient → Medieval → Modern → Art), and
  the current unit (not the weekday) picks the subject.
- **UNIT WRAP‑UP — consolidate a unit right after finishing it (LOCKED):** a beginner closes each unit before
  moving on, so a unit‑end main block is never left idle. On a unit's **last first‑pass day**, if the main
  block has **≥ 30 min free** after the unit's last topic(s), the planner adds a **`unit-wrapup` block**
  "Unit wrap‑up · <unit title>" sized **min(leftover, 90)**: ~15 min **"Topic at a glance"** recap of every
  topic in the unit (links to each topic's glance card / notes), then a timed **UNIT TEST** of
  **round(size − 15 − 15)** questions (1 Q/min, −1/3 marking) drawn **ONLY from that unit's own topics' MCQs**
  (deterministic seed = the day; prefers questions not already used in the week tests), then ~15 min reviewing
  wrong/guessed answers. The packer **reserves ≥ 30 min** on a unit's final block (deferring only its last
  topic to the next block when needed), so **every unit gets exactly one wrap‑up in the first pass**. The
  teaching `subject` block's minutes equal its own topics' minutes — it carries **no ≥ 30‑min idle**; the
  leftover becomes the wrap‑up, then (point below) the next unit, then a **`catchup` "Catch up or rest"**
  filler. If, after the wrap‑up, the minutes still free are **≥ the next unit's first topic**, that unit
  **STARTS in the same block** (a separate one‑unit `subject` block after the wrap‑up — typically on Sundays,
  so the larger Sunday budget isn't wasted; still ≤ 3 new topics per block, no topic split); otherwise the
  remainder is **"Catch up or rest"**. **One tap** from Today/Planner launches the unit test — it reuses the
  week‑test / scoped mock runner (scoped pool + custom count + time + per‑paper net results) via
  `openUnitTest`. `PlanBlock` carries `unitId`, `unitTestSubtopicIds`, `unitTestCount`, `unitTestMinutes`,
  `unitTestDateISO`. The **revision cycle** applies the same idea: a unit's **last revision day** gets a short
  wrap‑up (unit test) when the revisit block has ≥ 30 min to spare. **RE‑AUDIT 2 (R1):** **EVERY unit keeps
  exactly one wrap‑up** — a final pass guarantees it. When the coverage‑close repair reclaims a unit's wrap‑up
  minutes to seat a protected final topic, or a unit's last topic exactly fills its block, the wrap‑up is
  restored on the unit's own last teaching day if it still has ≥ 30 free main‑block minutes; otherwise — the
  LAST unit (**Art & Culture**) whose wrap‑up cannot fit before coverage end — it is placed on the **first
  revision‑cycle day** (labelled "Unit wrap‑up · &lt;unit title&gt;"), carved from that day's revision block.
  (Fixes the regression where Art & Culture lost its wrap‑up — 13 wrap‑ups for 14 units.)
- **Depth target + fit (deterministic):** every topic TARGETS **FULL**; with the real long window (240 weekday
  + 360 Sunday) the unit runs seat every topic FULL. When a tighter budget or the short‑window fallback leaves
  the main‑block slots short, the fit (a) **downgrades** the lowest‑priority non‑protected topic one tier at a
  time — never below its depth floor (AP FULL, band A FULL, POL/ECON/GEO/SCI + History‑PYQ ≥ STANDARD) — then
  (b) **defers** the lowest‑priority non‑protected QUICK topic into the post‑coverage spill buffer. **AP and
  band‑A topics are PROTECTED: always FULL and always placed IN‑WINDOW.** The final‑window **deepen passes**
  then lift any below‑floor tail to its floor. Everything is budget‑scaled (weekday blocks with the daily
  budget, the Sunday main block with the Sunday budget) and re‑runnable so the feasibility options can probe a
  higher Sunday budget.
- **Block size:** no block teaches **more than 3 new topics — 4 only if they are all QUICK.** The spill buffer
  obeys the same rule and a buffer day never plans past its budget.
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
  in the post‑coverage spill buffer is by design.
- **RECOVERY MODE — a working professional who falls behind (RE‑AUDIT 2, LOCKED):** when a PROGRESS‑AWARE /
  TIGHT re‑plan would otherwise spill first‑pass topics PAST the coverage‑end date (the learner re‑plans later
  than the plan start with first passes unstudied, or runs a low Sunday budget), the planner RECOVERS the tail
  IN‑WINDOW instead of reading infeasible: **(1)** teach the unfinished first passes, in **learning‑sequence
  order**, on the catch‑up buffers + the **revision cycle's first week (≤ 7 days)** — shifting the reported
  coverage end up to 7 days later, **SHORTENING the revision cycle, NEVER the final window**; **(2)** only if
  7 days still cannot hold it, **DOWNGRADE** the lowest‑priority **non‑AP / non‑band‑A** topics
  FULL→STANDARD→QUICK until it fits (protected topics keep FULL; an extreme budget may borrow more revision
  days as a last resort, still before the final window). The plan stays **FEASIBLE**; `summary.recovery` is
  true, `summary.coverageEndISO` reflects the shift, and `summary.daysBehind` counts the elapsed plan
  study‑days whose first‑pass work is unstudied (0 when on‑time). Today and the Planner show a **calm, non‑alarm
  banner** when `daysBehind ≥ 1`: **"You're N days behind — the plan has been adjusted: &lt;what changed&gt;"**
  (`summary.recoveryChanges`), e.g. "moved 14 topics into the revision cycle's first week; the revision cycle
  is 7 days shorter". Sequence order, budgets, block legality, mocks (120 min), days off, light/exam days,
  unit wrap‑ups and the P1 ≤ 9 / P2 ≤ 8 contiguous mock numbering all hold. Long window only.
- **Report (per subject):** total, FULL/STANDARD/QUICK counts, minutes, last first‑pass date; the
  DEPTH‑FLOOR topics forced **below STANDARD** (`summary.infeasibleFloorTopicIds` — few, and never AP;
  History carries the bulk as it holds 47 of the 88 Paper‑I subtopics); and per‑subject Paper‑I
  minutes/shares (`summary.paperOne{Minutes,SharePct}BySubject`). A genuine tail may spill into the
  post‑coverage spill buffer (the first two days after coverage end) only (reported, ≤ 3 new topics per
  spill block), never later.
- **Mental Ability EVERY DAY (STANDARDS §8a item 2, LOCKED):** a Mental Ability block (topic first pass, else
  a practice set) runs on **every study day including Sunday**. On Sundays it is a **30‑min practice set**
  (`PRACTICE_MIN`, carved from the weekly‑revision time, not from teaching). The final window carries a
  **60‑min** MENT practice daily and a **45‑min** Current Affairs refresh daily (`ca-refresh`).
- **Revision cycle (long window only, ~4 weeks before the final window) — MARKS‑BASED (STANDARDS §8a item 3,
  LOCKED):** the SAME weekly rhythm, but the MAIN BLOCK now allocates its revision minutes **EQUALLY across the
  six 30‑mark parts** (History, Polity, Economy, Geography, Science & Tech, Current Affairs) — each revision
  main slot is handed to the part with the **least accumulated revision minutes** so far, and filled from that
  part's **cycling** queue ordered **PYQ weight desc → weakness (mastery asc) → oldest‑touched (first‑pass asc)**.
  Mental Ability is practised daily ON TOP (its own block), never in the six‑part split. Revisit topics cost
  **`REVISIT_MIN` = 25 each** (`toRevisitTopic`), so a block of ≤ floor(cap/25) topics always fits its minutes.
  This replaces the old unit‑order revisit — it fixes History over‑weight and the Geography/Science cold gaps.
  MENT practice, Revise, CA, Telugu and the Saturday mock keep running; `segment` = `'revision'`.
- **TOUCH RULES (STANDARDS §8a item 3 — HARD, tested):** over the whole plan (first pass + spaced recall +
  the revision/final rolling sweep + revise/targeted‑revision blocks + CA/MENT practice) **(1)** every subject
  is revised within the **last 14 days** before the exam, **(2)** every Prelims topic is touched **≥ 3 times**
  (first pass + ≥ 2 revisits), and **(3)** no topic's last touch is older than **28 days** at exam day (so the
  topics first‑passed 4–6 Dec are revisited). A light **rolling SWEEP** of the six parts + Mental Ability
  (round‑robin interleaved, PYQ‑then‑oldest within each part) is added to every revision/final day's
  `reviseSubtopicIds`, cycling so every topic is swept ≥ 2 times and gets a fresh touch in the final stretch
  (long window only; the short window keeps pure spaced recall).
- **Fortnightly MAINS answer (STANDARDS §8a item 12, LOCKED):** one Mains answer per fortnight, on **alternate
  revision Sundays ONLY** (never in the first pass or final window): a **25‑min `mains-write` block**
  (`mainsQuestionId` drawn from the authored Mains bank — a topic already first‑passed by the revision cycle);
  `summary.weekendMainsCount` counts them. The 25 min is reserved from that Sunday's main revision block.
- **Final window (last 21 days, exam−21 … exam−2):** no new topics; daily 60 MENT practice + 120 targeted
  revision + 45 CA/AP refresh + 15 Telugu (Tue/Thu/Sun); full mocks on **3 days a week (Tue/Thu/Sat),
  alternating Paper‑I / Paper‑II** (120/60/60). The light day (exam−1) is LIGHT (≤90, AP + CA key facts +
  formula sheet, no mock). The exam day is empty.
- **NEVER‑EMPTY targeted revision (STANDARDS §8a item 8, LOCKED):** a final‑window `targeted-revision` block is
  never empty at plan time — after its deepen top‑ups it is topped up with the **marks‑based default list**
  (the six parts round‑robin, PYQ‑then‑oldest, cycling, first‑passed before the day) up to the block's minutes;
  every revise/targeted block obeys **Σ topic minutes ≤ block minutes** (`toRevisitTopic`'s 25‑min estimate
  fixes the old over‑stuffed blocks, e.g. 16 Dec). Runtime weak areas (mastery < 80) replace the default list.
- **DEEPEN passes — close the weak areas (LOCKED):** every topic left BELOW its floor after coverage
  (`summary.infeasibleFloorTopicIds`, all QUICK, never AP/band‑A) gets ONE **deepen** top‑up scheduled into a
  final‑window `targeted-revision` block that brings it UP to its floor tier. A deepen is the EXTRA time only:
  **QUICK→STANDARD = 15 min** (read the remaining notes sections + ~10 more questions), **STANDARD→FULL =
  20 min**. It is a `PlanTopic` with a fourth `pass` value **`deepen`** living inside the targeted‑revision
  block — NOT a first pass, so each topic is still first‑passed exactly once (deepen items are excluded from
  the day's theory/aptitude first‑pass lists). Scheduling (deterministic): fill the targeted‑revision blocks
  **from the first final‑window day onward** (after any post‑coverage spill first‑passes — a topic's
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
  dates, and a fit summary (FULL/STANDARD/QUICK counts, coverage end, spills). The current UNIT is available on
  every day (`PlanDay.unitTitle` / `unitDay` / `unitDays` / `nextUnitTitle`) and the whole unit timeline on
  `PlanSummary.units`, so Today can show "Unit 3 of 14 · day 2 of 4 · next: …" and the Planner a unit ribbon.
  Re‑plans live on budget/date change. Accessible; mobile OK.


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
