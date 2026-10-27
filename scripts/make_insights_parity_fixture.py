"""tests/fixtures/insights_parity.json dosyasını üretir: rastgele sayaç günleri ve Python'daki
haftalık içgörü sonucu. Eklentideki insights.test.ts aynı girdiden aynı sonucu bekler."""

import json
import random
import sys
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from kafiai.counters import SCHEMA, is_valid_cell_key  # noqa: E402
from kafiai.insights import weekly_insights  # noqa: E402

D = SCHEMA["dimensions"]


def random_days(rng, today, n_days, per_day):
    days = {}
    for i in range(n_days):
        day = (date.fromisoformat(today) - timedelta(days=i)).isoformat()
        c = {}
        for _ in range(per_day):
            kind = rng.random()
            if kind < 0.4:
                key = "|".join(["conversation", rng.choice(D["platform"][:3]), rng.choice(D["task"]), rng.choice(D["len"]),
                                rng.choice(D["first_len"]), rng.choice(["dongu", "normal", "normal"])])
            elif kind < 0.8:
                key = "|".join(["send", rng.choice(D["platform"][:3]), rng.choice(D["slot"][2:] if rng.random() < 0.7 else D["slot"]),
                                rng.choice(D["task"]), rng.choice(D["len"]), rng.choice(["benzer", "farkli"])])
            elif kind < 0.9:
                key = "card_action|chatgpt|taze_baslat"
            else:
                key = "strip|gemini|kod|gosterildi"
            assert is_valid_cell_key(key), key
            c[key] = c.get(key, 0) + rng.randint(1, 3)
        days[day] = {"phase": "oneri", "c": c}
    return days


def main():
    rng = random.Random(7)
    cases = []
    today = "2026-10-26"
    for n_days, per_day in [(0, 0), (2, 1), (5, 4), (10, 8), (14, 20), (3, 30)]:
        days = random_days(rng, today, n_days, per_day)
        cases.append({"today": today, "days": days, "expected": weekly_insights(days, today)})
    # ay ve yıl geçişi
    days = random_days(rng, "2027-01-02", 9, 10)
    cases.append({"today": "2027-01-02", "days": days, "expected": weekly_insights(days, "2027-01-02")})
    out = ROOT / "tests" / "fixtures" / "insights_parity.json"
    out.write_text(json.dumps(cases, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"{len(cases)} örnek yazıldı: {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
