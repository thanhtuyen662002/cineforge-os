#!/usr/bin/env python3
"""Executable negative fixtures for the L4 reference contract harness.

The output is evidence that the Python contract model rejects the listed
failure modes.  It is not a product-runtime, real SQLite, OS-lock, signing
key, crash-recovery or hardware test.  Promotion remains parked until an
independent implementation and verifier provide those stronger evidence
classes.
"""

from __future__ import annotations

import hashlib
import sys
from pathlib import Path
from typing import Callable, Type


HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

from l4_recovery_contract import (  # noqa: E402
    BackupManifest,
    BackupRestoreVerifier,
    CompatiblePair,
    ContractViolation,
    CoreOwnership,
    CoreState,
    IntegrityState,
    MigrationFailure,
    MigrationJournal,
    MigrationPhase,
    OutboxDisposition,
    OutboxEntry,
    PressureState,
    ReconciliationDecision,
    RecoveryEpochController,
    RecoveryState,
    ResourceBlocked,
    ResourceReservationLedger,
    RollbackMode,
    SQLiteHealthSample,
    SQLitePressurePolicy,
    SQLitePressureThresholds,
    StaleRecoveryEpoch,
    UpdateController,
    UpdateManifest,
    UpdateRejected,
    UpdateState,
    WriterFenced,
)


def digest(label: str) -> str:
    return "sha256:" + hashlib.sha256(label.encode("utf-8")).hexdigest()


def make_update(
    version: str,
    package_label: str,
    *,
    min_schema: int = 1,
    max_schema: int = 2,
    signature_verified: bool = True,
    signer_verified: bool = True,
    freshness_verified: bool = True,
    floor: str = "1.0.0",
    rollback_mode: RollbackMode = RollbackMode.COMPATIBLE_PAIR_ONLY,
    required_disk_bytes: int = 100,
) -> UpdateManifest:
    return UpdateManifest(
        version,
        min_schema,
        max_schema,
        digest(package_label),
        signature_verified,
        rollback_mode,
        floor,
        required_disk_bytes,
        manifest_id=f"manifest-{package_label}",
        channel="stable",
        platform="windows",
        architecture="x64",
        signer_verified=signer_verified,
        freshness_verified=freshness_verified,
        source_revision=digest(f"source-{package_label}"),
        release_epoch=1,
    )


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def expect_error(error_type: Type[BaseException], operation: Callable[[], object]) -> None:
    try:
        operation()
    except error_type:
        return
    except BaseException as exc:  # pragma: no cover - failure detail path
        raise AssertionError(f"expected {error_type.__name__}, got {type(exc).__name__}: {exc}") from exc
    raise AssertionError(f"expected {error_type.__name__}")


def migration_complete() -> MigrationJournal:
    journal = MigrationJournal("migration-1", 1, 2, "backup-1")
    journal.advance(MigrationPhase.SCHEMA)
    journal.checkpoint("schema-step", MigrationPhase.SCHEMA, input_digest=digest("schema-in"), output_digest=digest("schema-out"), schema_fingerprint=digest("schema-v2"))
    journal.advance(MigrationPhase.BACKFILL)
    journal.checkpoint("backfill-step", MigrationPhase.BACKFILL, input_digest=digest("backfill-in"), output_digest=digest("backfill-out"), schema_fingerprint=digest("schema-v2"))
    journal.advance(MigrationPhase.PROJECTIONS)
    journal.checkpoint("projection-step", MigrationPhase.PROJECTIONS, input_digest=digest("projection-in"), output_digest=digest("projection-out"), schema_fingerprint=digest("schema-v2"))
    journal.advance(MigrationPhase.INTEGRITY_CHECK)
    journal.checkpoint("integrity-step", MigrationPhase.INTEGRITY_CHECK, input_digest=digest("integrity-in"), output_digest=digest("integrity-out"), schema_fingerprint=digest("schema-v2"))
    journal.mark_integrity_verified()
    journal.advance(MigrationPhase.HEALTH_CHECK)
    journal.checkpoint("health-step", MigrationPhase.HEALTH_CHECK, input_digest=digest("health-in"), output_digest=digest("health-out"), schema_fingerprint=digest("schema-v2"))
    journal.mark_health_verified()
    journal.complete()
    return journal


def test_ct10_late_callback_epoch_fence() -> None:
    controller = RecoveryEpochController(initial_epoch=7)
    old_epoch = controller.epoch
    new_epoch = controller.begin_restore("backup-8")
    require(new_epoch == old_epoch + 1, "restore must create a monotonic epoch")
    controller.transition(RecoveryState.RESTORING)
    controller.transition(RecoveryState.RECOVERY_RECONCILIATION)
    late = controller.record_callback(
        callback_id="callback-old",
        job_id="job-1",
        callback_epoch=old_epoch,
    )
    require(late.decision == ReconciliationDecision.NEEDS_HUMAN, "late callback must be reconciled")
    require(not late.canonical_mutation_allowed, "late callback must not mutate restored state")
    controller.transition(RecoveryState.READY_TO_ACTIVATE)
    controller.transition(RecoveryState.ACTIVE)
    current = controller.record_callback(
        callback_id="callback-current",
        job_id="job-2",
        callback_epoch=new_epoch,
        provider="provider-a",
        attempt_id="attempt-2",
        deployment_id="deployment-1",
    )
    require(current.canonical_mutation_allowed, "active-epoch callback should be admissible")
    expect_error(StaleRecoveryEpoch, lambda: controller.assert_epoch(old_epoch))


def test_ct11_old_outbox_policy_fence() -> None:
    controller = RecoveryEpochController(initial_epoch=3)
    old_entry = OutboxEntry("outbox-old", 2, "publish-deleted", 4)
    policy_block = controller.evaluate_outbox(
        old_entry,
        policy_version=5,
        revoked_operation_ids=("publish-deleted",),
    )
    require(policy_block == OutboxDisposition.BLOCKED_BY_NEW_POLICY, "revoked old outbox must be blocked")
    stale_entry = OutboxEntry("outbox-stale", 2, "safe-operation", 5)
    require(
        controller.evaluate_outbox(stale_entry, policy_version=5) == OutboxDisposition.SUPERSEDED,
        "old-epoch outbox must be superseded",
    )
    current_entry = OutboxEntry("outbox-current", 3, "safe-operation", 5)
    require(
        controller.evaluate_outbox(current_entry, policy_version=5) == OutboxDisposition.DISPATCHABLE,
        "only current policy/current epoch outbox may dispatch",
    )


def test_ct12_wal_pressure_stop_the_line() -> None:
    thresholds = SQLitePressureThresholds(100, 200, 300, 1_000, 500, 100, 100, 200)
    policy = SQLitePressurePolicy(thresholds)
    sample = SQLiteHealthSample(350, 50, False, 0, 2, 99, 1_000)
    require(policy.classify(sample) == PressureState.READ_ONLY_SAFE, "WAL pressure must enter read-only safe mode")
    expect_error(ResourceBlocked, lambda: policy.admit_write(sample))
    expect_error(ResourceBlocked, lambda: policy.admit_protected_deletion(sample))
    critical = SQLiteHealthSample(200, 250, True, 2, 20, 600, 1_000)
    require(policy.classify(critical) == PressureState.CRITICAL, "checkpoint starvation must be critical")
    expect_error(ResourceBlocked, lambda: policy.admit_write(critical))
    corrupt = SQLiteHealthSample(0, 0, False, 0, 0, 10_000, 10_000, IntegrityState.CORRUPT_DETECTED)
    require(policy.classify(corrupt) == PressureState.RECOVERING, "corruption must enter recovery")


def test_ct13_atomic_space_reservation() -> None:
    ledger = ResourceReservationLedger(1_000, protected_free_floor_bytes=100)
    ledger.reserve("read-temp", "reader", 500)
    expect_error(ResourceBlocked, lambda: ledger.reserve("import-temp", "import", 401))
    require(ledger.active_bytes == 500, "failed admission must not partially reserve bytes")
    ledger.release("read-temp")
    ledger.reserve("import-temp", "import", 400)
    require(ledger.active_bytes == 400, "released reservation must return capacity")
    # An exact retry is idempotent and does not double-count the reservation.
    ledger.reserve("import-temp", "import", 400)
    require(ledger.active_bytes == 400, "identical reservation retry must be idempotent")


def test_ct14_single_core_writer_fence() -> None:
    ownership = CoreOwnership()
    first = ownership.acquire("core-a")
    expect_error(WriterFenced, lambda: ownership.acquire("core-b"))
    second = ownership.takeover_with_fence("core-b", first)
    require(ownership.state_for("core-a") == CoreState.STALE_FENCED, "old Core must be fenced")
    expect_error(WriterFenced, lambda: ownership.mutate(first, "stale-write"))
    require(ownership.mutate(second, "current-write") == "current-write", "new owner may mutate")
    require(second.instance_epoch > first.instance_epoch, "takeover must advance the instance epoch")
    ownership.stop(second)
    require(ownership.active is None, "stopping a Core must release the singleton fence")
    require(ownership.acquire("core-c").instance_epoch > second.instance_epoch, "clean restart must acquire a new epoch")


def test_ct15_backup_integrity_and_salvage_fence() -> None:
    manifest = BackupManifest(
        "backup-15",
        15,
        digest("schema-v1"),
        digest("db-v1"),
        digest("objects-v1"),
        digest("rights-v1"),
        15,
        True,
        "REMOTE_DURABLE",
        "backup-region-a",
        True,
        True,
        True,
        True,
    )
    verified = BackupRestoreVerifier()
    result = verified.verify(
        manifest,
        db_digest=digest("db-v1"),
        object_digest=digest("objects-v1"),
        rights_digest=digest("rights-v1"),
        schema_fingerprint=digest("schema-v1"),
        manifest_digest=manifest.manifest_digest,
    )
    require(result.verified and result.state == IntegrityState.VERIFIED, "complete matching backup must verify")
    damaged = BackupRestoreVerifier()
    failed = damaged.verify(
        manifest,
        db_digest=digest("corrupted-db"),
        object_digest=digest("objects-v1"),
        rights_digest=digest("rights-v1"),
        schema_fingerprint=digest("schema-v1"),
    )
    require(not failed.verified, "corrupt DB must not verify")
    require(damaged.safe_mode and failed.state == IntegrityState.RECOVERY_REQUIRED, "corruption must fence restore")


def test_ct16_migration_and_atomic_update_rollback() -> None:
    old_pair = CompatiblePair("1.0.0", 1, digest("package-v1"), True)
    update = make_update("2.0.0", "package-v2")
    update_digest = update.package_digest
    controller = UpdateController(old_pair)
    controller.stage(update, actual_package_digest=update_digest, available_disk_bytes=100)
    failed_migration = MigrationJournal("migration-failed", 1, 2, "backup-16")
    failed_migration.advance(MigrationPhase.SCHEMA)
    failed_migration.fail("power loss after schema step")
    expect_error(MigrationFailure, lambda: controller.activate(migration=failed_migration, resulting_schema_version=2))
    require(controller.state == UpdateState.MIGRATION_RECOVERY_REQUIRED, "mixed-version activation must be fenced")

    # A separate retry uses a resumable, fully verified journal and activates atomically.
    controller = UpdateController(old_pair)
    controller.stage(update, actual_package_digest=update_digest, available_disk_bytes=100)
    complete = migration_complete()
    activated = controller.activate(migration=complete, resulting_schema_version=2)
    require(activated.binary_version == "2.0.0" and activated.schema_version == 2, "compatible pair must activate")
    rolled_back = controller.rollback(old_pair, current_schema_version=1)
    require(rolled_back == old_pair and controller.state == UpdateState.ACTIVE, "known-good pair must roll back atomically")


def test_negative_inputs_and_idempotency() -> None:
    expect_error(ContractViolation, lambda: SQLiteHealthSample(-1, 0, False, 0, 0, 1, 1))
    expect_error(ContractViolation, lambda: SQLitePressureThresholds(200, 100, 300, 1_000, 500, 100, 10, 20))
    ledger = ResourceReservationLedger(100)
    ledger.reserve("r", "owner", 10)
    expect_error(ContractViolation, lambda: ledger.reserve("r", "other", 10))
    expect_error(ContractViolation, lambda: ledger.reserve("r", "owner", 11))
    controller = RecoveryEpochController(initial_epoch=1)
    receipt = controller.record_callback(callback_id="cb", job_id="job", callback_epoch=1)
    require(controller.record_callback(callback_id="cb", job_id="job", callback_epoch=1) == receipt, "callback retry must be idempotent")
    expect_error(ContractViolation, lambda: controller.record_callback(callback_id="cb", job_id="other", callback_epoch=1))
    unbound = controller.record_callback(callback_id="unbound", job_id="job", callback_epoch=1)
    require(not unbound.canonical_mutation_allowed, "an unbound callback must remain non-canonical")
    manifest = BackupManifest(
        "b", 1, digest("s"), digest("d"), digest("o"), digest("r"), 1, True,
        "REMOTE_DURABLE", "backup-region-a", True, True, True, True,
    )
    tampered = BackupRestoreVerifier().verify(
        manifest,
        db_digest=digest("d"),
        object_digest=digest("o"),
        rights_digest=digest("r"),
        schema_fingerprint=digest("s"),
        manifest_digest=digest("tampered-manifest"),
    )
    require(not tampered.verified and tampered.state == IntegrityState.RECOVERY_REQUIRED, "bad manifest digest must fence restore")
    expect_error(MigrationFailure, lambda: MigrationJournal("m", 1, 2, "b").complete())
    resumable = MigrationJournal("resumable", 1, 2, "b")
    resumable.advance(MigrationPhase.SCHEMA)
    resumable.checkpoint("schema-step", MigrationPhase.SCHEMA, input_digest=digest("schema-in"), output_digest=digest("schema-out"), schema_fingerprint=digest("schema-v2"))
    require(
        resumable.checkpoint("schema-step", MigrationPhase.SCHEMA, input_digest=digest("schema-in"), output_digest=digest("schema-out"), schema_fingerprint=digest("schema-v2")) is False,
        "identical migration checkpoint retry must be idempotent",
    )
    expect_error(
        MigrationFailure,
        lambda: resumable.checkpoint("schema-step", MigrationPhase.SCHEMA, input_digest=digest("changed-in"), output_digest=digest("schema-out"), schema_fingerprint=digest("schema-v2")),
    )
    complete = migration_complete()
    expect_error(MigrationFailure, lambda: complete.complete())
    old = CompatiblePair("1.0.0", 1, digest("old"), True)
    update_controller = UpdateController(old)
    unsigned = make_update("2.0.0", "unsigned", signature_verified=False, required_disk_bytes=1)
    expect_error(UpdateRejected, lambda: update_controller.stage(unsigned, actual_package_digest=unsigned.package_digest, available_disk_bytes=1))
    expect_error(
        UpdateRejected,
        lambda: make_update("1.0.0", "floor", floor="2.0.0", required_disk_bytes=1),
    )
    incompatible = make_update("2.0.0", "incompatible", min_schema=2, max_schema=3, required_disk_bytes=1)
    expect_error(UpdateRejected, lambda: update_controller.stage(incompatible, actual_package_digest=incompatible.package_digest, available_disk_bytes=1))
    mismatch = make_update("2.0.0", "mismatch", required_disk_bytes=1)
    expect_error(UpdateRejected, lambda: update_controller.stage(mismatch, actual_package_digest=digest("other"), available_disk_bytes=1))


def main() -> int:
    tests: list[tuple[str, Callable[[], None]]] = [
        ("CT-10", test_ct10_late_callback_epoch_fence),
        ("CT-11", test_ct11_old_outbox_policy_fence),
        ("CT-12", test_ct12_wal_pressure_stop_the_line),
        ("CT-13", test_ct13_atomic_space_reservation),
        ("CT-14", test_ct14_single_core_writer_fence),
        ("CT-15", test_ct15_backup_integrity_and_salvage_fence),
        ("CT-16", test_ct16_migration_and_atomic_update_rollback),
        ("NEGATIVE", test_negative_inputs_and_idempotency),
    ]
    passed = 0
    for label, test in tests:
        try:
            test()
        except BaseException as exc:
            print(f"FAIL {label}: {exc}")
            return 1
        print(f"PASS {label}")
        passed += 1
    print(f"L4_RECOVERY_SELFTEST=PASS cases={passed}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
