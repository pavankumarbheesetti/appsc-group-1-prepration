import { describe, it, expect } from 'vitest';
import { validateAllContent } from '../validate';

// The content-integrity gate, run as part of the normal test suite. It executes
// the SAME validation logic as the `validate:content` CLI (shared from
// `src/content/validate.ts`) over every bank on disk and asserts zero failures,
// so a malformed bank breaks `npm test` — not just the standalone gate.
describe('content integrity gate', () => {
  const results = validateAllContent();

  it('discovers the manifest and all seed banks', () => {
    // 4 banks (mcq/notes/mains/syllabus) + the manifest.
    expect(results.length).toBeGreaterThanOrEqual(5);
    expect(results.some((r) => r.file.endsWith('/manifest.json'))).toBe(true);
  });

  it('has zero failing files', () => {
    const failures = results
      .filter((r) => !r.ok)
      .map((r) => ({ file: r.file, errors: r.errors }));
    // Empty array on success gives a readable diff listing offenders otherwise.
    expect(failures).toEqual([]);
  });
});
