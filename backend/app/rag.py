"""Tiny in-memory RAG (Gen AI track).

ingest(): text / PDF (per page) / DOCX -> sentence-aware chunks -> index.  search(): top-k passages.
answer(): retrieve + ask the LLM to answer with numbered citations.

Search uses sentence-transformers embeddings (all-MiniLM-L6-v2, CPU) if installed; otherwise BM25 keyword
ranking, which needs nothing extra and also runs on small hosts. Photos and scanned PDFs are read by the
handwriting pipeline in main.py before they get here; their uncertain words arrive marked as [[word?]].
Swap STORE for Chroma/FAISS if you need persistence or >10k chunks.
"""
import io
import math
import re
import threading
import zipfile
from collections import Counter
from xml.etree import ElementTree

from . import llm

STORE: list[dict] = []  # {"source", "page", "text", "vec", "toks"}
_lock = threading.Lock()  # uploads, deletes and searches can run at the same time
_model = None
TOP_K = 5
# \w alone splits Indic words at vowel signs; also keep U+0900-U+0DFF (Devanagari ... Sinhala) and Urdu marks.
_WORD = re.compile("[\\w\u0900-\u0DFF\u064B-\u065F\u0670]+")


def _embedder():
    global _model
    if _model is None:
        try:
            from sentence_transformers import SentenceTransformer
            _model = SentenceTransformer("all-MiniLM-L6-v2")
        except ImportError:
            _model = False
    return _model


def _tokens(text: str) -> list[str]:
    return _WORD.findall(text.lower())


def _embed(texts: list[str]) -> list:
    model = _embedder()
    if model:
        return [v.tolist() for v in model.encode(texts, normalize_embeddings=True)]
    return [None] * len(texts)  # BM25 works from the tokens


# ---------- reading files ----------

W_NS = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
DOCX_MAX_XML = 50 * 1024 * 1024


def _docx_text(data: bytes) -> str:
    """Paragraph text of a .docx (Word) file, standard library only. Raises ValueError if it isn't one."""
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            info = z.getinfo("word/document.xml")
            if info.file_size > DOCX_MAX_XML:  # zip bomb guard
                raise ValueError("document too large")
            xml = z.read(info)
    except (zipfile.BadZipFile, KeyError) as e:
        raise ValueError("not a Word document") from e
    if b"<!DOCTYPE" in xml or b"<!ENTITY" in xml:  # Word never writes these; refuse entity tricks
        raise ValueError("unexpected XML in document")
    root = ElementTree.fromstring(xml)
    paras = []
    for p in root.iter(W_NS + "p"):
        parts = []
        for el in p.iter():
            if el.tag == W_NS + "t" and el.text:
                parts.append(el.text)
            elif el.tag == W_NS + "tab":
                parts.append("\t")
            elif el.tag in (W_NS + "br", W_NS + "cr"):
                parts.append("\n")
        paras.append("".join(parts))
    return "\n".join(paras)


def extract_pages(filename: str, data: bytes) -> list[tuple[int | None, str]]:
    """[(page number or None, text)]. PDFs keep their pages so answers can cite them."""
    name = filename.lower()
    if name.endswith(".pdf"):
        from pypdf import PdfReader
        return [(i + 1, p.extract_text() or "") for i, p in enumerate(PdfReader(io.BytesIO(data)).pages)]
    if name.endswith(".docx"):
        return [(None, _docx_text(data))]
    return [(None, data.decode("utf-8", errors="ignore"))]


def extract_text(filename: str, data: bytes) -> str:
    return "\n".join(t for _, t in extract_pages(filename, data))


# ---------- chunking ----------

_SENT = re.compile(r"(?<=[.!?।])\s+|\n\s*\n|\n(?=\s*(?:[-*•]|\d+[.)])\s)")


def _chunks(text: str, size: int = 900) -> list[str]:
    """Whole sentences packed up to ~size characters; the last sentence repeats at the start of the next chunk."""
    sents = []
    for s in _SENT.split(text):
        s = re.sub(r"\s+", " ", s or "").strip()
        while len(s) > size:  # one huge "sentence" (tables, lists without full stops): cut it
            cut = s.rfind(" ", 0, size)
            cut = cut if cut > size // 2 else size
            sents.append(s[:cut].strip())
            s = s[cut:].strip()
        if s:
            sents.append(s)
    out, cur = [], []
    for s in sents:
        if cur and len(" ".join(cur + [s])) > size:
            out.append(" ".join(cur))
            cur = [cur[-1]] if len(cur[-1]) < size // 3 else []
        cur.append(s)
    if cur and (not out or " ".join(cur) != out[-1]):
        out.append(" ".join(cur))
    return [c for c in out if c.strip()]


# ---------- index ----------

def ingest(filename: str, data: bytes, text: str | None = None,
           pages: list[tuple[int | None, str]] | None = None) -> int:
    """Add a document. A file with the same name replaces its old chunks.
    pages / text: already extracted (skips extracting again). Returns the number of chunks."""
    if pages is None:
        pages = [(None, text)] if text is not None else extract_pages(filename, data)
    items = [(page, c) for page, t in pages for c in _chunks(t or "")]
    vecs = _embed([c for _, c in items]) if items else []
    with _lock:
        _remove(filename)
        STORE.extend({"source": filename, "page": page, "text": c, "vec": v, "toks": Counter(_tokens(c))}
                     for (page, c), v in zip(items, vecs))
    return len(items)


def _remove(source: str) -> int:
    before = len(STORE)
    STORE[:] = [c for c in STORE if c["source"] != source]  # in place: other modules hold this list
    return before - len(STORE)


def remove(source: str) -> int:
    """Drop one document. Returns how many chunks were removed (0 = no such document)."""
    with _lock:
        return _remove(source)


def list_docs() -> list[dict]:
    """[{"source", "chunks"}] in upload order."""
    with _lock:
        counts = Counter(c["source"] for c in STORE)
    return [{"source": s, "chunks": n} for s, n in counts.items()]


def _bm25(query: list[str], store: list[dict], k1: float = 1.5, b: float = 0.75) -> list[float]:
    n = len(store)
    avg = sum(sum(c["toks"].values()) for c in store) / n or 1
    df = Counter(t for c in store for t in set(c["toks"]))
    scores = []
    for c in store:
        dl = sum(c["toks"].values()) or 1
        s = 0.0
        for t in set(query):
            tf = c["toks"].get(t, 0)
            if tf:
                idf = math.log(1 + (n - df[t] + 0.5) / (df[t] + 0.5))
                s += idf * tf * (k1 + 1) / (tf + k1 * (1 - b + b * dl / avg))
        scores.append(s)
    return scores


def search(query: str, k: int = TOP_K) -> list[dict]:
    with _lock:
        store = list(STORE)
    if not store:
        return []
    if all(c["vec"] is not None for c in store) and _embedder():
        q = _embed([query])[0]
        scores = [sum(x * y for x, y in zip(q, c["vec"])) for c in store]
    else:
        scores = _bm25(_tokens(query), store)
    ranked = sorted(range(len(store)), key=lambda i: scores[i], reverse=True)[:k]
    return [{"source": store[i]["source"], "page": store[i]["page"], "text": store[i]["text"]} for i in ranked]


def _label(h: dict) -> str:
    return f"{h['source']}, page {h['page']}" if h.get("page") else h["source"]


def answer(question: str) -> dict:
    hits = search(question)
    context = "\n\n".join(f"[{i + 1}] ({_label(h)}) {h['text']}" for i, h in enumerate(hits))
    prompt = (
        "Answer the question using only the context below. Cite the passages you used like [1] or [2]. "
        "If the answer is not in the context, say so plainly. Answer in the language of the question.\n"
        "Some passages were read from photos or handwriting: a word written as [[word?]] was uncertain. If your "
        "answer depends on such a word, give it without the brackets and say it should be checked against the "
        "original.\n\n"
        f"Context:\n{context or '(no documents)'}\n\nQuestion: {question}")
    msg = llm.chat([{"role": "user", "content": prompt}])
    text = (msg["content"] if isinstance(msg, dict) else msg.content) or ""
    return {"answer": fix_citations(text), "sources": hits}


def fix_citations(text: str) -> str:
    """Some models cite like 【1】 or 【1†source】; the app links [1]."""
    return re.sub(r"【\s*(\d{1,3})[^】]*】", r"[\1]", text)


def clear():
    with _lock:
        STORE.clear()
