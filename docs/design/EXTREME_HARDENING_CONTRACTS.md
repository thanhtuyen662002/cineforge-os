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