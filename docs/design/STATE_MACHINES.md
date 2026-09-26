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


# STATE-CORE-OWNERSHIP-01. Core ownership lifecycle

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

# STATE-IPC-SESSION-01. IPC session lifecycle

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

# STATE-PACKAGE-TRUST-01. Package anti-rollback state

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

# STATE-DECISION-FRESHNESS-01. High-impact decision freshness

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




# 78. Production node lifecycle

- DRAFT
- ACTIVE
- PAUSED
- RELEASED
- ARCHIVED
- CANCELLED

RELEASED nodes retain immutable release/canon baseline references.
Later shared-canon revisions do not mutate released node history.

# 79. Narrative context lifecycle

- DRAFT
- ACTIVE
- LOCKED_FOR_RELEASE
- SUPERSEDED
- ARCHIVED

Context edges/forks are explicit.
A state interval without narrative_context_id cannot be used for nonlinear-continuity-aware production once project migration is complete.

# 80. Casting binding lifecycle

- PROPOSED
- UNDER_REVIEW
- APPROVED
- ACTIVE
- REVOKED
- SUPERSEDED
- STALE_RIGHTS

Rights revocation can move ACTIVE → STALE_RIGHTS/REVOKED without deleting the Character.

# 81. Production representation lifecycle

- DRAFT
- CANDIDATE
- APPROVED
- ACTIVE
- STALE
- REVOKED
- SUPERSEDED

Representation staleness does not imply narrative entity invalidity.

# 82. Live-action take lifecycle

```text
PLANNED
→ RECORDED
→ INGESTING
→ VERIFIED
→ AVAILABLE
```

Editorial preference:
- UNRATED
- CIRCLE
- HOLD
- REJECT

Preference is orthogonal to technical availability.

# 83. Capture ingest lifecycle

- DISCOVERED
- ENUMERATING
- COPYING
- HASHING
- VERIFYING
- VERIFIED
- PARTIAL
- FAILED
- QUARANTINED

Source media is not auto-erased after VERIFIED.

# 84. Sync group lifecycle

- PROPOSED
- ANALYZING
- SYNCED
- VERIFIED
- CONFLICT
- REJECTED
- STALE

Offset/drift changes create a new verified state/evidence, not silent overwrite.

# 85. Documentary fact claim lifecycle

- DRAFT
- UNVERIFIED
- CORROBORATING
- CORROBORATED
- CONFLICT
- DISPUTED
- APPROVED_FOR_USE
- REJECTED
- STALE

Evidence/source withdrawal or correction can move approved claim to STALE/CONFLICT according to policy.

# 86. Quote meaning review

- UNREVIEWED
- CONTEXT_REVIEW
- CONSISTENT
- POTENTIALLY_MISLEADING
- MISLEADING
- APPROVED_EXCEPTION

Transcript correctness alone does not imply CONSISTENT meaning.



# STATE-STORAGE-SCRUB-01. Storage scrub state

Scrub run:
- PLANNED
- SCANNING
- FINDINGS_READY
- REPAIRING
- VERIFIED
- DEGRADED
- FAILED

Per protected object:
- VERIFIED
- CORRUPT_REPAIRABLE
- CORRUPT_UNRECOVERABLE
- REPAIRING
- REPAIRED
- QUARANTINED

# STATE-GC-RECOVERY-01. GC object crash-recovery state

```text
LIVE
→ DELETE_INTENT
→ BYTES_DELETING
→ BYTES_ABSENT
→ PURGE_COMMITTED
```

Any interrupted nonterminal state may enter `RECONCILIATION_REQUIRED`.

# STATE-ENV-CERT-01. Environment certification freshness

- CURRENT
- DRIFT_DETECTED
- RECHECK_REQUIRED
- QUALIFYING
- CURRENT
- INVALIDATED

Material GPU/driver/runtime drift does not silently retain “certified” state.

# STATE-RELEASE-DURABILITY-01. Release master durability

- MASTER_WRITING
- MASTER_VERIFIED
- MASTER_DURABILITY_CHECK
- MASTER_DURABLE
- RELEASE_ACTIVATED

Failures:
- MASTER_MISSING
- MASTER_CORRUPT
- DURABILITY_UNVERIFIED
- RECONCILIATION_REQUIRED

Publication requires RELEASE_ACTIVATED.



# STATE-DEPLOYMENT-01. Deployment activation lifecycle

```text
UNBOUND
→ VERIFYING
→ ACTIVE
```

Mismatch/clone:
- VERIFYING → READ_ONLY_RECONCILIATION

Transitions from reconciliation:
- MOVE_REPLACEMENT_PENDING → ACTIVE
- RESTORE_RECONCILING → ACTIVE
- FORK_INITIALIZING → ACTIVE_NEW_NAMESPACE
- ABORTED

Old deployment:
- ACTIVE → RETIRING → RETIRED

A RETIRED deployment cannot dispatch new external work if current control can detect its state.

# STATE-FORK-01. Fork/reconciliation state

- DETECTED_POSSIBLE_CLONE
- AWAITING_INTENT
- MOVE_PLANNED
- RESTORE_PLANNED
- FORK_PLANNED
- REKEYING
- REAUTHORIZING
- RECONCILING_EXTERNAL
- ACTIVE
- BLOCKED

# STATE-DEPLOYMENT-JOB-01. Deployment-bound job state

If deployment binding changes before dispatch:
- `STALE_DEPLOYMENT`
- replan/rebind required.

Already accepted external jobs enter normal recovery/external reconciliation rather than being pretended cancelled.



# 87. Endpoint trust lifecycle

- DISCOVERED
- VERIFYING_SERVER
- VERIFIED
- STALE_EPOCH
- IDENTITY_MISMATCH
- REJECTED

Only VERIFIED endpoint can carry privileged IPC.

# 88. Network route state

- UNKNOWN
- DIRECT_VERIFIED
- SYSTEM_PROXY_VERIFIED
- EXPLICIT_PROXY_VERIFIED
- ENTERPRISE_MANAGED_VERIFIED
- CHANGED_REVERIFY_REQUIRED
- BLOCKED

# 89. Capture session lifecycle

```text
REQUESTED
→ PERMISSION_CHECK
→ DEVICE_BOUND
→ ACTIVE
→ STOP_REQUESTED
→ STOP_CONFIRMED
```

Abnormal:
- PERMISSION_DENIED
- DEVICE_CHANGED
- DEVICE_LOST
- STOP_FAILED
- QUARANTINED_OUTPUT

# 90. Compute isolation state

- STANDARD_READY
- ISOLATED_STARTING
- ISOLATED_READY
- ACTIVE
- DRAINING
- CLEANUP
- CLEAN
- QUARANTINED

A new sensitive job does not enter ACTIVE until prior isolated context cleanup policy is satisfied.

# 91. Deletion assurance state

- LOGICALLY_REMOVED
- CRYPTO_ERASURE_CONFIRMED
- BEST_EFFORT_OVERWRITE
- PHYSICAL_ERASURE_UNVERIFIED
- EXTERNAL_RETENTION_UNKNOWN

These are evidence states, not marketing labels.

# 92. Maintenance admission lifecycle

```text
PLANNED
→ RESOURCE_ESTIMATED
→ ADMISSION_CHECK
→ RESERVED
→ RUNNING
→ VERIFYING
→ COMPLETE
```

Alternate:
- BLOCKED_STORAGE_PRESSURE
- BLOCKED_INCOMPATIBLE_MAINTENANCE
- PAUSED
- RECOVERY_REQUIRED
- FAILED

# 93. Notification action lifecycle

- ISSUED
- DELIVERED
- CLICKED
- REVALIDATING
- EXECUTED
- STALE
- OBSOLETE
- EXPIRED
- UNAUTHORIZED

# 94. Suspend/resume lifecycle

System:
- RUNNING
- SUSPENDING
- SUSPENDED
- RESUMING
- RECONCILING
- RUNNING

Scheduler external retry/timeout actions are blocked during RECONCILING.



# 95. Pricing snapshot state

- CURRENT
- STALE_WITHIN_CEILING
- STALE_MATERIAL
- EXPIRED
- UNKNOWN

Material/expired price state may require REPLAN before paid dispatch.

# 96. Billing reconciliation state

- RECEIVED
- IDENTITY_RESOLVED
- PENDING_ORIGINAL
- POSTED
- CORRECTED
- REFUND_PENDING
- REFUND_SETTLED
- DUPLICATE_LINE
- DISPUTED
- UNRECONCILED

Transport event ordering does not determine financial event ordering.

# 97. Retention hold lifecycle

- ACTIVE
- EXPIRED
- RELEASED
- REVOKED

Purge eligibility is a separate projection after dependency/rights/backup checks.

# 98. Portable archive lifecycle

```text
PLANNED
→ CLOSURE_RESOLVED
→ MATERIALIZING_EXTERNALS
→ BUILDING
→ VERIFYING
→ SEALED
```

Alternate:
- BLOCKED_SECRET_REFERENCE
- BLOCKED_MISSING_MEDIA
- BLOCKED_RIGHTS
- INCOMPATIBLE
- CORRUPT
- MIGRATION_REQUIRED

# 99. Historical signature verification state

- VALID_CURRENT
- VALID_HISTORICAL_POLICY_ACCEPTS
- VALID_BUT_KEY_LATER_REVOKED
- TIMESTAMP_EVIDENCE_MISSING
- INVALID
- UNKNOWN_TRUST

Policy verdict is explicit; historical evidence is not rewritten.

# 100. Project transfer scope state

- PLANNING
- CLOSURE_READY
- NEEDS_DECISION
- APPROVED
- EXECUTING
- COMPLETE
- STALE_SCOPE
- BLOCKED_PRIVACY
- BLOCKED_RIGHTS

# 101. Shared craft-memory eligibility

- PROJECT_LOCAL_ONLY
- OPT_IN_PENDING
- ELIGIBLE_SHARED
- REVOKED
- PURGE_PENDING
- PURGED

# 102. Compensation readiness state

Independent axes:
- TAKEDOWN_READY | TAKEDOWN_UNAVAILABLE | TAKEDOWN_UNKNOWN
- REPLACE_READY | REPLACE_UNAVAILABLE | REPLACE_UNKNOWN
- CREDENTIAL_READY | CREDENTIAL_REAUTH_REQUIRED
- VERIFY_SUPPORTED | VERIFY_UNSUPPORTED | VERIFY_UNKNOWN



# 61. Release build and signing lifecycle

Release build:
```text
PLANNED
→ SOURCE_FROZEN
→ BUILDING
→ ARTIFACT_ATTESTED
→ COMPLIANCE_VERIFIED
→ MANIFEST_FROZEN
→ SIGNING_AUTHORIZED
→ SIGNED
→ PUBLISH_READY
```

Failures:
- SOURCE_DRIFT
- ATTESTATION_FAILED
- SBOM_MISMATCH
- LICENSE_BLOCKED
- PRIVACY_SCAN_FAILED
- SIGNING_BLOCKED
- REVOKED

Artifact identity is immutable after ARTIFACT_ATTESTED.

# 62. Installer transaction lifecycle

```text
PLANNED
→ PREFLIGHT
→ STAGED
→ VERIFIED
→ ELEVATION_AUTHORIZED
→ INSTALLING
→ SYSTEM_CHANGES_APPLIED
→ ACTIVATING
→ HEALTH_CHECK
→ ACTIVE
```

Failure branches:
- FAILED_PREFLIGHT
- FAILED_SIGNATURE
- FAILED_INSTALL
- PARTIAL_SYSTEM_CHANGES
- COMPENSATING
- COMPENSATED
- RECOVERY_REQUIRED

Uninstall:
`PREFLIGHT → OWNERSHIP_CHECK → REMOVING_OWNED → VERIFY_USER_DATA → COMPLETE`

User/project/media data is never classified as installer-owned merely because of path proximity.

# 63. Update anti-rollback state

Update candidate:
- ALLOWED
- BELOW_MINIMUM_VERSION
- REVOKED
- STALE_MANIFEST
- WRONG_BASE
- INCOMPATIBLE_SCHEMA
- UNKNOWN_REVOCATION_FRESHNESS

UNKNOWN_REVOCATION_FRESHNESS never silently becomes ALLOWED under strict profile.

# 64. Signing key/service authorization state

Signing request:
- REQUESTED
- MANIFEST_VERIFIED
- PROVENANCE_VERIFIED
- POLICY_AUTHORIZED
- SIGNED
- REJECTED

Reject if:
- digest differs;
- key purpose mismatch;
- release source unauthorized;
- gate evidence stale;
- key revoked/expired.

# 65. Updater/bootstrapper state

- HEALTHY
- UPDATE_AVAILABLE
- STAGING_SELF_UPDATE
- SWITCH_PENDING
- ACTIVE_NEW
- ROLLBACK_READY
- DEGRADED
- RECOVERY_MODE

Main app failure cannot automatically mark updater HEALTHY if updater verification itself failed.



# 66. Privacy purge lifecycle

```text
REQUESTED
→ TOMBSTONED
→ CANONICAL_REMOVED
→ DERIVED_CLEANUP
→ RETENTION_RECONCILIATION
→ EXTERNAL_RECONCILIATION
→ COMPLETE_TO_POLICY_SCOPE
```

Alternate:
- BLOCKED_HOLD
- PARTIAL_EXTERNAL_RESIDUE
- FAILED_RETRYABLE
- FAILED_FINAL

The state is not COMPLETE merely because canonical DB rows are gone.

# 67. Semantic index entry lifecycle

- ACTIVE
- STALE
- PURGE_PENDING
- PURGED
- QUARANTINED

A source rights/privacy change can move ACTIVE directly to STALE/PURGE_PENDING.

# 68. Inference session lifecycle

- CREATED
- ACTIVE
- RESET_REQUIRED
- RESETTING
- RESET
- TAINTED
- CLOSED

A privacy/project scope change requires RESET_REQUIRED unless isolation class is STATELESS or a fresh process/session is used.

TAINTED sessions cannot accept new production work.

# 69. Learning derivative lifecycle

- ACTIVE
- QUARANTINED
- RETRAIN_REQUIRED
- BLOCKED
- RETIRED

Source revocation may propagate ACTIVE → QUARANTINED/RETRAIN_REQUIRED according to policy.

# 70. Privacy generation lifecycle

Privacy revision:
- DRAFT
- ACTIVE
- SUPERSEDED

Queued outbound operation:
- AUTHORIZED_AT_PLAN
- REVALIDATION_REQUIRED
- AUTHORIZED_TO_SEND
- BLOCKED_BY_NEW_POLICY
- SENT

# 71. Library writer ownership lifecycle

- UNOWNED
- ACQUIRING
- OWNED
- DRAINING
- RELEASED
- STALE
- RECOVERING

Only one process may be OWNED for a writable library.
A second Core remains CLIENT_OR_BLOCKED, never co-writer.

# 72. Archive lifecycle

- BUILDING
- SEALED
- VERIFIED
- READ_ONLY_OPEN
- IMPORTED_COPY_CREATED
- VERIFICATION_FAILED

READ_ONLY_OPEN cannot transition into mutable migration of the sealed archive itself.

# 73. External exposure lifecycle

Exposure record:
- RECORDED
- PROVIDER_RETENTION_UNKNOWN
- TAKEDOWN_REQUESTED
- TAKEDOWN_CONFIRMED
- RETENTION_EXPIRED
- UNRESOLVED

Local purge never deletes historical exposure truth merely to show a cleaner status.



# 74. Collaboration branch lifecycle

```text
ACTIVE_ONLINE
→ OFFLINE
→ RECONNECTING
→ REBASE_ANALYSIS
→ READY_TO_MERGE
→ MERGING
→ MERGED
```

Alternate:
- REBASE_ANALYSIS → CONFLICT
- CONFLICT → RESOLVING → READY_TO_MERGE
- any nonterminal → ABANDONED
- unsupported/too-old queue → IMPORT_AS_BRANCH_REQUIRED

# 75. Collaboration conflict lifecycle

- OPEN
- RESOLVING
- RESOLVED
- DISMISSED
- OBSOLETE

A conflict becomes OBSOLETE if canonical state changed so much that the proposed resolution no longer applies.

# 76. Actor/device authority state

Actor:
- ACTIVE
- SUSPENDED
- DISABLED
- REMOVED

Device:
- ACTIVE
- REVOKED
- LOST
- RETIRED

Current state is checked at sync/irreversible action; historical authority does not survive revocation.

# 77. Collaboration lock lifecycle

- REQUESTED
- ACTIVE
- OFFLINE_GRACE
- EXPIRED
- REVOKED
- RELEASED

OFFLINE_GRACE cannot mint new privileged/canonical authority; final canonical merge still revalidates with Core.

# 78. Canonical promotion race

```text
PROPOSED
→ CAS_CHECK
→ APPLIED
```

or:
- CAS_CHECK → CONFLICT
- CAS_CHECK → AUTHORITY_REVOKED
- CAS_CHECK → STALE_CANDIDATE

Exactly one concurrent promotion may apply for a given expected current revision.

# 79. Offline action class

Action policy:
- OFFLINE_ALLOWED_DRAFT
- OFFLINE_ALLOWED_CANDIDATE
- ONLINE_REQUIRED
- ONLINE_IRREVERSIBLE

Rights/security/publish/credential/high-cost final actions are ONLINE_REQUIRED/ONLINE_IRREVERSIBLE.



# 80. External circuit breaker lifecycle

- CLOSED
- OPEN
- COOLDOWN
- HALF_OPEN
- RECOVERING
- CLOSED_VERIFIED

Transitions:
- CLOSED → OPEN on threshold/policy trigger
- OPEN → COOLDOWN
- COOLDOWN → HALF_OPEN when eligible
- HALF_OPEN → OPEN on failed probe
- HALF_OPEN → RECOVERING on bounded successful probes
- RECOVERING → CLOSED_VERIFIED after ramp success

Only coordinator grants HALF_OPEN probe slots.

# 81. Retry budget lifecycle

- ACTIVE
- WAITING_BACKOFF
- WAITING_RECONCILIATION
- EXHAUSTED
- MANUAL_EXTENSION_REQUIRED
- RESOLVED

Restart/requeue does not reset attempts_used.

# 82. Maintenance deadline state

- PLANNED
- BORROWING_CAPACITY
- RECLAIMING_CAPACITY
- READY
- RUNNING
- COMPLETE
- AT_RISK
- MISSED
- BLOCKED

AT_RISK triggers Flow/System attention before deadline is missed.

# 83. Fallback ramp state

- PRIMARY
- EVALUATING_FALLBACK
- CANARY_FALLBACK
- RAMPING
- FALLBACK_ACTIVE
- RECOVERING_PRIMARY
- PRIMARY_RESTORED

Anti-oscillation cooldown prevents rapid A↔B flip-flop.



# 84. Browser profile lifecycle

- CREATING
- READY
- DEGRADED
- DRAINING
- UPDATING
- TESTING
- CANARY
- QUARANTINED
- REAUTH_REQUIRED
- REMOVED

# 85. Browser auth session lifecycle

```text
CREATED
→ NAVIGATING_AUTH
→ WAITING_PROVIDER
→ CALLBACK_RECEIVED
→ TOKEN_OR_SESSION_ESTABLISHED
→ ACCOUNT_IDENTITY_VERIFY
→ READY
```

Failures:
- STATE_MISMATCH
- NONCE_MISMATCH
- REDIRECT_OWNERSHIP_FAILED
- ORIGIN_MISMATCH
- ACCOUNT_MISMATCH
- EXPIRED
- CANCELLED

# 86. Browser automation execution

- PRECONDITION_CHECK
- NAVIGATING
- ACTION_READY
- EXECUTING
- POSTCONDITION_VERIFY
- WAITING_EXTERNAL
- RESULT_OBSERVED
- DOWNLOADING
- ASSOCIATING
- COMPLETE

Interruptions:
- AUTH_CHALLENGE
- HUMAN_TAKEOVER
- ORIGIN_CHANGED
- SEMANTIC_FINGERPRINT_CHANGED
- PROFILE_DEGRADED
- DOWNLOAD_AMBIGUOUS

# 87. Human takeover state

- REQUESTED
- HUMAN_ACTIVE
- RESUME_REQUESTED
- VERIFYING_CHECKPOINT
- RESUMED
- NEEDS_RECONCILIATION
- CANCELLED
