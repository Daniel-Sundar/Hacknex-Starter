"""Key rotation (llm.with_keys). No network: fn is a fake that fails per key.

Run from backend/:  python -m pytest tests/test_keys.py -q
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import llm  # noqa: E402


class Err(Exception):
    def __init__(self, status: int, msg: str = ""):
        super().__init__(msg or f"HTTP {status}")
        self.status_code = status


@pytest.fixture(autouse=True)
def clean(monkeypatch):
    for v in ("GEMINI_API_KEY", "GEMINI_API_KEYS"):
        monkeypatch.delenv(v, raising=False)
    llm._key_cool.clear()
    llm._key_err.clear()
    yield
    llm._key_cool.clear()
    llm._key_err.clear()


def run(fail: dict[str, Exception]):
    """Calls with_keys; fn fails with fail[key] if the key is listed, else answers with the key it got."""
    used = []

    def fn(client, model):
        key = client.api_key
        used.append(key)
        if key in fail:
            raise fail[key]
        return key

    return llm.with_keys("gemini", "m", fn), used


def test_single_key_still_works(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "one")
    assert run({}) == ("one", ["one"])


def test_keys_list_single_first_no_duplicates(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "a")
    monkeypatch.setenv("GEMINI_API_KEYS", " b ,a,,c")
    assert llm.keys("gemini") == ["a", "b", "c"]


def test_daily_quota_moves_to_next_key_and_rests_it(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEYS", "a,b")
    out, used = run({"a": Err(429, "Quota exceeded: GenerateRequestsPerDayPerProjectPerModel")})
    assert (out, used) == ("b", ["a", "b"])
    out, used = run({})  # key a is resting: not even tried
    assert (out, used) == ("b", ["b"])


def test_per_minute_limit_moves_on_without_resting(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEYS", "a,b")
    assert run({"a": Err(429, "rate limit per minute")}) == ("b", ["a", "b"])
    assert run({}) == ("a", ["a"])  # a was not rested


def test_bad_key_is_skipped(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEYS", "a,b")
    assert run({"a": Err(403, "API key not valid")}) == ("b", ["a", "b"])


def test_overload_is_not_a_key_problem(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEYS", "a,b")
    with pytest.raises(Err) as e:
        run({"a": Err(503, "overloaded")})
    assert e.value.status_code == 503


def test_all_keys_out_raises_last_error_with_status(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEYS", "a,b")
    day = "Quota exceeded per day"
    with pytest.raises(Err) as e:
        run({"a": Err(429, day), "b": Err(429, day)})
    assert e.value.status_code == 429 and "per day" in str(e.value)
    with pytest.raises(Err):  # both resting: fails fast with the stored error, no calls made
        out = run({})
        assert out[1] == []


def test_no_key_message(monkeypatch):
    with pytest.raises(RuntimeError, match="GEMINI_API_KEY is not set"):
        run({})


def test_error_never_contains_the_key(monkeypatch, capsys):
    monkeypatch.setenv("GEMINI_API_KEYS", "secretAAAA,secretBBBB")
    run({"secretAAAA": Err(429, "Quota exceeded per day")})
    assert "secret" not in capsys.readouterr().out
