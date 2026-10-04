# Offer-Response Model

Per-tenant **P(respond | offer, pre-treatment features)** — a *response* model,
explicitly **non-causal**. It estimates how likely a customer is to redeem an
offer *given* they receive one. Ranking by `p_response` over-serves customers
who would have redeemed anyway; causal targeting remains the job of the Uplift
T-Learner (`MLmodels/Uplift/backend/ml.py`).

## Why this folder exists

This is the **canonical, easy-to-track location** for the offer-response model,
alongside the other models in `MLmodels/`:

| Model | Folder |
| --- | --- |
| Demand forecasting | `MLmodels/Demand_forcasting_model` |
| Market basket analysis | `MLmodels/Market_Basket_Analysis` |
| Uplift (T-Learner) | `MLmodels/Uplift` |
| Customer segmentation | `MLmodels/Customer_segmentation_model` |
| **Offer response** | `MLmodels/Offer_Response_Model` ← this folder |

The Uplift service **re-exports** this module from
`MLmodels/Uplift/backend/offer_response.py` so its `/api/offer-response/*`
routes keep serving the same code. Edit the model **here**; Uplift holds no
second copy.

## Files

- `offer_response.py` — the model (training, persistence, scoring, evaluation).
- `tests/test_offer_response.py` — dependency-free tests (stdlib `unittest`).
- `data/offer-response-weights/` — default per-tenant weight store (created at
  runtime; override with `OFFER_RESPONSE_WEIGHTS_DIR`).

## Input

**Training data** — rows shaped like the Uplift experiment store
(`MLmodels/Uplift/backend/experiment_store.py`): pre-treatment features +
`treatment` + `purchase`. Only `treatment == 1` rows are used.

**Features** (pre-treatment only — leakage guard):

- Numeric (10): `visits_7d`, `visits_30d`, `visits_90d`, `orders_30d`,
  `orders_90d`, `total_spend`, `average_order_value`, `days_since_last_visit`,
  `days_since_last_offer`, `previous_offer_count`.
- Categorical (4): `favorite_category`, `favorite_item`, `preferred_day`,
  `preferred_time` — one-hot encoded with a bounded vocabulary
  (`MAX_CATEGORY_LEVELS = 24`) learned at training and persisted with the
  weights. Unseen predict-time values map to "absent category".

**Scoring input** — a customer dict of those features (or a list of them for
the batch scorer, capped at 200 by the API layer).

## Pipeline

1. **Gate check** — refuses to train unless treated rows ≥ 100, conversions ≥ 20,
   and non-converters ≥ 10; returns `ready: False` with named reasons instead of
   fabricated scores.
2. **Feature engineering** — numerics standardized with fixed center/scale
   constants (`_IMPUTES`); categoricals one-hot encoded against the learned vocab.
3. **Training** — hand-rolled batch-gradient-descent logistic regression
   (deterministic, no ML dependencies): sigmoid + L2, `lr=0.1`, 150 epochs.
4. **Persistence** — per-tenant JSON weights, atomic write.
5. **Cache / ensure-trained** — in-memory cache keyed by a dataset fingerprint
   (`rows:conversions`); restores from disk after restarts, retrains when the
   fingerprint changes.
6. **Scoring** — one forward pass per customer; batch scores align 1:1 with the
   input order.
7. **Evaluation** — chronological holdout (by `experiment_date` when present,
   else tail rows), AUC (rank statistic, tie-averaged) + log loss; returns
   `evaluable: False` + reasons when data is too thin.

## Output

Single score:

```json
{
  "p_response": 0.42,
  "is_trained": true,
  "model_version": "<trained_at ISO>",
  "reason": null,
  "data": { "trained_rows": 0, "trained_conversions": 0, "response_rate_baseline": 0.0 },
  "model": "offer_response",
  "scope": "response (non-causal) ..."
}
```

Batch adds `scores: [{ "p_response": ... }]` aligned to input order.

**Cold start (honest):** `is_trained: false`, `reason: "insufficient_data"`,
`detail: [gate reasons]`, and `p_response: null` per row — never fabricated.

**Evaluate:** `{ evaluable, auc, log_loss, temporal_split, train_rows, holdout_rows, holdout_conversions }`.

## How it is served

The Uplift FastAPI service (`MLmodels/Uplift/backend/main.py`) exposes:

- `POST /api/offer-response/score`
- `POST /api/offer-response/score-batch`
- `POST /api/offer-response/retrain`
- `POST /api/offer-response/evaluate`
- `GET  /api/offer-response/status`

The ChitKuber Node backend reaches these through
`backend/src/modules/ml-pipeline/offerResponseClient.ts` using
`ML_UPLIT_BASE_URL` (see also `backend/src/modules/ml-pipeline/mlPipelineRoutes.ts`).

## Configuration

| Env var | Purpose | Default |
| --- | --- | --- |
| `OFFER_RESPONSE_WEIGHTS_DIR` | Per-tenant weight store | `MLmodels/Offer_Response_Model/data/offer-response-weights` |

## Tests

No third-party dependencies — stdlib only:

```bash
python -m unittest discover -s MLmodels/Offer_Response_Model/tests
```

## Editing

Change `MLmodels/Offer_Response_Model/offer_response.py`. Uplift imports it
through the shim, so both local runs and the container pick up the change.
