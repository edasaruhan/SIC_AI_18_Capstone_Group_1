// Tüm eşikler ve zamanlamalar burada durur (karar K06).

/** Cevap izleme döngüsünün aralığı (ms). Yalnızca bir mesaj gönderildikten sonra çalışır. */
export const POLL_MS = 250;

/** "Üretiliyor" sinyali bu kadar süre görünmezse cevap bitmiş sayılır (ms). */
export const QUIET_MS = 600;

/** Gönderdikten sonra bu kadar sürede hiç "üretiliyor" sinyali gelmezse vazgeçilir (ms). */
export const START_TIMEOUT_MS = 15_000;

/** Sayfa adresinin değişip değişmediğini kontrol etme aralığı (ms). */
export const NAV_POLL_MS = 1000;

/** Benzerlik kuralları: tüm eşikler burada (karar K06). */
/**
 * Bu değer ve üstü "benzer mesaj" sayılır. 0,6'dan 0,8'e çıkarıldı: WildChat kalibrasyonunda
 * 0,6'da şeridin tahmini isabeti %59, 0,8'de %83 (outputs/calibration_summary.json, karar K14).
 */
export const SIMILARITY_THRESHOLD = 0.8;
/**
 * Yumuşak eşik: bu değer ile SIMILARITY_THRESHOLD arasındaki mesajlar kullanıcıyı durdurmaz,
 * yalnızca çıkış kartı için "tekrar denemesi" sayılır. Bu aralıktaki çiftlerin yaklaşık
 * yarısı gerçekten aynı talebin farklı kelimelerle tekrarı (karar K14).
 */
export const SOFT_SIMILARITY_THRESHOLD = 0.6;
export const MIN_NORMALIZED_CHARS = 12; // bundan kısa mesajlar ("devam et", "evet") hiç karşılaştırılmaz
export const RECENT_MESSAGES = 5; // yalnızca son N kullanıcı mesajıyla karşılaştırılır (bellekte, kalıcı değil)
export const NGRAM_SIZE = 3; // karakter n-gram uzunluğu
export const HASH_DIM = 1024; // n-gram özet vektörünün boyutu

/** Açılan sohbetteki eski mesajları okuma: mesajlar sayfa açıldıktan sonra çizilir. */
export const HISTORY_STABLE_TICKS = 2; // mesaj sayısı bu kadar ölçüm aynı kalınca "çizim bitti" say
export const HISTORY_TIMEOUT_MS = 8_000; // bu sürede hiç mesaj görülmezse vazgeç (boş/yeni sohbet)

/**
 * Çıkış kartı. Kart şu üçü birlikte doğruysa, cevap bittikten sonra ve kullanıcı yazmaya
 * başlamadan önce çıkar. Tur sınırı artık görev türüne göre src/data/task-norms.json
 * dosyasından gelir (o türün %90'lık diliminin bir fazlası). Aşağıdaki sayı yalnızca
 * görev türü bilinmediğinde kullanılır ve "diğer" türünün normuna eşittir (karar K14).
 */
export const EXIT_CARD_MIN_TURNS = 9; // görev türü bilinmiyorsa en az bu kadar kullanıcı mesajı
export const EXIT_CARD_MIN_REPEATS = 1; // bu sohbette en az bu kadar benzer mesaj denemesi
export const EXIT_CARD_COOLDOWN_TURNS = 5; // kapatılınca / yok sayılınca bu kadar tur boyunca tekrar çıkmaz
export const FRESH_START_MAX_CHARS = 400; // taslakta her istek en fazla bu kadar karakter

// Sayaçların saklama süresi ve kovaları src/data/counter-schema.json içinde (karar K18).
