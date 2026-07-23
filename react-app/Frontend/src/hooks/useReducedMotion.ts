import { useState, useEffect } from 'react'

/**
 * Detects the user's `prefers-reduced-motion` setting.
 * Returns `true` when the user prefers reduced motion.
 *
 * SSR-safe — returns `false` (no restriction) during server render.
 * Reactive — updates if the user changes their OS setting while on the page.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')

    // Set initial value
    setReduced(mq.matches)

    // Listen for changes (e.g. user toggles OS setting)
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  return reduced
}
