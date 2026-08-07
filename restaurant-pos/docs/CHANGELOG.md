# Changelog
## Restaurant POS — Point of Sale & Restaurant Management System

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] — 2026-07-27

### Added

#### Core POS Engine
- **Central State Management** — `usePOSState` hook with 80+ state variables.
  - localStorage initialization for instant first render.
  - TTL-aware API hydration (SLOW=5min, MEDIUM=2min, FAST=30s, LIVE=0s).
  - Background polling every 30s for live data (orders, tables, takeaways).
  - Derived state: dailySales, activityFeed, zReportData, moduleSettings, rolePermissions.
- **Billing System** — Complete billing workflow.
  - Product grid with category filtering, search, favorites, quick-fire mode.
  - Variant selection and pricing.
  - Add-ons/modifiers per category.
  - Resizable cart panel with quantity controls, notes, line item management.
  - Live price calculations (subtotal, discount, GST, grand total).
  - Proportional GST allocation across items.
  - GST calculation with per-product tax rates.
- **Payment Processing** — Full payment support.
  - Cash, UPI, Card, Wallet payment methods.
  - Split payments across multiple methods.
  - Ref-based double-click guard preventing duplicate processing.
  - Async checkout with local-first updates and background API sync.
  - Atomic invoice number generation (backend MongoDB counter + localStorage fallback).
- **Receipt Engine** — Thermal printer support.
  - 58mm and 80mm receipt formats.
  - GST breakdown, discount display, loyalty points.
  - Customer name, table number, order time on receipt.
  - Customizable receipt templates (logo, footer, QR code, tax summary).
  - Auto-print on payment option.

#### Order Management
- **Dine-In Orders** — Full table service workflow.
  - Table assignment with waiter tracking.
  - Order status lifecycle (New → Accepted → Preparing → Ready → Served → Waiting Payment → Paid → Closed).
  - Visual table floor plan with color-coded status indicators.
  - Guest count management per table.
- **Takeaway Orders** — Complete takeaway management.
  - Customer name/phone capture.
  - Preparation tracking and collection workflow.
  - Clear completed takeaways.
- **KOT (Kitchen Order Ticket)** — Advanced KOT management.
  - Delta detection — only new/changed items sent to kitchen.
  - Three KOT types: Original (first print), Additional (delta), Reprint (full reprint).
  - KOT preview showing pending items before sending.
  - KOT status progression: Accepted → Preparing → Ready → Served.
  - Automatic table status updates based on KOT readiness.
- **Order Timeline** — Complete event history.
  - 18 timeline event types tracked.
  - Actor recording for accountability.
  - Visual timeline component.
- **Hold/Resume Orders** — Full state preservation.
  - Held orders stored in localStorage.
  - Complete order reconstruction on resume.
  - Held orders drawer for browsing and recalling.

#### Kitchen Display (KDS)
- Real-time KOT queue with status management.
- Kitchen staff can Accept, Start Preparing, Mark Ready, Mark Served.
- Item-level cancellation with reason tracking.
- Automatic table status updates on KOT progress.
- Priority/urgency markers.

#### Product Management
- Full CRUD for menu items.
- Category organization with custom colors.
- Product variants (size, type) with independent pricing.
- GST percentage per product.
- Product images.
- Availability toggle.
- Product codes/SKU for quick-fire input and barcode scanning.
- Favorites marking for quick access.
- Category-based add-on configuration.

#### Customer Management & Loyalty
- Phone-based customer profiles with name, email, birthday.
- Automatic visit counting.
- Configurable loyalty points per purchase.
- Complete purchase history per customer.
- Reward system: percentage discount, flat discount, free item.
- Visit milestones with configurable bonus rewards.
- Customer search and assignment to bills.
- OTP verification for high-value reward redemption.

#### Employee Management
- Staff profiles with role assignment.
- 4-digit PIN for cashier quick login.
- Username/password for managers.
- Role-based workspace gating.
- Login session tracking.

#### Role-Based Access Control
- Three roles: Owner (full access), Manager (configurable), Cashier (restricted).
- 12 configurable Manager permission toggles.
- Per-workspace access gating.
- Automatic redirect to Dashboard on unauthorized access.

#### Multi-Branch Management
- Branch CRUD with head branch designation.
- Branch-level data isolation.
- Per-branch product pricing overrides.
- Per-branch variant pricing.
- Per-branch table layouts.
- Per-branch settings overrides merged with global defaults.
- Branch selector in title bar.

#### Settings & Configuration
- Restaurant information (name, GSTIN, address, phone, currency).
- Receipt customization (print size, logo, footer, QR code, tax summary).
- Loyalty configuration (points rate, visit milestones, bonus points).
- 15+ module toggles (table service, kitchen, loyalty, delivery, etc.).
- 8 AI feature toggles.
- Printer routing rules (category → destination printer).
- Branding (color scheme, sidebar logo).

#### Expense Management
- 13 predefined expense categories.
- Expense recording with vendor, payment method, notes.
- Date range filtering.
- Recurring expense markers.

#### Reservations & Waiting List
- Table reservation CRUD with date/time.
- Table assignment for reservations.
- Status tracking: Confirmed → Seated → Cancelled → No Show.
- Walk-in waiting list with estimated wait times.

#### Inventory Management
- Stock tracking dashboard.
- Supplier/vendor management.
- AI-powered features (see AI section).

#### Reports
- Z-report (end-of-day financial summary).
- Daily sales report.
- Payment method aggregation.
- Item sales report.
- Tax summary.

#### Analytics
- Sales trends charts.
- Category performance analysis.
- Hourly/daily busy hour identification.
- AI-powered insights.

#### Finance
- Revenue vs expenses visualization.
- Cash flow tracking.

#### AI Features (8 Agents)
- **AI Daily Summary** — Daily business performance report.
- **AI Inventory Health** — AI-powered inventory health scoring.
- **AI Purchase Recommendations** — Smart reorder suggestions.
- **AI Low Stock Predictions** — Out-of-stock forecasting.
- **AI Waste Analysis** — Waste pattern analysis and improvement suggestions.
- **AI Voice Entry** — Voice-controlled inventory data entry.
- **AI Weather Recommendations** — Weather-based menu/promotion suggestions.
- **AI Closing Assistant** — End-of-day closing checklist.

#### Offline-First Architecture
- Full POS operation without internet connectivity.
- localStorage persistence for all data entities.
- SyncEngine with pub/sub pattern for cross-tab synchronization.
- Online/offline detection with auto-sync on reconnection.
- Stale key tracking for targeted data re-fetch.
- Fire-and-forget API calls — silent error handling.

#### Desktop Application
- Electron shell for cross-platform desktop support.
- Fullscreen mode for dedicated POS terminals.
- Print receipt via Electron print API.

#### Onboarding
- Guided tour with step-by-step interactive walkthrough.
- First-time setup wizard for Owner registration.
- Comprehensive keyboard shortcuts (Ctrl+F, Ctrl+K, Ctrl+P, etc.).
- Keyboard shortcuts guide modal.

#### Testing Infrastructure
- Vitest configuration with jsdom environment.
- React Testing Library setup.
- Playwright E2E test suite.
- 5 E2E test files covering ordering flow, AI diagnostics, visual QA, and tour verification.

### Technical
- React 19 + TypeScript 5.8 + Vite 6 build pipeline.
- Tailwind CSS 4 with `@tailwindcss/vite` plugin.
- dnd-kit for drag-and-drop table floor plan.
- Lucide React for icons (tree-shakeable).
- Motion (Framer Motion v12) for animations.
- Recharts for chart visualizations.
- Axios for HTTP with JWT interceptor.
- React Router DOM v7 for URL↔workspace synchronization.
- 18 workspaces with conditional rendering.
- 15+ modal components at the App root level.
- 5 custom hooks (usePOSState, useBilling, useOrders, useLoyalty, useKeyboardShortcuts, useNotifications).
- Google Generative AI integration for 8 AI features.
- MongoDB (Mongoose) with 15+ models.
- JWT authentication with refresh token rotation.
- Zod validation schemas on all API endpoints.
- Rate limiting with IP-based and account-based backoff.
- Offline-first SyncEngine with stale key tracking.

### Documentation
- PRD.md — Product Requirements Document (19 feature areas, 8 AI features).
- ARCHITECTURE.md — 19-section architecture document with diagrams.
- AGENTS.md — Development, testing, AI, and sync agents.
- README.md — Setup guide, quick start, troubleshooting, keyboard shortcuts.
- DECISIONS.md — 16 Architecture Decision Records.
- TASKS.md — 8 milestones with task breakdown and backlog.

---

## [0.9.0] — 2026-Q2

### Added
- AI Daily Summary feature.
- AI Inventory Health scoring.
- AI Purchase Recommendations.
- AI Low Stock Predictions.
- AI Waste Analysis.
- AI Voice Entry.
- AI Weather Recommendations.
- AI Closing Assistant.
- AI feature toggles in settings.
- Playwright E2E test setup.
- 5 E2E test files (ordering flow, AI diagnostics, visual QA, tour verification).
- Vitest configuration with debugLog unit test.
- Electron desktop packaging.
- Platform installers.

### Changed
- Enhanced sync engine with stale key tracking.
- Improved offline resilience with TTL-aware caching.

---

## [0.8.0] — 2026-Q2

### Added
- Expense Manager with 13 categories.
- Reservation Workspace with waiting list.
- Analytics Workspace with sales trends.
- Finance Workspace with revenue vs expenses.
- Inventory Manager with stock dashboard.
- Receipt History lookup.
- Multi-branch pricing overrides.
- Multi-branch table layouts.
- Sync Panel modal.
- Activity Feed modal.
- Daily Sales modal.
- Guided Tour with interactive walkthrough.
- Keyboard Shortcuts Guide.

### Changed
- Enhanced branch-aware data filtering.
- Improved cart panel with resize functionality.

---

## [0.7.0] — 2026-Q1/Q2

### Added
- Product Manager with full CRUD.
- Customer Manager with loyalty profiles.
- Rewards system (percentage, flat, free item).
- Visit milestones with bonus rewards.
- Offers Manager with popup.
- Reports Manager (Z-report, daily sales).
- Staff Manager with role assignment.
- Role permissions system with configurable toggles.
- Settings Manager with 8 configuration sections.
- Receipt customization (print size, logo, footer, QR).
- Module toggles (15+ features).
- Branch Manager with multi-branch support.
- Login Screen with PIN authentication.
- First Time Setup wizard.

### Changed
- Major refactor of state management into usePOSState.
- Enhanced role-based workspace gating.

---

## [0.6.0] — 2026-Q1

### Added
- useOrders hook with order CRUD.
- Order Manager workspace.
- Restaurant Floor Plan with visual table map.
- Table CRUD (add, edit, delete).
- KOT delta detection (kotDelta.ts).
- KOT Preview modal.
- KOT Modal (post-print display).
- Original/Additional/Reprint KOT types.
- Kitchen Display workspace.
- Takeaway order management.
- Order Timeline component.
- Hold/resume orders functionality.

---

## [0.5.0] — 2026-Q1

### Added
- Vite + React + TypeScript project initialization.
- Tailwind CSS 4 configuration.
- TypeScript type definitions (100+ types).
- usePOSState central state hook.
- useBilling hook with cart, calculations, checkout.
- Cart panel component.
- Product grid component with categories.
- Payment processing flow.
- Receipt modal.
- localStorage persistence with timestamped cache.
- SyncEngine with pub/sub pattern.
- GST calculation engine.
- API client with Axios.
- Offline-first data flow.

---

## Future Releases

### [1.1.0] — Planned
- Hook unit tests (useBilling, useOrders, useLoyalty).
- TypeScript strict mode enablement.
- CI pipeline (GitHub Actions).

### [1.2.0] — Planned
- QR code ordering (scan-to-order at table).
- Payment gateway integration.
- Accounting software integration (Tally, QuickBooks).

### [2.0.0] — Planned
- Online ordering website (customer-facing).
- Mobile companion app.
- Delivery fleet management.
- Shift scheduling.
- Multi-language support (i18n).
- Dark mode.

---

## Version History

| Version | Date | Highlights |
|---|---|---|
| 1.0.0 | 2026-07-27 | Initial release — 18 workspaces, 8 AI agents, full POS feature set |
| 0.9.0 | 2026-Q2 | AI features, E2E tests, desktop packaging |
| 0.8.0 | 2026-Q2 | Extended features (expenses, reservations, inventory, guided tour) |
| 0.7.0 | 2026-Q1/Q2 | Admin features (products, customers, staff, settings, branches) |
| 0.6.0 | 2026-Q1 | Order management (orders, floor plan, KOT, kitchen display) |
| 0.5.0 | 2026-Q1 | Core POS engine (billing, cart, payments, offline persistence) |
