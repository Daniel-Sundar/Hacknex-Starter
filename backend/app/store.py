"""Optional Supabase storage for what must survive a server restart (Render's disk is wiped on every deploy):
the model-reading cache and writer profiles. Off unless SUPABASE_URL and SUPABASE_SERVICE_KEY are set; then the
local files are still used first and Supabase is the shared, durable copy. Every failure is logged and ignored, so
the pipeline never breaks because the database is down.

Tables: see backend/supabase.sql. Uses Supabase's REST API (PostgREST) with the service_role key, server-side only.
"""

import logging
import os

import httpx

log = logging.getLogger(__name__)
_client = httpx.Client(timeout=5.0)


def _cfg() -> tuple[str, str]:  # read at call time: .env is loaded after this module is imported
    return os.getenv("SUPABASE_URL", "").rstrip("/"), os.getenv("SUPABASE_SERVICE_KEY", "")


def is_enabled() -> bool:
    url, key = _cfg()
    return bool(url and key)


def _req(method: str, table: str, **kw):
    url, key = _cfg()
    headers = {"apikey": key, **kw.pop("headers", {})}
    if key.startswith("eyJ"):  # legacy JWT keys also go in Authorization; new sb_secret_ keys only in apikey
        headers["Authorization"] = f"Bearer {key}"
    r = _client.request(method, f"{url}/rest/v1/{table}", headers=headers, **kw)
    r.raise_for_status()
    return r.json() if r.content else None


def cache_get(key: str):
    if not is_enabled():
        return None
    try:
        rows = _req("GET", "readings_cache", params={"key": f"eq.{key}", "select": "value"})
        return rows[0]["value"] if rows else None
    except Exception as e:  # noqa: BLE001
        log.warning("supabase cache_get failed: %s", e)
        return None


def cache_put(key: str, value) -> None:
    if not is_enabled():
        return
    try:
        _req("POST", "readings_cache", params={"on_conflict": "key"}, json={"key": key, "value": value},
             headers={"Prefer": "resolution=merge-duplicates"})
    except Exception as e:  # noqa: BLE001
        log.warning("supabase cache_put failed: %s", e)


def writer_words(writer: str) -> list[str]:
    if not is_enabled():
        return []
    try:
        rows = _req("GET", "writer_words", params={"writer": f"eq.{writer}", "select": "answer", "order": "created_at"})
        return [r["answer"] for r in rows]
    except Exception as e:  # noqa: BLE001
        log.warning("supabase writer_words failed: %s", e)
        return []


def save_answer(writer: str, original: str, answer: str) -> None:
    if not is_enabled():
        return
    try:
        _req("POST", "writer_words", params={"on_conflict": "writer,answer"}, json={"writer": writer, "original": original, "answer": answer},
             headers={"Prefer": "resolution=ignore-duplicates"})
    except Exception as e:  # noqa: BLE001
        log.warning("supabase save_answer failed: %s", e)
