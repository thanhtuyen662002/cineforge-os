#!/usr/bin/env python3
"""Merge-blocking documentation and finding-contract lint for CineForge.

The repository currently keeps the authoritative contracts in Markdown, while
the red-team corpus is intentionally evidence-only.  This checker is small on
purpose so it can run in bootstrap environments without third-party packages.
It validates the identities that make Context Manifest references safe; it
does not try to prove that a prose control is implemented. It also verifies
registry title hashes and that ledger source pointers still land on the stated
raw-evidence heading/line.

Usage:
    python docs/orchestration/doc_lint.py
    python docs/orchestration/doc_lint.py --root .
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import unicodedata
from collections import defaultdict
from pathlib import Path
from typing import Iterable


RAW_EVIDENCE = Path("docs/orchestration/EXTREME_FAILURE_STRESS_TEST_2026-09-26.md")
LEGACY_COVERAGE = Path("docs/orchestration/EXTREME_FINDING_COVERAGE_MATRIX.md")
COVERAGE_PATH = Path("docs/orchestration/findings/COVERAGE.json")
REGISTRY_PATH = Path("docs/orchestration/findings/REGISTRY.json")
CONTROL_REGISTRY_PATH = Path("docs/design/CONTROL_REGISTRY.yaml")
MIGRATION_PATH = Path("docs/orchestration/findings/AUTHORITATIVE_SECTION_ID_MIGRATION.md")
CHAOS_PATH = Path("docs/orchestration/CHAOS_TEST_PLAN.md")
CONTROL_EVENT_SCHEMA_PATH = Path("docs/orchestration/CONTROL_EVENT_CONTRACTS.json")
CONTROL_EVENT_DOC_PATH = Path("docs/orchestration/CONTROL_EVENT_CONTRACTS.md")
CONTROL_EVENT_SCHEMAS = {
    "AGENT_STATE_V1",
    "AGENT_TAKEOVER_V1",
    "AGENT_REVIEW_V1",
    "TASK_CONTRACT_REVISION_V1",
    "ORPHAN_OBSERVED_V1",
    "CLAIM_INTENT_V1",
    "CAPACITY_PLAN_V2",
    "SLOT_LEASE_V1",
    "CONTROL_ROLE_LEASE_V1",
    "MERGE_LEASE_V1",
    "CI_VERIFICATION_V1",
    "MERGE_OUTCOME_V1",
}

HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*$")
ANCHOR_RE = re.compile(r"\{#([A-Za-z0-9_.:-]+)\}\s*$")
# Numeric IDs, short legacy owner IDs (A1, ZHS), and explicit semantic IDs
# (CTRL-MERGE-OUTCOME) are stable identities.  Ordinary prose headings such as
# "AppShell" are deliberately not interpreted as IDs.
ID_RE = re.compile(
    r"^(?P<id>(?:\d+(?:\.\d+)*|[A-Z]{1,4}\d{1,4}|[A-Z]{1,4}\.|[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+))"
    r"(?:[.)]|\s|$)"
)
REF_RE = re.compile(
    r"(?P<path>(?:docs/|AGENTS\.md)[^\s)`\"'<>]+\.md)#(?P<id>[A-Za-z0-9_.:-]+)"
)
STABLE_ID_RE = re.compile(r"^CFRT-[0-9A-F]{12}$")
TITLE_HASH_RE = re.compile(r"^sha256:[0-9a-f]{64}$")
CONTROL_ID_RE = re.compile(r"^CF-[A-Z0-9]+(?:-[A-Z0-9]+)+$")
CHAOS_ID_RE = re.compile(r"\bCT-(?:0[1-9]|[1-3][0-9]|40)\b")
CHAOS_HEADING_RE = re.compile(r"^###\s+(CT-\d{2})\s+—\s+.+?\s*$")
CHAOS_FIELD_RE = re.compile(r"^[-*]\s+\*\*(.+?):\*\*")
REQUIRED_CHAOS_FIELDS = {
    "Preconditions",
    "Fault injection",
    "Expected invariant",
    "Expected state",
    "User-visible behavior",
    "Forbidden behavior",
    "Evidence required",
    "Cleanup/recovery",
}


def normalize_title(title: str) -> str:
    """Normalize a registry title without changing its human-visible text."""
    return " ".join(unicodedata.normalize("NFC", title).split())


def title_hash(title: str) -> str:
    return "sha256:" + hashlib.sha256(normalize_title(title).encode("utf-8")).hexdigest()


def contained_path(root: Path, relative: str) -> Path | None:
    """Resolve a repository-relative path without allowing traversal outside root."""
    candidate = (root / relative).resolve()
    try:
        candidate.relative_to(root.resolve())
    except ValueError:
        return None
    return candidate


def authoritative_markdown(root: Path) -> list[Path]:
    paths = [root / "AGENTS.md"]
    for directory in (root / "docs" / "orchestration", root / "docs" / "design", root / "docs" / "architecture"):
        if directory.exists():
            paths.extend(sorted(directory.rglob("*.md")))
    result: list[Path] = []
    for path in paths:
        relative = path.relative_to(root)
        if relative == RAW_EVIDENCE or relative == LEGACY_COVERAGE:
            # The stress corpus and deprecated matrix are retained as evidence,
            # but their repeated historical wave/Xnn labels are not contracts.
            continue
        if path.exists() and path not in result:
            result.append(path)
    return result


def section_id(title: str) -> str | None:
    anchor = ANCHOR_RE.search(title)
    if anchor:
        return anchor.group(1)
    title_without_anchor = ANCHOR_RE.sub("", title).strip()
    match = ID_RE.match(title_without_anchor)
    if not match:
        return None
    return match.group("id").rstrip(".")


def github_slug(title: str) -> str:
    """Return the common GitHub heading slug as a compatibility alias."""
    title = ANCHOR_RE.sub("", title).strip().lower()
    title = re.sub(r"[^a-z0-9 _-]", "", title)
    return re.sub(r"[- _]+", "-", title).strip("-")


def collect_sections(root: Path) -> tuple[dict[str, dict[str, list[int]]], list[str]]:
    sections: dict[str, dict[str, list[int]]] = {}
    errors: list[str] = []
    for path in authoritative_markdown(root):
        relative = path.relative_to(root).as_posix()
        ids: dict[str, list[int]] = defaultdict(list)
        for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            match = HEADING_RE.match(line)
            if not match:
                continue
            identifier = section_id(match.group(2))
            # Numeric prose headings below H1 (for example "## 5 slots") are
            # local narrative labels, not cross-document contract identities.
            # Explicit anchors and alphanumeric/semantic owner IDs remain
            # addressable at any depth.
            if len(match.group(1)) > 1 and identifier and identifier[0].isdigit() and not ANCHOR_RE.search(match.group(2)):
                identifier = None
            if identifier:
                ids[identifier].append(line_number)
            # Existing documents contain a few GitHub-native slug references.
            # Keep the stable token above as the canonical identity, while
            # accepting a slug only when it resolves to one heading.
            slug = github_slug(match.group(2))
            if slug and slug != identifier:
                ids[f"@slug:{slug}"].append(line_number)
        sections[relative] = dict(ids)
        for identifier, locations in ids.items():
            if identifier.startswith("@slug:"):
                continue
            if len(locations) > 1:
                errors.append(
                    f"duplicate active section ID {relative}#{identifier} at lines {','.join(map(str, locations))}"
                )
    return sections, errors


def lint_references(root: Path, sections: dict[str, dict[str, list[int]]]) -> list[str]:
    errors: list[str] = []
    scan_files = authoritative_markdown(root)
    # Migration maps are intentionally included: a stale replacement reference
    # must fail the same way as a stale Context Manifest reference.
    for path in scan_files:
        relative = path.relative_to(root).as_posix()
        text = path.read_text(encoding="utf-8")
        for match in REF_RE.finditer(text):
            referenced_path = match.group("path").rstrip(".,;:)")
            identifier = match.group("id").rstrip(".,;:)")
            resolved_path = contained_path(root, referenced_path)
            canonical_path = (
                resolved_path.relative_to(root).as_posix()
                if resolved_path is not None
                else None
            )
            target = sections.get(canonical_path or referenced_path)
            if target is None:
                # References to a file outside the authoritative scan are still
                # checked for existence when they name a repository path.
                if resolved_path is None or not resolved_path.exists():
                    errors.append(f"broken reference in {relative}: {referenced_path}#{identifier} (missing path)")
                continue
            locations = target.get(identifier, [])
            if not locations:
                locations = target.get(f"@slug:{identifier.lower()}", [])
            if len(locations) != 1:
                errors.append(
                    f"broken reference in {relative}: {referenced_path}#{identifier} "
                    f"(expected one active section, found {len(locations)})"
                )
    return errors


def lint_chaos_plan(root: Path) -> tuple[list[str], set[str]]:
    """Validate the executable chaos-spec shape and return its case IDs."""
    path = root / CHAOS_PATH
    if not path.exists():
        return [f"missing chaos specification: {CHAOS_PATH.as_posix()}"], set()
    lines = path.read_text(encoding="utf-8").splitlines()
    headings: list[tuple[str, int]] = []
    for line_number, line in enumerate(lines, 1):
        match = CHAOS_HEADING_RE.match(line)
        if match:
            headings.append((match.group(1), line_number))
    errors: list[str] = []
    ids = [identifier for identifier, _ in headings]
    expected = {f"CT-{index:02d}" for index in range(1, 41)}
    duplicates = sorted(identifier for identifier in set(ids) if ids.count(identifier) > 1)
    if duplicates:
        errors.append(f"duplicate chaos case IDs: {','.join(duplicates)}")
    missing = sorted(expected - set(ids))
    if missing:
        errors.append(f"missing chaos case IDs: {','.join(missing)}")
    unexpected = sorted(set(ids) - expected)
    if unexpected:
        errors.append(f"unexpected chaos case IDs: {','.join(unexpected)}")
    for index, (identifier, line_number) in enumerate(headings):
        end = headings[index + 1][1] - 1 if index + 1 < len(headings) else len(lines)
        fields = [
            match.group(1).strip()
            for line in lines[line_number:end]
            if (match := CHAOS_FIELD_RE.match(line))
        ]
        missing_fields = sorted(REQUIRED_CHAOS_FIELDS - set(fields))
        duplicate_fields = sorted(field for field in set(fields) if fields.count(field) > 1)
        if missing_fields:
            errors.append(f"{identifier} at line {line_number} missing fields: {','.join(missing_fields)}")
        if duplicate_fields:
            errors.append(f"{identifier} at line {line_number} repeats fields: {','.join(duplicate_fields)}")
    return errors, set(ids)


def lint_control_event_schema(root: Path, sections: dict[str, dict[str, list[int]]]) -> list[str]:
    """Validate the machine-readable control-event contract index.

    The executable parser performs the detailed field validation.  This
    lightweight repository gate catches accidental deletion, event-set drift,
    malformed regex metadata and loss of the normative companion document
    before the parser is ever invoked by a runtime caller.
    """
    schema_path = root / CONTROL_EVENT_SCHEMA_PATH
    doc_path = root / CONTROL_EVENT_DOC_PATH
    errors: list[str] = []
    if not schema_path.exists():
        errors.append(f"missing control-event schema: {CONTROL_EVENT_SCHEMA_PATH.as_posix()}")
        return errors
    if not doc_path.exists():
        errors.append(f"missing control-event contract document: {CONTROL_EVENT_DOC_PATH.as_posix()}")
    try:
        schema = json.loads(schema_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        return errors + [f"invalid control-event schema JSON: {exc}"]
    if not isinstance(schema, dict):
        return errors + ["control-event schema root must be an object"]
    if schema.get("schema_id") != "cineforge-control-event-contracts":
        errors.append("control-event schema has unsupported schema_id")
    if schema.get("schema_version") != 1:
        errors.append("control-event schema_version must be 1")
    if schema.get("encoding") != "UTF-8":
        errors.append("control-event schema encoding must be UTF-8")
    if schema.get("machine_key_pattern") != r"^[A-Z][A-Z0-9_]{0,63}$":
        errors.append("control-event schema machine_key_pattern is unsupported")
    if schema.get("max_event_bytes") != 32768 or schema.get("max_line_bytes") != 4096:
        errors.append("control-event schema size limits drifted from the bounded grammar")
    hashing = schema.get("hashing")
    if not isinstance(hashing, dict) or hashing.get("algorithm") != "SHA-256":
        errors.append("control-event schema must use SHA-256")
    envelope = schema.get("envelope")
    envelope_fields = envelope.get("fields") if isinstance(envelope, dict) else None
    envelope_required = envelope.get("required") if isinstance(envelope, dict) else None
    expected_envelope = {
        "EVENT_SCHEMA",
        "CONTROL_EVENT_ID",
        "CONTROL_EPOCH",
        "PREV_EVENT_COMMENT_ID",
        "PREV_EVENT_HASH",
        "EVENT_HASH_ALGORITHM",
        "EVENT_HASH",
        "TRUSTED_AUTHOR",
    }
    if not isinstance(envelope_fields, dict) or set(envelope_fields) != expected_envelope:
        errors.append("control-event envelope fields drifted")
    if not isinstance(envelope_required, list) or set(envelope_required) != expected_envelope:
        errors.append("control-event envelope required fields drifted")
    events = schema.get("events")
    if not isinstance(events, dict) or set(events) != CONTROL_EVENT_SCHEMAS:
        errors.append("control-event event schema set drifted")
    else:
        for event_name, definition in events.items():
            if not isinstance(definition, dict):
                errors.append(f"control-event {event_name} definition is not an object")
                continue
            required = definition.get("required")
            fields = definition.get("fields")
            if not isinstance(required, list) or not isinstance(fields, dict) or set(required) != set(fields):
                errors.append(f"control-event {event_name} required/fields mismatch")
            if any(not isinstance(field, str) or not re.fullmatch(r"[A-Z][A-Z0-9_]{0,63}", field) for field in fields or {}):
                errors.append(f"control-event {event_name} has a non-ASCII/invalid field key")
            if isinstance(fields, dict):
                for field, rule in fields.items():
                    if not isinstance(rule, dict) or ("format" not in rule and "enum" not in rule):
                        errors.append(f"control-event {event_name} field {field} has no validation rule")
    required_doc_sections = {
        "CTRL-EVENT-GRAMMAR",
        "CTRL-EVENT-ENVELOPE",
        "CTRL-EVENT-HASH",
        "CTRL-EVENT-PAYLOADS",
        "CTRL-EVENT-RECONCILIATION",
        "CTRL-EVENT-VALIDATION-BOUNDARY",
    }
    document_sections = sections.get(CONTROL_EVENT_DOC_PATH.as_posix(), {})
    for identifier in sorted(required_doc_sections):
        if len(document_sections.get(identifier, [])) != 1:
            errors.append(f"control-event contract document is missing unique section {identifier}")
    return errors


def lint_source_evidence(root: Path, records: list[dict]) -> list[str]:
    """Ensure each ledger pointer still identifies its raw evidence line."""
    errors: list[str] = []
    line_cache: dict[Path, list[str]] = {}
    heading_cache: dict[Path, list[tuple[int, int, str]]] = {}
    for record in records:
        stable_id = record.get("stable_id")
        source = record.get("source_evidence")
        if not isinstance(source, dict):
            continue
        source_path = source.get("path")
        line_number = source.get("line")
        if isinstance(line_number, bool) or not isinstance(line_number, int) or line_number < 1:
            errors.append(f"coverage {stable_id!r} source line must be a positive integer")
            continue
        path = contained_path(root, str(source_path))
        if path is None:
            errors.append(f"coverage {stable_id!r} source path escapes repository: {source_path!r}")
            continue
        if not path.exists():
            continue
        if path not in line_cache:
            try:
                lines = path.read_text(encoding="utf-8").splitlines()
            except (OSError, UnicodeError) as exc:
                errors.append(f"coverage {stable_id!r} source evidence cannot be read: {exc}")
                continue
            line_cache[path] = lines
            headings: list[tuple[int, int, str]] = []
            for candidate_line, candidate in enumerate(lines, 1):
                heading = HEADING_RE.match(candidate)
                if heading:
                    headings.append((candidate_line, len(heading.group(1)), normalize_title(heading.group(2))))
            heading_cache[path] = headings
        lines = line_cache[path]
        if line_number > len(lines):
            errors.append(f"coverage {stable_id!r} source line is outside {source_path}: {line_number}")
            continue
        line = lines[line_number - 1]
        legacy_id = source.get("legacy_id")
        if legacy_id and str(legacy_id) not in line:
            errors.append(f"coverage {stable_id!r} source line does not contain legacy_id {legacy_id!r}")
        section = source.get("section")
        if not section:
            continue
        expected_section = normalize_title(str(section))
        source_heading = HEADING_RE.match(line)
        if source_heading:
            source_level = len(source_heading.group(1))
            source_title = normalize_title(source_heading.group(2))
            parent = next(
                (
                    candidate
                    for candidate in reversed(heading_cache[path])
                    if candidate[0] < line_number and candidate[1] < source_level
                ),
                None,
            )
            section_matches = source_title == expected_section or (parent is not None and parent[2] == expected_section)
        else:
            section_matches = any(
                candidate[0] <= line_number and candidate[2] == expected_section
                for candidate in heading_cache[path]
            )
        if not section_matches:
            errors.append(f"coverage {stable_id!r} source section is not found before line {line_number}: {section!r}")
    return errors


def lint_control_registry(root: Path, sections: dict[str, dict[str, list[int]]]) -> list[str]:
    """Validate the repository's deliberately small, dependency-free YAML index."""
    path = root / CONTROL_REGISTRY_PATH
    if not path.exists():
        return [f"missing control registry: {CONTROL_REGISTRY_PATH.as_posix()}"]
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeError) as exc:
        return [f"control registry cannot be read: {exc}"]
    controls: list[dict[str, str]] = []
    current: dict[str, str] | None = None
    for line_number, line in enumerate(lines, 1):
        control_start = re.match(r"^\s{2}-\s+id:\s*(\S+)\s*$", line)
        if control_start:
            if current is not None:
                controls.append(current)
            current = {"id": control_start.group(1), "_line": str(line_number)}
            continue
        if current is None:
            continue
        field = re.match(r"^\s{4}([a-z][a-z0-9_]*)\s*:\s*(.*?)\s*$", line)
        if field:
            current[field.group(1)] = field.group(2).strip().strip('"\'')
    if current is not None:
        controls.append(current)
    errors: list[str] = []
    if not controls:
        errors.append("control registry has no controls")
        return errors
    ids = [control.get("id", "") for control in controls]
    if len(ids) != len(set(ids)):
        errors.append("control registry has duplicate control IDs")
    allowed_applicability = {
        "V1_FOUNDATION",
        "V1_BEFORE_RELEASE",
        "SCALE_HARDENING",
        "FUTURE_MULTIUSER",
        "OPTIONAL_HIGH_SECURITY",
    }
    allowed_maturity = {
        "DESIGNED",
        "SPECIFIED",
        "IMPLEMENTED",
        "AUTOMATED_TESTED",
        "CHAOS_TESTED",
        "PRODUCTION_PROVEN",
    }
    for control in controls:
        identifier = control.get("id", "")
        line_number = control.get("_line", "?")
        if not CONTROL_ID_RE.fullmatch(identifier):
            errors.append(f"control registry invalid ID at line {line_number}: {identifier!r}")
        owner = control.get("owner")
        if not owner:
            errors.append(f"control registry {identifier} has no owner")
        else:
            owner_path = contained_path(root, owner)
            if owner_path is None or not owner_path.exists():
                errors.append(f"control registry {identifier} owner path is missing: {owner}")
            elif owner not in sections:
                errors.append(f"control registry {identifier} owner is not authoritative Markdown: {owner}")
        if control.get("applicability") not in allowed_applicability:
            errors.append(f"control registry {identifier} has invalid applicability")
        maturity = control.get("maturity")
        if maturity not in allowed_maturity:
            errors.append(f"control registry {identifier} has invalid maturity")
        if control.get("current_slice_required") not in {"true", "false"}:
            errors.append(f"control registry {identifier} current_slice_required must be boolean")
        if maturity in {"IMPLEMENTED", "AUTOMATED_TESTED", "CHAOS_TESTED", "PRODUCTION_PROVEN"} and not (
            control.get("evidence") or control.get("evidence_link") or control.get("evidence_links")
        ):
            errors.append(f"control registry {identifier} claims {maturity} without evidence")
    return errors


def lint_registry_and_coverage(
    root: Path,
    sections: dict[str, dict[str, list[int]]],
    chaos_ids: set[str],
) -> list[str]:
    errors: list[str] = []
    registry_file = root / REGISTRY_PATH
    if not registry_file.exists():
        return [f"missing canonical finding registry: {REGISTRY_PATH.as_posix()}"]
    try:
        registry = json.loads(registry_file.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        return [f"invalid JSON in {REGISTRY_PATH.as_posix()}: {exc}"]
    findings = registry.get("findings")
    if not isinstance(findings, list):
        errors.append("registry findings must be an array")
        return errors
    registry_ids = [item.get("stable_id") for item in findings if isinstance(item, dict)]
    if len(registry_ids) != len(set(registry_ids)):
        errors.append("canonical finding stable_id collision")
    for stable_id in registry_ids:
        if not isinstance(stable_id, str) or not STABLE_ID_RE.fullmatch(stable_id):
            errors.append(f"invalid canonical stable_id: {stable_id!r}")
    if registry.get("finding_count") != len(findings):
        errors.append("registry finding_count does not match findings array")
    if registry.get("title_hash_rule") != "sha256:<normalized-title-UTF-8>":
        errors.append("registry title_hash_rule is missing or unsupported")
    if registry.get("title_hash_algorithm") != "SHA-256":
        errors.append("registry title_hash_algorithm is missing or unsupported")
    for item in findings:
        if not isinstance(item, dict):
            errors.append("registry finding is not an object")
            continue
        expected_hash = title_hash(str(item.get("title", "")))
        actual_hash = item.get("title_hash")
        if not isinstance(actual_hash, str) or not TITLE_HASH_RE.fullmatch(actual_hash):
            errors.append(f"registry {item.get('stable_id')!r} has invalid title_hash")
        elif actual_hash != expected_hash:
            errors.append(f"registry {item.get('stable_id')!r} title_hash does not match normalized title")
    if any("P0" in str(item.get("severity", "")) and item.get("domain") == "GEN" for item in findings):
        errors.append("P0 finding remains in generic GEN domain")
    if any(
        "P0" in str(item.get("severity", ""))
        and item.get("coverage_state") == "NEEDS_COVERAGE_REVIEW"
        for item in findings
    ):
        errors.append("P0 finding remains NEEDS_COVERAGE_REVIEW in the registry")

    coverage_file = root / COVERAGE_PATH
    if not coverage_file.exists():
        return errors + [f"missing canonical coverage ledger: {COVERAGE_PATH.as_posix()}"]
    try:
        coverage = json.loads(coverage_file.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        return errors + [f"invalid JSON in {COVERAGE_PATH.as_posix()}: {exc}"]
    # `findings` is the canonical array.  `records` is accepted for one-way
    # compatibility with early bootstrap ledgers, but a duplicate array is not
    # required and must never become a second source of truth.
    records = coverage.get("findings", coverage.get("records"))
    if not isinstance(records, list):
        return errors + ["coverage records must be an array"]
    if coverage.get("source_registry_revision") != registry.get("registry_revision"):
        errors.append("coverage source_registry_revision does not match registry revision")
    if coverage.get("finding_count") != len(records):
        errors.append("coverage finding_count does not match findings array")
    coverage_ids = [item.get("stable_id") for item in records if isinstance(item, dict)]
    if len(coverage_ids) != len(set(coverage_ids)):
        errors.append("coverage stable_id collision")
    if set(coverage_ids) != set(registry_ids):
        errors.append("coverage stable_id set differs from canonical registry")
    p0_records = [item for item in records if isinstance(item, dict) and "P0" in str(item.get("severity", ""))]
    p1_records = [item for item in records if isinstance(item, dict) and "P1" in str(item.get("severity", ""))]
    if coverage.get("p0_total") != len(p0_records):
        errors.append("coverage p0_total does not match findings")
    if coverage.get("p1_total") != len(p1_records):
        errors.append("coverage p1_total does not match findings")
    allowed_states = {"UNCOVERED", "PARTIAL", "DESIGN_COVERED", "EMPIRICAL_TEST_REQUIRED", "RESIDUAL", "VERIFIED"}

    def state_counts(items: list[dict]) -> dict[str, int]:
        return {state: sum(item.get("coverage_state") == state for item in items) for state in sorted(allowed_states)}

    expected_overall = state_counts([item for item in records if isinstance(item, dict)])
    if coverage.get("coverage_state_counts") != expected_overall:
        errors.append("coverage_state_counts does not match findings")
    for key, items in (("p0_coverage_state_counts", p0_records), ("p1_coverage_state_counts", p1_records)):
        if key in coverage and coverage.get(key) != state_counts(items):
            errors.append(f"{key} does not match findings")
    registry_by_id = {item.get("stable_id"): item for item in findings if isinstance(item, dict)}
    coverage_by_id = {item.get("stable_id"): item for item in records if isinstance(item, dict)}
    for stable_id in set(registry_by_id) & set(coverage_by_id):
        registry_record = registry_by_id[stable_id]
        coverage_record = coverage_by_id[stable_id]
        if registry_record.get("coverage_state") != coverage_record.get("coverage_state"):
            errors.append(f"registry/coverage state mismatch for {stable_id}")
        for field in ("title", "severity", "domain"):
            if registry_record.get(field) != coverage_record.get(field):
                errors.append(f"registry/coverage {field} mismatch for {stable_id}")
    errors.extend(lint_source_evidence(root, [item for item in records if isinstance(item, dict)]))
    for record in records:
        if not isinstance(record, dict):
            errors.append("coverage record is not an object")
            continue
        missing = [key for key in (
            "stable_id", "title", "severity", "domain", "source_evidence",
            "control_owner_path", "control_owner_section_id", "supporting_owner_paths",
            "coverage_state", "residual_state", "required_negative_tests",
            "required_chaos_tests", "empirical_status", "notes",
        ) if key not in record]
        if missing:
            errors.append(f"coverage {record.get('stable_id')!r} missing fields: {','.join(missing)}")
        if not isinstance(record.get("stable_id"), str) or not record.get("stable_id"):
            errors.append(f"coverage record has empty stable_id: {record!r}")
        supporting_paths = record.get("supporting_owner_paths")
        if not isinstance(supporting_paths, list) or not all(isinstance(path, str) and path for path in supporting_paths):
            errors.append(f"coverage {record.get('stable_id')!r} supporting_owner_paths must be a string array")
        for field in ("required_negative_tests", "required_chaos_tests"):
            values = record.get(field)
            if not isinstance(values, list) or not all(isinstance(value, str) and value for value in values):
                errors.append(f"coverage {record.get('stable_id')!r} {field} must be a string array")
        if record.get("coverage_state") not in allowed_states:
            errors.append(f"coverage {record.get('stable_id')!r} has invalid state {record.get('coverage_state')!r}")
        source = record.get("source_evidence")
        if (
            not isinstance(source, dict)
            or not source.get("path")
            or not source.get("section")
            or not source.get("line")
        ):
            errors.append(f"coverage {record.get('stable_id')!r} has incomplete source_evidence")
        elif not (root / str(source["path"])).exists():
            errors.append(f"coverage {record.get('stable_id')!r} source path is missing: {source['path']}")
        chaos_tests = record.get("required_chaos_tests", [])
        if not isinstance(chaos_tests, list):
            errors.append(f"coverage {record.get('stable_id')!r} required_chaos_tests must be an array")
            chaos_tests = []
        for chaos_case in chaos_tests:
            referenced = CHAOS_ID_RE.findall(str(chaos_case))
            if not referenced:
                errors.append(f"coverage {record.get('stable_id')!r} has malformed chaos reference: {chaos_case!r}")
            for identifier in referenced:
                if identifier not in chaos_ids:
                    errors.append(f"coverage {record.get('stable_id')!r} references missing chaos case {identifier}")
        if "P0" in str(record.get("severity", "")):
            if record.get("coverage_state") == "UNCOVERED":
                errors.append(f"P0 {record.get('stable_id')} is unexplained UNCOVERED")
            if not record.get("control_owner_path") or not record.get("control_owner_section_id"):
                errors.append(f"P0 {record.get('stable_id')} has no exact control owner")
            if not record.get("required_negative_tests") or not record.get("required_chaos_tests"):
                errors.append(f"P0 {record.get('stable_id')} has no negative/chaos test requirement")
        if record.get("coverage_state") == "RESIDUAL" and record.get("residual_state") in {None, "UNASSESSED", "OPEN_UNVERIFIED"}:
            errors.append(f"coverage {record.get('stable_id')} residual state is not explicit")
        if record.get("coverage_state") == "VERIFIED" and str(record.get("empirical_status")) in {"NOT_RUN", "SPEC_ONLY"}:
            errors.append(f"coverage {record.get('stable_id')} is VERIFIED without empirical status")
        owner_path = record.get("control_owner_path")
        owner_id = record.get("control_owner_section_id")
        if owner_path and owner_id:
            owner_sections = sections.get(str(owner_path))
            if owner_sections is None:
                errors.append(f"coverage {record.get('stable_id')} owner path is missing: {owner_path}")
            else:
                locations = owner_sections.get(str(owner_id), [])
                if not locations:
                    locations = owner_sections.get(f"@slug:{str(owner_id).lower()}", [])
                if len(locations) != 1:
                    errors.append(
                        f"coverage {record.get('stable_id')} owner {owner_path}#{owner_id} "
                        f"does not resolve uniquely (found {len(locations)})"
                    )
        # Legacy aliases may be displayed in source_evidence, but they cannot
        # be used as the ledger key or as a control identity.
        if isinstance(record.get("stable_id"), str) and record["stable_id"].startswith("X"):
            errors.append(f"legacy Xnn used as coverage identity: {record['stable_id']}")
    return errors


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path("."), help="repository root (default: current directory)")
    args = parser.parse_args(list(argv) if argv is not None else None)
    root = args.root.resolve()
    sections, errors = collect_sections(root)
    errors.extend(lint_references(root, sections))
    chaos_errors, chaos_ids = lint_chaos_plan(root)
    errors.extend(chaos_errors)
    errors.extend(lint_control_event_schema(root, sections))
    errors.extend(lint_control_registry(root, sections))
    errors.extend(lint_registry_and_coverage(root, sections, chaos_ids))
    if errors:
        print("DOC_LINT=FAIL")
        for error in errors:
            print(f"ERROR: {error}")
        return 1
    print(f"DOC_LINT=PASS authoritative_files={len(sections)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
