# ARCHITECTURE.md — Authoritative System Architecture

> This is the single authoritative architecture document for the Loyalty POS
> Monorepo. It describes what the application **actually does today**. If any
> other document contradicts this one, this document wins — and the other
> document should be updated.

---

## 1. System Overview

The **Loyalty POS System** is a multi-tenant restaurant management platform
composed of four applications sharing one backend:

| Application | Path | Role |
|---|---|---|
| **Backend API** | `backend/` | Express REST + Socket.IO server, MongoDB persistence, all business logic |
| **POS Terminal** | `restaurant-pos/Frontend/` | The cashier-facing React POS (billing, orders, KDS, inventory, reports). Electron shell in `restaurant-pos/electron/` |
| **Admin Dashboard** | `admin-dashboard/` | Super-admin web portal for restaurants, owners, subscriptions, devices, plans. Electron shell in `admin-dashboard/electron/` |
| **Customer Site** | `customer-site/` | Public QR-ordering + loyalty website, one build serves every tenant |

The backend is the **source of truth** for all persistent data. The POS
maintains a local `localStorage` cache for fast startup and offline tolerance;
a `syncEngine` queues failed writes and replays them when connectivity
returns. There is **no IndexedDB** — local persistence is localStorage.

---

## 2. Repository Structure

```
.
├── backend/                  # Express + MongoDB API (TypeScript)
│   ├── src/
│   │   ├── server.ts         # Entry point — mounts routes, middleware, socket
│   │   ├── config.ts         # Environment config (port, CORS, AI, STT…)
│   │   ├── routes/           # Express routers (auth, products, orders, bills…)
│   │   ├── controllers/      # Request handlers
│   │   ├── services/         # Business logic (bill, order, loyalty, finance…)
│   │   ├── models/           # Mongoose models (70+ collections)
│   │   ├── middleware/       # auth, authorization, validate, rateLimiter…
│   │   ├── validation/       # Zod schemas
│   │   ├── modules/          # Feature domains (see §6)
│   │   ├── utils/            # Helpers (AppError, bcrypt, publicToken…)
│   │   ├── constants/        # planFeatures, marketingStates…
│   │   └── types/            # Ambient typings (pdfkit.d.ts…)
│   ├── scripts/              # Maintenance / audit scripts (tsx)
│   └── package.json
│
├── restaurant-pos/
│   ├── Frontend/             # POS React app
│   │   ├── src/              # App, hooks, api client, lib, utils, types
│   │   ├── components/       # Workspaces & feature components (60+)
│   │   │   ├── menu/         # Product registration wizard, config editor
│   │   │   └── marketing/    # Offers, promotions, studio, advisor
│   │   ├── e2e/              # Playwright specs + screenshots
│   │   └── vite.config.ts    # Port 5175, proxies /api → :3002
│   └── electron/             # Electron main/preload (kiosk, printing)
│
├── admin-dashboard/
│   ├── src/                  # React admin portal
│   │   ├── pages/            # Restaurants, Subscriptions, Plans, Settings…
│   │   ├── api/              # Admin REST client
│   │   └── layouts/          # Shell/nav
│   └── electron/             # Electron main/preload (updates, printing)
│
├── customer-site/            # Public QR ordering site (React, JSX)
│   ├── src/
│   │   ├── pages/            # Home, Menu, Cart, Track, Receipt
│   │   └── context/          # SessionContext (QR → session)
│   └── vite.config.js        # Port 5177
│
├── docs/                     # Repository documentation (this file is root)
└── package.json              # Root orchestration scripts
```

---

## 3. Application Architecture

### 3.1 POS Terminal (`restaurant-pos/Frontend`)

- **Entry**: `src/main.tsx` → `src/App.tsx` (root orchestrator).
- **State**: custom hooks — `usePOSState` (central workspace state),
  `useBilling` (cart & payments), `useOrders` (orders, KOT, tables),
  `useLoyalty`, `useAuth`, `useKeyboardShortcuts`, `useNotifications`.
- **API layer**: `src/api/client.ts` (Axios) + `src/api/axios.ts` (interceptor,
  refresh token, offline queue hooks).
- **Data**: `src/data.ts` documents the cloud-vs-local strategy (backend
  source of truth, localStorage write-through cache, syncEngine retry queue).
- **Routing**: workspace names ↔ URL paths via `src/routes.ts`.
- **Workspaces**: Dashboard, Orders, Billing, Products, Customers, Offers,
  Reports, Staff, Branches, Settings, Inventory, Kitchen (KDS), Marketing,
  Analytics, Finance, Reservations, Expenses, QR Studio, Menu Availability,
  Receipt History.

### 3.2 Backend (`backend`)

Express + Mongoose + Socket.IO. See §4–§6.

### 3.3 Admin Dashboard (`admin-dashboard`)

React + Vite web app, optionally wrapped in Electron. Talks to `/api/admin/*`
routes. Pages cover restaurant management, owners, devices, subscription
plans, subscriptions, usage, settings, and platform reports.

### 3.4 Customer Website (`customer-site`)

A single React build serves **every tenant**. URL shape:

```
/{tenant-slug}/qr/{token}
  e.g. /hungrybolt/qr/hb-t1       → table (dine-in)
       /hungrybolt/qr/hb-car-p1   → car / drive-in
       /hungrybolt/qr/hb-pickup   → pickup
```

The app reads `slug` + `token` from the URL, pins `slug` onto every API call
(`src/api.js`), and the backend scopes all data to that tenant. Also hosts the
digital receipt page (`/r/:token`) and loyalty landing.

---

## 4. Data Flow

```
POS UI (React) ──> api/client.ts (Axios) ──> Express routes ──> services ──> MongoDB
     │                                                              ▲
     └── localStorage cache (read-through, write-through)           │
         syncEngine offline queue (POST/PUT/DELETE replay) ─────────┘

Customer Site ──> /api/public-store/* ──> services ──> MongoDB
Admin Dashboard ──> /api/admin/* ──> admin services ──> MongoDB
Socket.IO ──> live events (orders, KOT, tables, sync status)
```

---

## 5. Backend Architecture

### 5.1 Middleware pipeline (`backend/src/middleware/`)

- `authMiddleware` — JWT bearer verification
- `authorizationMiddleware` — role checks (Owner / Manager / Cashier / Kitchen / Waiter)
- `validate` — Zod schema validation
- `rateLimiter` — per-route + per-key rate limiting (login backoff)
- `subscriptionMiddleware` — plan feature gating
- `securityHeaders`, `ipBlocklist`, `requestLogger`, `errorHandler`

### 5.2 Authentication

- POS/staff login: `POST /api/auth/login` — accepts `username` + `password`,
  `mode` ∈ `password | pin | role_pin` (Zod `loginSchema`).
- Refresh flow: `POST /api/auth/refresh` (refresh token + deviceId → new JWT);
  `POST /api/auth/logout` invalidates the refresh token.
- Admin login: `POST /api/auth/admin/login` with `userId` + `password`
  (`adminLoginSchema`), per-account exponential backoff.
- Passwords/PINs are bcrypt-hashed (`utils/bcrypt.ts`).

### 5.3 Routes (mounted in `server.ts`)

Public / auth:
- `/api/auth/*`, `/api/sessions`, `/api/otp`

Core domain:
- `/api/products`, `/api/orders`, `/api/bills`, `/api/customers`,
  `/api/employees`, `/api/branches`, `/api/tables`, `/api/floors`,
  `/api/takeaway-orders`, `/api/held-orders`, `/api/reservations`,
  `/api/availability`

Finance & ops:
- `/api/expenses`, `/api/expense-categories`, `/api/vendors`,
  `/api/recurring-expenses`, `/api/cash-ledger`, `/api/finance`,
  `/api/reports`, `/api/purchases`, `/api/inventory-events`,
  `/api/suppliers`, `/api/customer-reports`

Loyalty & marketing:
- `/api/loyalty`, `/api/rewards`, `/api/referrals`, `/api/campaigns`,
  `/api/automations`, `/api/offers`, `/api/advisor`, `/api/promotions`

Configuration & platform:
- `/api/settings`, `/api/menu-config`, `/api/qr-ordering`, `/api/qr-tokens`,
  `/api/devices`, `/api/sync`, `/api/media`

Public (rate-limited):
- `/api/public-store/*` (customer ordering), `/api/public-store/receipt`,
  `/api/legal`, `/api/help-analytics`

AI & voice:
- `/api/ai/*`, `/api/voice-inventory/*`

Admin:
- `/api/admin/*` (via `adminRouter` + `adminReportsRouter`)

### 5.4 Feature modules (`backend/src/modules/`)

- `menu-config` — reusable configuration templates (variant/add-on/customization
  groups), resolver, validator, deterministic pricing engine, catalog service.
- `recipes` — recipe CRUD, AI quick-create, cost settings, consumption.
- `voice-inventory` — product resolution engine, pending actions, STT provider
  manager, purchase rate.
- `qr-ordering` — QR tokens, sessions (with expiry sweeper), table occupancy.
- `public-store` — customer-facing ordering/receipt services.
- `promotions` — promotion rules & service.
- `reports` / `adminReports` — sales, product, closing-summary, admin aggregations.
- `settings` — tenant-scoped settings with version history + rollback + audit.
- `subscription` — plans, entitlements, subscription middleware.
- `payment` — Razorpay integration.
- `ai` — provider abstraction, prompts, STT, voice parse.
- `audit` — audit log + export service.
- `legal` — legal document management + acceptance recording.
- `help-analytics` — help view tracking.
- `media` — uploads/multer.

### 5.5 Services (business logic, `backend/src/services/`)

~60 services cover: billing (`billService`), orders, products, customers,
loyalty, rewards, finance, expenses, cash ledger, inventory events, stock
movement, purchases, suppliers, vendors, recipes, reservations, tables/table
state, takeaway, held orders, KOT cancellation sync, refunds, devices, sync,
delivery, OTP, sessions, referrals, campaigns (queue + scheduler), marketing
(scheduler), automations, offers (engine + validation + analytics), advisor,
combo health, festival service, price intelligence, recommendation context,
support tickets, analytics/AI analytics, plan, owner, restaurant, entitlement,
fact consistency, etc.

---

## 6. Database Architecture

MongoDB (Mongoose). Collection list (`backend/src/models/`, 70+):

`AIUsageLog, AdvisorRecommendation, AiQuotaSnapshot, AuditLog, Authorization,
Bill, BillItem, BlockedIp, Branch, BranchSettings, Campaign, CampaignHistory,
CashLedger, CouponRedemption, Customer, CustomerActivity, CustomerSegment,
CustomerVisit, DailySummary, Device, DeviceActivity, Employee, Expense,
ExpenseCategory, FinanceSettings, Floor, HeldOrder, InventoryEvent, Invoice,
InvoiceCounter, KOTRecord, License, LoyaltySettings, LoyaltyTier,
LoyaltyTransaction, MarketingAutomation, MenuAvailability, MonthlySummary,
Offer, OfferAnalytics, Order, OrderAdjustment, OrderCounter, OrderItem,
OtpRequest, Payment, Product, ProductVariant, Purchase, ReceiptFeedback,
RecurringExpense, Referral, RefreshToken, RefundRecord, Reservation,
Restaurant, Reward, Settings, Subscription, SubscriptionPlan, Supplier,
SupportTicket, Table, TakeawayOrder, TicketCounter, TicketReply, TimelineEvent,
User, Vendor, WaitingEntry, WebhookEvent, YearlySummary`

Key scoping: most resources carry `restaurantId` (tenant) and optionally
`branchId`. See [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) for detail.

---

## 7. Billing & Tax Architecture

### 7.1 Product configuration

- Products reference **reusable configuration templates** (menu-config):
  variant groups, modifier (customization) groups, add-on groups. Modes:
  `shared` (reference), `copy` (independent copy), `override` (inherit +
  deltas).
- The registration wizard (`ProductRegistrationWizard.tsx`) walks
  Basic Details → Price & Variants → Add-ons & Customizations → Recipe →
  Review & Register. Variant prices are the **effective selling price**
  (base price is 0 for variant-driven dishes — there is no
  "base + variant" math).
- Billing consumes the same resolved configuration: a configured product
  opens an adaptive modal (variant → add-ons → customizations) and the
  deterministic `pricingEngine` computes the line total.

### 7.2 Tax

- Each product carries `gstPercent` (+ `taxClassification`,
  `taxSource` for auditability).
- **Tax Rules by Classification** (`settings.taxRules`) maps
  `prepared_food / beverage / packaged / other` → GST rate; defaults are
  5 / 5 / 12 / null (null ⇒ requires confirmation). Registration auto-recommends
  from the rule; the owner can override or enter a custom rate.
- Billing computes per-line tax using the product's rate at sale time;
  line items snapshot `priceAtSale`, `gstRateAtSale`, `discountAtSale` so
  historical bills never drift.
- Discounts are allocated across lines, then tax is computed per line and
  aggregated. Multi-slab bills render a grouped **GST SUMMARY** on the
  receipt (RATE / TAXABLE / CGST / SGST per slab); single-slab bills keep the
  compact two-line display. `taxSummary.ts` (shared util) mirrors the engine.

### 7.3 Payments

Cash, UPI, Card, Wallet, Split — plus Razorpay gateway integration
(`modules/payment`), refunds, and cash ledger.

---

## 8. Inventory & Recipes

- Inventory items are products with stock fields (`currentStock`, `unit`,
  `minStock`, `reorderLevel`, `averageCost`, `batchNumber`, `expiryDate`).
- Stock movements via `inventoryEvents` / `stockMovementService` (purchase,
  sale, waste, adjustment, opening, closing…).
- Recipes link menu products to inventory ingredients with quantity/unit,
  deterministic costing, and consumption tracking (`modules/recipes`).
- Recipe creation is manual or AI/voice-assisted (`recipeAiQuickCreate`),
  with ingredient resolution against inventory.

---

## 9. AI & Voice Architecture

- **Provider abstraction** (`backend/src/modules/ai/`): provider-driven
  (OpenAI default, configurable via `AI_PROVIDER`, `AI_BASE_URL`, `AI_MODEL`,
  `AI_API_KEY`), with timeouts, max tokens, temperature, rate limiting, and
  usage logging (`AIUsageLog`, `AiQuotaSnapshot`).
- **Speech-to-text**: provider-managed (Groq Whisper, Deepgram, Google STT —
  configured via `STT_PROVIDER`, keys, models). Voice commands route through
  `/api/voice-inventory/*` and `/api/ai/*`.
- **Product resolution** (`modules/voice-inventory/services/ProductResolver.ts`):
  7-stage multilingual resolution using name, aliases, learned aliases.
- **Deterministic vs AI**: financial truth (pricing, tax, margins, recipe
  cost) is always computed deterministically by the engine. AI is used for
  understanding, reasoning, prioritization, and explanation — never as the
  authority for money math. The AI keys stay server-side; client requests are
  proxied through the backend.
- **Recommendations**: advisor service + festival service + price
  intelligence + recommendation context — combine operational data
  (sales, inventory, margins) with calendar/festival/weather context.

---

## 10. Offline Architecture

- Local persistence is **localStorage** (not IndexedDB).
- Reads: menu/products are fetched from the backend and cached; on failure
  the UI falls back to the cache.
- Writes: failed POST/PUT/PATCH/DELETE are queued in `syncEngine.ts`
  (`PendingOperation`), persisted to localStorage, and replayed when
  connectivity returns (max retries + staleness).
- Bills are written to the cloud on checkout and cached locally for offline
  fallback and quick dashboard stats.

---

## 11. Electron Architecture

Two Electron shells exist:

**POS shell** (`restaurant-pos/electron/`): `main.ts` + `preload.ts`.
IPC channels (exposed via contextBridge):
- `window:reload`, `window:toggleFullScreen`, `window:toggleFrame`,
  `window:getFrameState`, `window:getZoomInfo`
- `app:getVersion`, `app:getEnvironment`
- `printer:list`, `printer:print`
- `dialog:saveFile`

Security posture: `contextIsolation: true`, `nodeIntegration: false`,
`sandbox: true`; CSP injected for `file://` loads.

**Admin shell** (`admin-dashboard/electron/`): `main.ts` + `preload.ts`.
IPC: `get-app-info`, `get-env`, `open-file-dialog`, `save-file-dialog`,
`print`, `show-notification`, `check-for-updates`, `quit-and-install`.

---

## 12. Security Architecture

- JWT access tokens + refresh tokens (server-side invalidation on logout).
- bcrypt password/PIN hashing.
- Role-based authorization (Owner/Manager/Cashier/Kitchen/Waiter).
- Tenant isolation via `restaurantId` scoping on queries/writes.
- Zod validation on all inputs.
- Rate limiting (login backoff, per-route limiters, public-store limiter).
- Security headers, IP blocklist, request logging, audit log with
  versioned settings history.
- AI keys server-side only; sanitized prompts; usage logging.
- Legal document management with immutable published versions and
  acceptance recording (`modules/legal`).

---

## 13. Deployment & Build

- **Backend**: `npm run build` (esbuild → `dist/server.cjs`), `npm start`.
- **POS**: `vite build` + esbuild server bundle; Electron packaging via
  `electron-builder` (config in `restaurant-pos/electron/electron-builder.json`).
- **Admin**: `tsc --noEmit && vite build`, electron-builder packaging.
- **Customer site**: `vite build` (one build serves all tenants).
- Root: `npm run build` builds backend + admin + POS; `npm run install:all`
  installs all workspaces.

Environment: `.env.example` files at each workspace root (no secrets
committed). Key vars: `PORT` (3002), `JWT_SECRET`/`REFRESH_SECRET`,
`AI_PROVIDER`/`AI_API_KEY`/`AI_MODEL`, `STT_PROVIDER`/STT keys,
`RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET`, `CORS_ORIGIN`,
`ADMIN_CORS_ORIGINS`, `VITE_API_URL`.

---

## 14. Testing

- Backend: Vitest (`npm test` in `backend/`) — 1000+ tests.
- POS Frontend: Vitest (`npm test` in `restaurant-pos/Frontend/`) + Playwright
  e2e (`npm run test:e2e`).
- Admin: typecheck + build in CI (`build:react`).
- Typechecks: `npx tsc --noEmit` per workspace.
