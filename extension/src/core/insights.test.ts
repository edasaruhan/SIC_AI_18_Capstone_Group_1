import { describe, expect, it } from "vitest";
import fixture from "../../../tests/fixtures/insights_parity.json";
import type { CountsV2 } from "./counters";
import { weeklyInsights, windowDays } from "./insights";

const at = (day: string) => {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d, 12);
};

describe("haftalık içgörü", () => {
  it("Python ile aynı sonucu verir", () => {
    for (const c of fixture) {
      const counts = { v: 2, days: c.days } as unknown as CountsV2;
      expect(weeklyInsights(counts, at(c.today))).toEqual(c.expected);
    }
  });

  it("pencere bugünü dahil 7 gün; ay ve yıl geçişinde de", () => {
    expect(windowDays(at("2027-01-02"))).toEqual([
      "2027-01-02", "2027-01-01", "2026-12-31", "2026-12-30", "2026-12-29", "2026-12-28", "2026-12-27",
    ]);
  });

  it("az veriyle örüntü söylemez", () => {
    const counts: CountsV2 = {
      v: 2,
      days: { "2026-10-26": { phase: "oneri", c: { "conversation|chatgpt|kod|4-6|orta|dongu": 2, "send|chatgpt|18-24|kod|4-6|benzer": 2 } } },
    };
    const w = weeklyInsights(counts, at("2026-10-26"));
    expect(w.enough).toBe(false);
    expect(w.top_slot).toBeNull();
    expect(w.tasks[0]?.enough).toBe(false);
  });

  it("çıktıda yalnızca sayılar ve şemadaki sabit sözcükler var", () => {
    const w = weeklyInsights({ v: 2, days: fixture[4]!.days } as unknown as CountsV2, at(fixture[4]!.today));
    const words = JSON.stringify(w).match(/"[^"]*"/g) ?? [];
    const allowed = /^"(days|conversations|loops|similar_sends|top_slot|fresh_starts|enough|tasks|task|long|platforms|kod|ceviri|ozet|yazma|soru|diger|na|chatgpt|gemini|claude|copilot|google_ai_mode|00-06|06-12|12-18|18-24)"$/;
    for (const w2 of words) expect(w2).toMatch(allowed);
  });
});
