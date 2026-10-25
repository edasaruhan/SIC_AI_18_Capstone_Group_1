"""Ham veriyle çalışan kontroller. Veri yoksa atlanır (bkz. conftest.py)."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from kafiai.data import clean_conversations, load_source  # noqa: E402


@pytest.mark.requires_data("wildchat_sample_50000.pkl")
def test_cleaning_steps_never_add_rows():
    df = load_source("1m")
    clean, steps = clean_conversations(df)
    counts = list(steps.values())
    assert counts == sorted(counts, reverse=True)
    assert counts[-1] == len(clean)
    assert clean["conversation_hash"].is_unique


@pytest.mark.requires_data("wildchat48_multiturn.parquet", "wildchat48_sample.parquet")
def test_48m_training_table_has_only_multiturn_conversations():
    clean, _ = clean_conversations(load_source("48m"), template_reference=load_source("48m_sample"))
    assert (clean["n_user_msgs"] >= 4).all()
    assert clean["user_msgs"].apply(lambda m: all(str(x).strip() for x in m[:2])).all()
