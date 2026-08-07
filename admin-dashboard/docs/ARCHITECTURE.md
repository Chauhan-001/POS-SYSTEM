# Architecture Document
## Admin Dashboard — Restaurant Chain Management Platform

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
6. [Component Hierarchy](#6-component-hierarchy)
7. [Data Flow](#7-data-flow)
8. [State Management](#8-state-management)
9. [Routing & Navigation](#9-routing--navigation)
10. [API Integration](#10-api-integration)
11. [Authentication & Authorization](#11-authentication--authorization)
12. [Desktop Architecture (Electron)](#12-desktop-architecture-electron)
13. [Build & Deployment](#13-build--deployment)
14. [Performance Considerations](#14-performance-considerations)
15. [Security Architecture](#15-security-architecture)

---

## 1. System Overview

The Admin Dashboard is a **centralized management platform** for restaurant chains. It is built as a **React SPA** that runs in two modes:

- **Desktop App**: Electron shell for native OS integration (notifications, file dialogs, auto-updates)
- **Web App**: Standard Vite build for browser access

The backend is a **RESTful Express API** backed by **MongoDB**, providing CRUD operations for all admin entities (restaurants, owners, devices, subscriptions) alongside analytics endpoints.

---

## 2. Architecture Principles

| Principle | Rationale |
|---|---|
| **Component-Based UI** | Every UI element is a reusable React component with well-defined props |
| **Lazy Loading** | All route-level pages are lazy-loaded for optimal initial bundle size |
| **Server State Management** | TanStack React Query manages all server data with caching, deduplication, and background refetch |
| **Separation of Concerns** | Pages → Components → Hooks → API Client, each layer with a single responsibility |
| **Dark Mode First** | Full dark mode via Tailwind CSS `dark:` variant with theme context |
| **Offline Resilience** | API errors are caught gracefully; stale data is displayed with retry options |
| **Desktop-Native Where Needed** | Electron IPC for file system access, notifications, and window management |

---

## 3. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENT LAYER                              │
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │                 Electron Shell (Optional)                  │   │
│  │  ┌─────────────────────────────────────────────────────┐  │   │
│  │  │  Main Process (electron/main.ts)                    │  │   │
│  │  │  • Window creation & lifecycle                       │  │   │
│  │  │  • Native menus, notifications, file dialogs         │  │   │
│  │  │  • IPC handlers for app info, env vars               │  │   │
│  │  │  • Auto-updater integration                          │  │   │
│  │  └─────────────────────────────────────────────────────┘  │   │
│  │  ┌─────────────────────────────────────────────────────┐  │   │
│  │  │  Preload Script (electron/preload.ts)               │  │   │
│  │  │  • contextBridge.exposeInMainWorld('electronAPI', ) │  │   │
│  │  │  • Secure IPC channel exposure                      │  │   │
│  │  └─────────────────────────────────────────────────────┘  │   │
│  └───────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │               React Application (SPA)                      │   │
│  │                                                             │   │
│  │  ┌─────────────────────────────────────────────────────┐  │   │
│  │  │  Entry Point (src/main.tsx)                         │  │   │
│  │  │  • React 19 StrictMode                              │  │   │
│  │  │  • Providers: QueryClient, Theme, Auth, Sidebar     │  │   │
│  │  │  • RouterProvider with lazy-loaded pages             │  │   │
│  │  │  • Toaster (react-hot-toast)                        │  │   │
│  │  └─────────────────────────────────────────────────────┘  │   │
│  │                                                             │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │   │
│  │  │  Pages   │  │  Layouts │  │Components│  │  Context │  │   │
│  │  │          │  │          │  │          │  │          │  │   │
│  │  │ Dashboard│  │Dashboard │  │  Button  │  │   Auth   │  │   │
│  │  │Restaurant│  │  Layout  │  │   Card   │  │  Theme   │  │   │
│  │  │  Owners  │  │  Navbar  │  │   Table  │  │ Sidebar  │  │   │
│  │  │ Devices  │  │ Sidebar  │  │  Badge   │  │          │  │   │
│  │  │   Subs   │  │          │  │  Modal   │  │          │  │   │
│  │  │Analytics │  │          │  │ Skeleton │  │          │  │   │
│  │  │ AI Usage │  │          │  │  Input   │  │          │  │   │
│  │  │ Support  │  │          │  │ ......   │  │          │  │   │
│  │  │ Settings │  │          │  │          │  │          │  │   │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘  │   │
│  │                                                             │   │
│  │  ┌─────────────────────────────────────────────────────┐  │   │
│  │  │  API Layer (src/api/)                               │  │   │
│  │  │  • client.ts — Axios instance with interceptors     │  │   │
│  │  │  • restaurants.ts, owners.ts, devices.ts, etc.      │  │   │
│  │  └─────────────────────────────────────────────────────┘  │   │
│  │                                                             │   │
│  │  ┌─────────────────────────────────────────────────────┐  │   │
│  │  │  Utilities (src/utils/)                              │  │   │
│  │  │  • cn.ts — clsx + tailwind-merge class merge        │  │   │
│  │  │  • format.ts — date, number, currency formatting    │  │   │
│  │  └─────────────────────────────────────────────────────┘  │   │
│  └───────────────────────────────────────────────────────────┘   │
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTPS / REST
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│                       BACKEND LAYER                              │
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │              Express Server (backend/src/server.ts)        │   │
│  │  • CORS-enabled                                            │   │
│  │  • JSON body parsing                                       │   │
│  │  • Rate limiting                                           │   │
│  │  • Helmet security headers                                 │   │
│  └───────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌────────┐  ┌────────────┐  ┌────────────┐  ┌──────────────┐ │   │
│  │  Auth  │  │Controllers │  │ Middleware  │  │  Validation  │ │   │
│  │ Routes │  │  + Services │  │             │  │   (Zod)     │ │   │
│  └────────┘  └────────────┘  └────────────┘  └──────────────┘ │   │
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │              MongoDB (Mongoose Models)                     │   │
│  │  • User (admin accounts)                                   │   │
│  │  • Restaurant (tenant)                                     │   │
│  │  • Subscription (plan management)                         │   │
│  │  • Device (POS terminal registry)                         │   │
│  │  • Branch (restaurant locations)                          │   │
│  │  • InvoiceCounter (atomic increment)                      │   │
│  └───────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. Frontend Architecture

### 4.1 Layer Breakdown

```
Pages (src/pages/)
├── Login.tsx                    — Admin login form
├── Dashboard.tsx                — Stats grid, activity, latest restaurants
├── Restaurants.tsx              — CRUD table with search/filter/pagination
├── RestaurantDetails.tsx        — Detail view with tabs
├── Owners.tsx                   — Owner management table
├── Subscriptions.tsx            — Subscription CRUD with renew/pause/resume
├── Devices.tsx                  — Device registry with block/unblock
├── Analytics.tsx                — Multi-chart analytics dashboard
├── AIUsage.tsx                  — AI feature usage metrics
├── Support.tsx                  — Unified search across entities
├── Settings.tsx                 — Sectioned configuration pages
├── Profile.tsx                  — Admin profile management
└── ...
```

### 4.2 UI Component Library

All UI components live in `src/components/ui/` and are designed to be composable, themed, and accessible.

| Component | Description |
|---|---|
| **Button** | 6 variants (primary, secondary, danger, warning, ghost, outline), 3 sizes, loading spinner |
| **Card** | Container with header, title, description slots; optional hover shadow |
| **Table** | Typed generic `<T>` table with columns, pagination, loading skeleton, empty state |
| **Badge** | Status indicators (success, danger, warning, info, neutral) |
| **Modal** | Overlay dialog with title, content, and action buttons |
| **ConfirmDialog** | Confirmation modal with variant-aware styling |
| **Input** | Form input with label support |
| **Skeleton** | Loading placeholder animations |
| **ErrorPage** | Full-page error state with retry button |
| **EmptyState** | Blank slate with icon, title, description |
| **LoadingSpinner** | Animated SVG spinner |
| **ProtectedRoute** | Auth guard that redirects to login if unauthenticated |
| **SearchInput** | Debounced search input with consistent styling |

### 4.3 Project Structure

```
admin-dashboard/
├── electron/
│   ├── main.ts              — Electron main process
│   ├── preload.ts           — Context bridge for renderer
│   └── electron-builder.json— Build config for all platforms
├── src/
│   ├── main.tsx             — Application entry point
│   ├── style.css            — Global styles + Tailwind
│   ├── routes/
│   │   └── index.tsx        — React Router v7 configuration
│   ├── context/
│   │   ├── AuthContext.tsx   — JWT auth state + login/logout
│   │   ├── ThemeContext.tsx  — Dark mode toggle
│   │   └── SidebarContext.tsx— Sidebar collapse state
│   ├── layouts/
│   │   ├── DashboardLayout.tsx — Sidebar + Navbar + Outlet
│   │   ├── Sidebar.tsx         — Navigation sidebar
│   │   └── Navbar.tsx          — Top bar with search/notifications/profile
│   ├── pages/
│   │   ├── Dashboard.tsx
│   │   ├── Restaurants.tsx
│   │   ├── RestaurantDetails.tsx
│   │   ├── Owners.tsx
│   │   ├── Subscriptions.tsx
│   │   ├── Devices.tsx
│   │   ├── Analytics.tsx
│   │   ├── AIUsage.tsx
│   │   ├── Support.tsx
│   │   ├── Settings.tsx
│   │   ├── Profile.tsx
│   │   └── Login.tsx
│   ├── components/
│   │   └── ui/              — Reusable UI primitives
│   │       ├── Button.tsx
│   │       ├── Card.tsx
│   │       ├── Table.tsx
│   │       ├── Badge.tsx
│   │       ├── Modal.tsx
│   │       ├── Input.tsx
│   │       ├── Skeleton.tsx
│   │       ├── ErrorPage.tsx
│   │       ├── EmptyState.tsx
│   │       ├── LoadingSpinner.tsx
│   │       └── ProtectedRoute.tsx
│   ├── api/
│   │   ├── client.ts        — Axios instance with interceptors
│   │   ├── analytics.ts     — Dashboard stats + analytics
│   │   ├── subscriptions.ts — Subscription CRUD
│   │   ├── restaurants.ts   — Restaurant CRUD
│   │   ├── owners.ts        — Owner CRUD
│   │   ├── devices.ts       — Device management
│   │   ├── settings.ts      — System settings
│   │   └── support.ts       — Support search
│   └── utils/
│       ├── cn.ts            — Class name merge (clsx + twMerge)
│       └── format.ts        — Date, number, currency formatters
├── index.html               — Vite HTML entry
├── package.json             — Dependencies & scripts
├── vite.config.ts           — Vite configuration
├── tsconfig.json            — TypeScript configuration
└── PRD.md                   — Product requirements
```

---

## 5. Backend Architecture

### 5.1 Route Structure

```
backend/src/routes/
├── admin.ts          — All admin-facing routes (restaurants, owners, devices, subs, settings)
├── auth.ts           — Login, refresh, logout, register owner
├── branches.ts       — Multi-branch management
├── products.ts       — Menu product CRUD
├── orders.ts         — Full order lifecycle
├── bills.ts          — Bill/invoice management + invoice counter
├── tables.ts         — Table layout CRUD + bulk replace
├── customers.ts      — Customer loyalty profiles
├── expenses.ts       — Expense tracking
├── reservations.ts   — Reservations + waiting list
├── employees.ts      — Staff management
├── sync.ts           — Offline sync endpoint
├── rewards.ts        — Loyalty rewards CRUD
└── takeawayOrders.ts — Takeaway order management
```

### 5.2 Middleware Pipeline

```
Request → Rate Limiter → CORS → Helmet → JSON Parser
         → Auth Middleware (JWT verification)
         → Authorization Middleware (collection-level access control)
         → Validation Middleware (Zod schemas)
         → Controller
         → Response
```

### 5.3 Database Models

| Model | Key Fields | Purpose |
|---|---|---|
| **User** | username, email, password, role, status | Admin accounts |
| **Restaurant** | name, phone, address, plan, status, maxDevices, aiEnabled | Restaurant tenant |
| **Subscription** | restaurantId, plan, status, price, expiryDate, maxDevices | Billing & plans |
| **Device** | deviceId, deviceName, restaurantId, os, osVersion, status | POS terminal registry |
| **Branch** | restaurantId, name, address, phone, isHeadBranch, isActive | Multi-location |
| **InvoiceCounter** | restaurantId/branchId, counter | Atomic invoice numbering |

---

## 6. Component Hierarchy

```
<App>
  <QueryClientProvider>
    <ThemeProvider>
      <AuthProvider>
        <SidebarProvider>
          <RouterProvider>
            <Routes>
              ├── /login → <Login />
              └── / → <ProtectedRoute>
                    └── <DashboardLayout>
                          ├── <Sidebar />
                          ├── <Navbar />
                          └── <Outlet> (lazy-loaded pages)
                                ├── /dashboard → <Dashboard />
                                │     ├── StatsCard[]
                                │     ├── RecentActivity
                                │     ├── LatestRestaurants
                                │     ├── SubscriptionOverview
                                │     └── QuickActions
                                ├── /restaurants → <Restaurants />
                                │     ├── SearchInput + Filter
                                │     ├── Table<Restaurant>
                                │     ├── Create/Edit Modal
                                │     └── ConfirmDialog
                                ├── /restaurants/:id → <RestaurantDetails />
                                ├── /owners → <Owners />
                                ├── /subscriptions → <Subscriptions />
                                ├── /devices → <Devices />
                                ├── /analytics → <Analytics />
                                │     └── Recharts (Area, Bar, Line)
                                ├── /ai-usage → <AIUsage />
                                ├── /support → <Support />
                                ├── /settings → <Settings />
                                │     └── SettingsSection[] (Company, Subs, AI, General)
                                └── /profile → <Profile />
            </Routes>
            <Toaster />
          </SidebarProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </QueryClientProvider>
</App>
```

---

## 7. Data Flow

### 7.1 Data Fetching Pattern

```
User navigates to page
       │
       ▼
Page component mounts
       │
       ├── useQuery({ queryKey, queryFn })
       │       │
       │       ▼
       │   TanStack React Query
       │       │
       │       ├── Cache hit → Return cached data (staleTime = 30s)
       │       │
       │       └── Cache miss → Call queryFn
       │               │
       │               ▼
       │           API module (e.g., api/restaurants.ts)
       │               │
       │               ▼
       │           Axios instance (api/client.ts)
       │               │
       │               ├── Attach Bearer token from localStorage
       │               │
       │               ▼
       │           Express Backend
       │               │
       │               ├── Auth middleware → verify JWT
       │               ├── Authorization middleware → check permissions
       │               ├── Controller → Service → MongoDB
       │               │
       │               ▼
       │           Response → Axios interceptor
       │               │
       │               ├── 401 → Clear token, redirect to /login
       │               │
       │               ▼
       │           React Query → update cache → re-render
       │
       ▼
   Page renders with data + loading/error states
```

### 7.2 Mutation Flow

```
User clicks action (Create, Edit, Delete, Suspend, etc.)
       │
       ▼
  useMutation() fires
       │
       ├── Optimistic update (optional)
       │
       ▼
  API call (POST/PUT/DELETE)
       │
       ├── Success → invalidateQueries() → toast.success()
       │
       └── Error → toast.error() with server message
```

---

## 8. State Management

### 8.1 State Types

| State Type | Mechanism | Where |
|---|---|---|
| **Server State** | TanStack React Query | All API data (restaurants, owners, devices, etc.) |
| **Auth State** | React Context (AuthContext) | JWT token, user profile, login/logout |
| **UI State** | React Context (ThemeContext, SidebarContext) | Dark mode, sidebar collapse |
| **Form State** | React local state (`useState`) | Modal forms, search inputs |
| **Query Params** | React local state | Page number, search query, filters |

### 8.2 Query Configuration

```typescript
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,              // Retry once on failure
      refetchOnWindowFocus: false,  // Don't refetch on focus
      staleTime: 30_000,     // Consider data fresh for 30s
    },
  },
})
```

---

## 9. Routing & Navigation

### 9.1 Route Configuration

Uses **React Router DOM v7** with `createBrowserRouter` and lazy-loaded pages.

| Route | Page Component | Guard |
|---|---|---|
| `/login` | `Login` | None (public) |
| `/` | Redirect → `/dashboard` | `ProtectedRoute` |
| `/dashboard` | `Dashboard` | `ProtectedRoute` |
| `/restaurants` | `Restaurants` | `ProtectedRoute` |
| `/restaurants/:id` | `RestaurantDetails` | `ProtectedRoute` |
| `/owners` | `Owners` | `ProtectedRoute` |
| `/subscriptions` | `Subscriptions` | `ProtectedRoute` |
| `/devices` | `Devices` | `ProtectedRoute` |
| `/analytics` | `Analytics` | `ProtectedRoute` |
| `/ai-usage` | `AIUsage` | `ProtectedRoute` |
| `/support` | `Support` | `ProtectedRoute` |
| `/settings` | `Settings` | `ProtectedRoute` |
| `/profile` | `Profile` | `ProtectedRoute` |
| `*` | Redirect → `/dashboard` | — |

### 9.2 Lazy Loading

Every page component is loaded via `React.lazy()` with a suspense fallback:

```typescript
const Dashboard = lazy(() => import('../pages/Dashboard'))

<Suspense fallback={<LoadingSpinner size="lg" />}>
  <Dashboard />
</Suspense>
```

---

## 10. API Integration

### 10.1 Axios Client Configuration

The Axios instance in `api/client.ts` handles:

- **Base URL**: From `VITE_API_URL` environment variable
- **Auth Header**: Automatically attaches `Bearer` token from `localStorage`
- **401 Interceptor**: Clears tokens and redirects to `/login`
- **Content-Type**: JSON

### 10.2 API Module Pattern

Each entity has a dedicated API module with typed functions:

```typescript
// api/restaurants.ts
export async function getRestaurants(filters: RestaurantsFilter): Promise<PaginatedResponse<Restaurant>> {
  const { data } = await apiClient.get('/admin/restaurants', { params: filters })
  return data
}

export async function createRestaurant(payload: CreateRestaurantPayload): Promise<Restaurant> {
  const { data } = await apiClient.post('/admin/restaurants', payload)
  return data
}
```

### 10.3 Pagination

All list endpoints return a paginated response:

```typescript
interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  totalPages: number
  limit: number
}
```

---

## 11. Authentication & Authorization

### 11.1 Admin Login Flow

```
1. User submits credentials on Login form
2. POST /api/auth/admin/login
3. Backend validates credentials, returns JWT + refresh token
4. Frontend stores tokens in localStorage
5. AuthContext updates, ProtectedRoute allows access
6. Axios interceptor attaches Bearer token to all subsequent requests
```

### 11.2 Authorization Model

Backend uses **collection-level access control**:

```typescript
// Examples
router.get('/admin/restaurants', requireAuth, requireCollectionAccess('Restaurant', 'read'), getRestaurants)
router.post('/admin/restaurants', requireAuth, requireCollectionAccess('Restaurant', 'create'), createRestaurant)
router.put('/admin/restaurants/:id', requireAuth, requireCollectionAccess('Restaurant', 'update'), updateRestaurant)
router.delete('/admin/restaurants/:id', requireAuth, requireCollectionAccess('Restaurant', 'delete'), deleteRestaurant)
```

---

## 12. Desktop Architecture (Electron)

### 12.1 Process Model

```
┌─────────────────────────────────────────────┐
│              Main Process                    │
│  • Window creation & lifecycle               │
│  • Native APIs (notifications, dialogs)     │
│  • IPC handlers                              │
│  • Auto-updater                              │
└──────────────┬──────────────────────────────┘
               │ IPC (contextBridge)
┌──────────────▼──────────────────────────────┐
│            Renderer Process                  │
│  • React SPA (isolated, sandboxed)          │
│  • No direct Node.js access                 │
│  • Communicates via exposed API             │
└─────────────────────────────────────────────┘
```

### 12.2 IPC Channels

| Channel | Direction | Purpose |
|---|---|---|
| `get-app-info` | Renderer → Main | Version, platform, arch |
| `get-env` | Renderer → Main | Read environment variables |
| `show-notification` | Renderer → Main | Native OS notification |
| `open-file-dialog` | Renderer → Main | File picker dialog |
| `save-file-dialog` | Renderer → Main | Save file dialog |
| `print` | Renderer → Main | Print receipt |
| `check-for-updates` | Renderer → Main | Trigger auto-update check |
| `update-available` | Main → Renderer | Notify of available update |
| `update-downloaded` | Main → Renderer | Notify download complete |
| `quit-and-install` | Renderer → Main | Apply update |

### 12.3 Security

- **Context Isolation**: Enabled — renderer cannot access Node.js or Electron APIs directly
- **Node Integration**: Disabled in renderer
- **Sandbox**: Enabled
- **Web Security**: Enabled — CORS and CSP enforced
- **Preload Script**: Exposes only specific, sanitized APIs via `contextBridge`

---

## 13. Build & Deployment

### 13.1 Build Pipeline

```
Source (TypeScript)
    │
    ├── Vite (esbuild)
    │   └── dist/ (React SPA)
    │
    ├── esbuild (electron/main.ts + preload.ts)
    │   └── electron/main.js + preload.js
    │
    └── electron-builder
        ├── win/ → NSIS installer (.exe)
        ├── mac/ → DMG
        └── linux/ → AppImage + .deb
```

### 13.2 Scripts

| Script | Description |
|---|---|
| `dev` | Concurrent Vite dev server + Electron dev |
| `dev:web` | Vite dev server only (browser) |
| `build` | Build React app + Electron files |
| `package` | Build + package installers for current platform |
| `package:win` | Windows NSIS installer |
| `package:mac` | macOS DMG |
| `package:linux` | Linux AppImage + Deb |

### 13.3 Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `VITE_API_URL` | `http://localhost:3002/api` | Backend API base URL |
| `NODE_ENV` | — | `development` or `production` |

---

## 14. Performance Considerations

| Strategy | Implementation |
|---|---|
| **Lazy Loading** | All pages are lazy-loaded via `React.lazy()` + Suspense |
| **Skeleton Loading** | Loading states use animated skeleton placeholders |
| **Query Caching** | TanStack React Query caches API responses with 30s stale time |
| **Pagination** | All list views are paginated (default: 10 per page) |
| **Debounced Search** | Search inputs debounce before triggering API calls |
| **Component Reusability** | Shared UI components prevent code duplication |
| **Dark Mode** | CSS-based dark mode has no runtime performance cost |

---

## 15. Security Architecture

| Layer | Measure |
|---|---|
| **Transport** | HTTPS enforced in production |
| **Authentication** | JWT with Bearer tokens, refresh token rotation |
| **Authorization** | Collection-level read/create/update/delete permissions |
| **XSS Prevention** | React's built-in XSS protection, CSP headers |
| **CSRF** | Token-based auth (Bearer header, not cookies) |
| **Electron** | Context isolation, sandbox, no nodeIntegration |
| **Input Validation** | Zod schemas on all API endpoints |
| **Rate Limiting** | IP-based rate limiting on auth routes |
| **Error Handling** | No stack traces exposed in production |
