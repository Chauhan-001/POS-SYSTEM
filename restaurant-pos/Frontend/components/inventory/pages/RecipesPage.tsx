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
 */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  ChefHat, Plus, Pencil, Trash2, Search, X, Check, AlertTriangle, Package,
  Loader2, IndianRupee, Mic, Sparkles, ChevronDown,
} from 'lucide-react';
import { useNotify, useInventory } from '../InventoryManager';
import {
  fetchRecipes, createRecipe, updateRecipe,
  activateRecipe, deleteRecipe, fetchProducts, fetchCostSettings,
  recipeAiQuickCreate, recipeAiSearchInventory, createProduct,
} from '../../../src/api/client';
import EasyRecipeMaker from './EasyRecipeMaker';
import RecipeInputStep, { type RecipeRow, type RecipeMode } from '../../menu/RecipeInputStep';

// ─── Client-side unit mirror (kg↔g↔mg, L↔ml, pcs) ────────────────
const UNIT_FAMILY: Record<string, { family: string; factor: number }> = {
  kg: { family: 'mass', factor: 1000 }, g: { family: 'mass', factor: 1 },
  gram: { family: 'mass', factor: 1 }, grams: { family: 'mass', factor: 1 },
  gm: { family: 'mass', factor: 1 }, mg: { family: 'mass', factor: 0.001 },
  l: { family: 'volume', factor: 1000 }, litre: { family: 'volume', factor: 1000 },
  liters: { family: 'volume', factor: 1000 }, ml: { family: 'volume', factor: 1 },
  pcs: { family: 'count', factor: 1 }, pc: { family: 'count', factor: 1 },
  piece: { family: 'count', factor: 1 }, pieces: { family: 'count', factor: 1 },
  nos: { family: 'count', factor: 1 }, no: { family: 'count', factor: 1 },
  unit: { family: 'count', factor: 1 }, units: { family: 'count', factor: 1 },
  plate: { family: 'count', factor: 1 }, plates: { family: 'count', factor: 1 },
  portion: { family: 'count', factor: 1 }, portions: { family: 'count', factor: 1 },
  serving: { family: 'count', factor: 1 }, servings: { family: 'count', factor: 1 },
};
const YIELD_UNITS = ['plate', 'portion', 'serving', 'pcs', 'kg', 'g', 'L', 'ml', 'unit'];
const MASS_UNITS = ['kg', 'g', 'mg'];
const VOLUME_UNITS = ['L', 'ml'];
const COUNT_UNITS = ['pcs', 'pc', 'piece', 'unit', 'nos'];
const ALL_UNITS = [...new Set([...YIELD_UNITS, ...MASS_UNITS, ...VOLUME_UNITS, ...COUNT_UNITS])];
function unitOptionsFor(unit?: string): string[] {
  const fam = UNIT_FAMILY[normUnit(unit)]?.family;
  const base = fam === 'mass' ? MASS_UNITS : fam === 'volume' ? VOLUME_UNITS : COUNT_UNITS;
  const list = [...base];
  if (unit && !list.includes(unit)) list.unshift(unit);
  return list;
}
const normUnit = (u?: string) => (u || '').trim().toLowerCase();
const conv = (qty: number, from: string, to: string): number => {
  const a = UNIT_FAMILY[normUnit(from)];
  const b = UNIT_FAMILY[normUnit(to)];
  if (!a || !b || a.family !== b.family) return 0;
  return Math.round((qty * a.factor) / b.factor * 10000) / 10000;
};
const money = (n: number) => Math.round(n * 100) / 100;
const fmt = (n: number) => '₹' + money(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface ComponentRow {
  key: string;
  inventoryItemId?: string;
  itemName: string;
  quantity: number;
  unit: string;
  componentType: 'ingredient' | 'sub_recipe';
  subRecipeId?: string;
  wastagePercent: number;
  optional: boolean;
  itemUnit?: string;
  averageCost?: number;
  custom?: boolean;
  customCost?: number;
}

interface RecipeDoc {
  _id: string;
  productId: string;
  productName: string;
  variantName?: string;
  name: string;
  status: 'draft' | 'active' | 'archived';
  version: number;
  yieldQuantity: number;
  yieldUnit: string;
  servingSize?: number;
  components: any[];
  costSummary?: {
    recipeCost: number; foodCostPercent: number; contribution: number;
    contributionMarginPercent: number; perServingCost: number;
    estimatedVariableCost?: number; conservativeCost?: number;
    directIngredients?: number; minorAllowance?: number; cookingAllowance?: number;
    wastageAllowance?: number; packagingCost?: number;
  };
  isDeleted?: boolean;
  createdAt: string;
  updatedAt: string;
}

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
  // Easy Mode wizard
  const [showEasy, setShowEasy] = useState(false);
  const [easyProduct, setEasyProduct] = useState<any>(null);

  // Delete confirmation
  const [pendingDelete, setPendingDelete] = useState<RecipeDoc | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadRecipes = useCallback(async () => {
    const data = await fetchRecipes();
    setRecipes(data || []);
    setSynced(data !== null);
  }, []);

  const loadMenuProducts = useCallback(async () => {
    const data = await fetchProducts();
    if (Array.isArray(data)) {
      setMenuProducts(data.filter((p: any) => p.availability !== false && !p.isDeleted));
    }
  }, []);

  useEffect(() => { void loadRecipes(); }, [loadRecipes]);
  useEffect(() => { void loadMenuProducts(); }, [loadMenuProducts]);

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

  // Build the card list — includes variant recipe status
  const cards = useMemo(() => {
    return menuProducts.map((product) => {
      const productRecipes = (recipeMap[product._id] || []).filter((r) => !r.isDeleted);
      const activeRecipe = productRecipes.find((r) => r.status === 'active' && !r.variantName);
      const hasRecipe = productRecipes.length > 0;
      
      // Variant recipe status — check each variant defined on the product
      const variants = (product.variants || []) as Array<{ name: string; price?: number }>;
      const variantStatus = variants.map((v) => {
        const variantRecipe = productRecipes.find((r) => r.variantName === v.name && r.status === 'active');
        return {
          name: v.name,
          price: v.price,
          hasRecipe: !!variantRecipe,
          recipe: variantRecipe || null,
        };
      });
      
      // Configuration template info (modifiers/add-ons)
      const menuConfig = product.menuConfig as any;
      const modifierGroups = (menuConfig?.modifierConfigurations || []) as Array<{ templateId: string }>;
      const addOnGroups = (menuConfig?.addOnConfigurations || []) as Array<{ templateId: string }>;
      const hasModifiers = modifierGroups.length > 0;
      const hasAddOns = addOnGroups.length > 0;
      
      return {
        product,
        recipe: activeRecipe || productRecipes[0] || null,
        hasRecipe,
        recipeCount: productRecipes.length,
        ingredientCount: activeRecipe?.components?.length || productRecipes[0]?.components?.length || 0,
        variantStatus,
        hasVariants: variants.length > 0,
        hasModifiers,
        hasAddOns,
        allVariantsHaveRecipes: variants.length > 0 && variantStatus.every((v) => v.hasRecipe),
      };
    });
  }, [menuProducts, recipeMap]);

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

  const handleEasyMode = (product?: any) => {
    setEasyProduct(product || null);
    setShowEasy(true);
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
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleEasyMode()}
            className="px-4 py-2.5 bg-gradient-to-br from-amber-400 to-orange-500 text-white rounded-xl text-xs font-black hover:brightness-105 transition-all flex items-center gap-1.5 shadow-md cursor-pointer"
          >
            <Sparkles className="w-4 h-4" /> Easy Mode
          </button>
        </div>
      </div>

      {/* Stats summary */}
      <div className="flex items-center gap-4 text-xs">
        <span className="font-semibold text-gray-700">
          {stats.total} menu {stats.total === 1 ? 'item' : 'items'}
        </span>
        <span className="text-emerald-600 font-semibold">
          {stats.withRecipe} {stats.withRecipe === 1 ? 'recipe' : 'recipes'} added
        </span>
        {stats.withoutRecipe > 0 && (
          <span className="text-amber-600 font-semibold">
            {stats.withoutRecipe} remaining
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
        <div className="p-10 flex flex-col items-center text-sm text-gray-400">
          <Loader2 className="w-6 h-6 animate-spin text-[var(--brand-color)] mb-2" />
          Loading…
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
          {filteredCards.map(({ product, recipe, hasRecipe, ingredientCount, variantStatus, hasVariants, hasModifiers, hasAddOns, allVariantsHaveRecipes }) => (
            <div
              key={product._id}
              className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] overflow-hidden hover:shadow-md transition-all"
            >
              {/* Image */}
              <div className="h-32 bg-gray-100 flex items-center justify-center overflow-hidden">
                {product.image ? (
                  <img src={product.image} alt={product.name} className="w-full h-full object-cover" />
                ) : (
                  <span className="text-3xl font-black text-gray-300">{String(product.name).charAt(0).toUpperCase()}</span>
                )}
              </div>

              {/* Content */}
              <div className="p-3.5 space-y-2">
                <div>
                  <h3 className="text-sm font-bold text-gray-900 truncate">{product.name}</h3>
                  {product.category && (
                    <p className="text-[10px] text-gray-400 font-medium mt-0.5">{product.category}</p>
                  )}
                </div>

                {/* Base recipe status */}
                <div className="flex items-center gap-2">
                  {hasRecipe ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                      <Check className="w-3 h-3" /> Recipe Added
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-100 text-gray-500 border border-gray-200">
                      ○ No Recipe
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
                          className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-semibold ${
                            v.hasRecipe
                              ? 'bg-emerald-50 text-emerald-600 border border-emerald-200'
                              : 'bg-amber-50 text-amber-600 border border-amber-200'
                          }`}
                        >
                          {v.hasRecipe ? '✓' : '○'} {v.name}
                        </span>
                      ))}
                    </div>
                    {!allVariantsHaveRecipes && (
                      <p className="text-[9px] text-amber-600 font-medium">
                        ⚠ Some variants missing recipes — inventory won't reduce for those
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
                <div className="flex items-center gap-1.5 pt-1">
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

      {/* Easy Recipe Maker overlay */}
      {showEasy && (
        <EasyRecipeMaker
          initialProduct={easyProduct}
          onClose={() => { setShowEasy(false); setEasyProduct(null); }}
          onSaved={() => void loadRecipes()}
        />
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

// ─── Recipe Editor (simplified) ──────────────────────────────────
function RecipeEditor({
  existing, initialProduct, inventoryItems, menuProducts, recipes, onClose, onSaved, onDelete, notify,
}: {
  existing: RecipeDoc | null;
  initialProduct: any | null;
  inventoryItems: any[];
  menuProducts: any[];
  recipes: RecipeDoc[];
  onClose: () => void;
  onSaved: () => void;
  onDelete: (r: RecipeDoc) => void;
  notify: any;
}) {
  const [productId, setProductId] = useState(existing?.productId || initialProduct?._id || '');
  const [variantName, setVariantName] = useState(existing?.variantName || '');
  const [name, setName] = useState(existing?.name || '');
  const [nameTouched, setNameTouched] = useState(!!existing);
  const [yieldQuantity, setYieldQuantity] = useState(existing?.yieldQuantity ?? 1);
  const [yieldUnit, setYieldUnit] = useState(existing?.yieldUnit || 'plate');
  const [servingSize, setServingSize] = useState(existing?.servingSize || 1);
  const [creatingCustom, setCreatingCustom] = useState(false);
  const [saveError, setSaveError] = useState<{ title: string; detail: string } | null>(null);
  const [components, setComponents] = useState<ComponentRow[]>(() => {
    if (!existing) return [];
    return (existing.components || []).map((c: any, i: number) => ({
      key: `c${i}`,
      inventoryItemId: c.inventoryItemId || undefined,
      itemName: c.itemName,
      quantity: c.quantity,
      unit: c.unit,
      componentType: c.componentType || 'ingredient',
      subRecipeId: c.subRecipeId || undefined,
      wastagePercent: c.wastagePercent || 0,
      optional: !!c.optional,
      itemUnit: (c as any).itemUnit,
      averageCost: (c as any).averageCost,
      custom: false,
    }));
  });
  const [saving, setSaving] = useState(false);

  // ── RecipeInputStep state ──
  const [recipeMode, setRecipeMode] = useState<RecipeMode>(existing && existing.components?.length > 0 ? 'manual' : 'skip');
  const [manualSearch, setManualSearch] = useState('');
  const [manualSearchResults, setManualSearchResults] = useState<any[] | null>(null);
  const [manualLoading, setManualLoading] = useState(false);
  const [describeText, setDescribeText] = useState('');
  const [describeLoading, setDescribeLoading] = useState(false);
  const [recipeError, setRecipeError] = useState('');

  const [costSettings, setCostSettings] = useState<any | null>(null);
  useEffect(() => {
    let alive = true;
    void fetchCostSettings().then((s) => { if (alive && s) setCostSettings(s); });
    return () => { alive = false; };
  }, []);

  const product = menuProducts.find((p) => p._id === productId);
  const selectedVariant = product?.variants?.find((v: any) => v.name === variantName);
  const sellingPrice = (selectedVariant?.price ?? product?.price) || 0;

  useEffect(() => {
    if (nameTouched || !product) return;
    setName(`${product.name}${variantName ? ` (${variantName})` : ''} Recipe`);
  }, [productId, variantName, nameTouched, product, nameTouched]);

  const live = useMemo(() => {
    let direct = 0;
    const lines = components.map((c) => {
      if (c.componentType === 'sub_recipe') {
        const sub = recipes.find((r) => r._id === c.subRecipeId);
        if (!sub) return null;
        const portion = sub.yieldQuantity > 0 ? (c.quantity * (1 + c.wastagePercent / 100)) / sub.yieldQuantity : 0;
        const cost = money((sub.costSummary?.estimatedVariableCost || sub.costSummary?.recipeCost || 0) * portion);
        direct += cost;
        return { key: c.key, itemName: c.itemName, quantity: c.quantity, unit: c.unit, cost, costPerUnit: 0, missing: false, sub: true };
      }
      if (c.custom) {
        const qty = (Number(c.quantity) || 0) * (1 + (Number(c.wastagePercent) || 0) / 100);
        const cost = money(qty * (Number(c.customCost) || 0));
        direct += cost;
        return { key: c.key, itemName: c.itemName || 'Custom', quantity: qty, unit: c.unit, cost, costPerUnit: Number(c.customCost) || 0, missing: (Number(c.customCost) || 0) <= 0, custom: true };
      }
      const item = inventoryItems.find((i) => i.id === c.inventoryItemId);
      if (!item) return null;
      const qtyInItemUnit = conv(c.quantity, c.unit, item.unit) * (1 + c.wastagePercent / 100);
      const cost = money(qtyInItemUnit * (item.averageCost || 0));
      direct += cost;
      return { key: c.key, itemName: item.name, quantity: qtyInItemUnit, unit: item.unit, cost, costPerUnit: item.averageCost || 0, missing: (item.averageCost || 0) <= 0 };
    }).filter(Boolean) as any[];

    const servings = Math.max(1, Number(servingSize) || Number(yieldQuantity) || 1);
    const minor = money((Number(costSettings?.minorIngredientAllowance) || 0) * servings);
    const cooking = money((Number(costSettings?.cookingAllowance) || 0) * servings);
    const wastagePct = Number(costSettings?.wastagePercent) || 0;
    const wastage = money((direct + minor + cooking) * wastagePct / 100);
    const packaging = money(Number(costSettings?.packaging?.dineIn) || 0);
    const variable = money(direct + minor + cooking + wastage + packaging);
    const conservative = money(variable * (1 + (Number(costSettings?.conservativeMarkupPercent) || 10) / 100));
    const perServing = money(variable / servings);
    const foodCostPercent = sellingPrice > 0 ? Math.round(variable / sellingPrice * 10000) / 100 : 0;
    const contribution = money(sellingPrice - variable);
    const marginPercent = sellingPrice > 0 ? Math.round(contribution / sellingPrice * 10000) / 100 : 0;
    return { direct: money(direct), minor, cooking, wastage, packaging, variable, conservative, perServing, foodCostPercent, contribution, marginPercent, lines };
  }, [components, inventoryItems, recipes, sellingPrice, costSettings, servingSize, yieldQuantity]);

  const addIngredient = () => {
    setSaveError(null);
    const first = inventoryItems[0];
    setComponents((prev) => [...prev, {
      key: `k${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      inventoryItemId: first?.id,
      itemName: first?.name || '',
      quantity: 0,
      unit: first?.unit || 'g',
      componentType: 'ingredient',
      wastagePercent: 0,
      optional: false,
      itemUnit: first?.unit,
      averageCost: first?.averageCost,
      custom: false,
    }]);
  };

  const addSubRecipe = () => {
    setSaveError(null);
    const first = recipes.find((r) => r.status === 'active') || recipes[0];
    setComponents((prev) => [...prev, {
      key: `k${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      itemName: first?.name || '',
      quantity: 1,
      unit: first?.yieldUnit || 'unit',
      componentType: 'sub_recipe',
      subRecipeId: first?._id,
      wastagePercent: 0,
      optional: false,
    }]);
  };

  const updateRow = (key: string, patch: Partial<ComponentRow>) => {
    setSaveError(null);
    setComponents((prev) => prev.map((c) => c.key === key ? { ...c, ...patch } : c));
  };

  const removeRow = (key: string) => {
    setSaveError(null);
    setComponents((prev) => prev.filter((c) => c.key !== key));
  };

  // ── RecipeInputStep handlers ──
  const handleManualSearch = async (q: string) => {
    const trimmed = q.trim();
    if (trimmed.length < 2) { setManualSearchResults(null); return; }
    setManualLoading(true);
    setRecipeError('');
    try {
      const res = await recipeAiSearchInventory(trimmed);
      setManualSearchResults(Array.isArray(res) ? res : []);
    } catch {
      setRecipeError('Inventory search failed — try again.');
      setManualSearchResults([]);
    } finally {
      setManualLoading(false);
    }
  };

  const handleManualAddItem = (item: any) => {
    const unit = item.unit || 'g';
    const avgCost = Number(item.averageCost) || 0;
    const key = `${item._id}_${Date.now().toString(36)}`;
    setComponents((prev) => [...prev, {
      key,
      inventoryItemId: item._id,
      itemName: item.name,
      quantity: 1,
      unit,
      componentType: 'ingredient' as const,
      wastagePercent: 0,
      optional: false,
      itemUnit: unit,
      averageCost: avgCost,
      custom: false,
    }]);
    setManualSearch('');
    setManualSearchResults(null);
  };

  const handleDescribeParse = async (text: string) => {
    const trimmed = (text || '').trim();
    if (trimmed.length < 3) { setRecipeError('Say or type at least one ingredient, like "200g paneer, 100g tomato".'); return; }
    setDescribeLoading(true);
    setRecipeError('');
    try {
      const pid = productId || initialProduct?._id;
      if (!pid) { setRecipeError('Select a product first.'); return; }
      const draft = await recipeAiQuickCreate(pid, trimmed);
      if (!draft) { setRecipeError('Could not reach the AI — add the ingredients one by one instead.'); return; }
      const newRows: ComponentRow[] = [];
      const withPricing = (m: any) => {
        const itemUnit = m.itemUnit || 'g';
        return {
          itemUnit,
          averageCost: m.costPreview !== undefined && Number(m.quantity) > 0
            ? money((m.costPreview || 0) / Number(m.quantity))
            : undefined,
        };
      };
      for (const m of [...(draft.matched || []), ...(draft.needsAttention || [])]) {
        newRows.push({
          key: `k${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
          inventoryItemId: m.inventoryItemId,
          itemName: m.itemName || m.ingredientText,
          quantity: Number(m.quantity) || 0,
          unit: m.unit || 'g',
          componentType: 'ingredient',
          wastagePercent: 0,
          optional: false,
          ...withPricing(m),
          custom: false,
        });
      }
      if (newRows.length === 0) {
        setRecipeError('Could not parse any ingredients — try typing them differently.');
        return;
      }
      setComponents((prev) => [...prev, ...newRows]);
    } catch (e: any) {
      setRecipeError(e?.response?.data?.error || e?.message || 'AI failed — add ingredients one by one instead.');
    } finally {
      setDescribeLoading(false);
    }
  };

  const handleRecipeStepRowsChange = (rows: RecipeRow[]) => {
    // Convert RecipeInputStep rows back to ComponentRow format
    const converted: ComponentRow[] = rows.map((r) => ({
      key: r.key,
      inventoryItemId: r.inventoryItemId,
      itemName: r.itemName,
      quantity: r.quantity,
      unit: r.unit,
      componentType: 'ingredient' as const,
      wastagePercent: 0,
      optional: false,
      itemUnit: r.itemUnit,
      averageCost: r.averageCost,
      custom: false,
    }));
    setComponents(converted);
  };

  const recipeRowsForStep: RecipeRow[] = components.map((c) => ({
    key: c.key,
    inventoryItemId: c.inventoryItemId,
    itemName: c.itemName,
    unit: c.unit,
    quantity: c.quantity,
    averageCost: c.averageCost,
    costPreview: live.lines.find((l: any) => l.key === c.key)?.cost,
    needsReview: false,
  }));

  const payloadFrom = (rows: ComponentRow[]) => ({
    productId,
    variantName: variantName.trim() || undefined,
    name: name || undefined,
    yieldQuantity: Number(yieldQuantity) || 1,
    yieldUnit: yieldUnit || 'unit',
    servingSize: Number(servingSize) || undefined,
    components: rows.map((c) => c.componentType === 'sub_recipe'
      ? { componentType: 'sub_recipe', subRecipeId: c.subRecipeId, itemName: c.itemName || 'Sub-recipe', unit: c.unit, quantity: Number(c.quantity) || 0, wastagePercent: Number(c.wastagePercent) || 0, optional: c.optional }
      : { inventoryItemId: c.inventoryItemId, itemName: c.itemName || 'Ingredient', unit: c.unit, quantity: Number(c.quantity) || 0, wastagePercent: Number(c.wastagePercent) || 0, optional: c.optional }),
  });

  const resolveCustomItems = async (): Promise<ComponentRow[] | null> => {
    const rows = [...components];
    const problems: string[] = [];
    for (let i = 0; i < rows.length; i++) {
      const c = rows[i];
      if (c.componentType !== 'ingredient' || !c.custom) continue;
      const n = (c.itemName || '').trim();
      if (!n) { problems.push(`Custom ingredient row ${i + 1} is missing a name`); continue; }
      const match = inventoryItems.find((it) => it.name.toLowerCase() === n.toLowerCase());
      if (match) { rows[i] = { ...c, inventoryItemId: match.id, itemUnit: match.unit, averageCost: match.averageCost }; continue; }
      try {
        const created = await createProduct({
          name: n, category: 'Uncategorized', image: '', code: `INV-${Date.now().toString(36).toUpperCase()}${i}`,
          price: 0, availability: false, currentStock: 0, unit: c.unit || 'pcs', minStock: 0, maxStock: 0,
          reorderLevel: 0, averageCost: Number(c.customCost) || 0, supplier: '',
        });
        const id = created?._id || created?.id;
        if (!id) { problems.push(`Couldn't add "${n}" to Inventory`); continue; }
        rows[i] = { ...c, inventoryItemId: id, itemUnit: c.unit, averageCost: Number(c.customCost) || 0 };
      } catch (e: any) {
        problems.push(`Couldn't add "${n}": ${e?.response?.data?.error || e?.message || 'server error'}`);
      }
    }
    if (problems.length > 0) { setSaveError({ title: 'Save issue', detail: problems.join(' · ') }); return null; }
    return rows;
  };

  const handleSave = async (activate: boolean) => {
    setSaveError(null);
    if (!productId) { setSaveError({ title: 'Pick a product first', detail: 'Choose the menu item this recipe produces.' }); return; }
    if (components.filter((c) => !c.optional).length === 0) { setSaveError({ title: 'Add at least one ingredient', detail: 'A recipe needs ingredients so it can be costed and consumed.' }); return; }
    setSaving(true);
    setCreatingCustom(true);
    try {
      const rows = await resolveCustomItems();
      if (!rows) return;
      const body = payloadFrom(rows);
      let saved;
      if (existing) saved = await updateRecipe(existing._id, body);
      else saved = await createRecipe({ ...body, status: activate ? 'active' : 'draft' });
      if (!saved) { setSaveError({ title: 'Saved offline', detail: 'The recipe was queued and will sync when connected.' }); return; }
      if (activate && existing && existing.status !== 'active') await activateRecipe(saved._id);
      notify(activate ? 'Recipe saved & activated' : 'Recipe saved as draft', 'success');
      onSaved();
    } catch (e: any) {
      setSaveError({ title: "Couldn't save the recipe", detail: e?.message || 'Check the connection and try again.' });
    } finally {
      setSaving(false);
      setCreatingCustom(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[150] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[var(--color-bg-white)] rounded-3xl shadow-2xl max-w-5xl w-full max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="px-6 py-4 border-b border-[var(--color-border-default)] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <ChefHat className="w-5 h-5 text-[var(--brand-color)]" />
            <div>
              <h3 className="text-base font-bold">{existing ? `Edit Recipe — ${existing.productName}` : `Create Recipe — ${product?.name || ''}`}</h3>
              <p className="text-[11px] text-gray-400">Ingredients reference your existing inventory — no duplicate catalog.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {existing && (
              <button onClick={() => onDelete(existing)} className="px-3 py-1.5 text-[10px] font-bold text-red-500 hover:bg-red-50 rounded-lg transition-all cursor-pointer">Delete</button>
            )}
            <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg cursor-pointer"><X className="w-4 h-4 text-gray-400" /></button>
          </div>
        </div>

        {saveError && (
          <div className="px-6 py-3 bg-red-50 border-b border-red-200 flex items-start gap-2.5 shrink-0" role="alert">
            <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-red-700">{saveError.title}</p>
              {saveError.detail && <p className="text-[11px] text-red-600 mt-0.5">{saveError.detail}</p>}
            </div>
            <button onClick={() => setSaveError(null)} className="p-1 text-red-400 hover:text-red-600 rounded cursor-pointer shrink-0"><X className="w-3.5 h-3.5" /></button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-5 grid grid-cols-5 gap-5">
          {/* Left: setup */}
          <div className="col-span-3 space-y-4">
            {!existing && !initialProduct && (
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">Menu Item</label>
                <select value={productId} onChange={(e) => { setProductId(e.target.value); setVariantName(''); setSaveError(null); }} className="w-full px-3 py-2.5 bg-gray-50 border border-[var(--color-border-default)] rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]/20 cursor-pointer">
                  <option value="">Select menu item…</option>
                  {menuProducts.map((p) => (
                    <option key={p._id} value={p._id}>{p.name}{recipes.some((r) => r.productId === p._id && r.status === 'active') ? ' (has recipe)' : ''} — ₹{Number(p.price || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</option>
                  ))}
                </select>
              </div>
            )}

            {product?.variants?.length > 0 && (
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">Variant</label>
                <select value={variantName} onChange={(e) => { setVariantName(e.target.value); setSaveError(null); }} className="w-full px-3 py-2.5 bg-gray-50 border border-[var(--color-border-default)] rounded-xl text-xs font-semibold focus:outline-none cursor-pointer">
                  <option value="">Base / no variant</option>
                  {(product.variants || []).map((v: any) => (
                    <option key={v._id || v.name} value={v.name}>{v.name} — ₹{Number(v.price || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">Recipe name</label>
              <input value={name} onChange={(e) => { setName(e.target.value); setNameTouched(true); setSaveError(null); }} placeholder={product ? `${product.name} Recipe` : 'Recipe name'} className="w-full px-3 py-2.5 bg-gray-50 border border-[var(--color-border-default)] rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]/20" />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">Yield</label>
                <input type="number" min="0" value={yieldQuantity} onChange={(e) => { setYieldQuantity(Number(e.target.value)); setSaveError(null); }} className="w-full px-3 py-2.5 bg-gray-50 border border-[var(--color-border-default)] rounded-xl text-xs focus:outline-none" />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">Unit</label>
                <select value={yieldUnit} onChange={(e) => { setYieldUnit(e.target.value); setSaveError(null); }} className="w-full px-3 py-2.5 bg-gray-50 border border-[var(--color-border-default)] rounded-xl text-xs font-semibold focus:outline-none cursor-pointer">
                  {[...new Set([...YIELD_UNITS, yieldUnit])].map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">Portions</label>
                <input type="number" min="1" value={servingSize} onChange={(e) => { setServingSize(Number(e.target.value)); setSaveError(null); }} className="w-full px-3 py-2.5 bg-gray-50 border border-[var(--color-border-default)] rounded-xl text-xs focus:outline-none" />
              </div>
            </div>

            {/* Ingredients — RecipeInputStep (matches registration wizard design) */}
            <RecipeInputStep
              mode={recipeMode}
              onModeChange={setRecipeMode}
              rows={recipeRowsForStep}
              onRowsChange={handleRecipeStepRowsChange}
              currencySymbol="₹"
              recipeCost={live.direct}
              referencePrice={sellingPrice}
              marginPct={sellingPrice > 0 ? Math.round(((sellingPrice - live.variable) / sellingPrice) * 100) : null}
              manualSearch={manualSearch}
              onManualSearchChange={setManualSearch}
              manualSearchResults={manualSearchResults}
              onManualSearch={handleManualSearch}
              onManualAddItem={handleManualAddItem}
              manualLoading={manualLoading}
              describeText={describeText}
              onDescribeTextChange={setDescribeText}
              onParseText={handleDescribeParse}
              describeLoading={describeLoading}
              error={recipeError}
              onRowQuantityChange={(key, qty) => updateRow(key, { quantity: qty })}
              onRowRemove={removeRow}
            />
          </div>

          {/* Right: live cost panel */}
          <div className="col-span-2 space-y-4">
            <div className="bg-gradient-to-br from-[var(--color-sidebar-bg)] to-[#2a2d3d] rounded-2xl p-5 text-white">
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/50 mb-3">Live cost estimate</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[10px] text-white/50">Selling price</p>
                  <p className="text-lg font-black font-mono">{fmt(sellingPrice)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-white/50">Cost to make</p>
                  <p className="text-lg font-black font-mono text-amber-300">{fmt(live.variable)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-white/50">You keep</p>
                  <p className={`text-lg font-black font-mono ${live.contribution >= 0 ? 'text-emerald-300' : 'text-red-400'}`}>{fmt(live.contribution)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-white/50">Food cost %</p>
                  <p className={`text-lg font-black font-mono ${live.foodCostPercent > 45 ? 'text-red-400' : live.foodCostPercent > 35 ? 'text-amber-300' : 'text-emerald-300'}`}>{live.foodCostPercent}%</p>
                </div>
              </div>
              <div className="mt-3 pt-3 border-t border-white/10">
                <p className="text-[10px] text-white/40">Per portion ≈ {fmt(live.perServing)}</p>
              </div>
            </div>

            <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-4">
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2">Ingredient breakdown</p>
              {live.lines.length === 0 && <p className="text-xs text-gray-400">Add ingredients to see the breakdown.</p>}
              <div className="space-y-1.5">
                {live.lines.map((l: any) => (
                  <div key={l.key} className="flex items-center justify-between text-xs">
                    <span className="text-gray-600">{l.itemName}</span>
                    <span className="font-mono text-gray-500">
                      {l.quantity} {l.unit} · <span className={l.missing ? 'text-amber-500 font-bold' : 'font-bold text-gray-800'}>{fmt(l.cost)}</span>
                    </span>
                  </div>
                ))}
                <div className="flex items-center justify-between text-sm pt-2 border-t border-[var(--color-border-default)]">
                  <span className="font-bold text-gray-800">Total cost</span>
                  <span className="font-black font-mono text-[var(--brand-color)]">{fmt(live.variable)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[var(--color-border-default)] flex items-center justify-end gap-2 shrink-0">
          <button onClick={onClose} className="px-4 py-2 rounded-xl border border-[var(--color-border-default)] text-gray-600 text-xs font-bold hover:bg-gray-50 transition-all cursor-pointer">Cancel</button>
          <button onClick={() => handleSave(false)} disabled={saving || creatingCustom} className="px-4 py-2 rounded-xl bg-gray-800 text-white text-xs font-bold hover:bg-gray-900 transition-all cursor-pointer disabled:opacity-50 flex items-center gap-1.5">
            {saving || creatingCustom ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} Save Draft
          </button>
          <button onClick={() => handleSave(true)} disabled={saving || creatingCustom} className="px-4 py-2 rounded-xl bg-[var(--brand-color)] text-white text-xs font-bold hover:bg-[var(--color-primary-hover)] transition-all cursor-pointer disabled:opacity-50 flex items-center gap-1.5">
            {saving || creatingCustom ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Save & Activate
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Searchable ingredient picker ────────────────────────────────
function IngredientPicker({
  value, items, fallback, onSelect, placeholder,
}: {
  value?: string;
  items: any[];
  fallback?: { id: string; name: string; unit?: string } | null;
  onSelect: (id: string) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  const selected = items.find((i) => i.id === value) || (value ? fallback : null);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? items.filter((i) => i.name.toLowerCase().includes(q)) : items;
    return list.slice(0, 60);
  }, [items, query]);

  useEffect(() => { if (!open) setQuery(selected?.name || ''); }, [value, open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => setHighlight(0), [query]);

  const choose = (id: string, n: string) => { onSelect(id); setQuery(n); setOpen(false); };

  return (
    <div ref={boxRef} className="relative flex-1 min-w-0">
      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-300 pointer-events-none" />
      <input
        value={query}
        placeholder={placeholder || 'Search inventory…'}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHighlight((h) => Math.min(h + 1, Math.max(filtered.length - 1, 0))); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); }
          else if (e.key === 'Enter') { e.preventDefault(); if (open && filtered[highlight]) choose(filtered[highlight].id, filtered[highlight].name); }
          else if (e.key === 'Escape' || e.key === 'Tab') setOpen(false);
        }}
        className="w-full pl-8 pr-7 py-2 bg-[var(--color-bg-white)] border border-[var(--color-border-default)] rounded-lg text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]/20"
      />
      <ChevronDown className={`absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none transition-transform ${open ? 'rotate-180 text-[var(--brand-color)]' : 'text-gray-300'}`} />
      {open && filtered.length > 0 && (
        <div className="absolute left-0 right-0 top-full mt-1 z-30 max-h-52 overflow-y-auto bg-[var(--color-bg-white)] border border-[var(--color-border-default)] rounded-lg shadow-xl">
          {filtered.map((i, idx) => (
            <button key={i.id} type="button" onMouseEnter={() => setHighlight(idx)} onClick={() => choose(i.id, i.name)}
              className={`w-full px-2.5 py-2 text-left flex items-center justify-between gap-2 cursor-pointer ${idx === highlight ? 'bg-blue-50' : 'bg-[var(--color-bg-white)] hover:bg-gray-50'}`}>
              <span className="text-xs font-semibold text-gray-700 truncate">{i.name}</span>
              <span className="text-[10px] font-mono text-gray-400 shrink-0">{i.unit} · ₹{Number(i.averageCost || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </button>
          ))}
        </div>
      )}
      {open && query.trim() && filtered.length === 0 && (
        <div className="absolute left-0 right-0 top-full mt-1 z-30 bg-[var(--color-bg-white)] border border-[var(--color-border-default)] rounded-lg shadow-xl px-3 py-2 text-[11px] text-gray-400">
          No inventory items match "{query}". Type the name and click Custom to add a new ingredient.
        </div>
      )}
    </div>
  );
}
