from mathpipeprover.ledger import count_scope_assumptions, extract_tagged_lines


def test_tag_extraction_counts_scope_and_assumptions() -> None:
    text = """
[USER] Given claim.
[SCOPE] Restrict x to positive values.
[ASSUMPTION+] Function is continuous.
"""
    rows = extract_tagged_lines(text)
    counts = count_scope_assumptions(rows)

    assert counts.scope_changes == 1
    assert counts.assumptions_added == 1
    assert counts.assumptions_removed == 0
