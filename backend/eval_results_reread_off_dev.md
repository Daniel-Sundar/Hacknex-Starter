## Handwriting ablation (14 samples, split=dev, 1152 ground-truth words)

| Variant | CER ↓ | WER ↓ | Confident errors ↓ | Flagged | Flag precision ↑ | Flag recall ↑ | Avg readers |
|---|---|---|---|---|---|---|---|
| baseline | 14.6% | 18.1% | 151 | 0 | n/a | 0.0% | 1.0 |
| clean + vote | 4.6% | 5.6% | 20 | 42 | 47.6% | 50.0% | 3.2 |
| clean + vote + context | 4.5% | 5.4% | 20 | 42 | 40.5% | 45.9% | 3.2 |

CER/WER ignore case and punctuation; a `[?]` always counts as an error. Confident errors = wrong words that were not flagged.
