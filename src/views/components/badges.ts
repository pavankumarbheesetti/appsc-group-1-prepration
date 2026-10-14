/**
 * Taxonomy badges — the colour-coded priority BAND badge (A–D) and the mastery
 * STATUS chip, shared by the Syllabus tracker and the Learn workspace so the two
 * surfaces stay visually consistent.
 */
import { el } from '../dom';
import { chip, type ChipTone } from './chip';
import type { IconName } from './icon';
import type { Band } from '../../content/taxonomy';
import type { SubtopicStatus } from '../../lib/metrics';
import type { StudyStatus } from '../../lib/study-status';

/** Human label + chip tone + leading icon per mastery status. The icon (not
 * colour alone) distinguishes each status for WCAG 1.4.1 conformance. */
export const STATUS_META: Record<SubtopicStatus, { label: string; tone: ChipTone; iconName: IconName }> = {
  'not-started': { label: 'Not started', tone: 'muted', iconName: 'circle' },
  learning: { label: 'Learning', tone: 'warn', iconName: 'book-open' },
  revised: { label: 'Revised', tone: 'accent', iconName: 'revise' },
  mastered: { label: 'Mastered', tone: 'ok', iconName: 'check' },
};

/** Plain-language priority label per band (audit copy-rewrite: drop the letter). */
const BAND_LABEL: Record<Band, string> = {
  A: 'High-yield',
  B: 'Medium',
  C: 'Low',
  D: 'Low',
};

/** A colour-coded priority band badge shown as a plain-word pill + tooltip. */
export function bandBadge(band: Band): HTMLElement {
  const label = BAND_LABEL[band];
  return el('span', {
    class: `band-badge band-word band-${band.toLowerCase()}`,
    attrs: { title: `Exam priority: ${label}`, 'aria-label': `Exam priority: ${label}` },
  }, [el('span', { class: 'band-badge-letter', text: label })]);
}

/** A mastery-status chip (icon + label, not colour alone). */
export function statusChip(status: SubtopicStatus): HTMLElement {
  const meta = STATUS_META[status];
  return chip({ text: meta.label, tone: meta.tone, iconName: meta.iconName });
}

/**
 * The ONE study-status vocabulary (Not started / In progress / Studied ✓), from
 * `lib/study-status.ts` — the same status the planner, Today, Syllabus and
 * Progress count. Icon + label, never colour alone.
 */
export const STUDY_META: Record<StudyStatus, { label: string; tone: ChipTone; iconName: IconName }> = {
  'not-started': { label: 'Not started', tone: 'muted', iconName: 'circle' },
  'in-progress': { label: 'In progress', tone: 'warn', iconName: 'book-open' },
  studied: { label: 'Studied \u2713', tone: 'ok', iconName: 'check' },
};

/** A study-status chip (carries `data-study-status` for styling/tests). */
export function studyStatusChip(status: StudyStatus): HTMLElement {
  const meta = STUDY_META[status];
  const c = chip({ text: meta.label, tone: meta.tone, iconName: meta.iconName });
  c.classList.add('study-status-chip');
  c.setAttribute('data-study-status', status);
  return c;
}
