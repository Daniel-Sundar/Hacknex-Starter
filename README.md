# HackNEX 2026 Starter

A ready-to-fork AI app skeleton for HackNEX (Gen AI · Agentic AI · Computer Vision · Edge AI).
FastAPI backend + React/Vite/Tailwind frontend with four working modules:

| Tab | What it does | Backend |
|---|---|---|
| **Chat** | Streaming chat with markdown | `POST /api/chat` |
| **Docs Q&A** | Upload PDFs/text, ask questions, answers cite sources (RAG) | `/api/docs/upload`, `/api/docs/ask` |
| **Agent** | Tool-calling agent, shows each tool step | `POST /api/agent` |
| **Vision** | Upload or webcam snapshot → YOLO detection + counts, or ask a vision LLM about the image | `/api/vision/detect`, `/api/vision/describe` |

Plus `POST /api/extract` (structured JSON output) as a template for classification/extraction features.

## Tonight: setup on every laptop (Windows)

Install first: **Git** (git-scm.com), **Python 3.12** (python.org, tick "Add python.exe to PATH"), **Node.js 22 LTS** (nodejs.org).

```powershell
git clone https://github.com/Daniel-Sundar/hacknex-starter
cd hacknex-starter
powershell -ExecutionPolicy Bypass -File .\setup.ps1 -ML   # drop -ML for the light version
notepad backend\.env                                        # paste the API keys
powershell -ExecutionPolicy Bypass -File .\dev.ps1          # opens backend + frontend + browser
```

`dev.ps1` opens two PowerShell windows (backend on :8000, frontend on :5173); close them to stop.
`-ML` adds CPU PyTorch, YOLO, embeddings and pre-downloads the model weights (~1 GB, do it on home Wi-Fi).

macOS/Linux teammates can use `./setup.sh --ml` and `./dev.sh` instead.

## LLM providers (all free tiers)

Set `LLM_PROVIDER` in `backend/.env`; `LLM_FALLBACKS` is tried in order when a call fails.

| Provider | Get a key | Notes |
|---|---|---|
| `gemini` | https://aistudio.google.com/apikey | Default. Multimodal, so the Vision "Ask" button works |
| `groq` | https://console.groq.com/keys | Very fast Llama; great for agents |
| `openrouter` | https://openrouter.ai/keys | Use `:free` models |
| `ollama` | https://ollama.com | Fully offline. `ollama pull llama3.2:3b`. Your Edge AI story |
| `mock` | none | Echo bot for UI work with zero keys |

Override models with `GEMINI_MODEL`, `GROQ_MODEL`, `OPENROUTER_MODEL`, `OLLAMA_MODEL`.

## Deploy

- **Backend → Render:** New → Blueprint → this repo (uses `render.yaml`). Add keys in the dashboard. Free tier sleeps when idle: open it a minute before the demo. The light requirements are used; YOLO is too heavy for the free tier, so demo CV locally or via a tunnel.
- **Frontend → Vercel:** import repo, root directory `frontend`, set `VITE_API_URL` to the Render URL.
- **Fastest fallback:** run locally and expose it with `cloudflared tunnel --url http://localhost:5173` (or `ngrok http 5173`).

## Adapting it tomorrow (with Claude Code)

`CLAUDE.md` describes the structure, so prompts like these work well:
- "Rename the app to X. Replace the Chat tab with a page that does Y using `llm.complete_json`."
- "Add an agent tool `lookup_bus_timings(route)` that reads `data/buses.csv`."
- "Add a Dashboard tab that charts detection counts over time."

Delete the tabs you don't need: judges should see one focused product, not a toolbox.

## Project layout

```
backend/app/
  main.py     routes
  llm.py      provider switch + fallback (chat, stream, complete_json)
  rag.py      ingest / search / answer
  agent.py    tool-calling loop + tools
  vision.py   YOLO detect, vision-LLM describe, ONNX export
frontend/src/
  App.tsx     header + tabs
  pages/      Chat, Docs, Agent, Vision
  components/ui.tsx, lib/api.ts
```
