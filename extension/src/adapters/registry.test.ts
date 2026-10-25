import { describe, expect, it } from "vitest";
import manifest from "../../public/manifest.json";
import schema from "../data/counter-schema.json";
import platforms from "../data/platforms.json";
import { platformFor, PLATFORMS } from "./registry";

const configured = Object.keys(platforms.platforms);
const registryMatches = PLATFORMS.flatMap((p) => p.matches).sort();

describe("platform kaydı", () => {
  it("platforms.json'daki her platformun bir adaptörü var ve kimlikler tutarlı", () => {
    expect(PLATFORMS.map((p) => p.platform).sort()).toEqual([...configured].sort());
    for (const p of PLATFORMS) expect(p.adapter.platform).toBe(p.platform);
  });

  it("platform kimlikleri sayaç şemasındaki listeden", () => {
    for (const p of PLATFORMS) expect(schema.dimensions.platform).toContain(p.platform);
  });

  it("manifestteki içerik betiği adresleri kayıttakiyle birebir aynı", () => {
    const scriptMatches = manifest.content_scripts.flatMap((c) => c.matches).sort();
    expect(scriptMatches).toEqual(registryMatches);
  });

  it("manifestteki site izinleri kayıttakiyle birebir aynı", () => {
    expect([...manifest.host_permissions].sort()).toEqual(registryMatches);
  });

  it("her adres deseni kendi adaptörüne yönlenir", () => {
    for (const p of PLATFORMS) {
      for (const pattern of p.matches) {
        const url = new URL(pattern.replace("*", "c/ornek"));
        expect(platformFor(url)?.platform).toBe(p.platform);
      }
    }
  });

  it("tanınmayan sitede platform yok", () => {
    expect(platformFor(new URL("https://example.com/"))).toBeNull();
    expect(platformFor(new URL("https://www.google.com/search?q=test"))).toBeNull();
  });

  it("yetenek değerleri geçerli", () => {
    for (const p of PLATFORMS) {
      expect(["on", "off"]).toContain(p.capabilities.model);
      expect(["full", "count_only"]).toContain(p.capabilities.interventions);
      expect(typeof p.capabilities.regenerate).toBe("boolean");
      expect(typeof p.capabilities.edit).toBe("boolean");
    }
  });
});
