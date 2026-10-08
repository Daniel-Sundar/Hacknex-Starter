"""Dataset inventory for the two prescription word-image datasets (RxHandBD, Doctor's Handwritten Prescription BD).

Checks counts, labels, unreadable images, sizes, label vocabulary, and duplicates within and across splits
(exact bytes + near-identical images by 64-bit difference hash). Read-only: it never changes the datasets.

Usage (from backend/):  .venv/Scripts/python bench/inventory.py <datasets_dir>  > inventory.md
<datasets_dir> holds rxhandbd/ and bd_prescription/ as extracted from the two ZIPs.
"""
import csv
import hashlib
import statistics
import sys
from collections import Counter, defaultdict
from pathlib import Path

import cv2
import numpy as np


def load_splits(root: Path) -> dict[str, dict[str, list[tuple[Path, str]]]]:
    """{dataset: {split: [(image path, label)]}} from the official label files."""
    out: dict[str, dict[str, list[tuple[Path, str]]]] = {}
    ml = root / "rxhandbd" / "RxHandBD-ML" / "RxHandBD-ML"
    out["RxHandBD"] = {}
    for split, folder, labels in [("train", "Train_Set", "Train_Label.csv"), ("test", "Test_Set", "Test_Label.csv")]:
        with open(ml / labels, encoding="utf-8-sig", newline="") as f:
            out["RxHandBD"][split] = [(ml / folder / r["Images"], r["Text"]) for r in csv.DictReader(f)]
    bd = root / "bd_prescription" / "Dataset" / "Dataset"
    out["BD-Prescription"] = {}
    for split, folder in [("train", "Training"), ("validation", "Validation"), ("test", "Testing")]:
        with open(bd / folder / f"{folder.lower()}_labels.csv", encoding="utf-8-sig", newline="") as f:
            out["BD-Prescription"][split] = [(bd / folder / f"{folder.lower()}_words" / r["IMAGE"], r["MEDICINE_NAME"])
                                             for r in csv.DictReader(f)]
    return out


def dhash(img: np.ndarray) -> int:
    small = cv2.resize(img, (9, 8), interpolation=cv2.INTER_AREA)
    bits = (small[:, 1:] > small[:, :-1]).flatten()
    return int("".join("1" if b else "0" for b in bits), 2)


def main():
    root = Path(sys.argv[1])
    data = load_splits(root)
    print("# Dataset inventory\n")
    for name, splits in data.items():
        print(f"## {name}\n")
        print("| Split | Labelled rows | Image missing | Unreadable | Empty label | Unique labels | Median size (w x h) |")
        print("|---|---|---|---|---|---|---|")
        info: dict[str, dict] = {}
        for split, rows in splits.items():
            missing = unreadable = empty = 0
            ws, hs = [], []
            sha: dict[str, list[str]] = defaultdict(list)
            dh: dict[str, int] = {}
            for p, label in rows:
                if not label.strip():
                    empty += 1
                if not p.exists():
                    missing += 1
                    continue
                raw = p.read_bytes()
                img = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_GRAYSCALE)
                if img is None:
                    unreadable += 1
                    continue
                hs.append(img.shape[0]); ws.append(img.shape[1])
                sha[hashlib.sha256(raw).hexdigest()].append(p.name)
                dh[p.name] = dhash(img)
            labels = Counter(l for _, l in rows)
            info[split] = {"rows": rows, "sha": sha, "dh": dh, "labels": labels}
            size = f"{int(statistics.median(ws))} x {int(statistics.median(hs))}" if ws else "-"
            print(f"| {split} | {len(rows)} | {missing} | {unreadable} | {empty} | {len(labels)} | {size} |")
        # files on disk without a label
        for split, rows in splits.items():
            folder = rows[0][0].parent
            on_disk = {p.name for p in folder.iterdir() if p.is_file()}
            unlabelled = on_disk - {p.name for p, _ in rows}
            if unlabelled:
                print(f"\n{split}: {len(unlabelled)} image files have no label row")
        print()
        # duplicates
        names = list(info)
        for s in names:
            dup = sum(len(v) - 1 for v in info[s]["sha"].values() if len(v) > 1)
            print(f"- {split_label(s)}: {dup} exact duplicate files within the split")
        for i, a in enumerate(names):
            for b in names[i + 1:]:
                exact = len(set(info[a]["sha"]) & set(info[b]["sha"]))
                near = near_dups(info[a]["dh"], info[b]["dh"])
                la, lb = set(info[a]["labels"]), set(info[b]["labels"])
                cov = sum(c for l, c in info[b]["labels"].items() if l in la) / max(1, sum(info[b]["labels"].values()))
                print(f"- {a} vs {b}: {exact} identical images, {near} near-identical (dHash distance <= 2); "
                      f"{len(la & lb)} shared labels; {cov:.1%} of {b} rows have a label that also occurs in {a}")
        top = info[names[0]]["labels"].most_common(8)
        print(f"- most common {names[0]} labels: " + ", ".join(f"{l!r} x{c}" for l, c in top))
        lens = [len(l) for s in info.values() for l in s["labels"].elements()]
        print(f"- label length: median {statistics.median(lens)} chars, max {max(lens)}; "
              f"labels with a digit: {sum(any(ch.isdigit() for ch in l) for s in info.values() for l in s['labels'].elements())}; "
              f"with a space: {sum(' ' in l for s in info.values() for l in s['labels'].elements())}\n")


def split_label(s: str) -> str:
    return s


def near_dups(a: dict[str, int], b: dict[str, int], max_dist: int = 2) -> int:
    """Images in b whose dHash is within max_dist bits of some image in a (bucketed for speed)."""
    buckets: dict[int, list[int]] = defaultdict(list)
    for h in a.values():
        buckets[h >> 48].append(h)
    n = 0
    for h in b.values():
        cands = [x for k in (h >> 48,) for x in buckets.get(k, [])]
        if any(bin(h ^ x).count("1") <= max_dist for x in cands):
            n += 1
    return n


if __name__ == "__main__":
    main()
