/**
 * Lightweight toast / snackbar — transient, non-blocking feedback.
 *
 * Design (Material "snackbar" + MDN live-region guidance):
 *   - a SINGLE polite ARIA live region (`aria-live="polite"`) announces the
 *     message to assistive tech without stealing focus,
 *   - ONE-AT-A-TIME: overlapping calls queue and play in order (see
 *     {@link ToastQueue}, a pure/testable scheduler),
 *   - auto-dismiss after a short delay,
 *   - bottom-anchored, sitting ABOVE the mobile bottom tab bar,
 *   - motion is governed globally by the reduced-motion rule in `base.css`.
 *
 * Toasts are for CONFIRMATIONS and soft errors (save/import/export); they never
 * replace an inline error that the user must act on.
 */
import { el } from '../dom';

/** A queued toast. */
export interface ToastItem {
  message: string;
  /** Visual tone (maps to a CSS modifier). Default `info`. */
  tone?: 'info' | 'success' | 'error';
  /** Auto-dismiss delay in ms. Default {@link DEFAULT_DURATION}. */
  duration?: number;
}

/** Default auto-dismiss delay. */
const DEFAULT_DURATION = 3200;

/**
 * A PURE, DOM-free, timer-free scheduler enforcing the "one toast at a time"
 * rule. It calls {@link onShow} for the current item; the driver later calls
 * {@link done} (e.g. when its timer elapses) to advance to the next queued
 * item, and {@link onIdle} fires when the queue drains. Unit-tested directly.
 */
export class ToastQueue {
  private readonly items: ToastItem[] = [];
  private busy = false;

  constructor(
    private readonly onShow: (item: ToastItem) => void,
    private readonly onIdle?: () => void,
  ) {}

  /** Enqueue a toast; shows immediately when idle, else waits its turn. */
  push(item: ToastItem): void {
    this.items.push(item);
    if (!this.busy) this.advance();
  }

  /** Signal the current toast has finished; play the next (or go idle). */
  done(): void {
    this.busy = false;
    this.advance();
  }

  /** Number of toasts still waiting (excludes the one on screen). */
  get pending(): number {
    return this.items.length;
  }

  /** Whether a toast is currently showing. */
  get active(): boolean {
    return this.busy;
  }

  private advance(): void {
    const next = this.items.shift();
    if (!next) {
      this.onIdle?.();
      return;
    }
    this.busy = true;
    this.onShow(next);
  }
}

/* -------------------------------------------------------------------------- */
/* DOM driver (singleton live region + timer wiring)                          */
/* -------------------------------------------------------------------------- */

let host: HTMLElement | null = null;
let queue: ToastQueue | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

/** Lazily create (once) the polite live-region host, anchored above the tab bar. */
function ensureHost(): HTMLElement {
  if (host && host.isConnected) return host;
  host = el('div', {
    class: 'toast-host',
    attrs: { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' },
  });
  document.body.appendChild(host);
  return host;
}

/** Render one toast, then arm its auto-dismiss timer. @internal */
function paint(item: ToastItem): void {
  const root = ensureHost();
  const toast = el('div', { class: `toast toast--${item.tone ?? 'info'}`, text: item.message });
  root.replaceChildren(toast);
  const dismiss = (): void => {
    if (host) host.replaceChildren();
    queue?.done();
  };
  timer = setTimeout(dismiss, item.duration ?? DEFAULT_DURATION);
}

/** Lazily create the singleton scheduler bound to the DOM driver. @internal */
function ensureQueue(): ToastQueue {
  if (!queue) {
    queue = new ToastQueue(paint, () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    });
  }
  return queue;
}

/**
 * Show a transient toast. Overlapping calls queue and play one at a time.
 * @param message the (already user-facing) text to announce.
 * @param opts tone + duration overrides.
 */
export function showToast(message: string, opts: Omit<ToastItem, 'message'> = {}): void {
  ensureQueue().push({ message, ...opts });
}
