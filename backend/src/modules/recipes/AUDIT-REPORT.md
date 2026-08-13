# Recipe Manager — Phase 1 Architecture & Integration Audit

Status: audit complete — implementation may begin (Phase 2+).
Date: 2026-08-12

---

## 1. Existing architecture summary

Monorepo with four apps plus one backend:

| App | Stack | Role |
|---|---|---|
| `backend/` | Express + Mongoose (MongoDB) + Zod + socket.io | All business logic, multi-tenant APIs |
| `restaurant-pos/Frontend/` | React 18 + Vite, offline-capable, HashRouter | POS: billing, kitchen, inventory, offers, reports |
| `customer-site/` | React (customer ordering, loyalty, offers) | QR ordering, loyalty points/offers landing |
| `admin/` | React | SaaS admin dashboard (restaurants, AI quota, audit) |

Backend layering (strict, consistent): `routes → controllers → services → repositories → models`.
- Validation: Zod schemas in `backend/src/validation/*`, applied via `validate()` middleware.
- Caching: `cached({ ttlMs, tags })` response cache in `utils/ResponseCache`; POS frontend has its own TTL + offline cache layer (`src/api/client.ts` with `cachedFetch`, `CACHE_INVALIDATED_EVENT`).
- Audit: `AuditLog` model + `LegacyAuditAdapter` repo; created from services (best-effort, non-fatal).
- Auth: JWT access + hashed rotating refresh tokens; roles `super_admin | owner | manager | cashier | waiter | kitchen | inventory`.
- Module pattern exists for domain subsystems: `modules/` holds `ai`, `media`, `reports`, `subscription`, `voice-inventory`, `public-store`, `qr-ordering`, `settings`, `payment`, `audit`, `adminReports`. A Recipe module should follow this pattern.

## 2. Existing inventory data model — THE KEY FINDING

**There is no separate ingredient database. The `Product` collection IS the inventory.**

`Product` (models/Product.ts) carries both menu and inventory concerns on one document:

```ts
name, code, price, category, image, gstPercent, availability, favorite,
restaurantId, branchPrice (Map branchId→price),
currentStock, unit, minStock, maxStock, reorderLevel,
averageCost,            // weighted-average cost per unit, updated on every purchase
supplier, storageLocation, notes, barcode, expiryDate, batchNumber,
voiceAliases, searchAliases, learnedAliases, ...
```

- **Menu items**: `availability: true`, `price > 0`.
- **Inventory ingredients**: `availability: false` (hidden from billing menu), `price: 0`. Auto-created hidden products get `category: 'Inventory'` + code `INV-*`.
- **The frontend Inventory module (`InventoryManager.tsx`) maps the same `/api/products` list into `InventoryItem`s** — it is not a separate collection.

Supporting collections:

- `Purchase` — supplier, item (name string), brand, expiryDate, quantity, unit, price (per unit), total, date, status. **Historical cost lives here** (a purchase ledger).
- `Supplier` — vendor records with `items: string[]` (names).
- `InventoryEvent` — activity feed: `type ∈ sold|adjusted|waste|closing|purchase|return`, item name, quantity, unit, operator, details, eventDate, refId.
- `Vendor` — an alternate vendor model used by a separate UI surface.

## 3. Existing product/menu data model

- `Product` (above) + `ProductVariant` (separate collection: `productId, name, price, branchPrice`) for sizes.
- **Add-ons/modifiers are NOT products.** `components/AddOnModal.tsx` holds hardcoded per-category option lists (`ADDON_GROUPS`) — client-side price adjustments that get flattened into the line-item `notes` string. They do not reference inventory. → Recipe consumption must NOT try to consume add-ons automatically; treat them as text unless a merchant explicitly maps them.
- Combos exist as an **offer type** (`comboProductIds` + `comboPrice`), not a product kind.
- Product IDs used by billing: line items carry `item.product.id` → persisted as `BillItem.menuItemId` (string).

## 4. Existing sales/order flow

- `Order` + `OrderItem` — lifecycle New → Accepted → Preparing → Ready → Served → Paid → Closed. `OrderItem` snapshots name/price at order time.
- `Bill` + `BillItem` — **immutable, append-only**; `BillItem` snapshots `priceAtSale, gstRateAtSale, discountAtSale, itemName`. Bills are the settlement record.
- **Stock deduction happens at bill creation**, best-effort, per **menu product** (`billService.deductBillStock` → `stockMovementService.applyMovement({ type: 'sale', allowNegative: true })` — clamps at zero, never fails billing). Void → `restoreBillStock` (`type: 'return'`).
- **Idempotency already exists**: `Bill.clientRef` unique per `{restaurantId, clientRef}` (offline replay safe). This is the hook the recipe consumption idempotency must reuse.
- Refunds: `Bill.refundedItems[]` with `menuItemId`, `quantity`, `amount`.
- Loyalty points, daily summaries, customer visits are all updated inside the same bill transaction path (not a Mongo transaction — sequential best-effort writes, matching the deployment's single-node MongoDB).

## 5. Existing stock movement flow — THE ENGINE TO REUSE

`services/stockMovementService.ts` — **single centralized stock engine**. Every stock change flows through `applyMovement()`:

1. resolve product (by id or exact-name), tenant check (ownerId must match),
2. negative-stock guard (reject, or clamp when `allowNegative`),
3. **atomic** `currentStock` `$inc` via `findOneAndUpdate({ currentStock: { $gte: -delta } })` (concurrency-safe),
4. weighted-average cost recompute when `type === 'purchase'`,
5. `InventoryEvent` (activity feed) + `AuditLog` (best-effort, non-fatal).

Types: `purchase | sale | waste | adjustment | opening | closing | correction | return`.

Purchases: `purchaseService` → `applyPurchaseStock` (auto-creates hidden inventory products when the item isn't in the catalog). Products: `POST /products/:id/stock` → same engine.

**Recipe consumption must call this engine** — never write `currentStock` directly.

## 6. Existing offer flow

- `Offer` collection — 11 types (`percentage, flat, bogo, free_item, combo, cashback, reward_points, coupon, festival, referral, loyalty_bonus`), `applicableCategories[]`, `applicableProductIds[]`, `couponCode`, `branchIds[]`, statuses `draft/active/scheduled/paused/expired/cancelled`, `OfferAnalytics` for usage.
- `services/offerEngine.ts` — server-side discount computation (billing), inventory-aware recommendations (`offerEngine` already reads `currentStock`, `averageCost`, `minStock`).
- **No margin/profitability data anywhere.** Offer value is computed against price, never against cost. → Recipe costing plugs in here.

## 7. Existing tenant isolation

- JWT payload → `req.user.restaurantId`; controllers pass it into every service; **services scope every query by `restaurantId`** and services reject mismatched owners (e.g. `purchaseService.update` throws 403, `stockMovementService` throws 403).
- `resolveMenuProductScope` — a restaurant sees only its own products (global/`restaurantId: null` catalog only as fresh-account bootstrap).
- Branches: optional `branchId` on most models; branch-filtered list queries throughout.
- Roles gate routes via `requireRole('Owner','Manager')` etc.; feature gating via `requireFeature('inventory'|'analytics')`.

## 8. Existing cost calculation

- **`Product.averageCost`** — weighted-average cost per unit, recomputed on every purchase: `newAvg = (oldCost×before + price×qty) / after` (rounded to 2dp).
- `financeService` estimates per-bill COGS as `Σ averageCost × quantity` by matching bill items to products by id/name.
- **No historical cost snapshots at sale time** — only the Purchase ledger can reconstruct history.
- **No unit conversion system exists** — units are free-form strings (`kg`, `g`, `L`, `ml`, `pcs`). A recipe-unit converter must be built (small, domain-scoped) and validated against the item's stored unit.

## 9. What can be reused (do NOT rebuild)

| Need | Reuse |
|---|---|
| Ingredient catalog | `Product` collection (ingredients = `availability:false` products) |
| Ingredient cost | `Product.averageCost` (weighted avg — already the house methodology) |
| Stock consumption | `stockMovementService.applyMovement()` |
| Sale finalization hook | `billService.create` (where stock is already deducted) |
| Idempotency | `Bill.clientRef` unique key pattern |
| Audit | `AuditLog` + `LegacyAuditAdapter` |
| Tenant scoping | `req.user.restaurantId` + service-level scoping + `requireRole`/`requireFeature` |
| Validation | Zod schemas + `validate()` middleware |
| Response caching | `cached({ ttlMs, tags })` |
| Reports | `modules/reports` aggregation pattern (server-side, no big downloads) |
| Frontend design system | Inventory module (`InventoryManager` contexts, toasts, pages), Tailwind, lucide icons |
| Variants | `ProductVariant` (recipe per variant can be keyed by variant name) |
| Purchase history | `Purchase` collection for cost trend analysis |

## 10. What must be extended

1. **`Product`** — no schema change needed; recipes reference `Product._id`. (Optionally a soft hint field, avoided to keep migration zero-touch.)
2. **`billService.create`** — after bill persistence, generate theoretical consumption for recipe-linked line items (idempotent via `clientRef`). Also skip the legacy per-product deduction for products that have an active recipe (avoid double deduction of a menu product's own stock).
3. **Void/refund paths** — reverse consumption records (type `return`).
4. **`offerEngine` / offer UI** — expose contribution/margin warnings for offer products.
5. **Reports** — recipe cost + variance reports via server-side aggregation.
6. **`modules/ai`** — later; AI consumes the deterministic metrics the recipe module computes (out of scope now, structure must expose them).

## 11. What must NOT be duplicated

- ❌ No second ingredient database — recipes reference `Product._id`.
- ❌ No second stock system — consumption flows through `stockMovementService`.
- ❌ No parallel unit-conversion service that could conflict — one small converter for the recipe domain, validated against stored item units.
- ❌ No parallel auth/RBAC — reuse `requireAuth`, `requireRole`, `requireFeature`.
- ❌ No parallel cache/audit/validation infra.
- ❌ No parallel frontend design system.

## 12. Files/modules that will be modified

- `backend/src/models/index.ts` — export new models.
- `backend/src/repositories/index.ts` — register new repos.
- `backend/src/validation/index.ts` — export recipe validators.
- `backend/src/server.ts` — mount `/api/recipes`, `/api/recipe-consumption`, `/api/profitability`.
- `backend/src/services/billService.ts` — consumption hook on create + reversal on void/refund.
- `restaurant-pos/Frontend/components/inventory/InventoryManager.tsx` — add Recipes nav page.
- `restaurant-pos/Frontend/src/api/client.ts` — recipe API helpers.

## 13. New files/modules

Backend — `backend/src/modules/recipes/`:
- `models/Recipe.ts` — recipe + embedded components + yield + status/version + cost summary cache.
- `models/RecipeVersion.ts` — immutable historical snapshots (components + cost + yield + effective range).
- `models/RecipeConsumption.ts` — idempotent theoretical consumption records (bill-linked, per-ingredient cost snapshot).
- `services/unitConversion.ts` — kg↔g↔mg, L↔ml, pcs, with incompatibility validation.
- `services/recipeCostEngine.ts` — recursive cost resolution (sub-recipes), yield/wastage, weighted-avg costs.
- `services/recipeService.ts` — CRUD, version, activate, duplicate, archive, circular-dependency validation.
- `services/consumptionService.ts` — generate theoretical consumption, void/refund reversal, reconciliation vs actual movements.
- `services/profitabilityService.ts` — product/category/offer profitability.
- `services/recalculateService.ts` — dependency-aware recalculation when an ingredient cost changes.
- `controllers/*.ts`, `routes/recipes.ts`, `validators/*.ts`, `__tests__/*`.

Frontend:
- `restaurant-pos/Frontend/components/inventory/pages/RecipesPage.tsx` — list + editor (ingredient picker, live cost/margin), versions, sub-recipes, costing/variance view.

## 14. Database migration requirements

- **No changes to existing collections** — zero-touch migration.
- New collections auto-created by Mongoose: `recipes`, `recipeversions`, `recipeconsumptions`.
- Indexes: `{restaurantId, productId, isDeleted}`, `{restaurantId, status}`, `{restaurantId, productId, version}`, `{restaurantId, productId, status}` (unique active-per-product per restaurant — enforced in service), `RecipeConsumption {restaurantId, clientRef}` unique (idempotency), `{restaurantId, billId}`, `{restaurantId, date}`.

## 15. Risks and edge cases

1. **Double deduction**: menu product with both own `currentStock` AND a recipe → billService must skip the legacy per-product `sale` movement when an active recipe exists, else stock is consumed twice.
2. **Add-ons/modifiers are text, not products** — cannot be auto-consumed; must remain optional merchant mappings.
3. **Offline POS**: bills finalize offline then replay via `clientRef` → consumption must be keyed on the same `clientRef` so replays never double-consume.
4. **No Mongo transactions (single-node deployment)** → use idempotency + best-effort sequencing + reconciliation, same as the existing bill/loyalty path. Never make a sale fail because consumption failed.
5. **Menu products and ingredients share a collection** — a recipe ingredient may itself be a salable product; consumption must treat it as an ingredient only when consumed via a parent recipe.
6. **Unit mismatch** — recipe quantity in `g` for an item stored in `kg` must convert; truly incompatible pairs must be rejected at save time.
7. **Circular sub-recipes** — must be rejected at save time (cycle detection over the dependency graph) and at consume time (defense in depth, max-depth cap).
8. **Versioning semantics** — a sale must resolve against the recipe version active at sale time; RecipeVersion + consumption snapshot guarantee explainability even if the recipe later changes.
9. **Cost changes** — recalc must be dependency-aware (only recipes containing the changed ingredient), batched, and must not recompute historical consumption records.
10. **Tenant leakage via references** — every `productId`/`recipeId`/sub-recipe reference is re-validated against the caller's `restaurantId` server-side.
