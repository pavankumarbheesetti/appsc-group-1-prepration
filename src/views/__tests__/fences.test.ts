import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { firstLine, plainInline, renderMarkdown, renderPreview } from '../dom';
import { renderQuestionStem } from '../quiz';

/**
 * D15 — fenced ``` code blocks render as scrollable monospace <pre> blocks with
 * line breaks preserved; D14 helpers for one-line previews / aria text.
 */
function block(src: string): HTMLElement {
  const host = document.createElement('div');
  host.append(...renderMarkdown(src));
  return host;
}

/** Every text node under `root`. */
function textNodes(root: Node): string[] {
  const out: string[] = [];
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walk.nextNode()) out.push(walk.currentNode.nodeValue ?? '');
  return out;
}

describe('renderMarkdown — fenced code blocks', () => {
  it('renders ``` … ``` as a <pre class="md-pre"><code> keeping line breaks and spacing', () => {
    const host = block('**Picture**\n```\n      /\\\\        sides a, b, c\n   b /  \\\\ a\n```\nAfter.');
    const pre = host.querySelector('pre.md-pre');
    expect(pre).not.toBeNull();
    expect(pre!.querySelector('code')).not.toBeNull();
    expect(pre!.textContent).toBe('      /\\\\        sides a, b, c\n   b /  \\\\ a');
    // The fence markers never leak as text, and surrounding blocks still render.
    expect(host.textContent).not.toContain('```');
    expect(host.querySelector('p strong')!.textContent).toBe('Picture');
    expect([...host.querySelectorAll('p')].at(-1)!.textContent).toBe('After.');
    // Keyboard users can scroll a wide block.
    expect(pre!.getAttribute('tabindex')).toBe('0');
  });

  it('keeps markdown markers literal inside a fence but lifts ^{} / _{} math', () => {
    const host = block('```text\n- not a list **not bold** | a | b |\nV = pi r^{2} h, x_{1}\n```');
    const pre = host.querySelector('pre.md-pre')!;
    expect(host.querySelector('ul')).toBeNull();
    expect(host.querySelector('table')).toBeNull();
    expect(pre.querySelector('strong')).toBeNull();
    expect(pre.textContent).toContain('**not bold**');
    expect(pre.querySelector('sup')!.textContent).toBe('2');
    expect(pre.querySelector('sub')!.textContent).toBe('1');
  });

  it('an unclosed fence runs to the end without swallowing earlier blocks', () => {
    const host = block('Intro\n```\nline 1\nline 2');
    expect(host.querySelector('p')!.textContent).toBe('Intro');
    expect(host.querySelector('pre')!.textContent).toBe('line 1\nline 2');
  });

  it('a fence inside a multi-line MCQ stem renders as <pre>', () => {
    const nodes = renderQuestionStem({ question: 'An open dice (net) is laid out:\n\n```\n  [1]\n[2][3][4]\n```\nWhich face is opposite 1?' });
    const host = document.createElement('div');
    for (const n of nodes) if (n) host.append(n);
    expect(host.querySelector('pre.md-pre')!.textContent).toBe('  [1]\n[2][3][4]');
    expect(host.textContent).not.toContain('```');
  });
});

/** Collect every string value containing a fence from a JSON tree. */
function fencedStrings(value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    if (value.includes('```')) out.push(value);
  } else if (Array.isArray(value)) {
    for (const v of value) fencedStrings(v, out);
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value)) fencedStrings(v, out);
  }
}

function jsonFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...jsonFiles(p));
    else if (name.endsWith('.json')) out.push(p);
  }
  return out;
}

describe('every content file with ``` fences renders clean', () => {
  const files = jsonFiles(resolve('content')).filter((f) => readFileSync(f, 'utf8').includes('```'));

  it('finds the fenced content files (27 at the time of writing)', () => {
    expect(files.length).toBeGreaterThanOrEqual(27);
  });

  it('no fenced string leaks a literal ``` line and each fence pair becomes a <pre>', () => {
    let blocks = 0;
    for (const f of files) {
      const strings: string[] = [];
      fencedStrings(JSON.parse(readFileSync(f, 'utf8')), strings);
      expect(strings.length, f).toBeGreaterThan(0);
      for (const s of strings) {
        const host = block(s);
        const leaked = textNodes(host).filter((t) => t.includes('```'));
        expect(leaked, `${f}: ${s.slice(0, 60)}`).toEqual([]);
        const fences = s.split('\n').filter((l) => l.trim().startsWith('```')).length;
        expect(host.querySelectorAll('pre.md-pre').length, f).toBe(Math.ceil(fences / 2));
        blocks += host.querySelectorAll('pre.md-pre').length;
      }
    }
    expect(blocks).toBeGreaterThan(27);
  });
});

describe('preview helpers (D14)', () => {
  it('firstLine skips fences / table rows; renderPreview lifts superscripts', () => {
    expect(firstLine('\n```\nart\n```')).toBe('art');
    expect(firstLine('The unit digit of 3^{47} is\n| a | b |')).toBe('The unit digit of 3^{47} is');
    const host = document.createElement('p');
    host.append(...renderPreview('The unit digit of 3^{47} is'));
    expect(host.querySelector('sup')!.textContent).toBe('47');
    expect(host.textContent).toBe('The unit digit of 347 is');
  });

  it('renderPreview truncates long text with an ellipsis', () => {
    const host = document.createElement('p');
    host.append(...renderPreview('x'.repeat(50), 20));
    expect(host.textContent!.length).toBe(20);
    expect(host.textContent!.endsWith('…')).toBe(true);
  });

  it('plainInline strips markup for aria labels', () => {
    expect(plainInline('**Find** 1.2 × 10^{6} and x_{i} in `code`')).toBe('Find 1.2 × 10^6 and x_i in code');
  });
});
