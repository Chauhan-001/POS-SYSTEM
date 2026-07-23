import { useEffect, useRef } from 'react'
import Lenis from 'lenis'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger)

/* ------------------------------------------------------------------ */
/* Lenis smooth scroll — properly synced with GSAP ScrollTrigger      */
/* ------------------------------------------------------------------ */

/**
 * Initialises Lenis smooth scrolling and wires it to GSAP's ticker so
 * that all GSAP/ScrollTrigger animations run in lockstep with Lenis.
 *
 * Key configuration choices:
 *  - `lerp` instead of `duration` → velocity-based smoothing that feels
 *    organic (short scrolls = quick, long scrolls = sustained)
 *  - `overscroll: false`          → no rubber-banding on desktop
 *  - `syncTouch: true`            → smooth touch scrolling on mobile
 *  - `ScrollTrigger.refresh()`    → called after init so that all pin
 *    points, start/end values are calculated against Lenis's virtual
 *    scroll height
 */
export function useSmoothScroll() {
  const lenisRef = useRef<Lenis | null>(null)

  useEffect(() => {
    const lenis = new Lenis({
      /* ── Smoothing ─────────────────────────────────── */
      lerp: 0.085,              // 0–1; lower = smoother, 0.085 ≈ sweet spot
      smoothWheel: true,        // smooth mouse-wheel scrolling
      wheelMultiplier: 1,       // keep native scroll distance (no acceleration)

      /* ── Touch / mobile ────────────────────────────── */
      syncTouch: true,          // enable touch smoothing
      syncTouchLerp: 0.075,     // touch lerp (slightly tighter than wheel)
      touchMultiplier: 1.2,     // slightly faster finger-scroll feel
      touchInertiaExponent: 1.4,// lighter inertia on lift-off

      /* ── Behaviour ─────────────────────────────────── */
      overscroll: false,        // NO rubber banding
      infinite: false,
      orientation: 'vertical',
      gestureOrientation: 'vertical',
      autoResize: true,         // recalculate on resize automatically
      autoRaf: false,           // we drive RAF via GSAP ticker

      /* ── Accessibility ─────────────────────────────── */
      prevent: (node) => {
        /* Don't smooth-scroll inside form controls */
        const tag = node.tagName.toLowerCase()
        return tag === 'textarea' || tag === 'select' || tag === 'input'
      },
    })

    lenisRef.current = lenis

    /* ── Sync ScrollTrigger with Lenis ── */
    const unsubscribeScroll = lenis.on('scroll', ScrollTrigger.update)

    /* ── Drive Lenis from GSAP's ticker (same frame) ── */
    const tickerCallback = (time: number) => {
      lenis.raf(time * 1000) // GSAP provides seconds → Lenis needs ms
    }
    gsap.ticker.add(tickerCallback)
    gsap.ticker.lagSmoothing(0)

    /* ── Refresh ScrollTrigger after Lenis has initialised ── */
    // Use requestAnimationFrame to ensure Lenis has settled its
    // virtual scroll height before recalculating trigger positions.
    const rafId = requestAnimationFrame(() => {
      ScrollTrigger.refresh()
    })

    return () => {
      gsap.ticker.remove(tickerCallback)
      unsubscribeScroll()
      cancelAnimationFrame(rafId)
      gsap.ticker.lagSmoothing(0)
      lenis.destroy()
      lenisRef.current = null
    }
  }, [])

  return lenisRef
}
