/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Award, User, X } from 'lucide-react';
import type { Customer, LoyaltyReward, SystemSettings } from '../../types';

interface OffersPopupProps {
  isOpen: boolean;
  searchedCustomer: Customer | null;
  rewards: LoyaltyReward[];
  settings: SystemSettings;
  appliedReward: LoyaltyReward | null;
  onClose: () => void;
  onApplyReward: (reward: LoyaltyReward) => void;
}

export default function OffersPopup({
  isOpen, searchedCustomer, rewards, settings, appliedReward, onClose, onApplyReward,
}: OffersPopupProps) {
  if (!isOpen || !searchedCustomer) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full mx-4 border border-[#e1e2ed] max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b border-[#e1e2ed] flex justify-between items-center bg-white">
          <h3 className="font-bold text-sm flex items-center gap-1.5">
            <Award className="w-4 h-4 text-amber-500" />
            Available Offers & Rewards
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4 space-y-3">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs">
            <p className="font-bold text-blue-800 flex items-center gap-1"><User className="w-4 h-4" />{searchedCustomer.name}</p>
            <p className="text-blue-600 mt-1">Loyalty Points: <strong>{searchedCustomer.points} pts</strong></p>
            <p className="text-blue-600">Total Visits: <strong>{searchedCustomer.visits}</strong></p>
          </div>
          {rewards.length === 0 ? (
            <div className="text-center py-8 text-gray-400">
              <Award className="w-12 h-12 mx-auto mb-2 text-gray-200" />
              <p className="text-xs font-semibold">No rewards configured</p>
              <p className="text-[10px]">Add rewards in the Offers workspace</p>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Available Reward Tiers</p>
              {rewards.filter(r => r.pointsRequired <= (searchedCustomer.points || 0)).map((reward) => (
                <div key={reward.id} className={`border rounded-lg p-3 transition-all ${appliedReward?.id === reward.id ? 'border-green-300 bg-green-50' : 'border-[#e1e2ed] hover:border-[#004ac6]/30 bg-white'}`}>
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <p className="text-xs font-bold">{reward.title}</p>
                      <p className="text-[10px] text-gray-500 mt-0.5">
                        {reward.type === 'percentage' ? reward.value + '% off' :
                         reward.type === 'item' ? 'Free: ' + (reward.rewardItemName || 'Menu Item') :
                         settings.currencySymbol + reward.value + ' off'}
                      </p>
                      {reward.minBillAmount > 0 && (
                        <p className="text-[9px] text-gray-400 mt-0.5">Min. bill: {settings.currencySymbol}{reward.minBillAmount}</p>
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
                            : 'bg-[#004ac6] text-white hover:bg-[#003ea8] shadow-sm'
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
          {searchedCustomer && settings.visitMilestones && settings.visitMilestones.length > 0 && (
            <div className="mt-3 pt-3 border-t border-[#e1e2ed]">
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
