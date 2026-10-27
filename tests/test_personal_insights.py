"""Kişisel mesaj tespiti ve haftalık içgörü: Python tarafı eklentiyle aynı sonucu veriyor mu?"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from kafiai.counters import validate_export  # noqa: E402
from kafiai.insights import CONFIG, weekly_insights, window_days  # noqa: E402
from kafiai.personal import is_personal  # noqa: E402
from kafiai.tasks import TASK_TYPES  # noqa: E402

FIX = ROOT / "tests" / "fixtures"


def test_personal_matches_fixture():
    for row in json.loads((FIX / "personal_parity.json").read_text(encoding="utf-8")):
        assert is_personal(row["text"]) == row["personal"], row["text"]


def test_personal_fiction_only_counts_self_harm():
    assert not is_personal("Write a story where my girlfriend broke up with me")
    assert is_personal("write a story. I want to kill myself")


def test_insights_match_fixture():
    for case in json.loads((FIX / "insights_parity.json").read_text(encoding="utf-8")):
        assert weekly_insights(case["days"], case["today"]) == case["expected"]


def test_insight_fixture_days_are_valid_exports():
    for case in json.loads((FIX / "insights_parity.json").read_text(encoding="utf-8")):
        export = {"schema": "kafiai.counts", "version": 2, "exported": case["today"], "days": case["days"]}
        assert validate_export(export) == []


def test_window_crosses_year():
    assert window_days("2027-01-02")[-1] == "2026-12-27"


def test_config_has_tip_for_every_task():
    assert set(CONFIG["tips"]) == set(TASK_TYPES)
    for tip in CONFIG["tips"].values():
        assert tip.startswith("İstersen")


def test_insight_event_keys_valid():
    from kafiai.counters import is_valid_cell_key
    assert is_valid_cell_key("insight|na|pencere")
    assert is_valid_cell_key("insight|kod|ayrinti")
    assert is_valid_cell_key("card|chatgpt|kod|4-6|gosterildi_elle")
    assert is_valid_cell_key("strip|gemini|soru|gizlendi_kisisel")
