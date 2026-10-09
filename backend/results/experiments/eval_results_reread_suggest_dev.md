## Handwriting ablation (14 samples, split=dev, 1152 ground-truth words)

| Variant | CER ↓ | WER ↓ | Confident errors ↓ | Flagged | Flag precision ↑ | Flag recall ↑ | Avg readers |
|---|---|---|---|---|---|---|---|
| baseline | 14.6% | 18.1% | 151 | 0 | n/a | 0.0% | 1.0 |
| clean + vote | 10.9% | 14.8% | 6 | 241 | 62.7% | 96.2% | 2.5 |
| clean + vote + context | 34.8% | 32.9% | 3 | 181 | 53.6% | 97.0% | 2.1 |

CER/WER ignore case and punctuation; a `[?]` always counts as an error. Confident errors = wrong words that were not flagged.

### Failures (scored as empty output)
- samples\a04.jpg / clean + vote + context: All LLM providers failed: groq: Error code: 429 - {'error': {'message': 'Rate limit reached for model `openai/gpt-oss-120b` in organization `org_01m4d489xeey6ty
- samples\a05.jpg / clean + vote + context: All LLM providers failed: groq: Error code: 429 - {'error': {'message': 'Rate limit reached for model `openai/gpt-oss-120b` in organization `org_01m4d489xeey6ty
- samples\a09.jpg / clean + vote + context: All LLM providers failed: groq: Error code: 429 - {'error': {'message': 'Rate limit reached for model `openai/gpt-oss-120b` in organization `org_01m4d489xeey6ty
