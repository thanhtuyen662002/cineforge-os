#!/usr/bin/env python3
"""Fail-closed reference contracts for the CineForge L4 safety boundary.

This module is a deterministic, dependency-free *contract harness*.  It is
deliberately not the CineForge product runtime and it does not open a SQLite
database, acquire an operating-system lock, verify a release signature, or
restore customer data.  Its purpose is to make the L4 invariants executable
while the product implementation and independent chaos runner are still
absent.

The classes model the safety decisions that a future runtime must preserve:

* recovery epochs fence callbacks and outbox entries from a pre-restore world;
* Core ownership has one active fencing token and rejects stale writers;
* SQLite pressure admission fails closed before protected data can be deleted;
* temporary-space reservations are admitted atomically, so aggregate
  overcommit cannot occur;
* backup manifests require complete, digest-matching DB/object/rights state;
* migration checkpoints are resumable and cannot report completion early; and
* update activation requires an authenticated, compatible and non-downgraded
  package, with rollback limited to a known-good compatible pair.

All byte counts, epochs, versions and thresholds are integers.  ``bool`` is
rejected where an integer is expected so that Python's ``True == 1`` coercion
cannot weaken a boundary.  Hashes use the explicit ``sha256:`` form.  The
public methods raise :class:`ContractViolation` subclasses for unsafe input or
state; callers must treat those failures as a blocked operation and preserve
the evidence for reconciliation.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Iterable, Mapping


SHA256_RE = re.compile(r"^sha256:[0-9a-f]{64}$")
VERSION_RE = re.compile(r"^(0|[1-9][0-9]*)(?:\.(0|[1-9][0-9]*)){0,3}$")
INSTANCE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$")
IDENTIFIER_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$")
MAX_SAFE_INTEGER = (1 << 63) - 1


class ContractViolation(ValueError):
    """Base class for a fail-closed contract rejection."""


class StaleRecoveryEpoch(ContractViolation):
    """An external effect belongs to an older restore epoch."""


class ReconciliationRequired(ContractViolation):
    """The operation must be reconciled before it can become canonical."""


class WriterFenced(ContractViolation):
    """A writer presents an inactive or stale ownership fence."""


class ResourceBlocked(ContractViolation):
    """Admission would cross a declared resource safety boundary."""


class IntegrityFailure(ContractViolation):
    """A backup or database integrity check did not verify."""


class MigrationFailure(ContractViolation):
    """A migration is incomplete or cannot safely advance."""


class UpdateRejected(ContractViolation):
    """An update cannot be staged, activated or rolled back safely."""


class RecoveryState(str, Enum):
    RESTORE_REQUESTED = "RESTORE_REQUESTED"
    RESTORING = "RESTORING"
    RECOVERY_RECONCILIATION = "RECOVERY_RECONCILIATION"
    READY_TO_ACTIVATE = "READY_TO_ACTIVATE"
    ACTIVE = "ACTIVE"
    BLOCKED = "BLOCKED"
    SUPERSEDED = "SUPERSEDED"


class ReconciliationDecision(str, Enum):
    ADOPT = "ADOPT"
    IGNORE = "IGNORE"
    COMPENSATE = "COMPENSATE"
    NEEDS_HUMAN = "NEEDS_HUMAN"
    UNKNOWN = "UNKNOWN"


class OutboxDisposition(str, Enum):
    DISPATCHABLE = "DISPATCHABLE"
    BLOCKED_BY_NEW_POLICY = "BLOCKED_BY_NEW_POLICY"
    SUPERSEDED = "SUPERSEDED"
    NEEDS_RECONCILIATION = "NEEDS_RECONCILIATION"


class CoreState(str, Enum):
    STARTING = "STARTING"
    ACTIVE_OWNER = "ACTIVE_OWNER"
    DRAINING = "DRAINING"
    STOPPED = "STOPPED"
    STALE_FENCED = "STALE_FENCED"
    CLIENT_OR_BLOCKED = "CLIENT_OR_BLOCKED"


class PressureState(str, Enum):
    NORMAL = "NORMAL"
    WARNING = "WARNING"
    CRITICAL = "CRITICAL"
    READ_ONLY_SAFE = "READ_ONLY_SAFE"
    RECOVERING = "RECOVERING"


class IntegrityState(str, Enum):
    UNCHECKED = "UNCHECKED"
    VERIFIED = "VERIFIED"
    CORRUPT_DETECTED = "CORRUPT_DETECTED"
    RECOVERY_REQUIRED = "RECOVERY_REQUIRED"


class MigrationPhase(str, Enum):
    PLANNED = "PLANNED"
    SCHEMA = "SCHEMA"
    BACKFILL = "BACKFILL"
    PROJECTIONS = "PROJECTIONS"
    INTEGRITY_CHECK = "INTEGRITY_CHECK"
    HEALTH_CHECK = "HEALTH_CHECK"
    COMPLETE = "COMPLETE"
    MIGRATION_RECOVERY_REQUIRED = "MIGRATION_RECOVERY_REQUIRED"


class ReservationState(str, Enum):
    ACTIVE = "ACTIVE"
    RELEASED = "RELEASED"


class UpdateState(str, Enum):
    IDLE = "IDLE"
    STAGED = "STAGED"
    ACTIVE = "ACTIVE"
    ROLLBACK_REQUIRED = "ROLLBACK_REQUIRED"
    MIGRATION_RECOVERY_REQUIRED = "MIGRATION_RECOVERY_REQUIRED"


class RollbackMode(str, Enum):
    FORWARD_ONLY = "FORWARD_ONLY"
    COMPATIBLE_PAIR_ONLY = "COMPATIBLE_PAIR_ONLY"


def _non_empty_text(name: str, value: object, *, maximum: int = 256) -> str:
    if not isinstance(value, str) or not value or len(value) > maximum:
        raise ContractViolation(f"{name} must be a non-empty string of at most {maximum} characters")
    if any(ord(char) < 0x20 or ord(char) == 0x7F for char in value):
        raise ContractViolation(f"{name} contains a control character")
    return value


def _identifier(name: str, value: object, *, pattern: re.Pattern[str] = IDENTIFIER_RE) -> str:
    value = _non_empty_text(name, value, maximum=128)
    if not pattern.fullmatch(value):
        raise ContractViolation(f"{name} has an invalid identifier")
    return value


def _nonnegative_int(name: str, value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0 or value > MAX_SAFE_INTEGER:
        raise ContractViolation(f"{name} must be a non-negative integer within the 64-bit safety bound")
    return value


def _positive_int(name: str, value: object) -> int:
    value = _nonnegative_int(name, value)
    if value == 0:
        raise ContractViolation(f"{name} must be positive")
    return value


def _sha256(name: str, value: object) -> str:
    value = _non_empty_text(name, value, maximum=71)
    if not SHA256_RE.fullmatch(value):
        raise ContractViolation(f"{name} must be a lowercase sha256 digest")
    return value


def _version(name: str, value: object) -> tuple[int, int, int, int]:
    value = _non_empty_text(name, value, maximum=31)
    if not VERSION_RE.fullmatch(value):
        raise ContractViolation(f"{name} must be a dotted non-negative integer version")
    # Normalize equivalent spellings (for example, 2 and 2.0.0) before
    # comparing versions; tuple comparison must never make a shorter spelling
    # unexpectedly newer or older than its expanded form.
    parts = tuple(int(part) for part in value.split("."))
    if any(part > MAX_SAFE_INTEGER for part in parts):
        raise ContractViolation(f"{name} has a version component beyond the 64-bit safety bound")
    return (*parts, *(0 for _ in range(4 - len(parts))))


def _canonical_digest(values: Mapping[str, str]) -> str:
    payload = "".join(f"{key}={values[key]}\n" for key in sorted(values)).encode("utf-8")
    return "sha256:" + hashlib.sha256(payload).hexdigest()


def _same_or_raise(name: str, previous: object, current: object) -> None:
    if previous != current:
        raise ContractViolation(f"{name} conflicts with an existing idempotency record")


@dataclass(frozen=True)
class CallbackReceipt:
    callback_id: str
    job_id: str
    callback_epoch: int
    active_epoch: int
    decision: ReconciliationDecision
    canonical_mutation_allowed: bool
    reason: str
    provider: str | None = None
    attempt_id: str | None = None
    deployment_id: str | None = None


@dataclass(frozen=True)
class OutboxEntry:
    entry_id: str
    recovery_epoch_id: int
    operation_id: str
    policy_version: int
    state: OutboxDisposition = OutboxDisposition.DISPATCHABLE

    def __post_init__(self) -> None:
        _identifier("entry_id", self.entry_id)
        _nonnegative_int("recovery_epoch_id", self.recovery_epoch_id)
        _identifier("operation_id", self.operation_id)
        _nonnegative_int("policy_version", self.policy_version)


class RecoveryEpochController:
    """Fence all external callbacks and dispatches at a monotonically new epoch."""

    _TRANSITIONS = {
        RecoveryState.RESTORE_REQUESTED: {RecoveryState.RESTORING, RecoveryState.BLOCKED},
        RecoveryState.RESTORING: {RecoveryState.RECOVERY_RECONCILIATION, RecoveryState.BLOCKED},
        RecoveryState.RECOVERY_RECONCILIATION: {RecoveryState.READY_TO_ACTIVATE, RecoveryState.BLOCKED},
        RecoveryState.READY_TO_ACTIVATE: {RecoveryState.ACTIVE, RecoveryState.BLOCKED},
        RecoveryState.ACTIVE: {RecoveryState.RESTORE_REQUESTED, RecoveryState.BLOCKED},
        RecoveryState.BLOCKED: {RecoveryState.RECOVERY_RECONCILIATION, RecoveryState.RESTORE_REQUESTED},
        RecoveryState.SUPERSEDED: set(),
    }

    def __init__(self, *, initial_epoch: int = 1, initial_state: RecoveryState = RecoveryState.ACTIVE) -> None:
        _nonnegative_int("initial_epoch", initial_epoch)
        if initial_state == RecoveryState.ACTIVE and initial_epoch == 0:
            raise ContractViolation("an ACTIVE recovery controller requires a non-zero epoch")
        self._epoch = initial_epoch
        self._state = initial_state
        self._reason = ""
        self._callback_receipts: dict[str, CallbackReceipt] = {}
        self._superseded_epochs: set[int] = set()

    @property
    def epoch(self) -> int:
        return self._epoch

    @property
    def state(self) -> RecoveryState:
        return self._state

    @property
    def blocked_reason(self) -> str:
        return self._reason

    def begin_restore(self, source_backup_id: str) -> int:
        _identifier("source_backup_id", source_backup_id)
        if self._state not in {RecoveryState.ACTIVE, RecoveryState.BLOCKED}:
            raise ReconciliationRequired(f"cannot begin restore from {self._state.value}")
        if self._epoch >= MAX_SAFE_INTEGER:
            raise ContractViolation("recovery epoch exhausted the 64-bit safety bound")
        if self._epoch:
            self._superseded_epochs.add(self._epoch)
        self._epoch += 1
        self._state = RecoveryState.RESTORE_REQUESTED
        self._reason = f"restore requested from {source_backup_id}"
        return self._epoch

    def transition(self, state: RecoveryState) -> None:
        if not isinstance(state, RecoveryState):
            raise ContractViolation("state must be a RecoveryState")
        if state not in self._TRANSITIONS[self._state]:
            raise ReconciliationRequired(f"illegal recovery transition {self._state.value}->{state.value}")
        self._state = state
        if state != RecoveryState.BLOCKED:
            self._reason = ""

    def block(self, reason: str) -> None:
        reason = _non_empty_text("reason", reason, maximum=512)
        if self._state == RecoveryState.SUPERSEDED:
            raise ReconciliationRequired("superseded recovery epoch cannot be unblocked")
        self._state = RecoveryState.BLOCKED
        self._reason = reason

    def assert_epoch(self, recovery_epoch_id: int) -> None:
        _nonnegative_int("recovery_epoch_id", recovery_epoch_id)
        if recovery_epoch_id != self._epoch:
            raise StaleRecoveryEpoch(
                f"epoch {recovery_epoch_id} is stale; active recovery epoch is {self._epoch}"
            )

    def assert_dispatchable(self, recovery_epoch_id: int) -> None:
        self.assert_epoch(recovery_epoch_id)
        if self._state != RecoveryState.ACTIVE:
            raise ReconciliationRequired(f"external dispatch is fenced while state is {self._state.value}")

    def record_callback(
        self,
        *,
        callback_id: str,
        job_id: str,
        callback_epoch: int,
        signature_verified: bool = True,
        provider: str | None = None,
        attempt_id: str | None = None,
        deployment_id: str | None = None,
    ) -> CallbackReceipt:
        callback_id = _identifier("callback_id", callback_id)
        job_id = _identifier("job_id", job_id)
        _nonnegative_int("callback_epoch", callback_epoch)
        if not isinstance(signature_verified, bool):
            raise ContractViolation("signature_verified must be boolean")
        binding_values = (provider, attempt_id, deployment_id)
        if any(value is not None and not isinstance(value, str) for value in binding_values):
            raise ContractViolation("callback provider/attempt/deployment bindings must be strings")
        binding_complete = all(
            isinstance(value, str) and bool(value)
            for value in binding_values
        )
        if binding_complete:
            provider = _identifier("provider", provider or "")
            attempt_id = _identifier("attempt_id", attempt_id or "")
            deployment_id = _identifier("deployment_id", deployment_id or "")
        prior = self._callback_receipts.get(callback_id)
        if prior is not None:
            _same_or_raise("callback job_id", prior.job_id, job_id)
            _same_or_raise("callback epoch", prior.callback_epoch, callback_epoch)
            _same_or_raise("callback provider", prior.provider, provider)
            _same_or_raise("callback attempt_id", prior.attempt_id, attempt_id)
            _same_or_raise("callback deployment_id", prior.deployment_id, deployment_id)
            return prior
        if callback_epoch != self._epoch:
            receipt = CallbackReceipt(
                callback_id,
                job_id,
                callback_epoch,
                self._epoch,
                ReconciliationDecision.NEEDS_HUMAN if signature_verified else ReconciliationDecision.UNKNOWN,
                False,
                "late callback belongs to a superseded recovery epoch",
                provider,
                attempt_id,
                deployment_id,
            )
        elif not signature_verified:
            receipt = CallbackReceipt(
                callback_id,
                job_id,
                callback_epoch,
                self._epoch,
                ReconciliationDecision.UNKNOWN,
                False,
                "callback signature is not verified",
                provider,
                attempt_id,
                deployment_id,
            )
        elif self._state != RecoveryState.ACTIVE:
            receipt = CallbackReceipt(
                callback_id,
                job_id,
                callback_epoch,
                self._epoch,
                ReconciliationDecision.NEEDS_HUMAN,
                False,
                f"callback arrived while recovery is {self._state.value}",
                provider,
                attempt_id,
                deployment_id,
            )
        elif not binding_complete:
            receipt = CallbackReceipt(
                callback_id,
                job_id,
                callback_epoch,
                self._epoch,
                ReconciliationDecision.NEEDS_HUMAN,
                False,
                "callback lacks provider, attempt and deployment binding",
                provider,
                attempt_id,
                deployment_id,
            )
        else:
            receipt = CallbackReceipt(
                callback_id,
                job_id,
                callback_epoch,
                self._epoch,
                ReconciliationDecision.ADOPT,
                True,
                "callback belongs to the active recovery epoch",
                provider,
                attempt_id,
                deployment_id,
            )
        self._callback_receipts[callback_id] = receipt
        return receipt

    def evaluate_outbox(
        self,
        entry: OutboxEntry,
        *,
        policy_version: int,
        revoked_operation_ids: Iterable[str] = (),
    ) -> OutboxDisposition:
        if not isinstance(entry, OutboxEntry):
            raise ContractViolation("entry must be an OutboxEntry")
        _nonnegative_int("policy_version", policy_version)
        revoked = {_identifier("revoked_operation_id", value) for value in revoked_operation_ids}
        if entry.operation_id in revoked or entry.policy_version < policy_version:
            return OutboxDisposition.BLOCKED_BY_NEW_POLICY
        if entry.recovery_epoch_id != self._epoch:
            return OutboxDisposition.SUPERSEDED
        if self._state != RecoveryState.ACTIVE:
            return OutboxDisposition.NEEDS_RECONCILIATION
        return OutboxDisposition.DISPATCHABLE


@dataclass(frozen=True)
class CoreLease:
    instance_id: str
    instance_epoch: int
    fencing_token: str
    state: CoreState


class CoreOwnership:
    """Model the singleton Core ownership row and database/IPC fence."""

    def __init__(self) -> None:
        self._instance_epoch = 0
        self._active: CoreLease | None = None
        self._states: dict[str, CoreState] = {}

    @property
    def active(self) -> CoreLease | None:
        return self._active

    def acquire(self, instance_id: str) -> CoreLease:
        instance_id = _identifier("instance_id", instance_id, pattern=INSTANCE_RE)
        if self._active is not None:
            if self._active.instance_id == instance_id and self._active.state == CoreState.ACTIVE_OWNER:
                return self._active
            self._states[instance_id] = CoreState.CLIENT_OR_BLOCKED
            raise WriterFenced(f"Core owner {self._active.instance_id} already holds the writer fence")
        if self._instance_epoch >= MAX_SAFE_INTEGER:
            raise WriterFenced("Core instance epoch exhausted the 64-bit safety bound")
        self._instance_epoch += 1
        token = _canonical_digest({"INSTANCE_ID": instance_id, "INSTANCE_EPOCH": str(self._instance_epoch)})
        lease = CoreLease(instance_id, self._instance_epoch, token, CoreState.ACTIVE_OWNER)
        self._active = lease
        self._states[instance_id] = CoreState.ACTIVE_OWNER
        return lease

    def takeover(self, instance_id: str) -> CoreLease:
        return self._takeover(instance_id, expected_current=None)

    def _takeover(self, instance_id: str, *, expected_current: CoreLease | None) -> CoreLease:
        instance_id = _identifier("instance_id", instance_id, pattern=INSTANCE_RE)
        if self._active is not None:
            if expected_current is None:
                raise WriterFenced("takeover requires evidence of the current owner fence")
            self.assert_owner(expected_current)
            self._states[self._active.instance_id] = CoreState.STALE_FENCED
        self._active = None
        return self.acquire(instance_id)

    def takeover_with_fence(self, instance_id: str, expected_current: CoreLease) -> CoreLease:
        """Take over only after the caller proves the observed current fence."""
        return self._takeover(instance_id, expected_current=expected_current)

    def stop(self, lease: CoreLease) -> None:
        self.assert_owner(lease)
        self._states[lease.instance_id] = CoreState.DRAINING
        self._states[lease.instance_id] = CoreState.STOPPED
        # The singleton ownership row is released only after the active owner
        # has drained.  Keeping a STOPPED lease in ``_active`` would strand the
        # database and make a clean restart indistinguishable from a zombie.
        self._active = None

    def assert_owner(self, lease: CoreLease) -> None:
        if not isinstance(lease, CoreLease):
            raise WriterFenced("missing Core ownership lease")
        active = self._active
        if active is None or active.state != CoreState.ACTIVE_OWNER:
            raise WriterFenced("no active Core writer exists")
        if lease != active:
            raise WriterFenced("writer fencing token or instance epoch is stale")

    def mutate(self, lease: CoreLease, mutation_id: str) -> str:
        self.assert_owner(lease)
        return _identifier("mutation_id", mutation_id)

    def state_for(self, instance_id: str) -> CoreState | None:
        return self._states.get(_identifier("instance_id", instance_id, pattern=INSTANCE_RE))


@dataclass(frozen=True)
class SQLiteHealthSample:
    wal_bytes: int
    oldest_read_tx_age_ms: int
    checkpoint_blocked: bool
    writer_queue_depth: int
    write_latency_ms: int
    free_db_bytes: int
    free_temp_bytes: int
    integrity: IntegrityState = IntegrityState.UNCHECKED

    def __post_init__(self) -> None:
        for name in (
            "wal_bytes",
            "oldest_read_tx_age_ms",
            "writer_queue_depth",
            "write_latency_ms",
            "free_db_bytes",
            "free_temp_bytes",
        ):
            _nonnegative_int(name, getattr(self, name))
        if not isinstance(self.checkpoint_blocked, bool):
            raise ContractViolation("checkpoint_blocked must be boolean")
        if not isinstance(self.integrity, IntegrityState):
            raise ContractViolation("integrity must be an IntegrityState")


@dataclass(frozen=True)
class SQLitePressureThresholds:
    warning_wal_bytes: int
    critical_wal_bytes: int
    read_only_wal_bytes: int
    warning_free_db_bytes: int
    critical_free_db_bytes: int
    read_only_free_db_bytes: int
    warning_read_age_ms: int
    critical_read_age_ms: int

    def __post_init__(self) -> None:
        values = (
            "warning_wal_bytes",
            "critical_wal_bytes",
            "read_only_wal_bytes",
            "warning_free_db_bytes",
            "critical_free_db_bytes",
            "read_only_free_db_bytes",
            "warning_read_age_ms",
            "critical_read_age_ms",
        )
        for name in values:
            _nonnegative_int(name, getattr(self, name))
        if not self.warning_wal_bytes < self.critical_wal_bytes <= self.read_only_wal_bytes:
            raise ContractViolation("WAL thresholds must be warning < critical <= read-only")
        if not self.warning_free_db_bytes > self.critical_free_db_bytes >= self.read_only_free_db_bytes:
            raise ContractViolation("free-space thresholds must be warning > critical >= read-only")
        if not self.warning_read_age_ms < self.critical_read_age_ms:
            raise ContractViolation("read-age thresholds must be warning < critical")


class SQLitePressurePolicy:
    """Classify health and fence writes/deletions at the stop-the-line boundary."""

    def __init__(self, thresholds: SQLitePressureThresholds) -> None:
        if not isinstance(thresholds, SQLitePressureThresholds):
            raise ContractViolation("thresholds must be SQLitePressureThresholds")
        self.thresholds = thresholds

    def classify(self, sample: SQLiteHealthSample) -> PressureState:
        if not isinstance(sample, SQLiteHealthSample):
            raise ContractViolation("sample must be SQLiteHealthSample")
        if sample.integrity in {IntegrityState.CORRUPT_DETECTED, IntegrityState.RECOVERY_REQUIRED}:
            return PressureState.RECOVERING
        read_only = (
            sample.wal_bytes >= self.thresholds.read_only_wal_bytes
            or sample.free_db_bytes <= self.thresholds.read_only_free_db_bytes
        )
        if read_only:
            return PressureState.READ_ONLY_SAFE
        critical = (
            sample.wal_bytes >= self.thresholds.critical_wal_bytes
            or sample.free_db_bytes <= self.thresholds.critical_free_db_bytes
            or sample.oldest_read_tx_age_ms >= self.thresholds.critical_read_age_ms
            or sample.checkpoint_blocked
        )
        if critical:
            return PressureState.CRITICAL
        warning = (
            sample.wal_bytes >= self.thresholds.warning_wal_bytes
            or sample.free_db_bytes <= self.thresholds.warning_free_db_bytes
            or sample.oldest_read_tx_age_ms >= self.thresholds.warning_read_age_ms
            or sample.writer_queue_depth > 0
        )
        return PressureState.WARNING if warning else PressureState.NORMAL

    def admit_write(self, sample: SQLiteHealthSample, *, protected: bool = False) -> None:
        if not isinstance(protected, bool):
            raise ContractViolation("protected must be boolean")
        state = self.classify(sample)
        if state in {PressureState.CRITICAL, PressureState.READ_ONLY_SAFE, PressureState.RECOVERING}:
            raise ResourceBlocked(f"writes are fenced in {state.value}")

    def admit_protected_deletion(self, sample: SQLiteHealthSample) -> None:
        # Protected originals/approved canon are never pressure-eviction targets.
        raise ResourceBlocked(f"protected deletion is forbidden under {self.classify(sample).value} pressure")


@dataclass(frozen=True)
class Reservation:
    reservation_id: str
    owner: str
    bytes_reserved: int
    state: ReservationState

    def __post_init__(self) -> None:
        _identifier("reservation_id", self.reservation_id)
        _identifier("owner", self.owner)
        _positive_int("bytes_reserved", self.bytes_reserved)
        if not isinstance(self.state, ReservationState):
            raise ContractViolation("reservation state is invalid")


class ResourceReservationLedger:
    """Atomically reserve temporary bytes while preserving a free-space floor."""

    def __init__(self, capacity_bytes: int, *, protected_free_floor_bytes: int = 0) -> None:
        self.capacity_bytes = _positive_int("capacity_bytes", capacity_bytes)
        self.protected_free_floor_bytes = _nonnegative_int(
            "protected_free_floor_bytes", protected_free_floor_bytes
        )
        if self.protected_free_floor_bytes >= self.capacity_bytes:
            raise ContractViolation("protected free-space floor must be below capacity")
        self._reservations: dict[str, Reservation] = {}

    @property
    def active_bytes(self) -> int:
        return sum(item.bytes_reserved for item in self._reservations.values() if item.state == ReservationState.ACTIVE)

    @property
    def available_bytes(self) -> int:
        return self.capacity_bytes - self.protected_free_floor_bytes - self.active_bytes

    def reserve(self, reservation_id: str, owner: str, bytes_reserved: int) -> Reservation:
        reservation_id = _identifier("reservation_id", reservation_id)
        owner = _identifier("owner", owner)
        bytes_reserved = _positive_int("bytes_reserved", bytes_reserved)
        prior = self._reservations.get(reservation_id)
        if prior is not None:
            _same_or_raise("reservation owner", prior.owner, owner)
            _same_or_raise("reservation bytes", prior.bytes_reserved, bytes_reserved)
            return prior
        if bytes_reserved > self.available_bytes:
            raise ResourceBlocked("aggregate temporary-space reservations would overcommit capacity")
        reservation = Reservation(reservation_id, owner, bytes_reserved, ReservationState.ACTIVE)
        self._reservations[reservation_id] = reservation
        return reservation

    def release(self, reservation_id: str) -> Reservation:
        reservation_id = _identifier("reservation_id", reservation_id)
        prior = self._reservations.get(reservation_id)
        if prior is None:
            raise ContractViolation(f"unknown reservation {reservation_id}")
        if prior.state == ReservationState.RELEASED:
            return prior
        released = Reservation(prior.reservation_id, prior.owner, prior.bytes_reserved, ReservationState.RELEASED)
        self._reservations[reservation_id] = released
        return released

    def get(self, reservation_id: str) -> Reservation:
        reservation_id = _identifier("reservation_id", reservation_id)
        try:
            return self._reservations[reservation_id]
        except KeyError as exc:
            raise ContractViolation(f"unknown reservation {reservation_id}") from exc


@dataclass(frozen=True)
class BackupManifest:
    backup_id: str
    sequence: int
    schema_fingerprint: str
    db_digest: str
    object_digest: str
    rights_digest: str
    recovery_epoch_id: int
    complete: bool
    durability_class: str = ""
    failure_domain: str = ""
    authentication_verified: bool = False
    encryption_verified: bool = False
    decryptability_verified: bool = False
    restore_drill_verified: bool = False

    def __post_init__(self) -> None:
        _identifier("backup_id", self.backup_id)
        _positive_int("sequence", self.sequence)
        _sha256("schema_fingerprint", self.schema_fingerprint)
        _sha256("db_digest", self.db_digest)
        _sha256("object_digest", self.object_digest)
        _sha256("rights_digest", self.rights_digest)
        _nonnegative_int("recovery_epoch_id", self.recovery_epoch_id)
        if not isinstance(self.complete, bool):
            raise ContractViolation("complete must be boolean")
        _non_empty_text("durability_class", self.durability_class, maximum=64)
        _non_empty_text("failure_domain", self.failure_domain, maximum=128)
        for name in (
            "authentication_verified",
            "encryption_verified",
            "decryptability_verified",
            "restore_drill_verified",
        ):
            if not isinstance(getattr(self, name), bool):
                raise ContractViolation(f"{name} must be boolean")

    @property
    def manifest_digest(self) -> str:
        return _canonical_digest(
            {
                "BACKUP_ID": self.backup_id,
                "AUTHENTICATION_VERIFIED": str(self.authentication_verified).lower(),
                "COMPLETE": str(self.complete).lower(),
                "DB_DIGEST": self.db_digest,
                "DECRYPTABILITY_VERIFIED": str(self.decryptability_verified).lower(),
                "DURABILITY_CLASS": self.durability_class,
                "ENCRYPTION_VERIFIED": str(self.encryption_verified).lower(),
                "FAILURE_DOMAIN": self.failure_domain,
                "OBJECT_DIGEST": self.object_digest,
                "RECOVERY_EPOCH_ID": str(self.recovery_epoch_id),
                "RIGHTS_DIGEST": self.rights_digest,
                "RESTORE_DRILL_VERIFIED": str(self.restore_drill_verified).lower(),
                "SCHEMA_FINGERPRINT": self.schema_fingerprint,
                "SEQUENCE": str(self.sequence),
            }
        )


@dataclass(frozen=True)
class RestoreResult:
    verified: bool
    state: IntegrityState
    reason: str


class BackupRestoreVerifier:
    """Verify all backup dimensions without mutating or deleting source data."""

    def __init__(self) -> None:
        self.state = IntegrityState.UNCHECKED
        self.safe_mode = False

    def verify(
        self,
        manifest: BackupManifest,
        *,
        db_digest: str,
        object_digest: str,
        rights_digest: str,
        schema_fingerprint: str,
        manifest_digest: str | None = None,
    ) -> RestoreResult:
        if not isinstance(manifest, BackupManifest):
            raise ContractViolation("manifest must be a BackupManifest")
        db_digest = _sha256("db_digest", db_digest)
        object_digest = _sha256("object_digest", object_digest)
        rights_digest = _sha256("rights_digest", rights_digest)
        schema_fingerprint = _sha256("schema_fingerprint", schema_fingerprint)
        if manifest_digest is not None:
            manifest_digest = _sha256("manifest_digest", manifest_digest)
        failures: list[str] = []
        if not manifest.complete:
            failures.append("backup completion marker is false")
        if not manifest.authentication_verified:
            failures.append("backup authenticity is not verified")
        if not manifest.encryption_verified:
            failures.append("backup encryption/key verification is not recorded")
        if not manifest.decryptability_verified:
            failures.append("backup decryptability is not verified")
        if not manifest.restore_drill_verified:
            failures.append("backup restore drill is not verified")
        if manifest.db_digest != db_digest:
            failures.append("database digest mismatch")
        if manifest.object_digest != object_digest:
            failures.append("object manifest digest mismatch")
        if manifest.rights_digest != rights_digest:
            failures.append("rights manifest digest mismatch")
        if manifest.schema_fingerprint != schema_fingerprint:
            failures.append("schema fingerprint mismatch")
        if manifest_digest is None:
            failures.append("backup manifest digest evidence is missing")
        elif manifest.manifest_digest != manifest_digest:
            failures.append("backup manifest digest mismatch")
        if failures:
            self.state = IntegrityState.RECOVERY_REQUIRED
            self.safe_mode = True
            return RestoreResult(False, self.state, "; ".join(failures))
        self.state = IntegrityState.VERIFIED
        self.safe_mode = False
        return RestoreResult(True, self.state, "DB/object/rights/schema/authenticity manifest verified")


@dataclass
class MigrationJournal:
    migration_id: str
    from_schema: int
    to_schema: int
    backup_id: str
    phase: MigrationPhase = MigrationPhase.PLANNED
    last_completed_step: str = "none"
    completed_steps: set[str] = field(default_factory=set)
    step_records: dict[str, tuple[str, str, str]] = field(default_factory=dict)
    failure_reason: str = ""
    integrity_verified: bool = False
    health_verified: bool = False

    def __post_init__(self) -> None:
        _identifier("migration_id", self.migration_id)
        _nonnegative_int("from_schema", self.from_schema)
        _positive_int("to_schema", self.to_schema)
        _identifier("backup_id", self.backup_id)
        if self.to_schema <= self.from_schema:
            raise MigrationFailure("forward migration must increase the schema version")
        if not isinstance(self.phase, MigrationPhase):
            raise MigrationFailure("invalid migration phase")

    _PHASE_ORDER = {
        MigrationPhase.PLANNED: 0,
        MigrationPhase.SCHEMA: 1,
        MigrationPhase.BACKFILL: 2,
        MigrationPhase.PROJECTIONS: 3,
        MigrationPhase.INTEGRITY_CHECK: 4,
        MigrationPhase.HEALTH_CHECK: 5,
        MigrationPhase.COMPLETE: 6,
    }

    def advance(self, phase: MigrationPhase) -> None:
        if self.phase == MigrationPhase.MIGRATION_RECOVERY_REQUIRED:
            raise MigrationFailure("migration requires recovery before it can resume")
        if not isinstance(phase, MigrationPhase) or phase not in self._PHASE_ORDER:
            raise MigrationFailure("phase cannot be advanced")
        if self._PHASE_ORDER[phase] != self._PHASE_ORDER[self.phase] + 1:
            raise MigrationFailure(f"migration phase must advance one step: {self.phase.value}->{phase.value}")
        self.phase = phase

    def checkpoint(
        self,
        step_id: str,
        phase: MigrationPhase,
        *,
        input_digest: str | None = None,
        output_digest: str | None = None,
        schema_fingerprint: str | None = None,
    ) -> bool:
        step_id = _identifier("step_id", step_id)
        if not isinstance(phase, MigrationPhase):
            raise MigrationFailure("checkpoint phase is invalid")
        if self.phase != phase:
            raise MigrationFailure(f"checkpoint phase {phase.value} does not match {self.phase.value}")
        if input_digest is None or output_digest is None or schema_fingerprint is None:
            raise MigrationFailure("checkpoint requires input/output/schema fingerprints")
        input_digest = _sha256("input_digest", input_digest)
        output_digest = _sha256("output_digest", output_digest)
        schema_fingerprint = _sha256("schema_fingerprint", schema_fingerprint)
        record = (input_digest, output_digest, schema_fingerprint)
        if step_id in self.completed_steps:
            if self.step_records.get(step_id) != record:
                raise MigrationFailure("replayed migration step has a conflicting fingerprint")
            return False
        self.completed_steps.add(step_id)
        self.step_records[step_id] = record
        self.last_completed_step = step_id
        return True

    def mark_integrity_verified(self) -> None:
        if self.phase != MigrationPhase.INTEGRITY_CHECK:
            raise MigrationFailure("integrity can only be verified in INTEGRITY_CHECK")
        self.integrity_verified = True

    def mark_health_verified(self) -> None:
        if self.phase != MigrationPhase.HEALTH_CHECK or not self.integrity_verified:
            raise MigrationFailure("health requires a verified integrity phase")
        self.health_verified = True

    def complete(self) -> None:
        if self.phase != MigrationPhase.HEALTH_CHECK or not self.integrity_verified or not self.health_verified:
            raise MigrationFailure("migration cannot complete before integrity and health checks")
        self.advance(MigrationPhase.COMPLETE)

    def fail(self, reason: str) -> None:
        if self.phase == MigrationPhase.COMPLETE:
            raise MigrationFailure("a completed migration cannot be rewritten as failed")
        self.failure_reason = _non_empty_text("failure_reason", reason, maximum=512)
        self.phase = MigrationPhase.MIGRATION_RECOVERY_REQUIRED

    @property
    def is_complete(self) -> bool:
        return self.phase == MigrationPhase.COMPLETE


@dataclass(frozen=True)
class CompatiblePair:
    binary_version: str
    schema_version: int
    package_digest: str
    signature_verified: bool

    def __post_init__(self) -> None:
        _version("binary_version", self.binary_version)
        _positive_int("schema_version", self.schema_version)
        _sha256("package_digest", self.package_digest)
        if not isinstance(self.signature_verified, bool):
            raise ContractViolation("signature_verified must be boolean")


@dataclass(frozen=True)
class UpdateManifest:
    binary_version: str
    min_schema: int
    max_schema: int
    package_digest: str
    signature_verified: bool
    rollback_mode: RollbackMode
    anti_rollback_floor: str
    required_disk_bytes: int
    manifest_id: str = ""
    channel: str = ""
    platform: str = ""
    architecture: str = ""
    signer_verified: bool = False
    freshness_verified: bool = False
    source_revision: str = ""
    release_epoch: int = 0

    def __post_init__(self) -> None:
        version = _version("binary_version", self.binary_version)
        _positive_int("min_schema", self.min_schema)
        _positive_int("max_schema", self.max_schema)
        if self.max_schema < self.min_schema:
            raise UpdateRejected("max_schema must be at least min_schema")
        _sha256("package_digest", self.package_digest)
        if not isinstance(self.signature_verified, bool):
            raise UpdateRejected("signature_verified must be boolean")
        if not isinstance(self.rollback_mode, RollbackMode):
            raise UpdateRejected("rollback_mode is invalid")
        floor = _version("anti_rollback_floor", self.anti_rollback_floor)
        if version < floor:
            raise UpdateRejected("update binary is below its anti-rollback floor")
        _positive_int("required_disk_bytes", self.required_disk_bytes)
        _identifier("manifest_id", self.manifest_id)
        _identifier("channel", self.channel)
        _identifier("platform", self.platform)
        _identifier("architecture", self.architecture)
        for name in ("signer_verified", "freshness_verified"):
            if not isinstance(getattr(self, name), bool):
                raise UpdateRejected(f"{name} must be boolean")
        _sha256("source_revision", self.source_revision)
        _positive_int("release_epoch", self.release_epoch)


class UpdateController:
    """Stage/activate/rollback a compatible binary/schema pair atomically."""

    def __init__(self, current: CompatiblePair, *, known_good: CompatiblePair | None = None) -> None:
        if not isinstance(current, CompatiblePair):
            raise ContractViolation("current must be a CompatiblePair")
        self.current = current
        self.known_good = known_good or current
        if not self.current.signature_verified or not self.known_good.signature_verified:
            raise UpdateRejected("active and known-good pairs must have verified signatures")
        self.state = UpdateState.ACTIVE
        self._staged: UpdateManifest | None = None
        self._rollback_allowed = False

    def stage(
        self,
        manifest: UpdateManifest,
        *,
        actual_package_digest: str,
        available_disk_bytes: int,
    ) -> None:
        if not isinstance(manifest, UpdateManifest):
            raise UpdateRejected("manifest must be an UpdateManifest")
        actual_package_digest = _sha256("actual_package_digest", actual_package_digest)
        available_disk_bytes = _nonnegative_int("available_disk_bytes", available_disk_bytes)
        if not manifest.signature_verified:
            raise UpdateRejected("package signature is not verified")
        if not manifest.signer_verified or not manifest.freshness_verified:
            raise UpdateRejected("update signer/freshness metadata is not verified")
        if manifest.package_digest != actual_package_digest:
            raise UpdateRejected("package digest does not match the downloaded bytes")
        if not manifest.min_schema <= self.current.schema_version <= manifest.max_schema:
            raise UpdateRejected("current schema is outside the update compatibility range")
        if _version("binary_version", manifest.binary_version) < _version("current_version", self.current.binary_version):
            raise UpdateRejected("update would silently downgrade the active binary")
        if available_disk_bytes < manifest.required_disk_bytes:
            raise ResourceBlocked("update temporary-space headroom is insufficient")
        self._staged = manifest
        self._rollback_allowed = manifest.rollback_mode == RollbackMode.COMPATIBLE_PAIR_ONLY
        self.state = UpdateState.STAGED

    def activate(self, *, migration: MigrationJournal, resulting_schema_version: int) -> CompatiblePair:
        if self.state != UpdateState.STAGED or self._staged is None:
            raise UpdateRejected("no verified update is staged")
        if not isinstance(migration, MigrationJournal):
            raise UpdateRejected("migration journal is required")
        resulting_schema_version = _positive_int("resulting_schema_version", resulting_schema_version)
        manifest = self._staged
        if not migration.is_complete:
            self.state = UpdateState.MIGRATION_RECOVERY_REQUIRED
            raise MigrationFailure("update activation is fenced until migration is complete")
        if migration.from_schema != self.current.schema_version:
            self.state = UpdateState.MIGRATION_RECOVERY_REQUIRED
            raise UpdateRejected("migration source schema does not match the active pair")
        if resulting_schema_version != migration.to_schema:
            self.state = UpdateState.MIGRATION_RECOVERY_REQUIRED
            raise UpdateRejected("resulting schema does not match the migration target")
        if not manifest.min_schema <= resulting_schema_version <= manifest.max_schema:
            self.state = UpdateState.MIGRATION_RECOVERY_REQUIRED
            raise UpdateRejected("resulting schema is outside the update compatibility range")
        pair = CompatiblePair(manifest.binary_version, resulting_schema_version, manifest.package_digest, True)
        self.known_good = self.current
        self.current = pair
        self._staged = None
        self.state = UpdateState.ACTIVE
        return pair

    def rollback(self, pair: CompatiblePair, *, current_schema_version: int) -> CompatiblePair:
        if not isinstance(pair, CompatiblePair):
            raise UpdateRejected("rollback target must be a CompatiblePair")
        if not self._rollback_allowed:
            raise UpdateRejected("staged update does not permit compatible-pair rollback")
        current_schema_version = _positive_int("current_schema_version", current_schema_version)
        if not pair.signature_verified:
            raise UpdateRejected("rollback target signature is not verified")
        if pair != self.known_good:
            raise UpdateRejected("rollback target is not the recorded known-good pair")
        if pair.schema_version != current_schema_version:
            raise UpdateRejected("rollback would create a mixed binary/schema pair")
        if _version("rollback_version", pair.binary_version) > _version("current_version", self.current.binary_version):
            raise UpdateRejected("rollback target cannot be newer than the active binary")
        self.current = pair
        self._staged = None
        self.state = UpdateState.ACTIVE
        return pair


__all__ = [
    "BackupManifest",
    "BackupRestoreVerifier",
    "CallbackReceipt",
    "CompatiblePair",
    "ContractViolation",
    "CoreLease",
    "CoreOwnership",
    "CoreState",
    "IntegrityFailure",
    "IntegrityState",
    "MigrationFailure",
    "MigrationJournal",
    "MigrationPhase",
    "OutboxDisposition",
    "OutboxEntry",
    "PressureState",
    "ReconciliationDecision",
    "ReconciliationRequired",
    "RecoveryEpochController",
    "RecoveryState",
    "Reservation",
    "ReservationState",
    "ResourceBlocked",
    "ResourceReservationLedger",
    "RollbackMode",
    "SQLiteHealthSample",
    "SQLitePressurePolicy",
    "SQLitePressureThresholds",
    "StaleRecoveryEpoch",
    "UpdateController",
    "UpdateManifest",
    "UpdateRejected",
    "UpdateState",
    "WriterFenced",
]
