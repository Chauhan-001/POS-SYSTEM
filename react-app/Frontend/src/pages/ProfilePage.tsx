import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { PageShell } from '../components/layout/PageShell'
import { BottomNav } from '../components/layout/BottomNav'
import ShaderBackgroundWebGL from '../components/background/ShaderBackgroundWebGL'

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */
type InfoLink = {
  icon: string
  label: string
  to: string
}

type Badge = {
  label: string
  icon: string
  earned: boolean
}

/* ------------------------------------------------------------------ */
/* Data                                                               */
/* ------------------------------------------------------------------ */
const LOGO = 'https://lh3.googleusercontent.com/aida-public/AB6AXuDSyn7GeumPteMfxUmERH34PO79exCuC_ocC-Nzt15PWttFFk1iJOs6lII4jZJ0ZBuTZ2VpOB0q7t03iLIEwxD6qWjzHNwkzQmgsfVSVvU9r8HiVdudy-wFlYU1ozr2UaSWnIMplCfAlyTM_X2pky6SExnuvWmBmnkcVgpQ-86SOEv9MzhnRjPgbNbJmzS9IC35FtspVdRWZCsDMwUm0uNoDSQS3OwzAGCmZYgFcn6SRCC136mtwCq27fdIvgk_ZsSw3m_8I1HB5swU'
const AVATAR = 'https://lh3.googleusercontent.com/aida-public/AB6AXuArX7yYYiSdv81Yup4hkAOsSB8LZ4_M3a6OIiZtvSKF971BhGXQd1EK3iGmR7YIUyNWyNSr6X4Mij7gDgR2q1hlSAg7y3q8ocNn9PXiSKYBxTX7QIDFvvdNrRdEVwLGvviB7L7iYRlocDMZY049L-0GUszw3kVSAwLIRWvhF_skSLREMlziS6fLcSyHDbB42wedqkFeUpPHKQl3ORX6mHx_v3pnF7lcK9ijvH2I_JlCabkUxqf8RCU_18InLVbQFe8ka6jGCMcjoL4G'

const infoLinks: InfoLink[] = [
  { icon: 'gavel', label: 'Terms of Service', to: '#' },
  { icon: 'shield_person', label: 'Privacy Policy', to: '#' },
  { icon: 'help_center', label: 'Help & Support', to: '#' },
]

const badges: Badge[] = [
  { label: 'Loyal Patron', icon: 'emoji_events', earned: true },
  { label: 'Chai Legend', icon: 'local_cafe', earned: true },
  { label: 'Sweet Tooth', icon: 'cake', earned: true },
  { label: 'Early Bird', icon: 'wb_sunny', earned: false },
  { label: 'VIP Status', icon: 'diamond', earned: false },
  { label: 'Foodie', icon: 'restaurant', earned: true },
]

/* ------------------------------------------------------------------ */
/* Hooks                                                              */
/* ------------------------------------------------------------------ */
function useStaggerOnMount() {
  useEffect(() => {
    const nodes = Array.from(document.querySelectorAll('[data-pf-item]')) as HTMLElement[]
    nodes.forEach((el, i) => {
      const delay = el.getAttribute('data-pf-delay') || `${i * 0.08}s`
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
function StatPill({ icon, value, label }: { icon: string; value: string; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1 p-2.5 md:p-3 rounded-xl bg-white/60 backdrop-blur-sm border border-outline-variant/30 hover:bg-white/90 hover:shadow-sm transition-all duration-300">
      <span className="material-symbols-outlined text-primary text-lg md:text-xl" aria-hidden="true">{icon}</span>
      <p className="text-xs md:text-sm font-black text-on-surface leading-none">{value}</p>
      <p className="text-[8px] md:text-[9px] font-bold text-on-surface-variant uppercase tracking-wider text-center">{label}</p>
    </div>
  )
}

function BadgeItem({ badge }: { badge: Badge }) {
  return (
    <div className={`flex flex-col items-center gap-1.5 p-3 rounded-xl transition-all duration-300 ${
      badge.earned
        ? 'bg-white/70 border border-outline-variant/30 hover:bg-white hover:shadow-sm hover:scale-105'
        : 'bg-surface-container/50 opacity-50'
    }`}>
      <div className={`size-9 rounded-full flex items-center justify-center ${
        badge.earned ? 'bg-gradient-to-br from-secondary to-secondary-container' : 'bg-surface-container-high'
      } shadow-sm`}>
        <span className={`material-symbols-outlined text-base ${badge.earned ? 'text-white' : 'text-on-surface-variant/50'}`}
          style={{ fontVariationSettings: badge.earned ? "'FILL' 1" : "'FILL' 0" }} aria-hidden="true">
          {badge.icon}
        </span>
      </div>
      <span className={`text-[9px] font-bold uppercase tracking-tight text-center ${badge.earned ? 'text-on-surface' : 'text-on-surface-variant/50'}`}>
        {badge.label}
      </span>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Page                                                               */
/* ------------------------------------------------------------------ */
export default function ProfilePage() {
  useStaggerOnMount()

  return (
    <PageShell withBottomNav className="relative min-h-screen pb-32">
      <ShaderBackgroundWebGL opacity={0.3} />

      {/* ---- Header ---- */}
      <header className="sticky top-0 z-[60] bg-surface/80 backdrop-blur-xl shadow-sm flex justify-between items-center w-full px-container-margin py-3 border-b border-outline-variant/30">
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-full bg-primary-fixed overflow-hidden border-2 border-primary shadow-sm shrink-0">
            <img className="w-full h-full object-cover" alt="Profile avatar" src={AVATAR} />
          </div>
          <img alt="Chaish Logo" className="h-8 w-auto object-contain" src={LOGO} />
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

      <main className="max-w-[1200px] mx-auto px-container-margin pt-6 relative">
        {/* ---- Profile Avatar & Name ---- */}
        <section data-pf-item className="text-center mb-6">
          <div className="relative inline-block mb-4">
            <div className="size-20 md:size-24 rounded-full overflow-hidden ring-4 ring-primary/20 shadow-xl mx-auto">
              <img className="w-full h-full object-cover" alt="Alex Johnson" src={AVATAR} />
            </div>
            <button aria-label="Edit profile photo" className="absolute bottom-0 right-0 size-8 rounded-full bg-primary text-white flex items-center justify-center shadow-lg hover:bg-primary/90 active:scale-90 transition-all duration-200">
              <span className="material-symbols-outlined text-sm">edit</span>
            </button>
          </div>
          <h1 className="text-xl md:text-2xl font-black text-on-surface tracking-tight">Alex Johnson</h1>
          <div className="flex items-center justify-center gap-2 mt-1">
            <span className="material-symbols-outlined text-secondary text-sm" style={{ fontVariationSettings: "'FILL' 1" }} aria-hidden="true">stars</span>
            <span className="text-xs font-bold text-secondary uppercase tracking-wider">Gold Member</span>
            <span className="text-[8px] text-outline">&bull;</span>
            <span className="text-xs text-on-surface-variant">Joined Oct 2023</span>
          </div>
        </section>

        {/* ---- Quick Stats ---- */}
        <section data-pf-item data-pf-delay="0.1s" className="mb-6">
          <div className="grid grid-cols-3 gap-2">
            <StatPill icon="location_on" value="47" label="Total Visits" />
            <StatPill icon="stars" value="2,450" label="Points Earned" />
            <StatPill icon="card_giftcard" value="12" label="Rewards Claimed" />
          </div>
        </section>

        {/* ---- Loyalty Status ---- */}
        <section data-pf-item data-pf-delay="0.18s" className="mb-6">
          <div className="relative metallic-gold rounded-2xl p-6 overflow-hidden group">
            <div className="absolute inset-0 opacity-10 pointer-events-none mix-blend-overlay">
              <div className="absolute -right-8 -top-8 w-40 h-40 rounded-full border-[20px] border-on-secondary-fixed" />
              <div className="absolute -left-16 -bottom-16 w-56 h-56 rounded-full border-[40px] border-on-secondary-fixed" />
            </div>

            <div className="relative z-10 flex flex-col md:flex-row justify-between items-center gap-4">
              <div>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <span className="material-symbols-outlined text-on-secondary-fixed text-sm" style={{ fontVariationSettings: "'FILL' 1" }} aria-hidden="true">stars</span>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-on-secondary-fixed-variant">Gold Member Status</span>
                </div>
                <h2 className="text-2xl md:text-3xl font-black text-on-secondary-fixed tracking-tight">Alex Johnson</h2>
                <p className="text-xs text-on-secondary-fixed-variant mt-0.5 flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px]" aria-hidden="true">cake</span>
                  Birthday: March 12
                </p>
              </div>
              <div className="text-right">
                <span className="text-[9px] font-bold uppercase tracking-widest text-on-secondary-fixed-variant block mb-0.5">Total Balance</span>
                <div className="flex items-end gap-1">
                  <span className="text-3xl md:text-4xl font-extrabold leading-none text-on-secondary-fixed">2,450</span>
                  <span className="text-sm font-bold text-on-secondary-fixed pb-1">pts</span>
                </div>
              </div>
            </div>

            <div className="mt-5 relative h-3 bg-white/30 rounded-full overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-r from-primary to-sunset-orange rounded-full shadow-lg transition-all duration-1000" style={{ width: '75%' }} />
            </div>
            <div className="mt-2 flex justify-between text-on-secondary-fixed-variant text-[10px] font-bold">
              <span>Current: Gold</span>
              <span>550 pts to Platinum</span>
            </div>
          </div>
        </section>

        {/* ---- Achievements ---- */}
        <section data-pf-item data-pf-delay="0.26s" className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-title-md font-extrabold text-on-surface flex items-center gap-1.5">
              <span className="material-symbols-outlined text-primary text-lg" aria-hidden="true">military_tech</span>
              Achievements
            </h2>
            <span className="text-[10px] font-black text-primary uppercase bg-primary/10 px-2 py-0.5 rounded-full">4 / 6</span>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {badges.map((badge) => (
              <BadgeItem key={badge.label} badge={badge} />
            ))}
          </div>
        </section>

        {/* ---- Account Details + Preferences Grid ---- */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          {/* Account Details */}
          <div data-pf-item data-pf-delay="0.34s" className="bg-white/80 backdrop-blur-sm rounded-2xl p-5 shadow-sm border border-outline-variant/30 hover:shadow-md transition-shadow duration-300">
            <h3 className="font-extrabold text-on-surface text-sm mb-5 flex items-center gap-2">
              <span className="material-symbols-outlined text-primary" aria-hidden="true">person_edit</span>
              Account Details
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-on-surface-variant uppercase tracking-wider mb-1.5">Birthday</label>
                <div className="relative">
                  <input
                    className="w-full bg-white border-2 border-surface-container-high rounded-xl py-3 px-4 text-sm font-semibold text-on-surface focus:ring-2 focus:ring-primary focus:border-primary transition-all cursor-default"
                    readOnly
                    type="text"
                    value="March 12, 1995"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 material-symbols-outlined text-outline text-lg" aria-hidden="true">cake</span>
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-on-surface-variant uppercase tracking-wider mb-1.5">Email</label>
                <div className="relative">
                  <input
                    className="w-full bg-white border-2 border-surface-container-high rounded-xl py-3 px-4 text-sm font-semibold text-on-surface focus:ring-2 focus:ring-primary focus:border-primary transition-all"
                    type="email"
                    defaultValue="alex@chaish.com"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 material-symbols-outlined text-outline text-lg" aria-hidden="true">mail</span>
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-on-surface-variant uppercase tracking-wider mb-1.5">Favorite Drink</label>
                <div className="relative">
                  <input
                    className="w-full bg-white border-2 border-surface-container-high rounded-xl py-3 px-4 text-sm font-semibold text-on-surface focus:ring-2 focus:ring-primary focus:border-primary transition-all"
                    type="text"
                    defaultValue="Masala Chai"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 material-symbols-outlined text-outline text-lg" aria-hidden="true">local_cafe</span>
                </div>
              </div>
            </div>
            <div className="mt-4 p-3 bg-primary-container/10 rounded-xl border border-primary/10">
              <p className="text-xs font-semibold text-on-surface flex items-center gap-1.5">
                <span className="material-symbols-outlined text-primary text-sm" aria-hidden="true">card_giftcard</span>
                You&apos;ll receive a <span className="font-black text-primary">free Signature Chai</span> on your birthday!
              </p>
            </div>
          </div>

          {/* Preferences */}
          <div data-pf-item data-pf-delay="0.42s" className="bg-white/80 backdrop-blur-sm rounded-2xl p-5 shadow-sm border border-outline-variant/30 hover:shadow-md transition-shadow duration-300">
            <h3 className="font-extrabold text-on-surface text-sm mb-5 flex items-center gap-2">
              <span className="material-symbols-outlined text-primary" aria-hidden="true">settings</span>
              Preferences
            </h3>
            <div className="space-y-4">
              {[
                { icon: 'notifications', label: 'Push Notifications', desc: 'Order updates & rewards alerts', defaultChecked: true },
                { icon: 'email', label: 'Email Updates', desc: 'Weekly offers & new menu items', defaultChecked: true },
                { icon: 'sms', label: 'SMS Alerts', desc: 'OTP & order confirmation', defaultChecked: false },
                { icon: 'dark_mode', label: 'Dark Mode', desc: 'Reduce eye strain at night', defaultChecked: false },
              ].map((pref) => (
                <label key={pref.label} className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-surface-container/50 transition-colors cursor-pointer group">
                  <span className="material-symbols-outlined text-on-surface-variant text-lg group-hover:text-primary transition-colors" aria-hidden="true">{pref.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-on-surface">{pref.label}</p>
                    <p className="text-[10px] text-on-surface-variant">{pref.desc}</p>
                  </div>
                  <input type="checkbox" className="sr-only peer" defaultChecked={pref.defaultChecked} />
                  <div className="relative w-10 h-5 rounded-full transition-colors duration-300 bg-surface-container-high peer-checked:bg-primary cursor-pointer after:absolute after:top-0.5 after:left-0.5 after:size-4 after:rounded-full after:bg-white after:shadow-sm after:transition-transform after:duration-300 peer-checked:after:translate-x-5" />
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* ---- Information Links ---- */}
        <section data-pf-item data-pf-delay="0.5s" className="mb-6">
          <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-5 shadow-sm border border-outline-variant/30 hover:shadow-md transition-shadow duration-300">
            <h3 className="font-extrabold text-on-surface text-sm mb-4 flex items-center gap-2">
              <span className="material-symbols-outlined text-primary" aria-hidden="true">policy</span>
              Information
            </h3>
            <div className="space-y-1">
              {infoLinks.map((link) => (
                <a
                  key={link.label}
                  className="flex items-center justify-between p-3.5 rounded-xl hover:bg-surface-container transition-colors group"
                  href={link.to}
                >
                  <div className="flex items-center gap-3">
                    <div className="size-9 rounded-full bg-surface-container-high flex items-center justify-center text-on-surface-variant group-hover:text-primary group-hover:bg-primary/10 transition-all">
                      <span className="material-symbols-outlined text-lg">{link.icon}</span>
                    </div>
                    <span className="text-sm font-bold text-on-surface group-hover:text-primary transition-colors">
                      {link.label}
                    </span>
                  </div>
                  <span className="material-symbols-outlined text-outline text-lg group-hover:translate-x-0.5 transition-transform" aria-hidden="true">chevron_right</span>
                </a>
              ))}
            </div>
          </div>
        </section>

        {/* ---- Logout ---- */}
        <section data-pf-item data-pf-delay="0.58s" className="mb-10 flex justify-center">
          <button className="flex items-center gap-3 px-10 py-4 bg-gradient-to-r from-rich-black to-zinc-800 text-white rounded-full font-black text-sm shadow-xl hover:scale-[1.02] hover:shadow-2xl active:scale-95 transition-all duration-200">
            <span className="material-symbols-outlined" aria-hidden="true">logout</span>
            Logout
          </button>
        </section>

        {/* ---- Footer Spinner ---- */}
        <div className="w-full flex justify-center py-8 opacity-20">
          <div className="size-16 rounded-full border-4 border-dashed border-primary animate-spin-slow" />
        </div>
      </main>

      <BottomNav />
    </PageShell>
  )
}
