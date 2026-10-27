import { CounterStore, recentTotalsV2, type WeekTotals } from "../core/counters";
import { weeklyInsights } from "../core/insights";
import type { ConversationSnapshot } from "../core/messages";
import { SettingsStore } from "../core/settings";
import { taskNorm, type TaskType } from "../core/tasks";
import { copyToClipboard } from "../ui/clipboard";
import { conversationLines, taskDetails, taskLabel, taskSummary, weekHeadline } from "./insight-text";

const ROWS: [keyof WeekTotals, string][] = [
  ["stripShown", "Benzer mesaj uyarısı gösterildi"],
  ["stripSendAnyway", "“Yine de gönder” dediğin"],
  ["repairs", "Eksik cümlesi eklediğin"],
  ["cardShown", "Çıkış kartı gösterildi"],
  ["modelCardShown", "Bunlardan modelin önerdiği"],
  ["freshStart", "Taze başlattığın"],
];

/** Açık sekmedeki sohbetle konuşmak için (testte sahtesi verilir). */
export interface TabBridge {
  /** Sekmedeki sohbetin özeti; desteklenmeyen sekmede null. */
  snapshot(): Promise<ConversationSnapshot | null>;
  /** Sekmede "yeni sohbete geç" kartını açar. */
  openCard(): Promise<boolean>;
}

export const NO_TAB: TabBridge = { snapshot: async () => null, openCard: async () => false };

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

/** Açılır kapanır satır (<details>): klavyeyle ve ekran okuyucuyla kendiliğinden çalışır. */
function disclosure(title: string, meta: string | null, body: HTMLElement[], className = "row"): HTMLDetailsElement {
  const box = el("details", className);
  const summary = el("summary");
  summary.append(el("span", "row-title", title));
  if (meta !== null) summary.append(el("span", "row-meta", meta));
  const inner = el("div", "row-body");
  inner.append(...body);
  box.append(summary, inner);
  return box;
}

/** Araç çubuğu penceresini kurar. Tüm metinler textContent ile yazılır (HTML eklenmez). */
export function mountPopup(
  root: HTMLElement,
  store: SettingsStore,
  counters: CounterStore,
  now: () => Date = () => new Date(),
  copy: (text: string) => Promise<boolean> = copyToClipboard,
  tab: TabBridge = NO_TAB,
): void {
  let confirming = false;
  let notice = "";
  let cardNotice = "";
  let insightSeen = false;
  const openRows = new Set<string>(); // yeniden çizimde açık satırlar açık kalsın

  const render = async () => {
    const [settings, counts, snap] = await Promise.all([store.load(), counters.load(), tab.snapshot().catch(() => null)]);
    const totals = recentTotalsV2(counts, now());
    const suggesting = settings.enabled && settings.suggestionsEnabled;
    const sections: HTMLElement[] = [el("h1", undefined, "KafiAI")];

    // Bu sohbet: yalnızca öneriler açıkken ve desteklenen bir sohbet sekmesindeyken.
    if (suggesting && snap !== null && snap.active) {
      const sec = el("section", "conversation");
      sec.append(el("h2", undefined, "Bu sohbet"));
      for (const line of conversationLines(snap)) sec.append(el("p", undefined, line));
      if (snap.card_available) {
        const go = el("button", "primary", "İstersen yeni sohbete geç");
        go.addEventListener("click", async () => {
          const ok = await tab.openCard();
          if (ok) window.close();
          else {
            cardNotice = "Şu an açılamadı; sohbet sayfasına dönüp tekrar deneyebilirsin.";
            await render();
          }
        });
        sec.append(go);
      }
      if (cardNotice) sec.append(el("p", "muted", cardNotice));
      sections.push(sec);
    }

    // Son 7 gün: içgörü ve görev satırları.
    const week = el("section", "week");
    week.append(el("h2", undefined, "Son 7 gün"));
    if (!suggesting) {
      week.append(
        el(
          "p",
          "muted",
          settings.enabled
            ? "Öneriler kapalıyken yalnızca sayıyorum; içgörüler öneriler açılınca burada görünür."
            : "Eklenti kapalı.",
        ),
      );
    } else {
      const insights = weeklyInsights(counts, now());
      for (const line of weekHeadline(insights)) week.append(el("p", undefined, line));
      if (insights.tasks.length > 0) {
        const list = el("div", "rows");
        for (const t of insights.tasks) {
          const norm = taskNorm(t.task as TaskType);
          const body = taskDetails(t, norm).map((line, i, all) =>
            el("p", i === all.length - 1 && line.startsWith("İstersen") ? "tip" : undefined, line),
          );
          const row = disclosure(taskLabel(t.task), taskSummary(t), body);
          row.open = openRows.has(t.task);
          row.addEventListener("toggle", () => {
            if (row.open && !openRows.has(t.task)) {
              openRows.add(t.task);
              counters.record("insight", { task: t.task }, "ayrinti", "oneri");
              void counters.flush();
            } else if (!row.open) openRows.delete(t.task);
          });
          list.append(row);
        }
        week.append(list);
      }
      if (!insightSeen && insights.conversations > 0) {
        insightSeen = true;
        counters.record("insight", {}, "pencere", "oneri");
        void counters.flush();
      }
    }

    // Eklentinin yaptıkları: ham sayılar, kapalı başlar.
    const visible = ROWS.filter(([name]) => totals[name] > 0);
    const list = el("ul", "counts");
    for (const [name, label] of visible) {
      const item = el("li");
      item.append(el("span", undefined, label), el("strong", undefined, String(totals[name])));
      list.append(item);
    }
    const actionsBody = visible.length === 0 ? [el("p", "muted", "Henüz kaydedilen bir şey yok.")] : [list];
    const actionsRow = disclosure("Eklentinin yaptıkları", null, actionsBody, "row plain");
    actionsRow.open = openRows.has("__actions");
    actionsRow.addEventListener("toggle", () => (actionsRow.open ? openRows.add("__actions") : openRows.delete("__actions")));
    week.append(actionsRow);
    sections.push(week);

    const toggles = el("section");
    toggles.append(
      el("h2", undefined, "Ayarlar"),
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
    sections.push(toggles);

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
    sections.push(data);

    sections.push(
      el("p", "privacy", "Hiçbir mesaj cihazından çıkmaz ve saklanmaz. Burada yalnızca üç ayar ve günlük sayılar tutulur."),
    );
    root.replaceChildren(...sections);
  };

  void render();
}
