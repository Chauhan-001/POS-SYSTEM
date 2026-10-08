# Phase 2 — Historical Reconciliation Report (READ-ONLY)

**Generated:** 2026-10-08 · tool: `backend/scripts/historical/reconcile.ts`
**Mode:** read-only (`find()`/`aggregate()` only — no writes) · DB: `pos` @ `mongodb://localhost:27017`
**Scope:** full transaction spine (23,200 bills / 285,687 billitems / 19,958 recipeconsumptions)
**Tolerance:** ₹0.01

Reproduce: `npx tsx scripts/historical/reconcile.ts` (stdout) or `--out <file>` (JSON).
This report **reports findings; it repairs nothing** (prompt §57).

---

## 1. Headline verdict

```text
subtotal vs BillItems        RECONCILED   (0 mismatches on priced bills)
split payments vs grandTotal RECONCILED   (0 mismatches)
grandTotal convention        UNEXPLAINED for 6,820 bills (needs the existing finance engine — not a naive formula)
line-level price history     INCOMPLETE   (2,695 bills / 9,260 items carry NO price snapshot)
referential integrity        BROKEN       (230,559 BillItem docs → 103,715 missing Bills)
```

## 2. BillItem ↔ Bill reconciliation

| Metric | Value |
|---|---:|
| BillItems scanned | 285,687 |
| BillItems with no price snapshot (`priceAtSale`/`pricingSnapshot.lineTotal` absent) | 9,260 |
| Distinct billIds represented by items | 126,914 |
| **BillItems whose parent Bill does not exist** | **230,559** |
| **Orphan billIds (no matching Bill)** | **103,715** (80.7% of item billIds) |
| Bills scanned | 23,200 |
| Bills with zero BillItems | 1 |
| **Bills with items but NO price snapshot (line history UNAVAILABLE)** | **2,695** |
| Bills where Σ item lines ≠ `subtotal` (priced bills) | **0** ✅ |

**F1 — 80.7% of BillItems are orphans.** `BillItem.billId` is a valid ObjectId but resolves to no
`Bill`. Orphan items are distributed across the whole period (2025-10 … 2026-09):
```text
2025-10:  24,382   2026-01:  43,351   2026-06:     712
2025-11:  33,586   2026-02:  40,242   2026-07:   1,478
2025-12:  35,814   2026-03:  48,772   2026-08:   1,568  2026-09: 654
```
This is the single largest integrity gap in the historical foundation. **Reported, not repaired.**
Phase 10 will formalise the check; any cleanup is a separate approved phase (prompt §57).

**F2 — Tenant `…22f` (The Royal Bistro, 2,695 bills) has line items with NO `itemName`, NO
`priceAtSale`, and NO `pricingSnapshot`** — only `billId` + `quantity`. Line-level price history
for that tenant is **UNAVAILABLE** (never treated as ₹0). This is the sole cause of the
`line-level price history INCOMPLETE` verdict.

## 3. grandTotal convention

The DB stores `grandTotal` under **more than one legitimate convention**; a naive
`subtotal − discount + gst` is therefore the WRONG check (prompt §44 — do not build a second
finance engine).

| Convention | Bills |
|---|---:|
| `grandTotal = subtotal − discount + gst` (tax-additive) | 783 |
| `grandTotal = subtotal` (tax-inclusive price) | 12,902 |
| Matches neither naive form | 6,820 |

**F3 — 6,820 bills use a grandTotal rule neither naive form captures.** Example sim bill:
`subtotal 967, discount 0, gst 46.05, grandTotal 967` (tax-inclusive). The **authoritative**
definition lives in the existing finance/report assembly, not in a backfill formula. Phase 2
therefore reports rather than asserts; Phase 5 must reuse the existing report metric logic.

## 4. Payments

| Metric | Value |
|---|---:|
| Split-payment bills where Σ `splitDetails` ≠ `grandTotal` | 0 ✅ |
| Voided bills | 2 |
| `refunds` collection rows | 0 (UNAVAILABLE historically — classified `COLLECT_GOING_FORWARD`) |

## 5. RecipeConsumption ↔ Bill

| Metric | Value |
|---|---:|
| `recipeconsumptions` rows | 19,958 |
| with non-null `billId` | 19,958 (100%) |
| ⚠ caveat | parent-Bill existence is NOT guaranteed given §2 — the billId may itself be an orphan id. Phase 10 will validate. |

## 6. Consequences for later phases (recorded, not acted on)

1. **Phase 5 (canonical facts)** must derive sales facts from **Bill-level** totals (which reconcile),
   not from orphan-prone line items, and must reuse the existing finance metric definitions for
   `grandTotal`.
2. **Phase 6 (reconstruction)** cannot reconstruct line-level product/category history for the orphan
   item population or for tenant `…22f`.
3. **Phase 10 (relationship validation)** is upgraded: orphan-BillItem detection is now a P0 gate.
4. **Phase 9 (data quality)** must treat unpriced items as UNAVAILABLE, never ₹0 (prompt §26).

## 7. Safety

```text
Writes performed: 0.   Schemas changed: 0.   Models changed: 0.
UI changed: 0.         Routes/APIs changed: 0. Data modified: 0.
Additive artifacts: scripts/historical/reconcile.ts + this report only.
```
