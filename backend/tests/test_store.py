import httpx

from app import handwriting, store


def _fake(monkeypatch, db):
    def handler(req: httpx.Request):
        table = req.url.path.rsplit("/", 1)[-1]
        if req.method == "POST":
            import json
            row = json.loads(req.content)
            db.setdefault(table, []).append(row)
            return httpx.Response(201)
        rows = db.get(table, [])
        for k, v in req.url.params.items():
            if v.startswith("eq."):
                rows = [r for r in rows if str(r.get(k)) == v[3:]]
        return httpx.Response(200, json=rows)
    monkeypatch.setenv("SUPABASE_URL", "https://x.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_KEY", "test")
    monkeypatch.setattr(store, "_client", httpx.Client(transport=httpx.MockTransport(handler)))


def test_off_without_env(monkeypatch):
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    assert store.cache_get("k") is None and store.writer_words("w") == []


def test_cache_and_writer_roundtrip(monkeypatch, tmp_path):
    db = {}
    _fake(monkeypatch, db)
    monkeypatch.setattr(handwriting, "CACHE", tmp_path / "c")
    monkeypatch.setattr(handwriting, "WRITERS", tmp_path / "w")
    calls = []
    assert handwriting._cached(["read", "x"], lambda: calls.append(1) or "hello") == "hello"
    assert db["readings_cache"][0]["value"] == "hello"
    for f in (tmp_path / "c").iterdir():
        f.unlink()  # server restarted: local cache gone
    assert handwriting._cached(["read", "x"], lambda: calls.append(1) or "other") == "hello"
    assert calls == [1]
    handwriting.save_answer("Dr-Test", "Amlodipme", "Amlodipine")
    (tmp_path / "w" / "dr-test.json").unlink()
    assert handwriting.writer_words("Dr-Test") == ["Amlodipine"]


def test_db_down_never_breaks(monkeypatch, tmp_path):
    monkeypatch.setenv("SUPABASE_URL", "https://x.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_KEY", "test")
    monkeypatch.setattr(store, "_client", httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(500))))
    monkeypatch.setattr(handwriting, "CACHE", tmp_path)
    assert handwriting._cached(["read", "y"], lambda: "ok") == "ok"
