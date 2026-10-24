"""Tur modeli testleri: sızıntı yok, parite örnekleri tutarlı, model dosyası geçerli."""

import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from kafiai.text import has_strong_repair  # noqa: E402
from kafiai.turn_features import TURN_FEATURES, turn_features  # noqa: E402
from kafiai.turn_model import load_model, load_reasons, predict  # noqa: E402

FIXTURE = json.loads((ROOT / "tests" / "fixtures" / "turn_model_parity.json").read_text(encoding="utf-8"))


def test_features_only_use_first_k_messages():
    convo = ["kodu düzelt", "hata var", "olmadı", "hala olmadı", "yine olmadı"]
    assert turn_features(convo, 3) == turn_features(convo[:3], 3)
    assert list(turn_features(convo, 2)) == TURN_FEATURES


def test_repair_counts_grow_with_turns():
    convo = ["fix my code", "still an error", "same error again", "it doesn't work"]
    counts = [turn_features(convo, k)["n_strong_repairs"] for k in range(2, 5)]
    assert counts == [1, 2, 3]


def test_model_file_matches_feature_list():
    model = load_model()
    assert model["features"] == TURN_FEATURES
    assert len(model["coef"]) == len(model["mean"]) == len(model["scale"]) == len(TURN_FEATURES)
    assert 0 < model["thresholds"]["oneri"] <= model["thresholds"]["yuksek_guven"] < 1


def test_every_reason_has_text():
    for key, reason in load_reasons().items():
        assert reason["short"] and reason["why"] and reason["tip"], key


def test_parity_fixture_is_current():
    """Fixture eski bir modelle üretildiyse burada yakalanır: önce make_turn_parity_fixture.py çalıştırılmalı."""
    for row in FIXTURE["conversations"]:
        k = len(row["messages"])
        features = turn_features(row["messages"], k)
        # log1p gibi işlevler işletim sistemine göre son basamakta farklı çıkabiliyor (macOS ve Linux)
        assert features.keys() == row["features"].keys()
        for name, value in row["features"].items():
            assert math.isclose(features[name], value, rel_tol=0, abs_tol=1e-12), name
        result = predict(features)
        assert abs(result["probability"] - row["probability"]) < 1e-12
        assert result["level"] == row["level"] and result["reasons"] == row["reasons"]
    for row in FIXTURE["repairs"]:
        assert has_strong_repair(row["text"]) == row["strong_repair"], row["text"]


def test_repairs_make_risk_go_up():
    calm = predict(turn_features(["Bir şiir yaz", "Güzel olmuş, teşekkürler"], 2))["probability"]
    stuck = predict(turn_features(["Kodu düzelt", "hala hata veriyor", "olmadı, aynı hata"], 3))["probability"]
    assert stuck > calm
