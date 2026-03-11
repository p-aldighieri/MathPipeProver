from mathpipeprover.prompting import build_role_context, bundle_markdown


def test_bundle_markdown_never_truncates_file_content() -> None:
    content = "A" * 7000 + "\nTAIL_MARKER\n"
    bundled = bundle_markdown([("long.md", content)], max_chars_per_file=10)

    assert "[TRUNCATED]" not in bundled
    assert "TAIL_MARKER" in bundled
    assert bundled.count("A") >= 7000


def test_build_role_context_loads_secondary_files_in_full() -> None:
    long_secondary = "\n".join([f"line {index}" for index in range(1, 101)]) + "\nSECONDARY_TAIL\n"
    context = build_role_context(
        role="prover",
        files=[
            ("branches/main/context/formalizer.md", "formalizer body\n"),
            ("branches/main/context/breakdown.md", "breakdown body\n"),
            ("branches/main/context/reviewer_01.md", long_secondary),
        ],
        max_chars_per_file=10,
    )

    assert "[TRUNCATED]" not in context
    assert "more lines omitted" not in context
    assert "SECONDARY_TAIL" in context
