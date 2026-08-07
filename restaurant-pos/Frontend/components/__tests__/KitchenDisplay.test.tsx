/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for KitchenDisplay — verifies KOT type badge colors and labels
 * render correctly for each KOT type (Original, Additional, Reprint).
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import type { Order, KOTRecord } from '../../src/types';

// KitchenDisplay is a default export from components/KitchenDisplay
import KitchenDisplay from '../KitchenDisplay';

/** Helper: create a minimal KOT record */
function createKOT(
  type: KOTRecord['type'],
  kotNumber: number,
  overrides: Partial<KOTRecord> = {}
): KOTRecord {
  return {
    id: `kot_${kotNumber}`,
    kotNumber,
    type,
    status: 'Accepted',
    items: [
      {
        id: 'item_1',
        product: {
          id: 'prod_1',
          name: 'Test Item',
          price: 10,
          category: 'Main',
          image: '',
          gstPercent: 5,
          availability: true,
          code: 'T001',
        },
        quantity: 2,
        price: 10,
      },
    ],
    printedAt: new Date().toISOString(),
    printedBy: 'Cashier',
    ...overrides,
  };
}

/** Helper: create a minimal Order with KOT records */
function createOrderWithKOTs(kots: KOTRecord[]): Order {
  return {
    id: 'order_1',
    orderNumber: 1001,
    type: 'Dine In',
    status: 'Accepted',
    tableNumber: 5,
    waiterName: 'John',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    items: kots.flatMap((k) => k.items),
    kotRecords: kots,
    timeline: [],
    interimBillPrinted: false,
    finalBillPrinted: false,
    subtotal: 20,
    discount: 0,
    gst: 1,
    grandTotal: 21,
  };
}

describe('KitchenDisplay — KOT Type Badge Rendering', () => {
  const mockUpdateKOTStatus = vi.fn();

  it('should NOT render a badge for Original KOT type', () => {
    const kots = [createKOT('Original', 1)];
    const order = createOrderWithKOTs(kots);

    render(
      <KitchenDisplay
        orders={[order]}
        onUpdateKOTStatus={mockUpdateKOTStatus}
      />
    );

    // Original KOTs: no badge, just the order number in the header
    expect(screen.getByText('#1001')).toBeInTheDocument();

    // Original badge text should NOT be present
    expect(screen.queryByText(/ORIGINAL KOT/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/ADDITIONAL KOT/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/REPRINT KOT/i)).not.toBeInTheDocument();
  });

  it('should render an amber-colored badge with "ADDITIONAL" for Additional KOT type', () => {
    const kots = [createKOT('Additional', 2)];
    const order = createOrderWithKOTs(kots);
    // Need an original KOT too so the card is non-empty
    const origKots = [createKOT('Original', 1), ...kots];
    const origOrder = createOrderWithKOTs(origKots);

    render(
      <KitchenDisplay
        orders={[origOrder]}
        onUpdateKOTStatus={mockUpdateKOTStatus}
      />
    );

    // The Additional KOT badge should render
    const badge = screen.getByText(/ADDITIONAL KOT #2/);
    expect(badge).toBeInTheDocument();

    // Should have the amber-50 background class (amber = AMber)
    expect(badge.className).toContain('bg-amber-50');
    expect(badge.className).toContain('text-amber-700');
    expect(badge.className).toContain('border-amber-200');
  });

  it('should render a red-colored badge with "REPRINT" for Reprint KOT type', () => {
    const kots = [createKOT('Reprint', 3)];
    const order = createOrderWithKOTs(kots);
    // Need an original KOT too for context
    const origKots = [createKOT('Original', 1), ...kots];
    const origOrder = createOrderWithKOTs(origKots);

    render(
      <KitchenDisplay
        orders={[origOrder]}
        onUpdateKOTStatus={mockUpdateKOTStatus}
      />
    );

    // The Reprint KOT badge should render
    const badge = screen.getByText(/REPRINT KOT #3/);
    expect(badge).toBeInTheDocument();

    // Should have the red color classes
    expect(badge.className).toContain('bg-red-50');
    expect(badge.className).toContain('text-red-700');
    expect(badge.className).toContain('border-red-200');
  });

  it('should render both Additional and Reprint badges when both are present', () => {
    const origKot = createKOT('Original', 1);
    const addKot = createKOT('Additional', 2);
    const repKot = createKOT('Reprint', 3);
    const order = createOrderWithKOTs([origKot, addKot, repKot]);

    render(
      <KitchenDisplay
        orders={[order]}
        onUpdateKOTStatus={mockUpdateKOTStatus}
      />
    );

    // Both badges should be present
    expect(screen.getByText(/ADDITIONAL KOT #2/)).toBeInTheDocument();
    expect(screen.getByText(/REPRINT KOT #3/)).toBeInTheDocument();
  });

  it('should render KOT type in the footer for all types', () => {
    const kots = [
      createKOT('Original', 1),
      createKOT('Additional', 2),
      createKOT('Reprint', 3),
    ];
    const order = createOrderWithKOTs(kots);

    render(
      <KitchenDisplay
        orders={[order]}
        onUpdateKOTStatus={mockUpdateKOTStatus}
      />
    );

    // Footer shows "KOT #{number} · {type}" for each KOT
    const kotsInFooter = screen.getAllByText(/KOT #\d+ ·/);
    // There are 3 KOT records, each in its own card
    expect(kotsInFooter.length).toBe(3);
    expect(kotsInFooter[0]).toHaveTextContent(/KOT #1 · Original/);
    expect(kotsInFooter[1]).toHaveTextContent(/KOT #2 · Additional/);
    expect(kotsInFooter[2]).toHaveTextContent(/KOT #3 · Reprint/);
  });

  it('should filter out Served KOTs from the display', () => {
    const servedKot = createKOT('Original', 1, { status: 'Served' });
    const activeKot = createKOT('Additional', 2);
    const order = createOrderWithKOTs([servedKot, activeKot]);

    render(
      <KitchenDisplay
        orders={[order]}
        onUpdateKOTStatus={mockUpdateKOTStatus}
      />
    );

    // Served KOT should not appear
    expect(screen.queryByText(/KOT #1 · Original/)).not.toBeInTheDocument();
    // Active KOT should appear
    expect(screen.getByText(/ADDITIONAL KOT #2/)).toBeInTheDocument();
  });
});
