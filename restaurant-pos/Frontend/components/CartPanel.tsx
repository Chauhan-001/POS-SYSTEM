import { ShoppingCart, RefreshCw, Phone, Award, X, DollarSign, ArrowLeftRight, ChevronLeft, ChevronRight, Search, Trash2, Printer, PauseCircle, MoreHorizontal, XCircle } from 'lucide-react';
import { CartItem, Customer, HeldOrder, Product, ProductVariant, LoyaltyReward, SystemSettings } from '../src/types';
import CartItemRow from './CartItemRow';
import OfferProfitabilityStrip from './OfferProfitabilityStrip';

interface CartPanelProps {
  cartWidth: number;
  startResizeCart: (e: React.MouseEvent) => void;
  cartItems: CartItem[];
  activeOrder: { orderNumber?: number; type?: string; tableNumber?: number; status?: string; kotRecords?: any[] } | null;
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
  onClearCart?: () => void;
  /** Close the active order WITHOUT payment (undo accidental table tap). Only
   * valid before the first KOT reaches the kitchen. */
  onCloseOrder?: () => void;
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
  /** The server-validated offer applied to this bill (drives the profitability strip). */
  appliedOffer?: any;
}

export default function CartPanel({
  cartWidth, startResizeCart, cartItems, activeOrder, heldOrders, onOpenHeldDrawer,
  settings, onPaymentChange, onOrderTypeChange, paymentMethod, orderType,
  calculateCartSubtotal, calculateCartDiscount, calculateCartTaxes, calculateCartGrandTotal,
  onAdjustQuantity, onDeleteItem, onClearCart, onCloseOrder, onShowKOT, onShowPayment, onHoldOrder,
  products, quickFireInput, onQuickFireChange, quickFireSessionCount, quickFireFlash, onQuickFireKeyDown,
  isQuickFireActive, onToggleQuickFire, isMoreBillingOpen, onToggleMoreBilling,
  searchedCustomer, customerPhone, onCustomerPhoneChange, onOpenOffers, onOpenCustomerSearch,
  loyaltyPhoneRef, quickFireRef, appliedReward, splitDetails, onOpenSplitPopup,
  currencySymbol, onUpdateItemNotes, moduleSettings = {} as Record<string, boolean>,
  manualDiscount, onManualDiscountChange, canApplyDiscount, appliedOffer,
}: CartPanelProps) {
  const manualDiscountVal = manualDiscount ?? 0;
  const handleDiscountChange = onManualDiscountChange || ((val: number) => {});

  return (
    <div data-tour="cart-panel" className="bg-white border-l border-gray-300 flex flex-col min-h-0 overflow-hidden shrink-0 relative shadow-lg"
      style={{ width: cartWidth }}>
      {/* Resizer */}
      <div onMouseDown={startResizeCart}
        className="absolute left-0 top-0 bottom-0 w-3 cursor-col-resize hover:bg-[var(--brand-color)]/10 transition-colors z-10 flex items-center justify-center group">
        <div className="w-1 h-8 rounded-full bg-gray-300 group-hover:bg-[var(--brand-color)] transition-colors" />
      </div>
      <button onMouseDown={startResizeCart}
        className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1/2 w-5 h-10 rounded-full bg-white border border-gray-300 shadow-md flex items-center justify-center cursor-col-resize hover:bg-gray-100 transition-all z-20 group"
        title="Drag to resize cart panel">
        <ChevronLeft className="w-3 h-3 text-gray-400 group-hover:text-[var(--brand-color)]" />
        <ChevronRight className="w-3 h-3 text-gray-400 group-hover:text-[var(--brand-color)]" />
      </button>

      {/* Header — Order Number & Table Info */}
      <div className="p-3 border-b border-gray-200 bg-gray-50 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-2 bg-[var(--brand-color)]/10 text-[var(--brand-color)] rounded-xl shrink-0">
              <ShoppingCart className="w-5 h-5 stroke-[2.5]" />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-extrabold text-gray-900 truncate leading-tight">
                {activeOrder ? `Order #${activeOrder.orderNumber}` : 'Current Order'}
              </h3>
              <p className="text-xs font-bold text-gray-500 truncate mt-0.5">
                {activeOrder ? `${activeOrder.type}${activeOrder.tableNumber ? ` • Table ${activeOrder.tableNumber}` : ''}` : 'Dine In • Quick Sale'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {heldOrders.length > 0 && (
              <button onClick={onOpenHeldDrawer}
                data-tour="held-badge"
                className="px-2.5 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-800 border border-amber-300 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1 shadow-sm">
                <RefreshCw className="w-3.5 h-3.5" />
                <span>{heldOrders.length} Held</span>
              </button>
            )}
            <span className="text-xs font-extrabold font-mono bg-blue-100 text-[var(--brand-color)] px-2.5 py-1 rounded-full border border-blue-200">
              {cartItems.reduce((acc, item) => acc + item.quantity, 0)} items
            </span>
          </div>
        </div>
      </div>

      {/* Customer Mobile & Loyalty/Offers Bar */}
      <div className="p-2.5 border-b border-gray-200 bg-white shrink-0">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Phone className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input ref={loyaltyPhoneRef as any} type="text"
              placeholder={moduleSettings.enableGuestCheckout !== false ? 'Customer Mobile (optional)' : 'Customer Mobile'}
              data-tour="phone-input"
              value={customerPhone} onChange={(e) => onCustomerPhoneChange(e.target.value)} maxLength={10}
              className="w-full pl-8 pr-2 py-2 rounded-xl border border-gray-300 text-xs font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)] bg-white" />
          </div>
          <button onClick={onOpenCustomerSearch}
            className="shrink-0 p-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl flex items-center justify-center transition-all cursor-pointer border border-gray-200"
            title="Search Customer">
            <Search className="w-4 h-4" />
          </button>
          {(moduleSettings.enableLoyalty !== false || searchedCustomer) && (
            <button onClick={onOpenOffers}
              data-tour="offers-btn"
              className="shrink-0 px-3 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl flex items-center gap-1 text-xs font-extrabold transition-all cursor-pointer shadow-sm">
              <Award className="w-4 h-4" />
              <span>Offers</span>
            </button>
          )}
        </div>
        {/* Live offer economics — cost vs contribution the moment an offer/combo is applied */}
        {appliedOffer && cartItems.length > 0 && (
          <div className="mt-2">
            <OfferProfitabilityStrip
              cartItems={cartItems}
              appliedOffer={appliedOffer}
              subtotal={calculateCartSubtotal()}
              currencySymbol={currencySymbol}
            />
          </div>
        )}
      </div>

      {/* Quick Fire Bar */}
      {isQuickFireActive && (
        <div className={`p-2 border-b transition-colors duration-200 ${
          quickFireFlash === 'success' ? 'bg-green-50 border-green-300' :
          quickFireFlash === 'error' ? 'bg-red-50 border-red-300' :
          'bg-amber-50 border-amber-200'
        }`}>
          <div className="flex items-center gap-1.5">
            <input ref={quickFireRef as any} type="text"
              placeholder="Scan barcode or type item code..."
              value={quickFireInput}
              onChange={(e) => onQuickFireChange(e.target.value)}
              onKeyDown={onQuickFireKeyDown}
              onFocus={(e) => e.target.select()}
              className="flex-1 px-3 py-1.5 text-xs font-bold border rounded-xl focus:outline-none bg-white border-amber-300"
              autoFocus
            />
            {quickFireSessionCount > 0 && (
              <span className="text-xs font-extrabold px-2 py-0.5 rounded-full bg-amber-200 text-amber-800 shrink-0">
                +{quickFireSessionCount}
              </span>
            )}
            <button onClick={onToggleQuickFire} className="p-1 text-amber-700 hover:text-amber-900"><X className="w-4 h-4" /></button>
          </div>
        </div>
      )}

      {/* Cart Item Rows Area */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2 bg-gray-50/50" data-tour="cart-items-area">
        {cartItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 py-12 px-4">
            <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-3">
              <ShoppingCart className="w-8 h-8 text-gray-300" />
            </div>
            <p className="text-sm font-bold text-gray-600">Cart is Empty</p>
            <p className="text-xs text-gray-400 mt-1 text-center">Tap items from the left grid to add them to this bill</p>
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

      {/* Vertical Order Actions Panel (Inside Order Panel) */}
      <div className="bg-white border-t border-gray-200 p-2.5 shrink-0 flex flex-col gap-2">
        <div className="grid grid-cols-4 gap-1.5">
          <button
            onClick={onShowKOT}
            disabled={cartItems.length === 0}
            data-tour="kot-btn"
            className="py-2 px-1.5 bg-amber-500 hover:bg-amber-600 disabled:bg-gray-200 disabled:text-gray-400 text-white rounded-xl text-xs font-extrabold transition-all cursor-pointer shadow-sm flex flex-col items-center justify-center gap-1"
            title="Send KOT to Kitchen"
          >
            <Printer className="w-4 h-4" />
            <span>KOT</span>
          </button>

          <button
            onClick={onHoldOrder}
            disabled={cartItems.length === 0}
            data-tour="hold-btn"
            className="py-2 px-1.5 bg-sky-600 hover:bg-sky-700 disabled:bg-gray-200 disabled:text-gray-400 text-white rounded-xl text-xs font-extrabold transition-all cursor-pointer shadow-sm flex flex-col items-center justify-center gap-1"
            title="Hold Current Order (F8)"
          >
            <PauseCircle className="w-4 h-4" />
            <span>Hold</span>
          </button>

          {(() => {
            // Before the first KOT is sent, the Clear action becomes CLOSE — it
            // cancels the whole order (undoing an accidental table tap) instead
            // of just emptying the cart. Once any KOT reaches the kitchen the
            // order is locked: the bill cannot be closed from here.
            const hasActiveOrder = !!activeOrder && !['Paid', 'Closed', 'Cancelled', 'Refunded', 'Held'].includes(activeOrder.status);
            const kotSent = (activeOrder?.kotRecords?.length ?? 0) > 0;
            const isCloseMode = hasActiveOrder && !!onCloseOrder;
            const closeDisabled = isCloseMode && kotSent;
            const canClear = cartItems.length > 0;
            if (isCloseMode) {
              return (
                <button
                  onClick={closeDisabled ? undefined : onCloseOrder}
                  disabled={closeDisabled}
                  data-tour="close-order-btn"
                  className={`py-2 px-1.5 rounded-xl text-xs font-extrabold transition-all cursor-pointer shadow-sm flex flex-col items-center justify-center gap-1 ${
                    closeDisabled
                      ? 'bg-gray-100 text-gray-400 border border-gray-200 cursor-not-allowed'
                      : 'bg-rose-600 hover:bg-rose-700 text-white'
                  }`}
                  title={closeDisabled ? 'Order sent to kitchen — cannot close' : 'Close order & free the table (undo accidental table tap)'}
                >
                  <XCircle className={`w-4 h-4 ${closeDisabled ? '' : 'text-white'}`} />
                  <span>{closeDisabled ? 'Locked' : 'Close'}</span>
                </button>
              );
            }
            return (
              <button
                onClick={() => onClearCart ? onClearCart() : cartItems.forEach(i => onDeleteItem(i.id))}
                disabled={!canClear}
                className="py-2 px-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 disabled:bg-gray-100 disabled:text-gray-400 disabled:border-gray-200 rounded-xl text-xs font-extrabold transition-all cursor-pointer shadow-sm flex flex-col items-center justify-center gap-1"
                title="Clear All Cart Items"
              >
                <Trash2 className="w-4 h-4 text-rose-600" />
                <span>Clear</span>
              </button>
            );
          })()}

          <button
            onClick={onToggleMoreBilling}
            data-tour="more-btn"
            className="py-2 px-1.5 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-xl text-xs font-extrabold transition-all cursor-pointer border border-gray-300 flex flex-col items-center justify-center gap-1"
            title="More Options"
          >
            <MoreHorizontal className="w-4 h-4" />
            <span>More</span>
          </button>
        </div>

        {isMoreBillingOpen && (
          <div className="p-2 bg-gray-50 border border-gray-200 rounded-xl flex items-center justify-around gap-2 text-xs">
            <button onClick={onToggleQuickFire}
              className="px-3 py-1.5 bg-white border border-gray-300 rounded-lg font-bold text-gray-700 hover:bg-gray-100">
              Quick Code Entry
            </button>
            {paymentMethod === "Split" && (
              <button onClick={onOpenSplitPopup}
                className="px-3 py-1.5 bg-[var(--brand-color)] text-white rounded-lg font-bold">
                Split Calculator
              </button>
            )}
          </div>
        )}
      </div>

      {/* Totals & Payment Checkout Section */}
      <div className="bg-gray-50 border-t border-gray-300 p-3 shrink-0 flex flex-col gap-2.5">
        {/* Totals Row */}
        <div className="bg-white p-2.5 rounded-xl border border-gray-200 flex flex-col gap-1 text-xs">
          <div className="flex justify-between items-center text-gray-600 font-semibold">
            <span>Subtotal</span>
            <span className="font-mono text-gray-900">{currencySymbol}{calculateCartSubtotal().toFixed(2)}</span>
          </div>
          {calculateCartDiscount() > 0 && (
            <div className="flex justify-between items-center text-emerald-600 font-semibold">
              <span>Discount</span>
              <span className="font-mono">-{currencySymbol}{calculateCartDiscount().toFixed(2)}</span>
            </div>
          )}
          <div className="flex justify-between items-center text-gray-600 font-semibold">
            <span>GST / Tax</span>
            <span className="font-mono text-gray-900">{currencySymbol}{calculateCartTaxes().toFixed(2)}</span>
          </div>
          {moduleSettings.enableDiscountOnBilling !== false && canApplyDiscount !== false && (
            <div className="flex justify-between items-center pt-1 border-t border-gray-100 text-gray-700 font-semibold">
              <span className="text-[11px]">Manual Disc</span>
              <input type="number" min="0" value={manualDiscountVal || ''}
                onChange={(e) => handleDiscountChange(Math.max(0, parseFloat(e.target.value) || 0))}
                className="w-16 px-1.5 py-0.5 text-right font-mono border border-gray-300 rounded-lg text-xs font-bold focus:outline-none focus:ring-1 focus:ring-[var(--brand-color)] bg-gray-50"
                placeholder="0" />
            </div>
          )}
          <div className="flex justify-between items-center pt-1.5 border-t border-gray-200 mt-0.5">
            <span className="text-sm font-extrabold text-gray-900">Total</span>
            <span data-tour="cart-total" className="text-xl font-extrabold font-mono text-[var(--brand-color)]">
              {currencySymbol}{calculateCartGrandTotal().toFixed(2)}
            </span>
          </div>
        </div>

        {/* Dropdowns for Payment Method & Order Type */}
        <div className="grid grid-cols-2 gap-2">
          <select value={paymentMethod} onChange={(e) => onPaymentChange(e.target.value as any)}
            className="w-full px-2.5 py-2 text-xs font-extrabold border border-gray-300 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)] cursor-pointer text-gray-900">
            <option value="Cash">Cash ▼</option>
            <option value="UPI">UPI ▼</option>
            <option value="Card">Card ▼</option>
            <option value="Wallet">Wallet ▼</option>
            <option value="Split">Split ▼</option>
          </select>
          <select value={orderType} onChange={(e) => onOrderTypeChange(e.target.value as any)}
            className="w-full px-2.5 py-2 text-xs font-extrabold border border-gray-300 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)] cursor-pointer text-gray-900">
            {(moduleSettings.enableDineInModule !== false || orderType === 'Dine In') && <option value="Dine In">Dine In ▼</option>}
            {(moduleSettings.enableTakeawayModule !== false || orderType === 'Takeaway') && <option value="Takeaway">Takeaway ▼</option>}
            {(moduleSettings.enableDeliveryModule !== false || orderType === 'Delivery') && <option value="Delivery">Delivery ▼</option>}
            {moduleSettings.enableOnlineOrders !== false && (
              <>
                <option value="Swiggy">Swiggy ▼</option>
                <option value="Zomato">Zomato ▼</option>
                <option value="Uber Eats">Uber Eats ▼</option>
                <option value="Other">Other ▼</option>
              </>
            )}
          </select>
        </div>

        {/* Big Prominent CLOSE BILL Button */}
        <button
          onClick={onShowPayment}
          disabled={cartItems.length === 0 || (paymentMethod === 'Split' && !(Math.abs((splitDetails.cashAmount || 0) + (splitDetails.cardAmount || 0) + (splitDetails.upiAmount || 0) + (splitDetails.walletAmount || 0) - calculateCartGrandTotal()) < 0.01))}
          data-tour="pay-btn"
          className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-xl text-base font-extrabold transition-all cursor-pointer shadow-md flex items-center justify-center gap-2 active:scale-[0.99]"
          title="Complete Order & Close Bill (F9)"
        >
          <DollarSign className="w-5 h-5 stroke-[2.5]" />
          <span>CLOSE BILL</span>
        </button>
      </div>
    </div>
  );
}
