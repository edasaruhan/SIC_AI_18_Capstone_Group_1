import type { TaskNorm } from "../core/tasks";
import type { Reason } from "../core/turn-model";
import { header, mountCard } from "./theme";

/**
 * Çıkış kartı: sohbet uzayıp tekrar denemeleri olduysa, cevap bittikten sonra mesaj kutusunun
 * üstünde görünür. "Taze başlat" kullanıcının isteklerini düzenlenebilir tek taslakta toplar,
 * panoya kopyalar ve yeni sohbet açar. Dil yargılamaz; sayaç, rozet, seri yok.
 */

export type ExitDismissal = "kapat" | "ara" | "taze";

export interface ExitCardActions {
  /** Sohbetteki istekleri toplayan taslak metni üretir (tıklanınca çağrılır). */
  getDraft(): string;
  /** Düzenlenmiş taslağı kopyala ve yeni sohbet aç. Kopyalama başarılıysa true döner. */
  onFreshStart(draft: string): Promise<boolean>;
  /** Kart kapandı (kullanıcı kapattı ya da bir seçim yaptı). */
  onDismiss(kind: ExitDismissal): void;
  /** "Bir daha gösterme": kalıcı olarak kapat. Verilirse düğme gösterilir. */
  onNever?(): void;
  /** Model kaynaklı kartta "Yerinde değildi" geri bildirimi. Verilirse düğme gösterilir. */
  onNotRelevant?(): void;
}


export class ExitCard {
  private host: HTMLElement | null = null;
  private onKey: ((e: KeyboardEvent) => void) | null = null;

  get visible(): boolean {
    return this.host !== null;
  }

  /**
   * reason verilirse kart tur modelinden gelir: metin modelin gerekçesini ve somut bir öneriyi söyler.
   * Verilmezse görev normuna dayalı metin gösterilir.
   */
  show(anchor: Element, turns: number, norm: TaskNorm | null, actions: ExitCardActions, reason: Reason | null = null): void {
    this.hide();
    const { host, box } = mountCard("exit-card", anchor);
    const chip = reason ? "Modelin önerisi" : "Uzun sohbet";

    const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string): HTMLElementTagNameMap[K] => {
      const node = document.createElement(tag);
      if (text !== undefined) node.textContent = text;
      if (cls) node.className = cls;
      return node;
    };
    const button = (text: string, cls: string, onClick: () => void): HTMLButtonElement => {
      const b = el("button", text, cls);
      b.type = "button";
      b.addEventListener("click", onClick);
      return b;
    };
    const row = (...children: HTMLElement[]): HTMLDivElement => {
      const r = el("div", undefined, "row");
      r.append(...children);
      return r;
    };
    const spacer = () => el("span", undefined, "spacer");
    let ended = false; // kalıcı bir seçim yapıldı; Escape ek bir kapatma sayılmaz
    const dismiss = (kind: ExitDismissal) => {
      this.hide();
      actions.onDismiss(kind);
    };

    const showMain = () => {
      const fresh = button("Taze başlat", "", showDraft);
      const notRelevant =
        reason && actions.onNotRelevant
          ? [button("Yerinde değildi", "link", () => {
              actions.onNotRelevant?.();
              dismiss("kapat");
            })]
          : [];
      box.replaceChildren(
        header(chip),
        el("p", reason ? modelCardMessage(reason) : exitCardMessage(turns, norm), "body"),
        ...(reason ? [el("p", MODEL_NOTE, "note")] : []),
        row(
          fresh,
          button("Kısa ara ver", "secondary", showBreak),
          spacer(),
          ...notRelevant,
          ...(actions.onNever ? [button("Bir daha gösterme", "link", showNever)] : []),
          button("Kapat", "link", () => dismiss("kapat")),
        ),
      );
      fresh.focus();
    };

    const showNever = () => {
      ended = true;
      actions.onNever?.();
      const close = button("Kapat", "", () => this.hide());
      box.replaceChildren(
        header(chip),
        el("p", "Tamam, çıkış kartı bir daha gösterilmeyecek. İstersen KafiAI penceresinden yeniden açabilirsin.", "body"),
        row(close),
      );
      close.focus();
    };

    const showBreak = () => {
      const close = button("Kapat", "", () => dismiss("ara"));
      box.replaceChildren(header(chip), el("p", "Tamam. Sohbet burada duruyor; hazır olduğunda kaldığın yerden devam edebilirsin.", "body"), row(close));
      close.focus();
    };

    const showDraft = () => {
      const area = el("textarea");
      area.value = actions.getDraft();
      area.setAttribute("aria-label", "Yeni sohbet taslağı");
      const note = el("p", "", "note");
      const go = button("Kopyala ve yeni sohbet aç", "", () => {
        go.disabled = true;
        void actions.onFreshStart(area.value).then((ok) => {
          if (ok) {
            box.replaceChildren(
              header(chip),
              el("p", "Panoya kopyalandı. Yeni sohbette Ctrl+V (Mac'te ⌘+V) ile yapıştırabilirsin.", "body"),
              row(button("Kapat", "", () => dismiss("taze"))),
            );
          } else {
            go.disabled = false;
            note.textContent = "Kopyalanamadı. Metni seçip kendin kopyalayabilirsin.";
          }
        });
      });
      box.replaceChildren(header(chip), el("p", "İsteklerini tek taslakta topladım. İstersen düzenle:", "title"), area, note, row(go, spacer(), button("Geri", "link", showMain)));
      area.focus();
    };

    showMain();
    this.host = host;

    this.onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (ended) this.hide();
      else dismiss("kapat");
    };
    document.addEventListener("keydown", this.onKey, true);
  }

  hide(): void {
    if (this.onKey) document.removeEventListener("keydown", this.onKey, true);
    this.onKey = null;
    this.host?.remove();
    this.host = null;
  }
}

/**
 * Kartın ana cümlesi. Görev türü biliniyorsa WildChat'teki normu söyler
 * (o türdeki çok turlu sohbetlerin %75'i kaç turda bitiyor); bilinmiyorsa yalnızca tur sayısını.
 */
export function exitCardMessage(turns: number, norm: TaskNorm | null): string {
  const tail =
    "Uzun sohbetlerde yapay zeka modelleri yolunu kaybedebiliyor; " +
    "isteklerini tek mesajda toplayıp yeni bir sohbet açmak genelde daha hızlı olur.";
  if (norm === null || norm.label === "Diğer") return `Bu sohbet ${turns}. turunda. ${tail}`;
  const p75 = Math.round(norm.p75_turns);
  return `${norm.label} sohbetlerinin çoğu ${p75} turda ya da daha kısa sürede bitiyor; bu sohbet ${turns}. turunda. ${tail}`;
}

/** Model kaynaklı kartta, önerinin nereden geldiğini söyleyen kısa not. */
export const MODEL_NOTE =
  "Bu öneri, sohbetin şu ana kadarki mesajlarına bakan küçük bir modelden geliyor; mesajların cihazından çıkmıyor.";

/** Model kaynaklı kartın ana cümlesi: durum ve somut öneri. */
export function modelCardMessage(reason: Reason): string {
  return `${reason.why} ${reason.tip}`;
}
