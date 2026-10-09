## Handwriting ablation (14 samples, split=dev, 1146 ground-truth words)

| Variant | CER ↓ | WER ↓ | Confident errors ↓ | Flagged | Flag precision ↑ | Flag recall ↑ | Avg readers |
|---|---|---|---|---|---|---|---|
| clean + vote | 2.4% | 3.2% | 6 | 100 | 24.0% | 80.0% | 3.6 |
| clean + vote + context | 2.3% | 3.1% | 6 | 99 | 23.2% | 79.3% | 3.6 |

CER/WER ignore case and punctuation; a `[?]` always counts as an error. Confident errors = wrong words that were not flagged.

### Calibration (clean + vote + context): is agreement a trustworthy signal?

| Reader agreement | Words | Right | Accuracy |
|---|---|---|---|
| all agree (1.0) | 938 | 938 | 100.0% |
| most agree (0.67-0.99) | 126 | 118 | 93.7% |
| half agree (0.50-0.66) | 83 | 66 | 79.5% |
| few agree (<0.50) | 7 | 3 | 42.9% |

When all readers agree, the word is right 100.0% of the time (938/938 words).
