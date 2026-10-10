/**
 * Study PLANNER engine — PURE functions only (no DOM, no storage, no loader).
 *
 * The pre-Prelims plan is a FIXED WEEKLY RHYTHM (see {@link buildRhythmPlan}):
 * every study day runs the same ordered template of BLOCKS — Mental Ability,
 * the day's SUBJECT, spaced Revision, and Current Affairs on weekdays; full
 * MOCKS on Saturdays; a catch-up/History + weekly-revision + CA round-up +
 * Telugu block on Sundays — scaled to the day's time budget. Topics run strictly
 * in learning-sequence order (never before a prerequisite) and are studied at
 * FULL depth or a lighter QUICK pass so each subject's whole sequence fits its
 * own slots by the coverage-end date; a finished subject's weekday slot is
 * REALLOCATED to the neediest Paper-I/Science subject (usually History). After
 * the coverage window a FINAL revision window runs targeted revision + two more
 * mocks, a LIGHT day before the exam, and an EMPTY exam day.
 *
 * Once the exam date has passed the plan does NOT end — it flips to a
 * post-prelims MAINS kick-start (`buildPostPrelims`, UNCHANGED): mains-question
 * practice by paper + the weekly essay + the qualifying-language blocks (the
 * work deferred during the prelims push), from today forward.
 *
 * On top of the schedule it computes an honest PRELIMS read-out: the per-subject
 * FULL/QUICK fit report, the mock list, reallocations, when Mental Ability is
 * fully covered, any coverage spill, plus the mastery / coverage figures the
 * Today rings and countdown consume. Everything is derived from the inputs
 * alone, so it is fully unit-testable with fixed dates and budgets.
 *
 * DESIGN NOTE — the `progress` input is a PER-SUBTOPIC summary keyed by subtopic
 * id (`{ seen, masteryPct }`), NOT the raw per-MCQ progress map. The view layer
 * derives it from the store + content (via `subtopicMasteryPct`) so this engine
 * stays free of any content/store import and trivially testable.
 */
import type { Band, Track } from '../content/taxonomy';
import type { LearningStream, PlanUnit } from '../content/plan-types';
import { patternFor, type PaperId } from '../lib/exam-pattern';
import type { MockKind } from './mock';
import { WEEK_TEST_COUNT, WEEK_TEST_MINUTES } from './mock';
import {
  addDaysISO,
  dayOfWeekISO,
  daysUntilExam,
  diffDaysISO,
  inclusiveDaysISO,
  isWeekendISO,
} from '../lib/dates';

/** A subtopic as the planner needs it: id, order, track, subject, band, MCQs. */
export interface PlanSubtopic {
  id: string;
  /**
   * Human-readable subtopic label. Optional so the engine stays free of the
   * taxonomy; when omitted the per-day `topics` breakdown falls back to `id`.
   */
  name?: string;
  /** Chronological/teaching order within the syllabus. */
  order: number;
  /** Stable subject code (used to route a topic into its weekly slot). */
  subjectCode: string;
  /**
   * Exam track. `paper1`/`paper2` are the PRELIMS scope; `mains` is the
   * parallel post-prelims track and is excluded from the schedule/deadline.
   * Optional; a subtopic with no track is treated as `paper1` (safe default so
   * nothing silently drops out of the prelims plan).
   */
  track?: Track;
  /** Priority band (drives FULL/QUICK depth priority & badges); optional. */
  band?: Band;
  /** Number of authored MCQs available for this subtopic. */
  mcqCount: number;
  /**
   * Number of examinable points declared for this subtopic (from the
   * taxonomy's `examPoints[]`). Feeds the per-topic time estimate. Optional;
   * defaults to 0.
   */
  examPointCount?: number;
  /**
   * Whether this subtopic has ANY authored material (notes, MCQs or mains).
   * Drives the honest MATERIAL coverage figure. Optional; defaults to `false`.
   */
  hasMaterial?: boolean;
  /**
   * Whether this subtopic has an authored "For Mains" angle note (a note item
   * tagged `mains`, id `<subtopicId>-note-mains-angle`). Drives the
   * "study once for Prelims, revise for Mains later" strategy: a REVISION-CYCLE
   * revisit of such a topic gets a +{@link MAINS_ANGLE_MIN}-min "read the For
   * Mains note" add-on (see {@link PlanTopic.mainsAngle}). The first pass and the
   * final window NEVER include this reading. Optional; defaults to `false`.
   */
  hasMainsAngleNote?: boolean;
}

/** Per-subtopic progress summary keyed by subtopic id. */
export type PlannerProgress = Readonly<
  Record<string, { seen: number; masteryPct: number }>
>;

/**
 * The day-type a plan day carries. Kept as the historical
 * `learn` / `revise` / `mock` union (so views and drills keep working) plus
 * `mains` for the post-prelims kick-start days.
 */
export type PlanPhase = 'learn' | 'revise' | 'mock' | 'mains';

/**
 * The higher-level study PHASE a day belongs to. In the rhythm this is
 * `coverage` (first-pass weekly rhythm to the coverage-end date), `revision`
 * (the ~4-week sequence-order revision cycle, long window only), `final` (the
 * 21-day final window ending the day before the exam) or `post-prelims` (after
 * the exam). All phase boundaries are DERIVED from the exam date.
 */
export type PlanSegment = 'coverage' | 'revision' | 'final' | 'post-prelims';

/** Where a plan day sits relative to today. */
export type PlanDayStatus = 'past' | 'today' | 'upcoming';

/**
 * How deeply a topic is studied on its first pass — one of THREE first-pass
 * tiers, plus one FINAL-WINDOW top-up tier:
 *   - `full`     — read notes + ~20 questions + review (min(60, subtopicMinutes)).
 *   - `standard` — notes + ~12 questions ({@link STANDARD_MIN} min).
 *   - `quick`    — key facts + cards + ~8 questions ({@link QUICK_MIN} min).
 *   - `deepen`   — NOT a first pass: a scheduled TOP-UP in the final window that
 *     brings a below-floor topic from its planned tier UP to its floor tier
 *     (QUICK→STANDARD = {@link DEEPEN_QUICK_TO_STANDARD_MIN} min: the remaining
 *     notes sections + ~10 more questions; STANDARD→FULL =
 *     {@link DEEPEN_STANDARD_TO_FULL_MIN} min). A `deepen` {@link PlanTopic}
 *     lives inside a `targeted-revision` block, never in the coverage first-pass
 *     lists, so a topic is still first-passed exactly once.
 * AP topics are ALWAYS `full`; each subject then spends its marks-based minute
 * budget giving FULL down its depth-priority list, then STANDARD, then QUICK.
 */
export type PlanPass = 'full' | 'standard' | 'quick' | 'deepen';

/**
 * What KIND of {@link PlanTopic} a block teaches:
 *   - `topic` — a first-pass of a real syllabus subtopic (the default).
 *   - `practice` — a synthetic "Mental Ability practice set": a mixed drill of
 *     {@link PRACTICE_QUESTIONS} questions drawn from ALREADY-COVERED MENT
 *     subtopics (see {@link PlanTopic.practiceSubtopicIds}). It fills the MENT
 *     lane once all MENT topics have been first-passed.
 */
export type PlanTopicKind = 'topic' | 'practice';

/**
 * One scheduled topic in a day's DRILL breakdown, so views can render an honest
 * per-topic line — `Topic · N Q` when it has authored questions, or
 * `Topic · material coming` when `mcqCount` is 0.
 */
export interface PlanTopic {
  /** The subtopic id (links to its Learn/drill workspace). */
  subtopicId: string;
  /** Human label; falls back to the id when no name was provided. */
  name: string;
  /** Which Prelims paper this topic advances today. */
  track: 'theory' | 'aptitude';
  /** Authored MCQs available for this topic — 0 means "material coming". */
  mcqCount: number;
  /** Priority band (A–D) when known; drives ordering + the time estimate. */
  band?: Band;
  /**
   * Which depth tier this topic is scheduled at — FULL, STANDARD or QUICK. AP
   * topics are always FULL; the STANDARD/QUICK tiers fill in as a subject spends
   * its marks-based minute budget down its depth-priority list.
   */
  pass: PlanPass;
  /**
   * Suggested study MINUTES for this topic under its chosen {@link pass} — the
   * full-depth {@link subtopicMinutes} (capped at {@link FULL_CAP_MIN}) for FULL,
   * {@link STANDARD_MIN} for STANDARD or {@link QUICK_MIN} for QUICK (each capped
   * at the topic's own full cost so a light topic is never inflated).
   */
  estMinutes: number;
  /**
   * What kind of block this is — a real first-pass `topic` (default) or a
   * synthetic `practice` set. See {@link PlanTopicKind}.
   */
  kind: PlanTopicKind;
  /**
   * For a `practice` block only: the ALREADY-COVERED MENT subtopic ids the
   * mixed drill draws from (weighted toward weak / PYQ-heavy types). Launching
   * the block starts a drill scoped to these ids. Absent for a real `topic`.
   */
  practiceSubtopicIds?: readonly string[];
  /**
   * REVISION-CYCLE only (STANDARDS §8a): true when this revisit carries the
   * +{@link MAINS_ANGLE_MIN}-min "read the For Mains note" add-on because the
   * topic has an authored mains-angle note AND the +5 still fit inside the
   * block's minutes. Its {@link estMinutes} already INCLUDES the +5. Views label
   * it "+ For Mains note". The first pass and the final window never set it.
   */
  mainsAngle?: boolean;
}

/** Which qualifying-language block a day carries (post-prelims only). */
export type LanguageBlock = 'telugu' | 'english';

/**
 * The KIND of a rhythm {@link PlanBlock} — the fixed daily template positions.
 */
export type PlanBlockKind =
  | 'ment'
  | 'ment-practice'
  | 'subject'
  | 'revise'
  | 'ca'
  | 'mock'
  | 'mock-review'
  | 'weakest-area'
  | 'catchup'
  | 'week-test'
  | 'week-test-review'
  | 'weekly-revision'
  | 'ca-roundup'
  | 'telugu'
  | 'targeted-revision'
  | 'ca-refresh'
  | 'unit-wrapup'
  | 'mains-write'
  | 'start-here'
  | 'light';

/**
 * One ordered block of a rhythm day (the fixed weekly template). Minutes are
 * scaled to the day's budget; the block ORDER within the day is fixed.
 */
export interface PlanBlock {
  kind: PlanBlockKind;
  /** e.g. 'Mental Ability', 'History', 'Current Affairs (AP)'. */
  label: string;
  /** Scaled to the day's budget. */
  minutes: number;
  /** For a `subject`/`catchup` block. */
  subjectCode?: string;
  /** Topics this block teaches (with FULL/QUICK pass). */
  topics?: PlanTopic[];
  /** For a `mock` block. */
  mockPaper?: PaperId;
  mockNumber?: number;
  /** For a `ment-practice` block: the covered MENT ids the drill draws from. */
  practiceSubtopicIds?: string[];
  /**
   * For a `mains-write` block (STANDARDS §8a, item 12): the authored Mains
   * question id this fortnightly Sunday answer-writing drill is drawn from (a
   * topic already first-passed). The Today/Planner launcher opens this question
   * in the Mains workspace. Present only on `mains-write` blocks.
   */
  mainsQuestionId?: string;
  /**
   * For a `week-test` block: the Saturday date (deterministic seed), the FULL
   * set of subtopic ids first-passed on or before that Saturday (the test pool)
   * and the subset first-passed in that WEEK (favoured ~2/3). The Today/Planner
   * launcher reconstructs the deterministic {@link buildWeekTest} from these.
   */
  weekTestDateISO?: string;
  weekTestSubtopicIds?: string[];
  weekTestThisWeekIds?: string[];
  /** For a `ca`/`ca-refresh`/`ca-roundup` block: its focus CA subtopic id. */
  caSubtopicId?: string;
  /** Previous topic name in the same subject's sequence (Today view). */
  buildsOn?: string;
  /**
   * For a `unit-wrapup` block (STANDARDS §8a): the unit being consolidated and
   * the inputs the Today/Planner launcher reconstructs the scoped UNIT TEST
   * from. The wrap-up is `WRAPUP_GLANCE_MIN` "Topic at a glance" + a timed
   * `unitTestCount`-question test (1 Q/min, −1/3) drawn ONLY from this unit's
   * topics' MCQs + `WRAPUP_REVIEW_MIN` review. `unitTestDateISO` is the
   * deterministic seed. `unitId`/`unitTitle` identify the finished unit.
   */
  unitId?: string;
  unitTitle?: string;
  /** The unit's own topic ids — the ONLY pool the unit test draws from. */
  unitTestSubtopicIds?: string[];
  /** Target unit-test question count (= `unitTestMinutes`, 1 Q/min). */
  unitTestCount?: number;
  /** Unit-test timer minutes. */
  unitTestMinutes?: number;
  /** Deterministic unit-test seed (the day the wrap-up is scheduled). */
  unitTestDateISO?: string;
}

/** One day of the study plan — an ordered list of rhythm blocks (+ legacy fields). */
export interface PlanDay {
  /** ISO `YYYY-MM-DD` date of this day. */
  dateISO: string;
  /** 0-based index from the plan start. */
  dayIndex: number;
  phase: PlanPhase;
  /** The higher-level segment this day belongs to. */
  segment: PlanSegment;
  /** Ordered rhythm blocks for the day (the fixed template). */
  blocks: PlanBlock[];
  /** New PAPER-I (theory) subtopics FIRST-PASSED today. */
  theorySubtopicIds: string[];
  /** New PAPER-II (aptitude) subtopics FIRST-PASSED today. */
  aptitudeSubtopicIds: string[];
  /** Prelims subtopics to REVISE today (spaced +3/+10/+21-day recall). */
  reviseSubtopicIds: string[];
  /** The day's MAINS quota — always empty pre-Prelims (Mains is deferred). */
  mainsQuestionIds: string[];
  /**
   * Which full-length paper to sit as a MOCK today, or `null` on non-mock days.
   */
  mockPaper: PaperId | null;
  /** 1-based mock number within its paper series (0 when not a mock day). */
  mockNumber: number;
  /** A SECTIONAL mock is scheduled today (unused in the rhythm; always false). */
  sectionalMock: boolean;
  /** A current-affairs refresh is scheduled today (final window). */
  caRefresh: boolean;
  /** A current-affairs revision/round-up slot is scheduled today. */
  caRevision: boolean;
  /** The post-prelims qualifying-language block for today, or `null`. */
  languageBlock: LanguageBlock | null;
  /** A weekly General Essay practice is scheduled today (post-prelims only). */
  essayPractice: boolean;
  /** A 15-min Telugu script block is scheduled today (Tue/Thu/Sun). */
  teluguBlock: boolean;
  /** A weekly-revision / weekly round-up marker (Sundays). */
  weeklyRevision: boolean;
  /** True for a deliberately LIGHT day (Sat before the exam). */
  light: boolean;
  /**
   * True for a learner DAY OFF (a festival/holiday in `settings.daysOff`) —
   * a LIGHT-style day capped at ≤ 60 min (Current Affairs + flashcards only):
   * no mock, no new topic, no week test. Distinct from {@link light} (the fixed
   * exam−1 day) so the Today view only shows the exam-day checklist on the real
   * light day, never on a day off. Any first-pass work a day off would have
   * carried flows into the catch-up buffers, and mocks/week tests move to the
   * next suitable day (see {@link buildMockSchedule}).
   */
  dayOff: boolean;
  /** The day's time BUDGET in minutes (weekend budget on weekends). */
  budgetMin: number;
  /** The total scheduled MINUTES today — always `≤ budgetMin`. */
  plannedMinutes: number;
  /**
   * Suggested number of drill questions for the day — the SUM across the day's
   * first-pass topics of `min(PER_TOPIC_DRILL_QUOTA, authored MCQs)`, plus a
   * fixed allowance for the Current-Affairs drill and any Mental Ability
   * practice set. See {@link PER_TOPIC_DRILL_QUOTA}.
   */
  drillTarget: number;
  /**
   * Per-topic breakdown of the day's first-pass blocks, carrying each topic's
   * authored `mcqCount` + chosen pass so views can show `Topic · N Q` and a
   * QUICK badge. Empty on mock / final / exam days.
   */
  topics: PlanTopic[];
  /**
   * The WEEKLY SUBJECT UNIT this day's MAIN study block teaches (STANDARDS §8a),
   * or `null` on a day with no unit main block (mocks, week tests, final window,
   * light/exam, pre-start). During the first pass a day's main block teaches
   * exactly ONE unit; during the revision cycle it REVISITS one unit. Views
   * render the unit header + progress ("Unit 3 of 14 · day 2 of 4") from these.
   */
  unitId: string | null;
  /** The current unit's beginner-friendly title (`null` when `unitId` is null). */
  unitTitle: string | null;
  /** The current unit's subject code (`null` when `unitId` is null). */
  unitSubjectCode: string | null;
  /** 1-based day index of this unit's run (how many days in it has been taught). */
  unitDay: number;
  /** Total days this unit's run spans across the plan. */
  unitDays: number;
  /** The NEXT unit's title after this one finishes, or `null` when it is the last. */
  nextUnitTitle: string | null;
  /**
   * POST-PRELIMS kick-start only (STANDARDS §8a): the Mains paper (I–V) this day
   * is doing "Mains revision of what you studied" for — the mapped Prelims
   * subtopics' For-Mains notes + the answers to write. One paper per day,
   * round-robin over the first {@link POST_PRELIMS_MAINS_REVISION_DAYS} days;
   * `null`/absent on pre-Prelims days and later kick-start days.
   */
  mainsPaperRevision?: PlanMainsPaper | null;
  status: PlanDayStatus;
}

/** One subject's FULL/STANDARD/QUICK fit report over its sequence. */
export interface SubjectFit {
  subject: string;
  total: number;
  full: number;
  /** Topics studied at the mid STANDARD tier ({@link STANDARD_MIN} min). */
  standard: number;
  quick: number;
  /** Date this subject's LAST topic was first-passed (`''` when none). */
  lastFirstPassISO: string;
  /** True when the subject spilled new topics past the coverage-end date. */
  spill: boolean;
  spillTopicIds: string[];
  /** Dates of weekday slots this subject received via reallocation. */
  reallocatedFromISO: string[];
  /** DEPTH-FLOOR topics (band A / AP-specific / top-30% PYQ) in this subject. */
  floorTotal: number;
  /**
   * Floor topics that slot capacity forced to a QUICK pass (still taught, never
   * dropped). Empty when the whole floor was honoured at FULL depth.
   */
  quickFloorTopicIds: string[];
  /** This subject's total FIRST-PASS new-topic minutes (base @240, FULL+QUICK). */
  newTopicMinutes: number;
}

/** The PRELIMS-focused feasibility + coverage read-out accompanying the plan. */
export interface PlanSummary {
  examDateISO: string;
  /** Inclusive calendar days from the plan start to the exam. */
  daysTotal: number;
  /** Inclusive calendar days from today to the exam (0 once past). */
  daysLeft: number;
  /** Coverage (rhythm) days remaining from today onward. */
  learnDaysLeft: number;

  /** True once the rhythm is running (pre-Prelims). Views branch on this. */
  rhythm: boolean;

  /** Coverage-window day count (to the coverage-end date). */
  coverageDays: number;
  /** Revision-cycle day count (0 in the short-window fallback). */
  revisionDays: number;
  /** Final-window day count (the 21-day window + light + exam day). */
  finalDays: number;
  /** How many full-length mock sittings the plan schedules. */
  mockSittings: number;

  /** True once the exam has passed and the plan is in MAINS kick-start mode. */
  postPrelims: boolean;

  /* ---- Time budget ---- */
  /** The learner's daily study-time budget in minutes. */
  dailyBudgetMin: number;
  /** The weekend study-time budget in minutes (defaults to the daily budget). */
  weekendBudgetMin: number;
  /** Total FIRST-PASS topic minutes across the coverage window. */
  firstPassMinutes: number;
  /** Coverage-window PAPER-I first-pass minutes (theory). */
  coverageP1Minutes: number;
  /** Coverage-window PAPER-II first-pass minutes (MENT/SCI/CA topics). */
  coverageP2Minutes: number;
  /** Paper-II share of coverage first-pass minutes, whole percent. */
  coverageP2SharePct: number;
  /** How many Mental Ability PRACTICE sets the plan schedules. */
  mentPracticeSets: number;
  /** Total revision minutes (revise + targeted-revision + weekly blocks). */
  revisionMinutes: number;
  /** Buffer days reserved near the exam (final days that are not full mocks). */
  bufferDays: number;
  /** Average scheduled minutes across study days (excludes the empty exam day). */
  avgStudyDayMinutes: number;
  /** Maximum scheduled minutes on any single study day. */
  maxStudyDayMinutes: number;
  /** How many weekend Mains answers are scheduled (0 pre-Prelims). */
  weekendMainsCount: number;

  /* ---- Fit / feasibility ---- */
  /** True when every subject's sequence fits its slots by coverage-end (no spill). */
  feasible: boolean;
  /** Hours of work spilled past coverage-end (0 when feasible). */
  shortfallHours: number;
  /** Retained for the view surface (empty in the rhythm — no FAST bands). */
  fastBands: Band[];
  /** Retained for the view surface (empty in the rhythm). */
  fastBandBTopicIds: string[];
  /** Human-readable options when a subject spills. */
  feasibilityOptions: string[];
  /** Items DEFERRED to the post-prelims Mains kick-start (English, essay, mains). */
  deferredItems: string[];

  /**
   * RE-AUDIT 2 — RECOVERY MODE. True when a progress-aware / tight re-plan would
   * otherwise have spilled first-pass topics past the coverage-end date and the
   * planner absorbed them by (1) teaching the unfinished first passes in
   * learning-sequence order on the catch-up buffers + the revision cycle's first
   * week (shifting coverage end up to 7 days later, shortening the revision cycle
   * — never the final window) and, only if still short, (2) downgrading the
   * lowest-priority non-AP / non-band-A topics FULL→STANDARD→QUICK. The plan
   * stays FEASIBLE; Today / Planner show a calm (non-alarm) banner.
   */
  recovery: boolean;
  /**
   * How many study days behind the on-time schedule the learner is — the count
   * of elapsed plan study-days whose first-pass topics are not yet studied. 0
   * when on time (today = plan start) or when progress is complete. Drives the
   * banner "You're N days behind — the plan has been adjusted: …".
   */
  daysBehind: number;
  /**
   * Plain-language description of what RECOVERY changed (banner detail), e.g.
   * "moved 14 topics into the first revision week; the revision cycle is 2 days
   * shorter". Empty when not in recovery.
   */
  recoveryChanges: string[];

  /** Paper-I THEORY subtopics in scope. */
  theoryTotal: number;
  /** Paper-I THEORY subtopics with any recorded activity. */
  theoryStudied: number;
  /** Paper-II APTITUDE subtopics in scope. */
  aptitudeTotal: number;
  /** Paper-II APTITUDE subtopics with any recorded activity. */
  aptitudeStudied: number;

  /** Prelims subtopics in scope = theoryTotal + aptitudeTotal. */
  prelimsTotal: number;
  /** Prelims subtopics with any recorded activity. */
  prelimsStudied: number;
  /** Prelims subtopics whose mastery is ≥ 80%. */
  prelimsMastered: number;
  /** Prelims subtopics with any authored material (honest authoring coverage). */
  prelimsWithMaterial: number;

  /** prelimsStudied / prelimsTotal, whole percent (progress coverage). */
  prelimsCoveragePct: number;
  /** prelimsWithMaterial / prelimsTotal, whole percent (authoring coverage). */
  prelimsMaterialCoveragePct: number;
  /** Average per-subtopic mastery across the prelims scope, whole percent. */
  prelimsMasteryPct: number;

  /** Unstudied THEORY ÷ remaining coverage days, rounded up (catch-up pace). */
  theoryPerDay: number;
  /** Unstudied APTITUDE ÷ remaining coverage days, rounded up (catch-up pace). */
  aptitudePerDay: number;

  /** How many prelims subtopics an even pace says should be studied by today. */
  expectedStudiedByToday: number;
  /** True when actual prelims studied ≥ expected. */
  onTrack: boolean;
  /** How many prelims subtopics behind the expected pace (0 when on track). */
  behindBy: number;
  /** Projected date all prelims subtopics are first-passed. */
  projectedFinishISO: string;

  /* ---- Rhythm read-out ---- */
  /** Per-subject FULL/QUICK fit report. */
  subjectFit: SubjectFit[];
  /**
   * The WEEKLY SUBJECT UNITS of the first pass, in teaching order, each with the
   * calendar window it occupies (`startISO`→`endISO`, the first and last
   * coverage day its main block is taught) and how many topics it carries. The
   * Planner view renders the unit timeline from this. Empty in the short-window
   * fallback / post-prelims.
   */
  units: Array<{ id: string; title: string; subjectCode: string; startISO: string; endISO: string; topicCount: number }>;
  /** Date all MENT topics were first-passed (`''` when none). */
  mentAllPassedISO: string;
  /** The full test schedule (date → paper + per-paper series number + kind). */
  mockList: Array<{ dateISO: string; paper: PaperId; mockNumber: number; kind: MockKind }>;
  /** How many first-pass WEEK TESTS are scheduled (long window; 0 short). */
  weekTests: number;
  /** The dress-rehearsal date (the one first-pass full mock), '' when none. */
  dressRehearsalISO: string;
  /** Full-mock sittings per paper (dress + revision + final), excluding week tests. */
  fullMockPaperCounts: Record<PaperId, number>;
  /** Weekday slots reassigned from a finished subject to the neediest one. */
  reallocations: Array<{ dateISO: string; fromSubject: string; toSubject: string }>;
  /** The coverage-end date after which no new topics are introduced. */
  coverageEndISO: string;
  /** Any subjects that spilled new topics into the post-coverage spill buffer. */
  spills: Array<{ subject: string; topicIds: string[]; lastDateISO: string }>;

  /**
   * DEPTH-FLOOR topics (band A / AP-specific / top-30% PYQ) that slot capacity
   * forced to a QUICK pass. Empty when the whole floor was honoured at FULL
   * depth. History carries most of these — its 47 topics cannot all be FULL
   * within the Paper-I slot budget without starving the smaller subjects.
   */
  infeasibleFloorTopicIds: string[];
  /**
   * Below-floor topics whose floor is MET via a scheduled DEEPEN top-up in the
   * final window (STANDARDS §8a) — one entry per topic with the tier it is
   * lifted `fromTier`→`toTier` and the `dateISO` the deepen pass is scheduled.
   * A deepened topic counts as MEETING its floor (its EFFECTIVE tier), so it is
   * NOT reported in {@link infeasibleFloorTopicIds}; only topics still below
   * their floor after deepening remain there. Empty when nothing was deepened.
   */
  deepenTopicIds: Array<{ id: string; fromTier: PlanPass; toTier: PlanPass; dateISO: string }>;
  /**
   * PAPER-I (theory) FIRST-PASS new-topic minutes per subject (base @240) and
   * each subject's whole-percent share of the Paper-I total. The rhythm targets
   * a balanced 20–32% per subject; History is structurally the largest (47
   * topics × ≥25-min QUICK floor) and Geography the smallest (8 topics).
   */
  paperOneMinutesBySubject: Record<string, number>;
  paperOneSharePctBySubject: Record<string, number>;

  /* ---- Parallel MAINS / qualifying track (excluded from the deadline) ---- */
  /** Count of `mains`-track subtopics (Telugu + English & Essay). */
  mainsSubjectsTotal: number;
  /** Count of mains practice questions available in the bank. */
  mainsQuestionsTotal: number;
  /** How many mains questions the post-prelims daily quota schedules (0 if none). */
  mainsPerDay: number;
}

/** The full plan: the day list plus its feasibility summary. */
export interface Plan {
  days: PlanDay[];
  summary: PlanSummary;
}

/**
 * The learning SEQUENCE the rhythm packs topics in: per-subject ordered
 * subtopic ids (prereq-correct) plus the MENT stream tags. Filtered to
 * in-scope subtopics by the caller.
 */
export interface PlanSequence {
  /** subjectCode → ordered subtopic ids (in-scope). */
  order: Readonly<Record<string, readonly string[]>>;
  /** MENT subtopic id → stream tag (`quant`/`reasoning`/`abilities`). */
  mentStreams?: Readonly<Record<string, LearningStream>>;
  /**
   * HISTORY subtopic id → chronological STREAM tag (`early`/`modern`). History
   * is scheduled as TWO parallel chronological streams so its high-yield Modern
   * + AP topics no longer land last (see {@link buildRhythmPlan}): Monday
   * advances `early` (ancient + medieval + AP early dynasties), Sunday advances
   * `modern` (modern + AP freedom/statehood + art & culture). Absent → History
   * is packed as a single `early` chain (the fallback for unit fixtures).
   */
  histStreams?: Readonly<Record<string, 'early' | 'modern'>>;
  /**
   * The ordered WEEKLY SUBJECT UNITS the first pass teaches one at a time
   * (STANDARDS §8a). Each unit's `topicIds` is a contiguous run of its subject's
   * sequence, already filtered to in-scope subtopics by the caller. When absent
   * (older unit fixtures) the engine derives ONE unit per subject from the
   * per-subject order, so the unit-stream rhythm always has units to teach.
   */
  units?: readonly PlanUnit[];
}

/** Options for {@link buildPlan}. */
export interface BuildPlanOpts {
  subtopics: readonly PlanSubtopic[];
  progress: PlannerProgress;
  /** The mains question bank (ids) the post-prelims daily quota cycles through. */
  mainsQuestionIds?: readonly string[];
  /**
   * POST-PRELIMS kick-start (STANDARDS §8a): the Mains papers (I–V) mapped to the
   * studied Prelims subtopics whose For-Mains notes are revisited + the answers
   * to write. Built by the view layer from `content/audit/syllabus-map.json`
   * (`mains-1`..`mains-5` clauses). Absent → the kick-start has no per-paper
   * Mains-revision days (the old behaviour).
   */
  mainsPapers?: readonly PlanMainsPaper[];
  /** Target exam date, ISO `YYYY-MM-DD`. */
  examDateISO: string;
  /** Today's date, ISO `YYYY-MM-DD`. */
  todayISO: string;
  /** Plan start date, ISO `YYYY-MM-DD` (affects `daysTotal` + day status only). */
  startISO: string;
  /**
   * The learner's DAILY study-time budget in minutes. No day is ever scheduled
   * beyond this (weekends use {@link weekendBudgetMin}). Defaults to
   * {@link DEFAULT_DAILY_BUDGET_MIN}.
   */
  dailyBudgetMin?: number;
  /**
   * The WEEKEND study-time budget in minutes. Defaults to the daily budget so
   * an unset weekend budget simply mirrors weekdays.
   */
  weekendBudgetMin?: number;
  /**
   * Optional per-subtopic PYQ frequency weight (how many past-paper QUESTIONS
   * mapped to the topic across the 3-cycle corpus). In the rhythm it orders the
   * FULL-pass priority within a subject (AP → band A → PYQ desc → examPoints
   * desc). When absent, `examPointCount` is the fallback weight.
   */
  pyqFrequency?: Readonly<Record<string, number>>;
  /**
   * The learning SEQUENCE the rhythm packs topics in. When omitted a fallback
   * order is derived from each subject's subtopics sorted by `order`.
   */
  sequence?: PlanSequence;
  /**
   * Festival / holiday DAYS OFF as ISO `YYYY-MM-DD` strings (from
   * `settings.daysOff`). Each is a LIGHT day the planner caps at ≤ 60 min
   * (Current Affairs + flashcards only): no mock, no new topic, no week test.
   * A mock / week test that would fall on a day off MOVES to the next suitable
   * day; displaced first-pass work flows into the catch-up buffers (every topic
   * is still first-passed once by the coverage-end date). Absent → no days off.
   */
  daysOff?: readonly string[];
}

/**
 * PER-TOPIC daily drill quota — the ceiling of questions we suggest drilling
 * from ONE subtopic on the day it is scheduled. A day's
 * {@link PlanDay.drillTarget} sums `min(PER_TOPIC_DRILL_QUOTA, authoredMCQs)`
 * across its scheduled topics, so topics with no authored questions contribute
 * 0 and the target reflects only material that actually exists.
 */
export const PER_TOPIC_DRILL_QUOTA = 20;

/** The post-prelims daily MAINS quota — kept in the required 2–4 band. */
export const MAINS_PER_DAY = 3;

/** How many days forward the post-prelims MAINS kick-start plan lays out. */
export const POST_PRELIMS_HORIZON_DAYS = 30;

/**
 * The "study once for Prelims, revise for Mains later" add-on: MINUTES added to
 * a REVISION-CYCLE revisit of a topic that has an authored "For Mains" note, to
 * read that analytical note. Applied ONLY in the revision cycle (7 Dec – 2 Jan
 * for the real plan) and ONLY while the revisit block stays within its minutes;
 * the first pass and the final window never include this reading (STANDARDS §8a).
 */
export const MAINS_ANGLE_MIN = 5;

/**
 * POST-PRELIMS kick-start: the first N days are "Mains revision of what you
 * studied" — one Mains paper (I–V) per day, round-robin, revisiting that paper's
 * mapped Prelims subtopics' For-Mains notes + writing their answers (STANDARDS
 * §8a). Four weeks = 28 days. Later kick-start days carry no per-paper revision.
 */
export const POST_PRELIMS_MAINS_REVISION_DAYS = 28;

/**
 * One Mains PAPER (I–V) for the post-prelims kick-start, mapping the paper to the
 * ALREADY-STUDIED Prelims subtopics whose "For Mains" notes are revisited and the
 * authored Mains questions whose answers are written. Built by the view layer
 * from `content/audit/syllabus-map.json` (the `mains-1`..`mains-5` clauses) and
 * threaded into {@link buildPlan} via {@link BuildPlanOpts.mainsPapers}.
 */
export interface PlanMainsPaper {
  /** Audit paper id, `mains-1`..`mains-5`. */
  paper: string;
  /** Human label, e.g. `Mains Paper I`. */
  title: string;
  /** Mapped Prelims subtopic ids to revisit the For-Mains notes of. */
  subtopicIds: readonly string[];
  /** Authored Mains question ids (from `mains-<id>.json`) to write answers for. */
  mainsQuestionIds: readonly string[];
}

/** Default daily study-time budget (minutes) for a working professional — 4 h. */
export const DEFAULT_DAILY_BUDGET_MIN = 240;

/**
 * BEGINNER RAMP (STANDARDS §8a): the first {@link BEGINNER_RAMP_DAYS} WEEKDAYS
 * after day 1 run at this reduced minute budget so a beginner eases in. Only the
 * MAIN study block is shortened (the fixed Mental Ability / Revise / Current
 * Affairs / Telugu blocks keep their full minutes); the displaced first-pass
 * topics flow into the catch-up buffers (Saturday catch-up + Sunday), so every
 * topic is still first-passed once by the coverage-end date. Applied only in the
 * long window (the compressed short-window fallback never ramps).
 */
export const BEGINNER_RAMP_BUDGET_MIN = 180;

/** How many weekdays after day 1 run at the {@link BEGINNER_RAMP_BUDGET_MIN}. */
export const BEGINNER_RAMP_DAYS = 5;

/** Synthetic subtopic id carried by a Mental Ability {@link PlanTopicKind} `practice` block. */
export const PRACTICE_SUBTOPIC_ID = 'ment-practice';

/** Questions in one Mental Ability practice set (the required 15–20 band, top). */
export const PRACTICE_QUESTIONS = 20;

/** Study MINUTES for one Mental Ability practice set (the required 25–30 band). */
export const PRACTICE_MIN = 30;

/**
 * The ONE study-time model shared by the planner AND the views. Minutes per
 * activity, so every surface shows the SAME arithmetic.
 *
 * - `revisit` — a spaced re-visit of one already-studied subtopic.
 * - `mainsAnswer` — writing one Mains answer.
 * - `fullMock` — a full-length paper (120 min) + 30 min review.
 * - `sectionalMock` — a shorter section-only mock.
 * - `caRefresh` — a current-affairs refresh.
 * - `languageBlock` — one qualifying-language block (Telugu / English).
 * - `essay` — one General Essay sitting.
 */
export const TIME = {
  revisit: 8,
  mainsAnswer: 20,
  fullMock: 150,
  sectionalMock: 45,
  caRefresh: 30,
  languageBlock: 30,
  essay: 60,
} as const;

/* -------------------------------------------------------------------------- */
/* Rhythm calendar — DERIVED from the exam date (no hardcoded calendar)        */
/* -------------------------------------------------------------------------- */

/**
 * The FINAL revision window length in days: the last 21 days before the exam
 * (exam−21 … exam−2), during which NO new topics are introduced — only targeted
 * weakest-first revision, AP/CA refresh, deepen top-ups and full mocks (3 days a
 * week). The light day (exam−1) and the empty exam day sit just after it.
 */
export const FINAL_WINDOW_DAYS = 21;

/**
 * The REVISION CYCLE length in days — the ~4-week sequence-order revision pass
 * that sits between the first-pass coverage window and the final window. Each
 * subject block revisits its topics in sequence order (weakest-first) at ~25 min
 * each. COVERAGE END = the final-window start minus this cycle.
 */
export const REVISION_CYCLE_DAYS = 28;

/**
 * SHORT-WINDOW threshold (weeks). When the plan start → exam span is shorter
 * than this, the planner drops the revision cycle and compresses the final
 * window to {@link SHORT_FINAL_WINDOW_DAYS} — the OLD pre-2027 behaviour, so a
 * tight re-plan still produces a sane schedule.
 */
export const SHORT_WINDOW_WEEKS = 8;

/** The compressed final-window length used by the short-window fallback. */
export const SHORT_FINAL_WINDOW_DAYS = 10;

/** The phase anchors the whole rhythm plan derives from the exam date. */
export interface PlanAnchors {
  /** The EXAM day (empty). */
  examISO: string;
  /** The LIGHT day — exam − 1 (≤ 90 min, no mock). */
  lightISO: string;
  /** First day of the final revision window — exam − {@link FINAL_WINDOW_DAYS}. */
  finalStartISO: string;
  /** First day of the revision cycle, or `null` in the short-window fallback. */
  revisionStartISO: string | null;
  /** Last COVERAGE day — no NEW topics are introduced after it. */
  coverageEndISO: string;
  /** The two days a genuine coverage tail may spill into (last resort). */
  spillDates: readonly [string, string];
  /** True when the compressed short-window fallback is in effect. */
  shortWindow: boolean;
}

/**
 * Compute every rhythm phase anchor from the exam date + plan start — the ONE
 * place the calendar is derived, so changing `settings.examDate` just works
 * (there are NO hardcoded calendar dates anywhere in the planner). Pure.
 *
 *   coverage (first pass)   …  revisionStart − 1
 *   revision cycle          revisionStart … finalStart − 1   (long window only)
 *   final window (21 days)  finalStart (exam−21) … exam − 2
 *   light                   exam − 1
 *   exam                    exam
 *
 * Short window (< {@link SHORT_WINDOW_WEEKS} weeks to the exam): no revision
 * cycle and a compressed {@link SHORT_FINAL_WINDOW_DAYS}-day final window.
 */
export function computePlanAnchors(examISO: string, planStartISO: string): PlanAnchors {
  const lightISO = addDaysISO(examISO, -1);
  const spanDays = inclusiveDaysISO(planStartISO, examISO);
  const shortWindow = spanDays < SHORT_WINDOW_WEEKS * 7;

  if (shortWindow) {
    const finalStartISO = addDaysISO(examISO, -SHORT_FINAL_WINDOW_DAYS);
    const coverageEndISO = addDaysISO(finalStartISO, -1);
    return {
      examISO,
      lightISO,
      finalStartISO,
      revisionStartISO: null,
      coverageEndISO,
      spillDates: [finalStartISO, addDaysISO(finalStartISO, 1)],
      shortWindow: true,
    };
  }

  const finalStartISO = addDaysISO(examISO, -FINAL_WINDOW_DAYS);
  const coverageEndISO = addDaysISO(finalStartISO, -REVISION_CYCLE_DAYS);
  const revisionStartISO = addDaysISO(coverageEndISO, 1);
  return {
    examISO,
    lightISO,
    finalStartISO,
    revisionStartISO,
    coverageEndISO,
    // Last resort only: a genuine coverage tail spills into the first two
    // revision-cycle days (it should not happen with the long window).
    spillDates: [revisionStartISO, addDaysISO(revisionStartISO, 1)],
    shortWindow: false,
  };
}

/** The rhythm region a date falls in, given the derived {@link PlanAnchors}. */
export function regionForISO(dateISO: string, a: PlanAnchors): DaySlotRegion {
  if (dateISO >= a.examISO) return 'exam';
  if (dateISO === a.lightISO) return 'light';
  if (dateISO >= a.finalStartISO) return 'final';
  if (a.revisionStartISO !== null && dateISO >= a.revisionStartISO) return 'revision';
  return 'coverage';
}

/** The ISO date of the first `dow` (0=Sun … 6=Sat) on or after `fromISO`. @internal */
function firstDowOnOrAfter(fromISO: string, dow: number): string {
  let d = fromISO;
  for (let i = 0; i < 7; i += 1) {
    if (dayOfWeekISO(d) === dow) return d;
    d = addDaysISO(d, 1);
  }
  return fromISO;
}

/**
 * A scheduled Saturday/weekday TEST event: its {@link MockKind}, the paper
 * (meaningful for full mocks + the dress rehearsal; a placeholder for a week
 * test, which spans both papers) and its 1-based series number WITHIN its kind
 * family — full mocks (dress + revision + final) share one per-paper counter;
 * week tests have their own counter.
 */
export interface ScheduledMock {
  kind: MockKind;
  paper: PaperId;
  num: number;
}

/**
 * Build the full test schedule (date → {@link ScheduledMock}) DERIVED from the
 * plan start + anchors — never a hardcoded calendar. Pure.
 *
 * LONG window (the real scenario):
 *  - TWO DRESS REHEARSALS (`dress-rehearsal` full mocks) on the coverage
 *    Saturdays nearest planStart+28 (Paper-II) and planStart+42 (Paper-I) —
 *    for the real plan, Sat 7 Nov (Paper-II) and Sat 21 Nov (Paper-I).
 *  - WEEKLY full mocks (`full`) every Saturday from the LAST coverage Saturday
 *    (the week that ends the first pass — Sat 5 Dec) through the revision cycle,
 *    alternating Paper-II first.
 *  - The OTHER first-pass Saturdays → `week-test`: a short, studied-topics-only
 *    timed test (see {@link buildWeekTest}).
 *  - FINAL WINDOW → `full` mocks on 3 days a week (Tue / Thu / Sat), alternating
 *    Paper-I / Paper-II (Paper-I first).
 *
 * SHORT window (compressed fallback): every scheduled Saturday is a `full` mock,
 * exactly as before (no week tests, no dress rehearsal).
 *
 * Full-mock series numbers (two dress rehearsals + weekly + final) are a single
 * per-paper counter ascending by date; week tests carry their own counter. Each
 * paper draws the NON-REPEATING series (see `engine/mock.ts`); when a mock number
 * exceeds the pool-supported `mockSeriesLength`, that section WRAPS (flagged by
 * the mock engine and surfaced by the UI).
 *
 * DAYS OFF (`daysOff`): a scheduled mock / week test that lands on a day off is
 * MOVED forward to the next suitable day — the nearest later date that is not a
 * day off, not the light day, not the exam, and does not already hold a test
 * (so it never collides with a final-window mock day). Keeps mocks off every
 * festival/holiday the learner marks.
 */
export function buildMockSchedule(
  planStartISO: string,
  a: PlanAnchors,
  orientationISO?: string,
  daysOff: ReadonlySet<string> = new Set<string>(),
): Map<string, ScheduledMock> {
  const out = new Map<string, ScheduledMock>();

  // Move any scheduled test off a DAY OFF to the next suitable day — the nearest
  // later date that is not a day off / light / exam and holds no other test (so
  // it never collides with a final-window mock day). Called just before each
  // return so both the short- and long-window shapes honour the days off.
  //
  // N3 — NO TWO FULL MOCKS ON CONSECUTIVE DAYS: a displaced FULL mock (full or
  // dress-rehearsal) additionally skips any day ADJACENT (±1) to another full
  // mock, so a mock pushed out of a festival break (e.g. the 13–15 Jan Sankranti
  // break displacing the Thu mock) is never scheduled back-to-back with the
  // Saturday/Tuesday full mock. The natural Tue/Thu/Sat cadence already leaves a
  // free day between mocks, so only a relocation can create a consecutive pair;
  // if the dense final window offers no non-adjacent day, the displaced full mock
  // is dropped (the window already runs ~3 mocks/week) rather than doubled up.
  // Week tests are not full mocks and never trigger the adjacency rule.
  const isFullKind = (k: MockKind): boolean => k === 'full' || k === 'dress-rehearsal';
  const adjacentFullMock = (dateISO: string): boolean => {
    for (const d of [addDaysISO(dateISO, -1), addDaysISO(dateISO, 1)]) {
      const m = out.get(d);
      if (m !== undefined && isFullKind(m.kind)) return true;
    }
    return false;
  };
  const relocateDaysOff = (): void => {
    if (daysOff.size === 0) return;
    for (const dateISO of [...out.keys()].filter((d) => daysOff.has(d)).sort()) {
      const mock = out.get(dateISO)!;
      out.delete(dateISO);
      const avoidAdjacent = isFullKind(mock.kind);
      let t = addDaysISO(dateISO, 1);
      let guard = 0;
      let placed = false;
      while (guard < 400 && t < a.examISO) {
        guard += 1;
        if (
          daysOff.has(t) ||
          t === a.lightISO ||
          out.has(t) ||
          (avoidAdjacent && adjacentFullMock(t))
        ) {
          t = addDaysISO(t, 1);
          continue;
        }
        out.set(t, mock);
        placed = true;
        break;
      }
      // No suitable day before the exam (none non-adjacent for a full mock) → the
      // test is dropped rather than scheduled on a day off or back-to-back with
      // another full mock.
      void placed;
    }
  };

  // RE-AUDIT 2 (R2) — CONTIGUOUS SERIES NUMBERS: assign each test's series number
  // by date AFTER any relocation/drop, so a dropped or displaced full mock never
  // leaves a gap (e.g. Paper-I 1,2,3,4,5,7). Full mocks (full + dress-rehearsal)
  // share one per-paper counter ascending by date; week tests carry their own.
  // Must run last (after relocateDaysOff), since the pre-assignment counters are
  // computed before a mock may be dropped.
  const renumber = (): void => {
    const fullCounter: Record<PaperId, number> = { paper1: 0, paper2: 0 };
    let weekCounter = 0;
    for (const dateISO of [...out.keys()].sort()) {
      const m = out.get(dateISO)!;
      if (m.kind === 'week-test') {
        weekCounter += 1;
        out.set(dateISO, { ...m, num: weekCounter });
      } else {
        fullCounter[m.paper] += 1;
        out.set(dateISO, { ...m, num: fullCounter[m.paper] });
      }
    }
  };

  // ---- SHORT window: every Saturday a full mock (the old shape) -------------
  if (a.shortWindow) {
    const paperByDate = new Map<string, PaperId>();
    let alt = 0;
    for (let d = firstDowOnOrAfter(planStartISO, 6); d < a.finalStartISO; d = addDaysISO(d, 7)) {
      paperByDate.set(d, alt % 2 === 0 ? 'paper2' : 'paper1'); // start Paper-II
      alt += 1;
    }
    for (let d = firstDowOnOrAfter(a.finalStartISO, 6); d < a.lightISO; d = addDaysISO(d, 7)) {
      paperByDate.set(d, alt % 2 === 0 ? 'paper2' : 'paper1');
      alt += 1;
    }
    if (orientationISO !== undefined) paperByDate.delete(orientationISO);
    const counter: Record<PaperId, number> = { paper1: 0, paper2: 0 };
    for (const dateISO of [...paperByDate.keys()].sort()) {
      const paper = paperByDate.get(dateISO)!;
      counter[paper] += 1;
      out.set(dateISO, { kind: 'full', paper, num: counter[paper] });
    }
    relocateDaysOff();
    renumber();
    return out;
  }

  // ---- LONG window ----------------------------------------------------------
  // 1) Coverage Saturdays (first pass): week tests, minus the two dress
  //    rehearsals and the weekly full mocks (see below).
  const coverageSaturdays: string[] = [];
  for (let d = firstDowOnOrAfter(planStartISO, 6); d < (a.revisionStartISO ?? a.finalStartISO); d = addDaysISO(d, 7)) {
    if (orientationISO !== undefined && d === orientationISO) continue;
    coverageSaturdays.push(d);
  }
  // TWO DRESS REHEARSALS (STANDARDS §8a, item 4): early full-length rehearsals on
  // the coverage Saturdays NEAREST ~4 weeks (planStart+28, Paper-II) and ~6 weeks
  // (planStart+42, Paper-I) in — exam-date-relative, so for the real plan (start
  // Sat 10 Oct) they land on Sat 7 Nov (Paper-II) and Sat 21 Nov (Paper-I). The
  // nearest-Saturday derivation keeps them stable if the start shifts.
  const nearestCoverageSaturday = (targetISO: string, exclude: ReadonlySet<string>): string | null => {
    let best: string | null = null;
    let bestGap = Infinity;
    for (const d of coverageSaturdays) {
      if (exclude.has(d)) continue;
      const gap = Math.abs(diffDaysISO(targetISO, d));
      if (gap < bestGap) {
        bestGap = gap;
        best = d;
      }
    }
    return best;
  };
  const dress1ISO = nearestCoverageSaturday(addDaysISO(planStartISO, 28), new Set<string>());
  const dress2ISO = nearestCoverageSaturday(addDaysISO(planStartISO, 42), new Set<string>([dress1ISO ?? '']));
  const dressPaperByDate = new Map<string, PaperId>();
  if (dress1ISO !== null) dressPaperByDate.set(dress1ISO, 'paper2'); // dress #1 → Paper-II
  if (dress2ISO !== null) dressPaperByDate.set(dress2ISO, 'paper1'); // dress #2 → Paper-I
  const dressSet = new Set<string>([...dressPaperByDate.keys()]);

  // 2) WEEKLY full mocks (STANDARDS §8a, item 4): a full mock EVERY Saturday from
  //    the LAST coverage Saturday (the Saturday of the week that ends the first
  //    pass — Sat 5 Dec for the real plan) through the revision cycle, alternating
  //    Paper-II first. These replace the week tests on those Saturdays.
  const weeklyStartISO = coverageSaturdays.length > 0 ? coverageSaturdays[coverageSaturdays.length - 1]! : null;
  const weeklySats: string[] = [];
  if (weeklyStartISO !== null) {
    for (const d of coverageSaturdays) if (d >= weeklyStartISO && !dressSet.has(d)) weeklySats.push(d);
  }
  if (a.revisionStartISO !== null) {
    for (let d = firstDowOnOrAfter(a.revisionStartISO, 6); d < a.finalStartISO; d = addDaysISO(d, 7)) weeklySats.push(d);
  }
  const weeklyPaperByDate = new Map<string, PaperId>();
  {
    let wAlt = 0;
    for (const d of [...weeklySats].sort()) {
      weeklyPaperByDate.set(d, wAlt % 2 === 0 ? 'paper2' : 'paper1'); // Paper-II first
      wAlt += 1;
    }
  }

  // 3) Final-window full mocks: Tue/Thu/Sat (3/week), Paper-I first (unchanged).
  const finalPaperByDate = new Map<string, PaperId>();
  {
    let fAlt = 0;
    for (let d = a.finalStartISO; d < a.lightISO; d = addDaysISO(d, 1)) {
      const dow = dayOfWeekISO(d);
      if (dow === 2 || dow === 4 || dow === 6) {
        finalPaperByDate.set(d, fAlt % 2 === 0 ? 'paper1' : 'paper2'); // Paper-I first
        fAlt += 1;
      }
    }
  }

  // 4) Assemble: full mocks (two dress rehearsals + weekly + final) share one
  //    per-paper counter ascending by date; week tests carry their own counter.
  const fullPaperByDate = new Map<string, PaperId>();
  for (const [d, p] of dressPaperByDate) fullPaperByDate.set(d, p);
  for (const [d, p] of weeklyPaperByDate) fullPaperByDate.set(d, p);
  for (const [d, p] of finalPaperByDate) fullPaperByDate.set(d, p);

  const fullCounter: Record<PaperId, number> = { paper1: 0, paper2: 0 };
  for (const dateISO of [...fullPaperByDate.keys()].sort()) {
    const paper = fullPaperByDate.get(dateISO)!;
    fullCounter[paper] += 1;
    const kind: MockKind = dressSet.has(dateISO) ? 'dress-rehearsal' : 'full';
    out.set(dateISO, { kind, paper, num: fullCounter[paper] });
  }

  let weekTestNum = 0;
  for (const dateISO of [...coverageSaturdays].sort()) {
    if (dressSet.has(dateISO) || weeklyPaperByDate.has(dateISO)) continue;
    weekTestNum += 1;
    // `paper` is a placeholder for a week test (it spans both papers).
    out.set(dateISO, { kind: 'week-test', paper: 'paper2', num: weekTestNum });
  }
  relocateDaysOff();
  renumber();
  return out;
}

/** Weekday (dow 1..5) → the day's SUBJECT block. */
const SUBJECT_BY_DOW: Readonly<Record<number, string>> = {
  1: 'HIST',
  2: 'POL',
  3: 'ECON',
  4: 'GEO',
  5: 'SCI',
};

/** Weekday (dow 1..5) → base SUBJECT-block minutes @240 (Tue/Thu shed 15 for Telugu). */
const SUBJECT_BASE_MIN: Readonly<Record<number, number>> = {
  1: 135,
  2: 120,
  3: 135,
  4: 120,
  5: 135,
};

/** Weekday (dow 1..5) → the day's Current-Affairs rotation focus subtopic id. */
const CA_ROTATION: Readonly<Record<number, string>> = {
  1: 'ca-regional',
  2: 'ca-national',
  3: 'ca-regional',
  4: 'ca-international',
  5: 'ca-regional',
};

/** Human labels for a subject code (for block labels). */
const SUBJECT_LABEL: Readonly<Record<string, string>> = {
  HIST: 'History',
  POL: 'Polity',
  ECON: 'Economy',
  GEO: 'Geography',
  SCI: 'Science & Technology',
};

/** The Paper-I/Science subjects that own weekday slots and pool for reallocation. */
const SUBJECT_ORDER = ['HIST', 'POL', 'ECON', 'GEO', 'SCI'] as const;

/** Human labels for a Current-Affairs rotation subtopic. */
const CA_LABEL: Readonly<Record<string, string>> = {
  'ca-regional': 'Current Affairs (AP / Regional)',
  'ca-national': 'Current Affairs (National)',
  'ca-international': 'Current Affairs (International)',
};

/**
 * The THREE depth-tier minute constants (base @240) — the single place the time
 * model lives; views render the matching 'Full' / 'Standard' / 'Quick pass'
 * badges. FULL is capped at {@link FULL_CAP_MIN} (a per-topic full pass never
 * costs more than an hour — the old 90-min cap made the depth floor infeasible);
 * STANDARD and QUICK are the flat mid/light passes.
 */
export const FULL_CAP_MIN = 60;
export const STANDARD_MIN = 40;
export const QUICK_MIN = 25;

/**
 * DEEPEN top-up minutes — the EXTRA time a final-window `deepen` pass spends to
 * lift a below-floor topic from its planned tier to its FLOOR tier (STANDARDS
 * §8a). QUICK→STANDARD reads the remaining notes sections + ~10 more questions
 * (15 min); STANDARD→FULL adds the review + the rest of the drill (20 min). A
 * deepen is scheduled ONLY for a topic left below its floor after coverage, and
 * counts it as MEETING its floor (its effective tier). See
 * {@link PlanSummary.deepenTopicIds}.
 */
export const DEEPEN_QUICK_TO_STANDARD_MIN = 15;
export const DEEPEN_STANDARD_TO_FULL_MIN = 20;

/** Max DEEPEN topics scheduled into one final-window `targeted-revision` block. */
export const DEEPEN_MAX_PER_BLOCK = 4;

/* -------------------------------------------------------------------------- */
/* UNIT WRAP-UP (consolidate a unit right after finishing it, STANDARDS §8a)   */
/* -------------------------------------------------------------------------- */

/**
 * Minimum leftover main-block minutes (after a unit's last topics) that triggers
 * a UNIT WRAP-UP. On a unit's last first-pass day, when the main block has at
 * least this much time left, the beginner consolidates the unit instead of
 * leaving the block idle (STANDARDS §8a).
 */
export const WRAPUP_MIN_IDLE_MIN = 30;

/** The largest a single unit wrap-up ever grows to (`min(leftover, this)`). */
export const WRAPUP_MAX_MIN = 90;

/** Fixed minutes of a wrap-up spent on the "Topic at a glance" recap. */
export const WRAPUP_GLANCE_MIN = 15;

/** Fixed minutes of a wrap-up spent reviewing wrong / guessed answers. */
export const WRAPUP_REVIEW_MIN = 15;

/**
 * The timed UNIT TEST size inside a wrap-up of `size` minutes: the middle slice
 * after the glance + review, at 1 question / minute, −1/3 marking. Never
 * negative (a 30-min wrap-up is glance + review only, with a 0-question test).
 */
export function unitTestCountForWrapup(size: number): number {
  return Math.max(0, Math.round(size - WRAPUP_GLANCE_MIN - WRAPUP_REVIEW_MIN));
}

/** Matches AP-specific subtopic ids (studied at FULL depth first). */
const AP_RE = /-ap-|andhra|ap-culture|ap-reorganisation|ap-economy/;

/**
 * Study-minute baseline by priority band — heavier (more examinable) bands cost
 * more time. Feeds {@link subtopicMinutes}. @internal
 */
const BAND_BASE_MIN: Record<Band, number> = { A: 25, B: 20, C: 15, D: 10 };

/**
 * FULL-DEPTH estimated study MINUTES for a subtopic, scaling with its priority
 * band and the volume of material it carries: a band baseline + ~1 min per
 * drillable MCQ (capped by {@link PER_TOPIC_DRILL_QUOTA}) + ~1.5 min per
 * examinable point. Pure and deterministic.
 */
export function subtopicMinutes(
  band: Band | undefined,
  mcqCount: number,
  examPointCount = 0,
): number {
  const base = band ? BAND_BASE_MIN[band] : 12; // untracked band → light baseline
  const drill = availableDrill(mcqCount); // 1 min per drillable question
  const points = Math.max(0, examPointCount) * 1.5; // 1.5 min per exam point
  return Math.round(base + drill + points);
}

/**
 * FAST-PASS study MINUTES for a subtopic — a focused drill + key-facts sweep:
 * `round(10 + min(15, mcqCount) + 0.5 · examPoints)`. Retained (exported) for
 * callers and STANDARDS; the rhythm's QUICK pass uses the flat {@link QUICK_MIN}.
 * Pure and deterministic.
 */
export function fastPassMinutes(mcqCount: number, examPointCount = 0): number {
  return Math.round(
    10 + Math.min(15, Math.max(0, mcqCount)) + 0.5 * Math.max(0, examPointCount),
  );
}

/**
 * Drillable questions for a single subtopic today: the smaller of
 * {@link PER_TOPIC_DRILL_QUOTA} and the authored `mcqCount` (never negative).
 */
export function availableDrill(mcqCount: number): number {
  return Math.min(PER_TOPIC_DRILL_QUOTA, Math.max(0, mcqCount));
}

/** Full-length paper size — a mock day's drill target (see exam-pattern). */
const FULL_MOCK_QUESTIONS = 120;

/**
 * Build the day-by-day FIXED WEEKLY RHYTHM plan and its PRELIMS read-out.
 * Deterministic: identical inputs always yield an identical plan.
 *
 * Once the exam date has passed, the plan does not end — it returns a
 * post-prelims MAINS kick-start schedule instead (see {@link buildPostPrelims}).
 */
export function buildPlan(opts: BuildPlanOpts): Plan {
  const { progress, examDateISO, todayISO } = opts;
  const mainsQuestionIds = opts.mainsQuestionIds ?? [];
  const dailyBudgetMin = Math.max(1, Math.round(opts.dailyBudgetMin ?? DEFAULT_DAILY_BUDGET_MIN));
  const weekendBudgetMin = Math.max(1, Math.round(opts.weekendBudgetMin ?? dailyBudgetMin));
  const all = [...opts.subtopics];

  // The `mains` track is the parallel post-prelims track — kept out of scope.
  const trackOf = (s: PlanSubtopic): Track => s.track ?? 'paper1';
  const theoryAll = all.filter((s) => trackOf(s) === 'paper1');
  const aptitudeAll = all.filter((s) => trackOf(s) === 'paper2');
  const mainsSubjects = all.filter((s) => trackOf(s) === 'mains');
  const prelims = [...theoryAll, ...aptitudeAll];

  const theoryTotal = theoryAll.length;
  const aptitudeTotal = aptitudeAll.length;
  const prelimsTotal = prelims.length;

  // Per-subtopic study status derived from the summary progress map.
  const isStudied = (id: string): boolean => (progress[id]?.seen ?? 0) > 0;
  const masteryOf = (id: string): number => progress[id]?.masteryPct ?? 0;

  const theoryStudied = theoryAll.filter((s) => isStudied(s.id)).length;
  const aptitudeStudied = aptitudeAll.filter((s) => isStudied(s.id)).length;
  const prelimsStudied = theoryStudied + aptitudeStudied;
  const prelimsMastered = prelims.filter((s) => masteryOf(s.id) >= 80).length;
  const prelimsWithMaterial = prelims.filter((s) => s.hasMaterial === true).length;
  const masterySum = prelims.reduce((acc, s) => acc + masteryOf(s.id), 0);
  const prelimsMasteryPct = prelimsTotal > 0 ? Math.round(masterySum / prelimsTotal) : 0;
  const prelimsCoveragePct =
    prelimsTotal > 0 ? Math.round((prelimsStudied / prelimsTotal) * 100) : 0;
  const prelimsMaterialCoveragePct =
    prelimsTotal > 0 ? Math.round((prelimsWithMaterial / prelimsTotal) * 100) : 0;

  const daysTotal = inclusiveDaysISO(opts.startISO, examDateISO);
  const daysLeft = daysUntilExam(examDateISO, todayISO);

  // ---- Post-prelims daily MAINS quota (parallel track) --------------------
  const postMainsPerDay =
    mainsQuestionIds.length === 0 ? 0 : Math.min(mainsQuestionIds.length, MAINS_PER_DAY);
  const mainsSliceFor = (dayIndex: number, count: number): string[] => {
    if (count === 0 || mainsQuestionIds.length === 0) return [];
    const len = mainsQuestionIds.length;
    const out: string[] = [];
    for (let k = 0; k < count; k += 1) out.push(mainsQuestionIds[(dayIndex * MAINS_PER_DAY + k) % len]!);
    return out;
  };

  // ---- POST-PRELIMS: exam has passed → MAINS kick-start (never ends) ------
  if (daysTotal <= 0 || daysLeft <= 0) {
    return buildPostPrelims({
      todayISO,
      examDateISO,
      dailyBudgetMin,
      weekendBudgetMin,
      postMainsPerDay,
      mainsSliceFor,
      mainsPapers: opts.mainsPapers ?? [],
      theoryTotal,
      aptitudeTotal,
      theoryStudied,
      aptitudeStudied,
      prelimsTotal,
      prelimsStudied,
      prelimsMastered,
      prelimsWithMaterial,
      prelimsCoveragePct,
      prelimsMaterialCoveragePct,
      prelimsMasteryPct,
      mainsSubjectsTotal: mainsSubjects.length,
      mainsQuestionsTotal: mainsQuestionIds.length,
    });
  }

  // ---- PRE-PRELIMS: the fixed weekly rhythm -------------------------------
  // RE-AUDIT 2 — DAYS BEHIND: when the learner re-plans LATER than the plan start
  // and some first-pass topics are still unstudied, count how many elapsed plan
  // study-days' first-pass work is missing. The retro build (today = plan start)
  // is the on-time schedule; it recurses only one level (its today == start, so
  // the inner call computes daysBehind = 0 and does not recurse again).
  let daysBehind = 0;
  if (diffDaysISO(opts.startISO, todayISO) > 0) {
    const retro = buildPlan({ ...opts, todayISO: opts.startISO });
    const studiedSet = new Set(prelims.filter((s) => isStudied(s.id)).map((s) => s.id));
    const missed = new Set<string>();
    for (const d of retro.days) {
      if (d.dateISO < opts.startISO || d.dateISO >= todayISO) continue;
      const fp = [...d.theorySubtopicIds, ...d.aptitudeSubtopicIds];
      if (fp.length > 0 && fp.some((id) => !studiedSet.has(id))) missed.add(d.dateISO);
    }
    daysBehind = missed.size;
  }

  return buildRhythmPlan(opts, {
    dailyBudgetMin,
    weekendBudgetMin,
    theoryAll,
    aptitudeAll,
    prelims,
    theoryTotal,
    aptitudeTotal,
    prelimsTotal,
    theoryStudied,
    aptitudeStudied,
    prelimsStudied,
    prelimsMastered,
    prelimsWithMaterial,
    prelimsCoveragePct,
    prelimsMaterialCoveragePct,
    prelimsMasteryPct,
    masteryOf,
    daysTotal,
    daysLeft,
    mainsSubjectsTotal: mainsSubjects.length,
    mainsQuestionsTotal: mainsQuestionIds.length,
    postMainsPerDay,
    daysBehind,
  });
}

/** Shared prelims aggregates threaded into {@link buildRhythmPlan}. @internal */
interface RhythmContext {
  dailyBudgetMin: number;
  weekendBudgetMin: number;
  theoryAll: PlanSubtopic[];
  aptitudeAll: PlanSubtopic[];
  prelims: PlanSubtopic[];
  theoryTotal: number;
  aptitudeTotal: number;
  prelimsTotal: number;
  theoryStudied: number;
  aptitudeStudied: number;
  prelimsStudied: number;
  prelimsMastered: number;
  prelimsWithMaterial: number;
  prelimsCoveragePct: number;
  prelimsMaterialCoveragePct: number;
  prelimsMasteryPct: number;
  masteryOf: (id: string) => number;
  daysTotal: number;
  daysLeft: number;
  mainsSubjectsTotal: number;
  mainsQuestionsTotal: number;
  postMainsPerDay: number;
  /** RE-AUDIT 2 — elapsed plan study-days with unstudied first-pass work (0 on-time). */
  daysBehind: number;
}

/** The rhythm region a day falls in (coverage → revision → final → light → exam). */
export type DaySlotRegion = 'coverage' | 'revision' | 'final' | 'light' | 'exam';

/** A single day-slot in the rhythm window (before block materialisation). @internal */
interface DaySlot {
  dateISO: string;
  dayIndex: number;
  dow: number;
  region: DaySlotRegion;
  isMock: boolean;
  mockPaper: PaperId | null;
  mockNumber: number;
  budgetMin: number;
  /**
   * True for a day that falls BEFORE the learner's chosen plan START date (only
   * possible when the start date is in the future of `todayISO`). A pre-start
   * day carries NO blocks and is excluded from topic placement — "days before
   * the start date are free" — so nothing is scheduled or lost; the first
   * on/after-start day is the plan's real day 1.
   */
  preStart: boolean;
  /**
   * True for a learner DAY OFF (a date in `settings.daysOff`), excluding the
   * exam / light days. A day off carries only a ≤ 60-min light block and is
   * excluded from all topic / MENT / revision placement; mocks move off it.
   */
  dayOff: boolean;
  /**
   * True for one of the first {@link BEGINNER_RAMP_DAYS} coverage WEEKDAYS after
   * day 1 (long window only) — the beginner ramp runs these at
   * {@link BEGINNER_RAMP_BUDGET_MIN} with a shortened main block.
   */
  rampDay: boolean;
}

/**
 * A placed first-pass topic (its subject slot + chosen pass). @internal
 *
 * Sundays carry TWO study blocks (a Modern-History block and a Polity block)
 * that share the same `dateISO`; both simply push placements for that Sunday,
 * so the day materialises with topics from both subjects.
 */
interface Placement {
  dateISO: string;
  subjectCode: string;
  id: string;
  pass: PlanPass;
  /** Index into the ordered unit list (the WEEKLY SUBJECT UNIT this topic belongs to). */
  unitIndex?: number;
}

/**
 * Build the FIXED WEEKLY RHYTHM plan (pre-Prelims). Pure + deterministic.
 * @internal
 */
function buildRhythmPlan(opts: BuildPlanOpts, ctx: RhythmContext): Plan {
  const { todayISO, examDateISO } = opts;
  const { dailyBudgetMin, weekendBudgetMin } = ctx;
  const pyq = opts.pyqFrequency ?? {};

  const byId = new Map<string, PlanSubtopic>(ctx.prelims.map((s) => [s.id, s] as const));
  const nameById = (id: string): string => byId.get(id)?.name ?? id;

  // ---- Per-subject ordered topic lists (learning-sequence order) ----------
  const seqOrder = opts.sequence?.order ?? deriveSequenceOrder(ctx.prelims);
  const listFor = (code: string): PlanSubtopic[] => {
    const ids = seqOrder[code] ?? [];
    const out: PlanSubtopic[] = [];
    for (const id of ids) {
      const s = byId.get(id);
      if (s && (s.track ?? 'paper1') !== 'mains') out.push(s);
    }
    return out;
  };
  const subjectLists: Record<string, PlanSubtopic[]> = {};
  for (const code of SUBJECT_ORDER) subjectLists[code] = listFor(code);
  const mentList = listFor('MENT');
  const caList = listFor('CA');
  const seqIndex = new Map<string, number>();
  for (const code of Object.keys(seqOrder)) {
    (seqOrder[code] ?? []).forEach((id, i) => seqIndex.set(id, i));
  }

  // ---- Enumerate the day-slots todayISO → EXAM day -----------------------
  // Every phase anchor is DERIVED from the exam date + plan start (no hardcoded
  // calendar), so a future exam-date change just works.
  const anchors = computePlanAnchors(examDateISO, opts.startISO);
  const regionFor = (dateISO: string): DaySlotRegion => regionForISO(dateISO, anchors);
  const lastISO = examDateISO;
  const totalDays = inclusiveDaysISO(todayISO, lastISO);
  // The plan's REAL first day — the chosen start date when it is today or in the
  // future (otherwise the plan already began, so there is no first day to flag).
  // When that first day is a Saturday it would otherwise open with a full mock;
  // instead it becomes DAY-1 ORIENTATION (STANDARDS §8a), so it is dropped from
  // the mock schedule here.
  const planFirstISO = diffDaysISO(todayISO, opts.startISO) >= 0 ? opts.startISO : null;
  const orientationISO =
    planFirstISO !== null && dayOfWeekISO(planFirstISO) === 6 ? planFirstISO : undefined;

  // ---- DAYS OFF (festivals / holidays) ------------------------------------
  // Each day off is a LIGHT day (≤ 60 min, CA + flashcards): no mock, no new
  // topic, no week test. The set drives slot flagging below, is excluded from
  // every placement lane, and is passed to buildMockSchedule so tests move off.
  const daysOffSet = new Set<string>(opts.daysOff ?? []);

  // ---- BEGINNER RAMP dates ------------------------------------------------
  // The first BEGINNER_RAMP_DAYS WEEKDAYS strictly AFTER day 1 (the plan start),
  // long window only. These run at BEGINNER_RAMP_BUDGET_MIN with a shortened
  // main block; the displaced topics flow into the catch-up buffers.
  const rampDates = new Set<string>();
  if (!anchors.shortWindow) {
    let d = addDaysISO(opts.startISO, 1);
    let guard = 0;
    while (rampDates.size < BEGINNER_RAMP_DAYS && guard < 60 && d < examDateISO) {
      guard += 1;
      const dow = dayOfWeekISO(d);
      if (dow >= 1 && dow <= 5 && !daysOffSet.has(d)) rampDates.add(d);
      d = addDaysISO(d, 1);
    }
  }

  // The test schedule, derived from the plan start + anchors. The test schedule
  // is fully determined by the plan start + anchors (the two
  // dress rehearsals carry fixed papers), so this is already the real schedule;
  // slots use it to know WHICH Saturdays are test days. Days off move tests
  // forward. (It is recomputed below under the name `mockScheduleByDate`.)
  const mockScheduleProvisional = buildMockSchedule(opts.startISO, anchors, orientationISO, daysOffSet);

  const slots: DaySlot[] = [];
  for (let di = 0; di < totalDays; di += 1) {
    const dateISO = addDaysISO(todayISO, di);
    const dow = dayOfWeekISO(dateISO);
    const region = regionFor(dateISO);
    const mock = mockScheduleProvisional.get(dateISO);
    // A day BEFORE the chosen plan start is "free": no blocks, no placement.
    const preStart = diffDaysISO(opts.startISO, dateISO) < 0;
    // A DAY OFF (excluding the exam / light days) is a light day: no mock, no
    // placement. A test never lands on one (buildMockSchedule moved it off).
    const dayOff = !preStart && region !== 'exam' && region !== 'light' && daysOffSet.has(dateISO);
    const isMock = !preStart && !dayOff && region !== 'exam' && region !== 'light' && mock !== undefined;
    // Beginner ramp: a coverage weekday in the ramp window (never a day off).
    const rampDay = !preStart && !dayOff && region === 'coverage' && dow >= 1 && dow <= 5 && rampDates.has(dateISO);
    slots.push({
      dateISO,
      dayIndex: di,
      dow,
      region,
      isMock,
      mockPaper: isMock ? mock!.paper : null,
      mockNumber: isMock ? mock!.num : 0,
      // Only SUNDAY carries the (larger) Sunday budget; SATURDAY is a test day
      // and simply follows the daily budget. A ramp weekday is capped at the
      // reduced beginner budget.
      budgetMin:
        region === 'exam'
          ? 0
          : rampDay
            ? Math.min(BEGINNER_RAMP_BUDGET_MIN, dailyBudgetMin)
            : dow === 0
              ? weekendBudgetMin
              : dailyBudgetMin,
      preStart,
      dayOff,
      rampDay,
    });
  }

  // ---- Depth tiers: FULL / STANDARD / QUICK (base @240) --------------------
  // A topic's FULL cost is subtopicMinutes capped at FULL_CAP_MIN; STANDARD/QUICK
  // are the flat mid/light passes but never exceed a topic's own FULL cost (a
  // light band-D topic whose full pass is already below QUICK is simply FULL).
  const fullMin = (s: PlanSubtopic): number =>
    Math.min(FULL_CAP_MIN, subtopicMinutes(s.band, s.mcqCount, s.examPointCount ?? 0));
  const passMinutes = (s: PlanSubtopic, pass: PlanPass): number => {
    const f = fullMin(s);
    if (pass === 'full') return f;
    if (pass === 'standard') return Math.min(STANDARD_MIN, f);
    return Math.min(QUICK_MIN, f);
  };

  const subjectSlots = coverageSubjectSlots(slots);

  // ---- DEPTH FLOOR set (band A / AP-specific / top-30% PYQ) ----------------
  const allSubjectTopics: PlanSubtopic[] = SUBJECT_ORDER.flatMap((code) => subjectLists[code]!);
  const laneWeights = allSubjectTopics.map((s) => pyq[s.id] ?? 0).sort((a, b) => b - a);
  const pyqFloorThreshold =
    laneWeights.length > 0
      ? laneWeights[Math.min(Math.floor(laneWeights.length * 0.3), laneWeights.length - 1)]!
      : 0;
  const isAP = (s: PlanSubtopic): boolean => AP_RE.test(s.id);
  const isFloorTopic = (s: PlanSubtopic): boolean =>
    s.band === 'A' || isAP(s) || (pyq[s.id] ?? 0) >= pyqFloorThreshold;

  // ---- DEPTH FLOOR ('no weak areas', STANDARDS §8a) ------------------------
  // The MINIMUM pass every examinable topic must receive — nothing examinable
  // is left at QUICK depth if it can be avoided:
  //   • AP topics + every band-A topic  → FULL (in every subject)
  //   • every POL / ECON / GEO / SCI topic → ≥ STANDARD
  //   • History topics with any PYQ weight (> 0) → ≥ STANDARD
  //   • ONLY topics with PYQ weight 0 AND band C/D may stay QUICK
  // This is enforced as a HARD MINIMUM: the packer's downgrade/defer never takes
  // a topic below its floor, and the depth target SEEDS each topic at its floor.
  // `deepen` is a final-window TOP-UP, never a packing tier, so it never appears
  // in `passByTopic`; its rank is only here to keep the Record total over PlanPass.
  const PASS_RANK: Readonly<Record<PlanPass, number>> = { quick: 0, standard: 1, full: 2, deepen: 1 };
  const FLOOR_STANDARD_SUBJECTS = new Set(['POL', 'ECON', 'GEO', 'SCI']);
  const floorTier = (s: PlanSubtopic): PlanPass => {
    if (isAP(s) || s.band === 'A') return 'full';
    if (FLOOR_STANDARD_SUBJECTS.has(s.subjectCode)) return 'standard';
    if ((pyq[s.id] ?? 0) > 0) return 'standard'; // History with PYQ weight
    if (s.band === 'C' || s.band === 'D') return 'quick';
    return 'standard'; // History band-B, PYQ 0 → still ≥ STANDARD
  };
  const atOrAboveFloor = (s: PlanSubtopic, p: PlanPass): boolean =>
    PASS_RANK[p] >= PASS_RANK[floorTier(s)];

  // Paper-I lanes carry the marks-balance; Science & Tech is Paper-II (its own lane).
  const subjectIsP1: Record<string, boolean> = {};
  for (const code of SUBJECT_ORDER) {
    subjectIsP1[code] = (subjectLists[code]![0]?.track ?? 'paper1') !== 'paper2';
  }

  // ---- WEEKLY SUBJECT UNITS (STANDARDS §8a) -------------------------------
  // The first pass teaches ONE unit at a time in the MAIN study block, across
  // however many days the unit takes, instead of rotating a different subject
  // each weekday. `units` is the ordered teaching list; each unit's topics are a
  // contiguous run of its subject's sequence (already in-scope). When the caller
  // supplies no units (older fixtures) we derive ONE unit per subject so the
  // unit-stream rhythm always has something to teach.
  interface BuiltUnit {
    id: string;
    title: string;
    subjectCode: string;
    topics: PlanSubtopic[];
  }
  const unitSpecs = opts.sequence?.units;
  let units: BuiltUnit[];
  if (unitSpecs && unitSpecs.length > 0) {
    units = [];
    for (const u of unitSpecs) {
      const topics: PlanSubtopic[] = [];
      for (const id of u.topicIds) {
        const s = byId.get(id);
        if (s && (s.track ?? 'paper1') !== 'mains') topics.push(s);
      }
      if (topics.length > 0) units.push({ id: u.id, title: u.title, subjectCode: u.subjectCode, topics });
    }
  } else {
    units = SUBJECT_ORDER.map((code) => ({
      id: `unit-${code.toLowerCase()}`,
      title: SUBJECT_LABEL[code] ?? code,
      subjectCode: code,
      topics: subjectLists[code]!,
    })).filter((u) => u.topics.length > 0);
  }
  const unitIndexById = new Map<string, number>();
  units.forEach((u, ui) => u.topics.forEach((s) => unitIndexById.set(s.id, ui)));
  // Every topic that belongs to a unit, in UNIT (teaching) order.
  const allUnitTopics: PlanSubtopic[] = units.flatMap((u) => u.topics);

  // Lexicographic compare of priority keys (for downgrade/defer victim picks).
  const cmpKey = (a: number[], b: number[]): number => {
    for (let i = 0; i < a.length; i += 1) {
      if (a[i]! < b[i]!) return -1;
      if (a[i]! > b[i]!) return 1;
    }
    return 0;
  };
  // AP + band-A topics are PROTECTED: always FULL, always placed in-window.
  const isProtected = (s: PlanSubtopic): boolean => isAP(s) || s.band === 'A';
  // A topic may be downgraded to fit only while it stays AT OR ABOVE its floor.
  const canDowngrade = (s: PlanSubtopic, pass: ReadonlyMap<string, PlanPass>): boolean =>
    PASS_RANK[pass.get(s.id)!] > PASS_RANK[floorTier(s)];
  // Lowest-priority-first ordering for a downgrade/defer victim: lowest PYQ, then
  // fewest exam points, then latest in the learning sequence.
  const downgradeRank = (s: PlanSubtopic): number[] => [
    pyq[s.id] ?? 0,
    s.examPointCount ?? 0,
    -(seqIndex.get(s.id) ?? 0),
  ];

  // ---- Main-block capacity (budget-scaled) --------------------------------
  // A weekday MAIN BLOCK is 135 min (Tue/Thu 120, 15 given to Telugu); the
  // Sunday MAIN BLOCK is the Sunday budget minus the fixed 120. The fixed total
  // is unchanged by the Sunday Mental Ability block (STANDARDS §8a item 2): the
  // 30-min MENT practice is carved from the Sunday weekly-revision time (now 30),
  // NOT from the teaching main block, so first-pass coverage capacity (and its
  // learning-sequence order) is unaffected. Weekday caps scale with the DAILY
  // budget, the Sunday cap with the SUNDAY budget (probeable for options).
  const SUNDAY_FIXED_MIN = 120; // MENT 30 + weekly revision 30 + CA round-up 45 + Telugu 15
  const mainCapFor = (dow: number, sundayBudget: number, dateISO?: string): number => {
    if (dow === 0) return Math.max(1, Math.round(sundayBudget) - SUNDAY_FIXED_MIN);
    // BEGINNER RAMP weekday: the day is capped at BEGINNER_RAMP_BUDGET_MIN, the
    // fixed Mental Ability (60) / Revise (20) / Current Affairs (25) / Telugu
    // (15 Tue/Thu) blocks keep their full minutes, and only the MAIN block is
    // shortened to what is left. Fewer topics pack here; the rest flow to the
    // catch-up buffers. (The day loop keeps the fixed blocks un-scaled on ramp
    // days so this arithmetic holds.)
    if (dateISO !== undefined && rampDates.has(dateISO)) {
      const teluguMin = dow === 2 || dow === 4 ? 15 : 0;
      const rampFixed = 60 + 20 + 25 + teluguMin;
      return Math.max(1, BEGINNER_RAMP_BUDGET_MIN - rampFixed);
    }
    const scale = dailyBudgetMin / 240;
    const base = dow === 2 || dow === 4 ? 120 : 135;
    return Math.max(1, Math.round(base * scale));
  };

  // ---- Unit-stream packer -------------------------------------------------
  // Pack units into the coverage MAIN slots IN ORDER. One unit per block
  // (CLEAN BREAKS): a block teaches only the current unit, continuing day after
  // day, so a beginner studies each chapter in a sustained run. ≤ 3 new topics
  // per block (4 only if all QUICK); topics run in order and never span days.
  // UNIT WRAP-UP (STANDARDS §8a): when a unit FINISHES in a block with ≥ 30 min
  // of the main block still free, those minutes become a consolidation wrap-up
  // (glance + a scoped unit test + review) instead of idle time; and only if the
  // NEXT unit's first topic still fits the minutes left after the wrap-up does
  // that unit begin in the SAME block (so Sunday time is not wasted) — otherwise
  // it starts on a fresh day. Pure in `pass` + `sundayBudget` + `excluded`
  // (re-runnable for the fit probes). @internal
  interface WrapUp {
    dateISO: string;
    unitIndex: number;
    size: number;
  }
  interface PackResult {
    placements: Placement[];
    reallocations: Array<{ dateISO: string; fromSubject: string; toSubject: string }>;
    reallocatedInto: Record<string, string[]>;
    slotSubject: Map<string, string>;
    leftoverIds: string[];
    /** One UNIT WRAP-UP per unit that finished a block with ≥ 30 min to spare. */
    wrapups: WrapUp[];
  }
  const packUnits = (
    pass: ReadonlyMap<string, PlanPass>,
    sundayBudget: number,
    excluded: ReadonlySet<string> = new Set<string>(),
  ): PackResult => {
    const queues = units.map((u) => u.topics.filter((s) => !excluded.has(s.id)));
    let cursor = 0;
    const advance = (): void => {
      while (cursor < units.length && queues[cursor]!.length === 0) cursor += 1;
    };
    const placements: Placement[] = [];
    const slotSubject = new Map<string, string>();
    const wrapups: WrapUp[] = [];
    for (const slot of subjectSlots) {
      advance();
      if (cursor >= units.length) break; // every unit taught
      const cap = mainCapFor(slot.dow, sundayBudget, slot.dateISO);
      let used = 0;
      let placedAnyUnit = false;
      // Fill the main block: the current unit's next topics, then a wrap-up when
      // it finishes with room, then (only if it fits) the next unit.
      for (;;) {
        advance();
        if (cursor >= units.length) break;
        const ui = cursor;
        const q = queues[ui]!;
        const firstUnitInSlot = !placedAnyUnit;
        // A NEW unit may only START mid-block when its first topic fits the
        // minutes still free (the clean-break rule defers it to a fresh day
        // otherwise). The first unit of the block is never gated this way.
        if (!firstUnitInSlot) {
          const s0 = q[0]!;
          if (used + passMinutes(s0, pass.get(s0.id)!) > cap) break;
        }
        let count = 0;
        let allQuickSoFar = true;
        while (q.length > 0) {
          const s = q[0]!;
          const p = pass.get(s.id)!;
          const isQuick = p === 'quick' || passMinutes(s, p) <= QUICK_MIN;
          const maxTopics = allQuickSoFar && isQuick ? 4 : 3; // ≤3 new topics (4 if all QUICK)
          if (count >= maxTopics) break;
          const m = passMinutes(s, p);
          // The very first topic of the FIRST unit in a block is always placed
          // (never stranded or split); every later topic must fit the cap.
          if ((count > 0 || !firstUnitInSlot) && used + m > cap) break;
          // RESERVE WRAP-UP ROOM: if this is the unit's FINAL topic and placing
          // it here would leave < WRAPUP_MIN_IDLE_MIN free, defer it to the next
          // block so the unit ENDS with room to consolidate (every unit gets a
          // wrap-up). The block's first topic always progresses; a lone final
          // topic (≤ FULL_CAP_MIN) always leaves ample room on a fresh block.
          if (q.length === 1 && count > 0 && used + m > cap - WRAPUP_MIN_IDLE_MIN) break;
          q.shift();
          used += m;
          count += 1;
          allQuickSoFar = allQuickSoFar && isQuick;
          placements.push({ dateISO: slot.dateISO, subjectCode: units[ui]!.subjectCode, id: s.id, pass: p, unitIndex: ui });
        }
        if (count === 0) break; // nothing more fits in this block
        slotSubject.set(slot.dateISO, units[ui]!.subjectCode);
        placedAnyUnit = true;
        if (q.length > 0) break; // unit not finished → it continues next day
        // Unit finished cleanly in this block. Advance past it and, when ≥ 30
        // min remain, reserve a UNIT WRAP-UP (bounded at WRAPUP_MAX_MIN). The
        // loop then tries the next unit, which only starts if its first topic
        // fits the minutes still free (checked at the top of the next pass).
        cursor += 1;
        const leftover = cap - used;
        if (leftover >= WRAPUP_MIN_IDLE_MIN) {
          const size = Math.min(leftover, WRAPUP_MAX_MIN);
          used += size;
          wrapups.push({ dateISO: slot.dateISO, unitIndex: ui, size });
        } else {
          break; // too little left to consolidate → next unit starts a fresh day
        }
      }
    }
    const reallocatedInto: Record<string, string[]> = {};
    for (const code of SUBJECT_ORDER) reallocatedInto[code] = [];
    const leftoverIds = queues.flatMap((q) => q.map((s) => s.id));
    return { placements, reallocations: [], reallocatedInto, slotSubject, leftoverIds, wrapups };
  };

  // ---- FIT: target FULL for everything, then downgrade / defer to fit -----
  // The real scenario (long window, 240 weekday + 360 Sunday) seats EVERY topic
  // at FULL in its unit's run. A tighter budget or short window can leave a tail
  // of main-block slots short: shed the lowest-priority non-protected topic one
  // tier at a time (never below its depth floor), then DEFER the lowest-priority
  // non-protected QUICK topic into the post-coverage spill buffer (AP / band-A
  // are always placed in-window). The final-window DEEPEN passes later lift any
  // below-floor tail to its floor. Pure in `scale` (= sundayBudget / 240), so
  // the option probe can re-fit at a higher Sunday budget. Deterministic.
  const buildDepthTarget = (): Map<string, PlanPass> => {
    const pass = new Map<string, PlanPass>();
    for (const s of allUnitTopics) pass.set(s.id, 'full'); // target FULL for all
    return pass;
  };
  const computeFit = (
    scale: number,
  ): { pass: Map<string, PlanPass>; res: PackResult; deferred: Set<string> } => {
    const sundayBudget = Math.round(scale * 240);
    const pass = buildDepthTarget();
    let res = packUnits(pass, sundayBudget);
    let guard = 0;
    while (res.leftoverIds.length > 0 && guard < 8000) {
      guard += 1;
      let victim: PlanSubtopic | null = null;
      let victimKey: number[] | null = null;
      for (const s of allUnitTopics) {
        if (!canDowngrade(s, pass)) continue;
        const key = downgradeRank(s);
        if (victimKey === null || cmpKey(key, victimKey) < 0) {
          victimKey = key;
          victim = s;
        }
      }
      if (!victim) break; // everything is at its floor — defer next
      pass.set(victim.id, pass.get(victim.id) === 'full' ? 'standard' : 'quick');
      res = packUnits(pass, sundayBudget);
    }
    const deferred = new Set<string>();
    if (anchors.shortWindow) {
      // SHORT window (genuinely infeasible — e.g. 47 days for History's 47
      // topics): protect AP / band-A by DEFERRING the lowest-priority
      // non-protected topics into the QUICK spill buffer so the protected topics
      // stay in-window. This pulls scattered low-priority topics out of the
      // middle of the sequence (a documented short-window compromise: its tests
      // assert band-A never spills, and the real-content short-window order test
      // only requires per-stream History order), acceptable because the
      // compressed window cannot teach the whole sequence in order anyway.
      while (res.leftoverIds.length > 0 && guard < 16000) {
        guard += 1;
        let victim: PlanSubtopic | null = null;
        let victimKey: number[] | null = null;
        for (const s of allUnitTopics) {
          if (isProtected(s) || deferred.has(s.id)) continue; // AP / band A never deferred
          const key = downgradeRank(s);
          if (victimKey === null || cmpKey(key, victimKey) < 0) {
            victimKey = key;
            victim = s;
          }
        }
        if (!victim) break; // only protected topics remain unplaced → genuine shortfall
        pass.set(victim.id, 'quick'); // buffer tier is always QUICK
        deferred.add(victim.id);
        res = packUnits(pass, sundayBudget, deferred);
      }
    }
    // LONG window (N1 fix): NO priority-defer. The downgrade loop above already
    // reduced tiers (by priority) to their floor; whatever the packer still
    // cannot seat in-window is its natural per-unit SUFFIX (`res.leftoverIds`) at
    // its PLANNED tier. The caller RECOVERS that tail into free coverage slots IN
    // learning-sequence order — SHIFTING the remaining first passes forward (next
    // unit starts later; catch-up buffers absorb) rather than pulling scattered
    // low-priority topics out of the middle and re-teaching them late (which
    // reordered History). `deferred` stays empty so no topic is forced below its
    // floor, keeping the long window feasible.
    return { pass, res, deferred };
  };

  const { pass: passByTopic, res: fitResult, deferred: deferredIds } = computeFit(weekendBudgetMin / 240);

  // ---- DAY-1 ORIENTATION first pass (STANDARDS §8a) -----------------------
  // When the plan's first day is a Saturday it opens with ORIENTATION whose
  // Mental Ability + History STUDY blocks ARE the first pass of those topics —
  // not a duplicate preview. The History block teaches the FIRST unit's opening
  // topics that fit the 120-min orientation block (Stone Age, then IVC); they
  // are REMOVED from the packer so the unit CONTINUES from the next topic on the
  // following main-block days — a beginner never studies a topic twice.
  const orientationMentId = orientationISO !== undefined ? mentList[0]?.id : undefined;
  const orientationHistIds: string[] = [];
  if (orientationISO !== undefined && units.length > 0) {
    let used = 0;
    let count = 0;
    let allQuick = true;
    for (const s of units[0]!.topics) {
      if (deferredIds.has(s.id)) continue; // never pull a buffer-spill topic forward
      const p = passByTopic.get(s.id) ?? 'quick';
      const m = passMinutes(s, p);
      const isQuick = p === 'quick' || m <= QUICK_MIN;
      const maxTopics = allQuick && isQuick ? 4 : 3; // ≤ 3 new topics (4 if all QUICK)
      if (count >= maxTopics) break;
      if (count > 0 && used + m > 120) break; // 120-min orientation History block
      used += m;
      count += 1;
      allQuick = allQuick && isQuick;
      orientationHistIds.push(s.id);
    }
  }
  const orientationExcluded = new Set<string>(orientationHistIds);

  // Re-pack with the orientation topics removed so the unit continues from the
  // NEXT topic on the first main-block day. With no orientation this reproduces
  // the fit result exactly (packUnits is pure), so non-orientation plans match.
  const result =
    orientationExcluded.size > 0
      ? packUnits(passByTopic, weekendBudgetMin, new Set([...deferredIds, ...orientationExcluded]))
      : fitResult;

  // Explicit placements for the orientation History first pass (unit 0).
  const orientationPlacements: Placement[] = orientationHistIds.map((id) => ({
    dateISO: orientationISO!,
    subjectCode: units[0]!.subjectCode,
    id,
    pass: passByTopic.get(id) ?? 'quick',
    unitIndex: 0,
  }));


  // The reported SPILL = intentionally DEFERRED low-priority QUICK topics PLUS
  // any topic the packer still could not place (a genuine shortfall — protected).
  const spillIdSet = [...deferredIds, ...result.leftoverIds];

  // ---- RECOVER spill into FREE coverage slots (STANDARDS §8a) -------------
  // The beginner ramp + days off shorten a few coverage days, which can leave a
  // short tail of lowest-priority topics unseated by the packer even though a
  // later coverage subject-slot is still FREE (e.g. the final consolidation
  // Sunday). Teach that tail on those free slots so the FIRST PASS still finishes
  // within the coverage window (every topic once, by the coverage-end date)
  // rather than spilling into the post-coverage buffer. Deterministic: free slots
  // ascend by date, the tail is taken in learning-sequence order, and each block
  // keeps ≤ 3 topics of a unit and fits the slot's main cap. Only a genuinely
  // over-full window leaves a remainder for the buffer.
  if (spillIdSet.length > 0) {
    const freeSlots = subjectSlots
      .filter((s) => !result.slotSubject.has(s.dateISO) && s.dateISO <= anchors.coverageEndISO)
      .sort((a, b) => a.dateISO.localeCompare(b.dateISO));
    const queue = [...spillIdSet].sort((a, b) => (seqIndex.get(a) ?? 0) - (seqIndex.get(b) ?? 0));
    const recovered = new Set<string>();
    for (const slot of freeSlots) {
      if (queue.length === 0) break;
      const cap = mainCapFor(slot.dow, weekendBudgetMin, slot.dateISO);
      let used = 0;
      const perUnit = new Map<number, number>();
      for (let i = 0; i < queue.length && used < cap; ) {
        const id = queue[i]!;
        const s = byId.get(id);
        const ui = unitIndexById.get(id);
        if (s === undefined || ui === undefined) {
          i += 1;
          continue;
        }
        const p = passByTopic.get(id) ?? 'quick';
        const m = passMinutes(s, p);
        const already = perUnit.get(ui) ?? 0;
        // Block legality: ≤ 3 topics of a unit per block, and (after the first)
        // never overflow the slot's main cap.
        if (already >= 3 || (used > 0 && used + m > cap)) {
          i += 1;
          continue;
        }
        result.placements.push({ dateISO: slot.dateISO, subjectCode: s.subjectCode, id, pass: p, unitIndex: ui });
        result.slotSubject.set(slot.dateISO, s.subjectCode);
        used += m;
        perUnit.set(ui, already + 1);
        recovered.add(id);
        queue.splice(i, 1);
      }
    }
    for (let i = spillIdSet.length - 1; i >= 0; i -= 1) {
      if (recovered.has(spillIdSet[i]!)) spillIdSet.splice(i, 1);
    }
    // Recovered topics are now placed in-window → drop them from the packer's
    // leftover so the feasibility / floor check counts them as placed (N1/N2).
    result.leftoverIds = result.leftoverIds.filter((id) => !recovered.has(id));
  }

  // ---- COVERAGE-CLOSE repair (N2): close the first pass by the coverage end --
  // The free-slot recovery above seats most of the shifted tail, but a protected
  // (AP / band-A) final topic — which can never be deferred — can still be left
  // over when the last coverage day is full of a UNIT WRAP-UP, pushing its first
  // pass into the post-coverage buffer (after the coverage-end date). Rather than
  // spill a Prelims topic past coverage end, RECLAIM wrap-up minutes on a coverage
  // day that already teaches that topic's unit (the task's "allow the last unit's
  // wrap-up to shrink"): shrink the day's largest wrap-up by the topic's minutes
  // and seat the topic there, in sequence (it is the unit's own tail, taught on
  // the day the unit is taught, so no first pass moves out of order). Pure in
  // `result`; the day loop then materialises the (slightly larger) subject block
  // and (slightly smaller) wrap-up with the day's planned minutes unchanged.
  //
  // Long window only: the short window is genuinely infeasible and intentionally
  // spills its lowest-priority tail into the post-coverage buffer (its tests
  // assert that), so the repair never runs there.
  if (spillIdSet.length > 0 && !anchors.shortWindow) {
    // Latest coverage date (≤ coverage end) on which each unit is taught.
    const unitLastDate = new Map<number, string>();
    for (const p of result.placements) {
      if (p.unitIndex === undefined || p.dateISO > anchors.coverageEndISO) continue;
      const prev = unitLastDate.get(p.unitIndex);
      if (prev === undefined || p.dateISO > prev) unitLastDate.set(p.unitIndex, p.dateISO);
    }
    // How many of a unit's topics already sit on a given date (the ≤3/unit rule).
    const unitTopicsOnDate = (ui: number, dateISO: string): number =>
      result.placements.filter((p) => p.unitIndex === ui && p.dateISO === dateISO).length;
    const WRAPUP_FLOOR_MIN = WRAPUP_GLANCE_MIN + WRAPUP_REVIEW_MIN; // keep a meaningful wrap-up
    const closeQueue = [...spillIdSet].sort((a, b) => (seqIndex.get(a) ?? 0) - (seqIndex.get(b) ?? 0));
    const closed = new Set<string>();
    for (const id of closeQueue) {
      const s = byId.get(id);
      const ui = unitIndexById.get(id);
      if (s === undefined || ui === undefined) continue;
      const dateISO = unitLastDate.get(ui);
      if (dateISO === undefined) continue; // unit not taught in-window → leave to spill buffer
      if (unitTopicsOnDate(ui, dateISO) >= 3) continue; // keep the ≤3-new-topics-per-unit rule
      const need = passMinutes(s, passByTopic.get(id) ?? 'quick');
      // Reclaim from the day's LARGEST wrap-up (down to a meaningful floor).
      const wraps = result.wrapups.filter((w) => w.dateISO === dateISO && w.size > WRAPUP_FLOOR_MIN);
      let reclaimable = 0;
      for (const w of wraps) reclaimable += w.size - WRAPUP_FLOOR_MIN;
      if (reclaimable < need) continue; // not enough slack on this day → leave to spill buffer
      let remaining = need;
      wraps.sort((a, b) => b.size - a.size);
      for (const w of wraps) {
        if (remaining <= 0) break;
        const take = Math.min(remaining, w.size - WRAPUP_FLOOR_MIN);
        w.size -= take;
        remaining -= take;
      }
      result.placements.push({ dateISO, subjectCode: s.subjectCode, id, pass: passByTopic.get(id) ?? 'quick', unitIndex: ui });
      result.slotSubject.set(dateISO, s.subjectCode);
      closed.add(id);
    }
    for (let i = spillIdSet.length - 1; i >= 0; i -= 1) {
      if (closed.has(spillIdSet[i]!)) spillIdSet.splice(i, 1);
    }
    result.leftoverIds = result.leftoverIds.filter((id) => !closed.has(id));
  }

  // ---- RECOVERY MODE (RE-AUDIT 2) ----------------------------------------
  // The free-slot recovery + coverage-close above close an ON-TIME plan inside
  // the coverage window. But a PROGRESS-AWARE / TIGHT re-plan — the learner falls
  // behind (today later than the plan start, first passes unstudied) or runs a
  // low Sunday budget — can still leave a tail the coverage window cannot hold;
  // it would spill PAST the coverage-end date and read as infeasible with topics
  // first-passed after coverage end. Instead of spilling, RECOVER that tail
  // IN-WINDOW (STANDARDS §8a):
  //   (1) teach the unfinished first passes, in LEARNING-SEQUENCE order, on the
  //       REVISION CYCLE'S FIRST WEEK (≤ 7 days) — shifting the effective coverage
  //       end up to 7 days later, SHORTENING the revision cycle, NEVER the final
  //       window; then
  //   (2) only if 7 days still cannot hold it, DOWNGRADE the lowest-priority
  //       non-AP / non-band-A topics FULL→STANDARD→QUICK (protected topics keep
  //       FULL) until it fits.
  // Deterministic. Long window only (the short-window fallback intentionally
  // spills its lowest-priority tail into the 2-day post-coverage buffer, which
  // its tests assert). The recovered topics are first-passed on revision-region
  // days (taught by `spillBlocksFor`), the reported coverage end shifts to the
  // last recovered date, and the plan stays FEASIBLE.
  let recoveryActive = false;
  let recoveryLastDateISO = '';
  const recoveredPlacements: Placement[] = [];
  const recoveryChanges: string[] = [];
  if (spillIdSet.length > 0 && !anchors.shortWindow && anchors.revisionStartISO !== null) {
    const revisionStudySlots = slots
      .filter(
        (s) =>
          s.region === 'revision' &&
          !s.isMock &&
          !s.preStart &&
          !s.dayOff &&
          (s.dow === 0 || (s.dow >= 1 && s.dow <= 5)),
      )
      .sort((a, b) => a.dateISO.localeCompare(b.dateISO));
    // PRIMARY recovery window = the revision cycle's FIRST WEEK (≤ 7 days). An
    // overflow set (the rest of the revision region) is a LAST RESORT used only
    // when an extreme budget cannot fit the tail in 7 days, so the first passes
    // stay in sequence order (never the final window).
    const primarySlots = revisionStudySlots.filter(
      (s) => diffDaysISO(anchors.revisionStartISO!, s.dateISO) <= 6,
    );
    const queue = [...spillIdSet].sort((a, b) => (seqIndex.get(a) ?? 0) - (seqIndex.get(b) ?? 0));
    const recovered = new Set<string>();
    const usedByDate = new Map<string, number>();
    const perUnitByDate = new Map<string, Map<number, number>>();
    const downgradedToQuick = new Set<string>();
    // The latest date a subject's recovered topic sits on — a later-sequence
    // topic of the same subject must never land BEFORE it (keeps the per-subject
    // first-pass dates non-decreasing in sequence order, N1).
    const lastDateBySubject = new Map<string, string>();
    // Seat the sequence-ordered tail across the recovery slots, ≤ 3 topics of a
    // unit per block, never past a slot's main cap. Topics are placed STRICTLY in
    // learning-sequence order per subject: each lands on the earliest recovery
    // slot on/after its subject's last placed date; if a topic cannot be placed,
    // its whole subject is BLOCKED for the rest of the pass so no later topic
    // jumps ahead of it. `allowQuickDowngrade` is the step-(2) fallback: a
    // non-protected topic that will not fit at its planned tier is relaxed to
    // QUICK (protected AP/band-A keep FULL) and retried.
    const seat = (allowQuickDowngrade: boolean, recoverySlots: readonly DaySlot[]): void => {
      const blocked = new Set<string>();
      for (let qi = 0; qi < queue.length; ) {
        const id = queue[qi]!;
        const s = byId.get(id);
        const ui = unitIndexById.get(id);
        if (s === undefined || ui === undefined) { qi += 1; continue; }
        if (blocked.has(s.subjectCode)) { qi += 1; continue; }
        const minDate = lastDateBySubject.get(s.subjectCode) ?? '';
        let placedThis = false;
        for (const slot of recoverySlots) {
          if (slot.dateISO < minDate) continue;
          const cap = mainCapFor(slot.dow, weekendBudgetMin, slot.dateISO);
          const used = usedByDate.get(slot.dateISO) ?? 0;
          const perUnit = perUnitByDate.get(slot.dateISO) ?? new Map<number, number>();
          if ((perUnit.get(ui) ?? 0) >= 3) continue; // ≤ 3 topics of a unit per block
          let pass = passByTopic.get(id) ?? 'quick';
          let m = passMinutes(s, pass);
          if (used > 0 && used + m > cap) {
            if (allowQuickDowngrade && !isProtected(s) && pass !== 'quick') {
              pass = 'quick';
              m = passMinutes(s, pass);
              if (used + m > cap) continue;
            } else {
              continue;
            }
          }
          if (allowQuickDowngrade && pass === 'quick' && (passByTopic.get(id) ?? 'quick') !== 'quick') {
            downgradedToQuick.add(id);
          }
          recoveredPlacements.push({ dateISO: slot.dateISO, subjectCode: s.subjectCode, id, pass, unitIndex: ui });
          usedByDate.set(slot.dateISO, used + m);
          perUnit.set(ui, (perUnit.get(ui) ?? 0) + 1);
          perUnitByDate.set(slot.dateISO, perUnit);
          recovered.add(id);
          lastDateBySubject.set(s.subjectCode, slot.dateISO);
          placedThis = true;
          break;
        }
        if (placedThis) {
          queue.splice(qi, 1);
        } else {
          blocked.add(s.subjectCode); // keep later same-subject topics behind this one
          qi += 1;
        }
      }
    };
    seat(false, primarySlots);
    if (queue.length > 0) seat(true, primarySlots); // step (2): downgrade non-protected to QUICK
    // LAST RESORT (extreme budget only): overflow into the rest of the revision
    // region so the tail still finishes in sequence order before the final window.
    if (queue.length > 0) seat(true, revisionStudySlots);
    // Reflect any step-(2) downgrade in the depth map so the floor / feasibility
    // read-out is honest.
    for (const id of downgradedToQuick) passByTopic.set(id, 'quick');
    if (recovered.size > 0) {
      recoveryActive = true;
      for (const p of recoveredPlacements) if (p.dateISO > recoveryLastDateISO) recoveryLastDateISO = p.dateISO;
      for (let i = spillIdSet.length - 1; i >= 0; i -= 1) if (recovered.has(spillIdSet[i]!)) spillIdSet.splice(i, 1);
      result.leftoverIds = result.leftoverIds.filter((id) => !recovered.has(id));
      const shiftDays = Math.max(0, diffDaysISO(anchors.coverageEndISO, recoveryLastDateISO));
      recoveryChanges.push(
        `moved ${recovered.size} ${recovered.size === 1 ? 'topic' : 'topics'} into the revision cycle\u2019s first week`,
      );
      if (shiftDays > 0) {
        recoveryChanges.push(`the revision cycle is ${shiftDays} ${shiftDays === 1 ? 'day' : 'days'} shorter`);
      }
      if (downgradedToQuick.size > 0) {
        recoveryChanges.push(
          `${downgradedToQuick.size} lower-priority ${downgradedToQuick.size === 1 ? 'topic is' : 'topics are'} a quicker pass`,
        );
      }
    }
  }
  // The reported coverage end shifts forward to the last recovered first-pass day
  // (never earlier than the derived coverage end), and `spillBlocksFor` teaches
  // first passes up to that day. The final window is untouched.
  const effectiveCoverageEndISO =
    recoveryActive && recoveryLastDateISO > anchors.coverageEndISO
      ? recoveryLastDateISO
      : anchors.coverageEndISO;
  const spillTeachUntilISO =
    recoveryActive && recoveryLastDateISO > anchors.spillDates[1]
      ? recoveryLastDateISO
      : anchors.spillDates[1];

  // The DEPTH FLOOR is MET when every topic whose floor is above QUICK is both
  // placed (not left in the buffer) AND sits at or above its floor tier. A
  // QUICK-only tail of PYQ-0 band-C/D topics into the Thu 5 / Fri 6 buffer is
  // acceptable by design. @internal
  const floorShortfallOf = (
    r: PackResult,
    pass: ReadonlyMap<string, PlanPass>,
    deferred: ReadonlySet<string> = new Set<string>(),
  ): string[] =>
    allSubjectTopics
      .filter(
        (s) =>
          floorTier(s) !== 'quick' &&
          (r.leftoverIds.includes(s.id) ||
            deferred.has(s.id) ||
            !atOrAboveFloor(s, pass.get(s.id) ?? 'quick')),
      )
      .map((s) => s.id);
  const floorMet = (
    r: PackResult,
    pass: ReadonlyMap<string, PlanPass>,
    deferred: ReadonlySet<string> = new Set<string>(),
  ): boolean => floorShortfallOf(r, pass, deferred).length === 0;

  // Feasibility OPTIONS: suggest ONLY what actually changes the result. Search
  // the Sunday budget 360 → 600 in 30-min steps (never below the current Sunday
  // budget), re-fit at each, and report the MINIMUM extra Sunday time that MEETS
  // the depth floor; else fall back to moving the exam date (defect 3). Reported
  // as "Add N h on Sundays" (whole-hour steps) or the nearest 30-min step.
  // Feasibility OPTIONS + the reported floor shortfall are computed AFTER the
  // day list is built, because the final-window DEEPEN passes (STANDARDS §8a)
  // lift below-floor topics to their floor and so change what is still short.
  // Here we only capture the PRE-DEEPEN shortfall (the deepen CANDIDATES).
  const infeasibleFloorIds = floorShortfallOf(result, passByTopic, deferredIds);

  const minutesFor = (s: PlanSubtopic): number => passMinutes(s, passByTopic.get(s.id)!);
  const subjectMinutes = (code: string): number =>
    subjectLists[code]!.reduce((a, s) => a + minutesFor(s), 0);

  const { placements, reallocations, reallocatedInto } = result;

  // ---- Spill: any topic still unplaced by coverage-end → Thu 5 / Fri 6 Nov -
  // ---- Spill: any topic still unplaced by coverage-end → Thu 5 / Fri 6 Nov -
  // Fixing the small subjects' depth (no donating while below FULL) means the
  // History-heavy Paper-I tail can no longer be absorbed by donated slots, so a
  // genuine tail spills into the Thu 5 – Fri 6 Nov window. It is placed there as
  // ≤3-new-topic subject blocks (multiple blocks per day when needed) and fully
  // REPORTED; the plan is flagged not-feasible with the shortfall + options.
  const spills: Array<{ subject: string; topicIds: string[]; lastDateISO: string }> = [];
  const genuineSpillPlacements: Placement[] = [];
  const spillDates = [...anchors.spillDates]; // first two post-coverage days ONLY
  const leftoverBySubject = new Map<string, string[]>();
  for (const id of spillIdSet) {
    const code = byId.get(id)?.subjectCode ?? '';
    const arr = leftoverBySubject.get(code) ?? [];
    arr.push(id);
    leftoverBySubject.set(code, arr);
  }
  // Teach each subject's deferred buffer topics in learning-sequence order.
  for (const arr of leftoverBySubject.values()) {
    arr.sort((a, b) => (seqIndex.get(a) ?? 0) - (seqIndex.get(b) ?? 0));
  }
  [...leftoverBySubject.entries()].forEach(([code, ids], subjIdx) => {
    const dateISO = spillDates[Math.min(subjIdx, spillDates.length - 1)]!;
    const topicIds: string[] = [];
    for (const id of ids) {
      // Spill into the Thu 5 / Fri 6 buffer is a LAST RESORT and is QUICK-only:
      // any non-AP / non-band-A topic that could not be seated in-window is taught
      // at the QUICK tier in the buffer (its under-floor status is REPORTED). AP
      // (FULL) and band A (FULL) — which must never spill — keep their tier so a
      // genuine protected spill still reads as an above-floor shortfall.
      const s = byId.get(id);
      const protectedTier = s !== undefined && (isAP(s) || s.band === 'A');
      const spillPass: PlanPass = protectedTier ? passByTopic.get(id) ?? 'quick' : 'quick';
      genuineSpillPlacements.push({ dateISO, subjectCode: code, id, pass: spillPass });
      topicIds.push(id);
    }
    if (topicIds.length > 0) spills.push({ subject: code, topicIds, lastDateISO: dateISO });
  });
  // RE-AUDIT 2 — RECOVERED first passes (seated in-window on the revision-cycle's
  // first week) are taught by `spillBlocksFor` alongside any GENUINE post-coverage
  // spill, but are NOT reported as spills (they are in the shifted coverage
  // window) — so feasibility counts only the genuine remainder.
  const spillPlacements: Placement[] = [...recoveredPlacements, ...genuineSpillPlacements];

  // ---- MENT lane: pack 17 topics into 60-min base weekday coverage slots --
  const mentWeekdaySlots = subjectSlots.filter((s) => s.dow >= 1 && s.dow <= 5); // Mon–Fri coverage
  const mentByDate = new Map<string, PlanSubtopic[]>();
  let mentAllPassedISO = '';
  {
    // The orientation day's MENT block is the FIRST pass of mentList[0], so it is
    // removed from the weekday queue here and seeded on the orientation date —
    // the first weekday MENT block then continues with the NEXT topic in
    // sequence (ment-number-series-coding).
    const q = (orientationMentId !== undefined
      ? mentList.filter((s) => s.id !== orientationMentId)
      : mentList
    ).slice();
    for (const slot of mentWeekdaySlots) {
      if (q.length === 0) break;
      let used = 0;
      const placed: PlanSubtopic[] = [];
      while (q.length > 0) {
        const s = q[0]!;
        const m = subtopicMinutes(s.band, s.mcqCount, s.examPointCount ?? 0);
        if (placed.length >= 3) break; // ≤ 3 new topics per block
        if (placed.length > 0 && used + m > 60) break;
        q.shift();
        used += m;
        placed.push(s);
      }
      if (placed.length > 0) {
        mentByDate.set(slot.dateISO, placed);
        if (q.length === 0) mentAllPassedISO = slot.dateISO;
      }
    }
  }
  // Seed the orientation day's MENT first pass (ment-number-system) so it is
  // first-passed exactly once — on the orientation day, not again on Monday.
  if (orientationISO !== undefined && orientationMentId !== undefined) {
    const s = byId.get(orientationMentId);
    if (s) mentByDate.set(orientationISO, [s]);
  }

  // ---- CA first-pass tracking (first rotation appearance per CA id) -------
  const caFirstPassByDate = new Map<string, string>(); // date → CA id first-passed
  {
    const passed = new Set<string>();
    for (const slot of subjectSlots) {
      if (slot.dow < 1 || slot.dow > 5) continue; // CA block only on weekdays
      const caId = CA_ROTATION[slot.dow];
      if (caId && caList.some((c) => c.id === caId) && !passed.has(caId)) {
        passed.add(caId);
        caFirstPassByDate.set(slot.dateISO, caId);
      }
    }
  }

  // ---- First-pass-by-date index (for spaced revise +3/+10/+21) ------------
  const firstPassByDate = new Map<string, string[]>();
  const pushFirstPass = (dateISO: string, id: string): void => {
    const arr = firstPassByDate.get(dateISO) ?? [];
    arr.push(id);
    firstPassByDate.set(dateISO, arr);
  };
  for (const p of [...placements, ...spillPlacements, ...orientationPlacements]) pushFirstPass(p.dateISO, p.id);
  for (const [dateISO, list] of mentByDate) for (const s of list) pushFirstPass(dateISO, s.id);
  for (const [dateISO, caId] of caFirstPassByDate) pushFirstPass(dateISO, caId);

  const isApOrBandA = (id: string): boolean => AP_RE.test(id) || byId.get(id)?.band === 'A';

  // ---- DEEPEN passes (final window, STANDARDS §8a) ------------------------
  // Every topic left BELOW its floor after coverage (the `infeasibleFloorIds`
  // candidates — all QUICK, none AP/band-A) gets ONE deepen top-up scheduled
  // into a final-window `targeted-revision` block that brings it UP to its floor
  // tier. Rules: deepen AFTER the topic's own first pass, priority AP → band A →
  // PYQ desc → examPoints desc, ≤ DEEPEN_MAX_PER_BLOCK per block, and the block's
  // own deepen minutes never exceed the block minutes (the day stays ≤ budget).
  // Assignment happens inside the day loop (below) once each final day's blocks
  // are finalised, so a deepen never lands on a spill-crowded day whose
  // `targeted-revision` block was trimmed away.
  const firstPassDateById = new Map<string, string>();
  for (const [dateISO, ids] of firstPassByDate) {
    for (const id of ids) {
      const prev = firstPassDateById.get(id);
      if (prev === undefined || dateISO < prev) firstPassDateById.set(id, dateISO);
    }
  }

  // ---- The REAL test schedule --------------------------------------------
  // The two dress rehearsals carry FIXED papers (Paper-II then Paper-I, STANDARDS
  // §8a item 4), so the schedule no longer depends on which paper is more covered.
  const mockScheduleByDate = buildMockSchedule(opts.startISO, anchors, orientationISO, daysOffSet);
  /** Extra minutes to lift a topic from `from` to `to` (its floor). @internal */
  const deepenGapMinutes = (from: PlanPass, to: PlanPass): number => {
    if (from === 'quick' && to === 'standard') return DEEPEN_QUICK_TO_STANDARD_MIN;
    if (from === 'standard' && to === 'full') return DEEPEN_STANDARD_TO_FULL_MIN;
    if (from === 'quick' && to === 'full') return DEEPEN_QUICK_TO_STANDARD_MIN + DEEPEN_STANDARD_TO_FULL_MIN;
    return 0;
  };
  /** A `deepen` {@link PlanTopic} for a below-floor topic. @internal */
  const deepenTopicOf = (s: PlanSubtopic, minutes: number): PlanTopic => ({
    subtopicId: s.id,
    name: nameById(s.id),
    track: (s.track ?? 'paper1') === 'paper2' ? 'aptitude' : 'theory',
    mcqCount: Math.max(0, s.mcqCount ?? 0),
    band: s.band,
    pass: 'deepen',
    estMinutes: minutes,
    kind: 'topic',
  });
  // The mutable FIFO queue of below-floor topics awaiting a deepen, in depth
  // priority (AP → band A → PYQ desc → examPoints desc → id). Drained as final
  // days are built; whatever remains stays a reported floor shortfall.
  const deepenQueue = infeasibleFloorIds
    .map((id) => byId.get(id))
    .filter((s): s is PlanSubtopic => s !== undefined)
    .sort((a, b) => {
      const ap = (isAP(a) ? 1 : 0) - (isAP(b) ? 1 : 0);
      if (ap !== 0) return -ap;
      const ba = (a.band === 'A' ? 1 : 0) - (b.band === 'A' ? 1 : 0);
      if (ba !== 0) return -ba;
      const pd = (pyq[b.id] ?? 0) - (pyq[a.id] ?? 0);
      if (pd !== 0) return pd;
      const ed = (b.examPointCount ?? 0) - (a.examPointCount ?? 0);
      if (ed !== 0) return ed;
      return a.id.localeCompare(b.id);
    })
    .map((s) => ({
      s,
      from: passByTopic.get(s.id) ?? ('quick' as PlanPass),
      to: floorTier(s),
      firstPass: firstPassDateById.get(s.id) ?? '',
    }));
  const deepenAssignments: Array<{ id: string; fromTier: PlanPass; toTier: PlanPass; dateISO: string }> = [];
  /**
   * Fill a final day's `targeted-revision` block with the highest-priority
   * still-eligible deepen topics (first-passed STRICTLY before `dateISO`),
   * ≤ DEEPEN_MAX_PER_BLOCK and within the block's minutes. Mutates the block +
   * the shared queue + `deepenAssignments`. @internal
   */
  const assignDeepenForDay = (day: PlanDay, dateISO: string): void => {
    const trBlock = day.blocks.find((b) => b.kind === 'targeted-revision');
    if (!trBlock) return; // spill-crowded day trimmed its targeted-revision away
    const picked: PlanTopic[] = [];
    let usedMin = 0;
    for (let i = 0; i < deepenQueue.length && picked.length < DEEPEN_MAX_PER_BLOCK; ) {
      const c = deepenQueue[i]!;
      const minutes = deepenGapMinutes(c.from, c.to);
      // A deepen must come AFTER the topic's own first pass, and fit the block.
      if (!(c.firstPass !== '' && c.firstPass < dateISO) || minutes <= 0 || usedMin + minutes > trBlock.minutes) {
        i += 1;
        continue;
      }
      picked.push(deepenTopicOf(c.s, minutes));
      usedMin += minutes;
      deepenAssignments.push({ id: c.s.id, fromTier: c.from, toTier: c.to, dateISO });
      deepenQueue.splice(i, 1);
    }
    if (picked.length > 0) trBlock.topics = picked;
  };

  // ---- Covered-MENT (for practice scope) as of a date --------------------
  const mentDates = [...mentByDate.keys()].sort();
  const coveredMentUpTo = (dateISO: string): string[] => {
    const out: string[] = [];
    for (const d of mentDates) {
      if (d > dateISO) break;
      for (const s of mentByDate.get(d)!) out.push(s.id);
    }
    return out;
  };
  const practiceScope = (covered: readonly string[]): string[] =>
    [...covered]
      .sort((a, b) => {
        const wa = ctx.masteryOf(a) < 80 ? 1 : 0;
        const wb = ctx.masteryOf(b) < 80 ? 1 : 0;
        return wb - wa || (pyq[b] ?? 0) - (pyq[a] ?? 0) || a.localeCompare(b);
      })
      .slice(0, 6);

  // ---- Placements indexed by date ----------------------------------------
  const placedByDate = new Map<string, Placement[]>();
  for (const p of [...placements, ...spillPlacements, ...orientationPlacements]) {
    const arr = placedByDate.get(p.dateISO) ?? [];
    arr.push(p);
    placedByDate.set(p.dateISO, arr);
  }

  // ---- Unit schedule (first pass) ----------------------------------------
  // Which UNIT(s) each coverage main-block day teaches — normally ONE (clean
  // breaks), but a unit-end day that starts the NEXT unit after its wrap-up
  // carries TWO, in teaching order. Each unit's run of dates lets views show
  // "day 2 of 4" and the summary report each unit's calendar window. Spill-
  // buffer first passes keep their unit too. @internal
  const unitsByDate = new Map<string, number[]>();
  for (const p of [...placements, ...spillPlacements, ...orientationPlacements]) {
    if (p.unitIndex === undefined) continue;
    const arr = unitsByDate.get(p.dateISO) ?? [];
    if (!arr.includes(p.unitIndex)) arr.push(p.unitIndex);
    unitsByDate.set(p.dateISO, arr);
  }
  /** The day's PRIMARY unit — the one its first main block continues/finishes. */
  const primaryUnitOf = (dateISO: string): number | undefined => unitsByDate.get(dateISO)?.[0];
  const unitDates: string[][] = units.map(() => []);
  for (const [dateISO, uis] of unitsByDate) for (const ui of uis) unitDates[ui]!.push(dateISO);
  for (const arr of unitDates) arr.sort();
  // UNIT WRAP-UPS from the final pack: date → (unitIndex → wrap-up minutes). The
  // day loop turns each into a `unit-wrapup` block consolidating that unit.
  const wrapupByDate = new Map<string, Map<number, number>>();
  for (const w of result.wrapups) {
    const m = wrapupByDate.get(w.dateISO) ?? new Map<number, number>();
    m.set(w.unitIndex, w.size);
    wrapupByDate.set(w.dateISO, m);
  }
  /** Set a day's unit fields from the first-pass unit schedule. @internal */
  const setUnitFields = (day: PlanDay, ui: number | undefined): void => {
    if (ui === undefined || ui < 0 || ui >= units.length) return;
    const u = units[ui]!;
    const run = unitDates[ui]!;
    day.unitId = u.id;
    day.unitTitle = u.title;
    day.unitSubjectCode = u.subjectCode;
    day.unitDay = Math.max(1, run.indexOf(day.dateISO) + 1);
    day.unitDays = run.length;
    day.nextUnitTitle = units[ui + 1]?.title ?? null;
  };

  // ---- MARKS-BASED revision schedule (STANDARDS §8a, item 3) --------------
  // The revision cycle allocates its MAIN-BLOCK minutes EQUALLY across the six
  // 30-mark parts (History, Polity, Economy, Geography, Science & Tech, Current
  // Affairs); Mental Ability is practised daily ON TOP (its own ment-practice
  // block), never in this split. Within a part, topics are ordered by PYQ weight
  // desc, then weakness (mastery asc), then oldest-touched (earliest first pass).
  // Each revision main slot is handed to the part with the LEAST accumulated
  // revision minutes so far, and filled from that part's CYCLING queue (so topics
  // are revisited round and round, closing cold gaps). Revisit topics cost
  // {@link REVISIT_MIN} each (a notes skim + cards + mistakes + ~10 Qs), so a
  // block of ≤ floor(cap / REVISIT_MIN) topics always fits its minutes (item 8
  // block-legality fix). Replaces the old unit-order revisit.
  const REVISIT_MIN = 25;
  const REVISION_PARTS = ['HIST', 'POL', 'ECON', 'GEO', 'SCI', 'CA'] as const;
  const partLabel = (code: string): string => SUBJECT_LABEL[code] ?? (code === 'CA' ? 'Current Affairs' : code);
  const partSourceIds = (code: string): string[] =>
    (code === 'CA' ? caList : code === 'MENT' ? mentList : subjectLists[code] ?? []).map((s) => s.id);
  const partOrderedIds = (code: string): string[] =>
    partSourceIds(code).slice().sort((a, b) => {
      const pd = (pyq[b] ?? 0) - (pyq[a] ?? 0);
      if (pd !== 0) return pd;
      const md = ctx.masteryOf(a) - ctx.masteryOf(b); // weakness first
      if (md !== 0) return md;
      const fa = firstPassDateById.get(a) ?? '';
      const fb = firstPassDateById.get(b) ?? '';
      if (fa !== fb) return fa < fb ? -1 : 1; // oldest-touched first
      return a.localeCompare(b);
    });
  const revisionSlots = slots
    .filter((sl) => sl.region === 'revision' && !sl.isMock && !sl.preStart && !sl.dayOff && (sl.dow === 0 || (sl.dow >= 1 && sl.dow <= 5)))
    .sort((a, b) => a.dateISO.localeCompare(b.dateISO));
  const revisitByDate = new Map<string, { subjectCode: string; topicIds: string[] }>();
  {
    const cyclingQueue: Record<string, string[]> = {};
    const partMinUsed: Record<string, number> = {};
    for (const code of REVISION_PARTS) {
      cyclingQueue[code] = partOrderedIds(code);
      partMinUsed[code] = 0;
    }
    const popPart = (code: string, take: number): string[] => {
      const out: string[] = [];
      const full = partOrderedIds(code);
      if (full.length === 0) return out;
      let q = cyclingQueue[code]!;
      while (out.length < take) {
        if (q.length === 0) q = cyclingQueue[code] = full.slice();
        out.push(q.shift()!);
      }
      return out;
    };
    for (const sl of revisionSlots) {
      // Part with the least accumulated minutes (ties → REVISION_PARTS order).
      const part = REVISION_PARTS.reduce((best, c) => (partMinUsed[c]! < partMinUsed[best]! ? c : best), REVISION_PARTS[0]);
      const cap = mainCapFor(sl.dow, weekendBudgetMin);
      const take = Math.max(1, Math.floor(cap / REVISIT_MIN));
      const topicIds = popPart(part, take);
      if (topicIds.length > 0) {
        revisitByDate.set(sl.dateISO, { subjectCode: part, topicIds });
        partMinUsed[part] = (partMinUsed[part] ?? 0) + topicIds.length * REVISIT_MIN;
      }
    }
  }
  /** Set a revision day's header fields from the part it revises. @internal */
  const setRevisitSubjectFields = (day: PlanDay, code: string): void => {
    day.unitId = `revise-${code.toLowerCase()}`;
    day.unitTitle = `Revise \u00b7 ${partLabel(code)}`;
    day.unitSubjectCode = code;
    day.unitDay = 0;
    day.unitDays = 0;
    day.nextUnitTitle = null;
  };

  // ---- Fortnightly Mains answer dates (STANDARDS §8a, item 12) ------------
  // One Mains answer per fortnight, on ALTERNATE revision Sundays only (never in
  // the first pass or the final window): 25 min, drawn from the authored Mains
  // bank (every such topic is already first-passed by the revision cycle).
  const mainsWriteByDate = new Map<string, string>();
  {
    const mainsBank = opts.mainsQuestionIds ?? [];
    const revisionSundays = revisionSlots.filter((sl) => sl.dow === 0).map((sl) => sl.dateISO).sort();
    let fortnight = 0;
    for (let i = 0; i < revisionSundays.length; i += 2) {
      const qid = mainsBank.length > 0 ? mainsBank[fortnight % mainsBank.length]! : undefined;
      if (qid !== undefined) mainsWriteByDate.set(revisionSundays[i]!, qid);
      fortnight += 1;
    }
  }

  // ---- Touch-rule rolling sweep (STANDARDS §8a, item 3 — HARD rules) -------
  // Over the revision cycle + final window every Prelims subject must be revised
  // within the last 14 days, every topic touched ≥ 3 times (first pass + ≥ 2
  // revisits), and no topic's last touch older than 28 days at the exam. The
  // marks-based deep block alone cannot revisit the 47-topic History part twice,
  // so a light rolling SWEEP of the six parts' topics (round-robin interleaved,
  // each part PYQ-then-oldest ordered) is added to each revision/final day's
  // `reviseSubtopicIds` (a cards/mistakes recall), cycling so every topic is
  // swept ≥ 2 times and every topic gets a FRESH touch in the final stretch.
  // Long window only (the compressed short-window fallback keeps pure spaced
  // recall, which its tests assert). MENT is kept warm by the daily practice set.
  const sweepByDate = new Map<string, string[]>();
  if (!anchors.shortWindow) {
    const SWEEP_PER_DAY = 8;
    // Sweep covers the six 30-mark parts AND Mental Ability, so EVERY Prelims
    // topic (incl. MENT) gets its ≥ 2 revisits + a fresh final-stretch touch.
    const SWEEP_PARTS = [...REVISION_PARTS, 'MENT'];
    const partLists = SWEEP_PARTS.map((c) => partOrderedIds(c));
    const sweepMaster: string[] = [];
    for (let i = 0; ; i += 1) {
      let any = false;
      for (const list of partLists) {
        if (i < list.length) {
          sweepMaster.push(list[i]!);
          any = true;
        }
      }
      if (!any) break;
    }
    const sweepSlots = slots
      .filter((sl) => (sl.region === 'revision' || sl.region === 'final') && !sl.isMock && !sl.preStart && !sl.dayOff)
      .map((sl) => sl.dateISO)
      .sort();
    if (sweepMaster.length > 0) {
      let cursor = 0;
      for (const dateISO of sweepSlots) {
        const slice: string[] = [];
        for (let k = 0; k < SWEEP_PER_DAY; k += 1) {
          slice.push(sweepMaster[cursor % sweepMaster.length]!);
          cursor += 1;
        }
        sweepByDate.set(dateISO, slice);
      }
    }
  }

  // Merge revise id lists into one deduped list (first-seen order). @internal
  const mergeRevise = (...lists: ReadonlyArray<readonly string[]>): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const list of lists) for (const id of list) if (!seen.has(id)) { seen.add(id); out.push(id); }
    return out;
  };

  // ---- Coverage REVISE seed (N4: never empty) ----------------------------
  // The coverage-phase `revise` (weekday) and `weekly-revision` (Sunday) blocks
  // list the spaced +3/+10/+21-day recall set, which is EMPTY for a fresh
  // beginner in the first ~2 weeks (nothing was first-passed 3 days ago yet), so
  // those early blocks named zero topics. Seed them deterministically so a
  // coverage revise/weekly-revision block ALWAYS names topics after day 1: the
  // spaced list when it has any, otherwise the most recent prior day's first
  // passes (yesterday's flashcards), otherwise the earliest topics studied so
  // far. Long window only — the short-window fallback keeps PURE spaced recall
  // (its test asserts the revise list is drawn only from +3/+10/+21). Runtime
  // due-cards still replace these plan-time seeds. @internal
  const coverageReviseIds = (dateISO: string): string[] => {
    const spaced = spacedReviseFor(dateISO, firstPassByDate, isApOrBandA);
    if (spaced.length > 0 || anchors.shortWindow) return spaced;
    for (let back = 1; back <= 21; back += 1) {
      const prior = firstPassByDate.get(addDaysISO(dateISO, -back));
      if (prior && prior.length > 0) return prior.slice(0, 6);
    }
    const earliest = [...firstPassByDate.entries()]
      .filter(([d]) => d < dateISO)
      .sort((a, b) => a[0].localeCompare(b[0]));
    return earliest.length > 0 ? earliest[0]![1].slice(0, 6) : [];
  };

  // MARKS-BASED default list for the final-window targeted revision (item 8):
  // the six 30-mark parts' topics round-robin interleaved (PYQ-then-oldest within
  // each part), so the never-empty default fill is marks-balanced and high-yield.
  const targetedDefaultList: string[] = [];
  {
    const lists = REVISION_PARTS.map((c) => partOrderedIds(c));
    for (let i = 0; ; i += 1) {
      let any = false;
      for (const list of lists) if (i < list.length) { targetedDefaultList.push(list[i]!); any = true; }
      if (!any) break;
    }
  }
  let targetedCursor = 0;
  // Ensure a final-window `targeted-revision` block is NEVER empty at plan time:
  // after the deepen top-ups, top it up with the marks-based default list (cycling,
  // first-passed before the day, within the block's minutes). @internal
  const fillTargetedRevisionDefaults = (day: PlanDay, dateISO: string): void => {
    const trBlock = day.blocks.find((b) => b.kind === 'targeted-revision');
    if (!trBlock || targetedDefaultList.length === 0) return;
    const picks: PlanTopic[] = [...(trBlock.topics ?? [])];
    const have = new Set(picks.map((t) => t.subtopicId));
    let usedMin = picks.reduce((a, t) => a + t.estMinutes, 0);
    let guard = 0;
    while (usedMin + REVISIT_MIN <= trBlock.minutes && guard < targetedDefaultList.length) {
      const id = targetedDefaultList[targetedCursor % targetedDefaultList.length]!;
      targetedCursor += 1;
      guard += 1;
      const fp = firstPassDateById.get(id) ?? '';
      if (have.has(id) || fp === '' || fp >= dateISO) continue;
      const t = toRevisitTopic(id);
      picks.push(t);
      have.add(id);
      usedMin += t.estMinutes;
    }
    if (picks.length > 0) trBlock.topics = picks;
  };

  // ---- Budget scaling helpers --------------------------------------------
  const toTopic = (id: string, pass: PlanPass): PlanTopic => {
    const s = byId.get(id);
    const band = s?.band;
    const mcq = Math.max(0, s?.mcqCount ?? 0);
    const ep = s?.examPointCount ?? 0;
    const track: 'theory' | 'aptitude' = (s?.track ?? 'paper1') === 'paper2' ? 'aptitude' : 'theory';
    const f = Math.min(FULL_CAP_MIN, subtopicMinutes(band, mcq, ep));
    const est = pass === 'full' ? f : pass === 'standard' ? Math.min(STANDARD_MIN, f) : Math.min(QUICK_MIN, f);
    return {
      subtopicId: id,
      name: nameById(id),
      track,
      mcqCount: mcq,
      band,
      pass,
      estMinutes: est,
      kind: 'topic',
    };
  };
  // A revisit {@link PlanTopic}: a 'standard'-tier re-visit COSTED at the flat
  // REVISIT_MIN (capped at the topic's own full cost), so a revise/targeted
  // block of ≤ floor(cap / REVISIT_MIN) topics always fits its minutes — the
  // item-8 block-legality fix (Σ topic minutes ≤ block minutes). @internal
  const toRevisitTopic = (id: string): PlanTopic => {
    const t = toTopic(id, 'standard');
    return { ...t, estMinutes: Math.min(REVISIT_MIN, t.estMinutes) };
  };
  const practiceTopic = (ids: readonly string[]): PlanTopic => ({
    subtopicId: PRACTICE_SUBTOPIC_ID,
    name: 'Mental Ability practice',
    track: 'aptitude',
    mcqCount: Math.min(PRACTICE_QUESTIONS, ids.reduce((a, id) => a + availableDrill(byId.get(id)?.mcqCount ?? 0), 0)),
    band: undefined,
    pass: 'full',
    estMinutes: PRACTICE_MIN,
    kind: 'practice',
    practiceSubtopicIds: [...ids],
  });

  // ---- UNIT WRAP-UP block (STANDARDS §8a) --------------------------------
  // A `size`-minute consolidation of a just-finished unit: WRAPUP_GLANCE_MIN
  // "Topic at a glance", a timed UNIT TEST of `unitTestCountForWrapup(size)`
  // questions drawn ONLY from this unit's topics' MCQs (deterministic seed =
  // the day), then WRAPUP_REVIEW_MIN of review. One tap launches the test
  // (reusing the scoped mock runner). @internal
  const unitWrapupBlock = (ui: number, size: number, dateISO: string): PlanBlock => {
    const u = units[ui]!;
    const count = unitTestCountForWrapup(size);
    return {
      kind: 'unit-wrapup',
      label: `Unit wrap-up \u00b7 ${u.title}`,
      minutes: size,
      subjectCode: u.subjectCode,
      unitId: u.id,
      unitTitle: u.title,
      unitTestSubtopicIds: u.topics.map((s) => s.id),
      unitTestCount: count,
      unitTestMinutes: count,
      unitTestDateISO: dateISO,
    };
  };

  // ---- Coverage MAIN-BLOCK builder (STANDARDS §8a) -----------------------
  // Turn a coverage day's placements into the ordered main blocks: one `subject`
  // block per unit taught that day (minutes = its own topics' minutes, so the
  // teaching block itself carries NO idle), a `unit-wrapup` block right after
  // each unit that finished with room, and a trailing `Catch up or rest`
  // `catchup` block for any minutes still free — so no first-pass main block is
  // left ≥ 30 min idle. Returns the blocks, the day's first-pass topics (union),
  // and the day's PRIMARY unit index. @internal
  const buildCoverageMainBlocks = (
    dateISO: string,
    mainMin: number,
  ): { blocks: PlanBlock[]; topics: PlanTopic[]; primaryUi: number | undefined } => {
    const placed = placedByDate.get(dateISO) ?? [];
    const uis = unitsByDate.get(dateISO) ?? [];
    const wraps = wrapupByDate.get(dateISO);
    const blocks: PlanBlock[] = [];
    const allTopics: PlanTopic[] = [];
    if (uis.length === 0) {
      // No unit teaches here (first pass complete) → early consolidation block.
      blocks.push({ kind: 'targeted-revision', label: 'Revise your studied units \u2014 first pass complete', minutes: Math.max(1, mainMin) });
      return { blocks, topics: allTopics, primaryUi: undefined };
    }
    let used = 0;
    for (const ui of uis) {
      const unit = units[ui]!;
      const unitPlaced = placed.filter((p) => p.unitIndex === ui);
      const unitTopics = unitPlaced.map((p) => toTopic(p.id, p.pass));
      const tmin = Math.max(1, unitTopics.reduce((a, t) => a + t.estMinutes, 0));
      blocks.push({
        kind: 'subject',
        label: unit.title,
        minutes: tmin,
        subjectCode: unit.subjectCode,
        topics: unitTopics,
        buildsOn: buildsOnFor(unitPlaced[0]?.id, seqOrder, unit.subjectCode, nameById),
      });
      used += tmin;
      for (const t of unitTopics) allTopics.push(t);
      const wsize = wraps?.get(ui);
      if (wsize !== undefined && wsize > 0) {
        blocks.push(unitWrapupBlock(ui, wsize, dateISO));
        used += wsize;
      }
    }
    const remaining = mainMin - used;
    if (remaining >= WRAPUP_MIN_IDLE_MIN) {
      blocks.push({ kind: 'catchup', label: 'Catch up or rest', minutes: remaining });
    }
    return { blocks, topics: allTopics, primaryUi: uis[0] };
  };

  // ---- Revision-cycle MAIN-BLOCK builder (STANDARDS §8a, item 3) ----------
  // The revision cycle revisits ONE marks-based part per main block (the part
  // the slot was assigned to, for equal per-part minutes). Topics are the part's
  // PYQ-then-oldest-ordered revisit set at REVISIT_MIN each, so the block is
  // always legal (Σ topic minutes ≤ block minutes). @internal
  const revisionMainBlocks = (
    mainMin: number,
    revisit: { subjectCode: string; topicIds: string[] } | undefined,
  ): PlanBlock[] => {
    const min = Math.max(1, mainMin);
    // Cap the revisit set to what the (possibly RECOVERY-shortened) block holds,
    // so Σ topic minutes ≤ block minutes stays legal (REVISIT_MIN each).
    const maxTopics = Math.max(0, Math.floor(min / REVISIT_MIN));
    const topics = (revisit?.topicIds ?? []).slice(0, maxTopics).map((id) => toRevisitTopic(id));
    // "Study once for Prelims, revise for Mains later" (STANDARDS §8a): in the
    // REVISION CYCLE only, a revisit of a topic that has an authored "For Mains"
    // note gets +MAINS_ANGLE_MIN to READ that analytical note — but ONLY while
    // the block stays within its minutes (Σ topic minutes ≤ block minutes);
    // otherwise the +5 is skipped (the plain revisit still runs). The first pass
    // and the final window never add this reading.
    {
      let used = topics.reduce((a, t) => a + t.estMinutes, 0);
      for (const t of topics) {
        if (byId.get(t.subtopicId)?.hasMainsAngleNote !== true) continue;
        if (used + MAINS_ANGLE_MIN > min) break; // keep the block legal
        t.estMinutes += MAINS_ANGLE_MIN;
        t.mainsAngle = true;
        used += MAINS_ANGLE_MIN;
      }
    }
    if (!revisit || topics.length === 0) {
      return [
        { kind: 'targeted-revision', label: 'Revise your studied topics \u2014 weakest + high-yield first', minutes: min },
      ];
    }
    return [
      {
        kind: 'targeted-revision',
        label: `Revise \u00b7 ${partLabel(revisit.subjectCode)} (marks-based)`,
        minutes: min,
        subjectCode: revisit.subjectCode,
        topics,
      },
    ];
  };

  // ---- Coverage SPILL block builder (shared by the final + revision days) --
  // Any topic the packer could not seat by the coverage-end date spills to the
  // first two post-coverage days (`anchors.spillDates`). Those dates fall in the
  // FINAL window in the short-window fallback and in the first REVISION days in
  // the long window; either way the spill is TAUGHT (first-passed exactly once)
  // as block-size-legal subject blocks (≤ 3 new topics, 4 only if all QUICK; a
  // block never claims fewer minutes than its topics). Returns the blocks + the
  // topics so the caller can record the first pass. @internal
  const spillBlocksFor = (dateISO: string): { blocks: PlanBlock[]; topics: PlanTopic[] } => {
    const spilledHere = (placedByDate.get(dateISO) ?? []).filter(() => dateISO <= spillTeachUntilISO);
    const topics = spilledHere.map((p) => toTopic(p.id, p.pass));
    const blocks: PlanBlock[] = [];
    if (topics.length === 0) return { blocks, topics };
    const bySubj = new Map<string, PlanTopic[]>();
    for (const t of topics) {
      const c = byId.get(t.subtopicId)?.subjectCode ?? '';
      const arr = bySubj.get(c) ?? [];
      arr.push(t);
      bySubj.set(c, arr);
    }
    for (const [subj, ts] of bySubj) {
      let i = 0;
      while (i < ts.length) {
        const allQuickAt4 =
          ts.slice(i, i + 4).length === 4 && ts.slice(i, i + 4).every((t) => t.pass === 'quick');
        const take = allQuickAt4 ? 4 : Math.min(3, ts.length - i);
        const chunk = ts.slice(i, i + take);
        const chunkMinutes = chunk.reduce((a, t) => a + t.estMinutes, 0);
        blocks.push({
          kind: 'subject',
          label: `${SUBJECT_LABEL[subj] ?? subj} (spill)`,
          minutes: chunkMinutes,
          subjectCode: subj,
          topics: chunk,
        });
        i += take;
      }
    }
    return { blocks, topics };
  };

  // ---- Materialise the day list ------------------------------------------
  const statusFor = (dateISO: string): PlanDayStatus => {
    const d = diffDaysISO(todayISO, dateISO);
    return d < 0 ? 'past' : d === 0 ? 'today' : 'upcoming';
  };

  // The plan's REAL first day is computed once near the top (`planFirstISO`);
  // when it is a Saturday it becomes DAY-1 ORIENTATION (handled below).

  const days: PlanDay[] = [];
  for (const slot of slots) {
    const day = blankDay(slot, statusFor(slot.dateISO));
    // On a BEGINNER-RAMP weekday the FIXED blocks (MENT / Revise / CA / Telugu)
    // keep their full minutes (scale from the daily budget, not the reduced ramp
    // budget) — only the main block is shortened via `mainCapFor`. Every other
    // day scales its blocks to its own budget as before.
    const scale = slot.rampDay ? dailyBudgetMin / 240 : slot.budgetMin / 240;
    const sm = (base: number): number => Math.max(1, Math.round(base * scale));

    // A day BEFORE the chosen plan start is FREE — no blocks scheduled. The
    // first on/after-start day is the plan's real day 1 (views show
    // "Plan starts <date>" on these free days).
    if (slot.preStart) {
      days.push(day);
      continue;
    }

    // ---- DAY OFF (festival / holiday — STANDARDS §8a) ---------------------
    // A learner day off is a LIGHT day: Current Affairs + flashcards only,
    // capped at ≤ 60 min. No mock, no new topic, no week test. Displaced work
    // flows into the catch-up buffers; mocks have already been moved off.
    if (slot.dayOff) {
      const offMin = Math.min(60, slot.budgetMin);
      day.dayOff = true;
      day.blocks = [{ kind: 'light', label: 'Day off \u2014 Current Affairs + flashcards only', minutes: offMin }];
      day.plannedMinutes = offMin;
      days.push(day);
      continue;
    }

    // ---- DAY-1 ORIENTATION (STANDARDS §8a) --------------------------------
    // The plan's first day, when it is a Saturday (the opening-mock case — the
    // real planStartDate Sat 10 Oct), opens with ORIENTATION instead of a full
    // mock: a "Start here" guide block, the first Mental Ability topic, the
    // first History topic(s), and a Current-Affairs intro. No mock, no revise.
    // The named first topics are shown as guided Learn links; they are still
    // formally first-passed on their own scheduled days, so first-pass
    // accounting (every topic once) is unchanged.
    if (
      orientationISO !== undefined &&
      slot.dateISO === orientationISO &&
      slot.region !== 'exam' &&
      slot.region !== 'light'
    ) {
      day.phase = 'learn';
      const blocks: PlanBlock[] = [
        { kind: 'start-here', label: 'Start here \u2014 how the exam and this app work', minutes: 30 },
      ];
      // The orientation Mental Ability + History blocks ARE the first pass of
      // their topics (recorded in mentByDate / placedByDate above), so they are
      // taught at their planned tier here and the NEXT MENT day / Monday History
      // block continue the sequence — no topic is first-passed twice.
      const mentTopics = (mentByDate.get(orientationISO) ?? []).map((s) => toTopic(s.id, 'full'));
      if (mentTopics.length > 0) {
        blocks.push({
          kind: 'ment',
          label: 'Mental Ability',
          minutes: 60,
          subjectCode: 'MENT',
          topics: mentTopics,
          buildsOn: buildsOnFor(mentByDate.get(orientationISO)?.[0]?.id, seqOrder, 'MENT', nameById),
        });
      }
      const histPlaced = (placedByDate.get(orientationISO) ?? []).filter((p) => p.subjectCode === 'HIST');
      const histTopics = histPlaced.map((p) => toTopic(p.id, p.pass));
      if (histTopics.length > 0) {
        blocks.push({
          kind: 'subject',
          label: SUBJECT_LABEL['HIST'] ?? 'History',
          minutes: 120,
          subjectCode: 'HIST',
          topics: histTopics,
          buildsOn: buildsOnFor(histPlaced[0]?.id, seqOrder, 'HIST', nameById),
        });
      }
      const caFirst = caList[0]?.id ?? 'ca-regional';
      blocks.push({
        kind: 'ca',
        label: 'How current affairs is asked \u00b7 first CA set',
        minutes: 30,
        caSubtopicId: caFirst,
      });
      day.blocks = blocks;
      // The orientation study blocks ARE the first pass of their MENT + History
      // topics (STANDARDS §8a): record them so first-pass accounting counts each
      // Prelims topic exactly once (here, not again on a later day).
      const orientationTopics = [...mentTopics, ...histTopics];
      recordFirstPass(day, orientationTopics);
      day.topics = orientationTopics;
      setUnitFields(day, primaryUnitOf(orientationISO));
      day.drillTarget = orientationTopics.reduce((a, t) => a + availableDrill(t.mcqCount), 0);
      finaliseBlocks(day, slot.budgetMin);
      days.push(day);
      continue;
    }

    if (slot.region === 'exam') {
      // Exam day — no tasks.
      days.push(day);
      continue;
    }

    if (slot.region === 'light') {
      // LIGHT day: AP key facts + CA key facts + formula sheet (≤ 90 min, no mock).
      const lightMin = Math.min(90, slot.budgetMin);
      day.light = true;
      day.blocks = [
        { kind: 'light', label: 'AP + CA key facts · formula sheet', minutes: lightMin },
      ];
      day.plannedMinutes = lightMin;
      days.push(day);
      continue;
    }

    if (slot.isMock) {
      const sched = mockScheduleByDate.get(slot.dateISO);
      // ---- WEEK TEST (first-pass Saturday) --------------------------------
      // A short, studied-topics-only timed test (45 Q / 55 min, −1/3), then a
      // review of every wrong/guessed answer, then catch-up of missed items (or
      // the next topics of the biggest-backlog subject). It teaches NO new
      // topic, so first-pass accounting is unchanged (exactly like a mock day).
      if (sched?.kind === 'week-test') {
        // Pool = every subtopic first-passed on or before this Saturday; the
        // subset first-passed in the 7 days ENDING this Saturday is "this week".
        const weekStartISO = addDaysISO(slot.dateISO, -6);
        const studied: string[] = [];
        const thisWeek: string[] = [];
        for (const [id, fp] of firstPassDateById) {
          if (fp === '' || fp > slot.dateISO) continue;
          studied.push(id);
          if (fp >= weekStartISO) thisWeek.push(id);
        }
        studied.sort();
        thisWeek.sort();
        day.phase = 'learn';
        // A week test is ALWAYS fixed at WEEK_TEST_MINUTES (55) regardless of
        // the day's budget — it is a scoped 45-Q test, not a block that grows
        // with a bigger Sunday budget. Only the review + catch-up blocks absorb
        // the extra time (via `catchupMin`), so a Sunday week test still runs 55.
        const testMin = WEEK_TEST_MINUTES;
        const reviewMin = sm(45);
        const catchupMin = Math.max(1, slot.budgetMin - testMin - reviewMin);
        day.blocks = [
          {
            kind: 'week-test',
            label: `Week test ${sched.num}`,
            minutes: testMin,
            mockNumber: sched.num,
            weekTestDateISO: slot.dateISO,
            weekTestSubtopicIds: studied,
            weekTestThisWeekIds: thisWeek,
          },
          { kind: 'week-test-review', label: 'Review every wrong or guessed answer', minutes: reviewMin },
          { kind: 'catchup', label: 'Catch up on missed items \u2014 or the next topics of your biggest backlog', minutes: catchupMin },
        ];
        day.drillTarget = WEEK_TEST_COUNT;
        finaliseBlocks(day, slot.budgetMin);
        days.push(day);
        continue;
      }

      // ---- FULL mock / DRESS REHEARSAL ------------------------------------
      const paper = sched?.paper ?? slot.mockPaper ?? 'paper2';
      const num = sched?.num ?? slot.mockNumber;
      const paperLabel = paper === 'paper1' ? 'Paper-I' : 'Paper-II';
      const isDress = sched?.kind === 'dress-rehearsal';
      const mockLabel = isDress
        ? `Dress rehearsal \u2014 practise the 2-hour format; the score doesn\u2019t matter yet`
        : `Full ${paperLabel} mock`;
      day.phase = 'mock';
      day.mockPaper = paper;
      day.mockNumber = num;
      // A full Prelims/dress-rehearsal paper is ALWAYS the paper's own duration
      // (120 min) and the review is a fixed 60 — NEITHER scales with the day
      // budget. Any extra budget (e.g. a mock moved onto a 360-min Sunday) flows
      // into the weakest-area drill, never inflating the mock itself.
      const mockMin = patternFor(paper).durationMin;
      const mockReviewMin = 60;
      const weakestAreaMin = Math.max(1, slot.budgetMin - mockMin - mockReviewMin);
      day.blocks = [
        { kind: 'mock', label: mockLabel, minutes: mockMin, mockPaper: paper, mockNumber: num },
        { kind: 'mock-review', label: 'Review wrong answers', minutes: mockReviewMin },
        { kind: 'weakest-area', label: 'Weakest-area drill', minutes: weakestAreaMin },
      ];
      day.drillTarget = FULL_MOCK_QUESTIONS;
      finaliseBlocks(day, slot.budgetMin);
      days.push(day);
      continue;
    }

    if (slot.region === 'revision') {
      // REVISION CYCLE (long window only, ~4 weeks between coverage and the
      // final window): the SAME weekly rhythm, but the MAIN BLOCK now REVISITS
      // the WEEKLY SUBJECT UNITS in the same order (weakest topics first within
      // a unit, ~25 min each: notes skim + cards + mistakes + ~10 Qs) instead of
      // teaching new ones — so subjects come back in coherent weekly runs and NO
      // new topics are first-passed here (coverage is done). STANDARDS §8a.
      day.phase = 'revise';
      const revisit = revisitByDate.get(slot.dateISO);
      const mainMin = mainCapFor(slot.dow, slot.budgetMin);
      // COVERAGE SPILL into the first revision days (long window): a few lowest-
      // priority topics the ramped/day-off-reduced coverage window could not seat
      // are first-passed here (once), so no topic is ever lost. Rendered FIRST so
      // finaliseBlocks never trims below the topics they teach.
      const revSpill = spillBlocksFor(slot.dateISO);
      // RE-AUDIT 2 — on a RECOVERY day (the revision cycle's first week now
      // teaching a few first passes) the revision MAIN block is shortened by the
      // recovered-spill minutes so the day stays within budget and the fixed
      // Mental Ability / Revise / CA blocks survive (STANDARDS §8a).
      const revSpillMin = revSpill.blocks.reduce((a, b) => a + b.minutes, 0);

      if (slot.dow === 0) {
        // SUNDAY revision: a marks-based revision MAIN block, a 30-min Mental
        // Ability practice set (STANDARDS §8a, item 2 — MENT every day incl.
        // Sunday), then the fixed weekly revision + CA round-up + Telugu.
        const sunScope = practiceScope(coveredMentUpTo(slot.dateISO).length > 0 ? coveredMentUpTo(slot.dateISO) : mentList.map((s) => s.id));
        // One Mains answer per fortnight (STANDARDS §8a, item 12): on alternate
        // revision Sundays only, 25 min taken from the main revision block so the
        // Sunday stays within budget.
        const mainsQid = mainsWriteByDate.get(slot.dateISO);
        const sunMainMin = Math.max(1, (mainsQid !== undefined ? mainMin - 25 : mainMin) - revSpillMin);
        const blocks: PlanBlock[] = [
          ...revSpill.blocks,
          ...revisionMainBlocks(sunMainMin, revisit),
          { kind: 'ment-practice', label: 'Mental Ability practice', minutes: PRACTICE_MIN, practiceSubtopicIds: sunScope, topics: [practiceTopic(sunScope)] },
          { kind: 'weekly-revision', label: 'Weekly revision (mistakes + flashcards)', minutes: 30 },
          { kind: 'ca-roundup', label: 'Current Affairs weekly round-up', minutes: 45, caSubtopicId: 'ca-national' },
          { kind: 'telugu', label: 'Telugu script practice', minutes: 15 },
        ];
        if (mainsQid !== undefined) {
          blocks.push({ kind: 'mains-write', label: 'Mains answer practice (one question, 25 min)', minutes: 25, mainsQuestionId: mainsQid });
        }
        if (revSpill.topics.length > 0) recordFirstPass(day, revSpill.topics);
        day.blocks = blocks;
        day.teluguBlock = true;
        day.weeklyRevision = true;
        day.caRevision = true;
        day.reviseSubtopicIds = mergeRevise(revisit?.topicIds ?? [], sweepByDate.get(slot.dateISO) ?? [], spacedReviseFor(slot.dateISO, firstPassByDate, isApOrBandA));
        if (revisit) setRevisitSubjectFields(day, revisit.subjectCode);
        finaliseBlocks(day, slot.budgetMin);
        days.push(day);
        continue;
      }

      // WEEKDAY revision (Mon–Fri): the unit-revisit MAIN block FIRST (same
      // block order as coverage — main → Mental Ability → Telugu → Revise →
      // Current Affairs).
      const covered = coveredMentUpTo(slot.dateISO);
      const scope = practiceScope(covered.length > 0 ? covered : mentList.map((s) => s.id));
      const blocks: PlanBlock[] = [
        ...revSpill.blocks,
        ...revisionMainBlocks(Math.max(1, mainMin - revSpillMin), revisit),
        { kind: 'ment-practice', label: 'Mental Ability practice', minutes: sm(60), practiceSubtopicIds: scope, topics: [practiceTopic(scope)] },
      ];
      if (revSpill.topics.length > 0) recordFirstPass(day, revSpill.topics);
      if (slot.dow === 2 || slot.dow === 4) {
        blocks.push({ kind: 'telugu', label: 'Telugu script practice', minutes: sm(15) });
        day.teluguBlock = true;
      }
      blocks.push({ kind: 'revise', label: 'Revise (due cards + mistakes + spaced recall)', minutes: sm(20) });
      const caId = CA_ROTATION[slot.dow]!;
      blocks.push({ kind: 'ca', label: CA_LABEL[caId] ?? 'Current Affairs', minutes: sm(25), caSubtopicId: caId });
      day.caRevision = true;
      day.blocks = blocks;
      day.reviseSubtopicIds = mergeRevise(revisit?.topicIds ?? [], sweepByDate.get(slot.dateISO) ?? [], spacedReviseFor(slot.dateISO, firstPassByDate, isApOrBandA));
      if (revisit) setRevisitSubjectFields(day, revisit.subjectCode);
      finaliseBlocks(day, slot.budgetMin);
      days.push(day);
      continue;
    }

    if (slot.region === 'final') {
      // FINAL revision window (non-mock): MENT practice + targeted revision + CA refresh + Telugu.
      const covered = coveredMentUpTo(slot.dateISO);
      const blocks: PlanBlock[] = [];
      const scope = practiceScope(covered.length > 0 ? covered : mentList.map((s) => s.id));
      blocks.push({ kind: 'ment-practice', label: 'Mental Ability practice', minutes: sm(60), practiceSubtopicIds: scope, topics: [practiceTopic(scope)] });
      // Coverage SPILL (short-window fallback: the two post-coverage buffer days
      // land in the final window): teach any topic the packer could not seat as
      // block-legal subject blocks (first pass recorded once).
      const spill = spillBlocksFor(slot.dateISO);
      const spillTopics = spill.topics;
      if (spill.blocks.length > 0) {
        for (const b of spill.blocks) blocks.push(b);
        recordFirstPass(day, spillTopics);
      }
      blocks.push({ kind: 'targeted-revision', label: 'Targeted revision — weakest topics first, AP and high-yield topics', minutes: sm(120) });
      blocks.push({ kind: 'ca-refresh', label: 'Current Affairs / AP refresh', minutes: sm(45), caSubtopicId: 'ca-regional' });
      const telugu = slot.dow === 0 || slot.dow === 2 || slot.dow === 4;
      if (telugu) {
        blocks.push({ kind: 'telugu', label: 'Telugu script practice', minutes: sm(15) });
        day.teluguBlock = true;
      }
      day.blocks = blocks;
      day.caRefresh = true;
      day.reviseSubtopicIds = mergeRevise(spacedReviseFor(slot.dateISO, firstPassByDate, isApOrBandA), sweepByDate.get(slot.dateISO) ?? []);
      day.topics = [...spillTopics, practiceTopic(scope)];
      day.drillTarget = PRACTICE_QUESTIONS + spillTopics.reduce((a, t) => a + availableDrill(t.mcqCount), 0);
      finaliseBlocks(day, slot.budgetMin);
      // Fill the (surviving) targeted-revision block with this day's DEEPEN
      // top-ups — after finalise, so a trimmed-away block gets none and the
      // deepen minutes always sit inside the block's already-budgeted minutes.
      assignDeepenForDay(day, slot.dateISO);
      // NEVER-EMPTY (STANDARDS §8a, item 8): top up the targeted-revision block
      // with the marks-based default list (highest-yield, oldest-touched first)
      // so it always has topics at plan time; runtime weak areas replace these.
      fillTargetedRevisionDefaults(day, slot.dateISO);
      days.push(day);
      continue;
    }

    // ---- COVERAGE region ----
    day.phase = 'learn';
    const mainMin = mainCapFor(slot.dow, slot.budgetMin, slot.dateISO);
    // The main block(s): the current unit's topics, a UNIT WRAP-UP when a unit
    // finishes with room, the next unit when its first topic still fits, and a
    // 'Catch up or rest' filler for any remainder (STANDARDS §8a).
    const main = buildCoverageMainBlocks(slot.dateISO, mainMin);
    const ui = main.primaryUi;

    if (slot.dow === 0) {
      // SUNDAY: the WEEKLY SUBJECT UNIT main block(s) teaching the current unit —
      // then a 30-min Mental Ability practice set (STANDARDS §8a, item 2 — MENT
      // every day incl. Sunday, taken from the Sunday main block), then weekly
      // revision 60 + CA round-up 45 + Telugu 15. Once every unit is first-passed
      // the main block becomes an early consolidation revise block.
      const sunScope = practiceScope(coveredMentUpTo(slot.dateISO).length > 0 ? coveredMentUpTo(slot.dateISO) : mentList.map((s) => s.id));
      day.blocks = [
        ...main.blocks,
        { kind: 'ment-practice', label: 'Mental Ability practice', minutes: PRACTICE_MIN, practiceSubtopicIds: sunScope, topics: [practiceTopic(sunScope)] },
        { kind: 'weekly-revision', label: 'Weekly revision (mistakes + flashcards)', minutes: 30 },
        { kind: 'ca-roundup', label: 'Current Affairs weekly round-up', minutes: 45, caSubtopicId: 'ca-national' },
        { kind: 'telugu', label: 'Telugu script practice', minutes: 15 },
      ];
      day.teluguBlock = true;
      day.weeklyRevision = true;
      day.caRevision = true;
      recordFirstPass(day, main.topics);
      day.topics = main.topics;
      setUnitFields(day, ui);
      day.reviseSubtopicIds = coverageReviseIds(slot.dateISO);
      day.drillTarget = main.topics.reduce((a, t) => a + availableDrill(t.mcqCount), 0) + 15;
      finaliseBlocks(day, slot.budgetMin);
      days.push(day);
      continue;
    }

    // WEEKDAY (Mon–Fri) coverage.
    const blocks: PlanBlock[] = [];
    // WEEKDAY BLOCK ORDER (STANDARDS §8a): main subject block FIRST (new learning
    // while fresh), then Mental Ability, then Telugu (Tue/Thu), Revise, Current
    // Affairs. Day-1 orientation keeps its own order (handled above).
    // 1) MAIN BLOCK(s) — the CURRENT weekly subject unit (135, Tue/Thu 120); a
    //    unit continues day after day. When it finishes with room, a UNIT
    //    WRAP-UP consolidates it and the next unit may start in the same block;
    //    any remainder is a 'Catch up or rest' filler. Once every unit is
    //    first-passed the block becomes an early consolidation revise block.
    for (const b of main.blocks) blocks.push(b);
    // 2) MENT block (topic first-pass, else practice set).
    const mentTopics = mentByDate.get(slot.dateISO);
    if (mentTopics && mentTopics.length > 0) {
      const topics = mentTopics.map((s) => toTopic(s.id, 'full'));
      blocks.push({ kind: 'ment', label: 'Mental Ability', minutes: sm(60), subjectCode: 'MENT', topics, buildsOn: buildsOnFor(mentTopics[0]!.id, seqOrder, 'MENT', nameById) });
    } else {
      const covered = coveredMentUpTo(slot.dateISO);
      const scope = practiceScope(covered.length > 0 ? covered : mentList.map((s) => s.id));
      blocks.push({ kind: 'ment-practice', label: 'Mental Ability practice', minutes: sm(60), practiceSubtopicIds: scope, topics: [practiceTopic(scope)] });
    }
    // 3) Telugu (Tue/Thu only).
    if (slot.dow === 2 || slot.dow === 4) {
      blocks.push({ kind: 'telugu', label: 'Telugu script practice', minutes: sm(15) });
      day.teluguBlock = true;
    }
    // 4) Revise (spaced +3/+10/+21).
    blocks.push({ kind: 'revise', label: 'Revise (due cards + mistakes + spaced recall)', minutes: sm(20) });
    // 5) Current Affairs (rotation focus).
    const caId = CA_ROTATION[slot.dow]!;
    blocks.push({ kind: 'ca', label: CA_LABEL[caId] ?? 'Current Affairs', minutes: sm(25), caSubtopicId: caId });
    day.caRevision = true;

    day.blocks = blocks;

    // Legacy field mapping + topics union.
    const allTopics = [...(mentTopics?.map((s) => toTopic(s.id, 'full')) ?? []), ...main.topics];
    // CA first-pass topic (aptitude) counts toward today's first-pass set.
    const caFirst = caFirstPassByDate.get(slot.dateISO);
    if (caFirst) allTopics.push(toTopic(caFirst, 'quick'));
    recordFirstPass(day, allTopics);
    day.topics = allTopics;
    setUnitFields(day, ui);
    day.reviseSubtopicIds = coverageReviseIds(slot.dateISO);
    // Drill target: first-pass topic drillables + CA 15 (+ practice 15 when no MENT topic).
    let drill = allTopics.reduce((a, t) => a + availableDrill(t.mcqCount), 0) + 15;
    if (!mentTopics || mentTopics.length === 0) drill += 15;
    day.drillTarget = drill;
    finaliseBlocks(day, slot.budgetMin);
    days.push(day);
  }

  // ---- R1 (RE-AUDIT 2): EVERY unit keeps a wrap-up ------------------------
  // The coverage-close repair can reclaim a unit's wrap-up minutes to seat a
  // protected final topic, and a unit whose last topic exactly fills its block
  // leaves no idle room — either way a unit can finish WITHOUT a consolidation
  // wrap-up (the regression: 13 wrap-ups for 14 units, Art & Culture missing).
  // Guarantee EXACTLY ONE wrap-up per unit: (a) prefer the unit's own last
  // teaching day when it still has ≥ 30 free main-block minutes (reclaiming a
  // trailing 'Catch up or rest' filler); otherwise — the LAST unit whose wrap-up
  // cannot fit before coverage end — place it on the FIRST revision-cycle day,
  // carved from that day's revision block (STANDARDS §8a).
  {
    const wrapped = new Set<string>();
    for (const d of days) for (const b of d.blocks) if (b.kind === 'unit-wrapup' && b.unitId) wrapped.add(b.unitId);
    const dayByDate = new Map(days.map((d) => [d.dateISO, d] as const));
    const usedRevisionDates = new Set<string>();
    for (let ui = 0; ui < units.length; ui += 1) {
      const u = units[ui]!;
      if (wrapped.has(u.id)) continue;
      const run = unitDates[ui] ?? [];
      let placed = false;
      // (a) the unit's own teaching days, latest first, with free main-block room.
      for (let k = run.length - 1; k >= 0 && !placed; k -= 1) {
        const day = dayByDate.get(run[k]!);
        if (!day || day.segment !== 'coverage') continue;
        const catchup = day.blocks.find((b) => b.kind === 'catchup' && b.label === 'Catch up or rest');
        const avail = day.budgetMin - day.plannedMinutes + (catchup ? catchup.minutes : 0);
        if (avail < WRAPUP_MIN_IDLE_MIN) continue;
        const size = Math.min(avail, WRAPUP_MAX_MIN);
        if (catchup) day.blocks.splice(day.blocks.indexOf(catchup), 1);
        let subjIdx = -1;
        for (let bi = 0; bi < day.blocks.length; bi += 1) {
          const b = day.blocks[bi]!;
          if (b.kind === 'subject' && b.subjectCode === u.subjectCode) subjIdx = bi;
        }
        const at = subjIdx >= 0 ? subjIdx + 1 : day.blocks.length;
        day.blocks.splice(at, 0, unitWrapupBlock(ui, size, day.dateISO));
        day.plannedMinutes = day.blocks.reduce((a, b) => a + b.minutes, 0);
        wrapped.add(u.id);
        placed = true;
      }
      if (placed) continue;
      // (b) the FIRST free revision-cycle day with a revision block — carve a
      // 30-min wrap-up from that day's revision main block (never the final window).
      const revDay = days.find(
        (d) =>
          d.segment === 'revision' &&
          !usedRevisionDates.has(d.dateISO) &&
          d.blocks.some((b) => b.kind === 'targeted-revision'),
      );
      if (revDay) {
        const main = revDay.blocks.find((b) => b.kind === 'targeted-revision')!;
        const size = WRAPUP_MIN_IDLE_MIN; // a 30-min glance + review wrap-up
        main.minutes = Math.max(1, main.minutes - size);
        // Drop revisit topics that no longer fit the shrunk block (keep it legal).
        if (main.topics && main.topics.length > 0) {
          let sum = main.topics.filter((t) => t.kind === 'topic').reduce((a, t) => a + t.estMinutes, 0);
          while (main.topics.length > 0 && sum > main.minutes) {
            const popped = main.topics.pop()!;
            if (popped.kind === 'topic') sum -= popped.estMinutes;
          }
        }
        const idx = revDay.blocks.indexOf(main);
        revDay.blocks.splice(idx, 0, unitWrapupBlock(ui, size, revDay.dateISO));
        finaliseBlocks(revDay, revDay.budgetMin);
        usedRevisionDates.add(revDay.dateISO);
        wrapped.add(u.id);
      }
    }
  }

  // ---- Summary ------------------------------------------------------------
  const coverageEndISO = effectiveCoverageEndISO;

  // ---- Post-DEEPEN floor shortfall + feasibility options ------------------
  // A topic whose DEEPEN pass was scheduled MEETS its floor (its effective tier),
  // so it drops out of the reported shortfall. Only topics still below floor
  // after deepening remain in `infeasibleFloorTopicIds`.
  const deepenedSet = new Set(deepenAssignments.map((a) => a.id));
  const infeasibleFloorIdsFinal = infeasibleFloorIds.filter((id) => !deepenedSet.has(id));

  // Feasibility OPTIONS: suggest ONLY what actually changes the result, and ONLY
  // when the floor is still not met AFTER deepening. Search the Sunday budget
  // 360 → 600 in 30-min steps (never below the current Sunday budget), re-fit at
  // each, and report the MINIMUM extra Sunday time that meets the RAW depth floor
  // (a sufficient condition — a budget that meets the raw floor always meets the
  // deepened floor too); else fall back to moving the exam date. Empty when the
  // effective (post-deepen) floor is met — no "move the exam date" noise.
  const feasibilityOptions: string[] = [];
  if (infeasibleFloorIdsFinal.length > 0) {
    let feasibleAt: number | null = null;
    const searchStart = Math.max(360, weekendBudgetMin + 30);
    for (let sun = searchStart; sun <= 600; sun += 30) {
      const probe = computeFit(sun / 240);
      if (floorMet(probe.res, probe.pass, probe.deferred)) {
        feasibleAt = sun;
        break;
      }
    }
    if (feasibleAt !== null) {
      const addMin = feasibleAt - weekendBudgetMin;
      const label =
        addMin % 60 === 0
          ? `Add ${addMin / 60} h on Sundays (raise the Sunday budget to ${feasibleAt} min) — that meets the depth floor`
          : `Raise the Sunday budget to ${feasibleAt} min (+${addMin}) — that meets the depth floor`;
      feasibilityOptions.push(label);
    } else {
      feasibilityOptions.push('Move the exam date later to open more study days');
    }
  }

  const coverageTopics = days
    .filter((d) => d.segment === 'coverage')
    .flatMap((d) => d.topics.filter((t) => t.kind === 'topic'));
  const coverageP1Minutes = coverageTopics.filter((t) => t.track === 'theory').reduce((a, t) => a + t.estMinutes, 0);
  const coverageP2Minutes = coverageTopics.filter((t) => t.track === 'aptitude').reduce((a, t) => a + t.estMinutes, 0);
  const coverageTopicMinutes = coverageP1Minutes + coverageP2Minutes;
  const coverageP2SharePct =
    coverageTopicMinutes > 0 ? Math.round((coverageP2Minutes / coverageTopicMinutes) * 100) : 0;
  const firstPassMinutes = coverageTopicMinutes;

  const mentPracticeSets = days.reduce(
    (a, d) => a + d.blocks.filter((b) => b.kind === 'ment-practice').length,
    0,
  );

  const revisionMinutes = days.reduce(
    (a, d) => a + d.blocks.filter((b) => b.kind === 'revise' || b.kind === 'targeted-revision' || b.kind === 'weekly-revision').reduce((x, b) => x + b.minutes, 0),
    0,
  );

  // Fortnightly Mains answers scheduled (STANDARDS §8a, item 12) — revision cycle only.
  const weekendMainsCount = days.reduce(
    (a, d) => a + d.blocks.filter((b) => b.kind === 'mains-write').length,
    0,
  );

  const mockList = [...mockScheduleByDate.entries()]
    .filter(([dateISO]) => diffDaysISO(todayISO, dateISO) >= 0 && diffDaysISO(dateISO, examDateISO) >= 0)
    .map(([dateISO, m]) => ({ dateISO, paper: m.paper, mockNumber: m.num, kind: m.kind }))
    .sort((a, b) => a.dateISO.localeCompare(b.dateISO));
  // Full-mock SITTINGS = full + dress-rehearsal days (phase 'mock'); week tests
  // are a separate, lighter event and do NOT consume the non-repeating series.
  const mockSittings = days.filter((d) => d.phase === 'mock').length;
  const weekTests = mockList.filter((m) => m.kind === 'week-test').length;
  const dressRehearsalISO = mockList.find((m) => m.kind === 'dress-rehearsal')?.dateISO ?? '';
  // Full-mock sittings per paper (dress + revision + final) vs the non-repeating
  // capacity (`mockSeriesLength`). `fullMockPaperCounts` lets the UI honestly
  // report "N sittings on Paper-X of M non-repeating" and keep the wrap flag.
  const fullMockPaperCounts: Record<PaperId, number> = { paper1: 0, paper2: 0 };
  for (const m of mockList) if (m.kind !== 'week-test') fullMockPaperCounts[m.paper] += 1;

  // Per-subject FULL/STANDARD/QUICK fit report.
  const lastFirstPass: Record<string, string> = {};
  const fullCount: Record<string, number> = {};
  const standardCount: Record<string, number> = {};
  const quickCount: Record<string, number> = {};
  for (const code of SUBJECT_ORDER) {
    lastFirstPass[code] = '';
    fullCount[code] = 0;
    standardCount[code] = 0;
    quickCount[code] = 0;
  }
  for (const p of [...placements, ...spillPlacements]) {
    if (p.dateISO > (lastFirstPass[p.subjectCode] ?? '')) lastFirstPass[p.subjectCode] = p.dateISO;
    if (p.pass === 'full') fullCount[p.subjectCode]! += 1;
    else if (p.pass === 'standard') standardCount[p.subjectCode]! += 1;
    else quickCount[p.subjectCode]! += 1;
  }
  const spillBySubject = new Map(spills.map((s) => [s.subject, s] as const));
  // A deepened floor topic MEETS its floor, so it is excluded from the reported
  // quick-floor set exactly as it is excluded from infeasibleFloorTopicIds.
  const infeasibleFloorSet = new Set(infeasibleFloorIdsFinal);
  const subjectFit: SubjectFit[] = SUBJECT_ORDER.map((code) => ({
    subject: code,
    total: subjectLists[code]!.length,
    full: fullCount[code]!,
    standard: standardCount[code]!,
    quick: quickCount[code]!,
    lastFirstPassISO: lastFirstPass[code]!,
    spill: spillBySubject.has(code),
    spillTopicIds: spillBySubject.get(code)?.topicIds ?? [],
    reallocatedFromISO: reallocatedInto[code]!,
    floorTotal: subjectLists[code]!.filter(isFloorTopic).length,
    quickFloorTopicIds: subjectLists[code]!
      .filter((s) => infeasibleFloorSet.has(s.id))
      .map((s) => s.id),
    newTopicMinutes: subjectMinutes(code),
  }));

  // ---- WEEKLY SUBJECT UNITS read-out --------------------------------------
  // Each unit's calendar window (first → last coverage day its main block runs)
  // and topic count, in teaching order, for the Planner unit timeline.
  const unitsSummary = units.map((u, ui) => {
    const run = unitDates[ui]!;
    return {
      id: u.id,
      title: u.title,
      subjectCode: u.subjectCode,
      startISO: run[0] ?? '',
      endISO: run[run.length - 1] ?? '',
      topicCount: u.topics.length,
    };
  });

  // PAPER-I (theory) new-topic minutes per subject + each subject's whole-percent
  // share of the Paper-I total (the 20–32% balance read-out; History is
  // structurally the largest, Geography the smallest — see the design spec).
  const paperOneMinutesBySubject: Record<string, number> = {};
  for (const code of SUBJECT_ORDER) if (subjectIsP1[code]) paperOneMinutesBySubject[code] = subjectMinutes(code);
  const paperOneTotalMinutes = Object.values(paperOneMinutesBySubject).reduce((a, m) => a + m, 0);
  const paperOneSharePctBySubject: Record<string, number> = {};
  for (const [code, m] of Object.entries(paperOneMinutesBySubject)) {
    paperOneSharePctBySubject[code] =
      paperOneTotalMinutes > 0 ? Math.round((m / paperOneTotalMinutes) * 100) : 0;
  }

  // FEASIBLE = no topic ABOVE the QUICK tier spills, and no AP / band-A topic
  // spills. A short QUICK-only tail of the lowest-priority non-protected topics
  // may land in the Thu 5 / Fri 6 buffer at a tight budget — that is by design
  // (the plan still teaches everything at ≥ QUICK), so it does NOT make the plan
  // infeasible. Only an ABOVE-QUICK or protected spill is a true shortfall.
  const aboveFloorSpills = genuineSpillPlacements.filter((p) => {
    const s = byId.get(p.id);
    return p.pass !== 'quick' || (s !== undefined && isProtected(s));
  });
  // FEASIBLE when no above-QUICK/protected topic spills AND the depth floor is
  // met AFTER the final-window DEEPEN passes (a below-floor topic whose deepen is
  // scheduled counts as meeting its floor). At 240 weekday + 360 Sunday the whole
  // 17-topic tail is deepened, so the plan is feasible; at 240/240 the final
  // window cannot deepen every below-floor topic, so a shortfall remains.
  const feasible = aboveFloorSpills.length === 0 && infeasibleFloorIdsFinal.length === 0;
  const shortfallHours = feasible
    ? 0
    : Math.ceil(
        aboveFloorSpills.reduce((a, p) => {
          const s = byId.get(p.id);
          return a + (s ? passMinutes(s, p.pass) : 0);
        }, 0) / 60,
      );

  const studyDays = days.filter((d) => d.plannedMinutes > 0);
  const plannedSum = studyDays.reduce((a, d) => a + d.plannedMinutes, 0);
  const avgStudyDayMinutes = studyDays.length > 0 ? Math.round(plannedSum / studyDays.length) : 0;
  const maxStudyDayMinutes = studyDays.reduce((m, d) => Math.max(m, d.plannedMinutes), 0);

  // Coverage-window day counts (cosmetic, for the view surface).
  const coverageDays = slots.filter((s) => s.region === 'coverage').length;
  const revisionDays = slots.filter((s) => s.region === 'revision').length;
  const finalRegionDays = slots.filter((s) => s.region === 'final').length;
  const finalDays = slots.filter((s) => s.region === 'final' || s.region === 'light' || s.region === 'exam').length;
  const finalMockDays = days.filter((d) => d.phase === 'mock' && regionFor(d.dateISO) === 'final').length;
  const learnDaysLeft = coverageDays;

  const theoryUnstudied = Math.max(0, ctx.theoryTotal - ctx.theoryStudied);
  const aptitudeUnstudied = Math.max(0, ctx.aptitudeTotal - ctx.aptitudeStudied);
  const perDay = (u: number): number => (u <= 0 ? 0 : learnDaysLeft > 0 ? Math.ceil(u / learnDaysLeft) : u);

  // Projected finish = the last first-pass date across all subjects (+ spill).
  const projectedFinishISO = [...Object.values(lastFirstPass), mentAllPassedISO]
    .filter((d) => d !== '')
    .sort()
    .pop() ?? todayISO;

  return {
    days,
    summary: {
      examDateISO,
      daysTotal: ctx.daysTotal,
      daysLeft: ctx.daysLeft,
      learnDaysLeft,
      rhythm: true,
      coverageDays,
      revisionDays,
      finalDays,
      mockSittings,
      postPrelims: false,
      dailyBudgetMin,
      weekendBudgetMin,
      firstPassMinutes,
      coverageP1Minutes,
      coverageP2Minutes,
      coverageP2SharePct,
      mentPracticeSets,
      revisionMinutes,
      bufferDays: Math.max(0, finalRegionDays - finalMockDays),
      avgStudyDayMinutes,
      maxStudyDayMinutes,
      weekendMainsCount,
      feasible,
      shortfallHours,
      fastBands: [],
      fastBandBTopicIds: [],
      feasibilityOptions,
      deferredItems: ['English & General Essay (after Prelims)', 'Mains answer practice (after Prelims)'],
      recovery: recoveryActive,
      daysBehind: ctx.daysBehind,
      recoveryChanges,
      theoryTotal: ctx.theoryTotal,
      theoryStudied: ctx.theoryStudied,
      aptitudeTotal: ctx.aptitudeTotal,
      aptitudeStudied: ctx.aptitudeStudied,
      prelimsTotal: ctx.prelimsTotal,
      prelimsStudied: ctx.prelimsStudied,
      prelimsMastered: ctx.prelimsMastered,
      prelimsWithMaterial: ctx.prelimsWithMaterial,
      prelimsCoveragePct: ctx.prelimsCoveragePct,
      prelimsMaterialCoveragePct: ctx.prelimsMaterialCoveragePct,
      prelimsMasteryPct: ctx.prelimsMasteryPct,
      theoryPerDay: perDay(theoryUnstudied),
      aptitudePerDay: perDay(aptitudeUnstudied),
      expectedStudiedByToday: 0,
      onTrack: true,
      behindBy: 0,
      projectedFinishISO,
      subjectFit,
      units: unitsSummary,
      mentAllPassedISO,
      mockList,
      weekTests,
      dressRehearsalISO,
      fullMockPaperCounts,
      reallocations,
      coverageEndISO,
      spills,
      infeasibleFloorTopicIds: infeasibleFloorIdsFinal,
      deepenTopicIds: deepenAssignments,
      paperOneMinutesBySubject,
      paperOneSharePctBySubject,
      mainsSubjectsTotal: ctx.mainsSubjectsTotal,
      mainsQuestionsTotal: ctx.mainsQuestionsTotal,
      mainsPerDay: 0,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Rhythm helpers                                                              */
/* -------------------------------------------------------------------------- */

/** One coverage subject-slot (a weekday or Sunday) with its owner + base minutes. @internal */
interface SubjectSlotInfo {
  dateISO: string;
  dow: number;
  owner: string;
  baseMin: number;
  subjectCode: string; // owner (for base-minute accounting)
}

/** Enumerate the coverage weekday + Sunday subject-slots (Saturdays are mocks). @internal */
function coverageSubjectSlots(slots: readonly DaySlot[]): SubjectSlotInfo[] {
  const out: SubjectSlotInfo[] = [];
  for (const s of slots) {
    if (s.region !== 'coverage' || s.isMock || s.preStart || s.dayOff) continue;
    if (s.dow >= 1 && s.dow <= 5) {
      const owner = SUBJECT_BY_DOW[s.dow]!;
      out.push({ dateISO: s.dateISO, dow: s.dow, owner, baseMin: SUBJECT_BASE_MIN[s.dow]!, subjectCode: owner });
    } else if (s.dow === 0) {
      // Sunday catch-up → History (120 base).
      out.push({ dateISO: s.dateISO, dow: 0, owner: 'HIST', baseMin: 120, subjectCode: 'HIST' });
    }
    // Saturdays in coverage are mock days (handled separately).
  }
  return out;
}

/** Fallback per-subject order (sequence absent): group + sort by `order`. @internal */
function deriveSequenceOrder(prelims: readonly PlanSubtopic[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const bySubject = new Map<string, PlanSubtopic[]>();
  for (const s of prelims) {
    const arr = bySubject.get(s.subjectCode) ?? [];
    arr.push(s);
    bySubject.set(s.subjectCode, arr);
  }
  for (const [code, arr] of bySubject) {
    out[code] = arr.slice().sort((a, b) => a.order - b.order).map((s) => s.id);
  }
  return out;
}

/** The previous topic name in a subject's sequence (for the "builds on" line). @internal */
function buildsOnFor(
  id: string | undefined,
  seqOrder: Readonly<Record<string, readonly string[]>>,
  subjectCode: string,
  nameById: (id: string) => string,
): string | undefined {
  if (!id) return undefined;
  const ids = seqOrder[subjectCode] ?? [];
  const i = ids.indexOf(id);
  if (i > 0) return nameById(ids[i - 1]!);
  return undefined;
}

/** Topics first-passed 3 and 10 days ago, plus AP/band-A topics 21 days ago. @internal */
function spacedReviseFor(
  dateISO: string,
  firstPassByDate: ReadonlyMap<string, string[]>,
  isApOrBandA: (id: string) => boolean,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (id: string): void => {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  };
  for (const off of [3, 10]) {
    const prior = firstPassByDate.get(addDaysISO(dateISO, -off));
    if (prior) for (const id of prior) add(id);
  }
  const prior21 = firstPassByDate.get(addDaysISO(dateISO, -21));
  if (prior21) for (const id of prior21) if (isApOrBandA(id)) add(id);
  return out;
}

/** Split a day's first-pass topics into the legacy theory/aptitude id lists. @internal */
function recordFirstPass(day: PlanDay, topics: readonly PlanTopic[]): void {
  for (const t of topics) {
    if (t.kind !== 'topic') continue;
    if (t.track === 'theory') day.theorySubtopicIds.push(t.subtopicId);
    else day.aptitudeSubtopicIds.push(t.subtopicId);
  }
}

/**
 * Sum the day's block minutes into `plannedMinutes`, trimming the LAST block if
 * rounding pushed the total over the day's budget. A block that TEACHES topics
 * is never trimmed BELOW the sum of its own topics' minutes (that would make the
 * block claim fewer minutes than it needs — the buffer-overflow bug): such a
 * block is POPPED whole instead, so every surviving block stays coherent
 * (block minutes ≥ its topics' minutes). @internal
 */
function finaliseBlocks(day: PlanDay, budgetMin: number): void {
  const topicMinutesOf = (b: PlanBlock): number =>
    (b.topics ?? []).filter((t) => t.kind === 'topic').reduce((a, t) => a + t.estMinutes, 0);
  let sum = day.blocks.reduce((a, b) => a + b.minutes, 0);
  while (sum > budgetMin && day.blocks.length > 0) {
    const over = sum - budgetMin;
    const last = day.blocks[day.blocks.length - 1]!;
    const floor = topicMinutesOf(last); // never trim a block below the minutes its topics need
    const trim = Math.min(over, last.minutes - Math.max(1, floor));
    if (trim <= 0) {
      day.blocks.pop();
      sum = day.blocks.reduce((a, b) => a + b.minutes, 0);
    } else {
      last.minutes -= trim;
      sum -= trim;
    }
  }
  day.plannedMinutes = sum;
}

/** A blank rhythm day skeleton with neutral defaults. @internal */
function blankDay(slot: DaySlot, status: PlanDayStatus): PlanDay {
  const day: PlanDay = {
    dateISO: slot.dateISO,
    dayIndex: slot.dayIndex,
    phase: slot.region === 'coverage' ? 'learn' : 'revise',
    segment:
      slot.region === 'coverage'
        ? 'coverage'
        : slot.region === 'revision'
          ? 'revision'
          : 'final',
    blocks: [],
    theorySubtopicIds: [],
    aptitudeSubtopicIds: [],
    reviseSubtopicIds: [],
    mainsQuestionIds: [],
    mockPaper: null,
    mockNumber: 0,
    sectionalMock: false,
    caRefresh: false,
    caRevision: false,
    languageBlock: null,
    essayPractice: false,
    teluguBlock: false,
    weeklyRevision: false,
    light: false,
    dayOff: false,
    budgetMin: slot.budgetMin,
    plannedMinutes: 0,
    drillTarget: 0,
    topics: [],
    unitId: null,
    unitTitle: null,
    unitSubjectCode: null,
    unitDay: 0,
    unitDays: 0,
    nextUnitTitle: null,
    status,
  };
  return day;
}

/**
 * Build the POST-PRELIMS MAINS kick-start plan: once the exam has passed the
 * plan flips to descriptive-Mains preparation instead of ending. It lays out
 * {@link POST_PRELIMS_HORIZON_DAYS} days from today, each carrying the daily
 * mains question quota, the alternate-day qualifying-language block, and the
 * weekly General Essay — the qualifying work DEFERRED during the prelims push.
 * All the prelims read-out fields are passed through (so the views can still
 * show what was covered), but the deadline math is inert. @internal
 */
function buildPostPrelims(p: {
  todayISO: string;
  examDateISO: string;
  dailyBudgetMin: number;
  weekendBudgetMin: number;
  postMainsPerDay: number;
  mainsSliceFor: (dayIndex: number, count: number) => string[];
  mainsPapers: readonly PlanMainsPaper[];
  theoryTotal: number;
  aptitudeTotal: number;
  theoryStudied: number;
  aptitudeStudied: number;
  prelimsTotal: number;
  prelimsStudied: number;
  prelimsMastered: number;
  prelimsWithMaterial: number;
  prelimsCoveragePct: number;
  prelimsMaterialCoveragePct: number;
  prelimsMasteryPct: number;
  mainsSubjectsTotal: number;
  mainsQuestionsTotal: number;
}): Plan {
  const days: PlanDay[] = [];
  for (let di = 0; di < POST_PRELIMS_HORIZON_DAYS; di += 1) {
    const dateISO = addDaysISO(p.todayISO, di);
    const budgetMin = isWeekendISO(dateISO) ? p.weekendBudgetMin : p.dailyBudgetMin;
    const mainsIds = p.mainsSliceFor(di, p.postMainsPerDay);
    const caRefresh = di % 3 === 0; // keep current-affairs warm for the Mains essay
    const languageBlock: LanguageBlock = di % 2 === 0 ? 'telugu' : 'english';
    const essayPractice = di % 7 === 6;
    // POST-PRELIMS "Mains revision of what you studied" (STANDARDS §8a): the first
    // 4 weeks do one Mains paper (I–V) per day, round-robin — revisit that
    // paper's mapped Prelims subtopics' For-Mains notes + write their answers.
    const mainsPaperRevision: PlanMainsPaper | null =
      p.mainsPapers.length > 0 && di < POST_PRELIMS_MAINS_REVISION_DAYS
        ? p.mainsPapers[di % p.mainsPapers.length]!
        : null;
    const plannedMinutes = Math.min(
      budgetMin,
      (mainsPaperRevision ? TIME.caRefresh + TIME.mainsAnswer : 0) +
        mainsIds.length * TIME.mainsAnswer +
        (caRefresh ? TIME.caRefresh : 0) +
        TIME.languageBlock +
        (essayPractice ? TIME.essay : 0),
    );
    days.push({
      dateISO,
      dayIndex: di,
      phase: 'mains',
      segment: 'post-prelims',
      blocks: [],
      theorySubtopicIds: [],
      aptitudeSubtopicIds: [],
      reviseSubtopicIds: [],
      mainsQuestionIds: mainsIds,
      mockPaper: null,
      mockNumber: 0,
      sectionalMock: false,
      caRefresh,
      caRevision: false,
      languageBlock,
      essayPractice,
      teluguBlock: false,
      weeklyRevision: false,
      light: false,
      dayOff: false,
      budgetMin,
      plannedMinutes,
      drillTarget: 0,
      topics: [],
      unitId: null,
      unitTitle: null,
      unitSubjectCode: null,
      unitDay: 0,
      unitDays: 0,
      nextUnitTitle: null,
      mainsPaperRevision,
      status: di === 0 ? 'today' : 'upcoming',
    });
  }

  return {
    days,
    summary: {
      examDateISO: p.examDateISO,
      daysTotal: 0,
      daysLeft: 0,
      learnDaysLeft: 0,
      rhythm: false,
      coverageDays: 0,
      revisionDays: 0,
      finalDays: 0,
      mockSittings: 0,
      postPrelims: true,
      dailyBudgetMin: p.dailyBudgetMin,
      weekendBudgetMin: p.weekendBudgetMin,
      firstPassMinutes: 0,
      coverageP1Minutes: 0,
      coverageP2Minutes: 0,
      coverageP2SharePct: 0,
      mentPracticeSets: 0,
      revisionMinutes: 0,
      bufferDays: 0,
      avgStudyDayMinutes: 0,
      maxStudyDayMinutes: 0,
      weekendMainsCount: 0,
      feasible: true,
      shortfallHours: 0,
      fastBands: [],
      fastBandBTopicIds: [],
      feasibilityOptions: [],
      deferredItems: [],
      recovery: false,
      daysBehind: 0,
      recoveryChanges: [],
      theoryTotal: p.theoryTotal,
      theoryStudied: p.theoryStudied,
      aptitudeTotal: p.aptitudeTotal,
      aptitudeStudied: p.aptitudeStudied,
      prelimsTotal: p.prelimsTotal,
      prelimsStudied: p.prelimsStudied,
      prelimsMastered: p.prelimsMastered,
      prelimsWithMaterial: p.prelimsWithMaterial,
      prelimsCoveragePct: p.prelimsCoveragePct,
      prelimsMaterialCoveragePct: p.prelimsMaterialCoveragePct,
      prelimsMasteryPct: p.prelimsMasteryPct,
      theoryPerDay: 0,
      aptitudePerDay: 0,
      expectedStudiedByToday: p.prelimsTotal,
      onTrack: true,
      behindBy: 0,
      projectedFinishISO: p.todayISO,
      subjectFit: [],
      units: [],
      mentAllPassedISO: '',
      mockList: [],
      weekTests: 0,
      dressRehearsalISO: '',
      fullMockPaperCounts: { paper1: 0, paper2: 0 },
      reallocations: [],
      coverageEndISO: computePlanAnchors(p.examDateISO, p.todayISO).coverageEndISO,
      spills: [],
      infeasibleFloorTopicIds: [],
      deepenTopicIds: [],
      paperOneMinutesBySubject: {},
      paperOneSharePctBySubject: {},
      mainsSubjectsTotal: p.mainsSubjectsTotal,
      mainsQuestionsTotal: p.mainsQuestionsTotal,
      mainsPerDay: p.postMainsPerDay,
    },
  };
}

/** Find the plan day for an ISO date, or `undefined` when out of window. */
export function planDayFor(plan: Plan, dateISO: string): PlanDay | undefined {
  return plan.days.find((d) => d.dateISO === dateISO);
}

/**
 * A short, human PRELIMS feasibility line for the header, e.g.
 * `Prelims: 88 theory + 29 aptitude topics · 47 days to exam · fixed weekly rhythm · On track`.
 */
export function feasibilityLine(s: PlanSummary): string {
  const topics = `Prelims: ${s.theoryTotal} theory + ${s.aptitudeTotal} aptitude topics`;
  const days = `${s.daysLeft} day${s.daysLeft === 1 ? '' : 's'} to exam`;

  if (s.postPrelims) return `${topics} · Prelims done — Mains kick-start mode`;
  if (s.daysLeft <= 0) return `${topics} · exam day has passed`;
  if (!s.feasible) {
    const spilled = s.spills.map((sp) => sp.subject).join(', ');
    const spillBy = s.spills[0]?.lastDateISO ?? s.examDateISO;
    return `${topics} · ${days} · fixed weekly rhythm · ${spilled} spills to ${spillBy}`;
  }
  return `${topics} · ${days} · fixed weekly rhythm · On track`;
}
