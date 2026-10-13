import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Regression (q-final, 390px Chrome): `.md-table { min-width: max-content }` is
 * declared AFTER the match-table rule with equal specificity, so a single-class
 * `.match-table { min-width: 0 }` lost and List-II was clipped inside the scroll
 * wrap. The override must out-specify `.md-table`.
 */
describe('match table CSS', () => {
  const css = readFileSync(resolve(__dirname, '../../styles/components.css'), 'utf8');
  it('overrides .md-table min-width with a higher-specificity selector', () => {
    const block = /\.md-table\.match-table\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(block).toMatch(/min-width:\s*0/);
    expect(block).toMatch(/table-layout:\s*fixed/);
  });
});
