import { REPAIRS, type Repair } from "../core/repairs";
import { header, mountCard } from "./theme";

/**
 * Gönderirken şerit: benzer bir mesaj gönderilmek üzereyken mesaj kutusunun üstünde görünen
 * küçük, kapatılabilir kart. Dil yargılamaz; "bağımlı", "risk" gibi sözler kullanılmaz.
 * Metin duruma göre değişir: birebir tekrar mı yoksa yeniden ifade mi, bu sohbette kaçıncı kez,
 * görev türü ne. Üçüncü denemeden sonra yeni sohbete geçme seçeneği de sunulur.
 *
 * İki görünüm: (1) ana seçimler, (2) onarım seçenekleri ("Cevapta ne eksikti?").
 */

export interface StripActions {
  onSendAnyway(): void;
  /** Kullanıcı şeridi kapatıp mesajını düzenlemeye döndü (Kapat, Escape). */
  onClose(): void;
  /** Kullanıcı bir onarım seçti; mesaj kutusuna eklenecek cümle. */
  onRepair(sentence: string, id: Repair["id"]): void;
  /** "Yerinde değildi": uyarı gereksizdi. Verilirse düğme gösterilir. */
  onNotRelevant?(): void;
  /** "Yeni sohbete geç": çıkış kartını açar. Verilirse ve birkaç deneme olduysa düğme gösterilir. */
  onFreshStart?(): void;
}

export interface StripContext {
  /** Bu sohbette kaçıncı benzer mesaj (bu dahil, 1'den başlar). */
  attempt: number;
  /** Önceki mesajla neredeyse birebir aynı mı (benzerlik 0,97 ve üstü)? */
  exact: boolean;
  /** Görev türü (src/core/tasks.ts); bilinmiyorsa null. */
  task: string | null;
}

/** Bu denemeden sonra şeritte "Yeni sohbete geç" önerilir. */
export const FRESH_START_FROM_ATTEMPT = 3;

const TASK_HINTS: Record<string, string> = {
  kod: "Hata mesajını ve beklediğin çıktıyı eklemek genelde işe yarar.",
  ceviri: "Metnin kime gideceğini ve ne kadar resmi olacağını söylemek işe yarar.",
  ozet: "Özetin uzunluğunu ve kimin okuyacağını söylemek işe yarar.",
  yazma: "Tonu, uzunluğu ve kime yazıldığını belirtmek işe yarar.",
  soru: "Neyi zaten bildiğini ve cevabı ne için kullanacağını eklemek işe yarar.",
};

/** Şeridin başlığı, açıklaması ve görev ipucu. Testler ve popup önizlemesi de kullanır. */
export function stripMessage(ctx: StripContext): { title: string; body: string; hint: string | null } {
  const hint = ctx.task !== null ? (TASK_HINTS[ctx.task] ?? null) : null;
  if (ctx.attempt >= FRESH_START_FROM_ATTEMPT) {
    return {
      title: "Birkaç denemedir aynı yerdesin.",
      body:
        "Uzayan sohbetlerde model kendi eski cevaplarına takılabiliyor; sorun çoğu zaman sende değil, sohbette. " +
        "Dümen sende: istersen kısa bir mola ver ya da isteğini toplayıp yeni bir sohbete geç.",
      hint: null,
    };
  }
  if (ctx.attempt === 2) {
    return {
      title: "Aynı isteğe ikinci kez dönüyorsun.",
      body: "Bu noktada aynı soruyu yinelemek yerine önceki cevapta tam olarak neyin yanlış olduğunu söylemek genelde daha hızlı sonuç verir.",
      hint,
    };
  }
  if (ctx.exact) {
    return {
      title: "Bunu az önce de sormuştun.",
      body: "Aynı soru çoğu zaman aynı cevabı getirir. İstersen neyin eksik kaldığını bir cümleyle ekle.",
      hint,
    };
  }
  return {
    title: "Bu, az önceki isteğinin başka bir hali gibi.",
    body: "Model neyin işe yaramadığını bilirse farklı bir yol dener. İstersen bunu da söyleyerek gönder.",
    hint,
  };
}

const DEFAULT_CONTEXT: StripContext = { attempt: 1, exact: true, task: null };

export class Strip {
  private host: HTMLElement | null = null;
  private onKey: ((e: KeyboardEvent) => void) | null = null;

  get visible(): boolean {
    return this.host !== null;
  }

  show(anchor: Element, actions: StripActions, ctx: StripContext = DEFAULT_CONTEXT): void {
    this.hide();
    const { host, box } = mountCard("strip", anchor);

    const button = (text: string, cls: string, onClick: () => void): HTMLButtonElement => {
      const b = document.createElement("button");
      b.type = "button";
      if (cls) b.className = cls;
      b.textContent = text;
      b.addEventListener("click", onClick);
      return b;
    };
    const paragraph = (text: string, cls?: string): HTMLParagraphElement => {
      const p = document.createElement("p");
      if (cls) p.className = cls;
      p.textContent = text;
      return p;
    };
    const spacer = () => {
      const s = document.createElement("span");
      s.className = "spacer";
      return s;
    };
    const close = () => {
      this.hide();
      actions.onClose();
    };
    const msg = stripMessage(ctx);
    const chip = ctx.attempt >= 2 ? `${ctx.attempt}. deneme` : "Benzer mesaj";

    const showChoice = () => {
      const row = document.createElement("div");
      row.className = "row";
      const offerFresh = ctx.attempt >= FRESH_START_FROM_ATTEMPT && actions.onFreshStart;
      const primary = offerFresh
        ? button("Yeni sohbete geç", "", () => {
            this.hide();
            actions.onFreshStart?.();
          })
        : button("Neyin eksik olduğunu söyle", "", showRepairs);
      row.append(primary);
      if (offerFresh) row.append(button("Neyin eksik olduğunu söyle", "secondary", showRepairs));
      row.append(
        button("Yine de gönder", "secondary", () => {
          this.hide();
          actions.onSendAnyway();
        }),
        spacer(),
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
      box.replaceChildren(
        header(chip),
        paragraph(msg.title, "title"),
        paragraph(msg.body, "body"),
        ...(msg.hint ? [paragraph(msg.hint, "hint")] : []),
        row,
      );
      primary.focus();
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
      row.append(spacer(), button("Geri", "link", showChoice));
      box.replaceChildren(header(chip), paragraph("Cevapta ne eksikti?", "title"), paragraph("Seçtiğin cümle mesajına eklenir; tamamlayıp kendin gönderirsin.", "hint"), row);
      (row.firstElementChild as HTMLButtonElement | null)?.focus();
    };

    showChoice();
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
