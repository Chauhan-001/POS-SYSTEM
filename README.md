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

## 📁 Documentation Map

- 🏗️ **[ARCHITECTURE.md](docs/ARCHITECTURE.md)**: Authoritative system architecture (all applications).
- 🏪 **[POS_ARCHITECTURE.md](docs/POS_ARCHITECTURE.md)**: POS terminal, billing, orders, KDS.
- 🤖 **[AI_ARCHITECTURE.md](docs/AI_ARCHITECTURE.md)**: AI, voice, recommendations, deterministic engines.
- 📊 **[ADMIN_DASHBOARD.md](docs/ADMIN_DASHBOARD.md)**: Admin web portal & Electron shell.
- 🌐 **[CUSTOMER_WEBSITE.md](docs/CUSTOMER_WEBSITE.md)**: Customer QR ordering & loyalty portal.
- 🔌 **[API_REFERENCE.md](docs/API_REFERENCE.md)**: Express REST API endpoints.
- 🗄️ **[DATABASE_SCHEMA.md](docs/DATABASE_SCHEMA.md)**: MongoDB collections & models.
- 🖥️ **[ELECTRON.md](docs/ELECTRON.md)**: Desktop process lifecycle & IPC channels.
- 📄 **Per-app docs**: `restaurant-pos/docs/`, `admin-dashboard/docs/`, `backend/CONTRIBUTING.md`, `customer-site/README.md`.

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

See [ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full picture.
