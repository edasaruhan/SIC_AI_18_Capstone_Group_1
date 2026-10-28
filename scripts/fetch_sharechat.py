"""ShareChat'i indirip yalnızca kullanıcı mesajlarıyla ortak biçime çevirir (yalnızca değerlendirme).

ShareChat (Yan ve diğ., 2025): ChatGPT, Claude, Gemini, Grok ve Perplexity'de kullanıcıların
paylaşım bağlantısıyla herkese açtığı sohbetler. Bizim için değeri, ChatGPT dışındaki gerçek
arayüzlerden (Gemini, Claude) çok turlu sohbet içermesi. Lisans CC BY-NC 4.0: yalnızca
değerlendirmede kullanılır, eğitime girmez, ham hâli ve çıktısı depoya girmez.

Erişim koşullu: önce Hugging Face'te veri setinin sayfasında koşulları kabul et, sonra
terminalde bir kez `huggingface-cli login` (ya da HF_TOKEN ortam değişkeni).

Veri mesaj mesaj CSV dosyalarında: platform, url, message_index, role, plain_text,
detected_language_final (ve platforma göre model). Sohbet kimliği olarak url kullanılır;
url'nin kendisi saklanmaz, yalnızca özeti (SHA-1).

Çalıştırma (repo kökünde, internet gerekir, yaklaşık 4 GB indirir):
    python scripts/fetch_sharechat.py --inspect     # dosyaları ve kolonları göster, indirme yok
    python scripts/fetch_sharechat.py               # indir ve çevir
Çıktı (repoya eklenmez): data/processed/sharechat_conversations.parquet
"""

import argparse
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from kafiai.data import SOURCES  # noqa: E402
from kafiai.external import USER_ROLES, to_common  # noqa: E402

REPO_ID = "tucnguyen/ShareChat"
PLATFORM_IDS = {"gpt": "chatgpt", "chatgpt": "chatgpt", "openai": "chatgpt", "gemini": "gemini", "bard": "gemini",
                "claude": "claude", "grok": "grok", "perplexity": "perplexity"}
WANTED = ["platform", "url", "message_index", "role", "plain_text", "detected_language_final", "model",
          "create_time", "created_at"]


def platform_id(name):
    low = str(name).lower()
    for key, pid in PLATFORM_IDS.items():
        if key in low:
            return pid
    return low or "bilinmiyor"


def csv_files():
    from huggingface_hub import HfApi
    files = HfApi().list_repo_files(REPO_ID, repo_type="dataset")
    return [f for f in files if f.lower().endswith((".csv", ".csv.gz", ".parquet"))]


def read_messages(path, chunksize=200_000):
    """Mesaj satırlarını parça parça okur; yalnızca kullanıcı mesajları kalır."""
    if path.endswith(".parquet"):
        frame = pd.read_parquet(path)
        chunks = [frame]
    else:
        header = pd.read_csv(path, nrows=0).columns
        cols = [c for c in WANTED if c in header]
        chunks = pd.read_csv(path, usecols=cols, chunksize=chunksize, dtype=str, keep_default_na=False)
    for chunk in chunks:
        role = chunk["role"].astype(str).str.strip().str.lower()
        yield chunk[role.isin(USER_ROLES)]


def convert(path, fallback_platform):
    parts = list(read_messages(path))
    if not parts:
        return []
    df = pd.concat(parts, ignore_index=True)
    df["message_index"] = pd.to_numeric(df["message_index"], errors="coerce")
    rows = []
    for url, g in df.sort_values("message_index").groupby("url", sort=False):
        first = g.iloc[0]
        record = {
            "conversation_id": url,
            "messages": [{"role": "user", "content": t} for t in g["plain_text"]],
            "model": first.get("model", ""),
            "language": first.get("detected_language_final", ""),
            "timestamp": first.get("create_time", "") or first.get("created_at", ""),
        }
        conv = to_common(record, "sharechat", platform=platform_id(first.get("platform", fallback_platform)))
        if conv:
            rows.append(conv)
    return rows


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--inspect", action="store_true", help="dosyaları ve kolonları göster, indirme yapma")
    args = ap.parse_args()

    from huggingface_hub import hf_hub_download
    from huggingface_hub.errors import GatedRepoError

    try:
        files = csv_files()
    except Exception as e:  # erişim koşulu kabul edilmemiş ya da giriş yapılmamış
        print(f"Dosya listesi alınamadı: {e}\nVeri setinin sayfasında koşulları kabul edip 'huggingface-cli login' yaptın mı?")
        return 1
    print(f"{len(files)} veri dosyası:", *files, sep="\n  ")
    if args.inspect:
        return 0

    rows = []
    for f in files:
        try:
            local = hf_hub_download(REPO_ID, f, repo_type="dataset")
        except GatedRepoError:
            print(f"\nErişim izni yok. https://huggingface.co/datasets/{REPO_ID} sayfasında giriş yapmış hâlde "
                  "erişim isteğini gönder (form ve onay kutusu). Onay gelince (bazı setlerde elle onaylanır) tekrar çalıştır.")
            return 1
        got = convert(local, fallback_platform=Path(f).stem)
        print(f"{f}: {len(got):,} sohbet")
        rows += got
    if not rows:
        print("Hiç kullanıcı mesajı bulunamadı; --inspect çıktısını paylaş.")
        return 1
    out = pd.DataFrame(rows)
    out = out[out["n_user_msgs"] >= 2].reset_index(drop=True)  # tek mesajlık sohbetler değerlendirmeye girmez
    SOURCES["sharechat"].parent.mkdir(parents=True, exist_ok=True)
    out.to_parquet(SOURCES["sharechat"], index=False)
    print(f"\n{len(out):,} çok turlu sohbet yazıldı: {SOURCES['sharechat'].relative_to(ROOT)}")
    print(out["platform"].value_counts().to_string())
    return 0


if __name__ == "__main__":
    sys.exit(main())
