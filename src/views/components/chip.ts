/**
 * Chip / badge — a small pill for status and metadata.
 */
import { el } from '../dom';
import { icon, type IconName } from './icon';

/** Visual tone of a chip. */
export type ChipTone = 'default' | 'ok' | 'warn' | 'danger' | 'accent' | 'muted';

/** Options for {@link chip}. */
export interface ChipOpts {
  text: string;
  tone?: ChipTone;
  /** Optional leading inline-SVG icon. */
  iconName?: IconName;
  /** Optional native tooltip (e.g. explaining a "Quick pass" badge). */
  title?: string;
}

/** Map a tone to its CSS modifier class. @internal */
const TONE_CLASS: Record<ChipTone, string> = {
  default: '',
  ok: 'chip-ok',
  warn: 'chip-warn',
  danger: 'chip-danger',
  accent: 'chip-accent',
  muted: 'chip-muted',
};

/** Build a chip element. */
export function chip(opts: ChipOpts): HTMLElement {
  const tone = opts.tone ?? 'default';
  const cls = ['chip', TONE_CLASS[tone]].filter(Boolean).join(' ');
  const node = el('span', { class: cls });
  if (opts.title) node.setAttribute('title', opts.title);
  if (opts.iconName) node.appendChild(icon(opts.iconName, 13));
  node.appendChild(document.createTextNode(opts.text));
  return node;
}
