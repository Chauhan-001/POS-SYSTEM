/* ------------------------------------------------------------------ */
/* Shared GSAP easing constants — curated for a heavy, premium feel   */
/* Used across all animation modules.                                 */
/* ------------------------------------------------------------------ */

/** Smooth scroll-driven transitions (power3 in/out) */
export const EASE_PREMIUM = 'power3.inOut'

/** Spring-like settle with a heavier feel — slight overshoot */
export const EASE_SETTLE = 'back.out(1.4)'

/** Idle / breathing ease — gentle sine wave */
export const EASE_BREATHE = 'sine.inOut'

/** Elastic settle for product landings — heavier bounce */
export const EASE_ELASTIC = 'elastic.out(0.6, 0.3)'

/** Quick power-out for UI elements */
export const EASE_QUICK = 'power2.out'

/** Text / UI reveals — decelerating ease, starts fast ends slow */
export const EASE_REVEAL = 'power3.out'
