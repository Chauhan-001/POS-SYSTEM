import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

/* ------------------------------------------------------------------ */
/* Hooks                                                              */
/* ------------------------------------------------------------------ */
function useStaggerOnMount() {
  useEffect(() => {
    const nodes = Array.from(document.querySelectorAll('[data-lg-item]')) as HTMLElement[]
    nodes.forEach((el, i) => {
      const delay = el.getAttribute('data-lg-delay') || `${i * 0.1}s`
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
/* Page                                                               */
/* ------------------------------------------------------------------ */
export function LoginPage() {
  const [phone, setPhone] = useState('')
  const navigate = useNavigate()

  useStaggerOnMount()

  const isValidPhone = useMemo(() => phone.replace(/\D/g, '').length === 10, [phone])

  function handleGetOTP() {
    if (!isValidPhone) return
    navigate('/otp-verification', { state: { phone: phone.replace(/\D/g, '').slice(-10) } })
  }

  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden">
      {/* Background */}
      <div
        className="fixed inset-0 z-[-1]"
        style={{
          backgroundImage:
            "url('https://lh3.googleusercontent.com/aida/AP1WRLu3xo7CGjU2hgbJfa-7JFhr6GMFVhu7sP2sn3DYEh0Wh6V20aC3IoinDuKnEYsJzlx-U3lgu_yb-N_C1zissxabsa7Zriul4O7tqqJUttuvukp8iTVZGCI6eblwhYkD4HLLWMehZKQMgKWbE1oyCBVCAuekJvir5kUZukZeYLnxu6iQ5TCxTKwrpUkfL6ob2b6Bu4_e0lNpfT0HkoV4DWiOkHVIlnCLiGAMfSknPQkM7rH2rm9gXKLjTBe-')",
          backgroundRepeat: 'repeat',
          backgroundSize: '400px',
        }}
      >
        <div className="absolute inset-0 bg-surface/85 backdrop-blur-[2px]" />
      </div>

      {/* Top bar */}
      <div className="sticky top-0 z-10 flex items-center px-4 py-3" data-lg-item>
        <Link to="/" aria-label="Back to home" className="flex size-9 items-center justify-center rounded-full bg-surface-container-low text-on-surface hover:bg-surface-container active:scale-95 transition-all">
          <span className="material-symbols-outlined text-lg">close</span>
        </Link>
      </div>

      <main className="flex-1 flex items-center justify-center px-5 py-8 relative z-10">
        <div className="w-full max-w-[420px] flex flex-col items-center">
          {/* Logo */}
          <div className="mb-8 flex flex-col items-center text-center" data-lg-item>
            <div className="w-24 h-24 md:w-32 md:h-32 mb-4 md:mb-6 drop-shadow-2xl" aria-hidden="true">
              <img
                alt="Chaish Logo"
                className="w-full h-full object-contain"
                src="https://lh3.googleusercontent.com/aida-public/AB6AXuBsBjEKIm3WYbnh0imtCLpFQfumKnkDnR8mSgPoxBfP4j1M54kjnsFwsPN_t9Eh1B1WTPR2r603eKPkTWhujKSPZiR9obR8yO36iiPu7lKiK8aaK98pf31eWCqNpaqzbO2Mw_GYznGVLv9hm_7vRHvmFzTq8IpKb369gJvHBNnv2u9ukEQSzNT24Zh6g8OFXhXsbsBeqkBdpCYJGUQrJLZx3iHQ90Of8x16IwjjlLT61uBfCYHqTv3p3H85ZdRfKzUSlsWrg53FwTHa"
              />
            </div>
            <h1 className="text-2xl font-black text-on-surface tracking-tight">Welcome to Chaish</h1>
            <p className="text-sm text-on-surface-variant mt-1 max-w-[280px]">
              Login to access your exclusive boutique tea rewards.
            </p>
          </div>

          {/* Phone Input Card */}
          <div className="w-full glass-card rounded-2xl p-6 shadow-lg" data-lg-item data-lg-delay="0.2s">
            <div className="space-y-5">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider ml-1">
                  Phone Number
                </label>
                <div className="relative group">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant font-bold border-r border-outline-variant pr-3 text-sm">
                    +91
                  </span>
                  <input
                    className="w-full pl-16 pr-4 py-3.5 bg-white border-2 border-surface-container-high rounded-xl text-sm font-semibold focus:ring-2 focus:ring-primary focus:border-primary transition-all placeholder:text-outline/50"
                    maxLength={10}
                    placeholder="98765 43210"
                    type="tel"
                    inputMode="numeric"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                    onKeyDown={(e) => { if (e.key === 'Enter' && isValidPhone) handleGetOTP() }}
                  />
                </div>
              </div>

              <button
                className={[
                  'w-full py-3.5 rounded-xl font-black text-sm uppercase tracking-wider transition-all flex items-center justify-center gap-2',
                  isValidPhone
                    ? 'bg-primary text-white hover:bg-primary/90 active:scale-[0.97] shadow-lg shadow-primary/20'
                    : 'bg-surface-container-high text-on-surface-variant/50 cursor-not-allowed',
                ].join(' ')}
                onClick={handleGetOTP}
                disabled={!isValidPhone}
                type="button"
              >
                Get OTP
                <span className="material-symbols-outlined text-lg" aria-hidden="true">arrow_forward</span>
              </button>
            </div>
          </div>

          {/* Terms */}
          <p className="text-center text-[10px] font-bold text-on-surface-variant mt-5 leading-relaxed" data-lg-item data-lg-delay="0.3s">
            By continuing, you agree to our{' '}
            <a className="text-primary hover:underline" href="#">Terms of Service</a>
            {' '}and{' '}
            <a className="text-primary hover:underline" href="#">Privacy Policy</a>.
          </p>
        </div>
      </main>
    </div>
  )
}
