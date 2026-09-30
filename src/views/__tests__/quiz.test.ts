import { describe, it, expect, beforeEach } from 'vitest';
import { mountQuiz, renderExplanation, renderQuestionStem } from '../quiz';
import { __resetForTests } from '../../state/store';
import type { MCQItem } from '../../content/types';

/**
 * Quiz runner UI: the NUMBERED, clickable question navigator (states + jump)
 * and the RICH markdown explanation panel with its "Key facts" callout. These
 * exercise presentation only — recording/scoring live in the engine and are
 * unchanged (a jump back to an answered question must never re-answer it).
 */
function mcq(id: string, opts: Partial<MCQItem> = {}): MCQItem {
  return {
    id,
    subjectCode: 'HIST',
    tier: 1,
    question: `Question ${id}?`,
    options: ['Alpha', 'Beta', 'Gamma', 'Delta'],
    answerIndex: 0,
    ...opts,
  } as MCQItem;
}

function items(): MCQItem[] {
  return [mcq('a', { explanation: 'Because alpha.' }), mcq('b'), mcq('c')];
}

describe('quiz — numbered question navigator', () => {
  beforeEach(() => __resetForTests());

  it('renders one numbered chip per question, current one first', () => {
    const root = document.createElement('div');
    mountQuiz(root, items(), () => {});
    const chips = [...root.querySelectorAll<HTMLElement>('.q-nav-item')];
    expect(chips.map((c) => c.textContent)).toEqual(['1', '2', '3']);
    expect(chips[0]!.classList.contains('is-current')).toBe(true);
    expect(chips[0]!.getAttribute('aria-current')).toBe('true');
  });

  it('marks a chip correct/wrong after answering and jumps show locked feedback', () => {
    const root = document.createElement('div');
    mountQuiz(root, items(), () => {});
    // Answer Q1 correctly (option A = index 0).
    [...root.querySelectorAll<HTMLElement>('.option-card')][0]!.click();
    // Locked feedback is shown and the chip is now green.
    expect(root.querySelector('.verdict-correct')).not.toBeNull();
    expect(root.querySelector('.q-nav-item.is-correct')).not.toBeNull();
    // Options are locked (disabled) in the feedback view.
    expect([...root.querySelectorAll<HTMLButtonElement>('.option-card')].every((b) => b.disabled)).toBe(true);

    // Jump to Q3 (index 2) — it is unanswered, so it renders LIVE + answerable.
    [...root.querySelectorAll<HTMLElement>('.q-nav-item')][2]!.click();
    expect(root.querySelector('.focus-count')?.textContent).toContain('Question 3 of 3');
    expect([...root.querySelectorAll<HTMLButtonElement>('.option-card')].some((b) => !b.disabled)).toBe(true);

    // Jump BACK to the answered Q1 — locked feedback again, options disabled,
    // and no way to re-answer (recording is one-shot).
    [...root.querySelectorAll<HTMLElement>('.q-nav-item')][0]!.click();
    expect(root.querySelector('.verdict-correct')).not.toBeNull();
    expect([...root.querySelectorAll<HTMLButtonElement>('.option-card')].every((b) => b.disabled)).toBe(true);
  });

  it('scores only answered questions when ending on the last chip', () => {
    const root = document.createElement('div');
    let done: { total: number; correct: number } | null = null;
    mountQuiz(root, items(), (s) => { done = s; }, { allowEndSession: true });
    // Answer Q1 wrong (pick Beta = index 1; answer is 0).
    [...root.querySelectorAll<HTMLElement>('.option-card')][1]!.click();
    expect(root.querySelector('.q-nav-item.is-wrong')).not.toBeNull();
    // End the session early via the End session control.
    [...root.querySelectorAll<HTMLElement>('button')].find((b) => b.textContent === 'End session')!.click();
    expect(done).not.toBeNull();
    expect(done!.total).toBe(1);
    expect(done!.correct).toBe(0);
  });
});

describe('quiz — rich explanation rendering', () => {
  it('renders markdown rationale + a "Key facts" table callout, XSS-safe', () => {
    const item = mcq('t', {
      explanation: 'This is **why** it matters.\n\n| Ruler | Year |\n|---|---|\n| Ashoka | 268 BCE |',
      source: 'NCERT',
    });
    const panel = renderExplanation(item)!;
    expect(panel).not.toBeNull();
    // Rationale rendered as markdown (bold survives as a <strong>).
    const body = panel.querySelector('.explanation-body');
    expect(body?.querySelector('strong')?.textContent).toBe('why');
    // The table lands in the distinct Key facts callout.
    const kf = panel.querySelector('.key-facts');
    expect(kf).not.toBeNull();
    expect(kf?.querySelector('.md-table')).not.toBeNull();
    expect(kf?.querySelectorAll('.md-table thead th').length).toBe(2);
    expect(kf?.querySelectorAll('.md-table tbody tr').length).toBe(1);
    // Source line preserved.
    expect(panel.textContent).toContain('NCERT');
  });

  it('renders a "Why not the others" block between the rationale and Key facts', () => {
    const item = mcq('wn', {
      explanation:
        'Dholavira is the water fort.\n\n**Why not the others**\n' +
        '- **Lothal** — dockyard, not a water fort\n' +
        '- Harappa — first excavated\n\n' +
        '**Key facts**\n- Site: **Kutch**',
    });
    const panel = renderExplanation(item)!;
    const wn = panel.querySelector('.why-not');
    expect(wn).not.toBeNull();
    expect(wn?.querySelector('.why-not-title')?.textContent).toBe('Why not the others');
    const rows = wn!.querySelectorAll('.why-not-row');
    expect(rows.length).toBe(2);
    // Inline emphasis survives as a <strong> (XSS-safe renderer, no innerHTML).
    expect(rows[0]!.querySelector('.why-not-option strong')?.textContent).toBe('Lothal');
    expect(rows[0]!.querySelector('.why-not-reason')?.textContent).toBe('dockyard, not a water fort');
    // Placement: the why-not block precedes the Key facts card in the DOM.
    const kids = [...panel.children];
    expect(kids.indexOf(panel.querySelector('.why-not')!)).toBeLessThan(
      kids.indexOf(panel.querySelector('.key-facts')!),
    );
  });

  it('renders no "Why not the others" block when the section is absent', () => {
    const item = mcq('nown', { explanation: 'Plain rationale only.' });
    const panel = renderExplanation(item)!;
    expect(panel.querySelector('.why-not')).toBeNull();
  });

  it('returns null when there is neither explanation nor source', () => {
    expect(renderExplanation(mcq('empty'))).toBeNull();
  });

  it('renders a muted distractor line under the rationale (label stripped)', () => {
    const item = mcq('d', {
      explanation: 'Dholavira is the water fort.\nOthers: Lothal — dockyard · Harappa — first excavated',
    });
    const panel = renderExplanation(item)!;
    const distractor = panel.querySelector('.explanation-distractor');
    expect(distractor).not.toBeNull();
    expect(distractor?.querySelector('.distractor-label')?.textContent).toBe('Others');
    expect(distractor?.querySelector('.distractor-body')?.textContent).toContain('Lothal');
    expect(panel.querySelector('.explanation-body')?.textContent).not.toContain('Others:');
  });

  it('renders a key:value block as a definition grid', () => {
    const item = mcq('kv', {
      explanation: 'Lead.\n**Key facts — Lothal**\n- Location: **Gujarat**\n- Discovered: 1957',
    });
    const panel = renderExplanation(item)!;
    const kf = panel.querySelector('.key-facts.key-facts-kv');
    expect(kf).not.toBeNull();
    expect(kf?.querySelector('.key-facts-caption')?.textContent).toBe('Lothal');
    const pairs = kf!.querySelectorAll('.key-facts-dl .kf-pair');
    expect(pairs.length).toBe(2);
    expect(pairs[0]!.querySelector('.kf-key')?.textContent).toBe('Location');
    expect(pairs[0]!.querySelector('.kf-val strong')?.textContent).toBe('Gujarat');
  });

  it('shows the source ONCE, preferring the structured field over an inline line', () => {
    const item = mcq('s', {
      explanation: 'Reason.\n\n*Source: inline APPSC PDF.*',
      source: 'Structured NCERT source',
    });
    const panel = renderExplanation(item)!;
    const sources = panel.querySelectorAll('.explanation-source');
    expect(sources.length).toBe(1);
    expect(sources[0]!.textContent).toContain('Structured NCERT source');
    expect(panel.textContent).not.toContain('inline APPSC PDF');
  });

  it('linkifies a URL in the source footnote with an external link', () => {
    const item = mcq('u', {
      explanation: 'Reason.',
      source: 'NCERT — https://ncert.nic.in/textbook.pdf',
    });
    const panel = renderExplanation(item)!;
    const link = panel.querySelector('.explanation-source .src-link') as HTMLAnchorElement | null;
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBe('https://ncert.nic.in/textbook.pdf');
    expect(link?.getAttribute('rel')).toContain('noopener');
    expect(link?.textContent).toContain('ncert.nic.in');
  });
});

describe('quiz — structured question stems', () => {
  /** Mount into a fresh div and return it. */
  function stem(question: string): HTMLElement {
    const host = document.createElement('div');
    for (const node of renderQuestionStem(question)) {
      if (node) host.append(typeof node === 'string' ? document.createTextNode(node) : node);
    }
    return host;
  }

  it('renders a statement stem as intro + numbered list + prompt', () => {
    const host = stem(
      'Consider the following statements:\n1. Alpha.\n2. Beta.\n3. Gamma.\nWhich of the statements are correct?',
    );
    expect(host.querySelector('.question-text.stem-intro')?.textContent).toBe(
      'Consider the following statements:',
    );
    const items = host.querySelectorAll('.stmt-list .stmt-item');
    expect(items).toHaveLength(3);
    expect(items[0]!.textContent).toBe('Alpha.');
    expect(host.querySelector('.stmt-prompt')?.textContent).toBe(
      'Which of the statements are correct?',
    );
  });

  it('renders a match stem as a two-column table with header labels', () => {
    const host = stem(
      'Match the site (List-I) with its find (List-II):\n' +
        'List-I: (1) Mohenjo-daro (2) Lothal\n' +
        'List-II: (i) Great Bath (ii) Dockyard',
    );
    const ths = host.querySelectorAll('.match-table thead th');
    expect([...ths].map((t) => t.textContent)).toEqual(['Site', 'Find']);
    const rows = host.querySelectorAll('.match-table tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.querySelectorAll('td')[0]!.textContent).toBe('1. Mohenjo-daro');
    expect(rows[0]!.querySelectorAll('td')[1]!.textContent).toBe('i. Great Bath');
  });

  it('falls back to a plain heading for an ordinary question', () => {
    const host = stem('Who founded the Mauryan empire?');
    const h2 = host.querySelector('.question-text');
    expect(h2?.textContent).toBe('Who founded the Mauryan empire?');
    expect(host.querySelector('.stmt-list')).toBeNull();
    expect(host.querySelector('.match-table')).toBeNull();
  });

  it('renders a Data-Interpretation stem with an embedded pipe table as a real <table>', () => {
    const host = stem(
      'The table shows the number of cars sold by a dealer:\n\n' +
        '| Month | Cars sold |\n|---|---|\n| January | 45 |\n| April | 70 |\n\n' +
        'How many cars were sold in April?',
    );
    // Lead sentence becomes the question heading (not literal pipes).
    expect(host.querySelector('.question-text.stem-intro')?.textContent).toBe(
      'The table shows the number of cars sold by a dealer:',
    );
    // The pipe table renders as an accessible <table> with correct header + cells.
    const table = host.querySelector('.stem-body .md-table');
    expect(table).not.toBeNull();
    const ths = table!.querySelectorAll('thead th');
    expect([...ths].map((t) => t.textContent)).toEqual(['Month', 'Cars sold']);
    const firstRow = table!.querySelectorAll('tbody tr')[0]!.querySelectorAll('td');
    expect([...firstRow].map((c) => c.textContent)).toEqual(['January', '45']);
    expect(table!.querySelectorAll('tbody tr')).toHaveLength(2);
    // The trailing prompt survives as its own line, and no literal pipe leaks out.
    expect(host.textContent).toContain('How many cars were sold in April?');
    expect(host.textContent).not.toContain('|---|');
    expect(host.querySelector('.question-text')?.textContent).not.toContain('|');
  });

  it('renders a plain multi-line stem (no table) as separate paragraphs', () => {
    const host = stem('First context line.\nWhich option follows?');
    expect(host.querySelector('.question-text.stem-intro')?.textContent).toBe('First context line.');
    expect(host.querySelector('.stem-body')?.textContent).toContain('Which option follows?');
    expect(host.querySelector('.md-table')).toBeNull();
  });

  it('is XSS-safe for a plain stem with an embedded table — markup is text, not parsed', () => {
    const host = stem(
      'Rows below:\n\n| A | B |\n|---|---|\n| <img src=x onerror=alert(1)> | 2 |\n\nPick one.',
    );
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('.stem-body .md-table')).not.toBeNull();
    expect(host.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('is XSS-safe — markup in a stem is rendered as text, not parsed', () => {
    const host = stem(
      'Consider the following:\n1. <img src=x onerror=alert(1)>\n2. Beta.\nWhich is correct?',
    );
    // No element was injected from the content string.
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('.stmt-item')?.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});
