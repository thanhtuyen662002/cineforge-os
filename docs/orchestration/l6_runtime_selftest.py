#!/usr/bin/env python3
"""Deterministic negative fixtures for the L6 runtime boundary harness."""

from __future__ import annotations

import sys
from pathlib import Path

try:
    from l6_runtime_contract import (
        AdmissionBlocked,
        CaptureBlocked,
        CaptureSessionGuard,
        CaptureState,
        CandidateState,
        ContractViolation,
        CostReservationLedger,
        CrashState,
        DispatchMode,
        DispatchState,
        FanoutBlocked,
        FanoutGuard,
        ManualControlLock,
        ManualRevisionFence,
        PinnedDependency,
        PublicationReconciler,
        PublicationUnknown,
        PublicationState,
        ResourceCapacity,
        ResourceNeed,
        ResourceReservationLedger,
        ResourceReservationRequest,
        ReservationState,
        RetryQuarantined,
        UsageEvent,
        UsageEventLedger,
        UsageEventType,
        WorkerCrashGuard,
        digest,
    )
except ModuleNotFoundError as exc:
    if exc.name != "l6_runtime_contract":
        raise
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from l6_runtime_contract import (  # type: ignore
        AdmissionBlocked,
        CaptureBlocked,
        CaptureSessionGuard,
        CaptureState,
        CandidateState,
        ContractViolation,
        CostReservationLedger,
        CrashState,
        DispatchMode,
        DispatchState,
        FanoutBlocked,
        FanoutGuard,
        ManualControlLock,
        ManualRevisionFence,
        PinnedDependency,
        PublicationReconciler,
        PublicationUnknown,
        PublicationState,
        ResourceCapacity,
        ResourceNeed,
        ResourceReservationLedger,
        ResourceReservationRequest,
        ReservationState,
        RetryQuarantined,
        UsageEvent,
        UsageEventLedger,
        UsageEventType,
        WorkerCrashGuard,
        digest,
    )


def _raises(error_type: type[BaseException], callback) -> None:
    try:
        callback()
    except error_type:
        return
    raise AssertionError(f"expected {error_type.__name__}")


def test_ct25_resource_and_cost_admission() -> None:
    ledger = ResourceReservationLedger(
        (
            ResourceCapacity("gpu-1", "GPU", 10, 2),
            ResourceCapacity("cpu-1", "CPU", 100, 10),
        )
    )
    first = ResourceReservationRequest(
        "res-1", "attempt-1", "fence-1", (ResourceNeed("gpu-1", "GPU", 8), ResourceNeed("cpu-1", "CPU", 80)), 1_000
    )
    receipt = ledger.reserve(first, now_ms=0)
    assert receipt.state == ReservationState.RESERVED and ledger.used("gpu-1") == 8
    assert ledger.reserve(first, now_ms=1) == receipt
    before = (ledger.used("gpu-1"), ledger.used("cpu-1"))
    second = ResourceReservationRequest(
        "res-2", "attempt-2", "fence-2", (ResourceNeed("gpu-1", "GPU", 1), ResourceNeed("cpu-1", "CPU", 11)), 1_000
    )
    _raises(AdmissionBlocked, lambda: ledger.reserve(second, now_ms=1))
    assert (ledger.used("gpu-1"), ledger.used("cpu-1")) == before
    _raises(AdmissionBlocked, lambda: ledger.release("res-1", fencing_token="stale-fence"))
    assert ledger.activate("res-1", fencing_token="fence-1", now_ms=2).state == ReservationState.ACTIVE
    assert ledger.release("res-1", fencing_token="fence-1").state == ReservationState.RELEASED

    expiry = ResourceReservationLedger((ResourceCapacity("gpu-2", "GPU", 10, 0),))
    expiring = ResourceReservationRequest("res-expire", "attempt-expire", "fence-expire", (ResourceNeed("gpu-2", "GPU", 5),), 5)
    expiry.reserve(expiring, now_ms=0)
    assert expiry.expire(now_ms=5)[0].state == ReservationState.EXPIRED and expiry.used("gpu-2") == 0
    assert expiry.reserve(expiring, now_ms=6).state == ReservationState.EXPIRED

    costs = CostReservationLedger(currency="USD", hard_limit_minor_units=100)
    cost = costs.reserve("cost-1", amount_minor_units=80, exposure_ceiling_minor_units=100)
    assert costs.reserve("cost-1", amount_minor_units=80, exposure_ceiling_minor_units=100) == cost
    assert costs.mark_unknown("cost-1").state == ReservationState.UNKNOWN
    _raises(AdmissionBlocked, lambda: costs.reserve("cost-2", amount_minor_units=30, exposure_ceiling_minor_units=100))
    _raises(AdmissionBlocked, lambda: costs.release("cost-1"))

    usage = UsageEventLedger()
    charge = UsageEvent("usage-1", "acct-1", "attempt-1", UsageEventType.CHARGE, None, "USD", 80, 1, 2, digest("charge"))
    correction = UsageEvent("usage-2", "acct-1", "attempt-1", UsageEventType.CORRECTION, "usage-1", "USD", 5, 3, 4, digest("correction"))
    usage.append(charge)
    usage.append(correction)
    _raises(ContractViolation, lambda: usage.append(UsageEvent("usage-3", "acct-1", "attempt-1", UsageEventType.REFUND, "missing", "USD", 1, 5, 6, digest("refund"))))


def test_ct26_worker_crash_loop() -> None:
    guard = WorkerCrashGuard(max_restarts=2, base_backoff_ms=10, max_backoff_ms=40)
    first = guard.record_crash("job-1", idempotency_key="idem-1", now_ms=0, evidence_hash=digest("crash-1"))
    assert first.state == CrashState.BACKOFF and not guard.can_retry("job-1", now_ms=9) and guard.can_retry("job-1", now_ms=10)
    assert guard.claim_retry("job-1", now_ms=10).state == CrashState.RUNNING
    assert not guard.can_retry("job-1", now_ms=10)
    _raises(RetryQuarantined, lambda: guard.claim_retry("job-1", now_ms=10))
    second = guard.record_crash("job-1", idempotency_key="idem-1", now_ms=20, evidence_hash=digest("crash-2"))
    assert second.state == CrashState.BACKOFF
    third = guard.record_crash("job-1", idempotency_key="idem-1", now_ms=40, evidence_hash=digest("crash-3"))
    assert third.state == CrashState.QUARANTINED and not guard.can_retry("job-1", now_ms=100)
    guard.mark_external_effect_completed("idem-done")
    completed = guard.record_crash("job-done", idempotency_key="idem-done", now_ms=0, evidence_hash=digest("done"))
    assert completed.state == CrashState.COMPLETED_NO_RETRY
    _raises(RetryQuarantined, lambda: guard.record_crash("job-1", idempotency_key="different", now_ms=50, evidence_hash=digest("bad")))


def test_ct27_pinned_revision_fanout() -> None:
    fanout = FanoutGuard(max_items_per_batch=5, max_exposure_minor_units=100)
    pinned = PinnedDependency("character-1", "rev-1")
    wrong = PinnedDependency("character-1", "rev-2")
    _raises(FanoutBlocked, lambda: fanout.plan("batch-blocked", pinned=pinned, observed=wrong, estimated_items=3, per_item_exposure_minor_units=20, mode=DispatchMode.STAGED))
    batch = fanout.plan("batch-1", pinned=pinned, observed=pinned, estimated_items=3, per_item_exposure_minor_units=20, mode=DispatchMode.SAMPLE_FIRST)
    assert batch.state == DispatchState.SAMPLING and batch.exposure_budget_minor_units == 60
    _raises(FanoutBlocked, lambda: fanout.dispatch("batch-1", count=1, expected_revision="rev-1"))
    assert fanout.approve_sample("batch-1", expected_revision="rev-1", approved=True).state == DispatchState.PLANNED
    assert fanout.dispatch("batch-1", count=2, expected_revision="rev-1").dispatched_count == 2
    assert fanout.dispatch("batch-1", count=1, expected_revision="rev-1").state == DispatchState.COMPLETE
    _raises(FanoutBlocked, lambda: fanout.dispatch("batch-1", count=1, expected_revision="rev-1"))
    pending = fanout.plan("batch-2", pinned=pinned, observed=pinned, estimated_items=5, per_item_exposure_minor_units=10, mode=DispatchMode.STAGED)
    invalidated = fanout.invalidate(pending.batch_id, new_revision="rev-2")
    assert invalidated.state == DispatchState.INVALIDATED and invalidated.cancelled_count == 5
    assert fanout.invalidate(pending.batch_id, new_revision="rev-2") == invalidated
    _raises(FanoutBlocked, lambda: fanout.invalidate(pending.batch_id, new_revision="rev-3"))


def test_ct28_manual_revision_fence() -> None:
    fence = ManualRevisionFence()
    active = ManualControlLock("character-1", "artist-1", "rev-1", 4, True)
    stale = fence.evaluate(active, current_revision="rev-1", current_epoch=4, candidate_id="candidate-1", candidate_revision="rev-1", payload_hash=digest("candidate"))
    assert stale.state == CandidateState.STALE_CANDIDATE
    unlocked = ManualControlLock("character-1", "artist-1", "rev-1", 4, False)
    current = fence.evaluate(unlocked, current_revision="rev-1", current_epoch=4, candidate_id="candidate-2", candidate_revision="rev-1", payload_hash=digest("candidate-2"))
    assert current.state == CandidateState.CANDIDATE
    old_epoch = fence.evaluate(unlocked, current_revision="rev-1", current_epoch=5, candidate_id="candidate-3", candidate_revision="rev-1", payload_hash=digest("candidate-3"))
    assert old_epoch.state == CandidateState.STALE_CANDIDATE
    old_revision = fence.evaluate(unlocked, current_revision="rev-1", current_epoch=4, candidate_id="candidate-4", candidate_revision="rev-0", payload_hash=digest("candidate-4"))
    assert old_revision.state == CandidateState.STALE_CANDIDATE


def test_ct39_unknown_publication() -> None:
    reconciler = PublicationReconciler()
    reconciler.begin("pub-1", destination_id="dest-1", version="rev-1", idempotency_key="idem-1", request_id="req-1")
    unknown = reconciler.response_lost("pub-1")
    assert unknown.state == PublicationState.UNKNOWN_EXTERNAL_OUTCOME
    _raises(PublicationUnknown, lambda: reconciler.begin("pub-1", destination_id="dest-1", version="rev-1", idempotency_key="idem-1", request_id="req-1"))
    _raises(PublicationUnknown, lambda: reconciler.begin("pub-1", destination_id="dest-1", version="rev-1", idempotency_key="idem-1", request_id="req-other"))
    _raises(PublicationUnknown, lambda: reconciler.reconcile("pub-1", destination_id="dest-1", request_id="req-1", observed_version="rev-1", postcondition_verified=False, delivered=False, evidence_hash=digest("unverified")))
    delivered = reconciler.reconcile("pub-1", destination_id="dest-1", request_id="req-1", observed_version="rev-1", postcondition_verified=True, delivered=True, evidence_hash=digest("receipt-1"), external_url="https://example.invalid/post/1")
    assert delivered.state == PublicationState.DELIVERED

    reconciler.begin("pub-2", destination_id="dest-1", version="rev-1", idempotency_key="idem-2", request_id="req-2")
    reconciler.response_lost("pub-2")
    retry_authorized = reconciler.reconcile("pub-2", destination_id="dest-1", request_id="req-2", observed_version="rev-1", postcondition_verified=True, delivered=False, evidence_hash=digest("receipt-2"))
    assert retry_authorized.state == PublicationState.RETRY_AUTHORIZED
    _raises(PublicationUnknown, lambda: reconciler.retry("pub-2", idempotency_key="idem-2", request_id="req-2"))
    retried = reconciler.retry("pub-2", idempotency_key="idem-2b", request_id="req-2b")
    assert retried.state == PublicationState.PUBLISHING
    reconciler.begin("pub-3", destination_id="dest-1", version="rev-1", idempotency_key="idem-3", request_id="req-3")
    reconciler.response_lost("pub-3")
    assert reconciler.authorize_compensation("pub-3", reason_hash=digest("compensate")).state == PublicationState.COMPENSATION_REQUIRED


def test_supplemental_capture_binding() -> None:
    capture = CaptureSessionGuard()
    denied = capture.start("capture-denied", owner_id="owner-1", device_id="device-1", source_id="source-1", session_epoch=1, permission_granted=False)
    assert denied.state == CaptureState.PERMISSION_DENIED
    _raises(CaptureBlocked, lambda: capture.append_output("capture-denied", owner_id="owner-1", device_id="device-1", source_id="source-1", session_epoch=1, output_hash=digest("denied")))
    active = capture.start("capture-1", owner_id="owner-1", device_id="device-1", source_id="source-1", session_epoch=2, permission_granted=True)
    assert active.state == CaptureState.ACTIVE
    assert capture.append_output("capture-1", owner_id="owner-1", device_id="device-1", source_id="source-1", session_epoch=2, output_hash=digest("frame")) == capture.append_output("capture-1", owner_id="owner-1", device_id="device-1", source_id="source-1", session_epoch=2, output_hash=digest("frame"))
    _raises(CaptureBlocked, lambda: capture.append_output("capture-1", owner_id="owner-1", device_id="device-1", source_id="source-1", session_epoch=2, output_hash=digest("different")))
    capture.start("capture-2", owner_id="owner-1", device_id="device-1", source_id="source-1", session_epoch=3, permission_granted=True)
    requested = capture.request_stop("capture-2", owner_id="owner-1", device_id="device-1", source_id="source-1", session_epoch=3)
    assert requested.state == CaptureState.STOP_REQUESTED
    assert capture.confirm_stop("capture-2", owner_id="owner-1", device_id="device-1", source_id="source-1", session_epoch=3).state == CaptureState.STOP_CONFIRMED


def test_negative_type_boundaries() -> None:
    _raises(ContractViolation, lambda: ResourceNeed("gpu", "GPU", True))
    _raises(ContractViolation, lambda: ResourceReservationRequest("bad", "attempt", "fence", (object(),), 10))
    _raises(ContractViolation, lambda: ResourceReservationLedger((object(),)))


def main() -> int:
    tests = (
        ("CT-25", test_ct25_resource_and_cost_admission),
        ("CT-26", test_ct26_worker_crash_loop),
        ("CT-27", test_ct27_pinned_revision_fanout),
        ("CT-28", test_ct28_manual_revision_fence),
        ("CT-39", test_ct39_unknown_publication),
        ("SUPPLEMENTAL-CAPTURE", test_supplemental_capture_binding),
        ("NEGATIVE", test_negative_type_boundaries),
    )
    for marker, test in tests:
        test()
        print(f"PASS {marker}")
    print(f"L6_RUNTIME_SELFTEST=PASS cases={len(tests)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
