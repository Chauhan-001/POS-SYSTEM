/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useCallback, useEffect } from 'react';
import { X, Printer, CheckCircle, Share2, ArrowLeft, Download, Receipt, Eye, Timer } from 'lucide-react';
import { Bill, SystemSettings } from '../src/types';
import ThermalReceipt from './ThermalReceipt';

interface ReceiptModalProps {
  bill: Bill;
  settings: SystemSettings;
  onClose: () => void;
  onNewOrder: () => void;
  autoPrint?: boolean;
  /** Live running-bill preview (before final payment) — hides payment-complete chrome */
  isPreview?: boolean;
  /** Reopens the existing table order in billing (preview mode only) */
  onOpenBilling?: () => void;
}

export default function ReceiptModal({ bill, settings, onClose, onNewOrder, autoPrint, isPreview, onOpenBilling }: ReceiptModalProps) {
  const receiptRef = useRef<HTMLDivElement>(null);
  const hasAutoPrinted = useRef(false);

  // Auto-print receipt on mount when autoPrint is true (e.g. after payment)
  useEffect(() => {
    if (autoPrint && !hasAutoPrinted.current) {
      hasAutoPrinted.current = true;
      setTimeout(() => window.print(), 400);
    }
  }, [autoPrint]);

  const handlePrint = () => {
    window.print();
  };

  const handleDownloadPDF = useCallback(() => {
    // Render receipt in a hidden iframe and trigger print-to-PDF
    // This allows users to select "Save as PDF" from the print dialog
    // with the invoice number as the suggested filename
    if (!receiptRef.current) return;

    const printWindow = window.open('', '_blank', 'width=400,height=600');
    if (!printWindow) {
      // Fallback if popup blocked: use main window with filename hint
      document.title = `Receipt_${bill.invoiceNumber || 'invoice'}`;
      window.print();
      return;
    }

    const receiptHtml = receiptRef.current.innerHTML;
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Receipt_${bill.invoiceNumber || 'invoice'}</title>
        <style>
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          body {
            margin: 0;
            padding: 20px;
            display: flex;
            justify-content: center;
            font-family: 'Courier New', monospace;
            background: white;
          }
          .receipt-wrapper {
            max-width: 280px;
            width: 100%;
          }
          img { max-width: 100%; }
          @media print {
            body { padding: 0; }
            @page { margin: 0; }
          }
        </style>
      </head>
      <body>
        <div class="receipt-wrapper">${receiptHtml}</div>
        <script>
          // Auto-trigger print when content loads, then close after print/cancel
          window.onload = function() {
            setTimeout(function() {
              window.print();
            }, 300);
            setTimeout(function() {
              window.close();
            }, 10000);
          };
          window.onafterprint = function() {
            window.close();
          };
        <\/script>
      </body>
      </html>
    `);
    printWindow.document.close();
  }, [bill.invoiceNumber, receiptRef]);

  return (
    <div className="fixed inset-0 bg-[#191b23]/75 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto print-container-modal">
      <style>{`
        @media print {
          /* Force exact print colors so background graphics are printed */
          * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          
          /* Hide main app contents behind the modal */
          #root > div:not(.print-container-modal) {
            display: none !important;
          }
          
          /* Hide modal non-print elements */
          .print-modal-chrome {
            display: none !important;
          }
          
          /* Setup main print container layout */
          .print-container-modal {
            position: absolute !important;
            inset: 0 !important;
            background: #ffffff !important;
            padding: 0 !important;
            margin: 0 !important;
            display: block !important;
            overflow: visible !important;
            width: 100% !important;
            height: auto !important;
          }
          
          /* Modal internal body container */
          .print-container-modal > div {
            box-shadow: none !important;
            border: none !important;
            width: 100% !important;
            max-width: 100% !important;
            height: auto !important;
            max-height: none !important;
            background: #ffffff !important;
            display: block !important;
            overflow: visible !important;
          }
          
          .print-receipt-scroll-container {
            padding: 0 !important;
            background: #ffffff !important;
            display: block !important;
            overflow: visible !important;
          }
          
          /* Full width and white background for paper */
          .print-receipt-only {
            border: none !important;
            box-shadow: none !important;
            width: 100% !important;
            max-width: 100% !important;
            padding: 20px !important;
            margin: 0 auto !important;
            background: #ffffff !important;
            display: flex !important;
          }
        }
      `}</style>
      <div className="bg-[#f3f3fe] rounded-xl shadow-2xl max-w-lg w-full flex flex-col max-h-[90vh] overflow-hidden border border-[#e1e2ed]">
        
        {/* Header bar */}
        <div className="bg-white px-6 py-4 border-b border-[#e1e2ed] flex justify-between items-center print-modal-chrome">
          <div className="flex items-center gap-2">
            {isPreview ? <Eye className="w-5 h-5 text-blue-600" /> : <CheckCircle className="w-5 h-5 text-green-600" />}
            <div>
              <h2 className="text-md font-bold text-gray-900">{isPreview ? 'Live Bill Preview' : 'Payment Complete - Invoice Generated'}</h2>
              {isPreview && (
                <span className="inline-flex items-center gap-1 mt-0.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-full px-2 py-0.5 text-[9px] font-bold">
                  <Timer className="w-3 h-3 animate-pulse" />
                  RUNNING BILL — {bill.tableNumber ? `Table T${bill.tableNumber}` : 'not final'} · updates live
                </span>
              )}
            </div>
          </div>
          <button 
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 focus:outline-none cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Action Panel */}
        <div className="p-4 bg-[#e7e7f3] border-b border-[#e1e2ed] flex gap-3 justify-center print-modal-chrome">
          <button
            onClick={handlePrint}
            className="flex items-center gap-2 bg-[#004ac6] hover:bg-[#003ea8] text-white px-4 py-2 rounded-lg font-semibold text-xs transition-colors shadow-md cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            {isPreview ? 'Print Running Bill' : `Print (${settings.printSize})`}
          </button>

          {!isPreview && (
            <button
              onClick={handleDownloadPDF}
              className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white px-4 py-2 rounded-lg font-semibold text-xs transition-colors shadow-md cursor-pointer"
            >
              <Download className="w-4 h-4" />
              Download PDF
            </button>
          )}
          
          {isPreview ? (
            <button
              onClick={onOpenBilling || onClose}
              className="flex items-center gap-2 bg-blue-700 hover:bg-blue-800 text-white px-4 py-2 rounded-lg font-semibold text-xs transition-colors shadow-md cursor-pointer"
            >
              <Receipt className="w-4 h-4" />
              Open Billing
            </button>
          ) : (
            <button
              onClick={onNewOrder}
              className="flex items-center gap-2 bg-green-700 hover:bg-green-800 text-white px-4 py-2 rounded-lg font-semibold text-xs transition-colors shadow-md cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              New POS Order
            </button>
          )}
        </div>

        {/* Scrollable Receipt Body */}
        <div className="flex-1 overflow-y-auto p-6 flex justify-center items-start bg-gray-100 print-receipt-scroll-container">
          
          {/* Thermal Paper Emulation — shared with the Settings live preview (ThermalReceipt) */}
          <ThermalReceipt bill={bill} settings={settings} receiptRef={receiptRef} />

        </div>
      </div>
    </div>
  );
}
