/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Offer Builder — Manual offer creation form with AI-assisted suggestions.
 * AI helps with title, description, WhatsApp/SMS/email copy generation.
 * All other fields are manual with smart defaults.
 * Includes Offer Preview panel showing how customers see the offer
 * across WhatsApp, SMS, Email, and App Notification channels.
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  Tag,
  Percent,
  DollarSign,
  Gift,
  Calendar,
  Clock,
  Users,
  Target,
  ShoppingBag,
  Sparkles,
  HelpCircle,
  CheckCircle,
  RotateCcw,
  Plus,
  X,
  Eye,
  Smartphone,
  MessageSquare,
  Mail,
  Bell,
  Globe,
  ChevronDown,
} from 'lucide-react';
import type { Offer, OfferType, OfferStatus } from '../../src/types';

const OFFER_TYPES: { value: OfferType; label: string; icon: string }[] = [
  { value: 'percentage', label: 'Percentage Discount', icon: '%' },
  { value: 'flat', label: 'Flat Discount', icon: '₹' },
  { value: 'bogo', label: 'Buy X Get Y', icon: '2×1' },
  { value: 'free_item', label: 'Free Item', icon: '🎁' },
  { value: 'combo', label: 'Combo Deal', icon: '📦' },
  { value: 'cashback', label: 'Cashback', icon: '💵' },
  { value: 'reward_points', label: 'Reward Points', icon: '⭐' },
  { value: 'coupon', label: 'Coupon', icon: '🎟️' },
  { value: 'festival', label: 'Festival Offer', icon: '🎉' },
  { value: 'referral', label: 'Referral', icon: '👥' },
  { value: 'loyalty_bonus', label: 'Loyalty Bonus', icon: '💎' },
];

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

interface OfferBuilderProps {
  initialData?: Partial<Offer>;
  onSave: (offer: Partial<Offer>) => void;
  onCancel: () => void;
  currencySymbol: string;
  products?: Array<{ id: string; name: string; category: string; price: number }>;
}

type PreviewChannel = 'whatsapp' | 'sms' | 'email' | 'app_notification' | 'website';

const PREVIEW_CHANNELS: { id: PreviewChannel; label: string; icon: React.ElementType; color: string }[] = [
  { id: 'whatsapp', label: 'WhatsApp', icon: MessageSquare, color: 'text-green-600' },
  { id: 'sms', label: 'SMS', icon: Smartphone, color: 'text-blue-600' },
  { id: 'email', label: 'Email', icon: Mail, color: 'text-purple-600' },
  { id: 'app_notification', label: 'App Push', icon: Bell, color: 'text-orange-600' },
  { id: 'website', label: 'Website Banner', icon: Globe, color: 'text-indigo-600' },
];

// ─── Message Generators ──────────────────────────────────────

function generateWhatsAppMessage(
  title: string, desc: string, type: string, value: number,
  minOrder: number, categories: string[], endDate: string, symbol: string
): string {
  const discount = type === 'percentage' ? `${value}% OFF`
    : type === 'flat' ? `${symbol}${value} OFF`
    : type.toUpperCase();
  const cats = categories.length > 0 ? ` on ${categories.slice(0, 3).join(', ')}` : '';
  const min = minOrder > 0 ? `\n🛒 Min order: ${symbol}${minOrder}` : '';
  const expiry = endDate ? `\n⏰ Valid till: ${new Date(endDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}` : '';
  return `🎉 *${title}* 🎉\n\n${desc}${cats}\n\n🔥 ${discount}${cats}${min}${expiry}\n\n👉 Show this message at the counter to claim!`;
}

function generateSmsMessage(
  title: string, type: string, value: number,
  minOrder: number, symbol: string
): string {
  const discount = type === 'percentage' ? `${value}% OFF`
    : type === 'flat' ? `${symbol}${value} OFF`
    : type.toUpperCase();
  const min = minOrder > 0 ? ` | Min ${symbol}${minOrder}` : '';
  return `${title}! ${discount}${min}. Valid at our restaurant. Show this SMS to claim. T&C apply.`;
}

function generateAppNotification(
  title: string, type: string, value: number, symbol: string
): string {
  const discount = type === 'percentage' ? `${value}%`
    : type === 'flat' ? `${symbol}${value}`
    : type.toUpperCase();
  return `🎉 ${title} · ${discount} OFF · Tap to see details!`;
}

function generateEmailSubject(title: string): string {
  return `🎉 ${title} — Exclusive Offer Just for You!`;
}

function generateEmailBody(
  title: string, desc: string, type: string, value: number,
  minOrder: number, categories: string[], endDate: string, symbol: string
): string {
  const discount = type === 'percentage' ? `${value}%`
    : type === 'flat' ? `${symbol}${value}`
    : type.toUpperCase();
  const cats = categories.length > 0 ? ` on ${categories.join(', ')}` : '';
  const min = minOrder > 0 ? `Minimum order: ${symbol}${minOrder}` : 'No minimum order required';
  const expiry = endDate
    ? `Offer valid until ${new Date(endDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}`
    : 'Limited time offer';
  return `Dear Valued Customer,

We're excited to offer you an exclusive deal!

🔥 ${discount} OFF${cats}
${title}
${desc}

📋 ${min}
📅 ${expiry}

Visit us today and quote this offer to avail the discount!

Thank you,
Your Restaurant Team`;
}

function generateWebsiteBanner(
  title: string, type: string, value: number, symbol: string
): string {
  const discount = type === 'percentage' ? `${value}% OFF`
    : type === 'flat' ? `${symbol}${value} OFF`
    : type.toUpperCase();
  return `${discount} · ${title}`;
}

export default function OfferBuilder({
  initialData,
  onSave,
  onCancel,
  currencySymbol,
  products = [],
}: OfferBuilderProps) {
  const [title, setTitle] = useState(initialData?.title || '');
  const [description, setDescription] = useState(initialData?.description || '');
  const [type, setType] = useState<OfferType>(initialData?.type || 'percentage');
  const [value, setValue] = useState(initialData?.value || 0);
  const [minOrderValue, setMinOrderValue] = useState(initialData?.minOrderValue || 0);
  const [maxUses, setMaxUses] = useState(initialData?.maxUses || 0);
  const [maxPerCustomer, setMaxPerCustomer] = useState(initialData?.maxPerCustomer || 1);
  const [status, setStatus] = useState<OfferStatus>(initialData?.status || 'draft');
  const [startDate, setStartDate] = useState(initialData?.startDate || '');
  const [endDate, setEndDate] = useState(initialData?.endDate || '');
  const [selectedCategories, setSelectedCategories] = useState<string[]>(initialData?.applicableCategories || []);
  const [estimatedReach, setEstimatedReach] = useState(initialData?.estimatedReach || 0);
  const [expectedImpact, setExpectedImpact] = useState(initialData?.expectedImpact || '');
  // ─── Segment State ──────────────────────────────────────────
  const [availableSegments, setAvailableSegments] = useState<Array<{ _id: string; name: string; customerCount: number }>>([]);
  const [selectedSegmentIds, setSelectedSegmentIds] = useState<string[]>(initialData?.targetSegmentIds || []);
  const [selectedSegmentNames, setSelectedSegmentNames] = useState<string[]>(initialData?.targetSegmentNames || []);
  const [segmentsLoading, setSegmentsLoading] = useState(false);
  const [showSegmentPicker, setShowSegmentPicker] = useState(false);

  // Fetch segments on mount
  useEffect(() => {
    const fetchSegments = async () => {
      setSegmentsLoading(true);
      try {
        const res = await fetch('/api/offers/segments');
        if (res.ok) {
          const data = await res.json();
          setAvailableSegments(data.segments || []);
        }
      } catch { /* silent fail */ }
      setSegmentsLoading(false);
    };
    fetchSegments();
  }, []);

  // AI Copy Generation State
  const [aiLoading, setAiLoading] = useState<'title' | 'description' | null>(null);
  const [aiTitle, setAiTitle] = useState('');
  const [showAiTitle, setShowAiTitle] = useState(false);

  // Preview State
  const [showPreview, setShowPreview] = useState(false);
  const [previewChannel, setPreviewChannel] = useState<PreviewChannel>('whatsapp');

  // Categories from products
  const availableCategories = [...new Set(products.map(p => p.category))];

  // ─── Live Preview Generation ────────────────────────────────
  const previews = useMemo(() => {
    const t = title || 'Your Offer Title';
    const d = description || 'Your offer description goes here.';
    const sym = currencySymbol || '₹';
    return {
      whatsapp: generateWhatsAppMessage(t, d, type, value, minOrderValue, selectedCategories, endDate, sym),
      sms: generateSmsMessage(t, type, value, minOrderValue, sym),
      app_notification: generateAppNotification(t, type, value, sym),
      emailSubject: generateEmailSubject(t),
      emailBody: generateEmailBody(t, d, type, value, minOrderValue, selectedCategories, endDate, sym),
      website: generateWebsiteBanner(t, type, value, sym),
    };
  }, [title, description, type, value, minOrderValue, selectedCategories, endDate, currencySymbol]);

  const handleGenerateTitle = () => {
    setAiLoading('title');
    const suggestions: Record<string, string[]> = {
      percentage: [`${value}% Off Everything`, `Save ${value}% Today`, `Flash Sale ${value}% Off`],
      flat: [`Flat Rs.${value} Off`, `Rs.${value} Savings`, `Save Rs.${value} Now`],
      bogo: ['Buy One Get One Free', 'BOGO Special', 'Double the Fun'],
      combo: ['Value Combo Deal', 'Perfect Pair Combo', 'Meal Deal Special'],
      festival: ['Festival Special', 'Celebration Offer', 'Festive Feast'],
      cashback: [`Rs.${value} Cashback`, `Get Rs.${value} Back`, 'Cashback Offer'],
      reward_points: ['Double Points Day', 'Bonus Rewards', `Earn ${value}x Points`],
      free_item: ['Free Item with Order', 'Complimentary Treat', 'Free Surprise'],
      coupon: ['Coupon Discount', 'Special Voucher', 'Secret Offer'],
      referral: ['Refer & Earn', 'Share & Save', 'Invite Friends'],
      loyalty_bonus: ['Loyalty Reward', 'Member Bonus', 'Exclusive Perk'],
    };
    const typeSuggestions = suggestions[type] || ['Special Offer', 'Limited Time Deal', 'Exclusive Promotion'];
    const randomTitle = typeSuggestions[Math.floor(Math.random() * typeSuggestions.length)];
    setAiTitle(randomTitle);
    setShowAiTitle(true);
    setAiLoading(null);
  };

  const handleApplyAiTitle = () => {
    if (aiTitle) setTitle(aiTitle);
    setShowAiTitle(false);
    setAiTitle('');
  };

  const handleCategoryToggle = (cat: string) => {
    setSelectedCategories(prev =>
      prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !description.trim() || value <= 0) return;

    onSave({
      title: title.trim(),
      description: description.trim(),
      type,
      value,
      minOrderValue: minOrderValue || undefined,
      maxUses: maxUses || undefined,
      maxPerCustomer: maxPerCustomer || undefined,
      status,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      applicableCategories: selectedCategories,
      targetSegmentIds: selectedSegmentIds,
      targetSegmentNames: selectedSegmentNames,
      estimatedReach: estimatedReach || undefined,
      expectedImpact: expectedImpact || undefined,
      whatsappMessage: previews.whatsapp,
      smsMessage: previews.sms,
      appNotification: previews.app_notification,
      emailSubject: previews.emailSubject,
      emailBody: previews.emailBody,
    });
  };

  const isEditing = !!initialData?._id;

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 pb-4 border-b border-gray-100">
        <h3 className="font-bold text-gray-900">
          {isEditing ? 'Edit Offer' : 'Create New Offer'}
        </h3>
        <button
          onClick={onCancel}
          className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-all cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Offer Type Selection */}
        <div>
          <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">
            Offer Type
          </label>
          <div className="grid grid-cols-4 md:grid-cols-6 gap-2">
            {OFFER_TYPES.map(ot => (
              <button
                key={ot.value}
                type="button"
                onClick={() => setType(ot.value)}
                className={`p-3 rounded-xl border-2 text-center transition-all cursor-pointer ${
                  type === ot.value
                    ? 'border-purple-500 bg-purple-50 text-purple-700'
                    : 'border-gray-100 bg-gray-50 text-gray-600 hover:border-gray-200'
                }`}
              >
                <span className="block text-lg mb-1">{ot.icon}</span>
                <span className="text-[9px] font-bold leading-tight block">{ot.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Title + AI */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider">
              Offer Title
            </label>
            <button
              type="button"
              onClick={handleGenerateTitle}
              disabled={aiLoading === 'title'}
              className="flex items-center gap-1 text-[10px] text-purple-600 hover:text-purple-800 font-bold transition-all disabled:opacity-50"
            >
              <Sparkles className={`w-3 h-3 ${aiLoading === 'title' ? 'animate-pulse' : ''}`} />
              {aiLoading === 'title' ? 'Generating...' : 'AI Suggest Title'}
            </button>
          </div>
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="e.g. Weekend Family Feast"
            className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-400 focus:border-transparent"
            required
          />
          {showAiTitle && aiTitle && (
            <div className="mt-2 p-3 bg-purple-50 border border-purple-200 rounded-xl flex items-center justify-between">
              <span className="text-sm font-bold text-purple-800">{aiTitle}</span>
              <button
                type="button"
                onClick={handleApplyAiTitle}
                className="flex items-center gap-1 text-[10px] bg-purple-600 text-white px-3 py-1.5 rounded-lg font-bold hover:bg-purple-700 transition-all"
              >
                <CheckCircle className="w-3 h-3" /> Apply
              </button>
            </div>
          )}
        </div>

        {/* Description */}
        <div>
          <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">
            Description
          </label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Describe what the offer is about and how customers can avail it..."
            rows={3}
            className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-400 focus:border-transparent resize-none"
            required
          />
        </div>

        {/* Value + Min Order Row */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">
              {type === 'percentage' ? 'Discount %' : type === 'flat' ? `Amount (${currencySymbol})` : 'Value'}
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-bold">
                {type === 'percentage' ? '%' : currencySymbol}
              </span>
              <input
                type="number"
                value={value}
                onChange={e => setValue(Number(e.target.value))}
                min={0}
                className="w-full pl-8 pr-4 py-2.5 rounded-xl border border-gray-200 text-sm font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-400"
                required
              />
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">
              Min Order ({currencySymbol})
            </label>
            <input
              type="number"
              value={minOrderValue}
              onChange={e => setMinOrderValue(Number(e.target.value))}
              min={0}
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-400"
              placeholder="0 = No minimum"
            />
          </div>
        </div>

        {/* Categories */}
        <div>
          <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">
            Applicable Categories
          </label>
          <div className="flex flex-wrap gap-2">
            {availableCategories.length > 0 ? (
              availableCategories.map(cat => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => handleCategoryToggle(cat)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                    selectedCategories.includes(cat)
                      ? 'bg-purple-100 text-purple-800 border-purple-300'
                      : 'bg-gray-50 text-gray-600 border-gray-200 hover:border-gray-300'
                  }`}
                >
                  {cat}
                </button>
              ))
            ) : (
              <span className="text-xs text-gray-400">No categories defined in menu</span>
            )}
            {selectedCategories.length === 0 && availableCategories.length > 0 && (
              <span className="text-[10px] text-gray-400 self-center ml-1">(applies to all)</span>
            )}
          </div>
        </div>

        {/* Target Segment Picker */}
        <div>
          <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">
            Target Customer Segment
          </label>
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowSegmentPicker(!showSegmentPicker)}
              className="w-full flex items-center justify-between px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-bold text-gray-700 bg-white hover:border-purple-300 transition-all cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-gray-400" />
                {selectedSegmentNames.length > 0 ? (
                  <span className="text-gray-900">{selectedSegmentNames.length} segment{selectedSegmentNames.length > 1 ? 's' : ''} selected</span>
                ) : (
                  <span className="text-gray-400 font-medium">All customers (no segment filter)</span>
                )}
              </div>
              <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${showSegmentPicker ? 'rotate-180' : ''}`} />
            </button>

            {showSegmentPicker && (
              <div className="absolute left-0 right-0 mt-1.5 bg-white border border-gray-200 rounded-xl shadow-lg z-50 max-h-56 overflow-y-auto">
                {segmentsLoading ? (
                  <div className="p-4 text-center text-xs text-gray-400">Loading segments...</div>
                ) : availableSegments.length === 0 ? (
                  <div className="p-4 text-center text-xs text-gray-400">No segments available</div>
                ) : (
                  availableSegments.map(seg => {
                    const isSelected = selectedSegmentIds.includes(seg._id);
                    return (
                      <button
                        key={seg._id}
                        type="button"
                        onClick={() => {
                          if (isSelected) {
                            setSelectedSegmentIds(prev => prev.filter(id => id !== seg._id));
                            setSelectedSegmentNames(prev => prev.filter(n => n !== seg.name));
                          } else {
                            setSelectedSegmentIds(prev => [...prev, seg._id]);
                            setSelectedSegmentNames(prev => [...prev, seg.name]);
                          }
                        }}
                        className={`w-full flex items-center justify-between px-4 py-2.5 text-xs transition-all hover:bg-purple-50 cursor-pointer ${
                          isSelected ? 'bg-purple-50 text-purple-800 font-bold' : 'text-gray-700 font-medium'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          {isSelected && <CheckCircle className="w-3.5 h-3.5 text-purple-600" />}
                          <span>{seg.name}</span>
                        </div>
                        <span className="text-[9px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">
                          {seg.customerCount} customers
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>

          {/* Selected segment badges */}
          {selectedSegmentNames.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {selectedSegmentNames.map((name, i) => (
                <span
                  key={selectedSegmentIds[i] || i}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-purple-100 text-purple-800 text-[9px] font-bold"
                >
                  <Users className="w-3 h-3" />
                  {name}
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedSegmentIds(prev => prev.filter((_, idx) => idx !== i));
                      setSelectedSegmentNames(prev => prev.filter((_, idx) => idx !== i));
                    }}
                    className="ml-0.5 hover:text-purple-600 transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
              <button
                type="button"
                onClick={() => { setSelectedSegmentIds([]); setSelectedSegmentNames([]); }}
                className="text-[9px] text-gray-400 hover:text-gray-600 font-medium underline px-1"
              >
                Clear all
              </button>
            </div>
          )}
        </div>

        {/* Date Range */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">
              Start Date
            </label>
            <input
              type="date"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-400"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">
              End Date
            </label>
            <input
              type="date"
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-400"
            />
          </div>
        </div>

        {/* Usage Limits Row */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">
              Max Total Uses
            </label>
            <input
              type="number"
              value={maxUses}
              onChange={e => setMaxUses(Number(e.target.value))}
              min={0}
              placeholder="0 = Unlimited"
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-400"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">
              Per Customer
            </label>
            <input
              type="number"
              value={maxPerCustomer}
              onChange={e => setMaxPerCustomer(Number(e.target.value))}
              min={1}
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-400"
            />
          </div>
        </div>

        {/* Publish Settings */}
        <div>
          <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">
            Status
          </label>
          <div className="flex gap-2">
            {(['draft', 'active', 'scheduled'] as OfferStatus[]).map(s => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                className={`px-4 py-2 rounded-xl text-xs font-bold border-2 transition-all cursor-pointer capitalize ${
                  status === s
                    ? 'border-purple-500 bg-purple-50 text-purple-700'
                    : 'border-gray-100 text-gray-500 hover:border-gray-200'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* ─── Offer Preview Toggle ───────────────────────────────── */}
        <div className="border-t border-gray-100 pt-4">
          <button
            type="button"
            onClick={() => setShowPreview(!showPreview)}
            className={`flex items-center gap-2 text-xs font-bold transition-all cursor-pointer ${
              showPreview ? 'text-purple-700' : 'text-gray-500 hover:text-purple-600'
            }`}
          >
            <Eye className="w-4 h-4" />
            {showPreview ? 'Hide Offer Preview' : 'Show Offer Preview'}
            <span className="text-[9px] text-gray-400 font-medium">(See how customers receive this)</span>
          </button>

          {showPreview && (
            <div className="mt-4 bg-gray-50 rounded-2xl border border-gray-200 overflow-hidden">
              {/* Channel Tabs */}
              <div className="flex border-b border-gray-200 bg-white">
                {PREVIEW_CHANNELS.map(ch => {
                  const Icon = ch.icon;
                  return (
                    <button
                      key={ch.id}
                      type="button"
                      onClick={() => setPreviewChannel(ch.id)}
                      className={`flex items-center gap-1.5 px-4 py-3 text-[10px] font-bold transition-all cursor-pointer border-b-2 ${
                        previewChannel === ch.id
                          ? 'border-purple-500 text-purple-700 bg-purple-50/30'
                          : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      <Icon className={`w-3.5 h-3.5 ${ch.color}`} />
                      {ch.label}
                    </button>
                  );
                })}
              </div>

              {/* Preview Content */}
              <div className="p-4">
                {/* WhatsApp Preview */}
                {previewChannel === 'whatsapp' && (
                  <div className="max-w-sm mx-auto bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                    {/* WhatsApp Header */}
                    <div className="bg-green-600 text-white px-4 py-3 flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center font-bold text-xs">R</div>
                      <div>
                        <span className="font-bold text-sm block leading-tight">Restaurant Offers</span>
                        <span className="text-[10px] text-green-200">Online</span>
                      </div>
                    </div>
                    {/* Message Bubble */}
                    <div className="p-4">
                      <div className="bg-green-50 rounded-2xl rounded-tl-sm p-4 border border-green-100">
                        <pre className="text-xs text-gray-800 font-sans whitespace-pre-wrap leading-relaxed">{previews.whatsapp}</pre>
                        <div className="mt-2 text-[8px] text-gray-400 text-right">WhatsApp • Just now</div>
                      </div>
                    </div>
                  </div>
                )}

                {/* SMS Preview */}
                {previewChannel === 'sms' && (
                  <div className="max-w-sm mx-auto bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                    {/* Phone Top Bar */}
                    <div className="bg-gray-900 text-white px-4 py-2 flex items-center justify-between text-[10px]">
                      <span>12:45</span>
                      <div className="flex items-center gap-1">
                        <span className="w-3 h-2 bg-gray-400 rounded-sm relative">
                          <span className="absolute inset-0.5 bg-gray-900 rounded-sm" />
                        </span>
                        <span>📶</span>
                      </div>
                    </div>
                    {/* SMS Conversation */}
                    <div className="p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center text-white text-[9px] font-bold">R</div>
                        <div>
                          <span className="text-xs font-bold text-gray-900 block">Restaurant</span>
                          <span className="text-[8px] text-gray-400">SMS • Just now</span>
                        </div>
                      </div>
                      <div className="bg-blue-50 rounded-2xl rounded-tl-sm p-3 border border-blue-100">
                        <p className="text-xs text-gray-800 leading-relaxed">{previews.sms}</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* App Notification Preview */}
                {previewChannel === 'app_notification' && (
                  <div className="max-w-sm mx-auto bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                    {/* Phone Top */}
                    <div className="bg-gray-900 text-white px-4 py-2 flex items-center justify-between text-[10px]">
                      <span>12:45</span>
                      <div className="flex items-center gap-1">
                        <span className="w-3.5 h-2.5 bg-gray-400 rounded-sm" />
                        <span>📶</span>
                      </div>
                    </div>
                    {/* Notification Dropdown */}
                    <div className="p-4">
                      <div className="bg-gray-900 rounded-2xl p-4 shadow-lg">
                        <div className="flex items-start gap-3">
                          <div className="w-8 h-8 rounded-full bg-orange-500 flex items-center justify-center shrink-0">
                            <Bell className="w-4 h-4 text-white" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-0.5">
                              <span className="text-xs font-bold text-white">Restaurant App</span>
                              <span className="text-[8px] text-gray-400">now</span>
                            </div>
                            <p className="text-[11px] text-gray-300 leading-tight">{previews.app_notification}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Email Preview */}
                {previewChannel === 'email' && (
                  <div className="max-w-xl mx-auto bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                    {/* Email Header */}
                    <div className="bg-gray-100 px-4 py-2 flex items-center gap-3 border-b border-gray-200">
                      <div className="flex items-center gap-1 text-[9px] text-gray-500">
                        <Mail className="w-3 h-3" />
                        <span>Inbox</span>
                      </div>
                      <div className="text-[9px] text-gray-500">|</div>
                      <div className="text-[9px] text-gray-500 truncate flex-1">
                        To: customer@email.com
                      </div>
                    </div>
                    {/* Email Content */}
                    <div className="p-5">
                      <div className="border-b border-gray-200 pb-3 mb-4">
                        <h4 className="text-sm font-bold text-gray-900">{previews.emailSubject}</h4>
                      </div>
                      <pre className="text-xs text-gray-700 font-sans whitespace-pre-wrap leading-relaxed">{previews.emailBody}</pre>
                    </div>
                  </div>
                )}

                {/* Website Banner Preview */}
                {previewChannel === 'website' && (
                  <div className="max-w-2xl mx-auto">
                    {/* Website Banner Mock */}
                    <div className="bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-500 rounded-2xl p-6 shadow-lg text-center">
                      <p className="text-white text-lg font-black tracking-tight">{previews.website}</p>
                      <p className="text-white/70 text-xs mt-1">Tap to view details</p>
                    </div>
                    {/* Website Page Mock */}
                    <div className="mt-3 bg-white rounded-xl border border-gray-200 p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-2.5 h-2.5 rounded-full bg-red-400" />
                        <div className="w-2.5 h-2.5 rounded-full bg-yellow-400" />
                        <div className="w-2.5 h-2.5 rounded-full bg-green-400" />
                        <div className="w-32 h-3 bg-gray-100 rounded ml-2" />
                      </div>
                      <div className="bg-gray-50 rounded-xl h-20 flex items-center justify-center border border-dashed border-gray-200">
                        <p className="text-[10px] text-gray-400">Website content will be displayed here with the offer banner</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Preview Info */}
              <div className="bg-amber-50 border-t border-amber-200 px-4 py-2.5 flex items-center gap-2">
                <Eye className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                <p className="text-[9px] text-amber-800">Preview updates live as you edit the form fields above. These messages are generated automatically based on your offer details.</p>
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 pt-4 border-t border-gray-100">
          <button
            type="submit"
            className="flex-1 flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-700 text-white py-3 rounded-xl text-sm font-bold transition-all active:scale-[0.98] cursor-pointer"
          >
            <CheckCircle className="w-4 h-4" />
            {isEditing ? 'Update Offer' : status === 'active' ? 'Publish Offer' : 'Save as Draft'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="px-6 py-3 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-xl text-sm font-bold transition-all cursor-pointer"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
