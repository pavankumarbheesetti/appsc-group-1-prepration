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
 * Render a single line of inline markdown (`**bold**`) into safe DOM nodes.
 * Splitting on `**` means even segments are plain text and odd segments are
 * bold — no HTML is ever parsed. @internal
 */
function inlineNodes(line: string): Node[] {
  const parts = line.split('**');
  return parts.map((part, i) =>
    i % 2 === 1 ? el('strong', { text: part }) : document.createTextNode(part),
  );
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
      const table = el('table', { class: 'md-table' });
      const thead = el('thead', {}, [
        el('tr', {}, tableCells(line).map((c) => el('th', {}, inlineNodes(c)))),
      ]);
      const tbody = el('tbody');
      let j = i + 2;
      for (; j < lines.length; j += 1) {
        const row = (lines[j] ?? '').trimEnd();
        if (row.trim() === '' || !row.includes('|')) break;
        tbody.append(el('tr', {}, tableCells(row).map((c) => el('td', {}, inlineNodes(c)))));
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
