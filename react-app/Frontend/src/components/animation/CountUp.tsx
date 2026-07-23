import { useEffect, useRef, useState } from 'react'
import { gsap } from 'gsap'

type Props = {
  /** Target value to count up to */
  value: number
  /** Optional prefix (e.g. "₹", "$") */
  prefix?: string
  /** Optional suffix (e.g. "+", "K", " Items") */
  suffix?: string
  /** Duration in ms */
  duration?: number
  /** Number of decimal places (0 for integers) */
  decimals?: number
  /** Delay before starting the count (ms) */
  delay?: number
  /** IntersectionObserver threshold */
  threshold?: number
  className?: string
}

export default function CountUp({
  value,
  prefix = '',
  suffix = '',
  duration = 2000,
  decimals = 0,
  delay = 0,
  threshold = 0.3,
  className = '',
}: Props) {
  const ref = useRef<HTMLSpanElement | null>(null)
  const [hasAnimated, setHasAnimated] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el || hasAnimated) return

    let tween: gsap.core.Tween | null = null

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          observer.unobserve(el)

          // Animate from 0 to target value using GSAP
          const proxy = { val: 0 }
          tween = gsap.to(proxy, {
            val: value,
            duration: duration / 1000,
            delay: delay / 1000,
            ease: 'power3.out',
            onUpdate: () => {
              el.textContent = `${prefix}${proxy.val.toFixed(decimals)}${suffix}`
            },
          })

          setHasAnimated(true)
        }
      },
      { threshold }
    )

    observer.observe(el)

    return () => {
      observer.disconnect()
      tween?.kill()
    }
  }, [value, prefix, suffix, duration, decimals, delay, threshold, hasAnimated])

  return (
    <span ref={ref} className={`inline-block tabular-nums ${className}`}>
      {prefix}0{suffix}
    </span>
  )
}
