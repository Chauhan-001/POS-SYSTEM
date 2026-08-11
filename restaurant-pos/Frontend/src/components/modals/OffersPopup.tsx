/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * OffersPopup — checkout offer & rewards experience.
 *
 * The cashier sees:
 *   1. The currently applied promotion (server-validated discount)
 *   2. Available active offers (fetched from the server) — Apply validates
 *      server-side via POST /offers/validate; the server computes the
 *      authoritative discount. The frontend never computes discounts.
 *   3. "Have a coupon?" — code is resolved + validated server-side.
 *   4. Loyalty reward tiers + visit milestones (existing behavior preserved).
 *
 * Every failure path shows a human-friendly message — raw API codes like
 * MUTUALLY_EXCLUSIVE_GROUP_CONFLICT are never shown to staff.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Award, CheckCircle2, Tag, User, X } from 'lucide-react';
import type { Customer, LoyaltyReward, SystemSettings } from '../../types';
import { fetchOfferList, validateOffer } from '../../api/client';

interface AppliedOffer {
  offer: any;
  discount: number;
}

interface OffersPopupProps {
  isOpen: boolean;
  searchedCustomer: Customer | null;
  rewards: LoyaltyReward[];
  settings: SystemSettings;
  appliedReward: LoyaltyReward | null;
  appliedOffer: AppliedOffer | null;
  cartItems: any[];
  subtotal: number;
  onClose: () => void;
  onApplyReward: (reward: LoyaltyReward) => void;
  onApplyOffer: (applied: AppliedOffer) => void;
  onRemoveOffer: () => void;
}

/** Friendly summary of what an offer gives (mirrors checkout math, display only). */
function offerSummary(offer: any, currencySymbol: string): string {
  switch (offer.type) {
    case 'percentage': return `${offer.value}% OFF`;
    case 'flat': return `${currencySymbol}${offer.value} OFF`;
    case 'bogo': return 'Buy 1 Get 1';
    case 'free_item': return offer.freeItemName ? `Free: ${offer.freeItemName}` : 'Free item';
    case 'combo': return 'Combo deal';
    case 'cashback': return `${currencySymbol}${offer.value} cashback`;
    case 'reward_points': return `${offer.value} reward points`;
    case 'festival': return `Festival special · ${offer.value}% OFF`;
    case 'referral': return `Referral reward · ${currencySymbol}${offer.value}`;
    case 'loyalty_bonus': return `Loyalty bonus · ${currencySymbol}${offer.value}`;
    default: return offer.value ? `${offer.value}% OFF` : 'Special offer';
  }
}

/** Map a server rejection reason into a short, friendly explanation. */
function friendlyReason(reason?: string): string {
  if (!reason) return 'This offer cannot be applied right now.';
  const r = reason.toLowerCase();
  if (r.includes('minimum order')) return 'This offer needs a higher bill amount.';
  if (r.includes('expired')) return 'This offer has expired.';
  if (r.includes('not started')) return 'This offer hasn\'t started yet.';
  if (r.includes('usage limit') || r.includes('per-customer')) return 'This offer\'s usage limit has been reached.';
  if (r.includes('today') || r.includes('available')) return 'This offer isn\'t available at the moment.';
  if (r.includes('stack') || r.includes('mutually') || r.includes('combine')) return 'This offer can\'t be combined with another promotion on this bill.';
  if (r.includes('not found')) return 'That coupon code doesn\'t exist.';
  if (r.includes('inactive') || r.includes('paused') || r.includes('cancelled') || r.includes('draft')) return 'This offer is not active right now.';
  if (r.includes('qualifying')) return 'No items in this bill qualify for the offer.';
  if (r.includes('tier') || r.includes('segment') || r.includes('member')) return 'This offer is for a specific audience you\'re not part of.';
  if (r.includes('branch')) return 'This offer isn\'t available at this branch.';
  return reason;
}

export default function OffersPopup({
  isOpen, searchedCustomer, rewards, settings, appliedReward, appliedOffer,
  cartItems, subtotal, onClose, onApplyReward, onApplyOffer, onRemoveOffer,
}: OffersPopupProps) {
  const [offers, setOffers] = useState<any[]>([]);
  const [loadingOffers, setLoadingOffers] = useState(false);
  const [couponCode, setCouponCode] = useState('');
  const [validatingId, setValidatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const loadedOnce = useRef(false);

  const loadOffers = useCallback(async () => {
    if (loadingOffers) return;
    setLoadingOffers(true);
    setError(null);
    try {
      const data = await fetchOfferList();
      const list = (data?.offers || (Array.isArray(data) ? data : [])) as any[];
      // Only show offers the customer could actually use right now.
      setOffers(list.filter((o: any) => o.status === 'active' && !o.isDeleted));
    } catch {
      setOffers([]);
    } finally {
      setLoadingOffers(false);
    }
  }, [loadingOffers]);

  useEffect(() => {
    if (isOpen) {
      if (!loadedOnce.current) {
        loadedOnce.current = true;
        loadOffers();
      }
      setError(null);
      setSuccess(null);
      setCouponCode('');
    }
  }, [isOpen, loadOffers]);

  if (!isOpen) return null;

  const currencySymbol = settings.currencySymbol;
  const customerId = (searchedCustomer?._id as string) || (searchedCustomer?.id as string);
  const billItems = cartItems.map((item: any) => ({
    id: item.product?.id || item.id,
    name: item.product?.name || item.name || 'Item',
    price: item.price || 0,
    quantity: item.quantity || 1,
    category: item.product?.category,
  }));

  /** Validate a selected offer / coupon code against the server and apply it. */
  const tryApply = async (payload: { offerId?: string; couponCode?: string }, label: string, applyId: string) => {
    setValidatingId(applyId);
    setError(null);
    setSuccess(null);
    const result = await validateOffer({
      ...payload,
      customerId: customerId || undefined,
      customerPhone: searchedCustomer?.phone || undefined,
      billSubtotal: subtotal,
      billItems: billItems.length > 0 ? billItems : undefined,
      branchId: (settings as any).activeBranchId || undefined,
    });
    setValidatingId(null);
    if (!result.ok) {
      setError(result.reason || 'Could not reach the server. Please try again.');
      return;
    }
    if (!result.valid || !result.offer || !(result.discount ?? 0)) {
      setError(friendlyReason(result.reason));
      return;
    }
    onApplyOffer({ offer: result.offer, discount: result.discount ?? 0 });
    setSuccess(`${label} applied — you save ${currencySymbol}${(result.discount ?? 0).toFixed(2)} on this bill.`);
  };

  const submitCoupon = () => {
    const code = couponCode.trim();
    if (!code) { setError('Enter a coupon code first.'); return; }
    tryApply({ couponCode: code }, `Code ${code.toUpperCase()}`, 'coupon');
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full mx-4 border border-[#e1e2ed] max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b border-[#e1e2ed] flex justify-between items-center bg-white sticky top-0">
          <h3 className="font-bold text-sm flex items-center gap-1.5">
            <Award className="w-4 h-4 text-amber-500" />
            Offers & Rewards
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-4 space-y-4">
          {/* Applied promotion */}
          {appliedOffer && (
            <div className="bg-green-50 border border-green-300 rounded-lg p-3 flex items-center justify-between">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs font-bold text-green-800">{appliedOffer.offer.title}</p>
                  <p className="text-[10px] text-green-700">
                    {offerSummary(appliedOffer.offer, currencySymbol)}
                    {appliedOffer.offer.couponCode && <> · Code <span className="font-mono font-bold">{appliedOffer.offer.couponCode}</span></>}
                    {' '}· −{currencySymbol}{appliedOffer.discount.toFixed(2)}
                  </p>
                </div>
              </div>
              <button
                onClick={onRemoveOffer}
                className="text-[10px] font-bold text-red-600 bg-red-50 border border-red-200 px-2.5 py-1 rounded-lg hover:bg-red-100 transition-colors cursor-pointer shrink-0"
              >
                Remove
              </button>
            </div>
          )}

          {/* Feedback */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-2.5 text-[11px] text-red-700 font-medium">
              {error}
            </div>
          )}
          {success && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-2.5 text-[11px] text-green-700 font-medium">
              {success}
            </div>
          )}

          {/* Available offers */}
          <div>
            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1">
              <Tag className="w-3 h-3" /> Available Offers
            </p>
            {loadingOffers ? (
              <div className="text-center py-6 text-xs text-gray-400 animate-pulse">Loading offers…</div>
            ) : offers.length === 0 ? (
              <div className="text-center py-6 text-gray-400 border border-dashed border-[#e1e2ed] rounded-lg">
                <Tag className="w-8 h-8 mx-auto mb-1.5 text-gray-200" />
                <p className="text-xs font-semibold">No active offers</p>
                <p className="text-[10px]">Create a promotion in the Marketing workspace</p>
              </div>
            ) : (
              <div className="space-y-2">
                {offers.map((o: any) => {
                  const isApplied = appliedOffer?.offer?.id === o._id;
                  return (
                    <div key={o._id} className={`border rounded-lg p-3 transition-all ${isApplied ? 'border-green-300 bg-green-50' : 'border-[#e1e2ed] hover:border-[var(--brand-color)]/40 bg-white'}`}>
                      <div className="flex justify-between items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold text-[#191b23] truncate">{o.title}</p>
                          <p className="text-[10px] text-gray-500 mt-0.5">{offerSummary(o, currencySymbol)}</p>
                          {o.minOrderValue > 0 && (
                            <p className="text-[9px] text-gray-400 mt-0.5">Min. order {currencySymbol}{o.minOrderValue}</p>
                          )}
                          {o.maxDiscount > 0 && o.type === 'percentage' && (
                            <p className="text-[9px] text-gray-400">Save up to {currencySymbol}{o.maxDiscount}</p>
                          )}
                        </div>
                        <button
                          onClick={() => isApplied ? onRemoveOffer() : tryApply({ offerId: o._id }, o.title, o._id)}
                          disabled={validatingId !== null}
                          className={`mt-1 px-3 py-1.5 rounded-lg text-[10px] font-bold cursor-pointer transition-all shrink-0 ${
                            isApplied
                              ? 'bg-red-100 text-red-700 hover:bg-red-200 border border-red-200'
                              : validatingId === o._id
                                ? 'bg-gray-200 text-gray-500'
                                : 'bg-[var(--brand-color)] text-white hover:bg-[#003ea8] shadow-sm'
                          }`}
                        >
                          {validatingId === o._id ? 'Checking…' : isApplied ? 'Remove' : 'Apply'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Coupon code */}
          <div className="bg-gray-50 border border-[#e1e2ed] rounded-lg p-3">
            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">Have a coupon?</p>
            <div className="flex gap-2">
              <input
                value={couponCode}
                onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === 'Enter' && submitCoupon()}
                placeholder="Enter coupon code"
                disabled={validatingId !== null}
                className="flex-1 px-3 py-2 text-xs font-mono font-semibold uppercase border border-[#e1e2ed] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]/30"
              />
              <button
                onClick={submitCoupon}
                disabled={validatingId !== null || !couponCode.trim()}
                className={`px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  validatingId === 'coupon' ? 'bg-gray-200 text-gray-500'
                  : 'bg-[var(--brand-color)] text-white hover:bg-[#003ea8] shadow-sm disabled:opacity-50'
                }`}
              >
                {validatingId === 'coupon' ? 'Checking…' : 'Apply'}
              </button>
            </div>
            <p className="text-[9px] text-gray-400 mt-1.5">Customers can enter a code like WEEKEND20 at checkout. Codes are validated on the server.</p>
          </div>

          {/* Customer context */}
          {searchedCustomer && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs">
              <p className="font-bold text-blue-800 flex items-center gap-1"><User className="w-4 h-4" />{searchedCustomer.name}</p>
              <p className="text-blue-600 mt-1">Loyalty Points: <strong>{searchedCustomer.points} pts</strong></p>
              <p className="text-blue-600">Total Visits: <strong>{searchedCustomer.visits}</strong></p>
            </div>
          )}

          {/* Reward tiers */}
          {rewards.length === 0 ? (
            searchedCustomer && (
              <div className="text-center py-5 text-gray-400">
                <Award className="w-10 h-10 mx-auto mb-1.5 text-gray-200" />
                <p className="text-xs font-semibold">No rewards configured</p>
                <p className="text-[10px]">Add rewards in Marketing → Settings</p>
              </div>
            )
          ) : (
            <div className="space-y-2">
              <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Available Reward Tiers</p>
              {rewards.filter(r => !searchedCustomer || r.pointsRequired <= (searchedCustomer.points || 0)).map((reward) => (
                <div key={reward.id} className={`border rounded-lg p-3 transition-all ${appliedReward?.id === reward.id ? 'border-green-300 bg-green-50' : 'border-[#e1e2ed] hover:border-[var(--brand-color)]/30 bg-white'}`}>
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <p className="text-xs font-bold">{reward.title}</p>
                      <p className="text-[10px] text-gray-500 mt-0.5">
                        {reward.type === 'percentage' ? reward.value + '% off' :
                         reward.type === 'item' ? 'Free: ' + (reward.rewardItemName || 'Menu Item') :
                         currencySymbol + reward.value + ' off'}
                      </p>
                      {reward.minBillAmount > 0 && (
                        <p className="text-[9px] text-gray-400 mt-0.5">Min. bill: {currencySymbol}{reward.minBillAmount}</p>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] font-bold text-amber-600">{reward.pointsRequired} pts</p>
                      <button
                        onClick={() => onApplyReward(reward)}
                        data-tour="apply-offer-btn"
                        className={`mt-1 px-3 py-1 rounded-lg text-[10px] font-bold cursor-pointer transition-all ${
                          appliedReward?.id === reward.id
                            ? 'bg-red-100 text-red-700 hover:bg-red-200 border border-red-200'
                            : 'bg-[var(--brand-color)] text-white hover:bg-[#003ea8] shadow-sm'
                        }`}
                      >
                        {appliedReward?.id === reward.id ? 'Remove' : 'Apply'}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Visit milestones */}
          {searchedCustomer && settings.visitMilestones && settings.visitMilestones.length > 0 && (
            <div className="mt-1 pt-3 border-t border-[#e1e2ed]">
              <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">Visit Milestones</p>
              <div className="space-y-1.5">
                {settings.visitMilestones.map((m) => {
                  const isEligible = (searchedCustomer.visits || 0) >= Number(m.visits);
                  const isUpcoming = (searchedCustomer.visits || 0) < Number(m.visits);
                  return (
                    <div key={m.id} className={`flex justify-between items-center p-2 rounded-lg text-xs ${isEligible ? 'bg-green-50 border border-green-200' : 'bg-gray-50 border border-gray-100'}`}>
                      <span className={isEligible ? 'text-green-700 font-semibold' : 'text-gray-500'}>
                        {isEligible ? '✓ ' : '○ '}
                        Visit #{m.visits}: {m.rewardItemName}
                      </span>
                      {isUpcoming && <span className="text-[9px] text-gray-400">{Number(m.visits) - (searchedCustomer.visits || 0)} visits away</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
