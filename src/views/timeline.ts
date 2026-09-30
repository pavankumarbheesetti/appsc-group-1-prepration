/**
 * Timeline VIEW (`#/timeline`) — an interactive, offline, dependency-free
 * chronology of the whole APPSC Group-1 syllabus, superseding the old vertical
 * ancient-only strip.
 *
 * DESKTOP / TABLET: a horizontal time axis with a LINEAR or a non-linear
 * "emphasis" scale (ancient centuries compressed, modern decades expanded),
 * zoom (buttons + ctrl/⌘-wheel + pinch) and pan (drag + arrow keys); shaded ERA
 * bands behind eight parallel swim LANES (North/South India, Deccan, Andhra,
 * World, Polity, Economy, Science & Tech); dynasty PERIOD bars and event
 * MARKERS sized by importance and shaped by kind, with an overlap-avoiding
 * label layout; a minimap overview strip; "jump to era" chips; filters (lanes,
 * eras, kinds, subject, AP-only, importance); and search that pans to a match.
 *
 * Selecting an event opens a SIDE PANEL (date, summary, detail markdown, AP
 * badge, linked subtopics → Learn, and "Drill related MCQs"); selecting a
 * period bar opens a PERIOD panel listing its events.
 *
 * LEARNING MODES: a chronology-ordering challenge, a "guess the year" flash
 * round, and a "which came first" quick quiz — all driven from the current
 * filtered set. (No timeline-specific progress API exists, so results are shown
 * but not persisted — see the note on {@link openChronologyGame}.)
 *
 * MOBILE (<600px): a vertical era-grouped list with lane filter chips and the
 * same detail bottom-sheet.
 *
 * ACCESSIBILITY: canvas markers are keyboard-focusable buttons AND there is a
 * list/table view toggle (role=list grouped by era) mirroring the canvas; an
 * aria-live region announces filter/search/mode outcomes; motion honours
 * prefers-reduced-motion; light + dark via tokens. The pure scale/layout/filter
 * logic lives in {@link ../lib/timeline.ts}; this module is DOM only.
 */
import { getSubtopic, getTimeline } from '../content/loader';
import { SUBJECTS, SUBJECT_CODES, type SubjectCode } from '../content/types';
import type {
  EraId,
  Kind,
  Lane,
  TimelineEvent,
  TimelinePeriod,
} from '../content/timeline-types';
import { ERA_IDS, LANE_IDS } from '../content/timeline-types';
import {
  ERA_META,
  KIND_META,
  LANE_META,
  assignRows,
  axisTicks,
  buildTimeScale,
  byYear,
  defaultFilter,
  eraBands,
  eraSpansFromEvents,
  filterEvents,
  formatYear,
  groupEventsByEra,
  markerRadius,
  mulberry32,
  pickChronology,
  pickPair,
  scoreChronology,
  searchEvents,
  whichCameFirst,
  yearDistance,
  type MarkerShape,
  type ScaleMode,
  type TimeScale,
  type TimelineFilter,
} from '../lib/timeline';
import { buildSession } from '../engine/drill';
import { el, mount, renderMarkdown, type Child } from './dom';
import { svgEl } from './components/svg';
import { icon, type IconName } from './components/icon';
import { button } from './components/button';
import { card } from './components/card';
import { chip } from './components/chip';
import { openLearn } from './learn';
import { mountQuiz } from './quiz';

/* -------------------------------------------------------------------------- */
/* Geometry constants                                                          */
/* -------------------------------------------------------------------------- */

/** Base scale width (px) at zoom 1 — the axis is `BASE_WIDTH * zoom` wide. */
const BASE_WIDTH = 1600;
/** Height of one swim lane band (px). */
const LANE_H = 72;
/** Height of the top axis strip (px). */
const AXIS_H = 34;
/** Minimap strip height (px). */
const MINIMAP_H = 46;
/** Zoom bounds + step. */
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 24;
const ZOOM_STEP = 1.35;

/* -------------------------------------------------------------------------- */
/* View state                                                                  */
/* -------------------------------------------------------------------------- */

/** The active canvas ("map") vs the accessible grouped list. */
type ViewMode = 'canvas' | 'list';

/** Live, mutable state for one mounted timeline. @internal */
interface TLState {
  filter: TimelineFilter;
  scaleMode: ScaleMode;
  zoom: number;
  /** Horizontal pan offset (px, <= 0 when scrolled right). */
  panX: number;
  selectedEventId: string | null;
  selectedPeriodId: string | null;
  viewMode: ViewMode;
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                 */
/* -------------------------------------------------------------------------- */

/** Render the Timeline into `root`. */
export function render(root: HTMLElement): void {
  const bank = getTimeline();
  // A stable subject resolver: an event's subject(s) come from its subtopics.
  const subjectCache = new Map<string, SubjectCode[]>();
  const subjectsOf = (ev: TimelineEvent): SubjectCode[] => {
    const cached = subjectCache.get(ev.id);
    if (cached) return cached;
    const set = new Set<SubjectCode>();
    for (const sid of ev.subtopicIds) {
      const code = getSubtopic(sid)?.meta.subjectCode;
      if (code) set.add(code);
    }
    const arr = [...set];
    subjectCache.set(ev.id, arr);
    return arr;
  };

  const isMobile =
    typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 600px)').matches;

  if (isMobile) {
    renderMobile(root, bank.events);
    return;
  }
  renderDesktop(root, bank.events, bank.periods, subjectsOf);
}

/* -------------------------------------------------------------------------- */
/* Marker shape drawing                                                        */
/* -------------------------------------------------------------------------- */

/** Build an SVG shape for `kind` centred at (cx, cy). @internal */
function markerShape(shape: MarkerShape, cx: number, cy: number, r: number): SVGElement {
  switch (shape) {
    case 'square':
      return svgEl('rect', { x: cx - r, y: cy - r, width: r * 2, height: r * 2, rx: 1.5 });
    case 'diamond':
      return svgEl('polygon', { points: `${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}` });
    case 'triangle':
      return svgEl('polygon', { points: `${cx},${cy - r} ${cx + r},${cy + r} ${cx - r},${cy + r}` });
    case 'circle':
    default:
      return svgEl('circle', { cx, cy, r });
  }
}

/* -------------------------------------------------------------------------- */
/* Desktop timeline                                                            */
/* -------------------------------------------------------------------------- */

/** Render the full interactive desktop/tablet timeline. @internal */
function renderDesktop(
  root: HTMLElement,
  events: readonly TimelineEvent[],
  periods: readonly TimelinePeriod[],
  subjectsOf: (ev: TimelineEvent) => SubjectCode[],
): void {
  const state: TLState = {
    filter: defaultFilter(),
    scaleMode: 'nonlinear',
    zoom: 1,
    panX: 0,
    selectedEventId: null,
    selectedPeriodId: null,
    viewMode: 'canvas',
  };

  // The lanes present (in canonical order) — always all eight for a stable axis.
  const lanes = [...LANE_IDS];

  /* ---- persistent DOM handles ------------------------------------------- */
  const live = el('div', { class: 'tl-live', attrs: { role: 'status', 'aria-live': 'polite' } });
  const gutter = el('div', { class: 'tl-gutter' });
  const plot = el('div', { class: 'tl-plot' });
  const minimap = el('div', { class: 'tl-minimap' });
  const listWrap = el('div', { class: 'tl-list-wrap', attrs: { hidden: 'true' } });
  const panel = el('aside', { class: 'tl-panel', attrs: { hidden: 'true', 'aria-label': 'Details' } });
  let svg: SVGSVGElement | null = null;

  const announce = (msg: string): void => {
    live.textContent = msg;
  };

  /* ---- scale + filtered data -------------------------------------------- */
  const spans = eraSpansFromEvents(events);
  const scaleWidth = (): number => BASE_WIDTH * state.zoom;
  const buildScale = (): TimeScale => buildTimeScale(spans, scaleWidth(), state.scaleMode);
  const visibleEvents = (): TimelineEvent[] => filterEvents(events, state.filter, subjectsOf);
  const plotWidth = (): number => plot.getBoundingClientRect().width || 900;

  const clampPan = (px: number): number => {
    const sw = scaleWidth();
    const pw = plotWidth();
    if (sw <= pw) return 0;
    return Math.min(0, Math.max(pw - sw, px));
  };

  /* ---- side panel ------------------------------------------------------- */
  const closePanel = (): void => {
    state.selectedEventId = null;
    state.selectedPeriodId = null;
    panel.setAttribute('hidden', 'true');
    panel.replaceChildren();
    redraw();
  };

  const startDrill = (ev: TimelineEvent): void => {
    // Prefer the event's explicit MCQ links; fall back to its subtopics' MCQs.
    const ids = [...ev.relatedMcqIds];
    if (ids.length === 0) {
      for (const sid of ev.subtopicIds) {
        const sub = getSubtopic(sid);
        if (sub) ids.push(...sub.mcqs.map((m) => m.id));
      }
    }
    const items = buildSession({ restrictToIds: ids, order: 'ladder' }).items;
    if (items.length === 0) {
      announce('No linked questions to drill for this event yet.');
      return;
    }
    mountQuiz(root, items, () => drillDone(items.length), { allowEndSession: true });
  };

  const drillDone = (n: number): void => {
    mount(
      root,
      el('div', { class: 'results' }, [
        card({ title: 'Drill complete' }, [
          el('p', { class: 'section-lead', text: `You worked ${n} question${n === 1 ? '' : 's'} from the timeline.` }),
          el('div', { class: 'focus-advance', attrs: { style: 'justify-content:center;flex-wrap:wrap' } }, [
            button({ label: 'Back to timeline', variant: 'primary', iconName: 'arrow-right', onClick: () => render(root) }),
          ]),
        ]),
      ]),
    );
  };

  const openEventPanel = (ev: TimelineEvent): void => {
    state.selectedEventId = ev.id;
    state.selectedPeriodId = null;
    const kids: Child[] = [
      el('div', { class: 'tl-panel-head' }, [
        el('span', { class: 'tl-panel-kind', text: KIND_META[ev.kind].label }),
        el('button', { class: 'icon-btn', type: 'button', ariaLabel: 'Close details', onClick: () => closePanel() }, [icon('x', 18)]),
      ]),
      el('h3', { class: 'tl-panel-title', text: ev.title }),
      el('div', { class: 'tl-panel-meta' }, [
        chip({ text: formatYear(ev.date), tone: 'muted', iconName: 'history' }),
        chip({ text: ERA_META[ev.era].label, tone: 'default' }),
        chip({ text: LANE_META[ev.lane].label, tone: 'default' }),
        ...(ev.apSpecific ? [chip({ text: 'AP-specific', tone: 'accent', iconName: 'target' })] : []),
      ]),
      el('p', { class: 'tl-panel-summary', text: ev.summary }),
      el('div', { class: 'tl-panel-detail md' }, renderMarkdown(ev.detail)),
    ];

    // Linked subtopics → open the Learn workspace.
    const links = ev.subtopicIds
      .map((sid) => ({ sid, sub: getSubtopic(sid) }))
      .filter((x): x is { sid: string; sub: NonNullable<ReturnType<typeof getSubtopic>> } => x.sub !== undefined);
    if (links.length > 0) {
      kids.push(el('p', { class: 'tl-panel-label', text: 'Linked topics' }));
      kids.push(
        el('div', { class: 'tl-panel-links' }, links.map(({ sid, sub }) =>
          el('button', {
            class: 'tl-link-btn',
            type: 'button',
            onClick: () => openLearn(sid),
          }, [el('span', { text: sub.meta.name }), icon('arrow-right', 14)]),
        )),
      );
    }

    const actions: HTMLElement[] = [];
    const drillCount = ev.relatedMcqIds.length;
    actions.push(
      button({
        label: drillCount > 0 ? `Drill ${drillCount} related MCQ${drillCount === 1 ? '' : 's'}` : 'Drill related MCQs',
        variant: 'primary',
        iconName: 'drill',
        onClick: () => startDrill(ev),
      }),
    );
    kids.push(el('div', { class: 'tl-panel-actions' }, actions));
    kids.push(el('p', { class: 'tl-panel-source', text: ev.source }));

    mount(panel, ...kids);
    panel.removeAttribute('hidden');
    redraw();
  };

  const openPeriodPanel = (period: TimelinePeriod): void => {
    state.selectedPeriodId = period.id;
    state.selectedEventId = null;
    // Events that fall within this period's span AND lane.
    const within = events
      .filter((e) => e.lane === period.lane && e.date.year >= period.startYear && e.date.year <= period.endYear)
      .sort(byYear);
    const kids: Child[] = [
      el('div', { class: 'tl-panel-head' }, [
        el('span', { class: 'tl-panel-kind', text: 'Period' }),
        el('button', { class: 'icon-btn', type: 'button', ariaLabel: 'Close details', onClick: () => closePanel() }, [icon('x', 18)]),
      ]),
      el('h3', { class: 'tl-panel-title', text: period.label }),
      el('div', { class: 'tl-panel-meta' }, [
        chip({ text: `${formatYear({ year: period.startYear })} – ${formatYear({ year: period.endYear })}`, tone: 'muted', iconName: 'history' }),
        chip({ text: LANE_META[period.lane].label, tone: 'default' }),
      ]),
    ];
    if (within.length > 0) {
      kids.push(el('p', { class: 'tl-panel-label', text: `${within.length} event${within.length === 1 ? '' : 's'} in this period` }));
      kids.push(
        el('ul', { class: 'tl-period-events', attrs: { role: 'list' } }, within.map((e) =>
          el('li', {}, [
            el('button', {
              class: 'tl-period-event',
              type: 'button',
              onClick: () => openEventPanel(e),
            }, [
              el('span', { class: 'tl-period-event-date tnum', text: formatYear(e.date) }),
              el('span', { class: 'tl-period-event-title', text: e.title }),
            ]),
          ]),
        )),
      );
    } else {
      kids.push(el('p', { class: 'tl-panel-summary is-empty', text: 'No individual events recorded inside this period.' }));
    }
    // Linked subtopics for the period.
    for (const sid of period.subtopicIds) {
      const sub = getSubtopic(sid);
      if (sub) {
        kids.push(button({ label: `Open ${sub.meta.name}`, variant: 'secondary', iconName: 'notes', onClick: () => openLearn(sid) }));
        break;
      }
    }
    mount(panel, ...kids);
    panel.removeAttribute('hidden');
    redraw();
  };

  /* ---- zoom / pan ------------------------------------------------------- */
  const clampZoom = (z: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

  /** Zoom about a plot-relative x, keeping the year under the cursor fixed. */
  const zoomAbout = (factor: number, cx: number): void => {
    const scale = buildScale();
    const yearAt = scale.fromX(cx - state.panX);
    state.zoom = clampZoom(state.zoom * factor);
    const next = buildScale();
    state.panX = clampPan(cx - next.toX(yearAt));
    redraw();
  };

  const zoomButton = (dir: 1 | -1): void => zoomAbout(dir === 1 ? ZOOM_STEP : 1 / ZOOM_STEP, plotWidth() / 2);

  const fit = (): void => {
    state.zoom = 1;
    state.panX = 0;
    redraw();
  };

  const panBy = (dx: number): void => {
    state.panX = clampPan(state.panX + dx);
    applyPan();
  };

  const applyPan = (): void => {
    const scroll = svg?.querySelector('.tl-scroll');
    if (scroll) scroll.setAttribute('transform', `translate(${state.panX} 0)`);
    updateMinimapViewport();
  };

  /** Centre the axis on `year`. */
  const panToYear = (year: number): void => {
    const scale = buildScale();
    state.panX = clampPan(plotWidth() / 2 - scale.toX(year));
    applyPan();
  };

  /* ---- SVG canvas ------------------------------------------------------- */
  const buildCanvas = (): SVGSVGElement => {
    const scale = buildScale();
    const shown = visibleEvents();
    const totalH = AXIS_H + lanes.length * LANE_H;

    const root2 = svgEl('svg', {
      class: 'tl-svg',
      width: '100%',
      height: totalH,
      viewBox: `0 0 ${plotWidth()} ${totalH}`,
      preserveAspectRatio: 'xMinYMin slice',
    });

    // Fixed background layer: lane separators (not translated).
    const bg = svgEl('g', { class: 'tl-bg' });
    for (let i = 0; i < lanes.length; i += 1) {
      const y = AXIS_H + i * LANE_H;
      bg.appendChild(svgEl('line', { class: 'tl-lane-sep', x1: 0, y1: y, x2: plotWidth(), y2: y }));
    }
    bg.appendChild(svgEl('line', { class: 'tl-axis-base', x1: 0, y1: AXIS_H, x2: plotWidth(), y2: AXIS_H }));
    root2.appendChild(bg);

    // Horizontally-translated scroll layer holding all time-based geometry.
    const scroll = svgEl('g', { class: 'tl-scroll', transform: `translate(${state.panX} 0)` });

    // Era bands (behind everything).
    const bands = eraBands(spans, scale);
    const bandLayer = svgEl('g', { class: 'tl-bands' });
    bands.forEach((b, i) => {
      const rect = svgEl('rect', {
        class: `tl-band ${i % 2 === 0 ? 'is-even' : 'is-odd'}`,
        x: b.x1,
        y: AXIS_H,
        width: Math.max(0, b.x2 - b.x1),
        height: lanes.length * LANE_H,
      });
      bandLayer.appendChild(rect);
      // Era label at the top of each band.
      const label = svgEl('text', { class: 'tl-band-label', x: b.x1 + 6, y: AXIS_H + 14 });
      label.textContent = ERA_META[b.era].label;
      bandLayer.appendChild(label);
    });
    scroll.appendChild(bandLayer);

    // Axis ticks (year gridlines + labels).
    const tickLayer = svgEl('g', { class: 'tl-ticks' });
    for (const t of axisTicks(scale)) {
      tickLayer.appendChild(svgEl('line', { class: 'tl-tick', x1: t.x, y1: AXIS_H, x2: t.x, y2: totalH }));
      const txt = svgEl('text', { class: 'tl-tick-label', x: t.x + 3, y: AXIS_H - 6 });
      txt.textContent = t.label;
      tickLayer.appendChild(txt);
    }
    scroll.appendChild(tickLayer);

    // Period bars, per lane.
    const periodLayer = svgEl('g', { class: 'tl-periods' });
    for (const p of periods) {
      if (!state.filter.lanes.has(p.lane)) continue;
      const laneIdx = lanes.indexOf(p.lane);
      if (laneIdx < 0) continue;
      const x1 = scale.toX(p.startYear);
      const x2 = scale.toX(p.endYear);
      const cy = AXIS_H + laneIdx * LANE_H + LANE_H / 2;
      const g = svgEl('g', {
        class: `tl-period${p.id === state.selectedPeriodId ? ' is-selected' : ''}`,
        role: 'button',
        tabindex: '0',
        'aria-label': `Period ${p.label}, ${formatYear({ year: p.startYear })} to ${formatYear({ year: p.endYear })}`,
      });
      g.appendChild(svgEl('rect', { class: 'tl-period-bar', x: x1, y: cy + 12, width: Math.max(3, x2 - x1), height: 9, rx: 4 }));
      const title = svgEl('title');
      title.textContent = p.label;
      g.appendChild(title);
      g.addEventListener('click', (e) => { e.stopPropagation(); openPeriodPanel(p); });
      g.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPeriodPanel(p); }
      });
      periodLayer.appendChild(g);
    }
    scroll.appendChild(periodLayer);

    // Event markers + overlap-avoided labels, per lane.
    const markerLayer = svgEl('g', { class: 'tl-markers' });
    for (let li = 0; li < lanes.length; li += 1) {
      const lane = lanes[li]!;
      const laneEvents = shown.filter((e) => e.lane === lane).sort(byYear);
      const cy = AXIS_H + li * LANE_H + LANE_H / 2;
      // Label boxes for overlap avoidance (approx width by character count).
      const labelBoxes = laneEvents.map((e) => ({ id: e.id, x: scale.toX(e.date.year), w: Math.min(150, e.title.length * 6.2 + 14) }));
      const rows = assignRows(labelBoxes, 6);

      for (const ev of laneEvents) {
        const cx = scale.toX(ev.date.year);
        const r = markerRadius(ev.importance);
        const g = svgEl('g', {
          class: `tl-marker tl-kind-${ev.kind}${ev.id === state.selectedEventId ? ' is-selected' : ''}${ev.apSpecific ? ' is-ap' : ''} is-imp${ev.importance}`,
          role: 'button',
          tabindex: '0',
          'aria-label': `${ev.title}, ${formatYear(ev.date)}${ev.apSpecific ? ', AP-specific' : ''}`,
          'data-event-id': ev.id,
        });
        g.appendChild(markerShape(KIND_META[ev.kind].shape, cx, cy - 6, r));
        const title = svgEl('title');
        title.textContent = `${ev.title} — ${formatYear(ev.date)}`;
        g.appendChild(title);

        // Label only for the first two overlap rows (rest keep marker + tooltip).
        const row = rows.get(ev.id) ?? 0;
        if (row < 2) {
          const ly = cy - 6 - r - 3 - row * 12;
          const label = svgEl('text', { class: 'tl-marker-label', x: cx, y: ly, 'text-anchor': 'middle' });
          label.textContent = ev.title.length > 22 ? `${ev.title.slice(0, 21)}…` : ev.title;
          g.appendChild(label);
        }

        g.addEventListener('click', (e) => { e.stopPropagation(); if (!panMoved) openEventPanel(ev); });
        g.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEventPanel(ev); }
        });
        markerLayer.appendChild(g);
      }
    }
    scroll.appendChild(markerLayer);
    root2.appendChild(scroll);

    // Background click closes any open panel.
    root2.addEventListener('click', () => { if (!panMoved && (state.selectedEventId || state.selectedPeriodId)) closePanel(); });

    return root2;
  };

  /* ---- pointer pan / wheel zoom ----------------------------------------- */
  let panMoved = false;
  const bindPointer = (target: SVGSVGElement): void => {
    let panning = false;
    let startX = 0;
    let base = 0;
    const pointers = new Map<number, number>();
    let pinchDist = 0;

    target.addEventListener('pointerdown', (e) => {
      pointers.set(e.pointerId, e.clientX);
      if (pointers.size === 1) {
        panning = true;
        panMoved = false;
        startX = e.clientX;
        base = state.panX;
        target.setPointerCapture(e.pointerId);
      } else if (pointers.size === 2) {
        panning = false;
        pinchDist = pinchSpread(pointers);
      }
    });
    target.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, e.clientX);
      if (pointers.size >= 2) {
        const dist = pinchSpread(pointers);
        if (pinchDist > 0) {
          const rect = target.getBoundingClientRect();
          const mid = pinchMid(pointers) - rect.left;
          zoomAbout(dist / pinchDist, mid);
        }
        pinchDist = dist;
        return;
      }
      if (!panning) return;
      const dx = e.clientX - startX;
      if (Math.abs(dx) > 4) panMoved = true;
      state.panX = clampPan(base + dx);
      applyPan();
    });
    const end = (e: PointerEvent): void => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinchDist = 0;
      if (pointers.size === 0) panning = false;
    };
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);
    target.addEventListener('wheel', (e) => {
      if (!e.ctrlKey && !e.metaKey) return; // ctrl/⌘-wheel (and trackpad pinch) only
      e.preventDefault();
      const rect = target.getBoundingClientRect();
      zoomAbout(e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, e.clientX - rect.left);
    }, { passive: false });
    // Arrow-key panning when the plot has focus.
    target.addEventListener('keydown', (e) => {
      const step = plotWidth() * 0.15;
      if (e.key === 'ArrowRight') { e.preventDefault(); panBy(-step); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); panBy(step); }
    });
  };

  /* ---- minimap ---------------------------------------------------------- */
  let minimapViewport: HTMLElement | null = null;
  const buildMinimap = (): void => {
    const scale = buildTimeScale(spans, 1000, state.scaleMode); // normalized minimap scale
    const shown = visibleEvents();
    const strip = el('div', { class: 'tl-minimap-strip', attrs: { role: 'img', 'aria-label': 'Timeline overview' } });
    const svgm = svgEl('svg', { class: 'tl-minimap-svg', width: '100%', height: MINIMAP_H - 8, viewBox: `0 0 1000 ${MINIMAP_H - 8}`, preserveAspectRatio: 'none' });
    // Era bands.
    eraBands(spans, scale).forEach((b, i) => {
      svgm.appendChild(svgEl('rect', { class: `tl-mini-band ${i % 2 === 0 ? 'is-even' : 'is-odd'}`, x: b.x1, y: 0, width: Math.max(0, b.x2 - b.x1), height: MINIMAP_H - 8 }));
    });
    // Event ticks.
    for (const ev of shown) {
      svgm.appendChild(svgEl('rect', { class: 'tl-mini-tick', x: scale.toX(ev.date.year), y: 4, width: 1.2, height: MINIMAP_H - 16 }));
    }
    strip.appendChild(svgm);
    minimapViewport = el('div', { class: 'tl-minimap-viewport', attrs: { 'aria-hidden': 'true' } });
    strip.appendChild(minimapViewport);
    // Click to pan.
    strip.addEventListener('click', (e) => {
      const rect = strip.getBoundingClientRect();
      const frac = (e.clientX - rect.left) / rect.width;
      const scale2 = buildScale();
      const yearAt = scale.fromX(frac * 1000);
      state.panX = clampPan(plotWidth() / 2 - scale2.toX(yearAt));
      applyPan();
    });
    mount(minimap, strip);
    updateMinimapViewport();
  };

  const updateMinimapViewport = (): void => {
    if (!minimapViewport) return;
    const sw = scaleWidth();
    const pw = plotWidth();
    const leftFrac = sw <= 0 ? 0 : -state.panX / sw;
    const widthFrac = sw <= 0 ? 1 : Math.min(1, pw / sw);
    minimapViewport.style.left = `${(leftFrac * 100).toFixed(2)}%`;
    minimapViewport.style.width = `${(widthFrac * 100).toFixed(2)}%`;
  };

  /* ---- gutter + list view ----------------------------------------------- */
  const buildGutter = (): void => {
    const rows: Child[] = [el('div', { class: 'tl-gutter-axis' })];
    for (const lane of lanes) {
      rows.push(
        el('div', {
          class: `tl-gutter-lane${state.filter.lanes.has(lane) ? '' : ' is-off'}`,
        }, [el('span', { text: LANE_META[lane].label })]),
      );
    }
    mount(gutter, ...rows);
  };

  const buildList = (): void => {
    const shown = visibleEvents();
    const groups = groupEventsByEra(shown);
    const sections: Child[] = [
      el('p', { class: 'tl-list-hint', text: `${shown.length} event${shown.length === 1 ? '' : 's'} in ${groups.length} era${groups.length === 1 ? '' : 's'} — grouped chronologically. Tab through and press Enter to open.` }),
    ];
    for (const g of groups) {
      sections.push(
        el('section', { class: 'tl-list-era' }, [
          el('h3', { class: 'tl-list-era-head' }, [
            el('span', { text: ERA_META[g.era].label }),
            el('span', { class: 'tl-list-era-range', text: ERA_META[g.era].range }),
          ]),
          el('ul', { class: 'tl-list-events', attrs: { role: 'list' } }, g.events.map((e) =>
            el('li', { attrs: { role: 'listitem' } }, [
              el('button', {
                class: `tl-list-event${e.id === state.selectedEventId ? ' is-selected' : ''}`,
                type: 'button',
                onClick: () => openEventPanel(e),
              }, [
                el('span', { class: 'tl-list-event-date tnum', text: formatYear(e.date) }),
                el('span', { class: 'tl-list-event-title', text: e.title }),
                el('span', { class: 'tl-list-event-lane', text: LANE_META[e.lane].short }),
                ...(e.apSpecific ? [chip({ text: 'AP', tone: 'accent' })] : []),
              ]),
            ]),
          )),
        ]),
      );
    }
    mount(listWrap, el('div', { class: 'tl-list', attrs: { role: 'list', 'aria-label': 'Timeline events grouped by era' } }, sections));
  };

  /* ---- redraw ----------------------------------------------------------- */
  const redraw = (): void => {
    buildGutter();
    if (state.viewMode === 'canvas') {
      plot.removeAttribute('hidden');
      minimap.removeAttribute('hidden');
      listWrap.setAttribute('hidden', 'true');
      const newSvg = buildCanvas();
      if (svg) svg.replaceWith(newSvg);
      else plot.appendChild(newSvg);
      svg = newSvg;
      svg.setAttribute('tabindex', '0');
      bindPointer(svg);
      buildMinimap();
    } else {
      plot.setAttribute('hidden', 'true');
      minimap.setAttribute('hidden', 'true');
      listWrap.removeAttribute('hidden');
      buildList();
    }
  };

  /* ---- toolbar + filters ------------------------------------------------ */
  const toolbar = buildToolbar(state, {
    zoomIn: () => zoomButton(1),
    zoomOut: () => zoomButton(-1),
    fit,
    toggleScale: () => { state.scaleMode = state.scaleMode === 'nonlinear' ? 'linear' : 'nonlinear'; state.panX = 0; redraw(); announce(`${state.scaleMode === 'nonlinear' ? 'Emphasis' : 'Linear'} scale`); },
    toggleView: () => { state.viewMode = state.viewMode === 'canvas' ? 'list' : 'canvas'; redraw(); announce(`${state.viewMode === 'canvas' ? 'Canvas' : 'List'} view`); },
    onSearch: (q) => {
      const matches = searchEvents(visibleEvents(), q);
      if (matches.length === 0) { announce(`No events match "${q}".`); return; }
      const first = matches[0]!;
      if (state.viewMode === 'list') { state.viewMode = 'canvas'; }
      redraw();
      panToYear(first.date.year);
      openEventPanel(first);
      announce(`${matches.length} match${matches.length === 1 ? '' : 'es'} for "${q}"; showing ${first.title}.`);
    },
  });

  const eraChips = buildEraChips(spans.map((s) => s.era), (era) => {
    // Ensure the era is visible, switch to canvas, and pan to it.
    if (!state.filter.eras.has(era)) {
      state.filter = { ...state.filter, eras: new Set([...state.filter.eras, era]) };
    }
    state.viewMode = 'canvas';
    redraw();
    const span = spans.find((s) => s.era === era);
    if (span) panToYear(span.startYear);
    announce(`Jumped to ${ERA_META[era].label}.`);
  });

  const filterBar = buildFilterBar(state, {
    onChange: () => { redraw(); const n = visibleEvents().length; announce(`${n} event${n === 1 ? '' : 's'} shown.`); },
  });

  const games = buildGamesBar({
    chronology: () => openChronologyGame(panel, visibleEvents(), announce, () => panel.removeAttribute('hidden')),
    guessYear: () => openGuessYearGame(panel, visibleEvents(), announce),
    whichFirst: () => openWhichFirstGame(panel, visibleEvents(), announce),
  });

  const canvasArea = el('div', { class: 'tl-canvas' }, [gutter, el('div', { class: 'tl-plot-wrap' }, [plot, panel])]);

  const view = el('section', { class: 'timeline-view' }, [
    el('div', { class: 'tl-intro' }, [
      el('h2', { class: 'section-title', text: 'Interactive timeline' }),
      el('p', { class: 'section-lead', text: `${events.length} dated events and ${periods.length} periods across ${lanes.length} lanes — zoom, pan, filter, search, and drill straight into the questions. Toggle the list view for a keyboard-friendly, screen-reader mirror.` }),
    ]),
    toolbar,
    filterBar,
    el('div', { class: 'tl-erachips-row', attrs: { 'aria-label': 'Jump to era' } }, [
      el('span', { class: 'tl-erachips-lead', text: 'Jump to:' }),
      eraChips,
    ]),
    canvasArea,
    minimap,
    listWrap,
    games,
    live,
  ]);
  mount(root, view);

  redraw();
  // Fit once the plot has a measured width (skipped in jsdom where it's 0).
  const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : null;
  if (raf) raf(() => { updateMinimapViewport(); });
}

/* -------------------------------------------------------------------------- */
/* Toolbar / filters / chips builders                                          */
/* -------------------------------------------------------------------------- */

/** Callbacks the toolbar invokes. @internal */
interface ToolbarActions {
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
  toggleScale: () => void;
  toggleView: () => void;
  onSearch: (q: string) => void;
}

/** Build the top control toolbar (zoom, scale mode, view toggle, search). @internal */
function buildToolbar(state: TLState, a: ToolbarActions): HTMLElement {
  const tbtn = (label: string, iconName: IconName, onClick: () => void): HTMLButtonElement =>
    el('button', { class: 'tl-tool', type: 'button', ariaLabel: label, attrs: { title: label }, onClick }, [icon(iconName, 18)]) as HTMLButtonElement;

  const scaleBtn = el('button', {
    class: 'tl-tool tl-tool-text',
    type: 'button',
    attrs: { title: 'Toggle linear / emphasis scale', 'aria-pressed': String(state.scaleMode === 'nonlinear') },
    onClick: () => { a.toggleScale(); scaleBtn.setAttribute('aria-pressed', String(state.scaleMode === 'nonlinear')); scaleBtn.replaceChildren(document.createTextNode(state.scaleMode === 'nonlinear' ? 'Emphasis scale' : 'Linear scale')); },
  }, [document.createTextNode('Emphasis scale')]);

  const viewBtn = el('button', {
    class: 'tl-tool tl-tool-text',
    type: 'button',
    attrs: { title: 'Toggle canvas / list view' },
    onClick: () => { a.toggleView(); viewBtn.replaceChildren(icon(state.viewMode === 'canvas' ? 'syllabus' : 'history', 16), document.createTextNode(state.viewMode === 'canvas' ? 'List view' : 'Canvas view')); },
  }, [icon('syllabus', 16), document.createTextNode('List view')]);

  const searchInput = el('input', {
    class: 'tl-search-input',
    type: 'search',
    attrs: { placeholder: 'Search events…', 'aria-label': 'Search timeline events' },
  }) as HTMLInputElement;
  const searchForm = el('form', { class: 'tl-search', attrs: { role: 'search' } }, [
    icon('search', 16),
    searchInput,
  ]);
  searchForm.addEventListener('submit', (e) => { e.preventDefault(); a.onSearch(searchInput.value); });

  return el('div', { class: 'tl-toolbar', attrs: { role: 'toolbar', 'aria-label': 'Timeline controls' } }, [
    el('div', { class: 'tl-tool-group' }, [
      tbtn('Zoom in', 'target', a.zoomIn),
      tbtn('Zoom out', 'circle', a.zoomOut),
      tbtn('Fit to width', 'sparkles', a.fit),
    ]),
    el('div', { class: 'tl-tool-group' }, [scaleBtn, viewBtn]),
    searchForm,
  ]);
}

/** Build the "jump to era" chip row. @internal */
function buildEraChips(eras: readonly EraId[], onJump: (era: EraId) => void): HTMLElement {
  const seen = new Set<EraId>();
  const ordered = ERA_IDS.filter((e) => eras.includes(e) && !seen.has(e) && (seen.add(e), true));
  return el('div', { class: 'tl-erachips' }, ordered.map((era) =>
    el('button', { class: 'tl-erachip', type: 'button', onClick: () => onJump(era) }, [el('span', { text: ERA_META[era].label })]),
  ));
}

/** Callbacks the filter bar invokes on any change. @internal */
interface FilterActions {
  onChange: () => void;
}

/** Build the filter controls (lanes, eras, kinds, subject, AP-only, importance). @internal */
function buildFilterBar(state: TLState, a: FilterActions): HTMLElement {
  // A reusable toggle chip backed by a Set in the filter.
  const toggleChip = <T,>(label: string, value: T, getSet: () => ReadonlySet<T>, setSet: (s: Set<T>) => void): HTMLButtonElement => {
    const btn = el('button', { class: 'tl-fchip', type: 'button', attrs: { 'aria-pressed': String(getSet().has(value)) } }, [el('span', { text: label })]) as HTMLButtonElement;
    const paint = (): void => { btn.setAttribute('aria-pressed', String(getSet().has(value))); btn.classList.toggle('is-on', getSet().has(value)); };
    paint();
    btn.addEventListener('click', () => {
      const next = new Set(getSet());
      if (next.has(value)) next.delete(value);
      else next.add(value);
      setSet(next);
      paint();
      a.onChange();
    });
    return btn;
  };

  const laneChips = LANE_IDS.map((lane) =>
    toggleChip(LANE_META[lane].short, lane, () => state.filter.lanes, (s) => { state.filter = { ...state.filter, lanes: s }; }),
  );
  const kindChips = (Object.keys(KIND_META) as Kind[]).map((k) =>
    toggleChip(KIND_META[k].label, k, () => state.filter.kinds, (s) => { state.filter = { ...state.filter, kinds: s }; }),
  );

  // Subject select.
  const subjectSel = el('select', { class: 'tl-select', attrs: { 'aria-label': 'Filter by subject' } }, [
    el('option', { value: 'all', text: 'All subjects' }),
    ...SUBJECT_CODES.map((code) => el('option', { value: code, text: SUBJECTS[code] })),
  ]) as HTMLSelectElement;
  subjectSel.value = 'all';
  subjectSel.addEventListener('change', () => { state.filter = { ...state.filter, subject: (subjectSel.value === 'all' ? 'all' : subjectSel.value) as SubjectCode | 'all' }; a.onChange(); });

  // Importance select.
  const impSel = el('select', { class: 'tl-select', attrs: { 'aria-label': 'Minimum importance' } }, [
    el('option', { value: '1', text: 'All importance' }),
    el('option', { value: '2', text: 'Notable +' }),
    el('option', { value: '3', text: 'Must-know only' }),
  ]) as HTMLSelectElement;
  impSel.value = '1';
  impSel.addEventListener('change', () => { state.filter = { ...state.filter, minImportance: Number(impSel.value) as 1 | 2 | 3 }; a.onChange(); });

  // AP-only toggle.
  const apToggle = el('button', { class: 'tl-fchip tl-ap-toggle', type: 'button', attrs: { 'aria-pressed': 'false' } }, [icon('target', 14), el('span', { text: 'AP-only' })]) as HTMLButtonElement;
  apToggle.addEventListener('click', () => {
    state.filter = { ...state.filter, apOnly: !state.filter.apOnly };
    apToggle.setAttribute('aria-pressed', String(state.filter.apOnly));
    apToggle.classList.toggle('is-on', state.filter.apOnly);
    a.onChange();
  });

  const group = (label: string, items: Child[], cls = ''): HTMLElement =>
    el('div', { class: `tl-fgroup ${cls}` }, [el('span', { class: 'tl-fgroup-label', text: label }), el('div', { class: 'tl-fgroup-chips' }, items)]);

  return el('div', { class: 'tl-filters', attrs: { 'aria-label': 'Filters' } }, [
    group('Lanes', laneChips),
    group('Kinds', kindChips, 'tl-fgroup-kinds'),
    el('div', { class: 'tl-fgroup tl-fgroup-selects' }, [
      apToggle,
      subjectSel,
      impSel,
    ]),
  ]);
}

/** Build the learning-modes launcher bar. @internal */
function buildGamesBar(actions: { chronology: () => void; guessYear: () => void; whichFirst: () => void }): HTMLElement {
  return el('div', { class: 'tl-games' }, [
    el('h3', { class: 'tl-games-title', text: 'Learning modes' }),
    el('p', { class: 'tl-games-lead', text: 'Practice with the events currently shown by your filters.' }),
    el('div', { class: 'tl-games-btns' }, [
      button({ label: 'Chronology challenge', variant: 'secondary', iconName: 'history', onClick: actions.chronology }),
      button({ label: 'Guess the year', variant: 'secondary', iconName: 'target', onClick: actions.guessYear }),
      button({ label: 'Which came first?', variant: 'secondary', iconName: 'sparkles', onClick: actions.whichFirst }),
    ]),
  ]);
}

/* -------------------------------------------------------------------------- */
/* Learning-mode panels                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Chronology challenge: pick 4–5 events from the current filter and let the
 * learner reorder them (keyboard Up/Down + native drag), then reveal the correct
 * order with dates.
 *
 * ASSUMPTION: there is no timeline-specific progress store, and mapping a
 * chronology result onto per-MCQ progress would be misleading, so the result is
 * shown but NOT persisted. If a dedicated timeline-progress API is added later,
 * `scoreChronology` already returns the numbers to record. @internal
 */
function openChronologyGame(panel: HTMLElement, pool: readonly TimelineEvent[], announce: (m: string) => void, show: () => void): void {
  const n = Math.min(5, Math.max(4, Math.min(5, pool.length)));
  if (pool.length < 3) { announce('Need at least 3 events in view for a chronology challenge.'); return; }
  const picked = pickChronology(pool, n, mulberry32(Date.now() >>> 0));
  let order = [...picked];

  // Swap the item at `i` with its neighbour `i + dir`, then re-render. @internal
  const move = (i: number, dir: -1 | 1): void => {
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    const tmp = next[i]!;
    next[i] = next[j]!;
    next[j] = tmp;
    order = next;
    render();
  };

  const render = (): void => {
    const items = order.map((ev, i) =>
      el('li', { class: 'tl-chrono-item', attrs: { 'data-id': ev.id } }, [
        el('span', { class: 'tl-chrono-rank tnum', text: String(i + 1) }),
        el('span', { class: 'tl-chrono-title', text: ev.title }),
        el('span', { class: 'tl-chrono-moves' }, [
          el('button', { class: 'icon-btn', type: 'button', ariaLabel: `Move ${ev.title} up`, onClick: () => move(i, -1) }, [el('span', { text: '↑' })]),
          el('button', { class: 'icon-btn', type: 'button', ariaLabel: `Move ${ev.title} down`, onClick: () => move(i, 1) }, [el('span', { text: '↓' })]),
        ]),
      ]),
    );
    const list = el('ol', { class: 'tl-chrono-list' }, items);
    mount(panel,
      gamePanelHead('Chronology challenge', () => { panel.setAttribute('hidden', 'true'); panel.replaceChildren(); }),
      el('p', { class: 'tl-panel-summary', text: 'Order these from earliest to latest, then check.' }),
      list,
      el('div', { class: 'tl-panel-actions' }, [
        button({ label: 'Check order', variant: 'primary', iconName: 'check', onClick: reveal }),
      ]),
    );
    panel.removeAttribute('hidden');
    show();
  };

  const reveal = (): void => {
    const score = scoreChronology(order.map((e) => e.id), picked);
    mount(panel,
      gamePanelHead('Chronology result', () => { panel.setAttribute('hidden', 'true'); panel.replaceChildren(); }),
      el('p', { class: 'tl-chrono-score', text: score.perfect ? `Perfect — all ${score.total} in order!` : `${score.correctPositions} of ${score.total} in the right place.` }),
      el('p', { class: 'tl-panel-label', text: 'Correct order' }),
      el('ol', { class: 'tl-chrono-correct' }, score.correctOrder.map((ev) =>
        el('li', {}, [
          el('span', { class: 'tl-chrono-date tnum', text: formatYear(ev.date) }),
          el('span', { class: 'tl-chrono-title', text: ev.title }),
        ]),
      )),
      el('div', { class: 'tl-panel-actions' }, [
        button({ label: 'Play again', variant: 'secondary', iconName: 'revise', onClick: () => openChronologyGame(panel, pool, announce, show) }),
      ]),
    );
    announce(score.perfect ? 'Perfect chronological order!' : `${score.correctPositions} of ${score.total} correct.`);
  };

  render();
}

/** "Guess the year" flash mode: show a title, take a year guess, reveal distance. @internal */
function openGuessYearGame(panel: HTMLElement, pool: readonly TimelineEvent[], announce: (m: string) => void): void {
  if (pool.length === 0) { announce('No events in view to guess.'); return; }
  const ev = pickChronology(pool, 1, mulberry32(Date.now() >>> 0))[0]!;
  const input = el('input', { class: 'tl-guess-input', type: 'number', attrs: { 'aria-label': 'Your year guess (negative for BCE)', placeholder: 'e.g. 1565 or -321' } }) as HTMLInputElement;
  const result = el('p', { class: 'tl-guess-result', attrs: { role: 'status', 'aria-live': 'polite' } });

  const check = (): void => {
    const guess = Number(input.value);
    if (!Number.isFinite(guess) || guess === 0) { result.textContent = 'Enter a non-zero year (negative = BCE).'; return; }
    const dist = yearDistance(guess, ev.date.year);
    const verdict = dist === 0 ? 'Spot on!' : dist <= 25 ? 'Very close!' : dist <= 100 ? 'In the ballpark.' : 'Way off — study this one.';
    result.textContent = `${verdict} Actual: ${formatYear(ev.date)} (off by ${dist} year${dist === 1 ? '' : 's'}).`;
    announce(result.textContent);
  };

  mount(panel,
    gamePanelHead('Guess the year', () => { panel.setAttribute('hidden', 'true'); panel.replaceChildren(); }),
    el('p', { class: 'tl-panel-summary', text: ev.title }),
    input,
    el('div', { class: 'tl-panel-actions' }, [
      button({ label: 'Reveal', variant: 'primary', iconName: 'check', onClick: check }),
      button({ label: 'Next', variant: 'secondary', iconName: 'arrow-right', onClick: () => openGuessYearGame(panel, pool, announce) }),
    ]),
    result,
  );
  panel.removeAttribute('hidden');
}

/** "Which came first?" quick quiz: two events, pick the earlier. @internal */
function openWhichFirstGame(panel: HTMLElement, pool: readonly TimelineEvent[], announce: (m: string) => void): void {
  const pair = pickPair(pool, mulberry32(Date.now() >>> 0));
  if (!pair) { announce('Need two events with different years in view.'); return; }
  const [a, b] = pair;
  const result = el('p', { class: 'tl-guess-result', attrs: { role: 'status', 'aria-live': 'polite' } });
  const pick = (chosen: TimelineEvent, other: TimelineEvent): void => {
    const correct = whichCameFirst(chosen, other) === -1;
    result.textContent = correct
      ? `Correct — ${chosen.title} (${formatYear(chosen.date)}) came first.`
      : `Not quite — ${other.title} (${formatYear(other.date)}) came first.`;
    announce(result.textContent);
  };
  mount(panel,
    gamePanelHead('Which came first?', () => { panel.setAttribute('hidden', 'true'); panel.replaceChildren(); }),
    el('p', { class: 'tl-panel-summary', text: 'Tap the event you think happened earlier.' }),
    el('div', { class: 'tl-which-opts' }, [
      el('button', { class: 'tl-which-opt', type: 'button', onClick: () => pick(a, b) }, [el('span', { text: a.title })]),
      el('button', { class: 'tl-which-opt', type: 'button', onClick: () => pick(b, a) }, [el('span', { text: b.title })]),
    ]),
    el('div', { class: 'tl-panel-actions' }, [
      button({ label: 'Next pair', variant: 'secondary', iconName: 'arrow-right', onClick: () => openWhichFirstGame(panel, pool, announce) }),
    ]),
    result,
  );
  panel.removeAttribute('hidden');
}

/** Shared game/panel header with a close button. @internal */
function gamePanelHead(title: string, onClose: () => void): HTMLElement {
  return el('div', { class: 'tl-panel-head' }, [
    el('span', { class: 'tl-panel-kind', text: title }),
    el('button', { class: 'icon-btn', type: 'button', ariaLabel: 'Close', onClick: onClose }, [icon('x', 18)]),
  ]);
}

/* -------------------------------------------------------------------------- */
/* Mobile timeline (vertical)                                                  */
/* -------------------------------------------------------------------------- */

/** Render the mobile (<600px) vertical, era-grouped timeline. @internal */
function renderMobile(root: HTMLElement, events: readonly TimelineEvent[]): void {
  const activeLanes = new Set<Lane>(LANE_IDS);
  const sheet = el('div', { class: 'tl-sheet', attrs: { hidden: 'true', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Event details' } });
  const live = el('div', { class: 'tl-live', attrs: { role: 'status', 'aria-live': 'polite' } });
  const listHost = el('div', { class: 'tl-mobile-list' });

  const openSheet = (ev: TimelineEvent): void => {
    const links = ev.subtopicIds.map((sid) => ({ sid, sub: getSubtopic(sid) })).filter((x) => x.sub);
    mount(sheet,
      el('div', { class: 'tl-panel-head' }, [
        el('span', { class: 'tl-panel-kind', text: KIND_META[ev.kind].label }),
        el('button', { class: 'icon-btn', type: 'button', ariaLabel: 'Close details', onClick: () => sheet.setAttribute('hidden', 'true') }, [icon('x', 18)]),
      ]),
      el('h3', { class: 'tl-panel-title', text: ev.title }),
      el('div', { class: 'tl-panel-meta' }, [
        chip({ text: formatYear(ev.date), tone: 'muted', iconName: 'history' }),
        ...(ev.apSpecific ? [chip({ text: 'AP-specific', tone: 'accent', iconName: 'target' })] : []),
      ]),
      el('p', { class: 'tl-panel-summary', text: ev.summary }),
      el('div', { class: 'tl-panel-detail md' }, renderMarkdown(ev.detail)),
      ...links.map(({ sid, sub }) => button({ label: `Open ${sub!.meta.name}`, variant: 'secondary', iconName: 'notes', onClick: () => openLearn(sid) })),
      button({
        label: 'Drill related MCQs',
        variant: 'primary',
        iconName: 'drill',
        onClick: () => {
          const ids = [...ev.relatedMcqIds];
          if (ids.length === 0) for (const sid of ev.subtopicIds) { const s = getSubtopic(sid); if (s) ids.push(...s.mcqs.map((m) => m.id)); }
          const items = buildSession({ restrictToIds: ids, order: 'ladder' }).items;
          if (items.length === 0) { live.textContent = 'No linked questions yet.'; return; }
          mountQuiz(root, items, () => render(root), { allowEndSession: true });
        },
      }),
    );
    sheet.removeAttribute('hidden');
  };

  const buildList = (): void => {
    const shown = events.filter((e) => activeLanes.has(e.lane));
    const groups = groupEventsByEra(shown);
    const sections: Child[] = [];
    for (const g of groups) {
      sections.push(
        el('section', { class: 'tl-m-era' }, [
          el('h3', { class: 'tl-m-era-head' }, [el('span', { text: ERA_META[g.era].label }), el('span', { class: 'tl-list-era-range', text: ERA_META[g.era].range })]),
          el('ul', { class: 'tl-m-events', attrs: { role: 'list' } }, g.events.map((e) =>
            el('li', {}, [
              el('button', { class: 'tl-m-event', type: 'button', onClick: () => openSheet(e) }, [
                el('span', { class: 'tl-m-date tnum', text: formatYear(e.date) }),
                el('span', { class: 'tl-m-title', text: e.title }),
                el('span', { class: 'tl-m-lane', text: LANE_META[e.lane].short }),
                ...(e.apSpecific ? [chip({ text: 'AP', tone: 'accent' })] : []),
              ]),
            ]),
          )),
        ]),
      );
    }
    mount(listHost, el('div', { class: 'tl-m-list' }, sections));
  };

  const laneChips = el('div', { class: 'tl-m-lanechips', attrs: { 'aria-label': 'Lane filters' } }, LANE_IDS.map((lane) => {
    const btn = el('button', { class: 'tl-fchip is-on', type: 'button', attrs: { 'aria-pressed': 'true' } }, [el('span', { text: LANE_META[lane].short })]) as HTMLButtonElement;
    btn.addEventListener('click', () => {
      if (activeLanes.has(lane)) activeLanes.delete(lane); else activeLanes.add(lane);
      btn.setAttribute('aria-pressed', String(activeLanes.has(lane)));
      btn.classList.toggle('is-on', activeLanes.has(lane));
      buildList();
      live.textContent = `${events.filter((e) => activeLanes.has(e.lane)).length} events shown.`;
    });
    return btn;
  }));

  mount(root, el('section', { class: 'timeline-view is-mobile' }, [
    el('div', { class: 'tl-intro' }, [
      el('h2', { class: 'section-title', text: 'Timeline' }),
      el('p', { class: 'section-lead', text: `${events.length} events, newest era last. Filter lanes, tap an event for details.` }),
    ]),
    laneChips,
    listHost,
    sheet,
    live,
  ]));
  buildList();
}

/* -------------------------------------------------------------------------- */
/* Small pointer helpers                                                       */
/* -------------------------------------------------------------------------- */

/** Distance between the first two active pointers (for pinch). @internal */
function pinchSpread(pointers: ReadonlyMap<number, number>): number {
  const xs = [...pointers.values()];
  return xs.length < 2 ? 0 : Math.abs(xs[0]! - xs[1]!);
}

/** Midpoint x of the first two active pointers. @internal */
function pinchMid(pointers: ReadonlyMap<number, number>): number {
  const xs = [...pointers.values()];
  return xs.length < 2 ? (xs[0] ?? 0) : (xs[0]! + xs[1]!) / 2;
}
