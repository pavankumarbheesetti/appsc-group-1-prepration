/**
 * Tiny DOM construction helpers — the ONLY sanctioned way views build UI.
 *
 * Everything here creates real DOM nodes and assigns text via `textContent`,
 * so untrusted/content strings are never interpreted as HTML. Views must NOT
 * use `innerHTML` with dynamic data; use {@link el} / {@link renderMarkdown}.
 */

/** A child accepted by {@link el}: a node, a string, or a falsy skip value. */
export type Child = Node | string | null | undefined | false;

/** Declarative props for {@link el}. All are optional. */
export interface ElProps {
  /** CSS class name(s). */
  class?: string;
  /** Text content (assigned safely via textContent). */
  text?: string;
  /** Anchor href (only meaningful for `<a>`). */
  href?: string;
  /** Input/button `type`. */
  type?: string;
  /** Input/select value. */
  value?: string;
  /** Click handler. */
  onClick?: (e: MouseEvent) => void;
  /** Change handler (inputs/selects). */
  onChange?: (e: Event) => void;
  /** aria-label for accessibility. */
  ariaLabel?: string;
  /** Arbitrary extra attributes (data-*, role, etc.). */
  attrs?: Record<string, string>;
}

/**
 * Create an element of `tag`, apply `props`, and append `children`.
 * Returns the concrete element type so callers keep full typing.
 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElProps = {},
  children: Child[] | Child = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.class !== undefined) node.className = props.class;
  if (props.text !== undefined) node.textContent = props.text;
  if (props.href !== undefined) node.setAttribute('href', props.href);
  if (props.type !== undefined) node.setAttribute('type', props.type);
  if (props.value !== undefined) {
    (node as HTMLInputElement | HTMLSelectElement).value = props.value;
  }
  if (props.ariaLabel !== undefined) node.setAttribute('aria-label', props.ariaLabel);
  if (props.onClick) node.addEventListener('click', props.onClick as EventListener);
  if (props.onChange) node.addEventListener('change', props.onChange);
  if (props.attrs) {
    for (const [k, v] of Object.entries(props.attrs)) node.setAttribute(k, v);
  }
  const kids = Array.isArray(children) ? children : [children];
  for (const child of kids) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

/** Replace all children of `root` with `children`. */
export function mount(root: HTMLElement, ...children: Child[]): void {
  const nodes: Node[] = [];
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    nodes.push(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  root.replaceChildren(...nodes);
}

/**
 * Inline CODE SPAN delimiter: a backtick-wrapped run (no nested backticks).
 * Code spans are rendered verbatim — NO bold/superscript/subscript transforms
 * are applied inside them, so e.g. `a^b` in code stays literal. @internal
 */
const CODE_SPAN_RE = /`([^`]+)`/g;

/**
 * SUPERSCRIPT / SUBSCRIPT inline math.
 *
 * The BASE char (a digit, letter, or a closing bracket `)`/`]`/`}`) is kept as
 * normal text; the exponent/index that follows is lifted into a real `<sup>` /
 * `<sub>`. Superscripts accept either a BRACED body `^{...}` or — for backwards
 * safety with existing numeric content such as `10^4`, `10^-4`, `2^80` — a bare
 * run of (optionally signed) digits `^-?\d+`. Subscripts accept ONLY the braced
 * form `_{...}`, so ordinary snake_case prose is never mangled. @internal
 */
const MATH_RE = /([0-9A-Za-z)\]}])(?:\^(\{[^}]*\}|-?\d+)|_(\{[^}]*\}))/g;

/** Strip the outer `{ }` from a braced math body; leave a bare body unchanged. @internal */
function stripBraces(s: string): string {
  return s.startsWith('{') ? s.slice(1, -1) : s;
}

/**
 * Lift `base^exp` / `base_{idx}` runs in a plain-text (no code, no bold)
 * fragment into real `<sup>`/`<sub>` nodes. The base character is re-emitted as
 * ordinary text and only the exponent/index is wrapped, so `2^80` renders as
 * "2" + `<sup>80</sup>`. Everything is a text node / element — never HTML. @internal
 */
function mathNodes(text: string): Node[] {
  const out: Node[] = [];
  let last = 0;
  MATH_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MATH_RE.exec(text)) !== null) {
    if (m.index > last) out.push(document.createTextNode(text.slice(last, m.index)));
    out.push(document.createTextNode(m[1]!)); // base stays as normal text
    if (m[2] !== undefined) out.push(el('sup', { text: stripBraces(m[2]) }));
    else if (m[3] !== undefined) out.push(el('sub', { text: stripBraces(m[3]) }));
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(document.createTextNode(text.slice(last)));
  return out;
}

/**
 * Apply `**bold**` splitting then inline math to a CODE-FREE fragment. Even
 * segments are plain text, odd segments are bold — no HTML is ever parsed. Both
 * flow through {@link mathNodes} so superscripts/subscripts work inside and
 * outside bold spans. @internal
 */
function boldAndMath(text: string): Node[] {
  const out: Node[] = [];
  const parts = text.split('**');
  parts.forEach((part, i) => {
    if (i % 2 === 1) out.push(el('strong', {}, mathNodes(part)));
    else out.push(...mathNodes(part));
  });
  return out;
}

/**
 * Render a single line of inline markdown into safe DOM nodes. Supports inline
 * `` `code` `` spans (verbatim), `**bold**`, and `base^{exp}`/`base^digits`
 * superscripts + `x_{i}` subscripts. No HTML is ever parsed — every segment is a
 * text node or an element built via {@link el}. @internal
 */
function inlineNodes(line: string): Node[] {
  const out: Node[] = [];
  let last = 0;
  CODE_SPAN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CODE_SPAN_RE.exec(line)) !== null) {
    if (m.index > last) out.push(...boldAndMath(line.slice(last, m.index)));
    out.push(el('code', { class: 'md-code', text: m[1]! }));
    last = m.index + m[0].length;
  }
  if (last < line.length) out.push(...boldAndMath(line.slice(last)));
  return out;
}

/**
 * Render a single line of inline markdown (`**bold**`) into safe DOM nodes,
 * for callers that build their own containers (e.g. the "Key facts" definition
 * grid). Never parses HTML — text nodes + `<strong>` only.
 */
export function renderInline(line: string): Node[] {
  return inlineNodes(line);
}

/** A GFM table separator row, e.g. `|---|:--:|` (must contain a dash). @internal */
function isTableSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{1,}:?\s*(?:\|\s*:?-{1,}:?\s*)*\|?\s*$/.test(line) && line.includes('-');
}

/**
 * Split one pipe-table row into trimmed cell strings, tolerating the optional
 * leading/trailing pipes GFM allows. @internal
 */
function tableCells(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}

/**
 * Pad with empty cells (or truncate) so a body row matches the header's column
 * count. This makes a single malformed row (too few/too many cells) harmless:
 * the table still renders as a tidy grid instead of collapsing. @internal
 */
function normaliseRow(cells: string[], cols: number): string[] {
  if (cells.length === cols) return cells;
  if (cells.length > cols) return cells.slice(0, cols);
  return [...cells, ...Array<string>(cols - cells.length).fill('')];
}

/**
 * Minimal, safe markdown → DOM renderer for note bodies and MCQ explanations.
 *
 * Supports the subset the content uses: `## ` / `### ` headings, `- `/`* `
 * bullet lists, `1.` ordered lists, GFM pipe TABLES (header + `---` separator),
 * `---` horizontal rules, blank-line paragraph breaks, and inline `**bold**`.
 * Everything is built as text nodes/elements (never innerHTML), so content can
 * never inject markup. Tables are wrapped in a scroll container so wide fact
 * tables stay usable on mobile.
 */
export function renderMarkdown(md: string): Node[] {
  const out: Node[] = [];
  const lines = md.split('\n');
  // Current open list plus whether it is ordered, so mixed lists split cleanly.
  let list: { node: HTMLUListElement | HTMLOListElement; ordered: boolean } | null = null;

  const flushList = (): void => {
    if (list) {
      out.push(list.node);
      list = null;
    }
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = (lines[i] ?? '').trimEnd();
    const trimmed = line.trim();

    if (trimmed === '') {
      flushList();
      continue;
    }

    // GFM pipe table: a row containing "|" immediately followed by a separator.
    const next = lines[i + 1];
    if (trimmed.includes('|') && next !== undefined && isTableSeparator(next)) {
      flushList();
      const header = tableCells(line);
      const cols = header.length;
      const table = el('table', { class: 'md-table' });
      const thead = el('thead', {}, [
        el('tr', {}, header.map((c) => el('th', { attrs: { scope: 'col' } }, inlineNodes(c)))),
      ]);
      const tbody = el('tbody');
      let j = i + 2;
      for (; j < lines.length; j += 1) {
        const row = (lines[j] ?? '').trimEnd();
        if (row.trim() === '' || !row.includes('|')) break;
        // Pad/truncate every row to the header width so one bad row can't break
        // the grid (fewer cells → padded empty; more cells → extras dropped).
        const cells = normaliseRow(tableCells(row), cols);
        tbody.append(el('tr', {}, cells.map((c) => el('td', {}, inlineNodes(c)))));
      }
      table.append(thead, tbody);
      out.push(el('div', { class: 'md-table-wrap' }, [table]));
      i = j - 1;
      continue;
    }

    if (/^(?:-{3,}|\*{3,})$/.test(trimmed)) {
      flushList();
      out.push(el('hr', { class: 'md-hr' }));
    } else if (trimmed.startsWith('### ')) {
      flushList();
      out.push(el('h4', {}, inlineNodes(trimmed.slice(4))));
    } else if (trimmed.startsWith('## ')) {
      flushList();
      out.push(el('h3', {}, inlineNodes(trimmed.slice(3))));
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      if (!list || list.ordered) {
        flushList();
        list = { node: el('ul'), ordered: false };
      }
      list.node.append(el('li', {}, inlineNodes(trimmed.slice(2))));
    } else if (/^\d+\.\s+/.test(trimmed)) {
      if (!list || !list.ordered) {
        flushList();
        list = { node: el('ol'), ordered: true };
      }
      list.node.append(el('li', {}, inlineNodes(trimmed.replace(/^\d+\.\s+/, ''))));
    } else {
      flushList();
      out.push(el('p', {}, inlineNodes(line)));
    }
  }
  flushList();
  return out;
}
