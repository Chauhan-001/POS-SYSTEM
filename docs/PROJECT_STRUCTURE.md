# PROJECT_STRUCTURE.md — Monorepo Architecture & Package Layout

## Overview

The **Loyalty POS System** is organized as a production-grade monorepo containing three core applications:

1. **`backend`**: Node.js, Express, TypeScript, and MongoDB REST API backend service.
2. **`restaurant-pos`**: Desktop POS Terminal powered by Electron (Main Process) and React + Vite + Tailwind CSS (Renderer Application).
3. **`admin-dashboard`**: Web portal for super-admins and restaurant chain managers (React + Vite + Tailwind CSS).

---

## 1. Directory Blueprint

```
c:\Loyalty_POS system/
├── backend/                  # Core API & Data Persistence Service
├── restaurant-pos/            # Electron Desktop POS Terminal Application
├── admin-dashboard/          # Multi-Tenant Central Management Web Portal
├── CODEBASE_MAP.md           # Master Codebase Navigation Blueprint
├── PROJECT_STRUCTURE.md      # This file — Package & Folder Layout
├── ARCHITECTURE.md           # High-Level System Architecture & Flow
├── DATABASE_SCHEMA.md        # Data models & collection contracts
├── API_REFERENCE.md          # REST API contracts
├── OFFLINE_ENGINE.md         # Local storage & sync queue documentation
├── ELECTRON.md               # Desktop process lifecycle & IPC map
├── POS_ARCHITECTURE.md       # POS terminal frontend design
├── ADMIN_DASHBOARD.md        # Central admin web portal documentation
└── package.json              # Monorepo root script runner
```

---

## 2. Package Roles & Isolation Rules

- **`backend`**: Has zero UI dependencies. Encapsulates database connections, JWT authentication, billing business logic, inventory validation, and reporting endpoints.
- **`restaurant-pos`**: Isolated desktop client capable of running 100% offline. Uses IndexedDB / LocalStorage for immediate persistence and syncs asynchronously with `backend`.
- **`admin-dashboard`**: Web client for store owners to view aggregated analytics, manage multi-branch pricing, and configure staff access controls.

---

## 3. Standard Development Workflows

```bash
# Run all dev services concurrently (Backend + Admin + Web POS)
npm run dev

# Run Electron Desktop environment concurrently (Backend + Admin + Desktop POS)
npm run dev:electron

# Build production artifacts for all services
npm run build
```
