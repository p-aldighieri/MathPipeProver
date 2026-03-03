from __future__ import annotations

from dataclasses import dataclass
import json
import os
from typing import Any
from urllib import error, request


class ProviderError(RuntimeError):
    """Raised when an LLM provider call fails."""


@dataclass
class LLMRequest:
    provider: str
    model: str
    system_prompt: str
    user_prompt: str
    temperature: float
    max_output_tokens: int


@dataclass
class TokenUsage:
    input_tokens: int
    output_tokens: int
    total_tokens: int
    estimated: bool


@dataclass
class LLMResponse:
    text: str
    raw: dict[str, Any]
    usage: TokenUsage


class ProviderHub:
    def __init__(self, timeout_seconds: int = 60) -> None:
        self.timeout_seconds = timeout_seconds

    def complete(self, req: LLMRequest) -> LLMResponse:
        provider = req.provider.strip().lower()
        if provider in {"stub", "mock"}:
            return LLMResponse(
                text="",
                raw={"provider": provider, "mode": "stub"},
                usage=TokenUsage(input_tokens=0, output_tokens=0, total_tokens=0, estimated=True),
            )
        if provider == "openai":
            return self._openai(req)
        if provider == "anthropic":
            return self._anthropic(req)
        if provider == "gemini":
            return self._gemini(req)
        if provider == "external_agent":
            raise ProviderError("Provider 'external_agent' is a placeholder and cannot be called directly.")
        raise ProviderError(f"Unknown provider '{req.provider}'")

    def smoke_test(self, provider: str, model: str) -> tuple[bool, str]:
        probe = LLMRequest(
            provider=provider,
            model=model,
            system_prompt="You are a connectivity smoke-test endpoint.",
            user_prompt="Reply with exactly: PONG",
            temperature=0.0,
            max_output_tokens=64,
        )
        try:
            resp = self.complete(probe)
        except Exception as exc:  # noqa: BLE001
            # Anthropic model aliases vary. If the configured model is missing, try autodiscovery.
            if provider.strip().lower() == "anthropic":
                auto_model = self.discover_anthropic_model()
                if auto_model:
                    probe.model = auto_model
                    try:
                        resp = self.complete(probe)
                    except Exception as retry_exc:  # noqa: BLE001
                        return False, f"{type(retry_exc).__name__}: {retry_exc}"
                    text = (resp.text or "").strip()
                    if "PONG" not in text.upper():
                        return False, f"Unexpected output after fallback model {auto_model}: {text[:120]}"
                    return True, f"{text[:100]} (fallback_model={auto_model})"
            return False, f"{type(exc).__name__}: {exc}"

        text = (resp.text or "").strip()
        if "PONG" not in text.upper():
            return False, f"Unexpected output: {text[:120]}"
        return True, text[:120]

    def _post_json(self, url: str, payload: dict[str, Any], headers: dict[str, str]) -> dict[str, Any]:
        data = json.dumps(payload).encode("utf-8")
        req = request.Request(url=url, data=data, headers=headers, method="POST")
        try:
            with request.urlopen(req, timeout=self.timeout_seconds) as resp:
                raw = resp.read().decode("utf-8")
                return json.loads(raw)
        except error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            raise ProviderError(f"HTTP {exc.code} {exc.reason}: {body[:500]}") from exc
        except error.URLError as exc:
            raise ProviderError(f"Network error: {exc}") from exc

    def _get_json(self, url: str, headers: dict[str, str]) -> dict[str, Any]:
        req = request.Request(url=url, headers=headers, method="GET")
        try:
            with request.urlopen(req, timeout=self.timeout_seconds) as resp:
                raw = resp.read().decode("utf-8")
                return json.loads(raw)
        except error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            raise ProviderError(f"HTTP {exc.code} {exc.reason}: {body[:500]}") from exc
        except error.URLError as exc:
            raise ProviderError(f"Network error: {exc}") from exc

    def _openai(self, req: LLMRequest) -> LLMResponse:
        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            raise ProviderError("OPENAI_API_KEY is not set")

        payload = {
            "model": req.model,
            "input": [
                {
                    "role": "system",
                    "content": [{"type": "input_text", "text": req.system_prompt}],
                },
                {
                    "role": "user",
                    "content": [{"type": "input_text", "text": req.user_prompt}],
                },
            ],
            "max_output_tokens": req.max_output_tokens,
            # Reduce chance of spending budget on reasoning without returning text.
            "reasoning": {"effort": "minimal"},
            "text": {"verbosity": "low"},
        }
        if req.temperature is not None:
            payload["temperature"] = req.temperature
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        def call_openai_once(active_payload: dict[str, Any]) -> dict[str, Any]:
            try:
                return self._post_json("https://api.openai.com/v1/responses", active_payload, headers)
            except ProviderError as exc:
                # GPT-5 family models may reject temperature; retry without it.
                if "temperature" in str(exc).lower() and "unsupported parameter" in str(exc).lower():
                    active_payload.pop("temperature", None)
                    return self._post_json("https://api.openai.com/v1/responses", active_payload, headers)
                raise

        active_payload = dict(payload)
        raw: dict[str, Any] = {}
        text = ""
        for _ in range(4):
            raw = call_openai_once(active_payload)
            text = _extract_openai_text(raw)
            if text:
                break

            if _openai_needs_more_tokens(raw):
                current = int(active_payload.get("max_output_tokens", req.max_output_tokens) or req.max_output_tokens)
                active_payload["max_output_tokens"] = min(max(current * 2, 128), 2048)
                active_payload.pop("temperature", None)
                continue

            if _openai_has_zero_output(raw):
                current = int(active_payload.get("max_output_tokens", req.max_output_tokens) or req.max_output_tokens)
                active_payload["max_output_tokens"] = min(max(current * 2, 128), 2048)
                active_payload.pop("temperature", None)
                continue

            break

        if not text:
            raise ProviderError("OpenAI response did not include text output")
        usage = _extract_openai_usage(raw, req=req, text=text)
        return LLMResponse(text=text, raw=raw, usage=usage)

    def _anthropic(self, req: LLMRequest) -> LLMResponse:
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            raise ProviderError("ANTHROPIC_API_KEY is not set")

        payload = {
            "model": req.model,
            "max_tokens": req.max_output_tokens,
            "temperature": req.temperature,
            "system": req.system_prompt,
            "messages": [{"role": "user", "content": req.user_prompt}],
        }
        headers = {
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }
        raw = self._post_json("https://api.anthropic.com/v1/messages", payload, headers)
        text = _extract_anthropic_text(raw)
        if not text:
            raise ProviderError("Anthropic response did not include text output")
        usage = _extract_anthropic_usage(raw, req=req, text=text)
        return LLMResponse(text=text, raw=raw, usage=usage)

    def _gemini(self, req: LLMRequest) -> LLMResponse:
        api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
        if not api_key:
            raise ProviderError("GEMINI_API_KEY or GOOGLE_API_KEY is not set")

        payload = {
            "contents": [
                {
                    "parts": [
                        {
                            "text": f"{req.system_prompt}\n\n{req.user_prompt}",
                        }
                    ]
                }
            ],
            "generationConfig": {
                "temperature": req.temperature,
                "maxOutputTokens": req.max_output_tokens,
            },
        }
        headers = {
            "content-type": "application/json",
        }
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{req.model}:generateContent?key={api_key}"
        raw = self._post_json(url, payload, headers)
        text = _extract_gemini_text(raw)
        if not text:
            raise ProviderError("Gemini response did not include text output")
        usage = _extract_gemini_usage(raw, req=req, text=text)
        return LLMResponse(text=text, raw=raw, usage=usage)

    def discover_anthropic_model(self) -> str | None:
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            return None

        headers = {
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }
        try:
            raw = self._get_json("https://api.anthropic.com/v1/models", headers=headers)
        except Exception:  # noqa: BLE001
            return None

        data = raw.get("data", [])
        model_ids = [item.get("id", "") for item in data if isinstance(item, dict)]
        ranked = [
            mid for mid in model_ids if isinstance(mid, str) and ("haiku" in mid or "sonnet" in mid or "claude" in mid)
        ]
        if ranked:
            return ranked[0]
        return model_ids[0] if model_ids else None


def _extract_openai_text(raw: dict[str, Any]) -> str:
    if isinstance(raw.get("output_text"), str) and raw["output_text"].strip():
        return raw["output_text"].strip()

    output = raw.get("output", [])
    chunks: list[str] = []
    if isinstance(output, list):
        for item in output:
            for content in item.get("content", []):
                if isinstance(content, dict):
                    if isinstance(content.get("text"), str):
                        chunks.append(content["text"])
                    elif isinstance(content.get("output_text"), str):
                        chunks.append(content["output_text"])
    return "\n".join(part.strip() for part in chunks if part.strip()).strip()


def _openai_needs_more_tokens(raw: dict[str, Any]) -> bool:
    if not isinstance(raw, dict):
        return False
    if str(raw.get("status", "")).lower() != "incomplete":
        return False
    details = raw.get("incomplete_details", {})
    if not isinstance(details, dict):
        return False
    return str(details.get("reason", "")).lower() == "max_output_tokens"


def _openai_has_zero_output(raw: dict[str, Any]) -> bool:
    usage = raw.get("usage", {})
    if not isinstance(usage, dict):
        return False
    output = int(usage.get("output_tokens", 0) or 0)
    return output == 0


def _extract_anthropic_text(raw: dict[str, Any]) -> str:
    chunks: list[str] = []
    for content in raw.get("content", []):
        if isinstance(content, dict) and isinstance(content.get("text"), str):
            chunks.append(content["text"])
    return "\n".join(part.strip() for part in chunks if part.strip()).strip()


def _extract_gemini_text(raw: dict[str, Any]) -> str:
    chunks: list[str] = []
    for candidate in raw.get("candidates", []):
        content = candidate.get("content", {})
        for part in content.get("parts", []):
            text = part.get("text")
            if isinstance(text, str):
                chunks.append(text)
    return "\n".join(part.strip() for part in chunks if part.strip()).strip()


def _estimate_token_count(text: str) -> int:
    if not text:
        return 0
    return max(1, int(len(text) / 4))


def _extract_openai_usage(raw: dict[str, Any], req: LLMRequest, text: str) -> TokenUsage:
    usage = raw.get("usage", {})
    if isinstance(usage, dict):
        inp = int(usage.get("input_tokens", 0) or 0)
        out = int(usage.get("output_tokens", 0) or 0)
        total = int(usage.get("total_tokens", inp + out) or (inp + out))
        if total > 0:
            return TokenUsage(input_tokens=inp, output_tokens=out, total_tokens=total, estimated=False)

    inp_est = _estimate_token_count(req.system_prompt + "\n" + req.user_prompt)
    out_est = _estimate_token_count(text)
    return TokenUsage(input_tokens=inp_est, output_tokens=out_est, total_tokens=inp_est + out_est, estimated=True)


def _extract_anthropic_usage(raw: dict[str, Any], req: LLMRequest, text: str) -> TokenUsage:
    usage = raw.get("usage", {})
    if isinstance(usage, dict):
        inp = int(usage.get("input_tokens", 0) or 0)
        out = int(usage.get("output_tokens", 0) or 0)
        total = inp + out
        if total > 0:
            return TokenUsage(input_tokens=inp, output_tokens=out, total_tokens=total, estimated=False)

    inp_est = _estimate_token_count(req.system_prompt + "\n" + req.user_prompt)
    out_est = _estimate_token_count(text)
    return TokenUsage(input_tokens=inp_est, output_tokens=out_est, total_tokens=inp_est + out_est, estimated=True)


def _extract_gemini_usage(raw: dict[str, Any], req: LLMRequest, text: str) -> TokenUsage:
    usage = raw.get("usageMetadata", {})
    if isinstance(usage, dict):
        inp = int(usage.get("promptTokenCount", 0) or 0)
        out = int(usage.get("candidatesTokenCount", 0) or 0)
        total = int(usage.get("totalTokenCount", inp + out) or (inp + out))
        if total > 0:
            return TokenUsage(input_tokens=inp, output_tokens=out, total_tokens=total, estimated=False)

    inp_est = _estimate_token_count(req.system_prompt + "\n" + req.user_prompt)
    out_est = _estimate_token_count(text)
    return TokenUsage(input_tokens=inp_est, output_tokens=out_est, total_tokens=inp_est + out_est, estimated=True)
