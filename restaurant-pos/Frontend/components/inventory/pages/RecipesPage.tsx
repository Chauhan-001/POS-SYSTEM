/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * RecipesPage — Recipe Manager (frontend).
 *
 * Flows:
 *   Recipe Manager → pick product → add ingredients (existing inventory items)
 *   → see live cost vs selling price → save / activate
 *
 * Live cost preview is computed CLIENT-side with a tiny mirror of the backend
 * unit converter so the merchant gets instant feedback while editing. The
 * backend (RecipeCostEngine) is authoritative — costSummary on the saved
 * recipe and every consumption/variance report come from the server.
 */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  ChefHat, Plus, Pencil, Archive, Copy, Trash2, Play, Search,
  History, X, Check, AlertTriangle, Package, TrendingUp, Scale,
  Layers, Loader2, IndianRupee, Settings2, Mic, Sparkles, Brain,
  ChevronDown,
} from 'lucide-react';
import { useNotify, useInventory } from '../InventoryManager';
import {
  fetchRecipes, fetchRecipeVersions, createRecipe, updateRecipe,
  activateRecipe, archiveRecipe, duplicateRecipe, deleteRecipe,
  fetchProductProfitability, fetchConsumptionVariance, fetchProducts,
  fetchCostSettings, recipeAiQuickCreate, recipeAiSearchInventory,
  createProduct,
} from '../../../src/api/client';
import apiClient from '../../../src/api/axios';
import CostSettingsPanel from './CostSettingsPanel';
import CostIntelligencePanel from './CostIntelligencePanel';
import EasyRecipeMaker from './EasyRecipeMaker';

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
// Curated unit choices — a select (not free text) so typos can never break
// the unit converter. Kept to units the backend RecipeCostEngine understands.
const YIELD_UNITS = ['plate', 'portion', 'serving', 'pcs', 'kg', 'g', 'L', 'ml', 'unit'];
const MASS_UNITS = ['kg', 'g', 'mg'];
const VOLUME_UNITS = ['L', 'ml'];
const COUNT_UNITS = ['pcs', 'pc', 'piece', 'unit', 'nos'];
const ALL_UNITS = [...new Set([...YIELD_UNITS, ...MASS_UNITS, ...VOLUME_UNITS, ...COUNT_UNITS])];
/** Units allowed for an ingredient row — its own unit's family (+ the current value for round-trips). */
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
// Consistent ₹ formatting: always 2 decimals, Indian grouping.
const fmt = (n: number) => '₹' + money(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (n: number) => `${Math.round(n * 100) / 100}%`;

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
  /** Ad-hoc ingredient not yet in inventory — added to Inventory on save. */
  custom?: boolean;
  /** Purchase cost per unit entered for a custom item (₹). */
  customCost?: number;
}

// Deterministic recipe health (Phase E dashboard requirement). Every rule is
// computed from existing recipe data — no LLM, no hidden state.
interface RecipeHealth {
  tone: 'ok' | 'warn' | 'bad';
  label: string;
  reason: string;
}
function recipeHealth(r: RecipeDoc): RecipeHealth {
  const cost = r.costSummary;
  const price = cost?.recipeCost ?? 0;
  const contribution = cost?.contribution ?? 0;
  const margin = cost?.contributionMarginPercent ?? 0;
  const missingCost = price <= 0 || !cost;
  if (r.status !== 'active') return { tone: 'warn', label: 'Not active', reason: 'Draft/archived — not used in consumption or costing.' };
  if (missingCost) return { tone: 'bad', label: 'Missing costing', reason: 'No costable components — add ingredients with an average cost.' };
  if (contribution < 0) return { tone: 'bad', label: 'Loses money', reason: `Contribution is negative (${fmt(contribution)}). Raise the price or cut ingredient cost.` };
  if (margin < 20) return { tone: 'warn', label: 'Low contribution', reason: `Contribution margin ${pct(margin)} — below 20%.` };
  return { tone: 'ok', label: 'Healthy', reason: `Fully costed · contribution margin ${pct(margin)}.` };
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
  createdAt: string;
  updatedAt: string;
}

type Tab = 'recipes' | 'profitability' | 'variance' | 'settings' | 'intelligence';

export default function RecipesPage() {
  const notify = useNotify();
  const { items } = useInventory();
  const [tab, setTab] = useState<Tab>('recipes');

  const [recipes, setRecipes] = useState<RecipeDoc[] | null>(null);
  const [synced, setSynced] = useState(false);
  const [menuProducts, setMenuProducts] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // Editor state
  const [editing, setEditing] = useState<RecipeDoc | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  // Easy Mode wizard (voice-first, giant buttons — for anyone to use)
  const [showEasy, setShowEasy] = useState(false);
  const [versionsFor, setVersionsFor] = useState<RecipeDoc | null>(null);
  const [saving, setSaving] = useState(false);

  // Profitability / variance
  const [profitRows, setProfitRows] = useState<any[] | null>(null);
  const [profitSummary, setProfitSummary] = useState<any | null>(null);
  const [varianceRows, setVarianceRows] = useState<any[] | null>(null);

  // Styled delete confirmation
  const [pendingDelete, setPendingDelete] = useState<RecipeDoc | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadRecipes = useCallback(async () => {
    const data = await fetchRecipes({ search: search || undefined, status: statusFilter || undefined });
    setRecipes(data || []);
    setSynced(data !== null);
  }, [search, statusFilter]);

  const loadMenuProducts = useCallback(async () => {
    const data = await fetchProducts();
    if (Array.isArray(data)) {
      setMenuProducts(data.filter((p: any) => p.availability !== false && !p.isDeleted));
    }
  }, []);

  useEffect(() => { void loadRecipes(); }, [loadRecipes]);
  useEffect(() => { void loadMenuProducts(); }, [loadMenuProducts]);

  const loadProfitability = useCallback(async () => {
    const data = await fetchProductProfitability({ startDate: new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10) });
    if (data) { setProfitRows(data.rows || []); setProfitSummary(data.summary || null); }
  }, []);

  const loadVariance = useCallback(async () => {
    const data = await fetchConsumptionVariance({ startDate: new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10) });
    if (data) setVarianceRows(data.rows || []);
  }, []);

  useEffect(() => { if (tab === 'profitability') void loadProfitability(); }, [tab, loadProfitability]);
  useEffect(() => { if (tab === 'variance') void loadVariance(); }, [tab, loadVariance]);

  const statusBadge = (s: string) => {
    const map: Record<string, string> = {
      active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      draft: 'bg-amber-50 text-amber-700 border-amber-200',
      archived: 'bg-gray-100 text-gray-500 border-gray-200',
    };
    return <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${map[s] || map.draft}`}>{s}</span>;
  };

  const handleActivate = async (r: RecipeDoc) => {
    const res = await activateRecipe(r._id);
    if (res) { notify(`"${r.name}" is now active`, 'success'); void loadRecipes(); }
    else notify('Activation failed', 'warning');
  };
  const handleArchive = async (r: RecipeDoc) => {
    const res = await archiveRecipe(r._id);
    if (res) { notify(`"${r.name}" archived`, 'success'); void loadRecipes(); }
    else notify('Archive failed', 'warning');
  };
  const handleDuplicate = async (r: RecipeDoc) => {
    const res = await duplicateRecipe(r._id);
    if (res) { notify('Draft copy created', 'success'); void loadRecipes(); }
    else notify('Duplicate failed', 'warning');
  };
  const handleDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    const res = await deleteRecipe(pendingDelete._id);
    setDeleting(false);
    if (res) { notify(`"${pendingDelete.name}" deleted`, 'success'); setPendingDelete(null); void loadRecipes(); }
    else { notify('Delete failed — archive it first', 'warning'); setPendingDelete(null); }
  };

  const openVersions = async (r: RecipeDoc) => {
    const versions = await fetchRecipeVersions(r._id);
    setVersionsFor({ ...r, __versions: versions || [] } as any);
  };

  // ── Stats ──────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const list = recipes || [];
    const active = list.filter((r) => r.status === 'active');
    const costs = list.filter((r) => r.status !== 'archived' && (r.costSummary?.recipeCost || 0) > 0);
    const avgFoodCost = costs.length
      ? Math.round(costs.reduce((s, r) => s + (r.costSummary?.foodCostPercent || 0), 0) / costs.length * 100) / 100
      : 0;
    const totalValue = money(costs.reduce((s, r) => s + (r.costSummary?.recipeCost || 0), 0));
    return { total: list.length, active: active.length, avgFoodCost, totalValue };
  }, [recipes]);

  return (
    <div className="p-5 space-y-4">
      {/* Header + stats */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold tracking-tight flex items-center gap-2">
            <ChefHat className="w-5 h-5 text-[var(--brand-color)]" /> Recipe Manager
          </h2>
          <p className="text-xs text-gray-400 mt-0.5">Menu products → ingredients → live cost & margin. Consumption is tracked automatically on every bill.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowEasy(true)}
            className="px-4 py-2.5 bg-gradient-to-br from-amber-400 to-orange-500 text-white rounded-xl text-xs font-black hover:brightness-105 transition-all flex items-center gap-1.5 shadow-md cursor-pointer"
            title="Make a recipe the easy way — tap and speak, no forms"
          >
            <Sparkles className="w-4 h-4" /> 😊 Easy Mode
          </button>
          <button
            onClick={() => { setEditing(null); setShowEditor(true); }}
            className="px-4 py-2 bg-[var(--brand-color)] text-white rounded-xl text-xs font-bold hover:bg-[#003ea8] transition-all flex items-center gap-1.5 shadow-sm cursor-pointer"
          >
            <Plus className="w-4 h-4" /> New Recipe
          </button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Recipes', value: String(stats.total), icon: Layers, color: 'text-[var(--brand-color)]' },
          { label: 'Active', value: String(stats.active), icon: Play, color: 'text-emerald-600' },
          { label: 'Avg Food Cost', value: `${stats.avgFoodCost}%`, icon: TrendingUp, color: 'text-amber-600' },
          { label: 'Ingredient Value', value: fmt(stats.totalValue), icon: IndianRupee, color: 'text-purple-600' },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-2xl border border-[#e1e2ed] p-4 flex items-center gap-3">
            <div className={`w-9 h-9 rounded-xl bg-gray-50 flex items-center justify-center ${s.color}`}>
              <s.icon style={{ width: 18, height: 18 }} />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{s.label}</p>
              <p className="text-lg font-black text-gray-900">{s.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 bg-white rounded-xl p-1 border border-[#e1e2ed] w-fit">
        {([
          { id: 'recipes', label: 'Recipes', icon: ChefHat },
          { id: 'intelligence', label: 'Cost Intelligence', icon: Brain },
          { id: 'profitability', label: 'Product Profitability', icon: TrendingUp },
          { id: 'variance', label: 'Consumption Variance', icon: Scale },
          { id: 'settings', label: 'Cost Settings', icon: Settings2 },
        ] as { id: Tab; label: string; icon: any }[]).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              tab === t.id ? 'bg-[var(--brand-color)] text-white shadow-sm' : 'text-gray-500 hover:bg-blue-50'
            }`}
          >
            <t.icon className="w-3.5 h-3.5" /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'recipes' && (
        <>
          {/* Toolbar */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search recipes…"
                className="w-full pl-9 pr-3 py-2 bg-white border border-[#e1e2ed] rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]/20"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 bg-white border border-[#e1e2ed] rounded-xl text-xs font-semibold text-gray-600 focus:outline-none cursor-pointer"
            >
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="draft">Draft</option>
              <option value="archived">Archived</option>
            </select>
          </div>

          {/* Recipe list */}
          <div className="bg-white rounded-2xl border border-[#e1e2ed] overflow-hidden">
            {!synced && recipes === null ? (
              <div className="p-10 flex flex-col items-center text-sm text-gray-400">
                <Loader2 className="w-6 h-6 animate-spin text-[var(--brand-color)] mb-2" />
                Loading recipes…
              </div>
            ) : (recipes || []).length === 0 ? (
              <div className="p-10 text-center">
                <Package className="w-10 h-10 text-gray-200 mx-auto mb-2" />
                <p className="text-sm font-semibold text-gray-500">No recipes yet</p>
                <p className="text-xs text-gray-400 mt-1">Create a recipe to link menu products to their ingredients and unlock live costing.</p>
                <button
                  onClick={() => { setEditing(null); setShowEditor(true); }}
                  className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 bg-[var(--brand-color)] text-white rounded-xl text-xs font-bold hover:bg-[#003ea8] transition-all cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" /> Create your first recipe
                </button>
                <button
                  onClick={() => setShowEasy(true)}
                  className="mt-2 inline-flex items-center gap-1.5 px-4 py-2.5 bg-gradient-to-br from-amber-400 to-orange-500 text-white rounded-xl text-xs font-black hover:brightness-105 transition-all cursor-pointer shadow-md"
                >
                  <Sparkles className="w-3.5 h-3.5" /> 😊 Make it the EASY way — tap, speak, done
                </button>
              </div>
            ) : (
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-[#e1e2ed] text-[10px] uppercase tracking-wider text-gray-400">
                    <th className="px-4 py-2.5 font-bold">Product</th>
                    <th className="px-4 py-2.5 font-bold">Recipe</th>
                    <th className="px-4 py-2.5 font-bold">Health</th>
                    <th className="px-4 py-2.5 font-bold">Status</th>
                    <th className="px-4 py-2.5 font-bold text-right">Yield</th>
                    <th className="px-4 py-2.5 font-bold text-right">Est. Variable Cost</th>
                    <th className="px-4 py-2.5 font-bold text-right">Variable Cost %</th>
                    <th className="px-4 py-2.5 font-bold text-right">Contribution</th>
                    <th className="px-4 py-2.5 font-bold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(recipes || []).map((r) => (
                    <tr key={r._id} className="border-b border-[#e1e2ed]/60 hover:bg-blue-50/30">
                      <td className="px-4 py-3">
                        <p className="text-sm font-bold text-gray-800">{r.productName}</p>
                        {r.variantName && <p className="text-[10px] text-gray-400">{r.variantName}</p>}
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-xs font-semibold text-gray-600">{r.name}</p>
                        <p className="text-[10px] text-gray-400">v{r.version} · {r.components?.length || 0} ingredient{(r.components?.length || 0) === 1 ? '' : 's'}</p>
                      </td>
                      <td className="px-4 py-3">
                        {(() => {
                          const h = recipeHealth(r);
                          return (
                            <span
                              title={h.reason}
                              className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-bold border cursor-help ${
                                h.tone === 'ok' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                  : h.tone === 'warn' ? 'bg-amber-50 text-amber-700 border-amber-200'
                                    : 'bg-rose-50 text-rose-700 border-rose-200'
                              }`}
                            >
                              {h.tone === 'ok' ? '✓' : h.tone === 'warn' ? '⚠' : '✗'} {h.label}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-4 py-3">{statusBadge(r.status)}</td>
                      <td className="px-4 py-3 text-right text-xs font-mono text-gray-600">{r.yieldQuantity} {r.yieldUnit}</td>
                      <td className="px-4 py-3 text-right text-xs font-mono font-bold text-gray-800">{fmt(r.costSummary?.estimatedVariableCost ?? r.costSummary?.recipeCost ?? 0)}</td>
                      <td className={`px-4 py-3 text-right text-xs font-mono font-bold ${(r.costSummary?.foodCostPercent || 0) > 45 ? 'text-red-600' : (r.costSummary?.foodCostPercent || 0) > 35 ? 'text-amber-600' : 'text-emerald-600'}`}>
                        {r.costSummary?.foodCostPercent || 0}%
                      </td>
                      <td className={`px-4 py-3 text-right text-xs font-mono font-bold ${(r.costSummary?.contribution || 0) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {fmt(r.costSummary?.contribution || 0)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => { setEditing(r); setShowEditor(true); }} title="Edit" className="p-1.5 hover:bg-blue-100 text-gray-500 hover:text-[var(--brand-color)] rounded-lg transition-all cursor-pointer">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => openVersions(r)} title="Version history" className="p-1.5 hover:bg-purple-100 text-gray-500 hover:text-purple-600 rounded-lg transition-all cursor-pointer">
                            <History className="w-3.5 h-3.5" />
                          </button>
                          {r.status !== 'active' && (
                            <button onClick={() => handleActivate(r)} title="Activate" className="p-1.5 hover:bg-emerald-100 text-gray-500 hover:text-emerald-600 rounded-lg transition-all cursor-pointer">
                              <Play className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {r.status === 'active' && (
                            <button onClick={() => handleArchive(r)} title="Archive" className="p-1.5 hover:bg-amber-100 text-gray-500 hover:text-amber-600 rounded-lg transition-all cursor-pointer">
                              <Archive className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button onClick={() => handleDuplicate(r)} title="Duplicate as draft" className="p-1.5 hover:bg-indigo-100 text-gray-500 hover:text-indigo-600 rounded-lg transition-all cursor-pointer">
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                          {r.status !== 'active' && (
                            <button onClick={() => setPendingDelete(r)} title="Delete draft" className="p-1.5 hover:bg-red-100 text-gray-500 hover:text-red-600 rounded-lg transition-all cursor-pointer">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {tab === 'profitability' && (
        <div className="bg-white rounded-2xl border border-[#e1e2ed] p-5">
          {profitSummary && (
            <div className="grid grid-cols-4 gap-3 mb-4">
              {[
                { label: 'Products', value: String(profitSummary.products) },
                { label: 'Units sold (30d)', value: String(profitSummary.unitsSold) },
                { label: 'Total revenue', value: fmt(profitSummary.totalRevenue || 0) },
                { label: 'Total contribution', value: fmt(profitSummary.totalContribution || 0) },
              ].map((s) => (
                <div key={s.label} className="bg-gray-50 rounded-xl p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{s.label}</p>
                  <p className="text-base font-black text-gray-800 mt-0.5">{s.value}</p>
                </div>
              ))}
            </div>
          )}
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-[#e1e2ed] text-[10px] uppercase tracking-wider text-gray-400">
                <th className="px-3 py-2.5 font-bold">Product</th>
                <th className="px-3 py-2.5 font-bold text-right">Price</th>
                <th className="px-3 py-2.5 font-bold text-right">Recipe Cost</th>
                <th className="px-3 py-2.5 font-bold text-right">Food Cost %</th>
                <th className="px-3 py-2.5 font-bold text-right">Contribution</th>
                <th className="px-3 py-2.5 font-bold text-right">Margin %</th>
                <th className="px-3 py-2.5 font-bold text-right">Units</th>
                <th className="px-3 py-2.5 font-bold text-right">Total Contribution</th>
              </tr>
            </thead>
            <tbody>
              {(profitRows || []).map((r) => (
                <tr key={r.productId} className="border-b border-[#e1e2ed]/60">
                  <td className="px-3 py-2.5 text-sm font-bold text-gray-800">{r.productName}</td>
                  <td className="px-3 py-2.5 text-right text-xs font-mono">{fmt(r.sellingPrice)}</td>
                  <td className="px-3 py-2.5 text-right text-xs font-mono">{fmt(r.recipeCost)}</td>
                  <td className={`px-3 py-2.5 text-right text-xs font-mono font-bold ${r.foodCostPercent > 45 ? 'text-red-600' : r.foodCostPercent > 35 ? 'text-amber-600' : 'text-emerald-600'}`}>{r.foodCostPercent}%</td>
                  <td className={`px-3 py-2.5 text-right text-xs font-mono font-bold ${r.contribution >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{fmt(r.contribution)}</td>
                  <td className="px-3 py-2.5 text-right text-xs font-mono">{r.contributionMarginPercent}%</td>
                  <td className="px-3 py-2.5 text-right text-xs font-mono">{r.unitsSold}</td>
                  <td className="px-3 py-2.5 text-right text-xs font-mono font-bold">{fmt(r.totalContribution)}</td>
                </tr>
              ))}
              {(profitRows || []).length === 0 && (
                <tr><td colSpan={8} className="px-3 py-8 text-center text-sm text-gray-400">No active recipes yet — product profitability appears once recipes exist.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'settings' && <CostSettingsPanel />}
      {tab === 'intelligence' && <CostIntelligencePanel />}

      {tab === 'variance' && (
        <div className="bg-white rounded-2xl border border-[#e1e2ed] p-5">
          <p className="text-xs text-gray-400 mb-4 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
            Theoretical consumption (from recipes on completed bills) vs actual stock movement. A positive variance means more was used than recipes predict — a signal for wastage, portion variance or unrecorded use. This is an operational anomaly signal, not an accusation.
          </p>
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-[#e1e2ed] text-[10px] uppercase tracking-wider text-gray-400">
                <th className="px-3 py-2.5 font-bold">Ingredient</th>
                <th className="px-3 py-2.5 font-bold text-right">Theoretical</th>
                <th className="px-3 py-2.5 font-bold text-right">Actual</th>
                <th className="px-3 py-2.5 font-bold text-right">Variance</th>
                <th className="px-3 py-2.5 font-bold text-right">Variance %</th>
                <th className="px-3 py-2.5 font-bold text-right">Est. Cost</th>
              </tr>
            </thead>
            <tbody>
              {(varianceRows || []).map((r) => (
                <tr key={r.name} className="border-b border-[#e1e2ed]/60">
                  <td className="px-3 py-2.5 text-sm font-bold text-gray-800">{r.name}</td>
                  <td className="px-3 py-2.5 text-right text-xs font-mono">{r.theoreticalQty} {r.unit}</td>
                  <td className="px-3 py-2.5 text-right text-xs font-mono">{r.actualQty} {r.unit}</td>
                  <td className={`px-3 py-2.5 text-right text-xs font-mono font-bold ${Math.abs(r.varianceQty) < 0.001 ? 'text-gray-400' : r.varianceQty > 0 ? 'text-amber-600' : 'text-blue-600'}`}>
                    {r.varianceQty > 0 ? '+' : ''}{r.varianceQty}
                  </td>
                  <td className={`px-3 py-2.5 text-right text-xs font-mono font-bold ${Math.abs(r.variancePercent) < 0.01 ? 'text-gray-400' : r.variancePercent > 0 ? 'text-amber-600' : 'text-blue-600'}`}>
                    {r.variancePercent > 0 ? '+' : ''}{r.variancePercent}%
                  </td>
                  <td className="px-3 py-2.5 text-right text-xs font-mono">{fmt(r.varianceCost)}</td>
                </tr>
              ))}
              {(varianceRows || []).length === 0 && (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-sm text-gray-400">No consumption data yet — variance appears after recipe-linked bills are recorded.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {showEasy && (
        <EasyRecipeMaker
          onClose={() => setShowEasy(false)}
          onSaved={() => void loadRecipes()}
        />
      )}

      {showEditor && <RecipeEditor
        existing={editing}
        inventoryItems={items}
        menuProducts={menuProducts}
        recipes={recipes || []}
        onClose={() => setShowEditor(false)}
        onSaved={() => { setShowEditor(false); void loadRecipes(); }}
        notify={notify}
      />}

      {versionsFor && <VersionsModal recipe={versionsFor} onClose={() => setVersionsFor(null)} notify={notify} />}

      {/* Styled delete confirmation */}
      {pendingDelete && (
        <div className="fixed inset-0 z-[200] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => { if (!deleting) setPendingDelete(null); }}>
          <div className="bg-white rounded-3xl shadow-2xl max-w-sm w-full overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 text-center">
              <div className="w-12 h-12 rounded-2xl bg-red-50 flex items-center justify-center mx-auto mb-3">
                <Trash2 className="w-5 h-5 text-red-500" />
              </div>
              <h3 className="text-base font-bold text-gray-900">Delete "{pendingDelete.name}"?</h3>
              <p className="text-xs text-gray-400 mt-1.5 leading-relaxed">
                Draft recipes can be deleted. Active recipes must be archived first — history is never destroyed.
              </p>
              <div className="flex gap-2 mt-5">
                <button
                  onClick={() => setPendingDelete(null)}
                  disabled={deleting}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-[#e1e2ed] text-gray-600 text-xs font-bold hover:bg-gray-50 transition-all cursor-pointer disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void handleDelete()}
                  disabled={deleting}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-red-500 text-white text-xs font-bold hover:bg-red-600 transition-all cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5"
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

// ─── Versions modal ──────────────────────────────────────────────
function VersionsModal({ recipe, onClose, notify }: { recipe: any; onClose: () => void; notify: any }) {
  const versions = recipe.__versions || [];
  return (
    <div className="fixed inset-0 z-[150] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-[#e1e2ed] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <History className="w-5 h-5 text-[var(--brand-color)]" />
            <div>
              <h3 className="text-base font-bold">Version History — {recipe.name}</h3>
              <p className="text-[11px] text-gray-400">Historical snapshots are never overwritten — past sales stay explainable.</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg cursor-pointer"><X className="w-4 h-4 text-gray-400" /></button>
        </div>
        <div className="p-5 space-y-3 max-h-[60vh] overflow-y-auto">
          {versions.length === 0 && <p className="text-sm text-gray-400 text-center py-8">No snapshots yet — versions are created when an active recipe is edited or archived.</p>}
          {versions.map((v: any) => (
            <div key={v._id} className="border border-[#e1e2ed] rounded-2xl p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-black text-[var(--brand-color)]">Version {v.version}</span>
                <span className="text-[10px] text-gray-400">{v.effectiveFrom}{v.effectiveTo ? ` → ${v.effectiveTo}` : ' → now'}</span>
              </div>
              <div className="grid grid-cols-4 gap-2 mb-3">
                {[
                  { label: 'Est. variable cost', value: fmt(v.costSnapshot?.estimatedVariableCost ?? v.costSnapshot?.recipeCost ?? 0) },
                  { label: 'Variable cost %', value: `${v.costSnapshot?.foodCostPercent || 0}%` },
                  { label: 'Contribution', value: fmt(v.costSnapshot?.contribution || 0) },
                  { label: 'Selling price', value: fmt(v.costSnapshot?.sellingPrice || 0) },
                ].map((s) => (
                  <div key={s.label} className="bg-gray-50 rounded-lg px-2.5 py-1.5">
                    <p className="text-[9px] font-bold uppercase tracking-wider text-gray-400">{s.label}</p>
                    <p className="text-xs font-mono font-bold text-gray-800">{s.value}</p>
                  </div>
                ))}
              </div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">Frozen ingredients</p>
              <div className="space-y-1">
                {(v.lines || []).map((l: any, i: number) => (
                  <div key={i} className="flex items-center justify-between text-xs">
                    <span className="text-gray-600">{l.itemName}</span>
                    <span className="font-mono text-gray-500">{l.quantity} {l.unit} × {fmt(l.costPerUnit)} = <span className="font-bold text-gray-800">{fmt(l.lineCost)}</span></span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Editor ──────────────────────────────────────────────────────
function RecipeEditor({
  existing, inventoryItems, menuProducts, recipes, onClose, onSaved, notify,
}: {
  existing: RecipeDoc | null;
  inventoryItems: any[];
  menuProducts: any[];
  recipes: RecipeDoc[];
  onClose: () => void;
  onSaved: () => void;
  notify: any;
}) {
  const [productId, setProductId] = useState(existing?.productId || '');
  const [variantName, setVariantName] = useState(existing?.variantName || '');
  const [name, setName] = useState(existing?.name || '');
  // Lock the auto-default "{product} Recipe" until the user edits the name.
  const [nameTouched, setNameTouched] = useState(!!existing);
  const [yieldQuantity, setYieldQuantity] = useState(existing?.yieldQuantity ?? 1);
  const [yieldUnit, setYieldUnit] = useState(existing?.yieldUnit || 'plate');
  const [servingSize, setServingSize] = useState(existing?.servingSize || 1);
  // Custom (ad-hoc) ingredient rows are added to Inventory on save.
  const [creatingCustom, setCreatingCustom] = useState(false);
  const portions = Math.max(1, Number(servingSize) || Number(yieldQuantity) || 1);
  // Friendly in-dialog banner for save failures (instead of only toasts).
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
    }));
  });
  const [saving, setSaving] = useState(false);

  // Restaurant cost settings for the layered live preview (server is authoritative).
  const [costSettings, setCostSettings] = useState<any | null>(null);
  useEffect(() => {
    let alive = true;
    void fetchCostSettings().then((s) => { if (alive && s) setCostSettings(s); });
    return () => { alive = false; };
  }, []);

  const product = menuProducts.find((p) => p._id === productId);
  const selectedVariant = product?.variants?.find((v: any) => v.name === variantName);
  const sellingPrice = (selectedVariant?.price ?? product?.price) || 0;
  const variantNameStr = variantName.trim() || undefined;

  // Auto-default the recipe name to the backend's own default
  // ("{product} Recipe" / "{product} ({variant}) Recipe") until edited.
  useEffect(() => {
    if (nameTouched || !product) return;
    setName(`${product.name}${variantName ? ` (${variantName})` : ''} Recipe`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, variantName, nameTouched]);

  // Live cost preview (client-side mirror — the server is authoritative).
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
        return { key: c.key, itemName: c.itemName || 'Custom ingredient', quantity: qty, unit: c.unit, cost, costPerUnit: Number(c.customCost) || 0, missing: (Number(c.customCost) || 0) <= 0, custom: true };
      }
      const item = inventoryItems.find((i) => i.id === c.inventoryItemId);
      if (!item) return null;
      const qtyInItemUnit = conv(c.quantity, c.unit, item.unit) * (1 + c.wastagePercent / 100);
      const cost = money(qtyInItemUnit * (item.averageCost || 0));
      direct += cost;
      return { key: c.key, itemName: item.name, quantity: qtyInItemUnit, unit: item.unit, cost, costPerUnit: item.averageCost || 0, missing: (item.averageCost || 0) <= 0 };
    }).filter(Boolean) as any[];

    // Layered model mirror (₹, per portion).
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
    return {
      direct: money(direct), minor, cooking, wastage, packaging, variable, conservative, perServing,
      foodCostPercent, contribution, marginPercent, lines,
    };
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

  const payloadFrom = (rows: ComponentRow[]) => ({
    productId,
    variantName: variantNameStr,
    name: name || undefined,
    yieldQuantity: Number(yieldQuantity) || 1,
    yieldUnit: yieldUnit || 'unit',
    servingSize: Number(servingSize) || undefined,
    components: rows.map((c) => c.componentType === 'sub_recipe'
      ? { componentType: 'sub_recipe', subRecipeId: c.subRecipeId, itemName: c.itemName || 'Sub-recipe', unit: c.unit, quantity: Number(c.quantity) || 0, wastagePercent: Number(c.wastagePercent) || 0, optional: c.optional }
      : { inventoryItemId: c.inventoryItemId, itemName: c.itemName || 'Ingredient', unit: c.unit, quantity: Number(c.quantity) || 0, wastagePercent: Number(c.wastagePercent) || 0, optional: c.optional }),
  });

  // Custom rows must reference a real inventory item (backend requirement).
  // Reuse an existing item with the same name, else create one on save.
  // Failures are collected into the in-dialog banner, not only toasts.
  const resolveCustomItems = async (): Promise<ComponentRow[] | null> => {
    const rows = [...components];
    const problems: string[] = [];
    for (let i = 0; i < rows.length; i++) {
      const c = rows[i];
      if (c.componentType !== 'ingredient' || !c.custom) continue;
      const name = (c.itemName || '').trim();
      if (!name) { problems.push(`Custom ingredient row ${i + 1} is missing a name`); continue; }
      const match = inventoryItems.find((it) => it.name.toLowerCase() === name.toLowerCase());
      if (match) {
        rows[i] = { ...c, inventoryItemId: match.id, itemUnit: match.unit, averageCost: match.averageCost };
        continue;
      }
      try {
        const created = await createProduct({
          name,
          category: 'Uncategorized',
          image: '',
          code: `INV-${Date.now().toString(36).toUpperCase()}${i}`,
          price: 0,
          availability: false,
          currentStock: 0,
          unit: c.unit || 'pcs',
          minStock: 0,
          maxStock: 0,
          reorderLevel: 0,
          averageCost: Number(c.customCost) || 0,
          supplier: '',
        });
        const id = created?._id || created?.id;
        if (!id) { problems.push(`Couldn't add "${name}" to Inventory — check the connection and try again.`); continue; }
        rows[i] = { ...c, inventoryItemId: id, itemUnit: c.unit, averageCost: Number(c.customCost) || 0 };
      } catch (e: any) {
        problems.push(`Couldn't add "${name}" to Inventory: ${e?.response?.data?.error || e?.message || 'server error'}`);
      }
    }
    if (problems.length > 0) {
      setSaveError({
        title: problems.length === 1 ? 'Couldn\u2019t save the custom item' : 'Some custom items couldn\u2019t be saved',
        detail: problems.join(' · '),
      });
      return null;
    }
    return rows;
  };

  const handleSave = async (activate: boolean) => {
    setSaveError(null);
    if (!productId) { setSaveError({ title: 'Pick a product first', detail: 'Choose the menu item this recipe produces before saving.' }); return; }
    if (components.filter((c) => !c.optional).length === 0) { setSaveError({ title: 'Add at least one ingredient', detail: 'A recipe needs at least one ingredient or sub-recipe so it can be costed and consumed.' }); return; }
    setSaving(true);
    setCreatingCustom(true);
    try {
      const rows = await resolveCustomItems();
      if (!rows) return;
      const body = payloadFrom(rows);
      let saved;
      if (existing) saved = await updateRecipe(existing._id, body);
      else saved = await createRecipe({ ...body, status: activate ? 'active' : 'draft' });
      if (!saved) { setSaveError({ title: 'Saved to the offline queue', detail: 'You appear to be offline — the recipe was queued and will sync automatically when the connection is back.' }); return; }
      if (activate && existing && existing.status !== 'active') {
        await activateRecipe(saved._id);
      }
      notify(activate ? 'Recipe saved & activated' : 'Recipe saved as draft', 'success');
      onSaved();
    } catch (e: any) {
      setSaveError({
        title: 'Couldn\u2019t save the recipe',
        detail: e?.message || 'Something went wrong — check the connection and try again.',
      });
    } finally {
      setSaving(false);
      setCreatingCustom(false);
    }
  };

  const hasNameConflict = recipes.some((r) => r.productId === productId && r.status === 'active' && r._id !== existing?._id && (r.variantName || '') === (variantNameStr || ''));

  return (
    <div className="fixed inset-0 z-[150] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-3xl shadow-2xl max-w-5xl w-full max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#e1e2ed] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <ChefHat className="w-5 h-5 text-[var(--brand-color)]" />
            <div>
              <h3 className="text-base font-bold">{existing ? `Edit Recipe — v${existing.version}` : 'New Recipe'}</h3>
              <p className="text-[11px] text-gray-400">Ingredients reference your existing inventory items — no duplicate catalog.</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg cursor-pointer"><X className="w-4 h-4 text-gray-400" /></button>
        </div>

        {/* Friendly save-failure banner — shown instead of only toasts */}
        {saveError && (
          <div className="px-6 py-3 bg-red-50 border-b border-red-200 flex items-start gap-2.5 shrink-0" role="alert">
            <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-red-700">{saveError.title}</p>
              {saveError.detail && <p className="text-[11px] text-red-600 mt-0.5">{saveError.detail}</p>}
            </div>
            <button onClick={() => setSaveError(null)} title="Dismiss" className="p-1 text-red-400 hover:text-red-600 rounded cursor-pointer shrink-0">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-5 grid grid-cols-5 gap-5">
          {/* Left: setup */}
          <div className="col-span-3 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className={product?.variants?.length ? '' : 'col-span-2'}>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">Product (menu item)</label>
                <select value={productId} onChange={(e) => { setProductId(e.target.value); setVariantName(''); setSaveError(null); }} className="w-full px-3 py-2.5 bg-gray-50 border border-[#e1e2ed] rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]/20 cursor-pointer">
                  <option value="">Select product…</option>
                  {menuProducts.map((p) => (
                    <option key={p._id} value={p._id}>
                      {p.name}{recipes.some((r) => r.productId === p._id && r.status === 'active') ? ' (has active recipe)' : ''} — ₹{p.price}
                    </option>
                  ))}
                </select>
                {product && (
                  <p className="mt-1 text-[10px] text-gray-500">
                    Base price <span className="font-mono font-bold text-gray-700">{fmt(product.price)}</span>
                    {product.variants?.length > 0 && ` · ${product.variants.length} variant${product.variants.length === 1 ? '' : 's'}`}
                  </p>
                )}
              </div>
              {product?.variants?.length > 0 && (
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">Variant</label>
                  <select value={variantName} onChange={(e) => { setVariantName(e.target.value); setSaveError(null); }} className="w-full px-3 py-2.5 bg-gray-50 border border-[#e1e2ed] rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]/20 cursor-pointer">
                    <option value="">Base / no variant</option>
                    {(product.variants || []).map((v: any) => (
                      <option key={v._id || v.name} value={v.name}>{v.name} — ₹{v.price}</option>
                    ))}
                    {existing?.variantName && !(product.variants || []).some((v: any) => v.name === existing.variantName) && (
                      <option value={existing.variantName}>{existing.variantName} (saved)</option>
                    )}
                  </select>
                  {selectedVariant && (
                    <p className="mt-1 text-[10px] text-gray-500">Variant price <span className="font-mono font-bold text-gray-700">{fmt(selectedVariant.price)}</span></p>
                  )}
                </div>
              )}
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">Recipe name</label>
              <input value={name} onChange={(e) => { setName(e.target.value); setNameTouched(true); setSaveError(null); }} placeholder={product ? `${product.name}${variantName ? ` (${variantName})` : ''} Recipe` : 'Recipe name'} className="w-full px-3 py-2.5 bg-gray-50 border border-[#e1e2ed] rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]/20" />
              <p className="mt-1 text-[10px] text-gray-400">
                {nameTouched ? 'Custom name — kept as typed.' : product ? `Auto-filled from the product${variantName ? ` (${variantName})` : ''} — edit to change.` : 'Auto-fills from the selected product.'}
              </p>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">Yield (batch size)</label>
                <input type="number" min="0" value={yieldQuantity} onChange={(e) => { setYieldQuantity(Number(e.target.value)); setSaveError(null); }} className="w-full px-3 py-2.5 bg-gray-50 border border-[#e1e2ed] rounded-xl text-xs focus:outline-none" />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">Yield unit</label>
                <select value={yieldUnit} onChange={(e) => { setYieldUnit(e.target.value); setSaveError(null); }} title="Batch size + unit = total recipe output" className="w-full px-3 py-2.5 bg-gray-50 border border-[#e1e2ed] rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]/20 cursor-pointer">
                  {[...new Set([...YIELD_UNITS, yieldUnit])].map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">Portions per batch</label>
                <input type="number" min="1" value={servingSize} onChange={(e) => { setServingSize(Number(e.target.value)); setSaveError(null); }} className="w-full px-3 py-2.5 bg-gray-50 border border-[#e1e2ed] rounded-xl text-xs focus:outline-none" />
              </div>
            </div>
            <p className="text-[10px] text-gray-400 -mt-2">
              <span className="font-semibold text-gray-500">Yield</span> = total output (e.g. 2 kg curry) · <span className="font-semibold text-gray-500">Portions</span> = how many plates that batch serves (e.g. 8). Cost per portion = recipe cost ÷ portions.
            </p>

            {hasNameConflict && (
              <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl text-[11px] text-amber-700">
                <AlertTriangle className="w-4 h-4 shrink-0" /> This product already has an active recipe — saving & activating will archive it automatically.
              </div>
            )}

            {/* AI Quick Create — type or speak how the dish is made */}
            <AiQuickCreate
              productId={productId}
              inventoryItems={inventoryItems}
              disabled={!productId}
              onApply={(rows) => {
                setComponents(rows);
                notify(`Added ${rows.length} ingredient${rows.length === 1 ? '' : 's'} from AI — review & save`, 'success');
              }}
              notify={notify}
            />

            {/* Ingredients */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Ingredients & sub-recipes</label>
                <div className="flex gap-1.5">
                  <button onClick={addIngredient} className="px-2.5 py-1.5 bg-blue-50 text-[var(--brand-color)] rounded-lg text-[10px] font-bold hover:bg-blue-100 transition-all cursor-pointer flex items-center gap-1">
                    <Package className="w-3 h-3" /> Add ingredient
                  </button>
                  <button onClick={addSubRecipe} className="px-2.5 py-1.5 bg-purple-50 text-purple-600 rounded-lg text-[10px] font-bold hover:bg-purple-100 transition-all cursor-pointer flex items-center gap-1">
                    <Layers className="w-3 h-3" /> Add sub-recipe
                  </button>
                </div>
              </div>

              {components.length === 0 && (
                <div className="p-6 text-center border-2 border-dashed border-[#e1e2ed] rounded-2xl">
                  <Package className="w-8 h-8 text-gray-200 mx-auto mb-1.5" />
                  <p className="text-xs text-gray-400">Add the first ingredient — e.g. Paneer 200g. Sub-recipes (like a shared gravy) can be reused across dishes.</p>
                </div>
              )}

              <div className="space-y-2">
                {components.map((c) => {
                  const isSub = c.componentType === 'sub_recipe';
                  const sub = isSub ? recipes.find((r) => r._id === c.subRecipeId) : null;
                  const item = !isSub && !c.custom ? inventoryItems.find((i) => i.id === c.inventoryItemId) : null;
                  return (
                    <div key={c.key} className={`border rounded-xl p-3 ${isSub ? 'border-purple-200 bg-purple-50/30' : 'border-[#e1e2ed] bg-gray-50/40'}`}>
                      {isSub ? (
                        <div className="flex items-center gap-2">
                          <Layers className="w-3.5 h-3.5 text-purple-500 shrink-0" />
                          <select value={c.subRecipeId || ''} onChange={(e) => {
                            const r = recipes.find((x) => x._id === e.target.value);
                            updateRow(c.key, { subRecipeId: e.target.value, itemName: r?.name || '', unit: r?.yieldUnit || 'unit' });
                          }} className="flex-1 px-2.5 py-2 bg-white border border-purple-200 rounded-lg text-xs font-semibold focus:outline-none cursor-pointer">
                            <option value="">Select sub-recipe…</option>
                            {recipes.map((r) => <option key={r._id} value={r._id}>{r.name} ({r.yieldQuantity} {r.yieldUnit})</option>)}
                          </select>
                          <input type="number" min="0" step="any" value={c.quantity} onChange={(e) => updateRow(c.key, { quantity: Number(e.target.value) })} placeholder="Qty"
                            className="w-20 px-2.5 py-2 bg-white border border-[#e1e2ed] rounded-lg text-xs font-mono focus:outline-none text-right" />
                          <span className="w-16 px-2 py-2 text-xs font-mono text-gray-500 text-center" title="Unit follows the sub-recipe's yield unit">{c.unit}</span>
                          <input type="number" min="0" max="100" value={c.wastagePercent} onChange={(e) => updateRow(c.key, { wastagePercent: Number(e.target.value) })} title="Preparation wastage % (trim/cooking loss)"
                            className="w-14 px-1 py-2 bg-white border border-[#e1e2ed] rounded-lg text-[10px] font-mono focus:outline-none text-center" placeholder="Waste%" />
                          <button onClick={() => updateRow(c.key, { optional: !c.optional })} title="Optional component"
                            className={`p-1.5 rounded-lg transition-all cursor-pointer ${c.optional ? 'bg-gray-200 text-gray-600' : 'text-gray-300 hover:text-gray-500'}`}>
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => removeRow(c.key)} className="p-1.5 text-gray-300 hover:text-red-500 rounded-lg transition-all cursor-pointer"><X className="w-3.5 h-3.5" /></button>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-[9px] font-bold uppercase tracking-wider text-gray-400">Type</span>
                            <div className="flex rounded-lg overflow-hidden border border-[#e1e2ed]">
                              <button type="button" onClick={() => updateRow(c.key, { custom: false })} className={`px-2.5 py-1 text-[10px] font-bold cursor-pointer ${!c.custom ? 'bg-[var(--brand-color)] text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}>Inventory item</button>
                              <button type="button" onClick={() => updateRow(c.key, { custom: true })} className={`px-2.5 py-1 text-[10px] font-bold cursor-pointer ${c.custom ? 'bg-[var(--brand-color)] text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}>Custom item</button>
                            </div>
                            <div className="ml-auto flex items-center gap-1.5">
                              <button onClick={() => updateRow(c.key, { optional: !c.optional })} title="Optional component"
                                className={`p-1.5 rounded-lg transition-all cursor-pointer ${c.optional ? 'bg-gray-200 text-gray-600' : 'text-gray-300 hover:text-gray-500'}`}>
                                <Check className="w-3.5 h-3.5" />
                              </button>
                              <button onClick={() => removeRow(c.key)} className="p-1.5 text-gray-300 hover:text-red-500 rounded-lg transition-all cursor-pointer"><X className="w-3.5 h-3.5" /></button>
                            </div>
                          </div>
                          {c.custom ? (
                            <div className="space-y-1.5">
                              <div className="flex items-center gap-2">
                                <input value={c.itemName} onChange={(e) => updateRow(c.key, { itemName: e.target.value })} placeholder="e.g. Secret masala mix (not in inventory)" className="flex-1 px-2.5 py-2 bg-white border border-[#e1e2ed] rounded-lg text-xs font-semibold focus:outline-none" />
                                <input type="number" min="0" step="any" value={c.quantity} onChange={(e) => updateRow(c.key, { quantity: Number(e.target.value) })} placeholder="Qty"
                                  className="w-20 px-2.5 py-2 bg-white border border-[#e1e2ed] rounded-lg text-xs font-mono focus:outline-none text-right" />
                                <select value={c.unit} onChange={(e) => updateRow(c.key, { unit: e.target.value })} className="w-20 px-2 py-2 bg-white border border-[#e1e2ed] rounded-lg text-xs font-mono focus:outline-none cursor-pointer">
                                  {ALL_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                                </select>
                                <input type="number" min="0" step="any" value={c.customCost ?? ''} onChange={(e) => updateRow(c.key, { customCost: Number(e.target.value) })} placeholder="₹/unit" title="Purchase cost per unit"
                                  className="w-20 px-2.5 py-2 bg-white border border-[#e1e2ed] rounded-lg text-xs font-mono focus:outline-none text-right" />
                                <input type="number" min="0" max="100" value={c.wastagePercent} onChange={(e) => updateRow(c.key, { wastagePercent: Number(e.target.value) })} title="Preparation wastage % (trim/cooking loss)"
                                  className="w-14 px-1 py-2 bg-white border border-[#e1e2ed] rounded-lg text-[10px] font-mono focus:outline-none text-center" placeholder="Waste%" />
                              </div>
                              <p className="text-[10px] text-gray-400">Not in inventory yet — it will be added to Inventory on save so it can be consumed &amp; costed.</p>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <IngredientPicker
                                value={c.inventoryItemId}
                                items={inventoryItems}
                                fallback={c.inventoryItemId && !item ? { id: c.inventoryItemId, name: c.itemName || '(deleted item)', unit: c.unit } : null}
                                onSelect={(id) => {
                                  const it = inventoryItems.find((i) => i.id === id);
                                  updateRow(c.key, { inventoryItemId: id, itemName: it?.name || '', unit: it?.unit || 'g', itemUnit: it?.unit, averageCost: it?.averageCost });
                                }}
                                placeholder="Search inventory items…"
                              />
                              <input type="number" min="0" step="any" value={c.quantity} onChange={(e) => updateRow(c.key, { quantity: Number(e.target.value) })} placeholder="Qty"
                                className="w-20 px-2.5 py-2 bg-white border border-[#e1e2ed] rounded-lg text-xs font-mono focus:outline-none text-right" />
                              <select value={c.unit} onChange={(e) => updateRow(c.key, { unit: e.target.value })} title="Unit (same family as the item's own unit)"
                                className="w-20 px-2 py-2 bg-white border border-[#e1e2ed] rounded-lg text-xs font-mono focus:outline-none cursor-pointer">
                                {(() => { const opts = unitOptionsFor(item?.unit); if (c.unit && !opts.includes(c.unit)) opts.unshift(c.unit); return opts; })().map((u) => <option key={u} value={u}>{u}</option>)}
                              </select>
                              <input type="number" min="0" max="100" value={c.wastagePercent} onChange={(e) => updateRow(c.key, { wastagePercent: Number(e.target.value) })} title="Preparation wastage % (trim/cooking loss)"
                                className="w-14 px-1 py-2 bg-white border border-[#e1e2ed] rounded-lg text-[10px] font-mono focus:outline-none text-center" placeholder="Waste%" />
                            </div>
                          )}
                          <div className="flex items-center justify-between mt-1.5 px-0.5">
                            <span className="text-[10px] text-gray-400">
                              {c.custom
                                ? `Cost ₹${Number(c.customCost) || 0}/${c.unit}${(Number(c.customCost) || 0) <= 0 ? ' · ⚠ set a cost' : ''}`
                                : (item ? `Tracked in ${item.unit} · current cost ${fmt(item.averageCost || 0)}/${item.unit}${(item.averageCost || 0) <= 0 ? ' · ⚠ no cost recorded (never purchased)' : ''}` : 'Inventory item')}
                            </span>
                            {c.optional && <span className="text-[9px] font-bold text-gray-400 uppercase">Optional</span>}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right: live cost panel */}
          <div className="col-span-2 space-y-4">
            <div className="bg-gradient-to-br from-[#191b23] to-[#2a2d3d] rounded-2xl p-5 text-white">
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/50 mb-3">Live costing — estimated</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[10px] text-white/50">Selling price</p>
                  <p className="text-lg font-black font-mono">{fmt(sellingPrice)}</p>
                  {selectedVariant && <p className="text-[9px] text-white/40 -mt-0.5">{selectedVariant.name}</p>}
                </div>
                <div>
                  <p className="text-[10px] text-white/50">Estimated variable cost</p>
                  <p className="text-lg font-black font-mono text-amber-300">{fmt(live.variable)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-white/50">Variable cost %</p>
                  <p className={`text-lg font-black font-mono ${live.foodCostPercent > 45 ? 'text-red-400' : live.foodCostPercent > 35 ? 'text-amber-300' : 'text-emerald-300'}`}>{live.foodCostPercent}%</p>
                </div>
                <div>
                  <p className="text-[10px] text-white/50">Estimated contribution</p>
                  <p className={`text-lg font-black font-mono ${live.contribution >= 0 ? 'text-emerald-300' : 'text-red-400'}`}>{fmt(live.contribution)}</p>
                </div>
              </div>
              <div className="mt-3 pt-3 border-t border-white/10">
                <p className="text-[10px] text-white/50">Margin · conservative estimate</p>
                <p className={`text-sm font-black font-mono ${live.marginPercent >= 0 ? 'text-emerald-300' : 'text-red-400'}`}>{live.marginPercent}% {live.marginPercent < 0 && '· loses money'}</p>
                <p className="text-[10px] text-white/40 mt-0.5">Conservative {fmt(live.conservative)} — use for offer safety</p>
                <p className="text-[10px] text-white/40 mt-0.5">Per portion ≈ {fmt(live.perServing)} (variable cost ÷ {portions} portion{portions === 1 ? '' : 's'})</p>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-[#e1e2ed] p-4">
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2">Ingredient breakdown</p>
              {live.lines.length === 0 && <p className="text-xs text-gray-400">Add ingredients to see the breakdown.</p>}
              <div className="space-y-1.5">
                {live.lines.map((l: any) => (
                  <div key={l.key} className="flex items-center justify-between text-xs">
                    <span className="text-gray-600 flex items-center gap-1.5">
                      {l.sub && <Layers className="w-3 h-3 text-purple-400" />}
                      {l.itemName}
                      {l.custom && <span className="text-[8px] font-bold uppercase text-gray-400 border border-gray-200 rounded px-1">custom</span>}
                    </span>
                    <span className="font-mono text-gray-500">
                      {l.sub ? `${l.quantity} ${l.unit}` : `${l.quantity} ${l.unit}`} · <span className={l.missing ? 'text-amber-500 font-bold' : 'font-bold text-gray-800'}>{fmt(l.cost)}</span>
                      {l.missing && ' ⚠'}
                    </span>
                  </div>
                ))}
                <div className="flex items-center justify-between text-xs pt-2 border-t border-[#e1e2ed]">
                  <span className="text-gray-600">Direct ingredients</span>
                  <span className="font-mono font-bold text-gray-800">{fmt(live.direct)}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-600">Minor ingredients</span>
                  <span className="font-mono text-gray-500">{fmt(live.minor)}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-600">Cooking allowance</span>
                  <span className="font-mono text-gray-500">{fmt(live.cooking)}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-600">Wastage</span>
                  <span className="font-mono text-gray-500">{fmt(live.wastage)}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-600">Packaging (dine-in)</span>
                  <span className="font-mono text-gray-500">{fmt(live.packaging)}</span>
                </div>
                <div className="flex items-center justify-between text-sm pt-2 border-t border-[#e1e2ed]">
                  <span className="font-bold text-gray-800">Estimated variable cost</span>
                  <span className="font-black font-mono text-[var(--brand-color)]">{fmt(live.variable)}</span>
                </div>
              </div>
            </div>

            <p className="text-[10px] text-gray-400 leading-relaxed">
              An estimate from your inventory's weighted-average purchase costs plus configured allowances — not an exact number. When this recipe is active, every bill selling this product consumes these ingredients automatically.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[#e1e2ed] flex items-center justify-end gap-2 shrink-0">
          <button onClick={onClose} className="px-4 py-2 rounded-xl border border-[#e1e2ed] text-gray-600 text-xs font-bold hover:bg-gray-50 transition-all cursor-pointer">Cancel</button>
          <button onClick={() => handleSave(false)} disabled={saving || creatingCustom} className="px-4 py-2 rounded-xl bg-gray-800 text-white text-xs font-bold hover:bg-gray-900 transition-all cursor-pointer disabled:opacity-50 flex items-center gap-1.5">
            {saving || creatingCustom ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Archive className="w-3.5 h-3.5" />} Save Draft
          </button>
          <button onClick={() => handleSave(true)} disabled={saving || creatingCustom} className="px-4 py-2 rounded-xl bg-[var(--brand-color)] text-white text-xs font-bold hover:bg-[#003ea8] transition-all cursor-pointer disabled:opacity-50 flex items-center gap-1.5">
            {saving || creatingCustom ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />} Save & Activate
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Searchable ingredient picker (large catalogs) ────────────────
// Replaces a plain <select>: type to filter inventory items by name,
// arrow keys + Enter to pick, Escape/click-outside to close. Selecting
// keeps the same cost/unit auto-fill contract as the old dropdown.
function IngredientPicker({
  value, items, fallback, onSelect, placeholder,
}: {
  value?: string;
  items: any[];
  /** Current row's saved item when it no longer exists in the catalog (round-trip). */
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

  // Show the selected item's name when not actively searching.
  useEffect(() => {
    if (!open) setQuery(selected?.name || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, open]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => setHighlight(0), [query]);

  const choose = (id: string, name: string) => {
    onSelect(id);
    setQuery(name);
    setOpen(false);
  };

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
        className="w-full pl-8 pr-7 py-2 bg-white border border-[#e1e2ed] rounded-lg text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]/20 cursor-text"
      />
      <ChevronDown className={`absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none transition-transform ${open ? 'rotate-180 text-[var(--brand-color)]' : 'text-gray-300'}`} />
      {open && filtered.length > 0 && (
        <div className="absolute left-0 right-0 top-full mt-1 z-30 max-h-52 overflow-y-auto bg-white border border-[#e1e2ed] rounded-lg shadow-xl">
          {filtered.map((i, idx) => (
            <button
              key={i.id}
              type="button"
              onMouseEnter={() => setHighlight(idx)}
              onClick={() => choose(i.id, i.name)}
              className={`w-full px-2.5 py-2 text-left flex items-center justify-between gap-2 cursor-pointer ${idx === highlight ? 'bg-blue-50' : 'bg-white hover:bg-gray-50'}`}
            >
              <span className="text-xs font-semibold text-gray-700 truncate">{i.name}</span>
              <span className="text-[10px] font-mono text-gray-400 shrink-0">{i.unit} · ₹{i.averageCost || 0}</span>
            </button>
          ))}
        </div>
      )}
      {open && query.trim() && filtered.length === 0 && (
        <div className="absolute left-0 right-0 top-full mt-1 z-30 bg-white border border-[#e1e2ed] rounded-lg shadow-xl px-3 py-2 text-[11px] text-gray-400">
          No inventory items match “{query}”.
        </div>
      )}
    </div>
  );
}

// ─── AI Quick Create — type or speak how the dish is made ─────────
// The LLM extracts STRUCTURE ONLY. Every ingredient is then matched
// against this restaurant's own inventory with an explicit confidence
// level, and nothing is added until the user reviews & confirms. All
// money math happens in the deterministic cost engine, never in the AI.
interface AiDraftRow {
  ingredientText: string;
  quantity: number;
  unit: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  inventoryItemId?: string;
  itemName?: string;
  itemUnit?: string;
  costPreview?: number;
  unitMismatch?: boolean;
  missingCost?: boolean;
  reason?: string;
}

function AiQuickCreate({
  productId, inventoryItems, disabled, onApply, notify,
}: {
  productId: string;
  inventoryItems: any[];
  disabled: boolean;
  onApply: (rows: ComponentRow[]) => void;
  notify: any;
}) {
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<{ matched: AiDraftRow[]; needsAttention: AiDraftRow[]; warnings: string[]; aiUnavailable?: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  // Per-row resolution: ingredientText → { inventoryItemId, itemName, itemUnit, averageCost }
  const [resolved, setResolved] = useState<Record<string, any>>({});
  // Search results shown while resolving a row (keyed by ingredientText).
  const [searchHits, setSearchHits] = useState<Record<string, any[]>>({});
  const [searching, setSearching] = useState<Record<string, boolean>>({});
  // Per-row quantity/unit overrides.
  const [qtyEdit, setQtyEdit] = useState<Record<string, number>>({});
  const [unitEdit, setUnitEdit] = useState<Record<string, string>>({});
  // Rows the user unchecked (HIGH matches can be skipped).
  const [skipped, setSkipped] = useState<Record<string, boolean>>({});
  const recRef = useRef<any>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioCtxRef = useRef<any>(null);
  const analyserRef = useRef<any>(null);
  const timerRef = useRef<number | null>(null);
  const recordStartRef = useRef(0);
  const silenceStartRef = useRef<number | null>(null);

  // Cleanup on unmount so an abandoned recording can never keep running.
  useEffect(() => {
    return () => {
      if (recRef.current) recRef.current.abort();
      if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
      try { audioCtxRef.current?.close(); } catch { /* ignore */ }
    };
  }, []);

  const allRows = useMemo(() => [...(draft?.matched || []), ...(draft?.needsAttention || [])], [draft]);

  const extract = useCallback(async (input: string) => {
    const trimmed = (input || '').trim();
    if (!trimmed || !productId) return;
    setLoading(true);
    setError(null);
    setDraft(null);
    setResolved({});
    setSearchHits({});
    setSkipped({});
    setQtyEdit({});
    setUnitEdit({});
    try {
      const res = await recipeAiQuickCreate(productId, trimmed);
      if (!res) { setError('Could not reach the AI service — check the connection and try again.'); return; }
      setDraft(res);
    } catch (e: any) {
      setError(e?.message || 'AI extraction failed — add ingredients manually.');
    } finally {
      setLoading(false);
    }
  }, [productId]);

  const stopMic = useCallback(() => {
    if (recRef.current) { recRef.current.abort(); recRef.current = null; }
    if (timerRef.current !== null) { window.clearInterval(timerRef.current); timerRef.current = null; }
    try { audioCtxRef.current?.close(); } catch { /* ignore */ }
    audioCtxRef.current = null;
    analyserRef.current = null;
    silenceStartRef.current = null;
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') rec.stop();
    recorderRef.current = null;
    setRecording(false);
  }, []);

  const blobToBase64 = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

  // MediaRecorder → backend Groq Whisper (Electron / no Web Speech API).
  const startMediaRecording = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      notify('Microphone not available in this browser — type the ingredients instead.', 'warning');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']
        .find((t) => MediaRecorder.isTypeSupported(t)) || '';
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = [];
      const start = Date.now();
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        try { audioCtxRef.current?.close(); } catch { /* ignore */ }
        audioCtxRef.current = null;
        analyserRef.current = null;
        if (timerRef.current !== null) { window.clearInterval(timerRef.current); timerRef.current = null; }
        silenceStartRef.current = null;
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        setRecording(false);
        // Near-empty clip (silence) — never bill the STT provider.
        if (blob.size < 8000) { setError('No speech detected — type the ingredients instead.'); return; }
        setTranscribing(true);
        try {
          const { data } = await apiClient.post('/voice-inventory/transcribe', {
            audio: await blobToBase64(blob),
            audioMimeType: blob.type || 'audio/webm',
            language: 'hi-en',
          });
          const transcript = data?.transcript;
          if (!data?.success || !transcript) throw new Error(data?.error || 'No speech detected');
          setText(transcript);
          void extract(transcript);
        } catch (e: any) {
          setError(e?.response?.data?.error || e?.message || 'Transcription failed — type the ingredients instead.');
        } finally {
          setTranscribing(false);
        }
      };
      recorder.onerror = () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        notify('Recording failed — type the ingredients instead.', 'warning');
      };
      recorderRef.current = recorder;
      chunksRef.current = chunks;
      recorder.start();
      setRecording(true);
      setError(null);
      recordStartRef.current = Date.now();
      silenceStartRef.current = null;
      try {
        const Ctx: any = window.AudioContext || (window as any).webkitAudioContext;
        if (Ctx) {
          const ctx = new Ctx();
          const src = ctx.createMediaStreamSource(stream);
          const an = ctx.createAnalyser();
          an.fftSize = 1024;
          src.connect(an);
          audioCtxRef.current = ctx;
          analyserRef.current = an;
        }
      } catch { /* silence detection unavailable — hard cap still applies */ }
      timerRef.current = window.setInterval(() => {
        // Hard cap: 20s.
        if (Date.now() - recordStartRef.current >= 20000) { stopMic(); return; }
        const an = analyserRef.current;
        if (!an) return;
        const buf = new Float32Array(an.fftSize);
        an.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        if (Math.sqrt(sum / buf.length) < 0.004) {
          if (silenceStartRef.current === null) silenceStartRef.current = Date.now();
          else if (Date.now() - silenceStartRef.current >= 2500) { stopMic(); setError('No speech detected — mic stopped automatically.'); }
        } else {
          silenceStartRef.current = null;
        }
      }, 250);
    } catch (e: any) {
      setRecording(false);
      notify(`Microphone access denied (${e?.name || e?.message || 'unknown'}) — type the ingredients instead.`, 'warning');
    }
  }, [notify, stopMic, extract]);

  // Web Speech API where available (Chrome / Android / desktop) — the cheap path.
  const startListening = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR || (window as any).electronAPI) { startMediaRecording(); return; }
    const rec = new SR();
    rec.lang = 'hi-IN';
    rec.interimResults = false;
    rec.maxAlternatives = 3;
    rec.onresult = (e: any) => {
      let transcript = '';
      for (let i = e.resultIndex; i < e.results.length; i++) transcript += e.results[i][0].transcript;
      setText(transcript);
      setRecording(false);
      void extract(transcript);
    };
    rec.onerror = (e: any) => {
      setRecording(false);
      if (e?.error === 'no-speech') { setError('No speech detected — type the ingredients instead.'); return; }
      if (e?.error === 'not-allowed' || e?.error === 'service-not-allowed' || e?.error === 'network') {
        startMediaRecording();
        return;
      }
      setError('Voice input failed — type the ingredients instead.');
    };
    rec.onend = () => setRecording(false);
    recRef.current = rec;
    rec.start();
    setRecording(true);
    setError(null);
  }, [startMediaRecording, extract]);

  const resolveRow = async (ingredientText: string, query: string) => {
    if (!query.trim()) return;
    setSearching((s) => ({ ...s, [ingredientText]: true }));
    try {
      const hits = await recipeAiSearchInventory(query);
      setSearchHits((h) => ({ ...h, [ingredientText]: hits || [] }));
    } finally {
      setSearching((s) => ({ ...s, [ingredientText]: false }));
    }
  };

  const apply = () => {
    const rows: ComponentRow[] = [];
    const skippedNames: string[] = [];
    for (const r of allRows) {
      if (skipped[r.ingredientText]) continue;
      const pick = resolved[r.ingredientText] ||
        (r.inventoryItemId ? { inventoryItemId: r.inventoryItemId, itemName: r.itemName, itemUnit: r.itemUnit, averageCost: 0 } : null);
      if (!pick?.inventoryItemId) { skippedNames.push(r.ingredientText); continue; }
      const qty = qtyEdit[r.ingredientText] ?? r.quantity;
      const unit = unitEdit[r.ingredientText] ?? r.unit;
      // Convert to the item's own unit so the backend unit validation always passes.
      const converted = conv(qty, unit, pick.itemUnit || unit);
      rows.push({
        key: `ai${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        inventoryItemId: pick.inventoryItemId,
        itemName: pick.itemName || r.itemName || r.ingredientText,
        quantity: converted > 0 ? converted : qty,
        unit: pick.itemUnit || unit,
        componentType: 'ingredient',
        wastagePercent: 0,
        optional: false,
        itemUnit: pick.itemUnit,
        averageCost: pick.averageCost,
      });
    }
    if (rows.length === 0) {
      notify('Resolve at least one ingredient before adding', 'warning');
      return;
    }
    if (skippedNames.length > 0) {
      notify(`Skipped: ${skippedNames.join(', ')}`, 'warning');
    }
    onApply(rows);
    setDraft(null);
    setText('');
  };

  if (disabled) {
    return (
      <div className="p-3 bg-gray-50 border border-dashed border-[#e1e2ed] rounded-2xl text-[11px] text-gray-400">
        Select a product above, then say or type how the dish is made — e.g. "200g paneer, 150g tomato, 30g butter" — and AI will map it to your inventory.
      </div>
    );
  }

  return (
    <div className="border border-indigo-100 bg-gradient-to-br from-indigo-50/60 to-white rounded-2xl p-4">
      {/* Input row */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Sparkles className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-indigo-400" />
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void extract(text); }}
            placeholder="How is this dish made? e.g. 200g paneer, 150g tomato, 30g butter, 40ml cream"
            className="w-full pl-9 pr-3 py-2.5 bg-white border border-indigo-100 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-indigo-300/40"
          />
        </div>
        <button
          onClick={() => (recording ? stopMic() : startListening())}
          disabled={transcribing}
          title={recording ? 'Stop recording' : 'Speak the ingredients (Hinglish OK)'}
          className={`p-2.5 rounded-xl transition-all cursor-pointer disabled:opacity-50 ${recording ? 'bg-red-500 text-white animate-pulse' : 'bg-indigo-100 text-indigo-600 hover:bg-indigo-200'}`}
        >
          {transcribing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mic className="w-4 h-4" />}
        </button>
        <button
          onClick={() => void extract(text)}
          disabled={!text.trim() || loading}
          className="px-3.5 py-2.5 bg-indigo-600 text-white rounded-xl text-[11px] font-bold hover:bg-indigo-700 transition-all cursor-pointer disabled:opacity-40 flex items-center gap-1.5 shadow-sm"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          {loading ? 'Extracting…' : 'Extract with AI'}
        </button>
      </div>
      <p className="text-[10px] text-gray-400 mt-1.5">
        AI reads the ingredients and matches them to your inventory — you confirm before anything is added. Prices always come from your own purchase costs.
      </p>

      {/* Loading skeleton */}
      {loading && (
        <div className="mt-3 space-y-2 animate-pulse">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="w-6 h-6 rounded-lg bg-indigo-100" />
              <div className="h-3 flex-1 rounded bg-gray-100" />
              <div className="w-16 h-3 rounded bg-gray-100" />
            </div>
          ))}
        </div>
      )}

      {error && !loading && (
        <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
          <p className="text-[11px] text-red-700">{error}</p>
        </div>
      )}

      {draft && !loading && (
        <div className="mt-3 space-y-2">
          {draft.aiUnavailable && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-[11px] text-amber-700 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>AI is unavailable right now — add the ingredients manually below instead.</span>
            </div>
          )}

          {draft.warnings.length > 0 && !draft.aiUnavailable && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-1">
              {draft.warnings.map((w, i) => (
                <p key={i} className="text-[11px] text-amber-700 flex items-start gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {w}
                </p>
              ))}
            </div>
          )}

          {/* HIGH confidence — pre-selected */}
          {(draft.matched || []).map((r) => (
            <div key={r.ingredientText} className={`flex items-center gap-2.5 p-2.5 rounded-xl border ${skipped[r.ingredientText] ? 'border-gray-100 bg-gray-50 opacity-60' : 'border-emerald-200 bg-emerald-50/50'}`}>
              <button
                onClick={() => setSkipped((s) => ({ ...s, [r.ingredientText]: !s[r.ingredientText] }))}
                className={`w-5 h-5 rounded-md flex items-center justify-center cursor-pointer shrink-0 ${skipped[r.ingredientText] ? 'bg-gray-200' : 'bg-emerald-500 text-white'}`}
                title={skipped[r.ingredientText] ? 'Include' : 'Skip'}
              >
                <Check className="w-3.5 h-3.5" />
              </button>
              <span className="text-xs font-bold text-gray-800 flex-1">{r.itemName}</span>
              <span className="text-[10px] text-gray-400">"{r.ingredientText}"</span>
              <span className="text-xs font-mono text-gray-600">{qtyEdit[r.ingredientText] ?? r.quantity} {unitEdit[r.ingredientText] ?? r.unit}</span>
              <span className="text-xs font-mono font-bold text-emerald-700">{fmt(r.costPreview || 0)}</span>
              {r.missingCost && <span className="text-[9px] font-bold text-amber-600">no cost</span>}
            </div>
          ))}

          {/* MEDIUM / LOW / unit-mismatch — needs confirmation */}
          {(draft.needsAttention || []).map((r) => (
            <div key={r.ingredientText} className="p-2.5 rounded-xl border border-amber-200 bg-amber-50/40 space-y-2">
              <div className="flex items-center gap-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-gray-800 truncate">"{r.ingredientText}"</p>
                  <p className="text-[10px] text-amber-700">{r.reason || 'Confirm this ingredient'}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={resolved[r.ingredientText]?.inventoryItemId || (r.unitMismatch ? '' : r.inventoryItemId) || ''}
                  onChange={(e) => {
                    const id = e.target.value;
                    if (!id) { setResolved((s) => ({ ...s, [r.ingredientText]: null })); return; }
                    const it = [...inventoryItems, ...(searchHits[r.ingredientText] || [])]
                      .find((i) => String(i.id || i._id) === id);
                    setResolved((s) => ({ ...s, [r.ingredientText]: { inventoryItemId: id, itemName: it?.name, itemUnit: it?.unit, averageCost: it?.averageCost } }));
                  }}
                  className="flex-1 px-2.5 py-2 bg-white border border-amber-200 rounded-lg text-xs font-semibold focus:outline-none cursor-pointer"
                >
                  <option value="">Select inventory item…</option>
                  {inventoryItems.map((i) => (
                    <option key={i.id} value={i.id}>{i.name} ({i.unit} · ₹{i.averageCost || 0})</option>
                  ))}
                  {(searchHits[r.ingredientText] || []).filter((h) => !inventoryItems.some((i) => String(i.id) === String(h._id || h.id))).map((h) => (
                    <option key={h._id || h.id} value={h._id || h.id}>{h.name} ({h.unit} · ₹{h.averageCost || 0})</option>
                  ))}
                </select>
                <input
                  value={qtyEdit[r.ingredientText] ?? r.quantity}
                  onChange={(e) => setQtyEdit((s) => ({ ...s, [r.ingredientText]: Number(e.target.value) }))}
                  type="number" min="0" step="any"
                  className="w-20 px-2 py-2 bg-white border border-amber-200 rounded-lg text-xs font-mono text-right focus:outline-none"
                />
                <input
                  value={unitEdit[r.ingredientText] ?? r.unit}
                  onChange={(e) => setUnitEdit((s) => ({ ...s, [r.ingredientText]: e.target.value }))}
                  className="w-16 px-2 py-2 bg-white border border-amber-200 rounded-lg text-xs font-mono focus:outline-none"
                />
                <button
                  onClick={() => void resolveRow(r.ingredientText, r.ingredientText)}
                  disabled={searching[r.ingredientText]}
                  className="p-2 bg-white border border-amber-200 rounded-lg text-amber-600 hover:bg-amber-100 transition-all cursor-pointer disabled:opacity-50"
                  title="Search inventory for this item"
                >
                  {searching[r.ingredientText] ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          ))}

          {allRows.length > 0 && (
            <div className="flex justify-end pt-1">
              <button
                onClick={apply}
                className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-[11px] font-bold hover:bg-emerald-700 transition-all cursor-pointer flex items-center gap-1.5 shadow-sm"
              >
                <Check className="w-3.5 h-3.5" /> Add {allRows.filter((r) => !skipped[r.ingredientText]).length} to recipe
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
