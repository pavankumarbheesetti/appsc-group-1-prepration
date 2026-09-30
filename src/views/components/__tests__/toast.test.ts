import { describe, it, expect } from 'vitest';
import { ToastQueue } from '../toast';

/**
 * The pure "one toast at a time" scheduler: the first push shows immediately,
 * later pushes queue, done() advances to the next, and onIdle fires when the
 * queue drains.
 */
describe('ToastQueue', () => {
  it('shows the first toast immediately and queues the rest', () => {
    const shown: string[] = [];
    const q = new ToastQueue((item) => shown.push(item.message));
    q.push({ message: 'a' });
    q.push({ message: 'b' });
    q.push({ message: 'c' });
    // Only the first is on screen; the other two wait.
    expect(shown).toEqual(['a']);
    expect(q.active).toBe(true);
    expect(q.pending).toBe(2);
  });

  it('advances through the queue on done()', () => {
    const shown: string[] = [];
    const q = new ToastQueue((item) => shown.push(item.message));
    q.push({ message: 'a' });
    q.push({ message: 'b' });
    q.done(); // 'a' finished → 'b' shows
    expect(shown).toEqual(['a', 'b']);
    expect(q.pending).toBe(0);
  });

  it('fires onIdle when the queue drains', () => {
    const shown: string[] = [];
    let idle = 0;
    const q = new ToastQueue((item) => shown.push(item.message), () => { idle += 1; });
    q.push({ message: 'only' });
    q.done();
    expect(q.active).toBe(false);
    expect(idle).toBe(1);
  });

  it('re-shows immediately when pushed while idle', () => {
    const shown: string[] = [];
    const q = new ToastQueue((item) => shown.push(item.message));
    q.push({ message: 'a' });
    q.done();
    q.push({ message: 'b' });
    expect(shown).toEqual(['a', 'b']);
  });
});
