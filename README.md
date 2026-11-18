# Loyalty POS System — Enterprise Restaurant Platform

A complete, **offline-first** restaurant technology platform in a single monorepo. It combines a Restaurant POS Terminal (React + Electron), an Express REST API backend (Node.js + MongoDB), a Multi-Tenant Admin Dashboard (React + Electron), and a public QR-ordering Customer Website — all sharing one data layer.

**Version:** 1.0.0  
**License:** MIT

---

## 🎯 What This Is

Loyalty POS System is a full-stack restaurant management platform built for single-location restaurants and multi-branch chains. It covers the complete restaurant operating loop:

| Capability | What It Does |
|---|---|
| **POS Terminal** | Table billing, cart management, KOT kitchen tickets, receipt printing, split payments, employee PIN login |
| **Menu Management** | Products with categories, variants, add-ons, GST slab config, per-branch availability |
| **Orders & KDS** | Dine-in / takeaway / delivery / online orders, kitchen display with delta updates, held orders |
| **Customer Loyalty** | Points, rewards, visit milestones, QR ordering, customer profiles |
| **Payments** | Cash, UPI, Card, Wallet, split payments, Razorpay integration |
| **Admin Dashboard** | Multi-tenant restaurant/owner/device/subscription management, analytics, finance, CRM |
| **Customer Website** | QR-sticker ordering site (table/car/pickup) with live order tracking |
| **Offline-First** | POS keeps working without internet; sync engine queues writes and replays on reconnect |
| **Reports & Finance** | Z-reports, daily sales, GST summaries, expense tracking, cash ledger |

---

## 🏗️ Architecture at a Glance

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CLIENT LAYER                                │
│  ┌─────────────┐  ┌─────────────────┐  ┌─────────────────────────┐ │
│ │ POS Terminal│  │ Admin Dashboard │  │   Customer QR Site      │ │
│ │ (React+Electron│ │   (React+Electron)  │   (React, HashRouter)   │ │
│ │  port 5175   │  │    port 5174    │  │       port 5177         │ │
│ └──────┬───────┘  └────────┬────────┘  └──────────┬──────────────┘ │
│        │                   │                      │                 │
│        └───────────────────┴──────────────────────┘                 │
│                              │                                        │
└──────────────────────────────┼───────────────────────────────────────┘
                               │ REST API + Socket.IO (JSON)
                               ▼
                    ┌─────────────────────────┐
                    │   EXPRESS BACKEND       │
                    │   (Node.js, port 3002)  │
                    │  Auth • Routes • Ctrl   │
                    │  Svc • Repo • Models    │
                    └───────────┬─────────────┘
                                │ Mongoose
                                ▼
                    ┌─────────────────────────┐
                    │   MONGODB               │
                    │   (Multi-tenant docs)   │
                    └─────────────────────────┘
```

**Four applications, one backend:**

| App | Folder | Framework | Dev URL | Purpose |
|---|---|---|---|---|
| Backend API | `backend/` | Node.js, Express, TypeScript | `http://localhost:3002/api` | Source of truth — auth, data, business logic |
| POS Terminal | `restaurant-pos/Frontend/` | React 19, Vite, TS, Tailwind | `http://localhost:5175` | Restaurant floor terminal (web + Electron) |
| Admin Dashboard | `admin-dashboard/` | React 19, Vite, TS, Tailwind, Electron | `http://localhost:5174` | Multi-tenant chain management portal |
| Customer Site | `customer-site/` | React, Vite, JSX | `http://localhost:5177` | Public QR ordering / loyalty portal |

---

## 🚀 Quick Start

### Prerequisites

| Tool | Minimum Version |
|---|---|
| Node.js | 22.x |
| npm | 10.x |
| MongoDB | 6.0+ (local or Atlas) |
| Git | 2.30+ |

### 1. Clone & Install

```bash
git clone <repository-url>
cd "Loyalty POS system"

# Install dependencies for root + all sub-projects
npm run install:all
```

### 2. Configure Environment

```bash
# Backend
cp backend/.env.example backend/.env

# Admin Dashboard
cp admin-dashboard/.env.example admin-dashboard/.env

# Customer Site
cp customer-site/.env.example customer-site/.env
```

Edit `backend/.env` at minimum:

```env
PORT=3002
NODE_ENV=development
MONGODB_URI=mongodb://localhost:27017/pos
JWT_SECRET=change-me-in-production
REFRESH_SECRET=change-me-in-production
CORS_ORIGIN=http://localhost:5173,http://localhost:5175
ADMIN_CORS_ORIGINS=http://localhost:5174
```

### 3. Start Everything

```bash
# Start all web dev servers concurrently
npm run dev
```

This launches:
- **Backend API** → `http://localhost:3002/api`
- **Admin Dashboard** → `http://localhost:5174`
- **POS Terminal** → `http://localhost:5175`
- **Customer Site** → `http://localhost:5177`

Or run individually:

```bash
npm run dev:backend   # Express API
npm run dev:admin     # Admin web portal
npm run dev:pos       # POS terminal
npm run dev:customer  # Customer QR site
```

### 4. First-Time Setup

1. Open the POS Terminal at `http://localhost:5175`
2. The **First-Time Setup** wizard appears — register the first **Owner** account with your restaurant details
3. Log in as Owner, then add employees, products, tables, and branches
4. Open the Admin Dashboard at `http://localhost:5174` and log in with the seeded super-admin:
   - **Username:** `admin`
   - **Password:** `1008` (seeded by backend on first start)

### 5. Run as Desktop App (Electron)

```bash
# Backend + Admin Electron + POS Electron
npm run dev:electron
```

---

## 📦 Project Structure

```
Loyalty POS system/
├── backend/                    # Express REST API (Node.js, TypeScript, MongoDB)
│   ├── src/
│   │   ├── server.ts           # Entry point
│   │   ├── config.ts           # Centralized env config
│   │   ├── db.ts               # MongoDB connection + admin seed
│   │   ├── routes/             # Route definitions (45+ route files)
│   │   ├── controllers/        # Request handlers
│   │   ├── services/           # Business logic (80+ services)
│   │   ├── models/             # Mongoose schemas (multi-tenant)
│   │   ├── middleware/         # Auth, RBAC, rate limiting, validation
│   │   ├── modules/            # Feature modules (menu-config, payments, loyalty, qr-ordering, reports, ...)
│   │   ├── cache/              # Redis response cache
│   │   ├── socket.ts           # Socket.IO real-time events
│   │   └── utils/
│   ├── .env.example            # Backend env template
│   ├── package.json
│   └── tsconfig.json
├── restaurant-pos/             # POS Terminal (React + Electron)
│   ├── Frontend/               # React SPA (port 5175)
│   │   ├── src/
│   │   │   ├── App.tsx         # Root orchestrator + workspaces
│   │   │   ├── api/client.ts   # Axios client + sync engine
│   │   │   ├── hooks/          # usePOSState, useBilling, useOrders, useLoyalty, ...
│   │   │   ├── components/     # Billing, Kitchen, Dashboard, Reports, ...
│   │   │   ├── lib/syncEngine.ts # Offline sync queue & replay
│   │   │   └── types.ts        # Shared TypeScript types
│   │   └── package.json
│   ├── electron/               # Electron desktop shell
│   └── package.json
├── admin-dashboard/            # Multi-tenant Admin Portal (React + Electron)
│   ├── src/
│   │   ├── pages/              # Dashboard, Restaurants, Owners, Devices, ...
│   │   ├── api/                # Axios clients per domain
│   │   ├── components/ui/      # Reusable UI kit
│   │   └── ...
│   ├── electron/               # Electron desktop shell
│   └── package.json
├── customer-site/              # Public QR Ordering Website (React)
│   ├── src/
│   │   ├── App.jsx             # HashRouter: Home, QR menu, Cart, Track, Receipt
│   │   ├── api.js              # Tenant-scoped Axios client
│   │   ├── socket.js           # Socket.IO live updates
│   │   └── pages/
│   └── package.json
├── package.json                # Root orchestration (concurrently, cross-env, wait-on)
└── docs/                       # Documentation (this folder)
    ├── ARCHITECTURE.md         # Full system architecture
    └── API_REFERENCE.md        # REST API endpoint reference
```

---

## 📚 Documentation

| Document | Description |
|---|---|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | System architecture, data flow, module map, deployment |
| [API_REFERENCE.md](docs/API_REFERENCE.md) | All REST endpoints, auth scheme, error format |
| `backend/CONTRIBUTING.md` | Backend contribution & dev guidelines |
| `restaurant-pos/README.md` | POS terminal deep-dive |
| `admin-dashboard/README.md` | Admin dashboard deep-dive |
| `customer-site/README.md` | Customer QR site deep-dive |

---

## 🛠️ Available Scripts (Root)

| Script | Description |
|---|---|
| `npm run install:all` | Install root + all sub-project dependencies |
| `npm run dev` | Start all 4 web dev servers concurrently |
| `npm run dev:backend` | Backend API only (`http://localhost:3002/api`) |
| `npm run dev:admin` | Admin dashboard web only (`http://localhost:5174`) |
| `npm run dev:pos` | POS terminal web only (`http://localhost:5175`) |
| `npm run dev:customer` | Customer site web only (`http://localhost:5177`) |
| `npm run dev:electron` | Backend + Admin Electron + POS Electron |
| `npm run build` | Production build for all sub-projects |
| `npm run test` | Backend + POS frontend unit tests |
| `npm run test:backend` | Backend unit tests (Vitest) |
| `npm run test:frontend` | POS frontend unit tests (Vitest) |
| `npm run lint` | POS frontend type check (`tsc --noEmit`) |
| `npm run test:security` | Security audit for backend + frontend |

---

## 🔐 Authentication & Security

- **JWT access tokens** + **refresh tokens** for all authenticated clients
- **Role-based access control (RBAC)**: Owner, Manager, Cashier — permissions configurable per role
- **Multi-tenancy**: All data scoped by `restaurantId` (+ optional `branchId`)
- **Rate limiting**: Per-IP and per-account windows on auth, public, API, admin, voice, and intelligence routes
- **Brute-force protection**: Account backoff on repeated login failures
- **Super-admin seeding**: Backend auto-seeds `admin` / `1111` on first start for platform access

---

## 🔌 Key Features Deep-Dive

### POS Terminal (Offline-First)
- **Product grid** with category search, quick-fire mode, variant/add-on selection
- **Cart panel** with live totals, GST calculation, discounts, split payments
- **KOT kitchen tickets** with delta detection, original/additional/reprint variants
- **Table floor plan** with color-coded status, drag interactions, guest management
- **Customer calls / waiter bell** with live badge, sound reminders, acknowledgment flow
- **Offline operation**: localStorage cache + `syncEngine` queues failed writes, replays on reconnect
- **Keyboard shortcuts**: F1–F12 workspace navigation, Ctrl+K (KOT), Ctrl+P (payment), Ctrl+H (hold), etc.
- **Electron desktop shell** with auto-lock, guided tour, thermal printer support

### Admin Dashboard (Multi-Tenant)
- **Restaurant CRUD**: create, suspend, activate, branch management
- **Owner lifecycle**: CRUD, password reset, activate/deactivate, device block/unblock
- **Device management**: POS terminal registry, remote block/approve/reject
- **Subscriptions & plans**: trial, grace, renew, upgrade/downgrade, pause/resume
- **Analytics**: dashboard stats, growth, churn, device activity, subscription revenue
- **Finance & reports**: P&L, expenses, cash ledger, GST, sales summaries, closing Z
- **Support**: ticket management with attachments, replies, satisfaction ratings
- **Audit logs**: integrity verification, retention, legal holds, saved searches, alerts

### Customer QR Site
- **QR sticker URLs**: `/{slug}/qr/{token}` for table / car / pickup modes
- **Menu browsing** with item customization, cart, Razorpay pay-now
- **Live order tracking** via Socket.IO
- **Receipt landing page** per receipt token
- **Single build serves all tenants** — URL determines restaurant + ordering mode

---

## 🧪 Testing

```bash
# All tests (backend + frontend)
npm run test

# Backend only
npm run test:backend

# POS frontend only
npm run test:frontend

# Security audit
npm run test:security
```

Backend tests run with **Vitest** against `mongodb-memory-server` (no real MongoDB needed).  
POS frontend tests run with **Vitest** + **React Testing Library**; E2E with **Playwright**.

---

## 📄 License

MIT License. See [LICENSE](LICENSE) for details.

---

*Built for interview submission — documentation designed for quick onboarding. See `docs/ARCHITECTURE.md` for the full technical picture and `docs/API_REFERENCE.md` for endpoint details.*