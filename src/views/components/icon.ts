/**
 * Inline SVG icon set — hand-authored, offline, zero-dependency.
 *
 * No icon font, no CDN, no sprite fetch: each icon is built as real namespaced
 * SVG nodes via {@link svgEl}. Icons inherit color via `stroke="currentColor"`
 * so they adapt to theme and active states automatically. All use a 24×24
 * viewBox with a 2px stroke for visual consistency (a "line" icon family).
 */
import { svgEl } from './svg';

/** The set of icon names this module can render. */
export type IconName =
  | 'dashboard'
  | 'drill'
  | 'notebook'
  | 'syllabus'
  | 'notes'
  | 'sun'
  | 'moon'
  | 'menu'
  | 'chevron'
  | 'check'
  | 'x'
  | 'arrow-right'
  | 'flame'
  | 'target'
  | 'sparkles'
  | 'book-open'
  | 'revise'
  | 'calendar'
  | 'timer'
  | 'search'
  | 'globe'
  | 'gear'
  | 'circle'
  | 'external-link'
  | 'history';

/**
 * SVG path `d` strings per icon (24×24 viewBox). Kept as data so {@link icon}
 * is a single, uniform factory. Multi-path icons list several `d` strings.
 */
const PATHS: Record<IconName, string[]> = {
  // Home/dashboard: a house outline.
  dashboard: ['M3 10.5 12 3l9 7.5', 'M5 9.5V21h14V9.5'],
  // Drill/focus: concentric target with a center dot (a "bullseye" of focus).
  drill: ['M12 3v3', 'M12 18v3', 'M3 12h3', 'M18 12h3'],
  // Notebook: a bookmarked page.
  notebook: ['M6 3h11a1 1 0 0 1 1 1v17l-3-2-3 2-3-2-3 2V4a1 1 0 0 1 1-1z'],
  // Syllabus: a checklist.
  syllabus: ['M9 5h11', 'M9 12h11', 'M9 19h11', 'M4 5h.01M4 12h.01M4 19h.01'],
  // Notes: lined document.
  notes: ['M6 3h9l4 4v14a0 0 0 0 1 0 0H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z', 'M9 12h6', 'M9 16h6'],
  sun: [
    'M12 4V2M12 22v-2M4 12H2M22 12h-2M6 6 4.5 4.5M19.5 19.5 18 18M18 6l1.5-1.5M4.5 19.5 6 18',
  ],
  moon: ['M20 14.5A8 8 0 0 1 9.5 4a7 7 0 1 0 10.5 10.5z'],
  menu: ['M4 7h16', 'M4 12h16', 'M4 17h16'],
  chevron: ['M9 6l6 6-6 6'],
  check: ['M5 13l4 4L19 7'],
  x: ['M6 6l12 12M18 6 6 18'],
  'arrow-right': ['M5 12h14', 'M13 6l6 6-6 6'],
  // Flame: a streak indicator.
  flame: ['M12 3c1 3-2 4-2 7a2 2 0 1 0 4 0c2 2 3 3 3 6a5 5 0 0 1-10 0c0-4 4-5 5-13z'],
  target: ['M12 3v3', 'M12 18v3', 'M3 12h3', 'M18 12h3'],
  sparkles: ['M12 4l1.5 4.5L18 10l-4.5 1.5L12 16l-1.5-4.5L6 10l4.5-1.5z', 'M18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z'],
  'book-open': ['M12 6c-2-1.5-5-1.5-7 0v12c2-1.5 5-1.5 7 0m0-12c2-1.5 5-1.5 7 0v12c-2-1.5-5-1.5-7 0m0-12v12'],
  // Revise: a repeat/refresh loop — evokes spaced-repetition review cycles.
  revise: ['M4 12a8 8 0 0 1 13.5-5.8L20 8', 'M20 12a8 8 0 0 1-13.5 5.8L4 16', 'M20 4v4h-4', 'M4 20v-4h4'],
  // Calendar: a month grid with a top binding — the planner's schedule glyph.
  calendar: ['M4 6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z', 'M4 9h16', 'M8 3v4', 'M16 3v4'],
  // Timer: a clock face with hands — the timed-mock glyph (circle from CIRCLES).
  timer: ['M12 8v4l3 2'],
  // Search: a magnifier (circle lens + handle).
  search: ['M20 20l-3.5-3.5'],
  // Globe: a world with meridians — the Languages area glyph.
  globe: ['M3 12h18', 'M12 3c2.5 2.5 3.8 5.7 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.7-3.8-9s1.3-6.5 3.8-9z'],
  // Gear: a cog outline + inner disc — the Settings / utility glyph.
  gear: [
    'M19.4 13a7.9 7.9 0 0 0 0-2l2-1.5-2-3.5-2.3 1a8 8 0 0 0-1.7-1l-.3-2.5h-4l-.3 2.5a8 8 0 0 0-1.7 1l-2.3-1-2 3.5 2 1.5a7.9 7.9 0 0 0 0 2l-2 1.5 2 3.5 2.3-1a8 8 0 0 0 1.7 1l.3 2.5h4l.3-2.5a8 8 0 0 0 1.7-1l2.3 1 2-3.5-2-1.5z',
  ],
  // History: a rewind clock — the chronological Timeline glyph.
  history: ['M4 12a8 8 0 1 0 2.4-5.7', 'M4 4v4h4', 'M12 8v4l3 1.6'],
  // External link: a box with an arrow leaving it — opens a source URL.
  'external-link': ['M14 5h5v5', 'M19 5l-7 7', 'M18 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4'],
  // Circle: a plain ring — the "not started" status marker (shape, not colour).
  circle: [],
};

/** Icons that also need a circle element (targets/bullseyes, sun disc). @internal */
const CIRCLES: Partial<Record<IconName, Array<{ r: number }>>> = {
  drill: [{ r: 9 }, { r: 4.5 }],
  target: [{ r: 9 }, { r: 4.5 }],
  // The sun needs its central disc; without it the bare rays read as a faint
  // spinner-like glyph rather than a legible sun.
  sun: [{ r: 4.2 }],
  // Search: the magnifier lens (offset up-left so the M20 20 handle reads).
  search: [{ r: 7 }],
  // Timer: the clock face.
  timer: [{ r: 9 }],
  // Globe: the world outline.
  globe: [{ r: 9 }],
  // Gear: the inner hub disc.
  gear: [{ r: 3.1 }],
  // Circle: the status ring itself.
  circle: [{ r: 8 }],
};

/**
 * Build an `<svg>` icon node. `size` sets width/height (px); stroke color is
 * inherited from the CSS `color` of the element via `currentColor`.
 */
export function icon(name: IconName, size = 22): SVGSVGElement {
  const svg = svgEl(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 2,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      class: 'nav-icon',
      'aria-hidden': 'true',
      focusable: 'false',
    },
    [
      ...(CIRCLES[name] ?? []).map((c) =>
        svgEl('circle', { cx: 12, cy: 12, r: c.r }),
      ),
      ...PATHS[name].map((d) => svgEl('path', { d })),
    ],
  );
  return svg;
}
