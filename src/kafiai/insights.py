"""Haftalık içgörü: eklentideki src/core/insights.ts ile aynı hesap.

Pilotta katılımcıların kopyaladığı sayaç çıktısından (K18) her katılımcının penceresinde ne
gördüğünü yeniden üretmek için kullanılır. Eşikler `extension/src/data/insights-config.json`
dosyasında; iki tarafı `tests/fixtures/insights_parity.json` sınar.
"""

import json
from datetime import date, timedelta
from pathlib import Path

from kafiai.counters import SCHEMA

CONFIG = json.loads(
    (Path(__file__).resolve().parents[2] / "extension" / "src" / "data" / "insights-config.json").read_text(encoding="utf-8")
)
TASK_ORDER = SCHEMA["dimensions"]["task"]
SLOTS = SCHEMA["dimensions"]["slot"]


def window_days(today, n=None):
    d = date.fromisoformat(today)
    return [(d - timedelta(days=i)).isoformat() for i in range(n or CONFIG["window_days"])]


def _top_slot(by_slot):
    total = sum(by_slot.get(s, 0) for s in SLOTS)
    best, best_n = None, 0
    for s in SLOTS:
        if by_slot.get(s, 0) > best_n:
            best, best_n = s, by_slot[s]
    if total < CONFIG["min_pattern_loops"] or best is None:
        return None
    return best if best_n / total >= CONFIG["min_pattern_share"] else None


def _add(d, k, n):
    d[k] = d.get(k, 0) + n


def weekly_insights(days, today):
    """`days`: sayaç çıktısındaki days alanı; `today`: YYYY-MM-DD."""
    wanted = set(window_days(today))
    long_buckets = set(CONFIG["long_buckets"])
    conv, loops, long, platforms, slots_by_task, slots_all = {}, {}, {}, {}, {}, {}
    fresh = similar = 0
    for day, rec in days.items():
        if day not in wanted:
            continue
        for key, n in rec.get("c", {}).items():
            p = key.split("|")
            event, detail = p[0], p[-1]
            if event == "conversation":
                platform, task, length = (p[1:4] + ["na"] * 3)[:3]
                _add(conv, task, n)
                if detail == "dongu":
                    _add(loops, task, n)
                if length in long_buckets:
                    _add(long, task, n)
                _add(platforms.setdefault(task, {}), platform, n)
            elif event == "send" and detail == "benzer":
                slot, task = (p[2:4] + ["na"] * 2)[:2]
                similar += n
                _add(slots_all, slot, n)
                _add(slots_by_task.setdefault(task, {}), slot, n)
            elif event == "card_action" and detail == "taze_baslat":
                fresh += n

    def rank(t):
        return TASK_ORDER.index(t) if t in TASK_ORDER else len(TASK_ORDER)

    tasks = [
        {
            "task": task,
            "conversations": c,
            "loops": loops.get(task, 0),
            "long": long.get(task, 0),
            "top_slot": _top_slot(slots_by_task.get(task, {})),
            "platforms": [list(x) for x in sorted(platforms.get(task, {}).items(), key=lambda x: (-x[1], x[0]))],
            "enough": c >= CONFIG["min_task_conversations"],
        }
        for task, c in conv.items()
        if c > 0
    ]
    tasks.sort(key=lambda t: (-t["conversations"], -t["loops"], rank(t["task"])))
    total = sum(t["conversations"] for t in tasks)
    return {
        "days": CONFIG["window_days"],
        "conversations": total,
        "loops": sum(t["loops"] for t in tasks),
        "similar_sends": similar,
        "top_slot": _top_slot(slots_all),
        "fresh_starts": fresh,
        "enough": total >= CONFIG["min_conversations"],
        "tasks": tasks,
    }
