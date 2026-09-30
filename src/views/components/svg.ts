/**
 * Namespaced SVG construction helper.
 *
 * The DOM helper in {@link ../dom} uses `document.createElement`, which builds
 * HTML elements — SVG needs `createElementNS` so the browser applies the SVG
 * namespace (otherwise `<svg>`/`<circle>` render as inert unknown elements).
 * This is the ONLY place SVG nodes are created; every visual (icons, rings,
 * bars, charts) composes through it, and it sets attributes via `setAttribute`
 * so no markup string is ever parsed.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/** A child accepted by {@link svgEl}: an element or a falsy skip value. */
export type SvgChild = SVGElement | null | undefined | false;

/**
 * Create an SVG element of `tag`, set string attributes, and append children.
 * Numeric attribute values are coerced to strings by the caller.
 */
export function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
  children: SvgChild[] | SvgChild = [],
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    node.setAttribute(k, String(v));
  }
  const kids = Array.isArray(children) ? children : [children];
  for (const child of kids) {
    if (child === null || child === undefined || child === false) continue;
    node.appendChild(child);
  }
  return node;
}
