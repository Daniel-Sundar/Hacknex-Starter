import os

from dotenv import load_dotenv

load_dotenv()
os.environ.setdefault("OPENCV_IO_MAX_IMAGE_PIXELS", "60000000")  # refuse decompression bombs; must be set before cv2 loads

import asyncio  # noqa: E402
import json  # noqa: E402
import logging  # noqa: E402
import math  # noqa: E402
import re  # noqa: E402
import threading  # noqa: E402
import time  # noqa: E402
import uuid  # noqa: E402
from collections import deque  # noqa: E402
from concurrent.futures import ThreadPoolExecutor  # noqa: E402

from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.responses import StreamingResponse  # noqa: E402
from pydantic import BaseModel, Field  # noqa: E402
from starlette.concurrency import run_in_threadpool  # noqa: E402

from . import audit, handwriting, llm, rag, store  # noqa: E402
from .identity import owner as owner_of, short  # noqa: E402

log = logging.getLogger(__name__)

# No interactive API docs on a public server (set API_DOCS=1 locally to get /docs back).
_docs = os.getenv("API_DOCS") == "1"
app = FastAPI(title="ClearScript API", docs_url="/docs" if _docs else None, redoc_url=None,
              openapi_url="/openapi.json" if _docs else None)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in os.getenv("CORS_ORIGINS", "*").split(",") if o.strip()],
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Content-Type", "Authorization", "X-Client-Id", "X-Request-Id"],
    expose_headers=["Retry-After", "X-Request-Id"],
)

# The API only ever answers JSON / NDJSON: lock everything else down.
SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "Cross-Origin-Resource-Policy": "cross-origin",
}
MAX_BODY = 30 * 1024 * 1024  # largest upload limit + multipart overhead; JSON bodies are far smaller
_REQ_ID = re.compile(r"^[A-Za-z0-9_-]{8,64}$")


@app.middleware("http")
async def security_headers(request: Request, call_next):
    from fastapi.responses import JSONResponse
    try:
        size = int(request.headers.get("content-length") or 0)
    except ValueError:
        size = 0
    if size > MAX_BODY:
        return JSONResponse({"detail": {"code": "too_large", "message": "The request is too large."}}, status_code=413,
                            headers=SECURITY_HEADERS)
    rid = request.headers.get("x-request-id", "")
    request.state.request_id = rid if _REQ_ID.match(rid) else uuid.uuid4().hex
    response = await call_next(request)
    for k, v in SECURITY_HEADERS.items():
        response.headers.setdefault(k, v)
    if request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https":
        response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    if request.url.path != "/api/health":
        response.headers.setdefault("Cache-Control", "no-store")
    response.headers["X-Request-Id"] = request.state.request_id
    return response


class TextRequest(BaseModel):
    text: str = Field(max_length=4000)  # the friendly 1000-character check is in the endpoint


# Provider errors go to the UI behind a "technical details" disclosure: strip anything that looks like a key.
_SECRET = re.compile(r"(sk-[A-Za-z0-9_-]{8,}|AIza[0-9A-Za-z_-]{20,}|gsk_[A-Za-z0-9]{10,}|sb_(secret|publishable)_[A-Za-z0-9_-]+"
                     r"|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.?[A-Za-z0-9_-]*|Bearer\s+\S+|key=[^&\s]+)")


def _reason(e: Exception) -> str:
    return _SECRET.sub("[redacted]", str(e))[:500]


def _writer(owner: str, writer: str | None) -> str | None:
    """Writer profiles belong to the caller: the same name used by two people is two profiles."""
    w = (writer or "").strip()[:48]
    return f"{short(owner)}-{w}" if w else None


# ---------- errors, upload checks, rate limits ----------

def _err(status: int, code: str, message: str, headers: dict | None = None, **extra) -> HTTPException:
    """Every new error has detail {"code", "message", ...}: the UI shows `message` as is."""
    return HTTPException(status, detail={"code": code, "message": message, **extra}, headers=headers)


def _mb(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, default))
    except ValueError:
        return default


def _num(x: float) -> float | int:
    return int(x) if x == int(x) else x


async def _read_upload(file: UploadFile, max_mb: float, hint: str) -> bytes:
    """Read at most max_mb (+1 byte to notice a bigger file). Empty -> 400, too big -> 413."""
    limit = int(max_mb * 1024 * 1024)
    data = await file.read(limit + 1)
    if not data:
        raise _err(400, "empty_file", "The file is empty. Choose the file again.")
    if len(data) > limit:
        raise _err(413, "too_large", f"The file is bigger than {max_mb:g} MB. {hint}", max_mb=_num(max_mb))
    return data


HEIC_BRANDS = {b"heic", b"heix", b"hevc", b"mif1", b"msf1", b"heif"}


def file_kind(data: bytes) -> str | None:
    """jpeg | png | webp | pdf | heic from the first bytes (never trust the file name or content type)."""
    if data[:3] == b"\xff\xd8\xff":
        return "jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    if data[:5] == b"%PDF-":
        return "pdf"
    if data[4:8] == b"ftyp" and data[8:12] in HEIC_BRANDS:
        return "heic"
    return None


async def _read_image(file: UploadFile) -> bytes:
    """A handwriting upload: JPG, PNG, WEBP or PDF, at most MAX_UPLOAD_MB (15)."""
    data = await _read_upload(file, _mb("MAX_UPLOAD_MB", 15), "Take a smaller photo or compress it.")
    kind = file_kind(data)
    if kind == "heic":
        raise _err(415, "heic_unsupported", "HEIC photos (the iPhone default) are not supported. "
                   "Export the photo as JPG or PNG and upload that.")
    if kind is None:
        raise _err(415, "unsupported_type", "This file type is not supported. Upload a JPG, PNG, WEBP or PDF.")
    return data


# Sliding window per client IP and bucket. Override with RATE_LIMIT_<BUCKET>=count/seconds; RATE_LIMIT_OFF=1 disables.
RATE_LIMITS = {"digitize": "10/60", "docs_upload": "20/60", "docs_ask": "30/60", "hw_tools": "60/60"}
_hits: dict[tuple[str, str], deque] = {}
_hits_lock = threading.Lock()


def _limit(bucket: str) -> tuple[int, float]:
    try:
        count, _, window = os.getenv(f"RATE_LIMIT_{bucket.upper()}", RATE_LIMITS[bucket]).partition("/")
        return int(count), float(window or 60)
    except ValueError:
        count, _, window = RATE_LIMITS[bucket].partition("/")
        return int(count), float(window)


def _client_ip(request: Request) -> str:
    if os.getenv("TRUST_PROXY") == "1":  # behind one reverse proxy (Render etc.): it appends the real client IP
        forwarded = request.headers.get("x-forwarded-for", "")
        if forwarded.strip():
            return forwarded.split(",")[-1].strip()
    return request.client.host if request.client else "unknown"


def rate_limit(bucket: str):
    """FastAPI dependency: 429 with Retry-After once a client used up the bucket's window."""
    async def check(request: Request):
        if os.getenv("RATE_LIMIT_OFF") == "1":
            return
        count, window = _limit(bucket)
        now = time.monotonic()
        with _hits_lock:
            if len(_hits) > 10000:  # forget clients that went quiet
                for k in [k for k, q in _hits.items() if not q or q[-1] < now - 3600]:
                    del _hits[k]
            q = _hits.setdefault((bucket, _client_ip(request)), deque())
            while q and q[0] <= now - window:
                q.popleft()
            if len(q) >= count:
                audit.event("rate_limited", request, outcome="denied", bucket=bucket)
                wait_s = max(1, math.ceil(q[0] + window - now if q else window))
                raise _err(429, "rate_limited", f"Too many requests. Try again in {wait_s} seconds.",
                           headers={"Retry-After": str(wait_s)}, retry_after=wait_s)
            q.append(now)
    return check


# At most HW_MAX_CONCURRENT (4) digitize jobs at once; each holds its place until its worker finishes.
_jobs = 0
_jobs_lock = threading.Lock()


def _start_job():
    global _jobs
    with _jobs_lock:
        if _jobs >= int(os.getenv("HW_MAX_CONCURRENT", "4")):
            raise _err(503, "busy", "The server is busy reading other pages. Try again in 10 seconds.",
                       headers={"Retry-After": "10"}, retry_after=10)
        _jobs += 1


def _end_job():
    global _jobs
    with _jobs_lock:
        _jobs = max(0, _jobs - 1)


MODELS_FAILED = "No reading model answered. Try again in a minute."
PIPELINE_FAILED = "Something went wrong while reading this page. Try again."


# ---------- general ----------

@app.get("/api/health")
def health():
    return {"ok": True, "provider": llm.active_provider(),
            "readers": handwriting.reader_names(), "database": store.status(),
            "limits": {"max_upload_mb": _num(_mb("MAX_UPLOAD_MB", 15)),
                       "docs_max_upload_mb": _num(_mb("DOCS_MAX_UPLOAD_MB", 10))}}


# ---------- Docs Q&A ----------

DOC_TYPES = (".pdf", ".txt", ".md", ".csv", ".docx")
PHOTO_TYPES = (".jpg", ".jpeg", ".png", ".webp")


async def _read_by_hand(data: bytes) -> dict:
    """A photo or scanned page goes through the handwriting pipeline (several models vote).
    Uncertain words come back marked as [[word?]], so answers can say what to double-check."""
    _start_job()
    try:
        return await run_in_threadpool(handwriting.digitize, data)
    except handwriting.InputError as e:
        raise _err(422, "bad_image", str(e))
    except RuntimeError as e:
        raise _err(502, "all_models_failed", MODELS_FAILED, reason=_reason(e))
    finally:
        _end_job()


@app.post("/api/docs/upload", dependencies=[Depends(rate_limit("docs_upload"))])
async def upload_doc(request: Request, file: UploadFile = File(...), owner: str = Depends(owner_of)):
    name = (file.filename or "").replace("\\", "/").rsplit("/", 1)[-1].strip()
    lower = name.lower()
    if not lower.endswith(DOC_TYPES + PHOTO_TYPES):
        raise _err(415, "unsupported_type", "Upload a PDF, Word (DOCX), TXT, MD or CSV file, or a JPG, PNG or WEBP photo.")
    data = await _read_upload(file, _mb("DOCS_MAX_UPLOAD_MB", 10), "Split it or upload a smaller file.")
    if not name or len(name) > 200:
        raise _err(422, "bad_name", "Rename the file to something shorter and upload it again.")
    replaced = any(d["source"] == name for d in rag.list_docs(owner))
    extra = {}

    if lower.endswith(PHOTO_TYPES):
        kind = file_kind(data)
        if kind == "heic":
            raise _err(415, "heic_unsupported", "HEIC photos (the iPhone default) are not supported. "
                       "Export the photo as JPG or PNG and upload that.")
        if kind not in ("jpeg", "png", "webp"):
            raise _err(415, "unsupported_type", "This file is not a real JPG, PNG or WEBP image.")
        r = await _read_by_hand(data)
        pages = [(None, r["marked"])]
        extra = {"read_by": "handwriting", "unverified": r.get("to_check", r["flagged"])}
    else:
        is_pdf = lower.endswith(".pdf")
        if is_pdf and data[:5] != b"%PDF-":
            raise _err(415, "unsupported_type", "This file is not a real PDF. Export it as PDF again or upload a TXT.")
        if lower.endswith(".docx") and data[:2] != b"PK":
            raise _err(415, "unsupported_type", "This file is not a real Word (DOCX) file. Save it as .docx again.")
        try:
            pages = await run_in_threadpool(rag.extract_pages, name, data)
        except Exception:
            raise _err(422, "bad_file", "Could not open this file. It may be damaged or password-protected.")
        if not any(t.strip() for _, t in pages):
            if not is_pdf:
                raise _err(422, "no_text", "This file has no text in it.")
            # A scanned PDF: read its first page like a photo.
            r = await _read_by_hand(data)
            pages = [(1, r["marked"])]
            extra = {"read_by": "handwriting", "unverified": r.get("to_check", r["flagged"]), "first_page_only": True}
    if not any(t.strip() for _, t in pages):
        raise _err(422, "no_text", "No text could be read from this file.")
    try:  # same name: replaces the old chunks
        n = await run_in_threadpool(rag.ingest, name, data, None, pages, owner)
    except rag.TooMuch:
        raise _err(413, "too_many_docs", "You have too many documents here. Remove some, then upload again.")
    audit.event("docs.upload", request, actor=owner, chunks=n, replaced=replaced)
    return {"file": name, "chunks": n, "total_chunks": rag.count(owner), "replaced": replaced, **extra}


@app.get("/api/docs")
def list_docs(owner: str = Depends(owner_of)):
    return {"docs": rag.list_docs(owner), "total_chunks": rag.count(owner)}


@app.post("/api/docs/ask", dependencies=[Depends(rate_limit("docs_ask"))])
def ask_docs(req: TextRequest, owner: str = Depends(owner_of)):
    question = req.text.strip()
    if not question or len(question) > 1000:
        raise _err(422, "bad_question", "Type a question of up to 1000 characters.")
    if not rag.count(owner):
        raise _err(409, "no_docs", "Upload a document first, then ask about it.")
    try:
        out = rag.answer(question, owner)
    except Exception as e:
        log.exception("docs ask failed")
        raise _err(502, "all_models_failed", "The AI model did not answer. Try again in a minute.",
                   reason=_reason(e))
    # Grounded = the answer cites at least one passage that was actually retrieved, not just "documents exist".
    cited = sorted({int(n) for n in re.findall(r"\[(\d+)\]", out["answer"] or "") if 1 <= int(n) <= len(out["sources"])})
    return {**out, "cited": cited, "grounded": bool(cited)}


@app.delete("/api/docs", dependencies=[Depends(rate_limit("hw_tools"))])
def clear_docs(request: Request, owner: str = Depends(owner_of)):
    rag.clear(owner)
    audit.event("docs.clear", request, actor=owner)
    return {"ok": True}


@app.delete("/api/docs/{source:path}", dependencies=[Depends(rate_limit("hw_tools"))])
def delete_doc(source: str, request: Request, owner: str = Depends(owner_of)):
    n = rag.remove(source, owner)
    if not n:
        raise _err(404, "not_found", "No document with that name. Refresh the list.")
    audit.event("docs.delete", request, actor=owner, removed=n)
    return {"ok": True, "removed": n, "total_chunks": rag.count(owner)}


# ---------- Handwriting digitizer (HNX26EPS04) ----------

def _send(progress, event: dict) -> None:
    if progress is not None:
        try:
            progress(event)
        except Exception:
            pass


def run_digitize(data: bytes, clean: bool = True, vote: bool = True, context: bool = True,
                 baseline: bool = False, writer: str | None = None, progress=None, page: str = "auto") -> dict:
    """The /api/handwriting job, shared by the plain and the streaming endpoint.
    The baseline is independent of the pipeline, so both run at once: same output, shorter wait."""
    planned = threading.Event()  # baseline events go out after the plan event

    def relay(event: dict):
        _send(progress, event)
        if event.get("type") == "plan":
            if baseline:
                _send(progress, {"type": "stage", "stage": "baseline", "status": "start"})
            planned.set()

    def run_baseline() -> str:
        try:
            text = handwriting.baseline(data)
        except Exception:
            planned.wait(2)
            _send(progress, {"type": "stage", "stage": "baseline", "status": "failed"})
            raise
        planned.wait(2)
        _send(progress, {"type": "stage", "stage": "baseline", "status": "done"})
        return text

    with ThreadPoolExecutor(max_workers=2) as pool:
        base = pool.submit(run_baseline) if baseline else None
        result = handwriting.digitize(data, use_clean=clean, use_vote=vote, use_context=context, writer=writer,
                                      progress=relay, page=page)
        if base is not None:  # a failed baseline must not throw away the pipeline's result
            try:
                result["baseline"] = base.result()
            except Exception as e:
                result["baseline"] = ""
                result["errors"]["baseline"] = _reason(e)[:200]
    return result


@app.post("/api/handwriting", dependencies=[Depends(rate_limit("digitize"))])
async def handwriting_digitize(
    file: UploadFile = File(...),
    clean: bool = Form(True),
    vote: bool = Form(True),
    context: bool = Form(True),
    baseline: bool = Form(False),
    writer: str | None = Form(None, max_length=48),
    page: str = Form("auto", max_length=20),  # auto | note | form | prescription | legal (else: auto)
    owner: str = Depends(owner_of),
):
    data = await _read_image(file)
    writer = _writer(owner, writer)
    _start_job()
    try:  # model calls take a while; don't block other requests
        return await run_in_threadpool(run_digitize, data, clean, vote, context, baseline, writer, None, page)
    except handwriting.InputError as e:
        raise _err(422, "bad_image", str(e))
    except RuntimeError as e:
        raise _err(502, "all_models_failed", MODELS_FAILED, reason=_reason(e))
    except Exception as e:
        log.exception("digitize failed")
        raise _err(500, "pipeline_error", PIPELINE_FAILED, reason=_reason(e))
    finally:
        _end_job()


PING_EVERY = 10.0  # s without any event -> {"type": "ping"}, so proxies keep the stream open


@app.post("/api/handwriting/stream", dependencies=[Depends(rate_limit("digitize"))])
async def handwriting_stream(
    file: UploadFile = File(...),
    clean: bool = Form(True),
    vote: bool = Form(True),
    context: bool = Form(True),
    baseline: bool = Form(False),
    writer: str | None = Form(None, max_length=48),
    page: str = Form("auto", max_length=20),  # auto | note | form | prescription | legal (else: auto)
    owner: str = Depends(owner_of),
):
    """Same job as /api/handwriting, as NDJSON progress events (one JSON object per line). Upload checks,
    rate limit and busy check answer with normal HTTP errors first. The last line is always
    {"type": "result", "result": <what /api/handwriting returns>} or {"type": "error", "code", "message"}."""
    data = await _read_image(file)
    writer = _writer(owner, writer)
    _start_job()
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue()
    gone = threading.Event()  # client left: stop queueing events

    def send(event: dict):
        if not gone.is_set():
            try:
                loop.call_soon_threadsafe(queue.put_nowait, event)
            except RuntimeError:  # event loop closed (server shutting down)
                pass

    def work():
        try:
            final = {"type": "result", "result": run_digitize(data, clean, vote, context, baseline, writer, send,
                                                              page)}
        except handwriting.InputError as e:
            final = {"type": "error", "code": "bad_image", "message": str(e)}
        except RuntimeError as e:
            final = {"type": "error", "code": "all_models_failed", "message": MODELS_FAILED, "reason": _reason(e)}
        except Exception as e:
            log.exception("digitize stream failed")
            final = {"type": "error", "code": "pipeline_error", "message": PIPELINE_FAILED, "reason": _reason(e)}
        finally:
            _end_job()  # the worker holds the job place, even if the client left
        send(final)

    try:
        threading.Thread(target=work, name="digitize-stream", daemon=True).start()
    except Exception:
        _end_job()
        raise

    async def lines():
        try:
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), PING_EVERY)
                except asyncio.TimeoutError:
                    event = {"type": "ping"}
                yield json.dumps(event, ensure_ascii=False) + "\n"
                if event["type"] in ("result", "error"):
                    return
        finally:
            gone.set()

    return StreamingResponse(lines(), media_type="application/x-ndjson",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


class AnswerRequest(BaseModel):  # only these fields are read; anything else in the body is ignored
    writer: str = Field(max_length=48)
    original: str = Field("", max_length=200)
    answer: str = Field(max_length=200)


@app.post("/api/handwriting/answer", dependencies=[Depends(rate_limit("hw_tools"))])
def handwriting_answer(req: AnswerRequest, request: Request, owner: str = Depends(owner_of)):
    """Review mode: the human answers a flagged word. Saved per writer; context_fix then offers it
    as a candidate on that writer's next pages (send the same `writer` form field)."""
    try:
        n = handwriting.save_answer(_writer(owner, req.writer) or "", req.original, req.answer)
    except ValueError as e:
        raise _err(400, "bad_request", str(e).capitalize() + ".")
    audit.event("writer.answer", request, actor=owner)
    return {"ok": True, "words": n}


class TableRequest(BaseModel):
    marked: str = Field(max_length=20000)  # the `marked` text from /api/handwriting ([[word?]] = flagged)


@app.post("/api/handwriting/table", dependencies=[Depends(rate_limit("hw_tools"))])
def handwriting_table(req: TableRequest):
    """Digitized prescription -> rows {drug, strength, form, frequency, duration, flagged}."""
    try:
        return {"rows": handwriting.rx_table(req.marked)}
    except RuntimeError as e:
        raise _err(502, "all_models_failed", "The AI model did not answer. Try again in a minute.",
                   reason=_reason(e))


@app.get("/api/handwriting/eval")
def handwriting_eval():
    """Ablation, calibration and robustness results for the Results tab.
    Prefers the held-out test split; falls back to dev (and says so) when test files are missing."""
    from pathlib import Path
    root = Path(__file__).resolve().parent.parent / "results"  # written there by eval.py

    def first(*names):
        for name, split in names:
            f = root / name
            if f.exists():
                return split, json.loads(f.read_text(encoding="utf-8"))
        return None, None

    ab_split, ablation = first(("eval_results_test.json", "test"), ("eval_results_dev.json", "dev"))
    rb_split, robustness = first(("eval_robustness_test.json", "test"), ("eval_robustness_dev.json", "dev"),
                                 ("eval_robustness.json", "all"))
    if ablation:
        ablation.pop("per_sample", None)  # the tab only needs the totals
    return {"ablation": ablation, "ablation_split": ab_split,
            "robustness": robustness, "robustness_split": rb_split,
            "fallback": ab_split != "test"}


class RecontextRequest(BaseModel):
    words: list[dict] = Field(max_length=4000)
    writer: str | None = Field(None, max_length=48)
    doc_type: str = Field("note", max_length=20)


@app.post("/api/handwriting/recontext", dependencies=[Depends(rate_limit("hw_tools"))])
def handwriting_recontext(req: RecontextRequest, owner: str = Depends(owner_of)):
    """After a human answer: run the constrained context fix again with this writer's (now larger) word
    list, so other flagged copies of the same word can resolve. No vision calls. Words that are not
    flagged (including the human's answers, resolved_by "human") are never changed."""
    from . import rx_safety
    kind = req.doc_type if req.doc_type in ("prescription", "note") else "note"
    try:
        words = handwriting.context_fix(req.words, handwriting.writer_words(_writer(owner, req.writer)), kind)
        return {"words": rx_safety.lasa_flags(words) if kind == "prescription" else words}
    except ValueError as e:
        raise _err(400, "bad_request", str(e).capitalize() + ".")
    except RuntimeError as e:
        raise _err(502, "all_models_failed", "The AI model did not answer. Try again in a minute.",
                   reason=_reason(e))
