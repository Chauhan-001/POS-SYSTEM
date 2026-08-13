/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * HelpFaqTab — Settings → HELP & FAQ.
 *
 * 35 frequently-asked questions organised into sections (Ordering, Billing &
 * Payments, Kitchen & KOT, Tables & QR Ordering, Loyalty & Offers, Account &
 * Settings, Devices & Technical, Data & Privacy) plus a Contact Us card.
 *
 * Contact details are kept here in ONE place (also mirrored in the backend
 * legal docs seed) — edit this single file to change them.
 */

import React, { useMemo, useState } from 'react';
import { Search, ChevronDown, ChevronUp, LifeBuoy, Mail, Phone, MessageCircle } from 'lucide-react';

export const SUPPORT_EMAIL = 'rajputvansh144@gmail.com';
export const SUPPORT_PHONE = '8755783645';

interface FaqItem {
  q: string;
  a: string;
}

interface FaqSection {
  id: string;
  title: string;
  icon: string;
  items: FaqItem[];
}

const FAQ_SECTIONS: FaqSection[] = [
  {
    id: 'ordering',
    title: 'Ordering',
    icon: '🍽️',
    items: [
      { q: 'How do I take an order for a table?', a: 'Open the Orders tab, tap the table card, then tap "Order". Select items from the menu, add quantities, and tap Place Order. A KOT is sent to the kitchen automatically.' },
      { q: 'Can a customer order from the table QR while another order is open?', a: 'No — a table with a live (open) order is blocked from placing a second QR order. The customer is shown a message to ask their server for additions. Once the bill is settled, the table is freed for new orders.' },
      { q: 'How do online (customer site) orders work?', a: 'Customers scan the QR sticker, browse the menu, and place an order. It appears instantly in Orders → Online Orders and in the Calls panel as an online-order call, so nothing is missed. It also occupies the table on the floor plan.' },
      { q: 'How do I add items to an existing order?', a: 'Open the table in Orders, tap "Order", and add the new items. They are added to the same bill/KOT flow with an "Additional KOT" when auto-print is on.' },
      { q: 'What is a takeaway order?', a: 'Takeaway orders are placed for pickup without a table. Use the Takeaway tab in Orders, or the customer site Pickup mode, and the order flows through the same billing and kitchen pipeline.' },
      { q: 'Can I hold an order and resume later?', a: 'Yes — use the Hold feature in billing. Held orders can be resumed from the Orders screen and remain available until billed or discarded.' },
    ],
  },
  {
    id: 'billing',
    title: 'Billing & Payments',
    icon: '💳',
    items: [
      { q: 'How do I print a bill?', a: 'Open the table/order, tap Bill, review the receipt preview, and tap Print. Paper size (80mm/58mm) and receipt sections are configured in Settings → Billing & Invoice.' },
      { q: 'Which payment methods are supported?', a: 'Cash, card (through your payment provider), UPI/QR where configured, and online payment via the customer site. Methods appear in billing and in Reports → Payment Methods.' },
      { q: 'How is GST calculated?', a: 'Tax rates are set in Settings → Billing & Invoice (GST presets 5%/12%/18% or custom). GST appears on the bill with CGST/SGST splits when enabled.' },
      { q: 'Can I give a discount?', a: 'Yes — discounts can be applied at billing if the Discount on Billing module is enabled (Settings → Modules). Loyalty point redemptions and offer coupons also apply.' },
      { q: 'What happens if a payment fails?', a: 'The order stays open and no bill is marked paid. You can retry the payment or switch methods. Partial/held payments are tracked on the bill.' },
    ],
  },
  {
    id: 'kitchen',
    title: 'Kitchen & KOT',
    icon: '🍳',
    items: [
      { q: 'What is a KOT?', a: 'A Kitchen Order Ticket — the list of items sent to the kitchen when an order is placed. It shows the table, items, quantities, and notes, and is displayed on the Kitchen board.' },
      { q: 'How do KOTs reach the kitchen?', a: 'New orders create KOTs instantly on the Kitchen Display. If Auto Print KOT is enabled (Settings → Modules), the KOT also prints to the configured kitchen printer.' },
      { q: 'Do online orders appear in the kitchen?', a: 'Yes — every customer-site order creates an auto-KOT that appears on the kitchen board and prints when auto-print is on.' },
      { q: 'What are the KOT stages?', a: 'New → Preparing → Ready. Kitchen staff tap "Start Preparing" to move a KOT to Preparing, and mark it Ready when the food is done.' },
      { q: 'How do I reprint a KOT?', a: 'Open the order in billing/kitchen and use the reprint KOT option. Manual reprints always go to the printer regardless of the auto-print toggle.' },
    ],
  },
  {
    id: 'tables-qr',
    title: 'Tables & QR Ordering',
    icon: '🪑',
    items: [
      { q: 'How do I add or edit tables?', a: 'Use Orders → Manage Tables, or Settings. Tables are grouped by floor/section (Window, Outdoor, Family, VIP, Main Hall) and shown on the floor plan.' },
      { q: 'How do I print QR stickers?', a: 'Open More → QR Studio. It shows one QR per table for the branch you are viewing. Use "Print all" or print individual stickers, then place them on the tables.' },
      { q: 'Why do some tables not show in QR Studio?', a: 'QR Studio shows tables of the branch currently selected in the top bar. Switch branches to see that branch\u2019s tables. Deleted tables are never shown.' },
      { q: 'How does a table become Occupied?', a: 'A table is occupied when it has a live order — dine-in or a live QR/online order. Free tables show "Tap to seat" on the floor plan.' },
    ],
  },
  {
    id: 'loyalty',
    title: 'Loyalty & Offers',
    icon: '🎁',
    items: [
      { q: 'How does the loyalty program work?', a: 'Customers earn points on paid bills based on your points-per-currency settings. Points can be redeemed for discounts or rewards you configure in Loyalty settings.' },
      { q: 'How do I create an offer or coupon?', a: 'Use More → Offers to create offers (percentage/flat), coupons, and schedules. Live offers appear on the customer site and can be redeemed at billing.' },
      { q: 'What are customer segments?', a: 'Segments group customers by behaviour (e.g. spend, visits) so you can target offers and campaigns. Segment rules are configurable under Offers/Customers.' },
      { q: 'How do campaign messages get sent?', a: 'Campaigns are delivered by the platform through configured channels (e.g. SMS/WhatsApp providers when connected). Only customers who consented to marketing communications are included in promotional campaigns.' },
    ],
  },
  {
    id: 'account',
    title: 'Account & Settings',
    icon: '⚙️',
    items: [
      { q: 'How do I add staff and set permissions?', a: 'Use More → Staff to add employees, and Settings → Role Permissions to control what each role can do (billing, kitchen, reports, etc.).' },
      { q: 'How do I change restaurant details (name, GSTIN, address)?', a: 'Settings → Billing & Invoice holds your GSTIN, name, phone, address, invoice numbering and paper size. Save with a change reason for the audit trail.' },
      { q: 'How do I manage branches?', a: 'Use More → Branches to add/rename branches and assign tables. The top-bar branch selector switches the active branch; data is fetched fresh from the backend on switch.' },
      { q: 'How do I update the theme or language?', a: 'Settings → Theme controls appearance (light/dark/system, brand colour, density). Language/region options are under general settings.' },
    ],
  },
  {
    id: 'devices',
    title: 'Devices & Technical',
    icon: '🖥️',
    items: [
      { q: 'How many devices can connect?', a: 'The number of POS terminals depends on your subscription plan\u2019s device limit. Devices are managed in Settings/Admin and can be approved or blocked.' },
      { q: 'What happens when the internet goes down?', a: 'The POS keeps working offline — orders and bills are queued and synced when the connection returns. The status indicator shows when you are offline.' },
      { q: 'How do I connect a printer?', a: 'Settings → Printers lets you add network/USB/Bluetooth printers, test them, and set defaults per type (kitchen, receipt, bar).' },
      { q: 'How do I fix "Could not connect to backend"?', a: 'Check that the backend server is running on the expected port/IP, that this device is on the same network, and the API URL in the terminal configuration points to the correct address.' },
    ],
  },
  {
    id: 'privacy',
    title: 'Data & Privacy',
    icon: '🔒',
    items: [
      { q: 'How is my restaurant\u2019s data kept separate from others?', a: 'The platform is multi-tenant — every query is scoped to your restaurant server-side. Another restaurant can never access your orders, customers, or settings.' },
      { q: 'What happens to voice/AI data?', a: 'Voice entry sends audio to a speech-to-text provider only after you grant microphone permission. Raw audio is not kept beyond transcription unless retention is separately enabled. See the AI & Voice Data Disclosure in Settings → Legal & Compliance.' },
      { q: 'How do I export or request deletion of my data?', a: 'Settings → Legal & Compliance has Data Rights actions: request a copy of your data (export) and request account closure. Requests are recorded and processed by the platform; legally-required business records are retained per applicable law.' },
    ],
  },
];

function countFaqs(): number {
  return FAQ_SECTIONS.reduce((sum, s) => sum + s.items.length, 0);
}

export default function HelpFaqTab() {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const totalFaqs = useMemo(() => countFaqs(), []);

  const toggle = (key: string) => setOpen((prev) => ({ ...prev, [key]: !prev[key] }));

  const q = query.trim().toLowerCase();
  const sections = useMemo(() => {
    if (!q) return FAQ_SECTIONS;
    return FAQ_SECTIONS.map((s) => ({
      ...s,
      items: s.items.filter((i) => i.q.toLowerCase().includes(q) || i.a.toLowerCase().includes(q)),
    })).filter((s) => s.items.length > 0);
  }, [q]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider flex items-center gap-2">
            <LifeBuoy className="w-4 h-4" /> Help & FAQ
          </h3>
          <p className="text-xs text-gray-500 mt-1">
            {totalFaqs} questions organised by topic. Use the search box to find an answer quickly.
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search FAQs…"
          className="w-full pl-9 pr-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-medium bg-white focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]/40"
        />
      </div>

      {/* FAQ sections */}
      {sections.map((section) => (
        <div key={section.id} className="rounded-2xl border border-[#e3e6ef] bg-white overflow-hidden">
          <div className="px-4 py-2.5 bg-gray-50 border-b border-[#e3e6ef] flex items-center gap-2">
            <span className="text-base">{section.icon}</span>
            <span className="text-xs font-bold text-gray-800 uppercase tracking-wider">{section.title}</span>
            <span className="ml-auto text-[10px] font-semibold text-gray-400">{section.items.length}</span>
          </div>
          <div className="divide-y divide-[#eef0f6]">
            {section.items.map((item, idx) => {
              const key = `${section.id}-${idx}`;
              const isOpen = !!open[key];
              return (
                <div key={key}>
                  <button
                    type="button"
                    onClick={() => toggle(key)}
                    className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
                  >
                    <span className="text-xs font-semibold text-gray-800">{item.q}</span>
                    {isOpen ? <ChevronUp className="w-4 h-4 text-gray-400 shrink-0" /> : <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />}
                  </button>
                  {isOpen && (
                    <div className="px-4 pb-3 text-xs leading-relaxed text-gray-600">{item.a}</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {sections.length === 0 && (
        <div className="rounded-2xl border border-[#e3e6ef] bg-white p-8 text-center">
          <p className="text-sm text-gray-500">No FAQ matches “{query}”. Try a different keyword.</p>
        </div>
      )}

      {/* Contact Us */}
      <div className="rounded-2xl border-2 border-[var(--brand-color)]/30 bg-gradient-to-br from-[var(--brand-color)]/5 to-transparent p-5">
        <h4 className="text-sm font-bold text-gray-900 flex items-center gap-2">
          <MessageCircle className="w-4 h-4" /> Contact Us
        </h4>
        <p className="text-xs text-gray-600 mt-1.5 leading-relaxed">
          Can't find what you're looking for? Reach out to our support team and we'll help you out.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="flex items-center gap-3 rounded-xl border border-[#e3e6ef] bg-white px-4 py-3 hover:border-[var(--brand-color)]/50 transition-colors"
          >
            <span className="w-9 h-9 rounded-full bg-[var(--brand-color)]/10 flex items-center justify-center shrink-0">
              <Mail className="w-4 h-4 text-[var(--brand-color)]" />
            </span>
            <span className="min-w-0">
              <span className="block text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Email</span>
              <span className="block text-xs font-bold text-gray-800 truncate">{SUPPORT_EMAIL}</span>
            </span>
          </a>
          <a
            href={`tel:${SUPPORT_PHONE}`}
            className="flex items-center gap-3 rounded-xl border border-[#e3e6ef] bg-white px-4 py-3 hover:border-[var(--brand-color)]/50 transition-colors"
          >
            <span className="w-9 h-9 rounded-full bg-[var(--brand-color)]/10 flex items-center justify-center shrink-0">
              <Phone className="w-4 h-4 text-[var(--brand-color)]" />
            </span>
            <span className="min-w-0">
              <span className="block text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Phone</span>
              <span className="block text-xs font-bold text-gray-800">{SUPPORT_PHONE}</span>
            </span>
          </a>
        </div>
        <p className="text-[10px] text-gray-400 mt-3">
          Support hours and response times are subject to the platform's service terms. For legal documents, see
          Settings → Legal &amp; Compliance.
        </p>
      </div>
    </div>
  );
}
