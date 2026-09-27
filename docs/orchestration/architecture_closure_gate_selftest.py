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
    shutil.copy2(ROOT / "AGENTS.md", directory / "AGENTS.md")
    return directory


def mutate(root: Path, **changes: object) -> None:
    path = root / gate.CLOSURE_PATH
    value = json.loads(path.read_text(encoding="utf-8"))
    value.update(changes)
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    cases = 0
    errors, _ = gate.validate(ROOT, run_promotion=True, require_full_closure=False)
    require(not errors, "canonical architecture closure must pass")
    print("PASS baseline")
    cases += 1

    tree = temporary_tree()
    try:
        coverage_path = tree / gate.COVERAGE_PATH
        coverage = json.loads(coverage_path.read_text(encoding="utf-8"))
        records = coverage.get("findings")
        require(isinstance(records, list) and len(records) >= 2, "coverage fixture needs two findings")
        records[0]["coverage_state"] = "UNCOVERED"
        records[1]["residual_state"] = "OPEN_UNOWNED_PENDING_AUDIT"
        coverage_path.write_text(json.dumps(coverage, indent=2) + "\n", encoding="utf-8")
        errors, _ = gate.validate(tree, run_promotion=False, require_full_closure=True)
        require(
            errors
            and any("UNCOVERED" in error for error in errors)
            and any("OPEN_UNOWNED_PENDING_AUDIT" in error for error in errors),
            "strict full-closure mode must reject unresolved coverage states",
        )
    finally:
        shutil.rmtree(tree, ignore_errors=True)
    print("PASS strict-coverage boundary")
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

    tree = temporary_tree()
    try:
        source = tree / "docs/architecture/FINAL_ARCHITECTURE.md"
        source.write_text(source.read_text(encoding="utf-8") + "\nsource drift fixture\n", encoding="utf-8")
        errors, _ = gate.validate(tree, run_promotion=False)
        require(errors and any("source_digest" in error for error in errors), "source drift must fail closed")
    finally:
        shutil.rmtree(tree, ignore_errors=True)
    print("PASS source-digest drift")
    cases += 1

    tree = temporary_tree()
    try:
        source = tree / "docs/design/FINAL_DETAILED_DESIGN.md"
        normalized = source.read_text(encoding="utf-8").replace("\r\n", "\n").replace("\r", "\n")
        source.write_bytes(normalized.replace("\n", "\r\n").encode("utf-8"))
        errors, _ = gate.validate(tree, run_promotion=False)
        require(not errors, "CRLF/LF normalization must keep the source digest stable")
    finally:
        shutil.rmtree(tree, ignore_errors=True)
    print("PASS source-newline normalization")
    cases += 1

    tree = temporary_tree()
    try:
        matrix_path = tree / gate.MATRIX_PATH
        matrix = json.loads(matrix_path.read_text(encoding="utf-8"))
        matrix["lanes"][0]["owner_refs"] = None
        matrix_path.write_text(json.dumps(matrix, indent=2) + "\n", encoding="utf-8")
        errors, _ = gate.validate(tree, run_promotion=True)
        require(
            errors and any("owner_refs" in error or "source_digest" in error for error in errors),
            "malformed owner references must fail closed",
        )
    finally:
        shutil.rmtree(tree, ignore_errors=True)
    print("PASS malformed-source-metadata")
    cases += 1

    print(f"ARCHITECTURE_CLOSURE_GATE_SELFTEST=PASS cases={cases}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
