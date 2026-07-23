import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { prepareCharMask, createFadeUpReveal } from './textReveal'

gsap.registerPlugin(ScrollTrigger)

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

export type MenuPreviewOptions = {
  container: HTMLElement
  parallaxFactor?: number
}

export type MenuPreviewResult = {
  kill: () => void
}

/* ------------------------------------------------------------------ */
/* Scoped menu-preview reveals                                        */
/* ------------------------------------------------------------------ */

export function createMenuPreviewReveal({
  container,
  parallaxFactor = 1,
}: MenuPreviewOptions): MenuPreviewResult {
  const pf = parallaxFactor
  const scrollTriggers: ScrollTrigger[] = []
  const cleanups: (() => void)[] = []

  function makeStTrigger(
    triggerEl: HTMLElement,
    start: string,
    end: string,
    scrubVal: number,
    onUpdate: (p: number) => void
  ) {
    const st = ScrollTrigger.create({
      trigger: triggerEl,
      start,
      end,
      scrub: scrubVal,
      invalidateOnRefresh: true,
      onUpdate: (self) => onUpdate(self.progress),
    })
    scrollTriggers.push(st)
  }

  /* ── Eatables heading: character mask reveal ── */
  const eatHeading = container.querySelector<HTMLElement>(
    '[data-reveal="eat-heading"]'
  )
  const eatHeadingReveal = eatHeading ? prepareCharMask(eatHeading) : null
  if (eatHeadingReveal) {
    cleanups.push(eatHeadingReveal.cleanup)
    const section = eatHeading!.closest('[data-section]')
    if (section) {
      makeStTrigger(
        section as HTMLElement,
        'top 75%',
        'top 40%',
        1,
        (p) => eatHeadingReveal.setProgress(p)
      )
    }
  }

  /* ── Eatables subtitle: fade-up reveal ── */
  const eatSub = container.querySelector<HTMLElement>(
    '[data-reveal="eat-sub"]'
  )
  const eatSubReveal = eatSub ? createFadeUpReveal(eatSub) : null
  if (eatSubReveal) {
    cleanups.push(eatSubReveal.cleanup)
    const section = eatSub!.closest('[data-section]')
    if (section) {
      makeStTrigger(
        section as HTMLElement,
        'top 65%',
        'top 40%',
        0.8,
        (p) => eatSubReveal.setProgress(p)
      )
    }
  }

  /* ── Eatables cards: staggered fade + slide + scale ── */
  const eatCards = container.querySelectorAll<HTMLElement>(
    '[data-section="eatables"] [data-card]'
  )
  if (eatCards.length) {
    const section = eatCards[0].closest('[data-section]')
    if (section) {
      makeStTrigger(
        section as HTMLElement,
        'top 55%',
        'top 15%',
        1.5,
        (p) => {
          eatCards.forEach((card, i) => {
            const delay = i * 0.12
            const localP = Math.max(0, Math.min(1, (p - delay) / (1 - delay)))
            gsap.set(card, {
              y: (1 - localP) * 50 * pf,
              scale: 0.92 + localP * 0.08,
              opacity: localP,
            })
          })
        }
      )
    }
  }

  /* ── Drinks heading: character mask reveal ── */
  const drinkHeading = container.querySelector<HTMLElement>(
    '[data-reveal="drink-heading"]'
  )
  const drinkHeadingReveal = drinkHeading ? prepareCharMask(drinkHeading) : null
  if (drinkHeadingReveal) {
    cleanups.push(drinkHeadingReveal.cleanup)
    const section = drinkHeading!.closest('[data-section]')
    if (section) {
      makeStTrigger(
        section as HTMLElement,
        'top 75%',
        'top 40%',
        1,
        (p) => drinkHeadingReveal.setProgress(p)
      )
    }
  }

  /* ── Drinks subtitle: fade-up reveal ── */
  const drinkSub = container.querySelector<HTMLElement>(
    '[data-reveal="drink-sub"]'
  )
  const drinkSubReveal = drinkSub ? createFadeUpReveal(drinkSub) : null
  if (drinkSubReveal) {
    cleanups.push(drinkSubReveal.cleanup)
    const section = drinkSub!.closest('[data-section]')
    if (section) {
      makeStTrigger(
        section as HTMLElement,
        'top 65%',
        'top 40%',
        0.8,
        (p) => drinkSubReveal.setProgress(p)
      )
    }
  }

  /* ── Drinks cards: staggered fade + slide + scale ── */
  const drinkCards = container.querySelectorAll<HTMLElement>(
    '[data-section="quenchers"] [data-card]'
  )
  if (drinkCards.length) {
    const section = drinkCards[0].closest('[data-section]')
    if (section) {
      makeStTrigger(
        section as HTMLElement,
        'top 55%',
        'top 15%',
        1.5,
        (p) => {
          drinkCards.forEach((card, i) => {
            const delay = i * 0.1
            const localP = Math.max(0, Math.min(1, (p - delay) / (1 - delay)))
            gsap.set(card, {
              y: (1 - localP) * 40 * pf,
              opacity: localP,
              scale: 0.92 + localP * 0.08,
            })
          })
        }
      )
    }
  }

  return {
    kill: () => {
      scrollTriggers.forEach((st) => st.kill())
      cleanups.forEach((fn) => fn())
    },
  }
}
