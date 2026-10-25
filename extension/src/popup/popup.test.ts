// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { CounterStore, dayOf, validateExport, type Dims, type EventName } from "../core/counters";
import { SettingsStore, type KeyValueStorage } from "../core/settings";
import { mountPopup } from "./popup";

function memoryStorage(): KeyValueStorage & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = {};
  return {
    data,
    get: async (keys) => Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, data[k]])),
    set: async (items) => void Object.assign(data, items),
    remove: async (keys) => void keys.forEach((k) => delete data[k]),
  };
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const NOW = new Date(2026, 9, 21, 12);

let root: HTMLElement;
let storage: ReturnType<typeof memoryStorage>;
let store: SettingsStore;
let counters: CounterStore;

/** Belirli bir günde bir olay say ve hemen depoya yaz. */
async function record(event: EventName, detail: string, when: Date = NOW, dims: Dims = { platform: "chatgpt" }) {
  const c = new CounterStore(storage, { flushDelayMs: 0, now: () => when });
  c.record(event, dims, detail, "oneri");
  await c.flush();
}

function checkbox(label: string): HTMLInputElement {
  const row = Array.from(root.querySelectorAll("label")).find((l) => l.textContent?.includes(label))!;
  return row.querySelector("input")!;
}
function button(text: string): HTMLButtonElement {
  return Array.from(root.querySelectorAll("button")).find((b) => b.textContent === text)!;
}
async function open() {
  mountPopup(root, store, counters, () => NOW);
  await flush();
}

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  root = document.getElementById("root")!;
  storage = memoryStorage();
  store = new SettingsStore(storage);
  counters = new CounterStore(storage, { flushDelayMs: 0, now: () => NOW });
});

describe("popup", () => {
  it("varsayılanda iki anahtar da açık gelir", async () => {
    await open();
    expect(checkbox("Eklenti açık").checked).toBe(true);
    expect(checkbox("Çıkış kartı").checked).toBe(true);
  });

  it("eklentiyi kapatınca kaydeder ve çıkış kartı anahtarını devre dışı bırakır", async () => {
    await open();
    checkbox("Eklenti açık").click();
    await flush();
    expect(await store.load()).toEqual({ enabled: false, exitCardEnabled: true, suggestionsEnabled: true });
    expect(checkbox("Eklenti açık").checked).toBe(false);
    expect(checkbox("Çıkış kartı").disabled).toBe(true);
  });

  it("çıkış kartını tek başına kapatabilir", async () => {
    await open();
    checkbox("Çıkış kartı").click();
    await flush();
    expect(await store.load()).toEqual({ enabled: true, exitCardEnabled: false, suggestionsEnabled: true });
  });

  it("öneriler kapatılınca yalnızca say moduna geçer ve çıkış kartı anahtarı devre dışı kalır", async () => {
    await open();
    expect(checkbox("Öneriler").checked).toBe(true);
    checkbox("Öneriler").click();
    await flush();
    expect(await store.load()).toEqual({ enabled: true, exitCardEnabled: true, suggestionsEnabled: false });
    expect(checkbox("Öneriler").checked).toBe(false);
    expect(checkbox("Çıkış kartı").disabled).toBe(true);
    expect(checkbox("Eklenti açık").disabled).toBe(false);
  });

  it("eklenti kapalıyken öneriler anahtarı da devre dışıdır", async () => {
    await store.update({ enabled: false });
    await open();
    expect(checkbox("Öneriler").disabled).toBe(true);
  });

  it("sayaçları sürüm numaralı v2 biçiminde, yalnızca sayı olarak panoya kopyalar", async () => {
    await record("strip", "gosterildi");
    await record("send", "farkli");
    await store.update({ enabled: true });
    let copied = "";
    mountPopup(root, store, counters, () => NOW, async (t) => ((copied = t), true));
    await flush();
    button("Sayaçlarımı kopyala").click();
    await flush();
    const exported = JSON.parse(copied);
    expect(exported.schema).toBe("kafiai.counts");
    expect(exported.version).toBe(2);
    expect(validateExport(exported)).toEqual([]);
    expect(exported.days[dayOf(NOW)].c).toEqual({ "strip|chatgpt|na|gosterildi": 1, "send|chatgpt|na|na|na|farkli": 1 });
    expect(root.textContent).toContain("Sayaçlar panoya kopyalandı.");
  });

  it("kopyalama başarısız olursa bunu söyler", async () => {
    mountPopup(root, store, counters, () => NOW, async () => false);
    await flush();
    button("Sayaçlarımı kopyala").click();
    await flush();
    expect(root.textContent).toContain("Kopyalanamadı.");
  });

  it("kayıt yoksa bunu söyler", async () => {
    await open();
    expect(root.textContent).toContain("Henüz kaydedilen bir şey yok.");
  });

  it("son 7 günün sayılarını gösterir, sıfır olanları ve eski günleri göstermez", async () => {
    await record("strip", "gosterildi");
    await record("strip", "gosterildi");
    await record("card_action", "taze_baslat");
    const old = new Date(NOW);
    old.setDate(old.getDate() - 10);
    await record("strip_action", "yine_de_gonder", old);
    await open();
    const items = Array.from(root.querySelectorAll("li")).map((li) => li.textContent);
    expect(items).toEqual(["Benzer mesaj uyarısı gösterildi2", "Taze başlattığın1"]);
    expect(dayOf(old)).not.toBe(dayOf(NOW));
  });

  it("silme önce onay ister; Vazgeç hiçbir şeyi silmez", async () => {
    await store.update({ enabled: false });
    await open();
    button("Tüm verilerimi sil").click();
    await flush();
    expect(root.textContent).toContain("Emin misin?");
    expect(Object.keys(storage.data).length).toBeGreaterThan(0);
    button("Vazgeç").click();
    await flush();
    expect((await store.load()).enabled).toBe(false);
    expect(button("Tüm verilerimi sil")).toBeTruthy();
  });

  it("onaylanınca her şey silinir ve varsayılana döner", async () => {
    await store.update({ enabled: false });
    await record("strip", "gosterildi");
    await open();
    button("Tüm verilerimi sil").click();
    await flush();
    button("Evet, sil").click();
    await flush();
    expect(storage.data).toEqual({});
    expect(root.textContent).toContain("Silindi.");
    expect(checkbox("Eklenti açık").checked).toBe(true);
  });

  it("yargılayıcı ya da doğrulanmamış söz içermez", async () => {
    await record("strip", "gosterildi");
    await open();
    const text = (root.textContent ?? "").toLowerCase();
    for (const bad of ["bağımlı", "risk", "tehlike", "seri", "rozet", "%"]) expect(text).not.toContain(bad);
  });
});
