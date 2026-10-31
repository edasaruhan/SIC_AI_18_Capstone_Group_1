import { describe, expect, it } from "vitest";
import { RepeatDetector } from "./repeat-detector";
import { similarity } from "./similarity";
import { normalizeText } from "./text";

describe("normalizeText", () => {
  it("Türkçe büyük harfleri doğru küçültür", () => {
    expect(normalizeText("İSTANBUL ILIK")).toBe("istanbul ılık");
  });
  it("noktalamayı atar, boşlukları teke indirir", () => {
    expect(normalizeText("  Merhaba,   dünya!!  ")).toBe("merhaba dünya");
  });
});

describe("similarity", () => {
  it("aynı metin 1", () => {
    expect(similarity("bu metni kısalt", "bu metni kısalt")).toBeCloseTo(1, 5);
  });
  it("küçük düzeltmeli aynı istek yüksek", () => {
    const a = normalizeText("Bu e-postayı daha resmi bir dille yeniden yaz");
    const b = normalizeText("Bu e-postayı daha resmi bir dille tekrar yazar mısın");
    expect(similarity(a, b)).toBeGreaterThan(0.6);
  });
  it("farklı konular düşük", () => {
    const a = normalizeText("Bu e-postayı daha resmi bir dille yeniden yaz");
    const b = normalizeText("İstanbul'da hafta sonu için gezilecek yerler öner");
    expect(similarity(a, b)).toBeLessThan(0.3);
  });
});

describe("RepeatDetector", () => {
  it("ilk mesaj benzer sayılmaz", () => {
    const d = new RepeatDetector();
    expect(d.check("Bu e-postayı daha resmi bir dille yeniden yaz").similar).toBe(false);
  });

  it("neredeyse aynı isteği tekrar gönderince şerit için yakalar", () => {
    const d = new RepeatDetector();
    d.remember("Bu e-postayı daha resmi bir dille yeniden yaz");
    const r = d.check("Bu e-postayı daha resmi bir dille yeniden yaz lütfen");
    expect(r.similar).toBe(true);
    expect(r.soft).toBe(true);
  });

  it("farklı kelimelerle tekrarı durdurmaz, yalnızca yumuşak tekrar sayar", () => {
    const d = new RepeatDetector();
    d.remember("Bu e-postayı daha resmi bir dille yeniden yaz");
    const r = d.check("Bu e-postayı daha resmi bir dille tekrar yazar mısın");
    expect(r.similar).toBe(false);
    expect(r.soft).toBe(true);
    expect(r.score).toBeGreaterThan(0.6);
  });

  it("farklı bir konuya geçince yakalamaz", () => {
    const d = new RepeatDetector();
    d.remember("Bu e-postayı daha resmi bir dille yeniden yaz");
    expect(d.check("İstanbul'da hafta sonu için gezilecek yerler öner").similar).toBe(false);
  });

  it("kısa meşru mesajlara (devam et, evet) dokunmaz", () => {
    const d = new RepeatDetector();
    d.remember("devam et");
    const r = d.check("devam et");
    expect(r.tooShort).toBe(true);
    expect(r.similar).toBe(false);
  });

  it("yalnızca son 5 mesajı hatırlar", () => {
    const d = new RepeatDetector();
    d.remember("Python ile dosyadan satır satır veri okuma örneği göster");
    for (const t of [
      "İstanbul'da hafta sonu için gezilecek yerler öner",
      "Kırmızı mercimek çorbası tarifi ve malzeme listesi ver",
      "Almanya'ya vize başvurusu için gereken belgeleri say",
      "Gitar çalmaya yeni başlayanlar için çalışma planı hazırla",
      "Uzun yürüyüşler için rahat ayakkabı seçimi nasıl yapılır",
    ]) {
      d.remember(t);
    }
    expect(d.check("Python ile dosyadan satır satır veri okuma örneği göster").similar).toBe(false);
  });

  it("reset() geçmişi siler", () => {
    const d = new RepeatDetector();
    d.remember("Bu e-postayı daha resmi bir dille yeniden yaz");
    d.reset();
    expect(d.check("Bu e-postayı daha resmi bir dille yeniden yaz").similar).toBe(false);
  });
});

import repeatFixture from "../../../tests/fixtures/repeat_parity.json";
import { newContent, rememberForTest } from "./repeat-detector";

describe("şerit kuralı: yeni içerik getiren mesaj tekrar sayılmaz", () => {
  it("Python ile aynı kararı verir", () => {
    for (const row of repeatFixture) {
      const d = new RepeatDetector();
      d.remember(row.previous);
      const r = d.check(row.new);
      expect([row.new, r.similar]).toEqual([row.new, row.repeat]);
      expect(newContent(normalizeText(row.new), rememberForTest(normalizeText(row.previous)))).toEqual(row.new_content);
    }
  });

  it("seri işlerde şerit çıkmaz ama yumuşak tekrar sayılır", () => {
    const d = new RepeatDetector();
    d.remember("1. soruyu adım adım çöz");
    const r = d.check("2. soruyu adım adım çöz");
    expect(r.similar).toBe(false);
    expect(r.newContent).toBe(true);
    expect(r.soft).toBe(true);
  });
});
