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


# CD. Log, diagnostic and observability budgets

Operational data classes define:
- max record size;
- per-component rolling quota;
- retention period;
- redaction profile;
- aggregation/coalescing key;
- persistence priority.

During failure storms:
- repeated equivalent errors aggregate counts/samples;
- low-value debug records are dropped before emergency disk reserve;
- security/audit evidence required by policy is preserved according to priority.

Metrics use bounded-cardinality labels. Project/shot/job IDs belong in trace/log correlation, not unbounded metric label dimensions unless explicitly sampled/bounded.

# CE. Audit/event cold archive

Hot event/audit storage may roll immutable segments to archive.

Each segment records:
- event seq range;
- schema decoder/version requirements;
- content hash;
- previous segment hash/checkpoint link;
- storage location/durability class;
- retention/legal policy;
- verification state.

Projection checkpoints record the exact event/archive boundary they summarize.

Rules:
- archive is not deletion of authority;
- required decoders/migration readers remain available/tested;
- restore verifies segment chain/manifests;
- retention cannot purge rights/publication/security evidence contrary to policy.

# CF. Projection/index rebuild generation

Derived projection/search/vector rebuild uses:
`BUILDING_GENERATION → VERIFYING → ACTIVATABLE → ACTIVE`.

Existing ACTIVE generation remains queryable until atomic switch.

New generation carries:
- source event/checkpoint watermark;
- deletion/revocation/tombstone watermark;
- index schema/model version;
- authorization scope metadata.

Partial generation is never exposed as canonical query truth.

# CG. Maintenance temporary-space reservation

Maintenance Coordinator estimates/reserves:
- final bytes;
- temporary amplification;
- DB/WAL/headroom;
- IO bandwidth class;
- expected lock/downtime class.

Operations such as VACUUM, migration, update unpack, index rebuild, package install and library move fail preflight if safe temporary headroom cannot be reserved.

# CH. Account-scoped auth/anti-abuse circuit breaker

Provider account/workspace connection tracks:
- auth failure streak;
- MFA/CAPTCHA required state;
- account suspension/lock signal;
- retry-after/cooldown;
- human prompt dedupe key.

When tripped:
- no new automated login hammering;
- queued work becomes BLOCKED_CONNECTION/AUTH_REQUIRED;
- one DecisionRequest represents the shared incident instead of one prompt per job;
- successful verified reauth resets only after account/workspace identity check.

# CI. Worker semantic-progress watchdog

Worker reports:
- heartbeat;
- current attempt/phase;
- last semantic progress checkpoint;
- progress evidence.

Health distinguishes:
- ALIVE_PROGRESSING
- ALIVE_STALLED
- UNRESPONSIVE
- CRASH_LOOP
- DRAINING

Task-specific stall threshold may trigger diagnostic/cancel/restart/takeover, but no destructive intervention solely from one late heartbeat.

# CJ. In-flight policy/terms postflight

External dispatch binds execution-time privacy/terms/rights snapshots.

On result/materialization and before canonicalization/release:
- revalidate current policy;
- preserve immutable evidence of what was already sent under old policy;
- if current policy now blocks further external use, prevent additional egress;
- result may be quarantined/restricted rather than automatically canonicalized;
- never claim prior egress was undone.

# CK. Inbox/outbox storm control

Queues define:
- per-connection outstanding limit;
- global pending limit;
- batch size;
- concurrency;
- fairness;
- max durable payload size;
- retry/backoff;
- archival/dead-letter policy.

On reconnection:
- process bounded batches;
- prioritize irreversible/recovery/security events appropriately;
- avoid one giant transaction;
- maintain backpressure to provider/worker dispatch where possible.

# CL. Long maintenance resumability

Long migration/rebuild/restore operations persist:
- phase;
- checkpoint;
- unit progress;
- last verified boundary;
- retry/rollback support;
- estimated remaining work only when evidence supports it.

Crash resumes from a proven checkpoint or rolls back to a proven boundary.
A progress UI never fabricates percent from elapsed time alone.

# CM. Durable error-evidence sanitation

Before persisting external/tool error evidence:
- parse/classify when possible;
- redact credential/token/cookie/auth headers;
- bound payload size;
- mark content/privacy sensitivity;
- hash/raw-reference according to policy instead of copying entire response;
- preserve enough evidence for debugging without making logs a secret store.

Raw untrusted error text is data and cannot become control instruction.


# CN. Native notification and clipboard privacy

Content sensitivity controls presentation outside CineForge.

Native notification payloads default to minimal text for sensitive projects:
- no script/dialogue;
- no confidential character/client names unless policy permits;
- lock-screen behavior follows privacy setting.

Clipboard/manual handoff:
- label sensitive copy actions;
- avoid copying credentials/internal auth identifiers;
- support auto-clear/private-copy behavior where platform permits and user opts in;
- warn that system clipboard/history may be outside CineForge retention control.

# CO. CAS integrity scrub and repair

Protected storage classes define scrub policy:
- periodic full/sample verification;
- hash algorithm/version;
- last verified time;
- mirror/backup repair priority.

On mismatch:
- object → QUARANTINED_CORRUPT;
- dependent asset revisions become unavailable/corrupt projection;
- attempt repair from independently verified mirror/backup;
- repaired bytes receive verification evidence;
- unrecoverable loss becomes explicit DecisionRequest/diagnostic incident.

# CP. Dedup privacy and shared-byte deletion

Physical dedup is not exposed as cross-project existence oracle.

API/UI must not reveal:
- “already existed in another project”;
- owner/project of matching bytes;
- timing that materially distinguishes unauthorized prior existence when avoidable.

Deletion tracks logical/legal identity and storage references separately.

A secure-delete statement must distinguish:
- logical removal from this project;
- removal from all authorized references;
- physical byte deletion;
- crypto-erasure.

If shared bytes remain required elsewhere, CineForge does not falsely claim physical destruction.


# CQ. Encrypted workspace and dedup scope

Security profile declares encryption/dedup domain.

Examples:
- STANDARD_OS_USER + STUDIO_DEDUP
- ENCRYPTED_PROJECT + PROJECT_DEDUP
- ENCRYPTED_STUDIO + STUDIO_DEDUP
- HIGH_ISOLATION + NO_CROSS_SCOPE_DEDUP

Rules:
- cross-scope plaintext equality is not leaked by API/UI;
- deterministic encryption is not used across isolation domains merely to improve dedup;
- crypto-erasure guarantee is defined relative to the encryption/dedup domain;
- physical shared bytes cannot invalidate a promised per-project crypto-erasure guarantee.

# CR. Sensitive derived-data inheritance

Every derived artifact inherits a sensitivity/storage policy from lineage unless a deterministic classifier proves a lower sensitivity class.

Includes:
- proxy/thumbnail/waveform;
- OCR/transcript;
- embeddings;
- FTS/vector indexes;
- cache;
- temp;
- preview;
- debug capture.

Encrypted workspace policy defines whether each class is encrypted, memory-only, excluded, or permitted plaintext.
Deletion/revocation traverses these lineage classes.

# CS. Resumable encryption key rotation

Encrypted objects record key ID/version.

Rotation journal:
- source key;
- target key;
- object set/snapshot;
- per-object state;
- backup/wrapped-key migration state;
- verification result.

Old key retirement requires proof:
- required objects migrated/verified;
- required backups decryptable/recoverable;
- no ACTIVE object depends only on old key;
- forward trust/key journal persisted.

Crash resumes from journal; mixed key versions are valid only while rotation state knows them.

# CT. Trust freshness and rollback-resistant revocation

Security-sensitive package/signing decisions include trust-freshness.

Local history is insufficient after:
- full system snapshot rollback;
- long offline interval;
- known revocation-event gap.

Policy may require fresh online/external trust evidence before:
- updater/package activation;
- release signing;
- privileged connector activation.

State:
- FRESH
- STALE
- UNKNOWN
- BLOCKED

An old valid signature plus stale revocation knowledge is not silently treated as FRESH.

# CU. Review evidence coverage

HIGH-risk review record binds:
- exact diff/base/head;
- critical paths inspected;
- generated/binary/minified files classified;
- ignored/generated files + reason;
- test/workflow/security evidence digests.

Generated summary is never the sole reviewed representation.

Oversized/noisy diffs may trigger REQUEST_SPLIT or specialized semantic tooling rather than silent truncation.

# CV. Final-artifact provenance and SBOM

Release package attestation binds:
- final artifact digest;
- merged/release source commit;
- exact package/runtime dependency graph included in artifact;
- SBOM digest;
- toolchain/container/runtime identity;
- signing event.

If packaging injects components after source-level SBOM generation, reconcile/regenerate before release.

# CW. Development execution isolation

Agent/reviewer runtime executing repository-controlled code uses least-privilege isolation.

Untrusted/task code does not ambiently receive:
- browser profile/cookies;
- signing/update keys;
- production API credentials;
- unrelated local filesystem;
- unrestricted network where unnecessary.

Credentials are scoped and injected only into explicitly trusted steps.

Source code prose cannot change sandbox policy.


# CX. Structured document and parser hardening

All structured-document/media-adjacent parsers inherit hostile-input semantics.

## CX1. XML-family parsing
For XML/XMP/EDL/interchange/project formats:
- external entities disabled by default;
- DTD disabled unless an explicitly trusted profile requires it;
- no implicit network/file resolution;
- maximum nesting depth, attributes, text bytes and entity count;
- parser executes in bounded worker/sandbox for complex/untrusted formats.

## CX2. SVG/vector preview
SVG is not treated as a passive bitmap.
- scripts/event handlers removed or disabled;
- external references blocked unless explicitly mediated;
- privileged UI may rasterize/sanitize before preview;
- remote URLs/fonts are not fetched implicitly.

## CX3. Fonts/subtitles/metadata
Fonts, subtitle attachments and metadata are parser attack surfaces.
Apply:
- size/count/depth budgets;
- sandboxed parsing/rendering where feasible;
- no arbitrary external URI loading;
- attachment extraction only to private staging;
- codec/font/renderer failures quarantine the artifact, not crash Core.

# CY. Windows namespace and credential-leak boundary

Windows paths are normalized/canonicalized before authorization.

Reject or explicitly classify:
- UNC/network shares;
- extended device paths;
- NT device namespaces;
- alternate data streams;
- reserved device names;
- trailing dot/space ambiguities;
- reparse/junction escapes.

Opening a UNC/network path is an egress/network operation and requires policy.
Imported metadata/playlists/documents may not trigger implicit SMB/NTLM authentication.

# CZ. Unicode, display and log safety

Identity never derives from display string.

For security-sensitive UI/logs:
- preserve original bytes/text where needed for creative fidelity;
- maintain a normalized comparison/display representation;
- escape bidi/control characters in logs/status/notifications;
- make suspicious extension/name spoofing visible;
- avoid deriving path/type/authority from rendered filename.

Confusable-name warnings are advisory; canonical IDs remain truth.

# DA. Query and expression budgets

Untrusted search/filter/expression inputs use bounded semantics:
- input length;
- AST/token count;
- nesting depth;
- wildcard/operator count;
- execution time;
- result count;
- cancellability.

Regular expressions use a non-catastrophic engine/restricted dialect or explicit timeout.
FTS/SQL queries are parameterized; user expressions never become raw SQL.

# DB. Suspend/resume and trusted time

Local duration/lease timers use monotonic elapsed time where applicable.

On OS sleep/hibernate/resume:
1. detect resume discontinuity;
2. do not immediately classify all expired heartbeats as dead;
3. re-read Core ownership, slot/control leases and external job state;
4. reconcile browser/network/provider sessions;
5. only then resume mutation/scheduling.

Wall-clock timestamps are audit/display evidence, not canonical event order.
DB/event sequence controls causality ordering.

# DC. Security token and identifier generation

Security-sensitive:
- capability tokens;
- IPC session secrets;
- CSRF/nonces;
- one-time resume tokens;
- webhook challenge secrets

use OS cryptographic RNG, sufficient entropy and collision rejection.

UUIDv7/business IDs are identifiers only.
Clock regressions must not determine event order or authority.
If UUID generator detects timestamp regression/collision risk, it uses a monotonic-safe implementation strategy rather than trusting wall clock blindly.

# DD. Local service bind/origin contract

Local privileged service endpoints default to:
- named pipe / loopback-only binding;
- user-scoped ACL where transport supports it;
- authenticated session/capability token;
- strict expected Host/Origin validation for HTTP/WebSocket-like transport;
- no wildcard `0.0.0.0`/LAN exposure without explicit deployment mode.

Browser pages from arbitrary origins cannot invoke privileged Core APIs merely because they run on the same machine.

CORS is not the sole security boundary.

# DE. Structured logs and notifications

Logs/events/notifications have trusted structural fields:
- severity;
- event code;
- action code;
- entity IDs;
- message key.

Untrusted text is stored/rendered only as argument/data.

Before terminal/UI output:
- escape control characters;
- prevent ANSI/control injection;
- cap field length;
- redact secrets/sensitive classes.

An imported filename/model string cannot create a fake privileged action button/severity by embedding markup/control syntax.

# DF. Entity/depth resource bombs

Ingest budgets cover more than bytes:
- file/entity count;
- relationship edge count;
- JSON/YAML/XML nesting;
- parser token count;
- table row/column count;
- sheet count;
- subtitle cue count;
- archive member count;
- embedded attachment count.

Budget exhaustion yields bounded partial/quarantine state, not unbounded allocation.

# DG. Spreadsheet formula injection

When exporting untrusted text to CSV/XLSX-like formats:
- values that target applications interpret as formulas are escaped/encoded as literal text by default;
- formulas are emitted only from explicitly trusted typed-formula fields;
- exported manifest records the sanitization policy.

This is distinct from SQL injection and must be tested with leading `=`, `+`, `-`, `@`, tabs/control prefixes and locale-specific spreadsheet behavior.

# DH. Required additional tests

21. XML XXE/local-file/network entity attempt;
22. malicious SVG script/external reference;
23. malformed font/subtitle attachment parser crash;
24. UNC/SMB credential-leak path;
25. bidi/extension spoof display;
26. catastrophic regex/FTS query;
27. sleep/hibernate during active lease/Core ownership;
28. security-token collision/entropy failure simulation;
29. local service wildcard bind/origin attack;
30. log/notification control-character injection;
31. million-entity/deep-JSON input bomb;
32. CSV/XLSX formula injection corpus.


# DI. Numeric and rational invariants

All numeric values crossing parser/API/domain boundaries are validated before arithmetic or allocation.

## DI1. Checked arithmetic
Use checked wide arithmetic for:
- byte size = dimensions × channels × bytes;
- sample/frame count conversions;
- rational rescale;
- duration/timestamp arithmetic;
- money/credits;
- allocation/index offsets.

Overflow/underflow is a validation failure, never wraparound.

## DI2. Rational canonicalization
For canonical rationals:
- denominator > 0;
- sign stored in numerator;
- reduce by gcd where equality/identity/cache depends on representation;
- explicit rounding mode for conversion;
- compare using overflow-safe arithmetic.

A denominator of 0 is invalid.

Frame rate, stream timebase and SMPTE timecode are separate typed concepts.

## DI3. Finite floating values
Where float is unavoidable:
- reject NaN/±Infinity at Core/API boundary;
- define acceptable range;
- canonicalize negative zero where identity/hash matters;
- never serialize non-finite values into canonical JSON/state.

# DJ. Media physical-domain constraints

Validated examples:
- width/height > 0 and bounded by configured decode policy;
- frame rate > 0 and under supported maximum;
- pixel aspect numerator/denominator valid;
- sample rate within supported configured range;
- channel layout count bounded;
- source_out >= source_in;
- timeline_out >= timeline_in;
- speed/scale/gain within explicit domain bounds;
- transform matrices finite and valid for the operation;
- unknown color metadata stays UNKNOWN, not silently defaulted.

Policy can expand supported bounds, but malformed inputs cannot bypass them.

# DK. Timecode and retime semantics

## DK1. SMPTE/timecode
Store:
- frame-rate rational;
- timecode rate;
- drop-frame flag;
- source frame number / timecode origin;
- timezone only when wall-clock meaning exists.

29.97 drop-frame counting is not represented as “30 fps with a label”.

## DK2. Retime
Canonical edit math retains rational source↔timeline mapping.
Repeated edits do not destructively quantize the authoritative mapping to display milliseconds.

Proxy/display rounding is derived.

# DL. Financial arithmetic and unit identity

## DL1. Money
Money is represented using:
- integer minor units or a fixed-decimal implementation with explicit scale;
- ISO currency code;
- checked arithmetic.

Binary floating point is never authoritative money.

## DL2. FX conversion
When conversion is necessary, persist:
- source amount/currency;
- target currency;
- rate;
- rate source;
- effective/captured time;
- rounding rule;
- converted result.

Estimate conversion and actual billing conversion remain separate evidence.

## DL3. Provider credits
Credit quantities bind:
- provider;
- credit/unit type;
- unit schema/version where semantics can change.

Refunds/negative adjustments are append-only usage adjustments, not destructive edits of prior charges.

# DM. Legal/calendar time semantics

Rights/consent/terms effective periods specify:
- instant vs date-only;
- source timezone/IANA zone when meaningful;
- inclusive/exclusive endpoints;
- resolved UTC instants for enforcement.

Date-only expiry does not rely on the current machine locale.

For future wall-clock schedules, store timezone identifier + local intent; each emitted occurrence has stable occurrence identity.
For audit, persist the resolved execution instant even if timezone rules later change.

# DN. Stable order-key semantics

Editable order keys must support deterministic rebalancing.

Rebalancing:
- does not change entity identity;
- is recorded as structural ordering maintenance, not creative revision unless visible order changes;
- supports concurrent/stale detection;
- cannot overflow silently after repeated insertions.

# DO. Required numeric/domain tests

33. denominator-zero rationals;
34. rational normalization/equality;
35. 64-bit overflow on duration/byte allocation;
36. NaN/Infinity metadata;
37. absurd dimensions/frame/sample/channel counts;
38. negative/reversed clip/subtitle intervals;
39. 23.976/29.97 drop-frame/timecode edges;
40. nested retime precision over long timelines;
41. money overflow and cross-currency estimate/actual;
42. refund/negative provider adjustment;
43. locale decimal input `1,5` vs `1.5`;
44. rights expiry across timezone/DST boundary;
45. order-key exhaustion/rebalance.


# DP. Signed-manifest freshness and activation identity

A valid signature does not make an arbitrarily old package/update acceptable.

Signed package/update metadata includes:
- package family;
- semantic/version identity;
- monotonic release epoch or signed sequence;
- minimum allowed security/trust floor where applicable;
- publication time/effective window;
- manifest digest.

Activation rejects:
- older-than-policy-floor versions;
- replayed manifests below accepted epoch;
- manifests signed by revoked/untrusted keys.

Final activation records exact installed file-tree/content digests after staging/finalization.
Downloaded archive verification alone is insufficient.

# DQ. Signing pipeline ordering and final-byte attestation

Release pipeline ordering is explicit:

```text
SOURCE COMMIT
→ HERMETIC BUILD
→ NORMALIZE/PACKAGE
→ PLATFORM SIGN
→ HASH FINAL SIGNED BYTES
→ BUILD/RELEASE ATTESTATION
→ PUBLISH STAGING
→ VERIFY FINAL STAGED BYTES
→ UPLOAD
```

Any mutation after signing invalidates later digest/attestation.

Record separately:
- pre-sign build digest;
- final signed artifact digest;
- signing key ID;
- optional timestamp-authority evidence;
- source commit/toolchain/SBOM;
- publish-staged digest.

# DR. Signing timestamp evidence

Where platform trust uses a timestamp authority:
- store timestamp token/authority identity;
- verify it independently;
- distinguish current cert validity from trusted signing-time validity;
- policy decides whether missing/invalid timestamp blocks release.

# DS. Portable project/archive trust and namespace

A CineForge portable project/package is untrusted until verified.

Import:
- validates archive traversal/parser budgets;
- authenticates package manifest when available;
- remaps collision-prone project-local IDs into new destination identity;
- preserves provenance mapping from imported IDs;
- never restores active credential secret references as authenticated;
- external connections enter DISABLED/UNVERIFIED/REAUTH_REQUIRED as appropriate;
- current package/model/license/rights policy is reevaluated;
- publication destinations are not active by default.

# DT. Authenticated backup and decryptability

Backup validity dimensions:
- content hash integrity;
- manifest authenticity;
- encryption confidentiality;
- recovery-key availability;
- failure-domain independence;
- restore drill result;
- freshness/RPO.

A matching checksum without authentic manifest provenance does not prove the backup is trustworthy.

Encrypted backup is not healthy if the required key cannot be recovered according to policy.

# DU. Forward policy journal across restore

Certain governance/privacy/security events are forward-authoritative and cannot be erased by restoring older project state:
- signing/package/model key revocations;
- security package blocks/minimum version floors;
- consent/rights revocations;
- deletion/privacy revocations;
- publication/takedown fences where policy requires.

After restore, Core reapplies the current forward policy journal before normal activation/dispatch.

A backup does not resurrect a later-revoked permission.

# DV. Project clone semantics

Clone plan classifies data:
- COPY_VALUE
- SHARE_REFERENCE
- OMIT
- RESET_UNVERIFIED
- NON_TRANSFERABLE

Examples:
- creative canon may copy by value;
- immutable media may share safe storage reference;
- credentials are omitted/rebound;
- publication destinations reset;
- non-transferable consents/rights require fresh binding;
- browser sessions never clone as authenticated state.

Clone impact is reviewable before execution.

# DW. Portable/export metadata allowlist

Portable archives, handoffs and release outputs use an explicit metadata allowlist.

By default exclude:
- absolute local paths/usernames;
- temp/cache locations;
- API endpoints;
- secret/credential references;
- internal prompts;
- hidden diagnostics/debug traces;
- unrelated private project IDs.

Sanitization is recorded in the export/handoff manifest.

# DX. Publication final-byte and destination idempotency

Each publication destination maintains:
- destination identity snapshot;
- exact final staged artifact digest;
- idempotency/correlation key;
- state;
- external publication ID;
- verification evidence.

Retry does not republish destinations already confirmed delivered unless explicitly requested.

# DY. Takedown/revocation publication fence

A takedown/revocation creates a forward publication fence scoped to:
- release;
- destination/account/workspace;
- rights/revocation reason.

Queued/future publication attempts matching the fence are BLOCKED before dispatch.

Clearing the fence requires explicit authorized decision and does not erase prior takedown evidence.

# DZ. Required trust/package/release tests

46. replay older valid signed update manifest;
47. replace sidecar/file after package archive verification;
48. mutate artifact after platform signing;
49. pre-sign vs post-sign digest provenance;
50. missing/invalid timestamp-authority evidence;
51. portable project ID collision and credential stripping;
52. imported old blocked connector/model package;
53. tampered backup + recomputed plain checksum;
54. encrypted backup with unavailable recovery key;
55. restore older backup after key/rights/privacy revocation;
56. project clone with non-transferable rights and publication destination;
57. export metadata leaking local path/user/internal prompt;
58. corruption/path swap in publish staging after release verification;
59. multi-destination retry after partial success;
60. takedown racing queued publication.


# EA. Protected storage integrity scrub

Protected object classes may define periodic scrub policy:
- ORIGINAL
- CANONICAL/APPROVED
- NON_REBUILDABLE
- RELEASE_MASTER
- BACKUP_MANIFEST critical artifacts

Scrub:
1. read bytes;
2. compute algorithm-qualified digest;
3. compare with registered identity;
4. mark VERIFIED or CORRUPT;
5. if redundant verified source exists, repair by writing a new staged object and re-verifying;
6. if no verified source, block dependents and surface recovery.

Never “repair” from an unverified mirror.

# EB. SQLite corruption and salvage

Database health can use:
- `PRAGMA quick_check` for frequent bounded checks;
- `PRAGMA integrity_check` for deeper scheduled/recovery checks as policy permits.

On corruption:
- stop canonical writes when severity demands;
- snapshot evidence/logs;
- attempt restore from verified backup;
- allow read-only salvage/export only when SQLite can safely expose data;
- never delete inconsistent rows automatically just to make checks pass.

# EC. Durable file activation

For critical object/master/package finalization:
```text
WRITE_STAGING
→ FLUSH_CONTENT
→ VERIFY_CONTENT
→ ATOMIC_REPLACE/RENAME
→ DURABILITY_BARRIER
→ OPTIONAL_READBACK_VERIFY
→ ACTIVATE_POINTER/MANIFEST
```

Implementation uses platform-appropriate durability primitives and records the durability class achieved.

If platform/filesystem cannot provide a requested guarantee, policy degrades explicitly or blocks; it does not silently claim stronger durability.

# ED. GC crash recovery

GC object state:
- LIVE
- DELETE_INTENT
- BYTES_DELETING
- BYTES_ABSENT
- PURGE_COMMITTED
- RECONCILIATION_REQUIRED

Delete process:
1. persist intent and safety generation;
2. revalidate graph/leases;
3. delete bytes;
4. verify absence;
5. commit logical purge.

Restart reconciler inspects all nonterminal delete states.

# EE. Environment certification fingerprint

For runtime/model/media certification, fingerprint relevant environment:
- OS build/kernel;
- GPU vendor/device;
- driver version;
- runtime acceleration stack;
- codec/native library versions;
- connector/runtime package digests.

Environment drift can mark prior certification:
- CURRENT
- RECHECK_REQUIRED
- INVALIDATED

Critical jobs may require a short health qualification before dispatch after material drift.

# EF. Release-master durable activation

Release state separates:
- MANIFEST_PLANNED
- MASTER_WRITING
- MASTER_VERIFIED
- MASTER_DURABLE
- RELEASE_ACTIVATED

On Core restart, activation reconciles exact master digest/path/storage-object identity before allowing publish.

# EG. CAS liveness and clone safety

Canonical liveness is derived from graph/revision references, not an unrecoverable mutable refcount alone.

Optimization refcounts/indexes:
- may exist;
- are rebuildable projections;
- are never the sole deletion truth.

Project clone uses:
- transactional logical clone intent;
- explicit shared/copy relationships;
- post-commit graph reconciliation.

Partial clone cannot cause GC to delete source-referenced objects or permanently leak ownership truth.

# EH. Power-loss/durability test matrix

61. corrupt protected CAS object then scrub/repair from verified mirror;
62. corrupt CAS with no good mirror and verify dependent blocking;
63. SQLite quick_check/integrity_check failure enters safe mode;
64. power loss after file flush before rename;
65. power loss after rename before manifest activation;
66. GC crash after intent, after byte delete, before purge commit;
67. OS/GPU driver drift invalidates runtime certification;
68. release manifest exists but master bytes are missing after restart;
69. clone crash before/after logical commit;
70. external drive letter reused by different volume;
71. antivirus removes package file after install health check;
72. storage target truncation despite copy API success.


# EI. Actor authorization epochs

Every security principal/actor has a monotonic authorization epoch.

Sessions/capability tokens bind:
- actor_id;
- authorization_epoch;
- session/capability scope;
- issued_at;
- expiry;
- core/recovery epoch where relevant.

Events that increment authorization epoch include:
- role/authority reduction;
- offboarding;
- security revocation;
- credential reset;
- account recovery.

Re-enabling an actor creates a new authorization epoch. Old tokens never become valid again.

# EJ. Offboarding vs security revocation

## EJ1. Normal offboarding
Purpose: stop future access while preserving legitimate historical decisions.

Effects:
- actor DISABLED/TOMBSTONED;
- live sessions/tokens revoked;
- personal credentials disabled;
- tasks/locks/decisions rerouted;
- queued high-impact commands reauthorize;
- historical approvals remain immutable valid evidence unless separately challenged.

## EJ2. Security revocation
Purpose: contain a compromised/untrusted actor.

SecurityRevocation records:
- actor_id;
- suspect_from_utc_us nullable;
- suspect_to_utc_us nullable;
- scope;
- reason;
- authority;
- evidence.

It creates an approval/action taint overlay.
Affected historical records are not mutated; dependent current state becomes:
- REVIEW_REQUIRED;
- BLOCKED;
- INVALID_FOR_RELEASE;
according to policy.

# EK. Credential ownership semantics

Credential binding declares owner type:
- PERSONAL_ACTOR
- SHARED_SERVICE_ACCOUNT
- STUDIO_MANAGED
- EXTERNAL_MANAGED

Also records:
- owner_actor_id nullable;
- authorized project/studio scopes;
- current auth epoch;
- account/workspace identity.

Offboarding:
- revokes PERSONAL_ACTOR credential use;
- does not blindly revoke studio/shared service credentials;
- queued jobs bound to now-invalid personal credentials cannot dispatch/retry without replan/rebind.

# EL. Authority freshness gates

Current authority epoch/role is revalidated at:
- review submission;
- DecisionRequest resolution;
- canonical approval;
- manual-lock acquire/release;
- high-impact command execute;
- external dispatch;
- publish/takedown;
- signing;
- destructive delete/purge;
- ownership transfer.

A valid session at workflow start is insufficient.

# EM. Revocation propagation

Access/security revocation invalidates or re-filters derived surfaces:
- media/RPC capability tokens;
- search/retrieval indexes;
- cached query projections;
- native notifications;
- diagnostic/support bundles;
- browser profiles/sessions;
- temp/staging access;
- learning/dataset eligibility;
- pending export/share links where managed by CineForge.

Derived data may remain physically present, but authorization is evaluated at read/delivery time.

# EN. Break-glass ownership recovery

When no valid project/studio authority remains:
- ordinary members cannot self-promote;
- use a separately governed break-glass recovery path;
- require stronger identity/credential evidence;
- record reason/evidence;
- optionally delay/cooldown and notify surviving trusted contacts/owners where product supports it;
- preserve prior owner audit identity.

Break-glass capability is narrowly scoped and separately monitored.

# EO. Privileged authority-change protection

Changes to:
- Studio Owner;
- Admin;
- Security/Trust authority;
- signing/release authority;
- break-glass recovery policy

are high-risk operations.

They require:
- impact preview;
- fresh current authority;
- stronger review/approval policy;
- non-retroactive governance rule;
- optional multi-party/credential-independent approval for high-assurance deployments.

# EP. Actor identity immutability

Actor IDs are never reused for another human/service.

Deletion is represented by:
- DISABLED/TOMBSTONED;
- optional personal-data anonymization/pseudonymization under policy;
- preserved immutable actor ID for audit referential integrity.

# EQ. Required identity/offboarding tests

73. old capability token after actor offboarding;
74. offline queued mutation reconnect after offboarding;
75. open review submitted after role removal;
76. security revocation taints prior approvals in suspect interval;
77. personal credential vs shared service credential offboarding;
78. browser profile cleanup/reverify after access revoke;
79. search/index/media-token access immediately after revoke;
80. re-enable actor and verify old tokens remain invalid;
81. remove all admins then exercise break-glass recovery;
82. malicious admin attempts to offboard all other owners;
83. ownership transfer with non-transferable credentials/rights;
84. actor ID tombstone/non-reuse audit.


# ER. Immutable rights evidence binding

Rights-sensitive decisions bind immutable evidence:
- rights record revision;
- consent revision;
- license snapshot;
- provider terms snapshot;
- evidence asset/storage digest;
- decision/review actor and time.

Mutable external URLs are supplementary references only.

# ES. Attribution obligation graph

Rights records may emit deliverable obligations:
- attribution text/template;
- required placement/channel;
- language/territory;
- applicable asset/release scope.

Release readiness resolves obligations against the exact ReleaseManifest/deliverable metadata.
Missing required attribution is a blocking rights finding when policy says mandatory.

# ET. Sensitive derived-data inheritance

Derived biometric/identity-like artifacts inherit source sensitivity:
- face embeddings;
- voice embeddings;
- identity fingerprints;
- biometric features;
- speaker/face indexes;
- learned adaptation artifacts under CineForge control.

Deletion/rights revocation propagates to these derived artifacts according to policy.
Raw-source deletion alone is not sufficient if sensitive derivatives remain accessible.

# EU. Dataset eligibility contract

A training/evaluation dataset item is eligible only when all required dimensions are explicitly ALLOWED:
- asset/license rights;
- consent;
- provider/output terms;
- project privacy/data-use policy;
- training/use-purpose policy.

UNKNOWN is not ALLOWED.

Dataset snapshot pins:
- exact asset revision/content digest;
- legal/rights identity;
- eligibility evidence;
- representation type;
- provenance.

# EV. Lineage-aware split and leakage prevention

Protected train/eval split groups may include:
- exact content hashes;
- asset lineage/derivatives;
- frames/clips from same source;
- near-duplicate similarity cluster;
- same performance/recording session where configured.

A protected group cannot straddle training and sealed evaluation holdout.

Similarity/dedup is evidence, not legal identity.

# EW. Golden and benchmark governance

Golden examples require:
- exact representation identity;
- provenance;
- rights eligibility;
- reviewer authority;
- review confidence/optional second review;
- expected outcome;
- exposure/tuning history.

Benchmark suites track:
- version;
- membership snapshot;
- sealed/open status;
- number of tuning/promotion exposures;
- validity/taint state.

Repeated optimization against one benchmark triggers overfit risk and may require a fresh sealed holdout.

# EX. Feedback poisoning boundary

Production feedback/user labels begin as:
- UNTRUSTED_FEEDBACK
- CURATION_REQUIRED

They do not directly become training truth.

Curation may use:
- multi-source agreement;
- reviewer authority;
- anomaly/poison checks;
- contribution caps;
- project/domain stratification.

A single project/user cannot silently dominate global model/router behavior.

# EY. Learning lineage and revocation

Maintain graph:
```text
SourceAsset/Revision
→ DatasetSnapshot
→ Training/EvaluationRun
→ CandidateComponentVersion
→ PromotionRecord
→ ProductionUse
```

On rights/privacy revocation:
1. block future dataset membership;
2. stop/revalidate active training;
3. taint affected dataset/run/component nodes;
4. policy decides DEPRECATE / DEPROMOTE / RETRAIN / CONTINUE_WITH_LEGAL_APPROVAL;
5. preserve evidence.

Do not promise selective machine unlearning when underlying model cannot support it.

# EZ. Dataset/export privacy

Training/evaluation exports use explicit allowlist.
By default remove unnecessary:
- filenames/usernames;
- absolute paths;
- private project IDs;
- debug prompts;
- raw hidden context;
- provider endpoints/tokens;
- diagnostic traces.

Dataset egress records exact included fields/assets and purpose.

Sensitive evaluation evidence has retention/TTL policy.

# FA. Representation-aware evaluation

Evaluation subject pins:
- exact asset revision;
- representation role (MASTER/PROXY/PREVIEW/etc.);
- transform chain;
- resolution/audio/color profile.

A PASS on proxy does not satisfy master gate unless equivalence policy explicitly permits it.

# FB. Required rights/learning tests

85. tamper/delete rights evidence after approval;
86. required attribution omitted from release;
87. consent revoked after voice/face embedding creation;
88. delete source while derived sensitive embeddings remain;
89. UNKNOWN training permission dataset admission;
90. same lineage/near-duplicate in train and sealed evaluation;
91. poisoned user feedback attempts golden promotion;
92. one project dominates learning contribution;
93. provider terms forbid training after asset creation;
94. rights revocation during active training;
95. rights revocation after component promotion;
96. dataset export privacy leakage;
97. proxy evaluation incorrectly satisfying master benchmark;
98. backup restore attempts to resurrect deleted sensitive derived data.


# FC. Library lineage and deployment identity

CineForge separates durable library history from physical deployment identity.

## FC1. Library lineage
`library_lineage_id` identifies the durable family/history of one CineForge library.

It survives:
- supported machine move;
- verified restore;
- backup restore;
- storage-root relocation.

It does not prove which physical machine is currently authorized to create external side effects.

## FC2. Deployment instance
`deployment_instance_id` identifies one active physical installation/deployment.

`deployment_generation` advances on:
- MOVE/REPLACE;
- disaster restore;
- explicit fork;
- deployment identity recovery.

Core/session/external dispatch evidence binds both lineage and deployment generation.

# FD. Deployment activation and fork detection

Writable activation validates:
- library lineage;
- expected deployment binding;
- installation secret/secure-store evidence;
- Core ownership;
- recovery epoch;
- environment fingerprint.

If deployment evidence is missing/mismatched:
- do not silently assume this is the original machine;
- open READ_ONLY / DEPLOYMENT_RECONCILIATION;
- require MOVE / RESTORE / FORK choice or policy resolution;
- rotate local IPC/session capability secrets.

An installation secret should be stored/cross-checked outside the portable project/library data, using OS secure storage where practical.

A full VM/disk clone may copy the secure state too; this remains a documented residual without remote coordination.

# FE. Move, restore and fork semantics

## MOVE / REPLACE
Intent: continue one deployment on a new machine.
- preserve library lineage;
- create new deployment generation/instance;
- retire old deployment when evidence/remote coordination exists;
- revalidate credentials/environment;
- preserve external side-effect history.

## RESTORE
Intent: recover lost/corrupt deployment.
- preserve library lineage;
- create new deployment generation;
- create new recovery epoch;
- reconcile external reality before dispatch.

## FORK
Intent: independent creative copy.
- preserve provenance link to source lineage if desired;
- create new deployment identity/execution namespace;
- external connections/schedules/publication actions default DISABLED/UNVERIFIED;
- credentials/browser sessions are not active merely because bytes were copied.

# FF. External side-effect identity namespace

External dispatch/correlation/idempotency record includes:
- library_lineage_id;
- deployment_instance_id or deployment_generation;
- recovery_epoch;
- command/job/attempt identity;
- provider/account/workspace identity.

A fork must not accidentally reuse the same logical “publication attempt” namespace.

Provider-native idempotency keys are derived according to operation semantics:
- restore/reconciliation may intentionally preserve a prior external operation identity;
- independent fork uses a distinct side-effect namespace.

# FG. Deployment-fork invalidation

New deployment/fork/move invalidates or revalidates ephemeral state:
- Core ownership/session;
- IPC/media/capability tokens;
- leases;
- browser process/profile session state;
- queued schedules;
- temp/staging state;
- environment certifications;
- personal credential bindings;
- notification delivery handles.

Historical project/release/provenance records remain immutable.

# FH. Backup namespace

Backup identity includes:
- library lineage;
- deployment generation/instance at capture;
- immutable backup generation ID;
- recovery epoch;
- object/DB checkpoint.

Backups are append/versioned artifacts, not a mutable single “latest.zip” overwritten by multiple deployments.

# FI. Independent-fork merge boundary

V1 does not merge two independently mutated SQLite/library states directly.

Supported reconciliation uses explicit:
- portable project import;
- asset/revision import;
- script/canon/timeline comparison;
- conflict resolution;
- rights/provenance validation.

“Copy database back over the old one” is not a merge operation.

# FJ. Optional remote deployment registry

High-assurance/team/enterprise deployments may use an optional remote registry to:
- register active deployment generation;
- retire prior installations;
- detect simultaneous clone activity;
- issue deployment fencing leases.

CineForge local-first operation must remain functional without it, but documentation must state that absolute cross-machine singleton enforcement is impossible against a fully cloned machine with copied secure state.

# FK. Required clone/split-brain tests

99. copy library to second PC with missing installation secret;
100. restore full backup and create new deployment/recovery epoch;
101. independent fork disables publication/schedules/connections;
102. original PC returns after MOVE/REPLACE;
103. VM/disk clone copies secure store and both attempt provider dispatch;
104. two deployments target same backup destination;
105. duplicate provider idempotency key across fork vs restore;
106. copied browser profile/session on new deployment;
107. copied scheduled jobs after fork;
108. explicit project reconciliation from independently modified fork.


# FL. Local endpoint attestation and squatting resistance

A predictable local endpoint name is not trusted merely because it is loopback/named-pipe and user-scoped.

Core endpoint bootstrap binds:
- installation/library identity;
- Core ownership epoch;
- high-entropy endpoint/session nonce;
- expected OS user/security descriptor;
- protocol version;
- server process identity evidence where the platform can provide it.

Client connection:
1. obtains current endpoint descriptor from the trusted Core ownership/bootstrap record;
2. connects only to that exact endpoint;
3. performs challenge/session binding before privileged commands;
4. rejects stale/pre-existing endpoint identity.

A malicious process already running with the same OS-user authority remains a residual local-malware boundary. V1 must not claim to defeat arbitrary same-user code execution.

# FM. Explicit proxy/network route contract

Managed API/browser/connector workers declare an effective network route:
- DIRECT
- SYSTEM_PROXY
- EXPLICIT_PROXY
- ENTERPRISE_MANAGED
- UNKNOWN

Workers do not silently inherit ambient `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, PAC or similar environment state unless the connector/network policy explicitly permits it.

Connection certification records:
- route class;
- proxy identity/endpoint where allowed;
- region/egress implications;
- last verification time.

Material route change can move connection health to REVERIFY_REQUIRED.

# FN. Privileged worker launch environment

Privileged workers launch from a managed runtime/package directory with:
- explicit working directory;
- environment allowlist/minimal inherited variables;
- controlled PATH/search order;
- dangerous loader/runtime injection variables removed unless explicitly required by trusted package policy;
- explicit temp/home/cache directories;
- connector-specific proxy/network variables supplied only from approved policy.

Examples requiring scrutiny include runtime/module/plugin search variables and loader overrides.

# FO. Capture-device privacy contract

Capture sessions for microphone/camera/screen carry:
- exact device/source identity;
- OS permission state;
- project/purpose;
- actor;
- start time;
- visible active indicator state;
- stop_requested_at;
- stop_confirmed_at;
- resulting asset/session identity.

Stopping capture is two-phase:
`ACTIVE → STOP_REQUESTED → STOP_CONFIRMED`.

UI may not claim recording stopped before the OS/device capture handle is confirmed closed.

If the selected/default device changes materially during sensitive capture, policy may pause and require reconfirmation.

Clipboard access is user/event-triggered by default; no continuous ambient clipboard polling.

# FP. Sensitive compute isolation profile

Projects/jobs declare compute isolation class:
- STANDARD
- SENSITIVE_PROCESS_ISOLATED
- UNTRUSTED_PLUGIN_ISOLATED

For higher isolation:
- untrusted/custom nodes run out-of-process;
- sensitive jobs do not reuse a long-lived untrusted plugin address space;
- per-job temp/runtime directories are isolated;
- CPU/GPU buffers are released/overwritten best-effort after use;
- process teardown may be used as a stronger cleanup boundary.

CineForge does not claim guaranteed erasure of GPU VRAM, pagefile, hibernation file or kernel/driver memory against an administrator/kernel adversary.

# FQ. Honest deletion guarantee classes

Deletion result records one of:
- LOGICAL_REMOVAL
- CRYPTO_ERASURE_CONFIRMED
- BEST_EFFORT_OVERWRITE
- PHYSICAL_ERASURE_NOT_VERIFIED

For SSD/snapshots/pagefile/cloud/provider copies, CineForge must not say “securely erased” unless the guarantee is actually established.

Encrypted workspace policy may use key destruction/crypto-erasure as the meaningful high-assurance deletion primitive.

# FR. Final-handle path authorization

For privileged file operations, path-string validation is only preflight.

Final authorization uses an opened handle/file identity where the OS supports it:
- final resolved path;
- volume identity;
- file identity;
- reparse/link status;
- allowed-root relation.

This closes aliases such as short-name/namespace/reparse changes that can survive textual normalization.

# FS. Bounded canonical write transactions

SQLite canonical writer transactions:
- perform only bounded DB work;
- never await network/provider/browser/user interaction;
- never perform long media encode/decode or large file copies while holding the writer transaction;
- persist intent/outbox/state, commit, then execute external/long work.

Health metrics track write-transaction duration and flag policy violations.

# FT. Maintenance resource admission

Maintenance tasks such as:
- VACUUM;
- migration/index build;
- projection rebuild;
- backup;
- integrity scrub;
- encryption rotation;
- library move

declare:
- temporary disk requirement;
- IO class;
- DB lock class;
- CPU/RAM need;
- cancellation/resume semantics.

Maintenance scheduler acquires an atomic/ordered resource bundle and respects emergency free-space reserve.
Incompatible high-IO maintenance does not start concurrently merely because each task is individually valid.

# FU. Actionable notification freshness

Native/in-app actionable notification carries:
- action/decision/entity ID;
- expected revision/version;
- action nonce/snapshot;
- expiry/materiality rule.

Click re-enters normal command validation.
If the underlying decision is obsolete/stale, the historical action is not executed.

# FV. Suspend/resume retry barrier

OS sleep/hibernate/resume creates a reconciliation barrier.

On resume:
1. pause timeout-driven retries/lease takeovers;
2. refresh Core/control/resource ownership;
3. reconcile provider/browser/external-job acceptance;
4. reverify connection account/workspace where required;
5. recalculate monotonic timers/health baselines;
6. then resume dispatch/retry.

Wall-clock sleep duration is not proof an external job failed.

# FW. Security guarantee boundary

Security/privacy documentation distinguishes:
- controls enforced by CineForge;
- controls delegated to OS/filesystem/account;
- residual administrator/kernel/hypervisor/EDR/physical-storage risks.

High-security profiles may reduce exposure but cannot promise secrecy against a fully compromised OS administrator/kernel.

# FX. Required fourth-wave tests

109. pre-create/squat predictable local IPC endpoint before Core startup;
110. endpoint/port reuse after Core crash;
111. ambient proxy variable hijack vs explicit connector route;
112. injected runtime/module/loader environment variable;
113. microphone STOP_REQUESTED vs confirmed device closure;
114. device identity change during recording;
115. isolated untrusted GPU/plugin process across two projects;
116. crypto-erasure vs ordinary SSD logical deletion UI/result;
117. Windows short-name/final-handle path alias escape;
118. DB write transaction attempting external await;
119. VACUUM/index rebuild under low-disk reserve;
120. concurrent backup + scrub + projection rebuild IO admission;
121. stale native notification action after DecisionRequest change;
122. sleep/hibernate during accepted external generation then resume/retry.


# FY. Currency and billing-unit semantics

Financial records distinguish:
- ISO/provider currency code;
- currency exponent/scale source/version;
- provider-native line amount;
- normalized internal amount;
- rounding mode;
- effective billing account/workspace.

Do not assume every currency has 2 decimal minor units.

Provider-native invoice/line evidence remains authoritative for reconciliation; internal normalization is derived.

# FZ. Price, credit and tax exposure snapshot

Before external paid dispatch, plan records where available:
- provider/model/service identity;
- pricing revision/quote ID;
- quoted unit price;
- quote expiry/freshness;
- tax/fee assumptions;
- promotional/free credit balance and whether provider may fall back to cash billing;
- maximum approved money/credit exposure.

At dispatch:
- revalidate current price/credit state;
- block/replan when material change exceeds approved ceiling;
- record actual service/model identity used.

# GA. Financial event reconciliation

Provider usage ledger supports out-of-order:
- CHARGE
- CORRECTION
- REFUND
- CREDIT
- TAX/FEE
- FX_ADJUSTMENT

Identity prefers provider invoice/billing-line identity over transport webhook ID.

Maintain distinct projections:
- POSTED_ACTUAL
- PENDING_ADJUSTMENT
- PENDING_REFUND
- UNRECONCILED
- AVAILABLE_BUDGET

Pending refund does not immediately increase hard spending authority unless policy explicitly permits it.

# GB. Rights effective-time and revocation scope

Rights/consent interval includes:
- effective_from instant;
- effective_until instant or legal calendar boundary;
- legal timezone/calendar semantics when “end of day” style wording applies;
- territory/jurisdiction;
- use-purpose scope;
- revocation effect scope.

Revocation effects may include:
- FUTURE_GENERATION_BLOCKED
- FUTURE_PROCESSING_BLOCKED
- FUTURE_PUBLICATION_BLOCKED
- TAKEDOWN_REQUIRED
- EXISTING_INTERNAL_USE_ALLOWED
- NEEDS_LEGAL_DECISION

Release/publish revalidates rights at execution time and against actual destination/processing region where policy requires it.

# GC. Retention/preservation holds

Deletion/GC eligibility has an independent hold axis.

Hold types:
- USER_PRESERVATION
- CONTRACTUAL_RETENTION
- AUDIT_PRESERVATION
- LEGAL_COMPLIANCE
- INCIDENT_FORENSICS
- SYSTEM_RECOVERY

A hold:
- blocks destructive purge according to policy;
- records authority/reason/effective interval;
- does not imply the asset may be newly used/generated/published.

Hold expiry only removes the hold; GC must perform a fresh dependency/rights/backup check before purge.

# GD. Portable archive vs disaster backup

## Disaster backup
Purpose:
- restore CineForge deployment/database/object state.

May include:
- DB snapshot;
- object manifest;
- deployment/recovery metadata.

It is not a portable project interchange format.

## Portable project archive
Purpose:
- transfer/preserve project content across installations/versions.

Requires:
- versioned self-describing manifest;
- project/entity/revision graph;
- required durable media/evidence;
- rights/provenance snapshots;
- semantic schema/profile versions;
- no active credentials, browser sessions, device secrets or live publication scheduling;
- explicit migration/import semantics.

UI/docs never call one format the other.

# GE. Long-term archive seal

Archive policy may require:
- materialize critical external/cloud references;
- durable reference render/mezzanine for proprietary/fragile codecs;
- store codec/font/color/profile descriptors;
- preserve human-readable script/canon/release manifests;
- rights/license evidence snapshots;
- periodic hash scrub;
- restore/import drill;
- archive format/schema version.

Archive can remain readable even when original AI/runtime/provider is unavailable.

# GF. Historical signature and timestamp evidence

Release/archive signature evidence stores:
- artifact digest;
- signer/key ID;
- signature;
- signing policy revision;
- signing time evidence;
- timestamp authority/token/chain where required;
- certificate/key validity/revocation evidence captured at signing/verification.

Later key revocation does not automatically mutate the historical record.
Verification policy decides whether a signature made before compromise/revocation remains acceptable.

# GG. Cross-project/template/learning isolation

Project clone/template/export performs dependency closure.

Default excluded/non-transferable unless explicitly authorized:
- credentials/secrets;
- browser profiles/sessions;
- publication destinations/schedules;
- private source-project links outside closure;
- project-scoped learned examples/memory;
- external account/workspace bindings.

Cross-project craft/learning memory is a separately governed dataset with:
- explicit source scope;
- consent/use purpose;
- privacy/rights eligibility;
- lineage.

# GH. Compensation readiness

External publication record tracks separately:
- publish capability/current credential state;
- replace capability;
- takedown capability;
- verification support;
- last compensation-readiness check.

Loss of takedown capability does not rewrite publication history, but may raise a release/operations warning for sensitive destinations.

# GI. Required fifth-wave tests

123. JPY/KWD/non-2-decimal provider billing lines;
124. per-request rounding vs aggregate reconciliation;
125. delayed tax/fee after estimate;
126. price/credit change between plan and dispatch;
127. refund/correction before original charge;
128. duplicate financial line under a new webhook event ID;
129. stale FX rate at hard-budget decision;
130. rights expiry with explicit legal timezone;
131. consent revocation scope variants;
132. retention hold blocking purge then expiring;
133. portable archive contains no credentials/browser session;
134. archive import on newer schema with declared semantic migration;
135. proprietary-codec archive with durable mezzanine fallback;
136. historical signed archive after signer-key revocation;
137. project template dependency closure excludes private source asset;
138. cross-project learning memory opt-in enforcement;
139. takedown capability lost after publication.


# GJ. Fifth-wave data records

## currency_semantics
- currency_code
- exponent
- source_authority
- source_version
- valid_from
- valid_to nullable

## pricing_snapshots
- id
- connection/account/workspace
- provider/model/service identity
- currency
- native_unit_price
- pricing_revision/quote_id nullable
- tax_fee_assumptions_json
- credit_balance_snapshot nullable
- cash_fallback_possible nullable
- quote_expires_at nullable
- captured_at
- evidence_hash

## provider_billing_events
- provider_billing_identity
- transport_event_id nullable
- account/workspace
- job_attempt nullable
- event_type
- original_billing_identity nullable
- currency
- native_amount
- normalized_amount
- settlement_state
- occurred_at nullable
- received_at
- raw_evidence_hash

Provider billing identity has a uniqueness policy scoped to provider/account.

## retention_holds
- id
- scope_type
- scope_id
- hold_type
- authority_actor
- reason
- effective_from
- effective_until nullable
- state: ACTIVE | EXPIRED | RELEASED | REVOKED
- evidence_ref nullable

## portable_archive_manifests
- id
- project_id
- archive_format_version
- semantic_schema_version
- manifest_hash
- required_object_manifest_hash
- compatibility_profile
- secret_exclusion_profile
- rights_snapshot_hash
- created_at

## archive_external_materializations
- archive_manifest_id
- source_external_ref
- materialized_asset_revision_id
- materialization_reason

## compensation_capability_snapshots
- publication_id
- connection/account/workspace
- replace_capability_state
- takedown_capability_state
- credential_readiness
- verification_support
- sampled_at

## project_transfer_scope_snapshots
Used by clone/template/archive/export:
- source_project_id
- exact included entity/revision closure
- excluded_secret/session/destination refs
- cross-project reference findings
- rights/privacy decision snapshot
- manifest_hash


# GK. External activation and deep-link inbox

OS activation sources are untrusted:
- custom URI/deep link;
- file association;
- shell/open-with;
- notification action;
- browser-origin activation.

They never directly invoke privileged domain commands.

Activation envelope stores:
- source kind;
- raw original payload;
- canonical decoded typed fields;
- requested action;
- candidate file/URL handles;
- arrival time;
- trust/origin metadata.

Rules:
- decode once using a canonical parser;
- reject ambiguous/double-encoded traversal;
- allowlist action names and parameter schemas;
- no ambient current-project authority;
- file/path/URL parameters pass normal intake/path/network authorization;
- destructive/paid/publish actions cannot be completed by deep link alone.

State:
`RECEIVED → PARSED → POLICY_CHECK → PENDING_USER_OR_COMMAND → CONSUMED`
or `REJECTED/EXPIRED`.

# GL. Capability namespace and effect-class ownership

Core owns globally stable semantic capability IDs.

Each capability version declares:
- capability_id;
- schema_version;
- input/output schema;
- effect class: READ_ONLY | LOCAL_MUTATION | EXTERNAL_MUTATION | PAID_EXTERNAL | PUBLICATION | DESTRUCTIVE;
- required permissions/policy gates;
- cancellation/idempotency class.

Connector/provider bindings implement a Core capability; they do not redefine its meaning.

Extension namespaces are:
- package-identity scoped;
- collision checked;
- never interpreted outside the declaring owner unless an explicit typed bridge exists.

Unknown/colliding namespaces fail closed.

# GM. Strict structured decoding

At Core/connector/control boundaries:
- duplicate JSON/map keys are rejected;
- unsupported required enum values are rejected;
- UNKNOWN security/policy state never coerces to ALLOWED;
- integer/float/rational limits are validated before allocation/arithmetic;
- object depth/field count/payload size are bounded;
- unknown fields are ignored only when the schema explicitly allows forward-compatible inert fields;
- privilege-bearing future fields must live in declared versioned extension namespaces.

Canonical decoders never rely on parser-specific “last duplicate key wins” behavior.

# GN. Configuration and feature-policy snapshots

Effective runtime configuration is immutable/versioned for an operation.

Snapshot includes:
- product config revision;
- security/privacy policy revision;
- feature/capability flags;
- connector/runtime policy;
- network route policy;
- storage policy.

Core distributes the effective snapshot to workers.
Workers do not independently reread mutable config/environment mid-command.

Flags classify:
- UX/EXPERIMENTAL;
- OPTIONAL_FEATURE;
- SAFETY_CRITICAL_GATE.

A normal feature flag may not disable a SAFETY_CRITICAL_GATE.

Commands/jobs record the relevant config snapshot hash.
Material change requires replan/revalidation.

# GO. Exclusive schema-migration authority

Schema migration has its own authority epoch.

Preconditions:
1. all normal Core writers drained/stopped;
2. exclusive DB migration primitive acquired;
3. source DB/schema version verified;
4. target package/migration digest verified against trusted signed package;
5. required backup/checkpoint verified;
6. no other migration epoch active.

Each migration step records:
- migration ID/version;
- input schema;
- package/migration digest;
- started/completed state;
- transactionality;
- resume/repair rule;
- resulting schema fingerprint.

Loose mutable migration scripts are not executed as authority.

# GP. Tamper-evident audit checkpoints

Local audit/event history is not assumed untamperable merely because it is append-only by application policy.

Integrity layer may store periodic checkpoints:
- event seq range;
- previous checkpoint digest;
- current range digest/Merkle root;
- schema/version;
- creation actor/process;
- optional external/signature evidence for higher assurance.

Integrity auditor detects:
- gaps;
- rewrite;
- duplicate aggregate versions;
- checkpoint-chain break;
- event/range mismatch.

A fully compromised same-user/admin attacker that can rewrite all local trust anchors remains outside the guaranteed boundary unless external signed checkpoints exist.

# GQ. Credential generation and worker secret leases

Secure credential entry has:
- credential_ref;
- generation;
- status: ACTIVE | ROTATING | REVOKED | EXPIRED | REAUTH_REQUIRED;
- account/workspace scope.

Queued jobs store reference + expected generation, never the raw secret.

Immediately before authenticated dispatch:
- resolve current credential;
- verify generation/status/scope;
- mint/use a short worker secret lease where supported.

Rotation/revocation:
- invalidates old worker secret leases;
- requests connector/browser session reauth/reconciliation;
- does not silently fall back to another credential/provider.

# GR. Cross-project opaque handle scopes

Opaque handles/capability tokens bind:
- installation/deployment;
- recovery epoch/session;
- actor;
- studio/project;
- purpose/capability;
- exact entity/revision/object;
- expiry;
- nonce.

Request authorization validates the entire set of referenced handles belongs to an allowed scope closure.

A valid handle for Project B is not authority inside a Project A command.

Staged worker directories expose only explicit job inputs, not parent/sibling project directories.

# GS. Irreversible-phase reauthorization

Before the final irreversible/high-impact step of:
- publish;
- external delete/takedown;
- paid dispatch above policy threshold;
- signing/release;
- destructive purge;
- account/workspace mutation

revalidate:
- command/decision still current;
- actor/agent authority;
- credential generation;
- provider account/workspace;
- rights/privacy/retention;
- safety-critical config policy;
- cost exposure;
- recovery epoch;
- manual/revision fences.

Prepared bytes/request objects are not perpetual authority.

# GT. API compatibility negotiation

Desktop/Core/worker/connector handshake exchanges:
- protocol family;
- exact version;
- min/max compatible versions;
- required capabilities/fields;
- optional extension namespaces.

Rules:
- unsupported command fails explicitly;
- missing required field never defaults to a permissive security state;
- old component cannot partially execute a newer command;
- compatibility mode may be read-only where mutation semantics are uncertain.

# GU. Scoped idempotency identity

Idempotency scope is not a naked user string.

Canonical identity includes:
- installation/deployment identity;
- command type;
- project/scope;
- actor/automation authority when relevant;
- recovery epoch where external side effects require it;
- explicit caller idempotency key.

Portable clone/import remaps namespace so an old key cannot collide with an unrelated operation in a new project/deployment.

# GV. Restore configuration reconciliation

Restore separates:
- project/domain state;
- convenience/runtime configuration;
- current forward security/trust/revocation policy.

After restore:
- newer trust-root revocations/security policy win;
- old proxy/provider/credential settings are revalidated;
- old feature flags cannot re-enable a now-blocked safety gate;
- external dispatch remains frozen until configuration reconciliation is complete.

# GW. Required sixth-wave authority tests

140. malicious deep-link path/URL/publish request;
141. double-encoded deep-link traversal;
142. hostile file association project/archive open;
143. capability namespace collision;
144. read-only capability attempting external mutation;
145. v1/v2 connector semantic mismatch;
146. duplicate JSON keys with conflicting security value;
147. unknown enum coercion attempt;
148. mid-command config/feature-flag change;
149. two concurrent migration processes;
150. mutable migration script swap after verification;
151. audit middle-event deletion/rewrite;
152. credential rotation while jobs queued/running;
153. cross-project opaque handle injection;
154. permission removal immediately before publication;
155. old UI/new Core and new UI/old Core negotiation;
156. idempotency-key reuse after project clone;
157. restore old config after newer trust revocation.

# GX. Encryption key hierarchy and recovery

Encrypted profiles separate cryptographic roles instead of one universal key:
- ROOT/RECOVERY WRAPPING KEY;
- WORKSPACE/PROJECT DATA-ENCRYPTION KEY;
- BACKUP WRAPPING KEY;
- SECRET-STORE KEY where applicable.

Each encrypted object/manifest binds:
- key_id;
- key_generation;
- algorithm/profile version;
- wrapping relationship;
- rotation state.

Rotation is resumable:
`ACTIVE_OLD → REWRAP/REENCRYPT_IN_PROGRESS → VERIFIED_NEW → RETIRE_OLD`.

A crash may leave mixed generations, but every object remains attributable/decryptable or explicitly UNRECOVERABLE.

Password-derived keys use a versioned approved KDF profile with recorded parameters. Backup health distinguishes 'bytes copied' from 'recovery material proven available'.

# GY. Package dependency solver and runtime isolation

Provisioner computes a dependency graph over package/runtime/model/tool requirements.

Rules:
- reject unsupported dependency cycles;
- detect incompatible version constraints before activation;
- resolve package source/registry identity, not package name alone;
- optional dependencies are exercised by capability health/certification before claiming capability readiness;
- isolated runtime environments are used where one connector's dependency upgrade could alter another connector.

Semantic compatibility/certification overrides semver labels.

# GZ. Canonical locale-independent representation

Canonical machine data is independent from UI locale.

Numbers:
- canonical decimal syntax uses '.' or typed numeric encoding;
- currency/unit semantics are explicit;
- localized comma/period grouping is presentation/import-adapter behavior only.

Dates/times:
- RFC3339/UTC or schema-declared legal timezone/calendar semantics;
- ambiguous human formats require explicit locale/schema.

Identifiers:
- locale-independent comparison;
- IDs never rely on display-name case folding;
- Unicode normalization is defined per field where equality requires it, otherwise original text is preserved.

# HA. Provider/model semantic fingerprint and reproducibility class

Capability certification stores an observed semantic fingerprint:
- provider/model/service identity;
- local package/model digest when available;
- request mapping and context/reference limits;
- parameter handling;
- observed rewrite/truncation/safety behavior where measurable;
- representative benchmark/evidence set;
- captured time and environment.

Material semantic drift marks certification `STALE/REVERIFY_REQUIRED` even if provider model name/version string did not change.

Generation provenance declares one reproducibility class:
- EXACT_LOCAL;
- VERSION_PINNED_BEST_EFFORT;
- CLOUD_BEST_EFFORT;
- NON_REPRODUCIBLE.

Seed/config values are evidence only and never overstate reproducibility.

# HB. Watermark, tracking metadata and content-provenance policy

Media inspection/release policy classifies where detectable:
- visible watermark;
- invisible watermark/fingerprint;
- private/tracking metadata;
- required provider attribution/provenance marker;
- signed content-credential/provenance records.

Deliverable policy chooses:
- PRESERVE;
- STRIP;
- REWRITE;
- BLOCK;
subject to provider terms, rights, privacy and intended destination.

Re-encoding/signing records provenance against the final deliverable bytes; source metadata alone is not sufficient.

# HC. Derived index generation isolation

Search/vector/embedding index generation identity includes:
- index schema/version;
- embedding/model identity + digest/version;
- tokenizer/preprocessing revision;
- authorization/privacy policy revision;
- source revision generation;
- environment/toolchain where material.

Incompatible vector spaces are not mixed in one ranking operation without a validated bridge/migration.

Index upgrades use shadow/rebuild/promotion semantics. Old generation remains queryable only under its compatible reader until retired.

# HD. Long-term event/archive decoder contract

Historical canonical formats are long-lived contracts.

For event/archive versions required for durable understanding, CineForge must either:
- retain a compatible decoder/migration chain; or
- normalize during archival to a durable self-describing archival representation with preserved semantics/evidence.

Compaction/storage-tiering may change representation but cannot silently discard semantically required fields.

Archive field criticality classes:
- OPTIONAL_ADVISORY;
- OPTIONAL_INERT;
- MANDATORY_SEMANTIC;
- MANDATORY_RIGHTS_PRIVACY.

A reader that cannot understand a mandatory field cannot mutate/release the project; safe read-only inspection may still be allowed.

# HE. Environment-bound benchmark/router evidence

Benchmark, quality and capacity evidence binds an environment fingerprint:
- hardware/GPU;
- driver/backend;
- OS/runtime;
- package/model digests;
- relevant connector/tool revision.

Material environment change marks dependent benchmark/router evidence `STALE` until revalidated.

Router may use stale evidence only for non-authoritative hints when policy explicitly permits it; it cannot present stale performance/quality numbers as current truth.

# HF. Reproducibility artifact retention

For selected approved/release/archive scopes, retention policy may preserve:
- exact local model/package artifact;
- runtime/connector package;
- lockfile/dependency manifest;
- workflow/graph definition;
- critical font/LUT/ICC/profile dependencies;
- build/toolchain identity;
- license/rights evidence permitting retention.

A package/model version string without retrievable immutable bytes is not considered reproducible.

Retention is constrained by license/storage/security policy; when exact retention is forbidden, archive records the resulting reproducibility limitation.

# HG. Required seventh-wave longevity tests

158. crash during encryption key rotation with mixed object generations;
159. encrypted backup restore with missing recovery wrapping material;
160. package dependency cycle/incompatible runtime constraints;
161. semver-compatible but semantically incompatible connector update;
162. localized decimal/date import ambiguity;
163. case/collation/Unicode normalization cross-platform equality;
164. provider semantic drift without model-name change;
165. identical seed produces different cloud output after provider change;
166. local package same version/different digest;
167. invisible watermark/tracking metadata release inspection;
168. content-provenance preservation through re-encode;
169. mixed embedding-model generations in one search index;
170. hardware change invalidates benchmark/router evidence;
171. future archive mandatory semantic field opened by older reader;
172. archive event version whose original decoder would otherwise be removed;
173. critical package registry disappearance after archive.

# HH. Semantic cache dependency completeness

A cache key is not prompt text + model name.

Cache identity/eligibility may include where semantically relevant:
- exact canonical input revisions;
- compiled context/prompt representation hash;
- provider/model/package/connector semantic generation;
- project media profile;
- style/voice/language/character/canon revisions;
- timeline/audio neighboring-context dependency;
- toolchain/algorithm version;
- rights/privacy/policy revision;
- destination/deliverable profile.

Two concepts are separate:
- STORED: bytes may remain physically cached;
- ELIGIBLE_FOR_REUSE: current policy/dependencies allow use.

Rights/privacy/canon change can make stored cache INELIGIBLE without immediately deleting bytes.

# HI. Derived-cache revocation fence

Derived representations include:
- thumbnails;
- proxies;
- waveforms;
- embeddings/vector index entries;
- preview transcodes;
- search/index projections;
- analysis/evaluator artifacts.

Revocation/deletion/privacy change immediately removes eligibility/visibility from authorized query/use projections.
Physical purge/rebuild may run asynchronously.

A stale cache cannot reintroduce an entity hidden by current policy.

# HJ. Proxy, review representation and master separation

Review/approval binds an exact representation revision.

Policy states which dimensions a proxy may prove.
Examples a lower proxy may prove:
- rough performance;
- edit rhythm;
- composition.

Examples often requiring final/master representation:
- fine visual defects;
- HDR/highlight behavior;
- true resolution/detail;
- final codec artifacts;
- final mix loudness/true peak;
- subtitle/font packaging;
- stream/channel metadata.

Release readiness never treats a proxy approval as universal proof of the master.

# HK. Canonical conform/timestamp mapping

VFR/CFR/frame-rate conversion/retime records an explicit mapping between source time and canonical rational timeline.

Rules:
- never accumulate floating point time by repeatedly adding frame durations;
- store rational/timebase semantics explicitly;
- source timestamp discontinuity is evidence, not silently smoothed;
- subtitle/dialogue/music dependencies reference canonical timeline positions/revisions;
- conform map is preserved for NLE round-trip/relink.

# HL. Audio working-rate, delay and mastering

Project/audio pipeline declares:
- working sample rate;
- channel layout/order;
- resampler/version when conversion occurs;
- encoder/mux delay/priming behavior where relevant.

Release master QC uses the exact final master bytes and validates:
- integrated loudness per target profile;
- true peak/headroom;
- clipping/non-finite samples;
- channel count/order/layout;
- sync/timing;
- codec/container properties.

Platform/codec profiles may require additional headroom because lossy transcode can increase true peak.

# HM. Color/HDR final-master verification

Final encoded stream is probed/decoded and validated for:
- color primaries;
- transfer function;
- matrix coefficients;
- full/limited range;
- bit depth/pixel format;
- HDR signaling/mastering metadata when relevant;
- actual decoded dimensions/frame rate.

Proxy transform lineage is recorded but does not prove master correctness.

# HN. Toolchain/backend provenance and reproducibility

Rendered/transcoded media provenance records:
- encoder/muxer/tool version and digest/package identity where available;
- hardware/software backend;
- significant explicit parameters;
- driver/runtime when output semantics can vary;
- source dependency manifest.

Artifact reproducibility class:
- BYTE_EXACT;
- ESSENCE_EQUIVALENT;
- VERSION_PINNED_BEST_EFFORT;
- NON_REPRODUCIBLE.

Hardware fallback is recorded as a semantic execution change when it can affect bytes/quality.

# HO. Destination compatibility and platform verification

A deliverable profile declares destination constraints:
- container/codec/profile/level;
- resolution/frame rate/bitrate policy;
- audio layout/loudness;
- subtitle/caption format;
- metadata/provenance requirements;
- maximum size/duration where applicable.

Preflight validates the final local master against this profile.

Where destination APIs/manual evidence allow, publication verification checks the processed/transcoded destination output rather than assuming upload success equals delivery correctness.

# HP. Localization/audio contextual dependency keys

Contextual media results such as:
- subtitles;
- dubbing;
- lip-sync;
- dialogue processing;
- ducking;
- ambience/music transitions

bind exact relevant revisions and neighboring timing/context.

Examples:
- localized text revision;
- voice identity/take;
- phoneme/timing representation;
- timeline revision;
- overlapping dialogue/music cue set;
- acoustic-space/mix profile.

An isolated source asset hash is insufficient when surrounding context affects output.

# HQ. Release lineage closure

ReleaseCandidate/Manifest computes a closed immutable dependency manifest from:
- exact timeline revision;
- selected picture/audio/caption/localization revisions;
- color/mastering profile;
- QC/review evidence;
- rights/privacy/provider-terms snapshots;
- provenance/toolchain;
- exact final master storage object digest.

Release-ready state is valid only for that closure.

If a different master/dependency generation is built, prior readiness/approval does not silently transfer.

# HR. Required eighth-wave media-master tests

174. cache prompt collision across different canon revision;
175. rights/privacy revocation while bytes stay cached;
176. stale vector/thumbnail visibility after deletion;
177. proxy approved while 4K master has fine artifact;
178. proxy/master color-transform mismatch;
179. long VFR→CFR conform sync drift;
180. 23.976↔24 rational retime over long-form duration;
181. repeated audio resampling drift/quality loss;
182. encoder delay/priming stem alignment;
183. final-master loudness/true-peak validation;
184. lossy transcode true-peak increase;
185. wrong channel-order metadata;
186. HDR metadata missing/wrong;
187. full/limited range mismatch;
188. hardware vs software encoder provenance;
189. FFmpeg/toolchain default-change regression;
190. destination profile/level rejection;
191. platform post-transcode broken subtitle/audio;
192. old music/lip-sync/audio cache after timing/context change;
193. final master digest built from different timeline than release readiness.

# HS. CI artifact chain-of-custody

A CI/release artifact is identified by more than name/path.

Promotion evidence binds:
- source repository identity;
- immutable source commit SHA;
- workflow path + workflow revision;
- run ID;
- job ID;
- matrix dimensions;
- runner trust class;
- producer GitHub App/workload identity;
- artifact digest;
- attestation/signature identity where required.

Privileged jobs:
- do not select artifacts only by human-readable name;
- do not execute arbitrary artifacts produced by untrusted PR runs;
- verify provenance before promotion/signing/publication.

# HT. CI permission/OIDC capability profile

Every workflow/job has an explicit capability profile.

Classes:
- SOURCE_READ
- CHECKS_WRITE
- CONTENTS_WRITE
- PR_WRITE
- PACKAGES_WRITE
- RELEASE_WRITE
- ENVIRONMENT_ACCESS
- OIDC_ID_TOKEN
- SIGNING_ACCESS
- DEPLOYMENT_ACCESS

Default:
- ordinary build/test: repository read and minimal check reporting only;
- untrusted/fork PR: no privileged secret/OIDC/write capabilities;
- release/sign jobs: narrowly scoped protected ref/event/environment.

Governance CI validates effective workflow permissions and flags broad implicit defaults.

# HU. Hermetic release closure

Release build resolves and records exact immutable:
- repository commit;
- submodule/LFS/object inputs;
- dependency lock/integrity;
- toolchain/compiler/runtime;
- bundled native sidecars;
- codegen inputs;
- environment certification fingerprint.

Security-critical release build does not fetch mutable “latest” tooling or executable dependencies during build unless the download itself is digest-pinned and policy-authorized.

# HV. Privileged workflow trigger validation

Privileged triggers such as:
- workflow_run;
- repository_dispatch;
- manual dispatch;
- schedule;
- release events

validate:
- actor/event trust;
- source repository/ref/SHA;
- payload schema;
- source workflow trust;
- artifact provenance;
- target environment/channel.

A privileged follow-up workflow does not execute source-controlled scripts/artifacts from an untrusted PR merely because the follow-up YAML is trusted.

# HW. Installer/updater elevation boundary

Elevated installer/updater process:
- runs verified absolute-path binaries/helpers only;
- uses protected private staging;
- validates helper/package digests before elevation and again as needed before execution;
- applies safe DLL/library search configuration;
- does not inherit arbitrary user CWD, PATH or plugin/module search state;
- revalidates final target handle/path/volume against junction/reparse TOCTOU;
- avoids executable helpers in low-privilege writable shared temp paths.

Elevation is a security boundary, not a convenience implementation detail.

# HX. Versioned immutable installation and atomic activation

Installed app/runtime versions live in versioned immutable directories.

Update:
1. download;
2. verify signature/digest;
3. stage complete new version;
4. run compatibility/preflight;
5. drain active owner/processes;
6. health check staged version where possible;
7. atomically switch active-version pointer/launcher state;
8. start/reconcile;
9. only later garbage-collect superseded versions under protection rules.

Never mix partial files from old and new versions in one active directory.

# HY. Signed update anti-rollback and channel identity

Update manifest binds:
- product ID;
- update schema version;
- channel;
- release/version;
- release security epoch;
- OS/platform/architecture;
- artifact digest/size;
- signer key ID;
- minimum compatible app/schema;
- minimum allowed security epoch where policy requires;
- freshness/expiry/timestamp evidence.

Clients pin allowed channel policy.
A validly signed older vulnerable manifest is not automatically accepted.

Emergency downgrade requires a separately authorized signed recovery policy with explicit impact.

# HZ. Atomic release publication identity

Release registry key:
`product + channel + platform + architecture + semantic/build version`.

Publication acquires a release lease/atomic registry operation.

If the key already exists:
- same digest + compatible metadata => idempotent;
- different digest => CRITICAL_RELEASE_IDENTITY_CONFLICT.

Never overwrite two distinct binaries under one canonical release identity.

# IA. Installer/package ownership graph

Installed component records:
- package/component identity;
- installation owner(s);
- version;
- path/root;
- protection/reference leases;
- projects/runtimes that require it;
- uninstall eligibility.

Uninstall/remove is graph-aware and cannot delete a component still required by another active installation/runtime/project.

# IB. Canonical release identity manifest

One immutable release manifest drives all user/build/release surfaces:
- product version;
- build number/security epoch;
- source commit;
- package/app version;
- installer filename;
- binary metadata version;
- updater manifest version;
- SBOM/provenance IDs;
- artifact digests;
- channel/platform/arch.

CI verifies generated surfaces agree with the canonical manifest.

A version mismatch is a release-blocking identity defect.

# IC. Release evidence retention

Release-critical evidence retention policy covers:
- workflow/run provenance;
- artifact digests/attestations;
- SBOM;
- signing/timestamp evidence;
- release manifest;
- required test summary;
- environment/toolchain fingerprint.

Retention outlives ordinary ephemeral PR artifacts sufficiently for incident response and long-term release verification.

# ID. Required CI/CD and installer tests

158. third-party action immutable-pin enforcement on privileged workflow;
159. OIDC accidentally enabled on ordinary PR job;
160. untrusted workflow_run artifact consumption attempt;
161. same-name artifact from wrong run/matrix dimension;
162. artifact byte mutation before signing;
163. wrapper/installer content mutation after inner executable signing;
164. signed old update replay against Stable client;
165. Beta→Stable manifest/channel confusion;
166. branch movement after release SHA selection;
167. elevated installer DLL/PATH/CWD hijack attempt;
168. junction swap of privileged install target;
169. AV quarantine during staged update before activation;
170. rollback after schema/config/service partial update;
171. duplicate release-version publication with different digest;
172. signing/timestamp outage cannot silently publish unsigned Stable release;
173. renewed signing key dual-trust transition;
174. release built from contaminated persistent runner;
175. release artifact evidence after ordinary CI artifact expiry.


# IE. AI model artifact trust classes

Every model artifact declares one trust/execution class:
- PASSIVE_WEIGHTS
- SERIALIZED_CODE_CAPABLE
- NATIVE_OPS
- REMOTE_CODE_REQUIRED
- COMPILED_ENGINE

Examples:
- safetensors-like passive tensors may qualify as PASSIVE_WEIGHTS after parser validation;
- pickle/TorchScript/custom Python loader is executable-capable;
- custom CUDA/ONNX/TensorRT op is NATIVE_OPS/COMPILED_ENGINE;
- `trust_remote_code`-style behavior is REMOTE_CODE_REQUIRED.

Rules:
- executable classes are governed as code/packages, not harmless media;
- loader selection is based on certified artifact class, not filename extension alone;
- executable model artifacts run in isolated managed runtime with package provenance/signature/license policy;
- untrusted project-local model code never inherits production credentials/filesystem/network by default.

# IF. Model semantic execution fingerprint

A model execution fingerprint contains:
- weight/content digest;
- base model identity/revision;
- tokenizer digest/version;
- chat/prompt template revision;
- ordered adapter/LoRA identities;
- quantization profile;
- preprocessing profile;
- inference backend/provider;
- runtime/toolchain version;
- GPU/driver compatibility class where relevant.

Routing, benchmark, QC and reproducibility evidence record this fingerprint.
A display label such as “Wan 2.x” or “Qwen” is never sufficient identity.

# IG. Adapter/base-model compatibility

Adapter package declares:
- compatible base model fingerprint/family;
- required tensor/key schema;
- tokenizer/template compatibility where relevant;
- ordered application/merge requirements;
- precision/quantization constraints;
- license/rights restrictions.

Activation fails closed on incompatible base/ordering/shape.
Two adapters with same human name remain distinct by package/content identity.

# IH. Compiled inference engine certification

Compiled engines bind:
- source model fingerprint;
- GPU architecture/device capability;
- driver/runtime;
- compiler/builder;
- precision/calibration;
- backend/plugin/custom-op identities.

Environment mismatch transitions the engine to REVALIDATION_REQUIRED or REBUILD_REQUIRED.
It does not remain READY solely because bytes load.

# II. Model legal eligibility

Model/package state uses independent axes:
- technical installation/health;
- trust/executable class;
- license/rights eligibility;
- privacy/egress eligibility;
- benchmark/certification state.

A technically healthy cached model may be legally BLOCKED.
License/model-card/terms snapshots are versioned and can invalidate future routing/release eligibility without deleting historical evidence.

# IJ. Strict model-generated action boundary

Model-generated tool/action proposals are untrusted outputs.

Before any action:
1. strict schema decode;
2. duplicate-key/unknown-enum/size/depth checks;
3. capability/effect-class validation;
4. project/actor/task handle-scope validation;
5. normal typed Command planning;
6. policy/rights/privacy/cost/resource/authority gates.

No model/provider output directly invokes shell, CLI, MCP, browser, API, publication or destructive action merely because it resembles a tool call.

# IK. Embedding/vector index generation identity

Derived semantic-search/vector index records:
- source project/privacy scope;
- source entity/revision manifest;
- embedding model semantic fingerprint;
- preprocessing/chunking revision;
- index library/schema/backend version;
- creation policy/recovery epoch.

A changed model/preprocessor invalidates affected index generation.
Old index may remain historical but cannot silently serve as current retrieval truth.

# IL. Hermetic model worker and activation state

Model worker launch follows privileged-worker environment rules plus:
- user site-packages disabled unless managed;
- project CWD not on module/plugin/library search path;
- verified native library paths;
- controlled model cache roots;
- explicit network policy;
- no remote-code loading outside certified package policy.

Model activation:
`DISCOVERED → DOWNLOADED → DIGEST_VERIFIED → MANIFEST_VALIDATED → RUNTIME_COMPATIBLE → HEALTH_TESTED → CERTIFIED_READY`.

Failure/OOM/crash leaves a non-ready state.

# IM. Model residency/resource scheduler

Model residency consumes schedulable resources:
- VRAM;
- RAM;
- worker/process slot;
- warm-cache budget;
- load/unload bandwidth/time.

Residency states:
- NOT_LOADED
- LOAD_RESERVED
- LOADING
- RESIDENT
- EVICTING
- UNLOAD_VERIFY
- NOT_RESIDENT
- DEGRADED
- QUARANTINED

Scheduler:
- reserves residency resources with headroom;
- prevents uncontrolled multi-model thrash;
- distinguishes installed vs resident vs usable;
- revalidates physical VRAM release after crash/unload where possible;
- may pin high-value model only within configured resource budget.

# IN. AI model/runtime required tests

176. pickle/code-capable checkpoint cannot load through passive-weight path;
177. remote-code model requires executable-package approval;
178. custom native op identity mismatch;
179. compiled engine moved to incompatible GPU/driver;
180. tokenizer/template revision change invalidates execution fingerprint;
181. wrong LoRA/base-model pairing;
182. quantized vs unquantized benchmark identities remain distinct;
183. model cache filename swap with wrong digest;
184. interrupted/corrupt model download;
185. license eligibility changes while cached model remains installed;
186. model-generated oversized/malformed tool call;
187. model-generated tool call requesting higher effect class than task permits;
188. embedding model switch invalidates old vector index;
189. project-local Python module cannot shadow managed runtime dependency;
190. user-site/native DLL search hijack blocked;
191. model OOM during activation cannot advertise READY;
192. concurrent model residency requests cannot overcommit VRAM;
193. unload/crash reservation reconciliation;
194. privacy-sensitive job uses isolated untrusted-plugin process.


# IO. Worker process-tree ownership

A job attempt owns an OS process tree, not just a root PID.

Worker process identity records:
- attempt ID;
- worker/runtime trust profile;
- root process identity;
- process-tree/container identity;
- Core/session/recovery epoch;
- resource reservation/fencing token.

On Windows, prefer Job Object or an equivalent process-tree containment primitive where compatible.

Required semantics:
- root assigned to containment before untrusted work;
- child/grandchild processes remain in owned tree;
- breakaway denied unless trusted profile explicitly requires and justifies it;
- process resource usage can be attributed to attempt;
- app/worker shutdown closes or kills the owned tree.

An attempt cannot report CLEANLY_STOPPED solely because the root PID exited.

# IP. Deny-by-default process inheritance

Launcher constructs a minimal inheritance set.

Default non-inheritable:
- Core DB/file handles;
- secure credential handles/tokens;
- unrelated pipes/events/mutexes;
- browser/session handles;
- project/library directory handles;
- signing/update handles;
- network listener handles.

Environment is allowlisted/minimized.
Worker child processes inherit only worker-scoped environment/handles.

# IQ. Worker OS authority profiles

Profiles:
- TRUSTED_MEDIA_TOOL
- MANAGED_MODEL_RUNTIME
- UNTRUSTED_PLUGIN
- BROWSER_AUTOMATION
- PRIVILEGED_INSTALLER

Each profile defines:
- filesystem read/write roots;
- network policy;
- device/capture access;
- desktop/clipboard interaction;
- process-spawn/shell capability;
- elevation/service/persistence capability;
- credential visibility;
- Core RPC capability;
- native-plugin allowance.

UNTRUSTED_PLUGIN defaults:
- no elevation/admin;
- no service/task/startup persistence;
- no arbitrary shell/browser open;
- no browser-profile/credential roots;
- no writable canonical project/library root;
- staged inputs + attempt-local writable outputs only;
- network/device/desktop denied unless capability explicitly grants.

# IR. Pre-execution containment order

Containment is established before executable code starts.

Launch order:
1. create private attempt roots with final ACL;
2. allocate process-tree/container identity;
3. build sanitized environment;
4. configure filesystem/network/device policy;
5. open only required inheritable handles;
6. spawn suspended/pre-contained where platform mechanism requires;
7. attach/verify containment;
8. begin executable work.

“Launch first, sandbox afterward” is not acceptable for untrusted code.

# IS. Cancellation escalation and verification

Process stop state:

```text
RUNNING
→ CANCEL_REQUESTED
→ GRACEFUL_STOP_WAIT
→ TERMINATE_REQUESTED
→ KILL_TREE
→ VERIFY_GONE
→ STOPPED_CONFIRMED
```

Failure:
- PROCESS_TREE_UNRESOLVED
- RESOURCE_RELEASE_UNCONFIRMED
- QUARANTINED_RUNTIME

Rules:
- each phase has bounded timeout;
- final state requires process-tree disappearance or explicit unresolved quarantine;
- GPU/browser/profile/resource reservations are not released optimistically when physical ownership is uncertain;
- partial outputs remain staging/unverified.

# IT. Per-attempt filesystem namespace

Each attempt receives:
- immutable/staged input root;
- writable output staging root;
- private temp/cache root where practical;
- explicit scratch quota;
- cleanup/recovery identity.

No two attempts share one writable temp root unless the tool's certified semantics require it and policy provides serialization.

Finalization:
- resolve final handles;
- reject reparse/hardlink escape;
- verify ACL/ownership;
- hash/decode;
- move/copy into managed immutable storage.

# IU. Child I/O and log backpressure

Worker stdout/stderr/control channels use:
- bounded buffers;
- continuous asynchronous draining;
- per-attempt byte/rate quota;
- structured truncation/sampling;
- log disk quota;
- backpressure-safe protocol.

A worker that exceeds output policy may be throttled, truncated, terminated or quarantined according to profile.
Unbounded stdout must not deadlock parent or fill system disk.

# IV. Spawn/shell capability separation

Direct process execution and shell execution are distinct capabilities.

Typed CLI contract:
- executable path is verified/absolute;
- argv is typed;
- shell expansion disabled by default.

Invoking:
- cmd.exe;
- powershell;
- shell=True;
- system browser/open;
- arbitrary interpreter eval

requires an explicit higher-risk capability and policy.

A plugin cannot obtain shell authority merely because its parent worker can launch one certified executable.

# IW. Residual native-code containment boundary

Application-level same-user process isolation reduces accidental/malicious reach but is not a perfect security boundary against arbitrary hostile native code.

High-security deployment may require:
- separate low-privilege OS account;
- restricted token/AppContainer-like isolation;
- container/VM;
- no untrusted native plugins;
- stricter network/device policy.

Security documentation must distinguish these stronger modes from normal worker isolation.

# IX. Required process isolation tests

213. parent exits while grandchild remains alive;
214. breakaway-from-container attempt;
215. shell spawn from ordinary CLI capability;
216. inherited privileged file/credential handle probe;
217. environment secret/module-search inheritance probe;
218. stdout/stderr pipe flood/deadlock;
219. log disk quota exhaustion attempt;
220. network socket before executable start policy activation;
221. browser/system URL launch from untrusted plugin;
222. startup/service/scheduled-task persistence attempt;
223. arbitrary device/capture access from untrusted plugin;
224. project/library/browser-profile filesystem probe;
225. cancellation escalation with hung native call;
226. GPU context/resource-release verification after kill;
227. per-attempt temp/output collision;
228. reparse/ACL sabotage before output finalization;
229. child survives Core/UI shutdown;
230. direct privileged Core RPC attempt from untrusted worker.


# IY. Depiction instance model

A logical Character is not the same as every visual occurrence of that character.

## depiction_instances
Conceptual fields:
- depiction_instance_id
- logical_character_id
- shot_revision_id
- occurrence_type:
  DIRECT | REFLECTION | PHOTO | SCREEN_MEDIA | CLONE | TIME_BRANCH | BODY_DOUBLE | STUNT | OTHER
- performer/source identity nullable
- visual_identity_revision
- state_variant_ref
- visible_from_internal_time
- visible_to_internal_time
- transform/reflection/nested-media metadata
- lip_sync_applicability
- body_performance_applicability
- identity_qc_profile
- rights/provenance refs

Multiple depiction instances may reference the same Character simultaneously.

Similarity evidence never creates/merges character identity.

# IZ. Performer/source vs depicted character

Performance provenance separates:
- logical depicted Character;
- body performer/body double/stunt source;
- face source/face replacement source;
- voice performer/source;
- motion/mocap performer;
- transformation/compositing chain.

Continuity/canon generally binds depicted Character.
Consent/rights/provenance may bind performer/source identities independently.

This supports:
- one performer playing two characters;
- body double representing one character;
- face/voice replacement;
- synthetic performer sources.

# JA. Intra-shot continuity timeline

A Shot may have temporal continuity structure:

```text
START_BOUNDARY
→ state/event/keyframe*
→ END_BOUNDARY
```

Temporal continuity state may include:
- character position/posture/gaze;
- appearance/disguise/makeup/injury;
- costume wetness/damage;
- prop possession/quantity/hand attachment;
- environment door/light/object state;
- contact/action phase;
- relevant story fact transitions.

A single static shot continuity snapshot is only valid for shots whose required state does not change materially inside the shot.

Generation strategy receives:
- start constraints;
- required transitions/events;
- end constraints.

QC can evaluate temporal order rather than only frame-independent presence.

# JB. Cross-shot boundary continuity

Boundary record relates one shot end to another shot start.

Possible relations:
- MATCH_ACTION
- SCREEN_DIRECTION
- GAZE_EYELINE
- POSITION
- PROP_ATTACHMENT
- COSTUME_APPEARANCE
- ENVIRONMENT_STATE
- MOTION_VECTOR
- CUSTOM

Boundary evidence binds exact reviewed representations and temporal positions.

CreativeException can explicitly waive/override a relation.

# JC. Story/internal/presentation/source time separation

CineForge maintains distinct mappings:
- STORY_TIME / causal order;
- SHOT_INTERNAL_TIME;
- PRESENTATION_TIMELINE_TIME;
- SOURCE_MEDIA_TIME.

Rules:
- edit reorder changes presentation order, not automatically story chronology;
- retime changes presentation duration but not necessarily causal event duration;
- flashback/flashforward has explicit mapping;
- continuity facts resolve through story/internal time;
- audio/music/subtitle sync resolves through presentation/source mapping as appropriate.

No subsystem infers story chronology merely from current edit order.

# JD. Narrative truth/viewpoint scopes

Continuity/story facts declare truth/viewpoint scope:
- OBJECTIVE_CANON
- CHARACTER_BELIEF
- DREAM_HALLUCINATION
- UNRELIABLE_NARRATION
- ALTERNATE_BRANCH
- MEMORY_FLASHBACK
- FLASHFORWARD
- OTHER_TYPED_SCOPE

A state contradiction across scopes is not automatically a canon conflict.

Promotion from subjective/alternate scope to objective canon requires explicit command/authority.

# JE. Vocal performance occurrence timeline

Voice identity package defines stable identity.
Actual vocal occurrences are temporal performance events.

Event fields:
- logical character or ensemble/group identity;
- exact dialogue/text/span or NONVERBAL event;
- language segment(s);
- performance mode:
  SPEECH | WHISPER | SHOUT | CRY | SING | CHANT | NONVERBAL | OTHER
- shot/scene/presentation timing;
- visible/on-screen/off-screen state;
- lip-sync applicability;
- selected voice/performance binding;
- acoustic-space/treatment;
- source/generated/ADR provenance.

Multiple vocal events may overlap in time.

# JF. Localized/overlapping dialogue collision

Localization/dub validation considers the whole temporal neighborhood, not each line independently.

Detect:
- overlap with another speaker;
- collision with action/shot cut;
- unacceptable duration stretch;
- lip-sync feasibility;
- music/SFX masking where policy cares.

Allowed repair strategies may include:
- rephrase translation;
- alternate performance;
- retime within allowed window;
- edit adjustment;
- intentional overlap approval.

# JG. Sub-line ADR and vocal-span replacement

ADR replacement may target:
- whole line;
- phrase;
- word;
- nonverbal span.

Replacement records exact source and target time/text span and crossfade/edit relationship.
Approval of one replaced span does not silently approve untouched/other replacement spans.

# JH. Identity exclusivity and look-alike policies

Character identity policy may specify:
- visual exclusivity for hero identity;
- approved twin/look-alike relations;
- allowed simultaneous clone/duplicate depictions;
- reflection/photo/screen exceptions;
- background similarity warning thresholds.

QC classifies:
- expected second depiction;
- approved look-alike/twin;
- unintended hero duplication;
- uncertain similarity.

Similarity is evidence only, never canonical identity.

# JI. Required cinematic continuity tests

256. logical Character with simultaneous direct/reflection depictions;
257. one performer source mapped to two Characters;
258. body-double depiction with later face replacement;
259. mask/disguise transition inside shot;
260. temporal prop handoff/quantity change;
261. costume wetness/damage transition;
262. environment door/light state transition;
263. left/right hand attachment transition;
264. shot-end/start match-on-action evidence;
265. screen-direction boundary relation;
266. story-time vs edit-reordered presentation;
267. flashback/alternate-branch truth scopes;
268. offscreen dialogue with no lip-sync requirement;
269. overlapping speakers + nonverbal events;
270. multilingual/code-switch vocal event;
271. singing vs speaking binding;
272. sub-line ADR;
273. localized duration collision;
274. twin/look-alike policy vs accidental duplicate hero;
275. time-loop simultaneous state variants.


# JJ. Observability as governed egress

Observability surfaces:
- logs;
- traces;
- metrics;
- crash diagnostics;
- diagnostic bundles;
- remote health probes;
- telemetry exporters

are subject to normal privacy/egress policy.

Each observability record/payload carries where applicable:
- project/studio scope;
- sensitivity class;
- telemetry policy revision;
- producer identity;
- retention class;
- export eligibility.

LOCAL_ONLY/project-restricted data is not exported merely because the subsystem is diagnostics.

# JK. Telemetry producer trust and freshness

Telemetry sample fields:
- producer_component_id;
- worker/runtime identity;
- deployment_instance/recovery_epoch;
- control/capacity epoch where relevant;
- source_class:
  LOCAL_OBSERVED | PROVIDER_CLAIMED | DERIVED | SYNTHETIC_PROBE;
- sampled_at;
- freshness_deadline;
- schema version.

Scheduler/Flow Governor:
- prefer local measured resource state over provider/self-claimed state where appropriate;
- reject stale samples;
- do not infer healthy from absence of new errors;
- do not let one untrusted worker redefine global capacity.

# JL. Metrics label/cardinality discipline

Metric instruments have fixed approved label schemas.

Forbidden by default as metric labels:
- free-form filename/path;
- prompt/content;
- raw error string;
- arbitrary URL;
- user-supplied string;
- per-job/entity IDs where cardinality is unbounded.

High-cardinality correlation belongs in scoped structured logs/traces, not bounded metric dimensions.

Cardinality budget exhaustion degrades metric detail instead of crashing/allocating without bound.

# JM. Bounded non-blocking telemetry pipeline

Telemetry pipeline uses:
- bounded in-memory queue;
- bounded optional disk spool;
- priority classes;
- drop/sample policy;
- exponential backoff/jitter;
- disk/network quota;
- exporter circuit breaker.

It must not:
- hold canonical DB writer transaction;
- hold resource/merge/command lock;
- block media worker completion indefinitely;
- grow spool without bound.

Exporter failure is visible health degradation but not equivalent to canonical task failure unless an explicitly mandatory audit/export policy says so.

# JN. Durable audit/security channel

Audit/control/security events are distinct from ordinary operational logs.

Required audit evidence:
- not sampled;
- not discarded under ordinary log quota;
- append/durable according to command transaction rules;
- included in integrity checkpoint/audit;
- preservation-hold aware.

Logs may contain a reference to audit/event ID.
Reconstructing canonical state from best-effort log files is prohibited.

# JO. Trace/correlation context isolation

External trace/correlation inputs are attributed untrusted metadata.

On ingress:
- sanitize traceparent/baggage;
- enforce length/count limits;
- never map external baggage to actor/project/permission scope;
- create a CineForge internal trace identity;
- store external IDs under provider/source namespace.

Internal trace context crossing project boundaries requires explicit Core-generated scope propagation.

# JP. Health probe effect and quota policy

Health probes declare effect class:
- READ_ONLY_LOCAL
- READ_ONLY_EXTERNAL
- PAID_EXTERNAL
- MUTATING_EXTERNAL
- AUTH_INTERACTIVE

Probe also declares:
- data sensitivity;
- account/workspace;
- expected quota/rate cost;
- safe synthetic fixture;
- cadence/backoff.

Default continuous health uses non-sensitive synthetic/read-only mechanisms.
Paid/mutating/auth-interactive checks are not silently run as frequent background probes.

# JQ. Telemetry policy invalidation

Exporter/worker binds telemetry privacy/egress policy revision.

When policy becomes stricter:
1. stop newly disallowed export;
2. invalidate worker/exporter policy cache;
3. re-evaluate queued/spooled payloads;
4. drop/quarantine noncompliant pending payloads;
5. record the policy transition without leaking payload contents.

Policy loosening does not automatically export historical quarantined payloads without explicit eligibility rule.

# JR. Telemetry redaction boundary

Redaction happens before generic logging/export formatting where possible.

Sensitive classes include:
- credentials/tokens/cookies;
- signed URLs/query secrets;
- private endpoint details;
- raw prompts/script/media text when policy restricts;
- absolute user paths/usernames;
- provider raw response fields marked sensitive.

Pseudonymized/hash values remain personal/sensitive if dictionary re-identification is plausible.

# JS. Monotonic observability timing

Use:
- monotonic clock for local elapsed duration;
- sample generation/reset ID for counters;
- event sequence for canonical ordering;
- wall-clock only for display/external correlation.

Counter reset/restart must not be interpreted as negative work/throughput without generation context.

# JT. Progress evidence

Worker heartbeat and semantic progress are separate.

Progress evidence may include:
- new verified bytes/frames/samples;
- attempt phase transition;
- provider job status transition;
- output/checkpoint creation;
- completed subtask/item count.

A live heartbeat with no semantic progress beyond task-specific threshold moves to ALIVE_STALLED and triggers diagnosis rather than infinite lease extension.

# JU. Observability required tests

296. trace contains bearer token/signed URL;
297. LOCAL_ONLY project with external telemetry collector configured;
298. user filename as metric label cardinality attack;
299. provider/worker fake capacity sample;
300. monitor process dies while last sample is HEALTHY;
301. exporter offline spool bound and recovery burst;
302. external telemetry env inherited by child worker;
303. external trace baggage attempts project-scope injection;
304. sampled operational log loss while durable audit survives;
305. preservation hold prevents required audit deletion;
306. telemetry policy tightening invalidates pending spool;
307. paid/mutating health probe classification;
308. synthetic health fixture contains no project media;
309. monotonic duration survives wall-clock jump;
310. metric counter reset/generation;
311. duplicate telemetry delivery does not double-count authoritative cost;
312. stale Capacity epoch metrics rejected;
313. fake heartbeat with no semantic progress;
314. raw provider error redacted before general log sink.



# HS. CI/release artifact provenance

Privileged artifact identity binds:
- repository identity;
- workflow path/revision;
- workflow run ID + attempt;
- source commit/tree;
- producer App/check identity;
- runner trust class;
- artifact storage ID;
- content digest;
- build manifest/attestation.

Artifact display name is presentation only.

A privileged workflow must not promote an untrusted/fork artifact merely because its name/path matches.

# HT. GitHub Actions trust baseline

Production CI/release policy:
- third-party Actions pinned to immutable commit SHA;
- explicit least-privilege `permissions`;
- `id-token: write` only for the exact job needing OIDC;
- controlled action upgrades through governance;
- untrusted PR code never receives privileged release/signing identity.

Mutable tags are convenience only for discovery, never release trust.

# HU. Release identity and anti-rollback

Release identity is one immutable tuple:
- release epoch;
- semantic version/build ID;
- source commit/tree;
- package digests;
- release manifest hash;
- signing key IDs.

Rules:
- branch names do not identify release bytes;
- moved/recreated tags are detected;
- installer/updater refuses policy-forbidden downgrade even if old signature is valid;
- differential patch binds exact base digest and expected final digest.

# HV. Signed update manifest closure

Signed update manifest binds:
- package digest + size;
- platform/architecture;
- allowed base versions/hashes;
- required schema compatibility;
- key ID/trust policy;
- minimum allowed version/revocation floor;
- bootstrap/updater minimum compatible version.

Transport/CDN/mirror is untrusted.
Digest trust comes from the signed manifest, not a hash fetched from the same mirror.

# HW. Installer/elevation transaction

Elevated installer operates from trusted staged bytes and managed working directory.

It journals ownership/compensation for:
- installed binaries;
- services/tasks;
- registry/protocol/file associations;
- runtimes/packages;
- updater/bootstrapper;
- shared vs per-install components.

Rules:
- no helper execution from user-writable temp/current directory;
- loader/plugin search path hardened;
- user media/project/library roots are outside disposable app-binary root;
- uninstall removes only owned/refcount-safe components;
- repair preserves/reconciles newer user/security configuration.

# HX. Signing authorization boundary

Signing service accepts an approved **release manifest + exact digest**, not arbitrary caller-provided bytes.

It revalidates:
- release source commit;
- build/artifact attestation;
- required CI/security gates;
- trigger/actor/environment authority;
- signing key purpose/epoch/state.

Signature response binds exact digest/key/timestamp evidence.

# HY. Final-byte signature closure

No signed executable/package is mutated after the signature-covered byte boundary.

When packaging is layered:
- inner binaries may be signed;
- outer installer/package may also be signed;
- manifest records both layers and hashes.

Updater verifies final staged bytes before activation.

# HZ. Updater/bootstrapper root of trust

Updater/bootstrapper is separately versioned and recovery-tested.

It:
- validates signed update manifest;
- enforces anti-rollback/revocation;
- stages replacement atomically;
- preserves a known-good recovery path;
- cannot be replaced by an unverified package merely because the main app requests it.

A failed main-app update must not destroy the only component capable of recovery.

# IA. Hermetic release build

Release inputs are declared and pinned:
- compiler/toolchain;
- package lock/transitives;
- runtime/model/tool downloads;
- build scripts;
- environment-sensitive options.

No release path depends on undeclared developer-global state or unpinned `latest` downloads.

Where full bit reproducibility is impossible, policy records the expected nondeterminism and still requires content/provenance attestation.

# IB. Packaged-content SBOM and legal closure

Release compliance is derived from actual packaged contents.

Gate compares:
- file/package inventory;
- native/runtime dependencies;
- SBOM;
- licenses/notices;
- source dependency manifest;
- approved exceptions.

Source-tree SBOM alone is insufficient.

# IC. Release artifact privacy/symbol handling

Public/release artifacts are scanned for:
- credentials/tokens;
- private URLs;
- local usernames/source paths;
- confidential fixtures/media;
- debug-only configuration.

Debug symbols are a separately classified artifact:
- bind exact build ID/hash;
- have explicit storage/access/retention;
- are not automatically public.

# ID. Release trigger and protected environment authority

Release execution validates:
- allowed trigger/source;
- source branch/tag/release state;
- actor/automation authority;
- GitHub Environment/rules identity when used;
- current trust/governance policy;
- exact immutable release commit.

Missing/renamed/degraded protection becomes BLOCKED/ASSURANCE_UNAVAILABLE, not implicit approval.

# IE. Offline install/update revocation policy

Offline verification distinguishes:
- cryptographic signature validity;
- locally known revocation/trust floor;
- freshness of revocation knowledge.

Security profile may:
- block packages older/below floor;
- allow with explicit stale-revocation warning;
- require online freshness for sensitive deployments.

Offline mode must not claim revocation freshness it cannot observe.

# IF. Installer/update lifecycle

States:
`PLANNED → PREFLIGHT → STAGED → VERIFIED → WAITING_SAFE_BOUNDARY → INSTALLING → ACTIVATING → HEALTH_CHECK → ACTIVE`

Failure/recovery:
- FAILED_PREFLIGHT
- FAILED_SIGNATURE
- FAILED_INSTALL
- PARTIAL_SYSTEM_CHANGES
- COMPENSATING
- ROLLBACK_AVAILABLE
- RECOVERY_BOOTSTRAPPER
- SAFE_MODE

“Rollback available” is exposed only when installer journal + schema compatibility prove it.

# IG. Required supply-chain tests

158. mutable third-party Action tag compromised;
159. PR workflow accidentally receives OIDC/write permission;
160. privileged workflow_run consumes fork artifact;
161. artifact-name collision across workflow runs;
162. release branch advances after approval;
163. moved/recreated release tag;
164. stale signed manifest replay;
165. differential patch wrong-base application;
166. CDN serves revoked/stale package;
167. elevated installer DLL search hijack;
168. elevated helper from writable temp;
169. power loss mid installer transaction;
170. uninstall with shared runtime/refcount;
171. uninstall with user media under app path;
172. signing service arbitrary-byte request;
173. artifact swapped between build and signing;
174. version mismatch binary/tag/manifest;
175. SBOM vs actual packaged contents mismatch;
176. public debug symbols leak paths/secrets;
177. updater bootstrap corruption/recovery;
178. release trigger from untrusted source;
179. offline known-bad package with stale revocation knowledge;
180. undeclared/unpinned release toolchain input.



# IH. Privacy purge closure and completion barrier

A privacy/delete/purge request owns a closure over:
- canonical entities/revisions;
- derived proxies/thumbnails/waveforms/transcripts;
- semantic/FTS/vector indexes;
- semantic caches;
- temp/staging;
- learning/failure/golden datasets;
- diagnostics/log references according to retention;
- portable archives/backups according to policy/hold;
- external exposure records.

Purge states:
`REQUESTED → TOMBSTONED → CANONICAL_REMOVED → DERIVED_CLEANUP → RETENTION_RECONCILIATION → EXTERNAL_RECONCILIATION → COMPLETE_TO_POLICY_SCOPE`

The strongest user-facing wording is shown only after the corresponding barrier.

# II. Forward deletion/revocation journal

Disaster restore must not resurrect later privacy/security decisions.

Maintain a protected forward journal for:
- purge tombstones;
- rights revocations;
- credential/key revocations;
- package/update minimum-version floors;
- critical trust/security policy floors.

Journal entries have monotonic sequence and durable checkpoint outside ordinary restorable project snapshot where configured.

Recovery applies the forward journal before recovered content becomes active.

# IJ. Embedding/vector/semantic-index security scope

Embeddings are sensitive derivatives.

Every vector/index entry binds:
- studio/project/shared-scope ID;
- source entity/revision;
- privacy/rights class;
- embedding/index model + version;
- generation epoch;
- retention/purge lineage.

Search/RAG query requires a scope token; index implementation must not retrieve outside authorized scope and “filter later” as the primary isolation mechanism.

Cross-project/shared retrieval requires explicit shared collection authority.

# IK. Model/session isolation

Inference runtimes declare session isolation class:
- STATELESS;
- RESETTABLE;
- PROCESS_ISOLATED;
- PROVIDER_MANAGED_UNKNOWN.

On project/privacy boundary:
- reset conversation/KV/session state where applicable;
- rotate project/job cache namespace;
- clear transient reference state;
- prefer process isolation for untrusted custom nodes/plugins/high-sensitivity work.

A runtime unable to prove reset semantics cannot be reused across restricted scopes under strict privacy policy.

# IL. Learning/training derivative governance

Training examples, fine-tuning datasets, adapters and trained checkpoints are first-class derivatives with lineage and rights.

Revocation handling may include:
- exclude source from future training;
- quarantine dataset/model;
- rebuild/retrain;
- prohibit distribution/use;
- record that selective unlearning is unavailable/impractical.

Deleting source bytes is never represented as proof that a trained model no longer encodes influence from them.

# IM. Observability privacy plane

Logs/traces/metrics/crash diagnostics have explicit schemas and data classes.

Default production observability excludes raw:
- prompts;
- dialogue/script content;
- media bytes/previews;
- credentials/tokens;
- unnecessary full paths/project names.

Redaction/minimization happens before emission/storage, not only during later support-bundle export.

Retention/purge policy applies independently to observability stores.

# IN. Native notification privacy

Notification payload is derived from a trusted template plus sanitized args and a privacy profile:
- FULL_CONTENT;
- REDACT_ON_LOCK_SCREEN;
- GENERIC_ONLY.

Sensitive content never depends on OS lock-screen behavior alone.

Actionable notification carries DecisionRequest/entity ID + expected version and always revalidates state on click.

# IO. Backup vs ephemeral authentication

Project/system backup excludes live browser cookies/session tokens/worker secret leases by default.

If secure credential backup is supported, it is a separate explicit encrypted mechanism with:
- key/recovery policy;
- target security classification;
- import audit;
- reauth/fallback semantics.

Ordinary restore expects REAUTH_REQUIRED where secure material is unavailable.

# IP. Single Core/library writer ownership

Each writable CineForge library has:
- library/deployment identity;
- owner OS user/security context;
- Core ownership epoch;
- OS-level exclusive writer primitive;
- DB ownership record.

Startup:
1. acquire OS exclusive primitive;
2. open/validate library identity;
3. reconcile prior Core epoch;
4. become writer;
5. expose IPC endpoint.

A second UI connects to the existing Core; it does not start a second writer.

Updater/new Core cannot acquire writer authority until the prior Core is drained/terminated and ownership is reconciled.

# IQ. Archive immutability

Sealed archive/package bytes are immutable.

Viewing with a newer app:
- uses compatible decoder/read-only mode; or
- imports/copies to a new mutable working project.

No in-place schema migration, index write, metadata normalization or decoder “upgrade” is allowed against sealed archive bytes.

Derived preview/index output lives outside the sealed package and is disposable.

# IR. Consent/privacy generation epoch

Privacy/telemetry/cloud-consent policy has a generation number.

Queued external emissions store expected consent generation.

Immediately before transmission:
- resolve current consent/privacy generation;
- revalidate data class/destination;
- cancel/block stale queued emissions when policy tightened.

Turning off telemetry/cloud sharing affects queued-unsent work; it cannot erase already transmitted exposure.

# IS. External exposure ledger

Every outbound sensitive-data transfer records:
- project/data class;
- source revision/input closure;
- provider/account/workspace;
- purpose/job/command;
- timestamp;
- policy/consent generation;
- ProviderTermsSnapshot;
- known provider retention/deletion status.

The ledger survives local purge according to audit/privacy policy so the UI can truthfully explain external residual exposure.

# IT. Most-restrictive dependency privacy

A command's effective egress class is computed from the full input/dependency closure.

Default rule:
- effective permission is the most restrictive applicable requirement;
- project-level CLOUD_ALLOWED cannot override an input marked LOCAL_ONLY;
- provider-specific restrictions propagate through derived assets;
- explicit declassification/reclassification is a separate authorized audited command.

# IU. Temp/cache/project isolation

Per-job/project temp/cache roots are scope-bound.

On crash/startup reconciliation:
- identify stale temp by job/project;
- purge/quarantine according to policy;
- never expose another project's temp tree as a candidate input.

Model/runtime package cache is separate from project-content cache.

# IV. Required privacy/isolation tests

181. purge project while thumbnails/vector index still contain data;
182. restore backup after later privacy purge;
183. vector query attempts cross-project retrieval;
184. local model session reused across projects;
185. revoked training example remains in fine-tuned checkpoint;
186. telemetry disabled with queued batch pending;
187. project backup containing browser cookies;
188. two Core processes race same library;
189. updater starts new Core before old writer exits;
190. archived project opened by newer migration-capable app;
191. LOCAL_ONLY dependency used by cloud-allowed project;
192. purge under backup/legal hold;
193. crash leaves Project A temp frames then Project B starts;
194. lock-screen notification for confidential project;
195. external provider exposure remains after local purge.



# IW. Offline collaboration branch

Offline edits are not delayed canonical writes.

An offline working branch records:
- project ID;
- base canonical revision/version;
- actor ID;
- device/install ID;
- app session ID;
- operation-schema version;
- local operation sequence;
- scope;
- created/last-sync time.

Reconnect performs a rebase/merge plan through normal command authorization.

# IX. Domain merge classes

Every collaborative domain declares merge class:

- MERGEABLE_TEXT — comments/some plain text where CRDT/merge semantics are acceptable;
- OPERATION_REBASE — ordered edit operations that may merge when dependency/region scopes are disjoint;
- COMPARE_AND_SET — canonical promotion/approval/current-slot replacement;
- EXCLUSIVE — rights/security/manual lock/other single-owner mutation;
- MANUAL_SEMANTIC — overlapping canon/timeline/destructive conflicts requiring explicit resolution.

No generic LWW policy is allowed for privilege-bearing or canon-bearing state.

# IY. Collaboration conflict entity

Conflict captures:
- base revision/version;
- local branch/ops;
- current canonical revision;
- conflicting entities/fields/story/time ranges;
- invariant violations;
- deletion/tombstone interactions;
- possible resolutions.

Resolution produces a new explicit command/revision.
Conflict history is not erased.

# IZ. Sync authority revalidation

On reconnect/submit, revalidate:
- actor/account enabled;
- role/permission generation;
- project membership;
- current privacy/rights policy;
- current archive/trash/purge state;
- current manual/canonical locks.

Old offline authorization never grants present authority.

# JA. Tombstone/terminal-state dominance

Stale/offline edits cannot resurrect:
- privacy-purged entities;
- non-resurrectable rights-revoked state;
- purged project/object;
- sealed archive bytes;
- disabled actor authority.

Explicit restore/recreate command under current policy is required.

# JB. Authoritative exclusive locks

Only authoritative Core can grant a new exclusive/manual/canonical lock.

Offline continuation of an existing lease is bounded by:
- lease ID/epoch;
- offline-valid-until;
- scope;
- current commit-time revalidation.

Loss of authoritative lock means offline work returns as candidate/conflict, not canonical write.

# JC. Actor/device/session identity

Collaboration provenance records:
- actor;
- device/install identity;
- app session;
- edit/command session;
- Core/library epoch.

Same actor on multiple devices is not treated as one conflict-free stream.

# JD. Offline queue compaction and expiry

Offline branch has:
- max operation count/bytes/age;
- checkpoints;
- operation-schema migration;
- compaction;
- threshold requiring full rebase/import-as-branch instead of blind replay.

Unknown old operation semantics fail closed.

# JE. Offline irreversible-action rule

Offline mode may prepare:
- drafts;
- plans;
- edits;
- review notes.

It cannot execute final external/irreversible phases such as:
- publish;
- external delete;
- high-cost dispatch;
- credential/rights/security mutation;
- signing/release.

These require fresh online/current authority and external-state checks.

# JF. Collaboration transport as capability

Network collaboration/sync is a capability provider with:
- egress/privacy class;
- encryption;
- account/tenant identity;
- retention;
- rights policy;
- availability/capacity.

LOCAL_ONLY input closure blocks cloud collaboration for that content unless separately authorized/declassified.

# JG. Notification recipient authorization

Collaboration notification/mention delivery revalidates:
- recipient membership/access;
- privacy classification;
- current project visibility.

Stale queued notifications are redacted/dropped when access was removed.

# JH. Canonical promotion CAS

Canonical promotion/approval binds:
- canonical slot/entity;
- expected current revision/version;
- candidate revision;
- actor/authority.

Mutation succeeds only if expected current value still matches.
Concurrent loser receives conflict and remains candidate/noncanonical.

# JI. Required collaboration tests

196. offline edit against changed canon;
197. offline edit after privacy purge;
198. permission revoked while offline queue exists;
199. two concurrent same-clip timeline edits;
200. edit-vs-delete conflict;
201. two simultaneous canonical approvals;
202. offline client after schema operation format upgrade;
203. same actor from two devices;
204. manual lock partition/conflict;
205. LOCAL_ONLY project through cloud collaboration;
206. stale mention after access removal;
207. offline publish attempt;
208. rights edit while offline;
209. archive edited from stale offline branch.



# JJ. Coordinated retry domains

Retry is scheduled by a coordinator scoped to the external failure/rate-limit domain, not independently by each worker.

State tracks:
- provider/account/workspace/rate-limit scope;
- logical operation;
- durable retry count/budget;
- next eligible time;
- provider Retry-After evidence;
- jitter seed/range;
- breaker/cooldown state;
- unreconciled cost exposure.

Provider retry hints are parsed/clamped.
Half-open state admits a bounded number of probes.

# JK. Fallback hysteresis

Router stores recent fallback history and cooldown.

Failover from A→B:
- checks B quota/capacity/health/privacy/rights;
- ramps a bounded share;
- observes results before wider migration;
- avoids immediate B→A oscillation;
- keeps failed-domain circuit state across Core restart where appropriate.

# JL. Shared quota/rate-limit domains

Connection records identify or infer the provider limiting scope:
- credential/API key;
- account;
- tenant/workspace;
- model/region;
- endpoint;
- unknown conservative scope.

Quota/rate state is aggregated at the limiting scope.
Multiple UI Connection cards do not imply independent quota.

# JM. Project fair-share scheduling

Scheduler calculates effective priority from:
- policy priority class;
- critical-path/unblock value;
- deadline feasibility;
- fair-share deficit/credit;
- bounded starvation age;
- resource/quota availability;
- cost/privacy/rights constraints.

User-entered priority is an input, not unrestricted scheduler authority.

No numeric overflow/NaN/Infinity is accepted.

# JN. Mandatory maintenance deadlines

Safety maintenance declares:
- earliest start;
- latest safe start/deadline;
- estimated resource bundle;
- preemptibility;
- minimum reserved capacity.

If borrowed capacity is allowed, only reclaimable/preemptible work may occupy the deadline buffer.

# JO. Cancellation coordinator

Bulk cancellation:
- coalesces/batches where provider supports it;
- applies per-provider rate budget;
- records one logical cancellation intent per attempt;
- stops after bounded retries;
- yields terminal CANNOT_CANCEL/UNKNOWN_EXTERNAL_STATE where needed.

Cancellation never erases cost exposure evidence.

# JP. Durable retry/exposure budget

Logical external effect owns a durable retry budget independent from worker process.

Budget survives:
- worker restart;
- Core restart;
- requeue;
- takeover;
- restore/recovery according to forward operational journal.

Manual retry-budget extension is a high-impact audited command.

# JQ. Persistent external breaker state

Breaker state persists enough evidence to avoid restart hammering:
- failure domain;
- opened_at;
- cooldown_until;
- failure class;
- recent probes;
- next half-open allowance.

On recovery, stale state is revalidated conservatively.

# JR. Paid dispatch revalidation

Immediately before paid dispatch:
- current price/credit unit snapshot when available;
- current account quota/rate state;
- current project/studio budget;
- actual settled usage;
- reserved exposure;
- unreconciled unknown exposure;
- retry/fallback exposure.

Admission may block even if the original plan estimate was under budget.

# JS. Dead-letter and retry-history lifecycle

DLQ/retry evidence has:
- bounded hot retention;
- archival/checkpoint path;
- disk quota;
- priority retention for irreversible/paid/security events;
- cleanup that never destroys unresolved compensation/reconciliation evidence.

# JT. Hierarchical active queue

Large batches/projects remain hierarchical.

Hot scheduler materializes only a bounded active window per:
- project;
- batch;
- capability/resource class.

Completed/blocked/history remains queryable outside the hot queue.

# JU2. Required scheduler storm tests

210. outage recovery with 10k retries;
211. malformed Retry-After;
212. bounded half-open probes;
213. A→B fallback overload prevention;
214. A↔B oscillation;
215. five connections sharing one provider quota;
216. one project quota starvation attempt;
217. backup deadline under continuous renders;
218. 5k-job cancellation storm;
219. retry budget across restart/requeue;
220. breaker persistence across restart;
221. budget reduced while jobs queued;
222. delayed charges after cancellation;
223. 100k-job project active-horizon behavior;
224. borrowed maintenance capacity deadline reclaim.



# JV. Hardened browser automation profile

Production browser profile requirements:
- dedicated user-data directory;
- user-scoped filesystem ACL;
- no arbitrary browser extensions;
- password manager/autofill/site notifications disabled by default;
- controlled crash/tab restore behavior;
- pinned browser/CDP version during active jobs;
- explicit profile health/certification revision.

Browser/profile update is a package lifecycle event, not invisible ambient OS behavior.

# JW. Browser site-state isolation classes

Connector declares browser state-sharing class:
- JOB_ISOLATED
- PROJECT_ISOLATED
- ACCOUNT_SHARED_SAFE
- UNKNOWN

State includes:
- cookies;
- localStorage;
- IndexedDB;
- service workers;
- site permissions;
- provider conversation/session identifiers.

Strict privacy policy rejects UNKNOWN cross-project reuse.

# JX. Private browser-control endpoint

CDP/remote automation endpoint:
- loopback/private IPC only;
- unpredictable ephemeral endpoint/token;
- process/session epoch-bound;
- user-scoped ACL/firewall;
- never logged in plaintext;
- closed when browser worker exits.

Client validates it controls the expected browser process/profile.

# JY. OAuth/auth redirect session

Browser auth session binds:
- connector;
- account expectation;
- state;
- nonce;
- PKCE verifier/challenge where supported;
- redirect URI;
- loopback listener ownership;
- expiry.

Callback without matching live auth session is rejected.

Post-exchange authentication is not READY until provider account/workspace identity is verified.

# JZ. Canonical browser origin policy

Connector registers:
- canonical production origins;
- canonical auth origins;
- allowed redirect transitions;
- TLS/certificate policy;
- allowed schemes.

Privileged auth/automation compares parsed origin identity, not page title/favicon/rendered URL.

Certificate error, captive portal, unexpected punycode/homograph or origin mismatch blocks privileged action.

# KA. Typed browser action plan

Browser automation executes typed actions:
- NAVIGATE_ALLOWED_ORIGIN
- UPLOAD_STAGED_FILE
- SUBMIT_GENERATION
- POLL_RESULT
- DOWNLOAD_RESULT
- ACCOUNT_IDENTITY_CHECK
- HUMAN_TAKEOVER_CHECKPOINT
- other connector-declared actions.

Page/DOM text is untrusted observation and cannot create a new privileged action or widen file/network scope.

# KB. Exact upload/download scoping

Upload:
- receives exact staged file handles;
- no arbitrary directory enumeration;
- no parent/sibling project visibility.

Download:
- lands in per-job staging;
- never auto-executes;
- records origin/tab/session/action;
- MIME/decode validates content;
- blob/data URL requires page/session/job association evidence.

# KC. Semantic DOM action contract

Each production DOM action defines:
- expected origin;
- page/semantic fingerprint;
- expected control role;
- effect class;
- preconditions;
- postconditions;
- evidence.

Destructive/account actions require stronger semantic confirmation.
CSS/XPath selector is an implementation detail, not authority.

# KD. Browser runtime/profile draining

Browser/profile version change:
`READY → DRAINING → UPDATING → TESTING → CANARY → READY`

Active jobs keep pinned runtime/profile version or reconcile explicitly.

New version must pass:
- login/account identity;
- upload;
- harmless canary;
- generation/result observation where economically safe;
- download/materialization;
- DOM semantic checks.

# KE. Human takeover resume fence

Before automation resumes after human takeover:
- current origin/page fingerprint;
- provider account/workspace;
- job identity;
- expected workflow checkpoint;
- current downloads/session state;
- connector/browser version

must match.

Mismatch => NEEDS_RECONCILIATION, not blind resume.

# KF. Browser challenge classification

Browser states distinguish:
- LOGIN_REQUIRED
- MFA_REQUIRED
- CAPTCHA_REQUIRED
- CONSENT_REQUIRED
- PERMISSION_REQUIRED
- ACCOUNT_MISMATCH
- GENERATION_RUNNING
- GENERATION_FAILED
- RESULT_READY

Auth challenge is never treated as proof generation failed/retry-safe.

# KG. Browser diagnostic data class

Browser screenshots/DOM/network traces/download metadata are sensitive diagnostic artifacts.

They bind:
- project/job;
- privacy class;
- retention;
- redaction state;
- support-export inclusion policy.

Default diagnostics minimize full-page screenshots/network bodies.

# KH. Browser health freshness

Connection health includes independent freshness:
- browser runtime/profile;
- DOM/semantic canary;
- auth/session;
- account/workspace;
- automation permission/terms;
- download/materialization.

Stale health cannot be treated as current production authorization indefinitely.

# KI. Browser profile quarantine/recovery

Repeated profile corruption/anomalous identity/session behavior:
`READY → DEGRADED → QUARANTINED`

Recovery:
- preserve minimal forensic evidence;
- create clean profile;
- do not clone corrupted site state wholesale;
- require reauth where appropriate;
- recertify connector.

# KJ. Required browser connector tests

225. extension injection/update attempt;
226. service-worker behavior drift;
227. cross-project localStorage/session reuse;
228. exposed CDP endpoint;
229. OAuth redirect-port squatting;
230. bad state/nonce callback;
231. homograph/captive-portal login;
232. page prompt attempts wider upload;
233. unexpected popup origin;
234. executable download;
235. blob download association;
236. browser update mid-job;
237. wrong-account workspace after login;
238. destructive DOM selector drift;
239. human takeover resumes wrong page;
240. CAPTCHA/MFA appears after submission;
241. browser profile corruption recovery.



# KK. Evaluator provenance and independence

Every evaluation result records:
- evaluator package/model exact digest;
- evaluator semantic version;
- environment/backend/precision;
- calibration profile ID;
- threshold/rubric profile ID;
- input subject revision + representation digest;
- relevant reference/canon revisions;
- policy revision;
- evidence type;
- evidence independence/correlation class.

Provider/connector self-score is ADVISORY unless explicitly promoted/certified as trusted evaluator evidence.

# KL. OOD and calibration

Evaluator capability profile declares calibrated/support domain:
- media type;
- style/domain tags;
- language;
- resolution/frame/audio conditions;
- model/version;
- calibration sample/reference.

Result may be:
- PASS
- FAIL
- UNKNOWN
- OUT_OF_DOMAIN
- CONFLICT

OUT_OF_DOMAIN/UNKNOWN cannot silently coerce to PASS.

# KM. Media-observation prompt isolation

OCR/ASR/transcript/metadata/visible text/audio speech extracted from evaluated media is `UNTRUSTED_OBSERVATION`.

It cannot:
- modify evaluation rubric;
- issue tool commands;
- alter PASS threshold;
- request secret/file/network access;
- change evaluator system instruction.

Evaluation controller passes observations as typed quoted data only.

# KN. Multi-evidence identity evaluation

Identity claims may combine:
- embedding similarity;
- track identity over time;
- semantic role/context;
- geometry/feature checks;
- voice/speaker consistency;
- human review.

For hero/high-risk canonical identity, policy may require evidence diversity.
One scalar embedding score never establishes identity truth alone.

# KO. Evaluation-cache completeness

Evaluation cache key includes:
- exact subject bytes/revision;
- representation/proxy/master digest;
- evaluator digest/version;
- environment/backend where material;
- calibration/threshold/rubric;
- QC policy;
- relevant reference/canon revisions;
- coverage/sampling profile.

Changing any required dependency invalidates cache reuse.

# KP. QC coverage profile

Evaluation declares coverage:
- FULL_SCAN
- DETERMINISTIC_SAMPLE
- RANDOM_SAMPLE
- EVENT_TRIGGERED
- ADAPTIVE

Evidence stores:
- scanned frame/sample/time ranges;
- sampling seed/policy;
- skipped ranges/reasons;
- confidence/limitations.

“No issue observed” is scoped to coverage; it is not proof that unobserved ranges are clean.

# KQ. Aggregate/cross-modal QC

Evaluation scopes include:
- FRAME_SAMPLE
- SHOT
- SCENE
- SEQUENCE
- TIMELINE
- MASTER
- CROSS_MODAL

Cross-modal checks can validate:
- audio/video sync;
- subtitle/dialogue sync;
- speaker binding;
- scene color continuity;
- long-duration temporal drift.

# KR. Golden/benchmark integrity

Golden/benchmark examples bind:
- content digest;
- provenance;
- labels/reviewer evidence;
- rights/privacy use permissions;
- domain tags;
- integrity state;
- benchmark profile version.

Corrupt/revoked examples are quarantined and baseline changes are explicit.

# KS. Benchmark anti-overfit

Promotion policy may require:
- development benchmark;
- hidden/rotating holdout;
- cross-domain set;
- shadow production;
- human preference/review.

Repeated tuning against one public/static benchmark cannot be sole promotion gate.

# KT. Trusted evaluator authority

Authoritative QC result is accepted only from registered evaluator worker/service identity under an allowed evaluation policy.

Connector/provider result metadata may be stored as evidence, but cannot set canonical QC PASS directly unless that source is certified for the exact claim type.

# KU. Post-QC mutation fence

QC/review binds exact artifact digest/revision.

Any subsequent operation that changes bytes/semantics:
- mux;
- transcode;
- crop;
- audio normalize;
- subtitle burn;
- watermark;
- package transform

creates a new revision and invalidates byte-dependent evidence according to policy.

Final release verification targets final packaged/master bytes.

# KV. Human review anti-anchoring

Review policy can:
- hide AI score until human verdict;
- include random/unflagged samples;
- track review velocity/anomaly;
- require secondary review for suspicious high-risk approval patterns.

Automation may suggest; it must not turn human review into rubber-stamping by UI design.

# KW. Preference model scope

Preference/adaptation model has explicit scope:
- ACTOR
- TEAM
- PROJECT
- STUDIO

Promotion to broader scope uses normal learning/promotion governance.

# KX. Repair anti-Goodhart

Repair planner tracks:
- target defect;
- protected creative constraints;
- previous attempts;
- metric improvements/regressions;
- composition/performance side effects.

Repeated metric gain with semantic/creative regression triggers strategy change, rollback or human review.

# KY. Required adversarial-QC tests

241. hidden text/QR attempts to prompt-inject VLM evaluator;
242. spoken instruction attempts to prompt-inject ASR/evaluator;
243. wrong-face lookalike embedding collision;
244. similar-voice speaker collision;
245. OOD animation style high-confidence score;
246. evaluator version score-scale change;
247. cache PASS reused after threshold/policy change;
248. one-frame defect outside deterministic sample;
249. long-duration A/V drift;
250. corrupted golden example;
251. revoked benchmark rights;
252. provider fake QC PASS;
253. post-QC transcode/mux changes bytes;
254. reviewer AI-score anchoring/random audit;
255. repair crops/hides defect to improve metric.
