/**
 * VoicePage — proves the Voice Inventory UI contract:
 *
 *   LEFT   mic button + text fallback
 *   RIGHT  generated cards (quantity / unit / cost, supplier, purchase date,
 *          expiry date, brand) + Confirm
 *   BOTTOM history of actions performed, each row carrying the recorded
 *          purchase details with BOTH an Undo and an Edit button.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import VoicePage from '../VoicePage';

const notify = vi.fn();
const refreshItems = vi.fn(async () => undefined);
const refreshEvents = vi.fn(async () => undefined);

vi.mock('../../InventoryManager', () => ({
  useNotify: () => notify,
  useInventory: () => ({ refreshItems }),
  useInventoryEventsCtx: () => ({ refreshEvents }),
}));

const get = vi.fn();
const post = vi.fn();
vi.mock('../../../../api/axios', () => ({
  default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) },
}));

const PARSE_RESULT = {
  success: true,
  auditLogId: 'log_1',
  pendingActionId: 'pa_1',
  confirmationToken: 'tok_1',
  parsed: {
    intent: 'inventory_add',
    confidence: 0.9,
    originalText: 'add 20 kg rice expiry 2026-12-01',
    items: [{ item: 'rice', quantity: 20, unit: 'kg', rate: 55, canonicalName: 'Basmati Rice', productId: 'p1' }],
    supplier: 'Sharma Traders',
    date: '2026-10-01',
    expiryDate: '2026-12-01',
    brand: 'India Gate',
  },
  latencyMs: 12,
};

const HISTORY_ROWS = [
  {
    _id: 'log_1',
    transcript: 'add 20 kg rice',
    intent: 'inventory_add',
    confirmationStatus: 'confirmed',
    undoStatus: 'none',
    items: [{ name: 'Basmati Rice', quantity: 20, unit: 'kg', previousStock: 5, newStock: 25 }],
    parsedJson: { supplier: 'Sharma Traders', date: '2026-10-01', expiryDate: '2026-12-01', brand: 'India Gate' },
    createdAt: '2026-10-01T09:00:00.000Z',
  },
  {
    _id: 'log_2',
    transcript: 'waste 2 kg paneer',
    intent: 'inventory_waste',
    confirmationStatus: 'confirmed',
    undoStatus: 'undone',
    items: [{ name: 'Paneer', quantity: 2, unit: 'kg' }],
    parsedJson: {},
    createdAt: '2026-10-02T09:00:00.000Z',
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  get.mockResolvedValue({ data: { success: true, data: HISTORY_ROWS } });
  // Route by endpoint — /parse returns the parsed command, /confirm the result.
  post.mockImplementation(async (url: string) =>
    url === '/voice-inventory/parse'
      ? { data: PARSE_RESULT }
      : { data: { success: true, data: { operation: 'inventory_add', updatedItems: [] } } },
  );
});

describe('VoicePage layout', () => {
  it('puts the mic on the left, the generated-card area on the right and the history at the bottom', async () => {
    render(<VoicePage />);

    // LEFT: the mic button and the text fallback.
    const mic = screen.getByTitle('Start voice input');
    expect(mic).toBeTruthy();
    expect(screen.getByPlaceholderText(/or type/i)).toBeTruthy();

    // RIGHT: no command yet → explicit empty state.
    expect(screen.getByText('No command yet')).toBeTruthy();

    // BOTTOM: history of actions performed.
    expect(await screen.findByText('History of actions performed')).toBeTruthy();

    // The mic precedes the generated-card column in document order.
    const cardEmpty = screen.getByText('No command yet');
    expect(mic.compareDocumentPosition(cardEmpty) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('VoicePage generated cards', () => {
  it('renders a card per parsed item with cost plus supplier / purchase date / expiry date fields', async () => {
    render(<VoicePage />);
    await screen.findByText('History of actions performed');

    fireEvent.change(screen.getByPlaceholderText(/or type/i), { target: { value: 'add 20 kg rice' } });
    fireEvent.click(screen.getByText('Parse'));

    expect(await screen.findByText('Basmati Rice')).toBeTruthy();

    // Cost of the generated item is shown.
    expect(screen.getByText(/Cost:/)).toBeTruthy;
    expect(screen.getByText(/Cost:/).textContent).toContain('55');

    // The purchase details block: supplier, purchase date and expiry date.
    expect(screen.getByPlaceholderText('Supplier name (optional)')).toHaveValue('Sharma Traders');
    expect(screen.getByPlaceholderText('Brand (optional)')).toHaveValue('India Gate');
    expect(screen.getByText('Purchase date')).toBeTruthy();
    expect(screen.getByText('Expiry date')).toBeTruthy();

    // The generated card is on the right column, after the mic.
    const mic = screen.getByTitle('Start voice input');
    const card = screen.getByText('Basmati Rice');
    expect(mic.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('VoicePage history', () => {
  it('shows each action with its recorded expiry/supplier details and both Undo and Edit', async () => {
    render(<VoicePage />);

    const heading = await screen.findByText('History of actions performed');
    const panel = heading.closest('div')!.parentElement as HTMLElement;

    // Item summary with the applied stock delta.
    expect(within(panel).getByText(/Basmati Rice/)).toBeTruthy();

    // Recorded purchase details for the action.
    expect(within(panel).getByText(/Supplier: Sharma Traders/)).toBeTruthy();
    expect(within(panel).getByText(/Purchase: 01 Oct 2026/)).toBeTruthy();
    expect(within(panel).getByText(/Expiry: 01 Dec 2026/)).toBeTruthy();

    // Both action buttons exist, and the already-undone row disables Undo.
    expect(within(panel).getAllByTitle(/this action's details/)).toHaveLength(2);
    const undoButtons = within(panel).getAllByTitle(/Undo this action|Already undone/);
    expect(undoButtons).toHaveLength(2);
    expect((undoButtons[1] as HTMLButtonElement).disabled).toBe(true);
  });

  it('Undo posts the log id to /voice-inventory/undo and refreshes the history', async () => {
    render(<VoicePage />);
    const heading = await screen.findByText('History of actions performed');
    const panel = heading.closest('div')!.parentElement as HTMLElement;

    get.mockClear();
    fireEvent.click(within(panel).getByTitle('Undo this action'));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/voice-inventory/undo', { logId: 'log_1' }),
    );
    await waitFor(() => expect(get).toHaveBeenCalledWith('/voice-inventory/history', { params: { limit: 8 } }));
  });

  it('Edit loads the past action back into the generated card so it can be re-applied', async () => {
    render(<VoicePage />);
    const heading = await screen.findByText('History of actions performed');
    const panel = heading.closest('div')!.parentElement as HTMLElement;

    fireEvent.click(within(panel).getAllByTitle(/this action's details/)[0]);

    // The card is populated from the history entry.
    expect(await screen.findByText('editing a past action')).toBeTruthy();
    expect(screen.getByPlaceholderText('Supplier name (optional)')).toHaveValue('Sharma Traders');
    expect(screen.getByText('Confirm')).toBeTruthy();
    // Editing never auto-applies anything.
    expect(post).not.toHaveBeenCalled();
  });
});