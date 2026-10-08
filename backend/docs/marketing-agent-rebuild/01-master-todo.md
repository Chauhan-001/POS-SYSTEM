# Marketing Agent Rebuild — Master TODO

Companion to [`00-audit.md`](./00-audit.md). Derived from the audit: **most of the target
architecture already exists** (Phases 3–10 of the prior programme). This plan therefore
*coheres* existing parts into one canonical sequential path and fills the 7 identified gaps,
rather than rebuilding from scratch.

Legend: `[ ]` pending · `[-]` in progress · `[x]` verified complete · `[!]` blocked / declared-only

## DECISIONS ACCEPTED (owner, this programme)

1. **Feedback Intelligence** — DECLARED ONLY. The capability is registered and visible in
   the domain catalog (`implemented:false`), returns `DOMAIN_NOT_IMPLEMENTED`, and is
   disclosed in every `/analyze` response. The owner will wire a feedback/RAG system later.
   Nothing may be concluded about guest satisfaction until then.
2. **Memory retrieval** — NO embeddings, no vector store. The indexed-MongoDB-only memory
   contract ([memoryManager.ts:15](../../src/ai/memory/memoryManager.ts#L15)) is preserved.
   Revisit when the feedback RAG system lands.
3. **Competition** — DECLARED ONLY, same as feedback. No competitor data provider exists and
   directory scraping is out of scope, so no competitor fact may be asserted.
4. **Cadence** — walking skeleton first (one thin end-to-end `/analyze` path), then deepen.

## SKELETON STATUS (this pass)

Built and verified: contracts · domain capability layer (7 implemented + 2 declared) ·
cheap pre-scan · context builder · Marketing Manager sequential loop · situation model ·
deterministic validation gate · ranking/diversity · final critic · `POST /analyze`.
Evidence: `02-skeleton-report.md`. Deepened since: Phases 8, 10, 14 and 15 are done and
live-verified, and Phase 16 (the owner-facing deep-analysis surface) is done and
test-verified. Remaining: the scenario matrix, removal of the superseded path.

Rule: do not start a phase until the previous one is verified. Every phase runs only the checks
it needs; the full suite runs at Phase 19.

---

## PHASE 0 — Audit `[x]`

**Goal** Classify every existing marketing/AI implementation as KEEP / MODIFY / REPLACE / DELETE / UNKNOWN.
**Deliverable** `backend/docs/marketing-agent-rebuild/00-audit.md`.
**Acceptance** Every claim cites a file; the duplicated-investigation seam is located exactly.
**Verified** `npx vitest run src/ai --maxWorkers=1` → 387 passed; baseline typecheck recorded.

---

## PHASE 1 — Target contracts `[x]`

**Goal** Define the types the whole rebuild compiles against, before any behaviour changes.
**New** `src/ai/marketing/contracts.ts`:
- `SituationModel` — `{ goal, signals[], confirmedFacts[], hypotheses[], evidence[], opportunities[], risks[], contradictions[], uncertainties[], investigatedDomains[], missingEvidence[], candidateDirections[], confidence }`. Every fact carries `evidenceRefs: string[]`. **No chain-of-thought field.**
- `IntelligenceDomain` = `'sales' | 'products' | 'inventory' | 'customers' | 'feedback' | 'marketing_history' | 'context' | 'ml'`.
- `DomainInvestigation` — `{ domain, status: 'ok'|'partial'|'unavailable', findings[], signals[], evidence[], degradedReason?, limits? }`.
- `CandidateDirection` — the strategic hypothesis handed to the candidate engine `{ direction, target, objective, mechanism, evidenceRefs[], domain }`.
- `CriticVerdict` — `{ verdict: 'PASS'|'DOWNGRADE'|'REJECT', reasons[], downgradedTo?, checks[] }`.
- `AnalyzeRequest` / `AnalyzeResponse` — `{ goal? }` → `{ runId, status, situation, investigationSummary, recommendations[], evidence, confidence, risk, degradations, proposal? }`.
**Reuse** naming/shape conventions from `businessSignalTypes.ts`, `recommendationRanking.ts`, `agentRunContext.ts`.
**Acceptance** Zod schemas for the LLM-facing parts (`CriticVerdict`, situation fields returned by the model); types compile; no behaviour wired yet.
**Verify** `npx tsc --noEmit` on the new file (baseline 344 unchanged, 0 in new file) + a contract unit test asserting the schemas reject extra/CoT fields.

---

## PHASE 2 — Signal scanner entry point `[x]`

**Goal** Expose the existing scanner as the cheap first step, without touching its internals.
**Modify** `ai/intelligence/businessIntelligenceService.ts` — add `scanSignals({tenant, branchId, budgetMs, lookbackDays?})` returning the existing `BusinessInvestigation` (same engine, named for its new role).
**Reuse** the 9 dimensions + 17 normalizers as-is.
**New** `src/ai/marketing/signalScanner.ts` — thin adapter that maps `BusinessSignal[]` → the compact scanner digest for prompts (`topSignals`, per-domain counts, `unavailableDomains`).
**Acceptance** Same signal counts as `investigateBusiness` for the same input; digest contains no raw internal ids.
**Verify** extend `businessIntelligenceService.test.ts` equivalence test + new digest test.

---

## PHASE 3 — Domain capability layer `[x]` (7 implemented + 2 declared-only)

**Goal** Give the Marketing Manager **8 domain capabilities instead of 22 database tools** (task §4).
**New** `src/ai/marketing/domains/` — `sales.ts`, `products.ts`, `inventory.ts`, `customers.ts`, `marketingHistory.ts`, `context.ts`, `ml.ts`, plus a `registry.ts` and `types.ts`. Each capability:
- declares `domain`, `question` it answers, and a **bounded** internal tool plan;
- executes through the existing `executeTool` + shared registry (tenant from `ToolContext`);
- returns `DomainInvestigation`; never throws (failures → `status:'unavailable'` + `degradedReason`);
- **derives findings deterministically** from tool output + the existing normalizers (no LLM).
**Reuse** `toolExecutor`, `toolRegistry`, `businessSignalNormalizers`, `mlSemantics`.
**Depends** Phase 1.
**Acceptance** Each capability is callable in isolation, tenant-scoped, timeout-clamped, degrades independently; no new registry/executor.
**Verify** per-domain unit tests (ok / unavailable / malformed / timeout / cross-tenant blind).

---

## PHASE 4 — Feedback Intelligence `[!]` DECLARED ONLY (owner decision)

**Goal** The one genuinely new intelligence domain.
**New** `src/ai/marketing/domains/feedback.ts` + `src/services/feedbackIntelligenceService.ts`.
- Source: `ReceiptFeedback` (`rating` 1–5, optional `comment`), tenant+branch scoped, time-windowed.
- Deterministic outputs: rating trend & direction, complaint/praise **topic buckets** (fixed keyword taxonomy, no LLM), recurring issues (count ≥ threshold), product/service attribution where the comment names a known menu item, trend strength, supporting example refs (bill/feedback ids — never customer PII).
- Retrieval: indexed Mongo query + bucket scoring. **No embeddings/vector store** (audit §6).
**Reuse** `dataSufficiencyService` for thin-data honesty.
**Acceptance** With no feedback rows → `unavailable` (not "no complaints"); with rows → trends + examples; no PII in output.
**Verify** unit tests incl. empty / sparse / mixed / negative-trend / praise-trend / PII-absence.

---

## PHASE 5 — Context builder `[x]`

**Goal** Assemble the pre-investigation context block (task §0 "Context Builder").
**New** `src/ai/marketing/contextBuilder.ts` — combines: current restaurant state (profile + branch), scanner digest (Phase 2), restaurant profile memory, episodic memory, short-term memory, recent outcomes, and the memory **priority ladder** (`MEMORY_PRIORITY`) so memory can never outrank current facts.
**Reuse** `memoryManager.loadMemoryContext`, `memoryTypes.MEMORY_PRIORITY`, `dataSufficiencyService`.
**Acceptance** Context is compact (bounded chars), tenant-scoped, excludes raw JSON, and states freshness; current-data facts are labelled `authoritative` and memory `advisory`.
**Verify** unit tests: freshness ordering, memory-never-overrides-current, degraded memory handling.

---

## PHASE 6 — Marketing Manager sequential loop `[x]`

**Goal** The central reasoning component: sequential, domain-level, stop-when-sufficient (task §5/§6).
**New** `src/ai/marketing/marketingManager.ts` — drives the existing bounded loop (`ai/agents/loop/agentLoop.ts`) with:
- `rolePrompt` = Marketing Manager (investigate, never execute, never invent);
- tool surface = the 8 domain capabilities of Phase 3/4 (allow-list of domains, fail-closed);
- per-step: LLM picks **one** domain → capability runs → observation → LLM updates the situation model → repeat/stop;
- **stop guard**: no whole-restaurant conclusion from unavailable domains; no conclusion while a domain remains unread and unauthorised termination is premature (reusing the deferral pattern from `marketingAgent.ts`);
- budgets retuned for depth (§21): explicit `maxSteps/maxToolCalls/wallClockTimeout/tokenBudget/costBudget`, env-configurable.
**Reuse** `agentLoop` (coverage guidance, observation clip, `stopGuard`, `replayEpisode`, `loadMemory`), `llmClient`.
**Depends** Phases 1–5.
**Acceptance** Sequential (one domain per step, order chosen by the model); stops early when evidence is sufficient; bounded on every axis; never writes; every fact carries evidence refs.
**Verify** agent tests with a stubbed LLM: escalation Sales→Feedback→Customers→MarketingHistory, empty-domain-does-not-conclude, budget exhaustion, LLM outage → degraded-but-honest.

---

## PHASE 7 — Situation Model assembly `[x]`

**Goal** Turn accumulated domain observations into the structured `SituationModel` (task §9).
**New** `src/ai/marketing/situationModel.ts` — merges deterministic signals + domain findings into the contract from Phase 1; contradictions and uncertainties are explicit; every entry references evidence.
**Acceptance** No hidden reasoning stored; contradictions surface rather than being silently resolved.
**Verify** unit tests: merge, contradiction detection, uncertainty when a domain is unavailable.

---

## PHASE 8 — Candidate direction → candidate engine `[x]` (directions now RESTRICT engine generation; unrepresentable + unrealised directions disclosed; disclosed fallback)

**Goal** Connect strategic directions to the mature deterministic engine (task §11).
**Modify** `marketingIntelligencePipeline` stage-4 seam so candidate generation accepts `CandidateDirection[]` (mapping direction → engine `PromotionType` + target filters) **in addition to** the existing unrestricted run.
**Reuse** `generatePromotionCandidates`, `deduplicateCandidates`, `violatesRestrictions`.
**Acceptance** Directions refine/prioritise candidates but never fabricate offers; unmatched directions are reported, not forced.
**Verify** unit tests: direction→candidate mapping, unmatched direction honesty, no duplicates.

---

## PHASE 9 — ML enrichment `[x]` (semantics reused verbatim; non-causal guarantees tested)

**Goal** Attach applicable ML evidence to each surviving candidate (task §12).
**Modify** wire `mlSemantics` output onto candidates in the new path (uplift only when the upstream gate passes; response is explicitly non-causal).
**Acceptance** High predicted response never implies a good campaign (economics still gate); unavailable ML is disclosed per candidate.
**Verify** unit tests incl. `high response + poor margin` (rejected later, not boosted).

---

## PHASE 10 — Deterministic validation gate `[x]` (7 checks; stockout + overlap now REAL per-product reads via getStockoutRisk contributingMenuItems and getActiveOffers applicable scopes)

**Goal** Make validation authoritative and un-bypassable (task §13).
**New** `src/ai/marketing/validationGate.ts` — composes economics/margin/contribution (candidate constraints), inventory feasibility, product/recipe rules, customer eligibility, marketing conflicts (fatigue, duplicate/overlapping active offers, cannibalization) and safety.
**Reuse** `promotionCandidateService` constraints, `offerValidationService`, `promotionFatigueService`, `inventoryDemandForecastingService`, `factConsistencyService`.
**Acceptance** A candidate failing any check is rejected with a machine-readable reason; the LLM cannot override; rejection counts are reported.
**Verify** unit tests per check + a test proving a model-authored "override" cannot resurrect a rejected candidate.

---

## PHASE 11 — Ranking, diversity, 8–10 output `[x]` (shortfall disclosed, never padded)

**Goal** Deliver 8–10 evidence-supported, strategy-diverse recommendations (task §14).
**Modify** `recommendationRanking.ts` inputs to include critic verdicts (Phase 12) and situation-model evidence; keep engine score dominant; ensure the default shortlist targets 8–10 when evidence permits and discloses when it cannot.
**Acceptance** No 8 variants of one discount; each pick traces to evidence; shortfall is disclosed rather than padded.
**Verify** extend `recommendationRanking.test.ts` (diversity, evidence gating, shortfall honesty).

---

## PHASE 12 — Final Critic `[x]` (strict schema, number grounding, explicit deterministic fallback)

**Goal** Independent PASS/DOWNGRADE/REJECT review (task §15).
**New** `src/ai/marketing/finalCritic.ts` — LLM critic over candidate + evidence + ML + economics + history + context, with the strict-schema + number-grounding discipline already proven in `recommendationExplanation.ts`; cannot invent replacement evidence; deterministic fallback when the LLM is unavailable.
**Acceptance** Schema `.strict()` (no CoT field); ungrounded numbers stripped; verdict reasons cite evidence refs; `REJECT` removes the candidate from output.
**Verify** unit tests: pass/downgrade/reject, schema rejection of extra keys, hallucinated-number stripping, LLM-down fallback.

---

## PHASE 13 — `/analyze` endpoint `[x]` (live HTTP 200 verified)

**Goal** One canonical deep-analysis API (task §18).
**New** route in `marketingAgentRoutes.ts`: `POST /api/ai/marketing-agent/analyze` (`requireAuth` + `requireRole('owner','manager','super_admin')` + `intelligenceLimiter` + `intelligenceConcurrencyGuard`), body `{ goal? }`, response per Phase 1 contract.
**Modify** observability: extend `agentUsage.recordAgentRun` usage for the manager run (tokens, cost, steps, domains, candidate counts, validation rejections, degradations) — **no CoT, no PII**.
**Reuse** `ai.tenantContextFromRequest`, audit trail, `AiUsageLog`.
**Acceptance** Tenant only from auth; response carries situation + recommendations + evidence + confidence + degradations; never exposes CoT/prompts/model internals.
**Verify** route tests: auth/role, tenant isolation, degraded run, budget-exhausted run.

---

## PHASE 14 — Memory integration for the canonical path `[x]` (episode written for every analysis and read back by the next run; live-verified)

**Goal** Read context at start, write an episode at the end (task §10, §17).
**New** `src/ai/marketing/memoryWriteback.ts` — `analysisEpisodeInput`, `collectEpisodeEvidence`, `recordAnalysisMemory`. Writes ONE `agent_run` episode per analysis plus one `recommended` lifecycle event per surviving recommendation (`MAX_RECOMMENDATION_EVENTS=10`, `MAX_EPISODE_EVIDENCE=20`). Never throws; a failed write is reported as a degradation, never as success.
**Modify** `analyze.ts` — step 10 (after the shortlist is final) and `memoryWrite` on `AnalyzeResponse`; context is read at step 1 from `loadMemoryContext` and reported as `memory: { episodes, longTerm, degraded }`.
**Reuse** `memoryLearningService.recordRecommendationLifecycleEvent`, `memoryManager`.
**Acceptance** Memory is tenant-scoped, evidence-backed, never authoritative; no CoT or raw prompts stored; failed episodes are equally learnable.
**Verify** unit tests: episode written on success/failure/degrade; tenant B blind; no CoT persisted.
**Verified (live, real HTTP)** `POST /api/ai/marketing-agent/analyze` → `memoryWrite.attempted:true, episodeWritten:true, episodeId:<ObjectId>`; the stored episode carries `runId`, objective, situation facts, investigation telemetry and degradations — and no prompt/CoT. Read-back is proven by the count growing run-over-run (`memory.episodes` 2 → 3) while the episode store holds the prior runs' analysis. Degradation path proven: a failed write pushes `memory write-back failed: …` onto `degradations` rather than reporting a false success.
**Not verified** `recommendationsRecorded` has never been > 0 live: this tenant's candidate engine produces 0 candidates, so no `recommended` lifecycle event has been written through this path. The event shape is unit-tested.

---

## PHASE 15 — Outcome measurement + learning extension `[x]` (measured outcomes folded into memory exactly once; product patterns derived arithmetically; feedback-trend learning NOT implemented by decision)

**Goal** Close the loop (task §17) and fill the two known gaps.
**New** `src/ai/marketing/outcomeLearning.ts` — (1) `linkMeasuredOutcomesToMemory`: reads ALREADY-MEASURED `RecommendationOutcome` rows and folds each into memory as an explicit `outcome_positive` / `outcome_negative` event carrying the REAL numbers (baseline, actual, variance) and no estimates; (2) `consolidateProductPatterns`: per-item demand/margin long-term memory computed ARITHMETICALLY from `analyzeMenuEngineering` (never from an LLM), upserted by `product:<id>` and freshness-guarded (`PRODUCT_PATTERN_FRESHNESS_DAYS=7`).
**Causality rule** Only `control_vs_test` attribution is described as incremental; every other method is stored as an association, not an incrementality claim.
**Idempotency** Each row is CLAIMED atomically (`updateOne({_id, memoryLinkedAt: null}, {$set:{memoryLinkedAt}})`), so concurrent runs cannot learn from the same measurement twice.
**Modify** `RecommendationOutcome` (+`memoryLinkedAt` marker + index `{restaurantId,status,memoryLinkedAt}`), `memoryTypes.ts` (+`product_performance_pattern` long-term type), `analyze.ts` step 0 (learning happens BEFORE context is built, so this run already benefits from the last one).
**Acceptance** Outcomes recorded with baseline/exposure/orders/contribution where available; incrementality only from gated experiments.
**Verified (live, real HTTP)** with one seeded `control_vs_test` measured row: first `/analyze` → `outcomeLearning.outcomesLinked:1, outcomesPositive:1, causalOutcomes:1`; the stored memory episode reads `Measured percentage outcome (control_vs_test, status measured). contribution vs expectation: +2400. Measured against a control group, so this is an incremental effect.` with the real metrics (orders 240, revenue 96000, contribution 21000, baselineValue 88000). Second `/analyze` → `outcomesLinked:0` and `memoryLinkedAt` set on the row: exactly-once is proven end-to-end, not just in unit tests. Unit suite: `npx vitest run src/ai/marketing` → 48/48.
**Bug found and fixed in the CODE (not the test)** `verdictForOutcome` treated the schema-DEFAULTED `variance.contributionDiff = 0` as a positive result, which would have fabricated a success signal from a row that was never measured. A delta of exactly `0` now yields no verdict: the row is counted `unusable` and left UNCLAIMED so it can be learned from once real variance exists.
**NOT implemented (owner decision, not a regression)** feedback-trend learning. The feedback domain is declared-only, so there is no satisfaction signal to learn from; every run discloses `feedback-trend learning is not implemented (feedback domain is declared only)`.
**Not verified** `consolidateProductPatterns` has never written a pattern live — this tenant has 0 items with enough trading history for percentiles (`MIN_PRODUCTS_FOR_PATTERN=3`), and the response says so (`only 0 item(s) had enough trading history…`). Unit-tested only until a tenant with menu history exists.

---

## PHASE 16 — UI deep-analysis surface `[x]` (panel + wiring + tests verified; live full-run browser check BLOCKED on an expired session)

**Goal** The Marketing Agent experience (task §19) without breaking Opportunities/Advisory.
**New** `restaurant-pos/Frontend/src/components/marketing/DeepAnalysisPanel.tsx` — the owner-facing `/analyze` surface. Sections in spec order: Restaurant Analysis (status, objective, risk, confidence, approval reminder) → What we found (confirmed / openings / watch-outs) → Important signals (measured value + unit) → What we investigated (per-area status, "No data", declared-only disclosure, uncertainties, disagreements) → Top opportunities → per card: Why it matters, Evidence used, Expected economics, Predictions used, Checks against your rules, then Approve → Draft / Review details / Ignore.
**Modify** `api/client.ts` (+`runMarketingAnalyze` and the full `MarketingAnalyzeResult` mirror of `contracts.ts`), `agentCopy.ts` (+domain/status/validation/critic/rejection/evidence-ref copy), `RecommendationsPage.tsx` (renders the panel as its own section — the AI Insights and Recommended Actions sections are untouched, and the offer-engine "Opportunities for you" cards are unchanged).
**Design decisions** owner-invoked, never auto-run (a deep run spends several LLM calls, so the page must not start one behind the owner's back); Approve reuses the SAME `/proposal` draft flow as Recommended Actions (pending + editable, never sent); Ignore records a `neutral` owner decision through the existing `/intelligence/recommendations/:id/feedback` endpoint so it is audited and feeds learning. The panel is defensive about the authoritative gate: a candidate whose `validation.passed` is false renders as **Blocked**, explains the reason, and its Approve button is **disabled** — the UI cannot route around the deterministic gate.
**No CoT** the contract has no reasoning field, and a test feeds the panel a payload that smuggles in `chainOfThought`/`reasoning` to prove none of it can reach the screen.
**Acceptance** Opportunities stays fast (separate endpoint untouched); Advisory untouched; loading/error/empty/retry states; owner approval still via `/proposal`.
**Verify** frontend `npx tsc --noEmit` → **0 errors**; `npx vitest run src/components/marketing/__tests__` → **69/69 passed** in 3 files (11 agentCopy + 15 RecommendationsPage + 43 DeepAnalysisPanel). `RecommendationsPage.test.tsx` gained only the new client mock plus two tests, which pin that the page still loads both older surfaces exactly as before and that the deep panel does NOT auto-run; none of its existing assertions were weakened.
**Contract-drift guard** `__tests__/fixtures/realAnalyzeResponse.ts` is a VERBATIM capture of a live `POST /analyze` (HTTP 200, tenant B, 13 degradations, 4 facts, 8 signals, 0 recommendations). Six tests render that real payload, so a backend shape change fails here rather than in front of the owner — and they assert the real payload's raw `signal:…:80022f:…` refs and the tenant id never reach the DOM.
**BLOCKED (browser check, honestly)** the panel was verified to mount in the running app (Vite 5175, real tenant shell) and to render its empty state, but the FULL interactive run through the browser could not be completed: that browser profile's session is expired (every app request returns 401), I had no credential for this tenant, and I deliberately did NOT substitute another tenant's demo login or re-pin a PIN to get in, since that would change the signed-in session/data rather than verify the change. The preview webview also produced no frames, so no screenshot could be taken. No screenshot and no live UI run are claimed: `NOT VERIFIED` visually. DOM-level rendering of a real payload IS covered by the fixture test above.
**Not verified** the per-card blocks (Why / Evidence / economics / checks / Approve / Ignore) have never been exercised against a live run, because this tenant's candidate engine returns 0 recommendations; every card path is covered by unit tests including the blocked and missing-economics cases.

---

## PHASE 17 — Test matrix `[-]` IN PROGRESS (harness + registry + the honest-negative cases green; the spec's §27 list is NOT in this repo, so the matrix is deliberately partial, not invented)

**Goal** The scenario coverage of task §27 against the canonical path.
**New** `src/ai/marketing/__tests__/scenarios.harness.ts` — the shared machinery: real in-memory Mongo lifecycle, seed helpers for the models the domains read, `runScenario()` (drives the REAL canonical path with the LLM stubbed or disabled), a compact `digest()`, and the disclosure helpers. **No layer is mocked** — mocking a domain capability would defeat the point of the matrix. `src/ai/marketing/__tests__/scenarios.test.ts` — the `SCENARIO_CASES` registry and the runner. `docs/marketing-agent-rebuild/03-scenario-matrix.md` — the matrix table.
**Implemented cases (5)** `new_restaurant_empty_database`, `no_trading_history_with_menu`, `ml_unavailable_disclosed`, `conflicting_evidence_surfaced`, `cross_tenant_blindness`. The first three assert the confidence bound `≤ 0.5`, which is DERIVED from the orchestrator's own formula (`0.5 * situation.confidence + 0.5 * mean(recommendation confidences)` — zero recommendations makes the second term exactly 0), not an arbitrary threshold.
**Two self-enforced rules** (1) NO SILENT SKIP — every registered case must make ≥ 1 assertion, and the guard's predicate is itself pinned by a test so it can never quietly become vacuous; (2) assertions are evidence-grounded or disclosure/absence checks — a scenario may assert that the system said something honest, never a flattering rewrite.
**Acceptance** Every scenario asserts an explicit, evidence-grounded outcome — including the honest-negative cases (no data, conflicting evidence, missing ML, new restaurant). **Met for the cases implemented**; the remaining scenarios and the 11 cross-dimensional combinations are not.
**Verify** `npx vitest run src/ai/marketing` → **55/55 passed** (48 + 7 new); `npx tsc --noEmit` → **344 = baseline, 0 new**.
**BLOCKED on information, not on code** the 20 scenarios and 11 combinations are defined by §27 of the master spec, which is not in this repository and not in its git history (`grep` for §27 / "20 scenarios" / "cross-dimensional" reaches only these rebuild docs; the one deleted `.planning/REQUIREMENTS.md` in history is an unrelated Phase-4 planning file). Inventing 20 scenarios and labelling them "the 20" would be fabrication, so the registry is left filled only with the cases the acceptance criteria actually name. Adding each remaining case is one object literal `{ id, axis, specRef, run }` — the runner, guard, Mongo lifecycle and seed helpers are already in place.
**Not yet covered (highest value once the list lands)** a RICH-data tenant producing real recommendations (exercising the engine, the gate and the critic on a populated database rather than only their empty-data disclosures); stockout feasibility rejection against real recipe/consumption data; and a scripted-LLM orchestrator case proving the manager's sequential domain order and stop-guard refusals end to end.

---

## PHASE 18 — Cleanup of the superseded path `[ ]`

**Goal** Remove the duplicate investigation only after the replacement is proven (task §25).
**Steps** 1) prove Phase 19 end-to-end; 2) `grep` every caller of the superseded entry; 3) remove the obsolete prompt/policy/route/UI call; 4) re-run suites; 5) confirm Opportunities + Advisory + `/proposal` still work.
**Acceptance** One canonical investigation path; nothing else depends on the removed code; negative test (pattern of `marketingAgentRemoval.test.ts`) pins it.
**Verify** full backend + frontend suites, `/intelligence` still green, and the negative test.

---

## PHASE 19 — End-to-end verification `[ ]`

**Goal** Prove the delivered system through the real interface (task §28).
**Verify**
- backend `npx tsc --noEmit` (344 baseline, 0 new) · `npx vitest run src/ai --maxWorkers=1` ≥ 435
- frontend `npx tsc --noEmit` (0) · marketing tests
- live: backend up, real token, `POST /analyze` → situation + 8–10 recommendations, degradations honest
- live: `/proposal` still creates a pending proposal; Opportunities + Advisory unaffected
- tenant isolation probe (B blind to A)
- degradation probes: feedback empty, ML down, LLM rate-limited
**Deliverable** `backend/docs/marketing-agent-rebuild/01-final-report.md` (task §30 template).

---

## Cross-cutting rules (apply to every phase)

- Never invent file names, functions, schemas, fields or env vars — locate first, then reuse.
- Tenant identity only from the authenticated context; never from the LLM or the client.
- The LLM never becomes the source of truth; deterministic validation is authoritative.
- No chain-of-thought persisted or returned; structured evidence refs only.
- Every phase updates this TODO and states `NOT VERIFIED` / `BLOCKED` honestly.
