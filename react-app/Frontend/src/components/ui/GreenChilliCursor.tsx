import { useEffect, useRef, useCallback, useState } from 'react'

const INTERACTIVE_TAGS = new Set([
  'A', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT',
])

const TRAIL_COUNT = 6
const TRAIL_HISTORY_SIZE = 30

interface Point {
  x: number
  y: number
}

/** Tiny chili SVG used for trail particles — fixed 24px, transform handles scaling */
function TrailChilli() {
  return (
    <svg
      width={24}
      height={24}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: 'block' }}
    >
      <path
        d="M32 6 C32 6, 29 13, 31 16 C32 18, 33 18, 34 16 C35 13, 32 6, 32 6Z"
        fill="#166534"
      />
      <ellipse cx="32" cy="16" rx="2.5" ry="1.2" fill="#15803d" />
      <path
        d="M32 17
           C40 20, 48 27, 50 36
           C52 44, 47 52, 40 54
           C37 55, 34 53, 32 50
           C30 53, 27 55, 24 54
           C17 52, 12 44, 14 36
           C16 27, 24 20, 32 17Z"
        fill="url(#trailG)"
        stroke="#166534"
        strokeWidth="0.5"
      />
      <path
        d="M26 27 C28 24, 31 23, 34 23 C35 23, 37 24, 37 25 C37 27, 34 28, 32 29 C30 29, 27 29, 26 27Z"
        fill="rgba(255,255,255,0.2)"
      />
      <defs>
        <linearGradient id="trailG" x1="14" y1="22" x2="50" y2="52" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#4ade80" />
          <stop offset="100%" stopColor="#15803d" />
        </linearGradient>
      </defs>
    </svg>
  )
}

export function GreenChilliCursor() {
  const cursorRef = useRef<HTMLDivElement>(null)
  const trailRefs = useRef<(HTMLDivElement | null)[]>(Array.from({ length: TRAIL_COUNT }, () => null))
  const posRef = useRef({ x: -100, y: -100 })
  const trailHistoryRef = useRef<Point[]>([])
  const rafRef = useRef<number>(0)
  const hoveringRef = useRef(false)
  const clickingRef = useRef(false)

  const [mounted, setMounted] = useState(false)
  const [visible, setVisible] = useState(false)

  // ── Render loop (single RAF per frame) ──
  const updateCursor = useCallback(() => {
    const el = cursorRef.current
    if (!el) return

    const { x, y } = posRef.current
    const scale = clickingRef.current ? 0.75 : hoveringRef.current ? 1.2 : 1
    const rotate = hoveringRef.current ? -15 : (x + Date.now() * 0.002) * 0.02

    // Main cursor
    el.style.transform = `translate(${x - 4}px, ${y - 8}px) translate(-50%, -50%) scale(${scale}) rotate(${rotate}deg)`
    el.style.filter = `drop-shadow(0 ${hoveringRef.current ? 4 : 2}px ${hoveringRef.current ? 10 : 5}px rgba(0,0,0,0.35))`

    // ── Trail update ──
    const history = trailHistoryRef.current
    const len = history.length
    if (len < 2) return

    for (let i = 0; i < TRAIL_COUNT; i++) {
      const trailEl = trailRefs.current[i]
      if (!trailEl) continue

      // Staggered index into history: newer trails (i=0) lag less, older trails (i=5) lag more
      const historyIndex = Math.min(
        Math.floor(((i + 1) / TRAIL_COUNT) * (len - 1)),
        len - 1,
      )
      const pt = history[historyIndex]
      if (!pt) {
        trailEl.style.opacity = '0'
        continue
      }

      // Trail size & fade: first trail is 85% size / 60% opacity, last is 40% size / 10% opacity
      const t = (i + 1) / TRAIL_COUNT // 0.166 → 1.0
      const trailScale = 1 - t * 0.55 // 0.91 → 0.45
      const trailOpacity = 1 - t * 0.85 // 0.86 → 0.15
      const trailRotate = (x - pt.x) * 0.5 + (Date.now() * 0.003)

      trailEl.style.transform = `translate(${pt.x}px, ${pt.y}px) translate(-50%, -50%) scale(${trailScale}) rotate(${trailRotate}deg)`
      trailEl.style.opacity = String(Math.max(0, trailOpacity))
    }
  }, [])

  const scheduleFrame = useCallback(() => {
    if (!rafRef.current) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0
        updateCursor()
      })
    }
  }, [updateCursor])

  // ── Event handlers ──
  const handleMouseMove = useCallback((e: MouseEvent) => {
    const point: Point = { x: e.clientX, y: e.clientY }
    posRef.current = point

    // Push to trail history
    const history = trailHistoryRef.current
    history.push(point)
    if (history.length > TRAIL_HISTORY_SIZE) {
      history.shift()
    }

    if (!visible) setVisible(true)
    scheduleFrame()
  }, [scheduleFrame, visible])

  const handleMouseOver = useCallback((e: MouseEvent) => {
    const target = e.target as HTMLElement
    const isInteractive =
      INTERACTIVE_TAGS.has(target.tagName) ||
      !!target.closest('a, button, [role="button"], [data-interactive], [href]')
    hoveringRef.current = isInteractive
  }, [])

  const handleMouseDown = useCallback(() => {
    clickingRef.current = true
    scheduleFrame()
  }, [scheduleFrame])

  const handleMouseUp = useCallback(() => {
    clickingRef.current = false
    scheduleFrame()
  }, [scheduleFrame])

  const handleMouseLeave = useCallback(() => {
    // Fade out trail when mouse leaves the window
    for (let i = 0; i < TRAIL_COUNT; i++) {
      const trailEl = trailRefs.current[i]
      if (trailEl) trailEl.style.opacity = '0'
    }
  }, [])

  // ── Effects ──
  useEffect(() => {
    setMounted(true)

    const style = document.createElement('style')
    style.id = 'chilli-cursor-style'
    style.textContent = `* { cursor: none !important; }`
    document.head.appendChild(style)

    window.addEventListener('mousemove', handleMouseMove, { passive: true })
    window.addEventListener('mouseover', handleMouseOver, { capture: true, passive: true })
    window.addEventListener('mousedown', handleMouseDown, { passive: true })
    window.addEventListener('mouseup', handleMouseUp, { passive: true })
    window.addEventListener('mouseleave', handleMouseLeave, { passive: true })

    return () => {
      document.body.style.cursor = ''
      const s = document.getElementById('chilli-cursor-style')
      if (s) s.remove()
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseover', handleMouseOver, true)
      window.removeEventListener('mousedown', handleMouseDown)
      window.removeEventListener('mouseup', handleMouseUp)
      window.removeEventListener('mouseleave', handleMouseLeave)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [handleMouseMove, handleMouseOver, handleMouseDown, handleMouseUp, handleMouseLeave])

  if (!mounted) return null

  return (
    <>
      {/* Trail particles */}
      {Array.from({ length: TRAIL_COUNT }, (_, i) => (
        <div
          key={i}
          ref={(el) => { trailRefs.current[i] = el }}
          aria-hidden="true"
          style={{
            position: 'fixed',
            left: 0,
            top: 0,
            width: 0,
            height: 0,
            zIndex: 99998 - i,
            pointerEvents: 'none',
            opacity: 0,
            transition: 'opacity 0.15s ease',
          }}
        >
          <TrailChilli />
        </div>
      ))}

      {/* Main cursor */}
      <div
        ref={cursorRef}
        aria-hidden="true"
        style={{
          position: 'fixed',
          left: 0,
          top: 0,
          width: 0,
          height: 0,
          zIndex: 99999,
          pointerEvents: 'none',
          opacity: visible ? 1 : 0,
          transition: 'opacity 0.25s ease, transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1), filter 0.2s ease',
        }}
      >
        <svg
          width="32"
          height="32"
          viewBox="0 0 64 64"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          style={{
            display: 'block',
            animation: 'chilliBounce 2s ease-in-out infinite',
          }}
        >
          {/* Stem */}
          <path
            d="M32 4 C32 4, 28 12, 30 16 C31 18, 33 18, 34 16 C36 12, 32 4, 32 4Z"
            fill="#166534"
            stroke="#14532d"
            strokeWidth="0.5"
          />
          <ellipse cx="32" cy="16" rx="3" ry="1.5" fill="#15803d" />

          {/* Main chili body */}
          <path
            d="M32 17
               C42 20, 52 28, 54 38
               C56 48, 50 56, 42 58
               C38 59, 34 57, 32 54
               C30 57, 26 59, 22 58
               C14 56, 8 48, 10 38
               C12 28, 22 20, 32 17Z"
            fill="url(#chilliGradient)"
            stroke="#166534"
            strokeWidth="0.8"
          />

          <path
            d="M24 28 C26 24, 30 22, 34 22 C36 22, 38 23, 38 25 C38 27, 34 28, 32 29 C30 30, 26 30, 24 28Z"
            fill="rgba(255,255,255,0.25)"
          />

          <path
            d="M28 20 C30 18, 34 18, 36 20"
            stroke="rgba(255,255,255,0.15)"
            strokeWidth="1"
            fill="none"
            strokeLinecap="round"
          />

          <circle cx="20" cy="36" r="1" fill="rgba(255,255,255,0.08)" />
          <circle cx="44" cy="38" r="1.2" fill="rgba(255,255,255,0.06)" />
          <circle cx="30" cy="42" r="0.8" fill="rgba(255,255,255,0.1)" />
          <circle cx="38" cy="46" r="1" fill="rgba(255,255,255,0.07)" />
          <circle cx="24" cy="48" r="0.7" fill="rgba(255,255,255,0.05)" />

          <path
            d="M30 52 C31 54, 33 54, 34 52"
            stroke="#14532d"
            strokeWidth="0.5"
            fill="none"
            strokeLinecap="round"
          />

          <defs>
            <linearGradient id="chilliGradient" x1="12" y1="20" x2="52" y2="56" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#4ade80" />
              <stop offset="35%" stopColor="#22c55e" />
              <stop offset="70%" stopColor="#16a34a" />
              <stop offset="100%" stopColor="#15803d" />
            </linearGradient>
          </defs>
        </svg>

        <style>{`
          @keyframes chilliBounce {
            0%, 100% { transform: translateY(0px) rotate(0deg); }
            50% { transform: translateY(-3px) rotate(3deg); }
          }
        `}</style>
      </div>
    </>
  )
}
