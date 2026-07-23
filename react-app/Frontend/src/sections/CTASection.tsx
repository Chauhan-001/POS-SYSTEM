import { useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { PF } from '../utils/constants'
import { createCTAReveal } from '../animations'
import { animateDecorativeElements } from '../animations/microInteractions'

export default function CTASection() {
  const sectionRef = useRef<HTMLElement | null>(null)
  const reduced = useReducedMotion()

  useEffect(() => {
    const section = sectionRef.current
    if (!section) return
    if (reduced) return

    const ctaResult = createCTAReveal({ container: section, parallaxFactor: PF })

    const decorResult = animateDecorativeElements(section, {
      skipMint: true, skipTea: true, skipLemon: true, skipSteam: true, skipParticles: true,
    })

    return () => {
      ctaResult?.kill()
      decorResult?.kill()
    }
  }, [reduced])

  return (
    <section className="relative min-h-[90vh] w-full overflow-hidden bg-gradient-to-b from-[var(--bg-secondary)] via-[var(--bg-primary)] to-[var(--bg-primary)] flex items-center justify-center py-24 md:py-32">
      {/* ── Warm atmosphere ── */}
      <div className="absolute inset-0 bg-gradient-to-b from-[var(--accent-primary)]/5 via-transparent to-[var(--accent-primary)]/5 pointer-events-none" />
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[60vw] h-[60vw] md:w-[40vw] md:h-[40vw] rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(216,155,69,0.06) 0%, transparent 70%)' }}
      />

      {/* ── Decorative ── */}
      <img src="/assets/effects/teaMasalaAroma.webp" alt="" className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[70vw] md:w-[40vw] opacity-15 pointer-events-none" />
      <img data-decor="bubble" src="/assets/effects/tinybeveragesbubbles.webp" alt="" className="absolute right-[5%] top-[20%] w-36 md:w-52 opacity-20 pointer-events-none" />
      <div data-golden className="absolute inset-0 pointer-events-none opacity-[0.04]" style={{ backgroundImage: "url('/assets/effects/goldenfloatingdustparticle.webp')", backgroundSize: '160px 160px', backgroundRepeat: 'repeat' }} />

      <div className="relative z-10 max-w-4xl mx-auto px-6 text-center">
        {/* ── Brand logos ── */}
        <div className="flex items-center justify-center gap-6 md:gap-12 mb-12 md:mb-16">
          <img data-cta-logo src="/assets/logos/vadiappa.png" alt="Vadippa" loading="lazy" className="h-10 md:h-14 w-auto object-contain opacity-0" />
          <div className="w-px h-10 md:h-14 bg-[var(--accent-primary)]/20" />
          <img data-cta-logo src="/assets/logos/Chaish-logo.png" alt="Chaish" loading="lazy" className="h-12 md:h-16 w-auto object-contain opacity-0" />
          <div className="w-px h-10 md:h-14 bg-[var(--accent-primary)]/20" />
          <img data-cta-logo src="/assets/logos/shikanji-theka.png" alt="Shikanji Theka" loading="lazy" className="h-10 md:h-14 w-auto object-contain opacity-0" />
        </div>

        {/* ── Headline ── */}
        <h2 data-cta-headline className="font-display text-[clamp(28px,6vw,56px)] text-[var(--text-primary)] uppercase leading-[1.1] tracking-[-0.02em] mb-6">
          More Than Tea.<br />
          <span className="bg-gradient-to-r from-[var(--accent-primary)] to-[var(--accent-secondary)] bg-clip-text text-transparent">An Experience.</span>
        </h2>

        <p data-cta-tagline className="font-sans text-[var(--text-secondary)] text-base md:text-lg leading-relaxed max-w-xl mx-auto mb-10">
          Brewed with passion in every cup. Fried to perfection in every bite.<br />
          Three brands, one soul — Chaish.
        </p>

        {/* ── CTA buttons ── */}
        <div data-cta-button className="flex flex-wrap gap-4 justify-center">
          <motion.a
            href="#" whileHover={{ scale: 1.05, boxShadow: '0 0 40px rgba(216,155,69,0.3)' }} whileTap={{ scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 400, damping: 10 }}
            className="px-10 py-4 bg-gradient-to-r from-[var(--accent-primary)] to-[var(--accent-secondary)] text-[var(--bg-primary)] rounded-full font-sans font-bold text-sm uppercase tracking-wider shadow-lg"
          >
            Visit Us Today
          </motion.a>
          <motion.a
            href="#" whileHover={{ scale: 1.05, borderColor: 'var(--accent-primary)', color: 'var(--accent-primary)' }} whileTap={{ scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 400, damping: 10 }}
            className="px-10 py-4 border-2 border-[var(--text-secondary)]/30 text-[var(--text-secondary)] rounded-full font-sans font-bold text-sm uppercase tracking-wider transition-colors duration-300"
          >
            View Full Menu
          </motion.a>
        </div>
      </div>

      <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-[var(--bg-primary)] to-transparent pointer-events-none" />
    </section>
  )
}
