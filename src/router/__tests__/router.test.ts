import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  canonicalHash,
  getCurrentRoute,
  navigate,
  pushUrl,
  registerRedirect,
  registerRoute,
  routeParam,
  routeQuery,
  setDocumentTitle,
  start,
} from '../router';

// jsdom provides window/location; these tests drive the hash router directly.

function setup(): { root: HTMLElement; home: ReturnType<typeof vi.fn>; drill: ReturnType<typeof vi.fn> } {
  const root = document.createElement('div');
  const home = vi.fn();
  const drill = vi.fn();
  registerRoute('/', home);
  registerRoute('/drill', drill);
  return { root, home, drill };
}

describe('router', () => {
  beforeEach(() => {
    location.hash = ''; // reset before each test
    vi.clearAllMocks();
  });

  it('renders the home route on start', () => {
    const { root, home } = setup();
    start(root);
    expect(home).toHaveBeenCalledWith(root);
    expect(getCurrentRoute()).toBe('#/');
  });

  it('navigate updates the hash and calls the matching render fn', () => {
    const { root, drill } = setup();
    start(root);
    navigate('/drill');
    expect(location.hash).toBe('#/drill');
    expect(drill).toHaveBeenCalledWith(root);
    expect(getCurrentRoute()).toBe('#/drill');
  });

  it('falls back to Home for an unknown route', () => {
    const { root, home } = setup();
    start(root);
    home.mockClear();
    navigate('/does-not-exist');
    expect(getCurrentRoute()).toBe('#/'); // resolved to Home
    expect(home).toHaveBeenCalled();
  });

  it('re-renders on a real hashchange event (e.g. back button)', () => {
    const { root, drill } = setup();
    start(root);
    // Simulate the browser changing the hash without going through navigate().
    location.hash = '#/drill';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(drill).toHaveBeenCalledWith(root);
  });

  it('matches a parameterized route and exposes its param', () => {
    const root = document.createElement('div');
    const learn = vi.fn();
    registerRoute('/', vi.fn());
    registerRoute('/learn/:id', learn);
    start(root);
    navigate('/learn/hist-ancient-ivc');
    expect(getCurrentRoute()).toBe('#/learn/:id');
    expect(learn).toHaveBeenCalledWith(root);
    expect(routeParam('/learn/:id', 'id')).toBe('hist-ancient-ivc');
  });

  it('decodes an encoded param segment', () => {
    const root = document.createElement('div');
    registerRoute('/', vi.fn());
    registerRoute('/q/:id', vi.fn());
    start(root);
    navigate('/q/ivc-mcq-1');
    expect(routeParam('/q/:id', 'id')).toBe('ivc-mcq-1');
  });

  it('corrects the hash to #/ for an unknown route', () => {
    const { root, home } = setup();
    start(root);
    home.mockClear();
    navigate('/does-not-exist');
    expect(location.hash).toBe('#/');
    expect(home).toHaveBeenCalled();
  });

  it('keeps an old path working as a redirect (address bar corrected, query kept)', () => {
    const root = document.createElement('div');
    const topics = vi.fn();
    registerRoute('/', vi.fn());
    registerRoute('/topics', topics);
    registerRedirect('/syllabus', '/topics');
    start(root);
    navigate('/syllabus?s=HIST');
    expect(location.hash).toBe('#/topics?s=HIST');
    expect(topics).toHaveBeenCalled();
    expect(routeQuery('s')).toBe('HIST');
    expect(canonicalHash('#/syllabus')).toBe('#/topics');
  });

  it('redirects a typed old URL on hashchange too', () => {
    const root = document.createElement('div');
    const plan = vi.fn();
    registerRoute('/', vi.fn());
    registerRoute('/plan', plan);
    registerRedirect('/planner', '/plan');
    start(root);
    location.hash = '#/planner';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(location.hash).toBe('#/plan');
    expect(plan).toHaveBeenCalled();
  });

  it('matches routes on the path only (a query never breaks matching)', () => {
    const root = document.createElement('div');
    const learn = vi.fn();
    registerRoute('/', vi.fn());
    registerRoute('/learn/:id/:tab', learn);
    start(root);
    navigate('/learn/hist-ancient-stone-age/notes?from=today');
    expect(getCurrentRoute()).toBe('#/learn/:id/:tab');
    expect(routeParam('/learn/:id/:tab', 'tab')).toBe('notes');
    expect(routeQuery('from')).toBe('today');
  });

  it('sets document.title per page and moves focus to the page h1', () => {
    document.body.innerHTML = '';
    const root = document.createElement('main');
    document.body.appendChild(root);
    registerRoute('/', (r) => {
      r.innerHTML = '<h1>Home page</h1>';
    });
    registerRoute('/drill', (r) => {
      r.innerHTML = '<h1>Drill page</h1>';
      setDocumentTitle('Quick practice', 'Practice');
    });
    start(root);
    expect(document.title).toBe('Home page \u00b7 APPSC Focus');
    expect(document.activeElement?.textContent).toBe('Home page');
    expect(document.activeElement?.getAttribute('tabindex')).toBe('-1');
    navigate('/drill');
    expect(document.title).toBe('Quick practice \u00b7 Practice \u00b7 APPSC Focus');
    expect(document.activeElement?.textContent).toBe('Drill page');
    root.remove();
  });

  it('keepFocus leaves focus where it is (e.g. a tab button)', () => {
    document.body.innerHTML = '';
    const root = document.createElement('main');
    document.body.appendChild(root);
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    registerRoute('/', (r) => {
      r.innerHTML = '<h1>A</h1>';
    });
    registerRoute('/drill', (r) => {
      r.innerHTML = '<h1>B</h1>';
    });
    start(root);
    btn.focus();
    navigate('/drill', { keepFocus: true, keepScroll: true });
    expect(document.activeElement).toBe(btn);
    root.remove();
    btn.remove();
  });

  it('resets scroll to the top on a new navigation and restores it on Back', () => {
    const scrollTo = vi.fn();
    const ua = Object.getOwnPropertyDescriptor(window.navigator, 'userAgent');
    Object.defineProperty(window.navigator, 'userAgent', { value: 'Chrome', configurable: true });
    const prev = window.scrollTo;
    window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
    try {
      const root = document.createElement('div');
      registerRoute('/', vi.fn());
      registerRoute('/drill', vi.fn());
      start(root);
      Object.defineProperty(window, 'scrollY', { value: 800, configurable: true });
      navigate('/drill');
      expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ top: 0 }));
      // Simulate Back to the first entry (history.state carries its position).
      const back = (history.state as { navPos: number }).navPos - 1;
      history.replaceState({ navPos: back }, '', '#/');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
      expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ top: 800 }));
    } finally {
      window.scrollTo = prev;
      Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
      if (ua) Object.defineProperty(window.navigator, 'userAgent', ua);
      else delete (window.navigator as { userAgent?: string }).userAgent;
    }
  });

  it('pushUrl gives an already-drawn state its own URL without re-rendering', () => {
    const root = document.createElement('div');
    const results = vi.fn();
    registerRoute('/', vi.fn());
    registerRoute('/learn/:id/practice/results', results);
    start(root);
    pushUrl('/learn/x/practice/results');
    expect(location.hash).toBe('#/learn/x/practice/results');
    expect(results).not.toHaveBeenCalled();
  });
});
