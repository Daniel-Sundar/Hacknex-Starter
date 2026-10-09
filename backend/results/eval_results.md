## Handwriting ablation (2 samples, split=all, 104 ground-truth words)

| Variant | CER ↓ | WER ↓ | Confident errors ↓ | Flagged | Flag precision ↑ | Flag recall ↑ | Avg readers |
|---|---|---|---|---|---|---|---|
| baseline | 2.1% | 3.8% | 3 | 0 | n/a | 0.0% | 1.0 |
| vote (no clean) | 2.0% | 3.8% | 1 | 5 | 40.0% | 66.7% | 4.0 |
| clean (single reader) | 11.2% | 19.2% | 14 | 0 | n/a | 0.0% | 1.0 |
| clean + vote | 0.8% | 1.0% | 0 | 3 | 33.3% | 100.0% | 4.5 |
| clean + vote + context | 0.8% | 1.0% | 0 | 3 | 33.3% | 100.0% | 4.5 |

CER/WER ignore case and punctuation; a `[?]` always counts as an error. Confident errors = wrong words that were not flagged.
