/**
 * Hash-based client router — offline / `file://` safe.
 *
 * Uses `location.hash` so navigation works when the single-file build is
 * double-clicked from disk, where server rewrites are unavailable. Each route
 * renders into a single mount element supplied to {@link start}.
 *
 * Navigation behaviour (NAV spec §3.4):
 * - A hash may carry a query (`#/topics?s=HIST`); routes match on the PATH only
 *   and views read the query with {@link routeQuery}.
 * - Old paths are kept working as REDIRECTS ({@link registerRedirect}); the
 *   address bar is corrected in place (no extra history entry).
 * - Unknown routes resolve to Today and the hash is corrected to `#/`.
 * - A NEW navigation resets the scroll to the top and moves focus to the page
 *   h1; Back/Forward restores the scroll position saved for that history entry.
 * - `document.title` is set per page (`<Page> · APPSC Focus`).
 */

/** A view renderer: given the mount element, (re)build its contents. */
export type RenderFn = (root: HTMLElement) => void;

/** The Home/default route hash. Unknown routes resolve here. */
export const DEFAULT_ROUTE = '#/';

/** The suffix every document title carries. */
export const TITLE_SUFFIX = 'APPSC Focus';

/** Registered routes, keyed by normalized path hash (e.g. `#/drill`). */
const routes = new Map<string, RenderFn>();

/** Redirects: old path pattern → function building the new path (query kept). */
const redirects = new Map<string, (params: Record<string, string>) => string>();

/** The element every route renders into; set by {@link start}. */
let rootEl: HTMLElement | null = null;

/** The currently-resolved route key. */
let currentRoute = DEFAULT_ROUTE;

/** The hash we last rendered, used to dedupe the browser's post-navigate echo. */
let lastRenderedHash = '';

/** Whether the hashchange listener has been attached. */
let started = false;

/** Position of the current entry in this tab's history (stored in history.state). */
let currentPos = 0;

/** Saved scrollY per history position (Back/Forward restores it). */
const scrollByPos = new Map<number, number>();

/** Whether the current render set its own document title. */
let titleSetThisRender = false;

/** Per-navigation options. */
export interface NavigateOpts {
  /** Keep the scroll position (e.g. switching a Learn tab). Default false. */
  keepScroll?: boolean;
  /** Leave focus where it is (e.g. a tab button). Default false. */
  keepFocus?: boolean;
  /** Replace the current history entry instead of pushing a new one. */
  replace?: boolean;
}

/** Options of the render in flight (consumed by {@link renderCurrent}). */
let pendingOpts: NavigateOpts = {};

/**
 * Normalize any path form to a canonical hash: `/`, `drill`, `#/drill`,
 * `#drill` all map to `#/…`. Empty → {@link DEFAULT_ROUTE}.
 */
export function normalize(path: string): string {
  let p = path.trim();
  if (p.startsWith('#')) p = p.slice(1);
  if (!p.startsWith('/')) p = '/' + p;
  return '#' + p;
}

/** Split a hash into its path (`#/a/b`) and raw query (`x=1`). @internal */
function splitHash(hash: string): { path: string; query: string } {
  const i = hash.indexOf('?');
  return i === -1 ? { path: hash, query: '' } : { path: hash.slice(0, i), query: hash.slice(i + 1) };
}

/** The live hash (or the default). @internal */
function liveHash(): string {
  return location.hash || DEFAULT_ROUTE;
}

/** Register (or replace) the renderer for `path`. */
export function registerRoute(path: string, render: RenderFn): void {
  routes.set(normalize(path), render);
}

/**
 * Keep an OLD path working: `from` (may contain `:params`) resolves to `to`
 * (a path, or a function of the matched params). Any query is carried over.
 */
export function registerRedirect(from: string, to: string | ((params: Record<string, string>) => string)): void {
  redirects.set(normalize(from), typeof to === 'string' ? () => to : to);
}

/** The resolved route key currently displayed. */
export function getCurrentRoute(): string {
  return currentRoute;
}

/** Match `path` against a pattern key; returns the params or null. @internal */
function matchPattern(key: string, path: string): Record<string, string> | null {
  if (key === path) return {};
  if (!key.includes('/:')) return null;
  const kSegs = key.slice(1).split('/');
  const segs = path.slice(1).split('/');
  if (kSegs.length !== segs.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < kSegs.length; i += 1) {
    const k = kSegs[i]!;
    const s = segs[i]!;
    if (k.startsWith(':')) {
      if (s === '') return null;
      params[k.slice(1)] = decodeURIComponent(s);
      continue;
    }
    if (k !== s) return null;
  }
  return params;
}

/** Find the registered key matching `path` (exact first, then patterns). @internal */
function matchRoute(path: string): string | null {
  if (routes.has(path)) return path;
  for (const key of routes.keys()) if (matchPattern(key, path)) return key;
  return null;
}

/**
 * Apply redirects (repeatedly, max 5 hops) and the unknown-route fallback to a
 * full hash. Returns the canonical hash to show. @internal
 */
export function canonicalHash(hash: string): string {
  // No routes registered (a view rendered on its own, e.g. in a unit test):
  // nothing to resolve against — keep the hash as given.
  if (routes.size === 0) return hash;
  let current = hash;
  for (let hop = 0; hop < 5; hop += 1) {
    const { path, query } = splitHash(current);
    if (matchRoute(path)) return current;
    let next: string | null = null;
    for (const [key, to] of redirects) {
      const params = matchPattern(key, path);
      if (params) {
        next = normalize(to(params));
        break;
      }
    }
    if (next === null) return DEFAULT_ROUTE; // unknown → Today
    current = query && !next.includes('?') ? `${next}?${query}` : next;
  }
  return current;
}

/**
 * Read the value of a dynamic segment from the CURRENT hash, given the pattern
 * that matched it (e.g. `routeParam('/learn/:id', 'id')` → the id segment).
 * Returns `undefined` when the pattern has no such param or the hash is shorter.
 */
export function routeParam(pattern: string, name: string): string | undefined {
  const kSegs = normalize(pattern).slice(1).split('/');
  const segs = splitHash(liveHash()).path.slice(1).split('/');
  const idx = kSegs.indexOf(`:${name}`);
  if (idx === -1) return undefined;
  const value = segs[idx];
  return value === undefined || value === '' ? undefined : decodeURIComponent(value);
}

/** Read a query parameter from the CURRENT hash (`#/topics?s=HIST` → `HIST`). */
export function routeQuery(name: string): string | undefined {
  const { query } = splitHash(liveHash());
  if (!query) return undefined;
  const v = new URLSearchParams(query).get(name);
  return v === null || v === '' ? undefined : v;
}

/**
 * Set the document title for the page being rendered: `parts` joined with
 * ` · ` plus the app suffix (`Stone Age · Topics · APPSC Focus`).
 */
export function setDocumentTitle(...parts: string[]): void {
  const clean = parts.map((p) => p.trim()).filter((p) => p !== '');
  document.title = [...clean, TITLE_SUFFIX].join(' \u00b7 ');
  titleSetThisRender = true;
}

/** Write `hash` into the address bar without a hashchange render. @internal */
function writeHash(hash: string, replace: boolean): void {
  if (location.hash === hash) return;
  if (replace) {
    try {
      history.replaceState(history.state, '', hash);
      return;
    } catch {
      /* fall through to location.replace */
    }
    location.replace(hash);
    return;
  }
  location.hash = hash;
}

/** Record the current position in history.state (for Back detection). @internal */
function stampPos(pos: number): void {
  try {
    history.replaceState({ ...(history.state as object | null), navPos: pos }, '');
  } catch {
    /* history unavailable — Back detection degrades to "new navigation" */
  }
}

/** Scroll the window to `y` (no-op where scrolling is unsupported). @internal */
function scrollToY(y: number): void {
  try {
    // jsdom lacks a layout engine; guard so tests stay quiet.
    if (navigator.userAgent.includes('jsdom')) return;
    window.scrollTo({ top: y, left: 0, behavior: 'instant' as ScrollBehavior });
  } catch {
    /* ignore */
  }
}

/** Move focus to the page's h1 (tabindex=-1) without scrolling. @internal */
function focusPageHeading(): void {
  const h1 =
    document.querySelector<HTMLElement>('main h1') ?? document.querySelector<HTMLElement>('h1');
  if (!h1) return;
  if (!h1.hasAttribute('tabindex')) h1.setAttribute('tabindex', '-1');
  try {
    h1.focus({ preventScroll: true });
  } catch {
    h1.focus();
  }
}

/** Render the current route into the mount element. @internal */
function renderCurrent(mode: 'new' | 'restore' = 'new'): void {
  if (!rootEl) return;
  const opts = pendingOpts;
  pendingOpts = {};
  // Correct the address bar for redirects / unknown routes (no new entry).
  const live = liveHash();
  const canon = canonicalHash(live);
  if (canon !== live || !location.hash) writeHash(canon, true);
  const hash = canon;
  const { path } = splitHash(hash);
  const key = matchRoute(path) ?? DEFAULT_ROUTE;
  currentRoute = key;
  lastRenderedHash = hash;
  const render = routes.get(key);
  titleSetThisRender = false;
  if (render) render(rootEl);
  if (!titleSetThisRender) {
    const h1 = document.querySelector('main h1') ?? document.querySelector('h1');
    setDocumentTitle(h1?.textContent ?? '');
  }
  if (mode === 'restore') {
    const y = scrollByPos.get(currentPos) ?? 0;
    scrollToY(y);
    // Content (images/fonts) may settle a frame later; re-apply once.
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => scrollToY(y));
  } else if (!opts.keepScroll) {
    scrollToY(0);
  }
  if (!opts.keepFocus) focusPageHeading();
}

/** hashchange handler; dedupes the echo that our own navigate() causes. @internal */
function onHashChange(): void {
  const hash = liveHash();
  if (hash === lastRenderedHash) return; // already rendered by navigate()
  const st = history.state as { navPos?: unknown } | null;
  const pos = st && typeof st.navPos === 'number' ? st.navPos : null;
  if (pos !== null) {
    // Back / Forward to an entry we created: restore its scroll.
    scrollByPos.set(currentPos, window.scrollY);
    currentPos = pos;
    renderCurrent('restore');
    return;
  }
  // A fresh entry (typed URL or an in-page <a href="#/…">): a new navigation.
  scrollByPos.set(currentPos, window.scrollY);
  currentPos += 1;
  stampPos(currentPos);
  renderCurrent('new');
}

/**
 * Navigate to `path`. When the target differs from the current hash we set
 * `location.hash` (browsers fire `hashchange`, which we dedupe) and render
 * immediately so behaviour is deterministic in jsdom too. Navigating to the
 * current route forces a refresh. Redirects are applied BEFORE writing the
 * hash, so an old path never adds a history entry of its own.
 */
export function navigate(path: string, opts: NavigateOpts = {}): void {
  const target = canonicalHash(normalize(path));
  const current = liveHash();
  pendingOpts = opts;
  if (target === current) {
    renderCurrent(); // same route → explicit refresh
    return;
  }
  scrollByPos.set(currentPos, window.scrollY);
  if (opts.replace) {
    writeHash(target, true);
  } else {
    lastRenderedHash = target; // dedupe the async hashchange echo
    location.hash = target;
    currentPos += 1;
    stampPos(currentPos);
  }
  renderCurrent();
}

/**
 * Change the address bar to `path` WITHOUT re-rendering — for a view that has
 * already drawn a new state (e.g. results) and wants it to have its own URL so
 * browser Back returns to the previous state.
 */
export function pushUrl(path: string): void {
  const target = normalize(path);
  if (target === liveHash()) return;
  scrollByPos.set(currentPos, window.scrollY);
  lastRenderedHash = target;
  location.hash = target;
  currentPos += 1;
  stampPos(currentPos);
  currentRoute = matchRoute(splitHash(target).path) ?? currentRoute;
}

/**
 * Start the router: remember the mount element, attach the hashchange
 * listener once, and render the current route.
 */
export function start(root: HTMLElement): void {
  rootEl = root;
  if (!started) {
    window.addEventListener('hashchange', onHashChange);
    try {
      if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    } catch {
      /* ignore */
    }
    started = true;
  }
  const st = history.state as { navPos?: unknown } | null;
  if (st && typeof st.navPos === 'number') currentPos = st.navPos;
  else stampPos(currentPos);
  renderCurrent();
}
