"""Eklenti sayaçlarının Python tarafı: şema doğrulama, kovalar ve sohbet sonucu.

Eklenti sayaçları `extension/src/data/counter-schema.json` şemasına göre tutar (karar K18).
Bu modül aynı şemayı okur; pilotta katılımcıların kopyaladığı sayaç çıktıları önce burada
doğrulanır (scripts/pilot_summary.py). Kurallar `extension/src/core/counters.ts` ile birebir
aynıdır; iki tarafı `tests/fixtures/counter_parity.json` sınar.
"""

import json
import re
from pathlib import Path

from kafiai.config import EXACT_REPEAT_THRESHOLD
from kafiai.extension_similarity import similarity
from kafiai.text import has_strong_repair

SCHEMA_FILE = Path(__file__).resolve().parents[2] / "extension" / "src" / "data" / "counter-schema.json"
SCHEMA = json.loads(SCHEMA_FILE.read_text(encoding="utf-8"))
UNKNOWN = SCHEMA["unknown"]
_DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def len_bucket(turns):
    if not isinstance(turns, int) or turns < 1:
        return UNKNOWN
    uppers = SCHEMA["buckets"]["len_upper"]
    values = SCHEMA["dimensions"]["len"]
    for i, upper in enumerate(uppers):
        if turns <= upper:
            return values[i]
    return values[len(uppers)]


def first_len_bucket(text):
    n = len(text or "")
    uppers = SCHEMA["buckets"]["first_len_upper_chars"]
    values = SCHEMA["dimensions"]["first_len"]
    for i, upper in enumerate(uppers):
        if n <= upper:
            return values[i]
    return values[len(uppers)]


def slot_of_hour(hour):
    starts = SCHEMA["buckets"]["slot_start_hours"]
    i = 0
    while i + 1 < len(starts) and hour >= starts[i + 1]:
        i += 1
    return SCHEMA["dimensions"]["slot"][i]


def is_valid_cell_key(key):
    parts = key.split("|")
    spec = SCHEMA["events"].get(parts[0])
    if spec is None or len(parts) != len(spec["dims"]) + 2:
        return False
    for dim, value in zip(spec["dims"], parts[1:-1]):
        if value != UNKNOWN and value not in SCHEMA["dimensions"][dim]:
            return False
    return parts[-1] in spec["details"]


def validate_export(obj):
    """Kopyalanan sayaç çıktısının şemaya uygunluğu. Hata listesi döner; boşsa geçerli."""
    if not isinstance(obj, dict):
        return ["nesne değil"]
    errors = []
    if obj.get("schema") != SCHEMA["schema"]:
        errors.append("schema alanı yanlış")
    if obj.get("version") != SCHEMA["version"]:
        errors.append("version alanı yanlış")
    for key in obj:
        if key not in {"schema", "version", "exported", "days"}:
            errors.append(f"izin verilmeyen alan: {key}")
    if "exported" in obj and not (isinstance(obj["exported"], str) and _DAY.match(obj["exported"])):
        errors.append("exported alanı YYYY-MM-DD olmalı")
    days = obj.get("days")
    if not isinstance(days, dict):
        return errors + ["days alanı yok"]
    for day, rec in days.items():
        if not _DAY.match(day):
            errors.append(f"geçersiz gün: {day}")
        rec = rec if isinstance(rec, dict) else {}
        if rec.get("phase") not in SCHEMA["phases"]:
            errors.append(f"{day}: geçersiz faz")
        for key in rec:
            if key not in {"phase", "c"}:
                errors.append(f"{day}: izin verilmeyen alan {key}")
        for key, n in (rec.get("c") or {}).items():
            if not is_valid_cell_key(key):
                errors.append(f"{day}: geçersiz hücre {key}")
            if not (isinstance(n, int) and not isinstance(n, bool) and n > 0):
                errors.append(f"{day}: geçersiz sayı {key}")
    return errors


def loop_outcome(user_texts):
    """Sohbetin sonucu ("dongu" ya da "normal"); eklentideki counters.loopOutcome ile aynı kural."""
    later = list(user_texts)[1:]
    exact = sum(similarity(a, b) >= EXACT_REPEAT_THRESHOLD for a, b in zip(later, later[1:]))
    repairs = sum(has_strong_repair(t) for t in list(user_texts)[2:])
    return "dongu" if repairs >= 2 or (repairs >= 1 and exact >= 1) else "normal"
