"""Çok platformlu sınama (P4): tur modeli ve eklenti kuralları eğitim dışındaki veride nasıl çalışıyor?

Model WildChat 4.8M ile (ChatGPT API'si üzerinden GPT-3.5/4 sohbetleri) eğitildi. Eklenti ise
ChatGPT, Gemini ve ileride Claude, Copilot ve Google AI Modu arayüzlerinde çalışacak. Bu script,
eğitime hiç girmemiş verilerde aynı ölçüleri grup grup hesaplar ve her platform için modelin açık
kalıp kalmayacağına dair bir öneri üretir (eşikler src/kafiai/config.py, PLATFORM_*).

Gruplar (dosyası olmayan kaynak atlanır):
    WildChat 4.8M, yalnızca modelin test kullanıcıları    model ailesine göre (referans)
    WildChat 1M (50.000 örneklem)                         model ailesine göre
    WildFeedback                                          tek grup; ayrıca gerçek memnuniyetsizlik (DSAT) etiketiyle
    ShareChat                                             platforma göre (ChatGPT, Gemini, Claude, Grok, Perplexity)
    LMSYS-Chat-1M                                         model ailesine göre

Her grupta, her sohbetin k = 2..6. turlarında tahmin yapılır (eğitimdeki satırlarla aynı):
    base_rate       döngü etiketinin (etiket v2) oranı
    pr_auc          tahminin döngüyü ayırma gücü; [alt, üst] sohbet bazlı bootstrap ile %95 aralık
    lift            pr_auc / base_rate (1 rastgele demek)
    mean_prob       ortalama tahmin; base_rate'e yakınsa olasılıklar o grupta da kalibre
    oneri_*         öneri eşiğinde kesinlik ve yakalama
    high_*          yüksek güven (kart) eşiğinde kesinlik ve yakalama
    card_conv_rate  en az bir turda kart koşulu sağlanan sohbet oranı
    repeat_pair_rate  art arda iki kullanıcı mesajının şerit eşiğini (0,80) geçme oranı, mesaj çifti başına
    personal_rate   kişisel ya da duygusal görünen sohbet oranı (öneri gösterilmez)
    tasks           ilk mesaja göre görev türü dağılımı

Çalıştırma (repo kökünde):
    python scripts/evaluate_platforms.py
Çıktılar:
    outputs/platform_eval.json         tüm sayılar ve platform önerileri (repoya girer; yalnızca toplamlar)
    figures/29_platform_eval.png       gruplara göre PR-AUC katı ve kart kesinliği
"""

import json
import os
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from kafiai.config import (EXT_SIMILARITY_THRESHOLD, MAX_TURN_K, PLATFORM_BOOTSTRAP, PLATFORM_MAX_PRECISION_DROP,  # noqa: E402
                           PLATFORM_MIN_CONVERSATIONS, PLATFORM_MIN_LIFT, SEED)
from kafiai.data import PROCESSED, SOURCES, clean_conversations, load_source  # noqa: E402
from kafiai.extension_similarity import similarity  # noqa: E402
from kafiai.labels import loop_label  # noqa: E402
from kafiai.personal import is_personal  # noqa: E402
from kafiai.tasks import TASK_TYPES, task_type  # noqa: E402
from kafiai.turn_features import turn_features  # noqa: E402
from kafiai.turn_model import load_model, load_reasons, predict  # noqa: E402

OUT_JSON = ROOT / "outputs" / "platform_eval.json"
OUT_FIG = ROOT / "figures" / "29_platform_eval.png"
REFERENCE = "WildChat 4.8M test"

# Eklentinin platformları ve hangi grubun o platformu temsil ettiği. Copilot ve Google AI Modu için
# doğrudan veri yok; altta yatan model ailesi vekil olarak kullanılır ve bu açıkça yazılır.
PLATFORM_EVIDENCE = {
    "chatgpt": [("ShareChat", "chatgpt"), ("WildChat 1M", "GPT-3.5"), ("WildChat 1M", "GPT-4")],
    "gemini": [("ShareChat", "gemini")],
    "claude": [("ShareChat", "claude"), ("LMSYS", "Claude")],
    "copilot": [("ShareChat", "chatgpt"), (REFERENCE, "GPT-4o")],
    "google_ai_mode": [("ShareChat", "gemini")],
}
PROXY_NOTE = {
    "copilot": "Copilot için doğrudan veri yok; altta GPT-4 ailesi çalıştığı için ChatGPT verisi vekil olarak kullanıldı.",
    "google_ai_mode": "Google AI Modu için doğrudan veri yok; Gemini verisi vekil olarak kullanıldı.",
}


def family(model):
    m = str(model).lower()
    for key, name in [("gpt-4o", "GPT-4o"), ("gpt-4.1", "GPT-4.1"), ("gpt-4", "GPT-4"), ("gpt-3.5", "GPT-3.5"),
                      ("claude", "Claude"), ("gemini", "Gemini"), ("palm", "Gemini"), ("llama", "Llama"),
                      ("vicuna", "Vicuna"), ("mistral", "Mistral"), ("mixtral", "Mistral"), ("grok", "Grok")]:
        if key in m:
            return name
    return "Diğer"


_MODEL = _REASONS = None


def _conversation(msgs):
    """Tek sohbetin ölçüleri; işlemlere paralel dağıtılır. (görev, kişisel mi, çift, benzer çift, satırlar)"""
    global _MODEL, _REASONS
    if _MODEL is None:
        _MODEL, _REASONS = load_model(), load_reasons()
    pairs = len(msgs) - 1
    similar = sum(similarity(a, b) >= EXT_SIMILARITY_THRESHOLD for a, b in zip(msgs, msgs[1:]))
    rows = []
    for k in range(2, MAX_TURN_K + 1):
        if len(msgs) < k + 2:
            break
        pred = predict(turn_features(msgs, k), model=_MODEL, reasons=_REASONS)
        rows.append((k, loop_label(msgs, k=k), pred["probability"], pred["level"]))
    return task_type(msgs[0]), any(is_personal(m) for m in msgs), pairs, similar, rows


def _map(convs):
    if len(convs) < 200 or (os.cpu_count() or 1) < 2:
        return [_conversation(c) for c in convs]
    with ProcessPoolExecutor(max_workers=os.cpu_count()) as pool:
        return list(pool.map(_conversation, convs, chunksize=64))


def evaluate_group(convs, model, rng, dsat=None):
    """convs: kullanıcı mesajı listeleri. dsat: aynı sıradaki memnuniyetsizlik turları (WildFeedback)."""
    cuts = model["thresholds"]
    conv_ids, labels, probs, levels, dsat_labels = [], [], [], [], []
    card_convs = personal = pairs = similar_pairs = 0
    tasks = dict.fromkeys(TASK_TYPES, 0)
    turns = [len(m) for m in convs]
    for i, (task, is_pers, n_pairs, n_similar, rows) in enumerate(_map(convs)):
        tasks[task] += 1
        personal += int(is_pers)
        pairs += n_pairs
        similar_pairs += int(n_similar)
        card_convs += any(r[3] == "yuksek" for r in rows)
        for k, label, p, level in rows:
            conv_ids.append(i)
            labels.append(label)
            probs.append(p)
            levels.append(level)
            if dsat is not None:
                dsat_labels.append(int(any(t >= k for t in dsat[i])))

    n = len(convs)
    labelled = len(set(conv_ids))
    out = {"n_conversations": n, "n_labelled_conversations": labelled, "n_rows": len(labels),
           "mean_user_turns": round(float(np.mean(turns)), 2) if turns else None,
           "repeat_pair_rate": round(similar_pairs / pairs, 4) if pairs else None,
           "personal_rate": round(personal / n, 4) if n else None,
           "tasks": {t: round(c / n, 4) for t, c in tasks.items()} if n else {},
           "card_conv_rate": round(card_convs / labelled, 4) if labelled else None}
    if not labels or sum(labels) == 0:
        return out | {"base_rate": round(float(np.mean(labels)), 4) if labels else None, "pr_auc": None}

    y, p = np.array(labels), np.array(probs)
    lv, ids = np.array(levels), np.array(conv_ids)
    ap = average_precision_score(y, p)
    # Sohbet bazlı bootstrap: aynı sohbetin satırları birlikte seçilir.
    by_conv = {}
    for j, c in enumerate(ids):
        by_conv.setdefault(c, []).append(j)
    keys = np.array(list(by_conv))
    boots = []
    for _ in range(PLATFORM_BOOTSTRAP):
        pick = np.concatenate([by_conv[c] for c in rng.choice(keys, size=len(keys), replace=True)])
        if y[pick].sum() > 0:
            boots.append(average_precision_score(y[pick], p[pick]))

    def prec_rec(mask):
        tp = int((mask & (y == 1)).sum())
        return (round(tp / mask.sum(), 4) if mask.sum() else None, round(tp / (y == 1).sum(), 4), int(mask.sum()))

    oneri_p, oneri_r, oneri_n = prec_rec(p >= cuts["oneri"])
    high_p, high_r, high_n = prec_rec(lv == "yuksek")
    out |= {
        "base_rate": round(float(y.mean()), 4),
        "mean_prob": round(float(p.mean()), 4),
        "pr_auc": round(float(ap), 4),
        "pr_auc_ci": [round(float(np.percentile(boots, 2.5)), 4), round(float(np.percentile(boots, 97.5)), 4)] if boots else None,
        "lift": round(float(ap / y.mean()), 2),
        "oneri_precision": oneri_p, "oneri_recall": oneri_r, "oneri_n": oneri_n,
        "high_precision": high_p, "high_recall": high_r, "high_n": high_n,
    }
    if dsat is not None and sum(dsat_labels):
        d = np.array(dsat_labels)
        out["dsat"] = {"base_rate": round(float(d.mean()), 4), "pr_auc": round(float(average_precision_score(d, p)), 4),
                       "lift": round(float(average_precision_score(d, p) / d.mean()), 2),
                       "high_precision": round(float(d[lv == "yuksek"].mean()), 4) if (lv == "yuksek").any() else None}
    return out


def load_clean(name, reference=None):
    if not SOURCES[name].exists():
        print(f"  {name}: dosya yok, atlandı ({SOURCES[name].relative_to(ROOT)})")
        return None
    df = load_source(name)
    if "platform" not in df.columns:
        df["platform"] = ""
    df, _ = clean_conversations(df, template_reference=reference)
    return df


def groups():
    """(kaynak, grup, sohbet listesi, dsat) dörtlüleri üretir."""
    ref = load_source("48m_sample") if SOURCES["48m_sample"].exists() else None
    df = load_clean("48m", reference=ref)
    turns_path = PROCESSED / "turns_48m.parquet"
    if df is not None and turns_path.exists():
        # Modelin test kullanıcıları: eğitimdeki bölmenin aynısı (train_turn_model.py).
        from kafiai.config import TEST_SIZE
        from kafiai.split import user_split
        table = pd.read_parquet(turns_path, columns=["conversation_hash", "hashed_ip"])
        tr_path = PROCESSED / "turns_48m_turkish.parquet"
        if tr_path.exists():
            table = table[~table["hashed_ip"].isin(set(pd.read_parquet(tr_path, columns=["hashed_ip"])["hashed_ip"]))]
        table = table.reset_index(drop=True)
        _, test_idx = user_split(table, test_size=TEST_SIZE)
        test_convs = set(table.loc[test_idx, "conversation_hash"])
        df = df[df["conversation_hash"].isin(test_convs)]
        yield REFERENCE, "Tümü", list(df["user_msgs"]), None
        for fam, g in df.groupby(df["model"].map(family)):
            yield REFERENCE, fam, list(g["user_msgs"]), None

    df = load_clean("1m")
    if df is not None:
        for fam, g in df.groupby(df["model"].map(family)):
            yield "WildChat 1M", fam, list(g["user_msgs"]), None

    df = load_clean("wildfeedback")
    if df is not None:
        yield "WildFeedback", "Tümü", list(df["user_msgs"]), list(df["dsat_turns"])

    df = load_clean("sharechat")
    if df is not None:
        for platform, g in df.groupby("platform"):
            yield "ShareChat", platform, list(g["user_msgs"]), None

    df = load_clean("lmsys")
    if df is not None:
        for fam, g in df.groupby(df["model"].map(family)):
            yield "LMSYS", fam, list(g["user_msgs"]), None


def recommend(results):
    """Her eklenti platformu için model açık mı kapalı mı (config.PLATFORM_* kurallarıyla)."""
    ref = results.get(REFERENCE, {}).get("Tümü", {})
    ref_high = ref.get("high_precision")
    recs = {}
    for platform, evidence in PLATFORM_EVIDENCE.items():
        found = [(src, grp, results[src][grp]) for src, grp in evidence if grp in results.get(src, {})]
        usable = [(s, g, r) for s, g, r in found if r.get("n_labelled_conversations", 0) >= PLATFORM_MIN_CONVERSATIONS
                  and r.get("pr_auc") is not None]
        if not usable:
            recs[platform] = {"model": "karar yok", "reason": "Yeterli veri yok (en az "
                              f"{PLATFORM_MIN_CONVERSATIONS} etiketlenebilir sohbet gerekiyor).",
                              "evidence": [f"{s} / {g}" for s, g, _ in found]}
            continue
        src, grp, best = usable[0]  # listedeki ilk (en doğrudan) kanıt
        checks = {"lift": bool(best["lift"] >= PLATFORM_MIN_LIFT)}
        if ref_high is not None and best.get("high_precision") is not None:
            checks["high_precision"] = bool(best["high_precision"] >= ref_high - PLATFORM_MAX_PRECISION_DROP)
        ok = all(checks.values())
        recs[platform] = {
            "model": "on" if ok else "off",
            "evidence": f"{src} / {grp}",
            "lift": best["lift"], "high_precision": best.get("high_precision"), "reference_high_precision": ref_high,
            "checks": checks,
            **({"note": PROXY_NOTE[platform]} if platform in PROXY_NOTE else {}),
        }
    return recs


def plot(results):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    items = [(f"{src}\n{grp}", r) for src, gs in results.items() for grp, r in gs.items()
             if r.get("pr_auc") is not None and r.get("n_labelled_conversations", 0) >= 100]
    if not items:
        return
    labels = [n for n, _ in items]
    lift = [r["lift"] for _, r in items]
    err = [[r["lift"] - r["pr_auc_ci"][0] / r["base_rate"] for _, r in items],
           [r["pr_auc_ci"][1] / r["base_rate"] - r["lift"] for _, r in items]]
    high = [r.get("high_precision") or 0 for _, r in items]
    fig, axes = plt.subplots(1, 2, figsize=(12, max(4, 0.42 * len(items) + 1.5)), sharey=True)
    ypos = np.arange(len(items))
    axes[0].barh(ypos, lift, xerr=err, color="#1f6f54", alpha=0.85)
    axes[0].axvline(PLATFORM_MIN_LIFT, color="#a23a2e", ls="--", lw=1)
    axes[0].axvline(1, color="#888", lw=0.8)
    axes[0].set_xlabel("PR-AUC / döngü oranı (1 = rastgele)")
    axes[0].set_yticks(ypos, labels, fontsize=8)
    axes[0].invert_yaxis()
    axes[1].barh(ypos, high, color="#55b592")
    axes[1].set_xlabel("Kart eşiğinde kesinlik")
    axes[1].set_xlim(0, 1)
    fig.suptitle("Tur modeli eğitim dışındaki gruplarda", fontsize=12)
    fig.tight_layout()
    OUT_FIG.parent.mkdir(exist_ok=True)
    fig.savefig(OUT_FIG, dpi=150)
    print(f"Grafik: {OUT_FIG.relative_to(ROOT)}")


CACHE = PROCESSED / "platform_eval_cache.json"


def main():
    import argparse
    ap = argparse.ArgumentParser(description="Çok platformlu sınama")
    ap.add_argument("--max-per-group", type=int, default=None,
                    help="bir gruptan en fazla bu kadar sohbet (rastgele); hızlı deneme için")
    ap.add_argument("--fresh", action="store_true", help="önbelleği yok say, her grubu yeniden hesapla")
    args = ap.parse_args()

    model = load_model()
    rng = np.random.default_rng(SEED)
    # Uzun sürdüğü için her grubun sonucu hesaplanınca önbelleğe yazılır (data/processed, repoya girmez);
    # yarıda kalan bir çalıştırma kaldığı yerden sürer. Model ya da veri değişince --fresh.
    cache = {} if args.fresh or not CACHE.exists() else json.loads(CACHE.read_text(encoding="utf-8"))
    results = {}
    for source, group, convs, dsat in groups():
        if args.max_per_group and len(convs) > args.max_per_group:
            pick = sorted(np.random.default_rng(SEED).choice(len(convs), args.max_per_group, replace=False))
            convs = [convs[i] for i in pick]
            dsat = [dsat[i] for i in pick] if dsat is not None else None
        key = f"{source}|{group}|{len(convs)}|{model['thresholds']}"
        if key in cache:
            results.setdefault(source, {})[group] = cache[key]
            print(f"{source} / {group}: önbellekten")
            continue
        print(f"{source} / {group}: {len(convs):,} sohbet ...", flush=True)
        results.setdefault(source, {})[group] = evaluate_group(convs, model, rng, dsat)
        r = results[source][group]
        cache[key] = r
        CACHE.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")
        if r.get("pr_auc") is not None:
            print(f"   döngü %{r['base_rate'] * 100:.1f}, PR-AUC {r['pr_auc']:.3f} (x{r['lift']}), "
                  f"kart kesinliği {r['high_precision']}, kart sohbet oranı {r['card_conv_rate']}")
    out = {"thresholds": {"min_conversations": PLATFORM_MIN_CONVERSATIONS, "min_lift": PLATFORM_MIN_LIFT,
                          "max_precision_drop": PLATFORM_MAX_PRECISION_DROP},
           "reference": REFERENCE, "groups": results, "recommendations": recommend(results)}
    OUT_JSON.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"\nSonuç: {OUT_JSON.relative_to(ROOT)}")
    for platform, rec in out["recommendations"].items():
        print(f"  {platform:15s} model {rec['model']:9s} {rec.get('evidence', '')}")
    plot(results)


if __name__ == "__main__":
    main()
