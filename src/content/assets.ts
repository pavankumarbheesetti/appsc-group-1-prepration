/// <reference types="vite/client" />
/**
 * Image asset resolver — maps a content image KEY to an INLINED asset URL.
 *
 * OFFLINE-FIRST (mirrors `loader.ts`): the production build is a single
 * `file://`-openable HTML where `fetch()`/XHR are blocked, so no image may be
 * loaded over the network. We use Vite's `import.meta.glob(..., { eager: true,
 * import: 'default' })` so every matching asset under `src/assets/` (any
 * subject subtree, e.g. `ivc/`, `hist/<slug>/`) is statically discovered at
 * build time and its `default` export (the asset URL) is available
 * synchronously. Because `vite.config.ts` sets a huge `assetsInlineLimit`, each
 * URL is a self-contained `data:` URI baked into the bundle — there are NO
 * external asset references in the single-file build.
 *
 * The KEY is the filename STEM (the basename WITHOUT its extension), regardless
 * of which subdirectory the file lives in, e.g.
 *   `/src/assets/ivc/great-bath.jpg`                              → key `great-bath`
 *   `/src/assets/ivc/ivc-extent-map.svg`                          → key `ivc-extent-map`
 *   `/src/assets/hist/hist-ancient-stone-age/hist-ancient-stone-age-1.jpg`
 *                                                                 → key `hist-ancient-stone-age-1`
 * Content authors reference these keys via `NoteItem.figure.src`.
 *
 * COLLISIONS: keying by bare stem means two files with the same basename in
 * different folders would collide. Iteration order is the glob's sorted path
 * order, so the last-matching path wins (last-wins). In practice keys are
 * namespaced by their `<slug>-N` prefix, so collisions do not occur; author
 * filenames accordingly if a new subtree is added.
 */

/**
 * Eagerly-inlined asset modules. The globs are literals so Vite can analyse
 * them at build time; `import: 'default'` makes each value the asset URL string
 * directly (rather than a `{ default }` module namespace). The recursive `**`
 * glob already subsumes `ivc/`, but the explicit `ivc/*` pattern is kept for
 * documentation/clarity — Vite merges the two match sets.
 */
const ASSET_MODULES = import.meta.glob<string>(
  [
    '/src/assets/ivc/*.{png,jpg,jpeg,svg}',
    '/src/assets/**/*.{png,jpg,jpeg,svg}',
  ],
  { eager: true, import: 'default' },
);

/** Extract the extensionless filename (the KEY) from a glob path. @internal */
function keyFromPath(path: string): string {
  const file = path.slice(path.lastIndexOf('/') + 1);
  const dot = file.lastIndexOf('.');
  return dot === -1 ? file : file.slice(0, dot);
}

/**
 * KEY → inlined asset URL. Built once at module-eval time from the glob so
 * lookups are a plain map read.
 */
const IMAGE_MAP: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  for (const [path, url] of Object.entries(ASSET_MODULES)) {
    map.set(keyFromPath(path), url);
  }
  return map;
})();

/**
 * Resolve an image KEY to its inlined asset URL.
 * @returns the URL, or `undefined` when the key is unknown — callers should
 *   then render nothing (or a graceful placeholder) rather than a broken image.
 */
export function resolveImage(key: string): string | undefined {
  return IMAGE_MAP.get(key);
}

/**
 * The sorted list of every available image KEY. Handy for docs/tests and for
 * an authoring picker; never used to load images (that goes through
 * {@link resolveImage}).
 */
export function availableImageKeys(): string[] {
  return [...IMAGE_MAP.keys()].sort();
}
