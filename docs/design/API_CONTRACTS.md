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

### Idempotency binding

When `idempotency_key` (or the equivalent HTTP `Idempotency-Key` header) is
present, the key is scoped to the authenticated actor and `command_type`.
Core stores a SHA-256 binding over `IDEMPOTENCY_CANONICAL_V1`, the canonical
payload, and canonical `expected_versions`. Equivalent retries replay the
original result. Reusing the namespace key with a different payload or
precondition returns `IDEMPOTENCY_KEY_REUSE_CONFLICT` in category `CONFLICT`
(`needs_user: true`) and does not append a second command or event.

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
- `query.media_profile.workspace`
- `query.timeline.list`
- `query.timeline.workspace`
- `query.review.list`
- `query.review.get`
- `query.handoff.list`
- `query.handoff.get`
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
- CreateMediaProfileRevision
- TransitionMediaProfileRevision
- CreateTimeline
- CreateTimelineRevision
- TransitionTimelineRevision

For Issue #21, the five timeline commands above are the bounded executable
timeline contract. Issue #23 adds the two review commands below without opening
an editor, playback, render or export surface.
The working-session, edit-operation and undo/redo commands remain deferred and
must not be advertised as available runtime commands until their own
implementation evidence exists.

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
- CreateHandoffManifest
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

Dismiss request includes:
- decision_request_id
- expected_decision_version

The loopback HTTP adapter exposes `GET /v1/decisions`,
`GET /v1/decisions/{id}`, `POST /v1/decisions/{id}/resolve`, and
`POST /v1/decisions/{id}/dismiss`. Every mutating route accepts an
`Idempotency-Key` and returns the canonical decision plus command/event
metadata. `query.home` and `query.needs_you.list` project the same OPEN
requests; the dashboard is not a second source of truth.

Core rejects stale, obsolete, expired, closed, or invalid-choice decision
mutations with a structured conflict and leaves the aggregate unchanged.
Choice command templates are opaque consequence metadata; resolving a choice
does not execute arbitrary shell, LLM, provider, or connector instructions.

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

## Issue #21 bounded media-profile/checkpoint contract

This is the first executable contract boundary for the canonical timeline. The
Issue #21 bounded slice is project-scoped and stores an immutable, auditable
checkpoint. It does not open an editor session or render media. The runtime
names below are the names exposed by Core and its loopback HTTP adapter.

`CreateMediaProfileRevision` creates a new immutable profile revision. Its
payload is explicit and must contain:

```json
{
  "project_id": "project-id",
  "profile": {
    "timeline_rate_num": 24000,
    "timeline_rate_den": 1001,
    "timeline_time_base_num": 1001,
    "timeline_time_base_den": 24000,
    "width": 1920,
    "height": 1080,
    "pixel_aspect_num": 1,
    "pixel_aspect_den": 1,
    "working_color_space": "REC709",
    "transfer_function": "SDR",
    "hdr_policy": "DISABLED",
    "audio_sample_rate": 48000,
    "audio_channel_layout": "STEREO",
    "proxy_profile": {},
    "mastering_targets": {}
  }
}
```

The Core canonicalizes and checks rate/time-base/pixel-aspect rationals
(positive denominator, reduced fraction, bounded integer range). Unknown
technical values remain `UNKNOWN`; a client cannot make them pass by supplying
a label. A non-integer rate such as 24000/1001 is never represented as an
integer rate with a cosmetic label. Drop-frame policy is reserved for a later
timecode contract and is not inferred by this checkpoint baseline.
The response identifies the newly created profile revision and its lifecycle
state. The command never rewrites an existing revision or silently changes the
project's timeline profile.

`CreateTimelineRevision` accepts a complete typed snapshot for this bounded
mode:

```json
{
  "project_id": "project-id",
  "timeline_id": "timeline-id",
  "media_profile_revision_id": "profile-revision-id",
  "expected_versions": {"timeline": 7},
  "duration": {"num": 24000, "den": 1001},
  "tracks": [
    {"track_type": "VIDEO", "order_index": 0, "name": "Picture", "enabled": true, "clips": []}
  ],
  "markers": []
}
```

The snapshot must be project-scoped, bounded in size, and contain only VIDEO
tracks, clip instances and markers. Every clip pins an exact materialized
`asset_revision_id`; source/timeline intervals and positive constant speed are
validated as checked rationals. The command computes a deterministic
`content_hash`, writes one `DRAFT_CHECKPOINT` revision in one transaction, and
returns the revision identity, hash, pinned profile revision and validation
summary. It is idempotent through the normal command envelope. An equivalent
retry replays the original result; a reused key with changed content or
preconditions returns `IDEMPOTENCY_KEY_REUSE_CONFLICT`.

`TransitionTimelineRevision` is a separate explicit command. It accepts only an
exact candidate revision and expected version, revalidates the pinned profile,
asset availability/evidence and effective rights, and then promotes the
revision while superseding the previous approved revision. `UNKNOWN`,
`MISSING`, `CORRUPT`, `QUARANTINED`, `RESTRICTED`, `EXPIRED` or `REVOKED`
inputs remain blocked. Approval never resolves a profile or asset by
`latest`.

The bounded read surface is:

- `query.media_profile.workspace` returns the project profile, immutable
  revisions, approved revision and candidate revisions.
- `query.timeline.list` returns project-scoped timeline identities and row
  versions.
- `query.timeline.workspace` returns one timeline workspace with its pinned
  profile revision, bounded checkpoint revisions, tracks, clips, markers,
  readiness and `next_step`.

All stale-capable responses include `projection_seq`, `generated_at` and
relevant entity/revision versions. The loopback adapter exposes these reads as
`GET /v1/projects/{project_id}/media-profile`,
`GET /v1/projects/{project_id}/timelines` and
`GET /v1/projects/{project_id}/timelines/{timeline_id}/workspace`. Mutations
use the corresponding project-scoped POST routes and still reach Core's
audited command gate, so audit and idempotency cannot be bypassed.

The adapter maps malformed rationals, unsupported snapshot fields and bounds
violations to `400 VALIDATION`; an unknown project/timeline/profile/checkpoint
to `404`; stale expected versions, cross-project references, blocked rights or
readiness and immutable-revision conflicts to `409 CONFLICT` (with
`needs_user` where a decision is required). A `503` is reserved for an actual
Core/worker availability failure. Internal paths, provider fields and raw
snapshot payloads are redacted from public errors.

The following are explicitly deferred from Issue #21: timeline working
sessions, autosave/undo/redo edit operations, collaboration or branch merge,
playback, thumbnail/waveform generation, audio/caption/transition editing,
render, external-editor handoff, export and release integration. The methods
and operation names below describe the later working-session contract and are
not evidence that this bounded slice is implemented.

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

These operation names belong to the deferred working-session contract. They
must not be accepted by the Issue #21 snapshot command; unsupported track or
operation payloads fail validation instead of being silently ignored.

Batch application is atomic at working-session level where possible.

Timeline op response includes impacted dependent domains:
- subtitles;
- audio;
- lip-sync;
- music;
- release readiness.

## Issue #27 executable bounded working-session contract

Issue #27 opens a local, project-scoped working session over the existing
timeline checkpoint contract. The commands below are specified as Core
commands; they are not permission for the UI, worker or connector to write
timeline tables directly. A runtime may advertise a command only after its
implementation and verification evidence exists.

The command names are:

- `BeginTimelineWorkingSession`;
- `ApplyTimelineEditOp`;
- `UndoTimelineEditOp`;
- `RedoTimelineEditOp`;
- `AutosaveTimelineWorkingSession`;
- `CheckpointTimelineWorkingSession`; and
- `CloseTimelineWorkingSession`.

The corresponding query projections are:

- `query.timeline.working_session({project_id, timeline_id, session_id?})`;
- `query.timeline.edit_history({project_id, timeline_id, session_id, after_op_seq?, limit?})`; and
- the existing `query.timeline.workspace`, which may include a redacted
  working-session summary when the caller has explicitly selected one.

Every mutating request carries an `Idempotency-Key` bound to the canonical
request payload and the authenticated actor/session namespace. Every request
also carries the relevant expected version. A repeated equivalent key returns
the original result; the same key with a different payload, base revision or
expected version returns `IDEMPOTENCY_KEY_REUSE_CONFLICT` and writes no second
command, event or operation.

After `BeginTimelineWorkingSession`, every session mutation also carries the
same `client_instance_id` that was bound to the session. A missing or different
client identity is rejected before the working snapshot is evaluated; a client
cannot borrow another local client's session merely by knowing its ID.

`BeginTimelineWorkingSession` requires an explicit `project_id`, `timeline_id`,
`base_revision_id`, `base_content_hash` (equal to that revision's exact
`content_hash`), `expected_timeline_version` and `client_instance_id`. The
actor is resolved from the authenticated local
session rather than trusted from the body. The base ID, content hash and row
version must still identify the same immutable project-scoped revision. A
missing, cross-project, superseded or `latest` reference is rejected. The
second non-terminal session for the same timeline and actor returns
`TIMELINE_WORKING_SESSION_ALREADY_OPEN`; it never silently takes ownership.

`ApplyTimelineEditOp` accepts one typed operation or a bounded `operations`
array (maximum 32 entries). The entire request is one Core transaction:
operations receive consecutive `op_seq` values and a validation failure rolls
back the whole batch; no prefix may be reported as accepted. Each entry uses
the following semantic contract:

| Operation | Required semantic payload | Required checks |
|---|---|---|
| `INSERT_CLIP` | exact `asset_revision_id`, VIDEO track/order, source and timeline rational intervals, positive constant speed | asset is materialized, available, same project and rights-allowed; no overlap or out-of-bounds interval |
| `MOVE_CLIP` | exact clip ID and new timeline interval | clip belongs to this working snapshot; ordering and overlap rules hold |
| `TRIM_CLIP` | exact clip ID and checked source/timeline bounds | intervals remain ordered and non-empty and remain pinned to the exact asset revision; asset-duration bounds are deferred until authoritative media-duration metadata is available |
| `DELETE_CLIP` | exact clip ID | only the working snapshot is changed; immutable revisions are untouched |
| `ADD_MARKER` | rational position, typed marker kind/label/payload | position is in the timeline bounds and the structured payload stays within Core's bounded object limits |

The five-operation allowlist is closed. `SPLIT_CLIP`, `RETIME_CLIP`, audio,
captions, transitions, links, transforms,
effects, nested sequences, provider fields, paths, floats, NaN/Infinity,
zero/negative denominators, overflowed rationals, cross-project IDs and
unknown payload keys fail typed validation before mutation. Core assigns a
monotonic `op_seq`; the request's `client_op_id` is unique within the session.
The operation's canonical payload JSON, base revision/version binding and
actor are committed atomically with the session row; the command ledger keeps
the request fingerprint used for idempotent replay and reuse-conflict checks.
The response includes the
accepted sequence, working content hash, session state, dependency-impact
summary, `needs_user` and `next_step`.

`UndoTimelineEditOp` and `RedoTimelineEditOp` never rewind global project
history. Undo creates an append-only causal compensating operation for the
current actor's eligible reversible operation. Redo re-applies the most recent
eligible undo relation. A target with newer dependent operations, an already
resolved relation or an external/irreversible effect returns a typed conflict;
a new edit after undo invalidates redo. Earlier operation rows and audit events
remain visible in history.

`AutosaveTimelineWorkingSession` durably records the current working snapshot
and acknowledgement sequence only. It must not create, approve, supersede or
mutate a canonical timeline revision, review, release or handoff. The response
is successful only after the Core transaction commits and includes the server
 autosave timestamp and durable op sequence. A stale base/session version
 returns a typed `409 CONFLICT` and leaves the durable session unchanged; an
 interrupted autosave/checkpoint is instead promoted to `RECOVERY_REQUIRED` on
 the next Core start. Autosave cannot overwrite newer state.

`CheckpointTimelineWorkingSession` requires a cleanly acknowledged operation
prefix, the exact expected session/base version and no unresolved conflict. It
replays the deterministic working snapshot, then revalidates the exact media
profile, materialized asset revisions, rational bounds and current rights
before invoking the existing `CreateTimelineRevision` semantics. Core also
fences the session's captured base revision row version and content hash before
the write. Success creates one immutable `DRAFT_CHECKPOINT`, leaves all
earlier revisions untouched and re-bases the still-open session to that exact
checkpoint (including its new base row version/hash) in `CLEAN`. It never
promotes, approves, exports or publishes the checkpoint.

`CloseTimelineWorkingSession` is explicit. A `CLEAN` session may close and
becomes `CLOSED`; a dirty session must either checkpoint first or send an
explicit `ABANDON` disposition, which preserves the durable draft and enters
`ABANDONED`. After either terminal state, operations, autosave, undo and redo
are rejected. Reopening starts a new session against an explicit revision.

The project-scoped HTTP adapter maps these commands to:

- `GET /v1/projects/{project_id}/timelines/{timeline_id}/working-sessions`;
- `GET /v1/projects/{project_id}/timelines/{timeline_id}/working-sessions/{session_id}`;
- `POST /v1/projects/{project_id}/timelines/{timeline_id}/working-sessions`;
- `POST /v1/projects/{project_id}/timelines/{timeline_id}/working-sessions/{session_id}/ops`;
- `POST /v1/projects/{project_id}/timelines/{timeline_id}/working-sessions/{session_id}/undo`;
- `POST /v1/projects/{project_id}/timelines/{timeline_id}/working-sessions/{session_id}/redo`;
- `POST /v1/projects/{project_id}/timelines/{timeline_id}/working-sessions/{session_id}/autosave`;
- `POST /v1/projects/{project_id}/timelines/{timeline_id}/working-sessions/{session_id}/checkpoint`; and
- `POST /v1/projects/{project_id}/timelines/{timeline_id}/working-sessions/{session_id}/close`; and
- `GET /v1/projects/{project_id}/timelines/{timeline_id}/working-sessions/{session_id}/history?after_op_seq=&limit=`.

Malformed or unsupported payloads map to `400 VALIDATION`; unknown or
cross-project IDs map to `404`; stale base/session versions, a second active
session, idempotency mismatch, conflict, dirty close and unsynchronized
checkpoint map to `409 CONFLICT` with `needs_user` and a human-readable
`next_step` where a decision is required. A `503` is reserved for actual Core
availability failure. Public errors redact filesystem paths, provider data,
raw payloads and internal SQL details.

This issue intentionally excludes multi-user collaboration, offline branch
merge, leases/fencing, semantic conflict resolution, playback, thumbnails or
waveforms, audio/caption/transition processing, render/transcode, external
editor round-trip, handoff/export, release/publish, provider dispatch and
arbitrary shell execution. Those boundaries remain separate contracts.

# 17. Review API detail

## Issue #23 project-scoped timeline review baseline

The executable Core command names are `OpenReview` and `SubmitReview`. The
loopback adapter exposes them as:

- `GET /v1/projects/{project_id}/reviews?state=&limit=`
- `GET /v1/projects/{project_id}/reviews/{review_session_id}`
- `POST /v1/projects/{project_id}/reviews`
- `POST /v1/projects/{project_id}/reviews/{review_session_id}/submit`

`OpenReview` requires:

```json
{
  "project_id": "project-id",
  "subject_type": "TIMELINE_REVISION",
  "subject_revision_id": "timeline-revision-id",
  "expected_versions": {"REVISION": 2}
}
```

The response returns the exact review session, subject projection, timeline,
pinned media-profile revision and `{hash,current_hash,stale}` snapshot view.
The command is audited and idempotent. An OPEN/IN_PROGRESS session already
exists for the subject, the revision is not a DRAFT_CHECKPOINT/CANDIDATE, or the
revision version is stale, Core returns a typed conflict without mutation.

`SubmitReview` requires the current review row version and records exactly one
immutable human decision:

```json
{
  "project_id": "project-id",
  "review_session_id": "review-session-id",
  "decision": "APPROVE",
  "notes": "Checkpoint matches the intended cut.",
  "reason_codes": [],
  "expected_versions": {"REVIEW_SESSION": 1}
}
```

Allowed decisions are `APPROVE`, `REJECT`, `REPAIR` and `ABSTAIN`. Core
recomputes the dependency snapshot before inserting the append-only fact. A
hash/content mismatch, superseded/approved subject, or stale row returns
`STALE_REVIEW`; no old evidence can be submitted. `APPROVE` additionally
requires timeline readiness `READY`. Once submitted, the decision cannot be
edited or replaced.

`TransitionTimelineRevision` to `APPROVED` now requires
`review_session_id` and the caller-supplied `dependency_snapshot_hash` captured
from that exact review. Core verifies that the session belongs to the same
project and revision, is `SUBMITTED`, contains decision `APPROVE`, and still
matches the current dependency/content hashes. A missing or malformed hash,
missing/non-APPROVE evidence, or stale review is a typed conflict/validation
error with `needs_user=true` where recovery is possible. The existing profile,
asset, rights and exact-pin gates still run after this review gate.

The UI Review workspace is metadata-first: it shows checkpoint identity,
rational duration, track summary, readiness, exact hashes and human decision
controls. It deliberately has no player or fake progress indicator. A stale
workspace explains the recovery step (open a review for the current checkpoint)
and disables submit/approve controls.

If dependency hash changed while a reviewer watched, submit returns
`STALE_REVIEW` rather than silently approving old state.

# 17A. Issue #25 project-scoped handoff-manifest API

The Issue #25 baseline adds a metadata-only handoff preflight. It is deliberately
separate from the later media export, release and publication commands. The
executable command is `CreateHandoffManifest`; the older catalog name
`CreateHandoff` remains a future capability and must not be treated as evidence
that a render or external-editor package exists.

The loopback adapter exposes project-scoped routes:

- `GET /v1/projects/{project_id}/handoffs?state=&limit=`
- `GET /v1/projects/{project_id}/handoffs/{handoff_id}`
- `POST /v1/projects/{project_id}/handoffs`

The POST body is explicit and contains no destination path or provider command:

```json
{
  "timeline_revision_id": "approved-revision-id",
  "review_session_id": "submitted-review-id",
  "dependency_snapshot_hash": "64-lowercase-hex-sha256",
  "target_editor": "GENERIC",
  "target_version": "1",
  "target_profile": "GENERIC_INTERCHANGE",
  "expected_versions": {
    "REVISION": 3,
    "REVIEW_SESSION": 2,
    "MEDIA_PROFILE_REVISION": 1
  }
}
```

The project path is authoritative scope. The Core verifies that the named
timeline revision, review session, media profile and every pinned asset belong
to that project. It requires the revision lifecycle `APPROVED`, one immutable
submitted `APPROVE` decision for the exact subject, the caller-supplied
well-formed 64-hex dependency hash, and an exact recomputation of both the
dependency snapshot and timeline content hash. The media profile must be the
approved revision pinned by the timeline. Materialization/readiness and current
rights are rechecked at creation time; `UNKNOWN` is never promoted to `PASS`.
Cross-project IDs, malformed hashes, stale row versions, missing review
evidence, changed content, unready/unavailable assets and restricted/unknown
rights return a typed `400` validation or `409` conflict/rights response and
write no session or manifest.

The successful response is a normal Core envelope whose result includes:

- `export_session`: project and exact timeline/review/profile IDs, state
  `PREFLIGHT`, exact dependency/content hashes, target and `next_step`;
- `handoff_manifest`: immutable ID, canonical `manifest_hash`, parsed artifact
  allowlist, compatibility report and sanitization report;
- `needs_user`, `stale` and human-readable next-step information when relevant.

The manifest hash is SHA-256 over deterministic canonical JSON (UTF-8, sorted
object keys, deterministic array order and normalized rationals). The hash input
contains only the explicit allowlist: exact asset-revision IDs/digests, safe
media metadata, timeline timing, profile fingerprint and the bound review/
dependency/content fingerprints. It excludes absolute paths, usernames,
temp/cache locations, API endpoints, credentials, prompts, diagnostics,
provider-specific fields, writable CAS aliases and unrelated private IDs. Any
removed value is listed in the sanitization report with the policy version.
Public projections return the parsed safe fields and never expose `storage_uri`
or raw local paths.

Compatibility is a feature-level report with statuses `NATIVE`,
`APPROXIMATED`, `UNSUPPORTED` or `UNKNOWN`, plus a conservative editable claim.
An unknown or unverified target editor/version cannot inherit an editable-project
claim. The baseline does not create media bytes, render, play, transcode,
process audio/subtitles, call a provider, publish externally or sign a release.

All mutating routes accept `Idempotency-Key` (or the canonical command
`idempotency_key`). Equivalent retries replay the same session/manifest and
hash. Reusing the actor/command key with a different payload or expected
versions returns `IDEMPOTENCY_KEY_REUSE_CONFLICT` without another event. The
manifest remains immutable; later changes create a new timeline/review and a new
handoff preflight rather than editing old evidence.

The queries `query.handoff.list` and `query.handoff.get` are side-effect free,
project-scoped projections. They include `projection_seq`, `generated_at`, row
versions, current/stale status, exact source hashes, allowlist, compatibility,
sanitization and `next_step`. They do not enumerate unrelated database rows or
filesystem contents. A missing project-scoped handoff is `404`; stale data is
visible for audit and clearly marked rather than silently refreshed to `latest`.

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

## 35A. Issue #29 metadata-first audio cue and subtitle timing contract

Issue #29 opens a bounded metadata layer after the canonical timeline,
review/approval and VIDEO-only working-session slices. It does not add audio or
caption operations to `ApplyTimelineEditOp`, and the generic production
commands above must not be advertised as executable until their separate
runtime evidence exists. The contract is anchored to task hash
`sha256:8fffc235bd75016a309e832f98920c6cf076bc4ec8ae5f0bc375cfc36c55b32b`.

### Commands

The executable command subset is:

- `CreateAudioCue` — create a project-owned cue identity with one of
  `DIALOGUE`, `ADR`, `NONVERBAL`, `FOLEY`, `SFX`, `AMBIENCE`, `ROOM_TONE`,
  `MUSIC` or intentional `SILENCE` types;
- `CreateAudioCueRevision` — create one immutable draft timing revision;
- `TransitionAudioCueRevision` — make an explicit timed/reviewed/approved
  transition after revalidation;
- `CreateSubtitleTrack` — create a project/timeline-owned track identity;
- `CreateSubtitleTrackRevision` — create one immutable draft with a bounded
  segment batch; and
- `TransitionSubtitleTrackRevision` — make an explicit timed/reviewed/approved
  transition after revalidation.

`ApproveAudioCue` and `ApproveSubtitleTrack` are compatibility command names in
the broader catalog. An implementation may expose them as typed aliases of the
transition commands only when it preserves the same exact revision, actor,
row-version, idempotency and evidence checks. No command may infer approval
from a selected row, autosave, a successful read or a newer timeline.

`CreateAudioCueRevision` requires:

```json
{
  "project_id": "project-id",
  "timeline_id": "timeline-id",
  "audio_cue_id": "cue-id",
  "timing_dependency_revision_id": "timeline-revision-id",
  "timing_dependency_content_hash": "64-hex-sha256",
  "cue_type": "DIALOGUE",
  "start": {"num": 0, "den": 1},
  "end": {"num": 120, "den": 24},
  "intent_text": "...",
  "selected_asset_revision_id": "asset-revision-id"
}
```

`SILENCE` may omit `selected_asset_revision_id`; all other cue types require an
exact asset revision whose materialization is `AVAILABLE` with verified
evidence and whose effective rights evaluate to `ALLOWED` for the requested
timeline-audio purpose. The command rejects a missing/mismatched timeline
hash, cross-project parent, unsupported type, invalid or overflowed rational,
non-positive interval, out-of-bounds interval, unbounded text/payload or
`latest`/provider/path field before writing a row. Core captures a canonical
`timing_dependency_hash` and, when an asset is selected, an
`asset_snapshot_hash` for the rights/materialization evidence.

`CreateSubtitleTrackRevision` requires the same exact timeline ID/hash pair,
locale and a bounded array of segments. Each segment carries positive rational
`start`/`end`, untrusted UTF-8 text and optional exact dialogue-line revision.
Segments must
fit the pinned timeline duration, remain ordered and non-overlapping under the
active subtitle policy, and stay within Core's count, text-length and payload
limits. The complete batch is atomic; a malformed segment cannot leave a
partial track revision.

Both transition commands require the current expected revision row version and
the same exact timeline ID/hash. They re-evaluate timing, project ownership,
materialization and rights immediately before the transition. An explicit
human approval action is required for `APPROVED`; if an audio/subtitle review
subject is not supported by the active review contract, the command returns a
typed `REVIEW_NOT_SUPPORTED`/`needs_user` response and leaves the revision in
its previous state instead of silently labelling metadata approved. Approved
content is immutable.

Every mutation requires an authenticated Core actor, an `Idempotency-Key`
bound to the canonical payload and expected versions, and an auditable
Command/Action record. Equivalent retries replay the original result; key
reuse with changed payload, timeline hash or expected version writes nothing.

### Queries and project-scoped HTTP adapter

The read projections are:

- `query.timeline.audio_cue_timing({project_id, timeline_id,
  timeline_revision_id, state?, cursor?})`;
- `query.timeline.subtitle_timing({project_id, timeline_id,
  timeline_revision_id, locale?, state?, cursor?})`; and
- `query.timeline.timing_impact({project_id, timeline_id,
  timeline_revision_id})`, which reports exact dependent revision IDs, stale
  reasons and the next human action.

The loopback adapter maps them and the commands to:

- `GET /v1/projects/{project_id}/timelines/{timeline_id}/revisions/{timeline_revision_id}/audio-cues`;
- `GET /v1/projects/{project_id}/timelines/{timeline_id}/revisions/{timeline_revision_id}/subtitle-tracks`;
- `GET /v1/projects/{project_id}/timelines/{timeline_id}/revisions/{timeline_revision_id}/timing-impact`;
- `POST /v1/projects/{project_id}/audio-cues`;
- `POST /v1/projects/{project_id}/audio-cues/{cue_id}/revisions`;
- `POST /v1/projects/{project_id}/audio-cues/{cue_id}/revisions/{revision_id}/transition`;
- `POST /v1/projects/{project_id}/subtitle-tracks`;
- `POST /v1/projects/{project_id}/subtitle-tracks/{track_id}/revisions`; and
- `POST /v1/projects/{project_id}/subtitle-tracks/{track_id}/revisions/{revision_id}/transition`.

Mutation paths must bind the body `timeline_id` and exact revision/hash to the
project and route scope; a route/body mismatch is a typed conflict. Public
responses include stable IDs, enum states, rational values, timeline hash,
dependency hash, redacted stale reasons and `needs_user`/`next_step`. They may
include exact selected-audio asset-revision IDs, digests and readiness/rights
outcomes, but never filesystem paths, provider fields, secrets, raw payloads or
waveform and audio bytes.

Malformed or unsupported input maps to `400 VALIDATION`; unknown or
cross-project IDs map to `404`; stale timeline pins, row versions, idempotency
reuse, rights/materialization failures, overlap/bounds conflicts and a stale
transition map to `409 CONFLICT` with a human-readable next step. `UNKNOWN` is
never coerced to `PASS`. A `503` is reserved for actual Core availability
failure.

Reads project a timing revision as `STALE` when the pinned timeline revision or
content hash is no longer the current exact head for that timeline, or when a
selected asset, rights record or localization source has an open hard
dependency invalidation. The projection preserves the immutable draft and
offers creation of a new revision against an explicitly named current
timeline; it never silently retimes or deletes data. This slice has no
recording, provider dispatch, generation, mixing/stems, playback, waveform,
render/transcode, export, handoff, release, publish or arbitrary-shell route.

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

The V1 local adapter implements this boundary through `ImportAsset`/`RegisterAsset`:
`COPY` reserves a durable `staging_objects` row, copies through a stable local
handle, verifies the staged identity and SHA-256, and only then registers a
content-addressed object.  `REFERENCE` records the external location and its
cryptographic fingerprint but remains `availability=UNKNOWN`, with an
`UNVERIFIED` location, until explicit revalidation evidence exists.

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

The local Core adapter exposes the bounded recovery surface as:
- `GET /v1/storage/staging` (`query.storage.staging_orphans`); and
- `POST /v1/storage/staging/reconcile` (`ReconcileStaging`, idempotent and
  auditable).

Startup reconciliation checks at most the oldest 200 non-terminal rows and
marks missing/escaped bytes `ORPHANED` or changed/reparse bytes `QUARANTINED`;
it never promotes an ambiguous temp file to a canonical asset.


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



# API-RELEASE-ARTIFACT-PROVENANCE. Release artifact provenance API

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

# API-INSTALLER-UPDATE-PLAN. Installer/update plan API

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

# API-ARTIFACT-PROVENANCE-RESOLUTION. Artifact provenance resolution

Privileged artifact selection accepts immutable artifact identity only:
- source repository/workflow;
- run ID/attempt;
- source commit;
- artifact ID;
- digest.

API rejects “give me artifact named Release-x64” as sufficient authority.

# API-OFFLINE-VERIFICATION. Offline verification API

`update.verify_offline_package` returns separately:
- signature validity;
- key trust state;
- known revocation state;
- revocation freshness;
- version-floor result;
- package digest result.

UI/policy decides whether stale revocation knowledge is acceptable for the active security profile.

# API-RELEASE-TRIGGER-AUTHORIZATION. Release trigger authorization

Before a privileged release command:
- validate source commit is in allowed release lineage;
- validate triggering actor/automation authority;
- validate expected GitHub Environment/rules/check producer identity where used;
- validate release policy revision.

Missing expected protection returns ASSURANCE_UNAVAILABLE/POLICY_BLOCKED, not success.



# API-PRIVACY-PURGE. Privacy purge API

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

# API-FORWARD-REVOCATION-RECOVERY. Forward revocation recovery API

Internal recovery:
- `recovery.load_forward_journal`
- `recovery.apply_forward_journal`
- `recovery.verify_forward_floor`

Recovered backups cannot activate until later purge/revocation/security-floor entries are applied.

# API-SEMANTIC-SEARCH-SCOPE. Semantic search scope API

Search request requires:
- authorized studio/project/shared scope;
- privacy/rights context;
- index generation.

Backend retrieval itself enforces scope.
UI-side post-filtering is not the primary security boundary.

# API-INFERENCE-SESSION-ISOLATION. Inference session isolation API

Internal:
- `inference.acquire_session(scope)`
- `inference.reset_session`
- `inference.close_session`

Cross-project/private scope transition requires reset or new isolated process according to runtime isolation class.

# API-LEARNING-DERIVATIVE. Learning derivative API

Queries:
- `query.learning.derivative_lineage`
- `query.learning.revocation_impact`

Commands:
- QuarantineLearningDerivative
- RequestDerivativeRetraining
- RetireLearningDerivative

Revoking a source can invalidate downstream datasets/adapters/checkpoints according to rights policy.

# API-CONSENT-TELEMETRY-DISPATCH. Consent/telemetry dispatch API

Before telemetry/cloud outbound emission:
- resolve current privacy_generation;
- compare queued expected generation;
- recompute destination/data-class permission;
- cancel/block if tightened policy no longer allows transmission.

# API-CORE-OWNERSHIP. Core ownership API

Startup/internal:
- `core.acquire_library_writer`
- `core.heartbeat_library_writer`
- `core.begin_drain`
- `core.release_library_writer`
- `core.recover_stale_writer`

A UI process cannot directly claim writer ownership.

# API-ARCHIVE-READ-ONLY. Archive read-only API

- `archive.verify_seal`
- `archive.open_readonly`
- `archive.import_to_working_project`

No mutation/migration command targets sealed archive bytes.

# API-EXTERNAL-EXPOSURE. External exposure API

Exposure query is durable even after local purge, subject to audit/privacy retention.

UI can answer:
- what was sent;
- where;
- when;
- under which policy/terms;
- what deletion/takedown state is known.



# API-COLLABORATION-OFFLINE. Collaboration/offline API

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

# API-RECONNECT-REBASE. Reconnect/rebase contract

`PlanBranchRebase` returns:
- base/current revision;
- authority/membership status;
- tombstone/purge findings;
- merge class per operation/domain;
- automatically rebasable ops;
- semantic conflicts;
- expired/unsupported operation-schema findings.

`SubmitBranchForMerge` re-runs the plan against current state before committing.

# API-COLLABORATION-AUTHORITY-REVALIDATION. Collaboration authority revalidation

At sync/submit:
- actor account enabled;
- current role/membership;
- device state;
- project state;
- rights/privacy policy;
- current lock/fencing token.

If authority was revoked, branch remains exportable/inspectable according to policy but cannot mutate canonical project.

# API-CANONICAL-PROMOTION-CAS. Canonical promotion CAS API

`PromoteCandidate` requires:
- canonical slot ID;
- expected current revision/version;
- candidate revision.

Conflict returns current observed canonical revision.
No automatic last-write-wins.

# API-OFFLINE-IRREVERSIBLE-ACTION. Offline irreversible-action API

Offline client may call plan/draft APIs but final methods:
- PublishRelease
- ExecuteExternalDelete
- SignReleaseArtifact
- ExecuteHighCostDispatch
- ChangeCredentialAuthority
- ChangeRightsAuthority

require an online current Core session and fresh authority token.

# API-NOTIFICATION-DELIVERY-AUTHORIZATION. Notification delivery authorization

Before collaboration mention/review/task notification is emitted:
- resolve current recipient access;
- apply lock-screen/privacy mode;
- drop/redact if access was removed.



# API-SCHEDULER-RETRY-COORDINATION. Scheduler/retry coordination API

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

# API-FALLBACK-ROUTING. Fallback routing API

`routing.plan_fallback` returns:
- source failure domain;
- candidate targets;
- target quota/capacity;
- privacy/rights compatibility;
- ramp percentage;
- cooldown/hysteresis evidence;
- max additional cost exposure.

No binary “provider down → all traffic to fallback” operation.

# API-PAID-DISPATCH-BUDGET-ADDITIONS. Paid dispatch budget API additions

Paid dispatch response includes:
- settled actual;
- currently reserved;
- unreconciled unknown exposure;
- planned new exposure;
- provider price snapshot time/confidence;
- current project/studio ceiling.

If delayed settlement later pushes actual over nominal cap, UI/audit records it as external settlement overrun, not as evidence that admission control never existed.



# API-BROWSER-PROFILE-SESSION. Browser profile/session API

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

# API-BROWSER-ACTION-EXECUTION. Browser action execution API

`browser.execute_typed_action` accepts:
- connector capability/action ID;
- expected origin/page fingerprint;
- exact staged handles;
- job/session epoch;
- effect class;
- precondition hash.

No raw “click arbitrary selector/run page instruction” is exposed as normal production API.

# API-BROWSER-DOWNLOAD-RECEIPT. Browser download receipt API

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

# API-BROWSER-AUTH-CHALLENGE. Browser auth challenge API

Challenge result:
- challenge_type;
- account/workspace expected/observed;
- human takeover required;
- retryable generation state: YES | NO | UNKNOWN.

UNKNOWN never authorizes a replacement paid generation.



# API-EVALUATOR-QC. Evaluator/QC API

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

# API-OOD-ABSTENTION. OOD/abstention contract

Evaluation output includes:
- claim type;
- result;
- confidence if meaningful;
- OOD/domain assessment;
- limitations;
- coverage;
- evidence independence.

Client cannot convert UNKNOWN/OUT_OF_DOMAIN to PASS by local defaulting.

# API-GOLDEN-BENCHMARK. Golden/benchmark API

Queries:
- `query.learning.benchmark_integrity`
- `query.learning.benchmark_rights`
- `query.learning.holdout_status`

Promotion commands reject benchmark sets with:
- corrupt example;
- rights/privacy block;
- stale integrity manifest;
- insufficient required holdout/shadow evidence.

# API-POST-QC-MUTATION. Post-QC mutation API

Any artifact-transforming command reports whether it invalidates:
- technical QC;
- identity QC;
- audio QC;
- subtitle QC;
- human review.

Release readiness queries final artifact lineage and currently valid evidence only.



# API-PROVENANCE. Provenance API

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

# API-HANDOFF-IMPORT-PROVENANCE. Handoff/import provenance API

Handoff manifest exposes exact exported fingerprints.
Return import:
- verifies expected files;
- detects mismatch;
- creates transform/flattened edge only when evidence supports it;
- otherwise registers a new UNVERIFIED source.

# API-PUBLICATION-ARTIFACT. Publication artifact API

Publication query distinguishes:
- approved master;
- exact upload bytes;
- public/platform derivative.

Verification of one artifact role never marks all roles verified.

# API-SIMILARITY-RISK. Similarity-risk API

Similarity analysis returns evidence/UNKNOWN/OOD and possible source matches.
It cannot emit a binding legal verdict.

# API-PROVENANCE-PARSER-NETWORK-POLICY. Provenance parser network policy

Manifest parsing never automatically dereferences external URLs.
Optional external evidence retrieval uses the standard authorized URL-fetch security boundary.



# API-LEARNING-FEEDBACK-EVALUATION-INTEGRITY. Learning feedback and evaluation-integrity API

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

# API-SEALED-HOLDOUT-ACCESS. Sealed holdout access contract

Sealed holdout content is unavailable to:
- prompt optimization;
- production router scoring;
- repair generation;
- candidate training/tuning;
- normal assistant context.

Promotion receives only policy-approved outputs such as aggregate score and bounded evidence summary.

Access to example content requires an explicit audit purpose and authority.

# API-ROUTER-MULTI-OBJECTIVE. Router multi-objective contract

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

# API-LEARNING-TAINT-INVALIDATION. Learning-taint invalidation API

When source/benchmark/label evidence is tainted:
1. mark dependent dataset/benchmark evidence stale/tainted;
2. walk promotion_evidence_dependencies;
3. create DecisionRequest or automatic depromotion according to policy;
4. invalidate cached benchmark summaries derived from tainted evidence;
5. preserve historical audit.

# API-PROMOTION-ROLLBACK-BUNDLE. Promotion/rollback bundle API

Promotion methods operate on promoted_component_bundle_id.

Before PromoteComponentVersion:
- validate feature/schema/calibration compatibility;
- validate required evidence remains current/non-tainted;
- verify required domain coverage;
- verify rollback bundle exists where policy requires.

Rollback restores the compatible bundle, not only the model/router binary.

# API-OUTCOME-LABELING. Outcome-labeling contract

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



# API-STRUCTURED-DOCUMENT-PARSING. Structured document parsing API

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

# API-SPREADSHEET-FORMULA-VALUE. Spreadsheet formula/value contract

Spreadsheet API returns separately:
- source formula;
- cached/display value;
- normalized interpreted value;
- calculation freshness;
- external dependency state;
- workbook date system;
- sheet/range/cell identity.

Caller cannot request “just give me the value” and silently lose whether it is stale/external/formula-derived when that distinction matters.

# API-OCR-LAYOUT-EVIDENCE. OCR/layout evidence API

OCR/layout result includes:
- page/region;
- reading order;
- confidence;
- parser/OCR version;
- ambiguity flags.

Canonical script/shot/canon mapping from low-confidence OCR requires review according to policy.

# API-DOCUMENT-PROTECTION. Document protection state API

Errors/states distinguish:
- PASSWORD_REQUIRED
- ENCRYPTED_UNSUPPORTED
- SIGNED
- SIGNATURE_INVALID
- CORRUPT
- UNSUPPORTED_FORMAT

Password/credential material is scoped to the parse session and excluded from normal logs.

# API-SEMANTIC-COVERAGE-GATE. Semantic-coverage gate

Before using a document parse as authoritative structured project data:
1. identify which semantic channels the intended use depends on;
2. check coverage for those channels;
3. if required channel is PARTIAL/UNKNOWN/UNSUPPORTED, create DecisionRequest or block automatic promotion;
4. bind accepted mapping to exact document parse revision.



# API-FILM-SPATIAL-CONTINUITY. Film spatial/continuity API

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

# API-RETIME-INTERPOLATION. Retime/interpolation API

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

# API-CONVERSATION-OVERLAP. Conversation overlap API

Queries:
- query.dialogue.utterance_timeline
- query.dialogue.overlap_groups

Commands:
- CreateUtteranceEvent
- BindNonverbalSpeaker
- MarkInterruption
- ResolveSpeakerAmbiguity

Diarization may propose speaker binding but does not become canonical without policy/evidence.

# API-MULTILINGUAL-DUBBING-FIT. Multilingual dubbing-fit API

Queries:
- query.dubbing.voice_language_profile
- query.dubbing.fit_candidates

Commands:
- CertifyVoiceLanguageProfile
- CreateDubbingFitCandidate
- SelectDubbingFitCandidate

Fit analysis considers semantic text, duration, speech rate, pronunciation and viseme/phoneme compatibility where available.

# API-DELIVERABLE-AUDIO-SUBTITLE-VALIDATION. Deliverable audio/subtitle validation API

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

# API-EDITOR-HANDOFF-CAPABILITY. Editor handoff capability API

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

# API-ALTERNATE-DELIVERABLE. Alternate deliverable API

Commands:
- CreateDeliverableVariant
- GenerateReframeVariant
- SubmitVariantReview
- ApproveVariant

Each materially distinct crop/aspect/profile has independent review/release gates.



# API-COLLABORATION-AUTHORIZATION. Collaboration authorization API

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

# API-CAPABILITY-TOKEN-SUBSCRIPTION-REVOCATION. Capability-token/subscription revocation API

Internal methods:
- auth.issue_scoped_capability_token
- auth.revoke_project_tokens
- auth.revalidate_session
- events.reauthorize_subscription
- events.terminate_subscription

Media/preview tokens bind actor/session/project/purpose and authorization epoch.
Membership/role revocation can invalidate sensitive tokens/subscriptions.

# API-COLLABORATIVE-EDIT-MERGE. Collaborative edit merge contract

Per-domain merge policy is queried before sync/merge.

Rules:
- BRANCH_ONLY/EXCLUSIVE domains never auto-merge semantically;
- stale offline work is preserved as branch/working copy;
- last-write-wins is not the default for canon/rights/release/timeline critical edits;
- structured text merge can produce unresolved conflicts rather than invent one truth.

# API-COLLABORATIVE-UNDO. Collaborative undo API

Undo/redo in shared state operates on the current actor/session operation graph.

Command:
- PlanCompensateCollaborativeOperation
- CompensateCollaborativeOperation

It does not rewind unrelated later operations by other actors.

# API-CONCURRENT-APPROVAL-SELECT. Concurrent approval/select API

Canonical selection/approval commands require:
- expected aggregate/canonical revision;
- exact candidate revision;
- current reviewer authority epoch;
- review dependency hash.

Conflicting simultaneous approvals return STALE/CONFLICT; both do not become canonical.

# API-DELEGATION-IMPERSONATION. Delegation/impersonation API

Queries:
- query.authority.delegations
- query.authority.impersonation

Commands:
- GrantDelegation
- RevokeDelegation
- BeginImpersonationSession
- EndImpersonationSession

Every delegated/impersonated command records principal + effective actor and authority source.

# API-CROSS-PROJECT-REUSE. Cross-project reuse API

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



# API-PERFORMANCE-WORKING-SET-QUERY. Performance/working-set query contract

Large collections are cursor-paginated and bounded.

Queries:
- query.project.working_set
- query.library.assets_page
- query.timeline.window
- query.activity.page
- query.history.page
- query.writer_pressure
- query.projection.health

No ordinary UI query is allowed to implicitly return the complete project graph/history/library.

# API-WRITER-PRESSURE. Writer-pressure API

Core exposes human-safe and advanced writer health.

Internal admission:
- INTERACTIVE_CANONICAL commands retain latency priority;
- background metadata/telemetry can coalesce/defer;
- oversized imports/invalidation use chunk commands/transactions.

A delayed background persistence does not cause UI to falsely show canonical save as durable.

# API-PROJECTION-REBUILD. Projection rebuild API

Commands:
- StartProjectionRebuild
- PauseProjectionRebuild
- ResumeProjectionRebuild
- PromoteProjectionGeneration
- RetireProjectionGeneration

Rebuild records cursor/checkpoint and can resume.
Verified previous generation remains queryable where policy permits.

# API-DERIVED-WORK-DEMAND. Derived-work demand API

Queries:
- query.derived_work.pending
- query.derived_work.current_demand

Commands:
- RequestDerivedWork
- PromoteDerivedWorkDemand
- CancelDerivedWork
- PauseBackgroundDerivation

Visible/active workspace demand outranks speculative background precompute.

# API-SCHEDULER-FAIRNESS. Scheduler fairness API

Queries:
- query.scheduler.fairness
- query.scheduler.project_debt
- query.scheduler.starvation

Planner/scheduler uses project weights, priority aging and interactive reserve.
Priority does not imply permanent starvation of lower classes.

# API-BACKUP-RPO-RTO. Backup RPO/RTO API

Queries:
- query.backup.policy_health
- query.backup.restore_estimate
- query.backup.last_restore_measurement

Backup health reports:
- latest recoverable point;
- durability/failure domain;
- estimated/observed restore time;
- verification state.

“Backup exists” is not equivalent to meeting RPO/RTO.

# API-MAINTENANCE-ADMISSION. Maintenance admission API

Commands:
- PlanMaintenance
- AdmitMaintenance
- PauseMaintenance
- ResumeMaintenance

Admission evaluates:
- temp disk;
- IO/CPU/GPU/network bundle;
- currently active foreground work;
- physical resource group contention;
- battery/thermal policy.

# API-LARGE-FANOUT-INVALIDATION. Large-fanout invalidation API

Root change commits an invalidation generation/fence quickly.
Background propagation materializes descendants in chunks.

Queries expose:
- root fence;
- propagation progress;
- conservative stale state.

No UI/API may report a descendant as current merely because its materialized stale row has not yet been written.

# API-INCREMENTAL-RELEASE-READINESS. Incremental release-readiness API

Release readiness query uses an event-maintained projection for responsiveness.
Final release command performs authoritative current gate revalidation independent from cached projection.



# API-CAPABILITY-SEMANTIC-CERTIFICATION. Capability semantic certification API

Queries:
- query.connections.capability_certification
- query.connections.tool_identity
- query.connections.capability_health
- query.connections.execution_receipt

Commands:
- CertifyCapabilitySemantics
- RevokeCapabilityCertification
- ReverifyToolIdentity
- MarkCapabilityDegraded

Dispatch requires a current certification compatible with the requested effect/idempotency/cancellation profile.

# API-MCP-NESTED-CALL-AUTHORIZATION. MCP/nested-call authorization contract

Every nested tool/resource/callback request from a connector is authorized as a new host operation.

It may not:
- broaden project/file/network scope;
- invoke a higher effect class;
- access another credential/account;
- forward extension data to an unrelated connector

unless the host explicitly grants that typed bridge.

# API-CONNECTOR-RESULT-STREAM-BUDGET. Connector result/stream budget API

Host enforces:
- max metadata bytes;
- max stream bytes/events/rate;
- idle/total timeout;
- spill-to-staging;
- cancellation/backpressure.

Oversized result becomes PARTIAL/QUARANTINED/FAILED per certification policy; it is not loaded unbounded into Core/UI memory.

# API-CLI-RUNNER-SEMANTIC-SUCCESS. CLI runner semantic success API

CLI result reports:
- process exit status;
- process-tree termination status;
- expected artifact presence/validation;
- partial artifact inventory;
- structured machine output parse state;
- stderr/log refs.

Human stdout text is not parsed as authoritative success when a machine contract exists.

# API-COMPLETENESS-RETRY. API completeness/retry contract

Adapter exposes:
- per-item batch outcome;
- pagination completeness;
- creation receipt;
- eventual-consistency state;
- provider retry/backoff hint.

A missing item in an incomplete/eventually-consistent listing is not proof it does not exist.

# API-BROWSER-ACTION-GUARD. Browser action guard API

Before high-effect browser actions:
- browser.verify_action_context(checkpoint)
- browser.execute_guarded_action(checkpoint)
- browser.reconcile_uncertain_action(checkpoint)

Context verification includes account/workspace/page/action/target fingerprints.

Timeout after click produces UNCERTAIN, not automatic retry.

# API-CAPABILITY-HEALTH. Capability health API

Connection summary aggregates per-capability health.

Routing asks for exact requested capability/model/action readiness.
A green connection card alone does not authorize a critical action.

# API-SUBPROCESSOR-EGRESS-CHAIN. Subprocessor/egress chain contract

Execution receipt includes declared/observed effective provider/account/region/subprocessor metadata when available.

Privacy/rights policy checks that chain before or immediately around dispatch according to connector capabilities.

Unknown effective processing path can block sensitive jobs.



# API-EPOCH-QUALIFIED-EVENT-CURSOR. Epoch-qualified event cursor API

Replace the conceptual bare after_seq cursor with:

EventCursor {
  installation_id,
  library_lineage_id,
  deployment_generation,
  recovery_epoch_id,
  stream_generation_id,
  event_seq
}

events.subscribe(cursor, scopes, classes)

Responses include:
- EVENT_BATCH
- CURSOR_TOO_OLD
- EPOCH_MISMATCH
- RESET_REQUIRED
- RECOVERY_DIVERGENCE

The server never returns an empty successful stream solely because the client's numeric seq is greater than the restored stream.

# API-CLIENT-CORE-RECOVERY-HANDSHAKE. Client/Core recovery handshake

On connect/reconnect:
- client.handshake(local_sync_context)

Core returns:
- installation/library lineage;
- deployment generation;
- recovery epoch;
- active stream generation;
- active projection generations;
- API compatibility;
- token/session reset instructions.

If mismatch:
- cached query projections invalidated;
- old scoped capability tokens invalidated;
- pending side-effectful commands moved to reconciliation;
- unsynced drafts preserved as divergent working copies where possible.

# API-OFFLINE-PENDING-COMMAND-RECONCILIATION. Offline pending-command reconciliation API

Commands:
- ClassifyOfflinePendingCommands
- PreservePendingEditAsDraft
- ReissueSafePendingCommand
- ResolvePendingSideEffectCommand
- DiscardPendingCommand

Policy:
- side-effectful/paid/publish/delete commands from superseded recovery epoch never auto-replay;
- local draft edits may be preserved/branched;
- reads can normally be discarded/reissued.

# API-RECOVERY-SPECIFIC-CONFLICT-ERRORS. Recovery-specific conflict errors

Stable errors include:
- RECOVERY_EPOCH_MISMATCH
- DEPLOYMENT_GENERATION_MISMATCH
- DIVERGENT_OFFLINE_HISTORY
- SUPERSEDED_CAPABILITY_TOKEN
- CLIENT_RESET_REQUIRED

UI/support can distinguish disaster-recovery divergence from an ordinary stale edit.

# API-POLICY-EXPLANATION. Causal policy explanation contract

When a command is blocked, Core returns an ordered, typed explanation chain
instead of a generic denial. Each step identifies the policy revision,
decision input class, owning authority, and the resulting `ALLOW`, `BLOCK`,
`DEGRADED_EXPLICIT`, or `REAUTH_REQUIRED` decision. The chain is a diagnostic
projection of canonical policy decisions; it cannot grant authority, rewrite a
decision, or be treated as user supplied control text.

The explanation is stable for a pinned command/snapshot and includes the
effective policy generation and decision snapshot identity. A later policy
change produces a new explanation and requires the command to be revalidated.
Redaction follows the same data-class policy as diagnostics, so secrets,
private prompts, credentials, and protected media paths are never copied into
the explanation. Unknown or incomplete causal inputs remain explicit and keep
the command blocked until an authorized policy resolves them.

# API-RIGHTS-CONSENT-BASELINE. Rights identity and effective evaluation

The V1 baseline exposes four auditable commands through `command.execute` (or
`POST /v1/commands`):

- `CreateRightsIdentity({subject_type, subject_id, project_id?, notes?})`
- `CreateRightsRecord({rights_identity_id, right_type, status, territory?, purpose?, valid_from?, valid_to?, evidence_summary?})`
- `RecordConsent({rights_identity_id, consent_type, granted_by, valid_from?, valid_to?, evidence_asset_revision_id?})`
- `RevokeRights({rights_identity_id, right_type?, consent_type?, reason, effective_at?})`

Every command creates a command row, domain event, and audit record. Evidence
rows are append-only. A replay with the same actor, command type, idempotency
key, payload, and expected versions returns the original result; a changed
payload is rejected as an idempotency conflict.

Queries are:

- `query.asset.rights({asset_id, right_type?, consent_type?, territory?, purpose?, at_utc_us?})`;
- `query.rights.evaluate({rights_identity_id, right_type?, consent_type?, territory?, purpose?, at_utc_us?})`;
- `query.rights.identity({rights_identity_id})`, which returns the identity,
  append-only records, consents, revocations, and the current evaluation.

The HTTP adapter exposes `GET /v1/assets/{assetId}/rights`,
`GET /v1/rights/evaluate`, and `GET /v1/rights/{identityId}/identity`.
Imported assets include a rights projection that starts at `UNKNOWN`; it only
becomes `ALLOWED` when both the requested right and consent are effective and
unrevoked. `RESTRICTED`, `UNKNOWN`, `EXPIRED`, and `REVOKED` all have
`eligible=false` and structured blockers. This baseline does not yet claim
provider egress, generation, training, publish, legal document parsing,
multi-user authority, or signed provenance controls; those callers must keep
their own gates explicit until their bounded slices land.

# API-CHARACTER-CANON-BASELINE. Character identity and package revisions

The local V1 canon slice keeps `CharacterIdentity` separate from visual,
voice and performance packages.  No provider voice ID, outfit or internal
asset path is accepted as canonical character state.

Commands are issued through `command.execute` (or `POST /v1/commands`):

- `CreateCharacter({project_id, stable_code?, display_name})`
- `CreateVisualIdentityRevision({character_id, semantic_description?, anatomy?, proportion?, palette?, marking?, forbidden_drift?, references?})`
- `CreateVoiceIdentityRevision({character_id, canonical_language?, semantic_description?, accent_profile?, vocal_range?, timbre?, prosody?, emotional_map?, pronunciation_lexicon?, forbidden_traits?, rights_identity_id?})`
- `CreatePerformanceBibleRevision({character_id, posture?, gait?, gestures?, eye_behavior?, reaction_timing?, speech_rhythm?, emotional_baseline?, forbidden_drift?})`
- `TransitionCharacterRevision({revision_type, revision_id, next_state})`, with
  `expected_versions` bound to the revision row version.

When supplied, `stable_code` is canonicalized to uppercase before the
project-scoped uniqueness check.

Revision states are explicit: `DRAFT → CANDIDATE → APPROVED → SUPERSEDED`,
with `CANDIDATE → REJECTED`.  Approved content is immutable; a changed
content payload creates a new revision.  Visual references must point at a
same-project, materialized, approved asset revision.  Voice approval evaluates
the linked rights/consent identity and blocks `UNKNOWN`, `RESTRICTED`,
`EXPIRED`, and `REVOKED` with `needs_user=true`.

Queries are:

- `query.character.list({project_id?, lifecycle_state?, limit?})`;
- `query.character.workspace({character_id, project_id?})`, which returns the
  identity, package roots, revision IDs/states, readiness, rights evidence and
  a projection sequence.

The HTTP adapter exposes global and project-scoped list/workspace routes:
`GET /v1/characters`, `GET /v1/characters/{id}/workspace`,
`GET /v1/projects/{projectId}/characters`, and
`GET /v1/projects/{projectId}/characters/{id}/workspace`.  Creation routes
are `POST /v1/projects/{projectId}/characters` and the nested
`visual-revisions`, `voice-revisions`, and `performance-bibles` routes.
Responses redact local resolver paths and never expose provider binding fields.
Generation, dialogue, timeline snapshots, costumes, props and release remain
outside this bounded contract.

# API-BACKUP-LOCAL-BASELINE. Local backup and verification

The schema v8 V1 slice exposes a local, single-installation backup contract.
It is deliberately narrower than the future restore/recovery and remote
durability contracts described elsewhere in this document.

Commands are issued through `command.execute` (or `POST /v1/commands`):

- `CreateBackup({destination_path?, durability_class?, failure_domain?, reserve_bytes?, max_backup_bytes?})`
- `VerifyBackup({backup_id})`

`CreateBackup` is an auditable, idempotent command.  It admits the operation
before writing bytes, rejects a database/asset-store destination, creates a
SQLite `VACUUM INTO` snapshot and a versioned manifest, copies managed CAS
objects, and verifies the complete artifact before registration.  The current
supported durability class is `LOCAL_WRITABLE`; requesting
`SEPARATE_VOLUME`, `OFFLINE`, or `IMMUTABLE_REMOTE` returns
`DURABILITY_PROFILE_UNAVAILABLE` until the corresponding durability connector
is implemented.  `max_backup_bytes` and free-space checks fail closed with
`STORAGE_PRESSURE` and leave no partial destination.

`VerifyBackup` re-hashes the manifest, snapshot and copied objects, runs the
snapshot integrity check, and checks the installation identity.  A tampered or
missing artifact returns a successful command envelope containing
`verification.outcome=FAILED`, `integrity_state=FAIL`, and backup
`state=FAILED`; the failed measurement is retained in the append-only
verification ledger.  `UNKNOWN` is never treated as `VERIFIED`.

Queries are:

- `query.backup.list({limit?})`;
- `query.backup.get({backup_id})`, including append-only verification rows;
- `query.storage.admission({destination_path?, durability_class?, reserve_bytes?, max_backup_bytes?})`,
  which returns an estimate or the same fail-closed pressure/profile error as
  `CreateBackup`.

The HTTP adapter maps these to `GET /v1/backups`, `GET /v1/backups/{id}`,
`POST /v1/backups`, and `POST /v1/backups/{id}/verify`.  The admission
preflight is also available as `GET /v1/storage/admission` with query
parameters.  Public backup
projections expose IDs, digests, counts, state, and stable file basenames;
absolute destination, manifest, and snapshot paths remain internal resolver
details.  The artifact manifest binds `installation_id`, `schema_version`,
`event_seq_checkpoint`, and the database/object digests so a snapshot cannot
silently be mistaken for another installation.

This bounded baseline does not implement restore/activation, recovery epochs,
forward revocation replay, remote/offline immutable durability, update
signing/anti-rollback, disaster recovery, garbage collection, or multi-user
backup authority.  Callers must not present a verified local backup as proof of
those properties.
