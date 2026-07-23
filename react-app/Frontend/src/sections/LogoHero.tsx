import { useEffect, useRef } from 'react'
import { gsap } from 'gsap'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { IS_MOBILE } from '../utils/constants'
import { createHeroEntrance, createSteamRise } from '../animations'

export default function LogoHero() {
  const reduced = useReducedMotion()
  const sectionRef = useRef<HTMLElement>(null!)
  const steamRef1 = useRef<HTMLImageElement>(null!)
  const steamRef2 = useRef<HTMLImageElement>(null!)
  const steamRef3 = useRef<HTMLImageElement>(null!)

  useEffect(() => {
    const section = sectionRef.current
    if (!section) return

    const tweens: gsap.core.Tween[] = []
    let heroTl: gsap.core.Timeline | null = null

    if (!reduced) {
      heroTl = createHeroEntrance({
        container: section,
        speed: 1,
        skipIdle: IS_MOBILE,
      })
      heroTl.play()

      if (steamRef1.current) {
        tweens.push(createSteamRise(steamRef1.current, { y: -60, opacity: 0.12, scale: 1.2, duration: 5 }))
      }
      if (steamRef2.current) {
        tweens.push(createSteamRise(steamRef2.current, { y: -40, opacity: 0.18, scale: 1.1, duration: 3.6 }))
      }
      if (steamRef3.current) {
        tweens.push(createSteamRise(steamRef3.current, { y: -30, opacity: 0.25, scale: 1.05, duration: 2.8 }))
      }
    } else {
      gsap.set(section.querySelectorAll('[data-logo]'), {
        opacity: 1, scale: 1, x: 0, y: 0, rotation: 0,
      })
      gsap.set(
        section.querySelectorAll('[data-hero-headline], [data-hero-subtitle]'),
        { opacity: 1, y: 0 }
      )
    }

    return () => {
      heroTl?.kill()
      tweens.forEach((t) => t.kill())
    }
  }, [])

  return (
    <section ref={sectionRef} className="relative h-dvh w-full overflow-hidden bg-[var(--bg-primary)] pt-[88px]">
      {/* ── Background: subtle radial glow behind Chaish at ~6% ── */}
      <div className="absolute inset-0 pointer-events-none" style={{
        background: `
          radial-gradient(70% 50% at 50% 35%, rgba(216,155,69,0.06) 0%, transparent 60%),
          linear-gradient(180deg, #1F140F 0%, #2C1B14 50%, #1F140F 100%)
        `,
      }} />

      {/* ── Decorative assets — barely visible at 5-6% ── */}
      <div className="absolute inset-0 pointer-events-none z-10 overflow-hidden" aria-hidden="true">
        <img src="/assets/tea/clusteredTeaLeaves.webp" alt="" className="absolute w-8 md:w-12 opacity-[0.06] blur-[1px]" style={{ left: '5%', top: '12%', transform: 'rotate(-20deg)' }} />
        <img src="/assets/spices/staranise.webp" alt="" className="absolute w-5 md:w-8 opacity-[0.06]" style={{ right: '10%', top: '18%', transform: 'rotate(35deg) scaleX(-1)' }} />
        <img src="/assets/mint/mint-01.png" alt="" className="absolute w-8 md:w-12 opacity-[0.05] blur-[0.5px]" style={{ left: '2%', bottom: '15%', transform: 'rotate(-45deg)' }} />
        <img src="/assets/spices/cinnamonSticksingle.webp" alt="" className="absolute w-6 md:w-10 opacity-[0.05]" style={{ right: '3%', bottom: '18%', transform: 'rotate(12deg)' }} />
      </div>

      {/* ── Main content: flex column, centered ── */}
      <div className="h-full flex flex-col items-center justify-center z-20 px-6">
        {/* More space between navbar and logos */}
        <div className="h-[48px] shrink-0" />

        {/* ── Triangle logo composition ── */}
        <div className="relative flex justify-center w-full" style={{ minHeight: '260px' }}>
          {/* Chaish — large, impactful, top center */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2">
            <img
              data-logo="chaish"
              src="/assets/logos/Chaish-logo.png"
              alt="Chaish — Where Every Sip Meets Every Bite"
              className="w-auto h-auto"
              style={{ maxWidth: 'min(420px, 78vw)', maxHeight: '140px' }}
              loading="eager"
            />
          </div>

          {/* Vadippa — left of center, always below Chaish */}
          <div className="absolute" style={{ left: 'calc(50% - 160px)', top: '150px', transform: 'translateX(-50%)' }}>
            <img
              data-logo="vadippa"
              src="/assets/logos/vadiappa.png"
              alt="Vadippa — Handcrafted Snacks"
              className="w-auto h-auto"
              style={{ maxWidth: 'min(240px, 42vw)', maxHeight: '85px' }}
              loading="eager"
            />
          </div>

          {/* Shikanji — right of center, always below Chaish */}
          <div className="absolute" style={{ left: 'calc(50% + 160px)', top: '150px', transform: 'translateX(-50%)' }}>
            <img
              data-logo="shikanji"
              src="/assets/logos/shikanji-theka.png"
              alt="Shikanji Theka — Refreshing Beverages"
              className="w-auto h-auto"
              style={{ maxWidth: 'min(280px, 42vw)', maxHeight: '100px' }}
              loading="eager"
            />
          </div>
        </div>

        {/* ── 80px spacing between logo bottom and heading (minimum) ── */}
        <div className="h-[60px] md:h-[80px] shrink-0" />

        {/* ── Heading — max-width 900px ── */}
        <h1
          data-hero-headline
          className="font-display text-[clamp(20px,3.5vw,38px)] text-[var(--cream)] text-center leading-tight tracking-tight max-w-[900px]"
        >
          Where Every Sip Meets Every Bite
        </h1>

        {/* ── 28px spacing ── */}
        <div className="h-[28px] shrink-0" />

        {/* ── Subtitle ── */}
        <p
          data-hero-subtitle
          className="font-sans text-[var(--text-secondary)] text-xs md:text-sm text-center tracking-[0.2em] uppercase max-w-xl"
        >
          Premium Chai &bull; Handcrafted Snacks &bull; Craft Beverages
        </p>


      </div>

      {/* ── Steam overlays ── */}
      <div className="absolute inset-0 pointer-events-none z-30" aria-hidden="true">
        <img ref={steamRef1} src="/assets/effects/steam/naturalTeaSteam.webp" alt="" className="absolute bottom-6 left-1/2 -translate-x-1/2 w-[80vw] md:w-[50vw] max-w-[500px] opacity-0 will-change-transform" />
        <img ref={steamRef2} src="/assets/effects/steam/naturalTeaSteam.webp" alt="" className="absolute bottom-8 left-1/2 -translate-x-1/2 w-[60vw] md:w-[35vw] max-w-[380px] opacity-0 will-change-transform" />
        <img ref={steamRef3} src="/assets/effects/steam/naturalTeaSteam.webp" alt="" className="absolute bottom-10 left-1/2 -translate-x-1/2 w-[40vw] md:w-[22vw] max-w-[280px] opacity-0 will-change-transform" />
      </div>

      {/* ── Scroll indicator ── */}
      <div data-scroll-indicator className="absolute bottom-8 left-1/2 -translate-x-1/2 z-30" aria-hidden="true">
        <div className="flex flex-col items-center gap-2 text-[var(--accent-primary)]/50">
          <span className="text-[10px] md:text-xs tracking-[0.2em] uppercase font-sans font-medium">Scroll</span>
          <div className="w-5 md:w-6 h-8 md:h-10 border-2 border-[var(--accent-primary)]/25 rounded-full flex justify-center pt-1.5 md:pt-2">
            <div className="w-1 h-1.5 md:h-2 bg-[var(--accent-primary)]/45 rounded-full motion-safe:animate-[scrollDot_2s_ease-in-out_infinite] will-change-transform" />
          </div>
        </div>
      </div>
    </section>
  )
}
