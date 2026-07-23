import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'

/* ------------------------------------------------------------------ */
/* Hooks                                                              */
/* ------------------------------------------------------------------ */
function useStaggerOnMount() {
  useEffect(() => {
    const nodes = Array.from(document.querySelectorAll('[data-otp-item]')) as HTMLElement[]
    nodes.forEach((el, i) => {
      const delay = el.getAttribute('data-otp-delay') || `${i * 0.1}s`
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
export default function OTPVerificationPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const phone = (location.state as { phone?: string } | null)?.phone || '9876543210'

  const [otp, setOtp] = useState<string[]>(new Array(4).fill(''))
  const [timeLeft, setTimeLeft] = useState(30)
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const inputRefs = useRef<Array<HTMLInputElement | null>>([])

  useStaggerOnMount()

  useEffect(() => {
    inputRefs.current[0]?.focus()
  }, [])

  useEffect(() => {
    if (timeLeft <= 0) return
    const interval = window.setInterval(() => {
      setTimeLeft((t) => (t <= 1 ? 0 : t - 1))
    }, 1000)
    return () => window.clearInterval(interval)
  }, [timeLeft])

  const filled = otp.every((d) => d !== '')

  function commit(next: string[]) {
    setOtp(next)
    setStatus('idle')
  }

  function handleChange(index: number, value: string) {
    const digits = value.replace(/\D/g, '').split('')
    if (digits.length === 0) {
      const next = [...otp]
      next[index] = ''
      commit(next)
      return
    }
    const next = [...otp]
    let i = index
    for (const d of digits) {
      if (i > 3) break
      next[i] = d
      i++
    }
    commit(next)
    const focusIndex = Math.min(index + digits.length, 3)
    inputRefs.current[focusIndex]?.focus()
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    e.preventDefault()
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 4)
    if (!pasted) return
    const next = [...otp]
    for (let i = 0; i < pasted.length && i < 4; i++) next[i] = pasted[i]
    commit(next)
    const focusIndex = Math.min(pasted.length, 3)
    inputRefs.current[focusIndex]?.focus()
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      inputRefs.current[index - 1]?.focus()
    }
  }

  function handleResend() {
    setOtp(new Array(4).fill(''))
    setTimeLeft(30)
    setStatus('idle')
    inputRefs.current[0]?.focus()
  }

  function handleVerify() {
    if (!filled || status === 'loading') return
    setStatus('loading')
    window.setTimeout(() => {
      if (otp.join('') === '1234') {
        navigate('/dashboard', { replace: true })
      } else {
        setStatus('error')
        window.setTimeout(() => setStatus('idle'), 1200)
      }
    }, 900)
  }

  const maskedPhone = `+91 ••••• ••${phone.slice(-2)}`

  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden">
      {/* Background */}
      <div
        className="fixed inset-0 z-[-1]"
        style={{
          backgroundImage:
            "url('https://lh3.googleusercontent.com/aida-public/AB6AXuCZPJllUJplGVkgMFCaAxZiQYRoDuV2aX0n6HmWb-0I5A1Euv5huAJYVQJcMVIX5dv0gYzSHa8Jt1xVk1vatlQQDHfJKRFqC00Xs2FZLeM0EgXH2qyJPnByV5pf18XWqA8nX2FVh-8tmVaON1UzqeEPypGOcpeKp2kS82zu54NFU5dpBCC_Rz65a22JPyB50zQgnenai4iOAQPl-UZFDwTv9snqDdVq9_mea24lA2GLO9Cd8pjZScZSWcGm0OAPrfKoKQ2u-faG5g1A')",
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >
        <div className="absolute inset-0 bg-white/85 backdrop-blur-[2px]" />
      </div>

      {/* Top bar */}
      <div className="sticky top-0 z-10 flex items-center px-4 py-3" data-otp-item>
        <Link to="/login" aria-label="Back to login" className="flex size-9 items-center justify-center rounded-full bg-surface-container-low text-on-surface hover:bg-surface-container active:scale-95 transition-all">
          <span className="material-symbols-outlined text-lg">arrow_back</span>
        </Link>
      </div>

      <main className="flex-1 flex items-center justify-center px-5 py-8 relative z-10">
        <div className="w-full max-w-[400px] flex flex-col items-center">
          {/* Logo */}
          <div className="mb-8 flex flex-col items-center text-center" data-otp-item>
            <div className="w-20 h-20 md:w-24 md:h-24 mb-3 md:mb-5 drop-shadow-xl" aria-hidden="true">
              <img
                alt="Chaish Logo"
                className="w-full h-full object-contain"
                src="https://lh3.googleusercontent.com/aida-public/AB6AXuBsBjEKIm3WYbnh0imtCLpFQfumKnkDnR8mSgPoxBfP4j1M54kjnsFwsPN_t9Eh1B1WTPR2r603eKPkTWhujKSPZiR9obR8yO36iiPu7lKiK8aaK98pf31eWCqNpaqzbO2Mw_GYznGVLv9hm_7vRHvmFzTq8IpKb369gJvHBNnv2u9ukEQSzNT24Zh6g8OFXhXsbsBeqkBdpCYJGUQrJLZx3iHQ90Of8x16IwjjlLT61uBfCYHqTv3p3H85ZdRfKzUSlsWrg53FwTHa"
              />
            </div>
            <h1 className="text-2xl font-black text-on-surface tracking-tight">Verify your number</h1>
            <p className="text-sm text-on-surface-variant mt-1">
              Enter the 4-digit code sent to{' '}
              <span className="font-bold text-on-surface">{maskedPhone}</span>
            </p>
          </div>

          {/* OTP Input Card */}
          <div className="w-full glass-card rounded-2xl p-6 shadow-lg" data-otp-item data-otp-delay="0.2s">
            <div className="space-y-5">
              {/* OTP Inputs */}
              <div
                className={[
                  'flex gap-3 justify-center',
                  status === 'error' ? 'animate-shake' : '',
                ].join(' ')}
              >
                {otp.map((digit, index) => (
                  <input
                    key={index}
                    ref={(el) => { inputRefs.current[index] = el }}
                    className={[
                      'w-12 h-12 sm:w-14 sm:h-14 md:w-16 md:h-16 text-center text-base md:text-lg font-extrabold bg-white border-2 rounded-xl transition-all focus:ring-2 focus:ring-primary focus:border-primary',
                      status === 'error'
                        ? 'border-error text-error'
                        : 'border-surface-container-high',
                    ].join(' ')}
                    maxLength={1}
                    inputMode="numeric"
                    value={digit}
                    autoComplete={index === 0 ? 'one-time-code' : 'off'}
                    disabled={status === 'loading'}
                    onChange={(e) => handleChange(index, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(index, e)}
                    onPaste={handlePaste}
                    aria-label={`OTP digit ${index + 1}`}
                  />
                ))}
              </div>

              {/* Error text */}
              <p
                className={[
                  'text-center text-xs font-bold min-h-4 transition-colors',
                  status === 'error' ? 'text-error' : 'text-transparent',
                ].join(' ')}
              >
                {status === 'error' ? 'Incorrect code. Please try again.' : ''}
              </p>

              {/* Verify button */}
              <button
                className={[
                  'w-full py-3.5 rounded-xl font-black text-sm uppercase tracking-wider transition-all flex items-center justify-center gap-2',
                  filled && status !== 'loading'
                    ? 'bg-primary text-white hover:bg-primary/90 active:scale-[0.97] shadow-lg shadow-primary/20'
                    : 'bg-surface-container-high text-on-surface-variant/50 cursor-not-allowed',
                ].join(' ')}
                onClick={handleVerify}
                disabled={!filled || status === 'loading'}
              >
                {status === 'loading' ? (
                  <>
                    <span className="h-4 w-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                    Verifying...
                  </>
                ) : (
                  <>
                    Verify &amp; Login
                    <span className="material-symbols-outlined text-lg" aria-hidden="true">arrow_forward</span>
                  </>
                )}
              </button>

              {/* Resend */}
              <div className="text-center">
                <p className="text-xs font-semibold text-on-surface-variant/80">
                  {timeLeft > 0 ? (
                    <>
                      Didn&apos;t receive code?{' '}
                      <span className="font-bold text-primary">Resend in {timeLeft}s</span>
                    </>
                  ) : (
                    <button className="font-bold text-primary hover:underline cursor-pointer" onClick={handleResend} disabled={status === 'loading'}>
                      Resend Code
                    </button>
                  )}
                </p>
              </div>
            </div>
          </div>

          {/* Change Number */}
          <Link
            to="/login"
            className="mt-6 text-xs font-bold text-on-surface-variant hover:text-primary transition-colors flex items-center gap-1"
            data-otp-item data-otp-delay="0.3s"
          >
            <span className="material-symbols-outlined text-sm" aria-hidden="true">edit</span>
            Change Phone Number
          </Link>

          {/* Decorative */}
          <div className="mt-auto pt-8 w-full flex items-center justify-center opacity-30" data-otp-item data-otp-delay="0.4s">
            <div className="h-px bg-outline-variant flex-grow" />
            <span className="material-symbols-outlined text-outline px-4" aria-hidden="true">local_cafe</span>
            <div className="h-px bg-outline-variant flex-grow" />
          </div>
        </div>
      </main>
    </div>
  )
}
