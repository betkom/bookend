export function storyIndex(index: number, count: number, step = 0) {
  return Math.max(0, Math.min(Math.max(0, count - 1), index + step));
}

/** Ignore taps and vertical page scrolling; a deliberate horizontal swipe changes the card. */
export function swipeStep(dx: number, dy: number): -1 | 0 | 1 {
  return Math.abs(dx) >= 45 && Math.abs(dx) > Math.abs(dy) * 1.4 ? dx < 0 ? 1 : -1 : 0;
}
