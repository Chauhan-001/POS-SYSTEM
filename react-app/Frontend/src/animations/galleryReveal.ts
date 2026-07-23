import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { prepareCharMask, createFadeUpReveal } from './textReveal'

gsap.registerPlugin(ScrollTrigger)

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

export type GalleryRevealOptions = {
  container: HTMLElement
  parallaxFactor?: number
}

export type GalleryRevealResult = {
  kill: () => void
}

/* ------------------------------------------------------------------ */
/* Scoped gallery reveal                                              */
/* ------------------------------------------------------------------ */

export function createGalleryReveal({
  container,
  parallaxFactor = 1,
}: GalleryRevealOptions): GalleryRevealResult {
  const pf = parallaxFactor
  const scrollTriggers: ScrollTrigger[] = []
  const cleanups: (() => void)[] = []

  /* ── Section title: character mask reveal ── */
  const title = container.querySelector<HTMLElement>('[data-gallery-title]')
  const titleReveal = title ? prepareCharMask(title) : null
  if (titleReveal) {
    cleanups.push(titleReveal.cleanup)
    const st = ScrollTrigger.create({
      trigger: title,
      start: 'top 85%',
      end: 'top 55%',
      scrub: 1,
      invalidateOnRefresh: true,
      onUpdate: (self) => titleReveal.setProgress(self.progress),
    })
    scrollTriggers.push(st)
  }

  /* ── Subtitle: fade-up reveal ── */
  const sub = container.querySelector<HTMLElement>('[data-gallery-sub]')
  const subReveal = sub ? createFadeUpReveal(sub, { yOffset: 16 }) : null
  if (subReveal) {
    cleanups.push(subReveal.cleanup)
    const st = ScrollTrigger.create({
      trigger: sub,
      start: 'top 75%',
      end: 'top 50%',
      scrub: 0.8,
      invalidateOnRefresh: true,
      onUpdate: (self) => subReveal.setProgress(self.progress),
    })
    scrollTriggers.push(st)
  }

  /* ── Gallery items: each one gets its own parallax reveal ── */
  const items = container.querySelectorAll<HTMLElement>('[data-gallery-item]')
  items.forEach((item, i) => {
    const isEven = i % 2 === 0
    const entryX = isEven ? -40 : 40
    const st = ScrollTrigger.create({
      trigger: item,
      start: 'top 85%',
      end: 'top 40%',
      scrub: 1.2,
      invalidateOnRefresh: true,
      onUpdate: (self) => {
        const p = self.progress
        const easedP = 1 - Math.pow(1 - p, 1.5)
        gsap.set(item, {
          x: entryX * (1 - easedP) * pf,
          y: (1 - easedP) * 30 * pf,
          scale: 0.88 + easedP * 0.12,
          opacity: easedP,
          rotation: isEven ? (1 - easedP) * 3 : -(1 - easedP) * 3,
        })
      },
    })
    scrollTriggers.push(st)
  })

  /* ── Decorative elements: subtle parallax drift ── */
  const decors = container.querySelectorAll<HTMLElement>('[data-decor]')
  decors.forEach((decor) => {
    const speed = parseFloat(decor.dataset.decorSpeed || '0.3')
    const st = ScrollTrigger.create({
      trigger: container,
      start: 'top bottom',
      end: 'bottom top',
      scrub: 1.5,
      invalidateOnRefresh: true,
      onUpdate: (self) => {
        const p = self.progress - 0.5
        gsap.set(decor, {
          y: p * 60 * speed * pf,
          rotation: p * 4 * speed,
          opacity: 0.15 + Math.abs(p) * 0.2,
        })
      },
    })
    scrollTriggers.push(st)
  })

  return {
    kill: () => {
      scrollTriggers.forEach((st) => st.kill())
      cleanups.forEach((fn) => fn())
    },
  }
}
