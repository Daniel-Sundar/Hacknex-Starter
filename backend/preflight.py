"""Pre-flight check before a demo. Uses NO model quota: keys are checked by listing models, and demo pages
are checked against the local reading cache (the image is cleaned on this laptop, nothing is sent).

Run from the project root:  .\\preflight.ps1            (or: backend\\.venv\\Scripts\\python backend\\preflight.py)
Options: --backend URL (default http://localhost:8000)  --frontend URL (default http://localhost:5173)
         --demo FOLDER (default backend/data/demo: put the pages you will show there)
Exit code 0 = READY, 1 = something needs fixing. Keys are never printed, only their last 4 characters.
"""
import argparse
import hashlib
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
os.chdir(HERE)

from dotenv import load_dotenv  # noqa: E402

load_dotenv(HERE / ".env")

from app import handwriting as hw, llm  # noqa: E402

MODEL_LISTS = {
    "gemini": "https://generativelanguage.googleapis.com/v1beta/openai/models",
    "groq": "https://api.groq.com/openai/v1/models",
    "openrouter": "https://openrouter.ai/api/v1/models",
}
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".pdf"}
problems: list[str] = []


def line(ok: bool | None, text: str, fix: str = "") -> None:
    mark = "[ OK ]" if ok else "[WARN]" if ok is None else "[FAIL]"
    print(f"{mark} {text}")
    if fix and not ok:
        print(f"       -> {fix}")
    if ok is False:
        problems.append(text)


def get(url: str, key: str | None = None, timeout: float = 20):
    headers = {"User-Agent": "curl/8.5"}  # some providers' firewalls block Python's default agent
    if key:
        headers["Authorization"] = f"Bearer {key}"
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=timeout) as r:
        return r.status, r.read()


def readers() -> list[list[tuple[str, str | None]]]:
    return hw._slots()


def check_keys_and_models() -> None:
    print("\nKeys and reading models")
    slots = readers()
    used = sorted({p for slot in slots for p, _ in slot} | {llm.active_provider()} - {"mock", "ollama", "claude"})
    for prov in used:
        if prov not in MODEL_LISTS:
            continue
        keys = llm.keys(prov)
        if not keys:
            line(False, f"{prov}: no API key", f"add {prov.upper()}_API_KEY (or {prov.upper()}_API_KEYS) to backend\\.env")
            continue
        models: set[str] = set()
        good = 0
        for i, key in enumerate(keys, 1):
            try:
                _, body = get(MODEL_LISTS[prov], key)
                models |= {m.get("id", "").removeprefix("models/") for m in json.loads(body).get("data", [])}
                good += 1
            except urllib.error.HTTPError as e:
                line(False, f"{prov} key {i} (...{key[-4:]}) refused (HTTP {e.code})",
                     "replace this key in backend\\.env, or remove it")
            except Exception as e:
                line(False, f"{prov} key {i} (...{key[-4:]}): no answer ({type(e).__name__})",
                     "check the internet connection")
        if good:
            line(True, f"{prov}: {good} of {len(keys)} key(s) valid")
        wanted = sorted({m for slot in slots for p, m in slot if p == prov and m})
        missing = [m for m in wanted if models and m not in models]
        if missing:
            line(False, f"{prov}: model(s) no longer offered: {', '.join(missing)}",
                 "remove them from HW_READERS in backend\\.env")
        elif wanted and models:
            line(True, f"{prov}: all {len(wanted)} reading model(s) available")
    line(len(slots) >= 3, f"{len(slots)} reader slots configured (HW_READERS)",
         "at least 3 readers are needed for a useful vote")


def check_servers(backend: str, frontend: str) -> None:
    print("\nServers")
    try:
        _, body = get(f"{backend}/api/health", timeout=5)
        h = json.loads(body)
        line(bool(h.get("ok")), f"backend running at {backend} ({len(h.get('readers', []))} readers, text model: {h.get('provider')})")
    except Exception:
        line(False, f"backend not reachable at {backend}", "start it: .\\dev.ps1 (close old backend windows first)")
    try:
        status, _ = get(frontend, timeout=5)
        line(status == 200, f"frontend running at {frontend}")
    except Exception:
        line(False, f"frontend not reachable at {frontend}", "start it: .\\dev.ps1")


def cache_file(parts: list) -> Path:
    key = hashlib.sha256(json.dumps(parts, sort_keys=True).encode()).hexdigest()[:32]
    return hw.CACHE / f"{key}.json"


def check_demo(folder: Path) -> None:
    print(f"\nDemo pages ({folder})")
    pages = sorted(p for p in folder.glob("*") if p.suffix.lower() in IMAGE_EXTS) if folder.exists() else []
    if not pages:
        line(None, "no demo pages found",
             f"optional: copy the pages you will show into {folder}, digitize each once in the app, run this again")
        return
    prompts = [hw.prompt_for(t) for t in ("auto", "form", "prescription", "legal")]
    slots = readers()
    for page in pages:
        try:
            img = hw.clean(hw.prepare(page.read_bytes()))  # the app cleans before reading (default setting)
        except Exception as e:
            line(False, f"{page.name}: cannot be opened ({str(e)[:80]})", "use a JPG or PNG photo of the page")
            continue
        h = hashlib.sha256(img).hexdigest()
        best = 0
        for prompt in prompts:
            saved = sum(1 for slot in slots if any(cache_file(["read", h, p, m, prompt]).exists() for p, m in slot))
            best = max(best, saved)
        if best == len(slots):
            line(True, f"{page.name}: saved ({best} of {len(slots)} readers), shows instantly, works offline")
        elif best:
            line(None, f"{page.name}: partly saved ({best} of {len(slots)} readers)",
                 "digitize it once more in the app while quota is available")
        else:
            line(False, f"{page.name}: not saved yet", "digitize it once in the app (default settings)")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--backend", default="http://localhost:8000")
    ap.add_argument("--frontend", default="http://localhost:5173")
    ap.add_argument("--demo", default=str(HERE / "data" / "demo"))
    a = ap.parse_args()
    print("ClearScript pre-flight check (uses no AI quota)")
    line((HERE / ".env").exists(), "backend\\.env found", "copy backend\\.env.example to backend\\.env and add keys")
    check_keys_and_models()
    check_servers(a.backend.rstrip("/"), a.frontend.rstrip("/"))
    check_demo(Path(a.demo))
    print()
    if problems:
        print(f"NOT READY: {len(problems)} problem(s) above.")
        return 1
    print("READY. Don't change code or settings before the demo.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
