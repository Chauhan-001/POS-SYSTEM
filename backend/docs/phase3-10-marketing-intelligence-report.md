# Marketing Intelligence Agent — Phases 3–10 Final Report

Status date: 2026-10-04 · Backend :3002 running (`npx tsx src/server.ts`) · Repo state left uncommitted (no commits/pushes made).

Legend: **IMPLEMENTED** (code exists) · **CONNECTED** (wired to existing systems) · **TESTED** (unit/integration green) · **RUNTIME VERIFIED** (real backend + DB probe) · **UI VERIFIED** (frontend tests/tsc; E2E where noted) · **BLOCKED** · **NOT IMPLEMENTED**.

---

## A. Phase 3 — Business Intelligence / Canonical Signals — **IMPLEMENTED · CONNECTED · TESTED · RUNTIME VERIFIED**

### Files created
- `src/ai/intelligence/businessSignalTypes.ts` — canonical signal vocabulary (`BUSINESS_SIGNAL_CODES`), categories, sources, freshness, direction, scope, evidence refs, Zod validator, `PERSISTED_SIGNAL_TYPE_MAP` (documents reuse of the persisted `IntelligenceSignal.type` vocabulary).
- `src/ai/intelligence/businessSignalNormalizers.ts` — 17 pure normalizers over the EXISTING tool outputs (sales, menu, margins, inventory ×3, customers ×2, marketing ×3, demand, basket, context ×4). Thresholds are named constants; malformed input degrades; no invented numbers.
- `src/ai/intelligence/businessIntelligenceService.ts` — tenant-scoped aggregator that fetches ONLY through the shared tool registry (`executeTool`), runs the plan **in parallel** with per-tool deadline clamping, and returns ordered signals + per-dimension status + tool errors + freshness split. NEVER writes.
- Tests: `__tests__/businessSignals.test.ts` (36), `__tests__/businessIntelligenceService.test.ts` (10).

### Files modified
None (pure addition).

### Existing systems reused
`toolRegistry` / `executeTool` (the ONE tool path), the persisted `IntelligenceSignal` vocabulary (no second signal store), each authoritative service behind the tools (sales context, menu engineering, cost intelligence, inventory, customers, offer/campaign history, demand, basket, festival/sports/competition/weather).

### Memory/信号 schemas
`BusinessSignal` = { signalId, code, category, source, statement, value/unit/baseline/changePct, direction, confidence 0..1, sampleSize, periodStart/End, freshness (fresh|aging|stale|expired|unknown), generatedAt, scope {restaurantId, branchId|null, tenant|branch}, evidence[], subject, caveats }. **Confidence/freshness/evidence semantics mirror `IntelligenceSignal`.**

### Retrieval behaviour
Fan-out over 17 existing read tools; `available:false` outputs become `unavailable` with the source reason (never zeroes); stale rows are labelled and excluded from `usable`; deterministic ordering (freshness × confidence × sample size, tie-break signalId).

### Tenant/branch isolation
Tenant comes ONLY from `ToolContext.tenant` (authenticated). Invalid/missing tenant throws. Branch propagates into `scope` and into tool inputs (each tool re-validates branch ownership). Tests prove B cannot see A data.

### Tests
36 normalizer tests (normalization, confidence, freshness incl. stale/unknown, evidence, malformed/missing/stale inputs, isolation) + 10 service tests (real registry, tenant swap, branch scope, tool failure → `toolErrors`, missing tool → `TOOL_NOT_FOUND`, deadline → `TOOL_TIMEOUT`, budget → `BUDGET_EXHAUSTED`, summary leaks no raw values).

### Runtime
`POST /api/ai/marketing-agent/intelligence` (sim tenant): **98 signals**, 0 error dimensions, 44→98 signals after the parallel fan-out fix.

### Unresolved
Two dimensions (margin, customer) timed out with the original 8s/serial plan on this cold DB; fixed by parallel fan-out + 12s default/8s per-tool cap (latest runtime: 0 timeouts).

---

## B. Phase 4 — Offer Intelligence — **IMPLEMENTED · CONNECTED · TESTED · RUNTIME VERIFIED**

### Files created
- `src/ai/tools/marketing/getPromotionCandidatesTool.ts` — read-only bridge exposing the EXISTING `generatePromotionCandidates` (promotionCandidateService) to agentic tool-calls, with compact economics/cannibalization/risks/evidence and honest `totalGenerated`/`note`.
- `src/ai/intelligence/marketingIntelligencePipeline.ts` — server-side orchestrator calling the SAME service directly (no lossy re-hydration, no second engine) + `rankAndDiversify` + explanation.

### Files modified
- `src/ai/tools/registerAllTools.ts` — registers the bridge (idempotent).
- `src/ai/agents/policies/marketingAgentPolicy.ts` — allow-list gains `getPromotionCandidates` (21 → 22 tools, all `access:'read'`).
- `src/ai/agents/marketingAgentRoutes.ts` — additive `POST /intelligence` (limit 1..12, optional `lookbackDays` 7..365, `includeExplanation`).

### Existing systems reused — NOT duplicated
`promotionCandidateService.generatePromotionCandidates` + `deduplicateCandidates` (economics: FinancialModel, cannibalization, BusinessConstraints, financial validation), `offerEngine` untouched, proposal path untouched. **No new offer/candidate engine.**

### Economics stay deterministic/server-authoritative
The LLM only *requests* candidates via the tool; cost, margin, discount safety, break-even and payback are computed by the existing service and carried through verbatim.

### Runtime
Candidate engine verified directly: 90d → 0 (stale data), 200d → 3 raw/1 dedup `CREATE_PROMOTION`, 365d → same (after the defect fix below).

### Unresolved
Default 90-day window yields no candidates for the sim tenant because its sales data ends 2026-03-29 (data condition, honestly reported as a degradation).

---

## C. Phase 5 — ML Integration — **IMPLEMENTED · CONNECTED · TESTED · RUNTIME VERIFIED (semantics) · PARTIALLY BLOCKED (uplift upstream)**

### Files created
- `src/ai/intelligence/mlTypes.ts`, `src/ai/intelligence/mlSemantics.ts` (+ `__tests__/mlSemantics.test.ts`, 17 tests).

### Semantics enforced in code
- **Response ≠ causal uplift**: `responseEvidence()` is always `causal:false`; only `upliftEvidence()` with upstream-gate-passed evidence may set `causal:true`.
- The uplift gate is the EXISTING `getUpliftSignals` → `evaluateExperimentRandomization`; this layer never re-implements or overrides it, and preserves `gateReasons`.
- `hasCausalEvidence` (gated uplift only) vs `hasTargetingEvidence` (causal|response|segment) — `causalClaim()` makes a causal sentence impossible without gated evidence.
- Honest degradation: unavailable / not_evaluable / stale / heuristic, with owner-readable lines and no internals.
- Model version, evaluation status, freshness age, sample size all carried through.

### Runtime
`mlKinds = [segment, forecast, basket]`, `hasCausal=false`; uplift reported `not_evaluable` ("the experiment is not large enough to trust") — **BLOCKED upstream** in this environment because `ML_UPLIT_BASE_URL` is unset, which is the correct disclosed degradation.

---

## D. Phase 6 — Ranking and Diversity — **IMPLEMENTED · TESTED · RUNTIME VERIFIED**

### Files created
- `src/ai/intelligence/recommendationRanking.ts` (+ `__tests__/recommendationRanking.test.ts`, 20 tests).

### Design
- `rankScore` = engine score (0–100, dominant) + confidence×15 + safety bonus 8 + incremental-contribution ±6 + ML alignment 0–6 + memory alignment 0–4 − cannibalization ≤6. **Every weight is a documented constant; the engine's own score dominates so narrative can never outrank deterministic economics.**
- Reproducible: stable sort with explicit tie-breakers (score → safety → engine score → id). No clock/randomness in scoring.
- Diversification: round-robin across the engine's own `PromotionType` strategies, default ≤2 per strategy; if caps leave the shortlist short, caps relax **round-robin** (never a flood) and `diversityRelaxed`/notes disclose it. Default shortlist 7–10 (limit clamp 1..12).
- Each pick carries engine score, economics, cannibalization, target, risks, prerequisites, evidence, and provenance (engine signals, canonical signal codes, ML kinds, memory refs) plus grounded `why` lines.

### Runtime
1 real candidate → 1 recommendation, `strategies=['CREATE_PROMOTION']`, `economicallySafe=false` (correctly flagged by its own constraints).

---

## E. Phase 7 — Explanation — **IMPLEMENTED · TESTED · RUNTIME VERIFIED (real LLM)**

### Files created
- `src/ai/intelligence/recommendationExplanation.ts` (+ `__tests__/recommendationExplanation.test.ts`, 17 tests).

### Rules enforced in code
- Uses the ONE shared LLM client (`generateJsonWithMeta`) — no second client.
- Strict Zod schema (`explanationSchema`, `.strict()`): `recommendation`, `evidenceSummary[]`, `whyItFits`, `whyAlternatives`, `offerDescription`, `campaignCopy`. **No chain-of-thought field; extra keys are rejected** (proved by test).
- **Number grounding**: every numeric token in the model output must exist in the supplied facts; ungrounded numbers are stripped together with their dangling unit ("35% below" → "below") and the sentence is tidied. If grounding guts the output, the deterministic template is used.
- Graceful degradation: `llm_disabled` / `llm_timeout` / `llm_not_configured` / `invalid_schema` / `ungrounded_output` / `no_recommendation` — the caller ALWAYS receives a usable explanation.
- Missing evidence is stated as unavailable.

### Runtime
Real Groq call returned a grounded explanation (`source=llm`): "Offer a 20% discount on selected items during a specific time window to recover daily revenue." / "…daily revenue is currently below its usual level…" — the fabricated percentage was removed without leaving artifacts.

---

## F. Phase 8 — Memory Learning Loop — **IMPLEMENTED · CONNECTED · TESTED**

### Files created
- `src/ai/memory/memoryLearningService.ts`:
  - `recordRecommendationLifecycleEvent()` — maps lifecycle actions to episode types, writes through Phase 2 `memoryManager.recordEpisode`, never throws.
  - `consolidateRestaurantMemory()` — arithmetic consolidation from EXISTING data (`CampaignHistory`, `PromotionCandidate` statuses) into `campaign_performance_pattern`, `audience_response_pattern`, `promotion_fatigue_pattern` with **explicit thresholds** (`MIN_PATTERN_SAMPLE=30`, `MIN_PATTERN_CONFIDENCE=0.55`, `MIN_REJECTION_OBSERVATIONS=3`).
  - Conflict handling: weaker evidence never downgrades a stronger memory; contradicted memories are replaced with the previous value preserved in `metadata.superseded*` (Phase 2's unique key forbids two rows); stale memories (>180d unvalidated) are invalidated; `isAgingMemory`/`memoryInformsDecision` stop aging/weak/invalidated memory from informing decisions.
  - NEVER stores an LLM interpretation as fact (source `service`, arithmetic only).
- Tests: `__tests__/memoryLearningService.test.ts` (15), `src/services/__tests__/recommendationLifecycleMemoryHook.test.ts` (7).

### Files modified
- `src/services/recommendationCandidateService.ts` — fire-and-forget Phase 8 hook on accept / reject / implement / convert. Learning can never block or break the lifecycle (swallowed failures, not awaited).

### Existing systems reused
`memoryManager` (only writer), `MemoryEpisode`/`RestaurantMemory` models, `CampaignHistory`, `PromotionCandidate`, audit infrastructure (via Phase 2). **No parallel analytics, no new memory store.**

### Unresolved / NOT IMPLEMENTED
Product-level long-term patterns ("product X high demand, weak margin") are not auto-consolidated yet — only campaign/channel, approval and fatigue patterns. The consolidation currently uses `channel` as the strategy proxy because `CampaignHistory` has no strategy column (documented in code).

---

## G. Phase 9 — UI — **IMPLEMENTED · TESTED · UI VERIFIED (partial E2E)**

### Files modified
- `src/api/client.ts` — `MarketingIntelligenceResult` types + `runMarketingIntelligence()` (no offline queue, same convention as the existing agent calls).
- `src/components/marketing/agentCopy.ts` — plain-language helpers: `friendlySignals`, `friendlyMlKinds` (never over-claims: response = "a prediction", uplift = "proven extra sales"), `friendlyMoney`, `friendlyBreakEven`, `friendlyEconomics`.
- `src/components/marketing/RecommendationsPage.tsx` — new "Detailed intelligence" panel: run button, top suggestion + why + evidence + offer idea + message, ranked options with within-limits/check-limits badges, economics, expected extra sales, break-even, what it is based on, risks, "What we found", "What we learned before", and an explicit "What is not available right now" list; closing line "You stay in control… nothing is sent automatically."

### Not exposed
No chain-of-thought, prompts, secrets, raw tool internals or model names; loading/error/empty/retry states preserved; existing panels untouched.

### Tests
Frontend `agentCopy.test.ts` 23 passed (17 pre-existing + 6 new); `npx tsc --noEmit` clean. E2E `marketing-agent-proposal-flow.spec.ts` **passed** (agent → proposal → approval, 34.7s) — the existing marketing journey still works with the new panel.

### BLOCKED
`e2e/owner-recommendation-flow.spec.ts` cannot start: it requires `backend/scripts/audit-recommendations.mjs` (audit tenants) and `backend/scripts/clean-e2e-devices.mjs` — **both missing from the repo** (pre-existing gaps, unrelated to this work). 1 failed at setup / 9 did not run.

---

## H. Phase 10 — Full Verification — **PERFORMED**

### Tests executed and results
| Suite | Result |
|---|---|
| `src/ai/**` + `src/modules/calendar/__tests__` (25 files) | **320 passed** |
| `src/ai/intelligence/__tests__` (6 files: signals 36, service 10, mlSemantics 17, ranking 20, explanation 17, pipeline 6) | **107 passed** |
| `src/ai/memory/__tests__` + lifecycle hook + promotion/campaign services (5 files) | **76 passed** |
| Phase 1/2 regression (agents, llmClient, tools, calendar, 14 files) | **139 passed** |
| Frontend `agentCopy.test.ts` | **23 passed** |
| Frontend full suite | 7 failures — ALL pre-existing `LoginScreenConsent` (imports only `LoginScreen`, no reference to changed files) |
| Frontend `tsc --noEmit` | **0 errors** |
| Backend `tsc --noEmit` filtered to touched files | **0 errors** |
| E2E `marketing-agent-proposal-flow.spec.ts` | **1 passed** |
| E2E `owner-recommendation-flow.spec.ts` | **BLOCKED** (2 missing prerequisite scripts) |

### Scenario coverage (tests)
Normal tenant, cold-start (no data → unavailable dimensions, no fabrication), sparse data, stale data (stale-labelled, confidence reduced), missing ML service (each degrades independently), conflicting memory (supersede with history), stale memory (aging/invalidated, stops informing decisions), rejected recommendation (episode + no downgrade), approved recommendation, multiple branches (scope propagation + cross-branch rejection), cross-tenant attempt (B blind to A), tool failure (`TOOL_FAILED` + others continue), LLM timeout (`llm_timeout` → deterministic), malformed tool output (no throw, no invented values), no valid offers (`NO_CANDIDATES`, honest note), malformed timestamps, zero-recipient campaigns, invalid tenant identity.

### Runtime probes (real backend, real Mongo, real token)
- `POST /api/ai/marketing-agent/intelligence {limit:8, lookbackDays:200}` → success; **98 signals**; 0 error dimensions; 1 ranked recommendation (`CREATE_PROMOTION` "Daily Revenue Demand Recovery", score 70/100, confidence 60%, flagged **not safe** by its own constraints); `explanation.source=llm`; degradations disclosed (uplift not evaluable, response model unavailable).
- `POST /api/ai/marketing-agent/recommend` → `targetingSource=ML_SEGMENTS`, 5 targets, 3 nextActions, `investigation.status=completed_sufficient`, `investigation.memory={episodes:1,longTerm:1,degraded:false}` — **existing contract intact**.
- `POST /api/ai/marketing-agent/proposal` → `created=true` — **owner approval path intact**.
- Phase 2 memory probe (`scripts/probe-phase2-memory.ts`): create/retrieve, tenant B blind, expired excluded (and surfaced with `includeExpired`), upsert idempotency, audit rows, indexes synced.

### Engineering acceptance
LLM reasons over restaurant evidence ✅ · LLM selects tools through the shared policy/resolver ✅ · per-run working memory ✅ · episodes persist ✅ · long-term memory evidence-backed ✅ · canonical signals ✅ · existing offer generation authoritative ✅ · deterministic economics ✅ · ML semantics correct ✅ · uplift only when valid (never in this env) ✅ · ranked + diversified ✅ · grounded explanations ✅ · learning fed back ✅ · UI shows decision evidence ✅ · owner approval mandatory (no autonomous sending; `/intelligence` is read-only) ✅ · tenant/branch isolation ✅ · safe degradation ✅ · no duplicate engines/registries/clients/services ✅.

### Defects found and fixed during Phase 10
1. **Pre-existing**: `menuEngineeringService.ts` and `marginSignalsService.ts` crashed (`input must be a 24 character hex string`) when baseline rows contained legacy non-ObjectId `productId`s — any lookback reaching older rows killed the whole candidate engine. Fixed with hex-validated id filtering. Verified: 200/365-day engines now return candidates.
2. **New (this work)**: normalizers built Invalid Date from malformed `generatedAt` (fixed with safe ISO fallback + `unknown` freshness); `toolRegistry.get()` returns undefined rather than throwing (fail-closed check fixed); normalizer identity via function `.name` was wrong for inline arrows (explicit field); explanation grounding left dangling units (stripper now consumes the unit); non-`normalizer` field missing in a plan step; Phase 8 hook passed `'accept'` where the episode map expects `'accepted'` (caught by its own test).

---

## 1. Architecture diagram (text)

```
Authenticated request (JWT → AiTenantContext, restaurantId/branchId server-derived)
        │
        ▼
POST /api/ai/marketing-agent/{recommend, proposal, intelligence}
        │
        ├─(existing)──► runMarketingAgent ──► bounded loop (Phase 1) ──► tool registry ──► tools ──► services
        │
        └─(new)───────► runMarketingIntelligence
                          ├─ Phase 3 investigateBusiness ──► shared tool registry (parallel, deadline-clamped)
                          │        └─► normalizers ──► BusinessSignal[]
                          ├─ Phase 4 generatePromotionCandidates (EXISTING engine) ──► dedupe
                          ├─ Phase 5 ML evidence via registry ──► applyUplift/response/segment/forecast/basket semantics
                          ├─ Phase 6 rankAndDiversify ──► 7–10 diverse, provenance-carrying recommendations
                          ├─ Phase 7 explainRecommendation ──► shared LLM (grounded) │ deterministic fallback
                          └─ Phase 8 memory (read for grounding; lifecycle hook writes episodes)
        ▼
Owner UI (RecommendationsPage panel) → owner decides → /proposal → CampaignProposal (pending approval)
```

## 2. Agent execution flow
Policy allow-list (22 read-only tools, fail-closed) → budget (3 steps / 6 calls / 8s / ≤$0.05) → memory snapshot at step 0 → LLM plan (JSON, schema-checked) → tenant-scoped tool execution → evidence accumulation → stop / budget / failure → deterministic ladder remains authoritative for targeting.

## 3. Memory flow
Lifecycle event → episode (short-term, TTL 30d) → consolidation pass with thresholds → long-term memory (evidence + sample size + lastValidatedAt) → aging/invalidated handling → loaded at run start as context (never authority) → surfaced to the owner as plain statements.

## 4. Tool flow
One registry, one executor, one resolver; fail-closed resolution; schema-validated input/output; deadline clamping; every failure mapped to an explicit code; no tool ever trusts model-provided tenant identity.

## 5. ML flow
Registry tools → status/version/freshness → semantics layer (causal only from gated uplift) → ranking alignment + explanation grounding → degradation lines when unavailable.

## 6. Recommendation flow
Signals + candidates + ML + memory → rank (engine score dominant, diversity enforced) → explain (grounded, degradable) → owner sees decision evidence → owner approves → existing proposal path → existing campaign execution.

## 7. Tenant-isolation verification
Normalizer scope stamped from the authenticated tenant (tests A vs B); service rejects invalid tenant; tool queries tenant-scoped; memory manager rejects tenant keys from callers and enforces branch ownership; runtime probes confirm B-blind retrieval and that all tool calls carried the authenticated tenant id.

## 8. New services/files (Phase 3–10)
Backend: 8 `src/ai/intelligence/*.ts` (+6 test files), `src/ai/tools/marketing/getPromotionCandidatesTool.ts`, `src/ai/memory/memoryLearningService.ts` (+1 test), `src/services/__tests__/recommendationLifecycleMemoryHook.test.ts`, `scripts/probe-phase2-memory.ts`, this report.
Frontend: additions to `client.ts`, `agentCopy.ts`, `RecommendationsPage.tsx`, `agentCopy.test.ts`.

## 9. Duplicate systems avoided
No new tool registry/executor/resolver, LLM client, offer engine, promotion candidate engine, campaign service, analytics engine, ML registry, proposal system, tenant system, observability system, memory system, or business rules. Two existing services were *fixed*, not replaced.

## 10. Remaining technical debt
- Shared `OPERATOR`-style config for the pipeline budget/lookback could move to settings.
- Explanation grounding is regex-based (numbers only); units/entities are not validated semantically.
- `memoryLearningService` re-reads lifecycle data per pass (no incremental cursor).

## 11. Remaining known limitations / unresolved
- Sim tenant sales data ends 2026-03-29 → default 90-day candidate window yields no candidates (use `lookbackDays` or fresh data).
- Uplift unavailable in this environment (`ML_UPLIT_BASE_URL` unset) → causal rung never fires (correct, disclosed).
- Response-model degradation text is the upstream tool's wording and mixes uplift/response wording (cosmetic).
- Campaign strategy consolidation keys on `channel` (no strategy column in `CampaignHistory`).
- Product-level long-term memory patterns NOT IMPLEMENTED.
- `owner-recommendation-flow.spec.ts` BLOCKED by two missing pre-existing scripts.
- 7 pre-existing `LoginScreenConsent` frontend test failures (unrelated to this work).
- No commits/pushes were made; all work is left in the working tree for review.
