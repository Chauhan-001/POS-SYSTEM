import { useEffect, useRef } from 'react'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { IS_MOBILE } from '../utils/constants'
import { createBrandStoryReveal } from '../animations'
import { animateDecorativeElements } from '../animations/microInteractions'


/* ------------------------------------------------------------------ */
/* Statistics data                                                    */
/* ------------------------------------------------------------------ */
const STATS = [
  { value: 50000, suffix: '+', label: 'Happy Customers', accent: '#D89B45', decimals: 0 },
  { value: 4.8, suffix: '', label: 'Google Rating', accent: '#E7B86D', decimals: 1, prefix: '' },
  { value: 3, suffix: '', label: 'Unique Brands', accent: '#D89B45', decimals: 0 },
  { value: 40, suffix: '+', label: 'Signature Menu Items', accent: '#E7B86D', decimals: 0 },
  { value: 365, suffix: '', label: 'Days Serving Freshness', accent: '#5A8C61', decimals: 0 },
  { value: 100, suffix: '%', label: 'Fresh Ingredients', accent: '#D89B45', decimals: 0 },
]

/* ------------------------------------------------------------------ */
/* Star rating visual for 4.8★                                       */
/* ------------------------------------------------------------------ */
function StarRating() {
  return (
    <div className="flex items-center justify-center gap-1 mt-1" aria-label="4.8 out of 5 stars">
      {[1, 2, 3, 4, 5].map((s) => (
        <span key={s} className="text-[var(--lemon)] text-sm md:text-base" style={{ fontVariationSettings: '"FILL" 1' }}>
          ★
        </span>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Brand Story — Premium Statistics Section                           */
/* ------------------------------------------------------------------ */
export default function BrandStory() {
  const reduced = useReducedMotion()
  const sectionRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const section = sectionRef.current
    if (!section) return

    if (reduced) {
      const els = section.querySelectorAll<HTMLElement>(
        '[data-brand-title], [data-brand-stat]'
      )
      els.forEach((el) => {
        el.style.opacity = '1'
        el.style.transform = 'none'
      })
      return
    }

    const pf = IS_MOBILE ? 0.4 : 1

    const brandResult = createBrandStoryReveal({
      container: section,
      parallaxFactor: pf,
    })

    const decorResult = IS_MOBILE
      ? null
      : animateDecorativeElements(section, {
          skipParticles: true,
        })

    return () => {
      brandResult?.kill()
      decorResult?.kill()
    }
  }, [])

  return (
    <section
      ref={sectionRef}
      className="relative min-h-screen w-full overflow-hidden bg-[var(--bg-primary)] flex items-center"
    >
      {/* ── Premium layered background ── */}
      <div className="absolute inset-0 pointer-events-none">
        {/* Warm vignette */}
        <div className="absolute inset-0 bg-gradient-to-b from-[var(--bg-primary)]/50 via-transparent to-[var(--bg-primary)]" />
        {/* Soft atmospheric spotlight */}
        <div
          className="absolute left-1/2 top-1/3 -translate-x-1/2 -translate-y-1/2 w-[80vw] h-[50vh] opacity-[0.08]"
          style={{
            background: 'radial-gradient(ellipse, rgba(216,155,69,0.3) 0%, transparent 70%)',
          }}
        />
        {/* Premium grain texture */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `
              radial-gradient(rgba(255,255,255,0.3) 0.5px, transparent 0.5px),
              radial-gradient(rgba(216,155,69,0.2) 0.3px, transparent 0.3px)
            `,
            backgroundSize: '5px 5px, 8px 8px',
            backgroundPosition: '0 0, 3px 4px',
          }}
        />
      </div>

      {/* ── Content ── */}
      <div className="relative z-10 max-w-7xl mx-auto px-6 md:px-16 py-24 md:py-32 w-full">
        <div className="max-w-4xl mx-auto">
          {/* ── Large heading ── */}
          <h2
            data-brand-title
            className="font-display text-[clamp(36px,8vw,72px)] text-[var(--text-primary)] uppercase leading-[1.05] tracking-[-0.03em] text-center"
          >
            Where Every Sip
            <br />
            Meets Every Bite
          </h2>

          {/* ── Spacer ── */}
          <div className="h-12 md:h-16 lg:h-20" />

          {/* ── Animated Statistics Grid ── */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-5 md:gap-8">
            {STATS.map((stat, idx) => (
              <div
                key={stat.label}
                data-brand-stat
                className="flex flex-col items-center text-center p-5 md:p-7 rounded-2xl bg-[var(--bg-surface)]/60 backdrop-blur-sm border border-[var(--divider)] transition-all duration-500 ease-out hover:bg-[var(--bg-surface)]/80 hover:border-[var(--accent-primary)]/30 hover:-translate-y-1 hover:shadow-lg hover:shadow-[var(--accent-primary)]/5 will-change-transform"
                style={{ transitionDelay: `${idx * 80}ms` }}
              >
                {/* Counter value */}
                <span
                  className="font-display text-[clamp(28px,5vw,44px)] leading-none drop-shadow-[0_0_15px_rgba(216,155,69,0.15)]"
                  style={{ color: stat.accent }}
                >
                  <span className="inline-flex items-baseline gap-1 tabular-nums">
                    {stat.value.toFixed(stat.decimals)}{stat.suffix}
                    {stat.label === 'Google Rating' && <span>★</span>}
                  </span>
                </span>

                {/* Rating stars for Google Rating */}
                {stat.label === 'Google Rating' && <StarRating />}

                {/* Label */}
                <span className="text-[var(--text-secondary)] font-sans text-xs md:text-sm font-semibold uppercase tracking-[0.15em] mt-2">
                  {stat.label}
                </span>

                {/* Decorative underline */}
                <div
                  className="w-10 h-[2px] mt-2.5 rounded-full opacity-40"
                  style={{ background: `linear-gradient(90deg, ${stat.accent}, transparent)` }}
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Decorative assets — depth layers ── */}
      <img
        data-decor="tea"
        src="/assets/tea/clusteredTeaLeaves.webp"
        alt=""
        className="absolute w-12 md:w-16 opacity-[0.12] pointer-events-none blur-[0.5px]"
        style={{ left: '4%', top: '22%', transform: 'rotate(-25deg)' }}
      />
      <img
        data-decor="mint"
        src="/assets/mint/mint-leaves-branch.webp"
        alt=""
        className="absolute w-14 md:w-20 opacity-[0.10] pointer-events-none blur-[0.3px]"
        style={{ right: '6%', bottom: '25%', transform: 'rotate(15deg)' }}
      />
      <img
        data-decor="lemon"
        src="/assets/effects/lemonwatersplash.webp"
        alt=""
        className="absolute w-10 md:w-14 opacity-[0.08] pointer-events-none"
        style={{ right: '15%', top: '30%', transform: 'rotate(-10deg)' }}
      />
      <img
        data-decor="steam"
        src="/assets/effects/steam/naturalTeaSteam.webp"
        alt=""
        className="absolute right-[8%] bottom-[15%] w-28 md:w-40 opacity-[0.10] pointer-events-none"
      />
      <div
        data-golden
        className="absolute inset-0 pointer-events-none opacity-[0.03]"
        style={{
          backgroundImage: "url('/assets/effects/goldenfloatingdustparticle.webp')",
          backgroundSize: '160px 160px',
          backgroundRepeat: 'repeat',
        }}
      />

      {/* Bottom fade */}
      <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[var(--bg-primary)] to-transparent pointer-events-none" />
    </section>
  )
}
