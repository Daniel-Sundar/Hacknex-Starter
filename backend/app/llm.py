"""One client for every LLM provider.

Gemini, Groq, OpenRouter and Ollama all expose OpenAI-compatible endpoints,
so we use the `openai` SDK and only swap base_url / key / model.
Set LLM_PROVIDER in .env. If a call fails, we fall through LLM_FALLBACKS.
Provider "mock" needs no key: handy for UI work and offline demos.
Provider "claude" uses the official Anthropic SDK (see claude_provider.py).

Several keys per provider: GEMINI_API_KEYS=k1,k2,k3 (and GROQ_/OPENROUTER_API_KEYS), one per teammate's own
account. When a key hits a quota limit the call moves straight to the next key; the single GEMINI_API_KEY etc.
still works and is tried first. Keys are never logged: messages say "key 2 of 3".
"""
import json
import os
import threading
import time
from typing import Callable, Iterator, TypeVar

from openai import OpenAI

PROVIDERS = {
    "gemini": {
        "base_url": "https://generativelanguage.googleapis.com/v1beta/openai/",
        "key_env": "GEMINI_API_KEY",
        "model": "gemini-3.8-flash",
    },
    "groq": {
        "base_url": "https://api.groq.com/openai/v1",
        "key_env": "GROQ_API_KEY",
        "model": "openai/gpt-oss-120b",
    },
    "openrouter": {
        "base_url": "https://openrouter.ai/api/v1",
        "key_env": "OPENROUTER_API_KEY",
        "model": "openrouter/free",
    },
    "ollama": {
        "base_url": os.getenv("OLLAMA_BASE_URL", "http://localhost:11434/v1"),
        "key_env": None,
        "model": "llama3.2:3b",
    },
}


def _order() -> list[str]:
    primary = os.getenv("LLM_PROVIDER", "mock")
    fallbacks = [p.strip() for p in os.getenv("LLM_FALLBACKS", "").split(",") if p.strip()]
    return [primary] + [p for p in fallbacks if p != primary]


def keys(name: str) -> list[str]:
    """Every key for a provider: the single XYZ_API_KEY first, then XYZ_API_KEYS (comma-separated), no duplicates."""
    env = PROVIDERS[name]["key_env"]
    if not env:
        return ["ollama"]
    out = []
    for k in [os.getenv(env, "")] + os.getenv(env + "S", "").split(","):
        k = k.strip().strip('"').strip("'")
        if k and k not in out:
            out.append(k)
    return out


def _client(name: str, key: str | None = None) -> tuple[OpenAI, str]:
    cfg = PROVIDERS[name]
    key = key or next(iter(keys(name)), None)
    if not key:
        raise RuntimeError(f"{cfg['key_env']} is not set")
    model = os.getenv(f"{name.upper()}_MODEL", cfg["model"])
    return OpenAI(base_url=cfg["base_url"], api_key=key), model


# ---------- key rotation ----------

T = TypeVar("T")
_key_lock = threading.Lock()
_key_cool: dict[tuple, float] = {}       # (provider, model, key index) -> skip this key until this time
_key_err: dict[tuple, Exception] = {}     # the error that put it there, re-raised while it cools down
DAY_COOL = 6 * 3600   # daily quota gone: Gemini resets at midnight Pacific, the others within a day
AUTH_COOL = 3600      # key refused (wrong or revoked): don't hammer it


def _key_problem(e: Exception) -> float:
    """Seconds to rest this key, 0 = try the next key now without resting it, -1 = not a key problem."""
    status = getattr(e, "status_code", None)
    msg = "".join(str(e).lower().replace("-", "").replace("_", "").split())  # "PerDay", "per day", "per_day"
    if status == 429:
        return DAY_COOL if "perday" in msg else 0  # per-minute: another account's minute is still free
    if status in (401, 403):
        return AUTH_COOL
    return -1  # overload (503), timeout, bad request: the same model fails with any key


def with_keys(name: str, model: str | None, fn: Callable[[OpenAI, str], T]) -> T:
    """Run fn(client, model) with this provider's first usable key; on a quota or key error move to the next.
    Errors that aren't about the key (503, timeouts) are raised at once. If every key fails, the last error is
    raised unchanged, so callers still see its status_code (handwriting.py marks the model out of quota)."""
    ks = keys(name)
    if not ks:
        raise RuntimeError(f"{PROVIDERS[name]['key_env']} is not set")
    slot = model or os.getenv(f"{name.upper()}_MODEL", PROVIDERS[name]["model"])
    last: Exception | None = None
    for i, key in enumerate(ks):
        with _key_lock:
            if _key_cool.get((name, slot, i), 0) > time.time():
                last = _key_err.get((name, slot, i), last)
                continue
        try:
            client, default_model = _client(name, key)
            return fn(client, model or default_model)
        except Exception as e:
            rest = _key_problem(e)
            if rest < 0:
                raise
            if rest > 0:
                with _key_lock:
                    _key_cool[(name, slot, i)] = time.time() + rest
                    _key_err[(name, slot, i)] = e
            last = e
            if len(ks) > 1:
                print(f"[llm] {name} {slot}: key {i + 1} of {len(ks)} refused ({getattr(e, 'status_code', '?')}),"
                      f" trying the next key", flush=True)
    assert last is not None
    raise last


def _mock_reply(messages: list[dict]) -> str:
    last = next((m["content"] for m in reversed(messages) if m["role"] == "user"), "")
    return f"(mock LLM) You said: {str(last)[:300]}"


def chat(messages: list[dict], tools: list[dict] | None = None, **kwargs):
    """Non-streaming call. Returns the OpenAI-style message object (or a dict for mock)."""
    errors = []
    for name in _order():
        if name == "mock":
            return {"role": "assistant", "content": _mock_reply(messages), "tool_calls": None}
        if name == "claude":
            if tools:  # agent.py's loop speaks the OpenAI tool format; use another provider for it
                errors.append("claude: agent tools not wired for Claude, skipped")
                continue
            try:
                from . import claude_provider
                return {"role": "assistant", "content": claude_provider.chat(messages), "tool_calls": None}
            except Exception as e:
                errors.append(f"claude: {e}")
                continue
        try:
            def call(client, model):
                args = {"model": model, "messages": messages, **kwargs}
                if tools:
                    args["tools"] = tools
                return client.chat.completions.create(**args).choices[0].message
            return with_keys(name, None, call)
        except Exception as e:  # try the next provider
            errors.append(f"{name}: {e}")
    raise RuntimeError("All LLM providers failed: " + " | ".join(errors))


def stream(messages: list[dict], **kwargs) -> Iterator[str]:
    """Yields text chunks."""
    errors = []
    for name in _order():
        if name == "mock":
            for word in _mock_reply(messages).split(" "):
                yield word + " "
            return
        if name == "claude":
            try:
                from . import claude_provider
                yield from claude_provider.stream(messages)
                return
            except Exception as e:
                errors.append(f"claude: {e}")
                continue
        try:
            resp = with_keys(name, None, lambda client, model: client.chat.completions.create(
                model=model, messages=messages, stream=True, **kwargs))
            for chunk in resp:
                if chunk.choices and chunk.choices[0].delta.content:
                    yield chunk.choices[0].delta.content
            return
        except Exception as e:
            errors.append(f"{name}: {e}")
    yield "[error] All LLM providers failed: " + " | ".join(errors)


def complete_json(prompt: str, system: str = "Reply with valid JSON only.") -> dict:
    """Ask for structured output and parse it. Great for classification/extraction features."""
    msg = chat([{"role": "system", "content": system}, {"role": "user", "content": prompt}])
    text = msg["content"] if isinstance(msg, dict) else msg.content
    text = text.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return {"raw": text}


def chat_one(provider: str, messages: list[dict], model: str | None = None,
             max_retries: int | None = None, timeout: float | None = None, **kwargs) -> str:
    """Call ONE specific provider/model (no fallback). Used when you want several
    different models to answer the same thing, e.g. the handwriting vote.
    max_retries/timeout override the SDK defaults (which silently retry with long waits)."""
    if provider == "claude":
        from . import claude_provider
        return claude_provider.chat(messages, model=model)
    opts = {k: v for k, v in {"max_retries": max_retries, "timeout": timeout}.items() if v is not None}

    def call(client, use_model):
        if opts:
            client = client.with_options(**opts)
        return client.chat.completions.create(model=use_model, messages=messages, **kwargs)

    resp = with_keys(provider, model, call)
    if not getattr(resp, "choices", None):  # some routers answer 200 with an error body and no choices
        raise RuntimeError(f"{provider}: empty response from provider ({str(getattr(resp, 'error', '') or resp)[:150]})")
    return resp.choices[0].message.content or ""


def active_provider() -> str:
    return _order()[0]
