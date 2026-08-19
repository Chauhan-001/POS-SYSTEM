# API_REFERENCE.md — Backend REST API Reference

Base URL: `http://localhost:3002/api` (production base path `/api`).
Protected endpoints require `Authorization: Bearer <JWT>`.

This reference lists the **currently mounted** routes (from
`backend/src/server.ts`). It is intentionally a route index, not an exhaustive
payload spec — for schema details read the Zod validators in
`backend/src/validation/*` and the route files in `backend/src/routes/*`.

---

## 1. Authentication & Sessions

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/login` | Staff/POS login. Body: `{ username?, restaurantId+phone?, password, mode: 'password'\|'pin'\|'role_pin' }` |
| POST | `/api/auth/refresh` | Exchange refresh token (+ `deviceId`) for a new JWT |
| POST | `/api/auth/logout` | Invalidate refresh token |
| POST | `/api/auth/admin/login` | Admin login: `{ userId, password }` (with backoff) |
| POST | `/api/sessions` | Session management |
| POST | `/api/otp` | OTP send/verify |

## 2. Core Domain

| Method | Path | Purpose |
|---|---|---|
| GET/POST | `/api/products` | List / create products |
| PUT/DELETE | `/api/products/:id` | Update / delete product |
| GET/POST | `/api/orders` | List / create orders |
| PUT | `/api/orders/:id` | Update order (status, items, KOT) |
| GET/POST | `/api/bills` | List / create bills |
| POST | `/api/bills/sync` | Offline bill batch sync |
| GET | `/api/bills/daily-summary` | Daily sales / tax / payment breakdown (Z-Report) |
| GET | `/api/bills/invoice-range` | Reserve a contiguous offline invoice-number range for a terminal (auth + subscription) |
| GET/POST | `/api/customers` | Customer CRUD + phone lookup |
| GET/POST | `/api/employees` | Staff CRUD |
| GET/POST | `/api/branches` | Branch CRUD |
| GET/POST | `/api/tables`, `/api/floors` | Table/floor management + occupancy |
| GET/POST | `/api/takeaway-orders` | Takeaway queue |
| GET/POST | `/api/held-orders` | Hold/resume orders |
| GET/POST | `/api/reservations` | Reservations & waitlist |
| GET | `/api/availability` | Menu/table availability |

## 3. Finance & Ops

| Method | Path | Purpose |
|---|---|---|
| GET/POST | `/api/expenses`, `/api/expense-categories` | Expense tracking |
| GET/POST | `/api/vendors`, `/api/suppliers` | Vendor/supplier management |
| GET/POST | `/api/recurring-expenses` | Recurring expense templates |
| GET/POST | `/api/cash-ledger` | Cash drawer ledger |
| GET/POST | `/api/finance` | P&L / finance summary |
| GET | `/api/reports/*` | Sales, product, closing-summary reports |
| GET/POST | `/api/purchases` | Inventory purchases |
| GET/POST | `/api/inventory-events` | Stock movements (adjust, waste, open…) |
| GET | `/api/customer-reports` | Customer analytics |

## 4. Loyalty & Marketing

| Method | Path | Purpose |
|---|---|---|
| GET/POST | `/api/loyalty/*`, `/api/rewards` | Loyalty points, tiers, rewards |
| POST | `/api/referrals` | Referral tracking |
| GET/POST | `/api/campaigns`, `/api/automations` | Marketing campaigns / automations |
| GET/POST | `/api/offers` | Offers & promotions |
| POST | `/api/advisor` | Business advisor recommendations |
| GET/POST | `/api/promotions` | Promotion rules |

## 5. Configuration & Platform

| Method | Path | Purpose |
|---|---|---|
| GET/PATCH | `/api/settings` | Tenant settings (versioned, audited) |
| GET/POST | `/api/menu-config` | Reusable variant/add-on/customization templates |
| POST | `/api/menu-config/:id/attach` | Attach template to product |
| POST | `/api/menu-config/:id/copy` | Copy template (independent) |
| GET/POST | `/api/qr-ordering`, `/api/qr-tokens` | QR ordering tokens & sessions |
| GET/POST | `/api/devices` | Device registration/authorization |
| GET/POST | `/api/sync` | Offline sync & state |
| GET/POST | `/api/media` | Uploads |

## 6. Public Store (rate-limited, no auth)

| Method | Path | Purpose |
|---|---|---|
| GET/POST | `/api/public-store/*` | Customer menu/order/session via QR |
| GET | `/api/public-store/receipt/*` | Digital receipt by token |
| GET/POST | `/api/legal` | Legal documents & acceptance |
| POST | `/api/help-analytics` | Help view tracking |

## 7. AI & Voice

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/ai/*` | AI completion / analytics / voice parse |
| POST | `/api/voice-inventory/*` | Voice STT, product resolution, pending actions |

## 8. Admin (`/api/admin/*`)

Restaurants, owners, devices, subscription plans, subscriptions, usage,
reports, security, settings, CRM, finance, support, audit logs — mounted via
`adminRouter` + `adminReportsRouter` (see `backend/src/routes/admin.ts`,
`adminReports.ts`).
