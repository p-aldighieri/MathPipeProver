from mathpipeprover.router import choose_router_decision, parse_next_from_json, parse_next_tag, parse_review_verdict


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


def test_verdict_structured_format() -> None:
    v = parse_review_verdict("## Review\nVERDICT: PATCH_SMALL\nMinor gap in step 3.")
    assert v.level == "PATCH_SMALL"
    assert v.needs_small_fix is True
    assert v.is_pass is False


def test_verdict_standalone_pass() -> None:
    v = parse_review_verdict("## Review\nAll steps verified.\nPASS\n")
    assert v.level == "PASS"
    assert v.is_pass is True


def test_verdict_legacy_fail_maps_to_redo() -> None:
    v = parse_review_verdict("FAIL\nFundamental gap.")
    assert v.level == "REDO"
    assert v.needs_redo is True


def test_verdict_json_format() -> None:
    v = parse_review_verdict('{"verdict": "PATCH_BIG", "reason": "lemma 2 invalid"}')
    assert v.level == "PATCH_BIG"
    assert v.needs_big_fix is True


def test_verdict_defaults_to_redo() -> None:
    v = parse_review_verdict("Some rambling text with no verdict.")
    assert v.level == "REDO"
