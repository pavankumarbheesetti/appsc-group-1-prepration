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
import type { LearningStream } from '../content/plan-types';
import type { PaperId } from '../lib/exam-pattern';
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
  | 'weekly-revision'
  | 'ca-roundup'
  | 'telugu'
  | 'targeted-revision'
  | 'ca-refresh'
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
  /** For a `ca`/`ca-refresh`/`ca-roundup` block: its focus CA subtopic id. */
  caSubtopicId?: string;
  /** Previous topic name in the same subject's sequence (Today view). */
  buildsOn?: string;
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
  /** Date all MENT topics were first-passed (`''` when none). */
  mentAllPassedISO: string;
  /** The full mock schedule (date → paper + per-paper series number). */
  mockList: Array<{ dateISO: string; paper: PaperId; mockNumber: number }>;
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
}

/** Options for {@link buildPlan}. */
export interface BuildPlanOpts {
  subtopics: readonly PlanSubtopic[];
  progress: PlannerProgress;
  /** The mains question bank (ids) the post-prelims daily quota cycles through. */
  mainsQuestionIds?: readonly string[];
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

/** Default daily study-time budget (minutes) for a working professional — 4 h. */
export const DEFAULT_DAILY_BUDGET_MIN = 240;

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

/** A scheduled mock: its paper + 1-based per-paper series number. */
export interface ScheduledMock {
  paper: PaperId;
  num: number;
}

/**
 * Build the full mock schedule (date → paper + per-paper series number) DERIVED
 * from the plan start + anchors — never a hardcoded calendar. Pure.
 *
 *  - COVERAGE + REVISION: one full mock every Saturday from the first Saturday
 *    on/after plan start until the final window, alternating Paper-II / Paper-I
 *    starting with Paper-II.
 *  - FINAL WINDOW: full mocks on 3 days a week (Tue / Thu / Sat), alternating
 *    Paper-I / Paper-II. (Short window: weekly Saturdays only — the old shape.)
 *
 * Each paper draws the NON-REPEATING series (see `engine/mock.ts`): mock N takes
 * the Nth disjoint window of a stable shuffle. When N exceeds the pool-supported
 * `mockSeriesLength`, that section WRAPS and is flagged `wrapped` (the UI
 * surfaces the reuse); a sectional mock is the alternative. The planner only
 * assigns the numbers — it does not know the pool sizes.
 */
export function buildMockSchedule(
  planStartISO: string,
  a: PlanAnchors,
): Map<string, ScheduledMock> {
  const paperByDate = new Map<string, PaperId>();
  // 1) Saturday series across coverage + revision (strictly before the final window).
  let alt = 0;
  for (let d = firstDowOnOrAfter(planStartISO, 6); d < a.finalStartISO; d = addDaysISO(d, 7)) {
    paperByDate.set(d, alt % 2 === 0 ? 'paper2' : 'paper1'); // start Paper-II
    alt += 1;
  }
  // 2) Final-window mocks.
  if (a.shortWindow) {
    // Old compressed shape: weekly Saturdays inside the (short) final window.
    for (let d = firstDowOnOrAfter(a.finalStartISO, 6); d < a.lightISO; d = addDaysISO(d, 7)) {
      paperByDate.set(d, alt % 2 === 0 ? 'paper2' : 'paper1');
      alt += 1;
    }
  } else {
    // 3 mocks a week on Tue/Thu/Sat, alternating Paper-I / Paper-II.
    let fAlt = 0;
    for (let d = a.finalStartISO; d < a.lightISO; d = addDaysISO(d, 1)) {
      const dow = dayOfWeekISO(d);
      if (dow === 2 || dow === 4 || dow === 6) {
        paperByDate.set(d, fAlt % 2 === 0 ? 'paper1' : 'paper2'); // start Paper-I
        fAlt += 1;
      }
    }
  }
  // 3) Assign per-paper series numbers ascending by date (stable, deterministic).
  const out = new Map<string, ScheduledMock>();
  const counter: Record<PaperId, number> = { paper1: 0, paper2: 0 };
  for (const dateISO of [...paperByDate.keys()].sort()) {
    const paper = paperByDate.get(dateISO)!;
    counter[paper] += 1;
    out.set(dateISO, { paper, num: counter[paper] });
  }
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
  // The full mock schedule, derived from the plan start + anchors.
  const mockNumberByDate = buildMockSchedule(opts.startISO, anchors);

  const slots: DaySlot[] = [];
  for (let di = 0; di < totalDays; di += 1) {
    const dateISO = addDaysISO(todayISO, di);
    const dow = dayOfWeekISO(dateISO);
    const region = regionFor(dateISO);
    const mock = mockNumberByDate.get(dateISO);
    const isMock = region !== 'exam' && region !== 'light' && mock !== undefined;
    slots.push({
      dateISO,
      dayIndex: di,
      dow,
      region,
      isMock,
      mockPaper: isMock ? mock!.paper : null,
      mockNumber: isMock ? mock!.num : 0,
      // Only SUNDAY carries the (larger) Sunday budget; SATURDAY is a mock day
      // and simply follows the daily budget.
      budgetMin: region === 'exam' ? 0 : dow === 0 ? weekendBudgetMin : dailyBudgetMin,
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

  // ---- OWN CAPACITY (§1) ---------------------------------------------------
  // Each subject's capacity C_s = the sum of ITS OWN weekday subject-block base
  // minutes from 30 Sep → 4 Nov (HIST Mon, POL Tue, ECON Wed, GEO Thu, SCI Fri).
  // The SUNDAY POOL P is ALL of the Sunday STUDY minutes over the same range —
  // `(sundayBudget − 120 fixed) × #coverage-Sundays` — so a bigger Sunday budget
  // really buys more depth (defect 3: the pool must SCALE with the Sunday budget,
  // not sit at a fixed 600). Computed inside `computeFit` from `weekendScale` so
  // the option probes re-fit at a higher budget. `numCoverageSundays` is the
  // count of Sunday study slots in the coverage window.
  const ownCapacity: Record<string, number> = {};
  for (const code of SUBJECT_ORDER) ownCapacity[code] = 0;
  let numCoverageSundays = 0;
  for (const slot of subjectSlots) {
    if (slot.dow === 0) numCoverageSundays += 1;
    else ownCapacity[slot.owner] = (ownCapacity[slot.owner] ?? 0) + slot.baseMin;
  }

  // ---- HISTORY TWO STREAMS (defect 1: priority inversion) ------------------
  // History is scheduled as TWO parallel chronological streams so its high-yield
  // Modern + AP topics no longer land last. Monday advances H-early (ancient +
  // medieval + AP early dynasties); Sunday advances H-modern (modern + AP
  // freedom/statehood + art & culture). Each stream stays strictly in its OWN
  // order (cross-stream prereqs not required); a donated/pooled slot feeds
  // whichever stream carries the higher-priority unmet depth. Absent stream tags
  // (unit fixtures) → a single `early` chain (the historical single-chain path).
  const histStreamTag = opts.sequence?.histStreams ?? {};
  const histAll = subjectLists['HIST'] ?? [];
  const histEarlySrc = histAll.filter((s) => (histStreamTag[s.id] ?? 'early') !== 'modern');
  const histModernSrc = histAll.filter((s) => histStreamTag[s.id] === 'modern');

  // Budget SCALES the packing CAPACITY (not just the display, defect 3): weekday
  // blocks scale with the DAILY budget, the Sunday catch-up block with the
  // WEEKEND budget — so a bigger weekend budget really seats more Sunday topics.
  // `weekendScale` is a parameter so option probes can re-fit at a higher budget.
  const dailyScale = dailyBudgetMin / 240;
  const slotCap = (slot: SubjectSlotInfo, weekendScale: number): number =>
    slot.dow === 0 ? Math.round(120 * weekendScale) : Math.round(slot.baseMin * dailyScale);

  // ---- SUNDAY SHAPE (two study blocks) ------------------------------------
  // A Sunday's fixed slots are weekly revision (60) + CA round-up (45) + Telugu
  // (15) = 120 min. The remaining budget is the STUDY window, split into:
  //   • a Modern-History block (H-modern) — History 120–240, and
  //   • a Polity block (Polity's SECOND weekly slot) — Polity 60–120.
  // POLITY IS CUT FIRST below the 360-min default (at 240 the previous shape:
  // 120 H-modern only, no Polity block). Above 360 the SURPLUS goes to Modern
  // HISTORY (defect 3: H-modern was hard-capped at 120, so a bigger Sunday
  // budget only grew Polity — already all-FULL — and bought no History depth).
  // `weekendScale` = weekendBudgetMin / 240 (probeable at +60/+120).
  const SUNDAY_FIXED_MIN = 120; // weekly revision 60 + CA round-up 45 + Telugu 15
  const SUNDAY_POL_CAP = 120; // Polity's 2nd slot never exceeds 120 (its own weekday base)
  const sundayStudyCap = (weekendScale: number): number =>
    Math.max(0, Math.round(240 * weekendScale) - SUNDAY_FIXED_MIN);
  // Polity gets the first 60–120 of study ABOVE the 120-min H-modern floor, then
  // is capped at 120; everything else (the surplus) is Modern History's.
  const sunPolCap = (weekendScale: number): number => {
    const study = sundayStudyCap(weekendScale);
    return study <= 120 ? 0 : Math.min(SUNDAY_POL_CAP, study - 120);
  };
  const sunHmodCap = (weekendScale: number): number =>
    Math.max(0, sundayStudyCap(weekendScale) - sunPolCap(weekendScale));


  // Depth priority within a subject: AP first, then band A, then PYQ desc, then
  // examPoints desc — the ordering OWN-FILL, POOL and stream-selection respect.
  const depthPriority = (a: PlanSubtopic, b: PlanSubtopic): number => {
    const ap = (isAP(a) ? 0 : 1) - (isAP(b) ? 0 : 1);
    if (ap !== 0) return ap;
    const ba = (a.band === 'A' ? 0 : 1) - (b.band === 'A' ? 0 : 1);
    if (ba !== 0) return ba;
    const pq = (pyq[b.id] ?? 0) - (pyq[a.id] ?? 0);
    if (pq !== 0) return pq;
    return (b.examPointCount ?? 0) - (a.examPointCount ?? 0);
  };
  const cmpKey = (a: number[], b: number[]): number => {
    for (let i = 0; i < a.length; i += 1) {
      if (a[i]! < b[i]!) return -1;
      if (a[i]! > b[i]!) return 1;
    }
    return 0;
  };
  // PROTECTED-FROM-SPILL topics must ALWAYS be placed IN-WINDOW (never deferred
  // to the buffer): AP (always FULL) and every band-A topic. The STANDARD-tier
  // depth floor (POL/ECON/GEO/SCI + History PYQ/band-B topics) is a strong TARGET
  // — kept via the downgrade guard while topics fit — but it YIELDS to AP/band-A
  // placement: when block COUNT forces it, the lowest-priority floor topics are
  // sacrificed to QUICK in the buffer and REPORTED, so AP/band-A are never
  // starved. Only AP + band A are structurally unspillable.
  const isProtected = (s: PlanSubtopic): boolean => isAP(s) || s.band === 'A';
  // A topic may be DOWNGRADED to fit only while it stays AT OR ABOVE its floor —
  // its current pass must outrank its floor tier. This keeps AP FULL, band A
  // FULL, and POL/ECON/GEO/SCI + History-PYQ topics ≥ STANDARD, while still
  // letting an over-deepened topic shed a tier down to (never below) its floor.
  const canDowngrade = (s: PlanSubtopic, pass: ReadonlyMap<string, PlanPass>): boolean =>
    PASS_RANK[pass.get(s.id)!] > PASS_RANK[floorTier(s)];

  // ---- OWN FILL (§2) — depth-v3, base capacity (budget-independent target) --
  // Start every topic at QUICK; a topic whose FULL pass is no costlier than QUICK
  // is simply FULL. Then upgrade WITHIN the subject in depth-priority order — AP
  // to FULL (always), then floor→STANDARD, floor→FULL, non-floor→STANDARD,
  // non-floor→FULL — each step only while the subject's OWN total stays ≤ its
  // capacity C_s. Returns a FRESH map so the fit can be recomputed for option
  // probes. Deterministic. @internal
  const buildDepthTarget = (): Map<string, PlanPass> => {
    const pass = new Map<string, PlanPass>();
    for (const s of allSubjectTopics) {
      // Seed each topic at its DEPTH FLOOR (never below): AP/band-A → FULL,
      // POL/ECON/GEO/SCI + History-PYQ/band-B → STANDARD, PYQ-0 band-C/D → QUICK.
      // A topic whose FULL pass is no costlier than QUICK is simply FULL.
      const seed: PlanPass = isAP(s) || fullMin(s) <= QUICK_MIN ? 'full' : floorTier(s);
      pass.set(s.id, seed);
    }
    const subjTotalOf = (code: string): number =>
      subjectLists[code]!.reduce((a, s) => a + passMinutes(s, pass.get(s.id)!), 0);
    const stepUpWithin = (s: PlanSubtopic, budget: number): boolean => {
      const cur = pass.get(s.id)!;
      if (cur === 'full') return false;
      const next: PlanPass = cur === 'quick' ? 'standard' : 'full';
      const delta = passMinutes(s, next) - passMinutes(s, cur);
      if (subjTotalOf(s.subjectCode) + delta > budget) return false;
      pass.set(s.id, next);
      return true;
    };
    for (const code of SUBJECT_ORDER) {
      const cap = ownCapacity[code] ?? 0;
      const ordered = subjectLists[code]!.slice().sort(depthPriority);
      const floor = ordered.filter(isFloorTopic);
      const nonFloor = ordered.filter((s) => !isFloorTopic(s));
      for (const s of floor) if (pass.get(s.id) === 'quick') stepUpWithin(s, cap);
      for (const s of floor) while (pass.get(s.id) !== 'full' && stepUpWithin(s, cap)) { /* to FULL */ }
      for (const s of nonFloor) if (pass.get(s.id) === 'quick') stepUpWithin(s, cap);
      for (const s of nonFloor) while (pass.get(s.id) !== 'full' && stepUpWithin(s, cap)) { /* to FULL */ }
    }
    return pass;
  };

  // ---- Pack ALL subject-lane topics chronologically, with reallocation ----
  // Unchanged reallocation rules (§3 no-donation-below-FULL; Sunday → neediest)
  // but with: History served from its TWO streams (Monday→early, Sunday→modern,
  // donated→higher-priority stream), and block CAPACITY = the slot's
  // BUDGET-SCALED minutes (defect 3). A block still holds ≤3 new topics (4 if all
  // QUICK); topics run strictly in each stream's/subject's order; never span
  // days. Pure in `pass` + `weekendScale` (re-runnable for option probes). @internal
  interface PackResult {
    placements: Placement[];
    reallocations: Array<{ dateISO: string; fromSubject: string; toSubject: string }>;
    reallocatedInto: Record<string, string[]>;
    slotSubject: Map<string, string>;
    leftoverIds: string[];
  }
  const packAllScaled = (
    pass: ReadonlyMap<string, PlanPass>,
    weekendScale: number,
    deferred: ReadonlySet<string> = new Set<string>(),
  ): PackResult => {
    const keep = (s: PlanSubtopic): boolean => !deferred.has(s.id);
    const queues: Record<string, PlanSubtopic[]> = {};
    for (const code of SUBJECT_ORDER) queues[code] = code === 'HIST' ? [] : subjectLists[code]!.filter(keep);
    const histEarlyQ = histEarlySrc.filter(keep);
    const histModernQ = histModernSrc.filter(keep);
    const remList = (code: string): PlanSubtopic[] =>
      code === 'HIST' ? [...histEarlyQ, ...histModernQ] : queues[code]!;
    const remCount = (code: string): number =>
      code === 'HIST' ? histEarlyQ.length + histModernQ.length : queues[code]!.length;
    const allFull = (code: string): boolean =>
      subjectLists[code]!.every((s) => pass.get(s.id) === 'full');
    const placements: Placement[] = [];
    const reallocations: Array<{ dateISO: string; fromSubject: string; toSubject: string }> = [];
    const reallocatedInto: Record<string, string[]> = {};
    for (const code of SUBJECT_ORDER) reallocatedInto[code] = [];
    const slotSubject = new Map<string, string>();
    // The most important remaining topic of a HIST stream (for donated slots).
    const bestRankOf = (q: readonly PlanSubtopic[]): number[] => {
      let best: number[] | null = null;
      for (const s of q) {
        const key = [isAP(s) ? 0 : 1, s.band === 'A' ? 0 : 1, -(pyq[s.id] ?? 0), -(s.examPointCount ?? 0)];
        if (best === null || cmpKey(key, best) < 0) best = key;
      }
      return best ?? [9, 9, 0, 0];
    };
    const histQueueFor = (slot: SubjectSlotInfo): PlanSubtopic[] => {
      if (histModernQ.length === 0) return histEarlyQ;
      if (histEarlyQ.length === 0) return histModernQ;
      if (slot.dow === 1) return histEarlyQ; // Monday → H-early
      if (slot.dow === 0) return histModernQ; // Sunday → H-modern
      // Donated/pooled weekday → the stream with the larger remaining backlog
      // (usually H-early, so its long chain reaches its late protected topics),
      // breaking ties toward the higher-priority remaining head.
      if (histEarlyQ.length !== histModernQ.length) {
        return histEarlyQ.length > histModernQ.length ? histEarlyQ : histModernQ;
      }
      return cmpKey(bestRankOf(histEarlyQ), bestRankOf(histModernQ)) <= 0 ? histEarlyQ : histModernQ;
    };
    const neediest = (): string | null => {
      let best: string | null = null;
      let bestAP = -1;
      let bestDeep = -1;
      let bestCount = -1;
      for (const code of SUBJECT_ORDER) {
        const list = remList(code);
        if (list.length === 0) continue;
        const ap = list.filter(isAP).length;
        // Depth topics (STANDARD/FULL) still to place NEED a slot most — this is
        // what stops a freed slot going to a QUICK tail while a small Paper-I
        // subject still has band-A/floor depth topics unplaced.
        const deep = list.filter((s) => pass.get(s.id) !== 'quick').length;
        const count = list.length;
        if (
          ap > bestAP ||
          (ap === bestAP && (deep > bestDeep || (deep === bestDeep && count > bestCount)))
        ) {
          best = code;
          bestAP = ap;
          bestDeep = deep;
          bestCount = count;
        }
      }
      return best;
    };
    // Fill ONE study block from queue `q` for `subject` at `dateISO`, capped at
    // `cap` minutes and ≤3 new topics (4 if the whole block is QUICK). Topics run
    // strictly in queue order and never span days. @internal
    const fillBlock = (dateISO: string, subject: string, q: PlanSubtopic[], cap: number): void => {
      let used = 0;
      let count = 0;
      let allQuickSoFar = true;
      while (q.length > 0) {
        const s = q[0]!;
        const p = pass.get(s.id)!;
        const isQuick = p === 'quick' || passMinutes(s, p) <= QUICK_MIN;
        const maxTopics = allQuickSoFar && isQuick ? 4 : 3; // ≤3 new topics (4 if all-QUICK)
        if (count >= maxTopics) break;
        const m = passMinutes(s, p);
        if (count > 0 && used + m > cap) break;
        q.shift();
        used += m;
        count += 1;
        allQuickSoFar = allQuickSoFar && isQuick;
        placements.push({ dateISO, subjectCode: subject, id: s.id, pass: p });
      }
    };
    for (const slot of subjectSlots) {
      const owner = slot.owner;
      // §5 PLACEMENT — SUNDAY carries TWO dedicated study blocks: a protected
      // Modern-History block (H-modern) and a Polity block (Polity's SECOND
      // weekly slot). Both scale with the Sunday budget; the Polity block is cut
      // first below the 360-min default (at 240 → H-modern only, the old shape).
      // Runtime catch-up of the week's missed items still takes precedence over
      // these plan-time blocks; the plan assumes nothing missed.
      if (slot.dow === 0) {
        slotSubject.set(slot.dateISO, 'HIST');
        const hmodQ = histModernQ.length > 0 ? histModernQ : histEarlyQ;
        fillBlock(slot.dateISO, 'HIST', hmodQ, sunHmodCap(weekendScale));
        const polCap = sunPolCap(weekendScale);
        if (polCap > 0) fillBlock(slot.dateISO, 'POL', queues['POL']!, polCap);
        continue;
      }
      // A weekday block teaches its OWN subject first; it is DONATED only once its
      // owner has placed all its topics AND is a SPARE donor (every topic FULL).
      // An owner done but still below FULL leaves the block idle (§3 — never
      // donate while below FULL).
      let effective: string | null;
      if (remCount(owner) > 0) {
        effective = owner;
      } else if (allFull(owner)) {
        effective = neediest();
      } else {
        slotSubject.set(slot.dateISO, owner); // done but below FULL — idle, never donate
        continue;
      }
      if (effective === null) {
        slotSubject.set(slot.dateISO, owner); // everything placed — no new topics
        continue;
      }
      if (effective !== owner) {
        reallocations.push({ dateISO: slot.dateISO, fromSubject: owner, toSubject: effective });
        reallocatedInto[effective]!.push(slot.dateISO);
      }
      slotSubject.set(slot.dateISO, effective);
      const cap = slotCap(slot, weekendScale);
      const q = effective === 'HIST' ? histQueueFor(slot) : queues[effective]!;
      fillBlock(slot.dateISO, effective, q, cap);
    }
    const leftoverIds = [
      ...SUBJECT_ORDER.filter((c) => c !== 'HIST').flatMap((code) => queues[code]!.map((s) => s.id)),
      ...histEarlyQ.map((s) => s.id),
      ...histModernQ.map((s) => s.id),
    ];
    return { placements, reallocations, reallocatedInto, slotSubject, leftoverIds };
  };

  // ---- FIT = depth-v3 (own-fill + pool) THEN downgrade-to-fit --------------
  // A pure function of the weekend scale, so the feasibility OPTIONS can re-fit
  // at a higher weekend budget and report only the ones that ACTUALLY make it
  // fit (defect 3). Deterministic. @internal
  const computeFit = (
    weekendScale: number,
  ): { pass: Map<string, PlanPass>; res: PackResult; deferred: Set<string> } => {
    const pass = buildDepthTarget();
    const subjTotalOf = (code: string): number =>
      subjectLists[code]!.reduce((a, s) => a + passMinutes(s, pass.get(s.id)!), 0);
    const allFull = (code: string): boolean =>
      subjectLists[code]!.every((s) => pass.get(s.id) === 'full');
    // Per-subject leftover count of a pack result — how many of a subject's own
    // topics the packer could NOT seat. @internal
    const leftoverCountBySubject = (r: PackResult): Map<string, number> => {
      const m = new Map<string, number>();
      for (const id of r.leftoverIds) {
        const c = byId.get(id)?.subjectCode ?? '';
        m.set(c, (m.get(c) ?? 0) + 1);
      }
      return m;
    };
    // POOL = the Sunday pool P + every SPARE (all-FULL, total < C_s) subject's
    // surplus. It funds the single best remaining upgrade across all below-FULL
    // subjects, ranked AP → floor → STANDARD-target → PYQ desc → lowest Paper-I
    // minute share, applied only while it does NOT push more topics past the
    // window. Deterministic.
    const p1MinuteShare = (code: string): number => {
      const p1 = SUBJECT_ORDER.filter((c) => subjectIsP1[c]);
      const tot = p1.reduce((a, c) => a + subjTotalOf(c), 0);
      return tot > 0 ? subjTotalOf(code) / tot : 0;
    };
    const poolRank = (s: PlanSubtopic): number[] => [
      isAP(s) ? 0 : 1,
      isFloorTopic(s) ? 0 : 1,
      pass.get(s.id) === 'quick' ? 0 : 1, // STANDARD target before FULL target
      -(pyq[s.id] ?? 0),
      p1MinuteShare(s.subjectCode),
    ];
    // Polity does NOT get FULL on a non-band-A topic while ANY History PYQ>0
    // topic is still below STANDARD — the shared pool must lift History to its
    // floor before it over-deepens Polity (STANDARDS §8a, pool rule).
    const histPyqBelowStandard = (): boolean =>
      (subjectLists['HIST'] ?? []).some(
        (s) => (pyq[s.id] ?? 0) > 0 && PASS_RANK[pass.get(s.id)!] < PASS_RANK.standard,
      );
    const poolBlocked = (s: PlanSubtopic, next: PlanPass, overflows: boolean): boolean =>
      (s.subjectCode === 'POL' &&
        !(isAP(s) || s.band === 'A') &&
        next === 'full' &&
        histPyqBelowStandard()) ||
      // Never spend the shared pool taking a non-protected topic to FULL in a
      // subject that STILL overflows its own placement — extra FULL there just
      // burns block capacity (a 60-min FULL crowds out lighter topics) and
      // inflates the deferred buffer (defect 1). A subject deepens to FULL only
      // once its own topics all pack.
      (next === 'full' && !(isAP(s) || s.band === 'A') && overflows);
    let res = packAllScaled(pass, weekendScale);
    // POOL = ALL Sunday study minutes over the coverage window (scaled with the
    // Sunday budget) + every SPARE (all-FULL, total < C_s) subject's surplus.
    let pool = numCoverageSundays * sundayStudyCap(weekendScale);
    for (const code of SUBJECT_ORDER) {
      if (allFull(code)) pool += Math.max(0, (ownCapacity[code] ?? 0) - subjTotalOf(code));
    }
    const poolSkip = new Set<string>();
    while (pool > 0) {
      const overflowBySubj = leftoverCountBySubject(res);
      let best: PlanSubtopic | null = null;
      let bestKey: number[] | null = null;
      for (const s of allSubjectTopics) {
        if (pass.get(s.id) === 'full' || poolSkip.has(s.id)) continue;
        const next: PlanPass = pass.get(s.id) === 'quick' ? 'standard' : 'full';
        if (poolBlocked(s, next, (overflowBySubj.get(s.subjectCode) ?? 0) > 0)) continue;
        if (passMinutes(s, next) - passMinutes(s, pass.get(s.id)!) > pool) continue;
        const key = poolRank(s);
        if (bestKey === null || cmpKey(key, bestKey) < 0) {
          bestKey = key;
          best = s;
        }
      }
      if (!best) break;
      const prev = pass.get(best.id)!;
      const next: PlanPass = prev === 'quick' ? 'standard' : 'full';
      const delta = passMinutes(best, next) - passMinutes(best, prev);
      pass.set(best.id, next);
      const trial = packAllScaled(pass, weekendScale);
      if (trial.leftoverIds.length > res.leftoverIds.length) {
        // Deepening here would push MORE topics past 4 Nov — skip and keep looking.
        pass.set(best.id, prev);
        poolSkip.add(best.id);
        continue;
      }
      pool -= delta;
      res = trial;
    }
    // ---- DOWNGRADE-TO-FIT (defect 2): the real integer packing can leave a
    // tail even when the minute-fit "fits" (e.g. 60-min topics wasting 15 min in
    // a 135-min block). Downgrade the LOWEST-priority topic that is still ABOVE
    // its depth floor (never below — AP stays FULL, band A FULL, POL/ECON/GEO/SCI
    // + History-PYQ ≥ STANDARD) in an over-subscribed subject one tier at a time
    // and re-pack, before anything is deferred.
    const downgradeRank = (s: PlanSubtopic): number[] => [
      pyq[s.id] ?? 0,
      s.examPointCount ?? 0,
      -(seqIndex.get(s.id) ?? 0),
    ];
    let guard = 0;
    // ---- DOWNGRADE-TO-FIT (defect 2 — OWN-CAPACITY-FIRST): shed depth ONLY in a
    // subject that is genuinely OVER its own packable capacity, and ONLY while a
    // shed actually relieves THAT subject's overflow. A subject whose own topics
    // already pack keeps its own-capacity FULL depth — the old loop ran until the
    // (unreachable) GLOBAL leftover count hit 0 and so collapsed every leftover
    // subject (e.g. Economy) down to its floor even though its own Wednesdays fit
    // ~10 FULL. `settled` freezes a subject once shedding no longer seats more of
    // its own topics, so only the truly tight subject (History, block-count
    // bound) keeps shedding toward its QUICK floor. Deterministic.
    const settled = new Set<string>();
    while (res.leftoverIds.length > 0 && guard < 5000) {
      guard += 1;
      const leftBySubj = leftoverCountBySubject(res);
      let victim: PlanSubtopic | null = null;
      let victimKey: number[] | null = null;
      for (const s of allSubjectTopics) {
        if ((leftBySubj.get(s.subjectCode) ?? 0) === 0) continue; // subject fits — keep its depth
        if (settled.has(s.subjectCode)) continue; // shedding no longer seats its topics
        if (!canDowngrade(s, pass)) continue; // never below the depth floor
        const key = downgradeRank(s);
        if (victimKey === null || cmpKey(key, victimKey) < 0) {
          victimKey = key;
          victim = s;
        }
      }
      if (!victim) break; // every overflowing subject is at floor — densify/defer next
      const code = victim.subjectCode;
      const before = leftBySubj.get(code) ?? 0;
      const prev = pass.get(victim.id)!;
      pass.set(victim.id, prev === 'full' ? 'standard' : 'quick');
      const trial = packAllScaled(pass, weekendScale);
      const after = leftoverCountBySubject(trial).get(code) ?? 0;
      if (after >= before && trial.leftoverIds.length >= res.leftoverIds.length) {
        // Shedding this topic seated no more of the subject's own topics AND did
        // not help globally — revert and freeze the subject so we don't needlessly
        // starve its depth (its residual overflow is a genuine QUICK tail handled
        // by densify/defer). History (block-count bound) keeps shedding via its
        // own still-unfrozen topics.
        pass.set(victim.id, prev);
        settled.add(code);
        continue;
      }
      res = trial;
    }
    // ---- DENSIFY-TO-FIT (defect 2, step A): History's binding constraint is the
    // block COUNT (~47 topics, ~10–14 blocks). A QUICK block holds 4 topics vs 3,
    // so relaxing the LOWEST-priority non-AP / non-band-A topic (lowest PYQ first)
    // to QUICK IN-WINDOW raises packing density and lets the packer reach the
    // LATER protected topics (AP / band A) without spilling anything. A relaxed
    // STANDARD-floor topic is REPORTED as a floor shortfall.
    //
    // MINIMAL densify (defect 3 — depth must scale with the Sunday budget):
    // relax a STANDARD topic to QUICK ONLY when it actually lets the packer seat
    // more topics. The old loop densified EVERY leftover-subject STANDARD topic
    // to QUICK (History never packs all 47, so it collapsed the whole subject to
    // QUICK regardless of budget → a bigger Sunday budget bought no depth). With
    // the revert-if-it-does-not-help guard, extra Sunday capacity KEEPS more
    // History topics at STANDARD, so depth rises with the Sunday budget.
    // Deterministic.
    const densifySettled = new Set<string>();
    while (res.leftoverIds.length > 0 && guard < 8000) {
      guard += 1;
      const leftSubjects = new Set(res.leftoverIds.map((id) => byId.get(id)?.subjectCode ?? ''));
      let victim: PlanSubtopic | null = null;
      let victimKey: number[] | null = null;
      for (const s of allSubjectTopics) {
        if (!leftSubjects.has(s.subjectCode)) continue;
        if (densifySettled.has(s.id)) continue;
        if (isProtected(s) || pass.get(s.id) === 'quick') continue; // AP / band A never relaxed
        const key = downgradeRank(s);
        if (victimKey === null || cmpKey(key, victimKey) < 0) {
          victimKey = key;
          victim = s;
        }
      }
      if (!victim) break; // nothing left to densify — fall through to defer
      const prev = pass.get(victim.id)!;
      pass.set(victim.id, 'quick');
      const trial = packAllScaled(pass, weekendScale);
      if (trial.leftoverIds.length >= res.leftoverIds.length) {
        // Relaxing this topic to QUICK did not seat any more topics — keep its
        // STANDARD depth and try the next candidate (so spare Sunday capacity is
        // spent on depth, not needlessly flattened to QUICK).
        pass.set(victim.id, prev);
        densifySettled.add(victim.id);
        continue;
      }
      res = trial;
    }
    // ---- DEFER-TO-FIT (defect 2, step B): even at all-QUICK the block COUNT can
    // be short — DEFER the lowest-priority non-AP / non-band-A QUICK topic into
    // the Thu 5 / Fri 6 buffer so the packer reaches the LATER protected topics
    // (AP / band A), which must always be placed IN-WINDOW. Deferred topics are
    // the reported QUICK-only spill — never an AP or band-A topic. Deterministic.
    const deferred = new Set<string>();
    while (res.leftoverIds.length > 0 && guard < 12000) {
      guard += 1;
      const leftSubjects = new Set(res.leftoverIds.map((id) => byId.get(id)?.subjectCode ?? ''));
      let victim: PlanSubtopic | null = null;
      let victimKey: number[] | null = null;
      for (const s of allSubjectTopics) {
        if (!leftSubjects.has(s.subjectCode)) continue;
        if (isProtected(s) || deferred.has(s.id)) continue; // AP / band A never deferred
        const key = downgradeRank(s);
        if (victimKey === null || cmpKey(key, victimKey) < 0) {
          victimKey = key;
          victim = s;
        }
      }
      if (!victim) break; // only AP / band-A remain unplaced → genuine shortfall
      pass.set(victim.id, 'quick'); // buffer tier is always QUICK
      deferred.add(victim.id);
      res = packAllScaled(pass, weekendScale, deferred);
    }
    // ---- FINAL POLITY-vs-HISTORY FLOOR RULE (STANDARDS §8a): Polity must NOT
    // sit at FULL on a non-protected (non-AP, non-band-A) topic while ANY History
    // PYQ>0 topic is still below STANDARD — the shared pool has to lift History
    // to its floor before it over-deepens Polity. History's PYQ>0 topics are only
    // relaxed to QUICK by densify/defer ABOVE (after the pool ran), so the rule is
    // re-checked here on the FINAL state and any offending Polity FULL is pulled
    // back to STANDARD (band A / AP stay FULL), then re-packed. Deterministic.
    const histPyqBelowStandardFinal = (): boolean =>
      (subjectLists['HIST'] ?? []).some(
        (s) => (pyq[s.id] ?? 0) > 0 && PASS_RANK[pass.get(s.id)!] < PASS_RANK.standard,
      );
    if (histPyqBelowStandardFinal()) {
      let changed = false;
      for (const s of subjectLists['POL'] ?? []) {
        if (!(isAP(s) || s.band === 'A') && pass.get(s.id) === 'full') {
          pass.set(s.id, 'standard');
          changed = true;
        }
      }
      if (changed) res = packAllScaled(pass, weekendScale, deferred);
    }
    return { pass, res, deferred };
  };

  const { pass: passByTopic, res: result, deferred: deferredIds } = computeFit(weekendBudgetMin / 240);
  // The reported SPILL = intentionally DEFERRED low-priority QUICK topics PLUS
  // any topic the packer still could not place (a genuine shortfall — protected).
  const spillIdSet = [...deferredIds, ...result.leftoverIds];

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

  const { placements, reallocations, reallocatedInto, slotSubject } = result;

  // ---- Spill: any topic still unplaced by coverage-end → Thu 5 / Fri 6 Nov -
  // ---- Spill: any topic still unplaced by coverage-end → Thu 5 / Fri 6 Nov -
  // Fixing the small subjects' depth (no donating while below FULL) means the
  // History-heavy Paper-I tail can no longer be absorbed by donated slots, so a
  // genuine tail spills into the Thu 5 – Fri 6 Nov window. It is placed there as
  // ≤3-new-topic subject blocks (multiple blocks per day when needed) and fully
  // REPORTED; the plan is flagged not-feasible with the shortfall + options.
  const spills: Array<{ subject: string; topicIds: string[]; lastDateISO: string }> = [];
  const spillPlacements: Placement[] = [];
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
      spillPlacements.push({ dateISO, subjectCode: code, id, pass: spillPass });
      topicIds.push(id);
    }
    if (topicIds.length > 0) spills.push({ subject: code, topicIds, lastDateISO: dateISO });
  });

  // ---- MENT lane: pack 17 topics into 60-min base weekday coverage slots --
  const mentWeekdaySlots = subjectSlots.filter((s) => s.dow >= 1 && s.dow <= 5); // Mon–Fri coverage
  const mentByDate = new Map<string, PlanSubtopic[]>();
  let mentAllPassedISO = '';
  {
    const q = mentList.slice();
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
  for (const p of [...placements, ...spillPlacements]) pushFirstPass(p.dateISO, p.id);
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
  for (const p of [...placements, ...spillPlacements]) {
    const arr = placedByDate.get(p.dateISO) ?? [];
    arr.push(p);
    placedByDate.set(p.dateISO, arr);
  }

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

  // ---- Materialise the day list ------------------------------------------
  const statusFor = (dateISO: string): PlanDayStatus => {
    const d = diffDaysISO(todayISO, dateISO);
    return d < 0 ? 'past' : d === 0 ? 'today' : 'upcoming';
  };

  const days: PlanDay[] = [];
  for (const slot of slots) {
    const day = blankDay(slot, statusFor(slot.dateISO));
    const scale = slot.budgetMin / 240;
    const sm = (base: number): number => Math.max(1, Math.round(base * scale));

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
      // MOCK day: full mock 120 + review wrong 60 + weakest area 60.
      const paperLabel = slot.mockPaper === 'paper1' ? 'Paper-I' : 'Paper-II';
      day.phase = 'mock';
      day.mockPaper = slot.mockPaper;
      day.mockNumber = slot.mockNumber;
      day.blocks = [
        { kind: 'mock', label: `Full ${paperLabel} mock`, minutes: sm(120), mockPaper: slot.mockPaper!, mockNumber: slot.mockNumber },
        { kind: 'mock-review', label: 'Review wrong answers', minutes: sm(60) },
        { kind: 'weakest-area', label: 'Weakest-area drill', minutes: sm(60) },
      ];
      day.drillTarget = FULL_MOCK_QUESTIONS;
      finaliseBlocks(day, slot.budgetMin);
      days.push(day);
      continue;
    }

    if (slot.region === 'revision') {
      // REVISION CYCLE (long window only, ~4 weeks between coverage and the
      // final window): the SAME weekly rhythm, but the subject block REVISITS
      // already-first-passed topics in sequence order (weakest-first, ~25 min
      // each: notes skim + cards + mistakes + 10 Qs) instead of teaching new
      // ones — so NO new topics are first-passed here (coverage is done).
      day.phase = 'revise';
      // Weakest-first slice of a subject's topics for the day's revision list.
      const revisitPick = (code: string, n: number): string[] =>
        [...(subjectLists[code] ?? [])]
          .sort((a, b) => ctx.masteryOf(a.id) - ctx.masteryOf(b.id))
          .slice(0, n)
          .map((s) => s.id);

      if (slot.dow === 0) {
        // SUNDAY revision: Modern History + Polity revision blocks, then the
        // fixed weekly revision + CA round-up + Telugu.
        const blocks: PlanBlock[] = [
          { kind: 'targeted-revision', label: 'Modern History revision — sequence order, weakest first', minutes: Math.max(1, sunHmodCap(scale)), subjectCode: 'HIST' },
        ];
        if (sunPolCap(scale) > 0) {
          blocks.push({ kind: 'targeted-revision', label: 'Polity revision — sequence order, weakest first', minutes: Math.max(1, sunPolCap(scale)), subjectCode: 'POL' });
        }
        blocks.push({ kind: 'weekly-revision', label: 'Weekly revision (mistakes + flashcards)', minutes: 60 });
        blocks.push({ kind: 'ca-roundup', label: 'Current Affairs weekly round-up', minutes: 45, caSubtopicId: 'ca-national' });
        blocks.push({ kind: 'telugu', label: 'Telugu script practice', minutes: 15 });
        day.blocks = blocks;
        day.teluguBlock = true;
        day.weeklyRevision = true;
        day.caRevision = true;
        day.reviseSubtopicIds = [...revisitPick('HIST', 4), ...revisitPick('POL', 3)];
        finaliseBlocks(day, slot.budgetMin);
        days.push(day);
        continue;
      }

      // WEEKDAY revision (Mon–Fri): MENT practice + the owner subject's revision
      // block + optional Telugu + Revise + Current Affairs.
      const covered = coveredMentUpTo(slot.dateISO);
      const scope = practiceScope(covered.length > 0 ? covered : mentList.map((s) => s.id));
      const subj = SUBJECT_BY_DOW[slot.dow]!;
      const subjBaseMin = SUBJECT_BASE_MIN[slot.dow]!;
      const blocks: PlanBlock[] = [
        { kind: 'ment-practice', label: 'Mental Ability practice', minutes: sm(60), practiceSubtopicIds: scope, topics: [practiceTopic(scope)] },
        { kind: 'targeted-revision', label: `${SUBJECT_LABEL[subj] ?? subj} revision — sequence order, weakest first`, minutes: sm(subjBaseMin), subjectCode: subj },
      ];
      if (slot.dow === 2 || slot.dow === 4) {
        blocks.push({ kind: 'telugu', label: 'Telugu script practice', minutes: sm(15) });
        day.teluguBlock = true;
      }
      blocks.push({ kind: 'revise', label: 'Revise (due cards + mistakes + spaced recall)', minutes: sm(20) });
      const caId = CA_ROTATION[slot.dow]!;
      blocks.push({ kind: 'ca', label: CA_LABEL[caId] ?? 'Current Affairs', minutes: sm(25), caSubtopicId: caId });
      day.caRevision = true;
      day.blocks = blocks;
      day.reviseSubtopicIds = revisitPick(subj, 6);
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
      // Coverage SPILL (Thu 5 / Fri 6 Nov only): any subject topic that could not
      // be placed by the coverage-end date is taught here as a subject block.
      const spilledHere = (placedByDate.get(slot.dateISO) ?? []).filter(() => slot.dateISO <= anchors.spillDates[1]);
      const spillTopics = spilledHere.map((p) => toTopic(p.id, p.pass));
      if (spillTopics.length > 0) {
        // Group the day's spill by subject and emit block-size-legal spill
        // blocks whose MINUTES equal the sum of their own topics' minutes — the
        // buffer must obey the same block rules as the coverage window (≤ 3 new
        // topics, 4 only if they are all QUICK; a block never claims fewer
        // minutes than the topics it teaches). The old buffer hard-coded 60 min
        // for a 3-QUICK (75-min) block, so the reported tail overflowed the day
        // and the ≤-block-minutes rule was broken (defect 1).
        const bySubj = new Map<string, PlanTopic[]>();
        for (const t of spillTopics) {
          const c = byId.get(t.subtopicId)?.subjectCode ?? '';
          const arr = bySubj.get(c) ?? [];
          arr.push(t);
          bySubj.set(c, arr);
        }
        for (const [subj, ts] of bySubj) {
          let i = 0;
          while (i < ts.length) {
            // A block holds ≤ 3 new topics — 4 only if every one is QUICK.
            const allQuickAt4 =
              ts.slice(i, i + 4).length === 4 && ts.slice(i, i + 4).every((t) => t.pass === 'quick');
            const take = allQuickAt4 ? 4 : Math.min(3, ts.length - i);
            const chunk = ts.slice(i, i + take);
            const chunkMinutes = chunk.reduce((a, t) => a + t.estMinutes, 0);
            blocks.push({
              kind: 'subject',
              label: `${SUBJECT_LABEL[subj] ?? subj} (spill)`,
              minutes: chunkMinutes, // == Σ topic minutes: block never under-counts its topics
              subjectCode: subj,
              topics: chunk,
            });
            i += take;
          }
        }
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
      day.reviseSubtopicIds = spacedReviseFor(slot.dateISO, firstPassByDate, isApOrBandA);
      day.topics = [...spillTopics, practiceTopic(scope)];
      day.drillTarget = PRACTICE_QUESTIONS + spillTopics.reduce((a, t) => a + availableDrill(t.mcqCount), 0);
      finaliseBlocks(day, slot.budgetMin);
      // Fill the (surviving) targeted-revision block with this day's DEEPEN
      // top-ups — after finalise, so a trimmed-away block gets none and the
      // deepen minutes always sit inside the block's already-budgeted minutes.
      assignDeepenForDay(day, slot.dateISO);
      days.push(day);
      continue;
    }

    // ---- COVERAGE region ----
    day.phase = 'learn';
    if (slot.dow === 0) {
      // SUNDAY: two study blocks — Modern History (H-modern) + Polity (Polity's
      // second weekly slot) — then weekly revision 60 + CA round-up 45 + Telugu
      // 15. The two study blocks scale with the Sunday budget (Polity cut first
      // below the 360-min default); the fixed blocks stay 60/45/15.
      const placed = placedByDate.get(slot.dateISO) ?? [];
      const histPlaced = placed.filter((p) => p.subjectCode === 'HIST');
      const polPlaced = placed.filter((p) => p.subjectCode === 'POL');
      const histTopics = histPlaced.map((p) => toTopic(p.id, p.pass));
      const polTopics = polPlaced.map((p) => toTopic(p.id, p.pass));
      const topics = [...histTopics, ...polTopics];
      const hmodMin = sunHmodCap(scale);
      const polMin = sunPolCap(scale);
      const blocks: PlanBlock[] = [
        { kind: 'catchup', label: 'Modern History', minutes: Math.max(1, hmodMin), subjectCode: 'HIST', topics: histTopics, buildsOn: buildsOnFor(histPlaced[0]?.id, seqOrder, 'HIST', nameById) },
      ];
      if (polMin > 0 || polTopics.length > 0) {
        blocks.push({ kind: 'catchup', label: 'Polity', minutes: Math.max(1, polMin), subjectCode: 'POL', topics: polTopics, buildsOn: buildsOnFor(polPlaced[0]?.id, seqOrder, 'POL', nameById) });
      }
      blocks.push({ kind: 'weekly-revision', label: 'Weekly revision (mistakes + flashcards)', minutes: 60 });
      blocks.push({ kind: 'ca-roundup', label: 'Current Affairs weekly round-up', minutes: 45, caSubtopicId: 'ca-national' });
      blocks.push({ kind: 'telugu', label: 'Telugu script practice', minutes: 15 });
      day.blocks = blocks;
      day.teluguBlock = true;
      day.weeklyRevision = true;
      day.caRevision = true;
      recordFirstPass(day, topics);
      day.topics = topics;
      day.reviseSubtopicIds = spacedReviseFor(slot.dateISO, firstPassByDate, isApOrBandA);
      day.drillTarget = topics.reduce((a, t) => a + availableDrill(t.mcqCount), 0) + 15;
      finaliseBlocks(day, slot.budgetMin);
      days.push(day);
      continue;
    }

    // WEEKDAY (Mon–Fri) coverage.
    const blocks: PlanBlock[] = [];
    // 1) MENT block (topic first-pass, else practice set).
    const mentTopics = mentByDate.get(slot.dateISO);
    if (mentTopics && mentTopics.length > 0) {
      const topics = mentTopics.map((s) => toTopic(s.id, 'full'));
      blocks.push({ kind: 'ment', label: 'Mental Ability', minutes: sm(60), subjectCode: 'MENT', topics, buildsOn: buildsOnFor(mentTopics[0]!.id, seqOrder, 'MENT', nameById) });
    } else {
      const covered = coveredMentUpTo(slot.dateISO);
      const scope = practiceScope(covered.length > 0 ? covered : mentList.map((s) => s.id));
      blocks.push({ kind: 'ment-practice', label: 'Mental Ability practice', minutes: sm(60), practiceSubtopicIds: scope, topics: [practiceTopic(scope)] });
    }
    // 2) SUBJECT block (the day's owner or its reallocated winner).
    const subjBaseMin = SUBJECT_BASE_MIN[slot.dow]!;
    const subj = slotSubject.get(slot.dateISO) ?? SUBJECT_BY_DOW[slot.dow]!;
    const subjPlaced = (placedByDate.get(slot.dateISO) ?? []).filter((p) => p.subjectCode === subj);
    const subjTopics = subjPlaced.map((p) => toTopic(p.id, p.pass));
    blocks.push({ kind: 'subject', label: SUBJECT_LABEL[subj] ?? subj, minutes: sm(subjBaseMin), subjectCode: subj, topics: subjTopics, buildsOn: buildsOnFor(subjPlaced[0]?.id, seqOrder, subj, nameById) });
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
    const allTopics = [...(mentTopics?.map((s) => toTopic(s.id, 'full')) ?? []), ...subjTopics];
    // CA first-pass topic (aptitude) counts toward today's first-pass set.
    const caFirst = caFirstPassByDate.get(slot.dateISO);
    if (caFirst) allTopics.push(toTopic(caFirst, 'quick'));
    recordFirstPass(day, allTopics);
    day.topics = allTopics;
    day.reviseSubtopicIds = spacedReviseFor(slot.dateISO, firstPassByDate, isApOrBandA);
    // Drill target: first-pass topic drillables + CA 15 (+ practice 15 when no MENT topic).
    let drill = allTopics.reduce((a, t) => a + availableDrill(t.mcqCount), 0) + 15;
    if (!mentTopics || mentTopics.length === 0) drill += 15;
    day.drillTarget = drill;
    finaliseBlocks(day, slot.budgetMin);
    days.push(day);
  }

  // ---- Summary ------------------------------------------------------------
  const coverageEndISO = anchors.coverageEndISO;

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

  const mockList = [...mockNumberByDate.entries()]
    .filter(([dateISO]) => diffDaysISO(todayISO, dateISO) >= 0 && diffDaysISO(dateISO, examDateISO) >= 0)
    .map(([dateISO, m]) => ({ dateISO, paper: m.paper, mockNumber: m.num }))
    .sort((a, b) => a.dateISO.localeCompare(b.dateISO));
  const mockSittings = days.filter((d) => d.phase === 'mock').length;

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
  const aboveFloorSpills = spillPlacements.filter((p) => {
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
      weekendMainsCount: 0,
      feasible,
      shortfallHours,
      fastBands: [],
      fastBandBTopicIds: [],
      feasibilityOptions,
      deferredItems: ['English & General Essay (after Prelims)', 'Mains answer practice (after Prelims)'],
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
      mentAllPassedISO,
      mockList,
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
    if (s.region !== 'coverage' || s.isMock) continue;
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
    budgetMin: slot.budgetMin,
    plannedMinutes: 0,
    drillTarget: 0,
    topics: [],
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
    const plannedMinutes = Math.min(
      budgetMin,
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
      budgetMin,
      plannedMinutes,
      drillTarget: 0,
      topics: [],
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
      mentAllPassedISO: '',
      mockList: [],
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
