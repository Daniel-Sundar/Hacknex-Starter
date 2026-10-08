## Handwriting ablation (2 samples, 104 ground-truth words)

| Variant | CER ↓ | WER ↓ | Confident errors ↓ | Flagged | Flag precision ↑ | Flag recall ↑ | Avg readers |
|---|---|---|---|---|---|---|---|
| baseline | 2.1% | 3.8% | 3 | 0 | n/a | 0.0% | 1.0 |
| vote (no clean) | 2.0% | 3.8% | 2 | 1 | 100.0% | 33.3% | 3.0 |
| clean (single reader) | 11.2% | 19.2% | 14 | 0 | n/a | 0.0% | 1.0 |
| clean + vote | 1.0% | 1.9% | 2 | 1 | 0.0% | 0.0% | 4.0 |
| clean + vote + context | 1.0% | 1.9% | 2 | 0 | n/a | 0.0% | 4.0 |

CER/WER ignore case and punctuation; a `[?]` always counts as an error. Confident errors = wrong words that were not flagged.
