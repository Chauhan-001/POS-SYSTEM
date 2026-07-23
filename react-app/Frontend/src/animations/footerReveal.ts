import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger)

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

export type FooterRevealOptions = {
  container: HTMLElement
}

export type FooterRevealResult = {
  kill: () => void
}

/* ------------------------------------------------------------------ */
/* Scoped footer reveal                                               */
/* ------------------------------------------------------------------ */

/**
 * Creates scroll-driven reveal for the footer logo and text links.
 *
 * Expects these elements INSIDE `container`:
 *  - [data-footer-logo]  → footer logo image
 *  - [data-footer-text]  → text elements (copyright, links)
 */
export function createFooterReveal({
  container,
}: FooterRevealOptions): FooterRevealResult {
  const scrollTriggers: ScrollTrigger[] = []

  // Logo: scale + fade in
  const logo = container.querySelector<HTMLElement>('[data-footer-logo]')
  if (logo) {
    const st = ScrollTrigger.create({
      trigger: container,
      start: 'top 85%',
      end: 'top 55%',
      scrub: 1,
      invalidateOnRefresh: true,
      onUpdate: (self) => {
        const p = self.progress
        gsap.set(logo, {
          scale: 0.7 + p * 0.3,
          opacity: p,
        })
      },
    })
    scrollTriggers.push(st)
  }

  // Text elements: staggered fade + slide up
  const texts = container.querySelectorAll<HTMLElement>('[data-footer-text]')
  if (texts.length) {
    const st = ScrollTrigger.create({
      trigger: container,
      start: 'top 75%',
      end: 'top 45%',
      scrub: 0.8,
      invalidateOnRefresh: true,
      onUpdate: (self) => {
        const p = self.progress
        texts.forEach((el) => {
          const delay = 0
          const localP = Math.max(0, Math.min(1, (p - delay) / (1 - delay)))
          gsap.set(el, {
            y: (1 - localP) * 20,
            opacity: localP,
          })
        })
      },
    })
    scrollTriggers.push(st)
  }

  return {
    kill: () => {
      scrollTriggers.forEach((st) => st.kill())
    },
  }
}
