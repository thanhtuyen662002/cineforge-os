#!/usr/bin/env python3
"""Fail-closed gate for the L7 release-boundary reference contract.

The gate proves that the L7 manifest, owner links, chaos assignments and
negative fixtures agree.  It does not prove rights enforcement, erasure,
backup recovery, package signing, CI provenance, offline authority or a real
deployment platform.  Those claims remain parked until product code and an
independent verifier produce runtime evidence.
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
MANIFEST_PATH = Path("docs/orchestration/L7_RELEASE_CONTRACT_MANIFEST.json")
CHAOS_PATH = Path("docs/orchestration/CHAOS_TEST_PLAN.md")
EXPECTED_CT_IDS = ["CT-29", "CT-30", "CT-31", "CT-32", "CT-33", "CT-34", "CT-38", "CT-40"]
EXPECTED_CONTROL_IDS = [
    "CF-CTRL-RIGHTS-PRIVACY",
    "CF-CTRL-RELEASE-PROVENANCE",
]
EXPECTED_INHERITED_CONTROL_IDS = [
    "CF-CTRL-RECOVERY-EPOCH",
    "CF-CTRL-BACKUP-CONSISTENCY",
    "CF-CTRL-UPDATE-SUPPLY-CHAIN",
]
EXPECTED_INHERITED_CONTROL_SOURCES = {
    "CF-CTRL-RECOVERY-EPOCH": ["L4"],
    "CF-CTRL-BACKUP-CONSISTENCY": ["L4"],
    "CF-CTRL-UPDATE-SUPPLY-CHAIN": ["L4", "L5"],
}
EXPECTED_SUPPLEMENTAL_CONTROL_IDS = [
    "CF-CTRL-COLLAB-BRANCH",
    "CF-CTRL-COLLAB-AUTH",
    "CF-CTRL-HIGH-SECURE-ERASURE",
]
EXPECTED_SUPPLEMENTAL_APPLICABILITY = {
    "CF-CTRL-COLLAB-BRANCH": "FUTURE_MULTIUSER",
    "CF-CTRL-COLLAB-AUTH": "FUTURE_MULTIUSER",
    "CF-CTRL-HIGH-SECURE-ERASURE": "OPTIONAL_HIGH_SECURITY",
}
EXPECTED_L7_APPLICABILITY = {
    "CF-CTRL-RIGHTS-PRIVACY": ("V1_FOUNDATION", "true"),
    "CF-CTRL-RELEASE-PROVENANCE": ("V1_BEFORE_RELEASE", "false"),
    "CF-CTRL-RECOVERY-EPOCH": ("V1_BEFORE_RELEASE", "false"),
    "CF-CTRL-BACKUP-CONSISTENCY": ("V1_BEFORE_RELEASE", "false"),
    "CF-CTRL-UPDATE-SUPPLY-CHAIN": ("V1_BEFORE_RELEASE", "false"),
}
EXPECTED_CONTROL_SCOPE_NOTE = (
    "L7 directly requires V1 rights/privacy and release-provenance controls. "
    "Recovery, backup and update supply-chain controls are inherited from L4 "
    "(update supply-chain is also covered by L5). Collaboration and high-secure "
    "erasure controls are compatibility/profile supplements; they are not V1 "
    "closure prerequisites until their applicability rule activates."
)
EXPECTED_FORBIDDEN = {
    "real rights/legal/erasure enforcement proof",
    "real backup, disk, database or operating-system restore proof",
    "real signing-key, CI runner or supply-chain provenance proof",
    "real project isolation, offline authority or deployment singleton proof",
    "real provider/publication/compensation proof",
    "production release or chaos coverage proof",
    "coverage_state=VERIFIED",
}
PATH_KEYS = ("source_artifact", "selftest_artifact", "gate_artifact", "gate_selftest_artifact")
OWNER_REF_RE = re.compile(r"^[^#]+#[^#]+$")
INVARIANT_ID_RE = re.compile(r"^L7-INV-[A-Z0-9-]+$")


def _load_manifest(root: Path) -> dict:
    try:
        value = json.loads((root / MANIFEST_PATH).read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"cannot load {MANIFEST_PATH.as_posix()}: {exc}") from exc
    if not isinstance(value, dict):
        raise ValueError("L7 release contract manifest must be an object")
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
    import doc_lint  # type: ignore

    sections, errors = doc_lint.collect_sections(root)
    if errors:
        raise ValueError("authoritative section identity errors: " + "; ".join(errors))
    return sections


def _chaos_ids(root: Path) -> set[str]:
    text = (root / CHAOS_PATH).read_text(encoding="utf-8")
    return set(re.findall(r"^###\s+(CT-\d{2})\s+—", text, flags=re.MULTILINE))


def _control_ids(root: Path) -> set[str]:
    text = (root / Path("docs/design/CONTROL_REGISTRY.yaml")).read_text(encoding="utf-8")
    return set(re.findall(r"^\s{2}-\s+id:\s*(\S+)\s*$", text, flags=re.MULTILINE))


def _control_metadata(root: Path) -> dict[str, dict[str, str]]:
    """Parse the small, stable applicability fields from the YAML registry.

    The repository intentionally avoids a runtime YAML dependency for these
    gates.  Control entries have a constrained ``id``/``applicability``/
    ``current_slice_required`` shape, so a bounded block parser is sufficient
    and fails closed when a required field is absent.
    """

    text = (root / Path("docs/design/CONTROL_REGISTRY.yaml")).read_text(encoding="utf-8")
    blocks = re.finditer(r"(?ms)^  - id:\s*(?P<id>\S+)\s*\n(?P<body>.*?)(?=^  - id:|\Z)", text)
    metadata: dict[str, dict[str, str]] = {}
    for match in blocks:
        body = match.group("body")
        applicability = re.search(r"^[ \t]+applicability:\s*(\S+)\s*$", body, flags=re.MULTILINE)
        current_slice_required = re.search(
            r"^[ \t]+current_slice_required:\s*(\S+)\s*$",
            body,
            flags=re.MULTILINE,
        )
        metadata[match.group("id")] = {
            "applicability": applicability.group(1) if applicability else "",
            "current_slice_required": current_slice_required.group(1) if current_slice_required else "",
        }
    return metadata


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
        raise ValueError(f"L7 release self-test could not run: {exc}") from exc
    if result.returncode != 0:
        detail = (result.stdout + result.stderr).strip().replace("\n", " | ")
        raise ValueError(f"L7 release self-test failed: {detail[:1_000]}")
    lines = result.stdout.splitlines()
    required_markers = [f"PASS {case}" for case in EXPECTED_CT_IDS] + ["PASS SUPPLEMENTAL-ARCHIVE", "PASS NEGATIVE"]
    missing = [marker for marker in required_markers if marker not in lines]
    summaries = [line for line in lines if line.startswith("L7_RELEASE_SELFTEST=PASS cases=")]
    if missing or len(summaries) != 1:
        raise ValueError("L7 release self-test omitted required pass markers")
    try:
        case_count = int(summaries[0].rsplit("=", 1)[1])
    except ValueError as exc:
        raise ValueError("L7 release self-test case count is malformed") from exc
    if case_count < len(required_markers):
        raise ValueError("L7 release self-test case count is incomplete")
    return [line for line in lines if line.startswith(("PASS ", "L7_RELEASE_"))]


def _run_import_smoke(root: Path) -> None:
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            "import docs.orchestration.l7_release_contract as contract; assert contract.CacheState.PURGED.value == 'PURGED'; assert contract.AuthorityState.EXECUTED.value == 'EXECUTED'",
        ],
        cwd=root,
        text=True,
        capture_output=True,
        timeout=30,
        check=False,
    )
    if result.returncode != 0:
        detail = (result.stdout + result.stderr).strip().replace("\n", " | ")
        raise ValueError(f"L7 release package import smoke failed: {detail[:1_000]}")


def validate_manifest(root: Path, *, run_selftest: bool = True) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    output: list[str] = []
    manifest = _load_manifest(root)
    required_identity = {
        "schema_version": 1,
        "manifest_id": "cineforge-l7-release-contract",
        "lane_id": "L7",
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
    expected_artifacts = {
        "source_artifact": "docs/orchestration/l7_release_contract.py",
        "selftest_artifact": "docs/orchestration/l7_release_selftest.py",
        "gate_artifact": "docs/orchestration/l7_release_gate.py",
        "gate_selftest_artifact": "docs/orchestration/l7_release_gate_selftest.py",
    }
    for key, expected in expected_artifacts.items():
        if manifest.get(key) != expected:
            errors.append(f"manifest {key} must be {expected!r}")

    if manifest.get("required_chaos_ids") != EXPECTED_CT_IDS:
        errors.append("required_chaos_ids must exactly enumerate CT-29..CT-34, CT-38 and CT-40")
    if manifest.get("required_control_ids") != EXPECTED_CONTROL_IDS:
        errors.append("required_control_ids must exactly enumerate the direct V1 L7 controls")
    if manifest.get("inherited_control_ids") != EXPECTED_INHERITED_CONTROL_IDS:
        errors.append("inherited_control_ids must exactly enumerate the L4/L5 release dependencies")
    if manifest.get("inherited_control_sources") != EXPECTED_INHERITED_CONTROL_SOURCES:
        errors.append("inherited_control_sources must bind every inherited control to its prerequisite lane")
    if manifest.get("supplemental_control_ids") != EXPECTED_SUPPLEMENTAL_CONTROL_IDS:
        errors.append("supplemental_control_ids must exactly enumerate future/optional controls")
    if manifest.get("control_scope_note") != EXPECTED_CONTROL_SCOPE_NOTE:
        errors.append("control_scope_note must state the L7 applicability and inheritance boundary")
    try:
        chaos_ids = _chaos_ids(root)
        controls = _control_ids(root)
        control_metadata = _control_metadata(root)
        if set(EXPECTED_CT_IDS) - chaos_ids:
            errors.append("CHAOS_TEST_PLAN.md is missing one or more L7 chaos cases")
        expected_controls = set(EXPECTED_CONTROL_IDS) | set(EXPECTED_INHERITED_CONTROL_IDS) | set(EXPECTED_SUPPLEMENTAL_CONTROL_IDS)
        if expected_controls - controls:
            errors.append("CONTROL_REGISTRY.yaml is missing one or more L7 applicability controls")
        for control_id, (applicability, current_slice_required) in EXPECTED_L7_APPLICABILITY.items():
            metadata = control_metadata.get(control_id, {})
            if metadata.get("applicability") != applicability:
                errors.append(f"{control_id} must retain applicability={applicability}")
            if metadata.get("current_slice_required") != current_slice_required:
                errors.append(
                    f"{control_id} must retain current_slice_required={current_slice_required}"
                )
        for control_id in EXPECTED_SUPPLEMENTAL_CONTROL_IDS:
            metadata = control_metadata.get(control_id, {})
            if metadata.get("applicability") != EXPECTED_SUPPLEMENTAL_APPLICABILITY[control_id]:
                errors.append(f"{control_id} must retain its registered applicability")
            if metadata.get("current_slice_required") != "false":
                errors.append(f"{control_id} must remain non-required for the current slice")
    except (OSError, UnicodeError) as exc:
        errors.append(f"cannot read L7 authority registries: {exc}")

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
        errors.append("forbidden_claims must retain every L7 non-claim boundary")
    source_path = artifacts.get("source_artifact")
    if source_path is not None:
        source = " ".join(source_path.read_text(encoding="utf-8").split())
        for phrase in ("not the CineForge product runtime", "does not enforce real rights", "no fixture is production proof"):
            if phrase not in source:
                errors.append(f"reference source must explicitly state: {phrase}")

    if errors:
        return errors, output
    if run_selftest:
        try:
            _run_import_smoke(root)
            markers = _run_selftest(root, artifacts["selftest_artifact"])
        except (OSError, UnicodeError, ValueError, subprocess.SubprocessError) as exc:
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
        print("L7_RELEASE_GATE=FAIL")
        for error in errors:
            print(f"ERROR: {error}")
        return 1
    print("L7_RELEASE_GATE=PASS")
    for line in output:
        print(line)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
