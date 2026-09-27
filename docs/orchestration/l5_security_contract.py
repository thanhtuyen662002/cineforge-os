#!/usr/bin/env python3
"""Fail-closed reference contracts for the CineForge L5 safety boundary.

This is a deterministic standard-library harness, not the CineForge product runtime.  It
does not parse an actual archive, open a socket, verify a stable OS file handle,
create a WebView, authenticate a real provider signature, invoke a native
bridge, or sign/release a package.
It makes the safety decisions and rejection boundaries executable until an
independent implementation and verifier exist.

The model covers the L5 contract families:

* immutable staged ingest, Windows path containment and CAS alias safety;
* URL/private-network/redirect policy and parser resource budgets;
* authenticated, user/session-scoped IPC and origin isolation;
* trusted-context labels and typed tool calls;
* provider callback authentication, replay and account binding;
* expiring external-artifact materialization before READY;
* browser account and site-semantic fences; and
* signing-key, artifact-attestation, clean-workspace, managed-toolchain and
  dependency-registry provenance gates.

All counters use a bounded signed 64-bit domain, ``bool`` is rejected where an
integer is expected, hashes use explicit ``sha256:`` values, and failures are
represented as blocked/quarantined states rather than partial success.
"""

from __future__ import annotations

import hashlib
import ipaddress
import re
import sys
import unicodedata
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Iterable, Mapping, Sequence
from urllib.parse import SplitResult, urlsplit

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
except ModuleNotFoundError as exc:  # package-style imports from the repository root
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


VERSION_RE = re.compile(r"^(0|[1-9][0-9]*)(?:\.(0|[1-9][0-9]*)){0,3}$")
PRIVATE_HOSTNAMES = frozenset(
    {
        "localhost",
        "localhost.localdomain",
        "metadata",
        "metadata.google.internal",
        "instance-data",
        "ip6-localhost",
    }
)


class PolicyBlocked(ContractViolation):
    """A path, URL, identity or release-policy decision is denied."""


class BudgetExceeded(ContractViolation):
    """A parser or network budget would be exceeded."""


class CapabilityDenied(ContractViolation):
    """An IPC, context or browser capability is not authorized."""


class MaterializationRejected(ContractViolation):
    """An external provider artifact cannot become canonical READY data."""


class ProvenanceRejected(ContractViolation):
    """Package, artifact, workspace or toolchain provenance is unsafe."""


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
    """Return a deterministic digest for fixture labels, never a secret."""
    return "sha256:" + hashlib.sha256(label.encode("utf-8")).hexdigest()


def _normalize_version(name: str, value: object) -> tuple[int, int, int, int]:
    value = _text(name, value, maximum=31)
    if not VERSION_RE.fullmatch(value):
        raise ContractViolation(f"{name} must be a dotted non-negative integer version")
    parts = tuple(int(part) for part in value.split("."))
    if any(part > MAX_SAFE_INTEGER for part in parts):
        raise ContractViolation(f"{name} has a version component beyond the 64-bit safety bound")
    return (*parts, *(0 for _ in range(4 - len(parts))))


class StageState(str, Enum):
    RECEIVED = "RECEIVED"
    STAGING = "STAGING"
    HASHED = "HASHED"
    DECODE_VERIFIED = "DECODE_VERIFIED"
    READY = "READY"
    QUARANTINED = "QUARANTINED"
    REJECTED = "REJECTED"


class AliasMode(str, Enum):
    HARDLINK = "HARDLINK"
    REFLINK = "REFLINK"
    COPY = "COPY"


class FetchState(str, Enum):
    POLICY_BLOCKED = "POLICY_BLOCKED"
    COMPLETE = "COMPLETE"


class TrustClass(str, Enum):
    SYSTEM_POLICY = "SYSTEM_POLICY"
    AUTHORIZED_TASK = "AUTHORIZED_TASK"
    CANONICAL_PROJECT = "CANONICAL_PROJECT"
    USER_CONTENT = "USER_CONTENT"
    EXTERNAL_CONTENT = "EXTERNAL_CONTENT"
    MODEL_OUTPUT = "MODEL_OUTPUT"
    METADATA = "METADATA"


class ContextState(str, Enum):
    READY = "READY"
    UNTRUSTED_CONTENT = "UNTRUSTED_CONTENT"
    NEEDS_REVIEW = "NEEDS_REVIEW"
    BLOCKED = "BLOCKED"


class CallbackState(str, Enum):
    AUTHENTICATED = "AUTHENTICATED"
    REJECTED = "REJECTED"
    REPLAYED = "REPLAYED"
    STALE_CALLBACK = "STALE_CALLBACK"


class MaterializationState(str, Enum):
    REMOTE_AVAILABLE = "REMOTE_AVAILABLE"
    MATERIALIZED = "MATERIALIZED"
    HASHED = "HASHED"
    DECODE_VERIFIED = "DECODE_VERIFIED"
    READY = "READY"
    MATERIALIZATION_FAILED = "MATERIALIZATION_FAILED"
    EXPIRED_EXTERNAL_ARTIFACT = "EXPIRED_EXTERNAL_ARTIFACT"


class ConnectionState(str, Enum):
    UNKNOWN = "UNKNOWN"
    VERIFIED = "VERIFIED"
    CHANGED = "CHANGED"
    MISMATCH = "MISMATCH"
    REVERIFY_REQUIRED = "REVERIFY_REQUIRED"


class BrowserState(str, Enum):
    VERIFIED = "VERIFIED"
    ACCOUNT_SCOPE_CHANGED = "ACCOUNT_SCOPE_CHANGED"
    AUTH_REQUIRED = "AUTH_REQUIRED"
    SITE_SEMANTICS_CHANGED = "SITE_SEMANTICS_CHANGED"
    NEEDS_HUMAN = "NEEDS_HUMAN"


class KeyState(str, Enum):
    ACTIVE = "ACTIVE"
    ROTATING = "ROTATING"
    REVOKED = "REVOKED"
    EXPIRED = "EXPIRED"


class InstallScriptState(str, Enum):
    NONE = "NONE"
    REVIEWED = "REVIEWED"
    UNREVIEWED = "UNREVIEWED"


class VulnerabilityState(str, Enum):
    CLEAR = "CLEAR"
    REVIEW_REQUIRED = "REVIEW_REQUIRED"
    BLOCKED = "BLOCKED"


def _path_segment(segment: str) -> str:
    normalized = unicodedata.normalize("NFC", segment)
    folded = normalized.casefold()
    reserved = {"con", "prn", "aux", "nul"} | {f"com{i}" for i in range(1, 10)} | {f"lpt{i}" for i in range(1, 10)}
    if not normalized or normalized in {".", ".."} or ":" in normalized:
        raise PolicyBlocked("path contains an absolute/parent/device segment")
    trimmed = normalized.rstrip(" .")
    if trimmed.split(".", 1)[0].casefold() in reserved or normalized.endswith((".", " ")):
        raise PolicyBlocked("path contains a Windows reserved or ambiguous name")
    if any(ord(char) < 0x20 for char in normalized):
        raise PolicyBlocked("path contains a control character")
    return folded


def safe_windows_relative_path(root: str, candidate: str) -> str:
    """Canonicalize a managed local path and reject UNC/device/path escape."""
    root = _text("root", root, maximum=260)
    candidate = _text("candidate", candidate, maximum=512)
    if candidate.startswith(("\\\\", "//", "\\.\\", "\\?\\", "/")):
        raise PolicyBlocked("UNC, device and absolute paths are not allowed")
    if re.match(r"^[A-Za-z]:", candidate):
        raise PolicyBlocked("drive-qualified paths are not allowed as relative paths")
    if "\x00" in candidate:
        raise PolicyBlocked("path contains NUL")
    parts = re.split(r"[\\/]+", candidate)
    if any(part in {"", ".", ".."} for part in parts):
        raise PolicyBlocked("path contains an empty/current/parent segment")
    canonical_parts = [_path_segment(part) for part in parts]
    root_norm = root.replace("/", "\\").rstrip("\\")
    if root_norm.startswith(("\\\\", "\\.\\", "\\?\\")):
        raise PolicyBlocked("managed root cannot be UNC or device storage")
    if not re.fullmatch(r"[A-Za-z]:\\.*", root_norm):
        raise PolicyBlocked("managed root must be an absolute local drive path")
    return root_norm + "\\" + "\\".join(canonical_parts)


class WindowsCollisionGuard:
    """Detect case-fold, Unicode-normalization and reserved-name collisions."""

    def __init__(self) -> None:
        self._identities: dict[str, str] = {}

    def add(self, path: str, identity: str) -> None:
        path = _text("path", path, maximum=512)
        identity = _identifier("identity", identity)
        if path.startswith(("/", "\\\\", "\\.\\", "\\?\\")) or re.match(r"^[A-Za-z]:", path):
            raise PolicyBlocked("collision scan received an absolute, UNC or device path")
        if any(part in {"", ".", ".."} for part in re.split(r"[\\/]+", path)):
            raise PolicyBlocked("collision scan received an ambiguous relative path")
        canonical = "\\".join(_path_segment(part) for part in re.split(r"[\\/]+", path))
        previous = self._identities.get(canonical)
        if previous is not None and previous != identity:
            raise PolicyBlocked("Windows case-fold/Unicode path collision")
        self._identities[canonical] = identity


@dataclass(frozen=True)
class StagedArtifactReceipt:
    artifact_id: str
    source_path: str
    staging_path: str
    expected_digest: str
    actual_digest: str
    state: StageState
    reason: str
    decode_verified: bool = False
    reparse_point: bool = False
    stable_handle_verified: bool = False

    def __post_init__(self) -> None:
        _identifier("artifact_id", self.artifact_id)
        _text("source_path", self.source_path, maximum=512)
        _text("staging_path", self.staging_path, maximum=512)
        _sha256("expected_digest", self.expected_digest)
        _sha256("actual_digest", self.actual_digest)
        _enum("state", self.state, StageState)
        _text("reason", self.reason, maximum=512)
        _bool("decode_verified", self.decode_verified)
        _bool("reparse_point", self.reparse_point)
        _bool("stable_handle_verified", self.stable_handle_verified)
        if self.state == StageState.READY and (
            self.expected_digest != self.actual_digest
            or not self.decode_verified
            or self.reparse_point
            or not self.stable_handle_verified
        ):
            raise ContractViolation("READY staged receipt lacks complete immutable-byte evidence")


class StagedArtifactPipeline:
    """Bind parsing to an immutable private staged copy and verified digest."""

    def __init__(self, *, managed_root: str, temp_root: str) -> None:
        self.managed_root = _text("managed_root", managed_root, maximum=260)
        self.temp_root = _text("temp_root", temp_root, maximum=260)
        self._receipts: dict[str, StagedArtifactReceipt] = {}

    def ingest(
        self,
        *,
        artifact_id: str,
        source_path: str,
        staging_path: str,
        expected_digest: str,
        actual_digest: str,
        decode_verified: bool,
        reparse_point: bool = False,
        stable_handle_verified: bool = False,
    ) -> StagedArtifactReceipt:
        artifact_id = _identifier("artifact_id", artifact_id)
        source = safe_windows_relative_path(self.managed_root, source_path)
        staging = safe_windows_relative_path(self.temp_root, staging_path)
        expected_digest = _sha256("expected_digest", expected_digest)
        actual_digest = _sha256("actual_digest", actual_digest)
        decode_verified = _bool("decode_verified", decode_verified)
        reparse_point = _bool("reparse_point", reparse_point)
        stable_handle_verified = _bool("stable_handle_verified", stable_handle_verified)
        prior = self._receipts.get(artifact_id)
        if prior is not None:
            if (prior.source_path, prior.staging_path, prior.expected_digest, prior.actual_digest, prior.decode_verified, prior.reparse_point, prior.stable_handle_verified) != (source, staging, expected_digest, actual_digest, decode_verified, reparse_point, stable_handle_verified):
                raise ContractViolation("artifact retry conflicts with its original staged identity")
            return prior
        if reparse_point:
            state, reason = StageState.QUARANTINED, "reparse point/path identity is not trusted"
        elif expected_digest != actual_digest:
            state, reason = StageState.QUARANTINED, "staged byte digest mismatch"
        elif not stable_handle_verified:
            state, reason = StageState.QUARANTINED, "source stable-handle evidence did not pass"
        elif not decode_verified:
            state, reason = StageState.QUARANTINED, "decode verification did not pass"
        else:
            state, reason = StageState.READY, "private staged bytes hashed and decode verified"
        receipt = StagedArtifactReceipt(artifact_id, source, staging, expected_digest, actual_digest, state, reason, decode_verified, reparse_point, stable_handle_verified)
        self._receipts[artifact_id] = receipt
        return receipt


class CASAliasGuard:
    def assert_safe(self, *, mode: AliasMode, writable: bool, copy_on_write_verified: bool) -> None:
        _enum("mode", mode, AliasMode)
        writable = _bool("writable", writable)
        copy_on_write_verified = _bool("copy_on_write_verified", copy_on_write_verified)
        if mode == AliasMode.HARDLINK and writable:
            raise PolicyBlocked("writable hardlink cannot alias canonical content")
        if mode == AliasMode.REFLINK and not copy_on_write_verified:
            raise PolicyBlocked("unverified reflink cannot alias canonical content")


@dataclass(frozen=True)
class URLFetchPolicy:
    allowed_schemes: tuple[str, ...] = ("https",)
    max_redirects: int = 3
    max_bytes: int = 50_000_000
    max_duration_ms: int = 120_000
    allowed_content_types: tuple[str, ...] = ("application/octet-stream", "application/json", "text/plain")
    deny_private_network: bool = True

    def __post_init__(self) -> None:
        if not self.allowed_schemes or any(not isinstance(item, str) or not item for item in self.allowed_schemes):
            raise ContractViolation("URL policy needs non-empty schemes")
        object.__setattr__(self, "allowed_schemes", tuple(item.lower() for item in self.allowed_schemes))
        _positive_int("max_redirects", self.max_redirects)
        _positive_int("max_bytes", self.max_bytes)
        _positive_int("max_duration_ms", self.max_duration_ms)
        _bool("deny_private_network", self.deny_private_network)


@dataclass(frozen=True)
class URLDecision:
    state: FetchState
    reason: str
    original_url: str
    final_url: str
    addresses: tuple[str, ...]


def _split_url(name: str, value: str) -> SplitResult:
    value = _text(name, value, maximum=2_048)
    if value.startswith(("\\\\", "//")):
        raise PolicyBlocked("UNC/network paths are not URL inputs")
    parsed = urlsplit(value)
    if parsed.scheme.lower() not in {"http", "https"} or not parsed.hostname:
        raise PolicyBlocked("URL scheme/host is not allowed")
    if parsed.username is not None or parsed.password is not None:
        raise PolicyBlocked("URL credentials are forbidden")
    return parsed


def _public_address(address: str) -> None:
    try:
        value = ipaddress.ip_address(address)
    except ValueError as exc:
        raise PolicyBlocked("resolution returned an invalid address") from exc
    if not value.is_global:
        raise PolicyBlocked("private, loopback, link-local, reserved or metadata address is forbidden")


def _private_host(host: str) -> bool:
    normalized = host.rstrip(".").casefold()
    if normalized in PRIVATE_HOSTNAMES:
        return True
    try:
        return not ipaddress.ip_address(host).is_global
    except ValueError:
        return False


class URLPolicyGuard:
    def __init__(self, policy: URLFetchPolicy) -> None:
        self.policy = policy

    def evaluate(
        self,
        *,
        original_url: str,
        redirect_urls: Sequence[str],
        redirect_addresses: Sequence[Sequence[str]] = (),
        initial_addresses: Sequence[str],
        connect_addresses: Sequence[str],
        bytes_received: int,
        duration_ms: int,
        content_type: str,
    ) -> URLDecision:
        parsed = _split_url("original_url", original_url)
        if parsed.scheme.lower() not in self.policy.allowed_schemes:
            return URLDecision(FetchState.POLICY_BLOCKED, "scheme is not allowlisted", original_url, original_url, tuple(initial_addresses))
        if len(redirect_urls) > self.policy.max_redirects:
            return URLDecision(FetchState.POLICY_BLOCKED, "redirect budget exceeded", original_url, original_url, tuple(initial_addresses))
        if redirect_urls and len(redirect_addresses) != len(redirect_urls):
            return URLDecision(FetchState.POLICY_BLOCKED, "redirect connect-time resolution evidence is missing", original_url, original_url, tuple(initial_addresses))
        _nonnegative_int("bytes_received", bytes_received)
        _nonnegative_int("duration_ms", duration_ms)
        if bytes_received > self.policy.max_bytes or duration_ms > self.policy.max_duration_ms:
            return URLDecision(FetchState.POLICY_BLOCKED, "network budget exceeded", original_url, original_url, tuple(initial_addresses))
        if content_type not in self.policy.allowed_content_types:
            return URLDecision(FetchState.POLICY_BLOCKED, "content type is not allowlisted", original_url, original_url, tuple(initial_addresses))
        if self.policy.deny_private_network:
            if _private_host(parsed.hostname or ""):
                return URLDecision(FetchState.POLICY_BLOCKED, "original host is private or metadata", original_url, original_url, tuple(initial_addresses))
            if not initial_addresses:
                return URLDecision(FetchState.POLICY_BLOCKED, "initial resolution evidence is missing", original_url, original_url, tuple())
            for address in tuple(initial_addresses) + tuple(connect_addresses):
                _public_address(_text("resolved_address", address, maximum=64))
        final_url = original_url
        for index, redirect in enumerate(redirect_urls):
            redirected = _split_url("redirect_url", redirect)
            if redirected.scheme.lower() not in self.policy.allowed_schemes:
                return URLDecision(FetchState.POLICY_BLOCKED, "redirect scheme is not allowlisted", original_url, redirect, tuple(connect_addresses))
            host = redirected.hostname or ""
            if _private_host(host):
                return URLDecision(FetchState.POLICY_BLOCKED, "redirect host is private or metadata", original_url, redirect, tuple(connect_addresses))
            if not redirect_addresses[index]:
                return URLDecision(FetchState.POLICY_BLOCKED, "redirect resolution evidence is missing", original_url, redirect, tuple(connect_addresses))
            for address in redirect_addresses[index]:
                try:
                    _public_address(_text("redirect_resolved_address", address, maximum=64))
                except PolicyBlocked:
                    return URLDecision(FetchState.POLICY_BLOCKED, "redirect connect-time address is private or reserved", original_url, redirect, tuple(connect_addresses))
            final_url = redirect
        if not connect_addresses:
            return URLDecision(FetchState.POLICY_BLOCKED, "connect-time resolution evidence is missing", original_url, final_url, tuple())
        return URLDecision(FetchState.COMPLETE, "URL, redirects, resolution and budgets verified", original_url, final_url, tuple(connect_addresses))


@dataclass(frozen=True)
class ParserBudget:
    max_files: int
    max_expanded_bytes: int
    max_pixels: int
    max_frames: int
    max_cpu_ms: int
    max_ram_bytes: int
    max_metadata_bytes: int
    max_depth: int
    network_allowed: bool = False

    def __post_init__(self) -> None:
        for name in ("max_files", "max_expanded_bytes", "max_pixels", "max_frames", "max_cpu_ms", "max_ram_bytes", "max_metadata_bytes", "max_depth"):
            _positive_int(name, getattr(self, name))
        _bool("network_allowed", self.network_allowed)


@dataclass(frozen=True)
class ParserUsage:
    files: int = 0
    expanded_bytes: int = 0
    pixels: int = 0
    frames: int = 0
    cpu_ms: int = 0
    ram_bytes: int = 0
    metadata_bytes: int = 0
    depth: int = 0

    def __post_init__(self) -> None:
        for name in ("files", "expanded_bytes", "pixels", "frames", "cpu_ms", "ram_bytes", "metadata_bytes", "depth"):
            _nonnegative_int(name, getattr(self, name))


class ParserSandbox:
    def __init__(self, budget: ParserBudget) -> None:
        self.budget = budget
        self.state = StageState.STAGING
        self.usage = ParserUsage()

    def finalize(self) -> StageState:
        if self.state in {StageState.QUARANTINED, StageState.REJECTED}:
            raise BudgetExceeded("quarantined parser cannot finalize")
        if self.usage.files == 0:
            self.state = StageState.QUARANTINED
            raise BudgetExceeded("parser cannot finalize an empty input")
        self.state = StageState.DECODE_VERIFIED
        return self.state

    def consume(self, usage: ParserUsage, *, network_requested: bool = False) -> None:
        if self.state != StageState.STAGING:
            raise BudgetExceeded("quarantined parser cannot consume more input")
        if not isinstance(usage, ParserUsage):
            raise ContractViolation("usage must be ParserUsage")
        network_requested = _bool("network_requested", network_requested)
        if network_requested and not self.budget.network_allowed:
            self.state = StageState.QUARANTINED
            raise BudgetExceeded("parser network access is denied by default")
        total = ParserUsage(
            self.usage.files + usage.files,
            self.usage.expanded_bytes + usage.expanded_bytes,
            self.usage.pixels + usage.pixels,
            self.usage.frames + usage.frames,
            self.usage.cpu_ms + usage.cpu_ms,
            self.usage.ram_bytes + usage.ram_bytes,
            self.usage.metadata_bytes + usage.metadata_bytes,
            max(self.usage.depth, usage.depth),
        )
        limits = {
            "files": self.budget.max_files,
            "expanded_bytes": self.budget.max_expanded_bytes,
            "pixels": self.budget.max_pixels,
            "frames": self.budget.max_frames,
            "cpu_ms": self.budget.max_cpu_ms,
            "ram_bytes": self.budget.max_ram_bytes,
            "metadata_bytes": self.budget.max_metadata_bytes,
            "depth": self.budget.max_depth,
        }
        for name, limit in limits.items():
            if getattr(total, name) > limit:
                self.state = StageState.QUARANTINED
                raise BudgetExceeded(f"parser {name} budget exceeded")
        self.usage = total


@dataclass(frozen=True)
class CapabilityToken:
    token_id: str
    session_epoch: int
    os_user: str
    audience: str
    asset_revision: str
    operation: str
    purpose: str
    nonce: str
    issued_at_ms: int
    expires_at_ms: int
    signature_verified: bool

    def __post_init__(self) -> None:
        _identifier("token_id", self.token_id)
        _positive_int("session_epoch", self.session_epoch)
        for name in ("os_user", "audience", "asset_revision", "operation", "purpose", "nonce"):
            _identifier(name, getattr(self, name))
        _nonnegative_int("issued_at_ms", self.issued_at_ms)
        _positive_int("expires_at_ms", self.expires_at_ms)
        if self.expires_at_ms <= self.issued_at_ms:
            raise ContractViolation("capability token expiry must be after issue time")
        _bool("signature_verified", self.signature_verified)


class IPCGuard:
    def __init__(self) -> None:
        self._used_nonces: set[str] = set()

    def authorize(
        self,
        token: CapabilityToken,
        *,
        current_session_epoch: int,
        os_user: str,
        audience: str,
        asset_revision: str,
        operation: str,
        purpose: str,
        now_ms: int,
    ) -> None:
        if not isinstance(token, CapabilityToken):
            raise CapabilityDenied("typed capability token is required")
        _positive_int("current_session_epoch", current_session_epoch)
        _identifier("os_user", os_user)
        _identifier("audience", audience)
        _identifier("asset_revision", asset_revision)
        _identifier("operation", operation)
        _identifier("purpose", purpose)
        _nonnegative_int("now_ms", now_ms)
        if not token.signature_verified:
            raise CapabilityDenied("capability signature is not verified")
        if token.nonce in self._used_nonces:
            raise CapabilityDenied("capability nonce replay")
        if now_ms < token.issued_at_ms or now_ms >= token.expires_at_ms:
            raise CapabilityDenied("capability token is outside its validity window")
        if (token.session_epoch, token.os_user, token.audience, token.asset_revision, token.operation, token.purpose) != (current_session_epoch, os_user, audience, asset_revision, operation, purpose):
            raise CapabilityDenied("capability scope does not match the current IPC request")
        self._used_nonces.add(token.nonce)


class WebViewBridgeGuard:
    def __init__(self, local_origin: str) -> None:
        self.local_origin = _text("local_origin", local_origin, maximum=256)
        self._ipc_guard = IPCGuard()

    def allow_navigation(self, origin: str) -> None:
        origin = _text("origin", origin, maximum=256)
        if origin != self.local_origin:
            raise CapabilityDenied("remote origin is not allowed to use the local WebView surface")

    def allow_bridge(self, origin: str, token: CapabilityToken, **request: object) -> None:
        self.allow_navigation(origin)
        self._ipc_guard.authorize(token, **request)


@dataclass(frozen=True)
class ContextSegment:
    segment_id: str
    provenance: str
    trust_class: TrustClass
    semantic_role: str
    authority_level: int
    constraint_class: str
    content_hash: str

    def __post_init__(self) -> None:
        _identifier("segment_id", self.segment_id)
        _identifier("provenance", self.provenance)
        _enum("trust_class", self.trust_class, TrustClass)
        _identifier("semantic_role", self.semantic_role)
        _nonnegative_int("authority_level", self.authority_level)
        if self.constraint_class not in {"REQUIRED", "COMPRESSIBLE"}:
            raise ContractViolation("constraint_class is invalid")
        _sha256("content_hash", self.content_hash)


@dataclass(frozen=True)
class ContextCompilation:
    state: ContextState
    actionable_segment_ids: tuple[str, ...]
    reason: str


class ContextCompiler:
    _ACTIONABLE = {TrustClass.SYSTEM_POLICY, TrustClass.AUTHORIZED_TASK, TrustClass.CANONICAL_PROJECT}

    def compile(self, segments: Sequence[ContextSegment], *, required_roles: Sequence[str] = ()) -> ContextCompilation:
        if any(not isinstance(segment, ContextSegment) for segment in segments):
            raise ContractViolation("context segments must be typed")
        ids = [segment.segment_id for segment in segments]
        if len(ids) != len(set(ids)):
            raise ContextCompilation(ContextState.BLOCKED, tuple(), "duplicate context segment identity")
        required = {_identifier("required_role", role) for role in required_roles}
        trusted_roles = {
            segment.semantic_role
            for segment in segments
            if segment.trust_class in self._ACTIONABLE and segment.authority_level > 0
        }
        missing = required - trusted_roles
        if missing:
            return ContextCompilation(ContextState.BLOCKED, tuple(), "mandatory trusted context is missing")
        actionable = tuple(segment.segment_id for segment in segments if segment.trust_class in self._ACTIONABLE and segment.authority_level > 0)
        if not actionable:
            return ContextCompilation(ContextState.UNTRUSTED_CONTENT, tuple(), "only untrusted content is present")
        if any(segment.trust_class in {TrustClass.USER_CONTENT, TrustClass.EXTERNAL_CONTENT, TrustClass.MODEL_OUTPUT} for segment in segments):
            return ContextCompilation(ContextState.NEEDS_REVIEW, actionable, "untrusted content is data and cannot become authority")
        return ContextCompilation(ContextState.READY, actionable, "trusted policy/task context compiled")


@dataclass(frozen=True)
class TypedToolCall:
    tool_name: str
    argument_hash: str
    source_segment_id: str

    def __post_init__(self) -> None:
        _identifier("tool_name", self.tool_name)
        _sha256("argument_hash", self.argument_hash)
        _identifier("source_segment_id", self.source_segment_id)


class TypedToolGate:
    def authorize(self, call: object, compilation: ContextCompilation, *, allowlisted_tools: Iterable[str], reviewed: bool = False) -> None:
        if not isinstance(call, TypedToolCall):
            raise CapabilityDenied("plain text or JSON-looking model output is not an actionable tool call")
        reviewed = _bool("reviewed", reviewed)
        if compilation.state == ContextState.NEEDS_REVIEW and not reviewed:
            raise CapabilityDenied("untrusted context requires explicit review before tool execution")
        if compilation.state not in {ContextState.READY, ContextState.NEEDS_REVIEW}:
            raise CapabilityDenied("context is blocked or contains no trusted authority")
        if call.tool_name not in {_identifier("tool_name", item) for item in allowlisted_tools}:
            raise CapabilityDenied("tool is not allowlisted")
        if call.source_segment_id not in compilation.actionable_segment_ids:
            raise CapabilityDenied("tool call source is not an actionable trusted segment")


@dataclass(frozen=True)
class ProviderCallback:
    callback_id: str
    attempt_id: str
    connection_id: str
    account: str
    payload_digest: str
    nonce: str
    timestamp_ms: int
    signature_verified: bool

    def __post_init__(self) -> None:
        for name in ("callback_id", "attempt_id", "connection_id", "account", "nonce"):
            _identifier(name, getattr(self, name))
        _sha256("payload_digest", self.payload_digest)
        _nonnegative_int("timestamp_ms", self.timestamp_ms)
        _bool("signature_verified", self.signature_verified)


@dataclass(frozen=True)
class CallbackResult:
    state: CallbackState
    reason: str


class CallbackVerifier:
    def __init__(self, *, replay_window_ms: int = 300_000) -> None:
        self.replay_window_ms = _positive_int("replay_window_ms", replay_window_ms)
        self._nonces: set[str] = set()
        self._callbacks: dict[str, str] = {}

    def verify(self, callback: ProviderCallback, *, expected_attempt: str, expected_connection: str, expected_account: str, now_ms: int) -> CallbackResult:
        if not isinstance(callback, ProviderCallback):
            raise ContractViolation("callback must be typed")
        expected_attempt = _identifier("expected_attempt", expected_attempt)
        expected_connection = _identifier("expected_connection", expected_connection)
        expected_account = _identifier("expected_account", expected_account)
        _nonnegative_int("now_ms", now_ms)
        if callback.nonce in self._nonces:
            return CallbackResult(CallbackState.REPLAYED, "callback nonce was already observed")
        prior_payload = self._callbacks.get(callback.callback_id)
        if prior_payload is not None:
            if prior_payload != callback.payload_digest:
                return CallbackResult(CallbackState.REJECTED, "callback identity was reused with different payload")
            return CallbackResult(CallbackState.REPLAYED, "callback identity was already observed")
        if not callback.signature_verified:
            return CallbackResult(CallbackState.REJECTED, "callback signature is not verified")
        if now_ms < callback.timestamp_ms or now_ms - callback.timestamp_ms > self.replay_window_ms:
            return CallbackResult(CallbackState.STALE_CALLBACK, "callback timestamp is outside replay window")
        if (callback.attempt_id, callback.connection_id, callback.account) != (expected_attempt, expected_connection, expected_account):
            return CallbackResult(CallbackState.REJECTED, "callback account/connection/attempt binding mismatches")
        self._nonces.add(callback.nonce)
        self._callbacks[callback.callback_id] = callback.payload_digest
        return CallbackResult(CallbackState.AUTHENTICATED, "callback is fresh, scoped and signature verified")


@dataclass(frozen=True)
class ExternalArtifactReceipt:
    job_attempt_id: str
    provider_artifact_id: str
    remote_uri: str
    remote_expiry_ms: int
    expected_digest: str
    expected_size: int
    association_confidence: int
    raw_receipt_hash: str
    state: MaterializationState = MaterializationState.REMOTE_AVAILABLE
    materialized_uri: str | None = None

    def __post_init__(self) -> None:
        for name in ("job_attempt_id", "provider_artifact_id"):
            _identifier(name, getattr(self, name))
        _text("remote_uri", self.remote_uri, maximum=2_048)
        _positive_int("remote_expiry_ms", self.remote_expiry_ms)
        _sha256("expected_digest", self.expected_digest)
        _positive_int("expected_size", self.expected_size)
        _nonnegative_int("association_confidence", self.association_confidence)
        if self.association_confidence > 100:
            raise ContractViolation("association_confidence must be 0..100")
        _sha256("raw_receipt_hash", self.raw_receipt_hash)
        _enum("state", self.state, MaterializationState)
        if self.state == MaterializationState.READY and not self.materialized_uri:
            raise ContractViolation("READY materialization requires a canonical URI")
        if self.materialized_uri is not None:
            _text("materialized_uri", self.materialized_uri, maximum=2_048)


class ExternalArtifactMaterializer:
    def materialize(
        self,
        receipt: ExternalArtifactReceipt,
        *,
        now_ms: int,
        actual_digest: str,
        actual_size: int,
        final_uri: str,
        decode_verified: bool,
        url_guard: URLPolicyGuard,
        initial_addresses: Sequence[str],
        connect_addresses: Sequence[str],
        redirect_addresses: Sequence[Sequence[str]] = (),
    ) -> ExternalArtifactReceipt:
        if not isinstance(receipt, ExternalArtifactReceipt):
            raise ContractViolation("receipt must be typed")
        _nonnegative_int("now_ms", now_ms)
        actual_digest = _sha256("actual_digest", actual_digest)
        actual_size = _positive_int("actual_size", actual_size)
        final_uri = _text("final_uri", final_uri, maximum=2_048)
        decode_verified = _bool("decode_verified", decode_verified)
        if receipt.state == MaterializationState.READY:
            canonical_uri = receipt.materialized_uri or receipt.remote_uri
            if actual_digest == receipt.expected_digest and actual_size == receipt.expected_size and final_uri == canonical_uri and decode_verified:
                return receipt
            raise MaterializationRejected("READY materialization cannot be rewritten by conflicting evidence")
        if now_ms >= receipt.remote_expiry_ms:
            return ExternalArtifactReceipt(**{**receipt.__dict__, "state": MaterializationState.EXPIRED_EXTERNAL_ARTIFACT})
        decision = url_guard.evaluate(
            original_url=receipt.remote_uri,
            redirect_urls=(final_uri,) if final_uri != receipt.remote_uri else (),
            redirect_addresses=redirect_addresses,
            initial_addresses=initial_addresses,
            connect_addresses=connect_addresses,
            bytes_received=actual_size,
            duration_ms=1,
            content_type="application/octet-stream",
        )
        if decision.state != FetchState.COMPLETE or actual_digest != receipt.expected_digest or actual_size != receipt.expected_size or receipt.association_confidence < 100 or not decode_verified:
            return ExternalArtifactReceipt(**{**receipt.__dict__, "state": MaterializationState.MATERIALIZATION_FAILED})
        return ExternalArtifactReceipt(**{**receipt.__dict__, "state": MaterializationState.READY, "materialized_uri": final_uri})


@dataclass(frozen=True)
class ConnectionIdentity:
    connection_id: str
    account: str
    tenant: str
    workspace: str
    region: str
    fingerprint: str
    state: ConnectionState = ConnectionState.VERIFIED

    def __post_init__(self) -> None:
        for name in ("connection_id", "account", "tenant", "workspace", "region"):
            _identifier(name, getattr(self, name))
        _sha256("fingerprint", self.fingerprint)
        _enum("state", self.state, ConnectionState)


class ConnectionIdentityFence:
    def revalidate(self, pinned: ConnectionIdentity, observed: ConnectionIdentity) -> ConnectionState:
        if not isinstance(pinned, ConnectionIdentity) or not isinstance(observed, ConnectionIdentity):
            raise ContractViolation("connection identities must be typed")
        same = (pinned.connection_id, pinned.account, pinned.tenant, pinned.workspace, pinned.region, pinned.fingerprint) == (observed.connection_id, observed.account, observed.tenant, observed.workspace, observed.region, observed.fingerprint)
        return ConnectionState.VERIFIED if same and observed.state == ConnectionState.VERIFIED else ConnectionState.CHANGED


@dataclass(frozen=True)
class EgressManifest:
    job_id: str
    command_id: str
    connection_id: str
    provider_account: str
    region: str
    purpose: str
    privacy_policy_revision: str
    terms_snapshot: str
    rights_snapshot: str
    payload_hash: str
    item_ids: tuple[str, ...]

    def __post_init__(self) -> None:
        for name in ("job_id", "command_id", "connection_id", "provider_account", "region", "purpose", "privacy_policy_revision", "terms_snapshot", "rights_snapshot"):
            _identifier(name, getattr(self, name))
        _sha256("payload_hash", self.payload_hash)
        if not self.item_ids or len(self.item_ids) != len(set(self.item_ids)):
            raise ContractViolation("egress manifest needs unique item IDs")
        for item_id in self.item_ids:
            _identifier("item_id", item_id)


class EgressGuard:
    def authorize(
        self,
        manifest: EgressManifest,
        observed: ConnectionIdentity,
        *,
        expected_privacy_policy: str,
        expected_terms_snapshot: str,
        expected_rights_snapshot: str,
        expected_payload_hash: str,
        expected_item_ids: Sequence[str],
        expected_tenant: str,
        expected_workspace: str,
        expected_fingerprint: str,
    ) -> None:
        if not isinstance(manifest, EgressManifest) or not isinstance(observed, ConnectionIdentity):
            raise CapabilityDenied("typed egress manifest and connection identity are required")
        if observed.state != ConnectionState.VERIFIED:
            raise CapabilityDenied("egress connection identity requires current VERIFIED state")
        if manifest.connection_id != observed.connection_id or manifest.provider_account != observed.account or manifest.region != observed.region:
            raise CapabilityDenied("egress connection/account/region drift")
        if observed.tenant != _identifier("expected_tenant", expected_tenant) or observed.workspace != _identifier("expected_workspace", expected_workspace) or observed.fingerprint != _sha256("expected_fingerprint", expected_fingerprint):
            raise CapabilityDenied("egress tenant/workspace/fingerprint drift")
        if manifest.privacy_policy_revision != _identifier("expected_privacy_policy", expected_privacy_policy):
            raise CapabilityDenied("egress privacy policy drift")
        if manifest.terms_snapshot != _identifier("expected_terms_snapshot", expected_terms_snapshot):
            raise CapabilityDenied("egress terms snapshot drift")
        if manifest.rights_snapshot != _identifier("expected_rights_snapshot", expected_rights_snapshot):
            raise CapabilityDenied("egress rights snapshot drift")
        if manifest.payload_hash != _sha256("expected_payload_hash", expected_payload_hash):
            raise CapabilityDenied("egress payload plan drift")
        if not isinstance(expected_item_ids, Sequence) or isinstance(expected_item_ids, (str, bytes)):
            raise CapabilityDenied("egress item scope must be a typed sequence")
        expected_items = tuple(_identifier("expected_item_id", item_id) for item_id in expected_item_ids)
        if not expected_items or len(expected_items) != len(set(expected_items)) or manifest.item_ids != expected_items:
            raise CapabilityDenied("egress item scope drift")


@dataclass(frozen=True)
class BrowserSessionIdentity:
    profile_id: str
    session_epoch: int
    page_origin: str
    session_fingerprint: str

    def __post_init__(self) -> None:
        _identifier("profile_id", self.profile_id)
        _positive_int("session_epoch", self.session_epoch)
        _text("page_origin", self.page_origin, maximum=256)
        _sha256("session_fingerprint", self.session_fingerprint)


class BrowserSemanticGuard:
    def __init__(self, *, account_identity: ConnectionIdentity, session_identity: BrowserSessionIdentity, site_fingerprint: str, action_schema: str) -> None:
        self.account_identity = account_identity
        self.session_identity = session_identity
        self.site_fingerprint = _sha256("site_fingerprint", site_fingerprint)
        self.action_schema = _sha256("action_schema", action_schema)

    def revalidate(self, *, observed_identity: ConnectionIdentity, observed_session_identity: BrowserSessionIdentity, observed_site_fingerprint: str, observed_action_schema: str) -> BrowserState:
        if ConnectionIdentityFence().revalidate(self.account_identity, observed_identity) != ConnectionState.VERIFIED:
            return BrowserState.ACCOUNT_SCOPE_CHANGED
        if observed_session_identity != self.session_identity:
            return BrowserState.AUTH_REQUIRED
        if _sha256("observed_site_fingerprint", observed_site_fingerprint) != self.site_fingerprint or _sha256("observed_action_schema", observed_action_schema) != self.action_schema:
            return BrowserState.SITE_SEMANTICS_CHANGED
        return BrowserState.VERIFIED


@dataclass(frozen=True)
class TrustKey:
    key_id: str
    fingerprint: str
    state: KeyState
    valid_until_ms: int
    revocation_fresh_until_ms: int

    def __post_init__(self) -> None:
        _identifier("key_id", self.key_id)
        _sha256("fingerprint", self.fingerprint)
        _enum("state", self.state, KeyState)
        _positive_int("valid_until_ms", self.valid_until_ms)
        _positive_int("revocation_fresh_until_ms", self.revocation_fresh_until_ms)


@dataclass(frozen=True)
class PackageEnvelope:
    package_id: str
    name: str
    version: str
    registry: str
    package_digest: str
    key_id: str
    signature_verified: bool
    provenance_verified: bool
    install_script_state: InstallScriptState
    license_id: str
    vulnerability_state: VulnerabilityState
    approved_policy_revision: str

    def __post_init__(self) -> None:
        for name in ("package_id", "name", "registry", "key_id"):
            _identifier(name, getattr(self, name))
        _normalize_version("version", self.version)
        _identifier("license_id", self.license_id)
        _sha256("package_digest", self.package_digest)
        _bool("signature_verified", self.signature_verified)
        _bool("provenance_verified", self.provenance_verified)
        _enum("install_script_state", self.install_script_state, InstallScriptState)
        _enum("vulnerability_state", self.vulnerability_state, VulnerabilityState)
        _identifier("approved_policy_revision", self.approved_policy_revision)


class SupplyChainVerifier:
    def verify(
        self,
        package: PackageEnvelope,
        *,
        expected_registry: str,
        expected_digest: str,
        expected_key: TrustKey,
        now_ms: int,
        expected_license_id: str,
        expected_policy_revision: str,
        expected_install_script_state: InstallScriptState = InstallScriptState.NONE,
        expected_version: str | None = None,
        minimum_version: str | None = None,
    ) -> None:
        if not isinstance(package, PackageEnvelope) or not isinstance(expected_key, TrustKey):
            raise ProvenanceRejected("typed package and trust key are required")
        expected_registry = _identifier("expected_registry", expected_registry)
        expected_digest = _sha256("expected_digest", expected_digest)
        _nonnegative_int("now_ms", now_ms)
        expected_license_id = _identifier("expected_license_id", expected_license_id)
        expected_policy_revision = _identifier("expected_policy_revision", expected_policy_revision)
        _enum("expected_install_script_state", expected_install_script_state, InstallScriptState)
        if expected_version is not None and minimum_version is not None:
            raise ProvenanceRejected("exact and minimum package versions cannot both be requested")
        package_version = _normalize_version("package.version", package.version)
        if expected_version is not None and package_version != _normalize_version("expected_version", expected_version):
            raise ProvenanceRejected("package version lock mismatch")
        if minimum_version is not None and package_version < _normalize_version("minimum_version", minimum_version):
            raise ProvenanceRejected("package version is below the allowed floor")
        if package.registry != expected_registry or package.package_digest != expected_digest:
            raise ProvenanceRejected("package registry/integrity lock mismatch")
        if package.license_id != expected_license_id or package.approved_policy_revision != expected_policy_revision:
            raise ProvenanceRejected("package license or approved policy revision mismatch")
        if package.vulnerability_state != VulnerabilityState.CLEAR:
            raise ProvenanceRejected("package vulnerability state is not clear")
        if package.key_id != expected_key.key_id or expected_key.state != KeyState.ACTIVE or now_ms >= expected_key.valid_until_ms:
            raise ProvenanceRejected("package signing key is unknown, revoked or expired")
        if now_ms >= expected_key.revocation_fresh_until_ms:
            raise ProvenanceRejected("revocation data is stale")
        if not package.signature_verified or not package.provenance_verified:
            raise ProvenanceRejected("package signature/provenance evidence is missing")
        if package.install_script_state != expected_install_script_state or package.install_script_state == InstallScriptState.UNREVIEWED:
            raise ProvenanceRejected("install-script policy is not satisfied")


@dataclass(frozen=True)
class ArtifactAttestation:
    artifact_id: str
    artifact_digest: str
    manifest_digest: str
    attestation_digest: str
    source_commit: str
    sbom_digest: str
    producer: str
    signed: bool
    workflow_id: str
    run_id: str
    attempt_id: str
    cache_source: str

    def __post_init__(self) -> None:
        _identifier("artifact_id", self.artifact_id)
        for name in ("artifact_digest", "manifest_digest", "attestation_digest", "sbom_digest"):
            _sha256(name, getattr(self, name))
        _identifier("source_commit", self.source_commit)
        _identifier("producer", self.producer)
        _bool("signed", self.signed)
        for name in ("workflow_id", "run_id", "attempt_id", "cache_source"):
            _identifier(name, getattr(self, name))


class ArtifactAttestationGuard:
    def verify(
        self,
        attestation: ArtifactAttestation,
        *,
        actual_artifact_digest: str,
        expected_artifact_id: str,
        expected_manifest_digest: str,
        expected_producer: str,
        expected_source_commit: str,
        expected_sbom_digest: str,
        expected_attestation_digest: str,
        expected_workflow_id: str,
        expected_run_id: str,
        expected_attempt_id: str,
        expected_cache_source: str,
    ) -> None:
        if not isinstance(attestation, ArtifactAttestation):
            raise ProvenanceRejected("typed artifact attestation is required")
        if attestation.artifact_id != _identifier("expected_artifact_id", expected_artifact_id):
            raise ProvenanceRejected("artifact identity does not match the attestation scope")
        if not attestation.signed or attestation.artifact_digest != _sha256("actual_artifact_digest", actual_artifact_digest):
            raise ProvenanceRejected("artifact bytes/signature do not match attestation")
        if (
            attestation.manifest_digest != _sha256("expected_manifest_digest", expected_manifest_digest)
            or attestation.producer != _identifier("expected_producer", expected_producer)
            or attestation.source_commit != _identifier("expected_source_commit", expected_source_commit)
            or attestation.sbom_digest != _sha256("expected_sbom_digest", expected_sbom_digest)
            or attestation.attestation_digest != _sha256("expected_attestation_digest", expected_attestation_digest)
        ):
            raise ProvenanceRejected("artifact manifest/producer provenance mismatch")
        expected_scope = (
            _identifier("expected_workflow_id", expected_workflow_id),
            _identifier("expected_run_id", expected_run_id),
            _identifier("expected_attempt_id", expected_attempt_id),
            _identifier("expected_cache_source", expected_cache_source),
        )
        observed_scope = (attestation.workflow_id, attestation.run_id, attestation.attempt_id, attestation.cache_source)
        if observed_scope != expected_scope:
            raise ProvenanceRejected("artifact workflow/run/attempt/cache provenance mismatch")


@dataclass(frozen=True)
class ReleaseWorkspace:
    source_commit: str
    tree_digest: str
    clean: bool
    generated_clean: bool
    no_untracked: bool
    submodules_verified: bool
    lfs_verified: bool
    collision_free: bool

    def __post_init__(self) -> None:
        _identifier("source_commit", self.source_commit)
        _sha256("tree_digest", self.tree_digest)
        for name in ("clean", "generated_clean", "no_untracked", "submodules_verified", "lfs_verified", "collision_free"):
            _bool(name, getattr(self, name))


class ReleaseWorkspaceGuard:
    def verify(self, workspace: ReleaseWorkspace, *, expected_commit: str, expected_tree_digest: str) -> None:
        if not isinstance(workspace, ReleaseWorkspace):
            raise ProvenanceRejected("typed release workspace is required")
        if workspace.source_commit != _identifier("expected_commit", expected_commit) or workspace.tree_digest != _sha256("expected_tree_digest", expected_tree_digest):
            raise ProvenanceRejected("release source closure is stale")
        if not all((workspace.clean, workspace.generated_clean, workspace.no_untracked, workspace.submodules_verified, workspace.lfs_verified, workspace.collision_free)):
            raise ProvenanceRejected("release workspace is dirty, incomplete or colliding")


@dataclass(frozen=True)
class ToolchainIdentity:
    executable_path: str
    executable_digest: str
    environment_digest: str
    registry_revision: str

    def __post_init__(self) -> None:
        _text("executable_path", self.executable_path, maximum=512)
        if not re.fullmatch(r"[A-Za-z]:\\.+", self.executable_path) or self.executable_path.startswith(("\\\\", "\\.\\", "\\?\\")):
            raise ProvenanceRejected("toolchain executable must be an absolute managed local path")
        for name in ("executable_digest", "environment_digest", "registry_revision"):
            _sha256(name, getattr(self, name))


class ToolchainGuard:
    def verify(self, observed: ToolchainIdentity, *, expected: ToolchainIdentity) -> None:
        if not isinstance(observed, ToolchainIdentity) or not isinstance(expected, ToolchainIdentity):
            raise ProvenanceRejected("typed toolchain identity is required")
        if observed != expected:
            raise ProvenanceRejected("managed executable/path/hash/environment identity changed")


__all__ = [
    "AliasMode",
    "ArtifactAttestation",
    "ArtifactAttestationGuard",
    "BrowserSemanticGuard",
    "BrowserSessionIdentity",
    "BrowserState",
    "BudgetExceeded",
    "CallbackResult",
    "CallbackState",
    "CallbackVerifier",
    "CapabilityDenied",
    "CapabilityToken",
    "CASAliasGuard",
    "ConnectionIdentity",
    "ConnectionIdentityFence",
    "ConnectionState",
    "ContextCompilation",
    "ContextCompiler",
    "ContextSegment",
    "ContextState",
    "EgressGuard",
    "EgressManifest",
    "ExternalArtifactMaterializer",
    "ExternalArtifactReceipt",
    "FetchState",
    "InstallScriptState",
    "IPCGuard",
    "KeyState",
    "MaterializationRejected",
    "MaterializationState",
    "PackageEnvelope",
    "ParserBudget",
    "ParserSandbox",
    "ParserUsage",
    "PolicyBlocked",
    "ProvenanceRejected",
    "ProviderCallback",
    "ReleaseWorkspace",
    "ReleaseWorkspaceGuard",
    "safe_windows_relative_path",
    "StageState",
    "StagedArtifactPipeline",
    "StagedArtifactReceipt",
    "SupplyChainVerifier",
    "ToolchainGuard",
    "ToolchainIdentity",
    "TrustClass",
    "TrustKey",
    "TypedToolCall",
    "TypedToolGate",
    "URLDecision",
    "URLFetchPolicy",
    "URLPolicyGuard",
    "VulnerabilityState",
    "WindowsCollisionGuard",
    "WebViewBridgeGuard",
    "digest",
]
