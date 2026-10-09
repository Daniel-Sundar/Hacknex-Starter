<div align="center">

# ClearScript

### Read the unreadable. Know what you don't know.

**ClearScript turns photos of messy handwriting, starting with doctors' prescriptions, into clean, checked text.**
Several AI models read every page side by side. Where they agree, the text stands. Where they disagree, ClearScript flags the word instead of guessing.

[**Live app**](https://clearscript-hacknex.onrender.com) · [Backend health](https://clearscript-hacknex-api.onrender.com/api/health) · Built at **HackNEX 2026** for **HNX26EPS04: Extreme Bad-Handwriting Digitizing Stack**

</div>

> ClearScript is a reading aid, not a medical device. Always check flagged words, drug names and doses against the original.

---

## The problem

A pharmacist squints at a prescription. Is that **amlodipine** or **amiloride**? **650 mg** or **6500**?

Phone OCR is built for print and falls apart on handwriting. A single AI model reads handwriting far better, but it **answers confidently even when it is wrong** and never says when it is unsure. On a prescription, a confident mistake can hurt someone.

## The idea

**Different models make different mistakes, so the places where they disagree are exactly where the errors hide.**

ClearScript turns that disagreement into a confidence signal you can trust. On our development set, when every model agreed on a word, it was right **937 times out of 937**.

## What it does

| | |
|---|---|
| 🗳️ **Many readers, one vote** | 3–5 independent vision models read the page in parallel. Their readings are aligned word by word and voted. |
| 🚩 **Honest flags** | A word the models disagree on is flagged, with what each model read. On prescriptions every word, and every number anywhere, needs all readers to agree. |
| 💊 **Prescription safety net** | Look-alike drug names (hydroxyzine / hydralazine) are flagged even when every model agrees. Each dose is checked against usual strengths and daily maximums. |
| ✍️ **Ask the human, then remember** | You confirm only the flagged words. Your answer is final and is remembered for that writer's next page. |
| ⚡ **Auto or Review** | **Auto** gives the best reading as clean text. **Review** walks you through every uncertain word, drugs and numbers first. |
| 🔐 **Your history, everywhere** | Sign in with Google or email (Supabase) to keep your pages and corrections across devices, or continue without an account. |
| 🌏 **Made for India** | Interface in English and 12 Indian languages. 97 common generics and 116 Indian brand names (Dolo, Augmentin, Telma…) in the safety checks. |

Also included: live progress from the server, a side-by-side comparison with a single model, a structured medicines table, export to TXT / Markdown / JSON (uncertain words stay marked `[[word?]]`, never exported as fact), a Docs Q&A tab with cited answers, light and dark themes, and full keyboard and screen-reader support.

## How it works

```
photo / scan / PDF
  → clean     denoise, contrast, deskew (OpenCV)
  → read      3–5 different vision models in parallel (Gemini, Groq, OpenRouter)
  → vote      align word by word; disagreement = flag
  → context   a constrained fix may only choose words the readers saw or known words. It never invents text or changes numbers
  → safety    look-alike drug alarm + dose sanity check (plain Python, no AI)
  → review    the user confirms flagged words; answers are remembered per writer
```

**Training-free by design.** No model is trained or fine-tuned. ClearScript combines ready-made models, so a better model can be swapped in with one setting.

## Results

> Early evidence from small labelled sets, not clinical validation.

**Full pages** (development split: 14 pages, 1,146 words)

| | Character error rate | Confident errors (wrong and not flagged) |
|---|---:|---:|
| One model | 14.4% | 152 |
| **ClearScript** | **2.6%** | **6** |

**Agreement predicts correctness:**

| Readers agreeing | Word was right |
|---|---:|
| All | 100% (937 / 937) |
| Most | 93.7% |
| Half | 79.3% |
| Few | 42.9% |

**Handwritten drug names** (39 single-word images from RxHandBD and BD-Prescription)

| | One model | ClearScript |
|---|---:|---:|
| **Confidently wrong** | **90.5%** | **15.4%** |
| Read exactly right | 9.5% | 28.2% |

The held-out test split has not been scored yet, and dose accuracy has not been measured. With 39 images, every percentage is about ±15 points. Full method and caveats: [`backend/bench/REPORT.md`](backend/bench/REPORT.md); experiment logs: [`backend/results/`](backend/results/).

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | React 19, Vite, TypeScript, Tailwind v4 |
| Backend | Python FastAPI, streaming NDJSON progress |
| AI readers | Gemini, Groq and OpenRouter vision models behind one gateway, with automatic fallback and several keys per provider |
| Data and sign-in | Supabase (Postgres, Auth, row-level security) |
| Hosting | Render (web service + static site) |

## Quick start

**You need:** Git, Python 3.11+, Node.js 22, and a free API key from at least one of [Gemini](https://aistudio.google.com/apikey), [Groq](https://console.groq.com/keys) or [OpenRouter](https://openrouter.ai/keys).

**Windows (PowerShell)**

```powershell
git clone https://github.com/Daniel-Sundar/Hacknex-Starter
cd Hacknex-Starter
git checkout feat/handwriting-mvp
powershell -ExecutionPolicy Bypass -File .\setup.ps1
notepad backend\.env                                  # add your API keys
powershell -ExecutionPolicy Bypass -File .\dev.ps1    # backend :8000, frontend :5173
```

**macOS / Linux:** `./setup.sh`, add keys to `backend/.env`, then `./dev.sh`.

Supabase is optional. Without it the app runs with no login page and keeps history in the browser. To enable it, run [`backend/supabase.sql`](backend/supabase.sql) in the Supabase SQL editor and fill in the Supabase variables in `backend/.env.example` and `frontend/.env.example`.

## Configuration

Secrets live only in `backend/.env` (git-ignored) or the hosting dashboard. Never commit them.

| Variable | Where | Purpose |
|---|---|---|
| `GEMINI_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY` | backend | Model keys |
| `GEMINI_API_KEYS`, `GROQ_API_KEYS`, `OPENROUTER_API_KEYS` | backend | Optional extra keys, comma-separated; used in turn when one hits its quota |
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | backend | Reading cache and writer profiles that survive restarts (secret key, server only) |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | frontend | Sign-in and per-user history (publishable key only) |
| `VITE_API_URL` | frontend | Backend URL when hosted |
| `HW_READERS`, `HW_FLAG_RULE`, `HW_FLAG_RULE_RX` | backend | Which models vote and how many must agree |
| `RATE_LIMIT_OFF` | backend | `1` disables rate limits for a judging slot |

Every variable is documented in [`backend/.env.example`](backend/.env.example).

## API

All routes are under `/api`. Errors always look like `{"detail": {"code", "message"}}`.

| Route | Purpose |
|---|---|
| `GET /api/health` | Status, active readers, database status |
| `POST /api/handwriting/stream` | Digitize a page with live progress events |
| `POST /api/handwriting` | Same, as a single response |
| `POST /api/handwriting/answer` | Save a confirmed word to a writer profile |
| `POST /api/handwriting/table` | Prescription → medicines table with safety warnings |
| `POST /api/docs/upload`, `POST /api/docs/ask` | Docs Q&A |

## Project structure

```
backend/
  app/            main.py (routes) · handwriting.py (pipeline) · rx_safety.py (drug checks)
                  llm.py (model gateway) · store.py (Supabase) · rag.py (Docs Q&A)
  data/           labelled samples, drug lists, test prescriptions
  bench/          drug-name benchmark and report
  results/        evaluation and tuning results
  tests/          pytest suite
  eval.py · tune.py · augment.py · supabase.sql
frontend/src/
  pages/          Handwriting (+ clearscript/), Docs (+ docs/), Login
  components/     shared UI, intro animation, account menu
  lib/            API client, auth, history, exporters
  i18n/           English source and 12 Indian languages
render.yaml       one-click Render deploy
```

## Evaluation

From `backend/`:

```powershell
.venv\Scripts\python -m pytest                 # 69 tests, no network
.venv\Scripts\python eval.py --split dev       # ablation and calibration
.venv\Scripts\python eval.py --split test      # held-out numbers (run once, never tune on them)
```

## Privacy

- Pages are sent to third-party AI providers (Google, Groq, OpenRouter) to be read. Use only data you are allowed to share.
- The server keeps model readings as text, never the images. Signed-in history is protected by row-level security, so each user sees only their own pages.
- API keys never reach the browser.
- Not yet: encryption at rest or health-data compliance. Don't use real patient data without consent.

## Limitations

- Small evaluation sets, and the held-out test split is not scored yet.
- Dose and frequency accuracy not measured.
- The drug list is a curated set of common Indian medicines, not the full national list.
- Free-tier quotas limit throughput, and the free Render server sleeps when idle.
- Tuned for English handwriting; Indian-script handwriting is not evaluated. Interface translations are machine drafts.

## Roadmap

Flag boxes drawn on the photo · Tamil and English mixed script · the full National List of Essential Medicines · pharmacy system integration · self-hosted models for privacy and cost.

---

<div align="center">

**Team:** Daniel S · Ajay · Aaron · Gladys. HackNEX 2026, Karunya, Coimbatore.

*Several models read. Disagreements are surfaced. Nothing uncertain is presented as fact.*

</div>
