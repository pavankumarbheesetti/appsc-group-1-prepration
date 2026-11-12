/** Find glossary terms used in a piece of lesson text. */
import type { GlossaryTerm } from '../content/chronicle-types';
import type { TimelineEvent } from '../content/timeline-types';

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export interface TermMatcher {
  find(text: string): GlossaryTerm[];
}

/** Longer forms are tried first so "Mir Bakhshi" wins over "Bakhshi". Matches whole words, any case, optional plural "s". */
export function termMatcher(terms: readonly GlossaryTerm[]): TermMatcher {
  const forms = terms
    .flatMap((t) => [t.term, ...(t.aka ?? [])].map((f) => ({ f, t })))
    .sort((a, b) => b.f.length - a.f.length);
  if (forms.length === 0) return { find: () => [] };
  const byForm = new Map(forms.map(({ f, t }) => [f.toLowerCase(), t]));
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(${forms.map(({ f }) => escape(f)).join('|')})s?(?![\\p{L}\\p{N}])`, 'giu');
  return {
    find(text: string): GlossaryTerm[] {
      const seen = new Set<string>();
      const out: GlossaryTerm[] = [];
      for (const m of text.matchAll(re)) {
        const t = byForm.get(m[1]!.toLowerCase());
        if (t && !seen.has(t.id)) {
          seen.add(t.id);
          out.push(t);
        }
      }
      return out;
    },
  };
}

/** All teachable text of an event, in reading order. */
export function eventText(ev: TimelineEvent): string {
  return [
    ev.title, ev.summary, ev.detail, ev.place ?? '',
    ...(ev.sides ?? []).flatMap((s) => [s.name, s.ruler ?? '', ...(s.commanders ?? []), ...(s.allies ?? [])]),
    ...(ev.causes ?? []), ...(ev.course ?? []), ...(ev.losses ?? []), ...(ev.gains ?? []),
    ...(ev.treaties ?? []).flatMap((t) => [t.name, ...(t.terms ?? [])]),
    ...(ev.outcomes ?? []), ...(ev.participants ?? []).flatMap((p) => [p.role, p.post ?? '']),
    ...(ev.facts ?? []),
    ev.before ?? '', ev.after ?? '', ev.today ?? '',
    ...(ev.examAngle ?? []).flatMap((x) => [x.point, x.context]),
  ].join('\n');
}
