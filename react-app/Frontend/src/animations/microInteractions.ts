import { gsap } from 'gsap'

/* ------------------------------------------------------------------ */
/* Depth Layers                                                       */
/*                                                                     */
/* Decorative assets are organized by depth so they move at            */
/* different speeds, creating a layered parallax feel:                 */
/*                                                                     */
/*   Layer 1 (Background): Golden dust, aroma — slowest               */
/*   Layer 2 (Mid-back):   Tea leaves — very slow drift               */
/*   Layer 3 (Mid):        Mint — medium float                        */
/*   Layer 4 (Mid-front):  Lemon — slow orbital                       */
/*   Layer 5 (Foreground): Bubbles, steam — continuous rise           */
/*                                                                     */
/* All decorative assets move SLOWER than products (4s cycle).        */
/*                                                                     */
/* PERFORMANCE:                                                        */
/*   - Only transform + opacity are animated (GPU-composited)          */
/*   - will-change: transform is set on every continuously-animated    */
/*     element to promote it to its own compositor layer               */
/*   - Random values are pre-computed per-element for stable tweens    */
/* ------------------------------------------------------------------ */

/* ── Helper: set will-change and return the element ── */
function ensureGPU(el: Element | string): Element {
  const element = typeof el === 'string' ? document.querySelector(el) : el
  if (element && element instanceof HTMLElement) {
    element.style.willChange = 'transform'
  }
  return element!
}

/* ──────────────────────────────────────────────────────────────────── */
/*  Layer 3 — Mint: Random floating, rotation -8..8°, 7-10s           */
/* ──────────────────────────────────────────────────────────────────── */

export function createMintFloat(element: Element | string): gsap.core.Tween {
  const el = ensureGPU(element)
  return gsap.to(el, {
    x: -12 + Math.random() * 24,
    y: -10 + Math.random() * 20,
    rotation: -8 + Math.random() * 16,
    duration: 7 + Math.random() * 3,
    repeat: -1,
    yoyo: true,
    ease: 'sine.inOut',
  })
}

/* ──────────────────────────────────────────────────────────────────── */
/*  Layer 2 — Tea leaves: Very slow drifting, 8-12s                   */
/* ──────────────────────────────────────────────────────────────────── */

export function createTeaLeafDrift(element: Element | string): gsap.core.Tween {
  const el = ensureGPU(element)
  return gsap.to(el, {
    x: -20 + Math.random() * 40,
    y: -15 + Math.random() * 30,
    rotation: -5 + Math.random() * 10,
    duration: 8 + Math.random() * 4,
    repeat: -1,
    yoyo: true,
    ease: 'sine.inOut',
  })
}

/* ──────────────────────────────────────────────────────────────────── */
/*  Layer 4 — Lemon: Slow orbital motion                               */
/* ──────────────────────────────────────────────────────────────────── */

export function createLemonOrbit(element: Element | string): gsap.core.Tween {
  const el = ensureGPU(element)
  return gsap.to(el, {
    x: -18 + Math.random() * 36,
    y: -12 + Math.random() * 24,
    rotation: -6 + Math.random() * 12,
    duration: 10 + Math.random() * 4,
    repeat: -1,
    yoyo: true,
    ease: 'sine.inOut',
  })
}

/* ──────────────────────────────────────────────────────────────────── */
/*  Layer 5 — Bubble overlays: Move upward continuously                */
/* ──────────────────────────────────────────────────────────────────── */

export function createBubbleRise(element: Element | string): gsap.core.Tween {
  const el = ensureGPU(element)
  return gsap.to(el, {
    y: -(15 + Math.random() * 15),
    x: -10 + Math.random() * 20,
    rotation: -3 + Math.random() * 6,
    opacity: 0.1 + Math.random() * 0.25,
    duration: 8 + Math.random() * 4,
    repeat: -1,
    yoyo: true,
    ease: 'sine.inOut',
  })
}

/* ──────────────────────────────────────────────────────────────────── */
/*  Layer 5 — Steam: Continuous rising loop                            */
/* ──────────────────────────────────────────────────────────────────── */

export function createDecorativeSteam(element: Element | string): gsap.core.Tween {
  const el = ensureGPU(element)
  return gsap.to(el, {
    y: -(20 + Math.random() * 15),
    x: -8 + Math.random() * 16,
    scale: 1.05 + Math.random() * 0.1,
    opacity: 0.1 + Math.random() * 0.2,
    duration: 6 + Math.random() * 3,
    repeat: -1,
    yoyo: true,
    ease: 'power1.inOut',
  })
}

/* ──────────────────────────────────────────────────────────────────── */
/*  Layer 1 — Golden particles: Gentle opacity pulse                   */
/* ──────────────────────────────────────────────────────────────────── */

export function createGoldenPulse(
  element: Element | string
): gsap.core.Tween {
  const el = ensureGPU(element)
  return gsap.to(el, {
    opacity: 0.02 + Math.random() * 0.06,
    duration: 8 + Math.random() * 2,
    repeat: -1,
    yoyo: true,
    ease: 'sine.inOut',
  })
}

/* ──────────────────────────────────────────────────────────────────── */
/*  Helper — Create multiple particle elements inside a container      */
/* ──────────────────────────────────────────────────────────────────── */

export function spawnGoldenParticles(
  container: Element | string,
  count = 8
): { tweens: gsap.core.Tween[]; elements: HTMLElement[]; kill: () => void } {
  const parent =
    typeof container === 'string'
      ? document.querySelector(container)
      : container
  if (!parent) return { tweens: [], elements: [], kill: () => {} }

  const elements: HTMLElement[] = []
  const tweens: gsap.core.Tween[] = []

  for (let i = 0; i < count; i++) {
    const p = document.createElement('div')
    elements.push(p)
    const size = 2 + Math.random() * 4
    p.style.cssText = [
      'position: absolute',
      'pointer-events: none',
      'will-change: transform, opacity',
      `width: ${size}px`,
      `height: ${size}px`,
      `left: ${5 + Math.random() * 90}%`,
      `top: ${10 + Math.random() * 80}%`,
      'background: radial-gradient(circle, rgba(216,155,69,0.6), rgba(216,155,69,0))',
      'border-radius: 9999px',
      'opacity: 0',
    ].join(';')
    parent.appendChild(p)

    /* Pre-compute random values per particle for stable animation */
    const yTarget = -(50 + Math.random() * 80)
    const xRange = -15 + Math.random() * 30
    const opacityMax = 0.2 + Math.random() * 0.4
    const scaleTarget = 0.5 + Math.random() * 1.0
    const dur = 6 + Math.random() * 4
    const delay = Math.random() * 4
    const tween = gsap.to(p, {
      y: yTarget,
      x: xRange,
      opacity: opacityMax,
      scale: scaleTarget,
      duration: dur,
      repeat: -1,
      delay,
      ease: 'power1.out',
      onRepeat: () => {
        gsap.set(p, {
          x: -15 + Math.random() * 30,
          y: 0,
          opacity: 0,
        })
      },
    })
    tweens.push(tween)
  }

  return {
    tweens,
    elements,
    kill: () => {
      tweens.forEach((t) => t.kill())
      elements.forEach((el) => el.remove())
    },
  }
}

/* ──────────────────────────────────────────────────────────────────── */
/*  Helper — Animate all decorative elements in a container            */
/* ──────────────────────────────────────────────────────────────────── */

type DecorAnimations = {
  mintTweens: gsap.core.Tween[]
  teaTweens: gsap.core.Tween[]
  lemonTweens: gsap.core.Tween[]
  bubbleTweens: gsap.core.Tween[]
  steamTweens: gsap.core.Tween[]
  goldenTween: gsap.core.Tween | null
  particleTweens: gsap.core.Tween[]
  kill: () => void
}

export function animateDecorativeElements(
  container: HTMLElement,
  options?: {
    skipMint?: boolean
    skipTea?: boolean
    skipLemon?: boolean
    skipBubble?: boolean
    skipSteam?: boolean
    skipGolden?: boolean
    skipParticles?: boolean
  }
): DecorAnimations {
  const mintTweens: gsap.core.Tween[] = []
  const teaTweens: gsap.core.Tween[] = []
  const lemonTweens: gsap.core.Tween[] = []
  const bubbleTweens: gsap.core.Tween[] = []
  const steamTweens: gsap.core.Tween[] = []
  const particleTweens: gsap.core.Tween[] = []
  const particleElements: HTMLElement[] = []
  let goldenTween: gsap.core.Tween | null = null

  const {
    skipMint = false,
    skipTea = false,
    skipLemon = false,
    skipBubble = false,
    skipSteam = false,
    skipGolden = false,
    skipParticles = false,
  } = options ?? {}

  if (!skipMint) {
    container
      .querySelectorAll<HTMLElement>('[data-decor="mint"]')
      .forEach((el) => mintTweens.push(createMintFloat(el)))
  }

  if (!skipTea) {
    container
      .querySelectorAll<HTMLElement>('[data-decor="tea"]')
      .forEach((el) => teaTweens.push(createTeaLeafDrift(el)))
  }

  if (!skipLemon) {
    container
      .querySelectorAll<HTMLElement>('[data-decor="lemon"]')
      .forEach((el) => lemonTweens.push(createLemonOrbit(el)))
  }

  if (!skipBubble) {
    container
      .querySelectorAll<HTMLElement>('[data-decor="bubble"]')
      .forEach((el) => bubbleTweens.push(createBubbleRise(el)))
  }

  if (!skipSteam) {
    container
      .querySelectorAll<HTMLElement>('[data-decor="steam"]')
      .forEach((el) => steamTweens.push(createDecorativeSteam(el)))
  }

  if (!skipGolden) {
    const goldenEl = container.querySelector<HTMLElement>('[data-golden]')
    if (goldenEl) {
      goldenTween = createGoldenPulse(goldenEl)
    }
  }

  if (!skipParticles) {
    const result = spawnGoldenParticles(container, 6)
    particleTweens.push(...result.tweens)
    particleElements.push(...result.elements)
  }

  return {
    mintTweens,
    teaTweens,
    lemonTweens,
    bubbleTweens,
    steamTweens,
    goldenTween,
    particleTweens,
    kill: () => {
      goldenTween?.kill()
      ;[
        ...mintTweens,
        ...teaTweens,
        ...lemonTweens,
        ...bubbleTweens,
        ...steamTweens,
        ...particleTweens,
      ].forEach((t) => t.kill())
      particleElements.forEach((el) => el.remove())
    },
  }
}
