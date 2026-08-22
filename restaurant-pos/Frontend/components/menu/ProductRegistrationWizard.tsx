/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ProductRegistrationWizard — the guided dish-registration flow:
 *
 *   Basic Details → Price & Variants → Add-ons & Customizations
 *                → Recipe → Review & Register
 *
 * It does NOT re-implement any business logic. It is a UI shell over the
 * existing, tested pieces:
 *   - POST /products                 (product creation)
 *   - menu-config templates + attach (reusable variant/add-on/customization
 *     groups — shared / copy, usage counts, search — the SAME entities the
 *     billing ConfiguredItemModal + pricing engine consume)
 *   - POST /recipes + ai/quick-create + ai/search (recipe, voice, costing)
 *
 * ONE source of truth: the configuration created here is stored as product
 * menuConfig refs and resolved by the existing resolver — billing never sees
 * a separate "registration variant".
 *
 * The product record is created server-side when the user leaves Step 1 so
 * later steps (config attach, recipe AI) can anchor to a real product id, the
 * same way ProductConfigEditor works today. If the flow is cancelled before
 * "Register Dish", that record is deleted so nothing orphaned remains.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  X, Plus, Trash2, Search, Mic, Loader2, Check, ChevronLeft, ChevronRight,
  Sparkles, CheckCircle2, AlertCircle, Copy, Layers, Tag, FilePlus2, Info, Share2,
} from 'lucide-react';
import type {
  ConfigType, Product, ProductMenuConfig, MenuConfigTemplate, MenuConfigOption,
  SelectionMode,
} from '../../src/types';
import * as api from '../../src/api/client';
import apiClient from '../../src/api/axios';
import ImageInput from '../common/ImageInput';

// ─── Small helpers ────────────────────────────────────────────────

const uid = () => `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
const money = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const fmt = (n: number, symbol = '₹') =>
  symbol + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MONGO_ID = /^[a-fA-F0-9]{24}$/;

const STEP_LABELS = ['Basic Details', 'Price & Variants', 'Add-ons & Customizations', 'Recipe', 'Review & Register'];

/** Group rule defaults — mirror ProductConfigEditor's GROUP_DEFAULTS exactly. */
const GROUP_DEFAULTS: Record<ConfigType, { selectionMode: SelectionMode; required: boolean; minSelections: number; maxSelections: number | null }> = {
  VARIANT_GROUP: { selectionMode: 'SINGLE', required: true, minSelections: 1, maxSelections: 1 },
  MODIFIER_GROUP: { selectionMode: 'MULTIPLE', required: false, minSelections: 0, maxSelections: null },
  ADD_ON_GROUP: { selectionMode: 'MULTIPLE', required: false, minSelections: 0, maxSelections: null },
};

const TYPE_LABEL: Record<ConfigType, string> = {
  VARIANT_GROUP: 'variant group',
  MODIFIER_GROUP: 'customization group',
  ADD_ON_GROUP: 'add-on group',
};
const TYPE_PLURAL: Record<ConfigType, string> = {
  VARIANT_GROUP: 'Variants',
  MODIFIER_GROUP: 'Customizations',
  ADD_ON_GROUP: 'Add-ons',
};

// ─── Draft shapes ─────────────────────────────────────────────────

interface DraftOption {
  id: string;
  name: string;
  price: number; // FULL price for variants / modifiers; unit price for add-ons
}

interface AttachedGroup {
  key: string;
  type: ConfigType;
  name: string;
  options: DraftOption[];
  /** Set when the user reused an existing template. */
  sourceTemplateId?: string;
  /** 'shared' = reference the existing template; 'copy' = independent copy; 'new' = brand-new group. */
  mode: 'new' | 'shared' | 'copy';
  /** How many dishes use the shared source (display only). */
  usage?: number;
}

interface RecipeRow {
  key: string;
  inventoryItemId?: string;
  itemName: string;
  unit: string;
  quantity: number;
  averageCost?: number;
  costPreview?: number;
  confidence?: 'HIGH' | 'MEDIUM' | 'LOW';
  needsReview: boolean;
}

// ─── Props ────────────────────────────────────────────────────────

type TaxClassificationKey = 'prepared_food' | 'beverage' | 'packaged' | 'other';

const TAX_CLASSIFICATIONS: Array<{ key: TaxClassificationKey; label: string }> = [
  { key: 'prepared_food', label: 'Prepared Restaurant Food' },
  { key: 'beverage', label: 'Beverage' },
  { key: 'packaged', label: 'Packaged Food / Product' },
  { key: 'other', label: 'Other' },
];

/** Same defaults the backend injects — used only to render the recommended
 *  treatment when the server settings haven't been saved yet. The backend's
 *  injected copy is authoritative once fetched; this fallback keeps the wizard
 *  correct on first run / offline. */
const FALLBACK_TAX_RULES: Record<TaxClassificationKey, number | null> = {
  prepared_food: 5,
  beverage: 5,
  packaged: 12,
  other: null,
};

function normalizedTaxRules(rules?: Record<string, number | null> | null): Record<TaxClassificationKey, number | null> {
  const out: Record<TaxClassificationKey, number | null> = { ...FALLBACK_TAX_RULES };
  if (rules && typeof rules === 'object') {
    for (const c of TAX_CLASSIFICATIONS) {
      const v = rules[c.key];
      if (typeof v === 'number' && v >= 0) out[c.key] = v;
      else if (v === null || v === undefined) out[c.key] = null;
    }
  }
  return out;
}

interface WizardProps {
  products: Product[];
  currencySymbol: string;
  categories: string[]; // includes the 'All' pseudo-category like ProductManager
  onUpdateCategories: (cats: string[]) => void;
  categoryColors: Record<string, string>;
  onUpdateCategoryColors: (colors: Record<string, string>) => void;
  /** Restaurant tax config — powers the automatic tax recommendation (never hard-coded in the flow). */
  defaultTaxRate?: number;
  taxRules?: Record<string, number | null>;
  onUpdateProducts: (products: Product[]) => void;
  onRegistered: (product: Product) => void;
  onClose: () => void;
}

// ─── Reusable pieces used inside the wizard ───────────────────────

/** Searchable library of existing groups + shared/copy choice. */
function ReusePicker({
  type, templates, attachedKeys, currencySymbol, onPick, onCancel,
}: {
  type: ConfigType;
  templates: MenuConfigTemplate[];
  attachedKeys: Set<string>;
  currencySymbol: string;
  onPick: (t: MenuConfigTemplate, mode: 'shared' | 'copy') => void;
  onCancel: () => void;
}) {
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<MenuConfigTemplate | null>(null);
  const [mode, setMode] = useState<'shared' | 'copy'>('shared');

  const filtered = templates.filter((t) => {
    const hay = `${t.name} ${(t.data?.options ?? []).map((o: MenuConfigOption) => o.name).join(' ')}`.toLowerCase();
    return !q || hay.includes(q.toLowerCase());
  });

  const optionLine = (type: ConfigType, o: MenuConfigOption, symbol: string) => {
    if (type === 'ADD_ON_GROUP') return `${o.name} +${symbol}${(o.price ?? 0).toFixed(2)}`;
    return `${o.name} ${symbol}${((o.priceDelta ?? o.price) ?? 0).toFixed(2)}`;
  };

  return (
    <div className="border border-[var(--color-border-default)] rounded-xl overflow-hidden bg-[var(--color-bg-white)]">
      <div className="px-4 py-3 bg-[var(--color-primary-light)] border-b border-[var(--color-border-default)] flex items-center justify-between">
        <p className="text-xs font-bold text-[var(--color-text-primary)]">Reuse an existing {TYPE_LABEL[type]}</p>
        <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 cursor-pointer"><X className="w-4 h-4" /></button>
      </div>

      {!selected ? (
        <div className="p-3">
          <div className="relative mb-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={`Search ${TYPE_PLURAL[type].toLowerCase()}...`}
              autoFocus
              className="w-full pl-8 pr-3 py-2 rounded-lg border border-[var(--color-border-input)] text-xs focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]"
            />
          </div>
          <div className="max-h-56 overflow-y-auto space-y-1.5">
            {filtered.map((t) => {
              const attached = attachedKeys.has(t._id);
              return (
                <button
                  key={t._id}
                  disabled={attached}
                  onClick={() => setSelected(t)}
                  className={`w-full text-left rounded-xl border p-2.5 transition-all ${attached ? 'opacity-45 cursor-not-allowed bg-gray-50' : 'hover:border-[var(--brand-color)] cursor-pointer bg-[var(--color-bg-white)]'} border-[var(--color-border-default)]`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-xs text-[var(--color-text-primary)]">{t.name}</span>
                    <span className="text-[9px] font-semibold text-gray-400 shrink-0">
                      {t.productCount && t.productCount > 0 ? `used by ${t.productCount} dish${t.productCount === 1 ? '' : 'es'}` : 'unused'}
                      {attached ? ' · already added' : ''}
                    </span>
                  </div>
                  <p className="text-[10px] text-gray-500 mt-1 truncate">
                    {(t.data?.options ?? []).map((o: MenuConfigOption) => optionLine(type, o, currencySymbol)).join(' · ')}
                  </p>
                </button>
              );
            })}
            {filtered.length === 0 && <p className="text-[10px] text-gray-400 text-center py-4">No matching groups.</p>}
          </div>
        </div>
      ) : (
        <div className="p-4">
          <p className="text-xs font-bold text-[var(--color-text-primary)] mb-1">Use “{selected.name}”?</p>
          <p className="text-[10px] text-gray-500 mb-3">
            {(selected.data?.options ?? []).map((o: MenuConfigOption) => optionLine(type, o, currencySymbol)).join(' · ')}
            {selected.productCount && selected.productCount > 0
              ? ` — currently used by ${selected.productCount} dish${selected.productCount === 1 ? '' : 'es'}.`
              : ''}
          </p>
          <div className="space-y-2">
            <label className={`flex items-start gap-2 rounded-xl border p-3 cursor-pointer transition-all ${mode === 'shared' ? 'border-[var(--brand-color)] bg-[var(--color-primary-light)]' : 'border-[var(--color-border-default)] bg-[var(--color-bg-white)]'}`}>
              <input type="radio" checked={mode === 'shared'} onChange={() => setMode('shared')} className="accent-[var(--brand-color)] mt-0.5" />
              <span>
                <span className="block text-xs font-bold text-[var(--color-text-primary)]">Use Shared Group</span>
                <span className="block text-[10px] text-gray-500 mt-0.5">This dish shares the group. Later edits to the group affect every dish using it.</span>
              </span>
            </label>
            <label className={`flex items-start gap-2 rounded-xl border p-3 cursor-pointer transition-all ${mode === 'copy' ? 'border-[var(--brand-color)] bg-[var(--color-primary-light)]' : 'border-[var(--color-border-default)] bg-[var(--color-bg-white)]'}`}>
              <input type="radio" checked={mode === 'copy'} onChange={() => setMode('copy')} className="accent-[var(--brand-color)] mt-0.5" />
              <span>
                <span className="block text-xs font-bold text-[var(--color-text-primary)]">Copy &amp; Customize</span>
                <span className="block text-[10px] text-gray-500 mt-0.5">Creates an independent copy for this dish only — other dishes are never affected.</span>
              </span>
            </label>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <button onClick={() => setSelected(null)} className="px-3 py-2 text-[11px] font-semibold text-gray-500 hover:text-gray-700 cursor-pointer">Back</button>
            <button
              onClick={() => { onPick(selected, mode); setSelected(null); setQ(''); }}
              className="px-4 py-2 rounded-lg bg-[var(--brand-color)] hover:bg-[var(--color-primary-hover)] text-white text-[11px] font-bold cursor-pointer transition-colors"
            >
              Continue
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Compact inline builder for a brand-new group. */
function GroupBuilder({
  type, currencySymbol, initial, onDone, onCancel,
}: {
  type: ConfigType;
  currencySymbol: string;
  initial?: { name: string; options: DraftOption[] };
  onDone: (name: string, options: DraftOption[]) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [options, setOptions] = useState<DraftOption[]>(initial?.options?.length
    ? initial.options
    : [{ id: uid(), name: '', price: 0 }, { id: uid(), name: '', price: 0 }]);

  const setOpt = (i: number, patch: Partial<DraftOption>) =>
    setOptions(options.map((o, j) => (j === i ? { ...o, ...patch } : o)));

  const valid = name.trim().length > 0 && options.some((o) => o.name.trim());

  return (
    <div className="border border-[var(--color-border-default)] rounded-xl overflow-hidden bg-[var(--color-bg-white)]">
      <div className="px-4 py-3 bg-[var(--color-primary-light)] border-b border-[var(--color-border-default)] flex items-center justify-between">
        <p className="text-xs font-bold text-[var(--color-text-primary)]">Create a new {TYPE_LABEL[type]}</p>
        <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 cursor-pointer"><X className="w-4 h-4" /></button>
      </div>
      <div className="p-4 space-y-3">
        <div>
          <label className="block text-[10px] font-semibold uppercase text-gray-500 tracking-wider mb-1">Group name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={type === 'VARIANT_GROUP' ? 'e.g. Size' : type === 'MODIFIER_GROUP' ? 'e.g. Spice Level' : 'e.g. Extra Toppings'}
            className="w-full px-3 py-2 rounded-lg border border-[var(--color-border-input)] text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]"
          />
        </div>
        <div>
          <label className="block text-[10px] font-semibold uppercase text-gray-500 tracking-wider mb-2">
            {type === 'VARIANT_GROUP' ? 'Variant name · selling price' : type === 'MODIFIER_GROUP' ? 'Option · added price' : 'Add-on · price'}
          </label>
          <div className="space-y-2">
            {options.map((o, i) => (
              <div key={o.id} className="flex items-center gap-2">
                <input
                  value={o.name}
                  onChange={(e) => setOpt(i, { name: e.target.value })}
                  placeholder={type === 'VARIANT_GROUP' ? 'e.g. Full' : type === 'MODIFIER_GROUP' ? 'e.g. Spicy' : 'e.g. Extra Cheese'}
                  className="flex-1 px-3 py-2 rounded-lg border border-[var(--color-border-input)] text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]"
                />
                <input
                  type="number" min={0} step="0.01"
                  value={o.price}
                  onChange={(e) => setOpt(i, { price: Math.max(0, Number(e.target.value)) })}
                  placeholder="Price"
                  className="w-24 px-3 py-2 rounded-lg border border-[var(--color-border-input)] text-xs font-mono font-bold focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]"
                />
                <button onClick={() => setOptions(options.filter((_, j) => j !== i))} className="p-1.5 text-gray-400 hover:text-red-600 cursor-pointer" title="Remove">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
          <button
            onClick={() => setOptions([...options, { id: uid(), name: '', price: 0 }])}
            className="mt-2 flex items-center gap-1 text-[11px] font-semibold text-[var(--brand-color)] hover:underline cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" /> Add {type === 'VARIANT_GROUP' ? 'variant' : 'option'}
          </button>
        </div>
      </div>
      <div className="px-4 py-3 border-t border-[var(--color-border-default)] flex justify-end gap-2">
        <button onClick={onCancel} className="px-3 py-2 text-[11px] font-semibold text-gray-500 hover:text-gray-700 cursor-pointer">Cancel</button>
        <button
          onClick={() => onDone(name.trim(), options.filter((o) => o.name.trim()).map((o) => ({ ...o, name: o.name.trim() })))}
          disabled={!valid}
          className="px-4 py-2 rounded-lg bg-[var(--brand-color)] hover:bg-[var(--color-primary-hover)] text-white text-[11px] font-bold disabled:opacity-50 cursor-pointer transition-colors"
        >
          Use this group
        </button>
      </div>
    </div>
  );
}

/** Summary chip for an attached group (spec §11 — shows shared state clearly). */
function GroupSummaryCard({ group, currencySymbol, onRemove }: {
  group: AttachedGroup;
  currencySymbol: string;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-white)] p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <Layers className="w-3.5 h-3.5 text-[var(--brand-color)] shrink-0" />
          <span className="text-xs font-bold text-[var(--color-text-primary)] truncate">{group.name}</span>
          <span className={`shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded ${group.mode === 'shared' ? 'bg-violet-50 text-violet-700 border border-violet-200' : group.mode === 'copy' ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}`}>
            {group.mode === 'shared' ? '♻ Shared' : group.mode === 'copy' ? '✂ Copied' : 'New'}
          </span>
        </div>
        <button onClick={onRemove} className="p-1 text-gray-400 hover:text-red-600 cursor-pointer shrink-0" title="Remove group">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
      <p className="text-[10px] text-gray-500 mt-1.5">
        {group.options.map((o) =>
          group.type === 'ADD_ON_GROUP'
            ? `${o.name} +${currencySymbol}${o.price.toFixed(2)}`
            : `${o.name} ${currencySymbol}${o.price.toFixed(2)}`
        ).join(' · ')}
      </p>
      {group.mode === 'shared' && group.usage ? (
        <p className="text-[9px] text-violet-600 font-semibold mt-1">Shared with {group.usage} dish{group.usage === 1 ? '' : 'es'}</p>
      ) : null}
    </div>
  );
}

// ─── The wizard ───────────────────────────────────────────────────

export default function ProductRegistrationWizard({
  products, currencySymbol, categories, onUpdateCategories, categoryColors,
  onUpdateCategoryColors, defaultTaxRate = 0, taxRules,
  onUpdateProducts, onRegistered, onClose,
}: WizardProps) {
  const realCategories = useMemo(() => categories.filter((c) => c !== 'All'), [categories]);

  // ── Centralized tax rules (restaurant config → classification rates) ──
  const rules = useMemo(() => normalizedTaxRules(taxRules), [taxRules]);
  const availableRates = useMemo(() => {
    const set = new Set<number>();
    if (typeof defaultTaxRate === 'number' && defaultTaxRate > 0) set.add(defaultTaxRate);
    for (const v of Object.values(rules)) if (typeof v === 'number' && v > 0) set.add(v);
    return [...set].sort((a, b) => a - b);
  }, [defaultTaxRate, rules]);

  // ── Step index ──
  const [step, setStep] = useState(0);

  // ── STEP 1: Basic details ──
  const [pCode, setPCode] = useState(() => String(Math.floor(100 + Math.random() * 900)));
  const [pName, setPName] = useState('');
  const [pCategory, setPCategory] = useState(realCategories[0] ?? '');
  const [catCreating, setCatCreating] = useState(false);
  const [newCatInput, setNewCatInput] = useState('');
  const [pImage, setPImage] = useState('');
  const [pAvailability, setPAvailability] = useState(true);
  // ── Tax treatment (automatic by default, overridable, never invented) ──
  const [taxClassification, setTaxClassification] = useState<TaxClassificationKey>('prepared_food');
  const [taxSource, setTaxSource] = useState<'automatic' | 'manual'>('automatic');
  const [manualGst, setManualGst] = useState<number | null>(null);
  const [taxPickerOpen, setTaxPickerOpen] = useState(false);
  const [taxPickDraft, setTaxPickDraft] = useState<number | null>(null);
  /** Inline custom-rate entry shown when the classification has no configured rate. */
  const [customRateInput, setCustomRateInput] = useState('');
  /** Picker state — 'custom' mode lets the owner type any valid GST rate. */
  const [taxPickCustom, setTaxPickCustom] = useState(false);
  const [taxPickCustomValue, setTaxPickCustomValue] = useState('');
  const [step1Error, setStep1Error] = useState('');

  // ── STEP 2: Price & Variants ──
  const [pricingMode, setPricingMode] = useState<'single' | 'variants'>('single');
  const [sellingPrice, setSellingPrice] = useState('');
  const [variantGroup, setVariantGroup] = useState<AttachedGroup | null>(null);
  const [variantPickerOpen, setVariantPickerOpen] = useState(false);
  const [variantBuilderOpen, setVariantBuilderOpen] = useState(false);

  // ── STEP 3: Add-ons & Customizations ──
  const [addOnGroups, setAddOnGroups] = useState<AttachedGroup[]>([]);
  const [customGroups, setCustomGroups] = useState<AttachedGroup[]>([]);
  const [addOnPickerOpen, setAddOnPickerOpen] = useState(false);
  const [customPickerOpen, setCustomPickerOpen] = useState(false);
  const [addOnBuilderOpen, setAddOnBuilderOpen] = useState(false);
  const [customBuilderOpen, setCustomBuilderOpen] = useState(false);

  // ── STEP 4: Recipe ──
  const [recipeVariant, setRecipeVariant] = useState('Default');
  const [rowsByVariant, setRowsByVariant] = useState<Record<string, RecipeRow[]>>({});
  const [modeByVariant, setModeByVariant] = useState<Record<string, 'skip' | 'manual' | 'voice'>>({});
  const [recipeText, setRecipeText] = useState('');
  const [recipeSearch, setRecipeSearch] = useState('');
  const [recipeResults, setRecipeResults] = useState<any[] | null>(null);
  const [recipeLoading, setRecipeLoading] = useState(false);
  const [recipeError, setRecipeError] = useState('');
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // ── Server product created on leaving Step 1 ──
  const [productId, setProductId] = useState<string | null>(null);
  const [productCreated, setProductCreated] = useState<any | null>(null);
  const [creatingProduct, setCreatingProduct] = useState(false);
  const [stepError, setStepError] = useState('');

  // ── Register ──
  const [registering, setRegistering] = useState(false);

  // ── Templates cache (for reuse pickers) ──
  const [templates, setTemplates] = useState<Record<ConfigType, MenuConfigTemplate[]>>({
    VARIANT_GROUP: [], MODIFIER_GROUP: [], ADD_ON_GROUP: [],
  });
  const [templatesLoaded, setTemplatesLoaded] = useState(false);

  const recipeVariants = useMemo(() => {
    const names = (variantGroup?.options || []).map((o) => o.name).filter(Boolean) as string[];
    return names.length > 0 ? names : ['Default'];
  }, [variantGroup]);

  const rows = useMemo(() => rowsByVariant[recipeVariant] || [], [rowsByVariant, recipeVariant]);
  const recipeMode = modeByVariant[recipeVariant] || 'skip';
  const recipeCost = useMemo(() => money(rows.reduce((s, r) => s + (r.costPreview ?? 0), 0)), [rows]);

  const setRecipeMode = (mode: 'skip' | 'manual' | 'voice') =>
    setModeByVariant((prev) => ({ ...prev, [recipeVariant]: mode }));

  const updateCurrentRows = (updater: (current: RecipeRow[]) => RecipeRow[]) =>
    setRowsByVariant((prev) => ({ ...prev, [recipeVariant]: updater(prev[recipeVariant] || []) }));

  // ── Effective tax treatment ──
  // Deterministic: recommended = the restaurant's CONFIGURED rule for the
  // selected classification (never derived from the product name, never from
  // an LLM). Manual override replaces it. If neither yields a rate, the
  // registration is BLOCKED with a confirmation prompt — no invented rate.
  const recommendedGst = useMemo(() => rules[taxClassification] ?? null, [rules, taxClassification]);
  const effectiveGst = taxSource === 'manual' && manualGst !== null ? manualGst : recommendedGst;
  const taxAmbiguous = effectiveGst === null || effectiveGst === undefined || !(Number(effectiveGst) >= 0);

  // Reference selling price for margin display — variants use the cheapest option.
  const referencePrice = useMemo(() => {
    if (pricingMode === 'variants' && variantGroup?.options.length) {
      return Math.min(...variantGroup.options.map((o) => o.price));
    }
    return Number(sellingPrice) || 0;
  }, [pricingMode, variantGroup, sellingPrice]);

  // Selected variant's price for the recipe-step margin display.
  const recipeVariantPrice = useMemo(() => {
    if (pricingMode === 'variants' && variantGroup?.options.length) {
      const opt = variantGroup.options.find((o) => o.name === recipeVariant);
      if (opt && Number(opt.price) > 0) return Number(opt.price);
    }
    return referencePrice;
  }, [pricingMode, variantGroup, recipeVariant, referencePrice]);

  // On entering Step 4, make sure the selected variant is still valid.
  useEffect(() => {
    if (step === 3 && recipeVariants.length > 0 && !recipeVariants.includes(recipeVariant)) {
      setRecipeVariant(recipeVariants[0]);
    }
  }, [step, recipeVariants, recipeVariant]);

  useEffect(() => {
    let alive = true;
    Promise.all([
      api.fetchMenuConfigTemplates({ type: 'VARIANT_GROUP', limit: 200 }),
      api.fetchMenuConfigTemplates({ type: 'MODIFIER_GROUP', limit: 200 }),
      api.fetchMenuConfigTemplates({ type: 'ADD_ON_GROUP', limit: 200 }),
    ])
      .then(([v, m, a]) => {
        if (!alive) return;
        setTemplates({
          VARIANT_GROUP: v?.items ?? [],
          MODIFIER_GROUP: m?.items ?? [],
          ADD_ON_GROUP: a?.items ?? [],
        });
        setTemplatesLoaded(true);
      })
      .catch(() => { if (alive) setTemplatesLoaded(true); });
    return () => { alive = false; };
  }, []);

  // Cleanup: if the user exits before registering, remove the draft product.
  // The local list may already show it (the API layer refreshes products after
  // the Step-1 create), so also drop it from the visible list by id + code.
  const cleanupDraftProduct = () => {
    if (productId && MONGO_ID.test(productId)) {
      api.deleteProduct(productId).catch(() => { /* best effort */ });
    }
    if (productId) {
      const code = pCode.trim();
      onUpdateProducts(products.filter((p) => p.id !== productId && (code ? p.code !== code : true)));
    }
  };

  const handleClose = () => {
    cleanupDraftProduct();
    onClose();
  };

  // ── Step 1 actions ──
  const createCategory = (val: string): string | null => {
    const cleaned = val.trim();
    if (!cleaned) return null;
    const titled = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    if (!realCategories.includes(titled)) {
      onUpdateCategories([...categories, titled]);
      if (!categoryColors[titled]) {
        const used = new Set(Object.values(categoryColors));
        onUpdateCategoryColors({ ...categoryColors, [titled]: ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#6366f1', '#a855f7', '#ec4899', '#14b8a6', '#f43f5e', '#d946ef', '#0ea5e9', '#84cc16', '#f59e0b'].find((c) => !used.has(c)) ?? '#ef4444' });
      }
    }
    return titled;
  };

  /** Open the tax-treatment picker pre-selecting the current effective rate.
   *  For the 'other' classification (no configured rule) the custom-rate entry
   *  is preselected so the owner can type their own GST straight away. */
  const openTaxPicker = () => {
    setTaxPickDraft((effectiveGst !== null && effectiveGst !== undefined && Number(effectiveGst) >= 0) ? Number(effectiveGst) : (availableRates[0] ?? null));
    const isOther = taxClassification === 'other';
    setTaxPickCustom(isOther);
    setTaxPickCustomValue(isOther && manualGst !== null ? String(manualGst) : '');
    setTaxPickerOpen(true);
  };

  /** Validate a typed custom GST rate (0–100). */
  const validCustomRate = (v: string) => {
    const n = Number(v);
    return v.trim() !== '' && Number.isFinite(n) && n >= 0 && n <= 100;
  };

  const applyCustomRate = (v: string) => {
    if (!validCustomRate(v)) return false;
    setManualGst(Number(v));
    setTaxSource('manual');
    return true;
  };

  const handleNextFromBasic = async () => {
    setStep1Error('');
    if (!pName.trim()) { setStep1Error('Give the dish a name first.'); return; }
    if (!pCategory) { setStep1Error('Pick a category — or create a new one.'); return; }
    if (taxAmbiguous) {
      setStep1Error('Tax treatment needs confirmation — select the appropriate GST rate before continuing.');
      return;
    }
    const dup = products.find((p) => p.name.toLowerCase() === pName.trim().toLowerCase());
    if (dup) { setStep1Error(`A dish named “${dup.name}” already exists.`); return; }
    const dupCode = products.find((p) => p.code === pCode.trim());
    if (dupCode) { setStep1Error(`Code “${pCode}” is already used by “${dupCode.name}”.`); return; }

    setCreatingProduct(true);
    setStepError('');
    try {
      const created = await api.createProduct({
        name: pName.trim(),
        code: pCode.trim() || String(Math.floor(100 + Math.random() * 900)),
        price: 0, // set later — selling price (no variants) or 0 (variant prices carry it)
        category: pCategory,
        gstPercent: Number(effectiveGst) || 0,
        taxClassification,
        taxSource,
        image: pImage,
        availability: pAvailability,
        favorite: false,
      });
      const id = created?._id || created?.id;
      if (!id) throw new Error('Server did not return the new product.');
      setProductId(id);
      setProductCreated(created);
      setStep(1);
    } catch (e: any) {
      setStep1Error(e?.response?.data?.error || e?.message || 'Could not create the product. Check your connection.');
    } finally {
      setCreatingProduct(false);
    }
  };

  // ── Step 2 actions ──
  const handlePickVariant = (t: MenuConfigTemplate, mode: 'shared' | 'copy') => {
    setVariantGroup({
      key: uid(),
      type: 'VARIANT_GROUP',
      name: t.name,
      options: (t.data?.options ?? []).map((o) => ({ id: o.id, name: o.name, price: Number((o.priceDelta ?? o.price) ?? 0) })),
      sourceTemplateId: t._id,
      mode,
      usage: t.productCount ?? 0,
    });
    setVariantPickerOpen(false);
  };

  const step2Valid = () => {
    if (pricingMode === 'single') return Number(sellingPrice) > 0;
    return !!variantGroup && variantGroup.options.some((o) => o.name.trim() && o.price > 0);
  };

  // ── Step 3 actions ──
  const handlePickGroup = (type: 'ADD_ON_GROUP' | 'MODIFIER_GROUP', t: MenuConfigTemplate, mode: 'shared' | 'copy') => {
    const group: AttachedGroup = {
      key: uid(),
      type,
      name: t.name,
      options: (t.data?.options ?? []).map((o) => ({
        id: o.id,
        name: o.name,
        price: type === 'ADD_ON_GROUP' ? Number(o.price ?? 0) : Number((o.priceDelta ?? o.price) ?? 0),
      })),
      sourceTemplateId: t._id,
      mode,
      usage: t.productCount ?? 0,
    };
    if (type === 'ADD_ON_GROUP') setAddOnGroups([...addOnGroups, group]);
    else setCustomGroups([...customGroups, group]);
    setAddOnPickerOpen(false);
    setCustomPickerOpen(false);
  };

  // ── Register (Step 5) ──
  const buildTemplateData = (group: AttachedGroup) => {
    const defaults = GROUP_DEFAULTS[group.type];
    return {
      selectionMode: defaults.selectionMode,
      required: defaults.required,
      minSelections: defaults.minSelections,
      maxSelections: defaults.maxSelections === null ? undefined : defaults.maxSelections,
      options: group.options.map((o, i) => ({
        id: o.id,
        name: o.name,
        priceDelta: group.type === 'ADD_ON_GROUP' ? undefined : Number(o.price) || 0,
        price: group.type === 'ADD_ON_GROUP' ? Number(o.price) || 0 : undefined,
        active: true,
        sortOrder: i,
      })),
    };
  };

  const resolveGroupTemplate = async (group: AttachedGroup): Promise<{ templateId: string; mode: 'shared' | 'copy' }> => {
    if (group.mode === 'new') {
      const created = await api.createMenuConfigTemplate({ name: group.name, type: group.type, data: buildTemplateData(group) });
      if (!created?._id) throw new Error(`Could not create the ${TYPE_LABEL[group.type]}.`);
      return { templateId: created._id, mode: 'shared' };
    }
    if (group.mode === 'copy' && group.sourceTemplateId) {
      const copy = await api.copyMenuConfigTemplate(group.sourceTemplateId, { name: `${group.name} (copy)` });
      if (!copy?._id) throw new Error(`Could not copy the ${TYPE_LABEL[group.type]}.`);
      return { templateId: copy._id, mode: 'copy' };
    }
    if (group.sourceTemplateId) return { templateId: group.sourceTemplateId, mode: 'shared' };
    throw new Error(`The ${TYPE_LABEL[group.type]} is missing its source.`);
  };

  const handleRegister = async () => {
    if (!productId || registering) return;
    setRegistering(true);
    setStepError('');
    try {
      // 1) Resolve every configuration group to a real template + attach it.
      const configRefs: ProductMenuConfig = { variantConfigurations: [], modifierConfigurations: [], addOnConfigurations: [] };
      const attach = async (group: AttachedGroup, key: 'variantConfigurations' | 'modifierConfigurations' | 'addOnConfigurations') => {
        const { templateId, mode } = await resolveGroupTemplate(group);
        const attached = await api.attachProductConfig(productId, { type: group.type, templateId, mode });
        configRefs[key].push({
          _id: attached?._id,
          templateId,
          mode,
          ...(mode === 'copy' && group.sourceTemplateId ? { sourceTemplateId: group.sourceTemplateId } : {}),
        });
      };

      if (pricingMode === 'variants' && variantGroup) {
        await attach(variantGroup, 'variantConfigurations');
      }
      for (const g of addOnGroups) await attach(g, 'addOnConfigurations');
      for (const g of customGroups) await attach(g, 'modifierConfigurations');

      // 2) Sync the final product record — price (base is 0 for variant-driven
      //    dishes — the variant price IS the selling price) and the resolved tax
      //    treatment (rate + classification + source for auditability). Always
      //    pushed so a tax/classification change made while stepping back is
      //    never lost.
      const effectivePrice = pricingMode === 'variants' ? 0 : Number(sellingPrice) || 0;
      await api.updateProduct(productId, {
        name: pName.trim(),
        code: pCode.trim(),
        price: effectivePrice,
        category: pCategory,
        gstPercent: Number(effectiveGst) || 0,
        taxClassification,
        taxSource,
        image: pImage,
        availability: pAvailability,
        favorite: false,
      });

      // 3) Recipe — one recipe per variant (rows share the same confirmed shape).
      for (const variantName of recipeVariants) {
        const variantRows = rowsByVariant[variantName] || [];
        const components = variantRows
          .filter((r) => r.inventoryItemId)
          .map((r) => ({
            inventoryItemId: r.inventoryItemId,
            itemName: r.itemName,
            unit: r.unit || 'g',
            quantity: Math.max(0, Number(r.quantity) || 0),
            wastagePercent: 0,
            optional: false,
          }));
        if (components.length > 0) {
          // Active from the start: the merchant explicitly entered this recipe
          // during registration and expects it to consume ingredients on sale.
          // (Draft recipes are never consumed — only the Recipe Manager's
          // "Save & Activate" makes a draft live, so a wizard recipe saved as
          // draft would silently skip ingredient deduction forever.)
          await api.createRecipe({
            productId,
            variantName,
            name: pName.trim(),
            components,
            status: 'active',
          });
        }
      }

      // 4) Sync the local menu with the created product + its configuration.
      const finalProduct: Product = {
        id: productId,
        code: pCode.trim(),
        name: pName.trim(),
        price: effectivePrice,
        category: pCategory,
        gstPercent: Number(effectiveGst) || 0,
        taxClassification,
        taxSource,
        image: pImage,
        availability: pAvailability,
        favorite: false,
        menuConfig: configRefs,
      };
      // Dedupe: the API layer may have already refreshed the local list with
      // this product after the Step-1 create — never add it twice.
      onUpdateProducts([finalProduct, ...products.filter((p) => p.id !== finalProduct.id && p.code !== finalProduct.code)]);
      onRegistered(finalProduct);
    } catch (e: any) {
      setStepError(e?.response?.data?.error || e?.message || 'Could not finish registration. Please try again.');
      setRegistering(false);
    }
  };

  // ── Recipe: manual search ──
  const runRecipeSearch = async (q: string) => {
    const trimmed = q.trim();
    if (trimmed.length < 2) { setRecipeResults(null); return; }
    setRecipeLoading(true);
    setRecipeError('');
    try {
      const res = await api.recipeAiSearchInventory(trimmed);
      setRecipeResults(Array.isArray(res) ? res : []);
    } catch {
      setRecipeError('Inventory search failed — try again.');
      setRecipeResults([]);
    } finally {
      setRecipeLoading(false);
    }
  };

  const addManualRow = (item: any) => {
    const unit = item.unit || 'g';
    const avgCost = Number(item.averageCost) || 0;
    const key = `${item._id}_${Date.now().toString(36)}`;
    updateCurrentRows((current) => [
      ...current,
      {
        key,
        inventoryItemId: item._id,
        itemName: item.name,
        unit,
        quantity: 1,
        averageCost: avgCost,
        costPreview: money(avgCost),
        needsReview: false,
      },
    ]);
    setRecipeSearch('');
    setRecipeResults(null);
  };

  const setRowQty = (key: string, qty: number) => {
    const update = (r: RecipeRow): RecipeRow => {
      if (r.key !== key) return r;
      const q = Math.max(0, Number(qty) || 0);
      return { ...r, quantity: q, costPreview: money((r.averageCost ?? 0) * q) };
    };
    updateCurrentRows((current) => current.map(update));
  };

  const copyRecipeToOtherVariants = () => {
    if (rows.length === 0 || recipeMode === 'skip') return;
    setRowsByVariant((prev) => {
      const next = { ...prev };
      for (const v of recipeVariants) {
        if (v !== recipeVariant) next[v] = rows.map((r) => ({ ...r, key: uid() }));
      }
      return next;
    });
    setModeByVariant((prev) => {
      const next = { ...prev };
      for (const v of recipeVariants) {
        if (v !== recipeVariant) next[v] = recipeMode;
      }
      return next;
    });
  };

  // ── Recipe: voice ──
  const blobToBase64 = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

  const stopMic = () => {
    try { recRef.current?.stop?.(); } catch { /* ignore */ }
    try { recorderRef.current?.stop?.(); } catch { /* ignore */ }
    try { streamRef.current?.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
    setRecording(false);
  };

  const runVoiceExtract = async (text: string) => {
    const trimmed = (text || '').trim();
    if (trimmed.length < 3) { setRecipeError('Say or type at least one ingredient, like “200g paneer, 100g tomato”.'); return; }
    setRecipeLoading(true);
    setRecipeError('');
    try {
      const draft = await api.recipeAiQuickCreate(productId!, trimmed);
      if (!draft) { setRecipeError('Could not reach the AI — add the ingredients one by one instead.'); return; }
      const toRow = (m: any, needsReview: boolean): RecipeRow => ({
        key: uid(),
        inventoryItemId: m.inventoryItemId,
        itemName: m.itemName || m.ingredientText,
        unit: m.itemUnit || m.unit || 'g',
        quantity: Number(m.quantity) || 0,
        averageCost: m.costPreview !== undefined && Number(m.quantity) > 0 ? money((m.costPreview || 0) / Number(m.quantity)) : undefined,
        costPreview: money(m.costPreview || 0),
        confidence: m.confidence,
        needsReview,
      });
      const matched = (draft.matched || []).map((m: any) => toRow(m, false));
      const attention = (draft.needsAttention || []).map((m: any) => toRow(m, true));
      setRowsByVariant((prev) => ({ ...prev, [recipeVariant]: [...matched, ...attention] }));
      setRecipeMode('voice');
    } catch (e: any) {
      setRecipeError(e?.response?.data?.error || e?.message || 'Could not parse the ingredients — try typing them instead.');
    } finally {
      setRecipeLoading(false);
    }
  };

  const recordMedia = async () => {
    if (!navigator.mediaDevices?.getUserMedia) { setRecipeError('Microphone not available here — type the ingredients below instead.'); return; }
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
          setRecipeText(transcript);
          await runVoiceExtract(transcript);
        } catch (e: any) {
          setRecipeError(e?.response?.data?.error || e?.message || 'Could not hear you — type the ingredients below instead.');
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
      chunksRef.current = chunks;
      recorder.start();
      setRecording(true);
      setRecipeError('');
    } catch (e: any) {
      setRecording(false);
      setRecipeError(`Microphone blocked (${e?.name || 'error'}) — type the ingredients below instead.`);
    }
  };

  const startListening = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR || (window as any).electronAPI) { void recordMedia(); return; }
    const rec = new SR();
    rec.lang = 'hi-IN';
    rec.interimResults = false;
    rec.maxAlternatives = 3;
    rec.onresult = (e: any) => {
      let t = '';
      for (let i = e.resultIndex; i < e.results.length; i++) t += e.results[i][0].transcript;
      setRecording(false);
      void runVoiceExtract(t);
    };
    rec.onerror = (e: any) => {
      setRecording(false);
      if (e?.error === 'not-allowed' || e?.error === 'network') { void recordMedia(); return; }
      setRecipeError('Voice failed — type the ingredients below instead.');
    };
    rec.onend = () => setRecording(false);
    recRef.current = rec;
    rec.start();
    setRecording(true);
    setRecipeError('');
  };

  const marginPct = useMemo(() => {
    if (!(recipeVariantPrice > 0)) return null;
    return Math.round(((recipeVariantPrice - recipeCost) / recipeVariantPrice) * 100);
  }, [recipeVariantPrice, recipeCost]);

  // ── Render helpers ──
  const attachedKeys = useMemo(() => {
    const s = new Set<string>();
    if (variantGroup?.sourceTemplateId) s.add(variantGroup.sourceTemplateId);
    for (const g of [...addOnGroups, ...customGroups]) if (g.sourceTemplateId) s.add(g.sourceTemplateId);
    return s;
  }, [variantGroup, addOnGroups, customGroups]);

  const canNext = () => {
    if (step === 0) return pName.trim().length > 0 && !!pCategory && !taxAmbiguous;
    if (step === 1) return step2Valid();
    return true;
  };

  return (
    <div className="fixed inset-0 bg-[var(--color-sidebar-bg)]/75 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto">
      <div className="bg-[var(--color-bg-white)] rounded-xl shadow-2xl max-w-2xl w-full border border-[var(--color-border-default)] overflow-hidden my-4">
        {/* Header */}
        <div className="bg-[var(--color-primary-light)] px-6 py-4 border-b border-[var(--color-border-default)] flex justify-between items-center">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[var(--brand-color)]" />
            <h3 className="font-bold text-[var(--color-text-primary)] text-sm">Register New Dish</h3>
          </div>
          <button onClick={handleClose} className="text-gray-400 hover:text-gray-600 cursor-pointer"><X className="w-5 h-5" /></button>
        </div>

        {/* Stepper */}
        <div className="px-6 pt-4 flex items-center gap-1 overflow-x-auto">
          {STEP_LABELS.map((label, i) => (
            <React.Fragment key={label}>
              {i > 0 && <div className={`h-px flex-1 min-w-3 ${i <= step ? 'bg-[var(--brand-color)]' : 'bg-[var(--color-border-default)]'}`} />}
              <button
                onClick={() => i < step && setStep(i)}
                disabled={i > step}
                className={`flex items-center gap-1.5 shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold transition-colors ${i === step ? 'bg-[var(--brand-color)] text-white' : i < step ? 'bg-emerald-50 text-emerald-700 cursor-pointer' : 'bg-gray-100 text-gray-400'}`}
              >
                {i < step ? <CheckCircle2 className="w-3 h-3" /> : <span className="w-3.5 h-3.5 rounded-full bg-white/20 flex items-center justify-center text-[8px]">{i + 1}</span>}
                <span className="hidden sm:inline whitespace-nowrap">{label}</span>
              </button>
            </React.Fragment>
          ))}
        </div>

        {/* Body */}
        <div className="p-6 max-h-[65vh] overflow-y-auto">
          {/* ── STEP 1: Basic Details ── */}
          {step === 0 && (
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-semibold uppercase text-gray-500 tracking-wider mb-1">SKU / Code</label>
                <input
                  type="text"
                  value={pCode}
                  onChange={(e) => setPCode(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--color-border-input)] text-xs font-mono font-bold focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]"
                />
              </div>

              {/* Category — works with zero categories (spec §3) */}
              <div>
                <label className="block text-[10px] font-semibold uppercase text-gray-500 tracking-wider mb-1">Category</label>
                {realCategories.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-[var(--color-border-default)] p-3">
                    {!catCreating ? (
                      <button
                        type="button"
                        onClick={() => setCatCreating(true)}
                        className="flex items-center gap-1.5 text-xs font-bold text-[var(--brand-color)] hover:underline cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" /> Create New Category
                      </button>
                    ) : (
                      <div className="flex gap-1.5 animate-fade-in">
                        <input
                          type="text"
                          autoFocus
                          placeholder="Category name..."
                          value={newCatInput}
                          onChange={(e) => setNewCatInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              const c = createCategory(newCatInput);
                              if (c) { setPCategory(c); setCatCreating(false); setNewCatInput(''); }
                            }
                          }}
                          className="flex-1 px-3 py-2 rounded-lg border border-[var(--color-border-input)] text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const c = createCategory(newCatInput);
                            if (c) { setPCategory(c); setCatCreating(false); setNewCatInput(''); }
                          }}
                          className="px-3 py-2 bg-[var(--brand-color)] hover:bg-[var(--color-primary-hover)] text-white text-xs font-bold rounded-lg cursor-pointer shrink-0 transition-colors"
                        >
                          Add
                        </button>
                        <button
                          type="button"
                          onClick={() => { setCatCreating(false); setNewCatInput(''); }}
                          className="px-3 py-2 text-xs font-semibold text-gray-500 hover:text-gray-700 cursor-pointer shrink-0"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div>
                    <div className="flex gap-1.5">
                      <select
                        value={pCategory}
                        onChange={(e) => setPCategory(e.target.value)}
                        className="flex-1 px-3 py-2 rounded-lg border border-[var(--color-border-input)] text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]"
                      >
                        {realCategories.map((c) => <option key={c} value={c}>{c}</option>)}
                        <option value="__NEW_CATEGORY__">➕ Create New Category...</option>
                      </select>
                    </div>
                    {pCategory === '__NEW_CATEGORY__' && (
                      <div className="mt-2 flex gap-1.5 animate-fade-in">
                        <input
                          type="text"
                          placeholder="New category name..."
                          value={newCatInput}
                          onChange={(e) => setNewCatInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              const c = createCategory(newCatInput);
                              if (c) { setPCategory(c); setNewCatInput(''); }
                            }
                          }}
                          className="flex-1 px-3 py-2 rounded-lg border border-[var(--color-border-input)] text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[var(--brand-color)]"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const c = createCategory(newCatInput);
                            if (c) { setPCategory(c); setNewCatInput(''); }
                          }}
                          className="px-3 py-2 bg-[var(--brand-color)] hover:bg-[var(--color-primary-hover)] text-white text-xs font-bold rounded-lg cursor-pointer shrink-0 transition-colors"
                        >
                          Add
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Name */}
              <div>
                <label className="block text-[10px] font-semibold uppercase text-gray-500 tracking-wider mb-1">Product / Dish Name</label>
                <input
                  type="text"
                  placeholder="e.g. Paneer Kadhai"
                  value={pName}
                  onChange={(e) => setPName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--color-border-input)] text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]"
                />
              </div>

              {/* Product Classification — input to tax recommendation (never the rate itself) */}
              <div>
                <label className="block text-[10px] font-semibold uppercase text-gray-500 tracking-wider mb-1">Product Classification</label>
                <select
                  value={taxClassification}
                  onChange={(e) => {
                    setTaxClassification(e.target.value as TaxClassificationKey);
                    // Re-select resets to the automatic recommendation for that classification.
                    setTaxSource('automatic');
                    setManualGst(null);
                  }}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--color-border-input)] text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]"
                >
                  {TAX_CLASSIFICATIONS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
              </div>

              {/* Tax Treatment — automatic by default, overridable, never invented */}
              <div>
                <label className="block text-[10px] font-semibold uppercase text-gray-500 tracking-wider mb-1">Tax Treatment</label>
                {taxAmbiguous ? (
                  <div className="rounded-xl border border-amber-300 bg-amber-50/70 p-3">
                    <p className="text-xs font-bold text-amber-800 flex items-center gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" /> Tax treatment needs confirmation
                    </p>
                    <p className="text-[10px] text-amber-700 mt-1">
                      No GST rate is configured for “{TAX_CLASSIFICATIONS.find((c) => c.key === taxClassification)?.label}”.
                      Set a custom rate below or pick from the configured rates.
                    </p>
                    {taxClassification === 'other' && (
                      <div className="mt-2.5 flex items-center gap-1.5">
                        <span className="text-[10px] font-semibold text-amber-800 shrink-0">Custom GST rate</span>
                        <input
                          type="number" min={0} max={100} step="0.1"
                          value={customRateInput}
                          onChange={(e) => setCustomRateInput(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter' && applyCustomRate(customRateInput)) { setCustomRateInput(''); } }}
                          placeholder="e.g. 7"
                          className="w-20 px-2.5 py-1.5 rounded-lg border border-amber-300 bg-white text-xs font-mono font-bold focus:outline-none focus:ring-2 focus:ring-amber-500"
                        />
                        <span className="text-[10px] font-bold text-amber-800">%</span>
                        <button
                          type="button"
                          onClick={() => { if (applyCustomRate(customRateInput)) setCustomRateInput(''); }}
                          disabled={!validCustomRate(customRateInput)}
                          className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-bold cursor-pointer disabled:opacity-50 transition-colors"
                        >
                          Apply
                        </button>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={openTaxPicker}
                      className="mt-2 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-bold cursor-pointer transition-colors"
                    >
                      Select Tax Treatment
                    </button>
                  </div>
                ) : (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-bold text-emerald-800 flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> GST {Number(effectiveGst)}%
                      </p>
                      <span className={`shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded ${taxSource === 'manual' ? 'bg-violet-50 text-violet-700 border border-violet-200' : 'bg-emerald-100 text-emerald-800'}`}>
                        {taxSource === 'manual' ? 'Manually selected' : 'Automatically selected'}
                      </span>
                    </div>
                    <p className="text-[10px] text-emerald-700 mt-1">
                      {taxSource === 'automatic'
                        ? `Based on: ${TAX_CLASSIFICATIONS.find((c) => c.key === taxClassification)?.label}`
                        : 'You chose this rate — it overrides the automatic recommendation.'}
                    </p>
                    <button
                      type="button"
                      onClick={openTaxPicker}
                      className="mt-2 px-3 py-1.5 rounded-lg border border-emerald-300 text-emerald-800 text-[11px] font-bold hover:bg-emerald-100 cursor-pointer transition-colors"
                    >
                      Change
                    </button>
                  </div>
                )}
              </div>

              {/* Image */}
              <div>
                <label className="block text-[10px] font-semibold uppercase text-gray-500 tracking-wider mb-1">Product Image</label>
                <ImageInput value={pImage} onChange={setPImage} previewClass="w-20 h-20 rounded-xl" hint="Upload a photo or paste an image link — the real photo is used everywhere." />
              </div>

              {/* Availability */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={pAvailability} onChange={(e) => setPAvailability(e.target.checked)} className="accent-[var(--brand-color)]" />
                <span className="text-xs font-semibold text-gray-700">Available for ordering</span>
              </label>

              {step1Error && (
                <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-[11px] font-semibold text-red-700">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {step1Error}
                </div>
              )}
            </div>
          )}

          {/* Tax treatment picker — options come from the restaurant's configured rates */}
          {taxPickerOpen && (
            <div className="fixed inset-0 bg-[var(--color-sidebar-bg)]/75 backdrop-blur-sm flex items-center justify-center p-4 z-[60] overflow-y-auto">
              <div className="bg-[var(--color-bg-white)] rounded-xl shadow-2xl max-w-sm w-full border border-[var(--color-border-default)] overflow-hidden">
                <div className="bg-[var(--color-primary-light)] px-5 py-3 border-b border-[var(--color-border-default)] flex justify-between items-center">
                  <h4 className="text-xs font-bold text-[var(--color-text-primary)]">
                    {taxAmbiguous ? 'Select Tax Treatment' : 'Change Tax Treatment'}
                  </h4>
                  <button onClick={() => setTaxPickerOpen(false)} className="text-gray-400 hover:text-gray-600 cursor-pointer"><X className="w-4 h-4" /></button>
                </div>
                <div className="p-4 space-y-2">
                  <p className="text-[10px] text-gray-500 mb-2">Choose the GST rate that applies to this dish — one of your configured rates, or a custom rate of your own.</p>
                  {availableRates.length === 0 && !taxPickCustom ? (
                    <p className="text-[10px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      No tax rates are configured yet. Pick the custom rate below, or add a Default Tax Rate / Tax Rules in Settings → Billing &amp; Invoice.
                    </p>
                  ) : availableRates.map((r) => (
                    <label
                      key={r}
                      className={`flex items-center gap-2 rounded-xl border p-3 cursor-pointer transition-all ${!taxPickCustom && taxPickDraft === r ? 'border-[var(--brand-color)] bg-[var(--color-primary-light)]' : 'border-[var(--color-border-default)] bg-[var(--color-bg-white)]'}`}
                    >
                      <input
                        type="radio"
                        checked={!taxPickCustom && taxPickDraft === r}
                        onChange={() => { setTaxPickCustom(false); setTaxPickDraft(r); }}
                        className="accent-[var(--brand-color)]"
                      />
                      <span className="text-xs font-bold text-[var(--color-text-primary)]">GST {r}%</span>
                    </label>
                  ))}

                  {/* Custom rate — any valid GST (0–100%), e.g. for 'Other' classifications. */}
                  <div className={`rounded-xl border p-3 transition-all ${taxPickCustom ? 'border-[var(--brand-color)] bg-[var(--color-primary-light)]' : 'border-[var(--color-border-default)] bg-[var(--color-bg-white)]'}`}>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        checked={taxPickCustom}
                        onChange={() => { setTaxPickCustom(true); setTaxPickDraft(null); }}
                        className="accent-[var(--brand-color)]"
                      />
                      <span className="text-xs font-bold text-[var(--color-text-primary)]">Custom GST rate</span>
                    </label>
                    {taxPickCustom && (
                      <div className="mt-2 flex items-center gap-1.5 animate-fade-in">
                        <input
                          type="number" min={0} max={100} step="0.1" autoFocus
                          value={taxPickCustomValue}
                          onChange={(e) => setTaxPickCustomValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && validCustomRate(taxPickCustomValue)) {
                              setManualGst(Number(taxPickCustomValue));
                              setTaxSource('manual');
                              setTaxPickerOpen(false);
                            }
                          }}
                          placeholder="e.g. 7"
                          className="w-24 px-2.5 py-1.5 rounded-lg border border-[var(--color-border-input)] text-xs font-mono font-bold focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]"
                        />
                        <span className="text-xs font-bold text-gray-500">%</span>
                        <p className="text-[9px] text-gray-400 ml-1">Any rate from 0% to 100%.</p>
                      </div>
                    )}
                  </div>
                </div>
                <div className="px-5 py-3 border-t border-[var(--color-border-default)] flex justify-end gap-2">
                  <button onClick={() => setTaxPickerOpen(false)} className="px-3 py-2 text-[11px] font-semibold text-gray-500 hover:text-gray-700 cursor-pointer">Cancel</button>
                  <button
                    onClick={() => {
                      if (taxPickCustom) {
                        if (applyCustomRate(taxPickCustomValue)) setTaxPickerOpen(false);
                      } else if (taxPickDraft !== null) {
                        setManualGst(taxPickDraft);
                        setTaxSource('manual');
                        setTaxPickerOpen(false);
                      }
                    }}
                    disabled={taxPickCustom ? !validCustomRate(taxPickCustomValue) : taxPickDraft === null}
                    className="px-4 py-2 rounded-lg bg-[var(--brand-color)] hover:bg-[var(--color-primary-hover)] text-white text-[11px] font-bold disabled:opacity-50 cursor-pointer transition-colors"
                  >
                    Apply
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── STEP 2: Price & Variants ── */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <p className="text-[10px] font-bold uppercase text-gray-500 tracking-wider mb-2">How is this dish sold?</p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setPricingMode('single')}
                    className={`rounded-xl border p-3 text-left cursor-pointer transition-all ${pricingMode === 'single' ? 'border-[var(--brand-color)] bg-[var(--color-primary-light)]' : 'border-[var(--color-border-default)] bg-[var(--color-bg-white)] hover:border-gray-300'}`}
                  >
                    <span className="block text-xs font-bold text-[var(--color-text-primary)]">No Variants</span>
                    <span className="block text-[10px] text-gray-500 mt-0.5">One selling price for the dish.</span>
                  </button>
                  <button
                    onClick={() => setPricingMode('variants')}
                    className={`rounded-xl border p-3 text-left cursor-pointer transition-all ${pricingMode === 'variants' ? 'border-[var(--brand-color)] bg-[var(--color-primary-light)]' : 'border-[var(--color-border-default)] bg-[var(--color-bg-white)] hover:border-gray-300'}`}
                  >
                    <span className="block text-xs font-bold text-[var(--color-text-primary)]">Has Variants</span>
                    <span className="block text-[10px] text-gray-500 mt-0.5">e.g. Half ₹120 / Full ₹200 — each variant is its own selling price.</span>
                  </button>
                </div>
              </div>

              {pricingMode === 'single' ? (
                <div>
                  <label className="block text-[10px] font-semibold uppercase text-gray-500 tracking-wider mb-1">Selling Price ({currencySymbol})</label>
                  <input
                    type="number" min={0} step="0.01"
                    value={sellingPrice}
                    onChange={(e) => setSellingPrice(e.target.value)}
                    placeholder="0.00"
                    className="w-full px-3 py-2 rounded-lg border border-[var(--color-border-input)] text-sm font-mono font-bold focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]"
                  />
                  <p className="text-[10px] text-gray-400 mt-1">This is the dish's effective selling price.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {!variantGroup ? (
                    <div className="flex gap-2">
                      <button
                        onClick={() => setVariantBuilderOpen(true)}
                        className="flex-1 rounded-xl border-2 border-dashed border-[var(--color-border-default)] hover:border-[var(--brand-color)] p-3 text-xs font-bold text-[var(--color-text-primary)] cursor-pointer transition-colors bg-[var(--color-bg-white)]"
                      >
                        <Plus className="w-4 h-4 mx-auto mb-1 text-[var(--brand-color)]" /> Create New Variant Group
                      </button>
                      <button
                        onClick={() => setVariantPickerOpen(true)}
                        className="flex-1 rounded-xl border-2 border-dashed border-[var(--color-border-default)] hover:border-[var(--brand-color)] p-3 text-xs font-bold text-[var(--color-text-primary)] cursor-pointer transition-colors bg-[var(--color-bg-white)]"
                      >
                        <Copy className="w-4 h-4 mx-auto mb-1 text-violet-600" /> Reuse Existing Group
                      </button>
                    </div>
                  ) : (
                    <GroupSummaryCard group={variantGroup} currencySymbol={currencySymbol} onRemove={() => setVariantGroup(null)} />
                  )}
                </div>
              )}

              {variantPickerOpen && (
                <ReusePicker
                  type="VARIANT_GROUP"
                  templates={templates.VARIANT_GROUP}
                  attachedKeys={attachedKeys}
                  currencySymbol={currencySymbol}
                  onPick={handlePickVariant}
                  onCancel={() => setVariantPickerOpen(false)}
                />
              )}
              {variantBuilderOpen && (
                <GroupBuilder
                  type="VARIANT_GROUP"
                  currencySymbol={currencySymbol}
                  onDone={(name, options) => {
                    setVariantGroup({ key: uid(), type: 'VARIANT_GROUP', name, options, mode: 'new' });
                    setVariantBuilderOpen(false);
                  }}
                  onCancel={() => setVariantBuilderOpen(false)}
                />
              )}
            </div>
          )}

          {/* ── STEP 3: Add-ons & Customizations ── */}
          {step === 2 && (
            <div className="space-y-5">
              {/* Add-ons */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] font-bold uppercase text-gray-500 tracking-wider">Add-ons <span className="normal-case font-medium text-gray-400">(extra cheese +₹40, extra paneer +₹60)</span></p>
                  <div className="flex gap-1.5">
                    <button onClick={() => setAddOnPickerOpen(!addOnPickerOpen)} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-violet-50 hover:bg-violet-100 text-violet-700 text-[10px] font-bold cursor-pointer transition-colors">
                      <Copy className="w-3 h-3" /> Reuse group
                    </button>
                    <button onClick={() => setAddOnBuilderOpen(!addOnBuilderOpen)} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[var(--color-primary-light)] hover:bg-[var(--color-primary-light)]/70 text-[var(--brand-color)] text-[10px] font-bold cursor-pointer transition-colors">
                      <Plus className="w-3 h-3" /> New group
                    </button>
                  </div>
                </div>
                {addOnGroups.length > 0 && (
                  <div className="space-y-2 mb-2">
                    {addOnGroups.map((g) => (
                      <GroupSummaryCard key={g.key} group={g} currencySymbol={currencySymbol} onRemove={() => setAddOnGroups(addOnGroups.filter((x) => x.key !== g.key))} />
                    ))}
                  </div>
                )}
                {addOnPickerOpen && (
                  <ReusePicker
                    type="ADD_ON_GROUP"
                    templates={templates.ADD_ON_GROUP}
                    attachedKeys={attachedKeys}
                    currencySymbol={currencySymbol}
                    onPick={(t, m) => handlePickGroup('ADD_ON_GROUP', t, m)}
                    onCancel={() => setAddOnPickerOpen(false)}
                  />
                )}
                {addOnBuilderOpen && (
                  <GroupBuilder
                    type="ADD_ON_GROUP"
                    currencySymbol={currencySymbol}
                    onDone={(name, options) => {
                      setAddOnGroups([...addOnGroups, { key: uid(), type: 'ADD_ON_GROUP', name, options, mode: 'new' }]);
                      setAddOnBuilderOpen(false);
                    }}
                    onCancel={() => setAddOnBuilderOpen(false)}
                  />
                )}
              </div>

              {/* Customizations */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] font-bold uppercase text-gray-500 tracking-wider">Customizations <span className="normal-case font-medium text-gray-400">(spice level, sugar level)</span></p>
                  <div className="flex gap-1.5">
                    <button onClick={() => setCustomPickerOpen(!customPickerOpen)} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-violet-50 hover:bg-violet-100 text-violet-700 text-[10px] font-bold cursor-pointer transition-colors">
                      <Copy className="w-3 h-3" /> Reuse group
                    </button>
                    <button onClick={() => setCustomBuilderOpen(!customBuilderOpen)} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[var(--color-primary-light)] hover:bg-[var(--color-primary-light)]/70 text-[var(--brand-color)] text-[10px] font-bold cursor-pointer transition-colors">
                      <Plus className="w-3 h-3" /> New group
                    </button>
                  </div>
                </div>
                {customGroups.length > 0 && (
                  <div className="space-y-2 mb-2">
                    {customGroups.map((g) => (
                      <GroupSummaryCard key={g.key} group={g} currencySymbol={currencySymbol} onRemove={() => setCustomGroups(customGroups.filter((x) => x.key !== g.key))} />
                    ))}
                  </div>
                )}
                {customPickerOpen && (
                  <ReusePicker
                    type="MODIFIER_GROUP"
                    templates={templates.MODIFIER_GROUP}
                    attachedKeys={attachedKeys}
                    currencySymbol={currencySymbol}
                    onPick={(t, m) => handlePickGroup('MODIFIER_GROUP', t, m)}
                    onCancel={() => setCustomPickerOpen(false)}
                  />
                )}
                {customBuilderOpen && (
                  <GroupBuilder
                    type="MODIFIER_GROUP"
                    currencySymbol={currencySymbol}
                    onDone={(name, options) => {
                      setCustomGroups([...customGroups, { key: uid(), type: 'MODIFIER_GROUP', name, options, mode: 'new' }]);
                      setCustomBuilderOpen(false);
                    }}
                    onCancel={() => setCustomBuilderOpen(false)}
                  />
                )}
              </div>

              {addOnGroups.length === 0 && customGroups.length === 0 && (
                <p className="text-[10px] text-gray-400 text-center py-2">No add-ons or customizations yet — that's fine, you can add them later from the dish's configuration editor.</p>
              )}
            </div>
          )}

          {/* ── STEP 4: Recipe ── */}
          {step === 3 && (
            <div className="space-y-4">
              <p className="text-[10px] font-bold uppercase text-gray-500 tracking-wider">Recipe (optional)</p>

              {recipeVariants.length > 1 && (
                <div className="flex items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] font-bold uppercase text-gray-500 tracking-wider">Recipe for:</span>
                    {recipeVariants.map((v) => {
                      const vHasRows = (rowsByVariant[v] || []).length > 0;
                      const vPrice = variantGroup?.options?.find((o) => o.name === v)?.price;
                      return (
                        <button
                          key={v}
                          onClick={() => setRecipeVariant(v)}
                          className={`px-2.5 py-1 rounded-full border text-[10px] font-bold cursor-pointer transition-all ${recipeVariant === v ? 'border-[var(--brand-color)] bg-[var(--color-primary-light)] text-[var(--color-text-primary)]' : 'border-[var(--color-border-default)] text-gray-500 hover:border-gray-300'}`}
                        >
                          <span className={`mr-1 ${vHasRows ? 'text-emerald-600' : 'text-gray-300'}`}>{vHasRows ? '✓' : '○'}</span>
                          {v}{vPrice ? ` · ${fmt(vPrice, currencySymbol)}` : ''}
                        </button>
                      );
                    })}
                  </div>
                  <button
                    onClick={copyRecipeToOtherVariants}
                    disabled={rows.length === 0 || recipeMode === 'skip'}
                    className="text-[10px] font-semibold text-[var(--brand-color)] hover:underline cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                  >
                    Copy to all
                  </button>
                </div>
              )}

              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => { setRecipeMode('skip'); updateCurrentRows(() => []); }}
                  className={`rounded-xl border p-3 text-left cursor-pointer transition-all ${recipeMode === 'skip' ? 'border-[var(--brand-color)] bg-[var(--color-primary-light)]' : 'border-[var(--color-border-default)] hover:border-gray-300'}`}
                >
                  <span className="block text-xs font-bold text-[var(--color-text-primary)]">Skip for now</span>
                  <span className="block text-[10px] text-gray-500 mt-0.5">Register the dish — add a recipe later from Inventory.</span>
                </button>
                <button
                  onClick={() => setRecipeMode('manual')}
                  className={`rounded-xl border p-3 text-left cursor-pointer transition-all ${recipeMode === 'manual' ? 'border-[var(--brand-color)] bg-[var(--color-primary-light)]' : 'border-[var(--color-border-default)] hover:border-gray-300'}`}
                >
                  <span className="block text-xs font-bold text-[var(--color-text-primary)]">Add ingredients</span>
                  <span className="block text-[10px] text-gray-500 mt-0.5">Pick raw materials from your inventory one by one.</span>
                </button>
                <button
                  onClick={() => { setRecipeMode('voice'); if (rows.length === 0) setRecipeText(''); }}
                  className={`rounded-xl border p-3 text-left cursor-pointer transition-all ${recipeMode === 'voice' ? 'border-[var(--brand-color)] bg-[var(--color-primary-light)]' : 'border-[var(--color-border-default)] hover:border-gray-300'}`}
                >
                  <span className="block text-xs font-bold text-[var(--color-text-primary)]">Describe it</span>
                  <span className="block text-[10px] text-gray-500 mt-0.5">“200g paneer, 100g tomato, 50ml cream” — voice or text.</span>
                </button>
              </div>

              {recipeMode === 'manual' && (
                <div className="space-y-3">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                    <input
                      value={recipeSearch}
                      onChange={(e) => {
                        setRecipeSearch(e.target.value);
                        void runRecipeSearch(e.target.value);
                      }}
                      placeholder="Search inventory — e.g. paneer, fresh milk, tomato..."
                      className="w-full pl-8 pr-3 py-2 rounded-lg border border-[var(--color-border-input)] text-xs focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]"
                    />
                  </div>
                  {recipeLoading && <p className="text-[10px] text-gray-400 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Searching...</p>}
                  {recipeResults && recipeResults.length > 0 && (
                    <div className="border border-[var(--color-border-default)] rounded-xl divide-y divide-[var(--color-border-default)] max-h-44 overflow-y-auto">
                      {recipeResults.map((item) => (
                        <button
                          key={item._id}
                          onClick={() => addManualRow(item)}
                          className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[var(--color-primary-light)] cursor-pointer transition-colors"
                        >
                          <span className="w-8 h-8 rounded-lg overflow-hidden bg-gray-100 border border-gray-200 flex items-center justify-center shrink-0">
                            {item.image ? (
                              <img src={item.image} alt="" className="w-full h-full object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                            ) : (
                              <span className="text-xs font-black text-gray-300">{String(item.name).charAt(0).toUpperCase()}</span>
                            )}
                          </span>
                          <span className="flex-1 min-w-0">
                            <span className="block text-xs font-bold text-[var(--color-text-primary)] truncate">{item.name}</span>
                            <span className="block text-[10px] text-gray-500">per {item.unit || 'unit'}{Number(item.averageCost) > 0 ? ` · ${fmt(item.averageCost, currencySymbol)}` : ''}{Number(item.currentStock) > 0 ? ` · stock ${item.currentStock}` : ''}</span>
                          </span>
                          <Plus className="w-3.5 h-3.5 text-[var(--brand-color)] shrink-0" />
                        </button>
                      ))}
                    </div>
                  )}
                  {recipeResults && recipeResults.length === 0 && !recipeLoading && (
                    <p className="text-[10px] text-gray-400">No inventory items match “{recipeSearch}”.</p>
                  )}
                </div>
              )}

              {recipeMode === 'voice' && (
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <button
                      onClick={() => (recording ? stopMic() : startListening())}
                      disabled={transcribing}
                      className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold cursor-pointer transition-colors disabled:opacity-50 ${recording ? 'bg-red-600 text-white' : 'bg-[var(--brand-color)] hover:bg-[var(--color-primary-hover)] text-white'}`}
                    >
                      {transcribing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mic className="w-3.5 h-3.5" />}
                      {recording ? 'Stop & parse' : transcribing ? 'Listening...' : 'Say ingredients'}
                    </button>
                  </div>
                  <textarea
                    value={recipeText}
                    onChange={(e) => setRecipeText(e.target.value)}
                    placeholder='Or type it — e.g. "Add 200 grams paneer, 100 grams tomato, 50 ml cream and 20 grams butter."'
                    rows={2}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--color-border-input)] text-xs focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)] resize-none"
                  />
                  <button
                    onClick={() => void runVoiceExtract(recipeText)}
                    disabled={recipeLoading || recipeText.trim().length < 3}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 text-[11px] font-bold cursor-pointer disabled:opacity-50 transition-colors"
                  >
                    {recipeLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                    Parse ingredients
                  </button>
                  {recipeLoading && <p className="text-[10px] text-gray-400 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Matching against your inventory...</p>}
                </div>
              )}

              {recipeError && (
                <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-[11px] font-semibold text-red-700">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {recipeError}
                </div>
              )}

              {(rows.length > 0 || recipeMode !== 'skip') && (
                <div className="rounded-xl border border-[var(--color-border-default)] overflow-hidden">
                  <div className="px-3 py-2 bg-[var(--color-primary-light)] border-b border-[var(--color-border-default)] flex items-center justify-between">
                    <p className="text-[10px] font-bold uppercase text-gray-500 tracking-wider">{recipeVariants.length > 1 ? `Recipe for ${recipeVariant}` : 'Recipe ingredients'}</p>
                    {recipeMode !== 'skip' && (
                      <button onClick={() => { updateCurrentRows(() => []); setRecipeMode('skip'); }} className="text-[10px] font-semibold text-gray-400 hover:text-red-600 cursor-pointer">Clear</button>
                    )}
                  </div>
                  {rows.length === 0 ? (
                    <p className="px-3 py-3 text-[10px] text-gray-400">No ingredients yet.</p>
                  ) : (
                    <>
                      <div className="divide-y divide-[var(--color-border-default)]">
                        {rows.map((r) => (
                          <div key={r.key} className="flex items-center gap-2 px-3 py-2">
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-bold text-[var(--color-text-primary)] truncate">
                                {r.itemName}
                                {r.needsReview && <span className="ml-1.5 text-[9px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-1 py-0.5 rounded align-middle">check</span>}
                              </p>
                              <p className="text-[10px] text-gray-400">per {r.unit}{r.averageCost !== undefined ? ` · ${fmt(r.averageCost, currencySymbol)}` : ''}</p>
                            </div>
                            <input
                              type="number" min={0}
                              value={r.quantity}
                              onChange={(e) => setRowQty(r.key, Number(e.target.value))}
                              className="w-20 px-2 py-1.5 rounded-lg border border-[var(--color-border-input)] text-xs font-mono font-bold text-right focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]"
                            />
                            <span className="text-[10px] text-gray-400 w-7">{r.unit}</span>
                            <span className="text-xs font-mono font-bold text-[var(--color-text-primary)] w-20 text-right">{fmt(r.costPreview ?? 0, currencySymbol)}</span>
                            <button onClick={() => updateCurrentRows((current) => current.filter((x) => x.key !== r.key))} className="p-1 text-gray-400 hover:text-red-600 cursor-pointer">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                      <div className="px-3 py-2 bg-gray-50 border-t border-[var(--color-border-default)] flex items-center justify-between">
                        <span className="text-[10px] font-bold uppercase text-gray-500 tracking-wider">Recipe cost</span>
                        <span className="text-xs font-mono font-bold text-[var(--color-text-primary)]">{fmt(recipeCost, currencySymbol)}</span>
                      </div>
                    </>
                  )}
                </div>
              )}

              {rows.length > 0 && recipeVariantPrice > 0 && (
                <div className="rounded-xl bg-emerald-50/70 border border-emerald-200 px-3 py-2 flex items-center justify-between">
                  <span className="text-[10px] font-semibold text-emerald-800">Selling price {fmt(recipeVariantPrice, currencySymbol)} · Estimated gross margin</span>
                  <span className={`text-xs font-mono font-bold ${(marginPct ?? 0) >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{marginPct}%</span>
                </div>
              )}
            </div>
          )}

          {/* ── STEP 5: Review ── */}
          {step === 4 && (
            <div className="space-y-4">
              <div className="rounded-xl border border-[var(--color-border-default)] p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl overflow-hidden bg-gray-100 border border-gray-200 flex items-center justify-center shrink-0">
                    {pImage ? (
                      <img src={pImage} alt={pName} className="w-full h-full object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                    ) : (
                      <FilePlus2 className="w-5 h-5 text-gray-300" />
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-black text-[var(--color-text-primary)]">{pName}</p>
                    <p className="text-[10px] text-gray-500 mt-0.5">{pCategory} · {pCode}</p>
                  </div>
                </div>

                <div>
                  <p className="text-[10px] font-bold uppercase text-gray-500 tracking-wider mb-1">Classification</p>
                  <p className="text-xs font-semibold text-[var(--color-text-primary)]">{TAX_CLASSIFICATIONS.find((c) => c.key === taxClassification)?.label}</p>
                </div>

                <div>
                  <p className="text-[10px] font-bold uppercase text-gray-500 tracking-wider mb-1">Tax Treatment</p>
                  <p className="text-xs font-bold text-[var(--color-text-primary)] flex items-center gap-1.5">
                    GST {Number(effectiveGst)}%
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${taxSource === 'manual' ? 'bg-violet-50 text-violet-700 border border-violet-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}`}>
                      {taxSource === 'manual' ? 'Manually selected' : 'Automatically selected'}
                    </span>
                  </p>
                </div>

                <div>
                  <p className="text-[10px] font-bold uppercase text-gray-500 tracking-wider mb-1">Pricing</p>
                  {pricingMode === 'single' ? (
                    <p className="text-xs font-bold text-[var(--color-text-primary)]">{fmt(Number(sellingPrice) || 0, currencySymbol)}</p>
                  ) : variantGroup ? (
                    <div className="space-y-1">
                      {variantGroup.options.map((o) => (
                        <p key={o.id} className="text-xs font-semibold text-[var(--color-text-primary)]">{o.name} — {fmt(o.price, currencySymbol)}</p>
                      ))}
                      <p className="text-[9px] text-violet-600 font-semibold">{variantGroup.mode === 'shared' ? `♻ Shared group${variantGroup.usage ? ` · used by ${variantGroup.usage} dish${variantGroup.usage === 1 ? '' : 'es'}` : ''}` : variantGroup.mode === 'copy' ? '✂ Independent copy' : 'New group'}</p>
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400">No variants configured.</p>
                  )}
                </div>

                {addOnGroups.length > 0 && (
                  <div>
                    <p className="text-[10px] font-bold uppercase text-gray-500 tracking-wider mb-1">Add-ons</p>
                    <div className="space-y-1">
                      {addOnGroups.map((g) => (
                        <p key={g.key} className="text-xs font-semibold text-[var(--color-text-primary)]">
                          {g.options.map((o) => `${o.name} +${fmt(o.price, currencySymbol)}`).join(' · ')}
                          <span className="text-[9px] text-gray-400 font-medium"> ({g.name}{g.mode === 'shared' && g.usage ? ` · shared by ${g.usage}` : g.mode === 'copy' ? ' · copy' : ''})</span>
                        </p>
                      ))}
                    </div>
                  </div>
                )}
                {customGroups.length > 0 && (
                  <div>
                    <p className="text-[10px] font-bold uppercase text-gray-500 tracking-wider mb-1">Customizations</p>
                    <div className="space-y-1">
                      {customGroups.map((g) => (
                        <p key={g.key} className="text-xs font-semibold text-[var(--color-text-primary)]">
                          {g.options.map((o) => o.name).join(' · ')}
                          <span className="text-[9px] text-gray-400 font-medium"> ({g.name}{g.mode === 'shared' && g.usage ? ` · shared by ${g.usage}` : g.mode === 'copy' ? ' · copy' : ''})</span>
                        </p>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <p className="text-[10px] font-bold uppercase text-gray-500 tracking-wider mb-1">Recipe</p>
                  {recipeVariants.map((v) => {
                    const vRows = rowsByVariant[v] || [];
                    if (vRows.length === 0) return null;
                    const vCost = money(vRows.reduce((s, r) => s + (r.costPreview ?? 0), 0));
                    const vPrice = variantGroup?.options?.find((o) => o.name === v)?.price;
                    const vRef = vPrice && Number(vPrice) > 0 ? Number(vPrice) : referencePrice;
                    const vPct = vRef > 0 ? Math.round(((vRef - vCost) / vRef) * 100) : null;
                    return (
                      <p key={v} className="text-xs font-semibold text-[var(--color-text-primary)]">
                        {v} — {vRows.length} ingredient{vRows.length === 1 ? '' : 's'} · {fmt(vCost, currencySymbol)}{vPct !== null ? ` · margin ${vPct}%` : ''}
                      </p>
                    );
                  })}
                  {recipeVariants.every((v) => (rowsByVariant[v] || []).length === 0) && (
                    <p className="text-xs text-gray-400">No recipe yet — can be added later from Inventory.</p>
                  )}
                </div>
              </div>

              {stepError && (
                <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-[11px] font-semibold text-red-700">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {stepError}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[var(--color-border-default)] flex justify-between items-center bg-[var(--color-bg-white)]">
          {step > 0 ? (
            <button
              onClick={() => setStep(step - 1)}
              disabled={creatingProduct}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-gray-600 hover:text-gray-800 disabled:opacity-50 cursor-pointer"
            >
              <ChevronLeft className="w-3.5 h-3.5" /> Back
            </button>
          ) : (
            <button onClick={handleClose} className="px-4 py-2 text-xs font-semibold text-gray-500 hover:text-gray-700 cursor-pointer">Cancel</button>
          )}

          <div className="flex items-center gap-2">
            {step === 4 && (
              <button
                onClick={handleRegister}
                disabled={registering}
                className="flex items-center gap-1.5 px-5 py-2 rounded-xl bg-[var(--brand-color)] hover:bg-[var(--color-primary-hover)] text-white text-xs font-bold disabled:opacity-50 cursor-pointer transition-colors"
              >
                {registering ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                {registering ? 'Registering...' : 'Register Dish'}
              </button>
            )}
            {step < 4 && (
              <button
                onClick={() => step === 0 ? void handleNextFromBasic() : setStep(step + 1)}
                disabled={!canNext() || creatingProduct}
                className="flex items-center gap-1.5 px-5 py-2 rounded-xl bg-[var(--brand-color)] hover:bg-[var(--color-primary-hover)] text-white text-xs font-bold disabled:opacity-50 cursor-pointer transition-colors"
              >
                {creatingProduct ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                Next <ChevronRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
