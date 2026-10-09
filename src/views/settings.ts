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
 *     (file picker OR paste → {@link importStateJSON} with validation + an
 *     inline error on bad data), and a guarded RESET ALL progress;
 *   - an "About" panel with app info + real content stats.
 *
 * All numbers/counts are REAL (derived from the loaded content). DOM-only; the
 * store/loader do the actual work.
 */
import { APP_NAME, EXAM_NOTIFICATION } from '../config';
import { getBanks, getSubtopics } from '../content/loader';
import {
  STATE_VERSION,
  exportStateJSON,
  getDailyStudyMinutes,
  getExamDate,
  getPlanStartDate,
  getSundayStudyMinutes,
  importStateJSON,
  loadState,
  resetProgress,
  setDailyStudyMinutes,
  setExamDate,
  setPlanStartDate,
  setSundayStudyMinutes,
  updateState,
} from '../state/store';
import { addDaysISO, todayISO } from '../lib/dates';
import { el, mount } from './dom';
import { card } from './components/card';
import { button } from './components/button';
import { chip } from './components/chip';
import { icon } from './components/icon';
import { showToast } from './components/toast';

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
    mount(root, buildDisplayCard(draw), buildDataCard(draw), buildAboutCard());
  };
  draw();
}

/* -------------------------------------------------------------------------- */
/* Display: exam date + theme + font                                          */
/* -------------------------------------------------------------------------- */

/** The display-settings card: exam date, study time, theme, font scale. @internal */
function buildDisplayCard(rerender: () => void): HTMLElement {
  return card({ title: 'Display & schedule' }, [
    examDateField(rerender),
    planStartField(rerender),
    studyTimeField(rerender),
    sundayTimeField(rerender),
    themeField(rerender),
    fontField(rerender),
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
    attrs: { min: '30', max: '720', step: '15', placeholder: 'min', value: String(current) },
  }) as HTMLInputElement;
  custom.value = String(current);
  custom.addEventListener('change', () => {
    const minutes = Number(custom.value);
    if (Number.isFinite(minutes) && minutes > 0) set(minutes);
    else custom.value = String(getDailyStudyMinutes());
  });

  return el('label', { class: 'field settings-field' }, [
    el('span', { class: 'field-label', text: 'Daily study time' }),
    el('span', { class: 'settings-hint', text: `The plan is fitted to this budget — currently ${fmtHm(current)}/day. No day is scheduled beyond it.` }),
    el('div', { class: 'settings-field-row' }, [seg, custom]),
  ]);
}

/** Sunday study-time presets (minutes): 4h / 5h / 6h / 7h. @internal */
const SUNDAY_PRESETS = [240, 300, 360, 420] as const;

/**
 * "Sunday study time" control — preset hour chips (4h/5h/6h/7h) + a custom
 * minutes input, persisted to `settings.sundayStudyMinutes` (default 6 h).
 * Sunday is the one day the learner asked for extra time; Saturday is a mock day
 * and follows the daily budget, so it has no separate control. The extra Sunday
 * minutes are spent on Polity + Modern History. Re-plans on change. Accessible:
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
    attrs: { min: '30', max: '720', step: '15', placeholder: 'min', value: String(current) },
  }) as HTMLInputElement;
  custom.value = String(current);
  custom.addEventListener('change', () => {
    const minutes = Number(custom.value);
    if (Number.isFinite(minutes) && minutes > 0) set(minutes);
    else custom.value = String(getSundayStudyMinutes());
  });

  return el('label', { class: 'field settings-field' }, [
    el('span', { class: 'field-label', text: 'Sunday study time' }),
    el('span', {
      class: 'settings-hint',
      text: `Extra Sunday time goes to Polity and Modern History — currently ${fmtHm(current)} on Sundays. Saturday is a mock day and follows the daily budget.`,
    }),
    el('div', { class: 'settings-field-row' }, [seg, custom]),
  ]);
}

/** Editable exam date (syncs `settings.examDate`, same as the Planner). @internal */
function examDateField(rerender: () => void): HTMLElement {
  const input = el('input', {
    class: 'exam-date-input',
    type: 'date',
    value: getExamDate(),
    ariaLabel: 'Target exam date',
  }) as HTMLInputElement;
  input.value = getExamDate();
  input.addEventListener('change', () => {
    const before = getExamDate();
    setExamDate(input.value);
    // Invalid/cleared input is a no-op in the store — restore the field.
    if (getExamDate() === before) input.value = before;
    rerender();
  });
  return el('label', { class: 'field settings-field' }, [
    el('span', { class: 'field-label', text: 'Exam date' }),
    el('span', { class: 'settings-hint', text: 'Drives the Planner countdown and day-by-day plan.' }),
    input,
  ]);
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
    attrs: { min: today, max: maxStart },
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
    const stamp = new Date().toISOString().slice(0, 10);
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

/** Import state from a pasted blob or a chosen file, with validation. @internal */
function importRow(rerender: () => void): HTMLElement {
  const status = el('p', { class: 'settings-import-status', attrs: { role: 'status', 'aria-live': 'polite' } });
  const textarea = el('textarea', {
    class: 'settings-import-text',
    ariaLabel: 'Paste exported JSON here',
    attrs: { rows: '4', placeholder: 'Paste exported JSON here…' },
  }) as HTMLTextAreaElement;

  const applyImport = (raw: string): void => {
    const trimmed = raw.trim();
    if (trimmed === '') {
      status.textContent = 'Nothing to import — paste JSON or choose a file first.';
      status.className = 'settings-import-status is-warn';
      return;
    }
    try {
      importStateJSON(trimmed);
      applyDisplay();
      status.textContent = 'Import successful — your progress has been restored.';
      status.className = 'settings-import-status is-ok';
      showToast('Progress imported', { tone: 'success' });
      // Redraw so exam date / theme / font fields reflect the imported values.
      rerender();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      status.textContent = `Import failed: ${msg}`;
      status.className = 'settings-import-status is-err';
      showToast('Import failed — check the JSON and try again', { tone: 'error' });
    }
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
      .catch(() => {
        status.textContent = 'Import failed: could not read the selected file.';
        status.className = 'settings-import-status is-err';
      });
  });

  return el('div', { class: 'settings-data-row settings-data-col' }, [
    el('div', { class: 'settings-data-text' }, [
      el('span', { class: 'settings-data-title', text: 'Import progress' }),
      el('span', { class: 'settings-hint', text: 'Restore from a backup: paste the JSON or choose a file. Bad data is rejected safely.' }),
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
