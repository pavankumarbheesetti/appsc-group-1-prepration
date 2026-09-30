import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getCurrentRoute,
  navigate,
  registerRoute,
  routeParam,
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
});
