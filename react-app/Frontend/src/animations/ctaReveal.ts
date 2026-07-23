import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { prepareCharMask, createFadeUpReveal, createButtonReveal } from './textReveal'

gsap.registerPlugin(ScrollTrigger)

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

export type CTARevealOptions = {
  container: HTMLElement
  parallaxFactor?: number
}

export type CTARevealResult = {
  kill: () => void
}

/* ------------------------------------------------------------------ */
/* Scoped CTA section reveal                                          */
/* ------------------------------------------------------------------ */

export function createCTAReveal({
  container,
  parallaxFactor = 1,
}: CTARevealOptions): CTARevealResult {
  const pf = parallaxFactor
  const scrollTriggers: ScrollTrigger[] = []
  const cleanups: (() => void)[] = []

  /* ── Brand logos: staggered fade + scale ── */
  const logos = container.querySelectorAll<HTMLElement>('[data-cta-logo]')
  if (logos.length) {
    const st = ScrollTrigger.create({
      trigger: container,
      start: 'top 80%',
      end: 'top 40%',
      scrub: 1.2,
      invalidateOnRefresh: true,
      onUpdate: (self) => {
        const p = self.progress
        logos.forEach((logo, i) => {
          const delay = i * 0.15
          const localP = Math.max(0, Math.min(1, (p - delay) / (1 - delay)))
          gsap.set(logo, {
            y: (1 - localP) * 30 * pf,
            scale: 0.85 + localP * 0.15,
            opacity: localP,
          })
        })
      },
    })
    scrollTriggers.push(st)
  }

  /* ── Headline: character mask reveal ── */
  const headline = container.querySelector<HTMLElement>('[data-cta-headline]')
  const headlineReveal = headline ? prepareCharMask(headline) : null
  if (headlineReveal) {
    cleanups.push(headlineReveal.cleanup)
    const st = ScrollTrigger.create({
      trigger: container,
      start: 'top 70%',
      end: 'top 35%',
      scrub: 1,
      invalidateOnRefresh: true,
      onUpdate: (self) => headlineReveal.setProgress(self.progress),
    })
    scrollTriggers.push(st)
  }

  /* ── Tagline: fade-up reveal ── */
  const tagline = container.querySelector<HTMLElement>('[data-cta-tagline]')
  const taglineReveal = tagline ? createFadeUpReveal(tagline, { yOffset: 20 }) : null
  if (taglineReveal) {
    cleanups.push(taglineReveal.cleanup)
    const st = ScrollTrigger.create({
      trigger: container,
      start: 'top 60%',
      end: 'top 30%',
      scrub: 0.8,
      invalidateOnRefresh: true,
      onUpdate: (self) => taglineReveal.setProgress(self.progress),
    })
    scrollTriggers.push(st)
  }

  /* ── CTA buttons: fade + scale reveal ── */
  const button = container.querySelector<HTMLElement>('[data-cta-button]')
  const buttonReveal = button
    ? createButtonReveal(button, { startScale: 0.88, startOpacity: 0 })
    : null
  if (buttonReveal) {
    cleanups.push(buttonReveal.cleanup)
    const st = ScrollTrigger.create({
      trigger: container,
      start: 'top 55%',
      end: 'top 25%',
      scrub: 0.8,
      invalidateOnRefresh: true,
      onUpdate: (self) => buttonReveal.setProgress(self.progress),
    })
    scrollTriggers.push(st)
  }

  return {
    kill: () => {
      scrollTriggers.forEach((st) => st.kill())
      cleanups.forEach((fn) => fn())
    },
  }
}
