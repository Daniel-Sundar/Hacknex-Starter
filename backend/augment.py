"""Make degraded copies of every labelled sample, to measure robustness (15% of the rubric).

For each image + .txt in data/handwriting/samples/, writes
  data/handwriting/augmented/<condition>/<same name>.jpg + the same .txt
Conditions mimic bad real-world photos. Seeded, so copies are identical on every machine.
Then:  .venv/Scripts/python eval.py --robustness [--split test]

Usage (from backend/):  .venv/Scripts/python augment.py [--only blur,dark]
"""
import argparse
import shutil
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
SAMPLES = HERE / "data" / "handwriting" / "samples"
OUT = HERE / "data" / "handwriting" / "augmented"
IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp"}


def blur(img, rng):  # out of focus + a little hand shake
    k = np.zeros((9, 9), np.float32)
    k[4, :] = 1 / 9  # horizontal motion blur
    return cv2.GaussianBlur(cv2.filter2D(img, -1, k), (5, 5), 0)


def dark(img, rng):  # dim room + a soft shadow across the page
    h, w = img.shape[:2]
    shade = np.tile(np.linspace(0.35, 1.0, w, dtype=np.float32), (h, 1))[..., None]
    return np.clip(img.astype(np.float32) * 0.6 * shade, 0, 255).astype(np.uint8)


def noise(img, rng):  # grainy low-light sensor
    return np.clip(img + rng.normal(0, 28, img.shape), 0, 255).astype(np.uint8)


def rotated(img, rng):  # page shot at an angle; canvas grows so no ground-truth word is cut off
    h, w = img.shape[:2]
    m = cv2.getRotationMatrix2D((w / 2, h / 2), 9, 1.0)
    cos, sin = abs(m[0, 0]), abs(m[0, 1])
    nw, nh = int(h * sin + w * cos), int(h * cos + w * sin)
    m[0, 2] += nw / 2 - w / 2
    m[1, 2] += nh / 2 - h / 2
    paper = tuple(int(c) for c in np.median(img.reshape(-1, img.shape[2]), axis=0))
    return cv2.warpAffine(img, m, (nw, nh), borderValue=paper)


def phone(img, rng):  # small, heavily compressed forward of a forward
    h, w = img.shape[:2]
    s = 480 / max(h, w)
    small = cv2.resize(img, None, fx=s, fy=s, interpolation=cv2.INTER_AREA) if s < 1 else img
    ok, buf = cv2.imencode(".jpg", small, [cv2.IMWRITE_JPEG_QUALITY, 15])
    return cv2.imdecode(buf, cv2.IMREAD_COLOR)


CONDITIONS = {"blur": blur, "dark": dark, "noise": noise, "rotated": rotated, "phone": phone}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="", help="comma-separated conditions, e.g. blur,dark")
    args = ap.parse_args()
    conds = [c for c in args.only.split(",") if c] or list(CONDITIONS)

    samples = sorted(p for p in SAMPLES.glob("*") if p.suffix.lower() in IMAGE_EXT and p.with_suffix(".txt").exists())
    for cond in conds:
        folder = OUT / cond
        folder.mkdir(parents=True, exist_ok=True)
        for p in samples:
            img = cv2.imread(str(p), cv2.IMREAD_COLOR)
            if img is None:
                print(f"  skip {p.name}: unreadable image")
                continue
            rng = np.random.default_rng(int.from_bytes(p.stem.encode(), "little") % 2**32)
            cv2.imwrite(str(folder / f"{p.stem}.jpg"), CONDITIONS[cond](img, rng), [cv2.IMWRITE_JPEG_QUALITY, 92])
            shutil.copy(p.with_suffix(".txt"), folder / f"{p.stem}.txt")
        print(f"{cond}: {len(samples)} images -> {folder.relative_to(HERE)}")


if __name__ == "__main__":
    main()
