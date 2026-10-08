## Handwriting ablation (14 samples, split=dev, 1152 ground-truth words)

| Variant | CER ↓ | WER ↓ | Confident errors ↓ | Flagged | Flag precision ↑ | Flag recall ↑ | Avg readers |
|---|---|---|---|---|---|---|---|
| clean + vote + context | 3.3% | 3.6% | 8 | 79 | 24.1% | 70.4% | 3.6 |

CER/WER ignore case and punctuation; a `[?]` always counts as an error. Confident errors = wrong words that were not flagged.
