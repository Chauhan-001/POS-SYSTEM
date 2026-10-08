# Marketing Agent Rebuild — Walking-Skeleton Report

Companion to [`00-audit.md`](./00-audit.md) and [`01-master-todo.md`](./01-master-todo.md).
Pass: **walking skeleton first** (owner decision) — one thin, real, end-to-end
`/analyze` path, verified through the real HTTP interface, before deepening.

Legend: **VERIFIED** (evidence below) · **NOT VERIFIED** · **BLOCKED**.

---

## 1. The architectural repair

The audit's central finding was that the existing agentic loop ran **in parallel
with** deterministic recommendation generation, so the agent's observations were
**discarded** before the recommendations were built (two independent
investigation paths, duplicated cost, no causal link between what the agent
learned and what the owner was told).

**Fix (VERIFIED in code + tests + live run):** the Marketing Manager runs the
shared bounded loop with `captureToolData: true`, and the orchestrator consumes
**the exact captured domain investigations** to build the Situation Model, feed
ranking and feed the critic. There is now **one** investigation whose result is
used downstream — proven by
`marketingAnalyze.test.ts › reads ONE domain per step … and returns the captured investigations`
and by the live run (§4), where 4 captured domains produced 36 findings that the
Situation Model reported.

## 2. What was built (all new files under `backend/src/ai/marketing/`)

| File | Role |
| --- | --- |
| `contracts.ts` | Target contracts + `.strict()` zod schemas. No chain-of-thought field exists anywhere. |
| `domains.ts` | Domain capability layer: **7 implemented** domains (sales, products, inventory, customers, marketing_history, context, ml) + **2 declared-only** (feedback, competition). Registered as `category:'domain'` tools in the ONE shared registry. |
| `signalScanner.ts` | Cheap deterministic pre-scan (sales/inventory/marketing) → compact digest. |
| `contextBuilder.ts` | Objective + pre-scan digest + memory snapshot, with the evidence-priority ladder enforced by `authoritative` vs `advisory` labelling. |
| `policy.ts` | Allow-list = the domain catalog (fail-closed), env-tunable budgets, Marketing Manager role prompt. |
| `marketingManager.ts` | Drives the **existing** `runBoundedAgentLoop`; stop guard; deterministic sequential fallback sweep. |
| `situationModel.ts` | Deterministic Situation Model: evidence-backed facts, contradictions surfaced, unavailable domains disclosed. |
| `directionPolicy.ts` | **Phase 8** — direction → engine promotion-type mapping; restricts generation; reports unrepresentable/unrealised directions. |
| `validationGate.ts` | **Authority layer** — deterministic checks the LLM cannot override; **real per-product** stockout + overlap reads. |
| `finalCritic.ts` | Strict-schema critic with number-grounding and an explicit deterministic fallback. |
| `memoryWriteback.ts` | **Phase 14** — one evidence-backed `agent_run` episode per analysis + one lifecycle event per recommendation. Never throws. |
| `outcomeLearning.ts` | **Phase 15** — measured outcomes folded into memory exactly once + arithmetic per-item demand/margin patterns. |
| `analyze.ts` | The canonical orchestrator (step 0 = learning, step 10 = memory write-back). |
| `__tests__/marketingAnalyze.test.ts` | 34 tests. |
| `__tests__/memoryAndLearning.test.ts` | 14 tests (Phases 14–15). |

Modified: `tools/registry/toolTypes.ts` (+`'domain'` category),
`agents/marketingAgentRoutes.ts` (+`POST /analyze`).

**Reuse, not duplication (VERIFIED):** `investigateBusiness` + 17 normalizers,
`generatePromotionCandidates`/`deduplicateCandidates`,
`isEconomicallySafe`/`rankAndDiversify`, `mlSemantics`, `detectPromotionFatigue`,
`loadMemoryContext`, `runBoundedAgentLoop`, `recordLlmUsage`/`recordAgentRun`,
`auditService`. No new registry, no new executor, no new economics.

## 3. Verification

| Check | Result |
| --- | --- |
| Backend `npx tsc --noEmit` | **344 = baseline, 0 new** (VERIFIED) |
| `npx vitest run src/ai/marketing` | **55/55 passed** (34 skeleton + 14 Phases 14–15 + 7 Phase 17 scenario matrix) (VERIFIED) |
| `npx vitest run src/ai` | **442/442 passed** in 28 files (387 baseline + 55 new, incl. the 7 Phase 17 cases; no cross-file interference from the new Mongo lifecycle + global tool registration) (VERIFIED) |
| `npx vitest run src/services/__tests__/promotionCandidateService.test.ts` | **11/11 passed** — the additive `types` restriction did not change existing callers (VERIFIED) |
| Frontend `tsc --noEmit` | **0 errors** (VERIFIED) |
| `npx vitest run src/components/marketing/__tests__` (Frontend) | **69/69 passed** in 3 files — 11 agentCopy + 15 RecommendationsPage + 43 DeepAnalysisPanel (Phase 16) (VERIFIED) |
| Full-run browser check of the deep-analysis panel | **BLOCKED** — the preview browser's session is expired (app-wide 401) and the webview produced no frames for a screenshot, so no visual check is claimed (§5) |

What the tests pin down (each is a rule that is easy to regress):
- a critic payload carrying `chainOfThought`/`thinking` is **rejected**;
- an unavailable domain is **never** "healthy", and an evidence-less fact is dropped;
- a contradiction between two domains is **surfaced**, not resolved;
- the stop guard refuses a whole-restaurant conclusion from one domain or none;
- the gate rejects on unsafe economics, stockout-on-target, untargeted win-backs;
- the critic strips a reason quoting a number absent from the factsheet;
- one domain per step, in the model's chosen order, with the investigations captured;
- a schema-defaulted `variance.contributionDiff = 0` is **not** learned as success
  (that would fabricate a signal from a row that was never measured);
- a measured outcome is linked into memory **exactly once** (the second pass
  scans zero rows because the first claimed them);
- a `control_vs_test` outcome is described as **incremental**, while a
  `pre_post` one is stored as an **association** and says so.

## 4. Live verification (real backend, real token, real tenant)

`POST /api/ai/marketing-agent/analyze` — tenant B (`…22f`), `lookbackDays:90`.
Response observed (authoritative, read from the API):

- **HTTP 200**; `status: completed_degraded`; `runId` returned; `approvalRequired: true`.
- Manager loop: **5 steps, 5 LLM calls, 4 domain investigations**, in the order
  `sales → marketing_history → customers → products` — i.e. genuinely **sequential**
  and chosen by the model, not a fixed ladder.
- Situation Model consumed the captured domains: `sales:ok(8)`,
  `marketing_history:ok(16)`, `customers:ok(12)`, `products:unavailable(0)`.
- Honest negatives: `products` listed in `unavailableDomains`; `feedback` and
  `competition` listed in `missingEvidence` as *capability declared but not
  implemented*; all 5 ML degradations disclosed; 4 investigated directions that
  matched no engine candidate were **reported, not forced into offers**.
- `0` recommendations because the candidate engine produced none for this tenant —
  disclosed as a **data gap**, not dressed up as a healthy business.

A second run (different goal) returned `status: completed_degraded` after the
model stopped early with a provider error; the evidence already gathered was
**used** rather than discarded, and the early stop was disclosed.

### Interface and isolation probes (live, VERIFIED)

| Probe | Result |
| --- | --- |
| `POST /analyze` with **no** Authorization header | **401** |
| `POST /analyze` with a client-supplied `restaurantId` in the body | **400** `INVALID_REQUEST` — `Unrecognized key: "restaurantId"` (tenant identity can never come from the client) |
| `POST /analyze` with an unknown body key | **400** |
| Existing `POST /intelligence` (Opportunities path) | **200** — untouched |
| Existing `GET /insight-runs` | **200** — untouched |

No temporary token/response files were left on disk.

## 4b. Phase 8 + Phase 10 deepening (live-verified)

**Phase 8 — directions now RESTRICT generation.** `generatePromotionCandidates`
takes an additive `types?: PromotionType[]`: sources whose builder can only emit
a disallowed type are **not detected at all**, so the restriction genuinely
constrains the engine rather than post-filtering it. An **empty** array means
“nothing is allowed” and returns nothing — it never silently falls back.

Live evidence (tenant B, `goal: "What should we promote to lift weekday covers?"`):

```
directionPolicy.applied        : true
directionPolicy.types          : [CREATE_PROMOTION, CREATE_COMBO, RUN_REACTIVATION]
unrepresentableDirections      : [retain_high_value]        ← reported, never a discount
realisedDirections             : [fill_weak_slots]
unrealisedDirections           : [lift_weak_category, win_back]  ← disclosed, never padded
fallbackUsed                   : false   (the restricted run DID produce a candidate)
```

So the engine ran on exactly the types the investigation directed; the retention
direction (which has no engine representation) was reported instead of being
forced into an offer; and one direction was genuinely realised.

**Phase 10 — real per-product feasibility.** `inventory_feasibility` now reads
`getStockoutRisk` and rejects a candidate whose targeted menu item is one of the
`contributingMenuItems` that consume an at-risk ingredient (naming the ingredient
and the days to depletion). `marketing_conflict` now reads `getActiveOffers` and
rejects a candidate whose product **or category** is already covered by a running
offer (naming the offer). Both go through the shared registry, so zod validation,
timeout clamping and tenant scoping are unchanged.

Live evidence:

```
validationSources.activeOffers : { status: "ok", detail: "16 active offer(s) checked for overlapping products/categories." }
validationSources.stockout    : { status: "unavailable", detail: "The stockout forecast had no usable input (NO_STOCKOUT_DATA) …" }
rejected                       : 1 → ECONOMICS_UNSAFE
```

The overlap check ran against the tenant's **16 real active offers**. The stockout
forecast was honestly reported `unavailable` for this tenant (no recipe/consumption
history) and the candidate was **not** failed on missing data — the check reports
`skipped` and the reason is disclosed. `validationSources` is now part of the
response so a skip can never be mistaken for a pass.

## 4c. Phase 14 + Phase 15 deepening (live-verified)

**Phase 14 — every analysis becomes a learnable episode.** The orchestrator reads
context first and, once the shortlist is final, writes one `agent_run` episode
plus one `recommended` lifecycle event per surviving recommendation. The write is
never allowed to masquerade as success: `memoryWrite.attempted` is only set once
the write has actually been attempted, and a failure pushes
`memory write-back failed: …` onto `degradations`.

Live evidence (tenant B, real HTTP):

```
memoryWrite : { attempted: true, episodeWritten: true, episodeId: "6ac46cfe9dc0b60735aa94c6", recommendationsRecorded: 0 }
memory      : { episodes: 0, longTerm: 0, degraded: false }   ← before any prior run
```

and on the next run the same tenant read back `memory.episodes: 2` then `3`, so the
loop closes: what one run writes, the next run's context builder loads. The stored
episode carries the objective, situation facts, investigation telemetry and
degradations — **no prompt, no raw model output, no chain-of-thought**.

**Phase 15 — measured outcomes feed the next run, exactly once.** A single
`control_vs_test` measured `RecommendationOutcome` row was seeded, then `/analyze`
was called twice:

```
run 1 → outcomeLearning: { outcomesLinked: 1, outcomesPositive: 1, outcomesNegative: 0,
                           outcomesUnusable: 0, causalOutcomes: 1 }
run 2 → outcomeLearning: { outcomesLinked: 0, … }            ← already claimed
```

The stored memory episode is grounded in the real numbers and labels its own
causality correctly:

```
"Measured percentage outcome (control_vs_test, status measured). contribution vs
 expectation: +2400. Measured against a control group, so this is an incremental effect."
metrics: { orders: 240, revenue: 96000, contribution: 21000, redemptionRate: 18.5,
           baselineValue: 88000, contributionDiff: 2400, orderUpliftPercentDiff: 7.5 }
```

Exactly-once is enforced by an **atomic claim** (`updateOne({_id, memoryLinkedAt:
null}, {$set:{memoryLinkedAt}})`); `memoryLinkedAt` was verified set on the row, and
the seeded row plus the episode it produced were both deleted after the probe.

**Bug found and fixed in the PRODUCTION code (not the test).** `verdictForOutcome`
was learning a *positive* outcome from `variance.contributionDiff = 0` — but the
`RecommendationOutcome` schema **defaults** that field to `0`, so a row that was
never measured is indistinguishable from a measured zero delta. A zero delta now
yields **no verdict**: the row is counted `unusable` and deliberately left
**unclaimed**, so it can be learned from later, once real variance exists. Nothing
is fabricated in the meantime.

**Deliberately not implemented:** feedback-trend learning. The feedback domain is
declared-only, so there is no satisfaction signal to learn from, and every run
discloses `feedback-trend learning is not implemented (feedback domain is declared
only)` rather than inventing one.

## 4d. Phase 16 deepening — the owner-facing surface (test-verified)

`DeepAnalysisPanel.tsx` renders the canonical `/analyze` result, and
`RecommendationsPage` mounts it as **its own section**. The two pre-existing
intelligence surfaces (AI Insights, Recommended Actions) and the offer-engine
"Opportunities for you" cards are untouched, and a test pins that the page still
loads all three exactly as before.

Three properties worth calling out, because they are the ones that keep the
surface trustworthy:

1. **The authoritative gate cannot be routed around from the UI.** A candidate
   whose `validation.passed` is false renders as **Blocked** with the readable
   reason, and its Approve button is disabled.
2. **A skipped check never reads as a pass** — the per-card checks render
   "Not checked", and the run block states plainly whether feasibility was
   actually assessed.
3. **Nothing internal leaks.** The real payload's evidence refs look like
   `signal:sales_revenue_level:80022f:restaurant`; they are translated to owner
   language, and a test asserts neither the ref form nor the tenant id appears
   anywhere in the DOM.

Verified by tests rather than by eye: frontend `tsc --noEmit` 0 errors and
`npx vitest run src/components/marketing/__tests__` **69/69**. Six of those tests
render a **verbatim live response** captured into
`__tests__/fixtures/realAnalyzeResponse.ts`, so a backend contract change fails the
suite instead of silently breaking the report.

**What is NOT verified:** the panel was seen to mount in the running app and render
its empty state, but the full interactive run could not be completed in the browser
— that profile's session is expired (401 on every app request), no credential for
the tenant was available, and no screenshot could be composited. No visual check is
claimed. The per-card actions (Approve → Draft, Ignore, Review) are covered by unit
tests only, since this tenant's engine returns 0 recommendations to act on.

## 5. NOT VERIFIED

- **8–10 recommendations output.** The live tenant has no candidate data, so the
  full shortlist has never been observed end-to-end. `NOT VERIFIED`.
- **`/proposal` still creating a pending draft from an `/analyze` recommendation.**
  The existing route was not exercised in this pass. `NOT VERIFIED`.
- **`memoryWrite.recommendationsRecorded > 0`.** The per-recommendation lifecycle
  event has never been written live, because the live tenant's candidate engine
  produces 0 candidates. The event shape is unit-tested only. `NOT VERIFIED`.
- **`consolidateProductPatterns` writing a live pattern.** This tenant has 0 items
  with enough trading history for percentiles (needs 3), so only the honest
  shortfall reason (`only 0 item(s) had enough trading history…`) has been
  observed live. Arithmetic path is unit-tested. `NOT VERIFIED`.
- **Stockout feasibility rejection live.** This tenant has `NO_STOCKOUT_DATA`, so
  the check always reports `skipped`; the rejection itself is proven by test
  against the authoritative shape. `NOT VERIFIED` live (see §6).
- **Visual/interactive browser check of the Phase 16 panel.** The panel was confirmed to MOUNT in the running app and render its empty state, but the session in that browser profile is expired (`401` on every app request), no credential for the tenant was available, and I deliberately did not swap in another tenant's demo login or re-pin a PIN; the preview webview also produced no composited frames, so no screenshot exists. `NOT VERIFIED` visually. What IS verified: `tsc` 0 errors, 69 frontend marketing tests green, and six tests that render a VERBATIM live `/analyze` payload (`__tests__/fixtures/realAnalyzeResponse.ts`) — so contract drift or a leaked internal ref would fail the suite.
- **The deep-analysis per-card actions against a live run.** Approve → Draft, Ignore, Review details and the Blocked path are proven by unit tests; none has been exercised against a real `/analyze` response because this tenant's engine returns 0 recommendations.
- **The full scenario matrix (Phase 17).** IN PROGRESS and partial by design. The harness, the runner, the no-silent-skip guard and 5 cases (the four honest-negative cases plus cross-tenant blindness) are green, but the spec's §27 list of 20 scenarios and 11 cross-dimensional combinations is **not in this repository or its git history**, so the remaining rows are empty rather than invented. See `03-scenario-matrix.md`. `NOT VERIFIED` for anything beyond the implemented cases — including a RICH-data tenant producing real recommendations, and the scripted-LLM orchestrator path (sequential domain order + stop-guard refusals), which today is proven at the loop level rather than end to end.
- **Removal of the superseded path** (Phase 18). Deliberately not done: the
  canonical path must be proven first, and the old `/recommend` + `/intelligence`
  routes are untouched and still working.

## 6. BLOCKED

- **Feedback Intelligence** — no feedback ingestion (owner will add a RAG system).
  Declared only; disclosed in every response. `BLOCKED` by owner decision.
- **Competition Intelligence** — no competitor provider; directory scraping is out
  of scope. Declared only. `BLOCKED` by owner decision.
- **Deep multi-step investigations are flaky in this environment.** Only ~2 of the
  9 configured Groq keys authenticate and the valid ones intermittently return
  `rate_limited`, so a run can stop early. This is an ops/key-pruning issue, not a
  code defect: the path degrades honestly and uses whatever evidence it gathered.
  `BLOCKED` on provider credentials.

## 7. Next (in order)

1. Phase 17 (in progress): fill the matrix from the spec's §27 list — one registry
   entry per scenario, `specRef` recorded. `03-scenario-matrix.md` holds the table.
2. Phase 18: remove the superseded path only after 14–17 are proven.

Phases 8, 10, 14, 15 and 16 are done; 8/10/14/15 are live-verified (§4b, §4c) and 16
is verified by tests + a real-payload fixture, with its visual browser check blocked
on an expired session (§5). Phase 17's harness and honest-negative cases are green
but the matrix is incomplete pending §27. The remaining gaps in §5 are data gaps of
the live tenant, one environment blocker, and that one missing input document — not
untested code paths.
