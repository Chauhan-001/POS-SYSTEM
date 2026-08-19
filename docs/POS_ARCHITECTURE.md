# POS_ARCHITECTURE.md — POS Terminal Architecture

## Overview

The POS terminal (`restaurant-pos/Frontend`) is a React 19 + Vite application
built for fast touch-screen and keyboard interaction, optionally wrapped in
the Electron shell (`restaurant-pos/electron/`) for kiosk/desktop use.

Entry: `src/main.tsx` → `src/App.tsx`. State lives in custom hooks
(`usePOSState`, `useBilling`, `useOrders`, `useLoyalty`, `useAuth`,
`useKeyboardShortcuts`). Data flows through `src/api/client.ts` to the
backend; a `localStorage` cache plus `src/lib/syncEngine.ts` provide offline
tolerance.

---

## 1. Workspaces

URL ↔ workspace mapping lives in `src/routes.ts`. Active workspaces include:

- **Dashboard** — KPIs, daily summary, AI insights, weather tips
- **Orders** — floor plan, tables, takeaway queue, online orders
- **Billing** — product grid, cart, variant/add-on config modal, discounts,
  tax, payment, receipt
- **Products** — catalog management + the guided registration wizard
  (`components/menu/ProductRegistrationWizard.tsx`)
- **Kitchen (KDS)** — live KOT tickets with statuses and delta tracking
- **Inventory** — stock, purchases, recipes, voice inventory
- **Customers / Loyalty** — customer lookup, points, rewards
- **Offers / Marketing** — offers, promotions, studio, business advisor
- **Reports / Analytics / Finance** — sales, P&L, expense, cashier reports
- **Staff / Branches / Settings** — administration
- **QR Studio** — table QR sticker generation
- **Menu Availability** — online ordering toggles

## 2. Billing Flow

1. Cashier selects a product from the grid.
2. If the product has configuration (variants/add-ons/customizations), an
   adaptive modal opens: variant → add-ons → customizations → Add to Bill.
   Simple products add directly.
3. Line total = effective variant price + add-on prices (deterministic
   `pricingEngine`; no base+variant math).
4. Cart panel shows configuration summary, GST, and per-line edit.
5. Discounts (per-line or manual), tax (per product rate), payment, and
   receipt generation (`ThermalReceipt.tsx`) follow.

## 3. Product Registration Wizard

`components/menu/ProductRegistrationWizard.tsx`:

```
Basic Details → Price & Variants → Add-ons & Customizations → Recipe → Review & Register
```

- Category creation works even with zero categories (auto-select, no page
  refresh).
- Variant prices are the selling price (no base-price stacking); reusable
  groups can be shared or copied.
- Add-ons/customizations reuse the same menu-config templates.
- Recipe optional (manual, voice, or skip), deterministic cost + margin.
- Tax: automatic recommendation from Settings tax rules, with manual/custom
  override (see ARCHITECTURE.md §7.2).

## 4. Keyboard Shortcuts

`src/hooks/useKeyboardShortcuts.ts`: F1 (search), F2 (customer phone),
F8 (hold), F9 (quick checkout), F10, Escape, plus workspace hotkeys.
Electron supports F11 fullscreen.

## 5. Thermal Printing

`components/ThermalReceipt.tsx` renders the 58/80mm receipt (header, items,
multi-slab GST SUMMARY, loyalty QR, footer). Printing goes through the
Electron `printer:print` IPC channel or the browser print path. A WYSIWYG
preview lives in Settings with mixed-slab demo data.
