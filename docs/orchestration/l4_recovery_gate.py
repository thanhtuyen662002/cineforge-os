#!/usr/bin/env python3
"""Fail-closed gate for the L4 reference recovery contract artifact.

The gate validates artifact identity, owner/chaos references and the negative
self-test.  It intentionally preserves ``NOT_IMPLEMENTED_IN_REPOSITORY`` and
``PARKED_EXPLORATION_ONLY``; a passing gate cannot promote a design or Python
reference model to production evidence.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Iterable


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
MANIFEST_PATH = Path("docs/orchestration/L4_RECOVERY_CONTRACT_MANIFEST.json")
CHAOS_PATH = Path("docs/orchestration/CHAOS_TEST_PLAN.md")
EXPECTED_CT_IDS = [f"CT-{number:02d}" for number in range(10, 17)]
EXPECTED_FORBIDDEN = {
    "production restore proof",
    "real signing-key verification",
    "OS-level exclusive-lock proof",
    "power-loss or hardware-failure proof",
    "coverage_state=VERIFIED",
}
PATH_KEYS = ("source_artifact", "selftest_artifact", "gate_artifact", "gate_selftest_artifact")
OWNER_REF_RE = re.compile(r"^[^#]+#[^#]+$")
INVARIANT_ID_RE = re.compile(r"^L4-INV-[A-Z0-9-]+$")


def _load_manifest(root: Path) -> dict:
    try:
        value = json.loads((root / MANIFEST_PATH).read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"cannot load {MANIFEST_PATH.as_posix()}: {exc}") from exc
    if not isinstance(value, dict):
        raise ValueError("L4 contract manifest must be an object")
    return value


def _safe_artifact(root: Path, relative: object, field: str) -> Path:
    if not isinstance(relative, str) or not relative or relative.startswith(("/", "\\")):
        raise ValueError(f"{field} must be a repository-relative path")
    candidate = (root / relative).resolve()
    try:
        candidate.relative_to(root.resolve())
    except ValueError as exc:
        raise ValueError(f"{field} escapes the repository root") from exc
    if not candidate.is_file():
        raise ValueError(f"{field} does not exist: {relative}")
    return candidate


def _owner_sections(root: Path) -> dict[str, dict[str, list[int]]]:
    sys.path.insert(0, str(HERE))
    import doc_lint  # type: ignore  # local bootstrap module

    sections, errors = doc_lint.collect_sections(root)
    if errors:
        raise ValueError("authoritative section identity errors: " + "; ".join(errors))
    return sections


def _chaos_ids(root: Path) -> set[str]:
    text = (root / CHAOS_PATH).read_text(encoding="utf-8")
    return set(re.findall(r"^###\s+(CT-\d{2})\s+—", text, flags=re.MULTILINE))


def _run_selftest(root: Path, selftest_path: Path) -> list[str]:
    try:
        result = subprocess.run(
            [sys.executable, str(selftest_path)],
            cwd=root,
            text=True,
            capture_output=True,
            timeout=30,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise ValueError(f"L4 recovery self-test could not run: {exc}") from exc
    if result.returncode != 0:
        detail = (result.stdout + result.stderr).strip().replace("\n", " | ")
        raise ValueError(f"L4 recovery self-test failed: {detail[:1_000]}")
    required = [f"PASS {case}" for case in EXPECTED_CT_IDS]
    missing = [marker for marker in required if marker not in result.stdout.splitlines()]
    if missing or "L4_RECOVERY_SELFTEST=PASS cases=" not in result.stdout:
        raise ValueError("L4 recovery self-test omitted required pass markers")
    return [line for line in result.stdout.splitlines() if line.startswith(("PASS ", "L4_RECOVERY_"))]


def validate_manifest(root: Path, *, run_selftest: bool = True) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    output: list[str] = []
    manifest = _load_manifest(root)
    required_identity = {
        "schema_version": 1,
        "manifest_id": "cineforge-l4-recovery-contract",
        "lane_id": "L4",
        "implementation_class": "REFERENCE_HARNESS_ONLY",
        "runtime_status": "NOT_IMPLEMENTED_IN_REPOSITORY",
        "promotion_state": "PARKED_EXPLORATION_ONLY",
    }
    for key, expected in required_identity.items():
        if manifest.get(key) != expected:
            errors.append(f"manifest {key} must be {expected!r}")
    artifacts: dict[str, Path] = {}
    for key in PATH_KEYS:
        try:
            artifacts[key] = _safe_artifact(root, manifest.get(key), key)
        except ValueError as exc:
            errors.append(str(exc))
    required_ct_ids = manifest.get("required_chaos_ids")
    if required_ct_ids != EXPECTED_CT_IDS:
        errors.append("required_chaos_ids must be exactly CT-10 through CT-16 in order")
    try:
        chaos_ids = _chaos_ids(root)
        if set(EXPECTED_CT_IDS) - chaos_ids:
            errors.append("CHAOS_TEST_PLAN.md is missing one or more L4 chaos cases")
    except (OSError, UnicodeError) as exc:
        errors.append(f"cannot read chaos plan: {exc}")

    owner_refs = manifest.get("owner_refs")
    if not isinstance(owner_refs, list) or not owner_refs or len(owner_refs) != len(set(owner_refs)):
        errors.append("owner_refs must be a unique non-empty array")
        owner_refs = []
    sections: dict[str, dict[str, list[int]]] = {}
    try:
        sections = _owner_sections(root)
    except (OSError, UnicodeError, ValueError) as exc:
        errors.append(str(exc))
    for reference in owner_refs:
        if not isinstance(reference, str) or not OWNER_REF_RE.fullmatch(reference):
            errors.append(f"malformed owner reference: {reference!r}")
            continue
        path, section = reference.split("#", 1)
        locations = sections.get(path, {}).get(section, [])
        if not locations:
            locations = sections.get(path, {}).get(f"@slug:{section.lower()}", [])
        if len(locations) != 1:
            errors.append(f"owner reference does not resolve uniquely: {reference}")

    invariants = manifest.get("invariants")
    invariant_ids: set[str] = set()
    if not isinstance(invariants, list) or not invariants:
        errors.append("invariants must be a non-empty array")
        invariants = []
    for invariant in invariants:
        if not isinstance(invariant, dict):
            errors.append("invariant must be an object")
            continue
        invariant_id = invariant.get("id")
        if not isinstance(invariant_id, str) or not INVARIANT_ID_RE.fullmatch(invariant_id):
            errors.append(f"malformed invariant ID: {invariant_id!r}")
        elif invariant_id in invariant_ids:
            errors.append(f"duplicate invariant ID: {invariant_id}")
        else:
            invariant_ids.add(invariant_id)
        if invariant.get("owner_ref") not in owner_refs:
            errors.append(f"invariant {invariant_id!r} has an unlisted owner reference")
        if not isinstance(invariant.get("negative_fixture"), str) or not invariant["negative_fixture"].strip():
            errors.append(f"invariant {invariant_id!r} needs a negative fixture description")

    forbidden_claims = manifest.get("forbidden_claims")
    if not isinstance(forbidden_claims, list) or not EXPECTED_FORBIDDEN.issubset(set(forbidden_claims)):
        errors.append("forbidden_claims must retain every L4 non-claim boundary")
    source_path = artifacts.get("source_artifact")
    if source_path is not None:
        source = source_path.read_text(encoding="utf-8")
        if "not the CineForge product runtime" not in source:
            errors.append("reference source must explicitly state that it is not product runtime")
    if errors:
        return errors, output
    if run_selftest:
        try:
            markers = _run_selftest(root, artifacts["selftest_artifact"])
        except ValueError as exc:
            errors.append(str(exc))
        else:
            output.extend(markers)
    output.append("implementation_class=REFERENCE_HARNESS_ONLY")
    output.append("runtime_status=NOT_IMPLEMENTED_IN_REPOSITORY")
    output.append("promotion_state=PARKED_EXPLORATION_ONLY")
    return errors, output


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path("."))
    parser.add_argument("--skip-selftest", action="store_true", help="validate metadata without executing fixtures")
    args = parser.parse_args(list(argv) if argv is not None else None)
    try:
        errors, output = validate_manifest(args.root.resolve(), run_selftest=not args.skip_selftest)
    except (OSError, UnicodeError, ValueError, KeyError, TypeError) as exc:
        errors, output = [str(exc)], []
    if errors:
        print("L4_RECOVERY_GATE=FAIL")
        for error in errors:
            print(f"ERROR: {error}")
        return 1
    print("L4_RECOVERY_GATE=PASS")
    for line in output:
        print(line)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
