// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { REPAIRS } from "../core/repairs";
import { Strip } from "./strip";

function shadowOf(): ShadowRoot {
  return document.querySelector<HTMLElement>('[data-kafiai="strip"]')!.shadowRoot!;
}
function buttonByText(text: string): HTMLButtonElement {
  return Array.from(shadowOf().querySelectorAll("button")).find((b) => b.textContent === text)!;
}
const actions = () => ({ onSendAnyway: vi.fn(), onClose: vi.fn(), onRepair: vi.fn() });

describe("Strip", () => {
  const strip = new Strip();
  afterEach(() => strip.hide());

  it("gösterilince sayfaya eklenir, gizlenince kaldırılır", () => {
    strip.show(document.body, actions());
    expect(document.querySelector('[data-kafiai="strip"]')).not.toBeNull();
    expect(strip.visible).toBe(true);
    strip.hide();
    expect(document.querySelector('[data-kafiai="strip"]')).toBeNull();
    expect(strip.visible).toBe(false);
  });

  it("ilk görünümde mesajı ve iki ana düğmeyi gösterir", () => {
    strip.show(document.body, actions());
    expect(shadowOf().textContent).toContain("Bunu az önce de sormuştun.");
    expect(buttonByText("Yine de gönder")).toBeTruthy();
    expect(buttonByText("Neyin eksik olduğunu söyle")).toBeTruthy();
  });

  it("'Yine de gönder' ilgili işlevi çağırır ve şeridi kapatır", () => {
    const a = actions();
    strip.show(document.body, a);
    buttonByText("Yine de gönder").click();
    expect(a.onSendAnyway).toHaveBeenCalledTimes(1);
    expect(a.onClose).not.toHaveBeenCalled();
    expect(strip.visible).toBe(false);
  });

  it("'Kapat' ve Escape düzenlemeye döndürür", () => {
    const a = actions();
    strip.show(document.body, a);
    buttonByText("Kapat").click();
    expect(a.onClose).toHaveBeenCalledTimes(1);

    strip.show(document.body, a);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(a.onClose).toHaveBeenCalledTimes(2);
    expect(strip.visible).toBe(false);
  });

  it("'Neyin eksik olduğunu söyle' onarım seçeneklerini açar, şerit açık kalır", () => {
    strip.show(document.body, actions());
    buttonByText("Neyin eksik olduğunu söyle").click();
    expect(strip.visible).toBe(true);
    for (const r of REPAIRS) expect(buttonByText(r.label)).toBeTruthy();
  });

  it("bir onarım seçilince cümle iletilir ve şerit kapanır", () => {
    const a = actions();
    strip.show(document.body, a);
    buttonByText("Neyin eksik olduğunu söyle").click();
    buttonByText("Fazla uzun").click();
    expect(a.onRepair).toHaveBeenCalledWith(REPAIRS.find((r) => r.id === "shorter")!.sentence, "shorter");
    expect(strip.visible).toBe(false);
  });

  it("'Geri' ilk görünüme döner", () => {
    strip.show(document.body, actions());
    buttonByText("Neyin eksik olduğunu söyle").click();
    buttonByText("Geri").click();
    expect(buttonByText("Yine de gönder")).toBeTruthy();
  });

  it("art arda show() tek şerit bırakır", () => {
    strip.show(document.body, actions());
    strip.show(document.body, actions());
    expect(document.querySelectorAll('[data-kafiai="strip"]').length).toBe(1);
  });

  it("yargılayıcı söz içermez", () => {
    strip.show(document.body, actions());
    const text = shadowOf().textContent!.toLowerCase();
    for (const bad of ["bağımlı", "risk", "tehlike", "uyarı"]) expect(text).not.toContain(bad);
  });
});

describe("Strip: Yerinde değildi", () => {
  const strip = new Strip();
  afterEach(() => strip.hide());

  it("işlev verilmezse düğme gösterilmez", () => {
    strip.show(document.body, actions());
    expect(Array.from(shadowOf().querySelectorAll("button")).some((b) => b.textContent === "Yerinde değildi")).toBe(false);
  });

  it("işlev verilirse düğme çıkar, tıklanınca çağrılır ve şerit kapanır", () => {
    const onNotRelevant = vi.fn();
    const a = { ...actions(), onNotRelevant };
    strip.show(document.body, a);
    buttonByText("Yerinde değildi").click();
    expect(onNotRelevant).toHaveBeenCalledTimes(1);
    expect(a.onSendAnyway).not.toHaveBeenCalled();
    expect(a.onClose).not.toHaveBeenCalled();
    expect(strip.visible).toBe(false);
  });
});

import { FRESH_START_FROM_ATTEMPT, stripMessage } from "./strip";

describe("şerit metni duruma göre değişir", () => {
  const strip = new Strip();
  afterEach(() => strip.hide());

  it("birebir tekrar, yeniden ifade, ikinci deneme ve sonrası farklı metin alır", () => {
    const texts = new Set([
      stripMessage({ attempt: 1, exact: true, task: null }).title,
      stripMessage({ attempt: 1, exact: false, task: null }).title,
      stripMessage({ attempt: 2, exact: true, task: null }).title,
      stripMessage({ attempt: 3, exact: true, task: null }).title,
    ]);
    expect(texts.size).toBe(4);
  });

  it("görev türüne göre ipucu ekler; uzun denemede ipucu yerine yeni sohbet önerir", () => {
    expect(stripMessage({ attempt: 1, exact: true, task: "kod" }).hint).toContain("Hata mesajını");
    expect(stripMessage({ attempt: 1, exact: true, task: "diger" }).hint).toBeNull();
    expect(stripMessage({ attempt: 4, exact: false, task: "kod" }).hint).toBeNull();
  });

  it(`${FRESH_START_FROM_ATTEMPT}. denemede 'Yeni sohbete geç' ana düğme olur`, () => {
    const a = { ...actions(), onFreshStart: vi.fn() };
    strip.show(document.body, a, { attempt: FRESH_START_FROM_ATTEMPT, exact: false, task: "kod" });
    expect(shadowOf().textContent).toContain("Dümen sende");
    expect(shadowOf().textContent).toContain(`${FRESH_START_FROM_ATTEMPT}. deneme`);
    buttonByText("Yeni sohbete geç").click();
    expect(a.onFreshStart).toHaveBeenCalledOnce();
    expect(strip.visible).toBe(false);
  });

  it("onFreshStart verilmezse yeni sohbet düğmesi çıkmaz", () => {
    strip.show(document.body, actions(), { attempt: 5, exact: true, task: null });
    expect(buttonByText("Yeni sohbete geç")).toBeUndefined();
    expect(buttonByText("Neyin eksik olduğunu söyle")).toBeTruthy();
  });

  it("hiçbir durumda yargılayıcı söz yok", () => {
    for (const attempt of [1, 2, 3, 6]) {
      for (const exact of [true, false]) {
        for (const task of ["kod", "ceviri", "ozet", "yazma", "soru", "diger", null]) {
          const m = stripMessage({ attempt, exact, task });
          const text = `${m.title} ${m.body} ${m.hint ?? ""}`.toLowerCase();
          for (const bad of ["bağımlı", "risk", "irade", "tehlike", "başarısız", "%"]) expect(text).not.toContain(bad);
        }
      }
    }
  });
});
