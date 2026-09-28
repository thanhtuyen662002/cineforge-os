#!/usr/bin/env python3
"""Build a deterministic owner-candidate map for the unowned P1 findings.

This tool deliberately does *not* mutate ``COVERAGE.json``.  The current
ledger is a governance record and assigning an owner requires a human/lead
review of the contract semantics.  The output is a review artifact with:

* stable finding identity and the source/chaos references copied from the
  ledger;
* exact ``path#section-id`` candidates resolved against the same authoritative
  Markdown heading parser used by ``doc_lint.py``;
* deterministic lexical scores and a bounded set of alternatives;
* an explicit disposition: ``SAFE_CANDIDATE``, ``REVIEW_REQUIRED`` or
  ``NO_SAFE_MATCH``.

The lexical matcher is intentionally conservative.  A high score means that a
candidate is a useful starting point for review; it is not implementation or
empirical evidence and must never be copied into the ledger without semantic
approval.

Usage::

    python docs/orchestration/findings/build_p1_owner_mapping.py
    python docs/orchestration/findings/build_p1_owner_mapping.py --check

``--check`` rebuilds the in-memory result and compares it with the checked-in
JSON artifact, making accidental drift visible in CI or a local preflight. If
the reviewed map has already closed the ledger, it instead verifies the
approval receipt hash and the no-unowned-row invariant.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import unicodedata
from collections import Counter
from pathlib import Path
from typing import Any, Iterable


ROOT = Path(__file__).resolve().parents[3]
COVERAGE_PATH = ROOT / "docs/orchestration/findings/COVERAGE.json"
REGISTRY_PATH = ROOT / "docs/orchestration/findings/REGISTRY.json"
OUTPUT_PATH = ROOT / "docs/orchestration/findings/P1_PARTIAL_OWNER_MAPPING.json"
APPROVAL_PATH = ROOT / "docs/orchestration/findings/P1_OWNER_MAPPING_APPROVAL.json"

# ``doc_lint.authoritative_markdown`` excludes the raw stress corpus and the
# deprecated matrix.  Keep the same exclusion policy but do not use every
# heading as a candidate: plans, test cases and historical analyses are
# evidence, not implementation owner contracts.
OWNER_PATHS = (
    "docs/design/EXTREME_HARDENING_CONTRACTS.md",
    "docs/design/API_CONTRACTS.md",
    "docs/design/SCHEMA.md",
    "docs/design/STATE_MACHINES.md",
    "docs/architecture/FINAL_ARCHITECTURE.md",
    "docs/architecture/FOUNDATION.md",
    "docs/architecture/CHARACTER_IDENTITY_SYSTEM.md",
    "docs/orchestration/CONTROL_PLANE_TRUST_AND_CONCURRENCY.md",
    "docs/orchestration/GOVERNANCE_AND_CI_SECURITY.md",
    "docs/orchestration/TASK_AND_LEASE_PROTOCOL.md",
    "docs/orchestration/CONTEXT_MANIFEST_AND_DOC_LINT.md",
    "docs/orchestration/CONTEXT_LOADING_PROTOCOL.md",
    "docs/orchestration/FLOW_METRICS_AND_RECONCILIATION.md",
    "docs/orchestration/CI_REVIEW_MERGE_PROTOCOL.md",
)

# Words which occur in nearly every contract and do not identify ownership.
STOP_WORDS = frozenset(
    ""
    "a an and are as at be before by can does for from have in into is it its "
    "must not of on or should that the their this through to under use used with "
    "without after during when where while versus vs needs need required exact "
    "state policy contract semantics evidence boundary model class"
    .split()
)

# Small, domain-neutral equivalences.  They are used only to improve candidate
# ranking; an override is never allowed to invent a section ID.
TOKEN_ALIASES = {
    "pr": {"pull", "request", "github"},
    "github": {"control", "plane", "repository"},
    "zero": {"empty", "no"},
    "draft": {"branch", "review"},
    "lease": {"fence", "fencing", "ownership"},
    "wal": {"sqlite", "checkpoint", "storage"},
    "pressure": {"budget", "reserve", "admission"},
    "artifact": {"package", "bytes", "provenance"},
    "ready": {"activation", "materialization"},
    "backup": {"restore", "recovery", "durability"},
    "offline": {"immutable", "separate", "branch"},
    "billing": {"financial", "money", "credits", "cost"},
    "telemetry": {"observability", "metrics", "resource"},
    "fanout": {"bulk", "aggregate", "action"},
    "dependency": {"package", "source", "graph"},
    "cycle": {"dag", "graph"},
    "fingerprint": {"digest", "identity", "source"},
    "freshness": {"revalidation", "epoch", "current"},
    "timestamp": {"time", "clock"},
    "wall": {"clock", "time"},
    "unicode": {"display", "character"},
    "hash": {"digest", "identity"},
    "privacy": {"security", "egress", "redaction"},
    "encryption": {"crypto", "key", "cipher"},
    "encrypted": {"encryption", "crypto", "key"},
    "credential": {"secret", "auth", "identity"},
    "source": {"input", "ingest", "materialization"},
    "release": {"publish", "publication", "activation"},
    "publication": {"release", "destination", "postcondition"},
    "document": {"parser", "structured", "ingest"},
    "spreadsheet": {"document", "formula"},
    "continuity": {"timeline", "identity", "cinematic"},
    "casting": {"performer", "identity", "person"},
    "model": {"component", "runtime", "evaluator"},
    "learning": {"dataset", "evaluation", "training"},
    "benchmark": {"evaluation", "golden", "holdout"},
    "tenant": {"project", "scope"},
    "tenant/project": {"project", "scope"},
    "rto": {"recovery", "backup"},
    "rpo": {"recovery", "backup", "freshness"},
}


def normalize(text: str) -> str:
    text = unicodedata.normalize("NFC", text).lower()
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return " ".join(text.split())


def tokens(text: str) -> set[str]:
    return {
        token
        for token in re.findall(r"[a-z0-9]+", normalize(text))
        if len(token) > 2 and token not in STOP_WORDS
    }


def expanded_tokens(text: str) -> set[str]:
    result = tokens(text)
    for token in tuple(result):
        result.update(TOKEN_ALIASES.get(token, ()))
    return result


def heading_id(title: str) -> str | None:
    # Explicit IDs and the conventions enforced by doc_lint.py.
    anchor = re.search(r"\{#([A-Za-z0-9_.:-]+)\}\s*$", title)
    if anchor:
        return anchor.group(1)
    title = re.sub(r"\{#([A-Za-z0-9_.:-]+)\}\s*$", "", title).strip()
    match = re.match(
        r"^(?P<id>(?:\d+(?:\.\d+)*|[A-Z]{1,4}\d{1,4}|[A-Z]{1,4}\.|[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+))"
        r"(?:[.)]|\s|$)",
        title,
    )
    return match.group("id").rstrip(".") if match else None


def load_sections() -> list[dict[str, Any]]:
    sections: list[dict[str, Any]] = []
    for relative in OWNER_PATHS:
        path = ROOT / relative
        if not path.exists():
            continue
        lines = path.read_text(encoding="utf-8").splitlines()
        current: dict[str, Any] | None = None
        for line_no, line in enumerate(lines, 1):
            match = re.match(r"^(#{1,6})\s+(.+?)\s*$", line)
            if match:
                if current is not None:
                    sections.append(current)
                title = match.group(2).strip()
                identifier = heading_id(title)
                # doc_lint ignores unanchored numeric subheadings below H1.
                if len(match.group(1)) > 1 and identifier and identifier[0].isdigit() and not "{#" in title:
                    identifier = None
                current = {
                    "path": relative,
                    "line": line_no,
                    "level": len(match.group(1)),
                    "section_id": identifier,
                    "heading": title,
                    "body": [],
                }
            elif current is not None:
                current["body"].append(line)
        if current is not None:
            sections.append(current)
    # Only exact owner identities are useful.  Slug-only headings are not
    # accepted because the ledger requires a canonical section ID.  Tokenize
    # each section once: scoring all 474 findings against long contract bodies
    # must remain bounded and deterministic.
    result = [section for section in sections if section["section_id"]]
    for section in result:
        section["_heading_tokens"] = expanded_tokens(section["heading"])
        section["_body_tokens"] = expanded_tokens(" ".join(section["body"]))
    return result


def section_ref(section: dict[str, Any]) -> str:
    return f"{section['path']}#{section['section_id']}"


def evidence_like_heading(section: dict[str, Any]) -> bool:
    """Identify headings that describe test/evidence catalogs, not controls."""

    heading = normalize(section["heading"])
    # A test catalog can support an owner but cannot itself be the semantic
    # owner of an invariant.  Keep this intentionally narrow: headings such
    # as ``Critical invariant-test protection`` and ``Documentation lint
    # gate`` are implementation controls despite containing “test” or “gate”.
    return bool(
        re.search(
            r"\b(?:required|additional|negative|chaos|stress|hostile)\b.*\btests?\b",
            heading,
        )
    )


def score(title: str, section: dict[str, Any]) -> tuple[float, int, int, int, int]:
    title_tokens = expanded_tokens(title)
    heading_tokens = section["_heading_tokens"]
    body_tokens = section["_body_tokens"]
    exact = normalize(title) == normalize(section["heading"])
    heading_overlap = len(title_tokens & heading_tokens)
    body_overlap = len(title_tokens & body_tokens)
    # Heading terms carry more weight than a generic body mention.  Recall is
    # calculated against the finding title so long headings do not dominate.
    recall = len(title_tokens & (heading_tokens | body_tokens)) / max(len(title_tokens), 1)
    weighted = recall + (0.22 * heading_overlap) + (0.04 * min(body_overlap, 4))
    if exact:
        weighted += 2.0
    # Prefer implementation/design owners over orchestration prose when the
    # lexical result is otherwise tied; use path order as final determinism.
    path_bias = 0
    if section["path"].endswith("EXTREME_HARDENING_CONTRACTS.md"):
        path_bias = 2
    elif "/design/" in section["path"]:
        path_bias = 1
    return (weighted, int(exact), heading_overlap, body_overlap, path_bias)


def chaos_ids(values: Iterable[str]) -> list[str]:
    found: set[str] = set()
    for value in values:
        found.update(re.findall(r"\bCT-(?:0[1-9]|[1-3][0-9]|40)\b", value))
    return sorted(found, key=lambda value: int(value[3:]))


def support_refs(row: dict[str, Any], chaos: list[str]) -> list[dict[str, Any]]:
    """Return evidence/test references without presenting them as owners.

    Source findings use a human-readable section plus a line number rather
    than a stable heading ID.  Preserve all of that information as structured
    evidence, and make chaos anchors explicit so a reviewer can jump directly
    to the required negative-test specification.
    """

    refs: list[dict[str, Any]] = []
    source = row.get("source_evidence") or {}
    if source.get("path"):
        refs.append(
            {
                "kind": "source_evidence",
                "path": source["path"],
                "section": source.get("section"),
                "line": source.get("line"),
                "legacy_id": source.get("legacy_id"),
            }
        )
    refs.extend(
        {
            "kind": "chaos_spec",
            "ref": f"docs/orchestration/CHAOS_TEST_PLAN.md#{chaos_id}",
        }
        for chaos_id in chaos
    )
    return refs


def source_digest() -> str:
    digest = hashlib.sha256()
    for path in (COVERAGE_PATH, *(ROOT / relative for relative in OWNER_PATHS)):
        digest.update(path.relative_to(ROOT).as_posix().encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return "sha256:" + digest.hexdigest()


def build() -> dict[str, Any]:
    coverage = json.loads(COVERAGE_PATH.read_text(encoding="utf-8"))
    rows = [
        row
        for row in coverage["findings"]
        if "P1" in str(row.get("severity", ""))
        and row.get("coverage_state") == "PARTIAL"
        and not row.get("control_owner_path")
        and not row.get("control_owner_section_id")
    ]
    sections = load_sections()
    if not sections:
        raise RuntimeError("no authoritative owner sections were found")

    entries: list[dict[str, Any]] = []
    disposition_counts: Counter[str] = Counter()
    for row in rows:
        ranked = sorted(
            ((score(str(row["title"]), section), section) for section in sections),
            key=lambda item: (item[0], section_ref(item[1])),
            reverse=True,
        )
        best_score, best = ranked[0]
        alternatives = []
        for candidate_score, candidate in ranked[:3]:
            alternatives.append(
                {
                    "owner_ref": section_ref(candidate),
                    "section_id": candidate["section_id"],
                    "heading": candidate["heading"],
                    "line": candidate["line"],
                    "score": round(candidate_score[0], 4),
                    "exact_heading": bool(candidate_score[1]),
                    "heading_token_overlap": candidate_score[2],
                    "body_token_overlap": candidate_score[3],
                    "evidence_like_heading": evidence_like_heading(candidate),
                }
            )

        # A candidate is safe only when the heading itself carries at least two
        # finding terms or the title is an exact heading.  One-token matches
        # (for example “policy” or “state”) are review leads, never owners.
        exact = bool(best_score[1])
        heading_overlap = best_score[2]
        best_is_evidence = evidence_like_heading(best)
        if (exact or (best_score[0] >= 0.95 and heading_overlap >= 2)) and not best_is_evidence:
            disposition = "SAFE_CANDIDATE"
            confidence = "HIGH"
            owner_refs = [section_ref(best)]
            reason = "exact heading match" if exact else "multi-token authoritative heading match"
        elif best_is_evidence and (exact or heading_overlap >= 2):
            disposition = "REVIEW_REQUIRED"
            confidence = "MEDIUM"
            owner_refs = [section_ref(best)]
            reason = "candidate is an evidence/test heading; semantic owner review required"
        elif best_score[0] >= 0.55 and (heading_overlap >= 1 or best_score[3] >= 2):
            disposition = "REVIEW_REQUIRED"
            confidence = "MEDIUM"
            owner_refs = [section_ref(best)]
            reason = "deterministic lexical candidate; semantic owner review required"
        else:
            disposition = "NO_SAFE_MATCH"
            confidence = "LOW"
            owner_refs = []
            reason = "no authoritative heading passed the conservative match threshold"
        new_contract_section = {
            "status": {
                "SAFE_CANDIDATE": "NOT_INDICATED",
                "REVIEW_REQUIRED": "SEMANTIC_REVIEW_REQUIRED",
                "NO_SAFE_MATCH": "CANDIDATE",
            }[disposition],
            "reason": (
                "An exact/multi-token heading is available; do not add a section unless semantic review rejects it."
                if disposition == "SAFE_CANDIDATE"
                else "Review the candidate and alternatives; add or extend an authoritative contract if none owns the invariant."
                if disposition == "REVIEW_REQUIRED"
                else "No conservative lexical owner was found; add or extend an authoritative contract, or record an explicit external residual."
            ),
        }
        disposition_counts[disposition] += 1
        chaos = chaos_ids(row.get("required_chaos_tests", []))
        entries.append(
            {
                "stable_id": row["stable_id"],
                "title": row["title"],
                "severity": row["severity"],
                "domain": row["domain"],
                "source_evidence": row["source_evidence"],
                "chaos_ids": chaos,
                "support_refs": support_refs(row, chaos),
                "current_supporting_owner_paths": row.get("supporting_owner_paths", []),
                "current_state": row["coverage_state"],
                "current_residual_state": row["residual_state"],
                "disposition": disposition,
                "confidence": confidence,
                "owner_refs": owner_refs,
                "owner_ref": owner_refs[0] if owner_refs else None,
                "supporting_owner_refs": [
                    alternative["owner_ref"] for alternative in alternatives[1:]
                ],
                "alternatives": alternatives,
                "new_contract_section": new_contract_section,
                "reason": reason,
            }
        )

    entries.sort(key=lambda item: item["stable_id"])
    return {
        "schema_version": 1,
        "artifact_id": "cineforge-p1-partial-owner-mapping",
        "generated_from": "docs/orchestration/findings/COVERAGE.json",
        "source_registry_revision": coverage.get("source_registry_revision"),
        "source_digest": source_digest(),
        "scope": {
            "selection": "severity contains P1, coverage_state=PARTIAL, missing exact owner path and section",
            "selected_count": len(entries),
            "coverage_mutated": False,
            "empirical_or_runtime_claim": False,
            "owner_refs_require_semantic_review": True,
            "new_contract_section_candidate_count": disposition_counts.get("NO_SAFE_MATCH", 0),
            "new_contract_section_candidate_ids": [
                entry["stable_id"]
                for entry in entries
                if entry["disposition"] == "NO_SAFE_MATCH"
            ],
        },
        "owner_paths": list(OWNER_PATHS),
        "disposition_counts": dict(sorted(disposition_counts.items())),
        "findings": entries,
    }


def approved_closed_state() -> tuple[bool, str | None]:
    """Return whether the reviewed snapshot may be safely preserved.

    Once approval has moved the ledger out of ``PARTIAL``/``UNCOVERED``, a
    normal mapper invocation must not overwrite the 474-row audit snapshot
    with an empty result.  The approval receipt hash and the closed-ledger
    invariant form a small fail-closed preservation guard.
    """

    if not APPROVAL_PATH.exists() or not OUTPUT_PATH.exists():
        return False, None
    try:
        approval = json.loads(APPROVAL_PATH.read_text(encoding="utf-8"))
        coverage = json.loads(COVERAGE_PATH.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return False, None
    mapping_digest = "sha256:" + hashlib.sha256(OUTPUT_PATH.read_bytes()).hexdigest()
    coverage_digest = "sha256:" + hashlib.sha256(COVERAGE_PATH.read_bytes()).hexdigest()
    registry_digest = "sha256:" + hashlib.sha256(REGISTRY_PATH.read_bytes()).hexdigest()
    closed_ledger = bool(coverage.get("findings")) and all(
        row.get("coverage_state") not in {"PARTIAL", "UNCOVERED"}
        and row.get("control_owner_path")
        and row.get("control_owner_section_id")
        for row in coverage["findings"]
    )
    receipt_matches = (
        approval.get("approved_rows") == 486
        and approval.get("source_mapping") == OUTPUT_PATH.relative_to(ROOT).as_posix()
        and approval.get("source_mapping_sha256") == mapping_digest
        and approval.get("post_coverage_sha256") == coverage_digest
        and approval.get("post_registry_sha256") == registry_digest
    )
    return receipt_matches and closed_ledger, mapping_digest


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="compare generated output with the checked-in artifact")
    args = parser.parse_args(argv)
    artifact = build()
    encoded = json.dumps(artifact, ensure_ascii=False, indent=2) + "\n"
    if args.check:
        if not OUTPUT_PATH.exists():
            print(f"P1_OWNER_MAPPING=FAIL missing {OUTPUT_PATH.relative_to(ROOT).as_posix()}")
            return 1
        current = OUTPUT_PATH.read_text(encoding="utf-8")
        # Once the reviewed map has been applied, there are intentionally no
        # PARTIAL/unowned rows left to rebuild.  Keep --check useful in that
        # steady state by validating the approval receipt and the closed
        # selection boundary instead of demanding a pre-approval snapshot.
        if not artifact["findings"]:
            approved, mapping_digest = approved_closed_state()
            if approved:
                print(
                    "P1_OWNER_MAPPING=PASS approved ledger state "
                    f"findings=0; approval receipt=486; mapping_digest={mapping_digest}"
                )
                return 0
        if current != encoded:
            print("P1_OWNER_MAPPING=FAIL artifact drift")
            return 1
        print(
            "P1_OWNER_MAPPING=PASS "
            f"findings={artifact['scope']['selected_count']} "
            f"dispositions={json.dumps(artifact['disposition_counts'], sort_keys=True)}"
        )
        return 0
    if not artifact["findings"]:
        approved, mapping_digest = approved_closed_state()
        if approved:
            print(
                "P1_OWNER_MAPPING=PASS preserved approved snapshot "
                f"findings=474; mapping_digest={mapping_digest}"
            )
            return 0
        if OUTPUT_PATH.exists():
            print(
                "P1_OWNER_MAPPING=FAIL no PARTIAL/unowned rows selected and "
                "no valid approval receipt; existing snapshot preserved"
            )
            return 1
    OUTPUT_PATH.write_text(encoded, encoding="utf-8", newline="\n")
    print(
        "P1_OWNER_MAPPING=WRITTEN "
        f"findings={artifact['scope']['selected_count']} "
        f"dispositions={json.dumps(artifact['disposition_counts'], sort_keys=True)}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
