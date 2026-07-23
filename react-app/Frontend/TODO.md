# Multi-Brand Premium Restaurant Website - Implementation Plan

## Phase 1: Foundation Setup
- [x] Copy assets from `react-app/assets/` to `react-app/Frontend/public/assets/`
- [x] Install `lenis` and `framer-motion`
- [x] Update `index.css` with new font-face declarations (Clash Display, Plus Jakarta Sans, Bricolage Grotesque) and new color palette
- [x] Update `vite.config.ts` to configure asset paths

## Phase 2: Create Directories
- [x] Create `src/sections/`, `src/hooks/`, `src/animations/`

## Phase 3: Build Reusable Hooks & Animations
- [x] `src/hooks/useSmoothScroll.ts` - Lenis integration
- [x] `src/hooks/useParallax.ts` - Reusable parallax
- [x] `src/hooks/useScrollReveal.ts` - GSAP + ScrollTrigger reveal
- [x] `src/animations/heroLogoEntrance.ts` - Logo entrance timeline
- [x] `src/animations/productPathAnimation.ts` - Curved path motion
- [x] `src/animations/microInteractions.ts` - Steam, float, drift

## Phase 4: Build Sections (one by one)
- [x] `src/sections/LogoHero.tsx` - 3-brand logo entrance
- [x] `src/sections/ProductScrollStory.tsx` - Vada Pav + Chai curved path pinned story
- [x] `src/sections/BrandStory.tsx` - Brand narrative (Where Every Sip Meets Every Bite)
- [x] `src/sections/StatsSection.tsx` - Animated counters
- [x] `src/sections/MenuPreview.tsx` - Product showcase (Eatables + Thirst Quenchers carousels)
- [x] `src/sections/FooterSection.tsx` - Footer

## Phase 5: Update App & Create LandingPage
- [x] Rewrite `src/pages/LandingPage.tsx` - Compose all 6 sections modularly
- [x] Update `src/App.tsx` if needed

## Phase 6: Test
- [ ] Run `npm run dev` and verify
- [ ] TypeScript type-check: `npx tsc -b --noEmit`
- [ ] Lint: `npm run lint`
