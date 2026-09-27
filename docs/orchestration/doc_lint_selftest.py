#!/usr/bin/env python3
"""Run fail-closed negative-fixture checks for :mod:`doc_lint`.

This is a bootstrap-safe smoke suite rather than a replacement for repository
CI.  Each case copies the repository into a temporary directory, introduces one
controlled defect, and verifies that the documentation gate rejects it.  The
fixtures never modify the working tree and require only Python's standard
library.

Usage:
    python docs/orchestration/doc_lint_selftest.py
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Callable


ROOT = Path(__file__).resolve().parents[2]
LINTER = ROOT / "docs" / "orchestration" / "doc_lint.py"
IGNORED_COPY_NAMES = shutil.ignore_patterns(".git", "__pycache__", "*.pyc")


def copy_fixture() -> tuple[tempfile.TemporaryDirectory[str], Path]:
    """Return a disposable full repository fixture and its root path."""
    temporary = tempfile.TemporaryDirectory(prefix="cineforge-doc-lint-")
    fixture = Path(temporary.name) / "repo"
    shutil.copytree(ROOT, fixture, ignore=IGNORED_COPY_NAMES)
    return temporary, fixture


def write_text(path: Path, text: str) -> None:
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(text)


def read_json(path: Path) -> object:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value: object) -> None:
    write_text(path, json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def run_lint(fixture: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(fixture / "docs" / "orchestration" / "doc_lint.py"), "--root", str(fixture)],
        cwd=fixture,
        text=True,
        capture_output=True,
        check=False,
        timeout=30,
    )


def run_case(name: str, mutate: Callable[[Path], None], expected: str) -> None:
    temporary, fixture = copy_fixture()
    try:
        mutate(fixture)
        result = run_lint(fixture)
        output = result.stdout + result.stderr
        if result.returncode == 0:
            raise AssertionError(f"{name}: linter unexpectedly passed\n{output}")
        if expected not in output:
            raise AssertionError(f"{name}: expected {expected!r}\n{output}")
        print(f"PASS {name}")
    finally:
        temporary.cleanup()


def mutate_duplicate_section_id(fixture: Path) -> None:
    path = fixture / "docs" / "orchestration" / "CONTEXT_LOADING_PROTOCOL.md"
    write_text(path, path.read_text(encoding="utf-8") + "\n# CTX-REGISTRY-PACKS. Duplicate active identity\n")


def mutate_broken_reference(fixture: Path) -> None:
    path = fixture / "docs" / "orchestration" / "CONTEXT_LOADING_PROTOCOL.md"
    write_text(path, path.read_text(encoding="utf-8") + "\nSee docs/orchestration/CONTEXT_LOADING_PROTOCOL.md#NO-SUCH-ID.\n")


def mutate_stable_id_collision(fixture: Path) -> None:
    path = fixture / "docs" / "orchestration" / "findings" / "COVERAGE.json"
    coverage = read_json(path)
    assert isinstance(coverage, dict)
    findings = coverage["findings"]
    findings[1]["stable_id"] = findings[0]["stable_id"]
    write_json(path, coverage)


def mutate_state_count(fixture: Path) -> None:
    path = fixture / "docs" / "orchestration" / "findings" / "COVERAGE.json"
    coverage = read_json(path)
    assert isinstance(coverage, dict)
    coverage["coverage_state_counts"]["UNCOVERED"] += 1
    write_json(path, coverage)


def mutate_registry_revision(fixture: Path) -> None:
    path = fixture / "docs" / "orchestration" / "findings" / "COVERAGE.json"
    coverage = read_json(path)
    assert isinstance(coverage, dict)
    coverage["source_registry_revision"] = 999
    write_json(path, coverage)


def mutate_title_hash(fixture: Path) -> None:
    path = fixture / "docs" / "orchestration" / "findings" / "REGISTRY.json"
    registry = read_json(path)
    assert isinstance(registry, dict)
    registry["findings"][0]["title_hash"] = "sha256:" + ("0" * 64)
    write_json(path, registry)


def mutate_source_line(fixture: Path) -> None:
    path = fixture / "docs" / "orchestration" / "findings" / "COVERAGE.json"
    coverage = read_json(path)
    assert isinstance(coverage, dict)
    coverage["findings"][0]["source_evidence"]["line"] = 999999
    write_json(path, coverage)


def mutate_source_section(fixture: Path) -> None:
    path = fixture / "docs" / "orchestration" / "findings" / "COVERAGE.json"
    coverage = read_json(path)
    assert isinstance(coverage, dict)
    coverage["findings"][0]["source_evidence"]["section"] = "Not an evidence heading"
    write_json(path, coverage)


def mutate_source_path_traversal(fixture: Path) -> None:
    path = fixture / "docs" / "orchestration" / "findings" / "COVERAGE.json"
    coverage = read_json(path)
    assert isinstance(coverage, dict)
    coverage["findings"][0]["source_evidence"]["path"] = "../outside-evidence.md"
    write_json(path, coverage)


def mutate_control_registry_duplicate(fixture: Path) -> None:
    path = fixture / "docs" / "design" / "CONTROL_REGISTRY.yaml"
    text = path.read_text(encoding="utf-8")
    text += """

  - id: CF-CTRL-COMMAND-GATE
    title: duplicate control identity
    owner: docs/architecture/FINAL_ARCHITECTURE.md
    applicability: V1_FOUNDATION
    maturity: SPECIFIED
    current_slice_required: false
"""
    write_text(path, text)


def mutate_control_registry_evidence(fixture: Path) -> None:
    path = fixture / "docs" / "design" / "CONTROL_REGISTRY.yaml"
    text = path.read_text(encoding="utf-8")
    write_text(path, text.replace("maturity: SPECIFIED", "maturity: IMPLEMENTED", 1))


def mutate_p0_owner(fixture: Path) -> None:
    path = fixture / "docs" / "orchestration" / "findings" / "COVERAGE.json"
    coverage = read_json(path)
    assert isinstance(coverage, dict)
    first_p0 = next(item for item in coverage["findings"] if "P0" in item["severity"])
    first_p0["control_owner_path"] = None
    first_p0["control_owner_section_id"] = None
    write_json(path, coverage)


def mutate_chaos_case_reference(fixture: Path) -> None:
    path = fixture / "docs" / "orchestration" / "findings" / "COVERAGE.json"
    coverage = read_json(path)
    assert isinstance(coverage, dict)
    coverage["findings"][0]["required_chaos_tests"].append("CT-99")
    write_json(path, coverage)


def mutate_chaos_field(fixture: Path) -> None:
    path = fixture / "docs" / "orchestration" / "CHAOS_TEST_PLAN.md"
    text = path.read_text(encoding="utf-8")
    marker = "- **Forbidden behavior:**"
    if marker not in text:
        raise AssertionError("fixture marker is missing")
    write_text(path, text.replace(marker, "- **Forbidden behavior removed:**", 1))


def main() -> int:
    baseline_temporary, baseline_fixture = copy_fixture()
    try:
        baseline = run_lint(baseline_fixture)
        output = baseline.stdout + baseline.stderr
        if baseline.returncode != 0:
            raise AssertionError(f"baseline: linter failed\n{output}")
        if "DOC_LINT=PASS" not in output:
            raise AssertionError(f"baseline: missing pass marker\n{output}")
        print("PASS baseline")
    finally:
        baseline_temporary.cleanup()

    cases = [
        ("duplicate active section ID", mutate_duplicate_section_id, "duplicate active section ID"),
        ("broken path reference", mutate_broken_reference, "broken reference"),
        ("stable ID collision", mutate_stable_id_collision, "coverage stable_id collision"),
        ("coverage state-count drift", mutate_state_count, "coverage_state_counts does not match findings"),
        ("registry revision drift", mutate_registry_revision, "source_registry_revision does not match registry revision"),
        ("title hash drift", mutate_title_hash, "title_hash does not match normalized title"),
        ("source line drift", mutate_source_line, "source line is outside"),
        ("source section drift", mutate_source_section, "source section is not found"),
        ("source path traversal", mutate_source_path_traversal, "source path escapes repository"),
        ("control registry duplicate", mutate_control_registry_duplicate, "duplicate control IDs"),
        ("control registry evidence", mutate_control_registry_evidence, "claims IMPLEMENTED without evidence"),
        ("missing P0 owner", mutate_p0_owner, "has no exact control owner"),
        ("unknown chaos case", mutate_chaos_case_reference, "malformed chaos reference"),
        ("incomplete chaos case", mutate_chaos_field, "missing fields"),
    ]
    for name, mutate, expected in cases:
        run_case(name, mutate, expected)
    print(f"DOC_LINT_SELFTEST=PASS cases={len(cases) + 1}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
