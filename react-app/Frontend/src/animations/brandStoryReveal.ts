import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import {
  prepareCharMask,
  createFadeUpReveal,
  createStaggerReveal,
} from './textReveal'

gsap.registerPlugin(ScrollTrigger)

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

export type BrandStoryOptions = {
  container: HTMLElement
  parallaxFactor?: number
}

export type BrandStoryResult = {
  kill: () => void
}

/* ------------------------------------------------------------------ */
/* Scoped brand story animations                                      */
/* ------------------------------------------------------------------ */

export function createBrandStoryReveal({
  container,
  parallaxFactor = 1,
}: BrandStoryOptions): BrandStoryResult {
  const pf = parallaxFactor
  const scrub = Math.max(pf, 0.6)

  const scrollTriggers: ScrollTrigger[] = []
  const cleanups: (() => void)[] = []

  /* ── Background parallax zoom ── */
  const img = container.querySelector<HTMLElement>('[data-brand-img]')
  if (img) {
    const st = ScrollTrigger.create({
      trigger: container,
      start: 'top bottom',
      end: 'bottom top',
      scrub: 1.5,
      invalidateOnRefresh: true,
      onUpdate: (self) => {
        const progress = self.progress
        gsap.set(img, { scale: 1 + 0.06 * progress * pf })
      },
    })
    scrollTriggers.push(st)
  }

  /* ── Title: character mask reveal ── */
  const title = container.querySelector<HTMLElement>('[data-brand-title]')
  const titleReveal = title ? prepareCharMask(title) : null
  if (titleReveal) {
    cleanups.push(titleReveal.cleanup)
    const st = ScrollTrigger.create({
      trigger: container,
      start: 'top 75%',
      end: 'top 35%',
      scrub,
      invalidateOnRefresh: true,
      onUpdate: (self) => titleReveal.setProgress(self.progress),
    })
    scrollTriggers.push(st)
  }

  /* ── Description: fade-up reveal ── */
  const desc = container.querySelector<HTMLElement>('[data-brand-desc]')
  const descReveal = desc ? createFadeUpReveal(desc) : null
  if (descReveal) {
    cleanups.push(descReveal.cleanup)
    const st = ScrollTrigger.create({
      trigger: container,
      start: 'top 65%',
      end: 'top 35%',
      scrub: 0.8 * scrub,
      invalidateOnRefresh: true,
      onUpdate: (self) => descReveal.setProgress(self.progress),
    })
    scrollTriggers.push(st)
  }

  /* ── Stat cards: staggered fade-up ── */
  const statLines = container.querySelectorAll<HTMLElement>('[data-brand-stat]')
  const statReveal =
    statLines.length > 0
      ? createStaggerReveal(Array.from(statLines), {
          staggerDelay: 0.15,
          yOffset: 20,
        })
      : null
  if (statReveal) {
    cleanups.push(statReveal.cleanup)
    const st = ScrollTrigger.create({
      trigger: container,
      start: 'top 55%',
      end: 'top 25%',
      scrub: 0.8 * scrub,
      invalidateOnRefresh: true,
      onUpdate: (self) => statReveal.setProgress(self.progress),
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
