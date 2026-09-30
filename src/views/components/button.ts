/**
 * Button factory — consistent variants with optional inline-SVG icon.
 */
import { el } from '../dom';
import { icon, type IconName } from './icon';

/** Button visual variant. */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost';

/** Options for {@link button}. */
export interface ButtonOpts {
  label: string;
  onClick: () => void;
  variant?: ButtonVariant;
  /** Larger padding/type for hero CTAs. */
  large?: boolean;
  /** Stretch to full container width. */
  block?: boolean;
  /** Optional trailing icon (e.g. arrow-right on CTAs). */
  iconName?: IconName;
  /** aria-label override when the visible label needs supplementing. */
  ariaLabel?: string;
  /** Render as a non-interactive, disabled control. */
  disabled?: boolean;
}

/** Build a button element. */
export function button(opts: ButtonOpts): HTMLButtonElement {
  const variant = opts.variant ?? 'secondary';
  const cls = ['btn', `btn-${variant}`];
  if (opts.large) cls.push('btn-lg');
  if (opts.block) cls.push('btn-block');

  const btn = el('button', {
    class: cls.join(' '),
    type: 'button',
    onClick: opts.onClick,
    ariaLabel: opts.ariaLabel,
    attrs: opts.disabled ? { disabled: 'true', 'aria-disabled': 'true' } : {},
  });
  btn.appendChild(document.createTextNode(opts.label));
  if (opts.iconName) btn.appendChild(icon(opts.iconName, 18));
  return btn;
}
