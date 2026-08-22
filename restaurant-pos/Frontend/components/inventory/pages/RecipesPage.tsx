/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * RecipesPage — Simplified Recipe Manager (frontend).
 *
 * PRIMARY PURPOSE:
 *   Show menu items and whether they have recipes.
 *   Create/edit recipes from this view.
 *
 * FLOW:
 *   Menu Items → See which items have recipes → Create Recipe if missing
 *   → Edit Recipe if exists → Done.
 *
 * LIVE COSTING:
 *   Live cost preview is computed CLIENT-side with a tiny mirror of the backend
 *   unit converter so the merchant gets instant feedback while editing. The
 *   backend (RecipeCostEngine) is authoritative — costSummary on the saved
 *   recipe and every consumption/variance report come from the server.
 *
 * The actual recipe editor lives in ./RecipeEditor.tsx (variant-aware: each
 * variant owns an independent recipe; the editor targets exactly one variant
 * at a time). Pure state transitions are unit-tested in ./recipeEditorLogic.ts.
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import {
  ChefHat, Plus, Pencil, Trash2, Search, Check, Package,
  Loader2, IndianRupee,
} from 'lucide-react';
import { usePageRefresh } from '../usePageRefresh';
import { useNotify, useInventory } from '../InventoryManager';
import {
  fetchRecipes, deleteRecipe, fetchProducts, fetchMenuConfigTemplates,
} from '../../../src/api/client';
import RecipeEditor from './RecipeEditor';
import ReceiptLoader from '../../ReceiptLoader';
import { type EditorRecipe as RecipeDoc } from './recipeEditorLogic';

// ─── Client-side money helpers ────────────────────────────────────
const money = (n: number) => Math.round(n * 100) / 100;
const fmt = (n: number) => '₹' + money(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type FilterMode = 'all' | 'has-recipe' | 'no-recipe';

export default function RecipesPage() {
  const notify = useNotify();
  const { items } = useInventory();

  const [recipes, setRecipes] = useState<RecipeDoc[] | null>(null);
  const [menuProducts, setMenuProducts] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterMode>('all');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [synced, setSynced] = useState(false);

  // Editor state
  const [editing, setEditing] = useState<RecipeDoc | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  // Create recipe for a specific product
  const [creatingFor, setCreatingFor] = useState<any>(null);

  // Delete confirmation
  const [pendingDelete, setPendingDelete] = useState<RecipeDoc | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadRecipes = useCallback(async () => {
    const data = await fetchRecipes();
    setRecipes(data || []);
    setSynced(data !== null);
  }, []);

  const loadMenuProducts = useCallback(async () => {
    // fetchProducts() defaults to type=menu, so results are already menu-only.
    const data = await fetchProducts();
    if (Array.isArray(data)) {
      setMenuProducts(data.filter((p: any) => !p.isDeleted));
    }
  }, []);

  useEffect(() => { void loadRecipes(); }, [loadRecipes]);
  useEffect(() => { void loadMenuProducts(); }, [loadMenuProducts]);
  // Header refresh button re-fetches recipes + the menu catalog.
  usePageRefresh(useCallback(() => { void loadRecipes(); void loadMenuProducts(); }, [loadRecipes, loadMenuProducts]));

  // ── Variant templates (menuConfig) — resolve variant names from template refs ──
  const [variantTemplates, setVariantTemplates] = useState<any[]>([]);
  useEffect(() => {
    let alive = true;
    void fetchMenuConfigTemplates({ type: 'VARIANT_GROUP', status: 'active', limit: 200 }).then((res) => {
      if (alive && Array.isArray(res?.items)) setVariantTemplates(res.items);
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const templateVariantMap = useMemo(() => {
    const map = new Map<string, Array<{ name: string; priceDelta: number }>>();
    for (const t of variantTemplates) {
      map.set(String(t._id), (t.data?.options || []).filter((o: any) => o.active !== false).map((o: any) => ({ name: o.name, priceDelta: Number(o.priceDelta) || 0 })));
    }
    return map;
  }, [variantTemplates]);

  const handleDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    const res = await deleteRecipe(pendingDelete._id);
    setDeleting(false);
    if (res) {
      notify(`Recipe deleted`, 'success');
      setPendingDelete(null);
      void loadRecipes();
    } else {
      notify('Delete failed — archive it first', 'warning');
      setPendingDelete(null);
    }
  };

  // ── Build menu item cards ──────────────────────────────────────
  // Join products with their recipes to create the card list.
  const recipeMap = useMemo(() => {
    const map: Record<string, RecipeDoc[]> = {};
    for (const r of recipes || []) {
      if (r.isDeleted) continue;
      if (!map[r.productId]) map[r.productId] = [];
      map[r.productId].push(r);
    }
    return map;
  }, [recipes]);

  // Unique categories from products
  const categories = useMemo(() => {
    const cats = new Set<string>();
    for (const p of menuProducts) {
      if (p.category) cats.add(p.category);
    }
    return [...cats].sort();
  }, [menuProducts]);

  // Build the card list — per-variant recipe status (active, draft, missing).
  // There is no base recipe: every recipe belongs to a variant, and products
  // without variants expose the virtual 'Default' variant. Variant names come
  // from three sources (unioned, deduped): ProductVariant rows, the resolved
  // menuConfig variant templates, and the variant names observed on the
  // product's own recipes. 'Default' is only used when the product has no
  // real variants at all.
  const cards = useMemo(() => {
    return menuProducts.map((product) => {
      const productRecipes = (recipeMap[product._id] || []).filter((r) => !r.isDeleted && r.status !== 'archived');
      const hasRecipe = productRecipes.length > 0;

      const variantEntries: Array<{ name: string; price?: number }> = [];
      const seen = new Set<string>();
      const pushVariant = (name: string, price?: number) => {
        const n = String(name || '').trim();
        if (!n || seen.has(n)) return;
        seen.add(n);
        variantEntries.push({ name: n, price });
      };

      for (const v of product.variants || []) if (v?.name) pushVariant(v.name, Number(v.price) || 0);
      const menuConfig = product.menuConfig as any;
      for (const ref of menuConfig?.variantConfigurations || []) {
        const opts = templateVariantMap.get(String(ref.templateId)) || [];
        for (const o of opts) pushVariant(o.name, (Number(product.price) || 0) + o.priceDelta);
      }
      for (const r of productRecipes) {
        const n = String(r.variantName || '').trim();
        if (n && n !== 'Default') pushVariant(n);
      }

      const variantList = variantEntries.length > 0 ? variantEntries : [{ name: 'Default', price: Number(product.price) || 0 }];
      const variantStatus = variantList.map((v) => {
        const variantRecipe = productRecipes.find((r) => (r.variantName || 'Default') === v.name);
        const status = variantRecipe
          ? (variantRecipe.status === 'active' ? 'active' : 'draft')
          : 'missing';
        return {
          name: v.name,
          price: v.price ?? Number(product.price) ?? 0,
          hasRecipe: status !== 'missing',
          status,
          inheritsBase: false,
          gap: status === 'missing',
          recipe: variantRecipe || null,
        };
      });

      // Configuration template info (modifiers/add-ons)
      const modifierGroups = (menuConfig?.modifierConfigurations || []) as Array<{ templateId: string }>;
      const addOnGroups = (menuConfig?.addOnConfigurations || []) as Array<{ templateId: string }>;
      const hasModifiers = modifierGroups.length > 0;
      const hasAddOns = addOnGroups.length > 0;

      const hasRealVariants = variantList.length > 0 && !(variantList.length === 1 && variantList[0].name === 'Default');

      return {
        product,
        recipe: productRecipes[0] || null,
        hasRecipe,
        recipeCount: productRecipes.length,
        ingredientCount: productRecipes[0]?.components?.length || 0,
        variantStatus,
        hasVariants: hasRealVariants,
        hasModifiers,
        hasAddOns,
        allVariantsCovered: variantStatus.every((v) => v.hasRecipe),
        variantsGapCount: variantStatus.filter((v) => v.gap).length,
      };
    });
  }, [menuProducts, recipeMap, templateVariantMap]);

  // Filter and search
  const filteredCards = useMemo(() => {
    let result = cards;

    // Filter by recipe status
    if (filter === 'has-recipe') result = result.filter((c) => c.hasRecipe);
    if (filter === 'no-recipe') result = result.filter((c) => !c.hasRecipe);

    // Filter by category
    if (categoryFilter) result = result.filter((c) => c.product.category === categoryFilter);

    // Search
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((c) =>
        c.product.name.toLowerCase().includes(q) ||
        (c.product.category || '').toLowerCase().includes(q)
      );
    }

    return result;
  }, [cards, filter, categoryFilter, search]);

  // Stats
  const stats = useMemo(() => {
    const total = menuProducts.length;
    const withRecipe = cards.filter((c) => c.hasRecipe).length;
    const withoutRecipe = total - withRecipe;
    return { total, withRecipe, withoutRecipe };
  }, [menuProducts, cards]);

  const handleCreateRecipe = (product: any) => {
    setCreatingFor(product);
    setShowEditor(true);
  };

  const handleEditRecipe = (recipe: RecipeDoc) => {
    setEditing(recipe);
    setShowEditor(true);
  };

  return (
    <div className="p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold tracking-tight flex items-center gap-2">
            <ChefHat className="w-5 h-5 text-[var(--brand-color)]" /> Recipes
          </h2>
          <p className="text-xs text-gray-400 mt-0.5">
            See which menu items have recipes. Create or edit recipes from here.
          </p>
        </div>
      </div>

      {/* Stats summary */}
      <div className="flex items-center gap-2">
        <span className="px-3 py-1.5 rounded-full border border-[var(--color-border-default)] bg-[var(--color-bg-white)] text-[10px] font-bold text-gray-600">
          {stats.total} menu {stats.total === 1 ? 'item' : 'items'}
        </span>
        <span className="px-3 py-1.5 rounded-full border border-emerald-200 bg-emerald-50 text-[10px] font-bold text-emerald-700">
          ✓ {stats.withRecipe} {stats.withRecipe === 1 ? 'recipe' : 'recipes'} added
        </span>
        {stats.withoutRecipe > 0 && (
          <span className="px-3 py-1.5 rounded-full border border-amber-200 bg-amber-50 text-[10px] font-bold text-amber-700">
            ○ {stats.withoutRecipe} remaining
          </span>
        )}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search menu items…"
            className="w-full pl-9 pr-3 py-2 bg-[var(--color-bg-white)] border border-[var(--color-border-default)] rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]/20"
          />
        </div>

        {/* Recipe status filter */}
        <div className="flex rounded-xl overflow-hidden border border-[var(--color-border-default)]">
          {([
            { id: 'all', label: 'All' },
            { id: 'has-recipe', label: '✓ Recipe Added' },
            { id: 'no-recipe', label: '○ No Recipe' },
          ] as { id: FilterMode; label: string }[]).map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`px-3 py-2 text-[10px] font-bold transition-all cursor-pointer ${
                filter === f.id
                  ? 'bg-[var(--brand-color)] text-white'
                  : 'bg-[var(--color-bg-white)] text-gray-500 hover:bg-gray-50'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Category filter */}
        {categories.length > 1 && (
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="px-3 py-2 bg-[var(--color-bg-white)] border border-[var(--color-border-default)] rounded-xl text-xs font-semibold text-gray-600 focus:outline-none cursor-pointer"
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        )}
      </div>

      {/* Menu item cards grid */}
      {!synced && recipes === null ? (
        <div className="py-12 flex flex-col items-center">
          <ReceiptLoader label="Loading recipes…" />
        </div>
      ) : filteredCards.length === 0 ? (
        <div className="p-10 text-center">
          <Package className="w-10 h-10 text-gray-500 mx-auto mb-2" />
          {menuProducts.length === 0 ? (
            <>
              <p className="text-sm font-semibold text-gray-500">No menu items yet</p>
              <p className="text-xs text-gray-400 mt-1">Add menu items from your Menu/Product section first.</p>
            </>
          ) : (
            <>
              <p className="text-sm font-semibold text-gray-500">No items match your search</p>
              <p className="text-xs text-gray-400 mt-1">Try a different search term or filter.</p>
            </>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {filteredCards.map(({ product, recipe, hasRecipe, ingredientCount, variantStatus, hasVariants, hasModifiers, hasAddOns, variantsGapCount }) => (
            <div
              key={product._id}
              className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] overflow-hidden hover:shadow-md transition-all flex flex-col"
            >
              {/* Image */}
              <div className="h-28 bg-gray-100 flex items-center justify-center overflow-hidden">
                {product.image ? (
                  <img src={product.image} alt={product.name} className="w-full h-full object-cover" />
                ) : (
                  <span className="text-4xl font-black text-gray-300">{String(product.name).charAt(0).toUpperCase()}</span>
                )}
              </div>

              {/* Content */}
              <div className="p-3.5 flex-1 flex flex-col gap-2.5">
                {/* Name + category */}
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-bold text-gray-900 truncate leading-snug min-w-0">{product.name}</h3>
                  {product.category && (
                    <span className="text-[9px] font-bold bg-[var(--color-primary-light)] text-[var(--brand-color)] px-2 py-0.5 rounded-full uppercase shrink-0">
                      {product.category}
                    </span>
                  )}
                </div>

                {/* Recipe status + ingredient count */}
                <div className="flex items-center gap-2">
                  {hasRecipe ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                      <Check className="w-3 h-3" /> Recipe Added
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-100 text-gray-500 border border-gray-200">
                      <ChefHat className="w-3 h-3" /> No Recipe
                    </span>
                  )}
                  {ingredientCount > 0 && (
                    <span className="text-[10px] text-gray-400">
                      {ingredientCount} ingredient{ingredientCount === 1 ? '' : 's'}
                    </span>
                  )}
                </div>

                {/* Variant recipe status */}
                {hasVariants && variantStatus.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-[9px] font-bold uppercase tracking-wider text-gray-400">Variants</p>
                    <div className="flex flex-wrap gap-1">
                      {variantStatus.map((v) => (
                        <span
                          key={v.name}
                          className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-semibold border ${
                            v.status === 'active'
                              ? 'bg-emerald-50 text-emerald-600 border-emerald-200'
                              : v.status === 'draft'
                                ? 'bg-amber-50 text-amber-600 border-amber-200'
                                : 'bg-gray-100 text-gray-500 border-gray-200'
                          }`}
                        >
                          {v.status === 'active' ? '✓' : v.status === 'draft' ? '○' : '⚠'} {v.name}
                          {v.price > 0 && <span className="opacity-70 font-mono">{fmt(v.price)}</span>}
                        </span>
                      ))}
                    </div>
                    {variantsGapCount > 0 && (
                      <p className="text-[9px] text-amber-600 font-medium">
                        ⚠ {variantsGapCount} variant{variantsGapCount === 1 ? '' : 's'} without any recipe — inventory won't reduce for those
                      </p>
                    )}
                  </div>
                )}

                {/* Modifier/Add-on indicators */}
                {(hasModifiers || hasAddOns) && (
                  <div className="flex flex-wrap gap-1">
                    {hasModifiers && (
                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-semibold bg-blue-50 text-blue-600 border border-blue-200">
                        ✏ Modifiers
                      </span>
                    )}
                    {hasAddOns && (
                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-semibold bg-purple-50 text-purple-600 border border-purple-200">
                        + Add-ons
                      </span>
                    )}
                  </div>
                )}

                {/* Cost summary (if recipe exists) */}
                {recipe?.costSummary && recipe.costSummary.recipeCost > 0 && (
                  <div className="text-[10px] text-gray-500 flex items-center gap-1">
                    <IndianRupee className="w-3 h-3" />
                    Cost: {fmt(recipe.costSummary.estimatedVariableCost ?? recipe.costSummary.recipeCost)}
                    {recipe.costSummary.contribution > 0 && (
                      <span className="text-emerald-600 font-semibold ml-1">
                        · {fmt(recipe.costSummary.contribution)} margin
                      </span>
                    )}
                  </div>
                )}

                {/* Action buttons */}
                <div className="flex items-center gap-1.5 pt-1 mt-auto">
                  {hasRecipe ? (
                    <button
                      onClick={() => handleEditRecipe(recipe!)}
                      className="flex-1 px-3 py-2 bg-[var(--brand-color)] text-white rounded-xl text-[10px] font-bold hover:bg-[var(--color-primary-hover)] transition-all cursor-pointer flex items-center justify-center gap-1"
                    >
                      <Pencil className="w-3 h-3" /> Edit Recipe
                    </button>
                  ) : (
                    <button
                      onClick={() => handleCreateRecipe(product)}
                      className="flex-1 px-3 py-2 bg-[var(--brand-color)] text-white rounded-xl text-[10px] font-bold hover:bg-[var(--color-primary-hover)] transition-all cursor-pointer flex items-center justify-center gap-1"
                    >
                      <Plus className="w-3 h-3" /> Create Recipe
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Recipe Editor modal */}
      {showEditor && (
        <RecipeEditor
          existing={editing}
          initialProduct={creatingFor}
          inventoryItems={items}
          menuProducts={menuProducts}
          recipes={recipes || []}
          onClose={() => { setShowEditor(false); setEditing(null); setCreatingFor(null); }}
          onSaved={() => { setShowEditor(false); setEditing(null); setCreatingFor(null); void loadRecipes(); }}
          onDelete={(r) => { setPendingDelete(r); }}
          notify={notify}
        />
      )}

      {/* Delete confirmation */}
      {pendingDelete && (
        <div className="fixed inset-0 z-[200] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => { if (!deleting) setPendingDelete(null); }}>
          <div className="bg-[var(--color-bg-white)] rounded-3xl shadow-2xl max-w-sm w-full overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 text-center">
              <div className="w-12 h-12 rounded-2xl bg-red-50 flex items-center justify-center mx-auto mb-3">
                <Trash2 className="w-5 h-5 text-red-500" />
              </div>
              <h3 className="text-base font-bold text-gray-900">Delete recipe?</h3>
              <p className="text-xs text-gray-400 mt-1.5 leading-relaxed">
                This will remove the recipe for <strong>{pendingDelete.productName}</strong>. Menu items and inventory are not affected.
              </p>
              <div className="flex gap-2 mt-5">
                <button
                  onClick={() => setPendingDelete(null)}
                  disabled={deleting}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-[var(--color-border-default)] text-gray-600 text-xs font-bold hover:bg-gray-50 transition-all cursor-pointer disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void handleDelete()}
                  disabled={deleting}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-[var(--color-red-500-solid)] text-white text-xs font-bold hover:bg-[var(--color-red-600-solid)] transition-all cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
