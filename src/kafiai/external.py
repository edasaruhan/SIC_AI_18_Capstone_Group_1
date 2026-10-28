"""Dış sohbet veri setlerini (ShareChat, LMSYS-Chat-1M) projenin ortak biçimine çevirir.

Ortak biçim (data.py'deki diğer kaynaklarla aynı kolonlar ve ek olarak platform):
    conversation_hash, timestamp, model, platform, language, country, hashed_ip,
    user_msgs, n_user_msgs, first_prompt

Bu setler yalnızca değerlendirmede kullanılır, eğitime girmez ve ham hâlleri depoya girmez
(ShareChat CC BY-NC, LMSYS kullanım koşullu). Yalnızca kullanıcı mesajları alınır; asistan
cevapları atılır. Veri setlerinin mesaj biçimleri farklı olduğu için çevirici esnek yazıldı:
mesaj listesi farklı alan adlarında (conversation, messages, turns ...), rol farklı adlarla
(role, from, author) ve içerik farklı biçimlerde (düz metin, parça listesi) gelebilir.
"""

import hashlib

from kafiai.config import EXTERNAL_KEEP_CHARS

MESSAGE_LIST_KEYS = ("conversation", "conversations", "messages", "turns", "dialog", "chat", "history")
ROLE_KEYS = ("role", "from", "author", "speaker", "sender")
CONTENT_KEYS = ("content", "text", "value", "message", "parts")
USER_ROLES = {"user", "human", "usr", "prompter", "you"}
ID_KEYS = ("conversation_id", "conv_id", "id", "share_id", "url_hash", "chat_id")
MODEL_KEYS = ("model", "model_name", "model_version", "model_slug")
LANGUAGE_KEYS = ("language", "lang", "detected_language")
USER_ID_KEYS = ("user_id", "user", "author_id", "hashed_ip", "uploader")
TIME_KEYS = ("timestamp", "create_time", "created_at", "date", "time")


def _first(record, keys):
    for k in keys:
        if k in record and record[k] not in (None, ""):
            return record[k]
    return None


def _text(content):
    """Mesaj içeriğini düz metne çevirir (parça listeleri ve iç içe sözlükler dahil)."""
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, dict):
        inner = _first(content, CONTENT_KEYS)
        return _text(inner) if inner is not None else ""
    if isinstance(content, (list, tuple)):
        return "\n".join(t for t in (_text(c) for c in content) if t)
    return str(content)


def message_list(record):
    """Kayıttaki mesaj listesini bulur; yoksa None."""
    for k in MESSAGE_LIST_KEYS:
        v = record.get(k)
        if v is not None and hasattr(v, "__len__") and not isinstance(v, (str, dict)):
            return list(v)
    return None


def user_messages(record):
    """Kayıttan kullanıcı mesajlarını sırayla döner (boş olanlar atılır, uzunlar kesilir)."""
    msgs = message_list(record) or []
    out = []
    for m in msgs:
        if not isinstance(m, dict):
            continue
        role = str(_first(m, ROLE_KEYS) or "").strip().lower()
        if role not in USER_ROLES:
            continue
        text = _text(_first(m, CONTENT_KEYS)).strip()
        if text:
            out.append(text[:EXTERNAL_KEEP_CHARS])
    return out


def to_common(record, source, platform=None):
    """Tek kaydı ortak biçime çevirir; kullanıcı mesajı yoksa None."""
    msgs = user_messages(record)
    if not msgs:
        return None
    raw_id = _first(record, ID_KEYS)
    basis = f"{source}:{raw_id}" if raw_id is not None else f"{source}:" + "␞".join(msgs[:3])
    conv_hash = hashlib.sha1(basis.encode("utf-8")).hexdigest()
    user = _first(record, USER_ID_KEYS)
    # Kullanıcı kimliği yoksa her sohbet ayrı kullanıcı sayılır (bootstrap sohbet bazlı olur).
    hashed_user = hashlib.sha1(f"{source}:u:{user}".encode("utf-8")).hexdigest() if user is not None else conv_hash
    model = _first(record, MODEL_KEYS)
    return {
        "conversation_hash": conv_hash,
        "timestamp": _first(record, TIME_KEYS),
        "model": str(model) if model is not None else "",
        "platform": platform or str(_first(record, ("platform", "source", "provider")) or "").lower(),
        "language": str(_first(record, LANGUAGE_KEYS) or ""),
        "country": "",
        "hashed_ip": hashed_user,
        "user_msgs": msgs,
        "n_user_msgs": len(msgs),
        "first_prompt": msgs[0],
    }


def schema_summary(record, depth=0):
    """--inspect için kaydın yapısını içerik göstermeden özetler (alan adları ve türleri)."""
    pad = "  " * depth
    lines = []
    for k, v in record.items():
        kind = type(v).__name__
        if isinstance(v, dict) and depth < 2:
            lines.append(f"{pad}{k}: dict")
            lines += schema_summary(v, depth + 1)
        elif isinstance(v, (list, tuple)) and v and isinstance(v[0], dict) and depth < 2:
            lines.append(f"{pad}{k}: list[{len(v)}] of dict")
            lines += schema_summary(v[0], depth + 1)
        elif isinstance(v, str):
            # Metin gösterilmez; yalnızca kısa sabit değerler (rol adları gibi) yazılır.
            lines.append(f"{pad}{k}: str" + (f" = {v!r}" if len(v) <= 20 and k.lower() in {*ROLE_KEYS, "platform", "source", "language", "lang", "model"} else ""))
        else:
            lines.append(f"{pad}{k}: {kind}")
    return lines
