/**
 * Reusable modal-dialog behaviour — the WAI-ARIA "modal dialog" interaction
 * contract, factored out so every overlay in the app behaves identically.
 *
 * When a dialog opens this helper:
 *   - moves focus INTO the dialog (first focusable, or the panel itself),
 *   - TRAPS Tab / Shift-Tab so focus cycles within the panel,
 *   - closes on the ESCAPE key pressed ANYWHERE in the document (not only when a
 *     particular field is focused),
 *   - closes on a click on the scrim/backdrop (a click whose target IS the
 *     scrim, so clicks inside the panel are ignored), and
 *   - RETURNS focus to the element that opened the dialog when it closes.
 *
 * It is presentation-agnostic: callers own the DOM (panel + optional scrim) and
 * supply an {@link DialogOptions.onClose} that performs the actual teardown
 * (remove or hide). Motion is governed globally by the reduced-motion rule in
 * `base.css`, so nothing here animates directly.
 */

/** CSS selector matching the natively/att-focusable elements we can Tab to. */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * The ordered, focusable descendants of `container`.
 *
 * Note: deliberately does NOT filter by visibility/layout — jsdom reports no
 * layout, so an `offsetParent`/`getBoundingClientRect` filter would wrongly
 * drop everything under test. Elements explicitly hidden via the `hidden`
 * attribute are excluded. Exported for unit testing. @internal
 */
export function getFocusable(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
    (el) => !el.hasAttribute('hidden') && el.getAttribute('aria-hidden') !== 'true',
  );
}

/** Options for {@link openDialog}. */
export interface DialogOptions {
  /** The dialog container that owns focus (should carry role="dialog"). */
  panel: HTMLElement;
  /** Optional backdrop; a click whose target IS this element closes the dialog. */
  scrim?: HTMLElement | null;
  /** Perform the actual teardown (remove/hide the DOM). Called once on close. */
  onClose: () => void;
  /** Element to focus on open (default: first focusable in the panel, else the panel). */
  initialFocus?: HTMLElement | null;
  /**
   * Element to focus on close (default: whatever was focused when the dialog
   * opened — i.e. the element that triggered it).
   */
  returnFocus?: HTMLElement | null;
}

/** A handle to an open dialog. */
export interface DialogController {
  /** Close the dialog: unbind listeners, run `onClose`, and restore focus. Idempotent. */
  close(): void;
}

/**
 * Open a modal dialog: trap focus, wire global ESC + scrim-close, and return a
 * controller whose {@link DialogController.close} tears everything down and
 * restores focus to the opener.
 */
export function openDialog(options: DialogOptions): DialogController {
  const { panel, scrim, onClose } = options;
  const opener =
    options.returnFocus ??
    (document.activeElement instanceof HTMLElement ? document.activeElement : null);

  let closed = false;

  const onKeydown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (e.key !== 'Tab') return;
    const focusable = getFocusable(panel);
    if (focusable.length === 0) {
      // Nothing to Tab to — keep focus pinned on the panel.
      e.preventDefault();
      panel.focus();
      return;
    }
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    const active = document.activeElement;
    const inside = panel.contains(active);
    if (e.shiftKey) {
      if (active === first || !inside) {
        e.preventDefault();
        last.focus();
      }
    } else if (active === last || !inside) {
      e.preventDefault();
      first.focus();
    }
  };

  const onScrimClick = (e: MouseEvent): void => {
    if (e.target === scrim) close();
  };

  function close(): void {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKeydown, true);
    if (scrim) scrim.removeEventListener('click', onScrimClick);
    onClose();
    // Return focus to the opener if it is still connected to the document.
    if (opener && opener.isConnected) opener.focus();
  }

  // Global (capture-phase) key handling so ESC/Tab are caught document-wide.
  document.addEventListener('keydown', onKeydown, true);
  if (scrim) scrim.addEventListener('click', onScrimClick);

  // Move focus into the dialog.
  const target = options.initialFocus ?? getFocusable(panel)[0] ?? panel;
  if (target === panel && !panel.hasAttribute('tabindex')) panel.setAttribute('tabindex', '-1');
  target.focus();

  return { close };
}
