/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * HelpFaqTab — Settings → HELP & FAQ.
 *
 * Frequently-asked questions organised into sections (Ordering, Menu &
 * Configuration, Billing & Payments, Offline & Sync, Kitchen & KOT, Tables &
 * QR Ordering, Inventory & Recipes, Loyalty & Offers, Account & Settings,
 * Devices & Technical, Data & Privacy) plus a Contact Us card.
 *
 * Contact details are kept here in ONE place (also mirrored in the backend
 * legal docs seed) — edit this single file to change them.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, ChevronDown, ChevronUp, LifeBuoy, Mail, Phone, MessageCircle, BarChart3 } from 'lucide-react';
import { trackHelpView, trackHelpSearch, fetchHelpAnalytics } from '../src/api/client';

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
      { q: 'How do I take an order for a table?', a: 'Open the Orders tab and tap the table card. The billing workspace opens with an empty cart — the table is NOT occupied yet. Select items from the menu, add quantities, then press KOT. The order is created and the table becomes occupied only when the first KOT is sent to the kitchen, so an accidental table tap never books a table.' },
      { q: 'Why is my table not showing as occupied after I tapped it?', a: 'Tapping a table only opens the billing workspace. The table stays Available until you send a KOT with items — the order (and the Occupied state) is born with the first KOT. This prevents accidental table taps from occupying tables.' },
      { q: 'Can a customer order from the table QR while another order is open?', a: 'No — a table with a live (open) order is blocked from placing a second QR order, and the same guard also stops a new POS order from being created on it. The customer is shown a message to ask their server for additions. Once the bill is settled, the table is freed for new orders.' },
      { q: 'How do online (customer site) orders work?', a: 'Customers scan the QR sticker, browse the menu, and place an order. It appears instantly in Orders and in the Calls panel as an online-order call, so nothing is missed. It also occupies the table on the floor plan. Every item is sent to the kitchen automatically (auto-KOT), unless your Online Order KOT setting is set to wait for cashier review.' },
      { q: 'How do I add items to an existing order?', a: 'Open the table in Orders, tap "Order", and add the new items. They are added to the same bill/KOT flow with an "Additional KOT" when auto-print is on.' },
      { q: 'What is a takeaway order?', a: 'Takeaway orders are placed for pickup without a table. Use the Takeaway tab in Orders, or the customer site Pickup mode, and the order flows through the same billing and kitchen pipeline.' },
      { q: 'Can I hold an order and resume later?', a: 'Yes — use the Hold feature in billing. Held orders can be resumed from the Orders screen and remain available until billed or discarded.' },
    ],
  },
  {
    id: 'menu-config',
    title: 'Menu & Configuration',
    icon: '🧩',
    items: [
      { q: 'What are variants, customizations and add-ons?', a: 'Products can have optional configuration: Variants (e.g. Small/Medium/Large size, with a price each), Customizations / modifier groups (e.g. crust, toppings — required or optional, single or multi-select), and Add-ons (extra items like an extra drink). The POS and the customer website render the exact same configuration.' },
      { q: 'How do I make a product configurable?', a: 'Open Menu → the product editor → Configuration. Add a variant group, a customization (modifier) group, or an add-on group, then define the options and their prices. You can build a reusable configuration template and attach it to many products.' },
      { q: 'What is a reusable configuration template?', a: 'A template (e.g. "Pizza Sizes") holds a set of groups (variants, customizations, add-ons). You attach the template to any number of products. When you edit the template, every product attached to it reflects the change — the editor shows how many products will be affected before you save.' },
      { q: 'Can two products share one configuration without affecting each other?', a: 'Yes, three ways: Shared (products stay linked to the template — edits affect all of them), Customized (the product starts from the template but has its own overrides), and Independent copy (a full copy that is never affected by later template edits). The configuration screen shows which mode each product uses.' },
      { q: 'How does the price of a configured item get calculated?', a: 'One central pricing engine calculates it: base price + variant price + customization prices + add-on prices, then offers/discounts and tax. The exact same engine runs on the POS, on the customer website, and offline — so the price is always the same everywhere.' },
      { q: 'I deleted an option — why does an old bill still show it?', a: 'Options are soft-archived, never physically removed from history. Each bill stores an immutable snapshot of the items and prices at sale time, so old bills and reports always display what was actually ordered — even if the menu changed later.' },
    ],
  },
  {
    id: 'billing',
    title: 'Billing & Payments',
    icon: '💳',
    items: [
      { q: 'How do I print a bill?', a: 'Open the table/order, tap Bill, review the receipt preview, and tap Print. Paper size (80mm/58mm) and receipt sections are configured in Settings → Billing & Invoice.' },
      { q: 'Which payment methods are supported?', a: 'Cash, card (through your payment provider), UPI/QR where configured, and online payment via the customer site. Methods appear in billing and in Reports → Payment Methods.' },
      { q: 'How is GST calculated?', a: 'Tax rates are set in Settings → Billing & Invoice (GST presets 5%/12%/18% or custom). GST appears on the bill with CGST/SGST splits when enabled. The same tax rules apply on the POS, the customer website, and offline bills.' },
      { q: 'Can I give a discount?', a: 'Yes — discounts can be applied at billing if the Discount on Billing module is enabled (Settings → Modules). Loyalty point redemptions and offer coupons also apply. The applied discount is stored on the bill, so history never changes even if the offer changes later.' },
      { q: 'Can I edit or duplicate a configured item in the cart?', a: 'Yes — tap Edit to reopen the configuration with the existing selections (variants, customizations, add-ons) and change them; the price recalculates instantly. Duplicate makes an exact copy. Two items with the identical configuration merge into a single line with combined quantity.' },
      { q: 'What happens if a payment fails?', a: 'The order stays open and no bill is marked paid. You can retry the payment or switch methods. Partial/held payments are tracked on the bill.' },
      { q: 'Can I split a bill across multiple payment methods?', a: 'Yes — set the payment method to Split and use the Split Calculator to divide the total between Cash, Card, UPI and Wallet. The split applies to the final bill total, so it works exactly the same for simple and configured items (variants, customizations and add-ons are already included in that total). The split amounts are recorded on the bill and shown in Reports → Payment Methods.' },
      { q: 'How is “today” defined for revenue reports — can I set business hours?', a: 'Settings → Billing & Invoice → Business Hours (default 08:00 → 23:59). A business day runs from the opening time until the next day’s opening time — a bill stamped at 03:00 belongs to the PREVIOUS business day, so late-night sales roll into yesterday instead of creating an empty “today”. Today’s Revenue, the Z-Report and the hourly charts all use this window.' },
    ],
  },
  {
    id: 'offline',
    title: 'Offline & Sync',
    icon: '📡',
    items: [
      { q: 'What happens when the internet goes down?', a: 'The POS keeps working offline — you can keep taking orders, configuring products, billing, and printing receipts. Orders and bills are stored locally on the device and queued for sync. The status bar shows "Offline" so you always know.' },
      { q: 'Will my offline bills survive a restart or power cut?', a: 'Yes — offline bills and orders are written to durable local storage on the device, not just memory. They survive app restarts, computer restarts and power interruptions, and sync automatically when the connection returns.' },
      { q: 'How do offline bills get to the server?', a: 'A sync queue holds them with statuses: Pending → Syncing → Synced (or Failed with Retry). Syncing is idempotent — each transaction has a unique client transaction ID, so retries and restarts can never create a duplicate order or bill on the server.' },
      { q: 'Will my offline bill price change after it syncs?', a: 'No. Every bill stores an immutable pricing snapshot (item prices, variants, customizations, add-ons, discounts, tax) from the moment of sale. Even if you change menu prices later, the historical bill keeps its original amounts.' },
      { q: 'How do I know a sync failed?', a: 'The status bar and the Offline Bills view show sync state (Pending / Syncing / Synced / Failed) with a manual Retry option. The cashier never needs to see technical errors — just "1 bill failed to sync".' },
    ],
  },
  {
    id: 'kitchen',
    title: 'Kitchen & KOT',
    icon: '🍳',
    items: [
      { q: 'What is a KOT?', a: 'A Kitchen Order Ticket — the list of items sent to the kitchen when an order is placed. It shows the table, items, quantities, and notes, and is displayed on the Kitchen board.' },
      { q: 'What do configured items look like on a KOT?', a: 'A KOT shows the full configuration in plain language — e.g. "Margherita Pizza [Large • Cheese Burst] ×1" — so the kitchen knows exactly what to prepare. Internal IDs and version numbers are never shown.' },
      { q: 'How do KOTs reach the kitchen?', a: 'New orders create KOTs instantly on the Kitchen Display. If Auto Print KOT is enabled (Settings → Modules), the KOT also prints to the configured kitchen printer.' },
      { q: 'Do online orders appear in the kitchen?', a: 'Yes — every customer-site order creates an auto-KOT that appears on the kitchen board and prints when auto-print is on. You can also set online orders to wait for cashier review before the KOT is sent.' },
      { q: 'Can I choose whether online orders go to the kitchen automatically?', a: 'Yes — Settings → Kitchen → Online Order KOT. With "Auto-send to kitchen" ON (the default), the KOT fires the moment an online/QR order is placed. Turn it OFF and the order arrives in Orders WITHOUT a KOT: open it in the billing workspace, review the items, then press the KOT button to send it to the kitchen yourself. This lets the cashier check every customer order before the kitchen starts.' },
      { q: 'What are the KOT stages?', a: 'New → Accepted → Preparing → Ready → Served. Kitchen staff tap "Start Preparing" to move a KOT to Preparing, and mark it Ready when the food is done.' },
      { q: 'How do I reprint a KOT?', a: 'Open the order in billing/kitchen and use the reprint KOT option. Manual reprints always go to the printer regardless of the auto-print toggle.' },
    ],
  },
  {
    id: 'tables-qr',
    title: 'Tables & QR Ordering',
    icon: '🪑',
    items: [
      { q: 'How do I add or edit tables?', a: 'Use Orders → Manage Tables, or Settings. Tables are grouped by floor/section (Window, Outdoor, Family, VIP, Main Hall) and shown on the floor plan.' },
      { q: 'How do I get QR codes for my tables?', a: 'Open More → QR Studio. Every table always has a QR code — new tables get one automatically the moment they are created, and any table missing one is generated for you automatically when QR Studio opens. Just print the stickers and place them on the tables.' },
      { q: 'Why does QR Studio only show some tables?', a: 'QR Studio shows tables of the branch currently selected in the top bar. Switch branches to see that branch’s tables. Deleted tables are never shown.' },
      { q: 'How does a table become Occupied?', a: 'A table is occupied when it has a live order — a dine-in order (born when its first KOT is sent) or a live QR/online order. Free tables show "Tap to seat" on the floor plan.' },
      { q: 'Can two guests order from the same table QR at the same time?', a: 'No — the first seating to scan claims the table, and a table with a live order (from the POS or QR) is locked. The second scan gets a clear message to ask the server. This prevents double orders and double stock deductions.' },
      { q: 'What happens if a table QR is scanned while the cashier is billing that table?', a: 'If the cashier has already sent a KOT (order created), the QR scan is rejected. If the cashier only opened the billing workspace (no order yet), the customer can still claim the table — the first of the two to create an order wins, and the other side is blocked with a clear message.' },
    ],
  },
  {
    id: 'inventory',
    title: 'Inventory & Recipes',
    icon: '📦',
    items: [
      { q: 'How does selling a product affect inventory?', a: 'When a bill is completed, the system consumes inventory based on the product’s recipe. If a product has variants or customizations with recipe impacts (e.g. Large pizza uses more dough, Cheese Burst adds more cheese), those amounts are added and deducted together in one aggregated consumption event.' },
      { q: 'What is a recipe?', a: 'A recipe defines the ingredients (and quantities) needed to make a product. Variant options and customization options can add their own ingredient amounts, so a configured item consumes exactly what was ordered — never just the base recipe.' },
      { q: 'Can the same sale deduct stock twice?', a: 'No — there is exactly one authoritative inventory consumption event per completed sale, recorded in the inventory ledger with a reference to the bill. Even if a sync is retried, the transaction ID prevents double deduction.' },
      { q: 'Is stock the same as menu availability?', a: 'No. A product or option can be out of stock in inventory while still being an active menu configuration — the configuration is never deleted because stock is zero. The POS/customer site surface availability separately.' },
    ],
  },
  {
    id: 'loyalty',
    title: 'Loyalty & Offers',
    icon: '🎁',
    items: [
      { q: 'How does the loyalty program work?', a: 'Customers earn points on paid bills based on your points-per-currency settings. Points can be redeemed for discounts or rewards you configure in Loyalty settings.' },
      { q: 'How do I create an offer or coupon?', a: 'Use More → Offers to create offers (percentage/flat), coupons, and schedules. Live offers appear on the customer site and can be redeemed at billing. The offer applied to a bill is stored with the bill, so history stays accurate.' },
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
      { q: 'How do I switch between staff quickly on one terminal?', a: 'Press the Exit button and choose Position + PIN — pick the employee and enter their 4-digit PIN to switch shifts without a full logout. The same lock screen appears when the terminal auto-locks after idle time. A PIN switch clears the current cart/order so the next cashier starts fresh.' },
      { q: 'How do I change restaurant details (name, GSTIN, address)?', a: 'Settings → Billing & Invoice holds your GSTIN, name, phone, address, invoice numbering and paper size. Save with a change reason for the audit trail.' },
      { q: 'How do I manage branches?', a: 'Use More → Branches to add/rename branches and assign tables. The top-bar branch selector switches the active branch; data is fetched fresh from the backend on switch. Deleting a branch requires the owner password — it is never an accidental one-click action.' },
      { q: 'How do I update the theme or language?', a: 'Settings → Theme controls appearance (light/dark/system, brand colour, density). Language/region options are under general settings.' },
      { q: 'Where do I see new customer orders and service calls?', a: 'The CALLS panel in the left sidebar shows every customer service request (water, waiter, bill) and online order in real time. Acknowledge silences the repeating reminder immediately — on every connected terminal, not just the one that clicked — while the card stays live. The card is only marked done automatically once that order’s bill is closed, so nothing is ever marked complete prematurely.' },
    ],
  },
  {
    id: 'devices',
    title: 'Devices & Technical',
    icon: '🖥️',
    items: [
      { q: 'How many devices can connect?', a: 'The number of POS terminals depends on your subscription plan’s device limit. Devices are managed in Settings/Admin and can be approved or blocked.' },
      { q: 'How do I connect a printer?', a: 'Settings → Printers lets you add network/USB/Bluetooth printers, test them, and set defaults per type (kitchen, receipt, bar).' },
      { q: 'How do I fix "Could not connect to backend"?', a: 'Check that the backend server is running on the expected port/IP, that this device is on the same network, and the API URL in the terminal configuration points to the correct address.' },
      { q: 'Can the terminal lock itself when idle?', a: 'Yes — Settings → Security → Auto-Lock Idle Timeout (Off, 1, 5, 10 or 15 minutes). After the configured time with no activity the terminal locks and asks for the sign-in method to resume, so an unattended register can never be used by someone else.' },
      { q: 'How do menu updates reach this device?', a: 'The POS keeps a local copy of the menu catalog (products, prices, configurations, tax and offline-safe offer rules) with a catalog version number. When the connection returns, it detects a newer server version and updates atomically — you are never left with a half-updated menu.' },
    ],
  },
  {
    id: 'privacy',
    title: 'Data & Privacy',
    icon: '🔒',
    items: [
      { q: 'How is my restaurant’s data kept separate from others?', a: 'The platform is multi-tenant — every query is scoped to your restaurant server-side. Another restaurant can never access your orders, customers, or settings, even through offline sync (the server verifies tenant identity on every sync).' },
      { q: 'What happens to voice/AI data?', a: 'Voice entry sends audio to a speech-to-text provider only after you grant microphone permission. Raw audio is not kept beyond transcription unless retention is separately enabled. See the AI & Voice Data Disclosure in Settings → Legal & Compliance.' },
      { q: 'How do I export or request deletion of my data?', a: 'Settings → Legal & Compliance has Data Rights actions: request a copy of your data (export) and request account closure. Requests are recorded and processed by the platform; legally-required business records are retained per applicable law.' },
    ],
  },
];

function countFaqs(): number {
  return FAQ_SECTIONS.reduce((sum, s) => sum + s.items.length, 0);
}

interface HelpStats {
  views: Array<{ contentType: string; contentKey: string; contentTitle: string; count: number; lastViewedAt?: string }>;
  searches: Array<{ contentType: string; query: string; resultCount?: number; count: number; lastSearchedAt?: string }>;
  totalViews: number;
  totalSearches: number;
}

export default function HelpFaqTab({ isOwner }: { isOwner?: boolean }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [stats, setStats] = useState<HelpStats | null>(null);
  const [statsError, setStatsError] = useState(false);

  const totalFaqs = useMemo(() => countFaqs(), []);

  const toggle = (key: string, sectionId: string, question: string) => {
    const isOpen = !!open[key];
    setOpen((prev) => ({ ...prev, [key]: !prev[key] }));
    // Record the view ONLY when the question is being OPENED (not closed),
    // so re-expanding the same question counts once per open.
    if (!isOpen) {
      trackHelpView('faq', `${sectionId}:${key}`, question);
    }
  };

  const openFaq = (sectionId: string, idx: number, question: string) => {
    toggle(`${sectionId}-${idx}`, sectionId, question);
  };

  const q = query.trim().toLowerCase();
  const sections = useMemo(() => {
    if (!q) return FAQ_SECTIONS;
    return FAQ_SECTIONS.map((s) => ({
      ...s,
      items: s.items.filter((i) => i.q.toLowerCase().includes(q) || i.a.toLowerCase().includes(q)),
    })).filter((s) => s.items.length > 0);
  }, [q]);

  // Record the search query (with result count) so unanswered searches reveal
  // help-content gaps. Debounced so typing doesn't fire an event per keystroke.
  const lastTrackedSearchRef = React.useRef<string>('');
  useEffect(() => {
    if (!q) return;
    const timer = setTimeout(() => {
      if (lastTrackedSearchRef.current === q) return;
      lastTrackedSearchRef.current = q;
      trackHelpSearch(query, sections.length);
    }, 700);
    return () => clearTimeout(timer);
  }, [q, query, sections.length]);

  // Owners/managers see which questions & documents are actually being read
  // so the help can be improved based on real usage.
  const loadStats = useCallback(() => {
    if (!isOwner) return;
    fetchHelpAnalytics()
      .then((data: any) => {
        if (data) setStats(data);
      })
      .catch(() => setStatsError(true));
  }, [isOwner]);
  useEffect(() => {
    if (isOwner) loadStats();
  }, [isOwner, loadStats]);

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
          className="w-full pl-9 pr-3 py-2 rounded-xl border border-[var(--color-border-input)] text-xs font-medium bg-[var(--color-bg-white)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]/40"
        />
      </div>

      {/* FAQ sections */}
      {sections.map((section) => (
        <div key={section.id} className="rounded-2xl border border-[var(--color-surface-muted)] bg-[var(--color-bg-white)] overflow-hidden">
          <div className="px-4 py-2.5 bg-gray-50 border-b border-[var(--color-surface-muted)] flex items-center gap-2">
            <span className="text-base">{section.icon}</span>
            <span className="text-xs font-bold text-gray-800 uppercase tracking-wider">{section.title}</span>
            <span className="ml-auto text-[10px] font-semibold text-gray-400">{section.items.length}</span>
          </div>
          <div className="divide-y divide-[var(--color-surface-muted)]">
            {section.items.map((item, idx) => {
              const key = `${section.id}-${idx}`;
              const isOpen = !!open[key];
              return (
                <div key={key}>
                  <button
                    type="button"
                    onClick={() => openFaq(section.id, idx, item.q)}
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
        <div className="rounded-2xl border border-[var(--color-surface-muted)] bg-[var(--color-bg-white)] p-8 text-center">
          <p className="text-sm text-gray-500">No FAQ matches “{query}”. Try a different keyword.</p>
        </div>
      )}

      {/* Owner insights — which help content is actually being read */}
      {isOwner && (
        <div className="rounded-2xl border border-[var(--color-surface-muted)] bg-[var(--color-bg-white)] overflow-hidden">
          <div className="px-4 py-2.5 bg-gray-50 border-b border-[var(--color-surface-muted)] flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-[var(--brand-color)]" />
            <span className="text-xs font-bold text-gray-800 uppercase tracking-wider">Help usage insights</span>
            <span className="ml-auto text-[10px] font-semibold text-gray-400">Owner only</span>
          </div>
          <div className="p-4 space-y-4">
            {statsError ? (
              <p className="text-xs text-gray-400">Could not load help analytics. Check the connection and refresh.</p>
            ) : !stats ? (
              <p className="text-xs text-gray-400">Loading usage data…</p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl border border-[var(--color-surface-muted)] bg-gray-50 px-3 py-2">
                    <p className="text-lg font-bold text-[var(--brand-color)]">{stats.totalViews ?? 0}</p>
                    <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Questions opened</p>
                  </div>
                  <div className="rounded-xl border border-[var(--color-surface-muted)] bg-gray-50 px-3 py-2">
                    <p className="text-lg font-bold text-[var(--brand-color)]">{stats.totalSearches ?? 0}</p>
                    <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Searches</p>
                  </div>
                </div>

                <div>
                  <p className="text-[11px] font-bold text-gray-700 uppercase tracking-wider mb-1.5">Most-read questions</p>
                  {(!stats.views || stats.views.length === 0) ? (
                    <p className="text-xs text-gray-400">No FAQ or legal content has been opened yet.</p>
                  ) : (
                    <div className="space-y-1">
                      {stats.views.slice(0, 8).map((v: any) => (
                        <div key={`${v.contentType}-${v.contentKey}`} className="flex items-center justify-between gap-3 rounded-lg bg-gray-50 px-3 py-1.5">
                          <span className="text-[11px] text-gray-600 truncate">{v.contentTitle || v.contentKey}</span>
                          <span className="text-[11px] font-bold text-gray-800 shrink-0">{v.count}×</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <p className="text-[11px] font-bold text-gray-700 uppercase tracking-wider mb-1.5">Recent searches{stats.searches?.some((s: any) => s.resultCount === 0) ? ' · zero-result queries flagged' : ''}</p>
                  {(!stats.searches || stats.searches.length === 0) ? (
                    <p className="text-xs text-gray-400">No FAQ searches yet.</p>
                  ) : (
                    <div className="space-y-1">
                      {stats.searches.slice(0, 6).map((s: any, i: number) => (
                        <div key={`${s.query}-${i}`} className="flex items-center justify-between gap-3 rounded-lg bg-gray-50 px-3 py-1.5">
                          <span className="text-[11px] text-gray-600 truncate">“{s.query}”{s.resultCount === 0 ? ' — no match' : ''}</span>
                          <span className="text-[11px] font-bold text-gray-800 shrink-0">{s.count}×</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
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
            className="flex items-center gap-3 rounded-xl border border-[var(--color-surface-muted)] bg-[var(--color-bg-white)] px-4 py-3 hover:border-[var(--brand-color)]/50 transition-colors"
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
            className="flex items-center gap-3 rounded-xl border border-[var(--color-surface-muted)] bg-[var(--color-bg-white)] px-4 py-3 hover:border-[var(--brand-color)]/50 transition-colors"
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
