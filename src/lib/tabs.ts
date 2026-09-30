/**
 * Pure keyboard-navigation logic for the WAI-ARIA "tabs" pattern.
 *
 * Factored out of the DOM so the roving-tabindex / arrow-key behaviour can be
 * unit-tested in isolation. Given the pressed key, the current tab index, and
 * the number of tabs, {@link nextTabIndex} returns the index that should become
 * active+focused — or `null` when the key is not a tab-navigation key (so the
 * caller can ignore it and let the event through).
 *
 * Follows the APG "tabs with automatic activation" keys:
 *   - Left / Up    → previous tab (wraps to the last),
 *   - Right / Down → next tab (wraps to the first),
 *   - Home         → first tab,
 *   - End          → last tab.
 * Horizontal (Left/Right) and vertical (Up/Down) arrows are both accepted so
 * the helper suits either tablist orientation.
 */
export function nextTabIndex(key: string, current: number, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return (current + 1) % count;
    case 'ArrowLeft':
    case 'ArrowUp':
      return (current - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}
