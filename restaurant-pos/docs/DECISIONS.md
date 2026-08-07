# Architecture Decisions & Rationale
## Restaurant POS — Point of Sale & Restaurant Management System

**Last Updated:** July 27, 2026

---

## Decision Log

### D-001: Offline-First Architecture

| Property | Value |
|---|---|
| **Date** | 2026-Q1 |
| **Status** | ✅ Accepted |
| **Context** | Restaurants frequently have unreliable internet connectivity. POS operations must never be interrupted by network issues. |
| **Decision** | All core POS operations work fully offline. Data is persisted to localStorage immediately. API calls are fire-and-forget in the background. |
| **Rationale** | "localStorage is source of truth, not the server." All state initializes from localStorage for instant render. API results update state and localStorage together. API failures are silent — data is never lost. |
| **Consequences** | All state reads from localStorage on mount. Mutations write to localStorage synchronously, API asynchronously. Sync engine manages background reconciliation. |

### D-002: Central State Hook (usePOSState) Instead of Context/Redux

| Property | Value |
|---|---|
| **Date** | 2026-Q1 |
| **Status** | ✅ Accepted |
| **Context** | Hundreds of state variables across 18 workspaces and 15+ modals. Need a single orchestration point. |
| **Decision** | Use a single `usePOSState()` hook with 80+ state variables, passed as props to child hooks and components. |
| **Rationale** | All state is in one place — easy to understand, debug, and persist. Child hooks (`useBilling`, `useOrders`, `useLoyalty`) receive only the state they need as config objects. No context provider needed. |
| **Consequences** | The hook is ~800 lines. Re-renders affect all consumers — mitigated by `useMemo` for derived state and `useCallback` for handlers. |

### D-003: Composable Custom Hooks for Business Logic

| Property | Value |
|---|---|
| **Date** | 2026-Q1 |
| **Status** | ✅ Accepted |
| **Context** | Billing logic, order management, and loyalty have complex, interrelated state mutations. |
| **Decision** | Extract business logic into `useBilling`, `useOrders`, `useLoyalty` hooks. |
| **Rationale** | Separates concerns. Hooks are testable in isolation. App.tsx orchestrates by passing state from `usePOSState` into each hook. |
| **Consequences** | Hooks don't own state — they receive it as config and return action handlers. All state mutations flow back through `usePOSState`. |

### D-004: localStorage for Offline Persistence (Not IndexedDB)

| Property | Value |
|---|---|
| **Date** | 2026-Q1 |
| **Status** | ✅ Accepted |
| **Context** | Need to persist 20+ data entities for offline use. |
| **Decision** | Use `localStorage` with timestamped cache entries. |
| **Rationale** | localStorage is synchronous — no async overhead for reads. Simpler API than IndexedDB. Sufficient capacity for restaurant data (5-10MB). Timestamped entries enable TTL-aware cache freshness checks. |
| **Consequences** | ~5MB limit (usually sufficient). Only last 50 bills are stored to cap usage. String-only storage (JSON.parse/stringify overhead). |

### D-005: TTL-Aware Caching for API Calls

| Property | Value |
|---|---|
| **Date** | 2026-Q1 |
| **Status** | ✅ Accepted |
| **Context** | Some data changes rarely (products, employees) while other data is live (orders, tables). |
| **Decision** | Implement TTL constants (SLOW=5min, MEDIUM=2min, FAST=30s, LIVE=0s) and skip API calls if cache is fresh. |
| **Rationale** | Reduces unnecessary API calls. Fast initial render from cache. Different TTLs match data volatility. |
| **Consequences** | `fetchIfStale()` pattern used everywhere. Cache timestamps survive page reloads via `pos_cache_meta`. |

### D-006: Ref-Based Double-Click Guard for Payments

| Property | Value |
|---|---|
| **Date** | 2026-Q1 |
| **Status** | ✅ Accepted |
| **Context** | Payment processing is async and must not be triggered twice. UI state alone is insufficient (re-render lag). |
| **Decision** | Use `useRef` as the authoritative guard, plus a UI state variable for visual feedback. |
| **Rationale** | `useRef` reads are synchronous (no re-render delay). The guard is set before the first async operation and cleared only after ALL operations complete in `finally` block. |
| **Consequences** | `isProcessingPayment.current` is the single source of truth. `isProcessingPaymentUI` triggers button "Processing..." state. |

### D-007: KOT Delta Detection Instead of Sending All Items

| Property | Value |
|---|---|
| **Date** | 2026-Q1 |
| **Status** | ✅ Accepted |
| **Context** | When sending items to kitchen, we should only send items that haven't been sent yet (or have increased quantity). |
| **Decision** | Track a `lastKotSnapshot` on each order. Compute delta between current cart and last snapshot. Only send delta items. |
| **Rationale** | Prevents duplicate printing. Ensures kitchen only sees new/changed items. `kotDelta.ts` utility computes the diff. |
| **Consequences** | Orders track `lastKotSnapshot: CartItem[]`. KOT types: Original (first), Additional (delta), Reprint (full repeat). |

### D-008: Workspace-Based Navigation (Not Traditional Routing)

| Property | Value |
|---|---|
| **Date** | 2026-Q1 |
| **Status** | ✅ Accepted |
| **Context** | 18 screens that behave like workspaces, not navigable pages. Billing workspace needs full screen (no sidebar). |
| **Decision** | Use workspace state (`activeWorkspace`) with conditional rendering. Sync to URL for browser navigation support. |
| **Rationale** | Workspace pattern is more natural for POS (like a kiosk). URL sync enables back/forward browser buttons. Billing workspace can hide sidebar without routing complexity. |
| **Consequences** | All workspaces rendered in `App.tsx` via conditional logic. URL ↔ workspace sync via `routes.ts`. Bidirectional sync to prevent loops. |

### D-009: Role-Based Access Control (Workspace Gating)

| Property | Value |
|---|---|
| **Date** | 2026-Q1 |
| **Status** | ✅ Accepted |
| **Context** | Three roles (Owner, Manager, Cashier) with different access levels. Manager access should be configurable by Owner. |
| **Decision** | Workspace-level access guard. Owner always has access. Cashier restricted to operational workspaces. Manager access controlled by permission toggles. |
| **Rationale** | Simple, explicit gating at the root level. Permission toggles are stored in settings and editable by Owner. Access checked on workspace change. |
| **Consequences** | `WORKSPACE_ACCESS` map defines which permission each workspace requires. `canAccessWorkspace()` checks role + permissions. Unauthorized access redirects to Dashboard with warning toast. |

### D-010: Branch-Aware Data Filtering

| Property | Value |
|---|---|
| **Date** | 2026-Q1 |
| **Status** | ✅ Accepted |
| **Context** | Multi-branch support requires data isolation per branch while allowing cross-branch management. |
| **Decision** | All data carries `branchId`. `filterByBranch()` filters data by current branch. Per-branch pricing and settings override global defaults. |
| **Rationale** | Branch-aware filtering is centralized in `usePOSState` via `useMemo`. Global data is preserved for head branch and Owner role. |
| **Consequences** | Filtered copies: `filteredOrders`, `filteredTables`, `filteredProducts`, etc. Branch-specific state: `branchSettings`, `branchProductPrices`, `branchTables`. Effective data merges branch overrides with global. |

### D-011: SyncEngine Pub/Sub for Cross-Tab Syncing

| Property | Value |
|---|---|
| **Date** | 2026-Q1 |
| **Status** | ✅ Accepted |
| **Context** | Multiple POS terminals in the same restaurant need to stay in sync when online. |
| **Decision** | Singleton `SyncEngine` class with publish/subscribe pattern. Tracks stale keys and triggers targeted re-fetches. |
| **Rationale** | Lightweight alternative to BroadcastChannel API. Subscribers can re-fetch only stale entity types. Auto-sync on reconnection. |
| **Consequences** | `markStale(entityType)` marks specific types for re-fetch. `consumeStaleKeys()` returns pending stale keys. `setOnline()` triggers auto-sync. |

### D-012: Axios with Fire-and-Forget API Pattern

| Property | Value |
|---|---|
| **Date** | 2026-Q1 |
| **Status** | ✅ Accepted |
| **Context** | API calls should never block the UI. Offline scenarios must not cause errors. |
| **Decision** | All API calls use `.catch(err => debugWarn(...))` — fire and forget. Error handler set via `setOnApiError()`. |
| **Rationale** | UI updates from local state immediately. API failures are logged but don't affect user experience. Offline is transparent. |
| **Consequences** | No `await` on API mutations (except invoice number fetch which has fallback). Errors are silently logged. Toast shown only for critical failures. |

### D-013: Atomic Invoice Counters via Backend

| Property | Value |
|---|---|
| **Date** | 2026-Q1 |
| **Status** | ✅ Accepted |
| **Context** | Invoice numbers must be unique across multiple POS terminals in the same restaurant. |
| **Decision** | Backend uses `InvoiceCounter.findOneAndUpdate({ $inc: { counter: 1 } })` for thread-safe increments. Frontend fetches next number before creating bill. Falls back to localStorage counter when offline. |
| **Rationale** | MongoDB's `findOneAndUpdate` with `$inc` is atomic. Multiple terminals cannot get the same number. LocalStorage fallback works offline but may produce duplicates. |
| **Consequences** | Invoice numbers are sequential. Offline fallback may duplicate when multiple terminals are offline. Duplicates can be resolved manually. |

### D-014: React Router v7 for URL Sync (Not for Navigation)

| Property | Value |
|---|---|
| **Date** | 2026-Q1 |
| **Status** | ✅ Accepted |
| **Context** | Need browser URL to reflect current workspace for back/forward navigation. |
| **Decision** | Use React Router DOM v7 — but only for URL sync, not for route rendering. |
| **Rationale** | All rendering is workspace-conditional, not route-based. URL is a side effect of workspace changes, not the source of truth. |
| **Consequences** | Two `useEffect`s: URL → workspace (browser nav) and workspace → URL (internal nav). No route guards — all guards are workspace-level. |

### D-015: Tailwind CSS with Tailwind CSS v4

| Property | Value |
|---|---|
| **Date** | 2026-Q1 |
| **Status** | ✅ Accepted |
| **Context** | Need fast, consistent styling for 18 workspaces and 15+ modals. |
| **Decision** | Use Tailwind CSS 4 with `@tailwindcss/vite` plugin. |
| **Rationale** | Zero-runtime CSS. Utility-first approach enables rapid UI development. Consistent design tokens across all components. |
| **Consequences** | All styling is utility-class based. Custom CSS in `index.css` only for complex animations. |

### D-016: No State Management Library (No Redux/Zustand)

| Property | Value |
|---|---|
| **Date** | 2026-Q1 |
| **Status** | ✅ Accepted |
| **Context** | Need to manage complex POS state without adding heavy dependencies. |
| **Decision** | Use React's built-in `useState` + `useMemo` + `useCallback` patterns. No external state management library. |
| **Rationale** | All state is local to the POS session (no global store needed). localStorage handles persistence. React Query is not used — API is fire-and-forget. |
| **Consequences** | All state flows through `usePOSState`. Child hooks receive slice of state. No middleware, no reducers, no actions. |

---

## Technology Choices Summary

| Category | Choice | Alternative(s) Considered | Rationale |
|---|---|---|---|
| **UI Framework** | React 19 | Vue 3, Svelte 5 | Ecosystem, library support |
| **Language** | TypeScript 5.8 | JavaScript | Type safety |
| **Build Tool** | Vite 6 | Webpack, Turbopack | Speed, HMR quality |
| **CSS** | Tailwind CSS 4 | Styled Components | Zero-runtime, consistency |
| **State Management** | React hooks + localStorage | Redux, Zustand, React Query | Simplicity, offline-first |
| **Routing** | React Router v7 | TanStack Router | Ecosystem standard |
| **HTTP Client** | Axios | Fetch | Interceptors |
| **Charts** | Recharts | Chart.js, D3 | React-native API |
| **Desktop** | Electron | Tauri | Ecosystem maturity |
| **Icons** | Lucide React | Heroicons | Tree-shakable, design |
| **Drag & Drop** | dnd-kit | react-beautiful-dnd | Maintained, flexible |
| **Animations** | Motion (Framer) | GSAP, animejs | React-native, tree-shakable |
| **Testing** | Vitest + Playwright | Jest, Cypress | Speed, E2E + unit coverage |
| **AI** | Google Generative AI | OpenAI, Anthropic | Availability, pricing |
| **Database** | MongoDB | PostgreSQL, SQLite | Document model, flexibility |

---

## Anti-Patterns Avoided

| Anti-Pattern | Why Avoided |
|---|---|
| **Redux for all state** | 80+ state variables would create enormous reducer boilerplate |
| **Server as source of truth** | Offline-first requires local-first data flow |
| **Synchronous API calls** | Would block UI during network delays |
| **Debounced API saves** | Fire-and-forget with localStorage persistence is simpler |
| **Nested routing** | Workspace pattern is more natural for POS/kiosk UIs |
| **Context providers for state** | Single hook with prop passing is simpler for POS use case |
| **Optimistic updates** | Not needed — local state IS the source of truth |
| **CSS-in-JS at runtime** | Tailwind is more performant and maintainable |
