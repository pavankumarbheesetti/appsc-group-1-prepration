/**
 * App composition root — builds the persistent "focus workspace" shell and
 * wires the routed views into it.
 *
 * The shell is a persistent LEFT SIDEBAR on desktop (≥900px) and a fixed BOTTOM
 * TAB BAR on mobile (<900px), plus a slim glass top bar carrying the current
 * page title. Both nav surfaces are driven from one {@link NAV} definition, and
 * a route-change hook keeps the active highlight, `aria-current`, and the top
 * bar title in sync. Views still render into the `<main>` mount via the router's
 * `render(root)` contract — only the chrome around them changed.
 */
import { CONFIG } from './config';
import { getBanks, getSyllabus } from './content/loader';
import { navigate, registerRoute, start } from './router/router';
import { loadState, updateState } from './state/store';
import type { AppState } from './state/store';
import { el } from './views/dom';
import { icon, type IconName } from './views/components/icon';
import * as today from './views/today';
import * as planner from './views/planner';
import * as startGuide from './views/start';
import * as drill from './views/drill';
import * as mock from './views/mock';
import * as notebook from './views/notebook';
import * as syllabus from './views/syllabus';
import * as notes from './views/notes';
import * as revise from './views/revise';
import * as learn from './views/learn';
import * as mains from './views/mains';
import * as progress from './views/progress';
import * as telugu from './views/telugu';
import * as english from './views/english';
import * as settings from './views/settings';
import { openSearch } from './views/search';
import { openDialog, type DialogController } from './views/dialog';

/**
 * Build the "Loaded N banks across M subjects; syllabus: … verified=…" summary.
 * Retained (kept unit-testable independently of the DOM).
 */
export function contentSummary(): string {
  const banks = getBanks();
  const subjects = new Set(banks.map((b) => b.bank.subjectCode));
  const { meta } = getSyllabus();
  return `Loaded ${banks.length} banks across ${subjects.size} subjects; syllabus: ${meta.notificationNo} verified=${meta.verified}`;
}

/** Font-scale bounds and step for the A-/A+ controls. */
const FONT_MIN = 0.8;
const FONT_MAX = 1.6;
const FONT_STEP = 0.1;

/** Apply persisted theme + font scale to the document root. */
export function applySettings(state: AppState): void {
  const doc = document.documentElement;
  doc.dataset.theme = state.settings.theme;
  doc.style.setProperty('--font-scale', String(state.settings.fontScale));
}

/** A navigation destination: label, hash path, and its inline-SVG icon. */
interface NavItem {
  label: string;
  path: string;
  iconName: IconName;
}

/** A labelled group of nav items (reduces the flat-list overwhelm). */
interface NavSection {
  /** Uppercase section eyebrow, e.g. "Practice". */
  eyebrow: string;
  items: NavItem[];
}

/**
 * The single source of nav truth, organised into coherent SECTIONS so the ~12
 * destinations read as a handful of themed groups rather than one long list.
 * The sidebar renders these groups; the mobile tab bar surfaces the top few
 * and tucks the rest behind a "More" drawer built from the same data.
 */
const NAV_SECTIONS: ReadonlyArray<NavSection> = [
  { eyebrow: 'Plan', items: [
    { label: 'Today', path: '/', iconName: 'dashboard' },
    { label: 'Start here', path: '/start', iconName: 'sparkles' },
    { label: 'Planner', path: '/planner', iconName: 'calendar' },
  ] },
  { eyebrow: 'Learn', items: [
    { label: 'Syllabus', path: '/syllabus', iconName: 'syllabus' },
  ] },
  { eyebrow: 'Practice', items: [
    { label: 'Drill', path: '/drill', iconName: 'drill' },
    { label: 'Mock', path: '/mock', iconName: 'timer' },
  ] },
  { eyebrow: 'Revise', items: [
    { label: 'Revise', path: '/revise', iconName: 'revise' },
  ] },
  { eyebrow: 'Skills', items: [
    { label: 'Mains', path: '/mains', iconName: 'notes' },
    { label: 'Languages', path: '/languages', iconName: 'globe' },
  ] },
  { eyebrow: 'Track', items: [
    { label: 'Progress', path: '/progress', iconName: 'notebook' },
  ] },
];

/** The utility/settings destination — a bottom "gear" item, outside the groups. */
const SETTINGS_ITEM: NavItem = { label: 'Settings', path: '/settings', iconName: 'gear' };

/** Every nav destination flattened (groups + settings), for label/active lookup. */
const ALL_ITEMS: ReadonlyArray<NavItem> = [
  ...NAV_SECTIONS.flatMap((s) => s.items),
  SETTINGS_ITEM,
];

/**
 * The compact set of destinations that get their own MOBILE tab (the rest live
 * in the "More" drawer). Kept to five including the "More" button so the bottom
 * bar never crowds.
 */
const MOBILE_PRIMARY_PATHS: ReadonlyArray<string> = ['/', '/syllabus', '/drill', '/revise'];

/* -------------------------------------------------------------------------- */
/* Shell state — references updated on every route change.                     */
/* -------------------------------------------------------------------------- */

/** Nav buttons keyed by normalized path, for toggling the active highlight. */
const sideLinks = new Map<string, HTMLElement>();
const tabLinks = new Map<string, HTMLElement>();
/** "More" drawer nav buttons keyed by normalized path. */
const moreLinks = new Map<string, HTMLElement>();
/** The mobile "More" tab button (highlighted when a non-primary route is active). */
let moreTabBtn: HTMLElement | null = null;
/** The mobile "More" drawer element (toggled open/closed). */
let moreDrawer: HTMLElement | null = null;
/** The active "More" sheet dialog controller (focus-trap + ESC + return-focus). */
let moreDialog: DialogController | null = null;
/** The top-bar title element, retitled per route. */
let titleEl: HTMLElement | null = null;

/** Whether the global Cmd/Ctrl-K search hotkey has been attached. */
let searchHotkeyBound = false;

/** Normalize a nav path the same way the router does (`/drill` → `#/drill`). */
function toHash(path: string): string {
  return path === '/' ? '#/' : `#${path}`;
}

/** Highlight the active nav item across every surface and set the page title. */
function setActive(path: string): void {
  const hash = toHash(path);
  const label = ALL_ITEMS.find((n) => n.path === path)?.label ?? CONFIG.appName;
  if (titleEl) titleEl.textContent = label;
  for (const [p, node] of sideLinks) toggleCurrent(node, p === hash);
  for (const [p, node] of tabLinks) toggleCurrent(node, p === hash);
  for (const [p, node] of moreLinks) toggleCurrent(node, p === hash);
  // The "More" tab reflects any destination that is NOT one of the primary tabs.
  if (moreTabBtn) {
    const isPrimary = MOBILE_PRIMARY_PATHS.some((p) => toHash(p) === hash);
    toggleCurrent(moreTabBtn, !isPrimary);
  }
  closeMoreDrawer();
}

/**
 * Set the top-bar title for a route that is NOT in the primary nav (e.g. the
 * Learn workspace or a single-question drill) and clear any active nav highlight.
 */
function setActiveTitle(title: string): void {
  if (titleEl) titleEl.textContent = title;
  for (const [, node] of sideLinks) toggleCurrent(node, false);
  for (const [, node] of tabLinks) toggleCurrent(node, false);
  for (const [, node] of moreLinks) toggleCurrent(node, false);
  if (moreTabBtn) toggleCurrent(moreTabBtn, false);
  closeMoreDrawer();
}

/** Set/remove `aria-current="page"` on a nav node. @internal */
function toggleCurrent(node: HTMLElement, active: boolean): void {
  if (active) node.setAttribute('aria-current', 'page');
  else node.removeAttribute('aria-current');
}

/* -------------------------------------------------------------------------- */
/* Controls (theme toggle + font scale)                                        */
/* -------------------------------------------------------------------------- */

/** Build the search button that opens the Cmd/Ctrl-K overlay. @internal */
function buildSearchButton(): HTMLButtonElement {
  return el('button', {
    class: 'icon-btn',
    type: 'button',
    ariaLabel: 'Search (Cmd/Ctrl-K)',
    attrs: { title: 'Search  ⌘K' },
    onClick: () => openSearch(),
  }, [icon('search', 20)]) as HTMLButtonElement;
}

/** Build the theme toggle button (swaps its icon on click). @internal */
function buildThemeToggle(): HTMLButtonElement {
  const btn = el('button', {
    class: 'icon-btn',
    type: 'button',
    ariaLabel: 'Toggle light and dark theme',
  });
  const paint = (theme: 'light' | 'dark'): void => {
    // Show the SUN in dark mode (click → go light) and the MOON in light mode
    // (click → go dark); keep the aria-label in sync with the action.
    btn.setAttribute('aria-label', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
    btn.replaceChildren(icon(theme === 'dark' ? 'sun' : 'moon', 20));
  };
  paint(loadState().settings.theme);
  btn.addEventListener('click', () => {
    const next = updateState((s) => {
      s.settings.theme = s.settings.theme === 'dark' ? 'light' : 'dark';
    });
    applySettings(next);
    paint(next.settings.theme);
  });
  return btn;
}

/** Build the segmented A- / value / A+ font-scale control. @internal */
function buildFontControl(): HTMLElement {
  const value = el('span', { class: 'seg-value tnum' });
  const paint = (scale: number): void => {
    value.textContent = `${Math.round(scale * 100)}%`;
  };
  paint(loadState().settings.fontScale);

  const bump = (delta: number): void => {
    const next = updateState((s) => {
      const raw = s.settings.fontScale + delta;
      // Clamp + round to avoid float drift accumulating over repeated clicks.
      s.settings.fontScale = Math.min(FONT_MAX, Math.max(FONT_MIN, Math.round(raw * 10) / 10));
    });
    applySettings(next);
    paint(next.settings.fontScale);
  };

  return el('div', { class: 'seg', attrs: { role: 'group', 'aria-label': 'Text size' } }, [
    el('button', { type: 'button', text: 'A−', ariaLabel: 'Decrease text size', onClick: () => bump(-FONT_STEP) }),
    value,
    el('button', { type: 'button', text: 'A+', ariaLabel: 'Increase text size', onClick: () => bump(FONT_STEP) }),
  ]);
}

/* -------------------------------------------------------------------------- */
/* Shell construction                                                          */
/* -------------------------------------------------------------------------- */

/** Build one sidebar nav item (icon + label). @internal */
function buildSideLink(item: NavItem): HTMLElement {
  const node = el('button', {
    class: 'nav-item',
    type: 'button',
    onClick: () => navigate(item.path),
  }, [icon(item.iconName, 20), el('span', { class: 'nav-label', text: item.label })]);
  sideLinks.set(toHash(item.path), node);
  return node;
}

/** Build one mobile tab-bar item (stacked icon + label). @internal */
function buildTabLink(item: NavItem): HTMLElement {
  const node = el('button', {
    class: 'tab-item',
    type: 'button',
    ariaLabel: item.label,
    onClick: () => navigate(item.path),
  }, [icon(item.iconName, 22), el('span', { class: 'nav-label', text: item.label })]);
  tabLinks.set(toHash(item.path), node);
  return node;
}

/** Build one "More" drawer nav item (icon + label). @internal */
function buildMoreLink(item: NavItem): HTMLElement {
  const node = el('button', {
    class: 'nav-item',
    type: 'button',
    onClick: () => navigate(item.path),
  }, [icon(item.iconName, 20), el('span', { class: 'nav-label', text: item.label })]);
  moreLinks.set(toHash(item.path), node);
  return node;
}

/** One grouped nav section (eyebrow + its items), used by sidebar and drawer. @internal */
function buildNavGroups(makeLink: (item: NavItem) => HTMLElement): HTMLElement[] {
  return NAV_SECTIONS.map((section) =>
    el('div', { class: 'nav-group' }, [
      el('span', { class: 'nav-eyebrow', text: section.eyebrow }),
      ...section.items.map(makeLink),
    ]),
  );
}

/** Build the persistent left sidebar (desktop). @internal */
function buildSidebar(): HTMLElement {
  const brand = el('div', {
    class: 'sidebar-brand',
    attrs: { role: 'button', tabindex: '0' },
    onClick: () => navigate('/'),
  }, [
    el('span', { class: 'brand-mark' }, [icon('sparkles', 22)]),
    el('div', { class: 'brand-text' }, [
      el('span', { class: 'brand-name', text: 'APPSC Focus' }),
      el('span', { class: 'brand-sub', text: 'Group-1 workspace' }),
    ]),
  ]);

  const nav = el('nav', { class: 'nav', ariaLabel: 'Primary' }, buildNavGroups(buildSideLink));

  const footer = el('div', { class: 'sidebar-footer' }, [
    // Settings lives as a bottom utility item (gear), outside the study groups.
    buildSideLink(SETTINGS_ITEM),
    el('div', { class: 'control-row' }, [
      el('span', { class: 'control-label', text: 'Theme' }),
      buildThemeToggle(),
    ]),
    el('div', { class: 'control-row' }, [
      el('span', { class: 'control-label', text: 'Text size' }),
      buildFontControl(),
    ]),
  ]);

  return el('aside', { class: 'sidebar' }, [brand, nav, footer]);
}

/** Build the slim top bar (page title + mobile-only controls). @internal */
function buildTopbar(): HTMLElement {
  titleEl = el('h1', { class: 'topbar-title', text: 'Today' });
  return el('header', { class: 'topbar' }, [
    el('span', { class: 'topbar-mark' }, [icon('sparkles', 18)]),
    titleEl,
    // Compact controls surface on mobile where the sidebar is hidden.
    el('div', { class: 'topbar-actions' }, [buildSearchButton(), buildThemeToggle(), buildFontControl()]),
  ]);
}

/**
 * Build the fixed bottom tab bar (mobile): the primary destinations plus a
 * "More" button that opens the grouped drawer for everything else. @internal
 */
function buildTabbar(): HTMLElement {
  const primary = ALL_ITEMS.filter((i) => MOBILE_PRIMARY_PATHS.includes(i.path))
    // Keep the intended primary order regardless of section order.
    .sort((a, b) => MOBILE_PRIMARY_PATHS.indexOf(a.path) - MOBILE_PRIMARY_PATHS.indexOf(b.path));

  moreTabBtn = el('button', {
    class: 'tab-item',
    type: 'button',
    ariaLabel: 'More destinations',
    attrs: { 'aria-haspopup': 'true', 'aria-expanded': 'false' },
    onClick: () => toggleMoreDrawer(),
  }, [icon('menu', 22), el('span', { class: 'nav-label', text: 'More' })]);

  return el('nav', { class: 'tabbar', ariaLabel: 'Primary' }, [
    ...primary.map(buildTabLink),
    moreTabBtn,
  ]);
}

/**
 * Build the mobile "More" drawer: the full grouped nav (plus Settings), shown
 * as an overlay so the compact tab bar never has to list everything. Tapping a
 * link navigates (which closes the drawer via {@link setActive}); tapping the
 * scrim or Close dismisses it. @internal
 */
function buildMoreDrawer(): HTMLElement {
  const groups = buildNavGroups(buildMoreLink);
  const settingsGroup = el('div', { class: 'nav-group' }, [
    el('span', { class: 'nav-eyebrow', text: 'Utility' }),
    buildMoreLink(SETTINGS_ITEM),
  ]);

  const panel = el('div', { class: 'more-panel', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'More destinations' } }, [
    el('div', { class: 'more-panel-head' }, [
      el('span', { class: 'more-panel-title', text: 'All destinations' }),
      el('button', {
        class: 'icon-btn',
        type: 'button',
        ariaLabel: 'Close menu',
        onClick: () => closeMoreDrawer(),
      }, [icon('x', 20)]),
    ]),
    el('nav', { class: 'nav more-nav', ariaLabel: 'More' }, [...groups, settingsGroup]),
  ]);

  const scrim = el('div', { class: 'more-scrim' });

  moreDrawer = el('div', { class: 'more-drawer', attrs: { hidden: 'true' } }, [scrim, panel]);
  return moreDrawer;
}

/** Open/close the mobile "More" drawer. @internal */
function toggleMoreDrawer(): void {
  if (!moreDrawer) return;
  if (moreDrawer.hasAttribute('hidden')) openMoreDrawer();
  else closeMoreDrawer();
}

/** Open the mobile "More" drawer as a modal SHEET: focus-trap + ESC + return-focus. @internal */
function openMoreDrawer(): void {
  if (!moreDrawer || moreDialog) return;
  moreDrawer.removeAttribute('hidden');
  moreDrawer.classList.add('is-open');
  moreTabBtn?.setAttribute('aria-expanded', 'true');
  const panel = moreDrawer.querySelector<HTMLElement>('.more-panel');
  const scrim = moreDrawer.querySelector<HTMLElement>('.more-scrim');
  if (!panel) return;
  // Move focus into the sheet, trap Tab, close on global ESC / scrim click, and
  // return focus to the "More" button that opened it.
  moreDialog = openDialog({
    panel,
    scrim,
    returnFocus: moreTabBtn,
    onClose: () => {
      moreDrawer?.setAttribute('hidden', 'true');
      moreDrawer?.classList.remove('is-open');
      moreTabBtn?.setAttribute('aria-expanded', 'false');
      moreDialog = null;
    },
  });
}

/** Close the mobile "More" drawer (safe to call when already closed). @internal */
function closeMoreDrawer(): void {
  if (moreDialog) {
    moreDialog.close();
    return;
  }
  // Never opened via the dialog (or already torn down) — ensure it is hidden.
  if (!moreDrawer) return;
  moreDrawer.setAttribute('hidden', 'true');
  moreDrawer.classList.remove('is-open');
  moreTabBtn?.setAttribute('aria-expanded', 'false');
}

/**
 * Render the full app into `root`: the persistent shell + routed view mount.
 */
export function renderApp(root: HTMLElement): void {
  const state = loadState();
  applySettings(state);

  // Reset shell references (renderApp may run more than once in tests).
  sideLinks.clear();
  tabLinks.clear();
  moreLinks.clear();
  moreTabBtn = null;
  moreDrawer = null;
  moreDialog = null;

  const sidebar = buildSidebar();
  const topbar = buildTopbar();
  const view = el('main', { class: 'app-main', attrs: { id: 'view' } });
  const tabbar = buildTabbar();
  const drawer = buildMoreDrawer();

  const content = el('div', { class: 'app-content' }, [topbar, view]);
  const shell = el('div', { class: 'app-shell' }, [sidebar, content, tabbar, drawer]);
  root.replaceChildren(shell);

  // Wrap each view render so navigating also updates the shell (active state +
  // title). The `render(root)` contract to the view is unchanged.
  const wire = (path: string, render: (r: HTMLElement) => void): void => {
    registerRoute(path, (r) => {
      setActive(path);
      render(r);
    });
  };
  wire('/', today.render);
  wire('/planner', planner.render);
  wire('/start', startGuide.render);
  wire('/drill', drill.render);
  wire('/mock', mock.render);
  wire('/syllabus', syllabus.render);
  wire('/notes', notes.render);
  wire('/revise', revise.render);
  wire('/progress', progress.render);
  wire('/mains', mains.render);
  wire('/settings', settings.render);
  wire('/languages', telugu.renderLanguagesHub);
  // The Telugu COURSE lives under the Languages area: keep Languages highlighted
  // and give the top bar the "Telugu" title.
  registerRoute('/telugu', (r) => {
    setActive('/languages');
    if (titleEl) titleEl.textContent = 'Telugu';
    telugu.render(r);
  });
  // The English QUALIFYING module also lives under the Languages area: keep
  // Languages highlighted and give the top bar the "English" title.
  registerRoute('/english', (r) => {
    setActive('/languages');
    if (titleEl) titleEl.textContent = 'English';
    english.render(r);
  });
  // `#/today` is an explicit alias for the landing route; keep the Today nav
  // item highlighted for it.
  registerRoute('/today', (r) => {
    setActive('/');
    today.render(r);
  });
  // Routes that live UNDER the Revise area: keep the Revise nav item highlighted
  // but give the top bar their own title. The #/notebook route stays working.
  const wireUnderRevise = (path: string, title: string, render: (r: HTMLElement) => void): void => {
    registerRoute(path, (r) => {
      setActive('/revise');
      if (titleEl) titleEl.textContent = title;
      render(r);
    });
  };
  wireUnderRevise('/notebook', 'Notebook', notebook.render);
  wireUnderRevise('/revise/flashcards', 'Flashcards', revise.renderFlashcards);
  // Non-nav routes: the Learn workspace and the single-question focus drill.
  // These set their own page title and clear the nav highlight.
  registerRoute('/learn/:id', (r) => {
    setActiveTitle('Learn');
    learn.render(r);
  });
  registerRoute('/q/:id', (r) => {
    setActiveTitle('Question');
    drill.renderSingleQuestion(r);
  });
  // The Mains writing WORKSPACE lives under the Mains tab: keep Mains
  // highlighted and give the top bar the "Mains" title.
  registerRoute('/mains/:id', (r) => {
    setActive('/mains');
    mains.renderWorkspace(r);
  });

  // Global Cmd/Ctrl-K opens the search overlay (attached once).
  if (!searchHotkeyBound) {
    window.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        openSearch();
      }
    });
    searchHotkeyBound = true;
  }

  start(view);
}
