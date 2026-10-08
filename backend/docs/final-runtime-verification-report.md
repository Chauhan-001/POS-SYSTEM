# ChitKuber — Final Runtime Verification Report

Date: 2026-10-04
Environment: local Windows host, real MongoDB (`pos`), real backend (`PORT=3011`), real LLM provider (`custom` / `openai/gpt-oss-20b`).
Tenants used: A = `6ac031900f636f7cc8ab6f8f` (Urban Tadka Kitchen), B = `6aa7b065f8f259166180022f` (The Royal Bistro).

Status vocabulary used below: IMPLEMENTED · TESTED · RUNTIME VERIFIED · UI VERIFIED · BLOCKED · NOT IMPLEMENTED · PRE-EXISTING · REQUIRES OPERATOR ACTION

---

## 1. Files changed (earlier remediation pass + this verification pass)

Backend (all typecheck clean; the repository's 345 `tsc` errors are PRE-EXISTING and in untouched files):

| File | Change |
| --- | --- |
| `src/ai/agents/loop/agentLoop.ts` | Bounded (max 1) retry for provider JSON-validation 400s; auditable error text helper |
| `src/ai/shared/llmClient.ts` | Non-OK responses now surface a short provider reason (truncated `error.type/message`) — never the key |
| `src/ai/intelligence/recommendationRanking.ts` | D-19: product/category correlation; new `provenance.signalThemes`; `why` distinguishes correlated evidence from themes |
| `src/ai/intelligence/recommendationExplanation.ts` | D-06 grounding: engine-authored numbers (description/evidence/validated memory) added to the allow-list; `malformedReason()` audit trail; D-13 causal guard; D-19 theme wording |
| `src/ai/intelligence/businessSignalNormalizers.ts` | D-22: missing source timestamp stays `''` → freshness `unknown`, no fabricated period window |
| `src/ai/intelligence/businessIntelligenceService.ts` | D-16: `lookbackDays` propagated to window-aware tools; sales tool's fixed 30-day window documented in code |
| `src/ai/intelligence/marketingIntelligencePipeline.ts` | D-07 memory relevance filter; D-09 observability; D-19 usage includes themes |
| `src/ai/tools/sales/getSalesTrendsTool.ts` | Explicit `windowDays: 30` disclosure field |
| `src/ai/tools/marketing/getPromotionCandidatesTool.ts` | D-15: `resolveBranchScope` ownership validation |
| `src/ai/agents/marketingAgent.ts` | D-21: no double period in fall-through notes |
| `src/ai/agents/marketingAgentProposal.ts` | Recommendation-sourced proposal (`sourceRecommendationId` + snapshot, no regeneration); themes in evidence |
| `src/ai/agents/marketingAgentRoutes.ts` | `/proposal` builds from the selected recommendation; `/intelligence` rate+concurrency limiting |
| `src/services/advisorService.ts` | D-01/D-04: real owner action → lifecycle recorder (idempotent, non-blocking, failure-isolated) |
| `src/services/marketingScheduler.ts` | D-02: nightly tenant-batched memory consolidation (no new scheduler) |
| `src/services/promotionCandidateService.ts` | D-08 `economicsUnavailable`; D-17 restricted/excluded enforcement; stable demand-anomaly ids |
| `src/middleware/rateLimiter.ts`, `src/config.ts` | D-18 tenant rate + concurrency limits |
| `src/models/marketing/CampaignProposal.ts` | `sourceRecommendationId` field |
| Tests | `agentLoop.test.ts`, `llmClient.test.ts`, `businessSignals.test.ts`, `recommendationRanking.test.ts`, `recommendationExplanation.test.ts`, `remediationGuards.test.ts`, `promotionCandidateService.test.ts`, `src/__tests__/noCommittedSecrets.test.ts` |

Frontend: `src/api/client.ts`, `src/components/marketing/RecommendationsPage.tsx`, `src/components/marketing/agentCopy.ts`.

NOT touched (concurrent work by other threads): `MarketingWorkspace.tsx`, `useMarketingData.ts`, `ProposalsInbox.tsx` (deleted), `e2e/marketing-agent-proposal-flow.spec.ts` (deleted), `cricketCalendarSync.ts`, `cricketQuotaCalendar.test.ts`, MLmodel submodules, `audit-report.md`.

---

## 2. Runtime endpoints tested

- `POST /api/auth/login` — RUNTIME VERIFIED
- `POST /api/ai/marketing-agent/intelligence` — RUNTIME VERIFIED (forged body, unauthenticated, lookback 30/90/365, explanation on/off, concurrency)
- `POST /api/ai/marketing-agent/proposal` — RUNTIME VERIFIED (selected recommendation)
- `POST /api/ai/marketing-agent/recommend` — RUNTIME VERIFIED (agent loop)
- `POST /api/advisor/:id/action` and `POST /api/advisor/:id/converted` — RUNTIME VERIFIED
- `marketingScheduler` memory-consolidation tick (real production code path) — RUNTIME VERIFIED

## 3. Test counts

| Suite | Result |
| --- | --- |
| backend `src/ai` | 24 files, **300 passed**, 0 failed |
| backend `src/services/__tests__` + `src/__tests__` | 44 files, **519 passed**, 0 failed |
| focused intelligence | 7 files, **125 passed** |
| backend `tsc --noEmit` | 345 errors, **all PRE-EXISTING**, none in changed files |
| frontend `tsc --noEmit` | **0 errors** |
| frontend `vitest run` | 22 passed / 1 failed file; 223 passed / **7 PRE-EXISTING failures** (`LoginScreenConsent.test.tsx`, unrelated) |

## 4. Runtime timings

`/intelligence`: tenant A forged-body 1.66 s · tenant B 0.42 s · lookback 30 → 1.87 s · 90 → 1.82 s · 365 → 2.86 s · explanation-on run 4.44 s (LLM leg 1.38 s).

## 5. Tool calls

- Agent loop (`/recommend`): `status completed_sufficient`, 1 step, **6 real tool calls** — `getSalesTrends`, `getMenuPerformance`, `getInventoryStatus`, `getCustomerSegments`, `getCampaignPerformance`, `getOfferPerformance`. (Previously `failed`, 0 tool calls.)
- Intelligence investigation: 17-step parallel plan; per-call durations are per-dimension and budget-clamped.

## 6. Signal availability (RUNTIME VERIFIED, explicit)

- Tenant A: **98 signals** — `cost_intelligence` 44, `demand_forecast` 25, `customer_segments` 10, `inventory_context` 8, `campaign_performance` 4, `market_basket` 4, `retention_signals` 1, `festival_context` 1, `competition_context` 1. Unavailable dimensions reported explicitly: `sales, menu, inventory, marketing, context`. `toolErrors: []`.
- Tenant B: **37 signals** — `offer_performance` 16, `customer_segments` 10, `sales_context` 8, `retention_signals` 2, `festival_context` 1. Unavailable: `menu, margin, inventory, marketing, demand, basket, context`.
- No unavailable data became a zero, a fake confidence or a fake prediction; unavailable reasons are named.
- `getSalesTrends` intentionally uses a **fixed 30-day window** (now returned as `windowDays: 30` and documented in `defaultDimensionPlan`); the requested lookback is not applied there on purpose. Window-aware tools (`getMenuPerformance`, `getProductMargins`) receive the requested window.

## 7. Recommendation IDs

- Tenant A recommendation X: `promo_demand_restaurant_revenue_drop` (CREATE_PROMOTION, rank 1) — `economics.available: false`, `economicallySafe: false`, `mlKinds: ['segment']`, `signalCodes: []`, `signalThemes` populated.
- Fix verified: an earlier run produced `promo_demand_undefined`; ids are now stable (`<entityType>_<entityId>_<anomalyType>`).

## 8. Proposal IDs

- `6ac20878620913506e0882f9` — `sourceRecommendationId = promo_demand_restaurant_revenue_drop`, `source: 'recommendation'`, snapshot economics-unavailable, `approvalStatus: pending`, tenant A.
- Regeneration control: a second call with `rec_other_xyz` produced `6ac20878620913506e0882fb` with `sourceRecommendationId = rec_other_xyz` — the endpoint does **not** substitute a freshly generated recommendation.

## 9. Episode IDs

- `6ac2087d620913506e0882fd` — `campaign_proposed`, action `accepted`, `recommendationRef = 6ac2087d9e928867224f4d62`, tenant A, source `service`, evidence 1, confidence 0.9.
- `6ac2087e620913506e088301` — `campaign_launched`, action `converted`, same recommendation ref.
- Idempotency: duplicate accept → still 1 episode; duplicate converted → still 2 total. Owner action returned HTTP 200 in both cases (memory persistence is non-blocking).

## 10. RestaurantMemory IDs

- `6ac1f39a634a222f31abe335` — `campaign_performance_pattern`, confidence 0.9, sampleSize 1002, `lastValidatedAt` set, `metadata.consolidator = "memoryLearningService"`.
- `6ac1f39a634a222f31abe334` — same type, confidence 0.9, sampleSize 3107, consolidator `memoryLearningService`.
- `6ac17dca7422722e6cf40c4b` — `seasonality_pattern`, confidence 0.75, sampleSize 14, consolidator **null** — a pre-existing seed row, NOT produced by consolidation.
- Consolidation tick run twice: 3 memories after the 1st and after the 2nd tick (idempotent, duplicate-free). Tenant B: **0** memories, **0** episodes.

## 11. Before/after ranking evidence

`rankScore` with the same candidate/context: **79.9 → 83.9 (+4)** when a real tenant-A memory of a relevant type is present; **79.9 (+0)** with an irrelevant memory type. Ranking remains deterministic across runs.

## 12. AIUsageLog before/after

- 443 rows at audit baseline → **461** now.
- Explanation run: 459 → 460, one row with `requestId`, `restaurantId`, `provider: custom`, `model: openai/gpt-oss-20b`, `latencyMs 1382`, tokens 784/738/1522, `cost 0.0003736`, `success: true`, `fallback: false`, `promptVersion: phase7-explanation-v1`.
- When grounding rejects model copy, the row is still written with `success: false`, `fallback: true`, and an auditable reason such as `malformed_grounded_output:evidenceSummary:double_connector`.
- `auditlogs` received `marketing_intelligence_run` / `agent_run` rows for the correlated request id.

## 13. Tenant isolation result — RUNTIME VERIFIED

- Unauthenticated `/intelligence` → **401**.
- Forged `restaurantId`/`branchId` in the body → ignored; payload contains neither the forged ids nor tenant B data.
- Tenant B's run references no tenant A id; tenant B has no tenant A memory/episode/proposal.
- `getPromotionCandidates` with a foreign branch → `TOOL_TENANT_MISMATCH`; `branchId === restaurantId` also rejected.

## 14. Remaining defects (honest)

- D-14: economic-safety demotion retained as defense-in-depth behind `validateFinancialModel`; no behavioral code change made — the rationale is now documented in the module comment on `isEconomicallySafe` (`recommendationRanking.ts`).
- LLM explanation quality is model-dependent; grounding can still reject copy and fall back (by design, with an auditable reason).
- `/recommend` remains a compatibility adapter over the deterministic ladder.
- Restricted/excluded product enforcement (D-17) is **TESTED** (unit) but not exercised at runtime against a tenant with configured restrictions.
- Campaign approval → `campaignService` → queue → channel send was **NOT** exercised in this session.

## 15. Credential status

- CURRENT FILES CLEAN: **YES** (`backend/audit-token.txt`, `backend/audit-login.json` absent from the working tree; deletions staged).
- HISTORY CLEAN: **NO** (both files still exist inside commit `b5de06b`).
- `.gitignore` blocks future `audit-*.json|txt|ts` (except `scripts/audit-*.ts`); `src/__tests__/noCommittedSecrets.test.ts` guards it.
- ROTATION REQUIRED: **YES** — treat every JWT issued from that file (access **and** refresh) as compromised; rotate the auth/JWT signing secret and invalidate sessions.

## 16. Operator-only actions

1. Rotate the JWT signing secret and invalidate all sessions/refresh tokens issued before rotation.
2. Rewrite history to purge `backend/audit-token.txt` and `backend/audit-login.json` (e.g. `git filter-repo --path backend/audit-token.txt --path backend/audit-login.json --invert-paths`), then force-push with explicit authorization, and require all clones to re-fetch.
3. Review provider/DB credentials that were live during the incident window.
