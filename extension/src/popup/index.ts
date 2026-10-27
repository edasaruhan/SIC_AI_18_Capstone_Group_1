import { chromeStorage } from "../core/chrome-storage";
import { CounterStore } from "../core/counters";
import { MSG_OPEN_CARD, MSG_THIS_CONVERSATION, SNAPSHOT_KEYS, type ConversationSnapshot } from "../core/messages";
import { SettingsStore } from "../core/settings";
import { mountPopup, type TabBridge } from "./popup";

/** Etkin sekmedeki içerik betiğine sorar. Desteklenmeyen sekmede betik yoktur; cevap null olur. */
async function ask(type: string): Promise<unknown> {
  try {
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (active?.id === undefined) return null;
    return (await chrome.tabs.sendMessage(active.id, { type })) ?? null;
  } catch {
    return null;
  }
}

const tab: TabBridge = {
  snapshot: async () => {
    const r = await ask(MSG_THIS_CONVERSATION);
    if (typeof r !== "object" || r === null) return null;
    // Yalnızca beklenen alanlar alınır.
    return Object.fromEntries(SNAPSHOT_KEYS.map((k) => [k, (r as Record<string, unknown>)[k]])) as unknown as ConversationSnapshot;
  },
  openCard: async () => ((await ask(MSG_OPEN_CARD)) as { ok?: unknown } | null)?.ok === true,
};

const root = document.getElementById("root");
if (root) {
  mountPopup(root, new SettingsStore(chromeStorage), new CounterStore(chromeStorage, { flushDelayMs: 0 }), undefined, undefined, tab);
}
