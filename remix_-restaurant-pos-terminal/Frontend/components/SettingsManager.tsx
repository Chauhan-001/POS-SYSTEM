/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { 
  Wifi, 
  RotateCcw, 
  Printer, 
  Trash2, 
  Plus, 
  Info, 
  FileText, 
  CheckCircle, 
  Utensils, 
  ChevronDown, 
  User, 
  Check, 
  Save, 
  Search, 
  X,
  FileSignature,
  Heart,
  Upload,
  QrCode,
  Layers,
  Table,
  Users,
  CalendarCheck,
  ScanLine,
  Truck,
  Globe,
  Monitor,
  Gift
} from 'lucide-react';
import { SystemSettings, VisitMilestone } from '../src/types';

interface SettingsManagerProps {
  settings: SystemSettings;
  onUpdateSettings: (updated: SystemSettings) => void;
}

export default function SettingsManager({ settings, onUpdateSettings }: SettingsManagerProps) {
  // Navigation State for the sub-tabs shown in the screenshots
  const [activeSubTab, setActiveSubTab] = useState<'billing' | 'kitchen' | 'modules'>('billing');

  // Module Settings State — which restaurant features are enabled
  const defaultModuleSettings = {
    enableTableService: true,
    enableWaiterManagement: true,
    enableReservations: false,
    enableQROrdering: false,
    enableDeliveryModule: true,
    enableOnlineOrders: true,
    enableKitchenDisplay: true,
    enableLoyalty: true,
    showImagesInBilling: true,
  };
  const [moduleSettings, setModuleSettings] = useState({ ...defaultModuleSettings, ...(settings.moduleSettings || {}) });

  // Toggle helper for module switches
  const toggleModule = (key: keyof typeof moduleSettings) => {
    setModuleSettings(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // Form States - Billing & Invoice
  const [restName, setRestName] = useState(settings.restaurantName || 'The Grand Bistro');
  const [address, setAddress] = useState(settings.address || 'Shop No. 12, Ground Floor, Fluent Horizon Plaza, Mumbai 400001');
  const [phone, setPhone] = useState(settings.phone || '+91 22 2200 4400');
  const [sidebarLogoUrl, setSidebarLogoUrl] = useState(settings.sidebarLogoUrl || '');
  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const processFile = (file: File) => {
    if (file.size > 2 * 1024 * 1024) {
      alert('File is too large. Please upload an image smaller than 2MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      if (event.target?.result) {
        setSidebarLogoUrl(event.target.result as string);
        showToastNotification('Brand logo uploaded successfully from device!');
      }
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      processFile(file);
    } else {
      alert('Please drop an image file.');
    }
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const handleRemoveLogo = () => {
    setSidebarLogoUrl('');
    showToastNotification('Brand logo removed.');
  };

  const handleFooterBannerUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFooterFile(file);
    }
  };

  const processFooterFile = (file: File) => {
    if (file.size > 2 * 1024 * 1024) {
      alert('File is too large. Please upload an image smaller than 2MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      if (event.target?.result) {
        setReceiptFooterImageUrl(event.target.result as string);
        showToastNotification('Receipt footer banner uploaded successfully!');
      }
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveFooterBanner = () => {
    setReceiptFooterImageUrl('');
    showToastNotification('Receipt footer banner removed.');
  };
  const [gstin, setGstin] = useState(settings.gstin || '27AAAAA0000A1Z5');
  const [taxRate, setTaxRate] = useState<number>(settings.defaultTaxRate ?? 5);
  const [taxPresets, setTaxPresets] = useState<number[]>([5, 12, 18]);
  const [isAddingTaxPreset, setIsAddingTaxPreset] = useState(false);
  const [newTaxPresetValue, setNewTaxPresetValue] = useState('');

  const [invoicePrefix, setInvoicePrefix] = useState(settings.invoicePrefix ?? 'INV-');
  const [invoiceStartingNumber, setInvoiceStartingNumber] = useState(settings.invoiceStartingNumber ?? 1024);
  const [invoiceSuffix, setInvoiceSuffix] = useState(settings.invoiceSuffix ?? '-24');

  const [showCustomerName, setShowCustomerName] = useState(settings.showCustomerNameOnReceipt ?? true);
  const [showLoyaltyPoints, setShowLoyaltyPoints] = useState(settings.showLoyaltyPointsOnReceipt ?? true);
  const [showQrCode, setShowQrCode] = useState(settings.showQrCodeOnReceipt ?? true);
  const [showDiscountBreakdown, setShowDiscountBreakdown] = useState(settings.showDiscountBreakdownOnReceipt ?? true);
  const [printLogoOnReceipt, setPrintLogoOnReceipt] = useState(settings.printLogoOnReceipt ?? true);
  const [roundOffTotal, setRoundOffTotal] = useState(settings.roundOffTotal ?? false);
  const [printSize, setPrintSize] = useState<'58mm' | '80mm'>(settings.printSize || '80mm');

  // Custom Footer & Advanced Section Toggles
  const [showTaxSummary, setShowTaxSummary] = useState(settings.showTaxSummaryOnReceipt ?? true);
  const [showLoyaltyPointsEarned, setShowLoyaltyPointsEarned] = useState(settings.showLoyaltyPointsEarnedOnReceipt ?? true);
  const [receiptFooterMessage, setReceiptFooterMessage] = useState(settings.receiptFooterMessage ?? 'THANK YOU FOR DINING WITH US!');
  const [receiptFooterImageUrl, setReceiptFooterImageUrl] = useState(settings.receiptFooterImageUrl ?? '');
  const [isDraggingFooter, setIsDraggingFooter] = useState(false);

  // Form States - KOT & Kitchen Configuration
  const [printCategoryHeaders, setPrintCategoryHeaders] = useState(settings.printCategoryHeaders ?? true);
  const [showItemModifiers, setShowItemModifiers] = useState(settings.showItemModifiers ?? true);
  const [showOrderTime, setShowOrderTime] = useState(settings.showOrderTime ?? true);
  const [showTableNumber, setShowTableNumber] = useState(settings.showTableNumber ?? true);
  const [groupItemsInKOT, setGroupItemsInKOT] = useState(settings.groupItemsInKOT ?? true);
  const [kotFooterNote, setKotFooterNote] = useState(settings.kotFooterNote ?? 'Cook with passion!');

  // Printer Routing Rules
  const [routingRules, setRoutingRules] = useState<Array<{ id: string; categoryGroup: string; destinationPrinter: string }>>(
    settings.printerRoutingRules ?? [
      { id: 'pr1', categoryGroup: 'Food (All)', destinationPrinter: 'Kitchen Printer (IP: 192.168.1.42)' },
      { id: 'pr2', categoryGroup: 'Drinks & Beverages', destinationPrinter: 'Bar Printer (IP: 192.168.1.45)' }
    ]
  );

  // Options for Printer Routing dropdowns
  const categoryGroups = ['Food (All)', 'Drinks & Beverages', 'Desserts', 'Appetizers', 'Pizza Station', 'Bakery'];
  const destinationPrinters = [
    'Kitchen Printer (IP: 192.168.1.42)',
    'Bar Printer (IP: 192.168.1.45)',
    'Dessert Station Printer (IP: 192.168.1.48)',
    'Pizza Station Printer (IP: 192.168.1.41)',
    'Billing Counter Thermal (IP: 192.168.1.30)'
  ];

  // Toast / Notification state for instant client-side feedback
  const [localToast, setLocalToast] = useState<string | null>(null);

  const showToastNotification = (msg: string) => {
    setLocalToast(msg);
    setTimeout(() => {
      setLocalToast(null);
    }, 3000);
  };

  // Add tax preset helper
  const handleAddTaxPreset = () => {
    const value = parseFloat(newTaxPresetValue);
    if (!isNaN(value) && value >= 0 && value <= 100) {
      if (!taxPresets.includes(value)) {
        setTaxPresets([...taxPresets, value].sort((a, b) => a - b));
      }
      setTaxRate(value);
      setIsAddingTaxPreset(false);
      setNewTaxPresetValue('');
      showToastNotification(`Added tax rate preset: ${value}%`);
    } else {
      alert('Please enter a valid tax percentage between 0 and 100.');
    }
  };

  // Routing Rules helper
  const handleAddRoutingRule = () => {
    const newRule = {
      id: `rule_${Date.now()}`,
      categoryGroup: 'Food (All)',
      destinationPrinter: 'Kitchen Printer (IP: 192.168.1.42)'
    };
    setRoutingRules([...routingRules, newRule]);
    showToastNotification('New printer routing rule added.');
  };

  const handleDeleteRoutingRule = (id: string) => {
    setRoutingRules(routingRules.filter(r => r.id !== id));
    showToastNotification('Printer routing rule removed.');
  };

  const handleUpdateRule = (id: string, field: 'categoryGroup' | 'destinationPrinter', value: string) => {
    setRoutingRules(routingRules.map(r => r.id === id ? { ...r, [field]: value } : r));
  };

  // Save Settings Submit Handler
  const handleSaveSettings = (e: React.FormEvent) => {
    e.preventDefault();

    const updated: SystemSettings = {
      ...settings,
      restaurantName: restName.trim(),
      address: address.trim(),
      phone: phone.trim(),
      gstin: gstin.trim(),
      defaultTaxRate: Number(taxRate),
      invoicePrefix: invoicePrefix.trim(),
      invoiceStartingNumber: Number(invoiceStartingNumber),
      invoiceSuffix: invoiceSuffix.trim(),
      showCustomerNameOnReceipt: showCustomerName,
      showLoyaltyPointsOnReceipt: showLoyaltyPoints,
      showQrCodeOnReceipt: showQrCode,
      showDiscountBreakdownOnReceipt: showDiscountBreakdown,
      printLogoOnReceipt: printLogoOnReceipt,
      printCategoryHeaders: printCategoryHeaders,
      showItemModifiers: showItemModifiers,
      showOrderTime: showOrderTime,
      showTableNumber: showTableNumber,
      printerRoutingRules: routingRules,
      sidebarLogoUrl: sidebarLogoUrl.trim(),
      roundOffTotal: roundOffTotal,
      groupItemsInKOT: groupItemsInKOT,
      kotFooterNote: kotFooterNote.trim(),
      printSize: printSize,
      showTaxSummaryOnReceipt: showTaxSummary,
      showLoyaltyPointsEarnedOnReceipt: showLoyaltyPointsEarned,
      receiptFooterMessage: receiptFooterMessage.trim(),
      receiptFooterImageUrl: receiptFooterImageUrl.trim(),
      moduleSettings,
    };

    onUpdateSettings(updated);
    showToastNotification('Configuration saved successfully!');
  };

  // Discard changes / reset form
  const handleDiscardChanges = () => {
    setRestName(settings.restaurantName || 'The Grand Bistro');
    setAddress(settings.address || 'Shop No. 12, Ground Floor, Fluent Horizon Plaza, Mumbai 400001');
    setPhone(settings.phone || '+91 22 2200 4400');
    setSidebarLogoUrl(settings.sidebarLogoUrl || '');
    setGstin(settings.gstin || '27AAAAA0000A1Z5');
    setTaxRate(settings.defaultTaxRate ?? 5);
    setInvoicePrefix(settings.invoicePrefix ?? 'INV-');
    setInvoiceStartingNumber(settings.invoiceStartingNumber ?? 1024);
    setInvoiceSuffix(settings.invoiceSuffix ?? '-24');
    setShowCustomerName(settings.showCustomerNameOnReceipt ?? true);
    setShowLoyaltyPoints(settings.showLoyaltyPointsOnReceipt ?? true);
    setShowQrCode(settings.showQrCodeOnReceipt ?? true);
    setShowDiscountBreakdown(settings.showDiscountBreakdownOnReceipt ?? true);
    setPrintLogoOnReceipt(settings.printLogoOnReceipt ?? true);
    setRoundOffTotal(settings.roundOffTotal ?? false);
    setPrintCategoryHeaders(settings.printCategoryHeaders ?? true);
    setShowItemModifiers(settings.showItemModifiers ?? true);
    setShowOrderTime(settings.showOrderTime ?? true);
    setShowTableNumber(settings.showTableNumber ?? true);
    setGroupItemsInKOT(settings.groupItemsInKOT ?? true);
    setKotFooterNote(settings.kotFooterNote ?? 'Cook with passion!');
    setRoutingRules(settings.printerRoutingRules ?? [
      { id: 'pr1', categoryGroup: 'Food (All)', destinationPrinter: 'Kitchen Printer (IP: 192.168.1.42)' },
      { id: 'pr2', categoryGroup: 'Drinks & Beverages', destinationPrinter: 'Bar Printer (IP: 192.168.1.45)' }
    ]);
    setPrintSize(settings.printSize || '80mm');
    setShowTaxSummary(settings.showTaxSummaryOnReceipt ?? true);
    setShowLoyaltyPointsEarned(settings.showLoyaltyPointsEarnedOnReceipt ?? true);
    setReceiptFooterMessage(settings.receiptFooterMessage ?? 'THANK YOU FOR DINING WITH US!');
    setReceiptFooterImageUrl(settings.receiptFooterImageUrl ?? '');
    setModuleSettings({ ...defaultModuleSettings, ...(settings.moduleSettings || {}) });
    showToastNotification('Changes discarded. Resetting to active configurations.');
  };

  // Helper calculations for dynamic live receipt preview (replaces static values)
  const previewSubtotal = 2700.00;
  const previewDiscount = showDiscountBreakdown ? 300.00 : 0.00;
  const previewTaxable = previewSubtotal - previewDiscount;
  const previewCGST = parseFloat(((previewTaxable * (taxRate / 2)) / 100).toFixed(2));
  const previewSGST = previewCGST;
  const previewGrandTotalRaw = previewTaxable + previewCGST + previewSGST;
  const previewGrandTotal = roundOffTotal ? Math.round(previewGrandTotalRaw) : parseFloat(previewGrandTotalRaw.toFixed(2));
  const previewRoundOff = roundOffTotal ? parseFloat((Math.round(previewGrandTotalRaw) - previewGrandTotalRaw).toFixed(2)) : 0.00;

  // Custom print simulation engine
  const printContent = (htmlContent: string) => {
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (doc) {
      doc.open();
      doc.write(`
        <html>
          <head>
            <title>Thermal Terminal Print Job</title>
            <style>
              @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700;800&display=swap');
              body {
                margin: 0;
                padding: ${printSize === '58mm' ? '6px' : '10px'};
                font-family: 'JetBrains Mono', monospace;
                font-size: ${printSize === '58mm' ? '9px' : '11px'};
                color: black;
                background: white;
                width: ${printSize === '58mm' ? '210px' : '300px'};
              }
              * {
                box-sizing: border-box;
              }
              img {
                max-height: 50px;
                max-width: 150px;
                object-fit: contain;
                display: block;
                margin: 0 auto;
              }
              .text-center { text-align: center; }
              .font-bold { font-weight: bold; }
              .font-black { font-weight: 950; }
              .text-xs { font-size: 10px; }
              .text-sm { font-size: 12px; }
              .text-md { font-size: 14px; }
              .flex { display: flex; }
              .justify-between { justify-content: space-between; }
              .justify-center { justify-content: center; }
              .space-y-1 > * + * { margin-top: 4px; }
              .space-y-2 > * + * { margin-top: 8px; }
              .border-b { border-bottom: 1px dashed black; }
              .my-1 { margin-top: 4px; margin-bottom: 4px; }
              .my-2 { margin-top: 8px; margin-bottom: 8px; }
              .my-3 { margin-top: 12px; margin-bottom: 12px; }
              .pt-1 { padding-top: 4px; }
              .pt-2 { padding-top: 8px; }
              .pt-3 { padding-top: 12px; }
              .pb-1 { padding-bottom: 4px; }
              .p-1 { padding: 4px; }
              .p-2 { padding: 8px; }
              .rounded { border-radius: 4px; }
              .border { border: 1px solid black; }
              .bg-gray-50 { background-color: #f9fafb; }
              .text-red-600 { color: #dc2626; }
              .text-blue-700 { color: #1d4ed8; }
              .pl-3.5 { padding-left: 14px; }
              svg { display: block; margin: 0 auto; }
            </style>
          </head>
          <body>
            ${htmlContent}
            <script>
              window.onload = function() {
                window.print();
                setTimeout(function() {
                  window.parent.document.body.removeChild(window.frameElement);
                }, 500);
              };
            </script>
          </body>
        </html>
      `);
      doc.close();
    }
  };

  const handlePrintTestReceipt = () => {
    const html = `
      <div class="text-center">
        <div class="border-b" style="margin: 6px 0;"></div>
        ${printLogoOnReceipt && sidebarLogoUrl ? `<div class="justify-center flex" style="margin-bottom: 8px;"><img src="${sidebarLogoUrl}" alt="Logo" /></div>` : ''}
        <h3 class="font-bold text-sm uppercase">${restName || 'THE GRAND BISTRO'}</h3>
        <p style="margin: 2px 0;">${address}</p>
        <p style="margin: 2px 0;">Phone: ${phone}</p>
        <p class="font-bold" style="margin: 2px 0;">GSTIN: ${gstin || '27AAAAA0000A1Z5'}</p>
        <div class="border-b my-3"></div>
      </div>

      <div class="space-y-1">
        <div class="flex justify-between">
          <span>INVOICE:</span>
          <span class="font-bold">${invoicePrefix}${invoiceStartingNumber}${invoiceSuffix}</span>
        </div>
        <div class="flex justify-between">
          <span>TICKET:</span>
          <span class="font-bold">TK-1001</span>
        </div>
        <div class="flex justify-between">
          <span>DATE:</span>
          <span>24-MAY-2026 14:42:01</span>
        </div>
        <div class="flex justify-between">
          <span>CASHIER:</span>
          <span>Alex M (Manager)</span>
        </div>
        <div class="flex justify-between">
          <span>ORDER TYPE:</span>
          <span class="font-bold">DINE IN</span>
        </div>
        ${showCustomerName ? `
          <div class="flex justify-between font-bold" style="border: 1px dashed black; padding: 4px; margin-top: 4px;">
            <span>LOYALTY MEMB:</span>
            <span>John Doe</span>
          </div>
        ` : ''}
      </div>

      <div class="border-b my-2"></div>

      <div class="flex justify-between font-bold py-1">
        <span style="width: 50%; text-align: left;">ITEM</span>
        <span style="width: 15%; text-align: center;">QTY</span>
        <span style="width: 35%; text-align: right;">TOTAL</span>
      </div>
      
      <div class="border-b my-1"></div>

      <div class="space-y-1 py-1">
        <div class="flex justify-between">
          <span style="width: 50%; text-align: left;" class="font-bold font-black">Truffle Risotto<span style="display: block; font-size: 9px; font-weight: normal;">-Regular</span></span>
          <span style="width: 15%; text-align: center;">1</span>
          <span style="width: 35%; text-align: right; font-weight: bold;">₹1200.00</span>
        </div>
        <div class="flex justify-between">
          <span style="width: 50%; text-align: left;" class="font-bold font-black">Margherita Pizza<span style="display: block; font-size: 9px; font-weight: normal;">-Medium (10")</span></span>
          <span style="width: 15%; text-align: center;">2</span>
          <span style="width: 35%; text-align: right; font-weight: bold;">₹1500.00</span>
        </div>
      </div>

      <div class="border-b my-2"></div>

      <div class="space-y-1">
        <div class="flex justify-between">
          <span>SUBTOTAL:</span>
          <span>₹${previewSubtotal.toFixed(2)}</span>
        </div>
        ${previewDiscount > 0 ? `
          <div class="flex justify-between font-bold">
            <span>DISCOUNT REDEEMED:</span>
            <span>-₹${previewDiscount.toFixed(2)}</span>
          </div>
        ` : ''}
        <div class="flex justify-between">
          <span>CGST (${(taxRate / 2)}%):</span>
          <span>₹${previewCGST.toFixed(2)}</span>
        </div>
        <div class="flex justify-between">
          <span>SGST (${(taxRate / 2)}%):</span>
          <span>₹${previewSGST.toFixed(2)}</span>
        </div>
        ${roundOffTotal && previewRoundOff !== 0 ? `
          <div class="flex justify-between">
            <span>ROUND OFF:</span>
            <span>₹${previewRoundOff.toFixed(2)}</span>
          </div>
        ` : ''}
        <div class="border-b my-1"></div>
        <div class="flex justify-between font-bold" style="font-size: 13px; padding-top: 4px;">
          <span>NET TOTAL:</span>
          <span>₹${previewGrandTotal.toFixed(2)}</span>
        </div>
      </div>

      <div class="border-b my-2"></div>

      <div class="font-bold">PAYMENT TYPE: SPLIT</div>
      <div style="padding-left: 8px; font-size: 10px;">
        <div class="flex justify-between">
          <span>- CASH:</span>
          <span>₹1000.00</span>
        </div>
        <div class="flex justify-between">
          <span>- UPI:</span>
          <span>₹${(previewGrandTotal - 1000).toFixed(2)}</span>
        </div>
      </div>

      ${showCustomerName && showLoyaltyPoints ? `
        <div class="border font-bold p-2 text-center my-2 bg-gray-50" style="font-size: 10px;">
          <p style="margin: 0 0 4px 0; font-weight: bold;">LOYALTY REWARDS SUMMARY</p>
          <div class="flex justify-between">
            <span>Points Redeemed:</span>
            <span>0 pts</span>
          </div>
          <div class="flex justify-between">
            <span>Points Accumulated:</span>
            <span>+27 pts</span>
          </div>
          <p style="color: green; margin: 4px 0 0 0; font-size: 9px; text-transform: uppercase;">PRE-ACTIVE TIER: PLATINUM</p>
        </div>
      ` : ''}

      ${showQrCode ? `
        <div class="text-center" style="margin-top: 12px;">
          <p style="font-size: 8px; font-weight: bold; margin-bottom: 4px;">SCAN TO VIEW REWARDS</p>
          <div style="display: inline-block; padding: 4px; border: 1px solid black; background: white;">
            <svg width="84" height="84" viewBox="0 0 100 100">
              <rect width="100" height="100" fill="white" />
              <rect x="5" y="5" width="25" height="25" fill="black" />
              <rect x="8" y="8" width="19" height="19" fill="white" />
              <rect x="12" y="12" width="11" height="11" fill="black" />
              <rect x="70" y="5" width="25" height="25" fill="black" />
              <rect x="73" y="8" width="19" height="19" fill="white" />
              <rect x="77" y="12" width="11" height="11" fill="black" />
              <rect x="5" y="70" width="25" height="25" fill="black" />
              <rect x="8" y="73" width="19" height="19" fill="white" />
              <rect x="12" y="77" width="11" height="11" fill="black" />
              <rect x="75" y="75" width="10" height="10" fill="black" />
              <rect x="77" y="77" width="6" height="6" fill="white" />
              <rect x="79" y="79" width="2" height="2" fill="black" />
              <rect x="35" y="5" width="5" height="10" fill="black" />
              <rect x="45" y="10" width="10" height="5" fill="black" />
              <rect x="60" y="5" width="5" height="5" fill="black" />
              <rect x="35" y="20" width="15" height="5" fill="black" />
              <rect x="55" y="25" width="5" height="10" fill="black" />
              <rect x="5" y="35" width="10" height="5" fill="black" />
              <rect x="20" y="35" width="5" height="15" fill="black" />
              <rect x="30" y="35" width="5" height="5" fill="black" />
              <rect x="40" y="40" width="15" height="5" fill="black" />
              <rect x="60" y="35" width="10" height="5" fill="black" />
              <rect x="75" y="35" width="5" height="15" fill="black" />
              <rect x="85" y="45" width="10" height="5" fill="black" />
              <rect x="5" y="55" width="15" height="5" fill="black" />
              <rect x="25" y="55" width="5" height="5" fill="black" />
              <rect x="35" y="50" width="10" height="10" fill="black" />
              <rect x="50" y="55" width="15" height="5" fill="black" />
              <rect x="70" y="55" width="5" height="10" fill="black" />
              <rect x="35" y="65" width="5" height="15" fill="black" />
              <rect x="45" y="70" width="15" height="5" fill="black" />
              <rect x="65" y="75" width="5" height="5" fill="black" />
              <rect x="35" y="85" width="20" height="5" fill="black" />
              <rect x="60" y="85" width="5" height="10" fill="black" />
              <rect x="70" y="85" width="15" height="5" fill="black" />
            </svg>
          </div>
        </div>
      ` : ''}

      <div class="text-center" style="margin-top: 12px; font-size: 9px;">
        <p class="font-bold">Thank You For Dining!</p>
        <p style="margin: 2px 0;">Please visit us again.</p>
        <p style="font-size: 8px; color: #555; margin-top: 6px;">*** END OF TEST RECEIPT ***</p>
      </div>
      <div class="border-b" style="margin: 6px 0;"></div>
    `;
    
    printContent(html);
  };

  const handlePrintTestKOT = () => {
    const html = `
      <div class="text-center">
        <div style="border-bottom: 2px solid black; margin: 6px 0;"></div>
        <h3 class="font-black" style="font-size: 14px; margin: 4px 0;">*** KITCHEN ORDER ***</h3>
        ${showOrderTime ? `<p style="margin: 2px 0; font-size: 9px;">2026-07-17 14:42:01</p>` : ''}
        <div class="border-b my-2"></div>
      </div>

      ${showTableNumber ? `
        <div class="flex justify-between font-bold" style="font-size: 12px; margin-bottom: 8px;">
          <span>TABLE: 04</span>
          <span>SERVER: SARAH</span>
        </div>
      ` : ''}

      <div class="border-b my-1"></div>

      <div class="space-y-2" style="margin-top: 8px;">
        ${printCategoryHeaders ? `
          <p style="font-size: 9px; font-weight: bold; color: #555; text-transform: uppercase; margin: 4px 0;">--- MAIN COURSES ---</p>
          <div style="margin-bottom: 6px;">
            <p class="font-bold" style="font-size: 12px; margin: 2px 0;">2x Margherita Pizza</p>
            ${showItemModifiers ? `<p class="text-red-600 font-bold" style="margin: 0 0 0 14px; font-size: 9px;">- NO ONIONS</p>` : ''}
          </div>
          <div style="margin-bottom: 6px;">
            <p class="font-bold" style="font-size: 12px; margin: 2px 0;">1x Pasta Carbonara</p>
            ${showItemModifiers ? `<p class="text-blue-700 font-bold" style="margin: 0 0 0 14px; font-size: 9px;">- AL DENTE</p>` : ''}
          </div>
        ` : `
          <div style="margin-bottom: 6px;">
            <p class="font-bold" style="font-size: 12px; margin: 2px 0;">2x Margherita Pizza</p>
            ${showItemModifiers ? `<p class="text-red-600 font-bold" style="margin: 0 0 0 14px; font-size: 9px;">- NO ONIONS</p>` : ''}
          </div>
          <div style="margin-bottom: 6px;">
            <p class="font-bold" style="font-size: 12px; margin: 2px 0;">1x Pasta Carbonara</p>
            ${showItemModifiers ? `<p class="text-blue-700 font-bold" style="margin: 0 0 0 14px; font-size: 9px;">- AL DENTE</p>` : ''}
          </div>
        `}
      </div>

      <div class="border-b my-2"></div>

      <div class="text-center" style="margin-top: 12px;">
        ${kotFooterNote ? `<p style="font-size: 10px; font-style: italic; font-weight: bold; color: #1d4ed8; margin-bottom: 8px;">"${kotFooterNote}"</p>` : ''}
        <h3 class="font-black" style="font-size: 13px; margin: 2px 0;">ORDER #8841</h3>
        <p style="font-size: 8px; color: #555;">End of Kitchen Ticket</p>
        <p style="font-size: 8px; color: #555; margin-top: 4px;">*** END OF TEST KOT ***</p>
      </div>
      <div style="border-top: 2px solid black; margin: 6px 0;"></div>
    `;

    printContent(html);
  };

  // Custom QR Code SVG Simulation
  const QRCodeSVG = () => (
<svg width={printSize === '58mm' ? '64' : '84'} height={printSize === '58mm' ? '64' : '84'} viewBox="0 0 100 100" className="mx-auto">
      <rect width="100" height="100" fill="white" />
      {/* Corner markers */}
      <rect x="5" y="5" width="25" height="25" fill="black" />
      <rect x="8" y="8" width="19" height="19" fill="white" />
      <rect x="12" y="12" width="11" height="11" fill="black" />

      <rect x="70" y="5" width="25" height="25" fill="black" />
      <rect x="73" y="8" width="19" height="19" fill="white" />
      <rect x="77" y="12" width="11" height="11" fill="black" />

      <rect x="5" y="70" width="25" height="25" fill="black" />
      <rect x="8" y="73" width="19" height="19" fill="white" />
      <rect x="12" y="77" width="11" height="11" fill="black" />

      {/* Alignment box */}
      <rect x="75" y="75" width="10" height="10" fill="black" />
      <rect x="77" y="77" width="6" height="6" fill="white" />
      <rect x="79" y="79" width="2" height="2" fill="black" />

      {/* Scattered QR pixel data */}
      <rect x="35" y="5" width="5" height="10" fill="black" />
      <rect x="45" y="10" width="10" height="5" fill="black" />
      <rect x="60" y="5" width="5" height="5" fill="black" />
      <rect x="35" y="20" width="15" height="5" fill="black" />
      <rect x="55" y="25" width="5" height="10" fill="black" />
      <rect x="5" y="35" width="10" height="5" fill="black" />
      <rect x="20" y="35" width="5" height="15" fill="black" />
      <rect x="30" y="35" width="5" height="5" fill="black" />
      <rect x="40" y="40" width="15" height="5" fill="black" />
      <rect x="60" y="35" width="10" height="5" fill="black" />
      <rect x="75" y="35" width="5" height="15" fill="black" />
      <rect x="85" y="45" width="10" height="5" fill="black" />
      <rect x="5" y="55" width="15" height="5" fill="black" />
      <rect x="25" y="55" width="5" height="5" fill="black" />
      <rect x="35" y="50" width="10" height="10" fill="black" />
      <rect x="50" y="55" width="15" height="5" fill="black" />
      <rect x="70" y="55" width="5" height="10" fill="black" />
      <rect x="35" y="65" width="5" height="15" fill="black" />
      <rect x="45" y="70" width="15" height="5" fill="black" />
      <rect x="65" y="75" width="5" height="5" fill="black" />
      <rect x="35" y="85" width="20" height="5" fill="black" />
      <rect x="60" y="85" width="5" height="10" fill="black" />
      <rect x="70" y="85" width="15" height="5" fill="black" />
    </svg>
  );

  return (
    <div id="settings_workspace_container" className="flex flex-col h-full bg-[#fbfbff] select-none overflow-hidden">
      
      {/* TOP HEADER COMPONENT (Matching screenshots with wifi, sync, printer icons + profile avatar) */}
      <div className="flex justify-between items-center bg-white px-6 py-4 border-b border-[#e1e2ed]">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-blue-50 text-[#004ac6]">
            {activeSubTab === 'billing' ? (
              <FileText className="w-5 h-5" />
            ) : activeSubTab === 'kitchen' ? (
              <Utensils className="w-5 h-5" />
            ) : (
              <Layers className="w-5 h-5" />
            )}
          </div>
          <div>
            <h1 className="text-md sm:text-lg font-black tracking-tight text-gray-900 font-sans">
              {activeSubTab === 'billing' ? 'Billing & Invoice Settings' : activeSubTab === 'kitchen' ? 'KOT & Kitchen Configuration' : 'Modules & Features'}
            </h1>
            <p className="text-[10px] text-gray-400 font-medium">
              {activeSubTab === 'billing'
                ? 'Manage printing formats, layouts, default GSTIN parameters, and live workstation ticket routing.'
                : activeSubTab === 'kitchen'
                  ? 'Configure KOT layout, printer routing rules, and kitchen display preferences.'
                  : 'Enable or disable restaurant modules to control which features appear in the POS.'}
            </p>
          </div>
        </div>

        {/* Header Actions & Profile removed */}
      </div>

      {/* INTERNAL SUB-TAB NAVIGATION */}
      <div className="bg-white border-b border-[#e1e2ed] flex px-6">
        <button
          type="button"
          onClick={() => setActiveSubTab('billing')}
          className={`px-5 py-3.5 font-bold text-xs tracking-wide transition-all border-b-2 flex items-center gap-2 cursor-pointer ${
            activeSubTab === 'billing'
              ? 'border-[#004ac6] text-[#004ac6]'
              : 'border-transparent text-gray-400 hover:text-gray-600'
          }`}
        >
          <FileText className="w-4 h-4" />
          BILLING & INVOICE
        </button>
        <button
          type="button"
          onClick={() => setActiveSubTab('kitchen')}
          className={`px-5 py-3.5 font-bold text-xs tracking-wide transition-all border-b-2 flex items-center gap-2 cursor-pointer ${
            activeSubTab === 'kitchen'
              ? 'border-[#004ac6] text-[#004ac6]'
              : 'border-transparent text-gray-400 hover:text-gray-600'
          }`}
        >
          <Utensils className="w-4 h-4" />
          KOT & KITCHEN CONFIG
        </button>
        <button
          type="button"
          onClick={() => setActiveSubTab('modules')}
          className={`px-5 py-3.5 font-bold text-xs tracking-wide transition-all border-b-2 flex items-center gap-2 cursor-pointer ${
            activeSubTab === 'modules'
              ? 'border-[#004ac6] text-[#004ac6]'
              : 'border-transparent text-gray-400 hover:text-gray-600'
          }`}
        >
          <Layers className="w-4 h-4" />
          MODULES & FEATURES
        </button>
      </div>

      {/* MAIN CONTAINER CONTENT */}
      <form onSubmit={handleSaveSettings} id="settings_form_workspace" className="flex-1 p-6 flex flex-col gap-6 overflow-hidden min-h-0">
        
        {activeSubTab === 'billing' ? (
          /* BILLING & INVOICE TAB CONTENT */
          <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start overflow-y-auto lg:overflow-hidden min-h-0">
            
            {/* LEFT COLUMN: Input Panels (col-span 7) */}
            <div className="lg:col-span-7 space-y-6 lg:h-full lg:overflow-y-auto pr-2 pb-6">
              
              {/* Card 1: GST Configuration */}
              <div className="bg-white rounded-2xl border border-[#e1e2ed] p-6 shadow-xs space-y-4">
                <div className="flex items-center gap-2 pb-1.5 border-b border-gray-50">
                  <div className="w-2.5 h-2.5 rounded-full bg-[#004ac6]" />
                  <h3 className="font-bold text-gray-900 text-xs uppercase tracking-wider">GST Configuration</h3>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* GSTIN Number */}
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-gray-400 tracking-wider mb-1.5">GSTIN Number</label>
                    <input
                      type="text"
                      value={gstin}
                      onChange={(e) => setGstin(e.target.value.toUpperCase())}
                      className="w-full px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[#004ac6] placeholder-gray-400 uppercase"
                      required
                    />
                  </div>

                  {/* Restaurant Name */}
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-gray-400 tracking-wider mb-1.5">Restaurant Name (Displays Everywhere)</label>
                    <input
                      type="text"
                      value={restName}
                      onChange={(e) => setRestName(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[#004ac6] placeholder-gray-400"
                      required
                    />
                  </div>

                  {/* Restaurant Phone */}
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-gray-400 tracking-wider mb-1.5">Restaurant Phone Number</label>
                    <input
                      type="text"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[#004ac6] placeholder-gray-400"
                      required
                    />
                  </div>

                  {/* Restaurant Address */}
                  <div className="sm:col-span-2">
                    <label className="block text-[10px] font-bold uppercase text-gray-400 tracking-wider mb-1.5">Restaurant Address</label>
                    <input
                      type="text"
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[#004ac6] placeholder-gray-400"
                      required
                    />
                  </div>
                </div>

                {/* Sidebar Brand Logo Device Upload */}
                <div className="pt-3 border-t border-gray-100">
                  <label className="block text-[10px] font-bold uppercase text-gray-400 tracking-wider mb-2">Brand Logo (Left Sidebar & Receipts)</label>
                  <div className="flex flex-col sm:flex-row gap-4 items-center">
                    <div 
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onDrop={handleDrop}
                      className={`flex-1 w-full border-2 border-dashed rounded-2xl p-4 transition-all text-center flex flex-col items-center justify-center cursor-pointer ${
                        isDragging 
                          ? 'border-[#004ac6] bg-blue-50/50' 
                          : 'border-gray-300 hover:border-[#004ac6] hover:bg-gray-50/50'
                      }`}
                      onClick={() => document.getElementById('device-logo-input')?.click()}
                    >
                      <input 
                        type="file" 
                        id="device-logo-input"
                        accept="image/*"
                        className="hidden" 
                        onChange={handleLogoUpload}
                      />
                      <Upload className={`w-6 h-6 mb-1.5 ${isDragging ? 'text-[#004ac6]' : 'text-gray-400'}`} />
                      <p className="text-xs font-bold text-gray-700">
                        Drag & Drop logo here, or <span className="text-[#004ac6] underline">browse device</span>
                      </p>
                      <p className="text-[9px] text-gray-400 mt-1">PNG, JPG, WEBP or SVG (Max 2MB)</p>
                    </div>
                    
                    <div className="flex flex-col items-center gap-2 shrink-0">
                      <div className="w-16 h-16 bg-[#191b23] border border-[#e1e2ed] rounded-xl flex items-center justify-center overflow-hidden shadow-xs relative group">
                        {sidebarLogoUrl ? (
                          <>
                            <img src={sidebarLogoUrl} alt="Logo Preview" className="w-full h-full object-cover" referrerPolicy="no-referrer" loading="lazy" decoding="async" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                          </>
                        ) : (
                          <span className="text-white font-extrabold text-sm tracking-widest">
                            {restName ? restName.split(' ').map(w => w[0]).join('').substring(0, 3).toUpperCase() : 'TRB'}
                          </span>
                        )}
                      </div>
                      {sidebarLogoUrl && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemoveLogo();
                          }}
                          className="px-2 py-1 bg-red-50 text-red-600 rounded text-[9px] font-bold hover:bg-red-100 transition-colors flex items-center gap-1 cursor-pointer"
                        >
                          <Trash2 className="w-2.5 h-2.5" />
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Tax Rate Presets Selector */}
                <div className="pt-2">
                  <label className="block text-[10px] font-bold uppercase text-gray-400 tracking-wider mb-2">Tax Rate Presets</label>
                  <div className="flex flex-wrap items-center gap-3">
                    {taxPresets.map((rate) => (
                      <button
                        key={rate}
                        type="button"
                        onClick={() => setTaxRate(rate)}
                        className={`px-4 py-2 rounded-xl font-bold text-xs transition-all cursor-pointer ${
                          taxRate === rate
                            ? 'bg-[#004ac6] text-white shadow-sm'
                            : 'bg-[#eae9f5] text-[#474087] hover:bg-[#deddf0]'
                        }`}
                      >
                        {rate}% {rate === 5 ? '(Standard)' : rate === 12 ? '(Packaged)' : rate === 18 ? '(Service)' : ''}
                      </button>
                    ))}

                    {/* Inline Custom Tax Addition */}
                    {isAddingTaxPreset ? (
                      <div className="flex items-center gap-1.5 border border-[#c3c6d7] rounded-xl p-1 bg-white">
                        <input
                          type="number"
                          min="0"
                          max="100"
                          value={newTaxPresetValue}
                          onChange={(e) => setNewTaxPresetValue(e.target.value)}
                          className="w-16 px-2 py-1 rounded-lg text-xs font-semibold focus:outline-none focus:border-transparent text-center"
                          placeholder="%"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleAddTaxPreset();
                            }
                          }}
                        />
                        <button
                          type="button"
                          onClick={handleAddTaxPreset}
                          className="p-1 bg-blue-50 text-[#004ac6] hover:bg-blue-100 rounded-lg transition-colors cursor-pointer"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setIsAddingTaxPreset(false);
                            setNewTaxPresetValue('');
                          }}
                          className="p-1 text-red-500 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setIsAddingTaxPreset(true)}
                        className="px-4 py-2 border border-dashed border-[#c3c6d7] text-[#004ac6] hover:border-[#004ac6] hover:bg-blue-50/20 rounded-xl font-bold text-xs transition-colors cursor-pointer"
                      >
                        + Add Rate
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Card 2: Invoice Numbering */}
              <div className="bg-white rounded-2xl border border-[#e1e2ed] p-6 shadow-xs space-y-4">
                <div className="flex items-center gap-2 pb-1.5 border-b border-gray-50">
                  <div className="w-2.5 h-2.5 rounded-full bg-[#004ac6]" />
                  <h3 className="font-bold text-gray-900 text-xs uppercase tracking-wider">Invoice Numbering</h3>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {/* Prefix */}
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-gray-400 tracking-wider mb-1.5">Prefix</label>
                    <input
                      type="text"
                      value={invoicePrefix}
                      onChange={(e) => setInvoicePrefix(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[#004ac6]"
                      required
                    />
                  </div>

                  {/* Starting Number */}
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-gray-400 tracking-wider mb-1.5">Starting Number</label>
                    <input
                      type="number"
                      value={invoiceStartingNumber}
                      onChange={(e) => setInvoiceStartingNumber(Number(e.target.value))}
                      className="w-full px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-bold font-mono focus:outline-none focus:ring-1 focus:ring-[#004ac6]"
                      required
                    />
                  </div>

                  {/* Suffix */}
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-gray-400 tracking-wider mb-1.5">Suffix</label>
                    <input
                      type="text"
                      value={invoiceSuffix}
                      onChange={(e) => setInvoiceSuffix(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[#004ac6]"
                      required
                    />
                  </div>
                </div>

                {/* Preview Format blue box */}
                <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 flex items-center gap-2.5 text-xs text-[#004ac6]">
                  <Info className="w-4 h-4 shrink-0" />
                  <span className="font-bold">
                    Preview Format: <strong className="text-blue-900 font-mono tracking-tight">{invoicePrefix}{invoiceStartingNumber}{invoiceSuffix}</strong>
                  </span>
                </div>
              </div>

              {/* Card 3: Receipt Template Editor */}
              <div className="bg-white rounded-2xl border border-[#e1e2ed] p-6 shadow-xs space-y-4">
                <div className="flex items-center gap-2 pb-1.5 border-b border-gray-50">
                  <div className="w-2.5 h-2.5 rounded-full bg-[#004ac6]" />
                  <h3 className="font-bold text-gray-900 text-xs uppercase tracking-wider">Receipt Template Editor</h3>
                </div>

                {/* Switch list */}
                <div className="space-y-4 divide-y divide-gray-50">
                  {/* Toggle 1: Customer Name */}
                  <div className="flex justify-between items-center py-2.5">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 rounded-full bg-blue-50 text-[#004ac6]">
                        <User className="w-4 h-4" />
                      </div>
                      <div>
                        <p className="text-xs font-bold text-gray-900">Customer Name</p>
                        <p className="text-[10px] text-gray-400 font-medium">Show registered customer on receipt</p>
                      </div>
                    </div>
                    {/* Custom Toggle Switch */}
                    <button
                      type="button"
                      onClick={() => setShowCustomerName(!showCustomerName)}
                      className={`w-11 h-6 rounded-full transition-colors relative focus:outline-none cursor-pointer ${
                        showCustomerName ? 'bg-[#004ac6]' : 'bg-gray-200'
                      }`}
                    >
                      <div
                        className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-all shadow-sm ${
                          showCustomerName ? 'left-6' : 'left-1'
                        }`}
                      />
                    </button>
                  </div>

                  {/* Toggle 2: Loyalty Points */}
                  <div className="flex justify-between items-center py-2.5 pt-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 rounded-full bg-blue-50 text-[#004ac6]">
                        <CheckCircle className="w-4 h-4" />
                      </div>
                      <div>
                        <p className="text-xs font-bold text-gray-900">Loyalty Points</p>
                        <p className="text-[10px] text-gray-400 font-medium">Display earned and balance points</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowLoyaltyPoints(!showLoyaltyPoints)}
                      className={`w-11 h-6 rounded-full transition-colors relative focus:outline-none cursor-pointer ${
                        showLoyaltyPoints ? 'bg-[#004ac6]' : 'bg-gray-200'
                      }`}
                    >
                      <div
                        className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-all shadow-sm ${
                          showLoyaltyPoints ? 'left-6' : 'left-1'
                        }`}
                      />
                    </button>
                  </div>

                  {/* Toggle 2b: Loyalty QR Code */}
                  <div className="flex justify-between items-center py-2.5 pt-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 rounded-full bg-blue-50 text-[#004ac6]">
                        <QrCode className="w-4 h-4" />
                      </div>
                      <div>
                        <p className="text-xs font-bold text-gray-900">Loyalty QR Code</p>
                        <p className="text-[10px] text-gray-400 font-medium">Show QR code to scan and view rewards</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowQrCode(!showQrCode)}
                      className={`w-11 h-6 rounded-full transition-colors relative focus:outline-none cursor-pointer ${
                        showQrCode ? 'bg-[#004ac6]' : 'bg-gray-200'
                      }`}
                    >
                      <div
                        className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-all shadow-sm ${
                          showQrCode ? 'left-6' : 'left-1'
                        }`}
                      />
                    </button>
                  </div>

                  {/* Toggle 3: Discount Breakdown */}
                  <div className="flex justify-between items-center py-2.5 pt-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 rounded-full bg-blue-50 text-[#004ac6]">
                        <FileSignature className="w-4 h-4" />
                      </div>
                      <div>
                        <p className="text-xs font-bold text-gray-900">Discount Breakdown</p>
                        <p className="text-[10px] text-gray-400 font-medium">List each discount applied individually</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowDiscountBreakdown(!showDiscountBreakdown)}
                      className={`w-11 h-6 rounded-full transition-colors relative focus:outline-none cursor-pointer ${
                        showDiscountBreakdown ? 'bg-[#004ac6]' : 'bg-gray-200'
                      }`}
                    >
                      <div
                        className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-all shadow-sm ${
                          showDiscountBreakdown ? 'left-6' : 'left-1'
                        }`}
                      />
                    </button>
                  </div>

                  {/* Toggle 4: Print Restaurant Logo */}
                  <div className="flex justify-between items-center py-2.5 pt-4 border-t border-gray-50">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 rounded-full bg-blue-50 text-[#004ac6]">
                        <QrCode className="w-4 h-4" />
                      </div>
                      <div>
                        <p className="text-xs font-bold text-gray-900">Print Restaurant Logo</p>
                        <p className="text-[10px] text-gray-400 font-medium">Render the brand logo on printed receipts</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPrintLogoOnReceipt(!printLogoOnReceipt)}
                      className={`w-11 h-6 rounded-full transition-colors relative focus:outline-none cursor-pointer ${
                        printLogoOnReceipt ? 'bg-[#004ac6]' : 'bg-gray-200'
                      }`}
                    >
                      <div
                        className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-all shadow-sm ${
                          printLogoOnReceipt ? 'left-6' : 'left-1'
                        }`}
                      />
                    </button>
                  </div>

                  {/* Select Print Size (58mm vs 80mm) */}
                  <div className="flex flex-col sm:flex-row justify-between sm:items-center py-3 pt-4 border-t border-gray-50 gap-3">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 rounded-full bg-blue-50 text-[#004ac6]">
                        <Printer className="w-4 h-4" />
                      </div>
                      <div>
                        <p className="text-xs font-bold text-gray-900">Receipt Print Sizing</p>
                        <p className="text-[10px] text-gray-400 font-medium">Configure print width format for thermal rolls</p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setPrintSize('58mm')}
                        className={`px-3 py-1.5 rounded-xl font-bold text-[10px] uppercase transition-all cursor-pointer ${
                          printSize === '58mm'
                            ? 'bg-[#004ac6] text-white shadow-xs'
                            : 'bg-[#eae9f5] text-[#474087] hover:bg-[#deddf0]'
                        }`}
                      >
                        58 mm (Narrow)
                      </button>
                      <button
                        type="button"
                        onClick={() => setPrintSize('80mm')}
                        className={`px-3 py-1.5 rounded-xl font-bold text-[10px] uppercase transition-all cursor-pointer ${
                          printSize === '80mm'
                            ? 'bg-[#004ac6] text-white shadow-xs'
                            : 'bg-[#eae9f5] text-[#474087] hover:bg-[#deddf0]'
                        }`}
                      >
                        80 mm (Wide)
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Card 4: Receipt Footer & Section Visibility */}
              <div className="bg-white rounded-2xl border border-[#e1e2ed] p-6 shadow-xs space-y-4 mt-6">
                <div className="flex items-center gap-2 pb-1.5 border-b border-gray-50">
                  <div className="w-2.5 h-2.5 rounded-full bg-[#004ac6]" />
                  <h3 className="font-bold text-gray-900 text-xs uppercase tracking-wider">Receipt Footer & Section Visibility</h3>
                </div>

                <div className="space-y-4">
                  {/* Custom Footer Message Text Input */}
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-gray-400 tracking-wider mb-1.5">Custom Footer Message (Text)</label>
                    <textarea
                      rows={2}
                      value={receiptFooterMessage}
                      onChange={(e) => setReceiptFooterMessage(e.target.value)}
                      placeholder="e.g. THANK YOU FOR DINING WITH US!"
                      className="w-full px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[#004ac6] placeholder-gray-400"
                    />
                    <p className="text-[9px] text-gray-400 mt-1">This message is printed at the bottom of customer receipts.</p>
                  </div>

                  {/* Optional Footer Image Upload */}
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-gray-400 tracking-wider mb-2">Upload Custom Footer Banner / Coupon (Image)</label>
                    <div className="flex flex-col sm:flex-row gap-4 items-center">
                      <div 
                        onDragOver={(e) => { e.preventDefault(); setIsDraggingFooter(true); }}
                        onDragLeave={() => setIsDraggingFooter(false)}
                        onDrop={(e) => {
                          e.preventDefault();
                          setIsDraggingFooter(false);
                          const file = e.dataTransfer.files[0];
                          if (file && file.type.startsWith('image/')) {
                            processFooterFile(file);
                          } else {
                            alert('Please drop an image file.');
                          }
                        }}
                        className={`flex-1 w-full border-2 border-dashed rounded-2xl p-4 transition-all text-center flex flex-col items-center justify-center cursor-pointer ${
                          isDraggingFooter 
                            ? 'border-[#004ac6] bg-blue-50/50' 
                            : 'border-gray-300 hover:border-[#004ac6] hover:bg-gray-50/50'
                        }`}
                        onClick={() => document.getElementById('footer-banner-input')?.click()}
                      >
                        <input 
                          type="file" 
                          id="footer-banner-input"
                          accept="image/*"
                          className="hidden" 
                          onChange={handleFooterBannerUpload}
                        />
                        <Upload className={`w-6 h-6 mb-1.5 ${isDraggingFooter ? 'text-[#004ac6]' : 'text-gray-400'}`} />
                        <p className="text-xs font-bold text-gray-700">
                          Drag & Drop image here, or <span className="text-[#004ac6] underline">browse device</span>
                        </p>
                        <p className="text-[9px] text-gray-400 mt-1">PNG, JPG, WEBP or SVG (Max 2MB)</p>
                      </div>
                      
                      <div className="flex flex-col items-center gap-2 shrink-0">
                        <div className="w-16 h-16 bg-white border border-[#e1e2ed] rounded-xl flex items-center justify-center overflow-hidden shadow-xs relative group">
                          {receiptFooterImageUrl ? (
                            <img src={receiptFooterImageUrl} alt="Footer Preview" className="w-full h-full object-contain p-1" referrerPolicy="no-referrer" loading="lazy" decoding="async" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                          ) : (
                            <span className="text-gray-300 font-bold text-[10px] text-center px-1">
                              No Footer Banner
                            </span>
                          )}
                        </div>
                        {receiptFooterImageUrl && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRemoveFooterBanner();
                            }}
                            className="px-2 py-1 bg-red-50 text-red-600 rounded text-[9px] font-bold hover:bg-red-100 transition-colors flex items-center gap-1 cursor-pointer"
                          >
                            <Trash2 className="w-2.5 h-2.5" />
                            Remove
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-gray-50 pt-3 space-y-4">
                    <h4 className="text-[10px] font-bold uppercase text-gray-400 tracking-wider">Advanced Section Visibility</h4>
                    
                    {/* Toggle: Tax Summary */}
                    <div className="flex justify-between items-center py-2.5">
                      <div className="flex items-center gap-3">
                        <div className="p-2.5 rounded-full bg-blue-50 text-[#004ac6]">
                          <FileText className="w-4 h-4" />
                        </div>
                        <div>
                          <p className="text-xs font-bold text-gray-900">Tax Summary (CGST/SGST)</p>
                          <p className="text-[10px] text-gray-400 font-medium">Show individual CGST and SGST breakdown</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowTaxSummary(!showTaxSummary)}
                        className={`w-11 h-6 rounded-full transition-colors relative focus:outline-none cursor-pointer ${
                          showTaxSummary ? 'bg-[#004ac6]' : 'bg-gray-200'
                        }`}
                      >
                        <div
                          className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-all shadow-sm ${
                            showTaxSummary ? 'left-6' : 'left-1'
                          }`}
                        />
                      </button>
                    </div>

                    {/* Toggle: Loyalty Points Earned */}
                    <div className="flex justify-between items-center py-2.5 pt-4 border-t border-gray-50">
                      <div className="flex items-center gap-3">
                        <div className="p-2.5 rounded-full bg-blue-50 text-[#004ac6]">
                          <CheckCircle className="w-4 h-4" />
                        </div>
                        <div>
                          <p className="text-xs font-bold text-gray-900">Loyalty Points Earned</p>
                          <p className="text-[10px] text-gray-400 font-medium">Show points accumulated on current receipt</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowLoyaltyPointsEarned(!showLoyaltyPointsEarned)}
                        className={`w-11 h-6 rounded-full transition-colors relative focus:outline-none cursor-pointer ${
                          showLoyaltyPointsEarned ? 'bg-[#004ac6]' : 'bg-gray-200'
                        }`}
                      >
                        <div
                          className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-all shadow-sm ${
                            showLoyaltyPointsEarned ? 'left-6' : 'left-1'
                          }`}
                        />
                      </button>
                    </div>
                  </div>
                </div>
              </div>

            </div>

            {/* RIGHT COLUMN: Thermal Live Receipt Preview (col-span 5) */}
            <div className="lg:col-span-5 lg:h-full lg:overflow-y-auto pr-2 pb-6">
              <div className="bg-white border border-[#e1e2ed] rounded-2xl p-4 shadow-sm space-y-4">
                <div className="flex justify-between items-center pb-2 border-b border-gray-100">
                  <h4 className="text-[11px] font-extrabold uppercase tracking-widest text-[#191b23]">Live Preview</h4>
                  <div className="flex items-center gap-1.5 text-gray-400">
                    <Search className="w-3.5 h-3.5" />
                    <Printer className="w-3.5 h-3.5" />
                  </div>
                </div>

                {/* Thermal Receipt Mock Frame */}
                <div className="bg-gray-50 border border-gray-200/60 rounded-xl p-4 flex justify-center items-start">
                  <div className={`w-full bg-white border border-gray-200 shadow-lg font-mono text-gray-800 space-y-3 relative selection:bg-transparent overflow-hidden transition-all duration-300 ${
                    printSize === '58mm'
                      ? 'max-w-[210px] p-3 text-[8.5px]'
                      : 'max-w-[280px] p-5 text-[10px]'
                  }`}>
                    
                    {/* Header Details */}
                    <div className="text-center space-y-1">
                      <div className="border-b border-dashed border-gray-300 pb-1 mb-2"></div>
                      {printLogoOnReceipt && sidebarLogoUrl && (
                        <div className="flex justify-center mb-2">
                          <img src={sidebarLogoUrl} alt="Logo" className="max-h-12 max-w-[120px] object-contain" referrerPolicy="no-referrer" loading="lazy" decoding="async" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                        </div>
                      )}
                      <p className="text-xs font-extrabold tracking-wide uppercase text-gray-900">{restName || 'THE GRAND BISTRO'}</p>
                      <p className="text-[8px] text-gray-500 leading-tight">{address}</p>
                      <p className="text-[8px] text-gray-500 leading-tight">Phone: {phone}</p>
                      <p className="text-[8px] text-gray-500 font-bold uppercase">GSTIN: {gstin || '27AAAAA0000A1Z5'}</p>
                      <div className="border-b border-dashed border-gray-300 pt-1"></div>
                    </div>

                    {/* Metadata items */}
                    <div className="space-y-0.5 pt-1">
                      <div className="flex justify-between">
                        <span>INVOICE:</span>
                        <span className="font-bold">{invoicePrefix}{invoiceStartingNumber}{invoiceSuffix}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>TICKET:</span>
                        <span className="font-bold">TK-1001</span>
                      </div>
                      <div className="flex justify-between">
                        <span>DATE:</span>
                        <span>24-MAY-2026 14:42:01</span>
                      </div>
                      <div className="flex justify-between">
                        <span>CASHIER:</span>
                        <span>Alex M (Manager)</span>
                      </div>
                      <div className="flex justify-between">
                        <span>ORDER TYPE:</span>
                        <span className="font-bold">DINE IN</span>
                      </div>
                      {showCustomerName && (
                        <div className="flex justify-between font-bold border border-dashed border-black p-1 mt-1">
                          <span>LOYALTY MEMB:</span>
                          <span>John Doe</span>
                        </div>
                      )}
                    </div>

                    {/* Items table */}
                    <div className="pt-2 border-t border-dashed border-gray-300">
                      <div className="flex justify-between font-bold text-gray-900 text-[9px] pb-1">
                        <span className="w-1/2 text-left">ITEM</span>
                        <span className="w-1/6 text-center">QTY</span>
                        <span className="w-1/3 text-right">TOTAL</span>
                      </div>
                      <div className="border-b border-dashed border-gray-300 my-1" />
                      
                      <div className="space-y-1.5 py-1">
                        <div className="flex justify-between items-start">
                          <span className="w-1/2 text-left font-bold">
                            Truffle Risotto
                            <span className="block text-[8px] text-gray-500 font-normal">-Regular</span>
                          </span>
                          <span className="w-1/6 text-center">1</span>
                          <span className="w-1/3 text-right font-bold">₹1200.00</span>
                        </div>
                        
                        <div className="flex justify-between items-start">
                          <span className="w-1/2 text-left font-bold">
                            Margherita Pizza
                            <span className="block text-[8px] text-gray-500 font-normal">-Medium (10")</span>
                          </span>
                          <span className="w-1/6 text-center">2</span>
                          <span className="w-1/3 text-right font-bold">₹1500.00</span>
                        </div>
                      </div>
                    </div>

                    {/* Cost Calculations */}
                    <div className="pt-2 border-t border-dashed border-gray-300 space-y-1">
                      <div className="flex justify-between">
                        <span>SUBTOTAL:</span>
                        <span>₹ {previewSubtotal.toFixed(2)}</span>
                      </div>
                      {showDiscountBreakdown && previewDiscount > 0 && (
                        <div className="flex justify-between font-bold text-blue-700">
                          <span>DISCOUNT REDEEMED:</span>
                          <span>-₹ {previewDiscount.toFixed(2)}</span>
                        </div>
                      )}
                      {showTaxSummary && (
                        <>
                          <div className="flex justify-between text-[8px] text-gray-500">
                            <span>CGST ({(taxRate / 2)}%):</span>
                            <span>₹ {previewCGST.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between text-[8px] text-gray-500">
                            <span>SGST ({(taxRate / 2)}%):</span>
                            <span>₹ {previewSGST.toFixed(2)}</span>
                          </div>
                        </>
                      )}
                      {roundOffTotal && previewRoundOff !== 0 && (
                        <div className="flex justify-between text-[8px] text-gray-500">
                          <span>ROUND OFF:</span>
                          <span>₹ {previewRoundOff.toFixed(2)}</span>
                        </div>
                      )}
                      <div className="border-b border-dashed border-gray-300 my-1" />
                      <div className="flex justify-between font-black text-xs text-gray-950 pt-0.5">
                        <span>NET TOTAL:</span>
                        <span>₹ {previewGrandTotal.toFixed(2)}</span>
                      </div>
                    </div>

                    <div className="border-b border-dashed border-gray-300 my-2" />

                    <div className="font-bold">PAYMENT TYPE: SPLIT</div>
                    <div className="pl-2 space-y-0.5 text-[8.5px]">
                      <div className="flex justify-between">
                        <span>- CASH:</span>
                        <span>₹1000.00</span>
                      </div>
                      <div className="flex justify-between">
                        <span>- UPI:</span>
                        <span>₹ {(previewGrandTotal - 1000).toFixed(2)}</span>
                      </div>
                    </div>

                    {/* Loyalty summary box */}
                    {showCustomerName && showLoyaltyPoints && (
                      <div className="border border-black p-2 rounded text-center my-2 space-y-1 bg-gray-50">
                        <p className="font-bold tracking-wide text-[8px]">LOYALTY REWARDS SUMMARY</p>
                        <div className="flex justify-between text-[8px] px-1">
                          <span>Points Redeemed:</span>
                          <span className="font-bold">0 pts</span>
                        </div>
                        {showLoyaltyPointsEarned && (
                          <div className="flex justify-between text-[8px] px-1">
                            <span>Points Accumulated:</span>
                            <span className="font-bold">+27 pts</span>
                          </div>
                        )}
                        <p className="text-[7.5px] font-semibold text-green-700 uppercase mt-0.5">
                          PRE-ACTIVE TIER: PLATINUM
                        </p>
                      </div>
                    )}

                    {/* Thank You Note */}
                    <div className="text-center pt-2 space-y-1.5">
                      {receiptFooterMessage ? (
                        <div className="whitespace-pre-wrap text-[9px] font-bold text-gray-800 leading-normal uppercase">
                          {receiptFooterMessage}
                        </div>
                      ) : (
                        <div className="flex items-center justify-center gap-1 font-bold text-gray-800">
                          <span>THANK YOU FOR DINING WITH US!</span>
                          <Heart className="w-3 h-3 text-red-500 fill-red-500" />
                        </div>
                      )}
                      
                      {receiptFooterImageUrl && (
                        <div className="my-2 max-w-full flex justify-center">
                          <img 
                            src={receiptFooterImageUrl} 
                            alt="Footer Banner" 
                            className="max-h-16 w-auto object-contain rounded border border-gray-200" 
                            referrerPolicy="no-referrer"
                            onError={(e) => { e.currentTarget.style.display = 'none'; }}
                          />
                        </div>
                      )}
                      <p className="text-[8px] text-gray-400">Please visit us again.</p>
                    </div>

                    {/* Loyalty QR Code display */}
                    {showQrCode && (
                      <div className="text-center pt-2 space-y-1 border-t border-dashed border-gray-200">
                        <p className="text-[7px] tracking-widest text-gray-400 uppercase font-black">SCAN TO VIEW REWARDS</p>
                        <div className="p-1.5 border border-gray-200 rounded-lg inline-block bg-white shadow-xs">
<QRCodeSVG />
                        </div>
                      </div>
                    )}

                  </div>
                </div>

                <p className="text-[9px] text-gray-400 font-medium text-center">
                  The preview reflects changes to labels and visibility toggles in real-time. Actual print sizing may vary based on your thermal printer model.
                </p>

                <div className="pt-2 border-t border-gray-100 flex gap-2">
                  <button
                    type="button"
                    onClick={handlePrintTestReceipt}
                    className="flex-1 py-2.5 px-4 bg-[#004ac6] hover:bg-[#003ea8] text-white font-bold text-xs rounded-xl shadow-xs transition-colors cursor-pointer flex items-center justify-center gap-2"
                  >
                    <Printer className="w-4 h-4" />
                    Test Print Receipt
                  </button>
                </div>
              </div>
            </div>

          </div>          ) : activeSubTab === 'modules' ? (
          /* MODULES & FEATURES TAB CONTENT */
          <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start overflow-y-auto lg:overflow-hidden min-h-0">
            
            {/* LEFT COLUMN: Module toggles (col-span 7) */}
            <div className="lg:col-span-7 space-y-6 lg:h-full lg:overflow-y-auto pr-2 pb-6">
              
              {/* Card: Restaurant Modules */}
              <div className="bg-white rounded-2xl border border-[#e1e2ed] p-6 shadow-xs space-y-4">
                <div className="flex items-center gap-2 pb-1.5 border-b border-gray-50">
                  <div className="w-2.5 h-2.5 rounded-full bg-[#004ac6]" />
                  <h3 className="font-bold text-gray-900 text-xs uppercase tracking-wider">Restaurant Modules</h3>
                </div>
                <p className="text-[10px] text-gray-500">Enable or disable modules to control which features appear in the POS. Disabled modules will be hidden from the interface.</p>

                <div className="space-y-1 divide-y divide-gray-50">
                  {/* Table Service */}
                  <div className="flex justify-between items-center py-3">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 rounded-full bg-blue-50 text-[#004ac6]">
                        <Table className="w-4 h-4" />
                      </div>
                      <div>
                        <p className="text-xs font-bold text-gray-900">Table Service</p>
                        <p className="text-[10px] text-gray-400">Show restaurant floor tables for dine-in orders</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleModule('enableTableService')}
                      className={`w-11 h-6 rounded-full transition-colors relative focus:outline-none cursor-pointer shrink-0 ${moduleSettings.enableTableService ? 'bg-[#004ac6]' : 'bg-gray-200'}`}
                    >
                      <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-all shadow-sm ${moduleSettings.enableTableService ? 'left-6' : 'left-1'}`} />
                    </button>
                  </div>

                  {/* Waiter Management */}
                  <div className="flex justify-between items-center py-3">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 rounded-full bg-blue-50 text-[#004ac6]">
                        <Users className="w-4 h-4" />
                      </div>
                      <div>
                        <p className="text-xs font-bold text-gray-900">Waiter Management</p>
                        <p className="text-[10px] text-gray-400">Assign waiters to tables and track service staff</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleModule('enableWaiterManagement')}
                      className={`w-11 h-6 rounded-full transition-colors relative focus:outline-none cursor-pointer shrink-0 ${moduleSettings.enableWaiterManagement ? 'bg-[#004ac6]' : 'bg-gray-200'}`}
                    >
                      <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-all shadow-sm ${moduleSettings.enableWaiterManagement ? 'left-6' : 'left-1'}`} />
                    </button>
                  </div>

                  {/* Reservations */}
                  <div className="flex justify-between items-center py-3">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 rounded-full bg-blue-50 text-[#004ac6]">
                        <CalendarCheck className="w-4 h-4" />
                      </div>
                      <div>
                        <p className="text-xs font-bold text-gray-900">Reservations</p>
                        <p className="text-[10px] text-gray-400">Manage table reservations and booking schedules</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleModule('enableReservations')}
                      className={`w-11 h-6 rounded-full transition-colors relative focus:outline-none cursor-pointer shrink-0 ${moduleSettings.enableReservations ? 'bg-[#004ac6]' : 'bg-gray-200'}`}
                    >
                      <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-all shadow-sm ${moduleSettings.enableReservations ? 'left-6' : 'left-1'}`} />
                    </button>
                  </div>

                  {/* QR Ordering */}
                  <div className="flex justify-between items-center py-3">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 rounded-full bg-blue-50 text-[#004ac6]">
                        <ScanLine className="w-4 h-4" />
                      </div>
                      <div>
                        <p className="text-xs font-bold text-gray-900">QR Code Ordering</p>
                        <p className="text-[10px] text-gray-400">Customers scan QR at table to browse menu and order</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleModule('enableQROrdering')}
                      className={`w-11 h-6 rounded-full transition-colors relative focus:outline-none cursor-pointer shrink-0 ${moduleSettings.enableQROrdering ? 'bg-[#004ac6]' : 'bg-gray-200'}`}
                    >
                      <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-all shadow-sm ${moduleSettings.enableQROrdering ? 'left-6' : 'left-1'}`} />
                    </button>
                  </div>

                  {/* Delivery Module */}
                  <div className="flex justify-between items-center py-3">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 rounded-full bg-blue-50 text-[#004ac6]">
                        <Truck className="w-4 h-4" />
                      </div>
                      <div>
                        <p className="text-xs font-bold text-gray-900">Delivery Module</p>
                        <p className="text-[10px] text-gray-400">Enable delivery orders with address and ETA tracking</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleModule('enableDeliveryModule')}
                      className={`w-11 h-6 rounded-full transition-colors relative focus:outline-none cursor-pointer shrink-0 ${moduleSettings.enableDeliveryModule ? 'bg-[#004ac6]' : 'bg-gray-200'}`}
                    >
                      <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-all shadow-sm ${moduleSettings.enableDeliveryModule ? 'left-6' : 'left-1'}`} />
                    </button>
                  </div>

                  {/* Online Orders */}
                  <div className="flex justify-between items-center py-3">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 rounded-full bg-blue-50 text-[#004ac6]">
                        <Globe className="w-4 h-4" />
                      </div>
                      <div>
                        <p className="text-xs font-bold text-gray-900">Online Orders</p>
                        <p className="text-[10px] text-gray-400">Receive orders from Swiggy, Zomato, Uber Eats, Website</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleModule('enableOnlineOrders')}
                      className={`w-11 h-6 rounded-full transition-colors relative focus:outline-none cursor-pointer shrink-0 ${moduleSettings.enableOnlineOrders ? 'bg-[#004ac6]' : 'bg-gray-200'}`}
                    >
                      <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-all shadow-sm ${moduleSettings.enableOnlineOrders ? 'left-6' : 'left-1'}`} />
                    </button>
                  </div>

                  {/* Kitchen Display */}
                  <div className="flex justify-between items-center py-3">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 rounded-full bg-blue-50 text-[#004ac6]">
                        <Monitor className="w-4 h-4" />
                      </div>
                      <div>
                        <p className="text-xs font-bold text-gray-900">Kitchen Display System</p>
                        <p className="text-[10px] text-gray-400">Show KOT orders on a dedicated kitchen screen</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleModule('enableKitchenDisplay')}
                      className={`w-11 h-6 rounded-full transition-colors relative focus:outline-none cursor-pointer shrink-0 ${moduleSettings.enableKitchenDisplay ? 'bg-[#004ac6]' : 'bg-gray-200'}`}
                    >
                      <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-all shadow-sm ${moduleSettings.enableKitchenDisplay ? 'left-6' : 'left-1'}`} />
                    </button>
                  </div>

                  {/* Loyalty */}
                  <div className="flex justify-between items-center py-3">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 rounded-full bg-blue-50 text-[#004ac6]">
                        <Gift className="w-4 h-4" />
                      </div>
                      <div>
                        <p className="text-xs font-bold text-gray-900">Loyalty & Rewards</p>
                        <p className="text-[10px] text-gray-400">Customer loyalty program with points, rewards, and milestones</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleModule('enableLoyalty')}
                      className={`w-11 h-6 rounded-full transition-colors relative focus:outline-none cursor-pointer shrink-0 ${moduleSettings.enableLoyalty ? 'bg-[#004ac6]' : 'bg-gray-200'}`}
                    >
                      <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-all shadow-sm ${moduleSettings.enableLoyalty ? 'left-6' : 'left-1'}`} />
                    </button>
                  </div>

                  {/* Product Images in Billing */}
                  <div className="flex justify-between items-center py-3">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 rounded-full bg-blue-50 text-[#004ac6]">
                        <Monitor className="w-4 h-4" />
                      </div>
                      <div>
                        <p className="text-xs font-bold text-gray-900">Product Images in Billing</p>
                        <p className="text-[10px] text-gray-400">Show product images on billing grid cards</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleModule('showImagesInBilling')}
                      className={`w-11 h-6 rounded-full transition-colors relative focus:outline-none cursor-pointer shrink-0 ${moduleSettings.showImagesInBilling ? 'bg-[#004ac6]' : 'bg-gray-200'}`}
                    >
                      <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-all shadow-sm ${moduleSettings.showImagesInBilling ? 'left-6' : 'left-1'}`} />
                    </button>
                  </div>
                </div>

                <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 flex items-center gap-2.5 text-xs text-amber-800 mt-2">
                  <Info className="w-4 h-4 shrink-0" />
                  <span className="font-medium">Changes apply immediately after saving. Disabled modules will be hidden from the navigation and order management views.</span>
                </div>
              </div>

            </div>

            {/* RIGHT COLUMN: Module info card (col-span 5) */}
            <div className="lg:col-span-5 space-y-6 lg:h-full lg:overflow-y-auto pr-2 pb-6">
              
              {/* Info Card */}
              <div className="bg-white rounded-2xl border border-[#e1e2ed] p-6 shadow-xs space-y-4">
                <div className="flex items-center gap-2 pb-1.5 border-b border-gray-50">
                  <div className="w-2.5 h-2.5 rounded-full bg-[#004ac6]" />
                  <h3 className="font-bold text-gray-900 text-xs uppercase tracking-wider">Feature Overview</h3>
                </div>

                <div className="space-y-3">
                  <div className="bg-gray-50 rounded-xl p-3">
                    <p className="text-[10px] font-bold text-gray-700">Cloud Kitchen Mode</p>
                    <p className="text-[9px] text-gray-500 mt-1">Disable <strong>Table Service</strong> and <strong>Waiter Management</strong> to hide all table-related features. The POS will focus on takeaway and online orders.</p>
                  </div>
                  <div className="bg-gray-50 rounded-xl p-3">
                    <p className="text-[10px] font-bold text-gray-700">Café Mode</p>
                    <p className="text-[9px] text-gray-500 mt-1">Enable only <strong>Table Service</strong>, <strong>Kitchen Display</strong>, and <strong>Loyalty</strong>. Disable Reservations, Delivery, and Online Orders for a lightweight café setup.</p>
                  </div>
                  <div className="bg-gray-50 rounded-xl p-3">
                    <p className="text-[10px] font-bold text-gray-700">Full Restaurant Mode</p>
                    <p className="text-[9px] text-gray-500 mt-1">Enable all modules for a complete POS experience with tables, online orders, delivery, kitchen display, and loyalty rewards.</p>
                  </div>

                  <div className="text-[10px] text-gray-500 mt-2">
                    <p className="font-semibold text-gray-700">Currently enabled:</p>
                    <p className="mt-1">
                      {Object.entries(moduleSettings)
                        .filter(([, v]) => v)
                        .map(([key]) => key.replace(/^enable/, '').replace(/([A-Z])/g, ' $1').replace(/^./, m => m.toUpperCase()).trim())
                        .join(', ') || 'None'}
                    </p>
                  </div>
                </div>
              </div>

            </div>
          </div>
        ) : (
          /* KOT & KITCHEN CONFIG TAB CONTENT */
          <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start overflow-y-auto lg:overflow-hidden min-h-0">
            
            {/* LEFT COLUMN: KOT Config Input panels (col-span 7) */}
            <div className="lg:col-span-7 space-y-6 lg:h-full lg:overflow-y-auto pr-2 pb-6">
              
              {/* Card 1: Ticket Layout Checkboxes */}
              <div className="bg-white rounded-2xl border border-[#e1e2ed] p-6 shadow-xs space-y-4">
                <div className="flex items-center gap-2 pb-1.5 border-b border-gray-50">
                  <div className="w-2.5 h-2.5 rounded-full bg-[#004ac6]" />
                  <h3 className="font-bold text-gray-900 text-xs uppercase tracking-wider">Ticket Layout</h3>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Option 1: Print Category Headers */}
                  <label className="flex items-start gap-3 bg-gray-50/50 hover:bg-gray-50 p-3.5 rounded-xl border border-gray-100 transition-colors cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={printCategoryHeaders}
                      onChange={(e) => setPrintCategoryHeaders(e.target.checked)}
                      className="mt-0.5 rounded text-[#004ac6] focus:ring-[#004ac6] w-4 h-4 border-[#c3c6d7]"
                    />
                    <div>
                      <p className="text-xs font-bold text-gray-900">Print Category Headers</p>
                      <p className="text-[10px] text-gray-400 font-medium mt-0.5">Separate items by category groups</p>
                    </div>
                  </label>

                  {/* Option 2: Show Item Modifiers */}
                  <label className="flex items-start gap-3 bg-gray-50/50 hover:bg-gray-50 p-3.5 rounded-xl border border-gray-100 transition-colors cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={showItemModifiers}
                      onChange={(e) => setShowItemModifiers(e.target.checked)}
                      className="mt-0.5 rounded text-[#004ac6] focus:ring-[#004ac6] w-4 h-4 border-[#c3c6d7]"
                    />
                    <div>
                      <p className="text-xs font-bold text-gray-900">Show Item Modifiers</p>
                      <p className="text-[10px] text-gray-400 font-medium mt-0.5">Display 'No Onion', 'Extra Spicy', etc.</p>
                    </div>
                  </label>

                  {/* Option 3: Show Order Time */}
                  <label className="flex items-start gap-3 bg-gray-50/50 hover:bg-gray-50 p-3.5 rounded-xl border border-gray-100 transition-colors cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={showOrderTime}
                      onChange={(e) => setShowOrderTime(e.target.checked)}
                      className="mt-0.5 rounded text-[#004ac6] focus:ring-[#004ac6] w-4 h-4 border-[#c3c6d7]"
                    />
                    <div>
                      <p className="text-xs font-bold text-gray-900">Show Order Time</p>
                      <p className="text-[10px] text-gray-400 font-medium mt-0.5">Print exact order timestamp</p>
                    </div>
                  </label>

                  {/* Option 4: Show Table Number */}
                  <label className="flex items-start gap-3 bg-gray-50/50 hover:bg-gray-50 p-3.5 rounded-xl border border-gray-100 transition-colors cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={showTableNumber}
                      onChange={(e) => setShowTableNumber(e.target.checked)}
                      className="mt-0.5 rounded text-[#004ac6] focus:ring-[#004ac6] w-4 h-4 border-[#c3c6d7]"
                    />
                    <div>
                      <p className="text-xs font-bold text-gray-900">Show Table Number</p>
                      <p className="text-[10px] text-gray-400 font-medium mt-0.5">Large identifier for kitchen staff</p>
                    </div>
                  </label>

                  {/* Option 5: Group Identical Items in KOT */}
                  <label className="flex items-start gap-3 bg-gray-50/50 hover:bg-gray-50 p-3.5 rounded-xl border border-gray-100 transition-colors cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={groupItemsInKOT}
                      onChange={(e) => setGroupItemsInKOT(e.target.checked)}
                      className="mt-0.5 rounded text-[#004ac6] focus:ring-[#004ac6] w-4 h-4 border-[#c3c6d7]"
                    />
                    <div>
                      <p className="text-xs font-bold text-gray-900">Group Identical Items</p>
                      <p className="text-[10px] text-gray-400 font-medium mt-0.5">Consolidate multiple quantities into single lines</p>
                    </div>
                  </label>
                </div>

                {/* Option 6: KOT Custom Footer Note */}
                <div className="pt-3 border-t border-gray-100">
                  <label className="block text-[10px] font-bold uppercase text-gray-400 tracking-wider mb-1.5">KOT Custom Footer Note</label>
                  <input
                    type="text"
                    value={kotFooterNote}
                    onChange={(e) => setKotFooterNote(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[#004ac6] placeholder-gray-400"
                    placeholder="e.g. Cook with passion!"
                  />
                  <span className="text-[9px] text-gray-400 mt-1 block">Custom instructions or notes printed at the bottom of the kitchen order tickets.</span>
                </div>
              </div>

              {/* Card 2: Printer Routing Table */}
              <div className="bg-white rounded-2xl border border-[#e1e2ed] p-6 shadow-xs space-y-4">
                <div className="flex justify-between items-center pb-1.5 border-b border-gray-50">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full bg-[#004ac6]" />
                    <h3 className="font-bold text-gray-900 text-xs uppercase tracking-wider">Printer Routing</h3>
                  </div>

                  <button
                    type="button"
                    onClick={handleAddRoutingRule}
                    className="flex items-center gap-1 text-[#004ac6] hover:text-[#003ea8] font-bold text-xs cursor-pointer transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                    Add Rule
                  </button>
                </div>

                {/* List of active routing rules */}
                {routingRules.length === 0 ? (
                  <div className="text-center py-8 text-gray-400 text-xs font-medium bg-gray-50 rounded-2xl border border-dashed border-[#e1e2ed]">
                    No custom printer rules configured.<br />All tickets will use the primary kitchen workstation.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {routingRules.map((rule) => (
                      <div key={rule.id} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 bg-gray-50 p-3 rounded-xl border border-gray-100 group relative">
                        
                        {/* Dropdown 1: Category */}
                        <div className="flex-1">
                          <label className="block text-[8px] font-bold text-gray-400 uppercase tracking-wider mb-1">Category Group</label>
                          <div className="relative">
                            <select
                              value={rule.categoryGroup}
                              onChange={(e) => handleUpdateRule(rule.id, 'categoryGroup', e.target.value)}
                              className="w-full bg-white border border-[#c3c6d7] text-xs font-semibold px-3 py-1.5 rounded-lg appearance-none focus:outline-none focus:ring-1 focus:ring-[#004ac6] cursor-pointer"
                            >
                              {categoryGroups.map(grp => (
                                <option key={grp} value={grp}>{grp}</option>
                              ))}
                            </select>
                            <ChevronDown className="w-4 h-4 absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                          </div>
                        </div>

                        {/* Dropdown 2: Destination */}
                        <div className="flex-1">
                          <label className="block text-[8px] font-bold text-gray-400 uppercase tracking-wider mb-1">Destination Printer</label>
                          <div className="relative">
                            <select
                              value={rule.destinationPrinter}
                              onChange={(e) => handleUpdateRule(rule.id, 'destinationPrinter', e.target.value)}
                              className="w-full bg-white border border-[#c3c6d7] text-xs font-semibold px-3 py-1.5 rounded-lg appearance-none focus:outline-none focus:ring-1 focus:ring-[#004ac6] cursor-pointer"
                            >
                              {destinationPrinters.map(prn => (
                                <option key={prn} value={prn}>{prn}</option>
                              ))}
                            </select>
                            <ChevronDown className="w-4 h-4 absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                          </div>
                        </div>

                        {/* Trash Delete Action */}
                        <div className="flex items-end justify-end sm:pt-4">
                          <button
                            type="button"
                            onClick={() => handleDeleteRoutingRule(rule.id)}
                            className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                            title="Delete Rule"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>

                      </div>
                    ))}
                  </div>
                )}
              </div>

            </div>

            {/* RIGHT COLUMN: KOT Ticket Live Preview (col-span 5) */}
            <div className="lg:col-span-5 lg:h-full lg:overflow-y-auto pr-2 pb-6">
              <div className="bg-white border border-[#e1e2ed] rounded-2xl p-4 shadow-sm space-y-4">
                <div className="flex justify-between items-center pb-2 border-b border-gray-100">
                  <h4 className="text-[11px] font-extrabold uppercase tracking-widest text-[#191b23]">Live Ticket Preview</h4>
                  <Printer className="w-3.5 h-3.5 text-gray-400" />
                </div>

                {/* Thermal KOT Ticket Mock Frame */}
                <div className="bg-gray-50 border border-gray-200/60 rounded-xl p-4 flex justify-center items-start">
                  <div className="w-full max-w-[280px] bg-white border border-gray-200 shadow-lg p-5 font-mono text-[10px] text-gray-800 space-y-3 relative selection:bg-transparent overflow-hidden">
                    
                    {/* Header */}
                    <div className="text-center space-y-0.5">
                      <p className="text-xs font-black tracking-widest uppercase text-gray-950">*** KITCHEN ORDER ***</p>
                      {showOrderTime && (
                        <p className="text-[8px] text-gray-500">2023-11-24 14:42:01</p>
                      )}
                    </div>

                    {/* Metadata Section with Table and Server */}
                    {showTableNumber && (
                      <div className="flex justify-between font-bold pt-1 text-gray-900 border-t border-dashed border-gray-300">
                        <span>TABLE: 04</span>
                        <span>SERVER: SARAH</span>
                      </div>
                    )}

                    {/* Items display */}
                    <div className="pt-2 border-t border-dashed border-gray-300 space-y-2">
                      {printCategoryHeaders ? (
                        <>
                          <p className="text-[8px] text-gray-400 font-extrabold tracking-wider uppercase">--- MAIN COURSES ---</p>
                          <div className="space-y-1">
                            <p className="font-extrabold text-gray-900">2x Margherita Pizza</p>
                            {showItemModifiers && (
                              <p className="text-red-600 font-bold text-[8.5px] pl-3.5">- NO ONIONS</p>
                            )}
                          </div>
                          
                          <div className="space-y-1 pt-1">
                            <p className="font-extrabold text-gray-900">1x Pasta Carbonara</p>
                            {showItemModifiers && (
                              <p className="text-blue-700 font-bold text-[8.5px] pl-3.5">- AL DENTE</p>
                            )}
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="space-y-1">
                            <p className="font-extrabold text-gray-900">2x Margherita Pizza</p>
                            {showItemModifiers && (
                              <p className="text-red-600 font-bold text-[8.5px] pl-3.5">- NO ONIONS</p>
                            )}
                          </div>
                          
                          <div className="space-y-1 pt-1">
                            <p className="font-extrabold text-gray-900">1x Pasta Carbonara</p>
                            {showItemModifiers && (
                              <p className="text-blue-700 font-bold text-[8.5px] pl-3.5">- AL DENTE</p>
                            )}
                          </div>
                        </>
                      )}
                    </div>

                    {/* Footer */}
                    <div className="pt-3 border-t border-dashed border-gray-300 text-center space-y-1">
                      {kotFooterNote && (
                        <p className="text-[8.5px] text-[#004ac6] font-bold italic mb-1">"{kotFooterNote}"</p>
                      )}
                      <p className="text-xs font-black text-gray-900">ORDER #8841</p>
                      <p className="text-[8px] text-gray-400">End of Kitchen Ticket</p>
                    </div>

                    {/* Torn Paper Effect Visual Accent */}
                    <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-repeat-x" style={{
                      backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='6' viewBox='0 0 12 6'%3E%3Cpath d='M0 6h12L6 0z' fill='%23f9fafb'/%3E%3C/svg%3E")`,
                      backgroundSize: '12px 6px',
                      backgroundPosition: 'bottom'
                    }} />

                  </div>
                </div>

                {/* Caption / Tip */}
                <div className="bg-blue-50/50 border border-blue-100/50 rounded-xl p-3 flex items-start gap-2 text-[9px] text-gray-500 leading-relaxed">
                  <Info className="w-3.5 h-3.5 text-[#004ac6] shrink-0 mt-0.5" />
                  <p>
                    <strong>Visual Tip:</strong> Thermal printers have fixed widths (80mm is standard). This preview accurately reflects how font sizes will appear on your kitchen hardware.
                  </p>
                </div>

                <div className="pt-2 border-t border-gray-100 flex gap-2">
                  <button
                    type="button"
                    onClick={handlePrintTestKOT}
                    className="flex-1 py-2.5 px-4 bg-[#004ac6] hover:bg-[#003ea8] text-white font-bold text-xs rounded-xl shadow-xs transition-colors cursor-pointer flex items-center justify-center gap-2"
                  >
                    <Printer className="w-4 h-4" />
                    Test Print KOT Ticket
                  </button>
                </div>
              </div>
            </div>

          </div>
        )}

        {/* PERSISTENT FLOATING ACTIONS BOTTOM FOOTER */}
        <div className="flex items-center gap-3 border-t border-[#e1e2ed] pt-6 mt-2">
          <button
            type="submit"
            className="flex items-center gap-2 bg-[#004ac6] hover:bg-[#003ea8] text-white px-6 py-3 rounded-xl font-bold text-xs tracking-wide shadow-md active:scale-98 transition-all cursor-pointer"
          >
            <Save className="w-4 h-4" />
            Save Configuration
          </button>
          
          <button
            type="button"
            onClick={handleDiscardChanges}
            className="flex items-center gap-2 border border-[#c3c6d7] text-gray-600 hover:bg-gray-50 px-6 py-3 rounded-xl font-bold text-xs tracking-wide active:scale-98 transition-all cursor-pointer bg-white"
          >
            <RotateCcw className="w-4 h-4" />
            Discard Changes
          </button>
        </div>

      </form>

      {/* FLOATING SUCCESS CAPSULE TOAST NOTIFICATION */}
      {localToast && (
        <div className="fixed bottom-6 right-6 bg-[#1e293b] text-white px-5 py-3.5 rounded-xl shadow-2xl flex items-center gap-2.5 border border-slate-700/60 z-50 animate-bounce">
          <div className="w-5 h-5 rounded-full bg-green-500/20 text-green-400 flex items-center justify-center shrink-0">
            <CheckCircle className="w-3.5 h-3.5" />
          </div>
          <span className="text-xs font-bold tracking-tight">{localToast}</span>
        </div>
      )}

    </div>
  );
}
