/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * RecipeInputStep — shared recipe ingredient input UI used by:
 *   - ProductRegistrationWizard (Step 4)
 *   - RecipesPage RecipeEditor (create/edit)
 *
 * Design matches the screenshot: three mode cards (Skip / Add / Describe),
 * inventory search, and a clean RECIPE INGREDIENTS list.
 */

import React, { useState, useRef, useCallback } from 'react';
import {
  Search, Mic, Trash2, Loader2, Sparkles,
} from 'lucide-react';
import { unitOptionsFor } from '../../src/utils/units';

// ─── Types ───────────────────────────────────────────────────────

export interface RecipeRow {
  key: string;
  inventoryItemId?: string;
  itemName: string;
  unit: string;
  quantity: number;
  averageCost?: number;
  costPreview?: number;
  confidence?: 'HIGH' | 'MEDIUM' | 'LOW';
  needsReview: boolean;
  /** Voice/describe mode extras */
  itemUnit?: string;
  costPerUnit?: number;
  baseQuantity?: number;
  reason?: string;
  image?: string;
}

export type RecipeMode = 'skip' | 'manual' | 'describe';

export interface RecipeInputStepProps {
  /** Current mode */
  mode: RecipeMode;
  /** Set mode */
  onModeChange: (mode: RecipeMode) => void;
  /** Current ingredient rows */
  rows: RecipeRow[];
  /** Replace all rows */
  onRowsChange: (rows: RecipeRow[]) => void;
  /** Currency symbol */
  currencySymbol: string;
  /** Total recipe cost (computed by caller) */
  recipeCost?: number;
  /** Reference selling price for margin display */
  referencePrice?: number;
  /** Margin percentage */
  marginPct?: number | null;

  // ── Manual mode (search inventory) ──
  manualSearch?: string;
  onManualSearchChange?: (val: string) => void;
  manualSearchResults?: any[] | null;
  onManualSearch?: (query: string) => void;
  onManualAddItem?: (item: any) => void;
  manualLoading?: boolean;

  // ── Describe mode (voice/text AI) ──
  describeText?: string;
  onDescribeTextChange?: (val: string) => void;
  onParseText?: (text: string) => void;
  describeLoading?: boolean;
  recording?: boolean;
  transcribing?: boolean;
  onStartRecording?: () => void;
  onStopRecording?: () => void;

  // ── Error ──
  error?: string;

  // ── Row quantity change ──
  onRowQuantityChange?: (key: string, qty: number) => void;

  // ── Row unit change (kg → g, L → ml, etc.) ──
  onRowUnitChange?: (key: string, unit: string) => void;

  // ── Row remove ──
  onRowRemove?: (key: string) => void;

  // ── Clear all ──
  onClearAll?: () => void;
}

// ─── Component ───────────────────────────────────────────────────

export default function RecipeInputStep({
  mode, onModeChange,
  rows, onRowsChange,
  currencySymbol,
  recipeCost = 0,
  referencePrice = 0,
  marginPct = null,

  manualSearch = '',
  onManualSearchChange,
  manualSearchResults,
  onManualSearch,
  onManualAddItem,
  manualLoading = false,

  describeText = '',
  onDescribeTextChange,
  onParseText,
  describeLoading = false,
  recording = false,
  transcribing = false,
  onStartRecording,
  onStopRecording,

error,

  onRowQuantityChange,
  onRowUnitChange,
  onRowRemove,
  onClearAll,

  ..._
}: RecipeInputStepProps) {
  const fmt = (n: number) =>
    currencySymbol + Number(n || 0).toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  const handleClear = () => {
    if (onClearAll) onClearAll();
    else onRowsChange([]);
    onModeChange('skip');
  };

  return (
    <div className="space-y-4">
      {/* ── Header ── */}
      <p className="text-[10px] font-bold uppercase text-gray-500 tracking-wider">
        Recipe (optional)
      </p>

      {/* ── Three Mode Cards ── */}
      <div className="grid grid-cols-3 gap-2">
        {/* Skip for now */}
        <button
          onClick={() => { onModeChange('skip'); onRowsChange([]); }}
          className={`rounded-xl border p-3 text-left cursor-pointer transition-all ${
            mode === 'skip'
              ? 'border-[var(--brand-color)] bg-[var(--color-primary-light)]'
              : 'border-[var(--color-border-default)] hover:border-gray-300'
          }`}
        >
          <span className="block text-xs font-bold text-[var(--color-text-primary)]">
            Skip for now
          </span>
          <span className="block text-[10px] text-gray-500 mt-0.5">
            Register the dish — add a recipe later from Inventory.
          </span>
        </button>

        {/* Add ingredients */}
        <button
          onClick={() => onModeChange('manual')}
          className={`rounded-xl border p-3 text-left cursor-pointer transition-all ${
            mode === 'manual'
              ? 'border-[var(--brand-color)] bg-[var(--color-primary-light)]'
              : 'border-[var(--color-border-default)] hover:border-gray-300'
          }`}
        >
          <span className="block text-xs font-bold text-[var(--color-text-primary)]">
            Add ingredients
          </span>
          <span className="block text-[10px] text-gray-500 mt-0.5">
            Pick raw materials from your inventory one by one.
          </span>
        </button>

        {/* Describe it */}
        <button
          onClick={() => onModeChange('describe')}
          className={`rounded-xl border p-3 text-left cursor-pointer transition-all ${
            mode === 'describe'
              ? 'border-[var(--brand-color)] bg-[var(--color-primary-light)]'
              : 'border-[var(--color-border-default)] hover:border-gray-300'
          }`}
        >
          <span className="block text-xs font-bold text-[var(--color-text-primary)]">
            Describe it
          </span>
          <span className="block text-[10px] text-gray-500 mt-0.5">
            "200g paneer, 100g tomato, 50ml cream" — voice or text.
          </span>
        </button>
      </div>

      {/* ── Manual Mode: Search Inventory ── */}
      {mode === 'manual' && (
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              value={manualSearch}
              onChange={(e) => {
                onManualSearchChange?.(e.target.value);
                onManualSearch?.(e.target.value);
              }}
              placeholder="Search inventory — e.g. paneer, fresh milk, tomato..."
              className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-[var(--color-border-input)] text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]"
            />
          </div>
          {manualLoading && (
            <p className="text-[10px] text-gray-400 flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" /> Searching...
            </p>
          )}
          {manualSearchResults && manualSearchResults.length > 0 && (
            <div className="border border-[var(--color-border-default)] rounded-xl divide-y divide-[var(--color-border-default)] max-h-44 overflow-y-auto">
              {manualSearchResults.map((item: any) => (
                <button
                  key={item._id}
                  onClick={() => onManualAddItem?.(item)}
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
                    <span className="block text-[10px] text-gray-500">
                      per {item.unit || 'unit'}
                      {Number(item.averageCost) > 0 ? ` · ${fmt(item.averageCost)}` : ''}
                      {Number(item.currentStock) > 0 ? ` · stock ${item.currentStock}` : ''}
                    </span>
                  </span>
                  <span className="text-[var(--brand-color)] text-xs font-bold">+ Add</span>
                </button>
              ))}
            </div>
          )}
          {manualSearchResults && manualSearchResults.length === 0 && !manualLoading && manualSearch.trim().length >= 2 && (
            <p className="text-[10px] text-gray-400">
              No inventory items match "{manualSearch}".
            </p>
          )}
        </div>
      )}

      {/* ── Describe Mode: Voice / Text AI ── */}
      {mode === 'describe' && (
        <div className="space-y-3">
          {onStartRecording && (
            <button
              onClick={recording ? onStopRecording : onStartRecording}
              disabled={transcribing}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold cursor-pointer transition-colors disabled:opacity-50 ${
                recording
                  ? 'bg-red-600 text-white'
                  : 'bg-[var(--brand-color)] hover:bg-[var(--color-primary-hover)] text-white'
              }`}
            >
              {transcribing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mic className="w-3.5 h-3.5" />}
              {recording ? 'Stop & parse' : transcribing ? 'Listening...' : 'Say ingredients'}
            </button>
          )}
          <textarea
            value={describeText}
            onChange={(e) => onDescribeTextChange?.(e.target.value)}
            placeholder='Or type it — e.g. "Add 200 grams paneer, 100 grams tomato, 50 ml cream and 20 grams butter."'
            rows={2}
            className="w-full px-3 py-2 rounded-lg border border-[var(--color-border-input)] text-xs focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)] resize-none"
          />
          {onParseText && (
            <button
              onClick={() => onParseText(describeText)}
              disabled={describeLoading || describeText.trim().length < 3}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 text-[11px] font-bold cursor-pointer disabled:opacity-50 transition-colors"
            >
              {describeLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              Parse ingredients
            </button>
          )}
          {describeLoading && (
            <p className="text-[10px] text-gray-400 flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" /> Matching against your inventory...
            </p>
          )}
        </div>
      )}

      {/* ── Error ── */}
      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-[11px] font-semibold text-red-700">
          <span className="shrink-0">⚠</span> {error}
        </div>
      )}

      {/* ── RECIPE INGREDIENTS List ── */}
      {(rows.length > 0 || mode !== 'skip') && (
        <div className="rounded-xl border border-[var(--color-border-default)] overflow-hidden">
          <div className="px-3 py-2 bg-[var(--color-primary-light)] border-b border-[var(--color-border-default)] flex items-center justify-between">
            <p className="text-[10px] font-bold uppercase text-gray-500 tracking-wider">
              Recipe Ingredients
            </p>
            {mode !== 'skip' && (
              <button
                onClick={handleClear}
                className="text-[10px] font-semibold text-gray-400 hover:text-red-600 cursor-pointer"
              >
                Clear
              </button>
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
                        {r.needsReview && (
                          <span className="ml-1.5 text-[9px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-1 py-0.5 rounded align-middle">
                            check
                          </span>
                        )}
                      </p>
                      <p className="text-[10px] text-gray-400">
                        {onRowUnitChange && r.itemUnit && r.itemUnit !== r.unit
                          ? `per ${r.unit} · ${fmt(r.averageCost ?? 0)}/${r.itemUnit}`
                          : `per ${r.unit}${r.averageCost !== undefined ? ` · ${fmt(r.averageCost)}` : ''}`}
                      </p>
                    </div>
                    {onRowQuantityChange && (
                      <input
                        type="number"
                        min={0}
                        value={r.quantity}
                        onChange={(e) => onRowQuantityChange(r.key, Number(e.target.value))}
                        className="w-20 px-2 py-1.5 rounded-lg border border-[var(--color-border-input)] text-xs font-mono font-bold text-right focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]"
                      />
                    )}
                    {onRowUnitChange ? (
                      <select
                        value={r.unit}
                        onChange={(e) => onRowUnitChange(r.key, e.target.value)}
                        title="Change unit (e.g. kg → g, L → ml)"
                        className="w-16 px-1.5 py-1.5 rounded-lg border border-[var(--color-border-default)] bg-white text-[10px] font-semibold text-gray-600 focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)] cursor-pointer text-center"
                      >
                        {unitOptionsFor(r.unit).map((u) => (
                          <option key={u} value={u}>{u}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-[10px] text-gray-400 w-7 text-center">{r.unit}</span>
                    )}
                    <span className="text-xs font-mono font-bold text-[var(--color-text-primary)] w-20 text-right">
                      {fmt(r.costPreview ?? 0)}
                    </span>
                    {(onRowRemove || onRowsChange) && (
                      <button
                        onClick={() => {
                          if (onRowRemove) onRowRemove(r.key);
                          else onRowsChange(rows.filter((x) => x.key !== r.key));
                        }}
                        className="p-1 text-gray-400 hover:text-red-600 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <div className="px-3 py-2 bg-gray-50 border-t border-[var(--color-border-default)] flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase text-gray-500 tracking-wider">
                  Recipe cost
                </span>
                <span className="text-xs font-mono font-bold text-[var(--color-text-primary)]">
                  {fmt(recipeCost)}
                </span>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Margin preview ── */}
      {rows.length > 0 && referencePrice > 0 && marginPct !== null && (
        <div className="rounded-xl bg-emerald-50/70 border border-emerald-200 px-3 py-2 flex items-center justify-between">
          <span className="text-[10px] font-semibold text-emerald-800">
            Selling price {fmt(referencePrice)} · Estimated gross margin
          </span>
          <span className={`text-xs font-mono font-bold ${marginPct >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
            {marginPct}%
          </span>
        </div>
      )}
    </div>
  );
}
