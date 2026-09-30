import { describe, it, expect } from 'vitest';
import { splitExplanation } from '../explanation';

/**
 * splitExplanation separates an MCQ explanation into a rationale, an optional
 * muted distractor line, an optional structured key-facts block (classified as
 * table / kv / list), and a de-duplicated trailing inline source citation.
 */
describe('splitExplanation — rationale / key-facts split', () => {
  it('returns the whole text as rationale when there is no structured tail', () => {
    const r = splitExplanation('Just a plain **rationale** sentence.');
    expect(r.rationale).toBe('Just a plain **rationale** sentence.');
    expect(r.distractor).toBeNull();
    expect(r.keyFacts).toBeNull();
    expect(r.source).toBeNull();
  });

  it('splits on an explicit **Key facts** marker (marker line dropped)', () => {
    const md = 'The Mauryan empire...\n\n**Key facts**\n- Founded 321 BCE\n- Chandragupta';
    const { rationale, keyFacts } = splitExplanation(md);
    expect(rationale).toBe('The Mauryan empire...');
    expect(keyFacts?.markdown).toBe('- Founded 321 BCE\n- Chandragupta');
    expect(keyFacts?.markdown).not.toContain('Key facts');
    expect(keyFacts?.caption).toBeNull();
  });

  it('captures the caption after a "Key facts — X" marker', () => {
    const md = 'Dholavira is a water fort.\n\n**Key facts — Dholavira**\n- **UNESCO (2021)**\n- Great Rann of Kutch';
    const { rationale, keyFacts } = splitExplanation(md);
    expect(rationale).toBe('Dholavira is a water fort.');
    expect(keyFacts?.caption).toBe('Dholavira');
    expect(keyFacts?.kind).toBe('list');
  });

  it('splits on a ## Key facts heading', () => {
    const md = 'Rationale here.\n## Key facts\nSome facts.';
    const { rationale, keyFacts } = splitExplanation(md);
    expect(rationale).toBe('Rationale here.');
    expect(keyFacts?.markdown).toBe('Some facts.');
    expect(keyFacts?.kind).toBe('list');
  });

  it('splits on a --- horizontal rule (rule line dropped)', () => {
    const md = 'Because X leads to Y.\n\n---\n\nExtra reference block.';
    const { rationale, keyFacts } = splitExplanation(md);
    expect(rationale).toBe('Because X leads to Y.');
    expect(keyFacts?.markdown).toBe('Extra reference block.');
  });

  it('handles an empty explanation', () => {
    expect(splitExplanation('')).toEqual({ rationale: '', distractor: null, whyNot: [], keyFacts: null, source: null });
  });

  it('prefers the explicit marker over a later table', () => {
    const md = 'Lead.\n**Key facts**\n| A | B |\n|---|---|\n| 1 | 2 |';
    const { rationale, keyFacts } = splitExplanation(md);
    expect(rationale).toBe('Lead.');
    expect(keyFacts?.kind).toBe('table');
    expect(keyFacts?.markdown).toBe('| A | B |\n|---|---|\n| 1 | 2 |');
  });
});

describe('splitExplanation — key-facts classification', () => {
  it('detects a GFM table and adopts a preceding bold line as the caption', () => {
    const md = 'Compare the excavators.\n\n**Excavator → site**\n| Excavator | Site |\n|---|---|\n| Sahni | Harappa |';
    const { rationale, keyFacts } = splitExplanation(md);
    expect(rationale).toBe('Compare the excavators.');
    expect(keyFacts?.kind).toBe('table');
    expect(keyFacts?.caption).toBe('Excavator → site');
    expect(keyFacts?.markdown.startsWith('| Excavator | Site |')).toBe(true);
  });

  it('detects a key:value list and parses pairs', () => {
    const md = 'Lead.\n**Key facts**\n- Location: **Kutch, Gujarat**\n- Discovered: 1968';
    const { keyFacts } = splitExplanation(md);
    expect(keyFacts?.kind).toBe('kv');
    expect(keyFacts?.pairs).toEqual([
      { label: 'Location', value: '**Kutch, Gujarat**' },
      { label: 'Discovered', value: '1968' },
    ]);
  });

  it('treats a mixed list (only some items have a colon) as a plain list', () => {
    const md = 'Lead.\n**Key facts**\n- Location: Kutch\n- **Great Bath**, granary';
    const { keyFacts } = splitExplanation(md);
    expect(keyFacts?.kind).toBe('list');
    expect(keyFacts?.pairs).toEqual([]);
  });
});

describe('splitExplanation — distractor line', () => {
  it('lifts an "Others:" distractor line out of the rationale (label stripped)', () => {
    const md = 'Dholavira is the water fort.\nOthers: Lothal — dockyard · Harappa — first excavated';
    const { rationale, distractor } = splitExplanation(md);
    expect(rationale).toBe('Dholavira is the water fort.');
    expect(distractor).toBe('Lothal — dockyard · Harappa — first excavated');
  });

  it('supports a bolded **Distractors:** label', () => {
    const md = 'Why.\n**Distractors:** A wrong; B wrong';
    const { distractor } = splitExplanation(md);
    expect(distractor).toBe('A wrong; B wrong');
  });
});

describe('splitExplanation — why-not-the-others section', () => {
  it('returns an empty array when the section is absent', () => {
    const { whyNot } = splitExplanation('Plain rationale with no such section.');
    expect(whyNot).toEqual([]);
  });

  it('extracts option→reason rows and strips the section from the rationale', () => {
    const md =
      'Dholavira is the water fort.\n\n**Why not the others**\n' +
      '- Lothal — dockyard, not a water fort\n' +
      '- Harappa — first excavated site';
    const { rationale, whyNot } = splitExplanation(md);
    expect(rationale).toBe('Dholavira is the water fort.');
    expect(whyNot).toEqual([
      { option: 'Lothal', reason: 'dockyard, not a water fort' },
      { option: 'Harappa', reason: 'first excavated site' },
    ]);
    // The section text must not leak back into the rationale.
    expect(rationale).not.toContain('Why not the others');
    expect(rationale).not.toContain('Lothal');
  });

  it('accepts a space-padded hyphen as the separator and keeps hyphenated options intact', () => {
    const md =
      'Lead.\n**Why not the others**\n' +
      '- Indo-Greek - a later dynasty\n' +
      '- Kushanas - post-Mauryan';
    const { whyNot } = splitExplanation(md);
    expect(whyNot).toEqual([
      { option: 'Indo-Greek', reason: 'a later dynasty' },
      { option: 'Kushanas', reason: 'post-Mauryan' },
    ]);
  });

  it('preserves inline **bold** markdown in option and reason', () => {
    const md = 'Lead.\n**Why not the others**\n- **Sarnath** — where the *dhamma* began, not the birth';
    const { whyNot } = splitExplanation(md);
    expect(whyNot).toEqual([{ option: '**Sarnath**', reason: 'where the *dhamma* began, not the birth' }]);
  });

  it('does not duplicate the key-facts or source blocks', () => {
    const md =
      'Rationale.\n\n**Why not the others**\n' +
      '- Alpha — wrong era\n' +
      '- Beta — wrong region\n\n' +
      '**Key facts**\n- Founded: **321 BCE**\n\n' +
      '*Source: NCERT Class VI.*';
    const { rationale, whyNot, keyFacts, source } = splitExplanation(md);
    expect(rationale).toBe('Rationale.');
    expect(whyNot).toEqual([
      { option: 'Alpha', reason: 'wrong era' },
      { option: 'Beta', reason: 'wrong region' },
    ]);
    // Key facts stay their own block; the why-not rows never bleed into it.
    expect(keyFacts?.kind).toBe('kv');
    expect(keyFacts?.pairs).toEqual([{ label: 'Founded', value: '**321 BCE**' }]);
    expect(keyFacts?.markdown).not.toContain('Alpha');
    expect(source).toBe('NCERT Class VI.');
  });

  it('handles a single row with no reason gracefully', () => {
    const md = 'Lead.\n**Why not the others**\n- Just an option';
    const { whyNot } = splitExplanation(md);
    expect(whyNot).toEqual([{ option: 'Just an option', reason: '' }]);
  });
});

describe('splitExplanation — END-TO-END on the real authored order', () => {
  // The authored IVC/Buddhism content places the `**Why not the others**`
  // section AFTER the `**Key facts**` block and before the trailing source —
  // mirror that exact shape here to prove the section is lifted (not swallowed
  // into key-facts) regardless of placement.
  const AUTHORED =
    "**Dholavira** (Rann of Kutch) is the 'lake city' / **jala durga (water fort)** for its cascade of stone water reservoirs.\n\n" +
    '**Key facts — Dholavira**\n' +
    '- Location: **Khadir island, Great Rann of Kutch, Gujarat**.\n' +
    '- Three-part city: **citadel + middle town + lower town**.\n' +
    "- **UNESCO World Heritage (2021)** — India's **40th** site.\n" +
    '- Discovered **1968** by **Jagat Pati Joshi**.\n\n' +
    '**Why not the others**\n' +
    "- Lothal — the IVC's sole port town, with a tidal dockyard\n" +
    '- Harappa — the first-excavated site, not a water fort\n' +
    '- Kalibangan — known for its ploughed field and fire altars\n\n' +
    '*Source: NCERT Class VI — Our Pasts I.*';

  it('lifts why-not placed AFTER key-facts — no leakage into any block', () => {
    const { rationale, whyNot, keyFacts, source } = splitExplanation(AUTHORED);

    // whyNot has exactly the 3 authored rows, parsed into option/reason.
    expect(whyNot).toEqual([
      { option: 'Lothal', reason: "the IVC's sole port town, with a tidal dockyard" },
      { option: 'Harappa', reason: 'the first-excavated site, not a water fort' },
      { option: 'Kalibangan', reason: 'known for its ploughed field and fire altars' },
    ]);

    // Key facts contains ONLY the four key-facts rows — never a why-not row.
    // (One row carries no colon, so the block classifies as a plain `list`.)
    expect(keyFacts?.kind).toBe('list');
    expect(keyFacts?.caption).toBe('Dholavira');
    expect(keyFacts?.markdown).toContain('Location: **Khadir island');
    expect(keyFacts?.markdown).toContain('**UNESCO World Heritage (2021)**');
    expect(keyFacts?.markdown).toContain('Jagat Pati Joshi');
    expect(keyFacts?.markdown).not.toContain('Why not the others');
    expect(keyFacts?.markdown).not.toContain('Lothal');
    expect(keyFacts?.markdown).not.toContain('Harappa');
    expect(keyFacts?.markdown).not.toContain('Kalibangan');

    // Rationale is clean prose — no key-facts and no why-not text bled in.
    expect(rationale).toBe(
      "**Dholavira** (Rann of Kutch) is the 'lake city' / **jala durga (water fort)** for its cascade of stone water reservoirs.",
    );
    expect(rationale).not.toContain('Why not the others');
    expect(rationale).not.toContain('Key facts');

    // Source parsed exactly once.
    expect(source).toBe('NCERT Class VI — Our Pasts I.');
  });

  it('lifts why-not placed BEFORE key-facts — reverse order parses identically', () => {
    const reversed =
      'Rationale sentence.\n\n' +
      '**Why not the others**\n' +
      '- Lothal — the port town\n' +
      '- Harappa — first excavated\n' +
      '- Kalibangan — ploughed field\n\n' +
      '**Key facts**\n' +
      '- Location: **Kutch**\n' +
      '- Discovered: 1968\n\n' +
      '*Source: NCERT Class VI.*';
    const { rationale, whyNot, keyFacts, source } = splitExplanation(reversed);

    expect(whyNot).toEqual([
      { option: 'Lothal', reason: 'the port town' },
      { option: 'Harappa', reason: 'first excavated' },
      { option: 'Kalibangan', reason: 'ploughed field' },
    ]);
    expect(keyFacts?.kind).toBe('kv');
    expect(keyFacts?.pairs).toEqual([
      { label: 'Location', value: '**Kutch**' },
      { label: 'Discovered', value: '1968' },
    ]);
    expect(keyFacts?.markdown).not.toContain('Lothal');
    expect(rationale).toBe('Rationale sentence.');
    expect(source).toBe('NCERT Class VI.');
  });

  it('parses correctly when there is NO why-not section (key-facts intact)', () => {
    const noWhyNot =
      'Rationale only.\n\n' +
      '**Key facts**\n' +
      '- Location: **Kutch**\n' +
      '- Discovered: 1968\n\n' +
      '*Source: NCERT Class VI.*';
    const { rationale, whyNot, keyFacts, source } = splitExplanation(noWhyNot);

    expect(whyNot).toEqual([]);
    expect(keyFacts?.kind).toBe('kv');
    expect(keyFacts?.pairs).toEqual([
      { label: 'Location', value: '**Kutch**' },
      { label: 'Discovered', value: '1968' },
    ]);
    expect(rationale).toBe('Rationale only.');
    expect(source).toBe('NCERT Class VI.');
  });
});

describe('splitExplanation — inline-heading markers (trailing same-line text)', () => {
  // The authored hist-ancient-mauryan items place the Key-facts content ON the
  // heading line: `**Key facts** <prose>`. The old line-anchored regex rejected
  // this, so the block rendered as inline prose instead of a panel.
  it('(a) recognises `**Key facts** <inline prose>` and folds the prose into the block', () => {
    const md =
      "Chandragupta Maurya overthrew the last Nanda ruler with Chanakya's help.\n\n" +
      '**Why not the others**\n' +
      '- The Shishunaga and Haryanka dynasties preceded the Nandas.\n' +
      '- The Shunga dynasty came after the Mauryas.\n\n' +
      '**Key facts** Buddhist tradition places the Mauryas as a Kshatriya clan of the Gorakhpur region.\n\n' +
      '*Source: local APPSC GK PDF.*';
    const { rationale, whyNot, keyFacts, source } = splitExplanation(md);

    // Key facts panel now exists, carrying the same-line prose as its body.
    expect(keyFacts).not.toBeNull();
    expect(keyFacts?.kind).toBe('list');
    expect(keyFacts?.caption).toBeNull();
    expect(keyFacts?.markdown).toBe(
      'Buddhist tradition places the Mauryas as a Kshatriya clan of the Gorakhpur region.',
    );
    expect(keyFacts?.markdown).not.toContain('Key facts');
    // Why-not still lifted; rationale clean — no marker text bled in.
    expect(whyNot).toHaveLength(2);
    expect(rationale).toBe(
      "Chandragupta Maurya overthrew the last Nanda ruler with Chanakya's help.",
    );
    expect(rationale).not.toContain('Key facts');
    expect(rationale).not.toContain('Buddhist tradition');
    expect(source).toBe('local APPSC GK PDF.');
  });

  it('(a2) folds same-line prose AND following body lines into the block (list kind, prose preserved)', () => {
    const md =
      'Lead sentence.\n\n' +
      '**Key facts** Chandragupta founded the Mauryan empire in 322 BCE.\n' +
      'He later took the trans-Indus regions from Seleucus in 305 BCE.';
    const { rationale, keyFacts } = splitExplanation(md);
    expect(rationale).toBe('Lead sentence.');
    expect(keyFacts?.caption).toBeNull();
    // Same-line prose is the first body line; the following prose line is kept.
    expect(keyFacts?.markdown).toBe(
      'Chandragupta founded the Mauryan empire in 322 BCE.\n' +
        'He later took the trans-Indus regions from Seleucus in 305 BCE.',
    );
    // Plain prose (no list/table) → list kind, so the whole block renders.
    expect(keyFacts?.kind).toBe('list');
  });

  it('(b) captures caption from `**Key facts — <caption>:** ` (colon + inline) and parses the following facts', () => {
    const md =
      'Ashoka spread the dhamma through edicts.\n\n' +
      '**Key facts — Ashokan edicts:** \n' +
      '- Language: **Prakrit**\n' +
      '- Script: **Brahmi**';
    const { rationale, keyFacts } = splitExplanation(md);
    expect(rationale).toBe('Ashoka spread the dhamma through edicts.');
    expect(keyFacts?.caption).toBe('Ashokan edicts');
    expect(keyFacts?.kind).toBe('kv');
    expect(keyFacts?.pairs).toEqual([
      { label: 'Language', value: '**Prakrit**' },
      { label: 'Script', value: '**Brahmi**' },
    ]);
    expect(keyFacts?.markdown).not.toContain('Key facts');
  });

  it('tolerates an optional trailing colon: `**Key facts:**`', () => {
    const md = 'Lead.\n\n**Key facts:**\n- Founded: 322 BCE';
    const { keyFacts } = splitExplanation(md);
    expect(keyFacts?.caption).toBeNull();
    expect(keyFacts?.kind).toBe('kv');
    expect(keyFacts?.pairs).toEqual([{ label: 'Founded', value: '322 BCE' }]);
  });

  it('(c) parses `**Why not the others** - X — y` with the first row ON the heading line', () => {
    const md =
      'Pataliputra was the imperial capital.\n\n' +
      '**Why not the others** - Taxila — a provincial capital, not imperial\n' +
      '- Ujjain — provincial capital of Avantiratha\n' +
      '- Rajagriha — the older Magadhan capital';
    const { rationale, whyNot, keyFacts } = splitExplanation(md);
    expect(rationale).toBe('Pataliputra was the imperial capital.');
    expect(keyFacts).toBeNull();
    expect(whyNot).toEqual([
      { option: 'Taxila', reason: 'a provincial capital, not imperial' },
      { option: 'Ujjain', reason: 'provincial capital of Avantiratha' },
      { option: 'Rajagriha', reason: 'the older Magadhan capital' },
    ]);
    // The inline heading text must not leak into the rationale.
    expect(rationale).not.toContain('Why not the others');
    expect(rationale).not.toContain('Taxila');
  });

  it('(c2) real harsha shape: `**Why not the others** (note)` + list — note dropped, rows parsed', () => {
    const md =
      'Harsha wrote **Ratnavali, Priyadarshika and Nagananda**.\n\n' +
      '**Key facts — the three plays**\n' +
      '- **Ratnavali** — four-act romance.\n' +
      '- **Priyadarshika** — a Sanskrit play.\n\n' +
      '**Why not the others** (these were written by Harsha)\n' +
      "- Ratnavali — Harsha's four-act court drama.\n" +
      '- Priyadarshika — another of Harsha’s plays.\n\n' +
      '*Source: local APPSC GK PDF.*';
    const { rationale, whyNot, keyFacts, source } = splitExplanation(md);

    // Why-not panel now populated from the rows below the inline heading.
    expect(whyNot).toEqual([
      { option: 'Ratnavali', reason: "Harsha's four-act court drama." },
      { option: 'Priyadarshika', reason: 'another of Harsha’s plays.' },
    ]);
    // The parenthetical note is decorative (no separator) → not a bogus row.
    expect(whyNot).toHaveLength(2);
    // Key facts stays its own block; no why-not leakage.
    expect(keyFacts?.caption).toBe('the three plays');
    expect(keyFacts?.markdown).not.toContain('Why not the others');
    expect(keyFacts?.markdown).not.toContain('court drama');
    // Rationale clean; note text did not leak back.
    expect(rationale).toBe('Harsha wrote **Ratnavali, Priyadarshika and Nagananda**.');
    expect(rationale).not.toContain('these were written by Harsha');
    expect(source).toBe('local APPSC GK PDF.');
  });

  it('(d) own-line markers still parse unchanged (bold and heading forms)', () => {
    const bold = splitExplanation('Lead.\n\n**Key facts**\n- Founded: 322 BCE');
    expect(bold.keyFacts?.caption).toBeNull();
    expect(bold.keyFacts?.pairs).toEqual([{ label: 'Founded', value: '322 BCE' }]);

    const captioned = splitExplanation('Lead.\n\n**Key facts — Dholavira**\n- A fact');
    expect(captioned.keyFacts?.caption).toBe('Dholavira');

    const heading = splitExplanation('Lead.\n## Key facts\nSome facts.');
    expect(heading.keyFacts?.markdown).toBe('Some facts.');

    const wn = splitExplanation('Lead.\n**Why not the others**\n- A — wrong');
    expect(wn.whyNot).toEqual([{ option: 'A', reason: 'wrong' }]);
  });

  it('(e) absence still yields nothing (no false positive on mid-sentence bold)', () => {
    const midSentence = splitExplanation(
      'The **Key facts** of the matter are debated, and **Why not the others** is a phrase.',
    );
    expect(midSentence.keyFacts).toBeNull();
    expect(midSentence.whyNot).toEqual([]);
    expect(midSentence.rationale).toBe(
      'The **Key facts** of the matter are debated, and **Why not the others** is a phrase.',
    );
  });

  it('asserts no cross-leak: an inline `**Key facts** <prose>` never swallows a following why-not', () => {
    const md =
      'Lead.\n\n' +
      '**Key facts** Chandragupta founded the empire in 322 BCE.\n\n' +
      '**Why not the others**\n' +
      '- Bindusara — the son, not the founder\n' +
      '- Ashoka — the grandson';
    const { whyNot, keyFacts } = splitExplanation(md);
    expect(whyNot).toEqual([
      { option: 'Bindusara', reason: 'the son, not the founder' },
      { option: 'Ashoka', reason: 'the grandson' },
    ]);
    expect(keyFacts?.markdown).toBe('Chandragupta founded the empire in 322 BCE.');
    expect(keyFacts?.markdown).not.toContain('Bindusara');
    expect(keyFacts?.markdown).not.toContain('Why not the others');
  });
});

describe('splitExplanation — source de-duplication', () => {
  it('extracts a trailing inline *Source: …* line and strips it from the body', () => {
    const md = 'Rationale.\n\n**Key facts**\n- One fact\n\n*Source: NCERT Class XII.*';
    const { rationale, keyFacts, source } = splitExplanation(md);
    expect(source).toBe('NCERT Class XII.');
    expect(rationale).toBe('Rationale.');
    expect(keyFacts?.markdown).toBe('- One fact');
    expect(keyFacts?.markdown).not.toContain('Source');
  });

  it('strips a trailing source line even without a key-facts block', () => {
    const md = 'Just the reason.\n\nSource: local APPSC GK PDF';
    const { rationale, keyFacts, source } = splitExplanation(md);
    expect(rationale).toBe('Just the reason.');
    expect(keyFacts).toBeNull();
    expect(source).toBe('local APPSC GK PDF');
  });
});
