/**
 * "Telugu from scratch" COURSE — a tracing-first, from-zero path to reading and
 * writing Telugu for a learner who cannot yet read the script (route `#/telugu`).
 *
 * The course is a sequence of STAGES (Intro → Vowels → Consonants → Gunintalu →
 * Vattulu → Numbers → Words → Sentences). Each letter/word is a CARD with:
 *   - the large glyph + its name, transliteration and a plain-English hint;
 *   - a "Hear it" button using the Web Speech API (`speechSynthesis`, lang
 *     `te-IN`) that gracefully no-ops (with a tooltip) where no synthesis /
 *     Telugu voice exists — it never throws;
 *   - a TRACING canvas that renders the target glyph faintly as a guide and lets
 *     the learner trace over it with pointer/mouse/touch, with Clear + a
 *     hide-guide toggle for freehand practice;
 *   - a "Mark learned" toggle persisted per-glyph to `state.telugu`.
 *
 * All progress maths is delegated to the PURE helpers in `src/lib/telugu.ts`;
 * only the canvas + audio (inherently browser-only) live here, each carefully
 * guarded so the view renders safely under jsdom / offline `file://`.
 *
 * OFFLINE NOTE: no web fonts are fetched. Glyphs and the tracing guide rely on
 * the system Telugu font (e.g. "Noto Sans Telugu" / "Telugu Sangam MN"); if a
 * device lacks one, text still renders via the sans-serif fallback. A bundled
 * Telugu webfont could improve fidelity but is intentionally NOT fetched from a
 * CDN (would break the single-file offline guarantee).
 */
import {
  CONSONANTS,
  GUNINTALU,
  GUNINTALU_BASE,
  GUNINTALU_EXPLANATION,
  NUMBERS,
  STARTER_SENTENCES,
  STARTER_WORDS,
  TELUGU_INTRO,
  VATTULU,
  VATTULU_EXPLANATION,
  VOWELS,
  type TeluguStage,
} from '../content/telugu';
import { courseTally, stageTally } from '../lib/telugu';
import { navigate } from '../router/router';
import { getTeluguProgress, isTeluguLearned, toggleTeluguLearned } from '../state/store';
import { el, mount, renderMarkdown, type Child } from './dom';
import { card } from './components/card';
import { button } from './components/button';
import { chip } from './components/chip';
import { icon } from './components/icon';
import { progressBar } from './components/progress';

/* -------------------------------------------------------------------------- */
/* Stage definitions                                                           */
/* -------------------------------------------------------------------------- */

/** Presentation metadata for one stage tab. */
interface StageDef {
  id: TeluguStage;
  /** Short English label for the stage nav. */
  label: string;
  /** The Telugu term for this concept (shown as an eyebrow). */
  teluguLabel: string;
  /** One-line description shown atop the stage. */
  blurb: string;
}

/** The stages in strict teaching order. */
const STAGES: readonly StageDef[] = [
  { id: 'intro', label: 'Intro', teluguLabel: 'తెలుగు', blurb: 'How the Telugu writing system works — read this first.' },
  { id: 'vowels', label: 'Vowels', teluguLabel: 'అచ్చులు', blurb: 'The independent vowels and the sign (maatra) each one adds to a consonant.' },
  { id: 'consonants', label: 'Consonants', teluguLabel: 'హల్లులు', blurb: 'The 36 consonants — each already carries a built-in "a".' },
  { id: 'gunintalu', label: 'Gunintalu', teluguLabel: 'గుణింతాలు', blurb: 'How one consonant (క) combines with every vowel to make its family.' },
  { id: 'vattulu', label: 'Vattulu', teluguLabel: 'వత్తులు', blurb: 'Conjuncts — a second consonant written as a subscript.' },
  { id: 'numbers', label: 'Numbers', teluguLabel: 'అంకెలు', blurb: 'The Telugu digits 0–9 and their names.' },
  { id: 'words', label: 'Words', teluguLabel: 'పదాలు', blurb: 'Read, hear and trace simple everyday words.' },
  { id: 'sentences', label: 'Sentences', teluguLabel: 'వాక్యాలు', blurb: 'Put it together — trace full sentences toward exam writing.' },
];

/* -------------------------------------------------------------------------- */
/* Web Speech API (audio) — carefully guarded, never throws                    */
/* -------------------------------------------------------------------------- */

/** True when the browser exposes usable speech synthesis. @internal */
function synthesisAvailable(): boolean {
  try {
    return (
      typeof globalThis.speechSynthesis !== 'undefined' &&
      globalThis.speechSynthesis !== null &&
      typeof globalThis.SpeechSynthesisUtterance === 'function'
    );
  } catch {
    return false;
  }
}

/**
 * Speak `text` in Telugu (`te-IN`) using the Web Speech API. A pure progressive
 * enhancement: if synthesis is unavailable — or anything throws — it silently
 * no-ops. Prefers an installed Telugu voice when the platform exposes one.
 * @internal
 */
function speakTelugu(text: string): void {
  try {
    const synth = globalThis.speechSynthesis;
    if (!synth || typeof globalThis.SpeechSynthesisUtterance !== 'function') return;
    synth.cancel(); // stop any queued utterance so taps feel responsive
    const utter = new globalThis.SpeechSynthesisUtterance(text);
    utter.lang = 'te-IN';
    utter.rate = 0.85; // a touch slower for a first-time learner
    const voices = synth.getVoices ? synth.getVoices() : [];
    const telugu = voices.find((v) => typeof v.lang === 'string' && v.lang.toLowerCase().startsWith('te'));
    if (telugu) utter.voice = telugu;
    synth.speak(utter);
  } catch {
    /* no-op: audio is optional and must never break the course */
  }
}

/* -------------------------------------------------------------------------- */
/* Tracing canvas — guide glyph + freehand, guarded for jsdom (ctx may be null) */
/* -------------------------------------------------------------------------- */

/** A single traced point in canvas pixel space. @internal */
interface Point {
  x: number;
  y: number;
}

/** Resolve the accent stroke colour from CSS tokens (with a safe fallback). @internal */
function accentColor(): string {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    return v || '#4a5ae0';
  } catch {
    return '#4a5ae0';
  }
}

/**
 * Build a tracing canvas for `glyph` plus its controls (Clear + hide-guide) and
 * a short how-to hint. Strokes are captured with pointer events (mouse, touch
 * and stylus) and drawn in the accent colour over a faint grey guide glyph.
 *
 * The 2D context is optional: under jsdom `getContext` returns `null`, so every
 * draw path is guarded and the control still renders (and never throws).
 * @internal
 */
function buildTracer(glyph: string, howTo: string): HTMLElement {
  const SIZE = 240;
  const canvas = el('canvas', {
    class: 'tel-canvas',
    attrs: {
      width: String(SIZE),
      height: String(SIZE),
      role: 'img',
      'aria-label': `Tracing area for ${glyph}`,
    },
  }) as HTMLCanvasElement;

  // `getContext` exists on the prototype but has no backend under jsdom (it
  // logs a "not implemented" notice and returns undefined). Skip it there so the
  // control still renders cleanly; guard everything so it can never throw.
  let ctx: CanvasRenderingContext2D | null = null;
  const isJsdom = typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent);
  if (!isJsdom) {
    try {
      ctx = canvas.getContext ? canvas.getContext('2d') : null;
    } catch {
      ctx = null;
    }
  }
  const strokes: Point[][] = [];
  let drawing = false;
  let showGuide = true;

  const redraw = (): void => {
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (showGuide) {
      ctx.save();
      ctx.fillStyle = 'rgba(120,126,147,0.28)'; // light grey guide (theme-neutral)
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `${Math.round(SIZE * 0.6)}px "Noto Sans Telugu", "Telugu Sangam MN", "Gautami", system-ui, sans-serif`;
      ctx.fillText(glyph, SIZE / 2, SIZE / 2);
      ctx.restore();
    }
    ctx.save();
    ctx.strokeStyle = accentColor();
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const stroke of strokes) {
      const first = stroke[0];
      if (!first) continue;
      ctx.beginPath();
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < stroke.length; i += 1) {
        const p = stroke[i];
        if (p) ctx.lineTo(p.x, p.y);
      }
      if (stroke.length === 1) ctx.lineTo(first.x + 0.1, first.y + 0.1); // a dot
      ctx.stroke();
    }
    ctx.restore();
  };

  const toCanvas = (e: PointerEvent): Point => {
    const rect = canvas.getBoundingClientRect();
    const sx = rect.width ? canvas.width / rect.width : 1;
    const sy = rect.height ? canvas.height / rect.height : 1;
    return { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy };
  };

  canvas.addEventListener('pointerdown', (e) => {
    drawing = true;
    strokes.push([toCanvas(e)]);
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* setPointerCapture unsupported (jsdom) — ignore */
    }
    redraw();
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    const cur = strokes[strokes.length - 1];
    if (!cur) return;
    cur.push(toCanvas(e));
    redraw();
    e.preventDefault();
  });
  const stop = (): void => {
    drawing = false;
  };
  canvas.addEventListener('pointerup', stop);
  canvas.addEventListener('pointercancel', stop);
  canvas.addEventListener('pointerleave', stop);

  redraw();

  const clearBtn = button({
    label: 'Clear',
    variant: 'ghost',
    iconName: 'x',
    ariaLabel: `Clear the tracing for ${glyph}`,
    onClick: () => {
      strokes.length = 0;
      redraw();
    },
  });

  const guideBtn = button({
    label: 'Hide guide',
    variant: 'ghost',
    ariaLabel: 'Hide the faint guide glyph to practise freehand',
    onClick: () => {
      showGuide = !showGuide;
      guideBtn.firstChild?.replaceWith(document.createTextNode(showGuide ? 'Hide guide' : 'Show guide'));
      guideBtn.setAttribute('aria-pressed', String(!showGuide));
      redraw();
    },
  });
  guideBtn.setAttribute('aria-pressed', 'false');

  return el('div', { class: 'tel-tracer' }, [
    el('div', { class: 'tel-canvas-wrap' }, [canvas]),
    el('p', { class: 'tel-howto' }, [icon('target', 14), el('span', { text: howTo })]),
    el('div', { class: 'tel-trace-actions' }, [clearBtn, guideBtn]),
  ]);
}

/* -------------------------------------------------------------------------- */
/* Glyph card                                                                  */
/* -------------------------------------------------------------------------- */

/** Everything a single glyph/word card needs. @internal */
interface CardSpec {
  /** Stable progress id. */
  id: string;
  /** The big glyph shown + traced + spoken. */
  glyph: string;
  /** Roman transliteration. */
  translit: string;
  /** Primary label (letter name, or the word/sentence meaning line). */
  title: string;
  /** Optional secondary hint (pronunciation / meaning). */
  hint?: string;
  /** Extra note rendered under the meta (e.g. how a conjunct forms). */
  note?: string;
  /** Text spoken by "Hear it" (defaults to the glyph). */
  speak?: string;
  /** The tracing how-to hint. */
  howTo: string;
  /** Called after the learned flag toggles, to refresh progress chrome. */
  onToggle: () => void;
}

/** Build one glyph card (glyph + meta + audio + tracing + mark-learned). @internal */
function glyphCard(spec: CardSpec): HTMLElement {
  const learned = isTeluguLearned(spec.id);
  const root = el('article', {
    class: learned ? 'tel-card is-learned' : 'tel-card',
    attrs: { 'data-glyph-id': spec.id },
  });

  const glyphEl = el('div', { class: 'tel-glyph', attrs: { lang: 'te', 'aria-hidden': 'false' }, text: spec.glyph });

  const meta = el('div', { class: 'tel-meta' }, [
    el('span', { class: 'tel-translit', text: spec.translit }),
    el('span', { class: 'tel-name', attrs: { lang: 'te' }, text: spec.title }),
    spec.hint ? el('span', { class: 'tel-hint', text: spec.hint }) : null,
    spec.note ? el('span', { class: 'tel-note', text: spec.note }) : null,
  ]);

  // "Hear it" — disabled with a tooltip when no synthesis exists.
  const canSpeak = synthesisAvailable();
  const hearBtn = button({
    label: 'Hear it',
    variant: 'secondary',
    iconName: 'sparkles',
    ariaLabel: `Hear ${spec.translit} pronounced`,
    onClick: () => speakTelugu(spec.speak ?? spec.glyph),
  });
  if (!canSpeak) {
    hearBtn.setAttribute('disabled', 'true');
    hearBtn.setAttribute('title', 'Audio is not available on this device');
    hearBtn.classList.add('is-disabled');
  }

  // "Mark learned" toggle — persists per-glyph and refreshes progress chrome.
  const markBtn = button({
    label: learned ? 'Learned' : 'Mark learned',
    variant: learned ? 'primary' : 'ghost',
    iconName: 'check',
    onClick: () => {
      const now = toggleTeluguLearned(spec.id);
      root.classList.toggle('is-learned', now);
      markBtn.classList.toggle('btn-primary', now);
      markBtn.classList.toggle('btn-ghost', !now);
      markBtn.setAttribute('aria-pressed', String(now));
      markBtn.firstChild?.replaceWith(document.createTextNode(now ? 'Learned' : 'Mark learned'));
      spec.onToggle();
    },
  });
  markBtn.setAttribute('aria-pressed', String(learned));

  root.append(
    el('div', { class: 'tel-card-head' }, [glyphEl, meta]),
    buildTracer(spec.glyph, spec.howTo),
    el('div', { class: 'tel-card-actions' }, [hearBtn, markBtn]),
  );
  return root;
}

/* -------------------------------------------------------------------------- */
/* View                                                                        */
/* -------------------------------------------------------------------------- */

/** A pending stage to open, set by {@link openTelugu}. @internal */
let pendingStage: TeluguStage | undefined;

/** Open the Telugu course, optionally at a specific stage. */
export function openTelugu(stage?: TeluguStage): void {
  pendingStage = stage;
  navigate('/telugu');
}

/** Render the Telugu course into `root`. */
export function render(root: HTMLElement): void {
  let active: TeluguStage = pendingStage ?? 'intro';
  pendingStage = undefined;

  // Stable hosts whose children are swapped on stage change / progress change.
  const summaryHost = el('div', { class: 'tel-summary-host' });
  const navHost = el('nav', { class: 'tel-stagenav', ariaLabel: 'Course stages' });
  const panelHost = el('div', { class: 'tel-panel' });

  /** Rebuild the course-progress summary + the stage nav (cheap, no canvases). */
  const refreshChrome = (): void => {
    const progress = getTeluguProgress();
    const course = courseTally(progress);
    summaryHost.replaceChildren(
      card({ class: 'tel-summary' }, [
        el('div', { class: 'tel-summary-top' }, [
          el('div', {}, [
            el('h2', { class: 'card-title', text: 'Telugu from scratch' }),
            el('p', { class: 'section-lead', text: 'A tracing-first path from the script up to writing full sentences.' }),
          ]),
          chip({ text: `${course.stagesComplete}/${STAGES.length - 1} stages`, tone: 'accent', iconName: 'target' }),
        ]),
        progressBar({
          value: course.total === 0 ? 0 : course.learned / course.total,
          label: 'Glyphs learned',
          caption: `${course.learned}/${course.total}`,
          success: course.total > 0 && course.learned === course.total,
        }),
      ]),
    );

    navHost.replaceChildren(
      ...STAGES.map((s, i) => {
        const tally = stageTally(progress, s.id);
        const isActive = s.id === active;
        const btn = el('button', {
          class: isActive ? 'tel-stage-btn is-active' : 'tel-stage-btn',
          type: 'button',
          attrs: { 'aria-current': isActive ? 'step' : 'false' },
          onClick: () => select(s.id),
        }, [
          el('span', { class: 'tel-stage-idx tnum', text: String(i + 1) }),
          el('span', { class: 'tel-stage-label', text: s.label }),
          tally.total > 0
            ? el('span', {
                class: tally.complete ? 'tel-stage-count is-complete tnum' : 'tel-stage-count tnum',
                text: `${tally.learned}/${tally.total}`,
              })
            : null,
        ]);
        return btn;
      }),
    );
  };

  /** Rebuild the active stage's panel (recreates cards + canvases). */
  const drawPanel = (): void => {
    panelHost.replaceChildren(buildStagePanel(active, refreshChrome));
  };

  const select = (stage: TeluguStage): void => {
    active = stage;
    refreshChrome();
    drawPanel();
    root.scrollTo?.({ top: 0, behavior: 'smooth' });
  };

  refreshChrome();
  drawPanel();
  mount(root, el('div', { class: 'tel-course' }, [summaryHost, navHost, panelHost]));
}

/** Build the panel for one stage. @internal */
function buildStagePanel(stage: TeluguStage, onToggle: () => void): HTMLElement {
  const def = STAGES.find((s) => s.id === stage)!;
  const header = el('header', { class: 'tel-stage-head' }, [
    el('span', { class: 'tel-stage-eyebrow', attrs: { lang: 'te' }, text: def.teluguLabel }),
    el('h3', { class: 'tel-stage-title', text: def.label }),
    el('p', { class: 'section-lead', text: def.blurb }),
  ]);

  const body = stage === 'intro' ? buildIntro() : buildGrid(stage, onToggle);
  return el('section', { class: 'tel-stage' }, [header, body]);
}

/** The intro stage: prose + a "start with vowels" CTA. @internal */
function buildIntro(): HTMLElement {
  const article = el('div', { class: 'tel-intro note-body' }, renderMarkdown(TELUGU_INTRO.join('\n\n')));
  return el('div', { class: 'reading' }, [
    el('div', { class: 'card tel-intro-card' }, [article]),
  ]);
}

/** Build the card grid for a trackable stage. @internal */
function buildGrid(stage: TeluguStage, onToggle: () => void): HTMLElement {
  const cards = stageCards(stage, onToggle);
  const grid = el('div', { class: 'tel-grid' }, cards);
  // Gunintalu and Vattulu carry an explanatory note above the grid.
  const extras: Child[] = [];
  if (stage === 'gunintalu') {
    extras.push(explainer(`The gunintam of ${GUNINTALU_BASE.glyph} (${GUNINTALU_BASE.translit})`, GUNINTALU_EXPLANATION));
  } else if (stage === 'vattulu') {
    extras.push(explainer('How conjuncts (vattulu) form', VATTULU_EXPLANATION));
  }
  return el('div', { class: 'tel-stage-body' }, [...extras, grid]);
}

/** A short explainer callout. @internal */
function explainer(title: string, body: string): HTMLElement {
  return el('aside', { class: 'tel-explainer', attrs: { 'aria-label': title } }, [
    el('p', { class: 'tel-explainer-title' }, [icon('book-open', 16), el('span', { text: title })]),
    el('p', { class: 'tel-explainer-body', text: body }),
  ]);
}

/** Build the glyph cards for a trackable stage. @internal */
function stageCards(stage: TeluguStage, onToggle: () => void): HTMLElement[] {
  switch (stage) {
    case 'vowels':
      return VOWELS.map((v) =>
        glyphCard({
          id: v.id,
          glyph: v.glyph,
          translit: v.translit,
          title: v.name,
          hint: v.pronounceHint,
          note: v.matra ? `As a sign on a consonant: ${v.matra}` : 'Inherent sound — no sign needed',
          howTo: 'Trace the vowel following the grey guide, then hide the guide and write it from memory.',
          onToggle,
        }),
      );
    case 'consonants':
      return CONSONANTS.map((c) =>
        glyphCard({
          id: c.id,
          glyph: c.glyph,
          translit: c.translit,
          title: c.name,
          hint: c.pronounceHint,
          howTo: 'Trace the consonant over the guide. Remember it already includes the "a" sound.',
          onToggle,
        }),
      );
    case 'gunintalu':
      return GUNINTALU.map((g) =>
        glyphCard({
          id: g.id,
          glyph: g.glyph,
          translit: g.translit,
          title: `${GUNINTALU_BASE.glyph} + ${g.vowel}`,
          hint: `${GUNINTALU_BASE.translit.replace(/a$/, '')} with the "${g.vowel}" sound`,
          howTo: 'Trace the syllable, noticing where the vowel sign attaches to the consonant.',
          onToggle,
        }),
      );
    case 'vattulu':
      return VATTULU.map((x) =>
        glyphCard({
          id: x.id,
          glyph: x.glyph,
          translit: x.translit,
          title: `${x.example} — ${x.meaning}`,
          hint: `example: ${x.exampleTranslit}`,
          note: x.explanation,
          speak: x.example,
          howTo: 'Trace the cluster, then trace the whole example word to feel how the subscript sits below.',
          onToggle,
        }),
      );
    case 'numbers':
      return NUMBERS.map((n) =>
        glyphCard({
          id: n.id,
          glyph: n.glyph,
          translit: String(n.value),
          title: n.name,
          hint: `${n.value} — ${n.translit}`,
          speak: n.name,
          howTo: 'Trace the digit over the guide, then write it freehand.',
          onToggle,
        }),
      );
    case 'words':
      return STARTER_WORDS.map((w) =>
        glyphCard({
          id: w.id,
          glyph: w.glyph,
          translit: w.translit,
          title: w.meaning,
          hint: 'Read it, hear it, then trace the whole word.',
          speak: w.glyph,
          howTo: 'Trace the whole word left to right, keeping letters evenly spaced.',
          onToggle,
        }),
      );
    case 'sentences':
      return STARTER_SENTENCES.map((s) =>
        glyphCard({
          id: s.id,
          glyph: s.glyph,
          translit: s.translit,
          title: s.meaning,
          hint: 'Trace the full sentence — this is the writing you need for the qualifying paper.',
          speak: s.glyph,
          howTo: 'Trace the sentence phrase by phrase, then hide the guide and write it from memory.',
          onToggle,
        }),
      );
    case 'intro':
      return [];
  }
}

/* -------------------------------------------------------------------------- */
/* Languages hub                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Render the small "Languages" HUB (route `#/languages`): a landing page that
 * links to the Telugu course now and reserves a slot for the English module,
 * which will slot in under the same area later.
 */
export function renderLanguagesHub(root: HTMLElement): void {
  const teluguCard = el('button', {
    class: 'card tel-lang-card',
    type: 'button',
    onClick: () => openTelugu(),
  }, [
    el('span', { class: 'tel-lang-glyph', attrs: { lang: 'te' }, text: 'అ' }),
    el('div', { class: 'tel-lang-meta' }, [
      el('h3', { class: 'tel-lang-title', text: 'Telugu' }),
      el('p', { class: 'section-lead', text: 'From zero: script, tracing, audio and writing toward the qualifying paper.' }),
      chip({ text: 'Available now', tone: 'ok', iconName: 'check' }),
    ]),
    icon('arrow-right', 20),
  ]);

  const englishCard = el('button', {
    class: 'card tel-lang-card',
    type: 'button',
    onClick: () => navigate('/english'),
  }, [
    el('span', { class: 'tel-lang-glyph', text: 'A' }),
    el('div', { class: 'tel-lang-meta' }, [
      el('h3', { class: 'tel-lang-title', text: 'English' }),
      el('p', { class: 'section-lead', text: 'Grammar practice, writing formats with self-evaluation, and reading comprehension for the qualifying paper.' }),
      chip({ text: 'Available now', tone: 'ok', iconName: 'check' }),
    ]),
    icon('arrow-right', 20),
  ]);

  mount(
    root,
    el('div', { class: 'languages-hub' }, [
      card({ class: 'tel-lang-intro' }, [
        el('h2', { class: 'card-title', text: 'Languages' }),
        el('p', { class: 'section-lead', text: 'The qualifying-paper languages for APPSC Group-1. Start from zero with Telugu, or sharpen grammar and writing for the English paper.' }),
      ]),
      el('div', { class: 'tel-lang-grid' }, [teluguCard, englishCard]),
    ]),
  );
}
