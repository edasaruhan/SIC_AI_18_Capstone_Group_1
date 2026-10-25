import { build } from "esbuild";
import { describe, expect, it } from "vitest";
import manifest from "../public/manifest.json";

/**
 * Gizlilik sözünün denetimi: derlenmiş eklentide ağ isteği yapabilen hiçbir API geçmez.
 *
 * Manifestteki `connect-src 'none'` yalnızca eklenti sayfalarını (araç çubuğu penceresi) ve
 * arka plan çalışanını kapsar; içerik betiği ChatGPT ya da Gemini sayfasının içinde, o sayfanın
 * kurallarıyla çalışır. Bu yüzden içerik betiği için güvence tarayıcıdan değil, bu testten gelir:
 * build.mjs ile aynı ayarlarla derlenen üç dosyada aşağıdaki adlardan hiçbiri bulunmamalı.
 */
const FORBIDDEN = ["fetch", "XMLHttpRequest", "WebSocket", "sendBeacon", "EventSource", "importScripts"];

const ENTRIES = {
  content: "src/content/index.ts",
  background: "src/background/index.ts",
  popup: "src/popup/index.ts",
};

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

  it("eklenti sayfaları ve arka plan çalışanı için connect-src 'none'", () => {
    expect(manifest.content_security_policy.extension_pages).toContain("connect-src 'none'");
  });

  it("manifest yalnızca depolama ve pano izni istiyor", () => {
    expect([...manifest.permissions].sort()).toEqual(["clipboardWrite", "storage"]);
  });
});
