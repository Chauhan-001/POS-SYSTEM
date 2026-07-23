import { gsap } from 'gsap'
import {
  EASE_PREMIUM,
  EASE_SETTLE,
  EASE_BREATHE,
} from '../utils/animations'

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

export type HeroLogoAnimationOptions = {
  /** The section element containing all logo elements */
  container: HTMLElement
  /** Skip idle floating animation (for mobile/reduced-motion) */
  skipIdle?: boolean
}

export type HeroLogoAnimationResult = {
  timeline: gsap.core.Timeline
  kill: () => void
}

/* ------------------------------------------------------------------ */
/* Scoped logo entrance timeline                                      */
/* ------------------------------------------------------------------ */

/**
 * Animates the three brand logos with a cinematic entrance.
 *
 * Expects these elements INSIDE `container`:
 *  - [data-logo="chaish"]     → central logo
 *  - [data-logo="vadippa"]    → left-side logo
 *  - [data-logo="shikanji"]   → right-side logo
 *
 * Easing parity: these should remain consistent with `createHeroEntrance`
 * in `logoHeroEntrance.ts`. Differences are intentional — this module is
 * used on sub-pages (Menu, Rewards) where a shorter, punchier entrance
 * is desired vs. the landing page's more drawn-out reveal.
 */
export function createHeroLogoAnimation({
  container,
  skipIdle = false,
}: HeroLogoAnimationOptions): HeroLogoAnimationResult {
  const tl = gsap.timeline({ paused: true })

  const chaish = container.querySelector<HTMLElement>('[data-logo="chaish"]')
  const vadippa = container.querySelector<HTMLElement>('[data-logo="vadippa"]')
  const shikanji =
    container.querySelector<HTMLElement>('[data-logo="shikanji"]')

  /* ── Step 0: Initial state ── */
  gsap.set(chaish, {
    opacity: 0,
    filter: 'blur(12px)',
    scale: 0.8,
  })
  gsap.set(vadippa, {
    x: -700,
    rotation: -20,
    opacity: 0,
  })
  gsap.set(shikanji, {
    x: 700,
    rotation: 20,
    opacity: 0,
  })

  /* ── Step 1: CHAISH fades in ── */
  tl.to(
    chaish,
    {
      opacity: 1,
      filter: 'blur(0px)',
      scale: 1,
      duration: 1.2,
      ease: EASE_PREMIUM,
    },
    0
  )

  /* ── Step 2: Vadippa enters from left on a curved path ── */
  tl.to(
    vadippa,
    {
      keyframes: [
        { x: '-80%', y: '12%', rotation: -14, opacity: 0.3, scale: 0.82 },
        { x: '-35%', y: '-4%', rotation: -6, opacity: 0.7, scale: 0.92 },
        { x: '-8%', y: '3%', rotation: -1, opacity: 1, scale: 0.98 },
        { x: '0%', y: '0%', rotation: 0, opacity: 1, scale: 1 },
      ],
      duration: 1.6,
      ease: EASE_SETTLE,
    },
    0.4
  )

  /* ── Step 3: Shikanji enters from right on a mirrored curved path ── */
  tl.to(
    shikanji,
    {
      keyframes: [
        { x: '80%', y: '-12%', rotation: 14, opacity: 0.3, scale: 0.82 },
        { x: '35%', y: '4%', rotation: 6, opacity: 0.7, scale: 0.92 },
        { x: '8%', y: '-3%', rotation: 1, opacity: 1, scale: 0.98 },
        { x: '0%', y: '0%', rotation: 0, opacity: 1, scale: 1 },
      ],
      duration: 1.6,
      ease: EASE_SETTLE,
    },
    0.55
  )

  /* ── Step 4: Idle floating animation — repeat infinitely ── */
  if (!skipIdle) {
    if (vadippa) {
      tl.to(
        vadippa,
        {
          y: -6,
          rotation: -1,
          duration: 4,
          ease: 'sine.inOut',
          yoyo: true,
          repeat: -1,
        },
        '>'
      )
    }
    if (shikanji) {
      tl.to(
        shikanji,
        {
          y: -6,
          rotation: 1,
          duration: 4,
          ease: 'sine.inOut',
          yoyo: true,
          repeat: -1,
        },
        '<'
      )
    }
    if (chaish) {
      tl.to(
        chaish,
        {
          y: -6,
          duration: 4,
          ease: EASE_BREATHE,
          yoyo: true,
          repeat: -1,
        },
        '<'
      )
    }
  }

  return {
    timeline: tl,
    kill: () => {
      tl.kill()
    },
  }
}
