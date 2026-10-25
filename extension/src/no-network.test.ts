import { build } from "esbuild";
import { describe, expect, it } from "vitest";
import buildEntries from "../build-entries.json";
import platforms from "./data/platforms.json";
import manifest from "../public/manifest.json";

/**
 * Gizlilik sözünün denetimi: derlenmiş eklentide ağ isteği yapabilen hiçbir API geçmez.
 *
 * Manifestteki `connect-src 'none'` yalnızca eklenti sayfalarını (araç çubuğu penceresi) ve
 * arka plan çalışanını kapsar; içerik betiği ChatGPT ya da Gemini sayfasının içinde, o sayfanın
 * kurallarıyla çalışır. Bu yüzden içerik betiği için güvence tarayıcıdan değil, bu testten gelir:
 * build.mjs ile aynı ayarlarla derlenen dosyalarda (giriş listesi build-entries.json) aşağıdaki
 * adlardan hiçbiri bulunmamalı. Ayrıca derlenmiş kodda platform kaydındaki adresler dışında
 * hiçbir web adresi geçmemeli (uzaktan kod ya da veri yüklenmesine karşı).
 */
const FORBIDDEN = ["fetch", "XMLHttpRequest", "WebSocket", "sendBeacon", "EventSource", "importScripts"];

const ENTRIES = buildEntries.entries as Record<string, string>;
const ALLOWED_URLS = new Set(Object.values(platforms.platforms).flatMap((p) => p.matches));

async function bundle(entry: string): Promise<string> {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    format: "iife",
    target: "chrome120",
    write: false,
    minify: false,
    logLevel: "silent",
  });
  return result.outputFiles.map((f) => f.text).join("\n");
}

describe("ağ isteği yok", () => {
  it.each(Object.entries(ENTRIES))("%s derlemesinde ağ API'si geçmiyor", async (_name, entry) => {
    const code = await bundle(entry);
    for (const word of FORBIDDEN) {
      expect(new RegExp(`\\b${word}\\b`).test(code), `${entry}: ${word}`).toBe(false);
    }
  });

  it.each(Object.entries(ENTRIES))("%s derlemesinde izinli platform adresleri dışında web adresi yok", async (_name, entry) => {
    const code = await bundle(entry);
    const urls = code.match(/https?:\/\/[^\s"'`)]+/g) ?? [];
    for (const u of urls) expect(ALLOWED_URLS.has(u), `${entry}: ${u}`).toBe(true);
    expect(/\beval\s*\(|new Function\s*\(/.test(code), `${entry}: eval`).toBe(false);
  });

  it("giriş listesi boş değil ve üç temel giriş yerinde", () => {
    expect(Object.keys(ENTRIES)).toEqual(expect.arrayContaining(["content", "background", "popup"]));
  });

  it("eklenti sayfaları ve arka plan çalışanı için connect-src 'none'", () => {
    expect(manifest.content_security_policy.extension_pages).toContain("connect-src 'none'");
  });

  it("manifest yalnızca depolama ve pano izni istiyor", () => {
    expect([...manifest.permissions].sort()).toEqual(["clipboardWrite", "storage"]);
  });
});
