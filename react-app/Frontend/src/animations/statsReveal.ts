import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger)

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

export type StatsRevealOptions = {
  container: HTMLElement
}

export type StatsRevealResult = {
  kill: () => void
}

/* ------------------------------------------------------------------ */
/* Scoped stats cards reveal                                          */
/* ------------------------------------------------------------------ */

/**
 * Creates scroll-driven staggered reveal for stat cards.
 *
 * Expects these elements INSIDE `container`:
 *  - [data-stat-card]  → stat cards (up to 4)
 */
export function createStatsReveal({
  container,
}: StatsRevealOptions): StatsRevealResult {
  const scrollTriggers: ScrollTrigger[] = []

  const statCards = container.querySelectorAll<HTMLElement>('[data-stat-card]')

  if (statCards.length) {
    const st = ScrollTrigger.create({
      trigger: container,
      start: 'top 80%',
      end: 'top 30%',
      scrub: 1.2,
      invalidateOnRefresh: true,
      onUpdate: (self) => {
        const p = self.progress
        statCards.forEach((card, i) => {
          const delay = i * 0.18
          const localP = Math.max(0, Math.min(1, (p - delay) / (1 - delay)))
          gsap.set(card, {
            y: (1 - localP) * 50,
            scale: 0.85 + localP * 0.15,
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
