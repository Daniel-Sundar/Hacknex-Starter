"""Claude provider (official Anthropic SDK).

Used by llm.py when LLM_PROVIDER (or a fallback) is "claude".
Needs ANTHROPIC_API_KEY from https://platform.claude.com (API credits are billed
separately from a Claude Pro subscription).

CLAUDE_MODEL defaults to claude-opus-5-5. Set CLAUDE_MODEL=claude-haiku-5-5 to make
credits last much longer for high-volume features.
"""
import os
from typing import Iterator

import anthropic

DEFAULT_MODEL = "claude-opus-5-5"
# If Claude's safety classifiers decline a request, the API re-runs it on a
# suitable fallback model inside the same call instead of returning a refusal.
_FALLBACK = {"betas": ["server-side-fallback-2026-07-01"], "fallbacks": "default"}

_client = None


def _get_client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        if not os.getenv("ANTHROPIC_API_KEY"):
            raise RuntimeError("ANTHROPIC_API_KEY is not set")
        _client = anthropic.Anthropic()
    return _client


def _model() -> str:
    return os.getenv("CLAUDE_MODEL", DEFAULT_MODEL)


def _fallback_args(model: str) -> dict:
    # Server-side "default" fallbacks are for the Opus / Fable / Sonnet tiers, not Haiku.
    return {} if "haiku" in model else _FALLBACK


def _convert_content(content):
    """OpenAI-style content (str or parts with image_url data URLs) -> Claude content blocks."""
    if isinstance(content, str):
        return content
    blocks = []
    for part in content:
        if part.get("type") == "text":
            blocks.append({"type": "text", "text": part["text"]})
        elif part.get("type") == "image_url":
            url = part["image_url"]["url"]
            header, data = url.split(",", 1)  # data:image/png;base64,....
            media_type = header.removeprefix("data:").split(";")[0]
            blocks.append({"type": "image", "source": {"type": "base64", "media_type": media_type, "data": data}})
    # Claude reads images best when they come before the question.
    return sorted(blocks, key=lambda b: b["type"] != "image")


def _split(messages: list[dict]) -> tuple[str | None, list[dict]]:
    system = "\n\n".join(m["content"] for m in messages if m["role"] == "system") or None
    convo = [{"role": m["role"], "content": _convert_content(m["content"])}
             for m in messages if m["role"] in ("user", "assistant")]
    return system, convo


def _request(messages: list[dict], max_tokens: int, model: str | None = None) -> dict:
    system, convo = _split(messages)
    model = model or _model()
    args = {"model": model, "max_tokens": max_tokens, "messages": convo, **_fallback_args(model)}
    if system:
        args["system"] = system
    return args


def chat(messages: list[dict], model: str | None = None) -> str:
    response = _get_client().beta.messages.create(**_request(messages, 16000, model))
    if response.stop_reason == "refusal":
        return "Sorry, I can't help with that request."
    return "".join(b.text for b in response.content if b.type == "text")


def stream(messages: list[dict]) -> Iterator[str]:
    with _get_client().beta.messages.stream(**_request(messages, 64000)) as s:
        yield from s.text_stream
