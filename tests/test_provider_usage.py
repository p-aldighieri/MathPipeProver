from mathpipeprover.providers import LLMRequest, ProviderHub


def test_stub_provider_returns_usage() -> None:
    hub = ProviderHub(timeout_seconds=5)
    resp = hub.complete(
        LLMRequest(
            provider="stub",
            model="stub-model",
            system_prompt="system",
            user_prompt="user",
            temperature=0.0,
            max_output_tokens=16,
        )
    )

    assert resp.usage.total_tokens == 0
    assert resp.usage.estimated is True
