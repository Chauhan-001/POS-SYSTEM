# ChitKuber Inventory Agent — Phase 1 Report

Date: 2026-10-04
Environment: local Windows host, real MongoDB (`mongodb://localhost:27017/pos`), real backend (`PORT=3011`), real LLM provider (`custom` / `openai/gpt-oss-20b`).
Tenant used for runtime proof: A = `6ac031900f636f7cc8ab6f8f` (Urban Tadka Kitchen), disposable verify owner account with production password hashing.
Route under test: existing `POST /api/ai/inventory-agent/recommend` with the additive `{ "agentic": true, "task": "…" }` option.

Status vocabulary: IMPLEMENTED · TESTED · RUNTIME VERIFIED · UI VERIFIED · BLOCKED · NOT IMPLEMENTED · PRE-EXISTING.

---

## 1. Scope — what this phase is and is not

This phase adds a SMALL agentic layer ON TOP of the existing inventory system. No second inventory system, no duplicated tools, no new business logic:

- The four existing read-only inventory tools are reused through the ONE shared Tool Registry.
- The EXISTING deterministic analyzer (`buildInventoryAgentResult`) remains the authority for every quantity, urgency, cost, days value and severity.
- The EXISTING shared bounded loop (`runBoundedAgentLoop`) drives tool selection; it was generalized (role prompt, prompt version, tool-data capture, stop guard) without changing the marketing agent's default behaviour.
- The EXISTING route is extended additively: without `agentic: true` the response is byte-shape identical to before (verified at runtime: same 10 keys, 10 purchase recommendations, `mode: "deterministic"`).

NOT built in Phase 1 (deliberate): write/approval tools, stored memory for inventory, a second scheduler, a new UI panel, a separate agent framework.

---

## 2. Files changed

| File | Change |
| --- | --- |
| `src/ai/agents/inventoryAgentic.ts` | NEW — agentic investigation: bounded loop → evidence from the EXACT tool outputs → existing deterministic analyzer → one grounded synthesis call → server-side validation (refs, numbers, authoritative rows). |
| `src/ai/agents/policies/inventoryAgentPolicy.ts` | NEW — allow-list (exactly the four read-only tools), budgets, role prompt, fail-closed resolution, read-only catalog. |
| `src/ai/agents/inventoryAgentRoutes.ts` | Additive `{ agentic, task }` branch; tenant rate limit + concurrency guard applied ONLY to agentic runs; correlation id from `x-request-id`; default path unchanged. |
| `src/ai/agents/loop/agentLoop.ts` | Generic options `rolePrompt`, `promptVersion`, `captureToolData`, `stopGuard`; agent-labelled rejections; one bounded retry helper exported for reuse; agent-neutral fallback wording. |
| `src/ai/shared/agentRunContext.ts` | `toolData` observation capture on the run memory (opt-in). |
| `src/ai/observability/agentUsage.ts` | Optional `feature` on usage rows; `agent` on audit rows. |
| `src/ai/agents/inventoryAgent.ts` | `InventoryAgentEvidence` widened so a source that was NOT investigated says `NOT_INVESTIGATED` honestly (no behaviour change). |
| `src/ai/agents/__tests__/inventoryAgentic.test.ts` | NEW — 28 tests (scenarios 1–6 + guards). |
| `src/ai/agents/__tests__/agentLoop.test.ts` | +2 stop-guard tests; feature assertion follows the running policy's agent. |

No migration, no schema change, no new dependency.

---

## 3. Policy, tools and budgets

- Allowed tools (exact): `getInventoryStatus`, `getStockoutRisk`, `getExpiryRisk`, `getWastage`. All are registered, tenant-scoped, `access: 'read'`.
- `getDemandForecast` deliberately NOT included: `getStockoutRisk` already consumes the demand forecast internally (recommended reorder quantity + predicted depletion date), so a second surface would add no authoritative information and would invite double-counting.
- Budget: maxSteps 4, maxToolCalls 6, durationMs 10 000, maxTokens 16 000, maxCostUsd 0.05. Fail-closed policy resolution (`TOOL_NOT_FOUND` before any LLM call).
- Read-only invariant: no write tool exists in the registry for this agent; a model request for a write tool is refused by the policy gate before execution (proved by test).

Flow actually executed at runtime:

```
owner task → bounded loop (LLM plans → policy gate → shared executor → compact observation fed back)
           → same observations captured (no tool re-execution)
           → EXISTING deterministic analyzer (authoritative values)
           → ONE synthesis call → server-side validation → owner-facing result
           → deterministic fallback whenever the loop or synthesis cannot complete
```

---

## 4. Runtime verification (real backend, real MongoDB, real provider)

All five task types were exercised end-to-end repeatedly (runs 3–8 of the runtime harness). Final run (paced provider calls):

| # | Task | HTTP / ms | mode | loop status | degraded | steps | toolCalls | llmCalls | tools chosen by the LLM |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | What inventory risks should I handle today? | 200 / 4760 | agentic | completed_sufficient | false | 1 | 4 | 1 | all four (status + stockout + expiry + wastage) |
| 2 | Which items are likely to stock out soon? | 200 / 3304 | agentic | completed_sufficient | false | 2 | 2 | 2 | stockout → **status (after the empty forecast)** |
| 3 | Which ingredients are close to expiry? | 200 / 3759 | agentic | completed_sufficient | false | 3 | 2 | 3 | expiry → status |
| 4 | Why is wastage a concern? | 200 / 5176 | agentic | completed_sufficient | true | 3 | 3 | 3 | wastage → status → expiry |
| 5 | Which inventory issue should I handle first? | 200 / 4514 | agentic | completed_sufficient | false | 2 | 4 | 2 | status + stockout + expiry + wastage |

Observed outputs (excerpts):

- Task 1 — `assessment: {title: "Inventory Reorder Urgency", priority: "critical"}`, issues grounded on `getInventoryStatus` (Chicken, Mixed Vegetables, Packaging, Paneer out of stock), `degraded: false`.
- Task 2 — after `getStockoutRisk` returned `available: false` (no forecast alerts for this tenant), the stop guard deferred the model's stop, the model called `getInventoryStatus`, and the answer became `assessment: "Immediate Stockout Risks"` with six grounded issues referencing **both** tools. Without the guard this task previously answered “no items are at risk of stockout” — a false negative while six items were out of stock.
- Task 5 — synthesis returned 10 issues; the server capped them to 8 and recorded `issues:truncated:10` (`degraded: false`), rather than discarding the whole synthesis.
- Task 4 — provider returned HTTP 429 for the synthesis; the response degraded explicitly (`degraded: true`, `degradedReason: "synthesis_rate_limited:429"`), shipping deterministic rows whose evidence refs name the tools that actually ran (`getInventoryStatus`).

Invariants checked on every runtime run:

- Every `evidenceRefs` entry names a tool that actually ran in that run.
- Authoritative reorder quantities/costs are identical to the deterministic endpoint's values (e.g. Chicken `90 kg` / `32062.5`; Paneer `36 kg` / `12240`).
- `evidenceSources` reflects the tools' own `available` flags — no source is ever reported as available when it returned no data.
- No chain-of-thought is returned or stored: `investigation.steps[].purpose` comes from a static map (`getInventoryStatus` → “Inspect current stock levels…” etc.).

Concurrency / throttling probe (separate runtime pass): 8 parallel agentic requests → `{"200":1, "429":7}` with body `{"error":"Too many intelligence requests for this restaurant. Please slow down.","code":"RATE_LIMITED"}`; 3 parallel deterministic requests → 3×200, proving the guards are applied to the agentic path only.

Backward compatibility (same run):

- `POST /api/ai/inventory-agent/recommend` with `{}` → `mode: "deterministic"`, 10 purchase recommendations, keys exactly: `evidenceSources, expiryRisks, generatedAt, mode, nextActions, purchaseRecommendations, status, stockoutPredictions, summary, wastageSignals`.
- Forged body `restaurantId: "000000000000000000000001"` → HTTP 200, `leaked=false`; the server tenant (JWT-derived) is the only tenant used.

---

## 5. Security and isolation

- Tenant scope comes exclusively from the authenticated context; LLM-supplied tenant keys are stripped by the shared `sanitizeToolArgs` (test), and a foreign `branchId` fails at the tool boundary with `TOOL_TENANT_MISMATCH` (test).
- Agentic runs only: tenant rate limit (`intelligenceLimiter`) + structured concurrency guard (`CONCURRENCY_LIMIT` with `retryAfter`). Deterministic callers keep their previous throttling.
- Authorization: `requireAuth`, `requireRole(owner|manager|super_admin)`, `requireFeature('inventory')` — unchanged.
- Write refusal: a tool name outside the allow-list is rejected at stage `policy` and never executed (TESTED). No write capability exists for this agent.

---

## 6. Observability (runtime-verified in MongoDB)

- `AIUsageLog`: rows with `feature: "inventory_agent"`, `promptVersion: "inventory-agent-v1"`, model/provider/latency/tokens, `errorType` on failures (e.g. `rate_limited`). Marketing rows remain labelled `marketing_agent` (32 rows verified untouched).
- Audit log: `action: "agent_run_completed"` with `details.agent: "inventory_agent"`, run id, request id, status, steps/toolCalls used vs limits, tool names, policy/budget rejections, uncertainty count, llmCalls, tokens, cost, error code — counts and tool names only, no prompt/CoT content.

---

## 7. Tests and typecheck

| Check | Result |
| --- | --- |
| `vitest run src/ai/agents/__tests__/inventoryAgentic.test.ts` | **28 passed** (0 failed) |
| `vitest run src/ai/agents/__tests__/agentLoop.test.ts` | **19 passed** (0 failed) |
| `vitest run src/ai --maxWorkers=1` | **25 files, 330 passed**, 0 failed |
| `npx tsc --noEmit` | 345 errors, **all PRE-EXISTING** (none in any changed file, verified by filtering the output) |

Scenario coverage (required 1–6): 1 status→stop; 2 status→stockout grounded in both tools; 3 expiry→status→wastage order chosen by the model (not a ladder); 4 invented reorder quantity 500 rejected (authoritative 80/`suggestedQty` wins, unsupported number stripped); 5 write tool rejected; 6 LLM unavailable → deterministic fallback with explicit mode.
Additional guards: tool-failure containment, malformed synthesis fallback, max-tool-call and max-step budgets, no chain-of-thought keys, unsupported-number stripping, ref repair, missing-ref rows dropped, empty-source vs no-risk distinction, synthesis 400 retry (once), 429 no-retry, truncation cap, NOT-investigated vs empty facts, baseline stop guard.

---

## 8. Requirement status

| Requirement | Status |
| --- | --- |
| LLM genuinely selects tools (dynamic, not a fixed ladder) | RUNTIME VERIFIED — different tool sets per task, including a second step triggered by an empty result (task 2) |
| LLM inspects results and requests more tools when needed | RUNTIME VERIFIED (task 2/3/4 multi-step) + TESTED (stop guard defers a premature stop, bounded by maxSteps) |
| Deterministic layer authoritative for quantities/severity/costs | RUNTIME VERIFIED — values equal the deterministic endpoint; model numbers stripped when ungrounded |
| Additive `{ agentic: true, task }` on the existing route | IMPLEMENTED + RUNTIME VERIFIED |
| Deterministic default unchanged for existing callers | RUNTIME VERIFIED (identical keys/rows; UI panel still works) |
| Read-only, no write tools, fail-closed policy | IMPLEMENTED + TESTED |
| Tenant/branch isolation, forged-body safety | RUNTIME VERIFIED + TESTED |
| Rate limit + concurrency guard on the agentic path | IMPLEMENTED + RUNTIME VERIFIED: 8 concurrent agentic calls → 1×200 + 7×429 `RATE_LIMITED`; 3 concurrent deterministic calls → 3×200 (guards are agentic-only, as designed). The structured `CONCURRENCY_LIMIT` path is PRE-EXISTING middleware runtime-proven on the marketing route in the previous phase; under a burst on this route the tenant rate limiter rejects first |
| Fallback explicit, observable, never fabricating | RUNTIME VERIFIED (`agentic` vs `deterministic_fallback`, `degradedReason`) |
| Observability (usage + audit, agent-labelled) | RUNTIME VERIFIED |
| No chain-of-thought returned/persisted | TESTED (static purpose map only) |
| Stored memory for inventory | NOT IMPLEMENTED (Phase 1 scope) |
| Owner approval → execution of a write action | NOT IMPLEMENTED (advisory only; every recommendation carries `requiresApproval: true`) |
| Inventory UI surfacing agentic fields | NOT IMPLEMENTED — the existing `InventoryAgentPanel` still renders the deterministic result; the agentic fields are API-only in Phase 1 (UI VERIFIED as unchanged/backward compatible) |
| Provider rate limiting (live gateway 429s) | ENVIRONMENTAL — bounded, explicit fallback; BLOCKED only in the sense that no run can guarantee a synthesis under bursty throttling |

---

## 9. The five key questions

1. **Did the LLM actually choose which inventory tools to run?** YES — RUNTIME VERIFIED. Across the five tasks the model chose different tool sets (all four; stockout-only then +status; expiry→status; wastage→status→expiry; status+stockout+expiry+wastage), and the choice changed between runs of the same task. No code path pre-executes a tool ladder for the agentic mode.
2. **Did it inspect results and ask for more evidence when needed?** YES — RUNTIME VERIFIED. In task 2 the forecast tool returned `available: false`, the server-side stop guard deferred the stop, and the model's next step called `getInventoryStatus`, after which the answer was grounded in both tools. Multi-step runs (2–3 steps) were observed on tasks 2, 3, 4 and 5.
3. **Did the deterministic layer stay authoritative for all inventory facts?** YES — RUNTIME VERIFIED. `purchaseRecommendations`, stockout/expiry/wastage rows, quantities, urgencies and costs in the agentic response are the existing analyzer's values (e.g. Chicken 90 kg / ₹32 062.5). The synthesis contract has no quantity/price fields at all, and numbers in model text that do not exist in the evidence are stripped before shipping.
4. **Did the agent avoid unnecessary calls?** YES, WITH ONE CORRECTION — RUNTIME VERIFIED. Task 1 stopped after one planning step with four tool calls (one per source, in parallel); task 5 needed two steps and four calls. Task 2 initially stopped too early (one empty tool) and produced a false “no stockout risk”; the stop guard now forces one more step when a source is empty and the stock baseline has not been read, after which the model completed in 2 steps. Budgets (max 4 steps / 6 tool calls / 10 s) bound every run.
5. **Was any inventory fact invented by the LLM?** NO — RUNTIME VERIFIED + TESTED. Three server-side defenses ran in production: (a) evidence refs are repaired to tools that actually ran or the row is dropped; (b) narrative numbers not present in the deterministic evidence are stripped (test: an invented “500” never appears); (c) every recommendation must match an authoritative deterministic row, otherwise it is dropped (`no_authoritative_row`). The only model-authored content that ships is the assessment text (grounded), issue/recommendation wording and prioritisation within the deterministic floor (`max(model, deterministic)`).

---

## 10. Limitations and next steps

- Provider throttling: the live gateway returns 429 in bursts; the agent degrades explicitly rather than retrying unboundedly. A production deployment should use a paid/queued provider tier for predictable synthesis.
- Tenant A has no expiry batches and no wastage rows, so expiry/wastage tasks legitimately answer “no data”. This is honest output, not a defect; richer tenants will exercise those paths with real rows.
- The synthesis layer can return an empty `issues`/`recommendations` list when it judges there is nothing to add; the authoritative arrays are always shipped alongside, so the owner never loses the deterministic findings.
- Phase 2 candidates: surface `assessment`/`issues`/`recommendations` in `InventoryAgentPanel`; add owner-approval → purchase-order flow behind an explicit confirmation; feed inventory episode/memory into the loop; add connector-level metrics (tool latency, fallback rate) to the audit row.
