#!/usr/bin/env python3
"""Fail-closed fixtures for the canonical control-event validator."""

from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
ORCHESTRATION = ROOT / "docs" / "orchestration"
sys.path.insert(0, str(ORCHESTRATION))

import control_event_lint as cel  # noqa: E402  (bootstrap-local import)


SHA_A = "a" * 40
SHA_B = "b" * 40
SHA_C = "c" * 40
HASH_A = "sha256:" + ("1" * 64)
HASH_B = "sha256:" + ("2" * 64)


def render(values: dict[str, str]) -> str:
    values = dict(values)
    values["EVENT_HASH"] = cel.canonical_event_hash(values)
    return "".join(f"{key}={value}\n" for key, value in values.items())


def rehash(text: str, **changes: str) -> str:
    values = dict(line.split("=", 1) for line in text.splitlines() if line)
    values.update(changes)
    return render(values)


def event(event_schema: str, event_id: str, payload: dict[str, str], **overrides: str) -> str:
    values = {
        "EVENT_SCHEMA": event_schema,
        "CONTROL_EVENT_ID": event_id,
        "CONTROL_EPOCH": "7",
        "PREV_EVENT_COMMENT_ID": "none",
        "PREV_EVENT_HASH": "none",
        "EVENT_HASH_ALGORITHM": "SHA-256",
        "EVENT_HASH": "placeholder",
        "TRUSTED_AUTHOR": "cineforge-bot",
    }
    values.update(payload)
    values.update(overrides)
    return render(values)


def valid_events() -> dict[str, str]:
    return {
        "state": event(
            "AGENT_STATE_V1",
            "event-state-001",
            {
                "AGENT_INSTANCE_ID": "cineforge-S03",
                "RUN_ID": "run-state-001",
                "SLOT_ID": "S03",
                "HEAD_SHA": SHA_A,
                "BASE_SHA": SHA_B,
                "STATE": "READY_FOR_REVIEW",
                "BLOCKER": "none",
                "NEXT_ACTION": "await independent review",
            },
        ),
        "takeover": event(
            "AGENT_TAKEOVER_V1",
            "event-take-001",
            {
                "FROM": "cineforge-S02",
                "TO": "cineforge-S03",
                "RUN_ID": "run-take-001",
                "SLOT_ID": "S03",
                "HEAD_SHA": SHA_A,
                "BASE_SHA": SHA_B,
                "REASON": "confirmed handoff",
                "NEXT_ACTION": "revalidate context",
                "AUTHORIZED_BY": "cineforge-flow",
            },
        ),
        "review": event(
            "AGENT_REVIEW_V1",
            "event-review-001",
            {
                "REVIEW_AGENT_INSTANCE_ID": "cineforge-QA",
                "RUN_ID": "run-review-001",
                "REVIEW_HEAD_SHA": SHA_A,
                "REVIEW_BASE_SHA": SHA_B,
                "VERIFICATION_MERGE_SHA": "none",
                "REVIEW_PROFILE": "security",
                "VERDICT": "APPROVE",
                "BLOCKERS": "none",
            },
        ),
        "revision": event(
            "TASK_CONTRACT_REVISION_V1",
            "event-revision-001",
            {
                "ISSUE": "1",
                "CONTRACT_VERSION": "4",
                "PREV_CONTRACT_HASH": HASH_A,
                "NEW_CONTRACT_HASH": HASH_B,
                "REASON": "accepted scope correction",
                "AUTHORIZED_BY": "cineforge-planner",
            },
        ),
        "orphan": event(
            "ORPHAN_OBSERVED_V1",
            "event-orphan-001",
            {
                "BRANCH": "agent/i1-a1",
                "HEAD_SHA": SHA_A,
                "OBSERVED_BY": "cineforge-flow",
                "STATE": "FIRST_SEEN",
            },
        ),
        "claim": event(
            "CLAIM_INTENT_V1",
            "event-claim-001",
            {
                "CLAIM_INTENT_ID": "claim-intent-001",
                "ISSUE": "1",
                "ATTEMPT": "1",
                "TASK_CONTRACT_HASH": HASH_A,
                "AGENT_INSTANCE_ID": "cineforge-S03",
                "SLOT_ID": "S03",
                "RUN_ID": "run-claim-001",
            },
        ),
        "capacity": event(
            "CAPACITY_PLAN_V2",
            "event-capacity-001",
            {
                "PLAN_VERSION": "7",
                "PREV_PLAN_COMMENT_ID": "12345",
                "PRIMARY_PLANNER": "cineforge-planner",
                "PRIMARY_FLOW_GOVERNOR": "cineforge-flow",
                "PRIMARY_INTEGRATOR": "cineforge-integrator",
                "SLOT_COUNT": "4",
                "SLOT_BINDINGS": "S01=architecture,S02=storage,S03=qa,S04=review",
                "STAGGER_OFFSETS": "S01=0,S02=30,S03=60,S04=90",
                "CI_RUNNER_CAPACITY": "2",
                "REVIEW_CAPACITY": "1",
                "MAX_ACTIVE_IMPLEMENTATION": "2",
                "MAX_CI_IN_FLIGHT": "2",
                "MAX_WAITING_REVIEW": "1",
                "MAX_PARKED_TOTAL": "4",
                "CURRENT_CRITICAL_PATH": "storage recovery",
                "CURRENT_HOTSPOTS": "SQLite, update",
                "UPDATED_BY": "cineforge-planner",
            },
        ),
        "slot": event(
            "SLOT_LEASE_V1",
            "event-slot-001",
            {
                "SLOT_ID": "S03",
                "AGENT_INSTANCE_ID": "cineforge-S03",
                "RUN_ID": "run-slot-001",
                "ACTION": "ACQUIRE",
                "LEASE_EPOCH": "7",
                "TTL_SECONDS": "900",
                "REASON": "scheduled implementation",
            },
        ),
        "role": event(
            "CONTROL_ROLE_LEASE_V1",
            "event-role-001",
            {
                "ROLE": "INTEGRATOR",
                "AGENT_INSTANCE_ID": "cineforge-integrator",
                "RUN_ID": "run-role-001",
                "ACTION": "ACQUIRE",
                "EPOCH": "7",
                "TTL_SECONDS": "900",
                "REASON": "merge reconciliation",
            },
        ),
        "merge": event(
            "MERGE_LEASE_V1",
            "event-merge-001",
            {
                "REPOSITORY": "thanhtuyen662002/cineforge-os",
                "MERGE_OPERATION_ID": "merge-operation-001",
                "AGENT_INSTANCE_ID": "cineforge-integrator",
                "RUN_ID": "run-merge-001",
                "ACTION": "ACQUIRE",
                "LEASE_EPOCH": "7",
                "TTL_SECONDS": "300",
                "EXPECTED_MAIN_SHA": SHA_B,
                "EXPECTED_PR_HEAD_SHA": SHA_A,
                "REASON": "single-writer final check",
            },
        ),
        "ci": event(
            "CI_VERIFICATION_V1",
            "event-ci-001",
            {
                "HEAD_SHA": SHA_A,
                "BASE_SHA": SHA_B,
                "SYNTHETIC_MERGE_SHA": SHA_C,
                "WORKFLOW_CHECK_ID": "checks/contract-lint",
                "CHECK_PRODUCER_IDENTITY": "github-actions",
                "WORKFLOW_PATH": ".github/workflows/contract.yml",
                "WORKFLOW_REVISION": SHA_C,
                "RUNNER_TRUST_CLASS": "GITHUB_HOSTED",
                "ATTEMPT": "1",
                "RESULT": "PASS",
            },
        ),
        "outcome": event(
            "MERGE_OUTCOME_V1",
            "event-outcome-001",
            {
                "MERGE_OPERATION_ID": "merge-operation-001",
                "OUTCOME": "CONFIRMED_SUCCESS",
                "EXPECTED_MAIN_SHA": SHA_B,
                "EXPECTED_PR_HEAD_SHA": SHA_A,
                "OBSERVED_MERGED_SHA": SHA_C,
                "OBSERVED_MAIN_SHA": SHA_C,
                "RECONCILED_BY": "cineforge-integrator",
                "RECONCILIATION_SOURCE": "DIRECT_GITHUB_READ",
                "REASON": "direct post-timeout reconciliation",
            },
        ),
    }


def expect_failure(name: str, text: str, needle: str, schema: dict) -> None:
    try:
        cel.parse_event_text(text, schema)
    except cel.EventValidationError as exc:
        if needle not in str(exc):
            raise AssertionError(f"{name}: expected {needle!r}, got {exc}") from exc
        return
    raise AssertionError(f"{name}: malformed event unexpectedly passed")


def main() -> int:
    schema = cel.load_schema(ORCHESTRATION / "CONTROL_EVENT_CONTRACTS.json")
    fixtures = valid_events()
    for name, text in fixtures.items():
        cel.parse_event_text(text, schema)
        print(f"PASS valid {name}")

    baseline = fixtures["state"]
    expect_failure("duplicate key", baseline + "RUN_ID=duplicate\n", "duplicate event key", schema)
    expect_failure("unknown key", baseline + "UNKNOWN_FIELD=value\n", "unknown fields", schema)
    expect_failure("non-ASCII key", baseline + "RÜN_ID=value\n", "invalid ASCII machine key", schema)
    expect_failure("unknown version", baseline.replace("EVENT_SCHEMA=AGENT_STATE_V1", "EVENT_SCHEMA=AGENT_STATE_V9"), "unknown EVENT_SCHEMA/version", schema)
    expect_failure("missing required", "\n".join(line for line in baseline.splitlines() if not line.startswith("NEXT_ACTION=")) + "\n", "missing required fields", schema)
    expect_failure("hash drift", baseline.replace("STATE=READY_FOR_REVIEW", "STATE=ACTIVE"), "EVENT_HASH does not match", schema)
    expect_failure("bad SHA", baseline.replace(f"HEAD_SHA={SHA_A}", "HEAD_SHA=not-a-sha"), "does not match git_sha", schema)
    expect_failure("contradictory review", fixtures["review"].replace("BLOCKERS=none", "BLOCKERS=stale base"), "APPROVE requires BLOCKERS=none", schema)
    expect_failure("invalid lease TTL", fixtures["merge"].replace("TTL_SECONDS=300", "TTL_SECONDS=0"), "require a positive TTL", schema)
    expect_failure("previous hash pair", baseline.replace("PREV_EVENT_COMMENT_ID=none", "PREV_EVENT_COMMENT_ID=123"), "must be both none", schema)
    expect_failure("control character", baseline.replace("NEXT_ACTION=await independent review", "NEXT_ACTION=bad\x01value"), "control character", schema)

    duplicate_events, duplicate_errors = cel.validate_event_stream([baseline, baseline], schema)
    if duplicate_errors or len(duplicate_events) != 1:
        raise AssertionError(f"idempotent retry failed: {duplicate_errors}")
    conflicting = rehash(baseline, NEXT_ACTION="changed")
    _, conflict_errors = cel.validate_event_stream([baseline, conflicting], schema)
    if not any("conflicting payloads" in error for error in conflict_errors):
        raise AssertionError(f"conflicting event ID was not rejected: {conflict_errors}")

    _, stale_errors = cel.validate_event_stream([fixtures["review"]], schema, expected_head=SHA_C, expected_base=SHA_B)
    if not any("stale" in error for error in stale_errors):
        raise AssertionError(f"stale review context was not rejected: {stale_errors}")
    _, producer_errors = cel.validate_event_stream([fixtures["ci"]], schema, expected_producer="trusted-app")
    if not any("producer identity" in error for error in producer_errors):
        raise AssertionError(f"wrong CI producer was not rejected: {producer_errors}")

    unknown_outcome = event(
        "MERGE_OUTCOME_V1",
        "event-outcome-unknown",
        {
            "MERGE_OPERATION_ID": "merge-operation-fenced",
            "OUTCOME": "UNKNOWN_OUTCOME",
            "EXPECTED_MAIN_SHA": SHA_B,
            "EXPECTED_PR_HEAD_SHA": SHA_A,
            "OBSERVED_MERGED_SHA": "none",
            "OBSERVED_MAIN_SHA": "none",
            "RECONCILED_BY": "cineforge-integrator",
            "RECONCILIATION_SOURCE": "NONE",
            "REASON": "network timeout requires direct reread",
        },
    )
    fenced_lease = event(
        "MERGE_LEASE_V1",
        "event-merge-fenced",
        {
            "REPOSITORY": "thanhtuyen662002/cineforge-os",
            "MERGE_OPERATION_ID": "merge-operation-fenced",
            "AGENT_INSTANCE_ID": "cineforge-integrator",
            "RUN_ID": "run-merge-fenced",
            "ACTION": "ACQUIRE",
            "LEASE_EPOCH": "7",
            "TTL_SECONDS": "300",
            "EXPECTED_MAIN_SHA": SHA_B,
            "EXPECTED_PR_HEAD_SHA": SHA_A,
            "REASON": "unsafe retry",
        },
    )
    _, fence_errors = cel.validate_event_stream([unknown_outcome, fenced_lease], schema)
    if not any("fenced after UNKNOWN_OUTCOME" in error for error in fence_errors):
        raise AssertionError(f"unknown outcome did not fence mutation: {fence_errors}")

    print(f"CONTROL_EVENT_SELFTEST=PASS cases={len(fixtures) + 19}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
