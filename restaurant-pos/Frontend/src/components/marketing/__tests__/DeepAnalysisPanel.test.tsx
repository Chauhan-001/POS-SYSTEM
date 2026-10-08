/**
 * DeepAnalysisPanel — the owner-facing `/analyze` surface (Phase 16).
 *
 * These tests pin the rules that make the surface trustworthy, using a fixture
 * shaped exactly like the real backend response (`AnalyzeResponse`):
 *
 *   - every finding is rendered WITH its source, and raw evidence refs /
 *     internal ids never reach the owner;
 *   - an area with no data reads "No data" — never healthy, never an error;
 *   - a declared-only capability is disclosed as "not available yet";
 *   - a check that was SKIPPED reads "Not checked" — never a pass;
 *   - a candidate the deterministic gate BLOCKED cannot be drafted;
 *   - Approve creates a pending draft only, through the existing /proposal
 *     route, with the exact selected id and no repeat;
 *   - Ignore is recorded through the existing owner-decision endpoint;
 *   - NO chain-of-thought is rendered, even if a payload smuggled one in.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import DeepAnalysisPanel from '../DeepAnalysisPanel';
import type { MarketingAnalyzeResult } from '../../../api/client';
import { REAL_ANALYZE_RESPONSE } from './fixtures/realAnalyzeResponse';

const runMarketingAnalyze = vi.fn();
const createProposalFromRecommendation = vi.fn();
const recordRecommendationFeedback = vi.fn();

vi.mock('../../../api/client', () => ({
  runMarketingAnalyze: (...a: unknown[]) => runMarketingAnalyze(...a),
  createProposalFromRecommendation: (...a: unknown[]) => createProposalFromRecommendation(...a),
  recordRecommendationFeedback: (...a: unknown[]) => recordRecommendationFeedback(...a),
}));

const REC_ID = 'promo_margin_restaurant_low_margin';
const BLOCKED_ID = 'promo_demand_restaurant_stockout';

/** The ranked recommendation carried verbatim from the engine. */
function makeRecommendation(overrides: Record<string, unknown> = {}) {
  return {
    rank: 1,
    id: REC_ID,
    type: 'CREATE_PROMOTION',
    strategy: 'weak_slot',
    strategyLabel: 'Weekday fill',
    title: 'Lift quiet weekday covers',
    description: 'A weekday promotion on two high-margin dishes.',
    recommendedAction: 'Create a 10% weekday offer on the two dishes.',
    engineScore: 0.82,
    confidence: 0.6,
    priority: 'high',
    economics: {
      discountPercent: 10,
      projectedContributionMargin: 32,
      incrementalRevenue: 12000,
      incrementalUnits: 40,
      breakEvenIncrementalUnits: 8,
      paybackPeriodDays: 5,
      economicallySafe: true,
      available: true,
    },
    target: { productIds: ['p1'], productNames: ['Paneer Tikka'], categoryIds: [], segmentIds: [] },
    risks: ['Weekday discounts can train customers to wait for them.'],
    prerequisites: ['Price and cost data must be current.'],
    why: ['Weakest weekday is Tuesday by revenue.'],
    provenance: { signalCodes: ['sales_weekday_trough'], signalThemes: [], mlKinds: ['response_model'], memoryRefs: [] },
    ...overrides,
  };
}

/** A real-shaped `/analyze` response, incl. the honest-negative fields. */
function makeResult(overrides: Partial<MarketingAnalyzeResult> = {}): MarketingAnalyzeResult {
  return {
    mode: 'marketing_analyze',
    runId: 'run_abc123',
    status: 'completed_degraded',
    objective: 'How do I grow contribution margin this month?',
    situation: {
      objective: 'How do I grow contribution margin this month?',
      investigatedDomains: [
        { domain: 'sales', status: 'ok', findingCount: 8, signalCount: 8, implemented: true },
        { domain: 'marketing_history', status: 'ok', findingCount: 16, signalCount: 16, implemented: true },
        { domain: 'products', status: 'unavailable', findingCount: 0, signalCount: 0, reasonCode: 'NO_DATA_IN_DOMAIN', degradedReason: 'No usable evidence was produced for this domain in the analysed window.', implemented: true },
        // Declared-only capability: reachable when the manager selects it, and
        // it must be disclosed as "not available yet" rather than omitted.
        { domain: 'feedback', status: 'unavailable', findingCount: 0, signalCount: 0, reasonCode: 'DOMAIN_NOT_IMPLEMENTED', degradedReason: 'Feedback intelligence is declared but not implemented.', implemented: false },
      ],
      unavailableDomains: ['products', 'feedback'],
      confirmedFacts: [
        {
          statement: 'Sunday is the strongest weekday by revenue.',
          domain: 'sales',
          confidence: 0.7,
          evidenceRefs: ['signal:sales_weekday_peak:80022f:restaurant'],
        },
      ],
      opportunities: [
        { statement: 'Two high-margin dishes are barely ordered.', domain: 'sales', confidence: 0.6, evidenceRefs: ['signal:product_slow_moving:80022f:p1'] },
      ],
      risks: [
        { statement: 'Weekday demand is flat.', domain: 'sales', confidence: 0.6, evidenceRefs: ['signal:sales_weekday_trough:80022f:restaurant'] },
      ],
      contradictions: ['Sales report growth while past campaigns show no lift.'],
      uncertainties: ['The window is short, so a seasonal effect cannot be ruled out.'],
      missingEvidence: ['Guest feedback: capability declared but not implemented.'],
      topSignals: [
        {
          signalId: 'sig_1',
          code: 'sales_aov_level',
          statement: 'Average order value is 959.',
          value: 959,
          unit: 'currency/order',
          confidence: 0.8,
          freshness: 'fresh',
        },
      ],
      candidateDirections: [
        {
          direction: 'fill_weak_slots',
          domain: 'sales',
          objective: 'Lift weak weekday covers',
          mechanism: 'targeted weekday promotion',
          target: { productIds: ['p1'], productNames: ['Paneer Tikka'], categoryIds: [], segmentIds: [] },
          evidenceRefs: ['signal:sales_weekday_trough:80022f:restaurant'],
        },
      ],
      confidence: 0.62,
      generatedAt: new Date().toISOString(),
    },
    investigation: {
      runId: 'run_abc123',
      status: 'completed_sufficient',
      stepsUsed: 4,
      toolCallsUsed: 4,
      llmCalls: 5,
      domainsInvestigated: ['sales', 'marketing_history', 'products'],
      domainsUnavailable: ['products'],
      domainOrder: ['sales', 'marketing_history', 'products'],
      stopGuardObjections: [],
      rejections: [],
      tokensUsed: 1200,
      costUsd: 0.01,
    },
    recommendations: [
      {
        recommendation: makeRecommendation(),
        validation: {
          candidateId: REC_ID,
          passed: true,
          rejectionCodes: [],
          checks: [
            { name: 'economic_safety', status: 'pass', detail: 'Margin stays above your floor.' },
            { name: 'inventory_feasibility', status: 'skipped', detail: 'The stockout forecast had no usable input.' },
            { name: 'marketing_conflict', status: 'pass', detail: 'No running offer covers these items.' },
          ],
        },
        critic: { candidateId: REC_ID, verdict: 'PASS', reasons: ['The target matches the measured weak weekday.'], confidenceDelta: 0, source: 'llm', strippedClaims: [] },
      },
    ],
    directionPolicy: {
      applied: true,
      types: ['CREATE_PROMOTION', 'CREATE_COMBO'],
      unrepresentableDirections: ['retain_high_value'],
      realisedDirections: ['fill_weak_slots'],
      unrealisedDirections: ['win_back'],
      fallbackUsed: false,
      note: 'Generation was restricted to the investigated directions.',
    },
    rejected: [
      { candidateId: BLOCKED_ID, title: 'Discount a stockout-risk dish', codes: ['STOCKOUT_RISK_ON_TARGET'] },
    ],
    validationSources: {
      stockout: { status: 'unavailable', detail: 'The stockout forecast had no usable input (NO_STOCKOUT_DATA).' },
      activeOffers: { status: 'ok', detail: '16 active offer(s) checked for overlapping products/categories.' },
    },
    confidence: 0.62,
    risk: 'medium',
    degradations: [
      'feedback-trend learning is not implemented (feedback domain is declared only)',
      'feedback domain is declared only and was not investigated — no feedback fact is asserted',
    ],
    memory: { episodes: 2, longTerm: 0, degraded: false },
    memoryWrite: { attempted: true, episodeWritten: true, episodeId: 'ep_1', recommendationsRecorded: 1 },
    outcomeLearning: {
      outcomesLinked: 1,
      outcomesPositive: 1,
      outcomesNegative: 0,
      outcomesUnusable: 0,
      causalOutcomes: 1,
      productPatternsWritten: 0,
      productPatternsSkippedFresh: false,
      notes: ['only 0 item(s) had enough trading history for percentiles (need 3)'],
    },
    approvalRequired: true,
    generatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function renderPanel() {
  return render(<DeepAnalysisPanel currencySymbol="₹" />);
}

/** Run the analysis and wait for the report. */
async function runAndWait() {
  renderPanel();
  fireEvent.click(screen.getByTestId('run-deep-analysis'));
  await waitFor(() => expect(screen.getByTestId('deep-analysis-status')).toBeTruthy());
}

beforeEach(() => {
  vi.clearAllMocks();
  runMarketingAnalyze.mockResolvedValue({ success: true, result: makeResult() });
  createProposalFromRecommendation.mockResolvedValue({
    success: true,
    proposal: { created: true, proposalId: 'proposal_777', readiness: { canSchedule: false, blockers: ['approval required'], audienceCount: 0 } },
  });
  recordRecommendationFeedback.mockResolvedValue({ success: true, message: 'saved' });
});

describe('DeepAnalysisPanel — running the analysis', () => {
  it('is owner-invoked: nothing runs until the button is pressed', () => {
    renderPanel();
    expect(runMarketingAnalyze).not.toHaveBeenCalled();
    expect(screen.getByTestId('deep-analysis-empty')).toBeTruthy();

    fireEvent.click(screen.getByTestId('run-deep-analysis'));
    expect(runMarketingAnalyze).toHaveBeenCalledTimes(1);
  });

  it('sends the owner question and the chosen window, bounded', async () => {
    renderPanel();
    fireEvent.change(screen.getByTestId('deep-analysis-goal'), { target: { value: '  Grow margin  ' } });
    fireEvent.change(screen.getByTestId('deep-analysis-lookback'), { target: { value: '90' } });
    fireEvent.click(screen.getByTestId('run-deep-analysis'));

    await waitFor(() => expect(runMarketingAnalyze).toHaveBeenCalledTimes(1));
    expect(runMarketingAnalyze).toHaveBeenCalledWith({ goal: 'Grow margin', lookbackDays: 90 });
  });

  it('omits an empty question instead of sending blank text', async () => {
    renderPanel();
    fireEvent.click(screen.getByTestId('run-deep-analysis'));
    await waitFor(() => expect(runMarketingAnalyze).toHaveBeenCalledTimes(1));
    expect(runMarketingAnalyze).toHaveBeenCalledWith({ lookbackDays: 30 });
  });

  it('shows a human loading state, never internal tool execution', async () => {
    runMarketingAnalyze.mockReturnValue(new Promise(() => {}));
    renderPanel();
    fireEvent.click(screen.getByTestId('run-deep-analysis'));
    await waitFor(() => expect(screen.getByTestId('deep-analysis-loading')).toBeTruthy());
    expect(screen.queryByText(/get[A-Z]/)).toBeNull();
    expect(screen.queryByText(/investigate[A-Z]/)).toBeNull();
  });

  it('shows a friendly error with retry, never the raw backend message', async () => {
    runMarketingAnalyze.mockRejectedValue(new Error('Request failed with status 500'));
    renderPanel();
    fireEvent.click(screen.getByTestId('run-deep-analysis'));
    await waitFor(() => expect(screen.getByTestId('deep-analysis-error')).toBeTruthy());

    const box = screen.getByTestId('deep-analysis-error');
    expect(box.textContent).not.toContain('500');
    expect(box.textContent).not.toContain('status');
    expect(screen.getByTestId('deep-analysis-retry')).toBeTruthy();

    runMarketingAnalyze.mockResolvedValue({ success: true, result: makeResult() });
    fireEvent.click(screen.getByTestId('deep-analysis-retry'));
    await waitFor(() => expect(screen.getByTestId('deep-analysis-status')).toBeTruthy());
  });

  it('explains a rate limit in the owner\u2019s terms', async () => {
    runMarketingAnalyze.mockRejectedValue(new Error('429 Too Many Requests'));
    renderPanel();
    fireEvent.click(screen.getByTestId('run-deep-analysis'));
    await waitFor(() => expect(screen.getByTestId('deep-analysis-error')).toBeTruthy());
    expect(screen.getByTestId('deep-analysis-error').textContent).toMatch(/already running or you have run too many/i);
  });
});

describe('DeepAnalysisPanel — the report is evidence-backed and honest', () => {
  it('renders every section of the report', async () => {
    await runAndWait();
    for (const id of [
      'deep-analysis-status',
      'deep-analysis-facts',
      'deep-analysis-signals',
      'deep-analysis-investigated',
      'deep-analysis-opportunities',
      'deep-analysis-risk',
      'deep-analysis-learned',
    ]) {
      expect(screen.getByTestId(id)).toBeTruthy();
    }
    expect(screen.getByTestId('deep-analysis-card').getAttribute('data-recommendation-id')).toBe(REC_ID);
  });

  it('states the objective, confidence and risk in plain language', async () => {
    await runAndWait();
    const status = screen.getByTestId('deep-analysis-status');
    expect(status.textContent).toContain('How do I grow contribution margin this month?');
    expect(status.textContent).toContain('62% confidence');
    expect(status.textContent).toContain('Medium risk');
    expect(status.textContent).toMatch(/approval is always required/i);
  });

  it('renders findings with their source and never leaks a raw evidence ref or id', async () => {
    await runAndWait();
    const facts = screen.getByTestId('deep-analysis-facts');
    expect(facts.textContent).toContain('Sunday is the strongest weekday by revenue.');
    expect(facts.textContent).toContain('Sales');
    expect(facts.textContent).toContain('70% confidence');
    // The ref is translated to owner language; neither the ref nor the tenant id appears.
    expect(facts.textContent).toContain('your strongest day');
    expect(facts.textContent).not.toContain('signal:');
    expect(facts.textContent).not.toContain('80022f');
    expect(document.body.textContent).not.toContain('80022f');
  });

  it('shows an area with no data as "No data" — never healthy, never an error', async () => {
    await runAndWait();
    const investigated = screen.getByTestId('deep-analysis-investigated');
    expect(investigated.textContent).toContain('Sales: Checked');
    expect(investigated.textContent).toContain('Menu items: No data');
    expect(investigated.textContent).toContain('Skipped for lack of data: Menu items');
  });

  it('discloses declared-only areas instead of silently omitting them', async () => {
    await runAndWait();
    expect(screen.getByTestId('deep-analysis-investigated').textContent).toMatch(/not available yet/i);
    expect(screen.getByTestId('deep-analysis-degradations').textContent).toMatch(/declared only/i);
  });

  it('surfaces a disagreement between areas rather than hiding it', async () => {
    await runAndWait();
    const conflicts = screen.getByTestId('deep-analysis-conflicts');
    expect(conflicts.textContent).toContain('Sales report growth while past campaigns show no lift.');
    expect(conflicts.textContent).toMatch(/shown rather than hidden/i);
  });

  it('renders measured signals with their real value and unit', async () => {
    await runAndWait();
    const signals = screen.getByTestId('deep-analysis-signals');
    expect(signals.textContent).toContain('Average order value is 959.');
    expect(signals.textContent).toContain('₹959/order');
    expect(signals.textContent).toContain('fresh');
  });

  it('renders "No measured value" when a signal carries no number', async () => {
    const result = makeResult();
    result.situation.topSignals = [{ signalId: 'sig_2', code: 'sales_revenue_level', statement: 'Revenue was flat.', confidence: 0.5 }];
    runMarketingAnalyze.mockResolvedValue({ success: true, result });
    await runAndWait();
    expect(screen.getByTestId('deep-analysis-signals').textContent).toContain('No measured value');
  });

  it('is honest when there is no action to recommend — a data gap, not a clean bill of health', async () => {
    runMarketingAnalyze.mockResolvedValue({ success: true, result: makeResult({ recommendations: [] }) });
    await runAndWait();
    const empty = screen.getByTestId('deep-analysis-no-opportunities');
    expect(empty.textContent).toMatch(/No action was recommended/i);
    expect(empty.textContent).toMatch(/not enough usable data/i);
    expect(screen.queryByTestId('deep-analysis-card')).toBeNull();
  });
});

describe('DeepAnalysisPanel — review details', () => {
  it('keeps details collapsed until the owner asks', async () => {
    await runAndWait();
    expect(screen.queryByTestId(`deep-analysis-validation-${REC_ID}`)).toBeNull();
    fireEvent.click(screen.getByTestId(`review-${REC_ID}`));
    expect(screen.getByTestId(`deep-analysis-validation-${REC_ID}`)).toBeTruthy();
    expect(screen.getByTestId(`review-${REC_ID}`).textContent).toContain('Hide details');
  });

  it('explains why it matters, the evidence, the economics and the predictions used', async () => {
    await runAndWait();
    fireEvent.click(screen.getByTestId(`review-${REC_ID}`));

    expect(screen.getByTestId(`deep-analysis-why-${REC_ID}`).textContent).toContain('Weakest weekday is Tuesday by revenue.');

    const evidence = screen.getByTestId(`deep-analysis-evidence-${REC_ID}`);
    expect(evidence.textContent).toContain('your weakest day');
    expect(evidence.textContent).toContain('likely to use an offer (a prediction)');
    expect(evidence.textContent).not.toContain('signal:');

    const economics = screen.getByTestId(`deep-analysis-economics-${REC_ID}`);
    expect(economics.textContent).toContain('Keeps 32% profit per plate even after the 10% discount.');
    expect(economics.textContent).toContain('₹12,000');
    expect(economics.textContent).toMatch(/needs about 8 extra sales/i);

    expect(screen.getByTestId(`deep-analysis-ml-${REC_ID}`).textContent).toContain('likely to use an offer (a prediction)');
  });

  it('says so explicitly when no prediction was used', async () => {
    const result = makeResult();
    result.recommendations[0].recommendation.provenance = { signalCodes: ['sales_weekday_trough'], mlKinds: [], memoryRefs: [] };
    runMarketingAnalyze.mockResolvedValue({ success: true, result });
    await runAndWait();
    fireEvent.click(screen.getByTestId(`review-${REC_ID}`));
    expect(screen.getByTestId(`deep-analysis-ml-${REC_ID}`).textContent).toMatch(/rests on measured data/i);
  });

  it('shows "Not available" rather than a fabricated profit impact when economics are missing', async () => {
    const result = makeResult();
    result.recommendations[0].recommendation.economics = {
      discountPercent: 0,
      projectedContributionMargin: 0,
      incrementalRevenue: 0,
      incrementalUnits: 0,
      breakEvenIncrementalUnits: 0,
      paybackPeriodDays: 0,
      economicallySafe: false,
      available: false,
    };
    runMarketingAnalyze.mockResolvedValue({ success: true, result });
    await runAndWait();
    fireEvent.click(screen.getByTestId(`review-${REC_ID}`));
    const economics = screen.getByTestId(`deep-analysis-economics-${REC_ID}`);
    expect(economics.textContent).toMatch(/profit impact not available/i);
    expect(economics.textContent).not.toContain('+₹');
  });

  it('renders a SKIPPED check as "Not checked" — never as a pass', async () => {
    await runAndWait();
    fireEvent.click(screen.getByTestId(`review-${REC_ID}`));
    const checks = screen.getByTestId(`deep-analysis-validation-${REC_ID}`);
    // Check names are machine tokens in the API; the owner sees plain language.
    expect(checks.textContent).toContain('Profit safety — Passed');
    expect(checks.textContent).toContain('Stock feasibility — Not checked');
    expect(checks.textContent).toContain('Overlap with a live offer — Passed');
    expect(checks.textContent).not.toContain('economic_safety');
    expect(checks.textContent).not.toContain('inventory_feasibility');
    // A skipped check must never be summarised as if it passed.
    expect(checks.textContent).not.toMatch(/Stock feasibility — Passed/);
  });

  it('explains a critic downgrade in owner language and notes a rules-only review', async () => {
    const result = makeResult();
    result.recommendations[0].critic = {
      candidateId: REC_ID,
      verdict: 'DOWNGRADE',
      reasons: ['The margin buffer is thin for this category.'],
      confidenceDelta: -0.1,
      source: 'deterministic_fallback',
      strippedClaims: ['+40% revenue'],
    };
    runMarketingAnalyze.mockResolvedValue({ success: true, result });
    await runAndWait();
    const card = screen.getByTestId('deep-analysis-card');
    expect(card.textContent).toContain('Treat with caution');
    fireEvent.click(screen.getByTestId(`review-${REC_ID}`));
    const why = screen.getByTestId(`deep-analysis-why-${REC_ID}`);
    expect(why.textContent).toContain('The margin buffer is thin for this category.');
    expect(why.textContent).toMatch(/built-in rules only/i);
    expect(why.textContent).toMatch(/Unsupported claims were removed/i);
  });
});

describe('DeepAnalysisPanel — Approve / Ignore', () => {
  it('Approve creates a pending draft through the existing proposal flow, with the exact id', async () => {
    await runAndWait();
    fireEvent.click(screen.getByTestId(`approve-${REC_ID}`));
    await waitFor(() => expect(screen.getByTestId(`deep-analysis-approved-${REC_ID}`)).toBeTruthy());

    expect(createProposalFromRecommendation).toHaveBeenCalledWith(
      expect.objectContaining({ id: REC_ID, type: 'CREATE_PROMOTION', title: 'Lift quiet weekday covers' }),
    );
    const confirmation = screen.getByTestId(`deep-analysis-approved-${REC_ID}`);
    expect(confirmation.textContent).toContain('Draft saved');
    expect(confirmation.textContent).toMatch(/nothing has been sent/i);
  });

  it('cannot approve the same idea twice', async () => {
    await runAndWait();
    fireEvent.click(screen.getByTestId(`approve-${REC_ID}`));
    await waitFor(() => expect(screen.getByTestId(`deep-analysis-approved-${REC_ID}`)).toBeTruthy());
    expect(screen.queryByTestId(`approve-${REC_ID}`)).toBeNull();
    expect(createProposalFromRecommendation).toHaveBeenCalledTimes(1);
  });

  it('reports a skipped draft honestly instead of claiming success', async () => {
    createProposalFromRecommendation.mockResolvedValue({ success: true, proposal: { created: false, skipReason: 'A draft for this recommendation already exists.' } });
    await runAndWait();
    fireEvent.click(screen.getByTestId(`approve-${REC_ID}`));
    await waitFor(() => expect(screen.getByTestId('deep-analysis-action-error')).toBeTruthy());
    expect(screen.getByTestId('deep-analysis-action-error').textContent).toContain('A draft for this recommendation already exists.');
    expect(screen.queryByTestId(`deep-analysis-approved-${REC_ID}`)).toBeNull();
  });

  it('Ignore records a neutral owner decision and cannot repeat', async () => {
    await runAndWait();
    fireEvent.click(screen.getByTestId(`ignore-${REC_ID}`));
    await waitFor(() => expect(screen.getByTestId(`deep-analysis-ignored-${REC_ID}`)).toBeTruthy());

    expect(recordRecommendationFeedback).toHaveBeenCalledWith(
      REC_ID,
      expect.objectContaining({ rating: 'neutral' }),
    );
    expect(screen.getByTestId(`deep-analysis-ignored-${REC_ID}`).textContent).toMatch(/your decision was recorded/i);
    expect(screen.queryByTestId(`ignore-${REC_ID}`)).toBeNull();
  });

  it('does not claim a decision was recorded when the save fails', async () => {
    recordRecommendationFeedback.mockResolvedValue({ success: false });
    await runAndWait();
    fireEvent.click(screen.getByTestId(`ignore-${REC_ID}`));
    await waitFor(() => expect(screen.getByTestId('deep-analysis-action-error')).toBeTruthy());
    expect(screen.queryByTestId(`deep-analysis-ignored-${REC_ID}`)).toBeNull();
  });

  it('BLOCKS a candidate that failed deterministic validation — the gate cannot be bypassed from the UI', async () => {
    const result = makeResult();
    result.recommendations[0].validation = {
      candidateId: REC_ID,
      passed: false,
      rejectionCodes: ['ECONOMICS_UNSAFE'],
      checks: [{ name: 'economic_safety', status: 'fail', detail: 'The discount would drop margin below your floor.' }],
    };
    runMarketingAnalyze.mockResolvedValue({ success: true, result });
    await runAndWait();

    expect(screen.getByTestId(`validation-failed-${REC_ID}`).textContent).toContain('Blocked');
    fireEvent.click(screen.getByTestId(`review-${REC_ID}`));
    expect(screen.getByTestId(`deep-analysis-validation-${REC_ID}`).textContent).toMatch(/Blocked because the discount would eat too much profit/i);
    expect((screen.getByTestId(`approve-${REC_ID}`) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId(`approve-${REC_ID}`));
    expect(createProposalFromRecommendation).not.toHaveBeenCalled();
  });
});

describe('DeepAnalysisPanel — limitations and learning are always disclosed', () => {
  it('shows what was set aside and why', async () => {
    await runAndWait();
    const rejected = screen.getByTestId('deep-analysis-rejected');
    expect(rejected.textContent).toContain('Discount a stockout-risk dish');
    expect(rejected.textContent).toMatch(/a targeted item may run out/i);
  });

  it('says whether feasibility was actually checked instead of implying it passed', async () => {
    await runAndWait();
    const sources = screen.getByTestId('deep-analysis-validation-sources');
    expect(sources.textContent).toMatch(/Stock risk: Could not be checked/i);
    expect(sources.textContent).toMatch(/Live offer overlap: 16 active offer/i);
  });

  it('reports the learning of the run with counts, never invented numbers', async () => {
    await runAndWait();
    const learned = screen.getByTestId('deep-analysis-learned');
    expect(learned.textContent).toMatch(/Learned from 1 measured outcome/i);
    expect(learned.textContent).toMatch(/next one can build on it/i);
  });

  it('says the analysis could not be saved when the memory write failed', async () => {
    const result = makeResult();
    result.memoryWrite = { attempted: true, episodeWritten: false, recommendationsRecorded: 0, reason: 'mongo down' };
    runMarketingAnalyze.mockResolvedValue({ success: true, result });
    await runAndWait();
    expect(screen.getByTestId('deep-analysis-learned').textContent).toMatch(/could not be saved to memory/i);
  });

  it('never renders hidden reasoning, even when a payload smuggles one in', async () => {
    const smuggled = makeResult() as MarketingAnalyzeResult & Record<string, unknown>;
    (smuggled as unknown as Record<string, unknown>).chainOfThought = 'SECRET-REASONING-STEPS';
    (smuggled.recommendations[0] as unknown as Record<string, unknown>).reasoning = 'SECRET-CANDIDATE-REASONING';
    runMarketingAnalyze.mockResolvedValue({ success: true, result: smuggled });
    await runAndWait();
    fireEvent.click(screen.getByTestId(`review-${REC_ID}`));
    expect(document.body.textContent).not.toContain('SECRET-REASONING-STEPS');
    expect(document.body.textContent).not.toContain('SECRET-CANDIDATE-REASONING');
  });

  it('resets the previous decisions when a new analysis runs (they belong to the old run)', async () => {
    await runAndWait();
    fireEvent.click(screen.getByTestId(`ignore-${REC_ID}`));
    await waitFor(() => expect(screen.getByTestId(`deep-analysis-ignored-${REC_ID}`)).toBeTruthy());

    fireEvent.click(screen.getByTestId('run-deep-analysis'));
    await waitFor(() => expect(screen.queryByTestId(`deep-analysis-ignored-${REC_ID}`)).toBeNull());
    expect(screen.getByTestId(`approve-${REC_ID}`)).toBeTruthy();
  });
});

describe('DeepAnalysisPanel — a REAL captured /analyze response renders correctly', () => {
  /**
   * This block deliberately does NOT use a hand-written fixture: it renders a
   * verbatim capture of a live backend response (fixtures/realAnalyzeResponse).
   * Its job is to catch CONTRACT DRIFT — if the API shape changes, this fails
   * here instead of the owner seeing a broken report.
   */
  beforeEach(() => {
    runMarketingAnalyze.mockResolvedValue({ success: true, result: REAL_ANALYZE_RESPONSE });
  });

  it('renders the live payload end to end', async () => {
    await runAndWait();
    const status = screen.getByTestId('deep-analysis-status');
    expect(status.textContent).toContain(REAL_ANALYZE_RESPONSE.objective);
    expect(status.textContent).toMatch(/approval is always required/i);
  });

  it('reports exactly the areas the backend investigated, and only those', async () => {
    await runAndWait();
    const investigated = screen.getByTestId('deep-analysis-investigated');
    for (const d of REAL_ANALYZE_RESPONSE.situation.investigatedDomains) {
      expect(screen.getByTestId(`investigated-${d.domain}`)).toBeTruthy();
    }
    // A real run on this tenant has areas with no data — they must say so.
    for (const d of REAL_ANALYZE_RESPONSE.situation.investigatedDomains) {
      if (d.status === 'unavailable') {
        expect(within(investigated).getByTestId(`investigated-${d.domain}`).textContent).toContain('No data');
      }
    }
  });

  it('renders every real finding, signal and disclosed limitation', async () => {
    await runAndWait();
    for (const f of REAL_ANALYZE_RESPONSE.situation.confirmedFacts) {
      expect(screen.getByTestId('deep-analysis-facts').textContent).toContain(f.statement);
    }
    const signals = screen.getByTestId('deep-analysis-signals');
    for (const s of REAL_ANALYZE_RESPONSE.situation.topSignals) {
      expect(signals.textContent).toContain(s.statement);
    }
    const degradations = screen.getByTestId('deep-analysis-degradations');
    for (const d of REAL_ANALYZE_RESPONSE.degradations) {
      expect(degradations.textContent).toContain(d);
    }
  });

  it('renders the real validation sources and learning counts as reported', async () => {
    await runAndWait();
    const sources = screen.getByTestId('deep-analysis-validation-sources').textContent ?? '';
    expect(sources).toMatch(
      REAL_ANALYZE_RESPONSE.validationSources.activeOffers.status === 'ok'
        ? /Live offer overlap: .*active offer/i
        : /Live offer overlap: Could not be checked/i,
    );
    expect(screen.getByTestId('deep-analysis-learned').textContent).toMatch(
      REAL_ANALYZE_RESPONSE.outcomeLearning.outcomesLinked > 0
        ? /Learned from \d+ measured outcome/i
        : /No measured campaign outcome was waiting/i,
    );
  });

  it('never leaks a raw evidence ref or the tenant id from a real payload', async () => {
    await runAndWait();
    const text = document.body.textContent ?? '';
    expect(text).not.toContain('signal:');
    expect(text).not.toContain('80022f');
    expect(text).not.toMatch(/investigate[A-Z]\w*Domain/);
  });

  it('stays honest when the real run produced no action (this tenant does)', async () => {
    await runAndWait();
    if (REAL_ANALYZE_RESPONSE.recommendations.length === 0) {
      expect(screen.getByTestId('deep-analysis-no-opportunities')).toBeTruthy();
      expect(screen.queryByTestId('deep-analysis-card')).toBeNull();
    } else {
      expect(screen.getAllByTestId('deep-analysis-card').length).toBe(REAL_ANALYZE_RESPONSE.recommendations.length);
    }
  });
});

describe('DeepAnalysisPanel — the panel explains itself when empty', () => {
  it('tells the owner what the analysis does before it is run', () => {
    renderPanel();
    const section = screen.getByTestId('deep-analysis-section');
    expect(section.textContent).toMatch(/one area at a time/i);
    expect(section.textContent).toMatch(/Read-only/i);
    expect(screen.getByTestId('deep-analysis-empty').textContent).toMatch(/run one to see/i);
  });
});

describe('DeepAnalysisPanel — friendly copy helpers used by the panel', () => {
  it('translates every domain the backend can report', async () => {
    const { friendlyDomain } = await import('../agentCopy');
    expect(friendlyDomain('marketing_history')).toBe('Past offers & campaigns');
    expect(friendlyDomain('feedback')).toBe('Guest feedback');
    expect(friendlyDomain('some_future_domain')).toBe('some future domain');
    expect(friendlyDomain(undefined)).toBe('Unknown area');
  });
});

describe('DeepAnalysisPanel — accessibility of the run controls', () => {
  it('labels the question and window inputs', () => {
    renderPanel();
    expect(within(screen.getByTestId('deep-analysis-section')).getByLabelText(/what do you want to improve/i)).toBeTruthy();
    expect(within(screen.getByTestId('deep-analysis-section')).getByLabelText(/how far back/i)).toBeTruthy();
  });

  it('marks the details toggle as expandable', async () => {
    await runAndWait();
    expect(screen.getByTestId(`review-${REC_ID}`).getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(screen.getByTestId(`review-${REC_ID}`));
    expect(screen.getByTestId(`review-${REC_ID}`).getAttribute('aria-expanded')).toBe('true');
  });
});
