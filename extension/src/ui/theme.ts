/**
 * Sayfa içindeki kartların (şerit, çıkış kartı) ortak görünümü. Kartlar Shadow DOM içinde çizilir;
 * sitenin stilinden etkilenmez. Tema işletim sisteminin ayarından değil, kartın üzerinde duracağı
 * sayfanın gerçek arka planından seçilir: koyu temalı bir sohbet sayfasında açık işletim sistemi
 * ayarı olsa da kart koyu çizilir ve arka planla karışmaz.
 */

export type Theme = "light" | "dark";

/** "rgb(a)" metnini [r, g, b, a] dizisine çevirir; anlaşılmazsa null. */
export function parseColor(value: string): [number, number, number, number] | null {
  const m = value.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)/i);
  if (!m) return null;
  let a = 1;
  if (m[4] !== undefined) a = m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  return [Number(m[1]), Number(m[2]), Number(m[3]), a];
}

/** Göreli parlaklık (WCAG), 0 koyu ile 1 açık arası. */
export function luminance(r: number, g: number, b: number): number {
  const ch = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

/** Kartın yanında duracağı öğeden yukarı doğru ilk opak arka planı bulur ve temayı seçer. */
export function detectTheme(anchor: Element | null): Theme {
  let node: Element | null = anchor;
  while (node) {
    const color = parseColor(getComputedStyle(node).backgroundColor);
    if (color && color[3] > 0.5) return luminance(color[0], color[1], color[2]) < 0.4 ? "dark" : "light";
    node = node.parentElement;
  }
  const prefersDark = typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
  return prefersDark ? "dark" : "light";
}

export const CARD_CSS = `
:host { all: initial; }
.card {
  --bg: #ffffff; --fg: #18201c; --muted: #5d6963; --line: rgba(20, 32, 26, .12); --soft: #f3f6f4;
  --accent: #1f6f54; --accent-fg: #ffffff; --ring: rgba(31, 111, 84, .35);
  --shadow: 0 1px 2px rgba(20, 32, 26, .06), 0 14px 36px -10px rgba(20, 32, 26, .28);
  position: fixed; z-index: 2147483000; box-sizing: border-box;
  font: 14px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: var(--fg); background: var(--bg);
  border: 1px solid var(--line); border-radius: 16px; box-shadow: var(--shadow);
  padding: 12px 16px 14px 18px; overflow: hidden;
  animation: kafiai-in .16s ease-out;
}
.card[data-theme="dark"] {
  --bg: #262d29; --fg: #ecf2ee; --muted: #a7b3ad; --line: rgba(255, 255, 255, .14); --soft: #2f3732;
  --accent: #5cc49c; --accent-fg: #0d1511; --ring: rgba(92, 196, 156, .4);
  --shadow: 0 1px 2px rgba(0, 0, 0, .45), 0 18px 44px -10px rgba(0, 0, 0, .7);
}
.card::before { content: ""; position: absolute; inset: 0 auto 0 0; width: 3px; background: var(--accent); }
@keyframes kafiai-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .card { animation: none; } }
.head { display: flex; align-items: center; gap: 8px; margin: 0 0 6px; }
.mark { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); flex: none; }
.brand { font-size: 12px; font-weight: 600; letter-spacing: .02em; color: var(--muted); }
.chip { font-size: 11.5px; color: var(--muted); background: var(--soft); border-radius: 999px; padding: 1px 8px; }
p { margin: 0 0 8px; }
.title { font-weight: 600; font-size: 14.5px; margin-bottom: 2px; }
.body { color: var(--fg); }
.hint, .note { color: var(--muted); font-size: 13px; }
.row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-top: 10px; }
.spacer { flex: 1 1 auto; }
button {
  font: inherit; font-size: 13.5px; cursor: pointer; border-radius: 999px; padding: 6px 14px;
  border: 1px solid transparent; background: var(--accent); color: var(--accent-fg);
  transition: filter .12s, background .12s, border-color .12s;
}
button:hover { filter: brightness(1.06); }
button:disabled { opacity: .6; cursor: default; }
button.secondary { background: transparent; color: var(--fg); border-color: var(--line); }
button.secondary:hover { background: var(--soft); filter: none; }
button.link { background: transparent; color: var(--muted); padding: 6px 6px; }
button.link:hover { color: var(--fg); filter: none; }
button:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
textarea {
  width: 100%; box-sizing: border-box; min-height: 130px; margin: 6px 0 4px; padding: 10px 12px;
  font: inherit; color: inherit; background: var(--soft); border: 1px solid var(--line); border-radius: 12px; resize: vertical;
}
textarea:focus-visible { outline: 2px solid var(--ring); outline-offset: 1px; }
`;

export interface MountedCard {
  host: HTMLElement;
  box: HTMLDivElement;
}

/** Kartı Shadow DOM içinde oluşturur, temasını sayfadan seçer ve mesaj kutusunun üstüne yerleştirir. */
export function mountCard(kind: string, anchor: Element): MountedCard {
  const host = document.createElement("div");
  host.setAttribute("data-kafiai", kind);
  const root = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = CARD_CSS;
  const box = document.createElement("div");
  box.className = "card strip";
  box.dataset.theme = detectTheme(anchor);
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-label", "KafiAI");
  root.append(style, box);

  const rect = anchor.getBoundingClientRect();
  const width = Math.min(Math.max(rect.width, 300), window.innerWidth - 16);
  box.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`;
  box.style.width = `${width}px`;
  box.style.bottom = `${Math.max(8, window.innerHeight - rect.top + 10)}px`;
  document.body.appendChild(host);
  return { host, box };
}

/** Kartın üst satırı: küçük işaret, "KafiAI" ve isteğe bağlı bağlam etiketi. */
export function header(chip?: string): HTMLDivElement {
  const head = document.createElement("div");
  head.className = "head";
  const mark = document.createElement("span");
  mark.className = "mark";
  const brand = document.createElement("span");
  brand.className = "brand";
  brand.textContent = "KafiAI";
  head.append(mark, brand);
  if (chip) {
    const c = document.createElement("span");
    c.className = "chip";
    c.textContent = chip;
    head.append(c);
  }
  return head;
}
