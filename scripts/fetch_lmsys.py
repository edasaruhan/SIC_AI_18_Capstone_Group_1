"""LMSYS-Chat-1M'i indirip yalnızca kullanıcı mesajlarıyla ortak biçime çevirir (yalnızca değerlendirme).

LMSYS-Chat-1M (Zheng ve diğ., 2023): Chatbot Arena ve Vicuna demosunda 25 farklı modelle yapılmış
bir milyon sohbet. Bizim için değeri, aynı kullanıcı davranışının GPT dışındaki modellerde
(Claude, Llama, Vicuna...) nasıl göründüğünü ölçmek. Kullanım koşulları gereği yalnızca
değerlendirmede kullanılır; eğitime girmez, ham hâli ve çıktısı depoya girmez.

Erişim koşullu: Hugging Face'te veri setinin sayfasında koşulları kabul et, sonra bir kez
`huggingface-cli login` (ya da HF_TOKEN).

Çalıştırma (repo kökünde, internet gerekir, tamamı yaklaşık 2,5 GB):
    python scripts/fetch_lmsys.py --inspect          # dosyaları ve kolonları göster
    python scripts/fetch_lmsys.py                    # tüm dosyalar
    python scripts/fetch_lmsys.py --max-files 2      # hızlı deneme
Çıktı (repoya eklenmez): data/processed/lmsys_conversations.parquet
"""

import argparse
import sys
from pathlib import Path

import pandas as pd
import pyarrow.parquet as pq

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from kafiai.data import SOURCES  # noqa: E402
from kafiai.external import to_common  # noqa: E402

REPO_ID = "lmsys/lmsys-chat-1m"
COLUMNS = ["conversation_id", "model", "conversation", "turn", "language"]


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--inspect", action="store_true")
    ap.add_argument("--max-files", type=int, default=None)
    args = ap.parse_args()

    from huggingface_hub import HfApi, hf_hub_download
    from huggingface_hub.errors import GatedRepoError

    try:
        files = sorted(f for f in HfApi().list_repo_files(REPO_ID, repo_type="dataset") if f.endswith(".parquet"))
    except Exception as e:
        print(f"Dosya listesi alınamadı: {e}\nVeri setinin sayfasında koşulları kabul edip 'huggingface-cli login' yaptın mı?")
        return 1
    print(f"{len(files)} parquet dosyası:", *files, sep="\n  ")
    if args.max_files:
        files = files[: args.max_files]

    rows = []
    for i, f in enumerate(files):
        try:
            local = hf_hub_download(REPO_ID, f, repo_type="dataset")
        except GatedRepoError:
            print(f"\nErişim izni yok. https://huggingface.co/datasets/{REPO_ID} sayfasında giriş yapmış hâlde "
                  "erişim isteğini gönder (form ve onay kutusu). Onay gelince (bazı setlerde elle onaylanır) tekrar çalıştır.")
            return 1
        schema = pq.read_schema(local)
        if args.inspect:
            print(f"\n{f} kolonları:", ", ".join(schema.names))
            return 0
        table = pq.read_table(local, columns=[c for c in COLUMNS if c in schema.names]).to_pandas()
        table = table[pd.to_numeric(table["turn"], errors="coerce").fillna(0) >= 2]
        for rec in table.to_dict("records"):
            conv = to_common(rec, "lmsys", platform="lmsys")
            if conv and conv["n_user_msgs"] >= 2:
                rows.append(conv)
        print(f"[{i + 1}/{len(files)}] {f}: toplam {len(rows):,} çok turlu sohbet")

    out = pd.DataFrame(rows)
    SOURCES["lmsys"].parent.mkdir(parents=True, exist_ok=True)
    out.to_parquet(SOURCES["lmsys"], index=False)
    print(f"\n{len(out):,} sohbet yazıldı: {SOURCES['lmsys'].relative_to(ROOT)}")
    print(out["model"].value_counts().head(15).to_string())
    return 0


if __name__ == "__main__":
    sys.exit(main())
