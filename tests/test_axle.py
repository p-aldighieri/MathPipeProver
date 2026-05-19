"""Unit tests for mathpipeprover.axle.

Network is mocked: urllib.request.urlopen is replaced by a fake that records the
outgoing request and returns a pre-canned JSON body. Tests assert the client
builds correct URLs, headers, and payloads; raises AxleError on transport
failures; and writes one JSONL audit entry per call when a log path is set.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any
from urllib import error as urllib_error
import io
import json
import os

import pytest

from mathpipeprover import axle as axle_mod
from mathpipeprover.axle import AxleClient, AxleError


# -- Test plumbing ---------------------------------------------------------


class _FakeResponse:
    def __init__(self, body: bytes) -> None:
        self._body = body

    def __enter__(self) -> "_FakeResponse":
        return self

    def __exit__(self, *_: Any) -> None:
        pass

    def read(self) -> bytes:
        return self._body


class _Capture:
    """Captures the last urlopen call so tests can assert request shape."""

    def __init__(self) -> None:
        self.url: str | None = None
        self.method: str | None = None
        self.headers: dict[str, str] = {}
        self.body: bytes | None = None
        self.timeout: float | None = None


def _make_urlopen(capture: _Capture, response_body: dict[str, Any] | list[Any]):
    payload = json.dumps(response_body).encode("utf-8")

    def fake_urlopen(req, timeout=None):  # type: ignore[no-untyped-def]
        capture.url = req.full_url
        capture.method = req.get_method()
        capture.headers = {k: v for k, v in req.header_items()}
        capture.body = req.data
        capture.timeout = timeout
        return _FakeResponse(payload)

    return fake_urlopen


@pytest.fixture
def env_with_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AXLE_API_KEY", "test-key-xyz")
    monkeypatch.delenv("AXLE_BASE_URL", raising=False)
    monkeypatch.delenv("AXLE_DEFAULT_ENV", raising=False)
    monkeypatch.delenv("AXLE_LOG_PATH", raising=False)


# -- Construction ----------------------------------------------------------


def test_missing_api_key_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("AXLE_API_KEY", raising=False)
    with pytest.raises(AxleError) as excinfo:
        AxleClient()
    assert "AXLE_API_KEY" in str(excinfo.value)


def test_explicit_key_overrides_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AXLE_API_KEY", "env-key")
    client = AxleClient(api_key="explicit-key")
    # Header is constructed lazily; test by sending a request.
    cap = _Capture()
    monkeypatch.setattr(axle_mod.request, "urlopen", _make_urlopen(cap, {"okay": True}))
    client.check("import Mathlib\n")
    lowered = {k.lower(): v for k, v in cap.headers.items()}
    assert lowered.get("authorization") == "Bearer explicit-key"


def test_default_environment_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AXLE_API_KEY", "k")
    monkeypatch.setenv("AXLE_DEFAULT_ENV", "lean-4.21.0")
    client = AxleClient()
    assert client.default_environment == "lean-4.21.0"


def test_default_environment_fallback(env_with_key: None) -> None:
    client = AxleClient()
    assert client.default_environment == axle_mod.DEFAULT_ENVIRONMENT


def test_base_url_strips_trailing_slash(env_with_key: None) -> None:
    client = AxleClient(base_url="https://example.com/api/v1/")
    assert client.base_url == "https://example.com/api/v1"


# -- check -----------------------------------------------------------------


def test_check_posts_correct_payload(env_with_key: None, monkeypatch: pytest.MonkeyPatch) -> None:
    client = AxleClient()
    cap = _Capture()
    monkeypatch.setattr(
        axle_mod.request,
        "urlopen",
        _make_urlopen(cap, {"okay": True, "lean_messages": {"errors": [], "warnings": []}}),
    )

    result = client.check("import Mathlib\n#eval 2+2\n", environment="lean-4.29.0", timeout_seconds=60)

    assert cap.method == "POST"
    assert cap.url == f"{axle_mod.DEFAULT_BASE_URL}/check"
    # urllib.Request normalizes header keys via capitalize() — compare case-insensitively.
    lowered = {k.lower(): v for k, v in cap.headers.items()}
    assert lowered.get("authorization") == "Bearer test-key-xyz"
    assert lowered.get("content-type") == "application/json"
    assert cap.timeout == 60 + axle_mod.SOCKET_TIMEOUT_BUFFER_SECONDS

    sent = json.loads(cap.body.decode("utf-8"))
    assert sent["content"].startswith("import Mathlib")
    assert sent["environment"] == "lean-4.29.0"
    assert sent["timeout_seconds"] == 60
    assert sent["mathlib_options"] is False
    assert sent["ignore_imports"] is False

    assert result["okay"] is True


def test_check_clamps_server_timeout(env_with_key: None, monkeypatch: pytest.MonkeyPatch) -> None:
    client = AxleClient()
    cap = _Capture()
    monkeypatch.setattr(axle_mod.request, "urlopen", _make_urlopen(cap, {"okay": True}))
    client.check("x", timeout_seconds=999_999)
    sent = json.loads(cap.body.decode("utf-8"))
    assert sent["timeout_seconds"] == axle_mod.SERVER_TIMEOUT_HARD_CAP


# -- verify_proof ----------------------------------------------------------


def test_verify_proof_payload(env_with_key: None, monkeypatch: pytest.MonkeyPatch) -> None:
    client = AxleClient()
    cap = _Capture()
    monkeypatch.setattr(axle_mod.request, "urlopen", _make_urlopen(cap, {"okay": False}))
    client.verify_proof(
        content="theorem t : 1 = 1 := rfl\n",
        formal_statement="theorem t : 1 = 1 := sorry\n",
        permitted_sorries=["t"],
        use_def_eq=True,
    )
    sent = json.loads(cap.body.decode("utf-8"))
    assert sent["formal_statement"].startswith("theorem t")
    assert sent["permitted_sorries"] == ["t"]
    assert sent["use_def_eq"] is True
    assert cap.url.endswith("/verify_proof")


# -- sorry2lemma / repair / merge / disprove / extract --------------------


def test_sorry2lemma_includes_names(env_with_key: None, monkeypatch: pytest.MonkeyPatch) -> None:
    client = AxleClient()
    cap = _Capture()
    monkeypatch.setattr(axle_mod.request, "urlopen", _make_urlopen(cap, {"lemma_names": ["t.sorried"]}))
    client.sorry2lemma("theorem t : True := sorry\n", names=["t"])
    sent = json.loads(cap.body.decode("utf-8"))
    assert sent["names"] == ["t"]
    assert sent["extract_sorries"] is True
    assert cap.url.endswith("/sorry2lemma")


def test_repair_proofs_defaults_to_grind(env_with_key: None, monkeypatch: pytest.MonkeyPatch) -> None:
    client = AxleClient()
    cap = _Capture()
    monkeypatch.setattr(axle_mod.request, "urlopen", _make_urlopen(cap, {"repair_stats": {}}))
    client.repair_proofs("theorem t : True := sorry\n")
    sent = json.loads(cap.body.decode("utf-8"))
    assert sent["terminal_tactics"] == ["grind"]
    assert cap.url.endswith("/repair_proofs")


def test_merge_requires_documents(env_with_key: None) -> None:
    client = AxleClient()
    with pytest.raises(AxleError):
        client.merge([])


def test_merge_sends_documents(env_with_key: None, monkeypatch: pytest.MonkeyPatch) -> None:
    client = AxleClient()
    cap = _Capture()
    monkeypatch.setattr(axle_mod.request, "urlopen", _make_urlopen(cap, {"content": ""}))
    client.merge(["import Mathlib\n", "theorem a : True := trivial\n"])
    sent = json.loads(cap.body.decode("utf-8"))
    assert len(sent["documents"]) == 2
    assert cap.url.endswith("/merge")


def test_disprove_default_tactic(env_with_key: None, monkeypatch: pytest.MonkeyPatch) -> None:
    client = AxleClient()
    cap = _Capture()
    monkeypatch.setattr(axle_mod.request, "urlopen", _make_urlopen(cap, {"disproved_theorems": []}))
    client.disprove("theorem t : 1 = 2 := sorry\n")
    sent = json.loads(cap.body.decode("utf-8"))
    assert sent["terminal_tactics"] == ["plausible"]


def test_extract_decls_payload(env_with_key: None, monkeypatch: pytest.MonkeyPatch) -> None:
    client = AxleClient()
    cap = _Capture()
    monkeypatch.setattr(axle_mod.request, "urlopen", _make_urlopen(cap, {"declarations": {}}))
    client.extract_decls("theorem a : True := trivial\n")
    sent = json.loads(cap.body.decode("utf-8"))
    assert sent["content"].startswith("theorem a")
    assert cap.url.endswith("/extract_decls")


# -- list_environments (GET) ----------------------------------------------


def test_list_environments_get(env_with_key: None, monkeypatch: pytest.MonkeyPatch) -> None:
    client = AxleClient()
    cap = _Capture()
    monkeypatch.setattr(
        axle_mod.request,
        "urlopen",
        _make_urlopen(cap, [{"name": "lean-4.29.0", "lean_toolchain": "leanprover/lean4:v4.29.0"}]),
    )
    envs = client.list_environments()
    assert cap.method == "GET"
    # The environments listing is at /v1/environments (NOT /api/v1/environments).
    assert cap.url == "https://axle.axiommath.ai/v1/environments"
    # And the GET must not advertise a JSON body — the gateway 422s otherwise.
    lowered = {k.lower() for k in cap.headers}
    assert "content-type" not in lowered
    assert envs[0]["name"] == "lean-4.29.0"


def test_environments_url_derived_from_base(env_with_key: None) -> None:
    client = AxleClient(base_url="https://example.com/api/v1")
    assert client.environments_url == "https://example.com/v1/environments"


def test_environments_url_env_override(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AXLE_API_KEY", "k")
    monkeypatch.setenv("AXLE_ENVIRONMENTS_URL", "https://staging.example.com/v1/envs")
    client = AxleClient()
    assert client.environments_url == "https://staging.example.com/v1/envs"


def test_list_environments_dict_envelope(env_with_key: None, monkeypatch: pytest.MonkeyPatch) -> None:
    """Some deployments may wrap the list in {"environments": [...]} — tolerate either shape."""
    client = AxleClient()
    cap = _Capture()
    monkeypatch.setattr(
        axle_mod.request,
        "urlopen",
        _make_urlopen(cap, {"environments": [{"name": "lean-4.29.0"}]}),
    )
    envs = client.list_environments()
    assert envs[0]["name"] == "lean-4.29.0"


# -- Error handling --------------------------------------------------------


def test_http_error_raises_axle_error(env_with_key: None, monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(req, timeout=None):  # type: ignore[no-untyped-def]
        raise urllib_error.HTTPError(
            url=req.full_url,
            code=401,
            msg="Unauthorized",
            hdrs=None,  # type: ignore[arg-type]
            fp=io.BytesIO(b'{"detail": "invalid api key"}'),
        )

    monkeypatch.setattr(axle_mod.request, "urlopen", boom)
    client = AxleClient()
    with pytest.raises(AxleError) as excinfo:
        client.check("x")
    assert "401" in str(excinfo.value)


def test_network_error_raises_axle_error(env_with_key: None, monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(req, timeout=None):  # type: ignore[no-untyped-def]
        raise urllib_error.URLError("connection refused")

    monkeypatch.setattr(axle_mod.request, "urlopen", boom)
    client = AxleClient()
    with pytest.raises(AxleError):
        client.check("x")


def test_non_json_body_raises_axle_error(env_with_key: None, monkeypatch: pytest.MonkeyPatch) -> None:
    class _Bad(_FakeResponse):
        pass

    def bad(req, timeout=None):  # type: ignore[no-untyped-def]
        return _Bad(b"<html>500</html>")

    monkeypatch.setattr(axle_mod.request, "urlopen", bad)
    client = AxleClient()
    with pytest.raises(AxleError):
        client.check("x")


# -- Logging ---------------------------------------------------------------


def test_log_writes_jsonl_entry(env_with_key: None, monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    log_path = tmp_path / "axle_log.jsonl"
    client = AxleClient(log_path=log_path)
    cap = _Capture()
    monkeypatch.setattr(
        axle_mod.request,
        "urlopen",
        _make_urlopen(
            cap,
            {"okay": True, "lean_messages": {"errors": [], "warnings": [{"msg": "shadowed"}]}},
        ),
    )
    client.check("import Mathlib\n", environment="lean-4.29.0", timeout_seconds=30)

    lines = log_path.read_text(encoding="utf-8").splitlines()
    assert len(lines) == 1
    entry = json.loads(lines[0])
    assert entry["tool"] == "check"
    assert entry["environment"] == "lean-4.29.0"
    assert entry["okay"] is True
    assert entry["error_count"] == 0
    assert entry["warning_count"] == 1
    assert entry["request_hash"].startswith("sha256:")


def test_log_records_http_error(env_with_key: None, monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    log_path = tmp_path / "axle_log.jsonl"
    client = AxleClient(log_path=log_path)

    def boom(req, timeout=None):  # type: ignore[no-untyped-def]
        raise urllib_error.HTTPError(
            url=req.full_url,
            code=500,
            msg="Internal",
            hdrs=None,  # type: ignore[arg-type]
            fp=io.BytesIO(b'{"detail":"x"}'),
        )

    monkeypatch.setattr(axle_mod.request, "urlopen", boom)
    with pytest.raises(AxleError):
        client.check("x", timeout_seconds=10)
    entry = json.loads(log_path.read_text(encoding="utf-8").splitlines()[0])
    assert entry["note"] == "HTTP 500"
    assert entry["okay"] is None


def test_log_path_from_env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("AXLE_API_KEY", "k")
    monkeypatch.setenv("AXLE_LOG_PATH", str(tmp_path / "from_env.jsonl"))
    client = AxleClient()
    assert client.log_path is not None
    assert client.log_path.name == "from_env.jsonl"
