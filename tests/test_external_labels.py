"""Dış etiketlerle doğrulama betiğinin ayrıştırma ve ölçü kısımları (veri gerekmez; kayıtlar uydurma)."""

import importlib.util
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location("evaluate_external_labels", ROOT / "scripts" / "evaluate_external_labels.py")
ev = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ev)


def test_emowoz_both_shapes():
    dict_of_lists = {"dialogue_id": "a", "log": {"text": ["hi", "ok", "that is wrong again"], "emotion": [0, -1, 2]}}
    list_of_dicts = {"dialogue_id": "b", "log": [{"text": "hi", "emotion": [{"emotion": 0}]}, {"text": "sys", "emotion": -1}]}
    assert ev.emowoz_turns(dict_of_lists) == [("hi", 0), ("ok", -1), ("that is wrong again", 2)]
    assert ev.emowoz_turns(list_of_dicts) == [("hi", 0), ("sys", -1)]


def test_emowoz_evaluation_counts_only_user_turns():
    records = [
        {"dialogue_id": "1", "log": {"text": ["book a hotel", "sure", "still not working, try again", "sorry",
                                              "that's not what I asked"], "emotion": [0, -1, 2, -1, 2]}},
        {"dialogue_id": "2", "log": {"text": ["a train please", "done", "thanks"], "emotion": [0, -1, 6]}},
    ]
    r = ev.evaluate_emowoz(records)
    m = r["message_strong_repair"]
    assert r["dialogues"] == 2 and m["n"] == 5 and m["positives"] == 2
    assert m["precision"] == 1.0 and m["recall"] == 1.0


def test_chatbench_history_formats():
    as_list = [{"role": "user", "content": "q1"}, {"role": "assistant", "content": "a"}, {"role": "user", "content": "q2"}]
    assert ev.chatbench_user_messages(as_list) == ["q1", "q2"]
    import json
    assert ev.chatbench_user_messages(json.dumps(as_list)) == ["q1", "q2"]
    text = "User: what is x?\nmore detail\nAI: it is y\nUser: are you sure?"
    assert ev.chatbench_user_messages(text) == ["what is x?\nmore detail", "are you sure?"]
    assert ev.chatbench_user_messages(None) == []


def test_chatbench_evaluation():
    rng = np.random.default_rng(0)
    recs = [{"acc": 1, "model": "gpt-4o", "chat_history": [{"role": "user", "content": "solve this"}]}] * 6 + \
           [{"acc": 0, "model": "llama", "chat_history": [{"role": "user", "content": "solve this question"},
                                                          {"role": "user", "content": "that's wrong, try again"},
                                                          {"role": "user", "content": "still wrong, not what I asked"},
                                                          {"role": "user", "content": "no, try again"}]}] * 4
    r = ev.evaluate_chatbench(recs, rng)
    assert r["conversations"] == 10
    assert r["by_signal"]["single_message"]["rate"] == 0.0
    assert r["by_signal"]["any_strong_repair"]["rate"] == 1.0
    assert r["by_signal"]["loop_outcome_dongu"]["n"] == 4
    assert set(r["by_model"]) == {"gpt-4o", "llama"}


def test_binary_report():
    r = ev.binary_report([1, 1, 0, 0], [1, 0, 1, 0])
    assert r["precision"] == 0.5 and r["recall"] == 0.5 and r["lift"] == 1.0
