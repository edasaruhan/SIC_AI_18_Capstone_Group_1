import { afterEach, describe, expect, it, vi } from "vitest";
import fixture from "../../../tests/fixtures/counter_parity.json";
import schema from "../data/counter-schema.json";
import {
  cellKey,
  CounterStore,
  COUNTS_V1_KEY,
  COUNTS_V2_KEY,
  dayOf,
  firstLenBucket,
  isValidCellKey,
  lenBucket,
  loopOutcome,
  migrateV1,
  parseCountsV2,
  recentTotalsV2,
  slotOf,
  validateExport,
  type EventName,
} from "./counters";
import { STORAGE_KEYS, type KeyValueStorage } from "./settings";
import { taskType } from "./tasks";

function memoryStorage(initial: Record<string, unknown> = {}): KeyValueStorage & { data: Record<string, unknown>; writes: number } {
  const data = { ...initial };
  const s = {
    data,
    writes: 0,
    get: async (keys: string[]) => Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, data[k]])),
    set: async (items: Record<string, unknown>) => {
      s.writes++;
      Object.assign(data, items);
    },
    remove: async (keys: string[]) => void keys.forEach((k) => delete data[k]),
  };
  return s;
}

afterEach(() => vi.useRealTimers());

describe("Python ile aynı kurallar (tests/fixtures/counter_parity.json)", () => {
  it("tur kovaları", () => {
    for (const row of fixture.len_buckets) expect(lenBucket(row.turns), String(row.turns)).toBe(row.bucket);
  });
  it("ilk mesaj uzunluğu kovaları, kod noktası olarak", () => {
    for (const row of fixture.first_len_buckets) expect(firstLenBucket("a".repeat(row.chars))).toBe(row.bucket);
    expect(firstLenBucket(fixture.first_len_unicode.text)).toBe(fixture.first_len_unicode.bucket);
  });
  it("saat dilimleri", () => {
    for (const row of fixture.slots) expect(slotOf(new Date(2026, 9, 24, row.hour))).toBe(row.slot);
  });
  it("sohbet sonucu", () => {
    for (const row of fixture.loop_outcomes) expect(loopOutcome(row.messages), row.messages.join(" | ")).toBe(row.outcome);
  });
  it("dışa aktarım doğrulaması", () => {
    expect(validateExport(fixture.valid_export)).toEqual([]);
    for (const bad of fixture.invalid_exports) expect(validateExport(bad).length, JSON.stringify(bad)).toBeGreaterThan(0);
  });
});

describe("hücre anahtarı", () => {
  it("boyutları şemadaki sırayla yazar, bilinmeyeni 'na' yapar", () => {
    expect(cellKey("send", { platform: "chatgpt", slot: "18-24", task: "kod", len: "4-6" }, "benzer")).toBe(
      "send|chatgpt|18-24|kod|4-6|benzer",
    );
    expect(cellKey("send", { platform: "chatgpt", task: "bir mesaj metni" }, "kisa")).toBe("send|chatgpt|na|na|na|kisa");
  });
  it("şemada olmayan ayrıntıyı kabul etmez", () => {
    expect(cellKey("strip", {}, "merhaba")).toBeNull();
    expect(cellKey("yok" as EventName, {}, "-")).toBeNull();
  });
  it("bozuk depo verisinden yalnızca geçerli hücreler kalır", () => {
    const parsed = parseCountsV2({
      v: 2,
      days: {
        "2026-10-24": { phase: "oneri", c: { "strip|chatgpt|kod|gosterildi": 2, "strip|chatgpt|kod|metin": 1, "send|x": 3 } },
        "dün": { phase: "oneri", c: { "strip|chatgpt|kod|gosterildi": 1 } },
        "2026-10-23": { phase: "baska", c: { "strip|na|na|gosterildi": -1 } },
      },
    });
    expect(parsed).toEqual({ v: 2, days: { "2026-10-24": { phase: "oneri", c: { "strip|chatgpt|kod|gosterildi": 2 } } } });
  });
});

describe("sürüm 1'den göç", () => {
  const v1 = {
    "2026-10-20": {
      stripShown: 2,
      stripRepair: 1,
      exitCardShown: 3,
      modelCardShown: 1,
      freshStart: 1,
      checkedSendsOn: 10,
      similarSendsOn: 2,
    },
    "2026-10-21": { checkedSendsOff: 5, similarSendsOff: 1, stripWouldShow: 1, exitCardWouldShow: 2 },
    "bozuk": { stripShown: 9 },
  };

  it("sayıları karşılıklarına taşır, fazı çıkarır", () => {
    const out = migrateV1(v1);
    expect(out.days["2026-10-20"]).toEqual({
      phase: "oneri",
      c: {
        "strip|na|na|gosterildi": 2,
        "card_action|na|taze_baslat": 1,
        "repair_button|na|na|na": 1,
        "card|na|na|na|gosterildi_model": 1,
        "card|na|na|na|gosterildi_norm": 2,
        "send|na|na|na|na|benzer": 2,
        "send|na|na|na|na|farkli": 8,
      },
    });
    expect(out.days["2026-10-21"]?.phase).toBe("sayim");
    expect(out.days["bozuk"]).toBeUndefined();
    expect(validateExport({ schema: "kafiai.counts", version: 2, days: out.days })).toEqual([]);
  });

  it("depoda v1 varsa ilk okumada bir kez göç eder ve v1'i siler", async () => {
    const storage = memoryStorage({ [COUNTS_V1_KEY]: v1 });
    const store = new CounterStore(storage, { flushDelayMs: 0 });
    const first = await store.load();
    expect(Object.keys(first.days)).toEqual(["2026-10-20", "2026-10-21"]);
    expect(storage.data[COUNTS_V1_KEY]).toBeUndefined();
    expect(storage.data[COUNTS_V2_KEY]).toEqual(first);
    expect(await store.load()).toEqual(first);
  });
});

describe("CounterStore", () => {
  it("kayıtları biriktirip gecikmeli ve tek yazmada işler", async () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    const now = new Date(2026, 9, 24, 20);
    const store = new CounterStore(storage, { flushDelayMs: 2000, now: () => now });
    for (let i = 0; i < 5; i++) store.record("send", { platform: "gemini", slot: slotOf(now), task: "kod", len: "1-3" }, "farkli", "oneri");
    store.record("strip", { platform: "gemini", task: "kod" }, "tetiklendi", "oneri");
    expect(storage.writes).toBe(0);
    await vi.advanceTimersByTimeAsync(2000);
    expect(storage.writes).toBe(1);
    const counts = await store.load();
    expect(counts.days["2026-10-24"]).toEqual({
      phase: "oneri",
      c: { "send|gemini|18-24|kod|1-3|farkli": 5, "strip|gemini|kod|tetiklendi": 1 },
    });
  });

  it("aynı gün iki farklı fazda kayıt olursa faz 'karisik' olur", async () => {
    const storage = memoryStorage();
    const store = new CounterStore(storage, { flushDelayMs: 0, now: () => new Date(2026, 9, 24, 9) });
    store.record("send", {}, "kisa", "sayim");
    await store.flush();
    store.record("send", {}, "kisa", "oneri");
    await store.flush();
    expect((await store.load()).days["2026-10-24"]?.phase).toBe("karisik");
  });

  it("saklama süresinden eski günleri siler", async () => {
    const storage = memoryStorage({
      [COUNTS_V2_KEY]: { v: 2, days: { "2026-01-01": { phase: "oneri", c: { "send|na|na|na|na|kisa": 4 } } } },
    });
    const store = new CounterStore(storage, { flushDelayMs: 0, now: () => new Date(2026, 9, 24) });
    store.record("send", {}, "kisa", "oneri");
    await store.flush();
    expect(Object.keys((await store.load()).days)).toEqual(["2026-10-24"]);
  });

  it("depolama hata verirse sessizce geçer", async () => {
    const broken: KeyValueStorage = {
      get: async () => {
        throw new Error("depo yok");
      },
      set: async () => {},
      remove: async () => {},
    };
    const store = new CounterStore(broken, { flushDelayMs: 0 });
    store.record("send", {}, "kisa", "oneri");
    await expect(store.flush()).resolves.toBeUndefined();
  });

  it("90 günlük yoğun kullanımda depolanan veri 1,5 MB'ın altında kalır", async () => {
    const storage = memoryStorage();
    let day = new Date(2026, 6, 1, 0);
    const store = new CounterStore(storage, { flushDelayMs: 0, now: () => day });
    const pick = <T>(arr: readonly T[], i: number) => arr[i % arr.length] as T;
    const dims = schema.dimensions;
    for (let d = 0; d < 90; d++) {
      day = new Date(2026, 6, 1 + d, 12);
      // Günde 300 olay: her boyutun farklı değerleri, en kötüye yakın dağılım.
      for (let i = 0; i < 300; i++) {
        const event = pick(Object.keys(schema.events), i * 7 + d) as EventName;
        const spec = schema.events[event];
        store.record(
          event,
          { platform: pick(dims.platform, i), slot: pick(dims.slot, i * 3), task: pick(dims.task, i * 5), len: pick(dims.len, i * 11), first_len: pick(dims.first_len, i) },
          pick(spec.details, i * 13),
          i % 2 ? "oneri" : "sayim",
        );
      }
      await store.flush();
    }
    const size = new TextEncoder().encode(JSON.stringify(storage.data)).length;
    expect(Object.keys((await store.load()).days).length).toBeGreaterThanOrEqual(89);
    expect(size).toBeLessThan(1.5 * 1024 * 1024);
  });

  it("dışa aktarım sürüm numaralı ve şemaya uygun", async () => {
    const store = new CounterStore(memoryStorage(), { flushDelayMs: 0, now: () => new Date(2026, 9, 24) });
    store.record("conversation", { platform: "chatgpt", task: "kod", len: "4-6", first_len: "uzun" }, "dongu", "oneri");
    const exported = JSON.parse(await store.exportJson());
    expect(exported).toEqual({
      schema: "kafiai.counts",
      version: 2,
      exported: "2026-10-24",
      days: { "2026-10-24": { phase: "oneri", c: { "conversation|chatgpt|kod|4-6|uzun|dongu": 1 } } },
    });
    expect(validateExport(exported)).toEqual([]);
  });
});

describe("gizlilik: depoda mesajdan hiçbir parça yok", () => {
  /** Rastgele, sözlükte olmayan kelimelerden mesajlar: depoda biri görünürse sızıntıdır. */
  function randomMessage(rng: () => number): string {
    const letters = "abcçdefgğhıijklmnoöprsştuüvyz";
    const words = Array.from({ length: 3 + Math.floor(rng() * 8) }, () =>
      Array.from({ length: 6 + Math.floor(rng() * 6) }, () => letters[Math.floor(rng() * letters.length)]).join(""),
    );
    return words.join(" ");
  }

  it("kullanım benzetiminden sonra depo yalnızca izinli anahtarlar ve şema sözcükleri içerir", async () => {
    let seed = 42;
    const rng = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const storage = memoryStorage();
    const now = new Date(2026, 9, 24, 23);
    const store = new CounterStore(storage, { flushDelayMs: 0, now: () => now });
    const messages: string[] = [];
    const urls = ["https://chatgpt.com/c/68f8a1b2-1234", "https://gemini.google.com/app/9f8e7d6c"];
    for (let conv = 0; conv < 20; conv++) {
      const texts: string[] = [];
      for (let turn = 1; turn <= 1 + Math.floor(rng() * 12); turn++) {
        const text = randomMessage(rng);
        texts.push(text);
        messages.push(text);
        const dims = { platform: conv % 2 ? "chatgpt" : "gemini", slot: slotOf(now), task: taskType(texts[0] ?? ""), len: lenBucket(turn) };
        store.record("send", dims, rng() < 0.3 ? "benzer" : "farkli", "oneri");
        if (rng() < 0.2) store.record("strip", dims, "tetiklendi", "oneri");
      }
      store.record(
        "conversation",
        { platform: "chatgpt", task: taskType(texts[0] ?? ""), len: lenBucket(texts.length), first_len: firstLenBucket(texts[0] ?? "") },
        loopOutcome(texts),
        "oneri",
      );
    }
    await store.flush();

    expect(Object.keys(storage.data).every((k) => STORAGE_KEYS.includes(k))).toBe(true);
    const dump = JSON.stringify(storage.data);
    for (const m of messages) for (const w of m.split(" ")) expect(dump.includes(w), w).toBe(false);
    for (const u of urls) expect(dump).not.toContain(u.split("/").pop()!);
    expect(dump).not.toMatch(/https?:|\/c\/|\/app\//);
    const counts = await store.load();
    for (const rec of Object.values(counts.days)) for (const key of Object.keys(rec.c)) expect(isValidCellKey(key)).toBe(true);
  });
});

describe("pencere özeti", () => {
  it("son 7 günün gösterilen kart, şerit ve taze başlat toplamları", () => {
    const now = new Date(2026, 9, 24);
    const old = new Date(2026, 9, 10);
    const totals = recentTotalsV2(
      {
        v: 2,
        days: {
          [dayOf(now)]: {
            phase: "oneri",
            c: {
              "strip|chatgpt|kod|gosterildi": 2,
              "strip|chatgpt|kod|tetiklendi": 5,
              "card|chatgpt|kod|4-6|gosterildi_model": 1,
              "card|chatgpt|kod|4-6|gosterildi_norm": 2,
              "repair_button|chatgpt|kod|info": 1,
              "card_action|chatgpt|taze_baslat": 1,
            },
          },
          [dayOf(old)]: { phase: "oneri", c: { "strip|chatgpt|kod|gosterildi": 9 } },
        },
      },
      now,
    );
    expect(totals).toEqual({ stripShown: 2, stripSendAnyway: 0, repairs: 1, cardShown: 3, modelCardShown: 1, freshStart: 1 });
  });
});
