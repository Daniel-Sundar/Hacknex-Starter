# ClearScript: reading the handwriting nobody can read

HackNEX 2026 · problem **HNX26EPS04, Extreme Bad-Handwriting Digitizing Stack**.

## The problem
Prescriptions, clinic notes, forms and old records are still handwritten, often illegibly. Normal OCR fails on
bad handwriting, and a single AI model **guesses confidently even when it is wrong**. On a prescription, a
confidently wrong drug name or dose can hurt someone.

ClearScript turns bad handwriting into clean, editable text and **flags the words it is not sure about instead
of guessing**, so a human only checks those few words.

## The pipeline
```
photo / scan / PDF
  → prepare   PDF → page image, huge photos resized
  → clean     OpenCV: denoise, contrast (CLAHE), deskew
  → read      3–5 different vision models read the page in parallel (Groq Qwen, Gemini, OpenRouter dots / Gemma)
  → vote      align the readings word by word, majority vote; disagreement = flag
              (prescriptions: every reader must agree; numbers and doses always need every reader)
  → context   a constrained fix may only pick the readers' own words or dictionary / writer-confirmed words
  → human     "Ask the human": the user answers flagged words; answers are final and remembered per writer
```
No model is trained or fine-tuned: the system is training-free and combines pretrained vision models. The pipeline
settings (which readers vote, how many must agree) were chosen on a dev split and measured on a held-out test split.

Code: `backend/app/handwriting.py` (pipeline), `backend/app/main.py` (routes `/api/handwriting`, `/answer`,
`/recontext`, `/table`, `/eval`), `backend/eval.py` (ablation, calibration, robustness), `backend/tune.py`
(settings search), `backend/augment.py` (degraded copies), `frontend/src/pages/Handwriting.tsx` and `Results.tsx`.

## Results
> **Dev split so far** (14 labelled samples, 1146 words). The held-out **test split** numbers replace this after
> the final run (`eval.py --split test`); the app's **Results** tab always shows the latest.

| Variant | CER | WER | Confident errors (wrong, not flagged) | Flag recall |
|---|---|---|---|---|
| Baseline: one model, one pass | 14.4% | 17.8% | 152 | 0% |
| Clean, single reader | 11.7% | 16.9% | 166 | 0.6% |
| Clean + vote | 2.6% | 3.3% | 6 | 80.0% |
| **Clean + vote + context (ClearScript)** | **2.6%** | **3.2%** | **6** | **79.3%** |

Calibration: when all readers agree, the word was right **100%** of the time (937/937 words); most agree 93.7%,
half agree 79.3%, few agree 42.9%. That is why disagreement is a reliable flag.

## Run it on Windows
```powershell
git clone https://github.com/Daniel-Sundar/Hacknex-Starter
cd Hacknex-Starter
git checkout feat/handwriting-mvp
powershell -ExecutionPolicy Bypass -File .\setup.ps1
notepad backend\.env                                    # paste GEMINI_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY
powershell -ExecutionPolicy Bypass -File .\dev.ps1      # backend :8000, frontend :5173, opens the browser
```
The **Sample** button works with no keys. Evaluate (from `backend\`):
```powershell
.venv\Scripts\python eval.py --split test            # ablation + calibration -> eval_results_test.md/.json
.venv\Scripts\python augment.py                      # blurred / dark / noisy / rotated / phone copies
.venv\Scripts\python eval.py --robustness --split test
.venv\Scripts\python tune.py                          # settings search on dev, offline (cached readings)
```
Free tiers are small (Gemini 20 requests/day/model, OpenRouter free 50/day, Groq 200k tokens/day). Every model
answer is cached in `backend/.cache/`, so re-runs are free; `HW_CACHE_ONLY=1` replays the cache with no vision calls.

## Settings (`backend/.env`)
| Variable | Default | What it does |
|---|---|---|
| `HW_READERS` | Groq Qwen, 2 Gemini slots with spares, OpenRouter dots, Gemma | Voters, comma-separated `provider:model`; `\|` lists spares for one voter |
| `HW_BASELINE` | `groq:qwen/qwen3.8-27b` | The single-model baseline we compare against |
| `HW_FLAG_RULE` | `two_thirds` | How many readers must agree to trust a word: `majority`, `two_thirds`, `unanimous` |
| `HW_FLAG_RULE_RX` | `unanimous` | The same rule for prescriptions |
| `HW_DIGITS_STRICT` | `1` | Any disagreement on a number is flagged |
| `HW_DROP_MINORITY` | `1` | A word fewer than half the readers saw is dropped |
| `HW_REREAD_MODE` | `off` | Context-aware re-read of flagged words: `vote`, `suggest`, `off` (off won on dev) |
| `HW_PROMPT` | `v1` | Reading instruction version (`v2` also ignores printed text and crossed-out words) |
| `HW_VOTE_DEADLINE` | `25` | Seconds to wait for readers before voting with whoever answered |
| `HW_READ_TIMEOUT` | `90` | Seconds per model call |
| `HW_RETRY_WAIT` | `2` | Wait before the single retry on a 429 / 503 |
| `HW_CACHE_ONLY` | unset | `1` = never call vision models, replay the cache (experiments) |

---

## Starter template notes
The app grew out of the HackNEX starter (FastAPI + React). The original notes follow.

### Setup on a new laptop (Windows)

Install first: **Git** (git-scm.com), **Python 3.12** (python.org, tick "Add python.exe to PATH"), **Node.js 22 LTS** (nodejs.org).

```powershell
git clone https://github.com/Daniel-Sundar/Hacknex-Starter
cd Hacknex-Starter
powershell -ExecutionPolicy Bypass -File .\setup.ps1 -ML   # drop -ML for the light version
notepad backend\.env                                        # paste the API keys
powershell -ExecutionPolicy Bypass -File .\dev.ps1          # opens backend + frontend + browser
```

`dev.ps1` opens two PowerShell windows (backend on :8000, frontend on :5173); close them to stop.
`-ML` adds CPU PyTorch, YOLO, embeddings and pre-downloads the model weights (~1 GB, do it on home Wi-Fi).

macOS/Linux teammates can use `./setup.sh --ml` and `./dev.sh` instead.

### LLM providers (all free tiers)

Set `LLM_PROVIDER` in `backend/.env`; `LLM_FALLBACKS` is tried in order when a call fails.

| Provider | Get a key | Notes |
|---|---|---|
| `claude` | https://platform.claude.com (API credits, separate from Claude Pro) | Chat, Docs Q&A and Vision via the Anthropic SDK. Default model `claude-opus-5-5`; set `CLAUDE_MODEL=claude-haiku-5-5` to stretch credits. The Agent tab skips Claude and uses the next provider in `LLM_FALLBACKS` |
| `gemini` | https://aistudio.google.com/apikey | Default. Multimodal, so the Vision "Ask" button works |
| `groq` | https://console.groq.com/keys | Very fast Llama; great for agents |
| `openrouter` | https://openrouter.ai/keys | Default `openrouter/free` picks a free model for you |
| `ollama` | https://ollama.com | Fully offline. `ollama pull llama3.2:3b`. Your Edge AI story |
| `mock` | none | Echo bot for UI work with zero keys |

Override models with `GEMINI_MODEL`, `GROQ_MODEL`, `OPENROUTER_MODEL`, `OLLAMA_MODEL`.

### Deploy

- **Backend → Render:** New → Blueprint → this repo (uses `render.yaml`). Add keys in the dashboard. Free tier sleeps when idle: open it a minute before the demo. The light requirements are used; YOLO is too heavy for the free tier, so demo CV locally or via a tunnel.
- **Frontend → Vercel:** import repo, root directory `frontend`, set `VITE_API_URL` to the Render URL.
- **Fastest fallback:** run locally and expose it with `cloudflared tunnel --url http://localhost:5173` (or `ngrok http 5173`).

### Adapting it tomorrow (with Claude Code)

`CLAUDE.md` describes the structure, so prompts like these work well:
- "Rename the app to X. Replace the Chat tab with a page that does Y using `llm.complete_json`."
- "Add an agent tool `lookup_bus_timings(route)` that reads `data/buses.csv`."
- "Add a Dashboard tab that charts detection counts over time."

Delete the tabs you don't need: judges should see one focused product, not a toolbox.

### Project layout

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
