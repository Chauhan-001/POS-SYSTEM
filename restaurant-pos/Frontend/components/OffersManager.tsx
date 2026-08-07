/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { 
  Tag, 
  Plus, 
  Trash2, 
  Calendar, 
  CalendarClock,
  Sparkles, 
  CheckCircle, 
  Info, 
  ShieldCheck, 
  Search, 
  Percent, 
  Gift, 
  Edit, 
  ChevronDown, 
  Clock, 
  ArrowLeftRight, 
  Ticket, 
  Award, 
  X,
  PlusCircle,
  HelpCircle,
  ArrowLeft,
  Brain,
  TrendingUp,
  Lightbulb,
  RotateCcw,
  AlertCircle,
  RefreshCw,
  LayoutGrid,
  Wrench,
  Users,
  BarChart3
} from 'lucide-react';
import { fetchOfferList, createOffer, updateOffer, deleteOffer, updateOfferStatus, createReward, updateReward, deleteReward } from '../src/api/client';
import { getDBData, setDBData } from '../src/data';
import { debugWarn } from '../src/utils/debugLog';
import { LoyaltyReward, SystemSettings, Product, VisitMilestone, Offer as OfferType, OfferSuggestion } from '../src/types';
import AiRecommendedOffers from './offers/AiRecommendedOffers';
import OfferBuilder from './offers/OfferBuilder';
import CustomerSegmentsPage from './offers/CustomerSegmentsPage';
import ActiveOffersList from './offers/ActiveOffersList';
import ScheduledOffersPage from './offers/ScheduledOffersPage';
import OfferAnalyticsPage from './offers/OfferAnalyticsPage';

interface OffersManagerProps {
  onBack?: () => void;
  rewards: LoyaltyReward[];
  onUpdateRewards: (updated: LoyaltyReward[]) => void;
  currencySymbol: string;
  settings?: SystemSettings;
  onUpdateSettings?: (updated: SystemSettings) => void;
  products?: Product[];
}


export default function OffersManager({ 
  onBack,
  rewards, 
  onUpdateRewards, 
  currencySymbol,
  settings,
  onUpdateSettings,
  products = []
}: OffersManagerProps) {
  // Point rate configuration state (supports decimals e.g., 0.05)
  const [ptsPerUnit, setPtsPerUnit] = useState<number>(settings?.loyaltyPointsPerDollar ?? 1);
  const [testBillAmount, setTestBillAmount] = useState<number>(100);

  // Point conversion state (e.g. 10 points = 1 rupee)
  const [pointValueRatio, setPointValueRatio] = useState<number>(settings?.pointsNeededForOneUnitCurrency ?? 10);

  // Milestone list state
  const [milestones, setMilestones] = useState<VisitMilestone[]>(() => {
    return settings?.visitMilestones || [
      { id: 'vm1', visits: 2, rewardItemId: 'p11', rewardItemName: 'Chocolate Lava Cake' },
      { id: 'vm2', visits: 5, rewardItemId: 'p13', rewardItemName: 'Premium Mojito' },
      { id: 'vm3', visits: 10, rewardItemId: 'p12', rewardItemName: 'New York Cheesecake' }
    ];
  });

  useEffect(() => {
    if (settings?.visitMilestones) {
      setMilestones(settings.visitMilestones);
    }
  }, [settings]);

  // Modal / Dialogue states
  const [activeModal, setActiveModal] = useState<'addReward' | 'addMilestone' | null>(null);
  
  // Create / Edit Reward Form States
  const [editingRewardId, setEditingRewardId] = useState<string | null>(null);
  const [rewardTitle, setRewardTitle] = useState('');
  const [rewardPoints, setRewardPoints] = useState(30);
  const [rewardType, setRewardType] = useState<'percentage' | 'flat' | 'item'>('flat');
  const [rewardValue, setRewardValue] = useState(5);
  const [rewardMinBill, setRewardMinBill] = useState(10);
  const [rewardIsLarge, setRewardIsLarge] = useState(false);
  const [rewardProductId, setRewardProductId] = useState<string>('');

  // Milestone Form States
  const [milestoneVisits, setMilestoneVisits] = useState<number>(15);
  const [selectedProductId, setSelectedProductId] = useState<string>(products[0]?.id || '');

  // ─── Offer Management Sub-Navigation ────────────────────────────
  type OfferSubTab = 'overview' | 'ai_recommended' | 'segments' | 'offer_builder' | 'active_offers' | 'scheduled_offers' | 'analytics';
  const [offerSubTab, setOfferSubTab] = useState<OfferSubTab>('overview');

  // ─── Backend Offers State ───────────────────────────────────────
  // Restore from localStorage so offers still show while offline; refreshed
  // (and re-cached) whenever the backend answers.
  const [backendOffers, setBackendOffers] = useState<OfferType[]>(() => getDBData<OfferType[]>('pos_offers', []));
  const [offersLoading, setOffersLoading] = useState(false);
  const [showBuilder, setShowBuilder] = useState(false);
  const [editingOffer, setEditingOffer] = useState<OfferType | undefined>(undefined);

  const fetchOffers = useCallback(async () => {
    setOffersLoading(true);
    try {
      const data = await fetchOfferList();
      if (data) {
        const list = data.offers || [];
        setBackendOffers(list);
        setDBData('pos_offers', list);
      }
    } catch { /* backend may not have offers yet */ }
    setOffersLoading(false);
  }, []);

  useEffect(() => {
    if (offerSubTab === 'active_offers' || offerSubTab === 'scheduled_offers' || offerSubTab === 'overview') {
      fetchOffers();
    }
  }, [offerSubTab, fetchOffers]);

  // Handlers for offer management
  const handlePublishSuggestion = async (suggestion: OfferSuggestion) => {
    try {
      const result = await createOffer({
        title: suggestion.title,
        description: suggestion.description,
        type: suggestion.type,
        value: suggestion.value,
        minOrderValue: suggestion.minOrderValue,
        recommendationSource: suggestion.recommendationSource,
        recommendationReason: suggestion.recommendationReason,
        estimatedReach: suggestion.estimatedReach,
        expectedImpact: suggestion.expectedImpact,
        applicableCategories: suggestion.applicableCategories,
        isAiGenerated: true,
        status: 'active',
      });
      if (result) {
        showLocalToast(`Offer "${suggestion.title}" published!`);
        fetchOffers();
      } else {
        showLocalToast('Failed to publish offer. Try again.');
      }
    } catch {
      showLocalToast('Failed to publish offer. Try again.');
    }
  };

  const handleCreateFromSuggestion = (suggestion: OfferSuggestion) => {
    setEditingOffer({
      _id: '',
      restaurantId: '',
      title: suggestion.title,
      description: suggestion.description,
      type: suggestion.type as any,
      value: suggestion.value,
      minOrderValue: suggestion.minOrderValue,
      recommendationSource: suggestion.recommendationSource,
      recommendationReason: suggestion.recommendationReason,
      estimatedReach: suggestion.estimatedReach,
      expectedImpact: suggestion.expectedImpact,
      applicableCategories: suggestion.applicableCategories,
      isAiGenerated: true,
      isAutoActivate: false,
      status: 'draft',
      currentUses: 0,
      applicableProductIds: [],
      targetSegmentIds: [],
      targetSegmentNames: [],
      branchIds: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    setOfferSubTab('offer_builder');
    setShowBuilder(true);
  };

  const handleSaveOffer = async (data: Partial<OfferType>) => {
    try {
      const isEdit = !!editingOffer?._id && editingOffer._id !== '';
      const result = isEdit && editingOffer?._id
        ? await updateOffer(editingOffer._id, data)
        : await createOffer(data);

      if (result) {
        showLocalToast(isEdit ? 'Offer updated!' : 'Offer created!');
        setShowBuilder(false);
        setEditingOffer(undefined);
        fetchOffers();
      } else {
        showLocalToast('Failed to save offer');
      }
    } catch {
      showLocalToast('Failed to save offer');
    }
  };

  const handleOfferStatusChange = async (id: string, status: string) => {
    try {
      const result = await updateOfferStatus(id, status);
      showLocalToast(`Offer status updated to ${status}`);
      fetchOffers();
      return result;
    } catch {
      showLocalToast('Failed to update status');
      return null;
    }
  };

  const handleDeleteOffer = async (id: string) => {
    try {
      const result = await deleteOffer(id);
      if (result) {
        showLocalToast('Offer deleted');
        fetchOffers();
      } else {
        showLocalToast('Failed to delete');
      }
    } catch {
      showLocalToast('Failed to delete');
    }
  };

  const handleDuplicateOffer = (offer: OfferType) => {
    setEditingOffer({ ...offer, _id: '', title: `${offer.title} (Copy)`, status: 'draft' });
    setOfferSubTab('offer_builder');
    setShowBuilder(true);
  };

  // Local Toast notification overlay (matches the black notification capsule in screenshot)
  const [localToast, setLocalToast] = useState<string | null>(null);

  const showLocalToast = (msg: string) => {
    setLocalToast(msg);
    setTimeout(() => {
      setLocalToast(null);
    }, 4000);
  };

  // Handlers for Loyalty configuration updates
  const handleUpdateLoyaltyRules = () => {
    if (onUpdateSettings && settings) {
      onUpdateSettings({
        ...settings,
        loyaltyPointsPerDollar: Number(ptsPerUnit),
        visitMilestones: milestones,
      });
    }
    showLocalToast('Loyalty rules updated successfully.');
  };

  // Add new Reward tier to state (actual database reward)
  const handleCreateRewardSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!rewardTitle.trim() || rewardValue <= 0 || rewardPoints <= 0) {
      alert('Please fill in valid reward fields.');
      return;
    }

    const matchedProd = rewardType === 'item' ? products.find(p => p.id === rewardProductId) : undefined;

    if (editingRewardId) {
      const updatedRewards = rewards.map(r => {
        if (r.id === editingRewardId) {
          return {
            ...r,
            title: rewardTitle.trim(),
            pointsRequired: Number(rewardPoints),
            type: rewardType,
            value: Number(rewardValue),
            minBillAmount: Number(rewardMinBill),
            isLargeReward: rewardIsLarge,
            rewardItemId: matchedProd?.id,
            rewardItemName: matchedProd?.name
          };
        }
        return r;
      });
      onUpdateRewards(updatedRewards);
      // BACKEND CALLED — push reward tier edit to /api/rewards.
      if (/^[a-fA-F0-9]{24}$/.test(editingRewardId)) {
        updateReward(editingRewardId, {
          title: rewardTitle.trim(),
          pointsRequired: Number(rewardPoints),
          type: rewardType,
          value: Number(rewardValue),
          ...(Number(rewardMinBill) > 0 ? { minBillAmount: Number(rewardMinBill) } : {}),
          isLargeReward: rewardIsLarge,
          ...(matchedProd?.id ? { rewardItemId: matchedProd.id, rewardItemName: matchedProd.name } : {}),
        }).catch(err => debugWarn('OffersManager', 'updateReward failed:', err));
      }
      showLocalToast(`Reward Catalog tier "${rewardTitle.trim()}" updated.`);
    } else {
      const newReward: LoyaltyReward = {
        id: `r_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        title: rewardTitle.trim(),
        pointsRequired: Number(rewardPoints),
        type: rewardType,
        value: Number(rewardValue),
        minBillAmount: Number(rewardMinBill),
        isLargeReward: rewardIsLarge,
        rewardItemId: matchedProd?.id,
        rewardItemName: matchedProd?.name
      };

      onUpdateRewards([...rewards, newReward]);
      // BACKEND CALLED — register the reward tier in /api/rewards. On success
      // the local temp id is swapped for the server _id so future edits/deletes
      // line up.
      createReward({
        title: newReward.title,
        pointsRequired: newReward.pointsRequired,
        type: newReward.type,
        value: newReward.value,
        ...(newReward.minBillAmount > 0 ? { minBillAmount: newReward.minBillAmount } : {}),
        isLargeReward: newReward.isLargeReward,
        ...(newReward.rewardItemId ? { rewardItemId: newReward.rewardItemId, rewardItemName: newReward.rewardItemName } : {}),
      }).then((created: any) => {
        const serverId = created?._id || created?.id;
        if (serverId) {
          onUpdateRewards(([...rewards, newReward]).map((r) => r.id === newReward.id ? { ...r, id: serverId } : r));
        }
      }).catch(err => debugWarn('OffersManager', 'createReward failed:', err));
      showLocalToast(`Reward Catalog tier "${newReward.title}" registered.`);
    }

    setActiveModal(null);
    setEditingRewardId(null);

    // reset form
    setRewardTitle('');
    setRewardPoints(30);
    setRewardValue(5);
    setRewardMinBill(10);
    setRewardIsLarge(false);
    setRewardProductId('');
  };

  // Delete live reward
  const handleDeleteLiveReward = (id: string) => {
    onUpdateRewards(rewards.filter(r => r.id !== id));
    // BACKEND CALLED — remove the reward tier from /api/rewards.
    if (/^[a-fA-F0-9]{24}$/.test(id)) {
      deleteReward(id).catch(err => debugWarn('OffersManager', 'deleteReward failed:', err));
    }
    showLocalToast('Reward tier deleted successfully.');
  };

  // Add Milestone to the list
  const handleAddMilestoneSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (milestoneVisits <= 0) {
      alert('Please enter a valid visit count.');
      return;
    }

    const selectedProduct = products.find(p => p.id === selectedProductId);
    if (!selectedProduct) {
      alert('Please select a valid item from the menu.');
      return;
    }

    // Check if visits milestone already exists
    if (milestones.some(m => m.visits === milestoneVisits)) {
      alert(`A milestone reward for Visit #${milestoneVisits} already exists. Please delete it first before re-defining.`);
      return;
    }

    const newMilestone: VisitMilestone = {
      id: `vm_${Date.now()}`,
      visits: Number(milestoneVisits),
      rewardItemId: selectedProduct.id,
      rewardItemName: selectedProduct.name
    };

    const updatedMilestones = [...milestones, newMilestone].sort((a, b) => a.visits - b.visits);
    setMilestones(updatedMilestones);
    
    // Save to settings immediately to be persistent
    if (onUpdateSettings && settings) {
      onUpdateSettings({
        ...settings,
        visitMilestones: updatedMilestones
      });
    }

    setActiveModal(null);
    showLocalToast(`Reward defined: Visit #${newMilestone.visits} earns ${newMilestone.rewardItemName}!`);
  };

  // Delete Milestone from local list
  const handleDeleteMilestone = (id: string) => {
    const updatedMilestones = milestones.filter(m => m.id !== id);
    setMilestones(updatedMilestones);

    if (onUpdateSettings && settings) {
      onUpdateSettings({
        ...settings,
        visitMilestones: updatedMilestones
      });
    }
    showLocalToast('Milestone reward removed.');
  };

  return (
    <div id="offers_rewards_workspace" className="flex flex-col h-full font-sans select-none">
      {/* Slim header bar — matches the Inventory page navigation style */}
      <div className="bg-white border-b border-[#e1e2ed] px-5 py-2.5 flex items-center gap-3 shrink-0">
        <button onClick={onBack} className="p-1.5 text-gray-400 hover:text-[#004ac6] hover:bg-blue-50 rounded-lg transition-all cursor-pointer" title="Back to POS">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#004ac6] to-blue-500 flex items-center justify-center shadow-sm shrink-0">
            <Tag className="w-4 h-4 text-white" />
          </div>
          <div className="flex items-center gap-6 min-w-0">
            <span className="text-sm font-bold tracking-tight whitespace-nowrap">Offers & Rewards</span>
            <nav className="flex items-center gap-0.5 overflow-x-auto">
              {([
                { id: 'overview' as OfferSubTab, label: 'Overview', icon: LayoutGrid },
                { id: 'ai_recommended' as OfferSubTab, label: 'AI Recommended', icon: Sparkles },
                { id: 'offer_builder' as OfferSubTab, label: 'Offer Builder', icon: Wrench },
                { id: 'scheduled_offers' as OfferSubTab, label: 'Scheduled', icon: CalendarClock },
                { id: 'segments' as OfferSubTab, label: 'Segments', icon: Users },
                { id: 'analytics' as OfferSubTab, label: 'Analytics', icon: BarChart3 },
              ]).map(tab => {
                const Icon = tab.icon;
                const isActive = offerSubTab === tab.id || (tab.id === 'offer_builder' && showBuilder);
                return (
                  <button
                    key={tab.id}
                    onClick={() => {
                      setOfferSubTab(tab.id);
                      if (tab.id === 'offer_builder') {
                        setEditingOffer(undefined);
                        setShowBuilder(true);
                      } else {
                        setShowBuilder(false);
                      }
                    }}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
                      isActive ? 'bg-[#004ac6] text-white shadow-sm' : 'text-gray-500 hover:text-[#004ac6] hover:bg-blue-50'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {tab.label}
                  </button>
                );
              })}
            </nav>
          </div>
        </div>
        <div className="flex-1" />
      </div>

      {/* Page Content */}
      <main className="flex-1 min-h-0 overflow-y-auto bg-[#fbfbff]">
        <div className="p-6 flex flex-col min-h-full">

      {/* Offer Builder Mode */}
      {showBuilder && (
        <div className="mb-6">
          <OfferBuilder
            initialData={editingOffer}
            onSave={handleSaveOffer}
            onCancel={() => {
              setShowBuilder(false);
              setEditingOffer(undefined);
            }}
            currencySymbol={currencySymbol}
            products={products as any}
          />
        </div>
      )}

      {/* AI Recommended Page */}
      {offerSubTab === 'ai_recommended' && !showBuilder && (
        <AiRecommendedOffers
          onCreateFromSuggestion={handleCreateFromSuggestion}
          onPublishSuggestion={handlePublishSuggestion}
        />
      )}

      {/* Active Offers Page */}
      {offerSubTab === 'active_offers' && !showBuilder && (
        <ActiveOffersList
          offers={backendOffers}
          loading={offersLoading}
          onEdit={(offer) => {
            setEditingOffer(offer);
            setShowBuilder(true);
          }}
          onRefresh={fetchOffers}
          onStatusChange={handleOfferStatusChange}
          onDelete={handleDeleteOffer}
          onDuplicate={handleDuplicateOffer}
          currencySymbol={currencySymbol}
        />
      )}

      {/* Scheduled Offers Page */}
      {offerSubTab === 'scheduled_offers' && !showBuilder && (
        <ScheduledOffersPage
          offers={backendOffers}
          loading={offersLoading}
          onRefresh={fetchOffers}
          onEdit={(offer) => {
            setEditingOffer(offer);
            setShowBuilder(true);
          }}
          onPublish={(id) => handleOfferStatusChange(id, 'active')}
          onDelete={handleDeleteOffer}
          currencySymbol={currencySymbol}
        />
      )}

      {/* Customer Segments Page */}
      {offerSubTab === 'segments' && !showBuilder && (
        <CustomerSegmentsPage />
      )}

      {/* Analytics Page */}
      {offerSubTab === 'analytics' && !showBuilder && (
        <OfferAnalyticsPage />
 )}

      {/* Default: Overview (existing content below) */}

      {/* Overview-only content — hidden when a sub-tab or the Offer Builder is open
          so pages replace the overview instead of stacking on top of it. */}
      {offerSubTab === 'overview' && !showBuilder && (
      <>

      {/* Top Banner Actions & Search bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
        
        {/* Buttons */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => { setEditingOffer(undefined); setOfferSubTab('offer_builder'); setShowBuilder(true); }}
            className="flex items-center gap-2 bg-[#004ac6] hover:bg-[#003ea8] text-white px-5 py-2.5 rounded-xl font-bold text-xs transition-all shadow-md active:scale-95 cursor-pointer"
          >
            <div className="p-0.5 rounded-full bg-white/20">
              <Plus className="w-3.5 h-3.5" />
            </div>
            Create New Offer
          </button>

          <button
            onClick={() => {
              setEditingRewardId(null);
              setRewardTitle('');
              setRewardPoints(30);
              setRewardType('flat');
              setRewardValue(5);
              setRewardMinBill(10);
              setRewardIsLarge(false);
              setRewardProductId('');
              setActiveModal('addReward');
            }}
            className="flex items-center gap-2 bg-[#eae9f5] hover:bg-[#deddf0] text-[#474087] px-5 py-2.5 rounded-xl font-bold text-xs transition-all active:scale-95 cursor-pointer"
          >
            <Ticket className="w-4 h-4" />
            Add New Reward
          </button>
        </div>

      </div>

      {/* Main Grid: Loyalty Configuration vs Active Offers Overview */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* Loyalty Configuration + Upcoming AI Feature (Span 4) */}
        <div className="lg:col-span-4 flex flex-col gap-6 h-full">
          <div className="bg-white rounded-2xl border border-[#e1e2ed] p-6 shadow-xs space-y-6">
            <div className="flex items-center gap-2 pb-1.5 border-b border-gray-50">
              <Tag className="w-5 h-5 text-[#004ac6]" />
              <h3 className="font-bold text-gray-900 text-sm tracking-tight">Loyalty Configuration</h3>
            </div>

          {/* Item 1: Points Accumulation (Flexible decimal point rate) */}
          <div className="space-y-2 bg-indigo-50/20 border border-indigo-100/40 p-4 rounded-2xl">
            <div className="flex justify-between items-center">
              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider">Points Accumulation</label>
              <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">Highly Flexible Rate</span>
            </div>
            
            <div className="flex items-center gap-2">
              <div className="text-xs text-gray-800 font-bold flex items-center gap-1.5 flex-1">
                Earn 
                <input 
                  type="number" 
                  step="0.001"
                  min="0"
                  value={ptsPerUnit} 
                  onChange={(e) => setPtsPerUnit(Number(e.target.value))}
                  className="w-20 bg-white border border-[#c3c6d7] text-center rounded-lg py-1 text-sm font-black text-[#004ac6]"
                /> 
                point(s)
              </div>
              <span className="text-xs text-gray-500 font-bold">per {currencySymbol}1.00 spent</span>
            </div>

            <div className="pt-2.5 mt-2 border-t border-indigo-100/50 space-y-1.5">
              {/* Formula explanation */}
              <div className="flex items-start gap-1 text-[10px] text-gray-500">
                <Info className="w-3.5 h-3.5 text-indigo-600 shrink-0 mt-0.5" />
                <p>
                  Setting points rate to <strong className="text-[#004ac6]">{ptsPerUnit}</strong> means a customer spending {currencySymbol}1,000 gets <strong className="text-indigo-700">{Math.round(1000 * ptsPerUnit)} points</strong>.
                </p>
              </div>

              {/* Point math tester calculator */}
              <div className="bg-white rounded-lg p-2 border border-indigo-100 flex items-center justify-between">
                <div className="flex items-center gap-1 text-[10px] font-semibold text-gray-600">
                  <span>Test Math: {currencySymbol}</span>
                  <input 
                    type="number" 
                    value={testBillAmount} 
                    onChange={(e) => setTestBillAmount(Number(e.target.value))}
                    className="w-12 border-b border-gray-300 text-center font-bold text-gray-800 bg-transparent focus:outline-none focus:border-[#004ac6]"
                  />
                  <span>Bill = </span>
                </div>
                <div className="text-[11px] font-extrabold text-indigo-700 font-mono">
                  {Number((testBillAmount * ptsPerUnit).toFixed(2))} Points
                </div>
              </div>
            </div>
          </div>

          {/* Item 2: Visit Milestones Config list (replaces visit threshold text box) */}
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider">Visit Milestone Rewards</label>
              
              <button
                type="button"
                onClick={() => {
                  if (products.length === 0) {
                    alert("No products available. Please add some products to the menu first.");
                    return;
                  }
                  setSelectedProductId(products[0]?.id || '');
                  setActiveModal('addMilestone');
                }}
                className="flex items-center gap-0.5 text-xs text-[#004ac6] hover:text-[#003ea8] font-black transition-colors"
              >
                <PlusCircle className="w-3.5 h-3.5" />
                Add Milestone
              </button>
            </div>

            {/* Scrollable container displaying active milestones */}
            <div className="border border-[#e1e2ed] rounded-2xl bg-gray-50/50 p-2 divide-y divide-gray-100 max-h-[220px] overflow-y-auto">
              {milestones.length === 0 ? (
                <div className="text-center py-6 text-gray-400 text-xs font-semibold">
                  <HelpCircle className="w-8 h-8 mx-auto mb-1 text-gray-300" />
                  No visit milestones defined yet.<br/>Click 'Add Milestone' to start.
                </div>
              ) : (
                milestones.map((m) => {
                  const matchedProd = products.find(p => p.id === m.rewardItemId);
                  const productPrice = matchedProd?.price || 0;
                  const productImage = matchedProd?.image;
                  return (
                    <div key={m.id} className="flex items-center justify-between py-2.5 px-2 hover:bg-white rounded-lg transition-colors group">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 bg-indigo-50 rounded-full flex items-center justify-center font-mono text-[10px] font-black text-indigo-700 shrink-0">
                          #{m.visits}
                        </div>
                        {productImage ? (
                          <img 
                            src={productImage} 
                            alt={m.rewardItemName} 
                            referrerPolicy="no-referrer"
                            className="w-7 h-7 rounded-lg object-cover bg-gray-100 border border-gray-200 shrink-0"
                            onError={(e) => { e.currentTarget.style.display = 'none'; }}
                          />
                        ) : (
                          <div className="w-7 h-7 rounded-lg bg-gray-100 border border-gray-200 text-gray-400 flex items-center justify-center shrink-0 text-[8px] font-bold">
                            Dish
                          </div>
                        )}
                        <div className="flex flex-col">
                          <span className="text-xs font-extrabold text-gray-800 group-hover:text-[#004ac6] transition-colors">
                            {m.rewardItemName}
                          </span>
                          <span className="text-[9px] text-gray-400 font-medium">
                            Awarded on visit #{m.visits} (Menu value: {currencySymbol}{productPrice.toFixed(2)})
                          </span>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleDeleteMilestone(m.id)}
                        className="p-1 text-gray-300 hover:text-red-600 hover:bg-red-50 rounded transition-colors opacity-0 group-hover:opacity-100"
                        title="Delete Milestone"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            <p className="text-[10px] text-gray-400 font-medium leading-normal bg-blue-50/50 border border-blue-100/50 p-2.5 rounded-xl">
              💡 <strong>Zero-Tension Loyalty:</strong> You can define custom rewards for visit #2, #5, #10, or even the #100th milestone. The system automatically awards the dish during checkout when their visit count matches the target.
            </p>
          </div>



          {/* Form Trigger button */}
          <button
            onClick={handleUpdateLoyaltyRules}
            className="w-full bg-[#eae9f5] hover:bg-[#e1e0f0] text-[#004ac6] hover:text-[#003ea8] font-black py-3 rounded-xl text-xs transition-all tracking-wide active:scale-98 shadow-xs mt-4 uppercase"
          >
            Update Loyalty Rules
          </button>
        </div>

          {/* AI Offer Recommendations — link to full AI Recommended page */}
          <div className="bg-white rounded-2xl border border-purple-100 p-5 shadow-xs flex-1 flex flex-col items-center justify-center text-center">
            <Sparkles className="w-8 h-8 text-purple-400 mb-2" />
            <h3 className="font-bold text-gray-900 text-sm mb-1">AI Offer Suggestions</h3>
            <p className="text-[10px] text-gray-400 mb-4">Get AI-powered promotional recommendations based on weather, festivals, and sales data.</p>
            <button
              onClick={() => setOfferSubTab('ai_recommended')}
              className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 text-white px-5 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer"
            >
              <Sparkles className="w-4 h-4" />
              View AI Recommendations
            </button>
          </div>
        </div>

        {/* Right Column: Active Offers Overview (Span 8) */}
        <div className="lg:col-span-8 bg-white rounded-2xl border border-[#e1e2ed] p-6 shadow-xs flex flex-col min-h-[460px]">
          
          <div className="flex items-center justify-between pb-4 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <Award className="w-5 h-5 text-[#004ac6]" />
              <h3 className="font-bold text-gray-900 text-sm tracking-tight">Active Offers Overview</h3>
            </div>
            
            <span className="bg-[#004ac6] text-white text-[10px] font-bold px-3 py-1 rounded-full uppercase font-mono tracking-wider">
              {offersLoading ? '...' : backendOffers.filter(o => o.status === 'active' || o.status === 'scheduled').length + rewards.length} Active Promotions
            </span>
          </div>

          {/* Table Container */}
          <div className="flex-1 overflow-x-auto mt-4">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-gray-100 text-gray-400 font-bold uppercase text-[9px] tracking-wider">
                  <th className="pb-3 font-bold">Offer Name</th>
                  <th className="pb-3 font-bold">Type</th>
                  <th className="pb-3 font-bold">Status</th>
                  <th className="pb-3 font-bold">Expiry</th>
                  <th className="pb-3 font-bold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                
                {/* 1. Live Rewards Catalog Database Rows */}
                {rewards.map((reward) => (
                  <tr key={reward.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-indigo-50 flex items-center justify-center shrink-0">
                          <Ticket className="w-4 h-4 text-indigo-600" />
                        </div>
                        <div className="flex flex-col">
                          <span className="font-extrabold text-gray-900">{reward.title}</span>
                          <span className="text-[10px] text-gray-400">{reward.pointsRequired} Loyalty Points needed</span>
                        </div>
                      </div>
                    </td>
                    <td className="py-3.5">
                      <span className="font-semibold text-gray-600 text-[11px] capitalize">
                        {reward.type === 'percentage' ? 'Percentage Off' : (reward.type === 'item' ? 'Free Item' : 'Flat Discount')}
                      </span>
                    </td>
                    <td className="py-3.5">
                      <span className="inline-flex items-center gap-1 bg-green-50 text-green-700 font-bold px-2 py-0.5 rounded text-[10px]">
                        <span className="w-1.5 h-1.5 bg-green-500 rounded-full"></span>
                        Active
                      </span>
                    </td>
                    <td className="py-3.5">
                      <span className="font-mono text-gray-500 text-[11px]">No Expiry</span>
                    </td>
                    <td className="py-3.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button 
                          onClick={() => {
                            setEditingRewardId(reward.id);
                            setRewardTitle(reward.title);
                            setRewardPoints(reward.pointsRequired);
                            setRewardType(reward.type);
                            setRewardValue(reward.value);
                            setRewardMinBill(reward.minBillAmount);
                            setRewardIsLarge(reward.isLargeReward);
                            setRewardProductId(reward.rewardItemId || '');
                            setActiveModal('addReward');
                          }}
                          className="p-1 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors" 
                          title="Edit Reward"
                        >
                          <Edit className="w-3.5 h-3.5" />
                        </button>
                        <button 
                          onClick={() => handleDeleteLiveReward(reward.id)}
                          className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors" 
                          title="Delete Reward"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}

                {/* 2. Real Backend Offers Rows */}
                {offersLoading ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-gray-400">
                      Loading offers...
                    </td>
                  </tr>
                ) : backendOffers.length > 0 ? (
                  backendOffers.slice(0, 10).map((offer) => (
                    <tr key={offer._id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="py-3.5">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-blue-50 flex items-center justify-center shrink-0">
                            <Percent className="w-4 h-4 text-blue-600" />
                          </div>
                          <div className="flex flex-col">
                            <span className="font-extrabold text-gray-900">{offer.title}</span>
                            <span className="text-[10px] text-gray-400">{offer.description?.slice(0, 40) || 'No description'}</span>
                          </div>
                        </div>
                      </td>
                      <td className="py-3.5">
                        <span className="font-semibold text-gray-600 text-[11px] capitalize">{offer.type || 'N/A'}</span>
                      </td>
                      <td className="py-3.5">
                        <span className={`inline-flex items-center gap-1 font-bold px-2 py-0.5 rounded text-[10px] ${
                          offer.status === 'active' 
                            ? 'bg-green-50 text-green-700' 
                            : offer.status === 'scheduled' 
                              ? 'bg-amber-50 text-amber-700' 
                              : 'bg-gray-100 text-gray-500'
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${
                            offer.status === 'active' 
                              ? 'bg-green-500' 
                              : offer.status === 'scheduled' 
                                ? 'bg-amber-500' 
                                : 'bg-gray-400'
                          }`}></span>
                          {offer.status}
                        </span>
                      </td>
                      <td className="py-3.5">
                        <span className="font-mono text-gray-500 text-[11px]">
                          {offer.endDate ? new Date(offer.endDate).toLocaleDateString() : 'No expiry'}
                        </span>
                      </td>
                      <td className="py-3.5 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button 
                            onClick={() => {
                              setEditingOffer(offer);
                              setOfferSubTab('offer_builder');
                              setShowBuilder(true);
                            }}
                            className="p-1 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors" 
                            title="Edit Offer"
                          >
                            <Edit className="w-3.5 h-3.5" />
                          </button>
                          <button 
                            onClick={() => handleDeleteOffer(offer._id)}
                            className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors" 
                            title="Delete Offer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-gray-400">
                      No offers created yet. Click "Create New Offer" to get started.
                    </td>
                  </tr>
                )}

              </tbody>
            </table>
          </div>

          {/* Bottom Table view link */}
          <div className="pt-4 border-t border-gray-100 text-center">
            <button
              onClick={() => setOfferSubTab('active_offers')}
              className="text-[#004ac6] hover:text-[#003ea8] text-xs font-bold transition-colors cursor-pointer"
            >
              View All Offers {backendOffers.length > 0 ? `(${backendOffers.length})` : ''}
            </button>
          </div>

        </div>

      </div>

      {/* Bottom Section: Reward Catalog */}
      <div className="mt-10 border-t border-gray-100 pt-8">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-baseline gap-2">
            <h3 className="font-bold text-gray-900 text-sm tracking-tight">Reward Catalog</h3>
            <span className="text-[11px] text-gray-400 font-semibold">Redeemable by loyalty points</span>
          </div>
        </div>

        {/* Catalog items grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {rewards.map((reward) => (
            <div 
              key={reward.id} 
              className="bg-white border-2 border-dashed border-[#e1e2ed] rounded-2xl p-4 relative overflow-hidden flex flex-col justify-between hover:border-[#004ac6] transition-all group"
            >
              {/* Scissors cut-out left/right circular overlays to look like an authentic coupon */}
              <div className="absolute -left-3 top-1/2 -translate-y-1/2 w-6 h-6 bg-[#fbfbff] rounded-full border-r-2 border-dashed border-[#e1e2ed] z-10"></div>
              <div className="absolute -right-3 top-1/2 -translate-y-1/2 w-6 h-6 bg-[#fbfbff] rounded-full border-l-2 border-dashed border-[#e1e2ed] z-10"></div>

              <div className="px-3">
                <div className="flex justify-between items-start mb-2">
                  <span className="font-extrabold text-[10px] bg-blue-50 text-[#004ac6] px-2.5 py-0.5 rounded-full font-mono">
                    {reward.pointsRequired} pts
                  </span>
                  {reward.isLargeReward && (
                    <span className="text-[8px] font-bold bg-amber-50 text-amber-700 border border-amber-100 px-1.5 py-0.5 rounded flex items-center gap-0.5 uppercase">
                      <ShieldCheck className="w-2.5 h-2.5" />
                      OTP Secure
                    </span>
                  )}
                </div>

                <h4 className="font-extrabold text-xs text-gray-900 group-hover:text-[#004ac6] transition-colors mb-1">
                  {reward.title}
                </h4>
                
                <p className="text-[10px] text-gray-400">
                  Min spend: {currencySymbol}{reward.minBillAmount.toFixed(2)} | Type: <span className="capitalize">{reward.type}</span>
                </p>
              </div>

              <div className="mt-4 pt-3 border-t border-gray-50 flex justify-between items-center px-3 z-20">
                <strong className="text-xs font-black text-[#004ac6] font-mono uppercase">
                  {reward.type === 'percentage' 
                    ? `${reward.value}% OFF` 
                    : (reward.type === 'item' ? 'FREE' : `-${currencySymbol}${reward.value.toFixed(2)}`)}
                </strong>

                <button
                  onClick={() => handleDeleteLiveReward(reward.id)}
                  className="text-[10px] text-red-500 hover:text-red-700 font-bold flex items-center gap-0.5"
                  title="Void Reward"
                >
                  <Trash2 className="w-3 h-3" />
                  Void
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
      </>
      )}

        </div>
      </main>

      {/* MODAL 1: Add New Reward */}
      {activeModal === 'addReward' && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl border border-[#e1e2ed] max-w-md w-full overflow-hidden">
            <div className="bg-[#f0f0fa] px-6 py-4 flex justify-between items-center border-b border-[#e1e2ed]">
              <h4 className="font-bold text-gray-900 text-sm flex items-center gap-1.5">
                <Ticket className="w-4.5 h-4.5 text-[#004ac6]" />
                {editingRewardId ? 'Update Reward Tier' : 'Configure New Reward Tier'}
              </h4>
              <button 
                onClick={() => {
                  setActiveModal(null);
                  setEditingRewardId(null);
                  setRewardTitle('');
                  setRewardPoints(30);
                  setRewardType('flat');
                  setRewardValue(5);
                  setRewardMinBill(10);
                  setRewardIsLarge(false);
                  setRewardProductId('');
                }} 
                className="text-gray-400 hover:text-gray-700 font-bold"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateRewardSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1">Reward Title</label>
                <input 
                  type="text" 
                  placeholder="e.g. Free Hot Garlic Bread"
                  value={rewardTitle}
                  onChange={(e) => setRewardTitle(e.target.value)}
                  className="w-full bg-white border border-[#c3c6d7] px-3 py-2 rounded-xl text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[#004ac6] focus:border-[#004ac6]"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1">Points Required</label>
                  <input 
                    type="number" 
                    placeholder="e.g. 30"
                    value={rewardPoints || ''}
                    onChange={(e) => setRewardPoints(Number(e.target.value))}
                    className="w-full bg-white border border-[#c3c6d7] px-3 py-2 rounded-xl text-xs font-bold font-mono focus:outline-none focus:ring-1 focus:ring-[#004ac6] focus:border-[#004ac6]"
                    required
                  />
                </div>

                <div>
                  <label className="block text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1">Reward Type</label>
                  <select 
                    value={rewardType}
                    onChange={(e) => {
                      const nextType = e.target.value as any;
                      setRewardType(nextType);
                      if (nextType !== 'item') {
                        setRewardProductId('');
                      } else if (products.length > 0) {
                        setRewardProductId(products[0].id);
                        setRewardTitle(`Free ${products[0].name}`);
                        setRewardValue(products[0].price);
                      }
                    }}
                    className="w-full bg-white border border-[#c3c6d7] px-3 py-2 rounded-xl text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[#004ac6] focus:border-[#004ac6]"
                  >
                    <option value="flat">Flat Cash Reward</option>
                    <option value="percentage">Percentage Discount</option>
                    <option value="item">Free Menu Item</option>
                  </select>
                </div>
              </div>

              {rewardType === 'item' && (
                <div>
                  <label className="block text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1">Select Free Menu Item</label>
                  <select
                    value={rewardProductId}
                    onChange={(e) => {
                      setRewardProductId(e.target.value);
                      const matchedProd = products.find(p => p.id === e.target.value);
                      if (matchedProd) {
                        setRewardTitle(`Free ${matchedProd.name}`);
                        setRewardValue(matchedProd.price);
                      }
                    }}
                    className="w-full bg-white border border-[#c3c6d7] px-3 py-2 rounded-xl text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[#004ac6] focus:border-[#004ac6]"
                    required
                  >
                    <option value="">-- Choose a dish --</option>
                    {products.map(p => (
                      <option key={p.id} value={p.id}>{p.name} ({currencySymbol}{p.price.toFixed(2)})</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1">
                    {rewardType === 'item' ? `Free Item Retail Value (${currencySymbol})` : (rewardType === 'percentage' ? 'Discount (%)' : `Flat Amount (${currencySymbol})`)}
                  </label>
                  <input 
                    type="number" 
                    step="0.01"
                    placeholder="e.g. 5.00"
                    value={rewardValue || ''}
                    onChange={(e) => setRewardValue(Number(e.target.value))}
                    disabled={rewardType === 'item'}
                    className={`w-full border px-3 py-2 rounded-xl text-xs font-bold font-mono focus:outline-none focus:ring-1 focus:ring-[#004ac6] focus:border-[#004ac6] ${
                      rewardType === 'item' ? 'bg-gray-100 border-gray-200 text-gray-500 cursor-not-allowed' : 'bg-white border-[#c3c6d7]'
                    }`}
                    required
                  />
                </div>

                <div>
                  <label className="block text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1">Min Bill Limit ({currencySymbol})</label>
                  <input 
                    type="number" 
                    placeholder="e.g. 10.00"
                    value={rewardMinBill || ''}
                    onChange={(e) => setRewardMinBill(Number(e.target.value))}
                    className="w-full bg-white border border-[#c3c6d7] px-3 py-2 rounded-xl text-xs font-bold font-mono focus:outline-none focus:ring-1 focus:ring-[#004ac6] focus:border-[#004ac6]"
                    required
                  />
                </div>
              </div>

              <div className="pt-2 bg-gray-50 p-3 rounded-xl border border-gray-100">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={rewardIsLarge}
                    onChange={(e) => setRewardIsLarge(e.target.checked)}
                    className="rounded text-[#004ac6] focus:ring-[#004ac6] w-4 h-4 cursor-pointer"
                  />
                  <div className="flex flex-col">
                    <span className="text-[11px] font-extrabold text-gray-800">OTP Security Lock</span>
                    <span className="text-[9px] text-gray-400">Requires verification code sent to customer phone</span>
                  </div>
                </label>
              </div>

              <div className="flex gap-3 pt-3 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => {
                    setActiveModal(null);
                    setEditingRewardId(null);
                    setRewardTitle('');
                    setRewardPoints(30);
                    setRewardType('flat');
                    setRewardValue(5);
                    setRewardMinBill(10);
                    setRewardIsLarge(false);
                    setRewardProductId('');
                  }}
                  className="flex-1 py-2.5 border border-gray-200 hover:bg-gray-50 text-gray-700 font-bold rounded-xl text-xs cursor-pointer text-center"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 bg-[#004ac6] hover:bg-[#003ea8] text-white font-bold rounded-xl text-xs cursor-pointer text-center shadow-md"
                >
                  {editingRewardId ? 'Save Changes' : 'Register Reward Tier'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: Configure Visit Milestone Reward */}
      {activeModal === 'addMilestone' && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl border border-[#e1e2ed] max-w-lg w-full overflow-hidden">
            <div className="bg-[#f0f0fa] px-6 py-4 flex justify-between items-center border-b border-[#e1e2ed]">
              <h4 className="font-bold text-gray-900 text-sm flex items-center gap-1.5">
                <PlusCircle className="w-4.5 h-4.5 text-[#004ac6]" />
                Add Milestone Reward
              </h4>
              <button onClick={() => setActiveModal(null)} className="text-gray-400 hover:text-gray-700 font-bold">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddMilestoneSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1">Customer Visit Target</label>
                <input 
                  type="number" 
                  min="1"
                  value={milestoneVisits}
                  onChange={(e) => setMilestoneVisits(Number(e.target.value))}
                  className="w-full bg-white border border-[#c3c6d7] px-3 py-2 rounded-xl text-xs font-bold font-mono focus:outline-none focus:ring-1 focus:ring-[#004ac6]"
                  placeholder="e.g. 2, 5, 15, 100"
                  required
                />
                <span className="text-[10px] text-gray-400 mt-1 block">Specify the exact visit number (e.g. 100 for 100th visit reward)</span>
              </div>

              <div>
                <label className="block text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-2">Select Free Dish from Menu</label>
                <div className="flex gap-3 overflow-x-auto pb-3 pt-1 scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-transparent max-h-[140px]">
                  {products.map((p) => {
                    const isSelected = selectedProductId === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setSelectedProductId(p.id)}
                        className={`flex-none w-44 p-2.5 rounded-xl border text-left transition-all ${
                          isSelected 
                            ? 'bg-blue-50/70 border-[#004ac6] ring-2 ring-blue-100 shadow-sm' 
                            : 'bg-white border-gray-200 hover:bg-gray-50'
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1.5">
                          {p.image ? (
                            <img 
                              src={p.image} 
                              alt={p.name} 
                              referrerPolicy="no-referrer"
                              className="w-8 h-8 rounded-lg object-cover bg-gray-100 shrink-0 border border-gray-200 animate-fade-in" 
                              onError={(e) => { e.currentTarget.style.display = 'none'; }}
                            />
                          ) : (
                            <div className="w-8 h-8 rounded-lg bg-gray-100 text-gray-400 flex items-center justify-center shrink-0 border border-gray-200 text-[9px] font-bold">
                              Dish
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <span className="block text-[11px] font-extrabold text-gray-800 truncate" title={p.name}>
                              {p.name}
                            </span>
                            <span className="block text-[9px] text-gray-400 font-semibold truncate uppercase">
                              {p.category}
                            </span>
                          </div>
                        </div>
                        <div className="flex justify-between items-center mt-1">
                          <span className="text-[10px] font-extrabold text-[#004ac6] font-mono">
                            {currencySymbol}{p.price.toFixed(2)}
                          </span>
                          {isSelected && (
                            <span className="bg-[#004ac6] text-white text-[8px] px-1.5 py-0.5 rounded font-black uppercase tracking-wider">
                              Selected
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
                <span className="text-[10px] text-gray-400 mt-1 block">Provides owner flexibility to reward high-value items for higher visit milestones.</span>
              </div>

              <div className="flex gap-3 pt-3 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setActiveModal(null)}
                  className="flex-1 py-2.5 border border-gray-200 hover:bg-gray-50 text-gray-700 font-bold rounded-xl text-xs cursor-pointer text-center"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 bg-[#004ac6] hover:bg-[#003ea8] text-white font-bold rounded-xl text-xs cursor-pointer text-center shadow-md"
                >
                  Save Milestone
                </button>
              </div>
            </form>
          </div>
        </div>
      )}



      {/* REAL-TIME NOTIFICATION POPUP (Capsule Toast at the bottom like in the screenshot) */}
      {localToast && (
        <div className="fixed bottom-6 right-6 bg-[#1e293b] text-white px-5 py-3 rounded-xl shadow-2xl flex items-center gap-2.5 border border-slate-700/60 z-50 animate-bounce">
          <div className="w-5 h-5 rounded-full bg-green-500/20 text-green-400 flex items-center justify-center">
            <CheckCircle className="w-3.5 h-3.5" />
          </div>
          <span className="text-xs font-bold tracking-tight">{localToast}</span>
        </div>
      )}

    </div>
  );
}
