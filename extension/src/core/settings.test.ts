import { describe, expect, it } from "vitest";
import { CounterStore, COUNTS_V1_KEY, COUNTS_V2_KEY } from "./counters";
import { DEFAULT_SETTINGS, parseSettings, PENDING_FRESH_KEY, SettingsStore, type KeyValueStorage } from "./settings";

function memoryStorage(initial: Record<string, unknown> = {}): KeyValueStorage & { data: Record<string, unknown> } {
  const data = { ...initial };
  return {
    data,
    get: async (keys) => Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, data[k]])),
    set: async (items) => void Object.assign(data, items),
    remove: async (keys) => void keys.forEach((k) => delete data[k]),
  };
}

describe("parseSettings", () => {
  it("boş ya da bozuk veride varsayılanı verir", () => {
    expect(parseSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("abc")).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings({ enabled: "evet" })).toEqual(DEFAULT_SETTINGS);
  });
  it("öneriler ayarı yoksa ya da bozuksa açık sayılır; kapalı değeri korunur", () => {
    expect(parseSettings({ enabled: true }).suggestionsEnabled).toBe(true);
    expect(parseSettings({ suggestionsEnabled: "hayır" }).suggestionsEnabled).toBe(true);
    expect(parseSettings({ suggestionsEnabled: false }).suggestionsEnabled).toBe(false);
  });
  it("bilinmeyen alanları atar", () => {
    expect(parseSettings({ enabled: false, mesaj: "gizli" })).toEqual({ enabled: false, exitCardEnabled: true, suggestionsEnabled: true });
  });
});

describe("SettingsStore", () => {
  it("boş depoda varsayılan ayarı verir", async () => {
    expect(await new SettingsStore(memoryStorage()).load()).toEqual(DEFAULT_SETTINGS);
  });

  it("update yalnızca verilen alanı değiştirir ve kalıcı yazar", async () => {
    const storage = memoryStorage();
    const store = new SettingsStore(storage);
    await store.update({ exitCardEnabled: false });
    expect(await new SettingsStore(storage).load()).toEqual({ enabled: true, exitCardEnabled: false, suggestionsEnabled: true });
    await store.update({ enabled: false });
    expect(await store.load()).toEqual({ enabled: false, exitCardEnabled: false, suggestionsEnabled: true });
  });

  it("clearAll ayarları, sayaçları (v1 ve v2) ve taze başlat işaretini siler", async () => {
    const storage = memoryStorage({ [COUNTS_V1_KEY]: { "2026-10-21": { stripShown: 1 } }, [PENDING_FRESH_KEY]: { platform: "chatgpt", until: 1 } });
    const store = new SettingsStore(storage);
    await store.update({ enabled: false });
    const counters = new CounterStore(storage, { flushDelayMs: 0 });
    counters.record("strip", { platform: "chatgpt" }, "gosterildi", "oneri");
    await counters.flush();
    expect(Object.keys(storage.data)).toContain(COUNTS_V2_KEY);
    await store.clearAll();
    expect(storage.data).toEqual({});
    expect(await store.load()).toEqual(DEFAULT_SETTINGS);
  });
});
