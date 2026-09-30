/**
 * SVG progress ring — a hand-built circular gauge (no charting library).
 *
 * The arc length technique: a circle's circumference is C = 2πr. By setting
 * `stroke-dasharray = C` and `stroke-dashoffset = C * (1 - fraction)`, exactly
 * `fraction` of the ring is painted. The SVG is rotated -90° in CSS so the arc
 * starts at 12 o'clock. The gradient stroke reuses the app accent.
 */
import { el } from '../dom';
import { svgEl } from './svg';

/** Options for {@link ring}. */
export interface RingOpts {
  /** Progress fraction in [0, 1]; clamped defensively. */
  value: number;
  /** Big text shown at the ring center (e.g. "72%"). */
  centerText: string;
  /** Small caption under the center text. */
  centerLabel?: string;
  /** Outer diameter in px. */
  size?: number;
  /** Stroke thickness in px. */
  stroke?: number;
  /** Stroke variant → chooses the gradient/solid color. */
  variant?: 'accent' | 'success' | 'warning' | 'danger';
}

/** Monotonic counter so each ring's <linearGradient> id is unique per document. */
let gradientSeq = 0;

/** Build a progress ring element. */
export function ring(opts: RingOpts): HTMLElement {
  const size = opts.size ?? 120;
  const stroke = opts.stroke ?? 12;
  const variant = opts.variant ?? 'accent';
  const fraction = Math.max(0, Math.min(1, opts.value));

  const r = (size - stroke) / 2; // inset radius so the stroke stays inside the box
  const c = 2 * Math.PI * r; // circumference → dash length
  const offset = c * (1 - fraction); // hidden portion of the arc
  const center = size / 2;

  const gradId = `ring-grad-${(gradientSeq += 1)}`;

  // Gradient stops per variant. Chosen so the painted arc keeps >=3:1 contrast
  // against the ring track (var(--bg-2)) in BOTH themes: the accent uses a
  // tight indigo ramp (avoids the too-dark #3b47c4 that fell to 2.5:1 on the
  // dark track), and the muted semantics render solid (their light tints
  // dropped below 3:1 on the light track). Kept in sync with tokens.css.
  const stops: Array<[string, string]> =
    variant === 'success'
      ? [['#3f8f57', '#3f8f57']]
      : variant === 'warning'
        ? [['#b07d24', '#b07d24']]
        : variant === 'danger'
          ? [['#c14a3f', '#c14a3f']]
          : [['#5b6cf0', '#4a5ae0']];
  const [from, to] = stops[0] ?? ['#5b6cf0', '#4a5ae0'];

  const defs = svgEl('defs', {}, [
    svgEl('linearGradient', { id: gradId, x1: '0', y1: '0', x2: '1', y2: '1' }, [
      svgEl('stop', { offset: '0%', 'stop-color': from }),
      svgEl('stop', { offset: '100%', 'stop-color': to }),
    ]),
  ]);

  // Track (full circle, muted) + arc (the painted fraction).
  const track = svgEl('circle', {
    cx: center,
    cy: center,
    r,
    fill: 'none',
    stroke: 'var(--bg-2)',
    'stroke-width': stroke,
  });
  const arc = svgEl('circle', {
    cx: center,
    cy: center,
    r,
    fill: 'none',
    stroke: `url(#${gradId})`,
    'stroke-width': stroke,
    'stroke-linecap': 'round',
    'stroke-dasharray': c,
    'stroke-dashoffset': offset,
    class: 'ring-arc',
  });

  const svg = svgEl(
    'svg',
    {
      width: size,
      height: size,
      viewBox: `0 0 ${size} ${size}`,
      role: 'img',
      'aria-label': `${opts.centerText} ${opts.centerLabel ?? ''}`.trim(),
    },
    [defs, track, arc],
  );

  const centerBox = el('div', { class: 'ring-center' }, [
    el('span', { class: 'ring-value tnum', text: opts.centerText }),
    opts.centerLabel ? el('span', { class: 'ring-label', text: opts.centerLabel }) : null,
  ]);

  const wrap = el('div', { class: 'ring', attrs: { style: `width:${size}px;height:${size}px` } });
  wrap.appendChild(svg);
  wrap.appendChild(centerBox);
  return wrap;
}
