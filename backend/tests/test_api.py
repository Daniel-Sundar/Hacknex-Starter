"""API tests for ClearScript. No network: vision readers, the context LLM and the docs LLM are faked.

Run from backend/:  python -m pytest tests -q
"""
import json
import socket
import sys
import threading
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import handwriting, llm, main, rag, rx_safety  # noqa: E402  (main first: it sets the OpenCV pixel limit)

import cv2  # noqa: E402
import numpy as np  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

READERS = "fake:a,fake:b|fake:b2,fake:c"  # slot 1 has a spare (b2)

NOTE = {
    "a": "Dear John\nthanks for the letter",
    "b": "Dear Jon\nthanks for the letter",
    "b2": "Dear Jon\nthanks for the letter",
    "c": "Dear John\nthanks for letter",
}
RX = {
    "a": "Rx\nTab Amlodipine 5 mg OD\nTab Metformin 500 mg BD",
    "b": "Rx\nTab Amlodipine 5 mg OD\nTab Metformin 850 mg BD",
    "b2": "Rx\nTab Amlodipine 5 mg OD\nTab Metformin 850 mg BD",
    "c": "Rx\nTab Amlodipine 5 mg OD x 30 days\nTab Metformin 500 mg BD",
}


class FakeReaders:
    """Stands in for handwriting.read_one."""

    def __init__(self):
        self.texts = dict(NOTE)
        self.fail: set[str] = set()  # model names that raise; "*" = all
        self.delay: dict[str, float] = {}
        self.baseline = "Dear Jhon\nthanks for the letter"
        self.baseline_fail = False
        self.calls = 0

    def __call__(self, data, provider, model, prompt=handwriting.READ_PROMPT):
        if prompt == handwriting.BASELINE_PROMPT:
            if self.baseline_fail:
                raise RuntimeError("baseline model is down")
            return self.baseline
        self.calls += 1
        time.sleep(self.delay.get(model, 0))
        if model in self.fail or "*" in self.fail:
            raise RuntimeError(f"{model} is down")
        return self.texts[model]


@pytest.fixture(autouse=True)
def fake(monkeypatch, tmp_path):
    monkeypatch.setenv("HW_READERS", READERS)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setenv("RATE_LIMIT_OFF", "1")
    monkeypatch.setenv("TRUST_PROXY", "0")
    for name in ("MAX_UPLOAD_MB", "DOCS_MAX_UPLOAD_MB", "HW_MAX_CONCURRENT", "RATE_LIMIT_DIGITIZE"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(handwriting, "CACHE", tmp_path / "cache")  # never touch the real model cache
    monkeypatch.setattr(handwriting, "WRITERS", tmp_path / "writers")
    monkeypatch.setattr(handwriting, "REREAD_MODE", "off")
    monkeypatch.setattr(handwriting, "_exhausted", {})
    monkeypatch.setattr(llm, "complete_json", lambda prompt, system=None: {})
    monkeypatch.setattr(llm, "chat", lambda messages, tools=None, **kw: {
        "role": "assistant", "content": "Twice a day [1].", "tool_calls": None})
    monkeypatch.setattr(main, "_jobs", 0)
    main._hits.clear()
    rag.clear()
    f = FakeReaders()
    monkeypatch.setattr(handwriting, "read_one", f)
    yield f
    rag.clear()


@pytest.fixture
def client():
    return TestClient(main.app)


# ---------- test files ----------

def _page() -> np.ndarray:
    img = np.full((120, 360, 3), 255, np.uint8)
    cv2.putText(img, "Dear John", (10, 70), cv2.FONT_HERSHEY_SIMPLEX, 1.4, (20, 20, 20), 3)
    return img


PNG = cv2.imencode(".png", _page())[1].tobytes()
JPEG = cv2.imencode(".jpg", _page())[1].tobytes()
HEIC = b"\x00\x00\x00\x18ftypheic\x00\x00\x00\x00mif1heic" + b"\x00" * 64
GIF = b"GIF89a" + b"\x00" * 64
BROKEN_PNG = b"\x89PNG\r\n\x1a\n" + b"not really an image" * 10


def make_pdf(content: bytes = b"", jpeg: bytes | None = None) -> bytes:
    """A one-page PDF with a text content stream and/or a scanned JPEG."""
    resources = b"<< /Font << /F1 5 0 R >>" + (b" /XObject << /Im0 6 0 R >>" if jpeg else b"") + b" >>"
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 360 120] /Resources " + resources + b" /Contents 4 0 R >>",
        b"<< /Length %d >>\nstream\n" % len(content) + content + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    if jpeg:
        h, w = _page().shape[:2]
        objs.append(b"<< /Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace /DeviceRGB "
                    b"/BitsPerComponent 8 /Filter /DCTDecode /Length %d >>\nstream\n" % (w, h, len(jpeg))
                    + jpeg + b"\nendstream")
    out, offsets = b"%PDF-1.4\n", []
    for i, o in enumerate(objs, 1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % i + o + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1)
    out += b"".join(b"%010d 00000 n \n" % off for off in offsets)
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, xref)
    return out


SCANNED_PDF = make_pdf(b"q 360 0 0 120 0 0 cm /Im0 Do Q", jpeg=JPEG)
TEXT_PDF = make_pdf(b"BT /F1 12 Tf 10 60 Td (Paracetamol 500 mg is taken twice a day) Tj ET")
EMPTY_PDF = make_pdf(b"")


def post_image(client, data: bytes, path="/api/handwriting", name="page.png", **form):
    fields = {"clean": "true", "vote": "true", "context": "true", "baseline": "false"}
    fields.update({k: str(v).lower() for k, v in form.items()})
    return client.post(path, files={"file": (name, data, "application/octet-stream")}, data=fields)


def stream_events(client, data: bytes, **form) -> list[dict]:
    fields = {"clean": "true", "vote": "true", "context": "true", "baseline": "false"}
    fields.update({k: str(v).lower() for k, v in form.items()})
    with client.stream("POST", "/api/handwriting/stream", files={"file": ("p.png", data, "image/png")},
                       data=fields) as r:
        assert r.status_code == 200, r.read()
        assert r.headers["content-type"].startswith("application/x-ndjson")
        assert r.headers["cache-control"] == "no-cache"
        assert r.headers["x-accel-buffering"] == "no"
        return [json.loads(line) for line in r.iter_lines() if line.strip()]


def detail(r) -> dict:
    d = r.json()["detail"]
    assert isinstance(d, dict) and {"code", "message"} <= set(d), d
    return d


# ---------- health ----------

def test_health_lists_readers_and_limits(client, monkeypatch):
    monkeypatch.setenv("MAX_UPLOAD_MB", "12")
    r = client.get("/api/health").json()
    assert r["ok"] is True and "provider" in r and r["docs"] == 0
    assert r["readers"] == ["fake:a", "fake:b", "fake:c"]
    assert r["limits"] == {"max_upload_mb": 12, "docs_max_upload_mb": 10}


# ---------- upload validation ----------

@pytest.mark.parametrize("path", ["/api/handwriting", "/api/handwriting/stream"])
def test_empty_file(client, path):
    r = post_image(client, b"", path=path)
    assert r.status_code == 400 and detail(r)["code"] == "empty_file"


@pytest.mark.parametrize("path", ["/api/handwriting", "/api/handwriting/stream"])
def test_too_large(client, monkeypatch, path):
    monkeypatch.setenv("MAX_UPLOAD_MB", "0.001")  # ~1 KB
    r = post_image(client, PNG + b"\x00" * 2000, path=path)
    assert r.status_code == 413
    d = detail(r)
    assert d["code"] == "too_large" and d["max_mb"] == 0.001


@pytest.mark.parametrize("data,name", [(PNG, "a.png"), (JPEG, "photo.jpg"), (SCANNED_PDF, "scan.pdf"),
                                       (PNG, "wrong-extension.heic")])
def test_supported_types_accepted(client, data, name):
    r = post_image(client, data, name=name)
    assert r.status_code == 200, r.text
    assert r.json()["text"].startswith("Dear")


def test_type_is_sniffed_not_taken_from_name(client):
    assert main.file_kind(PNG) == "png" and main.file_kind(JPEG) == "jpeg"
    assert main.file_kind(SCANNED_PDF) == "pdf" and main.file_kind(b"RIFF\x00\x00\x00\x00WEBPVP8 ") == "webp"
    assert main.file_kind(HEIC) == "heic" and main.file_kind(GIF) is None


@pytest.mark.parametrize("path", ["/api/handwriting", "/api/handwriting/stream"])
def test_heic_rejected_with_specific_message(client, path):
    r = client.post(path, files={"file": ("IMG_0001.jpg", HEIC, "image/jpeg")})
    assert r.status_code == 415
    d = detail(r)
    assert d["code"] == "heic_unsupported" and "JPG" in d["message"]


@pytest.mark.parametrize("path", ["/api/handwriting", "/api/handwriting/stream"])
def test_gif_rejected(client, path):
    r = client.post(path, files={"file": ("x.png", GIF, "image/png")})
    assert r.status_code == 415 and detail(r)["code"] == "unsupported_type"


def test_bad_image_is_422(client):
    r = post_image(client, BROKEN_PNG)
    assert r.status_code == 422 and detail(r)["code"] == "bad_image"


def test_bad_image_stream_error_event(client):
    events = stream_events(client, BROKEN_PNG)
    assert events[-1]["type"] == "error" and events[-1]["code"] == "bad_image"
    assert [e["type"] for e in events].count("error") == 1
    assert {"type": "stage", "stage": "prepare", "status": "start"} in events
    assert main._jobs == 0


def test_decompression_bomb_is_422(client):
    bomb = cv2.imencode(".png", np.zeros((8200, 8200), np.uint8))[1].tobytes()  # 67 MP, tiny file
    assert len(bomb) < 1_000_000
    r = post_image(client, bomb)
    assert r.status_code == 422 and detail(r)["code"] == "bad_image"


def test_input_error_is_a_runtime_error():
    assert issubclass(handwriting.InputError, RuntimeError)
    with pytest.raises(handwriting.InputError):
        handwriting.prepare(BROKEN_PNG)
    with pytest.raises(handwriting.InputError):
        handwriting.prepare(EMPTY_PDF)  # no scanned image on page 1
    with pytest.raises(handwriting.InputError):
        handwriting.prepare(b"%PDF-1.4 garbage")


# ---------- rate limit and busy ----------

def test_rate_limit_429_with_retry_after(client, monkeypatch):
    monkeypatch.delenv("RATE_LIMIT_OFF")
    monkeypatch.setenv("RATE_LIMIT_DIGITIZE", "2/60")
    assert post_image(client, PNG).status_code == 200
    assert post_image(client, PNG, path="/api/handwriting/stream").status_code == 200  # same bucket
    r = post_image(client, PNG)
    assert r.status_code == 429
    d = detail(r)
    assert d["code"] == "rate_limited" and 1 <= d["retry_after"] <= 60
    assert r.headers["retry-after"] == str(d["retry_after"])
    assert f"Try again in {d['retry_after']} seconds." in d["message"]
    # other buckets are separate
    assert client.post("/api/handwriting/answer", json={"writer": "w", "answer": "John"}).status_code == 200


def test_rate_limit_off(client, monkeypatch):
    monkeypatch.setenv("RATE_LIMIT_DIGITIZE", "1/60")
    for _ in range(3):
        assert post_image(client, PNG).status_code == 200


def test_busy_503(client, monkeypatch):
    monkeypatch.setenv("HW_MAX_CONCURRENT", "0")
    for path in ("/api/handwriting", "/api/handwriting/stream"):
        r = post_image(client, PNG, path=path)
        assert r.status_code == 503
        d = detail(r)
        assert d["code"] == "busy" and d["retry_after"] == 10 and r.headers["retry-after"] == "10"


# ---------- stream ----------

def _check_order(events: list[dict], safety: str):
    """plan -> prepare -> clean -> read (reader events inside) -> vote -> context -> safety -> result."""
    assert events[0]["type"] == "plan"
    assert events[0] == {"type": "plan", "readers": ["fake:a", "fake:b", "fake:c"],
                         "vote": True, "clean": True, "context": True}
    stages = [(e["stage"], e["status"]) for e in events if e["type"] == "stage"]
    assert stages == [("prepare", "start"), ("prepare", "done"), ("clean", "start"), ("clean", "done"),
                      ("read", "start"), ("read", "done"), ("vote", "start"), ("vote", "done"),
                      ("context", "start"), ("context", "done")] + (
        [("safety", "start"), ("safety", "done")] if safety == "done" else [("safety", "skipped")])
    i_start = events.index({"type": "stage", "stage": "read", "status": "start"})
    i_done = next(i for i, e in enumerate(events) if e.get("stage") == "read" and e["status"] == "done")
    readers = [i for i, e in enumerate(events) if e["type"] == "reader"]
    assert readers and all(i_start < i < i_done for i in readers)
    for slot in range(3):
        mine = [e for e in events if e["type"] == "reader" and e["slot"] == slot]
        assert mine[0]["status"] == "start" and mine[-1]["status"] == "done"
        assert isinstance(mine[-1]["ms"], int)
    assert events[-1]["type"] == "result"
    assert sum(e["type"] in ("result", "error") for e in events) == 1


def test_stream_order_and_same_result_as_plain(client):
    events = stream_events(client, PNG)
    _check_order(events, safety="skipped")
    read_done = next(e for e in events if e.get("stage") == "read" and e["status"] == "done")
    assert read_done["answered"] == 3 and read_done["failed"] == 0
    vote_done = next(e for e in events if e.get("stage") == "vote" and e["status"] == "done")
    assert vote_done["doc_type"] == "note"
    plain = post_image(client, PNG).json()
    assert events[-1]["result"] == plain
    assert main._jobs == 0


def test_stream_prescription_runs_safety(client, fake):
    fake.texts = dict(RX)
    events = stream_events(client, PNG)
    _check_order(events, safety="done")
    result = events[-1]["result"]
    assert result["doc_type"] == "prescription"
    aml = next(w for w in result["words"] if w["text"] == "Amlodipine")
    assert aml["flagged"] and "amiloride" in aml["lookalikes"]  # look-alike drug flagged although all agree
    assert result == post_image(client, PNG).json()


def test_stream_switches_off_stages(client):
    events = stream_events(client, PNG, clean=False, vote=False, context=False)
    assert events[0] == {"type": "plan", "readers": ["fake:a"], "vote": False, "clean": False, "context": False}
    stages = [(e["stage"], e["status"]) for e in events if e["type"] == "stage"]
    assert ("clean", "skipped") in stages and ("context", "skipped") in stages
    assert [e["slot"] for e in events if e["type"] == "reader"] == [0, 0]
    assert events[-1]["result"]["readings"] == {"fake:a": NOTE["a"]}


def test_one_reader_failing_gives_partial_result(client, fake):
    fake.fail = {"c"}
    events = stream_events(client, PNG)
    failed = [e for e in events if e["type"] == "reader" and e["status"] == "failed"]
    assert len(failed) == 1 and failed[0]["slot"] == 2 and failed[0]["model"] == "fake:c"
    assert "c is down" in failed[0]["error"]
    read_done = next(e for e in events if e.get("stage") == "read" and e["status"] == "done")
    assert read_done["answered"] == 2 and read_done["failed"] == 1
    result = events[-1]["result"]
    assert set(result["readings"]) == {"fake:a", "fake:b"} and "fake:c" in result["errors"]
    plain = post_image(client, PNG).json()
    assert plain == result


def test_spare_model_stands_in(client, fake):
    fake.fail = {"b"}
    events = stream_events(client, PNG)
    slot1 = [(e["model"], e["status"]) for e in events if e["type"] == "reader" and e["slot"] == 1]
    assert slot1 == [("fake:b", "start"), ("fake:b2", "start"), ("fake:b2", "done")]
    assert "fake:b2" in events[-1]["result"]["readings"]


def test_all_readers_failing(client, fake):
    fake.fail = {"*"}
    events = stream_events(client, PNG)
    assert events[-1]["type"] == "error" and events[-1]["code"] == "all_models_failed"
    assert events[-1]["message"]
    assert len([e for e in events if e["type"] == "reader" and e["status"] == "failed"]) == 3
    assert main._jobs == 0
    r = post_image(client, PNG)
    assert r.status_code == 502 and detail(r)["code"] == "all_models_failed"
    r = post_image(client, PNG, vote=False)
    assert r.status_code == 502 and detail(r)["code"] == "all_models_failed"


def test_baseline_events_and_failure_keeps_result(client, fake):
    events = stream_events(client, PNG, baseline=True)
    base = [e["status"] for e in events if e.get("stage") == "baseline"]
    assert base == ["start", "done"]
    assert events[0]["type"] == "plan"
    assert events[-1]["result"]["baseline"] == fake.baseline
    fake.baseline_fail = True
    events = stream_events(client, PNG, baseline=True)
    assert [e["status"] for e in events if e.get("stage") == "baseline"] == ["start", "failed"]
    result = events[-1]["result"]
    assert result["baseline"] == "" and "baseline model is down" in result["errors"]["baseline"]
    assert result["text"].startswith("Dear")
    plain = post_image(client, PNG, baseline=True).json()
    assert plain == result


def test_ping_when_quiet(client, fake, monkeypatch):
    monkeypatch.setattr(main, "PING_EVERY", 0.05)
    fake.delay = {"a": 0.4, "b": 0.4, "c": 0.4}
    events = stream_events(client, PNG)
    assert {"type": "ping"} in events and events[-1]["type"] == "result"


# ---------- pipeline progress (direct) ----------

def test_timeout_event_and_no_late_events(fake, monkeypatch):
    monkeypatch.setattr(handwriting, "VOTE_DEADLINE", 0.3)
    fake.delay = {"c": 1.0}
    events: list[dict] = []
    result = handwriting.digitize(PNG, progress=events.append)
    slot2 = [e["status"] for e in events if e["type"] == "reader" and e["slot"] == 2]
    assert slot2 == ["start", "timeout"]
    assert "fake:c" in result["errors"] and "no answer within" in result["errors"]["fake:c"]
    n = len(events)
    time.sleep(1.0)  # the slow voter finishes in the background: its "done" must not leak out
    assert len(events) == n


def test_broken_progress_callback_never_breaks_pipeline():
    def boom(event):
        raise ValueError("bad callback")
    plain = handwriting.digitize(PNG)
    assert handwriting.digitize(PNG, progress=boom) == plain


# ---------- by_model ----------

def test_by_model_columns_and_gaps():
    readings = {
        "a": "Tab Dolo OD",           # pivot (ties go to the first reader): skipped "650 mg"
        "b": "Tab Dolo 650 mg OD",
        "c": "Tab Dolo 650 mg OD",
        "d": "Tab Dolo OD",
    }
    words = handwriting.vote(readings)
    by = {w["text"]: w["by_model"] for w in words}
    assert by["Tab"] == {"a": "Tab", "b": "Tab", "c": "Tab", "d": "Tab"}
    assert by["650"] == {"a": None, "b": "650", "c": "650", "d": None}
    assert by["mg"] == {"a": None, "b": "mg", "c": "mg", "d": None}

    words = handwriting.vote({"a": "alpha beta gamma zeta", "b": "alpha beta delta epsilon",
                              "c": "alpha beta gamma epsilon"})  # pivot is c, not the first reader
    by = {w["text"]: w["by_model"] for w in words}
    assert by["gamma"] == {"a": "gamma", "b": "delta", "c": "gamma"}
    assert by["epsilon"] == {"a": "zeta", "b": "epsilon", "c": "epsilon"}

    words = handwriting.vote({"a": "go [?] now\nbye", "b": "go [?] now\nbye", "c": "go now\nbye"})
    unread = next(w for w in words if w["text"] == "[?]")
    assert unread["by_model"] == {"a": "[?]", "b": "[?]", "c": None}
    assert all("by_model" not in w for w in words if w["text"] == "\n")

    words = handwriting.vote({"solo": "one two"})
    assert [w["by_model"] for w in words] == [{"solo": "one"}, {"solo": "two"}]


def test_by_model_in_api_result_and_kept_by_later_stages(client, fake):
    fake.texts = dict(RX)
    result = post_image(client, PNG).json()
    names = set(result["readings"])
    for w in result["words"]:
        if w["text"] == "\n":
            assert "by_model" not in w
            continue
        assert set(w["by_model"]) == names
    metformin_dose = next(w for w in result["words"] if w["text"] in ("500", "850"))
    assert metformin_dose["by_model"] == {"fake:a": "500", "fake:b": "850", "fake:c": "500"}
    assert metformin_dose["flagged"]
    # context_fix / lasa_flags copy word dicts: by_model survives
    after = handwriting.context_fix(result["words"], ["Amlodipine"], "prescription")
    assert all("by_model" in w for w in rx_safety.lasa_flags(after) if w["text"] != "\n")


# ---------- other handwriting routes ----------

def test_answer_and_recontext_errors_are_dicts(client):
    r = client.post("/api/handwriting/answer", json={"writer": "w", "answer": "   "})
    assert r.status_code == 400 and detail(r)["code"] == "bad_request"
    r = client.post("/api/handwriting/recontext", json={"words": [], "writer": "w"})
    assert r.status_code == 200 and r.json() == {"words": []}


def test_table_llm_failure_is_502_dict(client, monkeypatch):
    def down(prompt, system=None):
        raise RuntimeError("All LLM providers failed")
    monkeypatch.setattr(llm, "complete_json", down)
    r = client.post("/api/handwriting/table", json={"marked": "Tab Dolo 650 mg"})
    assert r.status_code == 502 and detail(r)["code"] == "all_models_failed"


# ---------- live server: client disconnect ----------

@pytest.fixture
def live_url():
    import uvicorn
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()
    server = uvicorn.Server(uvicorn.Config(main.app, host="127.0.0.1", port=port, log_level="warning"))
    t = threading.Thread(target=server.run, daemon=True)
    t.start()
    for _ in range(100):
        if server.started:
            break
        time.sleep(0.05)
    yield f"http://127.0.0.1:{port}"
    server.should_exit = True
    t.join(5)


def test_disconnect_releases_job_when_worker_ends(live_url, fake, monkeypatch):
    import httpx
    monkeypatch.setenv("HW_MAX_CONCURRENT", "1")
    fake.delay = {"a": 0.6, "b": 0.6, "c": 0.6}
    files = {"file": ("p.png", PNG, "image/png")}
    with httpx.Client(timeout=10) as http:
        with http.stream("POST", f"{live_url}/api/handwriting/stream", files=files) as r:
            first = json.loads(next(r.iter_lines()))
            assert first["type"] == "plan"
        # client gone, worker still reading: the job place is still taken
        busy = http.post(f"{live_url}/api/handwriting", files=files)
        assert busy.status_code == 503 and busy.json()["detail"]["code"] == "busy"
        for _ in range(100):
            if main._jobs == 0:
                break
            time.sleep(0.05)
        assert main._jobs == 0
        fake.delay = {}
        assert http.post(f"{live_url}/api/handwriting", files=files).status_code == 200


# ---------- docs Q&A ----------

def upload(client, name: str, data: bytes):
    return client.post("/api/docs/upload", files={"file": (name, data, "application/octet-stream")})


def test_docs_upload_list_replace_delete_ask(client):
    r = client.post("/api/docs/ask", json={"text": "How often?"})
    assert r.status_code == 409 and detail(r)["code"] == "no_docs"

    r = upload(client, "notes.txt", b"Paracetamol 500 mg is taken twice a day. " * 40)
    assert r.status_code == 200 and r.json()["chunks"] >= 2 and r.json()["replaced"] is False
    assert upload(client, "dose.pdf", TEXT_PDF).status_code == 200
    listing = client.get("/api/docs").json()
    assert [d["source"] for d in listing["docs"]] == ["notes.txt", "dose.pdf"]
    assert listing["total_chunks"] == sum(d["chunks"] for d in listing["docs"])

    r = upload(client, "notes.txt", b"Short replacement text.")  # same name replaces the old chunks
    assert r.json()["replaced"] is True and r.json()["chunks"] == 1
    listing = client.get("/api/docs").json()
    assert {d["source"]: d["chunks"] for d in listing["docs"]}["notes.txt"] == 1

    r = client.post("/api/docs/ask", json={"text": "How often is paracetamol taken?"})
    assert r.status_code == 200
    body = r.json()
    assert body["answer"] == "Twice a day [1]." and body["sources"] and body["grounded"] is True

    assert client.delete("/api/docs/notes.txt").json()["ok"] is True
    assert client.delete("/api/docs/notes.txt").status_code == 404
    assert [d["source"] for d in client.get("/api/docs").json()["docs"]] == ["dose.pdf"]
    assert client.delete("/api/docs").json() == {"ok": True}
    r = client.post("/api/docs/ask", json={"text": "How often?"})
    assert r.status_code == 409 and detail(r)["code"] == "no_docs"


def test_docs_upload_validation(client, monkeypatch):
    r = upload(client, "virus.exe", b"MZ....")
    assert r.status_code == 415 and detail(r)["code"] == "unsupported_type"
    r = upload(client, "fake.pdf", b"hello, not a pdf")
    assert r.status_code == 415 and detail(r)["code"] == "unsupported_type"
    r = upload(client, "broken.pdf", b"%PDF-1.4 garbage")
    assert r.status_code == 422 and detail(r)["code"] == "bad_file"
    r = upload(client, "scan.pdf", EMPTY_PDF)
    assert r.status_code == 422
    d = detail(r)
    assert d["code"] == "no_text" and d["message"] == "No selectable text found. Scanned PDFs need OCR first."
    r = upload(client, "blank.txt", b"   \n  ")
    assert r.status_code == 422 and detail(r)["code"] == "no_text"
    r = upload(client, "empty.md", b"")
    assert r.status_code == 400 and detail(r)["code"] == "empty_file"
    monkeypatch.setenv("DOCS_MAX_UPLOAD_MB", "0.001")
    r = upload(client, "big.csv", b"a,b\n" * 1000)
    assert r.status_code == 413 and detail(r)["code"] == "too_large"
    assert client.get("/api/docs").json() == {"docs": [], "total_chunks": 0}


def test_docs_ask_validation_and_llm_failure(client, monkeypatch):
    upload(client, "notes.md", b"# Notes\nMetformin is taken with food.")
    for text in ("", "   ", "x" * 1001):
        r = client.post("/api/docs/ask", json={"text": text})
        assert r.status_code == 422 and detail(r)["code"] == "bad_question"

    def down(messages, tools=None, **kw):
        raise RuntimeError("All LLM providers failed")
    monkeypatch.setattr(llm, "chat", down)
    r = client.post("/api/docs/ask", json={"text": "When is metformin taken?"})
    assert r.status_code == 502 and detail(r)["code"] == "all_models_failed"
