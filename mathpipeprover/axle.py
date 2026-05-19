"""Thin synchronous client for the AXLE Lean verification API.

AXLE is a Lean 4 / Mathlib compile-and-transform service. This module wraps the
REST endpoints used by MathPipeProver's Lean post-processing module. It is
deliberately synchronous and dependency-free (urllib-based) to match the rest
of the codebase (see ``providers.py``).

Quick start::

    client = AxleClient()  # reads AXLE_API_KEY from environment
    result = client.check("import Mathlib\\n#eval 2+2\\n")
    assert result["okay"] is True

Skill / CLI entrypoint: ``mpp axle <subcommand>`` (see ``cli.py``).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable
from urllib import error, parse, request
import hashlib
import json
import os
import time


DEFAULT_BASE_URL = "https://axle.axiommath.ai/api/v1"
# The environments listing lives at a DIFFERENT path prefix (/v1, not /api/v1).
# See the AXLE deployment as of May 2026. Override via AXLE_ENVIRONMENTS_URL if needed.
DEFAULT_ENVIRONMENTS_URL = "https://axle.axiommath.ai/v1/environments"
DEFAULT_ENVIRONMENT = "lean-4.29.0"
DEFAULT_TIMEOUT_SECONDS = 120
SOCKET_TIMEOUT_BUFFER_SECONDS = 30
SERVER_TIMEOUT_HARD_CAP = 900


class AxleError(RuntimeError):
    """Raised when an AXLE call fails (transport, auth, or server error)."""


@dataclass
class AxleCallLog:
    """One entry appended to the axle_log.jsonl audit trail."""

    timestamp: str
    tool: str
    environment: str
    duration_ms: int
    okay: bool | None
    error_count: int
    warning_count: int
    request_bytes: int
    response_bytes: int
    request_hash: str
    note: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "timestamp": self.timestamp,
            "tool": self.tool,
            "environment": self.environment,
            "duration_ms": self.duration_ms,
            "okay": self.okay,
            "error_count": self.error_count,
            "warning_count": self.warning_count,
            "request_bytes": self.request_bytes,
            "response_bytes": self.response_bytes,
            "request_hash": self.request_hash,
            "note": self.note,
        }


class AxleClient:
    """Synchronous client over the AXLE REST API.

    Resolution order for configuration:

    - ``api_key``                  argument  >  ``AXLE_API_KEY``        env
    - ``base_url``                 argument  >  ``AXLE_BASE_URL``       env  >  ``DEFAULT_BASE_URL``
    - ``default_environment``      argument  >  ``AXLE_DEFAULT_ENV``    env  >  ``DEFAULT_ENVIRONMENT``
    - ``default_timeout_seconds``  argument  (no env override)               >  ``DEFAULT_TIMEOUT_SECONDS``
    - ``log_path``                 argument  >  ``AXLE_LOG_PATH``       env  >  unlogged

    All tool methods are synchronous and return the parsed JSON body of the
    response. Network / auth / HTTP failures raise ``AxleError``. A successful
    HTTP call with ``okay: false`` (e.g. a Lean compile failure) is *not* an
    error: the dict is returned with ``okay = False`` and the caller decides.
    """

    def __init__(
        self,
        *,
        api_key: str | None = None,
        base_url: str | None = None,
        default_environment: str | None = None,
        default_timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS,
        log_path: str | Path | None = None,
    ) -> None:
        resolved_key = api_key if api_key is not None else os.environ.get("AXLE_API_KEY", "")
        if not resolved_key:
            raise AxleError(
                "AXLE_API_KEY is not set. Get a key at https://axle.axiommath.ai/app/console "
                "and put AXLE_API_KEY=... in your .env."
            )
        self._api_key = resolved_key
        self._base_url = (base_url or os.environ.get("AXLE_BASE_URL") or DEFAULT_BASE_URL).rstrip("/")
        self._environments_url = (
            os.environ.get("AXLE_ENVIRONMENTS_URL") or self._derive_environments_url(self._base_url)
        )
        self._default_environment = (
            default_environment
            or os.environ.get("AXLE_DEFAULT_ENV")
            or DEFAULT_ENVIRONMENT
        )
        self._default_timeout_seconds = int(default_timeout_seconds)
        log_path_resolved = log_path if log_path is not None else os.environ.get("AXLE_LOG_PATH")
        self._log_path: Path | None = Path(log_path_resolved) if log_path_resolved else None

    @property
    def default_environment(self) -> str:
        return self._default_environment

    @property
    def base_url(self) -> str:
        return self._base_url

    @property
    def environments_url(self) -> str:
        return self._environments_url

    @staticmethod
    def _derive_environments_url(base_url: str) -> str:
        """The GET /v1/environments listing is hosted at a sibling path of /api/v1.

        Given a tool base such as ``https://axle.axiommath.ai/api/v1``, return the
        full URL ``https://axle.axiommath.ai/v1/environments``. If the supplied
        base does not match the documented shape, fall back to the documented
        default so the smoke path keeps working.
        """
        parsed = parse.urlparse(base_url)
        if parsed.scheme and parsed.netloc:
            return f"{parsed.scheme}://{parsed.netloc}/v1/environments"
        return DEFAULT_ENVIRONMENTS_URL

    @property
    def log_path(self) -> Path | None:
        return self._log_path

    # -- Public tool methods ------------------------------------------------

    def list_environments(self) -> list[dict[str, Any]]:
        """``GET /v1/environments`` — returns the list of available Lean toolchains."""
        result = self._get_url(self._environments_url, tool_name="environments")
        if isinstance(result, list):
            return result
        if isinstance(result, dict) and "environments" in result:
            envs = result["environments"]
            if isinstance(envs, list):
                return envs
        return []

    def check(
        self,
        content: str,
        *,
        environment: str | None = None,
        mathlib_options: bool = False,
        ignore_imports: bool = False,
        timeout_seconds: int | None = None,
    ) -> dict[str, Any]:
        """Compile a Lean source string. Returns ``{okay, lean_messages, ...}``."""
        return self._post(
            "check",
            tool_name="check",
            payload={
                "content": content,
                "environment": self._env(environment),
                "mathlib_options": mathlib_options,
                "ignore_imports": ignore_imports,
                "timeout_seconds": self._server_timeout(timeout_seconds),
            },
        )

    def verify_proof(
        self,
        content: str,
        formal_statement: str,
        *,
        environment: str | None = None,
        permitted_sorries: list[str] | None = None,
        use_def_eq: bool = False,
        ignore_imports: bool = False,
        mathlib_options: bool = False,
        timeout_seconds: int | None = None,
    ) -> dict[str, Any]:
        """Compile ``content`` and verify it satisfies ``formal_statement``."""
        return self._post(
            "verify_proof",
            tool_name="verify_proof",
            payload={
                "content": content,
                "formal_statement": formal_statement,
                "environment": self._env(environment),
                "permitted_sorries": list(permitted_sorries) if permitted_sorries else [],
                "use_def_eq": use_def_eq,
                "ignore_imports": ignore_imports,
                "mathlib_options": mathlib_options,
                "timeout_seconds": self._server_timeout(timeout_seconds),
            },
        )

    def sorry2lemma(
        self,
        content: str,
        *,
        environment: str | None = None,
        names: list[str] | None = None,
        indices: list[int] | None = None,
        extract_sorries: bool = True,
        extract_errors: bool = True,
        include_whole_context: bool = True,
        reconstruct_callsite: bool = False,
        verbosity: int = 0,
        timeout_seconds: int | None = None,
    ) -> dict[str, Any]:
        """Lift each ``sorry`` to a top-level lemma."""
        payload: dict[str, Any] = {
            "content": content,
            "environment": self._env(environment),
            "extract_sorries": extract_sorries,
            "extract_errors": extract_errors,
            "include_whole_context": include_whole_context,
            "reconstruct_callsite": reconstruct_callsite,
            "verbosity": verbosity,
            "timeout_seconds": self._server_timeout(timeout_seconds),
        }
        if names:
            payload["names"] = list(names)
        if indices:
            payload["indices"] = list(indices)
        return self._post("sorry2lemma", tool_name="sorry2lemma", payload=payload)

    def repair_proofs(
        self,
        content: str,
        *,
        environment: str | None = None,
        names: list[str] | None = None,
        indices: list[int] | None = None,
        repairs: list[str] | None = None,
        terminal_tactics: list[str] | None = None,
        ignore_imports: bool = False,
        timeout_seconds: int | None = None,
    ) -> dict[str, Any]:
        """Apply bounded repair strategies (NOT a proof search). Default tactic: ``grind``."""
        payload: dict[str, Any] = {
            "content": content,
            "environment": self._env(environment),
            "terminal_tactics": list(terminal_tactics) if terminal_tactics else ["grind"],
            "ignore_imports": ignore_imports,
            "timeout_seconds": self._server_timeout(timeout_seconds),
        }
        if repairs:
            payload["repairs"] = list(repairs)
        if names:
            payload["names"] = list(names)
        if indices:
            payload["indices"] = list(indices)
        return self._post("repair_proofs", tool_name="repair_proofs", payload=payload)

    def merge(
        self,
        documents: Iterable[str],
        *,
        environment: str | None = None,
        use_def_eq: bool = False,
        include_alts_as_comments: bool = False,
        ignore_imports: bool = False,
        timeout_seconds: int | None = None,
    ) -> dict[str, Any]:
        """Combine multiple Lean source strings into one deduped, topo-ordered file."""
        docs = list(documents)
        if not docs:
            raise AxleError("merge requires at least one document")
        return self._post(
            "merge",
            tool_name="merge",
            payload={
                "documents": docs,
                "environment": self._env(environment),
                "use_def_eq": use_def_eq,
                "include_alts_as_comments": include_alts_as_comments,
                "ignore_imports": ignore_imports,
                "timeout_seconds": self._server_timeout(timeout_seconds),
            },
        )

    def disprove(
        self,
        content: str,
        *,
        environment: str | None = None,
        names: list[str] | None = None,
        indices: list[int] | None = None,
        terminal_tactics: list[str] | None = None,
        timeout_seconds: int | None = None,
    ) -> dict[str, Any]:
        """Plausible-backed counterexample search."""
        payload: dict[str, Any] = {
            "content": content,
            "environment": self._env(environment),
            "terminal_tactics": list(terminal_tactics) if terminal_tactics else ["plausible"],
            "timeout_seconds": self._server_timeout(timeout_seconds),
        }
        if names:
            payload["names"] = list(names)
        if indices:
            payload["indices"] = list(indices)
        return self._post("disprove", tool_name="disprove", payload=payload)

    def extract_decls(
        self,
        content: str,
        *,
        environment: str | None = None,
        timeout_seconds: int | None = None,
    ) -> dict[str, Any]:
        """Split a multi-declaration file into standalone compilable units."""
        return self._post(
            "extract_decls",
            tool_name="extract_decls",
            payload={
                "content": content,
                "environment": self._env(environment),
                "timeout_seconds": self._server_timeout(timeout_seconds),
            },
        )

    # -- Internals ----------------------------------------------------------

    def _env(self, environment: str | None) -> str:
        return environment or self._default_environment

    def _server_timeout(self, timeout_seconds: int | None) -> int:
        chosen = int(timeout_seconds) if timeout_seconds else self._default_timeout_seconds
        if chosen < 1:
            chosen = 1
        if chosen > SERVER_TIMEOUT_HARD_CAP:
            chosen = SERVER_TIMEOUT_HARD_CAP
        return chosen

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

    def _socket_timeout(self, server_timeout: int) -> int:
        return server_timeout + SOCKET_TIMEOUT_BUFFER_SECONDS

    def _post(self, path: str, *, tool_name: str, payload: dict[str, Any]) -> dict[str, Any]:
        url = f"{self._base_url}/{path}"
        data = json.dumps(payload).encode("utf-8")
        req = request.Request(url=url, data=data, headers=self._headers(), method="POST")
        server_timeout = int(payload.get("timeout_seconds") or self._default_timeout_seconds)
        socket_timeout = self._socket_timeout(server_timeout)

        started = time.monotonic()
        response_body = b""
        result: dict[str, Any] | None = None
        note = ""
        try:
            try:
                with request.urlopen(req, timeout=socket_timeout) as resp:
                    response_body = resp.read()
                    raw = response_body.decode("utf-8")
                    result = json.loads(raw)
            except error.HTTPError as exc:
                response_body = exc.read()
                body = response_body.decode("utf-8", errors="replace")
                note = f"HTTP {exc.code}"
                raise AxleError(f"AXLE {tool_name} HTTP {exc.code} {exc.reason}: {body[:500]}") from exc
            except error.URLError as exc:
                note = "network"
                raise AxleError(f"AXLE {tool_name} network error: {exc}") from exc
            except json.JSONDecodeError as exc:
                note = "bad-json"
                raise AxleError(f"AXLE {tool_name} returned non-JSON body: {response_body[:500]!r}") from exc
        finally:
            duration_ms = int((time.monotonic() - started) * 1000)
            self._log(
                tool_name=tool_name,
                environment=str(payload.get("environment", "")),
                duration_ms=duration_ms,
                result=result,
                request_bytes=len(data),
                response_bytes=len(response_body),
                request_hash=_hash(data),
                note=note,
            )

        assert result is not None
        return result

    def _get_url(self, url: str, *, tool_name: str) -> Any:
        # GET endpoints don't accept a body; omit Content-Type so the AXLE
        # gateway doesn't try to parse a missing payload as JSON.
        headers = {k: v for k, v in self._headers().items() if k.lower() != "content-type"}
        req = request.Request(url=url, headers=headers, method="GET")
        started = time.monotonic()
        response_body = b""
        result: Any = None
        note = ""
        try:
            try:
                with request.urlopen(req, timeout=self._socket_timeout(self._default_timeout_seconds)) as resp:
                    response_body = resp.read()
                    raw = response_body.decode("utf-8")
                    result = json.loads(raw)
            except error.HTTPError as exc:
                response_body = exc.read()
                body = response_body.decode("utf-8", errors="replace")
                note = f"HTTP {exc.code}"
                raise AxleError(f"AXLE {tool_name} HTTP {exc.code} {exc.reason}: {body[:500]}") from exc
            except error.URLError as exc:
                note = "network"
                raise AxleError(f"AXLE {tool_name} network error: {exc}") from exc
            except json.JSONDecodeError as exc:
                note = "bad-json"
                raise AxleError(f"AXLE {tool_name} returned non-JSON body: {response_body[:500]!r}") from exc
        finally:
            duration_ms = int((time.monotonic() - started) * 1000)
            self._log(
                tool_name=tool_name,
                environment="",
                duration_ms=duration_ms,
                result=result if isinstance(result, dict) else None,
                request_bytes=0,
                response_bytes=len(response_body),
                request_hash="",
                note=note,
            )
        return result

    def _log(
        self,
        *,
        tool_name: str,
        environment: str,
        duration_ms: int,
        result: dict[str, Any] | None,
        request_bytes: int,
        response_bytes: int,
        request_hash: str,
        note: str,
    ) -> None:
        if self._log_path is None:
            return
        entry = AxleCallLog(
            timestamp=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            tool=tool_name,
            environment=environment,
            duration_ms=duration_ms,
            okay=_extract_okay(result),
            error_count=_count_messages(result, "errors"),
            warning_count=_count_messages(result, "warnings"),
            request_bytes=request_bytes,
            response_bytes=response_bytes,
            request_hash=request_hash,
            note=note,
        )
        try:
            self._log_path.parent.mkdir(parents=True, exist_ok=True)
            with self._log_path.open("a", encoding="utf-8") as fh:
                fh.write(json.dumps(entry.to_dict()) + "\n")
        except OSError:
            # Logging is best-effort; never break a call on log failure.
            pass


def _hash(data: bytes) -> str:
    return "sha256:" + hashlib.sha256(data).hexdigest()[:16]


def _extract_okay(result: dict[str, Any] | None) -> bool | None:
    if not isinstance(result, dict):
        return None
    val = result.get("okay")
    if isinstance(val, bool):
        return val
    return None


def _count_messages(result: dict[str, Any] | None, kind: str) -> int:
    if not isinstance(result, dict):
        return 0
    messages = result.get("lean_messages")
    if not isinstance(messages, dict):
        return 0
    items = messages.get(kind)
    if isinstance(items, list):
        return len(items)
    return 0
