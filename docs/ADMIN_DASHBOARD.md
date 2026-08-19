# ADMIN_DASHBOARD.md — Admin Web Portal Architecture

## Overview

The `admin-dashboard` is the platform super-admin portal: React 19 + Vite
(TypeScript), optionally wrapped in an Electron shell
(`admin-dashboard/electron/`). It manages the fleet of restaurants, owners,
devices, subscription plans, subscriptions, and platform settings — talking to
`/api/admin/*` backend routes.

Dev URL: http://localhost:5174 (Vite). Production: packaged Electron or static
web build.

---

## 1. Directory Blueprint

- `src/pages/` — Restaurants, RestaurantDetails, Subscriptions,
  SubscriptionPlans, Devices, Usage, Settings, Auth/Admin login.
- `src/api/` — REST client for `/api/admin/*`.
- `src/layouts/` — Shell/nav.
- `src/routes/` — Router config.
- `electron/` — `main.ts` + `preload.ts` (updates, printing, dialogs,
  notifications — see ELECTRON.md).

## 2. What It Manages

- **Restaurants** — list/detail, onboarding status, plans, owners.
- **Subscriptions & Plans** — plan definitions, entitlements (`features[]`),
  trial/expiry, additional feature grants.
- **Owners & Devices** — owner accounts, registered POS devices,
  authorization.
- **Usage** — AI quota usage, STT cost tracking, per-key quota cards.
- **Settings & Security** — platform settings, audit trail, legal docs
  publication.

## 3. Electron Shell

Auto-updates (`check-for-updates`, `quit-and-install`), file dialogs, printing,
and OS notifications via contextBridge IPC. Security posture matches the POS
shell (contextIsolation, sandbox).

See [ARCHITECTURE.md](ARCHITECTURE.md) for the backend modules it consumes
(`adminReports`, `subscription`, `audit`, `legal`, `help-analytics`).
