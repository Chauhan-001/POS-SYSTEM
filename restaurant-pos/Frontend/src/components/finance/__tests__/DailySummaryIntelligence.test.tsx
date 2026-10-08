/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DailySummaryIntelligence — the "Generate Daily Summary" AI experience.
 *
 * These tests pin the contract with the EXISTING backend pipeline
 * (POST /ai/z-report/generate):
 *   - nothing runs automatically (an explicit click only);
 *   - the report renders the server's own sections verbatim;
 *   - gaps are disclosed (unavailable sources, failed reads, disagreements, an
 *     evidence-only fallback) and never dressed up as "all good";
 *   - internal identifiers (raw source refs, rule ids, thresholds) never reach
 *     the owner;
 *   - a null result shows the SPECIFIC cause, not one generic line.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import DailySummaryIntelligence from '../DailySummaryIntelligence';

const generateZReportIntelligence = vi.fn();
const getLastAiFailureReason = vi.fn();

vi.mock('../../../api/client', () => ({
  generateZReportIntelligence: (...a: unknown[]) => generateZReportIntelligence(...a),
  getLastAiFailureReason: (...a: unknown[]) => getLastAiFailureReason(...a),
}));

type AnyResult = Record<string, unknown>;

function baseResult(overrides: AnyResult = {}): AnyResult {
  return {
    runId: 'run_1',
    agent: 'z_report',
    businessDate: '2026-08-01',
    report: {
      headline: '2026-08-01: closing drawer short by 15, revenue up 110% on the previous day.',
      whatHappened: ['Net revenue on 2026-08-01 was 8400.', 'Closing drawer variance on 2026-08-01: short by 15.'],
      whatMattered: ['Revenue grew well above the previous day.'],
      needsAttention: ['Recheck the cash drawer count against the closing report.'],
      focusNext: ['Check prep quantities for Paneer to reduce wastage.'],
      caveats: ['Baseline is the previous calendar day only (v1).'],
    },
    reportSource: 'llm',
    confidence: 0.82,
    degraded: true,
    degradations: ['source unavailable: batch1:inventory_context'],
    evidence: {
      signals: 6,
      freshness: { fresh: 4, aging: 0, stale: 1, expired: 0, unknown: 1 },
      conflicts: ['sales_growth|restaurant'],
      unavailable: ['batch1:inventory_context', 'batch2:demand_anomaly'],
      toolErrors: [{ tool: 'getExpiryRisk', code: 'TOOL_FAILED', message: 'boom' }],
      caveats: [],
      usable: true,
      batch3Reason: 'triggered: day-over-day revenue moved 110% (≥ 25%); wastage signals present',
      followUpReason: 'movement_targeting_context: net revenue/volume moved with discount pressure',
      ml: { availableKinds: [], missingKinds: ['segment', 'forecast'], degradations: [], hasCausalEvidence: false },
    },
    generation: {
      durationMs: 4200,
      batch1Ms: 1900,
      batch2Ms: 120,
      batch3Ms: 0,
      followUpMs: 0,
      llmMs: 900,
      toolCalls: 14,
      toolFailures: 1,
      llmTokens: 1400,
      llmCostUsd: 0.01,
      conflictsDetected: 1,
      followUpRounds: 0,
      validationStatus: 'accepted:7checks',
      criticIssues: [],
    },
    persisted: true,
    generatedAt: '2026-10-07T12:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  generateZReportIntelligence.mockReset();
  getLastAiFailureReason.mockReset();
});

describe('DailySummaryIntelligence', () => {
  it('renders nothing until it is open, and fetches nothing until the owner clicks', async () => {
    render(<DailySummaryIntelligence isOpen={false} onClose={() => {}} />);
    expect(screen.queryByText('Generate Daily Summary')).toBeNull();
    expect(generateZReportIntelligence).not.toHaveBeenCalled();

    render(<DailySummaryIntelligence isOpen onClose={() => {}} />);
    expect(screen.getByText('Generate Daily Summary')).toBeTruthy();
    expect(generateZReportIntelligence).not.toHaveBeenCalled();
  });

  it('renders the server report sections and the evidence disclosure after a run', async () => {
    generateZReportIntelligence.mockResolvedValue({ success: true, result: baseResult() });
    render(<DailySummaryIntelligence isOpen onClose={() => {}} businessDate="2026-08-01" />);

    fireEvent.click(screen.getByText('Generate Daily Summary'));

    await waitFor(() => expect(screen.getByText(/closing drawer short by 15/)).toBeTruthy());
    expect(generateZReportIntelligence).toHaveBeenCalledWith({ date: '2026-08-01' });
    expect(screen.getByText('What happened')).toBeTruthy();
    expect(screen.getByText('What mattered')).toBeTruthy();
    expect(screen.getByText('Needs attention')).toBeTruthy();
    expect(screen.getByText('Focus next')).toBeTruthy();
    expect(screen.getByText(/Recheck the cash drawer count/)).toBeTruthy();
    expect(screen.getByText(/82% confidence/)).toBeTruthy();
    expect(screen.getByText(/Baseline is the previous calendar day/)).toBeTruthy();
    // Gaps disclosed, and no raw internal identifiers anywhere on screen.
    expect(screen.getByText(/Inventory & wastage/)).toBeTruthy();
    expect(screen.getByText(/Unusual-pattern check/)).toBeTruthy();
    expect(screen.queryByText(/batch1:inventory_context/)).toBeNull();
    expect(screen.queryByText(/getExpiryRisk/)).toBeNull();
    expect(screen.queryByText(/movement_targeting_context/)).toBeNull();
    expect(screen.queryByText(/sales_growth\|restaurant/)).toBeNull();
    // ML gap stated as an absence, never as a result.
    expect(screen.getByText(/No prediction was available for this run/)).toBeTruthy();
  });

  it('says plainly when the deterministic fallback was used instead of AI wording', async () => {
    generateZReportIntelligence.mockResolvedValue({
      success: true,
      result: baseResult({ reportSource: 'deterministic', degraded: true }),
    });
    render(<DailySummaryIntelligence isOpen onClose={() => {}} />);
    fireEvent.click(screen.getByText('Generate Daily Summary'));

    await waitFor(() => expect(screen.getByText('Evidence-only summary')).toBeTruthy());
    expect(screen.getByText(/The AI wording was not used for this run/)).toBeTruthy();
  });

  it('shows the specific request failure cause and offers a retry', async () => {
    generateZReportIntelligence.mockResolvedValue(null);
    getLastAiFailureReason.mockReturnValue('rate_limited');
    render(<DailySummaryIntelligence isOpen onClose={() => {}} />);

    fireEvent.click(screen.getByText('Generate Daily Summary'));

    await waitFor(() => expect(screen.getByText(/couldn’t be generated/)).toBeTruthy());
    expect(getLastAiFailureReason).toHaveBeenCalledWith('/ai/z-report/generate');
    expect(screen.getByText(/Another analysis is already running for your restaurant/)).toBeTruthy();
    expect(screen.getByText('Try Again')).toBeTruthy();
  });

  it('falls back to the base failure line when no cause was recorded', async () => {
    generateZReportIntelligence.mockResolvedValue(null);
    getLastAiFailureReason.mockReturnValue(undefined);
    render(<DailySummaryIntelligence isOpen onClose={() => {}} />);

    fireEvent.click(screen.getByText('Generate Daily Summary'));

    await waitFor(() => expect(screen.getByText(/couldn’t be generated/)).toBeTruthy());
    expect(screen.queryByText(/This device is offline/)).toBeNull();
  });

  it('resets to the pre-run state after the owner closes the modal', async () => {
    generateZReportIntelligence.mockResolvedValue({ success: true, result: baseResult() });
    const { rerender } = render(<DailySummaryIntelligence isOpen onClose={() => {}} />);
    fireEvent.click(screen.getByText('Generate Daily Summary'));
    await waitFor(() => expect(screen.getByText('Generate again')).toBeTruthy());

    rerender(<DailySummaryIntelligence isOpen={false} onClose={() => {}} />);
    rerender(<DailySummaryIntelligence isOpen onClose={() => {}} />);
    expect(screen.getByText('Generate Daily Summary')).toBeTruthy();
    expect(screen.queryByText('What happened')).toBeNull();
  });
});
