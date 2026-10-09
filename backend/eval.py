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
Usage (from backend/):  .venv/Scripts/python eval.py [--split dev|test] [--samples DIR] [--limit N]
                        .venv/Scripts/python eval.py --robustness   (after augment.py)
"""
import argparse
import hashlib
import json
import re
import sys
import time
import unicodedata
from pathlib import Path

from dotenv import load_dotenv

HERE = Path(__file__).resolve().parent
load_dotenv(HERE / ".env")

from app import handwriting as hw  # noqa: E402

IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp"}
SLEEP = 3.0
VARIANTS = {
    "baseline": None,
    "vote (no clean)": dict(use_clean=False, use_vote=True, use_context=False),
    "clean (single reader)": dict(use_clean=True, use_vote=False, use_context=False),
    "clean + vote": dict(use_clean=True, use_vote=True, use_context=False),
    "clean + vote + context": dict(use_clean=True, use_vote=True, use_context=True),
}


# ---------- text normalisation + Levenshtein ----------

WILD = "<any>"  # ground-truth spot even the labeller could not read: any output (or none) is fine
WILD_MARKS = {"[unclear]", "[illegible]", "[?]"}


def words_of(text: str, ref: bool = False) -> list[str]:
    text = unicodedata.normalize("NFC", text).replace("[margin]", " ")
    toks = [t for t in text.split()]
    # "water-wheel" vs "water wheel", "AC/DC" vs "AC DC": same words, so split on - and / everywhere
    toks = [p for t in toks for p in ([t] if t.lower() in WILD_MARKS else re.split(r"[-/–]+", t)) if p]
    out = [WILD if ref and t.lower() in WILD_MARKS else hw.norm(t) for t in toks]
    return [w for w in out if w in (hw.UNREADABLE, WILD) or any(c.isalnum() for c in w)]  # drop lone "?" "-"


def char_distance(a: str, b: str) -> int:
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def align(hyp: list[str], ref: list[str]) -> tuple[int, list[bool], set[int]]:
    """Word-level Levenshtein. Returns (edits, wrong, wild) where wrong[i] says whether hyp word i
    was a substitution or an insertion, and wild holds hyp words matched to a WILD ref spot.
    A WILD ref word matches anything (or nothing) for free."""
    n, m = len(hyp), len(ref)
    sub = lambda i, j: 0 if ref[j] == WILD else int(hyp[i] != ref[j])
    dele = lambda j: 0 if ref[j] == WILD else 1
    d = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n + 1):
        d[i][0] = i
    for j in range(1, m + 1):
        d[0][j] = d[0][j - 1] + dele(j - 1)
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            d[i][j] = min(d[i - 1][j] + 1, d[i][j - 1] + dele(j - 1), d[i - 1][j - 1] + sub(i - 1, j - 1))
    wrong, wild = [True] * n, set()
    i, j = n, m
    while i > 0 and j > 0:
        if d[i][j] == d[i - 1][j - 1] + sub(i - 1, j - 1):
            wrong[i - 1] = bool(sub(i - 1, j - 1))
            if ref[j - 1] == WILD:
                wild.add(i - 1)
            i, j = i - 1, j - 1
        elif d[i][j] == d[i - 1][j] + 1:
            i -= 1  # insertion: hyp word stays wrong
        else:
            j -= 1  # deletion: ref word missing
    return d[n][m], wrong, wild


# ---------- running the variants ----------

def run_variant(name: str, data: bytes) -> dict:
    """-> {"words": [(norm_word, flagged)], "conf": [agreement per word or None], "readers": int, "error": str|None}"""
    try:
        if VARIANTS[name] is None:
            text = hw.baseline(data)
            ws = words_of(text)
            return {"words": [(w, False) for w in ws], "conf": [None] * len(ws), "readers": 1, "error": None}
        r = hw.digitize(data, **VARIANTS[name])
        out, conf = [], []
        for w in r["words"]:
            for piece in words_of(w["text"]):  # a voted "word" can still hold e.g. "1-0-1"
                out.append((piece, bool(w.get("flagged"))))
                conf.append(w.get("confidence"))
        return {"words": out, "conf": conf, "readers": len(r["readings"]), "error": None}
    except Exception as e:  # no reader answered: score as empty output, but say so
        return {"words": [], "conf": [], "readers": 0, "error": str(e)[:160]}


BUCKETS = ["all agree (1.0)", "most agree (0.67-0.99)", "half agree (0.50-0.66)", "few agree (<0.50)"]


def bucket(c: float) -> str:
    return BUCKETS[0] if c >= 0.999 else BUCKETS[1] if c >= 0.665 else BUCKETS[2] if c >= 0.5 else BUCKETS[3]


def calibrate(calib: dict, res: dict, ref_text: str) -> None:
    """Reliability: for each agreement bucket, how many voted words were right."""
    _, wrong, _ = align([w for w, _ in res["words"]], words_of(ref_text, ref=True))
    for c, bad in zip(res["conf"], wrong):
        if c is None:
            continue
        b = calib.setdefault(bucket(c), {"words": 0, "right": 0})
        b["words"] += 1
        b["right"] += not bad


def calibration_table(calib: dict) -> str:
    rows = ["| Reader agreement | Words | Right | Accuracy |", "|---|---|---|---|"]
    for b in BUCKETS:
        if b in calib:
            n, r = calib[b]["words"], calib[b]["right"]
            rows.append(f"| {b} | {n} | {r} | {pct(r, n)} |")
    return "\n".join(rows)


def score(hyp: list[tuple[str, bool]], ref_text: str) -> dict:
    ref = words_of(ref_text, ref=True)
    hyp_words = [w for w, _ in hyp]
    edits, wrong, wild = align(hyp_words, ref)
    flags = [f for _, f in hyp]
    ref_real = [w for w in ref if w != WILD]
    hyp_real = [w for i, w in enumerate(hyp_words) if i not in wild]
    return {
        "char_edits": char_distance(" ".join(hyp_real), " ".join(ref_real)),
        "ref_chars": len(" ".join(ref_real)),
        "word_edits": edits,
        "ref_words": len(ref_real),
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


def is_test(img: Path) -> bool:
    """Fixed dev/test split by file name (~40% test). A sample never changes side as more are added,
    and augmented copies (same name, other folder) land on the same side as their original."""
    return int(hashlib.sha256(img.stem.encode()).hexdigest(), 16) % 10 < 4


def find_samples(folder: Path, split: str) -> list[Path]:
    found = sorted(p for p in folder.glob("*") if p.suffix.lower() in IMAGE_EXT and p.with_suffix(".txt").exists())
    return [p for p in found if split == "all" or is_test(p) == (split == "test")]


def evaluate(samples: list[Path], variants: list[str]) -> tuple[dict, dict, list, list]:
    keys = ["char_edits", "ref_chars", "word_edits", "ref_words", "wrong", "flagged", "flagged_wrong"]
    totals = {v: dict.fromkeys(keys, 0) for v in variants}
    readers = {v: [] for v in variants}
    calib = {v: {} for v in variants}
    per_sample, notes = [], []
    for k, img in enumerate(samples, 1):
        data, ref = img.read_bytes(), img.with_suffix(".txt").read_text(encoding="utf-8")
        t0 = time.time()
        row = {"sample": str(img.relative_to(img.parent.parent)), "split": "test" if is_test(img) else "dev"}
        for v in variants:
            res = run_variant(v, data)
            s = score(res["words"], ref)
            calibrate(calib[v], res, ref)
            for key in keys:
                totals[v][key] += s[key]
            readers[v].append(res["readers"])
            row[v] = {"wer": round(s["word_edits"] / max(s["ref_words"], 1), 3), **s, "readers": res["readers"]}
            if res["error"]:
                notes.append(f"- {row['sample']} / {v}: {res['error']}")
        per_sample.append(row)
        print(f"  [{k}/{len(samples)}] {row['sample']} done in {time.time() - t0:.0f}s", flush=True)
        if time.time() - t0 > 1:  # only pause when real API calls were made (not cache hits)
            time.sleep(SLEEP)
    return totals, readers, per_sample, notes, calib


def robustness_table(results: dict) -> str:
    """results[degradation] = totals for baseline + full pipeline."""
    full = "clean + vote + context"
    rows = ["| Image condition | Baseline WER ↓ | Our WER ↓ | Baseline confident errors ↓ | Our confident errors ↓ "
            "| Our flag recall ↑ |", "|---|---|---|---|---|---|"]
    for cond, t in results.items():
        b, o = t["baseline"], t[full]
        rows.append(f"| {cond} | {pct(b['word_edits'], b['ref_words'])} | {pct(o['word_edits'], o['ref_words'])} "
                    f"| {b['wrong'] - b['flagged_wrong']} | {o['wrong'] - o['flagged_wrong']} "
                    f"| {pct(o['flagged_wrong'], o['wrong'])} |")
    return "\n".join(rows)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--samples", default=str(HERE / "data" / "handwriting" / "samples"))
    ap.add_argument("--split", choices=["all", "dev", "test"], default="all",
                    help="tune on dev; report test on the slides")
    ap.add_argument("--limit", type=int, default=0, help="only the first N samples")
    ap.add_argument("--robustness", action="store_true",
                    help="baseline vs full pipeline on each degraded copy made by augment.py")
    ap.add_argument("--name", default="", help="suffix for the results files, e.g. gnhk")
    ap.add_argument("--deadline", type=float, default=None,
                    help="vote deadline in s per page; default = the app's HW_VOTE_DEADLINE (60), so numbers match the app")
    ap.add_argument("--sleep", type=float, default=3, help="pause between samples (free-tier rate limits)")
    ap.add_argument("--variants", default="", help="comma-separated subset, e.g. 'baseline,clean + vote'")
    args = ap.parse_args()
    if args.deadline is not None:
        hw.VOTE_DEADLINE = args.deadline
    global SLEEP
    SLEEP = args.sleep
    sys.stdout.reconfigure(encoding="utf-8")  # Windows console chokes on arrows/Tamil otherwise
    suffix = "_".join(x for x in [args.name, args.split if args.split != "all" else ""] if x)
    (HERE / "results").mkdir(exist_ok=True)
    out = HERE / "results" / f"eval_results{'_' + suffix if suffix else ''}"

    if args.robustness:
        aug = HERE / "data" / "handwriting" / "augmented"
        conds = {"original": Path(args.samples), **{d.name: d for d in sorted(aug.iterdir()) if d.is_dir()}}
        results, all_notes = {}, []
        for cond, folder in conds.items():
            samples = find_samples(folder, args.split)[:args.limit or None]
            print(f"{cond}: {len(samples)} samples", flush=True)
            totals, _, _, notes, _ = evaluate(samples, ["baseline", "clean + vote + context"])
            results[cond], all_notes = totals, all_notes + notes
        n = len(find_samples(Path(args.samples), args.split)[:args.limit or None])
        md = (f"## Robustness ({n} samples x {len(conds)} image conditions, split={args.split})\n\n"
              + robustness_table(results) + "\n")
        if all_notes:
            md += "\n### Failures (scored as empty output)\n" + "\n".join(all_notes) + "\n"
        out = out.with_name(out.name.replace("eval_results", "eval_robustness"))
        payload = {"split": args.split, "samples": n, "conditions": len(conds), "results": results}
    else:
        samples = find_samples(Path(args.samples), args.split)[:args.limit or None]
        if not samples:
            sys.exit(f"No image + .txt pairs in {args.samples} for split={args.split}")
        variants = [v.strip() for v in args.variants.split(",") if v.strip()] or list(VARIANTS)
        totals, readers, per_sample, notes, calib = evaluate(samples, variants)
        md = (f"## Handwriting ablation ({len(samples)} samples, split={args.split}, "
              f"{next(iter(totals.values()))['ref_words']} ground-truth words)\n\n"
              + table(totals, readers, len(samples))
              + "\n\nCER/WER ignore case and punctuation; a `[?]` always counts as an error. "
                "Confident errors = wrong words that were not flagged.\n")
        if notes:
            md += "\n### Failures (scored as empty output)\n" + "\n".join(notes) + "\n"
        main_v = next((v for v in ["clean + vote + context", "clean + vote"] if v in calib and calib[v]), None)
        if main_v:
            top = calib[main_v].get(BUCKETS[0])
            md += (f"\n### Calibration ({main_v}): is agreement a trustworthy signal?\n\n"
                   + calibration_table(calib[main_v]) + "\n")
            if top:
                md += (f"\nWhen all readers agree, the word is right {pct(top['right'], top['words'])} of the time "
                       f"({top['right']}/{top['words']} words).\n")
        payload = {"split": args.split, "samples": len(samples), "totals": totals, "calibration": calib,
                   "per_sample": per_sample}

    print("\n" + md)
    out.with_suffix(".md").write_text(md, encoding="utf-8")
    out.with_suffix(".json").write_text(json.dumps(payload, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"Saved {out.name}.md and {out.name}.json")


if __name__ == "__main__":
    main()
