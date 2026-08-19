/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ProductConfigEditor — the menu configuration UX on top of the Phase 1
 * menu-config APIs. All resolution/inheritance logic lives server-side; this
 * component only calls the APIs and displays friendly results.
 *
 * Language guide (hide technical concepts):
 *   shared   → "Shared group" + "Used by N items"
 *   override → "Customized for this item"
 *   copy     → "Independent copy"
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  X, Plus, Copy, RotateCcw, Trash2, Search, CheckCircle2, AlertCircle,
  Loader2, SlidersHorizontal, Settings2, Info, Layers,
} from 'lucide-react';
import type {
  ConfigType, MenuConfigTemplate, MenuConfigOption, Product, ProductConfigRef,
  ProductMenuConfig, ResolvedConfigGroup, ResolvedProductConfig, ResolvedConfigOption, SelectionMode,
} from '../../src/types';
import * as api from '../../src/api/client';

type Tab = 'overview' | 'variants' | 'customizations' | 'addons';

const EMPTY_CONFIG: ProductMenuConfig = {
  variantConfigurations: [],
  modifierConfigurations: [],
  addOnConfigurations: [],
};

const TYPE_LABEL: Record<ConfigType, string> = {
  VARIANT_GROUP: 'variant group',
  MODIFIER_GROUP: 'customization group',
  ADD_ON_GROUP: 'add-on group',
};

const TYPE_PLURAL: Record<ConfigType, string> = {
  VARIANT_GROUP: 'variants',
  MODIFIER_GROUP: 'customizations',
  ADD_ON_GROUP: 'add-ons',
};

const GROUP_DEFAULTS: Record<ConfigType, { selectionMode: SelectionMode; required: boolean; minSelections: number; maxSelections: number | null }> = {
  VARIANT_GROUP: { selectionMode: 'SINGLE', required: true, minSelections: 1, maxSelections: 1 },
  MODIFIER_GROUP: { selectionMode: 'MULTIPLE', required: false, minSelections: 0, maxSelections: null },
  ADD_ON_GROUP: { selectionMode: 'MULTIPLE', required: false, minSelections: 0, maxSelections: null },
};

function optionText(type: ConfigType, currencySymbol: string, o: MenuConfigOption | ResolvedConfigOption): string {
  if (type === 'ADD_ON_GROUP') return `${o.name} ${currencySymbol}${(o.price ?? 0).toFixed(2)}`;
  if (type === 'MODIFIER_GROUP') return `${o.name} +${currencySymbol}${((o as ResolvedConfigOption).priceDelta ?? o.priceDelta ?? 0).toFixed(2)}`;
  return `${o.name} ${currencySymbol}${((o as ResolvedConfigOption).priceDelta ?? o.priceDelta ?? 0).toFixed(2)}`;
}

function newOptionId(): string {
  return `opt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

// ─── Template picker: "Use an existing group" ─────────────────────

function TemplatePicker({ type, templates, usageMap, attachedIds, currencySymbol, onPick, onCreateNew, onClose }: {
  type: ConfigType;
  templates: MenuConfigTemplate[];
  usageMap: Record<string, number>;
  attachedIds: Set<string>;
  currencySymbol: string;
  onPick: (templateId: string) => void;
  onCreateNew: () => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const filtered = templates.filter((t) => !q || t.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="fixed inset-0 bg-[var(--color-sidebar-bg)]/75 backdrop-blur-sm flex items-center justify-center p-4 z-[60] overflow-y-auto">
      <div className="bg-[var(--color-bg-white)] rounded-xl shadow-2xl max-w-lg w-full border border-[var(--color-border-default)] overflow-hidden">
        <div className="bg-[var(--color-primary-light)] px-6 py-4 border-b border-[var(--color-border-default)] flex justify-between items-center">
          <h3 className="font-bold text-[var(--color-text-primary)] text-sm">Use an existing {TYPE_LABEL[type]}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 cursor-pointer"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4">
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search groups..."
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-[var(--color-border-input)] text-xs focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]"
            />
          </div>
          <div className="max-h-72 overflow-y-auto space-y-2">
            {filtered.map((t) => {
              const attached = attachedIds.has(t._id);
              const usedBy = usageMap[t._id] ?? 0;
              return (
                <button
                  key={t._id}
                  disabled={attached}
                  onClick={() => onPick(t._id)}
                  className={`w-full text-left rounded-xl border p-3 transition-all ${attached ? 'opacity-50 cursor-not-allowed bg-gray-50' : 'hover:border-[var(--brand-color)] hover:shadow-sm cursor-pointer bg-[var(--color-bg-white)]'} border-[var(--color-border-default)]`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-xs text-[var(--color-text-primary)]">{t.name}</span>
                    <span className="text-[9px] font-semibold text-gray-400 shrink-0">
                      {usedBy > 0 ? `used by ${usedBy} item${usedBy === 1 ? '' : 's'}` : 'unused'}{attached ? ' · already added' : ''}
                    </span>
                  </div>
                  <p className="text-[10px] text-gray-500 mt-1 truncate">
                    {(t.data.options ?? []).map((o) => optionText(type, currencySymbol, o)).join(' · ')}
                  </p>
                </button>
              );
            })}
            {filtered.length === 0 && <p className="text-[10px] text-gray-400 text-center py-4">No matching groups.</p>}
          </div>
        </div>
        <div className="px-6 py-4 border-t border-[var(--color-border-default)] flex justify-between items-center">
          <button onClick={onCreateNew} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold cursor-pointer transition-colors">
            <Plus className="w-3.5 h-3.5" /> Create a new group
          </button>
          <button onClick={onClose} className="px-3 py-2 text-xs font-semibold text-gray-500 hover:text-gray-700 cursor-pointer">Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ─── Template builder: create a new group / edit an independent copy ──

function TemplateBuilder({ type, template, currencySymbol, productId, onDone, onClose }: {
  type: ConfigType;
  template?: MenuConfigTemplate;
  currencySymbol: string;
  productId: string;
  onDone: () => void;
  onClose: () => void;
}) {
  const isEdit = !!template;
  const defaults = GROUP_DEFAULTS[type];
  const [name, setName] = useState(template?.name ?? '');
  const [selectionMode, setSelectionMode] = useState<SelectionMode>(template?.data.selectionMode ?? defaults.selectionMode);
  const [required, setRequired] = useState(template?.data.required ?? defaults.required);
  const [minSel, setMinSel] = useState(template?.data.minSelections ?? defaults.minSelections);
  const [maxSel, setMaxSel] = useState<number | null>(template?.data.maxSelections ?? defaults.maxSelections);
  const [options, setOptions] = useState<MenuConfigOption[]>((template?.data.options ?? []).map((o) => ({ ...o })));
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const data = {
        selectionMode,
        required,
        minSelections: Number(minSel) || 0,
        maxSelections: maxSel === null ? undefined : Number(maxSel),
        options: options.map((o) => ({
          id: o.id,
          name: o.name,
          priceDelta: Number(o.priceDelta) || 0,
          price: type === 'ADD_ON_GROUP' ? Number(o.price) || 0 : undefined,
          active: o.active !== false,
          sortOrder: o.sortOrder ?? 0,
          minQuantity: type === 'ADD_ON_GROUP' ? o.minQuantity : undefined,
          maxQuantity: type === 'ADD_ON_GROUP' ? o.maxQuantity : undefined,
        })),
      };
      if (isEdit) {
        await api.updateMenuConfigTemplate(template!._id, { data });
      } else {
        const created = await api.createMenuConfigTemplate({ name: name.trim(), type, data });
        if (created?._id) {
          await api.attachProductConfig(productId, { type, templateId: created._id, mode: 'shared' });
        }
      }
      onDone();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-[var(--color-sidebar-bg)]/75 backdrop-blur-sm flex items-center justify-center p-4 z-[60] overflow-y-auto">
      <div className="bg-[var(--color-bg-white)] rounded-xl shadow-2xl max-w-lg w-full border border-[var(--color-border-default)] overflow-hidden">
        <div className="bg-[var(--color-primary-light)] px-6 py-4 border-b border-[var(--color-border-default)] flex justify-between items-center">
          <h3 className="font-bold text-[var(--color-text-primary)] text-sm">
            {isEdit ? `Edit ${template!.name}` : `Create a new ${TYPE_LABEL[type]}`}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 cursor-pointer"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          <div>
            <label className="block text-[10px] font-semibold uppercase text-gray-500 tracking-wider mb-1">Group name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={type === 'VARIANT_GROUP' ? 'e.g. Size' : type === 'MODIFIER_GROUP' ? 'e.g. Crust' : 'e.g. Sides'}
              className="w-full px-3 py-2 rounded-lg border border-[var(--color-border-input)] text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]"
            />
          </div>

          {type !== 'VARIANT_GROUP' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-semibold uppercase text-gray-500 tracking-wider mb-1">Choose one or many</label>
                <select value={selectionMode} onChange={(e) => setSelectionMode(e.target.value as SelectionMode)} className="w-full px-3 py-2 rounded-lg border border-[var(--color-border-input)] text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]">
                  <option value="SINGLE">Pick one</option>
                  <option value="MULTIPLE">Pick many</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-semibold uppercase text-gray-500 tracking-wider mb-1">Required</label>
                <label className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--color-border-input)] cursor-pointer">
                  <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} className="accent-[var(--brand-color)]" />
                  <span className="text-xs font-semibold text-gray-700">{required ? 'Required' : 'Optional'}</span>
                </label>
              </div>
              {selectionMode === 'MULTIPLE' && (
                <>
                  <div>
                    <label className="block text-[10px] font-semibold uppercase text-gray-500 tracking-wider mb-1">Min selections</label>
                    <input type="number" min={0} value={minSel} onChange={(e) => setMinSel(Number(e.target.value))} className="w-full px-3 py-2 rounded-lg border border-[var(--color-border-input)] text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold uppercase text-gray-500 tracking-wider mb-1">Max selections</label>
                    <input type="number" min={0} placeholder="No limit" value={maxSel === null ? '' : maxSel} onChange={(e) => setMaxSel(e.target.value === '' ? null : Number(e.target.value))} className="w-full px-3 py-2 rounded-lg border border-[var(--color-border-input)] text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]" />
                  </div>
                </>
              )}
            </div>
          )}

          <div>
            <label className="block text-[10px] font-semibold uppercase text-gray-500 tracking-wider mb-2">Options</label>
            <div className="space-y-2">
              {options.map((o, i) => (
                <div key={o.id} className="flex items-center gap-2">
                  <input
                    value={o.name}
                    onChange={(e) => setOptions(options.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}
                    placeholder={type === 'VARIANT_GROUP' ? 'e.g. Large' : type === 'MODIFIER_GROUP' ? 'e.g. Extra Cheese' : 'e.g. Garlic Bread'}
                    className="flex-1 px-3 py-2 rounded-lg border border-[var(--color-border-input)] text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]"
                  />
                  <input
                    type="number" min={0} step="0.01"
                    value={o.priceDelta ?? o.price ?? 0}
                    onChange={(e) => setOptions(options.map((x, j) => j === i ? { ...x, [type === 'ADD_ON_GROUP' ? 'price' : 'priceDelta']: Number(e.target.value) } : x))}
                    placeholder="Price"
                    className="w-24 px-3 py-2 rounded-lg border border-[var(--color-border-input)] text-xs font-mono font-bold focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]"
                    title={type === 'MODIFIER_GROUP' ? 'Price added to the item' : 'Price'}
                  />
                  {type === 'ADD_ON_GROUP' && (
                    <>
                      <input
                        type="number" min={0}
                        value={o.minQuantity ?? ''}
                        onChange={(e) => setOptions(options.map((x, j) => j === i ? { ...x, minQuantity: e.target.value === '' ? undefined : Number(e.target.value) } : x))}
                        placeholder="Min qty"
                        title="Minimum quantity"
                        className="w-16 px-2 py-2 rounded-lg border border-[var(--color-border-input)] text-xs font-mono focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]"
                      />
                      <input
                        type="number" min={0}
                        value={o.maxQuantity ?? ''}
                        onChange={(e) => setOptions(options.map((x, j) => j === i ? { ...x, maxQuantity: e.target.value === '' ? undefined : Number(e.target.value) } : x))}
                        placeholder="Max qty"
                        title="Maximum quantity"
                        className="w-16 px-2 py-2 rounded-lg border border-[var(--color-border-input)] text-xs font-mono focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]"
                      />
                    </>
                  )}
                  <button onClick={() => setOptions(options.filter((_, j) => j !== i))} className="p-1.5 text-gray-400 hover:text-red-600 cursor-pointer" title="Remove option"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              ))}
            </div>
            <button onClick={() => setOptions([...options, { id: newOptionId(), name: '', active: true, sortOrder: options.length }])} className="mt-2 flex items-center gap-1 text-[11px] font-semibold text-[var(--brand-color)] hover:underline cursor-pointer">
              <Plus className="w-3.5 h-3.5" /> Add option
            </button>
          </div>
        </div>
        <div className="px-6 py-4 border-t border-[var(--color-border-default)] flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-xs font-semibold text-gray-500 hover:text-gray-700 cursor-pointer">Cancel</button>
          <button onClick={save} disabled={saving || !name.trim()} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[var(--brand-color)] hover:bg-[var(--color-primary-hover)] text-white text-xs font-bold disabled:opacity-50 cursor-pointer transition-colors">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            {isEdit ? 'Save changes' : 'Create & add'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Customizer: customize a shared group for this item only ──────

function CustomizerModal({ type, ref, group, template, productName, currencySymbol, onSave, onClose }: {
  type: ConfigType;
  ref?: ProductConfigRef;
  group: ResolvedConfigGroup;
  template?: MenuConfigTemplate;
  productName: string;
  currencySymbol: string;
  onSave: (overrides: NonNullable<ProductConfigRef['overrides']>) => void;
  onClose: () => void;
}) {
  const defaults = GROUP_DEFAULTS[type];
  const [working, setWorking] = useState<ResolvedConfigOption[]>(() => group.options.map((o) => ({ ...o })));
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const [rules, setRules] = useState({
    required: group.required,
    minSelections: group.minSelections,
    maxSelections: group.maxSelections,
    selectionMode: group.selectionMode,
  });
  const [saving, setSaving] = useState(false);

  const computeOverrides = (): NonNullable<ProductConfigRef['overrides']> | undefined => {
    const base = template?.data ?? { options: [] };
    const baseRules = {
      selectionMode: base.selectionMode ?? defaults.selectionMode,
      required: base.required ?? defaults.required,
      minSelections: base.minSelections ?? defaults.minSelections,
      maxSelections: base.maxSelections ?? defaults.maxSelections,
    };
    const optionOverrides: Array<Record<string, unknown>> = [];

    for (const w of working) {
      const baseOpt = (base.options ?? []).find((o: MenuConfigOption) => o.id === w.id);
      if (!baseOpt) {
        optionOverrides.push({ optionId: w.id, name: w.name, priceDelta: Number(w.priceDelta) || 0, active: w.active !== false });
        continue;
      }
      const entry: Record<string, unknown> = { optionId: w.id };
      let changed = false;
      if (Number(w.priceDelta) !== (baseOpt.priceDelta ?? 0)) { entry.priceDelta = Number(w.priceDelta) || 0; changed = true; }
      if (w.name.trim() !== baseOpt.name) { entry.name = w.name.trim(); changed = true; }
      if ((w.active !== false) !== (baseOpt.active !== false)) { entry.active = w.active !== false; changed = true; }
      if (changed) optionOverrides.push(entry);
    }
    for (const rid of removedIds) optionOverrides.push({ optionId: rid, removed: true });

    const groupOv: Record<string, unknown> = {};
    if (rules.required !== baseRules.required) groupOv.required = rules.required;
    if (rules.minSelections !== baseRules.minSelections) groupOv.minSelections = rules.minSelections;
    if ((rules.maxSelections ?? null) !== baseRules.maxSelections) groupOv.maxSelections = rules.maxSelections ?? undefined;
    if (rules.selectionMode !== baseRules.selectionMode) groupOv.selectionMode = rules.selectionMode;

    const hasGroup = Object.keys(groupOv).length > 0;
    const hasOptions = optionOverrides.length > 0;
    if (!hasGroup && !hasOptions) return undefined;
    return {
      ...(hasGroup ? { group: groupOv } : {}),
      ...(hasOptions ? { options: optionOverrides } : {}),
    } as unknown as NonNullable<ProductConfigRef['overrides']>;
  };

  const save = () => {
    setSaving(true);
    try {
      const overrides = computeOverrides();
      if (overrides) onSave(overrides);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-[var(--color-sidebar-bg)]/75 backdrop-blur-sm flex items-center justify-center p-4 z-[60] overflow-y-auto">
      <div className="bg-[var(--color-bg-white)] rounded-xl shadow-2xl max-w-lg w-full border border-[var(--color-border-default)] overflow-hidden">
        <div className="bg-[var(--color-primary-light)] px-6 py-4 border-b border-[var(--color-border-default)] flex justify-between items-center">
          <h3 className="font-bold text-[var(--color-text-primary)] text-sm">Customize “{group.name}” for {productName}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 cursor-pointer"><X className="w-5 h-5" /></button>
        </div>
        <div className="px-6 py-3 bg-amber-50/70 border-b border-amber-100 flex items-start gap-2">
          <Info className="w-3.5 h-3.5 text-amber-600 mt-0.5 shrink-0" />
          <p className="text-[10px] text-amber-800">
            {ref?.mode === 'override'
              ? 'These changes apply to this item only.'
              : 'Only this item changes — other items that use this shared group keep their current values.'}
          </p>
        </div>
        <div className="p-5 space-y-4 max-h-[60vh] overflow-y-auto">
          <div className="space-y-2">
            {working.map((o, i) => (
              <div key={o.id} className={`flex items-center gap-2 ${removedIds.includes(o.id) ? 'opacity-40' : ''}`}>
                <input
                  type="checkbox"
                  checked={!removedIds.includes(o.id)}
                  onChange={(e) => setRemovedIds(e.target.checked ? removedIds.filter((x) => x !== o.id) : [...removedIds, o.id])}
                  className="accent-[var(--brand-color)] shrink-0"
                  title="Keep this option"
                />
                <input
                  value={o.name}
                  onChange={(e) => setWorking(working.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}
                  className="flex-1 px-3 py-2 rounded-lg border border-[var(--color-border-input)] text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]"
                />
                <input
                  type="number" min={0} step="0.01"
                  value={o.priceDelta ?? o.price ?? 0}
                  onChange={(e) => setWorking(working.map((x, j) => j === i ? { ...x, [type === 'ADD_ON_GROUP' ? 'price' : 'priceDelta']: Number(e.target.value) } : x))}
                  className="w-24 px-3 py-2 rounded-lg border border-[var(--color-border-input)] text-xs font-mono font-bold focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]"
                  title="Price"
                />
              </div>
            ))}
          </div>
          <button
            onClick={() => setWorking([...working, { id: newOptionId(), name: '', priceDelta: 0, active: true, sortOrder: working.length }])}
            className="flex items-center gap-1 text-[11px] font-semibold text-[var(--brand-color)] hover:underline cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" /> Add an option for this item only
          </button>

          {type !== 'VARIANT_GROUP' && (
            <div className="border-t border-[var(--color-border-default)] pt-3">
              <p className="text-[10px] font-bold uppercase text-gray-500 tracking-wider mb-2">Selection rules</p>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-700 cursor-pointer">
                  <input type="checkbox" checked={rules.required} onChange={(e) => setRules({ ...rules, required: e.target.checked })} className="accent-[var(--brand-color)]" /> Required
                </label>
                {rules.selectionMode === 'MULTIPLE' && (
                  <>
                    <label className="flex items-center gap-1 text-[10px] text-gray-500">Min
                      <input type="number" min={0} value={rules.minSelections} onChange={(e) => setRules({ ...rules, minSelections: Number(e.target.value) })} className="w-14 px-2 py-1 rounded border border-[var(--color-border-input)] text-xs font-mono" />
                    </label>
                    <label className="flex items-center gap-1 text-[10px] text-gray-500">Max
                      <input type="number" min={0} value={rules.maxSelections ?? ''} onChange={(e) => setRules({ ...rules, maxSelections: e.target.value === '' ? null : Number(e.target.value) })} className="w-14 px-2 py-1 rounded border border-[var(--color-border-input)] text-xs font-mono" />
                    </label>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="px-6 py-4 border-t border-[var(--color-border-default)] flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-xs font-semibold text-gray-500 hover:text-gray-700 cursor-pointer">Cancel</button>
          <button onClick={save} disabled={saving} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[var(--brand-color)] hover:bg-[var(--color-primary-hover)] text-white text-xs font-bold disabled:opacity-50 cursor-pointer transition-colors">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            Save changes
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main editor ──────────────────────────────────────────────────

interface EditorProps {
  product: Product;
  currencySymbol: string;
  onUpdateProduct: (updated: Product) => void;
  onConfigChanged: () => void;
  onClose: () => void;
}

export default function ProductConfigEditor({ product, currencySymbol, onUpdateProduct, onConfigChanged, onClose }: EditorProps) {
  const [tab, setTab] = useState<Tab>('overview');
  const [refs, setRefs] = useState<ProductMenuConfig>(() => product.menuConfig ?? EMPTY_CONFIG);
  const [resolved, setResolved] = useState<ResolvedProductConfig | null>(null);
  const [templatesByType, setTemplatesByType] = useState<Record<ConfigType, MenuConfigTemplate[]>>({
    VARIANT_GROUP: [], MODIFIER_GROUP: [], ADD_ON_GROUP: [],
  });
  const [usageMap, setUsageMap] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pickerType, setPickerType] = useState<ConfigType | null>(null);
  const [builder, setBuilder] = useState<{ type: ConfigType; template?: MenuConfigTemplate } | null>(null);
  const [customizer, setCustomizer] = useState<{ type: ConfigType; ref?: ProductConfigRef; group: ResolvedConfigGroup } | null>(null);

  const reload = useCallback(async () => {
    const r = await api.resolveProductConfig(product.id);
    if (r) setResolved(r);
  }, [product.id]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.resolveProductConfig(product.id),
      api.fetchMenuConfigTemplates({ type: 'VARIANT_GROUP', limit: 200 }),
      api.fetchMenuConfigTemplates({ type: 'MODIFIER_GROUP', limit: 200 }),
      api.fetchMenuConfigTemplates({ type: 'ADD_ON_GROUP', limit: 200 }),
    ])
      .then(([resolvedData, v, m, a]) => {
        if (cancelled) return;
        if (resolvedData) setResolved(resolvedData);
        const byType: Record<ConfigType, MenuConfigTemplate[]> = {
          VARIANT_GROUP: v?.items ?? [],
          MODIFIER_GROUP: m?.items ?? [],
          ADD_ON_GROUP: a?.items ?? [],
        };
        setTemplatesByType(byType);
        const usage: Record<string, number> = {};
        for (const t of [...byType.VARIANT_GROUP, ...byType.MODIFIER_GROUP, ...byType.ADD_ON_GROUP]) {
          if (typeof t.productCount === 'number') usage[t._id] = t.productCount;
        }
        setUsageMap(usage);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setError('Could not load configuration. Check your connection and try again.');
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [product.id]);

  const updateRefs = useCallback((next: ProductMenuConfig, andReload = true) => {
    setRefs(next);
    onUpdateProduct({ ...product, menuConfig: next });
    onConfigChanged();
    if (andReload) reload();
  }, [product, onUpdateProduct, onConfigChanged, reload]);

  const templatesFor = useCallback((type: ConfigType) =>
    templatesByType[type].filter((t) => t.status !== 'archived'), [templatesByType]);

  const attachedTemplateIds = useMemo(() => {
    const ids = new Set<string>();
    for (const key of ['variantConfigurations', 'modifierConfigurations', 'addOnConfigurations'] as const) {
      for (const r of refs[key]) ids.add(String(r.templateId));
    }
    return ids;
  }, [refs]);

  const groupsFor = useCallback((type: ConfigType): Array<{ ref: ProductConfigRef; group: ResolvedConfigGroup | undefined }> => {
    const key = type === 'VARIANT_GROUP' ? 'variantConfigurations' : type === 'MODIFIER_GROUP' ? 'modifierConfigurations' : 'addOnConfigurations';
    return (refs[key] ?? []).map((ref) => {
      const group = resolved
        ? [...resolved.variantGroups, ...resolved.modifierGroups, ...resolved.addOnGroups].find((g) => g.id === String(ref.templateId))
        : undefined;
      return { ref, group };
    });
  }, [refs, resolved]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch {
      setError('Something went wrong — please try again.');
    } finally {
      setBusy(false);
    }
  };

  const arrayKeyOf = (type: ConfigType): 'variantConfigurations' | 'modifierConfigurations' | 'addOnConfigurations' =>
    type === 'VARIANT_GROUP' ? 'variantConfigurations' : type === 'MODIFIER_GROUP' ? 'modifierConfigurations' : 'addOnConfigurations';

  const detach = async (type: ConfigType, ref: ProductConfigRef) => {
    const refId = ref._id;
    if (!refId) return;
    await run(async () => {
      await api.detachProductConfig(product.id, refId);
      const key = arrayKeyOf(type);
      updateRefs({ ...refs, [key]: (refs[key] ?? []).filter((r) => r._id !== refId) });
    });
  };

  const makeCopy = async (type: ConfigType, templateId: string) => {
    await run(async () => {
      const copy = await api.copyMenuConfigTemplate(templateId);
      if (!copy?._id) { setError('Could not create the copy.'); return; }
      const attached = await api.attachProductConfig(product.id, { type, templateId: copy._id, mode: 'copy' });
      if (!attached?._id) { setError('Could not attach the copy.'); return; }
      const key = arrayKeyOf(type);
      updateRefs({ ...refs, [key]: [...(refs[key] ?? []), attached] });
    });
  };

  const attachShared = async (type: ConfigType, templateId: string) => {
    await run(async () => {
      const attached = await api.attachProductConfig(product.id, { type, templateId, mode: 'shared' });
      if (!attached?._id) { setError('Could not attach the group.'); return; }
      const key = arrayKeyOf(type);
      updateRefs({ ...refs, [key]: [...(refs[key] ?? []), attached] });
      setPickerType(null);
    });
  };

  const attachOverride = async (type: ConfigType, groupId: string, overrides: NonNullable<ProductConfigRef['overrides']>) => {
    await run(async () => {
      const attached = await api.attachProductConfig(product.id, { type, templateId: groupId, mode: 'override', overrides });
      if (!attached?._id) { setError('Could not save your customizations.'); return; }
      const key = arrayKeyOf(type);
      updateRefs({ ...refs, [key]: [...(refs[key] ?? []), attached] });
    });
  };

  const updateOverride = async (type: ConfigType, ref: ProductConfigRef, overrides: NonNullable<ProductConfigRef['overrides']>) => {
    if (!ref._id) return;
    await run(async () => {
      await api.updateProductConfig(product.id, ref._id, { mode: 'override', overrides });
      const key = arrayKeyOf(type);
      updateRefs({ ...refs, [key]: (refs[key] ?? []).map((r) => r._id === ref._id ? { ...r, mode: 'override', overrides } : r) });
    });
  };

  const resetOverrides = async (type: ConfigType, ref: ProductConfigRef) => {
    if (!ref._id) return;
    await run(async () => {
      await api.resetProductConfigOverrides(product.id, ref._id);
      const key = arrayKeyOf(type);
      updateRefs({ ...refs, [key]: (refs[key] ?? []).map((r) => r._id === ref._id ? { ...r, mode: 'shared', overrides: undefined } : r) });
    });
  };

  const groupModeLabel = (ref: ProductConfigRef, group: ResolvedConfigGroup | undefined) => {
    if (ref.mode === 'override') return { text: 'Customized for this item', cls: 'bg-amber-50 text-amber-700 border-amber-200' };
    if (ref.mode === 'copy') return { text: 'Independent copy', cls: 'bg-violet-50 text-violet-700 border-violet-200' };
    const count = group ? (usageMap[group.id] ?? 1) : 1;
    return { text: count > 1 ? `Shared · used by ${count} items` : 'Shared', cls: 'bg-sky-50 text-sky-700 border-sky-200' };
  };

  const renderGroupCard = (type: ConfigType, ref: ProductConfigRef, group: ResolvedConfigGroup | undefined, idx: number) => {
    const label = groupModeLabel(ref, group);
    const template = group ? templatesByType[type].find((t) => t._id === group.id) : undefined;
    return (
      <div key={idx} className="border border-[var(--color-border-default)] rounded-xl p-4 bg-[var(--color-bg-white)]">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="font-bold text-xs text-[var(--color-text-primary)]">{group?.name ?? 'Group'}</h4>
              <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wide ${label.cls}`}>{label.text}</span>
              {group?.required && <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-200 uppercase tracking-wide">Required</span>}
            </div>
            {group ? (
              <p className="text-[10px] text-gray-500 mt-1.5 leading-relaxed">
                {group.options.filter((o) => o.active).sort((a, b) => a.sortOrder - b.sortOrder).map((o) => optionText(type, currencySymbol, o)).join('  ·  ')}
              </p>
            ) : (
              <p className="text-[10px] text-red-500 mt-1.5">Group is no longer available (archived or removed).</p>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {ref.mode === 'copy' ? (
              <button onClick={() => setBuilder({ type, template })} className="p-1.5 rounded-lg border border-[var(--color-border-default)] text-gray-500 hover:text-[var(--brand-color)] hover:bg-[var(--color-surface-muted)] transition-colors cursor-pointer" title="Edit this copy (only this item sees changes)">
                <Settings2 className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button onClick={() => group && setCustomizer({ type, ref, group })} className="p-1.5 rounded-lg border border-[var(--color-border-default)] text-gray-500 hover:text-[var(--brand-color)] hover:bg-[var(--color-surface-muted)] transition-colors cursor-pointer" title={ref.mode === 'override' ? 'Edit customizations' : 'Customize for this item'}>
                <SlidersHorizontal className="w-3.5 h-3.5" />
              </button>
            )}
            {ref.mode !== 'copy' && (
              <button onClick={() => group && makeCopy(type, group.id)} className="p-1.5 rounded-lg border border-[var(--color-border-default)] text-gray-500 hover:text-violet-600 hover:bg-violet-50 transition-colors cursor-pointer" title="Create an independent copy — changes to this copy never affect the shared group">
                <Copy className="w-3.5 h-3.5" />
              </button>
            )}
            {ref.mode === 'override' && (
              <button onClick={() => resetOverrides(type, ref)} className="p-1.5 rounded-lg border border-[var(--color-border-default)] text-gray-500 hover:text-amber-600 hover:bg-amber-50 transition-colors cursor-pointer" title="Reset changes — go back to the shared group as-is">
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            )}
            <button onClick={() => detach(type, ref)} className="p-1.5 rounded-lg border border-[var(--color-border-default)] text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors cursor-pointer" title="Remove from this item">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
        {ref.mode === 'shared' && (usageMap[group?.id ?? ''] ?? 0) > 1 && (
          <p className="flex items-center gap-1 text-[9px] text-gray-400 mt-2">
            <Info className="w-3 h-3" /> Changing the shared group affects {usageMap[group?.id ?? '']} items. Use “Customize” to change only this item.
          </p>
        )}
      </div>
    );
  };

  const renderGroupsTab = (type: ConfigType, title: string, subtitle: string) => {
    const entries = groupsFor(type);
    return (
      <div className="space-y-3">
        <div>
          <h3 className="font-bold text-sm text-[var(--color-text-primary)]">{title}</h3>
          <p className="text-[10px] text-gray-500 mt-0.5">{subtitle}</p>
        </div>

        {entries.length === 0 && (
          <div className="border border-dashed border-[var(--color-border-default)] rounded-xl p-8 text-center">
            <Layers className="w-8 h-8 text-gray-300 mx-auto mb-2" />
            <p className="text-xs font-semibold text-gray-500">No {TYPE_PLURAL[type]} yet</p>
            <p className="text-[10px] text-gray-400 mt-1">Add a reusable {TYPE_LABEL[type]} or create one from scratch.</p>
          </div>
        )}

        {entries.map(({ ref, group }, i) => renderGroupCard(type, ref, group, i))}

        <div className="flex gap-2 pt-1">
          <button
            onClick={() => setPickerType(type)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[var(--brand-color)] hover:bg-[var(--color-primary-hover)] text-white text-xs font-bold transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" /> Add {TYPE_LABEL[type]}
          </button>
        </div>
      </div>
    );
  };

  const renderOverview = () => {
    const variantGroups = resolved?.variantGroups ?? [];
    const modifierGroups = resolved?.modifierGroups ?? [];
    const addOnGroups = resolved?.addOnGroups ?? [];
    const deltas = variantGroups.flatMap((g) => g.options.filter((o) => o.active).map((o) => o.priceDelta));
    const minVariantPrice = deltas.length ? Math.min(...deltas) : 0;
    const fromPrice = product.price + minVariantPrice;

    return (
      <div className="space-y-4">
        <div className="flex items-center gap-4 bg-[var(--color-primary-light)]/60 rounded-xl p-4 border border-[var(--color-border-default)]">
          <div className="w-16 h-16 rounded-xl overflow-hidden bg-gradient-to-br from-gray-100 to-gray-50 border border-gray-200 shrink-0">
            {product.image ? (
              <img src={product.image} alt={product.name} className="w-full h-full object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-2xl font-black text-gray-300">{product.name.charAt(0).toUpperCase()}</div>
            )}
          </div>
          <div className="min-w-0">
            <h3 className="font-bold text-sm text-[var(--color-text-primary)] truncate">{product.name}</h3>
            <p className="text-[10px] text-gray-500">{product.category} · {product.availability ? 'Available' : 'Unavailable'}</p>
            <p className="text-xs font-bold text-[var(--brand-color)] mt-1">
              {variantGroups.length ? `From ${currencySymbol}${fromPrice.toFixed(2)}` : `${currencySymbol}${product.price.toFixed(2)}`}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {([
            ['Variants', variantGroups.length, variantGroups.reduce((s, g) => s + g.options.filter((o) => o.active).length, 0)],
            ['Customizations', modifierGroups.length, modifierGroups.reduce((s, g) => s + g.options.filter((o) => o.active).length, 0)],
            ['Add-ons', addOnGroups.length, addOnGroups.reduce((s, g) => s + g.options.filter((o) => o.active).length, 0)],
          ] as Array<[string, number, number]>).map(([name, groups, options]) => (
            <div key={name} className="rounded-xl border border-[var(--color-border-default)] p-3 text-center bg-[var(--color-bg-white)]">
              <p className="text-lg font-extrabold text-[var(--color-text-primary)]">{options}</p>
              <p className="text-[9px] font-bold uppercase tracking-wide text-gray-500">{name}</p>
              <p className="text-[9px] text-gray-400">{groups} group{groups === 1 ? '' : 's'}</p>
            </div>
          ))}
        </div>

        <div className="rounded-xl border border-[var(--color-border-default)] divide-y divide-[var(--color-border-default)] bg-[var(--color-bg-white)]">
          {([
            ['Recipe', '⚠ Not configured — available in a later phase', 'bg-amber-50 text-amber-600'],
            ['Kitchen', 'Uses the standard kitchen ticket', 'bg-emerald-50 text-emerald-600'],
            ['Online ordering', product.availability ? 'Visible to customers when the site is on' : 'Hidden — item is marked unavailable', product.availability ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-500'],
          ] as Array<[string, string, string]>).map(([name, text, cls]) => (
            <div key={name} className="flex items-center justify-between px-4 py-3">
              <span className="text-xs font-semibold text-[var(--color-text-primary)]">{name}</span>
              <span className={`text-[10px] font-semibold px-2 py-1 rounded-full ${cls}`}>{text}</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const tabs: Array<{ id: Tab; label: string; count?: number }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'variants', label: 'Variants', count: resolved?.variantGroups.length ?? 0 },
    { id: 'customizations', label: 'Customizations', count: resolved?.modifierGroups.length ?? 0 },
    { id: 'addons', label: 'Add-ons', count: resolved?.addOnGroups.length ?? 0 },
  ];

  return (
    <div className="fixed inset-0 bg-[var(--color-sidebar-bg)]/75 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto">
      <div className="bg-[var(--color-bg-white)] rounded-xl shadow-2xl max-w-2xl w-full border border-[var(--color-border-default)] overflow-hidden">
        {/* Header */}
        <div className="bg-[var(--color-primary-light)] px-6 py-4 border-b border-[var(--color-border-default)] flex justify-between items-center">
          <div className="flex items-center gap-2 min-w-0">
            <SlidersHorizontal className="w-4 h-4 text-[var(--brand-color)] shrink-0" />
            <h3 className="font-bold text-[var(--color-text-primary)] text-sm truncate">Configure “{product.name}”</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 cursor-pointer"><X className="w-5 h-5" /></button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[var(--color-border-default)] px-4 pt-3 gap-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 rounded-t-lg text-xs font-bold transition-colors cursor-pointer flex items-center gap-1.5 ${
                tab === t.id ? 'bg-[var(--color-primary-light)] text-[var(--brand-color)] border border-b-0 border-[var(--color-border-default)]' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.label}
              {(t.count ?? 0) > 0 && (
                <span className="text-[9px] font-bold bg-[var(--brand-color)] text-white px-1.5 rounded-full">{t.count}</span>
              )}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="p-5 max-h-[62vh] overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-[var(--brand-color)]" />
            </div>
          ) : error && !resolved ? (
            <div className="flex items-center justify-center gap-2 py-16 text-xs text-red-600">
              <AlertCircle className="w-4 h-4" /> {error}
            </div>
          ) : tab === 'overview' ? renderOverview()
            : tab === 'variants' ? renderGroupsTab('VARIANT_GROUP', 'Variants', 'Sizes, portions and other choices every customer picks from.')
              : tab === 'customizations' ? renderGroupsTab('MODIFIER_GROUP', 'Customizations', 'Crust, toppings, spice level — extras customers can add.')
                : renderGroupsTab('ADD_ON_GROUP', 'Add-ons', 'Sides and drinks sold alongside this item.')}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-[var(--color-border-default)] flex items-center justify-between">
          <p className="text-[9px] text-gray-400 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3 text-emerald-500" />
            {resolved && (resolved.variantGroups.length + resolved.modifierGroups.length + resolved.addOnGroups.length) > 0
              ? `${resolved.variantGroups.length + resolved.modifierGroups.length + resolved.addOnGroups.length} group${resolved.variantGroups.length + resolved.modifierGroups.length + resolved.addOnGroups.length === 1 ? '' : 's'} · ${resolved.configVersion} revision${resolved.configVersion === 1 ? '' : 's'}`
              : 'No configuration yet'}
          </p>
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-[var(--brand-color)] hover:bg-[var(--color-primary-hover)] text-white text-xs font-bold cursor-pointer transition-colors">Done</button>
        </div>
      </div>

      {busy && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/10 pointer-events-none">
          <Loader2 className="w-8 h-8 animate-spin text-[var(--brand-color)]" />
        </div>
      )}

      {pickerType && (
        <TemplatePicker
          type={pickerType}
          templates={templatesFor(pickerType)}
          usageMap={usageMap}
          attachedIds={attachedTemplateIds}
          currencySymbol={currencySymbol}
          onPick={(id) => attachShared(pickerType, id)}
          onCreateNew={() => { setPickerType(null); setBuilder({ type: pickerType }); }}
          onClose={() => setPickerType(null)}
        />
      )}

      {builder && (
        <TemplateBuilder
          type={builder.type}
          template={builder.template}
          currencySymbol={currencySymbol}
          productId={product.id}
          onDone={() => {
            const builtType = builder.type;
            setBuilder(null);
            setPickerType(null);
            // Refresh templates + resolved so the new/edited group shows up.
            reload();
            api.fetchMenuConfigTemplates({ type: builtType, limit: 200 }).then((list) => {
              if (list?.items) setTemplatesByType((prev) => ({ ...prev, [builtType]: list.items }));
            });
            // A new template was attached inside the builder — sync refs from
            // the server product so cards and the parent stay in sync.
            api.fetchProduct(product.id).then((p: any) => {
              if (p?.menuConfig) {
                setRefs(p.menuConfig);
                onUpdateProduct({ ...product, menuConfig: p.menuConfig });
              }
            });
            onConfigChanged();
          }}
          onClose={() => { setBuilder(null); setPickerType(null); }}
        />
      )}

      {customizer && (
        <CustomizerModal
          type={customizer.type}
          ref={customizer.ref}
          group={customizer.group}
          template={templatesByType[customizer.type].find((t) => t._id === customizer.group.id)}
          productName={product.name}
          currencySymbol={currencySymbol}
          onSave={(overrides) => {
            if (customizer.ref?.mode === 'override') {
              updateOverride(customizer.type, customizer.ref, overrides);
            } else {
              attachOverride(customizer.type, customizer.group.id, overrides);
            }
          }}
          onClose={() => setCustomizer(null)}
        />
      )}
    </div>
  );
}
