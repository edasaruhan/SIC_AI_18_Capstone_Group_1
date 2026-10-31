"""Dış etiketlerle doğrulama (P4 ek): kurallarımız ve tur modeli, insan ya da sonuç etiketine karşı.

Modelin hedefi kurallarla üretilmiş bir vekil etiket (etiket v2). Bu script iki bağımsız ölçüte
bakar; ikisi de yalnızca değerlendirmede kullanılır, eğitime girmez, ham hâlleri depoya girmez:

    EmoWOZ (CC BY-NC 4.0)      görev odaklı diyaloglarda kullanıcı mesajlarına insanların verdiği
                               duygu etiketi. "Memnuniyetsiz" (2) ve "kaba" (4) etiketleri, güçlü
                               onarım kuralımızın mesaj düzeyinde ne kadar isabetli olduğunu ölçer.
    Microsoft ChatBench (CC BY 4.0)  gerçek kullanıcıların bir yapay zekayla soru çözdüğü sohbetler ve
                               kullanıcının son cevabının doğru olup olmadığı (acc). Döngü sinyallerinin
                               "yanlış sonuca varma" ile ilişkisini nesnel bir sonuçla ölçer.

Çalıştırma (repo kökünde, internet gerekir; ikisi birlikte birkaç on MB):
    python scripts/evaluate_external_labels.py --inspect    # dosyaları ve kayıt yapısını göster
    python scripts/evaluate_external_labels.py
Çıktı: outputs/external_labels.json (yalnızca toplam sayılar; repoya girer)
"""

import argparse
import json
import re
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from kafiai.config import EXT_SIMILARITY_THRESHOLD, SEED  # noqa: E402
from kafiai.counters import loop_outcome  # noqa: E402
from kafiai.extension_similarity import similarity  # noqa: E402
from kafiai.external import _first, schema_summary, user_messages  # noqa: E402
from kafiai.text import has_repair, has_strong_repair  # noqa: E402
from kafiai.turn_features import turn_features  # noqa: E402
from kafiai.turn_model import load_model, load_reasons, predict  # noqa: E402

OUT = ROOT / "outputs" / "external_labels.json"
EMOWOZ_REPO = "hhu-dsml/emowoz"
CHATBENCH_REPO = "microsoft/ChatBench"
# EmoWOZ duygu kodları (veri seti kartı): 0 nötr, 1 korku/üzüntü, 2 memnuniyetsiz, 3 özür,
# 4 kaba, 5 heyecanlı, 6 memnun; sistem mesajları -1.
EMOWOZ_NEGATIVE = {2, 4}
SYSTEM = -1


# ---------------------------------------------------------------------------
# Ortak ölçüler
# ---------------------------------------------------------------------------

def binary_report(pred, gold):
    """Kesinlik, yakalama, F1 ve oranlar; pred ve gold 0/1 dizileri."""
    pred, gold = np.asarray(pred, dtype=int), np.asarray(gold, dtype=int)
    tp = int(((pred == 1) & (gold == 1)).sum())
    fp = int(((pred == 1) & (gold == 0)).sum())
    fn = int(((pred == 0) & (gold == 1)).sum())
    precision = tp / (tp + fp) if tp + fp else None
    recall = tp / (tp + fn) if tp + fn else None
    f1 = 2 * precision * recall / (precision + recall) if precision and recall else None
    base = float(gold.mean()) if len(gold) else None
    return {"n": int(len(gold)), "positives": int(gold.sum()), "base_rate": _r(base),
            "flagged": int(pred.sum()), "precision": _r(precision), "recall": _r(recall), "f1": _r(f1),
            "lift": _r(precision / base) if precision is not None and base else None}


def rate_with_ci(values, rng, reps=1000):
    """Oran ve bootstrap %95 aralığı."""
    v = np.asarray(values, dtype=float)
    if len(v) == 0:
        return {"n": 0, "rate": None, "ci": None}
    boots = [v[rng.integers(0, len(v), len(v))].mean() for _ in range(reps)]
    return {"n": int(len(v)), "rate": _r(v.mean()), "ci": [_r(np.percentile(boots, 2.5)), _r(np.percentile(boots, 97.5))]}


def _r(x, nd=4):
    return None if x is None else round(float(x), nd)


def download(repo, patterns):
    from huggingface_hub import HfApi, hf_hub_download
    files = [f for f in HfApi().list_repo_files(repo, repo_type="dataset") if any(re.search(p, f) for p in patterns)]
    return files, (lambda f: hf_hub_download(repo, f, repo_type="dataset"))


# ---------------------------------------------------------------------------
# EmoWOZ: mesaj düzeyinde memnuniyetsizlik
# ---------------------------------------------------------------------------

def emowoz_turns(record):
    """Kayıttan (metin, duygu) çiftleri. log alanı liste-sözlük ya da sözlük-liste olabilir."""
    log = record.get("log", record.get("turns", record.get("dialogue")))
    if isinstance(log, dict):  # {"text": [...], "emotion": [...]}
        texts, emos = list(log.get("text", [])), list(log.get("emotion", []))
        return [(str(t), _emotion_code(e)) for t, e in zip(texts, emos)]
    out = []
    for turn in log or []:
        if isinstance(turn, dict):
            out.append((str(turn.get("text", "")), _emotion_code(turn.get("emotion", SYSTEM))))
    return out


def _emotion_code(e):
    """Duygu kodu: sayı, ya da Zenodo sürümündeki gibi [{"emotion": 2, ...}] listesi."""
    if isinstance(e, (list, tuple)) and e:
        e = e[0].get("emotion", SYSTEM) if isinstance(e[0], dict) else e[0]
    if isinstance(e, dict):
        e = e.get("emotion", SYSTEM)
    try:
        return int(e)
    except (TypeError, ValueError):
        return SYSTEM


def load_emowoz(inspect=False):
    files, get = download(EMOWOZ_REPO, [r"\.parquet$", r"\.jsonl?$"])
    if not files:  # yükleme betikli eski depo: otomatik parquet dönüşümünü dene
        from huggingface_hub import HfApi, hf_hub_download
        files = [f for f in HfApi().list_repo_files(EMOWOZ_REPO, repo_type="dataset", revision="refs/convert/parquet")
                 if f.endswith(".parquet") and "emowoz" in f]
        get = lambda f: hf_hub_download(EMOWOZ_REPO, f, repo_type="dataset", revision="refs/convert/parquet")  # noqa: E731
    print("EmoWOZ dosyaları:", *files, sep="\n  ")
    records = []
    for f in files:
        path = get(f)
        if f.endswith(".parquet"):
            import pandas as pd
            records += pd.read_parquet(path).to_dict("records")
        else:
            text = Path(path).read_text(encoding="utf-8")
            data = json.loads(text) if text.lstrip().startswith(("{", "[")) and not f.endswith(".jsonl") else \
                [json.loads(line) for line in text.splitlines() if line.strip()]
            records += list(data.values()) if isinstance(data, dict) else data
        if inspect and records:
            print("\nİlk kaydın yapısı:", *schema_summary(records[0]), sep="\n  ")
            return []
    # Aynı diyalog birden çok dosyada (yapılandırma) geçebilir: kimliğe göre tekilleştir.
    seen, unique = set(), []
    for r in records:
        key = r.get("dialogue_id") or id(r)
        if key not in seen:
            seen.add(key)
            unique.append(r)
    return unique


def evaluate_emowoz(records):
    strong, weak, gold, dlg_pred, dlg_gold = [], [], [], [], []
    for r in records:
        turns = [(t, e) for t, e in emowoz_turns(r) if e != SYSTEM and t.strip()]
        if not turns:
            continue
        for text, emo in turns:
            strong.append(int(has_strong_repair(text)))
            weak.append(int(has_repair(text)))
            gold.append(int(emo in EMOWOZ_NEGATIVE))
        texts = [t for t, _ in turns]
        dlg_pred.append(int(loop_outcome(texts) == "dongu"))
        dlg_gold.append(int(sum(e in EMOWOZ_NEGATIVE for _, e in turns) >= 2))
    return {
        "dialogues": len(dlg_gold),
        "message_strong_repair": binary_report(strong, gold),
        "message_any_repair_v1": binary_report(weak, gold),
        "dialogue_loop_vs_two_negative": binary_report(dlg_pred, dlg_gold),
        "note": "Görev odaklı diyaloglar (otel, restoran, ulaşım); alan farklı, tamamlayıcı kanıt.",
    }


# ---------------------------------------------------------------------------
# ChatBench: döngü sinyalleri ve yanlış cevap
# ---------------------------------------------------------------------------

_SPEAKER = re.compile(r"^\s*(user|human|you|kullanıcı)\s*:\s*", re.IGNORECASE)
_OTHER = re.compile(r"^\s*(assistant|ai|gpt|llama|bot|model|system)\s*:\s*", re.IGNORECASE)


def chatbench_user_messages(history):
    """chat_history: mesaj listesi, JSON metni ya da "User: ... / AI: ..." biçiminde düz metin."""
    if isinstance(history, str):
        s = history.strip()
        if s.startswith(("[", "{")):
            try:
                history = json.loads(s)
            except json.JSONDecodeError:
                pass
    if isinstance(history, dict):
        history = history.get("messages", history.get("conversation", [history]))
    if isinstance(history, (list, tuple)):
        return user_messages({"messages": [m for m in history if isinstance(m, dict)]})
    if isinstance(history, str):
        msgs, current, speaker = [], [], None
        for line in history.splitlines():
            if _SPEAKER.match(line):
                if speaker == "user" and current:
                    msgs.append("\n".join(current).strip())
                speaker, current = "user", [_SPEAKER.sub("", line)]
            elif _OTHER.match(line):
                if speaker == "user" and current:
                    msgs.append("\n".join(current).strip())
                speaker, current = "other", []
            elif speaker == "user":
                current.append(line)
        if speaker == "user" and current:
            msgs.append("\n".join(current).strip())
        return [m for m in msgs if m]
    return []


def load_chatbench(inspect=False, include_pilots=False):
    pattern = r"conversations\.jsonl?$" if include_pilots else r"^full_study/conversations\.jsonl?$"
    files, get = download(CHATBENCH_REPO, [pattern])
    print("ChatBench dosyaları:", *files, sep="\n  ")
    records = []
    for f in files:
        text = Path(get(f)).read_text(encoding="utf-8")
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            data = [json.loads(line) for line in text.splitlines() if line.strip()]
        if isinstance(data, dict):
            data = data.get("data", list(data.values()))
        records += data
        if inspect and records:
            rec = dict(records[0])
            hist = rec.get("chat_history")
            print("\nİlk kaydın yapısı:", *schema_summary({k: v for k, v in rec.items() if k != "chat_history"}), sep="\n  ")
            print(f"  chat_history: {type(hist).__name__}; çıkarılan kullanıcı mesajı sayısı {len(chatbench_user_messages(hist))}")
            return []
    return records


def evaluate_chatbench(records, rng):
    model, reasons = load_model(), load_reasons()
    rows = []
    for r in records:
        acc = _first(r, ("acc", "correct", "is_correct"))
        msgs = chatbench_user_messages(r.get("chat_history"))
        if acc is None or not msgs:
            continue
        try:
            wrong = int(float(acc) == 0)
        except (TypeError, ValueError):
            continue
        similar = sum(similarity(a, b) >= EXT_SIMILARITY_THRESHOLD for a, b in zip(msgs, msgs[1:]))
        repairs = sum(has_strong_repair(m) for m in msgs[1:])
        prob = predict(turn_features(msgs, len(msgs)), model=model, reasons=reasons)["probability"] if len(msgs) >= 2 else None
        rows.append({"wrong": wrong, "turns": len(msgs), "similar": similar, "repairs": repairs,
                     "loop": loop_outcome(msgs) == "dongu", "prob": prob, "model": str(r.get("model", ""))})
    if not rows:
        return {"conversations": 0}

    def wrong_rate(sel):
        return rate_with_ci([x["wrong"] for x in rows if sel(x)], rng)

    out = {
        "conversations": len(rows),
        "wrong_rate_all": wrong_rate(lambda x: True),
        "by_signal": {
            "single_message": wrong_rate(lambda x: x["turns"] == 1),
            "multi_message": wrong_rate(lambda x: x["turns"] >= 2),
            "any_similar_pair": wrong_rate(lambda x: x["similar"] > 0),
            "no_similar_pair": wrong_rate(lambda x: x["turns"] >= 2 and x["similar"] == 0),
            "any_strong_repair": wrong_rate(lambda x: x["repairs"] > 0),
            "no_strong_repair": wrong_rate(lambda x: x["turns"] >= 2 and x["repairs"] == 0),
            "loop_outcome_dongu": wrong_rate(lambda x: x["loop"]),
        },
        "by_turns": {b: wrong_rate(lambda x, lo=lo, hi=hi: lo <= x["turns"] <= hi)
                     for b, lo, hi in [("1", 1, 1), ("2", 2, 2), ("3-4", 3, 4), ("5+", 5, 10_000)]},
        "by_model": {m: wrong_rate(lambda x, m=m: x["model"] == m) for m in sorted({x["model"] for x in rows})},
    }
    scored = [x for x in rows if x["prob"] is not None]
    if scored and len({x["wrong"] for x in scored}) == 2:
        from sklearn.metrics import roc_auc_score
        y = np.array([x["wrong"] for x in scored])
        p = np.array([x["prob"] for x in scored])
        out["turn_model_auc_for_wrong"] = {"n": len(scored), "auc": _r(roc_auc_score(y, p))}
    out["note"] = ("Kullanıcılar çoktan seçmeli sorular çözüyor; görev bizim kullanım alanımızdan dar. "
                   "İlişki nedensel değil: zor sorular hem uzun sohbete hem yanlış cevaba yol açabilir.")
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--inspect", action="store_true", help="dosyaları ve ilk kaydın yapısını göster; ölçme yapma")
    ap.add_argument("--with-pilots", action="store_true", help="ChatBench'in iki ön çalışmasını da kat")
    args = ap.parse_args()

    from huggingface_hub.errors import GatedRepoError
    rng = np.random.default_rng(SEED)
    out = {}
    try:
        emo = load_emowoz(args.inspect)
        cb = load_chatbench(args.inspect, args.with_pilots)
    except GatedRepoError as e:
        print(f"Erişim izni yok: {e}\nVeri setinin Hugging Face sayfasında erişim iste, sonra tekrar çalıştır.")
        return 1
    if args.inspect:
        return 0

    if emo:
        out["emowoz"] = evaluate_emowoz(emo)
        m = out["emowoz"]["message_strong_repair"]
        print(f"\nEmoWOZ: {out['emowoz']['dialogues']:,} diyalog, {m['n']:,} kullanıcı mesajı; memnuniyetsiz/kaba %{m['base_rate'] * 100:.1f}")
        print(f"  güçlü onarım kuralı: kesinlik {m['precision']}, yakalama {m['recall']}, kat {m['lift']}")
    if cb:
        out["chatbench"] = evaluate_chatbench(cb, rng)
        c = out["chatbench"]
        print(f"\nChatBench: {c['conversations']:,} sohbet; yanlış cevap oranı {c['wrong_rate_all']['rate']}")
        for k, v in c["by_signal"].items():
            print(f"  {k:22s} n={v['n']:5d} yanlış={v['rate']} {v['ci']}")
        if "turn_model_auc_for_wrong" in c:
            print(f"  tur modeli olasılığı ile yanlış cevap AUC: {c['turn_model_auc_for_wrong']['auc']}")
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"\nSonuç: {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
