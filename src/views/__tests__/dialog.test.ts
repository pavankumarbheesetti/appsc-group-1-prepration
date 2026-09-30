import { describe, it, expect, beforeEach } from 'vitest';
import { openDialog, getFocusable } from '../dialog';

/**
 * Focus-trap dialog behaviour (WAI-ARIA modal dialog): focus moves in, Tab /
 * Shift-Tab cycle WITHIN the panel, ESC anywhere closes, a scrim click closes,
 * and focus RETURNS to the opener on close.
 */
function build(): { scrim: HTMLElement; panel: HTMLElement; opener: HTMLButtonElement; first: HTMLButtonElement; last: HTMLButtonElement } {
  const opener = document.createElement('button');
  opener.textContent = 'Open';
  document.body.appendChild(opener);

  const scrim = document.createElement('div');
  const panel = document.createElement('div');
  panel.setAttribute('role', 'dialog');
  const first = document.createElement('button');
  first.textContent = 'First';
  const last = document.createElement('button');
  last.textContent = 'Last';
  panel.append(first, last);
  scrim.append(panel);
  document.body.appendChild(scrim);
  return { scrim, panel, opener, first, last };
}

function tab(shift = false): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, bubbles: true }));
}

describe('dialog focus trap', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('lists focusable descendants (ignoring [hidden]/aria-hidden)', () => {
    const { panel, first, last } = build();
    const hidden = document.createElement('button');
    hidden.setAttribute('hidden', 'true');
    panel.appendChild(hidden);
    const focusable = getFocusable(panel);
    expect(focusable).toEqual([first, last]);
  });

  it('moves focus into the dialog on open (initialFocus)', () => {
    const { scrim, panel, opener, first } = build();
    opener.focus();
    const ctl = openDialog({ panel, scrim, initialFocus: first, onClose: () => scrim.remove() });
    expect(document.activeElement).toBe(first);
    ctl.close();
  });

  it('cycles focus with Tab and Shift-Tab', () => {
    const { scrim, panel, first, last } = build();
    const ctl = openDialog({ panel, scrim, initialFocus: first, onClose: () => scrim.remove() });

    // Tab from the last element wraps to the first.
    last.focus();
    tab(false);
    expect(document.activeElement).toBe(first);

    // Shift-Tab from the first element wraps to the last.
    first.focus();
    tab(true);
    expect(document.activeElement).toBe(last);
    ctl.close();
  });

  it('closes on global ESC and returns focus to the opener', () => {
    const { scrim, panel, opener, first } = build();
    opener.focus();
    let closed = false;
    openDialog({ panel, scrim, initialFocus: first, onClose: () => { closed = true; scrim.remove(); } });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(closed).toBe(true);
    expect(document.activeElement).toBe(opener);
  });

  it('closes on a scrim click but not on a panel click', () => {
    const { scrim, panel, opener, first } = build();
    opener.focus();
    let closed = false;
    openDialog({ panel, scrim, initialFocus: first, onClose: () => { closed = true; scrim.remove(); } });

    // A click inside the panel must NOT close.
    first.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(closed).toBe(false);

    // A click on the scrim itself closes.
    scrim.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(closed).toBe(true);
  });

  it('close() is idempotent (onClose runs once)', () => {
    const { scrim, panel, first } = build();
    let n = 0;
    const ctl = openDialog({ panel, scrim, initialFocus: first, onClose: () => { n += 1; } });
    ctl.close();
    ctl.close();
    expect(n).toBe(1);
  });
});
