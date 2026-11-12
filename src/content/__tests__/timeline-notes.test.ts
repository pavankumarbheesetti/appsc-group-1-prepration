import { describe, expect, it } from 'vitest';
import { getBanks, getChapters, getGlossary, getNoteById, getTimeline } from '../loader';

// The history timeline is meant to be enough on its own: every history note
// section must be taught on some dated event, and every link must resolve.
describe('timeline teaches every history note', () => {
  const events = getTimeline().events;
  const linked = new Map<string, string[]>();
  for (const e of events) for (const n of e.noteIds ?? []) linked.set(n, [...(linked.get(n) ?? []), e.id]);

  const historyNotes = getBanks('notes')
    .flatMap(({ bank }) => (bank.kind === 'notes' ? bank.items : []))
    .filter((n) => n.subtopicId?.startsWith('hist-') || n.subtopicId?.startsWith('pol-'));

  it('finds the history and polity notes', () => {
    expect(historyNotes.length).toBeGreaterThan(900);
  });

  it('links every history and polity note section to an event', () => {
    const missing = historyNotes.filter((n) => !linked.has(n.id)).map((n) => n.id);
    expect(missing).toEqual([]);
  });

  it('links each note to exactly one event', () => {
    const twice = [...linked].filter(([, ids]) => ids.length > 1).map(([n, ids]) => `${n} → ${ids.join(', ')}`);
    expect(twice).toEqual([]);
  });

  it('resolves every noteId', () => {
    const broken = [...linked.keys()].filter((id) => !getNoteById(id));
    expect(broken).toEqual([]);
  });

  it('gives story context to every event except current affairs', () => {
    const bare = events
      .filter((e) => !e.timeless && !e.subtopicIds.some((s) => s.startsWith('ca-')))
      .filter((e) => !e.before || !e.after)
      .map((e) => e.id);
    expect(bare).toEqual([]);
  });

  it('points every chapter peg at a real event', () => {
    const ids = new Set(events.map((e) => e.id));
    const bad = getChapters().flatMap((c) => (c.pegs ?? []).filter((p) => !ids.has(p.eventId)).map((p) => `${c.id}:${p.eventId}`));
    expect(bad).toEqual([]);
  });

  it('keeps glossary ids unique', () => {
    const ids = getGlossary().map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
