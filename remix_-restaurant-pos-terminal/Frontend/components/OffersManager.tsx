/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  Tag, 
  Plus, 
  Trash2, 
  Calendar, 
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
  ArrowLeft
} from 'lucide-react';
import { LoyaltyReward, SystemSettings, Product, VisitMilestone } from '../src/types';

interface OffersManagerProps {
  rewards: LoyaltyReward[];
  onUpdateRewards: (updated: LoyaltyReward[]) => void;
  currencySymbol: string;
  settings?: SystemSettings;
  onUpdateSettings?: (updated: SystemSettings) => void;
  products?: Product[];
}

// Inline mock data for extra promotions shown in the screenshot to match perfectly
interface MockOffer {
  id: string;
  name: string;
  subtitle: string;
  type: string;
  status: 'Active' | 'Scheduled' | 'Expired';
  expiry: string;
  iconType: 'percent' | 'bogo' | 'flat';
}

const INITIAL_MOCK_OFFERS: MockOffer[] = [
  {
    id: 'mock1',
    name: '10% Off Weekdays',
    subtitle: 'Mon-Fri | 11:00 - 15:00',
    type: 'Percentage',
    status: 'Active',
    expiry: 'Dec 31, 2026',
    iconType: 'percent',
  },
  {
    id: 'mock2',
    name: 'Buy 1 Get 1 Pizza',
    subtitle: 'Large Size Only',
    type: 'BOGO',
    status: 'Scheduled',
    expiry: 'Oct 25, 2026',
    iconType: 'bogo',
  },
  {
    id: 'mock3',
    name: 'Fall Fest - $5 Off',
    subtitle: 'Ended Sept 30',
    type: 'Fixed Amount',
    status: 'Expired',
    expiry: 'Sep 30, 2025',
    iconType: 'flat',
  },
  {
    id: 'mock4',
    name: 'Midnight Munchies 15%',
    subtitle: 'Daily | 23:00 - 02:00',
    type: 'Percentage',
    status: 'Expired',
    expiry: 'Jan 15, 2026',
    iconType: 'percent',
  },
  {
    id: 'mock5',
    name: 'Happy Hour Free Garlic Bread',
    subtitle: 'Mon-Thu | 16:00 - 18:00',
    type: 'Fixed Amount',
    status: 'Active',
    expiry: 'Aug 30, 2026',
    iconType: 'flat',
  },
  {
    id: 'mock6',
    name: 'Anniversary Flat $15 Off',
    subtitle: 'Min Spend $50',
    type: 'Fixed Amount',
    status: 'Expired',
    expiry: 'Mar 10, 2026',
    iconType: 'flat',
  },
  {
    id: 'mock7',
    name: 'Monsoon Double Points',
    subtitle: 'All Dine-in Orders',
    type: 'Percentage',
    status: 'Expired',
    expiry: 'Jun 30, 2026',
    iconType: 'percent',
  },
  {
    id: 'mock8',
    name: 'New Year Special 20%',
    subtitle: 'Celebrate the Countdown',
    type: 'Percentage',
    status: 'Expired',
    expiry: 'Jan 01, 2026',
    iconType: 'percent',
  },
  {
    id: 'mock9',
    name: 'Super Bowl Pizza Feast',
    subtitle: 'Free Soft Drink with Large Pizza',
    type: 'BOGO',
    status: 'Expired',
    expiry: 'Feb 12, 2026',
    iconType: 'bogo',
  },
  {
    id: 'mock10',
    name: 'IPL Match Day Combo',
    subtitle: 'Get 15% off during Live Match hours',
    type: 'Percentage',
    status: 'Expired',
    expiry: 'May 25, 2026',
    iconType: 'percent',
  },
  {
    id: 'mock11',
    name: 'Weekend Family Dinner 10%',
    subtitle: 'Fri-Sun | Min Spend $40',
    type: 'Percentage',
    status: 'Active',
    expiry: 'Nov 30, 2026',
    iconType: 'percent',
  },
  {
    id: 'mock12',
    name: 'Student ID Discount $3',
    subtitle: 'Show Valid Student Card',
    type: 'Fixed Amount',
    status: 'Active',
    expiry: 'Sep 30, 2026',
    iconType: 'flat',
  },
  {
    id: 'mock13',
    name: 'Corporate Lunch 12% Off',
    subtitle: 'Tech Park Badges Eligible',
    type: 'Percentage',
    status: 'Scheduled',
    expiry: 'Oct 01, 2026',
    iconType: 'percent',
  },
  {
    id: 'mock14',
    name: 'Sunday Brunch Free Beverage',
    subtitle: '10:00 - 14:00 Dine-in',
    type: 'BOGO',
    status: 'Active',
    expiry: 'Dec 15, 2026',
    iconType: 'bogo',
  },
  {
    id: 'mock15',
    name: 'Taco Tuesday Promo',
    subtitle: 'Buy 2 Get 1 Free',
    type: 'BOGO',
    status: 'Expired',
    expiry: 'Apr 28, 2026',
    iconType: 'bogo',
  },
  {
    id: 'mock16',
    name: 'Early Bird Coffee 15%',
    subtitle: 'Daily | 07:00 - 09:00',
    type: 'Percentage',
    status: 'Expired',
    expiry: 'Jun 15, 2026',
    iconType: 'percent',
  },
  {
    id: 'mock17',
    name: 'Diwali Fest - 20% Off',
    subtitle: 'Festive Season Offer',
    type: 'Percentage',
    status: 'Expired',
    expiry: 'Nov 15, 2025',
    iconType: 'percent',
  },
  {
    id: 'mock18',
    name: 'Christmas Sweet Deal',
    subtitle: 'Free Dessert with Dinner',
    type: 'BOGO',
    status: 'Expired',
    expiry: 'Dec 26, 2025',
    iconType: 'bogo',
  },
  {
    id: 'mock19',
    name: 'Valentine Couple Combo',
    subtitle: 'Special Candlelight Dinner Flat $10 Off',
    type: 'Fixed Amount',
    status: 'Expired',
    expiry: 'Feb 15, 2026',
    iconType: 'flat',
  },
  {
    id: 'mock20',
    name: 'Rainy Day Hot Soup Free',
    subtitle: 'On orders above $20 during rains',
    type: 'BOGO',
    status: 'Expired',
    expiry: 'Jul 10, 2026',
    iconType: 'bogo',
  },
  {
    id: 'mock21',
    name: 'Halloween Scary Spices',
    subtitle: 'Spicy pizza range 13% off',
    type: 'Percentage',
    status: 'Expired',
    expiry: 'Oct 31, 2025',
    iconType: 'percent',
  },
  {
    id: 'mock22',
    name: 'Black Friday $10 Coupon',
    subtitle: 'Min spend $60',
    type: 'Fixed Amount',
    status: 'Expired',
    expiry: 'Nov 28, 2025',
    iconType: 'flat',
  },
  {
    id: 'mock23',
    name: 'Summer Cooler BOGO',
    subtitle: 'Buy any Mocktail get one free',
    type: 'BOGO',
    status: 'Expired',
    expiry: 'May 31, 2026',
    iconType: 'bogo',
  },
  {
    id: 'mock24',
    name: 'Welcome Bonus - Free Coke',
    subtitle: 'First order on loyalty app',
    type: 'BOGO',
    status: 'Active',
    expiry: 'Dec 31, 2026',
    iconType: 'bogo',
  },
];

export default function OffersManager({ 
  rewards, 
  onUpdateRewards, 
  currencySymbol,
  settings,
  onUpdateSettings,
  products = []
}: OffersManagerProps) {
  // Tabs: All, Active, Scheduled
  const [activeTab, setActiveTab] = useState<'All' | 'Active' | 'Scheduled'>('All');
  const [showPastOffersPage, setShowPastOffersPage] = useState(false);
  const [pastSearch, setPastSearch] = useState('');
  const [pastFilterStatus, setPastFilterStatus] = useState<'All' | 'Active' | 'Scheduled' | 'Expired'>('All');
  const [pastFilterType, setPastFilterType] = useState<string>('All Types');
  
  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  
  // Reward Type Filter State
  const [selectedRewardType, setSelectedRewardType] = useState<string>('All Types');
  const [isRewardTypeDropdownOpen, setIsRewardTypeDropdownOpen] = useState(false);

  // Offers lists (Live database rewards + Mock promotions to match screenshot)
  const [mockOffers, setMockOffers] = useState<MockOffer[]>(INITIAL_MOCK_OFFERS);

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
  const [activeModal, setActiveModal] = useState<'createOffer' | 'addReward' | 'addMilestone' | null>(null);
  
  // Create / Edit Offer Form States
  const [newOfferName, setNewOfferName] = useState('');
  const [newOfferSubtitle, setNewOfferSubtitle] = useState('');
  const [newOfferType, setNewOfferType] = useState('Percentage');
  const [newOfferStatus, setNewOfferStatus] = useState<'Active' | 'Scheduled' | 'Expired'>('Active');
  const [newOfferExpiry, setNewOfferExpiry] = useState('Dec 31, 2024');
  
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

  // Add standard new offer to list
  const handleCreateOfferSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newOfferName.trim()) return;

    const added: MockOffer = {
      id: `offer_${Date.now()}`,
      name: newOfferName.trim(),
      subtitle: newOfferSubtitle.trim() || 'All orders applicable',
      type: newOfferType,
      status: newOfferStatus,
      expiry: newOfferExpiry || 'Dec 31, 2024',
      iconType: newOfferType === 'BOGO' ? 'bogo' : (newOfferType === 'Percentage' ? 'percent' : 'flat')
    };

    setMockOffers([added, ...mockOffers]);
    setActiveModal(null);
    showLocalToast(`Offer "${added.name}" registered successfully.`);
    
    // reset form
    setNewOfferName('');
    setNewOfferSubtitle('');
    setNewOfferType('Percentage');
    setNewOfferExpiry('Dec 31, 2024');
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
    showLocalToast('Reward tier deleted successfully.');
  };

  // Delete mock offer
  const handleDeleteMockOffer = (id: string) => {
    setMockOffers(mockOffers.filter(o => o.id !== id));
    showLocalToast('Offer promotion removed.');
  };

  // Toggle mock offer status
  const handleToggleMockStatus = (id: string) => {
    setMockOffers(mockOffers.map(o => {
      if (o.id === id) {
        const nextStatus: Record<string, 'Active' | 'Scheduled' | 'Expired'> = {
          'Active': 'Scheduled',
          'Scheduled': 'Expired',
          'Expired': 'Active'
        };
        return { ...o, status: nextStatus[o.status] };
      }
      return o;
    }));
    showLocalToast('Promotion status updated.');
  };

  // Close/Expire mock offer
  const handleCloseOffer = (id: string) => {
    setMockOffers(mockOffers.map(o => {
      if (o.id === id) {
        return { ...o, status: 'Expired' };
      }
      return o;
    }));
    showLocalToast('Offer closed successfully and marked as Expired.');
  };

  // Reactivate/Open mock offer
  const handleReactivateOffer = (id: string) => {
    setMockOffers(mockOffers.map(o => {
      if (o.id === id) {
        const futureDate = new Date();
        futureDate.setDate(futureDate.getDate() + 45); // Extend by 45 days
        const options: Intl.DateTimeFormatOptions = { month: 'short', day: '2-digit', year: 'numeric' };
        const expiryStr = futureDate.toLocaleDateString('en-US', options);
        return { ...o, status: 'Active', expiry: expiryStr };
      }
      return o;
    }));
    showLocalToast('Offer has been successfully reactivated and extended!');
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

  // Filtering offers list based on search and selected tabs
  const filteredMockOffers = mockOffers.filter(o => {
    // Tab filter
    if (activeTab === 'Active' && o.status !== 'Active') return false;
    if (activeTab === 'Scheduled' && o.status !== 'Scheduled') return false;
    
    // Type filter
    if (selectedRewardType !== 'All Types' && o.type !== selectedRewardType) return false;

    // Search filter
    const query = searchQuery.toLowerCase();
    return o.name.toLowerCase().includes(query) || o.subtitle.toLowerCase().includes(query) || o.type.toLowerCase().includes(query);
  });

  const rewardTypeOptions = ['All Types', 'Percentage', 'BOGO', 'Fixed Amount'];

  if (showPastOffersPage) {
    const filteredPastOffers = mockOffers.filter(o => {
      // Status filter
      if (pastFilterStatus !== 'All' && o.status !== pastFilterStatus) return false;
      // Type filter
      if (pastFilterType !== 'All Types' && o.type !== pastFilterType) return false;
      // Search query filter
      const query = pastSearch.toLowerCase();
      return o.name.toLowerCase().includes(query) || o.subtitle.toLowerCase().includes(query) || o.type.toLowerCase().includes(query);
    });

    const activeCount = mockOffers.filter(o => o.status === 'Active').length;
    const scheduledCount = mockOffers.filter(o => o.status === 'Scheduled').length;
    const expiredCount = mockOffers.filter(o => o.status === 'Expired').length;

    return (
      <div id="past_offers_workspace" className="p-6 h-full flex flex-col font-sans bg-[#fbfbff] overflow-y-auto select-none animate-fade-in animate-duration-300">
        {/* Top Header Row with back button */}
        <div className="flex items-center justify-between pb-4 border-b border-[#e1e2ed] mb-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setShowPastOffersPage(false)}
              className="p-2 hover:bg-gray-100 rounded-lg text-gray-600 transition-colors cursor-pointer border border-gray-200 bg-white"
              title="Go Back"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] uppercase font-extrabold tracking-wider text-[#004ac6] bg-blue-50 px-2 py-0.5 rounded font-mono">Registry & History</span>
                <span className="text-xs text-gray-400 font-mono font-bold">Total Registry: 24 Offers</span>
              </div>
              <h2 className="text-xl font-extrabold text-gray-900 tracking-tight mt-0.5">Historical & Active Offers Registry</h2>
            </div>
          </div>
          
          <button
            type="button"
            onClick={() => { setActiveModal('createOffer'); }}
            className="flex items-center gap-2 bg-[#004ac6] hover:bg-[#003ea8] text-white px-5 py-2.5 rounded-xl font-bold text-xs transition-all shadow-md active:scale-95 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Create Promotional Offer
          </button>
        </div>

        {/* Info Box */}
        <div className="bg-blue-50/70 border border-blue-100 p-4 rounded-2xl mb-6 flex gap-3 items-start">
          <Info className="w-5 h-5 text-[#004ac6] shrink-0 mt-0.5" />
          <div className="text-xs text-blue-900 leading-relaxed">
            <span className="font-extrabold block mb-0.5">Continuous Offer Lifecycle Control</span>
            Manage the active, scheduled, and past promo offers of your pizzeria. Close running campaigns to instantly expire them, or reactivate expired past promotions to bring them back online with an automatic validity extension.
          </div>
        </div>

        {/* Core metrics counters */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white border border-[#e1e2ed] rounded-2xl p-4 shadow-xs">
            <span className="text-[10px] font-extrabold text-gray-400 uppercase tracking-widest block">Total Database Offers</span>
            <span className="text-2xl font-black text-gray-900 font-mono block mt-1">{mockOffers.length}</span>
          </div>
          <div className="bg-white border border-[#e1e2ed] rounded-2xl p-4 shadow-xs">
            <span className="text-[10px] font-extrabold text-green-600 uppercase tracking-widest block">Active Offers</span>
            <span className="text-2xl font-black text-green-600 font-mono block mt-1">{activeCount}</span>
          </div>
          <div className="bg-white border border-[#e1e2ed] rounded-2xl p-4 shadow-xs">
            <span className="text-[10px] font-extrabold text-amber-600 uppercase tracking-widest block">Scheduled Offers</span>
            <span className="text-2xl font-black text-amber-600 font-mono block mt-1">{scheduledCount}</span>
          </div>
          <div className="bg-white border border-[#e1e2ed] rounded-2xl p-4 shadow-xs">
            <span className="text-[10px] font-extrabold text-red-500 uppercase tracking-widest block">Closed / Expired Offers</span>
            <span className="text-2xl font-black text-red-500 font-mono block mt-1">{expiredCount}</span>
          </div>
        </div>

        {/* Filter and search bar */}
        <div className="bg-white border border-[#e1e2ed] rounded-2xl p-4 shadow-xs space-y-4 mb-6">
          <div className="flex flex-col lg:flex-row gap-4 justify-between items-center">
            {/* Search */}
            <div className="relative w-full lg:w-1/3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search offer name, description, or type..."
                value={pastSearch}
                onChange={(e) => setPastSearch(e.target.value)}
                className="w-full pl-9 pr-4 py-2 text-xs rounded-xl border border-[#c3c6d7] focus:outline-none focus:ring-2 focus:ring-[#004ac6] bg-gray-50/50 font-medium text-gray-800"
              />
              {pastSearch && (
                <button type="button" onClick={() => setPastSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* Filter buttons */}
            <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">
              <span className="text-[10px] font-extrabold text-gray-400 uppercase tracking-wider mr-2">Status:</span>
              {(['All', 'Active', 'Scheduled', 'Expired'] as const).map((status) => (
                <button
                  type="button"
                  key={status}
                  onClick={() => setPastFilterStatus(status)}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    pastFilterStatus === status 
                      ? 'bg-[#004ac6] text-white shadow-xs' 
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {status}
                </button>
              ))}

              <span className="text-[10px] font-extrabold text-gray-400 uppercase tracking-wider ml-4 mr-2">Type:</span>
              {['All Types', 'Percentage', 'BOGO', 'Fixed Amount'].map((typeOption) => (
                <button
                  type="button"
                  key={typeOption}
                  onClick={() => setPastFilterType(typeOption)}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    pastFilterType === typeOption 
                      ? 'bg-gray-800 text-white shadow-xs' 
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {typeOption}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Master Registry Table */}
        <div className="bg-white rounded-2xl border border-[#e1e2ed] shadow-xs overflow-hidden flex-1 min-h-[400px]">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/75 text-[10px] font-extrabold uppercase tracking-wider text-gray-400">
                  <th className="py-3 px-6">Offer Name & Description</th>
                  <th className="py-3">Discount Type</th>
                  <th className="py-3">Status</th>
                  <th className="py-3">Validity Expiry</th>
                  <th className="py-3 px-6 text-right">Lifecycle Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-xs">
                {filteredPastOffers.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-12 text-center text-gray-400 font-medium">
                      No matching promotional offers found in this registry.
                    </td>
                  </tr>
                ) : (
                  filteredPastOffers.map((offer) => (
                    <tr key={offer.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="py-4 px-6">
                        <div className="flex items-center gap-3">
                          {offer.iconType === 'percent' && (
                            <div className="w-9 h-9 rounded-full bg-blue-50 flex items-center justify-center shrink-0">
                              <Percent className="w-4 h-4 text-[#004ac6]" />
                            </div>
                          )}
                          {offer.iconType === 'bogo' && (
                            <div className="w-9 h-9 rounded-full bg-orange-50 flex items-center justify-center shrink-0">
                              <Ticket className="w-4 h-4 text-orange-600" />
                            </div>
                          )}
                          {offer.iconType === 'flat' && (
                            <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
                              <Tag className="w-4 h-4 text-gray-600" />
                            </div>
                          )}
                          <div>
                            <span className="font-extrabold text-gray-900 block">{offer.name}</span>
                            <span className="text-[10px] text-gray-400 font-medium">{offer.subtitle}</span>
                          </div>
                        </div>
                      </td>
                      <td className="py-4 font-bold text-gray-600">
                        {offer.type}
                      </td>
                      <td className="py-4">
                        <span className={`inline-flex items-center gap-1 font-extrabold px-2.5 py-0.5 rounded text-[10px] ${
                          offer.status === 'Active' 
                            ? 'bg-green-50 text-green-700' 
                            : offer.status === 'Scheduled' 
                              ? 'bg-amber-50 text-amber-700' 
                              : 'bg-red-50 text-red-600'
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${
                            offer.status === 'Active' 
                              ? 'bg-green-500' 
                              : offer.status === 'Scheduled' 
                                ? 'bg-amber-500' 
                                : 'bg-red-500'
                          }`}></span>
                          {offer.status}
                        </span>
                      </td>
                      <td className="py-4 font-mono text-gray-500 text-[11px] font-bold">
                        {offer.expiry}
                      </td>
                      <td className="py-4 px-6 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {offer.status === 'Active' || offer.status === 'Scheduled' ? (
                            <button
                              type="button"
                              onClick={() => handleCloseOffer(offer.id)}
                              className="px-3 py-1 bg-red-50 hover:bg-red-100 text-red-700 font-extrabold rounded-lg text-[10px] transition-colors cursor-pointer border border-red-200"
                              title="Expire this Offer"
                            >
                              Close Offer
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleReactivateOffer(offer.id)}
                              className="px-3 py-1 bg-green-50 hover:bg-green-100 text-green-700 font-extrabold rounded-lg text-[10px] transition-colors cursor-pointer border border-green-200"
                              title="Reopen and Extend this Offer"
                            >
                              Reactivate Offer
                            </button>
                          )}
                          
                          <button
                            type="button"
                            onClick={() => {
                              setNewOfferName(offer.name);
                              setNewOfferSubtitle(offer.subtitle);
                              setNewOfferType(offer.type);
                              setNewOfferStatus(offer.status);
                              setNewOfferExpiry(offer.expiry);
                              setActiveModal('createOffer');
                            }}
                            className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors border border-transparent hover:border-gray-200"
                            title="Edit Details"
                          >
                            <Edit className="w-3.5 h-3.5" />
                          </button>
                          
                          <button
                            type="button"
                            onClick={() => handleDeleteMockOffer(offer.id)}
                            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors border border-transparent hover:border-red-100"
                            title="Delete offer from Database"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Back Button Footer */}
        <div className="mt-6 flex justify-start pb-6">
          <button
            type="button"
            onClick={() => setShowPastOffersPage(false)}
            className="flex items-center gap-2 border border-gray-300 hover:bg-gray-50 text-gray-700 px-5 py-2.5 rounded-xl font-bold text-xs transition-all cursor-pointer shadow-xs active:scale-98 bg-white"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Active Dashboard
          </button>
        </div>

        {/* Toast Overlay */}
        {localToast && (
          <div className="fixed bottom-6 right-6 z-50 bg-gray-900 text-white px-4 py-2.5 rounded-xl text-xs font-bold shadow-lg flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-green-400" />
            {localToast}
          </div>
        )}
      </div>
    );
  }

  return (
    <div id="offers_rewards_workspace" className="p-6 h-full flex flex-col font-sans bg-[#fbfbff] overflow-y-auto select-none">
      
      {/* Breadcrumb Header matching screenshot */}
      <div className="flex items-center gap-1.5 mb-6 text-gray-800 text-lg sm:text-xl font-bold font-sans">
        <span className="text-[#004ac6] font-extrabold">Offers & Rewards</span>
      </div>

      {/* Top Banner Actions & Search bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
        
        {/* Buttons */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setActiveModal('createOffer')}
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

        {/* Filter Controls Bar */}
        <div className="flex flex-wrap items-center gap-3">
          
          {/* Search Inputs */}
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input 
              type="text" 
              placeholder="Search offers or customers..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-white border border-[#e1e2ed] pl-9 pr-4 py-2 rounded-xl text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[#004ac6] focus:border-[#004ac6] placeholder-gray-400"
            />
          </div>

          {/* Tab buttons */}
          <div className="bg-[#f0f0fa] p-1 rounded-xl flex gap-1">
            {(['All', 'Active', 'Scheduled'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  activeTab === tab 
                    ? 'bg-white text-gray-900 shadow-sm' 
                    : 'text-gray-500 hover:text-gray-800'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* Reward Type Dropdown */}
          <div className="relative">
            <button
              onClick={() => setIsRewardTypeDropdownOpen(!isRewardTypeDropdownOpen)}
              className="flex items-center gap-1.5 bg-white border border-[#e1e2ed] px-4 py-2 rounded-xl text-xs font-bold text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <span>{selectedRewardType}</span>
              <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
            </button>

            {isRewardTypeDropdownOpen && (
              <div className="absolute right-0 mt-1.5 w-40 bg-white border border-[#e1e2ed] rounded-xl shadow-lg py-1 z-30">
                {rewardTypeOptions.map((opt) => (
                  <button
                    key={opt}
                    onClick={() => {
                      setSelectedRewardType(opt);
                      setIsRewardTypeDropdownOpen(false);
                    }}
                    className="w-full text-left px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    {opt}
                  </button>
                ))}
              </div>
            )}
          </div>

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

          {/* Upcoming Feature: AI Assistant */}
          <div className="bg-white rounded-2xl border border-[#e1e2ed] p-6 shadow-xs flex-1 flex flex-col">
            <h3 className="font-bold text-gray-900 text-sm tracking-tight mb-2">Upcoming Feature</h3>
            <p className="text-xs text-gray-500 mb-4">AI offer recommendations and chatbot.</p>
            <div className="bg-gray-100 flex-1 flex items-center justify-center rounded-lg text-gray-400 text-xs italic">
              AI Assistant Coming Soon...
            </div>
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
              {filteredMockOffers.length + rewards.length} Active Promotions
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

                {/* 2. Mock Promotions Rows from State */}
                {filteredMockOffers.map((offer) => (
                  <tr key={offer.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="py-3.5">
                      <div className="flex items-center gap-3">
                        
                        {offer.iconType === 'percent' && (
                          <div className="w-9 h-9 rounded-full bg-blue-50 flex items-center justify-center shrink-0">
                            <Percent className="w-4 h-4 text-blue-600" />
                          </div>
                        )}
                        {offer.iconType === 'bogo' && (
                          <div className="w-9 h-9 rounded-full bg-orange-50 flex items-center justify-center shrink-0">
                            <Gift className="w-4 h-4 text-orange-600" />
                          </div>
                        )}
                        {offer.iconType === 'flat' && (
                          <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
                            <Tag className="w-4 h-4 text-gray-600" />
                          </div>
                        )}

                        <div className="flex flex-col">
                          <span className="font-extrabold text-gray-900">{offer.name}</span>
                          <span className="text-[10px] text-gray-400">{offer.subtitle}</span>
                        </div>
                      </div>
                    </td>
                    <td className="py-3.5">
                      <span className="font-semibold text-gray-600 text-[11px]">{offer.type}</span>
                    </td>
                    <td className="py-3.5">
                      <button 
                        onClick={() => handleToggleMockStatus(offer.id)}
                        className={`inline-flex items-center gap-1 font-bold px-2 py-0.5 rounded text-[10px] transition-all cursor-pointer ${
                          offer.status === 'Active' 
                            ? 'bg-green-50 text-green-700' 
                            : offer.status === 'Scheduled' 
                              ? 'bg-amber-50 text-amber-700' 
                              : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${
                          offer.status === 'Active' 
                            ? 'bg-green-500' 
                            : offer.status === 'Scheduled' 
                              ? 'bg-amber-500' 
                              : 'bg-gray-400'
                        }`}></span>
                        {offer.status}
                      </button>
                    </td>
                    <td className="py-3.5">
                      <span className="font-mono text-gray-500 text-[11px]">{offer.expiry}</span>
                    </td>
                    <td className="py-3.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button 
                          onClick={() => {
                            setNewOfferName(offer.name);
                            setNewOfferSubtitle(offer.subtitle);
                            setNewOfferType(offer.type);
                            setNewOfferStatus(offer.status);
                            setNewOfferExpiry(offer.expiry);
                            setActiveModal('createOffer');
                          }}
                          className="p-1 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors" 
                          title="Edit Offer"
                        >
                          <Edit className="w-3.5 h-3.5" />
                        </button>
                        <button 
                          onClick={() => handleDeleteMockOffer(offer.id)}
                          className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors" 
                          title="Delete Offer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}

                {(filteredMockOffers.length === 0 && rewards.length === 0) && (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-gray-400">
                      No offers or promotions configured matching selected filters.
                    </td>
                  </tr>
                )}

              </tbody>
            </table>
          </div>

          {/* Bottom Table view link */}
          <div className="pt-4 border-t border-gray-100 text-center">
            <button
              onClick={() => setShowPastOffersPage(true)}
              className="text-[#004ac6] hover:text-[#003ea8] text-xs font-bold transition-colors cursor-pointer"
            >
              View All 24 Past Offers
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

      {/* MODAL 1: Create New Offer */}
      {activeModal === 'createOffer' && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl border border-[#e1e2ed] max-w-md w-full overflow-hidden">
            <div className="bg-[#f0f0fa] px-6 py-4 flex justify-between items-center border-b border-[#e1e2ed]">
              <h4 className="font-bold text-gray-900 text-sm flex items-center gap-1.5">
                <Sparkles className="w-4.5 h-4.5 text-[#004ac6]" />
                Configure New Promotion
              </h4>
              <button 
                onClick={() => setActiveModal(null)} 
                className="text-gray-400 hover:text-gray-700 font-bold"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateOfferSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1">Promotion Name</label>
                <input 
                  type="text" 
                  placeholder="e.g. 20% Off Weekend Pizzas"
                  value={newOfferName}
                  onChange={(e) => setNewOfferName(e.target.value)}
                  className="w-full bg-white border border-[#c3c6d7] px-3 py-2 rounded-xl text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[#004ac6] focus:border-[#004ac6]"
                  required
                />
              </div>

              <div>
                <label className="block text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1">Timing / Restrictions subtitle</label>
                <input 
                  type="text" 
                  placeholder="e.g. Sat-Sun | 12:00 - 18:00"
                  value={newOfferSubtitle}
                  onChange={(e) => setNewOfferSubtitle(e.target.value)}
                  className="w-full bg-white border border-[#c3c6d7] px-3 py-2 rounded-xl text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[#004ac6] focus:border-[#004ac6]"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1">Discount Type</label>
                  <select 
                    value={newOfferType}
                    onChange={(e) => setNewOfferType(e.target.value)}
                    className="w-full bg-white border border-[#c3c6d7] px-3 py-2 rounded-xl text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[#004ac6] focus:border-[#004ac6]"
                  >
                    <option value="Percentage">Percentage</option>
                    <option value="BOGO">BOGO (Buy 1 Get 1)</option>
                    <option value="Fixed Amount">Fixed Amount</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1">Status</label>
                  <select 
                    value={newOfferStatus}
                    onChange={(e) => setNewOfferStatus(e.target.value as any)}
                    className="w-full bg-white border border-[#c3c6d7] px-3 py-2 rounded-xl text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[#004ac6] focus:border-[#004ac6]"
                  >
                    <option value="Active">Active</option>
                    <option value="Scheduled">Scheduled</option>
                    <option value="Expired">Expired</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1">Expiry Date String</label>
                <input 
                  type="text" 
                  placeholder="e.g. Dec 31, 2024"
                  value={newOfferExpiry}
                  onChange={(e) => setNewOfferExpiry(e.target.value)}
                  className="w-full bg-white border border-[#c3c6d7] px-3 py-2 rounded-xl text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[#004ac6] focus:border-[#004ac6]"
                />
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
                  Register Promotion
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: Add New Reward */}
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
