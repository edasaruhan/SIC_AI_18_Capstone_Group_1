import { POLL_MS } from "../config";
import { ResponseWatcher } from "../core/response-watcher";
import { appendInline } from "./insert";
import { reportedUserTurns } from "./virtual-list";
import type { Adapter, AdapterHandlers } from "./types";
import { lastOf, responseText } from "./response-text";

/** Bekletilen gönderim (varsa) ve "bir sonraki girişimi engelleme" bayrağı. */
let heldComposer: HTMLElement | null = null;
let bypassNext = false;

/**
 * Claude sayfa yapısı (Kasım 2026'da canlı sayfadan alınan görüntülerle ölçüldü,
 * test-snapshots/claude):
 *  - Mesaj kutusu: fieldset[data-perf-region="composer"] içinde
 *    div[data-testid="chat-input"][contenteditable="true"][role="textbox"]. Sayfada başka
 *    düzenlenebilir alan yok; mesaj düzenlenirken açılan kutu ayrı bir <textarea>
 *    (data-testid="message-edit-box" içinde), mesaj kutusu sayılmaz.
 *  - Gönder düğmesi: data-testid="chat-input-send"; kutu boşken disabled.
 *  - Cevap üretilirken: gönder yerine data-testid="chat-input-stop" düğmesi gelir ve
 *    cevabın data-is-streaming değeri "true" olur.
 *  - Eski mesajlar: data-testid="user-message" içindeki paragraflar. Ekran okuyucuya özel
 *    "You said: ..." başlığı bu öğenin dışında; okunmaz.
 *  - Sanal liste: sayfa yalnızca ekrandaki mesajları çizer. Uzun bir sohbette 18 mesajdan
 *    4'ü sayfadaydı; gerisinin yerinde boş bir ara öğe vardı. Toplam sayı her mesajın
 *    role="article" öğesindeki aria-setsize değerinden okunur.
 *
 * Düğmeler etiketle değil data-testid ile bulunur; arayüz dili değişse de aynı kalır.
 */

const COMPOSER_SELECTOR = '[data-testid="chat-input"][contenteditable="true"]';
const COMPOSER_REGION = 'fieldset[data-perf-region="composer"], fieldset';
const SEND_SELECTOR = '[data-testid="chat-input-send"]';
const STOP_SELECTOR = '[data-testid="chat-input-stop"]';
const STREAMING_SELECTOR = '[data-is-streaming="true"]';
const USER_MESSAGE_SELECTOR = '[data-testid="user-message"]';

const HOSTS = new Set(["claude.ai"]);

const CONVERSATION_PATH = /^\/chat\/([A-Za-z0-9-]{8,})(?:[/?#]|$)/;

/** Sohbet kimliğini adresten çıkarır. Yeni sohbet ("/new") ve proje sayfaları: null. */
export function chatKeyFromPath(pathname: string): string | null {
  return CONVERSATION_PATH.exec(pathname)?.[1] ?? null;
}

export function findComposer(root: ParentNode = document): HTMLElement | null {
  return root.querySelector<HTMLElement>(COMPOSER_SELECTOR);
}

export function composerContaining(node: EventTarget | null): HTMLElement | null {
  if (!(node instanceof Element)) return null;
  return node.closest<HTMLElement>(COMPOSER_SELECTOR);
}

export function readComposerText(box: HTMLElement): string {
  return (box.innerText || box.textContent || "").trim();
}

/** Yapay zeka şu an cevap üretiyor mu? */
export function isGenerating(root: ParentNode = document): boolean {
  return root.querySelector(STOP_SELECTOR) !== null || root.querySelector(STREAMING_SELECTOR) !== null;
}

export function findSendButton(root: ParentNode = document): HTMLButtonElement | null {
  return root.querySelector<HTMLButtonElement>(SEND_SELECTOR);
}

/** Kullanıcı mesajının metni: paragraflar satır satır; yoksa öğenin tüm metni. */
function messageText(el: HTMLElement): string {
  const lines = Array.from(el.querySelectorAll<HTMLElement>("p, li, pre"))
    .filter((node) => {
      const outer = node.parentElement?.closest("p, li, pre");
      return !outer || !el.contains(outer); // iç içe bloklar iki kez okunmasın
    })
    .map((node) => (node.innerText || node.textContent || "").trim())
    .filter((text) => text.length > 0);
  if (lines.length > 0) return lines.join("\n");
  return (el.innerText || el.textContent || "").trim();
}

/** Sayfada çizili olan kullanıcı mesajları (eskiden yeniye). Sanal listede eksik olabilir. */
export function readUserMessages(root: ParentNode = document): string[] {
  return Array.from(root.querySelectorAll<HTMLElement>(USER_MESSAGE_SELECTOR))
    .map(messageText)
    .filter((text) => text.length > 0);
}

export { reportedUserTurns };

/** Arayüzün yerleşeceği öğe: mesaj kutusunun çerçevesi; yoksa kutunun kendisi. */
function anchorOf(box: HTMLElement): Element {
  return box.closest(COMPOSER_REGION) ?? box;
}

export const claudeAdapter: Adapter = {
  name: "claude",
  platform: "claude",

  matches(url) {
    return HOSTS.has(url.hostname);
  },

  conversationKey(url) {
    return chatKeyFromPath(url.pathname);
  },

  submitHeld() {
    const composer = heldComposer;
    heldComposer = null;
    if (!composer || !composer.isConnected) return false;
    const button = findSendButton();
    if (!button || button.disabled) return false;
    bypassNext = true;
    try {
      button.click(); // kendi tıklama dinleyicimiz bir kereliğine izin verir
    } finally {
      bypassNext = false;
    }
    return true;
  },

  newChatUrl() {
    return `${location.origin}/new`;
  },

  lastResponse() {
    return responseText(lastOf('[data-testid="assistant-message"]'), "[data-find-omitted]");
  },

  readHistory() {
    return readUserMessages();
  },

  historyTotal() {
    return reportedUserTurns();
  },

  composer() {
    const box = findComposer();
    return box ? { anchor: anchorOf(box), empty: readComposerText(box) === "" } : null;
  },

  focusComposer() {
    findComposer()?.focus();
  },

  insertText(text) {
    const composer = heldComposer ?? findComposer();
    heldComposer = null;
    if (!composer) return false;
    // Claude da ProseMirror kullanıyor; yeni paragraf komutu mesajı gönderebilir, aynı satıra eklenir.
    return appendInline(composer, text);
  },

  start(handlers: AdapterHandlers) {
    const watcher = new ResponseWatcher(() => isGenerating(document), {
      onComplete: () => handlers.onResponseComplete(),
      onNoSignal: () => handlers.onNoSignal(),
    });

    let timer: number | undefined;
    const startPolling = () => {
      if (timer !== undefined) return;
      timer = window.setInterval(() => {
        watcher.tick(Date.now());
        if (!watcher.active && timer !== undefined) {
          window.clearInterval(timer);
          timer = undefined;
        }
      }, POLL_MS);
    };

    /** true: gönderim bekletildi (olay durduruldu). */
    const intercept = (event: Event, composer: HTMLElement, text: string): boolean => {
      if (bypassNext) {
        bypassNext = false;
        return false;
      }
      if (!handlers.onBeforeSend?.({ text, anchor: anchorOf(composer) })) return false;
      event.preventDefault();
      event.stopImmediatePropagation();
      heldComposer = composer;
      return true;
    };

    const handleSend = (text: string) => {
      if (!text) return;
      heldComposer = null;
      handlers.onSend({ text });
      watcher.begin(Date.now());
      startPolling();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.shiftKey || event.altKey || event.isComposing) return;
      const composer = composerContaining(event.target);
      if (!composer) return;
      if (isGenerating(document)) return; // üretim sürerken Enter mesaj göndermez
      const text = readComposerText(composer);
      if (!text) return;
      if (intercept(event, composer, text)) return;
      handleSend(text);
    };

    const onClick = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const clicked = event.target.closest<HTMLButtonElement>(SEND_SELECTOR);
      if (!clicked || clicked.disabled) return;
      const composer = findComposer();
      if (!composer) return;
      const text = readComposerText(composer);
      if (!text) return;
      if (intercept(event, composer, text)) return;
      handleSend(text);
    };

    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("click", onClick, true);

    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("click", onClick, true);
      watcher.cancel();
      heldComposer = null;
      if (timer !== undefined) window.clearInterval(timer);
    };
  },
};
