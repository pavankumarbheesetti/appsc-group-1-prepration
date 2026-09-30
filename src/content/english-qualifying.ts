/**
 * English QUALIFYING-paper knowledge base — a typed, static module consumed
 * DIRECTLY by the English view (`#/english`), NOT through the content
 * manifest/loader pipeline.
 *
 * Like `mains-guide.ts`, this is pedagogy + practice data rather than a
 * per-topic content bank, so it carries no `kind` and needs no manifest/schema
 * change. It bundles four things the English module teaches against:
 *
 *   1. {@link paperOverview}   — the question types + marks of the qualifying
 *                                English paper (SSC standard; total 150,
 *                                qualifying nature).
 *   2. {@link WRITING_FORMATS} — for each writing task (Letter, Precis, Report,
 *                                Essay, Formal speech, Press release, Writing on
 *                                visual information): when it is used, its
 *                                structure, techniques, a short model and a
 *                                self-evaluation checklist.
 *   3. {@link grammarMCQs}     — MCQItem-shaped grammar questions across the
 *                                syllabus grammar areas, passed DIRECTLY to the
 *                                shared quiz runner.
 *   4. {@link readingComprehension} — short passages, each with MCQItem-shaped
 *                                comprehension questions for the quiz runner.
 *
 * PROVENANCE: the paper's question types + marks are grounded in the verified
 * APPSC Notification No. 07/2026 qualifying-English scheme (see
 * `content/syllabus/official-2026.json`). Grammar keys/answers are standard
 * SSC-level English; each item carries an explanation for self-study.
 */
import type { MCQItem } from './types';

/* -------------------------------------------------------------------------- */
/* 1. Paper overview                                                           */
/* -------------------------------------------------------------------------- */

/** One question type in the qualifying English paper, with its marks. */
export interface PaperQuestionType {
  /** The question-type name as it appears in the scheme. */
  name: string;
  /** Marks allotted to this question type. */
  marks: number;
  /** One-line note on what the question tests / expects. */
  note: string;
}

/** The qualifying English paper at a glance. */
export interface PaperOverview {
  /** Total marks (sums the question types). */
  totalMarks: number;
  /** True — the paper is of qualifying nature (marks do not add to merit). */
  qualifying: boolean;
  /** The qualifying rule explained in one line. */
  qualifyingNote: string;
  /** Standard/level of the paper. */
  standard: string;
  /** The question types and their marks. */
  questionTypes: PaperQuestionType[];
}

/**
 * The qualifying English paper — question types + marks (total 150). Grounded
 * in the verified 07/2026 scheme; the paper is SSC standard and qualifying in
 * nature.
 */
export const paperOverview: PaperOverview = {
  totalMarks: 150,
  qualifying: true,
  qualifyingNote:
    'The English paper is QUALIFYING only — you must clear the minimum, but its marks are NOT added to the merit ranking. Clear it comfortably and spend energy on the merit papers.',
  standard: 'SSC / matriculation standard',
  questionTypes: [
    { name: 'Essay', marks: 20, note: 'A 250–300 word structured essay on a general topic.' },
    { name: 'Letter (formal)', marks: 10, note: 'An official letter — application, complaint or request.' },
    { name: 'Press release / Appeal', marks: 10, note: 'A short official release or public appeal.' },
    { name: 'Report', marks: 15, note: 'A factual report of an event, third person and past tense.' },
    { name: 'Writing on visual information', marks: 15, note: 'Describe a chart/graph/table objectively.' },
    { name: 'Formal speech', marks: 15, note: 'A speech to an audience with greeting, points and close.' },
    { name: 'Precis', marks: 15, note: 'Condense a passage to about one-third in your own words.' },
    { name: 'Reading comprehension', marks: 15, note: 'Answer questions on an unseen passage.' },
    { name: 'English Grammar (MCQs)', marks: 20, note: 'Tenses, voice, narration, prepositions, usage, etc.' },
    { name: 'Translation', marks: 15, note: 'Translate a passage between English and the regional language.' },
  ],
};

/* -------------------------------------------------------------------------- */
/* 2. Writing formats                                                          */
/* -------------------------------------------------------------------------- */

/** A writing-task guide: when used, structure, techniques, a model + checklist. */
export interface WritingFormat {
  /** Stable key used to persist the learner's draft/checks in `state.english`. */
  key: string;
  /** Display name of the format. */
  name: string;
  /** When this format is used / what it is for. */
  whenUsed: string;
  /** Suggested length. */
  wordLimit: string;
  /** The structure — parts/steps in order. */
  structure: string[];
  /** Techniques / tips for scoring well. */
  techniques: string[];
  /** A short model example (rendered as light markdown). */
  model: string;
  /** Self-evaluation checklist criteria (each a yes/no the learner ticks). */
  checklist: string[];
}

/** The seven writing tasks the qualifying English paper tests. */
export const WRITING_FORMATS: readonly WritingFormat[] = [
  {
    key: 'letter',
    name: 'Formal Letter',
    whenUsed: 'Official communication — an application, a complaint, or a request to an authority.',
    wordLimit: '150–200 words',
    structure: [
      "Sender's address (top-left) and the date below it",
      "Receiver's designation and address",
      'A clear Subject line',
      'Salutation — Dear Sir / Madam',
      'Body ¶1: state the purpose in one line',
      'Body ¶2: give the necessary details',
      'Body ¶3: a courteous request / expected action',
      'Complimentary close — Yours faithfully',
      'Signature, name (and designation)',
    ],
    techniques: [
      'Keep the tone polite and formal — no contractions or slang.',
      'State the purpose in the very first sentence.',
      'Use a specific, informative subject line.',
      'Keep each paragraph to a single idea.',
      'Close with a courteous, specific call to action.',
    ],
    model: [
      '**From:** The Secretary, Green Colony Welfare Association, Guntur — 12 May 2026',
      '**To:** The Municipal Commissioner, Guntur',
      '**Subject:** Request to repair the damaged colony road',
      '',
      'Dear Sir,',
      '',
      'I write on behalf of the residents of Green Colony to request urgent repair of the main road, which has developed large potholes after the recent rains.',
      '',
      'The broken road has caused two accidents this month and makes it difficult for ambulances and school buses to pass. We have raised the matter locally but no action has followed.',
      '',
      'We request you to sanction repairs at the earliest and would be grateful for a site inspection this week.',
      '',
      'Yours faithfully,',
      'R. Rao (Secretary)',
    ].join('\n'),
    checklist: [
      'Correct layout — address, date, subject, salutation and close.',
      'Purpose stated clearly in the opening line.',
      'Formal, polite tone maintained throughout.',
      'Logical paragraphing: purpose → details → request.',
      'Correct complimentary close and signature block.',
    ],
  },
  {
    key: 'precis',
    name: 'Precis',
    whenUsed: 'Condensing a long passage to its essence in your own words.',
    wordLimit: 'About one-third of the original',
    structure: [
      'Read the passage twice to grasp the central idea',
      'Underline key points; drop examples and repetition',
      'Draft a rough version in your own words',
      'Trim to roughly one-third of the original length',
      'Give a short, suitable title',
    ],
    techniques: [
      'Never add your own opinions or any new facts.',
      'Write in reported speech and the third person.',
      'Use a single connected paragraph.',
      'Keep only the main idea and essential supporting points.',
      'Count the words and stay within the limit.',
    ],
    model: [
      '**Original (≈60 words):** Many students believe that success in examinations depends only on the hours they spend studying. In reality, how they study matters far more than how long. Short, focused sessions with regular revision and self-testing help the mind retain information, whereas long, tired hours of passive reading are quickly forgotten.',
      '',
      '**Precis (≈20 words):** Exam success depends less on hours studied than on method: short, focused sessions with regular revision and self-testing beat long, passive reading.',
    ].join('\n'),
    checklist: [
      'Length is about one-third of the original.',
      'Central idea preserved; no key point missed.',
      'No personal opinions or new information added.',
      'Written in your own words, third person, one paragraph.',
      'A suitable, short title is given.',
    ],
  },
  {
    key: 'report',
    name: 'Report',
    whenUsed: 'A factual account of an event, function or incident (as for a newspaper/notice board).',
    wordLimit: '150–200 words',
    structure: [
      'A clear, informative heading',
      'By-line — reporter name and place',
      'Opening: the 5 Ws — what, when, where, who, why',
      'Body: details in a logical order, with facts',
      'Conclusion: outcome, impact or follow-up',
    ],
    techniques: [
      'Write in the third person and the past tense.',
      'Be factual and objective — keep out personal feelings.',
      'Answer the 5 Ws and 1 H.',
      'Give the report a clear, informative heading.',
      'Keep it concise and well-sequenced.',
    ],
    model: [
      '## Blood Donation Camp Draws Record Turnout',
      'By a Staff Reporter, Vijayawada',
      '',
      'A blood donation camp organised by the City College NSS unit on 10 May 2026 collected over 200 units of blood, a record for the campus. The camp, held in the college auditorium from 9 a.m. to 4 p.m., was inaugurated by the District Medical Officer.',
      '',
      'Doctors from the regional blood bank supervised the drive, and volunteers guided donors through registration and refreshments. The Principal thanked participants and announced that the camp would now be an annual event.',
    ].join('\n'),
    checklist: [
      'Clear heading and a by-line.',
      'Opening covers what, when and where.',
      'Third person, past tense, objective tone.',
      'Facts presented in a logical order.',
      'Concise conclusion — outcome or impact.',
    ],
  },
  {
    key: 'essay',
    name: 'Essay',
    whenUsed: 'A structured discussion of a general topic, showing balanced reasoning.',
    wordLimit: '250–300 words',
    structure: [
      'Introduction: hook + context + your stance/thesis',
      'Body ¶1: first main idea with support',
      'Body ¶2: second idea or the other side',
      'Body ¶3: a further point or example',
      'Conclusion: restate the stance + a way forward',
    ],
    techniques: [
      'Jot a brief outline before you start writing.',
      'One central idea per paragraph, led by a topic sentence.',
      'Use linking words to connect paragraphs.',
      'Support each point with an example, data or a reason.',
      'End with a balanced, forward-looking conclusion.',
    ],
    model: [
      '## Should social media be regulated?',
      '**Intro:** Social media has transformed how we connect, learn and do business — but its misuse has also raised urgent concerns.',
      '',
      '**Body:** On one hand, it democratises information and gives ordinary people a voice. On the other, the spread of misinformation and its effect on mental health show why some oversight is needed. Sensible regulation — transparency about algorithms and swift removal of harmful content — can curb the harm without silencing free speech.',
      '',
      '**Conclusion:** Rather than banning it, we should regulate social media thoughtfully, balancing freedom with responsibility.',
    ].join('\n'),
    checklist: [
      'Clear introduction that states a thesis/stance.',
      'Each paragraph develops one idea with support.',
      'Logical flow using linking devices.',
      'Balanced treatment of the topic.',
      'An effective conclusion that answers the topic.',
    ],
  },
  {
    key: 'speech',
    name: 'Formal Speech',
    whenUsed: 'Addressing an audience at a function, assembly or debate.',
    wordLimit: '200–250 words',
    structure: [
      'Greeting to the audience and dignitaries',
      'Introduction of the topic and why it matters',
      'Body: two or three key points with examples',
      'A motivational or emotional appeal',
      'Conclusion and a vote of thanks',
    ],
    techniques: [
      'Open with a greeting and a hook — a question, quote or fact.',
      "Use direct address: 'friends', 'respected teachers'.",
      'Keep sentences short; use rhetorical devices naturally.',
      'Vary your tone to hold attention.',
      'Close with a memorable line and a thank-you.',
    ],
    model: [
      'Respected Principal, teachers and my dear friends, good morning.',
      '',
      'Today I wish to speak on the value of time. Benjamin Franklin said, "Lost time is never found again." Each of us is given the same twenty-four hours, yet what we make of them decides our future.',
      '',
      'A student who plans the day, studies with focus and avoids idle distraction achieves far more than one who drifts. Time, once gone, cannot be recalled — so let us use it wisely, starting today.',
      '',
      'Thank you.',
    ].join('\n'),
    checklist: [
      'A proper greeting to the audience/dignitaries.',
      'A clear introduction of the topic.',
      'Two or three well-developed points with examples.',
      'An engaging, direct-address tone.',
      'A strong conclusion and a vote of thanks.',
    ],
  },
  {
    key: 'press-release',
    name: 'Press Release / Appeal',
    whenUsed: 'An official announcement to the media, or a public appeal for support.',
    wordLimit: '150–200 words',
    structure: [
      "Organisation name and a 'PRESS RELEASE' or 'APPEAL' label",
      'A headline summarising the news or appeal',
      'Dateline — place and date',
      'Body: what happened / what is sought, and why',
      'A spokesperson quote and contact details',
    ],
    techniques: [
      'Lead with the most important information (inverted pyramid).',
      'Keep it factual, clear and quotable.',
      'For an appeal, name the cause and the specific help needed.',
      'Use an official, neutral tone.',
      'Provide a contact for follow-up.',
    ],
    model: [
      '**PRESS RELEASE — District Red Cross Society, Kurnool**',
      '## Appeal for Relief Material for Flood-Affected Families',
      'Kurnool, 14 August 2026',
      '',
      'The District Red Cross Society appeals to citizens to donate dry rations, drinking water and blankets for over 500 families displaced by this week\u2019s floods. Collection centres have been opened at the Town Hall and all municipal offices.',
      '',
      '"Even a small contribution can restore a family\u2019s dignity," said the Society\u2019s Chairperson. Donors may contact the helpline at the Town Hall for pick-up of bulk material.',
    ].join('\n'),
    checklist: [
      'A clear label (Press Release / Appeal) and a headline.',
      'A dateline — place and date.',
      'Key information leads the body (inverted pyramid).',
      'The purpose / action sought is stated clearly.',
      'A contact or spokesperson detail is included.',
    ],
  },
  {
    key: 'visual',
    name: 'Writing on Visual Information',
    whenUsed: 'Describing a chart, graph or table in continuous prose.',
    wordLimit: 'About 150 words',
    structure: [
      'Opening: state what the visual shows — title, units, period',
      'Overview: the single main trend or biggest feature',
      'Body: key data points and comparisons',
      'Note any exceptions or notable changes',
      'A brief closing summary — no opinions',
    ],
    techniques: [
      "Describe, don't interpret or give opinions.",
      'Group similar data and highlight trends (rise / fall / peak).',
      'Use comparison language: higher than, twice as much, the largest.',
      'Quote figures selectively to support the trend.',
      'Use the tense that matches the period shown.',
    ],
    model: [
      'The bar chart shows the number of internet users in a town from 2018 to 2022, in thousands.',
      '',
      'Overall, usage rose steadily across the period. Users grew from about 10,000 in 2018 to nearly 45,000 in 2022 — more than a fourfold increase. The sharpest jump came between 2020 and 2021, when the figure almost doubled. Growth then slowed slightly in the final year, though numbers still reached their highest point in 2022.',
    ].join('\n'),
    checklist: [
      'Opening states what the visual shows (title/units/period).',
      'A clear overview of the main trend.',
      'Key figures and comparisons described accurately.',
      'Notable exceptions or changes are noted.',
      'Objective tone — no personal opinions.',
    ],
  },
];

/* -------------------------------------------------------------------------- */
/* 3. Grammar MCQs                                                             */
/* -------------------------------------------------------------------------- */

/** A grammar area used to group/filter the grammar MCQs. */
export interface GrammarArea {
  /** The tag stored on each MCQItem in {@link grammarMCQs}. */
  tag: string;
  /** Human-readable label for the filter control. */
  label: string;
}

/** The grammar areas, in teaching order (drive the practice filter). */
export const GRAMMAR_AREAS: readonly GrammarArea[] = [
  { tag: 'tenses', label: 'Tenses' },
  { tag: 'voice', label: 'Active / Passive voice' },
  { tag: 'narration', label: 'Narration (direct / indirect)' },
  { tag: 'transformation', label: 'Transformation of sentences' },
  { tag: 'articles', label: 'Articles & determiners' },
  { tag: 'prepositions', label: 'Prepositions' },
  { tag: 'phrasal-verbs', label: 'Phrasal verbs' },
  { tag: 'idioms', label: 'Idioms' },
  { tag: 'synonyms-antonyms', label: 'Synonyms & antonyms' },
  { tag: 'one-word', label: 'One-word substitution' },
  { tag: 'cohesive-devices', label: 'Cohesive devices' },
  { tag: 'affixes', label: 'Affixes (prefix / suffix)' },
  { tag: 'confusables', label: 'Confusables (homophones)' },
];

/**
 * Grammar practice questions — MCQItem-shaped and passed DIRECTLY to the shared
 * quiz runner (not via the content manifest). Each has four options, one
 * verified correct answer, an explanation and an area tag; `answerIndex` is
 * varied across the set.
 */
export const grammarMCQs: MCQItem[] = [
  // ---- Tenses ----
  {
    id: 'eng-gram-1',
    subjectCode: 'ENG',
    tier: 1,
    question: 'She ___ in Hyderabad since 2010.',
    options: ['lives', 'is living', 'has lived', 'lived'],
    answerIndex: 2,
    explanation: "'Since' + a point in time with an action continuing to now takes the present perfect: 'has lived'.",
    tags: ['tenses'],
  },
  {
    id: 'eng-gram-2',
    subjectCode: 'ENG',
    tier: 2,
    question: 'By the time the guests arrived, she ___ the food.',
    options: ['cooked', 'has cooked', 'had cooked', 'was cook'],
    answerIndex: 2,
    explanation: 'The past perfect (had cooked) shows the cooking finished before another past action (the guests arrived).',
    tags: ['tenses'],
  },
  {
    id: 'eng-gram-3',
    subjectCode: 'ENG',
    tier: 2,
    question: 'This time tomorrow, I ___ on a beach.',
    options: ['will lie', 'will be lying', 'will have lain', 'lie'],
    answerIndex: 1,
    explanation: 'The future continuous (will be lying) describes an action in progress at a specific future time.',
    tags: ['tenses'],
  },
  // ---- Voice ----
  {
    id: 'eng-gram-4',
    subjectCode: 'ENG',
    tier: 1,
    question: 'Change to passive: "The teacher praised the students."',
    options: [
      'The students were praised by the teacher.',
      'The students are praised by the teacher.',
      'The students praised by the teacher.',
      'The students have praised the teacher.',
    ],
    answerIndex: 0,
    explanation: 'Simple past active → was/were + past participle: "were praised by the teacher".',
    tags: ['voice'],
  },
  {
    id: 'eng-gram-5',
    subjectCode: 'ENG',
    tier: 2,
    question: 'Change to passive: "People speak English all over the world."',
    options: [
      'English was spoken all over the world.',
      'English is speaking all over the world.',
      'English is spoken all over the world.',
      'English has spoken all over the world.',
    ],
    answerIndex: 2,
    explanation: 'Present simple active → is/are + past participle: "English is spoken".',
    tags: ['voice'],
  },
  {
    id: 'eng-gram-6',
    subjectCode: 'ENG',
    tier: 3,
    question: 'Change to passive: "Who wrote this letter?"',
    options: [
      'By whom this letter was written?',
      'By whom was this letter written?',
      'Whom was this letter written?',
      'By who was this letter written?',
    ],
    answerIndex: 1,
    explanation: "A 'who' subject question becomes 'By whom was ... written?' — 'whom' after the preposition 'by'.",
    tags: ['voice'],
  },
  // ---- Narration ----
  {
    id: 'eng-gram-7',
    subjectCode: 'ENG',
    tier: 2,
    question: 'Report: He said, "I am busy now."',
    options: [
      'He said that he is busy then.',
      'He said that he was busy then.',
      'He said that he was busy now.',
      'He says that he was busy then.',
    ],
    answerIndex: 1,
    explanation: "Present → past (am → was) and 'now' → 'then' in indirect speech.",
    tags: ['narration'],
  },
  {
    id: 'eng-gram-8',
    subjectCode: 'ENG',
    tier: 2,
    question: 'Report: She said, "Where are you going?"',
    options: [
      'She asked where I was going.',
      'She asked where I am going.',
      'She asked where was I going.',
      'She said where I was going.',
    ],
    answerIndex: 0,
    explanation: "A wh- question is reported with 'asked' + wh-word and normal (subject–verb) word order, tense back-shifted.",
    tags: ['narration'],
  },
  {
    id: 'eng-gram-9',
    subjectCode: 'ENG',
    tier: 3,
    question: 'Report: He said to me, "Please help me."',
    options: [
      'He said to help him.',
      'He told me help him.',
      'He requested me to help him.',
      'He asked helping him.',
    ],
    answerIndex: 2,
    explanation: "A polite request is reported with 'requested/asked' + object + to-infinitive: 'requested me to help him'.",
    tags: ['narration'],
  },
  // ---- Transformation ----
  {
    id: 'eng-gram-10',
    subjectCode: 'ENG',
    tier: 2,
    question: 'Rewrite: "He is too weak to walk."',
    options: [
      'He is so weak that he can walk.',
      'He is so weak that he cannot walk.',
      'He is very weak to walk.',
      'He is weak so he walks.',
    ],
    answerIndex: 1,
    explanation: "'too ... to' becomes 'so ... that + cannot': 'so weak that he cannot walk'.",
    tags: ['transformation'],
  },
  {
    id: 'eng-gram-11',
    subjectCode: 'ENG',
    tier: 2,
    question: 'Fill in: "No sooner did he reach the station ___ the train left."',
    options: ['then', 'than', 'when', 'that'],
    answerIndex: 1,
    explanation: "'No sooner' is correlated with 'than': No sooner ... than ...",
    tags: ['transformation'],
  },
  {
    id: 'eng-gram-12',
    subjectCode: 'ENG',
    tier: 3,
    question: 'Change to the positive degree: "Mumbai is one of the largest cities in India."',
    options: [
      'Very few cities in India are as large as Mumbai.',
      'No other city in India is larger than Mumbai.',
      'Mumbai is larger than most cities.',
      'Few cities are large as Mumbai.',
    ],
    answerIndex: 0,
    explanation: "'One of the largest' in the positive degree becomes 'Very few ... are as large as ...'.",
    tags: ['transformation'],
  },
  // ---- Articles & determiners ----
  {
    id: 'eng-gram-13',
    subjectCode: 'ENG',
    tier: 2,
    question: 'Fill in: "He is ___ European by birth."',
    options: ['a', 'an', 'the', 'no article'],
    answerIndex: 0,
    explanation: "'European' begins with a consonant /j/ sound ('yoo-'), so it takes 'a', not 'an'.",
    tags: ['articles'],
  },
  {
    id: 'eng-gram-14',
    subjectCode: 'ENG',
    tier: 1,
    question: 'Fill in: "___ sun rises in the east."',
    options: ['A', 'An', 'The', 'No article'],
    answerIndex: 2,
    explanation: "Unique objects like the sun take the definite article 'the'.",
    tags: ['articles'],
  },
  {
    id: 'eng-gram-15',
    subjectCode: 'ENG',
    tier: 2,
    question: 'Fill in: "I have very ___ friends here, so I feel lonely."',
    options: ['a few', 'few', 'a little', 'little'],
    answerIndex: 1,
    explanation: "'few' (countable, negative sense = hardly any) fits the lonely context; 'a few' would be positive.",
    tags: ['articles'],
  },
  // ---- Prepositions ----
  {
    id: 'eng-gram-16',
    subjectCode: 'ENG',
    tier: 1,
    question: 'Fill in: "She is married ___ a doctor."',
    options: ['with', 'to', 'by', 'for'],
    answerIndex: 1,
    explanation: "The fixed collocation is 'married to' someone.",
    tags: ['prepositions'],
  },
  {
    id: 'eng-gram-17',
    subjectCode: 'ENG',
    tier: 1,
    question: 'Fill in: "The train arrives ___ 6 o\u2019clock."',
    options: ['in', 'on', 'at', 'by'],
    answerIndex: 2,
    explanation: "Use 'at' with clock times: 'at 6 o\u2019clock'.",
    tags: ['prepositions'],
  },
  {
    id: 'eng-gram-18',
    subjectCode: 'ENG',
    tier: 2,
    question: 'Fill in: "He has been living here ___ five years."',
    options: ['since', 'for', 'from', 'in'],
    answerIndex: 1,
    explanation: "Use 'for' with a period of time (five years); 'since' is for a point in time.",
    tags: ['prepositions'],
  },
  // ---- Phrasal verbs ----
  {
    id: 'eng-gram-19',
    subjectCode: 'ENG',
    tier: 1,
    question: 'Fill in: "The plane will ___ at 9 a.m." (leave the ground)',
    options: ['take off', 'take up', 'take in', 'take over'],
    answerIndex: 0,
    explanation: "'take off' means (of an aircraft) to leave the ground and begin to fly.",
    tags: ['phrasal-verbs'],
  },
  {
    id: 'eng-gram-20',
    subjectCode: 'ENG',
    tier: 2,
    question: 'Fill in: "I won\u2019t ___ his rude behaviour any longer." (tolerate)',
    options: ['put off', 'put on', 'put up with', 'put down'],
    answerIndex: 2,
    explanation: "'put up with' means to tolerate or endure something unpleasant.",
    tags: ['phrasal-verbs'],
  },
  {
    id: 'eng-gram-21',
    subjectCode: 'ENG',
    tier: 1,
    question: 'Fill in: "Please ___ the light; it\u2019s getting dark." (switch on)',
    options: ['turn down', 'turn off', 'turn up', 'turn on'],
    answerIndex: 3,
    explanation: "'turn on' means to switch on a device or light.",
    tags: ['phrasal-verbs'],
  },
  // ---- Idioms ----
  {
    id: 'eng-gram-22',
    subjectCode: 'ENG',
    tier: 2,
    question: "The idiom 'to bury the hatchet' means to ___.",
    options: ['start a fight', 'make peace', 'dig a hole', 'hide a weapon'],
    answerIndex: 1,
    explanation: "'Bury the hatchet' means to end a quarrel and make peace.",
    tags: ['idioms'],
  },
  {
    id: 'eng-gram-23',
    subjectCode: 'ENG',
    tier: 1,
    question: "The idiom 'once in a blue moon' means ___.",
    options: ['very rarely', 'every month', 'only at night', 'very often'],
    answerIndex: 0,
    explanation: "'Once in a blue moon' means very rarely.",
    tags: ['idioms'],
  },
  {
    id: 'eng-gram-24',
    subjectCode: 'ENG',
    tier: 2,
    question: "The idiom 'to let the cat out of the bag' means to ___.",
    options: ['buy a pet', 'reveal a secret', 'make a mistake', 'run away'],
    answerIndex: 1,
    explanation: "'Let the cat out of the bag' means to reveal a secret (often by accident).",
    tags: ['idioms'],
  },
  // ---- Synonyms & antonyms ----
  {
    id: 'eng-gram-25',
    subjectCode: 'ENG',
    tier: 2,
    question: "Choose the SYNONYM of 'BENEVOLENT'.",
    options: ['cruel', 'kind', 'jealous', 'lazy'],
    answerIndex: 1,
    explanation: "'Benevolent' means kind and generous.",
    tags: ['synonyms-antonyms'],
  },
  {
    id: 'eng-gram-26',
    subjectCode: 'ENG',
    tier: 3,
    question: "Choose the ANTONYM of 'CANDID'.",
    options: ['frank', 'truthful', 'evasive', 'blunt'],
    answerIndex: 2,
    explanation: "'Candid' means open/frank; its opposite is 'evasive' (avoiding a direct answer).",
    tags: ['synonyms-antonyms'],
  },
  {
    id: 'eng-gram-27',
    subjectCode: 'ENG',
    tier: 1,
    question: "Choose the SYNONYM of 'ABUNDANT'.",
    options: ['scarce', 'rare', 'meagre', 'plentiful'],
    answerIndex: 3,
    explanation: "'Abundant' means existing in large quantities — 'plentiful'.",
    tags: ['synonyms-antonyms'],
  },
  // ---- One-word substitution ----
  {
    id: 'eng-gram-28',
    subjectCode: 'ENG',
    tier: 2,
    question: 'A person who cannot read or write is ___.',
    options: ['illegible', 'illiterate', 'ignorant', 'illegal'],
    answerIndex: 1,
    explanation: "'Illiterate' = unable to read or write. ('Illegible' describes handwriting that cannot be read.)",
    tags: ['one-word'],
  },
  {
    id: 'eng-gram-29',
    subjectCode: 'ENG',
    tier: 2,
    question: 'A place where birds are kept is ___.',
    options: ['apiary', 'aquarium', 'orchard', 'aviary'],
    answerIndex: 3,
    explanation: "An 'aviary' houses birds. (An apiary is for bees; an aquarium for fish; an orchard for fruit trees.)",
    tags: ['one-word'],
  },
  {
    id: 'eng-gram-30',
    subjectCode: 'ENG',
    tier: 2,
    question: 'One who speaks many languages is a ___.',
    options: ['polyglot', 'linguist', 'bilingual', 'novice'],
    answerIndex: 0,
    explanation: "A 'polyglot' knows and uses several languages.",
    tags: ['one-word'],
  },
  // ---- Cohesive devices ----
  {
    id: 'eng-gram-31',
    subjectCode: 'ENG',
    tier: 2,
    question: 'Fill in: "He worked hard; ___, he failed the exam."',
    options: ['therefore', 'however', 'moreover', 'so'],
    answerIndex: 1,
    explanation: "A contrast between effort and failure needs 'however'.",
    tags: ['cohesive-devices'],
  },
  {
    id: 'eng-gram-32',
    subjectCode: 'ENG',
    tier: 2,
    question: 'Fill in: "___ the heavy rain, the match went on."',
    options: ['Because of', 'Despite', 'Owing to', 'Due to'],
    answerIndex: 1,
    explanation: "'Despite' + noun shows concession (the rain did not stop the match).",
    tags: ['cohesive-devices'],
  },
  {
    id: 'eng-gram-33',
    subjectCode: 'ENG',
    tier: 3,
    question: 'Fill in: "She was seriously ill; ___, she attended the meeting."',
    options: ['nevertheless', 'hence', 'thus', 'consequently'],
    answerIndex: 0,
    explanation: "'Nevertheless' signals a contrast — she attended in spite of being ill.",
    tags: ['cohesive-devices'],
  },
  // ---- Affixes ----
  {
    id: 'eng-gram-34',
    subjectCode: 'ENG',
    tier: 2,
    question: "In 'misunderstand', the prefix 'mis-' means ___.",
    options: ['again', 'wrongly', 'before', 'not'],
    answerIndex: 1,
    explanation: "The prefix 'mis-' means wrongly or badly (to understand wrongly).",
    tags: ['affixes'],
  },
  {
    id: 'eng-gram-35',
    subjectCode: 'ENG',
    tier: 1,
    question: "Choose the correct suffix: a person without fear is 'fear___'.",
    options: ['-ful', '-less', '-ness', '-ment'],
    answerIndex: 1,
    explanation: "The suffix '-less' means 'without': fearless = without fear.",
    tags: ['affixes'],
  },
  {
    id: 'eng-gram-36',
    subjectCode: 'ENG',
    tier: 2,
    question: "In 'biography', the root 'bio-' means ___.",
    options: ['book', 'self', 'life', 'write'],
    answerIndex: 2,
    explanation: "'bio-' means life; a biography is an account of a person\u2019s life.",
    tags: ['affixes'],
  },
  // ---- Confusables ----
  {
    id: 'eng-gram-37',
    subjectCode: 'ENG',
    tier: 2,
    question: 'Choose the correct word: "The bad weather will ___ our travel plans."',
    options: ['affect', 'effect', 'accept', 'except'],
    answerIndex: 0,
    explanation: "'Affect' is the verb (to influence); 'effect' is usually the noun (a result).",
    tags: ['confusables'],
  },
  {
    id: 'eng-gram-38',
    subjectCode: 'ENG',
    tier: 1,
    question: 'Choose the correct word: "___ going to visit their grandparents."',
    options: ['Their', 'There', "They\u2019re", 'Theyre'],
    answerIndex: 2,
    explanation: "'They\u2019re' = 'they are'. ('Their' shows possession; 'there' shows place.)",
    tags: ['confusables'],
  },
  {
    id: 'eng-gram-39',
    subjectCode: 'ENG',
    tier: 2,
    question: 'Choose the correct word: "I bought pens and files from the ___ shop."',
    options: ['stationary', 'stationery', 'stationnary', 'stationary\u2019s'],
    answerIndex: 1,
    explanation: "'Stationery' (with an -e-) means writing materials; 'stationary' means not moving.",
    tags: ['confusables'],
  },
];

/* -------------------------------------------------------------------------- */
/* 4. Reading comprehension                                                    */
/* -------------------------------------------------------------------------- */

/** An unseen passage with its comprehension questions (quiz-runner ready). */
export interface ReadingPassage {
  /** Stable id (also used for section anchors). */
  id: string;
  /** Passage title. */
  title: string;
  /** The passage text (~200 words). */
  text: string;
  /** MCQItem-shaped comprehension questions. */
  questions: MCQItem[];
}

/** One or two short passages, each with 4–5 comprehension MCQs. */
export const readingComprehension: readonly ReadingPassage[] = [
  {
    id: 'eng-rc-water',
    title: 'The Value of Water',
    text: [
      'Water is one of the most precious resources on the planet, yet it is often taken for granted. Although nearly three-quarters of the Earth\u2019s surface is covered with water, less than three per cent of it is fresh water fit for human use, and much of that is locked away in glaciers and ice caps. As populations grow and cities expand, the demand for clean water rises sharply, while pollution and wasteful habits steadily shrink the supply.',
      'In many parts of the world, groundwater is being pumped out far faster than rain can replenish it, causing wells to run dry and rivers to shrink. Experts warn that unless people change the way they use water, severe shortages could become common within a few decades.',
      'The good news is that small, everyday actions can make a real difference. Fixing leaking taps, harvesting rainwater, reusing household water for gardens, and choosing crops that need less irrigation all help to conserve this vital resource. Governments, too, must invest in efficient systems and educate citizens. Water conservation is not merely the responsibility of a few; it is a shared duty that demands the cooperation of individuals, communities and nations alike.',
    ].join('\n\n'),
    questions: [
      {
        id: 'eng-rc-1',
        subjectCode: 'ENG',
        tier: 1,
        question: 'The passage is mainly about ___.',
        options: ['the beauty of oceans', 'the need to conserve water', 'the causes of air pollution', 'modern farming methods'],
        answerIndex: 1,
        explanation: 'The passage argues for conserving water as a shared duty — that is its central idea.',
        tags: ['reading-comprehension'],
      },
      {
        id: 'eng-rc-2',
        subjectCode: 'ENG',
        tier: 2,
        question: 'According to the passage, how much of the Earth\u2019s water is fresh water fit for human use?',
        options: ['about three-quarters', 'less than three per cent', 'nearly half', 'none at all'],
        answerIndex: 1,
        explanation: 'The passage states that less than three per cent is fresh water fit for human use.',
        tags: ['reading-comprehension'],
      },
      {
        id: 'eng-rc-3',
        subjectCode: 'ENG',
        tier: 2,
        question: 'Why are wells running dry in many places?',
        options: [
          'Groundwater is pumped out faster than rain can replenish it.',
          'Rain has stopped completely.',
          'People no longer dig wells.',
          'The glaciers have all melted.',
        ],
        answerIndex: 0,
        explanation: 'The passage says groundwater is pumped out far faster than rain can replenish it.',
        tags: ['reading-comprehension'],
      },
      {
        id: 'eng-rc-4',
        subjectCode: 'ENG',
        tier: 2,
        question: "In the passage, the word 'replenish' most nearly means ___.",
        options: ['empty', 'refill', 'pollute', 'freeze'],
        answerIndex: 1,
        explanation: "'Replenish' means to fill up or restore a supply — 'refill'.",
        tags: ['reading-comprehension'],
      },
      {
        id: 'eng-rc-5',
        subjectCode: 'ENG',
        tier: 2,
        question: 'The passage suggests that conserving water is ___.',
        options: ["only the government\u2019s job", 'a shared responsibility', 'impossible to achieve', 'unnecessary'],
        answerIndex: 1,
        explanation: 'The closing line calls it a shared duty of individuals, communities and nations.',
        tags: ['reading-comprehension'],
      },
    ],
  },
  {
    id: 'eng-rc-reading',
    title: 'The Habit of Reading',
    text: [
      'Reading is a habit that rewards those who practise it throughout their lives. Unlike watching television or scrolling through a phone, reading a book demands active attention: the mind must picture scenes, follow arguments and weigh ideas. This effort strengthens concentration and slowly builds a richer vocabulary, both of which are useful far beyond the classroom. A good book can also carry a reader into worlds and times that would otherwise remain out of reach, nurturing imagination and empathy for people whose lives differ from one\u2019s own.',
      'Sadly, in an age of endless digital distraction, many young people read less than earlier generations did. They often complain that they have no time, yet they spend hours on games and social media. The solution is not to abandon technology but to make room for reading beside it. Setting aside even twenty minutes a day, keeping a book within easy reach and choosing subjects that genuinely interest one can turn reading from a chore into a pleasure.',
      'In the end, a person who reads regularly gains knowledge, sharpens the mind and finds a companion that never disappoints.',
    ].join('\n\n'),
    questions: [
      {
        id: 'eng-rc-6',
        subjectCode: 'ENG',
        tier: 1,
        question: 'The main purpose of the passage is to ___.',
        options: ['criticise all technology', 'highlight the value of reading', 'describe library buildings', 'explain how to write books'],
        answerIndex: 1,
        explanation: 'The passage praises reading and encourages the habit — that is its purpose.',
        tags: ['reading-comprehension'],
      },
      {
        id: 'eng-rc-7',
        subjectCode: 'ENG',
        tier: 2,
        question: 'According to the passage, reading a book differs from watching television because it ___.',
        options: ['requires active attention', 'is always boring', 'needs no vocabulary', 'wastes time'],
        answerIndex: 0,
        explanation: 'The passage says reading demands active attention, unlike watching television.',
        tags: ['reading-comprehension'],
      },
      {
        id: 'eng-rc-8',
        subjectCode: 'ENG',
        tier: 2,
        question: 'What reason do young people often give for reading less?',
        options: ['Books are too expensive.', 'They have no time.', 'Libraries are closed.', 'Reading is banned.'],
        answerIndex: 1,
        explanation: 'The passage notes they complain of having no time, though they spend hours on games and social media.',
        tags: ['reading-comprehension'],
      },
      {
        id: 'eng-rc-9',
        subjectCode: 'ENG',
        tier: 3,
        question: 'The passage implies that technology and reading ___.',
        options: ['cannot exist together', 'can be balanced', 'are equally harmful', 'must both be avoided'],
        answerIndex: 1,
        explanation: 'It says the solution is not to abandon technology but to make room for reading beside it — they can be balanced.',
        tags: ['reading-comprehension'],
      },
    ],
  },
];

/** Every reading-comprehension question, flattened (in passage order). */
export const allRcQuestions: MCQItem[] = readingComprehension.flatMap((p) => p.questions);
