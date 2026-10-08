/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * realAnalyzeResponse.ts — a VERBATIM capture of a live
 * `POST /api/ai/marketing-agent/analyze` response (HTTP 200, tenant B,
 * lookbackDays 60).
 *
 * Captured so the panel is proven against the REAL backend contract rather
 * than an idealized hand-written fixture: if the API shape drifts, this test
 * fails instead of the owner seeing a broken report.
 *
 * The payload is stored as-is (no ids or PII beyond the tenant-scoped refs the
 * backend itself returns, which the panel is required to translate away).
 */
import type { MarketingAnalyzeResult } from "../../../../api/client";

export const REAL_ANALYZE_RESPONSE = {
  "mode": "marketing_analyze",
  "runId": "53676f67-7671-4fa7-a2d7-1161f85ef8dc",
  "status": "completed_degraded",
  "objective": "Where am I losing money?",
  "situation": {
    "objective": "Where am I losing money?",
    "investigatedDomains": [
      {
        "domain": "sales",
        "status": "ok",
        "findingCount": 8,
        "signalCount": 8,
        "implemented": true
      },
      {
        "domain": "products",
        "status": "unavailable",
        "findingCount": 0,
        "signalCount": 0,
        "reasonCode": "NO_DATA_IN_DOMAIN",
        "degradedReason": "No usable evidence was produced for this domain in the analysed window.",
        "implemented": true
      },
      {
        "domain": "inventory",
        "status": "unavailable",
        "findingCount": 0,
        "signalCount": 0,
        "reasonCode": "NO_DATA_IN_DOMAIN",
        "degradedReason": "No usable evidence was produced for this domain in the analysed window.",
        "implemented": true
      }
    ],
    "unavailableDomains": [
      "products",
      "inventory"
    ],
    "confirmedFacts": [
      {
        "statement": "Recent daily revenue averages 0 across 275 orders in the tool's lookback window.",
        "domain": "sales",
        "confidence": 0.8,
        "evidenceRefs": [
          "signal:sales_revenue_level:80022f:restaurant"
        ]
      },
      {
        "statement": "Average order value is 959.",
        "domain": "sales",
        "confidence": 0.8,
        "evidenceRefs": [
          "signal:sales_aov_level:80022f:restaurant"
        ]
      },
      {
        "statement": "Sunday is the strongest weekday by revenue (80604).",
        "domain": "sales",
        "confidence": 0.7,
        "evidenceRefs": [
          "signal:sales_weekday_peak:80022f:weekday:0"
        ]
      },
      {
        "statement": "Peak revenue hour is 12:00 (50188).",
        "domain": "sales",
        "confidence": 0.65,
        "evidenceRefs": [
          "signal:sales_hour_peak:80022f:hour:12"
        ]
      }
    ],
    "opportunities": [
      {
        "statement": "Thursday is the weakest weekday by revenue (18275).",
        "domain": "sales",
        "confidence": 0.7,
        "evidenceRefs": [
          "signal:sales_weekday_trough:80022f:weekday:4"
        ]
      },
      {
        "statement": "Weakest revenue hour is 00:00 (0).",
        "domain": "sales",
        "confidence": 0.6,
        "evidenceRefs": [
          "signal:sales_hour_trough:80022f:hour:0"
        ]
      },
      {
        "statement": "Category \"Other\" is a top revenue contributor (0 from 1942 units).",
        "domain": "sales",
        "confidence": 0.7,
        "evidenceRefs": [
          "signal:sales_category_strong:80022f:Other"
        ]
      },
      {
        "statement": "Category \"Other\" is a weak revenue contributor (0 from 1942 units).",
        "domain": "sales",
        "confidence": 0.65,
        "evidenceRefs": [
          "signal:sales_category_weak:80022f:Other"
        ]
      }
    ],
    "risks": [],
    "contradictions": [
      "category:Other appears as both rising (sales_category_strong) and falling (sales_category_weak) — the two readings disagree and were not resolved automatically."
    ],
    "uncertainties": [
      "products: No usable evidence was produced for this domain in the analysed window.",
      "inventory: No usable evidence was produced for this domain in the analysed window."
    ],
    "missingEvidence": [
      "products: no usable evidence in the analysed window",
      "inventory: no usable evidence in the analysed window",
      "feedback: capability declared but not implemented",
      "competition: capability declared but not implemented"
    ],
    "topSignals": [
      {
        "code": "sales_aov_level",
        "category": "sales",
        "source": "sales_context",
        "statement": "Average order value is 959.",
        "value": 959,
        "unit": "currency/order",
        "direction": "unknown",
        "confidence": 0.8,
        "sampleSize": 275,
        "evidence": [
          {
            "kind": "metric",
            "ref": "metric:aov",
            "value": 959,
            "observedAt": "2026-10-06T04:23:27.618Z"
          }
        ],
        "signalId": "sales_aov_level:80022f:restaurant",
        "scope": {
          "restaurantId": "6aa7b065f8f259166180022f",
          "branchId": null,
          "scope": "tenant"
        },
        "freshness": "fresh",
        "generatedAt": "2026-10-06T04:23:27.618Z",
        "periodStart": "2026-07-08T04:23:27.618Z",
        "periodEnd": "2026-10-06T04:23:27.618Z"
      },
      {
        "code": "sales_revenue_level",
        "category": "sales",
        "source": "sales_context",
        "statement": "Recent daily revenue averages 0 across 275 orders in the tool's lookback window.",
        "value": 0,
        "unit": "currency/day",
        "direction": "unknown",
        "confidence": 0.8,
        "sampleSize": 275,
        "evidence": [
          {
            "kind": "tool_output",
            "ref": "tool:getSalesTrends",
            "value": 0,
            "observedAt": "2026-10-06T04:23:27.618Z"
          }
        ],
        "signalId": "sales_revenue_level:80022f:restaurant",
        "scope": {
          "restaurantId": "6aa7b065f8f259166180022f",
          "branchId": null,
          "scope": "tenant"
        },
        "freshness": "fresh",
        "generatedAt": "2026-10-06T04:23:27.618Z",
        "periodStart": "2026-07-08T04:23:27.618Z",
        "periodEnd": "2026-10-06T04:23:27.618Z"
      },
      {
        "code": "sales_category_strong",
        "category": "sales",
        "source": "sales_context",
        "statement": "Category \"Other\" is a top revenue contributor (0 from 1942 units).",
        "value": 0,
        "unit": "currency",
        "direction": "up",
        "confidence": 0.7,
        "sampleSize": 1942,
        "evidence": [
          {
            "kind": "metric",
            "ref": "metric:category:Other:revenue",
            "value": 0,
            "observedAt": "2026-10-06T04:23:27.618Z"
          }
        ],
        "subject": {
          "type": "category",
          "id": "Other",
          "label": "Other"
        },
        "signalId": "sales_category_strong:80022f:Other",
        "scope": {
          "restaurantId": "6aa7b065f8f259166180022f",
          "branchId": null,
          "scope": "tenant"
        },
        "freshness": "fresh",
        "generatedAt": "2026-10-06T04:23:27.618Z",
        "periodStart": "2026-07-08T04:23:27.618Z",
        "periodEnd": "2026-10-06T04:23:27.618Z"
      },
      {
        "code": "sales_weekday_peak",
        "category": "sales",
        "source": "sales_context",
        "statement": "Sunday is the strongest weekday by revenue (80604).",
        "value": 80604,
        "direction": "up",
        "confidence": 0.7,
        "evidence": [
          {
            "kind": "metric",
            "ref": "metric:weekday:0",
            "value": 80604,
            "observedAt": "2026-10-06T04:23:27.618Z"
          }
        ],
        "subject": {
          "type": "time_slot",
          "id": "weekday:0",
          "label": "Sunday"
        },
        "signalId": "sales_weekday_peak:80022f:weekday:0",
        "scope": {
          "restaurantId": "6aa7b065f8f259166180022f",
          "branchId": null,
          "scope": "tenant"
        },
        "freshness": "fresh",
        "generatedAt": "2026-10-06T04:23:27.618Z",
        "periodStart": "2026-07-08T04:23:27.618Z",
        "periodEnd": "2026-10-06T04:23:27.618Z"
      },
      {
        "code": "sales_weekday_trough",
        "category": "sales",
        "source": "sales_context",
        "statement": "Thursday is the weakest weekday by revenue (18275).",
        "value": 18275,
        "direction": "down",
        "confidence": 0.7,
        "evidence": [
          {
            "kind": "metric",
            "ref": "metric:weekday:4",
            "value": 18275,
            "observedAt": "2026-10-06T04:23:27.618Z"
          }
        ],
        "subject": {
          "type": "time_slot",
          "id": "weekday:4",
          "label": "Thursday"
        },
        "signalId": "sales_weekday_trough:80022f:weekday:4",
        "scope": {
          "restaurantId": "6aa7b065f8f259166180022f",
          "branchId": null,
          "scope": "tenant"
        },
        "freshness": "fresh",
        "generatedAt": "2026-10-06T04:23:27.618Z",
        "periodStart": "2026-07-08T04:23:27.618Z",
        "periodEnd": "2026-10-06T04:23:27.618Z"
      },
      {
        "code": "sales_category_weak",
        "category": "sales",
        "source": "sales_context",
        "statement": "Category \"Other\" is a weak revenue contributor (0 from 1942 units).",
        "value": 0,
        "unit": "currency",
        "direction": "down",
        "confidence": 0.65,
        "sampleSize": 1942,
        "evidence": [
          {
            "kind": "metric",
            "ref": "metric:category:Other:revenue",
            "value": 0,
            "observedAt": "2026-10-06T04:23:27.618Z"
          }
        ],
        "subject": {
          "type": "category",
          "id": "Other",
          "label": "Other"
        },
        "signalId": "sales_category_weak:80022f:Other",
        "scope": {
          "restaurantId": "6aa7b065f8f259166180022f",
          "branchId": null,
          "scope": "tenant"
        },
        "freshness": "fresh",
        "generatedAt": "2026-10-06T04:23:27.618Z",
        "periodStart": "2026-07-08T04:23:27.618Z",
        "periodEnd": "2026-10-06T04:23:27.618Z"
      },
      {
        "code": "sales_hour_peak",
        "category": "sales",
        "source": "sales_context",
        "statement": "Peak revenue hour is 12:00 (50188).",
        "value": 50188,
        "direction": "up",
        "confidence": 0.65,
        "evidence": [
          {
            "kind": "metric",
            "ref": "metric:hour:12",
            "value": 50188,
            "observedAt": "2026-10-06T04:23:27.618Z"
          }
        ],
        "subject": {
          "type": "time_slot",
          "id": "hour:12",
          "label": "12:00"
        },
        "signalId": "sales_hour_peak:80022f:hour:12",
        "scope": {
          "restaurantId": "6aa7b065f8f259166180022f",
          "branchId": null,
          "scope": "tenant"
        },
        "freshness": "fresh",
        "generatedAt": "2026-10-06T04:23:27.618Z",
        "periodStart": "2026-07-08T04:23:27.618Z",
        "periodEnd": "2026-10-06T04:23:27.618Z"
      },
      {
        "code": "sales_hour_trough",
        "category": "sales",
        "source": "sales_context",
        "statement": "Weakest revenue hour is 00:00 (0).",
        "value": 0,
        "direction": "down",
        "confidence": 0.6,
        "evidence": [
          {
            "kind": "metric",
            "ref": "metric:hour:0",
            "value": 0,
            "observedAt": "2026-10-06T04:23:27.618Z"
          }
        ],
        "subject": {
          "type": "time_slot",
          "id": "hour:0",
          "label": "00:00"
        },
        "signalId": "sales_hour_trough:80022f:hour:0",
        "scope": {
          "restaurantId": "6aa7b065f8f259166180022f",
          "branchId": null,
          "scope": "tenant"
        },
        "freshness": "fresh",
        "generatedAt": "2026-10-06T04:23:27.618Z",
        "periodStart": "2026-07-08T04:23:27.618Z",
        "periodEnd": "2026-10-06T04:23:27.618Z"
      }
    ],
    "candidateDirections": [
      {
        "direction": "fill_weak_slots",
        "domain": "sales",
        "objective": "Fill the weakest trading slot",
        "mechanism": "a time-targeted offer limited to that day",
        "target": {
          "productIds": [],
          "productNames": [],
          "categoryIds": [],
          "segmentIds": []
        },
        "evidenceRefs": [
          "signal:sales_weekday_trough:80022f:weekday:4"
        ]
      },
      {
        "direction": "lift_weak_category",
        "domain": "sales",
        "objective": "Lift the weakest category",
        "mechanism": "pair it with a strong category rather than discounting the strong one",
        "target": {
          "productIds": [],
          "productNames": [],
          "categoryIds": [
            "Other"
          ],
          "segmentIds": []
        },
        "evidenceRefs": [
          "signal:sales_category_weak:80022f:Other"
        ]
      }
    ],
    "confidence": 0.617,
    "generatedAt": "2026-10-06T04:23:31.421Z"
  },
  "investigation": {
    "runId": "53676f67-7671-4fa7-a2d7-1161f85ef8dc",
    "status": "failed",
    "stepsUsed": 4,
    "toolCallsUsed": 3,
    "llmCalls": 4,
    "domainsInvestigated": [
      "sales"
    ],
    "domainsUnavailable": [
      "products",
      "inventory"
    ],
    "domainOrder": [
      "sales",
      "products",
      "inventory"
    ],
    "stopGuardObjections": [],
    "rejections": [],
    "tokensUsed": 7426,
    "costUsd": 0.000914,
    "errorCode": "http_error"
  },
  "recommendations": [],
  "directionPolicy": {
    "applied": true,
    "types": [
      "CREATE_PROMOTION",
      "CREATE_COMBO"
    ],
    "unrepresentableDirections": [],
    "realisedDirections": [
      "fill_weak_slots"
    ],
    "unrealisedDirections": [
      "lift_weak_category"
    ],
    "fallbackUsed": false,
    "note": "Engine generation was restricted to the types the investigation directed (CREATE_PROMOTION, CREATE_COMBO)."
  },
  "rejected": [
    {
      "candidateId": "promo_demand_restaurant_revenue_drop",
      "title": "Daily Revenue Demand Recovery",
      "codes": [
        "ECONOMICS_UNSAFE"
      ]
    }
  ],
  "validationSources": {
    "stockout": {
      "status": "unavailable",
      "detail": "The stockout forecast had no usable input (NO_STOCKOUT_DATA), so feasibility could not be assessed."
    },
    "activeOffers": {
      "status": "ok",
      "detail": "16 active offer(s) checked for overlapping products/categories."
    }
  },
  "outcomeLearning": {
    "outcomesLinked": 0,
    "outcomesPositive": 0,
    "outcomesNegative": 0,
    "outcomesUnusable": 0,
    "causalOutcomes": 0,
    "productPatternsWritten": 0,
    "productPatternsSkippedFresh": false,
    "notes": [
      "only 0 item(s) had enough trading history for percentiles (need 3)"
    ]
  },
  "memoryWrite": {
    "attempted": true,
    "episodeWritten": true,
    "episodeId": "6ac477c49dc0b60735aa94ea",
    "recommendationsRecorded": 0
  },
  "confidence": 0.308,
  "risk": "high",
  "degradations": [
    "feedback-trend learning is not implemented (feedback domain is declared only)",
    "1 investigated direction(s) produced no engine candidate and were NOT forced into an offer",
    "uplift: Uplift service not configured (ML_UPLIT_BASE_URL unset).",
    "response: Uplift service not configured (ML_UPLIT_BASE_URL unset) — offer-response batch scoring unavailable.",
    "segment: No stored ML segment predictions. The segmentation service may not be configured or synced yet.",
    "demand: No stored demand predictions. The Demand service may not be configured or synced yet.",
    "combo: No stored combo predictions and the Basket service is unreachable or has no rows for this tenant.",
    "inventory feasibility: The stockout forecast had no usable input (NO_STOCKOUT_DATA), so feasibility could not be assessed.",
    "No candidates were produced by the engine.",
    "final critic: no candidates to review",
    "feedback domain is declared only and was not investigated — no feedback fact is asserted",
    "competition domain is declared only and was not investigated — no competition fact is asserted",
    "the investigation model stopped early (http_error) after 4 step(s); the evidence already gathered was used rather than discarded"
  ],
  "memory": {
    "episodes": 3,
    "longTerm": 0,
    "degraded": false
  },
  "approvalRequired": true,
  "generatedAt": "2026-10-06T04:23:32.022Z"
} as unknown as MarketingAnalyzeResult;
