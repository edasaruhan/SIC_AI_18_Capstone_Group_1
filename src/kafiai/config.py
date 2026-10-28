"""Projedeki tüm eşikler burada durur.

Bir değeri değiştirmek gerektiğinde kodun içinde aramak yerine bu dosyaya bakılır.
Her değerin yanında neden seçildiği yazılıdır.
"""

SEED = 42

# Modelin göreceği tur sayısı. Eklenti kullanıcının ilk iki mesajından sonra
# karar verebilmeli; daha geç bir uyarı, döngü başladıktan sonra gelir.
K_TURNS = 2

# Etiket için gereken en az kullanıcı mesajı. İlk 2 tur girdi olduğundan
# sonrasında en az 2 tur daha olmalı ki "sonradan döngüye girdi mi" sorusu anlamlı olsun.
MIN_TURNS_FOR_LABEL = 4

# İki mesajın "neredeyse aynı talep" sayılması için karakter benzerliği eşiği.
# Bölüm 2'deki TF-IDF analizinde 0.7 kullanıldı; burada ağırlıksız karakter
# n-gram kullandığımız için biraz daha yüksek tutuldu. Elle doğrulama setiyle yeniden ayarlanacak.
REPEAT_SIM_THRESHOLD = 0.75

# Zayıf etiket kuralı: k turdan sonraki kısımda en az bu kadar tekrar
# ya da en az bu kadar onarım ifadesi görülürse sohbet "döngü" sayılır.
LABEL_MIN_REPEATS = 2
LABEL_MIN_REPAIRS = 2

# Etiketin ikinci sürümü (docs/08, Bölüm 5). WildFeedback'te ilk kural, kullanıcının gerçekten
# memnun kalmadığı sohbetleri rastgeleden iyi ayıramadı: benzer mesajların çoğu "AA, AB, AC için
# aynısını yap" gibi verimli seri işlerdi. Yeni kuralda benzerlik yalnızca birebir yeniden gönderimde
# (EXACT_REPEAT_THRESHOLD) sayılır ve asıl sinyal güçlü onarım ifadeleridir:
#     en az 2 güçlü onarım ifadesi  ya da  1 güçlü onarım ifadesi + 1 birebir yeniden gönderim
EXACT_REPEAT_THRESHOLD = 0.97
LABEL_V2_MIN_REPAIRS = 2

# Şablon tespiti: ilk mesajın ilk 80 karakteri örneklemde bu kadar veya
# daha fazla tekrar ediyorsa sohbet otomatik gönderilmiş kabul edilir (Bölüm 2 ile aynı kural).
TEMPLATE_PREFIX_CHARS = 80
TEMPLATE_MIN_COUNT = 20

# Çok uzun mesajlar (yapıştırılmış kod, metin) benzerliği bozmasın diye kesilir.
MAX_CHARS = 1000

# Aykırı uzunluk sınırı. Sohbetlerin %99,9'u 32 turun altında; 100 turu aşan birkaç sohbet
# çoğunlukla otomatik ya da test amaçlı ve etiketi tek başına çarpıtabilir.
MAX_TURNS = 100

# Model keşfi: kullanıcı bazlı çapraz doğrulamada kat sayısı ve test için ayrılan kullanıcı oranı.
CV_FOLDS = 5

# Tur modeli: eklenti her mesajda yeniden tahmin yapar. Model k = 2 ile MAX_TURN_K arasındaki
# turlarla eğitilir; daha sonraki turlarda eklenti MAX_TURN_K'daki gibi davranır.
MAX_TURN_K = 6
TEST_SIZE = 0.2

# Eklentiyle ortak değerler. Bunlar `extension/src/config.ts` dosyasındakilerle aynı olmak
# zorunda; tests/test_extension_parity.py iki dosyayı karşılaştırır ve farklıysa hata verir.
EXT_NGRAM_SIZE = 3
EXT_HASH_DIM = 1024
EXT_MIN_NORMALIZED_CHARS = 12
EXT_RECENT_MESSAGES = 5
EXT_SIMILARITY_THRESHOLD = 0.8
EXT_SOFT_SIMILARITY_THRESHOLD = 0.6
EXT_EXIT_CARD_MIN_TURNS = 9
EXT_EXIT_CARD_MIN_REPEATS = 1
EXT_EXIT_CARD_COOLDOWN_TURNS = 5

# Çok platformlu sınama (P4, scripts/evaluate_platforms.py). Model eğitime girmeyen veri
# setlerinde (ShareChat, LMSYS, WildChat'in test kullanıcıları) platform ya da model ailesi
# başına ölçülür; bir platformda modelin açık kalması için üç koşul aranır:
#   - en az PLATFORM_MIN_CONVERSATIONS etiketlenebilir sohbet (daha azıyla karar verilmez)
#   - PR-AUC, o gruptaki döngü oranının en az PLATFORM_MIN_LIFT katı (rastgeleden belirgin iyi)
#   - yüksek güvenli tahminlerin kesinliği, WildChat test kullanıcılarındaki değerden en fazla
#     PLATFORM_MAX_PRECISION_DROP puan düşük (kart o platformda da aynı ölçüde isabetli)
# Koşullar sağlanmazsa öneri "model kapalı" olur; şerit (gerçekleşen tekrar) yine çalışır.
PLATFORM_MIN_CONVERSATIONS = 300
PLATFORM_MIN_LIFT = 1.5
PLATFORM_MAX_PRECISION_DROP = 0.10
PLATFORM_BOOTSTRAP = 200
# Dış veri setlerinden alınan mesajlar bu uzunlukta kesilir (WildFeedback ile aynı).
EXTERNAL_KEEP_CHARS = 2000
