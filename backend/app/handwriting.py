"""Bad-handwriting digitizer (HNX26EPS04).

Pipeline (each stage can be switched off, which is how eval.py builds the ablation table):
  1. clean    OpenCV: grayscale, denoise, contrast (CLAHE), deskew.
  2. read     Several *different* vision models transcribe the image in parallel.
  3. vote     Align the readings word by word, majority vote. Agreement = confidence.
              Words the models disagree on are FLAGGED instead of guessed.
  4. context  An LLM may resolve a flagged word, but only by picking one of the
              models' own alternatives or a lexicon word (data/lexicon.txt). Never free text.

`baseline()` is a single model, single pass: what we compare against.

Readers come from HW_READERS in .env: comma-separated provider or provider:model, e.g.
  HW_READERS=gemini,openrouter:google/gemma-4-31b-it:free,claude
Readers that fail (no key, rate limit) are skipped; the vote uses whoever answered.
Every model response is cached in backend/.cache/ so re-running eval costs nothing.
"""
import base64
import hashlib
import json
import os
import re
import threading
import time
from collections import Counter
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from difflib import SequenceMatcher, get_close_matches
from pathlib import Path

from . import llm

CACHE = Path(__file__).resolve().parent.parent / ".cache"
LEXICON = Path(__file__).resolve().parent.parent / "data" / "lexicon.txt"
WRITERS = Path(__file__).resolve().parent.parent / "data" / "writers"  # per-writer confirmed words
UNREADABLE = "[?]"
MARGIN = "[margin]"

# Tested 2026-10-08 on real handwriting. Groq's qwen goes first: fast, accurate and the most
# generous free tier (it is also the single reader when vote=false). Gemini free tier is only
# 20 requests/day *per model*, so Gemini slots list spares after "|": when a model is used up
# the next one stands in. Spares 3.7-flash / 3.8-flash / 3.1-flash-lite are not yet tested.
# Readers that fail are skipped.
DEFAULT_READERS = (
    "groq:qwen/qwen3.8-27b,"
    "gemini:gemini-3.5-flash|gemini:gemini-3.7-flash|gemini:gemini-3.1-flash-lite,"
    "openrouter:dots-studio/dots-3-note-preview:free,"
    "gemini:gemini-3.6-flash|gemini:gemini-3.8-flash|gemini:gemini-3.7-flash|gemini:gemini-3.1-flash-lite,"
    "openrouter:google/gemma-4-31b-it:free|openrouter:google/gemma-4-26b-a4b-it:free"
)
EXHAUSTED_FOR = 3600  # s; a model out of daily quota is not asked again for this long
DEFAULT_BASELINE = "groq:qwen/qwen3.8-27b"  # same model as the first reader, plain prompt
READ_TIMEOUT = float(os.getenv("HW_READ_TIMEOUT", "90"))  # seconds per model call
VOTE_DEADLINE = float(os.getenv("HW_VOTE_DEADLINE", "25"))  # vote with whoever answered by then

READ_PROMPT = """Transcribe the handwriting in this image exactly as written.
Rules:
- Copy the words exactly, keep the original line breaks and spelling. Do not fix grammar.
- Skip words that are crossed out.
- Put margin notes on their own line, starting with "[margin] ".
- If you cannot read a word with confidence, write [?] in its place. NEVER guess.
- Output only the transcription, no commentary."""

BASELINE_PROMPT = "Transcribe the handwritten text in this image. Output only the text."


# ---------- helpers ----------

def _parse(item: str) -> tuple[str, str | None]:
    provider, _, model = item.strip().partition(":")
    return provider, model or None


def _slots() -> list[list[tuple[str, str | None]]]:
    """Reader slots from HW_READERS: comma = next voter, "|" = spare models for that voter."""
    spec = os.getenv("HW_READERS", DEFAULT_READERS)
    if os.getenv("ANTHROPIC_API_KEY") and "claude" not in spec:
        spec += ",claude"
    return [[_parse(m) for m in slot.split("|") if m.strip()] for slot in spec.split(",") if slot.strip()]


def _readers() -> list[tuple[str, str | None]]:
    """First choice of every slot."""
    return [slot[0] for slot in _slots()]


def _name(provider: str, model: str | None) -> str:
    return f"{provider}:{model}" if model else provider


_exhausted: dict[str, float] = {}  # model name -> time it ran out of quota (this process only)
_lock = threading.Lock()


def _out_of_quota(e: Exception) -> bool:
    """Daily quota gone (or model removed): no point asking again soon. Per-minute limits don't count."""
    msg = str(e).lower().replace("-", "").replace("_", "")
    return getattr(e, "status_code", None) == 404 or (
        getattr(e, "status_code", None) == 429 and "perday" in msg)


def _cached(key_parts: list, fn):
    CACHE.mkdir(exist_ok=True)
    key = hashlib.sha256(json.dumps(key_parts, sort_keys=True).encode()).hexdigest()[:32]
    f = CACHE / f"{key}.json"
    if f.exists():
        value = json.loads(f.read_text(encoding="utf-8"))
        if not (isinstance(value, str) and not value.strip()):  # never trust a cached empty reply
            return value
    value = fn()
    if not (isinstance(value, str) and not value.strip()):
        f.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")
    return value


def _strip_reasoning(text: str) -> str:
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.S)
    return text.strip().removeprefix("```").removesuffix("```").strip()


def tokens(text: str) -> list[str]:
    """Words plus explicit newline tokens, so line structure survives the vote."""
    out = []
    for line in text.strip().splitlines():
        out.extend(line.split())
        out.append("\n")
    return out[:-1] if out else []


def norm(tok: str) -> str:
    """Comparison key: lowercase, punctuation and brackets dropped ("[others]" == "others").
    The unreadable marker [?] keeps its own key."""
    if UNREADABLE in tok:
        return UNREADABLE
    return re.sub(r"[^\w]", "", tok.lower()) or tok


def detok(toks: list[str]) -> str:
    lines: list[list[str]] = [[]]
    for t in toks:
        if t == "\n":
            lines.append([])
        else:
            lines[-1].append(t)
    return "\n".join(" ".join(line) for line in lines)


# ---------- stage 0: prepare any upload ----------

MAX_SIDE = 2400           # px; bigger photos gain nothing and blow provider size limits
MAX_BYTES = 3_500_000     # Groq rejects base64 images above ~4 MB


def _pdf_image(data: bytes) -> bytes:
    """First page of a scanned PDF -> its largest embedded image (no extra dependency)."""
    import io
    import cv2
    import numpy as np
    from pypdf import PdfReader
    page = PdfReader(io.BytesIO(data)).pages[0]
    xobjects = page.get("/Resources", {}).get("/XObject", {})
    images = [x.get_object() for x in xobjects.values() if x.get_object().get("/Subtype") == "/Image"]
    if not images:
        raise RuntimeError("This PDF has no scanned image on page 1 (typed PDFs are not handwriting).")
    im = max(images, key=lambda x: int(x["/Width"]) * int(x["/Height"]))
    filters = im.get("/Filter")
    filters = filters if isinstance(filters, list) else [filters]
    if "/DCTDecode" in filters or "/JPXDecode" in filters:  # scanners store JPEG: bytes are the file
        return im._data
    w, h = int(im["/Width"]), int(im["/Height"])  # raw pixels (Flate etc.): rebuild with numpy
    raw = np.frombuffer(im.get_data(), np.uint8)
    channels = raw.size // (w * h)
    if channels not in (1, 3) or int(im.get("/BitsPerComponent", 8)) != 8:
        raise RuntimeError("Unsupported image format inside this PDF. Export the page as JPG instead.")
    pixels = raw[: w * h * channels].reshape(h, w, channels)
    return cv2.imencode(".png", pixels[..., ::-1] if channels == 3 else pixels)[1].tobytes()


def prepare(data: bytes) -> bytes:
    """Make any upload safe for every reader: PDF -> image, huge photo -> smaller JPEG.
    Normal-sized images are returned untouched (so cached readings stay valid)."""
    if data[:5] == b"%PDF-":
        try:
            data = _pdf_image(data)
        except RuntimeError:
            raise
        except Exception as e:
            raise RuntimeError(f"Could not read this PDF ({type(e).__name__}). Try a JPG photo of the page.") from e
    try:
        import cv2
        import numpy as np
    except ImportError:
        return data
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise RuntimeError("Could not open this file as an image. Use JPG, PNG, WEBP or a scanned PDF.")
    h, w = img.shape[:2]
    if max(h, w) <= MAX_SIDE and len(data) <= MAX_BYTES:
        return data
    s = min(1.0, MAX_SIDE / max(h, w))
    if s < 1:
        img = cv2.resize(img, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
    ok, jpg = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 90])
    return jpg.tobytes() if ok else data


# ---------- stage 1: clean ----------

def clean(data: bytes) -> bytes:
    try:
        import cv2
        import numpy as np
    except ImportError:  # OpenCV missing: skip cleanup rather than fail
        return data
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_GRAYSCALE)
    if img is None:
        return data
    h, w = img.shape
    if max(h, w) < 1600:  # upscale small photos; VLMs read bigger strokes better
        s = 1600 / max(h, w)
        img = cv2.resize(img, None, fx=s, fy=s, interpolation=cv2.INTER_CUBIC)
    img = cv2.fastNlMeansDenoising(img, h=10)
    img = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(img)
    # deskew using the angle of the ink pixels
    ink = cv2.threshold(img, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)[1]
    coords = np.column_stack(np.where(ink > 0))
    if len(coords) > 100:
        angle = cv2.minAreaRect(coords[:, ::-1].astype(np.float32))[-1]
        angle = angle - 90 if angle > 45 else angle
        if 0.5 < abs(angle) < 15:
            m = cv2.getRotationMatrix2D((img.shape[1] / 2, img.shape[0] / 2), angle, 1.0)
            img = cv2.warpAffine(img, m, (img.shape[1], img.shape[0]), flags=cv2.INTER_CUBIC,
                                 borderMode=cv2.BORDER_REPLICATE)
    ok, png = cv2.imencode(".png", img)
    if ok and len(png) > MAX_BYTES * 0.7:  # base64 adds ~33%: stay under provider limits
        ok, png = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 92])
    return png.tobytes() if ok else data


# ---------- stage 2: read ----------

def _mime(data: bytes) -> str:
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return "image/png"


def _image_msg(data: bytes, prompt: str) -> list[dict]:
    url = f"data:{_mime(data)};base64," + base64.b64encode(data).decode()
    return [{"role": "user", "content": [
        {"type": "text", "text": prompt},
        {"type": "image_url", "image_url": {"url": url}},
    ]}]


def _call_once_retry(provider: str, model: str | None, messages: list[dict]) -> str:
    """One call; on a rate limit (429) or overload (503) wait 2 s and retry once, then give up."""
    call = lambda: llm.chat_one(provider, messages, model=model, max_retries=0, timeout=READ_TIMEOUT)
    try:
        return call()
    except Exception as e:
        if getattr(e, "status_code", None) not in (429, 503) or _out_of_quota(e):  # a daily cap won't lift in 2 s
            raise
        time.sleep(2)
        return call()


def read_one(data: bytes, provider: str, model: str | None, prompt: str = READ_PROMPT) -> str:
    img_hash = hashlib.sha256(data).hexdigest()
    return _cached(["read", img_hash, provider, model, prompt],
                   lambda: _strip_reasoning(_call_once_retry(provider, model, _image_msg(data, prompt))))


def read_slot(data: bytes, slot: list[tuple[str, str | None]], claimed: set[str]) -> tuple[str, str | Exception]:
    """Try the slot's models in order until one answers. `claimed` (shared by all slots of one
    request) stops two voters from using the same model, which would count one opinion twice.
    Returns (name of the model that answered, text) or (slot's first name, Exception)."""
    tried = []
    for provider, model in slot:
        name = _name(provider, model)
        with _lock:
            if name in claimed:
                continue
            if time.time() - _exhausted.get(name, 0) < EXHAUSTED_FOR:
                tried.append(f"{name}: out of quota")
                continue
            claimed.add(name)
        try:
            text = read_one(data, provider, model)
            if text.strip():
                return name, text
            tried.append(f"{name}: empty reply")
        except Exception as e:
            if _out_of_quota(e):
                with _lock:
                    _exhausted[name] = time.time()
            tried.append(f"{name}: {str(e)[:120]}")
    return _name(*slot[0]), RuntimeError(" | ".join(tried) or "all models already in use")


def read_all(data: bytes) -> dict:
    """{"readings": {reader: text}, "errors": {reader: error}}."""
    slots, claimed = _slots(), set()
    pool = ThreadPoolExecutor(max_workers=len(slots))
    futures = {pool.submit(read_slot, data, s, claimed): s for s in slots}
    # Vote with whoever answered within the deadline; slow models keep running in the
    # background and still fill the cache for next time. Wait longer only if nobody answered.
    done, pending = wait(futures, timeout=VOTE_DEADLINE)
    give_up = time.time() + READ_TIMEOUT * 3
    while pending and not any(isinstance(f.result()[1], str) for f in done) and time.time() < give_up:
        more, pending = wait(pending, timeout=give_up - time.time(), return_when=FIRST_COMPLETED)
        done |= more
    pool.shutdown(wait=False)
    results = [f.result() if f in done else (_name(*s[0]), TimeoutError(f"no answer within {VOTE_DEADLINE:.0f}s"))
               for f, s in futures.items()]
    readings = {n: t for n, t in results if isinstance(t, str) and t.strip()}
    errors = {n: (str(t)[:200] if not isinstance(t, str) else "empty reply")
              for n, t in results if n not in readings}
    if not readings:
        raise RuntimeError("No vision model answered: " + json.dumps(errors))
    return {"readings": readings, "errors": errors}


# ---------- stage 3: vote ----------

def _pivot(readings: list[list[str]]) -> int:
    """The reading that agrees most with all the others."""
    def sim(a, b):
        return SequenceMatcher(None, [norm(t) for t in a], [norm(t) for t in b]).ratio()
    scores = [sum(sim(r, o) for j, o in enumerate(readings) if j != i) for i, r in enumerate(readings)]
    return max(range(len(readings)), key=lambda i: scores[i])


def vote(readings: dict[str, str]) -> list[dict]:
    """Align every reading to a pivot reading and majority-vote each word.

    Returns [{text, confidence, flagged, alternatives}] where confidence = share of
    models that agree on the chosen word. Newlines come through as {"text": "\\n"}.
    """
    names = list(readings)
    toks = [tokens(readings[n]) for n in names]
    n_models = len(toks)
    p = _pivot(toks) if n_models > 1 else 0
    pivot = toks[p]
    columns: list[list[str | None]] = [[t] for t in pivot]
    # Words other readers have that the pivot skipped: gaps[g] = inserted token tuples, one per
    # reader, placed before pivot position g. Without this a word the pivot missed is silently lost.
    gaps: dict[int, list[tuple[str, ...]]] = {}

    for i, other in enumerate(toks):
        if i == p:
            continue
        aligned: list[str | None] = [None] * len(pivot)
        sm = SequenceMatcher(None, [norm(t) for t in pivot], [norm(t) for t in other], autojunk=False)
        for op, a1, a2, b1, b2 in sm.get_opcodes():
            if op in ("equal", "replace"):
                for k in range(a2 - a1):
                    j = b1 + k
                    aligned[a1 + k] = other[j] if j < b2 else None
            extra = other[b1:b2] if op == "insert" else other[b1 + (a2 - a1):b2] if op == "replace" else []
            extra = tuple(t for t in extra if t != "\n")
            if extra:
                gaps.setdefault(a1 if op == "insert" else a2, []).append(extra)
        for col, tok in zip(columns, aligned):
            col.append(tok)

    def surface_of(cands: list[str], key: str) -> str:  # prefer a spelling without brackets
        same = [t for t in cands if norm(t) == key]
        if MARGIN in same:  # structural tag from READ_PROMPT, keep it as is
            return MARGIN
        return next((t for t in same if "[" not in t), same[0]).strip("[]") or same[0]

    def inserted(g: int) -> list[dict]:
        """Majority-vote the words readers added at gap g (pivot counts as 'nothing here')."""
        if g not in gaps:
            return []
        by_key = Counter(tuple(norm(t) for t in seq) for seq in gaps[g])
        key, votes = by_key.most_common(1)[0]
        if votes < n_models / 2:  # a minority saw extra words: the majority says nothing is there
            return []
        seq = next(s for s in gaps[g] if tuple(norm(t) for t in s) == key)
        flagged = votes <= n_models / 2 or (votes < n_models and any(c.isdigit() for t in seq for c in t))
        return [{"text": surface_of([t], norm(t)), "confidence": round(votes / n_models, 2),
                 "flagged": flagged, "alternatives": []} for t in seq]

    words = []
    for pos, col in enumerate(columns):
        words.extend(inserted(pos))
        if col[0] == "\n":
            words.append({"text": "\n"})
            continue
        real = [t for t in col if t and t != "\n" and norm(t) != norm(UNREADABLE)]
        counts = Counter(norm(t) for t in real)
        if not counts:
            words.append({"text": UNREADABLE, "confidence": 0.0, "flagged": True, "alternatives": []})
            continue
        best, votes = counts.most_common(1)[0]
        surface = surface_of(real, best)
        alternatives = sorted({t for t in real if norm(t) != best})
        confidence = votes / n_models
        # Flag unless a strict majority of ALL models agree (a lone reader can only flag [?]).
        flagged = n_models > 1 and votes <= n_models / 2
        # Numbers (doses!) must be unanimous: any disagreement on a digit is flagged, never guessed.
        if any(ch.isdigit() for t in real for ch in t) and votes < n_models:
            flagged = True
        words.append({"text": surface, "confidence": round(confidence, 2), "flagged": flagged,
                      "alternatives": alternatives})
    words.extend(inserted(len(columns)))
    return words


# ---------- stage 4: context ----------

def _lexicon() -> list[str]:
    if not LEXICON.exists():
        return []
    return [w.strip() for w in LEXICON.read_text(encoding="utf-8").splitlines() if w.strip()]


def _writer_file(writer: str) -> Path:
    safe = re.sub(r"[^a-z0-9_-]", "_", writer.strip().lower())[:64]  # no path tricks like ../
    if not safe.strip("_"):
        raise ValueError("writer name is empty")
    return WRITERS / f"{safe}.json"


def writer_words(writer: str | None) -> list[str]:
    """Words a human confirmed for this writer (review mode)."""
    if not writer or not writer.strip():
        return []
    f = _writer_file(writer)
    return json.loads(f.read_text(encoding="utf-8")) if f.exists() else []


def save_answer(writer: str, original: str, answer: str) -> int:
    """Store the human's answer for a flagged word. The answer is final. Returns the word count."""
    answer = answer.strip()
    if not answer:
        raise ValueError("answer is empty")
    f = _writer_file(writer)
    words = writer_words(writer)
    if norm(answer) not in {norm(w) for w in words}:  # dedupe
        words.append(answer)
    WRITERS.mkdir(parents=True, exist_ok=True)
    f.write_text(json.dumps(words, ensure_ascii=False, indent=1), encoding="utf-8")
    return len(words)


def context_fix(words: list[dict], extra_lexicon: list[str] | None = None) -> list[dict]:
    """Let an LLM resolve flagged words, choosing ONLY from the models' alternatives or lexicon matches.
    extra_lexicon: e.g. a writer's human-confirmed words, used like lexicon words."""
    lex = _lexicon() + list(extra_lexicon or [])
    lex_norm = {norm(w): w for w in lex}
    choices: dict[int, list[str]] = {}
    for i, w in enumerate(words):
        if not w.get("flagged"):
            continue
        cands = [c for c in [w["text"], *w["alternatives"]] if c != UNREADABLE]
        for c in list(cands):  # snap near-misses onto the lexicon (drug names etc.)
            for m in get_close_matches(norm(c), list(lex_norm), n=2, cutoff=0.75):
                cands.append(lex_norm[m])
        cands = list(dict.fromkeys(cands))
        if cands:
            choices[i] = cands
    if not choices:
        return words

    marked = " ".join(f"<<{i}>>" if i in choices else w["text"] for i, w in enumerate(words))
    prompt = (
        "This is a transcription of messy handwriting. Each <<n>> is an uncertain word.\n"
        f"Text:\n{marked}\n\nCandidates for each uncertain word:\n"
        + "\n".join(f"{i}: {json.dumps(c, ensure_ascii=False)}" for i, c in choices.items())
        + "\n\nFor each n, pick the candidate that makes the text clearly correct in context. "
        "If context does not make one candidate clearly right, answer null. "
        'Reply as JSON: {"<n>": "<candidate or null>"}'
    )
    picks = _cached(["context", prompt], lambda: llm.complete_json(prompt))
    out = [dict(w) for w in words]
    for k, v in (picks or {}).items():
        try:
            i = int(k)
        except (TypeError, ValueError):
            continue
        if i in choices and isinstance(v, str) and v in choices[i]:
            out[i].update(text=v, flagged=False, resolved_by="context")
    return out


# ---------- full pipeline ----------

def render(words: list[dict], mark_flags: bool = False) -> str:
    toks = [(f"[[{w['text']}?]]" if mark_flags and w.get("flagged") else w["text"]) for w in words]
    return detok(toks)


def baseline(data: bytes, provider: str | None = None, model: str | None = None) -> str:
    """Single model, single pass, plain prompt: the thing we must beat."""
    if not provider:
        provider, model = _parse(os.getenv("HW_BASELINE", DEFAULT_BASELINE))
    return read_one(prepare(data), provider, model, prompt=BASELINE_PROMPT)


def digitize(data: bytes, use_clean: bool = True, use_vote: bool = True, use_context: bool = True,
             writer: str | None = None) -> dict:
    data = prepare(data)
    img = clean(data) if use_clean else data
    if use_vote:
        r = read_all(img)
        readings, errors = r["readings"], r["errors"]
    else:
        name, text = read_slot(img, _slots()[0], set())
        if isinstance(text, Exception):
            raise RuntimeError(f"{name} failed: {str(text)[:200]}")
        readings, errors = {name: text}, {}
    words = vote(readings)
    if use_context:
        words = context_fix(words, writer_words(writer))
    flagged = sum(1 for w in words if w.get("flagged"))
    return {
        "text": render(words),
        "marked": render(words, mark_flags=True),
        "words": words,
        "readings": readings,
        "errors": errors,
        "flagged": flagged,
        "stages": {"clean": use_clean, "vote": use_vote, "context": use_context},
    }


# ---------- prescription table ----------

TABLE_FIELDS = ["drug", "strength", "form", "frequency", "duration"]
_FLAG = re.compile(r"\[\[(.*?)\?\]\]")


def _numbers(s: str) -> list[str]:
    return re.findall(r"\d+(?:\.\d+)?", s)


def rx_table(marked: str) -> list[dict]:
    """Prescription text -> rows {drug, strength, form, frequency, duration, flagged}.

    `marked` is the /api/handwriting `marked` text ([[word?]] = flagged). Numbers are copied, never
    corrected: a row is flagged if any of its fields touches a flagged word, or holds a number that
    does not appear in the source text exactly as written."""
    prompt = (
        "Extract every medicine from this handwritten prescription transcription.\n"
        "Uncertain words are wrapped like [[word?]]: copy them WITH the brackets.\n"
        "Copy numbers EXACTLY as written; never correct, convert or complete them. "
        "Use \"\" for anything not written.\n"
        f'Reply as JSON: {{"rows": [{{{", ".join(f"{json.dumps(f)}: str" for f in TABLE_FIELDS)}}}]}}\n\n'
        f"Text:\n{marked}"
    )
    out = llm.complete_json(prompt)
    rows = out.get("rows", []) if isinstance(out, dict) else []
    source_numbers = set(_numbers(_FLAG.sub(r"\1", marked)))
    flagged_numbers = {n for m in _FLAG.findall(marked) for n in _numbers(m)}
    clean_rows = []
    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, dict):
            continue
        vals = {f: str(row.get(f) or "") for f in TABLE_FIELDS}
        nums = [n for v in vals.values() for n in _numbers(_FLAG.sub(r"\1", v))]
        flagged = (any(_FLAG.search(v) for v in vals.values())
                   or any(n in flagged_numbers or n not in source_numbers for n in nums))
        clean_rows.append({**{f: _FLAG.sub(r"\1", v).strip() for f, v in vals.items()}, "flagged": flagged})
    return clean_rows
