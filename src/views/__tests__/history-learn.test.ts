import { afterEach, describe, expect, it } from 'vitest';
import { buildSlides, chapterYears, fragmentsOf, renderChapter, renderIndex, untaughtEvents } from '../history-learn';
import { chronicleData } from '../year-explorer';
import { getChapters } from '../../content/loader';

afterEach(() => {
  document.body.replaceChildren();
  window.location.hash = '';
});

const open = (hash: string, fn: (r: HTMLElement) => void): HTMLElement => {
  window.location.hash = hash;
  const root = document.createElement('div');
  document.body.append(root);
  fn(root);
  return root;
};

const chapter = () => getChapters().find((c) => c.id === 'modern-1757-1805')!;
const nextBtn = (root: HTMLElement): HTMLButtonElement => root.querySelector<HTMLButtonElement>('.hl-pager .btn-primary')!;
const title = (root: HTMLElement): string => root.querySelector('.hl-slide-title')?.textContent ?? '';

describe('history index and chapter overview', () => {
  it('lists parts, chapters and the A–Z of terms', () => {
    const root = open('#/topics/history', renderIndex);
    expect(root.textContent).toContain('Modern India');
    expect(root.textContent).toContain('Ancient India');
    expect(root.textContent).toContain('From traders to rulers');
    expect(root.querySelector('#glossary')?.textContent).toContain('Chauth');
  });

  it('shows the chapter as a list of short lessons', () => {
    const root = open('#/topics/history/modern-1757-1805', renderChapter);
    const lessons = root.querySelectorAll('.hl-frag-btn');
    expect(lessons).toHaveLength(3);
    expect(lessons[0]!.textContent).toContain('Bengal passes to the Company');
  });

  it('falls back to the index for an unknown chapter and to the overview for a bad lesson number', () => {
    expect(open('#/topics/history/nope', renderChapter).textContent).toContain('History, year by year');
    expect(open('#/topics/history/modern-1757-1805/9', renderChapter).querySelectorAll('.hl-frag-btn')).toHaveLength(3);
  });
});

describe('lesson player', () => {
  it('starts with the people and words, then goes one event per slide', () => {
    const root = open('#/topics/history/modern-1757-1805/1', renderChapter);
    expect(title(root)).toBe('Bengal passes to the Company');
    expect(root.textContent).toContain('People you will meet');
    expect(root.querySelectorAll('.hl-cast-card').length).toBeGreaterThan(3);
    expect(root.textContent).toContain('Words to know');
    expect(root.querySelectorAll('.hl-slide')).toHaveLength(1);

    nextBtn(root).click();
    expect(root.querySelectorAll('.hl-slide')).toHaveLength(1);
    expect(root.querySelector('.hl-dot.is-current')?.textContent).toMatch(/^\d{4}$/);
  });

  it('teaches Panipat with sides, causes, steps, result and posts on one slide', () => {
    const root = open('#/topics/history/modern-1757-1805/1', renderChapter);
    for (let i = 0; i < 20 && !title(root).includes('Panipat'); i++) nextBtn(root).click();
    expect(title(root)).toContain('Third Battle of Panipat');
    const text = root.querySelector('.hl-slide')!.textContent ?? '';
    for (const part of ['Ruler:', 'Ahmad Shah Abdali', 'Why it happened', 'What happened', 'Result', 'Losses', 'Who gained', 'Who did what', 'Remember', 'Post:']) {
      expect(text).toContain(part);
    }
    expect(text).toContain('appointed by Chhatrapati Shahu');
  });

  it('teaches treaties in full: sides, causes, every treaty and its terms', () => {
    const root = open('#/topics/history/modern-1757-1805/1', renderChapter);
    for (let i = 0; i < 20 && !title(root).includes('Allahabad'); i++) nextBtn(root).click();
    const text = root.querySelector('.hl-slide')!.textContent ?? '';
    for (const part of ['& Mughal emperor', 'Signed / negotiated by:', 'Why it happened', 'First Treaty of Allahabad', 'Second Treaty of Allahabad', 'Rs 26 lakh', 'Rs 50 lakh', 'Who gained']) {
      expect(text).toContain(part);
    }
    const r2 = open('#/topics/history/modern-1757-1805/2', renderChapter);
    for (let i = 0; i < 30 && !title(r2).includes('Salbai'); i++) nextBtn(r2).click();
    const salbai = r2.querySelector('.hl-slide')!.textContent ?? '';
    for (const part of ['Madhavrao II', 'Salsette', 'Convention of Wadgaon', 'appointed by the Barbhai council']) expect(salbai).toContain(part);
  });

  it('shows who fought / between and who led / signed when an event has no structured sides', async () => {
    const { sidesAside } = await import('../history-learn');
    const base = {
      id: 'x', title: 'X', date: { year: 1700 }, era: 'mughal' as const, lane: 'deccan' as const, summary: 's', detail: 'd',
      subtopicIds: [], relatedMcqIds: [], apSpecific: false, importance: 1 as const, source: 'x',
    };
    const battle = sidesAside({ ...base, kind: 'battle', parties: ['A', 'B'], signatories: ['C'] })!.textContent;
    expect(battle).toContain('Who fought');
    expect(battle).toContain('Led by');
    const treaty = sidesAside({ ...base, kind: 'treaty', parties: ['A'], signatories: ['C'] })!.textContent;
    expect(treaty).toContain('Between');
    expect(treaty).toContain('Signed by');
    expect(sidesAside({ ...base, kind: 'event' })).toBeNull();
    const two = sidesAside({ ...base, kind: 'treaty', sides: [{ name: 'A' }, { name: 'B', commanders: ['Z'] }] })!.textContent;
    expect(two).toContain('& B');
    expect(two).toContain('Signed / negotiated by:');
  });

  it('names every leader in "Who did what" (Buxar → Hector Munro) and numbers same-year steps', () => {
    const root = open('#/topics/history/modern-1757-1805/1', renderChapter);
    for (let i = 0; i < 20 && !title(root).includes('Buxar'); i++) nextBtn(root).click();
    const names = [...root.querySelectorAll('.hl-people .hl-person-name')].map((n) => n.textContent);
    expect(names).toContain('Hector Munro');
    expect(root.querySelector('.hl-people')?.textContent).toContain('Former Nawab of Bengal');
    const labels = [...root.querySelectorAll('.hl-dot')].map((d) => d.textContent);
    expect(labels).toContain('1765 ·1');
    expect(labels).toContain('1765 ·2');
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('ties each year to a memory hook and places it among the events before and after', () => {
    const root = open('#/topics/history/modern-1757-1805/1', renderChapter);
    for (let i = 0; i < 20 && !title(root).includes('Buxar'); i++) nextBtn(root).click();
    expect(root.querySelector('.hl-hook')?.textContent).toContain('Plassey + 7 = Buxar');
    const strip = root.querySelector('.hl-strip')!;
    expect(strip.querySelector('.is-now')?.textContent).toContain('Buxar');
    expect(strip.querySelector('.is-before .hl-strip-rel')?.textContent).toMatch(/^-\d+ yrs?$/);
    const dots = root.querySelectorAll<HTMLButtonElement>('.hl-dot');
    dots[dots.length - 1]!.click();
    expect(root.textContent).toContain('Year drill');
    expect(root.querySelectorAll('.yd-option')).toHaveLength(4);
  });

  it('jumps to a neighbour event from the time strip', () => {
    const root = open('#/topics/history/modern-1757-1805/1', renderChapter);
    for (let i = 0; i < 20 && !title(root).includes('Buxar'); i++) nextBtn(root).click();
    const befores = root.querySelectorAll<HTMLButtonElement>('.hl-strip .is-before button');
    const prev = befores[befores.length - 1]!;
    const want = prev.textContent!;
    prev.click();
    expect(title(root)).toBe(want);
  });

  it('ends with a recap table and moves on to the next lesson', () => {
    const root = open('#/topics/history/modern-1757-1805/1', renderChapter);
    const dots = root.querySelectorAll<HTMLButtonElement>('.hl-dot');
    dots[dots.length - 1]!.click();
    expect(root.querySelector('.hl-recap')).not.toBeNull();
    expect(nextBtn(root).textContent).toContain('Next lesson');
    nextBtn(root).click();
    expect(window.location.hash).toBe('#/topics/history/modern-1757-1805/2');
  });

  it('shows chapter takeaways on the last lesson and returns to the chapter', () => {
    const root = open('#/topics/history/modern-1757-1805/3', renderChapter);
    const dots = root.querySelectorAll<HTMLButtonElement>('.hl-dot');
    dots[dots.length - 1]!.click();
    expect(root.textContent).toContain('Chapter takeaways');
    expect(nextBtn(root).textContent).toContain('Back to chapter');
    nextBtn(root).click();
    expect(window.location.hash).toBe('#/topics/history/modern-1757-1805');
  });

  it('supports arrow keys and disables Back on the first slide', () => {
    const root = open('#/topics/history/modern-1757-1805/2', renderChapter);
    const back = root.querySelector<HTMLButtonElement>('.hl-pager .btn-secondary')!;
    expect(back.disabled).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(back.disabled).toBe(false);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    expect(back.disabled).toBe(true);
  });

  it('opens a person card from the cast', () => {
    const root = open('#/topics/history/modern-1757-1805/1', renderChapter);
    root.querySelector<HTMLButtonElement>('.hl-cast-card')!.click();
    expect(document.querySelector('.yx-card')).not.toBeNull();
  });
});

describe('lesson building', () => {
  it('covers every event of every chapter exactly once across its lessons', () => {
    const data = chronicleData();
    for (const c of getChapters()) {
      const ids = fragmentsOf(c).flatMap((f) => buildSlides(c, f, data, () => undefined).flatMap((s) => (s.kind === 'event' ? [s.event.id] : [])));
      expect(new Set(ids).size).toBe(ids.length);
      const inChapter = data.events.filter((e) => !e.timeless && e.date.year >= c.from && e.date.year <= c.to && (!c.lanes || c.lanes.includes(e.lane)) && (!c.apOnly || e.apSpecific)).map((e) => e.id);
      expect(ids.sort()).toEqual(inChapter.sort());
    }
  });

  it('teaches the 1857 revolt with its leaders, and the Paika uprising from NCERT', () => {
    const root = open('#/topics/history/modern-1806-1857/4', renderChapter);
    for (let i = 0; i < 30 && !title(root).includes('Revolt of 1857'); i++) nextBtn(root).click();
    const text = root.querySelector('.hl-slide')!.textContent ?? '';
    for (const name of ['Mangal Pandey', 'Bahadur Shah Zafar', 'Nana Saheb', 'Rani Lakshmibai', 'Begum Hazrat Mahal', 'Kunwar Singh', 'Tantia Tope']) expect(text).toContain(name);
    const r1 = open('#/topics/history/modern-1806-1857/1', renderChapter);
    for (let i = 0; i < 20 && !title(r1).includes('Paika'); i++) nextBtn(r1).click();
    expect(r1.querySelector('.hl-slide')!.textContent).toContain('Buxi Jagabandhu');
  });

  it('teaches the 1858–1905 chapter: the Congress, Birsa Munda and the partition of Bengal', () => {
    const r3 = open('#/topics/history/modern-1858-1905/3', renderChapter);
    for (let i = 0; i < 30 && !title(r3).includes('Indian National Congress'); i++) nextBtn(r3).click();
    expect(r3.querySelector('.hl-slide')!.textContent).toContain('72 delegates');
    const r4 = open('#/topics/history/modern-1858-1905/4', renderChapter);
    const titles: string[] = [];
    for (let i = 0; i < 30; i++) {
      titles.push(title(r4));
      nextBtn(r4).click();
      if (!r4.isConnected || window.location.hash !== '#/topics/history/modern-1858-1905/4') break;
    }
    expect(titles.some((t) => t.includes('Ulgulan'))).toBe(true);
    expect(titles.some((t) => t.includes('Partition of Bengal'))).toBe(true);
  });

  it('teaches the freedom struggle: Alluri in lesson 2 and Quit India in lesson 4', () => {
    const find = (hash: string, needle: string): string => {
      const r = open(hash, renderChapter);
      for (let i = 0; i < 40 && !title(r).includes(needle); i++) nextBtn(r).click();
      return r.querySelector('.hl-slide')?.textContent ?? '';
    };
    expect(find('#/topics/history/modern-1906-1947/2', 'Alluri')).toContain('Koyyuru');
    expect(find('#/topics/history/modern-1906-1947/4', 'Quit India Movement')).toContain('Do or Die');
  });

  it('covers every event of the chapter exactly once across its lessons (first chapter)', () => {
    const data = chronicleData();
    const c = chapter();
    const ids = fragmentsOf(c).flatMap((f) => buildSlides(c, f, data, () => undefined).flatMap((s) => (s.kind === 'event' ? [s.event.id] : [])));
    expect(new Set(ids).size).toBe(ids.length);
    const inChapter = data.events.filter((e) => !e.timeless && e.date.year >= c.from && e.date.year <= c.to && (!c.lanes || c.lanes.includes(e.lane)) && (!c.apOnly || e.apSpecific)).map((e) => e.id);
    expect(ids.sort()).toEqual(inChapter.sort());
  });

  it('puts year notes (new office holders, dated facts) on a slide', () => {
    const data = chronicleData();
    const c = chapter();
    const slides = fragmentsOf(c).flatMap((f) => buildSlides(c, f, data, () => undefined));
    const notes = slides.flatMap((s) => (s.kind === 'event' || s.kind === 'notes' ? s.notes : []));
    expect(notes.length).toBeGreaterThan(5);
    expect(slides.some((s) => s.kind === 'notes')).toBe(true);
  });

  it('defaults to one lesson when a chapter has no fragments', () => {
    const bare = { ...chapter(), fragments: undefined };
    expect(fragmentsOf(bare)).toEqual([{ title: bare.title, from: bare.from, to: bare.to }]);
  });

  it('counts only years with something to teach', () => {
    const data = chronicleData();
    const c = chapter();
    const years = chapterYears(c, data);
    expect(years.every((y) => y >= c.from && y <= c.to)).toBe(true);
    expect(years).toContain(1757);
    expect(untaughtEvents(getChapters(), data).some((e) => e.id === 'tl-plassey')).toBe(false);
  });
});

describe('event parts', () => {
  it('renders treaties with sides and terms, and skips empty parts', async () => {
    const { eventStructure, postLine } = await import('../event-parts');
    const base = {
      id: 'x', title: 'X', date: { year: 1782 }, era: 'company-rule' as const, lane: 'deccan' as const, kind: 'treaty' as const,
      summary: 's', detail: 'd', subtopicIds: [], relatedMcqIds: [], apSpecific: false, importance: 2 as const, source: 'x',
    };
    const wrap = document.createElement('div');
    wrap.append(...eventStructure({
      ...base,
      sides: [{ name: 'A', ruler: 'R' }, { name: 'B' }],
      treaties: [{ name: 'Treaty of Salbai', year: 1782, between: ['Company', 'Marathas'], terms: ['Status quo'] }, { name: 'Bare' }],
    }).filter((n): n is HTMLElement => n instanceof HTMLElement));
    expect(wrap.textContent).toContain('The two sides');
    expect(wrap.textContent).toContain('Treaty of Salbai (1782 CE)');
    expect(wrap.textContent).toContain('Between: Company and Marathas');
    expect(wrap.querySelectorAll('.ep-sides tbody tr')).toHaveLength(1);
    expect(eventStructure(base).filter(Boolean)).toHaveLength(0);

    const person = {
      id: 'p', name: 'P', category: 'ruler' as const, era: 'mughal' as const, lane: 'deccan' as const, summary: 's', facts: ['f'],
      subtopicIds: [], apSpecific: false, importance: 2 as const, source: 'x', roles: [{ title: 'King', from: 1700, to: 1710 }],
    };
    expect(postLine(person, 1705)?.textContent).toBe('Post: King (1700 CE – 1710 CE)');
    expect(postLine(person, 1800)?.textContent).toBe('Post: Former King (1700 CE – 1710 CE)');
    expect(postLine(person, 1650)).toBeNull();
    expect(postLine(person, 1800, 'Envoy')?.textContent).toBe('Post: Envoy');
  });
});

describe('placing events in time (Andhra chapter)', () => {
  const goTo = (root: HTMLElement, text: string): void => {
    for (let i = 0; i < 60 && !title(root).includes(text); i++) nextBtn(root).click();
  };

  it('every chapter peg points at an event of that chapter', () => {
    const data = chronicleData();
    for (const c of getChapters()) {
      for (const p of c.pegs ?? []) {
        const ev = data.events.find((e) => e.id === p.eventId);
        expect(ev, `${c.id}: ${p.eventId}`).toBeDefined();
        expect(ev!.date.year >= c.from && ev!.date.year <= c.to, `${c.id}: ${p.eventId} in span`).toBe(true);
        if (c.apOnly) expect(ev!.apSpecific, `${c.id}: ${p.eventId} is AP`).toBe(true);
      }
    }
  });

  it('lists the year pegs and all events at a glance on the overview', () => {
    const root = open('#/topics/history/andhra-all', renderChapter);
    expect(root.querySelector('.hl-pegs h2')?.textContent).toMatch(/Learn these \d+ year pegs first/);
    expect(root.querySelector('.hl-pegs')?.textContent).toContain('Simuka founds the Satavahana dynasty');
    expect(root.querySelector('.hl-glance summary')?.textContent).toMatch(/All \d+ events at a glance/);
  });

  it('keeps other regions\' king lists out of the Andhra-only lessons', () => {
    const root = open('#/topics/history/andhra-all/1', renderChapter);
    const dots = [...root.querySelectorAll('.hl-dot')].map((d) => d.textContent);
    expect(dots).not.toContain('544 BCE');
    expect(dots).not.toContain('492 BCE');
  });

  it('teaches the story around an event: before, after, today, peg, memory trick and exam points with their papers', () => {
    const root = open('#/topics/history/andhra-all/1', renderChapter);
    goTo(root, 'Simuka founds the Satavahana dynasty');
    const text = root.textContent ?? '';
    expect(text).toContain('The story so far');
    expect(text).toContain('What it led to');
    expect(text).toContain('Still with us today');
    expect(root.querySelector('.hl-mnemonic')?.textContent).toContain('Six Kings Sat');
    expect(root.querySelector('.hl-peg.is-peg')?.textContent).toContain('learn this one by heart');
    expect(root.querySelectorAll('.hl-exam-list > li').length).toBeGreaterThan(5);
    expect(root.querySelector('.hl-exam .hl-paper')?.textContent).toMatch(/NCERT|G-I|G-II/);
    expect(root.querySelector('.hl-kicker')?.textContent).toMatch(/Repeat topic: asked in \d+ papers/);
    expect(root.querySelector('.hl-words summary')?.textContent).toMatch(/Words on this page \(\d+\)/);
  });

  it('hangs a non-peg event on the nearest earlier peg', () => {
    const root = open('#/topics/history/andhra-all/1', renderChapter);
    goTo(root, 'Gautamiputra');
    const peg = root.querySelector('.hl-peg:not(.is-peg)')?.textContent ?? '';
    expect(peg).toContain('Hang it on a peg');
    expect(peg).toContain('Simuka');
    expect(peg).toMatch(/\+3\d\d yrs/);
  });

  it('shows paper tags apart from the fact text in quick facts', () => {
    const root = open('#/topics/history/andhra-all/1', renderChapter);
    goTo(root, 'Simuka founds the Satavahana dynasty');
    const quick = root.querySelector('.hl-remember')!;
    expect(quick.querySelector('.hl-h')?.textContent).toBe('Quick facts');
    expect(quick.textContent).not.toContain('(APPSC');
    expect(quick.querySelector('.hl-paper')?.textContent).toBe('G-II 2018');
  });

  it('ends with the story in order and an ordering game that accepts the oldest first', () => {
    const root = open('#/topics/history/andhra-all/1', renderChapter);
    const dots = root.querySelectorAll<HTMLButtonElement>('.hl-dot');
    dots[dots.length - 1]!.click();
    expect(root.querySelectorAll('.hl-chain-item').length).toBeGreaterThan(5);
    const btns = [...root.querySelectorAll<HTMLButtonElement>('.hl-order-btn')];
    expect(btns.length).toBe(6);
    const stone = btns.find((b) => b.textContent!.includes('Jwalapuram'))!;
    const other = btns.find((b) => !b.textContent!.includes('Jwalapuram'))!;
    other.click();
    expect(other.classList.contains('is-done')).toBe(false);
    stone.click();
    expect(stone.classList.contains('is-done')).toBe(true);
    expect(stone.textContent).toMatch(/^1\. /);
  });
});
