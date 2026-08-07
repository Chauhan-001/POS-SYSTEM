# CODEBASE_MAP.md — Loyalty POS System Navigation Guide

Welcome to the **Loyalty POS Monorepo** navigation map. This document serves as the master blueprint and developer guide for navigating, understanding, and maintaining the codebase.

---

## 1. Project Directory Tree

```
Loyalty_POS_system/
├── backend/                        # Node.js + Express + TypeScript + MongoDB API Service
│   ├── src/
│   │   ├── config.ts               # Environment configuration & MongoDB connection
│   │   ├── controllers/            # Request handlers (Auth, Billing, Inventory, Loyalty, etc.)
│   │   ├── middleware/             # Express middlewares (Auth JWT, Error Handler, Rate Limiter)
│   │   ├── models/                 # Mongoose Data Schemas (User, Bill, Product, Customer, etc.)
│   │   ├── repositories/           # Data access layer
│   │   ├── routes/                 # Express API Route declarations
│   │   ├── services/               # Business logic layer
│   │   ├── utils/                  # Helper utilities (Tokens, Hashes, Formatters)
│   │   ├── validation/             # Joi / Zod input validation schemas
│   │   ├── seed.ts                 # Database seed script for default data
│   │   └── server.ts               # Express server initialization & lifecycle
│   ├── package.json
│   └── tsconfig.json
│
├── restaurant-pos/                  # Electron Desktop POS Terminal + React Frontend
│   ├── electron/                   # Electron Main Process
│   │   ├── main.ts                 # Window creation, IPC handlers, Kiosk mode
│   │   ├── preload.ts              # ContextBridge IPC exposure to Renderer
│   │   ├── electron-builder.json   # Desktop app build configuration
│   │   └── package.json
│   └── Frontend/                   # React + Vite + TypeScript Renderer Application
│       ├── components/             # UI Components & Feature Workspaces
│       │   ├── BillingProductGrid.tsx  # Product catalog grid with category filters
│       │   ├── CartPanel.tsx           # Cart sidebar, total calculation, payment selection
│       │   ├── CartItemRow.tsx         # Item row with quantity adjustments & notes
│       │   ├── OrderManager.tsx        # Table layout, Takeaway, Online order management
│       │   ├── KitchenDisplay.tsx      # Real-time KOT status board
│       │   ├── ProductManager.tsx      # Product catalog CRUD & variant configuration
│       │   ├── CustomerManager.tsx     # Loyalty customer database & points tracker
│       │   ├── ReportsManager.tsx      # Sales reports & analytics export
│       │   ├── StaffManager.tsx        # Employee accounts & role-based permissions
│       │   ├── SettingsManager.tsx     # Terminal & store system configuration
│       │   ├── BranchManager.tsx       # Multi-branch sync & central management
│       │   ├── AppTitleBar.tsx         # Top desktop header with clock & network status
│       │   ├── AppSidebar.tsx          # Navigation drawer for POS workspaces
│       │   └── inventory/              # Detailed stock & supplier management
│       └── src/
│           ├── App.tsx             # Root component & state composition
│           ├── main.tsx            # Entry point mounting React DOM
│           ├── index.css           # Global Tailwind CSS & 100% viewport layout rules
│           ├── types.ts            # Centralized TypeScript interfaces
│           ├── routes.ts           # POS workspace route mapping
│           ├── data.ts             # Local DB (IndexedDB / LocalStorage) persistence layer
│           ├── ai/                 # Voice & AI assistant modules
│           ├── api/                # Axios / fetch client for Backend sync
│           ├── hooks/              # Custom React hooks (useBilling, usePOSState, etc.)
│           ├── lib/                # Sync engine & local cache manager
│           └── utils/              # Calculation & formatting helpers
│
└── admin-dashboard/                # Central Admin Web Portal (React + Vite + Tailwind)
    ├── src/
    │   ├── api/                    # API clients for multi-tenant backend management
    │   ├── components/             # Reusable UI widgets & data tables
    │   ├── context/                # AuthContext & SystemContext
    │   ├── layouts/                # Admin sidebar & navbar layouts
    │   ├── pages/                  # Super-Admin pages (Restaurants, Subscriptions, System Health)
    │   ├── routes/                 # React Router definitions
    │   └── services/               # Admin management services
    ├── package.json
    └── vite.config.ts
```

---

## 2. Important System Flows

### A. Electron Desktop Startup Flow
1. User launches application executable or `npm run dev:electron`.
2. `restaurant-pos/electron/main.ts` initializes:
   - Configures `BrowserWindow` with native resolution matching.
   - Attaches IPC listeners (`window:resize`, `window:toggleFullScreen`, `window:toggleFrame`).
   - Loads Vite development URL (`http://localhost:5173`) or static bundle (`dist/index.html`).
3. `restaurant-pos/Frontend/src/main.tsx` mounts `<App />`.
4. `useWindowResize` hook binds Electron IPC events and enforces responsive `100%` container height.

### B. Employee Login & Session Initialization
1. If no authenticated session exists, `<LoginScreen />` displays.
2. User enters User ID / Passcode (e.g. `1008`).
3. App validates credentials locally or against `backend/src/controllers/authController.ts`.
4. Employee session and role permissions are loaded into state.
5. User navigates to the active workspace (`Billing`, `Orders`, `Inventory`, etc.).

### C. Billing & Checkout Flow
1. Cashier selects products from `<BillingProductGrid />` or scans barcode.
2. Product with quantity, modifiers, and variants is added to cart state via `useBilling` hook.
3. `<CartPanel />` computes:
   - Subtotal (`calculateCartSubtotal()`)
   - Manual & Reward Discounts (`calculateCartDiscount()`)
   - GST / Taxes (`calculateCartTaxes()`)
   - Grand Total (`calculateCartGrandTotal()`)
4. Cashier selects Payment Method (`Cash`, `UPI`, `Card`, `Split`) and Order Type (`Dine In`, `Takeaway`).
5. Clicking **KOT** sends order to Kitchen Display (`<KitchenDisplay />`) and updates order status.
6. Clicking **Pay** triggers `<PaymentConfirmModal />`, prints receipt via standard/thermal print pipeline, and records sale in local IndexedDB + queued backend sync buffer.

### D. Offline Buffer & Backend Sync Flow
1. All orders and billing transactions are written instantly to local storage via `src/data.ts`.
2. `src/lib/syncEngine.ts` monitors network status (`navigator.onLine`).
3. When connected, buffered transactions are pushed asynchronously to `/api/bills/sync`.
4. Backend verifies transaction signatures, updates MongoDB, and acknowledges sync status.

---

## 3. Extension & Developer Guidelines

- **Adding New Features**: Place component files in appropriate subdirectories under `components/` or `features/`.
- **State Management**: Keep local workspace state scoped within dedicated hooks in `src/hooks/`.
- **API Endpoints**: Add new backend routes under `backend/src/routes/` and corresponding controller handlers in `backend/src/controllers/`.
