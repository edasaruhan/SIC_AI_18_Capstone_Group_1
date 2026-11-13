import {
  APOLOGY_CARD_STREAK,
  EXIT_CARD_COOLDOWN_TURNS,
  EXIT_CARD_MIN_REPEATS,
  EXIT_CARD_MIN_REPEATS_NO_MODEL,
  EXIT_CARD_MIN_TURNS,
} from "../config";
import { taskNorm, type TaskNorm, type TaskType } from "./tasks";
import type { RiskLevel } from "./turn-model";

/**
 * Çıkış kartının ne zaman çıkacağına karar verir. Yalnızca bellekte; sohbet değişince sıfırlanır.
 * Kural tamamen açık: tur sayısı + gerçekleşmiş benzer mesaj denemesi + bekleme süresi.
 *
 * Tur sınırı sohbetin görev türüne göre değişir: WildChat'te o türdeki çok turlu sohbetlerin
 * %90'ı kaç turda bitiyorsa, kart bir sonraki turda açılabilir. Görev türü bilinmiyorsa
 * EXIT_CARD_MIN_TURNS kullanılır.
 *
 * Tur sınırı geçildiğinde kart için iki döngü işareti birlikte gerekir: son dört mesajdan biri
 * öncekine çok benziyor (src/core/signals.ts) ve model o turda en az öneri seviyesinde. Çevrimdışı
 * değerlendirmede (scripts/evaluate_replay.py) işaretlerden yalnızca biri yeterliyken bu yolun
 * isabeti %9 idi (taban %5); ikisi birlikte arandığında %26. Model bu sohbette çalışmıyorsa
 * (geçmişin başı okunamadı ya da platformda model kapalı) onun yerine en az
 * EXIT_CARD_MIN_REPEATS_NO_MODEL benzer mesaj aranır.
 *
 * İkinci yol tur modeli: kullanıcının son mesajından sonra model yüksek risk tahmin ettiyse
 * (src/core/turn-model.ts), kart tur sınırını beklemeden o turun sonunda açılabilir. Üçüncü yol
 * özür döngüsü: cevaplar üst üste özürle başladıysa (K32). Bekleme süresi hepsi için aynıdır.
 */
export class ExitCardPolicy {
  private repeats = 0;
  private quietUntilTurn = 0;
  private currentNorm: TaskNorm | null = null;
  private highRiskTurn = -1;
  private suggestTurn = -1;
  private apologyTurn = -1;
  /** Tur modeli bu sohbette en az bir tahmin yaptı mı? */
  private modelSeen = false;

  /** Sohbetin ilk mesajından tahmin edilen görev türü. Yalnızca ilk kez çağrıldığında etkili olur. */
  setTask(task: TaskType): void {
    if (this.currentNorm === null) this.currentNorm = taskNorm(task);
  }

  /** Kart metninde kullanılan norm; görev türü bilinmiyorsa null. */
  get norm(): TaskNorm | null {
    return this.currentNorm;
  }

  /** Kartın açılabileceği en erken tur. */
  get minTurns(): number {
    return this.currentNorm ? Math.floor(this.currentNorm.p90_turns) + 1 : EXIT_CARD_MIN_TURNS;
  }

  /** Son birkaç mesajdan kaçı öncekine çok benziyor (src/core/signals.ts, çıkışta sıfırlanır). */
  setRepeats(count: number): void {
    this.repeats = count;
  }

  /**
   * Kullanıcı döngüden çıktı (teşekkür etti, "oldu" dedi) ya da konu değişti: o ana kadarki benzer
   * mesaj denemeleri artık kartı açtırmaz (K32).
   */
  clearRepeats(): void {
    this.repeats = 0;
    this.apologyTurn = -1;
    this.suggestTurn = -1;
  }

  /** Cevaplar üst üste özürle başladı (src/core/signals.ts); iki ve üstü kartı açabilir (K32). */
  noteApologies(streak: number, turns: number): void {
    if (streak >= APOLOGY_CARD_STREAK) this.apologyTurn = turns;
  }

  /** Tur modelinin bu turdaki tahmini. Yalnızca "yuksek" seviye kartı açabilir. */
  noteRisk(level: RiskLevel, turns: number): void {
    this.modelSeen = true;
    if (level === "yuksek") this.highRiskTurn = turns;
    if (level === "yuksek" || level === "oneri") this.suggestTurn = turns;
  }

  /** Kart bu turda modelin yüksek risk tahmini yüzünden mi açılacak? */
  modelTriggered(turns: number): boolean {
    return this.highRiskTurn === turns && turns >= this.quietUntilTurn;
  }

  /**
   * Kartı açtıracak koşul bu turda sağlanıyor mu, bekleme süresine bakmadan? Hangi yoldan?
   * Model yolu önce gelir, çünkü gerekçe gösterebilir. Sayaçlar "tetiklendi" ile "gösterildi"
   * arasındaki farkı (bekleme, ayar, sayım modu) bu sayede ayırabiliyor.
   */
  triggerSource(turns: number): "norm" | "model" | "ozur" | null {
    if (this.highRiskTurn === turns) return "model";
    if (this.apologyTurn === turns) return "ozur";
    if (this.longAndLooping(turns)) return "norm";
    return null;
  }

  /** Tur sınırı geçildi, yakın zamanda benzer mesaj var ve model de en az öneri seviyesinde. */
  private longAndLooping(turns: number): boolean {
    if (turns < this.minTurns || this.repeats < EXIT_CARD_MIN_REPEATS) return false;
    return this.modelSeen ? this.suggestTurn === turns : this.repeats >= EXIT_CARD_MIN_REPEATS_NO_MODEL;
  }

  /** Bu turun mesajı için şerit gösterildi (bir turda tek müdahale). */
  private stripTurn = -1;

  /** Şerit gösterildi; turns, şeridin ait olduğu mesajın tur numarasıdır (gönderimden sonraki sayı). */
  noteStrip(turns: number): void {
    this.stripTurn = turns;
  }

  /**
   * Aynı turda şerit çıktıysa kart o turda gösterilmez, en erken sonraki turda gelebilir. Yeniden
   * oynatmada (20.000 sohbet) kart 100 sohbette 18,9'dan 18,4'e, yakalama %28,7'den %28,5'e iniyor.
   */
  stripShownThisTurn(turns: number): boolean {
    return this.stripTurn === turns;
  }

  /** Kart kısa süre önce kapatıldı ya da yok sayıldı; bekleme süresi dolmadı. */
  inCooldown(turns: number): boolean {
    return turns < this.quietUntilTurn;
  }

  shouldShow(turns: number): boolean {
    if (turns < this.quietUntilTurn) return false;
    return this.longAndLooping(turns) || this.highRiskTurn === turns || this.apologyTurn === turns;
  }

  /** Kart kapatıldı ya da yok sayıldı: bir süre tekrar çıkmasın. */
  dismissed(turns: number): void {
    this.quietUntilTurn = turns + EXIT_CARD_COOLDOWN_TURNS;
  }

  reset(): void {
    this.repeats = 0;
    this.quietUntilTurn = 0;
    this.currentNorm = null;
    this.highRiskTurn = -1;
    this.suggestTurn = -1;
    this.apologyTurn = -1;
    this.modelSeen = false;
    this.stripTurn = -1;
  }
}
