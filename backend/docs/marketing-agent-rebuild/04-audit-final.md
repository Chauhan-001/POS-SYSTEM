# Marketing Agent — Post-Implementation Audit

Status date: 2026-10-06 · repo `C:/Loyalty_POS system`, branch `master` · uncommitted work tree
Scope: the Marketing Agent as it exists on disk **today**, after Phases 0–16 plus partial 17.

Method: every claim below was read from the file cited next to it, or produced by the command
shown. Nothing is carried over from memory or from an earlier report. Where a claim could not be
proven, it is marked **NOT VERIFIED** or **BLOCKED** rather than softened.

Companion documents: [`00-audit.md`](./00-audit.md) (pre-implementation), [`01-master-todo.md`](./01-master-todo.md),
[`02-skeleton-report.md`](./02-skeleton-report.md), [`03-scenario-matrix.md`](./03-scenario-matrix.md).

---

## 0. Baselines re-measured for this audit

| Check | Command | Result |
| --- | --- | --- |
| Backend typecheck | `cd backend && npx tsc --noEmit` | **344 errors** — identical to the pre-work baseline; none in `src/ai/marketing/**` |
| Marketing module suite | `npx vitest run src/ai/marketing --maxWorkers=1` | **55/55 passed** in 3 files |
| Full AI suite | `npx vitest run src/ai --maxWorkers=1` | **442/442 passed** in 28 files |
| Frontend typecheck | `cd restaurant-pos/Frontend && npx tsc --noEmit` | **0 errors** |
| Frontend marketing suite | `npx vitest run src/components/marketing/__tests__` | **69/69 passed** in 3 files |

The 344 pre-existing backend errors are not this work's, but they remain a real project risk: a
typecheck that can never be green cannot gate a release.

Two of those errors mention `IRecommendationOutcome` and would otherwise look like fallout from
editing that model, so they were checked rather than assumed: `intelligenceController.ts:21` and
`promotionStrategyProfileService.ts:14` both do a **default** import of the mongoose model and then
use the name as a *type* (`IRecommendationOutcome[]`) — a pre-existing mistake independent of this
work. The diff to `RecommendationOutcome.ts` adds a field and a comment and changes no export or
import (`git diff` on that file shows no `import`/`export` line), and the interface is still
exported at line 196. The error count is identical to the pre-work baseline (344 → 344) and
`grep` confirms none in `src/ai/marketing/**`.

`src/services/__tests__/promotionCandidateService.test.ts` re-run for this audit: **11/11 passed**
— the additive `types?: PromotionType[]` option is inert for existing callers.

---

## 1. Verdict

The canonical Marketing Agent path exists, is wired to a real HTTP route, and is honest by
construction: it refuses to conclude from missing data, it carries evidence references on every
claim, and its economics are owned by deterministic services rather than a model.

**It is not yet a proven end-to-end product**, for one root reason: **no run has ever produced
the 8–10 recommendations the design targets** (§6). Everything downstream of candidate
generation — ranking output, the critic on real candidates, approval from a real recommendation,
outcome measurement, learning — has therefore been exercised only against fixtures, never against
a live populated restaurant.

The single largest structural item from the original audit (a duplicated investigation) is
**half-fixed**: the new path consumes one investigation, but the old `POST /recommend` agentic
investigation is still mounted, still wired into the UI, and still runs on the same page load
(§5).

---

## 2. The canonical flow as implemented

`POST /api/ai/marketing-agent/analyze` → `runMarketingAnalyze` ([analyze.ts](../src/ai/marketing/analyze.ts)).

| # | Step | Where | Note |
| --- | --- | --- | --- |
| 0 | Learning BEFORE context | `analyze.ts:89` | `linkMeasuredOutcomesToMemory` + `consolidateProductPatterns`; this run already benefits from the last |
| 1 | Context | `analyze.ts:111` → [contextBuilder.ts](../src/ai/marketing/contextBuilder.ts) | objective + cheap scan digest + memory, labelled `authoritative` vs `advisory` |
| 2 | Marketing Manager (sequential) | `analyze.ts:121` → [marketingManager.ts](../src/ai/marketing/marketingManager.ts) | one DOMAIN per step via the shared bounded loop; deterministic sweep fallback |
| 3 | Situation model | `analyze.ts:157` → [situationModel.ts](../src/ai/marketing/situationModel.ts) | built FROM the captured investigations, not a second investigation |
| 4 | Candidate engine (restricted) | `analyze.ts:166` → [directionPolicy.ts](../src/ai/marketing/directionPolicy.ts) | directions narrow the engine's allowed promotion types |
| 5 | ML enrichment | `analyze.ts:213` | bounded; non-causal unless the upstream gate passes |
| 6 | Deterministic validation (AUTHORITY) | `analyze.ts:222` → [validationGate.ts](../src/ai/marketing/validationGate.ts) | 7 checks; real per-product stockout + live-offer overlap reads |
| 7 | Ranking + strategy diversity | `analyze.ts:231` | 8–10 target, shortfall disclosed |
| 8 | Final critic | `analyze.ts:253` → [finalCritic.ts](../src/ai/marketing/finalCritic.ts) | strict schema, number grounding, deterministic fallback |
| 9 | Assemble status/confidence/risk | `analyze.ts:335` | confidence = `0.5*situation + 0.5*mean(rec confidences)` |
| 10 | Memory write-back | `analyze.ts:443` → [memoryWriteback.ts](../src/ai/marketing/memoryWriteback.ts) | one episode + per-recommendation lifecycle events |
| 11 | Observability | `analyze.ts:467` | counts only — never prompts, payloads or chain-of-thought |

**The architectural repair is real and verifiable in code:** step 2 captures the tool data and
step 3 consumes exactly that (`captureToolData: true` + `investigationsFromMemory`), so there is
one investigation whose result is used downstream rather than two independent ones.

### Routes mounted ([marketingAgentRoutes.ts](../src/ai/agents/marketingAgentRoutes.ts))

| Path | Line | Role | Status |
| --- | --- | --- | --- |
| `POST /recommend` | 67 | old agentic insight (System #2) | live, superseded, still called by the UI |
| `POST /analyze` | 105 | **canonical** deep analysis | live, owner-invoked |
| `POST /intelligence` | 147 | deterministic pipeline (System #3) | live, superseded, still called by the UI |
| `GET /insight-runs` | 190 | replay list | live |
| `GET /insight-runs/:runId` | 212 | one replay episode | live |
| `POST /proposal` | 245 | recommendation → pending draft | live; the only path to action |

All are behind `requireAuth` + `requireRole('owner','manager','super_admin')`; `/analyze` adds the
existing `intelligenceLimiter` + `intelligenceConcurrencyGuard`.

---

## 3. Module inventory

| Module | Responsibility | Verified by |
| --- | --- | --- |
| [contracts.ts](../src/ai/marketing/contracts.ts) | the vocabulary; `.strict()` zod for the LLM-facing parts; **no chain-of-thought field exists** | unit: a critic payload smuggling `chainOfThought`/`reasoning` is rejected |
| [domains.ts](../src/ai/marketing/domains.ts) | **9 domain capabilities = 7 implemented + 2 declared-only** (`feedback`, `competition`), registered as `category:'domain'` tools in the ONE shared registry | unit: every spec is registered, `access:'read'`, catalog marks 2 as `implemented:false` |
| [signalScanner.ts](../src/ai/marketing/signalScanner.ts) | cheap pre-scan (sales/inventory/marketing) → compact digest | unit |
| [contextBuilder.ts](../src/ai/marketing/contextBuilder.ts) | objective + digest + memory with the priority ladder | unit |
| [policy.ts](../src/ai/marketing/policy.ts) | allow-list = the domain catalog, resolved fail-closed; env-tunable budgets; role prompt | unit + live |
| [marketingManager.ts](../src/ai/marketing/marketingManager.ts) | drives the existing bounded loop; stop guard; deterministic sweep | unit + live |
| [situationModel.ts](../src/ai/marketing/situationModel.ts) | evidence-backed facts, surfaced contradictions, disclosed unavailable domains | unit + live |
| [directionPolicy.ts](../src/ai/marketing/directionPolicy.ts) | direction → engine promotion types; reports unrepresentable/unrealised | unit + live |
| [validationGate.ts](../src/ai/marketing/validationGate.ts) | 7 deterministic checks; real per-product reads; `skipped` never silent | unit + live (partial, §6) |
| [finalCritic.ts](../src/ai/marketing/finalCritic.ts) | strict-schema critic, number grounding, explicit fallback | unit |
| [analyze.ts](../src/ai/marketing/analyze.ts) | orchestrator | unit + live |
| [memoryWriteback.ts](../src/ai/marketing/memoryWriteback.ts) | episode + lifecycle events; never throws | unit + live |
| [outcomeLearning.ts](../src/ai/marketing/outcomeLearning.ts) | measured outcomes → memory exactly once; arithmetic product patterns | unit + live |

### Boundaries — all four hold in code

1. **Tenant identity never comes from the client.** `ai.tenantContextFromRequest(authReq)` is the
   only source; `AnalyzeRequest` is `.strict()`, so a body-smuggled `restaurantId` is a 400.
   Verified live earlier in this programme (401 unauthenticated, 400 on body-smuggled tenant,
   400 on an unknown key).
2. **The model cannot widen its own permissions.** `resolveMarketingManagerTools()` →
   `resolveAllowedTools` over a 9-entry domain catalog, fail-closed. The manager sees DOMAINS, not
   the 22 raw tools the old agent saw.
3. **The model is never the source of truth.** Economics come from
   `promotionCandidateService`; validation from `validationGate`; ranking from
   `recommendationRanking`. The critic can only move confidence **downward**
   (`confidenceDelta: z.number().max(0)`).
4. **No hidden reasoning is storable or returnable.** No contract field exists for it, zod
   `.strict()` rejects one at runtime, and the UI test feeds a smuggled `chainOfThought` through
   and asserts it never reaches the DOM.

### What `/analyze` writes

It creates **no business artifacts** — no offer, campaign, promotion or proposal (`grep` for
`.create(` / `insertMany` / `save()` in `analyze.ts` returns nothing). Its writes are
memory-only: one `agent_run` episode, `recommended`/`outcome_*` lifecycle events,
`product_performance_pattern` long-term rows, and the `memoryLinkedAt` claim on
`RecommendationOutcome`. Approval remains the only path to action.

### Budgets ([policy.ts](../src/ai/marketing/policy.ts))

`maxSteps` 8 · `maxToolCalls` 9 (= one investigation per domain) · `durationMs` 120 000 ·
`maxTokens` 120 000 · `maxCostUsd` 0.50 — all env-overridable
(`MARKETING_MANAGER_MAX_STEPS`, `..._MAX_DOMAINS`, `..._TIMEOUT_MS`, `..._MAX_TOKENS`,
`..._MAX_COST_USD`). Observation rendering is clipped to 2 400 chars.

---

## 4. Blast radius outside the new module

Deliberately minimal, and each is additive:

| File | Change | Risk |
| --- | --- | --- |
| `ai/tools/registry/toolTypes.ts` | `+ 'domain'` category | low — a union widening |
| `services/promotionCandidateService.ts` | `+ types?: PromotionType[]` (additive; sources that can only emit a disallowed type are not detected at all; empty array = nothing allowed, never a silent fallback) | **verified inert for existing callers** — `promotionCandidateService.test.ts` re-run for this audit at 11/11. The wider `src/services` suite (526/526) was verified earlier in this programme, not re-run here |
| `models/intelligence/RecommendationOutcome.ts` | `+ memoryLinkedAt` + one index | low |
| `ai/memory/memoryTypes.ts` | `+ 'product_performance_pattern'` | low |
| `ai/agents/marketingAgentRoutes.ts` | `+ POST /analyze` | low — additive route |
| Frontend `client.ts`, `agentCopy.ts`, `RecommendationsPage.tsx` | `+` analyze types/fetcher, `+` copy helpers, `+` one panel | low — existing sections untouched and pinned by tests |

---

## 5. The duplicate investigation is only half resolved

`RecommendationsPage.tsx` still auto-runs **both** legacy endpoints on first paint, and now also
offers the new one:

```
AI Insights          → runMarketingInsights()      → POST /recommend      (advisory, superseded)
Recommended Actions  → runMarketingIntelligence()  → POST /intelligence   (superseded)
Deep Analysis        → runMarketingAnalyze()       → POST /analyze        (canonical, owner-invoked)
Opportunities for you→ pre-existing offer engine
```

Consequence: a single page load can still trigger two overlapping investigations of the same
restaurant, which is the exact cost duplication `00-audit.md` opened with. The new path does not
depend on either, so removing them is a UI decision, not an architectural one — that is Phase 18,
and it is correctly still `[ ]` rather than done.

---

## 6. Verification status

### VERIFIED live (real HTTP, real token, real tenant)

- `/analyze` returns 200 with a full `AnalyzeResponse`; `approvalRequired: true`.
- Manager runs **sequentially**, one domain per step, order chosen by the model (observed
  `sales → marketing_history → customers → products`).
- Situation model consumes exactly those captured investigations.
- Declared-only domains and ML unavailability are disclosed; `feedback`/`competition` never
  produce a fact.
- Direction policy restricts generation and reports unrepresentable/unrealised directions.
- Validation reads the tenant's 16 real active offers; stockout reports `unavailable` rather than
  failing the candidate on missing data.
- Interface/isolation: 401 unauthenticated, 400 on body-smuggled tenant, 400 on unknown key;
  `/intelligence` and `/insight-runs` still 200.
- Memory write-back: `episodeWritten: true`, and a later run reads it back (`memory.episodes`
  grew 2 → 3).
- Outcome learning: with one seeded measured row, run 1 linked 1 (`causalOutcomes: 1`), run 2
  linked 0 with `memoryLinkedAt` set — exactly-once, proven end to end.

### VERIFIED by test only

- The critic on real candidates (schema rejection, number stripping, fallback).
- The full 7-check validation gate including `skipped ≠ pass`.
- Tenant B blindness for the analyze path.
- The Phase 16 panel, including a verbatim live payload (`__tests__/fixtures/realAnalyzeResponse.ts`).
- The Phase 17 honest-negative scenarios + the no-silent-skip guard.

### NOT VERIFIED

- **8–10 recommendations.** Never observed: this tenant's engine produces 0 candidates. The
  shortfall is disclosed, never padded — but the headline deliverable is unproven.
- **`/proposal` from an `/analyze` recommendation.** No recommendation has existed to approve.
  The Approve button is unit-tested; the route requires only `{id,type,title}`
  ([marketingAgentRoutes.ts:255](../src/ai/agents/marketingAgentRoutes.ts#L255)), which the analyze
  payload carries — but that is code reading, not a live run.
- **`memoryWrite.recommendationsRecorded > 0`** — never, for the same reason.
- **`consolidateProductPatterns` writing anything live** — tenant has 0 items with enough history.
- **Stockout rejection live** — `NO_STOCKOUT_DATA` on this tenant; proven by test against the
  authoritative shape.
- **Phase 16 visual check** — the panel was seen to mount and render its empty state in the
  running app, but the profile's session was expired (401 app-wide) and no screenshot could be
  composited.
- **Phase 17 matrix** — 5 cases implemented; the spec's §27 list is not in the repo or its git
  history, so the remaining scenarios are unimplemented, not skipped.

### BLOCKED

- **Feedback Intelligence** — no implementation by owner decision; declared-only and disclosed in
  every response. Nothing may be concluded about guest satisfaction.
- **Competition Intelligence** — no provider; scraping out of scope. Same treatment.
- **LLM provider fragility** — only ~2 of 9 configured Groq keys authenticate and valid ones
  intermittently rate-limit, so runs can stop early. Handled honestly (`completed_degraded`,
  evidence retained) but it caps how deep a live run gets.

---

## 7. Gaps and risks, in priority order

1. **No populated-tenant coverage — the top risk.** The engine, gate and critic have never run
   against a restaurant with real orders. A defect in candidate generation or ranking would not
   have been seen. A rich-data scenario (seed orders/offers/history) would close most of this
   without needing a live tenant.
2. **The target output is unproven.** 8–10 recommendations, and everything downstream of them, is
   the product's headline promise and remains `NOT VERIFIED`.
3. **Duplicate investigation still live** (§5) — cost and confusion, not correctness.
4. **344 pre-existing backend typecheck errors** — no green typecheck gate exists project-wide.
5. **Provider fragility** — with 2 working keys the system degrades often; degradation is honest
   but frequent.
6. **Phase 17 incomplete** — scenario coverage is partial pending the spec's scenario list.
7. **`recommendationCandidateService` / recipe-level memory** noted as extensible in
   `00-audit.md` MISSING #3 remains only partly addressed (product patterns exist; the feedback
   half is deliberately absent).

### What is *not* a risk

No chain-of-thought is stored or returned; the LLM cannot override validation; tenant identity
cannot come from the client; the manager cannot widen its tool surface; memory never outranks
current facts (the context builder labels the two tiers). Each of these is enforced in code and
pinned by a test.

---

## 8. Recommended next actions

1. Add the **rich-data scenario** to the Phase 17 matrix — the highest-value unblocking step,
   requiring no external input.
2. Obtain the **spec's §27 list** and fill the matrix; until then scenario coverage is partial.
3. Run **`/proposal` from a real analyze recommendation** on a tenant that produces candidates.
4. Only then **Phase 18**: remove `/recommend` + the second page-load investigation.
5. Treat the **344 backend errors** as a separate, pre-existing remediation track.

---

## 9. Limitations of this audit

- It is a **code-and-test audit**: it reports what the code does and what the tests prove. It is
  not a runtime audit of a populated production tenant — no such run exists (§6).
- Performance was not profiled. Budgets and timeouts are configured and enforced, but no latency
  or cost measurement per run is included here; live runs observed in this programme took 3–5 s
  and are not a representative sample.
- Cost accounting is whatever the existing observability records (`tokensUsed`, `costUsd` on the
  investigation summary); it was not independently reconciled against provider billing.
- Claims about the frontend are DOM/test-level only, for the reason in §6.
