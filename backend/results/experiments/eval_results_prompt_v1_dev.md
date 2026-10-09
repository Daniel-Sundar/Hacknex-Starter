## Handwriting ablation (14 samples, split=dev, 1146 ground-truth words)

| Variant | CER ↓ | WER ↓ | Confident errors ↓ | Flagged | Flag precision ↑ | Flag recall ↑ | Avg readers |
|---|---|---|---|---|---|---|---|
| baseline | 14.4% | 17.8% | 152 | 0 | n/a | 0.0% | 1.0 |
| clean (single reader) | 11.7% | 16.9% | 166 | 1 | 100.0% | 0.6% | 1.0 |
| clean + vote | 2.6% | 3.3% | 6 | 99 | 24.2% | 80.0% | 3.6 |
| clean + vote + context | 2.6% | 3.2% | 6 | 98 | 23.5% | 79.3% | 3.6 |

CER/WER ignore case and punctuation; a `[?]` always counts as an error. Confident errors = wrong words that were not flagged.
