## Handwriting ablation (1 samples, split=dev, 35 ground-truth words)

| Variant | CER ↓ | WER ↓ | Confident errors ↓ | Flagged | Flag precision ↑ | Flag recall ↑ | Avg readers |
|---|---|---|---|---|---|---|---|
| baseline | 1.7% | 5.7% | 2 | 0 | n/a | 0.0% | 1.0 |
| vote (no clean) | 0.6% | 2.9% | 1 | 0 | n/a | 0.0% | 3.0 |
| clean (single reader) | 13.1% | 20.0% | 6 | 0 | n/a | 0.0% | 1.0 |
| clean + vote | 0.0% | 0.0% | 0 | 0 | n/a | n/a | 5.0 |
| clean + vote + context | 0.0% | 0.0% | 0 | 0 | n/a | n/a | 5.0 |

CER/WER ignore case and punctuation; a `[?]` always counts as an error. Confident errors = wrong words that were not flagged.
