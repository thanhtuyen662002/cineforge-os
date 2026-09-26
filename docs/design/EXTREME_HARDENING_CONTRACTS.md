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
