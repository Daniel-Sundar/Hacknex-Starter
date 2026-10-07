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
