import type { TaskType } from "./tasks";

/**
 * Araç çubuğu penceresi ile sekmedeki içerik betiği arasındaki mesajlar. Yalnızca eklentinin
 * kendi parçaları arasında, tarayıcının içinde gider (ağ değil). Mesaj metni hiçbir zaman
 * bu mesajlara girmez: içerik betiği yalnızca sayıları ve sabit sözcükleri gönderir.
 */

export const MSG_THIS_CONVERSATION = "kafiai.this_conversation";
export const MSG_OPEN_CARD = "kafiai.open_card";

export type PopupMessage = { type: typeof MSG_THIS_CONVERSATION } | { type: typeof MSG_OPEN_CARD };

export interface ConversationSnapshot {
  platform: string;
  /** Eklenti açık mı? */
  active: boolean;
  /** Öneriler açık mı ("yalnızca say" değil)? */
  suggesting: boolean;
  /** Bu platformda öneri gösterilebiliyor mu (platform kaydı)? */
  intervening: boolean;
  /** Sohbet kişisel ya da duygusal görünüyor mu? Öyleyse öneri gösterilmez. */
  personal: boolean;
  /** Bu sohbetteki kullanıcı mesajı sayısı */
  turns: number;
  task: TaskType | null;
  /** Öncekine çok benzeyen mesaj sayısı */
  similar: number;
  /** Bu görev türünde sohbetlerin genelde bittiği tur sayıları */
  norm: { median: number; p75: number } | null;
  /** "Yeni sohbete geç" kartı şu an açılabilir mi? */
  card_available: boolean;
}

/** Penceredeki sohbet özetinde bulunabilecek alanların tam listesi (gizlilik testi bunu denetler). */
export const SNAPSHOT_KEYS: (keyof ConversationSnapshot)[] = [
  "platform",
  "active",
  "suggesting",
  "intervening",
  "personal",
  "turns",
  "task",
  "similar",
  "norm",
  "card_available",
];

export function isPopupMessage(m: unknown): m is PopupMessage {
  const t = (m as { type?: unknown } | null)?.type;
  return t === MSG_THIS_CONVERSATION || t === MSG_OPEN_CARD;
}
