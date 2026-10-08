# ChitKuber Marketing Intelligence — Production Remediation Report

Date: 2026-10-04
Scope: correct, connect, harden and verify the existing Marketing Intelligence
implementation. No parallel architecture was introduced.

> Honesty rule applied throughout: a feature is only labelled **RUNTIME
> VERIFIED** when the running server proved it. Most fixes here are
> **IMPLEMENTED + TESTED** but were **not** re-proven against a live server in
> this session (the dev backend was not running). They are labelled accordingly.

---

## 1. Executive summary

The previous implementation claimed Phases 3–10 were complete; the read-only
audit proved several pieces were disconnected. This remediation reconnected the
**real owner decision path** to the existing learning lifecycle, gave memory
consolidation a **real production caller** in the existing scheduler, removed
committed credentials from tracking, made ML provenance **per recommendation**,
stopped placeholder economics reaching owners, hardened explanation grounding,
added a **server-side causal-language guard**, made `/intelligence` and
`/proposal` share **one** recommendation, and added **rate/concurrency** controls
and **AI observability**.

Verdict: **substantially more correct, still not fully production verified.**
Runtime acceptance (an actual owner action producing an episode → memory → a
subsequent influenced recommendation) was **NOT** re-run this session.

---

## 2. P0 fixes

| ID | Defect | Status |
|----|--------|--------|
| D-01 | Phase-8 lifecycle hook unreachable (`recommendationCandidateService` has no production importer) | **IMPLEMENTED + TESTED** — the REAL path (`advisorService`) now emits lifecycle events |
| D-02 | `consolidateRestaurantMemory` had no production caller | **IMPLEMENTED + TESTED** — hosted by `marketingScheduler` (nightly, tenant-batched) |
| D-03 | Live credentials committed in `b5de06b` | **PARTIAL** — removed from working tree + index (staged deletions); history cleanup is a **manual** step (§14) |
| D-04 | Phase3–7 pipeline disconnected from the real owner decision path | **IMPLEMENTED + TESTED** — `/proposal` now builds from the selected recommendation; `/recommend` kept as compatibility |

### D-01/D-04 detail
`advisorService.recordAdvisorAction` / `markRecommendationConverted` /
`recordAdvisorOutcome` now emit into the existing
`recordRecommendationLifecycleEvent` recorder. Idempotent (only a real status /
outcome change emits), tenant-scoped, non-blocking, and failure-isolated (the
recorder has a never-throw contract and is never awaited).

---

## 3. P1 fixes

| ID | Defect | Status |
|----|--------|--------|
| D-05 | Every ML kind attached to every recommendation | **IMPLEMENTED + TESTED** — `mlAlignment()` returns only the kinds that actually influenced that candidate |
| D-06 | Broken explanations (“₹”, “from PM to PM”, “festive lift of”) | **IMPLEMENTED + TESTED** — regex literals remove the whole numeric/currency/time token; `isMalformedGroundedText()` forces deterministic fallback |
| D-07 | Memory statements attached without relevance filtering | **IMPLEMENTED + TESTED** — `memoryTypesForType()` gates attachment |
| D-08 | Placeholder financial model (discount 20%, all zeros) shown as valid | **IMPLEMENTED + TESTED** — `economicsUnavailable` flag; never “safe”, never “₹0”, never “0 extra sales” |
| D-09 | Intelligence pipeline wrote no AI observability | **IMPLEMENTED + TESTED** — `AIUsageLog` row (accurate tokens via threaded usage) + `auditService` run row |
| D-11 | snake_case memory types compared to UPPER_SNAKE PromotionType (always false) | **IMPLEMENTED + TESTED** — canonical mapping |
| D-13 | `causalClaim`/`hasCausalEvidence` effectively dead; causal verbs unguarded | **IMPLEMENTED + TESTED** — server-side `hasUnsupportedCausalLanguage()` blocks unsupported causal copy |
| D-18 | No rate limiting / concurrency protection on `/intelligence` | **IMPLEMENTED + TESTED** — tenant-keyed limiter + per-tenant concurrency guard (structured 429) |
| D-20 | `causal_uplift` leaking as a generic ML label | **IMPLEMENTED + TESTED** — per-recommendation provenance + `availableKinds` already excludes ungated uplift |
| D-23 | Frontend `runIntelligence` had `try/finally` with no `catch` | **IMPLEMENTED** — friendly handling for timeout/network/5xx/429/auth |

---

## 4. P2/P3 fixes

- **D-14** (economic demotion too late) — **NOT IMPLEMENTED**. `isEconomicallySafe`
  now also rejects `economicsUnavailable`, which narrows the gap, but the
  ordering issue in the engine’s upstream filter is unchanged.
- **D-15** (branch ownership in `getPromotionCandidatesTool`) — **NOT
  IMPLEMENTED** (hardening). Audit found **no leak** because all detectors filter
  `restaurantId` AND `branchId`; the tool still does not call `resolveBranchScope`.
- **D-16** (lookbackDays propagation) — **NOT IMPLEMENTED**. Still only affects the
  candidate engine; signal tools do not receive the same window.
- **D-17** (`restrictedCategories`/`excludedProductIds`) — **NOT IMPLEMENTED**
  (still declared-but-not-enforced).
- **D-19** (`signalCodes` are broad themes) — **NOT IMPLEMENTED**.
- **D-21** (proposal period duplication) — **NOT IMPLEMENTED** (not reproduced in
  this session’s code path).
- **D-22** (`isoOr` maps missing timestamps to “now”) — **NOT IMPLEMENTED**.
  Deliberately left alone rather than half-changed: it needs a `BusinessSignal`
  schema change plus 9 normalizer call sites and test updates that could not be
  fully verified in this session. Design recorded: return an explicit unknown
  state and have `classifyFreshness` map it to `unknown`, never `fresh`.

---

## 5. Files changed (mine only)

Modified:
- `backend/.gitignore`
- `backend/src/services/advisorService.ts`
- `backend/src/services/marketingScheduler.ts`
- `backend/src/services/promotionCandidateService.ts`
- `backend/src/ai/intelligence/recommendationRanking.ts`
- `backend/src/ai/intelligence/recommendationExplanation.ts`
- `backend/src/ai/intelligence/marketingIntelligencePipeline.ts`
- `backend/src/ai/intelligence/__tests__/recommendationExplanation.test.ts` (fixtures)
- `backend/src/ai/agents/marketingAgentProposal.ts`
- `backend/src/ai/agents/marketingAgentRoutes.ts`
- `backend/src/models/marketing/CampaignProposal.ts`
- `backend/src/middleware/rateLimiter.ts`
- `backend/src/config.ts`
- `restaurant-pos/Frontend/src/api/client.ts`
- `restaurant-pos/Frontend/src/components/marketing/RecommendationsPage.tsx`
- `restaurant-pos/Frontend/src/components/marketing/agentCopy.ts`

Added:
- `backend/src/__tests__/noCommittedSecrets.test.ts`
- `backend/src/ai/intelligence/__tests__/remediationGuards.test.ts`
- `backend/src/ai/agents/__tests__/marketingRecommendationProposal.test.ts`
- `backend/src/services/__tests__/memoryConsolidationScheduler.test.ts`

Deleted from tracking (staged): the 10 `backend/audit-*` probe artifacts.

> Other working-tree changes (cricket calendar, MarketingWorkspace, ProposalsInbox,
> useMarketingData) were **not** made by this remediation and were left untouched.

---

## 6. Architecture changes

- **One owner-decision lifecycle**: the real `advisorService` path feeds the
  existing memory recorder. The unreachable `recommendationCandidateService`
  hooks are no longer the (non-)integration point.
- **One memory-consolidation host**: the existing `marketingScheduler` gained a
  nightly, tenant-batched, failure-isolated consolidation pass. No new scheduler.
- **One recommendation → one proposal**: `/proposal` accepts the recommendation
  the owner selected in `/intelligence` and persists `sourceRecommendationId` +
  snapshot. `/recommend` remains as a compatibility adapter.
- **One tool-registry boundary** unchanged.

---

## 7. Tests

- Run: `backend npx vitest run src/ai` → **24 files passed**.
- Run: focused remediation set (intelligence + memory + agents + new guards +
  scheduler + promotion candidate + lifecycle hook) → **24 files / 260 tests passed**.
- Frontend: `npx tsc --noEmit` → **0 errors**; `npx vitest run` →
  **22 files passed / 1 failed**, **7 pre-existing failures** in
  `LoginScreenConsent.test.tsx` (unrelated to this work; unchanged).
- Backend `npx tsc --noEmit` → changed files **clean**; remaining errors are
  pre-existing (~350) in untouched files (`campaignService.ts`, `models/index.ts`).

New tests added: credential guard (3), remediation guards (14), memory
consolidation host (6), recommendation→proposal traceability (4).

---

## 8. Runtime verification

**NOT PERFORMED** in this session (no live backend). The following were
previously verified by the audit and are **not** re-claimed here: live
`/intelligence`, `/recommend`, `/proposal`, tenant isolation, forged-body
isolation. Endpoint / tenant / requestId / tool count / signals / recommendation
count / proposalId / episodeId / memoryId / lifecycle result are **NOT VERIFIED**
this session.

---

## 9. Security verification

- Tenant identity still comes only from the authenticated context / JWT.
- Lifecycle events are tenant-scoped by `restaurantId` from the authenticated path.
- `/intelligence` now has a tenant-keyed rate limit and a per-tenant concurrency
  guard (structured 429s).
- Credential artifacts removed from the working tree and staged out of the index;
  `.gitignore` hardened; a regression guard test now fails if they return.
- **History still contains the credentials** (manual step required, §14).

---

## 10. ML verification

- Per-recommendation provenance implemented and unit-tested: a `CREATE_PROMOTION`
  no longer carries `basket`/`causal_uplift`; a `RUN_REACTIVATION` carries
  `response_model`/gated `causal_uplift` only.
- Gated causal evidence is the only source of `causal_uplift`; `availableKinds`
  already excludes ungated uplift.
- Server-side causal-language guard blocks unsupported causal verbs.
- `causal_uplift` remains **BLOCKED** end-to-end (`ML_UPLIT_BASE_URL` unset; no
  validated experiment).

---

## 11. Memory verification

- Consolidation now has a real caller and is unit-tested with real
  `CampaignHistory` → `RestaurantMemory`, tenant-isolated.
- Lifecycle events from real advisor actions are unit-tested as idempotent.
- **NOT VERIFIED end-to-end**: no owner action in a live server produced an
  episode, then consolidation produced memory, then a later recommendation showed
  relevant memory influence. Do not claim “memory works”.

---

## 12. Remaining blockers

- **B-01** Uplift causal rung — `ML_UPLIT_BASE_URL` unset.
- **B-02** Response-model rung — no trained model.
- **B-03** Weather context — no provider.
- **B-04** Signal degradation (D-10) — 7/9 dimensions unavailable live
  (`TOOL_TIMEOUT` on margins/customers/competition). Root cause not traced this
  session; not “fixed by raising timeouts”.
- **B-05** End-to-end runtime acceptance (owner action → episode → memory →
  ranking influence) — not re-run.
- **B-06** `owner-recommendation-flow.spec.ts` — needs
  `backend/scripts/clean-e2e-devices.mjs`, never committed (pre-existing gap).
- **B-07** Git history rewrite for D-03 — requires explicit authorization.

---

## 13. Dead / duplicate components (classification)

- **ACTIVE**: `offerEngine`, `promotionCandidateService`, `advisorService` +
  `AdvisorRecommendation`, `campaignService`, `marketingScheduler`, memory manager.
- **ADAPTER** (kept for backward compatibility): `/recommend` agent ladder.
- **DEAD** (zero importers): `restaurantIntelligenceOrchestrator`,
  `aiAdvisoryService`, `intelligenceScheduler`, `recommendationCandidateService`.
  Not deleted this session (delete is destructive and out of scope). The Phase-8
  lifecycle hook logic that lived in `recommendationCandidateService` is now
  redundant with the real path.

---

## 14. Credential rotation / history cleanup — MANUAL OPERATOR WORK

Assume all exposed credentials are **COMPROMISED**. Required, in order:

1. **Rotate secrets now**:
   - JWT signing secret(s) → invalidates every access token and refresh token
     issued before rotation. **Access tokens AND refresh tokens must both be
     considered compromised.**
   - Any ML/API keys present in the same commit’s artifacts.
2. **Purge history** (needs explicit authorization; not done automatically). Use
   `git filter-repo` (preferred) — e.g. remove the 10 paths from all history —
   then force-push and have every clone re-clone. Coordinate with all contributors.
3. If history rewrite is not acceptable, treat the secrets as permanently burned
   and rely on rotation (step 1) plus the new regression guard.

Artifacts involved: `backend/audit-token.txt`, `backend/audit-login.json`,
`audit-intel*.json`, `audit-rec.json`, `audit-prop.json`, `audit-*-probe.ts`,
`audit-usage2.ts`, committed in `b5de06b`.

---

## 15. Acceptance criteria — exact status

| Criterion | Status |
|-----------|--------|
| credentials cleaned from working tree | Implemented (tracked/index) |
| credential rotation requirements documented | Implemented (§14) |
| owner action reaches lifecycle recording | Implemented + Tested |
| episodes actually created | Implemented + Tested (unit) / **Not verified** (runtime) |
| memory consolidation actually runs | Implemented + Tested |
| RestaurantMemory created/updated | Implemented + Tested (unit) / **Not verified** (runtime) |
| relevant memory retrieved | Implemented / **Not verified** |
| memory can influence ranking | Implemented + Tested (unit) / **Not verified** (runtime) |
| `/intelligence` and `/proposal` share the same recommendation | Implemented + Tested |
| no duplicate recommendation regeneration | Implemented + Tested |
| ML provenance per recommendation | Implemented + Tested |
| causal uplift gated | Implemented + Tested |
| causal language blocked when unsupported | Implemented + Tested |
| economic values authoritative | Partially — placeholder path flagged unavailable; engine ordering (D-14) unchanged |
| no fake ₹0 economics | Implemented + Tested |
| explanations numerically grounded | Implemented + Tested |
| missing values never create broken sentences | Implemented + Tested |
| signal failures explicit | **Not implemented** (D-10 pending) |
| lookbackDays propagates correctly | **Not implemented** (D-16) |
| branch ownership enforced | **Not implemented** (D-15; no leak found) |
| restricted/excluded products enforced | **Not implemented** (D-17) |
| rate/concurrency controls exist | Implemented + Tested |
| provider failures degrade safely | Implemented (existing ladder) / not re-verified |
| AI observability exists | Implemented + Tested |
| frontend handles failures | Implemented |
| tenant isolation passes | Tested (unit) / **Not verified** (runtime this session) |
| no cross-restaurant memory leakage | Implemented + Tested (unit) |
| old duplicate systems identified/deprecated | Documented (§13); not deleted |
