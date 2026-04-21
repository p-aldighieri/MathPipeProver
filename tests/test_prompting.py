from pathlib import Path

from mathpipeprover.prompting import build_role_context, bundle_markdown, load_prompt_template


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


def test_build_role_context_loads_search_literature_as_primary() -> None:
    context = build_role_context(
        role="searcher",
        files=[
            ("claim.md", "claim body\n"),
            ("branches/main/context/formalizer.md", "formalizer body\n"),
            ("branches/main/context/literature.md", "literature body\n"),
        ],
    )

    assert "claim body" in context
    assert "formalizer body" in context
    assert "literature body" in context
    assert "ADDITIONAL LOADED FILES" not in context


def test_load_prompt_template_supports_numbered_files_and_includes(tmp_path: Path) -> None:
    prompts_root = tmp_path / "prompts_soft"
    prompts_root.mkdir()
    fragments_root = tmp_path / "prompt_fragments"
    fragments_root.mkdir()

    (fragments_root / "shared.md").write_text("Shared fragment body.\n", encoding="utf-8")
    (prompts_root / "01_formalizer.md").write_text(
        "Prompt header.\n\n{{include:../prompt_fragments/shared.md}}\n\nPrompt footer.\n",
        encoding="utf-8",
    )

    template = load_prompt_template(prompts_root, "formalizer", "fallback")

    assert "Prompt header." in template
    assert "Shared fragment body." in template
    assert "Prompt footer." in template
