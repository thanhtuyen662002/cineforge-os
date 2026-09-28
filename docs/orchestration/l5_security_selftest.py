#!/usr/bin/env python3
"""Negative fixtures for the L5 reference security contract."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Callable, Type


HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

from l5_security_contract import (  # noqa: E402
    AliasMode,
    ArtifactAttestation,
    ArtifactAttestationGuard,
    BrowserSemanticGuard,
    BrowserSessionIdentity,
    BrowserState,
    BudgetExceeded,
    CallbackState,
    CallbackVerifier,
    CapabilityDenied,
    CapabilityToken,
    CASAliasGuard,
    ConnectionIdentity,
    ConnectionIdentityFence,
    ConnectionState,
    ContextCompiler,
    ContextSegment,
    ContextState,
    EgressGuard,
    EgressManifest,
    ExternalArtifactMaterializer,
    ExternalArtifactReceipt,
    InstallScriptState,
    IPCGuard,
    KeyState,
    MaterializationState,
    PackageEnvelope,
    ParserBudget,
    ParserSandbox,
    ParserUsage,
    PolicyBlocked,
    ProvenanceRejected,
    ProviderCallback,
    ReleaseWorkspace,
    ReleaseWorkspaceGuard,
    StageState,
    StagedArtifactPipeline,
    SupplyChainVerifier,
    ToolchainGuard,
    ToolchainIdentity,
    TrustClass,
    TrustKey,
    TypedToolCall,
    TypedToolGate,
    URLFetchPolicy,
    URLPolicyGuard,
    VulnerabilityState,
    WindowsCollisionGuard,
    WebViewBridgeGuard,
    digest,
)
from l4_recovery_contract import ContractViolation  # noqa: E402


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


def make_pipeline() -> StagedArtifactPipeline:
    return StagedArtifactPipeline(managed_root="C:\\CineForge\\library", temp_root="C:\\CineForge\\tmp")


def make_url_guard() -> URLPolicyGuard:
    return URLPolicyGuard(URLFetchPolicy())


def make_connection(account: str = "account-a", workspace: str = "workspace-a", fingerprint: str = "connection-a") -> ConnectionIdentity:
    return ConnectionIdentity("connection-1", account, "tenant-a", workspace, "region-a", digest(fingerprint))


def test_ct17_hostile_staging_and_parser() -> None:
    pipeline = make_pipeline()
    mismatch = pipeline.ingest(
        artifact_id="artifact-17",
        source_path="input\\movie.zip",
        staging_path="attempt-17\\movie.zip",
        expected_digest=digest("expected"),
        actual_digest=digest("tampered"),
        decode_verified=True,
    )
    require(mismatch.state == StageState.QUARANTINED, "digest mismatch must quarantine staged bytes")
    expect_error(ContractViolation, lambda: pipeline.ingest(
        artifact_id="artifact-17",
        source_path="input\\movie.zip",
        staging_path="attempt-17\\movie.zip",
        expected_digest=digest("expected"),
        actual_digest=digest("tampered"),
        decode_verified=True,
        reparse_point=True,
    ))
    expect_error(PolicyBlocked, lambda: pipeline.ingest(
        artifact_id="artifact-escape",
        source_path="..\\outside.zip",
        staging_path="attempt-17\\outside.zip",
        expected_digest=digest("x"),
        actual_digest=digest("x"),
        decode_verified=True,
    ))
    valid = pipeline.ingest(
        artifact_id="artifact-ready",
        source_path="input\\ready.zip",
        staging_path="attempt-17\\ready.zip",
        expected_digest=digest("ready"),
        actual_digest=digest("ready"),
        decode_verified=True,
        stable_handle_verified=True,
    )
    require(valid.state == StageState.READY, "stable-handle, digest and decode evidence must permit READY")
    sandbox = ParserSandbox(ParserBudget(2, 100, 100, 2, 100, 100, 100, 2))
    sandbox.consume(ParserUsage(files=1, expanded_bytes=50, pixels=10, frames=1, cpu_ms=10, ram_bytes=10, metadata_bytes=10, depth=1))
    require(sandbox.finalize() == StageState.DECODE_VERIFIED, "bounded parser input must finalize only after consumption")
    expect_error(BudgetExceeded, lambda: sandbox.consume(ParserUsage(files=2)))
    quarantined = ParserSandbox(ParserBudget(1, 1, 1, 1, 1, 1, 1, 1))
    expect_error(BudgetExceeded, lambda: quarantined.consume(ParserUsage(), network_requested=True))
    expect_error(BudgetExceeded, lambda: quarantined.consume(ParserUsage()))
    expect_error(PolicyBlocked, lambda: CASAliasGuard().assert_safe(mode=AliasMode.HARDLINK, writable=True, copy_on_write_verified=False))
    expect_error(PolicyBlocked, lambda: CASAliasGuard().assert_safe(mode=AliasMode.REFLINK, writable=False, copy_on_write_verified=False))


def test_ct18_url_and_path_policy() -> None:
    guard = make_url_guard()
    blocked = guard.evaluate(
        original_url="https://public.example/input",
        redirect_urls=("https://127.0.0.1/admin",),
        initial_addresses=("93.184.216.34",),
        connect_addresses=("93.184.216.34",),
        bytes_received=10,
        duration_ms=1,
        content_type="application/octet-stream",
    )
    require(blocked.state.value == "POLICY_BLOCKED", "private redirect must be blocked")
    direct_private = guard.evaluate(
        original_url="https://127.0.0.1/admin",
        redirect_urls=(),
        initial_addresses=("93.184.216.34",),
        connect_addresses=("93.184.216.34",),
        bytes_received=10,
        duration_ms=1,
        content_type="application/octet-stream",
    )
    require(direct_private.state.value == "POLICY_BLOCKED", "private original literal must be blocked")
    dns_rebinding = guard.evaluate(
        original_url="https://public.example/input",
        redirect_urls=("https://cdn.example/final",),
        redirect_addresses=(("10.0.0.8",),),
        initial_addresses=("93.184.216.34",),
        connect_addresses=("93.184.216.34",),
        bytes_received=10,
        duration_ms=1,
        content_type="application/octet-stream",
    )
    require(dns_rebinding.state.value == "POLICY_BLOCKED", "DNS rebinding at redirect must be blocked")
    expect_error(PolicyBlocked, lambda: guard.evaluate(
        original_url="https://public.example/input",
        redirect_urls=(),
        initial_addresses=("93.184.216.34",),
        connect_addresses=("169.254.169.254",),
        bytes_received=10,
        duration_ms=1,
        content_type="application/octet-stream",
    ))
    expect_error(PolicyBlocked, lambda: guard.evaluate(
        original_url="https://user:password@public.example/input",
        redirect_urls=(),
        initial_addresses=("93.184.216.34",),
        connect_addresses=("93.184.216.34",),
        bytes_received=10,
        duration_ms=1,
        content_type="application/octet-stream",
    ))
    expect_error(PolicyBlocked, lambda: __import__("l5_security_contract").safe_windows_relative_path("C:\\CineForge\\library", "\\\\server\\share\\file"))


def test_ct19_webview_ipc_fence() -> None:
    token = CapabilityToken("token-19", 4, "windows-user", "local-core", "asset-r1", "READ", "PREVIEW", "nonce-19", 100, 200, True)
    guard = IPCGuard()
    guard.authorize(token, current_session_epoch=4, os_user="windows-user", audience="local-core", asset_revision="asset-r1", operation="READ", purpose="PREVIEW", now_ms=150)
    expect_error(CapabilityDenied, lambda: guard.authorize(token, current_session_epoch=4, os_user="windows-user", audience="local-core", asset_revision="asset-r1", operation="READ", purpose="PREVIEW", now_ms=150))
    expect_error(CapabilityDenied, lambda: WebViewBridgeGuard("http://127.0.0.1:4312").allow_navigation("https://evil.example"))
    bridge = WebViewBridgeGuard("http://127.0.0.1:4312")
    bridge.allow_bridge("http://127.0.0.1:4312", CapabilityToken("bridge-token", 4, "windows-user", "local-core", "asset-r1", "READ", "PREVIEW", "bridge-nonce", 100, 200, True), current_session_epoch=4, os_user="windows-user", audience="local-core", asset_revision="asset-r1", operation="READ", purpose="PREVIEW", now_ms=150)
    expect_error(CapabilityDenied, lambda: bridge.allow_bridge("http://127.0.0.1:4312", CapabilityToken("bridge-token-2", 4, "windows-user", "local-core", "asset-r1", "READ", "PREVIEW", "bridge-nonce", 100, 200, True), current_session_epoch=4, os_user="windows-user", audience="local-core", asset_revision="asset-r1", operation="READ", purpose="PREVIEW", now_ms=150))
    expired = CapabilityToken("token-expired", 4, "windows-user", "local-core", "asset-r1", "READ", "PREVIEW", "nonce-expired", 100, 200, True)
    expect_error(CapabilityDenied, lambda: IPCGuard().authorize(expired, current_session_epoch=5, os_user="windows-user", audience="local-core", asset_revision="asset-r1", operation="READ", purpose="PREVIEW", now_ms=150))


def test_ct20_untrusted_context_and_typed_tools() -> None:
    external = ContextSegment("external", "screenplay", TrustClass.EXTERNAL_CONTENT, "instruction", 1, "REQUIRED", digest("external"))
    compilation = ContextCompiler().compile((external,), required_roles=("policy",))
    require(compilation.state == ContextState.BLOCKED, "missing trusted policy must block context")
    policy = ContextSegment("policy", "system", TrustClass.SYSTEM_POLICY, "policy", 1, "REQUIRED", digest("policy"))
    compilation = ContextCompiler().compile((policy, external), required_roles=("policy",))
    expect_error(CapabilityDenied, lambda: TypedToolGate().authorize(TypedToolCall("publish", digest("args"), "policy"), compilation, allowlisted_tools=("publish",)))
    expect_error(CapabilityDenied, lambda: TypedToolGate().authorize("publish", compilation, allowlisted_tools=("publish",)))


def test_ct21_callback_scope_replay() -> None:
    verifier = CallbackVerifier(replay_window_ms=100)
    callback = ProviderCallback("callback-21", "attempt-21", "connection-1", "account-a", digest("payload"), "nonce-21", 100, True)
    result = verifier.verify(callback, expected_attempt="attempt-21", expected_connection="connection-1", expected_account="account-a", now_ms=150)
    require(result.state == CallbackState.AUTHENTICATED, "fresh scoped callback must authenticate")
    replay = verifier.verify(callback, expected_attempt="attempt-21", expected_connection="connection-1", expected_account="account-a", now_ms=150)
    require(replay.state == CallbackState.REPLAYED, "callback replay must be rejected")
    conflicting = ProviderCallback("callback-21", "attempt-21", "connection-1", "account-a", digest("different-payload"), "nonce-conflict", 100, True)
    require(verifier.verify(conflicting, expected_attempt="attempt-21", expected_connection="connection-1", expected_account="account-a", now_ms=150).state == CallbackState.REJECTED, "callback identity cannot be rebound to another payload")
    forged = ProviderCallback("callback-forged", "attempt-21", "connection-1", "account-b", digest("payload"), "nonce-forged", 100, True)
    require(verifier.verify(forged, expected_attempt="attempt-21", expected_connection="connection-1", expected_account="account-a", now_ms=150).state == CallbackState.REJECTED, "cross-account callback must not be canonical")


def test_ct22_materialization_fence() -> None:
    receipt = ExternalArtifactReceipt("attempt-22", "artifact-22", "https://provider.example/a", 2_000, digest("bytes"), 10, 100, digest("receipt"))
    materializer = __import__("l5_security_contract").ExternalArtifactMaterializer()
    evidence = {"initial_addresses": ("93.184.216.34",), "connect_addresses": ("93.184.216.34",)}
    failed = materializer.materialize(receipt, now_ms=1_000, actual_digest=digest("different"), actual_size=10, final_uri=receipt.remote_uri, decode_verified=True, url_guard=make_url_guard(), **evidence)
    require(failed.state == MaterializationState.MATERIALIZATION_FAILED, "digest mismatch must not become READY")
    expired = materializer.materialize(receipt, now_ms=2_000, actual_digest=digest("bytes"), actual_size=10, final_uri=receipt.remote_uri, decode_verified=True, url_guard=make_url_guard(), **evidence)
    require(expired.state == MaterializationState.EXPIRED_EXTERNAL_ARTIFACT, "expired URL must not become READY")
    ready = materializer.materialize(receipt, now_ms=1_000, actual_digest=digest("bytes"), actual_size=10, final_uri=receipt.remote_uri, decode_verified=True, url_guard=make_url_guard(), **evidence)
    require(ready.state == MaterializationState.READY, "verified materialization may become READY")
    rebound = materializer.materialize(receipt, now_ms=1_000, actual_digest=digest("bytes"), actual_size=10, final_uri="https://cdn.example/final", decode_verified=True, url_guard=make_url_guard(), redirect_addresses=(("10.0.0.8",),), **evidence)
    require(rebound.state == MaterializationState.MATERIALIZATION_FAILED, "DNS-rebound materialization must remain non-canonical")


def test_ct23_account_scope_fence() -> None:
    pinned = make_connection()
    changed = make_connection(account="account-b")
    require(ConnectionIdentityFence().revalidate(pinned, changed) == ConnectionState.CHANGED, "account drift must block")
    manifest = EgressManifest("job-23", "command-23", "connection-1", "account-a", "region-a", "EXPORT", "policy-v1", "terms-v1", "rights-v1", digest("payload"), ("asset-23",))
    egress_args = dict(expected_privacy_policy="policy-v1", expected_terms_snapshot="terms-v1", expected_rights_snapshot="rights-v1", expected_payload_hash=digest("payload"), expected_item_ids=("asset-23",), expected_tenant="tenant-a", expected_workspace="workspace-a", expected_fingerprint=digest("connection-a"))
    expect_error(CapabilityDenied, lambda: EgressGuard().authorize(manifest, changed, **egress_args))
    expect_error(CapabilityDenied, lambda: EgressGuard().authorize(manifest, pinned, **{**egress_args, "expected_item_ids": ("asset-24",)}))
    EgressGuard().authorize(manifest, pinned, **egress_args)


def test_ct24_browser_semantic_fence() -> None:
    session = BrowserSessionIdentity("profile-a", 7, "https://provider.example", digest("session-a"))
    guard = BrowserSemanticGuard(account_identity=make_connection(), session_identity=session, site_fingerprint=digest("site-v1"), action_schema=digest("action-v1"))
    state = guard.revalidate(observed_identity=make_connection(), observed_session_identity=session, observed_site_fingerprint=digest("site-v2"), observed_action_schema=digest("action-v1"))
    require(state == BrowserState.SITE_SEMANTICS_CHANGED, "semantic change must require human review")
    require(guard.revalidate(observed_identity=make_connection(account="account-b"), observed_session_identity=session, observed_site_fingerprint=digest("site-v1"), observed_action_schema=digest("action-v1")) == BrowserState.ACCOUNT_SCOPE_CHANGED, "account drift must fence browser action")
    changed_session = BrowserSessionIdentity("profile-a", 8, "https://provider.example", digest("session-a"))
    require(guard.revalidate(observed_identity=make_connection(), observed_session_identity=changed_session, observed_site_fingerprint=digest("site-v1"), observed_action_schema=digest("action-v1")) == BrowserState.AUTH_REQUIRED, "browser session drift must require reauthentication")


def make_key(state: KeyState = KeyState.ACTIVE, *, fresh_until: int = 2_000) -> TrustKey:
    return TrustKey("key-1", digest("key-1"), state, 3_000, fresh_until)


def make_package(*, registry: str = "registry.example", package_digest: str | None = None, version: str = "1.2.3", install_script_state: InstallScriptState = InstallScriptState.NONE, vulnerability_state: VulnerabilityState = VulnerabilityState.CLEAR, policy_revision: str = "policy-v1") -> PackageEnvelope:
    return PackageEnvelope("pkg-1", "cineforge-core", version, registry, package_digest or digest("pkg"), "key-1", True, True, install_script_state, "MIT", vulnerability_state, policy_revision)


def test_ct31_key_revocation() -> None:
    verifier = SupplyChainVerifier()
    verify_args = dict(expected_registry="registry.example", expected_digest=digest("pkg"), expected_key=make_key(), now_ms=1_000, expected_license_id="MIT", expected_policy_revision="policy-v1")
    verifier.verify(make_package(), **{**verify_args, "expected_version": "1.2.3"})
    expect_error(ProvenanceRejected, lambda: verifier.verify(make_package(version="1.2.2"), **{**verify_args, "expected_version": "1.2.3"}))
    expect_error(ProvenanceRejected, lambda: verifier.verify(make_package(vulnerability_state=VulnerabilityState.REVIEW_REQUIRED), **verify_args))
    expect_error(ProvenanceRejected, lambda: verifier.verify(make_package(), **{**verify_args, "expected_key": make_key(KeyState.REVOKED)}))
    expect_error(ProvenanceRejected, lambda: verifier.verify(make_package(), **{**verify_args, "expected_key": make_key(fresh_until=500)}))


def test_ct32_artifact_provenance() -> None:
    attestation = ArtifactAttestation("artifact-32", digest("bytes"), digest("manifest"), digest("attestation"), "commit-32", digest("sbom"), "trusted-builder", True, "workflow-32", "run-32", "attempt-32", "trusted-cache")
    guard = ArtifactAttestationGuard()
    attestation_args = dict(expected_artifact_id="artifact-32", expected_manifest_digest=digest("manifest"), expected_producer="trusted-builder", expected_source_commit="commit-32", expected_sbom_digest=digest("sbom"), expected_attestation_digest=digest("attestation"), expected_workflow_id="workflow-32", expected_run_id="run-32", expected_attempt_id="attempt-32", expected_cache_source="trusted-cache")
    guard.verify(attestation, actual_artifact_digest=digest("bytes"), **attestation_args)
    expect_error(ProvenanceRejected, lambda: guard.verify(attestation, actual_artifact_digest=digest("poisoned"), **attestation_args))


def test_ct33_release_workspace() -> None:
    workspace = ReleaseWorkspace("commit-33", digest("tree"), False, True, False, True, True, True)
    expect_error(ProvenanceRejected, lambda: ReleaseWorkspaceGuard().verify(workspace, expected_commit="commit-33", expected_tree_digest=digest("tree")))


def test_ct34_signer_digest_binding() -> None:
    attestation = ArtifactAttestation("artifact-34", digest("bytes"), digest("manifest"), digest("attestation"), "commit-34", digest("sbom"), "trusted-builder", True, "workflow-34", "run-34", "attempt-34", "trusted-cache")
    expect_error(ProvenanceRejected, lambda: ArtifactAttestationGuard().verify(attestation, actual_artifact_digest=digest("other-file-with-same-name"), expected_artifact_id="artifact-34", expected_manifest_digest=digest("manifest"), expected_producer="trusted-builder", expected_source_commit="commit-34", expected_sbom_digest=digest("sbom"), expected_attestation_digest=digest("attestation"), expected_workflow_id="workflow-34", expected_run_id="run-34", expected_attempt_id="attempt-34", expected_cache_source="trusted-cache"))


def test_ct35_windows_collision() -> None:
    guard = WindowsCollisionGuard()
    guard.add("Media/Scene.MOV", "asset-a")
    expect_error(PolicyBlocked, lambda: guard.add("media/scene.mov", "asset-b"))
    expect_error(PolicyBlocked, lambda: __import__("l5_security_contract").safe_windows_relative_path("C:\\CineForge\\library", "media\\CON"))
    expect_error(PolicyBlocked, lambda: __import__("l5_security_contract").safe_windows_relative_path("C:\\CineForge\\library", "media\\CON.txt"))


def test_ct36_toolchain_identity() -> None:
    expected = ToolchainIdentity("C:\\CineForge\\toolchain\\python.exe", digest("python"), digest("environment"), digest("registry"))
    observed = ToolchainIdentity("C:\\Windows\\System32\\python.exe", digest("python"), digest("environment"), digest("registry"))
    expect_error(ProvenanceRejected, lambda: ToolchainGuard().verify(observed, expected=expected))


def test_ct37_dependency_registry() -> None:
    verifier = SupplyChainVerifier()
    package = make_package(registry="typosquat.example")
    expect_error(ProvenanceRejected, lambda: verifier.verify(package, expected_registry="registry.example", expected_digest=digest("pkg"), expected_key=make_key(), now_ms=1_000, expected_license_id="MIT", expected_policy_revision="policy-v1"))
    unreviewed = make_package(install_script_state=InstallScriptState.UNREVIEWED)
    expect_error(ProvenanceRejected, lambda: verifier.verify(unreviewed, expected_registry="registry.example", expected_digest=digest("pkg"), expected_key=make_key(), now_ms=1_000, expected_license_id="MIT", expected_policy_revision="policy-v1", expected_install_script_state=InstallScriptState.UNREVIEWED))


def test_negative_boundaries() -> None:
    expect_error(ContractViolation, lambda: ParserUsage(files=True))
    expect_error(ContractViolation, lambda: URLFetchPolicy(max_bytes=True))
    expect_error(ContractViolation, lambda: CapabilityToken("token", 1, "user", "aud", "asset", "READ", "purpose", "nonce", 10, 10, True))
    expect_error(ContractViolation, lambda: ContextSegment("seg", "p", TrustClass.EXTERNAL_CONTENT, "role", 1, "INVALID", digest("x")))
    expect_error(ContractViolation, lambda: ExternalArtifactReceipt("attempt", "artifact", "https://provider.example/a", 100, digest("bytes"), 1, True, digest("receipt")))
    expect_error(ContractViolation, lambda: PackageEnvelope("pkg", "name", "1.-1", "registry", digest("pkg"), "key", True, True, InstallScriptState.NONE, "MIT", VulnerabilityState.CLEAR, "policy-v1"))


def main() -> int:
    tests: list[tuple[str, Callable[[], None]]] = [
        ("CT-17", test_ct17_hostile_staging_and_parser),
        ("CT-18", test_ct18_url_and_path_policy),
        ("CT-19", test_ct19_webview_ipc_fence),
        ("CT-20", test_ct20_untrusted_context_and_typed_tools),
        ("CT-21", test_ct21_callback_scope_replay),
        ("CT-22", test_ct22_materialization_fence),
        ("CT-23", test_ct23_account_scope_fence),
        ("CT-24", test_ct24_browser_semantic_fence),
        ("CT-31", test_ct31_key_revocation),
        ("CT-32", test_ct32_artifact_provenance),
        ("CT-33", test_ct33_release_workspace),
        ("CT-34", test_ct34_signer_digest_binding),
        ("CT-35", test_ct35_windows_collision),
        ("CT-36", test_ct36_toolchain_identity),
        ("CT-37", test_ct37_dependency_registry),
        ("NEGATIVE", test_negative_boundaries),
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
    print(f"L5_SECURITY_SELFTEST=PASS cases={passed}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
