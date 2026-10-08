"""One client for every LLM provider.

Gemini, Groq, OpenRouter and Ollama all expose OpenAI-compatible endpoints,
so we use the `openai` SDK and only swap base_url / key / model.
Set LLM_PROVIDER in .env. If a call fails, we fall through LLM_FALLBACKS.
Provider "mock" needs no key: handy for UI work and offline demos.
Provider "claude" uses the official Anthropic SDK (see claude_provider.py).
"""
import json
import os
from typing import Iterator

from openai import OpenAI

PROVIDERS = {
    "gemini": {
        "base_url": "https://generativelanguage.googleapis.com/v1beta/openai/",
        "key_env": "GEMINI_API_KEY",
        "model": "gemini-2.5-flash",
    },
    "groq": {
        "base_url": "https://api.groq.com/openai/v1",
        "key_env": "GROQ_API_KEY",
        "model": "llama-3.3-70b-versatile",
    },
    "openrouter": {
        "base_url": "https://openrouter.ai/api/v1",
        "key_env": "OPENROUTER_API_KEY",
        "model": "meta-llama/llama-3.3-70b-instruct:free",
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


def _client(name: str) -> tuple[OpenAI, str]:
    cfg = PROVIDERS[name]
    key = os.getenv(cfg["key_env"]) if cfg["key_env"] else "ollama"
    if not key:
        raise RuntimeError(f"{cfg['key_env']} is not set")
    model = os.getenv(f"{name.upper()}_MODEL", cfg["model"])
    return OpenAI(base_url=cfg["base_url"], api_key=key), model


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
            client, model = _client(name)
            args = {"model": model, "messages": messages, **kwargs}
            if tools:
                args["tools"] = tools
            return client.chat.completions.create(**args).choices[0].message
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
            client, model = _client(name)
            resp = client.chat.completions.create(model=model, messages=messages, stream=True, **kwargs)
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


def active_provider() -> str:
    return _order()[0]
