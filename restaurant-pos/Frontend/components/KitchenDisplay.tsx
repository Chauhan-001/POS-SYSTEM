import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Clock, ChefHat, UtensilsCrossed, Bell, AlertCircle, CheckCircle, ArrowRight, Table2, User, RefreshCw, Maximize2, Minimize2, Volume2, VolumeX, XCircle, Ban } from 'lucide-react';
import type { Order, KOTRecord, KOTStatus } from '../src/types';
import { getKOTElapsedMinutes, kotPrintedTimeMs } from '../src/utils/kotTime';
import { setKotAlertEnabled } from '../src/lib/alertSound';

const CANCEL_REASONS = [
  { id: 'out_of_stock', label: 'Out of Stock' },
  { id: 'prep_error', label: 'Preparation Error' },
  { id: 'quality_issue', label: 'Quality Issue' },
  { id: 'customer_cancelled', label: 'Customer Cancelled' },
  { id: 'wrong_item', label: 'Wrong Item' },
  { id: 'duplicate', label: 'Duplicate Entry' },
  { id: 'other', label: 'Other' },
];

interface KotCardData {
  orderId: string;
  orderNumber: number;
  kot: KOTRecord;
  tableNumber?: number;
  waiterName?: string;
  customerName?: string;
}

interface KitchenDisplayProps {
  orders: Order[];
  onUpdateKOTStatus: (orderId: string, kotId: string, newStatus: KOTStatus) => void;
  onCancelOrderItem?: (orderId: string, itemId: string, reason: string) => void;
  showToast?: (message: string, type?: 'success' | 'info' | 'warning') => void;
  settings?: any;
}

const AGING_THRESHOLDS = {
  normal: 0,
  warning: 5,
  urgent: 15,
  critical: 25,
};

const COLUMN_CONFIG = [
  { id: 'Accepted' as KOTStatus, label: 'New Orders', icon: Bell, color: 'bg-blue-500', borderColor: 'border-blue-400', bgColor: 'bg-blue-50', textColor: 'text-blue-700' },
  { id: 'Preparing' as KOTStatus, label: 'Preparing', icon: ChefHat, color: 'bg-amber-500', borderColor: 'border-amber-400', bgColor: 'bg-amber-50', textColor: 'text-amber-700' },
  { id: 'Ready' as KOTStatus, label: 'Ready to Serve', icon: CheckCircle, color: 'bg-green-500', borderColor: 'border-green-400', bgColor: 'bg-green-50', textColor: 'text-green-700' },
];

function formatElapsed(minutes: number): string {
  // Guard against NaN/invalid input (missing printedAt on legacy records) so
  // the badge can never render "NaNh NaNm ago".
  if (!Number.isFinite(minutes) || minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m ago`;
}

function getUrgencyStyle(minutes: number): { bg: string; text: string; border: string; dot: string } {
  if (minutes >= AGING_THRESHOLDS.critical) return { bg: 'bg-red-100', text: 'text-red-700', border: 'border-red-300', dot: 'bg-red-500' };
  if (minutes >= AGING_THRESHOLDS.urgent) return { bg: 'bg-red-50', text: 'text-red-600', border: 'border-red-200', dot: 'bg-red-400' };
  if (minutes >= AGING_THRESHOLDS.warning) return { bg: 'bg-amber-50', text: 'text-amber-600', border: 'border-amber-200', dot: 'bg-amber-400' };
  return { bg: 'bg-gray-50', text: 'text-gray-500', border: 'border-gray-200', dot: 'bg-gray-300' };
}

function getKOTStatusTransitions(currentStatus: KOTStatus): KOTStatus[] {
  const flow: Record<KOTStatus, KOTStatus[]> = {
    'Accepted': ['Preparing'],
    'Preparing': ['Ready'],
    'Ready': ['Served'],
    'Served': [],
  };
  return flow[currentStatus] || [];
}

export default function KitchenDisplay({ orders, onUpdateKOTStatus, onCancelOrderItem, showToast, settings }: KitchenDisplayProps) {
  const [fullscreen, setFullscreen] = useState(false);
  // Initial alert-sound state follows the Settings "Quick Sound Alerts" module
  // toggle (default ON when unset, so existing behavior is unchanged).
  const [soundEnabled, setSoundEnabled] = useState(
    () => settings?.moduleSettings?.enableQuickSoundAlerts !== false
  );
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [cancelTarget, setCancelTarget] = useState<{ orderId: string; itemKey: string; itemName: string } | null>(null);

  // The beep itself lives in the shared alertSound module (played app-wide by
  // useKotAlertSound). This button only flips the shared runtime flag so the
  // mute here silences alerts everywhere, not just on the kitchen screen.
  const toggleSound = useCallback(() => {
    setSoundEnabled((v) => {
      setKotAlertEnabled(!v);
      return !v;
    });
  }, []);

  // Flatten all KOT records from kitchen-relevant orders into cards
  const kotCards = useMemo(() => {
    const cards: KotCardData[] = [];
    for (const o of orders) {
      const hasKot = o.kotRecords && o.kotRecords.length > 0;
      if (!hasKot) continue;
      for (const kot of o.kotRecords) {
        if (kot.status === 'Served') continue;
        // Skip KOT records with missing or empty items
        if (!kot.items || kot.items.length === 0) continue;
        // Skip KOT records where any item lacks a product reference
        const hasInvalidItem = kot.items.some(item => !item || !item.product);
        if (hasInvalidItem) continue;
        cards.push({
          orderId: o.id,
          orderNumber: o.orderNumber,
          kot,
          tableNumber: o.tableNumber,
          waiterName: o.waiterName,
          customerName: o.customerName,
        });
      }
    }
    return cards;
  }, [orders]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(interval);
  }, [autoRefresh]);


  // Group KOT cards by KOT status
  const columns = useMemo(() => {
    const grouped: Record<string, KotCardData[]> = {
      'Accepted': [],
      'Preparing': [],
      'Ready': [],
    };
    kotCards.forEach(card => {
      const status = card.kot.status;
      if (grouped[status]) {
        grouped[status].push(card);
      }
    });
    Object.keys(grouped).forEach(key => {
      // Sort oldest-first by printed time; unknown timestamps sort last
      // (kotPrintedTimeMs → null → MAX_SAFE_INTEGER) instead of producing
      // NaN orderings or floating unknown cards to the top.
      grouped[key].sort((a, b) =>
        (kotPrintedTimeMs(a.kot.printedAt) ?? Number.MAX_SAFE_INTEGER) -
        (kotPrintedTimeMs(b.kot.printedAt) ?? Number.MAX_SAFE_INTEGER)
      );
    });
    return grouped;
  }, [kotCards]);

  const totalActiveKots = kotCards.length;
  const urgentKots = useMemo(() => {
    return kotCards.filter(c => getKOTElapsedMinutes(c.kot.printedAt) >= AGING_THRESHOLDS.urgent).length;
  }, [kotCards, now]);

  const handleAdvanceKOTStatus = useCallback((card: KotCardData, targetStatus: KOTStatus) => {
    onUpdateKOTStatus(card.orderId, card.kot.id, targetStatus);
    if (showToast) {
      const label = targetStatus === 'Preparing' ? 'Preparing' : targetStatus === 'Ready' ? 'Ready to Serve' : targetStatus;
      showToast(`Order #${card.orderNumber} KOT #${card.kot.kotNumber} → ${label}`, 'success');
    }
  }, [onUpdateKOTStatus, showToast]);

  const handleCancelClick = useCallback((orderId: string, itemKey: string, itemName: string) => {
    setCancelTarget({ orderId, itemKey, itemName });
  }, []);

  const handleCancelConfirm = useCallback((reason: string) => {
    if (!cancelTarget) return;
    onCancelOrderItem?.(cancelTarget.orderId, cancelTarget.itemKey, reason);
    if (showToast) showToast(`Item cancelled: ${cancelTarget.itemName}`, 'warning');
    setCancelTarget(null);
  }, [cancelTarget, onCancelOrderItem, showToast]);

  const handleRefresh = useCallback(() => {
    setNow(Date.now());
    if (showToast) showToast('Kitchen display refreshed', 'info');
  }, [showToast]);

  // --- Empty state ---
  if (totalActiveKots === 0) {
    return (
      <div className={`flex flex-col h-full min-h-0 bg-[#faf8ff] ${fullscreen ? 'fixed inset-0 z-50' : ''}`}>
        <div className="flex items-center justify-between px-5 py-3 bg-white border-b border-[#e1e2ed] shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-amber-50 text-amber-600">
              <UtensilsCrossed className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-sm font-black text-gray-900">Kitchen Display System</h1>
              <p className="text-[10px] text-gray-400">Live KOT feed for kitchen staff</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={toggleSound} className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-all cursor-pointer" title={soundEnabled ? 'Mute alerts' : 'Enable alerts'}>
              {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </button>
            <button onClick={handleRefresh} className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-all cursor-pointer" title="Refresh">
              <RefreshCw className="w-4 h-4" />
            </button>
            <button onClick={() => setFullscreen(!fullscreen)} className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-all cursor-pointer" title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
              {fullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
          </div>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-gray-400">
          <ChefHat className="w-20 h-20 text-gray-200" />
          <h2 className="text-lg font-bold text-gray-300">No Active Kitchen Orders</h2>
          <p className="text-sm text-gray-300">Orders with KOT records will appear here in real-time.</p>
          <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 rounded-xl border border-amber-100">
            <AlertCircle className="w-4 h-4 text-amber-500" />
            <span className="text-xs text-amber-700 font-medium">Waiting for new orders from the POS terminal...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col h-full min-h-0 bg-[#faf8ff] ${fullscreen ? 'fixed inset-0 z-50' : ''}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 bg-white border-b border-[#e1e2ed] shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-amber-50 text-amber-600">
            <UtensilsCrossed className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-sm font-black text-gray-900">Kitchen Display</h1>
            <p className="text-[10px] text-gray-400">
              {totalActiveKots} active KOT{totalActiveKots !== 1 ? 's' : ''}
              {urgentKots > 0 && <span className="text-red-500 ml-1">· {urgentKots} urgent</span>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 mr-3">
            {COLUMN_CONFIG.map(col => {
              const count = columns[col.id]?.length || 0;
              return (
                <div key={col.id} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold ${col.bgColor} ${col.textColor}`}>
                  <col.icon className="w-3 h-3" />
                  {col.label.split(' ')[0]}
                  <span className="ml-0.5">({count})</span>
                </div>
              );
            })}
          </div>
          <button onClick={toggleSound} className={`p-2 rounded-lg transition-all cursor-pointer ${soundEnabled ? 'text-gray-400 hover:text-gray-600 hover:bg-gray-100' : 'text-red-400 bg-red-50'}`} title={soundEnabled ? 'Mute alerts' : 'Enable alerts'}>
            {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>
          <button onClick={handleRefresh} className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-all cursor-pointer" title="Refresh">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button onClick={() => setFullscreen(!fullscreen)} className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-all cursor-pointer" title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
            {fullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Kanban Board */}
      <div className="flex-1 flex gap-4 p-4 overflow-x-auto overflow-y-auto min-h-0">
        {COLUMN_CONFIG.map(column => {
          const columnCards = columns[column.id] || [];
          return (
            <div key={column.id} className="flex-1 min-w-[320px] max-w-[420px] flex flex-col">
              {/* Column Header */}
              <div className={`flex items-center justify-between px-3 py-2 rounded-t-xl ${column.color} text-white`}>
                <div className="flex items-center gap-2">
                  <column.icon className="w-4 h-4" />
                  <span className="text-xs font-bold uppercase tracking-wide">{column.label}</span>
                </div>
                <span className="text-xs font-black bg-white/20 px-2 py-0.5 rounded-full">{columnCards.length}</span>
              </div>

              {/* Column Body */}
              <div className="flex-1 bg-white border-x border-b border-[#e1e2ed] rounded-b-xl p-3 space-y-3 overflow-y-auto min-h-[200px]">
                {columnCards.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-gray-300 py-8">
                    <column.icon className="w-10 h-10 mb-2 opacity-50" />
                    <p className="text-xs font-medium">No orders</p>
                  </div>
                ) : (
                  columnCards.map(card => {
                    const { kot, orderId, orderNumber, tableNumber, waiterName, customerName } = card;
                    const elapsedMinutes = getKOTElapsedMinutes(kot.printedAt);
                    const urgency = getUrgencyStyle(elapsedMinutes);
                    const totalQty = kot.items.reduce((s, i) => s + i.quantity, 0);
                    const transitions = getKOTStatusTransitions(kot.status);
                    const isExpanded = expandedCard === kot.id;
                    const cardKey = `${orderId}_${kot.id}`;

                    return (
                      <div
                        key={cardKey}
                        className={`rounded-xl border-2 transition-all cursor-pointer ${
                          elapsedMinutes >= AGING_THRESHOLDS.urgent
                            ? 'border-red-300 shadow-[0_0_0_1px_rgba(239,68,68,0.15)]'
                            : elapsedMinutes >= AGING_THRESHOLDS.warning
                              ? 'border-amber-200 shadow-sm'
                              : 'border-gray-100 shadow-sm hover:shadow-md'
                        } ${urgency.bg} ${isExpanded ? 'shadow-md' : ''}`}
                        onClick={() => setExpandedCard(isExpanded ? null : kot.id)}
                      >
                        {/* Card Header */}
                        <div className="px-3 py-2.5 flex items-start justify-between">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-black text-sm text-gray-900">#{orderNumber}</span>
                              {kot.type !== 'Original' && (
                                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md ${
                                  kot.type === 'Additional' ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'bg-red-50 text-red-700 border border-red-200'
                                }`}>
                                  {kot.type === 'Additional' ? 'ADDITIONAL' : 'REPRINT'} KOT #{kot.kotNumber}
                                </span>
                              )}
                              {tableNumber && (
                                <span className="flex items-center gap-1 text-[10px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-md">
                                  <Table2 className="w-2.5 h-2.5" />
                                  T{tableNumber}
                                </span>
                              )}
                              <span className={`flex items-center gap-1 text-[10px] font-bold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded-md`}>
                                <Clock className="w-2.5 h-2.5" />
                                {formatElapsed(elapsedMinutes)}
                              </span>
                            </div>
                            {waiterName && (
                              <div className="flex items-center gap-1 text-[9px] text-gray-400">
                                <User className="w-2.5 h-2.5" />
                                {waiterName}
                              </div>
                            )}
                          </div>

                          <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold ${urgency.text}`}>
                            <div className={`w-1.5 h-1.5 rounded-full ${urgency.dot}`} />
                            {elapsedMinutes >= AGING_THRESHOLDS.urgent ? 'URGENT' : elapsedMinutes >= AGING_THRESHOLDS.warning ? 'WAITING' : 'ON TIME'}
                          </div>
                        </div>

                        {/* Items List (from this KOT only) */}
                        <div className="px-3 pb-2">
                          <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">
                            {totalQty} item{totalQty !== 1 ? 's' : ''}
                          </div>
                          <div className="space-y-1">
                            {kot.items.slice(0, isExpanded ? kot.items.length : 4).map((item, idx) => {
                              const itemName = item?.product?.name || 'Unknown Item';
                              const itemKey = item?.id || `${itemName}_${item?.selectedVariant?.name || ''}_${idx}`;
                              return (
                                <div key={itemKey} className={`flex items-center justify-between text-xs ${item?.cancelled ? 'opacity-50' : ''}`}>
                                  <span className={`font-semibold truncate flex-1 ${item?.cancelled ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                                    <span className="text-gray-400 mr-1">{item?.quantity || 0}x</span>
                                    {itemName}
                                    {item?.selectedVariant?.name && <span className="text-gray-400 ml-1">({item.selectedVariant.name})</span>}
                                    {item?.cancelled && item?.cancelReason && (
                                      <span className="text-red-500 ml-1 font-bold text-[8px]">CANCELLED ({item.cancelReason})</span>
                                    )}
                                  </span>
                                  <div className="flex items-center gap-1 shrink-0 ml-1">
                                    {item?.notes && <span className="text-[9px] text-amber-600 italic">📝</span>}
                                    {!item?.cancelled && onCancelOrderItem && (
                                      <button
                                        onClick={(e) => { e.stopPropagation(); handleCancelClick(orderId, itemKey, itemName); }}
                                        className="p-0.5 rounded text-red-300 hover:text-red-600 hover:bg-red-50 transition-all cursor-pointer"
                                        title="Cancel item"
                                      >
                                        <XCircle className="w-3 h-3" />
                                      </button>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                            {kot.items.length > 4 && !isExpanded && (
                              <button className="text-[9px] text-blue-500 font-bold hover:text-blue-700" onClick={(e) => { e.stopPropagation(); setExpandedCard(kot.id); }}>
                                +{kot.items.length - 4} more items
                              </button>
                            )}
                          </div>

                          {/* Special notes */}
                          {kot.items.filter(i => i.notes).length > 0 && (
                            <div className="mt-2 pt-1.5 border-t border-dashed border-gray-200">
                              {kot.items.filter(i => i.notes).map((item, idx) => (
                                <p key={idx} className="text-[9px] text-amber-700 font-medium">📝 {item?.product?.name || 'Unknown Item'}: {item.notes}</p>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Status Actions (KOT-level) */}
                        {transitions.length > 0 && (
                          <div className="px-3 pb-3 pt-0 flex gap-1.5 flex-wrap" onClick={(e) => e.stopPropagation()}>
                            {transitions.map(targetStatus => {
                              const btnConfig = {
                                'Preparing': { icon: ChefHat, label: 'Start Preparing', color: 'bg-amber-500 hover:bg-amber-600 text-white' },
                                'Ready': { icon: CheckCircle, label: 'Mark Ready', color: 'bg-green-500 hover:bg-green-600 text-white' },
                                'Served': { icon: ArrowRight, label: 'Mark Served', color: 'bg-blue-500 hover:bg-blue-600 text-white' },
                                'Accepted': { icon: Bell, label: 'Accept', color: 'bg-blue-500 hover:bg-blue-600 text-white' },
                              } as const;
                              const cfg = btnConfig[targetStatus as keyof typeof btnConfig];
                              if (!cfg) return null;
                              const Icon = cfg.icon;
                              return (
                                <button
                                  key={targetStatus}
                                  onClick={() => handleAdvanceKOTStatus(card, targetStatus)}
                                  className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${cfg.color} shadow-xs hover:shadow-sm active:scale-95`}
                                >
                                  <Icon className="w-3 h-3" />
                                  {cfg.label}
                                </button>
                              );
                            })}
                          </div>
                        )}

                        {/* Footer meta */}
                        <div className="px-3 py-1.5 border-t border-[#e1e2ed] flex justify-between text-[8px] text-gray-400">
                          <span>KOT #{kot.kotNumber} · {kot.type}</span>
                          {customerName && <span>👤 {customerName}</span>}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Cancel Item Reason Modal */}
      {cancelTarget && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setCancelTarget(null)}>
          <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full border border-[#e1e2ed] p-5" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-sm mb-1 flex items-center gap-1.5">
              <Ban className="w-4 h-4 text-red-500" />
              Cancel Item
            </h3>
            <p className="text-xs text-gray-500 mb-3">
              Reason for cancelling <span className="font-bold text-gray-700">{cancelTarget.itemName}</span>:
            </p>
            <div className="space-y-1.5">
              {CANCEL_REASONS.map((r) => (
                <button
                  key={r.id}
                  onClick={() => handleCancelConfirm(r.label)}
                  className="w-full text-left px-3 py-2 bg-gray-50 hover:bg-gray-100 rounded-lg text-xs font-semibold border border-[#e1e2ed] cursor-pointer transition-all hover:border-red-200"
                >
                  {r.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => setCancelTarget(null)}
              className="mt-3 w-full py-2 border border-gray-300 rounded-lg text-xs font-semibold hover:bg-gray-50 cursor-pointer"
            >
              Back
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
