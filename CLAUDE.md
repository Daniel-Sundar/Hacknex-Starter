# HackNEX starter: notes for Claude Code

24-hour hackathon project. Speed and a working demo matter more than perfect code.

## Stack
- `backend/`: FastAPI (Python 3.11+). Entry `app/main.py`. All routes under `/api`.
  - `app/llm.py`: the ONLY place that talks to LLMs. Use `llm.chat()`, `llm.stream()`, `llm.complete_json()`.
    Providers are OpenAI-compatible (gemini, groq, openrouter, ollama, mock) with automatic fallback.
  - `app/rag.py`: in-memory RAG (ingest/search/answer).
  - `app/agent.py`: tool-calling loop. New tool = Python function + JSON schema in `TOOLS`.
  - `app/vision.py`: YOLO detection + vision-LLM Q&A (needs `requirements-ml.txt`).
- `frontend/`: React 19 + Vite + TypeScript + Tailwind v4 + lucide-react icons.
  - Pages in `src/pages/`, registered in the `TABS` array in `src/App.tsx`.
  - Shared UI in `src/components/ui.tsx` (`Card`, `Button`, `ErrorNote`, `inputCls`). Reuse them.
  - API helpers in `src/lib/api.ts` (`postJSON`, `postForm`, `streamChat`). Dev server proxies `/api` to :8000.

## Conventions
- Dark UI, brand colour `bg-brand` / `text-brand` (set in `src/index.css`).
- Every async action shows a loading state and an `ErrorNote` on failure.
- Never hardcode API keys; read them from env in the backend only.
- Keep new features as a new page + a new router section in `main.py` rather than editing many files.

## Run
- Backend: `cd backend && uvicorn app.main:app --reload --port 8000`
- Frontend: `cd frontend && npm run dev` (http://localhost:5173)
- Team is on Windows: `.\setup.ps1` / `.\dev.ps1` (PowerShell). Use PowerShell syntax in any commands you suggest.
- `LLM_PROVIDER=mock` works with no keys at all.
