/**
 * LEARNER-FACING source labels. Content `source` fields are authoring
 * citations and some name internal material ("Weekly CA PDF — May Week 1",
 * "local APPSC GK PDF — …", "notes", "review-v2 R3", ".research/…",
 * "dossier-gov.md"). The renderer maps them to a friendly line here — the
 * content itself is never edited. PURE.
 */

/** Shown for current-affairs material compiled from the weekly CA digests. */
export const CA_SOURCE_LABEL = 'Compiled from current-affairs sources';
/** Shown for the bundled APPSC GK / Quantitative study material. */
export const STUDY_MATERIAL_LABEL = 'Compiled from standard APPSC study material';

/** A file name / internal path token (`dossier-gov.md`, `.research/ap`, `x.pdf`). @internal */
const FILE_TOKEN_RE = /(?:^|[\s(])(?:\.research\/\S*|[\w./-]+\.(?:md|json|pdf|txt|csv|ts))(?=[\s,;)]|$)/gi;

/** The topic part after an em/en dash or colon separator, if any. @internal */
function afterDash(s: string): string {
  const m = /\s[—–-]\s(.+)$/.exec(s);
  return m ? m[1]!.trim() : '';
}

/**
 * Map a raw content `source` to what the learner sees, or `null` when the
 * citation is purely internal and should be hidden (e.g. a review-round tag).
 */
export function learnerSource(raw: string): string | null {
  const s = raw.trim();
  if (s === '') return null;
  // Internal review-round tags carry no information for a learner.
  if (/^review-v\d+\b/i.test(s)) return null;
  if (/^notes?$/i.test(s)) return 'From the topic notes';
  // Weekly current-affairs digests (any "CA PDF" / current-affairs PDF wording).
  if (/\b(?:weekly\s+)?CA\s+PDFs?\b/i.test(s) || /current[-\s]affairs?\b.*\bPDFs?\b/i.test(s)) return CA_SOURCE_LABEL;
  // Bundled / local study PDFs: keep the topic, hide the file.
  if (/\blocal\b.*\bPDFs?\b/i.test(s) || /\bAPPSC\s+(?:GK|Quantitative[\w\s]*?)\s+PDFs?\b/i.test(s)) {
    const topic = afterDash(s);
    return topic ? `${STUDY_MATERIAL_LABEL} \u2014 ${topic}` : STUDY_MATERIAL_LABEL;
  }
  // Research dossiers: name the public outlets in the parenthesis, not the path.
  if (/^\.research\//i.test(s) || /\bdossiers?\b/i.test(s)) {
    const paren = /\(([^)]*)\)/.exec(s)?.[1] ?? '';
    const outlets = paren
      .split(/[;,]/)
      .map((p) => p.trim())
      .filter((p) => p !== '' && !/verified|as-of|as of|\.(?:md|json|pdf)$/i.test(p));
    return outlets.length > 0 ? `Compiled from ${outlets.join(', ')}` : 'Compiled from official and news sources';
  }
  // Anything else: just strip stray file names / internal paths.
  const cleaned = s
    .replace(FILE_TOKEN_RE, ' ')
    .replace(/\(\s*[,;]?\s*\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,;)])/g, '$1')
    .trim()
    .replace(/[,;]$/, '');
  return cleaned === '' ? null : cleaned;
}
