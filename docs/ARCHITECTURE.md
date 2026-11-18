# Architecture — Loyalty POS System

Authoritative technical reference for the entire platform. Intended for interviewers, onboarding engineers, and maintainers who need to understand how the four applications, backend, and database fit together.

---

## 1. System Overview

Loyalty POS System is a **multi-tenant, offline-first restaurant platform** delivered as a monorepo with four applications sharing one Express backend and one MongoDB database.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT LAYER                                   │
│  ┌─────────────────┐  ┌──────────────────┐  ┌───────────────────────────┐  │
│ │ POS Terminal      │  │ Admin Dashboard  │  │ Customer QR Site          │  │
│ │ React + Electron  │  │ React + Electron │  │ React + HashRouter        │  │
│ │ :5175 (web)       │  │ :5174 (web)      │  │ :5177 (web)               │  │
│ └────────┬─────────┘  └────────┬─────────┘  └───────────┬───────────────┘  │
│          │                     │                        │                  │
│          └─────────────────────┴───────────────────────┘                  │
│                              │ REST API (JSON) + Socket.IO                 │
└──────────────────────────────┼─────────────────────────────────────────────┘
                               │ HTTP/1.1, JWT Bearer auth                   │
                               ▼
                    ┌─────────────────────────────┐
                    │   EXPRESS BACKEND           │
                    │   Node.js :3002             │
                    │  Routes → Controllers →     │
                    │  Services → Repositories →  │
                    │  Mongoose Models            │
                    └───────────┬─────────────────┘
                                │ Mongoose (ODM)
                                ▼
                    ┌─────────────────────────────┐
                    │   MONGODB                   │
                    │   Multi-tenant documents    │
                    │   (restaurantId scope)      │
                    └─────────────────────────────┘
```

### The Four Applications

| Application | Folder | Tech Stack | Port | Role |
|---|---|---|---|---|
| **Backend API** | `backend/` | Node.js, Express, TypeScript, Mongoose, Socket.IO | 3002 | Source of truth — auth, business logic, data persistence |
| **POS Terminal** | `restaurant-pos/Frontend/` | React 19, Vite, TypeScript, Tailwind CSS | 5175 | Restaurant floor terminal — billing, orders, KDS, inventory |
| **Admin Dashboard** | `admin-dashboard/` | React 19, Vite, TypeScript, Tailwind CSS, Electron | 5174 | Multi-tenant chain management — restaurants, owners, devices, subscriptions, analytics |
| **Customer QR Site** | `customer-site/` | React, Vite, JavaScript (JSX), Socket.IO client | 5177 | Public QR ordering portal — table/car/pickup, cart, pay-now, tracking |

All client apps communicate with the backend over REST (`/api/*`) and real-time events over Socket.IO.

---

## 2. Backend Architecture

### Layered Design

```
┌─────────────────────────────────────────────────────────────┐
│  server.ts                                                    │
│  Express app + middleware stack (helmet, cors, compression, │
│  rate limiting, body parsing, error handler)                │
├─────────────────────────────────────────────────────────────┤
│  routes/              HTTP route definitions (45+ files)    │
│  ├── auth.ts          Auth: login, register-owner, refresh  │
│  ├── bills.ts         Billing: create, list, void, invoice  │
│  ├── orders.ts        Order CRUD, KOT, status transitions   │
│  ├── products.ts      Menu product CRUD                     │
│  ├── customers.ts     Customer & loyalty profiles           │
│  ├── loyalty.ts       Points, rewards, tiers                │
│  ├── qr-ordering.ts   Public store: tenant-scoped catalog   │
│  ├── tables.ts        Table/floor plan management           │
│  ├── branches.ts      Multi-branch config                   │
│  ├── employees.ts     Staff & role management               │
│  ├── admin/*          Super-admin platform APIs             │
│  └── ...              (payments, reservations, expenses, ...)│
├─────────────────────────────────────────────────────────────┤
│  controllers/     Request → validation → service call       │
│  services/        Business logic (80+ services)             │
│  repositories/    Data access abstraction                   │
│  models/          Mongoose schemas                          │
│  modules/         Feature domains (menu-config, payment,    │
│                   promotions, reports, ai, voice-inventory, │
│                   whatsapp, media, calendar, ...)           │
├─────────────────────────────────────────────────────────────┤
│  middleware/      authMiddleware, authorizationMiddleware,  │
│                   rateLimiter, validate, subscriptionMiddleware│
├─────────────────────────────────────────────────────────────┤
│  config.ts          Centralized env config (single source)   │
│  db.ts              MongoDB connection + super-admin seed    │
│  socket.ts          Socket.IO real-time event hub            │
│  cache/             Redis response cache (in-memory fallback)│
└─────────────────────────────────────────────────────────────┘
                                │ Mongoose
                                ▼
                        MongoDB (multi-tenant)
```

### Multi-Tenancy

Every tenant-scoped document carries a `restaurantId` field. Queries are automatically scoped to the authenticated restaurant (plus optional `branchId`). The platform super-admin (`admin` / `1111`) has `restaurantId: null` and can manage all restaurants through the admin API.

### Authentication

- **JWT access tokens** (short-lived) + **refresh tokens** (long-lived, rotatable)
- Passwords hashed with **bcrypt**
- Role-based access: `Owner`, `Manager`, `Cashier` — permissions are Owner-configurable toggles (`managerCanManageProducts`, `cashierCanApplyDiscounts`, etc.)
- **Rate limiting** per route group: auth (per-IP + per-account backoff), public, API, admin, voice, intelligence
- **Brute-force protection**: exponential backoff on consecutive login failures

### Offline-First Design (POS)

The POS terminal is designed to operate without internet:

1. **localStorage read-through cache** — products, tables, settings, employees are cached from the last successful sync
2. **syncEngine** (`restaurant-pos/Frontend/src/lib/syncEngine.ts`) — queues failed writes (bills, orders, customer updates) in an offline buffer
3. **Replay on reconnect** — when connectivity returns, queued writes are replayed to the backend in order
4. **Local invoice reservation** — offline terminals reserve invoice number ranges so billing continues without collisions
5. **Optimistic UI** — table occupancy, order status, and cart updates appear instantly; server reconciliation heals any divergence

### Real-Time (Socket.IO)

The backend maintains a Socket.IO hub (`backend/src/socket.ts`) for:
- New online/QR orders → all POS terminals (instant KDS update, auto-print KOT)
- Waiter calls / customer bells → pending-call list with sound reminders
- Order status adjustments → KDS delta refresh (no 30s poll wait)
- Table occupancy changes → floor plan updates across terminals
- Settings / product updates from one terminal → reflected on others

Falls back to HTTP polling (15s–30s) when WebSocket is unavailable.

---

## 3. Database (MongoDB)

Document-oriented, multi-tenant. Core collections (grouped by domain):

### Catalog & Menu
| Collection | Purpose |
|---|---|
| `Product` | Menu items with categories, variants, add-ons, GST slab, images, availability |
| `Branch` | Per-branch settings, pricing, location |
| `Table` | Floor plan tables with number, status, capacity, guest count |
| `Floor` | Floor groupings for multi-floor restaurants |

### Orders & Billing
| Collection | Purpose |
|---|---|
| `Order` | Order lifecycle: placed → accepted → preparing → served → completed |
| `Bill` | Finalized receipts with line items, tax snapshot, payment split |
| `KOTRecord` | Kitchen order tickets with delta detection |
| `TakeawayOrder` | Off-premises orders |

### Customers & Loyalty
| Collection | Purpose |
|---|---|
| `Customer` | Profiles, phone, email, visit history, loyalty points |
| `Reward` | Loyalty rewards and redemption rules |
| `CustomerRequest` | Waiter calls / table bells |

### Platform & Tenancy
| Collection | Purpose |
|---|---|
| `Restaurant` | Tenant records, branding, subscription link |
| `User` | Employees with roles and PIN login |
| `Subscription` | Plan, trial/grace status, billing period |
| `SubscriptionPlan` | Pricing tiers and feature grants |
| `Device` | Registered POS terminals |
| `Authorization` | RBAC rules per principal/collection |

### Finance & Operations
| Collection | Purpose |
|---|---|
| `Expense` | Categorized expenses with vendor tracking |
| `Reservation` | Table bookings |
| `AuditLog` | Immutable action log with integrity verification |
| `SupportTicket` | Help-desk tickets with replies/attachments |

---

## 4. Module Map (`backend/src/modules/`)

Feature domains encapsulated under `modules/`:

| Module | Responsibility |
|---|---|
| `menu-config` | Reusable variant / add-on / customization groups consumed by product registration and billing |
| `payment` | Razorpay integration, pay-now, receipts |
| `loyalty` | Points, tiers, rewards engine |
| `qr-ordering` | Public store API for customer QR site (tenant-scoped) |
| `reports` | Z-report, daily sales, GST summary, item sales |
| `adminReports` | Platform-wide sales/inventory/employee reports |
| `promotions` | Offer engine, combo opportunities, campaign scheduling |
| `calendar` | Promotion calendar, recurring schedules |
| `recipes` | Recipe costing and inventory linkage |
| `inventoryDemand` / `inventoryEvents` | Stock tracking, movement, demand forecasting |
| `voice-inventory` | Voice-entry STT flow for inventory |
| `settings` | Restaurant/company/general/default-subscription settings |
| `subscription` | Plan lifecycle, trial/grace, feature grants |
| `media` | Upload handling (logo, cover, attachments), storage metrics |
| `whatsapp` | Meta Business messaging (encrypted at rest) |
| `audit` | Audit logs, integrity, retention, legal holds |
| `help-analytics` / `feedbackIntelligence` | Customer feedback analysis |
| `historical-foundation` | Data consistency audits |
| `legal` | Legal holds, retention policies |

---

## 5. POS Frontend Architecture (`restaurant-pos/Frontend/src/`)

### State Layer
- `usePOSState.ts` — Central store (80+ reactive variables): orders, bills, products, tables, employees, settings, role permissions, online/offline status
- `useBilling.ts` — Cart, line items, GST, discounts, split payments
- `useOrders.ts` — Order lifecycle, KOT, held orders
- `useLoyalty.ts` — Customer search, points, rewards
- `useKeyboardShortcuts.ts` — F1–F12 + Ctrl combos
- `useNotifications.ts` — Toast system
- `usePOSLiveEvents.ts` — Socket.IO event wiring

### Routing
- `routes.ts` — Workspace name ↔ URL path mapping (`/dashboard`, `/billing`, `/orders`, `/kitchen`, `/inventory`, `/reports`, `/settings`, `/staff`, `/branches`, `/expenses`, `/reservations`, `/analytics`, `/finance`, `/calls`, `/more`, etc.)
- Workspaces are lazy-loaded with `safeLazy()` — retries chunk loads when the browser comes back online

### Sync & Offline
- `syncEngine.ts` — Cross-tab sync queue, failed-write buffering, replay-on-reconnect
- `data.ts` — localStorage read-through helpers (`setDBData`, `getDBData`, `clearAllCache`)
- `kotDelta.ts` — Kitchen ticket delta computation (minimal reprints)
- `orderMerge.ts` — Monotonic order merge (never regress a served KOT)
- `runningBill.ts` — Live cart total computation

### Workspaces
| Workspace | Purpose |
|---|---|
| Dashboard | Sales overview, recent activity, quick actions |
| Billing | Product grid, cart, payment, receipt |
| Orders | Order list, status tracking, timeline |
| Kitchen | KDS display, KOT management, delta alerts |
| Products | Menu CRUD, categories, variants, availability |
| Customers | Loyalty profiles, visit history, rewards |
| Offers | Promotions, combos, campaigns |
| Reports | Z-report, daily sales, GST, item analytics |
| Staff | Employee management, role permissions |
| Shift | Shift opening/closing, cash drawer |
| Branches | Multi-branch configuration |
| Settings | Theme, modules, printer, security, auto-lock |
| ReceiptHistory | Receipt lookup and reprint |
| Expenses | Vendor-expense tracking |
| Reservations | Table bookings, waiting list |
| Analytics | Charts, trends, forecasting |
| Finance | P&L, cash ledger, GST, vendors |
| Inventory | Stock levels, movements, AI insights |
| Calls | Waiter bells, customer requests |
| MenuAvailability | Per-branch product availability toggle |
| QrStudio | QR sticker design and printing |
| Feedback | Customer feedback management |

---

## 6. Admin Dashboard Architecture (`admin-dashboard/src/`)

### State & Data Fetching
- **TanStack React Query v5** — server-state caching, background refetching, optimistic updates
- **AuthContext** — JWT bearer token management, 401 intercept → redirect to login
- **ThemeContext** — dark/light/system mode
- **SidebarContext** — collapsible navigation

### Page Groups (`src/pages/`)
| Group | Pages |
|---|---|
| `core/` | Dashboard, Login, Profile, Settings |
| `restaurants/` | Restaurant list, details, branches |
| `core/` (owners) | Owner CRUD, password reset, activation |
| `core/` (devices) | Device registry, block/unblock, health |
| `subscriptions/` | Plans, renewals, upgrades, pause/resume |
| `analytics/` | Dashboard stats, growth, churn, device activity |
| `reports/` | Sales summaries, inventory valuation, employee performance, closing Z |
| `finance/` | P&L, expenses, cash ledger, GST, vendors |
| `marketing/` | Campaigns, offers, CRM |
| `platform/` | Support tickets, audit logs, security blocklist |

### UI Kit (`src/components/ui/`)
Button, Card, Table, Badge, Modal, Input, Skeleton, ErrorPage, EmptyState, LoadingSpinner, ProtectedRoute.

---

## 7. Customer QR Site Architecture (`customer-site/src/`)

### Routing (`src/App.jsx`)
Uses **HashRouter** so QR stickers work on static hosts / LAN without server-side rewrites:

| Route | Purpose |
|---|---|
| `/` | Demo landing page |
| `/r/:receiptToken` | Standalone receipt landing (resolves restaurant + bill from token) |
| `/:token` → `MenuPage` | QR ordering entry: `?mode=table\|car\|pickup&ref=…` |
| `/:token/cart` | Cart review |
| `/:token/track` | Live order tracking |

### Tenant Scoping
`src/api.js` pins the restaurant `slug` onto every Axios request; the backend scopes all data to that tenant. `src/socket.js` provides Socket.IO live status/bill updates. `src/razorpay.js` handles the pay-now flow (create order → checkout → verify).

---

## 8. Data Flow Examples

### Flow A: In-Store Dine-in Bill (Offline-Tolerant)
1. Cashier logs in (PIN) → JWT issued, cached locally
2. POS loads products/tables from localStorage cache (or API if online)
3. Cashier adds items to cart → `useBilling` computes live totals + GST
4. Cashier sends KOT → Socket.IO push to Kitchen Display (or HTTP poll fallback)
5. Cashier creates bill → `POST /api/bills` → backend validates subscription, persists Bill + Order, snapshots tax per line
6. If offline: bill queued in syncEngine, replayed on reconnect
7. Receipt printed (thermal, 58mm/80mm ESC/POS)

### Flow B: Customer QR Order
1. Customer scans QR sticker → `/{slug}/qr/{token}?mode=table&ref=5`
2. Customer site resolves session, loads tenant-scoped menu
3. Customer adds items, checks out via Razorpay
4. Backend creates Order + Bill, occupies table server-side (`reconcileTable`)
5. Socket.IO pushes new order to all POS terminals → instant KDS + auto-print KOT
6. POS marks table Occupied immediately (optimistic), reconciles via `/tables` fetch

### Flow C: Admin Platform Action
1. Super-admin logs into Admin Dashboard → `admin` / `1111`
2. Creates restaurant → `POST /api/admin/restaurants` (RBAC: `Restaurant` create)
3. Creates owner → `POST /api/admin/owners`
4. Assigns subscription plan → `POST /api/admin/subscription-plans/assign`
5. POS terminal registers device → backend logs device, terminal appears in device registry

---

## 9. Environment Configuration

`backend/src/config.ts` is the single source of truth. Groups:

| Group | Key Vars |
|---|---|
| Server | `PORT`, `NODE_ENV`, `CORS_ORIGIN`, `ADMIN_CORS_ORIGINS` |
| Database | `MONGODB_URI` |
| Auth | `JWT_SECRET`, `REFRESH_SECRET`, `JWT_ISSUER` |
| Cache | `REDIS_URL` (optional, in-memory fallback) |
| AI | `AI_PROVIDER`, `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL`, `AI_TIMEOUT`, `AI_MAX_TOKENS`, `AI_TEMPERATURE` |
| Voice / STT | `DEEPGRAM_API_KEY`, `GOOGLE_API_KEY`, `STT_COST_PER_MIN_*` |
| Payments | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` |
| Subscriptions | `TRIAL_DAYS` |
| Uploads | `UPLOADS_DIR`, `UPLOAD_MAX_FILE_SIZE_MB`, `UPLOAD_ALLOWED_MIME_TYPES` |
| Public URLs | `PUBLIC_BASE_URL`, `QR_BASE_URL` |
| Frontend | `FRONTEND_DIST` |
| WhatsApp | `META_APP_ID`, `META_APP_SECRET`, `WHATSAPP_ENCRYPTION_KEY` |
| ML Bridge | `ML_DEMAND_BASE_URL`, `ML_BASKET_BASE_URL`, `ML_UPLIT_BASE_URL`, `ML_SEGMENT_BASE_URL`, `ML_SERVICE_TOKEN` |
| Cricket | `CRICKET_API_KEY`, `CRICKET_CONTEXT_ENABLED` |

See `backend/.env.example` for the full commented template.

---

## 10. Security Summary

- **Helmet** + **CORS** + **compression** on Express
- **Rate limiting** per route group with per-account backoff on auth
- **bcrypt** password hashing (10 rounds)
- **JWT** access + refresh tokens, refresh token rotation
- **RBAC** via `Authorization` collection (collection-level create/read/update/delete/admin)
- **Multer** file upload gating: size cap (5MB default), MIME-type allowlist
- **Magic-byte validation** on media uploads
- **Audit log** with integrity checksums, retention, legal holds
- **WhatsApp credentials** encrypted at rest (`WHATSAPP_ENCRYPTION_KEY`)

---

## 11. Testing Strategy

| Layer | Tool | Target |
|---|---|---|
| Backend unit | Vitest + mongodb-memory-server | Services, controllers, fact-consistency audits |
| POS frontend unit | Vitest + React Testing Library | Hooks, utils, components |
| POS E2E | Playwright | Ordering flow, KOT, tours, visual QA |
| Security audit | `npm audit` (high) | Dependency vulnerabilities |

---

## 12. Deployment Notes

- **Development**: `npm run dev` starts all four web servers concurrently
- **Production build**: `npm run build` builds backend (esbuild CJS bundle), POS frontend (Vite), Admin (Vite + esbuild), Customer (Vite)
- **Backend production**: `node dist/server.cjs` — serves API + optional static frontend at `/`
- **Desktop packaging**: `electron-builder` — Windows NSIS, macOS DMG, Linux AppImage/.deb
- **MongoDB**: Local `mongodb://localhost:27017/pos` or Atlas URI via `MONGODB_URI`
- **Redis**: Optional; backend falls back to in-memory cache when `REDIS_URL` is unset

---

*For endpoint-level details, see [API_REFERENCE.md](API_REFERENCE.md).*