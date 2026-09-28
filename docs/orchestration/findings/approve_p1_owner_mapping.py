#!/usr/bin/env python3
"""Approve the reviewed P1 design-owner map and update the canonical ledgers.

``build_p1_owner_mapping.py`` is intentionally conservative and emits review
leads.  This script is the separate lead-review step: it verifies that every
selected PARTIAL row has one exact owner reference, applies the few semantic
corrections recorded below, and then transitions the row to
``DESIGN_COVERED``.  The transition says that the architecture has an owner
and a required test obligation; it never creates empirical or runtime
evidence.  Registry and coverage files are updated together so the document
lint gate remains the single consistency check.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[3]
COVERAGE_PATH = ROOT / "docs/orchestration/findings/COVERAGE.json"
REGISTRY_PATH = ROOT / "docs/orchestration/findings/REGISTRY.json"
MAPPING_PATH = ROOT / "docs/orchestration/findings/P1_PARTIAL_OWNER_MAPPING.json"
APPROVAL_PATH = ROOT / "docs/orchestration/findings/P1_OWNER_MAPPING_APPROVAL.json"

# The lexical mapper is deliberately conservative.  These lead-reviewed
# corrections select the narrower contract when a generic lease/test heading
# outranked the actual semantic owner.
OWNER_OVERRIDES = {
    "CFRT-0A9FD1C18BDD": "docs/design/EXTREME_HARDENING_CONTRACTS.md#B4",  # migration execution/completion
    "CFRT-1448A474A038": "docs/design/EXTREME_HARDENING_CONTRACTS.md#IL",  # model worker activation
    "CFRT-2121F6683815": "docs/design/EXTREME_HARDENING_CONTRACTS.md#OD",  # capability certification tier
    "CFRT-235A012D7929": "docs/design/EXTREME_HARDENING_CONTRACTS.md#LU",  # run-end evidence confidence
    "CFRT-251C42C5CEE1": "docs/design/EXTREME_HARDENING_CONTRACTS.md#ZJC",  # actor/device/session identity
    "CFRT-298D97B44911": "docs/design/EXTREME_HARDENING_CONTRACTS.md#MK",  # exploration/coverage budget
    "CFRT-306A677F2EFE": "docs/design/SCHEMA.md#SCHEMA-LEARNING-FEEDBACK-PROVENANCE-EVALUATION-CONTEXT",  # evaluation context snapshot
    "CFRT-31AE0CFC6CB8": "docs/design/SCHEMA.md#73",  # live-action multicam/sync evidence
    "CFRT-07EE949877B5": "docs/design/EXTREME_HARDENING_CONTRACTS.md#DE",  # structured logs/notifications
    "CFRT-093261BBC84A": "docs/design/EXTREME_HARDENING_CONTRACTS.md#OI",  # local execution epoch ordering
    "CFRT-09DF18447A4D": "docs/design/EXTREME_HARDENING_CONTRACTS.md#N2",  # dependency protection lease
    "CFRT-2E7E0A92ED1F": "docs/design/EXTREME_HARDENING_CONTRACTS.md#CF",  # projection generation after recovery
    "CFRT-3B54AA77FBFC": "docs/design/EXTREME_HARDENING_CONTRACTS.md#BI",  # resource reservation lifecycle
    "CFRT-3E88E87F79A3": "docs/design/EXTREME_HARDENING_CONTRACTS.md#D4",  # egress manifest authority
    "CFRT-50C254AB4887": "docs/design/EXTREME_HARDENING_CONTRACTS.md#JM",  # bounded observability pipeline
    "CFRT-5E9B381FF713": "docs/design/EXTREME_HARDENING_CONTRACTS.md#B3",  # SQLite health/WAL governor
    "CFRT-61BFEA21437D": "docs/design/EXTREME_HARDENING_CONTRACTS.md#CP",  # dedup privacy boundary
    "CFRT-71004FABAE0C": "docs/design/EXTREME_HARDENING_CONTRACTS.md#C6",  # provider materialization
    "CFRT-7841E47DE86B": "docs/design/EXTREME_HARDENING_CONTRACTS.md#DF",  # directory/resource bombs
    "CFRT-8E5E442079B2": "docs/design/EXTREME_HARDENING_CONTRACTS.md#JR",  # connector receipt redaction
    "CFRT-BAC851FDB2C6": "docs/design/EXTREME_HARDENING_CONTRACTS.md#N13",  # package acquisition ceilings
    "CFRT-75B2751201CE": "docs/design/EXTREME_HARDENING_CONTRACTS.md#DW",  # encrypted export metadata policy
    "CFRT-2E7E0A92ED1F": "docs/design/EXTREME_HARDENING_CONTRACTS.md#CF",  # projection generation after recovery
    "CFRT-3B54AA77FBFC": "docs/design/EXTREME_HARDENING_CONTRACTS.md#BI",  # resource reservation lifecycle
    "CFRT-3E567164EEC7": "docs/design/API_CONTRACTS.md#API-NUMERIC-01",  # checked domain bounds
    "CFRT-3E88E87F79A3": "docs/design/EXTREME_HARDENING_CONTRACTS.md#D4",  # egress manifest authority
    "CFRT-420376498756": "docs/architecture/FINAL_ARCHITECTURE.md#70",  # released-history retcon policy
    "CFRT-50E04BF3D732": "docs/design/EXTREME_HARDENING_CONTRACTS.md#T1",  # projection generation activation
    "CFRT-5C1AE21C0683": "docs/design/EXTREME_HARDENING_CONTRACTS.md#GZ",  # locale-independent canonical form
    "CFRT-8CD55ED363E0": "docs/design/API_CONTRACTS.md#API-MEDIA-TIME-01",  # timing evidence
    "CFRT-90704B81FB7A": "docs/orchestration/CONTEXT_MANIFEST_AND_DOC_LINT.md#11",  # mandatory-section truncation
    "CFRT-B8953FD37855": "docs/design/API_CONTRACTS.md#22",  # connector output normalization
    "CFRT-B8DE0113D728": "docs/design/EXTREME_HARDENING_CONTRACTS.md#FQ",  # honest deletion classes
    "CFRT-BC3911E0BA06": "docs/design/EXTREME_HARDENING_CONTRACTS.md#N7",  # crypto-erasure/purge graph
    "CFRT-CDE08BEA14ED": "docs/design/EXTREME_HARDENING_CONTRACTS.md#DL3",  # provider credit units
    "CFRT-CC0194234068": "docs/design/EXTREME_HARDENING_CONTRACTS.md#ZHT",  # trusted duration/evidence hierarchy
    "CFRT-D3BDDB0352B0": "docs/design/EXTREME_HARDENING_CONTRACTS.md#MM",  # learning taint propagation
    "CFRT-D7DF31C1AA56": "docs/design/SCHEMA.md#SCHEMA-LEARNING-FEEDBACK-PROVENANCE-EVALUATION-CONTEXT",  # stratified evaluation context
    "CFRT-E33A3085A800": "docs/design/EXTREME_HARDENING_CONTRACTS.md#JF",  # overlapping dialogue timing
    "CFRT-E8032D07F29A": "docs/design/EXTREME_HARDENING_CONTRACTS.md#C5",  # hostile parser re-entry
    "CFRT-E8EB73C2F0F3": "docs/design/EXTREME_HARDENING_CONTRACTS.md#GX",  # envelope key hierarchy
    "CFRT-ECE07B264D55": "docs/design/EXTREME_HARDENING_CONTRACTS.md#ED",  # GC crash/reconciliation
    "CFRT-FC46109454C6": "docs/design/EXTREME_HARDENING_CONTRACTS.md#ZIQ",  # critical read-after-write
}

# The twelve lower-severity rows were outside the original P0/P1 bootstrap.
# They are now explicitly owned so the global architecture ledger has no
# hidden uncovered tail.  Design-only threat boundaries intentionally carry no
# runtime chaos ID; implementation and OS-integration evidence remain open.
LOWER_SEVERITY_OWNERS = {
    "CFRT-AB72CEB9781D": "docs/design/EXTREME_HARDENING_CONTRACTS.md#AE3",
    "CFRT-05A5117066AE": "docs/design/EXTREME_HARDENING_CONTRACTS.md#CC",
    "CFRT-720A170D6118": "docs/design/EXTREME_HARDENING_CONTRACTS.md#FW",
    "CFRT-AF79EC7DEFFA": "docs/architecture/FINAL_ARCHITECTURE.md#75",
    "CFRT-A03313AA49FE": "docs/design/EXTREME_HARDENING_CONTRACTS.md#DN",
    "CFRT-B3C25D1DFE9D": "docs/design/EXTREME_HARDENING_CONTRACTS.md#DR",
    "CFRT-78940DDEF4A2": "docs/design/EXTREME_HARDENING_CONTRACTS.md#V1",
    "CFRT-309C531910E7": "docs/design/EXTREME_HARDENING_CONTRACTS.md#FW",
    "CFRT-74BA877E4D01": "docs/orchestration/CONTEXT_MANIFEST_AND_DOC_LINT.md#8",
    "CFRT-7DF5B0D72CBC": "docs/orchestration/CONTEXT_MANIFEST_AND_DOC_LINT.md#10",
    "CFRT-BAC331BA37E5": "docs/design/EXTREME_HARDENING_CONTRACTS.md#KX",
    "CFRT-D15BD8EF69A4": "docs/design/UI_COMPONENT_SYSTEM.md#UI-PROTECTED-ENCRYPTED-DOCUMENT",
}


def digest(path: Path) -> str:
    return "sha256:" + hashlib.sha256(path.read_bytes()).hexdigest()


def load(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def ref_parts(ref: str) -> tuple[str, str]:
    if ref.count("#") != 1:
        raise ValueError(f"malformed owner reference: {ref!r}")
    path, section = ref.split("#", 1)
    if not path or not section:
        raise ValueError(f"malformed owner reference: {ref!r}")
    return path, section


def validate_owner_refs(mapping: dict[str, Any], root: Path) -> None:
    sys.path.insert(0, str(root / "docs/orchestration"))
    import doc_lint  # type: ignore

    sections, errors = doc_lint.collect_sections(root)
    if errors:
        raise ValueError("authoritative section identity errors: " + "; ".join(errors))
    reviewed: dict[str, str | None] = {
        entry["stable_id"]: OWNER_OVERRIDES.get(entry["stable_id"], entry.get("owner_ref"))
        for entry in mapping["findings"]
    }
    # Lower-severity closure rows are outside the 474-row P1 mapping artifact,
    # but they are written into the same canonical ledgers.  Validate them
    # against the exact same authoritative heading index before mutation.
    reviewed.update(LOWER_SEVERITY_OWNERS)
    for stable_id, ref in reviewed.items():
        if not ref:
            raise ValueError(f"no reviewed owner for {stable_id}")
        path, section = ref_parts(ref)
        locations = sections.get(path, {}).get(section, [])
        if not locations:
            locations = sections.get(path, {}).get(f"@slug:{section.lower()}", [])
        if len(locations) != 1:
            raise ValueError(f"owner {ref} resolves {len(locations)} times for {stable_id}")


def update(root: Path) -> dict[str, Any]:
    pre_coverage_sha = digest(COVERAGE_PATH)
    pre_registry_sha = digest(REGISTRY_PATH)
    coverage = load(COVERAGE_PATH)
    registry = load(REGISTRY_PATH)
    mapping = load(MAPPING_PATH)
    if mapping.get("scope", {}).get("selected_count") != 474:
        raise ValueError("mapping artifact no longer represents the expected 474-row review set")
    validate_owner_refs(mapping, root)

    coverage_by_id = {row["stable_id"]: row for row in coverage["findings"]}
    registry_by_id = {row["stable_id"]: row for row in registry["findings"]}
    mapped_ids: set[str] = set()
    for entry in mapping["findings"]:
        stable_id = entry["stable_id"]
        row = coverage_by_id.get(stable_id)
        reg = registry_by_id.get(stable_id)
        if row is None or reg is None:
            raise ValueError(f"mapping row is absent from canonical ledgers: {stable_id}")
        if row.get("coverage_state") != "PARTIAL" or row.get("control_owner_path") or row.get("control_owner_section_id"):
            raise ValueError(f"mapping row is not an unowned PARTIAL record: {stable_id}")
        ref = OWNER_OVERRIDES.get(stable_id, entry.get("owner_ref"))
        path, section = ref_parts(ref)
        row["control_owner_path"] = path
        row["control_owner_section_id"] = section
        support = list(dict.fromkeys([*row.get("supporting_owner_paths", []), path]))
        row["supporting_owner_paths"] = [item for item in support if item != path]
        row["coverage_state"] = "DESIGN_COVERED"
        row["residual_state"] = "OPEN_UNVERIFIED"
        row["empirical_status"] = "NOT_RUN"
        row["notes"] = (
            f"Design owner approved from P1 mapping review: {ref}. "
            "The contract is design-covered; required negative/chaos tests and independent runtime evidence remain NOT_RUN."
        )
        reg["coverage_state"] = "DESIGN_COVERED"
        mapped_ids.add(stable_id)

    for stable_id, ref in LOWER_SEVERITY_OWNERS.items():
        row = coverage_by_id.get(stable_id)
        reg = registry_by_id.get(stable_id)
        if row is None or reg is None:
            raise ValueError(f"lower-severity row is absent from canonical ledgers: {stable_id}")
        if row.get("coverage_state") != "UNCOVERED":
            raise ValueError(f"lower-severity row is not UNCOVERED: {stable_id}")
        path, section = ref_parts(ref)
        row["control_owner_path"] = path
        row["control_owner_section_id"] = section
        row["supporting_owner_paths"] = [item for item in row.get("supporting_owner_paths", []) if item != path]
        row["coverage_state"] = "DESIGN_COVERED"
        row["residual_state"] = "OPEN_UNVERIFIED"
        row["empirical_status"] = "NOT_RUN"
        row["required_negative_tests"] = [
            f"NEG-DESIGN-OWNER: verify the explicit contract boundary for {stable_id} at {ref}; reject ambiguity and preserve the audit explanation."
        ]
        row["required_chaos_tests"] = []
        row["notes"] = (
            f"Design owner approved from lower-severity closure review: {ref}. "
            "This is a design/threat-model disposition; implementation, platform and independent evidence remain NOT_RUN."
        )
        reg["coverage_state"] = "DESIGN_COVERED"
        mapped_ids.add(stable_id)

    if len(mapped_ids) != 486:
        raise ValueError(f"expected 486 mapped rows (474 P1 + 12 lower-severity), got {len(mapped_ids)}")

    all_rows = coverage["findings"]
    states = {state: sum(row.get("coverage_state") == state for row in all_rows) for state in (
        "UNCOVERED", "PARTIAL", "DESIGN_COVERED", "EMPIRICAL_TEST_REQUIRED", "RESIDUAL", "VERIFIED"
    )}
    residuals = {}
    for row in all_rows:
        residual = row.get("residual_state")
        if residual:
            residuals[residual] = residuals.get(residual, 0) + 1
    coverage["coverage_state_counts"] = states
    coverage["residual_state_counts"] = dict(sorted(residuals.items()))
    coverage["curated_exact_owner_mapping_count"] = sum(
        bool(row.get("control_owner_path") and row.get("control_owner_section_id")) for row in all_rows
    )
    coverage["p0_exact_owner_count"] = sum(
        bool("P0" in str(row.get("severity", "")) and row.get("control_owner_path") and row.get("control_owner_section_id"))
        for row in all_rows
    )
    coverage["p1_exact_owner_count"] = sum(
        bool("P1" in str(row.get("severity", "")) and row.get("control_owner_path") and row.get("control_owner_section_id"))
        for row in all_rows
    )
    p0 = [row for row in all_rows if "P0" in str(row.get("severity", ""))]
    p1 = [row for row in all_rows if "P1" in str(row.get("severity", ""))]
    coverage["p0_coverage_state_counts"] = {state: sum(row.get("coverage_state") == state for row in p0) for state in states}
    coverage["p1_coverage_state_counts"] = {state: sum(row.get("coverage_state") == state for row in p1) for state in states}
    coverage["p0_residual_state_counts"] = dict(sorted({s: sum(row.get("residual_state") == s for row in p0) for s in {row.get("residual_state") for row in p0}}.items()))
    coverage["p1_residual_state_counts"] = dict(sorted({s: sum(row.get("residual_state") == s for row in p1) for s in {row.get("residual_state") for row in p1}}.items()))

    COVERAGE_PATH.write_text(json.dumps(coverage, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    REGISTRY_PATH.write_text(json.dumps(registry, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    post_coverage_sha = digest(COVERAGE_PATH)
    post_registry_sha = digest(REGISTRY_PATH)
    approval = {
        "schema_version": 1,
        "artifact_id": "cineforge-p1-owner-mapping-approval",
        "source_mapping": MAPPING_PATH.relative_to(root).as_posix(),
        "source_mapping_sha256": digest(MAPPING_PATH),
        "pre_coverage_sha256": pre_coverage_sha,
        "pre_registry_sha256": pre_registry_sha,
        "post_coverage_sha256": post_coverage_sha,
        "post_registry_sha256": post_registry_sha,
        "approved_rows": len(mapped_ids),
        "transition": {
            "coverage_state": {"from": ["PARTIAL", "UNCOVERED"], "to": "DESIGN_COVERED"},
            "residual_state": {"from": ["OPEN_UNOWNED_PENDING_AUDIT", "UNASSESSED"], "to": "OPEN_UNVERIFIED"},
            "empirical_status": "NOT_RUN preserved",
        },
        "owner_resolution": "doc_lint exact unique section resolution",
        "runtime_or_empirical_claim": False,
        "review_note": "All canonical findings now have an explicit design owner; runtime implementation, chaos execution, independent review and production remain open.",
        "overrides": OWNER_OVERRIDES,
        "lower_severity_owners": LOWER_SEVERITY_OWNERS,
    }
    APPROVAL_PATH.write_text(json.dumps(approval, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    return {"mapped": len(mapped_ids), "states": states, "residuals": residuals}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    args = parser.parse_args(argv)
    try:
        result = update(args.root.resolve())
    except (OSError, UnicodeError, ValueError, KeyError, TypeError) as exc:
        print(f"P1_OWNER_MAPPING_APPROVAL=FAIL {exc}")
        return 1
    print(f"P1_OWNER_MAPPING_APPROVAL=PASS mapped={result['mapped']} states={json.dumps(result['states'], sort_keys=True)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
