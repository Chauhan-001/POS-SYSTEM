# Architecture Document
## Restaurant POS — Point of Sale & Restaurant Management System

**Version:** 1.0.0  
**Status:** Draft  
**Last Updated:** July 27, 2026

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Architecture Principles](#2-architecture-principles)
3. [High-Level Architecture](#3-high-level-architecture)
4. [Frontend Architecture](#4-frontend-architecture)
5. [Backend Architecture](#5-backend-architecture)
6. [Data Flow](#6-data-flow)
7. [State Management](#7-state-management)
8. [Offline-First Sync Architecture](#8-offline-first-sync-architecture)
9. [Hooks Architecture](#9-hooks-architecture)
10. [Component Hierarchy](#10-component-hierarchy)
11. [Modal System](#11-modal-system)
12. [Order Lifecycle](#12-order-lifecycle)
13. [Billing & Payment Flow](#13-billing--payment-flow)
14. [Kitchen Display (KOT) Architecture](#14-kitchen-display-kot-architecture)
15. [Multi-Branch Architecture](#15-multi-branch-architecture)
16. [Role-Based Access Control](#16-role-based-access-control)
17. [Desktop Architecture (Electron)](#17-desktop-architecture-electron)
18. [Build & Deployment](#18-build--deployment)
19. [Performance Considerations](#19-performance-considerations)

---

## 1. System Overview

The **Restaurant POS** is a comprehensive, **offline-first** Point of Sale system designed for restaurants. It runs as a desktop Electron application with a companion backend. The system handles:

- **Order Management**: Dine-in, takeaway, delivery, online orders
- **Billing**: Product grid, cart, payment processing, GST calculations
- **Kitchen Display**: Real-time KOT (Kitchen Order Ticket) management
- **Customer Loyalty**: Points, rewards, visit milestones
- **Multi-Branch**: Branch-level data isolation with cross-branch management
- **Inventory**: Stock tracking with AI-powered insights
- **Reservations**: Table booking and waiting list management
- **Expenses**: Operational expense tracking
- **Offline-First**: Full operation without internet; background sync when online

---

## 2. Architecture Principles

| Principle | Rationale |
|---|---|
| **Offline-First** | All core operations work without internet; sync engine bridges gaps when connectivity is restored |
| **Local-First State** | `usePOSState` hook is the single source of truth; all mutations go to localStorage first, API second |
| **TTL-Aware Caching** | Each data type has a cache TTL (SLOW/MEDIUM/FAST/LIVE) — API calls are only made when cache is stale |
| **Double-Click Guard** | Payment processing uses a ref-based guard to prevent duplicate submissions |
| **Branch-Aware Filtering** | All data is filtered by current branch; per-branch settings, prices, and table layouts merge with global defaults |
| **Role-Based Workspace Gating** | Each workspace has an access guard that enforces role permissions before rendering |
| **Composable Hooks** | Business logic is extracted into custom hooks (`useBilling`, `useOrders`, `useLoyalty`) rather than living in components |
| **Keyboard-First** | Full keyboard shortcut system for rapid billing operations |

---

## 3. High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          CLIENT LAYER (Electron)                          │
│                                                                           │
│  ┌────────────────────────────────────────────────────────────────────┐   │
│  │  Electron Main Process (electron/main.ts)                          │   │
│  │  • BrowserWindow creation, lifecycle, fullscreen                   │   │
│  │  • IPC for printing, splash screen                                 │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│                                                                           │
│  ┌────────────────────────────────────────────────────────────────────┐   │
│  │                     React Application (Vite SPA)                    │   │
│  │                                                                     │   │
│  │  ┌─────────────────────────────────────────────────────────────┐   │   │
│  │  │  App.tsx — Root orchestrator                                 │   │   │
│  │  │  • Auth check → LoginScreen / FirstTimeSetup / Main POS     │   │   │
│  │  │  • URL ↔ Workspace synchronization                           │   │   │
│  │  │  • Role-based workspace gating                               │   │   │
│  │  │  • Keyboard shortcut registration                            │   │   │
│  │  │  • Modal orchestration (which modals are open)               │   │   │
│  │  └─────────────────────────────────────────────────────────────┘   │   │
│  │                                                                     │   │
│  │  ┌──────────────────────────────────────────────┐                   │   │
│  │  │              State Layer                      │                   │   │
│  │  │  ┌────────────────────────────────────────┐  │                   │   │
│  │  │  │ usePOSState (Central State Hook)      │  │                   │   │
│  │  │  │ • 80+ state variables                  │  │                   │   │
│  │  │  │ • localStorage init for instant render  │  │                   │   │
│  │  │  │ • TTL-aware API hydration on mount      │  │                   │   │
│  │  │  │ • Background polling (30s for live data)│  │                   │   │
│  │  │  │ • Branch-aware filtering & price merging│  │                   │   │
│  │  │  │ • Derived state (dailySales, zReport)   │  │                   │   │
│  │  │  └────────────────────────────────────────┘  │                   │   │
│  │  │  ┌──────────┐ ┌──────────┐ ┌──────────────┐ │                   │   │
│  │  │  │useOrders │ │useBilling│ │ useLoyalty   │ │                   │   │
│  │  │  │Order CRUD│ │Payment   │ │Customer/Rewrd│ │                   │   │
│  │  │  │KOT Mgmt  │ │Calculatns│ │Redemption    │ │                   │   │
│  │  │  │Tables    │ │Checkout  │ │Milestone     │ │                   │   │
│  │  │  └──────────┘ └──────────┘ └──────────────┘ │                   │   │
│  │  └──────────────────────────────────────────────┘                   │   │
│  │                                                                     │   │
│  │  ┌─────────────────────────────────────────────────────────────┐   │   │
│  │  │  Workspaces (18 route-level components)                     │   │   │
│  │  │  Dashboard │ Orders │ Billing │ Products │ Customers        │   │   │
│  │  │  Offers    │ Reports│ Staff   │ Branches │ Settings          │   │   │
│  │  │  Receipts  │ Expenses│Reservatns│Analytics│ Finance          │   │   │
│  │  │  Inventory │ Kitchen│ More                                 │   │   │
│  │  └─────────────────────────────────────────────────────────────┘   │   │
│  │                                                                     │   │
│  │  ┌─────────────────────────────────────────────────────────────┐   │   │
│  │  │  Shared Components Layer                                     │   │   │
│  │  │  • AppSidebar — Navigation sidebar with role-based items     │   │   │
│  │  │  • AppTitleBar — Custom title bar with branch selector       │   │   │
│  │  │  • BillingProductGrid — Category-filtered product cards      │   │   │
│  │  │  • CartPanel — Resizable side cart with items + totals       │   │   │
│  │  │  • KitchenDisplay — KOT queue with status management         │   │   │
│  │  │  • RestaurantFloorPlan — Visual table map                    │   │   │
│  │  │  • 15+ Modal components                                      │   │   │
│  │  └─────────────────────────────────────────────────────────────┘   │   │
│  │                                                                     │   │
│  │  ┌─────────────────────────────────────────────────────────────┐   │   │
│  │  |  Infrastructure Layer                                        |   │   │
│  │  |  • api/client.ts — Axios with JWT + error interceptor        |   │   │
│  │  |  • lib/syncEngine.ts — Cross-tab sync + stale key tracking   |   │   │
│  │  |  • data.ts — localStorage helpers + daily sales computation  |   │   │
│  │  |  • utils/kotDelta.ts — KOT item delta computation            |   │   │
│  │  └─────────────────────────────────────────────────────────────┘   │   │
│  └────────────────────────────────────────────────────────────────────┘   │
└────────────────────────────┬─────────────────────────────────────────────┘
                            │ HTTP/REST (when online)
                            │
┌───────────────────────────▼─────────────────────────────────────────────┐
│                        BACKEND LAYER (Express)                           │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐    │
│  │  Server (backend/src/server.ts)                                 │    │
│  │  • CORS, Helmet, JSON body parsing                              │    │
│  │  • Rate limiting (auth IP limiter, account backoff)             │    │
│  │  • Static file serving for production                           │    │
│  └──────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐    │
│  │  Middleware Pipeline                                             │    │
│  │  • authMiddleware — JWT verification, requireRole('Owner',...)   │    │
│  │  • validate — Zod schema validation for body/params/query       │    │
│  │  • rateLimiter — IP-based throttling for auth routes            │    │
│  └──────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  ┌──────────┐  ┌────────────┐  ┌────────────┐  ┌──────────────┐        │
│  │  Routes  │  │Controllers │  │  Services  │  │  Validation  │        │
│  │  14 rtrs │  │            │  │            │  │  (Zod)      │        │
│  └──────────┘  └────────────┘  └────────────┘  └──────────────┘        │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐    │
│  │  MongoDB (Mongoose)                                              │    │
│  │  • 15+ models: Restaurant, Branch, Product, Order, Bill,        │    │
│  │    Customer, Employee, Table, Subscription, License, etc.       │    │
│  │  • Atomic invoice counters via InvoiceCounter model              │    │
│  └──────────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Frontend Architecture

### 4.1 Project Structure

```
restaurant-pos/Frontend/
├── src/
│   ├── main.tsx                     — React entry point
│   ├── App.tsx                      — Root component (orchestrator)
│   ├── types.ts                     — All TypeScript interfaces (100+ types)
│   ├── data.ts                      — localStorage helpers, daily sales, activity feed
│   ├── routes.ts                    — URL ↔ workspace mapping (18 workspaces)
│   ├── index.css                    — Tailwind CSS imports + custom styles
│   ├── api/
│   │   └── client.ts               — Axios instance + all API functions
│   ├── lib/
│   │   └── syncEngine.ts           — Cross-tab sync + stale key management
│   ├── hooks/
│   │   ├── usePOSState.ts          — Central state hook (80+ variables)
│   │   ├── useBilling.ts           — Cart, calculations, checkout
│   │   ├── useOrders.ts            — Orders, KOT, tables, timeline
│   │   ├── useLoyalty.ts           — Customer loyalty, rewards, milestones
│   │   ├── useKeyboardShortcuts.ts — Complete keyboard shortcut system
│   │   └── useNotifications.ts     — Toast notification system
│   ├── utils/
│   │   ├── kotDelta.ts             — KOT item delta computation
│   │   └── debugLog.ts             — Debug logging utility
│   └── components/
│       ├── modals/                  — 15+ modal components
│       │   ├── ConfirmationDialog.tsx
│       │   ├── PaymentConfirmModal.tsx
│       │   ├── KOTPreviewModal.tsx
│       │   ├── OffersPopup.tsx
│       │   ├── SplitPaymentModal.tsx
│       │   ├── OTPVerificationModal.tsx
│       │   ├── HeldOrdersDrawer.tsx
│       │   ├── DailySalesModal.tsx
│       │   ├── ActivityFeedModal.tsx
│       │   ├── ZReportModal.tsx
│       │   ├── SyncPanelModal.tsx
│       │   └── VoidReasonModal.tsx
│       └── inventory/               — Inventory management components
│           └── ...
├── components/                      — Top-level workspace components
│   ├── AppTitleBar.tsx             — Custom title bar
│   ├── AppSidebar.tsx              — Navigation sidebar
│   ├── BillingProductGrid.tsx      — Product grid with categories
│   ├── CartPanel.tsx               — Resizable cart side panel
│   ├── DashboardWorkspace.tsx      — Dashboard workspace
│   ├── OrderManager.tsx            — Orders workspace (tables + takeaway)
│   ├── KitchenDisplay.tsx          — Kitchen KOT management
│   ├── ProductManager.tsx          — Menu product CRUD
│   ├── CustomerManager.tsx         — Customer loyalty management
│   ├── OffersManager.tsx           — Offers/rewards management
│   ├── ReportsManager.tsx          — Z-report, daily sales reports
│   ├── StaffManager.tsx            — Employee management
│   ├── SettingsManager.tsx         — Full settings with role permissions
│   ├── BranchManager.tsx           — Multi-branch management
│   ├── ExpenseManager.tsx          — Expense tracking
│   ├── ReservationWorkspace.tsx    — Reservations + waiting list
│   ├── AnalyticsWorkspace.tsx      — Sales analytics
│   ├── FinanceWorkspace.tsx        — Finance overview
│   ├── ReceiptHistory.tsx          — Historical receipts
│   ├── ReceiptModal.tsx            — Receipt print preview
│   ├── KOTModal.tsx                — KOT display/print modal
│   ├── OrderTimeline.tsx           — Order event timeline
│   ├── RestaurantFloorPlan.tsx     — Visual table map
│   ├── AddOnModal.tsx              — Product customization modal
│   ├── BranchExport.tsx            — Branch data export
│   ├── LoginScreen.tsx             — Staff login
│   ├── FirstTimeSetup.tsx          — Initial owner registration
│   ├── GuidedTour.tsx              — Interactive onboarding tour
│   └── ShortcutsGuide.tsx          — Keyboard shortcuts reference
├── index.html                      — Vite entry
├── package.json
├── vite.config.ts
├── tsconfig.json
└── server.ts                       — Local Express server (for production)
```

### 4.2 Workspace Architecture (18 Workspaces)

Each workspace is a top-level component conditionally rendered in `App.tsx` based on the `activeWorkspace` state. The URL is synchronized bidirectionally with the workspace state via `routes.ts`.

```
Workspace ↔ URL Mapping (routes.ts)

Dashboard    ↔ /dashboard
Orders       ↔ /orders
Billing      ↔ /billing
Products     ↔ /products
Customers    ↔ /customers
Offers       ↔ /offers
Reports      ↔ /reports
Staff        ↔ /staff
Branches     ↔ /branches
Settings     ↔ /settings
ReceiptHistory↔ /receipt-history
Expenses     ↔ /expenses
Reservations ↔ /reservations
Analytics    ↔ /analytics
Finance      ↔ /finance
Inventory    ↔ /inventory
Kitchen      ↔ /kitchen
More         ↔ /more
```

Workspace rendering pattern in `App.tsx`:

```tsx
<main className="flex-1 overflow-y-auto">
  <ErrorBoundary key={activeWorkspace}>
    {activeWorkspace === 'Dashboard' && <DashboardWorkspace ... />}
    {activeWorkspace === 'Orders' && <OrderManager ... />}
    {activeWorkspace === 'Billing' && (
      <div className="flex h-full">
        <BillingProductGrid ... />
        <CartPanel ... />
      </div>
    )}
    {/* ... 15 more workspaces */}
  </ErrorBoundary>
</main>
```

---

## 5. Backend Architecture

### 5.1 Route Tree

```
backend/src/routes/
├── auth.ts           — POST /login, /refresh, /logout, GET /me, GET /owner-exists
├── admin.ts          — Super admin: restaurants, owners, devices, subscriptions, analytics, settings
├── products.ts       — CRUD /products (Owner/Manager can write)
├── orders.ts         — CRUD /orders (all staff, Owner/Manager can delete)
├── bills.ts          — CRUD /bills + GET /next-invoice (atomic counter)
├── tables.ts         — CRUD /tables + POST /bulk-replace/:branchId
├── customers.ts      — CRUD /customers (loyalty profiles)
├── expenses.ts       — CRUD /expenses (Owner/Manager write)
├── branches.ts       — CRUD /branches + GET/PUT /:id/settings
├── employees.ts      — CRUD /employees (staff management)
├── reservations.ts   — CRUD /reservations + /waiting list
├── rewards.ts        — CRUD /rewards (loyalty rewards)
├── sync.ts           — POST /sync (offline data sync endpoint)
└── takeawayOrders.ts — CRUD /takeaway-orders
```

### 5.2 Database Model Architecture

```typescript
// All models extend a base repository pattern
baseRepository → { create, findAll, findById, update, delete, paginate, upsert }

// Key Models
┌──────────────────────────────────────────────┐
│                   Restaurant                  │
│  name, address, phone, status, plan, aiEnabled│
└────────────┬─────────────────────┬───────────┘
             │                     │
    ┌────────▼────────┐   ┌───────▼──────────┐
    │     Branch      │   │   Subscription    │
    │  name, address, │   │  plan, status,    │
    │  isHeadBranch,  │   │  price, expiry,   │
    │  isActive       │   │  maxDevices, ai   │
    └────────┬────────┘   └──────────────────┘
             │
    ┌────────▼────────┐   ┌──────────────────┐
    │     Tables      │   │  BranchSettings  │
    │  number,status, │   │  per-branch over-│
    │  capacity,guest │   │  rides of global │
    │  section,waiter │   │  SystemSettings  │
    └─────────────────┘   └──────────────────┘

┌──────────────────────────────────────────────┐
│                   Order                       │
│  type, status, tableId, items (CartItem[]),   │
│  kotRecords (KOTRecord[]), timeline (Events)  │
│  subtotal, discount, gst, grandTotal          │
│  paymentMethod, loyaltyPoints, lastKotSnapshot│
└──────────────────────────────────────────────┘

┌──────────────────────────────────────────────┐
│                   Bill                        │
│  invoiceNumber (atomic), ticketNumber, items, │
│  subtotal, discount, gst, grandTotal,         │
│  paymentMethod, orderType, pointsEarned,      │
│  cashierName, customerPhone, createdAt        │
└──────────────────────────────────────────────┘
```

---

## 6. Data Flow

### 6.1 On Mount Data Hydration

```
Component mounts (App.tsx)
       │
       ▼
usePOSState() initializes
       │
       ├── useState(() => getDBData(key, default))
       │       │
       │       └── Reads localStorage synchronously
       │           → Instant render with cached data
       │
       └── useEffect on mount:
               │
               ├── fetchIfStale(api.fetchProducts, setProducts, 'pos_products', TTL.SLOW)
               ├── fetchIfStale(api.fetchOrders, setOrders, 'pos_orders', TTL.FAST)
               ├── fetchIfStale(api.fetchTables, setTables, 'pos_tables', TTL.FAST)
               ├── fetchIfStale(api.fetchCustomers, ..., TTL.MEDIUM)
               └── ... more types
                       │
                       └── If cache timestamp is older than TTL:
                               │
                               ├── Call API → Success → Update state + localStorage + cache timestamp
                               └── Call API → Error → Keep localStorage data (no visible change)
```

### 6.2 Mutation Flow (e.g., Checkout Payment)

```
User clicks "Pay" button
       │
       ▼
useBilling.handleCheckoutPayment()
       │
       ├── Guard: isProcessingPayment.current = true (ref-based double-click prevention)
       │
       ├── calculateCartSubtotal(), calculateCartDiscount(), calculateCartTaxes(), calculateCartGrandTotal()
       │
       ├── await getNextInvoiceNumber()
       │       ├── Try backend atomic counter (InvoiceCounter.findOneAndUpdate $inc)
       │       └── Fall back to localStorage counter
       │
       ├── Build Bill object (synchronous)
       ├── setBills([newBill, ...bills])  ← Instant UI update
       ├── setCartItems([])               ← Clear cart
       │
       ├── Async background (fire-and-forget with catch):
       │   ├── api.createBill(bill)
       │   ├── api.updateOrder(order) if activeOrder
       │   ├── enqueueCustomerUpdate(phone, updatedCust)
       │   └── api.createTakeawayOrder() if takeaway
       │
       └── Finally: isProcessingPayment.current = false
```

### 6.3 Live Data Polling

```typescript
// Every 30 seconds while online and no active order
useEffect(() => {
  const interval = setInterval(() => {
    if (navigator.onLine && !activeOrder) {
      fetchAndCache(api.fetchOrders, setOrders, CK.ORDERS)
      fetchAndCache(api.fetchTables, setTables, CK.TABLES)
      fetchAndCache(api.fetchTakeawayOrders, setTakeawayOrders, CK.TAKEAWAY)
    }
  }, 30000)
  return () => clearInterval(interval)
}, [activeOrder])
```

---

## 7. State Management

### 7.1 State Categories

| Category | Variables | Mechanism |
|---|---|---|
| **Core Data** | products, customers, employees, bills, expenses, settings, branches | useState + localStorage init + TTL API hydration |
| **Order State** | orders, tables, takeawayOrders, activeOrder, heldOrders, KOT state | useState + localStorage + background polling |
| **Billing State** | cartItems, customerPhone, searchedCustomer, orderType, paymentMethod, appliedReward, splitDetails | useState (no persistence — ephemeral billing session) |
| **UI State** | activeWorkspace, modal visibility toggles, cartWidth, search inputs | useState |
| **UI Ref State** | billingSearchRef, loyaltyPhoneRef, quickFireRef, tourArtifactRef | useRef |
| **Derived State** | dailySales, activityFeed, zReportData, moduleSettings, rolePermissions, effectiveProducts, filteredOrders | useMemo |
| **Cache Meta** | Cache timestamps per entity type | localStorage (pos_cache_meta) |
| **Sync State** | isOnline, syncEngine state | navigator.onLine + CustomEvent |

### 7.2 Persistence Strategy

| Data Type | Persistence | Strategy |
|---|---|---|
| **Products** | localStorage + API | Cached (TTL: SLOW = 5 min) |
| **Customers** | localStorage + API | Cached (TTL: MEDIUM = 2 min) |
| **Orders** | localStorage + API | Cached (TTL: FAST = 30s), polled live |
| **Tables** | localStorage + API | Cached (TTL: FAST = 30s), polled live |
| **Takeaway Orders** | localStorage + API | Cached (TTL: FAST = 30s), polled live |
| **Bills** | localStorage (last 50) | Cached (TTL: MEDIUM = 2 min) |
| **Employees** | localStorage + API | Cached (TTL: SLOW = 5 min) |
| **Settings** | localStorage + API | Episode-based (rewritten on change) |
| **Branches** | localStorage + API | Cached (TTL: SLOW = 5 min) |
| **Cart Items** | Not persisted | Ephemeral per billing session |
| **Held Orders** | localStorage | Permanent until recalled |
| **Current Employee** | localStorage | Session persistence |

---

## 8. Offline-First Sync Architecture

### 8.1 SyncEngine Class

A singleton `syncEngine` manages cross-tab sync state using a publish/subscribe pattern.

```typescript
class SyncEngine {
  private syncState: SyncState   // { lastSynced, online, pendingChanges }
  private staleKeys: Set<string> // Entity types needing re-fetch
  private listeners: Set<Listener>

  getSyncState(): SyncState          // Read current sync state
  subscribe(listener): () => void    // Subscribe to changes
  sync(): void                       // Mark all as synced
  markPending(): void                // Increment pending changes
  markStale(entityType): void        // Mark entity type for re-fetch
  consumeStaleKeys(): string[]       // Read & clear stale keys
  setOnline(online): void            // Update connectivity; auto-sync when coming online
}
```

### 8.2 Sync Flow

```
Online → Offline
    │
    ├── syncEngine.setOnline(false)
    ├── All API calls fail silently → data mutations go to localStorage only
    └── User keeps working normally
    │
Offline → Online
    │
    ├── window 'online' event fires
    ├── syncEngine.setOnline(true)
    │   └── auto-sync: consumeStaleKeys() → re-fetch all entities
    ├── User can also trigger manual sync via SyncPanel
    └── Pending changes counter resets
```

### 8.3 Data Source Priority

```
1. localStorage (instant, always available)
2. API result (async, when online)
3. API error (silent — keep localStorage data)
```

---

## 9. Hooks Architecture

### 9.1 Hook Dependency Graph

```
usePOSState (80+ state variables, localStorage, API hydration, TTL caching, polling, derived state)
    │
    ├── useBilling (cart calculations, checkout, invoice numbers)
    │       └── consumes: cartItems, activeOrder, orders, customers, bills, settings, ...
    │
    ├── useOrders (create/update orders, KOT, tables, timeline)
    │       └── consumes: orders, tables, takeawayOrders, activeOrder, cartItems, ...
    │
    ├── useLoyalty (customer search, reward application, milestones)
    │       └── consumes: customers, products, cartItems, settings, rewards, ...
    │
    ├── useKeyboardShortcuts (keyboard navigation, quick actions)
    │       └── consumes: all state mutators from usePOSState
    │
    └── useNotifications (toast management)
```

### 9.2 usePOSState — Central State Hook

The biggest hook (~800 lines) manages:

- **80+ `useState` variables** initialized from `localStorage`
- **TTL-aware API hydration** via `fetchIfStale()` on mount
- **Background polling** every 30s for orders/tables/takeaways
- **Derived state**: `dailySales`, `activityFeed`, `zReportData`, `moduleSettings`, `rolePermissions`
- **Branch-aware filtering**: `filteredOrders`, `filteredTables`, `effectiveProducts` (with per-branch price overrides)
- **localStorage persistence effects** for every state variable
- **Cart resizing** via mouse drag event listeners
- **Clock tick** every 1 second

### 9.3 useBilling — Payment Hook

Key responsibilities:
- `handleAddProductToCart()` — Add product with variant support
- `handleAdjustQuantity()` — Increment/decrement item quantity
- `handleDeleteCartItem()` — Remove item from cart
- `calculateCartSubtotal()`, `calculateCartDiscount()`, `calculateCartTaxes()`, `calculateCartGrandTotal()` — Live calculations
- `handleCheckoutPayment()` — Full payment processing with double-click guard
- `getNextInvoiceNumber()` — Atomic counter from backend with localStorage fallback
- `enqueueCustomerUpdate()` — Sequential customer update queue to prevent race conditions

### 9.4 useOrders — Order Management Hook

Key responsibilities:
- `handleCreateOrder()` — New order with table assignment
- `handleOpenOrder()` — Rebuild cart from KOT records
- `handleCreateTakeawayOrder()` — New takeaway with order number
- `handlePrintKOT()` / `handleConfirmKOT()` — KOT with delta detection
- `handleUpdateKOTStatus()` — Status progression (Accepted → Preparing → Ready → Served)
- `handleAddTable()`, `handleUpdateTable()`, `handleDeleteTable()` — Table management

---

## 10. Component Hierarchy

```
<App>
  │
  ├── [Loading] → Spinner
  │
  ├── [Not Authenticated] → <LoginScreen />
  │
  ├── [First-Time Setup] → <FirstTimeSetup />
  │
  └── [Authenticated & Setup Complete] →
        │
        ├── <AppTitleBar>
        │     ├── Restaurant Name
        │     ├── Clock (live update)
        │     ├── Online/Offline indicator
        │     ├── Branch selector (multi-branch only)
        │     └── Window controls
        │
        ├── <AppSidebar>
        │     ├── Workspace navigation links
        │     ├── Lock button
        │     ├── Logout button
        │     ├── Tour button
        │     └── Shortcuts button
        │
        └── <main>
              │
              ├── [Dashboard] → <DashboardWorkspace>
              │     ├── Stats cards (revenue, orders, items, discount)
              │     ├── Payment method breakdown
              │     ├── Category performance chart
              │     ├── Top items list
              │     ├── Cashier performance
              │     └── Quick action buttons
              │
              ├── [Orders] → <OrderManager>
              │     ├── <RestaurantFloorPlan> (table grid)
              │     ├── Table cards with status colors
              │     ├── Takeaway order cards
              │     └── Order list
              │
              ├── [Billing] →
              │     ├── <BillingProductGrid>
              │     │     ├── Category tabs
              │     │     ├── Search bar
              │     │     ├── Favorites toggle
              │     │     └── Product cards grid
              │     │
              │     └── <CartPanel> (resizable)
              │           ├── Customer section
              │           ├── Item list with quantity controls
              │           ├── Order type selector
              │           ├── Reward display
              │           ├── Totals (subtotal, discount, GST, grand total)
              │           ├── Payment method selector
              │           └── Action buttons (Hold, KOT, Pay, etc.)
              │
              ├── [Kitchen] → <KitchenDisplay>
              │     └── KOT cards with status management
              │
              ├── [Products] → <ProductManager>
              ├── [Customers] → <CustomerManager>
              ├── [Offers] → <OffersManager>
              ├── [Reports] → <ReportsManager>
              ├── [Staff] → <StaffManager>
              ├── [Branches] → <BranchManager>
              ├── [Settings] → <SettingsManager>
              ├── [ReceiptHistory] → <ReceiptHistory>
              ├── [Expenses] → <ExpenseManager>
              ├── [Reservations] → <ReservationWorkspace>
              ├── [Analytics] → <AnalyticsWorkspace>
              ├── [Finance] → <FinanceWorkspace>
              ├── [Inventory] → <InventoryManager>
              └── [More] → <MoreWorkspace>
        │
        └── [Modal System — Rendered at App Level]
              ├── <ReceiptModal>
              ├── <PaymentConfirmModal>
              ├── <KOTModal>
              ├── <KOTPreviewModal>
              ├── <SplitPaymentModal>
              ├── <OTPVerificationModal>
              ├── <HeldOrdersDrawer>
              ├── <DailySalesModal>
              ├── <ActivityFeedModal>
              ├── <ZReportModal>
              ├── <SyncPanelModal>
              ├── <VoidReasonModal>
              ├── <AddOnModal>
              ├── <ConfirmationDialog>
              ├── <OffersPopup>
              ├── <ShortcutsGuide>
              ├── <GuidedTour>
              ├── <OrderTimeline>
              └── <CustomerSearchPopup>
```

---

## 11. Modal System

All modals are toggled via `usePOSState` boolean state variables and rendered at the top level of `App.tsx`. This ensures:

- Modals float above all workspaces
- No z-index conflicts
- Keyboard shortcut handlers can toggle modals from anywhere
- `ConfirmationDialog` is reused across many actions with dynamic title/message/variant

| Modal | Trigger | State Variable |
|---|---|---|
| **ReceiptModal** | After payment, "View Receipt" | previewReceipt |
| **PaymentConfirmModal** | "Pay" button | isPaymentConfirmOpen |
| **KOTModal** | After KOT confirm/reprint | isKOTOpen, kotOrder |
| **KOTPreviewModal** | "Send to Kitchen" | isKOTPreviewOpen, kotPreviewData |
| **SplitPaymentModal** | "Split Payment" | isSplitPopupOpen |
| **OTPVerificationModal** | Large reward redemption | otpVerificationState |
| **HeldOrdersDrawer** | "Held Orders" | isHeldDrawerOpen |
| **DailySalesModal** | Dashboard "View Daily Sales" | isDailySalesOpen |
| **ActivityFeedModal** | "Activity Feed" | isHistoryFeedOpen |
| **ZReportModal** | "Z-Report" | isZReportOpen |
| **SyncPanelModal** | "Sync" | isSyncPanelOpen |
| **VoidReasonModal** | Void item action | isVoidReasonOpen |
| **AddOnModal** | Product with customization | isAddOnModalOpen, addOnModalProduct |
| **ConfirmationDialog** | Delete/Hold/Lockout/etc. | confirmState |
| **OffersPopup** | "Offers" | isOffersPopupOpen |
| **ShortcutsGuide** | Keyboard shortcut reference | isShortcutOpen |
| **GuidedTour** | Onboarding tour | isOnboardingOpen |
| **OrderTimeline** | View order history | isTimelineOpen, timelineEvents |
| **CustomerSearchPopup** | Search customer | isCustomerSearchOpen |

---

## 12. Order Lifecycle

### 12.1 Dine-In Order Lifecycle

```
1. CREATE
   │  User clicks table → handleCreateOrder('Dine In', tableId)
   │  Order created → status='New', table status='Occupied'
   │  Workspace switches to Billing
   ▼
2. ADD ITEMS
   │  User adds products → items added to cart
   │  Live calculations: subtotal, discount, GST, grand total
   ▼
3. SEND TO KITCHEN (KOT)
   │  User clicks "Send to Kitchen"
   │  KOTPreviewModal shows pending items (delta from last KOT)
   │  On confirm: KOT printed → status='Accepted'
   │  Order status → 'Accepted'
   ▼
4. KITCHEN PREPARES
   │  Kitchen staff sees order in KitchenDisplay
   │  Status: Accepted → Preparing → Ready
   │  When Ready: table status updates to 'Food Ready'
   ▼
5. SERVE
   │  Kitchen marks as Served → table status updates to 'Served'
   │  Waiter serves items to table
   ▼
6. BILLING
   │  User opens the order → cart rebuilt from KOT items
   │  Customer assigned (for loyalty)
   │  Reward applied if eligible
   ▼
7. PAYMENT
   │  PaymentConfirmModal → select method (Cash/UPI/Card/Wallet/Split)
   │  handleCheckoutPayment() → Bill created, invoice number assigned
   │  Points awarded to customer
   │  KOT records closed
   │  Table status → 'Paid' then 'Cleaning' then 'Available'
   ▼
8. RECEIPT
   │  ReceiptModal shows printable receipt
   │  Auto-print if enabled
   ▼
9. CLOSE
   │  Order status → 'Closed'
   │  Table status → 'Available'
```

### 12.2 KOT Lifecycle

```
Items added to cart
       │
       ▼
  KOT Preview (shows delta from last KOT snapshot)
       │
       ├── First KOT: sends all items (KOTType: 'Original')
       │
       ├── Additional KOT: sends only new/changed items (KOTType: 'Additional')
       │       └── Delta computed via computeKOTDelta() comparing cart vs lastKotSnapshot
       │
       └── Reprint: resends last KOT unchanged (KOTType: 'Reprint')
               └── Does NOT update lastKotSnapshot
       │
       ▼
  KOT Record created → status='Accepted'
       │
       ▼
  Kitchen Display updates:
  Accepted → Preparing → Ready → Served
       │
       └── All KOTs Served → Order status → 'Served'
```

---

## 13. Billing & Payment Flow

### 13.1 Price Calculation

```
Cart Items (item.price × item.quantity)
       │
       ▼
  Subtotal = Σ(item.price × item.quantity)
       │
       ▼
  Discount = AppliedReward (percentage/flat/item) + VisitMilestones
       │
       ▼
  GST = Σ(rowTaxable × (product.gstPercent / 100))
       │
       ▼
  Grand Total = max(0, Subtotal - Discount + GST)
       │
       ▼
  Points Earned = GrandTotal × loyaltyPointsPerDollar
```

### 13.2 Split Payment

Users can split payment across multiple methods:

```
SplitPaymentModal
  ├── Cash amount
  ├── Card amount
  ├── UPI amount
  └── Wallet amount
       │
       ▼
  Validation: sum of split amounts = grand total
       │
       ▼
  Store as splitDetails in the Bill
```

### 13.3 Double-Click Prevention

```typescript
const isProcessingPayment = useRef(false)  // Synchronous guard

const handleCheckoutPayment = async () => {
  if (isProcessingPayment.current) {
    showToast('Payment already in progress.', 'warning')
    return
  }
  isProcessingPayment.current = true
  try {
    return await _doCheckoutAsync()
  } finally {
    isProcessingPayment.current = false  // Resets only after ALL async operations complete
  }
}
```

---

## 14. Kitchen Display (KOT) Architecture

### 14.1 KOT Delta Computation

The `kotDelta.ts` utility computes which items need to be sent to the kitchen:

```typescript
function computeKOTDelta(
  currentCart: CartItem[],        // Current state of the cart
  lastSnapshot?: CartItem[]       // Last known snapshot of what was printed
): {
  toPrint: Array<{                // Items that need printing
    id: string
    product: Product
    selectedVariant?: ProductVariant
    printQty: number              // Only the delta quantity
    notes?: string
    price: number
  }>
}
```

Key behavior:
- Items with higher quantity than last snapshot: print the difference
- Items not in last snapshot at all: print full quantity
- Items with same or lower quantity: skip (already printed)

### 14.2 Kitchen Display Real-time Updates

```
KitchenDisplay component
       │
       ├── Reads orders from usePOSState (polled every 30s)
       ├── Filters orders with active KOT records (status !== 'New' && status !== 'Closed')
       ├── Groups items by KOT record
       ├── Displays KOT cards with:
       │     ├── Order number, table number, waiter name
       │     ├── Item list with quantities
       │     ├── Status badges (Accepted, Preparing, Ready, Served)
       │     └── Action buttons (Accept, Start, Ready, Serve)
       └── handleUpdateKOTStatus() → updates order + table status
```

---

## 15. Multi-Branch Architecture

### 15.1 Branch Data Isolation

```
usePOSState
  │
  ├── branches[]        — All branches (from API + localStorage)
  ├── currentBranchId   — Selected branch
  ├── isMultiBranchEnabled — From moduleSettings
  │
  ├── filterByBranch<T>(items): T[]
  │     └── Filters items by currentBranchId (if multi-branch enabled)
  │         Only applies when NOT head branch + owner role
  │
  ├── effectiveProducts — Products with per-branch price overrides merged
  ├── effectiveTables   — Tables from branchTables[currentBranchId] if available
  ├── effectiveSettings — Base settings merged with per-branch overrides
  │
  └── Branch-specific state:
        ├── branchSettings[ branchId ] — Partial<SystemSettings>
        ├── branchProductPrices[ branchId ][ productId ] — number
        ├── branchVariantPrices[ branchId ][ productId ][ variantName ] — number
        └── branchTables[ branchId ] — TableInfo[]
```

### 15.2 Branch Selector

```
AppTitleBar
  └── Branch dropdown (visible when multi-branch enabled + Owner/Manager role)
        └── setCurrentBranchId(branchId)
              └── Triggers state recomputation → all filtered/effective data updates
```

---

## 16. Role-Based Access Control

### 16.1 Role Hierarchy

```
Owner  → Full access to ALL workspaces and settings
  │
Manager → Configurable access via Owner's permission toggles
  │         Can access: Dashboard, Orders, Billing, Kitchen, More
  │         Conditional: Products, Customers, Offers, Reports, Staff,
  │                      Branches, Settings, Expenses, Reservations,
  │                      Analytics, Finance, Inventory
  │
Cashier → Always restricted to operational panels only
           Dashboard, Orders, Billing, Kitchen, More, ReceiptHistory
```

### 16.2 Permission Toggles

```typescript
interface RolePermissions {
  managerCanAccessSettings: boolean
  managerCanManageStaff: boolean
  managerCanManageProducts: boolean
  managerCanManageExpenses: boolean
  managerCanAccessReports: boolean
  managerCanAccessAnalytics: boolean
  managerCanAccessFinance: boolean
  managerCanAccessInventory: boolean
  managerCanManageCustomers: boolean
  managerCanManageOffers: boolean
  managerCanAccessReservations: boolean
  managerCanAccessBranches: boolean
}
```

### 16.3 Workspace Access Guard

```typescript
const WORKSPACE_ACCESS: Record<string, { permission?: keyof RolePermissions }> = {
  Dashboard: {},
  Orders: {},
  Billing: {},
  Kitchen: {},
  More: {},
  ReceiptHistory: {},
  Products: { permission: 'managerCanManageProducts' },
  Customers: { permission: 'managerCanManageCustomers' },
  // ... etc
}

const canAccessWorkspace = (ws: string): boolean => {
  if (employee.role === 'Owner') return true
  if (employee.role === 'Cashier') return ['Dashboard','Orders','Billing','Kitchen','More','ReceiptHistory'].includes(ws)
  if (employee.role === 'Manager') {
    const access = WORKSPACE_ACCESS[ws]
    if (!access || !access.permission) return true
    return rolePermissions[access.permission] === true
  }
  return true
}
```

---

## 17. Desktop Architecture (Electron)

### 17.1 Electron Configuration

The `restaurant-pos` Electron setup is unique: the main process and preload scripts live in `restaurant-pos/electron/` but the Vite dev server serves the React app from `restaurant-pos/Frontend/`.

```json
// electron/package.json
{
  "name": "pos-terminal-electron",
  "main": "main.js"
}
```

### 17.2 Electron Main Process

```typescript
// Responsibilities:
// 1. Create BrowserWindow (fullscreenable, min 1280x720)
// 2. Load Vite dev server URL in development or built dist/ in production
// 3. IPC handlers for:
//    - Print receipt via electron print API
//    - App info (version, platform)
//    - File dialogs
// 4. Splash screen support
```

### 17.3 Build Chain

```
Source
  │
  ├── Vite build → Frontend/dist/
  │
  └── esbuild → electron/main.js + preload.js
       │
       └── electron-builder
             ├── win: NSIS
             ├── mac: DMG
             └── linux: AppImage + Deb
```

---

## 18. Build & Deployment

### 18.1 Development Workflow

The monorepo uses concurrently to run frontend, backend, and (optionally) Electron:

```bash
# Frontend only
cd restaurant-pos/Frontend && npm run dev

# Backend
cd backend && npm run dev

# Full stack with Electron (from root restaurant-pos/)
npm run dev:electron
```

### 18.2 Production Build

```bash
cd restaurant-pos/Frontend
npm run build    # Vite build + server esbuild

cd restaurant-pos
npm run package  # electron-builder
```

---

## 19. Performance Considerations

| Strategy | Implementation |
|---|---|
| **localStorage First Render** | All state initializes from localStorage synchronously for instant first paint |
| **TTL-Aware API Calls** | `fetchIfStale()` skips API if cache timestamp is fresh |
| **Background Polling** | Only polls orders/tables (live data), not slow-changing data |
| **Pagination-Free** | All data loads in full (local-first — no pagination needed) |
| **Cart Item Limit** | localStorage only keeps last 50 bills to cap storage |
| **Memoized Derived State** | All computed values use `useMemo` with proper dependency arrays |
| **Workspace Unmount** | Workspaces unmount when switching (via conditional rendering, not router) |
| **Ref-Based Guards** | `useRef` for double-click prevention (synchronous, no re-render delay) |
| **Error Boundary** | `ErrorBoundary` wraps each workspace to prevent full-app crashes |
| **Branch Filtering** | `useMemo` ensures filtered data only recomputes when branch/items change |
| **Debounced Search** | Keyboard shortcuts directly set search state (instant), not debounced |
