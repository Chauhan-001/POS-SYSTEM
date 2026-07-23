/* ------------------------------------------------------------------ */
/* Text Reveal Utilities                                              */
/*                                                                     */
/* All functions use inline style manipulation rather than GSAP        */
/* tweens, making them compatible with ScrollTrigger onUpdate          */
/* callbacks that fire at high frequency during scroll.                */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Character Mask Reveal for Headings                                 */
/*                                                                     */
/* Splits heading text into individual character spans, each           */
/* initially hidden with translateY + opacity. Reveals them            */
/* sequentially via staggered setProgress() calls.                     */
/*                                                                     */
/* Preserves <br /> and nested <span> elements inside the heading.    */
/* ------------------------------------------------------------------ */

export type CharMaskResult = {
  /** Array of inner character span elements */
  chars: HTMLElement[]
  /** Advance the reveal progress (0–1) */
  setProgress: (p: number) => void
  /** Destroy all created elements, restoring original HTML */
  cleanup: () => void
}

/**
 * Prepares a heading element for character-level mask reveal.
 *
 * Walks only Text nodes inside the heading, splitting their content
 * into individual character `<span>`s. Element children (`<br>`,
 * `<span>`, etc.) are preserved as-is.
 *
 * @param heading — The heading element whose text content will be split
 * @returns { chars, setProgress, cleanup }
 */
export function prepareCharMask(heading: HTMLElement): CharMaskResult {
  const chars: HTMLElement[] = []
  const originalHTML = heading.innerHTML

  /* Walk all child nodes, processing only Text nodes */
  const childNodes = Array.from(heading.childNodes)

  childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? ''
      if (!text || !text.trim()) return

      const fragment = document.createDocumentFragment()

      for (const raw of text) {
        const char = raw === ' ' ? '\u00A0' : raw

        /* Overflow-hidden wrapper (mask container) */
        const wrapper = document.createElement('span')
        wrapper.style.cssText =
          'display:inline-block;overflow:hidden;vertical-align:top;white-space:pre;line-height:inherit;'

        /* The actual character span (this gets animated) */
        const span = document.createElement('span')
        span.textContent = char
        span.style.cssText =
          'display:inline-block;will-change:transform;line-height:inherit;'
        span.style.transform = 'translateY(100%)'
        span.style.opacity = '0'

        wrapper.appendChild(span)
        fragment.appendChild(wrapper)
        chars.push(span)
      }

      /* Replace the original Text node with the character spans */
      heading.replaceChild(fragment, node)
    }
    /* Element nodes (<br>, <span>, etc.) are left untouched */
  })

  heading.style.overflow = 'visible'

  /* ── setProgress(p) — drives the reveal 0→1 ── */
  let lastP = -1
  const total = chars.length

  function setProgress(p: number) {
    const clamped = Math.max(0, Math.min(1, p))
    if (Math.abs(clamped - lastP) < 0.005) return
    lastP = clamped

    const fullRevealCount = Math.floor(clamped * total)
    const fractional = clamped * total - fullRevealCount

    chars.forEach((span, i) => {
      if (i < fullRevealCount) {
        /* Fully revealed */
        span.style.transform = 'translateY(0)'
        span.style.opacity = '1'
      } else if (i === fullRevealCount && fullRevealCount < total) {
        /* Partial reveal for the current character */
        const t = fractional
        const eased = 1 - Math.pow(1 - t, 2)
        span.style.transform = `translateY(${(1 - eased) * 100}%)`
        span.style.opacity = String(eased)
      } else {
        /* Still hidden */
        span.style.transform = 'translateY(100%)'
        span.style.opacity = '0'
      }
    })
  }

  /* ── cleanup() — restore original HTML ── */
  function cleanup() {
    heading.innerHTML = originalHTML
  }

  return { chars, setProgress, cleanup }
}

/* ------------------------------------------------------------------ */
/* Fade-Up Reveal for Subtitles                                       */
/* ------------------------------------------------------------------ */

export type FadeUpResult = {
  setProgress: (p: number) => void
  cleanup: () => void
}

/**
 * Creates a simple fade-up reveal for subtitle/description elements.
 *
 * @param el — The element to animate
 * @param options — yOffset, startOpacity
 * @returns { setProgress, cleanup }
 */
export function createFadeUpReveal(
  el: HTMLElement,
  options?: { yOffset?: number; startOpacity?: number }
): FadeUpResult {
  const yOff = options?.yOffset ?? 24
  const startO = options?.startOpacity ?? 0

  let lastP = -1

  /* Set initial state */
  el.style.transform = `translateY(${yOff}px)`
  el.style.opacity = String(startO)
  el.style.willChange = 'transform, opacity'

  function setProgress(p: number) {
    const clamped = Math.max(0, Math.min(1, p))
    if (Math.abs(clamped - lastP) < 0.01) return
    lastP = clamped

    const eased = 1 - Math.pow(1 - clamped, 1.8)
    el.style.transform = `translateY(${(1 - eased) * yOff}px)`
    el.style.opacity = String(startO + clamped * (1 - startO))
  }

  function cleanup() {
    el.style.transform = ''
    el.style.opacity = ''
    el.style.willChange = ''
  }

  return { setProgress, cleanup }
}

/* ------------------------------------------------------------------ */
/* Button Reveal — Fade + Scale                                       */
/* ------------------------------------------------------------------ */

export type ButtonRevealResult = {
  setProgress: (p: number) => void
  cleanup: () => void
}

/**
 * Creates a fade-in + scale-up reveal for button/CTA elements.
 *
 * @param el — The button or button wrapper element
 * @param options — startScale, startOpacity
 * @returns { setProgress, cleanup }
 */
export function createButtonReveal(
  el: HTMLElement,
  options?: { startScale?: number; startOpacity?: number }
): ButtonRevealResult {
  const startS = options?.startScale ?? 0.88
  const startO = options?.startOpacity ?? 0

  let lastP = -1

  /* Set initial state */
  el.style.transform = `scale(${startS})`
  el.style.opacity = String(startO)
  el.style.willChange = 'transform, opacity'

  function setProgress(p: number) {
    const clamped = Math.max(0, Math.min(1, p))
    if (Math.abs(clamped - lastP) < 0.01) return
    lastP = clamped

    const eased = 1 - Math.pow(1 - clamped, 2)
    const scale = startS + eased * (1 - startS)
    el.style.transform = `scale(${scale})`
    el.style.opacity = String(startO + clamped * (1 - startO))
  }

  function cleanup() {
    el.style.transform = ''
    el.style.opacity = ''
    el.style.willChange = ''
  }

  return { setProgress, cleanup }
}

/* ------------------------------------------------------------------ */
/* Staggered Fade-Up for Groups (stat items, list items)              */
/* ------------------------------------------------------------------ */

export type StaggerRevealResult = {
  setProgress: (p: number) => void
  cleanup: () => void
}

/**
 * Creates a staggered fade-up reveal for a group of elements.
 * Each element reveals at a slightly different time.
 *
 * @param els — Array of elements to stagger
 * @param options — staggerDelay, yOffset
 * @returns { setProgress, cleanup }
 */
export function createStaggerReveal(
  els: HTMLElement[],
  options?: { staggerDelay?: number; yOffset?: number }
): StaggerRevealResult {
  const delay = options?.staggerDelay ?? 0.18
  const yOff = options?.yOffset ?? 20
  const total = els.length
  const totalStaggerTime = delay * (total - 1) + 1

  let lastP = -1

  /* Set initial state */
  els.forEach((el) => {
    el.style.transform = `translateY(${yOff}px)`
    el.style.opacity = '0'
    el.style.willChange = 'transform, opacity'
  })

  function setProgress(p: number) {
    const clamped = Math.max(0, Math.min(1, p))
    if (Math.abs(clamped - lastP) < 0.01) return
    lastP = clamped

    els.forEach((el, i) => {
      const startTime = i * delay
      const localP = Math.max(
        0,
        Math.min(1, (clamped * totalStaggerTime - startTime) / 1)
      )
      const eased = 1 - Math.pow(1 - localP, 1.8)
      el.style.transform = `translateY(${(1 - eased) * yOff}px)`
      el.style.opacity = String(localP)
    })
  }

  function cleanup() {
    els.forEach((el) => {
      el.style.transform = ''
      el.style.opacity = ''
      el.style.willChange = ''
    })
  }

  return { setProgress, cleanup }
}
