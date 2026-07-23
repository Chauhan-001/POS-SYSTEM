import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { BottomNav } from '../components/layout/BottomNav'
import { GlassCard } from '../components/ui/GlassCard'
import { PageShell } from '../components/layout/PageShell'

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */
type Reward = {
  title: string
  points: string
  desc: string
  imageUrl: string
  imageAlt: string
}

type Activity = {
  id: number
  label: string
  time: string
  icon: string
  amount?: string
  color: string
  bgClass: string
}

/* ------------------------------------------------------------------ */
/* Data                                                               */
/* ------------------------------------------------------------------ */
const LOGO = 'https://lh3.googleusercontent.com/aida-public/AB6AXuDSyn7GeumPteMfxUmERH34PO79exCuC_ocC-Nzt15PWttFFk1iJOs6lII4jZJ0ZBuTZ2VpOB0q7t03iLIEwxD6qWjzHNwkzQmgsfVSVvU9r8HiVdudy-wFlYU1ozr2UaSWnIMplCfAlyTM_X2pky6SExnuvWmBmnkcVgpQ-86SOEv9MzhnRjPgbNbJmzS9IC35FtspVdRWZCsDMwUm0uNoDSQS3OwzAGCmZYgFcn6SRCC136mtwCq27fdIvgk_ZsSw3m_8I1HB5swU'

const rewards: Reward[] = [
  {
    title: 'Artisanal Pastry',
    points: '200 pts',
    desc: 'Any fresh pastry from our morning bake collection.',
    imageUrl: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBQW6TYfcvez7dZ-Bw8yvLTqY3yMsEb1pVk1A0ruwkDOkW2uCvUr-5dLMh0i020ZR8OYk39OquXmwbApDcnQFgfqQ6jbtqsdaZRpaotncY5WEkOC3WSsOEdym0oOJjr8z5AzVljKgO1orPgZE-zLMell20p5rQq-VrpC82fmczh0FhtFPV01t1AWmCpHXnP1zAKvKQKSfbh_2vj-bQF8ceKlP-UsuxRWF7phUlaeF5yQUaixrFeQ8DT8mrDdq3X99xZS91DKY-1Qjj5',
    imageAlt: 'A macro shot of a freshly baked croissant with golden, flaky layers, dusted with powdered sugar.',
  },
  {
    title: "Founder's Tea Set",
    points: '1500 pts',
    desc: 'Exclusive limited edition loose-leaf collection and ceramic mug.',
    imageUrl: 'https://lh3.googleusercontent.com/aida-public/AB6AXuAMSmEWjXoqcOKSRiA1KfmlWRTGomNZeO_6sLq-8sJz6TPraOrya83SjCLymn2K7rWkNQUf9uvxtPOvOY8UC2wCGqwkYz9vvl6qpCqNCWNi6vmRF4wmE5llowUNLO6lqCYstqFprOm2gr8jMqmsyQRP6czQcPACodlGKXVe-Siug6484HJnzUxD4kjrOSpwsFVp2Hwvo80Ebos5IzfWlaKjzYyUV_iHvdx6QjvK1UkOt_5TeXWYR7g15J7FGDOh50F-YwNrTrK5pFbC',
    imageAlt: 'A beautiful ceramic gift box set with exotic teas and a porcelain infuser cup.',
  },
  {
    title: 'Signature Cold Brew',
    points: '350 pts',
    desc: 'Our 24-hour slow-steeped signature blend.',
    imageUrl: 'https://lh3.googleusercontent.com/aida-public/AB6AXuCa2o3C6Pn288e9qMWaA7jaYp1a3LL0uw9Z364aGq6Fq1AbEYcikkg60swd7B62e3A2ANxiHBCnObxlszBq1jZSMJRdjDPrcnWumuU3Z6LasyIfPUpjwZG8ouhoR14Pyx-xuIVLKTh824lqbN2m2cb_UDv65cqznUbE9lNP39ZVGu7aVD6mR3HYhkhuX_w8mv2Z_Oke-k6oWE7O4RBb1dYZ1VGW5qqGz3i_SpsmUc8zb4wWC8k389l87JRVVMQwige_bs9VrS-icKPx',
    imageAlt: 'A tall refreshing iced matcha latte with bright green layers and creamy white milk.',
  },
]

const recentActivity: Activity[] = [
  { id: 1, label: 'Ordered Masala Chai & Snacks', time: 'Today, 4:20 PM', icon: 'local_cafe', amount: '+45 pts', color: 'text-primary', bgClass: 'bg-primary/15' },
  { id: 2, label: 'Redeemed Free Brownie', time: 'Yesterday, 2:15 PM', icon: 'redeem', amount: '-200 pts', color: 'text-secondary', bgClass: 'bg-secondary/15' },
  { id: 3, label: 'Ordered Cold Coffee & Bun Maska', time: 'Mar 18, 11:30 AM', icon: 'coffee', amount: '+35 pts', color: 'text-primary', bgClass: 'bg-primary/15' },
  { id: 4, label: 'Earned Weekly Bonus', time: 'Mar 17, 6:00 PM', icon: 'celebration', amount: '+100 pts', color: 'text-tertiary', bgClass: 'bg-tertiary/15' },
]

const quickActions = [
  { label: 'Scan QR', icon: 'qr_code_scanner', to: '/ultimate-qr', color: 'from-primary to-primary-container' },
  { label: 'Order Now', icon: 'restaurant_menu', to: '/menu', color: 'from-secondary to-secondary-container' },
  { label: 'Rewards', icon: 'card_giftcard', to: '/rewards-wallet', color: 'from-primary-container to-secondary' },
  { label: 'How It Works', icon: 'help_outline', to: '/how-rewards', color: 'from-tertiary to-tertiary-container' },
]

/* ------------------------------------------------------------------ */
/* Hooks                                                              */
/* ------------------------------------------------------------------ */
function useProgressBarReset() {
  useEffect(() => {
    const bars = Array.from(document.querySelectorAll('.liquid-progress')) as HTMLElement[]
    if (!bars.length) return
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const el = entry.target as HTMLElement
            const w = el.getAttribute('data-width')
            if (w) el.style.width = w
          }
        })
      },
      { threshold: 0.5 },
    )
    bars.forEach((bar) => {
      const width = bar.style.width
      bar.style.width = '0%'
      bar.setAttribute('data-width', width)
      observer.observe(bar)
    })
    return () => observer.disconnect()
  }, [])
}

function useStaggerOnMount() {
  useEffect(() => {
    const nodes = Array.from(document.querySelectorAll('[data-dash-item]')) as HTMLElement[]
    nodes.forEach((el, i) => {
      const delay = el.getAttribute('data-dash-delay') || `${i * 0.08}s`
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

/* ------------------------------------------------------------------ */
/* Sub-components                                                     */
/* ------------------------------------------------------------------ */
function StatCard({ icon, value, label, accent }: { icon: string; value: string; label: string; accent: string }) {
  return (
    <div className="flex items-center gap-3 bg-white/70 backdrop-blur-sm rounded-xl px-4 py-3 shadow-sm border border-outline-variant/40 hover:shadow-md hover:bg-white/90 transition-all duration-300">
      <div className={`size-10 rounded-lg ${accent} flex items-center justify-center shadow-sm`}>
        <span className="material-symbols-outlined text-white text-xl">{icon}</span>
      </div>
      <div>
        <p className="text-lg font-black text-on-surface leading-none">{value}</p>
        <p className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">{label}</p>
      </div>
    </div>
  )
}

function QuickActionButton({ label, icon, to, color }: { label: string; icon: string; to: string; color: string }) {
  return (
    <Link
      to={to}
      className="flex flex-col items-center gap-1.5 min-w-[80px] py-3 px-4 rounded-2xl bg-white/70 backdrop-blur-sm border border-outline-variant/40 shadow-sm hover:shadow-md hover:bg-white hover:scale-[1.04] active:scale-95 transition-all duration-300 group"
    >
      <div className={`size-10 rounded-xl bg-gradient-to-br ${color} flex items-center justify-center shadow-sm group-hover:shadow-md transition-shadow`}>
        <span className="material-symbols-outlined text-white text-lg">{icon}</span>
      </div>
      <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-tight text-center leading-tight">
        {label}
      </span>
    </Link>
  )
}

function ActivityItem({ activity, isLast }: { activity: Activity; isLast: boolean }) {
  return (
    <div className="flex gap-3 items-start group">
      <div className="flex flex-col items-center shrink-0">
        <div className={`size-9 rounded-full border border-outline-variant/30 flex items-center justify-center group-hover:scale-110 transition-transform ${activity.bgClass}`}
        >
          <span className={`material-symbols-outlined text-sm ${activity.color}`}>{activity.icon}</span>
        </div>
        {!isLast && <div className="w-px flex-1 min-h-[28px] bg-outline-variant/40 mt-1" />}
      </div>
      <div className="flex-1 pb-4">
        <p className="text-sm font-bold text-on-surface leading-tight">{activity.label}</p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[11px] text-on-surface-variant">{activity.time}</span>
          {activity.amount && (
            <>
              <span className="text-[8px] text-outline">&bull;</span>
              <span className={`text-[11px] font-bold ${activity.amount.startsWith('+') ? 'text-tertiary' : 'text-error'}`}>
                {activity.amount}
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Page                                                               */
/* ------------------------------------------------------------------ */
export default function DashboardPage() {
  const [greeting, setGreeting] = useState('Hello')
  const activityScrollRef = useRef<HTMLDivElement | null>(null)

  useProgressBarReset()
  useStaggerOnMount()

  useEffect(() => {
    const h = new Date().getHours()
    if (h < 12) setGreeting('Good Morning')
    else if (h < 17) setGreeting('Good Afternoon')
    else setGreeting('Good Evening')
  }, [])

  return (
    <PageShell withBottomNav>
      <div className="relative flex min-h-screen w-full flex-col overflow-x-hidden">
        {/* Light, drifting pattern background (same as Ultimate Qr) */}
        <div className="bg-pattern" />

        {/* ---- Header ---- */}
        <header className="flex items-center bg-surface/90 backdrop-blur-xl p-4 pb-3 justify-between sticky top-0 z-50 border-b border-outline-variant/30 shadow-sm">
          <div className="flex items-center gap-3">
            <img className="h-8 w-auto object-contain" src={LOGO} alt="Chaish Logo" />
            <div className="ml-1">
              <p className="text-on-surface-variant text-[9px] font-bold uppercase tracking-[0.2em] mb-0.5">
                Welcome back
              </p>
              <h2 className="text-on-surface text-xl font-black leading-none tracking-tighter">
                {greeting}, Alex
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <Link
              to="/ultimate-qr"
              className="flex size-10 cursor-pointer items-center justify-center rounded-full bg-primary text-white shadow-md hover:bg-primary/90 hover:scale-105 active:scale-95 transition-all duration-200"
            >
              <span className="material-symbols-outlined text-lg">qr_code_scanner</span>
            </Link>
            <button className="flex size-10 cursor-pointer items-center justify-center rounded-full bg-surface-container-low text-on-surface transition-colors hover:bg-surface-container active:scale-95 duration-150 relative">
              <span className="material-symbols-outlined" aria-hidden="true">
                notifications
              </span>
              <span className="absolute top-2 right-2 size-2 bg-error rounded-full animate-pulse" />
            </button>
            <button className="flex size-10 cursor-pointer items-center justify-center rounded-full bg-surface-container-low text-on-surface transition-colors hover:bg-surface-container active:scale-95 duration-150">
              <span className="material-symbols-outlined" aria-hidden="true">
                search
              </span>
            </button>
          </div>
        </header>

        <main className="flex-1 pb-24">
          {/* ---- Quick Stats ---- */}
          <section data-dash-item className="px-4 pt-5 pb-2">
            <div className="grid grid-cols-3 gap-2">
              <StatCard icon="location_on" value="13" label="Visits This Month" accent="bg-gradient-to-br from-primary to-primary-container" />
              <StatCard icon="stars" value="+450" label="Points Earned" accent="bg-gradient-to-br from-secondary to-secondary-container" />
              <StatCard icon="local_fire_department" value="5" label="Day Streak" accent="bg-gradient-to-br from-error to-sunset-orange" />
            </div>
          </section>

          {/* ---- Quick Actions ---- */}
          <section data-dash-item data-dash-delay="0.16s" className="px-4 py-3">
            <div className="flex gap-3 overflow-x-auto pb-1 no-scrollbar">
              {quickActions.map((action) => (
                <QuickActionButton key={action.label} {...action} />
              ))}
            </div>
          </section>

          {/* ---- Visit Progress ---- */}
          <section className="relative px-4 pt-4 pb-4 overflow-hidden" data-dash-item data-dash-delay="0.24s">
            <div className="relative z-10">
                <div className="flex justify-between items-end mb-3 bg-white/90 backdrop-blur-sm p-3 rounded-xl gap-2">
                <div className="min-w-0">
                  <h2 className="text-on-surface text-lg md:text-xl font-extrabold tracking-tight">
                    Visit Progress
                  </h2>
                  <p className="text-on-surface-variant text-[10px] md:text-xs font-semibold">
                    You&apos;re killing it this month!
                  </p>
                </div>
                <div className="bg-primary text-on-primary px-2.5 md:px-3 py-1 md:py-1.5 rounded-full text-[10px] md:text-xs font-black shadow-lg shrink-0">
                  13/20
                </div>
              </div>

              <GlassCard className="rounded-2xl p-4 md:p-6 shadow-xl relative overflow-hidden warm-glow">
                <div className="flex justify-between items-center mb-5">
                  <div className="flex gap-1.5">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <div
                        key={i}
                        className={`size-2.5 rounded-full transition-all duration-500 ${
                          i < 3
                            ? 'bg-primary shadow-[0_0_8px_rgba(183,0,26,0.4)]'
                            : i === 3
                              ? 'bg-primary-fixed animate-pulse'
                              : 'bg-outline-variant'
                        }`}
                      />
                    ))}
                  </div>
                  <span className="text-primary font-bold text-[11px] uppercase tracking-wider">
                    7 to go!
                  </span>
                </div>

                <div className="relative h-5 w-full bg-surface-container rounded-full overflow-hidden mb-5 border border-outline-variant/50">
                  <div
                    className="liquid-progress h-full transition-all duration-1000 ease-out rounded-full"
                    style={{
                      width: '65%',
                      background: 'linear-gradient(90deg, #b23a0e, #e8924b, #e0a43b)',
                    }}
                    data-width="65%"
                  >
                    <div className="absolute right-2 top-1/2 -translate-y-1/2 size-2 bg-white rounded-full animate-pulse" />
                  </div>
                </div>

                <div className="flex items-center gap-4 animate-float">
                  <div className="size-14 rounded-xl bg-secondary-container flex items-center justify-center shadow-lg relative shrink-0">
                    <span
                      className="material-symbols-outlined text-on-secondary-container text-2xl"
                      style={{ fontVariationSettings: "'FILL' 1" }}
                      aria-hidden="true"
                    >
                      bakery_dining
                    </span>
                    <div className="sparkle-dot top-0 right-0" />
                    <div className="sparkle-dot bottom-1 left-1" style={{ animationDelay: '0.5s' }} />
                  </div>
                  <div>
                    <p className="text-on-surface font-bold text-sm">Next milestone: Free Pastry</p>
                    <p className="text-on-surface-variant text-xs">Achieve this in 7 more visits</p>
                  </div>
                </div>
              </GlassCard>
            </div>
          </section>

          {/* ---- Recent Activity ---- */}
          <section className="px-4 py-4" data-dash-item data-dash-delay="0.32s">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-title-md text-on-surface font-extrabold">Recent Activity</h2>
              <button
                className="text-primary text-xs font-bold hover:underline transition-colors"
                onClick={() => activityScrollRef.current?.scrollIntoView({ behavior: 'smooth' })}
              >
                View All
              </button>
            </div>

            <div ref={activityScrollRef} className="bg-white/70 backdrop-blur-sm rounded-2xl p-5 shadow-sm border border-outline-variant/30">
              {recentActivity.map((activity, index) => (
                <ActivityItem key={activity.id} activity={activity} isLast={index === recentActivity.length - 1} />
              ))}
            </div>
          </section>

          {/* ---- Reward Progress ---- */}
          <section className="relative px-4 py-4" data-dash-item data-dash-delay="0.4s">
            <div className="bg-surface-container-low/80 backdrop-blur-sm -mx-4 px-4 py-6">
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-title-md text-on-surface font-extrabold">Reward Progress</h2>
                <Link to="/rewards-wallet" className="text-primary text-xs font-bold hover:underline transition-colors">
                  View History
                </Link>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="glass-card rounded-2xl p-5 flex items-center gap-5 shadow-md border-l-4 border-l-secondary hover:shadow-lg transition-shadow duration-300">
                  <div className="relative size-20 shrink-0">
                    <svg className="size-full -rotate-90" viewBox="0 0 100 100">
                      <circle className="text-surface-container stroke-current" cx="50" cy="50" fill="transparent" r="40" strokeWidth="8" />
                      <circle className="text-secondary stroke-current transition-all duration-1000" cx="50" cy="50" fill="transparent" r="40" strokeDasharray="251.2" strokeDashoffset="62.8" strokeLinecap="round" strokeWidth="8" />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-xl font-black text-on-surface leading-none">75%</span>
                      <span className="text-[9px] font-bold text-on-surface-variant uppercase">Points</span>
                    </div>
                  </div>

                  <div className="flex-1 min-w-0">
                    <h3 className="font-extrabold text-on-surface text-base leading-tight mb-1">Premium Upgrade</h3>
                    <p className="text-on-surface-variant text-xs mb-3">So close to Gold Member status!</p>
                    <div className="h-1.5 w-full bg-surface-container rounded-full overflow-hidden">
                      <div className="h-full bg-secondary w-3/4 rounded-full" />
                    </div>
                  </div>
                </div>

                <div className="bg-gradient-to-br from-rich-black to-zinc-800 text-primary-fixed rounded-2xl p-5 relative overflow-hidden shadow-xl group cursor-pointer active:scale-[0.97] transition-all duration-200">
                  <div className="absolute -right-4 -bottom-4 opacity-8">
                    <span className="material-symbols-outlined text-[100px]" aria-hidden="true">loyalty</span>
                  </div>

                  <div className="relative z-10">
                    <div className="flex justify-between items-start mb-3">
                      <div className="bg-primary text-white text-[9px] font-black px-2 py-0.5 rounded-full uppercase tracking-widest animate-pulse shadow-lg">
                        Hot Deal
                      </div>
                      <span className="material-symbols-outlined text-primary-fixed/60 text-lg" aria-hidden="true">info</span>
                    </div>

                    <h3 className="text-lg font-black text-white leading-tight mb-1">Claim Your Bonus</h3>
                    <p className="text-primary-fixed-dim/80 text-xs">Use 500 points for a limited edition Chaish tumbler.</p>

                    <button className="mt-3 w-full py-2.5 bg-primary text-white rounded-xl font-black text-xs uppercase tracking-wider hover:bg-red-700 transition-all shadow-lg active:scale-95">
                      Redeem Now
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* ---- Available Rewards ---- */}
          <section className="px-4 py-6" data-dash-item data-dash-delay="0.48s">
            <div className="flex items-center justify-between mb-4 md:mb-5">
              <h2 className="text-title-md text-on-surface font-extrabold">Available Rewards</h2>
              <Link to="/rewards-wallet" className="text-primary text-[10px] md:text-xs font-bold hover:underline transition-colors">
                View All
              </Link>
            </div>

            <div className="flex flex-col gap-3.5">
              {rewards.map((r, idx) => {
                const isLimited = idx === 1
                return (
                  <div
                    key={r.title}
                    className={[
                      'group relative flex gap-4 p-4 rounded-2xl bg-white shadow-sm border',
                      isLimited
                        ? 'border-2 border-primary animate-pulse-glow'
                        : 'border-outline-variant hover:shadow-xl',
                      'hover:scale-[1.01] active:scale-[0.99] transition-all duration-300 cursor-pointer',
                    ].join(' ')}
                  >
                    {isLimited && (
                      <div className="absolute -top-2.5 -right-2.5 bg-primary text-white text-[9px] font-black px-2.5 py-1 rounded-full uppercase tracking-widest shadow-lg z-10">
                        Limited Time
                      </div>
                    )}

                    <div className="size-16 shrink-0 rounded-xl overflow-hidden shadow-sm">
                      <div
                        className="w-full h-full bg-cover bg-center group-hover:scale-110 transition-transform duration-500"
                        style={{ backgroundImage: `url('${r.imageUrl}')` }}
                      />
                    </div>

                    <div className="flex-1 flex flex-col justify-center">
                      <div className="flex justify-between items-start">
                        <h4 className="font-bold text-on-surface text-sm">{r.title}</h4>
                        <span className="text-primary font-black text-xs">{r.points}</span>
                      </div>
                      <p className="text-on-surface-variant text-xs line-clamp-2 mt-0.5">{r.desc}</p>
                      <button className="mt-2 self-start text-[10px] font-black uppercase tracking-wider text-primary hover:text-primary-container transition-colors flex items-center gap-0.5 group/redeem">
                        Redeem
                        <span className="material-symbols-outlined text-[12px] group-hover/redeem:translate-x-0.5 transition-transform">arrow_forward</span>
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        </main>

        <BottomNav />
      </div>
    </PageShell>
  )
}
