/**
 * Official APPSC Group-1 SCREENING (Prelims) exam pattern — the single source
 * of truth for the two objective papers a full-length mock must mirror.
 *
 * VERBATIM from the verified notification (Brief Notification No. 07/2026,
 * dt: 15/09/2026 — "SCHEME AND SYLLABUS FOR RECRUITMENT … SCREENING TEST"):
 *
 *   - Paper-I General Studies — "This paper consists of 04 parts i.e., ABCD
 *     each part carries 30 marks." → 120 Questions / 120 Minutes / 120 Marks.
 *       A. History and Culture.                              (30)
 *       B. Constitution, Polity, Social Justice & Int'l rel. (30)
 *       C. Indian and Andhra Pradesh Economy and Planning.   (30)
 *       D. Geography.                                        (30)
 *   - Paper-II General Aptitude — "This paper consists 2 parts i.e., A and B …
 *     (Part-A - 60 Marks, Part-B (i) - 30 Marks and B (ii) - 30 Marks)." → 120
 *     Questions / 120 Minutes / 120 Marks.
 *       A.   General Mental Ability, Administrative & Psychological Abilities. (60)
 *       B(i) Science and Technologies.                                        (30)
 *       B(ii)Current events of Regional, National & International importance.  (30)
 *   - "NEGATIVE MARKS: … for each wrong answer will be penalized with 1/3rd of
 *     the marks prescribed for the question." (G.O. Ms. No.235, Finance,
 *     Dt.06/12/2016.)
 *
 * Because every objective question carries exactly one mark (120 Q = 120
 * marks), a section's QUESTION COUNT equals its MARKS. The mock engine uses
 * these section weights to draw a proportionate paper from the content pools.
 *
 * This module is PURE data + types (no DOM, no storage) so it is trivially
 * unit-tested and safe to import anywhere.
 */
import type { SubjectCode } from '../content/types';

/** The negative-marking fraction: a wrong answer costs 1/3 of a mark. */
export const NEGATIVE_MARK = 1 / 3;

/** Which of the two Screening papers a pattern describes. */
export type PaperId = 'paper1' | 'paper2';

/**
 * One weighted SECTION of a paper. `count` is the number of questions the mock
 * draws for it (== `marks`, since each question is one mark), and `subjectCode`
 * is the content pool it is drawn from.
 */
export interface ExamSection {
  /** Stable section id, e.g. `p1-a`, `p2-bi`. */
  id: string;
  /** Official part letter/label, e.g. `A`, `B(i)`. */
  part: string;
  /** Human-readable section name (verbatim-ish from the notification). */
  label: string;
  /** Content pool this section is drawn from. */
  subjectCode: SubjectCode;
  /** Questions in this section (equals its marks). */
  count: number;
  /** Marks for this section (equals its question count). */
  marks: number;
}

/** A full objective-paper pattern the mock engine reproduces. */
export interface ExamPattern {
  id: PaperId;
  /** Short label, e.g. `Paper-I`. */
  label: string;
  /** Full official title, e.g. `Paper-I · General Studies`. */
  title: string;
  sections: ExamSection[];
  /** Total questions across all sections (120). */
  totalQuestions: number;
  /** Total marks (120). */
  totalMarks: number;
  /** Exam duration in minutes (120). */
  durationMin: number;
  /** Negative-marking fraction ({@link NEGATIVE_MARK}). */
  negativeMark: number;
  /** A short citation of the notification wording this pattern encodes. */
  sourceRef: string;
}

/** Paper-I · General Studies — 120 Q / 120 min / 120 marks, four 30-mark parts. */
export const PAPER_I: ExamPattern = {
  id: 'paper1',
  label: 'Paper-I',
  title: 'Paper-I · General Studies',
  sections: [
    { id: 'p1-a', part: 'A', label: 'History & Culture', subjectCode: 'HIST', count: 30, marks: 30 },
    { id: 'p1-b', part: 'B', label: 'Constitution, Polity, Social Justice & International Relations', subjectCode: 'POL', count: 30, marks: 30 },
    { id: 'p1-c', part: 'C', label: 'Indian & Andhra Pradesh Economy & Planning', subjectCode: 'ECON', count: 30, marks: 30 },
    { id: 'p1-d', part: 'D', label: 'Geography', subjectCode: 'GEO', count: 30, marks: 30 },
  ],
  totalQuestions: 120,
  totalMarks: 120,
  durationMin: 120,
  negativeMark: NEGATIVE_MARK,
  sourceRef:
    'Notification 07/2026 — Paper-I General Studies: "04 parts i.e., ABCD each part carries 30 marks", 120 Questions / 120 Minutes / 120 Marks.',
};

/** Paper-II · General Aptitude — 120 Q / 120 min / 120 marks; A=60, B(i)=30, B(ii)=30. */
export const PAPER_II: ExamPattern = {
  id: 'paper2',
  label: 'Paper-II',
  title: 'Paper-II · General Aptitude',
  sections: [
    { id: 'p2-a', part: 'A', label: 'General Mental Ability, Administrative & Psychological Abilities', subjectCode: 'MENT', count: 60, marks: 60 },
    { id: 'p2-bi', part: 'B(i)', label: 'Science & Technology', subjectCode: 'SCI', count: 30, marks: 30 },
    { id: 'p2-bii', part: 'B(ii)', label: 'Current Events (Regional, National & International)', subjectCode: 'CA', count: 30, marks: 30 },
  ],
  totalQuestions: 120,
  totalMarks: 120,
  durationMin: 120,
  negativeMark: NEGATIVE_MARK,
  sourceRef:
    'Notification 07/2026 — Paper-II General Aptitude: "2 parts i.e., A and B … Part-A - 60 Marks, Part-B (i) - 30 Marks and B (ii) - 30 Marks", 120 Questions / 120 Minutes / 120 Marks.',
};

/** Both Screening patterns, in paper order. */
export const EXAM_PATTERNS: readonly ExamPattern[] = [PAPER_I, PAPER_II];

/** Look up a pattern by its {@link PaperId}. */
export function patternFor(paper: PaperId): ExamPattern {
  return paper === 'paper1' ? PAPER_I : PAPER_II;
}
