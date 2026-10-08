/**
 * RecommendationsPage — proves the Marketing page shows the TWO intelligence
 * systems as clearly separated surfaces:
 *
 *   AI Insights        (System #2 — agentic, ADVISORY, not actionable)
 *   Recommended Actions(System #3 — ranked, ACTIONABLE, → proposal)
 *
 * and that the recommendation → proposal flow preserves the exact selected
 * recommendation id (displayed id === proposal.sourceRecommendationId).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import RecommendationsPage from '../RecommendationsPage';

const runMarketingInsights = vi.fn();
const runMarketingIntelligence = vi.fn();
const createProposalFromRecommendation = vi.fn();
const recordRecommendationFeedback = vi.fn();
/**
 * The deep-analysis panel calls its own endpoint on an owner click. These
 * tests never click it, so the mock only needs to exist — a missing export
 * would still be an undefined binding at the call site.
 */
const runMarketingAnalyze = vi.fn();

vi.mock('../../../api/client', () => ({
  runMarketingInsights: (...a: unknown[]) => runMarketingInsights(...a),
  runMarketingIntelligence: (...a: unknown[]) => runMarketingIntelligence(...a),
  createProposalFromRecommendation: (...a: unknown[]) => createProposalFromRecommendation(...a),
  recordRecommendationFeedback: (...a: unknown[]) => recordRecommendationFeedback(...a),
  runMarketingAnalyze: (...a: unknown[]) => runMarketingAnalyze(...a),
}));

const REC_ID = 'promo_demand_restaurant_revenue_drop';

const insightRun = {
  success: true,
  result: {
    mode: 'agentic_insight' as const,
    insights: [
      {
        id: 'insight_abc',
        type: 'agentic_insight' as const,
        title: 'Weekday lunch demand is weakening',
        summary: 'Recent menu performance shows weaker weekday demand on high-margin items.',
        priority: 'high' as const,
        recommendation: 'Review a targeted weekday lunch promotion.',
        evidence: [{ ref: 'getMenuPerformance', label: 'Menu performance' }],
        confidence: 0.6,
        toolsUsed: ['getMenuPerformance'],
        steps: [{ step: 1, tool: 'getMenuPerformance', purpose: 'Identify weak products', ok: true }],
        degraded: false,
        generatedAt: new Date().toISOString(),
      },
    ],
    investigation: {
      runId: 'run_1',
      requestId: 'run_1',
      status: 'completed_sufficient',
      stepsUsed: 1,
      toolCallsUsed: 1,
      llmCalls: 2,
      toolNames: ['getMenuPerformance'],
      rejections: [],
      degraded: false,
    },
    degraded: false,
    generatedAt: new Date().toISOString(),
  },
};

const intelligenceRun = {
  success: true,
  result: {
    ranking: {
      recommendations: [
        {
          rank: 1,
          id: REC_ID,
          type: 'CREATE_PROMOTION',
          strategyLabel: 'Demand recovery',
          title: 'Daily Revenue Demand Recovery',
          description: 'A weekday promotion on high-margin items.',
          recommendedAction: 'Create a 10% weekday offer.',
          engineScore: 0.8,
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
          risks: [],
          prerequisites: [],
          why: [],
          provenance: { signalCodes: [], signalThemes: [], mlKinds: [], memoryRefs: [] },
        },
      ],
      strategies: [],
      considered: 1,
      diversityRelaxed: false,
      notes: [],
      generatedAt: new Date().toISOString(),
    },
    investigation: { summary: { signals: 10, usable: true, unavailableDimensions: [], toolErrors: 0, freshness: { fresh: 10, aging: 0, stale: 0, unknown: 0, expired: 0 } }, topSignalLines: [], unavailableDimensions: [] },
    ml: { degradationLines: [], summary: { availableKinds: [], hasCausalEvidence: false } },
    explanation: null,
    memory: { episodes: 0, longTerm: 0, degraded: false, statements: [] },
    degradations: [],
    generatedAt: new Date().toISOString(),
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  runMarketingInsights.mockResolvedValue(insightRun);
  runMarketingIntelligence.mockResolvedValue(intelligenceRun);
  createProposalFromRecommendation.mockResolvedValue({
    success: true,
    proposal: { created: true, proposalId: 'proposal_123', readiness: { canSchedule: false, blockers: ['approval required'], audienceCount: 0 } },
  });
  recordRecommendationFeedback.mockResolvedValue({ success: true, message: 'saved' });
});

function renderPage(onCreate: (s: unknown) => void = vi.fn()) {
  return render(
    <RecommendationsPage recommendations={[]} loading={false} currencySymbol="₹" onCreate={onCreate} />,
  );
}

/** Minimal real-shaped ranked recommendation (no invented extra fields). */
function makeRec(i: number) {
  return {
    rank: i,
    id: `rec_${i}`,
    type: 'CREATE_PROMOTION',
    strategyLabel: i % 2 === 0 ? 'WEEKDAY' : 'PROMOTION',
    title: `Recommendation ${i}`,
    description: `Description ${i}`,
    recommendedAction: `Action ${i}`,
    engineScore: 0.8,
    confidence: 0.6,
    priority: 'high',
    economics: {
      discountPercent: 10,
      projectedContributionMargin: 32,
      incrementalRevenue: 5000,
      incrementalUnits: 20,
      breakEvenIncrementalUnits: 5,
      paybackPeriodDays: 5,
      economicallySafe: true,
      available: true,
    },
    risks: [],
    prerequisites: [],
    why: [],
    provenance: { signalCodes: [], mlKinds: [], memoryRefs: [] },
  };
}

/** Intelligence response shaped exactly like the existing fixture. */
function makeIntelRun(recs: ReturnType<typeof makeRec>[]) {
  return {
    success: true,
    result: {
      ...intelligenceRun.result,
      ranking: { ...intelligenceRun.result.ranking, recommendations: recs },
    },
  };
}

describe('RecommendationsPage — two marketing brains shown separately', () => {
  it('renders AI Insights and Recommended Actions as distinct sections', async () => {
    renderPage();
    expect(screen.getByTestId('ai-insights-section')).toBeTruthy();
    expect(screen.getByTestId('recommended-actions-section')).toBeTruthy();

    fireEvent.click(screen.getByTestId('run-ai-insights'));
    await waitFor(() => expect(screen.getByTestId('ai-insight-card')).toBeTruthy());
    expect(screen.getByTestId('ai-insight-card').getAttribute('data-insight-id')).toBe('insight_abc');

    fireEvent.click(screen.getByTestId('run-intelligence'));
    await waitFor(() => expect(screen.getByTestId('recommended-action-card')).toBeTruthy());
    expect(screen.getByTestId('recommended-action-card').getAttribute('data-recommendation-id')).toBe(REC_ID);
  });

  it('agentic insight cards are advisory — they have no action button', async () => {
    renderPage();
    fireEvent.click(screen.getByTestId('run-ai-insights'));
    await waitFor(() => expect(screen.getByTestId('ai-insight-card')).toBeTruthy());

    const insightSection = within(screen.getByTestId('ai-insights-section'));
    expect(insightSection.queryByText('Create proposal')).toBeNull();
    expect(insightSection.queryByText(/approval is required/i)).toBeNull();
  });

  it('only the recommendation card is actionable and the proposal keeps the selected id', async () => {
    renderPage();
    fireEvent.click(screen.getByTestId('run-intelligence'));
    await waitFor(() => expect(screen.getByTestId('recommended-action-card')).toBeTruthy());

    fireEvent.click(screen.getByTestId(`create-proposal-${REC_ID}`));
    await waitFor(() => expect(screen.getByTestId('proposal-result')).toBeTruthy());

    // Displayed recommendation id === selected id === proposal.sourceRecommendationId
    expect(screen.getByTestId('proposal-source-id').textContent).toBe(REC_ID);
    expect(screen.getByTestId('proposal-id').textContent).toBe('proposal_123');
    expect(createProposalFromRecommendation).toHaveBeenCalledWith(expect.objectContaining({ id: REC_ID, type: 'CREATE_PROMOTION' }));
  });
});

describe('RecommendationsPage — "What the AI checked" chips', () => {
  it('derives chips from the real tools used, deduped, and never leaks internal names', async () => {
    runMarketingInsights.mockResolvedValue({
      success: true,
      result: {
        ...insightRun.result,
        insights: [{
          ...insightRun.result.insights[0],
          toolsUsed: ['getSalesTrends', 'getSalesTrends', 'getMenuPerformance', 'getCustomerSegments', 'getSomeFutureTool'],
        }],
      },
    });
    renderPage();
    await waitFor(() => expect(screen.getByTestId('ai-insight-checked')).toBeTruthy());

    const checked = screen.getByTestId('ai-insight-checked');
    expect(checked.textContent).toContain('Sales');
    expect(checked.textContent).toContain('Menu performance');
    expect(checked.textContent).toContain('Customers');
    // dedup: one "Sales" chip, not two
    expect(within(checked).getAllByText('Sales')).toHaveLength(1);
    // no internal identifiers reach the owner
    expect(checked.textContent).not.toMatch(/get[A-Z]/);
    expect(checked.textContent).not.toContain('getSomeFutureTool');
  });
});

describe('RecommendationsPage — Draft / Reject / Create Offer actions', () => {
  it('Draft saves via the proposal flow, confirms "Saved to Drafts", and cannot repeat', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId('recommended-action-card')).toBeTruthy());

    fireEvent.click(screen.getByTestId(`create-proposal-${REC_ID}`));
    await waitFor(() => expect(screen.getByTestId('proposal-result')).toBeTruthy());
    expect(screen.getByTestId('proposal-result').textContent).toContain('Saved to Drafts');
    expect(screen.getByTestId('proposal-source-id').textContent).toBe(REC_ID);

    const btn = screen.getByTestId(`create-proposal-${REC_ID}`) as HTMLButtonElement;
    expect(btn.textContent).toContain('Saved to Drafts');
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn); // duplicate guard
    expect(createProposalFromRecommendation).toHaveBeenCalledTimes(1);
  });

  it('Reject persists owner feedback, keeps the card visible as audited, and cannot repeat', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId('recommended-action-card')).toBeTruthy());

    fireEvent.click(screen.getByTestId(`reject-${REC_ID}`));
    await waitFor(() => expect(screen.getByTestId(`rejected-${REC_ID}`)).toBeTruthy());

    // Existing persistent feedback endpoint, negative rating — not frontend-only state
    expect(recordRecommendationFeedback).toHaveBeenCalledTimes(1);
    expect(recordRecommendationFeedback).toHaveBeenCalledWith(
      REC_ID,
      expect.objectContaining({ rating: 'negative' }),
    );

    // Confirmation shown; card stays (audit) but actions are replaced
    expect(screen.getByTestId(`rejected-${REC_ID}`).textContent).toContain('Recommendation rejected');
    expect(screen.getAllByTestId('recommended-action-card')).toHaveLength(1);
    expect(screen.queryByTestId(`reject-${REC_ID}`)).toBeNull();
    expect(screen.queryByTestId(`create-proposal-${REC_ID}`)).toBeNull();
    expect(screen.queryByTestId(`create-offer-${REC_ID}`)).toBeNull();
  });

  it('Create Offer hands the recommendation to the existing flow with its id (nothing sent)', async () => {
    const onCreate = vi.fn();
    renderPage(onCreate);
    await waitFor(() => expect(screen.getByTestId('recommended-action-card')).toBeTruthy());

    fireEvent.click(screen.getByTestId(`create-offer-${REC_ID}`));
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
      recommendationSource: 'rule',
      recommendationSourceId: REC_ID,
      action: 'create_offer',
      offerSuggestion: expect.objectContaining({ type: 'percentage', value: 10 }),
    }));
  });
});

describe('RecommendationsPage — deep analysis is an added surface, not a rewrite', () => {
  it('renders the deep-analysis section and does NOT run it automatically', async () => {
    renderPage();
    expect(screen.getByTestId('deep-analysis-section')).toBeTruthy();
    // Owner-invoked only: a deep run spends several LLM calls, so loading the
    // page must never start one behind the owner's back.
    expect(runMarketingAnalyze).not.toHaveBeenCalled();
    expect(screen.getByTestId('deep-analysis-empty')).toBeTruthy();
  });

  it('keeps the two existing intelligence surfaces intact beside it', async () => {
    renderPage();
    expect(screen.getByTestId('ai-insights-section')).toBeTruthy();
    expect(screen.getByTestId('recommended-actions-section')).toBeTruthy();
    expect(screen.getByTestId('deep-analysis-section')).toBeTruthy();

    // The pre-existing sections still behave exactly as before.
    await waitFor(() => expect(screen.getByTestId('ai-insight-card')).toBeTruthy());
    await waitFor(() => expect(screen.getByTestId('recommended-action-card')).toBeTruthy());
    expect(runMarketingInsights).toHaveBeenCalledTimes(1);
    expect(runMarketingIntelligence).toHaveBeenCalledTimes(1);
  });
});

describe('RecommendationsPage — pagination, loading, error and empty states', () => {
  it('shows 3 cards first and expands the rest via View more', async () => {
    runMarketingIntelligence.mockResolvedValue(makeIntelRun([1, 2, 3, 4, 5].map(makeRec)));
    renderPage();
    await waitFor(() => expect(screen.getAllByTestId('recommended-action-card')).toHaveLength(3));

    const more = screen.getByTestId('view-more-recommendations');
    expect(more.textContent).toContain('2 more');
    fireEvent.click(more);
    expect(screen.getAllByTestId('recommended-action-card')).toHaveLength(5);
    expect(screen.queryByTestId('view-more-recommendations')).toBeNull();
  });

  it('shows compact human loading states, never internal tool execution', async () => {
    runMarketingInsights.mockReturnValue(new Promise(() => {}));
    runMarketingIntelligence.mockReturnValue(new Promise(() => {}));
    renderPage();
    await waitFor(() => expect(screen.getByTestId('ai-insight-loading')).toBeTruthy());

    expect(screen.getByTestId('recommendations-loading')).toBeTruthy();
    expect(screen.getByText(/Analyzing your restaurant data/)).toBeTruthy();
    expect(screen.queryByText(/get[A-Z]/)).toBeNull(); // no getSalesTrends… style output
  });

  it('shows friendly error states with retry, never raw backend errors', async () => {
    runMarketingInsights.mockRejectedValue(new Error('Request failed with status 500'));
    runMarketingIntelligence.mockRejectedValue(new Error('Request failed with status 500'));
    renderPage();
    await waitFor(() => expect(screen.getByTestId('ai-insight-error')).toBeTruthy());

    expect(screen.getByTestId('ai-insight-retry')).toBeTruthy();
    expect(screen.getByTestId('recommendations-error')).toBeTruthy();
    expect(screen.getByTestId('recommendations-retry')).toBeTruthy();
    expect(screen.getByTestId('ai-insight-error').textContent).not.toContain('500');
    expect(screen.getByTestId('recommendations-error').textContent).not.toContain('status');
  });

  /**
   * Real observed shape of promo_demand_restaurant_revenue_drop on a tenant
   * with no price/cost data: economics.available=false, no target, no discount.
   */
  function makeSparseRec() {
    return {
      ...makeRec(1),
      id: REC_ID,
      strategyLabel: 'targeted promotion',
      economics: {
        discountPercent: 0,
        projectedContributionMargin: 0,
        incrementalRevenue: 0,
        incrementalUnits: 0,
        breakEvenIncrementalUnits: 0,
        paybackPeriodDays: 0,
        economicallySafe: false,
        available: false,
      },
      target: { productIds: [], productNames: [], categoryIds: [], segmentIds: [] },
    };
  }

  it('hides the card and states the low-data reason when target, duration and expected impact are all unavailable', async () => {
    runMarketingIntelligence.mockResolvedValue(makeIntelRun([makeSparseRec()]));
    renderPage();
    await waitFor(() => expect(screen.getByTestId('recommendations-low-data')).toBeTruthy());

    // No template card: three "Not available" cells plus a dead Create Offer
    // button is not an action the owner can take.
    expect(screen.queryByTestId('recommended-action-card')).toBeNull();
    expect(screen.queryByTestId(`create-offer-${REC_ID}`)).toBeNull();

    const lowData = screen.getByTestId('recommendations-low-data');
    expect(lowData.textContent).toContain('Not enough data for an action yet');
    // The reason is derived from the candidate's OWN missing fields…
    expect(lowData.textContent).toMatch(/audience/i);
    expect(lowData.textContent).toMatch(/duration/i);
    expect(lowData.textContent).toMatch(/price and cost data/i);
    // …and no number is invented anywhere in the section.
    expect(screen.getByTestId('recommended-actions-section').textContent).not.toContain('+₹');
    // Low data is not an error: nothing failed, so no retry copy appears.
    expect(screen.queryByTestId('recommendations-error')).toBeNull();
  });

  it('still shows a card that carries a real target, and never invents the numbers it lacks', async () => {
    const targeted = {
      ...makeSparseRec(),
      target: { productIds: ['p1'], productNames: ['Paneer Tikka'], categoryIds: [], segmentIds: [] },
    };
    runMarketingIntelligence.mockResolvedValue(makeIntelRun([targeted]));
    renderPage();
    await waitFor(() => expect(screen.getByTestId('recommended-action-card')).toBeTruthy());

    const card = screen.getByTestId('recommended-action-card');
    expect(card.textContent).toContain('Paneer Tikka');
    // Duration / Expected impact stay honest placeholders.
    expect(within(card).getAllByText('Not available').length).toBeGreaterThanOrEqual(2);
    expect(card.textContent).not.toContain('+₹');
    // Offer terms are missing → the offer flow stays closed instead of guessing.
    expect((screen.getByTestId(`create-offer-${REC_ID}`) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows the actionable cards and says how many data-less ideas were withheld', async () => {
    runMarketingIntelligence.mockResolvedValue(makeIntelRun([makeSparseRec(), makeRec(2)]));
    renderPage();
    await waitFor(() => expect(screen.getAllByTestId('recommended-action-card')).toHaveLength(1));

    expect(screen.getByTestId('recommended-action-card').getAttribute('data-recommendation-id')).toBe('rec_2');
    expect(screen.queryByTestId('recommendations-low-data')).toBeNull();
    const note = screen.getByTestId('recommendations-suppressed-note');
    expect(note.textContent).toContain('1 idea was not shown');
    expect(note.textContent).not.toContain(REC_ID); // never leaks internal ids
  });

  it('shows the empty recommendation state when the pipeline returns none', async () => {
    runMarketingIntelligence.mockResolvedValue(makeIntelRun([]));
    renderPage();
    await waitFor(() => expect(screen.getByTestId('recommendations-empty')).toBeTruthy());

    expect(screen.getByText('No recommendations yet')).toBeTruthy();
    expect(screen.getByText(/needs more restaurant activity/i)).toBeTruthy();
    expect(screen.queryByTestId('recommended-action-card')).toBeNull();
  });

  it('Create Offer looks and reads the same on Recommended Actions and on the Opportunities cards', async () => {
    // An "Opportunities for you" card (the parallel-agent surface) alongside a
    // ranked recommendation that carries real offer terms, so BOTH Create Offer
    // buttons render at once.
    const opportunity = {
      title: 'Weekend combo push',
      description: 'Pair the high-margin items this weekend.',
      type: 'percentage',
      value: 10,
      recommendationSource: 'rule',
      recommendationReason: 'Weekend demand',
      estimatedReach: 120,
      applicableCategories: [],
    };
    render(
      <RecommendationsPage recommendations={[opportunity]} loading={false} currencySymbol="₹" onCreate={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByTestId('recommended-action-card')).toBeTruthy());

    const actionsButton = screen.getByTestId(`create-offer-${REC_ID}`);
    const others = screen
      .getAllByText('Create Offer')
      .map((el) => el.closest('button'))
      .filter((b): b is HTMLButtonElement => b !== null && b.dataset.testid !== `create-offer-${REC_ID}`);
    expect(others).toHaveLength(1);
    const opportunityButton = others[0];

    // One visual language across both offer entry points: the same brand-colour
    // pill, radius, type scale and weight — no second, different-looking button.
    for (const btn of [actionsButton, opportunityButton]) {
      expect(btn.className).toContain('bg-[var(--brand-color)]');
      expect(btn.className).toContain('rounded-xl');
      expect(btn.className).toContain('text-xs');
      expect(btn.className).toContain('font-black');
      expect(btn.textContent?.trim()).toBe('Create Offer');
    }
  });
});
