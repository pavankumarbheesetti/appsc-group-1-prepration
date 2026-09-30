/**
 * Progress bar — a labelled linear meter built from safe DOM nodes.
 *
 * The fill width is an inline `style` percentage (the ONLY dynamic style we
 * set, and it's a clamped number, never content), animated via a CSS
 * transition that the reduced-motion gate disables.
 */
import { el } from '../dom';

/** Options for {@link progressBar}. */
export interface ProgressOpts {
  /** Fraction in [0, 1]; clamped. */
  value: number;
  /** Optional label shown left of the meter row. */
  label?: string;
  /** Optional right-aligned value caption (e.g. "3/5"). */
  caption?: string;
  /** Success styling once complete or on demand. */
  success?: boolean;
}

/** Build a progress bar element. */
export function progressBar(opts: ProgressOpts): HTMLElement {
  const pct = Math.round(Math.max(0, Math.min(1, opts.value)) * 100);
  const track = el('div', { class: 'progress-track' }, [
    el('div', {
      class: opts.success ? 'progress-fill is-success' : 'progress-fill',
      attrs: {
        style: `width:${pct}%`,
        role: 'progressbar',
        'aria-valuenow': String(pct),
        'aria-valuemin': '0',
        'aria-valuemax': '100',
      },
    }),
  ]);

  const meta =
    opts.label || opts.caption
      ? el('div', { class: 'progress-meta' }, [
          el('span', { text: opts.label ?? '' }),
          el('span', { class: 'tnum', text: opts.caption ?? '' }),
        ])
      : null;

  return el('div', { class: 'progress' }, [meta, track]);
}
