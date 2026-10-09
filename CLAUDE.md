# HackNEX starter: notes for Claude Code

24-hour hackathon project. Speed and a working demo matter more than perfect code.

## Start here
The app is **ClearScript** (handwriting digitizer, branch `feat/handwriting-mvp`). Before doing anything, read
`docs/HANDOFF.md`: it lists what is done, what is left (in order) and known issues.
Pipeline: `backend/app/handwriting.py`; prescription safety checks: `backend/app/rx_safety.py`; UI:
`frontend/src/pages/Handwriting.tsx`. Evaluate with `backend/eval.py` (dev split for tuning, test split only for
the final numbers). Several people push to this branch: `git pull --rebase` before you start and before you push.

## Stack
- `backend/`: FastAPI (Python 3.11+). Entry `app/main.py`. All routes under `/api`.
  - `app/llm.py`: the ONLY place that talks to LLMs. Use `llm.chat()`, `llm.stream()`, `llm.complete_json()`.
    Providers: gemini, groq, openrouter, ollama, mock (OpenAI-compatible) plus claude (`app/claude_provider.py`, Anthropic SDK), with automatic fallback.
  - `app/rag.py`: in-memory RAG for Docs Q&A. `app/store.py`: optional Supabase storage.
  - `app/handwriting.py` + `app/rx_safety.py`: the ClearScript pipeline (see README).
- `frontend/`: React 19 + Vite + TypeScript + Tailwind v4 + lucide-react icons.
  - Pages in `src/pages/`, registered in the `TABS` array in `src/App.tsx`.
  - Shared UI in `src/components/ui.tsx` (`Card`, `Button`, `ErrorNote`, `inputCls`). Reuse them.
  - API helpers in `src/lib/api.ts` (`postJSON`, `postForm`, `streamChat`). Dev server proxies `/api` to :8000.

## Conventions
- Light and dark themes from tokens in `src/index.css` (`bg-surface`, `text-ink`, `text-body`, `text-muted`, `bg-accent`,
  `text-accent-text`, `flag-*`, `danger-*`, `ok-*`, `info-*`). `bg-brand` is an old alias of `accent`. Never use raw colours.
- App styles are scoped to `.cs-app`. The intro (`JournalIntro`, `journal-intro.css`, `public/intro/`, `PenAnimation`,
  `public/pen/`) and `LegacyLoadingCard` must not change; render them outside `.cs-app` or leave them alone.
- Shared UI: `Button`, `IconButton`, `Panel`, `Dialog` (native `<dialog>`), `Toggle`, `DropZone`, `ErrorState`, `Notice`,
  `useToast()` in `src/components/ui.tsx`. Every async action shows a loading state and an `ErrorState` with retry.
- Every user-facing string goes through `t("key")` (`src/i18n/en/*.ts` is the source; `locales/*.ts` are machine drafts that
  fall back to English). Backend errors are `{"detail": {"code", "message"}}`; map new codes in `src/lib/errors.ts`.
- Never hardcode API keys; read them from env in the backend only.
- Keep new features as a new page + a new router section in `main.py` rather than editing many files.

## Run
- Backend: `cd backend && uvicorn app.main:app --reload --port 8000`
- Frontend: `cd frontend && npm run dev` (http://localhost:5173)
- Team is on Windows: `.\setup.ps1` / `.\dev.ps1` (PowerShell). Use PowerShell syntax in any commands you suggest.
- `LLM_PROVIDER=mock` works with no keys at all.
