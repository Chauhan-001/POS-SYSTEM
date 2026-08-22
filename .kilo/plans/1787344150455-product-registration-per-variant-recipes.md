# Product Registration Wizard — Per-Variant Recipe Entry

## Goal

When a product is registered in the **Product & Catalog module** (`ProductRegistrationWizard`), the Recipe step must configure a recipe for **every variant** configured in the previous step — not just the first one. Keep the current page and its capabilities intact (Skip / Add ingredients / Describe with voice + mic / Easy Mode), and keep the Recipe Manager consistent (already per-variant from the prior work).

Today: the wizard's Recipe step is a single shared editor, and registration only creates a recipe for `variantGroup?.options?.[0]?.name || 'Default'` (`ProductRegistrationWizard.tsx:738-741`). If Half + Full were configured, only Half gets a recipe.

Confirmed direction: per-variant recipe entry in the existing step — no page redesign, no removal of skip/voice/mic.

## 1. State changes (`restaurant-pos/Frontend/components/menu/ProductRegistrationWizard.tsx`)

Replace the single `recipeMode` / `voiceRows` / `manualRows` state (lines ~438-452) with per-variant maps:

- `recipeVariant: string` — currently selected variant for the recipe step (default `'Default'`).
- `rowsByVariant: Record<string, RecipeRow[]>` — confirmed ingredients per variant (replaces `voiceRows` + `manualRows`).
- `modeByVariant: Record<string, 'skip' | 'manual' | 'voice'>` — input mode per variant.
- Keep `recipeText`, `recipeSearch`, `recipeResults`, `recipeLoading`, `recipeError`, `recording`, `transcribing`, recorder refs as-is (transient input, shared).

Derived:
- `recipeVariants = variantGroup?.options?.map(o => o.name).filter(Boolean)`; empty → `['Default']`.
- `rows = rowsByVariant[recipeVariant] || []`; `recipeMode = modeByVariant[recipeVariant] || 'skip'`.
- `recipeCost` — from `rows` (current variant).
- `recipeVariantPrice` — the selected variant's option price (fallback: existing `referencePrice`). Use it for the recipe-step margin display.
- Effect: on entering Step 4 (`step === 3`), if `recipeVariants.length > 1` and current `recipeVariant` isn't in the list, select `recipeVariants[0]`.

## 2. Handler updates (scope to the current variant)

- `addManualRow(item)` → append to `rowsByVariant[recipeVariant]` (same row shape).
- `setRowQty(key, qty)` → map over `rowsByVariant[recipeVariant]`.
- Row delete / Clear → filter/clear `rowsByVariant[recipeVariant]`; Clear also sets `modeByVariant[recipeVariant] = 'skip'`.
- `runVoiceExtract(text)` → `setRowsByVariant[recipeVariant] = [...matched, ...attention]` and set mode `'voice'` for that variant. Voice/mic flow unchanged (`recordMedia`, `startListening`, `stopMic` untouched).
- New helper `copyRecipeToOtherVariants()`: deep-clone the current variant's rows (fresh `key`s via a small clone helper) into every other variant and set their mode to the current mode — "Copy to all" convenience, never automatic.

## 3. Registration (`handleRegister`, lines ~723-747)

Replace the single-recipe block with a loop over `recipeVariants`:

```
for each variantName in recipeVariants:
  rows = rowsByVariant[variantName] || []
  components = rows.filter(r => r.inventoryItemId).map(...)   // same mapping as today
  if components.length > 0:
    await api.createRecipe({ productId, variantName, name: pName.trim(), components, status: 'draft' })
```

Variants with no ingredients get **no recipe** (they show "No recipe" in the Recipe Manager — per-variant model). `sourceRecipeId` is never set.

## 4. UI — Step 4 Recipe (lines ~1477-1640)

Keep the existing layout and mode cards. Add, above the mode cards, when `recipeVariants.length > 1`:

- A **variant chip row** ("Recipe for:") with one chip per variant. Each chip shows the variant name + price and a status dot: `✓` when that variant has rows, `○` when skipped. The selected chip is highlighted (same styling as the Recipe Editor's variant chips). Clicking a chip calls `setRecipeVariant(name)`.
- A **"Copy to all"** button (small, right-aligned) that runs `copyRecipeToOtherVariants()`.
- The recipe ingredients panel header can show `Recipe for: <SELECTED VARIANT>`.

Everything below (manual search, voice/describe, ingredient rows, qty edit, cost, margin) operates on `rows`/`recipeMode` for the selected variant — no other JSX changes.

## 5. Review step (lines ~1718-1732)

Replace the single recipe summary with a per-variant summary:

```
Recipe
  Half   — 2 ingredients · ₹42 · margin 65%
  Full   — 3 ingredients · ₹95 · margin 47%
  (or "No recipe yet — can be added later from Inventory." when no variant has rows)
```

## 6. Validation

- `cd restaurant-pos/Frontend && npx tsc --noEmit` — clean.
- `npm test -- --pool=threads components/inventory/pages/__tests__/recipeEditorLogic.test.ts` — still green.
- `npm run build` — succeeds.
- Manual: register a product with Half ₹120 / Full ₹179.98; Step 4 shows two chips; set Half = paneer 150g, Full = paneer 250g; Register → both recipes created (verify in Recipe Manager: both variants Active/Draft, independent). Use "Copy to all" then edit Full → Half unchanged after save. Register a variant-less product → single Default recipe (unchanged behavior). Skip still registers with no recipe.

## 7. Out of scope

- No backend changes (the variant-only model already supports per-variant recipes; `createRecipe` requires a `variantName`).
- Easy Mode (`EasyRecipeMaker`) is unchanged (already Default-aware from the prior work).
- No changes to the Recipe Editor / Recipe Manager UI.
