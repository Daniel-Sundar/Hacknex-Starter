"""Synthetic handwritten prescriptions for testing ClearScript's look-alike and dose checks.
Usage: python make_rx.py <out_dir>"""
import random
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

FONTS = "C:/Windows/Fonts/"
CASES = [
    # name, font, mess (0 clean .. 3 very messy), lines, what it should trigger
    ("rx01_lookalike", "Inkfree.ttf", 1, [
        "Rx  8/10/26", "Tab. Hydroxyzine 25 mg 0-0-1 x 5 days", "Tab. Pantoprazole 40 mg 1-0-0 before food",
        "Review after 1 week"],
     "Look-alike: Hydroxyzine (hydralazine). No dose warning."),
    ("rx02_wrong_unit", "segoepr.ttf", 1, [
        "Rx", "Tab. Thyroxine 100 mg 1-0-0 empty stomach", "Tab. Metformin 500 mg 1-0-1 after food", "x 30 days"],
     "Dose: Thyroxine 100 mg (should be mcg, 1000x). Look-alike: Thyroxine, Metformin (metronidazole)."),
    ("rx03_overdose", "LHANDW.TTF", 2, [
        "Rx", "Tab. Dolo 650 mg 2-2-2-2 x 3 days", "Tab. Cetirizine 10 mg 0-0-1 x 5 days", "Plenty of fluids"],
     "Dose: Dolo 650 x 8 a day = 5200 mg/day (max 4000). Look-alike: Cetirizine (levocetirizine)."),
    ("rx04_normal", "segoesc.ttf", 1, [
        "Rx", "Tab. Paracetamol 500 mg 1-0-1 after food x 3 days", "Tab. Pantoprazole 40 mg 1-0-0 before food",
        "Review after 3 days"],
     "Control: nothing should be flagged by the safety checks."),
    ("rx05_impossible", "mvboli.ttf", 2, [
        "Rx", "Tab. Azithromycin 500 g 1-0-0 x 3 days", "Tab. Amlodipine 5 mg 10-0-10", "Check BP"],
     "Dose: 500 g impossible; frequency 10-0-10 odd and 100 mg/day. Look-alike: Azithromycin, Amlodipine."),
    ("rx06_messy", "BRADHITC.TTF", 3, [
        "Rx", "Tab. Prednisolone 20 mg 1-0-0 x 5 days", "Cap. Amoxicillin 500 mg 1-1-1 x 5 days",
        "Tab. Diclofenac 50 mg 1-0-1 SOS"],
     "Messy photo. Look-alike: Prednisolone (prednisone). Doses normal."),
]


def render(lines: list[str], font_file: str, mess: int, seed: int) -> Image.Image:
    rnd = random.Random(seed)
    W, H = 1400, 160 + 130 * len(lines)
    page = Image.new("L", (W, H), 245)
    d = ImageDraw.Draw(page)
    for y in range(110, H, 65):  # faint ruled lines like a prescription pad
        d.line([(40, y), (W - 40, y)], fill=225, width=2)
    y = 60
    for line in lines:
        size = rnd.randint(52, 60)
        font = ImageFont.truetype(FONTS + font_file, size)
        x = 70 + rnd.randint(-10, 30)
        for word in line.split(" "):  # each word gets its own wobble, like real handwriting
            wsize = max(40, size + rnd.randint(-3 - mess * 2, 3 + mess * 2))
            wf = ImageFont.truetype(FONTS + font_file, wsize)
            box = d.textbbox((0, 0), word, font=wf)
            tile = Image.new("L", (box[2] + 30, box[3] + 30), 0)
            ImageDraw.Draw(tile).text((10, 10), word, font=wf, fill=255)
            tile = tile.rotate(rnd.uniform(-2 - mess * 2, 2 + mess * 2), expand=True, resample=Image.BICUBIC)
            ink = rnd.randint(20, 70)
            page.paste(Image.new("L", tile.size, ink), (int(x), int(y + rnd.randint(-4 - mess * 3, 4 + mess * 3))), tile)
            x += box[2] + rnd.randint(14, 26)
        y += 130
    page = page.rotate(rnd.uniform(-1.5, 1.5) * (mess + 1) / 2, fillcolor=245, resample=Image.BICUBIC)
    if mess >= 2:
        page = page.filter(ImageFilter.GaussianBlur(0.8 * (mess - 1)))
    page = Image.blend(page, Image.effect_noise(page.size, 40), 0.04 + mess * 0.02)  # paper / camera noise
    # uneven phone lighting: darker towards the right edge
    grad = Image.linear_gradient("L").rotate(90, expand=True).resize(page.size)  # 255 left -> 0 right
    floor = 215 if mess >= 2 else 240
    grad = grad.point(lambda v: floor + (255 - floor) * v // 255)
    page = ImageChops.multiply(page, grad)
    return page.convert("RGB")


def main():
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    notes = ["# Synthetic prescriptions for testing ClearScript\n",
             "Generated with handwriting fonts plus slant, wobble, blur and noise. Not real patients.",
             "Each `.jpg` has its exact text in the matching `.txt`.\n",
             "| File | Expected |", "|---|---|"]
    for i, (name, font, mess, lines, expect) in enumerate(CASES):
        render(lines, font, mess, seed=100 + i).save(out / f"{name}.jpg", quality=88)
        (out / f"{name}.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
        notes.append(f"| `{name}.jpg` | {expect} |")
    (out / "README.md").write_text("\n".join(notes) + "\n", encoding="utf-8")
    print("wrote", len(CASES), "prescriptions to", out)


if __name__ == "__main__":
    main()
