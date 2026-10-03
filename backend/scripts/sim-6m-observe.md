# AI Tools + Marketing Agent — SIM_RESTAURANT_6M_001

Generated 2026-10-03T07:38:37.403Z

| Tool | Registered | Works | Data | Meaningful | Notes |
|---|---|---|---|---|---|
| getSalesTrends | yes | ✓ | reported-unavailable | yes |  |
| getInventoryStatus | yes | ✓ | yes | yes |  |
| getExpiryRisk | yes | ✓ | reported-unavailable | yes |  |
| getWastage | yes | ✓ | reported-unavailable | yes |  |
| getStockoutRisk | yes | ✓ | reported-unavailable | yes |  |
| getCustomerSegments | yes | ✓ | yes | yes |  |
| getRetentionSignals | yes | ✓ | yes | yes |  |
| getMenuPerformance | yes | ✓ | reported-unavailable | yes |  |
| getProductMargins | yes | ✓ | yes | yes |  |
| getProductCombinations | yes | ✓ | reported-unavailable | yes |  |
| getActiveOffers | yes | ✓ | reported-unavailable | yes |  |
| getOfferPerformance | yes | ✓ | yes | yes |  |
| getCampaignPerformance | yes | ✓ | yes | yes |  |
| getRestaurantProfile | yes | ✓ | yes | yes |  |
| getBranches | yes | ✓ | yes | yes |  |
| getFestivalContext | yes | ✓ | yes | yes |  |
| getWeatherContext | yes | ✓ | reported-unavailable | yes |  |
| getSportsContext | yes | ✓ | reported-unavailable | yes |  |
| getNearbyCompetition | yes | ✓ | yes | yes |  |
| getDemandForecast | yes | ✓ | reported-unavailable | yes |  |
| getMarketBasketSignals | yes | ✓ | reported-unavailable | yes |  |
| getMLCustomerSegments | yes | ✓ | yes | yes |  |
| getUpliftSignals | yes | ✓ | reported-unavailable | yes |  |
| getOfferResponsePrediction | yes | ✓ | reported-unavailable | yes |  |

## Marketing Agent

- targetingSource: **ML_SEGMENTS**
- reason: Uplift gate not passed: no evaluable experiment. Falling back to stored segmentation.
- scope: segment membership — descriptive grouping; no per-customer model score
- targets: 5
- offer draft: —
- evidence: festival=— · sports=— · competition=Competition context: 20 nearby restaurants within 2 km, nearest ~70m, low density. · basket=—

Next actions:
- Segments are descriptive — verify the top segment manually before a send.
- Grow the experiment ledger (assign a control group) to unlock causal targeting.
- All customers have trained segment assignments.
