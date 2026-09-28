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
- optimistic `row_version` checks and deterministic idempotency keys;
- append-only `commands`, `domain_events`, and `audit_records` ledgers;
- query projections for home, project workspace, health, activity, search,
  storage, library assets, import sessions and command history;
- resumable event reads using `events.subscribe({after_seq})`;
- a JSON-line process boundary for a desktop host;
- a loopback HTTP adapter for the packaged desktop shell.

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
| GET | `/v1/projects/{id}/assets` | List project assets and latest immutable revisions |
| POST | `/v1/projects/{id}/assets` | Hash and register a local file (copy by default) |
| GET | `/v1/assets` | List assets across the studio |
| POST | `/v1/assets` | Hash and register a studio-wide local file |
| GET | `/v1/assets/{id}/rights` | Evaluate an asset's effective right/consent state |
| GET | `/v1/rights/evaluate` | Evaluate a rights identity at a requested effective time |
| GET | `/v1/rights/{id}/identity` | Read identity and append-only rights evidence |
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
