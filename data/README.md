# Veri

Bu klasörde ham veri tutulmaz. Scriptler veriyi Hugging Face'ten indirip `data/processed/` altına yazar; bu klasör `.gitignore` ile repo dışında tutulur. Repoda yalnızca sayısal özetler (`outputs/*.json`) ve grafikler (`figures/`) durur.

| Veri seti | Kaynak | Lisans | Kullanım |
| --- | --- | --- | --- |
| WildChat 4.8M | [allenai/WildChat-4.8M](https://huggingface.co/datasets/allenai/WildChat-4.8M) | ODC BY | Eğitim ve test (`scripts/fetch_wildchat48.py`) |
| WildChat 1M | [allenai/WildChat-1M](https://huggingface.co/datasets/allenai/WildChat-1M) | ODC BY | İlk analiz, farklı dönem testi (`scripts/run_eda.py`) |
| WildFeedback | [microsoft/WildFeedback](https://huggingface.co/datasets/microsoft/WildFeedback) | ODC BY | Etiket doğrulaması, dış test (`scripts/fetch_wildfeedback.py`) |
| OpenAssistant OASST1 | [OpenAssistant/oasst1](https://huggingface.co/datasets/OpenAssistant/oasst1) | Apache 2.0 | Yalnızca ilk analiz |

## Lisans notu

Repodaki kod MIT lisanslıdır (kök klasördeki `LICENSE`). Bu lisans veri setlerini kapsamaz: her veri seti kendi lisansıyla kullanılır ve ham verisi bu repoda dağıtılmaz.

- **ODC BY** (WildChat, WildFeedback): kullanırken kaynak gösterilmesi gerekir. `outputs/` altındaki özet sayılar ve `figures/` altındaki grafikler bu verilerden türetilmiştir; kaynakları README ve `docs/` bölümlerinde belirtilmiştir.
- **Apache 2.0** (OASST1): kaynak gösterilerek kullanılır.
- Eklentinin içindeki model dosyası (`extension/src/data/turn-model.json`) yalnızca katsayı ve eşiklerden oluşur; sohbet metni içermez.
- Değerlendirmede kullanılması planlanan **ShareChat** (CC BY-NC 4.0, ticari olmayan kullanım) ve **LMSYS Chat 1M** (lisans sözleşmesi, yeniden dağıtım yasak) eğitime katılmaz ve repoya girmez.
