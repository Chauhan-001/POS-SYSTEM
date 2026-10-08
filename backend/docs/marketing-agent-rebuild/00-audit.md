# Marketing Agent Rebuild — Phase 0/1 Audit

Status date: 2026-10-06 · repo `C:/Loyalty_POS system` · branch `master` · 113 uncommitted paths
Method: every claim below was read from the file named next to it. Nothing here is assumed.

Baseline before any change:

| Check | Command | Result |
|---|---|---|
| AI/agent/intelligence/memory tests | `cd backend && npx vitest run src/ai --maxWorkers=1` | **387 passed / 25 files** (exit 0) |
| Backend typecheck | `cd backend && npx tsc --noEmit` | **344 pre-existing errors**, none in `src/ai/**` |
| Frontend typecheck | `cd restaurant-pos/Frontend && npx tsc --noEmit` | **exit 0** |

---

## 1. The headline finding — the duplicated investigation path is real, and its exact seam is known

Two complete marketing investigation systems exist behind one router
(`src/ai/agents/marketingAgentRoutes.ts`):

| | System #2 — agentic insight | System #3 — deterministic pipeline |
|---|---|---|
| Entry | `POST /api/ai/marketing-agent/recommend` | `POST /api/ai/marketing-agent/intelligence` |
| Impl | `src/ai/agents/marketingAgent.ts` → `runMarketingAgent` (890 lines) | `src/ai/intelligence/marketingIntelligencePipeline.ts` → `runMarketingIntelligence` (482 lines) |
| Style | LLM → tool → observe → LLM → stop (sequential) | parallel fan-out, no LLM in the loop |
| Tools | 22-name allow-list (`policies/marketingAgentPolicy.ts`) | same registry, 9 dimensions, 17 normalizers |
| Output | advisory insight card + replay trace | ranked recommendations (+ optional LLM wording) |
| Feeds | **nothing** | `/proposal` → `CampaignProposal` → owner approval |

`grep -rn "runMarketingAgent\b" src/ --include=*.ts` returns exactly three hits: its own
definition and the one route that calls it. Its evidence never reaches
`runMarketingIntelligence`, and the frontend calls **both on the same tab**
(`RecommendationsPage.tsx` line 131 `runMarketingInsights(...)`, line 160
`runMarketingIntelligence({limit:12})`).

**Consequence (exactly what the task describes):** the agentic loop pays full LLM cost to
investigate, then its observations are discarded before deterministic recommendation
generation runs a *second*, independent investigation over the same data.

---

## 2. Prior art that must NOT be rebuilt

`backend/docs/phase3-10-marketing-intelligence-report.md` documents Phases 3–10 as already
implemented, connected, tested and runtime-verified. Re-verified against the tree today:

| Capability the task asks for | Already exists | File |
|---|---|---|
| Signal scanner (9 domains) | **yes** | `src/ai/intelligence/businessIntelligenceService.ts` (`BUSINESS_DIMENSIONS = sales, menu, margin, inventory, customer, marketing, demand, basket, context`; parallel, deadline-clamped, read-only) |
| Structured signals, not a prompt | **yes** | `businessSignalTypes.ts` (330) + `businessSignalNormalizers.ts` (1479, 17 pure normalizers) |
| Candidate generation | **yes** | `services/promotionCandidateService.ts` (934) + `promotionOptimizationService.ts` (645) + `promotionFatigueService.ts` |
| ML enrichment + semantics | **yes** | `src/ai/intelligence/mlSemantics.ts`, `mlTypes.ts`; tools `get*/ml/*` |
| Deterministic validation | **partly** | economics inside `promotionCandidateService`; `services/offerValidationService.ts`; `services/factConsistencyService.ts` (claim/number checking) |
| Ranking + strategy diversity | **yes** | `src/ai/intelligence/recommendationRanking.ts` (547) — engine score dominant, round-robin diversification, `maxPerStrategy` |
| Grounded explanation / anti-fabrication | **yes** | `src/ai/intelligence/recommendationExplanation.ts` (526) — number grounding + causal gating, deterministic fallback |
| Memory (episodic / long-term / short-term) | **yes** | `src/ai/memory/{memoryManager,memoryTypes,memoryLearningService}.ts`; models `models/memory/{MemoryEpisode,RestaurantMemory}.ts`; priority ladder in `memoryTypes.ts` (`MEMORY_PRIORITY`) |
| Bounded sequential loop w/ budgets + replay | **yes** | `src/ai/agents/loop/agentLoop.ts` (774), `shared/agentRunContext.ts`, `observability/agentUsage.ts` |
| Owner approval / proposal lifecycle | **yes** | `src/ai/services/proposalLifecycle.ts` (377), `agents/marketingAgentProposal.ts` (274), model `models/marketing/CampaignProposal.ts` |
| Outcome + learning | **partly** | `models/intelligence/{RecommendationOutcome,LearningSignal,OfferExperiment}.ts`, `services/recommendationFeedbackService.ts`, `services/learningScheduler.ts`, `services/abTestingService.ts`, `modules/ml-pipeline/experiment*` |
| Tool security (registry/allow-list/Zod/timeouts/tenant stripping) | **yes** | `src/ai/tools/registry/{toolRegistry,toolExecutor,toolResolver,toolTypes}.ts`, `shared/tenantContext.ts`, `shared/agentRunContext.ts` (`FORBIDDEN_LLM_ARG_KEYS`) |
| Observability | **yes** | `observability/agentUsage.ts` (`recordLlmUsage`, `recordAgentRun`, `listReplayEpisodes`, `getReplayEpisode`) |
| Context intelligence | **yes (data-dependent)** | `src/context/sports/cricket/*`, `services/festivalService.ts`, `services/weatherIntelligenceService.ts`, `src/context/competition/*` |
| Data sufficiency | **yes** | `services/dataSufficiencyService.ts` |
| Prior removal of the old targeting ladder | **yes** | `agents/__tests__/marketingAgentRemoval.test.ts` pins `runMarketingAgentDeterministic` / `createProposalFromAgentResult` / `resolveAgentTargets` as unreachable |

---

## 3. Classification

### KEEP (reuse as-is)

- `tools/registry/*` + `tools/registerAllTools.ts` — the single tool path. `shared/tenantContext.ts`, `shared/aiErrors.ts`, `shared/llmClient.ts`, `shared/agentRunContext.ts`.
- `ai/intelligence/{businessSignalTypes,businessSignalNormalizers,businessIntelligenceService}.ts` — the scanner's engine. **Do not write a second scanner.**
- `ai/intelligence/{mlTypes,mlSemantics}.ts`, `recommendationRanking.ts`, `recommendationExplanation.ts`.
- `ai/memory/*` + `models/memory/*` — one memory system, tenant-scoped.
- `services/promotionCandidateService.ts`, `promotionOptimizationService.ts`, `promotionFatigueService.ts`, `offerValidationService.ts`, `offerEngine.ts`.
- `ai/services/proposalLifecycle.ts`, `ai/agents/marketingAgentProposal.ts`, `models/marketing/CampaignProposal.ts`.
- `observability/agentUsage.ts`, `modules/audit/*`, `middleware/rateLimiter.ts` (`intelligenceLimiter`, `intelligenceConcurrencyGuard`).
- Existing `/intelligence`, `/proposal`, `/insight-runs*` routes and the Opportunities + Advisory surfaces.

### MODIFY (keep, adapt)

- `ai/agents/loop/agentLoop.ts` — extend observation/coverage plumbing for **domain-level** steps (already supports `coverageGuidance`, `observationChars`, `captureToolData`, `stopGuard`, `replayEpisode`, `loadMemory`, `rolePrompt`, `promptVersion`; no rewrite needed).
- `ai/intelligence/marketingIntelligencePipeline.ts` — becomes the **post-investigation** half of the new flow (scanner → rank → explain), consuming the Marketing Manager's situation model instead of re-deriving context.
- `ai/agents/marketingAgent.ts` — its synthesis + sufficiency guard logic is reusable, but its role changes from "produce an insight card" to "produce a situation model".
- `ai/agents/policies/marketingAgentPolicy.ts` — allow-list narrows from 22 raw tools to the domain capabilities; budgets retuned.
- `ai/intelligence/businessIntelligenceService.ts` — expose a scanner-shaped entry (`scanSignals`) alongside `investigateBusiness`.
- `restaurant-pos/Frontend/src/components/marketing/RecommendationsPage.tsx` + `MarketingWorkspace.tsx` — add the deep-analysis surface, keep the fast panels.
- `restaurant-pos/Frontend/src/api/client.ts` — add the `/analyze` fetcher.
- `services/recommendationCandidateService.ts` / `recipe`-level memory consolidation — extend (see MISSING #3 below).

### REPLACE (architecture conflicts with the target)

- The **split** between "agentic insight" and "deterministic pipeline". Target: one canonical path — scanner → Marketing Manager (sequential, domain-level) → situation model → candidates → ML → validation → ranking → critic → recommendations. `/recommend`'s role is subsumed; the replay data it produces is retained.

### DELETE (only after the canonical path is verified — see TODO Phase 18)

- The redundant agentic investigation entry point once its behaviour lives inside the Marketing Manager.
- Any prompt/policy/tool names that become unreachable by that change.

### UNKNOWN — confirmed today

| Question | Answer | Evidence |
|---|---|---|
| Feedback source available? | **Yes, one**: the public receipt landing page | `modules/public-store/controllers/receiptController.ts` → `postReceiptFeedback`; route `POST /api/public-store/receipt/:receiptToken/feedback`; `customer-site/src/pages/ReceiptPage.jsx`; model `models/customers/ReceiptFeedback.ts` (`rating` 1–5, optional `comment`) |
| Google reviews / Business Profile API? | **No integration exists** | `grep -rn "google" src/ -i` matches only Google Places (nearby competition), never reviews |
| Embeddings / vector search anywhere? | **No** — and by design | `ai/memory/memoryManager.ts:15`, `memoryTypes.ts:22`, `models/memory/*`: "INDEXED MONGODB ONLY — no vector search, no embeddings" |
| Admin dashboard consumes the marketing agent? | **No** | `grep -rn "marketing-agent" admin-dashboard/src` → 0 hits |
| Feedback read path today | `GET /api/marketing/feedback` | `src/routes/marketing.ts:79` → `FeedbackPanel.tsx:87` (`api.fetchFeedback`) |

---

## 4. MISSING (must be built)

1. **Domain-level intelligence capabilities** — `investigateSales` / `investigateProducts` /
   `investigateInventory` / `investigateCustomers` / `investigateFeedback` /
   `investigateMarketingHistory` / `investigateContext` / `investigateML`.
   Today the LLM sees 22 database-level tools; `BUSINESS_DIMENSIONS` is a read-only fan-out,
   not a domain façade the Marketing Manager can call sequentially.
2. **Situation Model** — no such type exists anywhere (`grep` for `SituationModel` → 0 hits).
3. **Feedback Intelligence** — no normalization, topic trend, or recurring-complaint layer over
   `ReceiptFeedback`. Product-level long-term memory patterns are also explicitly
   "NOT IMPLEMENTED" (prior report §F).
4. **Final Critic** — no PASS/DOWNGRADE/REJECT component. `factConsistencyService` (claim
   grounding) + `recommendationExplanation` (number grounding) are reusable substrates.
5. **Canonical deep-analysis endpoint** — `POST /api/ai/marketing-agent/analyze` does not exist.
6. **Marketing Manager budgets** sized for domain-level investigation (current marketing budget:
   14 steps / 12 calls / 90s / 90k tokens / $0.40 — tuned for raw-tool roaming).
7. **Deep-analysis UI** — the situation/top-opportunities/evidence experience. `agentCopy.ts`
   already provides the plain-language helpers to build it on.

---

## 5. TAGET FLOW → existing code it lands on

```
UI (new Marketing Agent tab)      → RecommendationsPage/Workspace + client.runMarketingAnalyze  [NEW]
  POST /analyze                   → marketingAgentRoutes                                       [NEW route]
  Context Builder                 → memoryManager.loadMemoryContext + agentLoop step-0 snapshot [REUSE]
  Signal Scanner                  → businessIntelligenceService (9 dimensions)                 [REUSE + expose]
  Marketing Manager (sequential)  → NEW loop over domain capabilities, using agentLoop plumbing [NEW]
      ├ investigateSales/Products/Inventory/Customers        → existing tools + normalizers    [NEW façade]
      ├ investigateFeedback           → NEW over ReceiptFeedback                               [NEW]
      ├ investigateMarketingHistory   → existing offer/campaign tools                          [NEW façade]
      ├ investigateContext/ML         → existing context + ML tools                            [NEW façade]
  Situation Model                 → NEW structured type (no chain-of-thought)                  [NEW]
  Candidate Generation            → promotionCandidateService                                 [REUSE]
  ML Enrichment                   → mlSemantics                                                [REUSE]
  Deterministic Validation        → candidate constraints + offerValidation + factConsistency [REUSE]
  Ranking + Diversity             → recommendationRanking                                     [REUSE]
  Final Critic                    → NEW (PASS/DOWNGRADE/REJECT)                               [NEW]
  8–10 recommendations            → RankingResult extended                                    [MODIFY]
  Proposal / approval             → proposalLifecycle + marketingAgentProposal                [REUSE]
  Outcome measurement/learning    → RecommendationOutcome + memoryLearningService             [REUSE+EXTEND]
```

## 6. Decisions taken (and why), pending user override

- **Feedback Intelligence is built over `ReceiptFeedback` only.** Google reviews do not exist in
  this repo and the spec forbids scraping Google Maps, so that source is recorded as
  `MISSING / BLOCKED` rather than faked.
- **No vector store.** The repo's memory contract is deliberately index-based; adding embeddings
  would introduce a new datastore. Feedback topics are therefore derived deterministically
  (keyword/topic buckets + trend arithmetic), which satisfies §8's "topic trends / recurring
  complaints / trend direction / supporting examples" without inventing infrastructure.
- **`/recommend` is not deleted in this phase** — it is superseded in Phase 13 and removed in
  Phase 18 only after the canonical path is verified (task §25: do not preserve it merely because
  it exists, but prove the replacement first).
