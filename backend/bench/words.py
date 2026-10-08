"""Word-level benchmark of the ClearScript pipeline on RxHandBD and Doctor's Handwritten Prescription BD.

Honesty rules (enforced by structure, not by promise):
- Inference only ever receives image bytes. Labels are read by `score()` and never passed to the pipeline.
- The evaluation sample comes from the OFFICIAL test splits, drawn with a fixed seed. Test images that are exact
  or near-identical (dHash distance <= 2) copies of a training image are excluded.
- Every model answer is cached by `handwriting._cached`, so stages after reading (vote rules, context, lexicon) can
  be re-run and compared on the very same readings without new API calls.

Usage (from backend/):
  .venv/Scripts/python bench/words.py sample --data <datasets_dir> --per-dataset 60     # writes the manifest
  .venv/Scripts/python bench/words.py run                                                # reads + full pipeline
  .venv/Scripts/python bench/words.py score [--config NAME]                              # offline, cache only
"""
import argparse
import csv
import json
import os
import random
import re
import statistics
import sys
import time
import unicodedata
from pathlib import Path

HERE = Path(__file__).resolve().parent
BACKEND = HERE.parent
sys.path.insert(0, str(BACKEND))
from dotenv import load_dotenv  # noqa: E402

load_dotenv(BACKEND / ".env")
import cv2  # noqa: E402
import numpy as np  # noqa: E402

OUT = HERE / "results"
MANIFEST = OUT / "manifest.json"
RUNS = OUT / "runs.jsonl"
SEED = 2026


# ---------- sample ----------

def _dhash(path: Path) -> int:
    img = cv2.imdecode(np.frombuffer(path.read_bytes(), np.uint8), cv2.IMREAD_GRAYSCALE)
    small = cv2.resize(img, (9, 8), interpolation=cv2.INTER_AREA)
    return int("".join("1" if b else "0" for b in (small[:, 1:] > small[:, :-1]).flatten()), 2)


def cmd_sample(args):
    sys.path.insert(0, str(HERE))
    from inventory import load_splits
    data = load_splits(Path(args.data))
    manifest, excluded = [], {}
    for name, splits in data.items():
        train_h = [_dhash(p) for p, _ in splits["train"]]
        test = list(splits["test"])
        keep = []
        for p, label in test:
            h = _dhash(p)
            if any(bin(h ^ t).count("1") <= 2 for t in train_h):
                excluded.setdefault(name, []).append(p.name)
                continue
            keep.append((p, label))
        rnd = random.Random(f"{SEED}-{name}")
        rnd.shuffle(keep)
        for p, label in keep[:args.per_dataset]:
            manifest.append({"dataset": name, "split": "test", "image": str(p), "label": label})
    # alternate datasets so a run cut short by quota still covers both equally
    by = {}
    for m in manifest:
        by.setdefault(m["dataset"], []).append(m)
    order = [m for pair in zip(*by.values()) for m in pair]
    OUT.mkdir(exist_ok=True)
    MANIFEST.write_text(json.dumps({"seed": SEED, "excluded_train_duplicates": excluded, "items": order}, indent=1),
                        encoding="utf-8")
    print(f"manifest: {len(order)} items; excluded as copies of training images: "
          + ", ".join(f"{k} {len(v)}" for k, v in excluded.items()))


# ---------- run (the only part that calls models) ----------

def cmd_run(args):
    from app import handwriting as hw
    items = json.loads(MANIFEST.read_text(encoding="utf-8"))["items"]
    done = set()
    if RUNS.exists():
        # Rows where no model answered (network drop, every provider down) are infrastructure failures, not
        # readings: move them to failures.jsonl (kept for the failure-rate report) and try those images again.
        rows = [json.loads(l) for l in RUNS.read_text(encoding="utf-8").splitlines() if l.strip()]
        ok = [r for r in rows if r.get("readings")]
        failed = [r for r in rows if not r.get("readings")]
        if failed:
            with open(OUT / "failures.jsonl", "a", encoding="utf-8") as f:
                for r in failed:
                    f.write(json.dumps(r, ensure_ascii=False) + "\n")
            RUNS.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in ok), encoding="utf-8")
            print(f"retrying {len(failed)} images where no model answered (logged in failures.jsonl)")
        done = {r["image"] for r in ok}
    low = new = 0
    with open(RUNS, "a", encoding="utf-8") as out:
        for k, it in enumerate(items):
            if it["image"] in done:
                continue
            if args.max_images and new >= args.max_images:
                print(f"stopping: --max-images {args.max_images} reached (quota budget)")
                break
            new += 1
            data = Path(it["image"]).read_bytes()  # image bytes only: the label stays in `it`
            rec = {"image": it["image"], "dataset": it["dataset"]}
            t = time.time()
            try:
                full = hw.digitize(data)  # the app's exact path: prepare, clean, read_all, vote, context, safety
                rec.update(final=full["text"], words=full["words"], readings=full["readings"],
                           errors=full["errors"], doc_type=full["doc_type"])
            except Exception as e:
                rec.update(final=None, error=str(e)[:300])
            rec["seconds"] = round(time.time() - t, 1)
            # extra single-model passes for the ablation (each is one call, cached)
            for key, fn in [("baseline_raw", lambda: hw.baseline(data)),
                            ("single_raw", lambda: _single(hw, hw.prepare(data))),
                            ("single_clean", lambda: _single(hw, hw.clean(hw.prepare(data))))]:
                try:
                    rec[key] = fn()
                except Exception as e:
                    rec[key] = None
                    rec.setdefault("ablation_errors", {})[key] = str(e)[:200]
            out.write(json.dumps(rec, ensure_ascii=False) + "\n")
            out.flush()
            n = len(rec.get("readings") or {})
            print(f"[{k + 1}/{len(items)}] {it['dataset'][:8]:8} readers={n} {rec['seconds']:5.1f}s "
                  f"errors={list((rec.get('errors') or {}).keys())}", flush=True)
            low = low + 1 if n < args.min_readers else 0
            if low >= 2:
                print(f"stopping: two images in a row got fewer than {args.min_readers} readers (quota)")
                break
            time.sleep(args.sleep)


def _single(hw, img: bytes) -> str:
    """First reader (the baseline model) with the app's reading prompt."""
    provider, model = hw._slots()[0][0]
    return hw.read_one(img, provider, model)


# ---------- score (offline) ----------

def norm(s: str) -> str:
    """Normalised comparison key: Unicode NFKC, case-folded, only letters and digits kept."""
    s = unicodedata.normalize("NFKC", s or "").casefold()
    return re.sub(r"[^0-9a-z\u0080-￿]", "", s)


def raw_clean(s: str) -> str:
    """Raw comparison: only outer whitespace stripped and inner whitespace collapsed."""
    return " ".join((s or "").split())


def lev(a: str, b: str) -> int:
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def flagged_of(words: list[dict] | None) -> bool:
    return any(w.get("flagged") or "[?]" in w.get("text", "") for w in (words or []) if w.get("text") != "\n")


def confidence_of(words: list[dict] | None) -> float:
    vals = [w.get("confidence", 0.0) for w in (words or []) if w.get("text") not in ("\n", None)]
    return min(vals) if vals else 0.0


def score_rows(rows: list[dict], labels: dict[str, str], neighbours: dict[str, set[str]]) -> list[dict]:
    out = []
    for r in rows:
        gt = labels[r["image"]]
        pred = r.get("final")
        g, p = norm(gt), norm(pred or "")
        rec = {"image": r["image"], "dataset": r["dataset"], "label": gt, "pred": pred,
               "empty": not p, "exact_raw": raw_clean(pred or "") == raw_clean(gt), "exact_norm": p == g,
               "char_edits": lev(p, g), "ref_chars": max(1, len(g)),
               "flagged": flagged_of(r.get("words")), "confidence": confidence_of(r.get("words")),
               "readers": len(r.get("readings") or {}), "seconds": r.get("seconds"),
               "neighbour_label": p != g and p in neighbours.get(r["image"], set()),
               "has_digit": any(c.isdigit() for c in gt),
               "digits_ok": re.findall(r"\d+", gt) == re.findall(r"\d+", pred or "")}
        out.append(rec)
    return out


def summarize(scored: list[dict]) -> dict:
    n = len(scored)
    if not n:
        return {"samples": 0}
    wrong = [s for s in scored if not s["exact_norm"]]
    unflagged = [s for s in scored if not s["flagged"]]
    flagged = [s for s in scored if s["flagged"]]
    digit = [s for s in scored if s["has_digit"]]
    return {
        "samples": n,
        "exact_raw": sum(s["exact_raw"] for s in scored) / n,
        "exact_norm": sum(s["exact_norm"] for s in scored) / n,
        "cer_norm": sum(s["char_edits"] for s in scored) / sum(s["ref_chars"] for s in scored),
        "flag_rate": len(flagged) / n,
        "acc_unflagged": (sum(s["exact_norm"] for s in unflagged) / len(unflagged)) if unflagged else None,
        "acc_flagged": (sum(s["exact_norm"] for s in flagged) / len(flagged)) if flagged else None,
        "confident_errors": sum(1 for s in wrong if not s["flagged"]),
        "confident_error_rate": sum(1 for s in wrong if not s["flagged"]) / n,
        "error_recall": (sum(1 for s in wrong if s["flagged"]) / len(wrong)) if wrong else None,
        "empty": sum(s["empty"] for s in scored),
        "neighbour_label_matches": sum(s["neighbour_label"] for s in scored),
        "digit_samples": len(digit),
        "digit_errors": sum(1 for s in digit if not s["digits_ok"]),
        "avg_readers": sum(s["readers"] for s in scored) / n,
        "median_seconds": statistics.median([s["seconds"] for s in scored if s["seconds"] is not None] or [0]),
    }


def load_truth(items: list[dict]) -> tuple[dict, dict]:
    """Labels plus, for the label-noise diagnostic, the labels of the neighbouring rows in the official file."""
    labels = {it["image"]: it["label"] for it in items}
    neighbours: dict[str, set[str]] = {}
    for it in items:
        p = Path(it["image"])
        if it["dataset"] == "RxHandBD":
            num = int(p.stem[1:])
            nb = set()
            for d in (-1, 1):
                q = p.with_name(f"P{num + d:04d}.jpg")
                nb.add(q.name)
            neighbours[it["image"]] = nb
    # map neighbour file names to their labels from the official CSVs
    ml = Path(items[0]["image"]).parents[1] if items else None
    name_label = {}
    for it in items:
        if it["dataset"] == "RxHandBD":
            root = Path(it["image"]).parents[1]
            for f in ("Test_Label.csv", "Train_Label.csv"):
                with open(root / f, encoding="utf-8-sig", newline="") as fh:
                    for r in csv.DictReader(fh):
                        name_label[r["Images"]] = r["Text"]
            break
    neighbours = {k: {norm(name_label[n]) for n in v if n in name_label} for k, v in neighbours.items()}
    return labels, neighbours


def cmd_score(args):
    items = json.loads(MANIFEST.read_text(encoding="utf-8"))["items"]
    rows = [json.loads(l) for l in RUNS.read_text(encoding="utf-8").splitlines() if l.strip()]
    labels, neighbours = load_truth(items)
    scored = score_rows(rows, labels, neighbours)
    report = {}
    for ds in ["RxHandBD", "BD-Prescription", None]:
        sub = [s for s in scored if ds is None or s["dataset"] == ds]
        report[ds or "Combined"] = summarize(sub)
    print(json.dumps(report, indent=1))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("sample"); s.add_argument("--data", required=True); s.add_argument("--per-dataset", type=int, default=60)
    r = sub.add_parser("run"); r.add_argument("--min-readers", type=int, default=4); r.add_argument("--sleep", type=float, default=1)
    r.add_argument("--max-images", type=int, default=0, help="stop after this many new images (0 = no limit)")
    c = sub.add_parser("score"); c.add_argument("--config", default="app")
    a = ap.parse_args()
    {"sample": cmd_sample, "run": cmd_run, "score": cmd_score}[a.cmd](a)
