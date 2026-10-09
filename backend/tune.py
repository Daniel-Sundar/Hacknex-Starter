"""Settings search on the DEV set, offline: replays cached model readings, makes no API calls.

Run eval.py on the dev split first (that fills the cache). Then:
    .venv/Scripts/python tune.py
It tries every reader subset (2+ models) x flag rule x digit rule x minority-drop rule and ranks them by
    score = WER + confident-error rate + 0.25 x false-flag rate     (all per ground-truth word, lower is better)
Accuracy (40% of the rubric) and confident errors (25%) count fully; flagging a word that was actually
right only costs a little (the user checks one extra word). Re-read and context need API calls, so they
are judged separately with eval.py on the winning settings.
"""
import hashlib
import itertools
import json
import sys
from pathlib import Path

from dotenv import load_dotenv

HERE = Path(__file__).resolve().parent
load_dotenv(HERE / ".env")

from app import handwriting as hw  # noqa: E402
from eval import find_samples, pct, score, words_of  # noqa: E402

RULES = ["majority", "two_thirds", "unanimous"]
FALSE_FLAG_WEIGHT = 0.25


def cached(key_parts: list):
    key = hashlib.sha256(json.dumps(key_parts, sort_keys=True).encode()).hexdigest()[:32]
    f = hw.CACHE / f"{key}.json"
    if not f.exists():
        return None
    v = json.loads(f.read_text(encoding="utf-8"))
    return v if isinstance(v, str) and v.strip() else None


def load(samples: list[Path]) -> list[dict]:
    models = list(dict.fromkeys(m for slot in hw._slots() for m in slot))
    base_p, base_m = hw._parse(hw.os.getenv("HW_BASELINE", hw.DEFAULT_BASELINE))
    out = []
    for img in samples:
        data = hw.prepare(img.read_bytes())
        clean = hw.clean(data)
        h = hashlib.sha256(clean).hexdigest()
        readings = {hw._name(p, m): t for p, m in models
                    if (t := cached(["read", h, p, m, hw.READ_PROMPT]))}
        base = cached(["read", hashlib.sha256(data).hexdigest(), base_p, base_m, hw.BASELINE_PROMPT])
        out.append({"name": img.stem, "ref": img.with_suffix(".txt").read_text(encoding="utf-8"),
                    "readings": voters(readings, models), "baseline": base})
    return out


def voters(readings: dict[str, str], models: list) -> dict[str, str]:
    """Spares stand in for each other, so group readings the way the app's slots use them:
    the first two Gemini models that answered are voters 'gemini-A' / 'gemini-B'; any gemma is 'gemma'."""
    order = [hw._name(p, m) for p, m in models]
    out, gem = {}, []
    for name in sorted(readings, key=order.index):
        text = hw._strip_reasoning(readings[name])
        if name.startswith("gemini:"):
            gem.append(text)
        elif "gemma" in name:
            out.setdefault("gemma", text)
        else:
            out[name.split(":", 1)[1].split("/")[-1].replace(":free", "")] = text
    for label, text in zip(["gemini-A", "gemini-B"], gem):
        out[label] = text
    return out


def totals(rows: list[dict]) -> dict:
    t = {k: sum(r[k] for r in rows) for k in rows[0]}
    w = max(t["ref_words"], 1)
    t["wer"] = t["word_edits"] / w
    t["ce_rate"] = (t["wrong"] - t["flagged_wrong"]) / w
    t["false_flags"] = t["flagged"] - t["flagged_wrong"]
    t["score"] = t["wer"] + t["ce_rate"] + FALSE_FLAG_WEIGHT * t["false_flags"] / w
    return t


def run(data: list[dict], subset: tuple[str, ...], rule: str, digits: bool, drop: bool) -> dict | None:
    rows = []
    for s in data:
        readings = {k: v for k, v in s["readings"].items() if k in subset}
        if not readings:
            return None  # this subset has no reading for a sample: not comparable
        words = hw.vote(readings, rule=rule, digits_strict=digits, drop_minority=drop)
        hyp = [(p, bool(w.get("flagged"))) for w in words for p in words_of(w["text"])]
        rows.append(score(hyp, s["ref"]))
    return totals(rows)


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    samples = find_samples(HERE / "data" / "handwriting" / "samples", "dev")
    data = load(samples)
    counts = {}
    for s in data:
        for k in s["readings"]:
            counts[k] = counts.get(k, 0) + 1
    print(f"{len(data)} dev samples. Cached readings per model:")
    for k, c in sorted(counts.items(), key=lambda kv: -kv[1]):
        print(f"  {c:2d}/{len(data)}  {k}")
    # Gemini models stand in for each other (spares), so treat "any Gemini" as one voter family too.
    usable = [k for k, c in counts.items() if c >= len(data) * 0.6]
    missing = [s["name"] for s in data if not s["readings"]]
    if missing:
        print("No cached readings for:", missing, "- run eval.py --split dev first.")

    base_rows = [score([(w, False) for w in words_of(s["baseline"] or "")], s["ref"]) for s in data]
    base = totals(base_rows)

    results = []
    for r in range(2, len(usable) + 1):
        for subset in itertools.combinations(sorted(usable), r):
            for rule, digits, drop in itertools.product(RULES, [True, False], [True, False]):
                t = run(data, subset, rule, digits, drop)
                if t:
                    results.append((t["score"], subset, rule, digits, drop, t))
    results.sort(key=lambda x: x[0])

    lines = [f"## Settings search on DEV ({len(data)} samples, {base['ref_words']} words, no API calls)\n",
             f"Score = WER + confident-error rate + {FALSE_FLAG_WEIGHT} x false-flag rate (lower is better). "
             "Re-read and context not included (they need API calls).\n",
             "| # | Readers | Flag rule | Strict numbers | Drop minority | WER | Confident errors | Flags "
             "| Flag precision | Flag recall | Score |", "|---|---|---|---|---|---|---|---|---|---|---|",
             f"| - | **baseline (1 model, plain prompt)** | - | - | - | {base['wer']:.1%} "
             f"| {base['wrong'] - base['flagged_wrong']} | 0 | n/a | 0% | {base['score']:.3f} |"]
    for i, (sc, subset, rule, digits, drop, t) in enumerate(results[:15], 1):
        short = ", ".join(subset)
        lines.append(f"| {i} | {short} | {rule} | {'yes' if digits else 'no'} | {'yes' if drop else 'no'} "
                     f"| {t['wer']:.1%} | {t['wrong'] - t['flagged_wrong']} | {t['flagged']} "
                     f"| {pct(t['flagged_wrong'], t['flagged'])} | {pct(t['flagged_wrong'], t['wrong'])} | {sc:.3f} |")
    current = next((x for x in results if set(x[1]) == set(usable) and x[2:5] == ("majority", True, True)), None)
    if current:
        lines.append(f"\nCurrent default (all usable readers, majority, strict numbers, drop minority): "
                     f"rank {results.index(current) + 1} of {len(results)}, score {current[0]:.3f}.")
    md = "\n".join(lines) + "\n"
    print("\n" + md)
    (HERE / "results" / "tune_results.md").write_text(md, encoding="utf-8")
    best = results[0]
    (HERE / "results" / "tune_best.json").write_text(json.dumps(
        {"readers": list(best[1]), "flag_rule": best[2], "digits_strict": best[3], "drop_minority": best[4],
         "dev_metrics": {k: v for k, v in best[5].items()}}, indent=1), encoding="utf-8")
    print("Saved tune_results.md and tune_best.json")


if __name__ == "__main__":
    main()
