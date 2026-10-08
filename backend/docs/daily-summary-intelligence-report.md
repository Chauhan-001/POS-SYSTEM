# Daily Summary / Z-Report Intelligence — Final Report

Implementation of the AI-powered **Daily Summary** experience on top of the existing,
untouched deterministic Z-report. Written against the repository as it actually is
(every path below was read before it was used).

---

## 1. Final architecture

```
POST /api/ai/z-report/generate                    (NEW, read-only)
        │
        ├─ context builder            ai/agents/zReportContext.ts      (Phase 2)
        │     business date · branch ownership · comparison windows · memory
        │
        ├─ deterministic closing pull  closingReportService.zReport()   (EXISTING)
        │     the SAME Z-report the owner already sees — read as INPUT, never replaced
        │
        ├─ Batch 1  core facts        investigateBusiness() + defaultDimensionPlan()
        │            11 canonical plan entries (reordered, not re-wired)
        │            + the one dimension the canonical plan lacks: getWastage
        │            + closing facts folded in (cash_over_short / sales_day_close)
        │
        ├─ Batch 2  derived signals    salesReportService.summary() + detectAllDemandAnomalies()
        │            deterministic day-over-day deltas and anomaly→signal mapping
        │
        ├─ Batch 3  conditional        ML/context fan-out (only when the day moved)
        │
        ├─ Evidence merge              dedup · conflict detection · degradation disclosure
        │
        ├─ Targeted follow-up          ONE round, ≤4 tools, FIXED rule table
        │            (only tools Batch 1/3 did NOT already read; mlSemantics for ML)
        │
        ├─ Evidence merge (complete)   the single grounding surface
        │
        ├─ LLM synthesis               ONE call over a projected fact sheet
        │
        ├─ FINAL CRITIC                deterministic, 7 checks
        │            repair ⇒ deterministic narrative (built from the same evidence)
        │
        └─ persist + observe           DailySummaryEvidence · AIUsageLog
```

No LLM tool loop: the model never selects a tool, never sees tenant metadata, and
never decides which database fact is correct.

---

## 2. Files created

| File | Purpose |
| --- | --- |
| `backend/src/ai/agents/policies/zReportAgentPolicy.ts` | Allow-list (22 read-only registry tools), budgets, prompt version, follow-up caps, fail-closed resolver |
| `backend/src/ai/agents/zReportContext.ts` | Business-date resolution (local calendar, round-trip validated), branch ownership validation, comparison windows, memory snapshot |
| `backend/src/ai/agents/zReportSignals.ts` | Batch 1/2/3 evidence collection, closing fold-in, anomaly→signal mapper |
| `backend/src/ai/agents/signalConflictDetector.ts` | Same-metric cross-source disagreement detection |
| `backend/src/ai/agents/evidenceMerger.ts` | EvidencePack assembly: dedup, conflicts, staleness, degradation, ML picture |
| `backend/src/ai/agents/zReportFollowUp.ts` | Bounded targeted follow-up (1 round, ≤4 tools, deterministic rules, `mlSemantics`) |
| `backend/src/ai/agents/zReportPrompts.ts` | LLM-facing projection (no tenant metadata), number grounding, schema, deterministic narrative, confidence |
| `backend/src/ai/agents/zReportCritic.ts` | Final critic (7 deterministic checks) + stale-only-number analysis |
| `backend/src/ai/agents/zReportAgent.ts` | Orchestrator (`generateDailySummaryIntelligence`) + persistence + observability |
| `backend/src/ai/agents/zReportRoutes.ts` | `POST /generate` HTTP surface |
| `backend/src/models/finance/DailySummaryEvidence.ts` | Per-run persisted evidence + validated report |
| `backend/src/ai/agents/__tests__/zReportPhase2.test.ts` | 25 tests — normalizers + context |
| `backend/src/ai/agents/__tests__/zReportPhase3.test.ts` | 29 tests — batches, conflicts, merge, isolation |
| `backend/src/ai/agents/__tests__/zReportPhase4.test.ts` | 30 tests — projection, grounding, follow-up, critic |
| `backend/src/ai/agents/__tests__/zReportPhase5.test.ts` | 10 tests — orchestrator, persistence, observability, isolation, route registration |
| `restaurant-pos/Frontend/src/components/finance/DailySummaryIntelligence.tsx` | "Generate Daily Summary" modal |
| `restaurant-pos/Frontend/src/components/finance/__tests__/DailySummaryIntelligence.test.tsx` | 6 component tests |
| `backend/docs/daily-summary-intelligence-report.md` | This report |

## 3. Files modified (all additive)

| File | Change |
| --- | --- |
| `backend/src/ai/intelligence/businessSignalTypes.ts` | +10 signal codes, +1 source (`cash_ledger`), +3 persisted-vocabulary map entries |
| `backend/src/ai/intelligence/businessSignalNormalizers.ts` | +`normalizeWastage`, +`normalizeCashClosing` (reusing the file's own helpers) |
| `backend/src/models/index.ts` | Export the new model + interface |
| `backend/src/server.ts` | 2 lines: import + mount `/api/ai/z-report` |
| `restaurant-pos/Frontend/src/api/client.ts` | +`generateZReportIntelligence`, +result types, `'/ai/z-report/generate'` added to the AI failure-reason map |
| `restaurant-pos/Frontend/src/components/finance/ZReportModal.tsx` | +1 button opening the separate AI modal; the deterministic report body is unchanged |

## 4. Files intentionally left unchanged

- `modules/reports/services/closingReportService.ts` (deterministic X/Z report) — **diff is empty**
- `modules/reports/controllers/reportsController.ts`, `GET /api/reports/closing/z` — untouched
- `models/finance/DailySummary.ts` — untouched (still the authoritative daily snapshot)
- `ai/shared/llmClient.ts`, `ai/tools/**`, `ai/intelligence/businessIntelligenceService.ts`, `ai/intelligence/mlSemantics.ts`, `ai/intelligence/recommendationExplanation.ts`, `ai/memory/*`, `ai/observability/agentUsage.ts` — reused as-is
- Marketing Agent, Opportunities, Advisory, inventory agent — untouched

## 5. Existing infrastructure reused (no duplicates introduced)

- **Tool registry / executor / resolver** — every batch and the follow-up run through the one shared registry; the follow-up resolves through the policy's fail-closed `resolveZReportAgentTools()`.
- **`investigateBusiness` + `defaultDimensionPlan`** — Batch 1/3 are that fan-out with a reordered/filtered plan (no second read path).
- **`closingReportService.zReport`** — the existing Z-report is the closing-fact source.
- **`salesReportService.summary`**, **`demandAnomalyService.detectAllDemandAnomalies`** — Batch 2 derivation.
- **Existing normalizers** — Batch 1/3 evidence is produced by the same `businessSignalNormalizers` functions.
- **`mlSemantics`** — the pure-ML tools' outputs are classified by the existing evidence builders (causal only when the upstream experiment gate passed).
- **`recommendationExplanation` helpers** — `stripUngroundedNumbers`, `malformedReason`, `hasUnsupportedCausalLanguage` drive the grounding layer.
- **`generateJsonWithMeta` (shared LLM client)**, **`loadMemoryContext`**, **`resolveBranchScope`**, **`AiError`**, **`recordLlmUsage` / `AIUsageLog`**, **`calculateCost`**, **`concurrencyGuardFor` / `intelligenceLimiter`**, **`requireAuth` / `requireRole` / `requireFeature`** — all reused.

## 6. API contract

```
POST /api/ai/z-report/generate
  auth:     requireAuth + requireRole('owner','manager','super_admin') + requireFeature('analytics')
  limits:   intelligenceLimiter + concurrencyGuardFor('z_report')
  body:     { date?: 'YYYY-MM-DD', branchId?: string, includeBatch3?: boolean | 'auto' }   // all optional
  200:      { success: true, result: DailySummaryResult }
  400:      malformed date / branchId / includeBatch3 (validated before any data read)
  4xx:      TOOL_TENANT_MISMATCH (foreign branch, invalid tenant) · TOOL_INPUT_INVALID (bad date)
```
`DailySummaryResult` = `{ runId, agent:'z_report', businessDate, branchId?, branchName?, report{headline,whatHappened,
whatMattered,needsAttention,focusNext,caveats}, reportSource:'llm'|'deterministic', reportDegradedReason?,
confidence, degraded, degradations[], evidence{signals,freshness,conflicts,unavailable,toolErrors,caveats,usable,
batch3Reason,followUpReason,ml?}, generation{…12 metrics…}, persisted, generatedAt }`.

`GET /api/reports/closing/z` is unchanged and remains the deterministic record.

## 7. UI behavior

`ZReportModal` (unchanged deterministic report) gains one additive panel: **“Generate Daily Summary”**
→ opens `DailySummaryIntelligence`, which
- fetches nothing until the owner clicks (`Generate Daily Summary` → `Generating…` → report),
- renders only server text: headline, What happened / What mattered / Needs attention / Focus next, notes,
- shows confidence, the evidence count, “Evidence-only summary” when the deterministic narrative was used,
- discloses unavailable sources (as friendly names), failed reads, cross-source disagreements and excluded stale readings,
- states plainly when no prediction was available,
- never renders internal identifiers (no tool names, normalizer keys, rule ids, signal codes or raw refs),
- on a null result shows the specific cause from `getLastAiFailureReason('/ai/z-report/generate')` + a Try Again button,
- resets to the pre-run state on close; re-generate always performs a fresh run.

## 8. Batch behavior

- **Batch 1 — core facts** (one parallel fan-out, 12 s budget): `getSalesTrends, getMenuPerformance,
  getProductMargins, getInventoryStatus, getExpiryRisk, getStockoutRisk, getCustomerSegments,
  getRetentionSignals, getActiveOffers, getOfferPerformance, getCampaignPerformance` **+ `getWastage`**
  (the canonical plan has no wastage dimension) **+ the deterministic closing facts**
  (`cash_over_short`, `sales_day_close`). Failures/unavailability are recorded, never hidden.
- **Batch 2 — deterministic intelligence**: previous-day deltas (growth/decline ≥10 %, volume/AOV
  divergence ≥10 % opposite signs, discount pressure ≥15 % of gross, refund spike ≥5 % of net, low-sample
  confidence 0.6 under 10 orders) + real demand anomalies mapped into existing codes (TIME_SLOT_* are
  deliberately unmapped and disclosed).
- **Batch 3 — conditional** (8 s budget): `getDemandForecast, getMarketBasketSignals, getFestivalContext,
  getSportsContext, getNearbyCompetition, getWeatherContext`, triggered on a ≥25 % day-over-day revenue
  move, wastage signals, sales decline or volume/AOV divergence; `true`/`false` force or skip. The reason
  is always recorded.
- **Follow-up — bounded**: 1 round, ≤4 tools, fixed rule table (movement→ML segments/uplift;
  conflict→response-model scores; wastage→market basket), never re-reads a tool an earlier batch used;
  ML outputs are classified by `mlSemantics`, not normalized into facts.

## 9. EvidencePack structure

`{ restaurantId, branchId?, businessDate, signals[BusinessSignal], conflicts{conflicts,checkedSignals,
conflictedMetrics}, dedupCollisions, staleSignals[], unavailable[], toolErrors[], caveats[], memoryDegraded?,
ml?{availableKinds,missingKinds,degradations,hasCausalEvidence}, freshness{}, sources{batch1,batch2,batch3,
followUp}, batch3Reason, generatedAt, usable }` — persisted as `DailySummaryEvidence.evidencePack`
(normalized signals with evidence refs; never raw tool payloads).

## 10. Validation / grounding behavior

1. The model receives a projected fact sheet with `E<n>` handles — **no** restaurantId/branchId/signalId.
2. Every number it writes must exist in the allowed set (pack values/baselines/changes, numbers inside
   evidence statements, the dates, evidence counts); anything else is stripped.
3. Broken sentences after stripping, unsupported causal language and schema violations force the
   deterministic narrative.
4. The **critic** then independently re-verifies: grounding, readability, causal safety, staleness
   (including "stale value presented as current"), must-address evidence (drawer variance, refunds,
   wastage, revenue decline, discounting), conflict disclosure, degradation disclosure, and "unusable pack
   must say so". Any blocking issue ⇒ deterministic narrative (`reportSource: 'deterministic'`,
   `reportDegradedReason: critic_repair:…`).
5. The deterministic narrative is grounded by construction (it reuses evidence statements verbatim) and
   passes the critic unmodified — asserted as an invariant.

## 11. Security / tenant guarantees

- `restaurantId` comes only from the authenticated context; never from the body/query/LLM.
- A requested `branchId` is validated with the shared `resolveBranchScope` **before any read**; a foreign
  or nonexistent branch ⇒ `AiError TOOL_TENANT_MISMATCH` (tested).
- Every emitted/persisted signal is scoped to the authenticated tenant (asserted for all batches).
- Persisted runs are keyed `{restaurantId, branchId, businessDate, runId}`; cross-tenant reads are
  impossible by construction and verified by test.
- The LLM never receives tenant/security metadata (asserted on the serialized fact sheet).
- Observability stores counts, tool names, statuses and a shape fingerprint hash — no prompts, no payloads.
- No cache exists in v1, so nothing can be served across tenants or dates. **Regenerate = fresh run.**

## 12. Tests executed and results

| Command | Result |
| --- | --- |
| `cd backend && npx vitest run src/ai` | **32 files, 536 tests — all pass** |
| Phase suites (`zReportPhase2/3/4/5`) | **94 new tests pass** (25 + 29 + 30 + 10) |
| `businessSignals` / `businessIntelligenceService` / `recommendationExplanation` / `remediationGuards` | pass (no shared-behavior regression) |
| `cd backend && npx tsc --noEmit` | **344 errors — exactly the pre-existing baseline; zero in any file this work created or touched** |
| `cd restaurant-pos/Frontend && npx tsc --noEmit` | **0 errors** |
| `cd restaurant-pos/Frontend && npx vitest run` | 306 passed / **7 failed — all in `auth/__tests__/LoginScreenConsent.test.tsx`, files untouched by this work (pre-existing)** |
| `DailySummaryIntelligence.test.tsx` | 6/6 pass |
| `cd restaurant-pos/Frontend && npm run build` | exit 0 (vite build + esbuild server) |

The Phase 5 suite exercises the real path end to end: real MongoMemoryServer, real bills, the real
deterministic `closingReportService` (which is why `cash_over_short`/`sales_day_close` appear from real
closing arithmetic), the real registry/executor, persistence and `AIUsageLog`; only the shared LLM client
is mocked (the same seam the repository's explanation tests use).

## 13. Known limitations

1. **Baseline is the previous calendar day only** (v1): no weekday-aligned or trailing-30d baseline for the
   day-over-day deltas. Disclosed in every report's caveats. (The canonical plan's own 30-day sources are
   still collected.)
2. **The anomaly mapper uses the real clock**: `detectAllDemandAnomalies` buckets by `createdAt` within a
   rolling window ending *now*, so a historical business date outside that window produces no anomalies
   (correctly disclosed as "no evidence"). Mapping itself is unit-tested against a synthetic anomaly.
3. **Pure-ML tools are evidence, not signals**: `getMLCustomerSegments`, `getUpliftSignals`,
   `getOfferResponseBatchScores` are classified by `mlSemantics` and surfaced as predictive evidence
   lines; they are not normalized into `BusinessSignal`s.
4. **`getProductCombinations` is allow-listed but not yet used** — it has no canonical normalizer and
   inventing one would duplicate existing infrastructure.
5. **Critic is deterministic** (per design decision); no LLM judge.
6. **No read-through cache / "latest report" endpoint**: each call is a fresh run; history is readable via
   the persisted collection (no API surface exposes it yet).
7. **No HTTP-level test with a real session** (the repo has no supertest and no route-level tests); the
   route is covered by registration assertions plus orchestrator integration tests. A live end-to-end run
   needs a MongoDB instance and a signed-in owner session.
8. **`reportDegradedReason`, `degradations` and the evidence counts are surfaced** but the UI deliberately
   renders counts/friendly names rather than raw audit strings.

## 14. Remaining TODOs

- Weekday-aligned / trailing-30-day baselines for the day-over-day deltas (would replace the v1 caveat).
- A `getProductCombinations` normalizer (or an explicit "raw evidence" path) so the follow-up can use it.
- A tenant-scoped `GET` for the latest/previous runs (the model and indexes already support it).
- Wire `recordAgentRun`-style audit rows if the pipeline ever becomes a bounded agent loop (it is not one
  today; `AIUsageLog` + the persisted run are the observability surface).
- Optional: promote the strongest signals into the existing `IntelligenceSignal` store via the existing
  persistence path (`PERSISTED_SIGNAL_TYPE_MAP` already maps the new codes).

---

## Assumptions made during implementation

1. **Comparison baseline** = previous calendar day only (v1); disclosed in caveats rather than silently
   approximated.
2. **Default business date** = *yesterday* in the store's LOCAL calendar (bills are stamped with local
   dates), matching the reports services' offset convention.
3. **Batch 1 includes the marketing facts** (`getActiveOffers`/`getOfferPerformance`/`getCampaignPerformance`)
   because "which promo was running" is a fact about the closing day; dropping it would make discount
   pressure and revenue movement uninterpretable.
4. **Wastage is a first-class daily dimension** even though the canonical plan omits it; it is a rolling
   operational window (≤60d), and its normalizer states that in the evidence.
5. **Batch 3 is conditional** on a fixed, documented trigger set (never on LLM opinion).
6. **Follow-up = 1 round, ≤4 tools**, chosen by a fixed rule table; only tools the run has not already used.
7. **Critic is deterministic in v1**; repair means "use the deterministic narrative", not "rewrite with AI".
8. **Every generation is a fresh run** (no cache); the unique index includes `runId`, so history accumulates.
9. **DB/network failures degrade, never throw** — only tenant/branch identity problems and malformed input
   throw.
10. **Currency** in owner copy is the Indian Rupee (₹), matching the existing marketing copy convention; the
    deterministic narrative states no currency symbol at all (it reuses evidence statements verbatim).
11. **`malformedReason`'s blunt `dangling_percent` rule is refined locally** (a percentage directly attached
    to a number is legitimate in a daily summary) without modifying the shared marketing behavior.
