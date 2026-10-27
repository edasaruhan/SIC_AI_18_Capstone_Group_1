"""Kişisel ve duygusal mesaj tespiti.

İlke: kişisel ve duygusal sohbetlerde öneri gösterilmez. Kurallar
`extension/src/data/personal-rules.json` dosyasında; eklenti (`src/core/personal.ts`) aynı dosyayı
okur ve iki tarafı `tests/fixtures/personal_parity.json` sınar.

Bir mesaj, kurallardaki kelime gruplarından biri sadeleştirilmiş metinde tam kelime sınırlarıyla
geçiyorsa kişisel sayılır. Mesaj bir kurgu isteğiyse ("write a story", "şiir yaz") yalnızca
kendine zarar ifadeleri sayılır. Metin iki kez sadeleştirilir: Türkçe kuralla (I → ı) ve
İngilizce kuralla (I → i); böylece "I'm sad" de "ÜZGÜNÜM" de yakalanır.
"""

import json
from pathlib import Path

from kafiai.extension_similarity import normalize_text

RULES_FILE = Path(__file__).resolve().parents[2] / "extension" / "src" / "data" / "personal-rules.json"
_RULES = json.loads(RULES_FILE.read_text(encoding="utf-8"))


def _variants(text):
    raw = text or ""
    tr = normalize_text(raw)
    en = normalize_text(raw.replace("I", "i"))
    return [f" {tr} "] if tr == en else [f" {tr} ", f" {en} "]


def _hit(padded_variants, phrases):
    return any(f" {p} " in v for v in padded_variants for p in phrases)


def is_personal(text):
    variants = _variants(text)
    if _hit(variants, _RULES["fiction_markers"]):
        return _hit(variants, _RULES["fiction_exempt"])
    return _hit(variants, _RULES["phrases"])
