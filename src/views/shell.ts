/**
 * Shared navigation pieces used by the app shell AND the views (NAV spec §3):
 *
 * - the canonical destination PATHS (old paths redirect to these),
 * - ORIGIN tracking for the Learn page's `‹ Today` / `‹ Plan` / `‹ Topics` back,
 * - a tiny TOP-BAR bridge so a view (Learn) can set the top-bar title and the
 *   mobile back link without importing the app composition root,
 * - the Practice page's `Quick practice · Timed mock` segments, and
 * - the one "Next up" footer component used on Learn notes, practice results,
 *   the Revise session end and mock results.
 */
import { navigate, routeQuery } from '../router/router';
import { el, type Child } from './dom';
import { button } from './components/button';
import { icon } from './components/icon';

/** Canonical destination paths. */
export const PATHS = {
  today: '/',
  plan: '/plan',
  topics: '/topics',
  practice: '/practice',
  mock: '/practice/mock',
  revise: '/revise',
  flashcards: '/revise/flashcards',
  mistakes: '/revise/mistakes',
  progress: '/progress',
  mains: '/mains',
  languages: '/languages',
  settings: '/settings',
} as const;

/* -------------------------------------------------------------------------- */
/* Origin (where the learner came from)                                        */
/* -------------------------------------------------------------------------- */

/** A page a Learn visit can come from. */
export type Origin = 'today' | 'plan' | 'topics' | 'progress' | 'revise' | 'practice';

/** Label + path of each origin. */
export const ORIGINS: Readonly<Record<Origin, { label: string; path: string }>> = {
  today: { label: 'Today', path: PATHS.today },
  plan: { label: 'Plan', path: PATHS.plan },
  topics: { label: 'Topics', path: PATHS.topics },
  progress: { label: 'Progress', path: PATHS.progress },
  revise: { label: 'Revise', path: PATHS.revise },
  practice: { label: 'Practice', path: PATHS.practice },
};

/** Whether `v` is a known origin key. */
export function isOrigin(v: string | undefined): v is Origin {
  return v !== undefined && Object.prototype.hasOwnProperty.call(ORIGINS, v);
}

/**
 * The origin implied by a hash: Today / Plan / Topics / … — and, on a Learn
 * page, the `from` it already carries (moving topic to topic keeps the origin).
 */
export function originFromHash(hash: string = location.hash || '#/'): Origin {
  const path = hash.split('?')[0] ?? '#/';
  if (path === '#/' || path === '#' || path === '#/today' || path === '#/start') return 'today';
  if (path.startsWith('#/plan')) return 'plan';
  if (path.startsWith('#/learn/')) {
    const from = routeQuery('from');
    return isOrigin(from) ? from : 'topics';
  }
  if (path.startsWith('#/topics') || path.startsWith('#/syllabus') || path.startsWith('#/notes')) return 'topics';
  if (path.startsWith('#/progress')) return 'progress';
  if (path.startsWith('#/revise') || path.startsWith('#/notebook')) return 'revise';
  if (path.startsWith('#/practice') || path.startsWith('#/drill') || path.startsWith('#/mock') || path.startsWith('#/q/')) return 'practice';
  return 'topics';
}

/* -------------------------------------------------------------------------- */
/* Top-bar bridge                                                              */
/* -------------------------------------------------------------------------- */

/** What the app shell exposes to views for the top bar. */
export interface TopbarApi {
  /** Set the title text; `heading:false` renders it as plain text (the view owns the h1). */
  setTitle(text: string, opts?: { heading?: boolean }): void;
  /** Show (or hide with `null`) the mobile `‹ Label` back link. */
  setBack(back: { label: string; onClick: () => void } | null): void;
}

let topbar: TopbarApi | null = null;

/** Called by the app shell once it has built the top bar. */
export function registerTopbar(api: TopbarApi | null): void {
  topbar = api;
}

/** Set the top-bar title (no-op when there is no shell, e.g. view unit tests). */
export function setTopbarTitle(text: string, opts?: { heading?: boolean }): void {
  topbar?.setTitle(text, opts);
}

/** Set the mobile back link (no-op without a shell). */
export function setTopbarBack(back: { label: string; onClick: () => void } | null): void {
  topbar?.setBack(back);
}

/* -------------------------------------------------------------------------- */
/* Practice segments                                                           */
/* -------------------------------------------------------------------------- */

/** The `Quick practice · Timed mock` switch at the top of the Practice page. */
export function practiceSegments(active: 'quick' | 'mock'): HTMLElement {
  const seg = (id: 'quick' | 'mock', label: string, hint: string, path: string): HTMLElement => {
    const on = id === active;
    return el('a', {
      class: on ? 'practice-seg is-active' : 'practice-seg',
      href: `#${path}`,
      attrs: on ? { 'aria-current': 'page' } : {},
      onClick: (e) => {
        e.preventDefault();
        if (!on) navigate(path);
      },
    }, [el('span', { class: 'practice-seg-label', text: label }), el('span', { class: 'practice-seg-hint', text: hint })]);
  };
  return el('nav', { class: 'practice-segs', ariaLabel: 'Practice mode' }, [
    seg('quick', 'Quick practice', 'Untimed, instant feedback', PATHS.practice),
    seg('mock', 'Timed mock', 'Negative marking', PATHS.mock),
  ]);
}

/* -------------------------------------------------------------------------- */
/* "Next up" footer                                                            */
/* -------------------------------------------------------------------------- */

/** One action of the Next-up footer. */
export interface NextUpAction {
  label: string;
  onClick: () => void;
  ariaLabel?: string;
}

/** Options of {@link nextUpFooter}. */
export interface NextUpOpts {
  /** The small line above the button (e.g. `Finished reading?`). */
  eyebrow: string;
  /** The ONE primary action. */
  primary: NextUpAction;
  /** At most two ghost links. */
  secondary?: readonly NextUpAction[];
  /** Optional extra content between the eyebrow and the actions. */
  extra?: Child;
}

/**
 * The single "Next up" card used at the end of every flow: an eyebrow line,
 * ONE primary button (with a trailing arrow) and at most two ghost links.
 */
export function nextUpFooter(opts: NextUpOpts): HTMLElement {
  const secondary = (opts.secondary ?? []).slice(0, 2);
  return el('section', { class: 'card next-up', attrs: { 'aria-label': 'Next up' } }, [
    el('p', { class: 'next-up-eyebrow' }, [icon('sparkles', 15), el('span', { text: opts.eyebrow })]),
    opts.extra ?? null,
    el('div', { class: 'next-up-actions' }, [
      button({
        label: opts.primary.label,
        variant: 'primary',
        iconName: 'arrow-right',
        ariaLabel: opts.primary.ariaLabel,
        onClick: opts.primary.onClick,
        class: 'next-up-primary',
      }),
      ...secondary.map((s) =>
        button({ label: s.label, variant: 'ghost', ariaLabel: s.ariaLabel, onClick: s.onClick, class: 'next-up-link' }),
      ),
    ]),
  ]);
}
