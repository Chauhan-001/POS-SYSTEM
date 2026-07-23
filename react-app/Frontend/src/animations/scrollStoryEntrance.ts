import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import {
  EASE_REVEAL,
  EASE_ELASTIC,
  EASE_BREATHE,
  EASE_QUICK,
} from '../utils/animations'

gsap.registerPlugin(ScrollTrigger)

/** Scroll-driven scrub ease */
const EASE_SCRUB = 'power2.inOut'

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

export type ScrollStoryOptions = {
  container: HTMLElement
  speed?: number
  skipIdle?: boolean
}

export type ScrollStoryResult = {
  timeline: gsap.core.Timeline
  kill: () => void
}

/* ------------------------------------------------------------------ */
/* Scoped scroll-story timeline                                       */
/* ------------------------------------------------------------------ */

/**
 * Builds a pinned, scrubbed GSAP timeline for the product scroll story.
 *
 * Expects these elements INSIDE `container`:
 *  - [data-product="vadapav"]  → Vada Pav image (enters from right)
 *  - [data-product="chai"]     → Chai image (enters from left)
 *  - [data-story-title]       → headline
 *  - [data-story-subtitle]    → subtitle
 *  - [data-story-tagline]     → tagline
 */
export function createScrollStory({
  container,
  speed = 1,
  skipIdle = false,
}: ScrollStoryOptions): ScrollStoryResult {
  const S = (n: number) => n / speed

  const vadaPav = container.querySelector<HTMLElement>(
    '[data-product="vadapav"]'
  )
  const chai = container.querySelector<HTMLElement>(
    '[data-product="chai"]'
  )
  const title = container.querySelector<HTMLElement>('[data-story-title]')
  const subtitle = container.querySelector<HTMLElement>(
    '[data-story-subtitle]'
  )
  const tagline = container.querySelector<HTMLElement>(
    '[data-story-tagline]'
  )

  const tl = gsap.timeline({
    scrollTrigger: {
      trigger: container,
      start: 'top top',
      end: '+=250%',
      scrub: 2.5,
      pin: true,
      anticipatePin: 1,
      invalidateOnRefresh: true,
    },
    defaults: { ease: EASE_SCRUB },
  })

  // steup: hide text initially
  gsap.set(title, { opacity: 0, y: 60, scale: 0.92 })
  gsap.set(subtitle, { opacity: 0, y: 30 })
  gsap.set(tagline, { opacity: 0, y: 20 })

  // ── Step 1: Vada Pav enters from right on a curved arc ──
  tl.fromTo(
    vadaPav,
    { x: '150%', y: '30%', rotation: 22, scale: 0.75, opacity: 0 },
    {
      keyframes: [
        { x: '100%', y: '22%', rotation: 15, opacity: 0.3, scale: 0.8 },
        { x: '50%', y: '10%', rotation: 6, opacity: 0.6, scale: 0.88 },
        { x: '20%', y: '2%', rotation: 2, opacity: 0.9, scale: 0.96 },
        { x: '0%', y: '0%', rotation: 0, opacity: 1, scale: 1 },
      ],
      duration: S(1.6),
      ease: EASE_ELASTIC,
    },
    0
  )

  // ── Step 2: Chai enters from left on a curved arc ──
  tl.fromTo(
    chai,
    { x: '-150%', y: '-30%', rotation: -22, scale: 0.75, opacity: 0 },
    {
      keyframes: [
        { x: '-100%', y: '-22%', rotation: -15, opacity: 0.3, scale: 0.8 },
        { x: '-50%', y: '-10%', rotation: -6, opacity: 0.6, scale: 0.88 },
        { x: '-20%', y: '-2%', rotation: -2, opacity: 0.9, scale: 0.96 },
        { x: '0%', y: '0%', rotation: 0, opacity: 1, scale: 1 },
      ],
      duration: S(1.6),
      ease: EASE_ELASTIC,
    },
    S(0.15)
  )

  // ── Step 3: Title reveals as products arrive ──
  tl.to(
    title,
    {
      opacity: 1,
      y: 0,
      scale: 1,
      duration: S(1),
      ease: EASE_REVEAL,
    },
    S(0.5)
  )

  // ── Step 4: Subtitle fades in ──
  tl.to(
    subtitle,
    {
      opacity: 1,
      y: 0,
      duration: S(0.7),
      ease: EASE_REVEAL,
    },
    S(0.7)
  )

  // ── Step 5: Tagline ──
  tl.to(
    tagline,
    {
      opacity: 1,
      y: 0,
      duration: S(0.5),
      ease: EASE_QUICK,
    },
    S(0.9)
  )

  // ── Step 6: Idle floating (after everything settles) ──
  if (!skipIdle) {
    if (vadaPav) {
      tl.to(
        vadaPav,
        {
          y: -5,
          rotation: -0.8,
          duration: 3.2,
          ease: EASE_BREATHE,
          yoyo: true,
          repeat: -1,
        },
        S(1.6)
      )
    }
    if (chai) {
      tl.to(
        chai,
        {
          y: 3,
          rotation: 0.6,
          duration: 2.8,
          ease: EASE_BREATHE,
          yoyo: true,
          repeat: -1,
        },
        S(1.6)
      )
    }
  }

  return {
    timeline: tl,
    kill: () => {
      tl.scrollTrigger?.kill()
      tl.kill()
    },
  }
}
