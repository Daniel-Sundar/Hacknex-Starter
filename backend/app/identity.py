"""Who is calling: the owner key that scopes per-user data (Docs Q&A documents, writer profiles).

- Signed in: the browser sends its Supabase access token (Authorization: Bearer ...). It is checked with
  Supabase Auth (GET /auth/v1/user), never trusted on its own, and the owner is "u:<user id>".
- Signed out: the browser sends X-Client-Id, a random id it generated and keeps in localStorage. The owner is
  "c:<id>". The id is an unguessable secret (>= 128 bits), so another visitor cannot name it.

A token that does not verify is refused (401) rather than silently treated as signed out.
"""

import hashlib
import logging
import os
import re
import threading
import time

import httpx
from fastapi import HTTPException, Request

from . import audit

log = logging.getLogger(__name__)
_client = httpx.Client(timeout=5.0)
CLIENT_ID = re.compile(r"^[A-Za-z0-9_-]{22,64}$")
_cache: dict[str, tuple[float, str]] = {}  # sha256(token) -> (expires, user id)
_cache_lock = threading.Lock()
CACHE_S = 300


def _err(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status, detail={"code": code, "message": message})


def _verify(token: str) -> str | None:
    """Supabase user id for a valid access token, else None. Results are cached for 5 minutes."""
    key = hashlib.sha256(token.encode()).hexdigest()
    now = time.monotonic()
    with _cache_lock:
        hit = _cache.get(key)
        if hit and hit[0] > now:
            return hit[1]
    url = os.getenv("SUPABASE_URL", "").rstrip("/")
    apikey = os.getenv("SUPABASE_PUBLISHABLE_KEY") or os.getenv("SUPABASE_SERVICE_KEY", "")
    if not url or not apikey:
        return None
    try:
        r = _client.get(f"{url}/auth/v1/user", headers={"apikey": apikey, "Authorization": f"Bearer {token}"})
    except httpx.HTTPError:
        log.warning("supabase auth check failed (network)")
        raise _err(503, "auth_unavailable", "Couldn't check your sign-in right now. Try again in a minute.")
    if r.status_code != 200:
        return None
    uid = str((r.json() or {}).get("id") or "")
    if not uid:
        return None
    with _cache_lock:
        if len(_cache) > 5000:
            _cache.clear()
        _cache[key] = (now + CACHE_S, uid)
    return uid


def _supabase_on() -> bool:
    return bool(os.getenv("SUPABASE_URL") and (os.getenv("SUPABASE_PUBLISHABLE_KEY") or os.getenv("SUPABASE_SERVICE_KEY")))


def owner(request: Request) -> str:
    """FastAPI dependency: the caller's owner key. 401 for a bad token, 400 when there is no identity at all."""
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer ") and _supabase_on():
        token = auth[7:].strip()
        uid = _verify(token) if token else None
        if not uid:
            audit.event("auth.token_rejected", request, outcome="denied")
            raise _err(401, "signed_out", "Your sign-in has expired. Sign in again.")
        return f"u:{uid}"
    cid = request.headers.get("x-client-id", "")
    if CLIENT_ID.match(cid):
        return f"c:{cid}"
    audit.event("auth.no_identity", request, outcome="denied")
    raise _err(400, "no_client_id", "Reload the page and try again.")


def short(owner_key: str) -> str:
    """A stable, non-reversible tag for an owner: used in file names and logs instead of the raw id."""
    return hashlib.sha256(owner_key.encode()).hexdigest()[:16]
