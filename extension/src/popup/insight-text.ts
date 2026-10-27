import config from "../data/insights-config.json";
import taskRules from "../data/task-rules.json";
import type { TaskInsight, WeeklyInsights } from "../core/insights";
import type { ConversationSnapshot } from "../core/messages";

/**
 * İçgörü yapısından Türkçe cümleler. Dil yargılamayan ve önerileri "İstersen…" ile kuran
 * bir dil: puan, sıralama, seri, "risk" ya da "bağımlı" yok. Sayılar yalnızca sayı olarak geçer.
 */

const LABELS = taskRules.labels as Record<string, string>;
const SLOT_LABELS = config.slot_labels as Record<string, string>;
const PLATFORM_LABELS = config.platform_labels as Record<string, string>;
const TIPS = config.tips as Record<string, string>;

export const taskLabel = (task: string | null): string => (task !== null ? (LABELS[task] ?? LABELS["diger"] ?? "Diğer") : "Diğer");

// Sayının okunuşundaki son kelime: "4" → dört, "20" → yirmi, "100" → yüz.
const UNITS = ["", "bir", "iki", "üç", "dört", "beş", "altı", "yedi", "sekiz", "dokuz"];
const TENS = ["", "on", "yirmi", "otuz", "kırk", "elli", "altmış", "yetmiş", "seksen", "doksan"];

function lastWord(n: number): string {
  if (n === 0) return "sıfır";
  if (n % 10 !== 0) return UNITS[n % 10] ?? "";
  if (n % 100 !== 0) return TENS[(n % 100) / 10] ?? "";
  if (n % 1000 !== 0) return "yüz";
  return "bin";
}

/** "4'ünde", "6'sında", "10'unda": sayıya iyelik ve bulunma eki (sayının okunuşuna göre). */
export function numberIn(n: number): string {
  const word = lastWord(n);
  const vowels = word.match(/[aeıioöuü]/g) ?? ["e"];
  const last = vowels[vowels.length - 1] ?? "e";
  const v = ({ a: "ı", ı: "ı", e: "i", i: "i", o: "u", u: "u", ö: "ü", ü: "ü" } as Record<string, string>)[last] ?? "i";
  const front = v === "i" || v === "ü";
  const endsWithVowel = /[aeıioöuü]$/.test(word);
  return `${n}'${endsWithVowel ? "s" : ""}${v}n${front ? "de" : "da"}`;
}

export function weekHeadline(w: WeeklyInsights): string[] {
  if (w.conversations === 0) return ["Son 7 günde biten bir sohbet yok."];
  const lines = [`Son 7 günde ${w.conversations} sohbet.`];
  if (!w.enough) {
    lines.push("Bir örüntüden söz etmek için biraz daha sohbet gerekiyor.");
    return lines;
  }
  lines.push(
    w.loops === 0
      ? "Hiçbirinde aynı isteği birkaç kez yazman gerekmedi."
      : `Bunların ${numberIn(w.loops)} cevap ilk seferde oturmadı; aynı isteği birkaç kez yazdın.`,
  );
  const slot = w.top_slot !== null ? SLOT_LABELS[w.top_slot] : undefined;
  if (slot && w.loops > 0) lines.push(`Benzer mesajlar en çok ${slot} saatlerinde oldu.`);
  return lines;
}

export function taskSummary(t: TaskInsight): string {
  return t.loops > 0 ? `${t.conversations} sohbet · ${t.loops} tekrar` : `${t.conversations} sohbet`;
}

/** Bir görev satırı açılınca görünen cümleler. Son cümle her zaman "İstersen…" ile başlayan öneri. */
export function taskDetails(t: TaskInsight, norm: { median_turns: number } | null): string[] {
  if (!t.enough) return ["Bu tür için henüz az sohbet var; birkaç sohbet sonra burada daha fazlası olacak."];
  const lines: string[] = [];
  if (t.loops > 0) lines.push(`Bunların ${numberIn(t.loops)} aynı isteği birkaç kez yazdın.`);
  else lines.push("Bu sohbetlerde aynı isteği tekrar yazman gerekmedi.");
  if (norm && t.task !== "diger") {
    const median = Math.round(norm.median_turns);
    lines.push(
      t.long > 0
        ? `Bu tür sohbetler genelde ${median} turda bitiyor; seninkilerden ${t.long} tanesi 7 turu geçti.`
        : `Bu tür sohbetler genelde ${median} turda bitiyor; seninkiler de uzamadı.`,
    );
  }
  const slot = t.top_slot !== null ? SLOT_LABELS[t.top_slot] : undefined;
  if (slot) lines.push(`Benzer mesajlar çoğunlukla ${slot} saatlerindeydi.`);
  if (t.platforms.length > 1) {
    lines.push(t.platforms.map(([p, n]) => `${PLATFORM_LABELS[p] ?? p} ${n}`).join(", "));
  }
  if (t.loops > 0 || t.long > 0) lines.push(TIPS[t.task] ?? TIPS["diger"] ?? "");
  return lines.filter((l) => l !== "");
}

/** "Bu sohbet" bölümü. null: bu sekmede gösterilecek bir şey yok. */
export function conversationLines(s: ConversationSnapshot): string[] {
  if (s.personal) return ["Bu sohbette öneri göstermiyorum."];
  if (!s.intervening) return ["Bu sitede şimdilik yalnızca sayıyorum."];
  if (s.turns === 0) return ["Henüz mesaj yok."];
  const lines = [`${taskLabel(s.task)} · ${s.turns} mesaj`];
  if (s.norm) {
    const median = Math.round(s.norm.median);
    const p75 = Math.round(s.norm.p75);
    lines.push(
      median === p75
        ? `Bu tür sohbetler genelde ${median} turda bitiyor.`
        : `Bu tür sohbetler genelde ${median} turda, çoğu en geç ${p75} turda bitiyor.`,
    );
  }
  if (s.similar > 0) lines.push(`${s.similar} mesaj öncekine çok benziyordu.`);
  return lines;
}
