import { EXIT_CARD_COOLDOWN_TURNS, EXIT_CARD_MIN_REPEATS, EXIT_CARD_MIN_TURNS } from "../config";
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
 * İkinci yol tur modeli: kullanıcının son mesajından sonra model yüksek risk tahmin ettiyse
 * (src/core/turn-model.ts), kart tur sınırını beklemeden o turun sonunda açılabilir.
 * Bekleme süresi iki yol için de aynıdır.
 */
export class ExitCardPolicy {
  private repeats = 0;
  private quietUntilTurn = 0;
  private currentNorm: TaskNorm | null = null;
  private highRiskTurn = -1;

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

  /** Kullanıcı bu sohbette benzer bir mesaj göndermeyi denedi. */
  noteRepeat(): void {
    this.repeats += 1;
  }

  /** Tur modelinin bu turdaki tahmini. Yalnızca "yuksek" seviye kartı açabilir. */
  noteRisk(level: RiskLevel, turns: number): void {
    if (level === "yuksek") this.highRiskTurn = turns;
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
  triggerSource(turns: number): "norm" | "model" | null {
    if (this.highRiskTurn === turns) return "model";
    if (turns >= this.minTurns && this.repeats >= EXIT_CARD_MIN_REPEATS) return "norm";
    return null;
  }

  /** Kart kısa süre önce kapatıldı ya da yok sayıldı; bekleme süresi dolmadı. */
  inCooldown(turns: number): boolean {
    return turns < this.quietUntilTurn;
  }

  shouldShow(turns: number): boolean {
    if (turns < this.quietUntilTurn) return false;
    const byNorm = turns >= this.minTurns && this.repeats >= EXIT_CARD_MIN_REPEATS;
    return byNorm || this.highRiskTurn === turns;
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
  }
}
