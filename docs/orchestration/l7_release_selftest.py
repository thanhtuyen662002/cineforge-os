#!/usr/bin/env python3
"""Deterministic negative fixtures for the L7 release boundary harness."""

from __future__ import annotations

import sys
from pathlib import Path

if not __debug__:
    raise RuntimeError("L7 release self-test must run without Python -O so assertions cannot be skipped")

try:
    from l7_release_contract import (
        ArchiveRestoreGuard,
        ArchiveState,
        ArtifactProvenanceGuard,
        ArtifactState,
        AuthorityBlocked,
        AuthorityState,
        DeploymentBlocked,
        DeploymentFence,
        DeploymentState,
        OfflineAuthorityGuard,
        PackageState,
        PackageTrustGuard,
        ProvenanceBlocked,
        ReleaseWorkspaceGuard,
        RightsBlocked,
        RightsCacheGuard,
        SigningState,
        SignerBindingGuard,
        RestoreBlocked,
        ContractViolation,
        digest,
    )
except ModuleNotFoundError as exc:
    if exc.name != "l7_release_contract":
        raise
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from l7_release_contract import (  # type: ignore
        ArchiveRestoreGuard,
        ArchiveState,
        ArtifactProvenanceGuard,
        ArtifactState,
        AuthorityBlocked,
        AuthorityState,
        DeploymentBlocked,
        DeploymentFence,
        DeploymentState,
        OfflineAuthorityGuard,
        PackageState,
        PackageTrustGuard,
        ProvenanceBlocked,
        ReleaseWorkspaceGuard,
        RightsBlocked,
        RightsCacheGuard,
        SigningState,
        SignerBindingGuard,
        RestoreBlocked,
        ContractViolation,
        digest,
    )


def _raises(error_type: type[BaseException], callback) -> None:
    try:
        callback()
    except error_type:
        return
    raise AssertionError(f"expected {error_type.__name__}")


def test_ct29_rights_generation_cache_fence() -> None:
    guard = RightsCacheGuard()
    scope = guard.register_scope("scope-1", project_id="project-1", entity_id="asset-1", generation=1)
    assert scope.generation == 1
    cache = guard.materialize("cache-1", scope_id="scope-1", project_id="project-1", entity_id="asset-1", source_revision="rev-1", rights_generation=1, content_digest=digest("cache"))
    assert guard.read("cache-1", scope_id="scope-1", project_id="project-1", observed_generation=1) == cache
    assert guard.revoke("scope-1", new_generation=2, reason_digest=digest("revoke")).state.value == "REVOKED"
    _raises(RightsBlocked, lambda: guard.read("cache-1", scope_id="scope-1", project_id="project-1", observed_generation=1))
    assert guard.purge("cache-1", barrier_digest=digest("purge")).state.value == "PURGED"
    _raises(RightsBlocked, lambda: guard.read("cache-1", scope_id="scope-1", project_id="project-2", observed_generation=2))


def test_ct30_forward_restore_reconciliation() -> None:
    guard = ArchiveRestoreGuard()
    guard.register_entity("asset-1", project_id="project-1", epoch=1)
    guard.create_backup("backup-1", captured_epoch=1, members=("asset-1",), snapshot_digest=digest("backup"))
    assert guard.delete("asset-1", deletion_epoch=2, tombstone_digest=digest("tombstone")).state == ArchiveState.TOMBSTONED
    assert guard.restore("backup-1", "asset-1").state == ArchiveState.RESTORE_RECONCILIATION
    assert guard.reconcile_restore("asset-1", forward_epoch=2, tombstone_digest=digest("forward")).state == ArchiveState.TOMBSTONED
    assert guard.purge("asset-1", barrier_digest=digest("barrier")).state == ArchiveState.PURGED
    guard.register_entity("asset-hold", project_id="project-1", epoch=1)
    assert guard.delete("asset-hold", deletion_epoch=2, tombstone_digest=digest("hold"), legal_hold=True).state == ArchiveState.PURGE_PENDING
    _raises(RestoreBlocked, lambda: guard.purge("asset-hold", barrier_digest=digest("forbidden")))


def test_ct31_key_revocation_and_freshness() -> None:
    guard = PackageTrustGuard()
    guard.register("pkg-1", version="1", artifact_digest=digest("pkg"), key_id="key-1", key_generation=1)
    assert guard.verify("pkg-1", revocation_fresh=True, observed_key_generation=1).state == PackageState.VERIFIED
    guard.revoke_key("key-1", revocation_generation=2)
    _raises(ProvenanceBlocked, lambda: guard.activate("pkg-1", observed_key_generation=1))
    assert guard.verify("pkg-1", revocation_fresh=True, observed_key_generation=1).state == PackageState.REVOKED
    guard.register("pkg-2", version="1", artifact_digest=digest("pkg-2"), key_id="key-2", key_generation=1)
    assert guard.verify("pkg-2", revocation_fresh=False, observed_key_generation=1).state == PackageState.UNKNOWN_REVOCATION_FRESHNESS
    _raises(ProvenanceBlocked, lambda: guard.activate("pkg-2", observed_key_generation=1))
    guard.register("pkg-floor", version="1", artifact_digest=digest("pkg-floor"), key_id="key-floor", key_generation=1, security_epoch=2, minimum_security_epoch=2)
    assert guard.verify("pkg-floor", revocation_fresh=True, observed_key_generation=1, observed_security_epoch=1).state == PackageState.POLICY_BLOCKED
    _raises(ProvenanceBlocked, lambda: guard.activate("pkg-floor", observed_key_generation=1, observed_security_epoch=1))
    guard.register("pkg-rollback", version="2", artifact_digest=digest("pkg-rollback"), key_id="key-rollback", key_generation=1, security_epoch=3, minimum_security_epoch=1)
    assert guard.verify("pkg-rollback", revocation_fresh=True, observed_key_generation=1, observed_security_epoch=2).state == PackageState.POLICY_BLOCKED


def test_ct32_artifact_attestation() -> None:
    guard = ArtifactProvenanceGuard()
    provenance = dict(source_commit_id="commit-1", workflow_id="workflow-1", workflow_revision="workflow-rev-1", runner_trust="trusted-runner", cache_identity="cache-1")
    guard.attest("artifact-1", artifact_digest=digest("good"), producer_id="workflow-1", run_id="run-1", sbom_digest=digest("sbom"), **provenance)
    _raises(ProvenanceBlocked, lambda: guard.consume("artifact-1", actual_digest=digest("poison"), producer_id="workflow-1", run_id="run-1", sbom_digest=digest("sbom"), **provenance))
    _raises(ProvenanceBlocked, lambda: guard.consume("artifact-1", actual_digest=digest("good"), producer_id="workflow-1", run_id="run-1", sbom_digest=digest("sbom"), **provenance))
    provenance2 = dict(source_commit_id="commit-2", workflow_id="workflow-1", workflow_revision="workflow-rev-2", runner_trust="trusted-runner", cache_identity="cache-2")
    guard.attest("artifact-2", artifact_digest=digest("good-2"), producer_id="workflow-1", run_id="run-2", sbom_digest=digest("sbom-2"), **provenance2)
    assert guard.consume("artifact-2", actual_digest=digest("good-2"), producer_id="workflow-1", run_id="run-2", sbom_digest=digest("sbom-2"), **provenance2).state == ArtifactState.CONSUMED
    provenance3 = dict(source_commit_id="commit-3", workflow_id="workflow-2", workflow_revision="workflow-rev-3", runner_trust="trusted-runner", cache_identity="cache-3")
    guard.attest("artifact-3", artifact_digest=digest("good-3"), producer_id="workflow-2", run_id="run-3", sbom_digest=digest("sbom-3"), **provenance3)
    _raises(ProvenanceBlocked, lambda: guard.consume("artifact-3", actual_digest=digest("good-3"), producer_id="workflow-2", run_id="run-3", sbom_digest=digest("sbom-3"), source_commit_id="commit-3", workflow_id="workflow-2", workflow_revision="wrong-revision", runner_trust="trusted-runner", cache_identity="cache-3"))


def test_ct33_clean_release_closure() -> None:
    guard = ReleaseWorkspaceGuard()
    closure = dict(source_manifest_digest=digest("source-manifest"), dependency_lock_digest=digest("dependency-lock"))
    guard.snapshot("workspace-1", commit_id="commit-1", tree_digest=digest("tree"), generated_digest=digest("generated"), clean=True, collision_free=True, **closure)
    assert guard.authorize("workspace-1", commit_id="commit-1", tree_digest=digest("tree"), generated_digest=digest("generated"), clean=True, collision_free=True, **closure).state.value == "READY"
    guard.snapshot("workspace-dirty", commit_id="commit-2", tree_digest=digest("tree-2"), generated_digest=digest("generated-2"), clean=True, collision_free=True, **closure)
    _raises(ProvenanceBlocked, lambda: guard.authorize("workspace-dirty", commit_id="commit-2", tree_digest=digest("tree-2"), generated_digest=digest("changed"), clean=False, collision_free=True, **closure))
    guard.snapshot("workspace-stale-manifest", commit_id="commit-3", tree_digest=digest("tree-3"), generated_digest=digest("generated-3"), clean=True, collision_free=True, **closure)
    _raises(ProvenanceBlocked, lambda: guard.authorize("workspace-stale-manifest", commit_id="commit-3", tree_digest=digest("tree-3"), generated_digest=digest("generated-3"), source_manifest_digest=digest("changed-manifest"), dependency_lock_digest=digest("dependency-lock"), clean=True, collision_free=True))
    guard.snapshot("workspace-collision", commit_id="commit-4", tree_digest=digest("tree-4"), generated_digest=digest("generated-4"), clean=True, collision_free=True, **closure)
    _raises(ProvenanceBlocked, lambda: guard.authorize("workspace-collision", commit_id="commit-4", tree_digest=digest("tree-4"), generated_digest=digest("generated-4"), clean=True, collision_free=False, **closure))


def test_ct34_signer_digest_fence() -> None:
    guard = SignerBindingGuard()
    guard.begin("request-1", artifact_id="artifact-1", manifest_digest=digest("manifest"), expected_artifact_digest=digest("artifact"), expected_final_bytes_digest=digest("final"))
    _raises(ProvenanceBlocked, lambda: guard.sign("request-1", actual_artifact_digest=digest("wrong"), actual_manifest_digest=digest("manifest"), final_bytes_digest=digest("final"), signer_id="signer-1"))
    guard.begin("request-2", artifact_id="artifact-1", manifest_digest=digest("manifest"), expected_artifact_digest=digest("artifact"), expected_final_bytes_digest=digest("final"))
    signed = guard.sign("request-2", actual_artifact_digest=digest("artifact"), actual_manifest_digest=digest("manifest"), final_bytes_digest=digest("final"), signer_id="signer-1")
    assert signed.state == SigningState.SIGNED
    assert guard.verify_final_bytes("request-2", observed_final_bytes_digest=digest("final")) == signed
    assert guard.sign("request-2", actual_artifact_digest=digest("artifact"), actual_manifest_digest=digest("manifest"), final_bytes_digest=digest("final"), signer_id="signer-1") == signed
    _raises(ProvenanceBlocked, lambda: guard.sign("request-2", actual_artifact_digest=digest("artifact"), actual_manifest_digest=digest("manifest"), final_bytes_digest=digest("changed-final"), signer_id="signer-1"))
    _raises(ProvenanceBlocked, lambda: guard.verify_final_bytes("request-2", observed_final_bytes_digest=digest("changed-final")))
    _raises(ProvenanceBlocked, lambda: guard.sign("request-2", actual_artifact_digest=digest("artifact"), actual_manifest_digest=digest("manifest"), final_bytes_digest=digest("final"), signer_id="signer-1"))


def test_ct38_offline_authority_fence() -> None:
    guard = OfflineAuthorityGuard()
    guard.register_project("project-1", authority_epoch=1)
    guard.queue("command-1", branch_id="branch-1", project_id="project-1", actor_id="actor-1", base_authority_epoch=1, irreversible=True, payload_digest=digest("publish"))
    guard.revoke("project-1", new_authority_epoch=2)
    stale = guard.reconnect("command-1", observed_authority_epoch=2)
    assert stale.state == AuthorityState.IMPORT_AS_BRANCH_REQUIRED
    _raises(AuthorityBlocked, lambda: guard.execute_irreversible("command-1"))
    guard.queue("command-2", branch_id="branch-1", project_id="project-1", actor_id="actor-1", base_authority_epoch=2, irreversible=True, payload_digest=digest("fresh"))
    assert guard.reconnect("command-2", observed_authority_epoch=2).state == AuthorityState.READY_TO_SYNC
    _raises(AuthorityBlocked, lambda: guard.execute_irreversible("command-2"))
    _raises(AuthorityBlocked, lambda: guard.execute_irreversible("command-2", online_authority_epoch=2, online_session_digest=digest("online-session")))
    assert guard.execute_irreversible("command-2", online_authority_epoch=2, online_session_digest=digest("online-authority|project-1|2")).state == AuthorityState.EXECUTED
    assert guard.reconnect("command-2", observed_authority_epoch=2).state == AuthorityState.EXECUTED
    _raises(AuthorityBlocked, lambda: guard.execute_irreversible("command-2", online_authority_epoch=2, online_session_digest=digest("online-authority|project-1|2")))


def test_ct40_deployment_split_brain() -> None:
    guard = DeploymentFence()
    primary = guard.activate(
        "release-1",
        deployment_id="deploy-1",
        lineage_id="lineage-1",
        deployment_generation=1,
        activation_epoch=1,
        recovery_epoch=1,
        artifact_digest=digest("release"),
        side_effect_namespace="effects-release-1",
    )
    assert primary.state == DeploymentState.ACTIVE and guard.canonical("release-1") == primary
    _raises(
        DeploymentBlocked,
        lambda: guard.activate(
            "release-1",
            deployment_id="deploy-2",
            lineage_id="lineage-1",
            deployment_generation=1,
            activation_epoch=1,
            recovery_epoch=1,
            artifact_digest=digest("release"),
            side_effect_namespace="effects-release-1",
        ),
    )
    assert guard.record("deploy-2").state == DeploymentState.FORKED
    assert guard.compensate("deploy-2", reason_digest=digest("split-brain")).state == DeploymentState.COMPENSATION_REQUIRED
    _raises(
        DeploymentBlocked,
        lambda: guard.activate(
            "release-1",
            deployment_id="deploy-3",
            lineage_id="foreign-lineage",
            deployment_generation=2,
            activation_epoch=1,
            recovery_epoch=2,
            artifact_digest=digest("different"),
            side_effect_namespace="effects-foreign",
        ),
    )
    assert guard.record("deploy-3").state == DeploymentState.QUARANTINED


def test_supplemental_archive_import() -> None:
    guard = ArchiveRestoreGuard()
    guard.register_entity("archive-asset", project_id="project-archive", epoch=1)
    guard.create_backup("archive-backup", captured_epoch=1, members=("archive-asset",), snapshot_digest=digest("archive"))
    assert guard.import_read_only("archive-backup", "archive-asset").state == ArchiveState.READ_ONLY_IMPORT
    assert guard.restore("archive-backup", "archive-asset").state == ArchiveState.RESTORED


def test_negative_type_boundaries() -> None:
    guard = RightsCacheGuard()
    _raises(ContractViolation, lambda: guard.register_scope("scope-bool", project_id="project", entity_id="entity", generation=True))
    _raises(ContractViolation, lambda: guard.register_scope("scope-empty", project_id="project", entity_id="entity", generation=1, rights_digest="bad"))
    _raises(ContractViolation, lambda: ReleaseWorkspaceGuard().snapshot("workspace", commit_id="", tree_digest=digest("tree"), generated_digest=digest("generated"), source_manifest_digest=digest("source-manifest"), dependency_lock_digest=digest("dependency-lock"), clean=True, collision_free=True))


def main() -> int:
    tests = (
        ("CT-29", test_ct29_rights_generation_cache_fence),
        ("CT-30", test_ct30_forward_restore_reconciliation),
        ("CT-31", test_ct31_key_revocation_and_freshness),
        ("CT-32", test_ct32_artifact_attestation),
        ("CT-33", test_ct33_clean_release_closure),
        ("CT-34", test_ct34_signer_digest_fence),
        ("CT-38", test_ct38_offline_authority_fence),
        ("CT-40", test_ct40_deployment_split_brain),
        ("SUPPLEMENTAL-ARCHIVE", test_supplemental_archive_import),
        ("NEGATIVE", test_negative_type_boundaries),
    )
    for marker, test in tests:
        test()
        print(f"PASS {marker}")
    print(f"L7_RELEASE_SELFTEST=PASS cases={len(tests)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
