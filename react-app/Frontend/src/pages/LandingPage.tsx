import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { useGSAP } from '@gsap/react'
import { random } from 'animejs'
import LogoHero from '../sections/LogoHero'
import ProductScene from '../sections/ProductScene'
import BrandStory from '../sections/BrandStory'
import GallerySection from '../sections/GallerySection'
import MenuPreview from '../sections/MenuPreview'
import CTASection from '../sections/CTASection'
import FooterSection from '../sections/FooterSection'
import { useSmoothScroll } from '../hooks/useSmoothScroll'

gsap.registerPlugin(ScrollTrigger)

/* ------------------------------------------------------------------ */
/* Touch / mobile detection                                           */
/* ------------------------------------------------------------------ */
function useIsTouchDevice() {
  const [isTouch] = useState(() =>
    typeof window !== 'undefined' &&
    ('ontouchstart' in window || navigator.maxTouchPoints > 0)
  )
  return isTouch
}

/* ------------------------------------------------------------------ */
/* Navigation Bar — 88px, fixed, Chaish logo left, links centered     */
/* ------------------------------------------------------------------ */
function Navbar() {
  const navRef = useRef<HTMLElement | null>(null)
  const [scrolled, setScrolled] = useState(false)
  const [activeSection, setActiveSection] = useState('home')

  useEffect(() => {
    const nav = navRef.current
    if (!nav) return

    const sections = ['home', 'products', 'story', 'menu', 'contact']
    const sectionEls = sections.map(id => document.getElementById(id)).filter(Boolean)

    const onScroll = () => {
      const scrollY = window.scrollY
      setScrolled(scrollY > 80)

      let current = 'home'
      for (const el of sectionEls) {
        if (!el) continue
        const rect = el.getBoundingClientRect()
        if (rect.top <= window.innerHeight * 0.3) {
          current = el.id
        }
      }
      setActiveSection(current)
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const links = [
    { id: 'home', label: 'Home' },
    { id: 'products', label: 'Products' },
    { id: 'story', label: 'Our Story' },
    { id: 'menu', label: 'Menu' },
    { id: 'contact', label: 'Contact' },
  ]

  const scrollTo = (id: string) => {
    const el = document.getElementById(id)
    if (el) {
      window.scrollTo({ top: el.offsetTop - 88, behavior: 'smooth' })
    }
  }

  return (
    <nav
      ref={navRef}
      className={`fixed top-0 left-0 w-full z-50 transition-all duration-500 ease-out ${
        scrolled
          ? 'bg-[var(--bg-primary)]/90 backdrop-blur-md shadow-lg shadow-black/20'
          : 'bg-transparent'
      }`}
    >
      <div className="max-w-7xl mx-auto flex items-center justify-between px-6 md:px-16 h-[88px]">
        {/* LEFT: Chaish logo */}
        <button onClick={() => scrollTo('home')} className="flex items-center">
          <img
            src="/assets/logos/Chaish-logo.png"
            alt="Chaish"
            className="h-[42px] md:h-[48px] w-auto object-contain"
          />
        </button>

        {/* CENTER: Nav links — 40-48px gap */}
        <div className="hidden md:flex items-center gap-10 lg:gap-12">
          {links.map((link) => (
            <button
              key={link.id}
              onClick={() => scrollTo(link.id)}
              className={`text-xs uppercase tracking-[0.18em] font-sans font-medium transition-all duration-300 ${
                activeSection === link.id
                  ? 'text-[var(--accent-primary)]'
                  : scrolled
                    ? 'text-[var(--text-secondary)]/80 hover:text-[var(--text-primary)]'
                    : 'text-[var(--text-primary)]/70 hover:text-[var(--text-primary)]'
              }`}
            >
              {link.label}
            </button>
          ))}
        </div>

        {/* RIGHT: Open App button */}
        <Link
          to="/login"
          className="px-6 py-2.5 rounded-full bg-gradient-to-r from-[var(--accent-primary)] to-[var(--accent-secondary)] text-[var(--bg-primary)] font-sans text-xs font-bold uppercase tracking-wider shadow-lg shadow-[var(--accent-primary)]/20 hover:shadow-xl hover:shadow-[var(--accent-primary)]/30 transition-all duration-300"
        >
          Open App
        </Link>
      </div>

      {/* Separator line on scroll */}
      <div className={`h-px transition-opacity duration-500 ${
        scrolled ? 'opacity-100' : 'opacity-0'
      }`} style={{ background: 'linear-gradient(90deg, transparent, var(--accent-primary)/20, transparent)' }} />
    </nav>
  )
}

/* ------------------------------------------------------------------ */
/* Cursor glow                                                        */
/* ------------------------------------------------------------------ */
function CursorGlow({ isTouch }: { isTouch: boolean }) {
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (isTouch) return
    const el = ref.current
    if (!el) return
    const onMove = (e: MouseEvent) => {
      gsap.to(el, {
        x: e.clientX - 150, y: e.clientY - 150,
        duration: 1.2, ease: 'power2.out',
      })
    }
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [isTouch])
  if (isTouch) return null
  return (
    <div
      ref={ref}
      className="fixed top-0 left-0 w-[300px] h-[300px] rounded-full pointer-events-none z-[60] mix-blend-screen"
      style={{ background: 'radial-gradient(circle, rgba(216,155,69,0.12) 0%, rgba(216,155,69,0.04) 40%, transparent 70%)' }}
    />
  )
}

/* ------------------------------------------------------------------ */
/* Scroll Progress Bar                                                */
/* ------------------------------------------------------------------ */
function ScrollProgressBar() {
  const barRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const bar = barRef.current
    if (!bar) return
    const onScroll = () => {
      const scrollTop = window.scrollY
      const docHeight = document.documentElement.scrollHeight - window.innerHeight
      const p = docHeight > 0 ? Math.min((scrollTop / docHeight) * 100, 100) : 0
      bar.style.transform = `scaleX(${p / 100})`
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  return (
    <div className="fixed top-0 left-0 w-full h-[2px] z-[100]">
      <div
        ref={barRef}
        className="h-full bg-gradient-to-r from-[var(--accent-primary)] to-[var(--accent-secondary)] shadow-[0_0_12px_rgba(216,155,69,0.4)] origin-left will-change-transform"
        style={{ transform: 'scaleX(0)', width: '100%' }}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Floating ambient — desktop only                                    */
/* ------------------------------------------------------------------ */
function useAmbientFloat(pageRef: React.RefObject<HTMLDivElement | null>) {
  useGSAP(
    () => {
      const page = pageRef.current
      if (!page) return
      const floatingImgs = page.querySelectorAll('[data-float]')
      floatingImgs.forEach((img) => {
        gsap.to(img, {
          y: () => random(-8, 8),
          rotation: () => random(-1.5, 1.5),
          duration: () => 3 + Math.random() * 2,
          ease: 'sine.inOut',
          yoyo: true, repeat: -1,
          delay: Math.random() * 2,
        })
      })
    },
    { scope: pageRef }
  )
}

/* ------------------------------------------------------------------ */
/* Background Ambient — continuous floating golden dust & particles   */
/* ------------------------------------------------------------------ */
function useBackgroundAmbient() {
  useEffect(() => {
    const particles: { el: HTMLDivElement; tween: gsap.core.Tween }[] = []

    for (let i = 0; i < 12; i++) {
      const el = document.createElement('div')
      const size = 2 + Math.random() * 4
      el.style.cssText = [
        'position: fixed',
        'pointer-events: none',
        'will-change: transform, opacity',
        `width: ${size}px`,
        `height: ${size}px`,
        `left: ${Math.random() * 100}%`,
        `top: ${Math.random() * 100}%`,
        'background: radial-gradient(circle, rgba(216,155,69,0.5), rgba(216,155,69,0))',
        'border-radius: 9999px',
        'z-index: 0',
        'opacity: 0',
      ].join(';')
      document.body.appendChild(el)

      const tween = gsap.to(el, {
        y: -(60 + Math.random() * 100),
        x: -20 + Math.random() * 40,
        opacity: 0.15 + Math.random() * 0.25,
        scale: 0.5 + Math.random() * 1.0,
        duration: 8 + Math.random() * 6,
        repeat: -1,
        delay: Math.random() * 4,
        ease: 'power1.out',
        onRepeat: () => {
          gsap.set(el, {
            x: -20 + Math.random() * 40,
            y: 0,
            opacity: 0,
          })
        },
      })

      particles.push({ el, tween })
    }

    return () => {
      particles.forEach(({ el, tween }) => {
        tween.kill()
        el.remove()
      })
    }
  }, [])
}

/* ------------------------------------------------------------------ */
/* Page                                                               */
/* ------------------------------------------------------------------ */
export default function LandingPage() {
  const isTouch = useIsTouchDevice()
  const pageRef = useRef<HTMLDivElement | null>(null)
  useSmoothScroll()
  useAmbientFloat(pageRef)
  useBackgroundAmbient()

  return (
    <div
      ref={pageRef}
      className="bg-[var(--bg-primary)] text-[var(--text-primary)] font-sans antialiased overflow-x-hidden selection:bg-[var(--accent-primary)] selection:text-[var(--bg-primary)] relative min-h-screen"
    >
      {/* Global UX layers */}
      <Navbar />
      <ScrollProgressBar />
      <CursorGlow isTouch={isTouch} />

      {/* ─── Section 1: Hero Logo Entrance ─── */}
      <div id="home">
        <LogoHero />
      </div>

      {/* ─── Section 2: Pinned Scroll Story ─── */}
      <div id="products">
        <ProductScene />
      </div>

      {/* ─── Section 3: Brand Statistics ─── */}
      <div id="story">
        <BrandStory />
      </div>

      {/* ─── Section 4: Visual Gallery ─── */}
      <GallerySection />

      {/* ─── Section 6: Menu Preview ─── */}
      <div id="menu">
        <MenuPreview />
      </div>

      {/* ─── Section 7: Closing CTA ─── */}
      <div id="contact">
        <CTASection />
      </div>

      {/* ─── Section 8: Footer ─── */}
      <FooterSection />
    </div>
  )
}
