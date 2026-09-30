/**
 * Syllabus tracker — the primary PROGRESS surface for the whole syllabus.
 *
 * It renders the taxonomy as SUBJECT → CHAPTER → SUBTOPIC. Subjects and chapters
 * are COLLAPSIBLE and collapsed by default, each showing a truthful one-line
 * summary (e.g. "3/23 started · 1 mastered · 8% progress · 240 questions") so the
 * page stays calm and scannable; expanding a chapter reveals its subtopic rows.
 * Each row shows the subtopic name, a PROGRESS (mastery) bar, a colour-coded
 * status chip derived from the SAME mastery number, an A–D priority band badge,
 * and MCQ/Notes/Mains counts as plain pills (never a percentage). Rows are
 * ordered CHRONOLOGICALLY (syllabus/teaching order) by default, with a toggle to
 * re-sort by exam PRIORITY (band A + weakest first). Clicking a row opens the
 * subtopic's Learn workspace. The verified OFFICIAL syllabus wording is kept in
 * a collapsible reference section below.
 */
import { getSubtopic, getSubtopicCoverage, getSubjects, getSubtopics, getTaxonomy, getSyllabus, getAudit } from '../content/loader';
import type { TaxonomyChapter, TaxonomySubtopic } from '../content/taxonomy';
import { SUBJECTS, type SubjectCode } from '../content/types';
import {
  subtopicMasteryPct,
  statusFromMastery,
  type SubtopicStatus,
} from '../lib/metrics';
import { loadState } from '../state/store';
import { el, mount } from './dom';
import { icon } from './components/icon';
import { chip } from './components/chip';
import { progressBar } from './components/progress';
import { bandBadge, statusChip } from './components/badges';
import { openLearn } from './learn';

/** How rows within a chapter are ordered. */
type SortMode = 'order' | 'priority';

/* Module-scoped UI state, preserved across re-renders within a session. */
const expandedChapters = new Set<string>();
const expandedSubjects = new Set<string>();
/** DEFAULT sort is chronological (taxonomy `order`); Priority is the opt-in. */
let sortMode: SortMode = 'order';

/** A subtopic's taxonomy meta joined with its derived progress/status. @internal */
interface Row {
  meta: TaxonomySubtopic;
  notes: number;
  mcqs: number;
  mains: number;
  /** Distinct MCQs attempted at least once (drives "started"). */
  seen: number;
  /** Learner-progress percent (mastery), 0–100. */
  mastery: number;
  status: SubtopicStatus;
  /** Whether ANY material (notes/mcqs/mains) has been authored yet. */
  hasMaterial: boolean;
  /** Exam-point coverage (present only when the subtopic declares examPoints). */
  examCoverage?: { pct: number; covered: number; total: number };
}

/** Band → priority rank (A highest). Undefined bands sort last. @internal */
const BAND_RANK: Record<string, number> = { A: 0, B: 1, C: 2, D: 3 };
/** Status → weakness rank (weakest first). @internal */
const STATUS_RANK: Record<SubtopicStatus, number> = {
  'not-started': 0,
  learning: 1,
  revised: 2,
  mastered: 3,
};

/** Build the derived {@link Row} for a subtopic. @internal */
function rowFor(meta: TaxonomySubtopic): Row {
  const view = getSubtopic(meta.id);
  const notes = view?.notes.length ?? 0;
  const mcqs = view?.mcqs.length ?? 0;
  const mains = view?.mains.length ?? 0;
  const ids = view?.mcqs.map((m) => m.id) ?? [];
  const progress = loadState().progress;
  const seen = ids.reduce((n, id) => (progress[id] && progress[id].seen > 0 ? n + 1 : n), 0);
  const mastery = subtopicMasteryPct(progress, ids);
  const cov = getSubtopicCoverage(meta.id)?.examPoints;
  return {
    meta,
    notes,
    mcqs,
    mains,
    seen,
    mastery,
    status: statusFromMastery(mastery),
    hasMaterial: notes + mcqs + mains > 0,
    examCoverage: cov ? { pct: cov.pct, covered: cov.covered.length, total: cov.total } : undefined,
  };
}

/** Order rows by the active sort mode. @internal */
function sortRows(rows: Row[]): Row[] {
  const byOrder = (a: Row, b: Row): number => a.meta.order - b.meta.order;
  if (sortMode === 'order') return [...rows].sort(byOrder);
  return [...rows].sort((a, b) => {
    const band = (BAND_RANK[a.meta.band ?? ''] ?? 9) - (BAND_RANK[b.meta.band ?? ''] ?? 9);
    if (band !== 0) return band;
    const status = STATUS_RANK[a.status] - STATUS_RANK[b.status];
    if (status !== 0) return status;
    return byOrder(a, b);
  });
}

/** Aggregate truthful progress stats over a set of rows. @internal */
interface Summary {
  total: number;
  withMaterial: number;
  started: number;
  mastered: number;
  progress: number;
  questions: number;
}
function summarize(rows: Row[]): Summary {
  const total = rows.length;
  const withMaterial = rows.filter((r) => r.hasMaterial).length;
  const started = rows.filter((r) => r.seen > 0).length;
  const mastered = rows.filter((r) => r.status === 'mastered').length;
  const progress = total === 0 ? 0 : Math.round(rows.reduce((s, r) => s + r.mastery, 0) / total);
  const questions = rows.reduce((s, r) => s + r.mcqs, 0);
  return { total, withMaterial, started, mastered, progress, questions };
}

/**
 * The truthful one-line summary text for a subject/chapter. Leads with how many
 * subtopics actually have authored material (most don't yet), then mastery.
 * @internal
 */
function summaryText(sum: Summary): string {
  return `${sum.withMaterial}/${sum.total} have material · ${sum.mastered} mastered · ${sum.progress}% progress`;
}

/** Render the tracker into `root`. */
export function render(root: HTMLElement): void {
  const draw = (): void => {
    const intro = el('div', {}, [
      el('h2', { class: 'section-title', text: 'Syllabus tracker' }),
      el('p', { class: 'section-lead', text: 'Browse subjects → chapters → subtopics. Open any subtopic to learn, drill and revise it.' }),
      el('p', {
        class: 'track-legend',
        attrs: { role: 'note' },
      }, [
        icon('target', 14),
        el('span', { text: 'Progress = % of this topic\u2019s questions you\u2019ve answered correctly. Priority = High-yield / Medium / Low. Counts = questions/notes/mains available.' }),
      ]),
      buildSortBar(draw),
    ]);

    const subjects = getSubjects().map((subject) => buildSubject(subject.code, subject.name, draw));
    mount(root, intro, buildAudit(draw), ...subjects, buildOfficial(draw));
  };
  draw();
}

/** The Priority / Syllabus-order sort toggle. @internal */
function buildSortBar(rerender: () => void): HTMLElement {
  const makeChip = (label: string, value: SortMode): HTMLElement => {
    const c = chip({ text: label, tone: sortMode === value ? 'accent' : 'default' });
    c.setAttribute('role', 'button');
    c.setAttribute('tabindex', '0');
    c.style.cursor = 'pointer';
    const activate = (): void => {
      sortMode = value;
      rerender();
    };
    c.addEventListener('click', activate);
    c.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') {
        e.preventDefault();
        activate();
      }
    });
    return c;
  };
  return el('div', { class: 'filter-bar' }, [
    el('span', { class: 'filter-label', text: 'Sort:' }),
    makeChip('Chronological', 'order'),
    makeChip('Priority', 'priority'),
  ]);
}

/** Build one collapsible subject section. @internal */
function buildSubject(code: SubjectCode, name: string, rerender: () => void): HTMLElement {
  const chapters = getTaxonomy()
    .chapters.filter((c) => c.subjectCode === code)
    .sort((a, b) => a.order - b.order);
  const allRows = chapters.flatMap((c) => getSubtopics(code).filter((s) => s.chapterId === c.id).map(rowFor));
  const sum = summarize(allRows);
  const open = expandedSubjects.has(code);

  const body = el('div', { class: 'track-subject-body' }, chapters.map((c) => buildChapter(c, rerender)));
  if (!open) body.style.display = 'none';

  const summary = el('button', {
    class: 'track-subject-summary',
    type: 'button',
    attrs: { 'aria-expanded': String(open) },
    onClick: () => {
      if (expandedSubjects.has(code)) expandedSubjects.delete(code);
      else expandedSubjects.add(code);
      rerender();
    },
  }, [
    el('span', { class: 'chevron' }, [icon('chevron', 18)]),
    el('span', { class: 'track-subject-name', text: name }),
    el('span', { class: 'track-summary-stat', text: summaryText(sum) }),
  ]);

  const section = el('section', { class: open ? 'track-subject open' : 'track-subject' }, [summary, body]);
  return section;
}

/** Build one collapsible chapter section with its subtopic rows. @internal */
function buildChapter(chapter: TaxonomyChapter, rerender: () => void): HTMLElement {
  const rows = sortRows(getSubtopics(chapter.subjectCode).filter((s) => s.chapterId === chapter.id).map(rowFor));
  const sum = summarize(rows);
  const open = expandedChapters.has(chapter.id);

  const body = el('div', { class: 'track-chapter-body' }, rows.map(buildRow));
  if (!open) body.style.display = 'none';

  const summary = el('button', {
    class: 'track-chapter-summary',
    type: 'button',
    attrs: { 'aria-expanded': String(open) },
    onClick: () => {
      if (expandedChapters.has(chapter.id)) expandedChapters.delete(chapter.id);
      else expandedChapters.add(chapter.id);
      rerender();
    },
  }, [
    el('span', { class: 'chevron' }, [icon('chevron', 16)]),
    el('span', { class: 'track-chapter-name', text: chapter.name }),
    el('span', { class: 'track-summary-stat', text: summaryText(sum) }),
  ]);

  return el('section', { class: open ? 'track-chapter open' : 'track-chapter' }, [summary, body]);
}

/** Build one clickable subtopic row. @internal */
function buildRow(row: Row): HTMLElement {
  return el('button', {
    class: row.hasMaterial ? 'track-row' : 'track-row is-empty',
    type: 'button',
    ariaLabel: row.hasMaterial
      ? `${row.meta.name} — Progress ${row.mastery}%`
      : `${row.meta.name} — material coming soon`,
    onClick: () => openLearn(row.meta.id),
  }, [
    el('div', { class: 'track-row-main' }, [
      el('span', { class: 'track-row-name', text: row.meta.name }),
      el('div', { class: 'track-row-badges' }, [
        row.meta.band ? bandBadge(row.meta.band) : null,
        statusChip(row.status),
      ]),
    ]),
    el('div', { class: 'track-row-cov' }, [
      progressBar({ value: row.mastery / 100, label: 'Progress', caption: `${row.mastery}%`, success: row.mastery >= 100 }),
      row.examCoverage
        ? el('span', { class: 'track-row-coverage tnum', attrs: { title: 'Exam-point coverage' } }, [
            icon('target', 12),
            el('span', { text: `Coverage ${row.examCoverage.pct}% · ${row.examCoverage.covered}/${row.examCoverage.total} exam points` }),
          ])
        : null,
    ]),
    row.hasMaterial
      ? el('div', { class: 'track-row-counts' }, [
          countPill('drill', row.mcqs, 'MCQ'),
          countPill('notes', row.notes, 'Notes'),
          countPill('notebook', row.mains, 'Mains'),
        ])
      : el('div', { class: 'track-row-counts' }, [
          chip({ text: 'Material coming', tone: 'muted', iconName: 'timer' }),
        ]),
    el('span', { class: 'track-row-go' }, [icon('chevron', 16)]),
  ]);
}

/** A tiny icon + count pill. @internal */
function countPill(iconName: Parameters<typeof icon>[0], n: number, label: string): HTMLElement {
  return el('span', { class: n === 0 ? 'track-pill is-empty' : 'track-pill', attrs: { title: `${n} ${label}` } }, [
    icon(iconName, 14),
    el('span', { class: 'tnum', text: String(n) }),
  ]);
}

/** Human label per audit paper, for the compact in-app audit panel. @internal */
const AUDIT_PAPER_LABEL: Record<string, string> = {
  'prelims-1': 'Prelims Paper-I',
  'prelims-2': 'Prelims Paper-II',
  'mains-telugu': 'Mains Telugu (Q)',
  'mains-english': 'Mains English (Q)',
  'mains-1': 'Mains Paper-I (Essay)',
  'mains-2': 'Mains Paper-II',
  'mains-3': 'Mains Paper-III',
  'mains-4': 'Mains Paper-IV',
  'mains-5': 'Mains Paper-V',
};

/**
 * The collapsible "Syllabus audit" panel — an INDEPENDENT read of how well the
 * content covers the official syllabus and PYQs (computed at runtime by the same
 * shared pure `computeAudit` over the offline-bundled content — never the
 * authors' own examPoints). Shows per-paper traceability, PYQ hit %, AP share
 * per subject, and the actionable THIN/MISSING clause list. @internal
 */
function buildAudit(rerender: () => void): HTMLElement {
  const report = getAudit();
  const open = expandedSubjects.has('__audit__');

  // Per-paper traceability, each as a labelled progress meter.
  const paperRows = report.papers.map((p) =>
    el('div', { class: 'audit-paper-row' }, [
      progressBar({
        value: p.pct / 100,
        label: AUDIT_PAPER_LABEL[p.paper] ?? p.paper,
        caption: `${p.pct}%`,
        success: p.pct >= 100,
      }),
      el('span', {
        class: 'audit-paper-detail',
        text: `${p.covered}/${p.total} covered · ${p.thin} thin · ${p.missing} missing`,
      }),
    ]),
  );

  // PYQ evidence summary.
  const pyqLine = el('p', { class: 'audit-line' }, [
    icon('target', 14),
    el('span', {
      text:
        `PYQ evidence: ${report.pyq.hitPct}% hit — ` +
        `${report.pyq.hit} hit · ${report.pyq.near} near · ${report.pyq.miss} miss ` +
        `of ${report.pyq.total} tracked topics.`,
    }),
  ]);

  // AP share per subject as compact chips, each showing 'actual / target'
  // (tone flags whether the subject sits at or above its AP-share floor).
  const apChips = el('div', { class: 'audit-ap-chips' }, report.apShareBySubject.map((a) => {
    const label =
      a.target === null
        ? `${SUBJECTS[a.subject]}: ${a.pct}% AP`
        : `${SUBJECTS[a.subject]}: ${a.pct}% / ${a.target}% AP`;
    const tone = a.target === null ? 'default' : a.meetsTarget ? 'ok' : 'danger';
    return chip({ text: label, tone });
  }));

  // THIN/MISSING clause list — the actionable gaps (or a clean-bill chip).
  const gaps = report.thinMissing.length === 0
    ? el('div', { class: 'audit-gaps' }, [chip({ text: 'All clauses covered', tone: 'ok', iconName: 'check' })])
    : el('ul', { class: 'audit-gaps-list' }, report.thinMissing.map((c) =>
        el('li', { class: 'audit-gap' }, [
          chip({ text: c.status, tone: c.status === 'MISSING' ? 'danger' : 'warn' }),
          el('span', { class: 'audit-gap-ref', text: `${c.ref} · ${AUDIT_PAPER_LABEL[c.paper] ?? c.paper}` }),
          el('span', { class: 'audit-gap-clause', text: c.clause }),
        ]),
      ));

  const body = el('div', { class: 'audit-body' }, [
    el('p', { class: 'section-lead', text: 'Independent coverage check — measured against the official syllabus (Notification 07/2026) and past-year questions, offline.' }),
    el('h3', { class: 'audit-subhead', text: 'Per-paper traceability' }),
    ...paperRows,
    el('h3', { class: 'audit-subhead', text: 'Past-year questions' }),
    pyqLine,
    el('h3', { class: 'audit-subhead', text: 'AP share per subject' }),
    apChips,
    el('h3', { class: 'audit-subhead', text: 'Thin / missing clauses' }),
    gaps,
  ]);
  if (!open) body.style.display = 'none';

  const prelims = report.prelimsTraceabilityPct;
  const summary = el('button', {
    class: 'syll-summary',
    type: 'button',
    attrs: { 'aria-expanded': String(open) },
    onClick: () => {
      if (expandedSubjects.has('__audit__')) expandedSubjects.delete('__audit__');
      else expandedSubjects.add('__audit__');
      rerender();
    },
  }, [
    el('span', { class: 'chevron' }, [icon('chevron', 18)]),
    el('span', { text: 'Syllabus audit' }),
    el('span', { class: 'count-pill', text: `Prelims ${prelims}% traceable · PYQ ${report.pyq.hitPct}% hit` }),
  ]);

  return el('section', { class: open ? 'syll-section open' : 'syll-section', attrs: { style: 'margin-top:var(--space-4)' } }, [summary, body]);
}

/** The collapsible "Official syllabus" reference (verified wording). @internal */
function buildOfficial(rerender: () => void): HTMLElement {
  const { nodes, meta } = getSyllabus();
  const open = expandedSubjects.has('__official__');
  const body = el('div', { class: 'syll-body' }, nodes.map((node) =>
    el('div', { class: 'syll-node' }, [
      el('div', { class: 'syll-node-head' }, [
        el('span', { class: 'syll-serial', text: String(node.serial) }),
        el('span', { class: 'syll-node-title', text: node.title }),
        chip({ text: SUBJECTS[node.subjectCode], tone: 'default' }),
      ]),
      el('p', { class: 'syll-node-text', text: node.text }),
    ]),
  ));
  if (!open) body.style.display = 'none';

  const summary = el('button', {
    class: 'syll-summary',
    type: 'button',
    attrs: { 'aria-expanded': String(open) },
    onClick: () => {
      if (expandedSubjects.has('__official__')) expandedSubjects.delete('__official__');
      else expandedSubjects.add('__official__');
      rerender();
    },
  }, [
    el('span', { class: 'chevron' }, [icon('chevron', 18)]),
    el('span', { text: 'Official syllabus' }),
    el('span', { class: 'count-pill', text: `${nodes.length} node(s) · ${meta.notificationNo} ${meta.verified ? 'verified' : 'unverified'}` }),
  ]);

  return el('section', { class: open ? 'syll-section open' : 'syll-section', attrs: { style: 'margin-top:var(--space-5)' } }, [summary, body]);
}
