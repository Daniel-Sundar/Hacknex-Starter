"""Prescription safety checks. Pure Python: no model calls, no quota.

1. Look-alike drug alarm: a drug name is flagged even when every reader agrees on it, if it is one or two
   letters away from a DIFFERENT drug (hydroxyzine / hydralazine). Agreement on a look-alike name is not
   proof: the readers can all make the same mistake, and a swapped drug can hurt someone.
2. Dose sanity check: each prescription row is checked against usual strengths and the usual adult
   maximum per day. A warning never changes the text; it only asks a human to look.

Reference values are adult oral doses from standard formularies, kept deliberately simple. They are a
safety net for reading errors (650 read as 6500, mcg written as mg), not clinical advice.
"""
import re
from difflib import SequenceMatcher, get_close_matches

# canonical name -> unit, usual strengths per tablet/capsule, usual adult max per day (same unit; None = no check)
DRUGS: dict[str, tuple[str, list[float], float | None]] = {
    "paracetamol": ("mg", [125, 250, 325, 500, 650, 1000], 4000),
    "ibuprofen": ("mg", [200, 400, 600, 800], 3200),
    "diclofenac": ("mg", [25, 50, 75, 100], 150),
    "aceclofenac": ("mg", [100, 200], 200),
    "aspirin": ("mg", [75, 150, 325, 500], 4000),
    "amoxicillin": ("mg", [250, 500, 875, 1000], 3000),
    "amoxicillin-clavulanate": ("mg", [228, 375, 457, 625, 1000], 3000),
    "azithromycin": ("mg", [250, 500], 1000),
    "ciprofloxacin": ("mg", [250, 500, 750], 1500),
    "cefixime": ("mg", [100, 200, 400], 400),
    "doxycycline": ("mg", [100], 200),
    "metronidazole": ("mg", [200, 400, 500], 4000),
    "pantoprazole": ("mg", [20, 40], 80),
    "omeprazole": ("mg", [10, 20, 40], 80),
    "rabeprazole": ("mg", [10, 20], 40),
    "ranitidine": ("mg", [150, 300], 600),
    "ondansetron": ("mg", [4, 8], 24),
    "domperidone": ("mg", [10], 30),
    "metformin": ("mg", [500, 850, 1000], 2550),
    "glimepiride": ("mg", [1, 2, 3, 4], 8),
    "amlodipine": ("mg", [2.5, 5, 10], 10),
    "telmisartan": ("mg", [20, 40, 80], 80),
    "atorvastatin": ("mg", [10, 20, 40, 80], 80),
    "clopidogrel": ("mg", [75, 300], 600),
    "cetirizine": ("mg", [5, 10], 10),
    "levocetirizine": ("mg", [5], 5),
    "montelukast": ("mg", [4, 5, 10], 10),
    "prednisolone": ("mg", [5, 10, 20, 40], None),
    "levothyroxine": ("mcg", [12.5, 25, 50, 75, 88, 100, 112, 125, 137, 150, 175, 200], 300),
}

# Brand and short names written on Indian prescriptions -> canonical name
ALIASES = {
    "dolo": "paracetamol", "crocin": "paracetamol", "calpol": "paracetamol", "pcm": "paracetamol",
    "acetaminophen": "paracetamol", "brufen": "ibuprofen", "voveran": "diclofenac", "ecosprin": "aspirin",
    "amoxycillin": "amoxicillin", "mox": "amoxicillin", "augmentin": "amoxicillin-clavulanate",
    "amoxyclav": "amoxicillin-clavulanate", "moxclav": "amoxicillin-clavulanate", "clavam": "amoxicillin-clavulanate",
    "azithral": "azithromycin", "azee": "azithromycin", "ciplox": "ciprofloxacin", "taxim-o": "cefixime",
    "flagyl": "metronidazole", "metrogyl": "metronidazole", "pan": "pantoprazole", "pantop": "pantoprazole",
    "omez": "omeprazole", "rablet": "rabeprazole", "zinetac": "ranitidine", "emeset": "ondansetron",
    "domstal": "domperidone", "glycomet": "metformin", "amlong": "amlodipine", "telma": "telmisartan",
    "atorva": "atorvastatin", "clopilet": "clopidogrel", "okacet": "cetirizine", "levocet": "levocetirizine",
    "montair": "montelukast", "wysolone": "prednisolone", "thyroxine": "levothyroxine",
    "thyronorm": "levothyroxine", "eltroxin": "levothyroxine",
}

# More medicines commonly prescribed in India (essential-medicine generics and the brands written for them).
# Adult oral strengths and usual maximum per day from standard formularies; a reading-error net, not advice.
DRUGS.update({
    "cefuroxime": ("mg", [125, 250, 500], 1000), "cefpodoxime": ("mg", [100, 200], 400),
    "levofloxacin": ("mg", [250, 500, 750], 750), "ofloxacin": ("mg", [200, 400], 800),
    "norfloxacin": ("mg", [400], 800), "nitrofurantoin": ("mg", [50, 100], 400),
    "clarithromycin": ("mg", [250, 500], 1000), "linezolid": ("mg", [600], 1200),
    "fluconazole": ("mg", [50, 150, 200], 400), "albendazole": ("mg", [400], 800),
    "ivermectin": ("mg", [3, 6, 12], None), "acyclovir": ("mg", [200, 400, 800], 4000),
    "tinidazole": ("mg", [300, 500, 1000], 2000), "esomeprazole": ("mg", [20, 40], 80),
    "famotidine": ("mg", [20, 40], 80), "itopride": ("mg", [50], 150), "drotaverine": ("mg", [40, 80], 240),
    "dicyclomine": ("mg", [10, 20], 160), "loperamide": ("mg", [2], 16), "mefenamic": ("mg", [250, 500], 1500),
    "tramadol": ("mg", [50, 100], 400), "nimesulide": ("mg", [100], 200), "etoricoxib": ("mg", [60, 90, 120], 120),
    "chlorpheniramine": ("mg", [4], 24), "fexofenadine": ("mg", [120, 180], 180), "hydroxyzine": ("mg", [10, 25], 100),
    "losartan": ("mg", [25, 50, 100], 100), "olmesartan": ("mg", [10, 20, 40], 40), "enalapril": ("mg", [2.5, 5, 10, 20], 40),
    "ramipril": ("mg", [1.25, 2.5, 5, 10], 10), "metoprolol": ("mg", [25, 50, 100], 400), "atenolol": ("mg", [25, 50, 100], 100),
    "bisoprolol": ("mg", [2.5, 5, 10], 20), "cilnidipine": ("mg", [5, 10, 20], 20),
    "hydrochlorothiazide": ("mg", [12.5, 25], 50), "furosemide": ("mg", [20, 40], None),
    "spironolactone": ("mg", [25, 50, 100], 400), "rosuvastatin": ("mg", [5, 10, 20, 40], 40),
    "gliclazide": ("mg", [30, 40, 60, 80], 320), "glipizide": ("mg", [2.5, 5, 10], 40),
    "sitagliptin": ("mg", [25, 50, 100], 100), "vildagliptin": ("mg", [50], 100), "teneligliptin": ("mg", [20], 40),
    "voglibose": ("mg", [0.2, 0.3], 0.9), "pioglitazone": ("mg", [15, 30], 45), "dapagliflozin": ("mg", [5, 10], 10),
    "empagliflozin": ("mg", [10, 25], 25), "salbutamol": ("mg", [2, 4], 32), "methylprednisolone": ("mg", [4, 8, 16], None),
    "dexamethasone": ("mg", [0.5, 4], None), "deflazacort": ("mg", [6, 24, 30], None),
    "ursodeoxycholic": ("mg", [150, 300], None), "sertraline": ("mg", [25, 50, 100], 200),
    "escitalopram": ("mg", [5, 10, 20], 20), "fluoxetine": ("mg", [10, 20], 80), "amitriptyline": ("mg", [10, 25], 150),
    "alprazolam": ("mg", [0.25, 0.5, 1], 4), "clonazepam": ("mg", [0.25, 0.5, 1, 2], 20),
    "gabapentin": ("mg", [100, 300, 400], 3600), "pregabalin": ("mg", [75, 150], 600),
    "carbamazepine": ("mg", [100, 200, 400], 1600), "valproate": ("mg", [200, 300, 500], 2500),
    "levetiracetam": ("mg", [250, 500, 750], 3000), "phenytoin": ("mg", [100], 600), "warfarin": ("mg", [1, 2, 5], None),
    "allopurinol": ("mg", [100, 300], 900), "febuxostat": ("mg", [40, 80], 120), "tamsulosin": ("mg", [0.4], 0.8),
})
ALIASES.update({
    "pacimol": "paracetamol", "zerodol": "aceclofenac", "hifenac": "aceclofenac", "meftal": "mefenamic", "nise": "nimesulide",
    "nucoxia": "etoricoxib", "cifran": "ciprofloxacin", "levoflox": "levofloxacin", "zanocin": "ofloxacin",
    "norflox": "norfloxacin", "ceftum": "cefuroxime", "cepodem": "cefpodoxime", "zifi": "cefixime",
    "claribid": "clarithromycin", "forcan": "fluconazole", "zentel": "albendazole", "ivecop": "ivermectin",
    "zovirax": "acyclovir", "aciclovir": "acyclovir", "tiniba": "tinidazole", "nexpro": "esomeprazole", "razo": "rabeprazole",
    "famocid": "famotidine", "ganaton": "itopride", "drotin": "drotaverine", "imodium": "loperamide",
    "ondem": "ondansetron", "vomikind": "ondansetron", "cetzine": "cetirizine", "allegra": "fexofenadine",
    "atarax": "hydroxyzine", "losar": "losartan", "olmezest": "olmesartan", "envas": "enalapril", "cardace": "ramipril",
    "metolar": "metoprolol", "tenormin": "atenolol", "aten": "atenolol", "concor": "bisoprolol", "cilacar": "cilnidipine",
    "lasix": "furosemide", "frusemide": "furosemide", "aldactone": "spironolactone", "rosuvas": "rosuvastatin",
    "crestor": "rosuvastatin", "lipitor": "atorvastatin", "diamicron": "gliclazide", "januvia": "sitagliptin",
    "galvus": "vildagliptin", "volix": "voglibose", "pioz": "pioglitazone", "forxiga": "dapagliflozin",
    "jardiance": "empagliflozin", "amaryl": "glimepiride", "glynase": "glipizide", "asthalin": "salbutamol",
    "albuterol": "salbutamol", "medrol": "methylprednisolone", "dexona": "dexamethasone", "defcort": "deflazacort",
    "udiliv": "ursodeoxycholic", "nexito": "escitalopram", "fludac": "fluoxetine", "tryptomer": "amitriptyline",
    "alprax": "alprazolam", "clonotril": "clonazepam", "rivotril": "clonazepam", "gabapin": "gabapentin",
    "lyrica": "pregabalin", "tegretol": "carbamazepine", "valparin": "valproate", "levipil": "levetiracetam",
    "eptoin": "phenytoin", "dilantin": "phenytoin", "zyloric": "allopurinol", "febutaz": "febuxostat", "urimax": "tamsulosin",
})

# Look-alike / sound-alike pairs that are known to be confused (ISMP list and common handwriting mix-ups).
LASA_GROUPS = [
    ["hydroxyzine", "hydralazine"], ["celebrex", "celexa", "cerebyx"], ["clonidine", "clonazepam", "klonopin"],
    ["zyrtec", "zyprexa", "zantac", "xanax"], ["lamictal", "lamisil"], ["tramadol", "trazodone"],
    ["prednisone", "prednisolone"], ["chlorpromazine", "chlorpropamide"], ["glipizide", "glyburide", "glimepiride"],
    ["carbamazepine", "oxcarbazepine"], ["amlodipine", "amiloride"], ["cefuroxime", "cefotaxime", "ceftriaxone"],
    ["losec", "lasix"], ["norvasc", "navane"], ["methotrexate", "metolazone"], ["quinine", "quinidine"],
    ["morphine", "hydromorphone"], ["adderall", "inderal"], ["avandia", "coumadin"], ["metformin", "metronidazole"],
    ["atorvastatin", "rosuvastatin", "pravastatin"], ["losartan", "valsartan"], ["azithromycin", "erythromycin"],
    ["doxycycline", "dicyclomine"], ["cetirizine", "levocetirizine"],
    ["alprazolam", "lorazepam"], ["clonazepam", "clobazam"], ["sitagliptin", "sumatriptan"],
    ["fluoxetine", "duloxetine", "paroxetine"], ["metoprolol", "misoprostol"],
]

_LASA: dict[str, set[str]] = {}
for _g in LASA_GROUPS:
    for _name in _g:
        _LASA.setdefault(_name, set()).update(x for x in _g if x != _name)

# Every drug name we know, for the spelling-distance rule (two known drugs that differ by a letter or two)
KNOWN = sorted(set(DRUGS) | set(ALIASES) | set(_LASA))


def _key(text: str) -> str:
    return re.sub(r"[^a-z\-]", "", text.lower()).strip("-")


def lookalikes(text: str) -> list[str]:
    """Other drugs this word could be mistaken for ([] if the word is not a known drug name)."""
    k = _key(text)
    if len(k) < 4 or k not in KNOWN:
        return []
    out = set(_LASA.get(k, ()))
    canon = ALIASES.get(k, k)
    for other in KNOWN:  # differs by a letter or two from another drug that is not the same medicine
        if other == k or ALIASES.get(other, other) == canon or len(other) < 6 or len(k) < 6:
            continue
        if SequenceMatcher(None, k, other).ratio() >= 0.8:
            out.add(other)
    return sorted(out)


def lasa_flags(words: list[dict]) -> list[dict]:
    """Flag known drug names that look like a different drug, even when every reader agreed.
    A word the human already confirmed is final and never re-flagged."""
    out = []
    for w in words:
        w = dict(w)
        if w.get("text", "\n") != "\n" and w.get("resolved_by") != "human":
            alike = lookalikes(w["text"])
            if alike:  # kept out of `alternatives`: context_fix must never swap in a drug no reader saw
                w.update(flagged=True, lookalikes=alike)
        out.append(w)
    return out


# ---------- dose sanity check ----------

UNIT_TO_MG = {"g": 1000, "gm": 1000, "gram": 1000, "grams": 1000, "mg": 1, "mcg": 0.001, "ug": 0.001, "µg": 0.001}
_FRACTIONS = {"½": 0.5, "1/2": 0.5, "¼": 0.25, "1/4": 0.25}
_TIMES = [  # (pattern, doses per day)
    (r"\b(od|qd|once|daily|hs|at night|bedtime|qhs|morning)\b", 1), (r"\b(bd|bid|twice|12\s*hourly|q12h)\b", 2),
    (r"\b(tds|tid|thrice|three times|8\s*hourly|q8h)\b", 3), (r"\b(qid|four times|6\s*hourly|q6h)\b", 4),
    (r"\b(4\s*hourly|q4h)\b", 6),
]


def drug_of(text: str) -> str | None:
    """Canonical drug name in a table cell ('Tab. Dolo 650' -> paracetamol)."""
    for tok in re.findall(r"[a-zA-Z][a-zA-Z\-]+", text):
        k = _key(tok)
        if len(k) < 3:
            continue
        k = ALIASES.get(k, k)
        if k in DRUGS:
            return k
        m = get_close_matches(k, list(DRUGS) + list(ALIASES), n=1, cutoff=0.85)
        if m:
            return ALIASES.get(m[0], m[0])
    return None


def strength_of(text: str) -> tuple[float, str | None] | None:
    """'650 mg' -> (650, 'mg'); '0.5g' -> (0.5, 'g'); '650' -> (650, None)."""
    m = re.search(r"(\d+(?:\.\d+)?)\s*(mcg|µg|ug|mg|gm|grams?|g)?\b", text, flags=re.I)
    return (float(m.group(1)), m.group(2).lower() if m.group(2) else None) if m else None


def per_day(freq: str) -> float | None:
    """Tablets per day from '1-0-1', '½-0-½', '2 tabs twice daily', 'TDS'. None for SOS / unknown."""
    f = freq.lower()
    for k, v in _FRACTIONS.items():
        f = f.replace(k, str(v))
    m = re.search(r"\b(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)(?:\s*-\s*(\d+(?:\.\d+)?))?\b", f)
    if m:
        return sum(float(x) for x in m.groups() if x)
    if re.search(r"\b(sos|prn|as needed|stat)\b", f):
        return None
    for pat, n in _TIMES:
        if re.search(pat, f):
            q = re.search(r"\b(\d+(?:\.\d+)?)\s*(tab|tabs|tablets?|caps?|capsules?)\b", f)
            return n * (float(q.group(1)) if q else 1)
    return None


def _fmt(x: float) -> str:
    return f"{x:g}"


def dose_warnings(row: dict) -> list[str]:
    """Plain-language warnings for one prescription row ([] = nothing odd)."""
    warns = []
    drug = drug_of(f"{row.get('drug', '')}")
    s = strength_of(row.get("strength", "")) or strength_of(row.get("drug", ""))
    freq = row.get("frequency", "")
    m = re.search(r"\b(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)", freq)
    if m and any(float(x) > 4 for x in m.groups()):
        warns.append(f"Frequency '{m.group(0)}' is unusual: each number is normally 0, ½, 1 or 2 tablets")
    if s:
        value, unit = s
        if unit in ("g", "gm", "gram", "grams") and value >= 5:
            warns.append(f"{_fmt(value)} {unit} in one tablet is not possible: probably mg")
            return warns  # the other checks would only repeat this
    if not drug or not s:
        return warns
    unit_ref, usual, max_day = DRUGS[drug]
    value, unit = s
    mg = value * UNIT_TO_MG.get(unit or unit_ref, 1)
    ref = mg / UNIT_TO_MG[unit_ref]  # strength in the drug's reference unit
    if not any(abs(ref - u) < 1e-6 for u in usual):
        warns.append(f"{_fmt(value)} {unit or unit_ref} is not a usual {drug} strength "
                     f"(usual: {', '.join(_fmt(u) for u in usual)} {unit_ref})")
    n = per_day(freq)
    if n and max_day and ref * n > max_day * 1.001:
        warns.append(f"{_fmt(ref * n)} {unit_ref}/day is above the usual adult maximum of {_fmt(max_day)} {unit_ref}/day")
    return warns


def check_rows(rows: list[dict]) -> list[dict]:
    """Adds 'warnings' to every row; a row with a warning is also flagged."""
    out = []
    for r in rows:
        w = dose_warnings(r)
        out.append({**r, "warnings": w, "flagged": bool(r.get("flagged")) or bool(w)})
    return out
