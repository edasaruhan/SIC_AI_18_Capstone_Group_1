import { CounterStore, recentTotalsV2, type WeekTotals } from "../core/counters";
import { SettingsStore } from "../core/settings";
import { copyToClipboard } from "../ui/clipboard";

const ROWS: [keyof WeekTotals, string][] = [
  ["stripShown", "Benzer mesaj uyarısı gösterildi"],
  ["stripSendAnyway", "“Yine de gönder” dediğin"],
  ["repairs", "Eksik cümlesi eklediğin"],
  ["cardShown", "Çıkış kartı gösterildi"],
  ["modelCardShown", "Bunlardan modelin önerdiği"],
  ["freshStart", "Taze başlattığın"],
];

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function toggle(label: string, hint: string, checked: boolean, disabled: boolean, onChange: (v: boolean) => void) {
  const row = el("label", "toggle");
  const input = el("input");
  input.type = "checkbox";
  input.checked = checked;
  input.disabled = disabled;
  input.addEventListener("change", () => onChange(input.checked));
  const text = el("span", "toggle-text");
  text.append(el("span", "toggle-label", label), el("span", "toggle-hint", hint));
  row.append(input, text);
  return row;
}

/** Araç çubuğu penceresini kurar. Tüm metinler textContent ile yazılır (HTML eklenmez). */
export function mountPopup(
  root: HTMLElement,
  store: SettingsStore,
  counters: CounterStore,
  now: () => Date = () => new Date(),
  copy: (text: string) => Promise<boolean> = copyToClipboard,
): void {
  let confirming = false;
  let notice = "";

  const render = async () => {
    const [settings, counts] = await Promise.all([store.load(), counters.load()]);
    const totals = recentTotalsV2(counts, now());

    const title = el("h1", undefined, "KafiAI");

    const toggles = el("section");
    toggles.append(
      toggle("Eklenti açık", "Kapalıyken hiçbir şey yapmaz.", settings.enabled, false, async (v) => {
        notice = "";
        await store.update({ enabled: v });
        await render();
      }),
      toggle(
        "Öneriler",
        "Kapalıyken hiçbir şey gösterilmez ve mesajlar bekletilmez; yalnızca günlük sayılar tutulur.",
        settings.suggestionsEnabled,
        !settings.enabled,
        async (v) => {
          notice = "";
          await store.update({ suggestionsEnabled: v });
          await render();
        },
      ),
      toggle("Çıkış kartı", "Uzayan sohbette yeni sohbet önerir.", settings.exitCardEnabled, !settings.enabled || !settings.suggestionsEnabled, async (v) => {
        notice = "";
        await store.update({ exitCardEnabled: v });
        await render();
      }),
    );

    const summary = el("section");
    summary.append(el("h2", undefined, "Son 7 gün"));
    const visible = ROWS.filter(([name]) => totals[name] > 0);
    if (visible.length === 0) {
      summary.append(el("p", "muted", "Henüz kaydedilen bir şey yok."));
    } else {
      const list = el("ul", "counts");
      for (const [name, label] of visible) {
        const item = el("li");
        item.append(el("span", undefined, label), el("strong", undefined, String(totals[name])));
        list.append(item);
      }
      summary.append(list);
    }

    const data = el("section");
    if (confirming) {
      data.append(el("p", undefined, "Ayarların ve sayaçların silinecek. Emin misin?"));
      const actions = el("div", "actions");
      const yes = el("button", "danger", "Evet, sil");
      yes.addEventListener("click", async () => {
        await store.clearAll();
        confirming = false;
        notice = "Silindi. Eklenti varsayılan ayara döndü.";
        await render();
      });
      const no = el("button", undefined, "Vazgeç");
      no.addEventListener("click", async () => {
        confirming = false;
        await render();
      });
      actions.append(yes, no);
      data.append(actions);
    } else {
      const exportButton = el("button", undefined, "Sayaçlarımı kopyala");
      exportButton.addEventListener("click", async () => {
        // Yalnızca günlük sayılar kopyalanır (sürüm numaralı; mesaj metni ya da sohbet bilgisi yok).
        const ok = await copy(await counters.exportJson());
        notice = ok ? "Sayaçlar panoya kopyalandı." : "Kopyalanamadı.";
        await render();
      });
      const del = el("button", undefined, "Tüm verilerimi sil");
      del.addEventListener("click", async () => {
        confirming = true;
        notice = "";
        await render();
      });
      const actions = el("div", "actions");
      actions.append(exportButton, del);
      data.append(actions);
    }
    if (notice) data.append(el("p", "muted", notice));

    const privacy = el(
      "p",
      "privacy",
      "Hiçbir mesaj cihazından çıkmaz ve saklanmaz. Burada yalnızca üç ayar ve günlük sayılar tutulur.",
    );

    root.replaceChildren(title, toggles, summary, data, privacy);
  };

  void render();
}
