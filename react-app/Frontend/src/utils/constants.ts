/* ------------------------------------------------------------------ */
/* Device detection — shared across all sections                      */
/* ------------------------------------------------------------------ */

/**
 * `true` when the user is on a touch-capable device (mobile / tablet).
 * Cached at module level — evaluated once on load.
 */
export const IS_MOBILE: boolean =
  typeof window !== 'undefined' &&
  ('ontouchstart' in window || navigator.maxTouchPoints > 0)

/**
 * Parallax intensity multiplier — reduces scroll-driven animation
 * displacement on mobile for performance and visual comfort.
 */
export const PF: number = IS_MOBILE ? 0.4 : 1
