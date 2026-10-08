## Settings search on DEV (14 samples, 1139 words, no API calls)

Score = WER + confident-error rate + 0.25 x false-flag rate (lower is better). Re-read and context not included (they need API calls).

| # | Readers | Flag rule | Strict numbers | Drop minority | WER | Confident errors | Flags | Flag precision | Flag recall | Score |
|---|---|---|---|---|---|---|---|---|---|---|
| - | **baseline (1 model, plain prompt)** | - | - | - | 18.6% | 155 | 0 | n/a | 0% | 0.322 |
| 1 | dots-3-note-preview, gemini-A, qwen3.8-27b | majority | yes | yes | 6.2% | 25 | 41 | 51.2% | 45.7% | 0.089 |
| 2 | dots-3-note-preview, gemini-A, qwen3.8-27b | majority | yes | no | 6.2% | 25 | 41 | 51.2% | 45.7% | 0.089 |
| 3 | dots-3-note-preview, gemini-A, qwen3.8-27b | majority | no | yes | 6.2% | 27 | 31 | 61.3% | 41.3% | 0.089 |
| 4 | dots-3-note-preview, gemini-A, qwen3.8-27b | majority | no | no | 6.2% | 27 | 31 | 61.3% | 41.3% | 0.089 |
| 5 | dots-3-note-preview, gemini-A, qwen3.8-27b | two_thirds | yes | yes | 6.2% | 25 | 41 | 51.2% | 45.7% | 0.089 |
| 6 | dots-3-note-preview, gemini-A, qwen3.8-27b | two_thirds | yes | no | 6.2% | 25 | 41 | 51.2% | 45.7% | 0.089 |
| 7 | dots-3-note-preview, gemini-A, qwen3.8-27b | two_thirds | no | yes | 6.2% | 27 | 31 | 61.3% | 41.3% | 0.089 |
| 8 | dots-3-note-preview, gemini-A, qwen3.8-27b | two_thirds | no | no | 6.2% | 27 | 31 | 61.3% | 41.3% | 0.089 |
| 9 | dots-3-note-preview, gemini-A, qwen3.8-27b | unanimous | yes | yes | 6.2% | 4 | 187 | 22.5% | 91.3% | 0.098 |
| 10 | dots-3-note-preview, gemini-A, qwen3.8-27b | unanimous | yes | no | 6.2% | 4 | 187 | 22.5% | 91.3% | 0.098 |
| 11 | dots-3-note-preview, gemini-A, qwen3.8-27b | unanimous | no | yes | 6.2% | 4 | 187 | 22.5% | 91.3% | 0.098 |
| 12 | dots-3-note-preview, gemini-A, qwen3.8-27b | unanimous | no | no | 6.2% | 4 | 187 | 22.5% | 91.3% | 0.098 |
| 13 | dots-3-note-preview, gemini-A | majority | yes | yes | 7.7% | 17 | 104 | 60.6% | 78.8% | 0.101 |
| 14 | dots-3-note-preview, gemini-A | majority | yes | no | 7.7% | 17 | 104 | 60.6% | 78.8% | 0.101 |
| 15 | dots-3-note-preview, gemini-A | majority | no | yes | 7.7% | 17 | 104 | 60.6% | 78.8% | 0.101 |

Current default (all usable readers, majority, strict numbers, drop minority): rank 1 of 48, score 0.089.
