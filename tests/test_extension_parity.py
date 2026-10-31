"""Python ikizinin eklentiyle aynı sonucu verdiğini kontrol eder.

Örnekler eklentinin kendi kodundan üretildi (extension: npm run parity-fixture).
Aynı dosyayı eklentideki similarity.parity.test.ts de okuyor.
"""

import json
import re
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from kafiai import config  # noqa: E402
from kafiai.extension_similarity import is_comparable, normalize_text, similarity  # noqa: E402

FIXTURE = json.loads((ROOT / "tests" / "fixtures" / "similarity_parity.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("row", FIXTURE, ids=[r["a"][:25] or "bos" for r in FIXTURE])
def test_same_result_as_extension(row):
    assert normalize_text(row["a"]) == row["normalized_a"]
    assert normalize_text(row["b"]) == row["normalized_b"]
    assert similarity(row["a"], row["b"]) == pytest.approx(row["similarity"], abs=1e-12)


def test_short_messages_are_not_compared():
    assert not is_comparable("devam et")
    assert is_comparable("bu kodu tekrar düzelt")


def test_config_matches_extension():
    """config.py ile extension/src/config.ts aynı değerleri kullanmalı."""
    source = (ROOT / "extension" / "src" / "config.ts").read_text(encoding="utf-8")

    def ts_value(name):
        match = re.search(rf"export const {name} = ([\d_.]+)", source)
        assert match, f"{name} config.ts içinde bulunamadı"
        return float(match.group(1).replace("_", ""))

    pairs = {
        "NGRAM_SIZE": config.EXT_NGRAM_SIZE,
        "HASH_DIM": config.EXT_HASH_DIM,
        "MIN_NORMALIZED_CHARS": config.EXT_MIN_NORMALIZED_CHARS,
        "RECENT_MESSAGES": config.EXT_RECENT_MESSAGES,
        "SIMILARITY_THRESHOLD": config.EXT_SIMILARITY_THRESHOLD,
        "SOFT_SIMILARITY_THRESHOLD": config.EXT_SOFT_SIMILARITY_THRESHOLD,
        "EXIT_CARD_MIN_TURNS": config.EXT_EXIT_CARD_MIN_TURNS,
        "EXIT_CARD_MIN_REPEATS": config.EXT_EXIT_CARD_MIN_REPEATS,
        "EXIT_CARD_COOLDOWN_TURNS": config.EXT_EXIT_CARD_COOLDOWN_TURNS,
    }
    for name, python_value in pairs.items():
        assert ts_value(name) == python_value, f"{name}: config.ts ile config.py farklı"


def test_repeat_rule_matches_fixture():
    """Şerit kuralı (benzerlik + yeni içerik yok): Python ile eklenti aynı karar."""
    from kafiai.extension_similarity import is_repeat, new_content
    rows = json.loads((ROOT / "tests" / "fixtures" / "repeat_parity.json").read_text(encoding="utf-8"))
    for r in rows:
        assert new_content(r["new"], r["previous"]) == r["new_content"], r["new"]
        assert is_repeat(r["new"], r["previous"]) == r["repeat"], r["new"]
