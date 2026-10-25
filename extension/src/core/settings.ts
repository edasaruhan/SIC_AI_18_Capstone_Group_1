import { COUNTS_V1_KEY, COUNTS_V2_KEY } from "./counters";

/**
 * Ayarlar. Buraya YALNIZCA ayar anahtarları yazılır; mesaj metni, sohbet adresi ya da sohbet
 * kimliği asla yazılmaz. Sayaçlar src/core/counters.ts içinde (sayaç şeması v2, K18).
 */

export interface Settings {
  /** Eklenti tamamen açık mı? Kapalıysa içerik betiği hiçbir şey yapmaz. */
  enabled: boolean;
  /** Çıkış kartı gösterilsin mi? ("Bir daha gösterme" bunu kapatır.) */
  exitCardEnabled: boolean;
  /**
   * Öneriler (şerit ve çıkış kartı) gösterilsin mi? Kapalıysa eklenti "yalnızca say" modunda
   * çalışır: hiçbir şeyi bekletmez ve göstermez, yalnızca günlük sayıları tutar (pilot çalışma için).
   */
  suggestionsEnabled: boolean;
}

export const DEFAULT_SETTINGS: Settings = { enabled: true, exitCardEnabled: true, suggestionsEnabled: true };

/** chrome.storage.local ile uyumlu en küçük arayüz (testte bellekteki sahtesi kullanılır). */
export interface KeyValueStorage {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
}

export const SETTINGS_KEY = "kafiai.settings";
/** "Taze başlat" sonrası açılan yeni sohbeti tanımak için: yalnızca platform kimliği ve son geçerlilik zamanı. */
export const PENDING_FRESH_KEY = "kafiai.pending_fresh";
/** Depoda bulunabilecek anahtarların tamamı (gizlilik testi bu listeyi kullanır). */
export const STORAGE_KEYS = [SETTINGS_KEY, COUNTS_V2_KEY, COUNTS_V1_KEY, PENDING_FRESH_KEY];

/** Depodan gelen her şeye güvenilmez: bilinmeyen alanlar atılır, bozuk değerler varsayılana döner. */
export function parseSettings(raw: unknown): Settings {
  const r = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    enabled: typeof r.enabled === "boolean" ? r.enabled : DEFAULT_SETTINGS.enabled,
    exitCardEnabled: typeof r.exitCardEnabled === "boolean" ? r.exitCardEnabled : DEFAULT_SETTINGS.exitCardEnabled,
    suggestionsEnabled:
      typeof r.suggestionsEnabled === "boolean" ? r.suggestionsEnabled : DEFAULT_SETTINGS.suggestionsEnabled,
  };
}

export class SettingsStore {
  constructor(private readonly storage: KeyValueStorage) {}

  async load(): Promise<Settings> {
    const stored = await this.storage.get([SETTINGS_KEY]);
    return parseSettings(stored[SETTINGS_KEY]);
  }

  async update(patch: Partial<Settings>): Promise<Settings> {
    const next = { ...(await this.load()), ...patch };
    await this.storage.set({ [SETTINGS_KEY]: parseSettings(next) });
    return parseSettings(next);
  }

  /** Tüm ayarları ve sayaçları siler; eklenti varsayılana döner. */
  async clearAll(): Promise<void> {
    await this.storage.remove(STORAGE_KEYS);
  }
}
