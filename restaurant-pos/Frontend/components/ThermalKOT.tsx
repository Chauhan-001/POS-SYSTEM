/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ThermalKOT — the single source of truth for the kitchen order ticket body.
 *
 * Rendered by:
 *  - printKOT (the real paper KOT sent to the kitchen at billing time)
 *  - SettingsManager → KOT & KITCHEN (live WYSIWYG preview of the printed ticket)
 *
 * All critical layout uses inline styles (no Tailwind dependency) so the exact
 * same markup can be server-rendered into the print iframe via
 * renderToStaticMarkup — meaning the Settings preview always matches the
 * printed KOT, and the KOT layout toggles affect the real print too.
 */

import React from 'react';
import { CartItem, SystemSettings } from '../src/types';
import { formatKOTTimestamp } from '../src/utils/kotTime';

interface ThermalKOTProps {
  order: {
    orderNumber: number;
    tableNumber?: number;
    type?: string;
    waiterName?: string;
    customerName?: string;
  };
  kot: {
    kotNumber: number;
    type?: string;
    printedAt: string;
    printedBy: string;
    items: CartItem[];
    note?: string;
  };
  settings: SystemSettings;
  /** Extra classes for on-screen presentation (not used by the print iframe). */
  className?: string;
}

export default function ThermalKOT({ order, kot, settings, className }: ThermalKOTProps) {
  const restaurantName = settings.restaurantName || 'KITCHEN ORDER TICKET';
  const footerNote = settings.kotFooterNote;
  const width = settings.printSize === '58mm' ? '220px' : '280px';
  const showModifiers = settings.showItemModifiers !== false;
  const showTable = settings.showTableNumber !== false;
  const showTime = settings.showOrderTime !== false;
  const groupItems = settings.groupItemsInKOT === true;
  const showCategoryHeaders = settings.printCategoryHeaders === true;

  const baseStyle: React.CSSProperties = {
    boxSizing: 'border-box',
    color: '#000',
    fontFamily: "'Courier New', monospace",
    background: '#fff',
    margin: '0 auto',
    width,
  };

  const hrStyle: React.CSSProperties = { border: 'none', borderTop: '1px dashed #000', margin: '8px 0' };

  const itemRow = (item: CartItem) => (
    <React.Fragment key={item.id}>
      <tr>
        <td style={{ width: 38, padding: '2px 0', verticalAlign: 'top', fontWeight: 700 }}>{item.quantity}x</td>
        <td style={{ padding: '2px 0', verticalAlign: 'top', fontWeight: 600 }}>
          {item.product?.name || 'Item'}
          {/* Configured items carry the resolved summary ("Large • Cheese Burst")
              — selectedVariant alone only covers simple variant products. */}
          {showModifiers && (item.configSummary || item.selectedVariant?.name)
            ? ` [${item.configSummary || item.selectedVariant?.name}]`
            : ''}
        </td>
      </tr>
      {showModifiers && item.notes ? (
        <tr key={`note-${item.id}`}>
          <td style={{ width: 38, padding: '2px 0', verticalAlign: 'top' }} />
          <td style={{ padding: '2px 0', verticalAlign: 'top' }}>
            <div style={{ fontSize: 9, color: '#333', paddingLeft: 8 }}>- {item.notes}</div>
          </td>
        </tr>
      ) : null}
    </React.Fragment>
  );

  const buildRows = (): React.ReactNode[] => {
    const rows: React.ReactNode[] = [];
    const items = kot.items || [];
    if (groupItems) {
      const groups: Record<string, CartItem[]> = {};
      items.forEach((item) => {
        const cat = item.product?.category || 'General';
        (groups[cat] = groups[cat] || []).push(item);
      });
      Object.entries(groups).forEach(([cat, items]) => {
        if (showCategoryHeaders) {
          rows.push(
            <tr key={`cat-${cat}`}>
              <td
                colSpan={2}
                style={{ padding: '4px 0 2px', fontWeight: 700, fontSize: 9, letterSpacing: 1, color: '#333', borderBottom: '1px dashed #000' }}
              >
                --- {cat.toUpperCase()} ---
              </td>
            </tr>
          );
        }
        items.forEach((item) => rows.push(itemRow(item)));
      });
    } else {
      items.forEach((item) => rows.push(itemRow(item)));
    }
    return rows;
  };

  return (
    <div className={className} style={baseStyle}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: 1 }}>{restaurantName}</div>
        <div style={{ fontSize: 13, fontWeight: 700, marginTop: 5 }}>KITCHEN ORDER TICKET #{kot.kotNumber}</div>
        <div style={{ fontSize: 11, fontWeight: 700, marginTop: 3 }}>
          Order #{order.orderNumber}
          {showTable && order.tableNumber ? ` - Table ${order.tableNumber}` : ''}
        </div>
        <div style={{ fontSize: 10, marginTop: 6, lineHeight: 1.5 }}>
          {kot.type}
          {showTime ? `  |  ${formatKOTTimestamp(kot.printedAt)}` : ''}
          <br />
          By: {kot.printedBy}
        </div>
      </div>
      <hr style={hrStyle} />
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8, fontSize: 11 }}>
        <tbody>{buildRows()}</tbody>
      </table>
      <hr style={hrStyle} />
      {footerNote ? (
        <div style={{ fontSize: 9, textAlign: 'center', marginTop: 8, whiteSpace: 'pre-wrap' }}>{footerNote}</div>
      ) : null}
    </div>
  );
}
