import { useEffect, useRef, useState } from 'react'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { createStatsReveal } from '../animations'
import CountUp from '../components/animation/CountUp'

const AVATARS = [
  {
    src: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=96&h=96&fit=crop&crop=face&auto=format',
    name: 'Rahul',
    quote: 'Best chai in town! The vada pav is unreal.',
  },
  {
    src: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=96&h=96&fit=crop&crop=face&auto=format',
    name: 'Priya',
    quote: 'My go-to spot for evening chai and maggi.',
  },
  {
    src: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=96&h=96&fit=crop&crop=face&auto=format',
    name: 'Arjun',
    quote: 'That Bun Maska takes me back to Mumbai!',
  },
  {
    src: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=96&h=96&fit=crop&crop=face&auto=format',
    name: 'Neha',
    quote: 'Shikanji on a hot day — absolute bliss.',
  },
  {
    src: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=96&h=96&fit=crop&crop=face&auto=format',
    name: 'Vikram',
    quote: 'Peri Peri fries + cold coffee = perfect combo.',
  },
]

function TestimonialRotator({ reduced }: { reduced: boolean }) {
  const [idx, setIdx] = useState(0)

  useEffect(() => {
    if (reduced) return
    const id = setInterval(() => {
      setIdx((prev) => (prev + 1) % AVATARS.length)
    }, 4000)
    return () => clearInterval(id)
  }, [reduced])

  const person = AVATARS[idx]

  return (
    <div className="flex flex-col items-center gap-2 mt-3 min-h-[4rem]" aria-live="polite">
      <p className="text-[var(--text-secondary)] text-xs md:text-sm italic leading-relaxed text-center max-w-[200px] transition-opacity duration-500">
        &ldquo;{person.quote}&rdquo;
      </p>
      <span className="text-[var(--text-secondary)]/60 text-[10px] font-semibold uppercase tracking-wider">
        — {person.name}
      </span>
    </div>
  )
}

export default function StatsSection() {
  const reduced = useReducedMotion()
  const sectionRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const section = sectionRef.current
    if (!section) return
    let statsResult: ReturnType<typeof createStatsReveal> | null = null
    if (!reduced) {
      statsResult = createStatsReveal({ container: section })
    }
    return () => { statsResult?.kill() }
  }, [])

  return (
    <section
      ref={sectionRef}
      data-section="stats"
      className="relative py-16 md:py-20 w-full overflow-hidden bg-gradient-to-r from-[var(--bg-primary)] via-[var(--bg-secondary)] to-[var(--bg-primary)]"
    >
      {/* Warm accent gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-b from-[var(--accent-primary)]/8 via-transparent to-[var(--accent-primary)]/5 pointer-events-none" />

      {/* Subtle pattern overlay */}
      <div
        className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            'radial-gradient(circle at 25% 25%, var(--accent-primary) 1px, transparent 1px), radial-gradient(circle at 75% 75%, var(--mint) 1px, transparent 1px)',
          backgroundSize: '40px 40px, 60px 60px',
        }}
      />

      <div className="max-w-7xl mx-auto px-4 md:px-16 relative z-10">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 md:gap-8">
          {/* Stat 1: Menu Items */}
          <div
            data-stat-card
            className="flex flex-col items-center text-center p-4 md:p-6 rounded-2xl bg-[var(--bg-surface)]/60 backdrop-blur-sm border border-[var(--divider)] transition-all duration-500 ease-out hover:bg-[var(--bg-surface)]/80 hover:border-[var(--accent-primary)]/30"
          >
            <span className="text-[32px] md:text-[48px] font-display text-[var(--accent-primary)] leading-none drop-shadow-[0_0_20px_rgba(216,155,69,0.3)]">
              <CountUp value={50} suffix="+" duration={2500} delay={200} />
            </span>
            <span className="text-[var(--text-secondary)] font-sans text-xs md:text-sm font-bold uppercase tracking-wider mt-2">
              Menu Items
            </span>
            <div className="w-12 h-[2px] bg-gradient-to-r from-[var(--accent-primary)] to-transparent opacity-30 mt-2" />
          </div>

          {/* Stat 2: Happy Customers */}
          <div
            data-stat-card
            className="flex flex-col items-center text-center p-4 md:p-6 rounded-2xl bg-[var(--bg-surface)]/60 backdrop-blur-sm border border-[var(--divider)] transition-all duration-500 ease-out hover:bg-[var(--bg-surface)]/80 hover:border-[var(--mint)]/30"
          >
            <span className="text-[32px] md:text-[48px] font-display text-[var(--mint)] leading-none drop-shadow-[0_0_20px_rgba(90,140,97,0.3)]">
              <CountUp value={10} suffix="K+" duration={2500} delay={400} />
            </span>
            <span className="text-[var(--text-secondary)] font-sans text-xs md:text-sm font-bold uppercase tracking-wider mt-2">
              Happy Customers
            </span>
            <div className="w-12 h-[2px] bg-gradient-to-r from-[var(--mint)] to-transparent opacity-30 mt-2" />

            <div className="flex items-center justify-center mt-3">
              <div className="flex -space-x-3">
                {AVATARS.slice(0, 5).map((person, i) => (
                  <img
                    key={person.name}
                    src={person.src}
                    alt={person.name}
                    loading="lazy"
                    decoding="async"
                    className="w-8 h-8 md:w-9 md:h-9 rounded-full border-2 border-[var(--bg-secondary)] object-cover will-change-transform"
                    style={{ animationDelay: `${i * 0.3}s` }}
                  />
                ))}
              </div>
            </div>

            <TestimonialRotator reduced={reduced} />
          </div>

          {/* Stat 3: Rating */}
          <div
            data-stat-card
            className="flex flex-col items-center text-center p-4 md:p-6 rounded-2xl bg-[var(--bg-surface)]/60 backdrop-blur-sm border border-[var(--divider)] transition-all duration-500 ease-out hover:bg-[var(--bg-surface)]/80 hover:border-[var(--accent-secondary)]/30"
          >
            <span className="text-[32px] md:text-[48px] font-display text-[var(--accent-secondary)] leading-none drop-shadow-[0_0_20px_rgba(231,184,109,0.3)]">
              <CountUp value={4.9} decimals={1} prefix="" suffix="" duration={2500} delay={600} />
            </span>
            <span className="text-[var(--text-secondary)] font-sans text-xs md:text-sm font-bold uppercase tracking-wider mt-2">
              Rating
            </span>
            <div className="flex items-center gap-1 mt-0.5">
              {[1, 2, 3, 4, 5].map((star) => (
                <span key={star} className="material-symbols-outlined text-[var(--accent-primary)] text-sm" style={{ fontVariationSettings: '"FILL" 1' }}>
                  star
                </span>
              ))}
            </div>
          </div>

          {/* Stat 4: Fresh Ingredients */}
          <div
            data-stat-card
            className="flex flex-col items-center text-center p-4 md:p-6 rounded-2xl bg-[var(--bg-surface)]/60 backdrop-blur-sm border border-[var(--divider)] transition-all duration-500 ease-out hover:bg-[var(--bg-surface)]/80 hover:border-[var(--accent-primary)]/30"
          >
            <span className="text-[32px] md:text-[48px] font-display text-[var(--accent-primary)] leading-none drop-shadow-[0_0_20px_rgba(216,155,69,0.3)]">
              <CountUp value={100} suffix="%" duration={2500} delay={800} />
            </span>
            <span className="text-[var(--text-secondary)] font-sans text-xs md:text-sm font-bold uppercase tracking-wider mt-2">
              Fresh Ingredients
            </span>
            <div className="w-12 h-[2px] bg-gradient-to-r from-[var(--accent-primary)] to-transparent opacity-30 mt-2" />
          </div>
        </div>
      </div>
    </section>
  )
}
