#!/usr/bin/env python3
"""Validate the bounded promotion-lane matrix against canonical evidence.

The matrix is deliberately an evidence-routing gate, not an implementation
claim.  It freezes the finding-to-chaos-case mapping for lanes #3--#7, checks
that every referenced control/owner exists, and keeps runtime evidence parked
until a product implementation and independent verifier provide it.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Iterable


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
MATRIX_PATH = Path("docs/orchestration/PROMOTION_LANE_MATRIX.json")
COVERAGE_PATH = Path("docs/orchestration/findings/COVERAGE.json")
REGISTRY_PATH = Path("docs/orchestration/findings/REGISTRY.json")
CONTROL_REGISTRY_PATH = Path("docs/design/CONTROL_REGISTRY.yaml")
CHAOS_PATH = Path("docs/orchestration/CHAOS_TEST_PLAN.md")
LANE_IDS = {"L3", "L4", "L5", "L6", "L7"}
CT_RE = re.compile(r"\bCT-(?:0[1-9]|[1-3][0-9]|40)\b")
STABLE_ID_RE = re.compile(r"^CFRT-[0-9A-F]{12}$")


def _load_json(root: Path, relative: Path) -> object:
    try:
        return json.loads((root / relative).read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"cannot load {relative.as_posix()}: {exc}") from exc


def _chaos_ids(root: Path) -> set[str]:
    text = (root / CHAOS_PATH).read_text(encoding="utf-8")
    return set(re.findall(r"^###\s+(CT-\d{2})\s+—", text, flags=re.MULTILINE))


def _control_ids(root: Path) -> set[str]:
    text = (root / CONTROL_REGISTRY_PATH).read_text(encoding="utf-8")
    return set(re.findall(r"^\s{2}-\s+id:\s*(\S+)\s*$", text, flags=re.MULTILINE))


def _finding_chaos_ids(record: dict) -> set[str]:
    values = record.get("required_chaos_tests")
    if not isinstance(values, list):
        return set()
    return set(CT_RE.findall(" ".join(str(value) for value in values)))


def _expected_finding_ids(records: list[dict], chaos_ids: set[str]) -> list[str]:
    return sorted(
        str(record["stable_id"])
        for record in records
        if chaos_ids.intersection(_finding_chaos_ids(record))
    )


def _owner_sections(root: Path) -> dict[str, dict[str, list[int]]]:
    # Import the already-reviewed section identity collector rather than
    # maintaining a second Markdown heading parser in this gate.
    sys.path.insert(0, str(HERE))
    import doc_lint  # type: ignore  # local bootstrap module

    sections, errors = doc_lint.collect_sections(root)
    if errors:
        raise ValueError("authoritative section identity errors: " + "; ".join(errors))
    return sections


def _validate_l4_artifact(root: Path, artifact: object) -> list[str]:
    """Validate the L4 reference harness is present without promoting it."""
    errors: list[str] = []
    if not isinstance(artifact, dict):
        return ["L4 implementation_artifact must be an object"]
    expected = {
        "manifest": "docs/orchestration/L4_RECOVERY_CONTRACT_MANIFEST.json",
        "source": "docs/orchestration/l4_recovery_contract.py",
        "selftest": "docs/orchestration/l4_recovery_selftest.py",
        "gate": "docs/orchestration/l4_recovery_gate.py",
        "gate_selftest": "docs/orchestration/l4_recovery_gate_selftest.py",
        "implementation_class": "REFERENCE_HARNESS_ONLY",
    }
    for key, value in expected.items():
        if artifact.get(key) != value:
            errors.append(f"L4 implementation_artifact {key} must be {value!r}")
    artifact_paths = [artifact.get(key) for key in ("manifest", "source", "selftest", "gate", "gate_selftest")]
    root_resolved = root.resolve()
    for relative in artifact_paths:
        if not isinstance(relative, str) or not relative or relative.startswith(("/", "\\")):
            errors.append(f"L4 implementation artifact path is invalid: {relative!r}")
            continue
        candidate = (root / relative).resolve()
        try:
            candidate.relative_to(root_resolved)
        except ValueError:
            errors.append(f"L4 implementation artifact escapes repository root: {relative}")
            continue
        if not candidate.is_file():
            errors.append(f"L4 implementation artifact is missing: {relative}")
    manifest = artifact.get("manifest")
    if isinstance(manifest, str):
        try:
            manifest_value = _load_json(root, Path(manifest))
        except (OSError, UnicodeError, ValueError) as exc:
            errors.append(f"L4 implementation manifest cannot be loaded: {exc}")
        else:
            if not isinstance(manifest_value, dict):
                errors.append("L4 implementation manifest must be an object")
            else:
                for key, value in {
                    "lane_id": "L4",
                    "implementation_class": "REFERENCE_HARNESS_ONLY",
                    "runtime_status": "NOT_IMPLEMENTED_IN_REPOSITORY",
                    "promotion_state": "PARKED_EXPLORATION_ONLY",
                }.items():
                    if manifest_value.get(key) != value:
                        errors.append(f"L4 implementation manifest {key} must be {value!r}")
    return errors


def _validate_l5_artifact(root: Path, artifact: object) -> list[str]:
    """Validate the L5 reference harness is present without promoting it."""
    errors: list[str] = []
    if not isinstance(artifact, dict):
        return ["L5 implementation_artifact must be an object"]
    expected = {
        "manifest": "docs/orchestration/L5_SECURITY_CONTRACT_MANIFEST.json",
        "source": "docs/orchestration/l5_security_contract.py",
        "selftest": "docs/orchestration/l5_security_selftest.py",
        "gate": "docs/orchestration/l5_security_gate.py",
        "gate_selftest": "docs/orchestration/l5_security_gate_selftest.py",
        "implementation_class": "REFERENCE_HARNESS_ONLY",
    }
    for key, value in expected.items():
        if artifact.get(key) != value:
            errors.append(f"L5 implementation_artifact {key} must be {value!r}")
    root_resolved = root.resolve()
    for key in ("manifest", "source", "selftest", "gate", "gate_selftest"):
        relative = artifact.get(key)
        if not isinstance(relative, str) or not relative or relative.startswith(("/", "\\")):
            errors.append(f"L5 implementation artifact path is invalid: {relative!r}")
            continue
        candidate = (root / relative).resolve()
        try:
            candidate.relative_to(root_resolved)
        except ValueError:
            errors.append(f"L5 implementation artifact escapes repository root: {relative}")
            continue
        if not candidate.is_file():
            errors.append(f"L5 implementation artifact is missing: {relative}")
    manifest = artifact.get("manifest")
    if isinstance(manifest, str):
        try:
            manifest_value = _load_json(root, Path(manifest))
        except (OSError, UnicodeError, ValueError) as exc:
            errors.append(f"L5 implementation manifest cannot be loaded: {exc}")
        else:
            if not isinstance(manifest_value, dict):
                errors.append("L5 implementation manifest must be an object")
            else:
                for key, value in {
                    "lane_id": "L5",
                    "implementation_class": "REFERENCE_HARNESS_ONLY",
                    "runtime_status": "NOT_IMPLEMENTED_IN_REPOSITORY",
                    "promotion_state": "PARKED_EXPLORATION_ONLY",
                }.items():
                    if manifest_value.get(key) != value:
                        errors.append(f"L5 implementation manifest {key} must be {value!r}")
                required = [
                    "CT-17", "CT-18", "CT-19", "CT-20", "CT-21", "CT-22", "CT-23", "CT-24",
                    "CT-31", "CT-32", "CT-33", "CT-34", "CT-35", "CT-36", "CT-37",
                ]
                if manifest_value.get("required_chaos_ids") != required:
                    errors.append("L5 implementation manifest required_chaos_ids are incomplete or reordered")
    return errors


def _validate_l6_artifact(root: Path, artifact: object) -> list[str]:
    """Validate the L6 reference harness is present without promoting it."""
    errors: list[str] = []
    if not isinstance(artifact, dict):
        return ["L6 implementation_artifact must be an object"]
    expected = {
        "manifest": "docs/orchestration/L6_RUNTIME_CONTRACT_MANIFEST.json",
        "source": "docs/orchestration/l6_runtime_contract.py",
        "selftest": "docs/orchestration/l6_runtime_selftest.py",
        "gate": "docs/orchestration/l6_runtime_gate.py",
        "gate_selftest": "docs/orchestration/l6_runtime_gate_selftest.py",
        "implementation_class": "REFERENCE_HARNESS_ONLY",
    }
    for key, value in expected.items():
        if artifact.get(key) != value:
            errors.append(f"L6 implementation_artifact {key} must be {value!r}")
    root_resolved = root.resolve()
    for key in ("manifest", "source", "selftest", "gate", "gate_selftest"):
        relative = artifact.get(key)
        if not isinstance(relative, str) or not relative or relative.startswith(("/", "\\")):
            errors.append(f"L6 implementation artifact path is invalid: {relative!r}")
            continue
        candidate = (root / relative).resolve()
        try:
            candidate.relative_to(root_resolved)
        except ValueError:
            errors.append(f"L6 implementation artifact escapes repository root: {relative}")
            continue
        if not candidate.is_file():
            errors.append(f"L6 implementation artifact is missing: {relative}")
    manifest = artifact.get("manifest")
    if isinstance(manifest, str):
        try:
            manifest_value = _load_json(root, Path(manifest))
        except (OSError, UnicodeError, ValueError) as exc:
            errors.append(f"L6 implementation manifest cannot be loaded: {exc}")
        else:
            if not isinstance(manifest_value, dict):
                errors.append("L6 implementation manifest must be an object")
            else:
                for key, value in {
                    "manifest_id": "cineforge-l6-runtime-contract",
                    "lane_id": "L6",
                    "implementation_class": "REFERENCE_HARNESS_ONLY",
                    "runtime_status": "NOT_IMPLEMENTED_IN_REPOSITORY",
                    "promotion_state": "PARKED_EXPLORATION_ONLY",
                }.items():
                    if manifest_value.get(key) != value:
                        errors.append(f"L6 implementation manifest {key} must be {value!r}")
                required = ["CT-25", "CT-26", "CT-27", "CT-28", "CT-39"]
                if manifest_value.get("required_chaos_ids") != required:
                    errors.append("L6 implementation manifest required_chaos_ids are incomplete or reordered")
    return errors


def validate_matrix(root: Path, selected_lane: str | None = None) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    output: list[str] = []
    matrix = _load_json(root, MATRIX_PATH)
    coverage = _load_json(root, COVERAGE_PATH)
    registry = _load_json(root, REGISTRY_PATH)
    if not isinstance(matrix, dict):
        return ["promotion lane matrix root must be an object"], output
    if matrix.get("schema_version") != 1 or matrix.get("matrix_id") != "cineforge-promotion-lane-matrix":
        errors.append("promotion lane matrix identity/version is unsupported")
    if matrix.get("generated_from") != COVERAGE_PATH.as_posix():
        errors.append("promotion lane matrix generated_from is stale")
    if not isinstance(coverage, dict) or not isinstance(registry, dict):
        return errors + ["coverage/registry roots must be objects"], output
    if matrix.get("generated_from_registry_revision") != registry.get("registry_revision"):
        errors.append("promotion lane matrix registry revision is stale")
    if coverage.get("source_registry_revision") != registry.get("registry_revision"):
        errors.append("coverage registry revision is stale")
    records = coverage.get("findings")
    if not isinstance(records, list) or any(not isinstance(record, dict) for record in records):
        return errors + ["coverage findings must be an array of objects"], output
    record_by_id = {record.get("stable_id"): record for record in records}
    if len(record_by_id) != len(records):
        errors.append("coverage stable IDs are not unique")
    try:
        chaos_ids = _chaos_ids(root)
        controls = _control_ids(root)
        sections = _owner_sections(root)
    except (OSError, UnicodeError, ValueError) as exc:
        return errors + [str(exc)], output
    lanes = matrix.get("lanes")
    if not isinstance(lanes, list):
        return errors + ["promotion lane matrix lanes must be an array"], output
    lane_by_id = {lane.get("lane_id"): lane for lane in lanes if isinstance(lane, dict)}
    if set(lane_by_id) != LANE_IDS or len(lane_by_id) != len(lanes):
        errors.append(f"promotion lane IDs must be exactly {sorted(LANE_IDS)}")
    covered_cases: set[str] = set()
    assertion_ids: set[str] = set()
    for lane in lanes:
        if not isinstance(lane, dict):
            errors.append("promotion lane entry must be an object")
            continue
        lane_id = lane.get("lane_id")
        if selected_lane and lane_id != selected_lane:
            continue
        if lane_id not in LANE_IDS:
            continue
        required_strings = [
            "title",
            "assignment_rule",
            "status",
            "promotion_state",
            "runtime_status",
            "evidence_policy",
        ]
        for field in required_strings:
            if not isinstance(lane.get(field), str) or not lane[field].strip():
                errors.append(f"{lane_id} missing non-empty {field}")
        if lane_id == "L4":
            errors.extend(_validate_l4_artifact(root, lane.get("implementation_artifact")))
        if lane_id == "L5":
            errors.extend(_validate_l5_artifact(root, lane.get("implementation_artifact")))
        if lane_id == "L6":
            errors.extend(_validate_l6_artifact(root, lane.get("implementation_artifact")))
        if lane.get("status") != "CONTRACT_GATE_IMPLEMENTED":
            errors.append(f"{lane_id} has unsupported status")
        if lane.get("promotion_state") != "PARKED_EXPLORATION_ONLY":
            errors.append(f"{lane_id} must remain PARKED_EXPLORATION_ONLY")
        if lane.get("runtime_status") != "NOT_IMPLEMENTED_IN_REPOSITORY":
            errors.append(f"{lane_id} runtime status must remain NOT_IMPLEMENTED_IN_REPOSITORY")
        chaos = lane.get("chaos_ids")
        if not isinstance(chaos, list) or not chaos or len(chaos) != len(set(chaos)):
            errors.append(f"{lane_id} chaos_ids must be a non-empty unique array")
            lane_chaos: set[str] = set()
        else:
            lane_chaos = set(chaos)
            unknown_chaos = sorted(lane_chaos - chaos_ids)
            if unknown_chaos:
                errors.append(f"{lane_id} references unknown chaos cases: {','.join(unknown_chaos)}")
        covered_cases.update(lane_chaos)
        finding_ids = lane.get("finding_ids")
        if not isinstance(finding_ids, list) or finding_ids != sorted(finding_ids) or len(finding_ids) != len(set(finding_ids)):
            errors.append(f"{lane_id} finding_ids must be sorted and unique")
            finding_ids = []
        expected_ids = _expected_finding_ids(records, lane_chaos)
        if finding_ids != expected_ids:
            errors.append(f"{lane_id} finding_ids do not match its chaos-case assignment")
        for stable_id in finding_ids:
            if not isinstance(stable_id, str) or not STABLE_ID_RE.fullmatch(stable_id):
                errors.append(f"{lane_id} contains an invalid canonical finding ID: {stable_id!r}")
                continue
            record = record_by_id.get(stable_id)
            if record is None:
                errors.append(f"{lane_id} references missing finding {stable_id}")
                continue
            if record.get("coverage_state") == "VERIFIED":
                errors.append(f"{lane_id} cannot promote {stable_id} to VERIFIED")
            if not record.get("required_negative_tests") or not record.get("required_chaos_tests"):
                errors.append(f"{lane_id} finding {stable_id} lacks required negative/chaos tests")
        control_ids = lane.get("required_control_ids")
        if not isinstance(control_ids, list) or len(control_ids) != len(set(control_ids)):
            errors.append(f"{lane_id} required_control_ids must be unique")
        else:
            for control_id in control_ids:
                if control_id not in controls:
                    errors.append(f"{lane_id} references missing control {control_id}")
        owner_refs = lane.get("owner_refs")
        if not isinstance(owner_refs, list) or len(owner_refs) != len(set(owner_refs)):
            errors.append(f"{lane_id} owner_refs must be unique")
        else:
            for reference in owner_refs:
                if not isinstance(reference, str) or reference.count("#") != 1:
                    errors.append(f"{lane_id} has malformed owner reference {reference!r}")
                    continue
                path, identifier = reference.split("#", 1)
                locations = sections.get(path, {}).get(identifier, [])
                if not locations:
                    locations = sections.get(path, {}).get(f"@slug:{identifier.lower()}", [])
                if len(locations) != 1:
                    errors.append(f"{lane_id} owner reference does not resolve uniquely: {reference}")
        assertions = lane.get("control_assertions")
        if not isinstance(assertions, list) or len(assertions) < 4:
            errors.append(f"{lane_id} must define at least four control assertions")
            assertions = []
        assertion_chaos_covered: set[str] = set()
        for assertion in assertions:
            if not isinstance(assertion, dict):
                errors.append(f"{lane_id} control assertion must be an object")
                continue
            assertion_id = assertion.get("id")
            if not isinstance(assertion_id, str) or not re.fullmatch(r"L[3-7]-ASSERT-[A-Z0-9-]+", assertion_id):
                errors.append(f"{lane_id} has malformed control assertion ID {assertion_id!r}")
            elif assertion_id in assertion_ids:
                errors.append(f"duplicate control assertion ID {assertion_id}")
            else:
                assertion_ids.add(assertion_id)
            owner_ref = assertion.get("owner_ref")
            if not isinstance(owner_ref, str) or owner_ref not in (owner_refs if isinstance(owner_refs, list) else []):
                errors.append(f"{lane_id} assertion {assertion_id} is not bound to a lane owner reference")
            assertion_chaos = assertion.get("chaos_ids")
            if not isinstance(assertion_chaos, list) or not assertion_chaos or len(assertion_chaos) != len(set(assertion_chaos)):
                errors.append(f"{lane_id} assertion {assertion_id} chaos_ids must be unique and non-empty")
            elif not set(assertion_chaos).issubset(lane_chaos):
                errors.append(f"{lane_id} assertion {assertion_id} references a case outside its lane")
            else:
                assertion_chaos_covered.update(assertion_chaos)
            if assertion.get("fail_closed") is not True:
                errors.append(f"{lane_id} assertion {assertion_id} must be fail-closed")
            if assertion.get("status") != "DESIGNED_UNVERIFIED":
                errors.append(f"{lane_id} assertion {assertion_id} cannot claim runtime verification")
            if not isinstance(assertion.get("negative_test"), str) or not assertion["negative_test"].strip():
                errors.append(f"{lane_id} assertion {assertion_id} needs a negative-test description")
        if lane_id in {"L5", "L6"} and assertion_chaos_covered != lane_chaos:
            missing = sorted(lane_chaos - assertion_chaos_covered)
            extra = sorted(assertion_chaos_covered - lane_chaos)
            if missing:
                errors.append(f"{lane_id} control assertions omit chaos cases: {','.join(missing)}")
            if extra:
                errors.append(f"{lane_id} control assertions contain out-of-lane chaos cases: {','.join(extra)}")
        for field in ("required_layers", "required_external_evidence", "excluded"):
            values = lane.get(field)
            if not isinstance(values, list) or not values or any(not isinstance(value, str) or not value.strip() for value in values):
                errors.append(f"{lane_id} {field} must be a non-empty string array")
        states = Counter(record_by_id[stable_id].get("coverage_state") for stable_id in finding_ids if stable_id in record_by_id)
        severities = Counter(record_by_id[stable_id].get("severity") for stable_id in finding_ids if stable_id in record_by_id)
        output.append(
            f"LANE {lane_id}: findings={len(finding_ids)} "
            f"P0={sum(count for severity, count in severities.items() if str(severity).startswith('P0'))} "
            f"states={dict(sorted(states.items()))} chaos={len(lane_chaos)}"
        )
    if not selected_lane and covered_cases != chaos_ids:
        errors.append("promotion lanes do not cover every CT-01..CT-40 case")
    if selected_lane and selected_lane not in lane_by_id:
        errors.append(f"unknown lane selection {selected_lane}")
    return errors, output


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path("."))
    parser.add_argument("--lane", choices=sorted(LANE_IDS), help="validate only one lane")
    args = parser.parse_args(list(argv) if argv is not None else None)
    try:
        errors, output = validate_matrix(args.root.resolve(), args.lane)
    except (OSError, UnicodeError, ValueError, KeyError, TypeError) as exc:
        errors, output = [str(exc)], []
    if errors:
        print("PROMOTION_LANE_GATE=FAIL")
        for error in errors:
            print(f"ERROR: {error}")
        return 1
    print("PROMOTION_LANE_GATE=PASS")
    for line in output:
        print(line)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
