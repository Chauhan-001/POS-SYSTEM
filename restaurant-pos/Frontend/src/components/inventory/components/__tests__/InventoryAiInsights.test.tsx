/**
 * InventoryAiInsights — the owner-facing AI section on the Inventory Overview.
 *
 * These tests pin the integration contract with the EXISTING agentic inventory
 * agent (POST /ai/inventory-agent/recommend, { agentic: true, task }):
 *   - nothing runs automatically (explicit [Run AI Analysis] only);
 *   - the "What the AI checked" chips come from the server's toolsUsed,
 *     deduplicated, with owner-friendly labels (never raw tool names);
 *   - an unavailable source is DATA UNAVAILABLE — never "no risk";
 *   - a degraded run shows PARTIAL ANALYSIS and never claims "no problems";
 *   - a healthy verdict only appears when the evidence actually supports it;
 *   - a request failure shows the retry state, not a backend error;
 *   - secondary card navigation goes to the EXISTING inventory pages.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import InventoryAiInsights from '../InventoryAiInsights';

const runInventoryAgentInsight = vi.fn();

vi.mock('../../../../api/client', () => ({
  runInventoryAgentInsight: (...a: unknown[]) => runInventoryAgentInsight(...a),
}));

type ResultFactory = Record<string, unknown>;

function baseResult(overrides: ResultFactory = {}): ResultFactory {
  return {
    mode: 'agentic',
    status: 'ready',
    task: 'Analyze inventory',
    summary: '2 reorder actions and 1 expiry risk were found.',
    assessment: {
      title: 'Several ingredients are at stockout risk',
      summary: 'Chicken, paneer and cooking oil are showing increased replenishment pressure.',
      priority: 'high',
    },
    issues: [
      {
        type: 'low_stock',
        itemName: 'Chicken',
        severity: 'high',
        evidenceRefs: ['getInventoryStatus'],
        explanation: 'Chicken stock is below the reorder threshold.',
      },
      {
        type: 'expiry_risk',
        itemId: 'p1',
        itemName: 'Paneer',
        severity: 'high',
        evidenceRefs: ['getExpiryRisk'],
        explanation: 'Paneer expires in 2 day(s).',
      },
      {
        type: 'wastage_risk',
        itemName: 'Cooking Oil',
        severity: 'medium',
        evidenceRefs: ['getWastage'],
        explanation: 'Wastage of 3 L was recorded for Cooking Oil in the window.',
      },
    ],
    recommendations: [],
    confidence: 0.6,
    toolsUsed: ['getInventoryStatus', 'getStockoutRisk', 'getExpiryRisk', 'getWastage'],
    investigation: {
      runId: 'run_1',
      requestId: 'run_1',
      status: 'completed_sufficient',
      stepsUsed: 4,
      toolCallsUsed: 4,
      llmCalls: 3,
      toolNames: ['getInventoryStatus', 'getStockoutRisk', 'getExpiryRisk', 'getWastage'],
      steps: [],
      dedupedCalls: 0,
      rejections: [],
      degraded: false,
    },
    degraded: false,
    nextActions: ['Review the reorder list and confirm quantities in Purchasing.'],
    evidenceSources: { inventory: true, demandForecast: true, expiry: true, wastage: true },
    purchaseRecommendations: [],
    expiryRisks: [],
    wastageSignals: [],
    generatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe('InventoryAiInsights', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not run automatically on render — the owner clicks Run AI Analysis', () => {
    render(<InventoryAiInsights />);
    expect(screen.getByText('What the AI found in your inventory')).toBeTruthy();
    expect(screen.getByText(/AI analysis is advisory/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Run AI Analysis/i })).toBeTruthy();
    expect(runInventoryAgentInsight).not.toHaveBeenCalled();
  });

  it('calls the existing agentic contract and renders the grounded primary insight', async () => {
    runInventoryAgentInsight.mockResolvedValue({ success: true, result: baseResult() });
    render(<InventoryAiInsights />);

    fireEvent.click(screen.getByRole('button', { name: /Run AI Analysis/i }));
    expect(screen.getByText('Analyzing your inventory…')).toBeTruthy();

    await waitFor(() => expect(screen.getByText('Several ingredients are at stockout risk')).toBeTruthy());
    // The component passes only the owner task — tenant identity NEVER travels
    // from the frontend (the `agentic: true` flag is added by the API client).
    expect(runInventoryAgentInsight).toHaveBeenCalledWith({ task: expect.stringContaining('inventory') });
    const body = runInventoryAgentInsight.mock.calls[0][0] as Record<string, unknown>;
    expect(body.restaurantId).toBeUndefined();

    // Severity comes from the server's assessment (already floored there).
    expect(screen.getByText('HIGH PRIORITY')).toBeTruthy();
    expect(screen.getByText(/Chicken, paneer and cooking oil/)).toBeTruthy();
    expect(screen.getByText('Suggested next step')).toBeTruthy();

    // Chips from toolsUsed, deduplicated, friendly labels — no raw tool names.
    const chips = ['Current stock', 'Stockout risk', 'Expiry risk', 'Wastage history'];
    for (const chip of chips) expect(screen.getByText(chip)).toBeTruthy();
    expect(screen.queryByText(/getInventoryStatus|getExpiryRisk/)).toBeNull();
    expect(screen.getByText('What the AI checked')).toBeTruthy();

    // Secondary cards reflect the server's issues only.
    expect(screen.getByText('STOCKOUT RISK')).toBeTruthy();
    expect(screen.getByText(/may expire soon/)).toBeTruthy();
    expect(screen.getByText('WASTAGE')).toBeTruthy();
  });

  it('deduplicates repeated tool calls into a single chip', async () => {
    runInventoryAgentInsight.mockResolvedValue({
      success: true,
      result: baseResult({
        toolsUsed: ['getInventoryStatus', 'getInventoryStatus', 'getStockoutRisk', 'getExpiryRisk'],
      }),
    });
    render(<InventoryAiInsights />);
    fireEvent.click(screen.getByRole('button', { name: /Run AI Analysis/i }));
    await waitFor(() => expect(screen.getByText('What the AI checked')).toBeTruthy());

    expect(screen.getAllByText('Current stock')).toHaveLength(1);
    expect(screen.getAllByText('Stockout risk')).toHaveLength(1);
    expect(screen.getAllByText('Expiry risk')).toHaveLength(1);
  });

  it('renders the extended investigation surface with friendly labels and per-tool honesty', async () => {
    runInventoryAgentInsight.mockResolvedValue({
      success: true,
      result: baseResult({
        toolsUsed: ['getInventoryStatus', 'getDemandForecast', 'getSalesTrends', 'getFestivalContext'],
        toolAvailability: { getInventoryStatus: true, getDemandForecast: false, getSalesTrends: false },
      }),
    });
    render(<InventoryAiInsights />);
    fireEvent.click(screen.getByRole('button', { name: /Run AI Analysis/i }));
    await waitFor(() => expect(screen.getByText('What the AI checked')).toBeTruthy());

    // Owner-friendly labels — never raw tool names.
    expect(screen.getByText(/AI demand prediction unavailable/i)).toBeTruthy();
    expect(screen.getByText(/Sales trends unavailable/i)).toBeTruthy();
    expect(screen.getByText('Festival calendar')).toBeTruthy();
    expect(screen.queryByText(/getDemandForecast|getSalesTrends|getFestivalContext/)).toBeNull();
  });

  it('shows DATA UNAVAILABLE for an unavailable source — never "no risk"', async () => {
    runInventoryAgentInsight.mockResolvedValue({
      success: true,
      result: baseResult({
        toolsUsed: ['getInventoryStatus', 'getExpiryRisk'],
        evidenceSources: { inventory: true, demandForecast: false, expiry: false, wastage: false },
        issues: [
          {
            type: 'data_unavailable',
            severity: 'normal',
            evidenceRefs: ['getExpiryRisk'],
            explanation: 'Expiry data was unavailable for this analysis.',
          },
          {
            type: 'low_stock',
            itemName: 'Chicken',
            severity: 'high',
            evidenceRefs: ['getInventoryStatus'],
            explanation: 'Chicken stock is below the reorder threshold.',
          },
        ],
      }),
    });
    render(<InventoryAiInsights />);
    fireEvent.click(screen.getByRole('button', { name: /Run AI Analysis/i }));
    await waitFor(() => expect(screen.getByText('Several ingredients are at stockout risk')).toBeTruthy());

    expect(screen.getByText('Expiry risk unavailable')).toBeTruthy();
    expect(screen.getByText('DATA UNAVAILABLE')).toBeTruthy();
    expect(screen.getByText(/Expiry data was unavailable for this analysis/)).toBeTruthy();
    // Absence of evidence must NOT become evidence of absence.
    expect(screen.queryByText(/Inventory looks healthy/i)).toBeNull();
    expect(screen.queryByText(/No significant stockout, expiry, or wastage issue/i)).toBeNull();
  });

  it('shows the healthy verdict only when every investigated source returned data', async () => {
    runInventoryAgentInsight.mockResolvedValue({
      success: true,
      result: baseResult({
        assessment: { title: 'Inventory situation', summary: 'No immediate risk found.', priority: 'normal' },
        issues: [
          {
            type: 'no_immediate_risk',
            severity: 'normal',
            evidenceRefs: ['getInventoryStatus', 'getExpiryRisk', 'getWastage'],
            explanation: 'No immediate risk was found in the sources that returned data.',
          },
        ],
        nextActions: ['No immediate inventory actions are indicated.'],
      }),
    });
    render(<InventoryAiInsights />);
    fireEvent.click(screen.getByRole('button', { name: /Run AI Analysis/i }));
    await waitFor(() => expect(screen.getByText(/Inventory looks healthy/i)).toBeTruthy());
    expect(screen.getByText(/No significant stockout, expiry, or wastage issue was detected/i)).toBeTruthy();
  });

  it('never renders "healthy" when the run was degraded — it shows an incomplete analysis', async () => {
    runInventoryAgentInsight.mockResolvedValue({
      success: true,
      result: baseResult({
        degraded: true,
        degradedReason: 'agent_loop_failed_after_evidence',
        issues: [
          {
            type: 'no_immediate_risk',
            severity: 'normal',
            evidenceRefs: ['getInventoryStatus'],
            explanation: 'No immediate risk was found in the sources that returned data.',
          },
        ],
      }),
    });
    render(<InventoryAiInsights />);
    fireEvent.click(screen.getByRole('button', { name: /Run AI Analysis/i }));
    await waitFor(() =>
      expect(screen.getByText(/Inventory analysis is incomplete because some data was unavailable/i)).toBeTruthy(),
    );
    expect(screen.queryByText(/Inventory looks healthy/i)).toBeNull();
  });

  it('shows PARTIAL ANALYSIS above findings that are still supported by evidence', async () => {
    runInventoryAgentInsight.mockResolvedValue({
      success: true,
      result: baseResult({ degraded: true, degradedReason: 'synthesis_partially_rejected:issue:ref_repaired' }),
    });
    render(<InventoryAiInsights />);
    fireEvent.click(screen.getByRole('button', { name: /Run AI Analysis/i }));
    await waitFor(() => expect(screen.getByText('Partial analysis')).toBeTruthy());
    expect(screen.getByText(/Some inventory data was unavailable, so this analysis may be incomplete/i)).toBeTruthy();
    // Supported findings still render.
    expect(screen.getByText('Several ingredients are at stockout risk')).toBeTruthy();
  });

  it('shows the retry state on failure and can run again', async () => {
    runInventoryAgentInsight.mockResolvedValueOnce(null);
    render(<InventoryAiInsights />);
    fireEvent.click(screen.getByRole('button', { name: /Run AI Analysis/i }));
    await waitFor(() => expect(screen.getByText(/AI inventory analysis couldn't be completed/i)).toBeTruthy());
    expect(screen.queryByText(/AIUsageLog|endpoint|agent loop/i)).toBeNull();

    runInventoryAgentInsight.mockResolvedValueOnce({ success: true, result: baseResult() });
    fireEvent.click(screen.getByRole('button', { name: /Try Again/i }));
    await waitFor(() => expect(screen.getByText('Several ingredients are at stockout risk')).toBeTruthy());
    expect(runInventoryAgentInsight).toHaveBeenCalledTimes(2);
  });

  it('navigates to the existing inventory pages from a secondary card', async () => {
    const onNavigate = vi.fn();
    runInventoryAgentInsight.mockResolvedValue({ success: true, result: baseResult() });
    render(<InventoryAiInsights onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole('button', { name: /Run AI Analysis/i }));
    await waitFor(() => expect(screen.getByText('STOCKOUT RISK')).toBeTruthy());

    const viewButtons = screen.getAllByRole('button', { name: /View inventory/i });
    fireEvent.click(viewButtons[viewButtons.length - 1]);
    expect(onNavigate).toHaveBeenCalledWith('expiry');

    fireEvent.click(screen.getByRole('button', { name: /View details/i }));
    expect(onNavigate).toHaveBeenCalledWith('waste');
  });

  it('distinguishes a checked risk tool with no findings from an unreadable source', async () => {
    runInventoryAgentInsight.mockResolvedValue({
      success: true,
      result: baseResult({
        issues: [],
        toolsUsed: ['getInventoryStatus', 'getStockoutRisk', 'getExpiryRisk'],
        // Expiry was read and came back clean; stockout had no usable input.
        evidenceSources: { inventory: true, demandForecast: false, expiry: true, wastage: false },
      }),
    });
    render(<InventoryAiInsights />);
    fireEvent.click(screen.getByRole('button', { name: /Run AI Analysis/i }));
    await waitFor(() => expect(screen.getByText('What the AI checked')).toBeTruthy());

    // A tool that RAN and found nothing is a clean check, never "unavailable".
    expect(screen.getAllByText(/none found/i).length).toBeGreaterThan(0);
    // A source with no usable input is still reported honestly.
    expect(screen.getByText(/Stockout risk unavailable/i)).toBeTruthy();
    expect(screen.getByText(/Current stock/)).toBeTruthy();
  });
});
