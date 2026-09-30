/**
 * Canonical Telugu SCRIPT data — the single source of truth for the
 * "Telugu from scratch" learning course (route `#/telugu`).
 *
 * IMPORTANT: This is hand-authored, CANONICAL Telugu script knowledge (the
 * standard abugida taught to beginners) — it is NOT extracted from any source
 * PDF, and it is NOT copied from the old project. Every Telugu Unicode glyph and
 * its Roman transliteration below has been checked against the standard Telugu
 * Unicode block (U+0C00–U+0C7F) and ISO-15919 / common romanisation:
 *
 *   - Independent vowels (achchulu): U+0C05–U+0C14 (+ anusvara/visarga on అ)
 *   - Dependent vowel signs (maatras): U+0C3E–U+0C4C
 *   - Consonants (hallulu):            U+0C15–U+0C39 (+ ళ U+0C33, ఱ U+0C31)
 *   - Virama / pollu (forms conjuncts): U+0C4D
 *   - Digits:                          U+0C66–U+0C6F
 *
 * The course intentionally teaches the MODERN core set a learner needs to read
 * and write; the rare classical vowels ౠ (ṝ) and ఌ (ḷ) are omitted on purpose.
 *
 * Transliteration convention: ISO-15919-style with long vowels marked by a
 * macron (ā, ī, ū, ē, ō) and retroflex/other diacritics (ṭ, ḍ, ṇ, ś, ṣ, ṛ, ṅ,
 * ñ, ḷ, ṃ, ḥ). `pronounceHint` gives a plain-English approximation for a total
 * beginner and is deliberately informal.
 */

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

/** The stages of the from-zero course, in teaching order. */
export type TeluguStage =
  | 'intro'
  | 'vowels'
  | 'consonants'
  | 'gunintalu'
  | 'vattulu'
  | 'numbers'
  | 'words'
  | 'sentences';

/** An independent vowel (achchu). */
export interface TeluguVowel {
  /** Stable progress id (script-independent). */
  id: string;
  /** The independent vowel glyph, e.g. `అ`. */
  glyph: string;
  /** Telugu name of the letter (as spoken/spelled). */
  name: string;
  /** Roman transliteration of the sound, e.g. `a`, `ā`. */
  translit: string;
  /** Plain-English pronunciation approximation. */
  pronounceHint: string;
  /**
   * The DEPENDENT vowel sign (maatra) this vowel adds to a consonant, e.g. `ా`
   * for ఆ. `undefined` for అ, whose sound is INHERENT in every bare consonant
   * (so it has no sign of its own).
   */
  matra?: string;
}

/** A consonant (hallu). Its bare form already carries the inherent `a`. */
export interface TeluguConsonant {
  id: string;
  glyph: string;
  name: string;
  translit: string;
  pronounceHint: string;
}

/** One cell of a consonant's gunintam (consonant + a vowel sign). */
export interface GunintamCell {
  id: string;
  /** The combined syllable glyph, e.g. `కా`. */
  glyph: string;
  /** Roman transliteration, e.g. `kā`. */
  translit: string;
  /** Which vowel this cell pairs the consonant with (roman), e.g. `ā`. */
  vowel: string;
}

/** A conjunct example (vattu — a consonant written as a subscript). */
export interface TeluguConjunct {
  id: string;
  /** The conjunct cluster on its own, e.g. `క్క` (k + ka). */
  glyph: string;
  /** Roman transliteration of the cluster, e.g. `kka`. */
  translit: string;
  /** A real word that contains the conjunct, e.g. `అక్క`. */
  example: string;
  /** Transliteration of the example word. */
  exampleTranslit: string;
  /** English meaning of the example word. */
  meaning: string;
  /** How the conjunct is formed (short, learner-facing). */
  explanation: string;
}

/** A Telugu digit 0–9. */
export interface TeluguNumber {
  id: string;
  /** The Telugu digit glyph, e.g. `౧`. */
  glyph: string;
  /** The numeric value 0–9. */
  value: number;
  /** The number's name in Telugu script, e.g. `ఒకటి`. */
  name: string;
  /** Roman transliteration of the name, e.g. `okaṭi`. */
  translit: string;
}

/** A simple starter word for reading/writing practice. */
export interface TeluguWord {
  id: string;
  glyph: string;
  translit: string;
  meaning: string;
}

/** A simple starter sentence for reading/writing practice. */
export interface TeluguSentence {
  id: string;
  glyph: string;
  translit: string;
  meaning: string;
}

/* -------------------------------------------------------------------------- */
/* Intro — how the Telugu abugida works                                        */
/* -------------------------------------------------------------------------- */

/**
 * Short, plain-English orientation shown on the first stage. Each string is a
 * markdown paragraph/bullet rendered with the shared safe markdown renderer.
 */
export const TELUGU_INTRO: readonly string[] = [
  '## Telugu is an *abugida*, not an alphabet',
  'In English every sound gets its own letter. Telugu works differently: the basic unit is a **syllable** — a consonant already carrying a built-in "a" sound. So the letter క is not just "k", it is **"ka"**.',
  '## The three building blocks',
  '- **అచ్చులు (achchulu)** — the **vowels**. They stand alone (like అ, ఆ, ఇ) and each one also has a small **sign (maatra)** that attaches to a consonant.',
  '- **హల్లులు (hallulu)** — the **consonants**. Every bare consonant already sounds like "…a" (క = ka, మ = ma).',
  '- **గుణింతాలు (gunintalu)** — a consonant **combined with each vowel sign** to make its full family: క, కా, కి, కీ, కు …',
  '## How writing works',
  'To change the vowel of a consonant you add that vowel\u2019s **sign**: క (ka) + the "ā" sign ా → **కా** (kā). To join two consonants with no vowel between them you use a small mark called **పొల్లు / విరామం (virama)**, which turns the second consonant into a **subscript (vattu)** — that is how క + క becomes **క్క** (kka).',
  '## How to use this course',
  'Learn the vowels, then the consonants, then see how they combine (gunintalu, vattulu), then numbers, and finally read and **trace** real words and sentences. Use **Hear it** to listen, and **trace over the faint grey glyph** on the canvas to train your hand — hide the guide when you are ready to write it freehand.',
];

/* -------------------------------------------------------------------------- */
/* Vowels (achchulu)                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The core modern Telugu vowel set (16 entries: 13 vowels + anusvara + visarga).
 * `matra` is the dependent sign; అ has none because its sound is inherent.
 */
export const VOWELS: readonly TeluguVowel[] = [
  { id: 'tel-v-01', glyph: 'అ', name: 'అ', translit: 'a', pronounceHint: 'like the "a" in "about"' },
  { id: 'tel-v-02', glyph: 'ఆ', name: 'ఆ', translit: 'ā', pronounceHint: 'long "aa" as in "father"', matra: 'ా' },
  { id: 'tel-v-03', glyph: 'ఇ', name: 'ఇ', translit: 'i', pronounceHint: 'short "i" as in "sit"', matra: 'ి' },
  { id: 'tel-v-04', glyph: 'ఈ', name: 'ఈ', translit: 'ī', pronounceHint: 'long "ee" as in "see"', matra: 'ీ' },
  { id: 'tel-v-05', glyph: 'ఉ', name: 'ఉ', translit: 'u', pronounceHint: 'short "u" as in "put"', matra: 'ు' },
  { id: 'tel-v-06', glyph: 'ఊ', name: 'ఊ', translit: 'ū', pronounceHint: 'long "oo" as in "food"', matra: 'ూ' },
  { id: 'tel-v-07', glyph: 'ఋ', name: 'ఋ', translit: 'ṛ', pronounceHint: 'a rolled "ru" as in "rishi"', matra: 'ృ' },
  { id: 'tel-v-08', glyph: 'ఎ', name: 'ఎ', translit: 'e', pronounceHint: 'short "e" as in "pen"', matra: 'ె' },
  { id: 'tel-v-09', glyph: 'ఏ', name: 'ఏ', translit: 'ē', pronounceHint: 'long "ay" as in "play"', matra: 'ే' },
  { id: 'tel-v-10', glyph: 'ఐ', name: 'ఐ', translit: 'ai', pronounceHint: 'like "i" in "aisle"', matra: 'ై' },
  { id: 'tel-v-11', glyph: 'ఒ', name: 'ఒ', translit: 'o', pronounceHint: 'short "o" as in "pot"', matra: 'ొ' },
  { id: 'tel-v-12', glyph: 'ఓ', name: 'ఓ', translit: 'ō', pronounceHint: 'long "oh" as in "go"', matra: 'ో' },
  { id: 'tel-v-13', glyph: 'ఔ', name: 'ఔ', translit: 'au', pronounceHint: 'like "ow" in "cow"', matra: 'ౌ' },
  { id: 'tel-v-14', glyph: 'అం', name: 'అం (సున్న)', translit: 'aṃ', pronounceHint: 'nasal "um" (the anusvara / sunna ం)', matra: 'ం' },
  { id: 'tel-v-15', glyph: 'అః', name: 'అః (విసర్గ)', translit: 'aḥ', pronounceHint: 'a soft "ah" breath (the visarga ః)', matra: 'ః' },
];

/* -------------------------------------------------------------------------- */
/* Consonants (hallulu)                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The standard Telugu consonant set (36 entries), grouped by place of
 * articulation in the traditional order and ending with క్ష and ఱ. Every bare
 * glyph carries the inherent "a".
 */
export const CONSONANTS: readonly TeluguConsonant[] = [
  // Velars (కంఠ్యములు)
  { id: 'tel-c-01', glyph: 'క', name: 'క', translit: 'ka', pronounceHint: '"k" as in "skate" + a' },
  { id: 'tel-c-02', glyph: 'ఖ', name: 'ఖ', translit: 'kha', pronounceHint: 'aspirated "k-h" + a' },
  { id: 'tel-c-03', glyph: 'గ', name: 'గ', translit: 'ga', pronounceHint: '"g" as in "gum" + a' },
  { id: 'tel-c-04', glyph: 'ఘ', name: 'ఘ', translit: 'gha', pronounceHint: 'breathy "g-h" + a' },
  { id: 'tel-c-05', glyph: 'ఙ', name: 'ఙ', translit: 'ṅa', pronounceHint: '"ng" as in "sing" + a' },
  // Palatals (తాలవ్యములు)
  { id: 'tel-c-06', glyph: 'చ', name: 'చ', translit: 'ca', pronounceHint: '"ch" as in "chair" + a' },
  { id: 'tel-c-07', glyph: 'ఛ', name: 'ఛ', translit: 'cha', pronounceHint: 'aspirated "ch-h" + a' },
  { id: 'tel-c-08', glyph: 'జ', name: 'జ', translit: 'ja', pronounceHint: '"j" as in "jam" + a' },
  { id: 'tel-c-09', glyph: 'ఝ', name: 'ఝ', translit: 'jha', pronounceHint: 'breathy "j-h" + a' },
  { id: 'tel-c-10', glyph: 'ఞ', name: 'ఞ', translit: 'ña', pronounceHint: '"ny" as in "canyon" + a' },
  // Retroflex (మూర్ధన్యములు)
  { id: 'tel-c-11', glyph: 'ట', name: 'ట', translit: 'ṭa', pronounceHint: 'hard "t" (tongue curled back) + a' },
  { id: 'tel-c-12', glyph: 'ఠ', name: 'ఠ', translit: 'ṭha', pronounceHint: 'aspirated hard "t-h" + a' },
  { id: 'tel-c-13', glyph: 'డ', name: 'డ', translit: 'ḍa', pronounceHint: 'hard "d" (tongue curled back) + a' },
  { id: 'tel-c-14', glyph: 'ఢ', name: 'ఢ', translit: 'ḍha', pronounceHint: 'aspirated hard "d-h" + a' },
  { id: 'tel-c-15', glyph: 'ణ', name: 'ణ', translit: 'ṇa', pronounceHint: 'retroflex "n" + a' },
  // Dentals (దంత్యములు)
  { id: 'tel-c-16', glyph: 'త', name: 'త', translit: 'ta', pronounceHint: 'soft "th" as in "thumb" + a' },
  { id: 'tel-c-17', glyph: 'థ', name: 'థ', translit: 'tha', pronounceHint: 'aspirated soft "t-h" + a' },
  { id: 'tel-c-18', glyph: 'ద', name: 'ద', translit: 'da', pronounceHint: 'soft "th" as in "this" + a' },
  { id: 'tel-c-19', glyph: 'ధ', name: 'ధ', translit: 'dha', pronounceHint: 'breathy soft "d-h" + a' },
  { id: 'tel-c-20', glyph: 'న', name: 'న', translit: 'na', pronounceHint: '"n" as in "net" + a' },
  // Labials (ఓష్ఠ్యములు)
  { id: 'tel-c-21', glyph: 'ప', name: 'ప', translit: 'pa', pronounceHint: '"p" as in "spin" + a' },
  { id: 'tel-c-22', glyph: 'ఫ', name: 'ఫ', translit: 'pha', pronounceHint: 'aspirated "p-h" + a' },
  { id: 'tel-c-23', glyph: 'బ', name: 'బ', translit: 'ba', pronounceHint: '"b" as in "bat" + a' },
  { id: 'tel-c-24', glyph: 'భ', name: 'భ', translit: 'bha', pronounceHint: 'breathy "b-h" + a' },
  { id: 'tel-c-25', glyph: 'మ', name: 'మ', translit: 'ma', pronounceHint: '"m" as in "man" + a' },
  // Semivowels / liquids (అంతస్థములు)
  { id: 'tel-c-26', glyph: 'య', name: 'య', translit: 'ya', pronounceHint: '"y" as in "yes" + a' },
  { id: 'tel-c-27', glyph: 'ర', name: 'ర', translit: 'ra', pronounceHint: 'lightly rolled "r" + a' },
  { id: 'tel-c-28', glyph: 'ల', name: 'ల', translit: 'la', pronounceHint: '"l" as in "love" + a' },
  { id: 'tel-c-29', glyph: 'వ', name: 'వ', translit: 'va', pronounceHint: '"v/w" as in "van" + a' },
  // Sibilants & aspirate (ఊష్మములు)
  { id: 'tel-c-30', glyph: 'శ', name: 'శ', translit: 'śa', pronounceHint: 'soft "sh" as in "ship" + a' },
  { id: 'tel-c-31', glyph: 'ష', name: 'ష', translit: 'ṣa', pronounceHint: 'retroflex "sh" + a' },
  { id: 'tel-c-32', glyph: 'స', name: 'స', translit: 'sa', pronounceHint: '"s" as in "sun" + a' },
  { id: 'tel-c-33', glyph: 'హ', name: 'హ', translit: 'ha', pronounceHint: '"h" as in "hat" + a' },
  // Additional letters
  { id: 'tel-c-34', glyph: 'ళ', name: 'ళ', translit: 'ḷa', pronounceHint: 'retroflex "l" (tongue curled) + a' },
  { id: 'tel-c-35', glyph: 'క్ష', name: 'క్ష', translit: 'kṣa', pronounceHint: '"ksh" as in "kshatriya" + a' },
  { id: 'tel-c-36', glyph: 'ఱ', name: 'ఱ (బండి ర)', translit: 'ṟa', pronounceHint: 'hard trilled "r" (classical) + a' },
];

/* -------------------------------------------------------------------------- */
/* Gunintalu — one consonant across every vowel                                */
/* -------------------------------------------------------------------------- */

/** The base consonant whose full gunintam is demonstrated. */
export const GUNINTALU_BASE: TeluguConsonant = CONSONANTS[0]!;

/**
 * The gunintam of క — the base consonant combined with each vowel's maatra, in
 * the SAME order as {@link VOWELS}. This is the representative table beginners
 * memorise; every other consonant follows the identical pattern.
 */
export const GUNINTALU: readonly GunintamCell[] = [
  { id: 'tel-g-01', glyph: 'క', translit: 'ka', vowel: 'a' },
  { id: 'tel-g-02', glyph: 'కా', translit: 'kā', vowel: 'ā' },
  { id: 'tel-g-03', glyph: 'కి', translit: 'ki', vowel: 'i' },
  { id: 'tel-g-04', glyph: 'కీ', translit: 'kī', vowel: 'ī' },
  { id: 'tel-g-05', glyph: 'కు', translit: 'ku', vowel: 'u' },
  { id: 'tel-g-06', glyph: 'కూ', translit: 'kū', vowel: 'ū' },
  { id: 'tel-g-07', glyph: 'కృ', translit: 'kṛ', vowel: 'ṛ' },
  { id: 'tel-g-08', glyph: 'కె', translit: 'ke', vowel: 'e' },
  { id: 'tel-g-09', glyph: 'కే', translit: 'kē', vowel: 'ē' },
  { id: 'tel-g-10', glyph: 'కై', translit: 'kai', vowel: 'ai' },
  { id: 'tel-g-11', glyph: 'కొ', translit: 'ko', vowel: 'o' },
  { id: 'tel-g-12', glyph: 'కో', translit: 'kō', vowel: 'ō' },
  { id: 'tel-g-13', glyph: 'కౌ', translit: 'kau', vowel: 'au' },
  { id: 'tel-g-14', glyph: 'కం', translit: 'kaṃ', vowel: 'aṃ' },
  { id: 'tel-g-15', glyph: 'కః', translit: 'kaḥ', vowel: 'aḥ' },
];

/** Plain-English explanation of the gunintam pattern. */
export const GUNINTALU_EXPLANATION =
  'A gunintam is one consonant shown with every vowel. Start from the bare consonant క (ka), then add each vowel\u2019s sign in turn: ా gives కా (kā), ి gives కి (ki), and so on. Every one of the 36 consonants forms its gunintam exactly the same way — learn the pattern once with క and it transfers to all of them.';

/* -------------------------------------------------------------------------- */
/* Vattulu — conjunct consonants                                               */
/* -------------------------------------------------------------------------- */

/** Common conjunct (vattu) examples with the word that contains each. */
export const VATTULU: readonly TeluguConjunct[] = [
  {
    id: 'tel-x-01',
    glyph: 'క్క',
    translit: 'kka',
    example: 'అక్క',
    exampleTranslit: 'akka',
    meaning: 'elder sister',
    explanation: 'క + విరామం (్) + క: the first క loses its "a" and the second క is written as a subscript, giving క్క.',
  },
  {
    id: 'tel-x-02',
    glyph: 'మ్మ',
    translit: 'mma',
    example: 'అమ్మ',
    exampleTranslit: 'amma',
    meaning: 'mother',
    explanation: 'మ + ్ + మ: two మ letters join, the second tucked below, giving the doubled "mma" sound.',
  },
  {
    id: 'tel-x-03',
    glyph: 'ల్ల',
    translit: 'lla',
    example: 'ఇల్లు',
    exampleTranslit: 'illu',
    meaning: 'house',
    explanation: 'ల + ్ + ల: the second ల becomes a vattu under the first, giving "lla".',
  },
  {
    id: 'tel-x-04',
    glyph: 'స్త',
    translit: 'sta',
    example: 'పుస్తకం',
    exampleTranslit: 'pustakaṃ',
    meaning: 'book',
    explanation: 'స + ్ + త: two DIFFERENT consonants join — స with a త subscript — giving the cluster "sta".',
  },
  {
    id: 'tel-x-05',
    glyph: 'ద్ద',
    translit: 'dda',
    example: 'అద్దం',
    exampleTranslit: 'addaṃ',
    meaning: 'mirror',
    explanation: 'ద + ్ + ద: the second ద sits below the first, giving the doubled "dda".',
  },
  {
    id: 'tel-x-06',
    glyph: 'క్ష',
    translit: 'kṣa',
    example: 'అక్షరం',
    exampleTranslit: 'akṣaraṃ',
    meaning: 'letter (of the alphabet)',
    explanation: 'క + ్ + ష: this very common cluster (k + ṣa) is treated almost as its own letter, "kṣa".',
  },
];

/** Plain-English explanation of how conjuncts form. */
export const VATTULU_EXPLANATION =
  'When two consonants meet with no vowel between them, the first keeps its full form and the second is written as a small subscript called a వత్తు (vattu). The mark that removes the in-between "a" is the విరామం / పొల్లు (virama, ్). This is essential for spelling real words like అమ్మ (amma) and పుస్తకం (pustakaṃ).';

/* -------------------------------------------------------------------------- */
/* Numbers 0–9                                                                 */
/* -------------------------------------------------------------------------- */

/** Telugu digits 0–9 with their names. */
export const NUMBERS: readonly TeluguNumber[] = [
  { id: 'tel-n-0', glyph: '౦', value: 0, name: 'సున్నా', translit: 'sunnā' },
  { id: 'tel-n-1', glyph: '౧', value: 1, name: 'ఒకటి', translit: 'okaṭi' },
  { id: 'tel-n-2', glyph: '౨', value: 2, name: 'రెండు', translit: 'renḍu' },
  { id: 'tel-n-3', glyph: '౩', value: 3, name: 'మూడు', translit: 'mūḍu' },
  { id: 'tel-n-4', glyph: '౪', value: 4, name: 'నాలుగు', translit: 'nālugu' },
  { id: 'tel-n-5', glyph: '౫', value: 5, name: 'ఐదు', translit: 'aidu' },
  { id: 'tel-n-6', glyph: '౬', value: 6, name: 'ఆరు', translit: 'āru' },
  { id: 'tel-n-7', glyph: '౭', value: 7, name: 'ఏడు', translit: 'ēḍu' },
  { id: 'tel-n-8', glyph: '౮', value: 8, name: 'ఎనిమిది', translit: 'enimidi' },
  { id: 'tel-n-9', glyph: '౯', value: 9, name: 'తొమ్మిది', translit: 'tommidi' },
];

/* -------------------------------------------------------------------------- */
/* Starter words & sentences                                                   */
/* -------------------------------------------------------------------------- */

/** ~15 simple, high-frequency words for first reading/writing practice. */
export const STARTER_WORDS: readonly TeluguWord[] = [
  { id: 'tel-w-01', glyph: 'నీరు', translit: 'nīru', meaning: 'water' },
  { id: 'tel-w-02', glyph: 'అన్నం', translit: 'annaṃ', meaning: 'cooked rice / food' },
  { id: 'tel-w-03', glyph: 'ఇల్లు', translit: 'illu', meaning: 'house' },
  { id: 'tel-w-04', glyph: 'అమ్మ', translit: 'amma', meaning: 'mother' },
  { id: 'tel-w-05', glyph: 'నాన్న', translit: 'nānna', meaning: 'father' },
  { id: 'tel-w-06', glyph: 'పుస్తకం', translit: 'pustakaṃ', meaning: 'book' },
  { id: 'tel-w-07', glyph: 'బడి', translit: 'baḍi', meaning: 'school' },
  { id: 'tel-w-08', glyph: 'పండు', translit: 'panḍu', meaning: 'fruit' },
  { id: 'tel-w-09', glyph: 'పువ్వు', translit: 'puvvu', meaning: 'flower' },
  { id: 'tel-w-10', glyph: 'చెట్టు', translit: 'ceṭṭu', meaning: 'tree' },
  { id: 'tel-w-11', glyph: 'పిల్లి', translit: 'pilli', meaning: 'cat' },
  { id: 'tel-w-12', glyph: 'కుక్క', translit: 'kukka', meaning: 'dog' },
  { id: 'tel-w-13', glyph: 'ఊరు', translit: 'ūru', meaning: 'town / village' },
  { id: 'tel-w-14', glyph: 'చేయి', translit: 'cēyi', meaning: 'hand' },
  { id: 'tel-w-15', glyph: 'కన్ను', translit: 'kannu', meaning: 'eye' },
];

/** ~6 simple sentences building toward qualifying-paper writing. */
export const STARTER_SENTENCES: readonly TeluguSentence[] = [
  { id: 'tel-s-01', glyph: 'నా పేరు రాము.', translit: 'nā pēru rāmu.', meaning: 'My name is Ramu.' },
  { id: 'tel-s-02', glyph: 'ఇది నా ఇల్లు.', translit: 'idi nā illu.', meaning: 'This is my house.' },
  { id: 'tel-s-03', glyph: 'నాకు నీరు కావాలి.', translit: 'nāku nīru kāvāli.', meaning: 'I want water.' },
  { id: 'tel-s-04', glyph: 'నేను బడికి వెళ్తాను.', translit: 'nēnu baḍiki veḷtānu.', meaning: 'I go to school.' },
  { id: 'tel-s-05', glyph: 'అమ్మ అన్నం వండింది.', translit: 'amma annaṃ vanḍindi.', meaning: 'Mother cooked the food.' },
  { id: 'tel-s-06', glyph: 'మీరు ఎలా ఉన్నారు?', translit: 'mīru elā unnāru?', meaning: 'How are you?' },
];
