# Plan: Product Type Separation (Menu vs Inventory)

## Problem

Menu items (`availability: true`) and inventory items (`availability: false`) share the same `products` collection. Every API call returns **all** products, and filtering happens only on the client side. This causes:

1. **Inventory items leak into billing, marketing, customer site, and reports** when a frontend component forgets to filter.
2. **Wasted bandwidth** — raw ingredients (Paneer, Oil, Tomato) are sent to every endpoint.
3. **Fragile architecture** — every new component must remember `if (!p.availability) return false`.

## Solution

Add a `type: 'menu' | 'inventory'` field to the Product schema as the **authoritative discriminator**. Server-side filtering ensures only the right type is returned. `availability` remains for backward compat (menu items: available/sold-out toggle) but is no longer the type separator.

---

## Phase 1: Backend Model + Migration

### 1.1 Product Model (`backend/src/models/Product.ts`)

- Add `type` field: `type: { type: String, enum: ['menu', 'inventory'], default: 'menu', index: true }`
- Add compound index: `{ type: 1, restaurantId: 1, isDeleted: 1 }`
- **Keep `availability`** — it now means "is this menu item currently available for sale" (not "is this an inventory item")

### 1.2 Migration Script (`backend/scripts/migrate-product-type.ts`)

One-time script to backfill `type` from `availability`:
```
availability: true  → type: 'menu'
availability: false → type: 'inventory'
```
- Dry-run mode by default (`--dry-run`)
- Logs count of affected documents per restaurant
- Idempotent (skips documents that already have `type` set)

### 1.3 Backend Service (`backend/src/services/productService.ts`)

- `list()` method: default filter `type: 'menu'` when no explicit type is passed
- Accept `type` param to override (e.g., inventory endpoints pass `type: 'inventory'`)

### 1.4 Backend Controllers

| Controller | Change |
|------------|--------|
| `productsController.ts` (`listProducts`) | Default `type=menu` in filter; accept `?type=inventory` query param |
| `availabilityController.ts` | Already filters `availability !== false` — change to `type: 'menu'` |
| `inventoryDemandController.ts` | Change `availability: false` to `type: 'inventory'` |
| `inventoryReportService.ts` | Change `availability: false` to `type: 'inventory'` |

### 1.5 Inventory Module Backend

| File | Change |
|------|--------|
| `voice-inventory/services/InventoryService.ts` | Query `type: 'inventory'` instead of `availability: false` |
| `voice-inventory/services/InventoryValidator.ts` | Same |
| `voice-inventory/controllers/voiceInventoryController.ts` | Same |

### 1.6 Recipe Module Backend

| File | Change |
|------|--------|
| `recipes/services/recipeService.ts` | `inventoryItemId` refs stay unchanged (they reference Product by _id) |
| `recipes/services/recipeCostEngine.ts` | No change needed (reads by _id) |
| `recipes/services/recipeAiService.ts` | Update inventory item queries to use `type: 'inventory'` |
| `recipes/services/recipeResolutionService.ts` | Update inventory item queries |
| `recipes/services/profitabilityService.ts` | Update product queries |
| `recipes/services/consumptionService.ts` | Update queries |

### 1.7 Seed Scripts

| File | Change |
|------|--------|
| `scripts/seed/04-products.ts` | Add `type: 'menu'` to menu products, `type: 'inventory'` to inventory items |
| `scripts/seed/05-inventory.ts` | No change (queries by ID) |
| `scripts/seed/07-purchases.ts` | No change (queries by ID) |
| `scripts/seed/09-bills.ts` | No change (queries by ID) |
| `scripts/seed/14-wastage.ts` | No change (queries by ID) |

### 1.8 Other Backend Services

| File | Change |
|------|--------|
| `services/branchService.ts` | `availability: true` → `type: 'menu'` for branch clone |
| `services/stockMovementService.ts` | No change (works by productId ref) |
| `services/purchaseService.ts` | No change (text-based item matching) |
| `modules/reports/services/inventoryReportService.ts` | `availability: false` → `type: 'inventory'` |
| `modules/reports/services/productReportService.ts` | `availability: true` → `type: 'menu'` |
| `modules/public-store/services/publicStoreOrderService.ts` | Add `type: 'menu'` filter |
| `modules/promotions/services/promotionsService.ts` | Add `type: 'menu'` filter |

---

## Phase 2: Frontend Changes

### 2.1 API Client (`restaurant-pos/Frontend/src/api/client.ts`)

- `fetchProducts()` → add default `type=menu` param (only fetches menu items)
- Add `fetchInventoryItems()` → calls `/products?type=inventory`
- Add `fetchAllProducts()` → calls `/products` without type filter (for backward compat)

### 2.2 Types (`restaurant-pos/Frontend/src/types.ts`)

- Add `type?: 'menu' | 'inventory'` to Product interface

### 2.3 POS State (`restaurant-pos/Frontend/src/hooks/usePOSState.ts`)

- `refreshProducts()` → already calls `fetchProducts()` which will now default to `type=menu`
- Inventory items no longer mixed into `pos.products`

### 2.4 Inventory Manager (`restaurant-pos/Frontend/components/inventory/InventoryManager.tsx`)

- Replace `products.filter((p: any) => p.availability === false)` with dedicated `fetchInventoryItems()` call
- Remove `productToInventoryItem` derivation from products array
- Create items directly from inventory endpoint

### 2.5 Product Manager / Catalog (`restaurant-pos/Frontend/components/ProductManager.tsx`)

- Remove `if (!p.availability) return false` filter — products are already menu-only
- `handleToggleAvailability` stays — it toggles availability for menu items (sold out / active)

### 2.6 Billing Grid (`restaurant-pos/Frontend/components/BillingProductGrid.tsx`)

- Remove `.filter(p => p.availability)` — products are already menu-only
- Keep `.filter(p => billingCategory === ...)` and search filters

### 2.7 Recipes Pages

| File | Change |
|------|--------|
| `inventory/pages/RecipesPage.tsx` | Use `fetchInventoryItems()` for inventory items list; `fetchProducts()` for menu products |
| `inventory/pages/EasyRecipeMaker.tsx` | Same |
| `inventory/pages/RecipeEditor.tsx` | Accept inventory items from new endpoint |

### 2.8 Other Frontend

| File | Change |
|------|--------|
| `MenuAvailabilityPage.tsx` | Remove `availability !== false` filter — already menu-only |
| `DashboardWorkspace.tsx` | No change (weather widget gets product names) |
| `MarketingWorkspace.tsx` | Filter by `type: 'menu'` or just use menu products |
| `ProductCard.tsx` | Remove `availability` from memo comparison (or keep for sold-out badge) |
| `useBilling.ts` | Keep `availability` check (sold-out guard for menu items) |
| `VoiceFAB.tsx` | Change `availability: false` to `type: 'inventory'` when creating |
| `App.tsx` | `addFirstProducts` filter stays (sold-out guard) |

### 2.9 Tests

| File | Change |
|------|--------|
| `BillingRedesign.test.tsx` | Add `type: 'menu'` to mock products |
| `recipeEditorLogic.test.ts` | No change (uses inventoryItemId) |
| `recipe.test.ts` | No change (creates products directly) |
| `billingConsumption.integration.test.ts` | No change (creates products directly) |
| `e2e/seedData.ts` | Add `type: 'menu'` to seeded products |

---

## Phase 3: Verification

1. **Backend typecheck**: `cd backend && npx tsc --noEmit`
2. **Backend tests**: `cd backend && npm test`
3. **Frontend typecheck**: `cd restaurant-pos/Frontend && npx tsc --noEmit`
4. **Frontend tests**: `cd restaurant-pos/Frontend && npm test`
5. **Manual verification**: 
   - Billing shows only menu items
   - Inventory shows only inventory items
   - Recipes can still link menu items to inventory ingredients
   - Purchases still work
   - Stock movements still work

---

## Migration Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Data loss during migration | Script is idempotent + dry-run; `availability` field stays |
| Breaking existing API consumers | `type` defaults to `'menu'`; old queries without type still work |
| Frontend offline cache stale | `type` field is synced in product merge; old cache entries get `type: 'menu'` default |
| Recipes break | `inventoryItemId` refs are ObjectId → Product._id, type doesn't affect lookup |
| Customer site breaks | Add `type: 'menu'` filter to public store queries |

---

## File Count Summary

| Category | Files to modify |
|----------|----------------|
| Backend model | 1 (Product.ts) |
| Backend migration script | 1 (new) |
| Backend controllers | 4 |
| Backend services | ~12 |
| Backend seed scripts | 1 |
| Frontend API client | 1 |
| Frontend types | 1 |
| Frontend components | ~10 |
| Frontend hooks | 1 |
| Tests | ~4 |
| **Total** | **~36 files** |
