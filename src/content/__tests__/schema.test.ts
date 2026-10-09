import { describe, it, expect } from 'vitest';
import mcqBank from '../../../content/history-ancient/hist-ancient-ivc/mcq-hist-ancient-ivc.json';
import notesBank from '../../../content/history-ancient/hist-ancient-ivc/notes-hist-ancient-ivc.json';
import mainsBank from '../../../content/history-ancient/hist-ancient-ivc/mains-hist-ancient-ivc.json';
import syllabusBank from '../../../content/syllabus/official-2026.json';
import manifest from '../../../content/manifest.json';
import taxonomy from '../../../content/taxonomy.json';
import { parseBank, parseManifest, parseSyllabus, MCQItemSchema, NoteItemSchema, CardsBankSchema, CardItemSchema, MindmapBankSchema } from '../types';
import { parseTaxonomy } from '../taxonomy';

// Validates that the freshly-authored seed banks conform to the Zod schemas,
// and — crucially — that malformed data is REJECTED (the schema is a real gate).
describe('content schemas', () => {
  it('accepts the seed MCQ bank', () => {
    const bank = parseBank(mcqBank);
    expect(bank.kind).toBe('mcq');
    // The IVC bank is the coverage-driven EXEMPLAR: a lean, exam-level set.
    expect(bank.items).toHaveLength(19);
  });

  it('accepts the seed notes bank', () => {
    const bank = parseBank(notesBank);
    expect(bank.kind).toBe('notes');
    expect(bank.items).toHaveLength(21);
  });

  it('accepts the seed mains bank', () => {
    const bank = parseBank(mainsBank);
    expect(bank.kind).toBe('mains');
    // Narrow the discriminated union before touching mains-specific fields.
    if (bank.kind === 'mains') {
      expect(bank.items[0]?.paper).toBe('mains-2');
    }
  });

  it('accepts the verified syllabus bank', () => {
    const syllabus = parseSyllabus(syllabusBank);
    expect(syllabus.kind).toBe('syllabus');
    expect(syllabus.meta.notificationNo).toBe('07/2026');
    expect(syllabus.meta.verified).toBe(true);
    expect(syllabus.nodes).toHaveLength(10);
  });

  it('accepts the manifest', () => {
    const parsed = parseManifest(manifest);
    // 374 base banks + 16 curated memory-layer banks (8 cards + 8 mindmaps)
    // added by the batch-1 subtopic review pipeline.
    expect(parsed.banks).toHaveLength(592);
  });

  it('rejects an MCQ whose answerIndex is out of range', () => {
    const bad = {
      id: 'bad-1',
      subjectCode: 'HIST',
      tier: 1,
      question: 'Which is correct?',
      options: ['A', 'B'],
      answerIndex: 5, // out of range → refine must fail
    };
    expect(MCQItemSchema.safeParse(bad).success).toBe(false);
    expect(() => parseBank({ kind: 'mcq', subjectCode: 'HIST', topic: 'x', items: [bad] })).toThrow();
  });

  it('rejects a bank missing a required field', () => {
    // Missing `topic` on an mcq bank.
    expect(() => parseBank({ kind: 'mcq', subjectCode: 'HIST', items: [] })).toThrow();
  });

  it('rejects an unknown discriminator kind', () => {
    expect(() => parseBank({ kind: 'flashcard', subjectCode: 'HIST', topic: 'x', items: [] })).toThrow();
  });

  it('accepts a note with figure/figures/keyPoints/mnemonic (all optional)', () => {
    const noteWithExtras = {
      id: 'n-img',
      subjectCode: 'HIST',
      title: 'With image',
      body: '...',
      figure: { src: 'great-bath', alt: 'The Great Bath', caption: 'Mohenjo-daro' },
      figures: [{ src: 'ivc-extent-map', alt: 'Extent map' }],
      keyPoints: ['Point one', 'Point two'],
      mnemonic: 'MASD',
    };
    expect(NoteItemSchema.safeParse(noteWithExtras).success).toBe(true);
    // A bank of such notes parses too.
    const bank = parseBank({ kind: 'notes', subjectCode: 'HIST', topic: 'x', items: [noteWithExtras] });
    expect(bank.kind).toBe('notes');
  });

  it('still accepts a plain note omitting all image/retention fields (backward-compatible)', () => {
    const plain = { id: 'n-plain', subjectCode: 'HIST', title: 'Plain', body: '...' };
    expect(NoteItemSchema.safeParse(plain).success).toBe(true);
  });

  it('rejects a figure with an empty src (per the validate rule)', () => {
    const bad = {
      id: 'n-bad',
      subjectCode: 'HIST',
      title: 'Bad figure',
      body: '...',
      figure: { src: '', alt: 'empty key' },
    };
    expect(NoteItemSchema.safeParse(bad).success).toBe(false);
  });

  it('accepts an OPTIONAL subtopicId on MCQ/Note items (backward-compatible)', () => {
    // The retrofitted seed banks now carry subtopicId on every item.
    const bank = parseBank(mcqBank);
    if (bank.kind === 'mcq') {
      expect(bank.items.every((i) => i.subtopicId === 'hist-ancient-ivc')).toBe(true);
    }
    // A brand-new item WITH subtopicId parses…
    const withSub = { id: 'x1', subjectCode: 'HIST', subtopicId: 'hist-ancient-ivc', tier: 1, question: 'q', options: ['a', 'b'], answerIndex: 0 };
    expect(MCQItemSchema.safeParse(withSub).success).toBe(true);
    // …and an item WITHOUT one still parses (backward-compatible).
    const withoutSub = { id: 'x2', subjectCode: 'HIST', tier: 1, question: 'q', options: ['a', 'b'], answerIndex: 0 };
    expect(MCQItemSchema.safeParse(withoutSub).success).toBe(true);
  });

  it('accepts OPTIONAL covers[]/refresher and a tier-less item (coverage model, backward-compatible)', () => {
    // A coverage-model item: no tier, with covers[] + refresher flag.
    const examLevel = {
      id: 'c1',
      subjectCode: 'HIST',
      subtopicId: 'hist-ancient-ivc',
      question: 'q',
      options: ['a', 'b', 'c', 'd'],
      answerIndex: 0,
      covers: ['town-planning', 'trade'],
      refresher: false,
    };
    expect(MCQItemSchema.safeParse(examLevel).success).toBe(true);
    // A warm-up refresher (still no tier).
    const warmUp = { id: 'c2', subjectCode: 'HIST', question: 'q', options: ['a', 'b'], answerIndex: 0, refresher: true };
    expect(MCQItemSchema.safeParse(warmUp).success).toBe(true);
    // The IVC exemplar bank is now tier-LESS and coverage-driven: every item
    // omits tier and maps to exam-points via covers[].
    const bank = parseBank(mcqBank);
    if (bank.kind === 'mcq') {
      expect(bank.items.every((i) => i.tier === undefined)).toBe(true);
      expect(bank.items.every((i) => Array.isArray(i.covers) && i.covers.length > 0)).toBe(true);
    }
    // Wrong types are still rejected.
    const badCovers = { id: 'c3', subjectCode: 'HIST', question: 'q', options: ['a', 'b'], answerIndex: 0, covers: 'not-an-array' };
    expect(MCQItemSchema.safeParse(badCovers).success).toBe(false);
  });
});

describe('taxonomy schema', () => {
  it('accepts the full-syllabus taxonomy', () => {
    const tax = parseTaxonomy(taxonomy);
    expect(tax.subjects).toHaveLength(9);
    expect(tax.chapters).toHaveLength(25);
    expect(tax.subtopics).toHaveLength(129);
    expect(tax.subtopics.find((s) => s.id === 'hist-ancient-ivc')?.band).toBe('A');
    // Every Ancient-India subtopic still references the History screening node
    // the IVC banks use (preserved byte-for-byte).
    const ancient = tax.subtopics.filter((s) => s.chapterId === 'ancient-india');
    expect(ancient).toHaveLength(23);
    expect(ancient.every((s) => s.syllabusRef === 'hist-scr-a1')).toBe(true);
  });

  it('accepts an OPTIONAL examPoints[] checklist on a subtopic (backward-compatible)', () => {
    const withPoints = {
      subjects: [{ code: 'HIST', name: 'H', order: 1 }],
      chapters: [{ id: 'c', subjectCode: 'HIST', name: 'C', order: 1 }],
      subtopics: [
        { id: 's', subjectCode: 'HIST', chapterId: 'c', name: 'S', order: 1, examPoints: ['origins', 'trade'] },
        // A subtopic WITHOUT examPoints still validates (falls back to band-target coverage).
        { id: 's2', subjectCode: 'HIST', chapterId: 'c', name: 'S2', order: 2 },
      ],
    };
    const tax = parseTaxonomy(withPoints);
    expect(tax.subtopics[0]?.examPoints).toEqual(['origins', 'trade']);
    expect(tax.subtopics[1]?.examPoints).toBeUndefined();
  });

  it('rejects an invalid band', () => {
    const bad = {
      subjects: [{ code: 'HIST', name: 'H', order: 1 }],
      chapters: [],
      subtopics: [{ id: 's', subjectCode: 'HIST', chapterId: 'c', name: 'S', order: 1, band: 'Z' }],
    };
    expect(() => parseTaxonomy(bad)).toThrow();
  });
});

describe('curated cards schema', () => {
  const card = {
    id: 'c-1',
    subjectCode: 'HIST',
    subtopicId: 'hist-ancient-stone-age',
    front: 'Who proposed the three-age system?',
    back: 'C.J. Thomsen (1820) — Stone, Bronze, Iron.',
    examPoint: "Stone Age definition & Thomson's three-age system (1820)",
    verified: true,
  };

  it('accepts a well-formed cards bank', () => {
    const parsed = CardsBankSchema.safeParse({
      kind: 'cards',
      subjectCode: 'HIST',
      topic: 'Stone Age',
      items: [card],
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts a card omitting the optional examPoint/source', () => {
    const { examPoint: _ep, ...noEp } = card;
    void _ep;
    expect(CardItemSchema.safeParse(noEp).success).toBe(true);
  });

  it('enforces the front size cap (≤160 chars) as an error', () => {
    const bad = { ...card, front: 'x'.repeat(161) };
    expect(CardItemSchema.safeParse(bad).success).toBe(false);
  });

  it('enforces the back size cap (≤200 chars) as an error', () => {
    const bad = { ...card, back: 'y'.repeat(201) };
    expect(CardItemSchema.safeParse(bad).success).toBe(false);
  });

  it('requires the verified flag and a subtopicId', () => {
    const { verified: _v, ...noVerified } = card;
    void _v;
    expect(CardItemSchema.safeParse(noVerified).success).toBe(false);
    const { subtopicId: _s, ...noSub } = card;
    void _s;
    expect(CardItemSchema.safeParse(noSub).success).toBe(false);
  });

  it('is NOT accepted by parseBank (cards live outside the mcq/notes/mains union)', () => {
    expect(() =>
      parseBank({ kind: 'cards', subjectCode: 'HIST', topic: 'x', items: [card] }),
    ).toThrow();
  });
});

describe('curated mindmap schema', () => {
  const map = {
    kind: 'mindmap',
    subjectCode: 'HIST',
    topic: 'Stone Age',
    subtopicId: 'hist-ancient-stone-age',
    root: 'Stone Age',
    branches: [
      { label: 'Palaeolithic', leaves: ['Quartzite Men', 'no pottery', 'Bhimbetka'] },
      { label: 'Mesolithic', leaves: ['microliths', '9000–4000 BC'] },
    ],
  };

  it('accepts a well-formed mind map', () => {
    expect(MindmapBankSchema.safeParse(map).success).toBe(true);
  });

  it('rejects a root longer than 40 chars', () => {
    expect(MindmapBankSchema.safeParse({ ...map, root: 'z'.repeat(41) }).success).toBe(false);
  });

  it('rejects more than 7 branches', () => {
    const branches = Array.from({ length: 8 }, (_, i) => ({ label: `b${i}`, leaves: [] }));
    expect(MindmapBankSchema.safeParse({ ...map, branches }).success).toBe(false);
  });

  it('rejects a branch with more than 4 leaves', () => {
    const bad = { ...map, branches: [{ label: 'x', leaves: ['a', 'b', 'c', 'd', 'e'] }] };
    expect(MindmapBankSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a leaf longer than 60 chars', () => {
    const bad = { ...map, branches: [{ label: 'x', leaves: ['w'.repeat(61)] }] };
    expect(MindmapBankSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a branch label longer than 40 chars', () => {
    const bad = { ...map, branches: [{ label: 'l'.repeat(41), leaves: [] }] };
    expect(MindmapBankSchema.safeParse(bad).success).toBe(false);
  });
});
