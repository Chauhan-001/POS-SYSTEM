"""Dependency-free tests for the offer-response model (stdlib unittest only).

Run:
    python -m unittest discover -s MLmodels/Offer_Response_Model/tests
"""

import importlib.util
import os
import sys
import tempfile
import unittest

_HERE = os.path.dirname(os.path.abspath(__file__))
_MODEL_PATH = os.path.abspath(os.path.join(_HERE, "..", "offer_response.py"))


def _load_model():
    spec = importlib.util.spec_from_file_location("offer_response_under_test", _MODEL_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


orx = _load_model()


def _make_records(n_converters=60, n_non_converters=60):
    """Synthetic treated rows with a learnable signal.

    Higher visits_30d => more likely to purchase, so the model has something to
    fit and AUC should beat chance.
    """
    records = []
    for i in range(n_converters):
        records.append({
            "customer_id": f"c{i}",
            "treatment": 1,
            "purchase": 1,
            "visits_30d": 12 + (i % 5),
            "orders_30d": 6,
            "total_spend": 6000,
            "favorite_category": "pizza",
        })
    for i in range(n_non_converters):
        records.append({
            "customer_id": f"n{i}",
            "treatment": 1,
            "purchase": 0,
            "visits_30d": 1 + (i % 2),
            "orders_30d": 0,
            "total_spend": 300,
            "favorite_category": "salad",
        })
    return records


class ColdStartTests(unittest.TestCase):
    def test_gate_reports_reasons_below_minimums(self):
        thin = [{"treatment": 1, "purchase": 1, "visits_30d": 3} for _ in range(5)]
        gate = orx.offer_response_gate_report(thin)
        self.assertTrue(gate["reasons"])
        self.assertEqual(gate["data"]["treated_rows"], 5)

    def test_train_refuses_below_minimums(self):
        thin = [{"treatment": 1, "purchase": 1, "visits_30d": 3} for _ in range(5)]
        model = orx.train_offer_response_model(thin)
        self.assertFalse(model["ready"])
        self.assertTrue(model["reasons"])

    def test_score_is_honest_on_cold_start(self):
        thin = [{"treatment": 1, "purchase": 1, "visits_30d": 3} for _ in range(5)]
        out = orx.score_offer_response({"visits_30d": 5}, "tenant_cold", thin)
        self.assertFalse(out["is_trained"])
        self.assertIsNone(out["p_response"])
        self.assertEqual(out["reason"], "insufficient_data")
        self.assertTrue(out["detail"])

    def test_control_rows_are_ignored_for_training(self):
        # Only treatment==1 rows count toward the gates.
        records = _make_records()
        records += [{"treatment": 0, "purchase": 1, "visits_30d": 99} for _ in range(500)]
        treated = [r for r in records if r["treatment"] == 1]
        model = orx.train_offer_response_model(records)
        self.assertTrue(model["ready"])
        self.assertEqual(model["trained_rows"], len(treated))


class TrainingAndScoringTests(unittest.TestCase):
    def setUp(self):
        self.records = _make_records()
        self._tmp = tempfile.TemporaryDirectory()
        self._orig_dir = orx._WEIGHTS_DIR
        orx._WEIGHTS_DIR = self._tmp.name
        orx._MODEL_CACHE.clear()

    def tearDown(self):
        orx._WEIGHTS_DIR = self._orig_dir
        orx._MODEL_CACHE.clear()
        self._tmp.cleanup()

    def test_training_produces_a_ready_model(self):
        model = orx.train_offer_response_model(self.records)
        self.assertTrue(model["ready"])
        self.assertEqual(model["trained_rows"], len(self.records))
        self.assertEqual(model["trained_conversions"], 60)
        self.assertAlmostEqual(model["response_rate_baseline"], 0.5, places=2)
        self.assertEqual(len(model["weights"]), len(orx._encode_row(self.records[0], model["vocab"])))

    def test_hot_customer_scores_higher_than_cold_customer(self):
        orx.ensure_offer_response_model("tenant_a", self.records)
        hot = orx.score_offer_response({"visits_30d": 14, "orders_30d": 6, "total_spend": 6000}, "tenant_a", self.records)
        cold = orx.score_offer_response({"visits_30d": 1, "orders_30d": 0, "total_spend": 300}, "tenant_a", self.records)
        self.assertTrue(hot["is_trained"])
        self.assertIsNotNone(hot["p_response"])
        self.assertGreater(hot["p_response"], cold["p_response"])
        self.assertGreaterEqual(hot["p_response"], 0.0)
        self.assertLessEqual(hot["p_response"], 1.0)

    def test_batch_scores_align_1_to_1_with_input_order(self):
        customers = [
            {"visits_30d": 14, "orders_30d": 6},
            {"visits_30d": 1, "orders_30d": 0},
            {"visits_30d": 8, "orders_30d": 3},
        ]
        out = orx.score_offer_response_batch(customers, "tenant_a", self.records)
        self.assertTrue(out["is_trained"])
        self.assertEqual(len(out["scores"]), len(customers))
        self.assertEqual(out["data"]["requested"], 3)
        # First (hot) should outscore second (cold), order preserved.
        self.assertGreater(out["scores"][0]["p_response"], out["scores"][1]["p_response"])

    def test_empty_batch_is_reported_honestly(self):
        out = orx.score_offer_response_batch([], "tenant_a", self.records)
        self.assertEqual(out["scores"], [])
        self.assertFalse(out["is_trained"])
        self.assertEqual(out["reason"], "empty_batch")

    def test_batch_cold_start_keeps_row_alignment(self):
        thin = [{"treatment": 1, "purchase": 1, "visits_30d": 3} for _ in range(5)]
        customers = [{"visits_30d": 5}, {"visits_30d": 6}]
        out = orx.score_offer_response_batch(customers, "tenant_cold_batch", thin)
        self.assertFalse(out["is_trained"])
        self.assertEqual(len(out["scores"]), 2)
        self.assertTrue(all(s["p_response"] is None for s in out["scores"]))


class PersistenceTests(unittest.TestCase):
    def setUp(self):
        self.records = _make_records()
        self._tmp = tempfile.TemporaryDirectory()
        self._orig_dir = orx._WEIGHTS_DIR
        orx._WEIGHTS_DIR = self._tmp.name
        orx._MODEL_CACHE.clear()

    def tearDown(self):
        orx._WEIGHTS_DIR = self._orig_dir
        orx._MODEL_CACHE.clear()
        self._tmp.cleanup()

    def test_model_survives_cache_eviction(self):
        model = orx.ensure_offer_response_model("tenant_persist", self.records)
        self.assertIsNotNone(model)
        # Simulate a restart: drop the in-memory cache.
        orx._MODEL_CACHE.clear()
        restored = orx.ensure_offer_response_model("tenant_persist", self.records)
        self.assertIsNotNone(restored)
        self.assertTrue(restored.get("ready"))
        self.assertEqual(restored.get("trained_at"), model.get("trained_at"))

    def test_retrain_invalidates_cache(self):
        orx.ensure_offer_response_model("tenant_inv", self.records)
        self.assertIn("tenant_inv", orx._MODEL_CACHE)
        orx.invalidate_offer_response_model("tenant_inv")
        self.assertNotIn("tenant_inv", orx._MODEL_CACHE)

    def test_load_returns_none_for_unknown_tenant(self):
        self.assertIsNone(orx.load_offer_response_model("never_trained"))


class EvaluationTests(unittest.TestCase):
    def test_evaluation_refuses_on_thin_data(self):
        thin = [{"treatment": 1, "purchase": 1, "visits_30d": 3} for _ in range(5)]
        out = orx.evaluate_offer_response(thin)
        self.assertFalse(out["evaluable"])
        self.assertIsNone(out["auc"])
        self.assertTrue(out["reasons"])

    def test_evaluation_reports_auc_on_sufficient_data(self):
        records = _make_records(n_converters=80, n_non_converters=80)
        # Give rows a chronological order for a temporal split.
        for i, r in enumerate(records):
            r["experiment_date"] = f"2026-01-{(i % 28) + 1:02d}"
        out = orx.evaluate_offer_response(records, holdout_fraction=0.3)
        self.assertTrue(out["evaluable"])
        self.assertIsNotNone(out["auc"])
        self.assertIsNotNone(out["log_loss"])
        self.assertGreater(out["holdout_rows"], 0)


class EncodingTests(unittest.TestCase):
    def test_unseen_category_maps_to_absent_without_crashing(self):
        model = orx.train_offer_response_model(_make_records())
        vec = orx._encode_row({"favorite_category": "brand_new_thing"}, model["vocab"])
        self.assertEqual(len(vec), len(model["weights"]))
        self.assertTrue(all(isinstance(v, float) for v in vec))

    def test_missing_and_bad_values_impute_to_center(self):
        vocab = {f: [] for f in orx.CATEGORICAL_FEATURES}
        vec = orx._encode_row({"visits_30d": "not-a-number"}, vocab)
        # imputed to center => standardized value 0.0
        self.assertEqual(vec[1], 0.0)


if __name__ == "__main__":
    unittest.main()
