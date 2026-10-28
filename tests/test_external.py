"""Dış veri setlerini ortak biçime çeviren kodun testi (P4). Veri gerekmez; kayıtlar uydurma."""

import importlib.util
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from kafiai.external import schema_summary, to_common, user_messages  # noqa: E402


def _load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_lmsys_record():
    rec = {"conversation_id": "abc", "model": "claude-v1", "language": "English", "turn": 2,
           "conversation": np.array([{"role": "user", "content": "fix my code"}, {"role": "assistant", "content": "ok"},
                                     {"role": "user", "content": "still not working"}], dtype=object)}
    c = to_common(rec, "lmsys", platform="lmsys")
    assert c["user_msgs"] == ["fix my code", "still not working"]
    assert c["n_user_msgs"] == 2 and c["model"] == "claude-v1" and c["platform"] == "lmsys"
    assert c["hashed_ip"] == c["conversation_hash"]  # kullanıcı kimliği yok: her sohbet ayrı kullanıcı
    assert "abc" not in c["conversation_hash"]


def test_other_shapes():
    rec = {"messages": [{"from": "human", "value": [{"text": "merhaba"}, {"text": "nasılsın"}]},
                        {"from": "gpt", "value": "iyi"}, {"author": "USER", "text": "  "}]}
    assert user_messages(rec) == ["merhaba\nnasılsın"]
    assert to_common({"messages": [{"role": "assistant", "content": "x"}]}, "s") is None


def test_long_messages_truncated_and_same_id_same_hash():
    rec = {"id": 7, "messages": [{"role": "user", "content": "a" * 5000}]}
    c1, c2 = to_common(rec, "s"), to_common(dict(rec), "s")
    assert len(c1["user_msgs"][0]) == 2000
    assert c1["conversation_hash"] == c2["conversation_hash"]
    assert to_common(rec, "baska")["conversation_hash"] != c1["conversation_hash"]


def test_schema_summary_hides_content():
    rec = {"url": "https://chatgpt.com/share/gizli", "role": "user", "plain_text": "kişisel bir metin",
           "conversation": [{"role": "user", "content": "gizli içerik"}]}
    text = "\n".join(schema_summary(rec))
    assert "gizli" not in text and "kişisel" not in text
    assert "role: str = 'user'" in text


def test_sharechat_convert_groups_by_url(tmp_path):
    mod = _load("fetch_sharechat")
    rows = [
        {"platform": "gemini", "url": "u1", "message_index": 2, "role": "user", "plain_text": "ikinci", "detected_language_final": "tr", "model": "2.5"},
        {"platform": "gemini", "url": "u1", "message_index": 0, "role": "user", "plain_text": "birinci", "detected_language_final": "tr", "model": "2.5"},
        {"platform": "gemini", "url": "u1", "message_index": 1, "role": "model", "plain_text": "cevap", "detected_language_final": "tr", "model": "2.5"},
        {"platform": "GPT", "url": "u2", "message_index": 0, "role": "user", "plain_text": "tek", "detected_language_final": "en", "model": ""},
    ]
    path = tmp_path / "x.csv"
    pd.DataFrame(rows).to_csv(path, index=False)
    out = {c["platform"]: c for c in mod.convert(str(path), "x")}
    assert out["gemini"]["user_msgs"] == ["birinci", "ikinci"]
    assert out["chatgpt"]["user_msgs"] == ["tek"]
    assert all("u1" not in c["conversation_hash"] for c in out.values())


def test_family_and_recommendation_rules():
    mod = _load("evaluate_platforms")
    assert [mod.family(m) for m in ["gpt-4o-mini-2024", "gpt-4-0314", "gpt-3.5-turbo", "claude-instant", "vicuna-13b", "x"]] == \
        ["GPT-4o", "GPT-4", "GPT-3.5", "Claude", "Vicuna", "Diğer"]
    good = {"n_labelled_conversations": 500, "pr_auc": 0.3, "lift": 2.0, "high_precision": 0.35}
    weak = {"n_labelled_conversations": 500, "pr_auc": 0.12, "lift": 1.2, "high_precision": 0.30}
    few = {"n_labelled_conversations": 50, "pr_auc": 0.3, "lift": 2.0, "high_precision": 0.4}
    results = {mod.REFERENCE: {"Tümü": {"high_precision": 0.376}}, "ShareChat": {"chatgpt": good, "gemini": weak, "claude": few}}
    recs = mod.recommend(results)
    assert recs["chatgpt"]["model"] == "on"
    assert recs["gemini"]["model"] == "off" and recs["google_ai_mode"]["model"] == "off"
    assert recs["claude"]["model"] == "karar yok"
    assert "vekil" in recs["copilot"]["note"]
