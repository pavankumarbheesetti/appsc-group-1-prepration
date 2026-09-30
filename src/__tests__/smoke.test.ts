import { describe, it, expect } from 'vitest';
import { APP_NAME, TOTAL_MARKS, CONFIG } from '../config';

// Trivial smoke test: proves Vitest runs and config is importable/typed.
describe('config', () => {
  it('exposes the app name', () => {
    expect(APP_NAME).toBe('APPSC Group-1 Preparation');
  });

  it('has the expected total marks', () => {
    expect(TOTAL_MARKS).toBe(825);
    expect(CONFIG.totalMarks).toBe(TOTAL_MARKS);
  });
});
