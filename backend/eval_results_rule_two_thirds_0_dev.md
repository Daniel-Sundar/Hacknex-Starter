## Handwriting ablation (14 samples, split=dev, 1152 ground-truth words)

| Variant | CER ↓ | WER ↓ | Confident errors ↓ | Flagged | Flag precision ↑ | Flag recall ↑ | Avg readers |
|---|---|---|---|---|---|---|---|
| clean + vote + context | 3.4% | 3.7% | 7 | 88 | 23.9% | 75.0% | 3.6 |

CER/WER ignore case and punctuation; a `[?]` always counts as an error. Confident errors = wrong words that were not flagged.
