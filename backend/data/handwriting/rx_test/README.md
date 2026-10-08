# Synthetic prescriptions for testing ClearScript

Generated with handwriting fonts plus slant, wobble, blur and noise. Not real patients.
Each `.jpg` has its exact text in the matching `.txt`.

| File | Expected |
|---|---|
| `rx01_lookalike.jpg` | Look-alike: Hydroxyzine (hydralazine). No dose warning. |
| `rx02_wrong_unit.jpg` | Dose: Thyroxine 100 mg (should be mcg, 1000x). Look-alike: Thyroxine, Metformin (metronidazole). |
| `rx03_overdose.jpg` | Dose: Dolo 650 x 8 a day = 5200 mg/day (max 4000). Look-alike: Cetirizine (levocetirizine). |
| `rx04_normal.jpg` | Control: nothing should be flagged by the safety checks. |
| `rx05_impossible.jpg` | Dose: 500 g impossible; frequency 10-0-10 odd and 100 mg/day. Look-alike: Azithromycin, Amlodipine. |
| `rx06_messy.jpg` | Messy photo. Look-alike: Prednisolone (prednisone). Doses normal. |

Not part of the eval set (`eval.py` only reads `../samples/`): these check the prescription safety
features (`backend/app/rx_safety.py`), not reading accuracy. Upload them in the app and Digitize.

Regenerate (Windows, needs Pillow and the Windows handwriting fonts): `python make_rx.py <out_dir>`
