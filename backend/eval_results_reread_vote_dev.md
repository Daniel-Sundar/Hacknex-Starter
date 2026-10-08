## Handwriting ablation (14 samples, split=dev, 1152 ground-truth words)

| Variant | CER ↓ | WER ↓ | Confident errors ↓ | Flagged | Flag precision ↑ | Flag recall ↑ | Avg readers |
|---|---|---|---|---|---|---|---|
| baseline | 14.6% | 18.1% | 151 | 0 | n/a | 0.0% | 1.0 |
| clean + vote | 3.2% | 3.8% | 7 | 90 | 25.6% | 76.7% | 3.6 |
| clean + vote + context | 3.5% | 4.4% | 13 | 38 | 63.2% | 64.9% | 3.6 |

CER/WER ignore case and punctuation; a `[?]` always counts as an error. Confident errors = wrong words that were not flagged.
