/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * OfferEconomics — live contribution economics inside the offer builder.
 *
 * While the merchant configures a discount, this panel shows immediately:
 *   Original price → Offer price → Estimated variable cost → Contribution
 *   → Contribution margin, with warnings when a discount cuts deeply into
 *   margin. All math is deterministic (backend, from recipe costs) — advisory
 *   only, never blocks the offer.
 *
 * The AI Offer Assistant below is also advisory: natural language →
 * structured proposal (Zod-validated server-side) → user confirms by
 * applying it to the draft. AI never creates or mutates offers directly.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  TrendingUp, AlertTriangle, Loader2, Sparkles, Check, Wand2,
} from 'lucide-react';
import { fetchOfferPreview, fetchOfferAssistant, fetchComboAssistant } from '../../src/api/client';
import { debugWarn } from '../../src/utils/debugLog';
import RefreshButton from '../common/RefreshButton';

const money = (n: number) => Math.round(n * 100) / 100;
const fmt = (n: number) => '₹' + money(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (n: number) => `${Math.round(n * 100) / 100}%`;

interface Props {
  currencySymbol: string;
  draft: any; // shape: { type, value, scope, productIds, categories }
  onApplyAssistant: (proposal: any) => void;
}

export default function OfferEconomics({ currencySymbol, draft, onApplyAssistant }: Props) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [combo, setCombo] = useState<any | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<any | null>(null);
  const timer = useRef<any>(null);

  // AI assistant (offers)
  const [text, setText] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [proposal, setProposal] = useState<any | null>(null);
  const [aiError, setAiError] = useState('');

  // AI combo assistant
  const [cboText, setCboText] = useState('');
  const [cboBusy, setCboBusy] = useState(false);
  const [cboProposal, setCboProposal] = useState<any | null>(null);
  const [cboError, setCboError] = useState('');

  const applicable = draft.scope === 'products'
    ? { applicableProductIds: draft.productIds }
    : draft.scope === 'categories'
      ? { applicableCategories: draft.categories }
      : {};

  const fetchEconomics = useCallback(async () => {
    if (!applicable.applicableProductIds?.length && !applicable.applicableCategories?.length) {
      setRows(null);
      setCombo(null);
      setWarnings([]);
      setSummary(null);
      return;
    }
    if (!['percentage', 'flat', 'cashback', 'combo'].includes(draft.type)) {
      setRows(null);
      setWarnings([]);
      setSummary(null);
      return;
    }
    setLoading(true);
    try {
      const res = await fetchOfferPreview({
        title: 'preview',
        type: draft.type,
        value: draft.value || 0,
        ...applicable,
      });
      const d = res?.data || res;
      if (d) {
        setRows(d.rows || []);
        setCombo(d.combo || null);
        setWarnings(d.warnings || []);
        setSummary(d.summary || null);
      }
    } catch (err) {
      debugWarn('OfferEconomics', 'preview failed:', err);
      setRows(null);
      setCombo(null);
      setWarnings([]);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [draft.type, draft.value, draft.scope, draft.productIds, draft.categories]);

  // Debounced refresh while the merchant edits the offer config.
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void fetchEconomics(); }, 400);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [fetchEconomics]);

  const askAssistant = async () => {
    if (!text.trim() || aiBusy) return;
    setAiBusy(true);
    setAiError('');
    setProposal(null);
    try {
      const res = await fetchOfferAssistant(text.trim());
      const d = res?.data || res;
      if (d?.targets?.length || d?.summary) setProposal(d);
      else if (d?.error) setAiError(d.error);
      else setAiError('No offer proposal could be built from that request — try a more specific one.');
    } catch (err: any) {
      debugWarn('OfferEconomics', 'assistant failed:', err);
      setAiError(err?.response?.data?.error || 'AI assistant is unavailable right now.');
    } finally {
      setAiBusy(false);
    }
  };

  const applyProposal = () => {
    if (!proposal) return;
    onApplyAssistant(proposal);
  };

  const askComboAssistant = async () => {
    if (!cboText.trim() || cboBusy) return;
    setCboBusy(true);
    setCboError('');
    setCboProposal(null);
    try {
      const res = await fetchComboAssistant(cboText.trim());
      const d = res?.data || res;
      if (d?.targets?.length || d?.combos?.length) setCboProposal(d);
      else if (d?.error) setCboError(d.error);
      else setCboError('No combo proposal could be built from that request — name the combo items, e.g. "combo of pizza and wings".');
    } catch (err: any) {
      debugWarn('OfferEconomics', 'combo assistant failed:', err);
      setCboError(err?.response?.data?.error || 'AI combo assistant is unavailable right now.');
    } finally {
      setCboBusy(false);
    }
  };

  const applyComboProposal = (price?: number) => {
    if (!cboProposal) return;
    const chosen = price ?? cboProposal.recommended?.price ?? cboProposal.combos?.[0]?.price;
    if (!chosen) return;
    onApplyAssistant({
      combo: true,
      intent: { target: 'products', targetName: 'combo' },
      targets: cboProposal.targets || [],
      summary: { recommended: { type: 'combo', value: chosen } },
    });
  };

  const hasScope = (applicable.applicableProductIds?.length || 0) + (applicable.applicableCategories?.length || 0) > 0;

  return (
    <div className="space-y-4">
      {/* Deterministic economics */}
      <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-100 rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-black text-gray-800 flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5 text-[var(--brand-color)]" />
            Contribution impact
          </p>
          {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--brand-color)]" />}
          {!loading && hasScope && (
            <RefreshButton onRefresh={fetchEconomics} className="gap-1 text-[10px] font-bold text-blue-600 hover:text-blue-800" iconClassName="w-3 h-3">
              Refresh
            </RefreshButton>
          )}
        </div>

        {!hasScope && (
          <p className="text-[11px] text-gray-500">
            Select products or a category above to see how this discount affects contribution — original price, offer price, estimated variable cost and margin.
          </p>
        )}

        {hasScope && !loading && rows === null && (
          <p className="text-[11px] text-gray-400">No economics available for this offer type yet (supported: % / flat / cashback).</p>
        )}

        {rows && rows.length > 0 && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="text-[9px] font-black uppercase tracking-wider text-gray-400">
                  <tr>
                    <th className="py-1 pr-2">Product</th>
                    <th className="py-1 pr-2">Price</th>
                    <th className="py-1 pr-2">Offer</th>
                    <th className="py-1 pr-2">Est. Var. Cost</th>
                    <th className="py-1 pr-2">Contribution</th>
                    <th className="py-1">Drop</th>
                  </tr>
                </thead>
                <tbody className="text-[11px]">
                  {rows.slice(0, 8).map((r: any) => (
                    <tr key={r.productId} className="border-t border-blue-100/70">
                      <td className="py-1.5 pr-2 font-bold text-gray-800">{r.productName}</td>
                      <td className="py-1.5 pr-2 text-gray-600">{fmt(r.sellingPrice)}</td>
                      <td className="py-1.5 pr-2 text-gray-600">{fmt(r.discountedPrice)}</td>
                      <td className="py-1.5 pr-2 text-gray-500">
                        {r.hasRecipe ? fmt(r.recipeCost) : <span className="text-gray-300">—</span>}
                      </td>
                      <td className={`py-1.5 pr-2 font-bold ${r.discountedContribution > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {fmt(r.discountedContribution)}
                      </td>
                      <td className="py-1.5 font-semibold text-gray-500">{pct(r.contributionDropPercent)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rows.length > 8 && <p className="text-[10px] text-gray-400 mt-1">+ {rows.length - 8} more products…</p>}
          </>
        )}

        {/* Combo economics — bundle level */}
        {combo && (
          <div className="space-y-2">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { label: 'Individual value', value: fmt(combo.individualValue), cls: 'text-gray-800' },
                { label: 'Combo price', value: fmt(combo.comboPrice), cls: 'text-blue-700' },
                { label: 'Customer saves', value: fmt(combo.customerSavings), cls: 'text-emerald-600' },
                { label: 'Est. var. cost', value: fmt(combo.estVariableCost), cls: 'text-gray-700' },
              ].map((c) => (
                <div key={c.label} className="bg-white/80 border border-blue-100 rounded-xl px-3 py-2">
                  <p className={`text-sm font-black ${c.cls}`}>{c.value}</p>
                  <p className="text-[9px] font-black text-gray-400 uppercase tracking-wider">{c.label}</p>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-xs font-black ${combo.contribution > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                Contribution {fmt(combo.contribution)} · {pct(combo.contributionMarginPercent)}
              </span>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                combo.status === 'healthy' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  : combo.status === 'tight' ? 'bg-amber-50 text-amber-700 border border-amber-200'
                    : 'bg-rose-50 text-rose-700 border border-rose-200'
              }`}>
                {combo.status === 'healthy' ? '✓ Healthy' : combo.status === 'tight' ? '⚠ Tight margin' : '✗ Negative contribution'}
              </span>
              {combo.withRecipes < combo.products && (
                <span className="text-[10px] text-gray-400">
                  ({combo.withRecipes}/{combo.products} items have recipe costing)
                </span>
              )}
            </div>
          </div>
        )}

        {/* AI Combo Assistant — advisory only */}
        <div className="mt-3 bg-white/80 border border-purple-100 rounded-2xl p-3.5">
          <p className="text-xs font-black text-gray-800 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-purple-600" />
            AI Combo Assistant
            <span className="text-[9px] font-bold text-purple-500 bg-purple-100 px-1.5 py-0.5 rounded-full">advisory</span>
          </p>
          <p className="text-[10px] text-gray-500 mt-1">Describe the combo — e.g. &quot;combo of pizza and tandoori wings&quot;. The assistant checks costs and suggests safe price points.</p>
          <div className="flex gap-2 mt-2.5">
            <input
              value={cboText}
              onChange={(e) => setCboText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void askComboAssistant(); }}
              placeholder="e.g. combo of pizza and tandoori wings"
              className="flex-1 px-3 py-2.5 rounded-xl border border-[var(--color-border-input)] text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-purple-200 bg-[var(--color-bg-white)]"
            />
            <button
              onClick={() => void askComboAssistant()}
              disabled={cboBusy || !cboText.trim()}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[var(--color-purple-600-solid)] text-white text-xs font-black hover:bg-[var(--color-purple-700-solid)] transition-all cursor-pointer disabled:opacity-50"
            >
              {cboBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
              Propose
            </button>
          </div>
          {cboError && <p className="mt-2.5 text-[11px] font-semibold text-rose-600">{cboError}</p>}
          {cboProposal && (
            <div className="mt-3 space-y-2.5">
              <p className="text-[11px] text-gray-500">
                {cboProposal.targets.length} item(s): {cboProposal.targets.map((t: any) => t.name).join(', ')} · individual value {fmt(cboProposal.individualValue)}
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {(cboProposal.combos || []).slice(0, 5).map((c: any) => {
                  const isRec = cboProposal.recommended?.price === c.price;
                  return (
                    <button
                      key={c.price}
                      onClick={() => applyComboProposal(c.price)}
                      className={`text-left border rounded-xl px-3 py-2 transition-all cursor-pointer ${
                        isRec ? 'border-emerald-400 bg-emerald-50' : 'border-gray-200 bg-[var(--color-bg-white)] hover:border-purple-300'
                      }`}
                    >
                      <p className={`text-sm font-black ${isRec ? 'text-emerald-700' : 'text-gray-800'}`}>{fmt(c.price)}</p>
                      <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">
                        {isRec ? '★ Recommended' : `save ${fmt(c.customerSavings)}`}
                      </p>
                      <p className={`text-[10px] font-bold ${
                        c.status === 'healthy' ? 'text-emerald-600' : c.status === 'tight' ? 'text-amber-600' : 'text-rose-600'
                      }`}>
                        {pct(c.contributionMarginPercent)} margin · {c.status}
                      </p>
                    </button>
                  );
                })}
              </div>
              <p className="text-[9px] text-gray-400">Tap a price to fill the combo — you stay in control of scope, audience and schedule.</p>
            </div>
          )}
        </div>

        {warnings.length > 0 && (
          <div className="mt-3 space-y-1.5">
            {warnings.slice(0, 4).map((w, i) => (
              <p key={i} className="flex items-start gap-1.5 text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {w}
              </p>
            ))}
          </div>
        )}

        {summary && summary.withRecipes > 0 && (
          <p className="text-[10px] text-gray-400 mt-2">
            {summary.products} product(s) affected · {summary.withRecipes} with recipe costing · avg contribution drop {pct(summary.avgContributionDrop)}.
            Estimates use current weighted-average ingredient costs.
          </p>
        )}
      </div>

      {/* AI Offer Assistant — advisory only */}
      <div className="bg-gradient-to-br from-purple-50 to-indigo-50 border border-purple-100 rounded-2xl p-4">
        <p className="text-xs font-black text-gray-800 flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-purple-600" />
          AI Offer Assistant
          <span className="text-[9px] font-bold text-purple-500 bg-purple-100 px-1.5 py-0.5 rounded-full">advisory</span>
        </p>
        <p className="text-[10px] text-gray-500 mt-1">Describe the offer in your own words — e.g. &quot;20% off paneer dishes this weekend&quot;. The assistant checks costs and suggests a safe configuration.</p>
        <div className="flex gap-2 mt-2.5">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void askAssistant(); }}
            placeholder="e.g. give 10% off pizza this weekend"
            className="flex-1 px-3 py-2.5 rounded-xl border border-[var(--color-border-input)] text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-purple-200 bg-[var(--color-bg-white)]"
          />
          <button
            onClick={() => void askAssistant()}
            disabled={aiBusy || !text.trim()}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[var(--color-purple-600-solid)] text-white text-xs font-black hover:bg-[var(--color-purple-700-solid)] transition-all cursor-pointer disabled:opacity-50"
          >
            {aiBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
            Propose
          </button>
        </div>

        {aiError && <p className="mt-2.5 text-[11px] font-semibold text-rose-600">{aiError}</p>}

        {proposal && (
          <div className="mt-3 bg-[var(--color-bg-white)] border border-purple-100 rounded-2xl p-3.5 space-y-2.5">
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider">Proposal</p>
            <p className="text-xs font-bold text-gray-800">
              {proposal.intent?.discountType} · {proposal.intent?.value}% off {proposal.intent?.targetName || 'products'}
              {proposal.intent?.timeHint ? ` · ${proposal.intent.timeHint}` : ''}
            </p>
            {proposal.targets && (
              <p className="text-[11px] text-gray-500">{proposal.targets.length} product(s): {proposal.targets.slice(0, 5).map((t: any) => t.name).join(', ')}{proposal.targets.length > 5 ? ` +${proposal.targets.length - 5} more` : ''}</p>
            )}
            {proposal.summary?.recommended && (
              <div className="flex flex-wrap gap-2">
                <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-2 py-1">
                  Recommended: {proposal.summary.recommended.value}% off — avg contribution drop {pct(proposal.summary.recommended.avgContributionDrop)}
                </span>
                {proposal.summary.recommended.warningCount > 0 && (
                  <span className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1">
                    ⚠ {proposal.summary.recommended.warningCount} product(s) need attention
                  </span>
                )}
              </div>
            )}
            {(proposal.warnings || []).slice(0, 3).map((w: string, i: number) => (
              <p key={i} className="flex items-start gap-1.5 text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {w}
              </p>
            ))}
            <button
              onClick={applyProposal}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[var(--color-emerald-600-solid)] text-white text-xs font-black hover:bg-[var(--color-emerald-700-solid)] transition-all cursor-pointer"
            >
              <Check className="w-3.5 h-3.5" /> Apply to offer
            </button>
            <p className="text-[9px] text-gray-400">Applying fills the discount below — you stay in control of scope, audience and schedule.</p>
          </div>
        )}
      </div>
    </div>
  );
}
