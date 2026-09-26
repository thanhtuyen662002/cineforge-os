# CineForge OS — Extreme Hardening Implementation Contracts

> Status: proposed authoritative detailed extension under Issue #1 / Draft PR #2.
> Parent architecture: `docs/architecture/FINAL_ARCHITECTURE.md#39-extreme-adversarial-hardening-controls`
> Findings: `docs/orchestration/EXTREME_FAILURE_STRESS_TEST_2026-09-26.md`

This document is the **single implementation-contract owner** for controls discovered by the extreme adversarial pass. Base SCHEMA/API/STATE/UI documents remain the stable product baseline and reference this extension.

# A. Control-plane contracts

## A1. Atomic task claim
Branch lock key:
`agent/i<issue>-a<attempt>`

No free-form slug.

After branch creation, create exactly one minimal marker:
`.cineforge/claims/i<issue>-a<attempt>.json`

Fields:
- issue
- attempt
- agent_instance_id
- run_id
- slot_id
- claim_base_sha
- task_contract_version
- task_contract_hash
- context_base_sha

The marker exists only because GitHub rejects zero-diff PR creation and must be removed before READY_FOR_REVIEW.

## A2. Canonical task hash
- parse versioned task schema;
- reject duplicate keys;
- normalize set-valued arrays according to schema;
- canonical UTF-8 JSON, lexicographically sorted object keys;
- hash as `sha256:<lowercase hex>`.

## A3. Fenced takeover
Confirmed handoff may reuse branch.

Stale/unconfirmed takeover:
- create replacement branch from adopted exact HEAD:
  `agent/i<issue>-a<attempt>-owner<epoch>`;
- open replacement Draft PR;
- supersede old PR;
- old writer cannot contaminate replacement branch.

## A4. Trusted control policy
Canonical trust root:
`docs/orchestration/TRUSTED_CONTROL_POLICY.md`

Capacity Plan can bind roles/slots but cannot expand GitHub trust actors or lower assurance.

## A5. CI verification tuple
Required fields:
- HEAD_SHA
- BASE_SHA / MERGE_BASE_SHA
- SYNTHETIC_MERGE_SHA when applicable
- check/workflow ID
- CHECK_PRODUCER_APP/IDENTITY
- WORKFLOW_PATH
- WORKFLOW_REVISION
- RUNNER_TRUST_CLASS
- ATTEMPT
- RESULT

Governance workflow changes require base/external verification that the PR cannot rewrite for its own approval.

# B. Persistence/recovery schema contracts

## B1. Recovery epoch

### recovery_epochs
- id PK
- epoch_no UNIQUE
- reason
- source_backup_id nullable
- state: ACTIVE | RECONCILING | BLOCKED | SUPERSEDED
- started_at_utc_us
- activated_at_utc_us nullable
- reconciliation_manifest_hash nullable

External attempts/sessions/inbox/outbox/publication operations carry recovery_epoch_id.

### recovery_external_reconciliations
- id PK
- recovery_epoch_id FK
- external_kind
- external_identity
- restored_local_state
- observed_external_state
- decision: ADOPT | IGNORE | COMPENSATE | NEEDS_HUMAN | UNKNOWN
- evidence_json
- resolved_at_utc_us nullable

State:
RESTORE_REQUESTED → RESTORING → RECOVERY_RECONCILIATION → READY_TO_ACTIVATE → ACTIVE

No new external dispatch while reconciling.

## B2. Core single-writer fencing

### core_instances
- id PK
- instance_epoch UNIQUE
- process_identity
- os_user_identity
- started_at_utc_us
- last_heartbeat_at_utc_us
- state
- fencing_token UNIQUE

### core_instance_ownership
Singleton:
- active_core_instance_id
- active_epoch
- fencing_token
- row_version
- acquired_at_utc_us

Every canonical mutation/outbox dispatch validates fencing token.

State:
STARTING → ACTIVE_OWNER → DRAINING → STOPPED
or stale owner → STALE_FENCED.

## B3. SQLite health

### database_health_samples
- sampled_at_utc_us
- wal_bytes
- oldest_read_tx_age_ms
- last_checkpoint_at_utc_us
- checkpoint_state
- writer_queue_depth
- write_latency_ms
- free_bytes_on_db_volume
- pressure_state

Pressure:
NORMAL → WARNING → CRITICAL → READ_ONLY_SAFE → RECOVERING.

### database_integrity_checks
- check_type: QUICK_CHECK | INTEGRITY_CHECK | TARGETED
- trigger
- state
- finding_count
- result_manifest_hash

Corruption enters safe recovery, never automatic row deletion.

## B4. Migration execution

### migration_runs
Phases:
PLANNED → SCHEMA → BACKFILL → PROJECTIONS → INTEGRITY_CHECK → HEALTH_CHECK → COMPLETE

Fields include checkpoint_backup_id, storage_reservation_id, last_completed_step.

### migration_step_runs
Each step has idempotency key and resumable state.

App update declares min/max compatible schema and rollback mode.

# C. Storage/import/media contracts

## C1. Algorithm-qualified digest
Canonical storage identity:
- hash_algorithm
- content_hash
UNIQUE(hash_algorithm, content_hash)

V1 algorithm: sha256.

## C2. Stable source ingest
Critical ingest:
- stable OS handle/private staging copy;
- reject reparse/path escape;
- hash staged bytes;
- parse staged immutable bytes.

EXTERNAL_PATH canonical binding stores cryptographic fingerprint, not just size/mtime.

## C3. CAS alias safety
No writable hardlink from canonical object to editable handoff/staging.
Reflink allowed only with verified copy-on-write semantics.
Otherwise copy.

## C4. URL/network intake

### url_fetch_policies
- allowed schemes
- private-network deny
- max redirects/bytes/duration
- content-type policy

### url_fetch_receipts
- original/final URL
- resolved addresses
- redirect chain
- policy revision
- content hash
- blocked reason

State:
PROPOSED → RESOLVING → POLICY_CHECK → FETCHING → STAGING → VERIFIED → COMPLETE

Block:
localhost/private/link-local/cloud metadata by default; revalidate redirects and connect-time resolution.

## C5. Parser budgets
Archive/media/document parsers enforce:
- recursion/file-count limit;
- archive expansion limit;
- decoded pixel/frame/sample limits;
- CPU/RAM/time quota;
- metadata size limit;
- network/protocol deny by default;
- sandbox temp root.

Generated provider media passes same pipeline.

## C6. Provider result materialization

### external_artifact_receipts
- job_attempt_id
- provider_artifact_id
- remote_uri
- remote expiry
- association confidence
- materialization state
- local_storage_object_id
- raw_receipt_hash

State:
REMOTE_AVAILABLE → DOWNLOADING → MATERIALIZED → HASHED → DECODE_VERIFIED → REGISTERED → READY.

Remote success is not durable READY.

## C7. Rebuildability
Derived recipe dependency types:
- asset revision
- package/model
- connector/provider capability
- rights/license snapshot

States:
EXACT_REBUILDABLE
BEST_EFFORT_REBUILDABLE
BLOCKED_DEPENDENCY
BLOCKED_RIGHTS
BLOCKED_LICENSE
PROVIDER_UNAVAILABLE
NOT_REBUILDABLE

GC/package removal re-evaluates at execution time.

# D. Security/privacy/egress contracts

## D1. WebView/native bridge
Required:
- strict CSP;
- sanitized Markdown/HTML;
- remote resources blocked/mediated;
- navigation allowlist;
- remote origin has no native bridge;
- scoped local media tokens;
- typed authenticated IPC with OS-user scoped ACL.

## D2. Context trust model

### context_segments
Fields:
- provenance
- trust_class
- semantic_role
- authority_level
- constraint_class: REQUIRED | COMPRESSIBLE
- privacy_class
- rights_class
- content_hash
- inclusion state

Trust classes include:
SYSTEM_POLICY, AUTHORIZED_TASK, CANONICAL_PROJECT, USER_CONTENT, EXTERNAL_CONTENT, MODEL_OUTPUT, METADATA.

Only trusted policy/control classes may instruct tools/workflow.

### context_required_constraints
Validation:
PRESENT | REPRESENTED_STRUCTURED | MISSING | CONFLICT.

Dispatch blocks missing/conflicting mandatory constraints.

## D3. Typed tool calls
Plain text/JSON-looking model output never calls a tool.
Only orchestrator typed tool channel is actionable and every invocation re-runs authority/policy checks.

## D4. Egress manifests

### egress_manifests
- job/command/connection
- provider account/region
- purpose
- privacy policy revision
- terms snapshot
- rights snapshot
- payload hash
- authorization state

### egress_manifest_items
Exact asset revisions/segments/context/text/metadata + privacy class.

State:
PLANNED → AUTHORIZING → ALLOWED
or BLOCKED / NEEDS_DECISION.

Central gate is outside adapters.

## D5. Runtime network policy
Local model/plugin/tool network = DENY by default.
Explicit capability manifest declares allowed destinations/protocols.

## D6. Local user isolation

### local_security_profiles
Track ACL state for:
- DB
- media root
- runtime root
- browser profiles
- IPC endpoint

Default deployment is OS-user scoped.

# E. External identity/authenticity contracts

## E1. Callback authentication
Extend external inbox:
- auth_state
- auth_method
- signer/provider identity
- replay window
- signed payload hash

Pipeline:
RECEIVED_UNTRUSTED → AUTHENTICATING → AUTHENTICATED → REGISTERED_INBOX → PROCESSED.

Auth failure/replay never drives canonical provider state.

## E2. Connection account/workspace identity
Connections can pin:
- provider account
- tenant
- workspace
- region

State:
UNKNOWN | VERIFIED | CHANGED | MISMATCH | REVERIFY_REQUIRED.

Auth token validity alone is insufficient.

## E3. Credential bindings

### credential_bindings
- connection_id
- binding_version
- secure_secret_ref
- provider account/tenant
- state

JobAttempt pins binding version/account identity.
Retry after identity change is newly planned.

After restore/machine move:
REAUTH_REQUIRED / MISSING_SECURE_MATERIAL; no silent provider fallback.

# F. Cost/resource/fanout contracts

## F1. Cost exposure
Budgets add:
- max unreconciled money/credits
- unknown-cost policy
- batch exposure ceiling

Reservations add:
- maximum exposure
- acceptance state
- unreconciled exposure

Unknown acceptance blocks dangerous retry until reconciled.

## F2. Resource reservations

### resource_reservations
- job_attempt
- resource type/id
- amount
- safety headroom
- fencing token
- state
- expiry

State:
RESERVED → ACTIVE → RELEASED
with RENEWING / EXPIRED / REVOKED.

Telemetry alone does not authorize dispatch.

## F3. Dispatch batches

### dispatch_batches
- upstream revision
- planned/dispatched/completed/cancelled count
- exposure budget
- dispatch_mode: SAMPLE_FIRST | STAGED | FULL
- state

State:
PLANNED → SAMPLING → PAUSED_FOR_SAMPLE_DECISION → DISPATCHING → COMPLETE
with pause/cancel/invalidate branches.

# G. Human authority/bulk contracts

## G1. Manual control lock

### manual_control_locks
- scope
- field/domain
- owner actor
- base revision
- reason
- state

Late AI output against an older revision is CANDIDATE_ONLY unless explicit promotion occurs.

## G2. Bulk snapshot

### bulk_operation_snapshots
- command
- query descriptor
- member count
- member manifest hash
- timestamps

### bulk_operation_members
Exact entity/revision IDs.

Execution never reruns a live filter to discover new members.
If exact member revision changed, STALE_SCOPE/replan.

# H. Supply-chain/integrity contracts

## H1. Source dependencies/SBOM

### source_dependencies
- ecosystem/name/version
- source registry
- integrity/provenance
- license
- dependency type
- install-script state
- vulnerability state
- approved policy revision

### dependency_change_records
ADD/UPGRADE/DOWNGRADE/REMOVE/SOURCE_CHANGE + evidence/review.

### sbom_snapshots
Bind source commit to manifest hash/storage object.

New executable/native/install-script dependency gets elevated review.

## H2. Critical invariant registry

### invariant_tests
- invariant code
- test path/symbol
- risk class
- governance_required
- active
- last verified commit

Unexpected deletion/weakening fails governance.

## H3. Canonical/event integrity auditor

### integrity_audit_runs
### integrity_findings

Check:
- aggregate/event monotonicity;
- command→event/outbox relation;
- revision registry consistency;
- storage references;
- impossible transitions.

Critical ambiguity can force safe mode.

## H4. Worker restart budget
Workers track restart window/count/budget/next restart/quarantine reason.

Repeated failure → BACKOFF → QUARANTINED, not endless restart.

# I. Signing/update/package contracts

## I1. Signing trust keys

### signing_trust_keys
- key ID
- purpose
- fingerprint
- parent key
- ACTIVE/ROTATING/REVOKED/EXPIRED
- validity/revocation data

Valid signature from revoked/unknown key does not pass.

## I2. Package retention

### package_retention_references
Reference type:
ACTIVE_JOB, ACTIVE_SESSION, RECOVERY_ATTEMPT, PROVENANCE_ARCHIVE.

Executable bytes cannot be removed while required.
Descriptor/license/signature/capability evidence remains archived.

# J. Release/publication contracts

## J1. Publication destination

### publication_destinations
Pin:
- connection
- provider account
- tenant/workspace
- destination type/external ID
- display name
- identity fingerprint
- verification state

Publication stores destination snapshot hash and rejects mismatch.

## J2. Release stream manifest

### release_stream_manifests / release_stream_entries
Enumerate every stream/attachment/metadata role.
Unexpected streams remain explicit findings and can block release.

## J3. Release artifact provenance
Release/signing builds from merged/release commit or proves reproducible identical digest.
Manifest binds source commit, artifact digest, toolchain/package lock and signing event.

# K. Backup resilience

Backups record:
- durability class: LOCAL_WRITABLE | SEPARATE_VOLUME | OFFLINE | IMMUTABLE_REMOTE
- physical failure domain
- recovery epoch at capture
- restore drill result
- credential portability state

SQLite backup uses online backup/validated consistent snapshot semantics.

Copy success != independent recoverability.

# L. Task graph integrity

Hard Task dependencies are a DAG.

Planner/reconciler:
- validates candidate hard edges;
- reports cycle path;
- READY requires VALID_DAG;
- incomplete graph read = UNKNOWN, not READY.

# M. Required implementation tests

At minimum:
1. two Core instances/zombie writer fencing;
2. restore + late callback + old outbox;
3. WAL checkpoint starvation + disk pressure;
4. zero-diff GitHub claim bootstrap;
5. stale worker takeover branch fencing;
6. fake public Issue/review/control comment;
7. CI check spoof / workflow self-approval;
8. URL SSRF redirect/DNS-rebind;
9. archive/gigapixel/playlist parser bomb;
10. writable hardlink CAS mutation attempt;
11. callback forgery/replay;
12. typed tool boundary / prompt injection;
13. context truncation missing mandatory privacy constraint;
14. GPU/resource overcommit;
15. delayed provider billing/exposure cap;
16. external source TOCTOU;
17. invariant-test deletion;
18. dependency typosquat/license/postinstall gate;
19. migration crash/resume + binary rollback compatibility;
20. release hidden-stream and destination mismatch.



# N. Additional recovered implementation contracts

## N1. Execution-time revalidation
Before each high-impact/irreversible item/phase, revalidate:
- rights/consent;
- current actor/agent authority;
- recovery epoch;
- manual/revision fence;
- runtime/package identity;
- resource reservation;
- budget/unreconciled exposure;
- connection account/workspace identity.

Failure pauses before the unsafe phase and preserves already completed evidence.

## N2. Protection leases
Protection lease key:
- protected_type
- immutable protected_id
- owner operation
- fencing token
- expiry

GC/package uninstall/removal cannot finalize while a valid protection lease exists.

## N3. Projection/event scale
Projection checkpoints record:
- projection version;
- event range/checkpoint;
- snapshot format version;
- integrity link to archived event range.

Rebuild begins from nearest compatible verified checkpoint.

## N4. Hermetic CI/release
Security-critical jobs use:
- clean checkout/worktree/container/VM;
- no inherited untracked files;
- pinned dependency/toolchain hashes;
- trusted cache provenance or clean rebuild;
- artifact attestation.

## N5. Encryption and key lifecycle
At-rest protection states:
- OS_VOLUME_PROTECTED
- CINEFORGE_MANAGED_ENCRYPTION
- EXTERNAL_ENCRYPTED_TARGET
- UNENCRYPTED_ALLOWED_BY_POLICY

Managed encrypted object metadata separates:
- plaintext logical digest;
- ciphertext digest;
- algorithm/version;
- wrapped data-key reference;
- key-scope identity.

Key lifecycle:
ACTIVE | ROTATING | REVOKED | EXPIRED | RECOVERY_REQUIRED.

## N6. Purpose-specific use policy
Permission is keyed by:
- subject/data scope;
- purpose;
- project/studio scope;
- policy revision.

Purposes include PRODUCTION, QC, SEARCH, CROSS_PROJECT_RETRIEVAL, FAILURE_ANALYSIS, LEARNING, TRAINING, EXTERNAL_PROCESSING, EXPORT_SHARE, PUBLIC_RELEASE.

## N7. Honest deletion / derived-data purge
Deletion workflow tracks:
- tombstone;
- derived-data invalidation;
- searchable-index fencing;
- policy purge;
- provider deletion request status;
- crypto-erasure status where applicable;
- physical erase guarantee: VERIFIED | NOT_PROVABLE | NOT_APPLICABLE.

Derived copies inherit deletion/privacy taint.

## N8. Diagnostic artifact policy
Diagnostic bundle metadata includes:
- sensitivity;
- redaction policy;
- allowed recipient/use;
- encryption/ACL;
- expiry;
- raw-media flag.

Redaction covers secrets, usernames, absolute paths, private URLs/query strings and browser credential/form data.

## N9. Resource admission deadlock prevention
Multi-resource admission is either:
- atomic across all required resources; or
- deterministic globally ordered acquisition.

Partial reservation has bounded wait and release-on-failure.
HUMAN_WAIT releases resources not physically needed.

## N10. Context dependency fence
Compile session stores a dependency manifest over:
- canonical revisions;
- policy/privacy/rights revisions;
- task contract;
- provider/adapter semantic profile;
- translated/derived prompt representation.

Before dispatch/retry, dependency manifest and payload hash are revalidated.

## N11. Provider/adapter semantic certification
Capability profile stores:
- observed request/context limits;
- reference limits;
- parameter handling;
- server rewrite/truncation observations;
- output association/materialization behavior;
- mapping state: NATIVE | APPROXIMATED | UNSUPPORTED | UNKNOWN.

Critical constraint + UNSUPPORTED/UNKNOWN blocks routing unless explicit policy allows approximation.

## N12. Browser observation privacy
Observation record captures:
- source page/profile/project;
- observation type;
- crop/scope;
- redaction state;
- whether bytes left local machine;
- retention expiry.

Login/MFA/password pages use stricter defaults.

## N13. Package/model acquisition
Installation plan includes:
- exact digest;
- publisher/signature/trust;
- expected download bytes;
- maximum install/decompression bytes;
- disk reservation;
- target root.

Version/name without digest never identifies executable bytes.



# O. Authorization-scoped cache, tokens and idempotency

## O1. Derived cache/index authorization scope
Derived artifacts/index entries include an authorization scope key:
- project/studio scope;
- privacy policy revision/class;
- rights scope when visibility/legality depends on it;
- source revision/content identity;
- derivation recipe/version.

Global content equality never grants cross-project access.

A privacy/revocation change can fence/delete derived cache/index visibility independently of immutable source identity.

## O2. Idempotency records

### idempotency_records
- namespace
- idempotency_key
- canonical_request_hash
- command_id/result_ref
- actor/studio/project scope
- created_at
- expires_at nullable

UNIQUE(namespace, idempotency_key)

Same key + same request hash => replay prior result.
Same key + different request hash => IDEMPOTENCY_CONFLICT.

## O3. Local media/RPC capability tokens
Token claims:
- session_epoch;
- OS user/session identity;
- audience/process;
- exact asset revision/representation;
- operation/purpose;
- nonce;
- issued_at/expires_at.

Tokens are never logged in full.
Sensitive reads reauthorize current policy at use time.

## O4. Read-path authorization fence
Search/vector/cache/query result is a candidate read.
Before returning confidential payload/snippet:
- resolve canonical identity;
- verify current actor/project scope;
- verify current privacy/rights/revocation;
- verify index/cache generation is not fenced.

# P. Error, telemetry and temporary-data privacy

## P1. Structured error boundary
Normal error record stores:
- stable error code/category;
- sanitized user/technical fields;
- correlation IDs;
- redaction status.

Raw provider/parser/tool evidence, when needed, is a separately protected artifact with stricter retention/ACL.

No secrets, bearer tokens, full sensitive URLs, clipboard payloads or arbitrary media bytes in normal logs.

## P2. Job temp isolation
Each job_attempt gets a unique private staging/temp directory keyed by immutable attempt ID.
- user/job ACL;
- no shared predictable filename reuse;
- manifest/hash validation on recovery;
- cleanup policy;
- no canonicalization based on filename alone.

Sensitive media should not intentionally opt into unmanaged OS thumbnail/index caches.

# Q. Financial ledger and budget serialization

## Q1. Transactional reservation
Budget availability check + reservation insert/update occur in one DB transaction scoped to the budget ledger.

Concurrent reservations cannot both consume the same remaining hard limit.

## Q2. Append-only usage adjustments

### provider_usage_events
- provider_usage_event_id
- connection/account
- job_attempt
- event_type: CHARGE | CORRECTION | REFUND | CREDIT | FX_ADJUSTMENT
- original_event_id nullable
- currency
- amount_minor_units
- credits nullable
- occurred_at
- received_at
- raw_evidence_hash

Provider corrections append adjustments; historical records are not overwritten.

Cross-currency budgets define an FX source/policy and uncertainty/exposure buffer.

# R. Documentation contract integrity

CI documentation lint verifies:
- unique section IDs/headings where the file uses numbered sections;
- one declared owner for each machine contract family;
- no duplicate table/API/state definition in multiple authoritative owners;
- valid cross-reference targets;
- required AGENTS references exist;
- extreme hardening belongs in this document rather than copied into all baseline detailed docs.

A failed documentation contract lint blocks merge because agent implementation depends on these documents as executable context.



# S. Recovery/deletion/learning interaction contracts

## S1. Recovery-epoch fencing of ephemeral state
Objects that are not valid across restore epochs include by default:
- slot/control/resource/protection leases;
- browser/session leases;
- local media/RPC capability tokens;
- transient reservations;
- epoch-scoped idempotency entries.

After restore they are expired/reconciled, never blindly trusted.

## S2. Forward revocation/deletion journal

### forward_policy_events
Durable events that must survive restore of older project state:
- privacy deletion/tombstone;
- rights revocation;
- consent withdrawal;
- credential/key revocation;
- emergency trust revocation.

Recovery applies all forward events newer than the backup checkpoint before project/search/release becomes authoritative.

## S3. Key lifecycle journal
Key rotation records per object/key-wrap progress and is resumable.
Deletion/crypto-erasure policy knows which backups/archives retain wrapped keys.
Archive policy includes periodic decryptability checks and recovery material status.

## S4. Project clone isolation
Clone may intentionally reference/copy creative assets and selected policies.
Clone never copies:
- command/outbox/inbox/idempotency history;
- active jobs/leases/reservations;
- usage ledger transactions;
- credential bindings/browser sessions;
- authorization-scoped derived caches/index generations.

## S5. Learning/evaluation lineage
Failure examples, golden examples, benchmark datasets and training inputs bind:
- source revision;
- project/privacy scope;
- consent/rights/training permission;
- immutable dataset snapshot revision.

Withdrawal/revocation blocks future eligible use and creates lineage impact for promoted heuristics/models.
Data classes that cannot tolerate non-guaranteed unlearning are prohibited from TRAINING use up front.

## S6. Immutable dataset snapshots
Promotion records pin exact:
- dataset snapshot ID/hash;
- label revision;
- benchmark version;
- evaluator/router candidate version.

Label changes create a new immutable dataset revision.

# T. Generation/protection/publication concurrency

## T1. Projection/index generation activation
Rebuild creates immutable generation G+1.
After verify:
- atomically switch active generation pointer;
- retain G for rollback/ongoing readers;
- retire G later.

Security-sensitive deletion/revocation may fence G immediately before rebuild completion.

## T2. Dependency protection leases
Protection lease can cover a resource set:
- output object;
- source objects;
- package/model/runtime;
- rights/license snapshot;
- key material reference;
- backup manifest.

GC/uninstall/removal cannot invalidate a proof while lease is active.

## T3. Publication action serialization
For one external publication identity:
- publish;
- replace;
- takedown;
- republish
use an aggregate fencing token/serialized external-action queue.

Revalidate rights/privacy/destination before each irreversible phase.

# U. Maintenance and observability admission control

Maintenance workloads are scheduled resources.

Policies:
- log rate/dedup/sampling + disk quota;
- metrics label-cardinality budget;
- integrity audit incremental ranges;
- hash scrub I/O budget;
- backup upload bandwidth priority;
- production playback/render has higher interactive priority when configured.

Background safety work may be mandatory but must be paced rather than starving foreground production.

# V. Backup durability and storage migration

## V1. No silent durability downgrade
Configured target class is a contract:
LOCAL_WRITABLE | SEPARATE_VOLUME | OFFLINE | IMMUTABLE_REMOTE.

If target class cannot be achieved:
- state = DEGRADED/BLOCKED;
- report reason;
- require policy-authorized fallback.

## V2. Filesystem compatibility preflight
Move/restore checks:
- case/Unicode collision;
- max path/file size;
- free space;
- atomic rename/locking needs;
- volume identity;
- existing corpus compatibility.

# W. Historical identity and audit durability

Human/agent actors are never physically erased from historical approval provenance.
Actor state may become DISABLED/TOMBSTONED while immutable historical identity remains.

# X. Learning diversity controls

Global learning/routing policies include:
- per-project/domain sample caps or weights;
- provider/model concentration monitoring;
- minimum exploration floor where policy permits;
- rare-domain preservation;
- no direct optimization from raw engagement/cost alone.



# Y. Semantic risk, trusted build and aggregate action contracts

## Y1. Effective risk classification
Effective risk is:
`max(declared_risk, detected_risk, policy_required_risk)`.

Detected risk signals include:
- protected path classes;
- auth/privacy/rights/storage/update/release semantics;
- critical invariant test changes;
- executable/native/postinstall dependency changes;
- signing/trust policy changes;
- bulk destructive/external actions.

A task cannot lower its own gate by declaring LOW.

## Y2. Governance drift baseline
Periodic/governance CI compares current baseline with prior approved state:
- required invariant tests;
- workflow permissions;
- runner trust;
- signing/update policy;
- dependency trust surface;
- protected write scopes.

Cumulative weakening triggers a governance finding even if no single PR crossed the threshold.

## Y3. Build attestation

### build_attestations
- source_commit/tree
- builder_identity / trust class
- build recipe/version
- toolchain digests
- dependency/SBOM snapshot
- environment profile
- output artifact digests
- created_at
- signature/attestation identity

Release artifacts must match an authorized attestation.

## Y4. Signing request
Signing API accepts:
- release_manifest_id;
- expected artifact digest;
- signing purpose/key policy.

It does not accept an arbitrary untrusted filesystem path as authority.
Signer verifies digest is authorized by immutable manifest/attestation.

# Z. External semantic correlation and outbound attestation

## Z1. Provider correlation key
External response identity includes:
- provider/connector generation;
- account/tenant;
- request/job nonce;
- external job ID;
- expected artifact role/session;
- recovery epoch.

Authenticated but semantically mismatched responses are quarantined.

## Z2. Outbound transport attestation
Connector host records:
- authorized egress manifest;
- final serialized payload/body-part metadata hash where feasible;
- destination endpoint/account identity;
- transport result.

Connector self-report alone is not proof that undeclared data was not sent.
Capabilities unable to provide strong transport attestation are classified accordingly.

# AA. Aggregate action policy

Maintain rolling aggregate counters/policies for:
- destructive entity count;
- external spend/exposure;
- external egress bytes/sensitive classes;
- publish/delete/takedown count;
- bulk generation/fanout.

Repeated individually valid actions crossing a threshold are reclassified as bulk/high-risk and require the corresponding gate/DecisionRequest.

# AB. Repository/CI artifact hygiene

CI/repository policy blocks:
- unexpected large binary/media files;
- vendor/node_modules/build output unless explicitly governed;
- generated file modification without source-of-truth change where policy forbids it;
- secret/private-key/token patterns.

Secret incident:
- revoke/rotate immediately;
- identify Git history/PR/CI artifacts/caches containing it;
- remediate history/artifact retention as feasible;
- never treat “deleted from current branch” as sufficient.

CI artifacts/logs have sensitivity class, access and retention policy.

# AC. Reproducible release environment

Where reproducibility is claimed, attested environment includes:
- locale/timezone;
- source-date/deterministic timestamps where supported;
- path/debug-prefix mapping;
- toolchain/package digests;
- build flags;
- clean workspace identity.

A reproducibility claim is verified by comparison, not prose.

# AD. Publication multi-step state

Publication tracks separately:
- media upload;
- metadata/title/description;
- thumbnail;
- subtitles/captions;
- visibility/privacy;
- scheduling;
- platform processing;
- actual-state verification.

Target schedule stores explicit UTC instant + target/display timezone.

Partial success is PARTIAL_EXTERNAL_STATE, not a single successful boolean.



# AE. Control-plane disaster recovery and immutable identity

## AE1. Canonical repository identity
Control policy pins:
- immutable GitHub repository ID;
- expected owner/name;
- default branch;
- expected visibility/security posture.

Rename/transfer/visibility/default-branch/ruleset changes create a governance incident requiring reconciliation.

Trusted GitHub actors pin stable account/user ID plus display login.

## AE2. Durable merge/release audit archive
At successful merge, archive a compact immutable verification record:
- Task Issue + contract version/hash;
- claim attempt;
- final head/base/merge SHA;
- review profiles/assurance/results;
- CI verification tuple/attestations;
- governance exceptions if any.

At release, bind relevant merge/build/signing evidence to ReleaseManifest.

This is audit/recovery evidence only; live scheduling still uses GitHub.

## AE3. Root-compromise boundary
Threat model explicitly states:
- OS administrator/root compromise defeats local confidentiality assumptions;
- compromised Studio Owner/trusted GitHub root identity can defeat logical workflow policy absent external protection;
- agent logical identities are not security principals stronger than their underlying credentials.

# AF. Backup/key common-mode recovery

Restore verification includes:
- backup object integrity;
- backup chain dependency integrity;
- key-wrap/recovery metadata;
- ability to decrypt representative protected content;
- forward revocation/deletion journal availability.

A restore lacking required key metadata or forward policy journal remains QUARANTINED/RECOVERY_REQUIRED.

# AG. Local scale boundary and migration path

Operational telemetry tracks scale indicators:
- Core DB bytes;
- event/projection rows;
- writer queue/latency;
- checkpoint/backup/restore duration;
- asset/timeline/member counts;
- concurrent job rates.

Policy defines warning/unsupported thresholds.

Crossing sustained thresholds triggers:
- scale advisory;
- workload reduction where needed;
- supported migration plan to future server/multi-machine backend.

CineForge does not silently treat SQLite/single-host mode as infinitely scalable.

## AG1. Large-domain access
Large collections use:
- cursor paging;
- virtualized UI;
- partitioned/sharded projections where appropriate;
- bounded history loading;
- streamed manifests.

# AH. Long-term compatibility

Maintain old-format fixtures for:
- DB schemas;
- project manifests;
- timelines;
- release/archive manifests;
- representative encrypted/archive states.

Migration test corpus proves supported historical upgrade paths.
Required migration tooling/metadata is retained sufficiently to avoid depending on one extinct app binary.

# AI. Ownership transfer and actor offboarding

## AI1. Project/studio ownership transfer
Transfer workflow re-evaluates:
- new owner/studio authority;
- rights/consent;
- privacy/egress;
- budgets;
- external connections/accounts;
- actor roles;
- open tasks/locks/decisions;
- learning/data-use scope.

Credentials/browser sessions do not transfer implicitly.

## AI2. Actor offboarding
Historical approvals remain immutable.
Live:
- sessions/credentials revoked;
- tasks/locks/leases reassigned/released;
- pending decisions rerouted to valid authority;
- actor state becomes DISABLED/TOMBSTONED.

# AJ. Release/archive completeness

Archive package can include:
- immutable final master;
- stems/subtitles/deliverables;
- ReleaseManifest;
- source/build/signing attestation;
- actual published/transcoded output when retrievable/required;
- open/documented interchange artifacts;
- codec/tool descriptors necessary for future interpretation.

Archive UI distinguishes:
- exact bytes preserved;
- reproducible locally;
- best-effort reproducible;
- cloud generation not reproducible.


# AK. Multi-window/edit-session concurrency

## AK1. Edit session identity
Every mutable workspace session has:
- session_id;
- actor_id;
- client_instance_id;
- base_revision/row_version;
- last_acknowledged_server_version;
- mode: SHARED_SAFE | EXCLUSIVE | BRANCH_REQUIRED;
- lease/fencing token where required.

Unsafe domains such as canonical timeline structure or high-impact canon edits default to EXCLUSIVE or explicit branch/merge behavior.

A suspended/stale window cannot autosave over a newer revision.

## AK2. Reconnect behavior
On reconnect/resume:
- fetch current revision;
- compare against session base;
- if unchanged, resume;
- if changed and operations are merge-safe, rebase typed ops;
- otherwise enter CONFLICT/BRANCH_REQUIRED.

No silent last-write-wins.

# AL. Untrusted CineForge project/package import

A project package is hostile structured input unless it was produced by a verified backup/restore path.

Import pipeline:
QUARANTINE
→ schema/version validate
→ archive/path/resource validate
→ namespace/ID remap plan
→ credential/session strip
→ dependency/right/provenance inspect
→ isolated migration
→ preview/impact
→ explicit adoption
→ registered project/entities.

Rules:
- package IDs never directly overwrite existing global entity IDs;
- absolute/external paths are converted to untrusted references/remap candidates;
- browser sessions, API credentials, secure refs and control-plane identities are never trusted from package contents;
- migration/parser runs in staging before canonical DB mutation;
- package may carry evidence/provenance, but trust is re-evaluated locally.

# AM. Manifest-only output packaging and metadata sanitation

## AM1. Explicit deliverable manifest
Release, handoff, diagnostics and support archives are assembled only from an explicit manifest of allowed artifacts.

Never recursively package:
- project working directory;
- browser profile;
- environment/home folder;
- temp root;
- repository root;
- credential/runtime directories.

## AM2. Metadata policy
Before outward delivery, inspect and classify:
- container/global metadata;
- EXIF/XMP;
- GPS/device identifiers;
- user/home paths;
- creation software/version;
- comments;
- attachments;
- fonts/subtitles;
- hidden streams.

Policy decides PRESERVE | REMOVE | REWRITE.

Rights attribution/required credits are independent obligations and cannot be removed merely because privacy sanitation is active.

## AM3. Published-output verification
Where target platform permits retrieval, verify:
- expected video/audio streams;
- subtitle/caption presence;
- attachment/metadata policy;
- duration/timing;
- unexpected hidden streams;
- actual platform transcode identity/evidence.

# AN. Additional hostile parser surfaces

Fonts, subtitle formats, ICC/ICM profiles, LUTs, SVG, PDF and similar rich documents use the same untrusted parser contract as media/archive inputs.

Controls:
- memory/CPU/time/item-count limits;
- recursion/embedded-object limits;
- external network/resource loading denied by default;
- PDF launch/actions ignored;
- SVG scripts/events/external resources disabled or rasterized in sandbox;
- font/color parsers isolated from privileged Core process;
- cue/text count and per-item size bounded.

# AO. Local service exposure boundary

Local runtime/media/model services:
- bind loopback only by default;
- authenticate requests with scoped capability/session token;
- do not trust browser origin merely because it reaches localhost;
- expose no unauthenticated management/debug endpoint;
- LAN exposure is an explicit advanced deployment mode with firewall/listen-address/auth warnings and policy.

Desktop WebView cannot ambiently call arbitrary local services outside the scoped Core bridge.

# AP. Telemetry, logs and crash-artifact data classes

All emitted operational data is classified:
- SAFE_TELEMETRY
- PROJECT_METADATA
- CONTENT_SENSITIVE
- BIOMETRIC_OR_IDENTITY_SENSITIVE
- CREDENTIAL_SECRET

Policy governs:
- log inclusion;
- analytics egress;
- crash dump inclusion;
- diagnostic bundle inclusion;
- retention;
- redaction/pseudonymization.

CREDENTIAL_SECRET is never logged/telemetried.
CONTENT_SENSITIVE/BIOMETRIC data is opt-in or local-only according to policy.

User/home paths and machine/user identifiers are pseudonymized/redacted in shareable diagnostic bundles unless explicitly required and approved.

# AQ. Derived face/voice identity feature lifecycle

Embeddings/descriptors used for face/voice identity are first-class derived sensitive artifacts.

They bind:
- source revision(s);
- purpose;
- model/version;
- consent/rights scope;
- project/studio scope;
- retention class;
- deletion/revocation state.

Deletion/revocation of the source/consent triggers lineage impact on:
- embeddings;
- indexes;
- caches;
- learned/promoted datasets where policy permits removal;
- future matching/routing.

A deleted source cannot remain indirectly active through an unlabeled embedding cache.

# AR. Desktop/Core/API/schema coherent activation

A running component set has:
- Desktop version;
- Core version;
- local API protocol min/max;
- DB schema min/max;
- worker/sidecar compatibility manifest.

Startup handshake fails closed on unsupported combinations.

Only one compatible Core ownership epoch may mutate a DB.

Updater activates Desktop + Core + required sidecars as one coherent release set.
Rollback/recovery also reasons about the set, not individual executable files independently.

An old UI may enter a limited compatibility/read-only path only when the Core explicitly advertises it.

# AS. Security-sensitive display and logging

For filenames, project titles, provider names and external identifiers:
- strip/escape terminal/control characters in logs;
- detect/flag Unicode bidi overrides and deceptive control characters in security-sensitive UI;
- show detected file/media type separately from display name/extension;
- deterministic truncation preserves a manifest mapping to the original logical name.

User-friendly rendering must not hide the real security-relevant identity.

# AT. Privacy sanitation + rights attribution reconciliation

Release preflight computes both:
- privacy metadata policy;
- rights/license/attribution obligations.

If they conflict:
- create a DecisionRequest or fail the release policy;
- do not silently strip required attribution;
- do not silently publish private metadata merely to satisfy a generic metadata-preserve setting.

Release manifest records:
- original metadata classes;
- removed/rewritten/preserved fields;
- attribution items inserted/preserved;
- policy revision and evidence.

# AU. Secure temporary-data lifecycle

Job/import/browser/media temporary roots:
- are user-scoped and non-world-readable;
- use unpredictable per-job directories;
- never alias canonical CAS;
- are journaled for crash cleanup;
- are scanned/reconciled on startup;
- support secure deletion/crypto-erasure policy where required by sensitivity class;
- never become support/export payload by directory recursion.

Temp cleanup failure is visible storage/privacy debt rather than silently ignored.


# AV. Learning dataset integrity and promotion freshness

Dataset/golden/benchmark snapshots include:
- immutable snapshot ID/hash;
- source project/privacy scopes;
- sample lineage;
- generated/synthetic/human-labeled proportions;
- duplicate/near-duplicate cluster statistics;
- package/model/evaluator dependencies.

Before promotion:
- check leakage between train/failure/golden/benchmark/shadow sets;
- flag suspicious near-duplicate overlap;
- enforce project/privacy scope;
- report source-composition imbalance;
- require review of anomalous/outlier clusters.

Promotion state becomes STALE when a required package/model/evaluator trust state is revoked or materially superseded.

# AW. Retrieval/index authorization isolation

Every derived search/vector/embedding index entry carries:
- source entity/revision;
- studio/project scope;
- purpose/use policy;
- rights/privacy state;
- index generation/version.

Query authorization applies before and after similarity ranking.
A high similarity score never broadens scope.

Revocation/deletion/tombstone:
- hides entry immediately from authorized query projection;
- schedules physical purge/rebuild;
- records verification evidence that no active index generation still exposes it.

Cross-project/global craft memory is a separately governed dataset, not an implicit union of project indexes.

# AX. Offline/multi-session collaboration conflict

Working ops include:
- session/client ID;
- base immutable checkpoint;
- operation sequence;
- server acknowledgement sequence.

On reconnect:
- operations proven commutative/non-overlapping may replay;
- conflicting operations create CONFLICT/BRANCH_REQUIRED;
- no stale autosave replaces newer server state;
- approval/release can bind only server-synchronized immutable revision, never unacknowledged local draft.

UI visibly warns when local edits are unsynchronized and therefore not part of an approval target.

# AY. Trusted time health

Core exposes time-health:
- TRUSTED
- DEGRADED
- UNTRUSTED
- RECOVERING

Use:
- monotonic time for local durations/timeouts/lease elapsed time where possible;
- GitHub/provider/server timestamps for external event ordering;
- local wall clock only with uncertainty awareness.

When time is UNTRUSTED:
- signing/certificate-sensitive release actions fail safe;
- scheduled publication requires external read-back/confirmation;
- lease/ticket expiry requiring wall-time interpretation is reconciled before destructive takeover;
- logs retain both local observed time and authoritative sequence/server time where available.

Event/canonical ordering never relies on UUIDv7/wall-clock alone.

# AZ. Scheduled occurrence identity

Every recurring/scheduled external action has a stable occurrence identity:
- schedule_id
- occurrence_sequence or canonical scheduled instant
- idempotency_key

Restart/clock jump/retry cannot execute the same occurrence twice without explicit reconciliation.

Provider-reported effective scheduled time/timezone is read back and stored separately from requested schedule.

# BA. Backup decryptability and forward trust journals

Backup verification includes:
- object/hash integrity;
- DB consistency;
- key/wrapped-key availability for protected data;
- representative decrypt/read test;
- recovery-policy/trust journal checkpoint.

Restore applies forward non-rollbackable policy journals before becoming ACTIVE:
- signing/trust key revocations;
- consent/right revocations where policy requires;
- crypto-erasure/key lifecycle events;
- external publication/takedown identity needed for reconciliation.

An old backup cannot resurrect a key or trust state that was revoked after the backup.

# BB. Multi-destination publication state

A release publication fanout creates one child publication per exact destination identity.

Each child tracks:
- destination/account/workspace fingerprint;
- requested visibility/audience;
- requested schedule/timezone;
- destination-scoped idempotency key;
- upload;
- platform processing;
- effective visibility/audience;
- effective schedule;
- verification;
- takedown/compensation;
- external content ID/URL sensitivity class.

Aggregate release publication state summarizes child states:
- ALL_VERIFIED
- PARTIAL
- BLOCKED
- UNKNOWN
- TAKEDOWN_PARTIAL
without erasing per-destination truth.

# BC. Publication postcondition verification

After publish/schedule, read back when supported:
- account/workspace;
- channel/destination;
- visibility/audience;
- scheduled/effective time;
- content identity;
- stream/caption/attachment presence.

Mismatch means NOT_VERIFIED and may trigger DecisionRequest/compensation/takedown.

Provider default settings never silently override requested PUBLIC/PRIVATE/UNLISTED intent.

# BD. External publication audit retention

Local project trash/purge cannot erase the minimum evidence needed to:
- identify external publication;
- verify destination/account;
- request takedown/compensation;
- account for irreversible external side effects.

Retention is policy-scoped and may minimize sensitive content while preserving external identity/audit.

# BE. Semantic contract hotspots

Planner/Integrator hotspot keys can be path-independent:
- DOMAIN:<aggregate>
- SCHEMA:<contract>
- API:<contract>
- EVENT:<contract>
- AUTH:<boundary>
- MEDIA:<timing/color/audio contract>
- RELEASE:<signing/publication contract>
- GOVERNANCE:<policy>

Task contracts declare semantic_hotspots where applicable.

Concurrent active PRs on the same exclusive semantic hotspot require:
- explicit contract-first split; or
- hotspot lease/merge sequencing;
even if changed files do not overlap.

# BF. Architecture/risk waiver authority

Risk/architecture decisions are first-class decision records.

Implementer/author cannot self-grant a waiver that:
- changes approved product/architecture intent;
- accepts P0/P1 residual risk;
- weakens security/rights/release governance;
- removes a protected invariant;
- reduces its own required review/CI gate.

Decision records include:
- issue/risk/invariant;
- exact scope;
- rationale;
- authority actor/role;
- expiration/review date where applicable;
- compensating controls;
- evidence.

A waiver never erases the original finding/audit history.


# BG. Cross-store external dispatch protocol

Project DB and Installation Side-Effect Ledger are separate durability domains and do not share one transaction.

Dispatch uses a stable `dispatch_fence_id` and this recoverable sequence:

1. Project DB commits command/outbox intent with `dispatch_fence_id`.
2. Dispatcher idempotently PREPARES the same fence in the installation ledger.
3. Network/external side effect is forbidden until ledger state is PREPARED.
4. External receipt/acceptance/unknown outcome is written to installation ledger.
5. Project DB reconciles from ledger.
6. Crash/restart compares both stores and resumes from the last proven state.

Required states:
- INTENT_COMMITTED
- LEDGER_PREPARED
- DISPATCHING
- ACCEPTED_EXTERNAL
- ACCEPTANCE_UNKNOWN
- RECONCILED
- COMPENSATED
- ABANDONED_SAFE

Rules:
- project intent without ledger row recreates same fence idempotently;
- PREPARED ledger row without provider receipt is not assumed dispatched;
- unknown acceptance never blindly retries beyond exposure/idempotency policy;
- project restore never erases the installation ledger record.

# BH. Recovery scope

Recovery fencing has explicit scope:
- INSTALLATION
- STUDIO
- PROJECT
- CONNECTION
- PUBLICATION_DESTINATION

Restoring Project A blocks only affected scopes unless a shared invariant requires a wider freeze.

Recovery scope graph records shared dependencies, e.g.:
- one connection/account shared by Project A and B;
- one signing root shared by all projects;
- one corrupted object store root shared by studio.

The smallest safe blocking scope wins; never default to either “freeze nothing” or “freeze the whole installation”.

# BI. Atomic resource-bundle reservation

Jobs may require multiple constrained resources.

Reservation request is a bundle:
- GPU/VRAM
- CPU/RAM
- disk space / I/O
- browser profile
- specialized worker/runtime

Acquire:
- atomically where scheduler/storage implementation supports it; otherwise
- in one canonical global resource-order with rollback of earlier reservations if a later acquisition fails.

Never hold resource A while indefinitely waiting for B under a different acquisition order.

Each bundle has:
- bundle_id
- fencing epoch
- priority
- preemptibility
- expiry/renewal policy
- physical-release confirmation state

Lease expiry does not imply physical release for non-preemptible processes.

# BJ. Resource fairness and priority inversion

Scheduler tracks:
- per-project active WIP;
- fair-share/weight;
- critical-path priority;
- reserved capacity;
- starvation age;
- non-preemptible occupancy.

Policy may support:
- priority inheritance;
- draining low-priority queues;
- preemption only for resources/tasks proven safely preemptible;
- reserved emergency/release capacity.

A low-priority long job cannot monopolize all capacity indefinitely, but the scheduler must not “preempt” a non-preemptible GPU process by merely expiring its lease.

# BK. Maintenance compatibility matrix

Maintenance operations are classified:
- BACKUP
- RESTORE
- RECOVERY_RECONCILIATION
- SCHEMA_MIGRATION
- APP_UPDATE
- CONNECTOR_UPDATE
- GC
- INTEGRITY_AUDIT
- INTEGRITY_REPAIR
- LIBRARY_MOVE
- KEY_ROTATION

A matrix defines ALLOW | SNAPSHOT_SAFE | DRAIN_REQUIRED | MUTUALLY_EXCLUSIVE.

Mandatory examples:
- RESTORE / RECOVERY_RECONCILIATION × APP_UPDATE = MUTUALLY_EXCLUSIVE
- SCHEMA_MIGRATION × BACKUP = allowed only at defined migration-safe checkpoint/snapshot
- GC × RESTORE_SWITCH = MUTUALLY_EXCLUSIVE
- INTEGRITY_AUDIT × GC = SNAPSHOT_SAFE only when both bind same stable object/revision snapshot
- KEY_ROTATION × SIGNING = DRAIN_REQUIRED or key-version pinned

A Maintenance Coordinator issues a maintenance lease/fence before operation.

# BL. Just-in-time irreversible gate

Immediately before an irreversible/externally durable action, revalidate:
- rights;
- privacy/egress;
- signing trust;
- provider account/workspace/destination identity;
- release manifest/content digest;
- cost/exposure;
- current policy revision;
- recovery/external-reality state.

Planning approval is not a permanent ticket.

The final gate emits a fresh `irreversible_gate_snapshot_hash` bound to the actual dispatch/sign/publish attempt.

# BM. Manual-lock release semantics

Releasing a human/manual lock only removes the prohibition against future automation.

It does not promote an old AI candidate.

A candidate generated against:
- older revision;
- older manual-lock epoch;
- older timeline/canon state

remains CANDIDATE_ONLY until a new explicit promote/apply command passes current impact/policy checks.

# BN. Defense-in-depth worker sandbox

Application-level URL/protocol checks are reinforced at process/OS boundary where practical.

Worker sandbox defines:
- allowed input roots;
- allowed output root;
- network deny/allow destinations;
- process spawning policy;
- environment/credential exposure;
- device/GPU access;
- temp quota.

Media parsers must not treat UNC/network paths as trusted local files merely because protocol syntax is file-like.

# BO. Authoritative control-context binding

Critical control decisions read policy/architecture/task contracts from an explicit Git commit/ref.

A worker may use local cache for speed only when it proves:
- cached blob SHA matches expected Git ref content;
- local checkout is clean for those files or ignored;
- no uncommitted local governance edit participates in the decision.

High-risk merge/review evidence records context commit/ref.

# BP. High-risk review depth

HIGH-risk review requires evidence of direct inspection of:
- actual diff;
- named critical files;
- relevant workflow/test changes;
- risk/invariant impact.

A generated PR summary is supporting material only.

Review record can include:
- inspected_paths
- diff_hash
- risk_items_checked
- tests/workflows inspected
- unresolved assumptions

For security-critical changes, review policy may require model/runtime diversity in addition to different agent runtime identity.

# BQ. Continuous Epic integration acceptance

Epic integration is not postponed until all child tasks are closed.

After relevant child merges:
- run/refresh vertical integration evidence;
- update Epic integration state;
- create unblock/regression Task immediately on failure;
- re-evaluate downstream Task readiness.

Epic states include:
- INTEGRATING_HEALTHY
- INTEGRATING_DEGRADED
- BLOCKED_INTEGRATION
- ACCEPTANCE_READY

Local green PRs do not outweigh broken integrated behavior.

# BR. Performance/resource regression budgets

Critical flows declare measurable budgets, e.g.:
- startup time;
- UI interaction latency;
- Core command p95/p99;
- DB writer latency/WAL growth;
- peak memory;
- import throughput;
- render/normalize throughput;
- CI fast-gate duration.

Regression policy distinguishes:
- expected feature cost;
- environmental noise;
- real budget violation.

A feature can be correctness-green but not done if it destroys an agreed critical performance budget.

# BS. Recovery ambiguity workflow

Recovery unresolved items are grouped/ranked by:
- irreversible side-effect risk;
- duplicate charge/publication risk;
- monetary exposure;
- privacy/rights impact;
- downstream blockers;
- confidence.

Safe batch decisions are allowed only for homogeneous evidence classes.
Unknown/high-risk items remain individually reviewable.

Recovery UI must not overwhelm the user with raw callback/ledger rows.

# BT. Backup freshness / RPO

Backup policy defines Recovery Point Objective per durability class.

Health combines:
- integrity;
- authenticity;
- decryptability;
- failure-domain independence;
- restore verification;
- freshness against required RPO.

An old immutable backup may be trustworthy but still unhealthy for the current RPO.


# BU. Anti-rollback package activation

Every security-sensitive package family maintains:
- package family identity;
- semantic/security version;
- signed manifest digest;
- content digests;
- signing key ID;
- minimum allowed version/trust epoch where policy requires monotonicity.

A valid historical signature does not by itself authorize downgrade.

Downgrade:
- is blocked below the trust/version floor unless explicit recovery policy authorizes it;
- records rationale and risk;
- never re-enables a version/key already revoked by forward trust journals.

Update/connector/runtime/model package activation rechecks signature + manifest + content hashes at activation boundary.

# BV. Trusted executable and DLL loading

Managed executables:
- launch from absolute managed path;
- do not resolve through ambient PATH;
- verify expected file identity/hash/signature immediately before security-sensitive launch where practical;
- sanitize inherited environment variables;
- use hardened platform loader/search behavior so current working directory/untrusted adjacent paths do not supply DLLs/plugins;
- declare intentionally loadable plugin directories explicitly.

Unexpected executable/library identity => block/quarantine.

# BW. Single-Core database ownership epoch

One mutable Core owner exists per installation/database.

Ownership record contains:
- installation/library identity;
- ownership_epoch;
- process identity;
- random session nonce;
- acquired server/monotonic timestamps where available;
- heartbeat/liveness evidence.

Startup:
1. acquire exclusive owner primitive;
2. verify DB/library identity;
3. establish Core session epoch;
4. only then enable writes.

Second instance:
- attaches read-only when supported; or
- exits with clear ownership state.

Stale-lock takeover requires evidence the old owner cannot still mutate.
SQLite file locking remains defense-in-depth, not the product-level ownership election.

# BX. IPC endpoint and Core-session authentication

Desktop↔Core channel binds:
- OS-user ACL;
- installation identity;
- Core ownership epoch;
- session nonce/token;
- protocol version;
- client session identity.

Desktop never trusts “whatever answers on localhost port N”.

After Core restart/ownership change:
- old IPC tokens/queued mutating commands are invalid;
- safely idempotent read/replay operations may rebind explicitly;
- high-impact commands require fresh plan/current expected versions.

# BY. Decision snapshot fencing

High-impact command execution binds:
- decision_request/plan ID;
- impact_snapshot_hash;
- exact entity/revision membership;
- policy/rights snapshot;
- expected versions;
- expiry/staleness rule.

Execution recomputes critical guards.
Material mismatch => STALE_DECISION/REPLAN_REQUIRED, never silent scope expansion.

# BZ. Windows canonical path policy

At file trust boundaries:
- normalize using OS-aware canonical APIs;
- reject reserved device names and NT device/global-root escape forms;
- reject unintended alternate data streams;
- inspect reparse points/junctions/symlinks according to boundary policy;
- bind volume/file identity where continuity matters;
- never use user display path as security identity.

# CA. Portable project/archive package trust

Project/template/handoff package import:
- is processed in sandbox like hostile archive input;
- has versioned manifest;
- hashes each declared payload;
- rejects undeclared/escaping entries;
- rejects absolute extraction paths;
- does not activate embedded executable/plugin/script merely because package contains it;
- maps external references explicitly rather than trusting source-machine paths.

# CB. At-rest security profiles

Deployment/project policy declares actual at-rest guarantees.

Profiles may include:
- STANDARD_OS_USER — relies on OS account/disk security;
- ENCRYPTED_WORKSPACE — DB/media/object encryption or encrypted backing volume according to implementation;
- EXTERNAL_MANAGED — enterprise storage controls.

UI/docs must not imply “secrets encrypted” means “all project media encrypted”.

Encrypted profile defines:
- key ownership;
- backup wrapping/recovery;
- machine migration;
- rotation;
- crypto-erasure;
- lost-key failure behavior.

# CC. Security-tool interference classification

Filesystem/package errors classify evidence such as:
- ACCESS_DENIED;
- FILE_QUARANTINED/MISSING_AFTER_WRITE;
- CONTROLLED_FOLDER_BLOCK;
- DISK_FULL;
- FILESYSTEM_CORRUPTION;
- UNKNOWN_IO.

When cause is ambiguous:
- do not auto-delete/reinitialize storage;
- preserve evidence;
- enter degraded/recovery state;
- show security-tool troubleshooting only when evidence supports it.
