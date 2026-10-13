import { describe, expect, it } from 'vitest';
import { alignEnabled, auditAlignment, significantTokens } from '../validate';

/**
 * The question-format / taught-before-tested ALIGNMENT audit. Its findings are
 * gated behind VALIDATE_ALIGN=1 in the CLI (so `npm run check` stays green until
 * the content round); here we only pin the parts that must already hold.
 */
describe('alignment audit (VALIDATE_ALIGN)', () => {
  it('is off unless VALIDATE_ALIGN=1', () => {
    expect(alignEnabled({})).toBe(false);
    expect(alignEnabled({ VALIDATE_ALIGN: '1' })).toBe(true);
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
    expect(findings.length).toBeGreaterThan(0); // noteRef not yet authored
    expect(findings.filter((f) => f.rule === 'structure-integrity')).toEqual([]);
  });
});
