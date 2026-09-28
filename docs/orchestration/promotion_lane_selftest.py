#!/usr/bin/env python3
"""Fail-closed fixtures for the promotion-lane evidence matrix."""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Callable


ROOT = Path(__file__).resolve().parents[2]
GATE = ROOT / "docs" / "orchestration" / "promotion_lane_gate.py"
IGNORED = shutil.ignore_patterns(".git", "__pycache__", "*.pyc")


def fixture() -> tuple[tempfile.TemporaryDirectory[str], Path]:
    temporary = tempfile.TemporaryDirectory(prefix="cineforge-promotion-lane-")
    destination = Path(temporary.name) / "repo"
    shutil.copytree(ROOT, destination, ignore=IGNORED)
    return temporary, destination


def read_matrix(root: Path) -> dict:
    return json.loads((root / "docs" / "orchestration" / "PROMOTION_LANE_MATRIX.json").read_text(encoding="utf-8"))


def write_matrix(root: Path, matrix: dict) -> None:
    path = root / "docs" / "orchestration" / "PROMOTION_LANE_MATRIX.json"
    path.write_text(json.dumps(matrix, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def run_gate(root: Path, *extra: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(root / "docs" / "orchestration" / "promotion_lane_gate.py"), "--root", str(root), *extra],
        cwd=root,
        text=True,
        capture_output=True,
        check=False,
        timeout=30,
    )


def run_case(name: str, mutate: Callable[[Path], None], expected: str) -> None:
    temporary, root = fixture()
    try:
        mutate(root)
        result = run_gate(root)
        output = result.stdout + result.stderr
        if result.returncode == 0:
            raise AssertionError(f"{name}: gate unexpectedly passed\n{output}")
        if expected not in output:
            raise AssertionError(f"{name}: expected {expected!r}\n{output}")
        print(f"PASS {name}")
    finally:
        temporary.cleanup()


def mutate_finding_mapping(root: Path) -> None:
    matrix = read_matrix(root)
    lane = next(item for item in matrix["lanes"] if item["lane_id"] == "L4")
    lane["finding_ids"].pop()
    write_matrix(root, matrix)


def mutate_unknown_chaos(root: Path) -> None:
    matrix = read_matrix(root)
    lane = next(item for item in matrix["lanes"] if item["lane_id"] == "L5")
    lane["chaos_ids"].append("CT-99")
    write_matrix(root, matrix)


def mutate_runtime_status(root: Path) -> None:
    matrix = read_matrix(root)
    matrix["lanes"][0]["runtime_status"] = "VERIFIED"
    write_matrix(root, matrix)


def mutate_owner_ref(root: Path) -> None:
    matrix = read_matrix(root)
    matrix["lanes"][0]["owner_refs"].append("docs/orchestration/CONTROL_EVENT_CONTRACTS.md#NO-SUCH-ID")
    write_matrix(root, matrix)


def mutate_registry_revision(root: Path) -> None:
    matrix = read_matrix(root)
    matrix["generated_from_registry_revision"] = 999
    write_matrix(root, matrix)


def mutate_assertion_status(root: Path) -> None:
    matrix = read_matrix(root)
    matrix["lanes"][1]["control_assertions"][0]["status"] = "CHAOS_TESTED"
    write_matrix(root, matrix)


def mutate_l7_control_scope(root: Path) -> None:
    path = root / "docs" / "orchestration" / "L7_RELEASE_CONTRACT_MANIFEST.json"
    manifest = json.loads(path.read_text(encoding="utf-8"))
    manifest["supplemental_control_ids"] = []
    path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    temporary, root = fixture()
    try:
        baseline = run_gate(root)
        output = baseline.stdout + baseline.stderr
        if baseline.returncode != 0 or "PROMOTION_LANE_GATE=PASS" not in output:
            raise AssertionError(f"baseline: gate failed\n{output}")
        selected = run_gate(root, "--lane", "L4")
        if selected.returncode != 0 or "LANE L4:" not in selected.stdout:
            raise AssertionError(f"selected lane: gate failed\n{selected.stdout}{selected.stderr}")
        print("PASS baseline")
        print("PASS selected lane")
    finally:
        temporary.cleanup()

    cases = [
        ("finding mapping drift", mutate_finding_mapping, "finding_ids do not match"),
        ("unknown chaos case", mutate_unknown_chaos, "references unknown chaos cases"),
        ("runtime status promotion", mutate_runtime_status, "runtime status must remain"),
        ("owner reference drift", mutate_owner_ref, "owner reference does not resolve uniquely"),
        ("registry revision drift", mutate_registry_revision, "registry revision is stale"),
        ("assertion evidence promotion", mutate_assertion_status, "cannot claim runtime verification"),
        ("L7 control-scope inheritance drift", mutate_l7_control_scope, "matrix/manifest supplemental_control_ids must agree"),
    ]
    for name, mutate, expected in cases:
        run_case(name, mutate, expected)
    print(f"PROMOTION_LANE_SELFTEST=PASS cases={len(cases) + 2}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
