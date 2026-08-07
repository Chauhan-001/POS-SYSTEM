# Changelog
## Admin Dashboard — Restaurant Chain Management Platform

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] — 2026-07-27

### Added
- **Dashboard** — Real-time stats grid with total/active restaurants, owners, devices, subscriptions.
  - Subscription overview with active/paused/expired breakdown.
  - Recent activity feed and latest restaurants list.
  - Quick actions panel for common admin tasks.
- **Restaurant Management** — Full CRUD with search, filter, pagination.
  - Create, edit, delete restaurants with plan selection.
  - Suspend/activate functionality.
  - Detail view with tabs for overview, devices, and subscriptions.
- **Owner Management** — List, edit, password reset, activate/deactivate.
- **Subscription Management** — List with search/filter, renew, pause, resume.
  - Upgrade/downgrade plan tiers.
- **Device Management** — List with search/filter, remote block/unblock.
- **Analytics Dashboard** — 5 chart types (area, bar, line).
  - Restaurant growth, daily logins, subscription trends, AI usage.
  - Most active restaurants ranking.
- **AI Usage Monitoring** — Usage metrics, daily averages, peak day tracking.
  - Feature status overview grid.
- **Support Search** — Unified cross-entity search (restaurants, owners, subscriptions, devices).
  - Multi-criteria search (keyword, ID, phone, name).
- **System Settings** — 4 settings sections.
  - Company information management.
  - Default subscription configuration.
  - AI settings (enable/disable, rate limits, model selection).
  - General configuration (registration, maintenance, timezone, language).
- **Authentication** — JWT-based admin login with Bearer token.
  - Collection-level read/create/update/delete authorization.
  - Profile management and password change.
- **UI Component Library** — 12 reusable components.
  - Button (6 variants, 3 sizes), Card, Table (typed generic), Badge (5 variants).
  - Modal, ConfirmDialog, Input, Skeleton, ErrorPage, EmptyState, LoadingSpinner.
  - SearchInput with consistent styling.
- **Dark Mode** — Full dark mode support with automatic theme detection.
- **Desktop Application** — Electron 35 shell with context isolation.
  - IPC channels for app info, notifications, file dialogs, printing.
  - Auto-updater integration.
  - Platform-specific installers: Windows NSIS, macOS DMG, Linux AppImage/Deb.

### Technical
- React 19 + TypeScript 6 + Vite 8 build pipeline.
- Tailwind CSS 4 with `@tailwindcss/vite` plugin.
- TanStack React Query 5 for server state management.
- React Router DOM v7 with lazy-loaded route components.
- Axios client with 401 interceptor and Bearer token injection.
- Recharts for all chart visualizations.
- Lucide React for icons.
- React Hot Toast for notifications.
- clsx + tailwind-merge for class name management.
- Electron 35 with sandbox, context isolation, and secure preload bridge.
- esbuild for Electron main process bundling.
- electron-builder 26 for cross-platform packaging.

### Documentation
- PRD.md — Product Requirements Document with 10 feature categories.
- ARCHITECTURE.md — 15-section architecture document with diagrams.
- AGENTS.md — Development, build, packaging, and QA agents.
- README.md — Setup guide, quick start, troubleshooting.
- DECISIONS.md — 15 Architecture Decision Records.
- TASKS.md — 6 milestones with task breakdown and backlog.

---

## [0.9.0] — 2026-06-15

### Added
- Desktop packaging pipeline (electron-builder).
- Windows NSIS installer configuration.
- macOS DMG configuration.
- Linux AppImage + Debian configuration.
- Auto-updater IPC channels.
- Native notification IPC.

### Changed
- Refined Electron security (context isolation, sandbox).
- Improved build scripts for Electron + Vite coexistence.

---

## [0.8.0] — 2026-05-20

### Added
- Analytics page with 5 chart types.
- AI Usage monitoring page.
- Support search with multi-criteria.
- All 4 settings sections (company, subscription, AI, general).
- Profile page.

### Changed
- Dashboard now includes AI usage stats.
- Enhanced error handling with ErrorPage component.

---

## [0.7.0] — 2026-04-10

### Added
- Restaurants page with full CRUD (create, edit, delete, suspend, activate).
- Restaurant detail page with tabbed view.
- Owners page with edit, password reset, activate/deactivate.
- Subscriptions page with renew, pause, resume.
- Devices page with block/unblock.

### Changed
- Table component now supports pagination.
- Enhanced modal system (create/edit modals, confirm dialogs).

---

## [0.6.0] — 2026-03-15

### Added
- Dashboard page with stats grid.
- Recent activity feed.
- Latest restaurants card.
- Subscription overview.
- Quick actions panel.

### Changed
- Layout refinements for sidebar and navbar.

---

## [0.5.0] — 2026-03-01

### Added
- Vite + React + TypeScript project initialization.
- Tailwind CSS 4 configuration with dark mode.
- UI component library (Button, Card, Table, Badge, Modal).
- React Router DOM v7 with lazy loading.
- AuthContext, ThemeContext, SidebarContext.
- DashboardLayout with Sidebar and Navbar.
- Axios client with interceptors.
- Vite proxy for backend API.
- esbuild Electron bundling.
- Electron main process and preload script.

---

## Future Releases

### [1.1.0] — Planned
- Unit tests with Vitest.
- E2E tests with Playwright.
- CI pipeline (GitHub Actions).

### [1.2.0] — Planned
- Multi-language support (i18n).
- Audit logging.
- Advanced analytics (custom date ranges, CSV/PDF export).

### [2.0.0] — Planned
- Bulk operations (bulk suspend/activate/delete).
- Team management (multi-admin with roles).
- Notification center (in-app + email).
- White-labeling support.

---

## Version History

| Version | Date | Highlights |
|---|---|---|
| 1.0.0 | 2026-07-27 | Initial release — full feature set + documentation |
| 0.9.0 | 2026-06-15 | Desktop packaging pipeline |
| 0.8.0 | 2026-05-20 | Analytics, AI usage, support, settings |
| 0.7.0 | 2026-04-10 | CRUD pages (restaurants, owners, subscriptions, devices) |
| 0.6.0 | 2026-03-15 | Dashboard with stats and activity |
| 0.5.0 | 2026-03-01 | Foundation — project setup, UI library, Electron shell |
