#!/usr/bin/env python3
"""Fail-closed metadata fixtures for the architecture closure gate."""

from __future__ import annotations

import json
import shutil
import sys
import tempfile
from pathlib import Path


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))
import architecture_closure_gate as gate  # noqa: E402


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def temporary_tree() -> Path:
    directory = Path(tempfile.mkdtemp(prefix="cineforge-architecture-closure-"))
    shutil.copytree(ROOT / "docs", directory / "docs")
    return directory


def mutate(root: Path, **changes: object) -> None:
    path = root / gate.CLOSURE_PATH
    value = json.loads(path.read_text(encoding="utf-8"))
    value.update(changes)
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    cases = 0
    errors, _ = gate.validate(ROOT, run_promotion=True)
    require(not errors, "canonical architecture closure must pass")
    print("PASS baseline")
    cases += 1

    tree = temporary_tree()
    try:
        mutate(tree, closure_state="IMPLEMENTATION_CLOSED")
        errors, _ = gate.validate(tree, run_promotion=False)
        require(errors and any("closure_state" in error for error in errors), "design closure state must not be promoted")
    finally:
        shutil.rmtree(tree, ignore_errors=True)
    print("PASS closure-state promotion")
    cases += 1

    tree = temporary_tree()
    try:
        mutate(tree, production_status="READY_FOR_RELEASE")
        errors, _ = gate.validate(tree, run_promotion=False)
        require(errors and any("production_status" in error for error in errors), "production status must remain open")
    finally:
        shutil.rmtree(tree, ignore_errors=True)
    print("PASS production-status promotion")
    cases += 1

    tree = temporary_tree()
    try:
        mutate(tree, architecture_source="docs/architecture/FINAL_ARCHITECTURE.md#MISSING")
        errors, _ = gate.validate(tree, run_promotion=False)
        require(errors and any("section" in error for error in errors), "architecture source must resolve")
    finally:
        shutil.rmtree(tree, ignore_errors=True)
    print("PASS architecture-reference resolution")
    cases += 1

    tree = temporary_tree()
    try:
        matrix_path = tree / gate.MATRIX_PATH
        matrix = json.loads(matrix_path.read_text(encoding="utf-8"))
        matrix["lanes"][0]["runtime_status"] = "IMPLEMENTED"
        matrix_path.write_text(json.dumps(matrix, indent=2) + "\n", encoding="utf-8")
        errors, _ = gate.validate(tree, run_promotion=False)
        require(errors and any("runtime status" in error for error in errors), "lane runtime promotion must fail closed")
    finally:
        shutil.rmtree(tree, ignore_errors=True)
    print("PASS lane-runtime promotion")
    cases += 1

    print(f"ARCHITECTURE_CLOSURE_GATE_SELFTEST=PASS cases={cases}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
