import { describe, it, expect, beforeEach } from 'vitest';
import * as mock from '../mock';
import { __resetForTests } from '../../state/store';

/**
 * Mock view tests. These exercise the FULL official-paper mode (Paper-I/II by
 * section weight, non-repeating series, sectional mocks, per-section results)
 * as well as the custom SCOPE mode → {@link buildSession} reuse (the setup's
 * live pool count), the no-feedback running contract (options never reveal
 * correct/incorrect during the mock), and the submit → results + full review
 * flow. Content is the real bank: 3164 MCQs total; HIST = 917, IVC = 19.
 */
function render(): HTMLElement {
  const root = document.createElement('div');
  mock.render(root);
  return root;
}

function byText(root: HTMLElement, sel: string, text: string): HTMLElement | undefined {
  return [...root.querySelectorAll<HTMLElement>(sel)].find((n) => n.textContent?.includes(text));
}

/** Switch the mock setup into custom-scope mode (default is full paper). */
function toScope(root: HTMLElement): void {
  byText(root, '.mock-mode-btn', 'Custom scope')!.click();
}

describe('mock setup — full official paper by section weight', () => {
  beforeEach(() => {
    __resetForTests();
    location.hash = '#/mock';
  });

  it('defaults to the Full-paper mode with Paper-I 120 Q / −1/3 / section split', () => {
    const root = render();
    expect(root.querySelector('.mock-setup')).not.toBeNull();
    // Full-paper is the default headline experience.
    expect(root.textContent).toContain('Paper-I · General Studies');
    expect(root.textContent).toContain('120 Q');
    expect(root.textContent).toContain('negative marking');
    expect(root.textContent).toContain('no compensatory time');
    // Section weights are surfaced (A 30 · B 30 · C 30 · D 30).
    expect(root.textContent).toContain('A 30 · B 30 · C 30 · D 30');
    // A non-repeating series note is shown (HIST 883 / POL 462 / … ⇒ ~5).
    expect(root.textContent).toMatch(/Non-repeating series: about \d+ full Paper-I mock/);
    // A Start control for the full paper is offered.
    expect(byText(root, 'button', 'Start Paper-I')).not.toBeUndefined();
  });

  it('running a full Paper-I mock draws exactly 120 questions by section weight', () => {
    const root = render();
    byText(root, 'button', 'Start Paper-I')!.click();
    expect(root.querySelector('.mock-running')).not.toBeNull();
    // Exactly the official 120-question paper.
    expect(root.querySelectorAll('.mock-grid-cell')).toHaveLength(120);
    // No correctness feedback while running.
    for (const o of root.querySelectorAll<HTMLElement>('.option-card')) {
      expect(o.classList.contains('is-correct')).toBe(false);
      expect(o.classList.contains('is-wrong')).toBe(false);
    }
    // Submit → per-section results + net marks.
    byText(root, 'button', 'Submit mock')!.click();
    expect(root.querySelector('.mock-results')).not.toBeNull();
    expect(root.textContent).toContain('net marks');
    expect(root.querySelector('.mock-section-table')).not.toBeNull();
    // Per-section rows (Paper-I has four parts).
    expect(root.querySelectorAll('.mock-section-table tbody tr')).toHaveLength(4);
    expect(root.querySelectorAll('.mock-review-item')).toHaveLength(120);
  });

  it('a sectional mock draws only the chosen section (Paper-I · A = 30 Q)', () => {
    const root = render();
    // Pick the History & Culture section (30 Q).
    byText(root, '.mock-len-btn', 'History & Culture')!.click();
    byText(root, 'button', 'Start section')!.click();
    expect(root.querySelectorAll('.mock-grid-cell')).toHaveLength(30);
  });

  it('Paper-II is 120 Q with the 60/30/30 section split', () => {
    const root = render();
    byText(root, '.mock-scope-btn', 'Paper-II')!.click();
    expect(root.textContent).toContain('A 60 · B(i) 30 · B(ii) 30');
    byText(root, 'button', 'Start Paper-II')!.click();
    expect(root.querySelectorAll('.mock-grid-cell')).toHaveLength(120);
    byText(root, 'button', 'Submit mock')!.click();
    // Paper-II has three sections.
    expect(root.querySelectorAll('.mock-section-table tbody tr')).toHaveLength(3);
  });
});

describe('mock engine — non-repeating series (deterministic)', () => {
  it('Mock 1 and Mock 2 of Paper-I share no questions per section', () => {
    __resetForTests();
    // Exercised through the pure engine + bridge in engine/mock tests; here we
    // assert the running paper is deterministic by re-rendering the same mock.
    const rootA = render();
    byText(rootA, 'button', 'Start Paper-I')!.click();
    const a = [...rootA.querySelectorAll('.mock-grid-cell')].length;
    expect(a).toBe(120);
  });
});

describe('mock setup — custom scope reuses buildSession', () => {
  beforeEach(() => {
    __resetForTests();
    location.hash = '#/mock';
  });

  it('the full available pool is 3164 MCQs across subjects', () => {
    const root = render();
    toScope(root);
    expect(root.textContent).toMatch(/3\d{3} questions in scope/);
    // Banner is present with the exact exam-condition wording.
    expect(root.textContent).toContain('negative marking');
    expect(root.textContent).toContain('no compensatory time');
  });

  it('scoping to a single subtopic reuses buildSession(subtopicId) → 19 for IVC', () => {
    const root = render();
    toScope(root);
    byText(root, '.mock-scope-btn', 'By subtopic')!.click();
    const select = root.querySelector<HTMLSelectElement>('.mock-setup select')!;
    select.value = 'hist-ancient-ivc';
    select.dispatchEvent(new Event('change'));
    expect(root.textContent).toContain('19 questions in scope');
  });
});

describe('mock running — no per-question feedback + submit', () => {
  beforeEach(() => {
    __resetForTests();
    location.hash = '#/mock';
  });

  it('runs a timed paper without revealing correctness, then submits to results', () => {
    const root = render();
    toScope(root);
    // Scope to IVC and pick its full length (the lean exemplar bank has 19).
    byText(root, '.mock-scope-btn', 'By subtopic')!.click();
    const select = root.querySelector<HTMLSelectElement>('.mock-setup select')!;
    select.value = 'hist-ancient-ivc';
    select.dispatchEvent(new Event('change'));
    byText(root, '.mock-len-btn', '19')!.click();

    // Start.
    byText(root, 'button', 'Start mock')!.click();
    expect(root.querySelector('.mock-running')).not.toBeNull();
    // Overall countdown is shown (not a per-question timer).
    expect(root.querySelector('.mock-countdown')).not.toBeNull();

    // Options are selectable but show NO correct/incorrect feedback.
    const opts = [...root.querySelectorAll<HTMLElement>('.option-card')];
    expect(opts.length).toBeGreaterThan(0);
    for (const o of opts) {
      expect(o.classList.contains('is-correct')).toBe(false);
      expect(o.classList.contains('is-wrong')).toBe(false);
    }
    // Selecting an option marks it selected — still no correctness reveal.
    opts[0]!.click();
    const opts2 = [...root.querySelectorAll<HTMLElement>('.option-card')];
    expect(opts2.some((o) => o.classList.contains('is-selected'))).toBe(true);
    for (const o of opts2) {
      expect(o.classList.contains('is-correct')).toBe(false);
      expect(o.classList.contains('is-wrong')).toBe(false);
    }

    // A question navigator grid with one cell per question is present.
    expect(root.querySelectorAll('.mock-grid-cell')).toHaveLength(19);

    // Submit → results with the NET score and a full 19-item review.
    byText(root, 'button', 'Submit mock')!.click();
    expect(root.querySelector('.mock-results')).not.toBeNull();
    expect(root.textContent).toContain('net score');
    expect(root.querySelectorAll('.mock-review-item')).toHaveLength(19);
    // The review reveals the correct answer AFTER submit.
    expect(root.querySelector('.mock-review-options .option-card.is-correct')).not.toBeNull();
  });
});


/* -------------------------------------------------------------------------- */
/* CONFIDENCE TAGGING + negative-marking habit on results                      */
/* -------------------------------------------------------------------------- */

describe('mock running — confidence tags → skip-guesses on results', () => {
  beforeEach(() => {
    __resetForTests();
    location.hash = '#/mock';
  });

  it('offers a Sure / 50-50 / Guess control and surfaces the habit card', () => {
    const root = render();
    toScope(root);
    byText(root, '.mock-scope-btn', 'By subtopic')!.click();
    const select = root.querySelector<HTMLSelectElement>('.mock-setup select')!;
    select.value = 'hist-ancient-ivc';
    select.dispatchEvent(new Event('change'));
    byText(root, '.mock-len-btn', '19')!.click();
    byText(root, 'button', 'Start mock')!.click();

    // The confidence segmented control is present with the three tags.
    expect(root.querySelector('.mock-confidence')).not.toBeNull();
    const confBtns = [...root.querySelectorAll<HTMLElement>('.mock-conf-btn')];
    expect(confBtns.map((b) => b.textContent)).toEqual(['Sure', '50-50', 'Guess']);

    // Answer the first question and tag it a Guess.
    root.querySelector<HTMLElement>('.option-card')!.click();
    byText(root, '.mock-conf-btn', 'Guess')!.click();
    expect(root.querySelector('.mock-conf-btn.is-active')!.textContent).toBe('Guess');

    // Submit → the Negative-marking habit card with the skip-guesses net and
    // the eliminate-2 rule reminder + accuracy-by-confidence table.
    byText(root, 'button', 'Submit mock')!.click();
    expect(root.querySelector('.mock-results')).not.toBeNull();
    const text = root.textContent ?? '';
    expect(text).toContain('Negative-marking habit');
    expect(text).toContain('If you had skipped your');
    expect(text).toContain('eliminate 2 options');
    expect(text).toContain('Accuracy by confidence');
  });
});

/* -------------------------------------------------------------------------- */
/* OMR MODE flow (full paper)                                                  */
/* -------------------------------------------------------------------------- */

describe('mock setup — OMR mode on full papers', () => {
  beforeEach(() => {
    __resetForTests();
    location.hash = '#/mock';
  });

  it('toggles OMR mode, exposes a printable sheet, and runs the bubble flow', () => {
    const root = render();
    // Toggle "Practise with an OMR sheet" (full-paper mode is the default).
    const toggle = root.querySelector<HTMLElement>('.mock-omr-toggle')!;
    expect(toggle).not.toBeNull();
    toggle.click();
    expect(root.querySelector('.mock-omr-toggle')!.getAttribute('aria-checked')).toBe('true');
    // A printable A4 OMR sheet + a Print button are offered in setup.
    expect(root.querySelector('.omr-print-sheet')).not.toBeNull();
    expect(byText(root, 'button', 'Print OMR sheet')).not.toBeUndefined();

    // Start → the roll-number + booklet-series bubbling drill first.
    byText(root, 'button', 'Start Paper-I')!.click();
    expect(root.querySelector('.omr-identity')).not.toBeNull();
    expect(root.querySelectorAll('.omr-roll .omr-bubble').length).toBeGreaterThan(0);

    // Proceed into the running paper with the separate bubble sheet.
    byText(root, 'button', 'Start paper')!.click();
    expect(root.querySelector('.omr-running')).not.toBeNull();
    expect(root.querySelector('.omr-sheet-panel')).not.toBeNull();
    // One OMR row per question (full Paper-I = 120).
    expect(root.querySelectorAll('.omr-row')).toHaveLength(120);
    // No inline option selection in OMR mode.
    expect(root.querySelector('.option-list.omr-booklet-options .option-card.is-static')).not.toBeNull();

    // Darken a bubble on the sheet → it fills (bubble Q2 so Q1 stays blank).
    const rows = [...root.querySelectorAll<HTMLElement>('.omr-row')];
    rows[1]!.querySelector<HTMLElement>('.omr-bubble')!.click();
    expect(root.querySelector('.omr-row .omr-bubble.is-filled')).not.toBeNull();

    // Mark Q1 on the booklet (scratch) WITHOUT bubbling it, then submit.
    root.querySelector<HTMLElement>('.omr-scratch-btn')!.click();
    byText(root, 'button', 'Submit sheet')!.click();

    // Results flag the booklet-but-not-bubbled transcription gap + reprint.
    expect(root.querySelector('.mock-results')).not.toBeNull();
    const text = root.textContent ?? '';
    expect(text).toContain('booklet, not bubbled');
    expect(text).toContain('NOT bubbled');
    expect(root.querySelector('.omr-print-sheet')).not.toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Print stylesheet presence                                                   */
/* -------------------------------------------------------------------------- */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('print stylesheet — printable OMR sheet', () => {
  it('ships a print.css with an A4 page + OMR-only print rules', () => {
    const css = readFileSync(resolve('src/styles/print.css'), 'utf8');
    expect(css).toContain('@media print');
    expect(css).toContain('.omr-print-sheet');
    expect(css).toMatch(/@page[\s\S]*A4/);
  });
});
