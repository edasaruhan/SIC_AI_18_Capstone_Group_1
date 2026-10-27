// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { CounterStore, dayOf, validateExport, type Dims, type EventName } from "../core/counters";
import { SettingsStore, type KeyValueStorage } from "../core/settings";
import type { ConversationSnapshot } from "../core/messages";
import { mountPopup, type TabBridge } from "./popup";

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
async function open(tab?: TabBridge) {
  mountPopup(root, store, counters, () => NOW, undefined, tab);
  await flush();
  await flush();
}
const snap = (over: Partial<ConversationSnapshot> = {}): ConversationSnapshot => ({
  platform: "chatgpt", active: true, suggesting: true, intervening: true, personal: false, turns: 7, task: "kod",
  similar: 2, norm: { median: 3, p75: 5 }, card_available: true, ...over,
});
function fakeTab(s: ConversationSnapshot | null, openOk = true) {
  const calls = { open: 0 };
  const tab: TabBridge = { snapshot: async () => s, openCard: async () => (calls.open++, openOk) };
  return { tab, calls };
}
async function conversations(task: string, n: number, outcome = "normal", len = "4-6") {
  for (let i = 0; i < n; i++) await record("conversation", outcome, NOW, { platform: "chatgpt", task, len, first_len: "orta" });
}
const rowTitles = () => Array.from(root.querySelectorAll("details.row:not(.plain) .row-title")).map((e) => e.textContent);

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
    for (const bad of ["bağımlı", "risk", "tehlike", "seri", "rozet", "puan", "ödül", "%"]) expect(text).not.toContain(bad);
  });

  it("haftalık içgörüde görevler açılır kapanır satırlar olarak sıralanır", async () => {
    await conversations("kod", 4, "dongu", "11+");
    await conversations("kod", 2);
    await conversations("ceviri", 3);
    await open();
    expect(root.textContent).toContain("Son 7 günde 9 sohbet.");
    expect(root.textContent).toContain("Bunların 4'ünde cevap ilk seferde oturmadı");
    expect(rowTitles()).toEqual(["Kod yazma ve hata ayıklama", "Çeviri"]);
    const kod = root.querySelector("details.row") as HTMLDetailsElement;
    expect(kod.open).toBe(false);
    expect(kod.querySelector(".row-meta")?.textContent).toBe("6 sohbet · 4 tekrar");
    expect(kod.querySelector(".tip")?.textContent).toMatch(/^İstersen/);
  });

  it("satır açılınca bir kez sayılır; içgörü penceresi de bir kez sayılır", async () => {
    await conversations("kod", 5);
    await open();
    const kod = root.querySelector("details.row") as HTMLDetailsElement;
    kod.open = true;
    kod.dispatchEvent(new Event("toggle"));
    kod.dispatchEvent(new Event("toggle"));
    await flush();
    const json = JSON.parse(await counters.exportJson());
    const c = json.days[dayOf(NOW)].c;
    expect(c["insight|kod|ayrinti"]).toBe(1);
    expect(c["insight|na|pencere"]).toBe(1);
    expect(validateExport(json)).toEqual([]);
  });

  it("öneriler kapalıyken (yalnızca say) içgörü ve 'Bu sohbet' gösterilmez", async () => {
    await store.update({ suggestionsEnabled: false });
    await conversations("kod", 6, "dongu");
    const { tab } = fakeTab(snap());
    await open(tab);
    expect(root.textContent).toContain("Öneriler kapalıyken yalnızca sayıyorum");
    expect(rowTitles()).toEqual([]);
    expect(root.textContent).not.toContain("Bu sohbet");
  });

  it("'Bu sohbet' bölümü sayıları gösterir ve kartı sekmede açar", async () => {
    const { tab, calls } = fakeTab(snap());
    const close = window.close;
    let closed = false;
    window.close = () => void (closed = true);
    await open(tab);
    expect(root.textContent).toContain("Kod yazma ve hata ayıklama · 7 mesaj");
    button("İstersen yeni sohbete geç").click();
    await flush();
    expect(calls.open).toBe(1);
    expect(closed).toBe(true);
    window.close = close;
  });

  it("kişisel sohbette öneri ve düğme yok", async () => {
    const { tab } = fakeTab(snap({ personal: true, card_available: false }));
    await open(tab);
    expect(root.textContent).toContain("Bu sohbette öneri göstermiyorum.");
    expect(button("İstersen yeni sohbete geç")).toBeUndefined();
    expect(root.textContent).not.toContain("Kod yazma");
  });

  it("desteklenmeyen sekmede 'Bu sohbet' bölümü çıkmaz", async () => {
    await open(fakeTab(null).tab);
    expect(root.textContent).not.toContain("Bu sohbet");
  });

  it("kart açılamazsa bunu söyler", async () => {
    await open(fakeTab(snap(), false).tab);
    button("İstersen yeni sohbete geç").click();
    await flush();
    await flush();
    expect(root.textContent).toContain("Şu an açılamadı");
  });
});
