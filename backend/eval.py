"""Ablation table for the handwriting digitizer.

For every image in data/handwriting/samples/ that has a matching .txt ground truth, run:
  baseline                single model, plain prompt, no flags
  vote (no clean)         raw image, all readers, majority vote
  clean (single reader)   cleaned image, first reader only
  clean + vote            cleaned image, all readers, majority vote
  clean + vote + context  ... plus the constrained LLM fix of flagged words

Metrics (micro-averaged over all samples; case and punctuation ignored):
  CER / WER           Levenshtein edits / ground-truth chars / words. A [?] always counts as wrong.
  confident errors    wrong output words that were NOT flagged (lower is better)
  flag precision      flagged words that really were wrong / all flagged words
  flag recall         wrong output words that got flagged / all wrong output words
                      (a word the model left out entirely has nothing to flag, so it only shows in WER)

Every model call goes through the pipeline cache (backend/.cache), so re-running is free.
Usage (from backend/):  .venv/Scripts/python eval.py [--samples DIR] [--limit N]
"""
import argparse
import json
import sys
import time
import unicodedata
from pathlib import Path

from dotenv import load_dotenv

HERE = Path(__file__).resolve().parent
load_dotenv(HERE / ".env")

from app import handwriting as hw  # noqa: E402

IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp"}
VARIANTS = {
    "baseline": None,
    "vote (no clean)": dict(use_clean=False, use_vote=True, use_context=False),
    "clean (single reader)": dict(use_clean=True, use_vote=False, use_context=False),
    "clean + vote": dict(use_clean=True, use_vote=True, use_context=False),
    "clean + vote + context": dict(use_clean=True, use_vote=True, use_context=True),
}


# ---------- text normalisation + Levenshtein ----------

def words_of(text: str) -> list[str]:
    text = unicodedata.normalize("NFC", text).replace("[margin]", " ")
    out = [hw.norm(t) for t in text.split()]
    return [w for w in out if w == hw.UNREADABLE or any(c.isalnum() for c in w)]  # drop lone "?" "-" etc.


def char_distance(a: str, b: str) -> int:
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def align(hyp: list[str], ref: list[str]) -> tuple[int, list[bool]]:
    """Word-level Levenshtein. Returns (edits, wrong) where wrong[i] says whether hyp word i
    was a substitution or an insertion (i.e. not matched to an identical ref word)."""
    n, m = len(hyp), len(ref)
    d = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n + 1):
        d[i][0] = i
    for j in range(m + 1):
        d[0][j] = j
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            d[i][j] = min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (hyp[i - 1] != ref[j - 1]))
    wrong = [True] * n
    i, j = n, m
    while i > 0 and j > 0:
        if d[i][j] == d[i - 1][j - 1] + (hyp[i - 1] != ref[j - 1]):
            wrong[i - 1] = hyp[i - 1] != ref[j - 1]
            i, j = i - 1, j - 1
        elif d[i][j] == d[i - 1][j] + 1:
            i -= 1  # insertion: hyp word stays wrong
        else:
            j -= 1  # deletion: ref word missing
    return d[n][m], wrong


# ---------- running the variants ----------

def run_variant(name: str, data: bytes) -> dict:
    """-> {"words": [(norm_word, flagged)], "readers": int, "error": str|None}"""
    try:
        if VARIANTS[name] is None:
            text = hw.baseline(data)
            return {"words": [(w, False) for w in words_of(text)], "readers": 1, "error": None}
        r = hw.digitize(data, **VARIANTS[name])
        out = []
        for w in r["words"]:
            for piece in words_of(w["text"]):  # a voted "word" can still hold e.g. "1-0-1"
                out.append((piece, bool(w.get("flagged"))))
        return {"words": out, "readers": len(r["readings"]), "error": None}
    except Exception as e:  # no reader answered: score as empty output, but say so
        return {"words": [], "readers": 0, "error": str(e)[:160]}


def score(hyp: list[tuple[str, bool]], ref_text: str) -> dict:
    ref = words_of(ref_text)
    hyp_words = [w for w, _ in hyp]
    edits, wrong = align(hyp_words, ref)
    flags = [f for _, f in hyp]
    return {
        "char_edits": char_distance(" ".join(hyp_words), " ".join(ref)),
        "ref_chars": len(" ".join(ref)),
        "word_edits": edits,
        "ref_words": len(ref),
        "wrong": sum(wrong),
        "flagged": sum(flags),
        "flagged_wrong": sum(1 for w, f in zip(wrong, flags) if w and f),
    }


def pct(a: int, b: int) -> str:
    return f"{100 * a / b:.1f}%" if b else "n/a"


def table(totals: dict, readers: dict, n_samples: int) -> str:
    rows = ["| Variant | CER ↓ | WER ↓ | Confident errors ↓ | Flagged | Flag precision ↑ | Flag recall ↑ | Avg readers |",
            "|---|---|---|---|---|---|---|---|"]
    for name, t in totals.items():
        confident = t["wrong"] - t["flagged_wrong"]
        rows.append(
            f"| {name} | {pct(t['char_edits'], t['ref_chars'])} | {pct(t['word_edits'], t['ref_words'])} "
            f"| {confident} | {t['flagged']} | {pct(t['flagged_wrong'], t['flagged'])} "
            f"| {pct(t['flagged_wrong'], t['wrong'])} | {sum(readers[name]) / max(n_samples, 1):.1f} |")
    return "\n".join(rows)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--samples", default=str(HERE / "data" / "handwriting" / "samples"))
    ap.add_argument("--limit", type=int, default=0, help="only the first N samples")
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")  # Windows console chokes on arrows/Tamil otherwise

    folder = Path(args.samples)
    samples = sorted(p for p in folder.glob("*") if p.suffix.lower() in IMAGE_EXT and p.with_suffix(".txt").exists())
    if args.limit:
        samples = samples[:args.limit]
    if not samples:
        sys.exit(f"No image + .txt pairs in {folder}")

    keys = ["char_edits", "ref_chars", "word_edits", "ref_words", "wrong", "flagged", "flagged_wrong"]
    totals = {v: dict.fromkeys(keys, 0) for v in VARIANTS}
    readers = {v: [] for v in VARIANTS}
    per_sample, notes = [], []
    for k, img in enumerate(samples, 1):
        data, ref = img.read_bytes(), img.with_suffix(".txt").read_text(encoding="utf-8")
        t0 = time.time()
        row = {"sample": img.name}
        for v in VARIANTS:
            res = run_variant(v, data)
            s = score(res["words"], ref)
            for key in keys:
                totals[v][key] += s[key]
            readers[v].append(res["readers"])
            row[v] = {"wer": round(s["word_edits"] / max(s["ref_words"], 1), 3), **s, "readers": res["readers"]}
            if res["error"]:
                notes.append(f"- {img.name} / {v}: {res['error']}")
        per_sample.append(row)
        print(f"[{k}/{len(samples)}] {img.name} done in {time.time() - t0:.0f}s", flush=True)

    md = (f"## Handwriting ablation ({len(samples)} samples, "
          f"{sum(totals['baseline'][k] for k in ['ref_words'])} ground-truth words)\n\n"
          + table(totals, readers, len(samples))
          + "\n\nCER/WER ignore case and punctuation; a `[?]` always counts as an error. "
            "Confident errors = wrong words that were not flagged.\n")
    if notes:
        md += "\n### Failures (scored as empty output)\n" + "\n".join(notes) + "\n"
    print("\n" + md)
    (HERE / "eval_results.md").write_text(md, encoding="utf-8")
    (HERE / "eval_results.json").write_text(json.dumps({"totals": totals, "per_sample": per_sample},
                                                       indent=1, ensure_ascii=False), encoding="utf-8")
    print("Saved eval_results.md and eval_results.json")


if __name__ == "__main__":
    main()
