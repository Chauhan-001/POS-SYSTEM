"""
Offer-Response Model (spec Step 5) — per-tenant P(respond | offer, features).

CANONICAL LOCATION: MLmodels/Offer_Response_Model/offer_response.py.
The Uplift service (MLmodels/Uplift) re-exports this module from
backend/offer_response.py so its /api/offer-response/* routes keep serving the
SAME code. Edit the model HERE; Uplift never holds a second copy.

SCOPE HONESTY: this is a RESPONSE model — it estimates how likely a customer
is to redeem an offer GIVEN they receive one. It is NOT an uplift/causal
model; ranking by p_response targets customers who will redeem, which
over-serves customers who would have visited anyway. Causal targeting remains
the T-Learner's job (ml.py). The API labels every payload accordingly.

Data: the SAME experiment-event store the T-Learner trains on
(experiment_store.get_experiment_records) — real ChitKuber ledger rows with
pre-treatment features + treatment + purchase. No new ingestion path.

Design mirrors ml.py deliberately (house style):
  - hand-rolled batch-GD logistic regression (deterministic, no deps)
  - honest cold start: below MIN_ROWS/MIN_CONVERSIONS → is_trained=False,
    no fabricated scores
  - per-tenant JSON weight persistence (survives restarts)
"""

import json
import math
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

# ─── Feature contract (pre-treatment ONLY — leakage guard) ──────────────────
# Mirrors experiment_store.ALLOWED_FEATURE_FIELDS; the numeric subset below is
# what the model actually consumes. Categorical fields are one-hot encoded
# with a bounded vocabulary learned at training time and PERSISTED with the
# weights (predict-time unseen values map to "absent category" — never crash,
# never invent).

NUMERIC_FEATURES = (
    "visits_7d",
    "visits_30d",
    "visits_90d",
    "orders_30d",
    "orders_90d",
    "total_spend",
    "average_order_value",
    "days_since_last_visit",
    "days_since_last_offer",
    "previous_offer_count",
)
CATEGORICAL_FEATURES = ("favorite_category", "favorite_item", "preferred_day", "preferred_time")
MAX_CATEGORY_LEVELS = 24  # vocabulary bound per categorical field

# impute (value - center) / scale — constants fixed at training time.
_IMPUTES: Dict[str, Tuple[float, float]] = {
    "visits_7d": (1.0, 2.0),
    "visits_30d": (5.0, 4.0),
    "visits_90d": (12.0, 10.0),
    "orders_30d": (3.0, 3.0),
    "orders_90d": (9.0, 7.0),
    "total_spend": (5000.0, 4000.0),
    "average_order_value": (400.0, 250.0),
    "days_since_last_visit": (20.0, 15.0),
    "days_since_last_offer": (30.0, 30.0),
    "previous_offer_count": (2.0, 3.0),
}

# Readiness gates — the model refuses to train (and reports why) below these.
MIN_ROWS = 100
MIN_CONVERSIONS = 20
MIN_ROWS_PER_CLASS = 10

_LEARN_RATE = 0.1
_EPOCHS = 150
_L2 = 0.001

# Default lives NEXT TO this module so the model folder is self-contained and
# easy to track (MLmodels/Offer_Response_Model/data/offer-response-weights).
# Deployments override it via OFFER_RESPONSE_WEIGHTS_DIR.
_WEIGHTS_DIR = os.getenv(
    "OFFER_RESPONSE_WEIGHTS_DIR",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "offer-response-weights"),
)


def _weights_path(restaurant_id: Optional[str]) -> str:
    safe = "".join(c for c in (restaurant_id or "global") if c.isalnum() or c in "-_")[:64] or "global"
    return os.path.join(_WEIGHTS_DIR, f"{safe}.json")


# ─── Feature engineering ────────────────────────────────────────────────────

def _learn_vocab(records: List[Dict[str, Any]]) -> Dict[str, List[str]]:
    vocab: Dict[str, List[str]] = {}
    for field in CATEGORICAL_FEATURES:
        levels: List[str] = []
        for r in records:
            raw = r.get(field)
            if raw in (None, ""):
                continue
            val = str(raw).strip().lower()
            if val and val not in levels:
                levels.append(val)
        vocab[field] = sorted(levels)[:MAX_CATEGORY_LEVELS]
    return vocab


def _encode_row(row: Dict[str, Any], vocab: Dict[str, List[str]]) -> List[float]:
    """Deterministic feature vector: standardized numerics + one-hot cats."""
    vec: List[float] = []
    for field in NUMERIC_FEATURES:
        center, scale = _IMPUTES[field]
        raw = row.get(field)
        try:
            val = float(raw) if raw not in (None, "") else center
        except (TypeError, ValueError):
            val = center
        vec.append((val - center) / scale)
    for field in CATEGORICAL_FEATURES:
        levels = vocab.get(field, [])
        raw = str(row.get(field) or "").strip().lower()
        for level in levels:
            vec.append(1.0 if raw == level else 0.0)
    return vec


def _sigmoid(z: float) -> float:
    if z > 30:
        return 1.0
    if z < -30:
        return 0.0
    return 1.0 / (1.0 + math.exp(-z))


# ─── Training ───────────────────────────────────────────────────────────────

def _dataset_fingerprint(records: List[Dict[str, Any]]) -> str:
    return f"{len(records)}:{sum(1 for r in records if r.get('purchase') == 1)}"


def train_offer_response_model(records: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Trains on rows shaped like experiment_store records (treatment=1 rows
    only — the response model answers 'will they respond TO AN OFFER').
    Returns a model dict or {ready: False, reasons: [...]} when gates trip."""
    treated = [r for r in records if r.get("treatment") == 1]
    conversions = sum(1 for r in treated if r.get("purchase") == 1)

    reasons: List[str] = []
    if len(treated) < MIN_ROWS:
        reasons.append(f"treated rows {len(treated)} < {MIN_ROWS} minimum")
    if conversions < MIN_CONVERSIONS:
        reasons.append(f"conversions {conversions} < {MIN_CONVERSIONS} minimum")
    if len(treated) - conversions < MIN_ROWS_PER_CLASS:
        reasons.append(f"non-converters {len(treated) - conversions} < {MIN_ROWS_PER_CLASS} minimum")
    if reasons:
        return {"ready": False, "reasons": reasons}

    vocab = _learn_vocab(treated)
    base = [(_encode_row(r, vocab), float(r.get("purchase", 0))) for r in treated]

    dim = len(base[0][0])
    weights = [0.0] * dim
    n = len(base)

    for _ in range(_EPOCHS):
        grads = [0.0] * dim
        for vec, label in base:
            z = sum(w * x for w, x in zip(weights, vec))
            err = _sigmoid(z) - label
            for i in range(dim):
                grads[i] += err * vec[i]
        for i in range(dim):
            weights[i] -= _LEARN_RATE * (grads[i] / n + _L2 * weights[i])

    return {
        "ready": True,
        "weights": weights,
        "vocab": vocab,
        "trained_rows": n,
        "trained_conversions": int(conversions),
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "response_rate_baseline": round(conversions / n, 4),
    }


# ─── Persistence (per-tenant JSON, atomic write) ────────────────────────────

def save_offer_response_model(restaurant_id: Optional[str], model: Dict[str, Any]) -> None:
    try:
        os.makedirs(_WEIGHTS_DIR, exist_ok=True)
        path = _weights_path(restaurant_id)
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(model, f, separators=(",", ":"))
        os.replace(tmp, path)
    except Exception as e:  # persistence is best-effort; never break serving
        print(f"[offer-response] weight persistence failed: {e}")


def load_offer_response_model(restaurant_id: Optional[str]) -> Optional[Dict[str, Any]]:
    try:
        path = _weights_path(restaurant_id)
        if not os.path.exists(path):
            return None
        with open(path, "r", encoding="utf-8") as f:
            payload = json.load(f)
        if not isinstance(payload, dict) or "weights" not in payload:
            return None
        return payload
    except Exception as e:
        print(f"[offer-response] weight restore failed: {e}")
        return None


# ─── In-memory cache + ensure-trained ───────────────────────────────────────

_MODEL_CACHE: Dict[str, Dict[str, Any]] = {}


def ensure_offer_response_model(restaurant_id: Optional[str], records: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Returns a READY model dict or None (honest cold start). Trains when the
    dataset changed; restores from disk after restarts."""
    key = restaurant_id or "global"
    fp = _dataset_fingerprint(records)
    cached = _MODEL_CACHE.get(key)
    if cached and cached.get("fingerprint") == fp and cached.get("ready"):
        return cached

    if cached is None or cached.get("fingerprint") != fp:
        restored = load_offer_response_model(restaurant_id)
        if restored and restored.get("fingerprint") == fp and restored.get("ready"):
            _MODEL_CACHE[key] = restored
            return restored

    model = train_offer_response_model(records)
    if not model.get("ready"):
        return None
    model["fingerprint"] = fp
    save_offer_response_model(restaurant_id, model)
    _MODEL_CACHE[key] = model
    return model


def invalidate_offer_response_model(restaurant_id: Optional[str]) -> None:
    _MODEL_CACHE.pop(restaurant_id or "global", None)


# ─── Scoring ────────────────────────────────────────────────────────────────

def score_offer_response(
    customer: Dict[str, Any],
    restaurant_id: Optional[str],
    records: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """Scores p(respond | offer). Honest contract: is_trained=False carries a
    reason and p_response=None — callers must not render fabricated numbers."""
    model = ensure_offer_response_model(restaurant_id, records)
    if model is None:
        # Report WHY (same gates as training) for an actionable response.
        treated = [r for r in records if r.get("treatment") == 1]
        conversions = sum(1 for r in treated if r.get("purchase") == 1)
        gate = train_offer_response_model(records)
        return {
            "p_response": None,
            "is_trained": False,
            "model_version": None,
            "reason": "insufficient_data",
            "detail": gate.get("reasons", []),
            "data": {"treated_rows": len(treated), "conversions": conversions},
        }

    vec = _encode_row(customer, model.get("vocab", {}))
    weights = model.get("weights", [])
    z = sum(w * x for w, x in zip(weights, vec))
    p = _sigmoid(z)
    return {
        "p_response": round(p, 4),
        "is_trained": True,
        "model_version": model.get("trained_at"),
        "reason": None,
        "data": {
            "trained_rows": model.get("trained_rows"),
            "trained_conversions": model.get("trained_conversions"),
            "response_rate_baseline": model.get("response_rate_baseline"),
        },
    }


def score_offer_response_batch(
    customers: List[Dict[str, Any]],
    restaurant_id: Optional[str],
    records: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """Batch p(respond | offer, features) — one model load, one forward pass
    per customer, scores aligned 1:1 with the input order (the caller maps
    them back to its own customer ids).

    Same honest contract as single scoring: is_trained=False carries the gate
    reasons and every score degrades to p_response=None — a probability is
    never fabricated. RESPONSE model, NOT causal uplift (scope label attached
    by the API layer).
    """
    if not customers:
        return {
            "scores": [],
            "is_trained": False,
            "model_version": None,
            "reason": "empty_batch",
            "detail": ["no customers supplied to score"],
            "data": {"requested": 0},
        }

    model = ensure_offer_response_model(restaurant_id, records)
    if model is None:
        # Honest cold start — report WHY (same gates as training), aligned
        # per row so callers can zip without special-casing.
        gate = train_offer_response_model(records)
        treated = [r for r in records if r.get("treatment") == 1]
        conversions = sum(1 for r in treated if r.get("purchase") == 1)
        return {
            "scores": [{"p_response": None} for _ in customers],
            "is_trained": False,
            "model_version": None,
            "reason": "insufficient_data",
            "detail": gate.get("reasons", []),
            "data": {
                "treated_rows": len(treated),
                "conversions": conversions,
                "requested": len(customers),
            },
        }

    vocab = model.get("vocab", {})
    weights = model.get("weights", [])
    scored: List[Dict[str, Any]] = []
    for customer in customers:
        vec = _encode_row(customer, vocab)
        z = sum(w * x for w, x in zip(weights, vec))
        scored.append({"p_response": round(_sigmoid(z), 4)})

    return {
        "scores": scored,
        "is_trained": True,
        "model_version": model.get("trained_at"),
        "reason": None,
        "data": {
            "trained_rows": model.get("trained_rows"),
            "trained_conversions": model.get("trained_conversions"),
            "response_rate_baseline": model.get("response_rate_baseline"),
            "requested": len(customers),
        },
    }


# ─── Evaluation (honest holdout) ────────────────────────────────────────────

def offer_response_gate_report(records: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Readiness report WITHOUT training — the same gates as
    train_offer_response_model, exposed for API 'why not ready' payloads."""
    treated = [r for r in records if r.get("treatment") == 1]
    conversions = sum(1 for r in treated if r.get("purchase") == 1)
    reasons: List[str] = []
    if len(treated) < MIN_ROWS:
        reasons.append(f"treated rows {len(treated)} < {MIN_ROWS} minimum")
    if conversions < MIN_CONVERSIONS:
        reasons.append(f"conversions {conversions} < {MIN_CONVERSIONS} minimum")
    if len(treated) - conversions < MIN_ROWS_PER_CLASS:
        reasons.append(f"non-converters {len(treated) - conversions} < {MIN_ROWS_PER_CLASS} minimum")
    return {
        "reasons": reasons,
        "data": {"treated_rows": len(treated), "conversions": conversions},
    }


def evaluate_offer_response(
    records: List[Dict[str, Any]],
    holdout_fraction: float = 0.3,
) -> Dict[str, Any]:
    """Chronological holdout (by experiment_date when present, else tail rows)
    with AUC + log loss. Returns evaluable=False + reasons when data cannot
    support trustworthy metrics — never fabricates."""
    treated = [r for r in records if r.get("treatment") == 1]
    reasons: List[str] = []
    if len(treated) < MIN_ROWS + 20:
        reasons.append(f"treated rows {len(treated)} < {MIN_ROWS + 20} for a holdout split")
    conversions = sum(1 for r in treated if r.get("purchase") == 1)
    if conversions < MIN_CONVERSIONS + 10:
        reasons.append(f"conversions {conversions} < {MIN_CONVERSIONS + 10} for a holdout split")
    if reasons:
        return {"evaluable": False, "reasons": reasons, "auc": None, "log_loss": None}

    has_dates = all(r.get("experiment_date") for r in treated)
    if has_dates:
        ordered = sorted(treated, key=lambda r: str(r.get("experiment_date")))
    else:
        ordered = list(treated)

    hf = min(max(holdout_fraction, 0.1), 0.5)
    cut = int(len(ordered) * (1 - hf))
    train_rows = ordered[:cut]
    test_rows = ordered[cut:]

    if sum(1 for r in train_rows if r.get("purchase") == 1) < MIN_CONVERSIONS:
        reasons.append("training split would hold too few conversions — narrow the holdout or gather data")
        return {"evaluable": False, "reasons": reasons, "auc": None, "log_loss": None}
    if len({r.get("purchase") for r in test_rows}) < 2:
        reasons.append("holdout split contains a single class — AUC undefined")
        return {"evaluable": False, "reasons": reasons, "auc": None, "log_loss": None}

    model = train_offer_response_model(train_rows)
    if not model.get("ready"):
        return {"evaluable": False, "reasons": model.get("reasons", []), "auc": None, "log_loss": None}

    scored = []
    for r in test_rows:
        vec = _encode_row(r, model["vocab"])
        z = sum(w * x for w, x in zip(model["weights"], vec))
        scored.append((_sigmoid(z), float(r.get("purchase", 0))))

    # AUC via rank statistic (handles ties by averaging ranks).
    pos = [p for p, y in scored if y == 1]
    neg = [p for p, y in scored if y == 0]
    if pos and neg:
        ranks: List[Tuple[float, int]] = sorted((p, 1 if y == 1 else 0) for p, y in scored)
        # average ranks for ties
        i = 0
        rank_sum_pos = 0.0
        while i < len(ranks):
            j = i
            while j + 1 < len(ranks) and ranks[j + 1][0] == ranks[i][0]:
                j += 1
            avg_rank = (i + j) / 2 + 1
            for k in range(i, j + 1):
                if ranks[k][1] == 1:
                    rank_sum_pos += avg_rank
            i = j + 1
        auc = (rank_sum_pos - len(pos) * (len(pos) + 1) / 2) / (len(pos) * len(neg))
    else:
        auc = None

    eps = 1e-7
    log_loss = -sum(
        y * math.log(max(p, eps)) + (1 - y) * math.log(max(1 - p, eps)) for p, y in scored
    ) / len(scored)

    return {
        "evaluable": auc is not None,
        "reasons": [],
        "auc": round(auc, 4) if auc is not None else None,
        "log_loss": round(log_loss, 4),
        "temporal_split": has_dates,
        "train_rows": len(train_rows),
        "holdout_rows": len(test_rows),
        "holdout_conversions": int(sum(1 for _, y in scored if y == 1)),
        "evaluated_at": datetime.now(timezone.utc).isoformat(),
    }
