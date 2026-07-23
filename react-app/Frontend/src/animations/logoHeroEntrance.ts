import { gsap } from 'gsap'
import { EASE_PREMIUM, EASE_SETTLE, EASE_BREATHE } from '../utils/animations'

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

export type HeroEntranceOptions = {
  container: HTMLElement
  speed?: number
  skipIdle?: boolean
}

/* ------------------------------------------------------------------ */
/* Triangular Logo Entrance Timeline                                  */
/*                                                                      */
/* Logo layout (inside container):                                     */
/*               CHAISH (centered)                                      */
/*              ↙        ↘                                             */
/*          Vadippa    Shikanji                                         */
/*          (flex row below Chaish)                                     */
/*                                                                      */
/* Animation flow:                                                     */
/*   0.0s — Chaish: scale 0.6→1, opacity 0→1  [EASE_PREMIUM]          */
/*   0.3s — Vadippa: from bottom-left           [EASE_SETTLE]          */
/*   0.4s — Shikanji: from bottom-right          [EASE_SETTLE]          */
/*   1.2s — Headline: fade up                    [EASE_PREMIUM]         */
/*   1.5s — Subtitle: fade up                   [EASE_PREMIUM]         */
/*   1.8s — CTA: fade up                        [EASE_QUICK]           */
/*   2.4s — Idle floating starts                                      */
/*                                                                      */
/* Every entrance has anticipation → acceleration → overshoot → settle */
/* ------------------------------------------------------------------ */

export function createHeroEntrance({
  container,
  speed = 1,
  skipIdle = false,
}: HeroEntranceOptions): gsap.core.Timeline {
  const S = (n: number) => n / speed

  const chaish = container.querySelector<HTMLElement>('[data-logo="chaish"]')
  const vadippa = container.querySelector<HTMLElement>('[data-logo="vadippa"]')
  const shikanji = container.querySelector<HTMLElement>('[data-logo="shikanji"]')
  const headline = container.querySelector<HTMLElement>('[data-hero-headline]')
  const subtitle = container.querySelector<HTMLElement>('[data-hero-subtitle]')
  const cta = container.querySelector<HTMLElement>('[data-hero-cta]')

  const tl = gsap.timeline({ paused: true })

  /* ── Step 0: Initial state ── */
  gsap.set(chaish, {
    scale: 0.6,
    opacity: 0,
    rotation: -3,
  })

  gsap.set(vadippa, {
    x: '-140%',
    y: '60%',
    rotation: -18,
    opacity: 0,
    scale: 0.7,
  })

  gsap.set(shikanji, {
    x: '140%',
    y: '60%',
    rotation: 18,
    opacity: 0,
    scale: 0.7,
  })

  gsap.set(headline, { opacity: 0, y: 40 })
  gsap.set(subtitle, { opacity: 0, y: 24 })
  gsap.set(cta, { opacity: 0, y: 20 })

  /* ── Step 1: Chaish — anticipates with slight rotation, settles center ── */
  tl.to(
    chaish,
    {
      scale: 1,
      opacity: 1,
      rotation: 0,
      duration: S(1.4),
      ease: EASE_PREMIUM,
    },
    0
  )

  /* ── Step 2: Vadippa — arcs in from bottom-left with overshoot ── */
  tl.to(
    vadippa,
    {
      keyframes: [
        { x: '-80%', y: '18%', rotation: -14, opacity: 0.25, scale: 0.78 },
        { x: '-40%', y: '6%', rotation: -6, opacity: 0.55, scale: 0.88 },
        { x: '-10%', y: '-2%', rotation: -1, opacity: 0.85, scale: 0.96 },
        { x: '0%', y: '0%', rotation: 0, opacity: 1, scale: 1 },
      ],
      duration: S(1.8),
      ease: EASE_SETTLE,
    },
    S(0.35)
  )

  /* ── Step 3: Shikanji — arcs in from bottom-right with overshoot ── */
  tl.to(
    shikanji,
    {
      keyframes: [
        { x: '80%', y: '18%', rotation: 14, opacity: 0.25, scale: 0.78 },
        { x: '40%', y: '6%', rotation: 6, opacity: 0.55, scale: 0.88 },
        { x: '10%', y: '-2%', rotation: 1, opacity: 0.85, scale: 0.96 },
        { x: '0%', y: '0%', rotation: 0, opacity: 1, scale: 1 },
      ],
      duration: S(1.8),
      ease: EASE_SETTLE,
    },
    S(0.45)
  )

  /* ── Step 4: Headline fades up ── */
  tl.to(
    headline,
    {
      opacity: 1,
      y: 0,
      duration: S(0.9),
      ease: EASE_PREMIUM,
    },
    S(1.2)
  )

  /* ── Step 5: Subtitle fades up ── */
  tl.to(
    subtitle,
    {
      opacity: 1,
      y: 0,
      duration: S(0.7),
      ease: EASE_PREMIUM,
    },
    S(1.5)
  )

  /* ── Step 6: CTA fades up ── */
  tl.to(
    cta,
    {
      opacity: 1,
      y: 0,
      duration: S(0.6),
      ease: 'power3.out',
    },
    S(1.8)
  )

  /* ── Step 7: Idle floating — gentle breathing ── */
  if (!skipIdle) {
    if (chaish) {
      tl.to(
        chaish,
        {
          scale: 1.02,
          duration: 4,
          ease: EASE_BREATHE,
          yoyo: true,
          repeat: -1,
        },
        S(2.4)
      )
    }

    if (vadippa) {
      tl.to(
        vadippa,
        {
          y: -4,
          rotation: 0.8,
          duration: 4.4,
          ease: EASE_BREATHE,
          yoyo: true,
          repeat: -1,
        },
        S(2.4)
      )
    }

    if (shikanji) {
      tl.to(
        shikanji,
        {
          y: 3,
          rotation: -0.6,
          duration: 3.8,
          ease: EASE_BREATHE,
          yoyo: true,
          repeat: -1,
        },
        S(2.4)
      )
    }
  }

  return tl
}

/* ------------------------------------------------------------------ */
/* Layered Steam — configurable rise animation                        */
/* ------------------------------------------------------------------ */

export type SteamRiseOptions = {
  y?: number
  opacity?: number
  scale?: number
  duration?: number
}

/**
 * Continuous steam-rise animation on an element.
 * Supports configurable distance, opacity, scale, and speed
 * for layered depth (multiple steam overlays).
 *
 * Cleans up `will-change` on kill.
 */
export function createSteamRise(
  element: HTMLElement,
  opts: SteamRiseOptions = {}
): gsap.core.Tween {
  const { y = -40, opacity = 0.15, scale = 1.15, duration = 3.2 } = opts

  element.style.willChange = 'transform'

  const tween = gsap.to(element, {
    y,
    opacity,
    scale,
    duration,
    repeat: -1,
    yoyo: true,
    ease: 'power1.inOut',
  })

  const originalKill = tween.kill.bind(tween) as any
  tween.kill = () => {
    element.style.willChange = ''
    originalKill()
  }

  return tween
}
