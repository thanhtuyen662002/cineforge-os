# CineForge OS — Detailed State Machines v1

> Principle: avoid combinatorial mega-enums. Where concerns are orthogonal, state is split into independent axes and UI receives a projection.

# 1. State-machine rules

Every transition defines:
- allowed source state(s);
- command that requests it;
- guards/preconditions;
- emitted domain event(s);
- side effects/outbox work;
- resulting user-visible interpretation;
- whether transition is reversible/compensatable/irreversible.

No UI component may invent state transitions locally.

# 2. Command lifecycle

```text
RECEIVED
  → VALIDATING
      → WAITING_DECISION
      → READY
      → FAILED
WAITING_DECISION
  → READY
  → CANCELLED
  → FAILED
READY
  → EXECUTING
EXECUTING
  → SUCCEEDED
  → FAILED
  → PARTIAL
  → CANCELLED
PARTIAL
  → COMPENSATING
  → SUCCEEDED_WITH_WARNINGS
  → FAILED
COMPENSATING
  → COMPENSATED
  → FAILED_COMPENSATION
```

Guards:
- stale expected version => FAILED(STALE_REVISION);
- policy/rights denial => WAITING_DECISION or FAILED;
- budget/storage unavailable => WAITING_DECISION or FAILED;
- irreversible command requires authority + explicit confirmation.

User projection examples:
- VALIDATING: “Đang kiểm tra thay đổi…”
- WAITING_DECISION: “CineForge cần bạn quyết định.”
- EXECUTING: real milestone text from command handler.
- PARTIAL: “Một phần đã hoàn tất; có phần không thể hoàn tác.”
- COMPENSATED: “Đã hoàn tác phần CineForge có thể hoàn tác.”

# 3. Action Plan / Assistant request

Natural-language request lifecycle:

```text
DRAFT
→ PARSED
→ IMPACT_ANALYZED
→ POLICY_CHECKED
→ PROPOSED
→ APPROVED
→ EXECUTING
→ COMPLETED
```

Alternate exits:
- NEEDS_CLARIFICATION
- REJECTED
- EXPIRED
- CANCELLED
- FAILED

High-impact intent never skips PROPOSED/APPROVED.
Low-risk reversible action may auto-approve under user policy.

# 4. Import session

```text
CREATED
→ SCANNING
→ QUARANTINE_CHECK
→ IDENTIFYING
→ HASHING
→ DECODING
→ SEMANTIC_ANALYSIS
→ WAITING_MAPPING 
→ READY_TO_COMMIT
→ COMMITTING
→ COMPLETED
```

Failure/exit states:
- CANCELLED
- PARTIAL
- FAILED
- QUARANTINED

Per import item independent axes:

### ingest_state
- RECEIVED
- COPYING
- HASHED
- REGISTERED
- COMPLETE

### decode_state
- UNKNOWN
- VERIFIED
- UNSUPPORTED
- CORRUPT

### security_state
- UNCHECKED
- SAFE
- SUSPICIOUS
- QUARANTINED

### semantic_state
- UNCLASSIFIED
- PROPOSED
- CONFIRMED
- AMBIGUOUS

UI must not display a single misleading “Imported” if decode or security failed.

# 5. Source binding

External source availability axis:
- AVAILABLE
- CHANGED_EXTERNALLY
- MISSING
- ACCESS_DENIED
- OFFLINE_VOLUME

Managed copy availability:
- AVAILABLE
- CORRUPT
- MISSING

A source becoming MISSING does not delete the asset identity.

# 6. Canon revision lifecycle

Used by character identity, voice identity, costume, prop, environment, Film Bible and similar canon.

```text
DRAFT
→ CANDIDATE
→ APPROVED
→ SUPERSEDED
```

Alternative:
- CANDIDATE → REJECTED
- APPROVED content remains immutable; rights/safety revocation is represented on an independent blocking axis rather than rewriting historical approval.
- APPROVED never returns to DRAFT

APPROVED bytes/content are immutable.
A “change” from approved revision always creates a new DRAFT revision.

# 7. Character lock state

Lock is separate from revision lifecycle.

Lock axes:
- IDENTITY: UNLOCKED | LOCKED
- VOICE: UNLOCKED | LOCKED
- STYLE: UNLOCKED | LOCKED
- COSTUME: interval-specific
- PROP_BINDING: interval-specific

Lock command stores scope and effective story interval.

Changing a locked item:
1. create proposed revision/interval;
2. impact analysis;
3. require authority based on project policy;
4. never mutate existing locked revision.

# 8. Script revision

```text
IMPORTED_OR_AUTHORED
→ PARSING
→ STRUCTURED_CANDIDATE
→ UNDER_REVIEW
→ ACCEPTED_CANON
```

Exits:
- PARSE_FAILED
- REJECTED
- SUPERSEDED

AI parser output cannot directly reach ACCEPTED_CANON.

# 9. Story/continuity fact

Fact authority state:
- INFERRED
- PROPOSED
- CANONICAL
- CONFLICT
- SUPERSEDED
- REVOKED

When two canonical facts overlap incompatibly:
- create CONFLICT;
- affected production becomes REVIEW_REQUIRED/BLOCKED according to severity;
- AI must not silently pick one.

# 10. Shot production projection

Shot domain status is a read-model derived from spec, jobs, selected output and review.

User-facing projection:
- PLANNED
- READY
- PRODUCING
- CANDIDATES_READY
- NEEDS_REVIEW
- APPROVED
- STALE
- BLOCKED
- PAUSED

No direct “set shot status” command exists. It is derived.

# 11. Generation session

```text
PLANNED
→ BUDGET_RESERVED
→ QUEUED
→ RUNNING
→ PARTIAL_RESULTS
→ AWAITING_SELECTION
→ SELECTED
→ COMPLETED
```

Alternative exits:
- CANCEL_REQUESTED
- CANCELLED
- COMPLETED_AFTER_CANCEL
- FAILED
- EXHAUSTED_BUDGET

Rules:
- candidates can arrive incrementally;
- user can stop after a satisfactory candidate;
- selected candidate never implies approval;
- late candidate after cancel is stored as noncanonical and clearly labeled.

# 12. Job lifecycle

```text
QUEUED
→ CLAIMED
→ RUNNING
```

From RUNNING:
- WAITING_EXTERNAL
- HUMAN_WAIT
- COMPLETED
- FAILED_RETRYABLE
- FAILED_FINAL
- CANCELLATION_REQUESTED

WAITING_EXTERNAL:
- RUNNING
- COMPLETED
- FAILED_RETRYABLE
- CANCELLATION_REQUESTED

HUMAN_WAIT:
- RUNNING
- CANCELLED_CONFIRMED
- FAILED_FINAL

Cancellation:
```text
CANCELLATION_REQUESTED
→ CANCELLED_CONFIRMED
→ CANNOT_CANCEL
→ COMPLETED_AFTER_CANCEL
```

Retry:
FAILED_RETRYABLE does not automatically mean retry. Retry budget, policy, cost and provider idempotency are evaluated first.

# 13. Job attempt

Attempt states:
- CREATED
- DISPATCHING
- ACCEPTED_EXTERNAL
- EXECUTING
- WAITING_CALLBACK
- OUTPUT_RECEIVED
- NORMALIZING
- VERIFYING
- SUCCEEDED
- FAILED
- ABANDONED
- QUARANTINED

Important rule:
A network timeout after DISPATCHING can mean the provider accepted the request. Reconciliation precedes retry.

# 14. Connection state — orthogonal axes

Never create one enum like CONNECTED_BUT_RATE_LIMITED_BUT_AUTH_EXPIRED.

### lifecycle
- ADDED
- UNVERIFIED
- TESTING
- READY
- DRAINING
- DISABLED
- QUARANTINED
- REMOVED

### auth
- NOT_REQUIRED
- MISSING
- VALID
- EXPIRED
- MFA_REQUIRED
- REAUTH_REQUIRED
- DENIED

### availability
- UNKNOWN
- AVAILABLE
- DEGRADED
- UNAVAILABLE

### capacity
- UNKNOWN
- AVAILABLE
- SATURATED
- RATE_LIMITED
- QUOTA_EXHAUSTED

### policy
- ALLOWED
- RESTRICTED
- BLOCKED

UI projection examples:
- READY + VALID + AVAILABLE + AVAILABLE + ALLOWED => “Sẵn sàng”
- READY + VALID + DEGRADED => “Đang có vấn đề”
- READY + REAUTH_REQUIRED => “Cần đăng nhập lại”
- DRAINING => “Đang hoàn tất công việc hiện tại”
- QUOTA_EXHAUSTED => “Hết hạn mức”

# 15. Browser interaction

```text
CREATED
→ STARTING_PROFILE
→ NAVIGATING
→ READY
→ UPLOADING
→ SUBMITTING
→ WAITING_GENERATION
→ DOWNLOADING
→ ASSOCIATING_OUTPUT
→ COMPLETED
```

Interruptions:
- LOGIN_REQUIRED
- MFA_REQUIRED
- CAPTCHA_REQUIRED
- HUMAN_TAKEOVER
- DOM_CHANGED
- SESSION_EXPIRED
- DOWNLOAD_AMBIGUOUS
- FAILED

After human takeover, automation resumes only from a verified checkpoint.

# 16. MCP connection/tool schema state

Server:
- DISCOVERED
- UNVERIFIED
- VERIFIED
- READY
- SCHEMA_CHANGED
- DEGRADED
- QUARANTINED
- DISABLED

Tool call:
- VALIDATED
- AUTHORIZED
- EXECUTING
- COMPLETED
- FAILED
- TIMED_OUT
- CANCEL_UNKNOWN

Unexpected schema/capability change forces re-verification; no silent permission expansion.

# 17. Review session

```text
OPEN
→ IN_PROGRESS
→ SUBMITTED
```

Submission decision:
- APPROVE
- REJECT
- REPAIR
- ABSTAIN

A submitted review is immutable.
If subject dependencies change, the review becomes STALE by projection and a new review session may be required.

# 18. Evaluation result

Result state:
- PASS
- FAIL
- UNKNOWN
- OUT_OF_DOMAIN
- CONFLICT

Operational state:
- QUEUED
- RUNNING
- COMPLETE
- EVALUATOR_FAILED
- STALE

Evaluator failure never maps to PASS.

# 19. Decision Request

```text
OPEN
→ RESOLVED
→ DISMISSED
→ EXPIRED
→ OBSOLETE
```

Rules:
- OBSOLETE when the underlying condition changes before user responds.
- Resolving an obsolete decision must fail with STALE_DECISION.
- Blocking scope may be one task, shot, scene, project, release, or system action.
- Decision may have default “do nothing” rather than an automatic risky action.

# 20. Staleness record

```text
OPEN
→ RESOLVED
→ WAIVED
```

WAIVED requires actor, reason and policy authority.
A waiver does not erase causal history.

# 21. Rights record

Rights status:
- UNKNOWN
- ALLOWED
- RESTRICTED
- EXPIRED
- REVOKED

A revocation is dominant:
- no stale callback can restore ALLOWED;
- release/publish gates re-evaluate current rights;
- derivatives receive taint-impact records.

# 22. Timeline working session

```text
OPEN
→ DIRTY
→ AUTOSAVING
→ DIRTY
→ CHECKPOINTING
→ CLEAN
```

Exits:
- CONFLICT
- RECOVERY_REQUIRED
- CLOSED
- ABANDONED

Checkpoint creates an immutable timeline revision.
Autosave updates only draft/working state.
Undo/redo operate on edit operation history within working session.

# 23. Timeline revision lifecycle

- DRAFT_CHECKPOINT
- CANDIDATE
- APPROVED
- SUPERSEDED

An approved timeline revision pins exact asset revisions.

# 24. Export session

```text
PLANNED
→ PREFLIGHT
→ BUILDING
→ VALIDATING
→ VERIFIED
→ COMPLETED
```

Exits:
- BLOCKED_RIGHTS
- BLOCKED_MEDIA
- FAILED
- CANCELLED

File existence after BUILDING is not completion; VALIDATING must decode/probe/check manifest.

# 25. Release candidate

```text
DRAFT
→ PICTURE_LOCKED
→ AUDIO_LOCKED
→ LOCALIZATION_LOCKED
→ RIGHTS_CHECKED
→ BUILDING_MASTER
→ QC_PENDING
→ QC_PASSED
→ APPROVED
→ RELEASED
```

Failures:
- RIGHTS_BLOCKED
- QC_FAILED
- STALE
- CANCELLED

Any upstream dependency change after QC_PASSED may create STALE.

# 26. Publication

```text
DRAFT
→ READY
→ AUTHORIZED
→ UPLOADING
→ PLATFORM_PROCESSING
→ DELIVERED
→ VERIFIED
```

Alternative:
- FAILED
- CANNOT_CONFIRM
- REPLACEMENT_PENDING
- TAKEDOWN_REQUESTED
- TAKEN_DOWN

Public publication is irreversible/compensatable, not truly reversible.
A platform can retain data after a local delete.

# 27. Trash and deletion

Entity trash:
- ACTIVE
- TRASHED
- RESTORED
- PURGE_ELIGIBLE
- PURGED

Physical storage purge is separate from logical trash.

A logical entity can be PURGED only after:
- reference graph permits;
- rights/legal retention permits;
- backup/retention policy permits;
- no active job/lease;
- user authority satisfied.

# 28. GC run

```text
PLANNING
→ DRY_RUN_READY
→ WAITING_APPROVAL 
→ EXECUTING
→ VERIFYING
→ COMPLETED
```

Failures:
- ABORTED
- PARTIAL
- ROLLED_BACK
- FAILED

No candidate is deleted if its safety proof changed since dry run; generation/version guard forces re-evaluation.

# 29. Backup

```text
PLANNED
→ SNAPSHOTTING
→ COPYING
→ VERIFYING
→ VERIFIED
```

Failures:
- PARTIAL
- FAILED
- CORRUPT

Restore:
```text
SELECTED
→ PREFLIGHT
→ RESTORE_STAGING
→ VERIFY
→ SWITCH
→ RECONCILE
→ COMPLETE
```

Existing studio is not overwritten until staged restore verifies.

# 30. Update

Plane-specific update:
- AVAILABLE
- DOWNLOADING
- VERIFIED
- STAGED
- WAITING_SAFE_BOUNDARY
- INSTALLING
- MIGRATING
- HEALTH_CHECK
- COMPLETE

Failures:
- FAILED_DOWNLOAD
- FAILED_SIGNATURE
- FAILED_INSTALL
- FAILED_MIGRATION
- ROLLBACK
- SAFE_MODE_REQUIRED

An update that can change output semantics cannot silently replace a pinned production dependency.

# 31. Learning candidate

```text
CANDIDATE
→ OFFLINE_BENCHMARK
→ GOLDEN_VALIDATION
→ CROSS_DOMAIN_VALIDATION
→ SHADOW
→ HUMAN_REVIEW
→ PROMOTED
```

Exits:
- REJECTED
- OUT_OF_DOMAIN
- ROLLED_BACK
- DEPRECATED

Production feedback cannot skip stages.

# 32. Project lifecycle

- ACTIVE
- PAUSED
- ARCHIVED
- TRASHED

Project “complete” is not a single state; releases may continue independently.
Archived project must remain viewable even if historical models/connectors no longer execute.
Reopening archive can operate in READ_ONLY_COMPATIBILITY mode if execution dependencies are unavailable.

# 33. App/Core lifecycle

UI state:
- STARTING
- CONNECTING_CORE
- READY
- CORE_UNAVAILABLE
- RECOVERING

Core state:
- STARTING
- MIGRATING
- RECONCILING
- READY
- DEGRADED
- SAFE_MODE
- SHUTTING_DOWN

Closing UI does not imply Core shutdown if background policy says continue jobs.

# 34. UI state projection rule

UI receives:
- machine state;
- human_state_key;
- needs_user bool;
- blocking bool;
- next_action descriptors;
- progress evidence;
- last_updated_at;
- stale_after hint.

Examples:
```text
machine: WAITING_EXTERNAL
human: "Đang chờ Google Flow hoàn tất"
needs_user: false

machine: MFA_REQUIRED
human: "Cần bạn xác nhận đăng nhập"
needs_user: true
```

The human-readable projection is produced by Core/domain logic, not reconstructed independently in every UI page.

# 35. State-machine test rule

Every state machine must have:
- transition table tests;
- invalid transition tests;
- replay/idempotency tests where relevant;
- stale-version tests;
- crash/restart reconciliation tests;
- user-facing projection test;
- rights/policy guard tests when applicable.

No feature is implementation-complete with only happy-path state transitions.


# 36. Production task state

```text
PLANNED
→ READY
→ ACTIVE
→ DONE
```

Alternate:
- READY/ACTIVE → WAITING
- READY/ACTIVE/WAITING → BLOCKED
- BLOCKED → READY
- any nonterminal → CANCELLED

Task status is separate from job state.
A ProductionTask can be BLOCKED because approval is missing while its previous render Job already COMPLETED.

Critical-path projection recalculates after:
- task duration change;
- dependency change;
- milestone change;
- blocking DecisionRequest;
- resource/capacity change.

# 37. Milestone state

- PLANNED
- AT_RISK
- BLOCKED
- ACHIEVED
- MISSED
- CANCELLED

AT_RISK is a projection based on task/resource evidence, not a manually selected mood.

# 38. Policy and control-mode state

Policy revision:
- DRAFT
- ACTIVE
- SUPERSEDED
- REVOKED

Effective policy is calculated by precedence:
Studio → Project → Sequence → Scene → Shot → Task.

Control mode:
- AUTO
- GUIDED
- ADVANCED
- EXPERT

Changing mode affects future command planning/routing only; it never rewrites past artifacts.

# 39. Creative exception

```text
PROPOSED
→ ACTIVE
→ EXPIRED
```

Alternate:
- PROPOSED → REJECTED
- ACTIVE → REVOKED

An active creative exception suppresses only the specific configured warning/repair policy and never erases evidence.

# 40. Audio cue lifecycle

- PLANNED
- GENERATING_OR_RECORDING
- CANDIDATES_READY
- SELECTED
- MIX_READY
- APPROVED
- STALE
- REJECTED

Cue type SILENCE can move PLANNED → APPROVED with creative authority and still participates in spotting/timing dependency.

# 41. Music cue lifecycle

- SPOTTED
- DRAFT
- CANDIDATES_READY
- SELECTED
- APPROVED
- STALE
- SUPERSEDED

Timeline duration/edit changes create STALE only if the cue's timing/spotting dependencies are affected.

# 42. Localization unit

Translation unit:
- DRAFT
- REVIEWED
- APPROVED
- STALE

Subtitle track:
- DRAFT
- TIMED
- REVIEWED
- APPROVED
- STALE

Dubbing track:
- CASTING
- RECORDING_OR_GENERATING
- EDITING
- MIXED
- REVIEWED
- APPROVED
- STALE

UI must distinguish translation approval from timing approval and voice/performance approval.

# 43. Composition/VFX lifecycle

Composition revision:
- DRAFT
- CANDIDATE
- APPROVED
- SUPERSEDED

Render pass:
- REQUESTED
- PRODUCING
- READY
- VERIFIED
- STALE
- FAILED

Replacing one layer invalidates only composition dependencies that include that layer/pass, not every unrelated shot asset.

# 44. Worker lifecycle

- STARTING
- READY
- BUSY
- DRAINING
- UNHEALTHY
- RESTARTING
- STOPPED
- QUARANTINED

Rules:
- missing heartbeat beyond threshold => UNHEALTHY;
- expired lease uses fencing token to prevent late worker writes;
- DRAINING accepts no new work;
- memory leak/poison detection may restart worker without retrying already-completed external actions.

# 45. Package installation/provisioning

```text
DISCOVERED
→ DOWNLOADING
→ SIGNATURE_VERIFY
→ VERIFIED
→ STAGED
→ INSTALLING
→ HEALTH_CHECK
→ ACTIVE
```

Failures:
- FAILED_DOWNLOAD
- FAILED_SIGNATURE
- INCOMPATIBLE
- FAILED_INSTALL
- FAILED_HEALTH
- QUARANTINED

Removal:
ACTIVE → DRAINING → REMOVAL_CHECK → REMOVED

A pinned/required package blocks removal or creates an explicit impact DecisionRequest.

# 46. Diagnostic bundle

- REQUESTED
- COLLECTING
- REDACTING
- READY
- FAILED
- DELETED

No bundle reaches READY until redaction policy runs.
Raw media inclusion requires explicit user selection.

# 47. Projection health

Projection state:
- HEALTHY
- LAGGING
- REBUILDING
- FAILED
- STALE_SCHEMA

If a read model is stale beyond UI tolerance:
- Core returns freshness metadata;
- UI must not present it as current truth;
- canonical commands still validate against authoritative aggregate versions.

# 48. Storage staging object

- WRITING
- COMPLETE
- VERIFIED
- REGISTERED

Abnormal:
- ORPHANED
- QUARANTINED
- FAILED

After crash, reconciliation scans incomplete staging records:
- verified orphan with proven job/import lineage may be registered;
- ambiguous orphan is quarantined;
- incomplete bytes never become READY assets.

# 49. Rebuild recipe state

- VALID
- DEPENDENCY_MISSING
- VERSION_UNAVAILABLE
- NOT_REPRODUCIBLE
- STALE

GC cannot treat DERIVED_REBUILDABLE as safely rebuildable if recipe state is not VALID or policy explicitly accepts best-effort regeneration.

# 50. Provider terms state

- CURRENT
- SUPERSEDED
- UNKNOWN
- REQUIRES_REVIEW

If provider terms change materially:
- future executions bind new snapshot;
- existing outputs retain historical execution snapshot;
- release policy may require fresh legal review;
- no historical record is rewritten.

# 51. Health freshness rule

A health state always includes freshness.
Example:
- last heartbeat says HEALTHY;
- heartbeat is older than threshold;
- projected health becomes UNKNOWN/STALE, never HEALTHY.

“No new failures” is not equivalent to healthy monitoring.


# 52. Creative variant lifecycle

Variant group states:
- OPEN
- COMPARING
- RESOLVED
- ARCHIVED

Candidate states:
- ACTIVE
- REJECTED
- PROMOTED
- ARCHIVED

Rules:
- promotion creates an explicit command outcome; it never overwrites the base revision;
- promotion revalidates candidate/base dependencies before impact propagation;
- resolving a group records the promoted revision;
- non-promoted candidates remain historical/inspectable according to retention policy.


# Extreme hardening extension

For adversarially discovered recovery, fencing, egress, callback, resource, migration, bulk, signing and publication states, use `docs/design/EXTREME_HARDENING_CONTRACTS.md`.



# 61. Task dependency graph state

Graph health:
- VALID
- CYCLIC
- UNKNOWN

Task projection may include:
- READY
- BLOCKED_DEPENDENCY
- BLOCKED_DEPENDENCY_CYCLE

A cycle is a planning defect; workers do not “pick one task and hope”.

# 62. URL fetch lifecycle

```text
PROPOSED
→ PREFLIGHT_VALIDATED
→ RESOLVING
→ CONNECT_POLICY_CHECK
→ FETCHING
→ RECEIVED
→ STAGED
→ VERIFIED
```

Failure:
- BLOCKED_SCHEME
- BLOCKED_PRIVATE_NETWORK
- REDIRECT_BLOCKED
- DNS_REBIND_BLOCKED
- SIZE_LIMIT
- TYPE_BLOCKED
- TIMEOUT
- QUARANTINED

Every redirect/connect hop repeats address policy checks.

# 63. Callback authentication state

- UNVERIFIED
- VERIFIED
- FAILED
- REPLAY_REJECTED
- UNSUPPORTED_REQUIRES_POLICY

Only VERIFIED or explicit policy-approved unsupported channels may proceed to semantic callback reconciliation.

# 64. Source dependency change lifecycle

- PROPOSED
- PROVENANCE_CHECK
- LICENSE_CHECK
- SECURITY_CHECK
- BUILD_SCRIPT_CHECK
- APPROVED
- APPLIED
- REJECTED
- QUARANTINED

# 65. Integrity audit lifecycle

- PLANNED
- SCANNING
- FINDINGS_READY
- RECONCILING
- CLEAN
- DEGRADED
- CRITICAL

CRITICAL may transition Core to SAFE_MODE.

# 66. Connection identity scope

- UNKNOWN
- VERIFIED
- CHANGED
- MISMATCH
- REAUTH_REQUIRED

Authentication and identity-scope verification are independent axes.

# 67. Bulk operation lifecycle

```text
PLANNING
→ SNAPSHOT_MATERIALIZED
→ IMPACT_ANALYZED
→ CONFIRMED
→ EXECUTING
→ COMPLETE
```

If snapshot membership/revisions become stale before execution:
- STALE_SCOPE
- require replan/reconfirm according to command risk.

New entities matching the original UI filter are not automatically included.



# 68. External reality state

Installation recovery axis:
- KNOWN
- RECONCILING
- PARTIALLY_KNOWN
- UNKNOWN_EXTERNAL_REALITY
- SAFE_TO_DISPATCH

After full disaster restore without non-rollback ledger, state is UNKNOWN_EXTERNAL_REALITY.
Risky external dispatch remains blocked until provider/manual reconciliation satisfies policy.

# 69. Backup trust state

- UNVERIFIED
- HASH_VERIFIED
- AUTHENTICATED
- AUTH_FAILED
- ENCRYPTION_WEAK
- FAILURE_DOMAIN_WEAK
- RESTORE_VERIFIED

A plain matching checksum does not imply AUTHENTICATED.

# 70. Cache validity state

- VALID
- TECHNICALLY_STALE
- RIGHTS_BLOCKED
- POLICY_BLOCKED
- PRIVACY_BLOCKED
- MISSING_DEPENDENCY
- CORRUPT

A cache hit is usable only if all required validity axes permit it.

# 71. Callback scope state

- AUTH_VERIFIED_SCOPE_MATCHED
- AUTH_VERIFIED_SCOPE_UNKNOWN
- AUTH_VERIFIED_SCOPE_MISMATCH
- AUTH_FAILED
- REPLAY_REJECTED

Only MATCHED, or explicitly policy-approved UNKNOWN where provider cannot expose scope, may proceed.

# 72. Staging finalization state

- VERIFIED_CONTENT
- VERIFYING_IDENTITY
- FINALIZING
- REGISTERED
- IDENTITY_CHANGED
- LINK_ESCAPE
- CONTENT_CHANGED
- QUARANTINED


# 69. Core ownership lifecycle

```text
UNOWNED
→ ACQUIRING
→ OWNED
```

Alternate:
- ACQUIRING → CONFLICT
- OWNED → DRAINING → RELEASED
- OWNED heartbeat/liveness loss → SUSPECT_STALE
- SUSPECT_STALE → RECOVERING_OWNERSHIP → OWNED
- SUSPECT_STALE → CONFLICT

Rules:
- only OWNED epoch may enable canonical mutation;
- second Core cannot self-promote while ownership is ambiguous;
- stale owner recovery requires evidence and a new ownership epoch/session nonce.

# 70. IPC session lifecycle

- CREATED
- AUTHENTICATING
- BOUND_TO_CORE_EPOCH
- ACTIVE
- DRAINING
- INVALIDATED
- CLOSED

Any Core ownership epoch change invalidates old mutating IPC sessions.
Queued commands from INVALIDATED session require replay classification:
- SAFE_READ_REPLAY
- IDEMPOTENT_COMMAND_REVALIDATE
- DISCARD_REPLAN

# 71. Package anti-rollback state

Package candidate:
- DISCOVERED
- SIGNATURE_VALID
- MANIFEST_VALID
- VERSION_POLICY_VALID
- ACTIVATABLE

Failure/blocked:
- REVOKED_KEY
- CONTENT_HASH_MISMATCH
- ROLLBACK_BLOCKED
- INCOMPATIBLE
- QUARANTINED

A valid historical signature does not bypass VERSION_POLICY_VALID.

# 72. High-impact decision freshness

Decision/impact snapshot:
- CURRENT
- STALE_NONMATERIAL
- STALE_MATERIAL
- OBSOLETE

Execution:
- CURRENT → may execute after normal final guards
- STALE_NONMATERIAL → policy may refresh/revalidate
- STALE_MATERIAL → REPLAN_REQUIRED
- OBSOLETE → cannot execute




# 73. Connection/account circuit breaker

- CLOSED
- DEGRADED
- AUTH_REQUIRED
- MFA_REQUIRED
- CAPTCHA_REQUIRED
- OPEN_COOLDOWN
- SUSPENDED
- VERIFYING_RECOVERY

Rules:
- OPEN_COOLDOWN/SUSPENDED accept no automated login retry;
- one shared incident blocks queued work for the affected account/workspace;
- recovery requires verified auth + expected account/workspace identity.

# 74. Worker progress health

Independent from process heartbeat:
- PROGRESSING
- SLOW_BUT_PROGRESSING
- STALLED
- UNKNOWN

Combined worker health projects heartbeat + progress + crash-loop state.
A live PID/heartbeat cannot hide semantic STALLED state indefinitely.

# 75. Projection/index generation lifecycle

```text
PLANNED
→ BUILDING
→ VERIFYING
→ ACTIVATABLE
→ ACTIVE
```

Alternate:
- FAILED
- STALE
- SUPERSEDED

Only one verified ACTIVE generation serves canonical queries.
Old ACTIVE generation remains until atomic switch.

# 76. Maintenance operation lifecycle

- PREFLIGHT
- RESERVING_RESOURCES
- READY
- RUNNING
- PAUSED_SAFE
- RESUMING
- VERIFYING
- COMPLETE

Failures:
- INSUFFICIENT_HEADROOM
- BLOCKED_BY_MAINTENANCE
- RECOVERY_REQUIRED
- ROLLBACK_REQUIRED

Long maintenance records durable checkpoint/progress evidence.

# 77. Operational evidence pressure

Operational-data state:
- NORMAL
- ROTATING
- DEGRADED_SAMPLING
- EMERGENCY_MINIMAL
- RECOVERING

Security/audit retention priority is preserved while low-value debug telemetry may be sampled/dropped under pressure.
