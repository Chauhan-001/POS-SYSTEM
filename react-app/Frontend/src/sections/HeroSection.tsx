import { useEffect, useRef } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { IS_MOBILE } from '../utils/constants'
import { EASE_PREMIUM } from '../utils/animations'
import { createHeroLogoAnimation } from '../animations/heroLogoAnimation'

gsap.registerPlugin(ScrollTrigger)

/* ------------------------------------------------------------------ */
/* Component                                                          */
/* ------------------------------------------------------------------ */

export default function HeroSection() {
  const sectionRef = useRef<HTMLElement | null>(null)
  const reduced = useReducedMotion()

  useEffect(() => {
    const section = sectionRef.current
    if (!section) return

    if (reduced) {
      gsap.set(section.querySelectorAll('[data-logo]'), {
        opacity: 1,
        scale: 1,
        x: '0%',
        y: '0%',
        rotation: 0,
        filter: 'blur(0px)',
      })
      return
    }

    // ── Entrance animation (plays once, auto) ──
    const entrance = createHeroLogoAnimation({
      container: section,
      skipIdle: IS_MOBILE,
    })
    entrance.timeline.play()

    // ── ScrollTrigger exit — pin + scrub logos upward ──
    const logos = section.querySelectorAll<HTMLElement>('[data-logo]')
    const exitTl = gsap.timeline({
      scrollTrigger: {
        trigger: section,
        start: 'top top',
        end: '+=100%',
        pin: true,
        pinSpacing: true,
        scrub: 1.5,
        invalidateOnRefresh: true,
      },
    })

    exitTl.to(logos, {
      y: -120,
      opacity: 0,
      duration: 1,
      ease: EASE_PREMIUM,
      stagger: 0.08,
    })

    return () => {
      entrance.kill()
      exitTl.scrollTrigger?.kill()
      exitTl.kill()
    }
  }, [reduced])

  return (
    <section
      ref={sectionRef}
      data-section="hero"
      className="relative h-dvh w-full overflow-hidden bg-[--color-background] flex items-center justify-center"
    >
      {/* ── Vadippa — left side, responsive positioning ── */}
      <div className="absolute left-[4%] md:left-[6%] lg:left-[8%] top-1/2 -translate-y-1/2 z-10">
        <img
          data-logo="vadippa"
          src="/assets/logos/vadiappa.png"
          alt="Vadippa — Handcrafted Snacks"
          className="w-40 sm:w-48 md:w-64 lg:w-80 xl:w-96 h-auto object-contain will-change-transform"
        />
      </div>

      {/* ── Chaish — center ── */}
      <div className="z-20">
        <img
          data-logo="chaish"
          src="/assets/logos/Chaish-logo.png"
          alt="Chaish — Premium Chai"
          className="w-48 sm:w-56 md:w-72 lg:w-96 xl:w-[28rem] h-auto object-contain will-change-transform"
        />
      </div>

      {/* ── Shikanji Theka — right side, responsive positioning ── */}
      <div className="absolute right-[4%] md:right-[6%] lg:right-[8%] top-1/2 -translate-y-1/2 z-10">
        <img
          data-logo="shikanji"
          src="/assets/logos/shikanji-theka.png"
          alt="Shikanji Theka — Refreshing Beverages"
          className="w-40 sm:w-48 md:w-64 lg:w-80 xl:w-96 h-auto object-contain will-change-transform"
        />
      </div>

      {/* Subtle bottom fade — smooth transition to next section */}
      <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[--color-background] to-transparent pointer-events-none z-30" />
    </section>
  )
}
