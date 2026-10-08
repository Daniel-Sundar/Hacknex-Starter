"""Tiny in-memory RAG (Gen AI track).

ingest(): text/PDF -> chunks -> embeddings.  search(): cosine top-k.
answer(): retrieve + ask the LLM to answer with numbered citations.

Embeddings use sentence-transformers (all-MiniLM-L6-v2, runs on CPU, offline
once downloaded) if installed; otherwise a keyword fallback so the app still
runs with only the core requirements. Swap STORE for Chroma/FAISS if you need
persistence or >10k chunks.
"""
import io
import math
import re
import threading
from collections import Counter

from . import llm

STORE: list[dict] = []  # {"source", "text", "vec"}
_lock = threading.Lock()  # uploads, deletes and searches can run at the same time
_model = None


def _embedder():
    global _model
    if _model is None:
        try:
            from sentence_transformers import SentenceTransformer
            _model = SentenceTransformer("all-MiniLM-L6-v2")
        except ImportError:
            _model = False
    return _model


def _embed(texts: list[str]) -> list:
    model = _embedder()
    if model:
        return [v.tolist() for v in model.encode(texts, normalize_embeddings=True)]
    return [Counter(re.findall(r"\w+", t.lower())) for t in texts]


def _sim(a, b) -> float:
    if isinstance(a, list):
        return sum(x * y for x, y in zip(a, b))
    dot = sum(a[w] * b.get(w, 0) for w in a)
    na = math.sqrt(sum(v * v for v in a.values()))
    nb = math.sqrt(sum(v * v for v in b.values()))
    return dot / (na * nb) if na and nb else 0.0


def _chunks(text: str, size: int = 800, overlap: int = 150) -> list[str]:
    text = re.sub(r"\s+", " ", text).strip()
    return [text[i:i + size] for i in range(0, len(text), size - overlap) if text[i:i + size].strip()]


def extract_text(filename: str, data: bytes) -> str:
    if filename.lower().endswith(".pdf"):
        from pypdf import PdfReader
        return "\n".join(p.extract_text() or "" for p in PdfReader(io.BytesIO(data)).pages)
    return data.decode("utf-8", errors="ignore")


def ingest(filename: str, data: bytes, text: str | None = None) -> int:
    """Add a document. A file with the same name replaces its old chunks.
    text: already extracted text (skips extracting it again)."""
    chunks = _chunks(extract_text(filename, data) if text is None else text)
    vecs = _embed(chunks) if chunks else []
    with _lock:
        _remove(filename)
        STORE.extend({"source": filename, "text": t, "vec": v} for t, v in zip(chunks, vecs))
    return len(chunks)


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


def search(query: str, k: int = 4) -> list[dict]:
    with _lock:
        store = list(STORE)
    if not store:
        return []
    q = _embed([query])[0]
    ranked = sorted(store, key=lambda c: _sim(q, c["vec"]), reverse=True)[:k]
    return [{"source": c["source"], "text": c["text"]} for c in ranked]


def answer(question: str) -> dict:
    hits = search(question)
    context = "\n\n".join(f"[{i + 1}] ({h['source']}) {h['text']}" for i, h in enumerate(hits))
    prompt = (f"Answer using only the context. Cite like [1]. If the answer isn't there, say so.\n\n"
              f"Context:\n{context or '(no documents)'}\n\nQuestion: {question}")
    msg = llm.chat([{"role": "user", "content": prompt}])
    return {"answer": msg["content"] if isinstance(msg, dict) else msg.content, "sources": hits}


def clear():
    with _lock:
        STORE.clear()
