import os

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, File, Form, HTTPException, UploadFile  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.responses import StreamingResponse  # noqa: E402
from pydantic import BaseModel  # noqa: E402

from . import agent, llm, rag  # noqa: E402

app = FastAPI(title="HackNEX Starter API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    messages: list[dict]
    system: str | None = None


class TextRequest(BaseModel):
    text: str


@app.get("/api/health")
def health():
    return {"ok": True, "provider": llm.active_provider(), "docs": len(rag.STORE)}


@app.post("/api/chat")
def chat(req: ChatRequest):
    msgs = ([{"role": "system", "content": req.system}] if req.system else []) + req.messages
    return StreamingResponse(llm.stream(msgs), media_type="text/plain")


@app.post("/api/extract")
def extract(req: TextRequest):
    """Example structured-output endpoint: adapt the prompt to your problem."""
    return llm.complete_json(
        "Extract a JSON object with keys: summary (string), category (string), "
        f"urgency (low|medium|high), entities (list of strings).\n\nText:\n{req.text}")


@app.post("/api/docs/upload")
async def upload_doc(file: UploadFile = File(...)):
    n = rag.ingest(file.filename, await file.read())
    return {"file": file.filename, "chunks": n, "total_chunks": len(rag.STORE)}


@app.post("/api/docs/ask")
def ask_docs(req: TextRequest):
    return rag.answer(req.text)


@app.delete("/api/docs")
def clear_docs():
    rag.clear()
    return {"ok": True}


@app.post("/api/agent")
def run_agent(req: TextRequest):
    return agent.run(req.text)


@app.post("/api/vision/detect")
async def vision_detect(file: UploadFile = File(...), conf: float = Form(0.35)):
    try:
        from . import vision
        return vision.detect(await file.read(), conf=conf)
    except ImportError:
        raise HTTPException(501, "Install requirements-ml.txt for YOLO detection")


@app.post("/api/vision/describe")
async def vision_describe(file: UploadFile = File(...), question: str = Form("Describe this image.")):
    from . import vision
    return {"answer": vision.describe(await file.read(), question, file.content_type or "image/jpeg")}


# ---------- Handwriting digitizer (HNX26EPS04) ----------

@app.post("/api/handwriting")
async def handwriting_digitize(
    file: UploadFile = File(...),
    clean: bool = Form(True),
    vote: bool = Form(True),
    context: bool = Form(True),
    baseline: bool = Form(False),
    writer: str | None = Form(None),
):
    from starlette.concurrency import run_in_threadpool
    from . import handwriting
    data = await file.read()

    def work():
        result = handwriting.digitize(data, use_clean=clean, use_vote=vote, use_context=context, writer=writer)
        if baseline:  # a failed baseline must not throw away the pipeline's result
            try:
                result["baseline"] = handwriting.baseline(data)
            except Exception as e:
                result["baseline"] = ""
                result["errors"]["baseline"] = str(e)[:200]
        return result

    try:
        return await run_in_threadpool(work)  # model calls take a while; don't block other requests
    except RuntimeError as e:
        raise HTTPException(502, str(e))


class AnswerRequest(BaseModel):
    writer: str
    original: str = ""
    answer: str


@app.post("/api/handwriting/answer")
def handwriting_answer(req: AnswerRequest):
    """Review mode: the human answers a flagged word. Saved per writer; context_fix then offers it
    as a candidate on that writer's next pages (send the same `writer` form field)."""
    from . import handwriting
    try:
        n = handwriting.save_answer(req.writer, req.original, req.answer)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"ok": True, "words": n}


class TableRequest(BaseModel):
    marked: str  # the `marked` text from /api/handwriting ([[word?]] = flagged)


@app.post("/api/handwriting/table")
def handwriting_table(req: TableRequest):
    """Digitized prescription -> rows {drug, strength, form, frequency, duration, flagged}."""
    from . import handwriting
    try:
        return {"rows": handwriting.rx_table(req.marked)}
    except RuntimeError as e:
        raise HTTPException(502, str(e))


@app.get("/api/handwriting/eval")
def handwriting_eval():
    """Ablation, calibration and robustness results for the Results tab.
    Prefers the held-out test split; falls back to dev (and says so) when test files are missing."""
    import json
    from pathlib import Path
    root = Path(__file__).resolve().parent.parent

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
    words: list[dict]
    writer: str | None = None
    doc_type: str = "note"


@app.post("/api/handwriting/recontext")
def handwriting_recontext(req: RecontextRequest):
    """After a human answer: run the constrained context fix again with this writer's (now larger) word
    list, so other flagged copies of the same word can resolve. No vision calls. Words that are not
    flagged (including the human's answers, resolved_by "human") are never changed."""
    from . import handwriting
    kind = req.doc_type if req.doc_type in ("prescription", "note") else "note"
    try:
        return {"words": handwriting.context_fix(req.words, handwriting.writer_words(req.writer), kind)}
    except (RuntimeError, ValueError) as e:
        raise HTTPException(502, str(e))
