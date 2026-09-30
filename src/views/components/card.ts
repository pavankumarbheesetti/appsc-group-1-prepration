/**
 * Card — the primary surface primitive. A titled, elevated container.
 */
import { el, type Child } from '../dom';

/** Options for {@link card}. */
export interface CardOpts {
  /** Optional heading rendered at the top of the card. */
  title?: string;
  /** Optional sub-line under the title. */
  subtitle?: string;
  /** Extra class names appended to `.card`. */
  class?: string;
}

/** Build a card element wrapping `children`. */
export function card(opts: CardOpts, children: Child[] | Child = []): HTMLElement {
  const head: Child[] = [];
  if (opts.title) head.push(el('h2', { class: 'card-title', text: opts.title }));
  if (opts.subtitle) head.push(el('p', { class: 'card-sub', text: opts.subtitle }));
  const kids = Array.isArray(children) ? children : [children];
  return el('section', { class: opts.class ? `card ${opts.class}` : 'card' }, [...head, ...kids]);
}
