from mathpipeprover.policies import load_mode_policy


def test_strict_policy_blocks_changes() -> None:
    p = load_mode_policy("strict")
    assert p.allow_scope_changes is False
    assert p.allow_new_assumptions is False
    assert p.max_scope_changes_per_branch == 0


def test_flexible_policy_allows_changes() -> None:
    p = load_mode_policy("flexible")
    assert p.allow_scope_changes is True
    assert p.allow_new_assumptions is True
    assert p.max_scope_changes_per_branch > 0
