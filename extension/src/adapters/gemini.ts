import { POLL_MS } from "../config";
import { ResponseWatcher } from "../core/response-watcher";
import { appendAsNewLine } from "./insert";
import type { Adapter, AdapterHandlers } from "./types";

/** Bekletilen gönderim (varsa) ve "bir sonraki girişimi engelleme" bayrağı. */
let heldComposer: HTMLElement | null = null;
let bypassNext = false;

/**
 * Gemini sayfa yapısı (Ekim 2026'da canlı sayfada ölçüldü):
 *  - <form> YOK. Mesaj alanı <input-area-v2> içinde, <rich-textarea> altında
 *    div.ql-editor[role=textbox][contenteditable=true] (Quill). Yanında 0x1 boyutunda
 *    bir div.ql-clipboard var (role yok; mesaj kutusu sayılmaz).
 *  - Gönder düğmesi yalnızca kutuda yazı varken belirir: input-area-v2 içindeki son düğme
 *    ("Mesaj gönder"). Cevap üretilirken aynı yerde "Yanıtı durdur" düğmesi olur.
 *  - Gönderince: user-query + pending-request + thinking-dots-animation belirir; adres
 *    sonradan /app/<kimlik> olur (geçici adres yok). Cevap bitince durdur düğmesi kaybolur
 *    (beğen/kopyala çubuğundan yaklaşık 5 sn önce).
 *  - Eski mesajlar: <user-query>; metin p.query-text-line içinde. Aynı öğede ekran
 *    okuyucuya özel, dile bağlı gizli bir etiket var ("Siz şunu dediniz:"): okunmaz.
 *
 * aria-label metinleri dile göre değişir; bu yüzden etiket listeleri yalnızca ana sinyal
 * için, yapı (son düğme) yedek olarak kullanılır.
 */

const COMPOSER_SELECTOR = 'div.ql-editor[role="textbox"][contenteditable="true"]';
const INPUT_AREA = "input-area-v2";

const STOP_LABEL = /^(yanıtı durdur|yanıtı dur|stop response|stop generating|durdur|stop)/i;
const SEND_LABEL = /^(mesaj gönder|send message|gönder|send)/i;

const HOSTS = new Set(["gemini.google.com"]);

const CONVERSATION_PATH = /\/app\/([A-Za-z0-9_-]{8,})(?:[/?#]|$)/;

/** Sohbet kimliğini adresten çıkarır. Yeni (kaydedilmemiş) sohbette "/u/1/app": null. */
export function chatKeyFromPath(pathname: string): string | null {
  return CONVERSATION_PATH.exec(pathname)?.[1] ?? null;
}

/** Yalnızca asıl mesaj alanındaki (input-area-v2 içindeki) Quill kutuları; gizli kopyalar ve düzenleme kutuları dışarıda. */
export function findComposers(root: ParentNode = document): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(COMPOSER_SELECTOR)).filter(
    (box) => box.closest(INPUT_AREA) !== null,
  );
}

export function composerContaining(node: EventTarget | null): HTMLElement | null {
  if (!(node instanceof Element)) return null;
  const box = node.closest<HTMLElement>(COMPOSER_SELECTOR);
  return box && box.closest(INPUT_AREA) ? box : null;
}

export function findComposer(root: ParentNode = document): HTMLElement | null {
  const boxes = findComposers(root);
  const focused = boxes.find((box) => box.contains(document.activeElement));
  if (focused) return focused;
  return boxes.find((box) => box.getClientRects().length > 0) ?? boxes[0] ?? null;
}

export function readComposerText(box: HTMLElement): string {
  return (box.innerText || box.textContent || "").trim();
}

function visibleButtons(area: Element): HTMLButtonElement[] {
  return Array.from(area.querySelectorAll<HTMLButtonElement>("button")).filter((b) => b.getClientRects().length > 0);
}

function hasStopButton(area: Element): boolean {
  return visibleButtons(area).some((b) => STOP_LABEL.test(b.getAttribute("aria-label") ?? ""));
}

/** Yapay zeka şu an cevap üretiyor mu? */
export function isGenerating(root: ParentNode = document): boolean {
  if (root.querySelector("pending-request, thinking-dots-animation")) return true;
  return findComposers(root).some((box) => {
    const area = box.closest(INPUT_AREA);
    return area ? hasStopButton(area) : false;
  });
}

/**
 * Gönder düğmesi: önce etiketle; bulunamazsa (başka dil), kutuda yazı varken ve üretim
 * yokken alandaki son düğme (ölçümde hep gönder düğmesiydi). Bilinen sınır: bilinmeyen bir
 * dilde, cevabın son saniyesinde (bekleyen istek bitmiş ama durdur düğmesi sürerken) durdur
 * düğmesi gönder sanılabilir; bilinen diller (tr, en) etiketle doğru ayrılır.
 */
export function findSendButton(composer: HTMLElement): HTMLButtonElement | null {
  const area = composer.closest(INPUT_AREA);
  if (!area) return null;
  const buttons = visibleButtons(area);
  const byLabel = buttons.find((b) => SEND_LABEL.test(b.getAttribute("aria-label") ?? ""));
  if (byLabel) return byLabel;
  if (buttons.length >= 3 && readComposerText(composer) !== "" && !isGenerating(document)) {
    return buttons[buttons.length - 1] ?? null;
  }
  return null;
}

/** Arayüzün yerleşeceği öğe: yuvarlak mesaj alanı; yoksa kapsayıcı; yoksa kutunun kendisi. */
function anchorOf(box: HTMLElement): Element {
  return box.closest("div.text-input-field") ?? box.closest(INPUT_AREA) ?? box;
}

export const geminiAdapter: Adapter = {
  name: "gemini",
  platform: "gemini",

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
    const button = findSendButton(composer);
    if (!button) return false;
    bypassNext = true;
    try {
      button.click(); // kendi tıklama dinleyicimiz bir kereliğine izin verir
    } finally {
      bypassNext = false;
    }
    return true;
  },

  newChatUrl() {
    // Hesap dizini korunur: /u/1/app/<kimlik> → /u/1/app
    const base = /^(\/u\/\d+)?\/app/.exec(location.pathname)?.[0] ?? "/app";
    return `${location.origin}${base}`;
  },

  readHistory() {
    return Array.from(document.querySelectorAll<HTMLElement>("user-query"))
      .filter((el) => el.getClientRects().length > 0)
      .map((el) =>
        Array.from(el.querySelectorAll<HTMLElement>(".query-text-line"))
          .map((line) => (line.innerText || line.textContent || "").trim())
          .filter((text) => text.length > 0)
          .join("\n"),
      )
      .filter((text) => text.length > 0);
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
    return appendAsNewLine(composer, text);
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
      const anchor = anchorOf(composer);
      if (!handlers.onBeforeSend?.({ text, anchor })) return false;
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
      const clicked = event.target.closest("button");
      const area = clicked?.closest(INPUT_AREA);
      if (!clicked || !area) return;
      const composer = findComposers(area)[0];
      if (!composer || findSendButton(composer) !== clicked) return;
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
