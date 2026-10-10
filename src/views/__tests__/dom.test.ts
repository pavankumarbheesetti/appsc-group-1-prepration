import { describe, it, expect } from 'vitest';
import { renderInline, renderMarkdown } from '../dom';

/**
 * Markdown renderer semantics for the math/formatting overhaul:
 *  - `base^{exp}` and bare `base^digits` / `base^-digits` → real <sup>;
 *  - `x_{i}` → real <sub>;
 *  - code spans + escaping are preserved (never innerHTML);
 *  - malformed table rows are padded/truncated to the header width.
 * Everything is asserted on real DOM nodes (jsdom), the same path the app uses.
 */

/** Mount inline nodes into a host and return it. */
function inline(src: string): HTMLElement {
  const host = document.createElement('div');
  host.append(...renderInline(src));
  return host;
}

/** Mount block nodes into a host and return it. */
function block(src: string): HTMLElement {
  const host = document.createElement('div');
  host.append(...renderMarkdown(src));
  return host;
}

describe('renderInline — superscripts', () => {
  it('renders a braced exponent base^{exp} as <sup>', () => {
    const host = inline('N = p^{a+1} today');
    const sup = host.querySelector('sup');
    expect(sup).not.toBeNull();
    expect(sup!.textContent).toBe('a+1');
    // The base char stays as text, the braces are gone.
    expect(host.textContent).toBe('N = pa+1 today');
  });

  it('renders a bare numeric exponent base^digits as <sup> (fallback)', () => {
    const host = inline('2^80 zeros');
    const sup = host.querySelector('sup');
    expect(sup).not.toBeNull();
    expect(sup!.textContent).toBe('80');
    expect(host.textContent).toBe('280 zeros');
  });

  it('renders a signed bare exponent base^-digits as <sup>', () => {
    const host = inline('6.7 × 10^-4');
    const sup = host.querySelector('sup');
    expect(sup!.textContent).toBe('-4');
  });

  it('does NOT lift a bare letter exponent (needs braces)', () => {
    const host = inline('a^n stays literal');
    expect(host.querySelector('sup')).toBeNull();
    expect(host.textContent).toBe('a^n stays literal');
  });
});

describe('renderInline — subscripts', () => {
  it('renders x_{i} as <sub>', () => {
    const host = inline('term x_{i} here');
    const sub = host.querySelector('sub');
    expect(sub).not.toBeNull();
    expect(sub!.textContent).toBe('i');
    expect(host.textContent).toBe('term xi here');
  });

  it('does NOT treat snake_case as a subscript (braces required)', () => {
    const host = inline('see my_variable name');
    expect(host.querySelector('sub')).toBeNull();
    expect(host.textContent).toBe('see my_variable name');
  });
});

describe('renderInline — escaping & code spans', () => {
  it('never parses HTML — angle brackets stay as text', () => {
    const host = inline('<img src=x onerror=alert(1)> and **bold**');
    expect(host.querySelector('img')).toBeNull();
    expect(host.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(host.querySelector('strong')?.textContent).toBe('bold');
  });

  it('leaves a code span verbatim and does NOT apply math inside it', () => {
    const host = inline('use `a^b` in code but 10^3 outside');
    const code = host.querySelector('code.md-code');
    expect(code).not.toBeNull();
    expect(code!.textContent).toBe('a^b');
    // The caret inside code did NOT become a <sup>, but the outside one did.
    const sups = host.querySelectorAll('sup');
    expect(sups).toHaveLength(1);
    expect(sups[0]!.textContent).toBe('3');
  });
});

describe('renderMarkdown — tables tolerate bad rows', () => {
  const md = [
    '| Symbol | Members | Note |',
    '|---|---|---|---|',
    '| N | 1,2,3 | starts at 1 | EXTRA |',
    '| W | 0,1,2 |',
    '| Z | …,-1,0,1 | adds negatives |',
  ].join('\n');

  it('renders the header with the authored column count', () => {
    const host = block(md);
    const ths = host.querySelectorAll('thead th');
    expect(ths).toHaveLength(3);
    expect([...ths].map((t) => t.textContent)).toEqual(['Symbol', 'Members', 'Note']);
  });

  it('pads short rows and truncates long rows to the header width', () => {
    const host = block(md);
    const rows = host.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(3);
    // Every rendered row has exactly 3 cells regardless of the source.
    for (const tr of rows) expect(tr.querySelectorAll('td')).toHaveLength(3);
    // The over-long row dropped its 4th cell …
    expect([...rows[0]!.querySelectorAll('td')].map((td) => td.textContent)).toEqual([
      'N',
      '1,2,3',
      'starts at 1',
    ]);
    // … and the short row was padded with an empty 3rd cell.
    expect([...rows[1]!.querySelectorAll('td')].map((td) => td.textContent)).toEqual([
      'W',
      '0,1,2',
      '',
    ]);
  });

  it('wraps the table in a horizontal-scroll container', () => {
    const host = block(md);
    expect(host.querySelector('.md-table-wrap .md-table')).not.toBeNull();
  });
});
