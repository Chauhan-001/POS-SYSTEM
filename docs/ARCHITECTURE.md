# ARCHITECTURE.md — High-Level System Architecture

## Overview

The **Loyalty POS System** is designed with an **Offline-First Multi-Tenant Architecture**. It ensures zero downtime for POS cashiers during internet outages while maintaining eventual consistency across backend databases and admin portals.

---

## 1. System Topology & Data Flow

```
+-------------------------------------------------------------------+
|                     ELECTRON POS TERMINAL                         |
|                                                                   |
|   React POS Frontend (Port 5173)                                  |
|   +--------------------------+     +--------------------------+   |
|   |  Billing & Orders Workspace | --->|  Offline Sync Buffer     |   |
|   +--------------------------+     |  (IndexedDB / Storage)   |   |
|                                    +------------+-------------+   |
+-------------------------------------------------|-----------------+
                                                  | (Async Sync)
                                                  v
                                     +--------------------------+
                                     |    EXPRESS REST BACKEND  |
                                     |    (Port 3002)           |
                                     +------------+-------------+
                                                  |
                                                  v
                                     +--------------------------+
                                     |    MONGODB DATABASE      |
                                     |    (Local / Cloud Atlas) |
                                     +--------------------------+
                                                  ^
                                                  |
                                     +------------+-------------+
                                     |   ADMIN DASHBOARD WEB    |
                                     |   (Port 5174 / Prod)     |
                                     +--------------------------+
```

---

## 2. Core Architectural Pillars

### A. Offline-First Resilience
- All cashier operations (creating orders, calculating bills, processing payments, printing KOTs) operate against local in-memory and IndexedDB state.
- Network calls to backend service are executed asynchronously without blocking the UI thread.
- If backend is offline or unreachable, transactions are queued in the offline buffer.

### B. Multi-Branch & Multi-Tenant Support
- Backend schemas store `restaurantId` and `branchId` references on all resources.
- Pricing overrides and stock counts are scoped per-branch.

### C. Electron Security & Process Isolation
- Renderer processes run with `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true`.
- Native window control operations pass strictly through `contextBridge` IPC signatures exposed in `preload.ts`.

---

## 3. High-Level Workspaces

1. **Billing Workspace**: Rapid item lookup, quick-fire barcode scanning, tax & discount calculation, receipt generation.
2. **Orders Workspace**: Table floor plan management, takeaway queues, online order integration (Swiggy, Zomato, Uber Eats).
3. **Kitchen Display System (KDS)**: Real-time ticket statuses (Pending, Preparing, Ready, Delivered) with KOT delta tracking.
4. **Inventory & Stock Management**: Real-time ingredient consumption tracking, low stock alerts, supplier orders.
5. **Loyalty & Customer Rewards**: Phone number lookup, points accumulation, reward tier redemptions.
6. **Reports & Finance**: Daily sales breakdown, Z-Report closing, expense tracking, cashier shift settlement.
