# ROUTING_GUIDE.md — Workspace Navigation & API Routing

## Overview

The application utilizes two routing systems:
1. **Frontend Workspace Navigation**: Managed via `src/routes.ts` in `restaurant-pos/Frontend`.
2. **Backend API Routing**: Express routers mounted at `/api/*` in `backend/src/routes`.

---

## 1. POS Workspace Navigation (`src/routes.ts`)

| Workspace Name | URL Hash / Path | Target Component | Required Role |
| :--- | :--- | :--- | :--- |
| `Billing` | `/billing` | `<BillingProductGrid />` + `<CartPanel />` | All Staff |
| `Orders` | `/orders` | `<OrderManager />` | Cashier, Waiter, Manager |
| `Kitchen` | `/kitchen` | `<KitchenDisplay />` | Kitchen, Manager, Owner |
| `Dashboard` | `/dashboard` | `<DashboardWorkspace />` | Manager, Owner |
| `Inventory` | `/inventory` | `<InventoryManager />` | Manager, Owner |
| `Reports` | `/reports` | `<ReportsManager />` | Manager, Owner |
| `Staff` | `/staff` | `<StaffManager />` | Manager, Owner |
| `Settings` | `/settings` | `<SettingsManager />` | Owner |

---

## 2. Workspace Route Synchronization

- In browser mode, workspace selection syncs with browser history and URL hash.
- In Electron mode, active workspace is kept in state and persisted across fast app restarts.
