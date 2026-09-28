#!/usr/bin/env python3
"""Negative metadata fixtures for the L6 runtime contract gate."""

from __future__ import annotations

import json
import shutil
import sys
import tempfile
from pathlib import Path


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))
import l6_runtime_gate as gate  # noqa: E402


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def temporary_tree() -> Path:
    directory = Path(tempfile.mkdtemp(prefix="cineforge-l6-gate-"))
    shutil.copytree(ROOT / "docs", directory / "docs")
    return directory


def mutate_manifest(root: Path, **changes: object) -> None:
    path = root / gate.MANIFEST_PATH
    value = json.loads(path.read_text(encoding="utf-8"))
    value.update(changes)
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    cases = 0
    errors, _ = gate.validate_manifest(ROOT, run_selftest=True)
    require(not errors, "canonical L6 gate metadata must pass")
    print("PASS baseline")
    cases += 1

    tree = temporary_tree()
    try:
        mutate_manifest(tree, runtime_status="IMPLEMENTED")
        errors, _ = gate.validate_manifest(tree, run_selftest=False)
        require(errors and any("runtime_status" in error for error in errors), "runtime promotion must fail closed")
    finally:
        shutil.rmtree(tree, ignore_errors=True)
    print("PASS runtime-status promotion")
    cases += 1

    tree = temporary_tree()
    try:
        mutate_manifest(tree, source_artifact="../outside.py")
        errors, _ = gate.validate_manifest(tree, run_selftest=False)
        require(errors and any("source_artifact" in error for error in errors), "artifact traversal must fail closed")
    finally:
        shutil.rmtree(tree, ignore_errors=True)
    print("PASS artifact-path traversal")
    cases += 1

    tree = temporary_tree()
    try:
        mutate_manifest(tree, required_chaos_ids=gate.EXPECTED_CT_IDS[:-1])
        errors, _ = gate.validate_manifest(tree, run_selftest=False)
        require(errors and any("required_chaos_ids" in error for error in errors), "missing chaos case must fail closed")
    finally:
        shutil.rmtree(tree, ignore_errors=True)
    print("PASS chaos-contract completeness")
    cases += 1

    tree = temporary_tree()
    try:
        mutate_manifest(tree, forbidden_claims=[])
        errors, _ = gate.validate_manifest(tree, run_selftest=False)
        require(errors and any("forbidden_claims" in error for error in errors), "claim boundary removal must fail closed")
    finally:
        shutil.rmtree(tree, ignore_errors=True)
    print("PASS non-claim boundary")
    cases += 1

    print(f"L6_RUNTIME_GATE_SELFTEST=PASS cases={cases}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
