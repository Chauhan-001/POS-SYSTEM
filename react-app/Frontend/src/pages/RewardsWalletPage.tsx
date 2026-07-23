import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { PageShell } from '../components/layout/PageShell'
import { BottomNav } from '../components/layout/BottomNav'
import ShaderBackgroundWebGL from '../components/background/ShaderBackgroundWebGL'

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */
type Reward = {
  name: string
  desc: string
  image: string
  expiresIn?: string
  points?: string
}

type Activity = {
  id: number
  label: string
  time: string
  icon: string
  amount: string
  color: string
  bgClass: string
}

type QuickAction = {
  icon: string
  label: string
  to: string
  iconClass: string
}

/* ------------------------------------------------------------------ */
/* Data                                                               */
/* ------------------------------------------------------------------ */
const LOGO = 'https://lh3.googleusercontent.com/aida-public/AB6AXuDSyn7GeumPteMfxUmERH34PO79exCuC_ocC-Nzt15PWttFFk1iJOs6lII4jZJ0ZBuTZ2VpOB0q7t03iLIEwxD6qWjzHNwkzQmgsfVSVvU9r8HiVdudy-wFlYU1ozr2UaSWnIMplCfAlyTM_X2pky6SExnuvWmBmnkcVgpQ-86SOEv9MzhnRjPgbNbJmzS9IC35FtspVdRWZCsDMwUm0uNoDSQS3OwzAGCmZYgFcn6SRCC136mtwCq27fdIvgk_ZsSw3m_8I1HB5swU'

const rewards: Reward[] = [
  {
    name: 'Free Brownie',
    desc: 'Signature Warm Fudgy Brownie',
    expiresIn: 'Expires in 14 days',
    points: '200 pts',
    image: 'https://lh3.googleusercontent.com/aida-public/AB6AXuA_BZTJSkGSkn-q_jvQRRhBmOxgMBcC5n-srXEo5wxPl0xSqg2WAdkAaKP4fI96FRsaiqg_vhc_W71GigQy1mZLPWKib0imVqW9MlH7O4vf5qrgAy5eMcoaetogmvzfZNdNHlIb4O3l0GOq8SSckZuhxwKga9lhXw7CnhS-H1b301J0bgncfuCLTyIktm7czp31a4jfhjJ9bAC_O6y0EYhEikd0E4FcraL-YQ5eZNiyhAuWZKgDBhTsDOZUP5p0UP-Uuc0AoktvHwwd',
  },
  {
    name: 'Any Hot Beverage',
    desc: 'Valid for Chai, Coffee, or Hot Cocoa',
    expiresIn: 'Expires in 30 days',
    points: '350 pts',
    image: 'https://lh3.googleusercontent.com/aida-public/AB6AXuA8wkX0Poo3BtdySMwM--qJEygP9HlwvkGJHpsRv6cACVepoeyt9GoD42pff8XZcWvEoTdEk5Gxj-h9GSdFK_XutUcaWIznBz--PhGrgHR5dIi-oVSeEIzXUthdDuDF2dD60rm-bmEAW0WQdbrgiH2SPeoQHoCRmcq-9kEE8k_ofH8bM1E1QvPsOPuYjE_W7AT5mEMYAB_c_1QY-w18T7iI_SvTDf6yPXmJQOliJEgkVwCV0b2TtJgY9ZoTHNPhiH8PfkzAC4dJW4MC',
  },
]

const recentActivity: Activity[] = [
  { id: 1, label: 'Earned points from Masala Chai', time: 'Today, 4:20 PM', icon: 'local_cafe', amount: '+45 pts', color: 'text-primary', bgClass: 'bg-primary/15' },
  { id: 2, label: 'Redeemed Free Brownie', time: 'Yesterday, 2:15 PM', icon: 'redeem', amount: '-200 pts', color: 'text-secondary', bgClass: 'bg-secondary/15' },
  { id: 3, label: 'Weekly Bonus deposited', time: 'Mar 17, 6:00 PM', icon: 'celebration', amount: '+100 pts', color: 'text-tertiary', bgClass: 'bg-tertiary/15' },
  { id: 4, label: 'Birthday Reward credited', time: 'Mar 12, 9:00 AM', icon: 'cake', amount: '+250 pts', color: 'text-primary', bgClass: 'bg-primary/15' },
]

const quickActions: QuickAction[] = [
  { icon: 'redeem', label: 'Gift a Chai', to: '#', iconClass: 'text-secondary' },
  { icon: 'history', label: 'Redemption History', to: '/redemption-history', iconClass: 'text-tertiary' },
  { icon: 'location_on', label: 'Our Location', to: 'https://maps.google.com', iconClass: 'text-primary' },
  { icon: 'help_outline', label: 'How It Works', to: '/how-rewards', iconClass: 'text-secondary' },
]

/* ------------------------------------------------------------------ */
/* Hooks                                                              */
/* ------------------------------------------------------------------ */
function useStaggerOnMount() {
  useEffect(() => {
    const nodes = Array.from(document.querySelectorAll('[data-rw-item]')) as HTMLElement[]
    nodes.forEach((el, i) => {
      const delay = el.getAttribute('data-rw-delay') || `${i * 0.08}s`
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
function ActivityItem({ activity, isLast }: { activity: Activity; isLast: boolean }) {
  return (
    <div className="flex gap-3 items-start group">
      <div className="flex flex-col items-center shrink-0">
        <div className={`size-9 rounded-full border border-outline-variant/30 flex items-center justify-center group-hover:scale-110 transition-transform ${activity.bgClass}`}>
          <span className={`material-symbols-outlined text-sm ${activity.color}`}>{activity.icon}</span>
        </div>
        {!isLast && <div className="w-px flex-1 min-h-[28px] bg-outline-variant/40 mt-1" />}
      </div>
      <div className="flex-1 pb-4">
        <p className="text-sm font-bold text-on-surface leading-tight">{activity.label}</p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[11px] text-on-surface-variant">{activity.time}</span>
          <span className="text-[8px] text-outline">&bull;</span>
          <span className={`text-[11px] font-bold ${activity.amount.startsWith('+') ? 'text-tertiary' : 'text-error'}`}>
            {activity.amount}
          </span>
        </div>
      </div>
    </div>
  )
}

function VisitJourney() {
  const TOTAL = 12
  const current = 8
  const rewardName = 'Premium Pastry'
  const progress = Math.round((current / TOTAL) * 100)
  const remaining = TOTAL - current

  const nodes = Array.from({ length: TOTAL }, (_, i) => i + 1)

  return (
    <div className="glass-card rounded-2xl p-5 relative overflow-hidden bg-white/80">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-extrabold text-on-surface uppercase tracking-wider">
            Visit Journey
          </h3>
          <p className="text-xs text-on-surface-variant mt-0.5">
            Unlock <span className="font-bold text-primary">{rewardName}</span> at{' '}
            {TOTAL} visits
          </p>
        </div>
        <span className="text-[10px] font-black text-primary bg-primary/10 px-2.5 py-1 rounded-full">
          {current} / {TOTAL}
        </span>
      </div>

      {/* Horizontal level track (Subway-Surfers style) */}
      <div className="overflow-x-auto no-scrollbar pb-2 -mx-1 px-1">
        <div className="relative flex items-center gap-3 min-w-max py-3 px-1">
          {/* Progress rail */}
          <div className="absolute left-5 right-5 top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-surface-container" />
          <div
            className="absolute left-5 top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-gradient-to-r from-primary to-sunset-orange transition-all duration-1000"
            style={{ width: `calc(${progress}% - 20px)` }}
          />

          {nodes.map((visit) => {
            const done = visit <= current
            const isMilestone = visit === TOTAL
            return (
              <div key={visit} className="relative z-10 flex flex-col items-center shrink-0">
                <div
                  className={[
                    'size-10 rounded-full flex items-center justify-center border-2 transition-all duration-300',
                    done
                      ? 'bg-gradient-to-br from-primary to-sunset-orange border-transparent text-white shadow-md shadow-primary/20'
                      : isMilestone
                        ? 'bg-surface-container-highest border-secondary-container text-secondary animate-pulse-slow'
                        : 'bg-white border-outline-variant text-outline',
                  ].join(' ')}
                >
                  <span
                    className="material-symbols-outlined text-[18px]"
                    style={{ fontVariationSettings: done || isMilestone ? "'FILL' 1" : "'FILL' 0" }}
                  >
                    {isMilestone ? 'card_giftcard' : 'local_cafe'}
                  </span>
                </div>
                <span
                  className={[
                    'text-[9px] font-bold mt-1.5',
                    done ? 'text-on-surface' : isMilestone ? 'text-secondary' : 'text-on-surface-variant/50',
                  ].join(' ')}
                >
                  {visit}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Summary */}
      <div className="mt-2 space-y-2">
        <div className="h-2.5 w-full bg-surface-container rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-primary to-sunset-orange rounded-full transition-all duration-1000"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex justify-between items-center text-xs">
          <span className="font-bold text-primary">
            {current} visits completed
          </span>
          <span className="text-on-surface-variant">
            {remaining} more to unlock
          </span>
        </div>
      </div>
    </div>
  )
}

function TierProgress() {
  const tiers = [
    { label: 'Silver', icon: 'emoji_events', color: 'text-zinc-400', current: true, done: true },
    { label: 'Gold', icon: 'star', color: 'text-secondary', current: true, done: false },
    { label: 'Platinum', icon: 'diamond', color: 'text-tertiary', current: false, done: false },
  ]

  return (
    <div className="glass-card rounded-2xl p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-extrabold text-on-surface uppercase tracking-wider">Loyalty Tier</h3>
        <span className="text-[10px] font-black text-primary bg-primary/10 px-2 py-0.5 rounded-full">Gold Member</span>
      </div>

      <div className="flex items-center justify-between mb-4">
        {tiers.map((tier, i) => (
          <div key={tier.label} className="flex flex-col items-center gap-1.5">
            <div className={`size-10 rounded-full flex items-center justify-center ${
              tier.done ? 'bg-gradient-to-br from-secondary to-secondary-container' : 'bg-surface-container'
            } shadow-sm transition-all duration-300`}>
              <span className={`material-symbols-outlined text-lg ${
                tier.done ? 'text-white' : tier.color
              }`} style={{ fontVariationSettings: tier.done ? "'FILL' 1" : "'FILL' 0" }} aria-hidden="true">
                {tier.icon}
              </span>
            </div>
            <span className={`text-[9px] font-bold uppercase tracking-wider ${tier.current ? 'text-on-surface' : 'text-on-surface-variant/50'}`}>
              {tier.label}
            </span>
            {i < tiers.length - 1 && (
              <div className={`h-0.5 w-8 -mt-7 ml-12 rounded-full ${tier.done ? 'bg-secondary' : 'bg-outline-variant'}`} />
            )}
          </div>
        ))}
      </div>

      <div className="h-2 w-full bg-surface-container rounded-full overflow-hidden">
        <div className="h-full bg-gradient-to-r from-secondary to-secondary-container rounded-full transition-all duration-1000" style={{ width: '43%' }} />
      </div>
      <div className="flex justify-between mt-1.5">
        <span className="text-[10px] font-bold text-on-surface-variant">860 / 2,000 pts</span>
        <span className="text-[10px] font-bold text-primary">1,140 to Platinum</span>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Page                                                               */
/* ------------------------------------------------------------------ */
export default function RewardsWalletPage() {
  useStaggerOnMount()

  return (
    <PageShell withBottomNav className="relative min-h-screen pb-32">
      <ShaderBackgroundWebGL
        opacity={0.05}
        backgroundImageUrl="https://lh3.googleusercontent.com/aida/AP1WRLu3xo7CGjU2hgbJfa-7JFhr6GMFVhu7sP2sn3DYEh0Wh6V20aC3IoinDuKnEYsJzlx-U3lgu_yb-N_C1zissxabsa7Zriul4O7tqqJUttuvukp8iTVZGCI6eblwhYkD4HLLWMehZKQMgKWbE1oyCBVCAuekJvir5kUZukZeYLnxu6iQ5TCxTKwrpUkfL6ob2b6Bu4_e0lNpfT0HkoV4DWiOkHVIlnCLiGAMfSknPQkM7rH2rm9gXKLjTBe-"
      />

      {/* ---- Header ---- */}
      <header className="sticky top-0 z-50 bg-surface/80 backdrop-blur-xl border-b border-outline-variant/30 flex justify-between items-center w-full px-container-margin py-3 shadow-sm">
        <div className="flex items-center gap-3">
          <img alt="Chaish Logo" className="h-8 w-auto object-contain" src={LOGO} />
          <div className="ml-1">
            <p className="text-on-surface-variant text-[9px] font-bold uppercase tracking-[0.2em] mb-0.5">
              Your Wallet
            </p>
            <h2 className="text-on-surface text-lg font-black leading-none tracking-tighter">
              Rewards Wallet
            </h2>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Link
            to="/ultimate-qr"
            className="flex size-9 cursor-pointer items-center justify-center rounded-full bg-primary text-white shadow-md hover:bg-primary/90 hover:scale-105 active:scale-95 transition-all duration-200"
          >
            <span className="material-symbols-outlined text-lg">qr_code_scanner</span>
          </Link>
          <button aria-label="Notifications" className="flex size-9 cursor-pointer items-center justify-center rounded-full bg-surface-container-low text-on-surface transition-colors hover:bg-surface-container active:scale-95 duration-150 relative">
            <span className="material-symbols-outlined" aria-hidden="true">notifications</span>
            <span className="absolute top-1.5 right-1.5 size-2 bg-error rounded-full animate-pulse" />
          </button>
        </div>
      </header>

      <main className="px-container-margin relative">
        {/* ---- Points Hero ---- */}
        <section data-rw-item className="mt-5 mb-5">
          <div className="glass-card rounded-2xl p-6 relative overflow-hidden bg-gradient-to-br from-primary-container to-primary text-on-primary-container shadow-lg">
            <div className="relative z-10">
              <div className="flex items-center gap-1.5 mb-2">
                <span className="material-symbols-outlined text-sm opacity-80" style={{ fontVariationSettings: "'FILL' 1" }}>temp_preferences_custom</span>
                <span className="text-[10px] font-bold uppercase tracking-widest opacity-80">Total Balance</span>
              </div>
              <div className="flex items-end gap-2">
                <span className="text-4xl md:text-5xl font-black leading-none">860</span>
                <span className="text-title-md font-bold pb-1 opacity-80">Points</span>
              </div>
              <div className="grid grid-cols-3 gap-2 mt-4 pt-4 border-t border-white/20">
                <div>
                  <p className="text-[8px] md:text-[9px] font-bold uppercase tracking-wider opacity-70">Earned This Month</p>
                  <p className="text-xs md:text-sm font-black">+320</p>
                </div>
                <div>
                  <p className="text-[8px] md:text-[9px] font-bold uppercase tracking-wider opacity-70">Active Rewards</p>
                  <p className="text-xs md:text-sm font-black">3</p>
                </div>
                <div>
                  <p className="text-[8px] md:text-[9px] font-bold uppercase tracking-wider opacity-70">Lifetime Visits</p>
                  <p className="text-xs md:text-sm font-black">47</p>
                </div>
              </div>
            </div>
            <div className="absolute right-[-10px] top-[-10px] w-32 h-32 opacity-10 rotate-12">
              <span className="material-symbols-outlined text-[120px]" style={{ fontVariationSettings: "'FILL' 1" }}>temp_preferences_custom</span>
            </div>
          </div>
        </section>

        {/* ---- Tier Progress ---- */}
        <section data-rw-item data-rw-delay="0.12s" className="mb-5">
          <TierProgress />
        </section>

        {/* ---- Active Rewards ---- */}
        <section className="mb-5" data-rw-item data-rw-delay="0.2s">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-title-md font-extrabold text-on-surface">Active Rewards</h2>
            <span className="text-[10px] font-black text-primary uppercase tracking-wider bg-primary/10 px-2.5 py-1 rounded-full">
              2 Available
            </span>
          </div>

          <div className="flex flex-col gap-3">
            {rewards.map((reward) => (
              <div
                key={reward.name}
                className="bg-white/80 backdrop-blur-sm rounded-2xl p-4 flex gap-4 hover:shadow-lg hover:scale-[1.01] active:scale-[0.99] transition-all duration-300 border border-outline-variant/30 group cursor-pointer"
              >
                <div className="w-20 h-20 rounded-xl overflow-hidden shrink-0 shadow-sm">
                  <img
                    className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                    src={reward.image}
                    alt={reward.desc}
                  />
                </div>
                <div className="flex flex-col justify-between flex-grow min-w-0">
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-bold text-on-surface text-sm">{reward.name}</h3>
                      {reward.points && (
                        <span className="text-[10px] font-black text-primary shrink-0">{reward.points}</span>
                      )}
                    </div>
                    <p className="text-xs text-on-surface-variant mt-0.5">{reward.desc}</p>
                    {reward.expiresIn && (
                      <p className="text-[10px] text-error font-semibold mt-0.5 flex items-center gap-0.5">
                        <span className="material-symbols-outlined text-[12px]">schedule</span>
                        {reward.expiresIn}
                      </p>
                    )}
                  </div>
                  <button className="mt-2 w-full py-2 bg-primary text-white rounded-xl font-bold text-xs hover:bg-primary/90 transition-all active:scale-95 shadow-sm shadow-primary/20">
                    Redeem Now
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ---- Recent Activity ---- */}
        <section className="mb-5" data-rw-item data-rw-delay="0.28s">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-title-md font-extrabold text-on-surface">Recent Activity</h2>
            <button aria-label="View all recent activity" className="text-[10px] font-bold text-primary hover:underline transition-colors">
              View All
            </button>
          </div>

          <div className="bg-white/70 backdrop-blur-sm rounded-2xl p-5 shadow-sm border border-outline-variant/30">
            {recentActivity.map((activity, index) => (
              <ActivityItem key={activity.id} activity={activity} isLast={index === recentActivity.length - 1} />
            ))}
          </div>
        </section>

        {/* ---- Up Next ---- */}
        <section className="mb-5" data-rw-item data-rw-delay="0.36s">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-title-md font-extrabold text-on-surface">Up Next</h2>
          </div>
          <VisitJourney />
        </section>

        {/* ---- Quick Actions ---- */}
        <section className="mb-8 grid grid-cols-2 sm:grid-cols-4 gap-3" data-rw-item data-rw-delay="0.44s">
          {quickActions.map((item) => (
            <Link
              key={item.label}
              to={item.to}
              className="glass-card p-5 rounded-2xl flex flex-col items-center justify-center text-center gap-2 hover:bg-white hover:shadow-md transition-all cursor-pointer active:scale-95 duration-150 group"
            >
              <span className={`material-symbols-outlined text-[28px] ${item.iconClass} group-hover:scale-110 transition-transform`}>
                {item.icon}
              </span>
              <span className="text-[10px] font-bold uppercase tracking-tight text-on-surface-variant">
                {item.label}
              </span>
            </Link>
          ))}
        </section>
      </main>

      <BottomNav />
    </PageShell>
  )
}
