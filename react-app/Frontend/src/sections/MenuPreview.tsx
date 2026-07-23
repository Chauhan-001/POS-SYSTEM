import { useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { createMenuPreviewReveal } from '../animations'

/* ------------------------------------------------------------------ */
/* Data                                                               */
/* ------------------------------------------------------------------ */
const IMG = {
  corn: 'https://lh3.googleusercontent.com/aida-public/AB6AXuDZdHu-3r3wam_85RlPRoERO2BurJKyN-vcflEJVOvaVwYTAJXqN3R9VIiqsGQIrP7jTxPCiNM2QKzENNy0BBjeXMPA3qs3cA1ZxA3euFWN5D7oSkCTYG5APzlN_wOwUo52x1frT_pTXfLniYrPFQx8uODOzGx-PhrQ8KjL7N0KkAJ-FgcizaquX1XxIQxYo7b7VIM3po_x-Y2zZOZD_orV0vubjNVWKD4FuBX-ocR9adMIvXwQLs-QkL8HqygfneqLXZsuznkIB3Oq',
  bunMaska: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBLynb03nKN6mL1MsnSSw5HhntZylgqaLuurA3O9CQH6PhvpVMjrThn1tDcEtj6QdzqZWxsL4WYDWsUJ-w7UG_6kW5oY0nUkB3wG0XQ1y3-kR16oNay9vkuNw8rIGNEREmXNi0N9wz-YE8Zt7HXmLiOFM67QmJod0hIm5ksV_YdwRget-ZJzVbkgtL5FH9HoUQBo3wBNITudtgYfIZBwUyL8t1ZIeeGsM0TpuxYunZXqZhof3dxwDTPrI4q_ZDbkhM1HfH38dkaKfKa',
  noodles: 'https://lh3.googleusercontent.com/aida-public/AB6AXuAOwq-C14ZiG2yI-TspMLeIdk9Ypd3Ietp4BlOMzDmgjPFCxD4P80zcFoo4D3h7Fj_4qcl7b_QnQK6Nb587AgDqBE5NmLCZxbyIFKH1elJl71LzZEB3tQ3j-9uK3PqGR_6qtbPaSU8rktY2I9Oy2QSdThwQGgucRWT0mKnSOCNGXzBTxan_vIuh_AHPWP2ALqjZlkH7RAOcQ3M3BBD7qo3FAi98yhPeaq1qHoI_VEWYofhAV5927OpmYDmytNLAUxF8neNy-oEd4Z-0',
  shikanji: 'https://lh3.googleusercontent.com/aida-public/AB6AXuCskVK5hhosjNPy0pY0aZJWwU_A3Yr8umyvplf5ZF1HRN-J2gSGcX_Nf-P52ijmtqk6Ej9sQXeeu5hKCMhVf9s7TlUd3PlCG5KKG9tuRBshc4ZxtiGwYyE-4T8baUZ9VkJzPSHd0vS6yr4m9H8rdpZxUnWZdBnuRIJ_8iVu1LM8bfZfTrYEsrixsNCTCMV-T0vrfU1uCfyjk9MuPeNUQV_MyBeVg5A2Ox919PcSPA6fW2DfDPJ_2uQe1ChNmtBy_QjY7nckLBW3PQZO',
  shake: 'https://lh3.googleusercontent.com/aida-public/AB6AXuAejKN1UJMQqrcKAs0DgZa0J62Su_WC94Fyq4RkTzzAG1V2DeXPIjX1OF6w64868j0voNHd3fseA9AgzEVlo7UQ3maKWrXMUPWpF_PU53BinrvHYOTPNbHXUf9x42WHg0yGeiIxsc542X25dzQVEQV0YxNmJodLie_pf5EvtTe5ajLRWEDzVCH5SeH4kkUTyC8N2VVSO_d6P8X5nvvXeV6sdbdOVgNJedaSjdB-mxFIVNK2q5mDigITw6WIlaUHwsJCxJGJU9vPGhIO',
  coldCoffee: 'https://lh3.googleusercontent.com/aida-public/AB6AXuAnnr1UyPmMIwhwe5OBgupqFUjWipgbN0nyPONMwew2-hnTAXsyVBaPdGUuZWbAZm49LI_KY45hxpM6YxXDkvJTmi40JKL_Q63lGm9-SAtZ761sGyIMGzJCULcK-9Jgo6jkAW-j5bBDalglIUtUUwCWrGh-Tnj2bUqTEEoDkqD1dEoyPR68GrY18RDj6m_niHqp0QlvdYBL7o657AwPi7YnK1iv9fNv7DaWz_38yPM2mU96tcyStiW6GM4E1cpL7NQkG7t2vFb5QKBE',
}

type Eat = {
  name: string
  price: string
  img: string
  tag?: string
  tagClass: string
}

const eatables: Eat[] = [
  {
    name: 'PERI PERI FRIES',
    price: '₹90',
    img: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBifnqqqYIYJ1-FIOUBHm998lb6EuzVVBn4sjCqzok-aEsqFpMDVUeQv0hMawSqga7t0qwDa_40QW7Bn4G0OBlLEgiUB9UvgkhmHNbnUb_s_sgOZjDMBNtfe8csEkK-br62v351J8eb_pv9WuBt0WmG1XSxBjSYfo5AGTo8gHc-vMe_nTNWCBSadHHQAHgPuVfHfhhK-4-yKbROEbHnGN7iGtYC78jCDpothg3KvX18AN4lBZiWnABXCpSi4CPqhq1cyOzsY2MOPieo',
    tag: 'Spicy',
    tagClass: 'bg-[var(--mint)] text-[var(--bg-primary)]',
  },
  { name: 'SPICE CORN', price: '₹70', img: IMG.corn, tagClass: '' },
  {
    name: 'BUN MASKA',
    price: '₹50',
    img: IMG.bunMaska,
    tag: 'Classic',
    tagClass: 'bg-[var(--accent-primary)] text-[var(--bg-primary)]',
  },
  { name: 'MASALA MAGGI', price: '₹80', img: IMG.noodles, tagClass: '' },
]

const drinks: Eat[] = [
  {
    name: 'CHOCOLATE SHAKE',
    price: '₹140',
    img: IMG.shake,
    tag: 'Bestseller',
    tagClass: 'bg-[var(--mint)] text-[var(--bg-primary)]',
  },
  {
    name: 'ICED LEMON TEA',
    price: '₹100',
    img: IMG.shikanji,
    tag: 'Refreshing',
    tagClass: 'bg-[var(--accent-secondary)] text-[var(--bg-primary)]',
  },
  { name: 'COLD COFFEE', price: '₹120', img: IMG.coldCoffee, tagClass: '' },
]

/* ------------------------------------------------------------------ */
/* Carousel Component                                                 */
/* ------------------------------------------------------------------ */
function Carousel({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null)

  const scrollByCard = (dir: number) => {
    const el = ref.current
    if (!el) return
    const card = el.querySelector('[data-card]') as HTMLElement | null
    const amount = card ? card.offsetWidth + 24 : 350
    el.scrollBy({ left: dir * amount, behavior: 'smooth' })
  }

  return (
    <div className="relative">
      <div ref={ref} className="flex overflow-x-auto snap-x-mandatory gap-6 pb-6 no-scrollbar scroll-smooth">
        {children}
      </div>
      <div className="hidden md:flex gap-3 absolute right-4 -top-16">
        <motion.button
          whileHover={{ scale: 1.08, backgroundColor: 'var(--bg-surface)' }}
          whileTap={{ scale: 0.92 }}
          transition={{ type: 'spring', stiffness: 400, damping: 10 }}
          aria-label="Previous"
          onClick={() => scrollByCard(-1)}
          className="w-12 h-12 rounded-full border-2 border-[var(--divider)] flex items-center justify-center text-[var(--text-primary)]"
        >
          <span className="material-symbols-outlined">arrow_back</span>
        </motion.button>
        <motion.button
          whileHover={{ scale: 1.08, backgroundColor: 'var(--accent-primary)' }}
          whileTap={{ scale: 0.92 }}
          transition={{ type: 'spring', stiffness: 400, damping: 10 }}
          aria-label="Next"
          onClick={() => scrollByCard(1)}
          className="w-12 h-12 rounded-full bg-[var(--accent-primary)] text-[var(--bg-primary)] flex items-center justify-center shadow-sm"
        >
          <span className="material-symbols-outlined">arrow_forward</span>
        </motion.button>
      </div>
    </div>
  )
}

function ProductCard({ item }: { item: Eat }) {
  return (
    <motion.div
      data-card
      whileHover={{ y: -6, boxShadow: '0 20px 40px -12px rgba(216,155,69,0.18)' }}
      transition={{ type: 'spring', stiffness: 300, damping: 15 }}
      className="min-w-[80vw] md:min-w-[350px] snap-start bg-[var(--bg-surface)]/80 backdrop-blur-sm rounded-2xl p-3 border border-[var(--divider)] hover:border-[var(--accent-primary)]/20 transition-[border-color,opacity] duration-500 ease-out group cursor-pointer relative overflow-hidden"
    >
      {item.tag && (
        <div
          className={`absolute top-3 right-3 ${
            item.tagClass || 'bg-[var(--bg-surface)] text-[var(--text-secondary)]'
          } font-sans text-[10px] font-bold uppercase px-2 py-1 rounded-full z-10 shadow-sm`}
        >
          {item.tag}
        </div>
      )}
      <div className="aspect-[4/5] w-full rounded-xl overflow-hidden mb-3 relative flex items-center justify-center bg-[var(--bg-primary)]">
        <img
          alt={item.name}
          className="w-full h-full object-contain transition-transform duration-700 ease-out group-hover:scale-105 will-change-transform"
          src={item.img}
        />
      </div>
      <div className="px-2 pb-2">
        <h3 className="font-display text-xl text-[var(--accent-primary)] uppercase leading-none">
          {item.name}
        </h3>
        <div className="flex justify-between items-center mt-2">
          <span className="font-sans text-lg text-[var(--accent-primary)] font-semibold">
            {item.price}
          </span>
          <motion.button
            whileHover={{ scale: 1.1, backgroundColor: 'var(--accent-primary)', color: 'var(--bg-primary)' }}
            whileTap={{ scale: 0.9 }}
            transition={{ type: 'spring', stiffness: 400, damping: 8 }}
            aria-label={`Add ${item.name}`}
            className="w-8 h-8 rounded-full bg-[var(--accent-primary)] text-[var(--bg-primary)] flex items-center justify-center shadow-sm"
          >
            <span className="material-symbols-outlined text-sm font-bold">add</span>
          </motion.button>
        </div>
      </div>
    </motion.div>
  )
}

/* ------------------------------------------------------------------ */
/* Main Export                                                        */
/* ------------------------------------------------------------------ */
export default function MenuPreview() {
  const sectionRef = useRef<HTMLDivElement | null>(null)
  const reduced = useReducedMotion()

  const isTouch =
    typeof window !== 'undefined' &&
    ('ontouchstart' in window || navigator.maxTouchPoints > 0)
  const pf = isTouch ? 0.4 : 1

  useEffect(() => {
    const container = sectionRef.current
    if (!container) return
    let menuResult: ReturnType<typeof createMenuPreviewReveal> | null = null
    if (!reduced) {
      menuResult = createMenuPreviewReveal({ container, parallaxFactor: pf })
    }
    return () => { menuResult?.kill() }
  }, [reduced, pf])

  return (
    <div ref={sectionRef}>
      {/* ─── Eatables ─── */}
      <section
        data-section="eatables"
        className="min-h-screen py-20 relative w-full overflow-hidden bg-gradient-to-br from-[var(--bg-primary)] to-[var(--bg-secondary)] flex items-center"
      >
        <div className="max-w-7xl w-full mx-auto px-4 md:px-16 relative z-10">
          <div className="flex justify-between items-end mb-12">
            <div>
              <h2
                data-reveal="eat-heading"
                className="font-display text-[32px] md:text-[48px] text-[var(--text-primary)] uppercase tracking-[-0.02em]"
              >
                Eatables
              </h2>
              <p
                data-reveal="eat-sub"
                className="font-sans text-[var(--text-secondary)] text-base mt-2"
              >
                Spicy, crispy, and comforting snacks.
              </p>
            </div>
          </div>
          <Carousel>
            {eatables.map((item) => (
              <ProductCard key={item.name} item={item} />
            ))}
          </Carousel>
        </div>
      </section>

      {/* ─── Thirst Quenchers ─── */}
      <section
        data-section="quenchers"
        className="min-h-screen py-20 relative w-full overflow-hidden bg-gradient-to-br from-[var(--bg-secondary)] via-[var(--bg-primary)] to-[var(--mint)]/10 flex items-center"
      >
        <div className="max-w-7xl w-full mx-auto px-4 md:px-16 relative z-10">
          <div className="flex justify-between items-end mb-12">
            <div>
              <h2
                data-reveal="drink-heading"
                className="font-display text-[32px] md:text-[48px] text-[var(--text-primary)] uppercase tracking-[-0.02em]"
              >
                Thirst Quenchers
              </h2>
              <p
                data-reveal="drink-sub"
                className="font-sans text-[var(--text-secondary)] text-base mt-2"
              >
                Modern sips crafted with traditional passion.
              </p>
            </div>
          </div>
          <Carousel>
            {drinks.map((item) => (
              <ProductCard key={item.name} item={item} />
            ))}
          </Carousel>
        </div>
      </section>
    </div>
  )
}
