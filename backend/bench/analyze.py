"""Offline analysis of bench/results/runs.jsonl: ablations, per-reader accuracy, confidence, error categories.

No vision-model calls: every configuration re-uses the readings cached by the run. Configurations that use the
context fix may make TEXT-only LLM calls (cached by prompt). Labels are only touched in scoring.

Usage (from backend/):  .venv/Scripts/python bench/analyze.py [--configs a,b,...] [--lexicon train] [--name tag]
"""
import argparse
import csv
import json
import os
import sys
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))
os.environ["HW_CACHE_ONLY"] = "1"  # analysis must never call a vision model
from words import MANIFEST, OUT, RUNS, lev, load_truth, norm, raw_clean, summarize  # noqa: E402
from app import handwriting as hw  # noqa: E402


def train_lexicon(items: list[dict]) -> list[str]:
    """Drug names from the TRAIN splits only (the knowledge-base experiment). Never the test labels."""
    words: set[str] = set()
    roots = {it["dataset"]: Path(it["image"]) for it in items}
    if "RxHandBD" in roots:
        root = roots["RxHandBD"].parents[1]
        with open(root / "Train_Label.csv", encoding="utf-8-sig", newline="") as f:
            for r in csv.DictReader(f):
                words.update(t for t in r["Text"].split() if len(t) > 2 and not t.isdigit())
    if "BD-Prescription" in roots:
        root = roots["BD-Prescription"].parents[2] / "Training"
        with open(root / "training_labels.csv", encoding="utf-8-sig", newline="") as f:
            for r in csv.DictReader(f):
                words.update(t for t in r["MEDICINE_NAME"].split() if len(t) > 2)
    return sorted(words)


def single(text: str | None) -> tuple[str | None, list[dict]]:
    """A single model's output as pipeline-style words: it can only abstain with [?]."""
    if text is None:
        return None, []
    toks = hw.tokens(text)
    return hw.detok(toks), [{"text": t, "flagged": "[?]" in t, "confidence": 1.0} for t in toks]


def run_config(name: str, r: dict, lexicon: list[str]) -> tuple[str | None, list[dict]]:
    """Configs as run ("vote+context+safety" = the app at run time) or, with a "v2:" prefix, the same stage on
    readings passed through the CURRENT code's reading cleanup (hw.tidy_reading), as the fixed app would see them."""
    v2 = name.startswith("v2:")
    name = name.removeprefix("v2:")
    fix = (lambda t: None if t is None else hw.tidy_reading(t)) if v2 else (lambda t: t)
    readings = {k: fix(v) for k, v in (r.get("readings") or {}).items()}
    if name == "baseline_raw":
        return single(fix(r.get("baseline_raw")))
    if name == "single_raw":
        return single(fix(r.get("single_raw")))
    if name == "single_clean":
        return single(fix(r.get("single_clean")))
    if name.startswith("reader:"):
        return single(readings.get(name[7:]))
    if not readings:
        return None, []
    rule = {"vote": None, "vote_majority": "majority", "vote_unanimous": "unanimous"}.get(name.split("+")[0])
    words = hw.vote(readings, rule=rule, join_splits=v2)
    kind = hw.doc_type(words)
    if kind == "prescription" and rule is None and hw.FLAG_RULE_RX != hw.FLAG_RULE:
        words = hw.vote(readings, rule=hw.FLAG_RULE_RX, join_splits=v2)
    if "+dict" in name:  # dictionary + reader evidence; "+kb" adds the TRAIN-split drug names,
        # "+appkb" the app's own shipped list (data/knowledge/*.txt), i.e. the app exactly as deployed
        extra = (lexicon if "+kb" in name else []) + (hw.knowledge_words() if "+appkb" in name else [])
        words = hw.dictionary_fix(words, extra)
    if "+context" in name:
        extra = lexicon if "+kb" in name else []
        words = hw.context_fix(words, extra, kind)
        if "+kbstrict" in name:
            words = [_strict(w) for w in words]
    if "+safety" in name and kind == "prescription":
        words = hw.rx_safety.lasa_flags(words)
    return hw.render(words), words


def _strict(w: dict) -> dict:
    """Experiment: a dictionary pick may clear a flag only if at least half the readers read something within
    one character of it (dictionary + visual evidence). Otherwise it stays the best guess, flagged."""
    if w.get("resolved_by") != "context" or w.get("evidence") != "lexicon" or w.get("flagged"):
        return w
    pick = hw.norm(w["text"])
    support = sum(n for s, n in (w.get("votes") or {}).items() if lev(hw.norm(s), pick) <= 1)
    if 2 * support < (w.get("readers") or 1):
        return {**w, "flagged": True, "evidence": "lexicon (weak reader support)"}
    return w


def score_one(pred, words, gt, neighbours) -> dict:
    p, g = norm(pred or ""), norm(gt)
    flagged = any(w.get("flagged") or "[?]" in w.get("text", "") for w in words if w.get("text") != "\n")
    conf = min([w.get("confidence", 1.0) for w in words if w.get("text") != "\n"] or [0.0])
    return {"pred": pred, "label": gt, "empty": not p, "exact_raw": raw_clean(pred or "") == raw_clean(gt),
            "exact_norm": p == g, "char_edits": lev(p, g), "ref_chars": max(1, len(g)), "flagged": flagged,
            "confidence": conf, "neighbour_label": p != g and p in neighbours, "has_digit": any(c.isdigit() for c in gt),
            "digits_ok": [c for c in gt if c.isdigit()] == [c for c in (pred or "") if c.isdigit()]}


def category(s: dict) -> str:
    """One failure category per wrong prediction (first matching rule wins)."""
    p, g = norm(s["pred"] or ""), norm(s["label"])
    if s["empty"]:
        return "empty output / abstained entirely"
    if s["neighbour_label"]:
        return "matches a neighbouring row's label (suspected label error)"
    if "[?]" in (s["pred"] or ""):
        return "partly unreadable ([?] kept)"
    if s["has_digit"] and not s["digits_ok"]:
        return "number wrong or missing"
    if len((s["pred"] or "").split()) > len(s["label"].split()):
        return "extra words added"
    if len((s["pred"] or "").split()) < len(s["label"].split()):
        return "word missing"
    if g and s["char_edits"] / len(g) <= 0.25:
        return "near miss (<=25% characters wrong)"
    return "far miss (>25% characters wrong)"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--configs", default="baseline_raw,single_raw,single_clean,vote,vote+context,vote+context+safety")
    ap.add_argument("--readers", action="store_true", help="also score each individual reader")
    ap.add_argument("--name", default="")
    ap.add_argument("--main", default="", help="config used for the failure and confidence breakdown")
    ap.add_argument("--after", type=int, default=0, help="skip the first N images (in run order)")
    ap.add_argument("--first", type=int, default=0, help="only the first N images (in run order)")
    ap.add_argument("--min-readers", type=int, default=0, help="only images where at least this many readers answered")
    args = ap.parse_args()

    items = json.loads(MANIFEST.read_text(encoding="utf-8"))["items"]
    rows, seen = [], set()
    for l in RUNS.read_text(encoding="utf-8").splitlines():
        r = json.loads(l) if l.strip() else None
        if r and r.get("readings") and r["image"] not in seen:  # first result per image; skip network failures
            seen.add(r["image"])
            rows.append(r)
    rows = [r for r in rows if len(r.get("readings") or {}) >= args.min_readers]
    if args.after:  # held-out confirmation: images processed after the fixes were designed
        rows = rows[args.after:]
    if args.first:
        rows = rows[:args.first]
    labels, neighbours = load_truth(items)
    lexicon = train_lexicon(items)
    configs = args.configs.split(",")
    if args.readers:
        names = Counter(n for r in rows for n in (r.get("readings") or {}))
        configs += [f"reader:{n}" for n, _ in names.most_common()]

    # Faithfulness: the offline re-run of the app's stages must reproduce what the app produced during the run.
    mismatch = [r["image"] for r in rows if r.get("final") is not None
                and run_config("vote+context+safety", r, lexicon)[0] != r["final"]]
    print(f"faithfulness check: offline pipeline reproduces the app's output on {len(rows) - len(mismatch)}/{len(rows)} images"
          + (f" (MISMATCH: {mismatch[:5]})" if mismatch else ""))

    results, per = {}, defaultdict(list)
    for cfg in configs:
        scored = []
        for r in rows:
            pred, words = run_config(cfg, r, lexicon)
            single_cfg = cfg.removeprefix("v2:") in ("baseline_raw", "single_raw", "single_clean") or "reader:" in cfg
            if single_cfg and pred is None:
                continue  # that model did not answer this image (quota): not a wrong answer, just not measured
            s = score_one(pred, words, labels[r["image"]], neighbours.get(r["image"], set()))
            s.update(dataset=r["dataset"], image=r["image"], readers=len(r.get("readings") or {}),
                     seconds=r.get("seconds"))
            scored.append(s)
            per[cfg].append(s)
        results[cfg] = {ds: summarize([s for s in scored if ds == "Combined" or s["dataset"] == ds])
                        for ds in ["RxHandBD", "BD-Prescription", "Combined"]}

    OUT.mkdir(exist_ok=True)
    tag = f"_{args.name}" if args.name else ""
    (OUT / f"analysis{tag}.json").write_text(json.dumps({"configs": results, "rows": per}, ensure_ascii=False,
                                                        indent=1), encoding="utf-8")
    pct = lambda x: "n/a" if x is None else f"{100 * x:.1f}%"
    print(f"images: {len(rows)} (min readers {args.min_readers}); train lexicon: {len(lexicon)} words\n")
    for ds in ["RxHandBD", "BD-Prescription", "Combined"]:
        print(f"### {ds}\n")
        print("| Config | N | Exact (raw) | Exact (norm) | CER (norm) | Flag rate | Acc. unflagged | Confident errors | Errors flagged | Digit errors |")
        print("|---|---|---|---|---|---|---|---|---|---|")
        for cfg in configs:
            m = results[cfg][ds]
            if not m.get("samples"):
                continue
            print(f"| {cfg} | {m['samples']} | {pct(m['exact_raw'])} | {pct(m['exact_norm'])} | {pct(m['cer_norm'])} | "
                  f"{pct(m['flag_rate'])} | {pct(m['acc_unflagged'])} | {m['confident_errors']} ({pct(m['confident_error_rate'])}) | "
                  f"{pct(m['error_recall'])} | {m['digit_errors']}/{m['digit_samples']} |")
        print()
    pipeline = [c for c in configs if c.startswith("vote")]
    main_cfg = args.main or (pipeline[-1] if pipeline else configs[0])
    wrong = [s for s in per[main_cfg] if not s["exact_norm"]]
    print(f"### Failure categories ({main_cfg}, {len(wrong)} wrong of {len(per[main_cfg])})\n")
    for c, n in Counter(category(s) for s in wrong).most_common():
        print(f"- {c}: {n}")
    print(f"\n### Confidence ({main_cfg}): share of readers agreeing on the weakest word\n")
    buckets = [("all agree (1.0)", lambda c: c >= 0.999), ("most (0.67-0.99)", lambda c: 0.67 <= c < 0.999),
               ("half (0.5-0.66)", lambda c: 0.5 <= c < 0.67), ("few (<0.5)", lambda c: c < 0.5)]
    for label, f in buckets:
        b = [s for s in per[main_cfg] if f(s["confidence"])]
        if b:
            print(f"- {label}: {len(b)} images, {sum(s['exact_norm'] for s in b)} right ({pct(sum(s['exact_norm'] for s in b) / len(b))}), "
                  f"{sum(1 for s in b if not s['exact_norm'] and not s['flagged'])} wrong and unflagged")


if __name__ == "__main__":
    main()
