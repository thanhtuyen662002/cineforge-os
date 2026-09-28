#!/usr/bin/env python3
"""Validate the truthful architecture-level closure boundary.

This gate can close the design baseline only.  It deliberately fails if a
reference harness is used to claim runtime, production or release closure.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path
from typing import Iterable, Mapping


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
CLOSURE_PATH = Path("docs/orchestration/ARCHITECTURE_CLOSURE_MANIFEST.json")
MATRIX_PATH = Path("docs/orchestration/PROMOTION_LANE_MATRIX.json")
COVERAGE_PATH = Path("docs/orchestration/findings/COVERAGE.json")
EXPECTED_LANES = ["L3", "L4", "L5", "L6", "L7"]
SOURCE_DIGEST_ALGORITHM = "SHA-256(path\\0normalized-UTF8-content\\0 sorted)"
SOURCE_DIGEST_SCOPE = (
    "AGENTS.md, authoritative architecture/design/orchestration sources, "
    "all lane owner documents named by PROMOTION_LANE_MATRIX.json, and the "
    "closure/promotion gate implementations plus the canonical finding coverage "
    "and owner-mapping approval artifacts; ARCHITECTURE_CLOSURE_MANIFEST.json "
    "is intentionally excluded to avoid self-reference"
)
SOURCE_CORE_PATHS = (
    Path("AGENTS.md"),
    Path("docs/architecture/FINAL_ARCHITECTURE.md"),
    Path("docs/design/FINAL_DETAILED_DESIGN.md"),
    Path("docs/design/CONTROL_REGISTRY.yaml"),
    Path("docs/orchestration/CHAOS_TEST_PLAN.md"),
    Path("docs/orchestration/CONTEXT_LOADING_PROTOCOL.md"),
    Path("docs/orchestration/CONTROL_EVENT_CONTRACTS.json"),
    Path("docs/orchestration/PROMOTION_LANE_MATRIX.json"),
    Path("docs/orchestration/L4_RECOVERY_CONTRACT_MANIFEST.json"),
    Path("docs/orchestration/L5_SECURITY_CONTRACT_MANIFEST.json"),
    Path("docs/orchestration/L6_RUNTIME_CONTRACT_MANIFEST.json"),
    Path("docs/orchestration/L7_RELEASE_CONTRACT_MANIFEST.json"),
    Path("docs/orchestration/l4_recovery_gate.py"),
    Path("docs/orchestration/l5_security_gate.py"),
    Path("docs/orchestration/l6_runtime_gate.py"),
    Path("docs/orchestration/l7_release_gate.py"),
    Path("docs/orchestration/architecture_closure_gate.py"),
    Path("docs/orchestration/promotion_lane_gate.py"),
    Path("docs/orchestration/findings/COVERAGE.json"),
    Path("docs/orchestration/findings/README.md"),
    Path("docs/orchestration/findings/REGISTRY.json"),
    Path("docs/orchestration/findings/P1_PARTIAL_OWNER_MAPPING.json"),
    Path("docs/orchestration/findings/P1_OWNER_MAPPING_APPROVAL.json"),
)


def _load(root: Path, relative: Path) -> object:
    try:
        return json.loads((root / relative).read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"cannot load {relative.as_posix()}: {exc}") from exc


def _source_paths(matrix: Mapping[str, object]) -> tuple[Path, ...]:
    """Return the deterministic source set bound by the closure manifest.

    Owner references are section-qualified (``path#section``), but the file
    path is the source unit whose bytes must be bound.  The matrix is already
    a required core source, so deriving this set from it prevents an owner
    document from being silently edited without invalidating the closure
    manifest.
    """

    paths = set(SOURCE_CORE_PATHS)
    lanes = matrix.get("lanes")
    if isinstance(lanes, list):
        for lane in lanes:
            if not isinstance(lane, dict):
                continue
            owner_refs = lane.get("owner_refs")
            references = list(owner_refs) if isinstance(owner_refs, list) else []
            assertions = lane.get("control_assertions")
            if isinstance(assertions, list):
                references.extend(
                    assertion.get("owner_ref")
                    for assertion in assertions
                    if isinstance(assertion, dict)
                )
            for reference in references:
                if not isinstance(reference, str) or reference.count("#") != 1:
                    continue
                path, _ = reference.split("#", 1)
                if path:
                    paths.add(Path(path))
    return tuple(sorted(paths, key=lambda path: path.as_posix()))


def _normalized_source_bytes(root: Path, relative: Path) -> bytes:
    """Read one source using stable UTF-8 and newline normalization."""

    candidate = (root / relative).resolve()
    try:
        candidate.relative_to(root.resolve())
    except ValueError as exc:
        raise ValueError(f"source path escapes repository root: {relative.as_posix()}") from exc
    try:
        text = candidate.read_bytes().decode("utf-8")
    except (OSError, UnicodeError) as exc:
        raise ValueError(f"cannot read source digest input {relative.as_posix()}: {exc}") from exc
    return text.replace("\r\n", "\n").replace("\r", "\n").encode("utf-8")


def source_digest(root: Path, matrix: Mapping[str, object]) -> tuple[str, tuple[Path, ...]]:
    """Hash source paths in sorted path order with no timestamps or host data."""

    paths = _source_paths(matrix)
    digest = hashlib.sha256()
    for relative in paths:
        # NUL delimiters make path/content boundaries unambiguous while the
        # sorted repository-relative path keeps the result cross-platform.
        digest.update(relative.as_posix().encode("utf-8"))
        digest.update(b"\0")
        digest.update(_normalized_source_bytes(root, relative))
        digest.update(b"\0")
    return f"sha256:{digest.hexdigest()}", paths


def _section_exists(root: Path, reference: str) -> bool:
    if reference.count("#") != 1:
        return False
    path, section = reference.split("#", 1)
    sys.path.insert(0, str(HERE))
    import doc_lint  # type: ignore

    sections, errors = doc_lint.collect_sections(root)
    if errors:
        raise ValueError("authoritative section identity errors: " + "; ".join(errors))
    locations = sections.get(path, {}).get(section, [])
    if not locations:
        locations = sections.get(path, {}).get(f"@slug:{section.lower()}", [])
    return len(locations) == 1


def _owner_reference_errors(root: Path, matrix: Mapping[str, object]) -> list[str]:
    """Validate every lane owner link even when promotion execution is skipped.

    ``--skip-promotion`` is useful for a metadata-only preflight, but it must
    not turn a regenerated digest into permission to hide malformed owner
    links.  Resolve the same exact section identities used by ``doc_lint`` and
    fail closed for missing, duplicate, or structurally malformed references.
    """

    sys.path.insert(0, str(HERE))
    import doc_lint  # type: ignore

    sections, lint_errors = doc_lint.collect_sections(root)
    errors = [f"authoritative section identity error: {error}" for error in lint_errors]
    lanes = matrix.get("lanes")
    if not isinstance(lanes, list):
        return errors
    for lane in lanes:
        if not isinstance(lane, dict):
            errors.append("promotion matrix lane must be an object")
            continue
        lane_id = lane.get("lane_id", "<unknown>")
        references: list[tuple[str, str]] = []
        owner_refs = lane.get("owner_refs")
        if not isinstance(owner_refs, list):
            errors.append(f"{lane_id} owner_refs must be an array")
        else:
            if not owner_refs:
                errors.append(f"{lane_id} owner_refs must be non-empty")
            references.extend(("owner_refs", value) for value in owner_refs if isinstance(value, str))
            if any(not isinstance(value, str) for value in owner_refs):
                errors.append(f"{lane_id} owner_refs must contain only strings")
        assertions = lane.get("control_assertions")
        if not isinstance(assertions, list):
            errors.append(f"{lane_id} control_assertions must be an array")
        else:
            if not assertions:
                errors.append(f"{lane_id} control_assertions must be non-empty")
            for assertion in assertions:
                if not isinstance(assertion, dict):
                    errors.append(f"{lane_id} control_assertions must contain objects")
                    continue
                reference = assertion.get("owner_ref")
                if not isinstance(reference, str):
                    errors.append(f"{lane_id} control assertion owner_ref must be a string")
                    continue
                references.append(("control_assertions", reference))
        for field, reference in references:
            if reference.count("#") != 1:
                errors.append(f"{lane_id} {field} reference is malformed: {reference!r}")
                continue
            path, section = reference.split("#", 1)
            if not path or not section:
                errors.append(f"{lane_id} {field} reference is incomplete: {reference!r}")
                continue
            locations = sections.get(path, {}).get(section, [])
            if not locations:
                locations = sections.get(path, {}).get(f"@slug:{section.lower()}", [])
            if len(locations) != 1:
                errors.append(f"{lane_id} {field} reference does not resolve uniquely: {reference}")
    return errors


def _run_promotion_gate(root: Path) -> None:
    result = subprocess.run(
        [sys.executable, str(root / "docs/orchestration/promotion_lane_gate.py"), "--root", str(root)],
        cwd=root,
        text=True,
        capture_output=True,
        timeout=60,
        check=False,
    )
    if result.returncode != 0:
        detail = (result.stdout + result.stderr).strip().replace("\n", " | ")
        raise ValueError(f"promotion lane gate failed: {detail[:1_000]}")


def validate(
    root: Path,
    *,
    run_promotion: bool = True,
    require_full_closure: bool = False,
) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    output: list[str] = []
    closure = _load(root, CLOSURE_PATH)
    matrix = _load(root, MATRIX_PATH)
    coverage = _load(root, COVERAGE_PATH)
    if not isinstance(closure, dict):
        return ["closure manifest must be an object"], output
    if not isinstance(matrix, dict):
        return ["promotion matrix must be an object"], output
    if not isinstance(coverage, dict):
        return ["coverage ledger must be an object"], output

    expected = {
        "schema_version": 1,
        "manifest_id": "cineforge-architecture-closure",
        "closure_state": "CHOT_DESIGN_BASELINE",
        "scope": "AUTHORITATIVE_ARCHITECTURE_AND_CONTRACT_DESIGN",
        "architecture_source": "docs/architecture/FINAL_ARCHITECTURE.md#ARCH-REDTEAM-CLOSURE-01",
        "lane_matrix_source": "docs/orchestration/PROMOTION_LANE_MATRIX.json",
        "lane_ids": EXPECTED_LANES,
        "lane_contract_status": "CONTRACT_GATE_IMPLEMENTED",
        "design_coverage_state": "COMPLETE_EXPLICIT_RESIDUALS",
        "design_owner_mapping_count": 662,
        "coverage_uncovered_count": 0,
        "coverage_partial_count": 0,
        "coverage_open_unowned_pending_audit_count": 0,
        "runtime_status": "NOT_IMPLEMENTED_IN_REPOSITORY",
        "promotion_state": "PARKED_EXPLORATION_ONLY",
        "production_status": "NOT_CLOSED",
        "source_digest_algorithm": SOURCE_DIGEST_ALGORITHM,
        "source_digest_scope": SOURCE_DIGEST_SCOPE,
    }
    for key, value in expected.items():
        if closure.get(key) != value:
            errors.append(f"closure {key} must be {value!r}")
    if not _section_exists(root, closure.get("architecture_source", "")):
        errors.append("architecture closure section does not resolve uniquely")
    for key in ("decision",):
        if not isinstance(closure.get(key), str) or not closure[key].strip():
            errors.append(f"closure {key} must be non-empty text")
    for key in ("required_external_evidence", "open_blockers", "forbidden_claims"):
        value = closure.get(key)
        if not isinstance(value, list) or not value or any(not isinstance(item, str) or not item.strip() for item in value):
            errors.append(f"closure {key} must be a non-empty string array")
    if "production readiness" not in set(closure.get("forbidden_claims", [])):
        errors.append("closure must forbid production-readiness claims")

    lanes = matrix.get("lanes")
    if not isinstance(lanes, list):
        errors.append("promotion matrix lanes must be an array")
        lanes = []
    lane_by_id = {lane.get("lane_id"): lane for lane in lanes if isinstance(lane, dict)}
    if list(lane_by_id) != EXPECTED_LANES or len(lane_by_id) != len(lanes):
        errors.append("promotion matrix must contain exactly L3 through L7 in order")
    for lane_id in EXPECTED_LANES:
        lane = lane_by_id.get(lane_id)
        if not isinstance(lane, dict):
            continue
        if lane.get("status") != "CONTRACT_GATE_IMPLEMENTED":
            errors.append(f"{lane_id} is not contract-gate implemented")
        if lane.get("runtime_status") != "NOT_IMPLEMENTED_IN_REPOSITORY":
            errors.append(f"{lane_id} runtime status is promoted")
        if lane.get("promotion_state") != "PARKED_EXPLORATION_ONLY":
            errors.append(f"{lane_id} promotion state is promoted")
        assertions = lane.get("control_assertions")
        if not isinstance(assertions, list) or any(assertion.get("status") != "DESIGNED_UNVERIFIED" for assertion in assertions if isinstance(assertion, dict)):
            errors.append(f"{lane_id} contains a runtime-verified assertion")

    errors.extend(_owner_reference_errors(root, matrix))

    try:
        actual_digest, digest_paths = source_digest(root, matrix)
    except (OSError, UnicodeError, ValueError) as exc:
        errors.append(str(exc))
    else:
        if closure.get("source_digest") != actual_digest:
            errors.append("closure source_digest does not match the bound source set")
        output.append(f"source_digest={actual_digest}")
        output.append(f"source_digest_files={len(digest_paths)}")

    records = coverage.get("findings")
    if not isinstance(records, list):
        errors.append("coverage findings must be an array")
    else:
        verified = [record.get("stable_id") for record in records if isinstance(record, dict) and record.get("coverage_state") == "VERIFIED"]
        uncovered = [record.get("stable_id") for record in records if isinstance(record, dict) and record.get("coverage_state") == "UNCOVERED"]
        open_unowned = [
            record.get("stable_id")
            for record in records
            if isinstance(record, dict) and record.get("residual_state") == "OPEN_UNOWNED_PENDING_AUDIT"
        ]
        partial = [
            record.get("stable_id")
            for record in records
            if isinstance(record, dict) and record.get("coverage_state") == "PARTIAL"
        ]
        if verified:
            errors.append("closure cannot proceed while coverage_state=VERIFIED is asserted without runtime review")
        output.append(f"coverage_verified={len(verified)}")
        output.append(f"coverage_uncovered={len(uncovered)}")
        output.append(f"coverage_partial={len(partial)}")
        output.append(f"coverage_open_unowned_pending_audit={len(open_unowned)}")
        if closure.get("design_owner_mapping_count") != len(records):
            errors.append("closure design_owner_mapping_count must equal the canonical finding count")
        if closure.get("coverage_uncovered_count") != len(uncovered):
            errors.append("closure coverage_uncovered_count is stale")
        if closure.get("coverage_partial_count") != len(partial):
            errors.append("closure coverage_partial_count is stale")
        if closure.get("coverage_open_unowned_pending_audit_count") != len(open_unowned):
            errors.append("closure coverage_open_unowned_pending_audit_count is stale")
        if require_full_closure and uncovered:
            errors.append(f"full closure requires zero UNCOVERED findings (found {len(uncovered)})")
        if require_full_closure and partial:
            errors.append(f"full closure requires zero PARTIAL findings (found {len(partial)})")
        if require_full_closure and open_unowned:
            errors.append(
                "full closure requires zero OPEN_UNOWNED_PENDING_AUDIT findings "
                f"(found {len(open_unowned)})"
            )
    output.append(f"full_closure_required={'true' if require_full_closure else 'false'}")

    if not errors and run_promotion:
        try:
            _run_promotion_gate(root)
        except (OSError, subprocess.SubprocessError, ValueError) as exc:
            errors.append(str(exc))
    output.extend([
        "closure_state=CHOT_DESIGN_BASELINE",
        "runtime_status=NOT_IMPLEMENTED_IN_REPOSITORY",
        "promotion_state=PARKED_EXPLORATION_ONLY",
        "production_status=NOT_CLOSED",
    ])
    return errors, output


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path("."))
    parser.add_argument("--skip-promotion", action="store_true", help="validate closure metadata without rerunning the matrix gate")
    parser.add_argument(
        "--require-full-closure",
        action="store_true",
        help="fail if any finding is UNCOVERED, PARTIAL, or OPEN_UNOWNED_PENDING_AUDIT",
    )
    args = parser.parse_args(list(argv) if argv is not None else None)
    try:
        errors, output = validate(
            args.root.resolve(),
            run_promotion=not args.skip_promotion,
            require_full_closure=args.require_full_closure,
        )
    except (OSError, UnicodeError, ValueError, KeyError, TypeError) as exc:
        errors, output = [str(exc)], []
    if errors:
        print("ARCHITECTURE_CLOSURE_GATE=FAIL")
        for error in errors:
            print(f"ERROR: {error}")
        return 1
    print("ARCHITECTURE_CLOSURE_GATE=PASS")
    for line in output:
        print(line)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
