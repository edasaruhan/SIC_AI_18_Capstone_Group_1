"""Eklentinin benzerlik hesabının Python ikizi.

Chrome eklentisi (`extension/src/core/text.ts` ve `similarity.ts`) iki mesajın benzerliğini
şöyle hesaplıyor:

    1. Metni sadeleştir: Türkçeye uygun küçük harf, noktalamayı at, boşlukları teke indir.
    2. Başına ve sonuna birer boşluk ekleyip 3 karakterlik parçalara (3-gram) böl.
    3. Her parçayı FNV-1a ile 1024 kutudan birine at ve kutuları say.
    4. İki sayım vektörünün kosinüs benzerliğini al.

Bu dosya aynı hesabı Python'da birebir yapar. Böylece eklentinin eşiklerini gerçek
WildChat sohbetleri üzerinde deneyebiliyoruz: Python'da 0,62 çıkan bir benzerlik,
tarayıcıda da 0,62 çıkar. İki tarafın aynı sonucu verdiğini
`tests/fixtures/similarity_parity.json` dosyası üzerinden hem Python hem JavaScript
testleri kontrol eder.
"""

import json
import math
import re
import unicodedata
from pathlib import Path

from kafiai.config import EXT_HASH_DIM, EXT_MIN_NORMALIZED_CHARS, EXT_NGRAM_SIZE

_SPACES = re.compile(r"\s+")


def normalize_text(text):
    """`text.ts` içindeki normalizeText fonksiyonunun aynısı."""
    text = unicodedata.normalize("NFC", text or "")
    text = text.replace("İ", "i").replace("I", "ı").lower()
    # Harf ve rakam dışındaki her karakter (noktalama, emoji) boşluğa çevrilir.
    kept = []
    for ch in text:
        category = unicodedata.category(ch)
        if category[0] in ("L", "N") or ch.isspace():
            kept.append(ch)
        else:
            kept.append(" ")
    return _SPACES.sub(" ", "".join(kept)).strip()


def _fnv1a(chunk):
    """32 bitlik FNV-1a; JavaScript'teki Math.imul ile aynı sonucu verir."""
    value = 0x811C9DC5
    for ch in chunk:
        value ^= ord(ch)
        value = (value * 0x01000193) & 0xFFFFFFFF
    return value


def ngram_vector(normalized, n=EXT_NGRAM_SIZE, dim=EXT_HASH_DIM):
    """Sadeleştirilmiş metni {kutu: sayı} sözlüğüne çevirir."""
    chars = f" {normalized} "
    vector = {}
    for i in range(len(chars) - n + 1):
        bucket = _fnv1a(chars[i:i + n]) % dim
        vector[bucket] = vector.get(bucket, 0) + 1
    return vector


def cosine(a, b):
    dot = sum(value * b.get(key, 0) for key, value in a.items())
    norm_a = sum(v * v for v in a.values())
    norm_b = sum(v * v for v in b.values())
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / math.sqrt(norm_a * norm_b)


def similarity(a, b):
    """İki mesajın benzerliği, 0 ile 1 arası. Mesajlar önce sadeleştirilir."""
    return cosine(ngram_vector(normalize_text(a)), ngram_vector(normalize_text(b)))


def is_comparable(text):
    """Eklenti 12 karakterden kısa mesajları ("devam et", "evet") hiç karşılaştırmaz."""
    return len(normalize_text(text)) >= EXT_MIN_NORMALIZED_CHARS


_REPEAT_RULES = json.loads(
    (Path(__file__).resolve().parents[2] / "extension" / "src" / "data" / "repeat-rules.json").read_text(encoding="utf-8")
)
_FILLER = set(_REPEAT_RULES["filler"])


def _content_tokens(normalized):
    return [t for t in normalized.split() if t not in _FILLER
            and (len(t) >= _REPEAT_RULES["min_token_chars"] or any(c.isdigit() for c in t))]


def new_content(new_text, previous_text):
    """Yeni mesajın öncekinde karşılığı olmayan içerik kelimeleri (repeat-detector.ts ile aynı kural)."""
    stem = _REPEAT_RULES["stem_chars"]
    prev = normalize_text(previous_text).split()
    prev_set = set(prev)
    prev_stems = {t[:stem] for t in prev if len(t) >= stem and not any(c.isdigit() for c in t)}
    out = []
    for t in _content_tokens(normalize_text(new_text)):
        if t in prev_set:
            continue
        if not any(c.isdigit() for c in t) and len(t) >= stem and t[:stem] in prev_stems:
            continue
        out.append(t)
    return out


def is_repeat(new_text, previous_text, threshold=None):
    """Şerit kuralı: benzerlik eşiği geçiyor ve yeni mesaj yeni bir içerik getirmiyor."""
    from kafiai.config import EXT_SIMILARITY_THRESHOLD
    limit = EXT_SIMILARITY_THRESHOLD if threshold is None else threshold
    return similarity(new_text, previous_text) >= limit and not new_content(new_text, previous_text)
