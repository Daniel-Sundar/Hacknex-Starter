# ClearScript accuracy report: handwritten prescription words (RxHandBD + BD-Prescription)

Measured 2026-10-09 on the real pipeline (`handwriting.digitize`). Every number below comes from
`bench/results/` and can be reproduced with `bench/words.py` and `bench/analyze.py`. Anything not measured is
marked **NOT MEASURED**.

## 1. Executive summary

- **Reading an isolated handwritten drug name is hard.** On 39 test images, the single-model baseline got
  **9.5%** exactly right (2 of 21) and was **confidently wrong on 90.5%** (19 of 21).
- **ClearScript's voting turns confident mistakes into flags.** On the same 21 images, confident errors fell from
  **19 to 2**. Across all 39 images the app flagged 61.5% of words and was confidently wrong on **15.4%** (6),
  2 of which are verified dataset label errors.
- **Exact-match accuracy is still low:** 28.2% (app as run). It is limited by what the readers can see: 17 of the
  28 wrong answers are far misses that no post-processing can recover.
- **Fixes made from this benchmark:** a dictionary + reader-evidence step (with a drug-name list) raised exact
  match on BD-Prescription from **31.6% to 42.1%** without adding confident errors. Requiring every reader to
  agree on drug names (already the app's rule for detected prescriptions) brought confident errors to **4 of 39
  (10.3%)** and exact match to **38.5%**.
- **Sample size is small** (39 images, limited by free API quota): treat every percentage as roughly ±15 points.

## 2. Datasets

Both ZIPs were downloaded from Mendeley Data (data.mendeley.com) and extracted to `HackNEX-2026\datasets\`
(outside the repo). Full inventory: `HackNEX-2026\datasets\inventory.md` (script: `bench/inventory.py`).

| | RxHandBD | Doctor's Handwritten Prescription BD |
|---|---|---|
| Source | Mendeley Data `dsb5r6vskg` v3 | Mendeley Data `zjjtptvn6f` v2 |
| Content | cropped handwritten words from Bangladeshi prescriptions, 512x512 JPG | cropped handwritten medicine names, small PNG (median 158x56) |
| Ground truth | text of the word (`Train_Label.csv`, `Test_Label.csv`) | brand name + generic name per image (CSV per split) |
| Official splits | train 4,463 / test 1,115 | train 3,120 / validation 780 / test 780 |
| Vocabulary | open: 496 test labels, only 50% of test rows have a label also in train | closed: the same 78 names in every split |
| Unreadable / missing files | 0 / 0 | 0 / 0 |
| Duplicates | 8 test images near-identical to a train image | 27 test images identical or near-identical to a train image (21 byte-identical); 33 exact duplicates inside test |
| Label quality | **label misalignment confirmed**: around P0029-P0064 each label belongs to the neighbouring image (visually verified for P0030, P0048, P0053-P0064) | not inspected beyond duplicates |
| Split used here | test only | test only (validation unused) |

**Fit with ClearScript's task:** both datasets are single words, almost all medicine names. They measure the core
skill (reading a doctor's handwritten drug name and knowing when unsure). They contain no doses, dates,
frequencies or patient fields, so full-prescription extraction is **NOT MEASURED**.

## 3. Methodology

- **Sample:** each official test split, minus images that are exact or near-identical (dHash distance <= 2) copies
  of a training image (8 RxHandBD, 28 BD excluded), shuffled with fixed seed 2026; the first 60 of each, alternated.
  List: `bench/results/manifest.json`.
- **Run:** each image's bytes (never its label) go through `digitize()` with the app's settings at the time
  ("before"): OpenCV cleaning, 5 reader slots in parallel (Groq Qwen, 2 Gemini slots with spares, OpenRouter dots,
  OpenRouter Gemma), word vote, context fix, safety. 20-45 s pause between images. Raw readings, outputs and
  errors are stored in `bench/results/runs.jsonl`.
- **Processed:** 39 unique images (20 RxHandBD, 19 BD) before the day's free quota ran out. 3 whole-image
  failures were retried and logged in `failures.jsonl` (1 network drop, 2 caused by the benchmark's own extra
  Groq calls).
- **Ablations and fixes** are scored offline on the same cached readings (`bench/analyze.py`). A faithfulness check
  confirms the offline pipeline reproduces the app's actual output on **39/39** images.
- **Leakage controls:** labels are only read by the scorer. The "knowledge base" experiment uses training-split
  labels only. No filename, label or dataset-specific logic is in the pipeline.
- **Normalisation:** "exact (raw)" compares text with whitespace collapsed. "Exact (norm)" and CER compare after
  Unicode NFKC, case-folding and removing everything except letters and digits ("FEXO" = "Fexo", "N-MAX SO" =
  "nmaxso"). Both are reported.
- **Definitions:** *flagged* = the app marked at least one word as uncertain. *Confident error* = wrong and not
  flagged (the dangerous case). *Errors flagged* = share of wrong answers the app flagged.
- **Design vs held-out:** the fixes were designed after studying the first 16 images; images 17-39 (n=23) were not
  studied and are reported separately.

## 4. Overall results (app as run, official labels)

| Metric | RxHandBD | BD-Prescription | Combined |
|---|---:|---:|---:|
| Samples | 20 | 19 | 39 |
| Exact match (raw) | 20.0% | 15.8% | 17.9% |
| Exact match (normalised) | 25.0% | 31.6% | 28.2% |
| CER (normalised) | 48.0% | 36.0% | 42.0% |
| Flag rate (asked a human) | 60.0% | 63.2% | 61.5% |
| Accuracy when not flagged | 50.0% | 71.4% | 60.0% |
| Confident errors (critical) | 4 (20.0%) | 2 (10.5%) | 6 (15.4%) |
| Wrong answers that were flagged | 73.3% | 84.6% | 78.6% |
| Number errors | 1 of 1 | n/a (no digits) | 1 of 1 |
| Field accuracy (dose, frequency, date, name) | NOT MEASURED | NOT MEASURED | NOT MEASURED |

With the 2 visually verified label errors corrected: exact 30.8% (12/39), confident errors 5 (12.8%).

## 5. Before vs after

| Metric (combined, n=39) | Before (app as run) | After: shipped fixes | After: + training-split drug list | After: + drug list + every reader must agree |
|---|---:|---:|---:|---:|
| Exact (normalised) | 28.2% | 28.2% | 33.3% | **38.5%** |
| CER (normalised) | 42.0% | 42.0% | 39.2% | 38.4% |
| Flag rate | 61.5% | 61.5% | 53.8% | 56.4% |
| Accuracy when not flagged | 60.0% | 60.0% | 61.1% | **76.5%** |
| Confident errors | 6 (15.4%) | 6 (15.4%) | 7 (17.9%)* | **4 (10.3%)** |

\* The extra one is P0048: the app read "Doxycap", the image says "Doxycap", the label ("Robac") belongs to the
next image. Label-corrected: before 30.8% exact / 5 confident errors, after (+drug list) 38.5% / 5.

- **"Shipped fixes"** (reading cleanup, split-word joining, dictionary step with the app's own 246-name Indian drug
  list) changed no output on these 39 images: the list has no Bangladeshi brand names. On the team's own 14 dev
  pages the same fixes lowered CER from 2.6% to 2.3% with confident errors unchanged (6).
- **The drug-list result needs a matching list:** for Indian prescriptions that means a large Indian brand list in
  `backend/data/knowledge/`.
- **The "every reader must agree" column** was chosen after seeing these results (from the confidence analysis), so
  it is optimistic until confirmed on fresh images.
- **Held-out images 17-39 (n=23):** before 26.1% exact / 5 confident errors; after (+drug list) 30.4% / 6, where the
  extra one is the P0048 label error (label-corrected: 5).

## 6. Pipeline comparison (paired: same images only)

| Comparison | Images | First | Second |
|---|---:|---|---|
| Baseline (1 model, raw image, plain prompt) vs full app | 21 | exact 2, CER 63.2%, confident errors 19 | exact 6, CER 43.4%, confident errors 2 |
| Single reader, raw image vs cleaned image | 12 | exact 0, CER 75.6% | exact 2, CER 48.8% |
| Single reader (cleaned) vs full app | 27 | exact 6, CER 60.5%, confident errors 20 | exact 8, CER 41.8%, confident errors 3 |
| Vote only vs vote + context | 39 | CER 40.8% | CER 42.0% (context changed 1 output, for the worse: "Mon Lai" to "Mon lundi", still flagged) |

**Individual readers** answered different subsets, so they are not directly comparable. Exact (normalised):
gemini-3.6-flash 53.8% (13), gemini-3.5-flash 38.9% (18), gemini-3.1-flash-lite 35.0% (20), dots 31.4% (35),
Groq Qwen 23.1% (26). Every single reader with more than one image was confidently wrong on 38-73% of its images;
alone, a model almost never flags its own uncertainty. **More readers is better:** images with 4 readers scored 38.5% exact with 1 confident error (n=13);
images with 2-3 readers scored 23.1% with 5 (n=26).

## 7. Error analysis (28 wrong answers, app)

| Category | Count |
|---|---:|
| Far miss (>25% of characters wrong): readers could not read the word | 17 |
| Extra words added | 4 |
| Near miss (<=25% characters wrong) | 4 |
| Matches the neighbouring row's label (dataset label error) | 2 |
| Number wrong or missing | 1 |

**Pipeline failures found and fixed during the benchmark:**
- Readers disagreeing on word breaks ("Ni dazyl" / "Nidazyl"): split-word joining.
- Model formatting leaking into the vote (`['An hip']`): reading cleanup.
- Context step unable to resolve isolated drug names: dictionary + reader-evidence step.
- A failing upstream model retried on every page, wasting quota: 5-minute skip.
- A crash on empty provider responses: clean error.

## 8. Critical errors

Every sample is a drug name, so a confident error is a critical error (a wrong drug shown without a flag).

- **App as run:** 6 of 39 (15.4%). 2 are verified label errors (app correct), so 4 genuine (10.3%):
  - "Folita 5" read as "folitas": the dose digit was lost, and all readers agreed.
  - "Ketoral" read as "rational": all readers agreed.
  - "Nexpro" read as "Nixpro": 2 of 3 agreed.
  - "escilex" read as "Wilcox": 2 of 3 agreed.
  - "Esonix" read as "EbONIX": 2 of 3 agreed.
- **Baseline single model:** 19 of 21 (90.5%).
- **Hallucinated text:** 4 answers added extra words. Empty outputs: 0.

## 9. Confidence analysis (app)

| Readers agreeing on the weakest word | Images | Right | Wrong and not flagged |
|---|---:|---:|---:|
| All (1.0) | 10 | 7 (70%) | 3 (1 is a label error) |
| Most (0.67-0.99) | 6 | 3 (50%) | 3 (all "2 of 3") |
| Half (0.5-0.66) | 5 | 1 (20%) | 0 |
| Few (<0.5) | 18 | 0 (0%) | 0 |

- **Disagreement is a reliable warning:** when at most half the readers agree, the app was right 1 time in 23 and
  never left a wrong answer unflagged.
- **"2 of 3 readers agree" is not safe for drug names:** it produced half of the confident errors. On the team's
  own pages, "all agree" was right 938 of 938 times; on these drug names, 7 of 10 (or 7 of 9 with the label
  error removed).

## 10. Real-world readiness (cautious)

- These are isolated words without context, on a small sample. Real prescription pages give more context (dose,
  frequency, form), and the app already applies "every reader must agree" to detected prescriptions. **This
  benchmark does not show** what accuracy on real pages would be.
- **Expect** a high flag rate on bad drug-name handwriting, and a low but non-zero rate of confident drug-name
  errors (about 10-15% here, ±15 points) when readers agree on a wrong word.
- **Results depend on how many readers answer.** Free-tier quota made many images run with 2-3 readers, which is
  measurably worse. A live demo must have fresh quota or cached pages.
- **No accuracy level is guaranteed.** This benchmark does not establish a "very high accuracy" claim for
  real-world drug names.

## 11. Remaining weaknesses

- Readers cannot read many of these words at all (17 far misses). This is a reading-model limit, not a pipeline bug.
- Digits that look like letters ("5" as "s") can be lost when all readers agree.
- With only 2-3 readers answering, a two-reader majority can be confidently wrong.
- The context step does not help isolated words and changed one flagged guess for the worse.
- Quota and latency: 13 of 39 images hit the 60 s vote deadline, and readers dropped out due to daily limits and
  timeouts. Median time per image 42.7 s, maximum 71.9 s.
- Sample is 39 images; full-prescription fields (doses, frequencies, dates, names) are NOT MEASURED.

## 12. Recommendations

1. **Apply "every reader must agree" to drug-name words** wherever they appear, not only on pages detected as
   prescriptions. Measured offline: confident errors 6 to 4, unflagged accuracy 60% to 76.5%. Confirm on fresh
   images before relying on it.
2. **Add a large drug-name list** for the target market to `backend/data/knowledge/` (e.g. a public Indian medicine
   list). With a matching list, the dictionary step lifted BD exact match from 31.6% to 42.1% with no added
   confident errors.
3. **Make sure 4-5 readers answer:** each teammate's own keys (more quota), and start a spare model when the first
   is slow, instead of waiting the full 60 s.
4. **Guard look-alike digits:** flag a drug-name token ending in a letter that resembles a digit (s/5, o/0, l/1)
   when the next token is missing.
5. **Measure full prescriptions:** 10-20 real prescription photos (names blanked) with typed ground truth, to
   measure dose, frequency and the prescription table, none of which these datasets cover.
6. **Finish the sample:** continue the remaining 81 images with fresh quota (`bench/words.py run` resumes where it
   stopped) to narrow the error bars.
