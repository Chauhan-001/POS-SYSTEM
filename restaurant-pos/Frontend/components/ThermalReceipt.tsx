/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ThermalReceipt — the single source of truth for the thermal-paper receipt body.
 *
 * Rendered by:
 *  - ReceiptModal (billing-time print, running-bill preview, PDF export)
 *  - SettingsManager → BILLING & INVOICE (live WYSIWYG preview of the printed bill)
 *
 * Any layout or section-visibility change made here applies everywhere the bill
 * is rendered, so the Settings preview always matches the real printed receipt.
 */

import React from 'react';
import { Heart } from 'lucide-react';
import { Bill, SystemSettings } from '../src/types';

interface ThermalReceiptProps {
  bill: Bill;
  settings: SystemSettings;
  /** Forwarded to the root <div> — lets callers read innerHTML (e.g. PDF export). */
  receiptRef?: React.Ref<HTMLDivElement>;
  className?: string;
}

export default function ThermalReceipt({ bill, settings, receiptRef, className }: ThermalReceiptProps) {
  // Generate CGST and SGST splits (e.g. 5% GST is split 2.5% CGST & 2.5% SGST)
  const isFivePercent = bill.gst > 0 && bill.items.some((item) => item.product.gstPercent === 5);
  const totalTaxRate = isFivePercent ? 5 : 18;
  const halfTaxRate = totalTaxRate / 2;
  const splitTaxAmount = bill.gst / 2;

  // Round-off calculations aligned with active system configurations
  const roundOffActive = settings.roundOffTotal === true;
  const finalGrandTotal = roundOffActive ? Math.round(bill.grandTotal) : bill.grandTotal;
  const finalRoundOff = roundOffActive ? parseFloat((Math.round(bill.grandTotal) - bill.grandTotal).toFixed(2)) : 0.0;

  const sym = settings.currencySymbol || '₹';

  return (
    <div
      ref={receiptRef}
      className={`bg-white border-2 border-dashed border-gray-300 w-full font-mono text-gray-800 leading-normal flex flex-col items-center print-receipt-only transition-all duration-300 h-fit ${
        settings.printSize === '58mm' ? 'max-w-[210px] p-3 text-[8.5px]' : 'max-w-[280px] p-5 text-[10px]'
      } ${className || ''}`}
      style={{ wordBreak: 'break-word' }}
    >
      {/* Header Details */}
      <div className="text-center space-y-1 w-full">
        <div className="border-b border-dashed border-gray-300 pb-1 mb-2"></div>
        {settings.printLogoOnReceipt !== false && settings.sidebarLogoUrl && (
          <div className="flex justify-center mb-2">
            <img src={settings.sidebarLogoUrl} alt="Logo" className="max-h-12 max-w-[120px] object-contain" referrerPolicy="no-referrer" loading="lazy" decoding="async"
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
            />
          </div>
        )}
        <p className="text-xs font-extrabold tracking-wide uppercase text-gray-900">{settings.restaurantName || 'THE ROYAL BISTRO'}</p>
        <p className="text-[8px] text-gray-500 leading-tight">{settings.address || 'Shop No. 12, Ground Floor, Fluent Horizon Plaza, Mumbai 400001'}</p>
        <p className="text-[8px] text-gray-500 leading-tight">Phone: {settings.phone || '+91 22 2200 4400'}</p>
        <p className="text-[8px] text-gray-500 font-bold uppercase">GSTIN: {settings.gstin || '27AAAAA1111A1Z1'}</p>
        <div className="border-b border-dashed border-gray-300 pt-1"></div>
      </div>

      {/* Ticket Info */}
      <div className="w-full space-y-0.5 pt-1">
        <div className="flex justify-between">
          <span>INVOICE:</span>
          <span className="font-bold">{bill.invoiceNumber}{settings.invoiceSuffix ? ` ${settings.invoiceSuffix}` : ''}</span>
        </div>
        <div className="flex justify-between">
          <span>TICKET:</span>
          <span className="font-bold">{bill.ticketNumber}</span>
        </div>
        <div className="flex justify-between">
          <span>DATE:</span>
          <span>{bill.date}  {bill.time}</span>
        </div>
        {settings.showOrderTime !== false && bill.createdAt && (
          <div className="flex justify-between">
            <span>ORDER TIME:</span>
            <span>{new Date(bill.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
        )}
        {settings.showTableNumber !== false && bill.tableNumber && (
          <div className="flex justify-between font-bold">
            <span>TABLE:</span>
            <span>T{bill.tableNumber}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span>CASHIER:</span>
          <span>{bill.cashierName} ({bill.cashierRole})</span>
        </div>
        <div className="flex justify-between">
          <span>ORDER TYPE:</span>
          <span className="font-bold uppercase">{bill.orderType}</span>
        </div>
        {settings.showCustomerNameOnReceipt !== false && bill.customerName && (
          <div className="flex justify-between font-bold border border-dashed border-black p-1 mt-1">
            <span>LOYALTY MEMB:</span>
            <span>{bill.customerName}</span>
          </div>
        )}
      </div>

      {/* Items table */}
      <div className="w-full pt-2 border-t border-dashed border-gray-300">
        <div className="flex justify-between font-bold text-gray-900 text-[9px] pb-1">
          <span className="w-1/2 text-left">ITEM</span>
          <span className="w-1/6 text-center">QTY</span>
          <span className="w-1/3 text-right">TOTAL</span>
        </div>
        <div className="border-b border-dashed border-gray-300 my-1" />

        {(() => {
          const activeItems = bill.items.filter((item: any) => !item.cancelled);
          const cancelledItems = bill.items.filter((item: any) => item.cancelled);
          const shouldGroupByCategory = settings.printCategoryHeaders === true;

          // Group items by category if settings require it
          const groupedItems: Record<string, any[]> = {};
          if (shouldGroupByCategory) {
            activeItems.forEach((item: any) => {
              const cat = item.product?.category || 'General';
              if (!groupedItems[cat]) groupedItems[cat] = [];
              groupedItems[cat].push(item);
            });
          }

          const renderItem = (item: any) => (
            <div key={item.id} className="flex justify-between items-start">
              <span className="w-1/2 text-left font-bold">
                {item.isFree && <span className="text-emerald-700 font-extrabold mr-1">[FREE]</span>}
                {item.product.name}
                {settings.showItemModifiers !== false && item.selectedVariant && (
                  <span className="block text-[8px] text-gray-500 font-normal">- {item.selectedVariant.name}</span>
                )}
                {item.notes && (
                  <span className="block text-[8px] text-gray-400 font-normal italic">*Note: {item.notes}</span>
                )}
              </span>
              <span className="w-1/6 text-center">{item.quantity}</span>
              <span className="w-1/3 text-right font-bold">
                {item.isFree ? (
                  <span className="text-emerald-700 font-extrabold">FREE</span>
                ) : (
                  `${sym}${(item.price * item.quantity).toFixed(2)}`
                )}
              </span>
            </div>
          );

          return (
            <>
              {/* Active items — optionally grouped by category */}
              {shouldGroupByCategory
                ? Object.entries(groupedItems).map(([category, items]) => (
                    <div key={category} className="mb-2">
                      <p className="text-[8px] font-bold text-gray-500 uppercase tracking-wider mb-0.5 border-b border-gray-200 pb-0.5">
                        — {category} —
                      </p>
                      {items.map((item: any) => renderItem(item))}
                    </div>
                  ))
                : activeItems.map((item: any) => renderItem(item))}
              {/* Cancelled items section */}
              {cancelledItems.length > 0 && (
                <div className="pt-2 mt-2 border-t border-dashed border-red-200">
                  <p className="text-[8px] font-bold text-red-600 uppercase tracking-wider mb-1">CANCELLED ITEMS</p>
                  {cancelledItems.map((item: any) => (
                    <div key={item.id} className="flex justify-between items-start opacity-60">
                      <span className="w-2/3 text-left font-bold line-through text-gray-400">
                        {item.product.name}
                        {settings.showItemModifiers !== false && item.selectedVariant && (
                          <span className="block text-[8px] text-gray-400 font-normal">- {item.selectedVariant.name}</span>
                        )}
                        {item.cancelReason && (
                          <span className="block text-[7px] text-red-500 font-bold not-italic line-through-none">
                            CANCELLED: {item.cancelReason}
                          </span>
                        )}
                      </span>
                      <span className="w-1/6 text-center text-gray-400 line-through">{item.quantity}</span>
                      <span className="w-1/6 text-right text-gray-400 line-through">
                        {sym}0.00
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          );
        })()}
      </div>

      {/* Cost Calculations */}
      <div className="w-full pt-2 border-t border-dashed border-gray-300 space-y-1">
        <div className="flex justify-between">
          <span>SUBTOTAL:</span>
          <span>{sym}{bill.subtotal.toFixed(2)}</span>
        </div>
        {settings.showDiscountBreakdownOnReceipt !== false && bill.discount > 0 && (
          <div className="flex justify-between font-bold text-blue-700">
            <span>DISCOUNT REDEEMED:</span>
            <span>-{sym}{bill.discount.toFixed(2)}</span>
          </div>
        )}
        {bill.gst > 0 && settings.showTaxSummaryOnReceipt !== false && (
          <>
            <div className="flex justify-between text-[8px] text-gray-500">
              <span>CGST ({halfTaxRate}%):</span>
              <span>{sym}{splitTaxAmount.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-[8px] text-gray-500">
              <span>SGST ({halfTaxRate}%):</span>
              <span>{sym}{splitTaxAmount.toFixed(2)}</span>
            </div>
          </>
        )}
        {roundOffActive && finalRoundOff !== 0 && (
          <div className="flex justify-between text-[8px] text-gray-500">
            <span>ROUND OFF:</span>
            <span>{sym}{finalRoundOff.toFixed(2)}</span>
          </div>
        )}
        <div className="border-b border-dashed border-gray-300 my-1" />
        <div className="flex justify-between font-black text-xs text-gray-950 pt-0.5">
          <span>NET TOTAL:</span>
          <span>{sym}{finalGrandTotal.toFixed(2)}</span>
        </div>
      </div>

      <div className="border-b border-dashed border-gray-300 my-2 w-full" />

      <div className="w-full text-left space-y-1">
        <div className="font-bold">PAYMENT TYPE: {bill.paymentMethod.toUpperCase()}</div>
        {bill.paymentMethod === 'Split' && bill.splitDetails && (
          <div className="pl-2 space-y-0.5 text-[8.5px]">
            {(bill.splitDetails.cashAmount || 0) > 0 && (
              <div className="flex justify-between">
                <span>- CASH:</span>
                <span>{sym}{bill.splitDetails.cashAmount.toFixed(2)}</span>
              </div>
            )}
            {((bill.splitDetails as any).upiAmount || 0) > 0 && (
              <div className="flex justify-between">
                <span>- UPI:</span>
                <span>{sym}{((bill.splitDetails as any).upiAmount || 0).toFixed(2)}</span>
              </div>
            )}
            {(bill.splitDetails.cardAmount || 0) > 0 && (
              <div className="flex justify-between">
                <span>- CARD:</span>
                <span>{sym}{bill.splitDetails.cardAmount.toFixed(2)}</span>
              </div>
            )}
            {((bill.splitDetails as any).walletAmount || 0) > 0 && (
              <div className="flex justify-between">
                <span>- WALLET:</span>
                <span>{sym}{((bill.splitDetails as any).walletAmount || 0).toFixed(2)}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Loyalty summary box */}
      {settings.showCustomerNameOnReceipt !== false && settings.showLoyaltyPointsOnReceipt !== false && bill.customerPhone && (
        <div className="w-full border-2 border-dashed border-gray-300 p-2 rounded text-center my-2 space-y-1 bg-gray-50 text-[8px]">
          <p className="font-bold tracking-wide">LOYALTY REWARDS SUMMARY</p>
          <div className="flex justify-between text-[8px] px-1">
            <span>Points Redeemed:</span>
            <span className="font-bold">{bill.pointsRedeemed} pts</span>
          </div>
          {settings.showLoyaltyPointsEarnedOnReceipt !== false && (
            <div className="flex justify-between text-[8px] px-1">
              <span>Points Accumulated:</span>
              <span className="font-bold">+{bill.pointsEarned} pts</span>
            </div>
          )}
          {bill.redeemedRewardTitle && (
            <p className="text-[7.5px] font-semibold text-green-700 uppercase mt-0.5">
              Redeemed: {bill.redeemedRewardTitle}
            </p>
          )}
          {bill.milestoneRewardAwarded && (
            <div className="mt-1.5 border-t border-dashed border-gray-300 pt-1 text-center">
              <p className="text-[7.5px] font-extrabold text-[var(--brand-color)] uppercase leading-tight">
                🎁 MILESTONE REWARD EARNED:
              </p>
              <p className="text-[8px] font-black text-gray-950 uppercase mt-0.5 leading-tight">
                {bill.milestoneRewardAwarded}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Scan QR Code */}
      {settings.showQrCodeOnReceipt !== false && (
        <div className="flex flex-col items-center justify-center my-3 text-center w-full">
          <p className="font-bold mb-1.5 text-[8px] tracking-wide">SCAN TO CLAIM DISCOUNTS & STAMPS</p>

          {/* Fixed-size wrapper container to prevent browser printing engine width/scaling overflow bugs */}
          <div
            className="p-1.5 bg-white border border-gray-200 rounded-lg shadow-xs flex items-center justify-center"
            style={{
              width: settings.printSize === '58mm' ? '64px' : '80px',
              height: settings.printSize === '58mm' ? '64px' : '80px',
            }}
          >
            {/* Inline SVG QR Code (Clean & Fast rendering) */}
<svg className="w-full h-full" viewBox="0 0 100 100">
              <rect width="100" height="100" fill="#ffffff" />
              <rect x="5" y="5" width="25" height="25" fill="#000000" />
              <rect x="10" y="10" width="15" height="15" fill="#ffffff" />
              <rect x="13" y="13" width="9" height="9" fill="#000000" />

              <rect x="70" y="5" width="25" height="25" fill="#000000" />
              <rect x="75" y="10" width="15" height="15" fill="#ffffff" />
              <rect x="78" y="13" width="9" height="9" fill="#000000" />

              <rect x="5" y="70" width="25" height="25" fill="#000000" />
              <rect x="10" y="75" width="15" height="15" fill="#ffffff" />
              <rect x="13" y="78" width="9" height="9" fill="#000000" />

              <rect x="40" y="10" width="5" height="10" fill="#000000" />
              <rect x="50" y="5" width="10" height="5" fill="#000000" />
              <rect x="45" y="20" width="15" height="5" fill="#000000" />
              <rect x="35" y="30" width="5" height="15" fill="#000000" />

              <rect x="40" y="55" width="10" height="5" fill="#000000" />
              <rect x="55" y="45" width="15" height="10" fill="#000000" />
              <rect x="35" y="65" width="15" height="5" fill="#000000" />

              <rect x="70" y="40" width="10" height="15" fill="#000000" />
              <rect x="85" y="55" width="10" height="5" fill="#000000" />
              <rect x="80" y="70" width="15" height="15" fill="#000000" />
              <rect x="85" y="75" width="5" height="5" fill="#ffffff" />
            </svg>
          </div>

          <p className="text-[7.5px] text-gray-500 mt-1.5 max-w-[180px] mx-auto leading-tight">
            Open smartphone camera & scan to claim points & discounts.
          </p>
        </div>
      )}

      {/* Thank you note */}
      <div className="text-center w-full pt-2 space-y-1.5">
        {settings.receiptFooterMessage ? (
          <div className="whitespace-pre-wrap text-[9px] font-bold text-gray-800 leading-normal uppercase">
            {settings.receiptFooterMessage}
          </div>
        ) : (
          <div className="flex items-center justify-center gap-1 font-bold text-gray-800">
            <span>THANK YOU FOR DINING WITH US!</span>
            <Heart className="w-3 h-3 text-red-500 fill-red-500" />
          </div>
        )}

        {settings.receiptFooterImageUrl && (
          <div className="my-2 max-w-full flex justify-center">
            <img
              src={settings.receiptFooterImageUrl}
              alt="Footer Banner"
              className="max-h-16 w-auto object-contain rounded border border-gray-200"
              referrerPolicy="no-referrer"
              loading="lazy"
              decoding="async"
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
            />
          </div>
        )}

        <p className="text-[7px] text-gray-400 font-sans">Powered by Royal Loyalty POS Engine</p>
      </div>

      {/* Footer Tear Effect */}
      <div className="border-t border-dashed border-gray-300 pt-1 mt-2 w-full"></div>
    </div>
  );
}
