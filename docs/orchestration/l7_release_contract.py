#!/usr/bin/env python3
"""Fail-closed reference contracts for the CineForge L7 safety boundary.

This deterministic standard-library harness is not the CineForge product
runtime.  It does not enforce real rights, erase a real disk, restore a real
backup, verify a real signing key, inspect a CI runner, cross a project
boundary, authorize an offline actor, or activate a deployment.  It makes the
L7 decisions executable until product implementations and independent
verifiers exist.

The model covers rights-generation cache fences, forward deletion/restore
reconciliation, package-key revocation, artifact provenance (including source
commit, workflow revision, runner trust and cache identity), clean release
source closure, final-byte signing identity, offline authority revocation and
split-brain deployment fencing.  Unsafe operations raise typed violations or
return an explicit blocked/quarantined state; no fixture is production proof.
"""

from __future__ import annotations

import hashlib
import sys
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Sequence

try:
    from l4_recovery_contract import (  # type: ignore
        ContractViolation,
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
        _identifier,
        _nonnegative_int,
        _positive_int,
        _sha256,
    )


class RightsBlocked(ContractViolation):
    """A rights generation, scope or purge barrier is stale or unsafe."""


class RestoreBlocked(ContractViolation):
    """A restore would resurrect deleted data or bypass retention policy."""


class ProvenanceBlocked(ContractViolation):
    """A package, artifact, workspace or signer identity is not trusted."""


class AuthorityBlocked(ContractViolation):
    """An offline command no longer has current authority."""


class DeploymentBlocked(ContractViolation):
    """A deployment activation would create split-brain or stale authority."""


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


class RightsState(str, Enum):
    ACTIVE = "ACTIVE"
    REVOKED = "REVOKED"


class CacheState(str, Enum):
    CURRENT = "CURRENT"
    STALE = "STALE"
    PURGE_PENDING = "PURGE_PENDING"
    PURGED = "PURGED"


class ArchiveState(str, Enum):
    ACTIVE = "ACTIVE"
    RESTORED = "RESTORED"
    RESTORE_RECONCILIATION = "RESTORE_RECONCILIATION"
    TOMBSTONED = "TOMBSTONED"
    PURGE_PENDING = "PURGE_PENDING"
    PURGED = "PURGED"
    READ_ONLY_IMPORT = "READ_ONLY_IMPORT"


class PackageState(str, Enum):
    VERIFIED = "VERIFIED"
    UNKNOWN_REVOCATION_FRESHNESS = "UNKNOWN_REVOCATION_FRESHNESS"
    REVOKED = "REVOKED"
    POLICY_BLOCKED = "POLICY_BLOCKED"
    ACTIVATED = "ACTIVATED"


class ArtifactState(str, Enum):
    ATTESTED = "ATTESTED"
    CONSUMED = "CONSUMED"
    QUARANTINED = "QUARANTINED"
    PROVENANCE_MISMATCH = "PROVENANCE_MISMATCH"


class WorkspaceState(str, Enum):
    SNAPSHOTTED = "SNAPSHOTTED"
    READY = "READY"
    RELEASE_BLOCKED = "RELEASE_BLOCKED"


class SigningState(str, Enum):
    PENDING = "PENDING"
    SIGNED = "SIGNED"
    SIGNING_BLOCKED = "SIGNING_BLOCKED"


class AuthorityState(str, Enum):
    QUEUED = "QUEUED"
    READY_TO_SYNC = "READY_TO_SYNC"
    EXECUTED = "EXECUTED"
    AUTHORITY_REVOKED = "AUTHORITY_REVOKED"
    IMPORT_AS_BRANCH_REQUIRED = "IMPORT_AS_BRANCH_REQUIRED"


class DeploymentState(str, Enum):
    ACTIVE = "ACTIVE"
    FORKED = "FORKED"
    QUARANTINED = "QUARANTINED"
    COMPENSATION_REQUIRED = "COMPENSATION_REQUIRED"


@dataclass(frozen=True)
class RightsReceipt:
    scope_id: str
    project_id: str
    entity_id: str
    generation: int
    state: RightsState
    rights_digest: str
    revocation_digest: str | None = None

    def __post_init__(self) -> None:
        for name in ("scope_id", "project_id", "entity_id"):
            _identifier(name, getattr(self, name))
        _positive_int("generation", self.generation)
        _enum("state", self.state, RightsState)
        _sha256("rights_digest", self.rights_digest)
        if self.revocation_digest is not None:
            _sha256("revocation_digest", self.revocation_digest)


@dataclass(frozen=True)
class CacheReceipt:
    cache_id: str
    scope_id: str
    project_id: str
    entity_id: str
    source_revision: str
    rights_generation: int
    content_digest: str
    state: CacheState

    def __post_init__(self) -> None:
        for name in ("cache_id", "scope_id", "project_id", "entity_id", "source_revision"):
            _identifier(name, getattr(self, name))
        _positive_int("rights_generation", self.rights_generation)
        _sha256("content_digest", self.content_digest)
        _enum("state", self.state, CacheState)


class RightsCacheGuard:
    """Fence derived cache/index reads by project scope and rights generation."""

    def __init__(self) -> None:
        self._rights: dict[str, RightsReceipt] = {}
        self._cache: dict[str, CacheReceipt] = {}

    def register_scope(self, scope_id: str, *, project_id: str, entity_id: str, generation: int = 1, rights_digest: str | None = None) -> RightsReceipt:
        scope_id = _identifier("scope_id", scope_id)
        project_id = _identifier("project_id", project_id)
        entity_id = _identifier("entity_id", entity_id)
        _positive_int("generation", generation)
        rights_digest = digest(f"rights|{scope_id}|{generation}") if rights_digest is None else _sha256("rights_digest", rights_digest)
        prior = self._rights.get(scope_id)
        if prior is not None:
            if (prior.project_id, prior.entity_id, prior.generation, prior.rights_digest) != (project_id, entity_id, generation, rights_digest):
                raise RightsBlocked("rights scope identity was reused with different evidence")
            return prior
        receipt = RightsReceipt(scope_id, project_id, entity_id, generation, RightsState.ACTIVE, rights_digest)
        self._rights[scope_id] = receipt
        return receipt

    def materialize(self, cache_id: str, *, scope_id: str, project_id: str, entity_id: str, source_revision: str, rights_generation: int, content_digest: str) -> CacheReceipt:
        cache_id = _identifier("cache_id", cache_id)
        scope_id = _identifier("scope_id", scope_id)
        project_id = _identifier("project_id", project_id)
        entity_id = _identifier("entity_id", entity_id)
        source_revision = _identifier("source_revision", source_revision)
        _positive_int("rights_generation", rights_generation)
        content_digest = _sha256("content_digest", content_digest)
        rights = self._rights.get(scope_id)
        if rights is None or rights.state != RightsState.ACTIVE or (rights.project_id, rights.entity_id, rights.generation) != (project_id, entity_id, rights_generation):
            raise RightsBlocked("cache materialization lacks current rights scope/generation")
        prior = self._cache.get(cache_id)
        if prior is not None:
            if prior != CacheReceipt(cache_id, scope_id, project_id, entity_id, source_revision, rights_generation, content_digest, prior.state):
                raise RightsBlocked("cache identity was reused with different source or scope")
            return prior
        receipt = CacheReceipt(cache_id, scope_id, project_id, entity_id, source_revision, rights_generation, content_digest, CacheState.CURRENT)
        self._cache[cache_id] = receipt
        return receipt

    def revoke(self, scope_id: str, *, new_generation: int, reason_digest: str) -> RightsReceipt:
        scope_id = _identifier("scope_id", scope_id)
        _positive_int("new_generation", new_generation)
        reason_digest = _sha256("reason_digest", reason_digest)
        prior = self._rights.get(scope_id)
        if prior is None or new_generation <= prior.generation:
            raise RightsBlocked("rights generation must advance monotonically")
        updated = RightsReceipt(prior.scope_id, prior.project_id, prior.entity_id, new_generation, RightsState.REVOKED, prior.rights_digest, reason_digest)
        self._rights[scope_id] = updated
        return updated

    def read(self, cache_id: str, *, scope_id: str, project_id: str, observed_generation: int) -> CacheReceipt:
        cache_id = _identifier("cache_id", cache_id)
        scope_id = _identifier("scope_id", scope_id)
        project_id = _identifier("project_id", project_id)
        _positive_int("observed_generation", observed_generation)
        cache = self._cache.get(cache_id)
        rights = self._rights.get(scope_id)
        if cache is None or rights is None or cache.scope_id != scope_id or cache.project_id != project_id:
            raise RightsBlocked("cache scope is unknown or crosses project boundary")
        if cache.state == CacheState.PURGED:
            raise RightsBlocked("purged cache is terminal and cannot be reopened")
        if rights.state != RightsState.ACTIVE or cache.rights_generation != rights.generation or observed_generation != rights.generation:
            updated = CacheReceipt(**{**cache.__dict__, "state": CacheState.PURGE_PENDING})
            self._cache[cache_id] = updated
            raise RightsBlocked("cache/index rights generation is stale")
        if cache.state != CacheState.CURRENT:
            raise RightsBlocked("cache is not current")
        return cache

    def purge(self, cache_id: str, *, barrier_digest: str) -> CacheReceipt:
        cache_id = _identifier("cache_id", cache_id)
        barrier_digest = _sha256("barrier_digest", barrier_digest)
        cache = self._cache.get(cache_id)
        if cache is None or cache.state not in {CacheState.PURGE_PENDING, CacheState.STALE}:
            raise RightsBlocked("cache is not awaiting purge")
        updated = CacheReceipt(**{**cache.__dict__, "state": CacheState.PURGED})
        self._cache[cache_id] = updated
        return updated


@dataclass(frozen=True)
class BackupSnapshot:
    backup_id: str
    captured_epoch: int
    members: tuple[str, ...]
    snapshot_digest: str

    def __post_init__(self) -> None:
        _identifier("backup_id", self.backup_id)
        _positive_int("captured_epoch", self.captured_epoch)
        if not self.members or len(self.members) != len(set(self.members)) or any(not isinstance(member, str) or not member for member in self.members):
            raise ContractViolation("backup members must be unique non-empty identifiers")
        _sha256("snapshot_digest", self.snapshot_digest)


@dataclass(frozen=True)
class ArchiveReceipt:
    entity_id: str
    project_id: str
    state: ArchiveState
    observed_epoch: int
    tombstone_digest: str | None = None
    evidence_retained: bool = True

    def __post_init__(self) -> None:
        _identifier("entity_id", self.entity_id)
        _identifier("project_id", self.project_id)
        _enum("state", self.state, ArchiveState)
        _positive_int("observed_epoch", self.observed_epoch)
        if self.tombstone_digest is not None:
            _sha256("tombstone_digest", self.tombstone_digest)
        _bool("evidence_retained", self.evidence_retained)


class ArchiveRestoreGuard:
    """Keep forward tombstones ahead of stale backups and retention policy."""

    def __init__(self) -> None:
        self._entities: dict[str, ArchiveReceipt] = {}
        self._backups: dict[str, BackupSnapshot] = {}

    def register_entity(self, entity_id: str, *, project_id: str, epoch: int = 1) -> ArchiveReceipt:
        entity_id = _identifier("entity_id", entity_id)
        project_id = _identifier("project_id", project_id)
        _positive_int("epoch", epoch)
        prior = self._entities.get(entity_id)
        if prior is not None:
            if prior.project_id != project_id:
                raise RestoreBlocked("entity crosses project boundary")
            if prior.observed_epoch != epoch:
                raise RestoreBlocked("entity registration epoch was reused")
            return prior
        receipt = ArchiveReceipt(entity_id, project_id, ArchiveState.ACTIVE, epoch)
        self._entities[entity_id] = receipt
        return receipt

    def create_backup(self, backup_id: str, *, captured_epoch: int, members: Sequence[str], snapshot_digest: str) -> BackupSnapshot:
        backup_id = _identifier("backup_id", backup_id)
        captured_epoch = _positive_int("captured_epoch", captured_epoch)
        snapshot = BackupSnapshot(backup_id, captured_epoch, tuple(members), _sha256("snapshot_digest", snapshot_digest))
        prior = self._backups.get(backup_id)
        if prior is not None and prior != snapshot:
            raise RestoreBlocked("backup identity was reused with different bytes")
        self._backups[backup_id] = snapshot
        return snapshot

    def delete(self, entity_id: str, *, deletion_epoch: int, tombstone_digest: str, legal_hold: bool = False) -> ArchiveReceipt:
        entity_id = _identifier("entity_id", entity_id)
        deletion_epoch = _positive_int("deletion_epoch", deletion_epoch)
        tombstone_digest = _sha256("tombstone_digest", tombstone_digest)
        legal_hold = _bool("legal_hold", legal_hold)
        prior = self._entities.get(entity_id)
        if prior is None or deletion_epoch < prior.observed_epoch:
            raise RestoreBlocked("deletion epoch is stale")
        if prior.state == ArchiveState.PURGED:
            raise RestoreBlocked("purged entity is terminal and cannot be resurrected")
        state = ArchiveState.PURGE_PENDING if legal_hold else ArchiveState.TOMBSTONED
        updated = ArchiveReceipt(entity_id, prior.project_id, state, deletion_epoch, tombstone_digest, True)
        self._entities[entity_id] = updated
        return updated

    def restore(self, backup_id: str, entity_id: str) -> ArchiveReceipt:
        backup_id = _identifier("backup_id", backup_id)
        entity_id = _identifier("entity_id", entity_id)
        backup = self._backups.get(backup_id)
        current = self._entities.get(entity_id)
        if backup is None or current is None or entity_id not in backup.members:
            raise RestoreBlocked("backup/entity membership is not proven")
        if current.state == ArchiveState.PURGED:
            return current
        if current.state == ArchiveState.PURGE_PENDING:
            raise RestoreBlocked("legal-hold entity cannot be restored over its purge barrier")
        if current.state == ArchiveState.TOMBSTONED and current.observed_epoch >= backup.captured_epoch:
            updated = ArchiveReceipt(**{**current.__dict__, "state": ArchiveState.RESTORE_RECONCILIATION})
            self._entities[entity_id] = updated
            return updated
        updated = ArchiveReceipt(**{**current.__dict__, "state": ArchiveState.RESTORED})
        self._entities[entity_id] = updated
        return updated

    def import_read_only(self, backup_id: str, entity_id: str) -> ArchiveReceipt:
        """Expose an archive copy without changing canonical archive bytes."""
        backup_id = _identifier("backup_id", backup_id)
        entity_id = _identifier("entity_id", entity_id)
        backup = self._backups.get(backup_id)
        current = self._entities.get(entity_id)
        if backup is None or current is None or entity_id not in backup.members:
            raise RestoreBlocked("read-only archive membership is not proven")
        return ArchiveReceipt(entity_id, current.project_id, ArchiveState.READ_ONLY_IMPORT, backup.captured_epoch, current.tombstone_digest, True)

    def reconcile_restore(self, entity_id: str, *, forward_epoch: int, tombstone_digest: str) -> ArchiveReceipt:
        entity_id = _identifier("entity_id", entity_id)
        forward_epoch = _positive_int("forward_epoch", forward_epoch)
        tombstone_digest = _sha256("tombstone_digest", tombstone_digest)
        current = self._entities.get(entity_id)
        if current is None or current.state != ArchiveState.RESTORE_RECONCILIATION or forward_epoch < current.observed_epoch:
            raise RestoreBlocked("restore reconciliation is stale or unavailable")
        updated = ArchiveReceipt(entity_id, current.project_id, ArchiveState.TOMBSTONED, forward_epoch, tombstone_digest, True)
        self._entities[entity_id] = updated
        return updated

    def purge(self, entity_id: str, *, barrier_digest: str) -> ArchiveReceipt:
        entity_id = _identifier("entity_id", entity_id)
        barrier_digest = _sha256("barrier_digest", barrier_digest)
        current = self._entities.get(entity_id)
        if current is None or current.state != ArchiveState.TOMBSTONED:
            raise RestoreBlocked("entity is not behind a completed purge barrier")
        updated = ArchiveReceipt(entity_id, current.project_id, ArchiveState.PURGED, current.observed_epoch, current.tombstone_digest, True)
        self._entities[entity_id] = updated
        return updated


@dataclass(frozen=True)
class PackageReceipt:
    package_id: str
    version: str
    artifact_digest: str
    key_id: str
    key_generation: int
    security_epoch: int
    minimum_security_epoch: int
    state: PackageState
    verification_digest: str

    def __post_init__(self) -> None:
        for name in ("package_id", "version", "key_id"):
            _identifier(name, getattr(self, name))
        _sha256("artifact_digest", self.artifact_digest)
        _positive_int("key_generation", self.key_generation)
        _positive_int("security_epoch", self.security_epoch)
        _positive_int("minimum_security_epoch", self.minimum_security_epoch)
        if self.security_epoch < self.minimum_security_epoch:
            raise ContractViolation("package security epoch is below its floor")
        _enum("state", self.state, PackageState)
        _sha256("verification_digest", self.verification_digest)


class PackageTrustGuard:
    """Bind activation to current signing-key revocation and freshness."""

    def __init__(self) -> None:
        self._packages: dict[str, PackageReceipt] = {}
        self._revoked_keys: dict[str, int] = {}

    def register(self, package_id: str, *, version: str, artifact_digest: str, key_id: str, key_generation: int, security_epoch: int = 1, minimum_security_epoch: int = 1) -> PackageReceipt:
        package_id = _identifier("package_id", package_id)
        version = _identifier("version", version)
        artifact_digest = _sha256("artifact_digest", artifact_digest)
        key_id = _identifier("key_id", key_id)
        key_generation = _positive_int("key_generation", key_generation)
        security_epoch = _positive_int("security_epoch", security_epoch)
        minimum_security_epoch = _positive_int("minimum_security_epoch", minimum_security_epoch)
        receipt = PackageReceipt(package_id, version, artifact_digest, key_id, key_generation, security_epoch, minimum_security_epoch, PackageState.POLICY_BLOCKED, digest(f"package|{package_id}|{version}|{artifact_digest}|{key_id}|{key_generation}|{security_epoch}|{minimum_security_epoch}"))
        prior = self._packages.get(package_id)
        if prior is not None and prior != receipt:
            raise ProvenanceBlocked("package identity was reused with different manifest")
        self._packages[package_id] = receipt
        return receipt

    def revoke_key(self, key_id: str, *, revocation_generation: int) -> None:
        key_id = _identifier("key_id", key_id)
        revocation_generation = _positive_int("revocation_generation", revocation_generation)
        prior = self._revoked_keys.get(key_id, 0)
        if revocation_generation <= prior:
            raise ProvenanceBlocked("key revocation generation must advance")
        self._revoked_keys[key_id] = revocation_generation

    def verify(self, package_id: str, *, revocation_fresh: bool, observed_key_generation: int, observed_security_epoch: int = 1) -> PackageReceipt:
        package_id = _identifier("package_id", package_id)
        revocation_fresh = _bool("revocation_fresh", revocation_fresh)
        observed_key_generation = _positive_int("observed_key_generation", observed_key_generation)
        observed_security_epoch = _positive_int("observed_security_epoch", observed_security_epoch)
        prior = self._packages.get(package_id)
        if prior is None:
            raise ProvenanceBlocked("unknown package manifest")
        revoked_generation = self._revoked_keys.get(prior.key_id)
        if observed_security_epoch < max(prior.security_epoch, prior.minimum_security_epoch):
            state = PackageState.POLICY_BLOCKED
        elif not revocation_fresh:
            state = PackageState.UNKNOWN_REVOCATION_FRESHNESS
        elif revoked_generation is not None or observed_key_generation != prior.key_generation:
            state = PackageState.REVOKED
        else:
            state = PackageState.VERIFIED
        updated = PackageReceipt(**{**prior.__dict__, "state": state})
        self._packages[package_id] = updated
        return updated

    def activate(self, package_id: str, *, observed_key_generation: int, observed_security_epoch: int = 1) -> PackageReceipt:
        package_id = _identifier("package_id", package_id)
        observed_key_generation = _positive_int("observed_key_generation", observed_key_generation)
        observed_security_epoch = _positive_int("observed_security_epoch", observed_security_epoch)
        prior = self._packages.get(package_id)
        if prior is None:
            raise ProvenanceBlocked("unknown package cannot activate")
        revoked_generation = self._revoked_keys.get(prior.key_id)
        if prior.state != PackageState.VERIFIED or revoked_generation is not None or observed_key_generation != prior.key_generation or observed_security_epoch < max(prior.security_epoch, prior.minimum_security_epoch):
            state = PackageState.REVOKED if revoked_generation is not None else PackageState.POLICY_BLOCKED
            updated = PackageReceipt(**{**prior.__dict__, "state": state})
            self._packages[package_id] = updated
            raise ProvenanceBlocked("package activation is blocked by current trust evidence")
        updated = PackageReceipt(**{**prior.__dict__, "state": PackageState.ACTIVATED})
        self._packages[package_id] = updated
        return updated


@dataclass(frozen=True)
class ArtifactReceipt:
    artifact_id: str
    artifact_digest: str
    producer_id: str
    run_id: str
    sbom_digest: str
    source_commit_id: str
    workflow_id: str
    workflow_revision: str
    runner_trust: str
    cache_identity: str
    state: ArtifactState

    def __post_init__(self) -> None:
        _identifier("artifact_id", self.artifact_id)
        for name in ("producer_id", "run_id"):
            _identifier(name, getattr(self, name))
        _sha256("artifact_digest", self.artifact_digest)
        _sha256("sbom_digest", self.sbom_digest)
        for name in ("source_commit_id", "workflow_id", "workflow_revision", "runner_trust", "cache_identity"):
            _identifier(name, getattr(self, name))
        _enum("state", self.state, ArtifactState)


class ArtifactProvenanceGuard:
    """Reject poisoned bytes, cache aliases and unexpected CI producer identity."""

    def __init__(self) -> None:
        self._artifacts: dict[str, ArtifactReceipt] = {}

    def attest(
        self,
        artifact_id: str,
        *,
        artifact_digest: str,
        producer_id: str,
        run_id: str,
        sbom_digest: str,
        source_commit_id: str,
        workflow_id: str,
        workflow_revision: str,
        runner_trust: str,
        cache_identity: str,
    ) -> ArtifactReceipt:
        artifact_id = _identifier("artifact_id", artifact_id)
        artifact_digest = _sha256("artifact_digest", artifact_digest)
        producer_id = _identifier("producer_id", producer_id)
        run_id = _identifier("run_id", run_id)
        sbom_digest = _sha256("sbom_digest", sbom_digest)
        source_commit_id = _identifier("source_commit_id", source_commit_id)
        workflow_id = _identifier("workflow_id", workflow_id)
        workflow_revision = _identifier("workflow_revision", workflow_revision)
        runner_trust = _identifier("runner_trust", runner_trust)
        cache_identity = _identifier("cache_identity", cache_identity)
        receipt = ArtifactReceipt(artifact_id, artifact_digest, producer_id, run_id, sbom_digest, source_commit_id, workflow_id, workflow_revision, runner_trust, cache_identity, ArtifactState.ATTESTED)
        prior = self._artifacts.get(artifact_id)
        if prior is not None and prior != receipt:
            raise ProvenanceBlocked("artifact identity was reused with different provenance")
        self._artifacts[artifact_id] = receipt
        return receipt

    def consume(
        self,
        artifact_id: str,
        *,
        actual_digest: str,
        producer_id: str,
        run_id: str,
        sbom_digest: str,
        source_commit_id: str,
        workflow_id: str,
        workflow_revision: str,
        runner_trust: str,
        cache_identity: str,
    ) -> ArtifactReceipt:
        artifact_id = _identifier("artifact_id", artifact_id)
        actual_digest = _sha256("actual_digest", actual_digest)
        producer_id = _identifier("producer_id", producer_id)
        run_id = _identifier("run_id", run_id)
        sbom_digest = _sha256("sbom_digest", sbom_digest)
        source_commit_id = _identifier("source_commit_id", source_commit_id)
        workflow_id = _identifier("workflow_id", workflow_id)
        workflow_revision = _identifier("workflow_revision", workflow_revision)
        runner_trust = _identifier("runner_trust", runner_trust)
        cache_identity = _identifier("cache_identity", cache_identity)
        prior = self._artifacts.get(artifact_id)
        if prior is None:
            raise ProvenanceBlocked("artifact has no attestation")
        if prior.state != ArtifactState.ATTESTED:
            raise ProvenanceBlocked("artifact is not in a consumable attested state")
        if (actual_digest, producer_id, run_id, sbom_digest, source_commit_id, workflow_id, workflow_revision, runner_trust, cache_identity) != (prior.artifact_digest, prior.producer_id, prior.run_id, prior.sbom_digest, prior.source_commit_id, prior.workflow_id, prior.workflow_revision, prior.runner_trust, prior.cache_identity):
            updated = ArtifactReceipt(**{**prior.__dict__, "state": ArtifactState.QUARANTINED})
            self._artifacts[artifact_id] = updated
            raise ProvenanceBlocked("artifact/provenance evidence does not match attestation")
        updated = ArtifactReceipt(**{**prior.__dict__, "state": ArtifactState.CONSUMED})
        self._artifacts[artifact_id] = updated
        return updated


@dataclass(frozen=True)
class WorkspaceReceipt:
    workspace_id: str
    commit_id: str
    tree_digest: str
    generated_digest: str
    source_manifest_digest: str
    dependency_lock_digest: str
    clean: bool
    collision_free: bool
    state: WorkspaceState

    def __post_init__(self) -> None:
        _identifier("workspace_id", self.workspace_id)
        _text("commit_id", self.commit_id, maximum=128)
        _sha256("tree_digest", self.tree_digest)
        _sha256("generated_digest", self.generated_digest)
        _sha256("source_manifest_digest", self.source_manifest_digest)
        _sha256("dependency_lock_digest", self.dependency_lock_digest)
        _bool("clean", self.clean)
        _bool("collision_free", self.collision_free)
        _enum("state", self.state, WorkspaceState)


class ReleaseWorkspaceGuard:
    """Require exact clean source closure before release packaging."""

    def __init__(self) -> None:
        self._workspaces: dict[str, WorkspaceReceipt] = {}

    def snapshot(self, workspace_id: str, *, commit_id: str, tree_digest: str, generated_digest: str, source_manifest_digest: str, dependency_lock_digest: str, clean: bool, collision_free: bool) -> WorkspaceReceipt:
        workspace_id = _identifier("workspace_id", workspace_id)
        commit_id = _text("commit_id", commit_id, maximum=128)
        tree_digest = _sha256("tree_digest", tree_digest)
        generated_digest = _sha256("generated_digest", generated_digest)
        source_manifest_digest = _sha256("source_manifest_digest", source_manifest_digest)
        dependency_lock_digest = _sha256("dependency_lock_digest", dependency_lock_digest)
        clean = _bool("clean", clean)
        collision_free = _bool("collision_free", collision_free)
        state = WorkspaceState.SNAPSHOTTED
        receipt = WorkspaceReceipt(workspace_id, commit_id, tree_digest, generated_digest, source_manifest_digest, dependency_lock_digest, clean, collision_free, state)
        prior = self._workspaces.get(workspace_id)
        if prior is not None and prior != receipt:
            raise ProvenanceBlocked("workspace identity was reused with different closure")
        self._workspaces[workspace_id] = receipt
        return receipt

    def authorize(self, workspace_id: str, *, commit_id: str, tree_digest: str, generated_digest: str, source_manifest_digest: str, dependency_lock_digest: str, clean: bool, collision_free: bool) -> WorkspaceReceipt:
        workspace_id = _identifier("workspace_id", workspace_id)
        commit_id = _text("commit_id", commit_id, maximum=128)
        tree_digest = _sha256("tree_digest", tree_digest)
        generated_digest = _sha256("generated_digest", generated_digest)
        source_manifest_digest = _sha256("source_manifest_digest", source_manifest_digest)
        dependency_lock_digest = _sha256("dependency_lock_digest", dependency_lock_digest)
        clean = _bool("clean", clean)
        collision_free = _bool("collision_free", collision_free)
        prior = self._workspaces.get(workspace_id)
        if prior is None:
            raise ProvenanceBlocked("workspace has no source closure snapshot")
        if not clean or not collision_free or (commit_id, tree_digest, generated_digest, source_manifest_digest, dependency_lock_digest) != (prior.commit_id, prior.tree_digest, prior.generated_digest, prior.source_manifest_digest, prior.dependency_lock_digest):
            updated = WorkspaceReceipt(**{**prior.__dict__, "state": WorkspaceState.RELEASE_BLOCKED})
            self._workspaces[workspace_id] = updated
            raise ProvenanceBlocked("release source closure is dirty, colliding or stale")
        updated = WorkspaceReceipt(**{**prior.__dict__, "state": WorkspaceState.READY})
        self._workspaces[workspace_id] = updated
        return updated


@dataclass(frozen=True)
class SigningReceipt:
    request_id: str
    artifact_id: str
    manifest_digest: str
    expected_artifact_digest: str
    state: SigningState
    expected_final_bytes_digest: str
    signer_id: str | None = None
    final_bytes_digest: str | None = None

    def __post_init__(self) -> None:
        for name in ("request_id", "artifact_id"):
            _identifier(name, getattr(self, name))
        _sha256("manifest_digest", self.manifest_digest)
        _sha256("expected_artifact_digest", self.expected_artifact_digest)
        _enum("state", self.state, SigningState)
        _sha256("expected_final_bytes_digest", self.expected_final_bytes_digest)
        if self.signer_id is not None:
            _identifier("signer_id", self.signer_id)
        if self.final_bytes_digest is not None:
            _sha256("final_bytes_digest", self.final_bytes_digest)


class SignerBindingGuard:
    """Bind the signer request to exact manifest and final-byte digests."""

    def __init__(self) -> None:
        self._requests: dict[str, SigningReceipt] = {}

    def begin(self, request_id: str, *, artifact_id: str, manifest_digest: str, expected_artifact_digest: str, expected_final_bytes_digest: str) -> SigningReceipt:
        request_id = _identifier("request_id", request_id)
        artifact_id = _identifier("artifact_id", artifact_id)
        manifest_digest = _sha256("manifest_digest", manifest_digest)
        expected_artifact_digest = _sha256("expected_artifact_digest", expected_artifact_digest)
        expected_final_bytes_digest = _sha256("expected_final_bytes_digest", expected_final_bytes_digest)
        receipt = SigningReceipt(request_id, artifact_id, manifest_digest, expected_artifact_digest, SigningState.PENDING, expected_final_bytes_digest)
        prior = self._requests.get(request_id)
        if prior is not None and (prior.artifact_id, prior.manifest_digest, prior.expected_artifact_digest, prior.expected_final_bytes_digest) != (artifact_id, manifest_digest, expected_artifact_digest, expected_final_bytes_digest):
            raise ProvenanceBlocked("signing request identity was reused with different bytes")
        if prior is not None:
            return prior
        self._requests[request_id] = receipt
        return receipt

    def sign(self, request_id: str, *, actual_artifact_digest: str, actual_manifest_digest: str, final_bytes_digest: str, signer_id: str) -> SigningReceipt:
        request_id = _identifier("request_id", request_id)
        actual_artifact_digest = _sha256("actual_artifact_digest", actual_artifact_digest)
        actual_manifest_digest = _sha256("actual_manifest_digest", actual_manifest_digest)
        final_bytes_digest = _sha256("final_bytes_digest", final_bytes_digest)
        signer_id = _identifier("signer_id", signer_id)
        prior = self._requests.get(request_id)
        if prior is None:
            raise ProvenanceBlocked("unknown signing request")
        if prior.state == SigningState.SIGNED:
            if (prior.final_bytes_digest, prior.signer_id) == (final_bytes_digest, signer_id):
                return prior
            raise ProvenanceBlocked("signed request cannot be rebound to different bytes or signer")
        if prior.state == SigningState.SIGNING_BLOCKED:
            raise ProvenanceBlocked("blocked signing request is terminal and requires a new request identity")
        if (actual_artifact_digest, actual_manifest_digest, final_bytes_digest) != (prior.expected_artifact_digest, prior.manifest_digest, prior.expected_final_bytes_digest):
            updated = SigningReceipt(**{**prior.__dict__, "state": SigningState.SIGNING_BLOCKED})
            self._requests[request_id] = updated
            raise ProvenanceBlocked("signer received bytes outside the approved manifest")
        updated = SigningReceipt(**{**prior.__dict__, "state": SigningState.SIGNED, "signer_id": signer_id, "final_bytes_digest": final_bytes_digest})
        self._requests[request_id] = updated
        return updated

    def verify_final_bytes(self, request_id: str, *, observed_final_bytes_digest: str) -> SigningReceipt:
        request_id = _identifier("request_id", request_id)
        observed_final_bytes_digest = _sha256("observed_final_bytes_digest", observed_final_bytes_digest)
        prior = self._requests.get(request_id)
        if prior is None or prior.state != SigningState.SIGNED:
            raise ProvenanceBlocked("only a signed request can be reverified")
        if observed_final_bytes_digest != prior.final_bytes_digest:
            updated = SigningReceipt(**{**prior.__dict__, "state": SigningState.SIGNING_BLOCKED})
            self._requests[request_id] = updated
            raise ProvenanceBlocked("final bytes changed after signing")
        return prior


@dataclass(frozen=True)
class OfflineCommandReceipt:
    command_id: str
    branch_id: str
    project_id: str
    actor_id: str
    base_authority_epoch: int
    irreversible: bool
    payload_digest: str
    state: AuthorityState

    def __post_init__(self) -> None:
        for name in ("command_id", "branch_id", "project_id", "actor_id"):
            _identifier(name, getattr(self, name))
        _positive_int("base_authority_epoch", self.base_authority_epoch)
        _bool("irreversible", self.irreversible)
        _sha256("payload_digest", self.payload_digest)
        _enum("state", self.state, AuthorityState)


class OfflineAuthorityGuard:
    """Preserve offline work while fencing stale authority on reconnect."""

    def __init__(self) -> None:
        self._epochs: dict[str, int] = {}
        self._commands: dict[str, OfflineCommandReceipt] = {}

    def register_project(self, project_id: str, *, authority_epoch: int = 1) -> int:
        project_id = _identifier("project_id", project_id)
        authority_epoch = _positive_int("authority_epoch", authority_epoch)
        prior = self._epochs.get(project_id)
        if prior is not None and prior != authority_epoch:
            raise AuthorityBlocked("project authority epoch was reused")
        self._epochs[project_id] = authority_epoch
        return authority_epoch

    def queue(self, command_id: str, *, branch_id: str, project_id: str, actor_id: str, base_authority_epoch: int, irreversible: bool, payload_digest: str) -> OfflineCommandReceipt:
        command_id = _identifier("command_id", command_id)
        branch_id = _identifier("branch_id", branch_id)
        project_id = _identifier("project_id", project_id)
        actor_id = _identifier("actor_id", actor_id)
        base_authority_epoch = _positive_int("base_authority_epoch", base_authority_epoch)
        irreversible = _bool("irreversible", irreversible)
        payload_digest = _sha256("payload_digest", payload_digest)
        receipt = OfflineCommandReceipt(command_id, branch_id, project_id, actor_id, base_authority_epoch, irreversible, payload_digest, AuthorityState.QUEUED)
        prior = self._commands.get(command_id)
        if prior is not None and prior != receipt:
            raise AuthorityBlocked("offline command identity was reused with different payload")
        self._commands[command_id] = receipt
        return receipt

    def revoke(self, project_id: str, *, new_authority_epoch: int) -> int:
        project_id = _identifier("project_id", project_id)
        new_authority_epoch = _positive_int("new_authority_epoch", new_authority_epoch)
        prior = self._epochs.get(project_id)
        if prior is None or new_authority_epoch <= prior:
            raise AuthorityBlocked("authority epoch must advance")
        self._epochs[project_id] = new_authority_epoch
        return new_authority_epoch

    def reconnect(self, command_id: str, *, observed_authority_epoch: int) -> OfflineCommandReceipt:
        command_id = _identifier("command_id", command_id)
        observed_authority_epoch = _positive_int("observed_authority_epoch", observed_authority_epoch)
        prior = self._commands.get(command_id)
        if prior is None:
            raise AuthorityBlocked("unknown offline command")
        if prior.state == AuthorityState.EXECUTED:
            return prior
        current_epoch = self._epochs.get(prior.project_id)
        if current_epoch is None or observed_authority_epoch != current_epoch:
            updated = OfflineCommandReceipt(**{**prior.__dict__, "state": AuthorityState.AUTHORITY_REVOKED})
            self._commands[command_id] = updated
            return updated
        if prior.base_authority_epoch < current_epoch:
            updated = OfflineCommandReceipt(**{**prior.__dict__, "state": AuthorityState.IMPORT_AS_BRANCH_REQUIRED})
            self._commands[command_id] = updated
            return updated
        updated = OfflineCommandReceipt(**{**prior.__dict__, "state": AuthorityState.READY_TO_SYNC})
        self._commands[command_id] = updated
        return updated

    def execute_irreversible(self, command_id: str, *, online_authority_epoch: int | None = None, online_session_digest: str | None = None) -> OfflineCommandReceipt:
        command_id = _identifier("command_id", command_id)
        prior = self._commands.get(command_id)
        if prior is None or prior.state != AuthorityState.READY_TO_SYNC or not prior.irreversible:
            raise AuthorityBlocked("offline irreversible command has no current authority")
        if online_authority_epoch is None or online_session_digest is None:
            raise AuthorityBlocked("irreversible command requires a fresh online authority session")
        online_authority_epoch = _positive_int("online_authority_epoch", online_authority_epoch)
        online_session_digest = _sha256("online_session_digest", online_session_digest)
        current_epoch = self._epochs.get(prior.project_id)
        if online_authority_epoch != current_epoch:
            raise AuthorityBlocked("online authority token is stale")
        expected_session_digest = digest(f"online-authority|{prior.project_id}|{current_epoch}")
        if online_session_digest != expected_session_digest:
            raise AuthorityBlocked("online authority session is not bound to the current project epoch")
        updated = OfflineCommandReceipt(**{**prior.__dict__, "state": AuthorityState.EXECUTED})
        self._commands[command_id] = updated
        return updated


@dataclass(frozen=True)
class DeploymentReceipt:
    release_id: str
    deployment_id: str
    lineage_id: str
    deployment_generation: int
    activation_epoch: int
    recovery_epoch: int
    artifact_digest: str
    side_effect_namespace: str
    state: DeploymentState

    def __post_init__(self) -> None:
        _identifier("release_id", self.release_id)
        _identifier("deployment_id", self.deployment_id)
        _identifier("lineage_id", self.lineage_id)
        _positive_int("deployment_generation", self.deployment_generation)
        _positive_int("activation_epoch", self.activation_epoch)
        _positive_int("recovery_epoch", self.recovery_epoch)
        _sha256("artifact_digest", self.artifact_digest)
        _identifier("side_effect_namespace", self.side_effect_namespace)
        _enum("state", self.state, DeploymentState)


class DeploymentFence:
    """Select one canonical active deployment and expose residual split-brain."""

    def __init__(self) -> None:
        self._active: dict[str, DeploymentReceipt] = {}
        self._records: dict[str, DeploymentReceipt] = {}

    def activate(
        self,
        release_id: str,
        *,
        deployment_id: str,
        lineage_id: str,
        deployment_generation: int,
        activation_epoch: int,
        recovery_epoch: int,
        artifact_digest: str,
        side_effect_namespace: str,
    ) -> DeploymentReceipt:
        release_id = _identifier("release_id", release_id)
        deployment_id = _identifier("deployment_id", deployment_id)
        lineage_id = _identifier("lineage_id", lineage_id)
        deployment_generation = _positive_int("deployment_generation", deployment_generation)
        activation_epoch = _positive_int("activation_epoch", activation_epoch)
        recovery_epoch = _positive_int("recovery_epoch", recovery_epoch)
        artifact_digest = _sha256("artifact_digest", artifact_digest)
        side_effect_namespace = _identifier("side_effect_namespace", side_effect_namespace)
        prior = self._records.get(deployment_id)
        if prior is not None:
            if (
                prior.release_id,
                prior.lineage_id,
                prior.deployment_generation,
                prior.activation_epoch,
                prior.recovery_epoch,
                prior.artifact_digest,
                prior.side_effect_namespace,
            ) != (
                release_id,
                lineage_id,
                deployment_generation,
                activation_epoch,
                recovery_epoch,
                artifact_digest,
                side_effect_namespace,
            ):
                raise DeploymentBlocked("deployment identity was reused with different release")
            return prior
        active = self._active.get(release_id)
        if active is not None:
            same_lineage = lineage_id == active.lineage_id
            same_namespace = side_effect_namespace == active.side_effect_namespace
            state = DeploymentState.FORKED if same_lineage and same_namespace and activation_epoch >= active.activation_epoch else DeploymentState.QUARANTINED
            fork = DeploymentReceipt(release_id, deployment_id, lineage_id, deployment_generation, activation_epoch, recovery_epoch, artifact_digest, side_effect_namespace, state)
            self._records[deployment_id] = fork
            raise DeploymentBlocked("release already has a canonical active deployment")
        receipt = DeploymentReceipt(release_id, deployment_id, lineage_id, deployment_generation, activation_epoch, recovery_epoch, artifact_digest, side_effect_namespace, DeploymentState.ACTIVE)
        self._active[release_id] = receipt
        self._records[deployment_id] = receipt
        return receipt

    def compensate(self, deployment_id: str, *, reason_digest: str) -> DeploymentReceipt:
        deployment_id = _identifier("deployment_id", deployment_id)
        _sha256("reason_digest", reason_digest)
        prior = self._records.get(deployment_id)
        if prior is None or prior.state not in {DeploymentState.FORKED, DeploymentState.QUARANTINED}:
            raise DeploymentBlocked("only a noncanonical deployment can require compensation")
        updated = DeploymentReceipt(**{**prior.__dict__, "state": DeploymentState.COMPENSATION_REQUIRED})
        self._records[deployment_id] = updated
        return updated

    def canonical(self, release_id: str) -> DeploymentReceipt:
        release_id = _identifier("release_id", release_id)
        receipt = self._active.get(release_id)
        if receipt is None:
            raise DeploymentBlocked("release has no canonical active deployment")
        return receipt

    def record(self, deployment_id: str) -> DeploymentReceipt:
        deployment_id = _identifier("deployment_id", deployment_id)
        receipt = self._records.get(deployment_id)
        if receipt is None:
            raise DeploymentBlocked("unknown deployment")
        return receipt


__all__ = [
    "ArchiveReceipt",
    "ArchiveRestoreGuard",
    "ArchiveState",
    "ArtifactProvenanceGuard",
    "ArtifactReceipt",
    "ArtifactState",
    "AuthorityBlocked",
    "AuthorityState",
    "CacheReceipt",
    "CacheState",
    "DeploymentBlocked",
    "DeploymentFence",
    "DeploymentReceipt",
    "DeploymentState",
    "OfflineAuthorityGuard",
    "OfflineCommandReceipt",
    "PackageReceipt",
    "PackageState",
    "PackageTrustGuard",
    "ProvenanceBlocked",
    "ReleaseWorkspaceGuard",
    "RightsBlocked",
    "RightsCacheGuard",
    "RightsReceipt",
    "RightsState",
    "RestoreBlocked",
    "SignerBindingGuard",
    "SigningReceipt",
    "SigningState",
    "WorkspaceReceipt",
    "WorkspaceState",
    "digest",
]
