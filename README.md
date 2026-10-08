# ClearScript

**Multi-model handwriting digitisation that shows disagreement instead of guessing.**

ClearScript turns photos of hard-to-read handwriting into editable text. It is built for doctors' prescriptions and clinic notes. Several independent AI vision models read every page. Where they agree, the text is accepted. Where they disagree, ClearScript flags the word and shows what each model read, so a person checks only those words.

Built at HackNEX 2026 (Karunya, Coimbatore) for problem statement **HNX26EPS04: Extreme Bad-Handwriting Digitizing Stack**.

> ClearScript is a reading aid, not a medical device. Always check flagged words, drug names and doses against the original.

---

## Contents
- [Why ClearScript](#why-clearscript)
- [How it works](#how-it-works)
- [Features](#features)
- [Results](#results)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [API](#api)
- [Evaluation](#evaluation)
- [Project structure](#project-structure)
- [Privacy and security](#privacy-and-security)
- [Limitations](#limitations)
- [Team](#team)

---

## Why ClearScript

Prescriptions, clinic notes, forms and old records are still handwritten, often illegibly. Normal OCR is built for print and fails on bad handwriting.

Modern vision language models read handwriting much better, but a single model **answers confidently even when it is wrong**, and never says when it is unsure. On a prescription, a confidently wrong drug name or dose can hurt someone.

ClearScript's answer is to **measure uncertainty instead of hiding it**. Different models make different mistakes, so the places where they disagree are where the errors are. On our development set, when every model agreed on a word, it was right 937 times out of 937.

## How it works

```
photo / scan / PDF
  → validate  file type checked by content, size and pixel limits
  → prepare   PDF → page image; very large photos resized
  → clean     OpenCV: denoise, contrast (CLAHE), deskew
  → read      3–5 different vision models read the page in parallel
              (Groq Qwen, Google Gemini, OpenRouter dots / Gemma)
  → vote      readings aligned word by word, majority vote; disagreement = flag
              prescriptions: every reader must agree; numbers always need every reader
  → context   a constrained fix may only choose the readers' own words,
              dictionary words or words the writer has confirmed. It never invents text.
  → safety    prescriptions only, no AI: look-alike drug names are flagged even when every
              reader agrees, and each dose is checked against usual strengths and daily maximums
  → review    the user confirms or corrects flagged words; answers are final and
              remembered per writer
```

No model is trained or fine-tuned: ClearScript is **training-free** and combines pretrained models, so a better model can be swapped in by changing one setting. The pipeline settings were chosen on a development split only.

### Prescription safety

Voting catches readers that disagree. It cannot catch every reader making the same mistake, and on a prescription that mistake can be a different drug or a 10× dose. Two plain-Python checks in `backend/app/rx_safety.py` cover that case:

- **Look-alike drug alarm.** A drug name close to a *different* drug is flagged even when every reader agreed. Examples are hydroxyzine / hydralazine, amlodipine / amiloride and prednisone / prednisolone. The check uses ISMP's confused-name pairs plus a spelling-distance rule. The other drugs are offered as answers, but never fed to the context step, so it can't swap in a drug nobody read.
- **Dose sanity check.** Each prescription row is checked against usual strengths and the usual adult daily maximum for about 30 common drugs. Brand names such as Dolo, Augmentin and Pan map to their generic. It catches 650 read as 6500, thyroxine in mg instead of mcg, `10-10-10` and `500 g`. A warning never changes the text: the row turns red and gives the reason.

The reference values are a safety net for reading errors, not clinical advice.

## Features

| Area | What you get |
|---|---|
| **Input** | Drag and drop, file picker, paste, or phone camera (capture, preview, then retake or use). JPG, PNG, WEBP and PDF, checked in the browser and on the server. |
| **Live progress** | Real stages streamed from the server: cleaning, each model as it answers or fails, then voting and the context fix. No fake progress bars. |
| **Results** | Full transcript with every uncertain word marked. Model agreement and model count. Verdict showing how many words need checking. A notice when some models failed. |
| **Word review** | For any flagged word: what each model read, candidate answers (keys 1–9), or a typed correction. Review mode walks through flags with numbers and doses first. |
| **Prescriptions** | A structured medicines table (drug, strength, form, frequency, duration) with look-alike and dose warnings. |
| **Baseline comparison** | A side-by-side diff against a single model, so you can see what one model would have got wrong. |
| **Writer profiles** | Optional. Confirmed words are remembered per writer and used for that writer's later pages. |
| **Export** | TXT, Markdown and JSON. Unresolved words stay marked `[[word?]]` and are listed as needing verification. They are never exported as fact. |
| **History** | The last 20 results, stored only in your browser, and deletable at any time. |
| **Docs Q&A** | Upload PDF, TXT, MD or CSV files and ask questions. Answers come from your files with numbered citations, and are marked "grounded" only when they cite a retrieved passage. |
| **Accessibility** | Keyboard operable throughout, native dialogs with focus handling, visible focus, screen-reader labels and live regions, reduced-motion support, and a light/dark theme. Targets WCAG 2.2 AA (keyboard- and browser-tested; no formal audit). |
| **Languages** | Interface in English plus 12 Indian languages: हिन्दी, தமிழ், తెలుగు, ಕನ್ನಡ, മലയാളം, বাংলা, मराठी, ગુજરાતી, ਪੰਜਾਬੀ, ଓଡ଼ିଆ, অসমীয়া and اردو (right-to-left). The non-English text is machine-drafted and not yet reviewed. |

A **Try a sample** button shows a full labelled example result with no API keys.

## Results

> All numbers are from small labelled sets and should be read as early evidence, not clinical validation.

### Full pages (development split: 14 labelled samples, 1,146 words)

| Variant | CER | WER | Confident errors (wrong, not flagged) | Flag recall |
|---|---:|---:|---:|---:|
| Baseline: one model, one pass | 14.4% | 17.8% | 152 | 0% |
| Clean, single reader | 11.7% | 16.9% | 166 | 0.6% |
| Clean + vote | 2.6% | 3.3% | 6 | 80.0% |
| **Clean + vote + context (ClearScript)** | **2.6%** | **3.2%** | **6** | **79.3%** |

How these are measured:
- **CER and WER** are the character and word error rates: the share of characters or words you would have to fix.
- **Flag recall** is the share of wrong words that ClearScript flagged.
- **Calibration:** how often a word was right, by how many readers agreed on it.

| Readers agreeing | Word was right |
|---|---:|
| All | 100% (937 / 937 words) |
| Most | 93.7% |
| Half | 79.3% |
| Few | 42.9% |

This calibration is why disagreement works as a flag.

The **held-out test split** (7 pages) has not been scored yet, so these numbers are development-split only.

### Handwritten drug names (RxHandBD + BD-Prescription, 39 test images)

| | Single model | ClearScript |
|---|---:|---:|
| Drug name read exactly right | 9.5% | 28.2% |
| **Confidently wrong** | **90.5%** | **15.4%** |

On the same images, confident mistakes fell from 19 to 2. Two of ClearScript's remaining 6 confident errors are verified mistakes in the dataset labels.

Further fixes found with this benchmark reached 38.5% exact and 10.3% confidently wrong. Those settings were chosen on these same images, so treat them as optimistic until they are re-checked on fresh images. With 39 images, every percentage is roughly ±15 points.

Dose, frequency and duration accuracy has **not** been measured yet: the datasets contain single words only. The full report, with the datasets, method and caveats, is in [`backend/bench/REPORT.md`](backend/bench/REPORT.md).

## Quick start

**Requirements:**
- Git
- Python 3.11 or newer (3.12 recommended)
- Node.js 22 LTS
- API keys for at least one vision provider; free tiers work:
  - [Gemini](https://aistudio.google.com/apikey)
  - [Groq](https://console.groq.com/keys)
  - [OpenRouter](https://openrouter.ai/keys)

### Windows (PowerShell)

```powershell
git clone https://github.com/Daniel-Sundar/Hacknex-Starter
cd Hacknex-Starter
git checkout feat/handwriting-mvp
powershell -ExecutionPolicy Bypass -File .\setup.ps1
notepad backend\.env                                    # add GEMINI_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY
powershell -ExecutionPolicy Bypass -File .\dev.ps1      # backend on :8000, frontend on :5173, opens the browser
```

### macOS / Linux

```bash
./setup.sh
$EDITOR backend/.env
./dev.sh
```

### Manual start

```bash
cd backend && uvicorn app.main:app --reload --port 8000
cd frontend && npm install && npm run dev               # http://localhost:5173
```

**No keys?** Use **Try a sample** in the app, or set `LLM_PROVIDER=mock` for the text-only features.

## Configuration

All settings live in `backend/.env`, which is git-ignored. Never commit it. `backend/.env.example` lists every variable.

### Pipeline

| Variable | Default | What it does |
|---|---|---|
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

A model whose upstream host fails is skipped for 5 minutes instead of being retried on every page.

The text-only steps (the context fix and the prescription table) use `LLM_PROVIDER`, then `LLM_FALLBACKS` in order. Supported providers:
- `gemini`, `groq`, `openrouter`;
- `claude`, via the Anthropic SDK;
- `ollama`, local and offline;
- `mock`, with no keys.

### Limits and protection

| Variable | Default | What it does |
|---|---|---|
| `MAX_UPLOAD_MB` | `15` | Largest page upload |
| `DOCS_MAX_UPLOAD_MB` | `10` | Largest Docs Q&A upload |
| `RATE_LIMIT_DIGITIZE` | `10/60` | Digitizations per IP per window (requests/seconds) |
| `RATE_LIMIT_DOCS_UPLOAD`, `RATE_LIMIT_DOCS_ASK`, `RATE_LIMIT_HW_TOOLS` | see `.env.example` | Limits for the other routes |
| `RATE_LIMIT_OFF` | unset | `1` turns rate limiting off (useful for a demo where everyone shares one IP) |
| `HW_MAX_CONCURRENT` | `4` | Pages processed at once; extra requests get a "busy" answer |
| `TRUST_PROXY` | unset | `1` reads the client IP from `X-Forwarded-For` behind a reverse proxy |

### Free-tier quotas

Free tiers are small:
- Gemini: about 20 requests a day per model.
- OpenRouter free models: about 50 a day.
- Groq: 200k tokens a day.

Every model answer is cached as text in `backend/.cache/`, so reading the same page again is free. `HW_CACHE_ONLY=1` replays the cache without calling any cloud vision model, which is useful for an offline demo.

## API

All routes are under `/api`. Errors use one shape: `{"detail": {"code": "...", "message": "..."}}`. The codes are:
- `too_large`, `unsupported_type`, `heic_unsupported`, `bad_image`
- `rate_limited` (with `Retry-After`), `busy`, `all_models_failed`

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/api/health` | Status, text provider, active readers and limits |
| `POST` | `/api/handwriting` | Digitize one page (multipart `file` + options); returns text, per-word results and each model's reading |
| `POST` | `/api/handwriting/stream` | Same, as a newline-delimited JSON stream of `plan`, `stage`, `reader`, then `result` or `error` events |
| `POST` | `/api/handwriting/answer` | Save a confirmed word to a writer profile |
| `POST` | `/api/handwriting/recontext` | Re-run the context step with the writer's confirmed words |
| `POST` | `/api/handwriting/table` | Prescription text → medicines table with safety warnings |
| `GET` | `/api/handwriting/eval` | Latest evaluation results |
| `POST` | `/api/docs/upload` | Add a document to Docs Q&A |
| `GET` / `DELETE` | `/api/docs` | List or remove all documents |
| `DELETE` | `/api/docs/{source}` | Remove one document |
| `POST` | `/api/docs/ask` | Ask a question; returns an answer, sources, cited passages and `grounded` |

Each word in a result carries:
- `text`
- `flagged`
- `confidence`, the share of readers that agreed
- `alternatives`
- `lookalikes`
- `by_model`: what each model wrote at that position

New fields are only ever added; existing ones are never renamed.

## Evaluation

From `backend/` (Windows paths shown):

```powershell
.venv\Scripts\python eval.py --split dev              # ablation + calibration -> eval_results_dev.md/.json
.venv\Scripts\python eval.py --split test             # held-out numbers (run once, never tune on them)
.venv\Scripts\python augment.py                       # blurred / dark / noisy / rotated / phone copies
.venv\Scripts\python eval.py --robustness --split test
.venv\Scripts\python tune.py                          # settings search on dev, offline from cached readings
.venv\Scripts\python -m pytest                        # API and pipeline tests
```

The drug-name benchmark scripts are in `backend/bench/` (see its report). Synthetic test prescriptions for the safety checks are in `backend/data/handwriting/rx_test/`.

## Project structure

```
backend/
  app/
    main.py          routes, upload validation, rate limits, streaming
    handwriting.py   pipeline: clean, read, vote, context fix
    rx_safety.py     look-alike drug alarm and dose sanity check
    llm.py           the only module that calls LLMs (providers + fallback)
    claude_provider.py
    rag.py           Docs Q&A: chunking, embeddings, retrieval
  data/              labelled samples, drug list, rx_test prescriptions
  bench/             drug-name benchmark and report
  tests/             pytest suite
  eval.py  tune.py  augment.py
frontend/
  src/
    App.tsx          app shell, tabs, language and theme
    pages/           Handwriting.tsx (+ clearscript/), Docs.tsx (+ docs/)
    components/      shared UI (ui.tsx), intro animation, loading card
    lib/             API client, errors, exporters, history, file checks
    i18n/            English source strings and 12 locale files
docs/HANDOFF.md      team status, to-do and known issues
```

The repository started from a HackNEX starter template. The template's Chat, Agent and Vision pages (and `agent.py`, `vision.py`) are still in the code but are not part of the ClearScript app.

## Privacy and security

- **Third-party processing.** Pages are sent to third-party AI providers (Google Gemini, Groq, OpenRouter) to be read. Use only data you are allowed to share with them.
- **Stored on the server:**
  - each model's reading, as text in `backend/.cache/` (the server does not keep the images);
  - confirmed words, under a writer profile name;
  - Docs Q&A documents, in memory only, until they are removed or the server restarts.
- **Stored in the browser:** history, in `localStorage`.
- **API keys** are read from the backend environment only and never reach the browser.
- **Input checks:** uploads are checked by their actual bytes, not the file extension, and size, pixel and question-length limits apply. Rate limiting and a concurrency cap protect the server.
- **Not implemented:**
  - user accounts or authentication;
  - encryption at rest;
  - formal compliance for health data.

  Do not use the app with real patient data without consent and an appropriate deployment.

## Limitations

- **Evaluation:** small evaluation sets (14 dev pages, 39 drug-name images). The held-out test split has not been scored yet.
- **Not measured:**
  - dose, frequency and duration accuracy;
  - how often a flagged word was actually correct (flag precision);
  - processing time per page.
- **Quotas:** free-tier quotas limit throughput. Pages often get 3–4 of the 5 readers.
- **Handwriting languages:** reading is tuned for English handwriting. Indian-script handwriting has not been evaluated.
- **Translations:** interface translations are machine drafts.
- **Deployment:** the app is not deployed publicly; it runs locally.

## Team

Daniel S, Ajay, Aaron and Gladys, at HackNEX 2026.
