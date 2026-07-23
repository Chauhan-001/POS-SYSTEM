import { useEffect, useRef } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger)

interface ScrollRevealOptions {
  direction?: 'up' | 'down' | 'left' | 'right'
  distance?: number
  delay?: number
  duration?: number
  stagger?: number
  scrub?: boolean | number
  start?: string
  end?: string
  markers?: boolean
}

export const useScrollReveal = <T extends HTMLElement>(
  options: ScrollRevealOptions = {}
) => {
  const ref = useRef<T>(null!)
  const {
    direction = 'up',
    distance = 60,
    delay = 0,
    duration = 0.8,
    stagger = 0,
    scrub = false,
    start = 'top 85%',
    end = 'bottom 20%',
  } = options

  useEffect(() => {
    const element = ref.current
    if (!element) return

    let fromVars: gsap.TweenVars = {}
    let toVars: gsap.TweenVars = {}

    switch (direction) {
      case 'up':
        fromVars = { y: distance, opacity: 0 }
        break
      case 'down':
        fromVars = { y: -distance, opacity: 0 }
        break
      case 'left':
        fromVars = { x: distance, opacity: 0 }
        break
      case 'right':
        fromVars = { x: -distance, opacity: 0 }
        break
    }

    const ctx = gsap.context(() => {
      const children = element.querySelectorAll('[data-reveal]')
      const targets = children.length ? children : element

      if (scrub) {
        toVars = {
          y: 0,
          x: 0,
          opacity: 1,
          ease: 'none',
          scrollTrigger: {
            trigger: element,
            start,
            end,
            scrub: typeof scrub === 'number' ? scrub : true,
          },
        }
        gsap.fromTo(targets, fromVars, toVars)
      } else {
        toVars = {
          y: 0,
          x: 0,
          opacity: 1,
          duration,
          delay,
          ease: 'power3.out',
          stagger,
          scrollTrigger: {
            trigger: element,
            start,
            toggleActions: 'play none none reverse',
          },
        }
        gsap.fromTo(targets, fromVars, toVars)
      }
    }, element)

    return () => ctx.revert()
  }, [direction, distance, delay, duration, stagger, scrub, start, end])

  return ref
}
