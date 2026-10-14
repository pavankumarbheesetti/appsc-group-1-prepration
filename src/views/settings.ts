/**
 * Settings / Data view (`#/settings`) — one place to control display and manage
 * the learner's data.
 *
 * Consolidates:
 *   - EXAM DATE — editable, persisted to `settings.examDate` (the SAME setting
 *     the Planner edits, so the two always agree);
 *   - THEME — light/dark segmented toggle, applied live to the document root;
 *   - FONT scale — A− / A+ within the same bounds the shell uses;
 *   - DATA — JSON export (download {@link exportStateJSON}), JSON import
 *     (file picker OR paste → {@link parseBackupJSON} full-schema validation, then a confirm + an
 *     inline error on bad data), and a guarded RESET ALL progress;
 *   - an "About" panel with app info + real content stats.
 *
 * All numbers/counts are REAL (derived from the loaded content). DOM-only; the
 * store/loader do the actual work.
 */
import { APP_NAME, DEFAULT_EXAM_DATE, EXAM_NOTIFICATION } from '../config';
import { getBanks, getSubtopics } from '../content/loader';
import {
  STATE_VERSION,
  exportStateJSON,
  getDailyStudyMinutes,
  getDaysOff,
  getExamDate,
  getPlanStartDate,
  getSundayStudyMinutes,
  addDayOff,
  removeDayOff,
  resetDaysOff,
  applyBackup,
  BackupError,
  NOT_A_BACKUP_MESSAGE,
  parseBackupJSON,
  type ParsedBackup,
  loadState,
  resetProgress,
  setDailyStudyMinutes,
  setExamDate,
  setPlanStartDate,
  setSundayStudyMinutes,
  STUDY_MINUTES_BOUNDS,
  studyMinutesError,
  updateState,
} from '../state/store';
import { addDaysISO, todayISO } from '../lib/dates';
import { el, mount } from './dom';
import { navigate } from '../router/router';
import { card } from './components/card';
import { button } from './components/button';
import { chip } from './components/chip';
import { icon } from './components/icon';
import { showToast } from './components/toast';
import { confirmDialog } from './confirm';

/** Font-scale bounds/step — mirror the shell's A−/A+ control. */
const FONT_MIN = 0.8;
const FONT_MAX = 1.6;
const FONT_STEP = 0.1;

/** Apply persisted theme + font scale to the document root (mirrors app shell). */
function applyDisplay(): void {
  const state = loadState();
  const doc = document.documentElement;
  doc.dataset.theme = state.settings.theme;
  doc.style.setProperty('--font-scale', String(state.settings.fontScale));
}

/** Render the Settings view into `root`. */
export function render(root: HTMLElement): void {
  const draw = (): void => {
    mount(root, buildAppearanceCard(draw), buildDisplayCard(draw), buildDataCard(draw), buildStartHereCard(), buildAboutCard());
  };
  draw();
}

/** A "New here?" card linking to the beginner Start-here guide. @internal */
function buildStartHereCard(): HTMLElement {
  return card({ title: 'Help' }, [
    el('p', { class: 'section-lead', text: 'The guide explains the exam, how your plan works, and how to study a topic — in plain language.' }),
    button({ label: 'How this app works', variant: 'secondary', iconName: 'arrow-right', onClick: () => navigate('/start') }),
  ]);
}

/**
 * Appearance — the ONE place for theme + text size (the top-bar `Aa` popover
 * is a shortcut to the same two settings). @internal
 */
function buildAppearanceCard(rerender: () => void): HTMLElement {
  return card({ title: 'Appearance' }, [themeField(rerender), fontField(rerender)]);
}

/* -------------------------------------------------------------------------- */
/* Display: exam date + theme + font                                          */
/* -------------------------------------------------------------------------- */

/** The display-settings card: exam date, study time, theme, font scale. @internal */
function buildDisplayCard(rerender: () => void): HTMLElement {
  return card({ title: 'Exam & schedule' }, [
    examDateField(rerender),
    planStartField(rerender),
    studyTimeField(rerender),
    sundayTimeField(rerender),
    daysOffField(rerender),
  ]);
}

/** Daily study-time budget presets (minutes) the planner fits the plan to. @internal */
const STUDY_PRESETS = [120, 180, 240, 300, 360] as const;

/** Format a whole-minute budget as a compact `Xh` / `Xh Ym` label. @internal */
function fmtHm(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/**
 * "Daily study time" control — preset hour chips (2h/3h/4h/5h/6h) + a custom
 * minutes input, persisted to `settings.dailyStudyMinutes`. Re-plans on change
 * (the caller redraws; the Planner/Today read the new budget live). @internal
 */
function studyTimeField(rerender: () => void): HTMLElement {
  const current = getDailyStudyMinutes();
  const seg = el('div', { class: 'seg', attrs: { role: 'group', 'aria-label': 'Daily study time' } });
  const set = (minutes: number): void => {
    setDailyStudyMinutes(minutes);
    rerender();
  };
  for (const preset of STUDY_PRESETS) {
    const active = preset === current;
    seg.append(
      el('button', {
        type: 'button',
        class: active ? 'seg-btn is-active' : 'seg-btn',
        text: fmtHm(preset),
        ariaLabel: `Study ${fmtHm(preset)} per day`,
        attrs: { 'aria-pressed': String(active) },
        onClick: () => set(preset),
      }),
    );
  }

  const custom = el('input', {
    class: 'study-custom-input',
    type: 'number',
    ariaLabel: 'Custom daily study minutes',
    attrs: {
      min: String(STUDY_MINUTES_BOUNDS.daily.min),
      max: String(STUDY_MINUTES_BOUNDS.daily.max),
      step: '15',
      placeholder: 'min',
      value: String(current),
      'aria-describedby': 'daily-minutes-error',
    },
  }) as HTMLInputElement;
  custom.value = String(current);
  // D21: out-of-range values are rejected with a plain message (never saved).
  const error = el('span', { class: 'settings-hint settings-error', attrs: { id: 'daily-minutes-error', role: 'alert' } });
  custom.addEventListener('change', () => {
    const minutes = Number(custom.value);
    const msg = custom.value.trim() === '' ? studyMinutesError('daily', Number.NaN) : studyMinutesError('daily', minutes);
    if (msg === null) {
      set(minutes);
      return;
    }
    error.textContent = msg;
    custom.setAttribute('aria-invalid', 'true');
    custom.value = String(getDailyStudyMinutes());
  });

  return el('label', { class: 'field settings-field' }, [
    el('span', { class: 'field-label', text: 'Daily study time' }),
    el('span', { class: 'settings-hint', text: `The plan is fitted to this budget — currently ${fmtHm(current)}/day. No day is scheduled beyond it.` }),
    el('div', { class: 'settings-field-row' }, [seg, custom]),
    error,
  ]);
}

/** Sunday study-time presets (minutes): 4h / 5h / 6h / 7h. @internal */
const SUNDAY_PRESETS = [240, 300, 360, 420] as const;

/**
 * "Sunday study time" control — preset hour chips (4h/5h/6h/7h) + a custom
 * minutes input, persisted to `settings.sundayStudyMinutes` (default 6 h).
 * Sunday is the one day the learner asked for extra time; Saturday is a mock day
 * and follows the daily budget, so it has no separate control. The extra Sunday
 * minutes lengthen the Sunday unit block (STANDARDS §8a). Re-plans on change. Accessible:
 * the chips are a labelled radio-style `role="group"` of `aria-pressed`
 * buttons, and the custom input carries an explicit `aria-label`. @internal
 */
function sundayTimeField(rerender: () => void): HTMLElement {
  const current = getSundayStudyMinutes();
  const seg = el('div', { class: 'seg', attrs: { role: 'group', 'aria-label': 'Sunday study time' } });
  const set = (minutes: number): void => {
    setSundayStudyMinutes(minutes);
    rerender();
  };
  for (const preset of SUNDAY_PRESETS) {
    const active = preset === current;
    seg.append(
      el('button', {
        type: 'button',
        class: active ? 'seg-btn is-active' : 'seg-btn',
        text: fmtHm(preset),
        ariaLabel: `Study ${fmtHm(preset)} on Sundays`,
        attrs: { 'aria-pressed': String(active) },
        onClick: () => set(preset),
      }),
    );
  }

  const custom = el('input', {
    class: 'study-custom-input',
    type: 'number',
    ariaLabel: 'Custom Sunday study minutes',
    attrs: {
      min: String(STUDY_MINUTES_BOUNDS.sunday.min),
      max: String(STUDY_MINUTES_BOUNDS.sunday.max),
      step: '15',
      placeholder: 'min',
      value: String(current),
      'aria-describedby': 'sunday-minutes-error',
    },
  }) as HTMLInputElement;
  custom.value = String(current);
  // D21: out-of-range values are rejected with a plain message (never saved).
  const error = el('span', { class: 'settings-hint settings-error', attrs: { id: 'sunday-minutes-error', role: 'alert' } });
  custom.addEventListener('change', () => {
    const minutes = Number(custom.value);
    const msg = custom.value.trim() === '' ? studyMinutesError('sunday', Number.NaN) : studyMinutesError('sunday', minutes);
    if (msg === null) {
      set(minutes);
      return;
    }
    error.textContent = msg;
    custom.setAttribute('aria-invalid', 'true');
    custom.value = String(getSundayStudyMinutes());
  });

  return el('label', { class: 'field settings-field' }, [
    el('span', { class: 'field-label', text: 'Sunday study time' }),
    el('span', {
      class: 'settings-hint',
      text: `Extra Sunday time lengthens Sunday\u2019s unit block (more of the current unit, plus its wrap-up when it ends) — currently ${fmtHm(current)} on Sundays. Saturday is a mock day and follows the daily budget.`,
    }),
    el('div', { class: 'settings-field-row' }, [seg, custom]),
    error,
  ]);
}

/**
 * "Days off" control — the learner's festival / holiday days (Diwali,
 * Sankranti, …). Each day off is a LIGHT day the planner caps at ≤ 60 min
 * (Current Affairs + flashcards only): no mock, no new topic. Shows the current
 * days as removable chips, an add-date input, and a "Reset to defaults" button.
 * Every edit re-plans (the caller redraws; Planner/Today read the new list
 * live). Persisted to `settings.daysOff` via the store accessors. @internal
 */
function daysOffField(rerender: () => void): HTMLElement {
  const days = getDaysOff();
  const chips =
    days.length > 0
      ? days.map((iso) =>
          el('span', { class: 'dayoff-chip' }, [
            el('span', { class: 'dayoff-chip-date', text: prettyDayOff(iso) }),
            el('button', {
              type: 'button',
              class: 'dayoff-chip-remove',
              ariaLabel: `Remove day off ${prettyDayOff(iso)}`,
              text: '\u00d7',
              onClick: () => {
                removeDayOff(iso);
                rerender();
              },
            }),
          ]),
        )
      : [el('span', { class: 'settings-hint', text: 'No days off — the plan runs every day.' })];

  const add = el('input', {
    class: 'exam-date-input',
    type: 'date',
    ariaLabel: 'Add a day off',
  }) as HTMLInputElement;
  add.addEventListener('change', () => {
    if (add.value) {
      addDayOff(add.value);
      rerender();
    }
  });

  const resetBtn = button({
    label: 'Reset to defaults',
    variant: 'ghost',
    onClick: () => {
      resetDaysOff();
      rerender();
    },
  });

  return el('div', { class: 'field settings-field' }, [
    el('span', { class: 'field-label', text: 'Days off' }),
    el('span', {
      class: 'settings-hint',
      text: 'Festivals and holidays become light days (≤ 60 min, Current Affairs + flashcards). No mock or new topic lands on a day off; mocks move to the next suitable day.',
    }),
    el('div', { class: 'dayoff-chips' }, chips),
    el('div', { class: 'settings-field-row' }, [add, resetBtn]),
  ]);
}

/** Format a day-off ISO date as e.g. `Sun 8 Nov 2026`. @internal */
function prettyDayOff(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dows = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  if (!y || !m || !d) return iso;
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${dows[dow]} ${d} ${months[m - 1]} ${y}`;
}

/** Days ahead below which a chosen exam date gets the "are you sure?" warning (D38). */
export const EXAM_DATE_WARN_DAYS = 30;

/** "24 Jan 2027" from an ISO date. @internal */
function shortPretty(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d} ${months[(m ?? 1) - 1]} ${y}`;
}

/**
 * The warning for a chosen exam date (D38): before today, or fewer than
 * {@link EXAM_DATE_WARN_DAYS} days away → the official-date reminder; else
 * `null`. PURE.
 */
export function examDateWarning(chosenISO: string, today: string = todayISO()): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(chosenISO)) return null;
  const days = Math.round((Date.parse(`${chosenISO}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (days >= EXAM_DATE_WARN_DAYS) return null;
  const when = days < 0 ? 'is in the past' : days === 0 ? 'is today' : `is only ${days} day${days === 1 ? '' : 's'} away`;
  return `${shortPretty(chosenISO)} ${when}. Prelims is officially ${shortPretty(DEFAULT_EXAM_DATE)} \u2014 are you sure?`;
}

/** Editable exam date (syncs `settings.examDate`, same as the Planner). @internal */
function examDateField(rerender: () => void): HTMLElement {
  const current = examDateWarning(getExamDate());
  const input = el('input', {
    class: 'exam-date-input',
    type: 'date',
    value: getExamDate(),
    ariaLabel: 'Target exam date',
    attrs: current ? { 'aria-describedby': 'exam-date-warning' } : {},
  }) as HTMLInputElement;
  input.value = getExamDate();
  const apply = (value: string): void => {
    const before = getExamDate();
    setExamDate(value);
    // Invalid/cleared input is a no-op in the store — restore the field.
    if (getExamDate() === before) input.value = before;
    rerender();
  };
  let asking = false;
  input.addEventListener('change', () => {
    const chosen = input.value;
    const warning = examDateWarning(chosen);
    if (!warning) {
      apply(chosen);
      return;
    }
    if (asking) return; // one confirm at a time (a repeated change event must not stack dialogs)
    asking = true;
    confirmDialog({
      title: 'Change the exam date?',
      lines: [warning, 'The whole plan is rebuilt around this date.'],
      confirmLabel: 'Yes, use this date',
      cancelLabel: 'Keep the current date',
      warn: true,
      onConfirm: () => {
        asking = false;
        apply(chosen);
      },
      onCancel: () => {
        asking = false;
        input.value = getExamDate();
      },
    });
  });
  return el('label', { class: 'field settings-field' }, [
    el('span', { class: 'field-label', text: 'Exam date' }),
    el('span', { class: 'settings-hint', text: 'Drives the Planner countdown and day-by-day plan.' }),
    input,
    current
      ? el('span', { class: 'settings-hint settings-warn', attrs: { id: 'exam-date-warning', role: 'status' }, text: current })
      : null,
  ]);
}

/** The plan-start input's `min`: the earlier of the current start and today (N17). */
export function planStartMin(currentStartISO: string, today: string): string {
  return currentStartISO < today ? currentStartISO : today;
}

/**
 * Editable PLAN START DATE control + a one-tap "Start my plan tomorrow" button.
 * The learner chooses when the plan begins: the date input is bounded to
 * [today, exam − 14 days]; the button sets it to tomorrow. Both persist to
 * `settings.planStartDate`, confirm with a toast and re-plan (the caller
 * redraws; Planner/Today read the new start live). Days before the start date
 * are free. Rendered as a non-`label` field so the button is not swallowed by a
 * wrapping label click. @internal
 */
function planStartField(rerender: () => void): HTMLElement {
  const today = todayISO();
  const maxStart = addDaysISO(getExamDate(), -14);
  const input = el('input', {
    class: 'exam-date-input',
    type: 'date',
    value: getPlanStartDate(),
    ariaLabel: 'Plan start date',
    // N17: the current (already past) start date must stay a VALID value.
    attrs: { min: planStartMin(getPlanStartDate(), today), max: maxStart },
  }) as HTMLInputElement;
  input.value = getPlanStartDate();
  input.addEventListener('change', () => {
    const before = getPlanStartDate();
    setPlanStartDate(input.value);
    // Invalid/cleared input is a no-op in the store — restore the field.
    if (getPlanStartDate() === before) {
      input.value = before;
      return;
    }
    showToast('Plan start updated \u2014 your plan has been re-planned', { tone: 'success' });
    rerender();
  });

  const startTomorrow = button({
    label: 'Start my plan tomorrow',
    variant: 'secondary',
    iconName: 'arrow-right',
    onClick: () => {
      setPlanStartDate(addDaysISO(todayISO(), 1));
      showToast('Your plan starts tomorrow \u2014 re-planned', { tone: 'success' });
      rerender();
    },
  });

  return el('div', { class: 'field settings-field' }, [
    el('span', { class: 'field-label', text: 'Plan start date' }),
    el('span', { class: 'settings-hint', text: 'Your progress is kept. Days before the start date are free.' }),
    el('div', { class: 'settings-field-row' }, [input, startTomorrow]),
  ]);
}

/** Light/dark segmented theme toggle, applied live. @internal */
function themeField(rerender: () => void): HTMLElement {
  const current = loadState().settings.theme;
  const seg = el('div', { class: 'seg', attrs: { role: 'group', 'aria-label': 'Theme' } });
  const set = (theme: 'light' | 'dark'): void => {
    updateState((s) => {
      s.settings.theme = theme;
    });
    applyDisplay();
    rerender();
  };
  (['light', 'dark'] as const).forEach((theme) => {
    const active = theme === current;
    seg.append(
      el('button', {
        type: 'button',
        class: active ? 'seg-btn is-active' : 'seg-btn',
        text: theme === 'light' ? 'Light' : 'Dark',
        ariaLabel: `Use ${theme} theme`,
        attrs: { 'aria-pressed': String(active) },
        onClick: () => set(theme),
      }),
    );
  });
  return el('div', { class: 'field settings-field field-row' }, [
    el('span', { class: 'field-label', text: 'Theme' }),
    seg,
  ]);
}

/** A− / value / A+ font-scale control. @internal */
function fontField(rerender: () => void): HTMLElement {
  const value = el('span', { class: 'seg-value tnum', text: `${Math.round(loadState().settings.fontScale * 100)}%` });
  const bump = (delta: number): void => {
    updateState((s) => {
      const raw = s.settings.fontScale + delta;
      s.settings.fontScale = Math.min(FONT_MAX, Math.max(FONT_MIN, Math.round(raw * 10) / 10));
    });
    applyDisplay();
    rerender();
  };
  const seg = el('div', { class: 'seg', attrs: { role: 'group', 'aria-label': 'Text size' } }, [
    el('button', { type: 'button', text: 'A\u2212', ariaLabel: 'Decrease text size', onClick: () => bump(-FONT_STEP) }),
    value,
    el('button', { type: 'button', text: 'A+', ariaLabel: 'Increase text size', onClick: () => bump(FONT_STEP) }),
  ]);
  return el('div', { class: 'field settings-field field-row' }, [
    el('span', { class: 'field-label', text: 'Text size' }),
    seg,
  ]);
}

/* -------------------------------------------------------------------------- */
/* Data: export / import / reset                                              */
/* -------------------------------------------------------------------------- */

/** The data-management card: export, import, reset. @internal */
function buildDataCard(rerender: () => void): HTMLElement {
  return card({ title: 'Your data', subtitle: 'Everything is stored on this device. Move it between devices with export / import.' }, [
    exportRow(),
    importRow(rerender),
    resetRow(rerender),
  ]);
}

/** Export the state as a downloaded JSON file. @internal */
function exportRow(): HTMLElement {
  const download = (): void => {
    const json = exportStateJSON();
    const stamp = todayISO();
    const filename = `appsc-g1-progress-${stamp}.json`;
    try {
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = el('a', { href: url, attrs: { download: filename } });
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      // Fallback for environments without Blob/createObjectURL: data URI.
      const a = el('a', {
        href: `data:application/json;charset=utf-8,${encodeURIComponent(json)}`,
        attrs: { download: filename },
      });
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
    showToast('Progress exported', { tone: 'success' });
  };
  return el('div', { class: 'settings-data-row' }, [
    el('div', { class: 'settings-data-text' }, [
      el('span', { class: 'settings-data-title', text: 'Export progress' }),
      el('span', { class: 'settings-hint', text: 'Download a JSON backup of all your progress and settings.' }),
    ]),
    button({ label: 'Export JSON', variant: 'secondary', iconName: 'arrow-right', onClick: download }),
  ]);
}

/**
 * The last import outcome, kept at module level so it SURVIVES the full
 * Settings redraw that follows a successful import (otherwise the
 * confirmation line was wiped by `rerender()` and the learner saw nothing).
 * @internal
 */
let lastImportStatus: { text: string; tone: 'ok' | 'warn' | 'err' } | null = null;

/** Human date for a backup's `exportedAt` (e.g. "14 Oct 2026"). @internal */
function backupDateLabel(iso: string | undefined): string {
  if (!iso) return 'an unknown date';
  const [y, m, d] = iso.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d} ${months[(m ?? 1) - 1]} ${y}`;
}

/**
 * Import state from a pasted blob or a chosen file. The WHOLE blob is
 * validated first ({@link parseBackupJSON}); anything that is not a complete
 * APPSC backup is rejected with "nothing was changed". A valid backup asks
 * for confirmation before it replaces the current progress. @internal
 */
function importRow(rerender: () => void): HTMLElement {
  const status = el('p', { class: 'settings-import-status', attrs: { role: 'status', 'aria-live': 'polite' } });
  const setStatus = (text: string, tone: 'ok' | 'warn' | 'err'): void => {
    status.textContent = text;
    status.className = `settings-import-status is-${tone}`;
  };
  if (lastImportStatus) setStatus(lastImportStatus.text, lastImportStatus.tone);
  lastImportStatus = null;
  const textarea = el('textarea', {
    class: 'settings-import-text',
    ariaLabel: 'Paste exported JSON here',
    attrs: { rows: '4', placeholder: 'Paste exported JSON here…' },
  }) as HTMLTextAreaElement;

  const applyImport = (raw: string): void => {
    const trimmed = raw.trim();
    if (trimmed === '') {
      setStatus('Nothing to import — paste JSON or choose a file first.', 'warn');
      return;
    }
    let backup: ParsedBackup;
    try {
      backup = parseBackupJSON(trimmed);
    } catch (err) {
      const detail = err instanceof BackupError ? err.detail : '';
      setStatus(detail ? `${NOT_A_BACKUP_MESSAGE} (${detail})` : NOT_A_BACKUP_MESSAGE, 'err');
      showToast("Not an APPSC backup — nothing was changed", { tone: 'error' });
      return;
    }
    const when = backupDateLabel(backup.exportedAt);
    const { studied, answered, tests } = backup.summary;
    confirmDialog({
      title: 'Replace your progress?',
      lines: [
        `Replace your current progress with this backup from ${when}? Current progress will be lost — export first?`,
        `The backup has ${studied} studied topic${studied === 1 ? '' : 's'}, ${answered} answered question${answered === 1 ? '' : 's'} and ${tests} finished test${tests === 1 ? '' : 's'}.`,
      ],
      confirmLabel: 'Replace my progress',
      cancelLabel: 'Cancel',
      warn: true,
      onConfirm: () => {
        applyBackup(backup);
        applyDisplay();
        lastImportStatus = { text: `Import successful — your progress from ${when} has been restored.`, tone: 'ok' };
        showToast('Progress imported', { tone: 'success' });
        // Redraw so exam date / theme / font fields reflect the imported values;
        // the status line is restored from `lastImportStatus`.
        rerender();
      },
      onCancel: () => setStatus('Import cancelled — nothing was changed.', 'warn'),
    });
  };

  const fileInput = el('input', {
    type: 'file',
    class: 'settings-file',
    ariaLabel: 'Choose a JSON file to import',
    attrs: { accept: 'application/json,.json' },
  }) as HTMLInputElement;
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    file
      .text()
      .then((text) => applyImport(text))
      .catch(() => setStatus('Import failed: could not read the selected file. Nothing was changed.', 'err'))
      .finally(() => {
        fileInput.value = '';
      });
  });

  return el('div', { class: 'settings-data-row settings-data-col' }, [
    el('div', { class: 'settings-data-text' }, [
      el('span', { class: 'settings-data-title', text: 'Import progress' }),
      el('span', { class: 'settings-hint', text: 'Restore from a backup: paste the JSON or choose a file. Anything that is not a complete APPSC backup is rejected and nothing is changed; you confirm before a backup replaces your progress.' }),
    ]),
    textarea,
    el('div', { class: 'settings-import-actions' }, [
      button({ label: 'Import pasted JSON', variant: 'secondary', onClick: () => applyImport(textarea.value) }),
      el('label', { class: 'btn btn-ghost settings-file-label' }, [
        icon('arrow-right', 18),
        el('span', { text: 'Choose file…' }),
        fileInput,
      ]),
    ]),
    status,
  ]);
}

/** Guarded "reset all progress" with a two-step confirm. @internal */
function resetRow(rerender: () => void): HTMLElement {
  const controls = el('div', { class: 'settings-reset-controls' });

  const renderIdle = (): void => {
    controls.replaceChildren(
      button({
        label: 'Reset all progress',
        variant: 'ghost',
        onClick: renderConfirm,
        ariaLabel: 'Reset all progress',
      }),
    );
  };

  const renderConfirm = (): void => {
    controls.replaceChildren(
      el('span', { class: 'settings-reset-warn', text: 'This permanently clears all progress. Your display settings and exam date are kept.' }),
      el('div', { class: 'settings-import-actions' }, [
        button({
          label: 'Yes, reset everything',
          variant: 'primary',
          onClick: () => {
            resetProgress();
            rerender();
          },
        }),
        button({ label: 'Cancel', variant: 'ghost', onClick: renderIdle }),
      ]),
    );
  };

  renderIdle();

  return el('div', { class: 'settings-data-row settings-data-col' }, [
    el('div', { class: 'settings-data-text' }, [
      el('span', { class: 'settings-data-title', text: 'Reset progress' }),
      el('span', { class: 'settings-hint', text: 'Clear all drills, reviews, notebook and writing practice. This cannot be undone.' }),
    ]),
    controls,
  ]);
}

/* -------------------------------------------------------------------------- */
/* About: app info + real content stats                                       */
/* -------------------------------------------------------------------------- */

/** Count MCQ / notes / mains items across every bank. @internal */
function contentStats(): { subtopics: number; mcqs: number; notes: number; mains: number } {
  let mcqs = 0;
  let notes = 0;
  let mains = 0;
  for (const { bank } of getBanks()) {
    if (bank.kind === 'mcq') mcqs += bank.items.length;
    else if (bank.kind === 'notes') notes += bank.items.length;
    else if (bank.kind === 'mains') mains += bank.items.length;
  }
  return { subtopics: getSubtopics().length, mcqs, notes, mains };
}

/** About panel: app info + real content stats. @internal */
function buildAboutCard(): HTMLElement {
  const s = contentStats();
  return card({ title: 'About', subtitle: `${APP_NAME} · offline single-file build` }, [
    el('div', { class: 'settings-about' }, [
      aboutStat(String(s.subtopics), 'subtopics'),
      aboutStat(String(s.mcqs), 'practice questions'),
      aboutStat(String(s.notes), 'note cards'),
      aboutStat(String(s.mains), 'mains prompts'),
    ]),
    el('div', { class: 'settings-about-meta' }, [
      chip({ text: `Data v${STATE_VERSION}`, tone: 'muted' }),
      chip({ text: `Notification ${EXAM_NOTIFICATION}`, tone: 'muted' }),
    ]),
  ]);
}

/** A single About stat tile. @internal */
function aboutStat(value: string, label: string): HTMLElement {
  return el('div', { class: 'settings-about-stat' }, [
    el('span', { class: 'settings-about-value tnum', text: value }),
    el('span', { class: 'settings-about-label', text: label }),
  ]);
}
