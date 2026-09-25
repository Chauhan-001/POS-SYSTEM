# Loyalty POS System — Enterprise Monorepo

Welcome to the **Loyalty POS Monorepo**. This system provides a full-featured, offline-tolerant Restaurant POS Terminal, Express REST API Backend, Multi-Tenant Admin Web Portal, and a public QR-ordering customer website.

---

## 🚀 Quick Start

### 1. Installation
Install all dependencies across backend, desktop POS, and admin dashboard:
```bash
npm run install:all
```

### 2. Running Dev Environment
Start all services in development mode:
```bash
# Run web dev servers concurrently (Backend + Admin Portal + POS Frontend)
npm run dev

# Run Electron Desktop environment concurrently (Backend + Admin Portal + Desktop POS)
npm run dev:electron
```

| Service | Package | Dev URL | Notes |
|---|---|---|---|
| Backend API | `backend/` | http://localhost:3002/api | Express + MongoDB |
| Admin Dashboard | `admin-dashboard/` | http://localhost:5174 | Web + Electron shell |
| POS Frontend | `restaurant-pos/Frontend/` | http://localhost:5175 | Vite dev server |
| Customer QR Site | `customer-site/` | http://localhost:5177 | QR ordering / loyalty |

---

## 📁 Repository Structure

```
loyalty-pos-system/
├── backend/                 # Express REST API (routes → controllers → services → models)
│   ├── src/
│   │   ├── routes/          # Endpoint definitions (one file per domain)
│   │   ├── controllers/     # Request handlers
│   │   ├── services/        # Business logic
│   │   ├── models/          # Mongoose schemas
│   │   ├── middleware/      # Auth, rate-limit, validation, errors
│   │   ├── validation/      # Zod schemas
│   │   ├── modules/         # Feature modules (menu-config, qr-ordering, promotions, …)
│   │   └── utils/           # Shared helpers
│   ├── scripts/             # Migrations, seeding, backup/restore drills
│   └── docs/                # Backend-specific docs (e.g. formulasThresholds.md)
├── restaurant-pos/          # Desktop POS terminal
│   ├── Frontend/
│   │   └── src/
│   │       ├── components/  # Feature-grouped UI (auth, billing, orders, floor,
│   │       │                # customers, catalog, inventory, marketing, analytics,
│   │       │                # settings, qr, dashboard, layout, modals, shared)
│   │       ├── hooks/       # React hooks (POS state, auth, billing, …)
│   │       ├── lib/         # Engines (pricing, sync, tax)
│   │       ├── utils/       # Pure helpers (KOT delta, order merge, …)
│   │       ├── api/         # Backend client + axios instance
│   │       ├── core/        # Cross-cutting stores (auth token store)
│   │       ├── qr/          # QR generation/rendering
│   │       └── demo/        # Guided-tour/demo engine
│   └── electron/            # Desktop shell (main.ts, preload.ts → compiled locally)
├── admin-dashboard/         # Multi-tenant admin portal (React + Electron shell)
│   └── src/                 # pages/ + components/ + api/ + context/ …
└── customer-site/           # Public QR ordering & loyalty portal (React + Vite, JSX)
    └── src/                 # pages/ + components/ + context/ + lib/
```

Per-app docs: [`restaurant-pos/README.md`](restaurant-pos/README.md), [`admin-dashboard/README.md`](admin-dashboard/README.md), [`customer-site/README.md`](customer-site/README.md), [`backend/CONTRIBUTING.md`](backend/CONTRIBUTING.md).

---

## 🛠️ Tech Stack

- **POS Frontend**: React 19, Vite 6, TypeScript, Tailwind CSS, Lucide Icons
- **Admin Dashboard**: React 19, Vite, TypeScript, Electron
- **Customer Site**: React, Vite, JavaScript (JSX)
- **Desktop Shell**: Electron (POS + Admin)
- **Backend**: Node.js, Express, TypeScript, MongoDB / Mongoose, Socket.IO
- **Tooling**: Concurrently, Cross-Env, Vitest, Playwright, ESLint

---

## 🔑 Key Architecture Notes

- **Backend is the source of truth** for all persistent data (products, customers, employees, settings, bills, orders, inventory). The POS keeps a localStorage cache for resilience and offline tolerance; the `syncEngine` queues failed writes and replays them when connectivity returns.
- **Multi-tenant**: resources are scoped by `restaurantId` (+ optional `branchId`).
- **Configured ordering**: reusable variant / add-on / customization groups (`menu-config` module) are consumed identically by product registration and billing.
- **Tax**: per-product `gstPercent` with classification-based automatic recommendation; bills snapshot per-line tax so historical receipts stay correct; multi-slab receipts show a grouped GST SUMMARY.
