import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { prepareCharMask } from './textReveal'

gsap.registerPlugin(ScrollTrigger)

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

export type ProductSceneOptions = {
  container: HTMLElement
  skipIdle?: boolean
}

export type ProductSceneResult = {
  timeline: gsap.core.Timeline
  kill: () => void
}

/* ------------------------------------------------------------------ */
/* Cinematic Product Scene — premium, weighty, physically believable  */
/*                                                                      */
/* Vada Pav (left layout): enters from RIGHT with overshoot + settle   */
/* Cutting Chai (right layout): enters from LEFT with overshoot        */
/*                                                                      */
/* Both products follow slightly curved paths, decelerate smoothly,    */
/* overshoot ~20px, then settle into position with continuous idle     */
/* floating.                                                           */
/* ------------------------------------------------------------------ */

export function createProductScene({
  container,
  skipIdle = false,
}: ProductSceneOptions): ProductSceneResult {
  const vadaPav = container.querySelector<HTMLElement>('[data-product="vadapav"]')
  const chai = container.querySelector<HTMLElement>('[data-product="chai"]')
  const title = container.querySelector<HTMLElement>('[data-product-title]')
  const subtitle = container.querySelector<HTMLElement>('[data-product-subtitle]')
  const tagline = container.querySelector<HTMLElement>('[data-product-tagline]')
  const steamLayers = container.querySelectorAll<HTMLElement>('[data-steam-overlay]')

  const cleanups: (() => void)[] = []

  /* ── Step 0: Initial state — Vada Pav enters from RIGHT (+500px) ── */
  gsap.set(vadaPav, {
    x: 500,
    rotation: 10,
    scale: 0.85,
    opacity: 0,
  })

  /* ── Cutting Chai enters from LEFT (-500px) ── */
  gsap.set(chai, {
    x: -500,
    rotation: -8,
    scale: 0.88,
    opacity: 0,
  })

  gsap.set(subtitle, { opacity: 0, y: 30 })
  gsap.set(tagline, { opacity: 0, y: 20 })

  /* Steam layers: initially hidden */
  steamLayers.forEach((s) => gsap.set(s, { opacity: 0 }))

  /* Split heading into characters for mask reveal */
  let titleChars: HTMLElement[] = []
  if (title) {
    const result = prepareCharMask(title)
    titleChars = result.chars
    cleanups.push(result.cleanup)
  }

  /* ── Main scrubbed timeline — ScrollTrigger with scrub 1.5 ── */
  const tl = gsap.timeline({
    scrollTrigger: {
      trigger: container,
      start: 'top top',
      end: '+=200%',
      pin: true,
      pinSpacing: true,
      scrub: 1.5,
      anticipatePin: 1,
      invalidateOnRefresh: true,
    },
  })

  /* ── Step 1: Vada Pav — cinematic curved entry with overshoot ── */
  tl.to(
    vadaPav,
    {
      keyframes: [
        /* Approaches from right on a slight upward arc */
        { x: 350, y: -30, rotation: 7, opacity: 0.15, scale: 0.87, ease: 'power1.out' },
        { x: 180, y: -18, rotation: 4, opacity: 0.4, scale: 0.91, ease: 'power2.out' },
        { x: 60, y: -8, rotation: 1.5, opacity: 0.75, scale: 0.96, ease: 'power3.out' },
        /* Overshoot ~20px past final, then settle back */
        { x: -20, y: 2, rotation: -0.5, opacity: 1, scale: 1.01, ease: 'power4.out' },
        { x: 0, y: 0, rotation: 0, opacity: 1, scale: 1, ease: 'expo.out' },
      ],
    },
    0
  )

  /* ── Step 2: Cutting Chai — mirrored cinematic entry ── */
  tl.to(
    chai,
    {
      keyframes: [
        { x: -350, y: 20, rotation: -6, opacity: 0.15, scale: 0.9, ease: 'power1.out' },
        { x: -180, y: 12, rotation: -3, opacity: 0.4, scale: 0.93, ease: 'power2.out' },
        { x: -60, y: 5, rotation: -1, opacity: 0.75, scale: 0.97, ease: 'power3.out' },
        { x: 20, y: -2, rotation: 0.5, opacity: 1, scale: 1.01, ease: 'power4.out' },
        { x: 0, y: 0, rotation: 0, opacity: 1, scale: 1, ease: 'expo.out' },
      ],
    },
    0
  )

  /* ── Step 3: Steam — each layer fades in at different times ── */
  if (steamLayers.length >= 1) {
    tl.to(steamLayers[0], { opacity: 0.15, duration: 0.8, ease: 'power2.out' }, 0.3)
  }
  if (steamLayers.length >= 2) {
    tl.to(steamLayers[1], { opacity: 0.2, duration: 0.6, ease: 'power2.out' }, 0.5)
  }
  if (steamLayers.length >= 3) {
    tl.to(steamLayers[2], { opacity: 0.25, duration: 0.5, ease: 'power1.out' }, 0.7)
  }

  /* ── Step 4: Text reveals ── */
  if (titleChars.length) {
    tl.fromTo(
      titleChars,
      { y: '100%', opacity: 0 },
      { y: '0%', opacity: 1, duration: 0.5, stagger: 0.035, ease: 'power3.out' },
      0.25
    )
  }

  tl.to(subtitle, { opacity: 1, y: 0, duration: 0.5, ease: 'power3.out' }, 0.4)

  tl.to(tagline, { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out' }, 0.5)

  /* ── Parallax — spice images drift at ~30% speed ── */
  /* Using [data-parallax] to avoid conflict with microInteractions' continuous
     float on [data-decor] elements */
  const parallaxEls = container.querySelectorAll<HTMLElement>('[data-parallax]')
  if (parallaxEls.length) {
    gsap.to(parallaxEls, {
      y: (i: number) => [16, -10][i % 2],
      rotation: (i: number) => [6, -4][i % 2],
      ease: 'none',
      scrollTrigger: {
        trigger: container,
        start: 'top top',
        end: '+=200%',
        scrub: 1.5,
      },
    })
  }

  /* ── Idle floating — continuous subtle motion after settling ── */
  let idleTl: gsap.core.Timeline | null = null
  let idleST: ScrollTrigger | null = null
  const steamTweens: gsap.core.Tween[] = []

  if (!skipIdle) {
    idleTl = gsap.timeline({ paused: true, repeat: -1, yoyo: true })

    /* Vada Pav idle: ±8px float, ±1° rotation, subtle scale breathing */
    if (vadaPav) {
      idleTl.to(
        vadaPav,
        {
          y: 8,
          rotation: 1,
          scale: 1.01,
          duration: 4,
          ease: 'sine.inOut',
        },
        0
      )
    }

    /* Cutting Chai idle: ±6px float, ±1° rotation — 3.5s each way = 7s full cycle */
    if (chai) {
      idleTl.to(
        chai,
        {
          y: -6,
          rotation: -1,
          scale: 1.01,
          duration: 3.5,
          ease: 'sine.inOut',
        },
        0
      )
    }

    /* Steam — continuous independent rise on each layer, paused initially */
    steamLayers.forEach((layer, i) => {
      const speed = 5 + i * 2
      const rise = -(25 + i * 15)
      const opacityPeak = 0.12 + i * 0.06
      const scaleTarget = 1.05 + i * 0.08
      const tween = gsap.to(layer, {
        y: rise,
        opacity: opacityPeak,
        scale: scaleTarget,
        duration: speed,
        repeat: -1,
        yoyo: true,
        ease: 'power1.inOut',
        delay: i * 0.8,
        paused: true,
      })
      steamTweens.push(tween)
    })

    idleTl.progress(0).play()
    /* Kick off steam now that idle is playing (steam independently loops) */
    steamTweens.forEach((t) => t.play())

    idleST = ScrollTrigger.create({
      trigger: container,
      start: 'top bottom',
      end: 'bottom top',
      onEnter: () => {
        idleTl?.play()
        steamTweens.forEach((t) => t.play())
      },
      onLeave: () => {
        idleTl?.pause()
        steamTweens.forEach((t) => t.pause())
      },
      onEnterBack: () => {
        idleTl?.play()
        steamTweens.forEach((t) => t.play())
      },
      onLeaveBack: () => {
        idleTl?.pause()
        steamTweens.forEach((t) => t.pause())
      },
    })
  }

  return {
    timeline: tl,
    kill: () => {
      idleST?.kill()
      idleTl?.kill()
      /* Kill steam tweens */
      steamTweens.forEach((t) => t.kill())
      tl.scrollTrigger?.kill()
      tl.kill()
      cleanups.forEach((fn) => fn())
    },
  }
}
