#!/usr/bin/env python3
"""Validate the truthful architecture-level closure boundary.

This gate can close the design baseline only.  It deliberately fails if a
reference harness is used to claim runtime, production or release closure.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Iterable


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
CLOSURE_PATH = Path("docs/orchestration/ARCHITECTURE_CLOSURE_MANIFEST.json")
MATRIX_PATH = Path("docs/orchestration/PROMOTION_LANE_MATRIX.json")
COVERAGE_PATH = Path("docs/orchestration/findings/COVERAGE.json")
EXPECTED_LANES = ["L3", "L4", "L5", "L6", "L7"]


def _load(root: Path, relative: Path) -> object:
    try:
        return json.loads((root / relative).read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"cannot load {relative.as_posix()}: {exc}") from exc


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


def validate(root: Path, *, run_promotion: bool = True) -> tuple[list[str], list[str]]:
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
        "runtime_status": "NOT_IMPLEMENTED_IN_REPOSITORY",
        "promotion_state": "PARKED_EXPLORATION_ONLY",
        "production_status": "NOT_CLOSED",
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

    records = coverage.get("findings")
    if not isinstance(records, list):
        errors.append("coverage findings must be an array")
    else:
        verified = [record.get("stable_id") for record in records if isinstance(record, dict) and record.get("coverage_state") == "VERIFIED"]
        if verified:
            errors.append("closure cannot proceed while coverage_state=VERIFIED is asserted without runtime review")
        output.append(f"coverage_verified={len(verified)}")

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
    args = parser.parse_args(list(argv) if argv is not None else None)
    try:
        errors, output = validate(args.root.resolve(), run_promotion=not args.skip_promotion)
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
