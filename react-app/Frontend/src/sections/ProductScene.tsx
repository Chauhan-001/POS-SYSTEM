import { useEffect, useRef } from 'react'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { IS_MOBILE } from '../utils/constants'
import { createProductScene } from '../animations/productSceneEntrance'
import { animateDecorativeElements } from '../animations/microInteractions'

export default function ProductScene() {
  const reduced = useReducedMotion()
  const sectionRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const section = sectionRef.current
    if (!section) return

    if (reduced) {
      const els = section.querySelectorAll<HTMLElement>(
        '[data-product], [data-product-title], [data-product-subtitle], [data-product-tagline], [data-steam-overlay]'
      )
      els.forEach((el) => {
        el.style.opacity = '1'
        el.style.transform = 'none'
      })
      return
    }

    const result = createProductScene({
      container: section,
      skipIdle: IS_MOBILE,
    })

    const decorResult = IS_MOBILE
      ? null
      : animateDecorativeElements(section, { skipParticles: true })

    return () => {
      result.kill()
      decorResult?.kill()
    }
  }, [reduced])

  return (
    <section
      ref={sectionRef}
      className="relative h-screen w-full overflow-hidden bg-gradient-to-br from-[var(--bg-primary)] via-[var(--bg-secondary)] to-[var(--bg-primary)] select-none">
      {/* ── Texture overlay ── */}
      <div className="absolute inset-0 opacity-[0.04] pointer-events-none" style={{
        backgroundImage: 'radial-gradient(circle at 30% 40%, var(--accent-primary) 1px, transparent 1px), radial-gradient(circle at 70% 60%, var(--mint) 1px, transparent 1px)',
        backgroundSize: '60px 60px, 80px 80px',
      }} />

      {/* ── Concentric rings ── */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-15">
        <div className="w-[70vw] h-[70vw] md:w-[50vw] md:h-[50vw] rounded-full border border-[var(--accent-primary)]/20 animate-spin-slow" />
        <div className="w-[50vw] h-[50vw] md:w-[35vw] md:h-[35vw] rounded-full border border-[var(--accent-secondary)]/15 animate-spin-slow absolute" style={{ animationDirection: 'reverse', animationDuration: '20s' }} />
      </div>

      {/* ── Content ── */}
      <div className="relative z-10 h-full w-full flex items-center justify-center px-8 md:px-16">
        <img data-product="vadapav" src="/assets/hero/vadapav.webp" alt="Vada Pav" loading="lazy"
          className="absolute w-[35vw] md:w-[18vw] max-w-[300px] object-contain drop-shadow-[0_30px_60px_rgba(216,155,69,0.3)] will-change-transform"
          style={{ left: '6%', top: '50%', transform: 'translateY(-50%)' }} />

        <img data-product="chai" src="/assets/hero/chai.webp" alt="Kulhad Chai" loading="lazy"
          className="absolute w-[28vw] md:w-[15vw] max-w-[260px] object-contain drop-shadow-[0_30px_60px_rgba(216,155,69,0.25)] will-change-transform"
          style={{ right: '6%', top: '50%', transform: 'translateY(-50%)' }} />

        <img data-steam-overlay src="/assets/effects/steam/naturalTeaSteam.webp" alt=""
          className="absolute pointer-events-none w-[18vw] md:w-[12vw] max-w-[180px] opacity-0 will-change-transform"
          style={{ right: '14%', top: '16%' }} />

        <div className="flex flex-col items-center text-center max-w-2xl mx-auto px-4">
          <h2 data-product-title className="font-display text-[clamp(24px,5vw,48px)] text-[var(--text-primary)] uppercase leading-none tracking-[0.04em] drop-shadow-lg">
            The Crunch You<br />Came For
          </h2>
          <p data-product-subtitle className="font-sans text-[var(--text-secondary)] text-xs md:text-sm tracking-[0.2em] uppercase mt-5">
            Vada Pav &bull; Cutting Chai
          </p>
          <p data-product-tagline className="font-sans text-[var(--text-secondary)]/70 text-xs md:text-sm mt-3 max-w-md mx-auto italic">
            Not just food. An emotion.
          </p>
        </div>
      </div>

      {/* ── Decorative assets ── */}
      <img data-decor="tea" src="/assets/tea/clusteredTeaLeaves.webp" alt="" className="absolute w-10 md:w-14 opacity-[0.18] pointer-events-none blur-[0.3px]" style={{ left: '4%', top: '18%', transform: 'rotate(-25deg)' }} />
      <img data-decor="tea" src="/assets/tea/teasplash.webp" alt="" className="absolute w-12 md:w-16 opacity-[0.12] pointer-events-none" style={{ left: '16%', top: '68%', transform: 'rotate(10deg)' }} />
      <img data-decor="mint" src="/assets/mint/mint-01.png" alt="" className="absolute w-10 md:w-14 opacity-[0.15] pointer-events-none blur-[0.5px]" style={{ right: '22%', top: '28%', transform: 'rotate(40deg)' }} />
      <img data-decor="mint" src="/assets/mint/mint-leaves-branch.webp" alt="" className="absolute w-16 md:w-24 opacity-[0.12] pointer-events-none" style={{ right: '12%', top: '65%', transform: 'rotate(-15deg)' }} />
      <img data-decor="lemon" src="/assets/effects/lemonwatersplash.webp" alt="" className="absolute w-12 md:w-20 opacity-[0.10] pointer-events-none" style={{ right: '18%', bottom: '6%', transform: 'rotate(30deg)' }} />
      <img data-decor="bubble" src="/assets/effects/tinybeveragesbubbles.webp" alt="" className="absolute w-16 md:w-28 opacity-[0.12] pointer-events-none" style={{ right: '28%', top: '12%', transform: 'rotate(180deg)' }} />
      <img data-parallax src="/assets/spices/staranise.webp" alt="" className="absolute w-6 md:w-8 opacity-[0.12] pointer-events-none" style={{ left: '32%', bottom: '12%', transform: 'rotate(45deg)' }} />
      <img data-parallax src="/assets/spices/cinnamonSticksingle.webp" alt="" className="absolute w-8 md:w-12 opacity-[0.15] pointer-events-none" style={{ right: '8%', bottom: '28%', transform: 'rotate(-8deg)' }} />
      <div data-golden className="absolute inset-0 pointer-events-none opacity-[0.04]" style={{ backgroundImage: "url('/assets/effects/goldenfloatingdustparticle.webp')", backgroundSize: '180px 180px', backgroundRepeat: 'repeat' }} />

      <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-[var(--bg-primary)] to-transparent pointer-events-none z-20" />
      <div className="absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-[var(--bg-primary)]/80 to-transparent pointer-events-none z-20" />
    </section>
  )
}
