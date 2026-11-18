# API Reference — Loyalty POS System

Complete reference for the Express REST API (`backend/`). Base URL in development: `http://localhost:3002/api`.

All endpoints return JSON. Authenticated requests require a `Bearer` JWT access token in the `Authorization` header.

---

## 1. Authentication Scheme

| Scheme | Header | Description |
|---|---|---|
| **Access token** | `Authorization: Bearer <access_token>` | Short-lived JWT, sent on every protected request |
| **Refresh token** | Body field `refreshToken` | Long-lived, used at `POST /auth/refresh` to obtain a new access token |
| **Super-admin** | `Authorization: Bearer <admin_token>` | Admin dashboard routes; separate `super_admin` principal |

### Auth Flow

1. **First-time setup** — `GET /auth/owner-exists` checks if any Owner is registered. If not, `POST /auth/register-owner` creates the first Owner.
2. **Employee login** — `POST /auth/login` with username/phone + PIN → returns `accessToken` + `refreshToken`.
3. **Token refresh** — `POST /auth/refresh` with `refreshToken` → new `accessToken`.
4. **Logout** — `POST /auth/logout` invalidates the refresh token.

### Rate Limiting (Auth)

- **authIpLimiter** — per-IP window on login (brute-force protection)
- **accountBackoff** — exponential backoff per account on consecutive failures
- **publicLimiter** — per-IP window on public endpoints (owner-exists, register-owner)

---

## 2. Error Format

All errors follow this shape:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable description",
    "details": { "field": "reason" }  // optional, for validation failures
  }
}
```

| HTTP Status | Meaning |
|---|---|
| 400 | Validation or bad request |
| 401 | Unauthorized (missing/invalid token) |
| 403 | Forbidden (insufficient RBAC permission) |
| 404 | Resource not found |
| 409 | Conflict (duplicate, already exists) |
| 429 | Rate limit exceeded |
| 500 | Server error |

---

## 3. Public Auth Endpoints

`POST /api/auth/login` — Employee login (username/phone + PIN)

`POST /api/auth/refresh` — Refresh access token

`POST /api/auth/logout` — Invalidate refresh token (requires auth)

`GET /api/auth/me` — Current user profile (requires auth)

`GET /api/auth/owner-exists` — Check if any Owner is registered (public)

`POST /api/auth/register-owner` — Register first Owner (public, first-time setup)

`POST /api/auth/register-order` — Payment order for a plan before account exists (public)

`POST /api/auth/generate-credentials` — Generate employee credentials (Owner only)

---

## 4. POS — Bills (`/api/bills`)

Billing is the core POS transaction. All staff can view/create; only Owner/Manager can void.

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| `GET` | `/api/bills` | List bills (query: date, status, payment mode) | Staff |
| `GET` | `/api/bills/next-invoice` | Get next invoice number (atomic counter) | Staff |
| `GET` | `/api/bills/invoice-range` | Reserve contiguous invoice range (offline billing) | Staff |
| `GET` | `/api/bills/:id` | Get single bill by ID | Staff |
| `POST` | `/api/bills` | Create a bill (snapshots tax per line, invalidates reports cache) | Staff + active subscription |
| `POST` | `/api/bills/items-batch` | Batch-fetch line items for multiple bills | Staff + active subscription |
| `DELETE` | `/api/bills/:id` | Void a bill (Owner/Manager only) | Owner/Manager + active subscription |

**Create bill body** (key fields):
```json
{
  "restaurantId": "...",
  "branchId": "...",
  "orderId": "...",
  "customerId": "...",
  "employeeId": "...",
  "items": [{ "productId", "name", "qty", "price", "gstPercent", "variant", "addOns" }],
  "payments": [{ "mode": "cash|upi|card|wallet", "amount" }],
  "discount": { "type": "percent|fixed", "value", "reason" },
  "taxSummary": [{ "slab", "taxableAmount", "gstAmount" }],
  "grandTotal": 0,
  "invoiceNumber": "INV-0001"
}
```

---

## 5. POS — Orders (`/api/orders`)

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| `GET` | `/api/orders` | List orders (filter by status, table, date) | Staff |
| `POST` | `/api/orders` | Create order | Staff |
| `PUT` | `/api/orders/:id` | Update order (status, KOT, table) | Staff |
| `GET` | `/api/held-orders` | List held orders | Staff |

---

## 6. POS — Products (`/api/products`)

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| `GET` | `/api/products` | List products (category, availability, branch filters) | Staff |
| `POST` | `/api/products` | Create product (Owner/Manager) | Owner/Manager |
| `PUT` | `/api/products/:id` | Update product | Owner/Manager |
| `DELETE` | `/api/products/:id` | Delete product | Owner/Manager |

Product fields: name, category, price, gstPercent, variants[], addOns[], images[], availability, branchId, kitchenRouting.

---

## 7. POS — Tables & Floor Plan (`/api/tables`)

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| `GET` | `/api/tables` | List tables (status, floor, occupancy) | Staff |
| `POST` | `/api/tables` | Create table | Staff |
| `PUT` | `/api/tables/:id` | Update table (status, guest count, order link) | Staff |
| `DELETE` | `/api/tables/:id` | Delete table | Staff |

Table statuses: `Available`, `Occupied`, `Cleaning`, `Disabled`, `Merged`, `Reserved`.

---

## 8. POS — Customers & Loyalty (`/api/customers`, `/api/loyalty`, `/api/rewards`)

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| `GET` | `/api/customers` | List customers (search by phone/name) | Staff |
| `POST` | `/api/customers` | Create customer | Staff |
| `PUT` | `/api/customers/:id` | Update customer | Staff |
| `GET` | `/api/loyalty` | Customer loyalty points & tiers | Staff |
| `GET` | `/api/rewards` | List available rewards | Staff |
| `POST` | `/api/rewards/redeem` | Redeem loyalty points | Staff |

---

## 9. POS — Employees (`/api/employees`)

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| `GET` | `/api/employees` | List employees (role, PIN, status) | Staff |
| `POST` | `/api/employees` | Create employee (Owner/Manager) | Owner/Manager |
| `PUT` | `/api/employees/:id` | Update employee | Owner/Manager |
| `DELETE` | `/api/employees/:id` | Deactivate employee | Owner/Manager |

Roles: `Owner`, `Manager`, `Cashier`. Permissions are Owner-configured toggles.

---

## 10. POS — Branches (`/api/branches`)

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| `GET` | `/api/branches` | List branches | Staff |
| `POST` | `/api/branches` | Create branch (Owner/Manager) | Owner/Manager |
| `PUT` | `/api/branches/:id` | Update branch | Owner/Manager |

---

## 11. POS — Expenses (`/api/expenses`)

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| `GET` | `/api/expenses` | List expenses (category, vendor, date range) | Staff |
| `POST` | `/api/expenses` | Create expense | Staff |
| `PUT` | `/api/expenses/:id` | Update expense | Staff |

---

## 12. POS — Reservations (`/api/reservations`)

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| `GET` | `/api/reservations` | List reservations (date, table, status) | Staff |
| `POST` | `/api/reservations` | Create reservation | Staff |
| `PUT` | `/api/reservations/:id` | Update/cancel reservation | Staff |

---

## 13. POS — Waiter Calls / Customer Requests (`/api/waiter-requests`)

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| `GET` | `/api/waiter-requests` | List pending/seen/completed calls (branch-scoped) | Staff |
| `POST` | `/api/waiter-requests/:id/seen` | Mark call SEEN (silence reminder, card stays live) | Staff |
| `POST` | `/api/waiter-requests/:id/complete` | Mark call COMPLETED | Staff |

---

## 14. POS — Device Registration (`/api/devices`)

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| `POST` | `/api/devices/register` | Register this POS device (best-effort) | Staff |

---

## 15. POS — Sync (`/api/sync`)

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| `POST` | `/api/sync` | Sync offline data / replay queued writes | Staff |

---

## 16. POS — Subscription (`/api/subscription`)

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| `GET` | `/api/subscription/status` | Fetch restaurant subscription status (trial/grace/active/expired) | Staff |

---

## 17. Admin — Restaurants (`/api/admin/restaurants`)

Super-admin platform console. All routes require `requireAuth` + `requireCollectionAccess('Restaurant', ...)`.

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/admin/restaurants` | List restaurants (paginated, cached 30s) |
| `GET` | `/api/admin/restaurants/:id` | Get restaurant detail |
| `GET` | `/api/admin/restaurants/:id/statistics` | Restaurant statistics |
| `GET` | `/api/admin/restaurants/:id/branch-usage` | Branch usage summary |
| `GET` | `/api/admin/restaurants/:id/subscription` | Subscription by restaurant |
| `GET` | `/api/admin/restaurants/:id/payment-history` | Subscription payment history |
| `GET` | `/api/admin/restaurants/:id/device-activity-summary` | Device activity |
| `GET` | `/api/admin/restaurants/:id/subscription-usage` | Subscription usage |
| `POST` | `/api/admin/restaurants` | Create restaurant |
| `PUT` | `/api/admin/restaurants/:id` | Update restaurant |
| `DELETE` | `/api/admin/restaurants/:id` | Delete restaurant |
| `POST` | `/api/admin/restaurants/:id/restore` | Restore soft-deleted restaurant |
| `POST` | `/api/admin/restaurants/:id/permanent-delete` | Permanent delete |
| `POST` | `/api/admin/restaurants/:id/suspend` | Suspend restaurant |
| `POST` | `/api/admin/restaurants/:id/activate` | Activate restaurant |
| `POST` | `/api/admin/restaurants/:id/branches` | Create branch |
| `POST` | `/api/admin/restaurants/:id/notes` | Add admin note |
| `POST` | `/api/admin/restaurants/:id/reset-password` | Reset restaurant credentials |
| `POST` | `/api/admin/restaurants/:id/regenerate-credentials` | Regenerate credentials |

### Restaurant Media (logo/cover)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/admin/restaurants/:id/media/storage` | Storage metrics |
| `POST` | `/api/admin/restaurants/:id/media/logo` | Upload logo (multer, 5MB, image/* ) |
| `POST` | `/api/admin/restaurants/:id/media/cover` | Upload cover image |
| `DELETE` | `/api/admin/restaurants/:id/media/logo` | Delete logo |
| `DELETE` | `/api/admin/restaurants/:id/media/cover` | Delete cover |

---

## 18. Admin — Owners (`/api/admin/owners`)

Full owner lifecycle. Requires `User` collection access.

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/admin/owners` | List owners (paginated) |
| `POST` | `/api/admin/owners` | Create owner |
| `GET` | `/api/admin/owners/:id` | Get owner |
| `PUT` | `/api/admin/owners/:id` | Update owner |
| `POST` | `/api/admin/owners/:id/reset-password` | Reset password |
| `POST` | `/api/admin/owners/:id/deactivate` | Deactivate |
| `POST` | `/api/admin/owners/:id/activate` | Activate |
| `POST` | `/api/admin/owners/:id/suspend` | Suspend |
| `POST` | `/api/admin/owners/:id/lock` | Lock account |
| `POST` | `/api/admin/owners/:id/unlock` | Unlock account |
| `DELETE` | `/api/admin/owners/:id` | Delete |
| `POST` | `/api/admin/owners/:id/restore` | Restore |
| `POST` | `/api/admin/owners/:id/permanent-delete` | Permanent delete |

### Owner → Restaurant Mapping

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/admin/owners/:id/restaurants` | Restaurants assigned to owner |
| `POST` | `/api/admin/owners/:id/restaurants/:restaurantId` | Assign restaurant |
| `DELETE` | `/api/admin/owners/:id/restaurants/:restaurantId` | Unassign restaurant |

### Owner Sessions

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/admin/owners/:id/sessions` | List active sessions |
| `POST` | `/api/admin/owners/:id/sessions/:sessionId/revoke` | Revoke session |
| `POST` | `/api/admin/owners/:id/sessions/revoke-all` | Revoke all sessions |

### Owner Devices

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/admin/owners/:id/devices` | List owner's devices |
| `GET` | `/api/admin/owners/:id/devices/:deviceId` | Get device |
| `POST` | `/api/admin/owners/:id/devices/:deviceId/block` | Block device |
| `POST` | `/api/admin/owners/:id/devices/:deviceId/unblock` | Unblock device |
| `DELETE` | `/api/admin/owners/:id/devices/:deviceId` | Remove device |

### Owner Profile & Stats

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/admin/owners/:id/login-history` | Login history |
| `GET` | `/api/admin/owners/:id/profile` | Owner profile |
| `GET` | `/api/admin/owners/:id/statistics` | Owner statistics |

---

## 19. Admin — Devices (`/api/admin/devices`)

POS terminal registry. Requires `Device` collection access.

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/admin/devices` | List devices (paginated) |
| `GET` | `/api/admin/devices/statistics` | Device statistics |
| `POST` | `/api/admin/devices/bulk-approve` | Bulk approve |
| `POST` | `/api/admin/devices/bulk-reject` | Bulk reject |
| `POST` | `/api/admin/devices/remove-inactive` | Remove inactive devices |
| `POST` | `/api/admin/devices/force-logout` | Force logout all sessions |
| `GET` | `/api/admin/devices/:id` | Get device |
| `POST` | `/api/admin/devices/:id/approve` | Approve device |
| `POST` | `/api/admin/devices/:id/reject` | Reject device |
| `POST` | `/api/admin/devices/:id/block` | Block device |
| `POST` | `/api/admin/devices/:id/unblock` | Unblock device |
| `DELETE` | `/api/admin/devices/:id` | Remove device |
| `POST` | `/api/admin/devices/:id/permanent-delete` | Permanent delete |
| `POST` | `/api/admin/devices/:id/force-logout` | Force logout device sessions |
| `GET` | `/api/admin/devices/:id/activity` | Device activity |
| `GET` | `/api/admin/devices/:id/sessions` | Device sessions |
| `POST` | `/api/admin/devices/:id/sessions/:sessionId/revoke` | Revoke session |
| `GET` | `/api/admin/devices/:id/health` | Device health |

---

## 20. Admin — Subscriptions (`/api/admin/subscriptions`)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/admin/subscriptions` | List all subscriptions |
| `GET` | `/api/admin/subscriptions/:id` | Get subscription |
| `POST` | `/api/admin/subscriptions/:id/renew` | Renew |
| `PUT` | `/api/admin/subscriptions/:id/upgrade` | Upgrade plan |
| `PUT` | `/api/admin/subscriptions/:id/downgrade` | Downgrade plan |
| `POST` | `/api/admin/subscriptions/:id/pause` | Pause |
| `POST` | `/api/admin/subscriptions/:id/resume` | Resume |
| `GET` | `/api/admin/restaurants/:id/subscription` | Subscription by restaurant |
| `GET` | `/api/admin/restaurants/:id/subscription-usage` | Subscription usage |
| `GET` | `/api/admin/restaurants/:id/payment-history` | Payment history |
| `POST` | `/api/admin/restaurants/:id/subscription/features` | Grant/update features |

---

## 21. Admin — Subscription Plans (`/api/admin/subscription-plans`)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/admin/subscription-plans` | List plans (cached 5 min) |
| `GET` | `/api/admin/subscription-plans/:id` | Get plan |
| `POST` | `/api/admin/subscription-plans` | Create plan |
| `PUT` | `/api/admin/subscription-plans/:id` | Update plan |
| `POST` | `/api/admin/subscription-plans/:id/clone` | Clone plan |
| `POST` | `/api/admin/subscription-plans/:id/status` | Set status (active/archived/draft) |
| `POST` | `/api/admin/subscription-plans/:id/archive` | Archive |
| `POST` | `/api/admin/subscription-plans/:id/restore` | Restore |
| `POST` | `/api/admin/subscription-plans/:id/permanent-delete` | Permanent delete |
| `GET` | `/api/admin/subscription-plans/:id/versions` | Plan versions |
| `POST` | `/api/admin/subscription-plans/:id/rollback` | Rollback to version |
| `GET` | `/api/admin/subscription-plans/:id/statistics` | Plan statistics |
| `POST` | `/api/admin/subscription-plans/assign` | Assign plan to restaurant |
| `POST` | `/api/admin/subscription-plans/trial-convert` | Convert trial to paid |

---

## 22. Admin — Analytics (`/api/admin/analytics`)

| Method | Endpoint | Description | Cache |
|---|---|---|---|
| `GET` | `/api/admin/analytics/dashboard` | Dashboard stats | 60s |
| `GET` | `/api/admin/analytics` | Analytics data | 30s |
| `GET` | `/api/admin/analytics/recent-activity` | Recent activity feed | 30s |
| `GET` | `/api/admin/analytics/latest-restaurants` | Latest restaurants | 60s |
| `GET` | `/api/admin/analytics/subscription-revenue` | Subscription revenue | 60s |
| `GET` | `/api/admin/analytics/devices` | Device analytics | 60s |
| `GET` | `/api/admin/analytics/growth` | Growth metrics | 60s |
| `GET` | `/api/admin/analytics/churn` | Churn metrics | 60s |
| `GET` | `/api/admin/analytics/activity` | Activity metrics | 30s |
| `GET` | `/api/admin/analytics/api-requests` | API request analytics | 60s |

### Analytics Exports

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/admin/analytics/export/csv` | Export CSV |
| `GET` | `/api/admin/analytics/export/excel` | Export Excel |
| `GET` | `/api/admin/analytics/export/pdf` | Export PDF |

---

## 23. Admin — Reports (Read-Only Platform Console)

`/api/admin/restaurants/:id/reports/*`

| Endpoint | Description |
|---|---|
| `/reports/sales-summary` | Sales summary |
| `/reports/sales-trend` | Sales trend over time |
| `/reports/sales-payments` | Payment breakdown |
| `/reports/sales-order-types` | Order type mix |
| `/reports/sales-cashiers` | Cashier performance |
| `/reports/products-top` | Top products |
| `/reports/products-categories` | Category sales |
| `/reports/products-abc` | ABC product analysis |
| `/reports/inventory-stock` | Inventory stock levels |
| `/reports/inventory-valuation` | Inventory valuation |
| `/reports/employees-performance` | Employee performance |
| `/reports/closing-z` | Closing Z report |
| `/reports/summaries-monthly` | Monthly summaries |

---

## 24. Admin — Finance (Read-Only Platform Console)

`/api/admin/restaurants/:id/finance/*`

| Endpoint | Description |
|---|---|
| `/finance/overview` | Finance overview |
| `/finance/pnl` | Profit & loss |
| `/finance/expenses` | Expense list |
| `/finance/expense-register` | Expense register |
| `/finance/cashflow` | Cash flow |
| `/finance/cash-ledger` | Cash ledger |
| `/finance/gst` | GST summary |
| `/finance/vendors` | Vendor list |
| `/finance/recurring` | Recurring expenses |
| `/finance/categories` | Expense categories |
| `/finance/monthly` | Monthly finance |
| `/finance/branches` | Per-branch finance |

---

## 25. Admin — Settings (`/api/admin/settings`)

| Method | Endpoint | Description | Cache |
|---|---|---|---|
| `GET` | `/api/admin/settings/company` | Company settings | 5 min |
| `PUT` | `/api/admin/settings/company` | Update company settings | — |
| `GET` | `/api/admin/settings/default-subscription` | Default subscription settings | 5 min |
| `PUT` | `/api/admin/settings/default-subscription` | Update defaults | — |
| `GET` | `/api/admin/settings/general` | General settings | 5 min |
| `PUT` | `/api/admin/settings/general` | Update general | — |

---

## 26. Admin — Support Tickets (`/api/admin/support/tickets`)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/admin/support/tickets` | List tickets (paginated) |
| `GET` | `/api/admin/support/tickets/stats` | Ticket stats |
| `POST` | `/api/admin/support/tickets` | Create ticket |
| `GET` | `/api/admin/support/tickets/:id` | Get ticket |
| `PUT` | `/api/admin/support/tickets/:id` | Update ticket |
| `POST` | `/api/admin/support/tickets/:id/status` | Set status |
| `POST` | `/api/admin/support/tickets/:id/assign` | Assign to agent |
| `GET` | `/api/admin/support/tickets/:id/replies` | Get replies |
| `POST` | `/api/admin/support/tickets/:id/replies` | Add reply |
| `POST` | `/api/admin/support/tickets/:id/attachments` | Upload attachment |
| `DELETE` | `/api/admin/support/tickets/:id/attachments/:attachmentId` | Remove attachment |
| `POST` | `/api/admin/support/tickets/:id/satisfaction` | Set satisfaction rating |
| `GET` | `/api/admin/support/tickets/:id/activity` | Ticket activity |
| `DELETE` | `/api/admin/support/tickets/:id` | Delete ticket |
| `POST` | `/api/admin/support/tickets/:id/restore` | Restore ticket |
| `GET` | `/api/admin/support/search` | Unified support search |

---

## 27. Admin — Audit Logs (`/api/admin/audit-logs`)

Enterprise audit with integrity verification, retention, legal holds.

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/admin/audit-logs` | List audit entries (paginated) |
| `GET` | `/api/admin/audit-logs/stats` | Audit stats (cached 30s) |
| `GET` | `/api/admin/audit-logs/registry` | Audit registry |
| `GET` | `/api/admin/audit-logs/integrity/verify` | Integrity report |
| `GET` | `/api/admin/audit-logs/integrity/checksum` | Integrity checksum |
| `GET` | `/api/admin/audit-logs/retention` | Retention config |
| `POST` | `/api/admin/audit-logs/retention/run` | Run retention job |
| `GET` | `/api/admin/audit-logs/archive` | Archived entries |
| `POST` | `/api/admin/audit-logs/archive/restore` | Restore archive |
| `POST` | `/api/admin/audit-logs/exports` | Create audit export |
| `GET` | `/api/admin/audit-logs/exports/:id` | Export status |
| `GET` | `/api/admin/audit-logs/exports/:id/download` | Download export |
| `GET` | `/api/admin/audit-logs/legal-holds` | List legal holds |
| `POST` | `/api/admin/audit-logs/legal-holds` | Create legal hold |
| `DELETE` | `/api/admin/audit-logs/legal-holds/:id` | Release legal hold |
| `GET` | `/api/admin/audit-logs/saved-searches` | Saved searches |
| `POST` | `/api/admin/audit-logs/saved-searches` | Create saved search |
| `DELETE` | `/api/admin/audit-logs/saved-searches/:id` | Remove saved search |
| `GET` | `/api/admin/audit-logs/alerts` | Audit alerts |
| `GET` | `/api/admin/audit-logs/alerts/summary` | Alert summary |
| `POST` | `/api/admin/audit-logs/alerts/:id/resolve` | Resolve alert |
| `DELETE` | `/api/admin/audit-logs/alerts/:id` | Remove alert |
| `GET` | `/api/admin/audit-logs/:id` | Audit entry detail |

---

## 28. Admin — Security (IP Blocklist)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/admin/security/blocked-ips/suggested` | Suggested IPs to block |
| `GET` | `/api/admin/security/blocked-ips` | Blocked IP list |
| `POST` | `/api/admin/security/blocked-ips` | Block IP |
| `DELETE` | `/api/admin/security/blocked-ips/:id` | Unblock IP |

---

## 29. Admin — CRM (Read-Only)

`/api/admin/restaurants/:id/crm/*`

| Endpoint | Description |
|---|---|
| `/crm/overview` | CRM overview |
| `/crm/customers` | Customer list |
| `/crm/loyalty-settings` | Loyalty settings |
| `/crm/tiers` | Loyalty tiers |
| `/crm/campaigns` | Marketing campaigns |
| `/crm/referrals` | Referral program |
| `/crm/report` | CRM report |
| `/crm/offers` | Active offers |
| `/crm/rewards` | Rewards |

---

## 30. Public Store — Customer QR Site

Tenant-scoped endpoints used by `customer-site/`. The `slug` is pinned on every request; backend scopes data to that restaurant.

| Endpoint | Description |
|---|---|
| `GET /api/public-store/:slug/products` | Tenant-scoped menu catalog |
| `GET /api/public-store/:slug/categories` | Categories |
| `POST /api/public-store/:slug/session` | Create/resume QR ordering session |
| `GET /api/public-store/:slug/session/:token` | Get session state |
| `POST /api/public-store/:slug/orders` | Place QR order |
| `GET /api/public-store/:slug/orders/:id/track` | Live order tracking |
| `GET /api/public-store/receipts/:token` | Standalone receipt lookup |

---

## 31. Socket.IO Events (Real-Time)

Namespace: default (`/`). Auth via `Authorization` query param or handshake.

| Event | Direction | Description |
|---|---|---|
| `order:new` | Server → Client | New online/QR order (POS terminals, KDS) |
| `order:adjusted` | Server → Client | Order status adjustment |
| `waiter:call` | Server → Client | New waiter/customer bell |
| `waiter:call:seen` | Server → Client | Call marked SEEN (remote terminal) |
| `waiter:call:completed` | Server → Client | Call completed (remote terminal) |
| `waiter:call:reactivated` | Server → Client | Call re-activated |
| `table:occupancy` | Server → Client | Table status change |
| `settings:updated` | Server → Client | Settings changed on another terminal |
| `product:updated` | Server → Client | Product availability/price change |
| `bill:updated` | Server → Client | Bill status change |

Falls back to HTTP polling (15s–30s) when WebSocket is unavailable.

---

## 32. Response Caching

Redis-backed response cache (in-memory fallback when `REDIS_URL` is unset). Cache tags used for invalidation:

| Tag | Invalidated On |
|---|---|
| `restaurants` | Restaurant create/update/delete |
| `plans` | Plan create/update/delete |
| `settings` | Settings create/update |
| `reports` | Bill create/void |
| `support` | Ticket create/update |
| `audit` | Audit log mutations |
| `analytics` | Analytics data mutations |

---

## 33. Status Codes Reference

| Code | When Returned |
|---|---|
| 200 | Successful GET/PUT |
| 201 | Successful POST (resource created) |
| 204 | Successful DELETE |
| 400 | Validation error / bad request body |
| 401 | Missing or invalid JWT |
| 403 | RBAC denies access to collection/action |
| 404 | Resource not found |
| 409 | Duplicate / conflict (e.g. existing email) |
| 429 | Rate limit exceeded |
| 500 | Unexpected server error |

---

## 34. Key Headers

| Header | Value | Purpose |
|---|---|---|
| `Authorization` | `Bearer <token>` | Authentication (access token) |
| `Content-Type` | `application/json` | Request/Body format |
| `Accept` | `application/json` | Response format |

---

*Base URL: `http://localhost:3002/api` (dev). Full route definitions live in `backend/src/routes/`. See [ARCHITECTURE.md](ARCHITECTURE.md) for system design.*