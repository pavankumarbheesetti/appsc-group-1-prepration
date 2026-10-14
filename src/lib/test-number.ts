/**
 * The LEARNER-FACING week-test number. The planner numbers week tests by the
 * schedule's Saturdays, which can make a learner's first test read
 * "Week test 2" (a Saturday before they started, or a re-anchored plan). The
 * learner only cares about the tests they actually sat, so the number is
 * 1 + the distinct days, from the plan start and before `dateISO`, on which a
 * week test was submitted. PURE.
 */

/** The minimal attempt fields read here. */
export interface NumberedAttempt {
  kind: string;
  at: number;
  dateISO?: string;
}

/** Local `YYYY-MM-DD` of an attempt (its stored day, else its timestamp). @internal */
function dayOf(a: NumberedAttempt): string {
  if (a.dateISO) return a.dateISO;
  const d = new Date(a.at);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * The week-test number to SHOW for the week test on `dateISO`: 1 for the
 * learner's first week test since `planStartISO`, 2 for the next, and so on.
 * A test already submitted on `dateISO` keeps the same number.
 */
export function weekTestNumber(
  dateISO: string,
  attempts: readonly NumberedAttempt[],
  planStartISO: string,
): number {
  const days = new Set<string>();
  for (const a of attempts) {
    if (a.kind !== 'week-test') continue;
    const d = dayOf(a);
    if (d >= planStartISO && d < dateISO) days.add(d);
  }
  return days.size + 1;
}
