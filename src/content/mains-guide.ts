/**
 * Mains writing-SKILLS guide — a typed, static knowledge base for the Mains
 * view that teaches learners HOW to write descriptive answers, not just what
 * the model answers are.
 *
 * This module is plain, exported data consumed DIRECTLY by the Mains view. It
 * deliberately does NOT go through the content manifest/loader pipeline: it is
 * pedagogy (frameworks, structure, presentation, rubric), not a per-topic
 * content bank, so it carries no `kind` and needs no manifest/schema change.
 *
 * PROVENANCE: the {@link MAINS_OVERVIEW} paper structure (five 150-mark /
 * 180-minute descriptive papers + qualifying Telugu & English) is grounded in
 * the VERIFIED APPSC Notification No. 07/2026 scheme (see
 * `content/syllabus/official-2026.json` and `.research/appsc-verified-ivc.md`;
 * Paper-II header verified verbatim from the genuine 2023 Mains paper:
 * "History, Culture and Geography of India and Andhra Pradesh — Time: 3 hours,
 * Maximum Marks: 150"). Marks/time are NOT invented.
 */
import type { Paper } from './types';
import type { MainsItem } from './types';

/* -------------------------------------------------------------------------- */
/* 1. Mains overview                                                           */
/* -------------------------------------------------------------------------- */

/** One descriptive Mains paper (or a qualifying language paper). */
export interface MainsPaper {
  /** The engine `Paper` id this maps to (`mains-1`..`mains-5` | `qualifying`). */
  paper: Paper;
  /** Official paper label, e.g. `'Paper-I'`. */
  code: string;
  /** Editorial title of the paper's subject scope. */
  title: string;
  /** Maximum marks (per the verified 07/2026 scheme). */
  marks: number;
  /** Duration in minutes (180 min = 3 hours per the verified scheme). */
  durationMin: number;
  /** Answer standard — every Mains paper is descriptive. */
  standard: 'Descriptive';
  /** Permitted medium of writing. */
  medium: string;
  /**
   * `true` for the language papers whose marks are of qualifying nature only
   * (do not count toward the merit ranking).
   */
  qualifying: boolean;
  /** One-line scope summary shown under the paper header. */
  scope: string;
}

/** The full APPSC Group-1 Mains structure plus scheme-level notes. */
export interface MainsOverview {
  /** Total marks across the whole selection process (Mains + interview). */
  totalMarks: number;
  /** Personality Test / interview marks. */
  interviewMarks: number;
  /** Combined marks of the five merit-ranking (descriptive) papers. */
  meritMarks: number;
  /** Default writing medium across the descriptive papers. */
  medium: string;
  /** The papers in exam order. */
  papers: MainsPaper[];
  /** Scheme-level reminders that shape how one should write. */
  notes: string[];
}

/**
 * APPSC Group-1 Mains structure (Notification No. 07/2026).
 *
 * Five descriptive merit papers @ 150 marks / 180 min each (= 750 merit marks),
 * plus two qualifying language papers (Telugu, English) and a 75-mark interview
 * (Personality Test). Titles for Papers I–V follow the task's canonical scope;
 * Paper-II's scope is verified verbatim from the 2023 Mains paper header.
 */
export const MAINS_OVERVIEW: MainsOverview = {
  totalMarks: 825,
  interviewMarks: 75,
  meritMarks: 750,
  medium: 'English or Telugu',
  papers: [
    {
      paper: 'mains-1',
      code: 'Paper-I',
      title: 'General Essay',
      marks: 150,
      durationMin: 180,
      standard: 'Descriptive',
      medium: 'English or Telugu',
      qualifying: false,
      scope:
        'Essays on contemporary, socio-economic, political and reflective themes — tests structure, balance, language and depth of thought.',
    },
    {
      paper: 'mains-2',
      code: 'Paper-II',
      title: 'History, Culture and Geography of India and Andhra Pradesh',
      marks: 150,
      durationMin: 180,
      standard: 'Descriptive',
      medium: 'English or Telugu',
      qualifying: false,
      scope:
        'Indian & AP history, art and culture, and physical/human/economic geography — the analytical humanities paper.',
    },
    {
      paper: 'mains-3',
      code: 'Paper-III',
      title: 'Polity, Constitution, Governance, Law and Ethics',
      marks: 150,
      durationMin: 180,
      standard: 'Descriptive',
      medium: 'English or Telugu',
      qualifying: false,
      scope:
        'Indian Constitution, polity and governance, public administration, law, and ethics/integrity in public life.',
    },
    {
      paper: 'mains-4',
      code: 'Paper-IV',
      title: 'Economy and Development',
      marks: 150,
      durationMin: 180,
      standard: 'Descriptive',
      medium: 'English or Telugu',
      qualifying: false,
      scope:
        'Indian & Andhra Pradesh economy, planning, growth with distributive justice, HDI, environment and sustainable development.',
    },
    {
      paper: 'mains-5',
      code: 'Paper-V',
      title: 'Science, Technology and Data Interpretation',
      marks: 150,
      durationMin: 180,
      standard: 'Descriptive',
      medium: 'English or Telugu',
      qualifying: false,
      scope:
        'Developments in science & technology, their applications and impact, environment, and interpretation of data.',
    },
    {
      paper: 'qualifying',
      code: 'Qualifying — Telugu',
      title: 'Telugu (Qualifying)',
      marks: 150,
      durationMin: 180,
      standard: 'Descriptive',
      medium: 'Telugu',
      qualifying: true,
      scope:
        'Language paper of qualifying nature — marks do not count toward the merit list but a pass is mandatory.',
    },
    {
      paper: 'qualifying',
      code: 'Qualifying — English',
      title: 'English (Qualifying)',
      marks: 150,
      durationMin: 180,
      standard: 'Descriptive',
      medium: 'English',
      qualifying: true,
      scope:
        'Language paper of qualifying nature — marks do not count toward the merit list but a pass is mandatory.',
    },
  ],
  notes: [
    'All five merit papers are descriptive and equally weighted at 150 marks / 180 minutes — pace matters as much as knowledge.',
    'Answer in ONE medium (English or Telugu); the two language papers are qualifying only.',
    'Merit rank is decided by the five descriptive papers (750) plus the Personality Test (75).',
    'Every question is a directive: read the command word first, then plan before you write.',
  ],
};

/* -------------------------------------------------------------------------- */
/* 2. Directive-word frameworks                                                */
/* -------------------------------------------------------------------------- */

/** How a specific directive keyword should shape intro / body / conclusion. */
export interface DirectiveSkeleton {
  /** How to open given this directive. */
  intro: string;
  /** How to structure the body given this directive. */
  body: string;
  /** How to close given this directive. */
  conclusion: string;
}

/** A directive command-word and the answer-writing frame it demands. */
export interface DirectiveFramework {
  /** Canonical display keyword, e.g. `'Critically examine / analyse'`. */
  keyword: string;
  /**
   * Lowercase phrases used to DETECT this directive in a question, ordered so
   * the most specific phrase for this keyword comes first. Longer, compound
   * directives (e.g. `'critically examine'`) are matched ahead of their bare
   * forms globally by the detector in `src/lib/mains.ts`.
   */
  matchers: string[];
  /** Plain-English statement of what the examiner is asking for. */
  whatItDemands: string;
  /** Directive-specific intro/body/conclusion guidance. */
  skeleton: DirectiveSkeleton;
}

/**
 * The nine directive families APPSC descriptive questions use. Order is
 * authored most-specific-first so callers can iterate without re-sorting when
 * they want the compound directives (e.g. "critically examine") to win.
 */
export const DIRECTIVES: DirectiveFramework[] = [
  {
    keyword: 'Critically examine / analyse',
    matchers: [
      'critically examine',
      'critically analyse',
      'critically analyze',
      'critically evaluate',
    ],
    whatItDemands:
      'Break the issue into parts AND judge it — weigh merits against demerits and take a reasoned stance, not a neutral summary.',
    skeleton: {
      intro:
        'Define the issue and flag that it is contested; hint at the balance of evidence you will establish.',
      body: 'Present each dimension with evidence, then immediately appraise it (strength/limitation). Devote clear space to counter-arguments before judging.',
      conclusion:
        'Deliver a reasoned verdict that follows from the appraisal, tempered with a balanced way-forward.',
    },
  },
  {
    keyword: 'To what extent',
    matchers: ['to what extent', 'how far do you agree', 'how far'],
    whatItDemands:
      'Measure the DEGREE of truth of a claim — argue how much you agree, quantifying with evidence rather than answering yes/no.',
    skeleton: {
      intro:
        'Restate the claim and signal your net position (largely / partly / to a limited extent).',
      body: 'Marshal evidence FOR the claim, then the qualifications AGAINST it, so the reader can see where the truth lies on the scale.',
      conclusion:
        'State the extent explicitly (e.g. "true in X respects but limited by Y") — never a flat yes/no.',
    },
  },
  {
    keyword: 'Evaluate / Assess',
    matchers: ['evaluate', 'assess', 'appraise'],
    whatItDemands:
      'Judge worth, effectiveness or significance by weighing evidence on both sides and reaching a supported overall judgement.',
    skeleton: {
      intro: 'Define the subject and the criteria against which you will judge it.',
      body: 'Systematically weigh positives and negatives / successes and shortfalls against those criteria, backed by facts.',
      conclusion: 'Give an overall verdict on worth or effectiveness, justified by the weighing.',
    },
  },
  {
    keyword: 'Examine',
    matchers: ['examine', 'investigate'],
    whatItDemands:
      'Inspect the issue in depth — probe its parts, causes and implications, questioning assumptions along the way.',
    skeleton: {
      intro: 'Define the theme and outline the aspects you will probe.',
      body: 'Investigate each aspect closely — causes, workings, implications — with supporting evidence; note nuances.',
      conclusion: 'Synthesise what the examination reveals; a light balanced judgement is welcome.',
    },
  },
  {
    keyword: 'Analyse',
    matchers: ['analyse', 'analyze'],
    whatItDemands:
      'Decompose the topic into its components and explain how they interrelate and drive the outcome — the "how/why", not just the "what".',
    skeleton: {
      intro: 'Define the whole and name the components/lenses you will separate it into.',
      body: 'Take each component in turn and show its role and interactions (cause→effect, part→whole), with evidence.',
      conclusion: 'Draw the components together into an integrated understanding of the whole.',
    },
  },
  {
    keyword: 'Discuss',
    matchers: ['discuss', 'elaborate on', 'examine the debate'],
    whatItDemands:
      'Explore the issue from multiple angles, presenting different viewpoints or dimensions before arriving at a balanced position.',
    skeleton: {
      intro: 'Introduce the issue and preview the key perspectives/dimensions to be discussed.',
      body: 'Devote a thematic block to each viewpoint or dimension, giving fair, evidenced treatment to each side.',
      conclusion: 'Reconcile the perspectives into a balanced, forward-looking closing position.',
    },
  },
  {
    keyword: 'Comment',
    matchers: ['comment on', 'comment'],
    whatItDemands:
      'Give an informed opinion on the statement — identify the key points and offer a brief, reasoned reaction to each.',
    skeleton: {
      intro: 'Restate the proposition and signal the stance/angle of your comment.',
      body: 'Pick out the salient points and react to each with a short supporting reason or example.',
      conclusion: 'Sum up your overall take succinctly.',
    },
  },
  {
    keyword: 'Explain',
    matchers: ['explain', 'account for', 'why', 'clarify'],
    whatItDemands:
      'Make the topic clear and understood — set out the how and why with reasons, mechanisms and illustrative examples.',
    skeleton: {
      intro: 'Define the concept and state what needs explaining.',
      body: 'Lay out the mechanism/reasons step by step, using examples and simple diagrams to aid clarity.',
      conclusion: 'Restate the core explanation crisply; note significance if relevant.',
    },
  },
  {
    keyword: 'Describe',
    matchers: ['describe', 'trace', 'give an account of', 'enumerate', 'outline'],
    whatItDemands:
      'Present the main features, stages or characteristics in an organised way — detailed and accurate, opinion not required.',
    skeleton: {
      intro: 'Set the context and define the subject to be described.',
      body: 'Lay out features/stages in a logical order (chronological, spatial or thematic), each clearly labelled.',
      conclusion: 'Close with the overall picture or significance of what was described.',
    },
  },
];

/* -------------------------------------------------------------------------- */
/* 3. Structure guide                                                          */
/* -------------------------------------------------------------------------- */

/** A named writing technique with a one-line how-to. */
export interface Technique {
  name: string;
  how: string;
}

/** Intro / body / conclusion technique menus. */
export interface StructureGuide {
  /** Ways to open an answer effectively. */
  introduction: Technique[];
  /** How to organise the body. */
  body: {
    /** Choosing thematic vs dimensional organisation. */
    approaches: Technique[];
    /** The standard multi-dimensional lenses to scan a topic through. */
    lenses: string[];
    /** Devices that add substance and marks to the body. */
    substance: Technique[];
  };
  /** Ways to close an answer effectively. */
  conclusion: Technique[];
}

/** Introduction, body and conclusion technique menus. */
export const STRUCTURE_GUIDE: StructureGuide = {
  introduction: [
    { name: 'Definition', how: 'Open by defining the central term/concept to fix scope precisely.' },
    { name: 'Context', how: 'Anchor the topic in its historical, constitutional or current-affairs setting.' },
    { name: 'Data / fact', how: 'Lead with a striking, relevant statistic, index rank or figure.' },
    { name: 'Quote / report', how: 'Use a short apt quote, committee or report line — sparingly and only if exact.' },
  ],
  body: {
    approaches: [
      {
        name: 'Thematic',
        how: 'Group the answer by themes/arguments (e.g. viewpoint A vs B) — best for Discuss/Comment.',
      },
      {
        name: 'Dimensional',
        how: 'Scan the topic through fixed lenses (social, economic, political…) — best for Analyse/Examine.',
      },
      {
        name: 'Chronological / spatial',
        how: 'Order by time or place — best for Describe/Trace in history & geography.',
      },
    ],
    lenses: [
      'Social',
      'Economic',
      'Political',
      'Administrative',
      'Legal / Constitutional',
      'Environmental',
      'Historical / Cultural',
      'Ethical',
      'International',
    ],
    substance: [
      { name: 'Examples', how: 'Ground each claim in a concrete Indian/AP example or case.' },
      { name: 'Facts & figures', how: 'Add accurate data, indices and years — precision earns credibility.' },
      { name: 'Committees & reports', how: 'Cite the relevant commission/committee/report where apt.' },
      { name: 'Articles & schemes', how: 'Name the exact Article, Act or scheme instead of vague reference.' },
      { name: 'Maps & diagrams', how: 'Use a small flowchart, map or table to convey structure fast and save words.' },
    ],
  },
  conclusion: [
    { name: 'Balanced', how: 'Weigh both sides into a fair, non-extreme closing judgement.' },
    { name: 'Way-forward', how: 'End with concrete, feasible reforms or next steps.' },
    { name: 'Optimistic / visionary', how: 'Close on a constructive, solution-oriented, hopeful note.' },
  ],
};

/* -------------------------------------------------------------------------- */
/* 4. Presentation guide                                                       */
/* -------------------------------------------------------------------------- */

/** A suggested word/time budget for a given per-question mark value. */
export interface BudgetRow {
  marks: number;
  minMinutes: number;
  minWords: number;
  maxWords: number;
}

/** Presentation techniques + the word/time budgeting table. */
export interface PresentationGuide {
  /** General presentation techniques. */
  techniques: Technique[];
  /**
   * Word/time budget rows. Derived from the verified 150-mark / 180-minute
   * scheme: ~1.2 minutes per mark and roughly 11–14 words per mark.
   */
  budget: BudgetRow[];
  /** The rule of thumb behind the table, for the UI to display. */
  budgetRule: string;
}

/** Presentation techniques and the marks→words/minutes budget. */
export const PRESENTATION_GUIDE: PresentationGuide = {
  techniques: [
    {
      name: 'Points vs paragraphs',
      how: 'Prefer crisp bullet points for facts/dimensions; keep short paragraphs for analysis and linkage.',
    },
    {
      name: 'Headings & sub-headings',
      how: 'Break the answer with clear headings so the examiner sees your structure at a glance.',
    },
    {
      name: 'Underline keywords',
      how: 'Underline key terms, Articles, schemes and data to draw the eye to your best content.',
    },
    {
      name: 'Diagrams & flowcharts',
      how: 'Add a simple labelled diagram, map or flowchart — it conveys relationships and saves words.',
    },
    {
      name: 'Legibility & spacing',
      how: 'Write neatly with margins and spacing; an unreadable answer loses easy marks.',
    },
    {
      name: 'Time & word discipline',
      how: 'Budget minutes and words per question up front so you attempt the FULL paper.',
    },
  ],
  budget: [
    { marks: 5, minMinutes: 6, minWords: 60, maxWords: 80 },
    { marks: 10, minMinutes: 12, minWords: 120, maxWords: 150 },
    { marks: 15, minMinutes: 18, minWords: 180, maxWords: 220 },
    { marks: 20, minMinutes: 24, minWords: 250, maxWords: 300 },
  ],
  budgetRule:
    'On the 150-mark / 180-minute scheme, budget ~1.2 minutes and ~11–14 words per mark; reserve a few minutes to review.',
};

/* -------------------------------------------------------------------------- */
/* 5. Dos & Don'ts / common mistakes                                           */
/* -------------------------------------------------------------------------- */

/** A single actionable do / don't with a short rationale. */
export interface Tip {
  text: string;
  why: string;
}

/** Do / Don't checklists for the exam hall. */
export interface DosDonts {
  dos: Tip[];
  donts: Tip[];
}

/** What strong writers do — and the mistakes that cost marks. */
export const DOS_DONTS: DosDonts = {
  dos: [
    { text: 'Decode the directive word before planning.', why: 'It dictates the whole structure and depth expected.' },
    { text: 'Spend ~2 minutes planning the skeleton.', why: 'A planned answer stays on-point and balanced.' },
    { text: 'Address every part of a multi-part question.', why: 'Unattempted sub-parts forfeit guaranteed marks.' },
    { text: 'Substantiate claims with facts, examples and Articles.', why: 'Specifics separate a top answer from a generic one.' },
    { text: 'Use AP/local examples where relevant.', why: 'This is an APPSC paper — regional grounding scores.' },
    { text: 'Write a real intro and conclusion.', why: 'They frame the answer and are high-value, low-effort marks.' },
  ],
  donts: [
    { text: "Don't write a bare summary when asked to critically examine.", why: 'Missing judgement caps your marks.' },
    { text: "Don't exceed the word/time budget on one question.", why: 'Over-writing early means blank answers later.' },
    { text: "Don't pad with vague generalities.", why: 'Filler dilutes content and wastes limited time.' },
    { text: "Don't fabricate data, dates or reports.", why: 'A wrong "fact" destroys credibility with the examiner.' },
    { text: "Don't ignore the counter-view.", why: 'Balance is expected; one-sided answers read as biased.' },
    { text: "Don't leave the answer without a conclusion.", why: 'An abrupt stop signals poor planning and time management.' },
  ],
};

/* -------------------------------------------------------------------------- */
/* 6. Self-evaluation rubric                                                   */
/* -------------------------------------------------------------------------- */

/** One rubric criterion scored 0–2. */
export interface RubricCriterion {
  /** Stable id for storing a learner's self-scores. */
  id: string;
  /** Display name of the criterion. */
  name: string;
  /** Maximum score for this criterion (always 2). */
  max: 2;
  /** One-line tip on how to earn full marks on this criterion. */
  tip: string;
}

/** A scoring band with its inclusive lower bound. */
export interface RubricBand {
  /** Inclusive minimum total for this band. */
  min: number;
  /** Short band label. */
  label: string;
  /** One-line guidance for a score in this band. */
  note: string;
}

/** The five-criterion, /10 self-evaluation rubric. */
export interface Rubric {
  criteria: RubricCriterion[];
  /** Maximum achievable total (5 criteria × 2). */
  maxTotal: number;
  /** Bands ordered high→low; the first whose `min` a total meets applies. */
  bands: RubricBand[];
}

/**
 * Five criteria × 0–2 = /10 self-evaluation rubric with three bands. The band
 * thresholds here are the single source of truth reused by `scoreRubric` in
 * `src/lib/mains.ts`.
 */
export const RUBRIC: Rubric = {
  criteria: [
    {
      id: 'structure',
      name: 'Structure & intro/conclusion',
      max: 2,
      tip: 'Clear intro, logically ordered body and a real conclusion — not an abrupt stop.',
    },
    {
      id: 'content',
      name: 'Content coverage / main points',
      max: 2,
      tip: 'Covers the core demands and every part of the question without major gaps.',
    },
    {
      id: 'examples',
      name: 'Examples & facts',
      max: 2,
      tip: 'Backs claims with accurate data, cases, Articles and (where apt) AP examples.',
    },
    {
      id: 'analysis',
      name: 'Analysis / multidimensionality',
      max: 2,
      tip: 'Argues across multiple lenses and answers the directive, not just narrates.',
    },
    {
      id: 'presentation',
      name: 'Presentation',
      max: 2,
      tip: 'Headings, underlined keywords, a diagram where useful, and legible layout.',
    },
  ],
  maxTotal: 10,
  bands: [
    { min: 8, label: 'Strong', note: 'Exam-ready — polish for speed and precision.' },
    { min: 5, label: 'Developing', note: 'On track — deepen analysis and add specifics.' },
    { min: 0, label: 'Needs work', note: 'Rebuild the answer around the directive and a clear structure.' },
  ],
};

/* -------------------------------------------------------------------------- */
/* Aggregate export                                                            */
/* -------------------------------------------------------------------------- */

/** The complete Mains writing-skills guide, bundled for the Mains view. */
export interface MainsGuide {
  overview: MainsOverview;
  directives: DirectiveFramework[];
  structure: StructureGuide;
  presentation: PresentationGuide;
  dosDonts: DosDonts;
  rubric: Rubric;
}

/** The single object the Mains view imports to render the whole guide. */
export const MAINS_GUIDE: MainsGuide = {
  overview: MAINS_OVERVIEW,
  directives: DIRECTIVES,
  structure: STRUCTURE_GUIDE,
  presentation: PRESENTATION_GUIDE,
  dosDonts: DOS_DONTS,
  rubric: RUBRIC,
};

/** Re-export the practice-question item type for the Mains view's convenience. */
export type { MainsItem };
