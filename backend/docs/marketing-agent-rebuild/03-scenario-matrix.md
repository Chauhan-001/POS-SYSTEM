# Marketing Agent Rebuild — Phase 17 Scenario Matrix

Companion to [`00-audit.md`](./00-audit.md), [`01-master-todo.md`](./01-master-todo.md)
and [`02-skeleton-report.md`](./02-skeleton-report.md).

Status: **IN PROGRESS** — the harness, the registry and the honest-negative cases are
implemented and green. The spec's §27 list (20 scenarios + 11 cross-dimensional
combinations) is **not present in this repository or its git history**, so the matrix
is deliberately left partially filled rather than invented.

How every scenario runs (see `__tests__/scenarios.harness.ts`):

```
scenario seed (real rows)  →  runMarketingAnalyze (REAL canonical path)
                           →  domain capabilities → situation model
                           →  candidate engine → deterministic gate
                           →  ranking → final critic
```

against a real **in-memory MongoDB** (`MongoMemoryServer`) with the LLM stubbed.

- `disableLlm: true` exercises the documented deterministic fallbacks, including the
  no-model critic — so the whole matrix runs in CI with no provider and no keys.
- `llm` / `criticLlm` accept a scripted model for cases that need one.
- **No layer is mocked.** Mocking a domain capability would defeat the purpose: the
  matrix exists to prove the behaviour of the code the owner's request actually runs.

Two rules the suite enforces on itself:

1. **No silent skip.** Each registered case must make at least one assertion; a case
   that runs without asserting anything fails. The predicate itself is pinned by a
   test, so the guard can never quietly become vacuous.
2. **Evidence-grounded or disclosure-only assertions.** A scenario may assert that the
   system said something honest, or that it refused to fabricate. It may never assert a
   flattering rewrite of the data.

---

## 1. Implemented cases

Run: `cd backend && npx vitest run src/ai/marketing/__tests__/scenarios.test.ts --maxWorkers=1`

| id | axis | what it pins |
| --- | --- | --- |
| `new_restaurant_empty_database` | new restaurant × empty database | 0 recommendations; status `degraded_no_llm`, never `completed`; feedback + competition disclosed; confidence ≤ 0.5; risk never `low` |
| `no_trading_history_with_menu` | existing restaurant × menu but no trading history | 0 recommendations from a menu that has never sold; the deficient areas are enumerated; the run stays usable (`status !== 'failed'`) |
| `ml_unavailable_disclosed` | ml unavailable × deterministic path intact | every missing ML source is named; the deterministic path still completes; no confidence inflation |
| `conflicting_evidence_surfaced` | two readings of the same subject × disagreement | the real situation-model logic **surfaces** the disagreement ("were not resolved automatically") instead of resolving it; and through the real path, agreement never manufactures a contradiction |
| `cross_tenant_blindness` | cross-dimensional × tenant isolation | tenant A's entire serialized response contains none of tenant B's rows, offer or campaign, and not tenant B's restaurant id |

Two non-case tests: the registry is well-formed (unique stable ids, non-empty axis,
spec slot present) and the no-silent-skip guard is not vacuous.

### The confidence bound is derived, not chosen

`new_restaurant` and the other empty-data cases assert `confidence ≤ 0.5`. That is not
an arbitrary threshold: the orchestrator computes

```
confidence = 0.5 * situation.confidence + 0.5 * mean(recommendation confidences)
```

so with zero recommendations the second term is exactly `0` and a run that found
nothing can never exceed 50%. The assertion is the formula, restated.

---

## 2. PENDING — the spec's §27 list

These rows are intentionally empty. Supplying §27 lets each one be filled with a
single object literal in `SCENARIO_CASES`, carrying its `specRef`.

| # | spec ref | scenario | status |
| --- | --- | --- | --- |
| 1–20 | §27 | *(awaiting the list)* | NOT IMPLEMENTED |
| C1–C11 | §27 | *(awaiting the list)* | NOT IMPLEMENTED |

The registry was built for exactly this: adding a case is one entry
`{ id, axis, specRef, run }`, and the runner, the guard, the Mongo lifecycle and the
seed helpers are already in place.

Not yet covered by any case, and worth prioritising when the list arrives:

- a **rich-data** tenant (real orders/bills) producing actual recommendations, which
  would exercise the candidate engine, the deterministic gate and the critic on a
  populated database rather than only their empty-data disclosures;
- **stockout feasibility** rejection against real recipe/consumption data;
- a **scripted-LLM** case proving the manager's sequential domain order and the
  stop-guard refusals end to end (currently covered at the loop level in
  `marketingAnalyze.test.ts`, not through the orchestrator).

---

## 3. Honest status

- Verified: `npx vitest run src/ai/marketing` → **55/55 passed**; `npx tsc --noEmit` →
  **344 = pre-existing baseline, 0 new**.
- The matrix is **partial by design**. It is reported as in progress, not complete, and
  nothing in this document claims §27 coverage.
