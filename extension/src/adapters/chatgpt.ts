import { POLL_MS } from "../config";
import { ResponseWatcher } from "../core/response-watcher";
import type { Adapter, AdapterHandlers } from "./types";

/** Bekletilen gönderim (varsa) ve "bir sonraki girişimi engelleme" bayrağı. */
let heldComposer: HTMLElement | null = null;
let bypassNext = false;

/**
 * ChatGPT sayfa yapısı (Ekim 2026'da canlı sayfada ölçüldü):
 *  - Mesaj kutusu: <form> içinde contenteditable="true" role="textbox" bir div.
 *  - Gönder düğmesi: formda button[type="submit"]; yalnızca kutuda yazı varken var.
 *  - Cevap üretilirken: gönder yerine "Durdur" düğmesi gelir (type="button") ve
 *    yeni turun data-talvt-turn-state değeri "in_progress" olur.
 *
 * aria-label metinleri kullanıcının diline göre değiştiği için düğmeleri etiketle değil
 * yapıyla buluyoruz. Durdur etiketi yalnızca yedek sinyal olarak, çok dilli listeyle aranır.
 */

const COMPOSER_SELECTOR = '[contenteditable="true"][role="textbox"]';

/** Sayfadaki kullanıcı mesajı birimleri (Ekim 2026'da ölçüldü: anahtar ":user" ile biter). */
const USER_MESSAGE_SELECTOR = '[data-content-search-unit-key$=":user"]';

const STOP_LABEL = /^(durdur|stop|arrêter|detener|parar|stoppen|stopp|fermare|остановить)/i;

const HOSTS = new Set(["chatgpt.com", "chat.openai.com"]);

const CONVERSATION_PATH = /\/c\/([^/?#]+)/;

/**
 * Sohbet kimliğini adresten çıkarır. Yeni bir sohbette ilk mesaj gönderilince ChatGPT önce
 * geçici bir adres kullanır ("/c/local…"), cevap gelince gerçek kimliğe geçer (canlı sayfada
 * ölçüldü). Geçici adres "henüz kaydedilmemiş yeni sohbet" sayılır (null); böylece
 * "/" → geçici → gerçek geçişi oturumu sıfırlamaz.
 */
export function chatKeyFromPath(pathname: string): string | null {
  const match = CONVERSATION_PATH.exec(pathname);
  if (!match?.[1]) return null;
  let segment = match[1];
  try {
    segment = decodeURIComponent(segment);
  } catch {
    // bozuk kodlama: olduğu gibi bırak
  }
  if (/^local/i.test(segment)) return null;
  return /^[A-Za-z0-9-]{8,}$/.test(segment) ? segment : null;
}

/**
 * Sayfada birden fazla mesaj kutusu olabilir (canlı sayfada ikisi var: biri gizli bir kopya).
 * Bu yüzden "ilk kutu" değil, her zaman olayın geldiği kutu kullanılır.
 */
export function findComposers(root: ParentNode = document): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(COMPOSER_SELECTOR)).filter(
    (box) => box.closest("form") && !isEditBox(box),
  );
}

/**
 * Eski bir mesajı düzenlerken açılan kutu da aynı yapıda (role=textbox, form, submit düğmesi)
 * ama bir mesaj turunun içinde yer alır; asıl mesaj kutusu turların dışındadır (canlı sayfada
 * ölçüldü). Düzenleme zaten "yeniden ifade etme" eylemidir: engellenmez, yeni mesaj sayılmaz.
 */
export function isEditBox(box: Element): boolean {
  return box.closest("[data-turn-key]") !== null;
}

/** Verilen düğüm asıl mesaj kutusunun içindeyse o kutuyu döndürür (düzenleme kutusu sayılmaz). */
export function composerContaining(node: EventTarget | null): HTMLElement | null {
  if (!(node instanceof Element)) return null;
  const box = node.closest<HTMLElement>(COMPOSER_SELECTOR);
  return box && box.closest("form") && !isEditBox(box) ? box : null;
}

/** Genel amaçlı: odaktaki kutu, yoksa görünen ilk kutu, yoksa ilk kutu. */
export function findComposer(root: ParentNode = document): HTMLElement | null {
  const boxes = findComposers(root);
  const focused = boxes.find((box) => box.contains(document.activeElement));
  if (focused) return focused;
  return boxes.find((box) => box.getClientRects().length > 0) ?? boxes[0] ?? null;
}

export function readComposerText(box: HTMLElement): string {
  return (box.innerText || box.textContent || "").trim();
}

function hasStopButton(form: HTMLFormElement): boolean {
  if (form.querySelector('button[data-testid="stop-button"]')) return true;
  const buttons = Array.from(form.querySelectorAll<HTMLButtonElement>("button"));
  return buttons.some((b) => STOP_LABEL.test(b.getAttribute("aria-label") ?? ""));
}

/** Yapay zeka şu an cevap üretiyor mu? */
export function isGenerating(root: ParentNode = document): boolean {
  if (root.querySelector('[data-talvt-turn-state="in_progress"]')) return true;
  return findComposers(root).some((box) => {
    const form = box.closest("form");
    return form ? hasStopButton(form) : false;
  });
}

export const chatgptAdapter: Adapter = {
  name: "chatgpt",
  platform: "chatgpt",

  matches(url) {
    return HOSTS.has(url.hostname);
  },

  conversationKey(url) {
    return chatKeyFromPath(url.pathname);
  },

  submitHeld() {
    const composer = heldComposer;
    heldComposer = null;
    const form = composer?.closest("form");
    if (!composer || !form || !composer.isConnected) return false;
    const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
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
    return `${location.origin}/`;
  },

  composer() {
    const box = findComposer();
    return box ? { anchor: box.closest("form") ?? box, empty: readComposerText(box) === "" } : null;
  },

  focusComposer() {
    findComposer()?.focus();
  },

  readHistory() {
    // Sohbet değişince ChatGPT önceki sohbetin mesajını sayfada görünmez bir artık olarak
    // bırakabiliyor (canlı sayfada ölçüldü: yükseklik 0). Yalnızca ekranda yer kaplayanlar alınır.
    return Array.from(document.querySelectorAll<HTMLElement>(USER_MESSAGE_SELECTOR))
      .filter((el) => el.getClientRects().length > 0)
      .map((el) => (el.innerText || el.textContent || "").trim())
      .filter((text) => text.length > 0);
  },

  insertText(text) {
    const composer = heldComposer ?? findComposer();
    heldComposer = null;
    if (!composer || typeof document.execCommand !== "function") return false;
    composer.focus();
    const selection = window.getSelection();
    if (!selection) return false;
    const range = document.createRange();
    range.selectNodeContents(composer);
    range.collapse(false); // imleci sona koy
    selection.removeAllRanges();
    selection.addRange(range);
    // Sayfanın kendi düzenleyicisi (ProseMirror) değişikliği görsün diye tarayıcının
    // yazma komutunu kullanıyoruz; innerHTML ile müdahale etmiyoruz.
    if (readComposerText(composer) !== "") {
      // Önce yeni paragraf; düzenleyici bunu görmezse satır sonu dene. Kırpılmamış metindeki
      // satır sonu sayısına bakılır (kullanıcının kendi mesajı da çok satırlı olabilir).
      const lineBreaks = () => ((composer.innerText || composer.textContent || "").match(/\n/g) ?? []).length;
      const before = lineBreaks();
      document.execCommand("insertParagraph");
      if (lineBreaks() === before) document.execCommand("insertLineBreak");
    }
    return document.execCommand("insertText", false, text);
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
      const anchor = composer.closest("form") ?? composer;
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

    // Yakalama (capture) aşamasında dinliyoruz: sayfanın kendi kodu mesaj kutusunu
    // temizlemeden önce metni okuyabilmek için.
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
      const button = event.target.closest('button[type="submit"]');
      const composer = composerContaining(button?.closest("form")?.querySelector<HTMLElement>(COMPOSER_SELECTOR) ?? null);
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
