# STATE_MANAGEMENT.md — POS State Architecture & Custom Hooks

## Overview

The POS terminal frontend relies on a clean, composition-based React state architecture powered by custom hooks in `src/hooks/`.

---

## 1. Core State Hooks

```
                   +-------------------+
                   |     App.tsx       |
                   +---------+---------+
                             |
         +-------------------+-------------------+
         |                   |                   |
         v                   v                   v
  +--------------+    +--------------+    +--------------+
  |  useAuth     |    | usePOSState  |    |  useBilling  |
  +--------------+    +--------------+    +--------------+
  - Current Employee - Active Workspace  - Cart Items
  - Role Rights      - Products/Category - Subtotal/Discounts
  - Auth Token       - Active Order      - Tax Calculations
```

### A. `useAuth` (`src/hooks/useAuth.ts`)
- Manages authentication state, token storage in LocalStorage, employee session object, and role-based permissions check.

### B. `usePOSState` (`src/hooks/usePOSState.ts`)
- Manages active workspace selection, product list, category filters, branch selectors, modal toggle states, and drawer open/close flags.

### C. `useBilling` (`src/hooks/useBilling.ts`)
- Encapsulates cart manipulation logic: adding items, variant selection, updating quantities, manual discount calculation, tax calculation, and resetting cart after payment.

### D. `useWindowResize` (`src/hooks/useWindowResize.ts`)
- Listens to Electron IPC resize events and maintains 100% viewport container sizing across window resize/maximize/fullscreen transitions.
