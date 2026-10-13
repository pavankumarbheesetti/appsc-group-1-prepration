import { describe, expect, it } from 'vitest';
import { AlignExceptionsSchema } from '../audit-types';
import { alignEnabled, auditAlignment, loadAlignExceptions, significantTokens } from '../validate';

/**
 * The question-format / taught-before-tested ALIGNMENT audit. The CLI runs it
 * always under --strict (`npm run check`) and opt-in via VALIDATE_ALIGN=1; the
 * content round is complete, so the whole bank must be finding-free.
 */
describe('alignment audit (VALIDATE_ALIGN)', () => {
  it('is off unless VALIDATE_ALIGN=1, and always on under --strict', () => {
    expect(alignEnabled({})).toBe(false);
    expect(alignEnabled({ VALIDATE_ALIGN: '1' })).toBe(true);
    expect(alignEnabled({}, true)).toBe(true);
  });

  it('extracts significant tokens (numbers, 4+ letter words, no stopwords)', () => {
    expect(significantTokens('The ECLGS 5.0 was approved in May 2026 by the Cabinet')).toEqual([
      'eclg', // light plural stripping (substring match still hits "ECLGS")
      '5.0',
      'approved',
      '2026',
      'cabinet',
    ]);
  });

  it('finds no structured-field integrity defects after the migration', () => {
    const findings = auditAlignment();
    expect(findings.filter((f) => f.rule === 'structure-integrity')).toEqual([]);
  });

  it('finds ZERO alignment findings app-wide after the content round', () => {
    // Every MCQ: structured fields complete, valid noteRef, answer taught (or a
    // justified, non-stale exception in content/audit/align-exceptions.json).
    expect(auditAlignment()).toEqual([]);
  });

  it('every listed heuristic exception carries a reason', () => {
    for (const why of loadAlignExceptions().values()) expect(why.length).toBeGreaterThanOrEqual(10);
  });

  it('rejects a malformed exceptions document (schema)', () => {
    expect(AlignExceptionsSchema.safeParse({ version: 1, source: 'x', exceptions: [{ itemId: 'a', rule: 'noteref-missing', why: 'because reasons' }] }).success).toBe(false);
    const dup = { itemId: 'a', rule: 'not-taught', why: 'taught as a paraphrase' };
    expect(AlignExceptionsSchema.safeParse({ version: 1, source: 'x', exceptions: [dup, dup] }).success).toBe(false);
    expect(AlignExceptionsSchema.safeParse({ version: 1, source: 'x', exceptions: [dup] }).success).toBe(true);
  });
});
