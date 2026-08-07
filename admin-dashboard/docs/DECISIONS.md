# Architecture Decisions & Rationale
## Admin Dashboard — Restaurant Chain Management Platform

**Last Updated:** July 27, 2026

---

## Decision Log

### D-001: React 19 + TypeScript 6 as Frontend Framework

| Property | Value |
|---|---|
| **Date** | 2026-Q2 |
| **Status** | ✅ Accepted |
| **Context** | Need a modern, type-safe UI framework for a data-heavy admin dashboard |
| **Decision** | Use React 19 with TypeScript 6 and Vite 8 |
| **Rationale** | React 19 provides the latest features (Server Components, Actions). TypeScript 6 offers improved type inference. Vite 8 provides fast HMR and native ESM support. |
| **Consequences** | Requires Node.js 22+. TypeScript strict mode not enabled — using looser settings for faster development. |

### D-002: Vite 8 as Build Tool Instead of Webpack

| Property | Value |
|---|---|
| **Date** | 2026-Q2 |
| **Status** | ✅ Accepted |
| **Context** | Need a fast build tool for development and production |
| **Decision** | Use Vite 8 with esbuild for bundling |
| **Rationale** | Vite is 10-20x faster than Webpack for HMR. esbuild-based bundling for production is significantly faster than Terser-based minification. Native ESM support aligns with modern browser requirements. |
| **Consequences** | All imports use ESM format. Some Webpack-specific plugins are not compatible. |

### D-003: TanStack React Query for Server State Management

| Property | Value |
|---|---|
| **Date** | 2026-Q2 |
| **Status** | ✅ Accepted |
| **Context** | Need to manage server data with caching, deduplication, and background refetch |
| **Decision** | Use TanStack React Query v5 |
| **Rationale** | Eliminates manual loading/error state management. Built-in caching with stale-while-revalidate pattern. Automatic retry on failure. Deduplication of concurrent requests. | 
| **Consequences** | No need for Redux or Zustand. All server state flows through React Query. Optimistic updates are possible but not yet implemented. |

### D-004: Tailwind CSS 4 Instead of CSS-in-JS

| Property | Value |
|---|---|
| **Date** | 2026-Q2 |
| **Status** | ✅ Accepted |
| **Context** | Need a styling solution for consistent design, dark mode, and rapid UI development |
| **Decision** | Use Tailwind CSS 4 with `@tailwindcss/vite` plugin |
| **Rationale** | Zero-runtime CSS. Built-in dark mode via `dark:` variant. Consistent design tokens. Smaller bundle than CSS-in-JS solutions. CSS-first approach aligns with modern web standards. |
| **Consequences** | All styling is utility-class based. Custom CSS only for complex animations. Dark mode is CSS-driven, not JS-driven. |

### D-005: Electron for Desktop Distribution

| Property | Value |
|---|---|
| **Date** | 2026-Q2 |
| **Status** | ✅ Accepted |
| **Context** | Need to deliver the dashboard as a desktop application for admin users |
| **Decision** | Use Electron 35 with context isolation and sandbox |
| **Rationale** | Electron provides cross-platform desktop support (Windows, macOS, Linux). Context isolation ensures security. Chromium engine guarantees consistent rendering. |
| **Consequences** | ~150MB installer size. Two build targets (web + desktop). IPC needed for native features (notifications, file dialogs). |

### D-006: Axios with Interceptors for HTTP

| Property | Value |
|---|---|
| **Date** | 2026-Q2 |
| **Status** | ✅ Accepted |
| **Context** | Need HTTP client with request/response interceptors for auth token management |
| **Decision** | Use Axios |
| **Rationale** | Axios provides request/response interceptors ideal for attaching Bearer tokens and handling 401 redirects. Simpler API than Fetch for common patterns. |
| **Consequences** | One additional dependency. Fetch API is not used directly. |

### D-007: Recharts for Charts Instead of D3

| Property | Value |
|---|---|
| **Date** | 2026-Q2 |
| **Status** | ✅ Accepted |
| **Context** | Need charts for analytics dashboard (area, bar, line charts) |
| **Decision** | Use Recharts |
| **Rationale** | React-native chart library (declarative JSX API). Built on D3 but with simpler API. Supports all required chart types. Responsive containers. |
| **Consequences** | Limited customization compared to raw D3. Not suitable for complex custom visualizations. |

### D-008: React Router DOM v7 with Lazy Loading

| Property | Value |
|---|---|
| **Date** | 2026-Q2 |
| **Status** | ✅ Accepted |
| **Context** | Need client-side routing with code splitting |
| **Decision** | Use React Router DOM v7 with `React.lazy()` + Suspense |
| **Rationale** | De facto standard for React routing. Lazy loading reduces initial bundle size. Type-safe route params with React Router v7. |
| **Consequences** | All pages are lazy-loaded. Suspense fallback shown during load. No nested routing used (flat route structure). |

### D-009: clsx + tailwind-merge for Conditional Classes

| Property | Value |
|---|---|
| **Date** | 2026-Q2 |
| **Status** | ✅ Accepted |
| **Context** | Need a utility for merging Tailwind classes conditionally |
| **Decision** | Combine `clsx` for conditional logic with `tailwind-merge` for class conflict resolution |
| **Rationale** | `clsx` handles conditional class strings/objects. `tailwind-merge` intelligently resolves conflicting Tailwind classes (e.g., `px-4` + `px-6` → `px-6`). |
| **Consequences** | Two small utility dependencies. All UI components use the `cn()` wrapper. |

### D-010: Backend Port 3002 (Not 3001)

| Property | Value |
|---|---|
| **Date** | 2026-Q2 |
| **Status** | ✅ Accepted |
| **Context** | Need a dedicated port for the admin API distinct from the POS backend |
| **Decision** | Use port 3002 for admin dashboard backend |
| **Rationale** | The POS backend uses port 3001. Using 3002 avoids port conflicts when both systems run simultaneously. |
| **Consequences** | Frontend Vite proxy configured for port 3002. All API URLs reference port 3002. |

### D-011: ProtectedRoute Auth Guard Pattern

| Property | Value |
|---|---|
| **Date** | 2026-Q2 |
| **Status** | ✅ Accepted |
| **Context** | Need to protect routes from unauthenticated access |
| **Decision** | Use a `<ProtectedRoute>` wrapper component in the router |
| **Rationale** | Simple, explicit pattern. Protects the entire DashboardLayout. If unauthenticated, redirects to `/login`. |
| **Consequences** | All protected pages are children of the ProtectedRoute. Login page is the only public route. |

### D-012: Single Layout for All Pages

| Property | Value |
|---|---|
| **Date** | 2026-Q2 |
| **Status** | ✅ Accepted |
| **Context** | Need a consistent layout across all dashboard pages |
| **Decision** | Use a single `DashboardLayout` with Sidebar + Navbar + Outlet |
| **Rationale** | All admin pages share the same sidebar and navbar structure. Single layout is simpler than multiple layouts. Outlet renders the current page content. |
| **Consequences** | All pages get the same layout. Any page-specific layout differences must be handled within the page component. |

### D-013: CSS-Based Dark Mode

| Property | Value |
|---|---|
| **Date** | 2026-Q2 |
| **Status** | ✅ Accepted |
| **Context** | Need dark mode support for comfortable admin usage |
| **Decision** | Use CSS-based dark mode with Tailwind's `dark:` variant and a `ThemeContext` |
| **Rationale** | CSS-only dark mode has no runtime performance cost. Tailwind's `dark:` variant makes it easy to style both themes. ThemeContext persists user preference to localStorage. |
| **Consequences** | Every component needs `dark:` variants. No runtime theme switching cost. |

### D-014: react-hot-toast for Notifications

| Property | Value |
|---|---|
| **Date** | 2026-Q2 |
| **Status** | ✅ Accepted |
| **Context** | Need toast notifications for success/error feedback |
| **Decision** | Use react-hot-toast |
| **Rationale** | Lightweight (~5KB). Customizable styling. Works with React contexts. Supports multiple toast types. |
| **Consequences** | Toaster component rendered at root level. All mutations show toasts on success/error. |

### D-015: No Automated Testing (Phase 1)

| Property | Value |
|---|---|
| **Date** | 2026-Q2 |
| **Status** | ⚠️ Temporary |
| **Context** | Need to deliver features quickly |
| **Decision** | No test framework configured for Phase 1 |
| **Rationale** | Manual testing sufficient for initial development. TypeScript type checking provides basic safety. |
| **Consequences** | Test framework (Vitest or Playwright) should be added in Phase 2. |

---

## Technology Choices Summary

| Category | Choice | Alternative(s) Considered | Rationale |
|---|---|---|---|
| **UI Framework** | React 19 | Vue 3, Svelte 5 | Ecosystem, team familiarity, library support |
| **Language** | TypeScript 6 | JavaScript, Flow | Type safety, developer experience |
| **Build Tool** | Vite 8 | Webpack 5, Turbopack | Speed, simplicity, ESM-native |
| **CSS** | Tailwind CSS 4 | Styled Components, CSS Modules | Zero-runtime, dark mode, consistency |
| **State Mgmt** | TanStack React Query | Redux, Zustand, RTK Query | Server state optimization, caching |
| **Routing** | React Router v7 | TanStack Router, Next.js | Ecosystem standard, simplicity |
| **HTTP Client** | Axios | Fetch, ky | Interceptors, wider adoption |
| **Charts** | Recharts | D3, Chart.js, Nivo | React-native API, simplicity |
| **Desktop** | Electron 35 | Tauri, NW.js | Ecosystem maturity, cross-platform |
| **Icons** | Lucide React | Heroicons, Phosphor | Tree-shakable, modern design |
| **Forms** | React Hook Form | Formik, Final Form | Performance, simplicity |
| **Notifications** | react-hot-toast | Sonner, notistack | Lightweight, customizable |

---

## Anti-Patterns Avoided

| Anti-Pattern | Why Avoided |
|---|---|
| **Global CSS-in-JS** | Runtime performance cost; Tailwind is more efficient |
| **Redux for Server State** | React Query handles caching, retry, dedup better |
| **Nested BrowserRouter** | Only one router at the root |
| **Direct DOM Manipulation** | React's virtual DOM handles all updates |
| **Prop Drilling** | Context providers for auth, theme, sidebar |
| **Inline Styles** | Tailwind utility classes are more maintainable |
| **Monolithic Components** | Pages are broken into small UI primitives |
