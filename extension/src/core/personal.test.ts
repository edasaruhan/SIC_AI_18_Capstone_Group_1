import { describe, expect, it } from "vitest";
import fixture from "../../../tests/fixtures/personal_parity.json";
import { isPersonal } from "./personal";

describe("kişisel ve duygusal mesaj tespiti", () => {
  it("Python ile aynı sonucu verir", () => {
    for (const row of fixture) expect([row.text, isPersonal(row.text)]).toEqual([row.text, row.personal]);
  });

  it("büyük harfli İngilizce ve Türkçe yazımı tanır", () => {
    expect(isPersonal("I'M SO SAD")).toBe(true);
    expect(isPersonal("ÇOK MUTSUZUM")).toBe(true);
  });

  it("kurgu isteğinde yalnızca kendine zarar ifadeleri sayılır", () => {
    expect(isPersonal("Write a story where my girlfriend broke up with me")).toBe(false);
    expect(isPersonal("Write a story, I want to kill myself")).toBe(true);
  });

  it("iş ve kod mesajlarında tetiklenmez", () => {
    for (const t of ["fix this bug", "Bu SQL sorgusu hata veriyor", "summarize the article", "my ex-boss sent an email", ""]) {
      expect(isPersonal(t)).toBe(false);
    }
  });
});
