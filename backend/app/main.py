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
