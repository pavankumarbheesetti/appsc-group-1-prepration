/**
 * Shared inline quiz runner — the distraction-free FOCUS MODE used by both the
 * Drill and Notebook views.
 *
 * Presents one MCQ at a time as big tappable option cards with A/B/C/D key
 * badges, reveals correctness + a slide-in explanation after a choice, and
 * supports FULL KEYBOARD control (A–D or 1–4 to answer, Enter to advance). It
 * records every outcome into persisted state (progress counters, the SR card
 * via {@link review}, and the wrong-answer notebook via {@link recordAnswer}) —
 * this recording logic is unchanged and remains the single place that maps a UI
 * answer onto all three subsystems.
 *
 * On top of that engine-neutral core it layers a premium, exam-pace PRESENTATION:
 * a slim top progress bar + per-question progress DOTS, an unobtrusive
 * per-question PACE TIMER (amber at 60s, red at 90s; reduced-motion safe), an
 * optional "Sure / Guess" CONFIDENCE toggle, and a persistent keyboard HINT bar.
 * All of that pacing/confidence data is kept in memory only (via the
 * {@link SessionAnswerDetail} list handed to `onDone`) — nothing new is persisted.
 *
 * DOM-only module (the pure logic lives in engine/* and lib/metrics.ts); it
 * takes a mount element and rebuilds it as the session advances.
 */
import type { MCQItem } from '../content/types';
import { answerQuestion, scoreSession, type ScoredAnswer, type SessionScore } from '../engine/drill';
import { recordAnswer } from '../engine/notebook';
import { newCard, review } from '../engine/spaced-repetition';
import { updateState } from '../state/store';
import { formatDuration, type Confidence, type SessionAnswerDetail } from '../lib/metrics';
import { computeNavCells } from '../lib/navigator';
import { splitExplanation, type KeyFacts, type WhyNotRow } from '../lib/explanation';
import { parseQuestion, type MatchQuestion, type StatementQuestion } from '../lib/question-format';
import { el, mount, renderMarkdown, renderInline, type Child } from './dom';
import { icon } from './components/icon';

/**
 * Called when the session finishes: the aggregate score, the questions missed,
 * and the per-question DETAILS (tier / time / confidence) the results screen
 * uses for its richer breakdown. `details` is always in answered order and its
 * length matches the number of questions actually answered (which can be fewer
 * than `items.length` when the learner ends early).
 */
export type QuizDoneFn = (
  summary: SessionScore,
  wrongItems: MCQItem[],
  details: SessionAnswerDetail[],
) => void;

/** Optional behaviours for {@link mountQuiz}. */
export interface QuizOpts {
  /**
   * When true, render an "End session" control on every question so the learner
   * can finish EARLY. Ending scores only the questions answered so far (via
   * {@link scoreSession}) and calls `onDone` — so no session length is ever
   * pre-committed. Defaults to false (used by the Notebook review runner, which
   * always walks its fixed active set).
   */
  allowEndSession?: boolean;
}

/** Letter badges for the first four options; falls back to the index+1. */
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'] as const;

/** Pace thresholds (seconds): calm → AMBER → RED. Visual pacing only. */
const PACE_AMBER_S = 60;
const PACE_RED_S = 90;

/**
 * Persist one answer: bump progress, reschedule the SR card, and update the
 * wrong-answer notebook. Kept together so every quiz records identically.
 * @internal
 */
function recordOutcome(item: MCQItem, correct: boolean): void {
  const now = Date.now();
  const result: 'correct' | 'wrong' = correct ? 'correct' : 'wrong';
  updateState((s) => {
    const prev = s.progress[item.id] ?? { seen: 0, correct: 0, wrong: 0 };
    s.progress[item.id] = {
      seen: prev.seen + 1,
      correct: prev.correct + (correct ? 1 : 0),
      wrong: prev.wrong + (correct ? 0 : 1),
      lastResult: result,
    };
    // Reschedule the Leitner card (create one on first sighting).
    const card = s.sr[item.id] ?? newCard(item.id, now);
    s.sr[item.id] = review(card, result, now);
    // Notebook: wrong adds/refreshes; correct advances/graduates a tracked entry.
    const entry = recordAnswer(item.id, s.notebook[item.id], result, now);
    if (entry) s.notebook[item.id] = entry;
  });
}

/**
 * Build the answer "Why" panel for an MCQ. Parses the explanation (via the pure
 * {@link splitExplanation}) into a readable RATIONALE, an optional muted
 * DISTRACTOR line, an optional per-distractor "WHY NOT THE OTHERS" block, and an
 * optional structured KEY-FACTS block, and shows the source citation exactly
 * ONCE — preferring the structured `source` field and falling back to a trailing
 * inline `Source:` line lifted from the explanation (so it is never duplicated).
 * Returns null when there is nothing to show. Shared verbatim by the live drill
 * feedback, the drill results review, and the mock full review. No innerHTML —
 * the vetted markdown renderer only.
 */
export function renderExplanation(item: MCQItem): HTMLElement | null {
  if (!item.explanation && !item.source) return null;
  const panel = el('div', { class: 'explanation' });
  let inlineSource: string | null = null;

  if (item.explanation) {
    const { rationale, distractor, whyNot, keyFacts, source } = splitExplanation(item.explanation);
    inlineSource = source;
    panel.appendChild(el('p', { class: 'explanation-title', text: 'Why' }));
    if (rationale) {
      panel.appendChild(el('div', { class: 'explanation-body md' }, renderMarkdown(rationale)));
    }
    if (distractor) {
      panel.appendChild(
        el('p', { class: 'explanation-distractor' }, [
          el('span', { class: 'distractor-label', text: 'Others' }),
          el('span', { class: 'distractor-body' }, renderInline(distractor)),
        ]),
      );
    }
    if (whyNot.length > 0) panel.appendChild(renderWhyNot(whyNot));
    if (keyFacts) panel.appendChild(renderKeyFacts(keyFacts));
  }

  // De-duplicated citation: structured field wins; inline is the fallback.
  const sourceText = item.source ?? inlineSource;
  if (sourceText) panel.appendChild(renderSource(sourceText));

  return panel;
}

/**
 * Render the "Why not the others" block: a small uppercase section label
 * followed by one hairline-divided row per distractor — a refined `x` marker,
 * the option text (emphasized, left) and its one-line reason (muted, right),
 * matching the Key-facts label→value row rhythm. Inline emphasis goes through
 * the vetted {@link renderInline} (never innerHTML). Calm, not loud; a row with
 * no authored reason simply omits the reason cell. @internal
 */
function renderWhyNot(rows: readonly WhyNotRow[]): HTMLElement {
  const aside = el('aside', {
    class: 'why-not',
    attrs: { 'aria-label': 'Why not the others' },
  }, [el('p', { class: 'why-not-title', text: 'Why not the others' })]);

  const list = el('ul', { class: 'why-not-list tnum' });
  for (const row of rows) {
    const kids: Child[] = [
      el('span', { class: 'why-not-x', attrs: { 'aria-hidden': 'true' } }, [icon('x', 13)]),
      el('span', { class: 'why-not-option' }, renderInline(row.option)),
    ];
    if (row.reason) kids.push(el('span', { class: 'why-not-reason' }, renderInline(row.reason)));
    list.appendChild(el('li', { class: 'why-not-row' }, kids));
  }
  aside.appendChild(list);
  return aside;
}

/**
 * Render the elegant "Key facts" panel: a small uppercase section label (plus
 * an optional caption from the marker, e.g. `— Dholavira`), then the facts as a
 * refined bordered TABLE, a label→value definition GRID (`kv`), or a tidy LIST,
 * depending on the parsed {@link KeyFacts.kind}. Values use tabular figures so
 * dates/years align. @internal
 */
function renderKeyFacts(kf: KeyFacts): HTMLElement {
  const titleKids: Child[] = [icon('sparkles', 13), el('span', { text: 'Key facts' })];
  if (kf.caption) titleKids.push(el('span', { class: 'key-facts-caption', text: kf.caption }));
  const aside = el('aside', {
    class: `key-facts key-facts-${kf.kind}`,
    attrs: { 'aria-label': kf.caption ? `Key facts — ${kf.caption}` : 'Key facts' },
  }, [el('p', { class: 'key-facts-title' }, titleKids)]);

  if (kf.kind === 'kv') {
    const dl = el('dl', { class: 'key-facts-dl tnum' });
    for (const pair of kf.pairs) {
      dl.appendChild(
        el('div', { class: 'kf-pair' }, [
          el('dt', { class: 'kf-key', text: pair.label }),
          el('dd', { class: 'kf-val' }, renderInline(pair.value)),
        ]),
      );
    }
    aside.appendChild(dl);
  } else {
    const cls = kf.kind === 'table' ? 'key-facts-body md tnum' : 'key-facts-body md';
    aside.appendChild(el('div', { class: cls }, renderMarkdown(kf.markdown)));
  }
  return aside;
}

/** Match http(s) URLs so a source citation can linkify them. @internal */
const SOURCE_URL_RE = /(https?:\/\/[^\s)]+)/g;

/** A compact, quiet label for a URL — its hostname without a `www.` prefix. @internal */
function prettyUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * Render the QUIET single-footnote source citation. Any URL in the text becomes
 * an external link (labelled by its host) with an external-link icon; the rest
 * renders as muted text. @internal
 */
function renderSource(text: string): HTMLElement {
  const body = el('span', { class: 'src-body' });
  for (const part of text.split(SOURCE_URL_RE)) {
    if (part === '') continue;
    if (/^https?:\/\//.test(part)) {
      body.appendChild(
        el('a', {
          class: 'src-link',
          href: part,
          attrs: { target: '_blank', rel: 'noopener noreferrer' },
        }, [el('span', { text: prettyUrl(part) }), icon('external-link', 12)]),
      );
    } else {
      body.appendChild(document.createTextNode(part));
    }
  }
  return el('p', { class: 'explanation-source' }, [
    el('span', { class: 'src-label', text: 'Source' }),
    body,
  ]);
}

/**
 * Scroll the given element into view horizontally without breaking in jsdom,
 * where `scrollIntoView` is not implemented. Used to keep the active navigator
 * chip visible in long sessions. @internal
 */
function scrollIntoViewSafe(elm: Element | null): void {
  if (!elm) return;
  const fn = (elm as HTMLElement).scrollIntoView;
  if (typeof fn === 'function') {
    try {
      fn.call(elm, { block: 'nearest', inline: 'nearest' });
    } catch {
      /* jsdom / unsupported — non-fatal */
    }
  }
}

/**
 * Mount an interactive quiz over `items` into `root`. Calls `onDone` with the
 * score, the list of missed questions, and per-question details when every
 * question is answered. An empty `items` list renders a short "nothing to
 * review" message and invokes `onDone` with zeroes.
 */
export function mountQuiz(root: HTMLElement, items: readonly MCQItem[], onDone: QuizDoneFn, opts: QuizOpts = {}): void {
  const answers: ScoredAnswer[] = [];
  const details: SessionAnswerDetail[] = [];
  const wrongItems: MCQItem[] = [];
  /**
   * Per-question LOCKED outcome, keyed by question index, for questions already
   * answered this session. It lets the learner jump back to an answered
   * question and see its locked feedback WITHOUT re-recording — `answers` /
   * `details` / `wrongItems` (and the store) are still written exactly once,
   * in answered order, so scoring/recording semantics are unchanged.
   */
  const answered = new Map<number, { chosen: number; answerIndex: number; correct: boolean }>();
  let idx = 0;

  // Per-question, reset on each draw.
  let questionStart = 0;
  let confidence: Confidence | null = null;
  let applyConf: ((v: Confidence) => void) | null = null;
  let paceTimer: ReturnType<typeof setInterval> | null = null;
  const clearPace = (): void => {
    if (paceTimer !== null) {
      clearInterval(paceTimer);
      paceTimer = null;
    }
  };

  if (items.length === 0) {
    mount(
      root,
      el('div', { class: 'empty-state' }, [
        el('span', { class: 'empty-icon' }, [icon('sparkles', 24)]),
        el('h3', { text: 'Nothing to review right now' }),
        el('p', { text: "You're all caught up. 🎉" }),
      ]),
    );
    onDone({ total: 0, correct: 0, wrong: 0, accuracy: 0 }, wrongItems, details);
    return;
  }

  /** Slim top progress bar reflecting `answered` of n. */
  const progressBar = (answered: number): HTMLElement => {
    const frac = answered / items.length;
    return el('div', {
      class: 'focus-progress',
      attrs: {
        role: 'progressbar',
        'aria-valuenow': String(answered),
        'aria-valuemin': '0',
        'aria-valuemax': String(items.length),
        'aria-label': `Question ${Math.min(answered + 1, items.length)} of ${items.length}`,
      },
    }, [
      el('div', { class: 'focus-progress-fill', attrs: { style: `width:${Math.round(frac * 100)}%` } }),
    ]);
  };

  /**
   * NUMBERED, horizontally-scrollable, clickable navigator — one chip per
   * question. Answered chips show green (correct) / red (wrong), the current
   * question is ringed, the rest are neutral. Clicking a chip JUMPS to that
   * question via {@link jumpTo}. State mapping is the pure {@link computeNavCells}.
   */
  const buildNavigator = (): HTMLElement => {
    const results = new Map<number, boolean>();
    for (const [i, rec] of answered) results.set(i, rec.correct);
    const track = el('div', { class: 'q-nav-track' });
    for (const cell of computeNavCells(items.length, idx, results)) {
      const stateLabel =
        cell.state === 'correct'
          ? ', answered correctly'
          : cell.state === 'wrong'
            ? ', answered incorrectly'
            : cell.current
              ? ', current question'
              : ', not yet answered';
      const cls = ['q-nav-item', `is-${cell.state}`];
      if (cell.current) cls.push('is-current');
      track.appendChild(
        el('button', {
          class: cls.join(' '),
          type: 'button',
          text: cell.label,
          ariaLabel: `Go to question ${cell.label}${stateLabel}`,
          attrs: { 'aria-current': cell.current ? 'true' : 'false' },
          onClick: () => jumpTo(cell.index),
        }),
      );
    }
    return el('nav', { class: 'q-nav', ariaLabel: 'Question navigator — jump to any question' }, [track]);
  };

  /**
   * Jump to question `i`: shows its LIVE state if unanswered, or its LOCKED
   * feedback if already answered. Never re-records. @internal
   */
  const jumpTo = (i: number): void => {
    if (i < 0 || i >= items.length || i === idx) return;
    clearPace();
    idx = i;
    drawQuestion();
  };

  /** Finish early: score whatever has been answered so far and hand back. */
  const endSession = (): void => {
    clearPace();
    onDone(scoreSession(answers), wrongItems, details);
  };

  /**
   * Header row: the "Question i of n" counter, plus an optional "End session"
   * control (when {@link QuizOpts.allowEndSession}) so the learner can stop at
   * any time without pre-committing a length.
   */
  const sessionHead = (): HTMLElement => {
    const count = el('p', { class: 'focus-count tnum', text: `Question ${idx + 1} of ${items.length}` });
    if (!opts.allowEndSession) return el('div', { class: 'focus-head' }, [count]);
    const end = el('button', {
      class: 'btn btn-ghost focus-end',
      type: 'button',
      ariaLabel: 'End session now and see your results',
      onClick: endSession,
    }, ['End session']);
    return el('div', { class: 'focus-head' }, [count, end]);
  };

  /** Build the focusable stage container that owns keyboard handling. */
  const makeStage = (onKey: (e: KeyboardEvent) => void): HTMLElement => {
    const stage = el('section', {
      class: 'focus-stage',
      attrs: { tabindex: '-1', 'aria-live': 'polite' },
    });
    // Keydown lives on the stage element; when the stage is replaced on the
    // next question the listener is GC'd with it (no global-listener leak).
    stage.addEventListener('keydown', onKey);
    return stage;
  };

  /** The persistent, subtle keyboard-hint bar shown under every question. */
  const hintBar = (): HTMLElement =>
    el('div', { class: 'focus-hints' }, [
      el('span', { class: 'khint' }, [el('kbd', { text: 'A–D' }), el('span', { text: 'or' }), el('kbd', { text: '1–4' }), el('span', { text: 'to answer' })]),
      el('span', { class: 'khint-sep', text: '·' }),
      el('span', { class: 'khint' }, [el('kbd', { text: 'S' }), el('span', { text: '/' }), el('kbd', { text: 'G' }), el('span', { text: 'to rate' })]),
      el('span', { class: 'khint-sep', text: '·' }),
      el('span', { class: 'khint' }, [el('kbd', { text: 'Enter' }), el('span', { text: 'for next' })]),
    ]);

  /**
   * The optional "Sure / Guess" confidence toggle, shown before answering. It
   * NEVER blocks answering; clicking the active choice again clears it. Also
   * driven by the `s`/`g` keys (see {@link drawQuestion}). @internal
   */
  const buildConfidence = (): HTMLElement => {
    const mk = (val: Confidence, label: string): HTMLButtonElement => {
      const b = el('button', {
        class: 'conf-btn',
        type: 'button',
        attrs: { 'aria-pressed': 'false' },
      }, [label]) as HTMLButtonElement;
      b.addEventListener('click', () => set(val));
      return b;
    };
    const sure = mk('sure', 'Sure');
    const guess = mk('guess', 'Guess');
    const sync = (): void => {
      for (const [b, val] of [[sure, 'sure'], [guess, 'guess']] as const) {
        const on = confidence === val;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-pressed', String(on));
      }
    };
    const set = (val: Confidence): void => {
      confidence = confidence === val ? null : val;
      sync();
    };
    applyConf = set;
    sync();
    return el('div', { class: 'confidence', attrs: { role: 'group', 'aria-label': 'Rate your confidence (optional)' } }, [
      el('span', { class: 'conf-label', text: 'Confidence' }),
      sure,
      guess,
    ]);
  };

  /** Build the per-question pace timer and start its 1s tick. @internal */
  const buildPaceTimer = (): HTMLElement => {
    const time = el('span', { class: 'pace-time tnum', text: '0:00' });
    const timer = el('div', { class: 'pace-timer', attrs: { role: 'timer', 'aria-hidden': 'true', title: 'Time on this question' } }, [
      el('span', { class: 'pace-dot' }),
      time,
    ]);
    const tick = (): void => {
      const elapsedS = Math.floor((Date.now() - questionStart) / 1000);
      time.textContent = formatDuration(elapsedS * 1000);
      timer.classList.toggle('is-amber', elapsedS >= PACE_AMBER_S && elapsedS < PACE_RED_S);
      timer.classList.toggle('is-red', elapsedS >= PACE_RED_S);
    };
    clearPace();
    tick();
    paceTimer = setInterval(tick, 1000);
    return timer;
  };

  /**
   * Route to the right view for the current index: LIVE (answerable) when the
   * question hasn't been answered yet, or LOCKED feedback when it has (so a
   * jump back to an answered question shows its result without re-recording).
   */
  const drawQuestion = (): void => {
    const item = items[idx];
    if (!item) return;
    const rec = answered.get(idx);
    if (rec) drawLocked(item, rec);
    else drawLive(item);
  };

  const drawLive = (item: MCQItem): void => {
    questionStart = Date.now();
    confidence = null;
    applyConf = null;

    const onKey = (e: KeyboardEvent): void => {
      const k = e.key.toLowerCase();
      // s / g set confidence (optional; never blocks answering).
      if (k === 's' || k === 'g') {
        if (applyConf) {
          e.preventDefault();
          applyConf(k === 's' ? 'sure' : 'guess');
        }
        return;
      }
      // Letter keys a–f or number keys 1–6 map to an option index.
      let choice = -1;
      if (k >= 'a' && k <= 'f') choice = k.charCodeAt(0) - 'a'.charCodeAt(0);
      else if (k >= '1' && k <= '6') choice = Number(k) - 1;
      if (choice >= 0 && choice < item.options.length) {
        e.preventDefault();
        reveal(item, choice);
      }
    };

    const stage = makeStage(onKey);
    stage.append(
      progressBar(answered.size),
      buildNavigator(),
      el('div', { class: 'focus-topline' }, [sessionHead(), buildPaceTimer()]),
      el('div', { class: 'card question-card' }, [
        ...renderQuestionStem(item.question),
        buildOptions(item, null, (chosen) => reveal(item, chosen)),
        buildConfidence(),
      ]),
      hintBar(),
    );
    mount(root, stage);
    scrollIntoViewSafe(stage.querySelector('.q-nav-item.is-current'));
    stage.focus(); // capture keyboard immediately
  };

  /**
   * Handle a LIVE answer: score it, RECORD it once (progress/SR/notebook, and
   * the in-memory answers/details/wrongItems in answered order), remember the
   * locked outcome for this index, then show the locked feedback. Answering the
   * same index again (after a jump) is impossible — it renders locked instead.
   */
  const reveal = (item: MCQItem, chosen: number): void => {
    clearPace();
    const { correct, answerIndex } = answerQuestion(item, chosen);
    if (!answered.has(idx)) {
      const timeMs = Date.now() - questionStart;
      answers.push({ correct });
      details.push({ tier: item.tier, covers: item.covers, correct, timeMs, confidence });
      if (!correct) wrongItems.push(item);
      recordOutcome(item, correct);
      answered.set(idx, { chosen, answerIndex, correct });
    }
    drawLocked(item, answered.get(idx)!);
  };

  /** Draw the LOCKED feedback view for an already-answered question. @internal */
  const drawLocked = (item: MCQItem, rec: { chosen: number; answerIndex: number; correct: boolean }): void => {
    const isLast = idx === items.length - 1;
    const advance = (): void => {
      if (isLast) {
        clearPace();
        onDone(scoreSession(answers), wrongItems, details);
      } else {
        idx += 1;
        drawQuestion();
      }
    };

    const onKey = (e: KeyboardEvent): void => {
      // After answering, Enter (or Space) advances to the next question.
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        advance();
      }
    };

    const stage = makeStage(onKey);
    const verdict = el('p', {
      class: rec.correct ? 'verdict verdict-correct' : 'verdict verdict-wrong',
    }, [icon(rec.correct ? 'check' : 'x', 20), el('span', { text: rec.correct ? 'Correct' : 'Incorrect' })]);

    const cardBody: Child[] = [
      ...renderQuestionStem(item.question),
      buildOptions(item, { chosen: rec.chosen, answerIndex: rec.answerIndex }, null),
      verdict,
      renderExplanation(item),
    ];

    stage.append(
      progressBar(answered.size),
      buildNavigator(),
      el('div', { class: 'focus-topline' }, [sessionHead()]),
      el('div', { class: 'card question-card' }, cardBody),
      el('div', { class: 'focus-advance' }, [
        (() => {
          const btn = el('button', {
            class: 'btn btn-primary btn-lg',
            type: 'button',
            onClick: advance,
          });
          btn.appendChild(document.createTextNode(isLast ? 'See results' : 'Next question'));
          btn.appendChild(icon('arrow-right', 18));
          return btn;
        })(),
      ]),
      hintBar(),
    );
    mount(root, stage);
    scrollIntoViewSafe(stage.querySelector('.q-nav-item.is-current'));
    stage.focus();
  };

  drawQuestion();
}

/**
 * Render a MATCH-THE-FOLLOWING stem: the intro sentence, then a clean two-column
 * table (List I | List II) with a header row from the parsed labels. When the
 * lists could not be paired confidently the parser returns no rows, and we fall
 * back to the two lists on SEPARATE lines (never a run-on blob). All text goes
 * through the vetted inline renderer — never innerHTML. @internal
 */
function renderMatchStem(q: MatchQuestion): Child[] {
  const nodes: Child[] = [el('h2', { class: 'question-text stem-intro' }, renderInline(q.intro))];

  if (q.rows.length > 0) {
    const table = el('table', { class: 'md-table match-table' });
    table.append(
      el('thead', {}, [
        el('tr', {}, [
          el('th', { attrs: { scope: 'col' } }, [el('span', { text: q.leftLabel })]),
          el('th', { attrs: { scope: 'col' } }, [el('span', { text: q.rightLabel })]),
        ]),
      ]),
      el(
        'tbody',
        {},
        q.rows.map((r) =>
          el('tr', {}, [el('td', {}, renderInline(r.left)), el('td', {}, renderInline(r.right))]),
        ),
      ),
    );
    nodes.push(el('div', { class: 'md-table-wrap match-table-wrap' }, [table]));
    return nodes;
  }

  // Degraded fallback: two lists on their own lines.
  const line = (label: string, raw: string): HTMLElement =>
    el('p', { class: 'match-line' }, [
      el('span', { class: 'match-line-label', text: `${label}: ` }),
      ...renderInline(raw),
    ]);
  if (q.leftRaw) nodes.push(line(q.leftLabel, q.leftRaw));
  if (q.rightRaw) nodes.push(line(q.rightLabel, q.rightRaw));
  return nodes;
}

/**
 * Render a STATEMENT-BASED stem: the intro sentence as the question heading, the
 * numbered statements as a styled ordered list (the number sits in a fixed-width
 * gutter), and the trailing prompt as its own emphasized line. @internal
 */
function renderStatementStem(q: StatementQuestion): Child[] {
  const nodes: Child[] = [el('h2', { class: 'question-text stem-intro' }, renderInline(q.intro))];
  const ol = el('ol', { class: 'stmt-list' });
  for (const s of q.statements) ol.appendChild(el('li', { class: 'stmt-item' }, renderInline(s)));
  nodes.push(ol);
  if (q.prompt) nodes.push(el('p', { class: 'stmt-prompt' }, renderInline(q.prompt)));
  return nodes;
}

/**
 * A GFM table SEPARATOR row, e.g. `|---|:--:|` (must contain a dash). Mirrors the
 * detector inside {@link renderMarkdown} so the plain-stem splitter can spot the
 * start of an embedded pipe table before handing it to the markdown renderer.
 * @internal
 */
function isStemTableSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{1,}:?\s*(?:\|\s*:?-{1,}:?\s*)*\|?\s*$/.test(line) && line.includes('-');
}

/**
 * Whether a GFM pipe TABLE starts at line `i`: a row containing `|` immediately
 * followed by a separator row. @internal
 */
function stemTableStartsAt(lines: readonly string[], i: number): boolean {
  const header = lines[i];
  const sep = lines[i + 1];
  return (
    header !== undefined && header.includes('|') && sep !== undefined && isStemTableSeparator(sep)
  );
}

/**
 * Render an ordinary ("plain") stem — one that is neither statement-based nor a
 * match-the-following list. A genuine SINGLE-LINE question keeps the exact
 * `<h2 class="question-text">` heading it has always used (unchanged). A stem
 * that carries an embedded GFM pipe TABLE (e.g. Data-Interpretation items) or
 * explicit line breaks is rendered richly: the leading sentence becomes the
 * question heading and the remainder — the data table and any trailing prompt —
 * is rendered through the vetted, XSS-safe {@link renderMarkdown} (text nodes /
 * elements only, never innerHTML), so the pipe table lands as a real accessible
 * `<table>` (thead + `th scope`, styled like the explanation's fact tables)
 * rather than literal `| Month | … |` text. @internal
 */
function renderPlainStem(question: string): Child[] {
  // Fast path: a genuine single-line question is rendered exactly as before,
  // but through the vetted inline renderer so superscripts/subscripts/code and
  // bold are shown (still a single `<h2 class="question-text">`).
  if (!question.includes('\n')) {
    return [el('h2', { class: 'question-text' }, renderInline(question))];
  }

  const lines = question.split('\n');
  // The heading is the leading SENTENCE (first line), unless the stem opens
  // directly with a table — then there is no lead-in and the whole stem renders
  // as markdown. Everything after the first line is rendered through the vetted
  // markdown renderer, so an embedded pipe table becomes a real <table> and the
  // remaining lines become their own paragraphs (line breaks preserved).
  const opensWithTable = stemTableStartsAt(lines, 0);
  const heading = opensWithTable ? '' : (lines[0] ?? '').trim();
  const rest = (opensWithTable ? question : lines.slice(1).join('\n')).trim();

  const nodes: Child[] = [];
  if (heading !== '') {
    nodes.push(el('h2', { class: 'question-text stem-intro' }, renderInline(heading)));
  }
  if (rest !== '') {
    nodes.push(el('div', { class: 'stem-body md' }, renderMarkdown(rest)));
  }
  // Defensive: a stem that produced neither (should not happen once it contains
  // a newline) still renders as a plain heading rather than nothing.
  if (nodes.length === 0) {
    nodes.push(el('h2', { class: 'question-text', text: question }));
  }
  return nodes;
}

/**
 * Render an MCQ stem into readable DOM nodes, applied everywhere the quiz shows a
 * question (live drill, drill results review, mock running + review). Structures
 * STATEMENT-BASED and MATCH-THE-FOLLOWING stems (see {@link parseQuestion}), and
 * renders a plain stem that embeds a markdown TABLE (or line breaks) through the
 * vetted markdown renderer; an ordinary single-line question still falls back to
 * the plain `.question-text` heading exactly as before. XSS-safe — text nodes /
 * the vetted inline + markdown renderers only, never innerHTML.
 */
export function renderQuestionStem(question: string): Child[] {
  const parsed = parseQuestion(question);
  if (parsed.kind === 'match') return renderMatchStem(parsed);
  if (parsed.kind === 'statements') return renderStatementStem(parsed);
  return renderPlainStem(question);
}

/**
 * Build the option-card list. When `revealed` is null the cards are live
 * (clickable); otherwise they show the correct/wrong result and are disabled.
 * @internal
 */
function buildOptions(
  item: MCQItem,
  revealed: { chosen: number; answerIndex: number } | null,
  onChoose: ((index: number) => void) | null,
): HTMLElement {
  const list = el('div', { class: 'option-list' });
  item.options.forEach((opt, i) => {
    const cls = ['option-card'];
    if (revealed) {
      if (i === revealed.answerIndex) cls.push('is-correct');
      else if (i === revealed.chosen) cls.push('is-wrong');
    }
    const btn = el('button', {
      class: cls.join(' '),
      type: 'button',
      onClick: revealed || !onChoose ? undefined : () => onChoose(i),
    }, [
      el('span', { class: 'option-key', text: LETTERS[i] ?? String(i + 1) }),
      el('span', { class: 'option-body' }, renderInline(opt)),
      revealed && i === revealed.answerIndex
        ? el('span', { class: 'option-mark', attrs: { 'aria-hidden': 'true' } }, [icon('check', 18)])
        : revealed && i === revealed.chosen
          ? el('span', { class: 'option-mark', attrs: { 'aria-hidden': 'true' } }, [icon('x', 18)])
          : null,
    ]);
    if (revealed) btn.setAttribute('disabled', 'true');
    list.appendChild(btn);
  });
  return list;
}
