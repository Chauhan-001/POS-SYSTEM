import { useEffect, useRef } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger)

interface ParallaxOptions {
  speed?: number
  direction?: 'up' | 'down' | 'left' | 'right'
}

export const useParallax = <T extends HTMLElement>(options: ParallaxOptions = {}) => {
  const ref = useRef<T>(null!)
  const { speed = 0.3, direction = 'up' } = options

  useEffect(() => {
    const element = ref.current
    if (!element) return

    let xPercent = 0
    let yPercent = 0

    switch (direction) {
      case 'up':
        yPercent = -100 * speed
        break
      case 'down':
        yPercent = 100 * speed
        break
      case 'left':
        xPercent = -100 * speed
        break
      case 'right':
        xPercent = 100 * speed
        break
    }

    const ctx = gsap.context(() => {
      gsap.fromTo(
        element,
        { x: `${-xPercent}%`, y: `${-yPercent}%` },
        {
          x: `${xPercent}%`,
          y: `${yPercent}%`,
          ease: 'none',
          scrollTrigger: {
            trigger: element.parentElement || element,
            start: 'top bottom',
            end: 'bottom top',
            scrub: 1.5,
          },
        }
      )
    })

    return () => ctx.revert()
  }, [speed, direction])

  return ref
}
