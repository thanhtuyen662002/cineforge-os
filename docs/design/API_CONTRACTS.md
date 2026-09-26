# CineForge OS — API, IPC & Connector Contracts v1

> Status: implementation baseline.
> Goal: keep UI, workers, connectors and future external controllers independent from database/storage internals.

# 1. API architecture

CineForge uses Command/Query/Event separation over a local authenticated Core interface.

```text
Desktop UI
Assistant
Automation
Future external controller
        │
        ▼
Local Core API
  ├─ Command
  ├─ Query
  ├─ Event stream
  └─ Media resolver
        │
        ▼
Studio Kernel / Orchestrator / Data Plane
```

V1 transport may use Tauri IPC/local RPC, but contracts are transport-neutral.

No client:
- opens SQLite directly;
- writes object store directly;
- executes provider callbacks as state changes;
- sends arbitrary shell commands.

# 2. Message envelope

Every request is executed inside an authenticated Core session. Client-supplied actor identity is never trusted by itself.

The Core derives the authoritative actor/session identity from the authenticated local session/connection. If `actor_id` is present in the envelope for tracing, it must match the authenticated session or the request is rejected.

Example request:

```json
{
  "api_version": "1",
  "request_id": "uuidv7",
  "actor_id": "uuidv7",
  "locale": "vi-VN",
  "method": "command.execute",
  "params": {},
  "idempotency_key": "optional",
  "expected_versions": {}
}
```

Every response:

```json
{
  "request_id": "uuidv7",
  "ok": true,
  "result": {},
  "projection_seq": 123456,
  "warnings": []
}
```

Error:

```json
{
  "request_id": "uuidv7",
  "ok": false,
  "error": {
    "code": "STALE_REVISION",
    "category": "CONFLICT",
    "user_message_key": "errors.stale_revision",
    "user_message_args": {},
    "retryable": false,
    "needs_user": true,
    "decision_request_id": null,
    "technical_details": {}
  }
}
```

# 3. Error categories

Stable categories:
- VALIDATION
- CONFLICT
- STALE_REVISION
- POLICY_DENIED
- RIGHTS_BLOCKED
- AUTH_REQUIRED
- EXTERNAL_UNAVAILABLE
- CAPACITY
- RATE_LIMITED
- QUOTA_EXHAUSTED
- STORAGE_PRESSURE
- CORRUPT_MEDIA
- UNSUPPORTED_MEDIA
- CANCEL_UNCONFIRMED
- SECURITY_QUARANTINE
- MIGRATION_REQUIRED
- SAFE_MODE
- INTERNAL

UI never parses human meaning from raw provider text.

# 4. Command API

Primary method:
- `command.plan`
- `command.execute`
- `command.cancel`
- `command.compensate`
- `command.get`

## command.plan
Used before high-impact actions.

Input:
- command_type
- scope
- payload
- expected_versions

Output:
- command draft id
- precondition result
- impact summary
- affected entities/counts
- stale consequences
- estimated cost/time/storage
- privacy/rights impact
- reversibility
- required authority
- confirmation requirement
- generated DecisionRequest if needed

No canonical mutation occurs.

## command.execute
Executes an approved typed command.

Rules:
- can reference a prior plan;
- verifies impact inputs have not gone stale;
- idempotency-safe;
- returns immediately for long-running work with command/job IDs.

## command.cancel
Cancellation semantics are command-specific.
Response must distinguish:
- cancellation accepted;
- cancellation confirmed;
- cannot cancel;
- cancellation requested but external state unknown.

## command.compensate
Creates a new compensating command; never rewrites event history.

# 5. Query API

Queries are side-effect free and projection-oriented.

Common query methods:
- `query.home`
- `query.project.summary`
- `query.project.health`
- `query.project.activity`
- `query.needs_you.list`
- `query.entity.get`
- `query.entity.history`
- `query.search`
- `query.library.assets`
- `query.scene.workspace`
- `query.shot.workspace`
- `query.character.workspace`
- `query.timeline.get`
- `query.timeline.impact`
- `query.connections`
- `query.connection.detail`
- `query.jobs`
- `query.storage.summary`
- `query.storage.cleanup_preview`
- `query.release.readiness`
- `query.system.health`

Every query that can become stale returns:
- projection_seq;
- generated_at;
- relevant row/entity version(s).

# 6. Event subscription API

UI subscribes to a resumable event stream:

`events.subscribe({ after_seq, scopes, event_classes })`

Event envelope:

```json
{
  "seq": 12345,
  "event_id": "uuidv7",
  "event_class": "PROJECT_ACTIVITY",
  "project_id": "...",
  "entity_type": "SHOT",
  "entity_id": "...",
  "human_state": {
    "message_key": "shot.waiting_flow",
    "args": {"shot":"SH031"},
    "needs_user": false,
    "blocking": false
  },
  "occurred_at": "..."
}
```

Reconnect:
- client sends last confirmed seq;
- Core replays retained events/projection notifications;
- UI never assumes no event occurred while disconnected.

Domain event payloads are not necessarily exposed raw to UI; a stable presentation event layer may project them.

# 6.1 Event cursor expiry and backpressure

The resumable UI event stream is a presentation/event-notification layer, not an infinite transport guarantee.

If `after_seq` is older than retained presentation events:
- Core returns `CURSOR_TOO_OLD`;
- UI performs a fresh projection/query refresh;
- subscription resumes from the returned current checkpoint.

Slow subscribers may be disconnected/restarted rather than forcing Core to retain unbounded notification buffers.

Canonical domain/audit records retain their own policy independently from UI notification retention.

# 7. Media resolver API

Large binary data never travels as base64 IPC payload.

Methods:
- `media.resolve_preview(asset_revision_id, purpose)`
- `media.resolve_original(asset_revision_id, access_intent)`
- `media.resolve_waveform(asset_revision_id)`
- `media.resolve_thumbnail(asset_revision_id)`

Response returns a short-lived scoped local media token/URL handled by CineForge.

Rules:
- no unrestricted filesystem root exposure;
- token scope includes exact asset revision;
- original access may require authority/policy;
- browser/web worker receives staged copies, not arbitrary local paths.

# 8. File/folder picker boundary

OS path selection is performed by trusted Desktop/Core boundary.

External connectors receive:
- asset handles;
- staged sandbox paths;
- opaque references;

not raw unrestricted user filesystem permissions.

# 9. Core domain command catalog

## Project
- CreateProject
- UpdateProjectMetadata
- ChangeProjectMediaProfile
- PauseProject
- ArchiveProject
- TrashProject
- RestoreProject
- DuplicateProject

## Import
- BeginImportSession
- AddImportSource
- AcceptSemanticMapping
- RejectSemanticMapping
- CommitImport
- CancelImport
- RelinkExternalSource

## Story/Script
- CreateScript
- ImportScriptRevision
- AcceptScriptBreakdown
- EditFilmBible
- ApproveFilmBibleRevision
- ResolveStoryConflict

## Character/Canon
- CreateCharacter
- CreateVisualIdentityRevision
- ApproveVisualIdentityRevision
- CreateVoiceIdentityRevision
- CertifyVoiceBinding
- BindCostume
- BindProp
- ChangeCharacterState
- WaiveStaleness

## Production
- CreateShot
- UpdateShotSpec
- GenerateShot
- GenerateDialogue
- StopGenerationAfterCandidate
- CancelJob
- RetryJob
- SelectCandidate
- RequestRepair

## Review
- OpenReview
- SubmitReview
- ApproveRevision
- RejectRevision
- RequestRepairFromReview
- ResolveDecision

## Timeline
- BeginTimelineWorkingSession
- ApplyTimelineEditOp
- UndoTimelineEditOp
- RedoTimelineEditOp
- CheckpointTimeline
- ApproveTimelineRevision

## Connections
- AddConnection
- TestConnection
- GrantConnectionPermission
- RevokeConnectionPermission
- DrainConnection
- DisableConnection
- RemoveConnection
- InstallCapabilityPack
- UpdateConnector
- PinConnectorVersion

## Storage
- TrashEntity
- RestoreTrash
- PlanStorageCleanup
- ExecuteStorageCleanup
- MoveLibrary
- CreateBackup
- VerifyBackup
- RestoreBackup

## Delivery
- CreateExport
- CreateHandoff
- RegisterExternalEdit
- CreateReleaseCandidate
- ApproveRelease
- PublishRelease
- RequestTakedown

# 10. Natural-language assistant API

The assistant is not a privileged backdoor.

Methods:
- `assistant.interpret`
- `assistant.explain_state`
- `assistant.explain_decision`
- `assistant.suggest_next`

`assistant.interpret` output:

```json
{
  "intent_summary": "...",
  "proposed_commands": [],
  "ambiguities": [],
  "impact_required": true,
  "execution_allowed_without_confirmation": false
}
```

Execution still uses normal Command Engine.

Assistant context is assembled by Context Compiler with minimum necessary data and scope.

# 11. Context Compiler contract

Input:
- target task;
- project/scene/shot;
- required capability;
- user/automation policy.

Output manifest contains:
- authoritative source revisions;
- critical constraints;
- continuity snapshot;
- language/translation choices;
- rights/privacy constraints;
- omitted sections and reason;
- token/size budget;
- compiled provider-specific representation hash.

Critical constraint inclusion is validated before dispatch.

# 12. Job API

Methods:
- `jobs.create` internal only through Orchestrator
- `jobs.get`
- `jobs.list`
- `jobs.cancel`
- `jobs.retry_plan`
- `jobs.retry`
- `jobs.logs` advanced
- `jobs.artifacts`

UI uses human projections; raw worker logs are Advanced.

# 13. DecisionRequest API

- `decisions.list`
- `decisions.get`
- `decisions.resolve`
- `decisions.dismiss`

Resolve request includes:
- decision_request_id
- choice_id
- expected_decision_version

Core rejects stale/obsolete decision resolution.

# 14. Import API detail

`imports.begin`
returns import_session_id.

`imports.add_sources`
accepts trusted picker handles, clipboard payload or URL descriptor.

`imports.preview`
returns:
- items;
- technical validation;
- duplicates;
- semantic candidates;
- estimated storage;
- security warnings.

`imports.commit`
requires accepted/explicit mappings for ambiguous items.

Large folder imports stream item progress; no one giant blocking response.

# 15. Character/voice API detail

`characters.get_workspace`
returns:
- logical identity;
- approved visual revision;
- candidate revisions;
- voice packages/bindings;
- costume/prop current state;
- usage/impact counts;
- rights summary;
- Needs You items.

`voices.audition`
uses a standard test script and returns comparable candidate takes.

`voices.change_plan`
returns language-by-language and dialogue/shot impact before voice replacement.

# 16. Timeline API detail

Working session methods:
- `timeline.begin_session`
- `timeline.apply_ops`
- `timeline.undo`
- `timeline.redo`
- `timeline.autosave`
- `timeline.checkpoint`
- `timeline.close_session`

Operations are typed:
- INSERT_CLIP
- MOVE_CLIP
- TRIM_CLIP
- SPLIT_CLIP
- DELETE_CLIP
- RETIME_CLIP
- SET_TRANSFORM
- SET_GAIN
- LINK
- UNLINK
- ADD_TRANSITION
- REMOVE_TRANSITION
- ADD_MARKER
- UPDATE_CAPTION

Batch application is atomic at working-session level where possible.

Timeline op response includes impacted dependent domains:
- subtitles;
- audio;
- lip-sync;
- music;
- release readiness.

# 17. Review API detail

`review.open` must specify:
- subject revision;
- representation revision;
- review policy.

`review.submit` includes:
- decision;
- reason codes;
- notes;
- issue markers;
- expected subject dependency hash.

If dependency hash changed while reviewer watched, submit returns STALE_REVIEW rather than silently approving old state.

# 18. Storage API detail

`storage.summary` separates:
- project data;
- originals;
- approved canon;
- models;
- cache;
- temp;
- exports;
- backups;
- trash.

`storage.cleanup_preview` returns:
- exact object count;
- reclaimable bytes;
- reasons;
- protected blockers;
- rebuildability proof summary.

Execute cleanup requires dry-run generation/version token.

# 19. Release API detail

`release.readiness` returns gates:
- picture;
- audio;
- localization;
- technical media;
- QC;
- rights;
- missing media;
- unresolved decisions.

A gate is:
- PASS
- FAIL
- UNKNOWN
- NOT_APPLICABLE

UNKNOWN can block depending on release policy.

Publish API requires immutable release_manifest_id, never “current project”.

# 20. Connector host interface

Every connector implementation exposes a versioned host contract.

Required:
- `describe()`
- `discover_capabilities()`
- `health_check()`
- `estimate(request)`
- `validate(request)`
- `execute(request, context)`
- `poll(external_job)` when applicable
- `cancel(external_job)` when applicable
- `normalize_output(raw_result)`
- `reconcile(external_job)`
- `shutdown()`

Optional:
- `resume()`
- `stream_progress()`
- `list_models()`
- `get_quota()`

Connector never receives database connection.

# 21. Connector request envelope

Contains only necessary scoped data:
- job_attempt_id
- semantic capability
- pinned connector version
- normalized inputs
- staged asset handles
- compiled provider payload
- policy constraints
- deadline
- cost reservation
- cancellation token
- output staging destination

No global studio context by default.

# 22. Connector output normalization

Normalized result:
- external_job_id
- status
- output artifacts
- provider metadata snapshot
- cost/usage if known
- warnings
- raw response hash
- resumability/cancellation info

Artifacts first enter STAGING/QUARANTINE and are verified before registration.

# 23. MCP broker contract

MCP server registration captures:
- server identity;
- transport;
- tool/resource schema fingerprint;
- granted capability mapping;
- permission scopes;
- connector version.

On each call:
1. validate schema fingerprint;
2. authorize exact MCP tool;
3. stage only allowed resources;
4. execute;
5. sanitize/validate result;
6. record trace/evidence.

A new MCP tool discovered later is disabled until explicitly mapped/authorized.

# 24. CLI runner contract

Manifest example:

```json
{
  "binary": "ffmpeg",
  "version_rule": ">=...",
  "binary_hash": "...",
  "allowed_subcommands": ["..."],
  "arg_schema": {},
  "network": "DENY",
  "read_scopes": ["STAGED_INPUTS"],
  "write_scopes": ["JOB_OUTPUT"],
  "timeout_policy": {},
  "exit_codes": {}
}
```

Arguments are built from typed fields, not string concatenation.

# 25. Browser connector contract

Browser connector must support:
- profile health;
- exclusive/shared concurrency declaration;
- human takeover checkpoint;
- upload trace;
- prompt/reference fingerprint;
- generation detection;
- download trace;
- output association confidence.

If association confidence is below policy threshold:
- create DecisionRequest;
- output remains UNVERIFIED_ASSOCIATION.

# 26. API versioning

Three independent versions:
- Core API version;
- domain schema/event version;
- connector host contract version.

Compatibility is explicit.

Never infer compatibility from app semantic version alone.

# 27. Pagination/search

List query:
- cursor-based pagination;
- stable sort key;
- optional project/scope filters;
- locale-independent identifiers.

Search:
- returns identity ref + match explanation;
- vector/semantic result is never treated as entity identity;
- user can distinguish exact vs semantic match.

# 28. Localization contract

API returns stable:
- message keys;
- structured args;
- enum codes.

UI performs locale rendering.

Creative text is not translated merely because UI locale changes.

# 29. Security rules

- every request has actor context derived from authenticated session/connection;
- client-supplied actor_id cannot elevate or switch identity;
- privileged commands require permission/authority;
- local RPC endpoint is not unauthenticated just because it is localhost;
- secrets never appear in normal API responses;
- technical logs redact credentials and sensitive auth state;
- file access uses scoped handles/tokens;
- imported/generated text cannot invoke commands without explicit assistant interpretation + command policy.

# 30. API contract tests

Required:
- version compatibility;
- idempotent command replay;
- stale expected_versions;
- duplicate callback;
- reconnect event replay;
- cancel/late completion;
- stale review;
- obsolete DecisionRequest;
- unauthorized connection scope;
- rights/privacy denial;
- storage pressure;
- large import streaming;
- browser ambiguous download;
- connector schema drift;
- Core restart during long job;
- safe-mode read access after migration failure.


# 31. Production planning API

Queries:
- `query.production.plan`
- `query.production.critical_path`
- `query.production.bottlenecks`
- `query.production.milestones`
- `query.production.wip`

Commands:
- CreateProductionTask
- UpdateProductionTask
- AssignProductionTask
- AddTaskDependency
- RemoveTaskDependency
- CreateMilestone
- UpdateMilestone
- SetWipPolicy

Critical-path query returns:
- critical tasks;
- blocking DecisionRequests;
- resource bottlenecks;
- confidence/assumptions for estimated duration.

No client sets “project 72% complete” directly; progress is derived from task/milestone/shot evidence.

# 32. Policy and preference API

Queries:
- `query.policy.effective(scope)`
- `query.policy.inheritance(scope)`
- `query.policy.diff(parent, child)`

Commands:
- CreatePolicyRevision
- BindPolicy
- RemovePolicyOverride
- ChangeControlMode
- CreateCreativeException
- RevokeCreativeException

Effective-policy response includes origin for every significant value so UI can say:
“Ưu tiên Flow — inherited from Scene 14.”

# 33. Audio and dialogue production API

Queries:
- `query.audio.scene`
- `query.dialogue.conversation`
- `query.audio.mix_structure`
- `query.audio.acoustic_profile`

Commands:
- CreateConversationSession
- CreateAudioCue
- RecordDialogueTake
- GenerateDialogueTake
- SelectDialogueTake
- CreateADRReplacement
- BindRoomTone
- AssignCueToMixBus
- ApproveAudioCue

Audio generation requests receive conversation/performance context, not isolated text only.

# 34. Music API

Queries:
- `query.music.themes`
- `query.music.cues`
- `query.music.spotting`

Commands:
- CreateMusicTheme
- CreateMusicThemeRevision
- SpotMusicCue
- GenerateMusicCue
- SelectMusicCueCandidate
- ApproveMusicCue
- MarkIntentionalSilence

Timeline changes may return a music-impact set rather than regenerating automatically.

# 35. Localization API

Queries:
- `query.localization.packages`
- `query.localization.translation_units`
- `query.localization.subtitle_track`
- `query.localization.dubbing_track`

Commands:
- CreateLocalizationPackage
- CreateTranslationUnit
- ApproveTranslationUnit
- CreateSubtitleTrack
- TimeSubtitleSegment
- ApproveSubtitleTrack
- CreateDubbingTrack
- BindLocalizedDialogueTake
- ApproveDubbingTrack
- CreateAccessibilityTrack

Original creative text remains addressable alongside localization.

# 36. Composition/VFX API

Queries:
- `query.composition.workspace`
- `query.composition.layers`
- `query.composition.passes`

Commands:
- CreateComposition
- CreateCompositionRevision
- AddCompositionLayer
- ReplaceCompositionLayer
- BindRenderPass
- ApproveCompositionRevision

Layer replacement command runs dependency impact scoped to composition graph.

# 37. Worker/resource API

Advanced queries:
- `query.workers`
- `query.resources`
- `query.scheduler.capacity`

Normal UI should use derived phrases, not raw telemetry.

Internal worker methods:
- `worker.register`
- `worker.heartbeat`
- `worker.claim`
- `worker.release`
- `worker.report_resource_sample`

Worker claim requires fencing token and exact attempt ID.

# 38. Provisioning/package API

Queries:
- `query.packages.available`
- `query.packages.installed`
- `query.packages.impact(package)`
- `query.provisioning.recommendations`

Commands:
- InstallPackage
- UpdatePackage
- PinPackage
- UnpinPackage
- DrainPackageUsers
- RemovePackage
- RepairPackage
- VerifyPackage

Install/update responses include:
- download size;
- disk impact;
- compatibility;
- signature publisher;
- restart requirement;
- affected pinned projects.

# 39. Storage root/library API

Queries:
- `query.storage.roots`
- `query.storage.volumes`
- `query.storage.staging_orphans`

Commands:
- AddStorageRoot
- ChangeStorageReserve
- MoveStorageRoot
- ReconcileStaging
- QuarantineOrphan
- AdoptVerifiedOrphan

No user-facing adoption of orphan output without verified job/import lineage.

# 40. Diagnostics/support API

Queries:
- `query.health.graph`
- `query.health.summary`
- `query.diagnostics.recent_failures`

Commands:
- CreateDiagnosticBundle
- DeleteDiagnosticBundle
- RepairConnection
- RestartWorker
- RebuildProjection
- EnterSafeMode
- ExitSafeMode

Diagnostic bundle plan must show:
- included classes;
- excluded sensitive classes;
- approximate size;
- whether raw media is included.

# 41. Notification API

- `query.notifications`
- `notifications.mark_read`
- `notifications.dismiss`

Notification delivery is not authoritative task state.
Needs You is derived from DecisionRequest, not notification-read status.

# 42. Editorial conform metadata API

`query.media.conform_metadata(asset_revision_id)`
returns:
- stable media UUID;
- reel/source identifier;
- source timecode;
- frame/timebase;
- VFR flag;
- proxy/original relation.

Handoff create request accepts handle duration policy and target editor capability profile.

# 43. Read-only compatibility API

When Core enters SAFE_MODE or historical package is unavailable:
- queries remain available;
- media preview for present assets remains available;
- export of existing readable assets may be allowed by policy;
- mutating/execution commands return SAFE_MODE/MISSING_DEPENDENCY.

Archive readability must not require resurrecting obsolete AI runtimes.

# 44. API red-team rule

A new UI action is not allowed to call a newly invented ad-hoc method directly.

Before adding an API:
1. identify the typed command/query domain owner;
2. define state transition;
3. define idempotency/stale semantics;
4. define human-readable long-operation projection;
5. define rights/privacy/cost/storage impact;
6. add contract tests.

If any item is unknown, the action is not API-ready.


# 45. Provider terms and legal execution API

Queries:
- `query.provider_terms.current(connection_id)`
- `query.provider_terms.history(connection_id)`
- `query.execution.terms_binding(job_attempt_id)`

Commands:
- CaptureProviderTermsSnapshot
- MarkProviderTermsRequiresReview
- ApproveProviderTermsForPolicy

Before an external execution, policy may require a current accepted ProviderTermsSnapshot.
Before release, Rights/Release engine can report executions whose provider terms changed materially after generation.

Historical execution bindings are immutable.

# 46. Learning governance API

Queries:
- `query.learning.failure_lake`
- `query.learning.golden_sets`
- `query.learning.benchmarks`
- `query.learning.shadow_runs`
- `query.learning.promotion_candidates`
- `query.learning.systemic_monitors`

Commands:
- LabelFailureExample
- CurateGoldenExample
- StartBenchmarkRun
- StartShadowEvaluation
- RequestPromotionReview
- PromoteComponentVersion
- RollbackComponentVersion
- DeprecateHeuristic

Promotion command requires:
- successful required benchmark stages;
- policy-compatible human approval where configured;
- rollback target;
- no unresolved systemic-monitor blocking alert.

Production feedback cannot directly call PromoteComponentVersion.


# 47. Creative variant API

Queries:
- query.variants.list(subject_entity_id)
- query.variants.compare(variant_group_id)

Commands:
- CreateVariantGroup
- AddVariantCandidate
- RejectVariantCandidate
- PromoteVariantCandidate
- ArchiveVariantGroup

Promotion plan returns:
- candidate/base revision context;
- affected dependencies;
- approved descendants affected;
- cost/time implications when regeneration may follow;
- stale/conflict status.

Promotion never directly overwrites an approved base revision.


# 48. Storage root validation API

Before accepting a Core database location:
- `storage.validate_core_db_location(path_handle)`

Returns:
- filesystem/profile classification;
- WAL/locking support status;
- sync/network/removable warning/block;
- free space;
- path normalization result;
- reason when unsupported.

General asset roots use:
- `storage.validate_root(path_handle, root_type)`

The first-run “where to store data” UI may choose separate sensible defaults for:
- active Core DB;
- media/object library;
- models/cache;
- backups/exports.

# 49. Web automation permission API

Connection detail/query exposes effective automation permission:
- ALLOWED
- ASSISTED_ONLY
- MANUAL_ONLY
- UNKNOWN
- BLOCKED

Before browser automation:
1. bind current ProviderTermsSnapshot/policy;
2. resolve effective permission;
3. refuse silent automated execution when UNKNOWN/BLOCKED;
4. downgrade to assisted/manual only when policy permits and user intent remains satisfied.

A connector health result of READY does not imply automation permission.


# Extreme hardening extension

For adversarially discovered API contracts, use `docs/design/EXTREME_HARDENING_CONTRACTS.md`. Do not recreate parallel API definitions in this file.



# 61. Task graph integrity API

Planner/control methods:
- `tasks.validate_dependency_graph`
- `tasks.explain_cycle`
- `tasks.recompute_readiness`

Hard-dependency writes are rejected when they create a cycle.
If manual edits produce an invalid graph, affected tasks become `BLOCKED_DEPENDENCY_CYCLE` until repaired.

# 62. Secure URL intake API

`imports.inspect_url(url, policy_revision)` performs security classification before fetch.

Returns:
- normalized URL/scheme;
- redirect policy;
- current resolved addresses;
- private/link-local/loopback denial;
- content-size/type expectations;
- credential-forwarding policy.

Actual fetch revalidates connect-time address/redirects.
A preflight pass does not authorize an address that changes later.

# 63. Callback verification API

Connector ingress:
- `callbacks.verify_and_register`

Provider adapter supplies:
- raw body/hash;
- signature/token headers;
- provider/account endpoint identity;
- timestamp/nonce/event id where supported.

Only verified/policy-approved events enter `external_inbox_events` as actionable evidence.

# 64. Dependency governance API

Queries:
- `query.dependencies.source_inventory`
- `query.dependencies.license_risks`
- `query.dependencies.security_risks`
- `query.sbom.current`

Commands:
- ProposeDependencyChange
- ApproveDependencyChange
- GenerateSbomSnapshot

A normal feature command may not silently add a new executable dependency outside the dependency-governance path.

# 65. Invariant-test governance API

Queries:
- `query.invariants.active`
- `query.invariants.diff_impact`

CI/governance evaluates changes that:
- delete invariant tests;
- disable them;
- weaken assertions;
- change expected failure semantics.

Such changes require explicit justification and elevated review.

# 66. External source stable-ingest API

For critical ingest/relink:
- `sources.stage_and_fingerprint`
- `sources.revalidate_external_location`

The API returns the cryptographic fingerprint actually bound to the revision/review.
mtime/size/path are hints, not identity.

# 67. Rebuildability dependency API

- `query.rebuildability(asset_revision_id)`
- `query.recipe_dependency_impact(package/license/provider_change)`

Package removal, license revocation and provider deprecation run dependency impact before the system may claim an output is safely rebuildable.

# 68. Integrity auditor API

- `integrity.run(scope)`
- `integrity.get_findings`
- `integrity.reconcile(finding_id, decision)`

Critical findings may force SAFE_MODE or block release/GC depending on policy.

# 69. Local security profile API

- `query.local_security_profile`
- `security.verify_local_acl`
- `security.repair_local_acl`

Core startup can verify user-scoped ACL/IPC assumptions before enabling privileged operations.

# 70. Connection account/workspace verification API

- `connections.verify_identity_scope`

Returns account/tenant/workspace/region identity when provider exposes it.
A configured pin mismatch yields `IDENTITY_MISMATCH` and blocks privileged automation.

# 71. Bulk snapshot API

Planning:
- `bulk.materialize_scope`

Execution:
- `bulk.execute(snapshot_id, command_template)`

The snapshot freezes exact entity/revision membership.
Live filters are never re-evaluated at execution time for an already-confirmed destructive/approval command.



# 72. Installation side-effect ledger API

Internal methods:
- `side_effects.prepare_dispatch`
- `side_effects.record_acceptance`
- `side_effects.record_unknown`
- `side_effects.reconcile`
- `side_effects.query_unreconciled`

Dispatch ordering:
1. persist/fence intent in installation ledger;
2. perform external call;
3. persist provider receipt/unknown state;
4. update project-domain attempt through normal command/event flow.

Project restore does not delete ledger history.

If the installation ledger is unavailable after full disaster restore, Core exposes `EXTERNAL_REALITY_UNKNOWN` and blocks policy-defined risky redispatches.

# 73. Backup authenticity/confidentiality API

`backup.plan` returns:
- target failure domain;
- encryption state;
- manifest authentication method;
- credential portability;
- immutability/offline class.

`backup.verify` validates both content integrity and manifest authenticity according to policy.

# 74. Cache validity API

Before a cache hit:
- `cache.evaluate_validity(cache_entry_id, current_context)`

Rights/privacy/policy changes may make an entry ineligible without deleting historical bytes.

Cache key/validity manifest must distinguish:
- technical reproducibility;
- legal/policy eligibility.

# 75. Callback scope API

`callbacks.verify_and_register` additionally checks:
- expected connection;
- account/tenant/workspace;
- external job correlation;
- recovery/installation fence where available.

Valid signature + wrong scope => quarantine, not acceptance.

# 76. CAS finalize API

`storage.finalize_staging_object` verifies:
- current file identity equals verified staging identity;
- no forbidden reparse/symlink escape;
- content digest still matches;
- destination CAS path is not exposed through a writable alias.

On mismatch, quarantine and do not register READY bytes.


# 77. Core ownership and IPC APIs

Internal/platform:
- `core.acquire_ownership`
- `core.renew_ownership`
- `core.release_ownership`
- `core.inspect_owner`
- `ipc.begin_session`
- `ipc.rebind_after_core_restart`

Mutating request envelope includes:
- installation/library identity;
- core_ownership_epoch;
- ipc_session_id;
- expected protocol version.

A request from an old Core/session epoch is rejected even if the local transport endpoint is reachable.

# 78. Package anti-rollback API

`packages.verify_activation(package_id)` validates:
- trusted signing key/revocation state;
- signed immutable manifest;
- exact content digests;
- package family/version;
- minimum allowed trust/version floor;
- compatibility.

A downgrade below policy floor returns `ROLLBACK_BLOCKED`, not merely a warning.

# 79. High-impact decision snapshot API

`command.plan` for high-impact actions returns:
- impact_snapshot_hash;
- exact entity/revision scope;
- relevant policy/rights versions;
- snapshot expiry/materiality rules.

`command.execute` requires that snapshot and revalidates current critical guards.
Material drift returns `STALE_DECISION` / `REPLAN_REQUIRED`.

# 80. Trusted executable launch API

Internal launcher accepts a managed executable identity, not a free-form command name.

Verification includes:
- absolute managed path;
- package/content identity;
- signature/hash policy;
- sanitized environment;
- loader/plugin search policy.

Unexpected binary/library resolution returns `TRUSTED_BINARY_PATH_MISMATCH`.




# 81. Observability/storage-budget API

Advanced queries:
- `query.observability.retention`
- `query.observability.storage_usage`
- `query.audit.archive_health`
- `query.projections.generations`

Commands/internal:
- RotateOperationalLogs
- ArchiveAuditSegment
- VerifyAuditArchive
- RebuildProjectionGeneration
- ActivateProjectionGeneration

Archive/rotation actions obey legal/rights/security retention policy.

# 82. Maintenance preflight API

`maintenance.plan(operation)` returns:
- final-space estimate;
- worst-case temporary amplification;
- IO/lock class;
- incompatible active maintenance;
- rollback/checkpoint needs;
- required free-space reserve.

`maintenance.execute(plan_id)` rejects stale resource/space assumptions materially outside policy.

# 83. Account circuit-breaker API

Queries:
- `query.connection.incident(connection_id)`
- `query.connection.blocked_jobs(connection_id)`

Internal/commands:
- TripConnectionCircuit
- RequestSharedReauthentication
- VerifyConnectionRecovery
- ResetConnectionCircuit

Many blocked jobs share one account-level DecisionRequest instead of spawning duplicate MFA/CAPTCHA prompts.

# 84. Worker progress watchdog API

Workers report:
- heartbeat;
- phase;
- semantic checkpoint id;
- progress evidence.

Scheduler/health:
- `workers.evaluate_progress`
- `workers.diagnose_stall`

Intervention requires task-specific policy; heartbeat alone is not progress.

# 85. Queue storm/backpressure API

Queries:
- `query.queues.pressure`
- `query.queues.dead_letters`

Internal controls:
- set bounded dispatch/inbox batch;
- pause producer;
- fair-drain by connection/project;
- quarantine oversized/invalid message;
- archive/dead-letter terminal failures.

# 86. Durable error sanitation API

All persisted connector/tool error detail passes:
- `errors.sanitize_external_evidence(raw, policy)`

Result includes:
- redacted structured summary;
- sensitivity class;
- bounded diagnostic sample/hash;
- secret-detection result;
- optional quarantined raw reference under stricter local policy.

Raw provider response is never implicitly copied into normal logs/support bundles.




# 87. Production hierarchy API

Queries:
- `query.production_nodes.tree(project_id)`
- `query.production_node.detail(id)`
- `query.production_node.canon_baseline(id)`

Commands:
- CreateProductionNode
- MoveProductionNode
- SetProductionCanonBaseline
- SupersedeCanonBaseline
- ArchiveProductionNode

Changing a shared canon baseline returns impact by production node and does not rewrite released manifests.

# 88. Narrative context / worldline API

Queries:
- `query.narrative_contexts`
- `query.narrative_context.state_at(context_id, chronology_key)`
- `query.narrative_context.ancestry(context_id)`

Commands:
- CreateNarrativeContext
- ForkNarrativeContext
- BindSceneOccurrence
- MoveSceneOccurrenceChronology
- ResolveContextMergeReference

Continuity resolution always specifies narrative_context_id + chronology_key.

# 89. Casting / performer API

Queries:
- `query.performers`
- `query.character.casting(character_id, scope)`
- `query.performer.rights_impact(person_id)`

Commands:
- CreatePerson
- CreatePerformerProfile
- ProposeCastingBinding
- ApproveCastingBinding
- RevokeCastingBinding
- ReplaceCastingBinding

Casting changes return affected representations/assets/shots and rights implications.

# 90. Production representation API

Queries:
- `query.representations.for_entity(entity_id, scope)`
- `query.representation.usage(id)`

Commands:
- CreateProductionRepresentation
- CreateRepresentationRevision
- BindRepresentationToScope
- ReplaceRepresentationBinding
- ApproveRepresentationRevision

A narrative Character/Prop/Environment remains distinct from any one realization.

# 91. Live-action capture API

Queries:
- `query.shoot_day`
- `query.slates`
- `query.takes`
- `query.capture_rolls`
- `query.take.capture_clips`
- `query.sync_group`

Commands:
- CreateProductionUnit
- CreateShootDay
- CreateSlate
- CreateProductionTake
- ImportCaptureRoll
- BindCaptureClipToTake
- MarkDirectorTakePreference
- CreateSyncGroup
- UpdateSyncOffset
- VerifySyncGroup
- ResolveSlateMetadataConflict

A Take is recorded evidence and is never mutated into an AI generation candidate.

# 92. Camera-card / verified-ingest API

`capture.plan_card_ingest` returns:
- source volume identity;
- file list/count;
- total bytes;
- duplicate candidates;
- destination roots;
- checksum policy;
- required verified copy count.

`capture.commit_card_ingest`:
- copies/stages immutable originals;
- hashes source/destination;
- produces card manifest;
- never deletes source card automatically.

# 93. Documentary source/fact API

Queries:
- `query.documentary.sources`
- `query.documentary.fact_claims`
- `query.documentary.claim_evidence(claim_id)`
- `query.documentary.quote_context(usage_id)`

Commands:
- CreateSourceRecord
- CaptureSourceSnapshot
- RegisterParticipant
- CreateFactClaim
- AddFactClaimEvidence
- ResolveFactConflict
- ApproveFactClaimForUse
- CreateQuoteUsage
- SubmitMeaningReview

Factual approval is independent from creative approval.

# 94. Documentary/release factual gate

`release.readiness` may include factual gates:
- unverified material claims;
- conflicting evidence;
- participant/release rights;
- misleading quote review;
- missing source snapshot/provenance.

Policy decides which block publication for documentary/factual productions.




# 95. Shared Canon Space API

Queries:
- `query.canon_spaces`
- `query.canon_space.mounts(project_id)`
- `query.canon_space.baseline(space_id)`
- `query.canon_space.impact(revision_id)`

Commands:
- CreateCanonSpace
- MountCanonSpace
- PinCanonSpaceBaseline
- BranchCanonSpaceForProject
- ProposeSharedCanonPromotion
- ReviewSharedCanonPromotion
- ArchiveCanonSpace

Project-local approval cannot directly mutate an AUTHOR_SHARED canon space without shared-canon authority.

# 96. Shared canon rights API

`query.canon_entity.production_eligibility(entity_revision_id, production_node_id)`

Returns separately:
- technical/canon availability;
- rights/consent eligibility;
- territorial/medium/purpose restrictions;
- required performer/source bindings.

Canon mounted != rights granted.

# 97. Casting overlap API

`casting.validate_scope(character_id, scope)` returns:
- active bindings by role;
- overlap policy;
- conflicts;
- explicit multi-cast allowances.

Commands:
- ResolveCastingConflict
- ApproveIntentionalMultiCast

No last-write-wins resolution.

# 98. Credit identity API

Queries:
- `query.person.credit_identities`
- `query.release.credit_snapshot`

Commands:
- CreateCreditIdentity
- UpdateFutureCreditIdentity
- BindReleaseCredit

Historical release manifest pins exact credit identity/snapshot.

# 99. Documentary source-lineage API

Queries:
- `query.documentary.source_lineage(source_id)`
- `query.documentary.evidence_independence(claim_id)`
- `query.documentary.corrections(source_id)`

Commands:
- LinkSourceLineage
- MarkSourceCorrection
- MarkSourceRetraction
- MarkSourceSupersession
- SetFactClaimTemporalScope

Corroboration summary reports number of independent source groups, not merely raw source count.



# 81. Numeric/domain validation contract

All command/import/media APIs may return structured domain errors:
- INVALID_RATIONAL
- NUMERIC_OVERFLOW
- NON_FINITE_NUMBER
- PHYSICAL_LIMIT_EXCEEDED
- INVALID_TEMPORAL_INTERVAL
- UNSUPPORTED_TIMECODE
- INVALID_MONEY_AMOUNT
- CURRENCY_MISMATCH
- CREDIT_UNIT_MISMATCH

Validation happens in Core even if UI already validated.

# 82. Money/FX API

Queries:
- `query.cost.exposure`
- `query.cost.fx_evidence`
- `query.cost.credit_unit`

Cost planning pins:
- original provider amount/unit;
- currency/unit identity;
- FX snapshot if conversion is displayed/enforced;
- rounding rule.

Actual billing never overwrites estimate.

# 83. Media timing validation API

`media.validate_timing_profile` checks:
- frame rate/timebase rational validity;
- timecode/drop-frame compatibility;
- source interval ordering;
- conversion overflow;
- supported bounds.

Timeline operations reject invalid/overflowing timing before creating canonical edit ops.

# 84. Safe spreadsheet export

Structured tabular export API accepts typed cells.

Untrusted text cells are emitted as literal text according to target spreadsheet safety policy.
Formula cells require explicit trusted formula type/capability.

A raw string beginning with formula syntax is never silently upgraded into an executable formula.



# 85. Storage integrity and durability API

Queries:
- `query.storage.scrub_health`
- `query.storage.corrupt_objects`
- `query.environment.fingerprint`

Commands:
- RunStorageScrub
- RepairCorruptObject
- QuarantineCorruptObject
- ReconcileGcOperation
- RequalifyEnvironment
- ReconcileReleaseMaster

Repair requires a verified alternate source.
No “repair from whatever copy exists” shortcut.

# 86. Database corruption API

Advanced/system:
- `database.quick_check`
- `database.integrity_check`
- `database.enter_safe_mode`
- `database.plan_restore`
- `database.export_salvage`

A corruption finding never triggers destructive row deletion automatically.

# 87. Environment drift API

`environment.compare_to_certification` returns:
- changed OS/driver/runtime/codec components;
- affected certifications;
- whether critical work must requalify.

The scheduler may pause only affected capability classes rather than all CineForge work.

# 88. Release durable activation API

`release.activate_master` requires:
- exact release manifest;
- final storage-object identity;
- final signed/content digest;
- durability evidence;
- current rights/QC gates.

On restart, `release.reconcile_master_activation` verifies bytes before publication can continue.
