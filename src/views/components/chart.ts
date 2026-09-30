/**
 * SVG bar chart — a hand-built, responsive vertical bar chart (no library).
 *
 * Bars are laid out in a fixed viewBox and scale fluidly to their container
 * (width=100%, aspect preserved). Each bar's height is proportional to its
 * value against a "nice" axis ceiling (see {@link niceMax}) that keeps headroom,
 * so a single subject or all-equal values never fill the whole plot as one flat
 * block. Bar width is capped so a lone column reads as a bar rather than a slab.
 * A baseline axis is always drawn; zero-value bars collapse onto it as a faint
 * stub so the axis reads as "nothing yet" rather than looking broken.
 */
import { el } from '../dom';
import { niceMax } from '../../lib/metrics';
import { svgEl } from './svg';

/** One datum in a {@link barChart}. */
export interface BarDatum {
  /** Short label under the bar. */
  label: string;
  /** Non-negative value. */
  value: number;
}

/** Options for {@link barChart}. */
export interface BarChartOpts {
  data: readonly BarDatum[];
  /** Accessible description of the chart. */
  ariaLabel: string;
}

const VIEW_W = 300;
const VIEW_H = 140;
const PAD_BOTTOM = 24; // room for category labels + baseline
const PAD_TOP = 16; // room for value labels above the tallest bar
const MAX_BAR_W = 46; // cap so a lone bar reads as a bar, not a slab
const BASELINE = VIEW_H - PAD_BOTTOM; // y of the axis all bars sit on

/** Build a responsive SVG bar chart element. */
export function barChart(opts: BarChartOpts): HTMLElement {
  const data = opts.data;
  const n = Math.max(1, data.length);
  // Scale against a "nice" ceiling with headroom (not the raw max) so a single
  // subject / all-equal values never fill the whole plot as one flat block.
  const max = niceMax(Math.max(0, ...data.map((d) => d.value)));
  const plotH = BASELINE - PAD_TOP;

  // Column geometry: evenly split width; bar takes half its column but is
  // capped so one wide column can't render a full-width rectangle.
  const colW = VIEW_W / n;
  const barW = Math.min(colW * 0.5, MAX_BAR_W);

  // The axis baseline — always drawn so an empty/zero chart reads as a clean
  // axis rather than a broken or filled area.
  const baseline = svgEl('line', {
    x1: 0,
    y1: BASELINE,
    x2: VIEW_W,
    y2: BASELINE,
    stroke: 'var(--border)',
    'stroke-width': 1,
  });

  const bars: SVGElement[] = [];
  data.forEach((d, i) => {
    const cx = i * colW + colW / 2;
    // Height is proportional to value / nice-max; a zero value collapses onto
    // the baseline (rendered as a faint stub, never a full-height block).
    const h = d.value > 0 ? Math.max(2, (d.value / max) * plotH) : 2;
    const y = BASELINE - h;
    bars.push(
      svgEl('rect', {
        x: cx - barW / 2,
        y,
        width: barW,
        height: h,
        rx: 4,
        fill: d.value > 0 ? 'url(#bar-grad)' : 'var(--bg-2)',
      }),
    );
    // Value label above the bar (only when there's data to report).
    if (d.value > 0) {
      bars.push(
        svgEl(
          'text',
          {
            x: cx,
            y: y - 3,
            'text-anchor': 'middle',
            'font-size': 11,
            fill: 'var(--text-2)',
          },
          [textNode(String(d.value))],
        ),
      );
    }
    // Category label under the axis.
    bars.push(
      svgEl(
        'text',
        {
          x: cx,
          y: VIEW_H - 6,
          'text-anchor': 'middle',
          'font-size': 11,
          fill: 'var(--text-2)',
        },
        [textNode(d.label)],
      ),
    );
  });

  const defs = svgEl('defs', {}, [
    svgEl('linearGradient', { id: 'bar-grad', x1: '0', y1: '0', x2: '0', y2: '1' }, [
      svgEl('stop', { offset: '0%', 'stop-color': '#5b6cf0' }),
      svgEl('stop', { offset: '100%', 'stop-color': '#4a5ae0' }),
    ]),
  ]);

  const svg = svgEl(
    'svg',
    {
      viewBox: `0 0 ${VIEW_W} ${VIEW_H}`,
      class: 'chart-bars',
      role: 'img',
      'aria-label': opts.ariaLabel,
      preserveAspectRatio: 'xMidYMid meet',
    },
    [defs, baseline, ...bars],
  );

  return el('div', { class: 'chart' }, [svg]);
}

/** Create an SVG-safe text node. @internal */
function textNode(text: string): SVGElement {
  // <tspan> lets us append text through the namespaced element helper.
  const t = svgEl('tspan', {});
  t.textContent = text;
  return t;
}
