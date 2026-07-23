import { useEffect, useRef } from 'react'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { IS_MOBILE } from '../utils/constants'
import { gsap } from 'gsap'
import { createScrollStory } from '../animations'
import { createTeaLeafDrift, createMintFloat } from '../animations/microInteractions'

/* ------------------------------------------------------------------ */
/* Constants                                                          */
/* ------------------------------------------------------------------ */
const IMG_VADAPAV =
  'https://lh3.googleusercontent.com/aida-public/AB6AXuBIwbLIoa3d87UsEWEPahDH_4LkwsVm0-tsBtHaw4UjP0UM0SK-iqY61Y9dV2piPhaymj42JMj98Cglw0w9NU1NrY-chiK91X2x__7t-NsfRF690TvZ4JzybQDwTsTADTUXIiwHNWKqAhu2PemEax6uN_61GN4iIH-M0179sH_YWhZ7I9RJjM5rCGAdcc6PO8efnjPnlfyV9xhD2xFUyS3L1swOvX1Wp_TK8HBaPH4dyQWd-x3Svh_-RgOwWmqwByS3RAqkKxm-Qx-s'

const IMG_CHAI =
  'https://lh3.googleusercontent.com/aida-public/AB6AXuALi94RMdw_YyZXuJV2nRs7B3ky0NpPhC_xjejjGQh0NMV9bxsRagO0TBzZ9bqDFFfwn-mveS0zxyQurkisARgViE6Kfs7s7AaWKkCcwvp8-0yVJ6yscMpuEuJn1UjoeQrnk16t_N4sA6k2tXX2SaHSnvbuQRY6BkFjwdxHwe716_1ndtuJMq0FXilDHrwB5RweweO9QKORNG6vDZlX0p69mrRMBR2xRJG2LTRI2m2FG9cFl_yze7iKlRGqIkjtLDsDRDmzcEsaxI1l'

/* ------------------------------------------------------------------ */
/* Steam effect - continuous rising particles                         */
/* ------------------------------------------------------------------ */
function SteamRise({ className = '' }: { className?: string }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const reduced = useReducedMotion()

  useEffect(() => {
    const el = ref.current
    if (!el || reduced) return

    const particles: HTMLElement[] = []
    for (let i = 0; i < 12; i++) {
      const p = document.createElement('div')
      const size = 20 + Math.random() * 30
      p.style.cssText = [
        'position:absolute',
        'pointer-events:none',
        `width:${size}px`,
        `height:${size}px`,
        `left:${10 + Math.random() * 80}%`,
        'bottom:20%',
        'background:radial-gradient(circle,rgba(255,255,255,0.5) 0%,rgba(255,255,255,0) 70%)',
        'border-radius:9999px',
        'filter:blur(4px)',
        'opacity:0',
      ].join(';')
      el.appendChild(p)
      particles.push(p)
    }

    const tweens = particles.map((p) => {
      const d = 3 + Math.random() * 2
      return gsap.to(p, {
        y: -120 - Math.random() * 80,
        x: () => -20 + Math.random() * 40,
        scale: 1.4,
        opacity: 0.5,
        duration: d,
        repeat: -1,
        delay: Math.random() * 3,
        ease: 'power1.out',
      })
    })

    return () => {
      tweens.forEach((t) => t.kill())
      particles.forEach((p) => p.remove())
    }
  }, [])

  return (
    <div
      ref={ref}
      className={`pointer-events-none absolute inset-0 z-10 ${className}`}
    />
  )
}

/* ------------------------------------------------------------------ */
/* Component                                                          */
/* ------------------------------------------------------------------ */
export default function ProductScrollStory() {
  const reduced = useReducedMotion()
  const sectionRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const section = sectionRef.current
    if (!section) return

    const decorTweens: gsap.core.Tween[] = []
    let scrollStoryResult: ReturnType<typeof createScrollStory> | null = null

    if (!reduced) {
      scrollStoryResult = createScrollStory({
        container: section,
        speed: 1,
        skipIdle: IS_MOBILE,
      })

      // Decorative micro-interactions (desktop only)
      if (!IS_MOBILE) {
        const teaLeaves = section.querySelectorAll('[data-decor="tea-leaf"]')
        teaLeaves.forEach((leaf) =>
          decorTweens.push(createTeaLeafDrift(leaf))
        )
        const mintLeaves = section.querySelectorAll('[data-decor="mint-leaf"]')
        mintLeaves.forEach((leaf) =>
          decorTweens.push(createMintFloat(leaf))
        )
      }
    }

    return () => {
      // Kill the scroll story timeline + its ScrollTrigger
      scrollStoryResult?.kill()
      // Kill decorative tweens
      decorTweens.forEach((t) => t.kill())
    }
  }, [])

  return (
    <section
      ref={sectionRef}
      data-scroll-story
      className="relative h-screen w-full overflow-hidden bg-gradient-to-br from-[#231a13] via-[#3b2417] to-[#231a13]"
    >
      {/* Subtle warm texture overlay */}
      <div
        className="absolute inset-0 opacity-[0.04] pointer-events-none"
        style={{
          backgroundImage:
            'radial-gradient(circle at 30% 40%, #ff9933 1px, transparent 1px), radial-gradient(circle at 70% 60%, #63c767 1px, transparent 1px)',
          backgroundSize: '60px 60px, 80px 80px',
        }}
      />

      {/* Decorative concentric rings */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-15">
        <div className="w-[70vw] h-[70vw] md:w-[50vw] md:h-[50vw] rounded-full border-[1px] border-[#e8924b]/20 animate-spin-slow" />
        <div
          className="w-[50vw] h-[50vw] md:w-[35vw] md:h-[35vw] rounded-full border-[1px] border-[#ff9933]/15 animate-spin-slow absolute"
          style={{
            animationDirection: 'reverse',
            animationDuration: '20s',
          }}
        />
      </div>

      {/* Content */}
      <div className="relative z-10 h-full flex flex-col items-center justify-center px-6 md:px-16">
        {/* Products */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          {/* Vada Pav — enters from right on curved path */}
          <img
            data-product="vadapav"
            alt="Vada Pav — the iconic Mumbai street food"
            src={IMG_VADAPAV}
            className="absolute w-[55vw] md:w-[28vw] max-w-[380px] object-contain drop-shadow-[0_30px_60px_rgba(232,164,75,0.3)] will-change-transform"
            style={{ right: '5%', top: '50%', transform: 'translateY(-50%)' }}
          />

          {/* Cutting Chai — enters from left on curved path */}
          <img
            data-product="chai"
            alt="Kulhad Chai — traditional clay cup tea"
            src={IMG_CHAI}
            className="absolute w-[45vw] md:w-[24vw] max-w-[340px] object-contain drop-shadow-[0_30px_60px_rgba(232,164,75,0.25)] will-change-transform"
            style={{ left: '5%', top: '50%', transform: 'translateY(-50%)' }}
          />
        </div>

        {/* Steam — continuously rising from chai side */}
        <SteamRise />

        {/* Center text */}
        <div className="text-center z-20 max-w-3xl mt-auto mb-24 md:mb-32">
          <h2
            data-story-title
            className="font-display text-[clamp(28px,6vw,56px)] text-white/95 uppercase leading-none tracking-[0.04em] drop-shadow-lg"
          >
            The Crunch You Came For
          </h2>
          <p
            data-story-subtitle
            className="font-sans text-[#dbc2b0] text-sm md:text-base tracking-widest uppercase mt-3"
          >
            Vada Pav • Cutting Chai
          </p>
          <p
            data-story-tagline
            className="font-sans text-[#a0806e] text-xs md:text-sm mt-2 max-w-md mx-auto italic"
          >
            Not just food. An emotion.
          </p>
        </div>
      </div>

      {/* ─── Decorative micro-interactions ─── */}

      {/* Tea leaves — slow random floating near chai side */}
      <img
        data-decor="tea-leaf"
        src="/assets/tea/clusteredTeaLeaves.webp"
        alt=""
        className="absolute w-12 md:w-16 opacity-30 pointer-events-none"
        style={{ left: '10%', top: '25%' }}
      />
      <img
        data-decor="tea-leaf"
        src="/assets/tea/teasplash.webp"
        alt=""
        className="absolute w-16 md:w-20 opacity-20 pointer-events-none"
        style={{ left: '5%', top: '65%' }}
      />

      {/* Mint leaves — slow drift near center */}
      <img
        data-decor="mint-leaf"
        src="/assets/mint/mint-01.png"
        alt=""
        className="absolute w-14 md:w-20 opacity-25 pointer-events-none"
        style={{ right: '15%', top: '30%' }}
      />
      <img
        data-decor="mint-leaf"
        src="/assets/mint/mint-leaves-branch.webp"
        alt=""
        className="absolute w-20 md:w-28 opacity-20 pointer-events-none"
        style={{ right: '8%', top: '60%' }}
      />

      {/* Tea masala aroma — warm spice aura */}
      <img
        src="/assets/effects/teaMasalaAroma.webp"
        alt=""
        className="absolute left-[15%] top-[10%] w-40 md:w-64 opacity-25 pointer-events-none"
      />

      {/* Natural tea steam — organic steam beside chai */}
      <img
        src="/assets/effects/steam/naturalTeaSteam.webp"
        alt=""
        className="absolute left-[2%] top-[30%] w-32 md:w-48 opacity-20 pointer-events-none"
      />

      {/* Tiny beverage bubbles — lively accent near drinks */}
      <img
        src="/assets/effects/tinybeveragesbubbles.webp"
        alt=""
        className="absolute right-[12%] top-[20%] w-28 md:w-40 opacity-20 pointer-events-none"
      />

      {/* Lemon water splash — fresh accent */}
      <img
        src="/assets/effects/lemonwatersplash.webp"
        alt=""
        className="absolute right-[20%] bottom-[10%] w-20 md:w-32 opacity-15 pointer-events-none"
      />

      {/* Spices — subtle decorative presence */}
      <img
        src="/assets/spices/staranise.webp"
        alt=""
        className="absolute w-8 md:w-10 opacity-20 pointer-events-none"
        style={{ left: '28%', bottom: '15%' }}
      />
      <img
        src="/assets/spices/cinnamonSticksingle.webp"
        alt=""
        className="absolute w-10 md:w-14 opacity-25 pointer-events-none"
        style={{ right: '25%', bottom: '20%' }}
      />

      {/* Golden dust particle overlay */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.06]"
        style={{
          backgroundImage:
            "url('/assets/effects/goldenfloatingdustparticle.webp')",
          backgroundSize: '180px 180px',
          backgroundRepeat: 'repeat',
        }}
      />

      {/* Gradient fade at edges */}
      <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-[#231a13] to-transparent pointer-events-none" />
      <div className="absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-[#231a13]/80 to-transparent pointer-events-none" />
    </section>
  )
}
