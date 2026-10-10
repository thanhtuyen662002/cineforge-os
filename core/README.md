# CineForge Core vertical slice

This directory contains the first runnable local-first Core slice. It is a
Node.js 22 implementation because the current development image has no Rust
toolchain; the public boundary is deliberately transport-neutral so it can be
hosted by Tauri or replaced with a Rust Core without changing the desktop API.

The slice owns project truth in SQLite and provides:

- SQLite WAL with `foreign_keys=ON`, `synchronous=FULL`, and a busy timeout;
- local studio/actor bootstrap;
- project create, metadata update, pause, archive, trash and restore;
- task and shot records plus append-only project/task/shot notes;
- local asset intake with SHA-256 verification, durable `staging_objects`
  lifecycle, content-addressed object storage, immutable revisions and
  redacted provenance-safe locations;
- append-only rights identities, rights evidence, consent records and
  effective-time fail-closed evaluation; imported assets start with an
  `UNKNOWN` rights projection until an allowed right and matching consent are
  both recorded;
- versioned local backup admission, SQLite snapshot/object-manifest creation,
  digest verification, tamper detection and append-only verification history;
  backup paths remain internal and public projections expose only safe
  basenames/digests;
- optimistic `row_version` checks and deterministic idempotency keys;
- append-only `commands`, `domain_events`, and `audit_records` ledgers;
- a bounded local managed-asset integrity probe job (`LOCAL_ASSET_PROBE_V1`)
  with durable attempts, redacted PASS/FAIL/UNKNOWN evidence, byte-read
  reservations, cancellation, exact retry and restart reconciliation;
- query projections for home, project workspace, health, activity, search,
  storage, library assets, import sessions and command history;
- resumable event reads using `events.subscribe({after_seq})`;
- a JSON-line process boundary for a desktop host;
- a loopback HTTP adapter for the packaged desktop shell.

The canonical timeline/media-profile checkpoint contract is implemented as the
bounded Issue #21 slice. Core owns the project-scoped profile, timeline and
immutable checkpoint rows; every mutation goes through the audited command
boundary and every read is a redacted projection.

The Issue #23 review baseline is executable as a separate Core-owned aggregate.
`review_sessions` pin an exact timeline revision and dependency snapshot;
`human_reviews` are append-only decisions. Timeline approval requires an exact
submitted `APPROVE` review whose content and dependency hashes still match. A
stale or missing review cannot be used as approval evidence.

## Timeline, review and handoff baseline status

The executable commands are:

- `CreateMediaProfileRevision`
- `TransitionMediaProfileRevision`
- `CreateTimeline`
- `CreateTimelineRevision`
- `TransitionTimelineRevision`
- `OpenReview`
- `SubmitReview`
- `CreateHandoffManifest`

The executable queries are `query.media_profile.workspace`,
`query.timeline.list`, `query.timeline.workspace`, `query.review.list`,
`query.review.get`, `query.handoff.list` and `query.handoff.get`. The loopback
adapter exposes media-profile setup/read plus project-scoped timeline list,
workspace, create, checkpoint, lifecycle-transition, review and handoff routes.
The baseline validates
bounded positive rationals with exact cross multiplication, rejects overlap and
out-of-bounds clips, pins an approved profile revision, and fail-closes on
cross-project, unavailable, unverified, externally referenced or rights-
blocked assets. Checkpoint content is canonicalized and hashed before the
immutable revision is written; retries are idempotent and stale versions are
rejected.

Review commands are audited and idempotent. `OpenReview` records the exact
subject/dependency snapshot. `SubmitReview` recomputes it and returns
`STALE_REVIEW` on any mismatch; `APPROVE` additionally requires `READY`
readiness. `TransitionTimelineRevision` also requires the caller to echo the
exact 64-hex dependency snapshot hash from the submitted review. The desktop
Review workspace shows metadata and honest state without claiming playback or
render capability.

Issue #25 adds a separate, metadata-only handoff preflight. `CreateHandoffManifest`
requires an explicitly approved timeline revision, the exact submitted
`APPROVE` review/session, the caller-supplied dependency snapshot hash, the
approved media profile and current materialized/rights-allowed asset revisions.
Core writes an immutable, deterministic, SHA-256-addressed manifest containing
only an explicit safe artifact allowlist plus compatibility and sanitization
reports. Unknown or unverified target versions never receive an editable
project claim, and `UNKNOWN` rights/readiness never becomes `PASS`.

The timeline working session, autosave, undo/redo, collaboration, playback,
render, technical-master/transcode and media-byte export, external-editor
editing round-trip, release, publish, release signing and arbitrary provider
execution remain explicitly deferred. The implemented timeline interchange is
a verified, local JSON artifact boundary. Its bounded return-registration
boundary is implemented below; neither surface renders or publishes media
bytes.
The desktop workspace states that boundary and never reports media progress
without Core evidence. These later surfaces must receive their own contracts
before they are added to the UI.

## Issue #27 bounded timeline working-session contract

Issue #27 specifies the next Core boundary for a project-scoped local editing
draft. This section is a contract and scope declaration; it is not an
implementation or verification claim. Until the matching code and evidence
exist, the runtime must continue to treat the working-session surface as
unavailable.

The specified audited commands are:

- `BeginTimelineWorkingSession`;
- `ApplyTimelineEditOp`;
- `UndoTimelineEditOp`;
- `RedoTimelineEditOp`;
- `AutosaveTimelineWorkingSession`;
- `CheckpointTimelineWorkingSession`; and
- `CloseTimelineWorkingSession`.

The session binds an actor/client to one exact project-scoped timeline
revision, content hash and row version. Operations are append-only, typed and
idempotent; the bounded allowlist is `INSERT_CLIP`, `MOVE_CLIP`, `TRIM_CLIP`,
`DELETE_CLIP` and `ADD_MARKER`. Payloads use checked rational time and exact
materialized asset revisions. `SPLIT_CLIP`, `RETIME_CLIP` and all audio,
caption, transition, link and effect operations are typed unsupported results.
Unknown fields, `latest`, provider/path data, cross-project IDs,
malformed/overflowed rationals and unavailable or rights-blocked assets are
rejected before mutation.

Undo is a causal compensating operation and redo replays the latest eligible
undo relation; neither rewinds global history. A new edit invalidates redo.
Autosave persists only the durable draft and acknowledgement sequence. A
checkpoint revalidates the exact profile, pins, materialization and rights,
then creates an immutable `DRAFT_CHECKPOINT` without approval. Close requires
`CLEAN` or an explicit abandon that preserves the draft. Stale base/session
versions, duplicate active sessions, dirty close, idempotency mismatch and
recovery failures are typed, redacted conflicts with `needs_user`/`next_step`.

The corresponding read projections and project-scoped HTTP routes must remain
Core-owned and redacted. Playback, audio/caption/transition editing,
multi-user/offline branch merge, leases, render/transcode, handoff/export,
release/publish, provider dispatch and arbitrary shell execution remain out of
scope for this issue.

## Handoff manifest preflight status

The executable Core queries are `query.handoff.list` and `query.handoff.get`.
The loopback HTTP adapter exposes:

- `GET /v1/projects/{id}/handoffs?state=&limit=` — list project-scoped
  preflight sessions and immutable manifests;
- `GET /v1/projects/{id}/handoffs/{handoffId}` — read one redacted manifest;
- `POST /v1/projects/{id}/handoffs` — execute the audited,
  idempotency-safe `CreateHandoffManifest` command.

The successful session state is `PREFLIGHT`; it is not a rendered/exported
file. The projection includes exact source/review/dependency/content/profile
hashes, pinned asset revision IDs/digests, a compatibility report with
`NATIVE`, `APPROXIMATED`, `UNSUPPORTED` or `UNKNOWN`, a sanitization report,
`needs_user` and `next_step`. Public responses redact absolute paths,
usernames, temp/cache locations, endpoints, credentials, prompts, diagnostics,
provider fields and unrelated private IDs. No recursive database/workdir sweep
or writable CAS alias is admitted to the artifact list.

An equivalent `Idempotency-Key` retry returns the same session/manifest and
hash; changing the payload under that key returns a conflict without a second
event. Stale/cross-project/malformed review or hash input, unknown rights,
unready/unmaterialized assets and changed timeline content fail closed without
partial output. This baseline performs no playback, render, transcode,
audio/subtitle processing, generation, external publish or release signing.

## Returned external-edit registration

After an editor returns a managed interchange document, the executable Core
command `RegisterExternalEdit` records its lineage against an exact immutable
handoff manifest or `COMPLETED` export session (callers may provide both; when
both are present they must resolve to the same binding). The command requires
an optimistic export-session version and an idempotency key, checks same-project
scope, current rights/consent (`ALLOWED`), active managed
`TIMELINE_INTERCHANGE` asset identity and stable SHA-256/size, then validates
the canonical UTF-8 `CINEFORGE_TIMELINE_INTERCHANGE` /
`GENERIC_INTERCHANGE_V1` profile. The parser rejects duplicate/unsafe keys,
non-canonical or non-finite JSON, unknown/provider/path/URI fields, malformed
rationals and bounded-limit violations. `EXACT` lineage is accepted only when
returned bytes equal the exact export bytes; otherwise the caller must state
`PARTIAL`, `FLATTENED` or `UNKNOWN`.

The successful row is immutable, append-only and project-scoped. It includes
the source/returned IDs and hashes, rights and validation state, a redacted
validation snapshot, human-readable next step and append-only contract diffs.
The command does not modify a canonical timeline, create or approve a review,
authorize release/publish, or execute an external provider. Failed validation
is retained in command/audit evidence; duplicate immutable identity is an
explicit conflict. The loopback adapter exposes these redacted projections:

- `GET /v1/projects/{id}/external-edits?validation_state=&limit=`;
- `GET /v1/projects/{id}/external-edits/{externalEditId}`; and
- `POST /v1/projects/{id}/external-edits` with
  at least one of `handoff_manifest_id` or `export_session_id` (both are
  recommended when the caller has the exact pair),
  `returned_asset_revision_id`, optional `lineage_confidence` and
  `expected_version`.

## Requirements

Node.js `>=22.5.0` is required. The implementation uses the built-in
`node:sqlite` module and has no npm runtime dependencies.

## Run tests

From the repository root:

```powershell
npm test --prefix core
```

The tests cover WAL persistence/reload, optimistic concurrency, failed-command
auditing, idempotent replay, append-only protections, task/shot notes and the
HTTP presentation surface.

## Start the Core

Without `--host` or `--port`, the process uses JSON lines on stdin/stdout. This
is the safest child-process boundary for a Tauri shell:

```powershell
node core/server.mjs --stdio --db .cineforge/cineforge.sqlite
```

Each input line is one API envelope. For example:

```json
{"api_version":"1","request_id":"r1","method":"query.system.health","params":{}}
```

When `--host` or `--port` is provided (or when `--http` is passed), the same
Core also exposes a loopback HTTP surface. The packaged Windows bootstrap uses
this mode:

```powershell
node core/server.mjs --host 127.0.0.1 --port 48201 --db .cineforge/cineforge.sqlite
```

The desktop-facing routes are:

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/v1/dashboard` | Dashboard projection used by the UI |
| GET | `/v1/health` | Versioned Core health envelope |
| POST | `/v1/projects` | Create a project; body accepts `name` or `title` |
| GET | `/v1/projects/{id}` | Read one project |
| PATCH | `/v1/projects/{id}` | Update metadata with `row_version` or `expected_version` |
| GET | `/v1/projects/{id}/workspace` | Project, tasks, shots and notes |
| GET | `/v1/projects/{id}/tasks` | List canonical project tasks |
| GET | `/v1/projects/{id}/tasks/{taskId}` | Read one task within its project scope |
| POST | `/v1/projects/{id}/tasks` | Create a canonical task (idempotency key supported) |
| PATCH | `/v1/projects/{id}/tasks/{taskId}` | Update a task with `row_version`/`expected_version` |
| POST | `/v1/projects/{id}/production-items` | Create a production task |
| GET | `/v1/projects/{id}/shots` | List canonical project shots |
| GET | `/v1/projects/{id}/shots/{shotId}` | Read one shot within its project scope |
| POST | `/v1/projects/{id}/shots` | Create a canonical shot (idempotency key supported) |
| PATCH | `/v1/projects/{id}/shots/{shotId}` | Update a shot with `row_version`/`expected_version` |
| GET | `/v1/projects/{id}/notes` | List append-only notes for the project |
| POST | `/v1/projects/{id}/notes` | Add a project note or a scoped task/shot note |
| GET | `/v1/projects/{id}/tasks/{taskId}/notes` | List notes attached to one task |
| POST | `/v1/projects/{id}/tasks/{taskId}/notes` | Add a note to one task |
| GET | `/v1/projects/{id}/shots/{shotId}/notes` | List notes attached to one shot |
| POST | `/v1/projects/{id}/shots/{shotId}/notes` | Add a note to one shot |
| GET | `/v1/projects/{id}/media-profile` | Read project media-profile revisions and blockers |
| GET | `/v1/projects/{id}/timelines` | List project timeline identities and revisions |
| GET | `/v1/projects/{id}/timelines/{timelineId}/workspace` | Read a project timeline checkpoint workspace |
| GET | `/v1/projects/{id}/reviews` | List project timeline review sessions |
| GET | `/v1/projects/{id}/reviews/{reviewId}` | Read one review session and immutable decision |
| POST | `/v1/projects/{id}/reviews` | Open an exact timeline review |
| POST | `/v1/projects/{id}/reviews/{reviewId}/submit` | Submit one immutable review decision |
| GET | `/v1/projects/{id}/handoffs` | List project-scoped handoff preflight sessions |
| GET | `/v1/projects/{id}/handoffs/{handoffId}` | Read one immutable, redacted handoff manifest |
| POST | `/v1/projects/{id}/handoffs` | Create an exact-hash handoff manifest preflight |
| GET | `/v1/projects/{id}/exports` | List project-scoped timeline interchange export sessions |
| GET | `/v1/projects/{id}/exports/{exportId}` | Read one redacted export session and validation snapshot |
| POST | `/v1/projects/{id}/exports/{exportId}/build` | Build a verified local timeline interchange JSON artifact |
| GET/HEAD | `/v1/projects/{id}/exports/{exportId}/download` | Issue a scoped capability or stream a verified artifact range |
| GET | `/v1/projects/{id}/external-edits` | List registered returned interchange lineage records |
| GET | `/v1/projects/{id}/external-edits/{externalEditId}` | Read one redacted returned-edit record and contract diffs |
| POST | `/v1/projects/{id}/external-edits` | Register a managed returned interchange against an exact export |
| GET | `/v1/projects/{id}/assets` | List project assets and latest immutable revisions |
| POST | `/v1/projects/{id}/assets` | Hash and register a local file (copy by default) |
| GET | `/v1/assets` | List assets across the studio |
| POST | `/v1/assets` | Hash and register a studio-wide local file |
| GET | `/v1/assets/{id}/rights` | Evaluate an asset's effective right/consent state |
| GET | `/v1/characters` | List CharacterIdentity projections, optionally scoped to a project |
| GET | `/v1/characters/{id}/workspace` | Read one character's separate package/revision workspace |
| POST | `/v1/projects/{id}/characters` | Create a stable CharacterIdentity (idempotency key supported) |
| GET | `/v1/projects/{id}/characters` | List characters in one project |
| GET | `/v1/projects/{id}/characters/{characterId}/workspace` | Read a project-scoped character workspace |
| POST | `/v1/characters/{id}/visual-revisions` | Create a draft visual identity revision |
| POST | `/v1/characters/{id}/voice-revisions` | Create a draft voice identity revision |
| POST | `/v1/characters/{id}/performance-bibles` | Create a draft performance bible revision |
| GET | `/v1/rights/evaluate` | Evaluate a rights identity at a requested effective time |
| GET | `/v1/rights/{id}/identity` | Read identity and append-only rights evidence |
| GET | `/v1/backups` | List local backup metadata and verification state |
| GET | `/v1/backups/{id}` | Read one backup and its append-only verification history |
| GET | `/v1/backups/{id}/restore-estimate` | Read-only artifact/recovery preflight with bounded byte/time estimate |
| POST | `/v1/backups` | Admit, create and verify a local backup (idempotency key supported) |
| POST | `/v1/backups/{id}/verify` | Re-verify a registered backup artifact |
| GET | `/v1/recovery/status` | Read-only recovery posture and fail-closed epoch/ledger checks |
| GET | `/v1/storage/admission` | Estimate backup storage or return fail-closed pressure/profile errors |
| GET | `/v1/storage/scrub-health` | Read-only bounded verification of managed CAS metadata, file size and SHA-256 (PASS/FAIL/UNKNOWN) |
| GET | `/v1/jobs?project_id=&state=&limit=` | List redacted local integrity jobs and their latest attempt/evidence |
| GET | `/v1/jobs/{id}` | Read one exact pinned local integrity job |
| GET | `/v1/jobs/{id}/retry-plan` | Read whether an exact bounded retry is currently allowed |
| POST | `/v1/projects/{id}/assets/{revisionId}/integrity-probe` | Queue a local managed-object integrity probe (requires `Idempotency-Key`) |
| POST | `/v1/jobs/{id}/cancel` | Request/confirm cancellation with the current job row version |
| POST | `/v1/jobs/{id}/retry` | Queue an exact retry of a retryable probe with the current job row version |
| GET | `/v1/storage/staging` | Inspect durable staging evidence (paths are redacted) |
| POST | `/v1/storage/staging/reconcile` | Reconcile one staging row or bounded pending rows |
| GET | `/v1/imports/{id}` | Read an import session and its item state |
| GET | `/v1/decisions` | List canonical open decision requests (state/project filters supported) |
| GET | `/v1/decisions/{id}` | Read one decision request with immutable choices and evidence |
| POST | `/v1/decisions/{id}/resolve` | Resolve a request with a choice and expected decision version |
| POST | `/v1/decisions/{id}/dismiss` | Dismiss a request with an expected decision version |
| POST | `/v1/decisions/{id}/ack` | Legacy compatibility route; canonical clients must resolve or dismiss |
| GET | `/v1/events?after_seq=N` | Replay domain activity after a cursor |

Advanced clients can use `POST /v1/commands` with the canonical command
envelope. The HTTP adapter binds to loopback only. Pass `--token` (or set
`CINEFORGE_CORE_TOKEN`) to require a bearer token on every HTTP request.

The database path is user data, not an installer-owned file. Imported bytes
remain outside SQLite in a content-addressed `asset-store/objects/...` tree by
default. `ImportAsset` first reserves a durable private staging row, hashes and
copies through one stable file handle, rejects symlink/reparse and hardlink
aliases, verifies an optional caller hash, and rechecks staged identity/content
before a race-safe CAS copy registers the immutable object, revision,
provenance, location and import session. A startup or explicit reconciliation
never adopts an ambiguous temp file: missing bytes become `ORPHANED`, changed
or reparse bytes become `QUARANTINED`. The `REFERENCE` mode records an external
file location and cryptographic content hash without copying it; its path is
redacted, its location is `UNVERIFIED`, and public availability/readiness stay
`UNKNOWN` until a verifier records current source evidence.

Canonical JSON clients can call:

```json
{
  "api_version": "1",
  "method": "command.execute",
  "params": {
    "command_type": "ImportAsset",
    "idempotency_key": "import-2026-001",
    "payload": {
      "project_id": "<project-id>",
      "source_path": "C:/media/shot-010.png",
      "asset_type": "IMAGE",
      "semantic_role": "SHOT_REFERENCE",
      "storage_mode": "COPY"
    }
  }
}
```

An import succeeds only after the bytes have been read and SHA-256 verified;
security scanning and media decode remain explicit `UNKNOWN` evidence rather
than being represented as a false pass.

Rights and consent changes use the advanced `POST /v1/commands` boundary with
`CreateRightsIdentity`, `CreateRightsRecord`, `RecordConsent`, and
`RevokeRights`. Each command is idempotent and auditable. Effective evaluation
returns `ALLOWED`, `RESTRICTED`, `UNKNOWN`, `EXPIRED`, or `REVOKED` plus
structured blockers; only `ALLOWED` is eligible. Provider egress, generation,
training, publish, legal parsing, multi-user authority, and signed provenance
remain separate gates until their own bounded implementation slices are
completed.

Character canon uses the same command boundary. `CreateCharacter` creates only
the stable identity plus empty package roots. The three revision commands keep
visual, voice and performance data separate; `TransitionCharacterRevision`
advances the explicit DRAFT/CANDIDATE/APPROVED/SUPERSEDED lifecycle (or
CANDIDATE/REJECTED) with an optimistic revision version. Visual references are
validated against same-project, materialized, approved assets. Voice approval
evaluates rights and consent and remains blocked for every state other than
ALLOWED. Provider bindings, generation, timeline, costume and prop state are
not silently implied by this baseline.

Local backup uses the advanced `POST /v1/commands` boundary as well as the
convenience routes above. `CreateBackup` accepts an optional destination,
`LOCAL_WRITABLE` durability class, free-space reserve and maximum byte budget;
it writes a private temporary directory, snapshots SQLite with `VACUUM INTO`,
copies managed content-addressed objects and atomically renames the directory
only after manifest and read-back verification pass. `VerifyBackup` rechecks a
registered artifact and appends either a `VERIFIED/PASS` or `FAILED/FAIL`
measurement. `STORAGE_PRESSURE` and unavailable durability profiles fail before
any destination is created. Absolute resolver paths are never returned by the
public backup/list/detail responses.

`GET /v1/backups/{id}/restore-estimate` is a read-only recovery preflight. It
re-hashes the registered manifest, SQLite snapshot and copied objects without
copying bytes or changing Core state, then reports bounded checks for record
state, artifact integrity, installation/schema compatibility, event checkpoint
and external references. It returns a theoretical IO-only byte/time estimate
(`64 MiB/s`) labelled as such; no observed restore duration is implied. The
response always sets `restore_allowed=false` and `activation_state=NOT_IMPLEMENTED`
until a governed recovery epoch, forward-policy reconciliation and explicit
activation command are implemented. `UNKNOWN` checks remain visible and are
never promoted to a restore pass.

`GET /v1/recovery/status` is a separate read-only posture projection. It
combines current Core ownership, SQLite integrity/WAL, storage-reserve evidence,
latest verified-backup state and event-projection evidence with explicit
`UNKNOWN` checks for the recovery epoch and the installation external-side-effect
ledger. The Core instance ownership epoch is not treated as a restore recovery
epoch. The projection never creates an epoch, freezes dispatch, changes backup
rows or activates a snapshot; `readiness_state=UNKNOWN` therefore remains the
expected result until a governed recovery implementation supplies those controls.

Canonical command examples:

```json
{
  "api_version": "1",
  "method": "command.execute",
  "params": {
    "command_type": "CreateBackup",
    "idempotency_key": "backup-2026-001",
    "payload": {
      "destination_path": "D:/CineForge/backups",
      "durability_class": "LOCAL_WRITABLE",
      "reserve_bytes": 67108864
    }
  }
}
```

The V1 backup baseline does not restore or activate a library, establish
remote/offline immutable durability, advance recovery epochs, replay forward
revocations, sign/update packages, run disaster recovery, or perform garbage
collection. A verified local artifact must not be presented as evidence of
those future guarantees.

Task and shot updates require an optimistic concurrency value. Send either
`row_version`/`expected_version` in the JSON body or an `expected_versions`
object; a stale value returns HTTP 409 with `STALE_REVISION`. Nested task and
shot routes verify that the target belongs to the project before executing a
command. Notes are append-only: the project route defaults to a project note,
while a task/shot route pins the target and rejects cross-project references.
Every mutating route accepts an `Idempotency-Key` header (or the equivalent
`idempotency_key` JSON field).

An idempotency key is scoped to the authenticated actor and command type. Core
stores a SHA-256 fingerprint of the canonical payload together with canonical
`expected_versions`. Retries with equivalent JSON (including a different
object-key insertion order) replay the original command result. Reusing the
same key with a different payload or optimistic precondition returns the
structured `IDEMPOTENCY_KEY_REUSE_CONFLICT` conflict (HTTP 409) and does not
create another command or event. Existing databases are upgraded in place and
backfill the fingerprint from their durable command JSON before accepting a
replay.

## Slice 3A local integrity jobs

`RunManagedAssetIntegrityProbe` is the first bounded asynchronous job vertical.
It accepts one exact project-scoped `asset_revision_id` and its pinned
SHA-256 `content_hash`; the revision must resolve to a `LOCAL_MANAGED` object
with one available primary CAS location. Core computes a canonical manifest
hash at queue time and records `jobs`, `job_attempts`, `job_evidence` and a
read-byte reservation in one transaction. The built-in connector is
`LOCAL_ASSET_PROBE_V1`; it performs only local, read-only file identity, size
and SHA-256 checks. It never calls a network/provider/CLI connector and never
mutates or repairs asset bytes.

The durable job states are `QUEUED`, `CLAIMED`, `RUNNING`,
`CANCELLATION_REQUESTED`, `CANCELLED_CONFIRMED`, `CANNOT_CANCEL`,
`COMPLETED`, `COMPLETED_AFTER_CANCEL`, `FAILED_RETRYABLE` and
`FAILED_FINAL`. Evidence is `PASS`, `FAIL` or `UNKNOWN`; `UNKNOWN` remains
unknown and is never promoted to `PASS`. A queued job can be cancelled before
the read starts. A running cancellation is recorded as a request and a late
read is retained as `COMPLETED_AFTER_CANCEL`; it does not become canonical
media state. Retry is an explicit, optimistic-versioned `EXACT` retry of the
same immutable revision, limited to three attempts, and is blocked when the
source identity is stale or the job is not retryable.

Startup fencing abandons an in-flight attempt, creates a fresh exact attempt
and requeues the pinned revision (or confirms cancellation), so a restart
cannot strand a job or reuse an old fencing token. Public projections expose
hashes, sizes, states, bounded codes and next steps only; absolute paths,
fencing tokens, raw diagnostics and provider fields remain internal. This
slice deliberately excludes generation, provider dispatch, remote jobs,
arbitrary shell/CLI execution, automatic repair/quarantine, destructive GC,
restore activation and recovery-epoch machinery.


## ProbeMediaAsset parser preparation

`media-probe.mjs` is a pure, bounded parser of producer bytes. The prepared
profile and proposed limits are documented in
`FINAL_DETAILED_DESIGN.md#DESIGN-MEDIA-PROBE-PARSER-01`. It accepts exact typed
audio/video facts, rejects ambiguous or unsafe output, and never grants PASS,
rights or release authority. Its result has no filesystem/process/DB side effect.

Run adversarial tests with:

`node --test core/media-probe.test.mjs`

Schema 21 now prepares the dedicated job/attempt/evidence and immutable
metadata/stream tables. Privileged SQL fixtures cover an actual v20 upgrade,
legacy preservation, project/source scope, exact fences, process-fact guards
and complete stream snapshots. These tests do not certify a real producer.

Schema 22 adds the previously missing exact binary-hash pins to evidence and
canonical metadata. New PASS binding/completion must match job, evidence and
measurement pins. An actual v21 upgrade retains historical rows without
fabricating binary observations; null legacy pins cannot prove verification.
The migration does not enable the producer or change integrity-job semantics.

The PREPARED admission lane now exposes ProbeMediaAsset, CancelMediaProbe and
RetryMediaProbe through the audited Command Engine and project-scoped HTTP.
It checks exact source/asset version and Core-owned SOURCE_USE rights for
MEDIA_INSPECTION. Admission creates only blocked intents without attempts,
processes, raw evidence or measurements. Retry is explicitly unavailable.
Projection reads recheck source/rights; command replay preserves the recorded
job while clients refresh current state. The Library reads this boundary on
demand and cancels only unexecuted blocked intents at the exact job version.
Certified producer/process containment, actual byte verification, metadata
binding, independent review and integration are still required.
Parser success alone must not be used as a readiness gate.

Admission/HTTP negative tests: `node --test core/media-probe-http.test.mjs`.

## Media probe capability-attestation preparation

`media-probe-attestation.mjs` verifies a bounded canonical signed envelope
against an externally pinned startup trust policy and current artifact
preflight. It checks Ed25519 key purpose/scope/state, policy/pack epoch floors,
revocations, validity windows and the exact ffprobe manifest/hash/size/version
and execution profiles. The authority is absent by default; missing trusted
time/fresh-trust observations block. No HTTP/UI value may provide trust inputs.

Run `node --test core/media-probe-attestation.test.mjs`. Tests create inert
local binary files, perform actual file preflight, generate an ephemeral key
in memory, sign fixture statements and exercise signature/scope/revocation,
canonical JSON/resource bounds, rollback/time and tampered-file rejection.
These keys are never persisted or provisioned to product startup. Verification
uses the built-in [Node crypto API](https://nodejs.org/docs/latest-v22.x/api/crypto.html#cryptoverifyalgorithm-data-key-signature).

The positive result is ATTESTATION_VERIFIED with execution DISABLED. It is not
a metadata PASS, a production certificate, license approval or proof of trusted
time/rollback-resistant storage. The verifier has no filesystem/process/DB
effect and is not wired into the blocked admission lane. Actual native broker,
durable attempts, source/rights rechecks, raw evidence and transactional
metadata binding still have to be integrated and independently reviewed.
The new module/test paths are proposed Task #64 extensions requiring the
trusted path contract and custody before promotion. Control maturity is unchanged.
