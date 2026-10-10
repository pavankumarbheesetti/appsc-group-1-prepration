import { describe, it, expect } from 'vitest';
import { buildMainsNotesSection } from '../notes';
import { getSubtopic } from '../../content/loader';

/**
 * Finalizer check: a REAL subtopic that carries a `mains`-tagged "For Mains"
 * note must render through buildMainsNotesSection as the collapsed <details>
 * section the mains-support change introduced.
 */
describe('notes — real mains-angle note renders', () => {
  it('renders the Stone Age For-Mains note in a collapsed <details>', () => {
    const stone = getSubtopic('hist-ancient-stone-age');
    const mainsNotes = (stone?.notes ?? []).filter((n) =>
      (n.tags ?? []).includes('mains'),
    );
    expect(mainsNotes.length).toBeGreaterThanOrEqual(1);

    const section = buildMainsNotesSection(mainsNotes, 'note-mains');
    expect(section).not.toBeNull();
    expect(section!.tagName.toLowerCase()).toBe('details');
    expect(section!.hasAttribute('open')).toBe(false);
    expect(section!.textContent).toContain('For Mains');
    expect(section!.textContent).toContain('Prehistoric Cultures');
  });
});
