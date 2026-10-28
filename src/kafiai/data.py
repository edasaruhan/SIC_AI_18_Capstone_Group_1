"""Veri kaynaklarını okuma ve temizleme.

Projede üç sohbet kaynağı var. Hepsi aynı sade biçime çevrilmiş halde data/processed altında durur
(her satır bir sohbet, user_msgs kolonunda kullanıcı mesajları sırayla):

    1m          WildChat 1M'den 50.000 sohbetlik rastgele örneklem (scripts/run_eda.py)
    48m         WildChat 4.8M'in 10 parça dosyasındaki en az 4 turlu tüm sohbetler (scripts/fetch_wildchat48.py)
    48m_sample  WildChat 4.8M'den 150.000 sohbetlik rastgele örneklem; keşif analizi için
    48m_turkish WildChat 4.8M'in aynı parçalarındaki tüm Türkçe sohbetler
    wildfeedback WildFeedback'teki İngilizce sohbetler ve memnuniyetsizlik (DSAT) işaretleri
                (scripts/fetch_wildfeedback.py)
    sharechat   ShareChat: ChatGPT, Gemini, Claude, Perplexity ve Grok'tan paylaşılmış sohbetler
                (scripts/fetch_sharechat.py; yalnızca değerlendirme, CC BY-NC)
    lmsys       LMSYS-Chat-1M: Chatbot Arena'daki 25 modelle sohbetler
                (scripts/fetch_lmsys.py; yalnızca değerlendirme)

Temizleme adımları `clean_conversations` içinde sırayla uygulanır ve her adımdan sonra kaç
sohbet kaldığı kaydedilir. Bu sayılar raporda temizleme hunisi olarak gösterilir.
"""

from pathlib import Path

import pandas as pd

from kafiai.config import K_TURNS, MAX_TURNS, MIN_TURNS_FOR_LABEL
from kafiai.split import mark_templates

PROCESSED = Path(__file__).resolve().parents[2] / "data" / "processed"

SOURCES = {
    "1m": PROCESSED / "wildchat_sample_50000.pkl",
    "48m": PROCESSED / "wildchat48_multiturn.parquet",
    "48m_sample": PROCESSED / "wildchat48_sample.parquet",
    "48m_turkish": PROCESSED / "wildchat48_turkish.parquet",
    "wildfeedback": PROCESSED / "wildfeedback_conversations.parquet",
    # Yalnızca değerlendirmede (P4); eğitime girmez. Ortak biçime çevrilmiş hâlde (kafiai.external).
    "sharechat": PROCESSED / "sharechat_conversations.parquet",
    "lmsys": PROCESSED / "lmsys_conversations.parquet",
}


def load_source(name):
    """Kaynağı okur. Dosya yoksa hangi script'in çalıştırılacağını söyler."""
    path = SOURCES[name]
    if not path.exists():
        hint = {"1m": "run_eda.py", "wildfeedback": "fetch_wildfeedback.py", "sharechat": "fetch_sharechat.py",
                "lmsys": "fetch_lmsys.py"}.get(name, "fetch_wildchat48.py")
        raise FileNotFoundError(f"{path.name} bulunamadı. Önce 'python scripts/{hint}' çalıştırın.")
    df = pd.read_pickle(path) if path.suffix == ".pkl" else pd.read_parquet(path)
    if name == "wildfeedback":
        df = _wildfeedback_to_common(df)
    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True, errors="coerce")
    df["user_msgs"] = df["user_msgs"].apply(list)
    return df.reset_index(drop=True)


def _wildfeedback_to_common(df):
    """WildFeedback'i diğer kaynaklarla aynı kolonlara getirir.

    Bu sette kullanıcı kimliği ve zaman yok; sohbet kimliği olarak ilk iki mesajın metni
    kullanılır. Bu, aynı sohbetin WildChat tablolarında da geçip geçmediğini kontrol etmeye yarar.
    """
    msgs = df["user_msgs"].apply(list)
    key = msgs.apply(lambda m: " ".join(str(x) for x in m[:2]).strip().lower())
    return pd.DataFrame({
        "conversation_hash": "wf_" + df["conv_id"].astype(str),
        "timestamp": pd.NaT,
        "model": "gpt-3.5/4 (WildChat 1M)",
        "language": "English",
        "country": "",
        "hashed_ip": "wf_" + df["conv_id"].astype(str),
        "user_msgs": msgs,
        "n_user_msgs": df["n_user_msgs"],
        "first_prompt": msgs.str[0].fillna(""),
        "dsat_turns": df["dsat_turns"].apply(list),
        "text_key": key,
    })


def clean_conversations(df, template_reference=None):
    """Temizleme adımlarını uygular. (temiz tablo, adım adım kalan sohbet sayıları) döner.

    template_reference: şablon tespitinde ilk mesajların ne sıklıkla tekrarlandığı bu tablodan
    sayılır. Yalnızca çok turlu sohbetleri içeren bir dosyada şablonlar seyrek görüneceği için
    4.8M'de sayım, rastgele örneklemle birlikte yapılır.
    """
    steps = {"ham veri": len(df)}

    # 1. Tekrarlanan kayıtlar: aynı conversation_hash birden fazla kez geçiyorsa biri tutulur.
    df = df.drop_duplicates("conversation_hash")
    steps["tekrar kayıtlar çıkarıldı"] = len(df)

    # 2. İlk mesajı boş olan sohbetler (yalnızca dosya ya da görsel gönderilmiş olabilir).
    df = df[df["first_prompt"].fillna("").str.strip() != ""]
    steps["ilk mesajı boş olanlar çıkarıldı"] = len(df)

    # 3. Şablon sohbetler: programların otomatik gönderdiği hazır istekler.
    if template_reference is None:
        templated = mark_templates(df)
    else:
        ref = pd.concat([df[["first_prompt"]], template_reference[["first_prompt"]]], ignore_index=True)
        templated = mark_templates(ref).iloc[: len(df)].set_axis(df.index)
    df = df[~templated]
    steps["şablon sohbetler çıkarıldı"] = len(df)

    # 4. Etiket üretilebilmesi için en az MIN_TURNS_FOR_LABEL kullanıcı mesajı gerekir.
    df = df[df["n_user_msgs"] >= MIN_TURNS_FOR_LABEL]
    steps[f"en az {MIN_TURNS_FOR_LABEL} tur"] = len(df)

    # 5. Aykırı uzunluk: MAX_TURNS'ten uzun sohbetler çoğunlukla otomatik ya da test amaçlı.
    df = df[df["n_user_msgs"] <= MAX_TURNS]
    steps[f"{MAX_TURNS} turdan uzunlar çıkarıldı"] = len(df)

    # 6. Modelin göreceği ilk K_TURNS mesajdan biri boşsa öznitelik anlamsız olur.
    first_k_ok = df["user_msgs"].apply(lambda m: all(str(x).strip() for x in m[:K_TURNS]))
    df = df[first_k_ok]
    steps[f"ilk {K_TURNS} mesajı dolu olanlar"] = len(df)

    # Eksik değer: yalnızca country alanında var ve modelde kullanılmıyor; "Bilinmiyor" yazılır.
    df = df.assign(country=df["country"].fillna("Bilinmiyor").replace("", "Bilinmiyor"))
    return df.reset_index(drop=True), steps
