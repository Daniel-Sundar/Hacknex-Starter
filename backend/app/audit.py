"""Security audit events: one JSON line each on the "clearscript.audit" logger (Render keeps stdout logs).

Schema: {"ts", "event", "outcome", "request_id", "ip", "actor", "method", "path", ...extra}.
`actor` is a hash of the owner key, never a raw id, token or email. Never pass secrets, file contents or
recognised text as extra fields. Logging never raises: a broken log line must not break a request.
"""

import json
import logging
import time

from fastapi import Request

log = logging.getLogger("clearscript.audit")
if not log.handlers:  # uvicorn does not configure app loggers; print audit lines on their own
    _h = logging.StreamHandler()
    _h.setFormatter(logging.Formatter("%(message)s"))
    log.addHandler(_h)
    log.setLevel(logging.INFO)
    log.propagate = False


def client_ip(request: Request) -> str:
    from .main import _client_ip  # one definition of "real client IP" (TRUST_PROXY aware)
    return _client_ip(request)


def event(name: str, request: Request | None = None, outcome: str = "ok", actor: str | None = None, **extra) -> None:
    try:
        rec = {"ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "event": name, "outcome": outcome}
        if request is not None:
            rec.update(request_id=getattr(request.state, "request_id", None), ip=client_ip(request),
                       method=request.method, path=request.url.path)
        if actor:
            from .identity import short
            rec["actor"] = short(actor)
        rec.update({k: v for k, v in extra.items() if v is not None})
        log.info(json.dumps(rec, ensure_ascii=False, default=str))
    except Exception:  # noqa: BLE001
        pass
