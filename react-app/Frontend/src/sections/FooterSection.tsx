import { useEffect, useRef } from 'react'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { createFooterReveal } from '../animations'

const IMG_FOOTER =
  'https://lh3.googleusercontent.com/aida-public/AB6AXuDkkKOy6HelqcqzstuiwhqTIwS5mBcQNL7XOnr12CfCFSUuRwPDu-bNUoivnDFe24xnH_6mzC7kN5UeEhgKHX1RsVLtnL2Ly3CE9yxd4H6LMvPgUkqfxPdomH5uchGDtzfKNbrYdzEhROKkd91jTlbgTVvvTgeQ0ps5YdDcuD0tsn-WAE0kRT5g98w5fRTw9IVwqg22bwXzinwhiIMne4-auil2_DYNHTmhm6zjcg9dZRtALfoucPHXsEU8c30ZLCrstqkfWnqhD0BxbDU'

export default function FooterSection() {
  const reduced = useReducedMotion()
  const sectionRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const section = sectionRef.current
    if (!section) return
    let footerResult: ReturnType<typeof createFooterReveal> | null = null
    if (!reduced) {
      footerResult = createFooterReveal({ container: section })
    }
    return () => { footerResult?.kill() }
  }, [])

  return (
    <footer
      ref={sectionRef}
      className="relative w-full pt-16 pb-20 flex flex-col justify-center items-center px-4 md:px-16 gap-6 border-t border-[var(--divider)] bg-[var(--bg-primary)]"
    >
      {/* Logo */}
      <img
        data-footer-logo
        alt="CHAISH Logo"
        loading="lazy"
        className="h-16 w-auto object-contain opacity-80 hover:opacity-100 transition-opacity duration-300"
        src={IMG_FOOTER}
      />

      {/* Divider */}
      <div className="w-16 h-px bg-gradient-to-r from-transparent via-[var(--accent-primary)]/30 to-transparent" />

      {/* Copyright */}
      <p data-footer-text className="text-[var(--text-secondary)]/60 font-sans text-sm text-center">
        © 2024 CHAISH. Crafted with Spices.
      </p>

      {/* Links */}
      <div className="flex gap-6" data-footer-text>
        <a className="text-[var(--text-secondary)]/50 hover:text-[var(--accent-primary)] transition-colors duration-200 text-xs uppercase tracking-widest" href="#">Privacy Policy</a>
        <span className="text-[var(--divider)]">|</span>
        <a className="text-[var(--text-secondary)]/50 hover:text-[var(--accent-primary)] transition-colors duration-200 text-xs uppercase tracking-widest" href="#">Contact Us</a>
        <span className="text-[var(--divider)]">|</span>
        <a className="text-[var(--text-secondary)]/50 hover:text-[var(--accent-primary)] transition-colors duration-200 text-xs uppercase tracking-widest" href="#">Careers</a>
      </div>

      {/* Bottom grain */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.02]"
        style={{
          backgroundImage: 'radial-gradient(rgba(255,255,255,0.2) 0.5px, transparent 0.5px)',
          backgroundSize: '6px 6px',
        }}
      />
    </footer>
  )
}
