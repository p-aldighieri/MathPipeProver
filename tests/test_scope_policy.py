from mathpipeprover.policies import build_scope_policy, load_mode_policy


def test_strict_generative_forbids_assumptions() -> None:
    policy = load_mode_policy("strict")
    text = build_scope_policy(policy, "prover")
    assert "Do NOT introduce any new assumptions" in text
    assert "[ASSUMPTION+]" in text


def test_strict_evaluative_rejects_any_assumption() -> None:
    policy = load_mode_policy("strict")
    text = build_scope_policy(policy, "reviewer")
    assert "Reject" in text
    assert "Zero tolerance" in text


def test_semi_strict_generative_emphasises_fidelity() -> None:
    policy = load_mode_policy("semi_strict")
    text = build_scope_policy(policy, "prover")
    assert "faithful" in text or "original formulation" in text
    assert "[ASSUMPTION+]" in text
    assert "restraint" in text


def test_semi_strict_evaluative_checks_scope_drift() -> None:
    policy = load_mode_policy("semi_strict")
    text = build_scope_policy(policy, "reviewer")
    assert "character of the original" in text or "scope drift" in text
    assert "untagged" in text.lower()


def test_semi_strict_backstop_limits() -> None:
    policy = load_mode_policy("semi_strict")
    assert policy.max_new_assumptions_per_branch == 5
    assert policy.max_scope_changes_per_branch == 5
    assert policy.require_scope_gate is True


def test_flexible_evaluative_focuses_on_correctness() -> None:
    policy = load_mode_policy("flexible")
    text = build_scope_policy(policy, "reviewer")
    assert "correctness" in text.lower()
    assert "do not penalize" in text.lower()


def test_flexible_generative_allows_latitude() -> None:
    policy = load_mode_policy("flexible")
    text = build_scope_policy(policy, "prover")
    assert "latitude" in text
    assert "interesting" in text


def test_flexible_backstop_effectively_unlimited() -> None:
    policy = load_mode_policy("flexible")
    assert policy.max_new_assumptions_per_branch == 999
    assert policy.max_scope_changes_per_branch == 999
    assert policy.require_scope_gate is False


def test_unknown_backstop_like_role_returns_empty() -> None:
    policy = load_mode_policy("strict")
    text = build_scope_policy(policy, "backstop_like_role")
    assert text == ""


def test_scope_keeper_returns_empty() -> None:
    policy = load_mode_policy("semi_strict")
    text = build_scope_policy(policy, "scope_keeper")
    assert text == ""


def test_consolidator_category() -> None:
    policy = load_mode_policy("strict")
    text = build_scope_policy(policy, "consolidator")
    assert "final report" in text.lower()


def test_planning_category_searcher() -> None:
    policy = load_mode_policy("semi_strict")
    text = build_scope_policy(policy, "searcher")
    assert "Strategies" in text or "strategies" in text


def test_all_modes_all_generative_roles_nonempty() -> None:
    for mode in ("strict", "semi_strict", "flexible"):
        policy = load_mode_policy(mode)
        for role in ("prover", "breakdown", "formalizer"):
            text = build_scope_policy(policy, role)
            assert text, f"Expected non-empty scope policy for {mode}/{role}"


def test_unknown_role_returns_empty() -> None:
    policy = load_mode_policy("flexible")
    text = build_scope_policy(policy, "nonexistent_role")
    assert text == ""
