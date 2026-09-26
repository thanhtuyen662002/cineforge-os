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



# API-NUMERIC-01. Numeric/domain validation contract

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

# API-MONEY-01. Money/FX API

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

# API-MEDIA-TIME-01. Media timing validation API

`media.validate_timing_profile` checks:
- frame rate/timebase rational validity;
- timecode/drop-frame compatibility;
- source interval ordering;
- conversion overflow;
- supported bounds.

Timeline operations reject invalid/overflowing timing before creating canonical edit ops.

# API-SPREADSHEET-01. Safe spreadsheet export

Structured tabular export API accepts typed cells.

Untrusted text cells are emitted as literal text according to target spreadsheet safety policy.
Formula cells require explicit trusted formula type/capability.

A raw string beginning with formula syntax is never silently upgraded into an executable formula.



# API-STORAGE-INTEGRITY-01. Storage integrity and durability API

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

# API-DB-RECOVERY-01. Database corruption API

Advanced/system:
- `database.quick_check`
- `database.integrity_check`
- `database.enter_safe_mode`
- `database.plan_restore`
- `database.export_salvage`

A corruption finding never triggers destructive row deletion automatically.

# API-ENV-DRIFT-01. Environment drift API

`environment.compare_to_certification` returns:
- changed OS/driver/runtime/codec components;
- affected certifications;
- whether critical work must requalify.

The scheduler may pause only affected capability classes rather than all CineForge work.

# API-RELEASE-ACTIVATION-01. Release durable activation API

`release.activate_master` requires:
- exact release manifest;
- final storage-object identity;
- final signed/content digest;
- durability evidence;
- current rights/QC gates.

On restart, `release.reconcile_master_activation` verifies bytes before publication can continue.



# API-DEPLOYMENT-01. Deployment identity API

Queries:
- `query.deployment.current`
- `query.deployment.lineage`
- `query.deployment.detect_clone`

Commands:
- BeginDeploymentMove
- ActivateReplacementDeployment
- BeginDeploymentFork
- BeginDeploymentRestore
- RetireDeployment
- ReconcileDeploymentIdentity

Writable activation requires current deployment binding.
A missing/mismatched installation secret returns `DEPLOYMENT_RECONCILIATION_REQUIRED`, not silent activation.

# API-MOVE-RESTORE-01. Fork/move/restore plan

`command.plan` for MOVE/RESTORE/FORK returns distinct consequences:
- lineage behavior;
- deployment generation change;
- recovery epoch requirement;
- credentials/browser reauth;
- schedules/publications disabled or preserved;
- external side-effect namespace;
- backup namespace;
- environment requalification.

The user does not receive one ambiguous “Use this library here?” action.

# API-SIDE-EFFECT-BINDING-01. Side-effect deployment binding

External-dispatch request envelope includes:
- library_lineage_id;
- deployment_instance_id/generation;
- recovery_epoch_id;
- external operation correlation/idempotency identity.

Dispatcher rejects an attempt whose deployment binding is no longer ACTIVE/current.

# API-FORK-RECONCILE-01. Fork reconciliation API

- `forks.plan_import`
- `forks.compare_project`
- `forks.import_revisions`
- `forks.resolve_conflicts`

No API exists to merge raw CineForge databases from independently mutated forks.



# 100. Local endpoint attestation API

Internal/platform:
- `ipc.describe_endpoint`
- `ipc.verify_server_identity`
- `ipc.rotate_endpoint`

Endpoint descriptor includes:
- installation/library identity;
- Core ownership epoch;
- endpoint/session nonce;
- transport kind;
- expected user/security profile;
- protocol version.

A client does not trust a process merely because it responds on the expected port/pipe name.

# 101. Network route / proxy API

Queries:
- `query.connection.network_route`
- `query.connection.route_freshness`

Internal:
- `network.resolve_effective_route(connection_id)`
- `network.verify_route(connection_id)`

Route changes can invalidate connection certification/identity.

# 102. Capture-session API

Commands:
- StartCaptureSession
- StopCaptureSession
- CancelCaptureSession

Queries:
- `query.capture.active_sessions`
- `query.capture.device_state`

Start binds exact device/source identity and OS permission.
Stop returns:
- STOP_REQUESTED;
- STOP_CONFIRMED;
- DEVICE_ERROR;
- LOST_DEVICE.

# 103. Compute-isolation API

Scheduler/worker plan exposes:
- isolation_class;
- process reuse allowed/not allowed;
- plugin trust class;
- cleanup strategy.

A SENSITIVE_PROCESS_ISOLATED job cannot be co-scheduled into an incompatible long-lived plugin process.

# 104. Deletion guarantee API

Delete/purge result exposes:
- logical state;
- storage locations affected;
- erasure guarantee class;
- residual copies/failure domains known;
- provider/external retention unknowns.

No generic `secure_delete=true` boolean.

# 105. Final-handle authorization API

Internal storage operations:
- `storage.open_authorized_handle`
- `storage.verify_final_identity`

Authorization returns opaque handle token bound to:
- volume/file identity;
- allowed root;
- operation;
- expiry/session.

Privileged operation uses that handle token rather than reopening an untrusted path string.

# 106. Maintenance admission API

Queries:
- `query.maintenance.admission`
- `query.maintenance.resource_pressure`

Internal:
- `maintenance.reserve_resources`
- `maintenance.start`
- `maintenance.pause_resume`

Plan includes temporary bytes, lock/IO class and emergency reserve impact.

# 107. Notification action freshness API

Native notification action routes through:
- `notifications.resolve_action(action_token)`

Token binds:
- decision/entity;
- expected version/snapshot;
- action;
- expiry.

Resolution may return:
- CURRENT;
- STALE_REPLAN;
- OBSOLETE;
- UNAUTHORIZED.

# 108. Suspend/resume reconciliation API

Internal/platform:
- `system.on_suspend`
- `system.on_resume`
- `system.resume_reconcile`

During resume reconciliation:
- timeout-driven retries paused;
- lease expiry is not immediately acted upon;
- provider/browser/resource states refresh before scheduler resumes.



# 109. Pricing and billing reconciliation API

Queries:
- `query.pricing.current(connection_id, service)`
- `query.billing.ledger(project/account)`
- `query.billing.unreconciled`

Internal/commands:
- CapturePricingSnapshot
- ReconcileBillingEvent
- ApplyBillingCorrection
- MarkRefundSettled

Dispatch revalidates the pricing snapshot/ceiling when policy requires.
Billing reconciliation binds provider-native billing identity and actual model/service/account.

# 110. Rights-at-time evaluation API

- `rights.evaluate(scope, purpose, destination, processing_context, at_instant)`
- `rights.explain_effective_interval(record_id)`

Evaluation includes:
- timezone/calendar boundary semantics;
- territory/jurisdiction;
- revocation effect scope;
- current destination/processing region where relevant.

Publish always evaluates at the execution instant, not only at release-candidate creation.

# 111. Retention hold API

Queries:
- `query.retention_holds(scope)`

Commands:
- CreateRetentionHold
- ReleaseRetentionHold
- RevokeRetentionHold

GC/purge asks `retention.can_purge(scope)`.
An expired/released hold does not itself purge anything.

# 112. Portable archive API

Commands:
- PlanPortableArchive
- BuildPortableArchive
- VerifyPortableArchive
- ImportPortableArchive
- MigratePortableArchive

Queries:
- `query.archive.compatibility`
- `query.archive.external_dependencies`
- `query.archive.secret_exclusion`

Portable archive build validates:
- required durable media/evidence present;
- external refs materialized or explicitly declared;
- no active credentials/browser sessions/publication schedules;
- schema/format compatibility metadata.

# 113. Historical signature API

- `signatures.verify_historical(subject_id, verification_policy_revision)`

Returns:
- current cryptographic validity;
- signer/key identity;
- signing-time/timestamp evidence;
- key status then/currently;
- revocation chronology if known;
- policy verdict.

Current key revocation and historical signature validity are separate facts.

# 114. Project transfer/clone/template API

Planning:
- `projects.plan_transfer(source_project, mode)`

Modes:
- CLONE
- TEMPLATE
- PORTABLE_ARCHIVE
- FORK

Plan materializes exact closure and lists:
- included entities/assets;
- excluded secrets/sessions/publication bindings;
- cross-project refs;
- rights/privacy blockers;
- learned-memory references.

Execution uses the snapshot; no hidden live dependency expansion.

# 115. Cross-project learning-memory API

Queries:
- `query.learning_memory.scope`
- `query.learning_memory.lineage`

Commands:
- OptInProjectExamplesToSharedCraftMemory
- RevokeProjectExamplesFromSharedCraftMemory

Shared craft memory requires governed dataset lineage/use-purpose, not implicit global ingestion.

# 116. Compensation readiness API

- `query.publication.compensation_readiness(publication_id)`
- `publication.refresh_compensation_readiness`

Returns independently:
- takedown support;
- replace support;
- current credential readiness;
- platform verification support;
- last checked time.

A publication can be DELIVERED while compensation readiness is DEGRADED.



# 61. Release artifact provenance API

Queries:
- `query.release.build_provenance`
- `query.release.artifact_attestations`
- `query.release.sbom_status`
- `query.release.signing_readiness`

Commands:
- CreateReleaseBuildPlan
- FreezeReleaseManifest
- RequestSigningAuthorization
- SignReleaseArtifact
- CreateUpdateManifest
- PublishReleaseArtifacts

`RequestSigningAuthorization` requires:
- immutable release manifest ID;
- exact artifact digest;
- source commit/tree;
- build workflow/run/attempt identity;
- producer/runner trust evidence;
- required CI/security gates;
- signing key purpose.

Signing service must not accept arbitrary raw bytes without approved manifest context.

# 62. Installer/update plan API

Queries:
- `query.update.current_floor`
- `query.update.available`
- `query.update.preflight`
- `query.installer.ownership`
- `query.installer.recovery_state`

Commands:
- StageUpdate
- VerifyUpdatePackage
- ActivateUpdate
- CompensateInstall
- RepairInstallation
- UninstallOwnedComponents
- RaiseMinimumAllowedVersion

Preflight returns:
- app/schema compatibility;
- updater/bootstrapper compatibility;
- package digest/signature;
- anti-rollback floor;
- required disk/temp headroom;
- reboot requirement;
- active jobs/packages that must drain.

# 63. Artifact provenance resolution

Privileged artifact selection accepts immutable artifact identity only:
- source repository/workflow;
- run ID/attempt;
- source commit;
- artifact ID;
- digest.

API rejects “give me artifact named Release-x64” as sufficient authority.

# 64. Offline verification API

`update.verify_offline_package` returns separately:
- signature validity;
- key trust state;
- known revocation state;
- revocation freshness;
- version-floor result;
- package digest result.

UI/policy decides whether stale revocation knowledge is acceptable for the active security profile.

# 65. Release trigger authorization

Before a privileged release command:
- validate source commit is in allowed release lineage;
- validate triggering actor/automation authority;
- validate expected GitHub Environment/rules/check producer identity where used;
- validate release policy revision.

Missing expected protection returns ASSURANCE_UNAVAILABLE/POLICY_BLOCKED, not success.



# 66. Privacy purge API

Queries:
- `query.purge.status`
- `query.purge.retained_copies`
- `query.privacy.external_exposures`

Commands:
- PlanPrivacyPurge
- ExecutePrivacyPurge
- ResolveRetentionHold
- ReconcileExternalExposure

Purge plan returns exact target classes and expected retained copies.
Command does not report strongest completion wording until required targets reach the configured barrier.

# 67. Forward revocation recovery API

Internal recovery:
- `recovery.load_forward_journal`
- `recovery.apply_forward_journal`
- `recovery.verify_forward_floor`

Recovered backups cannot activate until later purge/revocation/security-floor entries are applied.

# 68. Semantic search scope API

Search request requires:
- authorized studio/project/shared scope;
- privacy/rights context;
- index generation.

Backend retrieval itself enforces scope.
UI-side post-filtering is not the primary security boundary.

# 69. Inference session isolation API

Internal:
- `inference.acquire_session(scope)`
- `inference.reset_session`
- `inference.close_session`

Cross-project/private scope transition requires reset or new isolated process according to runtime isolation class.

# 70. Learning derivative API

Queries:
- `query.learning.derivative_lineage`
- `query.learning.revocation_impact`

Commands:
- QuarantineLearningDerivative
- RequestDerivativeRetraining
- RetireLearningDerivative

Revoking a source can invalidate downstream datasets/adapters/checkpoints according to rights policy.

# 71. Consent/telemetry dispatch API

Before telemetry/cloud outbound emission:
- resolve current privacy_generation;
- compare queued expected generation;
- recompute destination/data-class permission;
- cancel/block if tightened policy no longer allows transmission.

# 72. Core ownership API

Startup/internal:
- `core.acquire_library_writer`
- `core.heartbeat_library_writer`
- `core.begin_drain`
- `core.release_library_writer`
- `core.recover_stale_writer`

A UI process cannot directly claim writer ownership.

# 73. Archive read-only API

- `archive.verify_seal`
- `archive.open_readonly`
- `archive.import_to_working_project`

No mutation/migration command targets sealed archive bytes.

# 74. External exposure API

Exposure query is durable even after local purge, subject to audit/privacy retention.

UI can answer:
- what was sent;
- where;
- when;
- under which policy/terms;
- what deletion/takedown state is known.



# 75. Collaboration/offline API

Queries:
- `query.collaboration.branch`
- `query.collaboration.conflicts`
- `query.collaboration.presence`
- `query.collaboration.authority`

Commands:
- BeginOfflineBranch
- AppendOfflineOperation
- PlanBranchRebase
- SubmitBranchForMerge
- ResolveCollaborationConflict
- AbandonCollaborationBranch

Offline operation upload never writes canonical state directly.

# 76. Reconnect/rebase contract

`PlanBranchRebase` returns:
- base/current revision;
- authority/membership status;
- tombstone/purge findings;
- merge class per operation/domain;
- automatically rebasable ops;
- semantic conflicts;
- expired/unsupported operation-schema findings.

`SubmitBranchForMerge` re-runs the plan against current state before committing.

# 77. Collaboration authority revalidation

At sync/submit:
- actor account enabled;
- current role/membership;
- device state;
- project state;
- rights/privacy policy;
- current lock/fencing token.

If authority was revoked, branch remains exportable/inspectable according to policy but cannot mutate canonical project.

# 78. Canonical promotion CAS API

`PromoteCandidate` requires:
- canonical slot ID;
- expected current revision/version;
- candidate revision.

Conflict returns current observed canonical revision.
No automatic last-write-wins.

# 79. Offline irreversible-action API

Offline client may call plan/draft APIs but final methods:
- PublishRelease
- ExecuteExternalDelete
- SignReleaseArtifact
- ExecuteHighCostDispatch
- ChangeCredentialAuthority
- ChangeRightsAuthority

require an online current Core session and fresh authority token.

# 80. Notification delivery authorization

Before collaboration mention/review/task notification is emitted:
- resolve current recipient access;
- apply lock-screen/privacy mode;
- drop/redact if access was removed.



# 81. Scheduler/retry coordination API

Queries:
- `query.scheduler.failure_domains`
- `query.scheduler.project_fair_share`
- `query.scheduler.retry_budget`
- `query.scheduler.quota_scope`
- `query.scheduler.maintenance_deadlines`

Internal commands:
- OpenCircuit
- AllowHalfOpenProbe
- RecordRetryFailure
- ExtendRetryBudget
- ReserveProviderQuota
- ReleaseProviderQuota
- RebalanceProjectShare
- ScheduleMandatoryMaintenance

Worker retry request does not directly dispatch; it asks the coordinator for authorization.

# 82. Fallback routing API

`routing.plan_fallback` returns:
- source failure domain;
- candidate targets;
- target quota/capacity;
- privacy/rights compatibility;
- ramp percentage;
- cooldown/hysteresis evidence;
- max additional cost exposure.

No binary “provider down → all traffic to fallback” operation.

# 83. Paid dispatch budget API additions

Paid dispatch response includes:
- settled actual;
- currently reserved;
- unreconciled unknown exposure;
- planned new exposure;
- provider price snapshot time/confidence;
- current project/studio ceiling.

If delayed settlement later pushes actual over nominal cap, UI/audit records it as external settlement overrun, not as evidence that admission control never existed.



# 84. Browser profile/session API

Queries:
- `query.browser.profile_health`
- `query.browser.session_identity`
- `query.browser.site_state_class`
- `query.browser.connector_freshness`

Commands/internal:
- CreateBrowserProfile
- DrainBrowserProfile
- QuarantineBrowserProfile
- RecreateBrowserProfile
- BeginBrowserAuthSession
- CompleteBrowserAuthSession
- BeginHumanTakeover
- ResumeAfterHumanTakeover

# 85. Browser action execution API

`browser.execute_typed_action` accepts:
- connector capability/action ID;
- expected origin/page fingerprint;
- exact staged handles;
- job/session epoch;
- effect class;
- precondition hash.

No raw “click arbitrary selector/run page instruction” is exposed as normal production API.

# 86. Browser download receipt API

Download receipt contains:
- browser/profile/session;
- tab/page origin;
- typed action ID;
- provider job/reference;
- download event ID;
- filename/content-type;
- staged object;
- association confidence.

Materialization proceeds through normal external-artifact verification.

# 87. Browser auth challenge API

Challenge result:
- challenge_type;
- account/workspace expected/observed;
- human takeover required;
- retryable generation state: YES | NO | UNKNOWN.

UNKNOWN never authorizes a replacement paid generation.



# 88. Evaluator/QC API

Queries:
- `query.qc.evaluator_profile`
- `query.qc.evidence`
- `query.qc.coverage`
- `query.qc.aggregate`
- `query.qc.cache_status`

Commands/internal:
- RunEvaluation
- RunAggregateEvaluation
- InvalidateEvaluationEvidence
- RequestHumanReview
- QuarantineBenchmarkExample

`RunEvaluation` requires:
- exact subject/representation;
- evaluator profile;
- rubric/calibration;
- coverage profile;
- policy/reference manifest.

# 89. OOD/abstention contract

Evaluation output includes:
- claim type;
- result;
- confidence if meaningful;
- OOD/domain assessment;
- limitations;
- coverage;
- evidence independence.

Client cannot convert UNKNOWN/OUT_OF_DOMAIN to PASS by local defaulting.

# 90. Golden/benchmark API

Queries:
- `query.learning.benchmark_integrity`
- `query.learning.benchmark_rights`
- `query.learning.holdout_status`

Promotion commands reject benchmark sets with:
- corrupt example;
- rights/privacy block;
- stale integrity manifest;
- insufficient required holdout/shadow evidence.

# 91. Post-QC mutation API

Any artifact-transforming command reports whether it invalidates:
- technical QC;
- identity QC;
- audio QC;
- subtitle QC;
- human review.

Release readiness queries final artifact lineage and currently valid evidence only.



# 92. Provenance API

Queries:
- `query.provenance.summary`
- `query.provenance.claims`
- `query.provenance.signatures`
- `query.provenance.lineage`
- `query.provenance.conflicts`

Commands:
- RegisterProvenanceClaim
- VerifyProvenancePackage
- ResolveProvenanceConflict
- CreatePrivacyMinimizedProvenanceExport

Provenance summary returns separate:
- byte/subject binding;
- signer validity/trust;
- lineage completeness;
- rights status;
- conflict/unknown state.

# 93. Handoff/import provenance API

Handoff manifest exposes exact exported fingerprints.
Return import:
- verifies expected files;
- detects mismatch;
- creates transform/flattened edge only when evidence supports it;
- otherwise registers a new UNVERIFIED source.

# 94. Publication artifact API

Publication query distinguishes:
- approved master;
- exact upload bytes;
- public/platform derivative.

Verification of one artifact role never marks all roles verified.

# 95. Similarity-risk API

Similarity analysis returns evidence/UNKNOWN/OOD and possible source matches.
It cannot emit a binding legal verdict.

# 96. Provenance parser network policy

Manifest parsing never automatically dereferences external URLs.
Optional external evidence retrieval uses the standard authorized URL-fetch security boundary.



# 61. Learning feedback and evaluation-integrity API

Queries:
- query.learning.feedback_provenance
- query.learning.correlation_groups
- query.learning.evaluation_context
- query.learning.holdout_access
- query.learning.taint_impact
- query.learning.router_objective
- query.learning.domain_coverage

Commands:
- RecordLearningFeedback
- CurateFeedbackEligibility
- GroupCorrelatedFeedback
- CreateEvaluationPresentationContext
- StartBlindedEvaluation
- MarkBenchmarkTainted
- OpenGoldenExampleDispute
- ResolveGoldenExampleDispute
- UpdateRouterObjectiveProfile
- AllocateExplorationBudget

Rules:
- correlated feedback cannot be counted as independent agreement without an explicit aggregation policy;
- production UI feedback does not automatically become promotion evidence;
- benchmark/holdout access is audited;
- promotion queries expose the exact evaluation-context snapshot behind every metric.

# 62. Sealed holdout access contract

Sealed holdout content is unavailable to:
- prompt optimization;
- production router scoring;
- repair generation;
- candidate training/tuning;
- normal assistant context.

Promotion receives only policy-approved outputs such as aggregate score and bounded evidence summary.

Access to example content requires an explicit audit purpose and authority.

# 63. Router multi-objective contract

Before route selection, effective RouterObjectiveProfile resolves hard constraints first:
- privacy;
- rights;
- safety;
- budget exposure;
- required editability/quality floor.

Optimization among eligible candidates may then consider:
- quality;
- reliability;
- latency;
- cost;
- diversity;
- provider concentration;
- exploration.

Dense low-latency/cost telemetry cannot override a hard quality/diversity floor.

# 64. Learning-taint invalidation API

When source/benchmark/label evidence is tainted:
1. mark dependent dataset/benchmark evidence stale/tainted;
2. walk promotion_evidence_dependencies;
3. create DecisionRequest or automatic depromotion according to policy;
4. invalidate cached benchmark summaries derived from tainted evidence;
5. preserve historical audit.

# 65. Promotion/rollback bundle API

Promotion methods operate on promoted_component_bundle_id.

Before PromoteComponentVersion:
- validate feature/schema/calibration compatibility;
- validate required evidence remains current/non-tainted;
- verify required domain coverage;
- verify rollback bundle exists where policy requires.

Rollback restores the compatible bundle, not only the model/router binary.

# 66. Outcome-labeling contract

Learning-facing outcomes never infer success from absence of follow-up.

Every relevant production terminal event maps explicitly to:
- APPROVED_SUCCESS
- REJECTED
- USER_OVERRIDE
- ABANDONED
- TIMEOUT
- CANCELLED
- POLICY_BLOCKED
- EXTERNAL_FAILURE
- UNKNOWN

Only policy-approved subsets are eligible as positive training/promotion evidence.



# 67. Structured document parsing API

Queries:
- query.documents.parse_status
- query.documents.semantic_coverage
- query.documents.active_content
- query.documents.signature_evidence
- query.documents.ambiguities
- query.spreadsheet.structure
- query.document.text_regions

Commands:
- ParseDocument
- ReparseDocumentWithProfile
- SupplyDocumentPassword
- AcceptDocumentMapping
- RejectDocumentMapping
- CommitStructuredDocumentImport

Rules:
- parse success and semantic completeness are separate;
- CommitStructuredDocumentImport requires policy-approved handling of unsupported/ambiguous critical channels;
- parser never refreshes external workbook/data connections automatically;
- active content stays inert/quarantined.

# 68. Spreadsheet formula/value contract

Spreadsheet API returns separately:
- source formula;
- cached/display value;
- normalized interpreted value;
- calculation freshness;
- external dependency state;
- workbook date system;
- sheet/range/cell identity.

Caller cannot request “just give me the value” and silently lose whether it is stale/external/formula-derived when that distinction matters.

# 69. OCR/layout evidence API

OCR/layout result includes:
- page/region;
- reading order;
- confidence;
- parser/OCR version;
- ambiguity flags.

Canonical script/shot/canon mapping from low-confidence OCR requires review according to policy.

# 70. Document protection state API

Errors/states distinguish:
- PASSWORD_REQUIRED
- ENCRYPTED_UNSUPPORTED
- SIGNED
- SIGNATURE_INVALID
- CORRUPT
- UNSUPPORTED_FORMAT

Password/credential material is scoped to the parse session and excluded from normal logs.

# 71. Semantic-coverage gate

Before using a document parse as authoritative structured project data:
1. identify which semantic channels the intended use depends on;
2. check coverage for those channels;
3. if required channel is PARTIAL/UNKNOWN/UNSUPPORTED, create DecisionRequest or block automatic promotion;
4. bind accepted mapping to exact document parse revision.



# 72. Film spatial/continuity API

Queries:
- query.scene.spatial_graph
- query.shot.asymmetric_continuity
- query.shot.identity_coverage
- query.characters.distinctiveness
- query.camera.calibration

Commands:
- SetSceneSpatialRelation
- SetAsymmetricIdentityFact
- SetIdentityDistinctivenessConstraint
- SetProtectedIdentityExclusion
- RecordTemporalIdentityCoverage
- WaiveFilmGrammarContinuity

QC can return:
- mirrored/asymmetric mismatch;
- screen-direction conflict;
- eyeline/spatial-topology conflict;
- hero-identity leakage into crowd;
- ambiguous named-character distinctiveness.

# 73. Retime/interpolation API

Commands:
- CreateRetimeArtifact
- ApproveRetimeArtifact
- ReplaceRetimeMethod

CreateRetimeArtifact returns:
- exact source→destination time mapping;
- synthesized-frame ranges;
- affected dialogue/lipsync/subtitle/music dependencies;
- required visual QC profile.

Retime methods that synthesize frames create a new asset revision and cannot inherit source visual approval automatically.

# 74. Conversation overlap API

Queries:
- query.dialogue.utterance_timeline
- query.dialogue.overlap_groups

Commands:
- CreateUtteranceEvent
- BindNonverbalSpeaker
- MarkInterruption
- ResolveSpeakerAmbiguity

Diarization may propose speaker binding but does not become canonical without policy/evidence.

# 75. Multilingual dubbing-fit API

Queries:
- query.dubbing.voice_language_profile
- query.dubbing.fit_candidates

Commands:
- CertifyVoiceLanguageProfile
- CreateDubbingFitCandidate
- SelectDubbingFitCandidate

Fit analysis considers semantic text, duration, speech rate, pronunciation and viseme/phoneme compatibility where available.

# 76. Deliverable audio/subtitle validation API

Queries:
- query.delivery.audio_validation
- query.delivery.subtitle_validation

Validation may include:
- final-codec loudness/true peak;
- channel/mono compatibility;
- sync drift;
- language/default flags;
- subtitle CPS/line length;
- safe area/occlusion;
- font/glyph coverage;
- bidi/script shaping;
- target-format loss.

# 77. Editor handoff capability API

Queries:
- query.handoff.adapter_capabilities
- query.handoff.loss_preview
- query.handoff.return_contract_diff

Commands:
- CertifyEditorAdapterVersion
- CreateHandoffWithCapabilityProfile
- AcceptExternalEditContractChange

A handoff request names target editor/version.
Unknown target version cannot inherit prior “native/editable” capability claims automatically.

# 78. Alternate deliverable API

Commands:
- CreateDeliverableVariant
- GenerateReframeVariant
- SubmitVariantReview
- ApproveVariant

Each materially distinct crop/aspect/profile has independent review/release gates.



# 79. Collaboration authorization API

Queries:
- query.membership.current
- query.session.authorization
- query.collaboration.working_copies
- query.collaboration.conflicts
- query.collaboration.merge_policy

Commands:
- InviteProjectMember
- ChangeProjectMemberRoles
- RevokeProjectMembership
- BeginCollaborativeWorkingCopy
- SyncCollaborativeWorkingCopy
- ResolveCollaborationConflict
- MergeCollaborativeWorkingCopy
- AbandonCollaborativeWorkingCopy

Sensitive command/approval submit rechecks current authorization epoch.

# 80. Capability-token/subscription revocation API

Internal methods:
- auth.issue_scoped_capability_token
- auth.revoke_project_tokens
- auth.revalidate_session
- events.reauthorize_subscription
- events.terminate_subscription

Media/preview tokens bind actor/session/project/purpose and authorization epoch.
Membership/role revocation can invalidate sensitive tokens/subscriptions.

# 81. Collaborative edit merge contract

Per-domain merge policy is queried before sync/merge.

Rules:
- BRANCH_ONLY/EXCLUSIVE domains never auto-merge semantically;
- stale offline work is preserved as branch/working copy;
- last-write-wins is not the default for canon/rights/release/timeline critical edits;
- structured text merge can produce unresolved conflicts rather than invent one truth.

# 82. Collaborative undo API

Undo/redo in shared state operates on the current actor/session operation graph.

Command:
- PlanCompensateCollaborativeOperation
- CompensateCollaborativeOperation

It does not rewind unrelated later operations by other actors.

# 83. Concurrent approval/select API

Canonical selection/approval commands require:
- expected aggregate/canonical revision;
- exact candidate revision;
- current reviewer authority epoch;
- review dependency hash.

Conflicting simultaneous approvals return STALE/CONFLICT; both do not become canonical.

# 84. Delegation/impersonation API

Queries:
- query.authority.delegations
- query.authority.impersonation

Commands:
- GrantDelegation
- RevokeDelegation
- BeginImpersonationSession
- EndImpersonationSession

Every delegated/impersonated command records principal + effective actor and authority source.

# 85. Cross-project reuse API

Command:
- PlanCrossProjectAssetReuse
- ExecuteCrossProjectAssetReuse

Plan evaluates:
- rights;
- privacy/data-use;
- provenance;
- storage/link mode;
- learning scope;
- target project policy.

Raw asset ID/handle copy is not cross-project authorization.
