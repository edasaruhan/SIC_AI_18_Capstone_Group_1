"""README'deki "Öne çıkan bulgular" tablosunun sayılarını üretir.

İlk keşif analizindeki (run_eda.py) üç bulgu sonradan sorunlu çıktı:

    1. Tekrar oranı (%31,6) boş ve çok kısa mesajları da sayıyordu; iki boş mesaj birbirine
       tam benzer görünüyor. Şablon sohbetler de içerideydi.
    2. Gece kullanımı (%30,7) şablonları içeriyordu ve gece sohbetlerinin büyük kısmı birkaç
       kullanıcıdan geliyordu.
    3. "Yaklaşık 7 kat" sohbet başına hesaplanmıştı; uzun sohbetin mesajı çok olduğu için şişkin.

Bu script aynı soruları temizlenmiş veriyle, eklentinin kendi benzerlik hesabıyla ve
sınırlarıyla yeniden cevaplar. README'deki her sayı outputs/findings.json içindeki bir anahtara
karşılık gelir.

Yöntem:
    benzerlik     eklentinin benzerlik hesabı (extension_similarity), şeridin eşiği 0,8
    karşılaştırma iki mesaj da en az 12 karakter (eklentideki kural; "devam et", "evet" hariç)
    şablonlar     run_eda.py ile aynı kural, çıkarılır
    gece          Türkiye, yerel saat 00:00-05:59; kullanıcı ağırlıklı oran ve kullanıcı bazlı
                  bootstrap ile %95 güven aralığı. Eşit dağılımda 6 saatin payı %25.

Çalıştırma (repo kök klasöründe; önce run_eda.py ve fetch_wildchat48.py):
    python scripts/compute_findings.py
Çıktı:
    outputs/findings.json
"""

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from kafiai.config import EXACT_REPEAT_THRESHOLD, EXT_SIMILARITY_THRESHOLD, SEED  # noqa: E402
from kafiai.data import SOURCES, load_source  # noqa: E402
from kafiai.extension_similarity import is_comparable, similarity  # noqa: E402
from kafiai.split import mark_templates  # noqa: E402

OUT = ROOT / "outputs" / "findings.json"
BOOTSTRAP = 1000


def repeat_stats(df):
    """En az 3 kullanıcı mesajlı, şablon olmayan sohbetlerde tekrar oranları."""
    convs = df[(df["n_user_msgs"] >= 3) & ~df["templated"]]
    has_similar, has_exact, comparable_pairs, similar_pairs = [], [], 0, 0
    for msgs in convs["user_msgs"]:
        sims = [similarity(a, b) for a, b in zip(msgs, msgs[1:]) if is_comparable(a) and is_comparable(b)]
        comparable_pairs += len(sims)
        similar_pairs += sum(s >= EXT_SIMILARITY_THRESHOLD for s in sims)
        has_similar.append(any(s >= EXT_SIMILARITY_THRESHOLD for s in sims))
        has_exact.append(any(s >= EXACT_REPEAT_THRESHOLD for s in sims))
    convs = convs.assign(similar=has_similar, exact=has_exact)
    buckets = pd.cut(convs["n_user_msgs"], [2, 4, 9, 10_000], labels=["3-4", "5-9", "10+"])
    return {
        "n_conversations": int(len(convs)),
        "n_comparable_pairs": int(comparable_pairs),
        "conversations_with_similar_pct": round(float(convs["similar"].mean() * 100), 1),
        "conversations_with_exact_pct": round(float(convs["exact"].mean() * 100), 1),
        "similar_pairs_pct": round(similar_pairs / max(comparable_pairs, 1) * 100, 1),
        "similar_by_length_pct": {str(k): round(float(v * 100), 1)
                                  for k, v in convs.groupby(buckets, observed=False)["similar"].mean().items()},
    }


def concentration(df):
    counts = df["hashed_ip"].value_counts()
    def share(frac):
        return round(float(counts.head(max(1, int(len(counts) * frac))).sum() / counts.sum() * 100), 1)
    return {"n_users": int(len(counts)), "top1pct_share": share(0.01), "top10pct_share": share(0.10)}


def night_stats(df, rng):
    """Türkiye, yerel saat 00-05: sohbet bazında, kullanıcı ağırlıklı ve güven aralığı."""
    tr = df[df["country"].isin(["Türkiye", "Turkey"]) & ~df["templated"]].copy()
    if tr.empty:
        return {"n_conversations": 0}
    tr["night"] = tr["timestamp"].dt.tz_convert("Europe/Istanbul").dt.hour.between(0, 5)
    per_user = tr.groupby("hashed_ip")["night"].mean()
    boot = [per_user.sample(len(per_user), replace=True, random_state=int(rng.integers(1e9))).mean()
            for _ in range(BOOTSTRAP)]
    night_users = tr.loc[tr["night"], "hashed_ip"].value_counts()
    return {
        "n_conversations": int(len(tr)),
        "n_users": int(per_user.size),
        "conversation_pct": round(float(tr["night"].mean() * 100), 1),
        "user_weighted_pct": round(float(per_user.mean() * 100), 1),
        "user_weighted_ci95_pct": [round(float(np.percentile(boot, 2.5) * 100), 1),
                                   round(float(np.percentile(boot, 97.5) * 100), 1)],
        "uniform_share_pct": 25.0,
        "top3_users_share_of_night_pct": round(float(night_users.head(3).sum() / max(night_users.sum(), 1) * 100), 1),
    }


def main():
    rng = np.random.default_rng(SEED)
    result = {
        "method": {
            "similarity": "eklenti benzerliği (3-gram, 1024 boyut), eşik %.2f; birebir tekrar %.2f"
                          % (EXT_SIMILARITY_THRESHOLD, EXACT_REPEAT_THRESHOLD),
            "comparable": "iki mesaj da sadeleştirildikten sonra en az 12 karakter",
            "templates": "çıkarıldı (ilk 80 karakter örneklemde 20 kez ve üzeri)",
        }
    }
    for name in ["1m", "48m_sample"]:
        if not SOURCES[name].exists():
            print(f"{name} yok, atlandı")
            continue
        df = load_source(name).drop_duplicates("conversation_hash")
        df["templated"] = mark_templates(df)
        print(f"{name}: {len(df):,} sohbet, şablon %{df['templated'].mean()*100:.1f}")
        result[name] = {
            "n_conversations": int(len(df)),
            "templated_pct": round(float(df["templated"].mean() * 100), 1),
            "repeat": repeat_stats(df),
            "concentration_all": concentration(df),
            "concentration_organic": concentration(df[~df["templated"]]),
            "turkey_night": night_stats(df, rng),
        }

    # Mesaj başına onarım artışı run_eda_48m.py'de hesaplanıyor; buraya yalnızca aktarılır.
    eda48 = ROOT / "outputs" / "eda_48m_summary.json"
    if eda48.exists():
        rbt = json.loads(eda48.read_text(encoding="utf-8")).get("repair_by_turn", {})
        allmsg = rbt.get("48m_strong_repair_all", {})
        if allmsg:
            result["repair_per_message_48m"] = {
                "by_turn_pct": allmsg,
                "ratio_21_40_vs_2": round(allmsg["21-40"] / allmsg["2"], 2),
                "source": "outputs/eda_48m_summary.json -> repair_by_turn",
            }
    OUT.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
