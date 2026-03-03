from mathpipeprover.router import choose_router_decision, parse_next_from_json, parse_next_tag


def test_parse_next_tag() -> None:
    assert parse_next_tag("[NEXT:PROVER]") == "PROVER"


def test_parse_next_from_json() -> None:
    assert parse_next_from_json('{"next":"prover"}') == "PROVER"


def test_parse_next_from_json_fenced() -> None:
    text = """```json
{"next_tag":"REVIEWER"}
```"""
    assert parse_next_from_json(text) == "REVIEWER"


def test_router_fallback_when_invalid_tag() -> None:
    decision = choose_router_decision(raw_output="[NEXT:UNKNOWN]", allowed_tags=["PROVER"], fallback_tag="PROVER")
    assert decision.selected == "PROVER"
    assert decision.used_fallback is True


def test_router_accepts_json() -> None:
    decision = choose_router_decision(raw_output='{"next":"PROVER"}', allowed_tags=["PROVER"], fallback_tag="REVIEWER")
    assert decision.selected == "PROVER"
    assert decision.used_fallback is False
