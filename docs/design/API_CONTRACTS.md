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


# 47. Storage root validation API

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

# 48. Web automation permission API

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


# 49. Recovery epoch API

Queries:
- `query.recovery.status`
- `query.recovery.external_reconciliations`
- `query.recovery.quarantined_events`

Commands:
- BeginRestore
- BeginRecoveryEpoch
- ResolveExternalReconciliation
- ActivateRecoveredEpoch
- AbortRecovery

Restore flow:
1. restore canonical checkpoint;
2. Core creates/increments recovery epoch;
3. external dispatch is frozen;
4. restored outbox/inbox/provider/browser/publication state is reconciled;
5. unresolved future/unknown events stay quarantined;
6. connections/credentials are revalidated;
7. only `ActivateRecoveredEpoch` resumes normal external dispatch.

A restored outbox is never blindly re-sent.

# 50. Database/storage pressure API

Queries:
- `query.system.database_health`
- `query.system.storage_pressure`

Internal controls:
- request WAL checkpoint;
- cancel/expire pathological read snapshot where policy permits;
- pause large imports/generation/model downloads;
- enter read-only safe mode.

UI receives human state such as:
- “Dung lượng hệ thống đang ở mức nguy hiểm; CineForge đã tạm dừng tác vụ tạo file lớn.”
not raw SQLite jargon by default.

# 51. Import/parser safety contract

Import preview returns safety/resource classification:
- archive expansion estimate;
- recursive depth;
- decoded pixel/sample/frame estimate when available;
- parser sandbox status;
- unsupported external-reference/network protocol detection;
- reason for quarantine/rejection.

Import commands accept only policy-bounded parsing.
There is no “trust this file and run arbitrary parser behavior” shortcut.

# 52. Context Compiler trust-segment contract

Internal compiled context is a sequence of typed segments:

```text
ContextSegment {
  provenance
  trust_class
  semantic_role
  authority_level
  source_revision
  content
}
```

Trust classes include:
- SYSTEM_POLICY
- AUTHORIZED_TASK
- CANONICAL_PROJECT
- USER_CONTENT
- EXTERNAL_CONTENT
- MODEL_OUTPUT
- METADATA

Only system/policy/authorized-control classes may supply tool/workflow instructions.
Other classes remain data even if content contains imperative phrases.

# 53. Durable provider artifact API

Connector result normalization may return a remote receipt, but not a READY asset.

Methods/internal operations:
- `artifacts.materialize_external_receipt`
- `artifacts.verify_materialized`
- `artifacts.get_receipt_state`

Durable asset registration requires local/managed materialization and hash/decode verification unless the asset type is explicitly an external-reference-only artifact.

# 54. Resource reservation API

Internal scheduler:
- `resources.reserve`
- `resources.renew`
- `resources.release`
- `resources.revoke`

Reservation uses fencing token.
Dispatch requiring constrained GPU/VRAM/browser-profile/disk capacity validates the current reservation before start.

Resource sample alone never authorizes overcommit.

# 55. Cost exposure API

Before external dispatch:
- `cost.plan_exposure(command/job)`
- `cost.reserve`

When provider acceptance/billing is uncertain:
- reservation enters UNKNOWN/unreconciled exposure;
- retry is blocked when it could exceed configured exposure;
- reconciliation updates actual usage.

Queries expose:
- reserved;
- actual;
- unknown/unreconciled;
- remaining hard limit.

# 56. Manual creative ownership API

Queries:
- `query.manual_locks(scope)`

Commands:
- AcquireManualControlLock
- ReleaseManualControlLock
- PromoteLateAICandidateOverManualState

AI/background command canonicalization checks manual lock/current revision.
A late result may stay as candidate but cannot silently overwrite the locked/newer state.

# 57. Fanout batch API

Commands:
- PlanDispatchBatch
- StartDispatchBatch
- ContinueDispatchBatch
- PauseDispatchBatch
- CancelDispatchBatch

Plan returns:
- item count;
- sample-first/staged/full strategy;
- estimated cost/storage/resource exposure;
- upstream revision dependency;
- maximum batch exposure.

Upstream canon/reference correction can cancel undispatched items and mark already-dispatched attempts stale.

# 58. Update/schema compatibility API

Update plan returns:
- current app/schema;
- target app schema min/max compatibility;
- migration reversibility;
- rollback binary compatibility;
- DB/object checkpoint requirement;
- active external jobs that must drain/reconcile.

A failed update cannot report “rollback available” when the previous binary cannot read the migrated schema.

# 59. Credential portability / reauth API

Connection query distinguishes:
- AUTHENTICATED
- REAUTH_REQUIRED
- EXPIRED
- REVOKED
- MISSING_SECURE_MATERIAL

After restore/machine move, missing secure material yields REAUTH_REQUIRED.

Fallback to another provider is a separate routing decision and must obey user/project policy.

# 60. Signing trust API

Advanced/system queries:
- `query.signing.trust_roots`
- `query.signing.revocations`

Update/package verification binds:
- key_id;
- trust-policy revision;
- signature result;
- revocation/validity state.

A cryptographically valid signature from a revoked/untrusted key does not pass.
