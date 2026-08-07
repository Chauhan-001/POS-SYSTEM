import { ShoppingCart, RefreshCw, Phone, Award, X, DollarSign, ArrowLeftRight, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { CartItem, Customer, HeldOrder, Product, ProductVariant, LoyaltyReward, SystemSettings } from '../src/types';
import CartItemRow from './CartItemRow';

interface CartPanelProps {
  cartWidth: number;
  startResizeCart: (e: React.MouseEvent) => void;
  cartItems: CartItem[];
  activeOrder: { orderNumber?: number; type?: string; tableNumber?: number } | null;
  heldOrders: HeldOrder[];
  onOpenHeldDrawer: () => void;
  settings: SystemSettings;
  onPaymentChange: (method: 'Cash' | 'UPI' | 'Card' | 'Wallet' | 'Split') => void;
  onOrderTypeChange: (type: 'Dine In' | 'Takeaway' | 'Delivery' | 'Swiggy' | 'Zomato' | 'Uber Eats' | 'Other') => void;
  paymentMethod: string;
  orderType: string;
  calculateCartSubtotal: () => number;
  calculateCartDiscount: () => number;
  calculateCartTaxes: () => number;
  calculateCartGrandTotal: () => number;
  onAdjustQuantity: (id: string, delta: number) => void;
  onDeleteItem: (id: string) => void;
  onShowKOT: () => void;
  onShowPayment: () => void;
  onHoldOrder: () => void;
  products: Product[];
  quickFireInput: string;
  onQuickFireChange: (val: string) => void;
  quickFireSessionCount: number;
  quickFireFlash: 'success' | 'error' | null;
  onQuickFireKeyDown: (e: React.KeyboardEvent) => void;
  isQuickFireActive: boolean;
  onToggleQuickFire: () => void;
  isMoreBillingOpen: boolean;
  onToggleMoreBilling: () => void;
  searchedCustomer: Customer | null;
  customerPhone: string;
  onCustomerPhoneChange: (val: string) => void;
  onOpenOffers: () => void;
  onOpenCustomerSearch: () => void;
  loyaltyPhoneRef: React.RefObject<HTMLInputElement | null>;
  quickFireRef: React.RefObject<HTMLInputElement | null>;
  appliedReward: LoyaltyReward | null;
  splitDetails: { cashAmount: number; cardAmount: number; upiAmount: number; walletAmount: number };
  onOpenSplitPopup: () => void;
  currencySymbol: string;
  onOpenAddOnModal: (product: Product, variant?: ProductVariant) => void;
  onUpdateItemNotes: (itemId: string, notes: string) => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
  moduleSettings?: Record<string, boolean>;
  manualDiscount?: number;
  onManualDiscountChange?: (val: number) => void;
  /** Whether the current role may apply manual discounts (Owner always can). */
  canApplyDiscount?: boolean;
}

export default function CartPanel({
  cartWidth, startResizeCart, cartItems, activeOrder, heldOrders, onOpenHeldDrawer,
  settings, onPaymentChange, onOrderTypeChange, paymentMethod, orderType,
  calculateCartSubtotal, calculateCartDiscount, calculateCartTaxes, calculateCartGrandTotal,
  onAdjustQuantity, onDeleteItem, onShowKOT, onShowPayment, onHoldOrder,
  products, quickFireInput, onQuickFireChange, quickFireSessionCount, quickFireFlash, onQuickFireKeyDown,
  isQuickFireActive, onToggleQuickFire, isMoreBillingOpen, onToggleMoreBilling,
  searchedCustomer, customerPhone, onCustomerPhoneChange, onOpenOffers, onOpenCustomerSearch,
  loyaltyPhoneRef, quickFireRef, appliedReward, splitDetails, onOpenSplitPopup,
  currencySymbol, onUpdateItemNotes, moduleSettings = {} as Record<string, boolean>,
  manualDiscount, onManualDiscountChange, canApplyDiscount,
}: CartPanelProps) {
  const manualDiscountVal = manualDiscount ?? 0;
  const handleDiscountChange = onManualDiscountChange || ((val: number) => {});

  return (
    <div data-tour="cart-panel" className="bg-white border-l border-[#e1e2ed] flex flex-col min-h-0 overflow-hidden shrink-0 relative"
      style={{ width: cartWidth }}>
      <div onMouseDown={startResizeCart}
        className="absolute left-0 top-0 bottom-0 w-3 cursor-col-resize hover:bg-[#004ac6]/10 transition-colors z-10 flex items-center justify-center group">
        <div className="w-1 h-8 rounded-full bg-[#c3c6d7] group-hover:bg-[#004ac6] transition-colors" />
      </div>
      <button onMouseDown={startResizeCart}
        className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1/2 w-5 h-10 rounded-full bg-white border border-[#c3c6d7] shadow-md flex items-center justify-center cursor-col-resize hover:bg-[#f3f3fe] hover:border-[#004ac6] transition-all z-20 group"
        title="Drag to resize cart panel">
        <ChevronLeft className="w-3 h-3 text-gray-400 group-hover:text-[#004ac6]" />
        <ChevronRight className="w-3 h-3 text-gray-400 group-hover:text-[#004ac6]" />
      </button>
      <div className="p-2 border-b border-[#e1e2ed] bg-gray-50 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <ShoppingCart className="w-4 h-4 text-[#004ac6] shrink-0" />
            <div className="min-w-0">
              <h3 className="text-sm font-bold truncate">{activeOrder ? `Order #${activeOrder.orderNumber}` : 'Current Bill'}</h3>
              {activeOrder && (
                <p className="text-[9px] text-gray-500 truncate">{activeOrder.type}{activeOrder.tableNumber ? ` · Table ${activeOrder.tableNumber}` : ''}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {heldOrders.length > 0 && (
          <button onClick={onOpenHeldDrawer}
            data-tour="held-badge"
            className="px-2 py-1 bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 rounded-lg text-[9px] font-bold transition-all cursor-pointer flex items-center gap-1">
                <RefreshCw className="w-3 h-3" />{heldOrders.length}
              </button>
            )}
            <span className="text-xs font-mono bg-blue-50 text-[#004ac6] px-2 py-0.5 rounded-full font-bold">{cartItems.length} items</span>
          </div>
        </div>
      </div>
      <div className="p-2 border-b border-[#e1e2ed] bg-white space-y-1.5 shrink-0">
        <div className="flex items-center gap-1.5">
          <div className="relative flex-1">
            <Phone className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input ref={loyaltyPhoneRef as any} type="text" placeholder={moduleSettings.enableGuestCheckout !== false ? 'Customer mobile (optional − F2)' : 'Customer mobile for loyalty (F2)'}
              data-tour="phone-input"
              value={customerPhone} onChange={(e) => onCustomerPhoneChange(e.target.value)} maxLength={10}
              onBlur={(e) => {
                const val = e.target.value.trim();
                if (val.length > 0 && val.length < 10) {
                  // Don't clear, just let user continue typing
                }
              }}
              className="w-full pl-8 pr-2 py-1.5 rounded-lg border border-[#c3c6d7] text-xs focus:outline-none focus:ring-1 focus:ring-[#004ac6]" />
          </div>
          <button onClick={onOpenCustomerSearch}
            className="shrink-0 px-2.5 py-1.5 bg-[#f3f3fe] hover:bg-[#e7e7f3] text-[#004ac6] rounded-lg flex items-center gap-1 text-[10px] font-semibold transition-all cursor-pointer"
            title="Search customer by name or phone">
            <Search className="w-3.5 h-3.5" />
          </button>
          {(moduleSettings.enableLoyalty !== false || searchedCustomer) && (
            <button onClick={onOpenOffers}
              data-tour="offers-btn"
              className="shrink-0 px-2.5 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-800 rounded-lg flex items-center gap-1 text-[10px] font-semibold transition-all cursor-pointer">
              <Award className="w-3.5 h-3.5" />Offers
            </button>
          )}
        </div>
      </div>
      {isQuickFireActive && (
        <div className={`p-2 border-b transition-colors duration-200 ${
          quickFireFlash === 'success' ? 'bg-green-50 border-green-300' :
          quickFireFlash === 'error' ? 'bg-red-50 border-red-300' :
          'bg-amber-50 border-amber-200'
        }`}>
          <div className="flex items-center gap-1">
            <input ref={quickFireRef as any} type="text"
              placeholder="Scan barcode or type code/name..."
              value={quickFireInput}
              onChange={(e) => onQuickFireChange(e.target.value)}
              onKeyDown={onQuickFireKeyDown}
              onFocus={(e) => e.target.select()}
              className={`flex-1 px-2 py-1 text-xs border rounded focus:outline-none focus:ring-1 bg-white transition-colors duration-150 ${
                quickFireFlash === 'success' ? 'border-green-400 ring-green-400' :
                quickFireFlash === 'error' ? 'border-red-400 ring-red-400' :
                'border-amber-300 focus:ring-amber-500'
              }`}
              autoFocus
            />
            {quickFireSessionCount > 0 && (
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${
                quickFireFlash === 'success' ? 'bg-green-100 text-green-700' :
                'bg-amber-100 text-amber-700'
              }`}>
                +{quickFireSessionCount}
              </span>
            )}
            <button onClick={onToggleQuickFire} className="p-1 text-amber-600 hover:text-amber-800"><X className="w-3.5 h-3.5" /></button>
          </div>
          <p className="text-[9px] text-amber-700 mt-1">Quick-fire: type code or name + Enter to add instantly</p>
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2" data-tour="cart-items-area">
        {cartItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 py-8 px-4">
            <ShoppingCart className="w-10 h-10 text-gray-200 mb-3" />
            <p className="text-xs font-semibold text-gray-500">Empty Bill</p>
            <p className="text-[10px] mt-1">Tap items above or use <kbd className="px-1.5 py-0.5 bg-gray-100 rounded text-[9px] font-mono font-bold text-gray-600 border border-gray-200">F1</kbd> to search</p>
          </div>
        ) : (
          cartItems.map((item) => (
            <CartItemRow
              key={item.id}
              item={item}
              currencySymbol={currencySymbol}
              enableOrderNotes={moduleSettings.enableOrderNotes !== false}
              onAdjustQuantity={onAdjustQuantity}
              onDeleteItem={onDeleteItem}
              onUpdateItemNotes={onUpdateItemNotes}
            />
          ))
        )}
      </div>
      {/* ─── FOOTER (totals + payment + actions) — sits at bottom via flex layout ─── */}
      <div className="bg-white border-t border-[#e1e2ed] shrink-0 pb-1">
        {/* Row 1: Compact totals inline */}
        <div className="px-3 py-1.5 flex items-center justify-between text-[11px] border-b border-[#e1e2ed]/50">
          <div className="flex items-center gap-3 text-gray-500">
            <span>Sub: <span className="font-semibold text-gray-700">{currencySymbol}{calculateCartSubtotal().toFixed(2)}</span></span>
            {calculateCartDiscount() > 0 && (
              <span className="text-green-600">Disc: -{currencySymbol}{calculateCartDiscount().toFixed(2)}</span>
            )}
            <span>GST: <span className="font-semibold text-gray-700">{currencySymbol}{calculateCartTaxes().toFixed(2)}</span></span>
            {moduleSettings.enableDiscountOnBilling !== false && canApplyDiscount !== false && (
              <span className="flex items-center gap-1">
                <span className="text-gray-400">Disc:</span>
                <input type="number" min="0" value={manualDiscountVal || ''}
                  onChange={(e) => handleDiscountChange(Math.max(0, parseFloat(e.target.value) || 0))}
                  className="w-14 px-1 py-0.5 text-right text-[10px] font-mono border border-dashed border-gray-300 rounded focus:outline-none focus:border-[#004ac6] bg-transparent"
                  placeholder="0" />
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-gray-500">Total:</span>
            <span data-tour="cart-total" className="font-bold text-sm text-[#004ac6]">{currencySymbol}{calculateCartGrandTotal().toFixed(2)}</span>
          </div>
        </div>

        {/* Row 2: Payment selects + Pay button (compact horizontal) */}
        <div className="px-3 py-1.5 flex items-center gap-2">
          <select value={paymentMethod} onChange={(e) => onPaymentChange(e.target.value as any)}
            className="w-[100px] px-1.5 py-1 text-[10px] border border-[#c3c6d7] rounded-lg font-semibold bg-white focus:outline-none focus:ring-1 focus:ring-[#004ac6] cursor-pointer">
            <option value="Cash">Cash</option>
            <option value="UPI">UPI</option>
            <option value="Card">Card</option>
            <option value="Wallet">Wallet</option>
            <option value="Split">Split</option>
          </select>
          <select value={orderType} onChange={(e) => onOrderTypeChange(e.target.value as any)}
            className="w-[110px] px-1.5 py-1 text-[10px] border border-[#c3c6d7] rounded-lg font-semibold bg-white focus:outline-none focus:ring-1 focus:ring-[#004ac6] cursor-pointer">
            <option value="Dine In">Dine In</option>
            <option value="Takeaway">Takeaway</option>
            {moduleSettings.enableDeliveryModule !== false && <option value="Delivery">Delivery</option>}
            {moduleSettings.enableOnlineOrders !== false && (
              <>
                <option value="Swiggy">Swiggy</option>
                <option value="Zomato">Zomato</option>
                <option value="Uber Eats">Uber Eats</option>
                <option value="Other">Other</option>
              </>
            )}
          </select>
          <button onClick={onShowPayment} disabled={cartItems.length === 0 || (paymentMethod === 'Split' && !(Math.abs((splitDetails.cashAmount || 0) + (splitDetails.cardAmount || 0) + (splitDetails.upiAmount || 0) + (splitDetails.walletAmount || 0) - calculateCartGrandTotal()) < 0.01))}
            data-tour="pay-btn"
            className="flex-1 py-1.5 bg-green-600 hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-lg text-[11px] font-bold transition-all cursor-pointer shadow-sm flex items-center justify-center gap-1.5"
            title="Pay (F9)">
            <DollarSign className="w-3.5 h-3.5" />
            {paymentMethod === 'Split' &&
            Math.abs((splitDetails.cashAmount || 0) + (splitDetails.cardAmount || 0) + (splitDetails.upiAmount || 0) + (splitDetails.walletAmount || 0) - calculateCartGrandTotal()) < 0.01
              ? 'Split Pay'
              : 'Close Bill'}
          </button>
        </div>

        {/* Split calculator prompt (when Split is selected) */}
        {paymentMethod === "Split" && (
          <div className="px-3 pb-1.5">
            <button onClick={onOpenSplitPopup}
              className="w-full py-1 bg-[#004ac6] hover:bg-[#003399] text-white rounded-lg flex items-center justify-center gap-1 text-[10px] font-semibold transition-all cursor-pointer">
              <ArrowLeftRight className="w-3 h-3" />Open Split Payment Calculator
            </button>
          </div>
        )}

        {/* Row 3: Action buttons (KOT + More + Hold/Quick) */}
        <div className="px-3 pb-1.5 flex items-center gap-2">
          <button onClick={onShowKOT} title="Print Kitchen Order Ticket"
            data-tour="kot-btn"
            className="px-3 py-1 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-[10px] font-bold transition-all cursor-pointer whitespace-nowrap">KOT</button>
          <button onClick={onToggleMoreBilling} title="More billing options"
            data-tour="more-btn"
            className="px-3 py-1 bg-white border border-[#e1e2ed] text-gray-600 rounded-lg text-[10px] font-bold transition-all cursor-pointer whitespace-nowrap">
            More {isMoreBillingOpen ? '▲' : '▾'}
          </button>
          <div className="flex-1" />
          {isMoreBillingOpen ? (
            <>
              <button onClick={onHoldOrder} title="Suspend current billing (F8)"
                data-tour="hold-btn"
                className="px-2 py-1 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg text-[10px] font-bold transition-all cursor-pointer flex items-center gap-1">Hold (F8)</button>
              <button onClick={onToggleQuickFire} title="Toggle quick product code entry"
                className="px-2 py-1 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg text-[10px] font-bold transition-all cursor-pointer flex items-center gap-1">Quick Code</button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
