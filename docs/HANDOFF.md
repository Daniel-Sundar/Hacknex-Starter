# Team handoff: status, to-do and known issues

Internal notes for teammates and their Claude Code. The public overview is in [README.md](../README.md).

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
  [`backend/bench/REPORT.md`](../backend/bench/REPORT.md).** 39 test images. Single model: 9.5% exact, confidently
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
