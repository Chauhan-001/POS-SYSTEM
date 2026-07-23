import { useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { PF } from '../utils/constants'
import { createGalleryReveal } from '../animations'

/* ------------------------------------------------------------------ */
/* Data                                                               */
/* ------------------------------------------------------------------ */

type GalleryItem = {
  src: string
  alt: string
  span: string
  label: string
  labelClass: string
}

const IMG = {
  bunMaska: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBLynb03nKN6mL1MsnSSw5HhntZylgqaLuurA3O9CQH6PhvpVMjrThn1tDcEtj6QdzqZWxsL4WYDWsUJ-w7UG_6kW5oY0nUkB3wG0XQ1y3-kR16oNay9vkuNw8rIGNEREmXNi0N9wz-YE8Zt7HXmLiOFM67QmJod0hIm5ksV_YdwRget-ZJzVbkgtL5FH9HoUQBo3wBNITudtgYfIZBwUyL8t1ZIeeGsM0TpuxYunZXqZhof3dxwDTPrI4q_ZDbkhM1HfH38dkaKfKa',
  shake: 'https://lh3.googleusercontent.com/aida-public/AB6AXuAejKN1UJMQqrcKAs0DgZa0J62Su_WC94Fyq4RkTzzAG1V2DeXPIjX1OF6w64868j0voNHd3fseA9AgzEVlo7UQ3maKWrXMUPWpF_PU53BinrvHYOTPNbHXUf9x42WHg0yGeiIxsc542X25dzQVEQV0YxNmJodLie_pf5EvtTe5ajLRWEDzVCH5SeH4kkUTyC8N2VVSO_d6P8X5nvvXeV6sdbdOVgNJedaSjdB-mxFIVNK2q5mDigITw6WIlaUHwsJCxJGJU9vPGhIO',
  shikanji: 'https://lh3.googleusercontent.com/aida-public/AB6AXuCskVK5hhosjNPy0pY0aZJWwU_A3Yr8umyvplf5ZF1HRN-J2gSGcX_Nf-P52ijmtqk6Ej9sQXeeu5hKCMhVf9s7TlUd3PlCG5KKG9tuRBshc4ZxtiGwYyE-4T8baUZ9VkJzPSHd0vS6yr4m9H8rdpZxUnWZdBnuRIJ_8iVu1LM8bfZfTrYEsrixsNCTCMV-T0vrfU1uCfyjk9MuPeNUQV_MyBeVg5A2Ox919PcSPA6fW2DfDPJ_2uQe1ChNmtBy_QjY7nckLBW3PQZO',
  coldCoffee: 'https://lh3.googleusercontent.com/aida-public/AB6AXuAnnr1UyPmMIwhwe5OBgupqFUjWipgbN0nyPONMwew2-hnTAXsyVBaPdGUuZWbAZm49LI_KY45hxpM6YxXDkvJTmi40JKL_Q63lGm9-SAtZ761sGyIMGzJCULcK-9Jgo6jkAW-j5bBDalglIUtUUwCWrGh-Tnj2bUqTEEoDkqD1dEoyPR68GrY18RDj6m_niHqp0QlvdYBL7o657AwPi7YnK1iv9fNv7DaWz_38yPM2mU96tcyStiW6GM4E1cpL7NQkG7t2vFb5QKBE',
  noodles: 'https://lh3.googleusercontent.com/aida-public/AB6AXuAOwq-C14ZiG2yI-TspMLeIdk9Ypd3Ietp4BlOMzDmgjPFCxD4P80zcFoo4D3h7Fj_4qcl7b_QnQK6Nb587AgDqBE5NmLCZxbyIFKH1elJl71LzZEB3tQ3j-9uK3PqGR_6qtbPaSU8rktY2I9Oy2QSdThwQGgucRWT0mKnSOCNGXzBTxan_vIuh_AHPWP2ALqjZlkH7RAOcQ3M3BBD7qo3FAi98yhPeaq1qHoI_VEWYofhAV5927OpmYDmytNLAUxF8neNy-oEd4Z-0',
  periPeri: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBifnqqqYIYJ1-FIOUBHm998lb6EuzVVBn4sjCqzok-aEsqFpMDVUeQv0hMawSqga7t0qwDa_40QW7Bn4G0OBlLEgiUB9UvgkhmHNbnUb_s_sgOZjDMBNtfe8csEkK-br62v351J8eb_pv9WuBt0WmG1XSxBjSYfo5AGTo8gHc-vMe_nTNWCBSadHHQAHgPuVfHfhhK-4-yKbROEbHnGN7iGtYC78jCDpothg3KvX18AN4lBZiWnABXCpSi4CPqhq1cyOzsY2MOPieo',
  corn: 'https://lh3.googleusercontent.com/aida-public/AB6AXuDZdHu-3r3wam_85RlPRoERO2BurJKyN-vcflEJVOvaVwYTAJXqN3R9VIiqsGQIrP7jTxPCiNM2QKzENNy0BBjeXMPA3qs3cA1ZxA3euFWN5D7oSkCTYG5APzlN_wOwUo52x1frT_pTXfLniYrPFQx8uODOzGx-PhrQ8KjL7N0KkAJ-FgcizaquX1XxIQxYo7b7VIM3po_x-Y2zZOZD_orV0vubjNVWKD4FuBX-ocR9adMIvXwQLs-QkL8HqygfneqLXZsuznkIB3Oq',
}

const galleryItems: GalleryItem[] = [
  {
    src: IMG.shake,
    alt: 'Rich chocolate shake — a customer favorite',
    span: 'md:col-span-1 md:row-span-2',
    label: 'Indulgent',
    labelClass: 'bg-[var(--accent-primary)] text-[var(--bg-primary)]',
  },
  {
    src: IMG.bunMaska,
    alt: 'Classic Bun Maska — crispy, buttery, perfect',
    span: 'md:col-span-1',
    label: 'Classic',
    labelClass: 'bg-[var(--accent-primary)] text-[var(--bg-primary)]',
  },
  {
    src: IMG.coldCoffee,
    alt: 'Cold coffee — chilled perfection',
    span: 'md:col-span-1',
    label: 'Refreshing',
    labelClass: 'bg-[var(--mint)] text-[var(--bg-primary)]',
  },
  {
    src: IMG.shikanji,
    alt: 'Shikanji — summer poured into a glass',
    span: 'md:col-span-2',
    label: 'Signature',
    labelClass: 'bg-[var(--accent-secondary)] text-[var(--bg-primary)]',
  },
  {
    src: IMG.noodles,
    alt: 'Masala Maggi — spicy and soulful',
    span: 'md:col-span-1',
    label: 'Comfort',
    labelClass: 'bg-[var(--accent-primary)] text-[var(--bg-primary)]',
  },
  {
    src: IMG.periPeri,
    alt: 'Peri Peri Fries — spicy perfection',
    span: 'md:col-span-1',
    label: 'Spicy',
    labelClass: 'bg-[var(--accent-primary)] text-[var(--bg-primary)]',
  },
]

/* ------------------------------------------------------------------ */
/* Component                                                          */
/* ------------------------------------------------------------------ */

export default function GallerySection() {
  const sectionRef = useRef<HTMLElement | null>(null)
  const reduced = useReducedMotion()

  useEffect(() => {
    const section = sectionRef.current
    if (!section) return

    let galleryResult: ReturnType<typeof createGalleryReveal> | null = null

    if (!reduced) {
      galleryResult = createGalleryReveal({
        container: section,
        parallaxFactor: PF,
      })
    }

    return () => {
      galleryResult?.kill()
    }
  }, [reduced])

  return (
    <section
      ref={sectionRef}
      className="relative py-24 md:py-32 w-full overflow-hidden bg-gradient-to-b from-[var(--bg-primary)] via-[var(--bg-secondary)] to-[var(--bg-primary)]"
    >
      {/* Warm atmosphere overlay */}
      <div className="absolute inset-0 bg-gradient-to-b from-[var(--accent-primary)]/5 via-transparent to-[var(--accent-primary)]/5 pointer-events-none" />

      {/* Golden dust texture */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.03]"
        style={{
          backgroundImage:
            "url('/assets/effects/goldenfloatingdustparticle.webp')",
          backgroundSize: '140px 140px',
          backgroundRepeat: 'repeat',
        }}
      />

      <div className="relative z-10 max-w-7xl mx-auto px-4 md:px-16">
        {/* ── Section header ── */}
        <div className="mb-14 md:mb-20">
          <h2
            data-gallery-title
            className="font-display text-[clamp(28px,5vw,48px)] text-[var(--text-primary)] uppercase leading-[1.1] tracking-[-0.02em]"
          >
            A Visual Feast
          </h2>
          <p
            data-gallery-sub
            className="font-sans text-[var(--text-secondary)] text-sm md:text-base mt-3 max-w-lg"
          >
            Every dish tells a story. Every sip captures a moment.
          </p>
        </div>

        {/* ── Gallery grid ── */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 md:gap-6 auto-rows-[200px] md:auto-rows-[280px]">
          {galleryItems.map((item) => (
            <motion.div
              key={item.label}
              data-gallery-item
              whileHover={{ y: -4, scale: 1.02 }}
              transition={{ type: 'spring', stiffness: 300, damping: 18 }}
              className={`relative rounded-2xl overflow-hidden group cursor-pointer bg-[var(--bg-surface)]/60 border border-[var(--divider)] hover:border-[var(--accent-primary)]/30 transition-[border-color,opacity] duration-500 ease-out ${item.span}`}
            >
              <img
                src={item.src}
                alt={item.alt}
                loading="lazy"
                className="w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-105 will-change-transform"
              />
              {/* Gradient overlay */}
              <div className="absolute inset-0 bg-gradient-to-t from-[var(--bg-primary)]/80 via-transparent to-transparent pointer-events-none" />

              {/* Label */}
              <div
                className={`absolute bottom-3 left-3 ${item.labelClass} font-sans text-[10px] font-bold uppercase px-2.5 py-1 rounded-full shadow-sm`}
              >
                {item.label}
              </div>
            </motion.div>
          ))}
        </div>

        {/* ── Decorative elements with parallax ── */}
        <img data-decor data-decor-speed="0.4" src="/assets/tea/clusteredTeaLeaves.webp" alt="" className="absolute w-16 md:w-24 opacity-0 pointer-events-none" style={{ left: '3%', top: '25%' }} />
        <img data-decor data-decor-speed="0.25" src="/assets/effects/teaMasalaAroma.webp" alt="" className="absolute w-24 md:w-36 opacity-0 pointer-events-none" style={{ left: '20%', top: '10%' }} />
        <img data-decor data-decor-speed="0.3" src="/assets/spices/staranise.webp" alt="" className="absolute w-8 md:w-12 opacity-0 pointer-events-none" style={{ right: '8%', top: '40%' }} />
        <img data-decor data-decor-speed="0.5" src="/assets/lemon/lemonSlice.webp" alt="" className="absolute w-12 md:w-16 opacity-0 pointer-events-none" style={{ left: '10%', bottom: '15%' }} />
        <img data-decor data-decor-speed="0.35" src="/assets/effects/lemonwatersplash.webp" alt="" className="absolute w-14 md:w-20 opacity-0 pointer-events-none" style={{ right: '25%', top: '55%' }} />
        <img data-decor data-decor-speed="0.35" src="/assets/ice/ice-cube-cluster.webp" alt="" className="absolute w-10 md:w-14 opacity-0 pointer-events-none" style={{ right: '5%', top: '15%' }} />
        <img data-decor data-decor-speed="0.3" src="/assets/effects/tinybeveragesbubbles.webp" alt="" className="absolute w-16 md:w-24 opacity-0 pointer-events-none" style={{ right: '12%', bottom: '25%' }} />
        <img data-decor data-decor-speed="0.45" src="/assets/spices/threeCinnamonpods.webp" alt="" className="absolute w-10 md:w-14 opacity-0 pointer-events-none" style={{ right: '15%', bottom: '20%' }} />
      </div>

      {/* Bottom fade */}
      <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[var(--bg-primary)] to-transparent pointer-events-none" />
    </section>
  )
}
