import { REPAIRS, type Repair } from "../core/repairs";

/**
 * Gönderirken şerit: benzer bir mesaj gönderilmek üzereyken mesaj kutusunun üstünde görünen
 * küçük, kapatılabilir kutu. Sayfanın stilinden etkilenmemesi için Shadow DOM içinde çizilir.
 * Dil: yargılamaz; "bağımlı", "risk" gibi sözler kullanılmaz.
 *
 * İki görünüm: (1) "Yine de gönder" / "Neyin eksik olduğunu söyle", (2) onarım seçenekleri.
 */

export interface StripActions {
  onSendAnyway(): void;
  /** Kullanıcı şeridi kapatıp mesajını düzenlemeye döndü (Kapat, Escape). */
  onClose(): void;
  /** Kullanıcı bir onarım seçti; mesaj kutusuna eklenecek cümle. */
  onRepair(sentence: string, id: Repair["id"]): void;
  /** "Yerinde değildi": uyarı gereksizdi. Verilirse düğme gösterilir. */
  onNotRelevant?(): void;
}

export const CSS = `
:host { all: initial; }
.strip {
  position: fixed; z-index: 2147483000; box-sizing: border-box;
  font: 14px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
  background: #fff; color: #1f2328; border: 1px solid #d0d7de; border-radius: 14px;
  box-shadow: 0 6px 24px rgba(0,0,0,.14); padding: 12px 14px;
}
@media (prefers-color-scheme: dark) {
  .strip { background: #2b2b2e; color: #ececf1; border-color: #4a4a50; box-shadow: 0 6px 24px rgba(0,0,0,.5); }
  button.secondary, button.link { color: #ececf1; border-color: #5a5a60; }
}
p { margin: 0 0 10px; }
.row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
button {
  font: inherit; cursor: pointer; border-radius: 999px; padding: 6px 14px;
  border: 1px solid transparent; background: #0f6e56; color: #fff;
}
button.secondary { background: transparent; color: #1f2328; border-color: #b6bcc4; }
button.link { background: transparent; color: #57606a; padding: 6px 8px; margin-left: auto; }
button.link + button.link { margin-left: 0; }
button:focus-visible { outline: 2px solid #3b82f6; outline-offset: 2px; }
`;

export class Strip {
  private host: HTMLElement | null = null;
  private onKey: ((e: KeyboardEvent) => void) | null = null;

  get visible(): boolean {
    return this.host !== null;
  }

  show(anchor: Element, actions: StripActions): void {
    this.hide();
    const host = document.createElement("div");
    host.setAttribute("data-kafiai", "strip");
    const root = host.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent = CSS;

    const box = document.createElement("div");
    box.className = "strip";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", "KafiAI");
    root.append(style, box);

    const button = (text: string, cls: string, onClick: () => void): HTMLButtonElement => {
      const b = document.createElement("button");
      b.type = "button";
      if (cls) b.className = cls;
      b.textContent = text;
      b.addEventListener("click", onClick);
      return b;
    };
    const paragraph = (text: string): HTMLParagraphElement => {
      const p = document.createElement("p");
      p.textContent = text;
      return p;
    };
    const close = () => {
      this.hide();
      actions.onClose();
    };

    const showChoice = () => {
      const row = document.createElement("div");
      row.className = "row";
      const missing = button("Neyin eksik olduğunu söyle", "", showRepairs);
      row.append(
        missing,
        button("Yine de gönder", "secondary", () => {
          this.hide();
          actions.onSendAnyway();
        }),
      );
      if (actions.onNotRelevant) {
        row.append(
          button("Yerinde değildi", "link", () => {
            this.hide();
            actions.onNotRelevant?.();
          }),
        );
      }
      row.append(button("Kapat", "link", close));
      box.replaceChildren(paragraph("Bunu az önce de sormuştun."), row);
      missing.focus();
    };

    const showRepairs = () => {
      const row = document.createElement("div");
      row.className = "row";
      for (const repair of REPAIRS) {
        row.append(
          button(repair.label, "secondary", () => {
            this.hide();
            actions.onRepair(repair.sentence, repair.id);
          }),
        );
      }
      row.append(button("Geri", "link", showChoice));
      box.replaceChildren(paragraph("Cevapta ne eksikti?"), row);
      (row.firstElementChild as HTMLButtonElement | null)?.focus();
    };

    showChoice();

    const rect = anchor.getBoundingClientRect();
    box.style.left = `${Math.max(8, rect.left)}px`;
    box.style.width = `${Math.max(rect.width, 280)}px`;
    box.style.bottom = `${Math.max(8, window.innerHeight - rect.top + 8)}px`;

    document.body.appendChild(host);
    this.host = host;

    this.onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
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
