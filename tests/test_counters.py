"""Sayaç şeması v2: Python tarafı eklentiyle aynı kuralları uyguluyor mu? (K18)"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from kafiai.counters import (SCHEMA, first_len_bucket, is_valid_cell_key, len_bucket, loop_outcome,  # noqa: E402
                             slot_of_hour, validate_export)

FIXTURE = json.loads((ROOT / "tests" / "fixtures" / "counter_parity.json").read_text(encoding="utf-8"))


def test_buckets_match_fixture():
    for row in FIXTURE["len_buckets"]:
        assert len_bucket(row["turns"]) == row["bucket"], row
    for row in FIXTURE["first_len_buckets"]:
        assert first_len_bucket("a" * row["chars"]) == row["bucket"], row
    assert first_len_bucket(FIXTURE["first_len_unicode"]["text"]) == FIXTURE["first_len_unicode"]["bucket"]
    for row in FIXTURE["slots"]:
        assert slot_of_hour(row["hour"]) == row["slot"], row


def test_loop_outcome_matches_fixture():
    for row in FIXTURE["loop_outcomes"]:
        assert loop_outcome(row["messages"]) == row["outcome"], row["messages"]


def test_export_validation():
    assert validate_export(FIXTURE["valid_export"]) == []
    for bad in FIXTURE["invalid_exports"]:
        assert validate_export(bad), bad


def test_schema_dimensions_are_short_tokens():
    """Boyut değerleri kısa, sabit sözcükler: içine metin ya da adres sızamaz."""
    for values in SCHEMA["dimensions"].values():
        for v in values:
            assert len(v) <= 16 and "/" not in v and " " not in v
    for spec in SCHEMA["events"].values():
        for d in spec["details"]:
            assert len(d) <= 20 and "/" not in d and " " not in d
        assert set(spec["dims"]) <= set(SCHEMA["dimensions"])


def test_unknown_values_rejected():
    assert is_valid_cell_key("send|na|na|na|na|kisa")
    assert not is_valid_cell_key("send|chatgpt|18-24|kod|4-6|merhaba")
    assert not is_valid_cell_key("bilinmeyen_olay|-")
