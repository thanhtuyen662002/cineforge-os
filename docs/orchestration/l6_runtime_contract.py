#!/usr/bin/env python3
"""Fail-closed reference contracts for the CineForge L6 safety boundary.

This deterministic standard-library harness is not the CineForge product
runtime.  It does not reserve a real GPU, start a worker, access a camera,
call a provider, or publish to an external platform.  It makes the resource,
cost, fanout, capture and publication decisions executable until independent
runtime implementations and verifiers exist.

The model covers:

* atomic multi-resource and cost reservations with fencing, headroom, expiry
  and append-only usage adjustments;
* bounded worker crash retries with exponential backoff, poison quarantine and
  completed-side-effect idempotency;
* pinned-revision fanout planning, exposure caps, resumable dispatch and
  manual-lock revision fences;
* capture-session ownership/device/permission binding and quarantined output;
* publication idempotency, unknown external outcomes and proof-gated retry.

All quantities are bounded integers and ``bool`` is rejected where an integer
is expected.  Unsafe operations raise typed contract violations or return an
explicit blocked/quarantined state; callers must not treat a partial result as
canonical success.
"""

from __future__ import annotations

import hashlib
import sys
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Iterable, Mapping, Sequence

try:
    from l4_recovery_contract import (  # type: ignore
        ContractViolation,
        MAX_SAFE_INTEGER,
        ResourceBlocked,
        _identifier,
        _nonnegative_int,
        _positive_int,
        _sha256,
    )
except ModuleNotFoundError as exc:  # package-style import from repository root
    if exc.name != "l4_recovery_contract":
        raise
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from l4_recovery_contract import (  # type: ignore
        ContractViolation,
        MAX_SAFE_INTEGER,
        ResourceBlocked,
        _identifier,
        _nonnegative_int,
        _positive_int,
        _sha256,
    )


class AdmissionBlocked(ContractViolation):
    """A resource, money or exposure admission would cross a hard bound."""


class RetryQuarantined(ContractViolation):
    """A worker/job retry is poisoned, stale or would duplicate an effect."""


class FanoutBlocked(ContractViolation):
    """A fanout plan or late result is stale, over budget or manually fenced."""


class CaptureBlocked(ContractViolation):
    """Capture ownership, permission or device identity is not safe."""


class PublicationUnknown(ContractViolation):
    """An external publication outcome lacks sufficient reconciliation proof."""


def _text(name: str, value: object, *, maximum: int = 512) -> str:
    if not isinstance(value, str) or not value or len(value) > maximum:
        raise ContractViolation(f"{name} must be non-empty text of at most {maximum} characters")
    if any(ord(char) < 0x20 or ord(char) == 0x7F for char in value):
        raise ContractViolation(f"{name} contains a control character")
    return value


def _bool(name: str, value: object) -> bool:
    if not isinstance(value, bool):
        raise ContractViolation(f"{name} must be boolean")
    return value


def _enum(name: str, value: object, enum_type: type[Enum]) -> Enum:
    if not isinstance(value, enum_type):
        raise ContractViolation(f"{name} must be {enum_type.__name__}")
    return value


def digest(label: str) -> str:
    """Return a deterministic fixture digest; this function handles no secrets."""
    return "sha256:" + hashlib.sha256(label.encode("utf-8")).hexdigest()


class ReservationState(str, Enum):
    RESERVED = "RESERVED"
    ACTIVE = "ACTIVE"
    RELEASED = "RELEASED"
    EXPIRED = "EXPIRED"
    REVOKED = "REVOKED"
    UNKNOWN = "UNKNOWN"
    BLOCKED = "BLOCKED"


class CrashState(str, Enum):
    RUNNING = "RUNNING"
    BACKOFF = "BACKOFF"
    COMPLETED_NO_RETRY = "COMPLETED_NO_RETRY"
    QUARANTINED = "QUARANTINED"


class DispatchMode(str, Enum):
    SAMPLE_FIRST = "SAMPLE_FIRST"
    STAGED = "STAGED"
    FULL = "FULL"


class DispatchState(str, Enum):
    PLANNED = "PLANNED"
    SAMPLING = "SAMPLING"
    PAUSED_FOR_SAMPLE_DECISION = "PAUSED_FOR_SAMPLE_DECISION"
    DISPATCHING = "DISPATCHING"
    COMPLETE = "COMPLETE"
    CANCELLED = "CANCELLED"
    INVALIDATED = "INVALIDATED"
    PLAN_BLOCKED = "PLAN_BLOCKED"


class CandidateState(str, Enum):
    CANDIDATE = "CANDIDATE"
    STALE_CANDIDATE = "STALE_CANDIDATE"
    REJECTED = "REJECTED"


class CaptureState(str, Enum):
    REQUESTED = "REQUESTED"
    PERMISSION_CHECK = "PERMISSION_CHECK"
    DEVICE_BOUND = "DEVICE_BOUND"
    ACTIVE = "ACTIVE"
    STOP_REQUESTED = "STOP_REQUESTED"
    STOP_CONFIRMED = "STOP_CONFIRMED"
    PERMISSION_DENIED = "PERMISSION_DENIED"
    DEVICE_CHANGED = "DEVICE_CHANGED"
    DEVICE_LOST = "DEVICE_LOST"
    STOP_FAILED = "STOP_FAILED"
    QUARANTINED_OUTPUT = "QUARANTINED_OUTPUT"


class PublicationState(str, Enum):
    READY = "READY"
    PUBLISHING = "PUBLISHING"
    UNKNOWN_EXTERNAL_OUTCOME = "UNKNOWN_EXTERNAL_OUTCOME"
    DELIVERED = "DELIVERED"
    RETRY_AUTHORIZED = "RETRY_AUTHORIZED"
    COMPENSATION_REQUIRED = "COMPENSATION_REQUIRED"


class UsageEventType(str, Enum):
    CHARGE = "CHARGE"
    CORRECTION = "CORRECTION"
    REFUND = "REFUND"
    CREDIT = "CREDIT"
    FX_ADJUSTMENT = "FX_ADJUSTMENT"


@dataclass(frozen=True)
class ResourceCapacity:
    resource_id: str
    resource_type: str
    capacity: int
    safety_headroom: int

    def __post_init__(self) -> None:
        _identifier("resource_id", self.resource_id)
        _identifier("resource_type", self.resource_type)
        _positive_int("capacity", self.capacity)
        _nonnegative_int("safety_headroom", self.safety_headroom)
        if self.safety_headroom >= self.capacity:
            raise ContractViolation("safety headroom must leave admissible capacity")


@dataclass(frozen=True)
class ResourceNeed:
    resource_id: str
    resource_type: str
    amount: int

    def __post_init__(self) -> None:
        _identifier("resource_id", self.resource_id)
        _identifier("resource_type", self.resource_type)
        _positive_int("amount", self.amount)


@dataclass(frozen=True)
class ResourceReservationRequest:
    reservation_id: str
    job_attempt: str
    fencing_token: str
    needs: tuple[ResourceNeed, ...]
    expires_at_ms: int

    def __post_init__(self) -> None:
        _identifier("reservation_id", self.reservation_id)
        _identifier("job_attempt", self.job_attempt)
        _identifier("fencing_token", self.fencing_token)
        _positive_int("expires_at_ms", self.expires_at_ms)
        if any(not isinstance(need, ResourceNeed) for need in self.needs):
            raise ContractViolation("reservation needs must be typed")
        if not self.needs or len(self.needs) != len(set(need.resource_id for need in self.needs)):
            raise ContractViolation("reservation needs must be non-empty and unique")


@dataclass(frozen=True)
class ResourceReservationReceipt:
    reservation_id: str
    job_attempt: str
    fencing_token: str
    needs: tuple[ResourceNeed, ...]
    state: ReservationState
    expires_at_ms: int
    request_digest: str

    def __post_init__(self) -> None:
        _identifier("reservation_id", self.reservation_id)
        _identifier("job_attempt", self.job_attempt)
        _identifier("fencing_token", self.fencing_token)
        _enum("state", self.state, ReservationState)
        _positive_int("expires_at_ms", self.expires_at_ms)
        _sha256("request_digest", self.request_digest)
        if any(not isinstance(need, ResourceNeed) for need in self.needs):
            raise ContractViolation("reservation receipt needs must be typed")
        if not self.needs or len(self.needs) != len(set(need.resource_id for need in self.needs)):
            raise ContractViolation("reservation receipt needs resources")


class ResourceReservationLedger:
    """Atomic multi-resource reservations with idempotent retries and expiry."""

    def __init__(self, capacities: Sequence[ResourceCapacity]) -> None:
        if any(not isinstance(item, ResourceCapacity) for item in capacities):
            raise ContractViolation("resource ledger capacities must be typed")
        if not capacities or len(capacities) != len(set(item.resource_id for item in capacities)):
            raise ContractViolation("resource ledger capacities must be unique and non-empty")
        self._capacities = {item.resource_id: item for item in capacities}
        self._used: dict[str, int] = {item.resource_id: 0 for item in capacities}
        self._receipts: dict[str, ResourceReservationReceipt] = {}

    @staticmethod
    def _request_digest(request: ResourceReservationRequest) -> str:
        ordered = sorted((need.resource_id, need.resource_type, need.amount) for need in request.needs)
        return digest("|".join([request.job_attempt, request.fencing_token, str(request.expires_at_ms), *[f"{a}:{b}:{c}" for a, b, c in ordered]]))

    def reserve(self, request: ResourceReservationRequest, *, now_ms: int) -> ResourceReservationReceipt:
        if not isinstance(request, ResourceReservationRequest):
            raise ContractViolation("reservation request must be typed")
        _nonnegative_int("now_ms", now_ms)
        self.expire(now_ms=now_ms)
        request_digest = self._request_digest(request)
        prior = self._receipts.get(request.reservation_id)
        if prior is not None:
            if prior.request_digest != request_digest:
                raise AdmissionBlocked("reservation retry conflicts with original request")
            return prior
        if request.expires_at_ms <= now_ms:
            raise AdmissionBlocked("reservation expiry is not in the future")
        deltas: dict[str, int] = {}
        for need in request.needs:
            capacity = self._capacities.get(need.resource_id)
            if capacity is None or capacity.resource_type != need.resource_type:
                raise AdmissionBlocked("requested resource identity is unknown")
            deltas[need.resource_id] = deltas.get(need.resource_id, 0) + need.amount
        for resource_id, amount in deltas.items():
            capacity = self._capacities[resource_id]
            if self._used[resource_id] + amount > capacity.capacity - capacity.safety_headroom:
                raise AdmissionBlocked("resource headroom or capacity would be exceeded")
        # No state is changed until every requested resource passes admission.
        for resource_id, amount in deltas.items():
            self._used[resource_id] += amount
        receipt = ResourceReservationReceipt(
            request.reservation_id,
            request.job_attempt,
            request.fencing_token,
            request.needs,
            ReservationState.RESERVED,
            request.expires_at_ms,
            request_digest,
        )
        self._receipts[request.reservation_id] = receipt
        return receipt

    def activate(self, reservation_id: str, *, fencing_token: str, now_ms: int) -> ResourceReservationReceipt:
        reservation_id = _identifier("reservation_id", reservation_id)
        fencing_token = _identifier("fencing_token", fencing_token)
        _nonnegative_int("now_ms", now_ms)
        receipt = self._receipts.get(reservation_id)
        if receipt is None or receipt.fencing_token != fencing_token:
            raise AdmissionBlocked("reservation fencing token is stale")
        if receipt.state != ReservationState.RESERVED or now_ms >= receipt.expires_at_ms:
            raise AdmissionBlocked("reservation is no longer activatable")
        updated = ResourceReservationReceipt(**{**receipt.__dict__, "state": ReservationState.ACTIVE})
        self._receipts[reservation_id] = updated
        return updated

    def release(self, reservation_id: str, *, fencing_token: str) -> ResourceReservationReceipt:
        reservation_id = _identifier("reservation_id", reservation_id)
        fencing_token = _identifier("fencing_token", fencing_token)
        receipt = self._receipts.get(reservation_id)
        if receipt is None or receipt.fencing_token != fencing_token:
            raise AdmissionBlocked("reservation release fencing token is stale")
        if receipt.state in {ReservationState.RELEASED, ReservationState.EXPIRED, ReservationState.REVOKED}:
            return receipt
        for need in receipt.needs:
            self._used[need.resource_id] -= need.amount
        updated = ResourceReservationReceipt(**{**receipt.__dict__, "state": ReservationState.RELEASED})
        self._receipts[reservation_id] = updated
        return updated

    def expire(self, *, now_ms: int) -> tuple[ResourceReservationReceipt, ...]:
        _nonnegative_int("now_ms", now_ms)
        expired: list[ResourceReservationReceipt] = []
        for reservation_id, receipt in tuple(self._receipts.items()):
            if receipt.state in {ReservationState.RESERVED, ReservationState.ACTIVE} and now_ms >= receipt.expires_at_ms:
                for need in receipt.needs:
                    self._used[need.resource_id] -= need.amount
                updated = ResourceReservationReceipt(**{**receipt.__dict__, "state": ReservationState.EXPIRED})
                self._receipts[reservation_id] = updated
                expired.append(updated)
        return tuple(expired)

    def used(self, resource_id: str) -> int:
        return self._used.get(_identifier("resource_id", resource_id), 0)


@dataclass(frozen=True)
class CostReservation:
    reservation_id: str
    currency: str
    amount_minor_units: int
    max_exposure_minor_units: int
    state: ReservationState
    request_digest: str

    def __post_init__(self) -> None:
        _identifier("reservation_id", self.reservation_id)
        _identifier("currency", self.currency)
        _nonnegative_int("amount_minor_units", self.amount_minor_units)
        _positive_int("max_exposure_minor_units", self.max_exposure_minor_units)
        _enum("state", self.state, ReservationState)
        _sha256("request_digest", self.request_digest)
        if self.amount_minor_units > self.max_exposure_minor_units:
            raise ContractViolation("cost reservation exceeds its exposure ceiling")


class CostReservationLedger:
    """Serialize paid exposure and keep unknown cost fail-closed."""

    def __init__(self, *, currency: str, hard_limit_minor_units: int) -> None:
        self.currency = _identifier("currency", currency)
        self.hard_limit_minor_units = _positive_int("hard_limit_minor_units", hard_limit_minor_units)
        self._reservations: dict[str, CostReservation] = {}

    def reserve(self, reservation_id: str, *, amount_minor_units: int, exposure_ceiling_minor_units: int) -> CostReservation:
        reservation_id = _identifier("reservation_id", reservation_id)
        amount_minor_units = _nonnegative_int("amount_minor_units", amount_minor_units)
        exposure_ceiling_minor_units = _positive_int("exposure_ceiling_minor_units", exposure_ceiling_minor_units)
        request_digest = digest(f"{self.currency}|{amount_minor_units}|{exposure_ceiling_minor_units}")
        prior = self._reservations.get(reservation_id)
        if prior is not None:
            if prior.request_digest != request_digest:
                raise AdmissionBlocked("cost reservation retry conflicts with original request")
            return prior
        committed = sum(
            item.amount_minor_units
            for item in self._reservations.values()
            if item.state in {ReservationState.RESERVED, ReservationState.ACTIVE, ReservationState.UNKNOWN, ReservationState.REVOKED}
        )
        if amount_minor_units > exposure_ceiling_minor_units or committed + amount_minor_units > self.hard_limit_minor_units:
            raise AdmissionBlocked("cost exposure ceiling or hard budget would be exceeded")
        receipt = CostReservation(reservation_id, self.currency, amount_minor_units, exposure_ceiling_minor_units, ReservationState.RESERVED, request_digest)
        self._reservations[reservation_id] = receipt
        return receipt

    def mark_unknown(self, reservation_id: str) -> CostReservation:
        reservation_id = _identifier("reservation_id", reservation_id)
        receipt = self._reservations.get(reservation_id)
        if receipt is None:
            raise AdmissionBlocked("unknown cost reservation cannot be marked")
        updated = CostReservation(**{**receipt.__dict__, "state": ReservationState.UNKNOWN})
        self._reservations[reservation_id] = updated
        return updated

    def release(self, reservation_id: str) -> CostReservation:
        reservation_id = _identifier("reservation_id", reservation_id)
        receipt = self._reservations.get(reservation_id)
        if receipt is None:
            raise AdmissionBlocked("unknown cost reservation cannot be released")
        if receipt.state in {ReservationState.UNKNOWN, ReservationState.REVOKED}:
            raise AdmissionBlocked("unknown cost reservation cannot be retried or released silently")
        updated = CostReservation(**{**receipt.__dict__, "state": ReservationState.RELEASED})
        self._reservations[reservation_id] = updated
        return updated


@dataclass(frozen=True)
class UsageEvent:
    event_id: str
    account: str
    job_attempt: str
    event_type: UsageEventType
    original_event_id: str | None
    currency: str
    amount_minor_units: int
    occurred_at_ms: int
    received_at_ms: int
    raw_evidence_hash: str

    def __post_init__(self) -> None:
        for name in ("event_id", "account", "job_attempt", "currency"):
            _identifier(name, getattr(self, name))
        _enum("event_type", self.event_type, UsageEventType)
        if self.original_event_id is not None:
            _identifier("original_event_id", self.original_event_id)
        _nonnegative_int("amount_minor_units", self.amount_minor_units)
        _nonnegative_int("occurred_at_ms", self.occurred_at_ms)
        _nonnegative_int("received_at_ms", self.received_at_ms)
        _sha256("raw_evidence_hash", self.raw_evidence_hash)
        if self.event_type in {UsageEventType.CORRECTION, UsageEventType.REFUND, UsageEventType.FX_ADJUSTMENT} and not self.original_event_id:
            raise ContractViolation("adjustment/refund events must identify an original event")


class UsageEventLedger:
    """Append-only usage/correction/refund evidence; no event is overwritten."""

    def __init__(self) -> None:
        self._events: dict[str, UsageEvent] = {}

    def append(self, event: UsageEvent) -> UsageEvent:
        if not isinstance(event, UsageEvent):
            raise ContractViolation("usage event must be typed")
        prior = self._events.get(event.event_id)
        if prior is not None:
            if prior != event:
                raise ContractViolation("usage event ID was reused with different evidence")
            return prior
        if event.original_event_id is not None and event.original_event_id not in self._events:
            raise ContractViolation("usage adjustment references an unknown original event")
        self._events[event.event_id] = event
        return event

    def events(self) -> tuple[UsageEvent, ...]:
        return tuple(self._events.values())


@dataclass(frozen=True)
class CrashRecord:
    job_attempt: str
    idempotency_key: str
    restart_count: int
    next_retry_at_ms: int
    state: CrashState
    crash_evidence_hash: str

    def __post_init__(self) -> None:
        _identifier("job_attempt", self.job_attempt)
        _identifier("idempotency_key", self.idempotency_key)
        _nonnegative_int("restart_count", self.restart_count)
        _nonnegative_int("next_retry_at_ms", self.next_retry_at_ms)
        _enum("state", self.state, CrashState)
        _sha256("crash_evidence_hash", self.crash_evidence_hash)


class WorkerCrashGuard:
    """Bound crash retries and prevent a completed external effect replay."""

    def __init__(self, *, max_restarts: int, base_backoff_ms: int, max_backoff_ms: int) -> None:
        self.max_restarts = _positive_int("max_restarts", max_restarts)
        self.base_backoff_ms = _positive_int("base_backoff_ms", base_backoff_ms)
        self.max_backoff_ms = _positive_int("max_backoff_ms", max_backoff_ms)
        if self.max_backoff_ms < self.base_backoff_ms:
            raise ContractViolation("max backoff must be at least base backoff")
        self._records: dict[str, CrashRecord] = {}
        self._completed_effects: set[str] = set()
        self._claimed_retries: set[str] = set()

    def mark_external_effect_completed(self, idempotency_key: str) -> None:
        self._completed_effects.add(_identifier("idempotency_key", idempotency_key))

    def record_crash(self, job_attempt: str, *, idempotency_key: str, now_ms: int, evidence_hash: str) -> CrashRecord:
        job_attempt = _identifier("job_attempt", job_attempt)
        idempotency_key = _identifier("idempotency_key", idempotency_key)
        _nonnegative_int("now_ms", now_ms)
        evidence_hash = _sha256("evidence_hash", evidence_hash)
        prior = self._records.get(job_attempt)
        if prior is not None and prior.idempotency_key != idempotency_key:
            raise RetryQuarantined("job retry changed its idempotency key")
        count = 0 if prior is None else prior.restart_count
        if idempotency_key in self._completed_effects:
            record = CrashRecord(job_attempt, idempotency_key, count, now_ms, CrashState.COMPLETED_NO_RETRY, evidence_hash)
        elif count >= self.max_restarts:
            record = CrashRecord(job_attempt, idempotency_key, count, now_ms, CrashState.QUARANTINED, evidence_hash)
        else:
            count += 1
            delay = min(self.max_backoff_ms, self.base_backoff_ms * (2 ** (count - 1)))
            record = CrashRecord(job_attempt, idempotency_key, count, now_ms + delay, CrashState.BACKOFF, evidence_hash)
        self._records[job_attempt] = record
        self._claimed_retries.discard(job_attempt)
        return record

    def can_retry(self, job_attempt: str, *, now_ms: int) -> bool:
        job_attempt = _identifier("job_attempt", job_attempt)
        _nonnegative_int("now_ms", now_ms)
        record = self._records.get(job_attempt)
        if record is None or record.state != CrashState.BACKOFF or now_ms < record.next_retry_at_ms:
            return False
        return record.idempotency_key not in self._completed_effects and job_attempt not in self._claimed_retries

    def claim_retry(self, job_attempt: str, *, now_ms: int) -> CrashRecord:
        """Consume one restart authorization so repeated workers cannot duplicate it."""
        job_attempt = _identifier("job_attempt", job_attempt)
        _nonnegative_int("now_ms", now_ms)
        if not self.can_retry(job_attempt, now_ms=now_ms):
            raise RetryQuarantined("retry is not currently authorized")
        record = self._records[job_attempt]
        self._claimed_retries.add(job_attempt)
        claimed = CrashRecord(
            record.job_attempt,
            record.idempotency_key,
            record.restart_count,
            now_ms,
            CrashState.RUNNING,
            record.crash_evidence_hash,
        )
        self._records[job_attempt] = claimed
        return claimed


@dataclass(frozen=True)
class PinnedDependency:
    entity_id: str
    revision_id: str

    def __post_init__(self) -> None:
        _identifier("entity_id", self.entity_id)
        _identifier("revision_id", self.revision_id)


@dataclass(frozen=True)
class DispatchBatch:
    batch_id: str
    upstream_revision: str
    planned_count: int
    dispatched_count: int
    completed_count: int
    cancelled_count: int
    exposure_budget_minor_units: int
    per_item_exposure_minor_units: int
    mode: DispatchMode
    state: DispatchState
    dependency_hash: str

    def __post_init__(self) -> None:
        _identifier("batch_id", self.batch_id)
        _identifier("upstream_revision", self.upstream_revision)
        for name in ("planned_count", "dispatched_count", "completed_count", "cancelled_count", "exposure_budget_minor_units", "per_item_exposure_minor_units"):
            _nonnegative_int(name, getattr(self, name))
        if self.planned_count == 0 or self.dispatched_count > self.planned_count or self.completed_count > self.dispatched_count or self.cancelled_count > self.planned_count - self.dispatched_count:
            raise ContractViolation("dispatch batch counters are inconsistent")
        _enum("mode", self.mode, DispatchMode)
        _enum("state", self.state, DispatchState)
        _sha256("dependency_hash", self.dependency_hash)
        if self.exposure_budget_minor_units != self.planned_count * self.per_item_exposure_minor_units:
            raise ContractViolation("dispatch exposure must equal planned item exposure")


class FanoutGuard:
    """Plan and dispatch bounded work only against a pinned dependency revision."""

    def __init__(self, *, max_items_per_batch: int, max_exposure_minor_units: int) -> None:
        self.max_items_per_batch = _positive_int("max_items_per_batch", max_items_per_batch)
        self.max_exposure_minor_units = _positive_int("max_exposure_minor_units", max_exposure_minor_units)
        self._batches: dict[str, DispatchBatch] = {}

    def plan(self, batch_id: str, *, pinned: PinnedDependency, observed: PinnedDependency, estimated_items: int, per_item_exposure_minor_units: int, mode: DispatchMode) -> DispatchBatch:
        batch_id = _identifier("batch_id", batch_id)
        _enum("mode", mode, DispatchMode)
        estimated_items = _positive_int("estimated_items", estimated_items)
        per_item_exposure_minor_units = _nonnegative_int("per_item_exposure_minor_units", per_item_exposure_minor_units)
        if pinned != observed:
            raise FanoutBlocked("dependency identity/revision changed before fanout planning")
        if estimated_items > self.max_items_per_batch or estimated_items * per_item_exposure_minor_units > self.max_exposure_minor_units:
            raise FanoutBlocked("fanout item or exposure cap would be exceeded")
        prior = self._batches.get(batch_id)
        dependency_hash = digest(f"{pinned.entity_id}|{pinned.revision_id}")
        if prior is not None:
            if prior.upstream_revision != pinned.revision_id or prior.dependency_hash != dependency_hash:
                raise FanoutBlocked("fanout retry conflicts with its pinned dependency")
            return prior
        state = DispatchState.SAMPLING if mode == DispatchMode.SAMPLE_FIRST else DispatchState.PLANNED
        batch = DispatchBatch(batch_id, pinned.revision_id, estimated_items, 0, 0, 0, estimated_items * per_item_exposure_minor_units, per_item_exposure_minor_units, mode, state, dependency_hash)
        self._batches[batch_id] = batch
        return batch

    def dispatch(self, batch_id: str, *, count: int, expected_revision: str) -> DispatchBatch:
        batch_id = _identifier("batch_id", batch_id)
        count = _positive_int("count", count)
        expected_revision = _identifier("expected_revision", expected_revision)
        batch = self._batches.get(batch_id)
        if batch is None or batch.state in {DispatchState.INVALIDATED, DispatchState.CANCELLED, DispatchState.PLAN_BLOCKED, DispatchState.PAUSED_FOR_SAMPLE_DECISION}:
            raise FanoutBlocked("batch is not dispatchable")
        if batch.state == DispatchState.SAMPLING:
            raise FanoutBlocked("sample-first batch requires an explicit sample decision")
        if batch.upstream_revision != expected_revision:
            raise FanoutBlocked("dispatch revision fence is stale")
        if batch.dispatched_count + count > batch.planned_count:
            raise FanoutBlocked("dispatch count would exceed planned fanout")
        state = DispatchState.DISPATCHING if batch.dispatched_count + count < batch.planned_count else DispatchState.COMPLETE
        updated = DispatchBatch(**{**batch.__dict__, "dispatched_count": batch.dispatched_count + count, "state": state})
        self._batches[batch_id] = updated
        return updated

    def invalidate(self, batch_id: str, *, new_revision: str) -> DispatchBatch:
        batch_id = _identifier("batch_id", batch_id)
        new_revision = _identifier("new_revision", new_revision)
        batch = self._batches.get(batch_id)
        if batch is None:
            raise FanoutBlocked("unknown fanout batch")
        if batch.state == DispatchState.INVALIDATED:
            if batch.upstream_revision == new_revision:
                return batch
            raise FanoutBlocked("invalidated fanout cannot be rebound to another revision")
        updated = DispatchBatch(**{**batch.__dict__, "cancelled_count": batch.planned_count - batch.dispatched_count, "state": DispatchState.INVALIDATED, "upstream_revision": new_revision, "dependency_hash": digest(f"invalidated|{new_revision}")})
        self._batches[batch_id] = updated
        return updated

    def approve_sample(self, batch_id: str, *, expected_revision: str, approved: bool) -> DispatchBatch:
        batch_id = _identifier("batch_id", batch_id)
        expected_revision = _identifier("expected_revision", expected_revision)
        approved = _bool("approved", approved)
        batch = self._batches.get(batch_id)
        if batch is None or batch.state != DispatchState.SAMPLING or batch.upstream_revision != expected_revision:
            raise FanoutBlocked("sample decision is stale or unavailable")
        state = DispatchState.PLANNED if approved else DispatchState.PAUSED_FOR_SAMPLE_DECISION
        updated = DispatchBatch(**{**batch.__dict__, "state": state})
        self._batches[batch_id] = updated
        return updated


@dataclass(frozen=True)
class ManualControlLock:
    entity_id: str
    owner_id: str
    revision_id: str
    epoch: int
    active: bool

    def __post_init__(self) -> None:
        _identifier("entity_id", self.entity_id)
        _identifier("owner_id", self.owner_id)
        _identifier("revision_id", self.revision_id)
        _positive_int("epoch", self.epoch)
        _bool("active", self.active)


@dataclass(frozen=True)
class CandidateResult:
    candidate_id: str
    entity_id: str
    revision_id: str
    payload_hash: str
    state: CandidateState

    def __post_init__(self) -> None:
        _identifier("candidate_id", self.candidate_id)
        _identifier("entity_id", self.entity_id)
        _identifier("revision_id", self.revision_id)
        _sha256("payload_hash", self.payload_hash)
        _enum("state", self.state, CandidateState)


class ManualRevisionFence:
    def evaluate(self, lock: ManualControlLock, *, current_revision: str, candidate_id: str, candidate_revision: str, payload_hash: str, current_epoch: int | None = None) -> CandidateResult:
        if not isinstance(lock, ManualControlLock):
            raise FanoutBlocked("manual lock must be typed")
        current_revision = _identifier("current_revision", current_revision)
        candidate_id = _identifier("candidate_id", candidate_id)
        candidate_revision = _identifier("candidate_revision", candidate_revision)
        payload_hash = _sha256("payload_hash", payload_hash)
        if current_epoch is not None:
            _positive_int("current_epoch", current_epoch)
        stale_epoch = current_epoch is not None and lock.epoch != current_epoch
        state = CandidateState.STALE_CANDIDATE if lock.active or stale_epoch or current_revision != candidate_revision or lock.revision_id != current_revision else CandidateState.CANDIDATE
        return CandidateResult(candidate_id, lock.entity_id, candidate_revision, payload_hash, state)


@dataclass(frozen=True)
class CaptureSessionReceipt:
    session_id: str
    owner_id: str
    device_id: str
    source_id: str
    session_epoch: int
    state: CaptureState
    output_hash: str | None = None

    def __post_init__(self) -> None:
        for name in ("session_id", "owner_id", "device_id", "source_id"):
            _identifier(name, getattr(self, name))
        _positive_int("session_epoch", self.session_epoch)
        _enum("state", self.state, CaptureState)
        if self.output_hash is not None:
            _sha256("output_hash", self.output_hash)


class CaptureSessionGuard:
    """Bind a capture session to owner/device/source and quarantine stale output."""

    def __init__(self) -> None:
        self._sessions: dict[str, CaptureSessionReceipt] = {}

    def start(self, session_id: str, *, owner_id: str, device_id: str, source_id: str, session_epoch: int, permission_granted: bool) -> CaptureSessionReceipt:
        session_id = _identifier("session_id", session_id)
        owner_id = _identifier("owner_id", owner_id)
        device_id = _identifier("device_id", device_id)
        source_id = _identifier("source_id", source_id)
        _positive_int("session_epoch", session_epoch)
        permission_granted = _bool("permission_granted", permission_granted)
        prior = self._sessions.get(session_id)
        if prior is not None:
            if (prior.owner_id, prior.device_id, prior.source_id, prior.session_epoch) != (owner_id, device_id, source_id, session_epoch):
                raise CaptureBlocked("capture session retry conflicts with its binding")
            return prior
        state = CaptureState.ACTIVE if permission_granted else CaptureState.PERMISSION_DENIED
        receipt = CaptureSessionReceipt(session_id, owner_id, device_id, source_id, session_epoch, state)
        self._sessions[session_id] = receipt
        return receipt

    def append_output(self, session_id: str, *, owner_id: str, device_id: str, source_id: str, session_epoch: int, output_hash: str) -> CaptureSessionReceipt:
        session_id = _identifier("session_id", session_id)
        owner_id = _identifier("owner_id", owner_id)
        device_id = _identifier("device_id", device_id)
        source_id = _identifier("source_id", source_id)
        _positive_int("session_epoch", session_epoch)
        output_hash = _sha256("output_hash", output_hash)
        receipt = self._sessions.get(session_id)
        if receipt is None or receipt.state != CaptureState.ACTIVE:
            raise CaptureBlocked("capture session is not active")
        if receipt.output_hash == output_hash:
            return receipt
        if receipt.output_hash is not None:
            updated = CaptureSessionReceipt(**{**receipt.__dict__, "state": CaptureState.QUARANTINED_OUTPUT, "output_hash": output_hash})
            self._sessions[session_id] = updated
            raise CaptureBlocked("capture output hash changed within one session")
        if (receipt.owner_id, receipt.device_id, receipt.source_id, receipt.session_epoch) != (owner_id, device_id, source_id, session_epoch):
            updated = CaptureSessionReceipt(**{**receipt.__dict__, "state": CaptureState.QUARANTINED_OUTPUT, "output_hash": output_hash})
            self._sessions[session_id] = updated
            raise CaptureBlocked("capture output binding changed; output quarantined")
        updated = CaptureSessionReceipt(**{**receipt.__dict__, "output_hash": output_hash})
        self._sessions[session_id] = updated
        return updated

    def request_stop(self, session_id: str, *, owner_id: str, device_id: str, source_id: str, session_epoch: int, device_present: bool = True) -> CaptureSessionReceipt:
        session_id = _identifier("session_id", session_id)
        owner_id = _identifier("owner_id", owner_id)
        device_id = _identifier("device_id", device_id)
        source_id = _identifier("source_id", source_id)
        _positive_int("session_epoch", session_epoch)
        device_present = _bool("device_present", device_present)
        receipt = self._sessions.get(session_id)
        if receipt is None:
            raise CaptureBlocked("unknown capture session")
        if not device_present:
            state = CaptureState.DEVICE_LOST
        elif (receipt.owner_id, receipt.device_id, receipt.source_id, receipt.session_epoch) != (owner_id, device_id, source_id, session_epoch):
            state = CaptureState.DEVICE_CHANGED
        elif receipt.state != CaptureState.ACTIVE:
            state = CaptureState.STOP_FAILED
        else:
            state = CaptureState.STOP_REQUESTED
        updated = CaptureSessionReceipt(**{**receipt.__dict__, "state": state})
        self._sessions[session_id] = updated
        return updated

    def confirm_stop(self, session_id: str, *, owner_id: str, device_id: str, source_id: str, session_epoch: int, device_present: bool = True) -> CaptureSessionReceipt:
        session_id = _identifier("session_id", session_id)
        owner_id = _identifier("owner_id", owner_id)
        device_id = _identifier("device_id", device_id)
        source_id = _identifier("source_id", source_id)
        _positive_int("session_epoch", session_epoch)
        device_present = _bool("device_present", device_present)
        receipt = self._sessions.get(session_id)
        if receipt is None:
            raise CaptureBlocked("unknown capture session")
        if receipt.state != CaptureState.STOP_REQUESTED:
            return receipt
        if not device_present:
            state = CaptureState.DEVICE_LOST
        elif (receipt.owner_id, receipt.device_id, receipt.source_id, receipt.session_epoch) != (owner_id, device_id, source_id, session_epoch):
            state = CaptureState.DEVICE_CHANGED
        else:
            state = CaptureState.STOP_CONFIRMED
        updated = CaptureSessionReceipt(**{**receipt.__dict__, "state": state})
        self._sessions[session_id] = updated
        return updated

    def stop(self, session_id: str, *, owner_id: str, device_id: str, source_id: str, session_epoch: int, device_present: bool = True) -> CaptureSessionReceipt:
        requested = self.request_stop(session_id, owner_id=owner_id, device_id=device_id, source_id=source_id, session_epoch=session_epoch, device_present=device_present)
        if requested.state != CaptureState.STOP_REQUESTED:
            return requested
        return self.confirm_stop(session_id, owner_id=owner_id, device_id=device_id, source_id=source_id, session_epoch=session_epoch, device_present=device_present)


@dataclass(frozen=True)
class PublicationReceipt:
    publication_id: str
    destination_id: str
    version: str
    idempotency_key: str
    request_id: str
    state: PublicationState
    external_url: str | None = None
    evidence_hash: str | None = None

    def __post_init__(self) -> None:
        for name in ("publication_id", "destination_id", "version", "idempotency_key", "request_id"):
            _identifier(name, getattr(self, name))
        _enum("state", self.state, PublicationState)
        if self.external_url is not None:
            _text("external_url", self.external_url, maximum=2_048)
        if self.evidence_hash is not None:
            _sha256("evidence_hash", self.evidence_hash)


class PublicationReconciler:
    """Require destination proof before retrying an unknown publication."""

    def __init__(self) -> None:
        self._publications: dict[str, PublicationReceipt] = {}

    def begin(self, publication_id: str, *, destination_id: str, version: str, idempotency_key: str, request_id: str) -> PublicationReceipt:
        publication_id = _identifier("publication_id", publication_id)
        destination_id = _identifier("destination_id", destination_id)
        version = _identifier("version", version)
        idempotency_key = _identifier("idempotency_key", idempotency_key)
        request_id = _identifier("request_id", request_id)
        prior = self._publications.get(publication_id)
        if prior is not None:
            if (prior.destination_id, prior.version, prior.idempotency_key, prior.request_id) != (destination_id, version, idempotency_key, request_id):
                raise PublicationUnknown("publication identity was reused with different scope")
            if prior.state == PublicationState.UNKNOWN_EXTERNAL_OUTCOME:
                raise PublicationUnknown("publication outcome must be reconciled before retry")
            if prior.state == PublicationState.RETRY_AUTHORIZED:
                raise PublicationUnknown("publication retry requires a new idempotency key and explicit retry transition")
            return prior
        receipt = PublicationReceipt(publication_id, destination_id, version, idempotency_key, request_id, PublicationState.PUBLISHING)
        self._publications[publication_id] = receipt
        return receipt

    def response_lost(self, publication_id: str) -> PublicationReceipt:
        publication_id = _identifier("publication_id", publication_id)
        receipt = self._publications.get(publication_id)
        if receipt is None or receipt.state != PublicationState.PUBLISHING:
            raise PublicationUnknown("publication is not awaiting an external outcome")
        updated = PublicationReceipt(**{**receipt.__dict__, "state": PublicationState.UNKNOWN_EXTERNAL_OUTCOME})
        self._publications[publication_id] = updated
        return updated

    def reconcile(self, publication_id: str, *, destination_id: str, request_id: str, observed_version: str, postcondition_verified: bool, delivered: bool, evidence_hash: str | None = None, external_url: str | None = None) -> PublicationReceipt:
        publication_id = _identifier("publication_id", publication_id)
        destination_id = _identifier("destination_id", destination_id)
        request_id = _identifier("request_id", request_id)
        observed_version = _identifier("observed_version", observed_version)
        postcondition_verified = _bool("postcondition_verified", postcondition_verified)
        delivered = _bool("delivered", delivered)
        if evidence_hash is None:
            raise PublicationUnknown("reconciliation requires external evidence hash")
        evidence_hash = _sha256("evidence_hash", evidence_hash)
        receipt = self._publications.get(publication_id)
        if receipt is None or receipt.state != PublicationState.UNKNOWN_EXTERNAL_OUTCOME:
            raise PublicationUnknown("publication is not in unknown-outcome reconciliation")
        if (receipt.destination_id, receipt.request_id, receipt.version) != (destination_id, request_id, observed_version):
            raise PublicationUnknown("reconciliation evidence does not bind the original request")
        if not postcondition_verified:
            raise PublicationUnknown("unverified postcondition cannot resolve publication outcome")
        if delivered and external_url is None:
            raise PublicationUnknown("delivered publication requires destination URL evidence")
        state = PublicationState.DELIVERED if delivered else PublicationState.RETRY_AUTHORIZED
        updated = PublicationReceipt(**{**receipt.__dict__, "state": state, "external_url": external_url, "evidence_hash": evidence_hash})
        self._publications[publication_id] = updated
        return updated

    def retry(self, publication_id: str, *, idempotency_key: str, request_id: str) -> PublicationReceipt:
        """Start a new attempt only after a verified reconciliation authorized it."""
        publication_id = _identifier("publication_id", publication_id)
        idempotency_key = _identifier("idempotency_key", idempotency_key)
        request_id = _identifier("request_id", request_id)
        receipt = self._publications.get(publication_id)
        if receipt is None or receipt.state != PublicationState.RETRY_AUTHORIZED:
            raise PublicationUnknown("publication retry is not authorized")
        if idempotency_key == receipt.idempotency_key or request_id == receipt.request_id:
            raise PublicationUnknown("publication retry must use a fresh idempotency and request identity")
        updated = PublicationReceipt(
            receipt.publication_id,
            receipt.destination_id,
            receipt.version,
            idempotency_key,
            request_id,
            PublicationState.PUBLISHING,
        )
        self._publications[publication_id] = updated
        return updated

    def authorize_compensation(self, publication_id: str, *, reason_hash: str) -> PublicationReceipt:
        publication_id = _identifier("publication_id", publication_id)
        _sha256("reason_hash", reason_hash)
        receipt = self._publications.get(publication_id)
        if receipt is None or receipt.state != PublicationState.UNKNOWN_EXTERNAL_OUTCOME:
            raise PublicationUnknown("only an unknown publication can enter compensation")
        updated = PublicationReceipt(**{**receipt.__dict__, "state": PublicationState.COMPENSATION_REQUIRED})
        self._publications[publication_id] = updated
        return updated


__all__ = [
    "AdmissionBlocked",
    "CandidateResult",
    "CandidateState",
    "CaptureBlocked",
    "CaptureSessionGuard",
    "CaptureSessionReceipt",
    "CaptureState",
    "CostReservation",
    "CostReservationLedger",
    "CrashRecord",
    "CrashState",
    "DispatchBatch",
    "DispatchMode",
    "DispatchState",
    "FanoutBlocked",
    "FanoutGuard",
    "ManualControlLock",
    "ManualRevisionFence",
    "PinnedDependency",
    "PublicationReceipt",
    "PublicationReconciler",
    "PublicationUnknown",
    "PublicationState",
    "ResourceCapacity",
    "ResourceNeed",
    "ResourceReservationLedger",
    "ResourceReservationReceipt",
    "ResourceReservationRequest",
    "ReservationState",
    "RetryQuarantined",
    "UsageEvent",
    "UsageEventLedger",
    "UsageEventType",
    "WorkerCrashGuard",
    "digest",
]
