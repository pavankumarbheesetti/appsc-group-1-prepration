/**
 * Hash-based client router — offline / `file://` safe.
 *
 * Uses `location.hash` (never the History API) so navigation works when the
 * single-file build is double-clicked from disk, where pushState-based routing
 * and server rewrites are unavailable. Each route renders into a single mount
 * element supplied to {@link start}. Unknown routes fall back to Home (`#/`).
 */

/** A view renderer: given the mount element, (re)build its contents. */
export type RenderFn = (root: HTMLElement) => void;

/** The Home/default route hash. Unknown routes resolve here. */
export const DEFAULT_ROUTE = '#/';

/** Registered routes, keyed by normalized hash (e.g. `#/drill`). */
const routes = new Map<string, RenderFn>();

/** The element every route renders into; set by {@link start}. */
let rootEl: HTMLElement | null = null;

/** The currently-resolved route key. */
let currentRoute = DEFAULT_ROUTE;

/** The hash we last rendered, used to dedupe the browser's post-navigate echo. */
let lastRenderedHash = '';

/** Whether the hashchange listener has been attached. */
let started = false;

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

/** Register (or replace) the renderer for `path`. */
export function registerRoute(path: string, render: RenderFn): void {
  routes.set(normalize(path), render);
}

/** The resolved route key currently displayed. */
export function getCurrentRoute(): string {
  return currentRoute;
}

/** Resolve the live hash to a registered key, falling back to Home. @internal */
function resolveKey(): string {
  const hash = location.hash || DEFAULT_ROUTE;
  if (routes.has(hash)) return hash;
  // Fall back to a PARAMETERIZED match: a registered pattern like `#/learn/:id`
  // matches `#/learn/anything`. Static segments must be equal; a `:param`
  // segment matches any single non-empty segment. First match wins.
  const segs = hash.slice(1).split('/');
  for (const key of routes.keys()) {
    if (!key.includes('/:')) continue; // only patterns can match dynamically
    const kSegs = key.slice(1).split('/');
    if (kSegs.length !== segs.length) continue;
    let ok = true;
    for (let i = 0; i < kSegs.length; i += 1) {
      const k = kSegs[i];
      const s = segs[i];
      if (k === undefined || s === undefined) {
        ok = false;
        break;
      }
      if (k.startsWith(':')) {
        if (s === '') {
          ok = false;
          break;
        }
        continue;
      }
      if (k !== s) {
        ok = false;
        break;
      }
    }
    if (ok) return key;
  }
  return DEFAULT_ROUTE;
}

/**
 * Read the value of a dynamic segment from the CURRENT hash, given the pattern
 * that matched it (e.g. `routeParam('/learn/:id', 'id')` → the id segment).
 * Returns `undefined` when the pattern has no such param or the hash is shorter.
 */
export function routeParam(pattern: string, name: string): string | undefined {
  const kSegs = normalize(pattern).slice(1).split('/');
  const segs = (location.hash || DEFAULT_ROUTE).slice(1).split('/');
  const idx = kSegs.indexOf(`:${name}`);
  if (idx === -1) return undefined;
  const value = segs[idx];
  return value === undefined || value === '' ? undefined : decodeURIComponent(value);
}

/** Render the current route into the mount element. @internal */
function renderCurrent(): void {
  if (!rootEl) return;
  const key = resolveKey();
  currentRoute = key;
  lastRenderedHash = location.hash || DEFAULT_ROUTE;
  const render = routes.get(key);
  if (render) render(rootEl);
}

/** hashchange handler; dedupes the echo that our own navigate() causes. @internal */
function onHashChange(): void {
  const hash = location.hash || DEFAULT_ROUTE;
  if (hash === lastRenderedHash) return; // already rendered by navigate()
  renderCurrent();
}

/**
 * Navigate to `path`. When the target differs from the current hash we set
 * `location.hash` (browsers fire `hashchange`, which we dedupe) and render
 * immediately so behaviour is deterministic in jsdom too. Navigating to the
 * current route forces a refresh.
 */
export function navigate(path: string): void {
  const target = normalize(path);
  const current = location.hash || DEFAULT_ROUTE;
  if (target === current) {
    renderCurrent(); // same route → explicit refresh
    return;
  }
  location.hash = target;
  renderCurrent();
}

/**
 * Start the router: remember the mount element, attach the hashchange
 * listener once, and render the current route.
 */
export function start(root: HTMLElement): void {
  rootEl = root;
  if (!started) {
    window.addEventListener('hashchange', onHashChange);
    started = true;
  }
  renderCurrent();
}
