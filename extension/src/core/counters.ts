import schema from "../data/counter-schema.json";
import type { KeyValueStorage } from "./settings";
import { similarity } from "./similarity";
import { hasStrongRepair } from "./strong-repair";
import { normalizeText } from "./text";
import { EXACT_REPEAT_THRESHOLD } from "./turn-features";

/**
 * Sayaç şeması v2 (karar K18). Yalnızca sayılar: günlük, 90 gün, seyrek (sıfır olmayan hücreler).
 *
 * Bir hücrenin anahtarı "olay|boyut1|boyut2|...|ayrıntı" biçiminde; boyutların sırası
 * src/data/counter-schema.json içinde her olay için tanımlı. Örnek:
 *     send|chatgpt|18-24|kod|4-6|benzer   → bugün 18-24 arasında ChatGPT'de, kod sohbetinde,
 *                                            4-6. turda gönderilen ve benzer bulunan mesaj sayısı
 * Mesaj metni, sohbet kimliği ya da adres hiçbir zaman anahtara ya da değere girmez:
 * boyutların değerleri şemadaki kısa listelerden gelir, başka bir şey kabul edilmez.
 */

export type EventName = keyof typeof schema.events;
export type DimName = keyof typeof schema.dimensions;
export type Phase = "sayim" | "oneri" | "karisik";
export type Dims = Partial<Record<DimName, string>>;

export interface DayRecord {
  phase: Phase;
  c: Record<string, number>;
}
export interface CountsV2 {
  v: 2;
  days: Record<string, DayRecord>;
}

export const COUNTS_V2_KEY = schema.storage_key;
export const COUNTS_V1_KEY = schema.v1_storage_key;
export const UNKNOWN = schema.unknown;
const EVENTS = schema.events as Record<string, { dims: string[]; details: string[] }>;
const DIM_VALUES = schema.dimensions as Record<string, string[]>;

// ---------------------------------------------------------------------------
// Kovalar
// ---------------------------------------------------------------------------

/** Yerel saate göre dört dilimden biri. */
export function slotOf(date: Date): string {
  const h = date.getHours();
  const starts = schema.buckets.slot_start_hours;
  let i = 0;
  while (i + 1 < starts.length && h >= (starts[i + 1] ?? 24)) i++;
  return DIM_VALUES.slot?.[i] ?? UNKNOWN;
}

/** Tur sayısının kovası: 1-3, 4-6, 7-10, 11+. */
export function lenBucket(turns: number): string {
  if (!Number.isFinite(turns) || turns < 1) return UNKNOWN;
  const uppers = schema.buckets.len_upper;
  const i = uppers.findIndex((u) => turns <= u);
  return DIM_VALUES.len?.[i === -1 ? uppers.length : i] ?? UNKNOWN;
}

/** İlk mesajın uzunluk kovası (karakter, kod noktası olarak): kisa, orta, uzun. */
export function firstLenBucket(text: string): string {
  const n = Array.from(text ?? "").length;
  const uppers = schema.buckets.first_len_upper_chars;
  const i = uppers.findIndex((u) => n <= u);
  return DIM_VALUES.first_len?.[i === -1 ? uppers.length : i] ?? UNKNOWN;
}

/** Yerel takvime göre gün anahtarı: YYYY-MM-DD */
export function dayOf(date: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

// ---------------------------------------------------------------------------
// Anahtarlar ve doğrulama
// ---------------------------------------------------------------------------

/** Hücre anahtarı üretir. Şemada olmayan bir değer gelirse "na" yazılır; ayrıntı geçersizse null döner. */
export function cellKey(event: EventName, dims: Dims, detail: string): string | null {
  const spec = EVENTS[event];
  if (!spec || !spec.details.includes(detail)) return null;
  const parts = spec.dims.map((d) => {
    const v = dims[d as DimName];
    return v !== undefined && (DIM_VALUES[d] ?? []).includes(v) ? v : UNKNOWN;
  });
  return [event, ...parts, detail].join("|");
}

/** Anahtarın şemaya uyup uymadığı. Uymayan anahtar okunurken atılır. */
export function isValidCellKey(key: string): boolean {
  const parts = key.split("|");
  const spec = EVENTS[parts[0] ?? ""];
  if (!spec || parts.length !== spec.dims.length + 2) return false;
  for (let i = 0; i < spec.dims.length; i++) {
    const v = parts[i + 1] ?? "";
    if (v !== UNKNOWN && !(DIM_VALUES[spec.dims[i] ?? ""] ?? []).includes(v)) return false;
  }
  return spec.details.includes(parts[parts.length - 1] ?? "");
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Depodan gelen her şeye güvenilmez: şemaya uymayan gün, hücre ya da değer atılır. */
export function parseCountsV2(raw: unknown): CountsV2 {
  const out: CountsV2 = { v: 2, days: {} };
  const days = (raw as { days?: unknown } | null)?.days;
  if (typeof days !== "object" || days === null) return out;
  for (const [day, rec] of Object.entries(days as Record<string, unknown>)) {
    if (!DAY_RE.test(day) || typeof rec !== "object" || rec === null) continue;
    const r = rec as { phase?: unknown; c?: unknown };
    const phase = schema.phases.includes(r.phase as string) ? (r.phase as Phase) : "karisik";
    const cells: Record<string, number> = {};
    if (typeof r.c === "object" && r.c !== null) {
      for (const [k, n] of Object.entries(r.c as Record<string, unknown>)) {
        if (isValidCellKey(k) && typeof n === "number" && Number.isInteger(n) && n > 0) cells[k] = n;
      }
    }
    if (Object.keys(cells).length > 0) out.days[day] = { phase, c: cells };
  }
  return out;
}

/** Dışa aktarılan sayaçların şemaya uygunluğu: hata listesi (boşsa geçerli). Python'daki validate_export ile aynı kurallar. */
export function validateExport(obj: unknown): string[] {
  const errors: string[] = [];
  const o = obj as Record<string, unknown> | null;
  if (typeof o !== "object" || o === null) return ["nesne değil"];
  if (o.schema !== schema.schema) errors.push("schema alanı yanlış");
  if (o.version !== schema.version) errors.push("version alanı yanlış");
  const allowedTop = new Set(["schema", "version", "exported", "days"]);
  for (const k of Object.keys(o)) if (!allowedTop.has(k)) errors.push(`izin verilmeyen alan: ${k}`);
  if (o.exported !== undefined && !(typeof o.exported === "string" && DAY_RE.test(o.exported))) {
    errors.push("exported alanı YYYY-MM-DD olmalı");
  }
  const days = o.days as Record<string, unknown> | undefined;
  if (typeof days !== "object" || days === null) return [...errors, "days alanı yok"];
  for (const [day, rec] of Object.entries(days)) {
    if (!DAY_RE.test(day)) errors.push(`geçersiz gün: ${day}`);
    const r = rec as { phase?: unknown; c?: unknown };
    if (!schema.phases.includes(r?.phase as string)) errors.push(`${day}: geçersiz faz`);
    for (const k of Object.keys(r ?? {})) if (k !== "phase" && k !== "c") errors.push(`${day}: izin verilmeyen alan ${k}`);
    for (const [k, n] of Object.entries((r?.c ?? {}) as Record<string, unknown>)) {
      if (!isValidCellKey(k)) errors.push(`${day}: geçersiz hücre ${k}`);
      if (!(typeof n === "number" && Number.isInteger(n) && n > 0)) errors.push(`${day}: geçersiz sayı ${k}`);
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Sürüm 1'den göç
// ---------------------------------------------------------------------------

/** v1'de boyut yoktu; göç edilen hücrelerde tüm boyutlar "na" olur. */
const V1_MAP: Record<string, [EventName, string] | null> = {
  stripShown: ["strip", "gosterildi"],
  stripSendAnyway: ["strip_action", "yine_de_gonder"],
  stripEdit: ["strip_action", "duzenle"],
  notRelevant: ["strip_action", "yerinde_degil"],
  freshStart: ["card_action", "taze_baslat"],
  shortBreak: ["card_action", "ara"],
  exitCardClosed: ["card_action", "kapat"],
  exitCardNever: ["card_action", "bir_daha_gosterme"],
  modelNotRelevant: ["card_action", "yerinde_degil"],
  stripWouldShow: ["strip", "gizlendi_sayim"],
  // Aşağıdakiler ayrıca hesaplanır (bkz. migrateV1)
  stripRepair: null,
  exitCardShown: null,
  modelCardShown: null,
  exitCardWouldShow: null,
  modelCardWouldShow: null,
  checkedSendsOn: null,
  similarSendsOn: null,
  checkedSendsOff: null,
  similarSendsOff: null,
};

export function migrateV1(v1: unknown): CountsV2 {
  const out: CountsV2 = { v: 2, days: {} };
  if (typeof v1 !== "object" || v1 === null) return out;
  for (const [day, row] of Object.entries(v1 as Record<string, unknown>)) {
    if (!DAY_RE.test(day) || typeof row !== "object" || row === null) continue;
    const n = (name: string) => {
      const v = (row as Record<string, unknown>)[name];
      return typeof v === "number" && Number.isInteger(v) && v > 0 ? v : 0;
    };
    const c: Record<string, number> = {};
    const add = (event: EventName, detail: string, value: number) => {
      const key = cellKey(event, {}, detail);
      if (key && value > 0) c[key] = (c[key] ?? 0) + value;
    };
    for (const [name, target] of Object.entries(V1_MAP)) if (target) add(target[0], target[1], n(name));
    // v1'de onarım düğmesinin türü tutulmuyordu: tür "na" olarak taşınır.
    add("repair_button", "na", n("stripRepair"));
    add("card", "gosterildi_model", n("modelCardShown"));
    add("card", "gosterildi_norm", Math.max(0, n("exitCardShown") - n("modelCardShown")));
    add("card", "gizlendi_sayim", n("exitCardWouldShow"));
    add("send", "benzer", n("similarSendsOn") + n("similarSendsOff"));
    add("send", "farkli", Math.max(0, n("checkedSendsOn") - n("similarSendsOn")) +
      Math.max(0, n("checkedSendsOff") - n("similarSendsOff")));
    const on = n("checkedSendsOn") + n("stripShown") + n("exitCardShown") > 0;
    const off = n("checkedSendsOff") + n("stripWouldShow") + n("exitCardWouldShow") > 0;
    const phase: Phase = on && off ? "karisik" : off ? "sayim" : "oneri";
    if (Object.keys(c).length > 0) out.days[day] = { phase, c };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Sohbet sonucu (Python: kafiai.counters.loop_outcome)
// ---------------------------------------------------------------------------

/**
 * Sohbetin sonucu: 2. mesajdan sonra en az 2 güçlü onarım ifadesi ya da 1 onarım ifadesi ile
 * 1 birebir yeniden gönderim varsa "dongu". Bölüm 8'deki ikinci sürüm etiketin eklentideki karşılığı;
 * benzerlik için eklentinin kendi hesabı kullanılır.
 */
export function loopOutcome(userTexts: string[]): "dongu" | "normal" {
  const later = userTexts.slice(1); // 2. mesaj ve sonrası (k = 2)
  let exact = 0;
  for (let i = 1; i < later.length; i++) {
    if (similarity(normalizeText(later[i - 1] ?? ""), normalizeText(later[i] ?? "")) >= EXACT_REPEAT_THRESHOLD) exact++;
  }
  const repairs = userTexts.slice(2).filter(hasStrongRepair).length;
  return repairs >= 2 || (repairs >= 1 && exact >= 1) ? "dongu" : "normal";
}

// ---------------------------------------------------------------------------
// Depolama: toplu ve gecikmeli yazma
// ---------------------------------------------------------------------------

export function pruneDays(counts: CountsV2, now: Date, retention = schema.retention_days): CountsV2 {
  const limit = new Date(now);
  limit.setDate(limit.getDate() - retention);
  const oldest = dayOf(limit);
  const days: Record<string, DayRecord> = {};
  for (const [d, rec] of Object.entries(counts.days)) if (d >= oldest) days[d] = rec;
  return { v: 2, days };
}

export interface CounterStoreOptions {
  /** Kayıtlar bu kadar ms birikip tek seferde yazılır. */
  flushDelayMs?: number;
  now?: () => Date;
}

export class CounterStore {
  private pending = new Map<string, { day: string; phase: Phase; n: number }>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private queue: Promise<void> = Promise.resolve();
  private readonly delay: number;
  private readonly now: () => Date;

  constructor(private readonly storage: KeyValueStorage, options: CounterStoreOptions = {}) {
    this.delay = options.flushDelayMs ?? 2000;
    this.now = options.now ?? (() => new Date());
  }

  /** Bir olayı sayar. Yazma hemen yapılmaz; kısa bir süre birikir. */
  record(event: EventName, dims: Dims, detail: string, phase: Phase): void {
    const key = cellKey(event, dims, detail);
    if (!key) return;
    const day = dayOf(this.now());
    const id = `${day}#${key}`;
    const prev = this.pending.get(id);
    this.pending.set(id, { day, phase: prev && prev.phase !== phase ? "karisik" : phase, n: (prev?.n ?? 0) + 1 });
    if (this.timer === null) this.timer = setTimeout(() => void this.flush(), this.delay);
  }

  /** Biriken kayıtları tek okuma-yazmada depoya işler. Hata eklentiyi bozmaz. */
  flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.pending.size === 0) return this.queue;
    const batch = this.pending;
    this.pending = new Map();
    const run = async () => {
      try {
        const counts = pruneDays(await this.load(), this.now());
        for (const [id, item] of batch) {
          const key = id.slice(id.indexOf("#") + 1);
          const rec = counts.days[item.day] ?? { phase: item.phase, c: {} };
          if (rec.phase !== item.phase) rec.phase = "karisik";
          rec.c[key] = (rec.c[key] ?? 0) + item.n;
          counts.days[item.day] = rec;
        }
        await this.storage.set({ [COUNTS_V2_KEY]: counts });
      } catch {
        /* sayaç tutulamadıysa kullanıcı etkilenmesin */
      }
    };
    this.queue = this.queue.then(run);
    return this.queue;
  }

  /** v2 sayaçlar; yoksa v1'den bir kez göç edilir ve v1 silinir. */
  async load(): Promise<CountsV2> {
    const stored = await this.storage.get([COUNTS_V2_KEY, COUNTS_V1_KEY]);
    if (stored[COUNTS_V2_KEY] !== undefined) return parseCountsV2(stored[COUNTS_V2_KEY]);
    if (stored[COUNTS_V1_KEY] !== undefined) {
      const migrated = migrateV1(stored[COUNTS_V1_KEY]);
      await this.storage.set({ [COUNTS_V2_KEY]: migrated });
      await this.storage.remove([COUNTS_V1_KEY]);
      return migrated;
    }
    return { v: 2, days: {} };
  }

  /** "Sayaçlarımı kopyala" çıktısı: sürüm numaralı, yalnızca günler ve sayılar. */
  async exportJson(): Promise<string> {
    await this.flush();
    const counts = await this.load();
    return JSON.stringify({ schema: schema.schema, version: schema.version, exported: dayOf(this.now()), days: counts.days }, null, 2);
  }
}

// ---------------------------------------------------------------------------
// Pencere özeti
// ---------------------------------------------------------------------------

export interface WeekTotals {
  stripShown: number;
  stripSendAnyway: number;
  repairs: number;
  cardShown: number;
  modelCardShown: number;
  freshStart: number;
}

/** Bugün dahil son `days` günün araç çubuğu penceresinde gösterilen toplamları. */
export function recentTotalsV2(counts: CountsV2, now: Date, days = 7): WeekTotals {
  const wanted = new Set<string>();
  for (let i = 0; i < days; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    wanted.add(dayOf(d));
  }
  const t: WeekTotals = { stripShown: 0, stripSendAnyway: 0, repairs: 0, cardShown: 0, modelCardShown: 0, freshStart: 0 };
  for (const [day, rec] of Object.entries(counts.days)) {
    if (!wanted.has(day)) continue;
    for (const [key, n] of Object.entries(rec.c)) {
      const parts = key.split("|");
      const event = parts[0];
      const detail = parts[parts.length - 1];
      if (event === "strip" && detail === "gosterildi") t.stripShown += n;
      else if (event === "strip_action" && detail === "yine_de_gonder") t.stripSendAnyway += n;
      else if (event === "repair_button") t.repairs += n;
      else if (event === "card" && detail?.startsWith("gosterildi")) {
        t.cardShown += n;
        if (detail === "gosterildi_model") t.modelCardShown += n;
      } else if (event === "card_action" && detail === "taze_baslat") t.freshStart += n;
    }
  }
  return t;
}
