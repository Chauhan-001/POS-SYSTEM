/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Animation constants for the guided tour.
 * All durations stay within 220-400ms. Only transform, opacity, scale are animated.
 */

import type { Transition } from 'motion/react';

/** Custom bezier easings */
export const ease = {
  /** Accelerate, overshoot, settle */
  anticipate: [0.68, -0.2, 0.32, 1.2] as [number, number, number, number],
  /** Smooth deceleration */
  out: [0.16, 1, 0.3, 1] as [number, number, number, number],
  /** Gentle ease-out */
  gentle: [0.22, 1, 0.36, 1] as [number, number, number, number],
  /** Ease-in-out */
  inOut: [0.65, 0, 0.35, 1] as [number, number, number, number],
};

/** Spring presets for natural-feeling motion */
export const spring = {
  tooltip: { stiffness: 300, damping: 25, mass: 0.6 },
  pointer: { stiffness: 180, damping: 14, mass: 0.5 },
  glow: { stiffness: 200, damping: 20, mass: 0.8 },
  arrow: { stiffness: 150, damping: 18, mass: 0.7 },
};

/** Reusable transition presets */
export const transitions: Record<string, Transition> = {
  tooltipEnter: { duration: 0.3, ease: ease.out },
  tooltipExit: { duration: 0.22, ease: ease.gentle },
  overlay: { duration: 0.25, ease: ease.out },
  highlightPulse: { duration: 2.5, repeat: Infinity, ease: 'easeInOut' },
  arrowDraw: { duration: 0.35, ease: ease.gentle },
  pointerTravel: { duration: 0.6, ease: ease.gentle },
  clickRipple: { duration: 0.38, ease: ease.out },
};

/** Timing constants (milliseconds) */
export const timing = {
  /** Wait for React state to commit */
  reactCommit: 50,
  /** Wait for DOM to paint */
  domRender: 120,
  /** Pointer travel time between targets */
  pointerTravel: 600,
  /** Pause for user to read tooltip */
  readingPause: 200,
  /** How long the click animation lasts */
  clickDuration: 400,
  /** Max retries to find a DOM target */
  maxTargetRetries: 8,
  /** Interval between retries */
  targetRetryInterval: 150,
  /** Gap between step animations */
  stepGap: 300,
  /** Scroll animation duration */
  scrollDuration: 400,
  /** Smooth scroll offset from top (40%) */
  scrollTargetOffset: 0.4,
};
