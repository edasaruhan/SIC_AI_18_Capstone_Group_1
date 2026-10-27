import { describe, expect, it } from "vitest";
import fixture from "../../../tests/fixtures/insights_parity.json";
import type { CountsV2 } from "../core/counters";
import { weeklyInsights } from "../core/insights";
import type { ConversationSnapshot } from "../core/messages";
import { taskNorm, type TaskType } from "../core/tasks";
import { conversationLines, numberIn, taskDetails, weekHeadline } from "./insight-text";

const FORBIDDEN = ["bağımlı", "risk", "tehlike", "seri", "rozet", "puan", "sıra", "ödül", "%", "kötü", "başarısız", "fazla kullan"];

describe("içgörü metinleri", () => {
  it("sayıya doğru eki getirir", () => {
    const cases: [number, string][] = [
      [1, "1'inde"], [2, "2'sinde"], [3, "3'ünde"], [4, "4'ünde"], [5, "5'inde"], [6, "6'sında"], [7, "7'sinde"],
      [8, "8'inde"], [9, "9'unda"], [10, "10'unda"], [20, "20'sinde"], [30, "30'unda"], [40, "40'ında"],
      [50, "50'sinde"], [60, "60'ında"], [70, "70'inde"], [80, "80'inde"], [90, "90'ında"], [100, "100'ünde"],
      [23, "23'ünde"], [1000, "1000'inde"],
    ];
    for (const [n, want] of cases) expect(numberIn(n)).toBe(want);
  });

  it("hiçbir durumda yargılayıcı söz ya da yüzde içermez; öneriler 'İstersen' ile başlar", () => {
    for (const c of fixture) {
      const w = weeklyInsights({ v: 2, days: c.days } as unknown as CountsV2, new Date(2026, 9, 26, 12));
      const lines = [...weekHeadline(w), ...w.tasks.flatMap((t) => taskDetails(t, taskNorm(t.task as TaskType)))];
      for (const line of lines) {
        for (const bad of FORBIDDEN) expect(line.toLowerCase()).not.toContain(bad);
      }
      for (const t of w.tasks) {
        const details = taskDetails(t, taskNorm(t.task as TaskType));
        const tips = details.filter((l) => l.startsWith("İstersen"));
        if (t.enough && (t.loops > 0 || t.long > 0)) expect(tips).toHaveLength(1);
      }
    }
  });

  it("az veride örüntü yerine bunu söyler", () => {
    const w = weeklyInsights({ v: 2, days: fixture[1]!.days } as unknown as CountsV2, new Date(2026, 9, 26, 12));
    expect(weekHeadline(w).join(" ")).toContain("biraz daha sohbet gerekiyor");
  });

  const snap = (over: Partial<ConversationSnapshot> = {}): ConversationSnapshot => ({
    platform: "chatgpt", active: true, suggesting: true, intervening: true, personal: false, turns: 7, task: "kod",
    similar: 2, norm: { median: 3, p75: 5 }, card_available: true, ...over,
  });

  it("'Bu sohbet' satırları", () => {
    expect(conversationLines(snap())).toEqual([
      "Kod yazma ve hata ayıklama · 7 mesaj",
      "Bu tür sohbetler genelde 3 turda, çoğu en geç 5 turda bitiyor.",
      "2 mesaj öncekine çok benziyordu.",
    ]);
    expect(conversationLines(snap({ personal: true }))).toEqual(["Bu sohbette öneri göstermiyorum."]);
    expect(conversationLines(snap({ turns: 0 }))).toEqual(["Henüz mesaj yok."]);
  });
});
