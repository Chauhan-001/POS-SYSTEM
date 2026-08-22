/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * RecipeEditor — the variant-aware Recipe Editor (redesigned).
 *
 * The core invariant: the editor edits ONE variant at a time, and every
 * operation is scoped to the currently selected variant.
 *
 *   - All variants + their recipe status are visible in a side panel — the
 *     selected variant is always obvious ("RECIPE FOR: HALF").
 *   - Switching variants RELOADS that variant's own components (or clears to
 *     empty when it has no recipe) — stale ingredients from another variant
 *     are never shown or saved.
 *   - Save Draft / Save & Activate target exactly the selected variant's
 *     recipe document (create when none exists), never another variant's.
 *   - "Copy from another variant" deep-clones the source's ingredients into
 *     the CURRENT variant and keeps the editor open; it is saved (as a draft
 *     unless activated) by the normal Save flow — never auto-activated.
 *   - Delete targets only the selected variant's recipe.
 *
 * All pure state transitions live in ./recipeEditorLogic.ts (unit-tested).
 */

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  X, Check, AlertTriangle, Copy, Search, Loader2, ChefHat, Mic, Trash2,
  ArrowLeftRight, Sparkles,
} from 'lucide-react';
import RecipeInputStep, { type RecipeRow, type RecipeMode } from '../../menu/RecipeInputStep';
import {
  fetchCostSettings, createRecipe, updateRecipe, activateRecipe,
  recipeAiQuickCreate, recipeAiSearchInventory, createProduct,
} from '../../../src/api/client';
import apiClient from '../../../src/api/axios';
import { conv, unitOptionsFor } from '../../../src/utils/units';
import {
  type EditorRecipe,
  type EditorVariant,
  type EditorVariantStatus,
  DEFAULT_VARIANT,
  cloneComponents,
  deriveVariantStatus,
  targetRecipeFor,
  payloadFrom,
} from './recipeEditorLogic';

// ─── Client-side money helpers (mirror the backend engine; server is truth) ──
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

interface Props {
  existing: EditorRecipe | null;
  initialProduct: any | null;
  inventoryItems: any[];
  menuProducts: any[];
  recipes: EditorRecipe[];
  onClose: () => void;
  onSaved: () => void;
  onDelete: (r: EditorRecipe) => void;
  notify: any;
}

const toRow = (c: any, i: number): ComponentRow => ({
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
});

// A product has real variants when it has a variant list or references a
// variant template. Such products NEVER use the virtual 'Default' recipe —
// only products without variants do.
const productHasVariants = (p: any): boolean =>
  (Array.isArray(p?.variants) && p.variants.length > 0)
  || (Array.isArray(p?.menuConfig?.variantConfigurations) && p.menuConfig.variantConfigurations.length > 0);

export default function RecipeEditor({
  existing, initialProduct, inventoryItems, menuProducts, recipes,
  onClose, onSaved, onDelete, notify,
}: Props) {
  const [productId, setProductId] = useState(existing?.productId || initialProduct?._id || '');
  // '' === the product's BASE recipe. Selected variant drives EVERYTHING.
  const [selectedVariant, setSelectedVariant] = useState(existing?.variantName || '');
  const [recipeForVariant, setRecipeForVariant] = useState<EditorRecipe | null>(existing);
  const [name, setName] = useState(existing?.name || '');
  const [nameTouched, setNameTouched] = useState(!!existing);
  const [creatingCustom, setCreatingCustom] = useState(false);
  const [saveError, setSaveError] = useState<{ title: string; detail: string } | null>(null);
  const [components, setComponents] = useState<ComponentRow[]>(() => {
    if (!existing) return [];
    return (existing.components || []).map(toRow);
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
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const recorderRef = useRef<any>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  // Copy from another variant
  const [copyFromOpen, setCopyFromOpen] = useState(false);
  const [copyFromLoading, setCopyFromLoading] = useState(false);

  // ── Quick-add pickers (inventory item / copy from other recipe) ──
  const [pickerOpen, setPickerOpen] = useState<'inventory' | 'sub_recipe' | null>(null);
  const [pickerSearch, setPickerSearch] = useState('');
  const [pickerSelection, setPickerSelection] = useState<any>(null);
  const [pickerVariant, setPickerVariant] = useState<any>(null);
  const [pickerQty, setPickerQty] = useState(1);
  const [pickerUnit, setPickerUnit] = useState('');

  const openPicker = (kind: 'inventory' | 'sub_recipe') => {
    setPickerOpen(kind);
    setPickerSearch('');
    setPickerSelection(null);
    setPickerVariant(null);
    setPickerQty(1);
    setPickerUnit('');
    setSaveError(null);
  };

  const confirmAddInventory = () => {
    if (!pickerSelection) return;
    const item = pickerSelection;
    const unit = pickerUnit || item.unit || 'g';
    const avgCost = Number(item.averageCost) || 0;
    const itemId = item.id || item._id;
    if (!itemId) return;
    setComponents((prev) => [...prev, {
      key: `${itemId}_${Date.now().toString(36)}`,
      inventoryItemId: itemId,
      itemName: item.name,
      quantity: Math.max(0, Number(pickerQty) || 0),
      unit,
      componentType: 'ingredient',
      wastagePercent: 0,
      optional: false,
      itemUnit: item.unit || unit,
      averageCost: avgCost,
      custom: false,
    }]);
    setPickerOpen(null);
  };

  // Flatten a recipe (and any nested sub-recipes) into plain ingredient rows.
  const flattenRecipeComponents = (source: EditorRecipe, visited: Set<string> = new Set(), scale = 1): ComponentRow[] => {
    if (!source || visited.has(source._id)) return [];
    visited.add(source._id);
    const out: ComponentRow[] = [];
    for (const c of source.components || []) {
      if (c.componentType === 'sub_recipe' && c.subRecipeId) {
        const sub = recipes.find((r) => r._id === c.subRecipeId);
        if (sub) {
          const subScale = sub.yieldQuantity > 0 ? (Number(c.quantity) || 0) / sub.yieldQuantity : 1;
          for (const nested of flattenRecipeComponents(sub, visited, scale * subScale)) out.push(nested);
        }
        continue;
      }
      if (!c.inventoryItemId) continue;
      const row = toRow(c, out.length);
      out.push({ ...row, quantity: money((Number(row.quantity) || 0) * scale) });
    }
    return out;
  };

  const confirmAddSubRecipe = () => {
    if (!pickerSelection || !pickerVariant) return;
    const source: EditorRecipe = pickerVariant;
    const sourceLabel = `${pickerSelection.product?.name || ''}${source.variantName && source.variantName !== DEFAULT_VARIANT ? ` (${source.variantName})` : ''}`.trim();
    const incoming = flattenRecipeComponents(source);
    if (incoming.length === 0) {
      setSaveError({ title: 'Nothing to copy', detail: `${sourceLabel} has no ingredients yet.` });
      return;
    }
    let overridden = 0;
    for (const inc of incoming) {
      if (components.some((c) => c.componentType === 'ingredient' && c.inventoryItemId && c.inventoryItemId === inc.inventoryItemId)) overridden += 1;
    }
    setComponents((prev) => {
      const next = [...prev];
      for (const inc of incoming) {
        const existingIdx = next.findIndex((c) => c.componentType === 'ingredient' && c.inventoryItemId && c.inventoryItemId === inc.inventoryItemId);
        if (existingIdx >= 0) {
          const existing = next[existingIdx];
          const convertedQty = inc.unit && existing.unit ? conv(inc.quantity, inc.unit, existing.unit) : 0;
          next[existingIdx] = {
            ...existing,
            itemName: inc.itemName,
            quantity: convertedQty > 0 ? convertedQty : inc.quantity,
            unit: existing.unit,
            itemUnit: inc.itemUnit || existing.itemUnit,
            averageCost: inc.averageCost ?? existing.averageCost,
            wastagePercent: inc.wastagePercent,
            optional: inc.optional,
          };
        } else {
          next.push({ ...inc, key: `k${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}` });
        }
      }
      return next;
    });
    setPickerOpen(null);
    notify(`Copied ${incoming.length} ingredient${incoming.length === 1 ? '' : 's'} from ${sourceLabel}${overridden > 0 ? ` — ${overridden} overridden` : ''}`, 'success');
  };

  // Menu products (other than the one being edited) that have at least one
  // copyable recipe. Products WITH variants contribute only variant-level
  // recipes (never 'Default'); products WITHOUT variants contribute the
  // virtual 'Default' recipe only.
  const subRecipeProducts = useMemo(() => {
    const byProduct = new Map<string, { product: any; recipes: EditorRecipe[] }>();
    for (const r of recipes || []) {
      if (r.isDeleted || r.status === 'archived') continue;
      if (String(r.productId) === String(productId)) continue;
      const p = menuProducts.find((m) => String(m._id) === String(r.productId));
      if (!p) continue;
      const name = (r.variantName || '').trim();
      const allowed = productHasVariants(p)
        ? (name !== '' && name !== DEFAULT_VARIANT)
        : (name === '' || name === DEFAULT_VARIANT);
      if (!allowed) continue;
      let entry = byProduct.get(String(r.productId));
      if (!entry) { entry = { product: p, recipes: [] }; byProduct.set(String(r.productId), entry); }
      entry.recipes.push(r);
    }
    return [...byProduct.values()];
  }, [recipes, menuProducts, productId]);

  const pickerSearchQ = pickerSearch.trim().toLowerCase();
  const presentInventoryIds = useMemo(() => {
    const set = new Set<string>();
    for (const c of components) {
      if (c.componentType === 'ingredient' && c.inventoryItemId) set.add(String(c.inventoryItemId));
    }
    return set;
  }, [components]);

  const filteredInventoryItems = useMemo(
    () => inventoryItems.filter((i) => {
      const id = String(i.id || i._id || '');
      if (id && presentInventoryIds.has(id)) return false;
      return !pickerSearchQ || String(i.name || '').toLowerCase().includes(pickerSearchQ);
    }),
    [inventoryItems, pickerSearchQ, presentInventoryIds]
  );

  const filteredSubRecipeProducts = useMemo(
    () => subRecipeProducts.filter((e) =>
      !pickerSearchQ
      || String(e.product.name || '').toLowerCase().includes(pickerSearchQ)
      || e.recipes.some((r) => String(r.name || '').toLowerCase().includes(pickerSearchQ))
    ),
    [subRecipeProducts, pickerSearchQ]
  );

  const filteredPickerVariants = useMemo(() => {
    const list = pickerSelection?.recipes || [];
    return list.filter((r) =>
      !pickerSearchQ
      || String(r.variantName || DEFAULT_VARIANT).toLowerCase().includes(pickerSearchQ)
      || String(r.name || '').toLowerCase().includes(pickerSearchQ)
    );
  }, [pickerSelection, pickerSearchQ]);

  const [costSettings, setCostSettings] = useState<any | null>(null);
  useEffect(() => {
    let alive = true;
    void fetchCostSettings().then((s) => { if (alive && s) setCostSettings(s); });
    return () => { alive = false; };
  }, []);

  // Resolved menu-config (variant groups) for the product.
  const [resolvedConfig, setResolvedConfig] = useState<any>(null);
  useEffect(() => {
    if (!productId) { setResolvedConfig(null); return; }
    let alive = true;
    void apiClient.get(`/menu-config/products/${productId}/resolve`).then((r: any) => {
      const payload = r?.data?.data ?? r?.data;
      if (alive && payload) setResolvedConfig(payload);
    }).catch(() => {});
    return () => { alive = false; };
  }, [productId]);

  const product = menuProducts.find((p) => p._id === productId) || initialProduct || null;

  // Merge variant sources: ProductVariant collection + menuConfig variant groups.
  const effectiveVariants = useMemo<EditorVariant[]>(() => {
    const fromProductVariant: EditorVariant[] =
      (product?.variants || []).map((v: any) => ({ name: v.name, price: Number(v.price) || 0 }));
    const fromMenuConfig: EditorVariant[] = [];
    if (resolvedConfig?.variantGroups) {
      for (const group of resolvedConfig.variantGroups) {
        for (const opt of group.options || []) {
          if (opt.active !== false) {
            fromMenuConfig.push({
              name: opt.name,
              price: (product?.price || 0) + Number(opt.priceDelta || 0),
            });
          }
        }
      }
    }
    const seen = new Set<string>();
    const merged: EditorVariant[] = [];
    for (const v of [...fromProductVariant, ...fromMenuConfig]) {
      if (seen.has(v.name)) continue;
      seen.add(v.name);
      merged.push(v);
    }
    return merged;
  }, [product, resolvedConfig]);

  const selectedVariantPrice = effectiveVariants.find((v) => v.name === selectedVariant)?.price;
  const sellingPrice = (selectedVariantPrice ?? product?.price) || 0;

  // Auto-select the lowest-cost variant ONCE when CREATING a recipe for a
  // product with variants. Products without variants get the virtual 'Default'
  // variant. A ref (not `selectedVariant` in deps) guarantees an explicit
  // selection is never overridden by re-running the effect.
  const autoSelectedRef = useRef(false);
  useEffect(() => {
    if (existing || autoSelectedRef.current) return;
    autoSelectedRef.current = true;
    if (effectiveVariants.length === 0) {
      if (selectedVariant !== DEFAULT_VARIANT) switchVariant(DEFAULT_VARIANT);
      return;
    }
    if (selectedVariant) return;
    const lowest = effectiveVariants.reduce((min, v) => (v.price || 0) < (min.price || 0) ? v : min);
    switchVariant(lowest.name);
  }, [effectiveVariants, existing]);

  // Side-panel rows: every variant, each with its REAL backend recipe status.
  // Products without variants expose the virtual 'Default' variant. There is
  // NO base recipe row.
  const panelVariants = useMemo<EditorVariantStatus[]>(() => {
    if (effectiveVariants.length === 0) {
      const vr = recipes.find(
        (r) => r.productId === productId && (r.variantName || '') === DEFAULT_VARIANT && r.status !== 'archived'
      ) || null;
      return [{ name: DEFAULT_VARIANT, price: product?.price || 0, status: deriveVariantStatus(vr), recipeId: vr?._id }];
    }
    const rows: EditorVariantStatus[] = [];
    for (const v of effectiveVariants) {
      const vr = recipes.find((r) => r.productId === productId && (r.variantName || '') === v.name && r.status !== 'archived');
      rows.push({ name: v.name, price: v.price, status: deriveVariantStatus(vr), recipeId: vr?._id });
    }
    return rows;
  }, [recipes, effectiveVariants, product, productId]);

  /**
   * THE critical transition — switching variants REPLACES the editor state
   * with the target variant's own recipe (or an empty editor). It never keeps
   * the previous variant's ingredients.
   */
  function switchVariant(variant: string) {
    setSaveError(null);
    const variantRecipe = recipes.find(
      (r) => r.productId === productId && (r.variantName || '') === variant && r.status !== 'archived'
    ) || null;
    setSelectedVariant(variant);
    setRecipeForVariant(variantRecipe);
    setComponents(variantRecipe ? (variantRecipe.components || []).map(toRow) : []);
    setRecipeMode(variantRecipe && variantRecipe.components?.length > 0 ? 'manual' : 'skip');
    if (!nameTouched) {
      setName(`${product?.name || ''} (${variant}) Recipe`);
    }
  }

  // ── Live cost (client mirror of the backend engine) ──
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

    const servings = 1;
    const minor = money((Number(costSettings?.minorIngredientAllowance) || 0) * servings);
    const cooking = money((Number(costSettings?.cookingAllowance) || 0) * servings);
    const wastagePct = Number(costSettings?.wastagePercent) || 0;
    const wastage = money((direct + minor + cooking) * wastagePct / 100);
    const packaging = money(Number(costSettings?.packaging?.dineIn) || 0);
    const variable = money(direct + minor + cooking + wastage + packaging);
    const conservative = money(variable * (1 + (Number(costSettings?.conservativeMarkupPercent) || 10) / 100));
    const foodCostPercent = sellingPrice > 0 ? Math.round(variable / sellingPrice * 10000) / 100 : 0;
    const contribution = money(sellingPrice - variable);
    const marginPercent = sellingPrice > 0 ? Math.round(contribution / sellingPrice * 10000) / 100 : 0;
    return { direct: money(direct), minor, cooking, wastage, packaging, variable, conservative, foodCostPercent, contribution, marginPercent, lines };
  }, [components, inventoryItems, recipes, sellingPrice, costSettings]);

  const updateRow = (key: string, patch: Partial<ComponentRow>) => {
    setSaveError(null);
    setComponents((prev) => prev.map((c) => c.key === key ? { ...c, ...patch } : c));
  };

  const removeRow = (key: string) => {
    setSaveError(null);
    setComponents((prev) => prev.filter((c) => c.key !== key));
  };

  // ── Manual inventory search / add ──
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

  // ── Describe / AI parse (text + voice transcript) ──
  const handleDescribeParse = async (text: string) => {
    const trimmed = (text || '').trim();
    if (trimmed.length < 3) { setRecipeError('Say or type at least one ingredient, like "200g paneer, 100g tomato".'); return; }
    setDescribeLoading(true);
    setRecipeError('');
    try {
      const pid = productId || initialProduct?._id;
      if (!pid) { setRecipeError('Select a product first.'); return; }
      // Parse INTO the currently selected variant only — never another one.
      const draft = await recipeAiQuickCreate(pid, trimmed, selectedVariant || undefined);
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

  const blobToBase64 = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

  const stopMic = () => {
    try { recorderRef.current?.stop?.(); } catch { /* ignore */ }
    try { streamRef.current?.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
    setRecording(false);
  };

  const handleStartRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setRecipeError('Microphone not available — type the ingredients instead.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']
        .find((t) => MediaRecorder.isTypeSupported(t)) || '';
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        setRecording(false);
        if (blob.size < 8000) { setRecipeError('No speech heard — try again or type it.'); return; }
        setTranscribing(true);
        setRecipeError('');
        try {
          const { data } = await apiClient.post('/voice-inventory/transcribe', {
            audio: await blobToBase64(blob),
            audioMimeType: blob.type || 'audio/webm',
            language: 'hi-en',
          });
          const transcript = data?.transcript;
          if (!data?.success || !transcript) throw new Error(data?.error || 'No speech detected');
          setDescribeText(transcript);
          await handleDescribeParse(transcript);
        } catch (e: any) {
          setRecipeError(e?.response?.data?.error || e?.message || 'Could not hear you — type the ingredients instead.');
        } finally {
          setTranscribing(false);
        }
      };
      recorder.onerror = () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        setRecipeError('Recording failed — type the ingredients instead.');
      };
      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
      setRecipeError('');
    } catch (e: any) {
      setRecording(false);
      setRecipeError(`Microphone blocked (${e?.name || 'error'}) — type the ingredients instead.`);
    }
  };

  const handleStopRecording = () => {
    try { recorderRef.current?.stop?.(); } catch { /* ignore */ }
  };

  const recipeRowsForStep: RecipeRow[] = components.map((c) => ({
    key: c.key,
    inventoryItemId: c.inventoryItemId,
    itemName: c.itemName,
    unit: c.unit,
    itemUnit: c.itemUnit,
    quantity: c.quantity,
    averageCost: c.averageCost,
    costPreview: live.lines.find((l: any) => l.key === c.key)?.cost,
    needsReview: false,
  }));

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
          price: 0, type: 'inventory', availability: false, currentStock: 0, unit: c.unit || 'pcs', minStock: 0, maxStock: 0,
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
    setSaving(true);
    setCreatingCustom(true);
    try {
      const rows = await resolveCustomItems();
      if (!rows) return;
      // Scoped to the CURRENT variant — identity lives in the payload, and the
      // backend rejects reparenting an existing recipe to a different variant.
      const body = payloadFrom(productId, selectedVariant, rows, name);
      let saved;
      const target = targetRecipeFor(productId, selectedVariant, recipes);
      if (target) saved = await updateRecipe(target._id, body);
      else saved = await createRecipe({ ...body, status: activate ? 'active' : 'draft' });
      if (!saved) { setSaveError({ title: 'Saved offline', detail: 'The recipe was queued and will sync when connected.' }); return; }
      if (activate && saved.status !== 'active') await activateRecipe(saved._id);
      notify(activate ? 'Recipe saved & activated' : 'Recipe saved as draft', 'success');
      onSaved();
    } catch (e: any) {
      setSaveError({ title: "Couldn't save the recipe", detail: e?.message || 'Check the connection and try again.' });
    } finally {
      setSaving(false);
      setCreatingCustom(false);
    }
  };

  // ── Copy from another variant: DEEP-CLONE into the current variant ──
  const handleCopyFromVariant = (sourceVariantName: string) => {
    setSaveError(null);
    if (sourceVariantName === selectedVariant) { setCopyFromOpen(false); return; }
    const sourceRecipe = recipes.find(
      (r) => r.productId === productId && (r.variantName || '') === sourceVariantName && r.status !== 'archived'
    );
    if (!sourceRecipe) {
      setSaveError({ title: 'Copy failed', detail: 'The source variant has no recipe yet' });
      return;
    }
    // Fresh deep clone with new keys — NEVER a reference to the source array.
    setComponents(cloneComponents<ComponentRow>((sourceRecipe.components || []).map(toRow)));
    notify(`Ingredients copied from ${sourceVariantName} — review, then save`, 'success');
    setCopyFromOpen(false);
  };

  const copySources = panelVariants.filter((v) => v.name !== selectedVariant && !!v.recipeId);

  const selectedStatus = panelVariants.find((v) => v.name === selectedVariant)?.status;
  const statusHint = selectedStatus === 'active'
    ? `${selectedVariant} has its own active recipe.`
    : selectedStatus === 'draft'
      ? `${selectedVariant} has a draft recipe — save & activate to make it live.`
      : `No recipe for ${selectedVariant} — add ingredients below, then save.`;

  return (
    <div className="fixed inset-0 z-[150] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[var(--color-bg-white)] rounded-3xl shadow-2xl max-w-6xl w-full max-h-[92vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="px-6 py-4 border-b border-[var(--color-border-default)] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <ChefHat className="w-5 h-5 text-[var(--brand-color)] shrink-0" />
            <div className="min-w-0">
              <h3 className="text-base font-bold truncate">Edit Recipe — {product?.name || existing?.productName || ''}</h3>
              <p className="text-[11px] text-gray-400">Configure ingredients and cost for each menu variant.</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {recipeForVariant && (
              <button onClick={() => onDelete(recipeForVariant)} className="px-3 py-1.5 text-[10px] font-bold text-red-500 hover:bg-red-50 rounded-lg transition-all cursor-pointer">
                Delete
              </button>
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

        <div className="flex-1 overflow-y-auto p-5 grid grid-cols-1 lg:grid-cols-5 gap-5">
          {/* ── LEFT: variant panel + recipe editing ── */}
          <div className="lg:col-span-3 space-y-4 min-w-0">
            {!existing && !initialProduct && (
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">Menu Item</label>
                <select value={productId} onChange={(e) => { setProductId(e.target.value); autoSelectedRef.current = false; setSelectedVariant(''); setRecipeForVariant(null); setComponents([]); setRecipeMode('skip'); setNameTouched(false); setSaveError(null); }} className="w-full px-3 py-2.5 bg-gray-50 border border-[var(--color-border-default)] rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]/20 cursor-pointer">
                  <option value="">Select menu item…</option>
                  {menuProducts.map((p) => (
                    <option key={p._id} value={p._id}>{p.name} — ₹{Number(p.price || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</option>
                  ))}
                </select>
              </div>
            )}

            {/* ── VARIANTS side panel (all variants visible, never a hidden dropdown) ── */}
            {panelVariants.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-400">Variants</label>
                  {copySources.length > 0 && (
                    <button
                      onClick={() => setCopyFromOpen(true)}
                      className="text-[10px] font-bold text-sky-600 hover:text-sky-700 hover:bg-sky-50 px-2 py-1 rounded-lg transition-all cursor-pointer flex items-center gap-1"
                    >
                      <Copy className="w-3 h-3" /> Copy from another variant
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {panelVariants.map((v) => {
                    const selected = v.name === selectedVariant;
                    const badge = v.status === 'active'
                      ? { label: '✓ Active', cls: 'bg-emerald-50 text-emerald-600 border-emerald-200' }
                      : v.status === 'draft'
                        ? { label: '○ Draft', cls: 'bg-amber-50 text-amber-600 border-amber-200' }
                        : { label: '⚠ No recipe', cls: 'bg-gray-100 text-gray-500 border-gray-200' };
                    return (
                      <button
                        key={v.name}
                        onClick={() => switchVariant(v.name)}
                        className={`px-2.5 py-1.5 rounded-xl border text-[11px] font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                          selected
                            ? 'bg-[var(--brand-color)] text-white border-[var(--brand-color)] shadow-sm'
                            : 'bg-[var(--color-bg-white)] text-gray-700 border-[var(--color-border-default)] hover:border-[var(--brand-color)]'
                        }`}
                      >
                        <span>{v.name}</span>
                        <span className={selected ? 'text-white/80' : 'text-[var(--brand-color)]'}>{fmt(v.price)}</span>
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold border ${selected ? 'bg-white/15 text-white border-white/20' : badge.cls}`}>{badge.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── RECIPE FOR: <SELECTED VARIANT> ── */}
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-black uppercase tracking-wide text-gray-800">
                Recipe for: <span className="text-[var(--brand-color)]">{selectedVariant.toUpperCase()}</span>
              </h4>
            </div>
            <p className={`-mt-2 text-[10px] font-medium ${selectedStatus === 'missing' || selectedStatus === 'draft' ? 'text-amber-600' : 'text-gray-400'}`}>
              {statusHint}
            </p>

            {/* Recipe name */}
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">Recipe name</label>
              <input value={name} onChange={(e) => { setName(e.target.value); setNameTouched(true); setSaveError(null); }} placeholder={product ? `${product.name} Recipe` : 'Recipe name'} className="w-full px-3 py-2.5 bg-gray-50 border border-[var(--color-border-default)] rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]/20" />
            </div>

            {/* ── Ingredients (manual / describe / voice) ── */}
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
              recording={recording}
              transcribing={transcribing}
              onStartRecording={handleStartRecording}
              onStopRecording={handleStopRecording}
              error={recipeError}
              onRowQuantityChange={(key, qty) => updateRow(key, { quantity: qty })}
              onRowUnitChange={(key, unit) => {
                const row = components.find((c) => c.key === key);
                const qty = row && row.unit ? conv(row.quantity, row.unit, unit) : row?.quantity ?? 0;
                updateRow(key, { unit, quantity: qty });
              }}
              onRowRemove={removeRow}
            />

            {/* Quick-add helpers */}
            <div className="flex items-center gap-2">
              <button onClick={() => openPicker('inventory')} disabled={inventoryItems.length === 0} className="px-3 py-2 rounded-lg border border-[var(--color-border-default)] text-[10px] font-bold text-gray-600 hover:bg-gray-50 transition-all cursor-pointer disabled:opacity-40">
                + Add inventory item
              </button>
              <button onClick={() => openPicker('sub_recipe')} disabled={subRecipeProducts.length === 0} className="px-3 py-2 rounded-lg border border-[var(--color-border-default)] text-[10px] font-bold text-gray-600 hover:bg-gray-50 transition-all cursor-pointer disabled:opacity-40" title={subRecipeProducts.length === 0 ? 'No other menu items with recipes yet' : ''}>
                + Copy from other recipe
              </button>
              <button
                onClick={() => { setComponents([]); setRecipeMode('skip'); setSaveError(null); }}
                disabled={components.length === 0}
                className="px-3 py-2 rounded-lg border border-red-200 text-[10px] font-bold text-red-500 hover:bg-red-50 transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Clear ingredients
              </button>
            </div>

            {/* Empty state for a variant with no recipe */}
            {!recipeForVariant && components.length === 0 && (
              <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2.5 text-[11px] font-medium text-amber-700">
                No recipe for {selectedVariant} yet — add ingredients below, then press Save Draft or Save &amp; Activate.
              </div>
            )}
          </div>

          {/* ── RIGHT: LIVE COST + BREAKDOWN ── */}
          <div className="lg:col-span-2 space-y-4">
            <div className="bg-gradient-to-br from-[var(--color-sidebar-bg)] to-[#2a2d3d] rounded-2xl p-5 text-white">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-white/50">Live cost</p>
                <span className="text-[10px] font-bold text-white/40">{selectedVariant ? selectedVariant.toUpperCase() : 'BASE'}</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[10px] text-white/50">Selling price</p>
                  <p className="text-lg font-black font-mono">{fmt(sellingPrice)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-white/50">Recipe cost</p>
                  <p className="text-lg font-black font-mono text-amber-300">{fmt(live.variable)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-white/50">Food cost %</p>
                  <p className={`text-lg font-black font-mono ${live.foodCostPercent > 45 ? 'text-red-400' : live.foodCostPercent > 35 ? 'text-amber-300' : 'text-emerald-300'}`}>{live.foodCostPercent}%</p>
                </div>
                <div>
                  <p className="text-[10px] text-white/50">Gross margin</p>
                  <p className={`text-lg font-black font-mono ${live.contribution >= 0 ? 'text-emerald-300' : 'text-red-400'}`}>{fmt(live.contribution)}</p>
                </div>
              </div>
              {sellingPrice > 0 && (
                <div className="mt-3 pt-3 border-t border-white/10 flex items-center justify-between text-[11px]">
                  <span className="text-white/40">Margin</span>
                  <span className={`font-mono font-bold ${live.marginPercent >= 0 ? 'text-emerald-300' : 'text-red-400'}`}>{live.marginPercent}%</span>
                </div>
              )}
            </div>

            <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-4">
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2">Cost breakdown</p>
              {live.lines.length === 0 && <p className="text-xs text-gray-400">Add ingredients to see the breakdown.</p>}
              <div className="space-y-1.5">
                {live.lines.map((l: any) => (
                  <div key={l.key} className="flex items-center justify-between text-xs">
                    <span className="text-gray-600 truncate">{l.itemName}</span>
                    <span className="font-mono text-gray-500 shrink-0 ml-2">
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
        <div className="px-6 py-4 border-t border-[var(--color-border-default)] flex items-center justify-end gap-2 shrink-0 flex-wrap">
          <span className="text-[10px] font-semibold text-gray-400 mr-auto">
            Editing: <span className="text-[var(--brand-color)]">{selectedVariant.toUpperCase()}</span>
          </span>
          <button onClick={onClose} className="px-4 py-2 rounded-xl border border-[var(--color-border-default)] text-gray-600 text-xs font-bold hover:bg-gray-50 transition-all cursor-pointer">Cancel</button>
          <button onClick={() => handleSave(false)} disabled={saving || creatingCustom} className="px-4 py-2 rounded-xl bg-gray-800 text-white text-xs font-bold hover:bg-gray-900 transition-all cursor-pointer disabled:opacity-50 flex items-center gap-1.5">
            {saving || creatingCustom ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} Save Draft
          </button>
          <button onClick={() => handleSave(true)} disabled={saving || creatingCustom} className="px-4 py-2 rounded-xl bg-[var(--brand-color)] text-white text-xs font-bold hover:bg-[var(--color-primary-hover)] transition-all cursor-pointer disabled:opacity-50 flex items-center gap-1.5">
            {saving || creatingCustom ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Save & Activate
          </button>
        </div>

        {/* Copy-from-variant popover */}
        {copyFromOpen && (
          <div className="fixed inset-0 z-[200] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setCopyFromOpen(false)}>
            <div className="bg-[var(--color-bg-white)] rounded-3xl shadow-2xl max-w-md w-full overflow-hidden" onClick={(e) => e.stopPropagation()}>
              <div className="px-6 py-4 border-b border-[var(--color-border-default)] flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2.5">
                  <ArrowLeftRight className="w-4 h-4 text-[var(--brand-color)]" />
                  <span className="text-base font-bold">Copy recipe to {selectedVariant.toUpperCase()}</span>
                </div>
                <button onClick={() => setCopyFromOpen(false)} className="p-1 text-gray-400 hover:text-gray-600 rounded cursor-pointer"><X className="w-4 h-4" /></button>
              </div>
              <div className="p-5 space-y-2 max-h-[60vh] overflow-y-auto">
                <p className="text-xs text-gray-500 mb-1">
                  Pick a source. Its ingredients are copied as an independent draft into the current variant — nothing is activated.
                </p>
                {copySources.map((v) => {
                  const src = recipes.find((r) => r.productId === productId && (r.variantName || '') === v.name && r.status !== 'archived');
                  const count = src?.components?.length || 0;
                  return (
                    <button
                      key={v.name}
                      onClick={() => handleCopyFromVariant(v.name)}
                      disabled={copyFromLoading}
                      className={`w-full text-left px-3 py-3 rounded-xl border transition-all cursor-pointer hover:bg-[var(--color-primary-light)] border-[var(--color-border-default)]`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-gray-900">{v.name}</span>
                          <span className="text-[10px] font-bold text-[var(--brand-color)] bg-[var(--color-primary-light)] px-1.5 py-0.5 rounded">₹{Number(v.price || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                        </div>
                        <span className="text-[10px] font-medium text-emerald-600">{count} ingredient{count === 1 ? '' : 's'}</span>
                      </div>
                    </button>
                  );
                })}
                {copySources.length === 0 && (
                  <p className="text-xs text-gray-400 text-center py-2">No other variant has a recipe yet.</p>
                )}
              </div>
              <div className="px-6 py-4 border-t border-[var(--color-border-default)] flex justify-end gap-2 shrink-0">
                <button onClick={() => setCopyFromOpen(false)} className="px-4 py-2 text-sm font-semibold text-gray-600 hover:text-gray-800 cursor-pointer">Cancel</button>
              </div>
            </div>
          </div>
        )}

        {/* Quick-add picker: inventory item / copy from other recipe */}
        {pickerOpen && (
          <div className="fixed inset-0 z-[200] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setPickerOpen(null)}>
            <div className="bg-[var(--color-bg-white)] rounded-3xl shadow-2xl max-w-lg w-full flex flex-col max-h-[85vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
              <div className="px-6 py-4 border-b border-[var(--color-border-default)] flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2.5">
                  {pickerOpen === 'sub_recipe' && pickerSelection && (
                    <button onClick={() => { setPickerSelection(null); setPickerVariant(null); setPickerSearch(''); }} className="text-[10px] font-bold text-gray-400 hover:text-gray-600 cursor-pointer flex items-center gap-1">
                      ← Back
                    </button>
                  )}
                  <ChefHat className="w-4 h-4 text-[var(--brand-color)]" />
                  <span className="text-base font-bold">
                    {pickerOpen === 'inventory'
                      ? 'Add inventory item'
                      : (pickerSelection ? 'Choose a variant' : 'Copy from another recipe')}
                  </span>
                </div>
                <button onClick={() => setPickerOpen(null)} className="p-1 text-gray-400 hover:text-gray-600 rounded cursor-pointer"><X className="w-4 h-4" /></button>
              </div>

              <div className="p-5 space-y-4 overflow-y-auto">
                {/* Search */}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                  <input
                    value={pickerSearch}
                    onChange={(e) => {
                      setPickerSearch(e.target.value);
                      if (pickerOpen === 'inventory') setPickerSelection(null);
                    }}
                    placeholder={pickerOpen === 'inventory' ? 'Search inventory items…' : (pickerSelection ? 'Search variants…' : 'Search menu items…')}
                    className="w-full pl-8 pr-3 py-2 rounded-lg border border-[var(--color-border-input)] text-xs focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]"
                    autoFocus
                  />
                </div>

                {/* Inventory items — already-present items are hidden */}
                {pickerOpen === 'inventory' && (
                  <>
                    <div className="border border-[var(--color-border-default)] rounded-xl divide-y divide-[var(--color-border-default)] max-h-52 overflow-y-auto">
                      {filteredInventoryItems.map((item: any) => {
                        const isSelected = pickerSelection?.id === item.id || pickerSelection?._id === item._id;
                        return (
                          <button
                            key={item.id || item._id}
                            onClick={() => { setPickerSelection(item); setPickerQty(1); setPickerUnit(''); }}
                            className={`w-full flex items-center gap-2 px-3 py-2 text-left cursor-pointer transition-colors ${isSelected ? 'bg-[var(--color-primary-light)]' : 'hover:bg-[var(--color-primary-light)]'}`}
                          >
                            <span className="flex-1 min-w-0">
                              <span className="block text-xs font-bold text-[var(--color-text-primary)] truncate">{item.name}</span>
                              <span className="block text-[10px] text-gray-500 truncate">
                                per {item.unit || 'unit'}{Number(item.averageCost) > 0 ? ` · ${fmt(item.averageCost)}` : ''}{Number(item.currentStock) > 0 ? ` · stock ${item.currentStock}` : ''}
                              </span>
                            </span>
                            <span className={`text-xs font-bold shrink-0 ${isSelected ? 'text-[var(--brand-color)]' : 'text-gray-300'}`}>{isSelected ? '✓' : '+'}</span>
                          </button>
                        );
                      })}
                      {filteredInventoryItems.length === 0 && (
                        <p className="px-3 py-3 text-[10px] text-gray-400">
                          {pickerSearch.trim()
                            ? 'No inventory items match your search.'
                            : 'No inventory items to add — everything is already in this recipe.'}
                        </p>
                      )}
                    </div>

                    {pickerSelection && (
                      <div className="rounded-xl border border-[var(--color-border-default)] p-3 space-y-2">
                        <p className="text-[10px] font-bold uppercase text-gray-500 tracking-wider">Quantity needed</p>
                        <div className="flex items-center gap-2">
                          <input
                            type="number" min={0} step="any"
                            value={pickerQty}
                            onChange={(e) => setPickerQty(Number(e.target.value))}
                            className="w-28 px-2 py-2 rounded-lg border border-[var(--color-border-input)] text-xs font-mono font-bold text-right focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]"
                          />
                          <select
                            value={pickerUnit || pickerSelection.unit || 'g'}
                            onChange={(e) => setPickerUnit(e.target.value)}
                            className="px-2 py-2 rounded-lg border border-[var(--color-border-default)] bg-white text-[10px] font-semibold text-gray-600 focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)] cursor-pointer"
                          >
                            {unitOptionsFor(pickerSelection.unit || 'g').map((u) => (
                              <option key={u} value={u}>{u}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* Copy-from-recipe — step 1: pick a menu item */}
                {pickerOpen === 'sub_recipe' && !pickerSelection && (
                  <div className="border border-[var(--color-border-default)] rounded-xl divide-y divide-[var(--color-border-default)] max-h-52 overflow-y-auto">
                    {filteredSubRecipeProducts.map((entry) => (
                      <button
                        key={entry.product._id}
                        onClick={() => { setPickerSelection(entry); setPickerVariant(null); setPickerSearch(''); }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-left cursor-pointer transition-colors hover:bg-[var(--color-primary-light)]"
                      >
                        <span className="flex-1 min-w-0">
                          <span className="block text-xs font-bold text-[var(--color-text-primary)] truncate">{entry.product.name}</span>
                          <span className="block text-[10px] text-gray-500 truncate">
                            {productHasVariants(entry.product)
                              ? `${entry.recipes.length} variant recipe${entry.recipes.length === 1 ? '' : 's'}`
                              : `${entry.recipes.length} recipe${entry.recipes.length === 1 ? '' : 's'} (Default)`}
                            {entry.product.category ? ` · ${entry.product.category}` : ''}
                          </span>
                        </span>
                        <span className="text-xs font-bold text-gray-300">›</span>
                      </button>
                    ))}
                    {filteredSubRecipeProducts.length === 0 && (
                      <p className="px-3 py-3 text-[10px] text-gray-400">
                        {pickerSearch.trim() ? 'No menu items match your search.' : 'No other menu items with recipes yet — create a recipe for another item first.'}
                      </p>
                    )}
                  </div>
                )}

                {/* Copy-from-recipe — step 2: pick the variant */}
                {pickerOpen === 'sub_recipe' && pickerSelection && (
                  <div className="border border-[var(--color-border-default)] rounded-xl divide-y divide-[var(--color-border-default)] max-h-52 overflow-y-auto">
                    {filteredPickerVariants.map((r: any) => {
                      const isSelected = pickerVariant?._id === r._id;
                      return (
                        <button
                          key={r._id}
                          onClick={() => setPickerVariant(r)}
                          className={`w-full flex items-center gap-2 px-3 py-2 text-left cursor-pointer transition-colors ${isSelected ? 'bg-[var(--color-primary-light)]' : 'hover:bg-[var(--color-primary-light)]'}`}
                        >
                          <span className="flex-1 min-w-0">
                            <span className="block text-xs font-bold text-[var(--color-text-primary)] truncate">{r.variantName || 'Default'}</span>
                            <span className="block text-[10px] text-gray-500 truncate">
                              {r.name} · {r.status === 'active' ? '✓ Active' : '○ Draft'} · {r.components?.length || 0} ingredient{(r.components?.length || 0) === 1 ? '' : 's'}
                            </span>
                          </span>
                          <span className={`text-xs font-bold shrink-0 ${isSelected ? 'text-[var(--brand-color)]' : 'text-gray-300'}`}>{isSelected ? '✓' : '›'}</span>
                        </button>
                      );
                    })}
                    {filteredPickerVariants.length === 0 && (
                      <p className="px-3 py-3 text-[10px] text-gray-400">No recipes match your search.</p>
                    )}
                  </div>
                )}
              </div>

              <div className="px-6 py-4 border-t border-[var(--color-border-default)] flex justify-end gap-2 shrink-0">
                <button onClick={() => setPickerOpen(null)} className="px-4 py-2 text-sm font-semibold text-gray-600 hover:text-gray-800 cursor-pointer">Cancel</button>
                {pickerOpen === 'inventory' ? (
                  <button
                    onClick={confirmAddInventory}
                    disabled={!pickerSelection}
                    className="px-4 py-2 rounded-xl bg-[var(--brand-color)] text-white text-xs font-bold hover:bg-[var(--color-primary-hover)] transition-all cursor-pointer disabled:opacity-40 flex items-center gap-1.5"
                  >
                    <Check className="w-3.5 h-3.5" /> Add ingredient
                  </button>
                ) : (
                  pickerSelection && (
                    <button
                      onClick={confirmAddSubRecipe}
                      disabled={!pickerVariant}
                      className="px-4 py-2 rounded-xl bg-[var(--brand-color)] text-white text-xs font-bold hover:bg-[var(--color-primary-hover)] transition-all cursor-pointer disabled:opacity-40 flex items-center gap-1.5"
                    >
                      <Check className="w-3.5 h-3.5" /> Copy ingredients
                    </button>
                  )
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
