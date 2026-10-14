/**
 * A small, accessible CONFIRM dialog (role="alertdialog") built on the shared
 * {@link openDialog} contract: focus moves in (to the safe "Cancel" choice),
 * Tab is trapped, Esc / scrim-click cancel, and focus returns to the opener.
 * Used before irreversible actions such as submitting a timed test.
 */
import { el } from './dom';
import { openDialog } from './dialog';

/** Options for {@link confirmDialog}. */
export interface ConfirmOptions {
  title: string;
  /** Body lines (each its own paragraph). */
  lines: string[];
  confirmLabel: string;
  cancelLabel?: string;
  /** Emphasise the body as a warning (e.g. unanswered questions). */
  warn?: boolean;
  onConfirm: () => void;
  onCancel?: () => void;
}

let seq = 0;

/** Open the confirm dialog; returns a function that closes it (as cancel). */
export function confirmDialog(opts: ConfirmOptions): () => void {
  seq += 1;
  const titleId = `confirm-title-${seq}`;
  const descId = `confirm-desc-${seq}`;
  let confirmed = false;

  const cancelBtn = el('button', { class: 'btn btn-secondary', type: 'button', text: opts.cancelLabel ?? 'Cancel' });
  const okBtn = el('button', { class: 'btn btn-primary', type: 'button', text: opts.confirmLabel });

  const panel = el('div', {
    class: opts.warn ? 'confirm-panel is-warn' : 'confirm-panel',
    attrs: { role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': titleId, 'aria-describedby': descId },
  }, [
    el('h2', { class: 'confirm-title', attrs: { id: titleId }, text: opts.title }),
    el('div', { class: 'confirm-body', attrs: { id: descId } }, opts.lines.map((l) => el('p', { text: l }))),
    el('div', { class: 'confirm-actions' }, [cancelBtn, okBtn]),
  ]);
  const scrim = el('div', { class: 'confirm-overlay' }, [panel]);
  document.body.append(scrim);

  const ctl = openDialog({
    panel,
    scrim,
    initialFocus: cancelBtn,
    onClose: () => {
      scrim.remove();
      if (confirmed) opts.onConfirm();
      else opts.onCancel?.();
    },
  });
  cancelBtn.addEventListener('click', () => ctl.close());
  okBtn.addEventListener('click', () => {
    confirmed = true;
    ctl.close();
  });
  return () => ctl.close();
}
