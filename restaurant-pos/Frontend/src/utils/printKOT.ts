/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Offline-capable KOT (Kitchen Order Ticket) paper printing.
 * Renders the shared ThermalKOT component to static markup and triggers the
 * browser/thermal print dialog via a hidden iframe. Purely local — no network
 * dependency — so it works whether the terminal is online or offline, even if
 * the ticket can't reach a remote kitchen display.
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Order, KOTRecord } from '../types';
import ThermalKOT from '../../components/ThermalKOT';

/** Build the KOT ticket HTML (used by the print iframe) — same markup as the Settings preview. */
function buildKotHtml(order: Order, kot: KOTRecord, settings?: any): string {
  const body = renderToStaticMarkup(
    React.createElement(ThermalKOT, { order, kot, settings: settings || {} })
  );

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>KOT #${kot.kotNumber} - Order ${order.orderNumber}</title>
<style>
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin: 0; padding: 16px; display: flex; justify-content: center; background: #fff; }
  @media print { body { padding: 0; } @page { margin: 4mm; } }
</style>
</head>
<body>
${body}
</body>
</html>`;
}

/**
 * Print a KOT ticket. Uses a hidden iframe so it never opens a popup and is
 * immune to popup blockers, even when triggered from a delayed auto-print.
 */
export function printKOT(order: Order, kot: KOTRecord, settings?: any): void {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(iframe);

  const cleanup = () => {
    try { document.body.removeChild(iframe); } catch { /* already removed */ }
  };

  iframe.onload = () => {
    setTimeout(() => {
      try {
        const win = iframe.contentWindow;
        if (win) { win.focus(); win.print(); }
      } catch (e) {
        console.warn('[KOT] paper print failed:', e);
      }
      setTimeout(cleanup, 5000);
    }, 250);
  };

  const doc = iframe.contentDocument;
  if (!doc) { cleanup(); return; }
  doc.open();
  doc.write(buildKotHtml(order, kot, settings));
  doc.close();
}
