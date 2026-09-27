#!/usr/bin/env python3
"""Merge-blocking documentation and finding-contract lint for CineForge.

The repository currently keeps the authoritative contracts in Markdown, while
the red-team corpus is intentionally evidence-only.  This checker is small on
purpose so it can run in bootstrap environments without third-party packages.
It validates the identities that make Context Manifest references safe; it
does not try to prove that a prose control is implemented.

Usage:
    python docs/orchestration/doc_lint.py
    python docs/orchestration/doc_lint.py --root .
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import defaultdict
from pathlib import Path
from typing import Iterable


RAW_EVIDENCE = Path("docs/orchestration/EXTREME_FAILURE_STRESS_TEST_2026-09-26.md")
LEGACY_COVERAGE = Path("docs/orchestration/EXTREME_FINDING_COVERAGE_MATRIX.md")
COVERAGE_PATH = Path("docs/orchestration/findings/COVERAGE.json")
REGISTRY_PATH = Path("docs/orchestration/findings/REGISTRY.json")
MIGRATION_PATH = Path("docs/orchestration/findings/AUTHORITATIVE_SECTION_ID_MIGRATION.md")
CHAOS_PATH = Path("docs/orchestration/CHAOS_TEST_PLAN.md")

HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*$")
ANCHOR_RE = re.compile(r"\{#([A-Za-z0-9_.:-]+)\}\s*$")
# Numeric IDs, short legacy owner IDs (A1, ZHS), and explicit semantic IDs
# (CTRL-MERGE-OUTCOME) are stable identities.  Ordinary prose headings such as
# "AppShell" are deliberately not interpreted as IDs.
ID_RE = re.compile(
    r"^(?P<id>(?:\d+(?:\.\d+)*|[A-Z]{1,4}\d{1,4}|[A-Z]{1,4}\.|[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+))"
    r"(?:[.)]|\s|$)"
)
REF_RE = re.compile(
    r"(?P<path>(?:docs/|AGENTS\.md)[^\s)`\"'<>]+\.md)#(?P<id>[A-Za-z0-9_.:-]+)"
)
STABLE_ID_RE = re.compile(r"^CFRT-[0-9A-F]{12}$")
CHAOS_ID_RE = re.compile(r"\bCT-(?:0[1-9]|[1-3][0-9]|40)\b")
CHAOS_HEADING_RE = re.compile(r"^###\s+(CT-\d{2})\s+—\s+.+?\s*$")
CHAOS_FIELD_RE = re.compile(r"^[-*]\s+\*\*(.+?):\*\*")
REQUIRED_CHAOS_FIELDS = {
    "Preconditions",
    "Fault injection",
    "Expected invariant",
    "Expected state",
    "User-visible behavior",
    "Forbidden behavior",
    "Evidence required",
    "Cleanup/recovery",
}


def authoritative_markdown(root: Path) -> list[Path]:
    paths = [root / "AGENTS.md"]
    for directory in (root / "docs" / "orchestration", root / "docs" / "design", root / "docs" / "architecture"):
        if directory.exists():
            paths.extend(sorted(directory.rglob("*.md")))
    result: list[Path] = []
    for path in paths:
        relative = path.relative_to(root)
        if relative == RAW_EVIDENCE or relative == LEGACY_COVERAGE:
            # The stress corpus and deprecated matrix are retained as evidence,
            # but their repeated historical wave/Xnn labels are not contracts.
            continue
        if path.exists() and path not in result:
            result.append(path)
    return result


def section_id(title: str) -> str | None:
    anchor = ANCHOR_RE.search(title)
    if anchor:
        return anchor.group(1)
    title_without_anchor = ANCHOR_RE.sub("", title).strip()
    match = ID_RE.match(title_without_anchor)
    if not match:
        return None
    return match.group("id").rstrip(".")


def github_slug(title: str) -> str:
    """Return the common GitHub heading slug as a compatibility alias."""
    title = ANCHOR_RE.sub("", title).strip().lower()
    title = re.sub(r"[^a-z0-9 _-]", "", title)
    return re.sub(r"[- _]+", "-", title).strip("-")


def collect_sections(root: Path) -> tuple[dict[str, dict[str, list[int]]], list[str]]:
    sections: dict[str, dict[str, list[int]]] = {}
    errors: list[str] = []
    for path in authoritative_markdown(root):
        relative = path.relative_to(root).as_posix()
        ids: dict[str, list[int]] = defaultdict(list)
        for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            match = HEADING_RE.match(line)
            if not match:
                continue
            identifier = section_id(match.group(2))
            # Numeric prose headings below H1 (for example "## 5 slots") are
            # local narrative labels, not cross-document contract identities.
            # Explicit anchors and alphanumeric/semantic owner IDs remain
            # addressable at any depth.
            if len(match.group(1)) > 1 and identifier and identifier[0].isdigit() and not ANCHOR_RE.search(match.group(2)):
                identifier = None
            if identifier:
                ids[identifier].append(line_number)
            # Existing documents contain a few GitHub-native slug references.
            # Keep the stable token above as the canonical identity, while
            # accepting a slug only when it resolves to one heading.
            slug = github_slug(match.group(2))
            if slug and slug != identifier:
                ids[f"@slug:{slug}"].append(line_number)
        sections[relative] = dict(ids)
        for identifier, locations in ids.items():
            if identifier.startswith("@slug:"):
                continue
            if len(locations) > 1:
                errors.append(
                    f"duplicate active section ID {relative}#{identifier} at lines {','.join(map(str, locations))}"
                )
    return sections, errors


def lint_references(root: Path, sections: dict[str, dict[str, list[int]]]) -> list[str]:
    errors: list[str] = []
    scan_files = authoritative_markdown(root)
    # Migration maps are intentionally included: a stale replacement reference
    # must fail the same way as a stale Context Manifest reference.
    for path in scan_files:
        relative = path.relative_to(root).as_posix()
        text = path.read_text(encoding="utf-8")
        for match in REF_RE.finditer(text):
            referenced_path = match.group("path").rstrip(".,;:)")
            identifier = match.group("id").rstrip(".,;:)")
            target = sections.get(referenced_path)
            if target is None:
                # References to a file outside the authoritative scan are still
                # checked for existence when they name a repository path.
                if not (root / referenced_path).exists():
                    errors.append(f"broken reference in {relative}: {referenced_path}#{identifier} (missing path)")
                continue
            locations = target.get(identifier, [])
            if not locations:
                locations = target.get(f"@slug:{identifier.lower()}", [])
            if len(locations) != 1:
                errors.append(
                    f"broken reference in {relative}: {referenced_path}#{identifier} "
                    f"(expected one active section, found {len(locations)})"
                )
    return errors


def lint_chaos_plan(root: Path) -> tuple[list[str], set[str]]:
    """Validate the executable chaos-spec shape and return its case IDs."""
    path = root / CHAOS_PATH
    if not path.exists():
        return [f"missing chaos specification: {CHAOS_PATH.as_posix()}"], set()
    lines = path.read_text(encoding="utf-8").splitlines()
    headings: list[tuple[str, int]] = []
    for line_number, line in enumerate(lines, 1):
        match = CHAOS_HEADING_RE.match(line)
        if match:
            headings.append((match.group(1), line_number))
    errors: list[str] = []
    ids = [identifier for identifier, _ in headings]
    expected = {f"CT-{index:02d}" for index in range(1, 41)}
    duplicates = sorted(identifier for identifier in set(ids) if ids.count(identifier) > 1)
    if duplicates:
        errors.append(f"duplicate chaos case IDs: {','.join(duplicates)}")
    missing = sorted(expected - set(ids))
    if missing:
        errors.append(f"missing chaos case IDs: {','.join(missing)}")
    unexpected = sorted(set(ids) - expected)
    if unexpected:
        errors.append(f"unexpected chaos case IDs: {','.join(unexpected)}")
    for index, (identifier, line_number) in enumerate(headings):
        end = headings[index + 1][1] - 1 if index + 1 < len(headings) else len(lines)
        fields = [
            match.group(1).strip()
            for line in lines[line_number:end]
            if (match := CHAOS_FIELD_RE.match(line))
        ]
        missing_fields = sorted(REQUIRED_CHAOS_FIELDS - set(fields))
        duplicate_fields = sorted(field for field in set(fields) if fields.count(field) > 1)
        if missing_fields:
            errors.append(f"{identifier} at line {line_number} missing fields: {','.join(missing_fields)}")
        if duplicate_fields:
            errors.append(f"{identifier} at line {line_number} repeats fields: {','.join(duplicate_fields)}")
    return errors, set(ids)


def lint_registry_and_coverage(
    root: Path,
    sections: dict[str, dict[str, list[int]]],
    chaos_ids: set[str],
) -> list[str]:
    errors: list[str] = []
    registry_file = root / REGISTRY_PATH
    if not registry_file.exists():
        return [f"missing canonical finding registry: {REGISTRY_PATH.as_posix()}"]
    try:
        registry = json.loads(registry_file.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        return [f"invalid JSON in {REGISTRY_PATH.as_posix()}: {exc}"]
    findings = registry.get("findings")
    if not isinstance(findings, list):
        errors.append("registry findings must be an array")
        return errors
    registry_ids = [item.get("stable_id") for item in findings if isinstance(item, dict)]
    if len(registry_ids) != len(set(registry_ids)):
        errors.append("canonical finding stable_id collision")
    for stable_id in registry_ids:
        if not isinstance(stable_id, str) or not STABLE_ID_RE.fullmatch(stable_id):
            errors.append(f"invalid canonical stable_id: {stable_id!r}")
    if registry.get("finding_count") != len(findings):
        errors.append("registry finding_count does not match findings array")
    if any("P0" in str(item.get("severity", "")) and item.get("domain") == "GEN" for item in findings):
        errors.append("P0 finding remains in generic GEN domain")
    if any(
        "P0" in str(item.get("severity", ""))
        and item.get("coverage_state") == "NEEDS_COVERAGE_REVIEW"
        for item in findings
    ):
        errors.append("P0 finding remains NEEDS_COVERAGE_REVIEW in the registry")

    coverage_file = root / COVERAGE_PATH
    if not coverage_file.exists():
        return errors + [f"missing canonical coverage ledger: {COVERAGE_PATH.as_posix()}"]
    try:
        coverage = json.loads(coverage_file.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        return errors + [f"invalid JSON in {COVERAGE_PATH.as_posix()}: {exc}"]
    # `findings` is the canonical array.  `records` is accepted for one-way
    # compatibility with early bootstrap ledgers, but a duplicate array is not
    # required and must never become a second source of truth.
    records = coverage.get("findings", coverage.get("records"))
    if not isinstance(records, list):
        return errors + ["coverage records must be an array"]
    if coverage.get("finding_count") != len(records):
        errors.append("coverage finding_count does not match findings array")
    coverage_ids = [item.get("stable_id") for item in records if isinstance(item, dict)]
    if len(coverage_ids) != len(set(coverage_ids)):
        errors.append("coverage stable_id collision")
    if set(coverage_ids) != set(registry_ids):
        errors.append("coverage stable_id set differs from canonical registry")
    p0_records = [item for item in records if isinstance(item, dict) and "P0" in str(item.get("severity", ""))]
    p1_records = [item for item in records if isinstance(item, dict) and "P1" in str(item.get("severity", ""))]
    if coverage.get("p0_total") != len(p0_records):
        errors.append("coverage p0_total does not match findings")
    if coverage.get("p1_total") != len(p1_records):
        errors.append("coverage p1_total does not match findings")
    allowed_states = {"UNCOVERED", "PARTIAL", "DESIGN_COVERED", "EMPIRICAL_TEST_REQUIRED", "RESIDUAL", "VERIFIED"}

    def state_counts(items: list[dict]) -> dict[str, int]:
        return {state: sum(item.get("coverage_state") == state for item in items) for state in sorted(allowed_states)}

    expected_overall = state_counts([item for item in records if isinstance(item, dict)])
    if coverage.get("coverage_state_counts") != expected_overall:
        errors.append("coverage_state_counts does not match findings")
    for key, items in (("p0_coverage_state_counts", p0_records), ("p1_coverage_state_counts", p1_records)):
        if key in coverage and coverage.get(key) != state_counts(items):
            errors.append(f"{key} does not match findings")
    registry_by_id = {item.get("stable_id"): item for item in findings if isinstance(item, dict)}
    coverage_by_id = {item.get("stable_id"): item for item in records if isinstance(item, dict)}
    for stable_id in set(registry_by_id) & set(coverage_by_id):
        if registry_by_id[stable_id].get("coverage_state") != coverage_by_id[stable_id].get("coverage_state"):
            errors.append(f"registry/coverage state mismatch for {stable_id}")
    for record in records:
        if not isinstance(record, dict):
            errors.append("coverage record is not an object")
            continue
        missing = [key for key in (
            "stable_id", "title", "severity", "domain", "source_evidence",
            "control_owner_path", "control_owner_section_id", "supporting_owner_paths",
            "coverage_state", "residual_state", "required_negative_tests",
            "required_chaos_tests", "empirical_status", "notes",
        ) if key not in record]
        if missing:
            errors.append(f"coverage {record.get('stable_id')!r} missing fields: {','.join(missing)}")
        if record.get("coverage_state") not in allowed_states:
            errors.append(f"coverage {record.get('stable_id')!r} has invalid state {record.get('coverage_state')!r}")
        source = record.get("source_evidence")
        if (
            not isinstance(source, dict)
            or not source.get("path")
            or not source.get("section")
            or not source.get("line")
        ):
            errors.append(f"coverage {record.get('stable_id')!r} has incomplete source_evidence")
        elif not (root / str(source["path"])).exists():
            errors.append(f"coverage {record.get('stable_id')!r} source path is missing: {source['path']}")
        chaos_tests = record.get("required_chaos_tests", [])
        if not isinstance(chaos_tests, list):
            errors.append(f"coverage {record.get('stable_id')!r} required_chaos_tests must be an array")
            chaos_tests = []
        for chaos_case in chaos_tests:
            referenced = CHAOS_ID_RE.findall(str(chaos_case))
            if not referenced:
                errors.append(f"coverage {record.get('stable_id')!r} has malformed chaos reference: {chaos_case!r}")
            for identifier in referenced:
                if identifier not in chaos_ids:
                    errors.append(f"coverage {record.get('stable_id')!r} references missing chaos case {identifier}")
        if "P0" in str(record.get("severity", "")):
            if record.get("coverage_state") == "UNCOVERED":
                errors.append(f"P0 {record.get('stable_id')} is unexplained UNCOVERED")
            if not record.get("control_owner_path") or not record.get("control_owner_section_id"):
                errors.append(f"P0 {record.get('stable_id')} has no exact control owner")
            if not record.get("required_negative_tests") or not record.get("required_chaos_tests"):
                errors.append(f"P0 {record.get('stable_id')} has no negative/chaos test requirement")
            if record.get("coverage_state") == "RESIDUAL" and record.get("residual_state") in {None, "UNASSESSED", "OPEN_UNVERIFIED"}:
                errors.append(f"P0 {record.get('stable_id')} residual state is not explicit")
        if record.get("coverage_state") == "VERIFIED" and str(record.get("empirical_status")) in {"NOT_RUN", "SPEC_ONLY"}:
            errors.append(f"coverage {record.get('stable_id')} is VERIFIED without empirical status")
        owner_path = record.get("control_owner_path")
        owner_id = record.get("control_owner_section_id")
        if owner_path and owner_id:
            owner_sections = sections.get(str(owner_path))
            if owner_sections is None:
                errors.append(f"coverage {record.get('stable_id')} owner path is missing: {owner_path}")
            else:
                locations = owner_sections.get(str(owner_id), [])
                if not locations:
                    locations = owner_sections.get(f"@slug:{str(owner_id).lower()}", [])
                if len(locations) != 1:
                    errors.append(
                        f"coverage {record.get('stable_id')} owner {owner_path}#{owner_id} "
                        f"does not resolve uniquely (found {len(locations)})"
                    )
        # Legacy aliases may be displayed in source_evidence, but they cannot
        # be used as the ledger key or as a control identity.
        if isinstance(record.get("stable_id"), str) and record["stable_id"].startswith("X"):
            errors.append(f"legacy Xnn used as coverage identity: {record['stable_id']}")
    return errors


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path("."), help="repository root (default: current directory)")
    args = parser.parse_args(list(argv) if argv is not None else None)
    root = args.root.resolve()
    sections, errors = collect_sections(root)
    errors.extend(lint_references(root, sections))
    chaos_errors, chaos_ids = lint_chaos_plan(root)
    errors.extend(chaos_errors)
    errors.extend(lint_registry_and_coverage(root, sections, chaos_ids))
    if errors:
        print("DOC_LINT=FAIL")
        for error in errors:
            print(f"ERROR: {error}")
        return 1
    print(f"DOC_LINT=PASS authoritative_files={len(sections)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
