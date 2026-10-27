import config from "../data/insights-config.json";
import schema from "../data/counter-schema.json";
import { dayOf, type CountsV2 } from "./counters";

/**
 * Haftalık içgörü: sayaçlardan (K18) son günlerin özetini çıkarır. Yalnızca sayılar okunur;
 * sonuç da yalnızca sayılar ve sabit sözcüklerdir (görev, saat dilimi, platform). Metinler
 * popup tarafında bu yapıdan üretilir. Python'daki kafiai.insights.weekly_insights ile aynı
 * sonucu verir (tests/fixtures/insights_parity.json). Eşikler src/data/insights-config.json içinde.
 */

export interface TaskInsight {
  task: string;
  conversations: number;
  loops: number;
  /** Uzun süren sohbetler (config.long_buckets) */
  long: number;
  /** Benzer mesajların yoğunlaştığı saat dilimi; yeterli veri yoksa null */
  top_slot: string | null;
  /** Platform ve sohbet sayısı, çoktan aza */
  platforms: [string, number][];
  /** Bu görev için ayrıntı söylemeye yetecek kadar sohbet var mı? */
  enough: boolean;
}

export interface WeeklyInsights {
  days: number;
  conversations: number;
  loops: number;
  similar_sends: number;
  top_slot: string | null;
  fresh_starts: number;
  enough: boolean;
  tasks: TaskInsight[];
}

const TASK_ORDER: string[] = schema.dimensions.task;
const SLOTS: string[] = schema.dimensions.slot;

/** Bugün dahil son `n` günün tarihleri (yerel saat). */
export function windowDays(now: Date, n = config.window_days): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i, 12);
    out.push(dayOf(d));
  }
  return out;
}

function topSlot(bySlot: Map<string, number>): string | null {
  let total = 0;
  let best: string | null = null;
  let bestN = 0;
  for (const slot of SLOTS) {
    const n = bySlot.get(slot) ?? 0;
    total += n;
    if (n > bestN) {
      best = slot;
      bestN = n;
    }
  }
  if (total < config.min_pattern_loops || best === null) return null;
  return bestN / total >= config.min_pattern_share ? best : null;
}

const add = (m: Map<string, number>, k: string, n: number) => m.set(k, (m.get(k) ?? 0) + n);

export function weeklyInsights(counts: CountsV2, now: Date): WeeklyInsights {
  const wanted = new Set(windowDays(now));
  const longBuckets = new Set(config.long_buckets);
  const conv = new Map<string, number>();
  const loops = new Map<string, number>();
  const long = new Map<string, number>();
  const platforms = new Map<string, Map<string, number>>();
  const slotsByTask = new Map<string, Map<string, number>>();
  const slotsAll = new Map<string, number>();
  let freshStarts = 0;
  let similar = 0;

  for (const [day, rec] of Object.entries(counts.days)) {
    if (!wanted.has(day)) continue;
    for (const [key, n] of Object.entries(rec.c)) {
      const p = key.split("|");
      const event = p[0];
      const detail = p[p.length - 1] ?? "";
      if (event === "conversation") {
        // conversation|platform|task|len|first_len|sonuç
        const [platform = "na", task = "na", len = "na"] = p.slice(1, 4);
        add(conv, task, n);
        if (detail === "dongu") add(loops, task, n);
        if (longBuckets.has(len)) add(long, task, n);
        if (!platforms.has(task)) platforms.set(task, new Map());
        add(platforms.get(task)!, platform, n);
      } else if (event === "send" && detail === "benzer") {
        // send|platform|slot|task|len|ayrıntı
        const [, slot = "na", task = "na"] = p.slice(1, 4);
        similar += n;
        add(slotsAll, slot, n);
        if (!slotsByTask.has(task)) slotsByTask.set(task, new Map());
        add(slotsByTask.get(task)!, slot, n);
      } else if (event === "card_action" && detail === "taze_baslat") {
        freshStarts += n;
      }
    }
  }

  const rank = (t: string) => {
    const i = TASK_ORDER.indexOf(t);
    return i === -1 ? TASK_ORDER.length : i;
  };
  const tasks: TaskInsight[] = [...conv.entries()]
    .filter(([, c]) => c > 0)
    .map(([task, c]) => ({
      task,
      conversations: c,
      loops: loops.get(task) ?? 0,
      long: long.get(task) ?? 0,
      top_slot: topSlot(slotsByTask.get(task) ?? new Map()),
      platforms: [...(platforms.get(task) ?? new Map()).entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)),
      enough: c >= config.min_task_conversations,
    }))
    .sort((a, b) => b.conversations - a.conversations || b.loops - a.loops || rank(a.task) - rank(b.task));

  const total = tasks.reduce((s, t) => s + t.conversations, 0);
  return {
    days: config.window_days,
    conversations: total,
    loops: tasks.reduce((s, t) => s + t.loops, 0),
    similar_sends: similar,
    top_slot: topSlot(slotsAll),
    fresh_starts: freshStarts,
    enough: total >= config.min_conversations,
    tasks,
  };
}
