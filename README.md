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
  → safety    prescriptions only: look-alike drug names flagged even when every reader agrees; each medicine row
              checked against usual strengths and the usual adult maximum per day (no model calls)
  → human     "Ask the human": the user answers flagged words; answers are final and remembered per writer
```
No model is trained or fine-tuned: the system is training-free and combines pretrained vision models. The pipeline
settings (which readers vote, how many must agree) were chosen on a dev split and measured on a held-out test split.

Code: `backend/app/handwriting.py` (pipeline), `backend/app/rx_safety.py` (look-alike drugs, dose check),
`backend/app/main.py` (routes `/api/handwriting`, `/answer`, `/recontext`, `/table`, `/eval`), `backend/eval.py`
(ablation, calibration, robustness), `backend/tune.py` (settings search), `backend/augment.py` (degraded copies),
`frontend/src/pages/Handwriting.tsx`.

## Prescription safety (`backend/app/rx_safety.py`)
Voting catches readers that disagree. It cannot catch every reader making the same mistake, and on a prescription
that mistake can be a different drug or a 10x dose. Two checks run on prescriptions only, as plain Python:
- **Look-alike drug alarm.** A drug name one or two letters from a *different* drug (hydroxyzine / hydralazine,
  amlodipine / amiloride, prednisone / prednisolone; ISMP confused-name pairs plus a spelling-distance rule) is
  flagged even when every reader agreed. The UI shows it in red and offers the other drugs as answers in
  "Ask the human". The look-alikes are kept out of `alternatives`, so the context step can never swap in a drug no
  reader saw.
- **Dose sanity check.** Each row of the prescription table is checked against usual strengths and the usual adult
  maximum per day for about 30 common drugs (brand names like Dolo, Augmentin, Pan map to the generic). It catches
  650 read as 6500, thyroxine written in mg instead of mcg (1000x), `10-10-10`, `500 g`. A warning never changes
  the text; the row turns red with the reason. The reference values are a safety net for reading errors, not
  clinical advice.

Test it with the synthetic prescriptions in `backend/data/handwriting/rx_test/` (expected results in its README).

## Results
> **Dev split so far** (14 labelled samples, 1146 words). The held-out **test split** numbers replace this after
> the final run (`eval.py --split test`); `GET /api/handwriting/eval` always returns the latest.

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
| `HW_VOTE_DEADLINE` | `60` | Seconds per page to wait for every reader; the vote starts as soon as all have answered |
| `HW_READ_TIMEOUT` | `90` | Seconds per model call |
| `HW_RETRY_WAIT` | `2` | Wait before the single retry on a 429 / 503 |
| `HW_CACHE_ONLY` | unset | `1` = never call cloud vision models, replay the cache (experiments); local `ollama:` readers still run |
| `HW_TIDY` | `1` | Strip formatting a model wraps around its reading (`['…']`, quotes, code fences) before the vote |
| `HW_JOIN_SPLITS` | `1` | Join a word one reader split in two ("Ni dazyl") when another reader wrote it whole ("Nidazyl") |
| `HW_DICTIONARY_FIX` | `1` | A flagged word becomes a dictionary word only when a strict majority of readers read something within one letter of it; never touches numbers. Word lists: `backend/data/lexicon.txt`, writer words and every `backend/data/knowledge/*.txt` (246 drug names shipped) |

A model whose upstream host fails (OpenRouter "Provider returned error") is skipped for 5 minutes instead of being
retried on every page.

The text-only steps (context fix, prescription table) use `LLM_PROVIDER` then `LLM_FALLBACKS`. Ajay's `.env` ends the
fallbacks with `ollama` and sets `OLLAMA_MODEL=nemotron-mini`, so those steps still work offline when every cloud
quota is gone (lower quality: it garbles some table columns, so it is a last resort only).

## Status and to-do (handoff, updated 2026-10-09)
Written so a teammate or their Claude Code can pick up from here. Work top to bottom.

**Done**
- Full pipeline: clean → 5 cloud readers vote → context fix → "Ask the human"; dev results above.
- Prescription safety: look-alike drug alarm + dose sanity check, tested on `backend/data/handwriting/rx_test/`.
- Prescription table keeps a row flagged even when a small model drops the `[[word?]]` marks.
- Results tab removed from the UI (page file and `/api/handwriting/eval` kept).
- UI redesign from the product audit (2026-10-08): calm light/dark theme, one drop zone plus camera, live stages from
  `POST /api/handwriting/stream`, per-model readings for every flagged word, confirm/correct dialog, export (txt, md,
  json; unresolved words are marked, never stated as fact), browser-local history, 12 Indian languages (machine
  drafts, English fallback), clear error states. Backend: upload checks, error codes, rate limits (`RATE_LIMIT_*`,
  `RATE_LIMIT_OFF=1` to disable), `backend/tests/` (`pytest`). Rollback point: branch `checkpoint/before-audit-redesign`.
- **Drug-name benchmark on RxHandBD + BD-Prescription (Mendeley Data): full report in
  [`backend/bench/REPORT.md`](backend/bench/REPORT.md).** 39 test images. Single model: 9.5% exact, confidently
  wrong on 90.5%. ClearScript: 28.2% exact, flags 61.5%, confidently wrong on 15.4% (2 of those 6 are dataset label
  errors). Fixes from it are in the pipeline (`HW_TIDY`, `HW_JOIN_SPLITS`, `HW_DICTIONARY_FIX`); on the team's dev
  pages they lowered CER 2.6% to 2.3% with confident errors unchanged.

**To do, in order**
0. **Benchmark follow-ups** (details in `backend/bench/REPORT.md` §12): require every reader to agree on drug-name
   words everywhere (measured offline: confident errors 6 to 4), add a big Indian drug-name list to
   `backend/data/knowledge/`, and finish the remaining 81 benchmark images with fresh quota
   (`.venv\Scripts\python bench/words.py run --min-readers 3 --sleep 45`; needs the extracted datasets, see the
   report). Raw results stay local (`backend/bench/results/` is git-ignored).
1. **Run the held-out test split** (7 pages: a01, a07, a08, a10, a11, a15, a19). There is no `eval_results_test.json`
   yet, so the numbers above are still dev only. From `backend\`: `.venv\Scripts\python eval.py --split test`. It
   spends free quota, so run it early in the day. Then put the test numbers in the Results section above and in the
   pitch, and say "held-out".
2. **Robustness on the test split.** `eval_robustness.md` covers only 2 samples, too few to quote:
   `.venv\Scripts\python augment.py` then `.venv\Scripts\python eval.py --robustness --split test`.
3. **Grow the drug list.** Done in part: `backend/data/knowledge/drugs.txt` (246 names from `rx_safety.py` plus
   common Indian generics and brands) feeds the dictionary step. A much larger Indian brand list would help more.
   Re-run the dev eval afterwards to check nothing got worse.
4. **Study the 6 confident errors** (wrong words nobody flagged) in `eval_results_dev.json` → `per_sample`. Find a
   rule that would have flagged each kind; check it on dev only, never tune on test.
5. **Demo-proof.** Run every image you will show (including `rx_test/`) through the app once so it is cached, then
   check the demo works with `HW_CACHE_ONLY=1` in `.env` (no internet needed for cached pages). The **Sample**
   button always works offline and shows a look-alike drug (Amlodipine).
6. **Keep the Docs Q&A tab** (Daniel wants it in the demo). Do not remove it.
7. **Pitch deck and demo script**, practised twice. Story: one model guesses confidently → voting flags
   disagreement (calibration: all agree = 100% right) → but agreement is not enough on a prescription →
   look-alike drugs and impossible doses are caught too → a human checks only the flagged words.

**Nice to have, only with spare time:** export the prescription table (CSV / PDF); highlight flagged words on the
photo.

**Known issues**
- **Local vision reader (Ollama `qwen2.5vl:3b`) does not work on Ajay's laptop.** On the RTX 5050 GPU it outputs
  `@@@@…` on real handwriting photos (Ollama 0.34.4 aborts with "token repeat limit reached"); on CPU it reads
  correctly but takes 45–75 s per page. It is not in `HW_READERS`. Worth retrying after an Ollama update; on a
  machine where it works, add `,ollama:qwen2.5vl:3b` to `HW_READERS` and compare on dev before keeping it.
- Free tiers: Gemini 20 requests/day/model, so pages often get 3–4 of the 5 readers (dev average 3.6). Groq's
  vision reader also has a 200,000 tokens/day cap (about 75 page reads).
- OpenRouter's free Gemma models failed upstream on every request during the 2026-10-09 benchmark.
- `backend/.env` holds API keys and is git-ignored. Never commit it or a copy of it.

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
