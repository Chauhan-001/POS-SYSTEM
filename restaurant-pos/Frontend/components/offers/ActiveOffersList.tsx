/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Active Offers — Lists all offers with status tabs, search, and actions.
 * Supports: Active, Scheduled, Expired, Drafts tabs.
 * Actions: Pause, Resume, Edit, Delete, Duplicate.
 */

import React, { useState, useEffect } from 'react';
import {
  Tag,
  Search,
  Edit,
  Trash2,
  Copy,
  Play,
  Pause,
  X,
  CheckCircle,
  Clock,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import type { Offer, OfferStatus } from '../../src/types';

const API_BASE = '/api/offers';

interface ActiveOffersListProps {
  offers: Offer[];
  loading: boolean;
  onEdit: (offer: Offer) => void;
  onRefresh: () => void;
  onStatusChange: (id: string, status: OfferStatus) => void;
  onDelete: (id: string) => void;
  onDuplicate: (offer: Offer) => void;
  currencySymbol: string;
}

const STATUS_TABS: { key: string; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'draft', label: 'Drafts' },
  { key: 'expired', label: 'Expired' },
  { key: 'paused', label: 'Paused' },
];

const STATUS_BADGES: Record<string, string> = {
  active: 'bg-green-100 text-green-800 border-green-200',
  scheduled: 'bg-blue-100 text-blue-800 border-blue-200',
  draft: 'bg-gray-100 text-gray-600 border-gray-200',
  expired: 'bg-red-100 text-red-700 border-red-200',
  paused: 'bg-amber-100 text-amber-800 border-amber-200',
  cancelled: 'bg-gray-100 text-gray-500 border-gray-200',
};

const STATUS_DOTS: Record<string, string> = {
  active: 'bg-green-500',
  scheduled: 'bg-blue-500',
  draft: 'bg-gray-400',
  expired: 'bg-red-500',
  paused: 'bg-amber-500',
  cancelled: 'bg-gray-400',
};

const OFFER_TYPE_LABELS: Record<string, string> = {
  percentage: '% Off',
  flat: '₹ Off',
  bogo: 'BOGO',
  free_item: 'Free Item',
  combo: 'Combo',
  cashback: 'Cashback',
  reward_points: 'Reward Points',
  coupon: 'Coupon',
  festival: 'Festival',
  referral: 'Referral',
  loyalty_bonus: 'Loyalty Bonus',
};

export default function ActiveOffersList({
  offers,
  loading,
  onEdit,
  onRefresh,
  onStatusChange,
  onDelete,
  onDuplicate,
  currencySymbol,
}: ActiveOffersListProps) {
  const [activeTab, setActiveTab] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  const filtered = offers.filter(o => {
    if (activeTab !== 'all' && o.status !== activeTab) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return o.title.toLowerCase().includes(q) || o.description.toLowerCase().includes(q);
    }
    return true;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="w-6 h-6 border-2 border-blue-300 border-t-blue-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-gray-900 text-sm">
          {activeTab === 'all' ? 'All Offers' : `${activeTab.charAt(0).toUpperCase() + activeTab.slice(1)} Offers`}
          <span className="ml-2 text-[10px] font-medium text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
            {filtered.length}
          </span>
        </h3>
        <button
          onClick={onRefresh}
          className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 font-bold transition-all"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {/* Search + Tabs */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search offers..."
            className="w-full pl-9 pr-4 py-2 rounded-xl border border-gray-200 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
        </div>
        <div className="bg-gray-100 rounded-xl p-1 flex gap-1">
          {STATUS_TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeTab === tab.key
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Offers List */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-gray-400">
          <Tag className="w-10 h-10 mb-2 text-gray-300" />
          <p className="text-sm font-medium">No {activeTab !== 'all' ? activeTab : ''} offers found</p>
          <p className="text-xs mt-1">Create a new offer or change the filter</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(offer => (
            <div
              key={offer._id}
              className="bg-white rounded-2xl border border-gray-200 p-4 flex items-center gap-4 hover:shadow-sm transition-all group"
            >
              {/* Type Icon */}
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold shrink-0 ${
                offer.status === 'active' ? 'bg-green-100 text-green-700'
                  : offer.status === 'scheduled' ? 'bg-blue-100 text-blue-700'
                  : offer.status === 'paused' ? 'bg-amber-100 text-amber-700'
                  : 'bg-gray-100 text-gray-500'
              }`}>
                {OFFER_TYPE_LABELS[offer.type] || '%'}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="font-extrabold text-gray-900 text-sm truncate">{offer.title}</span>
                  {offer.isAiGenerated && (
                    <span className="text-[8px] font-bold text-purple-600 bg-purple-100 px-1.5 py-0.5 rounded uppercase">AI</span>
                  )}
                  {offer.recommendationReason && (
                    <span className="text-[8px] text-gray-400 truncate max-w-[200px]" title={offer.recommendationReason}>
                      {offer.recommendationReason}
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500 truncate">{offer.description}</p>
                <div className="flex items-center gap-3 mt-1.5">
                  <span className={`inline-flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded-full border ${STATUS_BADGES[offer.status] || 'bg-gray-100 text-gray-600'}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOTS[offer.status] || 'bg-gray-400'}`} />
                    {offer.status}
                  </span>
                  <span className="text-[9px] text-gray-400">
                    {offer.type === 'percentage' ? `${offer.value}% Off` : offer.type === 'flat' ? `${currencySymbol}${offer.value} Off` : offer.type}
                  </span>
                  {offer.minOrderValue ? (
                    <span className="text-[9px] text-gray-400">Min: {currencySymbol}{offer.minOrderValue}</span>
                  ) : null}
                  {offer.estimatedReach ? (
                    <span className="text-[9px] text-blue-500">{offer.estimatedReach} reach</span>
                  ) : null}
                  {offer.currentUses > 0 && (
                    <span className="text-[9px] text-amber-600">{offer.currentUses} used</span>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-all">
                {(offer.status === 'active' || offer.status === 'paused') && (
                  <button
                    onClick={() => onStatusChange(offer._id, offer.status === 'active' ? 'paused' : 'active')}
                    className="p-2 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-all cursor-pointer"
                    title={offer.status === 'active' ? 'Pause' : 'Resume'}
                  >
                    {offer.status === 'active' ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  </button>
                )}
                {offer.status === 'draft' && (
                  <button
                    onClick={() => onStatusChange(offer._id, 'active')}
                    className="p-2 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-all cursor-pointer"
                    title="Publish"
                  >
                    <CheckCircle className="w-4 h-4" />
                  </button>
                )}
                <button
                  onClick={() => onEdit(offer)}
                  className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all cursor-pointer"
                  title="Edit"
                >
                  <Edit className="w-4 h-4" />
                </button>
                <button
                  onClick={() => onDuplicate(offer)}
                  className="p-2 text-gray-400 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-all cursor-pointer"
                  title="Duplicate"
                >
                  <Copy className="w-4 h-4" />
                </button>
                <button
                  onClick={() => onDelete(offer._id)}
                  className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all cursor-pointer"
                  title="Delete"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
