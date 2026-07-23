import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { PageShell } from '../components/layout/PageShell'

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */
type GalleryItem =
  | { type: 'image'; alt: string; src: string }
  | { type: 'follow' }

/* ------------------------------------------------------------------ */
/* Data                                                               */
/* ------------------------------------------------------------------ */
const LOGO = 'https://lh3.googleusercontent.com/aida-public/AB6AXuDSyn7GeumPteMfxUmERH34PO79exCuC_ocC-Nzt15PWttFFk1iJOs6lII4jZJ0ZBuTZ2VpOB0q7t03iLIEwxD6qWjzHNwkzQmgsfVSVvU9r8HiVdudy-wFlYU1ozr2UaSWnIMplCfAlyTM_X2pky6SExnuvWmBmnkcVgpQ-86SOEv9MzhnRjPgbNbJmzS9IC35FtspVdRWZCsDMwUm0uNoDSQS3OwzAGCmZYgFcn6SRCC136mtwCq27fdIvgk_ZsSw3m_8I1HB5swU'

const categories = ['Tea', 'Coffee', 'Snacks', 'Desserts', 'Combos']

const gallery: GalleryItem[] = [
  { type: 'image', alt: 'Friends sharing tea', src: 'https://lh3.googleusercontent.com/aida-public/AB6AXuCzAbLKHRLl2xYlfiS_jzhcxhQXKZIQTgtVNhrQpMJW6umAGoAEX8gUgQWEQ0I0nRWVX4XPbvZy1VaZLnuXCuKiruJPlLjdTXHxVcCd1c1hXNLSzCAro7hvJpBsIQQRkXfnNXxSAnQEpHu8bXVW7TwZrTY-g1oJRtWwkFPRdx3ickOGlPPruXLSTiJHA-MtWJy6muQoXeB_2e5vuA0wYBe0P9EcjS_xK5F8zMFdU3X8_6MMHY4dEBD4EY-fD-SywD' },
  { type: 'image', alt: 'Artisanal cookies', src: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBceCH6N4SZKTM5lmQnOPBhdhlgMGmd3GsWgNYGzq-ohgZRFZLoRbNThtsG6zh7WrqusWGqYNgFjm4zpPTQGVzHj79hPKAUZ2pmdZVBqe__Y5p5GrOsHm76jPhaVQtiGwFFtyTIHNDn_V5lvdr2hpDmkcOLKt5xNNPDiVGZkNWBkafpp9_PJtqLntfMLui6QMUCsOMQpEOYnDHHEK5FRD-PIrsxISOWvxZhJ37P70aeGzctThAdbtY_8QIpO7oiQZPJ60UE1KvWsdOU' },
  { type: 'follow' },
  { type: 'image', alt: 'Atmospheric shot of cafe', src: 'https://lh3.googleusercontent.com/aida-public/AB6AXuCFg4iH-L-J-6_rPp-v475RyXtKCynyDBUGi53NE8UB9kW_nGDEO2c7hdAr4VJg7JkeubiYBEpwyExk1SOw0l112xpla_UiLAoMKrE_kDpXcNuozIpve-uEom1efdRmn9C6zh7WrqusWGqYNgFjm4zpV2CGWBu4ZIcbIeu4XrD0J95faG4ogbUi-_m0cvOVWFrG5XaxXrNwZps2VJYd8G26NhuiLSjTZLE9nOm80mrO1uKC9qPWl0HH1KsSFiUVwLGiNzZkJVn9I56FmJoj29' },
]

/* ------------------------------------------------------------------ */
/* Hooks                                                              */
/* ------------------------------------------------------------------ */
function useStaggerOnMount() {
  useEffect(() => {
    const nodes = Array.from(document.querySelectorAll('[data-uq-item]')) as HTMLElement[]
    nodes.forEach((el, i) => {
      const delay = el.getAttribute('data-uq-delay') || `${i * 0.08}s`
      el.style.opacity = '0'
      el.style.transform = 'translateY(16px)'
      el.style.transition = 'opacity 0.5s cubic-bezier(0.22, 1, 0.36, 1), transform 0.5s cubic-bezier(0.22, 1, 0.36, 1)'
      el.style.transitionDelay = delay
      requestAnimationFrame(() => {
        el.style.opacity = '1'
        el.style.transform = 'translateY(0)'
      })
    })
  }, [])
}

function useConfettiEffect(ref: React.RefObject<HTMLDivElement | null>, trigger: boolean) {
  useEffect(() => {
    if (!trigger) return
    const card = ref.current
    if (!card) return
    const particles: HTMLDivElement[] = []
    for (let i = 0; i < 40; i++) {
      const p = document.createElement('div')
      p.style.position = 'absolute'
      p.style.width = `${6 + Math.random() * 6}px`
      p.style.height = `${6 + Math.random() * 6}px`
      p.style.background = ['#b7001a', '#feb700', '#F26522', '#e8924b', '#fff'][Math.floor(Math.random() * 5)]
      p.style.left = '50%'
      p.style.top = '50%'
      p.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px'
      p.style.pointerEvents = 'none'
      p.style.zIndex = '10'
      card.appendChild(p)
      particles.push(p)
      const angle = Math.random() * Math.PI * 2
      const dist = 40 + Math.random() * 120
      p.animate(
        [
          { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 },
          { transform: `translate(calc(-50% + ${Math.cos(angle) * dist}px), calc(-50% + ${Math.sin(angle) * dist}px)) scale(0)`, opacity: 0 },
        ],
        { duration: 1200, easing: 'ease-out', fill: 'forwards' },
      )
    }
    const cleanup = setTimeout(() => {
      particles.forEach((p) => p.remove())
    }, 1500)
    return () => { clearTimeout(cleanup); particles.forEach((p) => p.remove()) }
  }, [trigger, ref])
}

/* ------------------------------------------------------------------ */
/* Page                                                               */
/* ------------------------------------------------------------------ */
export default function UltimateQrPage() {
  const visits = 7
  const [showConfetti, setShowConfetti] = useState(false)
  const [activeCategory, setActiveCategory] = useState('Tea')
  const progressRef = useRef<HTMLDivElement | null>(null)

  useStaggerOnMount()
  useConfettiEffect(progressRef, showConfetti)

  useEffect(() => {
    const timer = window.setTimeout(() => setShowConfetti(true), 800)
    return () => window.clearTimeout(timer)
  }, [])

  return (
    <PageShell className="relative overflow-x-hidden">
      <style>{`@media (max-width: 380px) { .receipt-padding { padding: 16px !important; } .receipt-padding-lg { padding: 20px !important; } }`}</style>
      <div className="bg-pattern" />

      {/* ---- Header ---- */}
      <header className="fixed top-0 left-0 w-full z-50 bg-surface/80 backdrop-blur-xl shadow-sm flex justify-between items-center px-4 py-3 border-b border-outline-variant/30">
        <div className="flex items-center gap-3">
          <Link to="/dashboard" aria-label="Back to dashboard" className="flex size-9 items-center justify-center rounded-full bg-surface-container-low text-on-surface hover:bg-surface-container active:scale-95 transition-all">
            <span className="material-symbols-outlined text-lg">arrow_back</span>
          </Link>
          <img alt="Chaish Logo" className="h-7 w-auto object-contain" src={LOGO} />
          <span className="text-[10px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full">Receipt</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button aria-label="Share receipt" className="flex size-9 cursor-pointer items-center justify-center rounded-full bg-surface-container-low text-on-surface hover:bg-surface-container active:scale-95 transition-all">
            <span className="material-symbols-outlined text-lg" aria-hidden="true">share</span>
          </button>
          <button aria-label="Notifications" className="flex size-9 cursor-pointer items-center justify-center rounded-full bg-surface-container-low text-on-surface hover:bg-surface-container active:scale-95 duration-150 relative">
            <span className="material-symbols-outlined text-lg" aria-hidden="true">notifications</span>
            <span className="absolute top-1.5 right-1.5 size-2 bg-error rounded-full animate-pulse" />
          </button>
        </div>
      </header>

      <main className="pt-20 pb-12 px-4 max-w-screen-xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
          {/* ---- Left Column: Receipt Hero + Progress ---- */}
          <section className="md:col-span-12 lg:col-span-7 flex flex-col gap-5">

            {/* Receipt Hero */}
            <div className="bg-white rounded-t-3xl shadow-xl relative overflow-hidden warm-glow" data-uq-item>
              <div className="receipt-padding-lg p-6 pb-8 md:pb-10 border-b-2 border-dashed border-outline-variant/30">
                <div className="flex justify-between items-start mb-6">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-secondary-container text-on-secondary-container text-[9px] font-black uppercase tracking-widest shadow-sm">
                    <span className="material-symbols-outlined text-[12px]" aria-hidden="true">verified</span>
                    Order Confirmed
                  </span>
                  <div className="text-right">
                    <p className="text-[10px] font-bold text-on-surface-variant">INV #8821</p>
                    <p className="text-[10px] text-on-surface-variant">Today, 4:20 PM</p>
                  </div>
                </div>

                <div className="flex items-center gap-3 mb-6">
                  <div className="size-12 rounded-2xl bg-primary-container flex items-center justify-center shadow-sm">
                    <span className="material-symbols-outlined text-2xl text-on-primary-container" style={{ fontVariationSettings: "'FILL' 1" }} aria-hidden="true">celebration</span>
                  </div>
                  <div>
                    <h1 className="text-xl md:text-2xl font-black text-on-surface tracking-tight">Shukriya for visiting!</h1>
                    <p className="text-xs text-on-surface-variant">Your tea session just got more rewarding.</p>
                  </div>
                </div>

                <div className="flex items-center justify-between p-5 rounded-2xl bg-surface-container-low border border-outline-variant/50">
                  <div>
                    <p className="text-[9px] font-black text-on-surface-variant uppercase tracking-widest mb-0.5">Total Bill</p>
                    <div className="flex items-baseline gap-0.5">
                      <span className="text-lg font-bold text-primary">₹</span>
                      <span className="text-3xl md:text-4xl font-extrabold text-on-surface">450</span>
                    </div>
                  </div>
                  <div className="h-14 w-px bg-outline-variant/40" />
                  <div className="text-right">
                    <p className="text-[9px] font-black text-primary uppercase tracking-widest mb-0.5">Points Earned</p>
                    <div className="flex items-center gap-1 justify-end">
                      <span className="material-symbols-outlined text-primary text-sm" aria-hidden="true">stars</span>
                      <span className="text-2xl md:text-3xl font-extrabold text-primary">+45</span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="receipt-edge h-4 w-full bg-white relative -mt-1" />
            </div>

            {/* Progress Bento Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Tier Progress - Circular Gauge */}
              <div className="bg-white/90 backdrop-blur-sm rounded-2xl p-5 shadow-md border border-outline-variant/30 flex flex-col items-center justify-center text-center h-[240px]" data-uq-item data-uq-delay="0.12s">
                <div className="relative w-28 h-28 mb-3">
                  <svg className="-rotate-90 w-full h-full" viewBox="0 0 100 100">
                    <circle className="text-surface-container stroke-current" cx="50" cy="50" fill="transparent" r="40" strokeWidth="8" />
                    <circle className="text-primary stroke-current transition-all duration-1000 ease-out" cx="50" cy="50" fill="transparent" r="40" strokeDasharray="251.2" strokeDashoffset="31.4" strokeLinecap="round" strokeWidth="8" style={{ filter: 'drop-shadow(0 0 4px rgba(183, 0, 26, 0.4))' }} />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-lg font-black text-on-surface">87.5%</span>
                    <span className="text-[8px] font-bold uppercase text-on-surface-variant tracking-tight">to Gold</span>
                  </div>
                </div>
                <h3 className="text-sm font-extrabold text-on-surface">Tier Progress</h3>
                <p className="text-[10px] text-primary font-bold flex items-center justify-center gap-0.5 mt-1">
                  <span className="material-symbols-outlined text-[14px]" aria-hidden="true">info</span>
                  Only 140 pts away from a free drink!
                </p>
              </div>

              {/* Visit Progress - Coffee Cups */}
              <div
                ref={progressRef}
                className="bg-white/90 backdrop-blur-sm rounded-2xl p-5 shadow-md border border-outline-variant/30 flex flex-col justify-between h-[240px] relative overflow-hidden"
                data-uq-item data-uq-delay="0.2s"
              >
                <div>
                  <h3 className="text-sm font-extrabold text-on-surface mb-0.5">Visit Progress</h3>
                  <p className="text-[10px] font-semibold text-on-surface-variant">
                    <span className="text-primary font-black">{visits}</span> / 8 Visits to Reward
                  </p>
                </div>
                <div className="flex justify-between items-center py-4">
                  {[0, 1, 2, 3, 4, 5].map((i) => (
                    <span key={i} className="material-symbols-outlined text-primary text-2xl cup-fill" style={{ fontVariationSettings: "'FILL' 1" }} aria-hidden="true">local_cafe</span>
                  ))}
                  <span className={`material-symbols-outlined text-2xl cup-fill transition-all duration-700 ${showConfetti ? 'text-primary' : 'text-white/60'}`}
                    style={{ fontVariationSettings: showConfetti ? "'FILL' 1" : "'FILL' 0" }} aria-hidden="true">local_cafe</span>
                  <span className="material-symbols-outlined text-white/60 text-2xl" style={{ fontVariationSettings: "'FILL' 0" }} aria-hidden="true">local_cafe</span>
                </div>
                <p className="text-[10px] text-primary font-bold flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px]" aria-hidden="true">celebration</span>
                  One more visit for a special reward!
                </p>
              </div>

              {/* Next Reward Card */}
              <div className="sm:col-span-2 bg-gradient-to-br from-primary-container to-primary rounded-2xl p-5 shadow-xl flex flex-col items-center justify-center text-center text-on-primary-container h-[180px] relative overflow-hidden group shine-effect" data-uq-item data-uq-delay="0.28s">
                <span className="material-symbols-outlined text-[48px] mb-2 text-white/90 transition-transform group-hover:scale-110 duration-500" style={{ fontVariationSettings: "'FILL' 1" }} aria-hidden="true">card_giftcard</span>
                <h3 className="text-sm font-black uppercase tracking-wider">Next Reward Unlocked Soon</h3>
                <p className="text-[10px] font-bold opacity-80 mt-0.5">Tea Reward unlocked at 1000 pts</p>
              </div>
            </div>
          </section>

          {/* ---- Right Column: Recommendations ---- */}
          <aside className="md:col-span-12 lg:col-span-5 flex flex-col gap-4">
            {/* Premium Tea */}
            <div className="bg-white rounded-2xl overflow-hidden shadow-md border border-outline-variant/20 flex flex-col group" data-uq-item data-uq-delay="0.36s">
              <div className="h-48 relative overflow-hidden">
                <img alt="Premium Masala Chai" className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110" src="https://lh3.googleusercontent.com/aida-public/AB6AXuAzSnyPIvnJ_0CrT2PSeoxDim2UzN-2_ZWB_XloZYHTcBiWWJ4hEK9T97_ayvvdtlxIS3u4-77PvtYf6o3MvFWGHojjPV7_C_Ify_wPQrukwOzEzMVD9foQpIJgyxGJVW7Tw4mZZMcqs7jW0csvDUsZiHQX5KtWiX99MPxa-s_RMXb41ngelr82sSY-1jVpKe6S-3P2kdAMwnk8AMoq5u5vv_YT-ZEdlt8NJbiGyyiZH1GvKbRmb2fmoH7idpEwHt65H10-5a2-e8Dj" />
                <div className="absolute top-3 left-3">
                  <span className="px-2.5 py-1 bg-white/90 backdrop-blur-md rounded-full text-[9px] font-black text-primary shadow-sm">Daily Special</span>
                </div>
              </div>
              <div className="p-5">
                <div className="flex justify-between items-start mb-1.5">
                  <h3 className="font-extrabold text-on-surface text-sm">Premium Tea Selection</h3>
                  <span className="font-extrabold text-primary text-base">₹120</span>
                </div>
                <p className="text-xs text-on-surface-variant mb-4">Enjoy our finest hand-picked tea leaves brewed to perfection.</p>
                <button className="w-full py-2.5 bg-primary text-white rounded-xl font-black text-xs uppercase tracking-wider hover:bg-primary/90 active:scale-95 transition-all shadow-sm shadow-primary/20">
                  Order Again
                </button>
              </div>
            </div>

            {/* Unlock Perks */}
            <div className="bg-gradient-to-br from-secondary-fixed to-secondary-fixed-dim rounded-2xl p-6 flex flex-col items-center text-center shadow-lg border border-secondary/20" data-uq-item data-uq-delay="0.44s">
              <div className="size-12 rounded-full bg-white flex items-center justify-center mb-3 shadow-md">
                <span className="material-symbols-outlined text-2xl text-secondary" style={{ fontVariationSettings: "'FILL' 1" }} aria-hidden="true">star</span>
              </div>
              <h3 className="text-base font-black text-on-secondary-fixed mb-1">Unlock Exclusive Perks</h3>
              <p className="text-xs text-on-secondary-fixed-variant mb-5">See your full rewards history and special member-only offers.</p>
              <Link to="/login" className="w-full py-3 bg-rich-black text-white rounded-xl font-black text-xs uppercase tracking-wider hover:bg-zinc-800 active:scale-95 transition-all shadow-lg flex items-center justify-center gap-2">
                Login for more
                <span className="material-symbols-outlined text-sm" aria-hidden="true">arrow_forward</span>
              </Link>
            </div>
          </aside>
        </div>

        {/* ---- Explore Menu ---- */}
        <section className="mt-8 overflow-hidden" data-uq-item data-uq-delay="0.5s">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-extrabold text-on-surface tracking-tight">Explore Menu</h2>
            <Link to="/menu" className="text-primary text-xs font-bold flex items-center gap-0.5 hover:underline transition-colors">
              View All
              <span className="material-symbols-outlined text-sm" aria-hidden="true">chevron_right</span>
            </Link>
          </div>
          <div className="flex gap-2.5 overflow-x-auto pb-4 no-scrollbar">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={[
                  'flex-none px-5 py-2.5 rounded-full font-bold text-xs whitespace-nowrap transition-all duration-300 active:scale-95',
                  activeCategory === cat
                    ? 'bg-primary text-white shadow-md shadow-primary/20'
                    : 'bg-white border border-outline-variant/50 text-on-surface-variant hover:bg-surface-container',
                ].join(' ')}
              >
                {cat}
              </button>
            ))}
          </div>
        </section>

        {/* ---- Social Gallery ---- */}
        <section className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-3" data-uq-item data-uq-delay="0.58s">
          <div className="col-span-full mb-1">
            <h2 className="text-lg font-extrabold text-on-surface tracking-tight">Join Our Community</h2>
          </div>
          {gallery.map((item, i) =>
            item.type === 'follow' ? (
              <a key={i} href="https://instagram.com/chaish" target="_blank" rel="noopener noreferrer"
                className="aspect-square rounded-2xl overflow-hidden shadow-sm group bg-gradient-to-br from-primary to-primary-container flex flex-col items-center justify-center p-5 text-center text-white hover:scale-[1.02] active:scale-[0.98] transition-all duration-300"
              >
                <span className="material-symbols-outlined text-3xl mb-1.5" style={{ fontVariationSettings: "'FILL' 1" }} aria-hidden="true">favorite</span>
                <p className="font-black text-sm leading-tight">Follow us<br />@chaish</p>
              </a>
            ) : (
              <div key={i} className="aspect-square rounded-2xl overflow-hidden shadow-sm group">
                <img alt={item.alt} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" src={item.src} />
              </div>
            ),
          )}
        </section>

        {/* ---- Continue to Dashboard ---- */}
        <div className="mt-8 flex justify-center" data-uq-item data-uq-delay="0.66s">
          <Link
            to="/dashboard"
            className="inline-flex items-center gap-2 px-8 py-3.5 bg-rich-black text-white rounded-full font-black text-sm shadow-xl hover:scale-[1.02] hover:shadow-2xl active:scale-95 transition-all duration-200"
          >
            <span className="material-symbols-outlined text-lg" aria-hidden="true">home</span>
            Back to Dashboard
          </Link>
        </div>
      </main>
    </PageShell>
  )
}
