import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { PageShell } from '../components/layout/PageShell'
import { BottomNav } from '../components/layout/BottomNav'

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */
type Category = {
  label: string
  icon: string
  filled: boolean
}

type Dish = {
  name: string
  price: string
  desc: string
  badge: string
  badgeClass: string
  rating?: string
  orders?: string
  ordersIcon?: string
  image: string
}

type MenuRow = {
  name: string
  meta: string
  price: string
  image: string
}

/* ------------------------------------------------------------------ */
/* Data                                                               */
/* ------------------------------------------------------------------ */
const LOGO = 'https://lh3.googleusercontent.com/aida-public/AB6AXuBsBjEKIm3WYbnh0imtCLpFQfumKnkDnR8mSgPoxBfP4j1M54kjnsFwsPN_t9Eh1B1WTPR2r603eKPkTWhujKSPZiR9obR8yO36iiPu7lKiK8aaK98pf31eWCqNpaqzbO2Mw_GYznGVLv9hm_7vRHvmFzTq8IpKb369gJvHBNnv2u9ukEQSzNT24Zh6g8OFXhXsbsBeqkBdpCYJGUQrJLZx3iHQ90Of8x16IwjjlLT61uBfCYHqTv3p3H85ZdRfKzUSlsWrg53FwTHa'
const PATTERN_BG = 'https://lh3.googleusercontent.com/aida/AP1WRLu3xo7CGjU2hgbJfa-7JFhr6GMFVhu7sP2sn3DYEh0Wh6V20aC3IoinDuKnEYsJzlx-U3lgu_yb-N_C1zissxabsa7Zriul4O7tqqJUttuvukp8iTVZGCI6eblwhYkD4HLLWMehZKQMgKWbE1oyCBVCAuekJvir5kUZukZeYLnxu6iQ5TCxTKwrpUkfL6ob2b6Bu4_e0lNpfT0HkoV4DWiOkHVIlnCLiGAMfSknPQkM7rH2rm9gXKLjTBe-'

const categories: Category[] = [
  { label: 'All', icon: 'auto_awesome', filled: false },
  { label: 'Must Try', icon: 'local_fire_department', filled: true },
  { label: 'Signature', icon: 'stars', filled: false },
  { label: 'New', icon: 'new_releases', filled: false },
  { label: 'Vegan', icon: 'eco', filled: false },
]

const signatureDishes: Dish[] = [
  {
    name: 'The Ultimate Chaish',
    price: '12.99',
    desc: 'A curated explosion of authentic spices and premium ingredients served with a modern twist.',
    badge: 'Must Try',
    badgeClass: 'bg-primary text-white',
    rating: '4.9',
    orders: '120+ ordered today',
    image: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBxBn9ghFot1lJYgWuKlnozk3dK_xFDRBcaOABhLgcRsbR0MTTL9BIibmG0BR_oKQmui-HrVSNjSBomTZiTsok3sjDutKQ11DFUCewUP2E9I_LPr9CNT4er5zPJKPiLDq2sapZfuHQ2IE8rYsj5jIabaa3CLc6rzG-NyVrEFOdKhE7YZzYcmyQZvXd1iPT1FdIp3d3Odvi7sblX55dtLtYxj806yzMEXDjez-ZZ8SqU24ebP1zAoJlvXmOaDyH_rIwLlqo_0h8VECxZ',
  },
  {
    name: 'YOLO Spicy Wrap',
    price: '14.50',
    desc: 'Unleash the heat with our secret 12-spice blend wrapped in a hand-tossed artisan flatbread.',
    badge: 'Spicy',
    badgeClass: 'bg-sunset-orange text-white',
    orders: '10-15 mins',
    ordersIcon: 'timer',
    image: 'https://lh3.googleusercontent.com/aida-public/AB6AXuCH3vRG18cWDwbVUdSzzDFXn5czNRhK2szNr2EiqsqH_icWeBg2RJ-IP6QtHVK-dFUncqJ2PGp3Alxs9BjNE1mD7bmcCphmJsNm_UE80ay1MgyqOrHC5vGcYimVKilqcdpE8Vuck5dDEGseia-V0araRH1HOMOq2ivNi5uc5hqeSGGQuwbO-Ak9XTI5-DFz3nW19KqpOvp2mu5e2ILIvK5Xzfbco-ahRZwnE2Ac-2Yoaq3eJvzSNhn79IsQb7uVngLgDjfi5QpIqsMd',
  },
]

const menuRows: MenuRow[] = [
  {
    name: 'Cooling Hibiscus Bliss',
    meta: 'Refreshing • 100% Organic',
    price: '5.99',
    image: 'https://lh3.googleusercontent.com/aida-public/AB6AXuAOdCKkQEul5634jdxSUfCKmeaqfYxYTbkwhwe0J_cQr65P40DAbVYnIjcU_I4gIVo08FLaaeu_AX59AE1eVCq-HmknyU6Xxal1NRdkiLVqzhlo7y-u9mnRoNeHo62Co8MO2z-wadpj-KYPXNAUtm1-gmkBra7GdJajB_7dxb9UEPiNoKfGmZhR8V6QQdIbdXnapLZT5Wzsv_bZ8yNO4DlaBAZJIHTR3y8xrTTt_eBJRAQqp4lrWtmSsV17w_X82rxv__-PutUp9wym',
  },
  {
    name: 'Street Style Beef Tacos',
    meta: 'Signature • Hot & Savory',
    price: '9.50',
    image: 'https://lh3.googleusercontent.com/aida-public/AB6AXuDmzdrJagwb7rClTgAN_1JUVQkPRZfQIrO8LNz9XndsKnomVUWckbJwf_RY3DC9JFujxnwFjhNftSP9sLHo7jU6kGp-AE1igsAGgkdOXTQmbspbLW6I4AAqlk3lX3u1JKLqc-3CHgQXOU2pwbVVMIm0PH6gyF8icE_uO2J_HFlyleCHByh0to_tdq8B9doZ4p5NkD6JpiMjj5jNmfvE7mFO_x3e7OTN6DxYwBDuWIMqelzB3dEolgNrFKXhRLYEbiZfvqpH1TDTh9pU',
  },
  {
    name: 'Midnight Lava Melt',
    meta: 'Dessert • Melty Gooeyness',
    price: '7.25',
    image: 'https://lh3.googleusercontent.com/aida-public/AB6AXuAlPXqtPwE4uHcSlCgFz-FJmNNGjfAZ7bnWDALMI6PAsP1nuv5wJiJBR0D2FTmiHkiINhz2bRBY1hSLQULGpkNnqNe8K2u52b6j8tqTmf6FdJ2nJrrLkWp_oEd_zqg8Wi08iliEqMAyex0_Uf70Sv8xs6S5ueawXcYs1SjtotCzzbFO8WGUNk-9xn5jPmBN5lpll42zugm6UcQL-DcabSzDd2lgWaje6VnQsI5IQ35M4oDLEvSHxqYZSNlmxOE45ffJbRwIp_bZmg9j',
  },
]

/* ------------------------------------------------------------------ */
/* Hooks                                                              */
/* ------------------------------------------------------------------ */
function useStaggerObserver() {
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('animate-stagger-fade')
            observer.unobserve(entry.target)
          }
        })
      },
      { threshold: 0.1 },
    )

    document.querySelectorAll('.stagger-item').forEach((item) => {
      observer.observe(item)
    })

    return () => observer.disconnect()
  }, [])
}

/* ------------------------------------------------------------------ */
/* Page                                                               */
/* ------------------------------------------------------------------ */
export default function MenuPage() {
  const [cartCount, setCartCount] = useState(0)
  const [cartTotal, setCartTotal] = useState(0)
  const [activeCategory, setActiveCategory] = useState('All')
  const headerImgRef = useRef<HTMLImageElement | null>(null)

  useStaggerObserver()

  /* Parallax effect on header image */
  useEffect(() => {
    const onScroll = () => {
      const img = headerImgRef.current
      if (img) {
        img.style.transform = `translateY(${window.scrollY * 0.4}px)`
      }
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  function addToCart(price: number) {
    setCartCount((c) => c + 1)
    setCartTotal((t) => Math.round((t + price) * 100) / 100)
  }

  return (
    <PageShell withBottomNav className="relative overflow-x-hidden min-h-screen">
      {/* Fixed Comic Pattern Background */}
      <div
        className="fixed inset-0 pointer-events-none z-0"
        style={{
          backgroundImage: `url('${PATTERN_BG}')`,
          backgroundAttachment: 'fixed',
          backgroundSize: '400px',
          opacity: 0.05,
        }}
      />

      <main className="relative z-10">
        {/* ---- Immersive Hero Header ---- */}
        <header
          className="relative w-full h-[280px] md:h-[442px] flex flex-col items-center justify-center overflow-hidden"
          style={{
            backgroundImage: `url('${PATTERN_BG}')`,
            backgroundRepeat: 'repeat',
            backgroundSize: 'auto',
          }}
        >
          <div className="absolute inset-0 z-0">
            <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/20 to-background" />
          </div>
          <div className="relative z-10 flex flex-col items-center animate-float p-6 rounded-2xl">
            <img
              ref={headerImgRef}
              className="drop-shadow-2xl object-contain h-[140px] md:!h-[220px]"
              alt="Chaish Official Logo"
              src={LOGO}
              style={{ width: 'auto' }}
            />
          </div>
          {/* Back Button */}
          <Link
            to="/dashboard"
            aria-label="Back to dashboard"
            className="absolute top-6 left-6 size-10 rounded-full glass flex items-center justify-center text-on-surface hover:bg-surface-container transition-colors"
          >
            <span className="material-symbols-outlined" aria-hidden="true">arrow_back</span>
          </Link>
        </header>

        {/* ---- Category Nav ---- */}
        <nav className="sticky top-0 z-50 py-4 bg-background/80 backdrop-blur-md border-b border-surface-container-high px-4 overflow-x-auto no-scrollbar flex items-center gap-3">
          {categories.map((cat) => (
            <button
              key={cat.label}
              onClick={() => setActiveCategory(cat.label)}
              className={[
                'flex items-center gap-1.5 md:gap-2 px-3 md:px-6 py-2 md:py-2.5 rounded-full font-bold whitespace-nowrap transition-all duration-300 active:scale-95 text-[11px] md:text-sm',
                activeCategory === cat.label
                  ? 'bg-primary text-white shadow-lg shadow-primary/20'
                  : 'glass hover:bg-surface-container text-on-surface-variant font-semibold',
              ].join(' ')}
            >
              <span
                className="material-symbols-outlined text-sm"
                style={cat.filled ? { fontVariationSettings: "'FILL' 1" } : undefined}
                aria-hidden="true"
              >
                {cat.icon}
              </span>
              {cat.label}
            </button>
          ))}
        </nav>

        {/* ---- Signature Dishes ---- */}
        <section className="px-4 py-8">
          <div className="flex justify-between items-end mb-6">
            <div>
              <h2 className="text-on-surface font-extrabold tracking-tight uppercase border-l-4 border-primary pl-3 md:pl-4 text-xl md:text-3xl">
                Signature Dishes
              </h2>
              <p className="text-outline text-xs md:text-sm mt-0.5">Hand-picked flavors for the bold.</p>
            </div>
            <button className="text-primary font-bold flex items-center gap-1 group">
              View All
              <span className="material-symbols-outlined group-hover:translate-x-1 transition-transform text-lg" aria-hidden="true">arrow_forward</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {signatureDishes.map((dish, idx) => (
              <div
                key={dish.name}
                className="stagger-item group bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-2xl transition-all duration-500 border border-surface-container"
                style={{ animationDelay: `${(idx + 1) * 0.1}s` }}
              >
                <div className="relative h-64 overflow-hidden">
                  <img
                    className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700"
                    src={dish.image}
                    alt={dish.name}
                  />
                  <div className="absolute top-4 left-4 flex gap-2">
                    <span className={['text-label-sm px-3 py-1 rounded-full font-black uppercase tracking-wider shadow-sm', dish.badgeClass, dish.badge === 'Must Try' ? 'animate-pulse-slow' : ''].filter(Boolean).join(' ')}>
                      {dish.badge}
                    </span>
                    {dish.rating && (
                      <span className="glass px-3 py-1 rounded-full text-label-sm font-bold flex items-center gap-1">
                        <span className="material-symbols-outlined text-xs" style={{ fontVariationSettings: "'FILL' 1" }} aria-hidden="true">star</span>
                        {dish.rating}
                      </span>
                    )}
                  </div>
                </div>
                <div className="p-6">
                  <div className="flex justify-between items-start mb-2">
                    <h3 className="text-lg font-extrabold text-on-surface">{dish.name}</h3>
                    <span className="text-xl font-extrabold text-primary">${dish.price}</span>
                  </div>
                  <p className="text-outline text-sm leading-relaxed mb-6">{dish.desc}</p>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {dish.rating ? (
                        <>
                          <div className="flex -space-x-2">
                            <div className="size-8 rounded-full border-2 border-white bg-surface-container" />
                            <div className="size-8 rounded-full border-2 border-white bg-surface-container" />
                          </div>
                          <span className="text-label-sm text-outline font-medium">{dish.orders}</span>
                        </>
                      ) : (
                        <>
                          <span className="material-symbols-outlined text-sunset-orange" aria-hidden="true">{dish.ordersIcon}</span>
                          <span className="text-label-sm text-outline font-medium">{dish.orders}</span>
                        </>
                      )}
                    </div>
                    <button
                      onClick={() => addToCart(parseFloat(dish.price))}
                      className="flex items-center gap-1.5 px-5 py-2.5 bg-primary text-white rounded-full font-black text-xs uppercase tracking-wider hover:bg-primary/90 active:scale-90 transition-all shadow-sm shadow-primary/20"
                    >
                      <span className="material-symbols-outlined text-sm" aria-hidden="true">add</span>
                      Add
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ---- Explore the Vibes ---- */}
        <section className="px-4 pb-28">
          <h2 className="text-xl md:text-2xl font-extrabold text-on-surface mb-4 md:mb-6 tracking-tight">
            Explore the Vibes
          </h2>
          <div className="space-y-4">
            {menuRows.map((row, idx) => (
              <div
                key={row.name}
                className="stagger-item glass p-4 rounded-xl flex items-center gap-4 hover:bg-white/80 transition-all cursor-pointer group"
                style={{ animationDelay: `${(idx + 3) * 0.1}s` }}
              >
                <div className="size-16 rounded-xl overflow-hidden shrink-0">
                  <img
                    className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                    src={row.image}
                    alt={row.name}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="font-extrabold text-on-surface text-sm">{row.name}</h4>
                  <p className="text-label-sm text-outline mt-0.5">{row.meta}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-extrabold text-on-surface">${row.price}</span>
                  <button
                    onClick={() => addToCart(parseFloat(row.price))}
                    aria-label={`Add ${row.name} to cart`}
                    className="size-9 rounded-full bg-primary text-white flex items-center justify-center hover:bg-primary/90 active:scale-90 transition-all shadow-sm hover:shadow-md"
                  >
                    <span className="material-symbols-outlined text-sm" aria-hidden="true">add</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>

      {/* ---- Floating Cart ---- */}
      {cartCount > 0 && (
        <div className="fixed bottom-20 left-4 right-4 z-50 animate-slide-up">
          <button className="w-full bg-gradient-to-r from-rich-black to-zinc-800 text-white rounded-2xl py-3.5 px-5 shadow-2xl flex items-center justify-between hover:scale-[1.01] active:scale-[0.98] transition-all duration-200">
            <div className="flex items-center gap-3">
              <div className="size-9 rounded-full bg-white/15 flex items-center justify-center">
                <span className="material-symbols-outlined text-lg" aria-hidden="true">shopping_bag</span>
              </div>
              <div className="text-left">
                <p className="font-bold text-sm">{cartCount} item{cartCount > 1 ? 's' : ''}</p>
                <p className="text-[10px] text-white/60">View Cart</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-black text-lg">${cartTotal.toFixed(2)}</span>
              <span className="material-symbols-outlined text-lg" aria-hidden="true">chevron_right</span>
            </div>
          </button>
        </div>
      )}

      <BottomNav />
    </PageShell>
  )
}
