# Remove Base Recipes — Variant-Only Recipe Architecture

## Goal

Eliminate the "base recipe" concept entirely. **Every recipe belongs to exactly one variant** — there is no base recipe, no "inherits base", no fallback. Variant identity is `restaurantId + productId + variantName` and `variantName` is always non-empty.

Confirmed decisions:
- **Non-variant products** get a virtual **'Default'** variant (name `'Default'`, price = product price). Their recipe is stored with `variantName: 'Default'`.
- **Existing base recipes** are migrated by **copying their ingredients onto every variant lacking its own recipe** (preserving the base's status: active→active, draft→draft, so consumption is not interrupted), then the base recipe is **archived**.

Prior work (already implemented, do NOT undo): variant isolation (identity immutability on update), variant→variant copy with deep clone, variant-priced cost engine, the redesigned variant-aware `RecipeEditor` + `recipeEditorLogic.ts`, and the `activeRecipeKeys` billing guard.

---

## 1. Backend changes

### 1.1 `recipeResolutionService.getVariantsForProduct` (backend/src/modules/recipes/services/recipeResolutionService.ts)
- After merging ProductVariant rows + observed recipe `variantName`s, if the result is **empty** → return `['Default']` (virtual default so editor/resolution always have a variant to target).

### 1.2 `resolveEffectiveRecipe` — variant-only, no inheritance
- Compute target variant: `v = (variantName || '').trim()`; when empty → if the product **has variants** (ProductVariant/menuConfig) resolve `{ mode: 'none' }` with HIGH warning `variant_required`; else set `v = 'Default'`.
- Backward-compat safety (works even before migration runs): resolve `recipes.find(r => (r.variantName || '') === v || (v === 'Default' && !r.variantName))`.
- Found active recipe → `mode: 'exact'`. Not found → `mode: 'none'` with HIGH `variant_no_recipe`.
- Remove ALL base/inherit branches and the `inherit` warning paths. Keep `ResolutionMode` type (`'exact' | 'inherit' | 'none'`) for API compat but never emit `'inherit'`.

### 1.3 `recipeService.create` — require a variant
- Reject recipes without a variantName (400: "A recipe must belong to a variant — create recipes per variant.").
- Always set `recipeMode: 'override'`, `sourceRecipeId: null`.
- Remove the auto-base creation block, the "inherit base's components" branch, and the `sourceRecipeId` linking branch.

### 1.4 `recipeService.update`
- Keep identity immutability (variantName / productId / recipeMode can't change).
- Remove the `sourceRecipeId` setter (always null). No other changes.

### 1.5 `recipeResolutionService.copyVariantRecipe`
- Remove the base-source exception and the auto-base creation block.
- Target variant validated via `getVariantsForProduct` (now includes 'Default' for variant-less products).
- `sourceRecipeId: null` on created/replaced targets. Draft-replace / active-draft-alongside semantics unchanged.

### 1.6 `consumptionService.activeRecipeKeys`
- Add `productId::<variantName>` for each active recipe (already done).
- Additionally add `productId::` (plain-sale key) **only for products that have NO variants** (no ProductVariant rows, no menuConfig variants) but DO have an active recipe (the 'Default'/legacy recipe). Keep the valid-ObjectId filter.

### 1.7 `listProductRecipeStatus`
- Remove the `base` object, `productsMissingBase`, and `inheritVariants` fields.
- Emit a `'Default'` variant row for products with no variants.
- Variant statuses: `configured` / `draft` / `missing` only. Update summary accordingly.

### 1.8 `sweep`
- Remove base problems (`base_with_explicit_variant_name`, `overrides_without_base`).
- Flag leftover recipes with empty variantName as `recipe_without_variant` (legacy leftovers).

### 1.9 Validators `validators/recipe.ts`
- `variantName`: required (`z.string().min(1).max(100)`).
- `recipeMode`: only `'override'` (or drop from schema and default to `'override'`).
- Remove `variantModeRules` and the base/override consistency checks.

### 1.10 Migration script — NEW `backend/scripts/migrate-remove-base-recipes.ts`
- For every recipe with `variantName` null/empty:
  - Product **has no variants** → rename recipe: `variantName='Default'`, `recipeMode='override'`, `sourceRecipeId=null`, `name='<Product> (Default) Recipe'`.
  - Product **has variants** → for each variant without its own recipe, create an override from the base's components with the base's status (active→active, draft→draft, `componentSource:'copy'`); then archive the base (`status='archived'`, `effectiveTo=today`). Variants that already have a recipe are untouched.
- `--dry` flag prints a plan without writing. Log counts. Run once: `npx tsx scripts/migrate-remove-base-recipes.ts`.

---

## 2. Frontend changes

### 2.1 `recipeEditorLogic.ts`
- `deriveVariantStatus(recipe)`: statuses `active | draft | missing` (drop the `baseActive` param and `'inherit'`).
- `payloadFrom`: `recipeMode: 'override'` always; `variantName` always set (never undefined); add `export const DEFAULT_VARIANT = 'Default'`.
- `targetRecipeFor`, `cloneComponents`: unchanged.

### 2.2 `RecipeEditor.tsx`
- Remove the Base row: `panelVariants` shows only variants; products without variants show a single `'Default'` chip (price = product price).
- `selectedVariant` default: editing → `existing.variantName`; creating → lowest-cost variant, else `'Default'`. Never `''`.
- Remove `handleResetToBase` and its row; remove all `baseRecipe`/`baseActive` lookups and `'inherit'` wording in hints.
- Copy popover: sources are other variants with recipes (unchanged).

### 2.3 `RecipesPage.tsx`
- Cards: drop base status logic; variant chips show active/draft/missing. For variant-less products show a single `Default` chip; `hasRecipe` = any non-archived recipe.
- Remove 'inherits base' / 'some variants use the base recipe' copy.

### 2.4 `EasyRecipeMaker.tsx`
- Save uses `variantName: selectedVariant || 'Default'` (never creates a base).
- PickDish: products without variants show/auto-select a single `'Default'` option.

### 2.5 `client.ts`
- No change required (`resetRecipeToBase` stays for API compat; editor stops calling it).

---

## 3. Tests

### 3.1 Update `variantRecipes.test.ts`
- Base-creation tests → create requires variantName (base create rejected 400); override auto-base/inherit tests → variant-only behavior.
- Reset-to-base test → removed/replaced (deleting a variant recipe → variant `none`).
- Copy tests: drop base-source expectations; copy within variants only.
- Sweep tests: drop base kinds.

### 3.2 Update `variantIsolation.test.ts`
- Replace `baseFor` helper with variant recipes (`'Default'` for variant-less products).
- Inherit assertions → `missing`; delete test → Half deleted ⇒ Half `none`, Full `exact`.
- Plain-sale consumption → resolves `'Default'`.
- Costing: Half/Full variant pricing kept; add Default (falls back to product price).

### 3.3 Update `billingConsumption.integration.test.ts`
- Plain-sale tests (TEST 2, plain lines) resolve the `'Default'` variant recipe.

### 3.4 New tests
- **Migration test** (add to isolation suite or new file): legacy base + variant product → migration copies to each variant (active preserved), base archived; variant-less base → renamed `'Default'`.
- Variant-less product: `resolveEffectiveRecipe('', → 'Default')` + billing consumption via `productId::` key.
- Plain sale of a variant product with no variantName → `none` (no consumption).

### 3.5 Frontend test updates — `recipeEditorLogic.test.ts`
- `deriveVariantStatus`: active/draft/missing (drop inherit cases).
- `payloadFrom`: variantName always set, mode always `'override'`.

---

## 4. Validation

1. Backend: `npm test -- --run src/modules/recipes/__tests__/` green; `npm run typecheck` clean for recipes files.
2. Frontend: `npx tsc --noEmit` clean; `npm test -- --pool=threads components/inventory/pages/__tests__/recipeEditorLogic.test.ts` green; `npm run build` succeeds.
3. Run migration `--dry` then live on a seeded dataset; verify zero recipes remain with empty `variantName`.
4. Manual: Kadhai Paneer Half/Full each have independent recipes (no Base row); Plain Fries shows `Default`; bills for Half/Full consume their own recipes; a plain Fries bill consumes the `Default` recipe; a variant-product plain-sale line consumes nothing (POS always sets a variant).

## 5. Risks / edge cases
- **Migration ordering**: `resolveEffectiveRecipe` and `activeRecipeKeys` are backward-compatible (legacy base still resolves as 'Default' for variant-less products), so billing stays correct even before the script runs.
- **Behavior change**: a variant without its own recipe now consumes NOTHING (previously inherited base). This is the intended change; surfaced as HIGH `variant_no_recipe` in status and amber "No recipe" in the editor.
- A product with a real variant literally named `'Default'` — that variant IS the default; no special handling.
- `recipeMode`/`sourceRecipeId` fields remain in the schema (data compat) but are always `'override'`/`null` for new data.
