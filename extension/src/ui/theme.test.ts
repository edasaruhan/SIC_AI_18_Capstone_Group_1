// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { detectTheme, luminance, mountCard, parseColor } from "./theme";

describe("kart teması sayfanın arka planından seçilir", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    document.body.style.backgroundColor = "";
  });

  it("renk metnini okur", () => {
    expect(parseColor("rgb(33, 33, 33)")).toEqual([33, 33, 33, 1]);
    expect(parseColor("rgba(0, 0, 0, 0)")).toEqual([0, 0, 0, 0]);
    expect(parseColor("transparent")).toBeNull();
    expect(luminance(255, 255, 255)).toBeCloseTo(1, 3);
  });

  it("koyu arka planlı sayfada koyu, açıkta açık tema", () => {
    const wrap = document.createElement("div");
    const composer = document.createElement("div");
    wrap.append(composer);
    document.body.append(wrap);
    wrap.style.backgroundColor = "rgb(33, 33, 33)";
    expect(detectTheme(composer)).toBe("dark");
    wrap.style.backgroundColor = "rgb(255, 255, 255)";
    expect(detectTheme(composer)).toBe("light");
  });

  it("saydam öğeleri atlayıp ilk opak arka plana bakar", () => {
    const outer = document.createElement("div");
    const inner = document.createElement("div");
    outer.append(inner);
    document.body.append(outer);
    outer.style.backgroundColor = "rgb(20, 20, 24)";
    inner.style.backgroundColor = "rgba(255, 255, 255, 0.05)";
    expect(detectTheme(inner)).toBe("dark");
  });

  it("kart Shadow DOM içinde, temayla ve ekrana sığacak genişlikte yerleşir", () => {
    document.body.style.backgroundColor = "rgb(24, 24, 27)";
    const anchor = document.createElement("div");
    document.body.append(anchor);
    const { host, box } = mountCard("strip", anchor);
    expect(host.shadowRoot?.querySelector(".card")).toBe(box);
    expect(box.dataset.theme).toBe("dark");
    expect(parseFloat(box.style.width)).toBeLessThanOrEqual(window.innerWidth - 16);
    host.remove();
  });
});
